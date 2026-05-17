// ============================================================
// SCHOOL NEWSPAPER / PUBLISHING MODULE — Multi-Tenant SaaS Platform
// Edition management, article writing/editing, section management,
// editorial workflow (draft→review→published), photo journalism,
// issue archive, reader comments, article likes/views tracking,
// cartoon/comic section, crossword/puzzles, print-ready layout preview.
// ============================================================
'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; School Newspaper</div>';

  // ─── Internal helpers ──────────────────────────────────────────────────
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const readTime = (text) => { if (!text) return '1 min'; return Math.max(1, Math.ceil(text.replace(/<[^>]*>/g, '').split(/\s+/).length / 200)) + ' min read'; };

  function statusBadge(status) {
    const map = {
      draft: { bg: '#fef9c3', c: '#a16207', l: 'Draft' },
      review: { bg: '#dbeafe', c: '#2563eb', l: 'In Review' },
      revision: { bg: '#fce7f3', c: '#be185d', l: 'Needs Revision' },
      published: { bg: '#dcfce7', c: '#16a34a', l: 'Published' },
      archived: { bg: '#f1f5f9', c: '#64748b', l: 'Archived' },
      rejected: { bg: '#fee2e2', c: '#dc2626', l: 'Rejected' }
    };
    const s = map[status] || map.draft;
    return `<span style="display:inline-block;padding:3px 12px;border-radius:9999px;font-size:12px;font-weight:600;color:${s.c};background:${s.bg};">${s.l}</span>`;
  }

  function sectionIcon(section) {
    const icons = { news: '📰', sports: '⚽', arts: '🎨', opinions: '💬', cartoons: '幽默', puzzles: '🧩', comics: '📖', photos: '📸', features: '⭐', editorial: '✏️' };
    return icons[section] || '📄';
  }

  function nav(active) {
    const links = [
      { href: '/school/newspaper', label: '📊 Dashboard', id: 'dashboard' },
      { href: '/school/newspaper/editions', label: '📚 Editions', id: 'editions' },
      { href: '/school/newspaper/articles/new', label: '✏️ New Article', id: 'new-article' },
      { href: '/school/newspaper/editorial-queue', label: '📋 Editorial Queue', id: 'queue' },
      { href: '/school/newspaper/sections', label: '📂 Sections', id: 'sections' },
      { href: '/school/newspaper/archive', label: '🗄️ Archive', id: 'archive' },
      { href: '/school/newspaper/my-articles', label: '📝 My Articles', id: 'my' },
      { href: '/school/newspaper/popular', label: '🔥 Popular', id: 'popular' },
      { href: '/school/newspaper/cartoons', label: '🎭 Cartoons', id: 'cartoons' },
      { href: '/school/newspaper/puzzles', label: '🧩 Puzzles', id: 'puzzles' }
    ];
    return `<div style="display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap">` +
      links.map(l => `<a href="${l.href}" style="padding:7px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600;color:${active === l.id ? '#fff' : P};background:${active === l.id ? P : '#eef2ff'};transition:.15s">${l.label}</a>`).join('') +
      `</div>`;
  }

  // ─── Database migrations (async IIFE) ──────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS newspaper_editions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        volume INTEGER NOT NULL DEFAULT 1,
        issue INTEGER NOT NULL DEFAULT 1,
        title VARCHAR(255) NOT NULL DEFAULT '',
        subtitle TEXT,
        published_at TIMESTAMPTZ,
        status VARCHAR(20) DEFAULT 'draft',
        editor_id INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS newspaper_articles (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        edition_id INTEGER REFERENCES newspaper_editions(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL DEFAULT '',
        content TEXT,
        section VARCHAR(100) DEFAULT 'news',
        author_id INTEGER,
        author_name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'draft',
        views INTEGER DEFAULT 0,
        likes INTEGER DEFAULT 0,
        cover_image TEXT,
        tags TEXT[],
        is_featured BOOLEAN DEFAULT false,
        editor_notes TEXT,
        submitted_at TIMESTAMPTZ DEFAULT NOW(),
        published_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS newspaper_sections (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(100) NOT NULL DEFAULT '',
        slug VARCHAR(100),
        description TEXT,
        sort_order INTEGER DEFAULT 0,
        editor_id INTEGER,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS newspaper_comments (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        article_id INTEGER NOT NULL REFERENCES newspaper_articles(id) ON DELETE CASCADE,
        author_id INTEGER,
        author_name VARCHAR(255),
        content TEXT NOT NULL DEFAULT '',
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS newspaper_likes (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        article_id INTEGER NOT NULL REFERENCES newspaper_articles(id) ON DELETE CASCADE,
        user_id INTEGER NOT NULL,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, article_id, user_id)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS newspaper_cartoons (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        edition_id INTEGER REFERENCES newspaper_editions(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL DEFAULT '',
        image_url TEXT,
        caption TEXT,
        author_id INTEGER,
        author_name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS newspaper_puzzles (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        edition_id INTEGER REFERENCES newspaper_editions(id) ON DELETE SET NULL,
        title VARCHAR(255) NOT NULL DEFAULT '',
        puzzle_type VARCHAR(50) DEFAULT 'crossword',
        content JSONB DEFAULT '{}'::jsonb,
        answer_key TEXT,
        author_id INTEGER,
        author_name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // Indexes
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ne_tenant ON newspaper_editions(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ne_status ON newspaper_editions(tenant_id, status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_na_tenant ON newspaper_articles(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_na_edition ON newspaper_articles(edition_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_na_status ON newspaper_articles(tenant_id, status)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_na_section ON newspaper_articles(tenant_id, section)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_na_author ON newspaper_articles(author_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_na_published ON newspaper_articles(tenant_id, published_at DESC)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ns_tenant ON newspaper_sections(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_nc_article ON newspaper_comments(article_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_nl_article ON newspaper_likes(article_id)`);
      console.log('[SchoolNewspaper] Tables ready');
    } catch (e) { console.warn('[SchoolNewspaper] Migration warning:', e.message); }
  })();

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 1: GET /school/newspaper — Dashboard
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const stats = await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM newspaper_editions WHERE tenant_id=$1) AS total_editions,
        (SELECT COUNT(*)::int FROM newspaper_editions WHERE tenant_id=$1 AND status='published') AS published_editions,
        (SELECT COUNT(*)::int FROM newspaper_articles WHERE tenant_id=$1) AS total_articles,
        (SELECT COUNT(*)::int FROM newspaper_articles WHERE tenant_id=$1 AND status='draft') AS draft_articles,
        (SELECT COUNT(*)::int FROM newspaper_articles WHERE tenant_id=$1 AND status='review') AS review_articles,
        (SELECT COUNT(*)::int FROM newspaper_articles WHERE tenant_id=$1 AND status='published') AS published_articles,
        (SELECT COALESCE(SUM(views),0)::int FROM newspaper_articles WHERE tenant_id=$1) AS total_views,
        (SELECT COALESCE(SUM(likes),0)::int FROM newspaper_articles WHERE tenant_id=$1) AS total_likes,
        (SELECT COUNT(*)::int FROM newspaper_comments WHERE tenant_id=$1 AND status='pending') AS pending_comments,
        (SELECT COUNT(*)::int FROM newspaper_sections WHERE tenant_id=$1 AND is_active=true) AS active_sections
    `, [tid]);
    const s = stats.rows[0];

    const recentArticles = (await pool.query(`
      SELECT a.*, u.name AS author_display FROM newspaper_articles a
      LEFT JOIN users u ON u.id = a.author_id
      WHERE a.tenant_id=$1 ORDER BY a.updated_at DESC LIMIT 10
    `, [tid])).rows;

    const recentRows = recentArticles.map(a => `<tr>
      <td><a href="/school/newspaper/articles/${a.id}" style="color:${P};text-decoration:none;font-weight:600">${esc((a.title || '').substring(0, 50))}${a.title && a.title.length > 50 ? '...' : ''}</a></td>
      <td>${sectionIcon(a.section)} ${esc(a.section || 'news')}</td>
      <td>${statusBadge(a.status)}</td>
      <td style="font-size:12px;color:${GRAY}">${esc(a.author_name || a.author_display || '—')}</td>
      <td style="font-size:12px">${a.views} 👁 &nbsp; ${a.likes} ❤️</td>
      <td style="font-size:12px;color:${GRAY}">${fmtDate(a.updated_at)}</td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dashboard')}
      <h1 style="font-size:26px;color:#111827;margin:0 0 4px">📰 School Newspaper</h1>
      <p style="color:${GRAY};font-size:14px;margin:0 0 20px">Manage editions, articles, and editorial workflow</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:12px;margin-bottom:24px">
        <div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:${P}">${s.total_editions}</div><div style="font-size:12px;color:${GRAY}">Editions</div></div>
        <div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:#16a34a">${s.published_editions}</div><div style="font-size:12px;color:${GRAY}">Published</div></div>
        <div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:${P}">${s.total_articles}</div><div style="font-size:12px;color:${GRAY}">Articles</div></div>
        <div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:#d97706">${s.review_articles}</div><div style="font-size:12px;color:${GRAY}">In Review</div></div>
        <div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:#8b5cf6">${s.total_views}</div><div style="font-size:12px;color:${GRAY}">Total Views</div></div>
        <div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:#ec4899">${s.total_likes}</div><div style="font-size:12px;color:${GRAY}">Total Likes</div></div>
        <div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:#ea580c">${s.pending_comments}</div><div style="font-size:12px;color:${GRAY}">Pending Comments</div></div>
        <div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:#059669">${s.active_sections}</div><div style="font-size:12px;color:${GRAY}">Sections</div></div>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="font-size:18px;color:#111827;margin:0">Recent Articles</h2>
        <a href="/school/newspaper/articles/new" class="btn" style="text-decoration:none">+ New Article</a>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table><thead><tr>
          <th>Title</th><th>Section</th><th>Status</th><th>Author</th><th>Stats</th><th>Updated</th>
        </tr></thead><tbody>
          ${recentRows || `<tr><td colspan="6" style="text-align:center;color:${GRAY};padding:30px">No articles yet. Start writing!</td></tr>`}
        </tbody></table></div>
      </div>
    </div>`;
    res.send(renderPage('School Newspaper', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 2: GET /school/newspaper/editions — List editions
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/editions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const editions = (await pool.query(`
      SELECT e.*, u.name AS editor_name,
        (SELECT COUNT(*)::int FROM newspaper_articles WHERE edition_id = e.id) AS article_count
      FROM newspaper_editions e
      LEFT JOIN users u ON u.id = e.editor_id
      WHERE e.tenant_id=$1 ORDER BY e.volume DESC, e.issue DESC
    `, [tid])).rows;

    const cards = editions.map(e => `<div class="card" style="border-left:4px solid ${e.status === 'published' ? '#16a34a' : e.status === 'draft' ? '#d97706' : GRAY}">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <div>
          <span style="font-size:12px;color:${GRAY};font-weight:600">Vol. ${e.volume}, Issue ${e.issue}</span>
          <h3 style="margin:4px 0 0;font-size:17px;color:#111827">${esc(e.title)}</h3>
        </div>
        ${statusBadge(e.status)}
      </div>
      ${e.subtitle ? `<p style="font-size:13px;color:${GRAY};margin:0 0 8px">${esc(e.subtitle)}</p>` : ''}
      <div style="display:flex;gap:16px;font-size:12px;color:${GRAY};margin-bottom:12px">
        <span>📝 ${e.article_count} articles</span>
        <span>📅 ${fmtDate(e.published_at)}</span>
        <span>✏️ ${esc(e.editor_name || '—')}</span>
      </div>
      <div style="display:flex;gap:6px">
        <a href="/school/newspaper/editions/${e.id}" class="btn" style="text-decoration:none;padding:6px 14px;font-size:12px">View</a>
        ${e.status === 'draft' ? `<form method="POST" action="/school/newspaper/editions/${e.id}/delete" style="display:inline" onsubmit="return confirm('Delete this edition?')"><button class="btn" style="background:#dc2626;padding:6px 14px;font-size:12px">Delete</button></form>` : ''}
      </div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1000px;margin:0 auto">
      ${nav('editions')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <div><h1 style="font-size:24px;color:#111827;margin:0">📚 Editions</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Manage newspaper issues</p></div>
        <a href="/school/newspaper/editions/new" class="btn" style="text-decoration:none">+ New Edition</a>
      </div>
      ${editions.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px">${cards}</div>` :
        `<div class="card" style="text-align:center;padding:48px"><p style="font-size:48px;margin-bottom:12px">📚</p><p style="color:${GRAY};font-size:16px">No editions yet. Create your first newspaper issue!</p></div>`}
    </div>`;
    res.send(renderPage('Newspaper Editions', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 3: GET /school/newspaper/editions/new — Create edition form
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/editions/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const lastEdition = (await pool.query(`SELECT volume, issue FROM newspaper_editions WHERE tenant_id=$1 ORDER BY volume DESC, issue DESC LIMIT 1`, [tid])).rows[0];
    const nextVol = lastEdition ? lastEdition.volume : 1;
    const nextIssue = lastEdition ? lastEdition.issue + 1 : 1;

    const html = SKIP + `<div style="max-width:700px;margin:0 auto">
      ${nav('editions')}
      <a href="/school/newspaper/editions" style="color:${P};text-decoration:none;font-size:14px;display:inline-block;margin-bottom:16px">← Back to Editions</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 20px;color:#111827">📚 Create New Edition</h2>
        <form method="POST" action="/school/newspaper/editions" style="display:flex;flex-direction:column;gap:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Volume *</label><input type="number" name="volume" value="${nextVol}" min="1" required></div>
            <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Issue *</label><input type="number" name="issue" value="${nextIssue}" min="1" required></div>
          </div>
          <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Title *</label><input type="text" name="title" required placeholder="e.g. The Spring Chronicle"></div>
          <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Subtitle</label><input type="text" name="subtitle" placeholder="Optional edition subtitle"></div>
          <div style="display:flex;gap:10px">
            <button type="submit" class="btn" style="padding:10px 28px">Create Edition</button>
            <a href="/school/newspaper/editions" class="btn" style="background:#f3f4f6;color:#374151;text-decoration:none;padding:10px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Edition', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 4: POST /school/newspaper/editions — Save edition
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/editions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { volume, issue, title, subtitle } = req.body;
    if (!title || !title.trim()) return res.redirect('/school/newspaper/editions/new');
    await pool.query(
      `INSERT INTO newspaper_editions (tenant_id, volume, issue, title, subtitle, editor_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, parseInt(volume) || 1, parseInt(issue) || 1, title.trim(), (subtitle || '').trim() || null, uid]
    );
    audit('newspaper_edition_created', { volume, issue, title: title.trim() }, req);
    res.redirect('/school/newspaper/editions');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 5: GET /school/newspaper/editions/:id — View edition with articles
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/editions/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const edition = (await pool.query(`SELECT e.*, u.name AS editor_name FROM newspaper_editions e LEFT JOIN users u ON u.id = e.editor_id WHERE e.id=$1 AND e.tenant_id=$2`, [id, tid])).rows[0];
    if (!edition) return res.redirect('/school/newspaper/editions');

    const articles = (await pool.query(`
      SELECT a.*, u.name AS author_display FROM newspaper_articles a
      LEFT JOIN users u ON u.id = a.author_id
      WHERE a.edition_id=$1 AND a.tenant_id=$2 ORDER BY
        CASE a.section WHEN 'editorial' THEN 1 WHEN 'news' THEN 2 WHEN 'features' THEN 3 WHEN 'sports' THEN 4 WHEN 'arts' THEN 5 WHEN 'opinions' THEN 6 WHEN 'cartoons' THEN 7 WHEN 'photos' THEN 8 ELSE 9 END,
        a.created_at DESC
    `, [id, tid])).rows;

    const articleCards = articles.map(a => {
      const coverHtml = a.cover_image ? `<img src="${esc(a.cover_image)}" alt="" style="width:100%;height:140px;object-fit:cover;border-radius:8px">` : `<div style="height:140px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:36px">${sectionIcon(a.section)}</div>`;
      return `<div class="card" style="padding:0;overflow:hidden">
        ${coverHtml}
        <div style="padding:14px">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:6px">
            <span style="font-size:11px;font-weight:600;color:${P};background:#eef2ff;padding:2px 8px;border-radius:4px">${sectionIcon(a.section)} ${esc(a.section)}</span>
            ${statusBadge(a.status)}
            ${a.is_featured ? '<span style="font-size:11px;background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-weight:600">⭐ Featured</span>' : ''}
          </div>
          <h3 style="margin:0 0 6px;font-size:15px;color:#111827"><a href="/school/newspaper/articles/${a.id}" style="color:#111827;text-decoration:none">${esc(a.title)}</a></h3>
          <p style="font-size:12px;color:${GRAY};margin:0 0 6px">${esc((a.content || '').substring(0, 100))}...</p>
          <div style="display:flex;gap:12px;font-size:11px;color:${GRAY}">
            <span>✍️ ${esc(a.author_name || a.author_display || '—')}</span>
            <span>👁 ${a.views}</span><span>❤️ ${a.likes}</span>
          </div>
        </div>
      </div>`;
    }).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">
      ${nav('editions')}
      <a href="/school/newspaper/editions" style="color:${P};text-decoration:none;font-size:14px;display:inline-block;margin-bottom:16px">← Back to Editions</a>
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <span style="font-size:13px;color:${GRAY};font-weight:600">Volume ${edition.volume}, Issue ${edition.issue}</span>
          <h1 style="font-size:26px;color:#111827;margin:4px 0">${esc(edition.title)}</h1>
          ${edition.subtitle ? `<p style="color:${GRAY};font-size:14px;margin:0">${esc(edition.subtitle)}</p>` : ''}
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${statusBadge(edition.status)}
          ${edition.status === 'draft' ? `<form method="POST" action="/school/newspaper/editions/${edition.id}/publish" style="display:inline"><button class="btn" style="background:#16a34a">Publish Edition</button></form>` : ''}
        </div>
      </div>
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <a href="/school/newspaper/articles/new?edition_id=${edition.id}" class="btn" style="text-decoration:none">+ Add Article</a>
        <a href="/school/newspaper/editions/${edition.id}/print-preview" class="btn" style="background:#374151;text-decoration:none" target="_blank">🖨️ Print Preview</a>
      </div>
      ${articles.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">${articleCards}</div>` :
        `<div class="card" style="text-align:center;padding:48px"><p style="color:${GRAY}">No articles in this edition yet. Add some articles!</p></div>`}
    </div>`;
    res.send(renderPage('Edition: ' + edition.title, html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 6: POST /school/newspaper/editions/:id/publish — Publish edition
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/editions/:id/publish', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    await pool.query(`UPDATE newspaper_editions SET status='published', published_at=NOW(), updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    await pool.query(`UPDATE newspaper_articles SET status='published', published_at=NOW() WHERE edition_id=$1 AND tenant_id=$2 AND status IN ('draft','review')`, [id, tid]);
    audit('newspaper_edition_published', { edition_id: id }, req);
    res.redirect(`/school/newspaper/editions/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 7: POST /school/newspaper/editions/:id/delete — Delete edition
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/editions/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    await pool.query(`DELETE FROM newspaper_editions WHERE id=$1 AND tenant_id=$2 AND status='draft'`, [id, tid]);
    audit('newspaper_edition_deleted', { edition_id: id }, req);
    res.redirect('/school/newspaper/editions');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 8: GET /school/newspaper/articles/new — Create article form
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/articles/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const editions = (await pool.query(`SELECT id, title, volume, issue FROM newspaper_editions WHERE tenant_id=$1 ORDER BY volume DESC, issue DESC`, [tid])).rows;
    const sections = (await pool.query(`SELECT * FROM newspaper_sections WHERE tenant_id=$1 AND is_active=true ORDER BY sort_order`, [tid])).rows;
    const preselectedEdition = req.query.edition_id || '';

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">
      ${nav('new-article')}
      <a href="/school/newspaper" style="color:${P};text-decoration:none;font-size:14px;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#111827">✏️ Write New Article</h2>
        <p style="color:${GRAY};font-size:13px;margin:0 0 20px">Create content for the school newspaper</p>
        <form method="POST" action="/school/newspaper/articles/new" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Title *</label><input type="text" name="title" required placeholder="Your article headline..."></div>
          <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Content *</label><textarea name="content" rows="14" required placeholder="Write your article content here..." style="font-family:Georgia,serif;font-size:15px;line-height:1.8"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Edition</label><select name="edition_id"><option value="">— No Edition —</option>${editions.map(e => `<option value="${e.id}" ${String(e.id) === preselectedEdition ? 'selected' : ''}>Vol. ${e.volume}, Iss. ${e.issue} — ${esc(e.title)}</option>`).join('')}</select></div>
            <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Section</label><select name="section">${sections.length ? sections.map(s => `<option value="${esc(s.name)}">${sectionIcon(s.name)} ${esc(s.name)}</option>`).join('') : '<option value="news">📰 News</option><option value="sports">⚽ Sports</option><option value="arts">🎨 Arts</option><option value="opinions">💬 Opinions</option><option value="features">⭐ Features</option><option value="editorial">✏️ Editorial</option><option value="photos">📸 Photos</option>'}</select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Cover Image URL</label><input type="url" name="cover_image" placeholder="https://example.com/image.jpg"></div>
            <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Tags (comma-separated)</label><input type="text" name="tags" placeholder="e.g. sports, basketball, championship"></div>
          </div>
          <div><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#374151"><input type="checkbox" name="is_featured" value="true" style="accent-color:${P}"> ⭐ Mark as featured article</label></div>
          <div style="display:flex;gap:10px">
            <button type="submit" name="action" value="submit" class="btn" style="padding:10px 28px">Submit for Review</button>
            <button type="submit" name="action" value="draft" class="btn" style="background:#f3f4f6;color:#374151;padding:10px 28px">Save as Draft</button>
            <a href="/school/newspaper" class="btn" style="background:#fee2e2;color:#dc2626;text-decoration:none;padding:10px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Article', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 9: POST /school/newspaper/articles/new — Save article
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/articles/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { title, content, edition_id, section, cover_image, tags, is_featured, action } = req.body;
    if (!title || !title.trim() || !content || !content.trim()) return res.redirect('/school/newspaper/articles/new');
    const status = action === 'submit' ? 'review' : 'draft';
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    const result = await pool.query(
      `INSERT INTO newspaper_articles (tenant_id, edition_id, title, content, section, author_id, author_name, status, cover_image, tags, is_featured) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [tid, edition_id ? parseInt(edition_id) : null, title.trim(), content.trim(), (section || 'news').trim(), uid, req.session.user.name || req.session.user.email, status, (cover_image || '').trim() || null, tagArr.length ? tagArr : null, is_featured === 'true']
    );
    audit('newspaper_article_created', { article_id: result.rows[0].id, title: title.trim(), status }, req);
    if (status === 'review' && queueEmail) {
      const editors = (await pool.query(`SELECT u.email, u.name FROM users u JOIN newspaper_sections s ON s.editor_id = u.id WHERE s.tenant_id=$1 AND s.name=$2`, [tid, section || 'news'])).rows;
      for (const editor of editors) {
        queueEmail({ to: editor.email, subject: 'New article submitted for review: ' + title.trim(), body: `A new article "${title.trim()}" has been submitted to the ${(section || 'news')} section for your review.` });
      }
    }
    res.redirect('/school/newspaper/my-articles');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 10: GET /school/newspaper/submit-article — Public submission
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/submit-article', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const sections = (await pool.query(`SELECT * FROM newspaper_sections WHERE tenant_id=$1 AND is_active=true ORDER BY sort_order`, [tid])).rows;
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">
      ${nav('')}
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#111827">📝 Submit an Article</h2>
        <p style="color:${GRAY};font-size:13px;margin:0 0 20px">Share your voice! Submitted articles will be reviewed by the editorial team.</p>
        <form method="POST" action="/school/newspaper/submit-article" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Your Name *</label><input type="text" name="author_name" value="${esc(req.session.user.name || '')}" required></div>
          <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Article Title *</label><input type="text" name="title" required placeholder="Your article headline..."></div>
          <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Section *</label><select name="section">${sections.length ? sections.map(s => `<option value="${esc(s.name)}">${sectionIcon(s.name)} ${esc(s.name)}</option>`).join('') : '<option value="news">📰 News</option><option value="sports">⚽ Sports</option><option value="arts">🎨 Arts</option><option value="opinions">💬 Opinions</option><option value="features">⭐ Features</option>'}</select></div>
          <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Article Content *</label><textarea name="content" rows="12" required placeholder="Write your article..." style="font-family:Georgia,serif;font-size:15px;line-height:1.8"></textarea></div>
          <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Cover Image URL (optional)</label><input type="url" name="cover_image" placeholder="https://example.com/photo.jpg"></div>
          <button type="submit" class="btn" style="padding:10px 28px;align-self:flex-start">📤 Submit for Review</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Submit Article', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 11: POST /school/newspaper/submit-article — Handle submission
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/submit-article', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { author_name, title, content, section, cover_image } = req.body;
    if (!title || !title.trim() || !content || !content.trim()) return res.redirect('/school/newspaper/submit-article');
    await pool.query(
      `INSERT INTO newspaper_articles (tenant_id, title, content, section, author_id, author_name, status, cover_image) VALUES ($1,$2,$3,$4,$5,$6,'review',$7)`,
      [tid, title.trim(), content.trim(), (section || 'news').trim(), uid, (author_name || '').trim() || req.session.user.name, (cover_image || '').trim() || null]
    );
    audit('newspaper_article_submitted', { title: title.trim() }, req);
    res.redirect('/school/newspaper/my-articles');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 12: GET /school/newspaper/articles/:id — View article
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/articles/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const article = (await pool.query(`
      SELECT a.*, u.name AS author_display, e.title AS edition_title
      FROM newspaper_articles a
      LEFT JOIN users u ON u.id = a.author_id
      LEFT JOIN newspaper_editions e ON e.id = a.edition_id
      WHERE a.id=$1 AND a.tenant_id=$2
    `, [id, tid])).rows[0];
    if (!article) return res.redirect('/school/newspaper');

    // Track view
    await pool.query(`UPDATE newspaper_articles SET views = views + 1 WHERE id=$1`, [id]);

    // Check if user liked
    const liked = (await pool.query(`SELECT id FROM newspaper_likes WHERE article_id=$1 AND user_id=$2 AND tenant_id=$3`, [id, uid, tid])).rows.length > 0;
    const comments = (await pool.query(`SELECT c.*, u.name AS commenter_name FROM newspaper_comments c LEFT JOIN users u ON u.id = c.author_id WHERE c.article_id=$1 AND c.status='approved' ORDER BY c.created_at DESC`, [id])).rows;

    const commentsHtml = comments.map(c => `<div style="padding:12px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;background:#fafafa">
      <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="font-size:13px;font-weight:600;color:#111827">${esc(c.author_name || c.commenter_name || 'Anonymous')}</span><span style="font-size:11px;color:${GRAY}">${fmtDateTime(c.created_at)}</span></div>
      <p style="font-size:13px;color:#4b5563;margin:0;line-height:1.6;white-space:pre-wrap">${esc(c.content)}</p>
    </div>`).join('');

    const tagsHtml = (article.tags || []).map(t => `<span style="display:inline-block;padding:2px 10px;background:#eef2ff;color:${P};border-radius:20px;font-size:11px;font-weight:600">${esc(t)}</span>`).join(' ');

    const html = SKIP + `<div style="max-width:800px;margin:0 auto">
      ${nav('')}
      <a href="/school/newspaper" style="color:${P};text-decoration:none;font-size:14px;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <article>
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px;flex-wrap:wrap">
          <span style="font-size:12px;font-weight:600;color:${P};background:#eef2ff;padding:3px 10px;border-radius:6px">${sectionIcon(article.section)} ${esc(article.section)}</span>
          ${statusBadge(article.status)}
          ${article.is_featured ? '<span style="font-size:12px;background:#fef3c7;color:#92400e;padding:3px 10px;border-radius:6px;font-weight:600">⭐ Featured</span>' : ''}
          ${article.edition_title ? `<span style="font-size:12px;color:${GRAY}">📚 ${esc(article.edition_title)}</span>` : ''}
        </div>
        <h1 style="font-size:30px;color:#111827;line-height:1.3;margin:0 0 12px">${esc(article.title)}</h1>
        <div style="display:flex;gap:16px;align-items:center;font-size:13px;color:${GRAY};margin-bottom:20px;padding-bottom:16px;border-bottom:1px solid #e5e7eb;flex-wrap:wrap">
          <span>✍️ ${esc(article.author_name || article.author_display || '—')}</span>
          <span>📅 ${fmtDate(article.published_at || article.created_at)}</span>
          <span>📖 ${readTime(article.content)}</span>
          <span>👁 ${article.views}</span>
          <span>❤️ ${article.likes}</span>
        </div>
        ${article.cover_image ? `<img src="${esc(article.cover_image)}" alt="${esc(article.title)}" style="width:100%;max-height:400px;object-fit:cover;border-radius:12px;margin-bottom:20px">` : ''}
        <div style="font-family:Georgia,serif;font-size:16px;color:#1f2937;line-height:1.9;white-space:pre-wrap">${esc(article.content)}</div>
        ${tagsHtml ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:20px;padding-top:16px;border-top:1px solid #e5e7eb">${tagsHtml}</div>` : ''}
      </article>
      <div style="margin-top:24px;display:flex;gap:10px;align-items:center">
        <form method="POST" action="/school/newspaper/articles/${id}/like"><button class="btn" style="background:${liked ? '#ec4899' : '#f3f4f6'};color:${liked ? '#fff' : '#374151'};padding:8px 20px">${liked ? '❤️ Liked' : '🤍 Like'}</button></form>
        <a href="/school/newspaper/articles/${id}/edit" class="btn" style="background:#f3f4f6;color:#374151;text-decoration:none;padding:8px 20px">✏️ Edit</a>
      </div>
      ${article.editor_notes ? `<div style="margin-top:20px;padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px"><h3 style="font-size:14px;color:#92400e;margin:0 0 6px">📝 Editor Notes</h3><p style="font-size:13px;color:#78350f;margin:0;white-space:pre-wrap">${esc(article.editor_notes)}</p></div>` : ''}
      <div style="margin-top:36px">
        <h2 style="font-size:20px;color:#111827;margin-bottom:16px">💬 Comments (${comments.length})</h2>
        <div class="card" style="padding:16px;margin-bottom:16px">
          <form method="POST" action="/school/newspaper/articles/${id}/comment" style="display:flex;flex-direction:column;gap:10px">
            <textarea name="content" rows="3" required placeholder="Share your thoughts on this article..." style="font-size:14px"></textarea>
            <button type="submit" class="btn" style="align-self:flex-start;padding:8px 20px">Post Comment</button>
          </form>
        </div>
        ${commentsHtml || '<p style="text-align:center;color:' + GRAY + ';padding:24px">No comments yet. Be the first to share your thoughts!</p>'}
      </div>
    </div>`;
    res.send(renderPage(article.title, html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 13: GET /school/newspaper/articles/:id/edit — Edit article
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/articles/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const article = (await pool.query(`SELECT * FROM newspaper_articles WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!article) return res.redirect('/school/newspaper');
    const editions = (await pool.query(`SELECT id, title, volume, issue FROM newspaper_editions WHERE tenant_id=$1 ORDER BY volume DESC, issue DESC`, [tid])).rows;
    const sections = (await pool.query(`SELECT * FROM newspaper_sections WHERE tenant_id=$1 AND is_active=true ORDER BY sort_order`, [tid])).rows;

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">
      ${nav('')}
      <a href="/school/newspaper/articles/${id}" style="color:${P};text-decoration:none;font-size:14px;display:inline-block;margin-bottom:16px">← Back to Article</a>
      <div class="card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#111827">✏️ Edit Article</h2>
        <p style="color:${GRAY};font-size:13px;margin:0 0 20px">Editing: ${esc(article.title)}</p>
        <form method="POST" action="/school/newspaper/articles/${id}/edit" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Title *</label><input type="text" name="title" required value="${esc(article.title)}"></div>
          <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Content *</label><textarea name="content" rows="14" required style="font-family:Georgia,serif;font-size:15px;line-height:1.8">${esc(article.content || '')}</textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Edition</label><select name="edition_id"><option value="">— No Edition —</option>${editions.map(e => `<option value="${e.id}" ${article.edition_id === e.id ? 'selected' : ''}>Vol. ${e.volume}, Iss. ${e.issue} — ${esc(e.title)}</option>`).join('')}</select></div>
            <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Section</label><select name="section">${sections.length ? sections.map(s => `<option value="${esc(s.name)}" ${article.section === s.name ? 'selected' : ''}>${sectionIcon(s.name)} ${esc(s.name)}</option>`).join('') : '<option value="news"' + (article.section === 'news' ? ' selected' : '') + '>📰 News</option><option value="sports"' + (article.section === 'sports' ? ' selected' : '') + '>⚽ Sports</option><option value="arts"' + (article.section === 'arts' ? ' selected' : '') + '>🎨 Arts</option><option value="opinions"' + (article.section === 'opinions' ? ' selected' : '') + '>💬 Opinions</option><option value="features"' + (article.section === 'features' ? ' selected' : '') + '>⭐ Features</option><option value="editorial"' + (article.section === 'editorial' ? ' selected' : '') + '>✏️ Editorial</option>'}</select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Cover Image URL</label><input type="url" name="cover_image" value="${esc(article.cover_image || '')}"></div>
            <div><label style="display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:4px">Tags (comma-separated)</label><input type="text" name="tags" value="${esc(Array.isArray(article.tags) ? article.tags.join(', ') : '')}"></div>
          </div>
          <div><label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#374151"><input type="checkbox" name="is_featured" value="true" ${article.is_featured ? 'checked' : ''} style="accent-color:${P}"> ⭐ Mark as featured</label></div>
          <div style="display:flex;gap:10px">
            <button type="submit" class="btn" style="padding:10px 28px">💾 Save Changes</button>
            <a href="/school/newspaper/articles/${id}" class="btn" style="background:#f3f4f6;color:#374151;text-decoration:none;padding:10px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Article', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 14: POST /school/newspaper/articles/:id/edit — Update article
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/articles/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { title, content, edition_id, section, cover_image, tags, is_featured } = req.body;
    if (!title || !title.trim() || !content || !content.trim()) return res.redirect(`/school/newspaper/articles/${id}/edit`);
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];
    await pool.query(
      `UPDATE newspaper_articles SET title=$1, content=$2, edition_id=$3, section=$4, cover_image=$5, tags=$6, is_featured=$7, updated_at=NOW() WHERE id=$8 AND tenant_id=$9`,
      [title.trim(), content.trim(), edition_id ? parseInt(edition_id) : null, (section || 'news').trim(), (cover_image || '').trim() || null, tagArr.length ? tagArr : null, is_featured === 'true', id, tid]
    );
    audit('newspaper_article_updated', { article_id: id, title: title.trim() }, req);
    res.redirect(`/school/newspaper/articles/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 15: POST /school/newspaper/articles/:id/like — Like/unlike article
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/articles/:id/like', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const existing = (await pool.query(`SELECT id FROM newspaper_likes WHERE article_id=$1 AND user_id=$2 AND tenant_id=$3`, [id, uid, tid])).rows[0];
    if (existing) {
      await pool.query(`DELETE FROM newspaper_likes WHERE id=$1`, [existing.id]);
      await pool.query(`UPDATE newspaper_articles SET likes = GREATEST(likes - 1, 0) WHERE id=$1`, [id]);
    } else {
      await pool.query(`INSERT INTO newspaper_likes (tenant_id, article_id, user_id) VALUES ($1,$2,$3)`, [tid, id, uid]);
      await pool.query(`UPDATE newspaper_articles SET likes = likes + 1 WHERE id=$1`, [id]);
    }
    res.redirect(`/school/newspaper/articles/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 16: POST /school/newspaper/articles/:id/comment — Add comment
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/articles/:id/comment', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { content } = req.body;
    if (!content || !content.trim()) return res.redirect(`/school/newspaper/articles/${id}`);
    await pool.query(
      `INSERT INTO newspaper_comments (tenant_id, article_id, author_id, author_name, content) VALUES ($1,$2,$3,$4,$5)`,
      [tid, id, uid, req.session.user.name || req.session.user.email, content.trim()]
    );
    res.redirect(`/school/newspaper/articles/${id}#comments`);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 17: GET /school/newspaper/editorial-queue — Editorial review queue
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/editorial-queue', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const articles = (await pool.query(`
      SELECT a.*, u.name AS author_display FROM newspaper_articles a
      LEFT JOIN users u ON u.id = a.author_id
      WHERE a.tenant_id=$1 AND a.status IN ('review','revision')
      ORDER BY a.submitted_at DESC
    `, [tid])).rows;

    const rows = articles.map(a => `<tr>
      <td><a href="/school/newspaper/articles/${a.id}" style="color:${P};text-decoration:none;font-weight:600">${esc((a.title || '').substring(0, 45))}${a.title && a.title.length > 45 ? '...' : ''}</a></td>
      <td>${sectionIcon(a.section)} ${esc(a.section)}</td>
      <td>${statusBadge(a.status)}</td>
      <td style="font-size:12px">${esc(a.author_name || a.author_display || '—')}</td>
      <td style="font-size:12px;color:${GRAY}">${fmtDateTime(a.submitted_at)}</td>
      <td style="white-space:nowrap">
        <form method="POST" action="/school/newspaper/publish/${a.id}" style="display:inline;margin-right:4px"><button class="btn" style="background:#16a34a;padding:5px 12px;font-size:11px">✅ Publish</button></form>
        <form method="POST" action="/school/newspaper/articles/${a.id}/review" style="display:inline"><input type="hidden" name="action" value="revision"><button class="btn" style="background:#d97706;padding:5px 12px;font-size:11px">🔄 Revise</button></form>
        <form method="POST" action="/school/newspaper/articles/${a.id}/review" style="display:inline"><input type="hidden" name="action" value="reject"><button class="btn" style="background:#dc2626;padding:5px 12px;font-size:11px">❌ Reject</button></form>
      </td>
    </tr>`).join('');

    const pendingComments = (await pool.query(`SELECT nc.*, na.title AS article_title FROM newspaper_comments nc JOIN newspaper_articles na ON na.id = nc.article_id WHERE nc.tenant_id=$1 AND nc.status='pending' ORDER BY nc.created_at DESC`, [tid])).rows;
    const commentRows = pendingComments.map(c => `<tr>
      <td><a href="/school/newspaper/articles/${c.article_id}" style="color:${P};text-decoration:none;font-weight:600">${esc((c.article_title || '').substring(0, 40))}</a></td>
      <td style="font-size:12px">${esc(c.author_name || 'Anonymous')}</td>
      <td style="font-size:12px">${esc((c.content || '').substring(0, 60))}...</td>
      <td style="font-size:12px;color:${GRAY}">${fmtDateTime(c.created_at)}</td>
      <td style="white-space:nowrap">
        <form method="POST" action="/school/newspaper/comments/${c.id}/moderate"><input type="hidden" name="action" value="approve"><button class="btn" style="background:#16a34a;padding:5px 12px;font-size:11px">Approve</button></form>
        <form method="POST" action="/school/newspaper/comments/${c.id}/moderate" style="display:inline"><input type="hidden" name="action" value="reject"><button class="btn" style="background:#dc2626;padding:5px 12px;font-size:11px">Reject</button></form>
      </td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${nav('queue')}
      <h1 style="font-size:24px;color:#111827;margin:0 0 4px">📋 Editorial Queue</h1>
      <p style="color:${GRAY};font-size:13px;margin:0 0 20px">${articles.length} articles awaiting review</p>
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:24px">
        <div style="padding:14px 16px;border-bottom:1px solid #e5e7eb;font-weight:700;font-size:14px;color:#111827">📝 Articles Pending Review (${articles.length})</div>
        ${articles.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Title</th><th>Section</th><th>Status</th><th>Author</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>` :
          `<div style="padding:30px;text-align:center;color:${GRAY}">No articles in the review queue!</div>`}
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <div style="padding:14px 16px;border-bottom:1px solid #e5e7eb;font-weight:700;font-size:14px;color:#111827">💬 Comments Awaiting Moderation (${pendingComments.length})</div>
        ${pendingComments.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Article</th><th>Commenter</th><th>Comment</th><th>Date</th><th>Actions</th></tr></thead><tbody>${commentRows}</tbody></table></div>` :
          `<div style="padding:30px;text-align:center;color:${GRAY}">No comments pending moderation!</div>`}
      </div>
    </div>`;
    res.send(renderPage('Editorial Queue', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 18: POST /school/newspaper/publish/:id — Publish article
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/publish/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    await pool.query(`UPDATE newspaper_articles SET status='published', published_at=NOW(), updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    audit('newspaper_article_published', { article_id: id }, req);
    res.redirect('/school/newspaper/editorial-queue');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 19: POST /school/newspaper/articles/:id/review — Review action
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/articles/:id/review', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { action, editor_notes } = req.body;
    if (action === 'revision') {
      await pool.query(`UPDATE newspaper_articles SET status='revision', editor_notes=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [(editor_notes || '').trim() || null, id, tid]);
    } else if (action === 'reject') {
      await pool.query(`UPDATE newspaper_articles SET status='rejected', editor_notes=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [(editor_notes || '').trim() || null, id, tid]);
    }
    audit('newspaper_article_reviewed', { article_id: id, action }, req);
    res.redirect('/school/newspaper/editorial-queue');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 20: POST /school/newspaper/comments/:id/moderate — Comment moderation
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/comments/:id/moderate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { action } = req.body;
    const status = action === 'approve' ? 'approved' : 'rejected';
    await pool.query(`UPDATE newspaper_comments SET status=$1 WHERE id=$2 AND tenant_id=$3`, [status, id, tid]);
    audit('newspaper_comment_moderated', { comment_id: id, status }, req);
    res.redirect('/school/newspaper/editorial-queue');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 21: GET /school/newspaper/archive — Issue archive
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/archive', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const search = (req.query.search || '').trim();
    const yearFilter = req.query.year || '';
    let where = ['a.tenant_id=$1', "a.status='published'"], params = [tid], pi = 2;
    if (search) { where.push(`(a.title ILIKE $${pi} OR a.content ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    if (yearFilter) { where.push(`EXTRACT(YEAR FROM a.published_at)::text = $${pi}`); params.push(yearFilter); pi++; }

    const years = (await pool.query(`SELECT DISTINCT EXTRACT(YEAR FROM published_at)::int AS year FROM newspaper_articles WHERE tenant_id=$1 AND status='published' AND published_at IS NOT NULL ORDER BY year DESC`, [tid])).rows;
    const articles = (await pool.query(`
      SELECT a.*, u.name AS author_display, e.title AS edition_title
      FROM newspaper_articles a
      LEFT JOIN users u ON u.id = a.author_id
      LEFT JOIN newspaper_editions e ON e.id = a.edition_id
      WHERE ${where.join(' AND ')} ORDER BY a.published_at DESC LIMIT 100
    `, params)).rows;

    const articleList = articles.map((a, i) => `<div style="display:flex;gap:16px;padding:16px 0;${i < articles.length - 1 ? 'border-bottom:1px solid #f3f4f6' : ''};align-items:start">
      <div style="flex-shrink:0;width:80px;height:80px;background:#eef2ff;border-radius:10px;display:flex;flex-direction:column;align-items:center;justify-content:center">
        <span style="font-size:11px;color:${GRAY};font-weight:600;text-transform:uppercase">${a.published_at ? new Date(a.published_at).toLocaleString('en', { month: 'short' }) : ''}</span>
        <span style="font-size:22px;font-weight:800;color:${P}">${a.published_at ? new Date(a.published_at).getDate() : ''}</span>
      </div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
          <span style="font-size:11px;font-weight:600;color:${P};background:#eef2ff;padding:2px 8px;border-radius:4px">${sectionIcon(a.section)} ${esc(a.section)}</span>
          ${a.edition_title ? `<span style="font-size:11px;color:${GRAY}">📚 ${esc(a.edition_title)}</span>` : ''}
        </div>
        <h3 style="margin:0 0 4px;font-size:16px;color:#111827"><a href="/school/newspaper/articles/${a.id}" style="color:#111827;text-decoration:none">${esc(a.title)}</a></h3>
        <p style="font-size:13px;color:${GRAY};margin:0 0 4px">${esc((a.content || '').substring(0, 120))}...</p>
        <div style="display:flex;gap:12px;font-size:11px;color:${GRAY}"><span>✍️ ${esc(a.author_name || a.author_display || '—')}</span><span>👁 ${a.views}</span><span>❤️ ${a.likes}</span></div>
      </div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">
      ${nav('archive')}
      <h1 style="font-size:24px;color:#111827;margin:0 0 4px">🗄️ Newspaper Archive</h1>
      <p style="color:${GRAY};font-size:13px;margin:0 0 20px">Browse all published articles</p>
      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:end">
        <div><label style="display:block;font-size:12px;font-weight:600;color:${GRAY};margin-bottom:4px">Search</label>
          <form method="GET" action="/school/newspaper/archive" style="display:flex;gap:6px">
            <input type="text" name="search" value="${esc(search)}" placeholder="Search articles..." style="width:220px">
            <input type="hidden" name="year" value="${esc(yearFilter)}">
            <button type="submit" class="btn" style="padding:8px 16px">Search</button>
          </form>
        </div>
        <div><label style="display:block;font-size:12px;font-weight:600;color:${GRAY};margin-bottom:4px">Year</label>
          <select onchange="location.href='/school/newspaper/archive?year='+this.value+(document.querySelector('[name=search]')?'&search='+document.querySelector('[name=search]').value:'')">
            <option value="">All Years</option>
            ${years.map(y => `<option value="${y.year}" ${yearFilter === String(y.year) ? 'selected' : ''}>${y.year}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="card">
        ${articles.length ? articleList : `<div style="text-align:center;padding:48px;color:${GRAY}"><p style="font-size:48px;margin-bottom:12px">📭</p><p>No published articles found.</p></div>`}
      </div>
    </div>`;
    res.send(renderPage('Newspaper Archive', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 22: GET /school/newspaper/sections — Section management
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/sections', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const sections = (await pool.query(`
      SELECT s.*, u.name AS editor_name,
        (SELECT COUNT(*)::int FROM newspaper_articles WHERE section = s.name AND tenant_id = s.tenant_id) AS article_count
      FROM newspaper_sections s
      LEFT JOIN users u ON u.id = s.editor_id
      WHERE s.tenant_id=$1 ORDER BY s.sort_order
    `, [tid])).rows;

    const rows = sections.map(s => `<tr>
      <td><span style="font-size:18px">${sectionIcon(s.name)}</span></td>
      <td style="font-weight:600;color:#111827">${esc(s.name)}</td>
      <td style="font-size:13px;color:${GRAY}">${esc(s.description || '—')}</td>
      <td>${s.article_count}</td>
      <td style="font-size:12px">${esc(s.editor_name || '—')}</td>
      <td><span style="color:${s.is_active ? '#16a34a' : '#dc2626'};font-weight:600;font-size:12px">${s.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="white-space:nowrap">
        <form method="POST" action="/school/newspaper/sections/${s.id}/toggle" style="display:inline"><button class="btn" style="background:${s.is_active ? '#d97706' : '#16a34a'};padding:5px 12px;font-size:11px">${s.is_active ? 'Disable' : 'Enable'}</button></form>
      </td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1000px;margin:0 auto">
      ${nav('sections')}
      <h1 style="font-size:24px;color:#111827;margin:0 0 4px">📂 Sections</h1>
      <p style="color:${GRAY};font-size:13px;margin:0 0 20px">Manage newspaper sections and assign editors</p>
      <div class="card" style="padding:0;overflow:hidden;margin-bottom:20px">
        <div style="overflow-x:auto"><table><thead><tr><th></th><th>Name</th><th>Description</th><th>Articles</th><th>Editor</th><th>Status</th><th>Actions</th></tr></thead><tbody>
          ${rows || `<tr><td colspan="7" style="text-align:center;color:${GRAY};padding:30px">No sections configured</td></tr>`}
        </tbody></table></div>
      </div>
      <div class="card" style="padding:24px">
        <h3 style="margin:0 0 16px;color:#111827;font-size:16px">Add New Section</h3>
        <form method="POST" action="/school/newspaper/sections" style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
          <div style="flex:1;min-width:150px"><label style="display:block;font-size:12px;font-weight:600;color:${GRAY};margin-bottom:4px">Name *</label><input type="text" name="name" required placeholder="e.g. Science"></div>
          <div style="flex:2;min-width:200px"><label style="display:block;font-size:12px;font-weight:600;color:${GRAY};margin-bottom:4px">Description</label><input type="text" name="description" placeholder="Section description"></div>
          <div style="flex:1;min-width:100px"><label style="display:block;font-size:12px;font-weight:600;color:${GRAY};margin-bottom:4px">Sort Order</label><input type="number" name="sort_order" value="0" min="0"></div>
          <button type="submit" class="btn" style="padding:8px 20px">Add Section</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Newspaper Sections', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 23: POST /school/newspaper/sections — Create section
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/sections', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { name, description, sort_order } = req.body;
    if (!name || !name.trim()) return res.redirect('/school/newspaper/sections');
    const slug = name.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    await pool.query(`INSERT INTO newspaper_sections (tenant_id, name, slug, description, sort_order) VALUES ($1,$2,$3,$4,$5)`, [tid, name.trim(), slug, (description || '').trim() || null, parseInt(sort_order) || 0]);
    audit('newspaper_section_created', { name: name.trim() }, req);
    res.redirect('/school/newspaper/sections');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 24: POST /school/newspaper/sections/:id/toggle — Toggle section
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/sections/:id/toggle', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    await pool.query(`UPDATE newspaper_sections SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2`, [id, tid]);
    res.redirect('/school/newspaper/sections');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 25: GET /school/newspaper/my-articles — Author's articles
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/my-articles', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const articles = (await pool.query(`
      SELECT a.*, e.title AS edition_title FROM newspaper_articles a
      LEFT JOIN newspaper_editions e ON e.id = a.edition_id
      WHERE a.tenant_id=$1 AND a.author_id=$2 ORDER BY a.updated_at DESC
    `, [tid, uid])).rows;

    const totalViews = articles.reduce((s, a) => s + (a.views || 0), 0);
    const totalLikes = articles.reduce((s, a) => s + (a.likes || 0), 0);

    const rows = articles.map(a => `<tr>
      <td><a href="/school/newspaper/articles/${a.id}" style="color:${P};text-decoration:none;font-weight:600">${esc((a.title || '').substring(0, 45))}${a.title && a.title.length > 45 ? '...' : ''}</a></td>
      <td>${sectionIcon(a.section)} ${esc(a.section)}</td>
      <td>${statusBadge(a.status)}</td>
      <td style="font-size:12px;color:${GRAY}">${esc(a.edition_title || '—')}</td>
      <td style="font-size:12px">${a.views} 👁 &nbsp; ${a.likes} ❤️</td>
      <td style="font-size:12px;color:${GRAY}">${fmtDate(a.updated_at)}</td>
      <td style="white-space:nowrap">
        <a href="/school/newspaper/articles/${a.id}/edit" class="btn" style="background:#f3f4f6;color:#374151;text-decoration:none;padding:5px 12px;font-size:11px">Edit</a>
        ${a.status === 'revision' ? `<form method="POST" action="/school/newspaper/articles/${a.id}/resubmit" style="display:inline"><button class="btn" style="background:#2563eb;padding:5px 12px;font-size:11px">Resubmit</button></form>` : ''}
      </td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">
      ${nav('my')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#111827;margin:0">📝 My Articles</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${articles.length} articles &bull; ${totalViews} views &bull; ${totalLikes} likes</p></div>
        <a href="/school/newspaper/articles/new" class="btn" style="text-decoration:none">+ New Article</a>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        ${articles.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Title</th><th>Section</th><th>Status</th><th>Edition</th><th>Stats</th><th>Updated</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>` :
          `<div style="text-align:center;padding:48px;color:${GRAY}"><p style="font-size:48px;margin-bottom:12px">📝</p><p>You haven't written any articles yet. Start writing!</p></div>`}
      </div>
    </div>`;
    res.send(renderPage('My Articles', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 26: POST /school/newspaper/articles/:id/resubmit — Resubmit after revision
  // ═══════════════════════════════════════════════════════════════════════
  app.post('/school/newspaper/articles/:id/resubmit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    await pool.query(`UPDATE newspaper_articles SET status='review', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND author_id=$3`, [id, tid, req.session.user.id]);
    audit('newspaper_article_resubmitted', { article_id: id }, req);
    res.redirect('/school/newspaper/my-articles');
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 27: GET /school/newspaper/popular — Popular articles
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/popular', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const sortBy = req.query.sort || 'views';
    const articles = (await pool.query(`
      SELECT a.*, u.name AS author_display
      FROM newspaper_articles a
      LEFT JOIN users u ON u.id = a.author_id
      WHERE a.tenant_id=$1 AND a.status='published'
      ORDER BY ${sortBy === 'likes' ? 'a.likes' : 'a.views'} DESC LIMIT 30
    `, [tid])).rows;

    const cards = articles.map((a, i) => {
      const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `<span style="color:${GRAY};font-weight:700">${i + 1}</span>`;
      return `<div style="display:flex;gap:16px;padding:14px;align-items:start;${i < articles.length - 1 ? 'border-bottom:1px solid #f3f4f6' : ''}">
        <div style="font-size:24px;width:40px;text-align:center;flex-shrink:0">${medal}</div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;flex-wrap:wrap">
            <span style="font-size:11px;font-weight:600;color:${P};background:#eef2ff;padding:2px 8px;border-radius:4px">${sectionIcon(a.section)} ${esc(a.section)}</span>
          </div>
          <h3 style="margin:0 0 4px;font-size:15px;color:#111827"><a href="/school/newspaper/articles/${a.id}" style="color:#111827;text-decoration:none">${esc(a.title)}</a></h3>
          <div style="display:flex;gap:12px;font-size:12px;color:${GRAY}">
            <span>✍️ ${esc(a.author_name || a.author_display || '—')}</span>
            <span>👁 ${a.views}</span><span>❤️ ${a.likes}</span>
            <span>📅 ${fmtDate(a.published_at)}</span>
          </div>
        </div>
      </div>`;
    }).join('');

    const html = SKIP + `<div style="max-width:800px;margin:0 auto">
      ${nav('popular')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#111827;margin:0">🔥 Popular Articles</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Most read and liked content</p></div>
        <div style="display:flex;gap:6px">
          <a href="/school/newspaper/popular?sort=views" class="btn" style="text-decoration:none;${sortBy === 'views' ? '' : 'background:#f3f4f6;color:#374151'};padding:6px 16px;font-size:12px">Most Viewed</a>
          <a href="/school/newspaper/popular?sort=likes" class="btn" style="text-decoration:none;${sortBy === 'likes' ? '' : 'background:#f3f4f6;color:#374151'};padding:6px 16px;font-size:12px">Most Liked</a>
        </div>
      </div>
      <div class="card">
        ${articles.length ? cards : `<div style="text-align:center;padding:48px;color:${GRAY}"><p style="font-size:48px;margin-bottom:12px">📊</p><p>No published articles yet.</p></div>`}
      </div>
    </div>`;
    res.send(renderPage('Popular Articles', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 28: GET /school/newspaper/cartoons — Cartoon/comic section
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/cartoons', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const cartoons = (await pool.query(`
      SELECT c.*, u.name AS author_display, e.title AS edition_title
      FROM newspaper_cartoons c
      LEFT JOIN users u ON u.id = c.author_id
      LEFT JOIN newspaper_editions e ON e.id = c.edition_id
      WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 30
    `, [tid])).rows;

    const cards = cartoons.map(c => `<div class="card" style="padding:0;overflow:hidden;text-align:center">
      ${c.image_url ? `<img src="${esc(c.image_url)}" alt="${esc(c.title)}" style="width:100%;max-height:300px;object-fit:contain;background:#f9fafb">` : `<div style="height:200px;background:#f3f4f6;display:flex;align-items:center;justify-content:center;font-size:64px">🎭</div>`}
      <div style="padding:14px">
        <h3 style="margin:0 0 4px;font-size:15px;color:#111827">${esc(c.title)}</h3>
        ${c.caption ? `<p style="font-size:13px;color:${GRAY};margin:0 0 6px;font-style:italic">${esc(c.caption)}</p>` : ''}
        <div style="font-size:11px;color:${GRAY}">by ${esc(c.author_name || c.author_display || '—')} ${c.edition_title ? '&bull; ' + esc(c.edition_title) : ''}</div>
      </div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">
      ${nav('cartoons')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#111827;margin:0">🎭 Cartoons & Comics</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Humor, satire, and visual stories</p></div>
      </div>
      ${cartoons.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">${cards}</div>` :
        `<div class="card" style="text-align:center;padding:48px"><p style="font-size:48px;margin-bottom:12px">🎭</p><p style="color:${GRAY}">No cartoons published yet.</p></div>`}
    </div>`;
    res.send(renderPage('Cartoons & Comics', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 29: GET /school/newspaper/puzzles — Crossword & puzzles
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/puzzles', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const puzzles = (await pool.query(`
      SELECT p.*, u.name AS author_display, e.title AS edition_title
      FROM newspaper_puzzles p
      LEFT JOIN users u ON u.id = p.author_id
      LEFT JOIN newspaper_editions e ON e.id = p.edition_id
      WHERE p.tenant_id=$1 ORDER BY p.created_at DESC LIMIT 20
    `, [tid])).rows;

    const typeIcons = { crossword: '🧩', sudoku: '🔢', wordsearch: '🔍', trivia: '❓', riddle: '🤔' };

    const cards = puzzles.map(p => {
      const icon = typeIcons[p.puzzle_type] || '🧩';
      const content = typeof p.content === 'string' ? JSON.parse(p.content || '{}') : (p.content || {});
      return `<div class="card" style="border-left:4px solid ${P}">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-size:20px">${icon}</span>
          <span style="font-size:12px;font-weight:600;color:${P};background:#eef2ff;padding:2px 8px;border-radius:4px;text-transform:uppercase">${esc(p.puzzle_type)}</span>
          ${statusBadge(p.status)}
        </div>
        <h3 style="margin:0 0 6px;font-size:16px;color:#111827">${esc(p.title)}</h3>
        ${content.clue ? `<p style="font-size:13px;color:${GRAY};margin:0 0 8px">${esc(content.clue)}</p>` : ''}
        ${content.words ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${(Array.isArray(content.words) ? content.words : []).map(w => `<span style="padding:2px 8px;background:#f3f4f6;border-radius:4px;font-size:12px;font-weight:600">${esc(w)}</span>`).join('')}</div>` : ''}
        <div style="font-size:11px;color:${GRAY}">by ${esc(p.author_name || p.author_display || '—')} ${p.edition_title ? '&bull; ' + esc(p.edition_title) : ''}</div>
      </div>`;
    }).join('');

    const html = SKIP + `<div style="max-width:1000px;margin:0 auto">
      ${nav('puzzles')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#111827;margin:0">🧩 Puzzles & Games</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Crosswords, Sudoku, word searches, and more</p></div>
      </div>
      ${puzzles.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">${cards}</div>` :
        `<div class="card" style="text-align:center;padding:48px"><p style="font-size:48px;margin-bottom:12px">🧩</p><p style="color:${GRAY}">No puzzles published yet. Stay tuned!</p></div>`}
    </div>`;
    res.send(renderPage('Puzzles & Games', html, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 30: GET /school/newspaper/editions/:id/print-preview — Print layout
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/editions/:id/print-preview', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const edition = (await pool.query(`SELECT * FROM newspaper_editions WHERE id=$1 AND tenant_id=$2`, [id, tid])).rows[0];
    if (!edition) return res.redirect('/school/newspaper/editions');

    const articles = (await pool.query(`
      SELECT a.*, u.name AS author_display FROM newspaper_articles a
      LEFT JOIN users u ON u.id = a.author_id
      WHERE a.edition_id=$1 AND a.tenant_id=$2
      ORDER BY a.is_featured DESC,
        CASE a.section WHEN 'editorial' THEN 1 WHEN 'news' THEN 2 WHEN 'features' THEN 3 WHEN 'sports' THEN 4 WHEN 'arts' THEN 5 WHEN 'opinions' THEN 6 ELSE 9 END
    `, [id, tid])).rows;

    const masthead = `<div style="text-align:center;border-bottom:3px double #111;padding-bottom:16px;margin-bottom:20px">
      <h1 style="font-family:Georgia,serif;font-size:36px;margin:0 0 4px;text-transform:uppercase;letter-spacing:2px">${esc(edition.title)}</h1>
      ${edition.subtitle ? `<p style="font-size:14px;color:#555;margin:0 0 8px;font-style:italic">${esc(edition.subtitle)}</p>` : ''}
      <p style="font-size:12px;color:#777;margin:0">Volume ${edition.volume} &bull; Issue ${edition.issue} &bull; ${fmtDate(edition.published_at || new Date())}</p>
    </div>`;

    const featuredArticle = articles.find(a => a.is_featured);
    const otherArticles = articles.filter(a => !a.is_featured);

    let featuredHtml = '';
    if (featuredArticle) {
      featuredHtml = `<div style="border-bottom:1px solid #ccc;padding-bottom:20px;margin-bottom:20px">
        <h2 style="font-family:Georgia,serif;font-size:28px;margin:0 0 8px;line-height:1.2">${esc(featuredArticle.title)}</h2>
        <p style="font-size:12px;color:#777;margin:0 0 10px">By ${esc(featuredArticle.author_name || featuredArticle.author_display || 'Staff Writer')} &bull; ${esc(featuredArticle.section)}</p>
        ${featuredArticle.cover_image ? `<img src="${esc(featuredArticle.cover_image)}" style="width:100%;max-height:350px;object-fit:cover;margin-bottom:12px">` : ''}
        <div style="font-family:Georgia,serif;font-size:15px;line-height:1.7;color:#222;columns:2;column-gap:30px;white-space:pre-wrap">${esc(featuredArticle.content || '')}</div>
      </div>`;
    }

    const articleColumns = otherArticles.map(a => `<div style="border-bottom:1px dotted #ccc;padding-bottom:12px;margin-bottom:12px">
      <span style="font-size:10px;font-weight:700;color:#888;text-transform:uppercase">${esc(a.section)}</span>
      <h3 style="font-family:Georgia,serif;font-size:17px;margin:4px 0;line-height:1.3">${esc(a.title)}</h3>
      <p style="font-size:11px;color:#777;margin:0 0 6px">${esc(a.author_name || a.author_display || '')}</p>
      <p style="font-family:Georgia,serif;font-size:13px;line-height:1.6;color:#333;margin:0;white-space:pre-wrap">${esc((a.content || '').substring(0, 500))}${(a.content || '').length > 500 ? '...' : ''}</p>
    </div>`).join('');

    const printHtml = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(edition.title)} — Print Preview</title>
      <style>
        @page { size: A3; margin: 2cm; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: Georgia, 'Times New Roman', serif; color: #111; padding: 40px; max-width: 1100px; margin: 0 auto; }
        @media print { body { padding: 0; } .no-print { display: none !important; } }
      </style>
    </head><body>
      <div class="no-print" style="text-align:center;margin-bottom:20px;padding:10px;background:#f3f4f6;border-radius:8px">
        <button onclick="window.print()" style="padding:8px 24px;background:${P};color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600">🖨️ Print / Save as PDF</button>
        <a href="/school/newspaper/editions/${id}" style="margin-left:12px;color:${P};text-decoration:none;font-size:14px">← Back to Edition</a>
      </div>
      ${masthead}
      ${featuredHtml}
      <div style="columns:2;column-gap:30px">${articleColumns}</div>
      <div style="margin-top:20px;padding-top:12px;border-top:2px solid #111;text-align:center;font-size:10px;color:#777">
        ${esc(edition.title)} &bull; Volume ${edition.volume}, Issue ${edition.issue} &bull; Printed on ${new Date().toLocaleDateString()}
      </div>
    </body></html>`;

    res.send(printHtml);
  }));

  // ═══════════════════════════════════════════════════════════════════════
  // ROUTE 31: GET /school/newspaper/comments — All comments moderation
  // ═══════════════════════════════════════════════════════════════════════
  app.get('/school/newspaper/comments', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const statusFilter = req.query.status || 'pending';
    let where = ['nc.tenant_id=$1'], params = [tid], pi = 2;
    if (statusFilter && statusFilter !== 'all') { where.push(`nc.status=$${pi++}`); params.push(statusFilter); }

    const comments = (await pool.query(`
      SELECT nc.*, na.title AS article_title
      FROM newspaper_comments nc
      JOIN newspaper_articles na ON na.id = nc.article_id
      WHERE ${where.join(' AND ')} ORDER BY nc.created_at DESC LIMIT 100
    `, params)).rows;

    const totalCounts = (await pool.query(`
      SELECT status, COUNT(*)::int AS cnt FROM newspaper_comments WHERE tenant_id=$1 GROUP BY status
    `, [tid])).rows;
    const counts = {};
    totalCounts.forEach(r => { counts[r.status] = r.cnt; });

    const rows = comments.map(c => `<tr>
      <td><a href="/school/newspaper/articles/${c.article_id}" style="color:${P};text-decoration:none;font-weight:600;font-size:13px">${esc((c.article_title || '').substring(0, 35))}</a></td>
      <td style="font-size:13px">${esc(c.author_name || 'Anonymous')}</td>
      <td style="font-size:13px;max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.content)}</td>
      <td>${statusBadge(c.status)}</td>
      <td style="font-size:12px;color:${GRAY}">${fmtDateTime(c.created_at)}</td>
      <td style="white-space:nowrap">
        ${c.status === 'pending' ? `
          <form method="POST" action="/school/newspaper/comments/${c.id}/moderate" style="display:inline"><input type="hidden" name="action" value="approve"><button class="btn" style="background:#16a34a;padding:4px 10px;font-size:11px">✅</button></form>
          <form method="POST" action="/school/newspaper/comments/${c.id}/moderate" style="display:inline"><input type="hidden" name="action" value="reject"><button class="btn" style="background:#dc2626;padding:4px 10px;font-size:11px">❌</button></form>
        ` : '<span style="font-size:12px;color:' + GRAY + '">—</span>'}
      </td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">
      ${nav('')}
      <h1 style="font-size:24px;color:#111827;margin:0 0 4px">💬 Comment Moderation</h1>
      <p style="color:${GRAY};font-size:13px;margin:0 0 20px">Review and moderate reader comments</p>
      <div style="display:flex;gap:6px;margin-bottom:16px;flex-wrap:wrap">
        <a href="/school/newspaper/comments?status=pending" class="btn" style="text-decoration:none;${statusFilter === 'pending' ? '' : 'background:#f3f4f6;color:#374151'};padding:6px 14px;font-size:12px">Pending (${counts.pending || 0})</a>
        <a href="/school/newspaper/comments?status=approved" class="btn" style="text-decoration:none;${statusFilter === 'approved' ? '' : 'background:#f3f4f6;color:#374151'};padding:6px 14px;font-size:12px">Approved (${counts.approved || 0})</a>
        <a href="/school/newspaper/comments?status=rejected" class="btn" style="text-decoration:none;${statusFilter === 'rejected' ? '' : 'background:#f3f4f6;color:#374151'};padding:6px 14px;font-size:12px">Rejected (${counts.rejected || 0})</a>
        <a href="/school/newspaper/comments?status=all" class="btn" style="text-decoration:none;${statusFilter === 'all' ? '' : 'background:#f3f4f6;color:#374151'};padding:6px 14px;font-size:12px">All</a>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        ${comments.length ? `<div style="overflow-x:auto"><table><thead><tr><th>Article</th><th>Commenter</th><th>Comment</th><th>Status</th><th>Date</th><th>Actions</th></tr></thead><tbody>${rows}</tbody></table></div>` :
          `<div style="text-align:center;padding:48px;color:${GRAY}">No comments found.</div>`}
      </div>
    </div>`;
    res.send(renderPage('Comment Moderation', html, req.session.user, req));
  }));

};
