/**
 * School Newsletter System
 * School SaaS Portal Module — Rich Newsletter Editor, Articles, Subscribers, Analytics
 *
 * Routes (prefix /school/newsletter/):
 *   Dashboard, Create, Edit, Articles CRUD, Subscribers, Preview,
 *   Publish, Archive, Analytics, Send, Categories, Social Share
 *
 * Tables:
 *   newsletters, newsletter_articles, newsletter_subscribers, newsletter_reads, newsletter_categories
 */

module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const requireNotBanned = opts.requireNotBanned || ((req,res,next) => { next(); });
  const audit = opts.audit || (() => {});
  const queueEmail = opts.queueEmail || (() => {});
  const uiT = opts.uiT || ((k,d) => d);

  const P = '#4f46e5';
  const GRAY = '#6b7280';
  const PFX = '/school/newsletter';

  // ─── Helpers ──────────────────────────────────────────────────────────
  const uid = (r) => (r.session && r.session.user ? r.session.user.id : 0);
  const tid = (r) => (r.session && r.session.user ? r.session.user.tenant_id : 0);
  const uname = (r) => (r.session && r.session.user ? r.session.user.name : 'Guest');
  const urole = (r) => (r.session && r.session.user ? r.session.user.role : 'student');
  const isAdmin = (r) => urole(r) === 'admin' || urole(r) === 'teacher';
  const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-US', { year:'numeric', month:'short', day:'numeric', hour:'2-digit', minute:'2-digit' }) : '—';
  const trunc = (s, n) => (s||'').length > n ? (s||'').slice(0, n) + '...' : (s||'');
  const statusBadge = (s) => {
    const map = { draft: { bg:'#fef3c7', fg:'#92400e', label:'Draft' }, scheduled: { bg:'#dbeafe', fg:'#1e40af', label:'Scheduled' },
      published: { bg:'#d1fae5', fg:'#065f46', label:'Published' }, archived: { bg:'#f3f4f6', fg:'#374151', label:'Archived' },
      sending: { bg:'#ede9fe', fg:'#5b21b6', label:'Sending' } };
    const c = map[s] || map.draft;
    return `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:.75rem;font-weight:600;background:${c.bg};color:${c.fg}">${c.label}</span>`;
  };

  // ─── Shared CSS ───────────────────────────────────────────────────────
  const SKIP = `<link rel="stylesheet" href="/css/sk.css"><style>
    .nl-page{max-width:1200px;margin:0 auto;padding:20px;font-family:'Inter',system-ui,-apple-system,sans-serif;color:#1f2937}
    .nl-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px}
    .nl-header h1{font-size:1.6rem;font-weight:800;margin:0;background:linear-gradient(135deg,#4f46e5,#06b6d4);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
    .nl-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:28px}
    .nl-stat{background:#fff;border-radius:12px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center}
    .nl-stat-num{font-size:1.8rem;font-weight:800;color:#4f46e5}
    .nl-stat-label{font-size:.78rem;color:#6b7280;margin-top:4px}
    .nl-card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
    .nl-btn{display:inline-flex;align-items:center;gap:6px;background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:.85rem;font-weight:600;text-decoration:none;transition:background .15s}
    .nl-btn:hover{background:#3730a3}
    .nl-btn-sm{padding:5px 12px;font-size:.75rem}
    .nl-btn-secondary{background:#f3f4f6;color:#374151;border:1px solid #d1d5db}
    .nl-btn-secondary:hover{background:#e5e7eb}
    .nl-btn-danger{background:#fef2f2;color:#dc2626;border:1px solid #fecaca}
    .nl-btn-danger:hover{background:#fee2e2}
    .nl-btn-success{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
    .nl-btn-success:hover{background:#a7f3d0}
    .nl-grid{display:grid;gap:16px}
    .nl-grid-2{grid-template-columns:repeat(auto-fill,minmax(340px,1fr))}
    .nl-grid-3{grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
    .nl-table{width:100%;border-collapse:collapse}
    .nl-table th,.nl-table td{padding:10px 14px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:.85rem}
    .nl-table th{background:#f9fafb;font-weight:600;color:#6b7280;font-size:.75rem;text-transform:uppercase;letter-spacing:.5px}
    .nl-table tr:hover td{background:#f9fafb}
    .nl-input,.nl-select,.nl-textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;font-size:.9rem;outline:none;transition:border-color .2s}
    .nl-input:focus,.nl-select:focus,.nl-textarea:focus{border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
    .nl-textarea{min-height:120px;resize:vertical;font-family:inherit}
    .nl-label{display:block;font-size:.8rem;font-weight:600;color:#374151;margin-bottom:4px}
    .nl-form-group{margin-bottom:16px}
    .nl-tabs{display:flex;gap:4px;margin-bottom:20px;border-bottom:2px solid #e5e7eb}
    .nl-tab{padding:10px 18px;border:none;background:none;color:#6b7280;font-size:.85rem;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:all .2s}
    .nl-tab:hover{color:#4f46e5}
    .nl-tab.active{color:#4f46e5;border-bottom-color:#4f46e5}
    .nl-chip{display:inline-block;padding:3px 10px;border-radius:20px;font-size:.72rem;font-weight:600;background:#ede9fe;color:#5b21b6}
    .nl-chip-green{background:#d1fae5;color:#065f46}
    .nl-chip-red{background:#fee2e2;color:#dc2626}
    .nl-chip-yellow{background:#fef3c7;color:#92400e}
    .nl-empty{text-align:center;padding:48px 20px;color:#9ca3af}
    .nl-empty-icon{font-size:2.5rem;margin-bottom:8px}
    .nl-cover{width:100%;height:180px;border-radius:10px;background:linear-gradient(135deg,#4f46e5,#06b6d4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:1.2rem;font-weight:700;overflow:hidden;position:relative}
    .nl-cover img{width:100%;height:100%;object-fit:cover}
    .nl-pagination{display:flex;gap:6px;justify-content:center;margin-top:20px}
    .nl-featured-star{color:#f59e0b;font-size:1rem}
    .nl-article-card{border:1px solid #e5e7eb;border-radius:10px;overflow:hidden;transition:box-shadow .15s}
    .nl-article-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.1)}
    .nl-bar{height:8px;border-radius:4px;background:#e5e7eb;overflow:hidden}
    .nl-bar-fill{height:100%;border-radius:4px;background:linear-gradient(90deg,#4f46e5,#06b6d4)}
    .nl-editor-toolbar{display:flex;gap:4px;padding:8px;background:#f9fafb;border:1px solid #d1d5db;border-bottom:none;border-radius:8px 8px 0 0;flex-wrap:wrap}
    .nl-editor-toolbar button{background:#fff;border:1px solid #d1d5db;border-radius:6px;padding:4px 10px;cursor:pointer;font-size:.8rem}
    .nl-editor-toolbar button:hover{background:#4f46e5;color:#fff;border-color:#4f46e5}
    .nl-editor-area{border:1px solid #d1d5db;border-top:none;border-radius:0 0 8px 8px;min-height:300px;padding:14px;outline:none;font-size:.9rem;line-height:1.7}
    .nl-breadcrumb{margin-bottom:16px;font-size:.85rem;color:#6b7280}
    .nl-breadcrumb a{color:#4f46e5;text-decoration:none}
    .nl-breadcrumb a:hover{text-decoration:underline}
    .nl-share-btns{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
    .nl-share-btn{display:inline-flex;align-items:center;gap:4px;padding:6px 14px;border-radius:8px;font-size:.78rem;font-weight:600;cursor:pointer;border:none;text-decoration:none;transition:opacity .15s}
    .nl-share-btn:hover{opacity:.85}
    .nl-share-fb{background:#1877f2;color:#fff}
    .nl-share-tw{background:#1da1f2;color:#fff}
    .nl-share-li{background:#0a66c2;color:#fff}
    .nl-share-wa{background:#25d366;color:#fff}
    .nl-share-copy{background:#f3f4f6;color:#374151;border:1px solid #d1d5db}
    @media(max-width:768px){.nl-grid-2,.nl-grid-3{grid-template-columns:1fr}.nl-header{flex-direction:column;align-items:flex-start}}
  </style><div class="nl-breadcrumb"><a href="/school">${uiT('school','School')}</a> &rsaquo; ${uiT('newsletter','School Newsletter')}</div>`;

  function pageWrap(title, body) {
    return SKIP + body;
  }

  // ─── DB Schema Auto-creation ──────────────────────────────────────────
  async function ensureTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS newsletters (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        title VARCHAR(300) NOT NULL,
        subtitle VARCHAR(500),
        content LONGTEXT,
        issue_number VARCHAR(50),
        status ENUM('draft','scheduled','published','archived','sending') DEFAULT 'draft',
        scheduled_at DATETIME,
        published_at DATETIME,
        cover_image VARCHAR(500),
        theme_color VARCHAR(20) DEFAULT '#4f46e5',
        social_fb VARCHAR(300),
        social_tw VARCHAR(300),
        social_li VARCHAR(300),
        subscriber_count INT DEFAULT 0,
        read_count INT DEFAULT 0,
        click_count INT DEFAULT 0,
        created_by INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_status (tenant_id, status),
        INDEX idx_published (tenant_id, published_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS newsletter_articles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        newsletter_id INT NOT NULL,
        title VARCHAR(300) NOT NULL,
        content LONGTEXT,
        summary TEXT,
        author VARCHAR(150),
        author_id INT,
        category VARCHAR(100) DEFAULT 'General',
        featured TINYINT(1) DEFAULT 0,
        image_url VARCHAR(500),
        sort_order INT DEFAULT 0,
        word_count INT DEFAULT 0,
        read_count INT DEFAULT 0,
        status ENUM('draft','published') DEFAULT 'draft',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_newsletter (tenant_id, newsletter_id),
        INDEX idx_featured (tenant_id, newsletter_id, featured),
        INDEX idx_category (tenant_id, category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(150),
        role VARCHAR(50) DEFAULT 'external',
        status ENUM('active','unsubscribed','bounced','pending') DEFAULT 'active',
        subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        unsubscribed_at DATETIME,
        last_opened DATETIME,
        open_count INT DEFAULT 0,
        UNIQUE KEY uk_email (tenant_id, email),
        INDEX idx_tenant (tenant_id),
        INDEX idx_status (tenant_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS newsletter_reads (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        newsletter_id INT NOT NULL,
        subscriber_id INT,
        email VARCHAR(255),
        ip_address VARCHAR(45),
        user_agent VARCHAR(500),
        read_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_newsletter_sub (newsletter_id, subscriber_id),
        INDEX idx_tenant (tenant_id),
        INDEX idx_newsletter (tenant_id, newsletter_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS newsletter_categories (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(120),
        color VARCHAR(20) DEFAULT '#4f46e5',
        icon VARCHAR(50) DEFAULT '📰',
        sort_order INT DEFAULT 0,
        UNIQUE KEY uk_tenant_name (tenant_id, name),
        INDEX idx_tenant (tenant_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
    ];
    for (const sql of tables) {
      try { await pool.query(sql); } catch(e) { /* table exists */ }
    }
    // Seed default categories
    const tIds = await pool.query(`SELECT DISTINCT tenant_id FROM newsletter_categories LIMIT 0`);
    try {
      await pool.query(`INSERT IGNORE INTO newsletter_categories (tenant_id, name, slug, icon, sort_order) VALUES
        (0,'School News','school-news','📰',1),(0,'Academic','academic','🎓',2),(0,'Sports','sports','⚽',3),
        (0,'Arts & Culture','arts-culture','🎨',4),(0,'Events','events','📅',5),(0,'Student Spotlight','student-spotlight','⭐',6),
        (0,'Community','community','🤝',7),(0,'Alumni','alumni','🎓',8),(0,'Technology','technology','💻',9),
        (0,'Health & Wellness','health-wellness','💚',10)`);
    } catch(e) { /* ignore */ }
    console.log('[Newsletter] Tables ready');
  }

  (async () => {
    try { await ensureTables(); } catch(e) { console.warn('[Newsletter] Migration warning:', e.message); }
  })();

  // Scheduler: auto-publish scheduled newsletters
  async function publishScheduled() {
    try {
      await pool.query(`UPDATE newsletters SET status='published', published_at=NOW() WHERE status='scheduled' AND scheduled_at <= NOW()`);
    } catch(e) { /* silent */ }
  }
  setInterval(publishScheduled, 60000);

  // ─── 1. DASHBOARD ─────────────────────────────────────────────────────
  app.get(PFX + '/', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const [[stats]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM newsletters WHERE tenant_id=?) AS total,
        (SELECT COUNT(*) FROM newsletters WHERE tenant_id=? AND status='published') AS published,
        (SELECT COUNT(*) FROM newsletters WHERE tenant_id=? AND status='draft') AS drafts,
        (SELECT COUNT(*) FROM newsletters WHERE tenant_id=? AND status='scheduled') AS scheduled,
        (SELECT COUNT(*) FROM newsletter_subscribers WHERE tenant_id=? AND status='active') AS subscribers,
        (SELECT COALESCE(SUM(read_count),0) FROM newsletters WHERE tenant_id=?) AS total_reads`,
      [t, t, t, t, t, t]
    );
    const [recent] = await pool.query(
      `SELECT * FROM newsletters WHERE tenant_id=? ORDER BY updated_at DESC LIMIT 8`, [t]
    );
    const [topArticles] = await pool.query(
      `SELECT na.*, n.title AS newsletter_title FROM newsletter_articles na
       JOIN newsletters n ON n.id = na.newsletter_id
       WHERE na.tenant_id=? AND na.status='published' ORDER BY na.read_count DESC LIMIT 5`, [t]
    );
    let recentRows = '';
    for (const nl of recent) {
      recentRows += `<tr>
        <td><strong style="cursor:pointer" onclick="location.href='${PFX}/edit/${nl.id}'">${esc(nl.title)}</strong></td>
        <td>${esc(nl.issue_number || '—')}</td>
        <td>${statusBadge(nl.status)}</td>
        <td>${fmtDate(nl.published_at)}</td>
        <td>${Number(nl.read_count||0).toLocaleString()}</td>
        <td style="white-space:nowrap">
          <a href="${PFX}/preview/${nl.id}" class="nl-btn nl-btn-sm nl-btn-secondary">View</a>
          ${nl.status==='draft'?`<a href="${PFX}/edit/${nl.id}" class="nl-btn nl-btn-sm">Edit</a>`:''}
          ${nl.status==='draft'?`<a href="${PFX}/publish/${nl.id}" class="nl-btn nl-btn-sm nl-btn-success" onclick="return confirm('Publish now?')">Publish</a>`:''}
        </td></tr>`;
    }
    let articleRows = '';
    for (const a of topArticles) {
      articleRows += `<tr>
        <td>${a.featured?'<span class="nl-featured-star">★</span> ':''}<strong>${esc(a.title)}</strong></td>
        <td>${esc(a.category)}</td>
        <td>${esc(a.author || '—')}</td>
        <td>${Number(a.read_count||0).toLocaleString()}</td></tr>`;
    }
    const body = `
    <div class="nl-header">
      <h1>📰 School Newsletter</h1>
      <div style="display:flex;gap:8px">
        ${isAdmin(req)?`<a href="${PFX}/create" class="nl-btn">+ New Issue</a>`:''}
        <a href="${PFX}/subscribers" class="nl-btn nl-btn-secondary">👥 Subscribers</a>
        <a href="${PFX}/analytics" class="nl-btn nl-btn-secondary">📊 Analytics</a>
      </div>
    </div>
    <div class="nl-stats">
      <div class="nl-stat"><div class="nl-stat-num">${stats.total}</div><div class="nl-stat-label">Total Issues</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${stats.published}</div><div class="nl-stat-label">Published</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${stats.drafts}</div><div class="nl-stat-label">Drafts</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${stats.scheduled}</div><div class="nl-stat-label">Scheduled</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${Number(stats.subscribers||0).toLocaleString()}</div><div class="nl-stat-label">Subscribers</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${Number(stats.total_reads||0).toLocaleString()}</div><div class="nl-stat-label">Total Reads</div></div>
    </div>
    <div class="nl-grid nl-grid-2">
      <div class="nl-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h2 style="margin:0;font-size:1.1rem">📝 Recent Issues</h2>
          <a href="${PFX}/archive" class="nl-btn nl-btn-sm nl-btn-secondary">View All</a>
        </div>
        <table class="nl-table"><thead><tr><th>Title</th><th>Issue #</th><th>Status</th><th>Published</th><th>Reads</th><th>Actions</th></tr></thead>
        <tbody>${recentRows||'<tr><td colspan="6" style="text-align:center;color:#9ca3af">No newsletters yet</td></tr>'}</tbody></table>
      </div>
      <div>
        <div class="nl-card" style="margin-bottom:16px">
          <h2 style="margin:0 0 14px;font-size:1.1rem">🔥 Top Articles</h2>
          <table class="nl-table"><thead><tr><th>Title</th><th>Category</th><th>Author</th><th>Reads</th></tr></thead>
          <tbody>${articleRows||'<tr><td colspan="4" style="text-align:center;color:#9ca3af">No articles yet</td></tr>'}</tbody></table>
        </div>
        <div class="nl-card">
          <h2 style="margin:0 0 10px;font-size:1.1rem">⚡ Quick Actions</h2>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${isAdmin(req)?`<a href="${PFX}/create" class="nl-btn nl-btn-sm">New Issue</a>`:''}
            <a href="${PFX}/categories" class="nl-btn nl-btn-sm nl-btn-secondary">Manage Categories</a>
            <a href="${PFX}/subscribers" class="nl-btn nl-btn-sm nl-btn-secondary">Add Subscriber</a>
            <a href="${PFX}/archive" class="nl-btn nl-btn-sm nl-btn-secondary">Browse Archive</a>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('newsletter-dashboard', pageWrap('Newsletter Dashboard', body), req));
  }));

  // ─── 2. CREATE NEWSLETTER ─────────────────────────────────────────────
  app.get(PFX + '/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const [cats] = await pool.query(`SELECT * FROM newsletter_categories WHERE tenant_id IN (0,?) ORDER BY sort_order, name`, [t]);
    const [[{nextIssue}]] = await pool.query(`SELECT COALESCE(MAX(CAST(issue_number AS UNSIGNED)),0)+1 AS nextIssue FROM newsletters WHERE tenant_id=?`, [t]);
    const [subs] = await pool.query(`SELECT COUNT(*) AS cnt FROM newsletter_subscribers WHERE tenant_id=? AND status='active'`, [t]);
    const catOpts = cats.map(c => `<option value="${esc(c.name)}">${esc(c.icon||'📰')} ${esc(c.name)}</option>`).join('');
    const body = `
    <div class="nl-header"><h1>📝 Create Newsletter</h1><a href="${PFX}/" class="nl-btn nl-btn-secondary">← Back</a></div>
    <div class="nl-grid nl-grid-2">
      <div class="nl-card">
        <form method="POST" action="${PFX}/create" id="nl-form">
          <div class="nl-form-group"><label class="nl-label">Newsletter Title *</label><input class="nl-input" name="title" required maxlength="300" placeholder="e.g., Spring Term Gazette"></div>
          <div class="nl-form-group"><label class="nl-label">Subtitle</label><input class="nl-input" name="subtitle" maxlength="500" placeholder="Brief tagline or description"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="nl-form-group"><label class="nl-label">Issue Number</label><input class="nl-input" name="issue_number" value="Vol. ${nextIssue}" placeholder="e.g., Vol. 5"></div>
            <div class="nl-form-group"><label class="nl-label">Theme Color</label><input type="color" name="theme_color" value="#4f46e5" style="width:100%;height:38px;border:1px solid #d1d5db;border-radius:8px;cursor:pointer"></div>
          </div>
          <div class="nl-form-group"><label class="nl-label">Cover Image URL</label><input class="nl-input" name="cover_image" placeholder="https://example.com/cover.jpg" id="cover-input"></div>
          <div id="cover-preview" class="nl-cover" style="margin-bottom:16px;height:120px">Cover Preview</div>
          <div class="nl-form-group">
            <label class="nl-label">Content</label>
            <div class="nl-editor-toolbar">
              <button type="button" onclick="document.execCommand('bold')"><b>B</b></button>
              <button type="button" onclick="document.execCommand('italic')"><i>I</i></button>
              <button type="button" onclick="document.execCommand('underline')"><u>U</u></button>
              <button type="button" onclick="document.execCommand('insertUnorderedList')">• List</button>
              <button type="button" onclick="document.execCommand('insertOrderedList')">1. List</button>
              <button type="button" onclick="document.execCommand('formatBlock',false,'H2')">H2</button>
              <button type="button" onclick="document.execCommand('formatBlock',false,'H3')">H3</button>
              <button type="button" onclick="document.execCommand('createLink',false,prompt('URL:'))">🔗 Link</button>
              <button type="button" onclick="document.execCommand('insertImage',false,prompt('Image URL:'))">🖼️ Image</button>
            </div>
            <div class="nl-editor-area" contenteditable="true" id="nl-editor" name="content" style="min-height:200px"></div>
            <textarea name="content" id="content-hidden" style="display:none"></textarea>
          </div>
          <div class="nl-form-group"><label class="nl-label">Schedule Publish (optional)</label><input class="nl-input" type="datetime-local" name="scheduled_at"></div>
          <div style="display:flex;gap:8px">
            <button type="submit" class="nl-btn" name="action" value="draft">Save Draft</button>
            <button type="submit" class="nl-btn nl-btn-success" name="action" value="publish">Publish Now</button>
            <button type="submit" class="nl-btn nl-btn-secondary" name="action" value="schedule" id="btn-schedule" disabled>Schedule</button>
          </div>
        </form>
      </div>
      <div>
        <div class="nl-card" style="margin-bottom:16px">
          <h3 style="margin:0 0 10px;font-size:1rem">📋 Details</h3>
          <div style="font-size:.85rem;color:#6b7280">
            <p>Issue Number: <strong>Vol. ${nextIssue}</strong></p>
            <p>Active Subscribers: <strong>${subs[0].cnt}</strong></p>
            <p>Created by: <strong>${esc(uname(req))}</strong></p>
          </div>
        </div>
        <div class="nl-card" style="margin-bottom:16px">
          <h3 style="margin:0 0 10px;font-size:1rem">🔍 Social Sharing</h3>
          <div class="nl-form-group"><label class="nl-label">Facebook URL</label><input class="nl-input" name="social_fb" placeholder="https://facebook.com/..."></div>
          <div class="nl-form-group"><label class="nl-label">Twitter / X URL</label><input class="nl-input" name="social_tw" placeholder="https://twitter.com/..."></div>
          <div class="nl-form-group"><label class="nl-label">LinkedIn URL</label><input class="nl-input" name="social_li" placeholder="https://linkedin.com/..."></div>
        </div>
        <div class="nl-card">
          <h3 style="margin:0 0 10px;font-size:1rem">📝 Tips</h3>
          <ul style="font-size:.82rem;color:#6b7280;margin:0;padding-left:18px">
            <li>Use the rich text editor for formatting</li>
            <li>Add articles after creating the issue</li>
            <li>Set a cover image for better engagement</li>
            <li>Schedule to publish at optimal times</li>
            <li>Preview before publishing to subscribers</li>
          </ul>
        </div>
      </div>
    </div>
    <script>
      document.getElementById('nl-form').addEventListener('submit', function() {
        document.getElementById('content-hidden').value = document.getElementById('nl-editor').innerHTML;
      });
      document.querySelector('[name=scheduled_at]').addEventListener('change', function() {
        document.getElementById('btn-schedule').disabled = !this.value;
      });
      document.getElementById('cover-input').addEventListener('input', function() {
        var p = document.getElementById('cover-preview');
        if(this.value) { p.innerHTML = '<img src="'+this.value+'" style="width:100%;height:100%;object-fit:cover" onerror="this.parentElement.textContent=\\'Invalid image URL\\'">'; }
        else { p.textContent = 'Cover Preview'; }
      });
    </script>`;
    res.send(renderPage('newsletter-create', pageWrap('Create Newsletter', body), req));
  }));

  app.post(PFX + '/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const { title, subtitle, content, issue_number, theme_color, cover_image, scheduled_at, action, social_fb, social_tw, social_li } = req.body;
    const status = action === 'publish' ? 'published' : action === 'schedule' ? 'scheduled' : 'draft';
    const [subs] = await pool.query(`SELECT COUNT(*) AS cnt FROM newsletter_subscribers WHERE tenant_id=? AND status='active'`, [t]);
    const publishedAt = status === 'published' ? now() : null;
    const [result] = await pool.query(
      `INSERT INTO newsletters (tenant_id, title, subtitle, content, issue_number, status, scheduled_at, published_at, cover_image, theme_color, social_fb, social_tw, social_li, subscriber_count, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t, title, subtitle||'', content||'', issue_number||'', status, scheduled_at||null, publishedAt, cover_image||'', theme_color||'#4f46e5', social_fb||'', social_tw||'', social_li||'', subs[0].cnt, uid(req)]
    );
    audit(req, 'newsletter_create', { title, status, issue_number });
    if (status === 'published') {
      queueEmail(t, 'newsletter_published', { newsletter_id: result.insertId, title });
    }
    res.redirect(PFX + '/edit/' + result.insertId);
  }));

  // ─── 3. EDIT NEWSLETTER ──────────────────────────────────────────────
  app.get(PFX + '/edit/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const [nls] = await pool.query(`SELECT * FROM newsletters WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    if (!nls[0]) return res.status(404).send('Newsletter not found');
    const nl = nls[0];
    const [articles] = await pool.query(
      `SELECT * FROM newsletter_articles WHERE newsletter_id=? AND tenant_id=? ORDER BY featured DESC, sort_order, id`, [nl.id, t]
    );
    let articleCards = '';
    for (const a of articles) {
      articleCards += `<div class="nl-article-card" style="background:#fff">
        <div style="padding:14px;display:flex;justify-content:space-between;align-items:flex-start;gap:12px">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:center;gap:6px;margin-bottom:4px">
              ${a.featured?'<span class="nl-featured-star" title="Featured">★</span>':''}
              <strong style="font-size:.92rem">${esc(a.title)}</strong>
              <span class="nl-chip">${esc(a.category)}</span>
              ${a.status==='draft'?'<span class="nl-chip nl-chip-yellow">Draft</span>':'<span class="nl-chip nl-chip-green">Published</span>'}
            </div>
            <p style="margin:0;font-size:.8rem;color:#6b7280">${esc(a.summary||trunc(a.content, 100))} — by ${esc(a.author||'Unknown')} · ${Number(a.read_count||0).toLocaleString()} reads</p>
          </div>
          <div style="display:flex;gap:4px;flex-shrink:0">
            <a href="${PFX}/articles/edit/${a.id}" class="nl-btn nl-btn-sm nl-btn-secondary">Edit</a>
            ${a.featured?`<a href="${PFX}/articles/unfeature/${a.id}?nl=${nl.id}" class="nl-btn nl-btn-sm" title="Unfeature">★</a>`:`<a href="${PFX}/articles/feature/${a.id}?nl=${nl.id}" class="nl-btn nl-btn-sm nl-btn-secondary" title="Feature">☆</a>`}
            <a href="${PFX}/articles/delete/${a.id}?nl=${nl.id}" class="nl-btn nl-btn-sm nl-btn-danger" onclick="return confirm('Delete article?')">✕</a>
          </div>
        </div></div>`;
    }
    const body = `
    <div class="nl-header"><h1>✏️ ${esc(nl.title)}</h1>
      <div style="display:flex;gap:8px">
        ${statusBadge(nl.status)}
        <a href="${PFX}/preview/${nl.id}" class="nl-btn nl-btn-sm nl-btn-secondary">👁 Preview</a>
        ${nl.status==='draft'?`<a href="${PFX}/publish/${nl.id}" class="nl-btn nl-btn-sm nl-btn-success" onclick="return confirm('Publish now?')">Publish</a>`:''}
        ${nl.status==='published'?`<a href="${PFX}/send/${nl.id}" class="nl-btn nl-btn-sm">📧 Send to Subscribers</a>`:''}
      </div>
    </div>
    <div class="nl-grid nl-grid-2">
      <div>
        <div class="nl-card">
          <form method="POST" action="${PFX}/edit/${nl.id}">
            <div class="nl-form-group"><label class="nl-label">Title *</label><input class="nl-input" name="title" value="${esc(nl.title)}" required></div>
            <div class="nl-form-group"><label class="nl-label">Subtitle</label><input class="nl-input" name="subtitle" value="${esc(nl.subtitle||'')}"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div class="nl-form-group"><label class="nl-label">Issue Number</label><input class="nl-input" name="issue_number" value="${esc(nl.issue_number||'')}"></div>
              <div class="nl-form-group"><label class="nl-label">Theme Color</label><input type="color" name="theme_color" value="${esc(nl.theme_color||'#4f46e5')}" style="width:100%;height:38px;border:1px solid #d1d5db;border-radius:8px;cursor:pointer"></div>
            </div>
            <div class="nl-form-group"><label class="nl-label">Cover Image</label><input class="nl-input" name="cover_image" value="${esc(nl.cover_image||'')}"></div>
            <div class="nl-form-group">
              <label class="nl-label">Content</label>
              <div class="nl-editor-toolbar">
                <button type="button" onclick="document.execCommand('bold')"><b>B</b></button>
                <button type="button" onclick="document.execCommand('italic')"><i>I</i></button>
                <button type="button" onclick="document.execCommand('underline')"><u>U</u></button>
                <button type="button" onclick="document.execCommand('insertUnorderedList')">• List</button>
                <button type="button" onclick="document.execCommand('formatBlock',false,'H2')">H2</button>
                <button type="button" onclick="document.execCommand('createLink',false,prompt('URL:'))">🔗 Link</button>
              </div>
              <div class="nl-editor-area" contenteditable="true" id="nl-editor">${nl.content||''}</div>
              <textarea name="content" id="content-hidden" style="display:none"></textarea>
            </div>
            <div style="display:flex;gap:8px">
              <button type="submit" class="nl-btn" name="action" value="save">Save Changes</button>
              ${nl.status==='draft'?`<button type="submit" class="nl-btn nl-btn-success" name="action" value="publish">Save & Publish</button>`:''}
              ${nl.status==='published'?`<a href="${PFX}/archive/${nl.id}" class="nl-btn nl-btn-secondary" onclick="return confirm('Archive this issue?')">Archive</a>`:''}
            </div>
          </form>
          <script>document.querySelector('form').addEventListener('submit',function(){document.getElementById('content-hidden').value=document.getElementById('nl-editor').innerHTML;});</script>
        </div>
      </div>
      <div>
        <div class="nl-card" style="margin-bottom:16px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="margin:0;font-size:1rem">📄 Articles (${articles.length})</h3>
            <a href="${PFX}/articles/create?nl=${nl.id}" class="nl-btn nl-btn-sm">+ Add Article</a>
          </div>
          ${articleCards||'<div class="nl-empty"><div class="nl-empty-icon">📝</div>No articles yet. Add your first article!</div>'}
        </div>
        <div class="nl-card">
          <h3 style="margin:0 0 10px;font-size:1rem">📊 Issue Stats</h3>
          <div style="font-size:.85rem;color:#6b7280">
            <p>Created: ${fmtDateTime(nl.created_at)}</p>
            <p>Published: ${fmtDateTime(nl.published_at)}</p>
            <p>Subscribers: ${Number(nl.subscriber_count||0).toLocaleString()}</p>
            <p>Reads: ${Number(nl.read_count||0).toLocaleString()}</p>
            <p>Clicks: ${Number(nl.click_count||0).toLocaleString()}</p>
            ${nl.scheduled_at?`<p>Scheduled: ${fmtDateTime(nl.scheduled_at)}</p>`:''}
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('newsletter-edit', pageWrap('Edit: ' + nl.title, body), req));
  }));

  app.post(PFX + '/edit/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const { title, subtitle, content, issue_number, theme_color, cover_image, action } = req.body;
    const nlId = req.params.id;
    if (action === 'publish') {
      await pool.query(`UPDATE newsletters SET title=?,subtitle=?,content=?,issue_number=?,theme_color=?,cover_image=?,status='published',published_at=NOW(),updated_at=NOW() WHERE id=? AND tenant_id=?`,
        [title, subtitle||'', content||'', issue_number||'', theme_color||'#4f46e5', cover_image||'', nlId, t]);
      const [subs] = await pool.query(`SELECT email, name FROM newsletter_subscribers WHERE tenant_id=? AND status='active'`, [t]);
      audit(req, 'newsletter_publish', { newsletter_id: nlId, title });
      queueEmail(t, 'newsletter_published', { newsletter_id: nlId, title, subscriber_emails: subs.map(s => s.email) });
    } else {
      await pool.query(`UPDATE newsletters SET title=?,subtitle=?,content=?,issue_number=?,theme_color=?,cover_image=?,updated_at=NOW() WHERE id=? AND tenant_id=?`,
        [title, subtitle||'', content||'', issue_number||'', theme_color||'#4f46e5', cover_image||'', nlId, t]);
      audit(req, 'newsletter_update', { newsletter_id: nlId });
    }
    res.redirect(PFX + '/edit/' + nlId);
  }));

  // ─── 4. ARTICLES CRUD ────────────────────────────────────────────────
  app.get(PFX + '/articles/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const nlId = req.query.nl;
    const [nls] = await pool.query(`SELECT id, title FROM newsletters WHERE tenant_id=? ${nlId?'AND id='+pool.escape(nlId):''} ORDER BY id DESC`, [t]);
    const [cats] = await pool.query(`SELECT * FROM newsletter_categories WHERE tenant_id IN (0,?) ORDER BY sort_order, name`, [t]);
    const catOpts = cats.map(c => `<option value="${esc(c.name)}">${esc(c.icon||'📰')} ${esc(c.name)}</option>`).join('');
    const nlOpts = nls.map(n => `<option value="${n.id}" ${n.id==nlId?'selected':''}>${esc(n.title)}</option>`).join('');
    const body = `
    <div class="nl-header"><h1>📝 Create Article</h1><a href="${nlId?PFX+'/edit/'+nlId:PFX+'/'}" class="nl-btn nl-btn-secondary">← Back</a></div>
    <div class="nl-grid nl-grid-2">
      <div class="nl-card">
        <form method="POST" action="${PFX}/articles/create">
          <div class="nl-form-group"><label class="nl-label">Newsletter *</label><select class="nl-select" name="newsletter_id" required><option value="">Select issue...</option>${nlOpts}</select></div>
          <div class="nl-form-group"><label class="nl-label">Article Title *</label><input class="nl-input" name="title" required maxlength="300"></div>
          <div class="nl-form-group"><label class="nl-label">Author</label><input class="nl-input" name="author" value="${esc(uname(req))}"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="nl-form-group"><label class="nl-label">Category</label><select class="nl-select" name="category">${catOpts}</select></div>
            <div class="nl-form-group"><label class="nl-label">Featured</label><select class="nl-select" name="featured"><option value="0">No</option><option value="1">Yes — Highlight</option></select></div>
          </div>
          <div class="nl-form-group"><label class="nl-label">Summary</label><textarea class="nl-textarea" name="summary" rows="2" placeholder="Brief summary for previews"></textarea></div>
          <div class="nl-form-group"><label class="nl-label">Image URL</label><input class="nl-input" name="image_url" placeholder="https://..."></div>
          <div class="nl-form-group">
            <label class="nl-label">Content</label>
            <div class="nl-editor-toolbar">
              <button type="button" onclick="document.execCommand('bold')"><b>B</b></button>
              <button type="button" onclick="document.execCommand('italic')"><i>I</i></button>
              <button type="button" onclick="document.execCommand('underline')"><u>U</u></button>
              <button type="button" onclick="document.execCommand('insertUnorderedList')">• List</button>
              <button type="button" onclick="document.execCommand('formatBlock',false,'H2')">H2</button>
              <button type="button" onclick="document.execCommand('createLink',false,prompt('URL:'))">🔗 Link</button>
              <button type="button" onclick="document.execCommand('insertImage',false,prompt('Image URL:'))">🖼️ Image</button>
            </div>
            <div class="nl-editor-area" contenteditable="true" id="nl-editor"></div>
            <textarea name="content" id="content-hidden" style="display:none"></textarea>
          </div>
          <div style="display:flex;gap:8px">
            <button type="submit" class="nl-btn" name="action" value="publish">Publish Article</button>
            <button type="submit" class="nl-btn nl-btn-secondary" name="action" value="draft">Save Draft</button>
          </div>
        </form>
        <script>document.querySelector('form').addEventListener('submit',function(){document.getElementById('content-hidden').value=document.getElementById('nl-editor').innerHTML;});</script>
      </div>
    </div>`;
    res.send(renderPage('article-create', pageWrap('Create Article', body), req));
  }));

  app.post(PFX + '/articles/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const { newsletter_id, title, content, summary, author, category, featured, image_url, action } = req.body;
    const status = action === 'publish' ? 'published' : 'draft';
    const wordCount = (content||'').replace(/<[^>]*>/g,'').split(/\s+/).filter(Boolean).length;
    const [result] = await pool.query(
      `INSERT INTO newsletter_articles (tenant_id, newsletter_id, title, content, summary, author, author_id, category, featured, image_url, word_count, status) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t, newsletter_id, title, content||'', summary||'', author||uname(req), uid(req), category||'General', featured==='1'?1:0, image_url||'', wordCount, status]
    );
    audit(req, 'newsletter_article_create', { title, newsletter_id });
    res.redirect(PFX + '/edit/' + newsletter_id);
  }));

  app.get(PFX + '/articles/edit/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const [articles] = await pool.query(`SELECT * FROM newsletter_articles WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    if (!articles[0]) return res.status(404).send('Article not found');
    const a = articles[0];
    const [cats] = await pool.query(`SELECT * FROM newsletter_categories WHERE tenant_id IN (0,?) ORDER BY sort_order, name`, [t]);
    const catOpts = cats.map(c => `<option value="${esc(c.name)}" ${c.name===a.category?'selected':''}>${esc(c.icon||'📰')} ${esc(c.name)}</option>`).join('');
    const body = `
    <div class="nl-header"><h1>✏️ Edit Article</h1><a href="${PFX}/edit/${a.newsletter_id}" class="nl-btn nl-btn-secondary">← Back to Issue</a></div>
    <div class="nl-card" style="max-width:800px">
      <form method="POST" action="${PFX}/articles/edit/${a.id}">
        <input type="hidden" name="newsletter_id" value="${a.newsletter_id}">
        <div class="nl-form-group"><label class="nl-label">Title *</label><input class="nl-input" name="title" value="${esc(a.title)}" required></div>
        <div class="nl-form-group"><label class="nl-label">Author</label><input class="nl-input" name="author" value="${esc(a.author||'')}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="nl-form-group"><label class="nl-label">Category</label><select class="nl-select" name="category">${catOpts}</select></div>
          <div class="nl-form-group"><label class="nl-label">Featured</label><select class="nl-select" name="featured"><option value="0" ${!a.featured?'selected':''}>No</option><option value="1" ${a.featured?'selected':''}>Yes</option></select></div>
        </div>
        <div class="nl-form-group"><label class="nl-label">Summary</label><textarea class="nl-textarea" name="summary" rows="2">${esc(a.summary||'')}</textarea></div>
        <div class="nl-form-group"><label class="nl-label">Image URL</label><input class="nl-input" name="image_url" value="${esc(a.image_url||'')}"></div>
        <div class="nl-form-group">
          <label class="nl-label">Content</label>
          <div class="nl-editor-toolbar">
            <button type="button" onclick="document.execCommand('bold')"><b>B</b></button>
            <button type="button" onclick="document.execCommand('italic')"><i>I</i></button>
            <button type="button" onclick="document.execCommand('underline')"><u>U</u></button>
            <button type="button" onclick="document.execCommand('insertUnorderedList')">• List</button>
            <button type="button" onclick="document.execCommand('formatBlock',false,'H2')">H2</button>
            <button type="button" onclick="document.execCommand('createLink',false,prompt('URL:'))">🔗 Link</button>
            <button type="button" onclick="document.execCommand('insertImage',false,prompt('Image URL:'))">🖼️ Image</button>
          </div>
          <div class="nl-editor-area" contenteditable="true" id="nl-editor">${a.content||''}</div>
          <textarea name="content" id="content-hidden" style="display:none"></textarea>
        </div>
        <div style="display:flex;gap:8px">
          <button type="submit" class="nl-btn">Save Changes</button>
          <a href="${PFX}/articles/delete/${a.id}?nl=${a.newsletter_id}" class="nl-btn nl-btn-danger" onclick="return confirm('Delete?')">Delete</a>
        </div>
      </form>
      <script>document.querySelector('form').addEventListener('submit',function(){document.getElementById('content-hidden').value=document.getElementById('nl-editor').innerHTML;});</script>
    </div>`;
    res.send(renderPage('article-edit', pageWrap('Edit: ' + a.title, body), req));
  }));

  app.post(PFX + '/articles/edit/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const { newsletter_id, title, content, summary, author, category, featured, image_url } = req.body;
    const wordCount = (content||'').replace(/<[^>]*>/g,'').split(/\s+/).filter(Boolean).length;
    await pool.query(
      `UPDATE newsletter_articles SET title=?, content=?, summary=?, author=?, category=?, featured=?, image_url=?, word_count=?, status='published', updated_at=NOW() WHERE id=? AND tenant_id=?`,
      [title, content||'', summary||'', author||'', category||'General', featured==='1'?1:0, image_url||'', wordCount, req.params.id, t]
    );
    audit(req, 'newsletter_article_update', { article_id: req.params.id });
    res.redirect(PFX + '/edit/' + newsletter_id);
  }));

  app.get(PFX + '/articles/delete/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const aId = req.params.id;
    const nlId = req.query.nl;
    await pool.query(`DELETE FROM newsletter_articles WHERE id=? AND tenant_id=?`, [aId, t]);
    audit(req, 'newsletter_article_delete', { article_id: aId });
    res.redirect(nlId ? PFX + '/edit/' + nlId : PFX + '/');
  }));

  app.get(PFX + '/articles/feature/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    await pool.query(`UPDATE newsletter_articles SET featured=1 WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    res.redirect(req.query.nl ? PFX + '/edit/' + req.query.nl : PFX + '/');
  }));

  app.get(PFX + '/articles/unfeature/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    await pool.query(`UPDATE newsletter_articles SET featured=0 WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    res.redirect(req.query.nl ? PFX + '/edit/' + req.query.nl : PFX + '/');
  }));

  // ─── 5. SUBSCRIBERS ──────────────────────────────────────────────────
  app.get(PFX + '/subscribers', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const search = req.query.q || '';
    const statusFilter = req.query.status || '';
    let where = `WHERE s.tenant_id=?`;
    const params = [t];
    if (search) { where += ` AND (s.email LIKE ? OR s.name LIKE ?)`; params.push('%'+search+'%', '%'+search+'%'); }
    if (statusFilter) { where += ` AND s.status=?`; params.push(statusFilter); }
    const [subs] = await pool.query(`SELECT s.* FROM newsletter_subscribers s ${where} ORDER BY s.subscribed_at DESC LIMIT 50`, params);
    const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM newsletter_subscribers s ${where}`, params);
    const [[{active}]] = await pool.query(`SELECT COUNT(*) AS active FROM newsletter_subscribers WHERE tenant_id=? AND status='active'`, [t]);
    const [[{unsub}]] = await pool.query(`SELECT COUNT(*) AS unsub FROM newsletter_subscribers WHERE tenant_id=? AND status='unsubscribed'`, [t]);
    const [[{bounced}]] = await pool.query(`SELECT COUNT(*) AS bounced FROM newsletter_subscribers WHERE tenant_id=? AND status='bounced'`, [t]);
    let rows = '';
    for (const s of subs) {
      const sBadge = s.status==='active'?'nl-chip-green':s.status==='unsubscribed'?'nl-chip-red':s.status==='bounced'?'nl-chip-red':'nl-chip-yellow';
      rows += `<tr>
        <td>${esc(s.name || '—')}</td>
        <td>${esc(s.email)}</td>
        <td><span class="nl-chip ${sBadge}">${s.status}</span></td>
        <td>${fmtDate(s.subscribed_at)}</td>
        <td>${Number(s.open_count||0).toLocaleString()}</td>
        <td style="white-space:nowrap">
          <a href="${PFX}/subscribers/toggle/${s.id}?status=${s.status==='active'?'unsubscribed':'active'}" class="nl-btn nl-btn-sm nl-btn-secondary">${s.status==='active'?'Unsub':'Resub'}</a>
          <a href="${PFX}/subscribers/delete/${s.id}" class="nl-btn nl-btn-sm nl-btn-danger" onclick="return confirm('Remove?')">✕</a>
        </td></tr>`;
    }
    const body = `
    <div class="nl-header"><h1>👥 Subscribers</h1>
      <div style="display:flex;gap:8px">
        ${isAdmin(req)?`<a href="${PFX}/subscribers/add" class="nl-btn">+ Add Subscriber</a>`:''}
        <a href="${PFX}/subscribers/import" class="nl-btn nl-btn-secondary">📥 Import CSV</a>
      </div>
    </div>
    <div class="nl-stats">
      <div class="nl-stat"><div class="nl-stat-num">${total}</div><div class="nl-stat-label">Total</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${active}</div><div class="nl-stat-label">Active</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${unsub}</div><div class="nl-stat-label">Unsubscribed</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${bounced}</div><div class="nl-stat-label">Bounced</div></div>
    </div>
    <div class="nl-card">
      <form method="GET" style="display:flex;gap:8px;margin-bottom:14px;flex-wrap:wrap">
        <input class="nl-input" name="q" value="${esc(search)}" placeholder="Search by name or email..." style="max-width:300px">
        <select class="nl-select" name="status" style="max-width:180px">
          <option value="">All Statuses</option>
          <option value="active" ${statusFilter==='active'?'selected':''}>Active</option>
          <option value="unsubscribed" ${statusFilter==='unsubscribed'?'selected':''}>Unsubscribed</option>
          <option value="bounced" ${statusFilter==='bounced'?'selected':''}>Bounced</option>
          <option value="pending" ${statusFilter==='pending'?'selected':''}>Pending</option>
        </select>
        <button type="submit" class="nl-btn nl-btn-sm">Search</button>
      </form>
      <table class="nl-table"><thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Subscribed</th><th>Opens</th><th>Actions</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:#9ca3af">No subscribers found</td></tr>'}</tbody></table>
    </div>`;
    res.send(renderPage('newsletter-subscribers', pageWrap('Newsletter Subscribers', body), req));
  }));

  app.get(PFX + '/subscribers/add', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/subscribers');
    const body = `
    <div class="nl-header"><h1>Add Subscriber</h1><a href="${PFX}/subscribers" class="nl-btn nl-btn-secondary">← Back</a></div>
    <div class="nl-card" style="max-width:500px">
      <form method="POST" action="${PFX}/subscribers/add">
        <div class="nl-form-group"><label class="nl-label">Name</label><input class="nl-input" name="name" maxlength="150"></div>
        <div class="nl-form-group"><label class="nl-label">Email *</label><input class="nl-input" name="email" type="email" required></div>
        <div class="nl-form-group"><label class="nl-label">Role</label><select class="nl-select" name="role">
          <option value="parent">Parent</option><option value="student">Student</option><option value="teacher">Teacher</option>
          <option value="staff">Staff</option><option value="alumni">Alumni</option><option value="external">External</option>
        </select></div>
        <button type="submit" class="nl-btn">Add Subscriber</button>
      </form>
    </div>`;
    res.send(renderPage('subscriber-add', pageWrap('Add Subscriber', body), req));
  }));

  app.post(PFX + '/subscribers/add', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/subscribers');
    const t = tid(req);
    const { name, email, role } = req.body;
    try {
      await pool.query(`INSERT INTO newsletter_subscribers (tenant_id, email, name, role, status) VALUES (?,?,?,?,?)`,
        [t, email, name||'', role||'external', 'active']);
      audit(req, 'newsletter_subscriber_add', { email });
    } catch(e) {
      // Duplicate — update status
      await pool.query(`UPDATE newsletter_subscribers SET status='active', name=?, role=?, unsubscribed_at=NULL WHERE tenant_id=? AND email=?`,
        [name||'', role||'external', t, email]);
    }
    res.redirect(PFX + '/subscribers');
  }));

  app.get(PFX + '/subscribers/import', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/subscribers');
    const body = `
    <div class="nl-header"><h1>📥 Import Subscribers</h1><a href="${PFX}/subscribers" class="nl-btn nl-btn-secondary">← Back</a></div>
    <div class="nl-card" style="max-width:600px">
      <p style="font-size:.85rem;color:#6b7280;margin-bottom:16px">Paste CSV data with columns: <strong>name, email, role</strong> (one per line).</p>
      <form method="POST" action="${PFX}/subscribers/import">
        <div class="nl-form-group"><label class="nl-label">CSV Data</label><textarea class="nl-textarea" name="csv" rows="8" placeholder="John Doe, john@example.com, parent&#10;Jane Smith, jane@example.com, teacher"></textarea></div>
        <button type="submit" class="nl-btn">Import</button>
      </form>
    </div>`;
    res.send(renderPage('subscriber-import', pageWrap('Import Subscribers', body), req));
  }));

  app.post(PFX + '/subscribers/import', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/subscribers');
    const t = tid(req);
    const lines = (req.body.csv||'').split('\n').filter(l => l.trim());
    let imported = 0;
    for (const line of lines) {
      const parts = line.split(',').map(s => s.trim());
      if (parts.length >= 2 && parts[1].includes('@')) {
        try {
          await pool.query(`INSERT INTO newsletter_subscribers (tenant_id, email, name, role, status) VALUES (?,?,?,?,?)`,
            [t, parts[1], parts[0]||'', parts[2]||'external', 'active']);
          imported++;
        } catch(e) { /* duplicate */ }
      }
    }
    audit(req, 'newsletter_subscribers_import', { count: imported });
    res.redirect(PFX + '/subscribers?msg=' + encodeURIComponent(imported + ' subscribers imported'));
  }));

  app.get(PFX + '/subscribers/toggle/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/subscribers');
    const t = tid(req);
    const newStatus = req.query.status === 'active' ? 'active' : 'unsubscribed';
    const unsubAt = newStatus === 'unsubscribed' ? now() : null;
    await pool.query(`UPDATE newsletter_subscribers SET status=?, unsubscribed_at=? WHERE id=? AND tenant_id=?`, [newStatus, unsubAt, req.params.id, t]);
    audit(req, 'newsletter_subscriber_toggle', { subscriber_id: req.params.id, status: newStatus });
    res.redirect(PFX + '/subscribers');
  }));

  app.get(PFX + '/subscribers/delete/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/subscribers');
    const t = tid(req);
    await pool.query(`DELETE FROM newsletter_subscribers WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    audit(req, 'newsletter_subscriber_delete', { subscriber_id: req.params.id });
    res.redirect(PFX + '/subscribers');
  }));

  // ─── 6. PREVIEW ──────────────────────────────────────────────────────
  app.get(PFX + '/preview/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const [nls] = await pool.query(`SELECT * FROM newsletters WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    if (!nls[0]) return res.status(404).send('Newsletter not found');
    const nl = nls[0];
    const [articles] = await pool.query(
      `SELECT * FROM newsletter_articles WHERE newsletter_id=? AND tenant_id=? AND status='published' ORDER BY featured DESC, sort_order`, [nl.id, t]
    );
    const shareUrl = (req.headers['x-forwarded-proto'] || 'https') + '://' + (req.headers.host || 'localhost') + PFX + '/preview/' + nl.id;
    let articleHtml = '';
    for (const a of articles) {
      articleHtml += `<div style="margin-bottom:24px;${a.featured?'border-left:4px solid '+esc(nl.theme_color||P)+';padding-left:16px':''}">
        ${a.image_url?`<img src="${esc(a.image_url)}" style="width:100%;max-height:250px;object-fit:cover;border-radius:8px;margin-bottom:10px" onerror="this.style.display='none'">`:''}
        ${a.featured?'<span class="nl-featured-star">★ Featured</span> ':''}
        <h3 style="margin:0 0 6px;font-size:1.1rem;color:#1f2937">${esc(a.title)}</h3>
        <p style="margin:0 0 4px;font-size:.8rem;color:#6b7280">By ${esc(a.author||'Unknown')} · ${esc(a.category)}</p>
        ${a.summary?`<p style="margin:0 0 8px;font-size:.88rem;color:#374151;font-style:italic">${esc(a.summary)}</p>`:''}
        <div style="font-size:.9rem;line-height:1.7;color:#374151">${a.content||''}</div>
      </div>`;
    }
    const body = `
    <div class="nl-header"><h1>👁 Preview: ${esc(nl.title)}</h1>
      <div style="display:flex;gap:8px">
        <a href="${PFX}/edit/${nl.id}" class="nl-btn nl-btn-sm nl-btn-secondary">← Edit</a>
        ${nl.status==='draft'?`<a href="${PFX}/publish/${nl.id}" class="nl-btn nl-btn-sm nl-btn-success" onclick="return confirm('Publish now?')">Publish</a>`:''}
        ${nl.status==='published'?`<a href="${PFX}/send/${nl.id}" class="nl-btn nl-btn-sm">📧 Send</a>`:''}
      </div>
    </div>
    <div class="nl-card" style="max-width:700px;margin:0 auto">
      ${nl.cover_image?`<div class="nl-cover" style="height:220px;margin-bottom:20px"><img src="${esc(nl.cover_image)}" onerror="this.parentElement.innerHTML='${esc(nl.title)}'"></div>`:''}
      <div style="text-align:center;margin-bottom:20px">
        <h1 style="margin:0 0 4px;font-size:1.5rem;color:${esc(nl.theme_color||P)}">${esc(nl.title)}</h1>
        ${nl.subtitle?`<p style="margin:0;font-size:.95rem;color:#6b7280">${esc(nl.subtitle)}</p>`:''}
        <div style="margin-top:8px;font-size:.8rem;color:#9ca3af">
          ${esc(nl.issue_number||'')} · ${fmtDate(nl.published_at)} · ${Number(nl.read_count||0).toLocaleString()} reads
        </div>
      </div>
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">
      ${nl.content?`<div style="margin-bottom:20px;font-size:.9rem;line-height:1.7">${nl.content}</div><hr style="border:none;border-top:1px solid #e5e7eb;margin:16px 0">`:''}
      ${articleHtml||'<div class="nl-empty">No articles in this issue</div>'}
      <hr style="border:none;border-top:1px solid #e5e7eb;margin:20px 0">
      <div>
        <p style="font-size:.82rem;color:#6b7280;margin:0 0 8px"><strong>Share this newsletter:</strong></p>
        <div class="nl-share-btns">
          <a class="nl-share-btn nl-share-fb" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener">📘 Facebook</a>
          <a class="nl-share-btn nl-share-tw" href="https://twitter.com/intent/tweet?url=${encodeURIComponent(shareUrl)}&text=${encodeURIComponent(nl.title)}" target="_blank" rel="noopener">🐦 Twitter</a>
          <a class="nl-share-btn nl-share-li" href="https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(shareUrl)}" target="_blank" rel="noopener">💼 LinkedIn</a>
          <a class="nl-share-btn nl-share-wa" href="https://wa.me/?text=${encodeURIComponent(nl.title+' '+shareUrl)}" target="_blank" rel="noopener">💬 WhatsApp</a>
          <button class="nl-share-btn nl-share-copy" onclick="navigator.clipboard.writeText('${shareUrl}');this.textContent='Copied!'">📋 Copy Link</button>
        </div>
      </div>
      ${nl.social_fb||nl.social_tw||nl.social_li?`<div style="margin-top:12px;font-size:.78rem;color:#9ca3af">
        Follow us: ${nl.social_fb?`<a href="${esc(nl.social_fb)}" target="_blank" style="color:#4f46e5">Facebook</a> `:''}
        ${nl.social_tw?`<a href="${esc(nl.social_tw)}" target="_blank" style="color:#4f46e5">Twitter</a> `:''}
        ${nl.social_li?`<a href="${esc(nl.social_li)}" target="_blank" style="color:#4f46e5">LinkedIn</a>`:''}
      </div>`:''}
    </div>`;
    res.send(renderPage('newsletter-preview', pageWrap('Preview: ' + nl.title, body), req));
  }));

  // ─── 7. PUBLISH ──────────────────────────────────────────────────────
  app.get(PFX + '/publish/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const nlId = req.params.id;
    await pool.query(`UPDATE newsletters SET status='published', published_at=NOW(), updated_at=NOW() WHERE id=? AND tenant_id=? AND status IN ('draft','scheduled')`, [nlId, t]);
    const [subs] = await pool.query(`SELECT email, name FROM newsletter_subscribers WHERE tenant_id=? AND status='active'`, [t]);
    const [nls] = await pool.query(`SELECT title FROM newsletters WHERE id=?`, [nlId]);
    audit(req, 'newsletter_publish', { newsletter_id: nlId });
    if (nls[0]) {
      queueEmail(t, 'newsletter_published', { newsletter_id: nlId, title: nls[0].title, subscriber_count: subs.length });
    }
    res.redirect(PFX + '/edit/' + nlId);
  }));

  // ─── 8. SEND TO SUBSCRIBERS ──────────────────────────────────────────
  app.get(PFX + '/send/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const nlId = req.params.id;
    const [nls] = await pool.query(`SELECT * FROM newsletters WHERE id=? AND tenant_id=? AND status='published'`, [nlId, t]);
    if (!nls[0]) return res.status(404).send('Newsletter not found or not published');
    const [subs] = await pool.query(`SELECT COUNT(*) AS cnt FROM newsletter_subscribers WHERE tenant_id=? AND status='active'`, [t]);
    const nl = nls[0];
    const body = `
    <div class="nl-header"><h1>📧 Send Newsletter</h1><a href="${PFX}/edit/${nl.id}" class="nl-btn nl-btn-secondary">← Back</a></div>
    <div class="nl-card" style="max-width:500px;text-align:center">
      <div class="nl-cover" style="margin-bottom:16px;font-size:1rem">${esc(nl.title)}</div>
      <h2 style="margin:0 0 8px">Confirm Delivery</h2>
      <p style="color:#6b7280;margin:0 0 4px">You are about to send this newsletter to <strong>${subs[0].cnt}</strong> active subscribers.</p>
      <p style="color:#6b7280;margin:0 0 20px;font-size:.82rem">This action will trigger email delivery to all active subscribers.</p>
      <form method="POST" action="${PFX}/send/${nl.id}">
        <div style="display:flex;gap:8px;justify-content:center">
          <button type="submit" class="nl-btn" style="background:#059669">📧 Send Now</button>
          <a href="${PFX}/edit/${nl.id}" class="nl-btn nl-btn-secondary">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage('newsletter-send', pageWrap('Send Newsletter', body), req));
  }));

  app.post(PFX + '/send/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const nlId = req.params.id;
    const [nls] = await pool.query(`SELECT * FROM newsletters WHERE id=? AND tenant_id=?`, [nlId, t]);
    if (!nls[0]) return res.redirect(PFX + '/');
    const nl = nls[0];
    await pool.query(`UPDATE newsletters SET status='sending', updated_at=NOW() WHERE id=? AND tenant_id=?`, [nlId, t]);
    const [subs] = await pool.query(`SELECT id, email, name FROM newsletter_subscribers WHERE tenant_id=? AND status='active'`, [t]);
    let sent = 0;
    for (const sub of subs) {
      queueEmail(t, 'newsletter_delivery', {
        newsletter_id: nlId,
        title: nl.title,
        email: sub.email,
        name: sub.name,
        content: nl.content,
        articles_count: 0
      });
      sent++;
    }
    await pool.query(`UPDATE newsletters SET status='published', subscriber_count=?, updated_at=NOW() WHERE id=? AND tenant_id=?`, [sent, nlId, t]);
    audit(req, 'newsletter_send', { newsletter_id: nlId, sent_count: sent });
    res.redirect(PFX + '/edit/' + nlId);
  }));

  // ─── 9. ARCHIVE ──────────────────────────────────────────────────────
  app.get(PFX + '/archive', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const statusFilter = req.query.status || '';
    const search = req.query.q || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;
    let where = `WHERE n.tenant_id=?`;
    const params = [t];
    if (statusFilter) { where += ` AND n.status=?`; params.push(statusFilter); }
    if (search) { where += ` AND n.title LIKE ?`; params.push('%'+search+'%'); }
    const [nls] = await pool.query(`SELECT n.* FROM newsletters n ${where} ORDER BY n.published_at DESC, n.created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM newsletters n ${where}`, params);
    const totalPages = Math.ceil(total / limit);
    let cards = '';
    for (const nl of nls) {
      const readPct = nl.subscriber_count > 0 ? Math.round((nl.read_count / nl.subscriber_count) * 100) : 0;
      cards += `<div class="nl-article-card" style="background:#fff">
        <div class="nl-cover" style="height:100px;font-size:.9rem;${nl.cover_image?'':('background:linear-gradient(135deg,'+esc(nl.theme_color||P)+',#06b6d4)')}">
          ${nl.cover_image?`<img src="${esc(nl.cover_image)}" onerror="this.parentElement.textContent='${esc(nl.title)}'">`:esc(nl.issue_number||nl.title)}
        </div>
        <div style="padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
            <strong style="font-size:.95rem">${esc(nl.title)}</strong>
            ${statusBadge(nl.status)}
          </div>
          <p style="margin:0 0 6px;font-size:.8rem;color:#6b7280">${esc(nl.subtitle||'')} · ${fmtDate(nl.published_at)}</p>
          <div class="nl-bar" style="margin-bottom:8px"><div class="nl-bar-fill" style="width:${Math.min(readPct,100)}%"></div></div>
          <div style="font-size:.75rem;color:#6b7280;margin-bottom:8px">${readPct}% read · ${Number(nl.read_count||0).toLocaleString()} / ${Number(nl.subscriber_count||0).toLocaleString()} subscribers</div>
          <div style="display:flex;gap:6px">
            <a href="${PFX}/preview/${nl.id}" class="nl-btn nl-btn-sm nl-btn-secondary">View</a>
            ${isAdmin(req)&&nl.status!=='archived'?`<a href="${PFX}/archive/${nl.id}" class="nl-btn nl-btn-sm nl-btn-secondary" onclick="return confirm('Archive?')">Archive</a>`:''}
          </div>
        </div></div>`;
    }
    const pagination = totalPages > 1 ? `<div class="nl-pagination">${Array.from({length:totalPages},(_,i)=>`<a href="?page=${i+1}&status=${esc(statusFilter)}&q=${esc(search)}" class="nl-btn nl-btn-sm ${i+1===page?'':'nl-btn-secondary'}" ${i+1===page?'style="background:'+P+';color:#fff"':''}>${i+1}</a>`).join('')}</div>` : '';
    const body = `
    <div class="nl-header"><h1>📚 Newsletter Archive</h1>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="${PFX}/archive?status=draft" class="nl-btn nl-btn-sm ${statusFilter==='draft'?'':'nl-btn-secondary'}" ${statusFilter==='draft'?'style="background:'+P+';color:#fff"':''}>Drafts</a>
        <a href="${PFX}/archive?status=published" class="nl-btn nl-btn-sm ${statusFilter==='published'?'':'nl-btn-secondary'}" ${statusFilter==='published'?'style="background:'+P+';color:#fff"':''}>Published</a>
        <a href="${PFX}/archive?status=archived" class="nl-btn nl-btn-sm ${statusFilter==='archived'?'':'nl-btn-secondary'}" ${statusFilter==='archived'?'style="background:'+P+';color:#fff"':''}>Archived</a>
        <a href="${PFX}/archive" class="nl-btn nl-btn-sm nl-btn-secondary">All</a>
      </div>
    </div>
    <form method="GET" style="margin-bottom:16px"><input class="nl-input" name="q" value="${esc(search)}" placeholder="Search newsletters..." style="max-width:400px"></form>
    <div class="nl-grid nl-grid-3">${cards||'<div class="nl-empty" style="grid-column:1/-1"><div class="nl-empty-icon">📚</div>No newsletters found</div>'}</div>
    ${pagination}`;
    res.send(renderPage('newsletter-archive', pageWrap('Newsletter Archive', body), req));
  }));

  app.get(PFX + '/archive/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    await pool.query(`UPDATE newsletters SET status='archived', updated_at=NOW() WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    audit(req, 'newsletter_archive', { newsletter_id: req.params.id });
    res.redirect(PFX + '/archive');
  }));

  // ─── 10. ANALYTICS ───────────────────────────────────────────────────
  app.get(PFX + '/analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const [[overview]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM newsletters WHERE tenant_id=? AND status='published') AS published,
        (SELECT COALESCE(SUM(read_count),0) FROM newsletters WHERE tenant_id=?) AS total_reads,
        (SELECT COALESCE(SUM(click_count),0) FROM newsletters WHERE tenant_id=?) AS total_clicks,
        (SELECT COUNT(*) FROM newsletter_subscribers WHERE tenant_id=? AND status='active') AS active_subs,
        (SELECT COUNT(*) FROM newsletter_articles WHERE tenant_id=? AND status='published') AS total_articles,
        (SELECT COUNT(DISTINCT subscriber_id) FROM newsletter_reads WHERE tenant_id=?) AS unique_readers`,
      [t, t, t, t, t, t]
    );
    const [topNewsletters] = await pool.query(
      `SELECT * FROM newsletters WHERE tenant_id=? AND status='published' ORDER BY read_count DESC LIMIT 5`, [t]
    );
    const [topArticles] = await pool.query(
      `SELECT na.*, n.title AS newsletter_title FROM newsletter_articles na
       JOIN newsletters n ON n.id = na.newsletter_id
       WHERE na.tenant_id=? AND na.status='published' ORDER BY na.read_count DESC LIMIT 5`, [t]
    );
    const [recentReads] = await pool.query(
      `SELECT nr.*, s.name AS subscriber_name FROM newsletter_reads nr
       LEFT JOIN newsletter_subscribers s ON s.id = nr.subscriber_id
       WHERE nr.tenant_id=? ORDER BY nr.read_at DESC LIMIT 10`, [t]
    );
    const [catStats] = await pool.query(
      `SELECT category, COUNT(*) AS cnt, SUM(read_count) AS total_reads FROM newsletter_articles WHERE tenant_id=? AND status='published' GROUP BY category ORDER BY cnt DESC`, [t]
    );
    const avgReadRate = overview.active_subs > 0 ? Math.round((overview.unique_readers / overview.active_subs) * 100) : 0;
    let nlRows = '';
    for (const nl of topNewsletters) {
      const rate = nl.subscriber_count > 0 ? Math.round((nl.read_count / nl.subscriber_count) * 100) : 0;
      nlRows += `<tr><td><strong>${esc(nl.title)}</strong></td><td>${fmtDate(nl.published_at)}</td><td>${Number(nl.read_count||0).toLocaleString()}</td><td>${Number(nl.click_count||0).toLocaleString()}</td>
        <td><div class="nl-bar" style="width:100px;display:inline-block"><div class="nl-bar-fill" style="width:${Math.min(rate,100)}%"></div></div> ${rate}%</td></tr>`;
    }
    let artRows = '';
    for (const a of topArticles) {
      artRows += `<tr><td>${a.featured?'<span class="nl-featured-star">★</span> ':''}<strong>${esc(a.title)}</strong></td><td>${esc(a.category)}</td><td>${esc(a.author||'—')}</td><td>${Number(a.read_count||0).toLocaleString()}</td></tr>`;
    }
    let readRows = '';
    for (const r of recentReads) {
      readRows += `<tr><td>${esc(r.subscriber_name||'Anonymous')}</td><td>${esc(r.email||'—')}</td><td>${fmtDateTime(r.read_at)}</td></tr>`;
    }
    let catBars = '';
    for (const c of catStats) {
      catBars += `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:.8rem;width:120px;flex-shrink:0">${esc(c.category)}</span>
        <div class="nl-bar" style="flex:1"><div class="nl-bar-fill" style="width:${Math.min((c.cnt/Math.max(catStats[0]?.cnt||1))*100,100)}%"></div></div>
        <span style="font-size:.75rem;color:#6b7280;width:50px;text-align:right">${c.cnt}</span>
      </div>`;
    }
    const body = `
    <div class="nl-header"><h1>📊 Newsletter Analytics</h1></div>
    <div class="nl-stats">
      <div class="nl-stat"><div class="nl-stat-num">${overview.published}</div><div class="nl-stat-label">Published Issues</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${Number(overview.total_reads||0).toLocaleString()}</div><div class="nl-stat-label">Total Reads</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${Number(overview.total_clicks||0).toLocaleString()}</div><div class="nl-stat-label">Total Clicks</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${overview.active_subs}</div><div class="nl-stat-label">Active Subscribers</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${avgReadRate}%</div><div class="nl-stat-label">Read Rate</div></div>
      <div class="nl-stat"><div class="nl-stat-num">${overview.unique_readers}</div><div class="nl-stat-label">Unique Readers</div></div>
    </div>
    <div class="nl-grid nl-grid-2">
      <div class="nl-card">
        <h2 style="margin:0 0 12px;font-size:1.05rem">📰 Top Performing Issues</h2>
        <table class="nl-table"><thead><tr><th>Title</th><th>Published</th><th>Reads</th><th>Clicks</th><th>Rate</th></tr></thead>
        <tbody>${nlRows||'<tr><td colspan="5" style="text-align:center;color:#9ca3af">No data</td></tr>'}</tbody></table>
      </div>
      <div>
        <div class="nl-card" style="margin-bottom:16px">
          <h2 style="margin:0 0 12px;font-size:1.05rem">📄 Top Articles</h2>
          <table class="nl-table"><thead><tr><th>Title</th><th>Category</th><th>Author</th><th>Reads</th></tr></thead>
          <tbody>${artRows||'<tr><td colspan="4" style="text-align:center;color:#9ca3af">No data</td></tr>'}</tbody></table>
        </div>
        <div class="nl-card">
          <h2 style="margin:0 0 12px;font-size:1.05rem">📂 Articles by Category</h2>
          ${catBars||'<div class="nl-empty">No data</div>'}
        </div>
      </div>
    </div>
    <div class="nl-card" style="margin-top:16px">
      <h2 style="margin:0 0 12px;font-size:1.05rem">👁 Recent Reads</h2>
      <table class="nl-table"><thead><tr><th>Subscriber</th><th>Email</th><th>Read At</th></tr></thead>
      <tbody>${readRows||'<tr><td colspan="3" style="text-align:center;color:#9ca3af">No reads recorded yet</td></tr>'}</tbody></table>
    </div>`;
    res.send(renderPage('newsletter-analytics', pageWrap('Newsletter Analytics', body), req));
  }));

  // ─── 11. CATEGORIES ──────────────────────────────────────────────────
  app.get(PFX + '/categories', requireAuth, requireNotBanned, ah(async (req, res) => {
    const t = tid(req);
    const [cats] = await pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM newsletter_articles na WHERE na.tenant_id=c.tenant_id AND na.category=c.name) AS article_count
       FROM newsletter_categories c WHERE c.tenant_id IN (0,?) ORDER BY c.sort_order, c.name`, [t]
    );
    let rows = '';
    for (const c of cats) {
      rows += `<tr>
        <td style="font-size:1.2rem">${esc(c.icon||'📰')}</td>
        <td><strong>${esc(c.name)}</strong></td>
        <td><span style="display:inline-block;width:16px;height:16px;border-radius:4px;background:${esc(c.color||'#4f46e5')}"></span></td>
        <td>${c.article_count}</td>
        <td>${c.tenant_id===0?'<span class="nl-chip">System</span>':`<div style="display:flex;gap:4px">
          <a href="${PFX}/categories/edit/${c.id}" class="nl-btn nl-btn-sm nl-btn-secondary">Edit</a>
          <a href="${PFX}/categories/delete/${c.id}" class="nl-btn nl-btn-sm nl-btn-danger" onclick="return confirm('Delete category?')">✕</a>
        </div>`}</td></tr>`;
    }
    const body = `
    <div class="nl-header"><h1>📂 Categories</h1>${isAdmin(req)?'<a href="'+PFX+'/categories/create" class="nl-btn">+ New Category</a>':''}</div>
    <div class="nl-card">
      <table class="nl-table"><thead><tr><th>Icon</th><th>Name</th><th>Color</th><th>Articles</th><th>Actions</th></tr></thead>
      <tbody>${rows||'<tr><td colspan="5" style="text-align:center;color:#9ca3af">No categories</td></tr>'}</tbody></table>
    </div>`;
    res.send(renderPage('newsletter-categories', pageWrap('Newsletter Categories', body), req));
  }));

  app.get(PFX + '/categories/create', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/categories');
    const body = `
    <div class="nl-header"><h1>New Category</h1><a href="${PFX}/categories" class="nl-btn nl-btn-secondary">← Back</a></div>
    <div class="nl-card" style="max-width:500px">
      <form method="POST" action="${PFX}/categories/create">
        <div class="nl-form-group"><label class="nl-label">Icon (emoji)</label><input class="nl-input" name="icon" maxlength="10" value="📰"></div>
        <div class="nl-form-group"><label class="nl-label">Name *</label><input class="nl-input" name="name" required maxlength="100"></div>
        <div class="nl-form-group"><label class="nl-label">Color</label><input type="color" name="color" value="#4f46e5" style="width:100%;height:38px;border:1px solid #d1d5db;border-radius:8px;cursor:pointer"></div>
        <button type="submit" class="nl-btn">Create Category</button>
      </form>
    </div>`;
    res.send(renderPage('category-create', pageWrap('New Category', body), req));
  }));

  app.post(PFX + '/categories/create', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/categories');
    const t = tid(req);
    const { name, icon, color } = req.body;
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');
    await pool.query(`INSERT INTO newsletter_categories (tenant_id, name, slug, icon, color) VALUES (?,?,?,?,?)`, [t, name, slug, icon||'📰', color||'#4f46e5']);
    audit(req, 'newsletter_category_create', { name });
    res.redirect(PFX + '/categories');
  }));

  app.get(PFX + '/categories/edit/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/categories');
    const t = tid(req);
    const [cats] = await pool.query(`SELECT * FROM newsletter_categories WHERE id=? AND tenant_id IN (0,?)`, [req.params.id, t]);
    if (!cats[0] || cats[0].tenant_id === 0) return res.redirect(PFX + '/categories');
    const c = cats[0];
    const body = `
    <div class="nl-header"><h1>Edit Category</h1><a href="${PFX}/categories" class="nl-btn nl-btn-secondary">← Back</a></div>
    <div class="nl-card" style="max-width:500px">
      <form method="POST" action="${PFX}/categories/edit/${c.id}">
        <div class="nl-form-group"><label class="nl-label">Icon</label><input class="nl-input" name="icon" value="${esc(c.icon||'📰')}" maxlength="10"></div>
        <div class="nl-form-group"><label class="nl-label">Name *</label><input class="nl-input" name="name" value="${esc(c.name)}" required></div>
        <div class="nl-form-group"><label class="nl-label">Color</label><input type="color" name="color" value="${esc(c.color||'#4f46e5')}" style="width:100%;height:38px;border:1px solid #d1d5db;border-radius:8px;cursor:pointer"></div>
        <button type="submit" class="nl-btn">Save</button>
      </form>
    </div>`;
    res.send(renderPage('category-edit', pageWrap('Edit Category', body), req));
  }));

  app.post(PFX + '/categories/edit/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/categories');
    const { name, icon, color } = req.body;
    await pool.query(`UPDATE newsletter_categories SET name=?, icon=?, color=? WHERE id=?`, [name, icon||'📰', color||'#4f46e5', req.params.id]);
    audit(req, 'newsletter_category_update', { id: req.params.id });
    res.redirect(PFX + '/categories');
  }));

  app.get(PFX + '/categories/delete/:id', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.redirect(PFX + '/categories');
    await pool.query(`DELETE FROM newsletter_categories WHERE id=? AND tenant_id != 0`, [req.params.id]);
    audit(req, 'newsletter_category_delete', { id: req.params.id });
    res.redirect(PFX + '/categories');
  }));

  // ─── 12. PUBLIC READ TRACKING ─────────────────────────────────────────
  app.get(PFX + '/read/:id/:subId', ah(async (req, res) => {
    try {
      const nlId = req.params.id;
      const subId = req.params.subId;
      const ip = req.ip || req.connection?.remoteAddress || '';
      const ua = req.headers['user-agent'] || '';
      await pool.query(
        `INSERT IGNORE INTO newsletter_reads (tenant_id, newsletter_id, subscriber_id, email, ip_address, user_agent)
         SELECT tenant_id, ?, ?, email, ?, ? FROM newsletter_subscribers WHERE id=?`,
        [nlId, subId, ip, ua, subId]
      );
      await pool.query(`UPDATE newsletters SET read_count=read_count+1 WHERE id=?`, [nlId]);
      await pool.query(`UPDATE newsletter_subscribers SET open_count=open_count+1, last_opened=NOW() WHERE id=?`, [subId]);
    } catch(e) { /* silent */ }
    res.type('png').send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==','base64'));
  }));

  // ─── 13. PUBLIC UNSUBSCRIBE ──────────────────────────────────────────
  app.get(PFX + '/unsubscribe/:email', ah(async (req, res) => {
    const email = decodeURIComponent(req.params.email);
    const [subs] = await pool.query(`SELECT * FROM newsletter_subscribers WHERE email=? LIMIT 1`, [email]);
    if (req.method === 'GET' && !req.query.confirm) {
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribe</title></head><body style="font-family:sans-serif;max-width:500px;margin:60px auto;padding:20px;text-align:center">
        <h1>📧 Unsubscribe</h1><p>Are you sure you want to unsubscribe <strong>${esc(email)}</strong> from our newsletter?</p>
        <a href="${PFX}/unsubscribe/${encodeURIComponent(email)}?confirm=1" style="display:inline-block;padding:10px 24px;background:#4f46e5;color:#fff;border-radius:8px;text-decoration:none;margin:12px 6px">Yes, Unsubscribe</a>
        <a href="/" style="display:inline-block;padding:10px 24px;background:#f3f4f6;color:#374151;border-radius:8px;text-decoration:none;margin:12px 6px">Cancel</a>
      </body></html>`);
      return;
    }
    await pool.query(`UPDATE newsletter_subscribers SET status='unsubscribed', unsubscribed_at=NOW() WHERE email=?`, [email]);
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Unsubscribed</title></head><body style="font-family:sans-serif;max-width:500px;margin:60px auto;padding:20px;text-align:center">
      <h1>✅ Unsubscribed</h1><p>${esc(email)} has been unsubscribed from our newsletter.</p>
      <a href="/" style="color:#4f46e5">Return to School Portal</a>
    </body></html>`);
  }));

  // ─── 14. API: Article reorder (AJAX) ─────────────────────────────────
  app.post(PFX + '/api/articles/reorder', requireAuth, ah(async (req, res) => {
    if (!isAdmin(req)) return res.json({ error: 'Unauthorized' });
    const t = tid(req);
    const { orders } = req.body; // [{id, sort_order}]
    if (!Array.isArray(orders)) return res.json({ error: 'Invalid data' });
    for (const item of orders) {
      await pool.query(`UPDATE newsletter_articles SET sort_order=? WHERE id=? AND tenant_id=?`, [item.sort_order, item.id, t]);
    }
    res.json({ success: true });
  }));

  // ─── 15. API: Stats summary (for widgets) ───────────────────────────
  app.get(PFX + '/api/stats', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const [[stats]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM newsletters WHERE tenant_id=? AND status='published') AS published,
        (SELECT COUNT(*) FROM newsletter_subscribers WHERE tenant_id=? AND status='active') AS subscribers,
        (SELECT COALESCE(SUM(read_count),0) FROM newsletters WHERE tenant_id=?) AS total_reads,
        (SELECT COUNT(*) FROM newsletter_articles WHERE tenant_id=? AND featured=1 AND status='published') AS featured_articles`,
      [t, t, t, t]
    );
    res.json(stats);
  }));

  console.log('[Newsletter] Module loaded — /school/newsletter/');
};
