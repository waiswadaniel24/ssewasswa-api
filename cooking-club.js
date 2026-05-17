// ============================================================
// COOKING CLUB MODULE — Multi-Tenant SaaS School Portal
// Recipes, cooking classes, ingredient inventory, nutrition, competitions
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // -- internal helpers ---------------------------------------------------
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const nav = (active) => `<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
    <a href="/school/cooking-club" class="btn ${active==='dash'?'':'btn-outline'}" style="${active==='dash'?'background:#3730a3':''}">🍳 Dashboard</a>
    <a href="/school/cooking-club/recipes" class="btn ${active==='recipes'?'':'btn-outline'}" style="${active==='recipes'?'background:#3730a3':''}">📖 Recipes</a>
    <a href="/school/cooking-club/classes" class="btn ${active==='classes'?'':'btn-outline'}" style="${active==='classes'?'background:#3730a3':''}">🎓 Classes</a>
    <a href="/school/cooking-club/equipment" class="btn ${active==='equip'?'':'btn-outline'}" style="${active==='equip'?'background:#3730a3':''}">🔪 Equipment</a>
    <a href="/school/cooking-club/competitions" class="btn ${active==='comp'?'':'btn-outline'}" style="${active==='comp'?'background:#3730a3':''}">🏆 Competitions</a>
    <a href="/school/cooking-club/nutrition" class="btn ${active==='nutrition'?'':'btn-outline'}" style="${active==='nutrition'?'background:#3730a3':''}">🥗 Nutrition</a>
    <a href="/school/cooking-club/my-recipes" class="btn ${active==='my'?'':'btn-outline'}" style="${active==='my'?'background:#3730a3':''}">📝 My Recipes</a>
  </div>`;

  const statusBadge = s => {
    const m = { active: '#16a34a', upcoming: '#2563eb', completed: '#9ca3af', cancelled: '#dc2626', open: '#16a34a', closed: '#9ca3af', full: '#f59e0b', draft: '#9ca3af', published: '#16a34a' };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${m[s]||GRAY}20;color:${m[s]||GRAY}">${esc(s)}</span>`;
  };

  const diffBadge = d => {
    const m = { easy: { bg: '#dcfce7', c: '#16a34a' }, medium: { bg: '#fef9c3', c: '#ca8a04' }, hard: { bg: '#fee2e2', c: '#dc2626' } };
    const v = m[d] || { bg: '#f3f4f6', c: GRAY };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${v.bg};color:${v.c}">${esc(d || 'medium')}</span>`;
  };

  const statCard = (num, label, color) => `<div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:${color||P}">${num}</div><div style="font-size:12px;color:${GRAY};margin-top:4px">${esc(label)}</div></div>`;

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS recipes (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL, cuisine VARCHAR(100), ingredients JSONB DEFAULT '[]',
        instructions TEXT, prep_time INTEGER DEFAULT 0, cook_time INTEGER DEFAULT 0,
        servings INTEGER DEFAULT 4, difficulty VARCHAR(20) DEFAULT 'medium',
        image_url VARCHAR(500), status VARCHAR(20) DEFAULT 'published',
        created_by INTEGER NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS cooking_classes (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL, instructor VARCHAR(255), recipe_id INTEGER,
        class_date DATE, class_time TIME, venue VARCHAR(255),
        max_students INTEGER DEFAULT 15, enrolled INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'upcoming', description TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS cooking_equipment (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, quantity INTEGER DEFAULT 1,
        condition VARCHAR(50) DEFAULT 'good', status VARCHAR(20) DEFAULT 'available'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS cooking_competitions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL, theme VARCHAR(255), competition_date DATE,
        deadline DATE, max_participants INTEGER DEFAULT 20,
        rules TEXT, prizes TEXT, status VARCHAR(20) DEFAULT 'open',
        participants JSONB DEFAULT '[]', results JSONB DEFAULT '[]'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS cooking_class_registrations (
        id SERIAL PRIMARY KEY, class_id INTEGER REFERENCES cooking_classes(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL, tenant_id INTEGER NOT NULL,
        registered_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS nutrition_logs (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL, meal_date DATE, meal_type VARCHAR(50),
        food_items JSONB DEFAULT '[]', calories INTEGER DEFAULT 0,
        protein NUMERIC(6,1) DEFAULT 0, carbs NUMERIC(6,1) DEFAULT 0, fat NUMERIC(6,1) DEFAULT 0,
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS cooking_budget (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        item VARCHAR(255) NOT NULL, category VARCHAR(100), quantity INTEGER DEFAULT 1,
        unit_cost NUMERIC(10,2) DEFAULT 0, total_cost NUMERIC(10,2) DEFAULT 0,
        purchase_date DATE, purchased_by VARCHAR(255), notes TEXT
      )`);
      // indexes
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_recipes_tenant ON recipes(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_recipes_cuisine ON recipes(tenant_id, cuisine)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_cc_tenant ON cooking_classes(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ce_tenant ON cooking_equipment(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_nutr_tenant ON nutrition_logs(tenant_id)`);
      console.log('[CookingClub] OK');
    } catch(e) { console.warn('[CookingClub] Warn:', e.message); }
  })();

  // ============================================================
  // ROUTE 1: GET /school/cooking-club — Dashboard
  // ============================================================
  app.get('/school/cooking-club', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, uid = user.id;
    const [recipeCount, classCount, compCount, myRecipes, upcomingClasses, recentRecipes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int as c FROM recipes WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int as c FROM cooking_classes WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int as c FROM cooking_competitions WHERE tenant_id=$1 AND status='open'`, [tid]),
      pool.query(`SELECT COUNT(*)::int as c FROM recipes WHERE tenant_id=$1 AND created_by=$2`, [tid, uid]),
      pool.query(`SELECT * FROM cooking_classes WHERE tenant_id=$1 AND status='upcoming' ORDER BY class_date LIMIT 4`, [tid]),
      pool.query(`SELECT r.*, s.name as author_name FROM recipes r LEFT JOIN students s ON s.id=r.created_by WHERE r.tenant_id=$1 AND r.status='published' ORDER BY r.created_at DESC LIMIT 5`, [tid])
    ]);

    const cuisines = (await pool.query(`SELECT cuisine, COUNT(*)::int as c FROM recipes WHERE tenant_id=$1 AND status='published' GROUP BY cuisine ORDER BY c DESC LIMIT 8`, [tid])).rows;

    const classHtml = upcomingClasses.rows.map(c => `<div class="card" style="padding:14px;display:flex;align-items:center;gap:14px">
      <div style="font-size:28px">🎓</div>
      <div style="flex:1"><strong style="font-size:14px">${esc(c.title)}</strong><div style="font-size:12px;color:${GRAY};margin-top:2px">by ${esc(c.instructor || 'TBD')} · ${fmtDate(c.class_date)} ${c.class_time ? new Date('1970-01-01T' + c.class_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''} · ${c.enrolled||0}/${c.max_students||15}</div></div>
      ${statusBadge(c.status)}
      <a href="/school/cooking-club/classes" class="btn" style="font-size:12px;padding:6px 12px">View</a>
    </div>`).join('');

    const recipeHtml = recentRecipes.rows.map(r => `<div class="card" style="padding:12px;display:flex;gap:12px;align-items:center">
      ${r.image_url ? `<img src="${esc(r.image_url)}" style="width:60px;height:60px;border-radius:8px;object-fit:cover" alt="">` : '<div style="width:60px;height:60px;background:#fef3c7;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:24px">🍳</div>'}
      <div style="flex:1"><strong style="font-size:13px">${esc(r.title)}</strong><div style="font-size:11px;color:${GRAY}">${esc(r.cuisine || 'General')} · ${r.prep_time||0}m prep · ${r.cook_time||0}m cook</div></div>
      ${diffBadge(r.difficulty)}
    </div>`).join('');

    const cuisineHtml = cuisines.map(c => `<div style="display:flex;align-items:center;gap:8px;padding:6px 0">
      <div style="flex:1;font-size:13px;font-weight:600">${esc(c.cuisine || 'Other')}</div>
      <div style="width:120px;height:8px;background:#f3f4f6;border-radius:4px;overflow:hidden"><div style="width:${Math.min(100, c.c * 10)}%;height:100%;background:${P};border-radius:4px"></div></div>
      <span style="font-size:12px;color:${GRAY};width:30px;text-align:right">${c.c}</span>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🍳 Cooking Club</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Discover recipes, learn techniques, share culinary creations</p></div>
        <a href="/school/cooking-club/recipes/new" class="btn" style="padding:10px 20px;font-size:14px;background:#16a34a">+ New Recipe</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px">
        ${statCard(recipeCount.rows[0].c, 'Total Recipes', P)}
        ${statCard(myRecipes.rows[0].c, 'My Recipes', '#16a34a')}
        ${statCard(classCount.rows[0].c, 'Classes', '#f59e0b')}
        ${statCard(compCount.rows[0].c, 'Open Competitions', '#dc2626')}
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card"><h3 style="margin:0 0 14px;font-size:15px">📖 Latest Recipes</h3>${recipeHtml || '<p style="color:${GRAY};text-align:center;padding:20px">No recipes yet</p>'}</div>
        <div class="card"><h3 style="margin:0 0 14px;font-size:15px">🌍 Cuisine Distribution</h3>${cuisineHtml || '<p style="color:${GRAY};text-align:center;padding:20px">No data</p>'}</div>
      </div>
      <div class="card"><h3 style="margin:0 0 14px;font-size:15px">🎓 Upcoming Classes</h3>${classHtml || '<p style="color:${GRAY};text-align:center;padding:20px">No upcoming classes</p>'}</div>
    </div>`;
    res.send(renderPage('Cooking Club', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /school/cooking-club/recipes — Recipe list
  // ============================================================
  app.get('/school/cooking-club/recipes', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const cuisine = req.query.cuisine || '', difficulty = req.query.difficulty || '', search = req.query.q || '';
    let where = ['r.tenant_id=$1', "r.status='published'"], params = [tid], pi = 2;
    if (cuisine) { where.push(`r.cuisine=$${pi++}`); params.push(cuisine); }
    if (difficulty) { where.push(`r.difficulty=$${pi++}`); params.push(difficulty); }
    if (search) { where.push(`(r.title ILIKE $${pi} OR r.instructions ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    const recipes = (await pool.query(
      `SELECT r.*, s.name as author_name FROM recipes r LEFT JOIN students s ON s.id=r.created_by WHERE ${where.join(' AND ')} ORDER BY r.created_at DESC LIMIT 50`, params
    )).rows;
    const cuisines = (await pool.query(`SELECT DISTINCT cuisine FROM recipes WHERE tenant_id=$1 AND status='published' ORDER BY cuisine`, [tid])).rows.map(r => r.cuisine).filter(Boolean);

    const recipesHtml = recipes.map(r => `<div class="card" style="padding:0;overflow:hidden">
      ${r.image_url ? `<img src="${esc(r.image_url)}" style="width:100%;height:180px;object-fit:cover" alt="${esc(r.title)}">` : `<div style="width:100%;height:120px;background:linear-gradient(135deg,#fef3c7,#fde68a);display:flex;align-items:center;justify-content:center;font-size:48px">🍳</div>`}
      <div style="padding:14px">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:6px"><strong style="font-size:15px">${esc(r.title)}</strong>${diffBadge(r.difficulty)}</div>
        <div style="font-size:12px;color:${GRAY};margin-bottom:6px">by ${esc(r.author_name || 'Unknown')} · ${esc(r.cuisine || 'General')} · ${r.servings||4} servings</div>
        <div style="display:flex;gap:12px;font-size:11px;color:${GRAY}">
          <span>⏱️ Prep: ${r.prep_time||0}m</span><span>🔥 Cook: ${r.cook_time||0}m</span>
          <span>📋 ${(r.ingredients && Array.isArray(r.ingredients)) ? r.ingredients.length : 0} ingredients</span>
        </div>
      </div>
    </div>`).join('');

    const cuisineTabs = ['', ...cuisines].map(c => `<a href="/school/cooking-club/recipes?cuisine=${encodeURIComponent(c)}" style="padding:6px 14px;border-radius:20px;font-size:12px;text-decoration:none;color:${GRAY};background:#f3f4f6;${cuisine===c?'background:'+P+';color:#fff':''}">${c ? esc(c) : 'All'}</a>`).join(' ');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">${nav('recipes')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">📖 Recipe Database</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${recipes.length} recipes</p></div>
        <div style="display:flex;gap:8px">
          <form method="GET" style="display:flex;gap:6px"><input type="text" name="q" value="${esc(search)}" placeholder="Search..." style="width:180px"><button class="btn" style="padding:8px 14px">🔍</button></form>
          <a href="/school/cooking-club/recipes/new" class="btn" style="background:#16a34a">+ New</a>
        </div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">${cuisineTabs}</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">${recipesHtml || '<p style="color:${GRAY};text-align:center;padding:40px;grid-column:1/-1">No recipes found</p>'}</div>
    </div>`;
    res.send(renderPage('Recipes', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /school/cooking-club/recipes/new — Create recipe
  // ============================================================
  app.get('/school/cooking-club/recipes/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const cuisines = ['Italian', 'Mexican', 'Chinese', 'Japanese', 'Indian', 'Thai', 'French', 'Mediterranean', 'American', 'Korean', 'African', 'Caribbean', 'British', 'Middle Eastern', 'Other'];
    const cuisineOpts = cuisines.map(c => `<option value="${c}">${c}</option>`).join('');
    const html = SKIP + `<div style="max-width:800px;margin:0 auto">${nav('recipes')}
      <a href="/school/cooking-club/recipes" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Recipes</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 4px">📝 Add New Recipe</h2>
        <p style="color:${GRAY};font-size:13px;margin-bottom:24px">Share your favorite recipe with the club</p>
        <form method="POST" action="/school/cooking-club/recipes/new" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Recipe Title *</label><input type="text" name="title" required placeholder="e.g., Grandma's Apple Pie"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Cuisine</label><select name="cuisine"><option value="">Select cuisine</option>${cuisineOpts}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Difficulty</label><select name="difficulty"><option value="easy">Easy</option><option value="medium" selected>Medium</option><option value="hard">Hard</option></select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Prep Time (min)</label><input type="number" name="prep_time" value="15" min="0"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Cook Time (min)</label><input type="number" name="cook_time" value="30" min="0"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Servings</label><input type="number" name="servings" value="4" min="1"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Ingredients (one per line) *</label><textarea name="ingredients" rows="6" required placeholder="2 cups flour&#10;1 cup sugar&#10;3 eggs&#10;1 tsp vanilla extract"></textarea></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Instructions *</label><textarea name="instructions" rows="8" required placeholder="Step-by-step cooking instructions..."></textarea></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Image URL</label><input type="url" name="image_url" placeholder="https://example.com/photo.jpg"></div>
          <div style="display:flex;gap:12px">
            <button type="submit" name="action" value="publish" class="btn" style="background:#16a34a;padding:12px 24px;font-size:15px">Publish Recipe</button>
            <button type="submit" name="action" value="draft" class="btn" style="background:${GRAY};padding:12px 24px;font-size:15px">Save as Draft</button>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Recipe', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /school/cooking-club/recipes/new
  // ============================================================
  app.post('/school/cooking-club/recipes/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, cuisine, difficulty, prep_time, cook_time, servings, ingredients, instructions, image_url, action } = req.body;
    if (!title?.trim() || !instructions?.trim()) {
      req.session.flash = { type: 'error', msg: 'Title and instructions are required' };
      return res.redirect('/school/cooking-club/recipes/new');
    }
    const ingredientArr = (ingredients || '').split('\n').map(s => s.trim()).filter(Boolean);
    const status = action === 'draft' ? 'draft' : 'published';
    await pool.query(
      `INSERT INTO recipes (tenant_id, title, cuisine, ingredients, instructions, prep_time, cook_time, servings, difficulty, image_url, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tid, title.trim(), cuisine || null, JSON.stringify(ingredientArr), instructions.trim(), prep_time ? parseInt(prep_time) : 0, cook_time ? parseInt(cook_time) : 0, servings ? parseInt(servings) : 4, difficulty || 'medium', image_url || null, status, user.id]
    );
    await audit(tid, user.id, 'recipe_create', { title: title.trim(), cuisine, status });
    req.session.flash = { type: 'success', msg: status === 'draft' ? 'Recipe saved as draft' : 'Recipe published!' };
    res.redirect('/school/cooking-club/recipes');
  }));

  // ============================================================
  // ROUTE 5: GET /school/cooking-club/recipes/:id — View recipe
  // ============================================================
  app.get('/school/cooking-club/recipes/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, rid = req.params.id;
    const recipe = (await pool.query(`SELECT r.*, s.name as author_name FROM recipes r LEFT JOIN students s ON s.id=r.created_by WHERE r.id=$1 AND r.tenant_id=$2`, [rid, tid])).rows[0];
    if (!recipe) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Recipe not found</h2></div>', user, req));
    const ingredients = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
    const ingredientsHtml = ingredients.map(ing => `<li style="padding:6px 0;border-bottom:1px solid #f3f4f6;font-size:14px">${esc(ing)}</li>`).join('');
    const stepsHtml = (recipe.instructions || '').split('\n').filter(Boolean).map((step, i) => `<div style="display:flex;gap:12px;padding:10px 0;${i < (recipe.instructions||'').split('\n').filter(Boolean).length - 1 ? 'border-bottom:1px solid #f3f4f6' : ''}">
      <div style="width:28px;height:28px;border-radius:50%;background:${P};color:#fff;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;flex-shrink:0">${i + 1}</div>
      <div style="font-size:14px;line-height:1.6">${esc(step)}</div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:800px;margin:0 auto">${nav('recipes')}
      <a href="/school/cooking-club/recipes" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Recipes</a>
      ${recipe.image_url ? `<img src="${esc(recipe.image_url)}" style="width:100%;height:300px;object-fit:cover;border-radius:12px;margin:12px 0" alt="">` : ''}
      <div class="card" style="padding:24px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:8px"><h1 style="margin:0;font-size:24px">${esc(recipe.title)}</h1>${diffBadge(recipe.difficulty)}${statusBadge(recipe.status)}</div>
        <div style="font-size:13px;color:${GRAY};margin-bottom:16px">by ${esc(recipe.author_name || 'Unknown')} · ${esc(recipe.cuisine || 'General')} · ${fmtDate(recipe.created_at)}</div>
        <div style="display:flex;gap:20px;padding:12px;background:#f9fafb;border-radius:10px;margin-bottom:20px;flex-wrap:wrap">
          <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:${P}">${recipe.prep_time||0}m</div><div style="font-size:11px;color:${GRAY}">Prep Time</div></div>
          <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:#dc2626">${recipe.cook_time||0}m</div><div style="font-size:11px;color:${GRAY}">Cook Time</div></div>
          <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:#16a34a">${(recipe.prep_time||0)+(recipe.cook_time||0)}m</div><div style="font-size:11px;color:${GRAY}">Total</div></div>
          <div style="text-align:center"><div style="font-size:18px;font-weight:700;color:#f59e0b">${recipe.servings||4}</div><div style="font-size:11px;color:${GRAY}">Servings</div></div>
        </div>
        <h3 style="font-size:16px;margin:0 0 10px">🛒 Ingredients</h3>
        <ul style="list-style:none;padding:0;margin:0 0 20px">${ingredientsHtml || '<li style="color:${GRAY}">No ingredients listed</li>'}</ul>
        <h3 style="font-size:16px;margin:0 0 10px">👨‍🍳 Instructions</h3>
        ${stepsHtml || '<p style="color:${GRAY}">No instructions provided</p>'}
      </div>
    </div>`;
    res.send(renderPage(recipe.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: GET /school/cooking-club/classes — Classes
  // ============================================================
  app.get('/school/cooking-club/classes', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const classes = (await pool.query(`SELECT c.*, r.title as recipe_title, (SELECT COUNT(*)::int FROM cooking_class_registrations cr WHERE cr.class_id=c.id) as enrolled_count FROM cooking_classes c LEFT JOIN recipes r ON r.id=c.recipe_id WHERE c.tenant_id=$1 ORDER BY c.class_date DESC NULLS LAST`, [tid])).rows;
    const myRegistrations = (await pool.query(`SELECT class_id FROM cooking_class_registrations WHERE tenant_id=$1 AND student_id=$2`, [tid, user.id])).rows.map(r => r.class_id);

    const classesHtml = classes.map(c => {
      const registered = myRegistrations.includes(c.id);
      const spotsLeft = (c.max_students || 15) - (c.enrolled_count || 0);
      return `<div class="card" style="padding:20px">
        <div style="display:flex;align-items:flex-start;gap:16px">
          <div style="font-size:36px">🎓</div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong style="font-size:16px">${esc(c.title)}</strong>${statusBadge(c.status)}</div>
            <div style="font-size:13px;color:${GRAY};margin-top:6px">👨‍🏫 ${esc(c.instructor || 'TBD')} · 📅 ${fmtDate(c.class_date)} ${c.class_time ? new Date('1970-01-01T' + c.class_time).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' }) : ''}</div>
            <div style="font-size:12px;color:${GRAY};margin-top:2px">📍 ${esc(c.venue || 'TBD')} · 👥 ${c.enrolled_count||0}/${c.max_students||15} (${spotsLeft} spots left)</div>
            ${c.recipe_title ? `<div style="font-size:12px;color:${GRAY};margin-top:2px">📖 Recipe: ${esc(c.recipe_title)}</div>` : ''}
            ${c.description ? `<div style="font-size:13px;margin-top:8px">${esc(c.description)}</div>` : ''}
            <div style="margin-top:10px;display:flex;gap:8px">
              ${c.status === 'upcoming' ? (registered
                ? `<span style="color:#16a34a;font-weight:600;font-size:13px">✅ Registered</span>`
                : (spotsLeft > 0 ? `<a href="/school/cooking-club/register/${c.id}" class="btn" style="background:#16a34a;font-size:12px;padding:6px 14px">Register</a>` : '<span style="color:#dc2626;font-size:12px">Class Full</span>'))
                : ''}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">${nav('classes')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🎓 Cooking Classes</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Learn from the best chefs and instructors</p></div>
        ${(user.role === 'admin' || user.role === 'teacher') ? `<a href="/school/cooking-club/classes/new" class="btn" style="background:#16a34a">+ Schedule Class</a>` : ''}
      </div>
      ${classesHtml || '<div class="card" style="text-align:center;padding:40px;color:${GRAY}"><p style="font-size:40px;margin-bottom:12px">🎓</p>No classes scheduled yet</div>'}
    </div>`;
    res.send(renderPage('Cooking Classes', html, user, req));
  }));

  // ============================================================
  // ROUTE 7: GET /school/cooking-club/register/:id — Register
  // ============================================================
  app.get('/school/cooking-club/register/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id, cid = req.params.id;
    const cls = (await pool.query(`SELECT c.*, r.title as recipe_title FROM cooking_classes c LEFT JOIN recipes r ON r.id=c.recipe_id WHERE c.id=$1 AND c.tenant_id=$2`, [cid, tid])).rows[0];
    if (!cls) return res.redirect('/school/cooking-club/classes');
    const enrolled = (await pool.query(`SELECT COUNT(*)::int as c FROM cooking_class_registrations WHERE class_id=$1`, [cid])).rows[0].c;
    const already = (await pool.query(`SELECT id FROM cooking_class_registrations WHERE class_id=$1 AND student_id=$2 AND tenant_id=$3`, [cid, uid, tid])).rows[0];
    if (already) { req.session.flash = { type: 'error', msg: 'Already registered' }; return res.redirect('/school/cooking-club/classes'); }
    if (enrolled >= (cls.max_students || 15)) { req.session.flash = { type: 'error', msg: 'Class is full' }; return res.redirect('/school/cooking-club/classes'); }
    await pool.query(`INSERT INTO cooking_class_registrations (class_id, student_id, tenant_id) VALUES ($1,$2,$3)`, [cid, uid, tid]);
    await pool.query(`UPDATE cooking_classes SET enrolled=enrolled+1 WHERE id=$1 AND tenant_id=$2`, [cid, tid]);
    await audit(tid, uid, 'class_register', { class_id: parseInt(cid) });
    req.session.flash = { type: 'success', msg: `Registered for "${cls.title}"!` };
    res.redirect('/school/cooking-club/classes');
  }));

  // ============================================================
  // ROUTE 8: GET /school/cooking-club/classes/new & POST
  // ============================================================
  app.get('/school/cooking-club/classes/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/cooking-club/classes');
    const recipes = (await pool.query(`SELECT id, title FROM recipes WHERE tenant_id=$1 AND status='published' ORDER BY title`, [tid])).rows;
    const recipeOpts = recipes.map(r => `<option value="${r.id}">${esc(r.title)}</option>`).join('');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('classes')}
      <a href="/school/cooking-club/classes" style="color:${GRAY};text-decoration:none;font-size:14px">← Back</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 20px">➕ Schedule Cooking Class</h2>
        <form method="POST" action="/school/cooking-club/classes/new" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Class Title *</label><input type="text" name="title" required placeholder="e.g., Italian Pasta Masterclass"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Instructor</label><input type="text" name="instructor" placeholder="e.g., Chef Johnson"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Venue</label><input type="text" name="venue" placeholder="e.g., Home Ec Lab A"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Date *</label><input type="date" name="class_date" required></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Time</label><input type="time" name="class_time"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Max Students</label><input type="number" name="max_students" value="15" min="1"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Recipe (optional)</label><select name="recipe_id"><option value="">None</option>${recipeOpts}</select></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="What students will learn..."></textarea></div>
          <button type="submit" class="btn" style="background:#16a34a;padding:12px">Schedule Class</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Schedule Class', html, user, req));
  }));

  app.post('/school/cooking-club/classes/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/cooking-club/classes');
    const { title, instructor, venue, class_date, class_time, max_students, recipe_id, description } = req.body;
    if (!title?.trim() || !class_date) return res.redirect('/school/cooking-club/classes/new');
    await pool.query(`INSERT INTO cooking_classes (tenant_id, title, instructor, recipe_id, class_date, class_time, venue, max_students, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, title.trim(), instructor ? instructor.trim() : null, recipe_id || null, class_date, class_time || null, venue ? venue.trim() : null, max_students ? parseInt(max_students) : 15, description ? description.trim() : null]);
    await audit(tid, user.id, 'class_create', { title: title.trim() });
    req.session.flash = { type: 'success', msg: 'Class scheduled!' };
    res.redirect('/school/cooking-club/classes');
  }));

  // ============================================================
  // ROUTE 9: GET /school/cooking-club/equipment — Equipment
  // ============================================================
  app.get('/school/cooking-club/equipment', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const equipment = (await pool.query(`SELECT * FROM cooking_equipment WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const rowsHtml = equipment.map(e => `<tr>
      <td><strong>${esc(e.name)}</strong></td>
      <td>${e.quantity || 1}</td>
      <td><span style="padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${e.condition==='excellent'?'#dcfce7':e.condition==='good'?'#fef9c3':'#fee2e2'};color:${e.condition==='excellent'?'#16a34a':e.condition==='good'?'#ca8a04':'#dc2626'}">${esc(e.condition)}</span></td>
      <td>${statusBadge(e.status)}</td>
      <td>${(user.role === 'admin' || user.role === 'teacher') ? `<form method="POST" action="/school/cooking-club/equipment/${e.id}/update" style="display:flex;gap:4px"><select name="status" style="width:auto;padding:4px 8px;font-size:11px"><option value="available" ${e.status==='available'?'selected':''}>Available</option><option value="in-use" ${e.status==='in-use'?'selected':''}>In Use</option><option value="maintenance" ${e.status==='maintenance'?'selected':''}>Maintenance</option></select><button class="btn" style="font-size:10px;padding:4px 8px">Save</button></form>` : '—'}</td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1000px;margin:0 auto">${nav('equip')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🔪 Kitchen Equipment</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Track tools and appliances</p></div>
        ${(user.role === 'admin' || user.role === 'teacher') ? `<a href="/school/cooking-club/equipment/add" class="btn" style="background:#16a34a">+ Add Equipment</a>` : ''}
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Item</th><th>Qty</th><th>Condition</th><th>Status</th><th>Action</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="5" style="text-align:center;color:${GRAY};padding:30px">No equipment listed</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Kitchen Equipment', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: Equipment add & update
  // ============================================================
  app.get('/school/cooking-club/equipment/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/cooking-club/equipment');
    const html = SKIP + `<div style="max-width:600px;margin:0 auto">${nav('equip')}
      <a href="/school/cooking-club/equipment" style="color:${GRAY};text-decoration:none;font-size:14px">← Back</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 20px">➕ Add Equipment</h2>
        <form method="POST" action="/school/cooking-club/equipment/add" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Name *</label><input type="text" name="name" required placeholder="e.g., Stand Mixer"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Quantity</label><input type="number" name="quantity" value="1" min="1"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Condition</label><select name="condition"><option value="excellent">Excellent</option><option value="good" selected>Good</option><option value="fair">Fair</option></select></div>
          </div>
          <button type="submit" class="btn" style="background:#16a34a;padding:12px">Add Equipment</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Add Equipment', html, user, req));
  }));

  app.post('/school/cooking-club/equipment/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/cooking-club/equipment');
    const { name, quantity, condition } = req.body;
    if (!name?.trim()) return res.redirect('/school/cooking-club/equipment/add');
    await pool.query(`INSERT INTO cooking_equipment (tenant_id, name, quantity, condition) VALUES ($1,$2,$3,$4)`,
      [tid, name.trim(), quantity ? parseInt(quantity) : 1, condition || 'good']);
    req.session.flash = { type: 'success', msg: 'Equipment added!' };
    res.redirect('/school/cooking-club/equipment');
  }));

  app.post('/school/cooking-club/equipment/:id/update', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/cooking-club/equipment');
    await pool.query(`UPDATE cooking_equipment SET status=$1 WHERE id=$2 AND tenant_id=$3`, [req.body.status || 'available', req.params.id, tid]);
    res.redirect('/school/cooking-club/equipment');
  }));

  // ============================================================
  // ROUTE 11: GET /school/cooking-club/competitions
  // ============================================================
  app.get('/school/cooking-club/competitions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const competitions = (await pool.query(`SELECT * FROM cooking_competitions WHERE tenant_id=$1 ORDER BY competition_date DESC NULLS LAST`, [tid])).rows;

    const compHtml = competitions.map(c => {
      const parts = Array.isArray(c.participants) ? c.participants : [];
      return `<div class="card" style="padding:20px">
        <div style="display:flex;align-items:flex-start;gap:16px">
          <div style="font-size:36px">🏆</div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong style="font-size:16px">${esc(c.title)}</strong>${statusBadge(c.status)}</div>
            <div style="font-size:13px;color:${GRAY};margin-top:6px">Theme: <strong>${esc(c.theme || 'Open')}</strong> · Date: ${fmtDate(c.competition_date)} · Deadline: ${fmtDate(c.deadline)}</div>
            <div style="font-size:12px;color:${GRAY};margin-top:2px">👥 ${parts.length}/${c.max_participants || 20} participants</div>
            ${c.prizes ? `<div style="font-size:12px;color:${GRAY};margin-top:2px">🎁 ${esc(c.prizes)}</div>` : ''}
            ${c.status === 'open' ? `<div style="margin-top:10px"><form method="POST" action="/school/cooking-club/competitions/${c.id}/join"><button class="btn" style="background:#16a34a;font-size:12px;padding:6px 14px">Join Competition</button></form></div>` : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">${nav('comp')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🏆 Cooking Competitions</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Show off your culinary skills</p></div>
        ${(user.role === 'admin' || user.role === 'teacher') ? `<a href="/school/cooking-club/competitions/create" class="btn" style="background:#16a34a">+ Create Competition</a>` : ''}
      </div>
      ${compHtml || '<div class="card" style="text-align:center;padding:40px;color:${GRAY}"><p style="font-size:40px;margin-bottom:12px">🏆</p>No competitions yet</div>'}
    </div>`;
    res.send(renderPage('Cooking Competitions', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: POST /school/cooking-club/competitions/:id/join
  // ============================================================
  app.post('/school/cooking-club/competitions/:id/join', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id, cid = req.params.id;
    const comp = (await pool.query(`SELECT id, participants, max_participants FROM cooking_competitions WHERE id=$1 AND tenant_id=$2 AND status='open'`, [cid, tid])).rows[0];
    if (!comp) { req.session.flash = { type: 'error', msg: 'Competition not found or closed' }; return res.redirect('/school/cooking-club/competitions'); }
    const parts = Array.isArray(comp.participants) ? comp.participants : [];
    if (parts.includes(uid)) { req.session.flash = { type: 'error', msg: 'Already joined' }; return res.redirect('/school/cooking-club/competitions'); }
    if (parts.length >= (comp.max_participants || 20)) { req.session.flash = { type: 'error', msg: 'Competition is full' }; return res.redirect('/school/cooking-club/competitions'); }
    parts.push(uid);
    await pool.query(`UPDATE cooking_competitions SET participants=$1 WHERE id=$2 AND tenant_id=$3`, [JSON.stringify(parts), cid, tid]);
    await audit(tid, uid, 'comp_join', { competition_id: parseInt(cid) });
    req.session.flash = { type: 'success', msg: 'Joined competition!' };
    res.redirect('/school/cooking-club/competitions');
  }));

  // ============================================================
  // ROUTE 13: GET/POST competitions create
  // ============================================================
  app.get('/school/cooking-club/competitions/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/cooking-club/competitions');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('comp')}
      <a href="/school/cooking-club/competitions" style="color:${GRAY};text-decoration:none;font-size:14px">← Back</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 20px">🏆 Create Competition</h2>
        <form method="POST" action="/school/cooking-club/competitions/create" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Title *</label><input type="text" name="title" required placeholder="e.g., Annual Bake-Off"></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Theme</label><input type="text" name="theme" placeholder="e.g., Chocolate Desserts"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Competition Date *</label><input type="date" name="competition_date" required></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Registration Deadline</label><input type="date" name="deadline"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Max Participants</label><input type="number" name="max_participants" value="20" min="2"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Prizes</label><input type="text" name="prizes" placeholder="1st: Trophy, 2nd: Certificate..."></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Rules</label><textarea name="rules" rows="3" placeholder="Competition rules and guidelines..."></textarea></div>
          <button type="submit" class="btn" style="background:#16a34a;padding:12px">Create Competition</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Competition', html, user, req));
  }));

  app.post('/school/cooking-club/competitions/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/cooking-club/competitions');
    const { title, theme, competition_date, deadline, max_participants, prizes, rules } = req.body;
    if (!title?.trim() || !competition_date) return res.redirect('/school/cooking-club/competitions/create');
    await pool.query(`INSERT INTO cooking_competitions (tenant_id, title, theme, competition_date, deadline, max_participants, prizes, rules) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, title.trim(), theme ? theme.trim() : null, competition_date, deadline || null, max_participants ? parseInt(max_participants) : 20, prizes ? prizes.trim() : null, rules ? rules.trim() : null]);
    await audit(tid, user.id, 'comp_create', { title: title.trim() });
    req.session.flash = { type: 'success', msg: 'Competition created!' };
    res.redirect('/school/cooking-club/competitions');
  }));

  // ============================================================
  // ROUTE 14: GET /school/cooking-club/nutrition — Nutrition
  // ============================================================
  app.get('/school/cooking-club/nutrition', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, uid = user.id;
    const logs = (await pool.query(`SELECT * FROM nutrition_logs WHERE tenant_id=$1 AND student_id=$2 ORDER BY meal_date DESC, created_at DESC LIMIT 30`, [tid, uid])).rows;
    const totals = logs.reduce((acc, l) => ({
      calories: acc.calories + (l.calories || 0),
      protein: acc.protein + parseFloat(l.protein || 0),
      carbs: acc.carbs + parseFloat(l.carbs || 0),
      fat: acc.fat + parseFloat(l.fat || 0)
    }), { calories: 0, protein: 0, carbs: 0, fat: 0 });

    const logsHtml = logs.map(l => {
      const items = Array.isArray(l.food_items) ? l.food_items : [];
      return `<tr>
        <td>${fmtDate(l.meal_date)}</td>
        <td>${esc(l.meal_type || '—')}</td>
        <td>${esc(items.join(', ') || '—')}</td>
        <td><strong>${l.calories || 0}</strong></td>
        <td>${l.protein || 0}g</td>
        <td>${l.carbs || 0}g</td>
        <td>${l.fat || 0}g</td>
      </tr>`;
    }).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">${nav('nutrition')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🥗 Nutrition Tracker</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Track your daily nutritional intake</p></div>
        <a href="/school/cooking-club/nutrition/log" class="btn" style="background:#16a34a">+ Log Meal</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:20px">
        ${statCard(Math.round(totals.calories), 'Total Calories', '#dc2626')}
        ${statCard(totals.protein.toFixed(1) + 'g', 'Protein', '#16a34a')}
        ${statCard(totals.carbs.toFixed(1) + 'g', 'Carbs', '#f59e0b')}
        ${statCard(totals.fat.toFixed(1) + 'g', 'Fat', '#8b5cf6')}
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Date</th><th>Meal</th><th>Food Items</th><th>Calories</th><th>Protein</th><th>Carbs</th><th>Fat</th></tr></thead>
        <tbody>${logsHtml || '<tr><td colspan="7" style="text-align:center;color:${GRAY};padding:30px">No nutrition logs yet</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Nutrition Tracker', html, user, req));
  }));

  // ============================================================
  // ROUTE 15: GET/POST /school/cooking-club/nutrition/log
  // ============================================================
  app.get('/school/cooking-club/nutrition/log', requireAuth, requireNotBanned, ah(async (req, res) => {
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('nutrition')}
      <a href="/school/cooking-club/nutrition" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Nutrition</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 20px">📝 Log Your Meal</h2>
        <form method="POST" action="/school/cooking-club/nutrition/log" style="display:flex;flex-direction:column;gap:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Date *</label><input type="date" name="meal_date" value="${today()}" required></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Meal Type</label><select name="meal_type"><option value="breakfast">Breakfast</option><option value="lunch">Lunch</option><option value="dinner">Dinner</option><option value="snack">Snack</option></select></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Food Items (one per line)</label><textarea name="food_items" rows="4" placeholder="Grilled chicken breast&#10;Brown rice&#10;Steamed broccoli"></textarea></div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Calories</label><input type="number" name="calories" value="0" min="0"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Protein (g)</label><input type="number" name="protein" value="0" min="0" step="0.1"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Carbs (g)</label><input type="number" name="carbs" value="0" min="0" step="0.1"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Fat (g)</label><input type="number" name="fat" value="0" min="0" step="0.1"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Notes</label><textarea name="notes" rows="2" placeholder="Any notes about the meal..."></textarea></div>
          <button type="submit" class="btn" style="background:#16a34a;padding:12px">Log Meal</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Log Meal', html, user, req));
  }));

  app.post('/school/cooking-club/nutrition/log', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    const { meal_date, meal_type, food_items, calories, protein, carbs, fat, notes } = req.body;
    if (!meal_date) return res.redirect('/school/cooking-club/nutrition/log');
    const items = (food_items || '').split('\n').map(s => s.trim()).filter(Boolean);
    await pool.query(`INSERT INTO nutrition_logs (tenant_id, student_id, meal_date, meal_type, food_items, calories, protein, carbs, fat, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tid, uid, meal_date, meal_type || 'lunch', JSON.stringify(items), calories ? parseInt(calories) : 0, protein ? parseFloat(protein) : 0, carbs ? parseFloat(carbs) : 0, fat ? parseFloat(fat) : 0, notes ? notes.trim() : null]);
    await audit(tid, uid, 'nutrition_log', { meal_date, meal_type, calories });
    req.session.flash = { type: 'success', msg: 'Meal logged!' };
    res.redirect('/school/cooking-club/nutrition');
  }));

  // ============================================================
  // ROUTE 16: GET /school/cooking-club/my-recipes — My recipes
  // ============================================================
  app.get('/school/cooking-club/my-recipes', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, uid = user.id;
    const recipes = (await pool.query(`SELECT * FROM recipes WHERE tenant_id=$1 AND created_by=$2 ORDER BY created_at DESC`, [tid, uid])).rows;

    const recipesHtml = recipes.map(r => `<div class="card" style="padding:14px;display:flex;gap:14px;align-items:center">
      ${r.image_url ? `<img src="${esc(r.image_url)}" style="width:80px;height:60px;border-radius:8px;object-fit:cover" alt="">` : '<div style="width:80px;height:60px;background:#fef3c7;border-radius:8px;display:flex;align-items:center;justify-content:center">🍳</div>'}
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:6px"><strong style="font-size:14px">${esc(r.title)}</strong>${statusBadge(r.status)}${diffBadge(r.difficulty)}</div>
        <div style="font-size:12px;color:${GRAY};margin-top:2px">${esc(r.cuisine || 'General')} · ${r.prep_time||0}m prep · ${r.cook_time||0}m cook · ${r.servings||4} servings · ${fmtDate(r.created_at)}</div>
      </div>
      <div style="display:flex;gap:6px">
        <a href="/school/cooking-club/recipes/${r.id}" class="btn" style="font-size:11px;padding:4px 10px">View</a>
        <form method="POST" action="/school/cooking-club/my-recipes/${r.id}/delete" onsubmit="return confirm('Delete this recipe?')"><button class="btn" style="font-size:11px;padding:4px 10px;background:#dc2626">Delete</button></form>
      </div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:800px;margin:0 auto">${nav('my')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">📝 My Recipes</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${recipes.length} recipes created</p></div>
        <a href="/school/cooking-club/recipes/new" class="btn" style="background:#16a34a">+ New Recipe</a>
      </div>
      ${recipesHtml || '<div class="card" style="text-align:center;padding:40px;color:${GRAY}"><p style="font-size:40px;margin-bottom:12px">📝</p>You haven\'t created any recipes yet.<br><a href="/school/cooking-club/recipes/new" style="color:${P}">Create your first recipe</a></div>'}
    </div>`;
    res.send(renderPage('My Recipes', html, user, req));
  }));

  // ============================================================
  // ROUTE 17: POST my-recipes delete
  // ============================================================
  app.post('/school/cooking-club/my-recipes/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    await pool.query(`DELETE FROM recipes WHERE id=$1 AND tenant_id=$2 AND created_by=$3`, [req.params.id, tid, uid]);
    req.session.flash = { type: 'success', msg: 'Recipe deleted' };
    res.redirect('/school/cooking-club/my-recipes');
  }));
};
