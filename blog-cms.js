// ============================================================
// BLOG & CMS MODULE — Multi-Tenant SaaS Platform
// Public blog, post CRUD, categories, tags, SEO, scheduling,
// comment moderation, read time, draft/published tabs.
// ============================================================
'use strict';

module.exports = function blogCms(app, db, pool, renderPage, esc) {
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
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';

  function slugify(text) {
    return String(text).toLowerCase().trim().replace(/[^a-z0-9\s-]/g, '').replace(/[\s-]+/g, '-').replace(/^-+|-+$/g, '');
  }
  function readTime(text) {
    if (!text) return '1 min';
    const words = text.replace(/<[^>]*>/g, '').split(/\s+/).length;
    return Math.max(1, Math.ceil(words / 200)) + ' min read';
  }
  function seoScore(post) {
    let score = 0;
    if (post.title && post.title.length >= 10) score += 20;
    if (post.meta_title && post.meta_title.length >= 10 && post.meta_title.length <= 60) score += 20;
    if (post.meta_description && post.meta_description.length >= 50 && post.meta_description.length <= 160) score += 20;
    if (post.content && post.content.length >= 300) score += 20;
    if (post.cover_image) score += 10;
    if (post.tags && post.tags.length > 0) score += 5;
    if (post.category) score += 5;
    if (score >= 80) return { label: 'Good', color: '#16a34a', bg: '#dcfce7', score };
    if (score >= 50) return { label: 'OK', color: '#f59e0b', bg: '#fef9c3', score };
    return { label: 'Low', color: '#dc2626', bg: '#fee2e2', score };
  }
  function statusBadge(status) {
    const map = { draft: { bg: '#fef9c3', c: '#a16207', l: 'Draft' }, published: { bg: '#dcfce7', c: '#16a34a', l: 'Published' }, archived: { bg: '#f1f5f9', c: '#64748b', l: 'Archived' }, scheduled: { bg: '#dbeafe', c: '#2563eb', l: 'Scheduled' } };
    const s = map[status] || map.draft;
    return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
  }
  function commentStatusBadge(status) {
    const map = { pending: { bg: '#fef9c3', c: '#a16207', l: 'Pending' }, approved: { bg: '#dcfce7', c: '#16a34a', l: 'Approved' }, rejected: { bg: '#fee2e2', c: '#dc2626', l: 'Rejected' } };
    const s = map[status] || map.pending;
    return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const BLOG_CSS = `<style>
    .blog-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;align-items:center}
    .blog-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .blog-nav a:hover{background:#e2e8f0}.blog-nav a.active{background:#059669;color:#fff}
    .blog-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:18px}
    .blog-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;transition:.2s;display:flex;flex-direction:column}
    .blog-card:hover{box-shadow:0 4px 20px rgba(0,0,0,.08);transform:translateY(-2px)}
    .blog-card-img{height:180px;background:#e2e8f0;position:relative;overflow:hidden}
    .blog-card-img img{width:100%;height:100%;object-fit:cover}
    .blog-card-img .placeholder{display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8;font-size:40px}
    .blog-card-body{padding:18px;flex:1;display:flex;flex-direction:column}
    .blog-card-body h3{margin:0 0 8px;font-size:17px;color:#1e293b;line-height:1.3}
    .blog-card-body h3 a{color:#1e293b;text-decoration:none}.blog-card-body h3 a:hover{color:#059669}
    .blog-card-meta{font-size:12px;color:#94a3b8;margin-bottom:10px;display:flex;gap:12px;align-items:center}
    .blog-card-excerpt{font-size:13px;color:#64748b;line-height:1.6;flex:1;margin-bottom:12px}
    .blog-card-tags{display:flex;gap:5px;flex-wrap:wrap;margin-bottom:10px}
    .blog-card-actions{display:flex;gap:6px;flex-wrap:wrap;margin-top:auto;padding-top:10px;border-top:1px solid #f1f5f9}
    .blog-cat-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .blog-seo-ring{width:34px;height:34px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:800}
    .blog-filter{display:flex;gap:10px;margin-bottom:18px;flex-wrap:wrap;align-items:end}
    .blog-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .blog-filter input,.blog-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .blog-filter input:focus,.blog-filter select:focus{outline:none;border-color:#059669}
    .blog-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
    .blog-form input,.blog-form select,.blog-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
    .blog-form input:focus,.blog-form select:focus,.blog-form textarea:focus{outline:none;border-color:#059669}
    .blog-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .blog-content-area{min-height:300px;font-family:monospace;font-size:14px;line-height:1.6}
    .blog-comment{padding:14px;border:1px solid #e2e8f0;border-radius:10px;margin-bottom:10px;background:#fff}
    .blog-comment-meta{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px}
    .blog-comment-author{font-size:13px;font-weight:700;color:#1e293b}
    .blog-comment-text{font-size:13px;color:#475569;line-height:1.6;white-space:pre-wrap}
    .blog-post-cover{width:100%;max-height:380px;object-fit:cover;border-radius:12px;margin-bottom:20px;background:#e2e8f0}
    .blog-post-body{font-size:15px;color:#334155;line-height:1.8;white-space:pre-wrap}
    .blog-scheduled-badge{position:absolute;top:10px;right:10px;background:#2563eb;color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .blog-featured-badge{position:absolute;top:10px;left:10px;background:#f59e0b;color:#fff;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
    @media(max-width:768px){.blog-grid{grid-template-columns:1fr}.blog-form-grid{grid-template-columns:1fr}}
  </style>`;

  // -- admin navigation helper -------------------------------------------
  const adminNav = (active) => `<div class="blog-nav">
    <a href="/blog/admin" class="${active === 'dashboard' ? 'active' : ''}">📊 Dashboard</a>
    <a href="/blog/admin/new" class="${active === 'new' ? 'active' : ''}">✏️ New Post</a>
    <a href="/blog/admin/categories" class="${active === 'categories' ? 'active' : ''}">📂 Categories</a>
    <a href="/blog/admin/comments" class="${active === 'comments' ? 'active' : ''}">💬 Comments</a>
    <a href="/blog" target="_blank" style="background:#f1f5f9;color:#475569;margin-left:auto">👁 View Blog</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[Blog] Cannot connect to DB for migrations'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS blog_posts (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL, slug VARCHAR(255) UNIQUE,
        content TEXT, excerpt TEXT, cover_image TEXT,
        author_id INTEGER REFERENCES users(id), author_name VARCHAR(255),
        category VARCHAR(100), tags TEXT[],
        status VARCHAR(20) DEFAULT 'draft', is_featured BOOLEAN DEFAULT false,
        meta_title VARCHAR(255), meta_description TEXT,
        published_at TIMESTAMPTZ, scheduled_at TIMESTAMPTZ,
        view_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS blog_categories (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL, slug VARCHAR(100), description TEXT,
        color VARCHAR(20) DEFAULT '#3b82f6', post_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS blog_comments (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        post_id INTEGER NOT NULL REFERENCES blog_posts(id) ON DELETE CASCADE,
        author_name VARCHAR(255), author_email VARCHAR(255),
        content TEXT NOT NULL, status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // ALTER TABLE — blog_posts
      const postCols = [
        ['title', "VARCHAR(255) NOT NULL DEFAULT ''"], ['slug', 'VARCHAR(255) UNIQUE'],
        ['content', 'TEXT'], ['excerpt', 'TEXT'], ['cover_image', 'TEXT'],
        ['author_id', 'INTEGER REFERENCES users(id)'], ['author_name', 'VARCHAR(255)'],
        ['category', 'VARCHAR(100)'], ['tags', 'TEXT[]'],
        ['status', "VARCHAR(20) DEFAULT 'draft'"], ['is_featured', 'BOOLEAN DEFAULT false'],
        ['meta_title', 'VARCHAR(255)'], ['meta_description', 'TEXT'],
        ['published_at', 'TIMESTAMPTZ'], ['scheduled_at', 'TIMESTAMPTZ'],
        ['view_count', 'INTEGER DEFAULT 0'],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'], ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of postCols) { try { await c.query(`ALTER TABLE blog_posts ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }
      // ALTER TABLE — blog_categories
      const catCols = [
        ['name', "VARCHAR(100) NOT NULL DEFAULT ''"], ['slug', 'VARCHAR(100)'],
        ['description', 'TEXT'], ['color', "VARCHAR(20) DEFAULT '#3b82f6'"],
        ['post_count', 'INTEGER DEFAULT 0'], ['created_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of catCols) { try { await c.query(`ALTER TABLE blog_categories ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }
      // ALTER TABLE — blog_comments
      const commentCols = [
        ['author_name', 'VARCHAR(255)'], ['author_email', 'VARCHAR(255)'],
        ['content', "TEXT NOT NULL DEFAULT ''"], ['status', "VARCHAR(20) DEFAULT 'pending'"],
        ['created_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, def] of commentCols) { try { await c.query(`ALTER TABLE blog_comments ADD COLUMN IF NOT EXISTS ${col} ${def}`); } catch (e) {} }
      // Indexes
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bp_tenant ON blog_posts(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bp_status ON blog_posts(tenant_id, status)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bp_slug ON blog_posts(slug)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bp_category ON blog_posts(tenant_id, category)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bp_published ON blog_posts(tenant_id, published_at DESC)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bc_tenant ON blog_categories(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bc_slug ON blog_categories(slug)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bcm_tenant ON blog_comments(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bcm_post ON blog_comments(post_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bcm_status ON blog_comments(tenant_id, status)`);
      console.log('[Blog] Migrations applied successfully');
    } catch (e) { console.error('[Blog] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // -- ROUTE 1: GET /blog — Public blog listing -------------------------
  app.get('/blog', ah(async (req, res) => {
    const user = req.session?.user;
    const tid = user?.tenant_id || 0;
    const category = req.query.category || '';
    const search = (req.query.search || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 12, offset = (page - 1) * limit;

    let where = ['p.tenant_id=$1', "p.status='published'"], params = [tid], pi = 2;
    if (category) { where.push(`p.category=$${pi++}`); params.push(category); }
    if (search) { where.push(`(p.title ILIKE $${pi} OR p.excerpt ILIKE $${pi})`); params.push(`%${search}%`); pi++; }

    const categories = (await pool.query(`SELECT DISTINCT name, color FROM blog_categories WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const total = (await pool.query(`SELECT COUNT(*)::int as cnt FROM blog_posts p WHERE ${where.join(' AND ')}`, params)).rows[0].cnt;
    const totalPages = Math.ceil(total / limit);
    const posts = (await pool.query(
      `SELECT p.*, u.name as author_display FROM blog_posts p LEFT JOIN users u ON u.id = p.author_id
       WHERE ${where.join(' AND ')} ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC LIMIT $${pi} OFFSET $${pi + 1}`,
      [...params, limit, offset]
    )).rows;

    const cards = posts.map(p => {
      const coverHtml = p.cover_image
        ? `<div class="blog-card-img"><img src="${esc(p.cover_image)}" alt="${esc(p.title)}" loading="lazy"></div>`
        : `<div class="blog-card-img"><div class="placeholder">📰</div></div>`;
      const tagsHtml = (p.tags || []).map(t => `<span class="badge" style="background:#f1f5f9;color:#64748b;font-size:10px">${esc(t)}</span>`).join('');
      const catObj = categories.find(c => c.name === p.category);
      const catHtml = p.category ? `<span class="blog-cat-badge" style="background:${catObj?.color || '#3b82f6'}22;color:${catObj?.color || '#3b82f6'}">${esc(p.category)}</span>` : '';
      return `<div class="blog-card">
        ${coverHtml}
        <div class="blog-card-body">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:8px">
            ${catHtml}${p.is_featured ? '<span class="badge badge-warning" style="font-size:10px">⭐ Featured</span>' : ''}
          </div>
          <h3><a href="/blog/${esc(p.slug)}">${esc(p.title)}</a></h3>
          <div class="blog-card-meta">
            <span>✍️ ${esc(p.author_name || p.author_display || 'Admin')}</span>
            <span>📅 ${fmtDate(p.published_at || p.created_at)}</span>
            <span>📖 ${readTime(p.content)}</span>
          </div>
          <div class="blog-card-excerpt">${esc(p.excerpt || (p.content || '').substring(0, 140) + '...')}</div>
          ${tagsHtml ? `<div class="blog-card-tags">${tagsHtml}</div>` : ''}
        </div>
      </div>`;
    }).join('');

    const flash = req.session?.flash; req.session.flash = null;
    const html = BLOG_CSS + `<div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:28px;color:#1e293b;margin:0">📰 Blog</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Insights, news, and updates</p></div>
      </div>
      ${flash ? `<div class="alert" style="background:#dcfce7;color:#16a34a;padding:12px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">${esc(flash.msg)}</div>` : ''}
      <div class="blog-filter">
        <div><label>Category</label><select onchange="location.href='/blog?category='+this.value">
          <option value="">All Categories</option>
          ${categories.map(c => `<option value="${esc(c.name)}" ${category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></div>
        <div><label>Search</label><form method="GET" action="/blog" style="display:flex;gap:6px">
          <input type="text" name="search" value="${esc(search)}" placeholder="Search posts..." style="width:240px">
          <button type="submit" class="btn btn-blue btn-sm">Search</button>
        </form></div>
      </div>
      ${posts.length ? `<div class="blog-grid">${cards}</div>` :
        `<div class="card" style="text-align:center;padding:48px"><p style="font-size:18px;color:#64748b">No posts found</p></div>`}
      ${totalPages > 1 ? `<div style="display:flex;justify-content:center;gap:6px;margin-top:24px">
        ${page > 1 ? `<a href="/blog?page=${page - 1}&category=${esc(category)}&search=${esc(search)}" class="btn btn-sm" style="background:#f1f5f9">← Previous</a>` : ''}
        <span style="padding:8px 14px;font-size:13px;color:#64748b">Page ${page} of ${totalPages}</span>
        ${page < totalPages ? `<a href="/blog?page=${page + 1}&category=${esc(category)}&search=${esc(search)}" class="btn btn-blue btn-sm">Next →</a>` : ''}
      </div>` : ''}
    </div>`;
    res.send(renderPage('Blog', html, user || { tenant_id: tid }, req));
  }));

  // -- ROUTE 2: GET /blog/:slug — Public post view -----------------------
  app.get('/blog/:slug', ah(async (req, res) => {
    const user = req.session?.user;
    const tid = user?.tenant_id || 0;
    const slug = req.params.slug;
    const post = (await pool.query(
      `SELECT p.*, u.name as author_display FROM blog_posts p LEFT JOIN users u ON u.id = p.author_id
       WHERE p.slug=$1 AND p.tenant_id=$2 AND p.status='published'`, [slug, tid]
    )).rows[0];
    if (!post) return res.status(404).send(renderPage('Not Found',
      '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Post not found</h2><a href="/blog" class="btn btn-blue btn-sm" style="margin-top:12px">← Back to Blog</a></div>', user, req));

    await pool.query(`UPDATE blog_posts SET view_count = view_count + 1 WHERE id=$1`, [post.id]);
    const comments = (await pool.query(`SELECT * FROM blog_comments WHERE post_id=$1 AND status='approved' ORDER BY created_at DESC`, [post.id])).rows;
    const coverHtml = post.cover_image ? `<img src="${esc(post.cover_image)}" alt="${esc(post.title)}" class="blog-post-cover">` : '';
    const commentsHtml = comments.map(cm => `<div class="blog-comment">
        <div class="blog-comment-meta"><span class="blog-comment-author">✍️ ${esc(cm.author_name)}</span><span style="font-size:11px;color:#94a3b8">${fmtDate(cm.created_at)}</span></div>
        <div class="blog-comment-text">${esc(cm.content)}</div></div>`).join('');
    const tagsHtml = (post.tags || []).map(t => `<span class="badge" style="background:#f1f5f9;color:#64748b">${esc(t)}</span>`).join(' ');
    const flash = req.session?.flash; req.session.flash = null;

    const html = BLOG_CSS + `<div style="max-width:800px;margin:0 auto">
      <a href="/blog" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Blog</a>
      ${flash ? `<div class="alert" style="background:#dcfce7;color:#16a34a;padding:12px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">${esc(flash.msg)}</div>` : ''}
      <article>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          ${post.category ? `<span class="blog-cat-badge" style="background:#05966922;color:#059669;font-size:12px">${esc(post.category)}</span>` : ''}
          ${post.is_featured ? '<span class="badge badge-warning">⭐ Featured</span>' : ''}
        </div>
        <h1 style="font-size:30px;color:#1e293b;line-height:1.3;margin:0 0 12px">${esc(post.title)}</h1>
        <div style="display:flex;gap:16px;align-items:center;font-size:13px;color:#64748b;margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #e2e8f0;flex-wrap:wrap">
          <span>✍️ ${esc(post.author_name || post.author_display || 'Admin')}</span>
          <span>📅 ${fmtDate(post.published_at || post.created_at)}</span>
          <span>📖 ${readTime(post.content)}</span>
          <span>👁 ${post.view_count} views</span>
        </div>
        ${coverHtml}
        <div class="blog-post-body">${esc(post.content)}</div>
        ${tagsHtml ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0">${tagsHtml}</div>` : ''}
      </article>
      <div style="margin-top:36px">
        <h2 style="font-size:20px;color:#1e293b;margin-bottom:16px">💬 Comments (${comments.length})</h2>
        <div class="card" style="padding:20px;margin-bottom:16px">
          <form method="POST" action="/blog/${esc(post.slug)}/comment" style="display:flex;flex-direction:column;gap:12px">
            <div class="blog-form-grid">
              <div><label>Name *</label><input type="text" name="author_name" required placeholder="Your name"></div>
              <div><label>Email *</label><input type="email" name="author_email" required placeholder="your@email.com"></div>
            </div>
            <div><label>Comment *</label><textarea name="content" rows="3" required placeholder="Share your thoughts..."></textarea></div>
            <button type="submit" class="btn btn-green" style="align-self:flex-start;padding:10px 24px">Post Comment</button>
          </form>
        </div>
        ${commentsHtml || '<p class="muted" style="text-align:center;padding:24px">No comments yet. Be the first to comment!</p>'}
      </div>
    </div>`;
    res.send(renderPage(post.title, html, user, req));
  }));

  // -- ROUTE 3: POST /blog/:slug/comment — Submit comment ----------------
  app.post('/blog/:slug/comment', ah(async (req, res) => {
    const slug = req.params.slug;
    const { author_name, author_email, content } = req.body;
    if (!author_name || !author_email || !content || !content.trim()) return res.redirect('/blog/' + slug);
    const post = (await pool.query(`SELECT id, tenant_id FROM blog_posts WHERE slug=$1 AND status='published'`, [slug])).rows[0];
    if (!post) return res.redirect('/blog');
    await pool.query(`INSERT INTO blog_comments (tenant_id, post_id, author_name, author_email, content) VALUES ($1,$2,$3,$4,$5)`,
      [post.tenant_id, post.id, author_name.trim(), author_email.trim(), content.trim()]);
    req.session.flash = { type: 'success', msg: 'Comment submitted and awaiting moderation.' };
    res.redirect('/blog/' + slug);
  }));

  // -- ROUTE 4: GET /blog/admin — Admin dashboard ------------------------
  app.get('/blog/admin', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const tab = req.query.tab || 'all';
    const search = (req.query.search || '').trim();
    const totalPosts = (await pool.query(`SELECT COUNT(*)::int as cnt FROM blog_posts WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const draftCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM blog_posts WHERE tenant_id=$1 AND status='draft'`, [tid])).rows[0].cnt;
    const publishedCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM blog_posts WHERE tenant_id=$1 AND status='published'`, [tid])).rows[0].cnt;
    const scheduledCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM blog_posts WHERE tenant_id=$1 AND status='draft' AND scheduled_at IS NOT NULL AND scheduled_at > NOW()`, [tid])).rows[0].cnt;
    const totalViews = (await pool.query(`SELECT COALESCE(SUM(view_count),0)::int as cnt FROM blog_posts WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const pendingComments = (await pool.query(`SELECT COUNT(*)::int as cnt FROM blog_comments WHERE tenant_id=$1 AND status='pending'`, [tid])).rows[0].cnt;

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (tab === 'draft') where.push("status='draft'");
    else if (tab === 'published') where.push("status='published'");
    else if (tab === 'scheduled') where.push('scheduled_at IS NOT NULL AND scheduled_at > NOW()');
    if (search) { where.push(`(title ILIKE $${pi})`); params.push(`%${search}%`); pi++; }

    const posts = (await pool.query(
      `SELECT p.*, u.name as author_display FROM blog_posts p LEFT JOIN users u ON u.id = p.author_id
       WHERE ${where.join(' AND ')} ORDER BY p.updated_at DESC LIMIT 50`, params
    )).rows;

    const rows = posts.map(p => {
      const seo = seoScore(p);
      return `<tr>
        <td><a href="/blog/${esc(p.slug)}" target="_blank" style="color:#059669;text-decoration:none;font-weight:600">${esc(p.title.length > 40 ? p.title.substring(0, 40) + '...' : p.title)}</a>
          ${p.is_featured ? ' <span class="badge badge-warning" style="font-size:9px">⭐</span>' : ''}</td>
        <td>${statusBadge(p.status)}</td>
        <td style="font-size:12px">${esc(p.category || '—')}</td>
        <td><div class="blog-seo-ring" style="background:${seo.bg};color:${seo.c}">${seo.score}</div></td>
        <td style="font-size:12px;color:#64748b">${p.view_count}</td>
        <td style="font-size:12px;color:#94a3b8">${fmtDate(p.updated_at)}</td>
        <td style="white-space:nowrap">
          <a href="/blog/admin/${p.id}/edit" class="btn btn-blue btn-sm">Edit</a>
          ${p.status === 'draft' ? `<form method="POST" action="/blog/admin/${p.id}/publish" style="display:inline"><button class="btn btn-green btn-sm">Publish</button></form>` : ''}
          ${p.status === 'draft' ? `<form method="POST" action="/blog/admin/${p.id}/schedule" style="display:inline"><button class="btn btn-gold btn-sm">Schedule</button></form>` : ''}
          <form method="POST" action="/blog/admin/${p.id}/delete" onsubmit="return confirm('Delete this post?')" style="display:inline"><button class="btn btn-red btn-sm">Delete</button></form>
        </td></tr>`;
    }).join('');

    const html = BLOG_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${adminNav('dashboard')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Blog Dashboard</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage your blog content</p></div>
        <a href="/blog/admin/new" class="btn btn-green">+ New Post</a>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num">${totalPosts}</div><div class="muted">Total Posts</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${draftCount}</div><div class="muted">Drafts</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${publishedCount}</div><div class="muted">Published</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#2563eb">${scheduledCount}</div><div class="muted">Scheduled</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">${totalViews}</div><div class="muted">Total Views</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ea580c">${pendingComments}</div><div class="muted">Pending Comments</div></div>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
        <a href="/blog/admin?tab=all" class="btn btn-sm ${tab === 'all' ? 'btn-blue' : ''}" style="${tab !== 'all' ? 'background:#f1f5f9;color:#475569' : ''}">All (${totalPosts})</a>
        <a href="/blog/admin?tab=draft" class="btn btn-sm ${tab === 'draft' ? 'btn-blue' : ''}" style="${tab !== 'draft' ? 'background:#f1f5f9;color:#475569' : ''}">Drafts (${draftCount})</a>
        <a href="/blog/admin?tab=published" class="btn btn-sm ${tab === 'published' ? 'btn-blue' : ''}" style="${tab !== 'published' ? 'background:#f1f5f9;color:#475569' : ''}">Published (${publishedCount})</a>
        <a href="/blog/admin?tab=scheduled" class="btn btn-sm ${tab === 'scheduled' ? 'btn-blue' : ''}" style="${tab !== 'scheduled' ? 'background:#f1f5f9;color:#475569' : ''}">Scheduled (${scheduledCount})</a>
      </div>
      <div class="blog-filter"><div><label>Search</label>
        <form method="GET" action="/blog/admin" style="display:flex;gap:6px">
          <input type="hidden" name="tab" value="${esc(tab)}">
          <input type="text" name="search" value="${esc(search)}" placeholder="Search posts..." style="width:240px">
          <button type="submit" class="btn btn-blue btn-sm">Search</button>
        </form></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Title</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Status</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Category</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">SEO</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Views</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Updated</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Actions</th>
        </tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No posts found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Blog Admin', html, user, req));
  }));

  // -- ROUTE 5: GET /blog/admin/new — Create post form ------------------
  app.get('/blog/admin/new', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const categories = (await pool.query(`SELECT * FROM blog_categories WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const html = BLOG_CSS + `<div style="max-width:900px;margin:0 auto">
      ${adminNav('new')}
      <a href="/blog/admin" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">✏️ Create New Post</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Write and publish your blog post</p>
        <form method="POST" action="/blog/admin/create" class="blog-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Post Title *</label><input type="text" name="title" required placeholder="Enter your post title..." id="blog-title"></div>
          <div><label>Content *</label><textarea name="content" rows="12" required placeholder="Write your blog post content here..." class="blog-content-area" id="blog-content"></textarea></div>
          <div><label>Excerpt</label><textarea name="excerpt" rows="2" placeholder="Brief summary (optional, auto-generated from content)"></textarea></div>
          <div class="blog-form-grid">
            <div><label>Category</label><select name="category"><option value="">— Select Category —</option>
              ${categories.map(c => `<option value="${esc(c.name)}">${esc(c.name)}</option>`).join('')}</select></div>
            <div><label>Tags (comma-separated)</label><input type="text" name="tags" placeholder="e.g. technology, tips, news"></div>
          </div>
          <div class="blog-form-grid">
            <div><label>Cover Image URL</label><input type="url" name="cover_image" placeholder="https://example.com/image.jpg"></div>
            <div style="display:flex;align-items:end;gap:14px"><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="is_featured" value="true" style="accent-color:#059669"> ⭐ Featured Post</label></div>
          </div>
          <div style="padding:16px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
            <h3 style="font-size:14px;color:#475569;margin:0 0 12px">🔍 SEO Settings</h3>
            <div class="blog-form-grid">
              <div><label>Meta Title</label><input type="text" name="meta_title" placeholder="SEO title (50-60 chars)" maxlength="60"></div>
              <div><label>Meta Description</label><input type="text" name="meta_description" placeholder="SEO description (120-160 chars)" maxlength="160"></div>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <button type="submit" name="action" value="publish" class="btn btn-green" style="padding:12px 28px">🚀 Publish</button>
            <button type="submit" name="action" value="draft" class="btn btn-sm" style="padding:12px 28px;background:#f1f5f9;color:#475569">💾 Save as Draft</button>
            <a href="/blog/admin" class="btn btn-sm" style="padding:12px 28px;background:#fee2e2;color:#dc2626">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Blog Post', html, user, req));
  }));

  // -- ROUTE 6: POST /blog/admin/create — Save post ----------------------
  app.post('/blog/admin/create', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, content, excerpt, category, tags, cover_image, is_featured, meta_title, meta_description, action } = req.body;
    if (!title || !title.trim() || !content || !content.trim()) return res.redirect('/blog/admin/new');
    let slug = slugify(title);
    const existing = await pool.query(`SELECT id FROM blog_posts WHERE slug=$1 AND tenant_id=$2`, [slug, tid]);
    if (existing.rows.length) slug = slug + '-' + Date.now().toString(36);
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const status = action === 'publish' ? 'published' : 'draft';
    const publishedAt = action === 'publish' ? new Date() : null;
    await pool.query(
      `INSERT INTO blog_posts (tenant_id,title,slug,content,excerpt,cover_image,author_id,author_name,category,tags,status,is_featured,meta_title,meta_description,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [tid, title.trim(), slug, content.trim(), (excerpt || '').trim() || null, (cover_image || '').trim() || null,
       user.id, user.name || user.email, (category || '').trim() || null, tagArr.length ? tagArr : null,
       status, is_featured === 'true', (meta_title || '').trim() || null, (meta_description || '').trim() || null, publishedAt]
    );
    req.session.flash = { type: 'success', msg: `Post ${status === 'published' ? 'published' : 'saved as draft'} successfully!` };
    res.redirect('/blog/admin');
  }));

  // -- ROUTE 7: GET /blog/admin/:id/edit — Edit post ---------------------
  app.get('/blog/admin/:id/edit', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const post = (await pool.query(`SELECT * FROM blog_posts WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!post) return res.redirect('/blog/admin');
    const categories = (await pool.query(`SELECT * FROM blog_categories WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const seo = seoScore(post);
    const html = BLOG_CSS + `<div style="max-width:900px;margin:0 auto">
      ${adminNav('')}
      <a href="/blog/admin" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="card" style="padding:28px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:10px">
          <div><h2 style="margin:0 0 4px;color:#1e293b">✏️ Edit Post</h2><p style="font-size:13px;color:#94a3b8">Editing "${esc(post.title)}"</p></div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;color:#64748b">SEO Score:</span>
            <div class="blog-seo-ring" style="background:${seo.bg};color:${seo.c};width:40px;height:40px;font-size:14px">${seo.score}%</div>
            <span class="badge" style="background:${seo.bg};color:${seo.c}">${seo.label}</span>
          </div>
        </div>
        <form method="POST" action="/blog/admin/${id}/update" class="blog-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Post Title *</label><input type="text" name="title" required value="${esc(post.title)}"></div>
          <div><label>Content *</label><textarea name="content" rows="12" required class="blog-content-area">${esc(post.content || '')}</textarea></div>
          <div><label>Excerpt</label><textarea name="excerpt" rows="2">${esc(post.excerpt || '')}</textarea></div>
          <div class="blog-form-grid">
            <div><label>Category</label><select name="category"><option value="">— Select Category —</option>
              ${categories.map(c => `<option value="${esc(c.name)}" ${post.category === c.name ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></div>
            <div><label>Tags (comma-separated)</label><input type="text" name="tags" value="${esc(Array.isArray(post.tags) ? post.tags.join(', ') : '')}"></div>
          </div>
          <div class="blog-form-grid">
            <div><label>Cover Image URL</label><input type="url" name="cover_image" value="${esc(post.cover_image || '')}"></div>
            <div style="display:flex;align-items:end;gap:14px"><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#475569;padding:12px;background:#f8fafc;border-radius:10px;cursor:pointer">
              <input type="checkbox" name="is_featured" value="true" ${post.is_featured ? 'checked' : ''} style="accent-color:#059669"> ⭐ Featured Post</label></div>
          </div>
          <div style="padding:16px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
            <h3 style="font-size:14px;color:#475569;margin:0 0 12px">🔍 SEO Settings</h3>
            <div class="blog-form-grid">
              <div><label>Meta Title <span class="muted" style="font-weight:400">(${(post.meta_title || '').length}/60)</span></label><input type="text" name="meta_title" value="${esc(post.meta_title || '')}" maxlength="60"></div>
              <div><label>Meta Description <span class="muted" style="font-weight:400">(${(post.meta_description || '').length}/160)</span></label><input type="text" name="meta_description" value="${esc(post.meta_description || '')}" maxlength="160"></div>
            </div>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <button type="submit" name="action" value="publish" class="btn btn-green" style="padding:12px 28px">💾 Save & Publish</button>
            <button type="submit" name="action" value="draft" class="btn btn-sm" style="padding:12px 28px;background:#f1f5f9;color:#475569">Save Draft</button>
            <a href="/blog/admin" class="btn btn-sm" style="padding:12px 28px;background:#fee2e2;color:#dc2626">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Post', html, user, req));
  }));

  // -- ROUTE 8: POST /blog/admin/:id/update — Update post ----------------
  app.post('/blog/admin/:id/update', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const post = (await pool.query(`SELECT id FROM blog_posts WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!post) return res.redirect('/blog/admin');
    const { title, content, excerpt, category, tags, cover_image, is_featured, meta_title, meta_description, action } = req.body;
    if (!title || !title.trim() || !content || !content.trim()) return res.redirect(`/blog/admin/${id}/edit`);
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const status = action === 'publish' ? 'published' : 'draft';
    await pool.query(
      `UPDATE blog_posts SET title=$1,content=$2,excerpt=$3,cover_image=$4,category=$5,tags=$6,status=$7,is_featured=$8,meta_title=$9,meta_description=$10,updated_at=NOW(),
        published_at=CASE WHEN $7='published' AND published_at IS NULL THEN NOW() ELSE published_at END
       WHERE id=$11 AND tenant_id=$12`,
      [title.trim(), content.trim(), (excerpt || '').trim() || null, (cover_image || '').trim() || null,
       (category || '').trim() || null, tagArr.length ? tagArr : null, status, is_featured === 'true',
       (meta_title || '').trim() || null, (meta_description || '').trim() || null, id, tid]
    );
    req.session.flash = { type: 'success', msg: 'Post updated successfully!' };
    res.redirect('/blog/admin');
  }));

  // -- ROUTE 9: DELETE /blog/admin/:id — Delete post ---------------------
  app.delete('/blog/admin/:id', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    await pool.query(`DELETE FROM blog_posts WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    req.session.flash = { type: 'success', msg: 'Post deleted successfully.' };
    res.redirect('/blog/admin');
  }));

  // -- ROUTE 10: POST /blog/admin/:id/publish — Publish draft -----------
  app.post('/blog/admin/:id/publish', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const post = (await pool.query(`SELECT id FROM blog_posts WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!post) return res.redirect('/blog/admin');
    await pool.query(`UPDATE blog_posts SET status='published', published_at=NOW(), updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    req.session.flash = { type: 'success', msg: 'Post published successfully!' };
    res.redirect('/blog/admin');
  }));

  // -- ROUTE 11: POST /blog/admin/:id/schedule — Schedule post -----------
  app.post('/blog/admin/:id/schedule', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const { scheduled_at } = req.body;
    const post = (await pool.query(`SELECT id FROM blog_posts WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!post || !scheduled_at) return res.redirect(`/blog/admin/${id}/edit`);
    await pool.query(`UPDATE blog_posts SET scheduled_at=$1, status='draft', updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [new Date(scheduled_at), id, tid]);
    req.session.flash = { type: 'success', msg: `Post scheduled for ${new Date(scheduled_at).toLocaleString()}` };
    res.redirect('/blog/admin');
  }));

  // -- ROUTE 12: GET /blog/admin/categories — Category management ---------
  app.get('/blog/admin/categories', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const categories = (await pool.query(
      `SELECT c.*, (SELECT COUNT(*)::int FROM blog_posts p WHERE p.category = c.name AND p.tenant_id = c.tenant_id) as actual_count
       FROM blog_categories c WHERE c.tenant_id=$1 ORDER BY c.name`, [tid]
    )).rows;
    const flash = req.session?.flash; req.session.flash = null;
    const catRows = categories.map(c => `<tr>
      <td><span style="display:inline-block;width:14px;height:14px;border-radius:4px;background:${c.color};margin-right:8px;vertical-align:middle"></span>
        <strong style="color:#1e293b">${esc(c.name)}</strong></td>
      <td style="font-size:12px;color:#64748b">${esc(c.slug || '—')}</td>
      <td style="font-size:12px;color:#64748b">${esc(c.description || '—')}</td>
      <td><span class="badge badge-success">${c.actual_count}</span></td>
      <td><form method="POST" action="/blog/admin/categories/delete" onsubmit="return confirm('Delete this category?')" style="display:inline">
        <input type="hidden" name="id" value="${c.id}"><button class="btn btn-red btn-sm">Delete</button></form></td>
    </tr>`).join('');
    const html = BLOG_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${adminNav('categories')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📂 Categories</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage blog categories</p></div>
      </div>
      ${flash ? `<div class="alert" style="background:${flash.type === 'error' ? '#fee2e2' : '#dcfce7'};color:${flash.type === 'error' ? '#dc2626' : '#16a34a'};padding:12px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">${esc(flash.msg)}</div>` : ''}
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Add New Category</h3>
        <form method="POST" action="/blog/admin/categories/add" class="blog-form" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:end">
          <div><label>Name *</label><input type="text" name="name" required placeholder="Category name"></div>
          <div><label>Color</label><input type="color" name="color" value="#3b82f6" style="height:42px;padding:4px;cursor:pointer"></div>
          <div><label>Description</label><input type="text" name="description" placeholder="Optional description"></div>
          <button type="submit" class="btn btn-green" style="height:42px">+ Add</button>
        </form>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Category</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Slug</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Description</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Posts</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Actions</th>
        </tr></thead>
        <tbody>${catRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No categories yet</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Blog Categories', html, user, req));
  }));

  // -- ROUTE 13: POST /blog/admin/categories/add — Add category -----------
  app.post('/blog/admin/categories/add', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, color, description } = req.body;
    if (!name || !name.trim()) { req.session.flash = { type: 'error', msg: 'Category name is required.' }; return res.redirect('/blog/admin/categories'); }
    const slug = slugify(name);
    try {
      await pool.query(`INSERT INTO blog_categories (tenant_id, name, slug, description, color) VALUES ($1,$2,$3,$4,$5)`,
        [tid, name.trim(), slug, (description || '').trim() || null, color || '#3b82f6']);
      req.session.flash = { type: 'success', msg: `Category "${name.trim()}" created.` };
    } catch (e) { req.session.flash = { type: 'error', msg: 'Category may already exist.' }; }
    res.redirect('/blog/admin/categories');
  }));

  // Category delete handler
  app.post('/blog/admin/categories/delete', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { id } = req.body;
    await pool.query(`DELETE FROM blog_categories WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    req.session.flash = { type: 'success', msg: 'Category deleted.' };
    res.redirect('/blog/admin/categories');
  }));

  // -- ROUTE 14: GET /blog/admin/comments — Comment moderation ------------
  app.get('/blog/admin/comments', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const filter = req.query.filter || 'pending';
    let where = ['c.tenant_id=$1'], params = [tid];
    if (filter === 'pending') where.push("c.status='pending'");
    else if (filter === 'approved') where.push("c.status='approved'");
    else if (filter === 'rejected') where.push("c.status='rejected'");
    const pendingCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM blog_comments WHERE tenant_id=$1 AND status='pending'`, [tid])).rows[0].cnt;
    const approvedCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM blog_comments WHERE tenant_id=$1 AND status='approved'`, [tid])).rows[0].cnt;
    const rejectedCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM blog_comments WHERE tenant_id=$1 AND status='rejected'`, [tid])).rows[0].cnt;
    const comments = (await pool.query(
      `SELECT c.*, p.title as post_title, p.slug as post_slug FROM blog_comments c JOIN blog_posts p ON p.id = c.post_id
       WHERE ${where.join(' AND ')} ORDER BY c.created_at DESC LIMIT 100`, params
    )).rows;
    const commentRows = comments.map(cm => `<tr>
      <td><div style="font-size:13px;font-weight:700;color:#1e293b">${esc(cm.author_name)}</div><div style="font-size:11px;color:#94a3b8">${esc(cm.author_email || '')}</div></td>
      <td><a href="/blog/${esc(cm.post_slug)}" target="_blank" style="color:#059669;text-decoration:none;font-weight:600">${esc(cm.post_title || 'Untitled')}</a></td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:13px;color:#475569" title="${esc(cm.content)}">${esc(cm.content)}</td>
      <td>${commentStatusBadge(cm.status)}</td>
      <td style="font-size:12px;color:#94a3b8">${fmtDate(cm.created_at)}</td>
      <td style="white-space:nowrap">
        ${cm.status !== 'approved' ? `<form method="POST" action="/blog/admin/comments/${cm.id}/approve" style="display:inline"><button class="btn btn-green btn-sm">Approve</button></form>` : ''}
        ${cm.status !== 'rejected' ? `<form method="POST" action="/blog/admin/comments/${cm.id}/reject" style="display:inline"><button class="btn btn-red btn-sm">Reject</button></form>` : ''}
        <form method="POST" action="/blog/admin/comments/${cm.id}/delete" onsubmit="return confirm('Delete this comment?')" style="display:inline">
          <button class="btn btn-sm" style="background:#f1f5f9;color:#64748b">Delete</button></form>
      </td></tr>`).join('');
    const flash = req.session?.flash; req.session.flash = null;
    const html = BLOG_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${adminNav('comments')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">💬 Comment Moderation</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Review and manage blog comments</p></div>
      </div>
      ${flash ? `<div class="alert" style="background:${flash.type === 'error' ? '#fee2e2' : '#dcfce7'};color:${flash.type === 'error' ? '#dc2626' : '#16a34a'};padding:12px 18px;border-radius:10px;margin-bottom:16px;font-size:13px">${esc(flash.msg)}</div>` : ''}
      <div style="display:flex;gap:6px;margin-bottom:14px;flex-wrap:wrap">
        <a href="/blog/admin/comments?filter=pending" class="btn btn-sm ${filter === 'pending' ? 'btn-gold' : ''}" style="${filter !== 'pending' ? 'background:#f1f5f9;color:#475569' : ''}">⏳ Pending (${pendingCount})</a>
        <a href="/blog/admin/comments?filter=approved" class="btn btn-sm ${filter === 'approved' ? 'btn-green' : ''}" style="${filter !== 'approved' ? 'background:#f1f5f9;color:#475569' : ''}">✅ Approved (${approvedCount})</a>
        <a href="/blog/admin/comments?filter=rejected" class="btn btn-sm ${filter === 'rejected' ? 'btn-red' : ''}" style="${filter !== 'rejected' ? 'background:#f1f5f9;color:#475569' : ''}">❌ Rejected (${rejectedCount})</a>
        <a href="/blog/admin/comments?filter=all" class="btn btn-sm ${filter === 'all' ? 'btn-blue' : ''}" style="${filter !== 'all' ? 'background:#f1f5f9;color:#475569' : ''}">All</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Author</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Post</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Comment</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Status</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Date</th>
          <th style="padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase">Actions</th>
        </tr></thead>
        <tbody>${commentRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No comments found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Comment Moderation', html, user, req));
  }));

  // Comment moderation actions
  app.post('/blog/admin/comments/:id/approve', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    await pool.query(`UPDATE blog_comments SET status='approved' WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    req.session.flash = { type: 'success', msg: 'Comment approved.' };
    res.redirect('/blog/admin/comments');
  }));
  app.post('/blog/admin/comments/:id/reject', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    await pool.query(`UPDATE blog_comments SET status='rejected' WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    req.session.flash = { type: 'success', msg: 'Comment rejected.' };
    res.redirect('/blog/admin/comments');
  }));
  app.post('/blog/admin/comments/:id/delete', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    await pool.query(`DELETE FROM blog_comments WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    req.session.flash = { type: 'success', msg: 'Comment deleted.' };
    res.redirect('/blog/admin/comments');
  }));

  // Scheduled post publisher middleware (auto-publishes due posts)
  app.use('/blog', ah(async (req, res, next) => {
    try {
      await pool.query(`UPDATE blog_posts SET status='published', published_at=NOW(), updated_at=NOW()
        WHERE status='draft' AND scheduled_at IS NOT NULL AND scheduled_at <= NOW()`);
    } catch (e) {}
    next();
  }));

  console.log('[Blog] Blog CMS loaded');
};
