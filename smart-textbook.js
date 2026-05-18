// ============================================================
// SMART-TEXTBOOK MODULE — School SaaS Portal
// Digital textbook management, chapter content, bookmarking,
// highlighting, note-taking, progress tracking, quiz integration.
// 12+ routes, MySQL-backed, tenant-aware.
// ============================================================
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ─── Helpers ──────────────────────────────────────────────
  const nav = (active) => `<div style="display:flex;gap:6px;margin-bottom:24px;flex-wrap:wrap;padding:4px 0">
    <a href="/school/smart-textbook" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='dash'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📚 Library</a>
    <a href="/school/smart-textbook/browse" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='browse'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📖 Browse</a>
    <a href="/school/smart-textbook/my-books" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='mine'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📕 My Books</a>
    <a href="/school/smart-textbook/notes" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='notes'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📝 Notes</a>
  </div>`;

  const statCard = (label, value, color, icon) => `<div style="background:#fff;border-radius:14px;padding:20px;text-align:center;border:1px solid #e5e7eb;position:relative;overflow:hidden"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:${color}"></div><div style="font-size:28px;font-weight:800;color:${color}">${value}</div><div style="font-size:12px;color:${GRAY};font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:4px">${icon} ${label}</div></div>`;

  const badge = (text, color) => `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${color}20;color:${color}">${text}</span>`;

  // ─── Database Migration ──────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS textbooks (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        subject VARCHAR(100),
        grade VARCHAR(50),
        author VARCHAR(200),
        publisher VARCHAR(200),
        isbn VARCHAR(50),
        cover_url TEXT,
        total_chapters INT DEFAULT 0,
        status TEXT DEFAULT 'draft',
        created_by INT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      `);
      console.log('[SmartTextbook] textbooks OK');
    } catch(e) { console.warn('[SmartTextbook] Warn:', e.message); }

    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS textbook_chapters (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        textbook_id INT NOT NULL,
        chapter_num INT DEFAULT 1,
        title VARCHAR(255) NOT NULL,
        content TEXT,
        objectives JSONB DEFAULT NULL,
        quiz JSONB DEFAULT NULL,
        glossary JSONB DEFAULT NULL,
        related_resources JSONB DEFAULT NULL,
        status TEXT DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      `);
      console.log('[SmartTextbook] textbook_chapters OK');
    } catch(e) { console.warn('[SmartTextbook] Warn:', e.message); }

    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS textbook_progress (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        student_id INT NOT NULL,
        textbook_id INT NOT NULL,
        current_chapter INT DEFAULT 1,
        completion_pct INT DEFAULT 0,
        bookmarks JSONB DEFAULT NULL,
        highlights JSONB DEFAULT NULL,
        notes JSONB DEFAULT NULL,
        last_accessed TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_progress UNIQUE (tenant_id, student_id, textbook_id)
      `);
      console.log('[SmartTextbook] textbook_progress OK');
    } catch(e) { console.warn('[SmartTextbook] Warn:', e.message); }
  })();

  // ─── ROUTE 1: Dashboard / Library ────────────────────────
  app.get('/school/smart-textbook', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [totalBooks] = await pool.query('SELECT COUNT(*) as c FROM textbooks WHERE tenant_id=? AND status="published"', [tid]);
    const [myProgress] = await pool.query('SELECT COUNT(*) as c FROM textbook_progress WHERE tenant_id=? AND student_id=?', [tid, uid]);
    const [completedBooks] = await pool.query('SELECT COUNT(*) as c FROM textbook_progress WHERE tenant_id=? AND student_id=? AND completion_pct=100', [tid, uid]);
    const [recentBooks] = await pool.query('SELECT tp.*, t.title as textbook_title, t.subject, t.cover_url, t.total_chapters FROM textbook_progress tp JOIN textbooks t ON t.id=tp.textbook_id WHERE tp.tenant_id=? AND tp.student_id=? ORDER BY tp.last_accessed DESC LIMIT 4', [tid, uid]);
    const [recentTextbooks] = await pool.query('SELECT * FROM textbooks WHERE tenant_id=? AND status="published" ORDER BY created_at DESC LIMIT 6', [tid]);

    res.send(renderPage('Smart Textbooks', SKIP + `<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:${P};margin:0">📚 Smart Textbook Library</h1>
          <p style="font-size:13px;color:${GRAY};margin-top:4px">Interactive digital textbooks with notes, highlights, and quizzes</p>
        </div>
        ${req.session.user.role==='teacher'||req.session.user.role==='admin'?`<a href="/school/smart-textbook/create" class="btn" style="padding:10px 24px;text-decoration:none;font-size:14px">+ Create Textbook</a>`:''}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px">
        ${statCard('Available Books', totalBooks[0].c, P, '📚')}
        ${statCard('In Progress', myProgress[0].c, '#059669', '📖')}
        ${statCard('Completed', completedBooks[0].c, '#7c3aed', '✅')}
        ${statCard('Avg Completion', myProgress[0].c > 0 ? Math.round(completedBooks[0].c / myProgress[0].c * 100)+'%' : '0%', '#d97706', '📊')}
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:18px">
        <div>
          <h3 style="color:${P};margin:0 0 14px">📖 Continue Reading</h3>
          ${recentBooks.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">
            ${recentBooks.map(p => `<div class="card" style="display:flex;gap:14px;align-items:center;cursor:pointer" onclick="location.href='/school/smart-textbook/read/${p.textbook_id}'">
              <div style="width:60px;height:80px;border-radius:8px;background:linear-gradient(135deg,${P},#7c3aed);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px;flex-shrink:0">📕</div>
              <div style="flex:1;min-width:0">
                <strong style="color:#1f2937;font-size:14px">${esc(p.textbook_title)}</strong>
                <div style="color:${GRAY};font-size:12px;margin-top:2px">${esc(p.subject)} • Ch. ${p.current_chapter}/${p.total_chapters}</div>
                <div style="background:#f3f4f6;border-radius:20px;height:6px;margin-top:8px;overflow:hidden"><div style="background:${P};height:6px;border-radius:20px;width:${p.completion_pct}%"></div></div>
                <div style="color:${GRAY};font-size:11px;margin-top:3px">${p.completion_pct}% complete</div>
              </div>
            </div>`).join('')}
          </div>` : '<div class="card" style="text-align:center;padding:30px;color:'+GRAY+'">No books in progress. Browse the library to start reading!</div>'}

          <h3 style="color:${P};margin:24px 0 14px">🆕 Recently Added</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:14px">
            ${recentTextbooks.map(t => `<div class="card" style="cursor:pointer" onclick="location.href='/school/smart-textbook/read/${t.id}'">
              <div style="height:8px;border-radius:8px 8px 0 0;background:linear-gradient(90deg,${P},#7c3aed)"></div>
              <h4 style="color:#1f2937;margin:10px 0 4px;font-size:14px">${esc(t.title)}</h4>
              <div style="color:${GRAY};font-size:12px">${esc(t.author||'Unknown')} • ${esc(t.grade||'All Grades')}</div>
              <div style="display:flex;gap:6px;margin-top:8px">
                ${badge(t.subject||'General', P)}
                <span style="color:${GRAY};font-size:11px">${t.total_chapters} chapters</span>
              </div>
            </div>`).join('')||'<p style="color:'+GRAY+';grid-column:1/-1;text-align:center;padding:20px">No textbooks available yet.</p>'}
          </div>
        </div>

        <div class="card">
          <h3 style="color:${P};margin:0 0 14px">💡 Quick Actions</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <a href="/school/smart-textbook/browse" style="display:flex;align-items:center;gap:8px;padding:12px;background:#f3f4f6;border-radius:10px;text-decoration:none;color:#1f2937;font-weight:600">📖 Browse Library</a>
            <a href="/school/smart-textbook/my-books" style="display:flex;align-items:center;gap:8px;padding:12px;background:#f3f4f6;border-radius:10px;text-decoration:none;color:#1f2937;font-weight:600">📕 My Books</a>
            <a href="/school/smart-textbook/notes" style="display:flex;align-items:center;gap:8px;padding:12px;background:#f3f4f6;border-radius:10px;text-decoration:none;color:#1f2937;font-weight:600">📝 My Notes</a>
            <a href="/school/smart-textbook/highlights" style="display:flex;align-items:center;gap:8px;padding:12px;background:#f3f4f6;border-radius:10px;text-decoration:none;color:#1f2937;font-weight:600">🖍️ Highlights</a>
            <a href="/school/smart-textbook/bookmarks" style="display:flex;align-items:center;gap:8px;padding:12px;background:#f3f4f6;border-radius:10px;text-decoration:none;color:#1f2937;font-weight:600">🔖 Bookmarks</a>
          </div>
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 2: Browse Library ─────────────────────────────
  app.get('/school/smart-textbook/browse', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const subjectFilter = req.query.subject || '';
    const gradeFilter = req.query.grade || '';
    const searchQuery = req.query.search || '';

    let whereClause = 'WHERE tenant_id=? AND status="published"';
    const params = [tid];
    if (subjectFilter) { whereClause += ' AND subject=?'; params.push(subjectFilter); }
    if (gradeFilter) { whereClause += ' AND grade=?'; params.push(gradeFilter); }
    if (searchQuery) { whereClause += ' AND (title LIKE ? OR author LIKE ?)'; params.push('%'+searchQuery+'%', '%'+searchQuery+'%'); }

    const [textbooks] = await pool.query(`SELECT * FROM textbooks ${whereClause} ORDER BY title`, params);
    const [subjects] = await pool.query('SELECT DISTINCT subject FROM textbooks WHERE tenant_id=? AND status="published" ORDER BY subject', [tid]);
    const [grades] = await pool.query('SELECT DISTINCT grade FROM textbooks WHERE tenant_id=? AND status="published" ORDER BY grade', [tid]);

    res.send(renderPage('Browse Textbooks', SKIP + `<div style="max-width:1100px;margin:0 auto;padding:20px">
      ${nav('browse')}
      <h2 style="color:${P};margin:0 0 20px">📖 Browse Textbook Library</h2>

      <div style="display:flex;gap:10px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
        <form method="GET" style="display:flex;gap:8px;flex:1;min-width:200px">
          <input type="text" name="search" value="${esc(searchQuery)}" placeholder="Search textbooks..." style="flex:1">
          <button type="submit" class="btn" style="width:auto;padding:8px 16px">🔍</button>
        </form>
        <select onchange="location.href='/school/smart-textbook/browse?subject='+this.value" style="width:auto;min-width:150px">
          <option value="">All Subjects</option>
          ${subjects.map(s => `<option value="${esc(s.subject)}" ${subjectFilter===s.subject?'selected':''}>${esc(s.subject)}</option>`).join('')}
        </select>
        <select onchange="location.href='/school/smart-textbook/browse?grade='+this.value" style="width:auto;min-width:120px">
          <option value="">All Grades</option>
          ${grades.map(g => `<option value="${esc(g.grade)}" ${gradeFilter===g.grade?'selected':''}>${esc(g.grade)}</option>`).join('')}
        </select>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        ${textbooks.length ? textbooks.map(t => `<div class="card" style="border-top:4px solid ${P}">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
            <h3 style="color:#1f2937;margin:0;font-size:15px">${esc(t.title)}</h3>
            ${badge(t.status||'published', '#059669')}
          </div>
          <div style="color:${GRAY};font-size:12px;margin-bottom:10px">${esc(t.author||'Unknown')} • ${esc(t.publisher||'')}</div>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:12px">
            ${badge(t.subject||'General', P)}
            ${t.grade ? badge(t.grade, '#7c3aed') : ''}
            <span style="color:${GRAY};font-size:11px">${t.total_chapters} chapters</span>
          </div>
          ${t.isbn ? `<div style="font-size:11px;color:${GRAY};margin-bottom:10px">ISBN: ${esc(t.isbn)}</div>` : ''}
          <div style="display:flex;gap:8px;margin-top:12px">
            <a href="/school/smart-textbook/read/${t.id}" class="btn" style="text-decoration:none;padding:6px 14px;font-size:12px">📖 Read</a>
            <a href="/school/smart-textbook/detail/${t.id}" style="color:${GRAY};text-decoration:none;font-size:12px;padding:6px 10px">Details →</a>
          </div>
        </div>`).join('') : '<div style="text-align:center;color:'+GRAY+';padding:40px;grid-column:1/-1">No textbooks found matching your criteria.</div>'}
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 3: Textbook Detail ────────────────────────────
  app.get('/school/smart-textbook/detail/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [textbook] = await pool.query('SELECT * FROM textbooks WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!textbook[0]) return res.redirect('/school/smart-textbook');

    const t = textbook[0];
    const [chapters] = await pool.query('SELECT id, chapter_num, title, status FROM textbook_chapters WHERE tenant_id=? AND textbook_id=? ORDER BY chapter_num', [tid, t.id]);

    res.send(renderPage('Textbook Detail', SKIP + `<div style="max-width:900px;margin:0 auto;padding:20px">
      <a href="/school/smart-textbook/browse" style="color:${P};text-decoration:none;font-size:13px">← Back to Library</a>
      <div class="card" style="margin-top:12px;border-top:4px solid ${P}">
        <h2 style="color:${P};margin:0 0 4px">${esc(t.title)}</h2>
        <p style="color:${GRAY};font-size:14px;margin:0 0 12px">by ${esc(t.author||'Unknown')}</p>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-top:16px">
          <div style="padding:10px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY};text-transform:uppercase">Subject</div><div style="font-weight:600;color:#1f2937">${esc(t.subject||'—')}</div></div>
          <div style="padding:10px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY};text-transform:uppercase">Grade</div><div style="font-weight:600;color:#1f2937">${esc(t.grade||'All')}</div></div>
          <div style="padding:10px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY};text-transform:uppercase">Publisher</div><div style="font-weight:600;color:#1f2937">${esc(t.publisher||'—')}</div></div>
          <div style="padding:10px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY};text-transform:uppercase">ISBN</div><div style="font-weight:600;color:#1f2937">${esc(t.isbn||'—')}</div></div>
          <div style="padding:10px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY};text-transform:uppercase">Chapters</div><div style="font-weight:600;color:#1f2937">${t.total_chapters}</div></div>
        </div>
      </div>

      <div class="card" style="margin-top:16px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3 style="color:${P};margin:0">📋 Table of Contents</h3>
          <a href="/school/smart-textbook/read/${t.id}" class="btn" style="text-decoration:none;padding:6px 16px;font-size:12px">📖 Start Reading</a>
        </div>
        ${chapters.length ? chapters.map((ch, i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f3f4f6">
          <div style="display:flex;align-items:center;gap:10px">
            <span style="background:${P};color:#fff;width:28px;height:28px;border-radius:6px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:bold">${ch.chapter_num}</span>
            <a href="/school/smart-textbook/read/${t.id}?chapter=${ch.id}" style="color:#1f2937;text-decoration:none;font-weight:500">${esc(ch.title)}</a>
          </div>
          ${badge(ch.status, ch.status==='published'?'#059669':'#d97706')}
        </div>`).join('') : '<p style="color:'+GRAY+';text-align:center;padding:20px">No chapters yet.</p>'}
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 4: Read Textbook ──────────────────────────────
  app.get('/school/smart-textbook/read/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const bookId = req.params.id;

    const [textbook] = await pool.query('SELECT * FROM textbooks WHERE id=? AND tenant_id=?', [bookId, tid]);
    if (!textbook[0]) return res.redirect('/school/smart-textbook');

    const t = textbook[0];
    const [chapters] = await pool.query('SELECT * FROM textbook_chapters WHERE tenant_id=? AND textbook_id=? AND status="published" ORDER BY chapter_num', [tid, bookId]);

    // Find target chapter
    let targetChapter = chapters.find(ch => ch.id == req.query.chapter);
    if (!targetChapter && chapters.length > 0) targetChapter = chapters[0];

    // Get or create progress
    const [existingProgress] = await pool.query('SELECT * FROM textbook_progress WHERE tenant_id=? AND student_id=? AND textbook_id=?', [tid, uid, bookId]);
    let progress = existingProgress[0];
    if (!progress) {
      await pool.query('INSERT INTO textbook_progress (tenant_id, student_id, textbook_id, current_chapter, last_accessed) VALUES (?, ?, ?, 1, NOW())', [tid, uid, bookId]);
      const [newProg] = await pool.query('SELECT * FROM textbook_progress WHERE tenant_id=? AND student_id=? AND textbook_id=?', [tid, uid, bookId]);
      progress = newProg[0];
    } else {
      const newChapter = targetChapter ? targetChapter.chapter_num : progress.current_chapter;
      const newPct = chapters.length > 0 ? Math.round((newChapter / chapters.length) * 100) : 0;
      await pool.query('UPDATE textbook_progress SET current_chapter=?, completion_pct=?, last_accessed=NOW() WHERE id=?', [newChapter, newPct, progress.id]);
    }

    const bookmarks = Array.isArray(progress.bookmarks) ? progress.bookmarks : [];
    const highlights = Array.isArray(progress.highlights) ? progress.highlights : [];
    const notes = Array.isArray(progress.notes) ? progress.notes : [];
    const chapterNotes = notes.filter(n => targetChapter && n.chapterId == targetChapter.id);
    const objectives = targetChapter && Array.isArray(targetChapter.objectives) ? targetChapter.objectives : [];
    const glossary = targetChapter && Array.isArray(targetChapter.glossary) ? targetChapter.glossary : [];
    const quiz = targetChapter && Array.isArray(targetChapter.quiz) ? targetChapter.quiz : [];

    res.send(renderPage('Read: ' + t.title, SKIP + `<div style="max-width:1000px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:10px">
        <div>
          <a href="/school/smart-textbook" style="color:${P};text-decoration:none;font-size:13px">← Back to Library</a>
          <h2 style="color:${P};margin:4px 0 0">${esc(t.title)}</h2>
        </div>
        <div style="display:flex;gap:8px">
          ${targetChapter ? `<button onclick="bookmarkChapter(${targetChapter.id})" class="btn" style="background:${bookmarks.includes(targetChapter.id)?'#f59e0b':P}">🔖 ${bookmarks.includes(targetChapter.id)?'Bookmarked':'Bookmark'}</button>` : ''}
          <button onclick="toggleNotes()" class="btn" style="background:#059669">📝 Notes</button>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:220px 1fr;gap:16px">
        <!-- Sidebar -->
        <div>
          <div class="card" style="position:sticky;top:20px">
            <h4 style="color:${P};margin:0 0 10px;font-size:13px">📖 Chapters</h4>
            ${chapters.map(ch => `<a href="/school/smart-textbook/read/${bookId}?chapter=${ch.id}" style="display:block;padding:6px 8px;margin:2px 0;border-radius:6px;text-decoration:none;font-size:12px;${targetChapter && targetChapter.id===ch.id?'background:'+P+';color:#fff;font-weight:600':'color:#374151'}">
              ${bookmarks.includes(ch.id)?'🔖 ':''}${ch.chapter_num}. ${esc(ch.title.length > 25 ? ch.title.substring(0,25)+'...' : ch.title)}
            </a>`).join('')||'<p style="color:'+GRAY+';font-size:12px">No chapters</p>'}
            <div style="margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb">
              <div style="font-size:11px;color:${GRAY}">Progress: ${progress.completion_pct}%</div>
              <div style="background:#f3f4f6;border-radius:20px;height:6px;margin-top:4px"><div style="background:${P};height:6px;border-radius:20px;width:${progress.completion_pct}%"></div></div>
            </div>
          </div>
        </div>

        <!-- Main Content -->
        <div>
          ${targetChapter ? `<div class="card" style="padding:28px;line-height:1.8;color:#374151">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
              <h3 style="color:${P};margin:0">Chapter ${targetChapter.chapter_num}: ${esc(targetChapter.title)}</h3>
              ${quiz.length ? `<a href="/school/smart-textbook/quiz/${bookId}?chapter=${targetChapter.id}" class="btn" style="background:#059669;text-decoration:none;padding:6px 14px;font-size:12px">📝 Chapter Quiz</a>` : ''}
            </div>

            ${objectives.length ? `<div style="background:#eef2ff;border-radius:10px;padding:14px;margin-bottom:20px">
              <h4 style="color:${P};margin:0 0 8px;font-size:14px">🎯 Learning Objectives</h4>
              <ul style="margin:0;padding-left:18px;font-size:13px">${objectives.map(o => `<li style="margin-bottom:3px">${esc(o)}</li>`).join('')}</ul>
            </div>` : ''}

            <div style="font-size:15px;white-space:pre-wrap">${esc(targetChapter.content || 'No content available for this chapter yet. Check back later!')}</div>

            ${glossary.length ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #e5e7eb">
              <h4 style="color:${P};margin:0 0 10px;font-size:14px">📖 Key Terms</h4>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                ${glossary.map(g => `<div style="padding:8px;background:#f9fafb;border-radius:8px"><strong style="color:${P};font-size:12px">${esc(g.term)}</strong><p style="color:${GRAY};font-size:11px;margin:2px 0 0">${esc(g.definition)}</p></div>`).join('')}
              </div>
            </div>` : ''}
          </div>` : '<div class="card" style="text-align:center;padding:40px;color:'+GRAY+'">No chapters available yet.</div>'}

          <!-- Navigation -->
          ${targetChapter ? `<div style="display:flex;justify-content:space-between;margin-top:12px">
            ${chapters.findIndex(ch => ch.id === targetChapter.id) > 0 ? `<a href="/school/smart-textbook/read/${bookId}?chapter=${chapters[chapters.findIndex(ch => ch.id === targetChapter.id) - 1].id}" class="btn" style="text-decoration:none">← Previous</a>` : '<span></span>'}
            ${chapters.findIndex(ch => ch.id === targetChapter.id) < chapters.length - 1 ? `<a href="/school/smart-textbook/read/${bookId}?chapter=${chapters[chapters.findIndex(ch => ch.id === targetChapter.id) + 1].id}" class="btn" style="text-decoration:none">Next →</a>` : '<span></span>'}
          </div>` : ''}
        </div>
      </div>

      <!-- Notes Panel -->
      <div id="notes-panel" style="display:none;position:fixed;top:0;right:0;width:380px;height:100vh;background:#fff;box-shadow:-4px 0 20px rgba(0,0,0,.1);z-index:9999;overflow-y:auto;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h3 style="color:${P};margin:0">📝 Chapter Notes</h3>
          <button onclick="toggleNotes()" style="background:none;border:none;font-size:24px;cursor:pointer;color:${GRAY}">✕</button>
        </div>
        ${targetChapter ? `<form method="POST" action="/school/smart-textbook/notes/save" style="display:flex;flex-direction:column;gap:10px">
          <input type="hidden" name="textbook_id" value="${bookId}">
          <input type="hidden" name="chapter_id" value="${targetChapter.id}">
          <textarea name="note" rows="4" placeholder="Add a note for this chapter..." required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;resize:vertical"></textarea>
          <button type="submit" class="btn" style="width:100%">💾 Save Note</button>
        </form>` : ''}
        <div style="margin-top:16px">
          <h4 style="color:#1f2937;margin:0 0 10px;font-size:14px">Saved Notes</h4>
          ${chapterNotes.length ? chapterNotes.map(n => `<div style="padding:10px;background:#f9fafb;border-radius:8px;margin-bottom:8px">
            <p style="color:#374151;font-size:13px;margin:0">${esc(n.text)}</p>
            <div style="color:${GRAY};font-size:11px;margin-top:4px">${new Date(n.time).toLocaleString()}</div>
          </div>`).join('') : '<p style="color:'+GRAY+';font-size:13px">No notes yet for this chapter.</p>'}
        </div>
      </div>

      <script>
        function toggleNotes() { document.getElementById('notes-panel').style.display = document.getElementById('notes-panel').style.display === 'none' ? 'block' : 'none'; }
        function bookmarkChapter(chId) { fetch('/school/smart-textbook/bookmark/${bookId}/'+chId, {method:'POST'}).then(r=>r.json()).then(d=>{if(d.ok)window.location.reload();}); }
      </script>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 5: Save Note ──────────────────────────────────
  app.post('/school/smart-textbook/notes/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { textbook_id, chapter_id, note } = req.body;

    const [progress] = await pool.query('SELECT * FROM textbook_progress WHERE tenant_id=? AND student_id=? AND textbook_id=?', [tid, uid, textbook_id]);
    if (!progress[0]) return res.redirect('/school/smart-textbook');

    const notes = Array.isArray(progress[0].notes) ? progress[0].notes : [];
    notes.push({ chapterId: parseInt(chapter_id), text: note, time: new Date().toISOString() });

    await pool.query('UPDATE textbook_progress SET notes=? WHERE id=? AND tenant_id=?', [JSON.stringify(notes), progress[0].id, tid]);
    res.redirect('/school/smart-textbook/read/' + textbook_id + '?chapter=' + chapter_id);
  }));

  // ─── ROUTE 6: Bookmark Chapter ───────────────────────────
  app.post('/school/smart-textbook/bookmark/:bookId/:chapterId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { bookId, chapterId } = req.params;

    const [progress] = await pool.query('SELECT * FROM textbook_progress WHERE tenant_id=? AND student_id=? AND textbook_id=?', [tid, uid, bookId]);
    if (!progress[0]) {
      await pool.query('INSERT INTO textbook_progress (tenant_id, student_id, textbook_id, bookmarks) VALUES (?, ?, ?, ?)', [tid, uid, bookId, JSON.stringify([parseInt(chapterId)])]);
      return res.json({ ok: true });
    }

    const bookmarks = Array.isArray(progress[0].bookmarks) ? progress[0].bookmarks : [];
    const idx = bookmarks.indexOf(parseInt(chapterId));
    if (idx >= 0) bookmarks.splice(idx, 1);
    else bookmarks.push(parseInt(chapterId));

    await pool.query('UPDATE textbook_progress SET bookmarks=? WHERE id=? AND tenant_id=?', [JSON.stringify(bookmarks), progress[0].id, tid]);
    res.json({ ok: true });
  }));

  // ─── ROUTE 7: Chapter Quiz ───────────────────────────────
  app.get('/school/smart-textbook/quiz/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [chapter] = await pool.query('SELECT tc.*, t.title as textbook_title FROM textbook_chapters tc JOIN textbooks t ON t.id=tc.textbook_id WHERE tc.id=? AND tc.tenant_id=?', [req.query.chapter, tid]);
    if (!chapter[0]) return res.redirect('/school/smart-textbook');

    const ch = chapter[0];
    const quiz = Array.isArray(ch.quiz) ? ch.quiz : [];

    // Default quiz if none defined
    const defaultQuiz = [
      {q:'What is the main topic of this chapter?', options:['Topic A','Topic B','Topic C','Topic D'], answer:0},
      {q:'Which concept was most emphasized?', options:['Concept 1','Concept 2','Concept 3','Concept 4'], answer:1},
      {q:'What is a key takeaway from this chapter?', options:['Takeaway A','Takeaway B','Takeaway C','Takeaway D'], answer:2}
    ];

    const questions = quiz.length > 0 ? quiz : defaultQuiz;

    res.send(renderPage('Chapter Quiz', SKIP + `<div style="max-width:800px;margin:0 auto;padding:20px">
      <a href="/school/smart-textbook/read/${ch.textbook_id}?chapter=${ch.id}" style="color:${P};text-decoration:none;font-size:13px">← Back to Chapter</a>
      <h2 style="color:${P};margin:12px 0 4px">📝 Chapter Quiz</h2>
      <p style="color:${GRAY};margin:0 0 20px">${esc(ch.textbook_title)} — ${esc(ch.title)}</p>

      <form method="POST" action="/school/smart-textbook/quiz/submit">
        <input type="hidden" name="textbook_id" value="${ch.textbook_id}">
        <input type="hidden" name="chapter_id" value="${ch.id}">
        ${questions.map((q, i) => `<div class="card" style="border-left:4px solid ${P}">
          <h4 style="color:#1f2937;margin:0 0 12px">Q${i+1}. ${esc(q.q)}</h4>
          <div style="display:grid;gap:6px">
            ${q.options.map((opt, j) => `<label style="display:flex;align-items:center;gap:8px;padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer">
              <input type="radio" name="q_${i}" value="${j}" required style="width:auto">
              <span style="font-size:14px">${esc(opt)}</span>
            </label>`).join('')}
          </div>
          <input type="hidden" name="a_${i}" value="${q.answer}">
        </div>`).join('')}
        <button type="submit" class="btn" style="padding:12px 28px;font-size:15px;margin-top:16px">📋 Submit Quiz</button>
      </form>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 8: Submit Quiz ────────────────────────────────
  app.post('/school/smart-textbook/quiz/submit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { textbook_id, chapter_id } = req.body;

    // Count questions
    let i = 0;
    let correct = 0;
    const results = [];
    while (req.body['q_' + i] !== undefined) {
      const userAns = parseInt(req.body['q_' + i]);
      const correctAns = parseInt(req.body['a_' + i]);
      const isCorrect = userAns === correctAns;
      if (isCorrect) correct++;
      results.push({ index: i, isCorrect, userAns, correctAns });
      i++;
    }

    const score = i > 0 ? Math.round((correct / i) * 100) : 0;

    res.send(renderPage('Quiz Results', SKIP + `<div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="text-align:center;padding:30px;border-radius:16px;background:${score>=60?'#f0fdf4':'#fef2f2'};margin-bottom:20px">
        <div style="font-size:48px">${score >= 80 ? '🎉' : score >= 60 ? '👍' : '📚'}</div>
        <h2 style="color:${P};margin:8px 0 0">Score: ${score}%</h2>
        <p style="color:${GRAY}">${correct}/${i} correct</p>
      </div>
      <div style="display:grid;gap:8px;margin-bottom:20px">
        ${results.map(r => `<div style="padding:12px;border-radius:8px;background:${r.isCorrect?'#f0fdf4':'#fef2f2'};border-left:3px solid ${r.isCorrect?'#059669':'#dc2626'}">
          <span style="font-weight:600;color:#1f2937">Q${r.index+1}</span>
          <span style="margin-left:8px">${r.isCorrect?'✅ Correct':'❌ Incorrect'}</span>
        </div>`).join('')}
      </div>
      <div style="display:flex;gap:10px">
        <a href="/school/smart-textbook/read/${textbook_id}?chapter=${chapter_id}" class="btn" style="text-decoration:none">← Back to Chapter</a>
        <a href="/school/smart-textbook/read/${textbook_id}" class="btn" style="background:#059669;text-decoration:none">Continue Reading →</a>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 9: My Books ───────────────────────────────────
  app.get('/school/smart-textbook/my-books', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [progress] = await pool.query('SELECT tp.*, t.title, t.subject, t.author, t.total_chapters, t.cover_url FROM textbook_progress tp JOIN textbooks t ON t.id=tp.textbook_id WHERE tp.tenant_id=? AND tp.student_id=? ORDER BY tp.last_accessed DESC', [tid, uid]);

    res.send(renderPage('My Books', SKIP + `<div style="max-width:1000px;margin:0 auto;padding:20px">
      ${nav('mine')}
      <h2 style="color:${P};margin:0 0 20px">📕 My Books</h2>
      ${progress.length ? `<div style="display:grid;gap:12px">
        ${progress.map(p => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;border-left:4px solid ${p.completion_pct===100?'#059669':P}">
          <div style="display:flex;gap:14px;align-items:center">
            <div style="width:50px;height:65px;border-radius:8px;background:linear-gradient(135deg,${P},#7c3aed);display:flex;align-items:center;justify-content:center;color:#fff;font-size:22px">📕</div>
            <div>
              <a href="/school/smart-textbook/read/${p.textbook_id}" style="color:${P};text-decoration:none;font-weight:600;font-size:15px">${esc(p.title)}</a>
              <div style="color:${GRAY};font-size:12px;margin-top:2px">${esc(p.subject)} • ${esc(p.author||'')} • Ch. ${p.current_chapter}/${p.total_chapters}</div>
            </div>
          </div>
          <div style="text-align:right;min-width:150px">
            <div style="font-weight:700;color:${p.completion_pct===100?'#059669':P};font-size:16px">${p.completion_pct}%</div>
            <div style="background:#f3f4f6;border-radius:20px;height:8px;margin-top:4px;overflow:hidden"><div style="background:${p.completion_pct===100?'#059669':P};height:8px;border-radius:20px;width:${p.completion_pct}%"></div></div>
            <div style="color:${GRAY};font-size:11px;margin-top:3px">Last: ${p.last_accessed ? new Date(p.last_accessed).toLocaleDateString() : '—'}</div>
          </div>
        </div>`).join('')}
      </div>` : '<div class="card" style="text-align:center;padding:40px;color:'+GRAY+'">You haven\'t started reading any books yet. Browse the library to begin!</div>'}
    </div>`, req.session.user));
  }));

  // ─── ROUTE 10: All Notes ─────────────────────────────────
  app.get('/school/smart-textbook/notes', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [progress] = await pool.query('SELECT tp.*, t.title as textbook_title FROM textbook_progress tp JOIN textbooks t ON t.id=tp.textbook_id WHERE tp.tenant_id=? AND tp.student_id=? AND tp.notes IS NOT NULL', [tid, uid]);

    const allNotes = [];
    for (const p of progress) {
      const notes = Array.isArray(p.notes) ? p.notes : [];
      notes.forEach(n => { allNotes.push({ ...n, textbookId: p.textbook_id, textbookTitle: p.textbook_title }); });
    }
    allNotes.sort((a, b) => new Date(b.time) - new Date(a.time));

    res.send(renderPage('My Notes', SKIP + `<div style="max-width:900px;margin:0 auto;padding:20px">
      ${nav('notes')}
      <h2 style="color:${P};margin:0 0 20px">📝 All Notes</h2>
      ${allNotes.length ? `<div style="display:grid;gap:10px">
        ${allNotes.map(n => `<div class="card" style="border-left:3px solid ${P}">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
            <span style="font-size:12px;color:${GRAY}">📕 ${esc(n.textbookTitle)} • Chapter ${n.chapterId}</span>
            <span style="font-size:11px;color:${GRAY}">${new Date(n.time).toLocaleString()}</span>
          </div>
          <p style="color:#374151;font-size:14px;margin:0">${esc(n.text)}</p>
          <a href="/school/smart-textbook/read/${n.textbookId}?chapter=${n.chapterId}" style="color:${P};text-decoration:none;font-size:12px;margin-top:6px;display:inline-block">Go to Chapter →</a>
        </div>`).join('')}
      </div>` : '<div class="card" style="text-align:center;padding:40px;color:'+GRAY+'">No notes yet. Add notes while reading your textbooks!</div>'}
    </div>`, req.session.user));
  }));

  // ─── ROUTE 11: Highlights ────────────────────────────────
  app.get('/school/smart-textbook/highlights', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [progress] = await pool.query('SELECT tp.*, t.title as textbook_title FROM textbook_progress tp JOIN textbooks t ON t.id=tp.textbook_id WHERE tp.tenant_id=? AND tp.student_id=? AND tp.highlights IS NOT NULL', [tid, uid]);

    const allHighlights = [];
    for (const p of progress) {
      const highlights = Array.isArray(p.highlights) ? p.highlights : [];
      highlights.forEach(h => { allHighlights.push({ ...h, textbookId: p.textbook_id, textbookTitle: p.textbook_title }); });
    }

    res.send(renderPage('My Highlights', SKIP + `<div style="max-width:900px;margin:0 auto;padding:20px">
      ${nav('notes')}
      <h2 style="color:${P};margin:0 0 20px">🖍️ My Highlights</h2>
      ${allHighlights.length ? `<div style="display:grid;gap:10px">
        ${allHighlights.map(h => `<div class="card" style="background:#fffbeb;border-left:3px solid #f59e0b;padding:16px">
          <p style="color:#374151;font-size:14px;margin:0;font-style:italic">"${esc(h.text)}"</p>
          <div style="display:flex;justify-content:space-between;margin-top:8px">
            <span style="font-size:12px;color:${GRAY}">📕 ${esc(h.textbookTitle)}</span>
            <span style="font-size:11px;color:${GRAY}">${h.time ? new Date(h.time).toLocaleDateString() : ''}</span>
          </div>
        </div>`).join('')}
      </div>` : '<div class="card" style="text-align:center;padding:40px;color:'+GRAY+'">No highlights yet. Select text while reading to highlight it!</div>'}
    </div>`, req.session.user));
  }));

  // ─── ROUTE 12: Bookmarks ─────────────────────────────────
  app.get('/school/smart-textbook/bookmarks', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [progress] = await pool.query('SELECT tp.*, t.title as textbook_title, t.subject FROM textbook_progress tp JOIN textbooks t ON t.id=tp.textbook_id WHERE tp.tenant_id=? AND tp.student_id=?', [tid, uid]);

    const allBookmarks = [];
    for (const p of progress) {
      const bookmarks = Array.isArray(p.bookmarks) ? p.bookmarks : [];
      for (const chId of bookmarks) {
        const [chapter] = await pool.query('SELECT id, chapter_num, title FROM textbook_chapters WHERE id=? AND tenant_id=?', [chId, tid]);
        if (chapter[0]) allBookmarks.push({ ...chapter[0], textbookId: p.textbook_id, textbookTitle: p.textbook_title, subject: p.subject });
      }
    }

    res.send(renderPage('My Bookmarks', SKIP + `<div style="max-width:900px;margin:0 auto;padding:20px">
      ${nav('notes')}
      <h2 style="color:${P};margin:0 0 20px">🔖 My Bookmarks</h2>
      ${allBookmarks.length ? `<div style="display:grid;gap:10px">
        ${allBookmarks.map(b => `<div class="card" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <a href="/school/smart-textbook/read/${b.textbookId}?chapter=${b.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(b.textbookTitle)}</a>
            <div style="color:${GRAY};font-size:12px;margin-top:2px">Chapter ${b.chapter_num}: ${esc(b.title)} • ${esc(b.subject||'')}</div>
          </div>
          <a href="/school/smart-textbook/read/${b.textbookId}?chapter=${b.id}" class="btn" style="text-decoration:none;padding:6px 14px;font-size:12px">📖 Read</a>
        </div>`).join('')}
      </div>` : '<div class="card" style="text-align:center;padding:40px;color:'+GRAY+'">No bookmarks yet. Bookmark chapters while reading to save your place!</div>'}
    </div>`, req.session.user));
  }));

  // ─── ROUTE 13: Create Textbook (Teacher/Admin) ───────────
  app.get('/school/smart-textbook/create', requireAuth, ah(async (req, res) => {
    const subjects = ['Mathematics','Science','English','Physics','Chemistry','Biology','History','Geography','Computer Science','Economics','Art','Music'];
    const grades = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];

    res.send(renderPage('Create Textbook', SKIP + `<div style="max-width:700px;margin:0 auto;padding:20px">
      <a href="/school/smart-textbook" style="color:${P};text-decoration:none;font-size:13px">← Back to Library</a>
      <div class="card" style="padding:32px;margin-top:12px">
        <h2 style="color:${P};margin:0 0 20px">➕ Create New Textbook</h2>
        <form method="POST" action="/school/smart-textbook/save" style="display:flex;flex-direction:column;gap:16px">
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Title *</label>
            <input type="text" name="title" required placeholder="e.g., Advanced Mathematics" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div>
              <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Subject *</label>
              <select name="subject" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
                ${subjects.map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Grade</label>
              <select name="grade" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
                ${grades.map(g => `<option value="${g}">${g}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div>
              <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Author</label>
              <input type="text" name="author" placeholder="Author name" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
            </div>
            <div>
              <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Publisher</label>
              <input type="text" name="publisher" placeholder="Publisher name" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
            </div>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">ISBN</label>
            <input type="text" name="isbn" placeholder="e.g., 978-3-16-148410-0" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Cover Image URL</label>
            <input type="url" name="cover_url" placeholder="https://..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
          </div>
          <div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="publish" value="1" style="width:auto">
              <span style="font-size:13px;color:#374151">Publish immediately</span>
            </label>
          </div>
          <button type="submit" class="btn" style="padding:12px 28px;font-size:15px">💾 Create Textbook</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 14: Save Textbook ─────────────────────────────
  app.post('/school/smart-textbook/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { id, title, subject, grade, author, publisher, isbn, cover_url, publish } = req.body;

    const status = publish === '1' ? 'published' : 'draft';

    if (id) {
      await pool.query('UPDATE textbooks SET title=?, subject=?, grade=?, author=?, publisher=?, isbn=?, cover_url=?, status=? WHERE id=? AND tenant_id=?',
        [title, subject, grade, author, publisher, isbn, cover_url, status, id, tid]);
      audit({ action: 'update_textbook', textbookId: id, user: req.session.user });
    } else {
      await pool.query('INSERT INTO textbooks (tenant_id, title, subject, grade, author, publisher, isbn, cover_url, status, created_by) VALUES (?,?,?,?,?,?,?,?,?,?)',
        [tid, title, subject, grade, author, publisher, isbn, cover_url, status, uid]);
      audit({ action: 'create_textbook', title, subject, user: req.session.user });
    }
    res.redirect('/school/smart-textbook');
  }));

  // ─── ROUTE 15: Add Chapter ───────────────────────────────
  app.get('/school/smart-textbook/:id/chapter/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [textbook] = await pool.query('SELECT * FROM textbooks WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!textbook[0]) return res.redirect('/school/smart-textbook');
    const [existing] = await pool.query('SELECT chapter_num FROM textbook_chapters WHERE tenant_id=? AND textbook_id=? ORDER BY chapter_num DESC LIMIT 1', [tid, req.params.id]);
    const nextNum = existing.length > 0 ? existing[0].chapter_num + 1 : 1;

    res.send(renderPage('Add Chapter', SKIP + `<div style="max-width:700px;margin:0 auto;padding:20px">
      <a href="/school/smart-textbook/detail/${textbook[0].id}" style="color:${P};text-decoration:none;font-size:13px">← Back to Textbook</a>
      <div class="card" style="padding:32px;margin-top:12px">
        <h2 style="color:${P};margin:0 0 20px">➕ Add Chapter to "${esc(textbook[0].title)}"</h2>
        <form method="POST" action="/school/smart-textbook/chapter/save" style="display:flex;flex-direction:column;gap:16px">
          <input type="hidden" name="textbook_id" value="${textbook[0].id}">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div>
              <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Chapter Number</label>
              <input type="number" name="chapter_num" value="${nextNum}" min="1" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
            </div>
            <div>
              <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Title *</label>
              <input type="text" name="title" required placeholder="Chapter title" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
            </div>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Content *</label>
            <textarea name="content" rows="10" required placeholder="Chapter content (supports plain text)..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></textarea>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Learning Objectives (one per line)</label>
            <textarea name="objectives" rows="3" placeholder="Understand the basic principles...&#10;Apply concepts to solve problems..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></textarea>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Key Terms (format: term: definition, one per line)</label>
            <textarea name="glossary" rows="3" placeholder="Photosynthesis: The process by which plants convert light energy..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></textarea>
          </div>
          <div>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer">
              <input type="checkbox" name="publish" value="1" style="width:auto">
              <span style="font-size:13px;color:#374151">Publish immediately</span>
            </label>
          </div>
          <button type="submit" class="btn" style="padding:12px 28px;font-size:15px">💾 Save Chapter</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 16: Save Chapter ──────────────────────────────
  app.post('/school/smart-textbook/chapter/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id, textbook_id, chapter_num, title, content, objectives, glossary, publish } = req.body;

    const objectivesArr = objectives ? objectives.split('\n').filter(Boolean).map(s => s.trim()) : [];
    const glossaryArr = glossary ? glossary.split('\n').filter(Boolean).map(s => {
      const parts = s.split(':');
      return { term: (parts[0]||'').trim(), definition: (parts.slice(1).join(':')||'').trim() };
    }).filter(g => g.term) : [];
    const status = publish === '1' ? 'published' : 'draft';

    if (id) {
      await pool.query('UPDATE textbook_chapters SET chapter_num=?, title=?, content=?, objectives=?, glossary=?, status=? WHERE id=? AND tenant_id=?',
        [chapter_num, title, content, JSON.stringify(objectivesArr), JSON.stringify(glossaryArr), status, id, tid]);
    } else {
      await pool.query('INSERT INTO textbook_chapters (tenant_id, textbook_id, chapter_num, title, content, objectives, glossary, status) VALUES (?,?,?,?,?,?,?,?)',
        [tid, textbook_id, chapter_num, title, content, JSON.stringify(objectivesArr), JSON.stringify(glossaryArr), status]);
    }

    // Update total_chapters
    const [cnt] = await pool.query('SELECT COUNT(*) as c FROM textbook_chapters WHERE tenant_id=? AND textbook_id=?', [tid, textbook_id]);
    await pool.query('UPDATE textbooks SET total_chapters=? WHERE id=? AND tenant_id=?', [cnt[0].c, textbook_id, tid]);

    audit({ action: 'save_chapter', textbookId: textbook_id, chapterNum: chapter_num, user: req.session.user });
    res.redirect('/school/smart-textbook/detail/' + textbook_id);
  }));

  // ─── ROUTE 17: Delete Textbook ───────────────────────────
  app.post('/school/smart-textbook/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM textbook_progress WHERE textbook_id=? AND tenant_id=?', [req.params.id, tid]);
    await pool.query('DELETE FROM textbook_chapters WHERE textbook_id=? AND tenant_id=?', [req.params.id, tid]);
    await pool.query('DELETE FROM textbooks WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    audit({ action: 'delete_textbook', textbookId: req.params.id, user: req.session.user });
    res.redirect('/school/smart-textbook');
  }));

};
