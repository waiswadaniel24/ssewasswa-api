// ============================================================
// LEADERSHIP DEVELOPMENT PROGRAM MODULE
// Program modules, mentoring circles, 360-degree feedback,
// leadership challenges, community service leadership,
// project management training, team building activities,
// leadership journal, milestone badges
// ============================================================
// Tables: leadership_programs, leadership_enrollments,
//         leadership_feedback_360, leadership_journals
// Prefix: /school/leadership-program
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ── Helpers ──────────────────────────────────────────────
  const tid = (req) => req.tenant?.id || req.session?.tenant_id || opts.tenantId || 1;
  const pn = (v, fb) => { const n = parseFloat(v); return isNaN(n) ? (fb || 0) : n; };
  const pj = (v, fb) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || fb || {}); } catch(e) { return fb || {}; }};
  const pa = (v, fb) => { try { return typeof v === 'string' ? JSON.parse(v) : (Array.isArray(v) ? v : (fb || [])); } catch(e) { return fb || []; }};
  const scoreColor = (s) => s >= 80 ? '#059669' : s >= 60 ? '#d97706' : '#dc2626';
  const statusColor = (s) => s === 'active' ? '#059669' : s === 'completed' ? P : s === 'draft' ? GRAY : '#dc2626';
  const scoreBar = (pct, label) => {
    const c = scoreColor(pct);
    return '<div style="margin:4px 0"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px"><span>' + esc(label) + '</span><span style="color:' + c + ';font-weight:600">' + Math.round(pct) + '%</span></div><div style="background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden"><div style="background:' + c + ';height:100%;width:' + pct + '%;border-radius:6px"></div></div></div>';
  };
  const badgeSvg = (icon, label, earned) => {
    const bg = earned ? P : '#d1d5db';
    return '<div style="text-align:center;width:80px"><div style="width:56px;height:56px;border-radius:50%;background:' + bg + ';margin:0 auto 6px;display:flex;align-items:center;justify-content:center;font-size:24px;color:#fff;opacity:' + (earned ? 1 : 0.5) + '">' + icon + '</div><div style="font-size:11px;color:' + (earned ? P : GRAY) + '">' + esc(label) + '</div></div>';
  };

  // ── Nav helper ──────────────────────────────────────────
  function nav(active) {
    const links = [
      { href: '/school/leadership-program', label: 'Dashboard', key: 'dash' },
      { href: '/school/leadership-program/programs', label: 'Programs', key: 'prog' },
      { href: '/school/leadership-program/enrollments', label: 'Enrollments', key: 'enroll' },
      { href: '/school/leadership-program/feedback360', label: '360 Feedback', key: 'fb' },
      { href: '/school/leadership-program/journal', label: 'Journal', key: 'journal' },
      { href: '/school/leadership-program/challenges', label: 'Challenges', key: 'chal' },
      { href: '/school/leadership-program/badges', label: 'Badges', key: 'badges' },
      { href: '/school/leadership-program/analytics', label: 'Analytics', key: 'analytics' }
    ];
    return '<nav style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px">' +
      links.map(l => '<a href="' + l.href + '" style="padding:8px 14px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:500;' + (active === l.key ? 'background:' + P + ';color:#fff' : 'color:' + GRAY + ';background:#f3f4f6') + '">' + l.label + '</a>').join('') + '</nav>';
  }

  // ── DB Migration ────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS leadership_programs (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        title TEXT NOT NULL,
        description TEXT DEFAULT '',
        modules JSONB DEFAULT '[]',
        duration_weeks INTEGER DEFAULT 8,
        max_participants INTEGER DEFAULT 30,
        status TEXT DEFAULT 'active',
        start_date DATE,
        end_date DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS leadership_enrollments (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        program_id INTEGER REFERENCES leadership_programs(id),
        student_id INTEGER NOT NULL,
        progress_pct NUMERIC(5,2) DEFAULT 0,
        completed_modules JSONB DEFAULT '[]',
        mentor_id INTEGER DEFAULT 0,
        started_at TIMESTAMPTZ DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        status TEXT DEFAULT 'enrolled',
        badge_earned JSONB DEFAULT '[]'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS leadership_feedback_360 (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        student_id INTEGER NOT NULL,
        evaluator_id INTEGER DEFAULT 0,
        evaluator_role TEXT DEFAULT 'peer',
        criteria JSONB DEFAULT '{}',
        anonymous BOOLEAN DEFAULT false,
        submitted_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS leadership_journals (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 1,
        student_id INTEGER NOT NULL,
        entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
        reflection TEXT DEFAULT '',
        challenges TEXT DEFAULT '',
        learnings TEXT DEFAULT '',
        goals TEXT DEFAULT '',
        mood TEXT DEFAULT 'neutral',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // Indexes
      const idxs = [
        'idx_lp_tenant ON leadership_programs(tenant_id)',
        'idx_lp_status ON leadership_programs(tenant_id, status)',
        'idx_le_tenant ON leadership_enrollments(tenant_id)',
        'idx_le_student ON leadership_enrollments(tenant_id, student_id)',
        'idx_le_program ON leadership_enrollments(tenant_id, program_id)',
        'idx_le_status ON leadership_enrollments(tenant_id, status)',
        'idx_lf360_tenant ON leadership_feedback_360(tenant_id)',
        'idx_lf360_student ON leadership_feedback_360(tenant_id, student_id)',
        'idx_lj_tenant ON leadership_journals(tenant_id)',
        'idx_lj_student ON leadership_journals(tenant_id, student_id)',
        'idx_lj_date ON leadership_journals(tenant_id, entry_date DESC)'
      ];
      for (const i of idxs) { try { await pool.query('CREATE INDEX IF NOT EXISTS ' + i); } catch(e) {} }
      console.log('[leadership-program] OK');
    } catch(e) { console.warn('[leadership-program] Warn:', e.message); }
  })();

  // ================================================================
  // ROUTE 1: Dashboard
  // ================================================================
  app.get('/school/leadership-program', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const progs = await pool.query('SELECT COUNT(*)::int as cnt FROM leadership_programs WHERE tenant_id=$1', [t]);
    const enrolled = await pool.query('SELECT COUNT(*)::int as cnt FROM leadership_enrollments WHERE tenant_id=$1 AND status=$2', [t, 'enrolled']);
    const completed = await pool.query('SELECT COUNT(*)::int as cnt FROM leadership_enrollments WHERE tenant_id=$1 AND status=$2', [t, 'completed']);
    const avgProg = await pool.query('SELECT AVG(progress_pct)::numeric(5,1) as avg FROM leadership_enrollments WHERE tenant_id=$1', [t]);
    const feedback = await pool.query('SELECT COUNT(*)::int as cnt FROM leadership_feedback_360 WHERE tenant_id=$1', [t]);
    const journals = await pool.query('SELECT COUNT(*)::int as cnt FROM leadership_journals WHERE tenant_id=$1', [t]);
    const activePrograms = await pool.query('SELECT * FROM leadership_programs WHERE tenant_id=$1 AND status=$2 ORDER BY created_at DESC LIMIT 3', [t, 'active']);

    let progCards = '';
    activePrograms.rows.forEach(p => {
      const mods = pa(p.modules, []);
      progCards += '<div class="card"><h4 style="margin:0 0 4px">' + esc(p.title) + '</h4><p style="margin:0 0 8px;font-size:13px;color:' + GRAY + '">' + esc(p.description || '').substring(0, 80) + (p.description && p.description.length > 80 ? '...' : '') + '</p>' +
        '<div style="display:flex;gap:12px;font-size:12px;color:' + GRAY + '"><span>' + mods.length + ' modules</span><span>' + (p.duration_weeks || 0) + ' weeks</span><span>' + (p.max_participants || 0) + ' max</span></div></div>';
    });

    const page = renderPage('Leadership Development', SKIP + nav('dash') +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:24px">' +
        '<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:' + P + '">' + progs.rows[0].cnt + '</div><div style="color:' + GRAY + '">Programs</div></div>' +
        '<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#059669">' + enrolled.rows[0].cnt + '</div><div style="color:' + GRAY + '">Active</div></div>' +
        '<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#7c3aed">' + completed.rows[0].cnt + '</div><div style="color:' + GRAY + '">Completed</div></div>' +
        '<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#d97706">' + (avgProg.rows[0].avg || 0) + '%</div><div style="color:' + GRAY + '">Avg Progress</div></div>' +
        '<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#dc2626">' + feedback.rows[0].cnt + '</div><div style="color:' + GRAY + '">360 Feedback</div></div>' +
        '<div class="card" style="text-align:center"><div style="font-size:28px;font-weight:700;color:#0891b2">' + journals.rows[0].cnt + '</div><div style="color:' + GRAY + '">Journal Entries</div></div>' +
      '</div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px;margin-bottom:20px">' + (progCards || '<div class="card" style="text-align:center;color:' + GRAY + '">No active programs</div>') + '</div>' +
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><a href="/school/leadership-program/programs/new" class="btn" style="text-decoration:none">+ New Program</a>' +
      '<a href="/school/leadership-program/journal" class="btn" style="text-decoration:none;background:#059669">Write Journal</a>' +
      '<a href="/school/leadership-program/feedback360" class="btn" style="text-decoration:none;background:#7c3aed">360 Feedback</a></div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 2: Programs List
  // ================================================================
  app.get('/school/leadership-program/programs', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query('SELECT * FROM leadership_programs WHERE tenant_id=$1 ORDER BY created_at DESC', [t]);
    let rows = '';
    for (const p of r.rows) {
      const mods = pa(p.modules, []);
      const enrollR = await pool.query('SELECT COUNT(*)::int as cnt FROM leadership_enrollments WHERE tenant_id=$1 AND program_id=$2', [t, p.id]);
      const enrollCount = enrollR.rows[0].cnt;
      rows += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px"><div style="flex:1">' +
        '<div style="display:flex;gap:6px;margin-bottom:6px;flex-wrap:wrap"><span style="background:' + statusColor(p.status) + '1a;color:' + statusColor(p.status) + ';padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;text-transform:capitalize">' + esc(p.status) + '</span>' +
        (p.start_date ? '<span style="background:#f3f4f6;color:' + GRAY + ';padding:2px 10px;border-radius:12px;font-size:12px">' + esc(p.start_date) + '</span>' : '') +
        '</div>' +
        '<h4 style="margin:0 0 4px">' + esc(p.title) + '</h4>' +
        '<p style="margin:0 0 8px;font-size:14px;color:' + GRAY + '">' + esc(p.description || '') + '</p>' +
        '<div style="display:flex;gap:12px;font-size:13px;color:' + GRAY + ';flex-wrap:wrap"><span>' + mods.length + ' modules</span><span>' + (p.duration_weeks || 0) + ' weeks</span><span>' + enrollCount + '/' + (p.max_participants || 0) + ' enrolled</span></div>' +
        '</div><div style="display:flex;gap:6px"><a href="/school/leadership-program/programs/edit/' + p.id + '" class="btn" style="font-size:12px;padding:4px 10px">Edit</a>' +
        '<a href="/school/leadership-program/programs/view/' + p.id + '" class="btn" style="font-size:12px;padding:4px 10px;background:#059669">View</a>' +
        '<form method="post" action="/school/leadership-program/programs/delete" style="display:inline"><input type="hidden" name="id" value="' + p.id + '"><button type="submit" class="btn" style="font-size:12px;padding:4px 10px;background:#dc2626">Del</button></form></div></div></div>';
    }
    const page = renderPage('Leadership Programs', SKIP + nav('prog') +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h3>Programs (' + r.rows.length + ')</h3>' +
      '<a href="/school/leadership-program/programs/new" class="btn" style="text-decoration:none">+ Create Program</a></div>' +
      (rows || '<div class="card" style="text-align:center;color:' + GRAY + '">No programs created yet</div>'),
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 3: Create Program
  // ================================================================
  app.get('/school/leadership-program/programs/new', requireAuth, ah(async (req, res) => {
    const page = renderPage('Create Program', SKIP + nav('prog') +
      '<div class="card"><h3 style="margin:0 0 16px">Create Leadership Program</h3>' +
      '<form method="post" action="/school/leadership-program/programs">' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Program Title</label><input type="text" name="title" required placeholder="e.g., Emerging Leaders Program"></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="Program objectives and overview..."></textarea></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Duration (weeks)</label><input type="number" name="duration_weeks" min="1" max="52" value="8"></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Max Participants</label><input type="number" name="max_participants" min="1" value="30"></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status"><option value="draft">Draft</option><option value="active">Active</option><option value="closed">Closed</option></select></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Start Date</label><input type="date" name="start_date"></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">End Date</label><input type="date" name="end_date"></div>' +
        '</div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Modules (one per line)</label><textarea name="modules" rows="6" placeholder="Module 1: Self-Awareness & Personal Leadership\nModule 2: Communication & Influence\nModule 3: Team Dynamics\nModule 4: Strategic Thinking\nModule 5: Community Service\nModule 6: Project Management\nModule 7: Conflict Resolution\nModule 8: Capstone Project"></textarea></div>' +
        '<button type="submit" class="btn">Create Program</button></form></div>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/leadership-program/programs', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { title, description, duration_weeks, max_participants, status, start_date, end_date, modules } = req.body;
    const mods = (modules || '').split('\n').map(s => s.trim()).filter(Boolean).map((s, i) => ({ order: i + 1, title: s, completed: false }));
    await pool.query('INSERT INTO leadership_programs (tenant_id, title, description, modules, duration_weeks, max_participants, status, start_date, end_date) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)',
      [t, title, description || '', JSON.stringify(mods), pn(duration_weeks, 8), pn(max_participants, 30), status || 'draft', start_date || null, end_date || null]);
    audit('leadership_program_created', { title, tenant: t });
    res.redirect('/school/leadership-program/programs');
  }));

  // ================================================================
  // ROUTE 4: View Program Details
  // ================================================================
  app.get('/school/leadership-program/programs/view/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query('SELECT * FROM leadership_programs WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    if (!r.rows[0]) return res.status(404).send('Program not found');
    const p = r.rows[0];
    const mods = pa(p.modules, []);
    const enrollR = await pool.query('SELECT le.*, u.name as student_name FROM leadership_enrollments le LEFT JOIN users u ON u.id=le.student_id WHERE le.tenant_id=$1 AND le.program_id=$2 ORDER BY le.progress_pct DESC', [t, p.id]);

    let modHtml = '';
    mods.forEach((m, i) => {
      modHtml += '<div style="display:flex;gap:10px;align-items:center;padding:10px;background:' + (i % 2 === 0 ? '#f9fafb' : '#fff') + ';border-radius:8px;margin-bottom:4px">' +
        '<div style="width:32px;height:32px;border-radius:50%;background:' + P + ';color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700">' + (i + 1) + '</div>' +
        '<div style="flex:1"><span style="font-weight:500">' + esc(m.title) + '</span></div></div>';
    });

    let enrollHtml = '';
    enrollR.rows.forEach(e => {
      enrollHtml += '<tr><td>#' + e.student_id + '</td><td>' + esc(e.student_name || 'Student') + '</td>' +
        '<td>' + scoreBar(pn(e.progress_pct, 0), '') + '</td>' +
        '<td><span style="color:' + statusColor(e.status) + ';font-weight:600;text-transform:capitalize">' + esc(e.status) + '</span></td></tr>';
    });

    const page = renderPage(p.title, SKIP + nav('prog') +
      '<div class="card" style="margin-bottom:20px"><div style="display:flex;gap:12px;align-items:start;flex-wrap:wrap">' +
        '<div style="flex:1"><h2 style="margin:0 0 8px">' + esc(p.title) + '</h2><p style="color:' + GRAY + ';margin:0">' + esc(p.description || '') + '</p>' +
        '<div style="display:flex;gap:12px;margin-top:8px;font-size:13px;color:' + GRAY + '"><span>' + mods.length + ' modules</span><span>' + (p.duration_weeks || 0) + ' weeks</span><span>' + enrollR.rows.length + ' enrolled</span><span style="text-transform:capitalize">' + esc(p.status) + '</span></div></div>' +
        '<a href="/school/leadership-program/programs/edit/' + p.id + '" class="btn" style="text-decoration:none">Edit</a></div></div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">' +
        '<div class="card"><h4 style="margin:0 0 12px">Program Modules</h4>' + (modHtml || '<p style="color:' + GRAY + '">No modules defined</p>') + '</div>' +
        '<div class="card"><h4 style="margin:0 0 12px">Enrolled Students (' + enrollR.rows.length + ')</h4>' +
          (enrollHtml ? '<div style="overflow-x:auto"><table><tr><th>Student</th><th>Name</th><th>Progress</th><th>Status</th></tr>' + enrollHtml + '</table></div>' : '<p style="color:' + GRAY + '">No enrollments yet</p>') +
          '<form method="post" action="/school/leadership-program/enroll" style="margin-top:12px"><input type="hidden" name="program_id" value="' + p.id + '">' +
            '<div style="display:flex;gap:8px"><input type="number" name="student_id" placeholder="Student ID" required style="width:140px"><button type="submit" class="btn" style="padding:6px 14px">Enroll Student</button></div></form>' +
        '</div></div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 5: Edit Program
  // ================================================================
  app.get('/school/leadership-program/programs/edit/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query('SELECT * FROM leadership_programs WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    if (!r.rows[0]) return res.status(404).send('Program not found');
    const p = r.rows[0];
    const mods = pa(p.modules, []);
    const modsText = mods.map(m => m.title).join('\n');

    const page = renderPage('Edit Program', SKIP + nav('prog') +
      '<div class="card"><h3 style="margin:0 0 16px">Edit Program</h3>' +
      '<form method="post" action="/school/leadership-program/programs/update">' +
        '<input type="hidden" name="id" value="' + p.id + '">' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Title</label><input type="text" name="title" required value="' + esc(p.title) + '"></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3">' + esc(p.description || '') + '</textarea></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Duration (weeks)</label><input type="number" name="duration_weeks" min="1" value="' + (p.duration_weeks || 8) + '"></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Max Participants</label><input type="number" name="max_participants" min="1" value="' + (p.max_participants || 30) + '"></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Status</label><select name="status">' +
            ['draft','active','closed','archived'].map(s => '<option value="' + s + '"' + (p.status === s ? ' selected' : '') + '>' + s + '</option>').join('') +
          '</select></div></div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Start Date</label><input type="date" name="start_date" value="' + esc(p.start_date || '') + '"></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">End Date</label><input type="date" name="end_date" value="' + esc(p.end_date || '') + '"></div></div>' +
        '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Modules (one per line)</label><textarea name="modules" rows="6">' + esc(modsText) + '</textarea></div>' +
        '<button type="submit" class="btn">Update Program</button></form></div>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/leadership-program/programs/update', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { id, title, description, duration_weeks, max_participants, status, start_date, end_date, modules } = req.body;
    const mods = (modules || '').split('\n').map(s => s.trim()).filter(Boolean).map((s, i) => ({ order: i + 1, title: s, completed: false }));
    await pool.query('UPDATE leadership_programs SET title=$1, description=$2, modules=$3, duration_weeks=$4, max_participants=$5, status=$6, start_date=$7, end_date=$8, updated_at=NOW() WHERE id=$9 AND tenant_id=$10',
      [title, description || '', JSON.stringify(mods), pn(duration_weeks, 8), pn(max_participants, 30), status || 'active', start_date || null, end_date || null, id, t]);
    audit('leadership_program_updated', { id, tenant: t });
    res.redirect('/school/leadership-program/programs');
  }));

  // ================================================================
  // ROUTE 6: Delete Program
  // ================================================================
  app.post('/school/leadership-program/programs/delete', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query('DELETE FROM leadership_enrollments WHERE program_id=$1 AND tenant_id=$2', [req.body.id, t]);
    await pool.query('DELETE FROM leadership_programs WHERE id=$1 AND tenant_id=$2', [req.body.id, t]);
    audit('leadership_program_deleted', { id: req.body.id, tenant: t });
    res.redirect('/school/leadership-program/programs');
  }));

  // ================================================================
  // ROUTE 7: Enroll Student
  // ================================================================
  app.post('/school/leadership-program/enroll', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { program_id, student_id, mentor_id } = req.body;
    // Check max participants
    const progR = await pool.query('SELECT max_participants FROM leadership_programs WHERE id=$1 AND tenant_id=$2', [program_id, t]);
    if (progR.rows[0]) {
      const enrollCount = await pool.query('SELECT COUNT(*)::int as cnt FROM leadership_enrollments WHERE tenant_id=$1 AND program_id=$2', [t, program_id]);
      if (enrollCount.rows[0].cnt >= progR.rows[0].max_participants) {
        req.session = req.session || {};
        req.session.flash = { error: 'Program is full' };
        return res.redirect('/school/leadership-program/programs/view/' + program_id);
      }
    }
    await pool.query('INSERT INTO leadership_enrollments (tenant_id, program_id, student_id, mentor_id, status) VALUES ($1,$2,$3,$4,$5)',
      [t, program_id, student_id, pn(mentor_id, 0), 'enrolled']);
    audit('student_enrolled', { program_id, student_id, tenant: t });
    res.redirect('/school/leadership-program/programs/view/' + program_id);
  }));

  // ================================================================
  // ROUTE 8: Enrollments Management
  // ================================================================
  app.get('/school/leadership-program/enrollments', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const r = await pool.query(
      'SELECT le.*, lp.title as program_title, u.name as student_name FROM leadership_enrollments le JOIN leadership_programs lp ON lp.id=le.program_id LEFT JOIN users u ON u.id=le.student_id WHERE le.tenant_id=$1 ORDER BY le.started_at DESC LIMIT 100', [t]);
    let rows = '';
    r.rows.forEach(e => {
      const badges = pa(e.badge_earned, []);
      const badgeCount = badges.length;
      rows += '<div class="card" style="padding:14px"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">' +
        '<div><strong>Student #' + e.student_id + '</strong>' + (e.student_name ? ' <span style="color:' + GRAY + '">(' + esc(e.student_name) + ')</span>' : '') +
        '<br><span style="font-size:13px;color:' + GRAY + '">' + esc(e.program_title) + ' · ' + (e.mentor_id ? 'Mentor #' + e.mentor_id : 'No mentor') + '</span></div>' +
        '<div style="display:flex;align-items:center;gap:12px">' +
          '<div style="text-align:center"><div style="font-size:18px;font-weight:700;color:' + scoreColor(pn(e.progress_pct, 0)) + '">' + pn(e.progress_pct, 0) + '%</div><div style="font-size:11px;color:' + GRAY + '">Progress</div></div>' +
          (badgeCount ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:10px;font-size:12px">' + badgeCount + ' badges</span>' : '') +
          '<span style="color:' + statusColor(e.status) + ';font-weight:600;text-transform:capitalize;font-size:13px">' + esc(e.status) + '</span>' +
        '</div></div></div>';
    });
    const page = renderPage('Enrollments', SKIP + nav('enroll') +
      '<h3 style="margin:0 0 16px">All Enrollments (' + r.rows.length + ')</h3>' +
      (rows || '<div class="card" style="text-align:center;color:' + GRAY + '">No enrollments yet</div>'),
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 9: Update Enrollment Progress
  // ================================================================
  app.post('/school/leadership-program/enrollments/update', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { id, progress_pct, status, completed_modules } = req.body;
    const prog = pn(progress_pct, 0);
    const newStatus = prog >= 100 ? 'completed' : (status || 'enrolled');
    const completedAt = prog >= 100 ? new Date() : null;
    await pool.query('UPDATE leadership_enrollments SET progress_pct=$1, status=$2, completed_at=$3, completed_modules=$4 WHERE id=$5 AND tenant_id=$6',
      [prog, newStatus, completedAt, completed_modules || '[]', id, t]);
    audit('enrollment_updated', { id, progress: prog, tenant: t });
    res.json({ success: true });
  }));

  // ================================================================
  // ROUTE 10: 360-Degree Feedback
  // ================================================================
  app.get('/school/leadership-program/feedback360', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const studentId = req.query.student_id;
    let where = 'lf.tenant_id = $1';
    let params = [t];
    if (studentId) { where += ' AND lf.student_id = $2'; params.push(studentId); }
    const r = await pool.query(
      'SELECT lf.*, u.name as evaluator_name FROM leadership_feedback_360 lf LEFT JOIN users u ON u.id=lf.evaluator_id WHERE ' + where + ' ORDER BY lf.submitted_at DESC LIMIT 50', params);
    let rows = '';
    r.rows.forEach(f => {
      const criteria = pj(f.criteria, {});
      let bars = '';
      for (const [k, v] of Object.entries(criteria)) {
        bars += scoreBar(pn(v, 0), k);
      }
      rows += '<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;flex-wrap:wrap;gap:8px">' +
        '<div><strong>Student #' + f.student_id + '</strong><br><span style="font-size:13px;color:' + GRAY + '">by ' + esc(f.evaluator_name || 'Evaluator #' + f.evaluator_id) + ' (' + esc(f.evaluator_role) + ')' + (f.anonymous ? ' [Anonymous]' : '') + '</span></div>' +
        '<span style="font-size:12px;color:' + GRAY + '">' + esc(f.submitted_at ? f.submitted_at.toISOString().split('T')[0] : '') + '</span></div>' + bars + '</div>';
    });

    const page = renderPage('360-Degree Feedback', SKIP + nav('fb') +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px"><h3>360 Feedback</h3>' +
        '<div style="display:flex;gap:8px">' +
          '<form method="get" action="/school/leadership-program/feedback360" style="display:flex;gap:6px;align-items:center"><input type="number" name="student_id" placeholder="Student ID" value="' + esc(studentId || '') + '" style="width:120px"><button type="submit" class="btn" style="padding:6px 12px">Filter</button></form>' +
          '<a href="/school/leadership-program/feedback360/new" class="btn" style="text-decoration:none;background:#7c3aed">+ New Feedback</a></div></div>' +
      (rows || '<div class="card" style="text-align:center;color:' + GRAY + '">No feedback submitted yet</div>'),
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 11: Submit 360 Feedback
  // ================================================================
  app.get('/school/leadership-program/feedback360/new', requireAuth, ah(async (req, res) => {
    const criteria = ['Vision & Direction', 'Communication', 'Empowerment', 'Accountability', 'Integrity', 'Adaptability', 'Decision Making', 'Team Building', 'Emotional Intelligence', 'Mentoring'];
    let fields = '';
    criteria.forEach(c => {
      fields += '<div style="margin-bottom:8px"><label style="font-weight:500;font-size:13px;display:block;margin-bottom:2px">' + esc(c) + ' (0-100)</label><input type="number" name="score_' + c.replace(/\s/g, '_') + '" min="0" max="100" value="50"></div>';
    });
    const page = renderPage('Submit 360 Feedback', SKIP + nav('fb') +
      '<div class="card"><h3 style="margin:0 0 16px">Submit 360-Degree Feedback</h3>' +
      '<form method="post" action="/school/leadership-program/feedback360">' +
        '<div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Student ID</label><input type="number" name="student_id" required min="1"></div>' +
          '<div><label style="font-weight:600;display:block;margin-bottom:4px">Your Role</label><select name="evaluator_role"><option>peer</option><option>mentor</option><option>teacher</option><option>self</option><option>supervisor</option><option>community</option></select></div>' +
          '<div style="display:flex;align-items:end"><label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="checkbox" name="anonymous" value="true"> Submit anonymously</label></div>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-bottom:16px">' + fields + '</div>' +
        '<button type="submit" class="btn">Submit Feedback</button></form></div>',
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/leadership-program/feedback360', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { student_id, evaluator_role, anonymous } = req.body;
    const criteria = {};
    for (const key of Object.keys(req.body)) {
      if (key.startsWith('score_')) {
        criteria[key.replace('score_', '').replace(/_/g, ' ')] = pn(req.body[key], 50);
      }
    }
    await pool.query('INSERT INTO leadership_feedback_360 (tenant_id, student_id, evaluator_id, evaluator_role, criteria, anonymous) VALUES ($1,$2,$3,$4,$5,$6)',
      [t, student_id, req.session?.user?.id || 0, evaluator_role || 'peer', JSON.stringify(criteria), anonymous === 'true']);
    audit('feedback_360_submitted', { student_id, role: evaluator_role, anonymous, tenant: t });
    res.redirect('/school/leadership-program/feedback360');
  }));

  // ================================================================
  // ROUTE 12: Leadership Journal
  // ================================================================
  app.get('/school/leadership-program/journal', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const studentId = req.query.student_id;
    let where = 'tenant_id = $1';
    let params = [t];
    if (studentId) { where += ' AND student_id = $2'; params.push(studentId); }
    const r = await pool.query('SELECT * FROM leadership_journals WHERE ' + where + ' ORDER BY entry_date DESC, created_at DESC LIMIT 50', params);

    const moodIcons = { great: '😄', good: '🙂', neutral: '😐', challenging: '😔', tough: '😣' };
    let entries = '';
    r.rows.forEach(j => {
      const mood = moodIcons[j.mood] || '😐';
      entries += '<div class="card" style="border-left:4px solid ' + (j.mood === 'great' || j.mood === 'good' ? '#059669' : j.mood === 'tough' || j.mood === 'challenging' ? '#dc2626' : '#d97706') + '">' +
        '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">' +
        '<div><span style="font-size:24px">' + mood + '</span> <strong>Student #' + j.student_id + '</strong></div>' +
        '<span style="font-size:12px;color:' + GRAY + '">' + esc(j.entry_date) + '</span></div>' +
        (j.reflection ? '<p style="margin:4px 0"><strong style="font-size:12px;color:' + P + '">Reflection:</strong> ' + esc(j.reflection) + '</p>' : '') +
        (j.challenges ? '<p style="margin:4px 0"><strong style="font-size:12px;color:#dc2626">Challenges:</strong> ' + esc(j.challenges) + '</p>' : '') +
        (j.learnings ? '<p style="margin:4px 0"><strong style="font-size:12px;color:#059669">Learnings:</strong> ' + esc(j.learnings) + '</p>' : '') +
        (j.goals ? '<p style="margin:4px 0"><strong style="font-size:12px;color:#7c3aed">Goals:</strong> ' + esc(j.goals) + '</p>' : '') +
        '</div>';
    });

    const page = renderPage('Leadership Journal', SKIP + nav('journal') +
      '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px"><h3>Leadership Journal</h3>' +
        '<div style="display:flex;gap:8px"><form method="get" style="display:flex;gap:6px;align-items:center"><input type="number" name="student_id" placeholder="Student ID" value="' + esc(studentId || '') + '" style="width:120px"><button type="submit" class="btn" style="padding:6px 12px">Filter</button></form></div></div>' +
      '<div class="card" style="margin-bottom:20px"><h4 style="margin:0 0 12px">New Journal Entry</h4>' +
        '<form method="post" action="/school/leadership-program/journal">' +
          '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">' +
            '<div><label style="font-weight:600;display:block;margin-bottom:4px">Student ID</label><input type="number" name="student_id" required min="1"></div>' +
            '<div><label style="font-weight:600;display:block;margin-bottom:4px">Mood</label><select name="mood"><option value="great">😄 Great</option><option value="good" selected>🙂 Good</option><option value="neutral">😐 Neutral</option><option value="challenging">😔 Challenging</option><option value="tough">😣 Tough</option></select></div></div>' +
          '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Reflection</label><textarea name="reflection" rows="3" placeholder="What leadership moments stood out today?"></textarea></div>' +
          '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Challenges Faced</label><textarea name="challenges" rows="2" placeholder="What difficulties did you encounter?"></textarea></div>' +
          '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Learnings</label><textarea name="learnings" rows="2" placeholder="What did you learn?"></textarea></div>' +
          '<div style="margin-bottom:12px"><label style="font-weight:600;display:block;margin-bottom:4px">Goals</label><textarea name="goals" rows="2" placeholder="What are your next leadership goals?"></textarea></div>' +
          '<button type="submit" class="btn">Save Entry</button></form></div>' +
      (entries || '<div class="card" style="text-align:center;color:' + GRAY + '">No journal entries yet</div>'),
      req.session?.user);
    res.send(page);
  }));

  app.post('/school/leadership-program/journal', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { student_id, mood, reflection, challenges, learnings, goals } = req.body;
    await pool.query('INSERT INTO leadership_journals (tenant_id, student_id, entry_date, reflection, challenges, learnings, goals, mood) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [t, student_id, new Date().toISOString().split('T')[0], reflection || '', challenges || '', learnings || '', goals || '', mood || 'neutral']);
    audit('leadership_journal_entry', { student_id, mood, tenant: t });
    res.redirect('/school/leadership-program/journal');
  }));

  // ================================================================
  // ROUTE 13: Leadership Challenges
  // ================================================================
  app.get('/school/leadership-program/challenges', requireAuth, ah(async (req, res) => {
    const challenges = [
      { title: 'Community Service Day', type: 'Service', description: 'Organize and lead a community service activity involving at least 5 team members. Document the impact.', duration: '1 day', points: 100, icon: '🤝' },
      { title: 'Public Speaking Challenge', type: 'Communication', description: 'Deliver a 5-minute presentation on a leadership topic to an audience of 20+ people.', duration: '1 week', points: 75, icon: '🎤' },
      { title: 'Mentor a Peer', type: 'Mentoring', description: 'Mentor a younger student for 4 consecutive weeks with documented goals and outcomes.', duration: '4 weeks', points: 150, icon: '🧑‍🏫' },
      { title: 'Conflict Resolution Scenario', type: 'Interpersonal', description: 'Successfully mediate a team conflict using structured conflict resolution techniques.', duration: '1 week', points: 80, icon: '⚖️' },
      { title: 'Organize Team Event', type: 'Team Building', description: 'Plan and execute a team-building activity for your group. Gather feedback from all participants.', duration: '2 weeks', points: 100, icon: '🎯' },
      { title: 'Project Leadership', type: 'Project Mgmt', description: 'Lead a small project from planning through completion. Create timeline, delegate tasks, and deliver results.', duration: '4 weeks', points: 200, icon: '📋' },
      { title: 'Cross-cultural Communication', type: 'Diversity', description: 'Engage with students from a different background or culture. Document your learnings and perspectives gained.', duration: '2 weeks', points: 90, icon: '🌍' },
      { title: 'Innovation Proposal', type: 'Strategic', description: 'Identify a school improvement opportunity, develop a proposal, and present it to school administration.', duration: '3 weeks', points: 120, icon: '💡' },
      { title: 'Crisis Management Simulation', type: 'Resilience', description: 'Participate in a crisis management simulation and demonstrate decision-making under pressure.', duration: '1 day', points: 85, icon: '🚨' },
      { title: 'Fundraising Lead', type: 'Service', description: 'Lead a fundraising initiative for a charitable cause. Set a target, organize the effort, and document results.', duration: '4 weeks', points: 180, icon: '💰' }
    ];

    let cards = '';
    challenges.forEach(c => {
      cards += '<div class="card"><div style="display:flex;gap:10px;align-items:start">' +
        '<div style="font-size:32px">' + c.icon + '</div><div style="flex:1">' +
        '<div style="display:flex;gap:6px;margin-bottom:4px;flex-wrap:wrap"><span style="font-weight:600">' + esc(c.title) + '</span><span style="background:#eef2ff;color:' + P + ';padding:1px 8px;border-radius:10px;font-size:11px">' + esc(c.type) + '</span></div>' +
        '<p style="margin:0 0 8px;font-size:13px;color:' + GRAY + '">' + esc(c.description) + '</p>' +
        '<div style="display:flex;gap:12px;font-size:12px;color:' + GRAY + '"><span>Duration: ' + esc(c.duration) + '</span><span style="color:' + P + ';font-weight:600">' + c.points + ' pts</span></div>' +
        '</div></div></div>';
    });

    const page = renderPage('Leadership Challenges', SKIP + nav('chal') +
      '<div class="card" style="margin-bottom:16px;background:linear-gradient(135deg,#7c3aed,' + P + ');color:#fff"><h3 style="margin:0 0 8px">Leadership Challenges</h3><p style="margin:0;opacity:0.9">Complete challenges to earn badges and develop real-world leadership skills</p></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">' + cards + '</div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 14: Milestone Badges
  // ================================================================
  app.get('/school/leadership-program/badges', requireAuth, ah(async (req, res) => {
    const badges = [
      { name: 'First Step', icon: '🌱', description: 'Enrolled in first leadership program', requirement: 'first_enrollment' },
      { name: 'Active Learner', icon: '📚', description: 'Completed 5 journal entries', requirement: '5_journals' },
      { name: 'Team Player', icon: '🤝', description: 'Received 3+ peer feedback entries', requirement: '3_peer_feedback' },
      { name: 'Communicator', icon: '💬', description: 'Scored 80%+ on Communication in 360 feedback', requirement: 'comm_80' },
      { name: 'Mentor', icon: '🧑‍🏫', description: 'Served as a mentor to another student', requirement: 'mentor_role' },
      { name: 'Visionary', icon: '🔭', description: 'Scored 80%+ on Vision & Direction in 360 feedback', requirement: 'vision_80' },
      { name: 'Community Leader', icon: '🏘️', description: 'Completed a community service challenge', requirement: 'community_service' },
      { name: 'Project Master', icon: '📋', description: 'Led a project to completion', requirement: 'project_lead' },
      { name: 'Halfway Hero', icon: '⚡', description: 'Completed 50% of any program', requirement: '50_percent' },
      { name: 'Program Graduate', icon: '🎓', description: 'Completed 100% of a leadership program', requirement: 'program_complete' },
      { name: 'Consistent Reflector', icon: '📝', description: '10+ journal entries', requirement: '10_journals' },
      { name: 'Empowerment Expert', icon: '💪', description: 'Scored 80%+ on Empowerment in 360 feedback', requirement: 'empower_80' },
      { name: 'Decision Maker', icon: '🎯', description: 'Scored 80%+ on Decision Making in 360 feedback', requirement: 'decision_80' },
      { name: 'Adaptive Leader', icon: '🔄', description: 'Scored 80%+ on Adaptability in 360 feedback', requirement: 'adapt_80' },
      { name: 'Integrity Champion', icon: '⭐', description: 'Scored 80%+ on Integrity in 360 feedback', requirement: 'integrity_80' },
      { name: 'Full Circle', icon: '🏅', description: 'Received feedback from all 5 roles (peer, mentor, teacher, self, supervisor)', requirement: 'all_roles' }
    ];

    let badgeHtml = '';
    badges.forEach(b => {
      badgeHtml += '<div class="card" style="text-align:center;padding:16px"><div style="font-size:40px;margin-bottom:8px">' + b.icon + '</div>' +
        '<h4 style="margin:0 0 4px">' + esc(b.name) + '</h4>' +
        '<p style="margin:0 0 8px;font-size:13px;color:' + GRAY + '">' + esc(b.description) + '</p>' +
        '<span style="display:inline-block;background:#f3f4f6;color:' + GRAY + ';padding:2px 10px;border-radius:10px;font-size:11px">' + esc(b.requirement) + '</span></div>';
    });

    const page = renderPage('Milestone Badges', SKIP + nav('badges') +
      '<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 8px">Milestone Badges</h3><p style="color:' + GRAY + ';margin:0">Earn badges by completing leadership milestones and demonstrating growth</p></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px">' + badgeHtml + '</div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 15: Analytics Dashboard
  // ================================================================
  app.get('/school/leadership-program/analytics', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    // Enrollment by program
    const progEnroll = await pool.query(
      'SELECT lp.title, COUNT(le.id)::int as enrollments, AVG(le.progress_pct)::numeric(5,1) as avg_progress FROM leadership_enrollments le JOIN leadership_programs lp ON lp.id=le.program_id WHERE le.tenant_id=$1 GROUP BY lp.title ORDER BY enrollments DESC', [t]);
    // 360 feedback averages
    const fbAvg = await pool.query(
      "SELECT lf.evaluator_role, COUNT(*)::int as cnt FROM leadership_feedback_360 lf WHERE lf.tenant_id=$1 GROUP BY lf.evaluator_role ORDER BY cnt DESC", [t]);
    // Journal sentiment
    const journalMood = await pool.query(
      "SELECT mood, COUNT(*)::int as cnt FROM leadership_journals WHERE tenant_id=$1 GROUP BY mood ORDER BY cnt DESC", [t]);
    // Top students by feedback
    const topStudents = await pool.query(
      "SELECT lf.student_id, AVG((lf.criteria->>'Communication')::numeric)::numeric(5,1) as comm, AVG((lf.criteria->>'Empowerment')::numeric)::numeric(5,1) as empower, AVG((lf.criteria->>'Decision Making')::numeric)::numeric(5,1) as decision, COUNT(lf.id)::int as feedback_count FROM leadership_feedback_360 lf WHERE lf.tenant_id=$1 GROUP BY lf.student_id ORDER BY feedback_count DESC LIMIT 10", [t]);
    // Completion stats
    const completionStats = await pool.query(
      "SELECT status, COUNT(*)::int as cnt FROM leadership_enrollments WHERE tenant_id=$1 GROUP BY status", [t]);

    let progBars = '';
    progEnroll.rows.forEach(r => {
      progBars += '<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px"><span>' + esc(r.title) + '</span><span style="color:' + GRAY + '">' + r.enrollments + ' enrolled · ' + pn(r.avg_progress, 0) + '% avg</span></div>' +
        '<div style="background:#e5e7eb;border-radius:6px;height:8px;overflow:hidden"><div style="background:' + P + ';height:100%;width:' + pn(r.avg_progress, 0) + '%;border-radius:6px"></div></div></div>';
    });

    let moodCards = '';
    const moodMap = { great: { icon: '😄', color: '#059669' }, good: { icon: '🙂', color: '#65a30d' }, neutral: { icon: '😐', color: '#d97706' }, challenging: { icon: '😔', color: '#ea580c' }, tough: { icon: '😣', color: '#dc2626' } };
    journalMood.rows.forEach(r => {
      const m = moodMap[r.mood] || { icon: '😐', color: GRAY };
      moodCards += '<div style="background:' + m.color + '1a;border:1px solid ' + m.color + ';border-radius:10px;padding:12px;text-align:center;min-width:80px"><div style="font-size:24px">' + m.icon + '</div><div style="font-size:18px;font-weight:700;color:' + m.color + '">' + r.cnt + '</div><div style="font-size:11px;color:' + GRAY + ';text-transform:capitalize">' + r.mood + '</div></div>';
    });

    let studentRows = '';
    topStudents.rows.forEach((r, i) => {
      studentRows += '<tr><td>#' + (i + 1) + '</td><td>Student #' + r.student_id + '</td>' +
        '<td><span style="color:' + scoreColor(pn(r.comm, 0)) + '">' + pn(r.comm, 0) + '</span></td>' +
        '<td><span style="color:' + scoreColor(pn(r.empower, 0)) + '">' + pn(r.empower, 0) + '</span></td>' +
        '<td><span style="color:' + scoreColor(pn(r.decision, 0)) + '">' + pn(r.decision, 0) + '</span></td>' +
        '<td>' + r.feedback_count + '</td></tr>';
    });

    let compCards = '';
    completionStats.rows.forEach(r => {
      compCards += '<div style="background:' + statusColor(r.status) + ';color:#fff;padding:16px;border-radius:10px;text-align:center"><div style="font-size:24px;font-weight:700">' + r.cnt + '</div><div style="font-size:13px;text-transform:capitalize">' + r.status + '</div></div>';
    });

    const page = renderPage('Leadership Analytics', SKIP + nav('analytics') +
      '<div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">' + (compCards || '<div class="card" style="color:' + GRAY + '">No enrollment data</div>') + '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">' +
        '<div class="card"><h4 style="margin:0 0 12px">Program Enrollment & Progress</h4>' + (progBars || '<p style="color:' + GRAY + '">No data</p>') + '</div>' +
        '<div class="card"><h4 style="margin:0 0 12px">Journal Mood Distribution</h4><div style="display:flex;gap:12px;flex-wrap:wrap">' + (moodCards || '<p style="color:' + GRAY + '">No journal entries</p>') + '</div></div>' +
      '</div>' +
      '<div class="card"><h4 style="margin:0 0 12px">Top Students by 360 Feedback</h4><div style="overflow-x:auto"><table><tr><th>#</th><th>Student</th><th>Comm</th><th>Empower</th><th>Decision</th><th>Feedbacks</th></tr>' +
        (studentRows || '<tr><td colspan="6" style="text-align:center;color:' + GRAY + '">No data</td></tr>') +
      '</table></div></div>',
      req.session?.user);
    res.send(page);
  }));

  // ================================================================
  // ROUTE 16: API - Seed Default Program
  // ================================================================
  app.post('/school/leadership-program/api/seed', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const defaults = [
      { title: 'Emerging Leaders Program', description: 'A comprehensive 12-week program designed to develop fundamental leadership skills in students through experiential learning, mentoring, and community engagement.', modules: ['Self-Awareness & Personal Values', 'Communication Excellence', 'Team Dynamics & Collaboration', 'Conflict Resolution Strategies', 'Decision Making Under Pressure', 'Community Service Project', 'Project Management Fundamentals', 'Mentoring & Coaching Skills', 'Public Speaking & Presentation', 'Strategic Thinking', 'Ethical Leadership', 'Capstone Leadership Project'], duration_weeks: 12, max_participants: 25 },
      { title: 'Student Council Leadership Track', description: 'Specialized program for student council members focusing on governance, event planning, and representing student voice effectively.', modules: ['Student Government Basics', 'Meeting Facilitation', 'Event Planning & Execution', 'Budget Management', 'Public Relations & Communication', 'Constitution & Policy Review', 'Crisis Response Planning', 'Year-end Reflection'], duration_weeks: 8, max_participants: 15 },
      { title: 'Community Service Leadership', description: 'Develop leadership through service. Students plan, organize, and execute community service projects while developing project management and teamwork skills.', modules: ['Needs Assessment in Community', 'Project Planning & Design', 'Volunteer Recruitment & Management', 'Partnership Development', 'Impact Measurement', 'Reflection & Storytelling'], duration_weeks: 6, max_participants: 30 }
    ];
    let seeded = 0;
    for (const d of defaults) {
      const exists = await pool.query('SELECT id FROM leadership_programs WHERE tenant_id=$1 AND title=$2', [t, d.title]);
      if (!exists.rows.length) {
        const mods = d.modules.map((s, i) => ({ order: i + 1, title: s, completed: false }));
        await pool.query('INSERT INTO leadership_programs (tenant_id, title, description, modules, duration_weeks, max_participants, status) VALUES ($1,$2,$3,$4,$5,$6,$7)',
          [t, d.title, d.description, JSON.stringify(mods), d.duration_weeks, d.max_participants, 'active']);
        seeded++;
      }
    }
    audit('leadership_programs_seeded', { count: seeded, tenant: t });
    res.json({ success: true, seeded });
  }));

  // ================================================================
  // ROUTE 17: API - Delete Feedback
  // ================================================================
  app.post('/school/leadership-program/feedback360/delete', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    await pool.query('DELETE FROM leadership_feedback_360 WHERE id=$1 AND tenant_id=$2', [req.body.id, t]);
    audit('feedback_360_deleted', { id: req.body.id, tenant: t });
    res.json({ success: true });
  }));
};
