// ============================================================
// LIBRARY MANAGEMENT MODULE — Multi-Tenant SaaS Platform
// Full library system: book catalog, lending, returns, fines,
// reservations, overdue tracking, and reporting.
// ============================================================
// Usage in server.js:
//   const library = require('./library');
//   library(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

module.exports = function library(app, db, pool, renderPage, esc) {

  // ── inline fallbacks ──────────────────────────────────────
  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtMoney = (n) => '$' + Number(n || 0).toFixed(2);
  const FINE_PER_DAY = 0.50;

  // ── helper badges ─────────────────────────────────────────
  function availBadge(available, total) {
    if (!total || total <= 0) return '<span class="badge badge-warning">No Copies</span>';
    if (available <= 0) return '<span class="badge badge-warning" style="background:#fee2e2;color:#dc2626">All Borrowed</span>';
    if (available <= 2) return '<span class="badge badge-warning" style="background:#fef3c7;color:#b45309">' + available + ' Left</span>';
    return '<span class="badge badge-success">' + available + ' / ' + total + '</span>';
  }

  function statusBadge(s) {
    const map = {
      borrowed: { bg: '#dbeafe', c: '#1d4ed8', l: 'Borrowed' },
      returned: { bg: '#dcfce7', c: '#16a34a', l: 'Returned' },
      overdue:  { bg: '#fee2e2', c: '#dc2626', l: 'Overdue' },
      waiting:  { bg: '#fef3c7', c: '#b45309', l: 'Waiting' },
      fulfilled:{ bg: '#dcfce7', c: '#16a34a', l: 'Fulfilled' },
      cancelled:{ bg: '#f1f5f9', c: '#64748b', l: 'Cancelled' }
    };
    const v = map[s] || { bg: '#f1f5f9', c: '#64748b', l: s || '—' };
    return '<span class="badge" style="background:' + v.bg + ';color:' + v.c + '">' + v.l + '</span>';
  }

  function dueWarning(dueDate) {
    if (!dueDate) return '';
    const now = new Date(); now.setHours(0, 0, 0, 0);
    const due = new Date(dueDate); due.setHours(0, 0, 0, 0);
    const diff = Math.ceil((due - now) / 86400000);
    if (diff < 0) return '<span style="color:#dc2626;font-weight:700;font-size:12px">⚠ ' + Math.abs(diff) + ' days overdue</span>';
    if (diff === 0) return '<span style="color:#f59e0b;font-weight:700;font-size:12px">⏰ Due today</span>';
    if (diff <= 3) return '<span style="color:#f59e0b;font-weight:600;font-size:12px">Due in ' + diff + ' day' + (diff > 1 ? 's' : '') + '</span>';
    return '<span class="muted" style="font-size:12px">' + diff + ' days left</span>';
  }

  // ── CSS ───────────────────────────────────────────────────
  const LIB_CSS = '<style>\n\
.lib-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}\n\
.lib-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}\n\
.lib-nav a:hover{background:#e2e8f0}.lib-nav a.active{background:#4f46e5;color:#fff}\n\
.lib-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}\n\
.lib-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}\n\
.lib-filter input,.lib-filter select{padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}\n\
.lib-filter input:focus,.lib-filter select:focus{outline:none;border-color:#6366f1}\n\
.lib-tbl{width:100%;border-collapse:collapse;font-size:13px}\n\
.lib-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}\n\
.lib-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}\n\
.lib-tbl tr:hover{background:#f8fafc}\n\
.lib-tbl tr.overdue-row{background:#fff5f5}.lib-tbl tr.overdue-row:hover{background:#fee2e2}\n\
.book-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;transition:.15s;display:flex;gap:14px;align-items:flex-start}\n\
.book-card:hover{box-shadow:0 2px 12px rgba(0,0,0,.06)}\n\
.book-cover{width:80px;height:110px;border-radius:8px;object-fit:cover;background:#f1f5f9;display:flex;align-items:center;justify-content:center;font-size:32px;flex-shrink:0}\n\
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}\n\
.form-grid .full{grid-column:1/-1}\n\
.form-grid label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}\n\
.form-grid input,.form-grid select,.form-grid textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}\n\
.form-grid input:focus,.form-grid select:focus,.form-grid textarea:focus{outline:none;border-color:#6366f1}\n\
.res-queue{border-left:3px solid #e2e8f0;padding-left:16px;margin:8px 0}\n\
.res-queue-item{padding:10px 14px;background:#f8fafc;border-radius:10px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center}\n\
@media(max-width:768px){.form-grid{grid-template-columns:1fr}.lib-filter{flex-direction:column}}\n\
</style>';

  // ── MIGRATIONS ────────────────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS books (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL, author VARCHAR(255), isbn VARCHAR(20),
      publisher VARCHAR(255), year INTEGER, category VARCHAR(100),
      total_copies INTEGER DEFAULT 1, available_copies INTEGER DEFAULT 1,
      location VARCHAR(100), description TEXT, cover_url TEXT,
      is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS book_lending (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      member_id INTEGER, member_name VARCHAR(255) NOT NULL,
      borrow_date DATE NOT NULL, due_date DATE NOT NULL,
      return_date DATE, status VARCHAR(20) DEFAULT 'borrowed',
      fine_amount NUMERIC(8,2) DEFAULT 0, fine_paid BOOLEAN DEFAULT false,
      notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS book_reservations (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      book_id INTEGER NOT NULL REFERENCES books(id) ON DELETE CASCADE,
      member_name VARCHAR(255), priority INTEGER DEFAULT 1,
      status VARCHAR(20) DEFAULT 'waiting', created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE — books)
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS author VARCHAR(255)`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS isbn VARCHAR(20)`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS publisher VARCHAR(255)`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS year INTEGER`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS category VARCHAR(100)`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS total_copies INTEGER DEFAULT 1`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS available_copies INTEGER DEFAULT 1`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS location VARCHAR(100)`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS cover_url TEXT`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,
    `ALTER TABLE IF EXISTS books ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`,
    // ALTER TABLE — book_lending
    `ALTER TABLE IF EXISTS book_lending ADD COLUMN IF NOT EXISTS member_id INTEGER`,
    `ALTER TABLE IF EXISTS book_lending ADD COLUMN IF NOT EXISTS member_name VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS book_lending ADD COLUMN IF NOT EXISTS borrow_date DATE`,
    `ALTER TABLE IF EXISTS book_lending ADD COLUMN IF NOT EXISTS due_date DATE`,
    `ALTER TABLE IF EXISTS book_lending ADD COLUMN IF NOT EXISTS return_date DATE`,
    `ALTER TABLE IF EXISTS book_lending ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'borrowed'`,
    `ALTER TABLE IF EXISTS book_lending ADD COLUMN IF NOT EXISTS fine_amount NUMERIC(8,2) DEFAULT 0`,
    `ALTER TABLE IF EXISTS book_lending ADD COLUMN IF NOT EXISTS fine_paid BOOLEAN DEFAULT false`,
    `ALTER TABLE IF EXISTS book_lending ADD COLUMN IF NOT EXISTS notes TEXT`,
    // ALTER TABLE — book_reservations
    `ALTER TABLE IF EXISTS book_reservations ADD COLUMN IF NOT EXISTS member_name VARCHAR(255)`,
    `ALTER TABLE IF EXISTS book_reservations ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 1`,
    `ALTER TABLE IF EXISTS book_reservations ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'waiting'`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_books_tenant ON books(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_books_isbn ON books(isbn)`,
    `CREATE INDEX IF NOT EXISTS idx_books_category ON books(tenant_id, category)`,
    `CREATE INDEX IF NOT EXISTS idx_books_active ON books(tenant_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_blending_tenant ON book_lending(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_blending_status ON book_lending(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_blending_book ON book_lending(book_id)`,
    `CREATE INDEX IF NOT EXISTS idx_blending_member ON book_lending(member_name)`,
    `CREATE INDEX IF NOT EXISTS idx_breserv_tenant ON book_reservations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_breserv_status ON book_reservations(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_breserv_book ON book_reservations(book_id)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.error('[Library] Cannot connect to DB for migrations'); return; }
    try { for (const sql of migrations) await client.query(sql); console.log('[Library] Migrations applied: ' + migrations.length + ' statements'); }
    catch (e) { console.error('[Library] Migration error:', e.message); }
    finally { client.release(); }
  })();

  // ── nav helper ────────────────────────────────────────────
  function libNav(active) {
    const links = [
      ['/library', 'Dashboard'], ['/library/books/new', 'Add Book'],
      ['/library/borrow', 'Borrow'], ['/library/overdue', 'Overdue'],
      ['/library/reservations', 'Reservations'], ['/library/report', 'Reports']
    ];
    return '<div class="lib-nav">' + links.map(([href, label]) =>
      '<a href="' + href + '" class="' + (active === href ? 'active' : '') + '">' + label + '</a>').join('') + '</div>';
  }

  // ════════════════════════════════════════════════════════════
  // ROUTE 1: GET /library — Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/library', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { q, category } = req.query;

    const stats = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE is_active) as total_books,
        COALESCE(SUM(total_copies) FILTER (WHERE is_active), 0)::int as total_copies,
        COALESCE(SUM(available_copies) FILTER (WHERE is_active), 0)::int as available_copies,
        (SELECT COUNT(*) FROM book_lending WHERE tenant_id=$1 AND status='borrowed') as borrowed,
        (SELECT COUNT(*) FROM book_lending WHERE tenant_id=$1 AND status='overdue') as overdue,
        (SELECT COUNT(*) FROM book_reservations WHERE tenant_id=$1 AND status='waiting') as reservations
      FROM books WHERE tenant_id=$1`, [tid])).rows[0];

    let where = ['tenant_id=$1', 'is_active=true'], params = [tid], pi = 2;
    if (q) { where.push('(title ILIKE $' + pi + ' OR author ILIKE $' + pi + ' OR isbn ILIKE $' + pi + ')'); params.push('%' + q + '%'); pi++; }
    if (category) { where.push('category=$' + pi); params.push(category); pi++; }

    const books = (await pool.query(
      'SELECT * FROM books WHERE ' + where.join(' AND ') + ' ORDER BY title ASC LIMIT 80', params
    )).rows;
    const categories = (await pool.query(
      'SELECT DISTINCT category FROM books WHERE tenant_id=$1 AND is_active AND category IS NOT NULL ORDER BY category', [tid]
    )).rows;

    const bookCards = books.map(b => {
      const cover = b.cover_url
        ? '<img src="' + esc(b.cover_url) + '" class="book-cover" alt="Cover">'
        : '<div class="book-cover">📖</div>';
      return '<div class="book-card" style="margin-bottom:10px">' +
        cover +
        '<div style="flex:1;min-width:0">' +
          '<div style="display:flex;justify-content:space-between;align-items:start;gap:8px;flex-wrap:wrap">' +
            '<a href="/library/books/' + b.id + '" style="color:#1e293b;text-decoration:none;font-weight:700;font-size:15px">' + esc(b.title) + '</a>' +
            availBadge(b.available_copies, b.total_copies) +
          '</div>' +
          '<div style="font-size:13px;color:#64748b;margin-top:2px">' + esc(b.author || 'Unknown Author') + '</div>' +
          (b.category ? '<span class="badge" style="background:#f1f5f9;color:#64748b;margin-top:4px;display:inline-block">' + esc(b.category) + '</span>' : '') +
          (b.isbn ? '<span class="muted" style="font-size:11px;margin-left:8px">ISBN: ' + esc(b.isbn) + '</span>' : '') +
          '<div style="margin-top:6px;display:flex;gap:6px">' +
            '<a href="/library/books/' + b.id + '" class="btn btn-sm btn-blue">View</a>' +
            '<a href="/library/books/' + b.id + '/edit" class="btn btn-sm btn-gold">Edit</a>' +
          '</div>' +
        '</div>' +
      '</div>';
    }).join('');

    const html = LIB_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      libNav('/library') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📚 Library Management</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage books, lending, and reservations</p></div>' +
        '<a href="/library/books/new" class="btn btn-green">+ Add Book</a>' +
      '</div>' +
      '<div class="stats">' +
        '<div class="stat-card"><div class="stat-num" style="color:#4f46e5">' + stats.total_books + '</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Books</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#059669">' + stats.available_copies + '</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Available</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#2563eb">' + stats.borrowed + '</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Borrowed</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#dc2626">' + stats.overdue + '</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Overdue</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">' + stats.reservations + '</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Reservations</div></div>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<div class="lib-filter">' +
          '<div><label>Search</label><form method="GET" style="display:flex;gap:6px"><input type="text" name="q" value="' + esc(q || '') + '" placeholder="Title, author, ISBN..."><button type="submit" class="btn btn-sm btn-blue">Search</button></form></div>' +
          '<div><label>Category</label><select name="category" onchange="location.href=\'/library?category=\'+this.value+(\'&q=' + encodeURIComponent(q || '') + '\')">' +
            '<option value="">All Categories</option>' +
            categories.map(c => '<option value="' + esc(c.category) + '" ' + (category === c.category ? 'selected' : '') + '>' + esc(c.category) + '</option>').join('') +
          '</select></div>' +
        '</div>' +
        bookCards || '<p class="muted" style="text-align:center;padding:30px">No books found. <a href="/library/books/new" style="color:#4f46e5">Add your first book</a>.</p>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Library Dashboard', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 2: GET /library/books/new — Add Book Form
  // ════════════════════════════════════════════════════════════
  app.get('/library/books/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const categories = (await pool.query(
      'SELECT DISTINCT category FROM books WHERE tenant_id=$1 AND is_active AND category IS NOT NULL ORDER BY category', [tid]
    )).rows;

    const html = LIB_CSS + '<div style="max-width:800px;margin:0 auto">' +
      libNav('/library/books/new') +
      '<a href="/library" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Library</a>' +
      '<div class="card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin-bottom:4px">📖 Add New Book</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Add a new book to the library catalog</p>' +
        '<form method="POST" action="/library/books/create" class="form-grid">' +
          '<div><label>Title *</label><input type="text" name="title" required placeholder="Book title"></div>' +
          '<div><label>Author</label><input type="text" name="author" placeholder="Author name"></div>' +
          '<div><label>ISBN</label><input type="text" name="isbn" placeholder="e.g. 978-3-16-148410-0" maxlength="20"></div>' +
          '<div><label>Publisher</label><input type="text" name="publisher" placeholder="Publisher name"></div>' +
          '<div><label>Year</label><input type="number" name="year" placeholder="Publication year" min="1000" max="2099"></div>' +
          '<div><label>Category</label><input type="text" name="category" placeholder="e.g. Fiction, Science" list="cat-list">' +
            '<datalist id="cat-list">' + categories.map(c => '<option value="' + esc(c.category) + '">').join('') + '</datalist></div>' +
          '<div><label>Total Copies</label><input type="number" name="total_copies" value="1" min="1"></div>' +
          '<div><label>Available Copies</label><input type="number" name="available_copies" value="1" min="0"></div>' +
          '<div><label>Location</label><input type="text" name="location" placeholder="Shelf / Room location"></div>' +
          '<div><label>Cover URL</label><input type="url" name="cover_url" placeholder="https://..."></div>' +
          '<div class="full"><label>Description</label><textarea name="description" rows="3" placeholder="Optional book description..."></textarea></div>' +
          '<div class="full" style="display:flex;gap:10px;margin-top:8px">' +
            '<button type="submit" class="btn btn-green" style="padding:12px 28px">💾 Save Book</button>' +
            '<a href="/library" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>' +
          '</div>' +
        '</form>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Add Book', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3: POST /library/books/create — Save Book
  // ════════════════════════════════════════════════════════════
  app.post('/library/books/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, author, isbn, publisher, year, category, total_copies, available_copies, location, description, cover_url } = req.body;
    if (!title || !title.trim()) return res.send('<div class="alert">Book title is required.</div><a href="/library/books/new" class="btn btn-blue">Back</a>');
    const total = parseInt(total_copies) || 1;
    const avail = Math.min(parseInt(available_copies) || total, total);
    await pool.query(
      `INSERT INTO books (tenant_id, title, author, isbn, publisher, year, category, total_copies, available_copies, location, description, cover_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tid, title.trim(), (author || '').trim() || null, (isbn || '').trim() || null,
       (publisher || '').trim() || null, parseInt(year) || null, (category || '').trim() || null,
       total, avail, (location || '').trim() || null, (description || '').trim() || null,
       (cover_url || '').trim() || null]
    );
    console.log('[Library] Book "' + title.trim() + '" added by ' + user.email);
    res.redirect('/library');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 4: GET /library/books/:id — Book Detail
  // ════════════════════════════════════════════════════════════
  app.get('/library/books/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const book = (await pool.query('SELECT * FROM books WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!book) return res.send('<div class="alert">Book not found.</div><a href="/library" class="btn btn-blue">Back</a>');

    const lendings = (await pool.query(
      'SELECT * FROM book_lending WHERE book_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 50', [id, tid]
    )).rows;
    const reservations = (await pool.query(
      'SELECT * FROM book_reservations WHERE book_id=$1 AND tenant_id=$2 AND status=\'waiting\' ORDER BY priority ASC, created_at ASC', [id, tid]
    )).rows;

    const cover = book.cover_url
      ? '<img src="' + esc(book.cover_url) + '" class="book-cover" style="width:120px;height:160px" alt="Cover">'
      : '<div class="book-cover" style="width:120px;height:160px;font-size:48px">📖</div>';

    const lendingRows = lendings.map(l => {
      const isOverdue = l.status === 'borrowed' && l.due_date && new Date(l.due_date) < new Date();
      return '<tr class="' + (isOverdue ? 'overdue-row' : '') + '">' +
        '<td>' + esc(l.member_name) + '</td>' +
        '<td>' + fmtDate(l.borrow_date) + '</td>' +
        '<td>' + fmtDate(l.due_date) + '</td>' +
        '<td>' + fmtDate(l.return_date) + '</td>' +
        '<td>' + statusBadge(l.status) + '</td>' +
        '<td>' + (l.fine_amount > 0 ? '<span style="color:#dc2626;font-weight:600">' + fmtMoney(l.fine_amount) + '</span>' : '—') + '</td>' +
        (l.status === 'borrowed' ? '<td><form method="POST" action="/library/return/' + l.id + '" style="display:inline"><button class="btn btn-sm btn-green">Return</button></form></td>' : '<td></td>') +
      '</tr>';
    }).join('');

    const resQueue = reservations.map(r =>
      '<div class="res-queue-item">' +
        '<div><strong>' + esc(r.member_name || 'Anonymous') + '</strong>' +
        '<span class="muted" style="font-size:12px;margin-left:8px">Reserved ' + fmtDate(r.created_at) + '</span></div>' +
        statusBadge(r.status) +
      '</div>'
    ).join('');

    const html = LIB_CSS + '<div style="max-width:1000px;margin:0 auto">' +
      libNav('/library') +
      '<a href="/library" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Library</a>' +
      '<div class="card" style="padding:24px;margin-bottom:16px">' +
        '<div style="display:flex;gap:20px;flex-wrap:wrap">' +
          cover +
          '<div style="flex:1;min-width:250px">' +
            '<h2 style="color:#1e293b;margin:0 0 4px">' + esc(book.title) + '</h2>' +
            '<p style="color:#64748b;font-size:15px;margin:0 0 8px">' + esc(book.author || 'Unknown Author') + '</p>' +
            '<div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:10px">' +
              availBadge(book.available_copies, book.total_copies) +
              (book.category ? '<span class="badge" style="background:#f1f5f9;color:#64748b">' + esc(book.category) + '</span>' : '') +
            '</div>' +
            '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:8px;font-size:13px">' +
              (book.isbn ? '<div><span class="muted">ISBN:</span> <strong>' + esc(book.isbn) + '</strong></div>' : '') +
              (book.publisher ? '<div><span class="muted">Publisher:</span> <strong>' + esc(book.publisher) + '</strong></div>' : '') +
              (book.year ? '<div><span class="muted">Year:</span> <strong>' + book.year + '</strong></div>' : '') +
              (book.location ? '<div><span class="muted">Location:</span> <strong>' + esc(book.location) + '</strong></div>' : '') +
            '</div>' +
            (book.description ? '<p style="color:#475569;font-size:14px;margin-top:12px">' + esc(book.description) + '</p>' : '') +
            '<div style="margin-top:16px;display:flex;gap:8px">' +
              '<a href="/library/books/' + id + '/edit" class="btn btn-gold">✏️ Edit</a>' +
              '<form method="POST" action="/library/books/' + id + '/delete" style="display:inline" onsubmit="return confirm(\'Delete this book?\')">' +
                '<button type="submit" class="btn btn-red">🗑️ Delete</button></form>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
      (resQueue ? '<div class="card" style="padding:20px;margin-bottom:16px"><h3 style="color:#1e293b;margin:0 0 10px">📋 Reservation Queue (' + reservations.length + ')</h3><div class="res-queue">' + resQueue + '</div></div>' : '') +
      '<div class="card" style="padding:20px">' +
        '<h3 style="color:#1e293b;margin:0 0 12px">📊 Lending History</h3>' +
        '<div style="overflow-x:auto"><table class="lib-tbl">' +
          '<thead><tr><th>Member</th><th>Borrowed</th><th>Due Date</th><th>Returned</th><th>Status</th><th>Fine</th><th>Action</th></tr></thead>' +
          '<tbody>' + (lendingRows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:20px">No lending history</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Book: ' + book.title, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 5: GET /library/books/:id/edit — Edit Book
  // ════════════════════════════════════════════════════════════
  app.get('/library/books/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const book = (await pool.query('SELECT * FROM books WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!book) return res.send('<div class="alert">Book not found.</div><a href="/library" class="btn btn-blue">Back</a>');
    const categories = (await pool.query(
      'SELECT DISTINCT category FROM books WHERE tenant_id=$1 AND is_active AND category IS NOT NULL ORDER BY category', [tid]
    )).rows;

    const fld = (label, name, type, val) =>
      '<div><label>' + label + '</label><input type="' + type + '" name="' + name + '" value="' + esc(String(val || '')) + '"></div>';

    const html = LIB_CSS + '<div style="max-width:800px;margin:0 auto">' +
      libNav('/library/books/new') +
      '<a href="/library/books/' + id + '" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Book</a>' +
      '<div class="card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin-bottom:20px">✏️ Edit: ' + esc(book.title) + '</h2>' +
        '<form method="POST" action="/library/books/' + id + '/update" class="form-grid">' +
          fld('Title *', 'title', 'text', book.title) +
          fld('Author', 'author', 'text', book.author) +
          fld('ISBN', 'isbn', 'text', book.isbn) +
          fld('Publisher', 'publisher', 'text', book.publisher) +
          fld('Year', 'year', 'number', book.year) +
          '<div><label>Category</label><input type="text" name="category" value="' + esc(book.category || '') + '" list="cat-list2">' +
            '<datalist id="cat-list2">' + categories.map(c => '<option value="' + esc(c.category) + '">').join('') + '</datalist></div>' +
          fld('Total Copies', 'total_copies', 'number', book.total_copies) +
          fld('Available Copies', 'available_copies', 'number', book.available_copies) +
          fld('Location', 'location', 'text', book.location) +
          fld('Cover URL', 'cover_url', 'url', book.cover_url) +
          '<div class="full"><label>Description</label><textarea name="description" rows="3">' + esc(book.description || '') + '</textarea></div>' +
          '<div class="full" style="display:flex;gap:10px;margin-top:8px">' +
            '<button type="submit" class="btn btn-green" style="padding:12px 28px">💾 Update Book</button>' +
            '<a href="/library/books/' + id + '" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>' +
          '</div>' +
        '</form>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Edit Book: ' + book.title, html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 6: POST /library/books/:id/update — Update Book
  // ════════════════════════════════════════════════════════════
  app.post('/library/books/:id/update', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const { title, author, isbn, publisher, year, category, total_copies, available_copies, location, description, cover_url } = req.body;
    if (!title || !title.trim()) return res.send('<div class="alert">Book title is required.</div><a href="javascript:history.back()" class="btn btn-blue">Back</a>');
    const total = Math.max(1, parseInt(total_copies) || 1);
    const avail = Math.min(parseInt(available_copies) || 0, total);
    await pool.query(
      `UPDATE books SET title=$1, author=$2, isbn=$3, publisher=$4, year=$5, category=$6,
        total_copies=$7, available_copies=$8, location=$9, description=$10, cover_url=$11
       WHERE id=$12 AND tenant_id=$13`,
      [title.trim(), (author || '').trim() || null, (isbn || '').trim() || null,
       (publisher || '').trim() || null, parseInt(year) || null, (category || '').trim() || null,
       total, avail, (location || '').trim() || null, (description || '').trim() || null,
       (cover_url || '').trim() || null, id, tid]
    );
    console.log('[Library] Book #' + id + ' updated by ' + user.email);
    res.redirect('/library/books/' + id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 7: DELETE /library/books/:id — Delete Book
  // ════════════════════════════════════════════════════════════
  app.post('/library/books/:id/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, id = req.params.id;
    const book = (await pool.query('SELECT id, title FROM books WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!book) return res.redirect('/library');
    const activeBorrowed = (await pool.query(
      'SELECT COUNT(*)::int as cnt FROM book_lending WHERE book_id=$1 AND tenant_id=$2 AND status=\'borrowed\'', [id, tid]
    )).rows[0].cnt;
    if (activeBorrowed > 0) {
      return res.send('<div class="alert" style="background:#fee2e2;color:#dc2626">Cannot delete — ' + activeBorrowed + ' copy/copies are currently borrowed. Please return them first.</div><a href="/library/books/' + id + '" class="btn btn-blue">Back</a>');
    }
    await pool.query('DELETE FROM book_reservations WHERE book_id=$1 AND tenant_id=$2', [id, tid]);
    await pool.query('DELETE FROM book_lending WHERE book_id=$1 AND tenant_id=$2', [id, tid]);
    await pool.query('DELETE FROM books WHERE id=$1 AND tenant_id=$2', [id, tid]);
    console.log('[Library] Book "' + book.title + '" deleted by ' + user.email);
    res.redirect('/library');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 8: GET /library/borrow — Borrow Book Page
  // ════════════════════════════════════════════════════════════
  app.get('/library/borrow', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const books = (await pool.query(
      'SELECT id, title, author, available_copies FROM books WHERE tenant_id=$1 AND is_active AND available_copies > 0 ORDER BY title', [tid]
    )).rows;

    const html = LIB_CSS + '<div style="max-width:700px;margin:0 auto">' +
      libNav('/library/borrow') +
      '<a href="/library" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Library</a>' +
      '<div class="card" style="padding:24px">' +
        '<h2 style="color:#1e293b;margin-bottom:4px">📥 Borrow a Book</h2>' +
        '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Select a member and a book to process the lending</p>' +
        '<form method="POST" action="/library/borrow/process" class="form-grid">' +
          '<div class="full"><label>Member Name *</label><input type="text" name="member_name" required placeholder="Borrower\'s full name"></div>' +
          '<div class="full"><label>Select Book *</label>' +
            '<select name="book_id" required>' +
              '<option value="">— Choose a book —</option>' +
              books.map(b => '<option value="' + b.id + '">' + esc(b.title) + ' by ' + esc(b.author || 'Unknown') + ' (' + b.available_copies + ' available)</option>').join('') +
            '</select></div>' +
          '<div><label>Borrow Date *</label><input type="date" name="borrow_date" value="' + new Date().toISOString().split('T')[0] + '" required></div>' +
          '<div><label>Due Date *</label><input type="date" name="due_date" value="' + new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0] + '" required></div>' +
          '<div class="full"><label>Notes</label><textarea name="notes" rows="2" placeholder="Optional notes..."></textarea></div>' +
          '<div class="full" style="display:flex;gap:10px;margin-top:8px">' +
            '<button type="submit" class="btn btn-green" style="padding:12px 28px">📥 Process Borrowing</button>' +
            '<a href="/library" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>' +
          '</div>' +
        '</form>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Borrow Book', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 9: POST /library/borrow/process — Process Borrowing
  // ════════════════════════════════════════════════════════════
  app.post('/library/borrow/process', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { member_name, book_id, borrow_date, due_date, notes } = req.body;
    if (!member_name || !book_id || !borrow_date || !due_date) {
      return res.send('<div class="alert">All required fields must be filled.</div><a href="/library/borrow" class="btn btn-blue">Back</a>');
    }
    const book = (await pool.query(
      'SELECT id, title, available_copies FROM books WHERE id=$1 AND tenant_id=$2', [book_id, tid]
    )).rows[0];
    if (!book) return res.send('<div class="alert">Book not found.</div><a href="/library/borrow" class="btn btn-blue">Back</a>');
    if (book.available_copies <= 0) {
      return res.send('<div class="alert">No copies available for "' + esc(book.title) + '".</div><a href="/library/borrow" class="btn btn-blue">Back</a>');
    }
    await pool.query(
      `INSERT INTO book_lending (tenant_id, book_id, member_name, borrow_date, due_date, status, notes)
       VALUES ($1,$2,$3,$4,$5,'borrowed',$6)`,
      [tid, book_id, member_name.trim(), borrow_date, due_date, (notes || '').trim() || null]
    );
    await pool.query(
      'UPDATE books SET available_copies = available_copies - 1 WHERE id=$1 AND tenant_id=$2',
      [book_id, tid]
    );
    console.log('[Library] "' + book.title + '" borrowed by ' + member_name.trim());
    res.redirect('/library');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 10: POST /library/return/:id — Return Book
  // ════════════════════════════════════════════════════════════
  app.post('/library/return/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, lendingId = req.params.id;
    const lending = (await pool.query(
      'SELECT bl.*, b.title, b.available_copies FROM book_lending bl JOIN books b ON b.id = bl.book_id WHERE bl.id=$1 AND bl.tenant_id=$2',
      [lendingId, tid]
    )).rows[0];
    if (!lending) return res.send('<div class="alert">Lending record not found.</div><a href="/library" class="btn btn-blue">Back</a>');
    if (lending.status === 'returned') return res.redirect('/library/books/' + lending.book_id);

    // Calculate fine
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const due = new Date(lending.due_date); due.setHours(0, 0, 0, 0);
    const daysOverdue = Math.max(0, Math.ceil((today - due) / 86400000));
    const fineAmount = daysOverdue > 0 ? parseFloat((daysOverdue * FINE_PER_DAY).toFixed(2)) : 0;
    const newStatus = daysOverdue > 0 ? 'overdue' : 'returned';

    await pool.query(
      `UPDATE book_lending SET return_date=NOW()::date, status=$1, fine_amount=$2, notes=COALESCE(notes||' | ','') || 'Returned: $3 days overdue'
       WHERE id=$4 AND tenant_id=$5`,
      [newStatus, fineAmount, String(daysOverdue), lendingId, tid]
    );
    await pool.query(
      'UPDATE books SET available_copies = available_copies + 1 WHERE id=$1 AND tenant_id=$2',
      [lending.book_id, tid]
    );
    console.log('[Library] "' + lending.title + '" returned by ' + lending.member_name +
      (fineAmount > 0 ? ' (Fine: ' + fmtMoney(fineAmount) + ')' : ''));
    res.redirect('/library/books/' + lending.book_id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 11: GET /library/overdue — Overdue Books
  // ════════════════════════════════════════════════════════════
  app.get('/library/overdue', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Mark truly overdue items
    await pool.query(
      `UPDATE book_lending SET status='overdue' WHERE tenant_id=$1 AND status='borrowed' AND due_date < CURRENT_DATE`,
      [tid]
    );

    const overdues = (await pool.query(`
      SELECT bl.*, b.title, b.author, b.isbn,
        GREATEST(0, CURRENT_DATE - bl.due_date)::int as days_overdue,
        (GREATEST(0, CURRENT_DATE - bl.due_date) * ${FINE_PER_DAY})::numeric(8,2) as calculated_fine
      FROM book_lending bl
      JOIN books b ON b.id = bl.book_id
      WHERE bl.tenant_id=$1 AND bl.status IN ('borrowed','overdue') AND bl.due_date < CURRENT_DATE
      ORDER BY bl.due_date ASC`, [tid]
    )).rows;

    const totalFines = overdues.reduce((sum, o) => sum + Number(o.calculated_fine || 0), 0);

    const rows = overdues.map(o => '<tr class="overdue-row">' +
      '<td><a href="/library/books/' + o.book_id + '" style="color:#4f46e5;text-decoration:none;font-weight:600">' + esc(o.title) + '</a></td>' +
      '<td>' + esc(o.member_name) + '</td>' +
      '<td>' + fmtDate(o.due_date) + '</td>' +
      '<td><span style="color:#dc2626;font-weight:700">' + o.days_overdue + ' days</span></td>' +
      '<td><strong style="color:#dc2626">' + fmtMoney(o.calculated_fine) + '</strong></td>' +
      '<td><form method="POST" action="/library/return/' + o.id + '" style="display:inline"><button class="btn btn-sm btn-green">Return</button></form></td>' +
    '</tr>').join('');

    const html = LIB_CSS + '<div style="max-width:1100px;margin:0 auto">' +
      libNav('/library/overdue') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#dc2626">⚠️ Overdue Books</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">' + overdues.length + ' overdue item(s) · Total fines: <strong style="color:#dc2626">' + fmtMoney(totalFines) + '</strong></p></div>' +
      '</div>' +
      (overdues.length > 0 ? '<div class="card"><div style="overflow-x:auto"><table class="lib-tbl">' +
        '<thead><tr><th>Book</th><th>Member</th><th>Due Date</th><th>Days Overdue</th><th>Fine</th><th>Action</th></tr></thead>' +
        '<tbody>' + rows + '</tbody></table></div></div>'
      : '<div class="card" style="text-align:center;padding:40px"><p style="font-size:16px;color:#059669;font-weight:600">✅ No overdue books!</p></div>') +
    '</div>';
    res.send(renderPage('Overdue Books', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 12: GET /library/reservations — Reservation Management
  // ════════════════════════════════════════════════════════════
  app.get('/library/reservations', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const reservations = (await pool.query(`
      SELECT br.*, b.title, b.author, b.available_copies, b.total_copies
      FROM book_reservations br
      JOIN books b ON b.id = br.book_id
      WHERE br.tenant_id=$1 ORDER BY br.status ASC, br.created_at ASC`, [tid]
    )).rows;

    const waiting = reservations.filter(r => r.status === 'waiting');
    const other = reservations.filter(r => r.status !== 'waiting');

    function renderResList(list) {
      return list.map(r => '<tr>' +
        '<td><a href="/library/books/' + r.book_id + '" style="color:#4f46e5;text-decoration:none;font-weight:600">' + esc(r.title) + '</a></td>' +
        '<td>' + esc(r.member_name || 'Anonymous') + '</td>' +
        '<td>' + statusBadge(r.status) + '</td>' +
        '<td>' + availBadge(r.available_copies, r.total_copies) + '</td>' +
        '<td>' + fmtDate(r.created_at) + '</td>' +
        (r.status === 'waiting' ? '<td>' +
          '<form method="POST" action="/library/reserve/cancel" style="display:inline"><input type="hidden" name="id" value="' + r.id + '"><button class="btn btn-sm btn-red">Cancel</button></form> ' +
          '<form method="POST" action="/library/borrow/process" style="display:inline"><input type="hidden" name="member_name" value="' + esc(r.member_name || '') + '"><input type="hidden" name="book_id" value="' + r.book_id + '"><input type="hidden" name="borrow_date" value="' + new Date().toISOString().split('T')[0] + '"><input type="hidden" name="due_date" value="' + new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0] + '"><button class="btn btn-sm btn-green" title="Borrow to this member">Lend</button></form>' +
        '</td>' : '<td></td>') +
      '</tr>').join('');
    }

    const html = LIB_CSS + '<div style="max-width:1100px;margin:0 auto">' +
      libNav('/library/reservations') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📋 Reservations</h1>' +
        '<p style="font-size:13px;color:#94a3b8;margin-top:2px">' + waiting.length + ' waiting · ' + other.length + ' resolved</p></div>' +
        '<a href="/library/borrow" class="btn btn-green">+ New Borrowing</a>' +
      '</div>' +
      (waiting.length > 0 ? '<div class="card" style="margin-bottom:16px"><h3 style="color:#f59e0b;margin:0 0 12px">⏳ Waiting Queue (' + waiting.length + ')</h3>' +
        '<div style="overflow-x:auto"><table class="lib-tbl"><thead><tr><th>Book</th><th>Member</th><th>Status</th><th>Availability</th><th>Reserved</th><th>Actions</th></tr></thead><tbody>' + renderResList(waiting) + '</tbody></table></div></div>' : '') +
      (other.length > 0 ? '<div class="card"><h3 style="color:#64748b;margin:0 0 12px">Archived (' + other.length + ')</h3>' +
        '<div style="overflow-x:auto"><table class="lib-tbl"><thead><tr><th>Book</th><th>Member</th><th>Status</th><th>Availability</th><th>Reserved</th><th></th></tr></thead><tbody>' + renderResList(other) + '</tbody></table></div></div>' : '') +
      '<div class="card" style="margin-top:16px;padding:20px">' +
        '<h3 style="color:#1e293b;margin:0 0 12px">➕ Place a Reservation</h3>' +
        '<form method="POST" action="/library/reserve" class="form-grid">' +
          '<div><label>Member Name *</label><input type="text" name="member_name" required placeholder="Member name"></div>' +
          '<div><label>Book *</label><select name="book_id" required>' +
            '<option value="">— Choose a book —</option>' +
            reservations.map(r => '<option value="' + r.book_id + '">' + esc(r.title) + '</option>').join('') +
          '</select></div>' +
          '<div class="full"><button type="submit" class="btn btn-blue" style="padding:10px 24px">📋 Reserve Book</button></div>' +
        '</form>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Reservations', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 13: POST /library/reserve — Place Reservation
  // ════════════════════════════════════════════════════════════
  app.post('/library/reserve', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { member_name, book_id } = req.body;
    if (!member_name || !book_id) return res.redirect('/library/reservations');
    const book = (await pool.query('SELECT id, title FROM books WHERE id=$1 AND tenant_id=$2', [book_id, tid])).rows[0];
    if (!book) return res.send('<div class="alert">Book not found.</div><a href="/library/reservations" class="btn btn-blue">Back</a>');
    const maxPriority = (await pool.query(
      'SELECT COALESCE(MAX(priority),0)::int as p FROM book_reservations WHERE book_id=$1 AND tenant_id=$2 AND status=\'waiting\'', [book_id, tid]
    )).rows[0].p;
    await pool.query(
      'INSERT INTO book_reservations (tenant_id, book_id, member_name, priority, status) VALUES ($1,$2,$3,$4,\'waiting\')',
      [tid, book_id, member_name.trim(), maxPriority + 1]
    );
    console.log('[Library] Reservation for "' + book.title + '" by ' + member_name.trim());
    res.redirect('/library/reservations');
  }));

  // Cancel reservation (sub-route)
  app.post('/library/reserve/cancel', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    await pool.query(
      'UPDATE book_reservations SET status=\'cancelled\' WHERE id=$1 AND tenant_id=$2',
      [req.body.id, tid]
    );
    res.redirect('/library/reservations');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 14: GET /library/report — Library Reports
  // ════════════════════════════════════════════════════════════
  app.get('/library/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Most borrowed books
    const mostBorrowed = (await pool.query(`
      SELECT b.title, b.author, COUNT(bl.id)::int as borrow_count,
        COUNT(bl.id) FILTER (WHERE bl.status='overdue')::int as overdue_count
      FROM books b
      LEFT JOIN book_lending bl ON bl.book_id = b.id AND bl.tenant_id = b.tenant_id
      WHERE b.tenant_id=$1 AND b.is_active
      GROUP BY b.id ORDER BY borrow_count DESC LIMIT 20`, [tid]
    )).rows;

    // Category breakdown
    const categoryStats = (await pool.query(`
      SELECT category, COUNT(*)::int as book_count,
        COALESCE(SUM(total_copies), 0)::int as total_copies,
        COALESCE(SUM(available_copies), 0)::int as available
      FROM books WHERE tenant_id=$1 AND is_active AND category IS NOT NULL
      GROUP BY category ORDER BY book_count DESC`, [tid]
    )).rows;

    // Overdue stats
    const overdueStats = (await pool.query(`
      SELECT
        COUNT(*)::int as overdue_count,
        COALESCE(SUM(GREATEST(0, CURRENT_DATE - bl.due_date)), 0)::int as total_days_overdue,
        COALESCE(SUM((GREATEST(0, CURRENT_DATE - bl.due_date)) * ${FINE_PER_DAY})::numeric(8,2), 0) as total_fines,
        COALESCE(SUM(fine_amount) FILTER (WHERE fine_paid=false), 0)::numeric(8,2) as unpaid_fines
      FROM book_lending bl
      JOIN books b ON b.id = bl.book_id
      WHERE bl.tenant_id=$1 AND bl.status IN ('borrowed','overdue') AND bl.due_date < CURRENT_DATE`, [tid]
    )).rows[0];

    // Monthly lending trend (last 6 months)
    const trend = (await pool.query(`
      SELECT to_char(created_at, 'YYYY-MM') as month, COUNT(*)::int as count
      FROM book_lending WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '6 months'
      GROUP BY month ORDER BY month DESC`, [tid]
    )).rows;

    const borrowedRows = mostBorrowed.filter(b => b.borrow_count > 0).map((b, i) =>
      '<tr><td><strong style="color:#4f46e5">#' + (i + 1) + '</strong></td>' +
      '<td><a href="/library/books/' + (mostBorrowed.indexOf(b) >= 0 ? '' : '') + '" style="color:#1e293b;text-decoration:none;font-weight:600">' + esc(b.title) + '</a></td>' +
      '<td>' + esc(b.author || '—') + '</td>' +
      '<td><strong>' + b.borrow_count + '</strong></td>' +
      '<td>' + (b.overdue_count > 0 ? '<span style="color:#dc2626">' + b.overdue_count + '</span>' : '<span class="muted">0</span>') + '</td></tr>'
    ).join('');

    const catRows = categoryStats.map(c => {
      const pct = c.total_copies > 0 ? Math.round((c.available / c.total_copies) * 100) : 100;
      const barColor = pct >= 50 ? '#22c55e' : pct >= 20 ? '#f59e0b' : '#dc2626';
      return '<tr><td><strong>' + esc(c.category) + '</strong></td>' +
        '<td>' + c.book_count + '</td><td>' + c.total_copies + '</td>' +
        '<td>' + c.available + '</td>' +
        '<td><div style="display:flex;align-items:center;gap:8px">' +
          '<div style="flex:1;height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden;min-width:80px">' +
            '<div style="height:100%;width:' + pct + '%;background:' + barColor + ';border-radius:4px"></div></div>' +
          '<span style="font-size:12px;color:#64748b">' + pct + '%</span></div></td></tr>';
    }).join('');

    const trendHtml = trend.map(t => '<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">' +
      '<span class="muted">' + esc(t.month) + '</span><strong>' + t.count + ' loans</strong></div>'
    ).join('');

    const html = LIB_CSS + '<div style="max-width:1100px;margin:0 auto">' +
      libNav('/library/report') +
      '<h1 style="font-size:24px;color:#1e293b;margin-bottom:4px">📊 Library Reports</h1>' +
      '<p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Borrowing trends, popular books, and category analytics</p>' +
      '<div class="stats" style="margin-bottom:20px">' +
        '<div class="stat-card"><div class="stat-num" style="color:#dc2626">' + overdueStats.overdue_count + '</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Currently Overdue</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">' + overdueStats.total_days_overdue + '</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Days Overdue</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#dc2626">' + fmtMoney(overdueStats.total_fines) + '</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Total Fines Due</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#0891b2">' + fmtMoney(overdueStats.unpaid_fines) + '</div><div style="font-size:12px;color:#94a3b8;margin-top:2px">Unpaid Fines</div></div>' +
      '</div>' +
      '<div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">' +
        '<div class="card" style="padding:20px">' +
          '<h3 style="color:#1e293b;margin:0 0 12px">📚 Most Borrowed Books</h3>' +
          '<div style="overflow-x:auto"><table class="lib-tbl"><thead><tr><th>#</th><th>Title</th><th>Author</th><th>Borrowed</th><th>Overdue</th></tr></thead><tbody>' +
            (borrowedRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No borrowing data yet</td></tr>') +
          '</tbody></table></div></div>' +
        '<div class="card" style="padding:20px">' +
          '<h3 style="color:#1e293b;margin:0 0 12px">📂 Categories Overview</h3>' +
          '<div style="overflow-x:auto"><table class="lib-tbl"><thead><tr><th>Category</th><th>Titles</th><th>Copies</th><th>Avail</th><th>Rate</th></tr></thead><tbody>' +
            (catRows || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No categories</td></tr>') +
          '</tbody></table></div></div>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="color:#1e293b;margin:0 0 12px">📈 Monthly Lending Trend (Last 6 Months)</h3>' +
        (trendHtml || '<p class="muted" style="text-align:center;padding:20px">No lending data in the last 6 months</p>') +
      '</div>' +
    '</div>';
    res.send(renderPage('Library Reports', html, user, req));
  }));

  console.log('[Library] Library management loaded');
};
