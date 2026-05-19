// ============================================================
// ANNOUNCEMENT SYSTEM MODULE — School SaaS Portal
// Admin broadcast system with priority levels, audience targeting,
// scheduling, read tracking, templates, and analytics.
// 12+ routes, PostgreSQL, tenant-aware.
// ============================================================
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const userEmail = (req) => req.session?.user?.email || '';
  const userName = (req) => req.session?.user?.name || req.session?.user?.email || '';
  const P = '#4f46e5', GRAY = '#6b7280';
  const PRIORITIES = { info: { label:'Info', color:'#3b82f6', bg:'#dbeafe' }, normal: { label:'Normal', color:'#6b7280', bg:'#f3f4f6' }, important: { label:'Important', color:'#d97706', bg:'#fef3c7' }, urgent: { label:'Urgent', color:'#ea580c', bg:'#ffedd5' }, emergency: { label:'Emergency', color:'#dc2626', bg:'#fee2e2' } };

  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:'+P+';color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:14px;display:inline-block;text-decoration:none}.btn:hover{background:#3730a3}.btn-sm{padding:5px 12px;font-size:13px}.btn-danger{background:#dc2626}.btn-danger:hover{background:#b91c1c}.btn-success{background:#059669}.btn-success:hover{background:#047857}.btn-outline{background:transparent;border:1px solid #d1d5db;color:#374151}.btn-outline:hover{background:#f3f4f6}table{width:100%;border-collapse:collapse}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:14px}th{background:#f9fafb;font-weight:600;color:#374151}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;font-size:14px}input:focus,select:focus,textarea:focus{outline:none;border-color:'+P+';box-shadow:0 0 0 3px rgba(79,70,229,.1)}textarea{min-height:100px;resize:vertical}.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center}.stat-num{font-size:28px;font-weight:700}.stat-lbl{font-size:13px;color:'+GRAY+';margin-top:4px}.tabs{display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:20px}.tab{padding:10px 20px;cursor:pointer;color:'+GRAY+';border-bottom:2px solid transparent;margin-bottom:-2px;font-size:14px;font-weight:500}.tab.active{color:'+P+';border-bottom-color:'+P+';font-weight:600}.tab:hover{color:'+P+'}.ann-card{border-left:4px solid '+GRAY+';border-radius:8px;padding:16px 20px;margin-bottom:12px;background:#fff;box-shadow:0 1px 2px rgba(0,0,0,.05)}.empty-state{text-align:center;padding:48px 20px;color:'+GRAY+'}.form-group{margin-bottom:16px}.form-label{display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:6px}.grid{display:grid;gap:16px}.grid-2{grid-template-columns:1fr 1fr}.grid-4{grid-template-columns:repeat(4,1fr)}.mt-1{margin-top:8px}.mt-2{margin-top:16px}.mb-1{margin-bottom:8px}.mb-2{margin-bottom:16px}.text-sm{font-size:13px}.text-muted{color:'+GRAY+'}.flex{display:flex;align-items:center;gap:8px}.flex-between{display:flex;justify-content:space-between;align-items:center}@media(max-width:640px){.grid-2,.grid-4{grid-template-columns:1fr}}</style>';

  const nav = (active) => `<div class="tabs"><a href="/school/announcements" class="tab ${active==='dash'?'active':''}">All</a><a href="/school/announcements/my" class="tab ${active==='my'?'active':''}">My Announcements</a><a href="/school/announcements/create" class="tab ${active==='create'?'active':''}">+ New</a><a href="/school/announcements/templates" class="tab ${active==='tpl'?'active':''}">Templates</a><a href="/school/announcements/stats" class="tab ${active==='stats'?'active':''}">Stats</a></div>`;

  // ─── Database Migration ──────────────────────────────────
  (async () => {
    const tables = [
      `CREATE TABLE IF NOT EXISTS announcements (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(500), body TEXT,
        priority VARCHAR(20) DEFAULT 'normal', audience JSONB DEFAULT '{"type":"all"}',
        author_email VARCHAR(255), is_pinned BOOLEAN DEFAULT false, is_published BOOLEAN DEFAULT true,
        scheduled_at TIMESTAMPTZ, published_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ,
        read_count INT DEFAULT 0, total_recipients INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE TABLE IF NOT EXISTS announcement_reads (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, announcement_id INT REFERENCES announcements(id) ON DELETE CASCADE,
        user_email VARCHAR(255), read_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(announcement_id, user_email)
      )`,
      `CREATE TABLE IF NOT EXISTS announcement_templates (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(255), subject VARCHAR(500),
        body_template TEXT, category VARCHAR(50), icon VARCHAR(10) DEFAULT '📢',
        created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
      )`,
      `CREATE INDEX IF NOT EXISTS idx_announcements_tenant ON announcements(tenant_id, created_at DESC)`,
      `CREATE INDEX IF NOT EXISTS idx_announcement_reads_tenant ON announcement_reads(tenant_id, announcement_id)`,
      `CREATE INDEX IF NOT EXISTS idx_ann_templates_tenant ON announcement_templates(tenant_id)`
    ];
    for (const sql of tables) { try { await pool.query(sql); } catch(e) { /* exists */ } }

    // Seed templates
    const t = 0;
    const seedTpl = [
      ['Emergency Alert', 'Emergency: [Subject]', '<h3 style="color:#dc2626">⚠️ EMERGENCY</h3><p>Dear [Role],</p><p>[Details of the emergency situation]</p><p>Please follow instructions immediately.</p><p>— [School Name] Administration</p>', 'emergency', '🚨'],
      ['School Event', 'Event: [Event Name]', '<h3>🎉 [Event Name]</h3><p>Date: [Date] | Time: [Time] | Venue: [Venue]</p><p>[Event Description]</p><p>All [Role]s are invited to attend.</p>', 'event', '🎪'],
      ['Exam Schedule', 'Exam Schedule: [Term/Semester]', '<h3>📋 Exam Schedule</h3><p>The following exams have been scheduled:</p><ul><li>[Subject 1] — [Date] at [Time]</li><li>[Subject 2] — [Date] at [Time]</li></ul><p>Please prepare accordingly.</p>', 'exam', '📝'],
      ['Holiday Notice', 'Holiday: [Holiday Name]', '<h3>🏖️ Holiday Notice</h3><p>This is to inform you that [School Name] will be closed on <strong>[Date]</strong> in observance of <strong>[Holiday Name]</strong>.</p><p>Classes resume on [Resumption Date].</p>', 'holiday', '📅'],
      ['General Reminder', 'Reminder: [Subject]', '<h3>📌 Reminder</h3><p>Dear [Role],</p><p>This is a gentle reminder that [Details].</p><p>Please take the necessary action by [Deadline].</p><p>Thank you.</p>', 'general', '💬']
    ];
    for (const [name, subject, body, cat, icon] of seedTpl) {
      try { await pool.query(`INSERT INTO announcement_templates(tenant_id,name,subject,body_template,category,icon,created_by) VALUES($1,$2,$3,$4,$5,$6,'system') ON CONFLICT DO NOTHING`, [t, name, subject, body, cat, icon]); } catch(e) { /* exists */ }
    }
  })();

  // ─── Helpers ──────────────────────────────────────────────
  function fmtDate(d) { return d ? new Date(d).toLocaleDateString('en-GB', { day:'2-digit', month:'short', year:'numeric' }) : '—'; }
  function fmtDateTime(d) { return d ? new Date(d).toLocaleString('en-GB', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' }) : '—'; }
  function timeAgo(d) {
    if (!d) return '';
    const s = Math.floor((Date.now() - new Date(d).getTime()) / 1000);
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s/60) + 'm ago';
    if (s < 86400) return Math.floor(s/3600) + 'h ago'; return Math.floor(s/86400) + 'd ago';
  }
  function priStyle(p) { return PRIORITIES[p] || PRIORITIES.normal; }

  // ─── 1. Dashboard ────────────────────────────────────────
  app.get('/school/announcements', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [active, pinned, recent, total, totalRead] = await Promise.all([
      pool.query('SELECT * FROM announcements WHERE tenant_id=$1 AND is_published=true AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY is_pinned DESC, published_at DESC LIMIT 20', [tid]),
      pool.query('SELECT * FROM announcements WHERE tenant_id=$1 AND is_pinned=true AND is_published=true AND (expires_at IS NULL OR expires_at>NOW()) ORDER BY published_at DESC', [tid]),
      pool.query('SELECT a.*, (SELECT COUNT(*) FROM announcement_reads r WHERE r.announcement_id=a.id AND r.tenant_id=a.tenant_id)::int as my_reads FROM announcements a WHERE a.tenant_id=$1 ORDER BY a.created_at DESC LIMIT 5', [tid]),
      pool.query('SELECT COUNT(*) FROM announcements WHERE tenant_id=$1', [tid]),
      pool.query('SELECT COUNT(*) FROM announcement_reads WHERE tenant_id=$1', [tid])
    ]);
    const announcements = active.rows;
    const pinnedItems = pinned.rows;
    const totalCount = parseInt(total.rows[0].count);
    const readTotal = parseInt(totalRead.rows[0].count);
    res.send(renderPage('Announcements', SKIP + nav('dash') + `
      <div class="grid grid-4 mb-2">
        <div class="stat-card"><div class="stat-num" style="color:${P}">${announcements.length}</div><div class="stat-lbl">📢 Active</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#d97706">${pinnedItems.length}</div><div class="stat-lbl">📌 Pinned</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${totalCount}</div><div class="stat-lbl">📊 Total</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${readTotal}</div><div class="stat-lbl">👁️ Reads</div></div>
      </div>
      ${pinnedItems.length ? '<h3 style="margin-bottom:12px">📌 Pinned</h3>' + pinnedItems.map(a => renderCard(a, req).replace('ann-card','ann-card')).join('') + '<hr style="margin:16px 0;border-color:#e5e7eb">' : ''}
      <div class="flex-between mb-1"><h3>All Announcements</h3><a href="/school/announcements/create" class="btn btn-sm">+ New</a></div>
      ${announcements.length ? announcements.map(a => renderCard(a, req)).join('') : '<div class="empty-state"><p>No announcements yet</p></div>'}`, req.session.user));
  }));

  function renderCard(a, req) {
    const ps = priStyle(a.priority);
    return `<div class="ann-card" style="border-left-color:${ps.color}">
      <div class="flex-between">
        <div><strong>${esc(a.title)}</strong> <span class="badge" style="background:${ps.bg};color:${ps.color}">${ps.label}</span>
          ${a.is_pinned ? '<span class="badge" style="background:#fef3c7;color:#d97706">📌 Pinned</span>' : ''}</div>
        <span class="text-sm text-muted">${timeAgo(a.published_at)}</span>
      </div>
      <div class="text-sm text-muted mt-1" style="max-height:60px;overflow:hidden">${esc(a.body||'').substring(0, 200)}${(a.body||'').length > 200 ? '...' : ''}</div>
      <div class="flex mt-1">
        <span class="text-sm text-muted">By ${esc(a.author_email)} · ${fmtDate(a.published_at)}</span>
        <span class="text-sm text-muted" style="margin-left:auto">👁️ ${a.read_count}/${a.total_recipients}</span>
        <a href="/school/announcements/${a.id}" class="btn btn-sm btn-outline" style="margin-left:8px">View</a>
      </div>
    </div>`;
  }

  // ─── 2. Create ───────────────────────────────────────────
  app.get('/school/announcements/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const tpls = (await pool.query('SELECT * FROM announcement_templates WHERE tenant_id IN (0,$1) ORDER BY category', [tid])).rows;
    res.send(renderPage('New Announcement', SKIP + nav('create') + `
      <div class="card">
        <h3>Create Announcement</h3>
        <form method="POST" action="/school/announcements/create" id="annForm">
          <div class="grid grid-2">
            <div class="form-group"><label class="form-label">Title *</label><input name="title" required placeholder="Announcement title"></div>
            <div class="form-group"><label class="form-label">Priority</label><select name="priority">
              ${Object.entries(PRIORITIES).map(([k,v]) => `<option value="${k}">${v.label}</option>`).join('')}
            </select></div>
          </div>
          <div class="form-group"><label class="form-label">Body *</label><textarea name="body" required placeholder="Write your announcement... (HTML allowed)" rows="6"></textarea></div>
          <div class="grid grid-2">
            <div class="form-group"><label class="form-label">Audience</label><select name="audience_type">
              <option value="all">Everyone</option><option value="admin">Admins</option><option value="teacher">Teachers</option><option value="parent">Parents</option><option value="student">Students</option>
            </select></div>
            <div class="form-group"><label class="form-label">Schedule (optional)</label><input type="datetime-local" name="scheduled_at"></div>
          </div>
          <div class="form-group"><label class="form-label">Expires (optional)</label><input type="datetime-local" name="expires_at"></div>
          ${tpls.length ? `<div class="form-group"><label class="form-label">Use Template</label><select id="tplSelect" onchange="loadTemplate()"><option value="">— Select template —</option>${tpls.map(t => `<option value="${t.id}">${t.icon} ${esc(t.name)}</option>`).join('')}</select></div>` : ''}
          <div class="flex mt-2"><button type="submit" class="btn btn-success">Publish</button><button type="submit" name="draft" value="1" class="btn btn-outline" style="margin-left:8px">Save as Draft</button><a href="/school/announcements" class="btn btn-outline" style="margin-left:8px">Cancel</a></div>
        </form>
      </div>
      <script>
        const tpls = ${JSON.stringify(tpls.map(t => ({ id:t.id, subject:t.subject, body:t.body_template })))};
        function loadTemplate() {
          const sel = document.getElementById('tplSelect');
          const tpl = tpls.find(t => t.id == sel.value);
          if (tpl) { document.querySelector('[name=title]').value = tpl.subject.replace(/\\[.*?\\]/g, ''); document.querySelector('[name=body]').value = tpl.body; }
        }
      </script>`, req.session.user));
  }));

  // ─── 3. POST Create ──────────────────────────────────────
  app.post('/school/announcements/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req); const email = userEmail(req);
    const { title, body, priority, audience_type, scheduled_at, expires_at } = req.body;
    const audience = { type: audience_type || 'all' };
    const isPublished = !req.body.draft;
    const result = await pool.query(`INSERT INTO announcements(tenant_id,title,body,priority,audience,author_email,is_published,scheduled_at,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [tid, title, body, priority||'normal', JSON.stringify(audience), email, isPublished, scheduled_at||null, expires_at||null]);
    audit(`Created announcement #${result.rows[0].id}: ${title}`);
    res.redirect('/school/announcements');
  }));

  // ─── 4. View Detail ──────────────────────────────────────
  app.get('/school/announcements/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req); const id = parseInt(req.params.id);
    const ann = (await pool.query('SELECT * FROM announcements WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!ann) return res.status(404).send('Announcement not found');
    const reads = (await pool.query('SELECT user_email, read_at FROM announcement_reads WHERE announcement_id=$1 AND tenant_id=$2 ORDER BY read_at DESC LIMIT 50', [id, tid])).rows;
    const ps = priStyle(ann.priority);
    const readPct = ann.total_recipients > 0 ? Math.round((ann.read_count / ann.total_recipients) * 100) : 0;
    res.send(renderPage(ann.title, SKIP + `
      <a href="/school/announcements" class="btn btn-outline btn-sm mb-2">← Back</a>
      <div class="ann-card" style="border-left-color:${ps.color};border-left-width:6px">
        <h2>${esc(ann.title)}</h2>
        <div class="flex mt-1"><span class="badge" style="background:${ps.bg};color:${ps.color}">${ps.label}</span><span class="text-sm text-muted">By ${esc(ann.author_email)} · ${fmtDateTime(ann.published_at)}</span></div>
        ${ann.is_pinned ? '<span class="badge" style="background:#fef3c7;color:#d97706;margin-left:8px">📌 Pinned</span>' : ''}
        <div class="mt-2" style="line-height:1.7">${ann.body}</div>
        ${ann.scheduled_at ? `<p class="text-sm text-muted mt-1">Scheduled: ${fmtDateTime(ann.scheduled_at)}</p>` : ''}
        ${ann.expires_at ? `<p class="text-sm text-muted">Expires: ${fmtDateTime(ann.expires_at)}</p>` : ''}
      </div>
      <div class="card mt-2">
        <h3>📊 Read Statistics</h3>
        <div class="flex mb-1"><strong>${ann.read_count}</strong><span class="text-muted"> / ${ann.total_recipients} read (${readPct}%)</span></div>
        <div style="background:#e5e7eb;border-radius:8px;height:12px;overflow:hidden"><div style="height:100%;border-radius:8px;background:${P};width:${readPct}%"></div></div>
      </div>
      <div class="card mt-1">
        <h3>👥 Read Receipts (${reads.length})</h3>
        <table><tr><th>User</th><th>Read At</th></tr>
          ${reads.length ? reads.map(r => `<tr><td>${esc(r.user_email)}</td><td>${fmtDateTime(r.read_at)}</td></tr>`).join('') : '<tr><td colspan="2" class="text-muted" style="text-align:center;padding:16px">No reads yet</td></tr>'}
        </table>
      </div>
      <div class="flex mt-1">
        <form method="POST" action="/school/announcements/${id}/pin"><button class="btn btn-sm ${ann.is_pinned?'btn-outline':'btn-success'}">${ann.is_pinned?'Unpin':'📌 Pin'}</button></form>
        <a href="/school/announcements" class="btn btn-outline btn-sm" style="margin-left:8px">← All</a>
      </div>`, req.session.user));
  }));

  // ─── 5. Edit ─────────────────────────────────────────────
  app.post('/school/announcements/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req); const id = parseInt(req.params.id);
    const { title, body, priority, audience_type, expires_at } = req.body;
    await pool.query('UPDATE announcements SET title=$1,body=$2,priority=$3,audience=$4,expires_at=$5,updated_at=NOW() WHERE id=$6 AND tenant_id=$7', [title, body, priority, JSON.stringify({type:audience_type||'all'}), expires_at||null, id, tid]);
    audit(`Edited announcement #${id}`); res.redirect(`/school/announcements/${id}`);
  }));

  // ─── 6. Delete ───────────────────────────────────────────
  app.post('/school/announcements/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req); const id = parseInt(req.params.id);
    await pool.query('DELETE FROM announcements WHERE id=$1 AND tenant_id=$2', [id, tid]);
    audit(`Deleted announcement #${id}`); res.redirect('/school/announcements');
  }));

  // ─── 7. Pin/Unpin ────────────────────────────────────────
  app.post('/school/announcements/:id/pin', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req); const id = parseInt(req.params.id);
    await pool.query('UPDATE announcements SET is_pinned = NOT is_pinned, updated_at=NOW() WHERE id=$1 AND tenant_id=$2', [id, tid]);
    audit(`Toggled pin on announcement #${id}`); res.redirect(`/school/announcements/${id}`);
  }));

  // ─── 8. History ──────────────────────────────────────────
  app.get('/school/announcements/history', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const q = req.query.q || ''; const pri = req.query.priority || '';
    let sql = 'SELECT * FROM announcements WHERE tenant_id=$1'; const params = [tid];
    if (q) { sql += ' AND (title ILIKE $2 OR body ILIKE $2)'; params.push(`%${q}%`); }
    if (pri) { sql += ` AND priority=$${params.length+1}`; params.push(pri); }
    sql += ' ORDER BY created_at DESC LIMIT 100';
    const anns = (await pool.query(sql, params)).rows;
    res.send(renderPage('Announcement History', SKIP + nav('dash') + `
      <div class="card">
        <div class="flex-between mb-1">
          <h3>History</h3>
          <form method="GET" class="flex" style="gap:8px"><input name="q" value="${esc(q)}" placeholder="Search..." style="width:200px"><select name="priority"><option value="">All priorities</option>${Object.entries(PRIORITIES).map(([k,v]) => `<option value="${k}" ${pri===k?'selected':''}>${v.label}</option>`).join('')}</select><button class="btn btn-sm">Search</button></form>
        </div>
        <table><tr><th>Title</th><th>Priority</th><th>Author</th><th>Date</th><th>Reads</th><th>Actions</th></tr>
          ${anns.length ? anns.map(a => { const ps = priStyle(a.priority); return `<tr><td><a href="/school/announcements/${a.id}">${esc(a.title)}</a></td><td><span class="badge" style="background:${ps.bg};color:${ps.color}">${ps.label}</span></td><td>${esc(a.author_email)}</td><td>${fmtDate(a.published_at)}</td><td>${a.read_count}/${a.total_recipients}</td><td><a href="/school/announcements/${a.id}" class="btn btn-sm btn-outline">View</a> <form method="POST" action="/school/announcements/${a.id}/delete" style="display:inline" onsubmit="return confirm('Delete?')"><button class="btn btn-sm btn-danger">Delete</button></form></td></tr>`; }).join('') : '<tr><td colspan="6" class="text-muted" style="text-align:center;padding:20px">No announcements found</td></tr>'}
        </table>
      </div>`, req.session.user));
  }));

  // ─── 9. My Announcements ─────────────────────────────────
  app.get('/school/announcements/my', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req); const email = userEmail(req);
    const all = (await pool.query('SELECT a.*, r.read_at IS NOT NULL as is_read FROM announcements a LEFT JOIN announcement_reads r ON r.announcement_id=a.id AND r.user_email=$2 AND r.tenant_id=$1 WHERE a.tenant_id=$1 AND a.is_published=true AND (a.expires_at IS NULL OR a.expires_at>NOW()) ORDER BY a.is_pinned DESC, a.published_at DESC', [tid, email])).rows;
    const unread = all.filter(a => !a.is_read).length;
    res.send(renderPage('My Announcements', SKIP + nav('my') + `
      <div class="flex-between mb-1"><h3>My Announcements <span class="badge" style="background:#fee2e2;color:#dc2626">${unread} unread</span></h3></div>
      ${all.length ? all.map(a => {
        const ps = priStyle(a.priority);
        return `<div class="ann-card" style="border-left-color:${ps.color};${!a.is_read?'background:#f0f4ff;font-weight:500':''}">
          <div class="flex-between"><strong>${esc(a.title)}</strong><span class="text-sm text-muted">${timeAgo(a.published_at)}</span></div>
          <div class="text-sm text-muted mt-1">${esc((a.body||'').substring(0,150))}...</div>
          <div class="flex mt-1">
            <span class="badge" style="background:${ps.bg};color:${ps.color}">${ps.label}</span>
            ${!a.is_read ? `<form method="POST" action="/school/announcements/${a.id}/read" style="display:inline"><button class="btn btn-sm btn-success">Mark Read</button></form>` : '<span class="badge" style="background:#d1fae5;color:#065f46">✓ Read</span>'}
            <a href="/school/announcements/${a.id}" class="btn btn-sm btn-outline" style="margin-left:8px">View</a>
          </div>
        </div>`;
      }).join('') : '<div class="empty-state"><p>No announcements for you yet</p></div>'}`, req.session.user));
  }));

  // ─── 10. Mark Read ───────────────────────────────────────
  app.post('/school/announcements/:id/read', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req); const email = userEmail(req); const id = parseInt(req.params.id);
    try {
      await pool.query('INSERT INTO announcement_reads(tenant_id,announcement_id,user_email) VALUES($1,$2,$3) ON CONFLICT DO NOTHING', [tid, id, email]);
      await pool.query('UPDATE announcements SET read_count=read_count+1 WHERE id=$1 AND tenant_id=$2', [id, tid]);
    } catch(e) { /* already read */ }
    const referer = req.headers.referer || '/school/announcements/my';
    res.redirect(referer);
  }));

  // ─── 11. Stats ───────────────────────────────────────────
  app.get('/school/announcements/stats', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [byPriority, byMonth, topAnn] = await Promise.all([
      pool.query("SELECT priority, COUNT(*)::int as cnt FROM announcements WHERE tenant_id=$1 GROUP BY priority ORDER BY cnt DESC", [tid]),
      pool.query("SELECT TO_CHAR(published_at,'YYYY-MM') as month, COUNT(*)::int as cnt FROM announcements WHERE tenant_id=$1 AND published_at IS NOT NULL GROUP BY month ORDER BY month DESC LIMIT 12", [tid]),
      pool.query('SELECT title, read_count, total_recipients, published_at FROM announcements WHERE tenant_id=$1 AND total_recipients>0 ORDER BY read_count DESC LIMIT 10', [tid])
    ]);
    const maxCnt = Math.max(...byPriority.rows.map(r => r.cnt), 1);
    const maxMonth = Math.max(...byMonth.rows.map(r => r.cnt), 1);
    res.send(renderPage('Announcement Stats', SKIP + nav('stats') + `
      <div class="grid grid-2 mb-2">
        <div class="card">
          <h3>📊 By Priority</h3>
          ${byPriority.rows.map(r => { const ps = priStyle(r.priority); return `<div style="margin-bottom:8px"><div class="flex-between text-sm"><span>${ps.label}</span><strong>${r.cnt}</strong></div><div style="background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden"><div style="height:100%;background:${ps.color};width:${Math.round(r.cnt/maxCnt*100)}%"></div></div></div>`; }).join('')}
        </div>
        <div class="card">
          <h3>📅 By Month</h3>
          ${byMonth.rows.map(r => `<div style="margin-bottom:8px"><div class="flex-between text-sm"><span>${esc(r.month)}</span><strong>${r.cnt}</strong></div><div style="background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden"><div style="height:100%;background:${P};width:${Math.round(r.cnt/maxMonth*100)}%"></div></div></div>`).join('')}
        </div>
      </div>
      <div class="card">
        <h3>🏆 Top Read Announcements</h3>
        <table><tr><th>Title</th><th>Reads</th><th>Total</th><th>Rate</th><th>Date</th></tr>
          ${topAnn.rows.map(a => { const rate = a.total_recipients > 0 ? Math.round(a.read_count/a.total_recipients*100) : 0; return `<tr><td>${esc(a.title)}</td><td>${a.read_count}</td><td>${a.total_recipients}</td><td><span class="badge" style="background:${rate>70?'#d1fae5':rate>40?'#fef3c7':'#fee2e2'};color:${rate>70?'#065f46':rate>40?'#92400e':'#991b1b'}">${rate}%</span></td><td>${fmtDate(a.published_at)}</td></tr>`; }).join('') || '<tr><td colspan="5" class="text-muted" style="text-align:center;padding:16px">No data yet</td></tr>'}
        </table>
      </div>`, req.session.user));
  }));

  // ─── 12. Templates ───────────────────────────────────────
  app.get('/school/announcements/templates', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const tpls = (await pool.query('SELECT * FROM announcement_templates WHERE tenant_id IN (0,$1) ORDER BY category, name', [tid])).rows;
    const cats = [...new Set(tpls.map(t => t.category))];
    res.send(renderPage('Announcement Templates', SKIP + nav('tpl') + `
      <div class="grid grid-2">
        ${cats.map(cat => `<div class="card"><h3>${cat.charAt(0).toUpperCase()+cat.slice(1)}</h3>
          ${tpls.filter(t => t.category === cat).map(t => `<div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px;margin-bottom:8px">
            <div class="flex"><strong>${t.icon} ${esc(t.name)}</strong><a href="/school/announcements/create" class="btn btn-sm btn-outline" style="margin-left:auto">Use</a></div>
            <div class="text-sm text-muted mt-1">${esc(t.subject)}</div>
          </div>`).join('')}
        </div>`).join('')}
      </div>`, req.session.user));
  }));

  console.log('[Announcements] Broadcast system loaded — 3 tables, 12 routes');
};
