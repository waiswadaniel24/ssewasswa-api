// ============================================================
// HUB ROUTES — Open Hub: Public marketplace & discovery portal
// Comfort Zone — Multi-tenant SaaS Platform
// ============================================================
module.exports = function(app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t,c,u) => c);
  const ah = (opts && opts.ah) || (fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(e => res.status(500).send('Error: '+e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  // ============================================================
  // SHARED CSS
  // ============================================================
  const hubCSS = `
    .hub-nav { display:flex; gap:4px; padding:16px 0; flex-wrap:wrap; }
    .hub-nav a { padding:8px 20px; border-radius:8px; font-size:13px; font-weight:600; color:#475569; text-decoration:none; transition:all .2s; }
    .hub-nav a:hover, .hub-nav a.active { background:#0f172a; color:#fff; }
    .hub-hero { background:linear-gradient(135deg,#0f172a,#1e3a5f); color:#fff; padding:60px 24px; text-align:center; border-radius:16px; margin-bottom:32px; }
    .hub-hero h1 { font-size:32px; font-weight:800; margin-bottom:8px; }
    .hub-hero p { color:#94a3b8; font-size:16px; }
    .hub-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(300px,1fr)); gap:20px; }
    .hub-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; overflow:hidden; transition:all .25s; }
    .hub-card:hover { transform:translateY(-4px); box-shadow:0 12px 32px rgba(0,0,0,.08); border-color:transparent; }
    .hub-card-cover { height:120px; background-size:cover; background-position:center; position:relative; }
    .hub-card-cover .badge { position:absolute; top:12px; right:12px; background:rgba(0,0,0,.55); color:#fff; padding:3px 10px; border-radius:20px; font-size:11px; font-weight:600; backdrop-filter:blur(4px); }
    .hub-card-body { padding:20px; }
    .hub-card-body h3 { font-size:16px; font-weight:700; margin-bottom:4px; }
    .hub-card-body .meta { font-size:12px; color:#94a3b8; margin-bottom:10px; }
    .hub-card-body .desc { font-size:13px; color:#64748b; line-height:1.6; }
    .hub-card-footer { padding:12px 20px; border-top:1px solid #f1f5f9; display:flex; justify-content:space-between; align-items:center; }
    .hub-stars { color:#f59e0b; font-size:13px; }
    .hub-cat-card { background:#fff; border:1px solid #e2e8f0; border-radius:14px; padding:28px; text-align:center; transition:all .25s; cursor:pointer; text-decoration:none; display:block; }
    .hub-cat-card:hover { transform:translateY(-4px); box-shadow:0 12px 32px rgba(0,0,0,.08); }
    .hub-cat-card .icon { font-size:36px; margin-bottom:12px; display:block; }
    .hub-cat-card h3 { font-size:15px; font-weight:700; color:#0f172a; }
    .hub-cat-card .count { font-size:12px; color:#94a3b8; margin-top:4px; }
    .hub-search-bar { display:flex; gap:10px; max-width:700px; margin:0 auto 28px; }
    .hub-search-bar input { flex:1; padding:12px 18px; border:1.5px solid #e2e8f0; border-radius:10px; font-size:15px; outline:none; transition:border .2s; }
    .hub-search-bar input:focus { border-color:#0f172a; }
    .hub-search-bar select { padding:12px 14px; border:1.5px solid #e2e8f0; border-radius:10px; font-size:14px; background:#fff; cursor:pointer; }
    .hub-search-bar button { padding:12px 28px; background:#0f172a; color:#fff; border:none; border-radius:10px; font-weight:600; cursor:pointer; }
    .hub-profile-header { display:flex; gap:24px; align-items:flex-start; background:#fff; border:1px solid #e2e8f0; border-radius:16px; padding:32px; margin-bottom:24px; }
    .hub-profile-header .logo { width:100px; height:100px; border-radius:16px; background:#e2e8f0; background-size:cover; background-position:center; flex-shrink:0; }
    .hub-profile-header h1 { font-size:24px; font-weight:800; }
    .hub-profile-header .verified { color:#10b981; font-size:13px; font-weight:600; }
    .hub-filter-chips { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:20px; }
    .hub-filter-chips a { padding:6px 16px; border-radius:20px; font-size:13px; font-weight:500; background:#f1f5f9; color:#475569; text-decoration:none; transition:all .2s; }
    .hub-filter-chips a:hover, .hub-filter-chips a.active { background:#0f172a; color:#fff; }
  `;

  const hubNav = (active) => `
    <div class="hub-nav">
      <a href="/hub" class="${active==='home'?'active':''}">🏠 Home</a>
      <a href="/hub/search" class="${active==='search'?'active':''}">🔍 Search</a>
      <a href="/hub/directory" class="${active==='directory'?'active':''}">📋 Directory</a>
      <a href="/hub/categories" class="${active==='categories'?'active':''}">📂 Categories</a>
    </div>
  `;

  const renderStars = (rating) => {
    const r = parseFloat(rating) || 0;
    const full = Math.floor(r);
    const half = r % 1 >= 0.5 ? 1 : 0;
    const empty = 5 - full - half;
    return '<span class="hub-stars">' + '★'.repeat(full) + (half ? '½' : '') + '☆'.repeat(empty) + '</span> <span style="font-size:12px;color:#64748b">' + r.toFixed(1) + '</span>';
  };

  // ============================================================
  // DB MIGRATIONS
  // ============================================================
  (async () => {
    const tables = [
      `CREATE TABLE IF NOT EXISTS hub_public_profiles (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        name VARCHAR(255) NOT NULL,
        category VARCHAR(100),
        description TEXT,
        logo_url VARCHAR(500),
        cover_url VARCHAR(500),
        website VARCHAR(500),
        phone VARCHAR(50),
        email VARCHAR(255),
        address TEXT,
        city VARCHAR(100),
        country VARCHAR(100),
        rating_avg NUMERIC(3,2) DEFAULT 0,
        review_count INTEGER DEFAULT 0,
        is_featured BOOLEAN DEFAULT false,
        is_verified BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_hub_profiles_tenant ON hub_public_profiles(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_profiles_category ON hub_public_profiles(category)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_profiles_featured ON hub_public_profiles(is_featured) WHERE is_featured = true`,
      `CREATE INDEX IF NOT EXISTS idx_hub_profiles_rating ON hub_public_profiles(rating_avg DESC)`,

      `CREATE TABLE IF NOT EXISTS hub_categories (
        id SERIAL PRIMARY KEY,
        slug VARCHAR(100) UNIQUE NOT NULL,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        icon VARCHAR(10),
        color VARCHAR(20),
        tenant_count INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0
      )`,

      `CREATE TABLE IF NOT EXISTS hub_reviews (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        reviewer_name VARCHAR(255),
        reviewer_email VARCHAR(255),
        rating INTEGER NOT NULL CHECK (rating >= 1 AND rating <= 5),
        comment TEXT,
        is_approved BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_hub_reviews_tenant ON hub_reviews(tenant_id)`,
      `CREATE INDEX IF NOT EXISTS idx_hub_reviews_approved ON hub_reviews(tenant_id) WHERE is_approved = true`,

      `CREATE TABLE IF NOT EXISTS hub_search_log (
        id SERIAL PRIMARY KEY,
        query VARCHAR(500),
        results_count INTEGER DEFAULT 0,
        ip_address VARCHAR(45),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`
    ];
    for (const sql of tables) {
      try { await pool.query(sql); } catch (e) { /* ignore */ }
    }

    // Seed categories
    const catSeed = [
      { slug:'education', name:'Education', icon:'🏫', color:'#059669' },
      { slug:'healthcare', name:'Healthcare', icon:'🏥', color:'#0891b2' },
      { slug:'church', name:'Church', icon:'⛪', color:'#7c3aed' },
      { slug:'business', name:'Business', icon:'🏢', color:'#475569' },
      { slug:'engagement', name:'Engagement', icon:'🤝', color:'#e11d48' },
      { slug:'ngo', name:'NGO', icon:'🌍', color:'#2563eb' }
    ];
    for (const c of catSeed) {
      await pool.query(`INSERT INTO hub_categories (slug,name,description,icon,color,sort_order) VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (slug) DO NOTHING`,
        [c.slug, c.name, c.name + ' sector on Comfort Zone', c.icon, c.color, catSeed.indexOf(c)]).catch(() => {});
    }
    // Update tenant counts
    await pool.query(`UPDATE hub_categories SET tenant_count = (SELECT COUNT(*) FROM hub_public_profiles WHERE category = hub_categories.slug)`).catch(() => {});
  })().catch(e => console.error('[HubRoutes] Migration error:', e.message));

  // ============================================================
  // GET /hub — Hub homepage with featured tenants by category
  // ============================================================
  app.get('/hub', ah(async (req, res) => {
    const featured = (await pool.query(`
      SELECT * FROM hub_public_profiles
      WHERE is_featured = true
      ORDER BY rating_avg DESC, review_count DESC
      LIMIT 12
    `)).rows;
    const categories = (await pool.query(`SELECT * FROM hub_categories ORDER BY sort_order`)).rows;
    const topRated = (await pool.query(`
      SELECT * FROM hub_public_profiles
      ORDER BY rating_avg DESC
      LIMIT 6
    `)).rows;
    const recentProfiles = (await pool.query(`
      SELECT * FROM hub_public_profiles
      ORDER BY created_at DESC
      LIMIT 6
    `)).rows;

    const content = `
      ${hubNav('home')}
      <div class="hub-hero">
        <h1>🌐 Comfort Zone Hub</h1>
        <p>Discover amazing organizations, businesses, and communities across Africa</p>
        <div class="hub-search-bar" style="margin-top:24px">
          <input type="text" placeholder="Search organizations..." id="hub-home-search" onkeydown="if(event.key==='Enter')window.location='/hub/search?q='+encodeURIComponent(this.value)">
          <button onclick="window.location='/hub/search?q='+encodeURIComponent(document.getElementById('hub-home-search').value)">Search</button>
        </div>
      </div>

      ${featured.length > 0 ? `
      <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">⭐ Featured Organizations</h2>
      <div class="hub-grid" style="margin-bottom:40px">
        ${featured.map(p => `
          <a href="/hub/tenant/${p.tenant_id}" class="hub-card" style="text-decoration:none;color:inherit">
            <div class="hub-card-cover" style="background:${p.cover_url ? `url(${esc(p.cover_url)})` : 'linear-gradient(135deg,#0f172a,#1e3a5f)'}">
              <span class="badge">⭐ Featured</span>
            </div>
            <div class="hub-card-body">
              <h3>${esc(p.name)}</h3>
              <div class="meta">${esc(p.category || 'General')} ${p.is_verified ? '· ✅ Verified' : ''} · ${esc(p.city || '')} ${esc(p.country || '')}</div>
              <div class="desc">${esc((p.description || '').substring(0, 120))}${(p.description || '').length > 120 ? '...' : ''}</div>
            </div>
            <div class="hub-card-footer">
              ${renderStars(p.rating_avg)}
              <span style="font-size:12px;color:#94a3b8">${p.review_count || 0} reviews</span>
            </div>
          </a>
        `).join('')}
      </div>` : ''}

      <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">📂 Browse by Category</h2>
      <div class="hub-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));margin-bottom:40px">
        ${categories.map(c => `
          <a href="/hub/directory?category=${esc(c.slug)}" class="hub-cat-card">
            <span class="icon">${c.icon}</span>
            <h3>${esc(c.name)}</h3>
            <div class="count">${c.tenant_count || 0} organizations</div>
          </a>
        `).join('')}
      </div>

      ${topRated.length > 0 ? `
      <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">🏆 Top Rated</h2>
      <div class="hub-grid" style="margin-bottom:40px">
        ${topRated.map(p => `
          <a href="/hub/tenant/${p.tenant_id}" class="hub-card" style="text-decoration:none;color:inherit">
            <div class="hub-card-body">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:48px;height:48px;border-radius:12px;background:${p.logo_url ? `url(${esc(p.logo_url)}) center/cover` : 'linear-gradient(135deg,#e2e8f0,#cbd5e1)'};flex-shrink:0"></div>
                <div>
                  <h3>${esc(p.name)}</h3>
                  <div class="meta">${esc(p.category || '')} · ${esc(p.city || '')}</div>
                </div>
              </div>
            </div>
            <div class="hub-card-footer">
              ${renderStars(p.rating_avg)}
              <span style="font-size:12px;color:#94a3b8">${p.review_count || 0} reviews</span>
            </div>
          </a>
        `).join('')}
      </div>` : ''}

      ${recentProfiles.length > 0 ? `
      <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">🆕 Recently Added</h2>
      <div class="hub-grid">
        ${recentProfiles.map(p => `
          <a href="/hub/tenant/${p.tenant_id}" class="hub-card" style="text-decoration:none;color:inherit">
            <div class="hub-card-body">
              <h3>${esc(p.name)}</h3>
              <div class="meta">${esc(p.category || 'General')} · Joined ${p.created_at ? new Date(p.created_at).toLocaleDateString() : 'recently'}</div>
              <div class="desc">${esc((p.description || '').substring(0, 100))}${(p.description || '').length > 100 ? '...' : ''}</div>
            </div>
          </a>
        `).join('')}
      </div>` : ''}
    `;
    res.send(renderPage('Comfort Zone Hub — Discover Organizations', content, req.session?.user));
  }));

  // ============================================================
  // GET /hub/search — Search tenants with filters
  // ============================================================
  app.get('/hub/search', ah(async (req, res) => {
    const q = (req.query.q || '').trim();
    const category = req.query.category || '';
    const city = req.query.city || '';
    const minRating = req.query.rating || '';
    const sort = req.query.sort || 'relevance';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    const categories = (await pool.query(`SELECT * FROM hub_categories ORDER BY sort_order`)).rows;

    let where = ['1=1'];
    let params = [];
    let paramIdx = 1;

    if (q) {
      where.push(`(name ILIKE $${paramIdx} OR description ILIKE $${paramIdx} OR city ILIKE $${paramIdx} OR category ILIKE $${paramIdx})`);
      params.push('%' + q + '%');
      paramIdx++;
    }
    if (category) {
      where.push(`category = $${paramIdx}`);
      params.push(category);
      paramIdx++;
    }
    if (city) {
      where.push(`city ILIKE $${paramIdx}`);
      params.push('%' + city + '%');
      paramIdx++;
    }
    if (minRating) {
      where.push(`rating_avg >= $${paramIdx}`);
      params.push(parseFloat(minRating));
      paramIdx++;
    }

    let orderBy = 'rating_avg DESC';
    if (sort === 'newest') orderBy = 'created_at DESC';
    else if (sort === 'name') orderBy = 'name ASC';
    else if (sort === 'reviews') orderBy = 'review_count DESC';

    // Log search
    if (q) {
      const resultCount = (await pool.query(`SELECT COUNT(*) as cnt FROM hub_public_profiles WHERE ${where.join(' AND ')}`, params)).rows[0].cnt;
      const ip = req.ip || req.connection?.remoteAddress || '';
      await pool.query(`INSERT INTO hub_search_log (query, results_count, ip_address) VALUES ($1,$2,$3)`, [q, parseInt(resultCount), ip]).catch(() => {});
    }

    const [countResult, tenants] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM hub_public_profiles WHERE ${where.join(' AND ')}`, params),
      pool.query(`SELECT * FROM hub_public_profiles WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${paramIdx} OFFSET $${paramIdx + 1}`, [...params, limit, offset])
    ]);
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    const content = `
      ${hubNav('search')}
      <div class="hub-hero" style="padding:40px 24px">
        <h1>🔍 Search Organizations</h1>
      </div>
      <form method="GET" class="hub-search-bar">
        <input type="text" name="q" value="${esc(q)}" placeholder="Search by name, description, city...">
        <select name="category">
          <option value="">All Categories</option>
          ${categories.map(c => `<option value="${esc(c.slug)}" ${category === c.slug ? 'selected' : ''}>${c.icon} ${esc(c.name)}</option>`).join('')}
        </select>
        <select name="rating">
          <option value="">Any Rating</option>
          <option value="4" ${minRating === '4' ? 'selected' : ''}>4+ Stars</option>
          <option value="3" ${minRating === '3' ? 'selected' : ''}>3+ Stars</option>
          <option value="2" ${minRating === '2' ? 'selected' : ''}>2+ Stars</option>
        </select>
        <select name="sort">
          <option value="relevance" ${sort === 'relevance' ? 'selected' : ''}>Relevance</option>
          <option value="rating" ${sort === 'rating' ? 'selected' : ''}>Highest Rated</option>
          <option value="newest" ${sort === 'newest' ? 'selected' : ''}>Newest</option>
          <option value="name" ${sort === 'name' ? 'selected' : ''}>Name A-Z</option>
          <option value="reviews" ${sort === 'reviews' ? 'selected' : ''}>Most Reviews</option>
        </select>
        <button type="submit">Search</button>
      </form>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <span style="font-size:14px;color:#64748b">${total} result${total !== 1 ? 's' : ''} found</span>
      </div>

      <div class="hub-grid">
        ${tenants.rows.map(p => `
          <a href="/hub/tenant/${p.tenant_id}" class="hub-card" style="text-decoration:none;color:inherit">
            <div class="hub-card-cover" style="background:${p.cover_url ? `url(${esc(p.cover_url)})` : `linear-gradient(135deg,#0f172a,#1e3a5f)`}">
              ${p.is_featured ? '<span class="badge">⭐ Featured</span>' : ''}
              ${p.is_verified ? '<span class="badge" style="left:12px;right:auto">✅ Verified</span>' : ''}
            </div>
            <div class="hub-card-body">
              <h3>${esc(p.name)}</h3>
              <div class="meta">${esc(p.category || 'General')} · ${esc(p.city || '')} ${esc(p.country || '')}</div>
              <div class="desc">${esc((p.description || '').substring(0, 130))}${(p.description || '').length > 130 ? '...' : ''}</div>
            </div>
            <div class="hub-card-footer">
              ${renderStars(p.rating_avg)}
              <span style="font-size:12px;color:#94a3b8">${p.review_count || 0} reviews</span>
            </div>
          </a>
        `).join('')}
      </div>

      ${tenants.rows.length === 0 ? '<div style="text-align:center;padding:60px 20px;color:#94a3b8"><div style="font-size:48px;margin-bottom:12px">🔍</div><h3>No organizations found</h3><p>Try adjusting your search or filters</p></div>' : ''}

      ${totalPages > 1 ? `
      <div style="display:flex;gap:6px;justify-content:center;margin-top:32px">
        ${Array.from({length: totalPages}, (_, i) => i + 1).map(p => `
          <a href="/hub/search?q=${encodeURIComponent(q)}&category=${category}&rating=${minRating}&sort=${sort}&page=${p}"
             style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;${p === page ? 'background:#0f172a;color:#fff' : 'background:#f1f5f9;color:#475569'}">${p}</a>
        `).join('')}
      </div>` : ''}
    `;
    res.send(renderPage('Search — Comfort Zone Hub', content, req.session?.user));
  }));

  // ============================================================
  // GET /hub/tenant/:id — Public tenant profile
  // ============================================================
  app.get('/hub/tenant/:id', ah(async (req, res) => {
    const tid = parseInt(req.params.id);
    const profile = (await pool.query(`SELECT * FROM hub_public_profiles WHERE tenant_id = $1`, [tid])).rows[0];
    if (!profile) {
      return res.send(renderPage('Not Found', '<div style="text-align:center;padding:80px"><h2>Organization not found</h2><p style="color:#94a3b8;margin-top:8px">This organization may have been removed or doesn\'t exist.</p><a href="/hub" style="color:#0f172a;font-weight:600;margin-top:16px;display:inline-block">← Back to Hub</a></div>', req.session?.user));
    }

    const reviews = (await pool.query(`
      SELECT * FROM hub_reviews WHERE tenant_id = $1 AND is_approved = true ORDER BY created_at DESC LIMIT 20
    `, [tid])).rows;
    const avgRating = reviews.length > 0 ? (reviews.reduce((s, r) => s + r.rating, 0) / reviews.length).toFixed(1) : '0.0';

    const content = `
      ${hubNav('')}
      <div class="hub-profile-header">
        <div class="logo" style="${profile.logo_url ? `background-image:url(${esc(profile.logo_url)})` : ''}"></div>
        <div style="flex:1">
          <div style="display:flex;align-items:center;gap:8px">
            <h1>${esc(profile.name)}</h1>
            ${profile.is_verified ? '<span class="verified">✅ Verified</span>' : ''}
            ${profile.is_featured ? '<span style="background:#f59e0b;color:#fff;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600">⭐ Featured</span>' : ''}
          </div>
          <div style="color:#64748b;font-size:14px;margin-top:4px">${esc(profile.category || 'General')} · ${esc(profile.city || '')}, ${esc(profile.country || '')}</div>
          <div style="margin-top:8px">${renderStars(avgRating)} <span style="font-size:12px;color:#94a3b8">(${reviews.length} reviews)</span></div>
          <p style="margin-top:12px;font-size:14px;line-height:1.7;color:#475569">${esc(profile.description || 'No description available.')}</p>
          <div style="display:flex;gap:12px;margin-top:16px;flex-wrap:wrap">
            ${profile.website ? `<a href="${esc(profile.website)}" target="_blank" style="padding:8px 16px;background:#0f172a;color:#fff;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none">🌐 Website</a>` : ''}
            ${profile.phone ? `<span style="padding:8px 16px;background:#f1f5f9;border-radius:8px;font-size:13px">📞 ${esc(profile.phone)}</span>` : ''}
            ${profile.email ? `<a href="mailto:${esc(profile.email)}" style="padding:8px 16px;background:#f1f5f9;border-radius:8px;font-size:13px;text-decoration:none">✉️ ${esc(profile.email)}</a>` : ''}
          </div>
        </div>
      </div>

      <div style="background:#f8fafc;border-radius:14px;padding:24px;margin-bottom:32px">
        <h3 style="font-size:18px;font-weight:700;margin-bottom:4px">Contact Information</h3>
        ${profile.address ? `<p style="font-size:14px;color:#64748b;margin-top:4px">📍 ${esc(profile.address)}</p>` : ''}
        ${profile.city ? `<p style="font-size:14px;color:#64748b">🏙️ ${esc(profile.city)}, ${esc(profile.country || '')}</p>` : ''}
      </div>

      <h2 style="font-size:20px;font-weight:700;margin-bottom:16px">💬 Reviews (${reviews.length})</h2>
      ${reviews.length > 0 ? reviews.map(r => `
        <div style="background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <span style="font-weight:600;font-size:14px">${esc(r.reviewer_name || 'Anonymous')}</span>
              <span style="font-size:12px;color:#94a3b8;margin-left:8px">${r.created_at ? new Date(r.created_at).toLocaleDateString() : ''}</span>
            </div>
            ${renderStars(r.rating)}
          </div>
          ${r.comment ? `<p style="margin-top:8px;font-size:14px;color:#475569;line-height:1.6">${esc(r.comment)}</p>` : ''}
        </div>
      `).join('') : '<div style="text-align:center;padding:40px;color:#94a3b8;background:#fff;border:1px solid #e2e8f0;border-radius:12px">No reviews yet. Be the first to review!</div>'}
    `;
    res.send(renderPage(profile.name + ' — Comfort Zone Hub', content, req.session?.user));
  }));

  // ============================================================
  // GET /hub/directory — Browse all tenants in a grid
  // ============================================================
  app.get('/hub/directory', ah(async (req, res) => {
    const category = req.query.category || '';
    const sort = req.query.sort || 'name';
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 24;
    const offset = (page - 1) * limit;

    const categories = (await pool.query(`SELECT * FROM hub_categories ORDER BY sort_order`)).rows;

    let where = ['1=1'];
    let params = [];
    let idx = 1;

    if (category) {
      where.push(`category = $${idx}`);
      params.push(category);
      idx++;
    }

    let orderBy = 'name ASC';
    if (sort === 'rating') orderBy = 'rating_avg DESC';
    else if (sort === 'newest') orderBy = 'created_at DESC';
    else if (sort === 'reviews') orderBy = 'review_count DESC';

    const [countResult, tenants] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM hub_public_profiles WHERE ${where.join(' AND ')}`, params),
      pool.query(`SELECT * FROM hub_public_profiles WHERE ${where.join(' AND ')} ORDER BY ${orderBy} LIMIT $${idx} OFFSET $${idx + 1}`, [...params, limit, offset])
    ]);
    const total = parseInt(countResult.rows[0].total);
    const totalPages = Math.ceil(total / limit);

    const content = `
      ${hubNav('directory')}
      <div class="hub-hero" style="padding:40px 24px">
        <h1>📋 Organization Directory</h1>
        <p>Browse all ${total} organizations on the platform</p>
      </div>

      <div class="hub-filter-chips">
        <a href="/hub/directory" class="${!category ? 'active' : ''}">All</a>
        ${categories.map(c => `<a href="/hub/directory?category=${esc(c.slug)}" class="${category === c.slug ? 'active' : ''}">${c.icon} ${esc(c.name)}</a>`).join('')}
      </div>

      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <span style="font-size:14px;color:#64748b">${total} organizations</span>
        <div style="display:flex;gap:6px">
          <a href="/hub/directory?category=${category}&sort=name" style="padding:6px 12px;border-radius:6px;font-size:12px;text-decoration:none;${sort === 'name' ? 'background:#0f172a;color:#fff' : 'background:#f1f5f9;color:#475569'}">Name</a>
          <a href="/hub/directory?category=${category}&sort=rating" style="padding:6px 12px;border-radius:6px;font-size:12px;text-decoration:none;${sort === 'rating' ? 'background:#0f172a;color:#fff' : 'background:#f1f5f9;color:#475569'}">Rating</a>
          <a href="/hub/directory?category=${category}&sort=newest" style="padding:6px 12px;border-radius:6px;font-size:12px;text-decoration:none;${sort === 'newest' ? 'background:#0f172a;color:#fff' : 'background:#f1f5f9;color:#475569'}">Newest</a>
        </div>
      </div>

      <div class="hub-grid" style="grid-template-columns:repeat(auto-fill,minmax(260px,1fr))">
        ${tenants.rows.map(p => `
          <a href="/hub/tenant/${p.tenant_id}" class="hub-card" style="text-decoration:none;color:inherit">
            <div class="hub-card-body">
              <div style="display:flex;align-items:center;gap:12px">
                <div style="width:44px;height:44px;border-radius:10px;background:${p.logo_url ? `url(${esc(p.logo_url)}) center/cover` : 'linear-gradient(135deg,#e2e8f0,#cbd5e1)'};flex-shrink:0"></div>
                <div style="min-width:0">
                  <h3 style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(p.name)}</h3>
                  <div class="meta">${esc(p.category || '')} · ${esc(p.city || '')}</div>
                </div>
              </div>
              <div class="desc" style="margin-top:10px">${esc((p.description || '').substring(0, 100))}${(p.description || '').length > 100 ? '...' : ''}</div>
            </div>
            <div class="hub-card-footer">
              ${renderStars(p.rating_avg)}
              ${p.is_verified ? '<span style="font-size:11px;color:#10b981;font-weight:600">✅</span>' : ''}
            </div>
          </a>
        `).join('')}
      </div>

      ${tenants.rows.length === 0 ? '<div style="text-align:center;padding:60px;color:#94a3b8"><div style="font-size:48px;margin-bottom:12px">📋</div><h3>No organizations yet</h3><p>Check back soon as more organizations join!</p></div>' : ''}

      ${totalPages > 1 ? `
      <div style="display:flex;gap:6px;justify-content:center;margin-top:32px">
        ${Array.from({length: Math.min(totalPages, 10)}, (_, i) => i + 1).map(p => `
          <a href="/hub/directory?category=${category}&sort=${sort}&page=${p}"
             style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;${p === page ? 'background:#0f172a;color:#fff' : 'background:#f1f5f9;color:#475569'}">${p}</a>
        `).join('')}
      </div>` : ''}
    `;
    res.send(renderPage('Directory — Comfort Zone Hub', content, req.session?.user));
  }));

  // ============================================================
  // GET /hub/categories — Category listing
  // ============================================================
  app.get('/hub/categories', ah(async (req, res) => {
    const categories = (await pool.query(`
      SELECT c.*, COUNT(p.id) as profile_count
      FROM hub_categories c
      LEFT JOIN hub_public_profiles p ON p.category = c.slug
      GROUP BY c.id
      ORDER BY c.sort_order
    `)).rows;

    const content = `
      ${hubNav('categories')}
      <div class="hub-hero" style="padding:40px 24px">
        <h1>📂 Browse Categories</h1>
        <p>Find organizations by sector and type</p>
      </div>

      <div class="hub-grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));margin-bottom:40px">
        ${categories.map(c => `
          <a href="/hub/directory?category=${esc(c.slug)}" class="hub-cat-card" style="text-decoration:none">
            <span class="icon" style="font-size:48px">${c.icon || '📁'}</span>
            <h3 style="font-size:18px;margin-top:4px">${esc(c.name)}</h3>
            <p style="font-size:13px;color:#64748b;margin-top:6px;line-height:1.5">${esc(c.description || '')}</p>
            <div class="count" style="margin-top:12px;font-size:14px;font-weight:600;color:#0f172a">${c.profile_count || 0} organizations →</div>
          </a>
        `).join('')}
      </div>

      <div style="background:#f8fafc;border-radius:14px;padding:32px;text-align:center">
        <h3 style="font-size:18px;font-weight:700">Can't find what you're looking for?</h3>
        <p style="color:#64748b;margin-top:8px;font-size:14px">New organizations join Comfort Zone every day.</p>
        <a href="/hub/search" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#0f172a;color:#fff;border-radius:8px;font-weight:600;font-size:14px;text-decoration:none">Try Advanced Search →</a>
      </div>
    `;
    res.send(renderPage('Categories — Comfort Zone Hub', content, req.session?.user));
  }));

  // ============================================================
  // GET /hub/api/tenants — JSON API for tenant search
  // ============================================================
  app.get('/hub/api/tenants', ah(async (req, res) => {
    const q = (req.query.q || '').trim();
    const category = req.query.category || '';
    const city = req.query.city || '';
    const minRating = parseFloat(req.query.rating) || 0;
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit) || 20));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);

    let where = ['1=1'];
    let params = [];
    let idx = 1;

    if (q) {
      where.push(`(name ILIKE $${idx} OR description ILIKE $${idx} OR city ILIKE $${idx})`);
      params.push('%' + q + '%');
      idx++;
    }
    if (category) {
      where.push(`category = $${idx}`);
      params.push(category);
      idx++;
    }
    if (city) {
      where.push(`city ILIKE $${idx}`);
      params.push('%' + city + '%');
      idx++;
    }
    if (minRating > 0) {
      where.push(`rating_avg >= $${idx}`);
      params.push(minRating);
      idx++;
    }

    const [countResult, tenants] = await Promise.all([
      pool.query(`SELECT COUNT(*) as total FROM hub_public_profiles WHERE ${where.join(' AND ')}`, params),
      pool.query(`SELECT * FROM hub_public_profiles WHERE ${where.join(' AND ')} ORDER BY rating_avg DESC, name ASC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, limit, offset])
    ]);

    // Log the search
    if (q) {
      const ip = req.ip || req.connection?.remoteAddress || '';
      pool.query(`INSERT INTO hub_search_log (query, results_count, ip_address) VALUES ($1,$2,$3)`,
        [q, parseInt(countResult.rows[0].total), ip]).catch(() => {});
    }

    res.json({
      success: true,
      total: parseInt(countResult.rows[0].total),
      limit,
      offset,
      tenants: tenants.rows.map(t => ({
        id: t.tenant_id,
        name: t.name,
        category: t.category,
        description: t.description,
        city: t.city,
        country: t.country,
        rating: parseFloat(t.rating_avg || 0),
        reviewCount: parseInt(t.review_count || 0),
        isFeatured: !!t.is_featured,
        isVerified: !!t.is_verified,
        logo: t.logo_url,
        website: t.website,
        phone: t.phone,
        email: t.email
      }))
    });
  }));

  console.log('[HubRoutes] loaded — 4 tables, 6 routes');
};
