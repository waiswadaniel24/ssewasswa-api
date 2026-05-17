// ============================================================
// E-COMMERCE MODULE — Online Store for Multi-Tenant SaaS
// Schools, Churches, and Businesses sell products online.
// ============================================================
// REQUIRED: Add these tables to VALID_TABLES in server.js:
//   ['ecommerce_products','ecommerce_categories','ecommerce_cart',
//    'ecommerce_orders','ecommerce_order_items','ecommerce_coupons',
//    'ecommerce_reviews','ecommerce_shipping_zones','ecommerce_store_settings']
//   .forEach(t => VALID_TABLES.add(t));
//
// LOAD in server.js:
//   const ecommerce = require('./e-commerce');
//   ecommerce(app, pool, { tenantMiddleware, requireAuth, wsBroadcast, redis: redisCache });
// ============================================================

'use strict';

module.exports = (app, pool, { tenantMiddleware, requireAuth, wsBroadcast, redis }) => {

  const ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // -- subscription gate --------------------------------------------------
  const _PLAN_LEVELS = { free: 0, basic: 1, pro: 2 };
  const requireSubscription = (minPlan) => async (req, res, next) => {
    if (req.user?.role === 'super_admin') return next();
    try {
      const tid = req.tenant?.id || req.user?.tenant_id;
      const sub = await pool.query("SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status='active'", [tid]);
      const plan = sub.rows[0]?.plan || 'free';
      if ((_PLAN_LEVELS[plan] || 0) < (_PLAN_LEVELS[minPlan] || 0)) {
        return res.status(403).json({ error: 'Subscription required', min_plan: minPlan, current_plan: plan, message: `Upgrade to ${minPlan} or higher to access this feature.` });
      }
    } catch (e) { /* allow through on DB error */ }
    next();
  };
  const errRes = (res, code, msg) => { if (!res.headersSent) res.status(code).json({ error: msg, status: code }); };
  const pag = (req) => {
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    return { page, limit, offset: (page - 1) * limit };
  };
  const slugify = (s) => String(s || '').toLowerCase().trim().replace(/[^\w\s-]/g, '').replace(/[\s_]+/g, '-').replace(/^-+|-+$/g, '');
  const ORDER_STATUSES = ['pending', 'confirmed', 'processing', 'shipped', 'delivered', 'cancelled', 'refunded'];
  const STATUS_FLOW = ['placed', 'confirmed', 'processing', 'shipped', 'delivered'];
  const STATUS_META = {
    placed: { label: 'Order Placed', icon: '📋', desc: 'Your order has been received', estimated_days: 0 },
    confirmed: { label: 'Confirmed', icon: '✅', desc: 'Payment confirmed, preparing order', estimated_days: 1 },
    processing: { label: 'Processing', icon: '🏭', desc: 'Your order is being prepared', estimated_days: 2 },
    shipped: { label: 'Shipped', icon: '🚚', desc: 'Your order is on its way', estimated_days: 5 },
    delivered: { label: 'Delivered', icon: '📦', desc: 'Your order has been delivered', estimated_days: 0 },
  };
  const isAdmin = (u) => u && (u.role === 'admin' || u.role === 'super_admin');

  // Redis helpers
  const cacheGet = async (k) => { if (!redis) return null; try { const v = await redis.get(k); return v ? JSON.parse(v) : null; } catch { return null; } };
  const cacheSet = async (k, d, t = 300) => { if (!redis) return; try { await redis.setex(k, t, JSON.stringify(d)); } catch {} };
  const cacheDel = async (p) => { if (!redis) return; try { const ks = await redis.keys(p); if (ks.length) await redis.del(ks); } catch {} };

  // ── MIGRATIONS ────────────────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS ecommerce_store_settings (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      store_name TEXT NOT NULL DEFAULT 'My Store', logo TEXT, currency TEXT DEFAULT 'UGX',
      tax_rate NUMERIC(5,2) DEFAULT 0, shipping_enabled BOOLEAN DEFAULT true,
      payment_methods JSONB DEFAULT '["momo","airtel","card"]'::jsonb,
      contact_email TEXT, contact_phone TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id))`,
    `CREATE TABLE IF NOT EXISTS ecommerce_categories (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL, slug TEXT, description TEXT, image TEXT,
      sort_order INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ecommerce_products (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL, slug TEXT, description TEXT, category TEXT,
      price NUMERIC(12,2) NOT NULL DEFAULT 0, sale_price NUMERIC(12,2),
      stock_qty INTEGER DEFAULT 0, images JSONB DEFAULT '[]'::jsonb,
      variants JSONB DEFAULT '[]'::jsonb, seo_title TEXT, seo_description TEXT,
      is_active BOOLEAN DEFAULT true, is_featured BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ecommerce_cart (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id INTEGER NOT NULL, product_id INTEGER NOT NULL,
      quantity INTEGER DEFAULT 1, variant JSONB, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ecommerce_orders (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      user_id INTEGER, order_number TEXT UNIQUE NOT NULL, status TEXT DEFAULT 'pending',
      subtotal NUMERIC(12,2) DEFAULT 0, tax NUMERIC(12,2) DEFAULT 0, shipping NUMERIC(12,2) DEFAULT 0,
      discount NUMERIC(12,2) DEFAULT 0, total NUMERIC(12,2) DEFAULT 0, currency TEXT DEFAULT 'UGX',
      shipping_address JSONB, payment_method TEXT, payment_status TEXT DEFAULT 'pending',
      paid_at TIMESTAMPTZ, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ecommerce_order_items (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL REFERENCES ecommerce_orders(id) ON DELETE CASCADE,
      product_id INTEGER, product_name TEXT, price NUMERIC(12,2),
      quantity INTEGER DEFAULT 1, variant JSONB, subtotal NUMERIC(12,2))`,
    `CREATE TABLE IF NOT EXISTS ecommerce_coupons (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      code TEXT NOT NULL, type TEXT DEFAULT 'percentage', value NUMERIC(12,2) NOT NULL,
      min_order NUMERIC(12,2) DEFAULT 0, max_uses INTEGER DEFAULT 0, used_count INTEGER DEFAULT 0,
      starts_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, code))`,
    `CREATE TABLE IF NOT EXISTS ecommerce_reviews (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL, user_id INTEGER,
      rating INTEGER DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
      title TEXT, comment TEXT, is_approved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS ecommerce_shipping_zones (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL, countries JSONB DEFAULT '[]'::jsonb,
      rate NUMERIC(12,2) DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_ec_prod_tenant ON ecommerce_products(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ec_prod_slug ON ecommerce_products(tenant_id, slug)`,
    `CREATE INDEX IF NOT EXISTS idx_ec_cart_user ON ecommerce_cart(tenant_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ec_ord_tenant ON ecommerce_orders(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ec_ord_user ON ecommerce_orders(tenant_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ec_ord_status ON ecommerce_orders(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_ec_oi_order ON ecommerce_order_items(order_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ec_coupon_code ON ecommerce_coupons(tenant_id, code)`,
    `CREATE INDEX IF NOT EXISTS idx_ec_review_prod ON ecommerce_reviews(tenant_id, product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ec_ship_tenant ON ecommerce_shipping_zones(tenant_id)`,
    // ── NEW: Product Reviews (public) ──
    `CREATE TABLE IF NOT EXISTS product_reviews (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
      user_id INTEGER, rating INTEGER NOT NULL DEFAULT 5 CHECK (rating >= 1 AND rating <= 5),
      reviewer_name TEXT, comment TEXT NOT NULL, is_approved BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_pr_prod ON product_reviews(product_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pr_tenant ON product_reviews(tenant_id)`,
    // ── NEW: Order Events (tracking timeline) ──
    `CREATE TABLE IF NOT EXISTS ecommerce_order_events (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      order_id INTEGER NOT NULL REFERENCES ecommerce_orders(id) ON DELETE CASCADE,
      status TEXT NOT NULL, label TEXT, description TEXT, tracking_number TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_oe_order ON ecommerce_order_events(order_id)`,
    // ── NEW: Reorder Levels per product ──
    `CREATE TABLE IF NOT EXISTS ecommerce_reorder_levels (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      product_id INTEGER NOT NULL REFERENCES ecommerce_products(id) ON DELETE CASCADE,
      reorder_level INTEGER NOT NULL DEFAULT 5, reorder_qty INTEGER NOT NULL DEFAULT 50,
      last_restocked TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, product_id))`
  ];

  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[E-Commerce] DB connection failed'); return; }
    try { for (const sql of migrations) await c.query(sql); console.log(`[E-Commerce] ${migrations.length} migrations applied`); }
    catch (e) { console.error('[E-Commerce] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ═══════════════════════════════════════════════════════════
  // 1. STORE SETTINGS
  // ═══════════════════════════════════════════════════════════
  app.get('/api/ecommerce/settings', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    let s = (await pool.query('SELECT * FROM ecommerce_store_settings WHERE tenant_id=$1', [tid])).rows[0];
    if (!s) {
      await pool.query('INSERT INTO ecommerce_store_settings (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING', [tid]);
      s = (await pool.query('SELECT * FROM ecommerce_store_settings WHERE tenant_id=$1', [tid])).rows[0];
    }
    res.json(s);
  }));

  app.put('/api/ecommerce/settings', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const { store_name, logo, currency, tax_rate, shipping_enabled, payment_methods, contact_email, contact_phone } = req.body;
    if (!store_name || !store_name.trim()) return errRes(res, 400, 'Store name is required');
    if (currency && !/^[A-Z]{3}$/.test(currency)) return errRes(res, 400, 'Currency must be 3-letter code');
    const r = await pool.query(
      `UPDATE ecommerce_store_settings SET store_name=$1,logo=$2,currency=$3,tax_rate=$4,shipping_enabled=$5,
       payment_methods=$6,contact_email=$7,contact_phone=$8,updated_at=NOW() WHERE tenant_id=$9 RETURNING *`,
      [store_name.trim(), logo || null, (currency || 'UGX').toUpperCase(), parseFloat(tax_rate) || 0,
       shipping_enabled === true, payment_methods ? JSON.stringify(payment_methods) : '["momo","airtel","card"]',
       contact_email || null, contact_phone || null, tid]);
    wsBroadcast(tid, { type: 'ecommerce:settings_updated' });
    res.json(r.rows[0]);
  }));

  // ═══════════════════════════════════════════════════════════
  // 2. CATEGORIES — CRUD
  // ═══════════════════════════════════════════════════════════
  app.get('/api/ecommerce/categories', tenantMiddleware, ah(async (req, res) => {
    res.json((await pool.query('SELECT * FROM ecommerce_categories WHERE tenant_id=$1 ORDER BY sort_order,name', [req.tenant.id])).rows);
  }));

  app.post('/api/ecommerce/categories', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const { name, description, image, sort_order, is_active } = req.body;
    if (!name || !name.trim()) return errRes(res, 400, 'Category name required');
    const r = await pool.query(
      `INSERT INTO ecommerce_categories (tenant_id,name,slug,description,image,sort_order,is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
      [tid, name.trim(), slugify(name), description || null, image || null, parseInt(sort_order) || 0, is_active !== false]);
    res.status(201).json(r.rows[0]);
  }));

  app.put('/api/ecommerce/categories/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const { name, description, image, sort_order, is_active } = req.body;
    const ex = (await pool.query('SELECT id FROM ecommerce_categories WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!ex) return errRes(res, 404, 'Category not found');
    const r = await pool.query(
      `UPDATE ecommerce_categories SET name=$1,slug=$2,description=$3,image=$4,sort_order=$5,is_active=$6 WHERE id=$7 AND tenant_id=$8 RETURNING *`,
      [(name || '').trim(), slugify(name || ''), description || null, image || null, parseInt(sort_order) || 0, is_active !== false, req.params.id, tid]);
    res.json(r.rows[0]);
  }));

  app.delete('/api/ecommerce/categories/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const r = await pool.query('DELETE FROM ecommerce_categories WHERE id=$1 AND tenant_id=$2 RETURNING id', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return errRes(res, 404, 'Category not found');
    res.json({ deleted: true });
  }));

  // ═══════════════════════════════════════════════════════════
  // 3. PRODUCT CATALOG — CRUD with SEO, Variants, Images
  // ═══════════════════════════════════════════════════════════
  app.get('/api/ecommerce/products', tenantMiddleware, ah(async (req, res) => {
    const tid = req.tenant.id;
    const { page, limit, offset } = pag(req);
    const { q, category, featured, sort } = req.query;
    let where = ['tenant_id=$1', 'is_active=true'], params = [tid], pi = 2;
    if (q) { where.push(`(name ILIKE $${pi} OR description ILIKE $${pi})`); params.push('%' + q + '%'); pi++; }
    if (category) { where.push(`category=$${pi}`); params.push(category); pi++; }
    if (featured === 'true') where.push('is_featured=true');
    const orderMap = { newest: 'created_at DESC', price_asc: 'price ASC', price_desc: 'price DESC', name: 'name ASC', popular: 'created_at DESC' };
    const total = parseInt((await pool.query(`SELECT COUNT(*) FROM ecommerce_products WHERE ${where.join(' AND ')}`, params)).rows[0].count);
    const rows = (await pool.query(
      `SELECT p.id,p.name,p.slug,p.description,p.category,p.price,p.sale_price,p.stock_qty,p.images,p.variants,p.seo_title,p.seo_description,p.is_featured,p.created_at,
        COALESCE(rs.avg_rating,0)::numeric(3,1) as avg_rating, COALESCE(rs.review_count,0) as review_count
       FROM ecommerce_products p
       LEFT JOIN (SELECT product_id, AVG(rating) as avg_rating, COUNT(*) as review_count FROM product_reviews WHERE is_approved=true GROUP BY product_id) rs ON rs.product_id=p.id
       WHERE ${where.join(' AND ')} ORDER BY ${orderMap[sort] || orderMap.newest} LIMIT $${pi} OFFSET $${pi+1}`,
      [...params, limit, offset])).rows;
    res.json({ products: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  }));

  app.get('/api/ecommerce/products/:slug', tenantMiddleware, ah(async (req, res) => {
    const tid = req.tenant.id;
    const p = (await pool.query('SELECT * FROM ecommerce_products WHERE slug=$1 AND tenant_id=$2 AND is_active=true', [req.params.slug, tid])).rows[0];
    if (!p) return errRes(res, 404, 'Product not found');
    p.reviews = (await pool.query(
      `SELECT r.*,u.name as user_name FROM ecommerce_reviews r LEFT JOIN users u ON u.id=r.user_id
       WHERE r.product_id=$1 AND r.tenant_id=$2 AND r.is_approved=true ORDER BY r.created_at DESC LIMIT 50`, [p.id, tid])).rows;
    p.avg_rating = p.reviews.length ? (p.reviews.reduce((s, r) => s + r.rating, 0) / p.reviews.length).toFixed(1) : null;
    res.json(p);
  }));

  app.post('/api/ecommerce/products', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const { name, description, category, price, sale_price, stock_qty, images, variants, seo_title, seo_description, is_featured, is_active } = req.body;
    if (!name || !name.trim()) return errRes(res, 400, 'Product name required');
    if (price === undefined || isNaN(parseFloat(price)) || parseFloat(price) < 0) return errRes(res, 400, 'Valid price required');
    let slug = slugify(name);
    if ((await pool.query('SELECT 1 FROM ecommerce_products WHERE slug=$1 AND tenant_id=$2', [slug, tid])).rows.length) slug += '-' + Date.now().toString(36);
    const r = await pool.query(
      `INSERT INTO ecommerce_products (tenant_id,name,slug,description,category,price,sale_price,stock_qty,images,variants,seo_title,seo_description,is_featured,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING *`,
      [tid, name.trim(), slug, description || null, category || null, parseFloat(price),
       sale_price != null ? parseFloat(sale_price) : null, parseInt(stock_qty) || 0,
       images ? JSON.stringify(images) : '[]', variants ? JSON.stringify(variants) : '[]',
       seo_title || null, seo_description || null, is_featured === true, is_active !== false]);
    wsBroadcast(tid, { type: 'ecommerce:product_created', product: r.rows[0] });
    res.status(201).json(r.rows[0]);
  }));

  app.put('/api/ecommerce/products/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, pid = req.params.id;
    if (!(await pool.query('SELECT 1 FROM ecommerce_products WHERE id=$1 AND tenant_id=$2', [pid, tid])).rows.length)
      return errRes(res, 404, 'Product not found');
    const { name, description, category, price, sale_price, stock_qty, images, variants, seo_title, seo_description, is_featured, is_active } = req.body;
    const r = await pool.query(
      `UPDATE ecommerce_products SET name=$1,slug=$2,description=$3,category=$4,price=$5,sale_price=$6,
       stock_qty=$7,images=$8,variants=$9,seo_title=$10,seo_description=$11,is_featured=$12,is_active=$13,updated_at=NOW()
       WHERE id=$14 AND tenant_id=$15 RETURNING *`,
      [(name || '').trim() || name, slugify(name || ''), description, category,
       price != undefined ? parseFloat(price) : undefined, sale_price != null ? parseFloat(sale_price) : null,
       stock_qty != undefined ? parseInt(stock_qty) : undefined,
       images ? JSON.stringify(images) : undefined, variants ? JSON.stringify(variants) : undefined,
       seo_title, seo_description, is_featured === true, is_active !== false, pid, tid]);
    wsBroadcast(tid, { type: 'ecommerce:product_updated', productId: pid });
    res.json(r.rows[0]);
  }));

  app.delete('/api/ecommerce/products/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const r = await pool.query(
      'UPDATE ecommerce_products SET is_active=false,updated_at=NOW() WHERE id=$1 AND tenant_id=$2 RETURNING id',
      [req.params.id, req.tenant.id]);
    if (!r.rows.length) return errRes(res, 404, 'Product not found');
    res.json({ deleted: true });
  }));

  // ═══════════════════════════════════════════════════════════
  // 4. SHOPPING CART — Add/Remove/Update/Apply Coupon
  // ═══════════════════════════════════════════════════════════
  const getCartTotals = async (tid, userId, couponCode) => {
    const cartItems = (await pool.query(
      `SELECT c.*,p.price,p.sale_price,p.name,p.stock_qty,p.is_active
       FROM ecommerce_cart c JOIN ecommerce_products p ON p.id=c.product_id WHERE c.tenant_id=$1 AND c.user_id=$2`, [tid, userId])).rows;
    let subtotal = 0;
    const items = cartItems.filter(i => i.is_active && i.stock_qty >= i.quantity).map(i => {
      const up = (i.sale_price && i.sale_price < i.price) ? i.sale_price : i.price;
      const lt = up * i.quantity; subtotal += lt;
      return { ...i, unit_price: up, line_total: lt };
    });
    let discount = 0, coupon = null, couponMsg = null;
    if (couponCode) {
      coupon = (await pool.query(
        'SELECT * FROM ecommerce_coupons WHERE code=$1 AND tenant_id=$2 AND is_active=true', [couponCode.toUpperCase(), tid])).rows[0];
      if (coupon) {
        const now = new Date();
        if (coupon.expires_at && new Date(coupon.expires_at) < now) couponMsg = 'Coupon expired';
        else if (coupon.starts_at && new Date(coupon.starts_at) > now) couponMsg = 'Coupon not active yet';
        else if (coupon.max_uses > 0 && coupon.used_count >= coupon.max_uses) couponMsg = 'Usage limit reached';
        else if (coupon.min_order && subtotal < coupon.min_order) couponMsg = `Minimum order: ${coupon.min_order}`;
        else discount = coupon.type === 'percentage' ? Math.round(subtotal * (coupon.value / 100) * 100) / 100 : Math.min(coupon.value, subtotal);
      } else { couponMsg = 'Invalid coupon'; }
    }
    const afterD = subtotal - discount;
    const settings = (await pool.query('SELECT tax_rate,shipping_enabled FROM ecommerce_store_settings WHERE tenant_id=$1', [tid])).rows[0];
    const taxRate = settings ? parseFloat(settings.tax_rate) : 0;
    const tax = Math.round(afterD * (taxRate / 100) * 100) / 100;
    return { items, subtotal, discount, coupon: couponMsg ? { error: couponMsg } : coupon, tax, shipping: 0, total: afterD + tax };
  };

  app.get('/api/ecommerce/cart', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    res.json(await getCartTotals(req.tenant.id, req.user.id, req.query.coupon));
  }));

  app.post('/api/ecommerce/cart', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, userId = req.user.id;
    const { product_id, quantity, variant } = req.body;
    if (!product_id) return errRes(res, 400, 'Product ID required');
    const qty = Math.max(1, Math.min(100, parseInt(quantity) || 1));
    const p = (await pool.query('SELECT id,stock_qty,is_active FROM ecommerce_products WHERE id=$1 AND tenant_id=$2', [product_id, tid])).rows[0];
    if (!p || !p.is_active) return errRes(res, 404, 'Product unavailable');
    if (p.stock_qty < qty) return errRes(res, 400, 'Insufficient stock');
    const ex = (await pool.query('SELECT id,quantity FROM ecommerce_cart WHERE tenant_id=$1 AND user_id=$2 AND product_id=$3', [tid, userId, product_id])).rows[0];
    if (ex) {
      const nq = ex.quantity + qty;
      if (p.stock_qty < nq) return errRes(res, 400, 'Insufficient stock');
      await pool.query('UPDATE ecommerce_cart SET quantity=$1,variant=$2 WHERE id=$3', [nq, variant ? JSON.stringify(variant) : null, ex.id]);
    } else {
      await pool.query('INSERT INTO ecommerce_cart (tenant_id,user_id,product_id,quantity,variant) VALUES ($1,$2,$3,$4,$5)',
        [tid, userId, product_id, qty, variant ? JSON.stringify(variant) : null]);
    }
    res.status(201).json(await getCartTotals(tid, userId, null));
  }));

  app.put('/api/ecommerce/cart/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, userId = req.user.id;
    const qty = Math.max(1, Math.min(100, parseInt(req.body.quantity) || 1));
    const ci = (await pool.query(
      `SELECT c.id,c.product_id,c.quantity,p.stock_qty FROM ecommerce_cart c
       JOIN ecommerce_products p ON p.id=c.product_id WHERE c.id=$1 AND c.tenant_id=$2 AND c.user_id=$3`,
      [req.params.id, tid, userId])).rows[0];
    if (!ci) return errRes(res, 404, 'Cart item not found');
    if (ci.stock_qty < qty) return errRes(res, 400, 'Insufficient stock');
    await pool.query('UPDATE ecommerce_cart SET quantity=$1 WHERE id=$2', [qty, req.params.id]);
    res.json(await getCartTotals(tid, userId, null));
  }));

  app.delete('/api/ecommerce/cart/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    await pool.query('DELETE FROM ecommerce_cart WHERE id=$1 AND tenant_id=$2 AND user_id=$3', [req.params.id, req.tenant.id, req.user.id]);
    res.json(await getCartTotals(req.tenant.id, req.user.id, null));
  }));

  app.post('/api/ecommerce/cart/validate-coupon', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const { code } = req.body;
    if (!code) return errRes(res, 400, 'Coupon code required');
    const t = await getCartTotals(req.tenant.id, req.user.id, code);
    res.json({ discount: t.discount, coupon: t.coupon, subtotal: t.subtotal });
  }));

  // ═══════════════════════════════════════════════════════════
  // 5. ORDER MANAGEMENT — Create/Status/History/Details
  // ═══════════════════════════════════════════════════════════
  const genOrderNum = () => 'EC-' + Date.now().toString(36).toUpperCase() + Math.random().toString(36).substring(2, 6).toUpperCase();

  app.post('/api/ecommerce/orders', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, userId = req.user.id;
    const { shipping_address, payment_method, coupon_code, notes } = req.body;
    if (!payment_method) return errRes(res, 400, 'Payment method required');
    if (!shipping_address || !shipping_address.name || !shipping_address.phone) return errRes(res, 400, 'Shipping address with name and phone required');
    const totals = await getCartTotals(tid, userId, coupon_code);
    if (!totals.items.length) return errRes(res, 400, 'Cart is empty');
    if (totals.coupon && totals.coupon.error) return errRes(res, 400, totals.coupon.error);

    // Check stock & reserve
    for (const item of totals.items) {
      const p = (await pool.query('SELECT stock_qty FROM ecommerce_products WHERE id=$1 AND tenant_id=$2 FOR UPDATE', [item.product_id, tid])).rows[0];
      if (!p || p.stock_qty < item.quantity) return errRes(res, 400, `Insufficient stock for "${item.name}"`);
      await pool.query('UPDATE ecommerce_products SET stock_qty=stock_qty-$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [item.quantity, item.product_id, tid]);
    }
    if (totals.coupon && totals.coupon.id)
      await pool.query('UPDATE ecommerce_coupons SET used_count=used_count+1 WHERE id=$1 AND tenant_id=$2', [totals.coupon.id, tid]);

    const currency = ((await pool.query('SELECT currency FROM ecommerce_store_settings WHERE tenant_id=$1', [tid])).rows[0] || {}).currency || 'UGX';
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const orderR = await client.query(
        `INSERT INTO ecommerce_orders (tenant_id,user_id,order_number,status,subtotal,tax,shipping,discount,total,currency,shipping_address,payment_method,payment_status,notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *`,
        [tid, userId, genOrderNum(), 'pending', totals.subtotal, totals.tax, totals.shipping, totals.discount, totals.total, currency,
         JSON.stringify(shipping_address), payment_method, 'pending', notes || null]);
      const order = orderR.rows[0];
      for (const item of totals.items)
        await client.query(
          `INSERT INTO ecommerce_order_items (tenant_id,order_id,product_id,product_name,price,quantity,variant,subtotal) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [tid, order.id, item.product_id, item.name, item.unit_price, item.quantity, item.variant || null, item.line_total]);
      await client.query('DELETE FROM ecommerce_cart WHERE tenant_id=$1 AND user_id=$2', [tid, userId]);
      await client.query('COMMIT');
      wsBroadcast(tid, { type: 'ecommerce:new_order', orderId: order.id, orderNumber: order.order_number });
      res.status(201).json(order);
    } catch (e) { await client.query('ROLLBACK'); throw e; } finally { client.release(); }
  }));

  app.get('/api/ecommerce/orders', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, { page, limit, offset } = pag(req), { status } = req.query;
    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (!isAdmin(req.user)) { where.push('user_id=$' + pi); params.push(req.user.id); pi++; }
    if (status && ORDER_STATUSES.includes(status)) { where.push('status=$' + pi); params.push(status); pi++; }
    const total = parseInt((await pool.query(`SELECT COUNT(*) FROM ecommerce_orders WHERE ${where.join(' AND ')}`, params)).rows[0].count);
    const rows = (await pool.query(
      `SELECT * FROM ecommerce_orders WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT $${pi} OFFSET $${pi+1}`,
      [...params, limit, offset])).rows;
    res.json({ orders: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  }));

  app.get('/api/ecommerce/orders/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    let sql = 'SELECT o.* FROM ecommerce_orders o WHERE o.tenant_id=$1 AND o.id=$2', params = [tid, req.params.id];
    if (!isAdmin(req.user)) { sql += ' AND o.user_id=$3'; params.push(req.user.id); }
    const order = (await pool.query(sql, params)).rows[0];
    if (!order) return errRes(res, 404, 'Order not found');
    order.items = (await pool.query('SELECT * FROM ecommerce_order_items WHERE order_id=$1 AND tenant_id=$2', [order.id, tid])).rows;
    res.json(order);
  }));

  app.patch('/api/ecommerce/orders/:id/status', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const { status, tracking_number } = req.body;
    if (!status || !ORDER_STATUSES.includes(status)) return errRes(res, 400, `Invalid status: ${ORDER_STATUSES.join(', ')}`);
    const existing = (await pool.query('SELECT * FROM ecommerce_orders WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!existing) return errRes(res, 404, 'Order not found');
    // Restore stock on cancellation
    if (status === 'cancelled' && existing.status !== 'cancelled') {
      const items = (await pool.query('SELECT product_id,quantity FROM ecommerce_order_items WHERE order_id=$1 AND tenant_id=$2', [req.params.id, tid])).rows;
      for (const i of items)
        await pool.query('UPDATE ecommerce_products SET stock_qty=stock_qty+$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [i.quantity, i.product_id, tid]);
    }
    let sql = 'UPDATE ecommerce_orders SET status=$1,updated_at=NOW()', params = [status, req.params.id, tid], pi = 4;
    if (tracking_number) { sql += `,shipping_address=COALESCE(shipping_address,'{}'::jsonb)||$${pi}::jsonb`; params.push(JSON.stringify({ tracking_number })); pi++; }
    sql += ' WHERE id=$2 AND tenant_id=$3 RETURNING *';
    const r = await pool.query(sql, params);
    // Log order event for tracking timeline
    const meta = STATUS_META[status] || {};
    await pool.query(
      `INSERT INTO ecommerce_order_events (tenant_id,order_id,status,label,description,tracking_number) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, req.params.id, status, meta.label || status, meta.desc || '', tracking_number || null]).catch(() => {});
    wsBroadcast(tid, { type: 'ecommerce:order_status_updated', orderId: parseInt(req.params.id), status });
    res.json(r.rows[0]);
  }));

  // ═══════════════════════════════════════════════════════════
  // 6. PAYMENTS — MTN MoMo, Airtel Money, Card references
  // ═══════════════════════════════════════════════════════════
  app.post('/api/ecommerce/orders/:id/pay', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, userId = req.user.id;
    const { method, phone, reference } = req.body;
    if (!method) return errRes(res, 400, 'Payment method required');
    const valid = ['momo', 'airtel', 'card', 'flutterwave', 'dpo', 'manual'];
    if (!valid.includes(method)) return errRes(res, 400, `Method must be: ${valid.join(', ')}`);
    const order = (await pool.query('SELECT * FROM ecommerce_orders WHERE id=$1 AND tenant_id=$2 AND user_id=$3', [req.params.id, tid, userId])).rows[0];
    if (!order) return errRes(res, 404, 'Order not found');
    if (order.payment_status === 'paid') return errRes(res, 400, 'Order already paid');
    await pool.query('UPDATE ecommerce_orders SET payment_method=$1,payment_status=$2,updated_at=NOW() WHERE id=$3 AND tenant_id=$4',
      [method, 'pending', order.id, tid]);
    wsBroadcast(tid, { type: 'ecommerce:payment_initiated', orderId: order.id, method });
    res.json({ order_id: order.id, order_number: order.order_number, amount: order.total, currency: order.currency, method,
      phone: (method === 'momo' || method === 'airtel') ? phone : null,
      reference: reference || `EC-${order.order_number}`,
      callback_url: `${process.env.BASE_URL || ''}/api/ecommerce/payments/callback` });
  }));

  app.post('/api/ecommerce/payments/callback', ah(async (req, res) => {
    const { order_number, status, reference, provider, amount } = req.body;
    if (!order_number) return errRes(res, 400, 'Order number required');
    const order = (await pool.query('SELECT id,tenant_id,total FROM ecommerce_orders WHERE order_number=$1', [order_number])).rows[0];
    if (!order) return errRes(res, 404, 'Order not found');
    const paid = ['successful', 'completed', 'paid'].includes(status);
    await pool.query('UPDATE ecommerce_orders SET payment_status=$1,status=$2,paid_at=$3,updated_at=NOW() WHERE id=$4',
      [paid ? 'paid' : 'failed', paid ? 'confirmed' : 'pending', paid ? new Date() : null, order.id]);
    if (paid) wsBroadcast(order.tenant_id, { type: 'ecommerce:payment_confirmed', orderId: order.id, order_number, amount, reference, provider });
    res.json({ received: true, order_number, payment_status: paid ? 'paid' : 'failed' });
  }));

  // ═══════════════════════════════════════════════════════════
  // 7. INVENTORY SYNC — Low stock alerts, stock adjustment
  // ═══════════════════════════════════════════════════════════
  app.get('/api/ecommerce/inventory/alerts', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, threshold = Math.max(1, parseInt(req.query.threshold) || 5);
    const rows = (await pool.query(
      `SELECT id,name,slug,stock_qty,price,is_active FROM ecommerce_products
       WHERE tenant_id=$1 AND is_active=true AND stock_qty<=$2 ORDER BY stock_qty ASC`, [tid, threshold])).rows;
    if (rows.length) wsBroadcast(tid, { type: 'ecommerce:low_stock_alert', count: rows.length });
    res.json({ low_stock: rows, count: rows.length, threshold });
  }));

  app.put('/api/ecommerce/products/:id/stock', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const newStock = Math.max(0, parseInt(req.body.stock_qty));
    if (isNaN(newStock)) return errRes(res, 400, 'Valid stock_qty required');
    const p = (await pool.query('SELECT id,name,stock_qty FROM ecommerce_products WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!p) return errRes(res, 404, 'Product not found');
    await pool.query('UPDATE ecommerce_products SET stock_qty=$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [newStock, req.params.id, tid]);
    if (newStock <= 5) wsBroadcast(tid, { type: 'ecommerce:low_stock_alert', productId: p.id, productName: p.name, prevQty: p.stock_qty, newQty: newStock });
    res.json({ stock_qty: newStock });
  }));

  // ═══════════════════════════════════════════════════════════
  // 8. SHIPPING — Zones, Rates, Calculation
  // ═══════════════════════════════════════════════════════════
  app.get('/api/ecommerce/shipping/zones', tenantMiddleware, ah(async (req, res) => {
    res.json((await pool.query('SELECT * FROM ecommerce_shipping_zones WHERE tenant_id=$1 AND is_active=true ORDER BY name', [req.tenant.id])).rows);
  }));

  app.post('/api/ecommerce/shipping/zones', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    const { name, countries, rate, is_active } = req.body;
    if (!name || !name.trim()) return errRes(res, 400, 'Zone name required');
    const r = await pool.query(
      `INSERT INTO ecommerce_shipping_zones (tenant_id,name,countries,rate,is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
      [tid, name.trim(), countries ? JSON.stringify(countries) : '[]', parseFloat(rate) || 0, is_active !== false]);
    res.status(201).json(r.rows[0]);
  }));

  app.put('/api/ecommerce/shipping/zones/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    if (!(await pool.query('SELECT 1 FROM ecommerce_shipping_zones WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows.length)
      return errRes(res, 404, 'Zone not found');
    const { name, countries, rate, is_active } = req.body;
    const r = await pool.query(
      `UPDATE ecommerce_shipping_zones SET name=$1,countries=$2,rate=$3,is_active=$4 WHERE id=$5 AND tenant_id=$6 RETURNING *`,
      [(name || '').trim(), countries ? JSON.stringify(countries) : '[]', parseFloat(rate) || 0, is_active !== false, req.params.id, tid]);
    res.json(r.rows[0]);
  }));

  app.delete('/api/ecommerce/shipping/zones/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const r = await pool.query('DELETE FROM ecommerce_shipping_zones WHERE id=$1 AND tenant_id=$2 RETURNING id', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return errRes(res, 404, 'Zone not found');
    res.json({ deleted: true });
  }));

  app.post('/api/ecommerce/shipping/calculate', tenantMiddleware, ah(async (req, res) => {
    const tid = req.tenant.id, { country } = req.body;
    const zones = (await pool.query('SELECT * FROM ecommerce_shipping_zones WHERE tenant_id=$1 AND is_active=true', [tid])).rows;
    const matched = zones.find(z => (Array.isArray(z.countries) ? z.countries : []).includes(country));
    const rate = matched ? (parseFloat(matched.rate) || 0) : (zones.length ? Math.max(...zones.map(z => parseFloat(z.rate) || 0)) : 0);
    res.json({ shipping_cost: rate, zone: matched ? matched.name : 'default', currency: 'UGX' });
  }));

  // ═══════════════════════════════════════════════════════════
  // 9. REVIEWS & RATINGS — Create, List, Moderate
  // ═══════════════════════════════════════════════════════════
  app.post('/api/ecommerce/products/:id/reviews', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, userId = req.user.id;
    const rating = Math.max(1, Math.min(5, parseInt(req.body.rating) || 5));
    const p = (await pool.query('SELECT id FROM ecommerce_products WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!p) return errRes(res, 404, 'Product not found');
    if ((await pool.query('SELECT 1 FROM ecommerce_reviews WHERE product_id=$1 AND tenant_id=$2 AND user_id=$3', [req.params.id, tid, userId])).rows.length)
      return errRes(res, 409, 'Already reviewed this product');
    const r = await pool.query(
      `INSERT INTO ecommerce_reviews (tenant_id,product_id,user_id,rating,title,comment) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tid, req.params.id, userId, rating, (req.body.title || '').trim() || null, (req.body.comment || '').trim() || null]);
    res.status(201).json(r.rows[0]);
  }));

  app.get('/api/ecommerce/reviews', tenantMiddleware, ah(async (req, res) => {
    const tid = req.tenant.id, { page, limit, offset } = pag(req), { product_id, pending } = req.query;
    let where = ['r.tenant_id=$1'], params = [tid], pi = 2;
    if (product_id) { where.push(`r.product_id=$${pi}`); params.push(product_id); pi++; }
    if (pending === 'true' && isAdmin(req.user)) where.push('r.is_approved=false');
    else if (!isAdmin(req.user)) where.push('r.is_approved=true');
    const total = parseInt((await pool.query(`SELECT COUNT(*) FROM ecommerce_reviews r WHERE ${where.join(' AND ')}`, params)).rows[0].count);
    const rows = (await pool.query(
      `SELECT r.*,u.name as user_name FROM ecommerce_reviews r LEFT JOIN users u ON u.id=r.user_id
       WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT $${pi} OFFSET $${pi+1}`, [...params, limit, offset])).rows;
    res.json({ reviews: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  }));

  app.patch('/api/ecommerce/reviews/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const r = await pool.query('UPDATE ecommerce_reviews SET is_approved=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [req.body.is_approved === true, req.params.id, req.tenant.id]);
    if (!r.rows.length) return errRes(res, 404, 'Review not found');
    res.json(r.rows[0]);
  }));

  app.delete('/api/ecommerce/reviews/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const r = await pool.query('DELETE FROM ecommerce_reviews WHERE id=$1 AND tenant_id=$2 RETURNING id', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return errRes(res, 404, 'Review not found');
    res.json({ deleted: true });
  }));

  // ═══════════════════════════════════════════════════════════
  // 10. PRODUCT REVIEWS (Public) — /store/:id/reviews GET & POST
  // ═══════════════════════════════════════════════════════════
  app.get('/store/:id/reviews', tenantMiddleware, ah(async (req, res) => {
    const tid = req.tenant.id, pid = parseInt(req.params.id);
    if (!pid || isNaN(pid)) return errRes(res, 400, 'Valid product ID required');
    const p = (await pool.query('SELECT id,name FROM ecommerce_products WHERE id=$1 AND tenant_id=$2 AND is_active=true', [pid, tid])).rows[0];
    if (!p) return errRes(res, 404, 'Product not found');
    const reviews = (await pool.query(
      `SELECT r.*,u.name as user_name FROM product_reviews r LEFT JOIN users u ON u.id=r.user_id
       WHERE r.product_id=$1 AND r.tenant_id=$2 AND r.is_approved=true ORDER BY r.created_at DESC`, [pid, tid])).rows;
    const stats = (await pool.query(
      `SELECT COUNT(*) as total, COALESCE(AVG(rating),0) as avg_rating,
       COUNT(*) FILTER (WHERE rating=5) as five, COUNT(*) FILTER (WHERE rating=4) as four,
       COUNT(*) FILTER (WHERE rating=3) as three, COUNT(*) FILTER (WHERE rating=2) as two,
       COUNT(*) FILTER (WHERE rating=1) as one
       FROM product_reviews WHERE product_id=$1 AND tenant_id=$2 AND is_approved=true`, [pid, tid])).rows[0];
    res.json({ product: { id: p.id, name: p.name }, reviews, stats: { total: parseInt(stats.total), avg_rating: parseFloat(stats.avg_rating).toFixed(1), distribution: { 5: parseInt(stats.five), 4: parseInt(stats.four), 3: parseInt(stats.three), 2: parseInt(stats.two), 1: parseInt(stats.one) } } });
  }));

  app.post('/store/:id/reviews', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id, pid = parseInt(req.params.id), userId = req.user.id;
    if (!pid || isNaN(pid)) return errRes(res, 400, 'Valid product ID required');
    const { rating, comment, reviewer_name } = req.body;
    if (!rating || rating < 1 || rating > 5) return errRes(res, 400, 'Rating must be 1-5');
    if (!comment || !comment.trim()) return errRes(res, 400, 'Review comment required');
    const p = (await pool.query('SELECT id FROM ecommerce_products WHERE id=$1 AND tenant_id=$2 AND is_active=true', [pid, tid])).rows[0];
    if (!p) return errRes(res, 404, 'Product not found');
    const r = await pool.query(
      `INSERT INTO product_reviews (tenant_id,product_id,user_id,rating,reviewer_name,comment) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [tid, pid, userId, Math.max(1, Math.min(5, parseInt(rating))), (reviewer_name || '').trim() || null, comment.trim()]);
    wsBroadcast(tid, { type: 'ecommerce:review_submitted', productId: pid });
    res.status(201).json(r.rows[0]);
  }));

  // ═══════════════════════════════════════════════════════════
  // 10.5 ORDER TRACKING — /orders/:id/track GET
  // ═══════════════════════════════════════════════════════════

  app.get('/orders/:id/track', tenantMiddleware, ah(async (req, res) => {
    const tid = req.tenant.id, oid = req.params.id;
    const order = (await pool.query(
      `SELECT o.*,sa->>'tracking_number' as tracking_number FROM ecommerce_orders o WHERE o.id=$1 AND o.tenant_id=$2`,
      [oid, tid])).rows[0];
    if (!order) return errRes(res, 404, 'Order not found');
    const items = (await pool.query('SELECT product_name,quantity,price FROM ecommerce_order_items WHERE order_id=$1', [oid])).rows;
    const events = (await pool.query(
      `SELECT * FROM ecommerce_order_events WHERE order_id=$1 AND tenant_id=$2 ORDER BY created_at ASC`, [oid, tid])).rows;
    // Build timeline from events or derive from status
    const timeline = events.length > 0 ? events.map(e => ({
      status: e.status, label: e.label || (STATUS_META[e.status] || {}).label || e.status,
      description: e.description || (STATUS_META[e.status] || {}).desc || '',
      timestamp: e.created_at,
      tracking_number: e.tracking_number || null,
    })) : deriveTimeline(order);
    // Estimated delivery
    const currentIdx = STATUS_FLOW.indexOf(order.status === 'cancelled' ? 'placed' : order.status);
    const remainingDays = currentIdx >= 0 ? STATUS_META[STATUS_FLOW[Math.min(currentIdx, STATUS_FLOW.length - 1)]]?.estimated_days || 0 : 0;
    const estDelivery = order.created_at ? new Date(new Date(order.created_at).getTime() + (remainingDays + 3) * 86400000) : null;
    res.json({
      order: { id: order.id, order_number: order.order_number, status: order.status, total: order.total, currency: order.currency, created_at: order.created_at, tracking_number: order.tracking_number },
      items, timeline, estimated_delivery: estDelivery ? estDelivery.toISOString() : null,
      progress: order.status === 'cancelled' ? -1 : Math.max(0, Math.min(100, (currentIdx / (STATUS_FLOW.length - 1)) * 100)),
    });
  }));

  function deriveTimeline(order) {
    const idx = STATUS_FLOW.indexOf(order.status === 'cancelled' || order.status === 'refunded' ? 'placed' : order.status);
    const timeline = [];
    for (let i = 0; i <= Math.max(0, idx); i++) {
      const s = STATUS_FLOW[i];
      const meta = STATUS_META[s] || {};
      timeline.push({ status: s, label: meta.label || s, description: meta.desc || '', timestamp: order.updated_at || order.created_at, tracking_number: s === 'shipped' ? (order.tracking_number || null) : null });
    }
    return timeline;
  }

  // ═══════════════════════════════════════════════════════════
  // 10.6 LOW STOCK ALERTS DASHBOARD — /store/alerts GET
  // ═══════════════════════════════════════════════════════════
  app.get('/store/alerts', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const threshold = Math.max(1, parseInt(req.query.threshold) || 5);
    // Products below reorder level
    const critical = (await pool.query(
      `SELECT p.id,p.name,p.slug,p.stock_qty,p.price,
        COALESCE(r.reorder_level, ${threshold}) as reorder_level,
        CASE WHEN p.stock_qty <= 0 THEN 'out_of_stock' WHEN p.stock_qty <= ${threshold} THEN 'low_stock' ELSE 'ok' END as stock_status
       FROM ecommerce_products p
       LEFT JOIN ecommerce_reorder_levels r ON r.product_id = p.id AND r.tenant_id = p.tenant_id
       WHERE p.tenant_id=$1 AND p.is_active=true AND p.stock_qty <= ${threshold}
       ORDER BY p.stock_qty ASC`, [tid])).rows;
    const outOfStock = critical.filter(p => p.stock_qty <= 0);
    const lowStock = critical.filter(p => p.stock_qty > 0);
    const totalProducts = parseInt((await pool.query('SELECT COUNT(*) FROM ecommerce_products WHERE tenant_id=$1 AND is_active=true', [tid])).rows[0].count);
    const alertProducts = parseInt((await pool.query('SELECT COUNT(*) FROM ecommerce_products WHERE tenant_id=$1 AND is_active=true AND stock_qty<=$2', [tid, threshold])).rows[0].count);
    res.json({
      summary: { total_products: totalProducts, alert_count: alertProducts, out_of_stock: outOfStock.length, low_stock: lowStock.length, threshold },
      out_of_stock: outOfStock,
      low_stock: lowStock,
      critical_items: critical,
    });
  }));

  // POST /store/alerts/reorder — Quick reorder endpoint
  app.post('/store/alerts/reorder', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const { product_id, quantity } = req.body;
    if (!product_id) return errRes(res, 400, 'Product ID required');
    const reorderQty = Math.max(1, parseInt(quantity) || 50);
    const p = (await pool.query('SELECT id,name,stock_qty FROM ecommerce_products WHERE id=$1 AND tenant_id=$2', [product_id, tid])).rows[0];
    if (!p) return errRes(res, 404, 'Product not found');
    await pool.query('UPDATE ecommerce_products SET stock_qty=stock_qty+$1,updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [reorderQty, product_id, tid]);
    const updated = (await pool.query('SELECT id,name,stock_qty FROM ecommerce_products WHERE id=$1', [product_id])).rows[0];
    wsBroadcast(tid, { type: 'ecommerce:product_restocked', productId: p.id, productName: p.name, addedQty: reorderQty, newQty: updated.stock_qty });
    res.json({ product_id: p.id, product_name: p.name, previous_qty: p.stock_qty, added_qty: reorderQty, new_qty: updated.stock_qty });
  }));

  // ═══════════════════════════════════════════════════════════
  // 11. COUPONS & PROMOTIONS — CRUD with validation
  // ═══════════════════════════════════════════════════════════
  app.get('/api/ecommerce/coupons', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    res.json((await pool.query('SELECT * FROM ecommerce_coupons WHERE tenant_id=$1 ORDER BY created_at DESC', [req.tenant.id])).rows);
  }));

  app.post('/api/ecommerce/coupons', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const { code, type, value, min_order, max_uses, starts_at, expires_at, is_active } = req.body;
    if (!code || !code.trim()) return errRes(res, 400, 'Code required');
    if (!['percentage', 'fixed'].includes(type)) return errRes(res, 400, 'Type: percentage or fixed');
    if (value <= 0) return errRes(res, 400, 'Value must be positive');
    if (type === 'percentage' && value > 100) return errRes(res, 400, 'Percentage max 100');
    const nc = code.trim().toUpperCase();
    if ((await pool.query('SELECT 1 FROM ecommerce_coupons WHERE code=$1 AND tenant_id=$2', [nc, tid])).rows.length)
      return errRes(res, 409, 'Code already exists');
    const r = await pool.query(
      `INSERT INTO ecommerce_coupons (tenant_id,code,type,value,min_order,max_uses,starts_at,expires_at,is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
      [tid, nc, type, parseFloat(value), parseFloat(min_order) || 0, parseInt(max_uses) || 0, starts_at || null, expires_at || null, is_active !== false]);
    res.status(201).json(r.rows[0]);
  }));

  app.put('/api/ecommerce/coupons/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.tenant.id;
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    if (!(await pool.query('SELECT 1 FROM ecommerce_coupons WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows.length)
      return errRes(res, 404, 'Coupon not found');
    const { code, type, value, min_order, max_uses, starts_at, expires_at, is_active } = req.body;
    const r = await pool.query(
      `UPDATE ecommerce_coupons SET code=$1,type=$2,value=$3,min_order=$4,max_uses=$5,starts_at=$6,expires_at=$7,is_active=$8 WHERE id=$9 AND tenant_id=$10 RETURNING *`,
      [(code || '').trim().toUpperCase(), type || 'percentage', parseFloat(value) || 0, parseFloat(min_order) || 0,
       parseInt(max_uses) || 0, starts_at || null, expires_at || null, is_active !== false, req.params.id, tid]);
    res.json(r.rows[0]);
  }));

  app.delete('/api/ecommerce/coupons/:id', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const r = await pool.query('DELETE FROM ecommerce_coupons WHERE id=$1 AND tenant_id=$2 RETURNING id', [req.params.id, req.tenant.id]);
    if (!r.rows.length) return errRes(res, 404, 'Coupon not found');
    res.json({ deleted: true });
  }));

  // ═══════════════════════════════════════════════════════════
  // 11. ANALYTICS — Sales, Revenue, Conversion, Products
  // ═══════════════════════════════════════════════════════════
  app.get('/api/ecommerce/analytics/overview', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const tid = req.tenant.id;
    res.json((await pool.query(
      `SELECT
        COUNT(*) FILTER(WHERE status!='cancelled') as total_orders,
        COUNT(*) FILTER(WHERE status='pending') as pending_orders,
        COUNT(*) FILTER(WHERE payment_status='paid') as paid_orders,
        COALESCE(SUM(total) FILTER(WHERE payment_status='paid'),0) as total_revenue,
        COALESCE(SUM(total) FILTER(WHERE payment_status='paid' AND created_at>=date_trunc('month',NOW())),0) as month_revenue,
        COALESCE(AVG(total) FILTER(WHERE payment_status='paid'),0) as avg_order_value,
        COUNT(DISTINCT user_id) as unique_customers,
        (SELECT COUNT(*) FROM ecommerce_products WHERE tenant_id=$1 AND is_active=true) as active_products,
        (SELECT COUNT(*) FROM ecommerce_coupons WHERE tenant_id=$1 AND is_active=true) as active_coupons
       FROM ecommerce_orders WHERE tenant_id=$1`, [tid])).rows[0]);
  }));

  app.get('/api/ecommerce/analytics/products', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const tid = req.tenant.id;
    const pf = { week: "'week'", month: "'month'", year: "'year'" }[req.query.period] || "'year'";
    const rows = (await pool.query(
      `SELECT oi.product_id,oi.product_name,SUM(oi.quantity) as units_sold,SUM(oi.subtotal) as revenue,COUNT(DISTINCT oi.order_id) as order_count
       FROM ecommerce_order_items oi JOIN ecommerce_orders o ON o.id=oi.order_id
       WHERE oi.tenant_id=$1 AND o.payment_status='paid' AND o.created_at>=date_trunc(${pf},NOW())
       GROUP BY oi.product_id,oi.product_name ORDER BY revenue DESC LIMIT 20`, [tid])).rows;
    res.json({ popular_products: rows, period: req.query.period || 'all' });
  }));

  app.get('/api/ecommerce/analytics/revenue', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const trunc = { week: 'day', month: 'month', year: 'month' }[req.query.period] || 'month';
    const rows = (await pool.query(
      `SELECT date_trunc($2,created_at) as period,COUNT(*) FILTER(WHERE payment_status='paid') as orders,
       COALESCE(SUM(total) FILTER(WHERE payment_status='paid'),0) as revenue
       FROM ecommerce_orders WHERE tenant_id=$1 AND created_at>=date_trunc($2,NOW())-INTERVAL '1 year'
       GROUP BY period ORDER BY period`, [req.tenant.id, trunc])).rows;
    res.json({ trend: rows, period: req.query.period || 'month' });
  }));

  app.get('/api/ecommerce/analytics/conversion', tenantMiddleware, requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    if (!isAdmin(req.user)) return errRes(res, 403, 'Admin only');
    const s = (await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM ecommerce_orders WHERE tenant_id=$1) as total_orders,
        (SELECT COUNT(*) FILTER(WHERE payment_status='paid') FROM ecommerce_orders WHERE tenant_id=$1) as completed,
        (SELECT COUNT(*) FILTER(WHERE payment_status='failed') FROM ecommerce_orders WHERE tenant_id=$1) as failed,
        (SELECT COUNT(*) FILTER(WHERE status='cancelled') FROM ecommerce_orders WHERE tenant_id=$1) as cancelled,
        (SELECT COALESCE(SUM(discount),0) FROM ecommerce_orders WHERE tenant_id=$1 AND payment_status='paid') as total_discounts,
        (SELECT AVG(r.rating) FROM ecommerce_reviews r WHERE r.tenant_id=$1 AND r.is_approved=true) as avg_rating,
        (SELECT COUNT(*) FROM ecommerce_reviews WHERE tenant_id=$1) as total_reviews
       FROM ecommerce_orders WHERE tenant_id=$1 LIMIT 1`, [req.tenant.id])).rows[0];
    s.conversion_rate = s.total_orders > 0 ? ((s.completed / s.total_orders) * 100).toFixed(1) + '%' : '0%';
    res.json(s);
  }));

  console.log('[E-Commerce] Module loaded — store, products, cart, orders, payments, shipping, reviews, coupons, analytics');
};
