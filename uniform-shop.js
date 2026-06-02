/**
 * Uniform Shop Module
 * Online school uniform and supplies store
 * Features: Product Catalog, Shopping Cart, Checkout, Order Management,
 *           Stock Management, Sales Reports with SVG charts
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const requireAdmin = opts.requireAdmin || ((req,res,next) => { if(!req.session?.user?.role||req.session.user.role!=='admin') return res.status(403).send('Access denied'); next(); });
  const audit = opts.audit || (() => {});
  const trackRevenue = global.trackRevenue || (() => {});
  const tenantId = opts.tenantId || 1;
  const CATEGORIES = ['shirts','skirts','trousers','blazers','pe_kit','ties','books','stationery','lab_coats','accessories'];
  const ORDER_STATUSES = ['pending','processing','ready','delivered'];
  const DELIVERY_METHODS = ['pickup','class_delivery'];
  const BRAND = '#4f46e5';
  const BRAND_LIGHT = '#eef2ff';
  const BRAND_DARK = '#3730a3';
  const SUCCESS = '#10b981';
  const WARNING = '#f59e0b';
  const DANGER = '#ef4444';

  // ─── Helper: ensure cart in session ───
  function getCart(req) {
    if (!req.session.shopCart) req.session.shopCart = [];
    return req.session.shopCart;
  }

  // ─── Helper: format currency ───
  function fmtMoney(n) {
    return '$' + Number(n||0).toFixed(2);
  }

  // ─── Helper: generate SVG bar chart ───
  function svgBarChart(data, opts2) {
    const w = opts2.width || 700;
    const h = opts2.height || 300;
    const pad = opts2.padding || 50;
    const barW = Math.min(40, Math.floor((w - pad * 2) / (data.length + 1)));
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const chartH = h - pad * 2;
    let bars = '';
    let labels = '';
    data.forEach((d, i) => {
      const x = pad + i * (barW + 10) + 10;
      const barH = Math.max(2, (d.value / maxVal) * chartH);
      const y = pad + chartH - barH;
      const color = d.color || BRAND;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="4"><title>${esc(d.label)}: ${d.display || d.value}</title></rect>`;
      bars += `<text x="${x + barW/2}" y="${y - 6}" text-anchor="middle" fill="#374151" font-size="11" font-weight="600">${d.display || d.value}</text>`;
      labels += `<text x="${x + barW/2}" y="${h - pad + 18}" text-anchor="middle" fill="#6b7280" font-size="10" transform="rotate(-30 ${x + barW/2} ${h - pad + 18})">${esc(String(d.label).substring(0,12))}</text>`;
    });
    // Y-axis gridlines
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad + (chartH / 4) * i;
      const val = maxVal - (maxVal / 4) * i;
      grid += `<line x1="${pad}" y1="${y}" x2="${w - 10}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="4"/>`;
      grid += `<text x="${pad - 6}" y="${y + 4}" text-anchor="end" fill="#9ca3af" font-size="10">${Math.round(val)}</text>`;
    }
    const title = opts2.title ? `<text x="${w/2}" y="24" text-anchor="middle" fill="#1f2937" font-size="14" font-weight="700">${esc(opts2.title)}</text>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="max-width:100%;height:auto;" role="img" aria-label="${esc(opts2.title || 'Bar chart')}">
      <rect width="${w}" height="${h}" fill="${BRAND_LIGHT}" rx="8"/>
      ${title}${grid}${bars}${labels}
    </svg>`;
  }

  // ─── Helper: generate SVG donut chart ───
  function svgDonutChart(data, opts2) {
    const size = opts2.size || 260;
    const cx = size / 2;
    const cy = size / 2;
    const r = opts2.radius || 90;
    const inner = opts2.innerRadius || 55;
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    let paths = '';
    let startAngle = -Math.PI / 2;
    const colors = [BRAND, SUCCESS, WARNING, DANGER, '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];
    data.forEach((d, i) => {
      const pct = d.value / total;
      const sweep = pct * Math.PI * 2;
      const endAngle = startAngle + sweep;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const ix1 = cx + inner * Math.cos(endAngle);
      const iy1 = cy + inner * Math.sin(endAngle);
      const ix2 = cx + inner * Math.cos(startAngle);
      const iy2 = cy + inner * Math.sin(startAngle);
      const large = sweep > Math.PI ? 1 : 0;
      const color = d.color || colors[i % colors.length];
      paths += `<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${ix1},${iy1} A${inner},${inner} 0 ${large},0 ${ix2},${iy2} Z" fill="${color}" stroke="white" stroke-width="2"><title>${esc(d.label)}: ${fmtMoney(d.value)} (${(pct*100).toFixed(1)}%)</title></path>`;
      startAngle = endAngle;
    });
    const title = opts2.title ? `<text x="${cx}" y="18" text-anchor="middle" fill="#1f2937" font-size="13" font-weight="700">${esc(opts2.title)}</text>` : '';
    const legend = data.map((d, i) => {
      const color = d.color || colors[i % colors.length];
      return `<rect x="6" y="${size + 10 + i * 18}" width="12" height="12" fill="${color}" rx="2"/><text x="22" y="${size + 21 + i * 18}" fill="#374151" font-size="10">${esc(d.label)} (${(d.value/total*100).toFixed(1)}%)</text>`;
    }).join('');
    const legendH = data.length * 18 + 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size + legendH}" style="max-width:100%;height:auto;" role="img" aria-label="${esc(opts2.title || 'Donut chart')}">
      ${title}${paths}${legend}
    </svg>`;
  }

  // ─── Helper: generate SVG line chart ───
  function svgLineChart(data, opts2) {
    const w = opts2.width || 700;
    const h = opts2.height || 280;
    const pad = 50;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const chartW = w - pad * 2;
    const chartH = h - pad * 2;
    const stepX = data.length > 1 ? chartW / (data.length - 1) : chartW;
    const points = data.map((d, i) => `${pad + i * stepX},${pad + chartH - (d.value / maxVal) * chartH}`).join(' ');
    const areaPoints = points + ` ${pad + (data.length - 1) * stepX},${pad + chartH} ${pad},${pad + chartH}`;
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad + (chartH / 4) * i;
      const val = maxVal - (maxVal / 4) * i;
      grid += `<line x1="${pad}" y1="${y}" x2="${w - 10}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="4"/>`;
      grid += `<text x="${pad - 6}" y="${y + 4}" text-anchor="end" fill="#9ca3af" font-size="10">${Math.round(val)}</text>`;
    }
    let dots = data.map((d, i) => {
      const cx = pad + i * stepX;
      const cy = pad + chartH - (d.value / maxVal) * chartH;
      return `<circle cx="${cx}" cy="${cy}" r="4" fill="${BRAND}" stroke="white" stroke-width="2"><title>${esc(d.label)}: ${d.display || d.value}</title></circle>`;
    }).join('');
    let xLabels = data.map((d, i) => {
      const x = pad + i * stepX;
      return `<text x="${x}" y="${h - pad + 18}" text-anchor="middle" fill="#6b7280" font-size="10">${esc(String(d.label).substring(0,8))}</text>`;
    }).join('');
    const title = opts2.title ? `<text x="${w/2}" y="24" text-anchor="middle" fill="#1f2937" font-size="14" font-weight="700">${esc(opts2.title)}</text>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="max-width:100%;height:auto;" role="img" aria-label="${esc(opts2.title || 'Line chart')}">
      <defs><linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${BRAND}" stop-opacity="0.3"/><stop offset="100%" stop-color="${BRAND}" stop-opacity="0.02"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="${BRAND_LIGHT}" rx="8"/>
      ${title}${grid}
      <polygon points="${areaPoints}" fill="url(#areaGrad)"/>
      <polyline points="${points}" fill="none" stroke="${BRAND}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}${xLabels}
    </svg>`;
  }

  // ─── Shared page wrapper ───
  function shopLayout(title, body, req) {
    const user = req.session?.user;
    const cart = getCart(req);
    const cartCount = cart.reduce((s, c) => s + c.qty, 0);
    const isAdmin = user && user.role === 'admin';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${esc(title)} — Uniform Shop</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}
        a{color:${BRAND};text-decoration:none}a:hover{text-decoration:underline}
        .container{max-width:1200px;margin:0 auto;padding:16px}
        .header{background:${BRAND};color:white;padding:16px 0;margin-bottom:24px;box-shadow:0 2px 8px rgba(0,0,0,0.1)}
        .header-inner{max-width:1200px;margin:0 auto;padding:0 16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
        .header h1{font-size:1.4rem;font-weight:700} .header a{color:white}
        .nav{display:flex;gap:16px;align-items:center;flex-wrap:wrap}
        .nav a{color:rgba(255,255,255,0.85);font-size:.9rem;padding:4px 0;border-bottom:2px solid transparent;transition:all .2s}
        .nav a:hover,.nav a.active{color:white;border-bottom-color:white;text-decoration:none}
        .badge{background:${DANGER};color:white;font-size:.7rem;padding:1px 6px;border-radius:10px;margin-left:4px}
        .card{background:white;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,0.08);padding:20px;margin-bottom:16px}
        .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
        .btn{display:inline-block;padding:8px 18px;border-radius:8px;font-weight:600;font-size:.85rem;border:none;cursor:pointer;transition:all .15s;text-align:center}
        .btn:hover{text-decoration:none}
        .btn-primary{background:${BRAND};color:white}.btn-primary:hover{background:${BRAND_DARK}}
        .btn-success{background:${SUCCESS};color:white}.btn-success:hover{background:#059669}
        .btn-danger{background:${DANGER};color:white}.btn-danger:hover{background:#dc2626}
        .btn-warning{background:${WARNING};color:white}.btn-warning:hover{background:#d97706}
        .btn-outline{background:transparent;color:${BRAND};border:2px solid ${BRAND}}.btn-outline:hover{background:${BRAND_LIGHT}}
        .btn-sm{padding:5px 12px;font-size:.8rem}
        .form-group{margin-bottom:14px}
        .form-group label{display:block;font-weight:600;margin-bottom:4px;color:#374151;font-size:.85rem}
        .form-group input,.form-group select,.form-group textarea{width:100%;padding:8px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:.9rem;transition:border-color .2s}
        .form-group input:focus,.form-group select:focus,.form-group textarea:focus{outline:none;border-color:${BRAND};box-shadow:0 0 0 3px ${BRAND_LIGHT}}
        .table-wrap{overflow-x:auto}
        table{width:100%;border-collapse:collapse;font-size:.85rem}
        th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb}
        th{background:${BRAND_LIGHT};color:${BRAND_DARK};font-weight:700;position:sticky;top:0}
        tr:hover{background:#f9fafb}
        .status{display:inline-block;padding:3px 10px;border-radius:12px;font-size:.75rem;font-weight:600}
        .status-pending{background:#fef3c7;color:#92400e}
        .status-processing{background:#dbeafe;color:#1e40af}
        .status-ready{background:#d1fae5;color:#065f46}
        .status-delivered{background:#e0e7ff;color:#3730a3}
        .stock-low{color:${DANGER};font-weight:700}
        .stock-ok{color:${SUCCESS}}
        .alert{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:.9rem}
        .alert-warn{background:#fef3c7;border:1px solid #f59e0b33;color:#92400e}
        .alert-info{background:#dbeafe;border:1px solid #3b82f633;color:#1e40af}
        .alert-success{background:#d1fae5;border:1px solid #10b98133;color:#065f46}
        .product-img{width:100%;height:140px;object-fit:cover;border-radius:8px;background:#e5e7eb}
        .product-card{text-align:left}
        .product-card h3{font-size:1rem;margin:8px 0 4px;color:#1e293b}
        .product-card .price{font-size:1.15rem;font-weight:700;color:${BRAND}}
        .product-card .stock-info{font-size:.8rem;margin-top:4px}
        .flex{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
        .muted{color:#6b7280;font-size:.85rem}
        .text-center{text-align:center}
        .mt-2{margin-top:16px}.mt-4{margin-top:24px}
        .empty-state{text-align:center;padding:48px 16px;color:#9ca3af}
        .empty-state svg{margin-bottom:12px}
        @media(max-width:640px){.grid{grid-template-columns:1fr 1fr}.header-inner{flex-direction:column;text-align:center}}
      </style></head><body>
      <header class="header" role="banner"><div class="header-inner">
        <h1 aria-label="Uniform Shop">🛍️ Uniform Shop</h1>
        <nav class="nav" role="navigation" aria-label="Main navigation">
          <a href="/shop" class="${(!req.path||req.path==='/shop')?'active':''}">Catalog</a>
          <a href="/shop/cart">Cart${cartCount>0?`<span class="badge" aria-label="${cartCount} items">${cartCount}</span>`:''}</a>
          <a href="/shop/orders">My Orders</a>
          ${isAdmin?'<a href="/shop/admin" class="active">Admin</a>':''}
          <a href="/shop/reports"${req.path==='/shop/reports'?' class="active"':''}>Reports</a>
        </nav>
      </div></header>
      <main class="container" role="main">${body}</main>
      <footer style="text-align:center;padding:24px;color:#9ca3af;font-size:.8rem;margin-top:32px;border-top:1px solid #e5e7eb">
        School Uniform Shop &copy; ${new Date().getFullYear()}
      </footer></body></html>`;
  }

  // ═══════════════════════════════════════════════════════
  // DATABASE INITIALIZATION
  // ═══════════════════════════════════════════════════════
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS shop_products (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        name VARCHAR(200) NOT NULL,
        category VARCHAR(50) NOT NULL,
        size_options JSONB DEFAULT '[]'::jsonb,
        price NUMERIC(10,2) NOT NULL DEFAULT 0,
        stock INT NOT NULL DEFAULT 0,
        reorder_level INT NOT NULL DEFAULT 10,
        image_url TEXT DEFAULT '',
        description TEXT DEFAULT '',
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await migrateQuery(pool, 'UniformShop', `
      CREATE TABLE IF NOT EXISTS shop_orders (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        user_id INT NOT NULL,
        student_name VARCHAR(200) NOT NULL DEFAULT '',
        parent_phone VARCHAR(30) NOT NULL DEFAULT '',
        delivery_method VARCHAR(30) NOT NULL DEFAULT 'pickup',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        total NUMERIC(10,2) NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await migrateQuery(pool, 'UniformShop', `
      CREATE TABLE IF NOT EXISTS shop_order_items (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        order_id INT NOT NULL REFERENCES shop_orders(id) ON DELETE CASCADE,
        product_id INT NOT NULL,
        product_name VARCHAR(200) NOT NULL,
        size VARCHAR(50) DEFAULT '',
        price NUMERIC(10,2) NOT NULL DEFAULT 0,
        quantity INT NOT NULL DEFAULT 1,
        subtotal NUMERIC(10,2) NOT NULL DEFAULT 0
      )`);
    await migrateQuery(pool, 'UniformShop', `
      CREATE TABLE IF NOT EXISTS shop_stock_history (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        product_id INT NOT NULL,
        change_type VARCHAR(20) NOT NULL DEFAULT 'sale',
        quantity INT NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        user_id INT DEFAULT NULL
      )`);
    // Indexes
    await migrateQuery(pool, 'UniformShop', `CREATE INDEX IF NOT EXISTS idx_sp_tenant ON shop_products(tenant_id)`);
    await migrateQuery(pool, 'UniformShop', `CREATE INDEX IF NOT EXISTS idx_so_tenant ON shop_orders(tenant_id)`);
    await migrateQuery(pool, 'UniformShop', `CREATE INDEX IF NOT EXISTS idx_soi_tenant ON shop_order_items(tenant_id)`);
    await migrateQuery(pool, 'UniformShop', `CREATE INDEX IF NOT EXISTS idx_ssh_tenant ON shop_stock_history(tenant_id)`);
    await migrateQuery(pool, 'UniformShop', `CREATE INDEX IF NOT EXISTS idx_so_user ON shop_orders(user_id)`);
    await migrateQuery(pool, 'UniformShop', `CREATE INDEX IF NOT EXISTS idx_so_status ON shop_orders(status)`);
  })();

  // ═══════════════════════════════════════════════════════
  // 1. PRODUCT CATALOG — PUBLIC BROWSING
  // ═══════════════════════════════════════════════════════

  // Shop home / catalog listing
  app.get('/shop', ah(async (req, res) => {
    const cat = req.query.category || '';
    const q = req.query.q || '';
    let where = 'WHERE p.tenant_id = $1 AND p.active = true';
    const params = [tenantId];
    let pi = 2;
    if (cat && CATEGORIES.includes(cat)) {
      where += ` AND p.category = $${pi++}`;
      params.push(cat);
    }
    if (q) {
      where += ` AND (p.name ILIKE $${pi} OR p.description ILIKE $${pi})`;
      params.push(`%${q}%`);
    }
    const { rows: products } = await pool.query(
      `SELECT p.* FROM shop_products p ${where} ORDER BY p.category, p.name`, params);
    const cart = getCart(req);
    // Group by category
    const grouped = {};
    products.forEach(p => {
      const sizes = (typeof p.size_options === 'string' ? JSON.parse(p.size_options) : p.size_options) || [];
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push({ ...p, size_options: sizes });
    });
    const catLabel = c => c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    let cards = '';
    for (const [cat2, items] of Object.entries(grouped)) {
      cards += `<h2 style="margin:24px 0 12px;color:${BRAND_DARK};font-size:1.2rem" id="cat-${esc(cat2)}">${esc(catLabel(cat2))}</h2><div class="grid">`;
      items.forEach(p => {
        const lowStock = p.stock <= p.reorder_level;
        cards += `<div class="card product-card" role="article" aria-label="${esc(p.name)}">
          ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" class="product-img" loading="lazy" onerror="this.style.display='none'">` :
          `<div class="product-img" style="display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:2rem">👕</div>`}
          <h3>${esc(p.name)}</h3>
          <p class="muted">${esc((p.description||'').substring(0,60))}</p>
          <p class="price">${fmtMoney(p.price)}</p>
          <p class="stock-info ${lowStock?'stock-low':'stock-ok'}">${p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</p>
          ${p.size_options && p.size_options.length > 0 ? `<p class="muted" style="font-size:.75rem">Sizes: ${p.size_options.map(s => esc(s)).join(', ')}</p>` : ''}
          <form method="POST" action="/shop/cart/add" style="margin-top:10px" aria-label="Add ${esc(p.name)} to cart">
            <input type="hidden" name="id" value="${p.id}">
            ${p.size_options && p.size_options.length > 0 ? `<select name="size" aria-label="Select size" style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:6px;margin-bottom:6px">
              <option value="">Select size</option>${p.size_options.map(s => `<option value="${esc(s)}">${esc(s)}</option>`).join('')}
            </select>` : ''}
            <div class="flex">
              <input type="number" name="qty" value="1" min="1" max="${p.stock}" aria-label="Quantity" style="width:60px;padding:6px;border:1px solid #d1d5db;border-radius:6px">
              <button type="submit" class="btn btn-primary btn-sm" ${p.stock < 1 ? 'disabled' : ''}>Add to Cart</button>
            </div>
          </form>
        </div>`;
      });
      cards += '</div>';
    }
    if (!products.length) {
      cards = `<div class="empty-state"><p style="font-size:3rem">🔍</p><p>No products found. Try a different search or category.</p></div>`;
    }
    const filters = `<div class="card" style="margin-bottom:20px">
      <form method="GET" action="/shop" class="flex" role="search" aria-label="Filter products">
        <input type="text" name="q" value="${esc(q)}" placeholder="Search products..." aria-label="Search" style="flex:1;padding:8px 12px;border:1.5px solid #d1d5db;border-radius:8px">
        <select name="category" aria-label="Category filter" style="padding:8px 12px;border:1.5px solid #d1d5db;border-radius:8px">
          <option value="">All Categories</option>
          ${CATEGORIES.map(c => `<option value="${c}" ${cat===c?'selected':''}>${catLabel(c)}</option>`).join('')}
        </select>
        <button type="submit" class="btn btn-primary btn-sm">Search</button>
        <a href="/shop" class="btn btn-outline btn-sm">Clear</a>
      </form>
    </div>`;
    const body = filters + cards;
    res.send(renderPage('Uniform Shop — Catalog', shopLayout('Shop Catalog', body, req), req.session?.user));
  }));

  // Single product detail
  app.get('/shop/product/:id', ah(async (req, res) => {
    const { rows: [p] } = await pool.query(
      `SELECT * FROM shop_products WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    if (!p) return res.status(404).send(renderPage('Not Found', shopLayout('Not Found', '<div class="empty-state"><p>Product not found.</p></div>', req), req.session?.user));
    const sizes = (typeof p.size_options === 'string' ? JSON.parse(p.size_options) : p.size_options) || [];
    const lowStock = p.stock <= p.reorder_level;
    const body = `<div class="card" style="max-width:600px;margin:0 auto">
      <h2 style="color:${BRAND}">${esc(p.name)}</h2>
      <p class="muted" style="margin-bottom:12px">Category: ${(p.category||'').replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</p>
      ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" style="width:100%;max-height:300px;object-fit:contain;border-radius:8px;margin-bottom:12px" onerror="this.style.display='none'">` : ''}
      <p style="font-size:2rem;font-weight:700;color:${BRAND};margin-bottom:8px">${fmtMoney(p.price)}</p>
      <p class="${lowStock?'stock-low':'stock-ok'}" style="font-weight:600">${p.stock > 0 ? `${p.stock} in stock` : 'Out of stock'}</p>
      <p style="margin:12px 0">${esc(p.description || 'No description available.')}</p>
      ${sizes.length > 0 ? `<p class="muted">Available sizes: <strong>${sizes.map(s=>esc(s)).join(', ')}</strong></p>` : ''}
      <form method="POST" action="/shop/cart/add" style="margin-top:16px" aria-label="Add to cart">
        <input type="hidden" name="id" value="${p.id}">
        <input type="hidden" name="redirect" value="/shop/product/${p.id}">
        ${sizes.length > 0 ? `<div class="form-group"><label for="sz">Select Size</label><select id="sz" name="size" style="padding:8px 12px;border:1.5px solid #d1d5db;border-radius:8px;width:100%">
          <option value="">Choose a size...</option>${sizes.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}
        </select></div>` : ''}
        <div class="flex"><div class="form-group" style="margin-bottom:0"><label for="qty">Quantity</label>
          <input type="number" id="qty" name="qty" value="1" min="1" max="${p.stock}" style="width:80px">
        </div>
        <button type="submit" class="btn btn-primary" style="margin-top:18px" ${p.stock<1?'disabled':''}>Add to Cart</button></div>
      </form>
    </div>`;
    res.send(renderPage(p.name, shopLayout(p.name, body, req), req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════
  // 2. SHOPPING CART — SESSION BASED
  // ═══════════════════════════════════════════════════════

  // Add to cart
  app.post('/shop/cart/add', ah(async (req, res) => {
    const pid = parseInt(req.body.id);
    const qty = Math.max(1, parseInt(req.body.qty) || 1);
    const size = req.body.size || '';
    const redirect = req.body.redirect || '/shop';
    const { rows: [product] } = await pool.query(
      `SELECT * FROM shop_products WHERE id = $1 AND tenant_id = $2 AND active = true`, [pid, tenantId]);
    if (!product) return res.redirect(redirect);
    if (size && product.size_options) {
      const sizes = (typeof product.size_options === 'string' ? JSON.parse(product.size_options) : product.size_options) || [];
      if (!sizes.includes(size)) return res.redirect(redirect);
    }
    const cart = getCart(req);
    const existing = cart.find(c => c.id === pid && c.size === size);
    if (existing) {
      existing.qty = Math.min(existing.qty + qty, product.stock);
    } else {
      cart.push({ id: pid, name: product.name, price: Number(product.price), size, qty: Math.min(qty, product.stock), image_url: product.image_url });
    }
    req.session.shopCart = cart;
    res.redirect('/shop/cart');
  }));

  // View cart
  app.get('/shop/cart', ah(async (req, res) => {
    const cart = getCart(req);
    if (!cart.length) {
      const body = `<div class="empty-state"><p style="font-size:3rem">🛒</p><h2>Your cart is empty</h2><p class="muted" style="margin-top:8px">Browse our catalog and add items to your cart.</p>
        <a href="/shop" class="btn btn-primary" style="margin-top:16px">Browse Catalog</a></div>`;
      return res.send(renderPage('Shopping Cart', shopLayout('Shopping Cart', body, req), req.session?.user));
    }
    let rows = '';
    let total = 0;
    cart.forEach((item, idx) => {
      const sub = item.price * item.qty;
      total += sub;
      rows += `<tr>
        <td>${idx + 1}</td>
        <td><strong>${esc(item.name)}</strong>${item.size ? `<br><span class="muted">Size: ${esc(item.size)}</span>` : ''}</td>
        <td>${fmtMoney(item.price)}</td>
        <td>
          <form method="POST" action="/shop/cart/update" style="display:flex;gap:4px" aria-label="Update quantity">
            <input type="hidden" name="idx" value="${idx}">
            <input type="number" name="qty" value="${item.qty}" min="1" max="99" style="width:60px;padding:4px;border:1px solid #d1d5db;border-radius:4px" aria-label="Quantity">
            <button type="submit" class="btn btn-primary btn-sm">Update</button>
          </form>
        </td>
        <td><strong>${fmtMoney(sub)}</strong></td>
        <td><form method="POST" action="/shop/cart/remove"><input type="hidden" name="idx" value="${idx}"><button type="submit" class="btn btn-danger btn-sm" aria-label="Remove ${esc(item.name)}">✕</button></form></td>
      </tr>`;
    });
    const body = `<div class="card">
      <h2 style="color:${BRAND};margin-bottom:16px">🛒 Shopping Cart (${cart.length} items)</h2>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th><th></th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td colspan="4" style="text-align:right;font-weight:700;font-size:1.1rem">Total:</td>
      <td colspan="2" style="font-weight:700;font-size:1.2rem;color:${BRAND}">${fmtMoney(total)}</td></tr></tfoot></table></div>
      <div class="flex mt-2" style="justify-content:space-between">
        <a href="/shop" class="btn btn-outline">Continue Shopping</a>
        <a href="/shop/checkout" class="btn btn-success">Proceed to Checkout →</a>
      </div>
    </div>`;
    res.send(renderPage('Shopping Cart', shopLayout('Shopping Cart', body, req), req.session?.user));
  }));

  // Update cart quantity
  app.post('/shop/cart/update', ah(async (req, res) => {
    const idx = parseInt(req.body.idx);
    const qty = Math.max(1, parseInt(req.body.qty) || 1);
    const cart = getCart(req);
    if (cart[idx]) {
      cart[idx].qty = qty;
      req.session.shopCart = cart;
    }
    res.redirect('/shop/cart');
  }));

  // Remove from cart
  app.post('/shop/cart/remove', ah(async (req, res) => {
    const idx = parseInt(req.body.idx);
    const cart = getCart(req);
    if (cart[idx]) {
      cart.splice(idx, 1);
      req.session.shopCart = cart;
    }
    res.redirect('/shop/cart');
  }));

  // ═══════════════════════════════════════════════════════
  // 3. CHECKOUT
  // ═══════════════════════════════════════════════════════

  app.get('/shop/checkout', requireAuth, ah(async (req, res) => {
    const cart = getCart(req);
    if (!cart.length) return res.redirect('/shop/cart');
    let rows = '';
    let total = 0;
    cart.forEach((item, idx) => {
      const sub = item.price * item.qty;
      total += sub;
      rows += `<tr><td>${esc(item.name)}${item.size ? ` (${esc(item.size)})` : ''}</td><td>${item.qty}</td><td>${fmtMoney(sub)}</td></tr>`;
    });
    const body = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;max-width:900px;margin:0 auto">
      <div class="card">
        <h2 style="color:${BRAND};margin-bottom:16px">📋 Order Summary</h2>
        <table><thead><tr><th>Item</th><th>Qty</th><th>Subtotal</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2" style="text-align:right;font-weight:700">Total:</td><td style="font-weight:700;color:${BRAND};font-size:1.1rem">${fmtMoney(total)}</td></tr></tfoot></table>
      </div>
      <div class="card">
        <h2 style="color:${BRAND};margin-bottom:16px">📦 Delivery Details</h2>
        <form method="POST" action="/shop/checkout" aria-label="Checkout form">
          <div class="form-group"><label for="student_name">Student Name *</label>
            <input type="text" id="student_name" name="student_name" required placeholder="Enter student's full name"></div>
          <div class="form-group"><label for="parent_phone">Parent/Guardian Phone *</label>
            <input type="tel" id="parent_phone" name="parent_phone" required placeholder="e.g. +254712345678"></div>
          <div class="form-group"><label for="delivery">Delivery Method *</label>
            <select id="delivery" name="delivery_method" required>
              <option value="pickup">Pickup at School Store</option>
              <option value="class_delivery">Deliver to Student's Class</option>
            </select></div>
          <div class="form-group"><label for="class_name">Class (for class delivery)</label>
            <input type="text" id="class_name" name="class_name" placeholder="e.g. Grade 7A"></div>
          <div class="form-group"><label for="notes">Additional Notes</label>
            <textarea id="notes" name="notes" rows="3" placeholder="Any special instructions..."></textarea></div>
          <button type="submit" class="btn btn-success" style="width:100%">Place Order — ${fmtMoney(total)}</button>
        </form>
      </div>
    </div>
    <style>@media(max-width:640px){div[style*="grid-template-columns"]{grid-template-columns:1fr!important}}</style>`;
    res.send(renderPage('Checkout', shopLayout('Checkout', body, req), req.session?.user));
  }));

  app.post('/shop/checkout', requireAuth, ah(async (req, res) => {
    const cart = getCart(req);
    if (!cart.length) return res.redirect('/shop/cart');
    const studentName = (req.body.student_name || '').trim();
    const parentPhone = (req.body.parent_phone || '').trim();
    const deliveryMethod = (req.body.delivery_method || 'pickup');
    const notes = (req.body.notes || '').trim();
    if (!studentName || !parentPhone) {
      return res.send(renderPage('Checkout Error', shopLayout('Checkout Error',
        `<div class="alert alert-warn">Please provide student name and parent phone number.</div><a href="/shop/checkout" class="btn btn-outline">← Back to Checkout</a>`, req), req.session?.user));
    }
    if (!DELIVERY_METHODS.includes(deliveryMethod)) {
      return res.status(400).send('Invalid delivery method');
    }
    // Calculate total
    let total = 0;
    cart.forEach(item => { total += item.price * item.qty; });
    // Verify stock for all items
    for (const item of cart) {
      const { rows: [prod] } = await pool.query(
        `SELECT stock FROM shop_products WHERE id = $1 AND tenant_id = $2`, [item.id, tenantId]);
      if (!prod || prod.stock < item.qty) {
        return res.send(renderPage('Checkout Error', shopLayout('Checkout Error',
          `<div class="alert alert-warn">Sorry, "${esc(item.name)}" does not have enough stock. Available: ${prod ? prod.stock : 0}.</div>
          <a href="/shop/cart" class="btn btn-outline">← Back to Cart</a>`, req), req.session?.user));
      }
    }
    const userId = req.session.user.id || req.session.user.sub || 0;
    // Create order
    const { rows: [order] } = await pool.query(
      `INSERT INTO shop_orders (tenant_id, user_id, student_name, parent_phone, delivery_method, status, total, notes)
       VALUES ($1,$2,$3,$4,$5,'pending',$6,$7) RETURNING id`, [tenantId, userId, studentName, parentPhone, deliveryMethod, total, notes]);
    // Create order items & deduct stock
    for (const item of cart) {
      const sub = item.price * item.qty;
      await pool.query(
        `INSERT INTO shop_order_items (tenant_id, order_id, product_id, product_name, size, price, quantity, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, [tenantId, order.id, item.id, item.name, item.size, item.price, item.qty, sub]);
      // Deduct stock
      await pool.query(
        `UPDATE shop_products SET stock = stock - $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
        [item.qty, item.id, tenantId]);
      // Record stock history
      await pool.query(
        `INSERT INTO shop_stock_history (tenant_id, product_id, change_type, quantity, notes, user_id)
         VALUES ($1,$2,'sale',$3,$4,$5)`, [tenantId, item.id, item.qty, `Order #${order.id}`, userId]);
    }
    // Track revenue
    trackRevenue({
      module: 'uniform-shop',
      tenant_id: tenantId,
      amount: total,
      user_id: userId,
      order_id: order.id,
      description: `Uniform shop order #${order.id}`
    });
    audit({ action: 'place_order', module: 'uniform-shop', order_id: order.id, total, user_id: userId });
    // Clear cart
    req.session.shopCart = [];
    const body = `<div class="card text-center" style="max-width:500px;margin:40px auto">
      <div style="font-size:3rem">✅</div>
      <h2 style="color:${SUCCESS};margin:12px 0">Order Placed Successfully!</h2>
      <p><strong>Order #${order.id}</strong></p>
      <p class="muted">Student: ${esc(studentName)}<br>Delivery: ${deliveryMethod === 'pickup' ? 'Pickup at School Store' : 'Deliver to Class'}</p>
      <p style="font-size:1.3rem;font-weight:700;color:${BRAND};margin:16px 0">Total: ${fmtMoney(total)}</p>
      <p class="muted">You will be notified when your order is ready.</p>
      <div class="flex mt-2" style="justify-content:center">
        <a href="/shop/orders" class="btn btn-primary">View My Orders</a>
        <a href="/shop" class="btn btn-outline">Continue Shopping</a>
      </div>
    </div>`;
    res.send(renderPage('Order Confirmed', shopLayout('Order Confirmed', body, req), req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════
  // 4. ORDER MANAGEMENT — USER & ADMIN VIEWS
  // ═══════════════════════════════════════════════════════

  // User order history
  app.get('/shop/orders', requireAuth, ah(async (req, res) => {
    const userId = req.session.user.id || req.session.user.sub || 0;
    const { rows: orders } = await pool.query(
      `SELECT * FROM shop_orders WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC`, [tenantId, userId]);
    if (!orders.length) {
      const body = `<div class="empty-state"><p style="font-size:3rem">📋</p><h2>No orders yet</h2><p class="muted">Your order history will appear here.</p>
        <a href="/shop" class="btn btn-primary" style="margin-top:16px">Start Shopping</a></div>`;
      return res.send(renderPage('My Orders', shopLayout('My Orders', body, req), req.session?.user));
    }
    let rows = '';
    orders.forEach(o => {
      rows += `<tr>
        <td><strong>#${o.id}</strong></td>
        <td>${esc(o.student_name)}</td>
        <td>${o.delivery_method === 'pickup' ? 'Store Pickup' : 'Class Delivery'}</td>
        <td><span class="status status-${o.status}">${o.status.toUpperCase()}</span></td>
        <td><strong>${fmtMoney(o.total)}</strong></td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
        <td><a href="/shop/orders/${o.id}" class="btn btn-outline btn-sm" aria-label="View order ${o.id}">View</a></td>
      </tr>`;
    });
    const body = `<div class="card"><h2 style="color:${BRAND};margin-bottom:16px">📋 My Orders (${orders.length})</h2>
      <div class="table-wrap"><table><thead><tr><th>Order</th><th>Student</th><th>Delivery</th><th>Status</th><th>Total</th><th>Date</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
    res.send(renderPage('My Orders', shopLayout('My Orders', body, req), req.session?.user));
  }));

  // View single order
  app.get('/shop/orders/:id', requireAuth, ah(async (req, res) => {
    const userId = req.session.user.id || req.session.user.sub || 0;
    const isAdmin = req.session.user.role === 'admin';
    const { rows: [order] } = await pool.query(
      `SELECT * FROM shop_orders WHERE id = $1 AND tenant_id = $2 ${isAdmin ? '' : 'AND user_id = $3'}`,
      isAdmin ? [req.params.id, tenantId] : [req.params.id, tenantId, userId]);
    if (!order) return res.status(404).send('Order not found');
    const { rows: items } = await pool.query(
      `SELECT * FROM shop_order_items WHERE order_id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    let itemRows = '';
    items.forEach(i => {
      itemRows += `<tr><td>${esc(i.product_name)}${i.size ? ` (${esc(i.size)})` : ''}</td><td>${i.quantity}</td><td>${fmtMoney(i.price)}</td><td><strong>${fmtMoney(i.subtotal)}</strong></td></tr>`;
    });
    const statusSteps = ORDER_STATUSES.map(s => {
      const idx = ORDER_STATUSES.indexOf(s);
      const currentIdx = ORDER_STATUSES.indexOf(order.status);
      const active = idx <= currentIdx;
      const current = s === order.status;
      return `<div style="text-align:center;flex:1">
        <div style="width:32px;height:32px;border-radius:50%;margin:0 auto 4px;display:flex;align-items:center;justify-content:center;font-weight:700;
          background:${active ? BRAND : '#e5e7eb'};color:${active ? 'white' : '#9ca3af'};${current?'box-shadow:0 0 0 4px '+BRAND_LIGHT:''}">
          ${idx + 1}</div>
        <span style="font-size:.75rem;color:${current ? BRAND : '#9ca3af'};font-weight:${current?'700':'400'}">${s.toUpperCase()}</span>
      </div>`;
    }).join('<div style="flex:.5;height:2px;background:#e5e7eb;margin-bottom:20px;margin-top:16px"></div>');
    const body = `<div class="card" style="max-width:700px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:20px">
        <h2 style="color:${BRAND}">Order #${order.id}</h2>
        <span class="status status-${order.status}">${order.status.toUpperCase()}</span>
      </div>
      <div style="display:flex;align-items:flex-start;margin-bottom:20px">${statusSteps}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;font-size:.85rem">
        <div><span class="muted">Student:</span> <strong>${esc(order.student_name)}</strong></div>
        <div><span class="muted">Phone:</span> <strong>${esc(order.parent_phone)}</strong></div>
        <div><span class="muted">Delivery:</span> <strong>${order.delivery_method === 'pickup' ? 'Store Pickup' : 'Class Delivery'}</strong></div>
        <div><span class="muted">Placed:</span> <strong>${new Date(order.created_at).toLocaleString()}</strong></div>
      </div>
      ${order.notes ? `<div class="alert alert-info" style="margin-bottom:16px"><strong>Notes:</strong> ${esc(order.notes)}</div>` : ''}
      <h3 style="margin-bottom:8px">Items</h3>
      <div class="table-wrap"><table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
      <tbody>${itemRows}</tbody>
      <tfoot><tr><td colspan="3" style="text-align:right;font-weight:700;font-size:1.1rem">Total:</td>
      <td style="font-weight:700;color:${BRAND};font-size:1.2rem">${fmtMoney(order.total)}</td></tr></tfoot></table></div>
    </div>`;
    res.send(renderPage(`Order #${order.id}`, shopLayout(`Order #${order.id}`, body, req), req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════
  // 5. ADMIN — ORDER MANAGEMENT
  // ═══════════════════════════════════════════════════════

  // Admin orders list
  app.get('/shop/admin/orders', requireAdmin, ah(async (req, res) => {
    const status = req.query.status || '';
    let where = 'WHERE o.tenant_id = $1';
    const params = [tenantId];
    if (status && ORDER_STATUSES.includes(status)) {
      where += ` AND o.status = $2`;
      params.push(status);
    }
    const { rows: orders } = await pool.query(
      `SELECT o.*, (SELECT COUNT(*) FROM shop_order_items WHERE order_id = o.id) as item_count
       FROM shop_orders o ${where} ORDER BY o.created_at DESC`, params);
    let rows = '';
    orders.forEach(o => {
      rows += `<tr>
        <td><strong>#${o.id}</strong></td>
        <td>${esc(o.student_name)}</td>
        <td>${o.item_count} item(s)</td>
        <td>${o.delivery_method === 'pickup' ? 'Store Pickup' : 'Class Delivery'}</td>
        <td><span class="status status-${o.status}">${o.status.toUpperCase()}</span></td>
        <td><strong>${fmtMoney(o.total)}</strong></td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
        <td>
          <form method="POST" action="/shop/admin/orders/${o.id}/status" style="display:inline" aria-label="Update order status">
            <select name="status" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:4px;font-size:.8rem">
              ${ORDER_STATUSES.map(s => `<option value="${s}" ${o.status===s?'selected':''}>${s}</option>`).join('')}
            </select>
            <button type="submit" class="btn btn-primary btn-sm">Update</button>
          </form>
          <a href="/shop/orders/${o.id}" class="btn btn-outline btn-sm" aria-label="View order">View</a>
        </td>
      </tr>`;
    });
    const body = `<div class="card">
      <h2 style="color:${BRAND};margin-bottom:16px">📦 All Orders (${orders.length})</h2>
      <form method="GET" action="/shop/admin/orders" class="flex mb-2" style="margin-bottom:12px">
        <select name="status" style="padding:8px 12px;border:1.5px solid #d1d5db;border-radius:8px">
          <option value="">All Statuses</option>
          ${ORDER_STATUSES.map(s=>`<option value="${s}" ${status===s?'selected':''}>${s}</option>`).join('')}
        </select>
        <button type="submit" class="btn btn-primary btn-sm">Filter</button>
        <a href="/shop/admin/orders" class="btn btn-outline btn-sm">Clear</a>
      </form>
      ${orders.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Student</th><th>Items</th><th>Delivery</th><th>Status</th><th>Total</th><th>Date</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<div class="empty-state"><p>No orders found.</p></div>'}
    </div>`;
    res.send(renderPage('Admin Orders', shopLayout('Admin — Orders', body, req), req.session?.user));
  }));

  // Update order status
  app.post('/shop/admin/orders/:id/status', requireAdmin, ah(async (req, res) => {
    const oid = parseInt(req.params.id);
    const newStatus = req.body.status;
    if (!ORDER_STATUSES.includes(newStatus)) return res.status(400).send('Invalid status');
    const { rows: [order] } = await pool.query(
      `SELECT * FROM shop_orders WHERE id = $1 AND tenant_id = $2`, [oid, tenantId]);
    if (!order) return res.status(404).send('Order not found');
    await pool.query(
      `UPDATE shop_orders SET status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      [newStatus, oid, tenantId]);
    audit({ action: 'update_order_status', module: 'uniform-shop', order_id: oid, old_status: order.status, new_status: newStatus, user_id: req.session.user.id });
    res.redirect('/shop/admin/orders');
  }));

  // ═══════════════════════════════════════════════════════
  // 6. ADMIN — PRODUCT CRUD
  // ═══════════════════════════════════════════════════════

  // Admin product list
  app.get('/shop/admin/products', requireAdmin, ah(async (req, res) => {
    const { rows: products } = await pool.query(
      `SELECT * FROM shop_products WHERE tenant_id = $1 ORDER BY category, name`, [tenantId]);
    let rows = '';
    products.forEach(p => {
      const low = p.stock <= p.reorder_level;
      rows += `<tr>
        <td><strong>${esc(p.name)}</strong></td>
        <td>${(p.category||'').replace(/_/g,' ')}</td>
        <td>${fmtMoney(p.price)}</td>
        <td class="${low?'stock-low':'stock-ok'}">${p.stock} / ${p.reorder_level}</td>
        <td>${p.active ? '<span class="status status-ready">Active</span>' : '<span class="status status-pending">Inactive</span>'}</td>
        <td>
          <a href="/shop/admin/products/${p.id}/edit" class="btn btn-outline btn-sm">Edit</a>
          <form method="POST" action="/shop/admin/products/${p.id}/toggle" style="display:inline">
            <button type="submit" class="btn btn-sm ${p.active ? 'btn-warning' : 'btn-success'}">${p.active ? 'Disable' : 'Enable'}</button>
          </form>
        </td>
      </tr>`;
    });
    const body = `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:16px">
        <h2 style="color:${BRAND}">🏷️ Products (${products.length})</h2>
        <a href="/shop/admin/products/new" class="btn btn-success">+ Add Product</a>
      </div>
      ${products.length ? `<div class="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock / Reorder</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows}</tbody></table></div>` : '<div class="empty-state"><p>No products yet.</p></div>'}
    </div>`;
    res.send(renderPage('Admin Products', shopLayout('Admin — Products', body, req), req.session?.user));
  }));

  // Add product form
  app.get('/shop/admin/products/new', requireAdmin, ah(async (req, res) => {
    const catLabel = c => c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const body = `<div class="card" style="max-width:600px;margin:0 auto">
      <h2 style="color:${BRAND};margin-bottom:20px">➕ Add New Product</h2>
      <form method="POST" action="/shop/admin/products" aria-label="Create product">
        <div class="form-group"><label for="name">Product Name *</label>
          <input type="text" id="name" name="name" required placeholder="e.g. White School Shirt"></div>
        <div class="form-group"><label for="category">Category *</label>
          <select id="category" name="category" required>
            ${CATEGORIES.map(c => `<option value="${c}">${catLabel(c)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label for="size_opts">Size Options (comma-separated)</label>
          <input type="text" id="size_opts" name="size_options" placeholder="e.g. S, M, L, XL or leave blank for no sizes"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group"><label for="price">Price ($) *</label>
            <input type="number" id="price" name="price" step="0.01" min="0" required placeholder="0.00"></div>
          <div class="form-group"><label for="stock">Stock *</label>
            <input type="number" id="stock" name="stock" min="0" required placeholder="0"></div>
        </div>
        <div class="form-group"><label for="reorder">Reorder Level</label>
          <input type="number" id="reorder" name="reorder_level" min="0" value="10" placeholder="10"></div>
        <div class="form-group"><label for="img">Image URL</label>
          <input type="url" id="img" name="image_url" placeholder="https://..."></div>
        <div class="form-group"><label for="desc">Description</label>
          <textarea id="desc" name="description" rows="3" placeholder="Product description..."></textarea></div>
        <div class="flex mt-2">
          <button type="submit" class="btn btn-success">Create Product</button>
          <a href="/shop/admin/products" class="btn btn-outline">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage('Add Product', shopLayout('Add Product', body, req), req.session?.user));
  }));

  // Create product
  app.post('/shop/admin/products', requireAdmin, ah(async (req, res) => {
    const name = (req.body.name || '').trim();
    const category = req.body.category || 'accessories';
    const sizeOptions = req.body.size_options ? req.body.size_options.split(',').map(s => s.trim()).filter(Boolean) : [];
    const price = parseFloat(req.body.price) || 0;
    const stock = parseInt(req.body.stock) || 0;
    const reorderLevel = parseInt(req.body.reorder_level) || 10;
    const imageUrl = (req.body.image_url || '').trim();
    const description = (req.body.description || '').trim();
    if (!name) return res.status(400).send('Product name is required');
    await pool.query(
      `INSERT INTO shop_products (tenant_id, name, category, size_options, price, stock, reorder_level, image_url, description)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tenantId, name, category, JSON.stringify(sizeOptions), price, stock, reorderLevel, imageUrl, description]);
    audit({ action: 'create_product', module: 'uniform-shop', product_name: name, user_id: req.session.user.id });
    res.redirect('/shop/admin/products');
  }));

  // Edit product form
  app.get('/shop/admin/products/:id/edit', requireAdmin, ah(async (req, res) => {
    const { rows: [p] } = await pool.query(
      `SELECT * FROM shop_products WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    if (!p) return res.status(404).send('Product not found');
    const sizes = (typeof p.size_options === 'string' ? JSON.parse(p.size_options) : p.size_options) || [];
    const catLabel = c => c.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
    const body = `<div class="card" style="max-width:600px;margin:0 auto">
      <h2 style="color:${BRAND};margin-bottom:20px">✏️ Edit Product: ${esc(p.name)}</h2>
      <form method="POST" action="/shop/admin/products/${p.id}" aria-label="Edit product">
        <div class="form-group"><label for="name">Product Name *</label>
          <input type="text" id="name" name="name" required value="${esc(p.name)}"></div>
        <div class="form-group"><label for="category">Category *</label>
          <select id="category" name="category" required>
            ${CATEGORIES.map(c => `<option value="${c}" ${p.category===c?'selected':''}>${catLabel(c)}</option>`).join('')}
          </select></div>
        <div class="form-group"><label for="size_opts">Size Options (comma-separated)</label>
          <input type="text" id="size_opts" name="size_options" value="${sizes.map(s=>esc(s)).join(', ')}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div class="form-group"><label for="price">Price ($) *</label>
            <input type="number" id="price" name="price" step="0.01" min="0" required value="${p.price}"></div>
          <div class="form-group"><label for="stock">Stock *</label>
            <input type="number" id="stock" name="stock" min="0" required value="${p.stock}"></div>
        </div>
        <div class="form-group"><label for="reorder">Reorder Level</label>
          <input type="number" id="reorder" name="reorder_level" min="0" value="${p.reorder_level}"></div>
        <div class="form-group"><label for="img">Image URL</label>
          <input type="url" id="img" name="image_url" value="${esc(p.image_url || '')}"></div>
        <div class="form-group"><label for="desc">Description</label>
          <textarea id="desc" name="description" rows="3">${esc(p.description || '')}</textarea></div>
        <div class="flex mt-2">
          <button type="submit" class="btn btn-success">Save Changes</button>
          <a href="/shop/admin/products" class="btn btn-outline">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage('Edit Product', shopLayout('Edit Product', body, req), req.session?.user));
  }));

  // Update product
  app.post('/shop/admin/products/:id', requireAdmin, ah(async (req, res) => {
    const pid = parseInt(req.params.id);
    const name = (req.body.name || '').trim();
    const category = req.body.category || 'accessories';
    const sizeOptions = req.body.size_options ? req.body.size_options.split(',').map(s => s.trim()).filter(Boolean) : [];
    const price = parseFloat(req.body.price) || 0;
    const stock = parseInt(req.body.stock) || 0;
    const reorderLevel = parseInt(req.body.reorder_level) || 10;
    const imageUrl = (req.body.image_url || '').trim();
    const description = (req.body.description || '').trim();
    if (!name) return res.status(400).send('Name required');
    const { rows: [old] } = await pool.query(`SELECT stock FROM shop_products WHERE id = $1 AND tenant_id = $2`, [pid, tenantId]);
    await pool.query(
      `UPDATE shop_products SET name=$1, category=$2, size_options=$3, price=$4, stock=$5, reorder_level=$6, image_url=$7, description=$8, updated_at=NOW()
       WHERE id=$9 AND tenant_id=$10`,
      [name, category, JSON.stringify(sizeOptions), price, stock, reorderLevel, imageUrl, description, pid, tenantId]);
    // Log stock change
    if (old && old.stock !== stock) {
      const diff = stock - old.stock;
      await pool.query(
        `INSERT INTO shop_stock_history (tenant_id, product_id, change_type, quantity, notes, user_id)
         VALUES ($1,$2,'adjustment',$3,$4,$5)`,
        [tenantId, pid, Math.abs(diff), `Stock adjusted from ${old.stock} to ${stock}`, req.session.user.id]);
    }
    audit({ action: 'update_product', module: 'uniform-shop', product_id: pid, user_id: req.session.user.id });
    res.redirect('/shop/admin/products');
  }));

  // Toggle product active/inactive
  app.post('/shop/admin/products/:id/toggle', requireAdmin, ah(async (req, res) => {
    const pid = parseInt(req.params.id);
    await pool.query(
      `UPDATE shop_products SET active = NOT active, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`, [pid, tenantId]);
    audit({ action: 'toggle_product', module: 'uniform-shop', product_id: pid, user_id: req.session.user.id });
    res.redirect('/shop/admin/products');
  }));

  // ═══════════════════════════════════════════════════════
  // 7. STOCK MANAGEMENT
  // ═══════════════════════════════════════════════════════

  // Stock dashboard with low stock alerts
  app.get('/shop/admin/stock', requireAdmin, ah(async (req, res) => {
    // Low stock products
    const { rows: lowStock } = await pool.query(
      `SELECT * FROM shop_products WHERE tenant_id = $1 AND active = true AND stock <= reorder_level ORDER BY stock ASC`, [tenantId]);
    // All products stock overview
    const { rows: allProducts } = await pool.query(
      `SELECT * FROM shop_products WHERE tenant_id = $1 ORDER BY category, name`, [tenantId]);
    // Recent stock history
    const { rows: history } = await pool.query(
      `SELECT sh.*, p.name as product_name FROM shop_stock_history sh
       JOIN shop_products p ON p.id = sh.product_id
       WHERE sh.tenant_id = $1 ORDER BY sh.created_at DESC LIMIT 50`, [tenantId]);
    // Low stock alerts
    let alerts = '';
    if (lowStock.length) {
      alerts = `<div class="alert alert-warn">⚠️ <strong>${lowStock.length} product(s) are at or below reorder level:</strong>
        ${lowStock.map(p => `<span style="margin-left:8px">${esc(p.name)} (${p.stock}/${p.reorder_level})</span>`).join(', ')}</div>`;
    }
    // Products table
    let rows = '';
    allProducts.forEach(p => {
      const low = p.stock <= p.reorder_level;
      const pct = p.reorder_level > 0 ? Math.min(100, (p.stock / p.reorder_level) * 100) : (p.stock > 0 ? 100 : 0);
      const barColor = pct <= 25 ? DANGER : pct <= 75 ? WARNING : SUCCESS;
      rows += `<tr>
        <td><strong>${esc(p.name)}</strong></td>
        <td>${(p.category||'').replace(/_/g,' ')}</td>
        <td>
          <div style="display:flex;align-items:center;gap:8px">
            <div style="width:80px;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden">
              <div style="width:${pct}%;height:100%;background:${barColor};border-radius:4px" role="progressbar" aria-valuenow="${p.stock}" aria-valuemin="0" aria-valuemax="${p.reorder_level}"></div>
            </div>
            <span class="${low?'stock-low':'stock-ok'}" style="font-weight:600">${p.stock}</span>
            <span class="muted">/ ${p.reorder_level}</span>
          </div>
        </td>
        <td>
          <form method="POST" action="/shop/admin/stock/restock" style="display:flex;gap:4px" aria-label="Restock ${esc(p.name)}">
            <input type="hidden" name="id" value="${p.id}">
            <input type="number" name="qty" value="${p.reorder_level - p.stock}" min="1" style="width:60px;padding:4px;border:1px solid #d1d5db;border-radius:4px" aria-label="Restock quantity">
            <button type="submit" class="btn btn-success btn-sm">Restock</button>
          </form>
        </td>
      </tr>`;
    });
    // Stock history table
    let histRows = '';
    history.forEach(h => {
      const typeLabel = h.change_type === 'sale' ? '🔴 Sold' : h.change_type === 'restock' ? '🟢 Restocked' : '🔄 Adjusted';
      histRows += `<tr>
        <td>${esc(h.product_name)}</td>
        <td>${typeLabel}</td>
        <td>${h.quantity}</td>
        <td class="muted">${esc(h.notes || '')}</td>
        <td class="muted">${new Date(h.created_at).toLocaleString()}</td>
      </tr>`;
    });
    const body = `${alerts}
      <div class="card">
        <h2 style="color:${BRAND};margin-bottom:16px">📊 Stock Levels</h2>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Stock Level</th><th>Quick Restock</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
      </div>
      <div class="card">
        <h2 style="color:${BRAND};margin-bottom:16px">📜 Stock History (Last 50)</h2>
        ${history.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Type</th><th>Qty</th><th>Notes</th><th>Date</th></tr></thead>
        <tbody>${histRows}</tbody></table></div>` : '<div class="empty-state"><p>No stock history yet.</p></div>'}
      </div>`;
    res.send(renderPage('Stock Management', shopLayout('Admin — Stock', body, req), req.session?.user));
  }));

  // Quick restock
  app.post('/shop/admin/stock/restock', requireAdmin, ah(async (req, res) => {
    const pid = parseInt(req.body.id);
    const qty = Math.max(1, parseInt(req.body.qty) || 0);
    await pool.query(
      `UPDATE shop_products SET stock = stock + $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, [qty, pid, tenantId]);
    await pool.query(
      `INSERT INTO shop_stock_history (tenant_id, product_id, change_type, quantity, notes, user_id)
       VALUES ($1,$2,'restock',$3,$4,$5)`, [tenantId, pid, qty, 'Manual restock', req.session.user.id]);
    audit({ action: 'restock', module: 'uniform-shop', product_id: pid, quantity: qty, user_id: req.session.user.id });
    res.redirect('/shop/admin/stock');
  }));

  // ═══════════════════════════════════════════════════════
  // 8. SALES REPORTS WITH SVG CHARTS
  // ═══════════════════════════════════════════════════════

  app.get('/shop/reports', requireAuth, ah(async (req, res) => {
    const isAdmin = req.session.user.role === 'admin';
    const period = req.query.period || 'daily';
    // Revenue by category (donut chart)
    const { rows: catRevenue } = await pool.query(
      `SELECT p.category, SUM(oi.subtotal) as revenue, SUM(oi.quantity) as qty_sold
       FROM shop_order_items oi
       JOIN shop_products p ON p.id = oi.product_id
       JOIN shop_orders o ON o.id = oi.order_id
       WHERE oi.tenant_id = $1 AND o.status != 'pending'
       GROUP BY p.category ORDER BY revenue DESC`, [tenantId]);
    const catLabel = c => (c||'other').replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase());
    const donutData = catRevenue.map(r => ({ label: catLabel(r.category), value: Number(r.revenue) || 0 }));
    const donutSvg = donutData.length ? svgDonutChart(donutData, { title: 'Revenue by Category' }) : '<p class="muted">No sales data yet.</p>';
    // Top sellers (bar chart)
    const { rows: topSellers } = await pool.query(
      `SELECT oi.product_name, SUM(oi.quantity) as total_qty, SUM(oi.subtotal) as total_rev
       FROM shop_order_items oi
       JOIN shop_orders o ON o.id = oi.order_id
       WHERE oi.tenant_id = $1 AND o.status != 'pending'
       GROUP BY oi.product_name ORDER BY total_qty DESC LIMIT 10`, [tenantId]);
    const barData = topSellers.map(r => ({ label: r.product_name, value: Number(r.total_qty) || 0, display: `${Number(r.total_qty)} pcs` }));
    const barSvg = barData.length ? svgBarChart(barData, { title: 'Top 10 Best Sellers (by quantity)', height: 320 }) : '<p class="muted">No sales data yet.</p>';
    // Time-series sales
    let timeCol, timeFmt;
    if (period === 'daily') {
      timeCol = `TO_CHAR(o.created_at, 'Mon DD')`;
      timeFmt = 'day';
    } else if (period === 'weekly') {
      timeCol = `'W' || TO_CHAR(o.created_at, 'IW") || ' ' || TO_CHAR(o.created_at, '"Mon YY')`;
      timeFmt = 'week';
    } else {
      timeCol = `TO_CHAR(o.created_at, 'Mon YYYY')`;
      timeFmt = 'month';
    }
    const { rows: timeData } = await pool.query(
      `SELECT ${timeCol} as period, SUM(o.total) as revenue, COUNT(*) as orders
       FROM shop_orders o WHERE o.tenant_id = $1 AND o.status != 'pending'
       GROUP BY period ORDER BY MIN(o.created_at) DESC LIMIT 14`, [tenantId]);
    timeData.reverse();
    const lineData = timeData.map(r => ({ label: r.period, value: Number(r.revenue) || 0, display: fmtMoney(r.revenue) }));
    const lineSvg = lineData.length ? svgLineChart(lineData, { title: `Sales Trend (${timeFmt})` }) : '<p class="muted">No sales data yet.</p>';
    // Summary stats
    const { rows: [{ total_orders, total_revenue, avg_order }] } = await pool.query(
      `SELECT COUNT(*) as total_orders, COALESCE(SUM(total),0) as total_revenue,
       COALESCE(AVG(total),0) as avg_order FROM shop_orders WHERE tenant_id = $1 AND status != 'pending'`, [tenantId]);
    // Pending orders count
    const { rows: [{ pending }] } = await pool.query(
      `SELECT COUNT(*) as pending FROM shop_orders WHERE tenant_id = $1 AND status = 'pending'`, [tenantId]);
    // Low stock count
    const { rows: [{ low_stock }] } = await pool.query(
      `SELECT COUNT(*) as low_stock FROM shop_products WHERE tenant_id = $1 AND active = true AND stock <= reorder_level`, [tenantId]);

    const body = `
      <!-- Summary Cards -->
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(160px,1fr));margin-bottom:24px">
        <div class="card text-center"><p style="font-size:1.8rem;font-weight:700;color:${BRAND}">${Number(total_orders||0)}</p><p class="muted">Total Orders</p></div>
        <div class="card text-center"><p style="font-size:1.8rem;font-weight:700;color:${SUCCESS}">${fmtMoney(total_revenue)}</p><p class="muted">Total Revenue</p></div>
        <div class="card text-center"><p style="font-size:1.8rem;font-weight:700;color:${BRAND_DARK}">${fmtMoney(avg_order)}</p><p class="muted">Avg Order Value</p></div>
        <div class="card text-center"><p style="font-size:1.8rem;font-weight:700;color:${WARNING}">${pending}</p><p class="muted">Pending Orders</p></div>
        ${isAdmin ? `<div class="card text-center"><p style="font-size:1.8rem;font-weight:700;color:${DANGER}">${low_stock}</p><p class="muted">Low Stock Items</p></div>` : ''}
      </div>
      <!-- Period toggle -->
      <div class="card" style="margin-bottom:20px">
        <form method="GET" action="/shop/reports" class="flex" aria-label="Select report period">
          <strong style="margin-right:8px">Sales Trend Period:</strong>
          ${['daily','weekly','monthly'].map(p => `<label style="margin-right:12px;cursor:pointer"><input type="radio" name="period" value="${p}" ${period===p?'checked':''} style="margin-right:4px"> ${p}</label>`).join('')}
          <button type="submit" class="btn btn-primary btn-sm">Update</button>
        </form>
      </div>
      <!-- Charts -->
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <div class="card">${donutSvg}</div>
        <div class="card">${barSvg}</div>
      </div>
      <div class="card" style="margin-bottom:20px">${lineSvg}</div>
      <!-- Top sellers table -->
      ${topSellers.length ? `<div class="card">
        <h2 style="color:${BRAND};margin-bottom:12px">🏆 Top Sellers Detail</h2>
        <div class="table-wrap"><table><thead><tr><th>#</th><th>Product</th><th>Qty Sold</th><th>Revenue</th></tr></thead><tbody>
        ${topSellers.map((s, i) => `<tr><td>${i+1}</td><td><strong>${esc(s.product_name)}</strong></td>
          <td>${s.total_qty} pcs</td><td style="color:${SUCCESS};font-weight:600">${fmtMoney(s.total_rev)}</td></tr>`).join('')}
        </tbody></table></div>
      </div>` : ''}
      <!-- Category breakdown -->
      ${catRevenue.length ? `<div class="card">
        <h2 style="color:${BRAND};margin-bottom:12px">📂 Category Breakdown</h2>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Revenue</th><th>Units Sold</th></tr></thead><tbody>
        ${catRevenue.map(r => `<tr><td><strong>${catLabel(r.category)}</strong></td>
          <td style="font-weight:600">${fmtMoney(r.revenue)}</td><td>${r.qty_sold} pcs</td></tr>`).join('')}
        </tbody></table></div>
      </div>` : ''}
      <style>@media(max-width:768px){div[style*="grid-template-columns:1fr 1fr"]{grid-template-columns:1fr!important}}</style>`;
    res.send(renderPage('Sales Reports', shopLayout('Sales Reports', body, req), req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════
  // 9. ADMIN DASHBOARD OVERVIEW
  // ═══════════════════════════════════════════════════════
  app.get('/shop/admin', requireAdmin, ah(async (req, res) => {
    // Summary
    const { rows: [{ total_orders, total_revenue, pending, processing }] } = await pool.query(
      `SELECT COUNT(*) as total_orders, COALESCE(SUM(total),0) as total_revenue,
       COUNT(*) FILTER (WHERE status='pending') as pending,
       COUNT(*) FILTER (WHERE status='processing') as processing
       FROM shop_orders WHERE tenant_id = $1`, [tenantId]);
    const { rows: [{ total_products, low_stock, out_of_stock }] } = await pool.query(
      `SELECT COUNT(*) as total_products,
       COUNT(*) FILTER (WHERE stock <= reorder_level AND stock > 0) as low_stock,
       COUNT(*) FILTER (WHERE stock = 0) as out_of_stock
       FROM shop_products WHERE tenant_id = $1 AND active = true`, [tenantId]);
    // Recent orders
    const { rows: recentOrders } = await pool.query(
      `SELECT * FROM shop_orders WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5`, [tenantId]);
    // Low stock items
    const { rows: lowStockItems } = await pool.query(
      `SELECT * FROM shop_products WHERE tenant_id = $1 AND active = true AND stock <= reorder_level ORDER BY stock ASC LIMIT 5`, [tenantId]);
    // Recent 7-day revenue
    const { rows: weekRev } = await pool.query(
      `SELECT COALESCE(SUM(total),0) as rev FROM shop_orders WHERE tenant_id = $1 AND status != 'pending' AND created_at >= NOW() - INTERVAL '7 days'`, [tenantId]);
    let recentRows = recentOrders.map(o => `<tr>
      <td><strong>#${o.id}</strong></td>
      <td>${esc(o.student_name)}</td>
      <td><span class="status status-${o.status}">${o.status}</span></td>
      <td><strong>${fmtMoney(o.total)}</strong></td>
      <td class="muted">${new Date(o.created_at).toLocaleDateString()}</td>
    </tr>`).join('');
    let lowRows = lowStockItems.map(p => `<tr>
      <td><strong>${esc(p.name)}</strong></td>
      <td class="${p.stock===0?'stock-low':'stock-low'}" style="font-weight:600">${p.stock === 0 ? 'OUT' : p.stock}</td>
      <td class="muted">${p.reorder_level}</td>
      <td><form method="POST" action="/shop/admin/stock/restock" style="display:inline-flex;gap:4px">
        <input type="hidden" name="id" value="${p.id}"><input type="number" name="qty" value="20" min="1" style="width:50px;padding:3px;border:1px solid #d1d5db;border-radius:4px">
        <button type="submit" class="btn btn-success btn-sm">+</button></form></td>
    </tr>`).join('');
    const body = `
      <div class="grid" style="grid-template-columns:repeat(auto-fit,minmax(150px,1fr));margin-bottom:24px">
        <div class="card text-center"><p style="font-size:1.8rem;font-weight:700;color:${BRAND}">${Number(total_orders||0)}</p><p class="muted">Total Orders</p></div>
        <div class="card text-center"><p style="font-size:1.8rem;font-weight:700;color:${SUCCESS}">${fmtMoney(total_revenue)}</p><p class="muted">Total Revenue</p></div>
        <div class="card text-center"><p style="font-size:1.8rem;font-weight:700;color:${WARNING}">${pending}</p><p class="muted">Pending</p></div>
        <div class="card text-center"><p style="font-size:1.8rem;font-weight:700;color:${BRAND_DARK}">${processing}</p><p class="muted">Processing</p></div>
        <div class="card text-center"><p style="font-size:1.8rem;font-weight:700;color:${SUCCESS}">${fmtMoney(weekRev.rev)}</p><p class="muted">7-Day Revenue</p></div>
      </div>
      ${low_stock > 0 ? `<div class="alert alert-warn">⚠️ ${low_stock} product(s) at low stock, ${out_of_stock} out of stock.</div>` : '<div class="alert alert-success">✅ All products are well-stocked.</div>'}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px">
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="color:${BRAND}">📦 Recent Orders</h3>
            <a href="/shop/admin/orders" class="btn btn-outline btn-sm">View All</a>
          </div>
          ${recentOrders.length ? `<div class="table-wrap"><table><thead><tr><th>Order</th><th>Student</th><th>Status</th><th>Total</th><th>Date</th></tr></thead><tbody>${recentRows}</tbody></table></div>` : '<p class="muted">No orders yet.</p>'}
        </div>
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="color:${DANGER}">⚠️ Low Stock Alerts</h3>
            <a href="/shop/admin/stock" class="btn btn-outline btn-sm">Manage Stock</a>
          </div>
          ${lowStockItems.length ? `<div class="table-wrap"><table><thead><tr><th>Product</th><th>Stock</th><th>Reorder</th><th></th></tr></thead><tbody>${lowRows}</tbody></table></div>` : '<p class="muted">All good!</p>'}
        </div>
      </div>
      <div class="card">
        <div class="flex" style="justify-content:space-between;flex-wrap:wrap;gap:8px">
          <a href="/shop/admin/products" class="btn btn-primary">🏷️ Manage Products</a>
          <a href="/shop/admin/orders" class="btn btn-primary">📦 Manage Orders</a>
          <a href="/shop/admin/stock" class="btn btn-warning">📊 Stock Management</a>
          <a href="/shop/reports" class="btn btn-success">📈 Sales Reports</a>
          <a href="/shop" class="btn btn-outline">🛍️ View Shop</a>
        </div>
      </div>
      <style>@media(max-width:768px){div[style*="grid-template-columns:1fr 1fr"]{grid-template-columns:1fr!important}}</style>`;
    res.send(renderPage('Shop Admin', shopLayout('Shop Admin Dashboard', body, req), req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════
  // 10. API ENDPOINTS (JSON)
  // ═══════════════════════════════════════════════════════

  // API: List products (JSON)
  app.get('/api/shop/products', ah(async (req, res) => {
    const cat = req.query.category || '';
    const q = req.query.q || '';
    let where = 'WHERE p.tenant_id = $1 AND p.active = true';
    const params = [tenantId];
    let pi = 2;
    if (cat && CATEGORIES.includes(cat)) { where += ` AND p.category = $${pi++}`; params.push(cat); }
    if (q) { where += ` AND (p.name ILIKE $${pi} OR p.description ILIKE $${pi})`; params.push(`%${q}%`); }
    const { rows } = await pool.query(`SELECT id,name,category,size_options,price,stock,reorder_level,image_url,description FROM shop_products p ${where} ORDER BY p.category,p.name`, params);
    res.json({ success: true, data: rows });
  }));

  // API: Get cart (JSON)
  app.get('/api/shop/cart', ah(async (req, res) => {
    const cart = getCart(req);
    const total = cart.reduce((s, c) => s + c.price * c.qty, 0);
    res.json({ success: true, data: { items: cart, total: Number(total.toFixed(2)), count: cart.reduce((s,c)=>s+c.qty,0) } });
  }));

  // API: Add to cart (JSON)
  app.post('/api/shop/cart/add', ah(async (req, res) => {
    const pid = parseInt(req.body.id);
    const qty = Math.max(1, parseInt(req.body.qty) || 1);
    const size = req.body.size || '';
    const { rows: [product] } = await pool.query(
      `SELECT * FROM shop_products WHERE id = $1 AND tenant_id = $2 AND active = true`, [pid, tenantId]);
    if (!product) return res.status(404).json({ success: false, error: 'Product not found' });
    const cart = getCart(req);
    const existing = cart.find(c => c.id === pid && c.size === size);
    if (existing) { existing.qty = Math.min(existing.qty + qty, product.stock); }
    else { cart.push({ id: pid, name: product.name, price: Number(product.price), size, qty: Math.min(qty, product.stock), image_url: product.image_url }); }
    req.session.shopCart = cart;
    res.json({ success: true, data: { items: cart, count: cart.reduce((s,c)=>s+c.qty,0) } });
  }));

  // API: Low stock alerts
  app.get('/api/shop/stock/alerts', requireAdmin, ah(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id,name,category,stock,reorder_level FROM shop_products WHERE tenant_id = $1 AND active = true AND stock <= reorder_level ORDER BY stock ASC`, [tenantId]);
    res.json({ success: true, data: rows });
  }));

  // API: Dashboard stats
  app.get('/api/shop/stats', requireAuth, ah(async (req, res) => {
    const { rows: [{ total_orders, total_revenue }] } = await pool.query(
      `SELECT COUNT(*) as total_orders, COALESCE(SUM(total),0) as total_revenue FROM shop_orders WHERE tenant_id = $1 AND status != 'pending'`, [tenantId]);
    const { rows: [{ low_stock }] } = await pool.query(
      `SELECT COUNT(*) as low_stock FROM shop_products WHERE tenant_id = $1 AND active = true AND stock <= reorder_level`, [tenantId]);
    res.json({ success: true, data: { total_orders: Number(total_orders||0), total_revenue: Number(total_revenue||0), low_stock: Number(low_stock||0) } });
  }));

};
