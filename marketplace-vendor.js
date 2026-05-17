// ============================================================
// COMFORT ZONE — Vendor Marketplace Module
// Vendor storefronts, products, reviews, ratings, wishlists,
// comparisons, trust system, admin dashboard, landing page.
// Self-executing module — uses globals set by server.js.
// ============================================================

'use strict';

const CATEGORIES = ['Electronics','Books','Uniforms','Stationery','Food','Services','Software','Equipment','Art','Health','Fashion'];
const CAT_ICONS = {Electronics:'💻',Books:'📚',Uniforms:'👔',Stationery:'✏️',Food:'🍽️',Services:'🔧',Software:'💿',Equipment:'⛏️',Art:'🎨',Health:'❤️',Fashion:'👗'};
const CAT_COLORS = {Electronics:'#3b82f6',Books:'#8b5cf6',Uniforms:'#059669',Stationery:'#f59e0b',Food:'#ef4444',Services:'#06b6d4',Software:'#6366f1',Equipment:'#78716c',Art:'#ec4899',Health:'#10b981',Fashion:'#f43f5e'};

// ── Helpers ──────────────────────────────────────────────────
const starsHtml = (rating, size = 16) => {
  const r = Math.max(0, Math.min(5, parseFloat(rating) || 0));
  const full = Math.floor(r);
  const half = r - full >= 0.5;
  let s = '';
  for (let i = 0; i < 5; i++) {
    if (i < full) s += `<span style="color:#f59e0b;font-size:${size}px">★</span>`;
    else if (i === full && half) s += `<span style="color:#f59e0b;font-size:${size}px">★</span>`;
    else s += `<span style="color:#d1d5db;font-size:${size}px">★</span>`;
  }
  return s;
};

const formatPrice = (price, currency = 'UGX') => `${(currency||'UGX')} ${Number(price||0).toLocaleString()}`;

const trustBadges = (store) => {
  const b = [];
  if (store.is_verified) b.push(`<span class="tag tag-green">✓ Verified</span>`);
  const age = store.created_at ? (Date.now() - new Date(store.created_at).getTime()) / 86400000 : 0;
  if (age < 30) b.push(`<span class="tag" style="background:#ede9fe;color:#6d28d9">New Seller</span>`);
  if (store.review_count >= 10 && store.rating >= 4) b.push(`<span class="tag" style="background:#fef3c7;color:#92400e">⭐ Rising Star</span>`);
  if (store.review_count >= 50 && store.rating >= 4.5) b.push(`<span class="tag" style="background:#fce7f3;color:#be185d">🏆 Top Seller</span>`);
  if (store.is_verified && store.review_count >= 20) b.push(`<span class="tag" style="background:#dbeafe;color:#1e40af">💎 Verified Pro</span>`);
  return b.join(' ');
};

const trustScore = (store) => {
  let score = 0;
  if (store.rating) score += Math.min(40, store.rating * 8);
  if (store.review_count) score += Math.min(25, store.review_count * 0.5);
  const age = store.created_at ? (Date.now() - new Date(store.created_at).getTime()) / 86400000 : 0;
  score += Math.min(20, age * 0.2);
  if (store.is_verified) score += 15;
  return Math.min(100, Math.round(score));
};

// ── MIGRATIONS ───────────────────────────────────────────────
migrations.push(`CREATE TABLE IF NOT EXISTS vendor_stores (
  id SERIAL PRIMARY KEY, tenant_id INTEGER, owner_email TEXT, store_name TEXT NOT NULL, description TEXT,
  logo_url TEXT, cover_url TEXT, category TEXT, tags TEXT[], rating NUMERIC DEFAULT 0, review_count INTEGER DEFAULT 0,
  is_verified BOOLEAN DEFAULT false, is_active BOOLEAN DEFAULT true, location TEXT, website TEXT, phone TEXT,
  social_links JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
)`);
migrations.push(`CREATE TABLE IF NOT EXISTS vendor_products (
  id SERIAL PRIMARY KEY, store_id INTEGER REFERENCES vendor_stores(id), tenant_id INTEGER, name TEXT NOT NULL,
  description TEXT, price NUMERIC NOT NULL, currency TEXT DEFAULT 'UGX', compare_price NUMERIC, category TEXT,
  images TEXT[] DEFAULT '{}', stock INTEGER DEFAULT 0, sku TEXT, rating NUMERIC DEFAULT 0, review_count INTEGER DEFAULT 0,
  is_featured BOOLEAN DEFAULT false, is_active BOOLEAN DEFAULT true, tags TEXT[], specs JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
)`);
migrations.push(`CREATE TABLE IF NOT EXISTS vendor_reviews (
  id SERIAL PRIMARY KEY, store_id INTEGER REFERENCES vendor_stores(id), product_id INTEGER, reviewer_email TEXT,
  reviewer_name TEXT, rating INTEGER CHECK (rating BETWEEN 1 AND 5), title TEXT, review_text TEXT,
  images TEXT[] DEFAULT '{}', is_verified_purchase BOOLEAN DEFAULT false, helpful_count INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW()
)`);
migrations.push(`CREATE TABLE IF NOT EXISTS wishlists (
  id SERIAL PRIMARY KEY, user_email TEXT, tenant_id INTEGER, product_id INTEGER REFERENCES vendor_products(id),
  created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(user_email, product_id)
)`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_vs_tenant ON vendor_stores(tenant_id)`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_vs_active ON vendor_stores(is_active) WHERE is_active=true`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_vp_store ON vendor_products(store_id)`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_vp_active ON vendor_products(is_active) WHERE is_active=true`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_vp_category ON vendor_products(category)`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_vr_store ON vendor_reviews(store_id)`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_vr_product ON vendor_reviews(product_id)`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_wl_user ON wishlists(user_email)`);

['vendor_stores','vendor_products','vendor_reviews','wishlists'].forEach(t => VALID_TABLES.add(t));

// =================================================================
// 8. MARKETPLACE LANDING PAGE — GET /shop
// =================================================================
app.get('/shop', ah(async (req, res) => {
  const featured = (await pool.query(
    `SELECT s.*, COUNT(p.id)::int as product_count FROM vendor_stores s
     LEFT JOIN vendor_products p ON p.store_id=s.id AND p.is_active=true
     WHERE s.is_active=true AND s.is_verified=true GROUP BY s.id ORDER BY s.rating DESC LIMIT 8`
  )).rows;
  const topProducts = (await pool.query(
    `SELECT p.*, s.store_name, s.logo_url FROM vendor_products p
     JOIN vendor_stores s ON s.id=p.store_id AND s.is_active=true
     WHERE p.is_active=true AND p.is_featured=true ORDER BY p.rating DESC LIMIT 12`
  )).rows;
  const trending = (await pool.query(
    `SELECT p.*, s.store_name FROM vendor_products p
     JOIN vendor_stores s ON s.id=p.store_id AND s.is_active=true
     WHERE p.is_active=true ORDER BY p.review_count DESC NULLS LAST, p.created_at DESC LIMIT 8`
  )).rows;
  const newProducts = (await pool.query(
    `SELECT p.*, s.store_name FROM vendor_products p
     JOIN vendor_stores s ON s.id=p.store_id AND s.is_active=true
     WHERE p.is_active=true ORDER BY p.created_at DESC LIMIT 8`
  )).rows;

  const productCard = (p) => `<div class="mp-card">
    <div style="position:relative;height:160px;background:linear-gradient(135deg,#f1f5f9,#e2e8f0);border-radius:12px 12px 0 0;display:flex;align-items:center;justify-content:center;overflow:hidden">
      ${p.images && p.images[0] ? `<img src="${esc(p.images[0])}" style="width:100%;height:100%;object-fit:cover" alt="${esc(p.name)}">` : `<span style="font-size:48px;opacity:0.4">${CAT_ICONS[p.category]||'📦'}</span>`}
      ${p.compare_price && p.compare_price > p.price ? `<span class="mp-discount-badge">${Math.round((1-p.price/p.compare_price)*100)}% OFF</span>` : ''}
    </div>
    <div style="padding:14px">
      <div class="muted" style="font-size:11px;margin-bottom:4px">${esc(p.store_name||'')}</div>
      <a href="/marketplace/products/${p.id}" style="color:#1e293b;text-decoration:none;font-weight:600;font-size:14px;display:block;margin-bottom:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</a>
      <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">${starsHtml(p.rating||0,13)}<span class="muted" style="font-size:11px">(${p.review_count||0})</span></div>
      <div style="display:flex;align-items:baseline;gap:8px">
        <strong style="color:#059669;font-size:16px">${formatPrice(p.price,p.currency)}</strong>
        ${p.compare_price && p.compare_price > p.price ? `<span class="muted" style="text-decoration:line-through;font-size:12px">${formatPrice(p.compare_price,p.currency)}</span>` : ''}
      </div>
    </div></div>`;

  const vendorCard = (s) => `<div style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #e2e8f0;transition:.2s;cursor:pointer" onclick="location.href='/marketplace/vendors/${s.id}'">
    <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
      <div style="width:50px;height:50px;border-radius:50%;background:linear-gradient(135deg,${CAT_COLORS[s.category]||'#6366f1'},${CAT_COLORS[s.category]||'#6366f1'}88);display:flex;align-items:center;justify-content:center;font-size:22px;color:white;flex-shrink:0;overflow:hidden">
        ${s.logo_url ? `<img src="${esc(s.logo_url)}" style="width:100%;height:100%;object-fit:cover">` : (CAT_ICONS[s.category]||'🏪')}
      </div>
      <div><div style="font-weight:700;font-size:15px">${esc(s.store_name)}</div><div class="muted" style="font-size:12px">${s.location||'Online'} · ${s.product_count||0} products</div></div>
    </div>
    <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">${starsHtml(s.rating||0,14)}<span class="muted" style="font-size:12px">${Number(s.rating||0).toFixed(1)} (${s.review_count||0})</span></div>
    <p style="font-size:13px;color:#64748b;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(s.description||'')}</p>
    ${trustBadges(s).split('</span>').slice(0,2).join('</span>')}${trustBadges(s).split('</span>').length>2?'<span class="muted" style="font-size:11px"> +' +(trustBadges(s).split('</span>').length-2)+'</span>':''}
  </div>`;

  const html = `
  <style>
    .mp-hero{background:linear-gradient(135deg,#4f46e5 0%,#7c3aed 50%,#a855f7 100%);color:white;padding:60px 30px;text-align:center;border-radius:0 0 32px 32px;position:relative;overflow:hidden}
    .mp-hero::before{content:'';position:absolute;inset:0;background:radial-gradient(circle at 20% 80%,rgba(255,255,255,.1) 0%,transparent 50%),radial-gradient(circle at 80% 20%,rgba(255,255,255,.08) 0%,transparent 50%)}
    .mp-search{display:flex;gap:12px;max-width:640px;margin:24px auto 0}
    .mp-search input{flex:1;padding:14px 20px;border-radius:14px;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:white;font-size:16px;backdrop-filter:blur(8px)}
    .mp-search input::placeholder{color:rgba(255,255,255,.7)}
    .mp-search button{padding:14px 28px;border-radius:14px;background:white;color:#4f46e5;font-weight:700;border:none;cursor:pointer;font-size:16px}
    .mp-section{max-width:1200px;margin:40px auto;padding:0 20px}
    .mp-section-title{font-size:24px;font-weight:800;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center}
    .mp-section-title a{font-size:14px;color:#4f46e5;font-weight:600}
    .mp-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px}
    .mp-card{background:white;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #e2e8f0;overflow:hidden;transition:.2s}
    .mp-card:hover{transform:translateY(-4px);box-shadow:0 8px 24px rgba(0,0,0,.1)}
    .mp-discount-badge{position:absolute;top:10px;right:10px;background:#ef4444;color:white;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700}
    .mp-cats{display:flex;gap:12px;flex-wrap:wrap;justify-content:center;margin:30px auto 0;max-width:1200px}
    .mp-cat{display:flex;flex-direction:column;align-items:center;gap:8px;padding:20px 16px;border-radius:16px;background:white;box-shadow:0 2px 8px rgba(0,0,0,.06);border:1px solid #e2e8f0;text-decoration:none;color:#1e293b;width:100px;transition:.2s}
    .mp-cat:hover{transform:translateY(-3px);box-shadow:0 6px 16px rgba(0,0,0,.1)}
    .mp-cat span{font-size:12px;font-weight:600;text-align:center}
    .mp-cta{text-align:center;padding:40px;background:linear-gradient(135deg,#f0fdf4,#dcfce7);border-radius:20px;margin:40px auto;max-width:1200px;border:1px solid #bbf7d0}
  </style>
  <div class="mp-hero">
    <h1 style="font-size:clamp(28px,5vw,48px);font-weight:900;margin-bottom:8px;position:relative">Vendor Marketplace</h1>
    <p style="font-size:clamp(14px,2vw,20px);opacity:.9;position:relative">Discover amazing products from trusted vendors</p>
    <form class="mp-search" action="/marketplace/products" method="GET" style="position:relative">
      <input name="q" placeholder="Search products, vendors, categories...">
      <button type="submit">Search</button>
    </form>
  </div>
  <div class="mp-cats" style="padding:0 20px">
    ${CATEGORIES.map(c => `<a href="/marketplace/products?category=${encodeURIComponent(c)}" class="mp-cat"><span style="font-size:28px">${CAT_ICONS[c]||'📦'}</span><span>${c}</span></a>`).join('')}
  </div>
  <div class="mp-section">
    <div class="mp-section-title">Featured Vendors <a href="/marketplace/vendors">View All →</a></div>
    <div class="mp-grid">${featured.length ? featured.map(vendorCard).join('') : '<p class="muted">No featured vendors yet.</p>'}</div>
  </div>
  <div class="mp-section">
    <div class="mp-section-title">Top Products <a href="/marketplace/products">View All →</a></div>
    <div class="mp-grid">${topProducts.length ? topProducts.map(productCard).join('') : '<p class="muted">No featured products yet.</p>'}</div>
  </div>
  <div class="mp-section">
    <div class="mp-section-title">Trending Now <a href="/marketplace/products?sort=trending">View All →</a></div>
    <div class="mp-grid">${trending.map(productCard).join('')}</div>
  </div>
  <div class="mp-section">
    <div class="mp-section-title">New Arrivals <a href="/marketplace/products?sort=new">View All →</a></div>
    <div class="mp-grid">${newProducts.map(productCard).join('')}</div>
  </div>
  <div class="mp-cta">
    <h2 style="font-size:28px;font-weight:800;margin-bottom:8px;color:#065f46">Become a Vendor</h2>
    <p style="color:#047857;margin-bottom:20px;font-size:16px">Start selling your products to thousands of customers today.</p>
    <a href="/api/vendors/register" class="btn btn-green" style="padding:16px 40px;font-size:16px;border-radius:14px">Open Your Store →</a>
  </div>`;
  res.send(renderPage('Marketplace', html));
}));

// =================================================================
// 1. VENDOR STOREFRONTS
// =================================================================
// GET /marketplace/vendors — Vendor grid with search & category filter
app.get('/marketplace/vendors', ah(async (req, res) => {
  const { q, category } = req.query;
  let where = 'WHERE s.is_active=true', params = [], pi = 1;
  if (q) { where += ` AND (s.store_name ILIKE $${pi} OR s.description ILIKE $${pi} OR $${pi} = ANY(COALESCE(s.tags,'{}')))`; params.push(`%${q}%`); pi++; }
  if (category) { where += ` AND s.category = $${pi}`; params.push(category); pi++; }
  const vendors = (await pool.query(
    `SELECT s.*, COUNT(p.id)::int as product_count FROM vendor_stores s
     LEFT JOIN vendor_products p ON p.store_id=s.id AND p.is_active=true
     ${where} GROUP BY s.id ORDER BY s.rating DESC NULLS LAST, s.created_at DESC`, params
  )).rows;

  const html = `
  <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:36px 30px;border-radius:0 0 24px 24px;margin-bottom:30px">
    <h1 style="font-size:28px;font-weight:800;margin-bottom:6px">Vendor Storefronts</h1>
    <p style="opacity:.85">Browse trusted vendors and their products</p>
    <form method="GET" style="display:flex;gap:10px;max-width:500px;margin-top:16px">
      <input name="q" value="${esc(q||'')}" placeholder="Search vendors..." style="flex:1;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:white;border-radius:12px">
      <button type="submit" class="btn" style="background:white;color:#4f46e5">Search</button>
    </form>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:24px">
    <a href="/marketplace/vendors${q?'?q='+encodeURIComponent(q):''}" class="btn btn-sm ${!category?'btn-green':'btn-outline'}">All</a>
    ${CATEGORIES.map(c => `<a href="/marketplace/vendors?category=${encodeURIComponent(c)}${q?'&q='+encodeURIComponent(q):''}" class="btn btn-sm ${category===c?'btn-green':'btn-outline'}">${CAT_ICONS[c]} ${c}</a>`).join('')}
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:20px">
    ${vendors.map(s => `<div style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #e2e8f0;cursor:pointer" onclick="location.href='/marketplace/vendors/${s.id}'">
      <div style="display:flex;align-items:center;gap:14px;margin-bottom:14px">
        <div style="width:56px;height:56px;border-radius:50%;background:linear-gradient(135deg,${CAT_COLORS[s.category]||'#6366f1'},${CAT_COLORS[s.category]||'#6366f1'}88);display:flex;align-items:center;justify-content:center;font-size:24px;color:white;flex-shrink:0;overflow:hidden">
          ${s.logo_url?`<img src="${esc(s.logo_url)}" style="width:100%;height:100%;object-fit:cover">`:(CAT_ICONS[s.category]||'🏪')}
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-weight:700;font-size:16px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(s.store_name)}</div>
          <div class="muted" style="font-size:12px">${esc(s.location||'Online')} · ${s.product_count} products</div>
          <div style="margin-top:4px">${starsHtml(s.rating,13)} <span class="muted" style="font-size:12px">${Number(s.rating||0).toFixed(1)}</span></div>
        </div>
      </div>
      <p style="font-size:13px;color:#64748b;margin-bottom:10px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(s.description||'')}</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap">${trustBadges(s)}</div>
    </div>`).join('')}
  </div>
  ${!vendors.length?'<div style="text-align:center;padding:60px"><h3>No vendors found</h3><p class="muted">Try a different search or filter</p></div>':''}`;
  res.send(renderPage('Vendor Storefronts', html));
}));

// GET /marketplace/vendors/:id — Vendor storefront page
app.get('/marketplace/vendors/:id', ah(async (req, res) => {
  const store = (await pool.query('SELECT * FROM vendor_stores WHERE id=$1 AND is_active=true', [req.params.id])).rows[0];
  if (!store) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2>Vendor Not Found</h2><a href="/marketplace/vendors" class="btn">Browse Vendors</a></div>'));
  const products = (await pool.query('SELECT * FROM vendor_products WHERE store_id=$1 AND is_active=true ORDER BY is_featured DESC, rating DESC', [store.id])).rows;
  const reviews = (await pool.query('SELECT * FROM vendor_reviews WHERE store_id=$1 ORDER BY created_at DESC LIMIT 20', [store.id])).rows;
  const ts = trustScore(store);

  const html = `
  <div style="background:linear-gradient(135deg,${CAT_COLORS[store.category]||'#6366f1'},${CAT_COLORS[store.category]||'#6366f1'}88);color:white;padding:40px 30px;border-radius:0 0 24px 24px;margin-bottom:30px">
    <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
      <div style="width:80px;height:80px;border-radius:50%;background:white;overflow:hidden;flex-shrink:0;display:flex;align-items:center;justify-content:center;font-size:36px">
        ${store.logo_url?`<img src="${esc(store.logo_url)}" style="width:100%;height:100%;object-fit:cover">`:(CAT_ICONS[store.category]||'🏪')}
      </div>
      <div style="flex:1;min-width:200px">
        <h1 style="font-size:28px;font-weight:800;margin-bottom:4px">${esc(store.store_name)} ${trustBadges(store)}</h1>
        <p style="opacity:.85;margin-bottom:8px">${esc(store.description||'')}</p>
        <div style="display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:14px">
          <span>${starsHtml(store.rating,18)} <strong>${Number(store.rating||0).toFixed(1)}</strong> (${store.review_count} reviews)</span>
          <span>📍 ${esc(store.location||'Online')}</span>
          ${store.website?`<a href="${esc(store.website)}" target="_blank" style="color:white">🌐 Website</a>`:''}
          ${store.phone?`<span>📞 ${esc(store.phone)}</span>`:''}
        </div>
      </div>
      <div style="text-align:center;min-width:100px">
        <div style="font-size:36px;font-weight:900">${ts}</div>
        <div style="font-size:12px;opacity:.8">Trust Score</div>
      </div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 360px;gap:24px">
    <div>
      <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">Products (${products.length})</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px">
        ${products.map(p => `<div style="background:white;border-radius:14px;box-shadow:0 2px 10px rgba(0,0,0,.06);border:1px solid #e2e8f0;overflow:hidden">
          <div style="height:140px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${p.images&&p.images[0]?`<img src="${esc(p.images[0])}" style="width:100%;height:100%;object-fit:cover">`:`<span style="font-size:40px;opacity:.3">${CAT_ICONS[p.category]||'📦'}</span>`}
          </div>
          <div style="padding:12px">
            <a href="/marketplace/products/${p.id}" style="font-weight:600;font-size:14px;color:#1e293b;text-decoration:none;display:block;margin-bottom:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(p.name)}</a>
            <div style="display:flex;align-items:center;gap:4px;margin-bottom:6px">${starsHtml(p.rating,12)}<span class="muted" style="font-size:11px">${p.review_count||0}</span></div>
            <div><strong style="color:#059669">${formatPrice(p.price,p.currency)}</strong>
            ${p.compare_price&&p.compare_price>p.price?`<span class="muted" style="text-decoration:line-through;font-size:12px;margin-left:6px">${formatPrice(p.compare_price,p.currency)}</span>`:''}</div>
          </div>
        </div>`).join('')}
      </div>
      ${!products.length?'<div style="text-align:center;padding:40px;color:#94a3b8"><p>No products listed yet</p></div>':''}
    </div>
    <div>
      <div style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,.06);border:1px solid #e2e8f0;margin-bottom:20px">
        <h3 style="font-weight:700;margin-bottom:12px">About This Vendor</h3>
        <p style="font-size:14px;color:#475569;line-height:1.7">${esc(store.description||'No description provided.')}</p>
        ${store.tags&&store.tags.length?`<div style="margin-top:12px;display:flex;gap:6px;flex-wrap:wrap">${store.tags.map(t=>`<span class="tag">${esc(t)}</span>`).join('')}</div>`:''}
        <div style="margin-top:16px;padding-top:16px;border-top:1px solid #f1f5f9">
          <a href="/marketplace/vendors/${store.id}/trust" class="btn btn-sm btn-outline" style="width:100%;text-align:center">View Trust Details →</a>
        </div>
      </div>
      <div style="background:white;border-radius:16px;padding:20px;box-shadow:0 2px 10px rgba(0,0,0,.06);border:1px solid #e2e8f0">
        <h3 style="font-weight:700;margin-bottom:12px">Reviews (${reviews.length})</h3>
        ${reviews.slice(0,5).map(r => `<div style="padding:10px 0;border-bottom:1px solid #f1f5f9">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong style="font-size:13px">${esc(r.reviewer_name||'Anonymous')}</strong>
            <span class="muted" style="font-size:11px">${r.created_at?new Date(r.created_at).toLocaleDateString():''}</span>
          </div>
          <div style="margin:4px 0">${starsHtml(r.rating,12)}</div>
          ${r.title?`<div style="font-weight:600;font-size:13px">${esc(r.title)}</div>`:''}
          ${r.review_text?`<p style="font-size:12px;color:#64748b;margin-top:2px">${esc(r.review_text).substring(0,120)}${r.review_text.length>120?'...':''}</p>`:''}
          ${r.is_verified_purchase?'<span class="tag tag-green" style="font-size:10px;margin-top:4px">✓ Verified Purchase</span>':''}
        </div>`).join('')}
        ${!reviews.length?'<p class="muted" style="font-size:13px">No reviews yet</p>':''}
      </div>
    </div>
  </div>`;
  res.send(renderPage(store.store_name, html));
}));

// POST /api/vendors/register — Register as vendor (auth)
app.post('/api/vendors/register', requireAuth, ah(async (req, res) => {
  const { store_name, description, category, location, website, phone } = req.body;
  if (!store_name || !store_name.trim()) return res.status(400).json({ error: 'Store name required' });
  const user = req.session.user;
  const existing = (await pool.query('SELECT id FROM vendor_stores WHERE owner_email=$1', [user.email])).rows[0];
  if (existing) return res.status(409).json({ error: 'You already have a store', store_id: existing.id });
  const r = await pool.query(
    `INSERT INTO vendor_stores (tenant_id,owner_email,store_name,description,category,location,website,phone) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
    [user.tenant_id, user.email, store_name.trim(), description||'', category||'', location||'', website||'', phone||'']
  );
  notify(user.email, 'Store Created', `Your store "${store_name}" has been created!`);
  res.status(201).json(r.rows[0]);
}));

// PUT /api/vendors/:id — Update storefront (owner only)
app.put('/api/vendors/:id', requireAuth, ah(async (req, res) => {
  const store = (await pool.query('SELECT * FROM vendor_stores WHERE id=$1', [req.params.id])).rows[0];
  if (!store) return res.status(404).json({ error: 'Store not found' });
  if (store.owner_email !== req.session.user.email && req.session.user.role !== 'admin') return res.status(403).json({ error: 'Not your store' });
  const { store_name, description, category, location, website, phone, logo_url, cover_url, tags } = req.body;
  const r = await pool.query(
    `UPDATE vendor_stores SET store_name=$1,description=$2,category=$3,location=$4,website=$5,phone=$6,logo_url=$7,cover_url=$8,tags=$9 WHERE id=$10 RETURNING *`,
    [store_name||store.store_name, description!==undefined?description:store.description, category||store.category,
     location!==undefined?location:store.location, website!==undefined?website:store.website, phone!==undefined?phone:store.phone,
     logo_url||store.logo_url, cover_url||store.cover_url, tags||store.tags, store.id]
  );
  res.json(r.rows[0]);
}));

// GET /admin/vendors — Admin vendor management
app.get('/admin/vendors', requireAuth, ah(async (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'super_admin')) return res.status(403).send('Admin only');
  const vendors = (await pool.query('SELECT s.*, COUNT(p.id)::int as product_count FROM vendor_stores s LEFT JOIN vendor_products p ON p.store_id=s.id GROUP BY s.id ORDER BY s.created_at DESC')).rows;
  const html = `
  <div class="flex-between" style="margin-bottom:24px"><h1 style="font-size:24px;font-weight:800">Vendor Management</h1><span class="tag">${vendors.length} vendors</span></div>
  <div style="overflow-x:auto"><table>
    <tr><th>ID</th><th>Store</th><th>Owner</th><th>Category</th><th>Products</th><th>Rating</th><th>Verified</th><th>Actions</th></tr>
    ${vendors.map(s => `<tr>
      <td>${s.id}</td><td><strong>${esc(s.store_name)}</strong></td><td>${esc(s.owner_email||'-')}</td>
      <td><span class="tag">${esc(s.category||'-')}</span></td><td>${s.product_count}</td>
      <td>${starsHtml(s.rating,13)} ${Number(s.rating||0).toFixed(1)}</td>
      <td>${s.is_verified?'<span class="tag tag-green">Yes</span>':'<span class="tag tag-red">No</span>'}</td>
      <td>
        <form method="POST" action="/api/admin/vendors/${s.id}/verify" style="display:inline">
          <button type="submit" class="btn btn-sm ${s.is_verified?'btn-outline':'btn-green'}">${s.is_verified?'Unverify':'Verify'}</button>
        </form>
        ${!s.is_active?`<button class="btn btn-sm btn-green" onclick="fetch('/api/vendors/${s.id}/activate',{method:'PUT'}).then(()=>location.reload())">Activate</button>`:''}
      </td>
    </tr>`).join('')}
  </table></div>`;
  res.send(renderPage('Admin Vendors', html, req.session.user));
}));

// =================================================================
// 2. PRODUCT LISTINGS & SEARCH
// =================================================================
// GET /marketplace/products — Product listing with filters
app.get('/marketplace/products', ah(async (req, res) => {
  const { q, category, min_price, max_price, sort, rating } = req.query;
  let where = 'WHERE p.is_active=true AND s.is_active=true', params = [], pi = 1;
  if (q) { where += ` AND (p.name ILIKE $${pi} OR p.description ILIKE $${pi})`; params.push(`%${q}%`); pi++; }
  if (category) { where += ` AND p.category = $${pi}`; params.push(category); pi++; }
  if (min_price) { where += ` AND p.price >= $${pi}`; params.push(parseFloat(min_price)); pi++; }
  if (max_price) { where += ` AND p.price <= $${pi}`; params.push(parseFloat(max_price)); pi++; }
  if (rating) { where += ` AND p.rating >= $${pi}`; params.push(parseFloat(rating)); pi++; }
  const orderMap = {new:'p.created_at DESC',price_low:'p.price ASC',price_high:'p.price DESC',rating:'p.rating DESC',trending:'p.review_count DESC NULLS LAST'};
  const orderBy = orderMap[sort] || 'p.created_at DESC';
  const products = (await pool.query(
    `SELECT p.*, s.store_name, s.logo_url FROM vendor_products p JOIN vendor_stores s ON s.id=p.store_id ${where} ORDER BY ${orderBy} LIMIT 60`, params
  )).rows;

  const html = `
  <div style="background:linear-gradient(135deg,#059669,#10b981);color:white;padding:36px 30px;border-radius:0 0 24px 24px;margin-bottom:30px">
    <h1 style="font-size:28px;font-weight:800;margin-bottom:6px">Browse Products</h1>
    <p style="opacity:.85">${products.length} products available</p>
    <form method="GET" style="display:flex;gap:10px;max-width:600px;margin-top:16px;flex-wrap:wrap">
      <input name="q" value="${esc(q||'')}" placeholder="Search products..." style="flex:1;min-width:200px;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:white;border-radius:12px;padding:12px 16px">
      <select name="category" style="border-radius:12px;padding:12px;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:white;min-width:140px">
        <option value="">All Categories</option>
        ${CATEGORIES.map(c => `<option value="${c}" ${category===c?'selected':''}>${c}</option>`).join('')}
      </select>
      <input name="min_price" value="${esc(min_price||'')}" placeholder="Min price" style="width:110px;border-radius:12px;padding:12px;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:white">
      <input name="max_price" value="${esc(max_price||'')}" placeholder="Max price" style="width:110px;border-radius:12px;padding:12px;border:2px solid rgba(255,255,255,.3);background:rgba(255,255,255,.15);color:white">
      <button type="submit" class="btn" style="background:white;color:#059669;font-weight:700">Search</button>
    </form>
  </div>
  <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:8px">
    <span class="muted" style="line-height:32px">Sort:</span>
    ${[{k:'new',l:'Newest'},{k:'rating',l:'Top Rated'},{k:'price_low',l:'Price: Low'},{k:'price_high',l:'Price: High'},{k:'trending',l:'Trending'}].map(o => `<a href="/marketplace/products?${new URLSearchParams({...req.query,sort:o.k})}" class="btn btn-sm ${sort===o.k?'btn-green':'btn-outline'}">${o.l}</a>`).join('')}
  </div>
  <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:20px;margin-top:20px">
    ${products.map(p => `<div style="background:white;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #e2e8f0;overflow:hidden;transition:.2s" onmouseover="this.style.transform='translateY(-3px)'" onmouseout="this.style.transform=''">
      <div style="position:relative;height:160px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;overflow:hidden">
        ${p.images&&p.images[0]?`<img src="${esc(p.images[0])}" style="width:100%;height:100%;object-fit:cover">`:`<span style="font-size:48px;opacity:.3">${CAT_ICONS[p.category]||'📦'}</span>`}
        ${p.compare_price&&p.compare_price>p.price?`<span style="position:absolute;top:10px;right:10px;background:#ef4444;color:white;padding:4px 10px;border-radius:8px;font-size:11px;font-weight:700">${Math.round((1-p.price/p.compare_price)*100)}% OFF</span>`:''}
      </div>
      <div style="padding:14px">
        <div class="muted" style="font-size:11px;margin-bottom:4px">${esc(p.store_name||'')}</div>
        <a href="/marketplace/products/${p.id}" style="font-weight:600;font-size:14px;color:#1e293b;text-decoration:none;display:block;margin-bottom:6px">${esc(p.name)}</a>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">${starsHtml(p.rating,13)}<span class="muted" style="font-size:11px">(${p.review_count||0})</span></div>
        <div style="display:flex;justify-content:space-between;align-items:center">
          <strong style="color:#059669">${formatPrice(p.price,p.currency)}</strong>
          ${p.stock>0?`<span class="tag tag-green" style="font-size:10px">In Stock</span>`:`<span class="tag tag-red" style="font-size:10px">Out of Stock</span>`}
        </div>
      </div>
    </div>`).join('')}
  </div>
  ${!products.length?'<div style="text-align:center;padding:60px"><h3>No products found</h3><p class="muted">Try adjusting your filters</p></div>':''}`;
  res.send(renderPage('Products', html));
}));

// GET /marketplace/products/:id — Product detail page
app.get('/marketplace/products/:id', ah(async (req, res) => {
  const p = (await pool.query(`SELECT p.*, s.store_name, s.logo_url, s.id as store_id FROM vendor_products p JOIN vendor_stores s ON s.id=p.store_id WHERE p.id=$1 AND p.is_active=true`, [req.params.id])).rows[0];
  if (!p) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2>Product Not Found</h2><a href="/marketplace/products" class="btn">Browse Products</a></div>'));
  const reviews = (await pool.query('SELECT * FROM vendor_reviews WHERE product_id=$1 ORDER BY created_at DESC', [p.id])).rows;
  const related = (await pool.query('SELECT * FROM vendor_products WHERE store_id=$1 AND id!=$2 AND is_active=true ORDER BY rating DESC LIMIT 4', [p.store_id, p.id])).rows;
  const specs = typeof p.specs === 'string' ? JSON.parse(p.specs || '{}') : (p.specs || {});
  const userEmail = req.session?.user?.email;
  const wishlisted = userEmail ? (await pool.query('SELECT 1 FROM wishlists WHERE user_email=$1 AND product_id=$2', [userEmail, p.id])).rows[0] : null;

  const html = `
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:32px;margin-top:20px" class="mp-detail-grid">
    <div>
      <div style="background:#f8fafc;border-radius:16px;height:380px;display:flex;align-items:center;justify-content:center;overflow:hidden;margin-bottom:20px">
        ${p.images&&p.images[0]?`<img src="${esc(p.images[0])}" style="max-width:100%;max-height:100%;object-fit:contain">`:`<span style="font-size:80px;opacity:.25">${CAT_ICONS[p.category]||'📦'}</span>`}
      </div>
      ${p.images&&p.images.length>1?`<div style="display:flex;gap:8px;overflow-x:auto;padding-bottom:8px">${p.images.map(img=>`<img src="${esc(img)}" style="width:80px;height:80px;border-radius:10px;object-fit:cover;border:2px solid #e2e8f0;cursor:pointer">`).join('')}</div>`:''}
    </div>
    <div>
      <div class="muted" style="margin-bottom:6px"><a href="/marketplace/vendors/${p.store_id}" style="color:#4f46e5">${esc(p.store_name)}</a></div>
      <h1 style="font-size:26px;font-weight:800;margin-bottom:8px">${esc(p.name)}</h1>
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:16px">${starsHtml(p.rating,18)} <span style="font-weight:600">${Number(p.rating||0).toFixed(1)}</span> <span class="muted">(${p.review_count||0} reviews)</span></div>
      <div style="margin-bottom:16px">
        <span style="font-size:28px;font-weight:900;color:#059669">${formatPrice(p.price,p.currency)}</span>
        ${p.compare_price&&p.compare_price>p.price?`<span style="font-size:18px;color:#94a3b8;text-decoration:line-through;margin-left:12px">${formatPrice(p.compare_price,p.currency)}</span><span class="tag tag-red" style="margin-left:8px">Save ${Math.round((1-p.price/p.compare_price)*100)}%</span>`:''}
      </div>
      <p style="font-size:15px;color:#475569;line-height:1.8;margin-bottom:20px">${esc(p.description||'No description available.')}</p>
      <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:20px">
        ${p.stock>0?`<span class="tag tag-green">In Stock (${p.stock})</span>`:`<span class="tag tag-red">Out of Stock</span>`}
        ${p.sku?`<span class="tag">SKU: ${esc(p.sku)}</span>`:''}
        <span class="tag" style="background:${CAT_COLORS[p.category]||'#6366f1'}22;color:${CAT_COLORS[p.category]||'#6366f1'}">${CAT_ICONS[p.category]||''} ${esc(p.category||'')}</span>
      </div>
      <div style="display:flex;gap:10px;margin-bottom:24px">
        ${wishlisted
          ?`<button onclick="fetch('/api/wishlist/remove/${p.id}',{method:'DELETE'}).then(()=>location.reload())" class="btn" style="background:#ef4444">♥ Wishlisted</button>`
          :`<button onclick="fetch('/api/wishlist/add/${p.id}',{method:'POST'}).then(()=>location.reload())" class="btn btn-outline">♡ Add to Wishlist</button>`}
        <a href="/marketplace/compare?ids=${p.id}" class="btn btn-outline">Compare</a>
      </div>
      ${Object.keys(specs).length?`<div style="border-top:1px solid #e2e8f0;padding-top:16px"><h3 style="font-weight:700;margin-bottom:10px">Specifications</h3>
        <table style="width:100%"><tr><th style="width:40%">Spec</th><th>Detail</th></tr>
        ${Object.entries(specs).map(([k,v])=>`<tr><td style="font-weight:600">${esc(k)}</td><td>${esc(String(v))}</td></tr>`).join('')}
        </table></div>`:''}
    </div>
  </div>
  <div style="margin-top:40px;display:grid;grid-template-columns:1fr 1fr;gap:24px" class="mp-detail-grid">
    <div>
      <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">Reviews (${reviews.length})</h2>
      ${reviews.map(r => `<div style="background:white;border-radius:14px;padding:16px;box-shadow:0 1px 6px rgba(0,0,0,.04);border:1px solid #e2e8f0;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <strong style="font-size:14px">${esc(r.reviewer_name||'Anonymous')}</strong>
          <span class="muted" style="font-size:12px">${r.created_at?new Date(r.created_at).toLocaleDateString():''}</span>
        </div>
        <div style="margin-bottom:6px">${starsHtml(r.rating,14)}</div>
        ${r.title?`<div style="font-weight:600;font-size:14px;margin-bottom:4px">${esc(r.title)}</div>`:''}
        <p style="font-size:13px;color:#475569;line-height:1.6">${esc(r.review_text||'')}</p>
        <div style="display:flex;gap:10px;margin-top:8px;align-items:center">
          ${r.is_verified_purchase?'<span class="tag tag-green" style="font-size:10px">✓ Verified Purchase</span>':''}
          <button onclick="fetch('/api/reviews/${r.id}/helpful',{method:'POST'}).then(r=>r.json()).then(d=>this.textContent='👍 Helpful ('+d.helpful_count+')')" class="muted" style="background:none;border:none;cursor:pointer;font-size:12px">👍 Helpful (${r.helpful_count||0})</button>
        </div>
      </div>`).join('')}
      ${!reviews.length?'<p class="muted">No reviews yet. Be the first!</p>':''}
    </div>
    <div>
      ${related.length?`<h2 style="font-size:20px;font-weight:700;margin-bottom:16px">More from ${esc(p.store_name)}</h2>
      <div style="display:flex;flex-direction:column;gap:12px">${related.map(rp => `<div style="display:flex;gap:14px;background:white;padding:12px;border-radius:12px;border:1px solid #e2e8f0;cursor:pointer" onclick="location.href='/marketplace/products/${rp.id}'">
        <div style="width:70px;height:70px;border-radius:10px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;flex-shrink:0;overflow:hidden">
          ${rp.images&&rp.images[0]?`<img src="${esc(rp.images[0])}" style="width:100%;height:100%;object-fit:cover">`:`<span style="font-size:24px;opacity:.3">${CAT_ICONS[rp.category]||'📦'}</span>`}
        </div>
        <div><div style="font-weight:600;font-size:14px">${esc(rp.name)}</div><div style="color:#059669;font-weight:700;margin-top:2px">${formatPrice(rp.price,rp.currency)}</div><div style="margin-top:4px">${starsHtml(rp.rating,11)}</div></div>
      </div>`).join('')}</div>`:''}
    </div>
  </div>
  <style>.mp-detail-grid{grid-template-columns:1fr!important}@media(min-width:769px){.mp-detail-grid{grid-template-columns:1fr 1fr!important}}</style>`;
  res.send(renderPage(p.name, html));
}));

// POST /api/vendor/products — Add product (vendor auth)
app.post('/api/vendor/products', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const store = (await pool.query('SELECT id FROM vendor_stores WHERE owner_email=$1', [user.email])).rows[0];
  if (!store) return res.status(403).json({ error: 'You must register as a vendor first' });
  const { name, description, price, currency, compare_price, category, images, stock, sku, tags, specs } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'Product name required' });
  if (!price || isNaN(parseFloat(price))) return res.status(400).json({ error: 'Valid price required' });
  const r = await pool.query(
    `INSERT INTO vendor_products (store_id,tenant_id,name,description,price,currency,compare_price,category,images,stock,sku,tags,specs)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [store.id, user.tenant_id, name.trim(), description||'', parseFloat(price), currency||'UGX',
     compare_price?parseFloat(compare_price):null, category||'', images||[], stock||0, sku||'', tags||[], specs||{}]
  );
  res.status(201).json(r.rows[0]);
}));

// PUT /api/vendor/products/:id — Update product (owner only)
app.put('/api/vendor/products/:id', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const p = (await pool.query(`SELECT p.*, s.owner_email FROM vendor_products p JOIN vendor_stores s ON s.id=p.store_id WHERE p.id=$1`, [req.params.id])).rows[0];
  if (!p) return res.status(404).json({ error: 'Product not found' });
  if (p.owner_email !== user.email && user.role !== 'admin') return res.status(403).json({ error: 'Not your product' });
  const { name, description, price, currency, compare_price, category, images, stock, sku, tags, specs, is_featured, is_active } = req.body;
  const r = await pool.query(
    `UPDATE vendor_products SET name=$1,description=$2,price=$3,currency=$4,compare_price=$5,category=$6,images=$7,stock=$8,sku=$9,tags=$10,specs=$11,is_featured=$12,is_active=$13 WHERE id=$14 RETURNING *`,
    [name||p.name, description!==undefined?description:p.description, price||p.price, currency||p.currency,
     compare_price?parseFloat(compare_price):null, category!==undefined?category:p.category, images||p.images,
     stock!==undefined?stock:p.stock, sku||p.sku, tags||p.tags, specs||p.specs,
     is_featured!==undefined?is_featured:p.is_featured, is_active!==undefined?is_active:p.is_active, p.id]
  );
  res.json(r.rows[0]);
}));

// DELETE /api/vendor/products/:id — Delete product (owner only)
app.delete('/api/vendor/products/:id', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const p = (await pool.query(`SELECT p.*, s.owner_email FROM vendor_products p JOIN vendor_stores s ON s.id=p.store_id WHERE p.id=$1`, [req.params.id])).rows[0];
  if (!p) return res.status(404).json({ error: 'Product not found' });
  if (p.owner_email !== user.email && user.role !== 'admin') return res.status(403).json({ error: 'Not your product' });
  await pool.query('DELETE FROM vendor_products WHERE id=$1', [p.id]);
  res.json({ deleted: true });
}));

// GET /api/marketplace/search — Full search API
app.get('/api/marketplace/search', ah(async (req, res) => {
  const { q, category, min_price, max_price, sort } = req.query;
  let where = 'WHERE p.is_active=true AND s.is_active=true', params = [], pi = 1;
  if (q) { where += ` AND (p.name ILIKE $${pi} OR p.description ILIKE $${pi} OR s.store_name ILIKE $${pi})`; params.push(`%${q}%`); pi++; }
  if (category) { where += ` AND p.category = $${pi}`; params.push(category); pi++; }
  if (min_price) { where += ` AND p.price >= $${pi}`; params.push(parseFloat(min_price)); pi++; }
  if (max_price) { where += ` AND p.price <= $${pi}`; params.push(parseFloat(max_price)); pi++; }
  const orderMap = {new:'p.created_at DESC',price_low:'p.price ASC',price_high:'p.price DESC',rating:'p.rating DESC'};
  const rows = (await pool.query(
    `SELECT p.*, s.store_name FROM vendor_products p JOIN vendor_stores s ON s.id=p.store_id ${where} ORDER BY ${orderMap[sort]||'p.created_at DESC'} LIMIT 50`, params
  )).rows;
  res.json({ results: rows, total: rows.length });
}));

// =================================================================
// 3. REVIEWS & RATINGS
// =================================================================
// POST /api/reviews — Submit a review (auth)
app.post('/api/reviews', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  const { store_id, product_id, rating, title, review_text, images } = req.body;
  if (!rating || rating < 1 || rating > 5) return res.status(400).json({ error: 'Rating must be 1-5' });
  if (!store_id && !product_id) return res.status(400).json({ error: 'store_id or product_id required' });
  const r = await pool.query(
    `INSERT INTO vendor_reviews (store_id,product_id,reviewer_email,reviewer_name,rating,title,review_text,images,is_verified_purchase)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *`,
    [store_id||null, product_id||null, user.email, user.name||user.email, parseInt(rating), title||'', review_text||'', images||[], true]
  );
  // Recalculate rating for store
  if (store_id) {
    const avg = (await pool.query('SELECT AVG(rating)::numeric(3,1) as avg, COUNT(*) as cnt FROM vendor_reviews WHERE store_id=$1', [store_id])).rows[0];
    await pool.query('UPDATE vendor_stores SET rating=$1, review_count=$2 WHERE id=$3', [avg.avg||0, avg.cnt||0, store_id]);
  }
  // Recalculate rating for product
  if (product_id) {
    const avg = (await pool.query('SELECT AVG(rating)::numeric(3,1) as avg, COUNT(*) as cnt FROM vendor_reviews WHERE product_id=$1', [product_id])).rows[0];
    await pool.query('UPDATE vendor_products SET rating=$1, review_count=$2 WHERE id=$3', [avg.avg||0, avg.cnt||0, product_id]);
  }
  res.status(201).json(r.rows[0]);
}));

// PUT /api/reviews/:id — Edit review (author only)
app.put('/api/reviews/:id', requireAuth, ah(async (req, res) => {
  const review = (await pool.query('SELECT * FROM vendor_reviews WHERE id=$1', [req.params.id])).rows[0];
  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.reviewer_email !== req.session.user.email) return res.status(403).json({ error: 'Not your review' });
  const { rating, title, review_text } = req.body;
  if (rating && (rating < 1 || rating > 5)) return res.status(400).json({ error: 'Rating must be 1-5' });
  const r = await pool.query(
    'UPDATE vendor_reviews SET rating=$1,title=$2,review_text=$3 WHERE id=$4 RETURNING *',
    [rating||review.rating, title!==undefined?title:review.title, review_text!==undefined?review_text:review.review_text, review.id]
  );
  // Recalculate store/product ratings
  if (review.store_id) {
    const avg = (await pool.query('SELECT AVG(rating)::numeric(3,1) as avg, COUNT(*) as cnt FROM vendor_reviews WHERE store_id=$1', [review.store_id])).rows[0];
    await pool.query('UPDATE vendor_stores SET rating=$1, review_count=$2 WHERE id=$3', [avg.avg||0, avg.cnt||0, review.store_id]);
  }
  if (review.product_id) {
    const avg = (await pool.query('SELECT AVG(rating)::numeric(3,1) as avg, COUNT(*) as cnt FROM vendor_reviews WHERE product_id=$1', [review.product_id])).rows[0];
    await pool.query('UPDATE vendor_products SET rating=$1, review_count=$2 WHERE id=$3', [avg.avg||0, avg.cnt||0, review.product_id]);
  }
  res.json(r.rows[0]);
}));

// DELETE /api/reviews/:id — Delete review (author or admin)
app.delete('/api/reviews/:id', requireAuth, ah(async (req, res) => {
  const review = (await pool.query('SELECT * FROM vendor_reviews WHERE id=$1', [req.params.id])).rows[0];
  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (review.reviewer_email !== req.session.user.email && req.session.user.role !== 'admin') return res.status(403).json({ error: 'Not authorized' });
  await pool.query('DELETE FROM vendor_reviews WHERE id=$1', [review.id]);
  if (review.store_id) {
    const avg = (await pool.query('SELECT AVG(rating)::numeric(3,1) as avg, COUNT(*) as cnt FROM vendor_reviews WHERE store_id=$1', [review.store_id])).rows[0];
    await pool.query('UPDATE vendor_stores SET rating=$1, review_count=$2 WHERE id=$3', [avg.avg||0, avg.cnt||0, review.store_id]);
  }
  if (review.product_id) {
    const avg = (await pool.query('SELECT AVG(rating)::numeric(3,1) as avg, COUNT(*) as cnt FROM vendor_reviews WHERE product_id=$1', [review.product_id])).rows[0];
    await pool.query('UPDATE vendor_products SET rating=$1, review_count=$2 WHERE id=$3', [avg.avg||0, avg.cnt||0, review.product_id]);
  }
  res.json({ deleted: true });
}));

// POST /api/reviews/:id/helpful — Mark review as helpful
app.post('/api/reviews/:id/helpful', ah(async (req, res) => {
  const r = await pool.query('UPDATE vendor_reviews SET helpful_count=COALESCE(helpful_count,0)+1 WHERE id=$1 RETURNING helpful_count', [req.params.id]);
  res.json({ helpful_count: r.rows[0]?.helpful_count || 0 });
}));

// =================================================================
// 4. WISHLIST
// =================================================================
// POST /api/wishlist/add/:productId — Add to wishlist (auth)
app.post('/api/wishlist/add/:productId', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  try {
    await pool.query('INSERT INTO wishlists (user_email,tenant_id,product_id) VALUES ($1,$2,$3)', [user.email, user.tenant_id, req.params.productId]);
    res.json({ wishlisted: true });
  } catch (e) {
    if (e.code === '23505') return res.json({ wishlisted: true }); // already exists
    throw e;
  }
}));

// DELETE /api/wishlist/remove/:productId — Remove from wishlist
app.delete('/api/wishlist/remove/:productId', requireAuth, ah(async (req, res) => {
  await pool.query('DELETE FROM wishlists WHERE user_email=$1 AND product_id=$2', [req.session.user.email, req.params.productId]);
  res.json({ wishlisted: false });
}));

// GET /api/wishlist — Get user's wishlist (API)
app.get('/api/wishlist', requireAuth, ah(async (req, res) => {
  const rows = (await pool.query(
    `SELECT w.*, p.name, p.price, p.currency, p.images, p.category, s.store_name
     FROM wishlists w JOIN vendor_products p ON p.id=w.product_id
     JOIN vendor_stores s ON s.id=p.store_id
     WHERE w.user_email=$1 ORDER BY w.created_at DESC`, [req.session.user.email]
  )).rows;
  res.json(rows);
}));

// GET /wishlist — User's wishlist page
app.get('/wishlist', requireAuth, ah(async (req, res) => {
  const items = (await pool.query(
    `SELECT w.*, p.name, p.price, p.currency, p.images, p.category, p.rating, p.review_count, p.store_id, s.store_name
     FROM wishlists w JOIN vendor_products p ON p.id=w.product_id
     JOIN vendor_stores s ON s.id=p.store_id
     WHERE w.user_email=$1 ORDER BY w.created_at DESC`, [req.session.user.email]
  )).rows;

  const html = `
  <div class="flex-between" style="margin-bottom:24px">
    <h1 style="font-size:24px;font-weight:800">♡ My Wishlist <span class="muted" style="font-weight:400">(${items.length})</span></h1>
    ${items.length?`<a href="/marketplace/compare?ids=${items.map(i=>i.product_id).join(',')}" class="btn btn-sm btn-outline">Compare All</a>`:''}
  </div>
  ${items.length?`<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:20px">
    ${items.map(i => `<div style="background:white;border-radius:16px;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #e2e8f0;overflow:hidden;position:relative">
      <button onclick="fetch('/api/wishlist/remove/${i.product_id}',{method:'DELETE'}).then(()=>location.reload())" style="position:absolute;top:10px;right:10px;background:white;border:1px solid #e2e8f0;border-radius:50%;width:32px;height:32px;cursor:pointer;font-size:16px;z-index:1">✕</button>
      <div style="height:150px;background:#f1f5f9;display:flex;align-items:center;justify-content:center;overflow:hidden">
        ${i.images&&i.images[0]?`<img src="${esc(i.images[0])}" style="width:100%;height:100%;object-fit:cover">`:`<span style="font-size:40px;opacity:.3">${CAT_ICONS[i.category]||'📦'}</span>`}
      </div>
      <div style="padding:14px">
        <div class="muted" style="font-size:11px">${esc(i.store_name||'')}</div>
        <a href="/marketplace/products/${i.product_id}" style="font-weight:600;font-size:14px;color:#1e293b;text-decoration:none;display:block;margin:4px 0">${esc(i.name)}</a>
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">${starsHtml(i.rating,12)}<span class="muted" style="font-size:11px">(${i.review_count||0})</span></div>
        <strong style="color:#059669">${formatPrice(i.price,i.currency)}</strong>
      </div>
    </div>`).join('')}
  </div>`:'<div style="text-align:center;padding:60px"><p style="font-size:48px;margin-bottom:16px">♡</p><h3>Your wishlist is empty</h3><p class="muted" style="margin-bottom:16px">Save items you love while browsing</p><a href="/shop" class="btn btn-green">Explore Marketplace</a></div>'}`;
  res.send(renderPage('My Wishlist', html, req.session.user));
}));

// =================================================================
// 5. PRODUCT COMPARISON
// =================================================================
// GET /marketplace/compare — Compare up to 4 products
app.get('/marketplace/compare', ah(async (req, res) => {
  const ids = (req.query.ids || '').split(',').map(Number).filter(n => n > 0).slice(0, 4);
  if (ids.length < 2) return res.redirect('/marketplace/products');
  const products = [];
  for (const id of ids) {
    const p = (await pool.query(`SELECT p.*, s.store_name FROM vendor_products p JOIN vendor_stores s ON s.id=p.store_id WHERE p.id=$1`, [id])).rows[0];
    if (p) products.push(p);
  }
  if (products.length < 2) return res.redirect('/marketplace/products');

  // Collect all spec keys
  const allSpecs = new Set();
  products.forEach(p => {
    const s = typeof p.specs === 'string' ? JSON.parse(p.specs || '{}') : (p.specs || {});
    Object.keys(s).forEach(k => allSpecs.add(k));
  });
  const specKeys = [...allSpecs];
  const specsMatrix = {};
  products.forEach(p => {
    const s = typeof p.specs === 'string' ? JSON.parse(p.specs || '{}') : (p.specs || {});
    specKeys.forEach(k => { specsMatrix[k] = specsMatrix[k] || []; specsMatrix[k].push(String(s[k] || '—')); });
  });
  // Highlight differences
  const diffKeys = specKeys.filter(k => { const vals = specsMatrix[k]; return vals.some(v => v !== vals[0]); });

  const html = `
  <div class="flex-between" style="margin-bottom:24px">
    <h1 style="font-size:24px;font-weight:800">Product Comparison</h1>
    <a href="/marketplace/products" class="btn btn-sm btn-outline">← Back to Products</a>
  </div>
  <div style="overflow-x:auto">
    <table style="border-collapse:separate;border-spacing:0;width:100%">
      <tr>
        <th style="background:#f8fafc;position:sticky;left:0;z-index:1;min-width:120px"></th>
        ${products.map(p => `<th style="text-align:center;padding:16px;min-width:220px">
          <div style="height:120px;background:#f1f5f9;border-radius:12px;margin-bottom:10px;display:flex;align-items:center;justify-content:center;overflow:hidden">
            ${p.images&&p.images[0]?`<img src="${esc(p.images[0])}" style="max-width:100%;max-height:100%;object-fit:contain">`:`<span style="font-size:40px;opacity:.3">${CAT_ICONS[p.category]||'📦'}</span>`}
          </div>
          <a href="/marketplace/products/${p.id}" style="font-weight:700;font-size:14px;color:#1e293b">${esc(p.name)}</a>
          <div class="muted" style="font-size:12px">${esc(p.store_name)}</div>
        </th>`).join('')}
      </tr>
      <tr>
        <th style="background:#f8fafc;position:sticky;left:0">Price</th>
        ${products.map(p => `<td style="text-align:center;font-weight:800;font-size:18px;color:#059669">${formatPrice(p.price,p.currency)}
          ${p.compare_price?`<br><span class="muted" style="text-decoration:linethrough;font-size:13px">${formatPrice(p.compare_price,p.currency)}</span>`:''}</td>`).join('')}
      </tr>
      <tr>
        <th style="background:#f8fafc;position:sticky;left:0">Rating</th>
        ${products.map(p => `<td style="text-align:center">${starsHtml(p.rating,16)}<br><span class="muted">${Number(p.rating||0).toFixed(1)} (${p.review_count||0})</span></td>`).join('')}
      </tr>
      <tr>
        <th style="background:#f8fafc;position:sticky;left:0">Category</th>
        ${products.map(p => `<td style="text-align:center"><span class="tag" style="background:${CAT_COLORS[p.category]||'#6366f1'}22;color:${CAT_COLORS[p.category]||'#6366f1'}">${CAT_ICONS[p.category]||''} ${esc(p.category||'')}</span></td>`).join('')}
      </tr>
      <tr>
        <th style="background:#f8fafc;position:sticky;left:0">Availability</th>
        ${products.map(p => `<td style="text-align:center">${p.stock>0?`<span class="tag tag-green">${p.stock} in stock</span>`:`<span class="tag tag-red">Out of stock</span>`}</td>`).join('')}
      </tr>
      ${specKeys.map(k => `<tr>
        <th style="background:#f8fafc;position:sticky;left:0;${diffKeys.includes(k)?'color:#4f46e5;font-weight:700':''}">${esc(k)} ${diffKeys.includes(k)?'<span style="font-size:10px;color:#ef4444">(differs)</span>':''}</th>
        ${specsMatrix[k].map((v,i) => `<td style="text-align:center;${diffKeys.includes(k)?'background:#faf5ff;font-weight:600':''}">${esc(v)}</td>`).join('')}
      </tr>`).join('')}
    </table>
  </div>`;
  res.send(renderPage('Compare Products', html));
}));

// GET /api/marketplace/compare/:ids — Comparison data API
app.get('/api/marketplace/compare/:ids', ah(async (req, res) => {
  const ids = req.params.ids.split(',').map(Number).filter(n => n > 0).slice(0, 4);
  const products = [];
  for (const id of ids) {
    const p = (await pool.query(`SELECT p.*, s.store_name FROM vendor_products p JOIN vendor_stores s ON s.id=p.store_id WHERE p.id=$1`, [id])).rows[0];
    if (p) products.push(p);
  }
  // Collect specs
  const allSpecs = new Set();
  products.forEach(p => { const s = typeof p.specs === 'string' ? JSON.parse(p.specs||'{}') : (p.specs||{}); Object.keys(s).forEach(k => allSpecs.add(k)); });
  const specs = {};
  products.forEach(p => { const s = typeof p.specs === 'string' ? JSON.parse(p.specs||'{}') : (p.specs||{}); specs[p.id] = s; });
  res.json({ products, spec_keys: [...allSpecs], specs });
}));

// =================================================================
// 6. VENDOR VERIFICATION & TRUST
// =================================================================
// GET /marketplace/vendors/:id/trust — Trust details page
app.get('/marketplace/vendors/:id/trust', ah(async (req, res) => {
  const store = (await pool.query('SELECT * FROM vendor_stores WHERE id=$1', [req.params.id])).rows[0];
  if (!store) return res.status(404).send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2>Vendor Not Found</h2></div>'));
  const reviewStats = (await pool.query(
    `SELECT rating, COUNT(*)::int as count FROM vendor_reviews WHERE store_id=$1 GROUP BY rating ORDER BY rating DESC`, [store.id]
  )).rows;
  const totalReviews = reviewStats.reduce((s, r) => s + r.count, 0);
  const ts = trustScore(store);
  const age = store.created_at ? Math.round((Date.now() - new Date(store.created_at).getTime()) / 86400000) : 0;

  const html = `
  <div class="flex-between" style="margin-bottom:24px">
    <h1 style="font-size:24px;font-weight:800">Trust Details: ${esc(store.store_name)}</h1>
    <a href="/marketplace/vendors/${store.id}" class="btn btn-sm btn-outline">← Back to Store</a>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px" class="mp-detail-grid">
    <div>
      <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #e2e8f0;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:20px;margin-bottom:20px">
          <div style="width:80px;height:80px;border-radius:50%;background:linear-gradient(135deg,${CAT_COLORS[store.category]||'#6366f1'},${CAT_COLORS[store.category]||'#6366f1'}88);display:flex;align-items:center;justify-content:center;font-size:32px;color:white;flex-shrink:0">
            ${store.logo_url?`<img src="${esc(store.logo_url)}" style="width:100%;height:100%;object-fit:cover">`:(CAT_ICONS[store.category]||'🏪')}
          </div>
          <div>
            <div style="font-size:48px;font-weight:900;color:#4f46e5">${ts}</div>
            <div style="font-size:14px;color:#64748b">Trust Score out of 100</div>
          </div>
        </div>
        <div style="background:#f0fdf4;border-radius:12px;padding:16px;margin-bottom:16px">
          <div style="font-weight:700;margin-bottom:12px">Badges</div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">${trustBadges(store)||'<span class="muted">No badges earned yet</span>'}</div>
        </div>
        <table style="width:100%">
          <tr><td class="muted">Verification</td><td>${store.is_verified?'<span style="color:#059669;font-weight:700">✓ Verified</span>':'<span class="muted">Not verified</span>'}</td></tr>
          <tr><td class="muted">Account Age</td><td><strong>${age}</strong> days</td></tr>
          <tr><td class="muted">Total Reviews</td><td><strong>${store.review_count}</strong></td></tr>
          <tr><td class="muted">Average Rating</td><td>${starsHtml(store.rating,16)} <strong>${Number(store.rating||0).toFixed(1)}</strong></td></tr>
          <tr><td class="muted">Location</td><td>${esc(store.location||'Online')}</td></tr>
        </table>
      </div>
    </div>
    <div>
      <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #e2e8f0;margin-bottom:20px">
        <h3 style="font-weight:700;margin-bottom:16px">Trust Score Breakdown</h3>
        ${[
          {label:'Rating Quality', value: Math.min(40, (store.rating||0)*8), max:40, color:'#f59e0b'},
          {label:'Review Volume', value: Math.min(25, (store.review_count||0)*0.5), max:25, color:'#3b82f6'},
          {label:'Account Age', value: Math.min(20, age*0.2), max:20, color:'#10b981'},
          {label:'Verification', value: store.is_verified?15:0, max:15, color:'#8b5cf6'}
        ].map(b => `<div style="margin-bottom:14px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>${b.label}</span><strong>${Math.round(b.value)}/${b.max}</strong></div>
          <div style="height:10px;background:#f1f5f9;border-radius:5px;overflow:hidden"><div style="height:100%;width:${(b.value/b.max)*100}%;background:${b.color};border-radius:5px;transition:width .5s"></div></div>
        </div>`).join('')}
      </div>
      <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 12px rgba(0,0,0,.06);border:1px solid #e2e8f0">
        <h3 style="font-weight:700;margin-bottom:16px">Rating Distribution (${totalReviews})</h3>
        ${[5,4,3,2,1].map(star => {
          const count = reviewStats.find(r => r.rating === star)?.count || 0;
          const pct = totalReviews > 0 ? Math.round(count / totalReviews * 100) : 0;
          return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
            <span style="font-size:14px;min-width:20px">${star}★</span>
            <div style="flex:1;height:10px;background:#f1f5f9;border-radius:5px;overflow:hidden"><div style="height:100%;width:${pct}%;background:#f59e0b;border-radius:5px"></div></div>
            <span class="muted" style="font-size:12px;min-width:50px;text-align:right">${count} (${pct}%)</span>
          </div>`;
        }).join('')}
        ${!totalReviews?'<p class="muted">No reviews yet</p>':''}
      </div>
    </div>
  </div>
  <style>@media(min-width:769px){.mp-detail-grid{grid-template-columns:1fr 1fr!important}}</style>`;
  res.send(renderPage(`Trust: ${store.store_name}`, html));
}));

// =================================================================
// 7. ADMIN DASHBOARD & MODERATION
// =================================================================
// GET /admin/marketplace — Admin marketplace dashboard
app.get('/admin/marketplace', requireAuth, ah(async (req, res) => {
  if (!req.session.user || (req.session.user.role !== 'admin' && req.session.user.role !== 'super_admin')) return res.status(403).send('Admin only');
  const totalVendors = parseInt((await pool.query('SELECT COUNT(*) FROM vendor_stores')).rows[0].count);
  const totalProducts = parseInt((await pool.query('SELECT COUNT(*) FROM vendor_products WHERE is_active=true')).rows[0].count);
  const totalReviews = parseInt((await pool.query('SELECT COUNT(*) FROM vendor_reviews')).rows[0].count);
  const pendingVerifications = parseInt((await pool.query('SELECT COUNT(*) FROM vendor_stores WHERE is_verified=false')).rows[0].count);
  const avgRating = (await pool.query('SELECT AVG(rating)::numeric(3,1) as avg FROM vendor_stores')).rows[0].avg || 0;
  const catDist = (await pool.query(
    `SELECT p.category, COUNT(*)::int as count FROM vendor_products p WHERE p.is_active=true AND p.category IS NOT NULL GROUP BY p.category ORDER BY count DESC LIMIT 10`
  )).rows;
  const flaggedReviews = (await pool.query('SELECT r.*, s.store_name, p.name as product_name FROM vendor_reviews r LEFT JOIN vendor_stores s ON s.id=r.store_id LEFT JOIN vendor_products p ON p.id=r.product_id WHERE r.rating <= 2 ORDER BY r.created_at DESC LIMIT 20')).rows;

  const html = `
  <h1 style="font-size:26px;font-weight:800;margin-bottom:24px">Marketplace Dashboard</h1>
  <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:30px">
    <div style="background:white;padding:20px;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.05);border:1px solid #e2e8f0;text-align:center">
      <div style="font-size:32px;font-weight:900;color:#4f46e5">${totalVendors}</div><div class="muted">Total Vendors</div>
    </div>
    <div style="background:white;padding:20px;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.05);border:1px solid #e2e8f0;text-align:center">
      <div style="font-size:32px;font-weight:900;color:#059669">${totalProducts}</div><div class="muted">Active Products</div>
    </div>
    <div style="background:white;padding:20px;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.05);border:1px solid #e2e8f0;text-align:center">
      <div style="font-size:32px;font-weight:900;color:#f59e0b">${totalReviews}</div><div class="muted">Total Reviews</div>
    </div>
    <div style="background:white;padding:20px;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.05);border:1px solid #e2e8f0;text-align:center">
      <div style="font-size:32px;font-weight:900;color:#8b5cf6">${avgRating}</div><div class="muted">Avg Rating</div>
    </div>
    <div style="background:white;padding:20px;border-radius:14px;box-shadow:0 2px 8px rgba(0,0,0,.05);border:1px solid #e2e8f0;text-align:center">
      <div style="font-size:32px;font-weight:900;color:#ef4444">${pendingVerifications}</div><div class="muted">Pending Verifications</div>
    </div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:30px" class="mp-detail-grid">
    <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.05);border:1px solid #e2e8f0">
      <h3 style="font-weight:700;margin-bottom:16px">Category Distribution</h3>
      ${catDist.map(c => `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="min-width:100px;font-size:13px;font-weight:600">${CAT_ICONS[c.category]||''} ${esc(c.category)}</span>
        <div style="flex:1;height:12px;background:#f1f5f9;border-radius:6px;overflow:hidden"><div style="height:100%;width:${Math.round(c.count/Math.max(...catDist.map(x=>x.count))*100)}%;background:${CAT_COLORS[c.category]||'#6366f1'};border-radius:6px"></div></div>
        <span class="muted" style="font-size:12px;min-width:30px">${c.count}</span>
      </div>`).join('')}
    </div>
    <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.05);border:1px solid #e2e8f0">
      <h3 style="font-weight:700;margin-bottom:16px">Quick Links</h3>
      <div style="display:flex;flex-direction:column;gap:10px">
        <a href="/admin/vendors" class="btn btn-outline" style="text-align:center">Manage Vendors (${pendingVerifications} pending)</a>
        <a href="/marketplace/vendors" class="btn btn-outline" style="text-align:center">Browse Marketplace</a>
        <a href="/shop" class="btn btn-outline" style="text-align:center">Landing Page</a>
      </div>
    </div>
  </div>
  <div style="background:white;border-radius:16px;padding:24px;box-shadow:0 2px 8px rgba(0,0,0,.05);border:1px solid #e2e8f0">
    <h3 style="font-weight:700;margin-bottom:16px">Flagged Reviews (≤ 2 stars) — ${flaggedReviews.length}</h3>
    ${flaggedReviews.length?`<div style="overflow-x:auto"><table>
      <tr><th>ID</th><th>Reviewer</th><th>Store</th><th>Product</th><th>Rating</th><th>Title</th><th>Date</th><th>Actions</th></tr>
      ${flaggedReviews.map(r => `<tr>
        <td>${r.id}</td><td>${esc(r.reviewer_name||'Anon')}</td><td>${esc(r.store_name||'-')}</td><td>${esc(r.product_name||'-')}</td>
        <td>${starsHtml(r.rating,12)}</td><td>${esc(r.title||'')}</td><td class="muted" style="font-size:12px">${r.created_at?new Date(r.created_at).toLocaleDateString():''}</td>
        <td><button onclick="fetch('/api/admin/reviews/${r.id}/moderate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove'})}).then(()=>this.closest('tr').remove())" class="btn btn-sm btn-red">Remove</button></td>
      </tr>`).join('')}
    </table></div>`:'<p class="muted">No flagged reviews</p>'}
  </div>
  <style>@media(min-width:769px){.mp-detail-grid{grid-template-columns:1fr 1fr!important}}</style>`;
  res.send(renderPage('Marketplace Admin', html, req.session.user));
}));

// POST /api/admin/vendors/:id/verify — Verify a vendor (admin)
app.post('/api/admin/vendors/:id/verify', requireAuth, ah(async (req, res) => {
  if (req.session.user.role !== 'admin' && req.session.user.role !== 'super_admin') return res.status(403).json({ error: 'Admin only' });
  const store = (await pool.query('SELECT * FROM vendor_stores WHERE id=$1', [req.params.id])).rows[0];
  if (!store) return res.status(404).json({ error: 'Store not found' });
  const newVerified = !store.is_verified;
  await pool.query('UPDATE vendor_stores SET is_verified=$1 WHERE id=$2', [newVerified, store.id]);
  if (newVerified && store.owner_email) {
    notify(store.owner_email, 'Store Verified!', `Congratulations! Your store "${store.store_name}" has been verified.`);
  }
  res.json({ verified: newVerified });
}));

// POST /api/admin/reviews/:id/moderate — Moderate a review (admin)
app.post('/api/admin/reviews/:id/moderate', requireAuth, ah(async (req, res) => {
  if (req.session.user.role !== 'admin' && req.session.user.role !== 'super_admin') return res.status(403).json({ error: 'Admin only' });
  const { action } = req.body;
  const review = (await pool.query('SELECT * FROM vendor_reviews WHERE id=$1', [req.params.id])).rows[0];
  if (!review) return res.status(404).json({ error: 'Review not found' });
  if (action === 'remove') {
    await pool.query('DELETE FROM vendor_reviews WHERE id=$1', [review.id]);
    // Recalculate ratings
    if (review.store_id) {
      const avg = (await pool.query('SELECT AVG(rating)::numeric(3,1) as avg, COUNT(*) as cnt FROM vendor_reviews WHERE store_id=$1', [review.store_id])).rows[0];
      await pool.query('UPDATE vendor_stores SET rating=$1, review_count=$2 WHERE id=$3', [avg.avg||0, avg.cnt||0, review.store_id]);
    }
    if (review.product_id) {
      const avg = (await pool.query('SELECT AVG(rating)::numeric(3,1) as avg, COUNT(*) as cnt FROM vendor_reviews WHERE product_id=$1', [review.product_id])).rows[0];
      await pool.query('UPDATE vendor_products SET rating=$1, review_count=$2 WHERE id=$3', [avg.avg||0, avg.cnt||0, review.product_id]);
    }
    res.json({ removed: true });
  } else {
    res.json({ error: 'Unknown action' });
  }
}));

console.log('[MarketplaceVendor] LOADED: Vendor storefronts, product listings & search, reviews & ratings, wishlist, product comparison, trust system, admin dashboard, marketplace landing page');
