/**
 * School Merch Store Module
 * Branded merchandise, fundraising products, and campaign items
 * Features: Product Catalog, Public Storefront, Shopping Cart, Checkout,
 *           Order Management, Inventory, Revenue Dashboard, Campaign Products
 *
 * Tables: merch_products, merch_orders, merch_order_items, merch_campaigns
 * Routes under /merch
 */
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const requireAdmin = opts.requireAdmin || ((req,res,next) => { if(!req.session?.user?.role||req.session.user.role!=='admin') return res.status(403).send('Access denied'); next(); });
  const audit = opts.audit || (() => {});
  const trackRevenue = opts.trackRevenue || global.trackRevenue || (() => {});
  const tenantId = opts.tenantId || 1;

  const CATEGORIES = ['hoodies','t_shirts','caps','water_bottles','bags','stationery_sets','mugs'];
  const ORDER_STATUSES = ['pending','confirmed','preparing','ready','delivered'];
  const DELIVERY_METHODS = ['school_pickup','home_delivery'];
  const CAMPAIGN_TYPES = ['sports_day','leavers','concert','fundraiser','spirit_week','open_day','custom'];

  // ── Brand Colors ──
  const BRAND = '#4f46e5';
  const BRAND_LIGHT = '#eef2ff';
  const BRAND_DARK = '#3730a3';
  const SUCCESS = '#10b981';
  const WARNING = '#f59e0b';
  const DANGER = '#ef4444';
  const GRAY = '#6b7280';

  // ── Helpers ──
  function getCart(req) {
    if (!req.session.merchCart) req.session.merchCart = [];
    return req.session.merchCart;
  }

  function fmtMoney(n) {
    return '$' + Number(n||0).toFixed(2);
  }

  function catLabel(c) {
    return (c||'').replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase());
  }

  function parseJSONB(val) {
    if (!val) return [];
    return typeof val === 'string' ? JSON.parse(val) : val;
  }

  function isAdmin(req) {
    return req.session?.user?.role === 'admin';
  }

  // ── SVG Bar Chart ──
  function svgBarChart(data, o) {
    const w = o.width || 700, h = o.height || 300, pad = 50;
    const barW = Math.min(40, Math.floor((w - pad * 2) / (data.length + 1)));
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const chartH = h - pad * 2;
    let bars = '', labels = '';
    data.forEach((d, i) => {
      const x = pad + i * (barW + 10) + 10;
      const barH = Math.max(2, (d.value / maxVal) * chartH);
      const y = pad + chartH - barH;
      const color = d.color || BRAND;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="4"><title>${esc(d.label)}: ${d.display||d.value}</title></rect>`;
      bars += `<text x="${x+barW/2}" y="${y-6}" text-anchor="middle" fill="#374151" font-size="11" font-weight="600">${d.display||d.value}</text>`;
      labels += `<text x="${x+barW/2}" y="${h-pad+18}" text-anchor="middle" fill="#6b7280" font-size="10" transform="rotate(-30 ${x+barW/2} ${h-pad+18})">${esc(String(d.label).substring(0,12))}</text>`;
    });
    let grid = '';
    for (let i = 0; i <= 4; i++) {
      const y = pad + (chartH/4)*i, val = maxVal - (maxVal/4)*i;
      grid += `<line x1="${pad}" y1="${y}" x2="${w-10}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="4"/>`;
      grid += `<text x="${pad-6}" y="${y+4}" text-anchor="end" fill="#9ca3af" font-size="10">${Math.round(val)}</text>`;
    }
    const title = o.title ? `<text x="${w/2}" y="24" text-anchor="middle" fill="#1f2937" font-size="14" font-weight="700">${esc(o.title)}</text>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="max-width:100%;height:auto;" role="img" aria-label="${esc(o.title||'Bar chart')}">
      <rect width="${w}" height="${h}" fill="${BRAND_LIGHT}" rx="8"/>${title}${grid}${bars}${labels}</svg>`;
  }

  // ── SVG Line Chart ──
  function svgLineChart(data, o) {
    const w = o.width||700, h = o.height||280, pad = 50;
    const maxVal = Math.max(...data.map(d=>d.value),1);
    const chartW = w - pad*2, chartH = h - pad*2;
    const stepX = data.length > 1 ? chartW/(data.length-1) : chartW;
    const points = data.map((d,i) => `${pad+i*stepX},${pad+chartH-(d.value/maxVal)*chartH}`).join(' ');
    const areaPoints = points + ` ${pad+(data.length-1)*stepX},${pad+chartH} ${pad},${pad+chartH}`;
    let grid = '';
    for (let i=0;i<=4;i++) {
      const y=pad+(chartH/4)*i, val=maxVal-(maxVal/4)*i;
      grid += `<line x1="${pad}" y1="${y}" x2="${w-10}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="4"/>`;
      grid += `<text x="${pad-6}" y="${y+4}" text-anchor="end" fill="#9ca3af" font-size="10">${Math.round(val)}</text>`;
    }
    let dots = data.map((d,i) => {
      const cx=pad+i*stepX, cy=pad+chartH-(d.value/maxVal)*chartH;
      return `<circle cx="${cx}" cy="${cy}" r="4" fill="${BRAND}" stroke="white" stroke-width="2"><title>${esc(d.label)}: ${d.display||d.value}</title></circle>`;
    }).join('');
    let xLabels = data.map((d,i) => {
      const x = pad+i*stepX;
      return `<text x="${x}" y="${h-pad+18}" text-anchor="middle" fill="#6b7280" font-size="10">${esc(String(d.label).substring(0,8))}</text>`;
    }).join('');
    const title = o.title ? `<text x="${w/2}" y="24" text-anchor="middle" fill="#1f2937" font-size="14" font-weight="700">${esc(o.title)}</text>` : '';
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="max-width:100%;height:auto;" role="img" aria-label="${esc(o.title||'Line chart')}">
      <defs><linearGradient id="mAreaG" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${BRAND}" stop-opacity="0.3"/><stop offset="100%" stop-color="${BRAND}" stop-opacity="0.02"/></linearGradient></defs>
      <rect width="${w}" height="${h}" fill="${BRAND_LIGHT}" rx="8"/>${title}${grid}
      <polygon points="${areaPoints}" fill="url(#mAreaG)"/>
      <polyline points="${points}" fill="none" stroke="${BRAND}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}${xLabels}</svg>`;
  }

  // ── SVG Donut Chart ──
  function svgDonutChart(data, o) {
    const size = o.size||260, cx=size/2, cy=size/2, r=o.radius||90, inner=o.innerRadius||55;
    const total = data.reduce((s,d)=>s+d.value,0)||1;
    let paths = '', startAngle = -Math.PI/2;
    const colors = [BRAND,SUCCESS,WARNING,DANGER,'#8b5cf6','#ec4899','#14b8a6','#f97316'];
    data.forEach((d,i) => {
      const pct = d.value/total, sweep = pct*Math.PI*2, endAngle = startAngle+sweep;
      const x1=cx+r*Math.cos(startAngle), y1=cy+r*Math.sin(startAngle);
      const x2=cx+r*Math.cos(endAngle), y2=cy+r*Math.sin(endAngle);
      const ix1=cx+inner*Math.cos(endAngle), iy1=cy+inner*Math.sin(endAngle);
      const ix2=cx+inner*Math.cos(startAngle), iy2=cy+inner*Math.sin(startAngle);
      const large = sweep > Math.PI ? 1 : 0;
      const color = d.color || colors[i%colors.length];
      paths += `<path d="M${x1},${y1} A${r},${r} 0 ${large},1 ${x2},${y2} L${ix1},${iy1} A${inner},${inner} 0 ${large},0 ${ix2},${iy2} Z" fill="${color}" stroke="white" stroke-width="2"><title>${esc(d.label)}: ${fmtMoney(d.value)} (${(pct*100).toFixed(1)}%)</title></path>`;
      startAngle = endAngle;
    });
    const title = o.title ? `<text x="${cx}" y="18" text-anchor="middle" fill="#1f2937" font-size="13" font-weight="700">${esc(o.title)}</text>` : '';
    const legend = data.map((d,i) => {
      const color = d.color || colors[i%colors.length];
      return `<rect x="6" y="${size+10+i*18}" width="12" height="12" fill="${color}" rx="2"/><text x="22" y="${size+21+i*18}" fill="#374151" font-size="10">${esc(d.label)} (${(d.value/total*100).toFixed(1)}%)</text>`;
    }).join('');
    const legendH = data.length * 18 + 16;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size+legendH}" style="max-width:100%;height:auto;" role="img" aria-label="${esc(o.title||'Donut chart')}">
      ${title}${paths}${legend}</svg>`;
  }

  // ── Page Layout ──
  function merchLayout(title, body, req) {
    const user = req.session?.user;
    const cart = getCart(req);
    const cartCount = cart.reduce((s,c)=>s+c.qty,0);
    const admin = isAdmin(req);
    const path = req.path || '';
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${esc(title)} — School Merch Store</title>
      <style>
        *{box-sizing:border-box;margin:0;padding:0}
        body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}
        a{color:${BRAND};text-decoration:none}a:hover{text-decoration:underline}
        .container{max-width:1200px;margin:0 auto;padding:16px}
        .header{background:${BRAND};color:white;padding:16px 0;margin-bottom:24px;box-shadow:0 2px 8px rgba(0,0,0,.1)}
        .header-inner{max-width:1200px;margin:0 auto;padding:0 16px;display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px}
        .header h1{font-size:1.4rem;font-weight:700}.header a{color:white}
        .nav{display:flex;gap:14px;align-items:center;flex-wrap:wrap}
        .nav a{color:rgba(255,255,255,.85);font-size:.88rem;padding:4px 0;border-bottom:2px solid transparent;transition:all .2s}
        .nav a:hover,.nav a.active{color:white;border-bottom-color:white;text-decoration:none}
        .badge{background:${DANGER};color:white;font-size:.7rem;padding:1px 6px;border-radius:10px;margin-left:4px}
        .card{background:white;border-radius:12px;box-shadow:0 1px 4px rgba(0,0,0,.08);padding:20px;margin-bottom:16px}
        .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
        .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:20px}
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
        .status-confirmed{background:#dbeafe;color:#1e40af}
        .status-preparing{background:#fef3c7;color:#92400e}
        .status-ready{background:#d1fae5;color:#065f46}
        .status-delivered{background:#e0e7ff;color:#3730a3}
        .stock-low{color:${DANGER};font-weight:700}
        .stock-ok{color:${SUCCESS}}
        .alert{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:.9rem}
        .alert-warn{background:#fef3c7;border:1px solid #f59e0b33;color:#92400e}
        .alert-info{background:#dbeafe;border:1px solid #3b82f633;color:#1e40af}
        .alert-success{background:#d1fae5;border:1px solid #10b98133;color:#065f46}
        .product-img{width:100%;height:160px;object-fit:cover;border-radius:8px;background:#e5e7eb}
        .product-card{text-align:left}
        .product-card h3{font-size:1rem;margin:8px 0 4px;color:#1e293b}
        .product-card .price{font-size:1.15rem;font-weight:700;color:${BRAND}}
        .product-card .stock-info{font-size:.8rem;margin-top:4px}
        .flex{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
        .muted{color:${GRAY};font-size:.85rem}
        .text-center{text-align:center}
        .mt-2{margin-top:16px}.mt-4{margin-top:24px}
        .empty-state{text-align:center;padding:48px 16px;color:#9ca3af}
        .campaign-badge{background:linear-gradient(135deg,${BRAND},#7c3aed);color:white;font-size:.7rem;padding:2px 8px;border-radius:10px;font-weight:600}
        .color-dot{width:14px;height:14px;border-radius:50%;display:inline-block;border:2px solid #e5e7eb;vertical-align:middle;margin-right:2px}
        .charts-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:20px;margin-top:16px}
        .stat-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px}
        .stat-box{background:white;border-radius:10px;padding:16px;text-align:center;box-shadow:0 1px 3px rgba(0,0,0,.06)}
        .stat-box .num{font-size:1.5rem;font-weight:700;color:${BRAND}}
        .stat-box .lbl{font-size:.8rem;color:${GRAY};margin-top:4px}
        .filter-bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:12px 16px;background:white;border-radius:10px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
        .filter-bar input,.filter-bar select{padding:8px 12px;border:1.5px solid #d1d5db;border-radius:8px;font-size:.85rem}
        .filter-bar input:focus,.filter-bar select:focus{outline:none;border-color:${BRAND}}
        @media(max-width:640px){.grid{grid-template-columns:1fr 1fr}.grid-2{grid-template-columns:1fr}.header-inner{flex-direction:column;text-align:center}.filter-bar{flex-direction:column}}
      </style></head><body>
      <header class="header" role="banner"><div class="header-inner">
        <h1 aria-label="School Merch Store">🎓 School Merch Store</h1>
        <nav class="nav" role="navigation" aria-label="Main navigation">
          <a href="/merch" class="${path==='/merch'?'active':''}">Store</a>
          <a href="/merch/cart" class="${path==='/merch/cart'?'active':''}">Cart${cartCount>0?`<span class="badge" aria-label="${cartCount} items">${cartCount}</span>`:''}</a>
          ${user?`<a href="/merch/orders" class="${path.startsWith('/merch/orders')?'active':''}">My Orders</a>`:''}
          ${admin?`<a href="/merch/admin" class="${path.startsWith('/merch/admin')?'active':''}">Admin</a>`:''}
        </nav>
      </div></header>
      <main class="container" role="main">${body}</main>
      <footer style="text-align:center;padding:24px;color:#9ca3af;font-size:.8rem;margin-top:32px;border-top:1px solid #e5e7eb">
        School Merch Store &copy; ${new Date().getFullYear()} — Show your school pride!
      </footer></body></html>`;
  }

  // ═══════════════════════════════════════════════════════════════
  // DATABASE INITIALIZATION
  // ═══════════════════════════════════════════════════════════════
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merch_products (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        name VARCHAR(200) NOT NULL,
        description TEXT DEFAULT '',
        price NUMERIC(10,2) NOT NULL DEFAULT 0,
        image_url TEXT DEFAULT '',
        sizes JSONB DEFAULT '[]'::jsonb,
        colors JSONB DEFAULT '[]'::jsonb,
        stock INT NOT NULL DEFAULT 0,
        reorder_level INT NOT NULL DEFAULT 10,
        category VARCHAR(50) NOT NULL DEFAULT 't_shirts',
        campaign_id INT DEFAULT NULL,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merch_orders (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        user_id INT DEFAULT NULL,
        customer_name VARCHAR(200) NOT NULL DEFAULT '',
        customer_phone VARCHAR(30) NOT NULL DEFAULT '',
        customer_email VARCHAR(200) DEFAULT '',
        delivery_method VARCHAR(30) NOT NULL DEFAULT 'school_pickup',
        delivery_address TEXT DEFAULT '',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        total NUMERIC(10,2) NOT NULL DEFAULT 0,
        notes TEXT DEFAULT '',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merch_order_items (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        order_id INT NOT NULL REFERENCES merch_orders(id) ON DELETE CASCADE,
        product_id INT NOT NULL,
        product_name VARCHAR(200) NOT NULL,
        size VARCHAR(50) DEFAULT '',
        color VARCHAR(50) DEFAULT '',
        price NUMERIC(10,2) NOT NULL DEFAULT 0,
        quantity INT NOT NULL DEFAULT 1,
        subtotal NUMERIC(10,2) NOT NULL DEFAULT 0
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merch_campaigns (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        name VARCHAR(200) NOT NULL,
        description TEXT DEFAULT '',
        campaign_type VARCHAR(50) NOT NULL DEFAULT 'custom',
        start_date DATE NOT NULL,
        end_date DATE NOT NULL,
        active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS merch_stock_history (
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
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mp_tenant ON merch_products(tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mp_category ON merch_products(category)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mp_campaign ON merch_products(campaign_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mo_tenant ON merch_orders(tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mo_user ON merch_orders(user_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mo_status ON merch_orders(status)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_moi_tenant ON merch_order_items(tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_moi_order ON merch_order_items(order_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_mc_tenant ON merch_campaigns(tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_msh_tenant ON merch_stock_history(tenant_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_msh_product ON merch_stock_history(product_id)`);
  })();

  // ═══════════════════════════════════════════════════════════════
  // 1. PUBLIC STOREFRONT — PRODUCT CATALOG
  // ═══════════════════════════════════════════════════════════════

  // Store home — browse all products
  app.get('/merch', ah(async (req, res) => {
    const cat = req.query.category || '';
    const q = req.query.q || '';
    const minPrice = parseFloat(req.query.min_price) || 0;
    const maxPrice = parseFloat(req.query.max_price) || 999999;
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
      pi++;
    }
    where += ` AND p.price >= $${pi++} AND p.price <= $${pi++}`;
    params.push(minPrice, maxPrice);

    const { rows: products } = await pool.query(
      `SELECT p.*, c.name AS campaign_name, c.campaign_type
       FROM merch_products p
       LEFT JOIN merch_campaigns c ON c.id = p.campaign_id AND c.tenant_id = p.tenant_id
       ${where} ORDER BY p.category, p.name`, params);

    // Fetch active campaigns for showcase
    const today = new Date().toISOString().split('T')[0];
    const { rows: campaigns } = await pool.query(
      `SELECT * FROM merch_campaigns WHERE tenant_id = $1 AND active = true
       AND start_date <= $2 AND end_date >= $2 ORDER BY end_date ASC`, [tenantId, today]);

    const grouped = {};
    products.forEach(p => {
      if (!grouped[p.category]) grouped[p.category] = [];
      grouped[p.category].push({
        ...p,
        sizes: parseJSONB(p.sizes),
        colors: parseJSONB(p.colors)
      });
    });

    // Build filter bar
    let filters = `<div class="filter-bar" role="search" aria-label="Filter products">
      <form method="GET" action="/merch" style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;flex:1">
        <input type="text" name="q" value="${esc(q)}" placeholder="Search merch..." aria-label="Search" style="flex:1;min-width:150px">
        <select name="category" aria-label="Category">
          <option value="">All Categories</option>
          ${CATEGORIES.map(c=>`<option value="${c}" ${cat===c?'selected':''}>${catLabel(c)}</option>`).join('')}
        </select>
        <input type="number" name="min_price" value="${minPrice||''}" placeholder="Min $" min="0" step="0.01" style="width:100px" aria-label="Minimum price">
        <input type="number" name="max_price" value="${maxPrice>=999999?'':maxPrice}" placeholder="Max $" min="0" step="0.01" style="width:100px" aria-label="Maximum price">
        <button type="submit" class="btn btn-primary btn-sm">Search</button>
        <a href="/merch" class="btn btn-outline btn-sm">Clear</a>
      </form>
    </div>`;

    // Campaign showcase banner
    let campaignBanner = '';
    if (campaigns.length) {
      const PURPLE = '#7c3aed';
      campaignBanner = `<div style="background:linear-gradient(135deg,${BRAND},${PURPLE});color:white;border-radius:12px;padding:24px;margin-bottom:20px;display:flex;flex-wrap:wrap;gap:16px;align-items:center">
        <div style="flex:1;min-width:200px">
          <h2 style="margin-bottom:4px">🔥 Active Campaigns</h2>
          <p style="opacity:.9;font-size:.9rem">Limited-edition merch available now!</p>
        </div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${campaigns.slice(0,3).map(c => `<a href="/merch?campaign=${c.id}" style="background:rgba(255,255,255,.2);color:white;padding:6px 14px;border-radius:8px;font-size:.85rem;font-weight:600;text-decoration:none">${esc(c.name)}</a>`).join('')}
        </div>
      </div>`;
    }

    // Product grid
    let cards = '';
    for (const [cat2, items] of Object.entries(grouped)) {
      cards += `<h2 style="margin:24px 0 12px;color:${BRAND_DARK};font-size:1.15rem" id="cat-${esc(cat2)}">${catLabel(cat2)}</h2><div class="grid">`;
      items.forEach(p => {
        const lowStock = p.stock <= p.reorder_level;
        const colorDots = p.colors && p.colors.length > 0
          ? p.colors.slice(0,6).map(c => `<span class="color-dot" style="background:${esc(c)}" title="${esc(c)}"></span>`).join('')
          : '';
        cards += `<div class="card product-card" role="article" aria-label="${esc(p.name)}">
          ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" class="product-img" loading="lazy" onerror="this.style.display='none'">` :
          `<div class="product-img" style="display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:2rem">👕</div>`}
          ${p.campaign_name ? `<span class="campaign-badge">${esc(p.campaign_type)} — ${esc(p.campaign_name)}</span>` : ''}
          <h3>${esc(p.name)}</h3>
          <p class="muted">${esc((p.description||'').substring(0,70))}</p>
          ${colorDots ? `<div style="margin:6px 0">${colorDots}</div>` : ''}
          <p class="price">${fmtMoney(p.price)}</p>
          <p class="stock-info ${lowStock?'stock-low':'stock-ok'}">${p.stock>0?`${p.stock} in stock`:'Out of stock'}</p>
          ${p.sizes && p.sizes.length > 0 ? `<p class="muted" style="font-size:.75rem">Sizes: ${p.sizes.map(s=>esc(s)).join(', ')}</p>` : ''}
          <form method="POST" action="/merch/cart/add" style="margin-top:10px" aria-label="Add ${esc(p.name)} to cart">
            <input type="hidden" name="id" value="${p.id}">
            ${p.sizes && p.sizes.length > 0 ? `<select name="size" aria-label="Select size" style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:6px;margin-bottom:6px">
              <option value="">Select size</option>${p.sizes.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}
            </select>` : ''}
            ${p.colors && p.colors.length > 0 ? `<select name="color" aria-label="Select color" style="width:100%;padding:6px;border:1px solid #d1d5db;border-radius:6px;margin-bottom:6px">
              <option value="">Select color</option>${p.colors.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}
            </select>` : ''}
            <div class="flex">
              <input type="number" name="qty" value="1" min="1" max="${p.stock}" aria-label="Quantity" style="width:60px;padding:6px;border:1px solid #d1d5db;border-radius:6px">
              <button type="submit" class="btn btn-primary btn-sm" ${p.stock<1?'disabled':''}>Add to Cart</button>
            </div>
          </form>
        </div>`;
      });
      cards += '</div>';
    }

    if (!products.length) {
      cards = `<div class="empty-state"><p style="font-size:3rem">🔍</p><p>No products found. Try adjusting your filters.</p></div>`;
    }

    const body = campaignBanner + filters + cards;
    res.send(renderPage('School Merch Store', merchLayout('Store', body, req), req.session?.user));
  }));

  // Single product detail
  app.get('/merch/product/:id', ah(async (req, res) => {
    const { rows: [p] } = await pool.query(
      `SELECT p.*, c.name AS campaign_name FROM merch_products p
       LEFT JOIN merch_campaigns c ON c.id = p.campaign_id
       WHERE p.id = $1 AND p.tenant_id = $2`, [req.params.id, tenantId]);
    if (!p) return res.status(404).send(merchLayout('Not Found', '<div class="empty-state"><p>Product not found.</p></div>', req));
    const sizes = parseJSONB(p.sizes);
    const colors = parseJSONB(p.colors);
    const lowStock = p.stock <= p.reorder_level;
    const colorDots = colors.length > 0 ? colors.map(c => `<span class="color-dot" style="background:${esc(c)};width:20px;height:20px;cursor:pointer;margin:4px" title="${esc(c)}" onclick="document.getElementById('colorSelect').value='${esc(c)}'"></span>`).join('') : '';
    const body = `<div style="max-width:700px;margin:0 auto">
      <div class="card" style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div>
          ${p.image_url ? `<img src="${esc(p.image_url)}" alt="${esc(p.name)}" style="width:100%;max-height:300px;object-fit:cover;border-radius:8px" onerror="this.style.display='none'">` :
          `<div style="width:100%;height:260px;background:#eef2ff;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:4rem">👕</div>`}
        </div>
        <div>
          <h2 style="color:${BRAND}">${esc(p.name)}</h2>
          <p class="muted">Category: ${catLabel(p.category)}</p>
          ${p.campaign_name ? `<span class="campaign-badge">${esc(p.campaign_name)}</span>` : ''}
          <p style="font-size:2rem;font-weight:700;color:${BRAND};margin:12px 0">${fmtMoney(p.price)}</p>
          <p class="${lowStock?'stock-low':'stock-ok'}" style="font-weight:600">${p.stock>0?`${p.stock} in stock`:'Out of stock'}</p>
          <p style="margin:12px 0">${esc(p.description || 'No description available.')}</p>
          ${sizes.length > 0 ? `<p class="muted" style="margin-bottom:8px">Sizes: <strong>${sizes.map(s=>esc(s)).join(', ')}</strong></p>` : ''}
          ${colorDots ? `<div style="margin-bottom:12px"><p class="muted" style="margin-bottom:4px">Colors:</p>${colorDots}</div>` : ''}
          <form method="POST" action="/merch/cart/add" aria-label="Add to cart">
            <input type="hidden" name="id" value="${p.id}">
            ${sizes.length > 0 ? `<div class="form-group"><label for="sz">Size</label><select id="sz" name="size"><option value="">Choose size...</option>${sizes.map(s=>`<option value="${esc(s)}">${esc(s)}</option>`).join('')}</select></div>` : ''}
            ${colors.length > 0 ? `<div class="form-group"><label for="colorSelect">Color</label><select id="colorSelect" name="color"><option value="">Choose color...</option>${colors.map(c=>`<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select></div>` : ''}
            <div class="flex"><div class="form-group" style="margin-bottom:0"><label for="qty">Qty</label>
              <input type="number" id="qty" name="qty" value="1" min="1" max="${p.stock}" style="width:80px">
            </div>
            <button type="submit" class="btn btn-primary" style="margin-top:18px" ${p.stock<1?'disabled':''}>Add to Cart</button></div>
          </form>
        </div>
      </div>
      <a href="/merch" class="btn btn-outline mt-2" aria-label="Back to store">&larr; Back to Store</a>
    </div>
    <style>@media(max-width:640px){div[style*="grid-template-columns:1fr 1fr"]{grid-template-columns:1fr!important}}</style>`;
    res.send(renderPage(p.name, merchLayout(p.name, body, req), req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  // 2. SHOPPING CART — SESSION BASED
  // ═══════════════════════════════════════════════════════════════

  app.post('/merch/cart/add', ah(async (req, res) => {
    const pid = parseInt(req.body.id);
    const qty = Math.max(1, parseInt(req.body.qty) || 1);
    const size = (req.body.size || '').trim();
    const color = (req.body.color || '').trim();
    const { rows: [product] } = await pool.query(
      `SELECT * FROM merch_products WHERE id = $1 AND tenant_id = $2 AND active = true`, [pid, tenantId]);
    if (!product) return res.redirect('/merch');
    const sizes = parseJSONB(product.sizes);
    const colors = parseJSONB(product.colors);
    if (size && sizes.length > 0 && !sizes.includes(size)) return res.redirect('/merch');
    if (color && colors.length > 0 && !colors.includes(color)) return res.redirect('/merch');
    const cart = getCart(req);
    const existing = cart.find(c => c.id === pid && c.size === size && c.color === color);
    if (existing) {
      existing.qty = Math.min(existing.qty + qty, product.stock);
    } else {
      cart.push({
        id: pid, name: product.name, price: Number(product.price),
        size, color, qty: Math.min(qty, product.stock), image_url: product.image_url
      });
    }
    req.session.merchCart = cart;
    res.redirect('/merch/cart');
  }));

  app.get('/merch/cart', ah(async (req, res) => {
    const cart = getCart(req);
    if (!cart.length) {
      const body = `<div class="empty-state"><p style="font-size:3rem">🛒</p><h2>Your cart is empty</h2>
        <p class="muted" style="margin-top:8px">Browse the merch store and add items!</p>
        <a href="/merch" class="btn btn-primary" style="margin-top:16px">Browse Store</a></div>`;
      return res.send(renderPage('Cart', merchLayout('Cart', body, req), req.session?.user));
    }
    let rows = '', total = 0;
    cart.forEach((item, idx) => {
      const sub = item.price * item.qty;
      total += sub;
      const details = [item.size ? `Size: ${esc(item.size)}` : '', item.color ? `Color: ${esc(item.color)}` : ''].filter(Boolean).join(' · ');
      rows += `<tr>
        <td>${idx+1}</td>
        <td><strong>${esc(item.name)}</strong>${details ? `<br><span class="muted">${details}</span>` : ''}</td>
        <td>${fmtMoney(item.price)}</td>
        <td><form method="POST" action="/merch/cart/update" style="display:flex;gap:4px" aria-label="Update quantity">
          <input type="hidden" name="idx" value="${idx}">
          <input type="number" name="qty" value="${item.qty}" min="1" max="99" style="width:60px;padding:4px;border:1px solid #d1d5db;border-radius:4px" aria-label="Quantity">
          <button type="submit" class="btn btn-primary btn-sm">Update</button></form></td>
        <td><strong>${fmtMoney(sub)}</strong></td>
        <td><form method="POST" action="/merch/cart/remove"><input type="hidden" name="idx" value="${idx}"><button type="submit" class="btn btn-danger btn-sm" aria-label="Remove ${esc(item.name)}">&times;</button></form></td>
      </tr>`;
    });
    const body = `<div class="card">
      <h2 style="color:${BRAND};margin-bottom:16px">🛒 Shopping Cart (${cart.length} item${cart.length>1?'s':''})</h2>
      <div class="table-wrap"><table><thead><tr><th>#</th><th>Product</th><th>Price</th><th>Qty</th><th>Subtotal</th><th></th></tr></thead>
      <tbody>${rows}</tbody><tfoot><tr><td colspan="4" style="text-align:right;font-weight:700;font-size:1.1rem">Total:</td>
      <td colspan="2" style="font-weight:700;font-size:1.2rem;color:${BRAND}">${fmtMoney(total)}</td></tr></tfoot></table></div>
      <div class="flex mt-2" style="justify-content:space-between">
        <a href="/merch" class="btn btn-outline">Continue Shopping</a>
        <a href="/merch/checkout" class="btn btn-success">Proceed to Checkout &rarr;</a>
      </div></div>`;
    res.send(renderPage('Cart', merchLayout('Cart', body, req), req.session?.user));
  }));

  app.post('/merch/cart/update', ah(async (req, res) => {
    const idx = parseInt(req.body.idx);
    const qty = Math.max(1, parseInt(req.body.qty) || 1);
    const cart = getCart(req);
    if (cart[idx]) { cart[idx].qty = qty; req.session.merchCart = cart; }
    res.redirect('/merch/cart');
  }));

  app.post('/merch/cart/remove', ah(async (req, res) => {
    const idx = parseInt(req.body.idx);
    const cart = getCart(req);
    if (cart[idx]) { cart.splice(idx, 1); req.session.merchCart = cart; }
    res.redirect('/merch/cart');
  }));

  // ═══════════════════════════════════════════════════════════════
  // 3. CHECKOUT — COLLECT CUSTOMER DETAILS
  // ═══════════════════════════════════════════════════════════════

  app.get('/merch/checkout', requireAuth, ah(async (req, res) => {
    const cart = getCart(req);
    if (!cart.length) return res.redirect('/merch/cart');
    let rows = '', total = 0;
    cart.forEach(item => {
      const sub = item.price * item.qty;
      total += sub;
      const details = [item.size ? esc(item.size) : '', item.color ? esc(item.color) : ''].filter(Boolean).join(', ');
      rows += `<tr><td>${esc(item.name)}${details ? ` (${details})` : ''}</td><td>${item.qty}</td><td>${fmtMoney(sub)}</td></tr>`;
    });
    const body = `<div class="grid-2" style="max-width:900px;margin:0 auto">
      <div class="card">
        <h2 style="color:${BRAND};margin-bottom:16px">📋 Order Summary</h2>
        <table><thead><tr><th>Item</th><th>Qty</th><th>Subtotal</th></tr></thead><tbody>${rows}</tbody>
        <tfoot><tr><td colspan="2" style="text-align:right;font-weight:700">Total:</td><td style="font-weight:700;color:${BRAND};font-size:1.1rem">${fmtMoney(total)}</td></tr></tfoot></table>
      </div>
      <div class="card">
        <h2 style="color:${BRAND};margin-bottom:16px">📦 Delivery Details</h2>
        <form method="POST" action="/merch/checkout" aria-label="Checkout form">
          <div class="form-group"><label for="cname">Full Name *</label>
            <input type="text" id="cname" name="customer_name" required placeholder="Your full name" value="${esc(req.session.user.name||'')}"></div>
          <div class="form-group"><label for="cphone">Phone *</label>
            <input type="tel" id="cphone" name="customer_phone" required placeholder="+254712345678"></div>
          <div class="form-group"><label for="cemail">Email</label>
            <input type="email" id="cemail" name="customer_email" placeholder="you@example.com" value="${esc(req.session.user.email||'')}"></div>
          <div class="form-group"><label for="delmethod">Delivery Method *</label>
            <select id="delmethod" name="delivery_method" required>
              <option value="school_pickup">School Pickup (Free)</option>
              <option value="home_delivery">Home Delivery (+$5.00)</option>
            </select></div>
          <div class="form-group" id="addrGroup" style="display:none"><label for="addr">Delivery Address *</label>
            <textarea id="addr" name="delivery_address" rows="2" placeholder="Street, building, landmark..."></textarea></div>
          <div class="form-group"><label for="notes">Notes</label>
            <textarea id="notes" name="notes" rows="2" placeholder="Special requests..."></textarea></div>
          <button type="submit" class="btn btn-success" style="width:100%">Place Order — ${fmtMoney(total)}</button>
        </form>
        <script>document.getElementById('delmethod').addEventListener('change',function(){document.getElementById('addrGroup').style.display=this.value==='home_delivery'?'block':'none'});</script>
      </div>
    </div>
    <style>@media(max-width:640px){.grid-2{grid-template-columns:1fr!important}}</style>`;
    res.send(renderPage('Checkout', merchLayout('Checkout', body, req), req.session?.user));
  }));

  app.post('/merch/checkout', requireAuth, ah(async (req, res) => {
    const cart = getCart(req);
    if (!cart.length) return res.redirect('/merch/cart');
    const name = (req.body.customer_name || '').trim();
    const phone = (req.body.customer_phone || '').trim();
    const email = (req.body.customer_email || '').trim();
    const deliveryMethod = (req.body.delivery_method || 'school_pickup');
    const address = (req.body.delivery_address || '').trim();
    const notes = (req.body.notes || '').trim();

    if (!name || !phone) {
      return res.send(merchLayout('Error', `<div class="alert alert-warn">Name and phone are required.</div><a href="/merch/checkout" class="btn btn-outline">&larr; Back</a>`, req));
    }
    if (!DELIVERY_METHODS.includes(deliveryMethod)) return res.status(400).send('Invalid delivery method');
    if (deliveryMethod === 'home_delivery' && !address) {
      return res.send(merchLayout('Error', `<div class="alert alert-warn">Please provide a delivery address.</div><a href="/merch/checkout" class="btn btn-outline">&larr; Back</a>`, req));
    }

    let total = 0;
    cart.forEach(item => { total += item.price * item.qty; });
    if (deliveryMethod === 'home_delivery') total += 5.00;

    // Verify stock
    for (const item of cart) {
      const { rows: [prod] } = await pool.query(
        `SELECT stock FROM merch_products WHERE id = $1 AND tenant_id = $2`, [item.id, tenantId]);
      if (!prod || prod.stock < item.qty) {
        return res.send(merchLayout('Error', `<div class="alert alert-warn">Sorry, "${esc(item.name)}" only has ${prod ? prod.stock : 0} left.</div><a href="/merch/cart" class="btn btn-outline">&larr; Back to Cart</a>`, req));
      }
    }

    const userId = req.session.user.id || req.session.user.sub || 0;
    const { rows: [order] } = await pool.query(
      `INSERT INTO merch_orders (tenant_id, user_id, customer_name, customer_phone, customer_email, delivery_method, delivery_address, status, total, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,'pending',$8,$9) RETURNING id`,
      [tenantId, userId, name, phone, email, deliveryMethod, address, total, notes]);

    for (const item of cart) {
      const sub = item.price * item.qty;
      await pool.query(
        `INSERT INTO merch_order_items (tenant_id, order_id, product_id, product_name, size, color, price, quantity, subtotal)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tenantId, order.id, item.id, item.name, item.size, item.color, item.price, item.qty, sub]);
      await pool.query(
        `UPDATE merch_products SET stock = stock - $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`,
        [item.qty, item.id, tenantId]);
      await pool.query(
        `INSERT INTO merch_stock_history (tenant_id, product_id, change_type, quantity, notes, user_id)
         VALUES ($1,$2,'sale',$3,$4,$5)`,
        [tenantId, item.id, item.qty, `Order #${order.id}`, userId]);
    }

    // Track revenue
    trackRevenue({
      module: 'school-merch',
      tenant_id: tenantId,
      amount: total,
      user_id: userId,
      order_id: order.id,
      description: `Merch order #${order.id} — ${name}`
    });
    audit({ action: 'merch_checkout', module: 'school-merch', order_id: order.id, total, user_id: userId });

    req.session.merchCart = [];
    const body = `<div class="card text-center" style="max-width:500px;margin:40px auto">
      <div style="font-size:3rem">✅</div>
      <h2 style="color:${SUCCESS};margin:12px 0">Order Placed!</h2>
      <p><strong>Order #${order.id}</strong></p>
      <p class="muted">Name: ${esc(name)}<br>Phone: ${esc(phone)}<br>Delivery: ${deliveryMethod === 'school_pickup' ? 'School Pickup' : 'Home Delivery'}</p>
      <p style="font-size:1.3rem;font-weight:700;color:${BRAND};margin:16px 0">Total: ${fmtMoney(total)}</p>
      <p class="muted">You'll be notified when your order is ready.</p>
      <div class="flex mt-2" style="justify-content:center">
        <a href="/merch/orders" class="btn btn-primary">View My Orders</a>
        <a href="/merch" class="btn btn-outline">Continue Shopping</a>
      </div></div>`;
    res.send(renderPage('Order Confirmed', merchLayout('Order Confirmed', body, req), req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  // 4. ORDER MANAGEMENT — USER & ADMIN VIEWS
  // ═══════════════════════════════════════════════════════════════

  // User orders
  app.get('/merch/orders', requireAuth, ah(async (req, res) => {
    const userId = req.session.user.id || req.session.user.sub || 0;
    const { rows: orders } = await pool.query(
      `SELECT * FROM merch_orders WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC`, [tenantId, userId]);
    if (!orders.length) {
      const body = `<div class="empty-state"><p style="font-size:3rem">📋</p><h2>No orders yet</h2><p class="muted">Your orders will appear here.</p>
        <a href="/merch" class="btn btn-primary" style="margin-top:16px">Start Shopping</a></div>`;
      return res.send(renderPage('My Orders', merchLayout('My Orders', body, req), req.session?.user));
    }
    let rows = '';
    orders.forEach(o => {
      rows += `<tr><td><strong>#${o.id}</strong></td><td>${esc(o.customer_name)}</td>
        <td>${o.delivery_method==='school_pickup'?'Pickup':'Delivery'}</td>
        <td><span class="status status-${o.status}">${o.status.replace(/_/g,' ').toUpperCase()}</span></td>
        <td><strong>${fmtMoney(o.total)}</strong></td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
        <td><a href="/merch/orders/${o.id}" class="btn btn-outline btn-sm">View</a></td></tr>`;
    });
    const body = `<div class="card"><h2 style="color:${BRAND};margin-bottom:16px">📋 My Orders (${orders.length})</h2>
      <div class="table-wrap"><table><thead><tr><th>Order</th><th>Name</th><th>Delivery</th><th>Status</th><th>Total</th><th>Date</th><th></th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>`;
    res.send(renderPage('My Orders', merchLayout('My Orders', body, req), req.session?.user));
  }));

  // Single order detail
  app.get('/merch/orders/:id', requireAuth, ah(async (req, res) => {
    const userId = req.session.user.id || req.session.user.sub || 0;
    const admin = isAdmin(req);
    const { rows: [order] } = await pool.query(
      `SELECT * FROM merch_orders WHERE id = $1 AND tenant_id = $2 ${admin?'':'AND user_id = $3'}`,
      admin ? [req.params.id, tenantId] : [req.params.id, tenantId, userId]);
    if (!order) return res.status(404).send(merchLayout('Not Found', '<div class="empty-state"><p>Order not found.</p></div>', req));
    const { rows: items } = await pool.query(
      `SELECT * FROM merch_order_items WHERE order_id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    let itemRows = '';
    items.forEach(i => {
      const details = [i.size?esc(i.size):'', i.color?esc(i.color):''].filter(Boolean).join(', ');
      itemRows += `<tr><td>${esc(i.product_name)}${details?` (${details})`:''}</td><td>${i.quantity}</td><td>${fmtMoney(i.price)}</td><td><strong>${fmtMoney(i.subtotal)}</strong></td></tr>`;
    });
    // Status progress bar
    const statusSteps = ORDER_STATUSES.map((s, idx) => {
      const curIdx = ORDER_STATUSES.indexOf(order.status);
      const active = idx <= curIdx;
      const current = s === order.status;
      return `<div style="text-align:center;flex:1">
        <div style="width:30px;height:30px;border-radius:50%;margin:0 auto 4px;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:.8rem;
          background:${active?BRAND:'#e5e7eb'};color:${active?'white':'#9ca3af'};${current?'box-shadow:0 0 0 3px '+BRAND_LIGHT:''}">
          ${idx+1}</div>
        <span style="font-size:.7rem;color:${current?BRAND:'#9ca3af'};font-weight:${current?'700':'400'}">${s.replace(/_/g,' ').toUpperCase()}</span>
      </div>`;
    }).join('<div style="flex:.5;height:2px;background:#e5e7eb;margin-bottom:18px;margin-top:14px"></div>');
    const body = `<div class="card" style="max-width:700px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:20px">
        <h2 style="color:${BRAND}">Order #${order.id}</h2>
        <span class="status status-${order.status}">${order.status.replace(/_/g,' ').toUpperCase()}</span>
      </div>
      <div style="display:flex;align-items:flex-start;margin-bottom:24px">${statusSteps}</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px;font-size:.85rem">
        <div><span class="muted">Customer:</span> <strong>${esc(order.customer_name)}</strong></div>
        <div><span class="muted">Phone:</span> <strong>${esc(order.customer_phone)}</strong></div>
        ${order.customer_email ? `<div><span class="muted">Email:</span> <strong>${esc(order.customer_email)}</strong></div>` : ''}
        <div><span class="muted">Delivery:</span> <strong>${order.delivery_method==='school_pickup'?'School Pickup':'Home Delivery'}</strong></div>
        ${order.delivery_address ? `<div style="grid-column:1/-1"><span class="muted">Address:</span> ${esc(order.delivery_address)}</div>` : ''}
        ${order.notes ? `<div style="grid-column:1/-1"><span class="muted">Notes:</span> ${esc(order.notes)}</div>` : ''}
        <div><span class="muted">Placed:</span> ${new Date(order.created_at).toLocaleString()}</div>
        <div><span class="muted">Total:</span> <strong style="color:${BRAND}">${fmtMoney(order.total)}</strong></div>
      </div>
      <h3 style="color:${BRAND_DARK};margin-bottom:8px">Items</h3>
      <table><thead><tr><th>Product</th><th>Qty</th><th>Price</th><th>Subtotal</th></tr></thead>
      <tbody>${itemRows}</tbody></table>
    </div>`;
    res.send(renderPage(`Order #${order.id}`, merchLayout(`Order #${order.id}`, body, req), req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  // 5. ADMIN — ORDERS, INVENTORY, PRODUCTS
  // ═══════════════════════════════════════════════════════════════

  // Admin dashboard
  app.get('/merch/admin', requireAdmin, ah(async (req, res) => {
    const tid = tenantId;
    const [ordersRes, productsRes, lowStockRes, revenueRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS c, COALESCE(SUM(total),0)::numeric AS rev FROM merch_orders WHERE tenant_id=$1 AND created_at >= CURRENT_DATE`, [tid]),
      pool.query(`SELECT COUNT(*)::int AS c FROM merch_products WHERE tenant_id=$1 AND active=true`, [tid]),
      pool.query(`SELECT * FROM merch_products WHERE tenant_id=$1 AND active=true AND stock <= reorder_level ORDER BY stock ASC LIMIT 10`, [tid]),
      pool.query(`SELECT COALESCE(SUM(total),0)::numeric AS total FROM merch_orders WHERE tenant_id=$1`, [tid])
    ]);
    const todayOrders = ordersRes.rows[0].c;
    const todayRev = Number(ordersRes.rows[0].rev);
    const totalProducts = productsRes.rows[0].c;
    const allTimeRev = Number(revenueRes.rows[0].total);

    const { rows: recentOrders } = await pool.query(
      `SELECT o.*, (SELECT COUNT(*) FROM merch_order_items WHERE order_id=o.id)::int AS item_count
       FROM merch_orders o WHERE o.tenant_id=$1 ORDER BY o.created_at DESC LIMIT 10`, [tid]);

    let recentRows = '';
    recentOrders.forEach(o => {
      recentRows += `<tr><td>#${o.id}</td><td>${esc(o.customer_name)}</td><td>${o.item_count||0}</td>
        <td>${fmtMoney(o.total)}</td>
        <td><span class="status status-${o.status}">${o.status.replace(/_/g,' ').toUpperCase()}</span></td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
        <td><a href="/merch/admin/orders" class="btn btn-outline btn-sm">Manage</a></td></tr>`;
    });

    let lowStockRows = '';
    lowStockRes.rows.forEach(p => {
      lowStockRows += `<tr><td>${esc(p.name)}</td><td><span class="stock-low">${p.stock}</span></td>
        <td>${p.reorder_level}</td><td>${catLabel(p.category)}</td>
        <td><a href="/merch/admin/inventory" class="btn btn-warning btn-sm">Restock</a></td></tr>`;
    });

    const body = `
      <h2 style="color:${BRAND};margin-bottom:16px">📊 Admin Dashboard</h2>
      <div class="stat-row">
        <div class="stat-box"><div class="num">${todayOrders}</div><div class="lbl">Orders Today</div></div>
        <div class="stat-box"><div class="num">${fmtMoney(todayRev)}</div><div class="lbl">Revenue Today</div></div>
        <div class="stat-box"><div class="num">${totalProducts}</div><div class="lbl">Active Products</div></div>
        <div class="stat-box"><div class="num">${fmtMoney(allTimeRev)}</div><div class="lbl">All-Time Revenue</div></div>
        <div class="stat-box"><div class="num" style="color:${lowStockRes.rows.length>0?DANGER:SUCCESS}">${lowStockRes.rows.length}</div><div class="lbl">Low Stock Alerts</div></div>
      </div>
      <div class="flex mt-2" style="margin-bottom:16px">
        <a href="/merch/admin/orders" class="btn btn-primary">Manage Orders</a>
        <a href="/merch/admin/products" class="btn btn-primary">Manage Products</a>
        <a href="/merch/admin/inventory" class="btn btn-warning">Inventory</a>
        <a href="/merch/admin/campaigns" class="btn btn-primary">Campaigns</a>
        <a href="/merch/admin/revenue" class="btn btn-success">Revenue Dashboard</a>
      </div>
      ${lowStockRes.rows.length ? `<div class="alert alert-warn">⚠️ ${lowStockRes.rows.length} product(s) are low on stock. <a href="/merch/admin/inventory">View &rarr;</a></div>` : ''}
      <div class="grid-2">
        <div class="card"><h3 style="color:${BRAND_DARK};margin-bottom:12px">Recent Orders</h3>
          <div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Items</th><th>Total</th><th>Status</th><th>Date</th><th></th></tr></thead>
          <tbody>${recentRows || '<tr><td colspan="7" class="text-center muted">No orders yet</td></tr>'}</tbody></table></div>
        </div>
        <div class="card"><h3 style="color:${DANGER};margin-bottom:12px">⚠️ Low Stock Alerts</h3>
          <div class="table-wrap"><table><thead><tr><th>Product</th><th>Stock</th><th>Reorder At</th><th>Category</th><th></th></tr></thead>
          <tbody>${lowStockRows || '<tr><td colspan="5" class="text-center muted" style="color:${SUCCESS}">All products well stocked ✓</td></tr>'}</tbody></table></div>
        </div>
      </div>`;
    res.send(renderPage('Merch Admin', merchLayout('Admin Dashboard', body, req), req.session?.user));
  }));

  // Admin — all orders with status management
  app.get('/merch/admin/orders', requireAdmin, ah(async (req, res) => {
    const statusFilter = req.query.status || '';
    let where = 'WHERE o.tenant_id = $1';
    const params = [tenantId];
    if (statusFilter && ORDER_STATUSES.includes(statusFilter)) {
      where += ' AND o.status = $2';
      params.push(statusFilter);
    }
    const { rows: orders } = await pool.query(
      `SELECT o.*, (SELECT COUNT(*) FROM merch_order_items WHERE order_id=o.id)::int AS item_count
       FROM merch_orders o ${where} ORDER BY o.created_at DESC`, params);

    // Status counts
    const { rows: counts } = await pool.query(
      `SELECT status, COUNT(*)::int AS c FROM merch_orders WHERE tenant_id=$1 GROUP BY status`, [tenantId]);
    const countMap = {};
    counts.forEach(r => { countMap[r.status] = r.c; });

    let filterTabs = `<div class="flex" style="margin-bottom:16px;flex-wrap:wrap;gap:6px">
      <a href="/merch/admin/orders" class="btn btn-sm ${!statusFilter?'btn-primary':'btn-outline'}">All (${orders.length})</a>
      ${ORDER_STATUSES.map(s => `<a href="/merch/admin/orders?status=${s}" class="btn btn-sm ${statusFilter===s?'btn-primary':'btn-outline'}">${s.replace(/_/g,' ').toUpperCase()} (${countMap[s]||0})</a>`).join('')}
    </div>`;

    let rows = '';
    orders.forEach(o => {
      const nextStatuses = ORDER_STATUSES.filter(s => ORDER_STATUSES.indexOf(s) > ORDER_STATUSES.indexOf(o.status));
      const actionBtns = nextStatuses.slice(0,2).map(ns =>
        `<form method="POST" action="/merch/admin/orders/${o.id}/status" style="display:inline;margin-right:4px">
          <input type="hidden" name="status" value="${ns}">
          <button type="submit" class="btn btn-sm btn-success">${ns.replace(/_/g,' ').toUpperCase()}</button></form>`
      ).join('');
      rows += `<tr>
        <td><strong>#${o.id}</strong></td><td>${esc(o.customer_name)}</td><td>${esc(o.customer_phone)}</td>
        <td>${o.item_count||0} items</td><td><strong>${fmtMoney(o.total)}</strong></td>
        <td><span class="status status-${o.status}">${o.status.replace(/_/g,' ').toUpperCase()}</span></td>
        <td>${new Date(o.created_at).toLocaleDateString()}</td>
        <td style="white-space:nowrap">${actionBtns} <a href="/merch/orders/${o.id}" class="btn btn-outline btn-sm">View</a></td></tr>`;
    });
    const body = filterTabs + `<div class="card">
      <h2 style="color:${BRAND};margin-bottom:16px">📦 All Orders (${orders.length})</h2>
      <div class="table-wrap"><table><thead><tr><th>Order</th><th>Customer</th><th>Phone</th><th>Items</th><th>Total</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="8" class="text-center muted">No orders found</td></tr>'}</tbody></table></div></div>`;
    res.send(renderPage('Manage Orders', merchLayout('Manage Orders', body, req), req.session?.user));
  }));

  // Admin — update order status
  app.post('/merch/admin/orders/:id/status', requireAdmin, ah(async (req, res) => {
    const { id } = req.params;
    const status = (req.body.status || '').trim();
    if (!ORDER_STATUSES.includes(status)) return res.status(400).send('Invalid status');
    const { rows: [order] } = await pool.query(
      `SELECT status FROM merch_orders WHERE id = $1 AND tenant_id = $2`, [id, tenantId]);
    if (!order) return res.status(404).send('Order not found');
    const curIdx = ORDER_STATUSES.indexOf(order.status);
    const newIdx = ORDER_STATUSES.indexOf(status);
    if (newIdx <= curIdx) return res.status(400).send('Invalid status transition');
    await pool.query(
      `UPDATE merch_orders SET status = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, [status, id, tenantId]);
    audit({ action: 'merch_status_update', module: 'school-merch', order_id: id, old_status: order.status, new_status: status });
    res.redirect('/merch/admin/orders');
  }));

  // ═══════════════════════════════════════════════════════════════
  // 6. ADMIN — PRODUCT MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  app.get('/merch/admin/products', requireAdmin, ah(async (req, res) => {
    const { rows: products } = await pool.query(
      `SELECT p.*, c.name AS campaign_name FROM merch_products p
       LEFT JOIN merch_campaigns c ON c.id = p.campaign_id
       WHERE p.tenant_id = $1 ORDER BY p.category, p.name`, [tenantId]);
    let rows = '';
    products.forEach(p => {
      const lowStock = p.stock <= p.reorder_level;
      rows += `<tr>
        <td>${esc(p.name)}</td><td>${catLabel(p.category)}</td><td>${fmtMoney(p.price)}</td>
        <td class="${lowStock?'stock-low':'stock-ok'}">${p.stock}</td>
        <td>${p.campaign_name ? `<span class="campaign-badge">${esc(p.campaign_name)}</span>` : '<span class="muted">—</span>'}</td>
        <td><span class="muted">${p.active?'✓ Active':'✗ Inactive'}</span></td>
        <td style="white-space:nowrap">
          <a href="/merch/admin/products/${p.id}/edit" class="btn btn-primary btn-sm">Edit</a>
          <form method="POST" action="/merch/admin/products/${p.id}/toggle" style="display:inline">
            <button type="submit" class="btn btn-sm ${p.active?'btn-danger':'btn-success'}">${p.active?'Disable':'Enable'}</button></form>
        </td></tr>`;
    });
    const body = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="color:${BRAND}">🏷️ Products (${products.length})</h2>
        <a href="/merch/admin/products/new" class="btn btn-primary">+ Add Product</a>
      </div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Category</th><th>Price</th><th>Stock</th><th>Campaign</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="text-center muted">No products</td></tr>'}</tbody></table></div></div>`;
    res.send(renderPage('Manage Products', merchLayout('Products', body, req), req.session?.user));
  }));

  // Add product form
  app.get('/merch/admin/products/new', requireAdmin, ah(async (req, res) => {
    const { rows: campaigns } = await pool.query(
      `SELECT * FROM merch_campaigns WHERE tenant_id = $1 AND active = true ORDER BY name`, [tenantId]);
    const body = `<div class="card" style="max-width:600px;margin:0 auto">
      <h2 style="color:${BRAND};margin-bottom:16px">+ Add New Product</h2>
      <form method="POST" action="/merch/admin/products/new" aria-label="Add product form">
        <div class="form-group"><label for="pname">Product Name *</label>
          <input type="text" id="pname" name="name" required placeholder="e.g. School Crest Hoodie"></div>
        <div class="form-group"><label for="pdesc">Description</label>
          <textarea id="pdesc" name="description" rows="2" placeholder="Describe the product..."></textarea></div>
        <div class="form-group"><label for="pcat">Category *</label>
          <select id="pcat" name="category" required>
            ${CATEGORIES.map(c=>`<option value="${c}">${catLabel(c)}</option>`).join('')}
          </select></div>
        <div class="grid-2">
          <div class="form-group"><label for="pprice">Price ($) *</label>
            <input type="number" id="pprice" name="price" step="0.01" min="0" required></div>
          <div class="form-group"><label for="pstock">Stock *</label>
            <input type="number" id="pstock" name="stock" min="0" required></div>
        </div>
        <div class="form-group"><label for="psizes">Sizes (comma-separated)</label>
          <input type="text" id="psizes" name="sizes" placeholder="XS,S,M,L,XL,XXL"></div>
        <div class="form-group"><label for="pcolors">Colors (comma-separated)</label>
          <input type="text" id="pcolors" name="colors" placeholder="Navy,Black,White,Red"></div>
        <div class="form-group"><label for="pimg">Image URL</label>
          <input type="url" id="pimg" name="image_url" placeholder="https://..."></div>
        <div class="form-group"><label for="pcampaign">Campaign (optional)</label>
          <select id="pcampaign" name="campaign_id">
            <option value="">No campaign</option>
            ${campaigns.map(c=>`<option value="${c.id}">${esc(c.name)} (${c.campaign_type})</option>`).join('')}
          </select></div>
        <button type="submit" class="btn btn-success" style="width:100%">Create Product</button>
      </form></div>
      <div class="text-center mt-2"><a href="/merch/admin/products" class="btn btn-outline">&larr; Back to Products</a></div>`;
    res.send(renderPage('Add Product', merchLayout('Add Product', body, req), req.session?.user));
  }));

  app.post('/merch/admin/products/new', requireAdmin, ah(async (req, res) => {
    const name = (req.body.name || '').trim();
    const description = (req.body.description || '').trim();
    const category = (req.body.category || 't_shirts');
    const price = parseFloat(req.body.price) || 0;
    const stock = parseInt(req.body.stock) || 0;
    const sizesStr = (req.body.sizes || '').trim();
    const colorsStr = (req.body.colors || '').trim();
    const imageUrl = (req.body.image_url || '').trim();
    const campaignId = parseInt(req.body.campaign_id) || null;

    if (!name) return res.status(400).send('Product name is required');
    if (!CATEGORIES.includes(category)) return res.status(400).send('Invalid category');

    const sizes = sizesStr ? sizesStr.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const colors = colorsStr ? colorsStr.split(',').map(c=>c.trim()).filter(Boolean) : [];

    await pool.query(
      `INSERT INTO merch_products (tenant_id, name, description, price, stock, sizes, colors, image_url, category, campaign_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tenantId, name, description, price, stock, JSON.stringify(sizes), JSON.stringify(colors), imageUrl, category, campaignId]);
    audit({ action: 'merch_product_create', module: 'school-merch', product_name: name });
    res.redirect('/merch/admin/products');
  }));

  // Edit product
  app.get('/merch/admin/products/:id/edit', requireAdmin, ah(async (req, res) => {
    const { rows: [p] } = await pool.query(
      `SELECT * FROM merch_products WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    if (!p) return res.status(404).send('Product not found');
    const { rows: campaigns } = await pool.query(
      `SELECT * FROM merch_campaigns WHERE tenant_id = $1 AND active = true ORDER BY name`, [tenantId]);
    const sizes = parseJSONB(p.sizes);
    const colors = parseJSONB(p.colors);
    const body = `<div class="card" style="max-width:600px;margin:0 auto">
      <h2 style="color:${BRAND};margin-bottom:16px">Edit: ${esc(p.name)}</h2>
      <form method="POST" action="/merch/admin/products/${p.id}/edit">
        <div class="form-group"><label for="pname">Product Name *</label>
          <input type="text" id="pname" name="name" required value="${esc(p.name)}"></div>
        <div class="form-group"><label for="pdesc">Description</label>
          <textarea id="pdesc" name="description" rows="2">${esc(p.description||'')}</textarea></div>
        <div class="form-group"><label for="pcat">Category *</label>
          <select id="pcat" name="category" required>
            ${CATEGORIES.map(c=>`<option value="${c}" ${c===p.category?'selected':''}>${catLabel(c)}</option>`).join('')}
          </select></div>
        <div class="grid-2">
          <div class="form-group"><label for="pprice">Price ($) *</label>
            <input type="number" id="pprice" name="price" step="0.01" min="0" required value="${p.price}"></div>
          <div class="form-group"><label for="pstock">Stock *</label>
            <input type="number" id="pstock" name="stock" min="0" required value="${p.stock}"></div>
        </div>
        <div class="form-group"><label for="psizes">Sizes (comma-separated)</label>
          <input type="text" id="psizes" name="sizes" value="${sizes.map(s=>esc(s)).join(',')}"></div>
        <div class="form-group"><label for="pcolors">Colors (comma-separated)</label>
          <input type="text" id="pcolors" name="colors" value="${colors.map(c=>esc(c)).join(',')}"></div>
        <div class="form-group"><label for="pimg">Image URL</label>
          <input type="url" id="pimg" name="image_url" value="${esc(p.image_url||'')}"></div>
        <div class="form-group"><label for="pcampaign">Campaign</label>
          <select id="pcampaign" name="campaign_id">
            <option value="">No campaign</option>
            ${campaigns.map(c=>`<option value="${c.id}" ${c.id===p.campaign_id?'selected':''}>${esc(c.name)}</option>`).join('')}
          </select></div>
        <button type="submit" class="btn btn-success" style="width:100%">Save Changes</button>
      </form></div>`;
    res.send(renderPage('Edit Product', merchLayout('Edit Product', body, req), req.session?.user));
  }));

  app.post('/merch/admin/products/:id/edit', requireAdmin, ah(async (req, res) => {
    const { id } = req.params;
    const name = (req.body.name || '').trim();
    const description = (req.body.description || '').trim();
    const category = (req.body.category || 't_shirts');
    const price = parseFloat(req.body.price) || 0;
    const stock = parseInt(req.body.stock) || 0;
    const sizesStr = (req.body.sizes || '').trim();
    const colorsStr = (req.body.colors || '').trim();
    const imageUrl = (req.body.image_url || '').trim();
    const campaignId = parseInt(req.body.campaign_id) || null;
    if (!name) return res.status(400).send('Name required');
    const sizes = sizesStr ? sizesStr.split(',').map(s=>s.trim()).filter(Boolean) : [];
    const colors = colorsStr ? colorsStr.split(',').map(c=>c.trim()).filter(Boolean) : [];
    await pool.query(
      `UPDATE merch_products SET name=$1,description=$2,category=$3,price=$4,stock=$5,sizes=$6,colors=$7,image_url=$8,campaign_id=$9,updated_at=NOW()
       WHERE id=$10 AND tenant_id=$11`,
      [name, description, category, price, stock, JSON.stringify(sizes), JSON.stringify(colors), imageUrl, campaignId, id, tenantId]);
    audit({ action: 'merch_product_edit', module: 'school-merch', product_id: id });
    res.redirect('/merch/admin/products');
  }));

  // Toggle product active/inactive
  app.post('/merch/admin/products/:id/toggle', requireAdmin, ah(async (req, res) => {
    await pool.query(
      `UPDATE merch_products SET active = NOT active, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [req.params.id, tenantId]);
    res.redirect('/merch/admin/products');
  }));

  // ═══════════════════════════════════════════════════════════════
  // 7. INVENTORY MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  app.get('/merch/admin/inventory', requireAdmin, ah(async (req, res) => {
    const { rows: products } = await pool.query(
      `SELECT * FROM merch_products WHERE tenant_id = $1 ORDER BY stock ASC, name`, [tenantId]);
    const lowCount = products.filter(p => p.stock <= p.reorder_level).length;
    const totalValue = products.reduce((s,p) => s + (Number(p.price) * p.stock), 0);

    let rows = '';
    products.forEach(p => {
      const low = p.stock <= p.reorder_level;
      rows += `<tr style="${low?'background:#fef3c7':''}">
        <td><strong>${esc(p.name)}</strong></td>
        <td>${catLabel(p.category)}</td>
        <td class="${low?'stock-low':'stock-ok'}" style="font-weight:700">${p.stock}</td>
        <td>${p.reorder_level}</td>
        <td>${fmtMoney(p.price)}</td>
        <td>${fmtMoney(p.price * p.stock)}</td>
        <td>
          <form method="POST" action="/merch/admin/inventory/${p.id}/restock" style="display:flex;gap:4px">
            <input type="number" name="qty" value="0" min="0" style="width:70px;padding:4px;border:1px solid #d1d5db;border-radius:4px" aria-label="Restock quantity">
            <button type="submit" class="btn btn-warning btn-sm">Restock</button>
          </form>
        </td></tr>`;
    });

    // Stock history
    const { rows: history } = await pool.query(
      `SELECT sh.*, p.name AS product_name FROM merch_stock_history sh
       JOIN merch_products p ON p.id = sh.product_id
       WHERE sh.tenant_id = $1 ORDER BY sh.created_at DESC LIMIT 20`, [tenantId]);
    let histRows = '';
    history.forEach(h => {
      const badge = h.change_type === 'sale' ? `<span class="status status-pending">SALE -${h.quantity}</span>` :
                     h.change_type === 'restock' ? `<span class="status status-ready">RESTOCK +${h.quantity}</span>` :
                     `<span class="status">${h.change_type} ${h.quantity}</span>`;
      histRows += `<tr><td>${esc(h.product_name)}</td><td>${badge}</td><td>${esc(h.notes||'')}</td>
        <td class="muted">${new Date(h.created_at).toLocaleString()}</td></tr>`;
    });

    const body = `
      <div class="stat-row">
        <div class="stat-box"><div class="num">${products.length}</div><div class="lbl">Total Products</div></div>
        <div class="stat-box"><div class="num" style="color:${lowCount>0?DANGER:SUCCESS}">${lowCount}</div><div class="lbl">Low Stock</div></div>
        <div class="stat-box"><div class="num">${fmtMoney(totalValue)}</div><div class="lbl">Inventory Value</div></div>
      </div>
      ${lowCount > 0 ? `<div class="alert alert-warn">⚠️ ${lowCount} product(s) need restocking.</div>` : `<div class="alert alert-success">✓ All products are well stocked.</div>`}
      <div class="card"><h2 style="color:${BRAND};margin-bottom:16px">📦 Inventory</h2>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Category</th><th>Stock</th><th>Reorder At</th><th>Unit Price</th><th>Total Value</th><th>Restock</th></tr></thead>
        <tbody>${rows}</tbody></table></div></div>
      <div class="card"><h2 style="color:${BRAND_DARK};margin-bottom:12px">📜 Stock History (Last 20)</h2>
        <div class="table-wrap"><table><thead><tr><th>Product</th><th>Change</th><th>Notes</th><th>Date</th></tr></thead>
        <tbody>${histRows || '<tr><td colspan="4" class="text-center muted">No history yet</td></tr>'}</tbody></table></div></div>`;
    res.send(renderPage('Inventory', merchLayout('Inventory', body, req), req.session?.user));
  }));

  app.post('/merch/admin/inventory/:id/restock', requireAdmin, ah(async (req, res) => {
    const { id } = req.params;
    const qty = parseInt(req.body.qty) || 0;
    if (qty <= 0) return res.redirect('/merch/admin/inventory');
    await pool.query(
      `UPDATE merch_products SET stock = stock + $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, [qty, id, tenantId]);
    await pool.query(
      `INSERT INTO merch_stock_history (tenant_id, product_id, change_type, quantity, notes, user_id)
       VALUES ($1,$2,'restock',$3,$4,$5)`,
      [tenantId, id, qty, 'Manual restock', req.session.user.id || 0]);
    audit({ action: 'merch_restock', module: 'school-merch', product_id: id, quantity: qty });
    res.redirect('/merch/admin/inventory');
  }));

  // ═══════════════════════════════════════════════════════════════
  // 8. CAMPAIGN PRODUCTS
  // ═══════════════════════════════════════════════════════════════

  app.get('/merch/admin/campaigns', requireAdmin, ah(async (req, res) => {
    const { rows: campaigns } = await pool.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM merch_products WHERE campaign_id=c.id) AS product_count
       FROM merch_campaigns c WHERE c.tenant_id = $1 ORDER BY c.start_date DESC`, [tenantId]);
    const today = new Date().toISOString().split('T')[0];
    let rows = '';
    campaigns.forEach(c => {
      const isActive = c.active && c.start_date <= today && c.end_date >= today;
      const isUpcoming = c.start_date > today;
      const isExpired = c.end_date < today;
      let statusBadge = '';
      if (isExpired) statusBadge = '<span class="status status-pending">EXPIRED</span>';
      else if (isUpcoming) statusBadge = '<span class="status status-confirmed">UPCOMING</span>';
      else if (isActive) statusBadge = '<span class="status status-ready">ACTIVE</span>';
      else statusBadge = '<span class="status status-pending">INACTIVE</span>';
      rows += `<tr>
        <td><strong>${esc(c.name)}</strong></td><td>${esc(c.campaign_type)}</td>
        <td>${c.start_date}</td><td>${c.end_date}</td>
        <td>${c.product_count} products</td><td>${statusBadge}</td>
        <td style="white-space:nowrap">
          <a href="/merch/admin/campaigns/${c.id}/edit" class="btn btn-primary btn-sm">Edit</a>
          <form method="POST" action="/merch/admin/campaigns/${c.id}/toggle" style="display:inline">
            <button type="submit" class="btn btn-sm ${c.active?'btn-danger':'btn-success'}">${c.active?'Disable':'Enable'}</button></form>
        </td></tr>`;
    });
    const body = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="color:${BRAND}">🎯 Campaigns (${campaigns.length})</h2>
        <a href="/merch/admin/campaigns/new" class="btn btn-primary">+ New Campaign</a>
      </div>
      <div class="alert alert-info">Campaigns let you create limited-edition merch for events like sports days, leavers, concerts, and fundraisers.</div>
      <div class="card"><div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th>Start</th><th>End</th><th>Products</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" class="text-center muted">No campaigns yet</td></tr>'}</tbody></table></div></div>`;
    res.send(renderPage('Campaigns', merchLayout('Campaigns', body, req), req.session?.user));
  }));

  // New campaign form
  app.get('/merch/admin/campaigns/new', requireAdmin, ah(async (req, res) => {
    const body = `<div class="card" style="max-width:600px;margin:0 auto">
      <h2 style="color:${BRAND};margin-bottom:16px">+ New Campaign</h2>
      <form method="POST" action="/merch/admin/campaigns/new">
        <div class="form-group"><label for="cname">Campaign Name *</label>
          <input type="text" id="cname" name="name" required placeholder="e.g. Sports Day 2025 Edition"></div>
        <div class="form-group"><label for="cdesc">Description</label>
          <textarea id="cdesc" name="description" rows="2" placeholder="What is this campaign about..."></textarea></div>
        <div class="form-group"><label for="ctype">Campaign Type *</label>
          <select id="ctype" name="campaign_type" required>
            ${CAMPAIGN_TYPES.map(t=>`<option value="${t}">${catLabel(t)}</option>`).join('')}
          </select></div>
        <div class="grid-2">
          <div class="form-group"><label for="cstart">Start Date *</label>
            <input type="date" id="cstart" name="start_date" required></div>
          <div class="form-group"><label for="cend">End Date *</label>
            <input type="date" id="cend" name="end_date" required></div>
        </div>
        <button type="submit" class="btn btn-success" style="width:100%">Create Campaign</button>
      </form></div>
      <div class="text-center mt-2"><a href="/merch/admin/campaigns" class="btn btn-outline">&larr; Back to Campaigns</a></div>`;
    res.send(renderPage('New Campaign', merchLayout('New Campaign', body, req), req.session?.user));
  }));

  app.post('/merch/admin/campaigns/new', requireAdmin, ah(async (req, res) => {
    const name = (req.body.name || '').trim();
    const description = (req.body.description || '').trim();
    const campaignType = (req.body.campaign_type || 'custom');
    const startDate = req.body.start_date;
    const endDate = req.body.end_date;
    if (!name || !startDate || !endDate) return res.status(400).send('Name, start, and end dates are required');
    if (!CAMPAIGN_TYPES.includes(campaignType)) return res.status(400).send('Invalid campaign type');
    await pool.query(
      `INSERT INTO merch_campaigns (tenant_id, name, description, campaign_type, start_date, end_date)
       VALUES ($1,$2,$3,$4,$5,$6)`, [tenantId, name, description, campaignType, startDate, endDate]);
    audit({ action: 'merch_campaign_create', module: 'school-merch', campaign_name: name });
    res.redirect('/merch/admin/campaigns');
  }));

  // Edit campaign
  app.get('/merch/admin/campaigns/:id/edit', requireAdmin, ah(async (req, res) => {
    const { rows: [c] } = await pool.query(
      `SELECT * FROM merch_campaigns WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    if (!c) return res.status(404).send('Campaign not found');
    const body = `<div class="card" style="max-width:600px;margin:0 auto">
      <h2 style="color:${BRAND};margin-bottom:16px">Edit: ${esc(c.name)}</h2>
      <form method="POST" action="/merch/admin/campaigns/${c.id}/edit">
        <div class="form-group"><label for="cname">Campaign Name *</label>
          <input type="text" id="cname" name="name" required value="${esc(c.name)}"></div>
        <div class="form-group"><label for="cdesc">Description</label>
          <textarea id="cdesc" name="description" rows="2">${esc(c.description||'')}</textarea></div>
        <div class="form-group"><label for="ctype">Campaign Type *</label>
          <select id="ctype" name="campaign_type" required>
            ${CAMPAIGN_TYPES.map(t=>`<option value="${t}" ${t===c.campaign_type?'selected':''}>${catLabel(t)}</option>`).join('')}
          </select></div>
        <div class="grid-2">
          <div class="form-group"><label for="cstart">Start Date *</label>
            <input type="date" id="cstart" name="start_date" required value="${c.start_date}"></div>
          <div class="form-group"><label for="cend">End Date *</label>
            <input type="date" id="cend" name="end_date" required value="${c.end_date}"></div>
        </div>
        <button type="submit" class="btn btn-success" style="width:100%">Save Changes</button>
      </form></div>`;
    res.send(renderPage('Edit Campaign', merchLayout('Edit Campaign', body, req), req.session?.user));
  }));

  app.post('/merch/admin/campaigns/:id/edit', requireAdmin, ah(async (req, res) => {
    const { id } = req.params;
    const name = (req.body.name || '').trim();
    const description = (req.body.description || '').trim();
    const campaignType = (req.body.campaign_type || 'custom');
    const startDate = req.body.start_date;
    const endDate = req.body.end_date;
    if (!name || !startDate || !endDate) return res.status(400).send('Missing required fields');
    await pool.query(
      `UPDATE merch_campaigns SET name=$1,description=$2,campaign_type=$3,start_date=$4,end_date=$5
       WHERE id=$6 AND tenant_id=$7`, [name, description, campaignType, startDate, endDate, id, tenantId]);
    res.redirect('/merch/admin/campaigns');
  }));

  app.post('/merch/admin/campaigns/:id/toggle', requireAdmin, ah(async (req, res) => {
    await pool.query(
      `UPDATE merch_campaigns SET active = NOT active WHERE id = $1 AND tenant_id = $2`, [req.params.id, tenantId]);
    res.redirect('/merch/admin/campaigns');
  }));

  // ═══════════════════════════════════════════════════════════════
  // 9. REVENUE DASHBOARD — SVG CHARTS
  // ═══════════════════════════════════════════════════════════════

  app.get('/merch/admin/revenue', requireAdmin, ah(async (req, res) => {
    const tid = tenantId;

    // Revenue by product (top 10)
    const { rows: byProduct } = await pool.query(
      `SELECT oi.product_name, SUM(oi.subtotal)::numeric AS revenue, SUM(oi.quantity)::int AS units_sold
       FROM merch_order_items oi
       JOIN merch_orders o ON o.id = oi.order_id
       WHERE oi.tenant_id = $1 AND o.status != 'pending'
       GROUP BY oi.product_name ORDER BY revenue DESC LIMIT 10`, [tid]);

    // Daily sales trend (last 14 days)
    const { rows: dailySales } = await pool.query(
      `SELECT DATE(o.created_at) AS sale_date, COALESCE(SUM(o.total),0)::numeric AS revenue, COUNT(*)::int AS orders
       FROM merch_orders o WHERE o.tenant_id = $1 AND o.created_at >= CURRENT_DATE - INTERVAL '13 days'
       GROUP BY DATE(o.created_at) ORDER BY sale_date`, [tid]);

    // Category breakdown
    const { rows: byCategory } = await pool.query(
      `SELECT p.category, SUM(oi.subtotal)::numeric AS revenue
       FROM merch_order_items oi
       JOIN merch_products p ON p.id = oi.product_id
       JOIN merch_orders o ON o.id = oi.order_id
       WHERE oi.tenant_id = $1 AND o.status != 'pending'
       GROUP BY p.category ORDER BY revenue DESC`, [tid]);

    // Summary stats
    const { rows: summary } = await pool.query(
      `SELECT
         COUNT(*)::int AS total_orders,
         COALESCE(SUM(total),0)::numeric AS total_revenue,
         COALESCE(AVG(total),0)::numeric AS avg_order,
         COUNT(*) FILTER (WHERE created_at >= CURRENT_DATE)::int AS today_orders,
         COALESCE(SUM(total) FILTER (WHERE created_at >= CURRENT_DATE),0)::numeric AS today_revenue
       FROM merch_orders WHERE tenant_id = $1`, [tid]);

    const s = summary[0];

    // Build charts
    const barData = byProduct.map(r => ({
      label: r.product_name, value: Number(r.revenue),
      display: fmtMoney(r.revenue), color: BRAND
    }));
    const barChart = byProduct.length ? svgBarChart(barData, { title: 'Revenue by Product (Top 10)' }) : '<p class="muted text-center">No sales data yet.</p>';

    const lineData = dailySales.map(r => ({
      label: new Date(r.sale_date).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
      value: Number(r.revenue), display: fmtMoney(r.revenue)
    }));
    const lineChart = dailySales.length ? svgLineChart(lineData, { title: 'Daily Sales Trend (14 Days)' }) : '<p class="muted text-center">No sales data yet.</p>';

    const donutColors = [BRAND, SUCCESS, WARNING, DANGER, '#8b5cf6', '#ec4899', '#14b8a6'];
    const donutData = byCategory.map((r, i) => ({
      label: catLabel(r.category), value: Number(r.revenue), color: donutColors[i % donutColors.length]
    }));
    const donutChart = byCategory.length ? svgDonutChart(donutData, { title: 'Revenue by Category' }) : '<p class="muted text-center">No sales data yet.</p>';

    const body = `
      <h2 style="color:${BRAND};margin-bottom:16px">💰 Revenue Dashboard</h2>
      <div class="stat-row">
        <div class="stat-box"><div class="num">${fmtMoney(s.total_revenue)}</div><div class="lbl">Total Revenue</div></div>
        <div class="stat-box"><div class="num">${s.total_orders}</div><div class="lbl">Total Orders</div></div>
        <div class="stat-box"><div class="num">${fmtMoney(s.avg_order)}</div><div class="lbl">Avg Order Value</div></div>
        <div class="stat-box"><div class="num">${fmtMoney(s.today_revenue)}</div><div class="lbl">Today's Revenue</div></div>
        <div class="stat-box"><div class="num">${s.today_orders}</div><div class="lbl">Today's Orders</div></div>
      </div>
      <div class="charts-grid">
        <div class="card">${barChart}</div>
        <div class="card">${lineChart}</div>
        <div class="card" style="display:flex;justify-content:center">${donutChart}</div>
      </div>
      <div class="flex mt-4" style="justify-content:center">
        <a href="/merch/admin" class="btn btn-outline">&larr; Back to Admin</a>
      </div>`;
    res.send(renderPage('Revenue Dashboard', merchLayout('Revenue Dashboard', body, req), req.session?.user));
  }));

  // ═══════════════════════════════════════════════════════════════
  // END OF MODULE
  // ═══════════════════════════════════════════════════════════════
};
