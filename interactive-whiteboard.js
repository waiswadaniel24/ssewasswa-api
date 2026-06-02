/**
 * Interactive Whiteboard Module
 * Collaborative digital whiteboard for teachers and students in a school SaaS portal.
 * Features: sessions, drawing tools, content blocks, collaboration, pages/slides,
 * templates, save & export, gallery, lesson integration, student submissions.
 *
 * Tables:
 *   whiteboard_sessions, whiteboard_pages, whiteboard_content,
 *   whiteboard_templates, whiteboard_collaborators, whiteboard_submissions
 *
 * Routes prefix: /school/whiteboard/
 */

const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  const PREFIX = '/school/whiteboard';

  // ─── Helper: ensure tenant guard ──────────────────────────────────────────
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const userId = (req) => req.session?.user?.id || 0;
  const userRole = (req) => req.session?.user?.role || 'student';

  // ─── Helper: JSON response ────────────────────────────────────────────────
  const json = (res, data, status = 200) => {
    res.status(status).json(data);
  };

  // ─── Helper: safe integer parse ───────────────────────────────────────────
  const int = (v, def = 0) => { const n = parseInt(v, 10); return isNaN(n) ? def : n; };

  // ─── Helper: build pagination ─────────────────────────────────────────────
  const paginate = (page, perPage, total) => {
    const p = Math.max(1, page);
    const pp = Math.max(1, Math.min(100, perPage));
    const totalPages = Math.max(1, Math.ceil(total / pp));
    return { page: p, perPage: pp, total, totalPages, offset: (p - 1) * pp };
  };

  // ─── Default colour palette for whiteboard tools ──────────────────────────
  const DEFAULT_COLORS = [
    '#000000','#FFFFFF','#FF0000','#00FF00','#0000FF','#FFFF00',
    '#FF00FF','#00FFFF','#FF8800','#8800FF','#008888','#888888'
  ];

  // ─── Template seed data (used for initialisation) ─────────────────────────
  const BUILTIN_TEMPLATES = [
    { name: 'Blank', description: 'A completely blank whiteboard canvas.', category: 'basic', config: JSON.stringify({ background: '#FFFFFF', grid: null }) },
    { name: 'Grid Paper', description: 'Light grid lines for aligned drawing and writing.', category: 'basic', config: JSON.stringify({ background: '#FFFFFF', grid: { spacing: 25, color: '#E0E0E0', lineWidth: 1 } }) },
    { name: 'Lined Paper', description: 'Horizontal ruled lines like notebook paper.', category: 'basic', config: JSON.stringify({ background: '#FFFFFF', lines: { spacing: 32, color: '#B0D4F1', lineWidth: 1, margin: 60 } }) },
    { name: 'Graph Paper', description: 'Precise graph paper with major and minor grid lines.', category: 'math', config: JSON.stringify({ background: '#FFFFFF', grid: { minorSpacing: 10, majorSpacing: 50, minorColor: '#F0F0F0', majorColor: '#CCCCCC', lineWidth: 0.5 } }) },
    { name: 'Music Staff', description: 'Five-line staff for music notation.', category: 'music', config: JSON.stringify({ background: '#FFFFF5', staffLines: { count: 5, spacing: 12, color: '#333333', groups: 4, groupGap: 24 } }) },
    { name: 'Periodic Table', description: 'Periodic table outline template with element boxes.', category: 'science', config: JSON.stringify({ background: '#FFFFFF', periodicTable: { cols: 18, rows: 10, cellWidth: 56, cellHeight: 56 } }) },
    { name: 'World Map', description: 'Simple world map outline for geography lessons.', category: 'geography', config: JSON.stringify({ background: '#E8F4FD', mapOutline: { type: 'world', color: '#A0C4E8', strokeWidth: 2 } }) },
    { name: 'Venn Diagram', description: 'Two or three circle Venn diagram template.', category: 'graphic', config: JSON.stringify({ background: '#FFFFFF', venn: { circles: 3, color: ['rgba(255,0,0,0.1)','rgba(0,255,0,0.1)','rgba(0,0,255,0.1)'], strokeColor: ['#FF0000','#00CC00','#0000FF'] } }) },
    { name: 'Flow Chart', description: 'Flow chart template with decision and process boxes.', category: 'graphic', config: JSON.stringify({ background: '#FFFFFF', flowchart: { boxes: [{ type: 'start', x: 300, y: 30, w: 120, h: 50 },{ type: 'process', x: 280, y: 120, w: 160, h: 50 },{ type: 'decision', x: 290, y: 210, w: 140, h: 70 },{ type: 'end', x: 300, y: 320, w: 120, h: 50 }] } }) },
    { name: 'Frayer Model', description: 'Four-square vocabulary model template.', category: 'literacy', config: JSON.stringify({ background: '#FFFFFF', frayer: { centerTerm: true, labels: ['Definition','Characteristics','Examples','Non-Examples'] } }) },
    { name: 'Storyboard', description: 'Six-panel storyboard for narrative planning.', category: 'literacy', config: JSON.stringify({ background: '#FFFFFF', storyboard: { panels: 6, cols: 3, rows: 2, panelWidth: 280, panelHeight: 200, gap: 20 } }) },
    { name: 'Cornell Notes', description: 'Cornell note-taking layout with cue column.', category: 'study', config: JSON.stringify({ background: '#FFFFFF', cornell: { cueWidth: 150, noteWidth: 400, summaryHeight: 150, lineColor: '#CCCCCC' } }) }
  ];

  // ══════════════════════════════════════════════════════════════════════════
  //  DATABASE INIT — create tables & seed templates
  // ══════════════════════════════════════════════════════════════════════════

  async function ensureTables() {
    try {
      await migrateQuery(pool, 'Whiteboard', `
        CREATE TABLE IF NOT EXISTS whiteboard_sessions (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          title VARCHAR(255) NOT NULL,
          description TEXT,
          class_id INT DEFAULT NULL,
          subject_id INT DEFAULT NULL,
          lesson_plan_id INT DEFAULT NULL,
          mode TEXT NOT NULL DEFAULT 'live',
          status TEXT NOT NULL DEFAULT 'draft',
          background_config JSONB DEFAULT NULL,
          thumbnail TEXT DEFAULT NULL,
          created_by INT NOT NULL,
          presenter_id INT DEFAULT NULL,
          auto_save_interval INT DEFAULT 30,
          last_saved_at TIMESTAMPTZ DEFAULT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await migrateQuery(pool, 'Whiteboard', `
        CREATE TABLE IF NOT EXISTS whiteboard_pages (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          session_id INT NOT NULL,
          page_number INT NOT NULL DEFAULT 1,
          title VARCHAR(255) DEFAULT '',
          background_config JSONB DEFAULT NULL,
          canvas_data TEXT DEFAULT NULL,
          thumbnail TEXT DEFAULT NULL,
          width INT DEFAULT 1920,
          height INT DEFAULT 1080,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT uk_session_page UNIQUE (session_id, page_number),
          FOREIGN KEY (session_id) REFERENCES whiteboard_sessions(id) ON DELETE CASCADE
        )
      `);

      await migrateQuery(pool, 'Whiteboard', `
        CREATE TABLE IF NOT EXISTS whiteboard_content (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          page_id INT NOT NULL,
          content_type TEXT NOT NULL DEFAULT 'freehand',
          content_data JSONB NOT NULL,
          z_index INT DEFAULT 0,
          locked SMALLINT DEFAULT 0,
          created_by INT DEFAULT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (page_id) REFERENCES whiteboard_pages(id) ON DELETE CASCADE
        )
      `);

      await migrateQuery(pool, 'Whiteboard', `
        CREATE TABLE IF NOT EXISTS whiteboard_templates (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL DEFAULT 0,
          name VARCHAR(255) NOT NULL,
          description TEXT,
          category VARCHAR(100) DEFAULT 'general',
          thumbnail TEXT DEFAULT NULL,
          config JSONB NOT NULL,
          is_builtin SMALLINT DEFAULT 0,
          is_public SMALLINT DEFAULT 1,
          created_by INT DEFAULT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      await migrateQuery(pool, 'Whiteboard', `
        CREATE TABLE IF NOT EXISTS whiteboard_collaborators (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          session_id INT NOT NULL,
          user_id INT NOT NULL,
          permission TEXT NOT NULL DEFAULT 'viewer',
          color VARCHAR(7) DEFAULT '#000000',
          cursor_x INT DEFAULT 0,
          cursor_y INT DEFAULT 0,
          is_online SMALLINT DEFAULT 0,
          last_active TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          joined_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT uk_session_user UNIQUE (session_id, user_id),
          FOREIGN KEY (session_id) REFERENCES whiteboard_sessions(id) ON DELETE CASCADE
        )
      `);

      await migrateQuery(pool, 'Whiteboard', `
        CREATE TABLE IF NOT EXISTS whiteboard_submissions (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          assignment_id INT DEFAULT NULL,
          session_id INT NOT NULL,
          student_id INT NOT NULL,
          status TEXT NOT NULL DEFAULT 'draft',
          submitted_at TIMESTAMPTZ DEFAULT NULL,
          graded_by INT DEFAULT NULL,
          grade VARCHAR(20) DEFAULT NULL,
          score DECIMAL(5,2) DEFAULT NULL,
          feedback TEXT DEFAULT NULL,
          graded_at TIMESTAMPTZ DEFAULT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (session_id) REFERENCES whiteboard_sessions(id) ON DELETE CASCADE
        )
      `);

      await migrateQuery(pool, 'Whiteboard', `
        CREATE TABLE IF NOT EXISTS whiteboard_version_history (
          id SERIAL PRIMARY KEY,
          tenant_id INT NOT NULL,
          session_id INT NOT NULL,
          page_id INT DEFAULT NULL,
          version_label VARCHAR(255) DEFAULT '',
          snapshot_data TEXT NOT NULL,
          created_by INT DEFAULT NULL,
          created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
        )
      `);

      // Seed built-in templates (tenant_id=0 means shared across all tenants)
      for (const tpl of BUILTIN_TEMPLATES) {
        const existing = await migrateQuery(pool, 'Whiteboard', 
          'SELECT id FROM whiteboard_templates WHERE tenant_id=0 AND name=$1 AND is_builtin=1 LIMIT 1',
          [tpl.name]
        );
        if (!existing.rows.length) {
          await migrateQuery(pool, 'Whiteboard', 
            `INSERT INTO whiteboard_templates (tenant_id, name, description, category, config, is_builtin, is_public)
             VALUES (0, $1, $2, $3, $4, 1, 1)`,
            [tpl.name, tpl.description, tpl.category, tpl.config]
          );
        }
      }
    } catch(err) {
      console.error('[whiteboard] Table init error:', err.message);
    }
  }

  setTimeout(() => { ensureTables().catch(err => console.error('[whiteboard] Table init error:', err.message)); }, Math.random() * 10000);

  // ══════════════════════════════════════════════════════════════════════════
  //  1. DASHBOARD
  // ══════════════════════════════════════════════════════════════════════════

  // 1a. Dashboard — list recent sessions + stats
  app.get(`${PREFIX}/dashboard`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const role = userRole(req);

    // Stats
    const { rows: stats } = await pool.query(
      `SELECT
         COUNT(*) AS total_sessions,
         SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_sessions,
         SUM(CASE WHEN mode='live' THEN 1 ELSE 0 END) AS live_sessions,
         COUNT(DISTINCT wp.id) AS total_pages
       FROM whiteboard_sessions ws
       LEFT JOIN whiteboard_pages wp ON wp.session_id=ws.id
       WHERE ws.tenant_id=$1 AND (ws.created_by=$2 OR ws.id IN (
         SELECT session_id FROM whiteboard_collaborators WHERE user_id=$3
       ))`,
      [tid, uid, uid]
    );

    // Recent sessions
    const { rows: recent } = await pool.query(
      `SELECT ws.*, u.display_name AS creator_name,
        (SELECT COUNT(*) FROM whiteboard_pages WHERE session_id=ws.id) AS page_count,
        (SELECT COUNT(*) FROM whiteboard_collaborators WHERE session_id=ws.id AND is_online=1) AS online_count
       FROM whiteboard_sessions ws
       LEFT JOIN users u ON u.id=ws.created_by
       WHERE ws.tenant_id=$1 AND (ws.created_by=$2 OR ws.id IN (
         SELECT session_id FROM whiteboard_collaborators WHERE user_id=$3
       ))
       ORDER BY ws.updated_at DESC LIMIT 20`,
      [tid, uid, uid]
    );

    // Pending submissions (for teachers)
    let pendingSubs = [];
    if (role === 'teacher' || role === 'admin') {
      const { rows: rows } = await pool.query(
        `SELECT wbs.*, u.display_name AS student_name, ws.title AS session_title
         FROM whiteboard_submissions wbs
         JOIN users u ON u.id=wbs.student_id
         JOIN whiteboard_sessions ws ON ws.id=wbs.session_id
         WHERE wbs.tenant_id=$1 AND wbs.status='submitted'
         ORDER BY wbs.submitted_at DESC LIMIT 10`,
        [tid]
      );
      pendingSubs = rows;
    }

    // Recent templates
    const { rows: templates } = await pool.query(
      `SELECT * FROM whiteboard_templates
       WHERE (tenant_id=0 AND is_builtin=1) OR tenant_id=$1
       ORDER BY category, name LIMIT 12`,
      [tid]
    );

    const html = renderPage('Whiteboard Dashboard', `
      <div class="wb-dashboard">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2><i class="fas fa-chalkboard-teacher me-2"></i>Interactive Whiteboard</h2>
          <a href="${PREFIX}/sessions/new" class="btn btn-primary"><i class="fas fa-plus me-1"></i>New Session</a>
        </div>

        <!-- Stats Cards -->
        <div class="row g-3 mb-4">
          <div class="col-md-3">
            <div class="card text-center p-3">
              <div class="text-muted small">Total Sessions</div>
              <div class="fs-3 fw-bold">${stats[0]?.total_sessions || 0}</div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card text-center p-3">
              <div class="text-muted small">Active</div>
              <div class="fs-3 fw-bold text-success">${stats[0]?.active_sessions || 0}</div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card text-center p-3">
              <div class="text-muted small">Live Now</div>
              <div class="fs-3 fw-bold text-primary">${stats[0]?.live_sessions || 0}</div>
            </div>
          </div>
          <div class="col-md-3">
            <div class="card text-center p-3">
              <div class="text-muted small">Total Pages</div>
              <div class="fs-3 fw-bold text-info">${stats[0]?.total_pages || 0}</div>
            </div>
          </div>
        </div>

        <!-- Quick Templates -->
        <div class="card mb-4">
          <div class="card-header"><i class="fas fa-th-large me-2"></i>Quick Start Templates</div>
          <div class="card-body">
            <div class="d-flex flex-wrap gap-2">
              ${templates.map(t => `
                <a href="${PREFIX}/sessions/new?template=${t.id}" class="btn btn-outline-secondary btn-sm">
                  <i class="fas fa-file me-1"></i>${esc(t.name)}
                </a>
              `).join('')}
            </div>
          </div>
        </div>

        <!-- Recent Sessions -->
        <div class="card mb-4">
          <div class="card-header d-flex justify-content-between">
            <span><i class="fas fa-history me-2"></i>Recent Sessions</span>
            <a href="${PREFIX}/gallery" class="btn btn-sm btn-outline-primary">View All</a>
          </div>
          <div class="card-body p-0">
            <table class="table table-hover mb-0">
              <thead><tr>
                <th>Title</th><th>Status</th><th>Mode</th><th>Pages</th><th>Online</th><th>Updated</th><th>Actions</th>
              </tr></thead>
              <tbody>
                ${recent.length ? recent.map(s => `
                  <tr>
                    <td><a href="${PREFIX}/draw/${s.id}">${esc(s.title)}</a>
                      <div class="text-muted small">${esc(s.description || '').substring(0, 60)}</div></td>
                    <td><span class="badge bg-${s.status === 'active' ? 'success' : s.status === 'archived' ? 'secondary' : 'warning'}">${s.status}</span></td>
                    <td><span class="badge bg-${s.mode === 'live' ? 'primary' : 'info'}">${s.mode}</span></td>
                    <td>${s.page_count}</td>
                    <td>${s.online_count > 0 ? '<span class="badge bg-success">' + s.online_count + ' online</span>' : '—'}</td>
                    <td class="small">${s.updated_at ? new Date(s.updated_at).toLocaleDateString() : ''}</td>
                    <td>
                      <a href="${PREFIX}/draw/${s.id}" class="btn btn-sm btn-outline-primary" title="Open"><i class="fas fa-pen"></i></a>
                      <a href="${PREFIX}/sessions/${s.id}/edit" class="btn btn-sm btn-outline-secondary" title="Edit"><i class="fas fa-cog"></i></a>
                    </td>
                  </tr>
                `).join('') : '<tr><td colspan="7" class="text-center text-muted py-4">No sessions yet. Create your first whiteboard!</td></tr>'}
              </tbody>
            </table>
          </div>
        </div>

        ${pendingSubs.length ? `
        <!-- Pending Submissions -->
        <div class="card">
          <div class="card-header"><i class="fas fa-inbox me-2"></i>Pending Submissions (${pendingSubs.length})</div>
          <div class="card-body p-0">
            <table class="table table-hover mb-0">
              <thead><tr><th>Student</th><th>Session</th><th>Submitted</th><th>Actions</th></tr></thead>
              <tbody>
                ${pendingSubs.map(s => `
                  <tr>
                    <td>${esc(s.student_name)}</td>
                    <td>${esc(s.session_title)}</td>
                    <td class="small">${s.submitted_at ? new Date(s.submitted_at).toLocaleString() : ''}</td>
                    <td>
                      <a href="${PREFIX}/draw/${s.session_id}?submission=${s.id}" class="btn btn-sm btn-outline-primary">View</a>
                      <a href="${PREFIX}/submissions/${s.id}/grade" class="btn btn-sm btn-outline-success">Grade</a>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>
        ` : ''}
      </div>
    `, req);

    res.send(html);
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  2. SESSIONS CRUD
  // ══════════════════════════════════════════════════════════════════════════

  // 2a. New session form
  app.get(`${PREFIX}/sessions/new`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const templateId = int(req.query.template);

    let templateConfig = null;
    if (templateId) {
      const { rows: rows } = await pool.query(
        'SELECT config FROM whiteboard_templates WHERE id=$1 AND (tenant_id=0 OR tenant_id=$2) LIMIT 1',
        [templateId, tid]
      );
      if (rows.length) templateConfig = rows[0].config;
    }

    // Fetch available classes and subjects for dropdown
    const { rows: classes } = await pool.query(
      'SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name', [tid]
    );
    const { rows: subjects } = await pool.query(
      'SELECT id, name FROM subjects WHERE tenant_id=$1 ORDER BY name', [tid]
    );

    const html = renderPage('New Whiteboard Session', `
      <div class="wb-new-session">
        <h2 class="mb-4"><i class="fas fa-plus-circle me-2"></i>New Whiteboard Session</h2>
        <form method="POST" action="${PREFIX}/sessions" class="card p-4">
          <div class="row g-3">
            <div class="col-md-8">
              <label class="form-label">Session Title *</label>
              <input type="text" name="title" class="form-control" required placeholder="e.g., Algebra — Quadratic Equations" maxlength="255">
            </div>
            <div class="col-md-4">
              <label class="form-label">Mode</label>
              <select name="mode" class="form-select">
                <option value="live">Live (Collaborative)</option>
                <option value="static">Static (View Only)</option>
              </select>
            </div>
            <div class="col-12">
              <label class="form-label">Description</label>
              <textarea name="description" class="form-control" rows="2" placeholder="Brief description of the whiteboard content..."></textarea>
            </div>
            <div class="col-md-4">
              <label class="form-label">Class</label>
              <select name="class_id" class="form-select">
                <option value="">— None —</option>
                ${classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label">Subject</label>
              <select name="subject_id" class="form-select">
                <option value="">— None —</option>
                ${subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label">Template</label>
              <select name="template_id" class="form-select" id="templateSelect">
                <option value="">Blank</option>
                ${BUILTIN_TEMPLATES.map((t, i) => `<option value="${i + 1}" ${templateId === (i + 1) ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
              </select>
            </div>
            <div class="col-md-6">
              <label class="form-label">Auto-save interval (seconds)</label>
              <input type="number" name="auto_save_interval" class="form-control" value="30" min="5" max="300">
            </div>
            <div class="col-12 d-flex gap-2 mt-3">
              <button type="submit" class="btn btn-primary"><i class="fas fa-save me-1"></i>Create Session</button>
              <a href="${PREFIX}/dashboard" class="btn btn-outline-secondary">Cancel</a>
            </div>
          </div>
        </form>
      </div>
    `, req);

    res.send(html);
  }));

  // 2b. Create session (POST)
  app.post(`${PREFIX}/sessions`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { title, description, class_id, subject_id, mode, template_id, auto_save_interval } = req.body;

    if (!title || !title.trim()) {
      return res.redirect(`${PREFIX}/sessions/new?error=Title+required`);
    }

    let bgConfig = null;
    if (template_id && BUILTIN_TEMPLATES[int(template_id) - 1]) {
      bgConfig = BUILTIN_TEMPLATES[int(template_id) - 1].config;
    }

    const result = await pool.query(
      `INSERT INTO whiteboard_sessions (tenant_id, title, description, class_id, subject_id, mode, status, background_config, created_by, presenter_id, auto_save_interval)
       VALUES ($1, $2, $3, $4, $5, $6, 'draft', $7, $8, $9, $10) RETURNING id`,
      [tid, title.trim(), description || null, class_id || null, subject_id || null, mode || 'live', bgConfig, uid, uid, auto_save_interval || 30]
    );

    const sessionId = result.rows[0].id;

    // Create first page
    await pool.query(
      `INSERT INTO whiteboard_pages (tenant_id, session_id, page_number, title, background_config)
       VALUES ($1, $2, 1, 'Page 1', $3)`,
      [tid, sessionId, bgConfig]
    );

    // Add creator as presenter collaborator
    await pool.query(
      `INSERT INTO whiteboard_collaborators (tenant_id, session_id, user_id, permission, color, is_online)
       VALUES ($1, $2, $3, 'presenter', '#FF4444', 1)`,
      [tid, sessionId, uid]
    );

    audit(req, 'whiteboard_session_create', { session_id: sessionId, title });

    res.redirect(`${PREFIX}/draw/${sessionId}`);
  }));

  // 2c. Edit session form
  app.get(`${PREFIX}/sessions/:id/edit`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sid = int(req.params.id);

    const { rows: sessions } = await pool.query(
      'SELECT * FROM whiteboard_sessions WHERE id=$1 AND tenant_id=$2', [sid, tid]
    );
    if (!sessions.length) return res.status(404).send('Session not found');

    const session = sessions[0];
    const { rows: classes } = await pool.query('SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name', [tid]);
    const { rows: subjects } = await pool.query('SELECT id, name FROM subjects WHERE tenant_id=$1 ORDER BY name', [tid]);
    const { rows: collaborators } = await pool.query(
      `SELECT wc.*, u.display_name, u.email
       FROM whiteboard_collaborators wc
       JOIN users u ON u.id=wc.user_id
       WHERE wc.session_id=$1 AND wc.tenant_id=$2`,
      [sid, tid]
    );

    const html = renderPage('Edit Session', `
      <div class="wb-edit-session">
        <h2 class="mb-4"><i class="fas fa-cog me-2"></i>Edit Session: ${esc(session.title)}</h2>
        <form method="POST" action="${PREFIX}/sessions/${sid}" class="card p-4 mb-4">
          <div class="row g-3">
            <div class="col-md-8">
              <label class="form-label">Title *</label>
              <input type="text" name="title" class="form-control" required value="${esc(session.title)}" maxlength="255">
            </div>
            <div class="col-md-4">
              <label class="form-label">Mode</label>
              <select name="mode" class="form-select">
                <option value="live" ${session.mode === 'live' ? 'selected' : ''}>Live</option>
                <option value="static" ${session.mode === 'static' ? 'selected' : ''}>Static</option>
              </select>
            </div>
            <div class="col-12">
              <label class="form-label">Description</label>
              <textarea name="description" class="form-control" rows="2">${esc(session.description || '')}</textarea>
            </div>
            <div class="col-md-4">
              <label class="form-label">Class</label>
              <select name="class_id" class="form-select">
                <option value="">— None —</option>
                ${classes.map(c => `<option value="${c.id}" ${session.class_id === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label">Subject</label>
              <select name="subject_id" class="form-select">
                <option value="">— None —</option>
                ${subjects.map(s => `<option value="${s.id}" ${session.subject_id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
              </select>
            </div>
            <div class="col-md-4">
              <label class="form-label">Status</label>
              <select name="status" class="form-select">
                <option value="draft" ${session.status === 'draft' ? 'selected' : ''}>Draft</option>
                <option value="active" ${session.status === 'active' ? 'selected' : ''}>Active</option>
                <option value="archived" ${session.status === 'archived' ? 'selected' : ''}>Archived</option>
              </select>
            </div>
            <div class="col-12 d-flex gap-2 mt-3">
              <button type="submit" class="btn btn-primary"><i class="fas fa-save me-1"></i>Save Changes</button>
              <a href="${PREFIX}/dashboard" class="btn btn-outline-secondary">Cancel</a>
            </div>
          </div>
        </form>

        <!-- Collaborators -->
        <div class="card">
          <div class="card-header d-flex justify-content-between">
            <span><i class="fas fa-users me-2"></i>Collaborators</span>
            <button type="button" class="btn btn-sm btn-outline-primary" data-bs-toggle="modal" data-bs-target="#addCollabModal">
              <i class="fas fa-user-plus me-1"></i>Add
            </button>
          </div>
          <div class="card-body p-0">
            <table class="table table-hover mb-0">
              <thead><tr><th>User</th><th>Permission</th><th>Online</th><th>Actions</th></tr></thead>
              <tbody>
                ${collaborators.map(c => `
                  <tr>
                    <td>${esc(c.display_name)} <span class="text-muted small">(${esc(c.email)})</span></td>
                    <td><span class="badge bg-${c.permission === 'presenter' ? 'danger' : c.permission === 'editor' ? 'primary' : 'secondary'}">${c.permission}</span></td>
                    <td>${c.is_online ? '<span class="badge bg-success">Online</span>' : 'Offline'}</td>
                    <td>
                      <form method="POST" action="${PREFIX}/collaborators/${c.id}/remove" style="display:inline" onsubmit="return confirm('Remove this collaborator?')">
                        <button class="btn btn-sm btn-outline-danger"><i class="fas fa-trash"></i></button>
                      </form>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Add Collaborator Modal -->
        <div class="modal fade" id="addCollabModal" tabindex="-1">
          <div class="modal-dialog">
            <div class="modal-content">
              <form method="POST" action="${PREFIX}/sessions/${sid}/collaborators">
                <div class="modal-header">
                  <h5 class="modal-title">Add Collaborator</h5>
                  <button type="button" class="btn-close" data-bs-dismiss="modal"></button>
                </div>
                <div class="modal-body">
                  <div class="mb-3">
                    <label class="form-label">User Email</label>
                    <input type="email" name="email" class="form-control" required placeholder="student@school.com">
                  </div>
                  <div class="mb-3">
                    <label class="form-label">Permission</label>
                    <select name="permission" class="form-select">
                      <option value="viewer">Viewer</option>
                      <option value="editor">Editor</option>
                      <option value="presenter">Presenter</option>
                    </select>
                  </div>
                </div>
                <div class="modal-footer">
                  <button type="button" class="btn btn-secondary" data-bs-dismiss="modal">Cancel</button>
                  <button type="submit" class="btn btn-primary">Add</button>
                </div>
              </form>
            </div>
          </div>
        </div>

        <!-- Danger Zone -->
        <div class="card border-danger mt-4">
          <div class="card-header bg-danger text-white"><i class="fas fa-exclamation-triangle me-2"></i>Danger Zone</div>
          <div class="card-body">
            <form method="POST" action="${PREFIX}/sessions/${sid}/delete" onsubmit="return confirm('Delete this whiteboard session permanently? All pages and content will be lost.')">
              <button class="btn btn-danger"><i class="fas fa-trash me-1"></i>Delete Session</button>
            </form>
          </div>
        </div>
      </div>
    `, req);

    res.send(html);
  }));

  // 2d. Update session (POST)
  app.post(`${PREFIX}/sessions/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sid = int(req.params.id);
    const { title, description, class_id, subject_id, mode, status } = req.body;

    await pool.query(
      `UPDATE whiteboard_sessions SET title=$1, description=$2, class_id=$3, subject_id=$4, mode=$5, status=$6, updated_at=NOW()
       WHERE id=$7 AND tenant_id=$8`,
      [title?.trim(), description || null, class_id || null, subject_id || null, mode || 'live', status || 'draft', sid, tid]
    );

    audit(req, 'whiteboard_session_update', { session_id: sid });
    res.redirect(`${PREFIX}/sessions/${sid}/edit?success=1`);
  }));

  // 2e. Delete session
  app.post(`${PREFIX}/sessions/:id/delete`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sid = int(req.params.id);

    await pool.query('DELETE FROM whiteboard_sessions WHERE id=$1 AND tenant_id=$2', [sid, tid]);
    audit(req, 'whiteboard_session_delete', { session_id: sid });
    res.redirect(`${PREFIX}/dashboard?deleted=1`);
  }));

  // 2f. Duplicate session
  app.post(`${PREFIX}/sessions/:id/duplicate`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const sid = int(req.params.id);

    const { rows: originals } = await pool.query(
      'SELECT * FROM whiteboard_sessions WHERE id=$1 AND tenant_id=$2', [sid, tid]
    );
    if (!originals.length) return res.status(404).json({ error: 'Session not found' });

    const orig = originals[0];

    const result = await pool.query(
      `INSERT INTO whiteboard_sessions (tenant_id, title, description, class_id, subject_id, lesson_plan_id, mode, status, background_config, created_by, presenter_id, auto_save_interval)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 'draft', $8, $9, $10, $11) RETURNING id`,
      [tid, orig.title + ' (Copy)', orig.description, orig.class_id, orig.subject_id, orig.lesson_plan_id, orig.mode, orig.background_config, uid, uid, orig.auto_save_interval]
    );

    const newSid = result.rows[0].id;

    // Copy pages
    const { rows: pages } = await pool.query(
      'SELECT * FROM whiteboard_pages WHERE session_id=$1', [sid]
    );
    for (const page of pages) {
      const pgResult = await pool.query(
        `INSERT INTO whiteboard_pages (tenant_id, session_id, page_number, title, background_config, canvas_data, thumbnail, width, height)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [tid, newSid, page.page_number, page.title, page.background_config, page.canvas_data, page.thumbnail, page.width, page.height]
      );
      const newPageId = pgResult.rows[0].id;

      // Copy content
      const { rows: contents } = await pool.query(
        'SELECT * FROM whiteboard_content WHERE page_id=$1', [page.id]
      );
      for (const content of contents) {
        await pool.query(
          `INSERT INTO whiteboard_content (tenant_id, page_id, content_type, content_data, z_index, locked, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [tid, newPageId, content.content_type, content.content_data, content.z_index, content.locked, uid]
        );
      }
    }

    audit(req, 'whiteboard_session_duplicate', { original_id: sid, new_id: newSid });
    res.redirect(`${PREFIX}/draw/${newSid}`);
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  3. COLLABORATORS
  // ══════════════════════════════════════════════════════════════════════════

  // 3a. Add collaborator to session
  app.post(`${PREFIX}/sessions/:id/collaborators`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sid = int(req.params.id);
    const { email, permission } = req.body;

    const { rows: users } = await pool.query(
      'SELECT id, display_name FROM users WHERE email=$1 AND tenant_id=$2 LIMIT 1',
      [email, tid]
    );

    if (!users.length) {
      return res.redirect(`${PREFIX}/sessions/${sid}/edit?error=User+not+found`);
    }

    const targetUser = users[0];
    const collabColors = ['#FF4444','#44AA44','#4444FF','#FF8800','#AA44AA','#44AAAA'];

    try {
      await pool.query(
        `INSERT INTO whiteboard_collaborators (tenant_id, session_id, user_id, permission, color)
         VALUES ($1, $2, $3, $4, $5)`,
        [tid, sid, targetUser.id, permission || 'viewer', collabColors[targetUser.id % collabColors.length]]
      );
    } catch (e) {
      // Duplicate key — user already a collaborator
      return res.redirect(`${PREFIX}/sessions/${sid}/edit?error=Already+a+collaborator`);
    }

    audit(req, 'whiteboard_collaborator_add', { session_id: sid, user_id: targetUser.id, permission });
    res.redirect(`${PREFIX}/sessions/${sid}/edit?success=1`);
  }));

  // 3b. Remove collaborator
  app.post(`${PREFIX}/collaborators/:id/remove`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const cid = int(req.params.id);

    const { rows: collabs } = await pool.query(
      'SELECT session_id FROM whiteboard_collaborators WHERE id=$1 AND tenant_id=$2',
      [cid, tid]
    );
    if (collabs.length) {
      await pool.query('DELETE FROM whiteboard_collaborators WHERE id=$1 AND tenant_id=$2', [cid, tid]);
      audit(req, 'whiteboard_collaborator_remove', { collaborator_id: cid });
    }
    res.redirect('back');
  }));

  // 3c. Update collaborator permission
  app.post(`${PREFIX}/collaborators/:id/permission`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const cid = int(req.params.id);
    const { permission } = req.body;

    await pool.query(
      'UPDATE whiteboard_collaborators SET permission=$1 WHERE id=$2 AND tenant_id=$3',
      [permission, cid, tid]
    );
    json(res, { success: true });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  4. DRAWING — Main whiteboard canvas page
  // ══════════════════════════════════════════════════════════════════════════

  // 4a. Main drawing page
  app.get(`${PREFIX}/draw/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const sid = int(req.params.id);
    const activePage = int(req.query.page, 1);
    const submissionId = int(req.query.submission);

    const { rows: sessions } = await pool.query(
      'SELECT ws.*, u.display_name AS creator_name FROM whiteboard_sessions ws JOIN users u ON u.id=ws.created_by WHERE ws.id=$1 AND ws.tenant_id=$2',
      [sid, tid]
    );
    if (!sessions.length) return res.status(404).send('Session not found');

    const session = sessions[0];
    const { rows: pages } = await pool.query(
      'SELECT * FROM whiteboard_pages WHERE session_id=$1 ORDER BY page_number', [sid]
    );
    const activePageData = pages.find(p => p.page_number === activePage) || pages[0];

    if (!activePageData) return res.status(404).send('No pages found');

    // Load content for active page
    const { rows: contents } = await pool.query(
      'SELECT * FROM whiteboard_content WHERE page_id=$1 ORDER BY z_index, created_at',
      [activePageData.id]
    );

    // Load collaborators
    const { rows: collaborators } = await pool.query(
      `SELECT wc.*, u.display_name, u.avatar_url
       FROM whiteboard_collaborators wc
       JOIN users u ON u.id=wc.user_id
       WHERE wc.session_id=$1 AND wc.tenant_id=$2`,
      [sid, tid]
    );

    // Check user permission
    const myCollab = collaborators.find(c => c.user_id === uid);
    const myPermission = (session.created_by === uid || userRole(req) === 'admin')
      ? 'presenter'
      : (myCollab ? myCollab.permission : 'viewer');

    // Version history
    const { rows: versions } = await pool.query(
      `SELECT * FROM whiteboard_version_history WHERE session_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 20`,
      [sid, tid]
    );

    const html = renderPage(`Whiteboard: ${session.title}`, `
      <style>
        .wb-container { display: flex; height: calc(100vh - 120px); gap: 0; }
        .wb-toolbar { width: 64px; background: #f8f9fa; border-right: 1px solid #dee2e6; padding: 8px 4px; display: flex; flex-direction: column; gap: 4px; overflow-y: auto; }
        .wb-toolbar .tool-btn { width: 48px; height: 48px; display: flex; align-items: center; justify-content: center; border: 2px solid transparent; border-radius: 8px; background: white; cursor: pointer; font-size: 18px; transition: all 0.15s; }
        .wb-toolbar .tool-btn:hover { border-color: #0d6efd; background: #e7f1ff; }
        .wb-toolbar .tool-btn.active { border-color: #0d6efd; background: #cfe2ff; color: #0d6efd; }
        .wb-toolbar .tool-sep { height: 1px; background: #dee2e6; margin: 4px 0; }
        .wb-canvas-area { flex: 1; display: flex; flex-direction: column; overflow: hidden; }
        .wb-topbar { height: 44px; background: #f8f9fa; border-bottom: 1px solid #dee2e6; display: flex; align-items: center; padding: 0 12px; gap: 8px; }
        .wb-canvas-wrapper { flex: 1; overflow: auto; display: flex; align-items: center; justify-content: center; background: #e9ecef; }
        .wb-canvas { background: white; box-shadow: 0 2px 12px rgba(0,0,0,0.15); cursor: crosshair; }
        .wb-sidebar { width: 200px; background: #f8f9fa; border-left: 1px solid #dee2e6; padding: 8px; overflow-y: auto; }
        .wb-page-thumb { border: 2px solid transparent; border-radius: 6px; padding: 4px; cursor: pointer; margin-bottom: 8px; transition: all 0.15s; }
        .wb-page-thumb:hover { border-color: #adb5bd; }
        .wb-page-thumb.active { border-color: #0d6efd; background: #e7f1ff; }
        .wb-page-thumb .thumb-preview { width: 100%; aspect-ratio: 16/9; background: white; border: 1px solid #dee2e6; border-radius: 4px; display: flex; align-items: center; justify-content: center; font-size: 11px; color: #999; }
        .wb-color-palette { display: flex; flex-wrap: wrap; gap: 3px; padding: 4px 0; }
        .wb-color-swatch { width: 20px; height: 20px; border-radius: 4px; border: 2px solid transparent; cursor: pointer; }
        .wb-color-swatch:hover, .wb-color-swatch.active { border-color: #333; transform: scale(1.15); }
        .wb-collab-avatars { display: flex; gap: 4px; }
        .wb-collab-avatar { width: 32px; height: 32px; border-radius: 50%; border: 2px solid white; box-shadow: 0 1px 3px rgba(0,0,0,0.2); }
        .wb-online-dot { width: 8px; height: 8px; border-radius: 50%; background: #22c55e; display: inline-block; margin-left: 2px; }
        .wb-zoom-controls { display: flex; align-items: center; gap: 6px; }
        .wb-zoom-controls button { width: 28px; height: 28px; border-radius: 4px; border: 1px solid #dee2e6; background: white; cursor: pointer; }
        .wb-zoom-controls span { font-size: 12px; min-width: 40px; text-align: center; }
      </style>

      <div class="wb-container">
        <!-- Left Toolbar -->
        <div class="wb-toolbar">
          <button class="tool-btn active" data-tool="pen" title="Pen"><i class="fas fa-pen"></i></button>
          <button class="tool-btn" data-tool="highlighter" title="Highlighter"><i class="fas fa-highlighter"></i></button>
          <button class="tool-btn" data-tool="eraser" title="Eraser"><i class="fas fa-eraser"></i></button>
          <div class="tool-sep"></div>
          <button class="tool-btn" data-tool="select" title="Select"><i class="fas fa-mouse-pointer"></i></button>
          <button class="tool-btn" data-tool="hand" title="Pan"><i class="fas fa-hand-paper"></i></button>
          <div class="tool-sep"></div>
          <button class="tool-btn" data-tool="line" title="Line"><i class="fas fa-minus"></i></button>
          <button class="tool-btn" data-tool="arrow" title="Arrow"><i class="fas fa-long-arrow-alt-right"></i></button>
          <button class="tool-btn" data-tool="rect" title="Rectangle"><i class="far fa-square"></i></button>
          <button class="tool-btn" data-tool="circle" title="Circle"><i class="far fa-circle"></i></button>
          <div class="tool-sep"></div>
          <button class="tool-btn" data-tool="text" title="Text"><i class="fas fa-font"></i></button>
          <button class="tool-btn" data-tool="sticky" title="Sticky Note"><i class="fas fa-sticky-note"></i></button>
          <button class="tool-btn" data-tool="equation" title="Math Equation"><i class="fas fa-square-root-alt"></i></button>
          <button class="tool-btn" data-tool="image" title="Image"><i class="fas fa-image"></i></button>
          <div class="tool-sep"></div>
          <button class="tool-btn" id="undoBtn" title="Undo"><i class="fas fa-undo"></i></button>
          <button class="tool-btn" id="redoBtn" title="Redo"><i class="fas fa-redo"></i></button>
          <div class="tool-sep"></div>
          <div class="wb-color-palette" id="colorPalette">
            ${DEFAULT_COLORS.map(c => `<div class="wb-color-swatch ${c === '#000000' ? 'active' : ''}" data-color="${c}" style="background:${c}"></div>`).join('')}
          </div>
          <div class="mt-1 px-1">
            <input type="color" id="customColor" value="#000000" class="form-control form-control-sm p-0" style="height:28px;">
          </div>
          <div class="mt-1 px-1">
            <label class="form-label mb-0" style="font-size:10px;">Width</label>
            <input type="range" id="lineWidth" min="1" max="20" value="3" class="form-range" style="height:16px;">
            <div class="text-center" style="font-size:10px;" id="lineWidthVal">3px</div>
          </div>
          <div class="tool-sep"></div>
          <button class="tool-btn" id="clearCanvasBtn" title="Clear Canvas"><i class="fas fa-trash-alt"></i></button>
        </div>

        <!-- Center Canvas -->
        <div class="wb-canvas-area">
          <div class="wb-topbar">
            <a href="${PREFIX}/dashboard" class="btn btn-sm btn-outline-secondary"><i class="fas fa-arrow-left"></i></a>
            <span class="fw-bold" style="font-size:14px;">${esc(session.title)}</span>
            <span class="badge bg-${session.mode === 'live' ? 'primary' : 'info'}">${session.mode}</span>
            <div class="wb-zoom-controls ms-auto">
              <button id="zoomOut">−</button>
              <span id="zoomLevel">100%</span>
              <button id="zoomIn">+</button>
              <button id="zoomFit" title="Fit">⊞</button>
            </div>
            <div class="wb-collab-avatars ms-2">
              ${collaborators.filter(c => c.is_online).map(c => `
                <img src="${c.avatar_url || '/public/icon.png'}" class="wb-collab-avatar" title="${esc(c.display_name)}" alt="${esc(c.display_name)}">
              `).join('')}
            </div>
            <span class="text-muted small ms-1">${collaborators.filter(c => c.is_online).length} online</span>
            <div class="ms-2">
              <button class="btn btn-sm btn-outline-success" id="saveBtn"><i class="fas fa-save me-1"></i>Save</button>
              <div class="btn-group">
                <button class="btn btn-sm btn-outline-secondary dropdown-toggle" data-bs-toggle="dropdown"><i class="fas fa-download"></i></button>
                <ul class="dropdown-menu">
                  <li><a class="dropdown-item" href="${PREFIX}/export/${sid}/png">Export PNG</a></li>
                  <li><a class="dropdown-item" href="${PREFIX}/export/${sid}/pdf">Export PDF</a></li>
                  <li><a class="dropdown-item" href="${PREFIX}/export/${sid}/json">Export JSON</a></li>
                </ul>
              </div>
              <button class="btn btn-sm btn-outline-primary" id="presentBtn" title="Present"><i class="fas fa-desktop"></i></button>
            </div>
          </div>
          <div class="wb-canvas-wrapper" id="canvasWrapper">
            <canvas id="wbCanvas" class="wb-canvas" width="${activePageData.width}" height="${activePageData.height}"></canvas>
          </div>
        </div>

        <!-- Right Sidebar — Page Thumbnails -->
        <div class="wb-sidebar">
          <div class="d-flex justify-content-between align-items-center mb-2">
            <span class="fw-bold small">Pages</span>
            <button class="btn btn-sm btn-outline-primary" id="addPageBtn" title="Add Page"><i class="fas fa-plus"></i></button>
          </div>
          <div id="pageThumbnails">
            ${pages.map((p, i) => `
              <div class="wb-page-thumb ${p.id === activePageData.id ? 'active' : ''}" data-page-id="${p.id}" data-page-number="${p.page_number}">
                <div class="thumb-preview">
                  <canvas class="page-thumb-canvas" width="184" height="104" data-page-id="${p.id}"></canvas>
                </div>
                <div class="d-flex justify-content-between align-items-center mt-1">
                  <small class="text-truncate flex-grow-1" title="${esc(p.title)}">${esc(p.title || 'Page ' + p.page_number)}</small>
                  <div class="dropdown">
                    <button class="btn btn-sm p-0" data-bs-toggle="dropdown"><i class="fas fa-ellipsis-v text-muted"></i></button>
                    <ul class="dropdown-menu dropdown-menu-end">
                      <li><a class="dropdown-item page-rename" data-page-id="${p.id}">Rename</a></li>
                      <li><a class="dropdown-item page-duplicate" data-page-id="${p.id}">Duplicate</a></li>
                      ${pages.length > 1 ? `<li><a class="dropdown-item text-danger page-delete" data-page-id="${p.id}">Delete</a></li>` : ''}
                    </ul>
                  </div>
                </div>
              </div>
            `).join('')}
          </div>

          <!-- Version History -->
          <div class="mt-3">
            <div class="fw-bold small mb-1">History</div>
            <div id="versionHistory" class="small" style="max-height:200px;overflow-y:auto;">
              ${versions.length ? versions.slice(0, 10).map(v => `
                <div class="d-flex justify-content-between align-items-center py-1 border-bottom">
                  <span class="text-truncate" style="max-width:120px;" title="${esc(v.version_label || 'Auto-save')}">${esc(v.version_label || 'Auto-save')}</span>
                  <div>
                    <button class="btn btn-sm p-0 text-primary version-restore" data-version-id="${v.id}" title="Restore"><i class="fas fa-undo"></i></button>
                  </div>
                </div>
              `).join('') : '<div class="text-muted">No history yet</div>'}
            </div>
          </div>
        </div>
      </div>

      <!-- Hidden data store -->
      <script>
        window.WB = {
          sessionId: ${sid},
          tenantId: ${tid},
          userId: ${uid},
          pageId: ${activePageData.id},
          pageNumber: ${activePageData.page_number},
          permission: '${myPermission}',
          totalPages: ${pages.length},
          autoSaveInterval: ${session.auto_save_interval || 30},
          canvasData: ${activePageData.canvas_data ? JSON.stringify(activePageData.canvas_data) : 'null'},
          backgroundConfig: ${activePageData.background_config ? JSON.stringify(activePageData.background_config) : 'null'},
          contentData: ${JSON.stringify(contents)},
          mode: '${session.mode}',
          submissionId: ${submissionId || 'null'},
          apiBase: '${PREFIX}'
        };
      </script>
    `, req);

    res.send(html);
  }));

  // 4b. API: Save canvas content (auto-save or manual)
  app.post(`${PREFIX}/api/save`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { session_id, page_id, canvas_data, thumbnail } = req.body;

    if (!session_id || !page_id) {
      return json(res, { error: 'session_id and page_id required' }, 400);
    }

    // Verify ownership
    const { rows: pages } = await pool.query(
      `SELECT wp.*, ws.created_by AS session_owner
       FROM whiteboard_pages wp
       JOIN whiteboard_sessions ws ON ws.id=wp.session_id
       WHERE wp.id=$1 AND wp.tenant_id=$2 AND wp.session_id=$3`,
      [page_id, tid, session_id]
    );

    if (!pages.length) return json(res, { error: 'Page not found' }, 404);

    // Check permission
    const { rows: collabs } = await pool.query(
      'SELECT permission FROM whiteboard_collaborators WHERE session_id=$1 AND user_id=$2 AND tenant_id=$3',
      [session_id, uid, tid]
    );
    const perm = (pages[0].session_owner === uid || userRole(req) === 'admin')
      ? 'presenter' : (collabs.length ? collabs[0].permission : 'viewer');

    if (perm === 'viewer') return json(res, { error: 'No write permission' }, 403);

    await pool.query(
      'UPDATE whiteboard_pages SET canvas_data=$1, thumbnail=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4',
      [canvas_data || null, thumbnail || null, page_id, tid]
    );

    await pool.query(
      `UPDATE whiteboard_sessions SET last_saved_at=NOW(), status='active', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
      [session_id, tid]
    );

    json(res, { success: true, saved_at: new Date().toISOString() });
  }));

  // 4c. API: Save content block
  app.post(`${PREFIX}/api/content`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { page_id, content_type, content_data, z_index, locked } = req.body;

    if (!page_id || !content_type) {
      return json(res, { error: 'page_id and content_type required' }, 400);
    }

    const result = await pool.query(
      `INSERT INTO whiteboard_content (tenant_id, page_id, content_type, content_data, z_index, locked, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id`,
      [tid, page_id, content_type, JSON.stringify(content_data || {}), z_index || 0, locked ? 1 : 0, uid]
    );

    json(res, { success: true, content_id: result.rows[0].id }, 201);
  }));

  // 4d. API: Update content block
  app.put(`${PREFIX}/api/content/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const cid = int(req.params.id);
    const { content_data, z_index, locked } = req.body;

    const updates = [];
    const params = [];

    if (content_data !== undefined) { updates.push(`content_data=$${updates.length + 1}`); params.push(JSON.stringify(content_data)); }
    if (z_index !== undefined) { updates.push(`z_index=$${updates.length + 1}`); params.push(z_index); }
    if (locked !== undefined) { updates.push(`locked=$${updates.length + 1}`); params.push(locked ? 1 : 0); }

    if (!updates.length) return json(res, { error: 'Nothing to update' }, 400);

    updates.push('updated_at=NOW()');
    params.push(cid, tid);

    await pool.query(
      `UPDATE whiteboard_content SET ${updates.join(',')} WHERE id=$${params.length - 1} AND tenant_id=$${params.length}`,
      params
    );

    json(res, { success: true });
  }));

  // 4e. API: Delete content block
  app.delete(`${PREFIX}/api/content/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const cid = int(req.params.id);

    await pool.query('DELETE FROM whiteboard_content WHERE id=$1 AND tenant_id=$2', [cid, tid]);
    json(res, { success: true });
  }));

  // 4f. API: Clear all content on a page
  app.post(`${PREFIX}/api/clear-page`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { page_id } = req.body;

    if (!page_id) return json(res, { error: 'page_id required' }, 400);

    await pool.query(
      'DELETE FROM whiteboard_content WHERE page_id=$1 AND tenant_id=$2',
      [page_id, tid]
    );

    await pool.query(
      'UPDATE whiteboard_pages SET canvas_data=NULL, thumbnail=NULL, updated_at=NOW() WHERE id=$1 AND tenant_id=$2',
      [page_id, tid]
    );

    json(res, { success: true });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  5. PAGES MANAGEMENT
  // ══════════════════════════════════════════════════════════════════════════

  // 5a. Add page
  app.post(`${PREFIX}/api/pages`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { session_id, title, background_config } = req.body;

    if (!session_id) return json(res, { error: 'session_id required' }, 400);

    // Get next page number
    const { rows: maxNum } = await pool.query(
      'SELECT COALESCE(MAX(page_number),0) AS max_num FROM whiteboard_pages WHERE session_id=$1 AND tenant_id=$2',
      [session_id, tid]
    );
    const nextNum = (maxNum[0]?.max_num || 0) + 1;

    const result = await pool.query(
      `INSERT INTO whiteboard_pages (tenant_id, session_id, page_number, title, background_config, width, height)
       VALUES ($1, $2, $3, $4, $5, 1920, 1080) RETURNING id`,
      [tid, session_id, nextNum, title || ('Page ' + nextNum), background_config || null]
    );

    json(res, { success: true, page_id: result.rows[0].id, page_number: nextNum }, 201);
  }));

  // 5b. Rename page
  app.put(`${PREFIX}/api/pages/:id/rename`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const pid = int(req.params.id);
    const { title } = req.body;

    await pool.query(
      'UPDATE whiteboard_pages SET title=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [title || '', pid, tid]
    );

    json(res, { success: true });
  }));

  // 5c. Delete page
  app.delete(`${PREFIX}/api/pages/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const pid = int(req.params.id);

    // Check minimum page count
    const { rows: pageInfo } = await pool.query(
      'SELECT session_id FROM whiteboard_pages WHERE id=$1 AND tenant_id=$2',
      [pid, tid]
    );

    if (pageInfo.length) {
      const sessionId = pageInfo[0].session_id;
      const { rows: count } = await pool.query(
        'SELECT COUNT(*) AS cnt FROM whiteboard_pages WHERE session_id=$1 AND tenant_id=$2',
        [sessionId, tid]
      );

      if (count[0].cnt <= 1) {
        return json(res, { error: 'Cannot delete the only page' }, 400);
      }

      // Delete will cascade to content
      await pool.query('DELETE FROM whiteboard_pages WHERE id=$1 AND tenant_id=$2', [pid, tid]);

      // Re-number remaining pages
      const { rows: remaining } = await pool.query(
        'SELECT id, page_number FROM whiteboard_pages WHERE session_id=$1 AND tenant_id=$2 ORDER BY page_number',
        [sessionId, tid]
      );
      for (let i = 0; i < remaining.length; i++) {
        await pool.query(
          'UPDATE whiteboard_pages SET page_number=$1 WHERE id=$2 AND tenant_id=$3',
          [i + 1, remaining[i].id, tid]
        );
      }
    }

    json(res, { success: true });
  }));

  // 5d. Duplicate page
  app.post(`${PREFIX}/api/pages/:id/duplicate`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const pid = int(req.params.id);

    const { rows: pages } = await pool.query(
      'SELECT * FROM whiteboard_pages WHERE id=$1 AND tenant_id=$2',
      [pid, tid]
    );
    if (!pages.length) return json(res, { error: 'Page not found' }, 404);

    const orig = pages[0];

    // Get next page number
    const { rows: maxNum } = await pool.query(
      'SELECT COALESCE(MAX(page_number),0) AS max_num FROM whiteboard_pages WHERE session_id=$1 AND tenant_id=$2',
      [orig.session_id, tid]
    );
    const nextNum = (maxNum[0]?.max_num || 0) + 1;

    const result = await pool.query(
      `INSERT INTO whiteboard_pages (tenant_id, session_id, page_number, title, background_config, canvas_data, thumbnail, width, height)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [tid, orig.session_id, nextNum, orig.title + ' (Copy)', orig.background_config, orig.canvas_data, orig.thumbnail, orig.width, orig.height]
    );

    // Copy content blocks
    const { rows: contents } = await pool.query(
      'SELECT * FROM whiteboard_content WHERE page_id=$1', [pid]
    );
    for (const c of contents) {
      await pool.query(
        `INSERT INTO whiteboard_content (tenant_id, page_id, content_type, content_data, z_index, locked, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tid, result.rows[0].id, c.content_type, c.content_data, c.z_index, c.locked, uid]
      );
    }

    json(res, { success: true, page_id: result.rows[0].id, page_number: nextNum });
  }));

  // 5e. Reorder pages
  app.post(`${PREFIX}/api/pages/reorder`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { session_id, page_order } = req.body;

    if (!session_id || !Array.isArray(page_order)) {
      return json(res, { error: 'session_id and page_order array required' }, 400);
    }

    for (let i = 0; i < page_order.length; i++) {
      await pool.query(
        'UPDATE whiteboard_pages SET page_number=$1 WHERE id=$2 AND tenant_id=$3 AND session_id=$4',
        [i + 1, page_order[i], tid, session_id]
      );
    }

    json(res, { success: true });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  6. TEMPLATES
  // ══════════════════════════════════════════════════════════════════════════

  // 6a. Browse templates
  app.get(`${PREFIX}/templates`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const category = req.query.category || '';

    let where = '((tenant_id=0 AND is_builtin=1) OR tenant_id=$1)';
    const params = [tid];

    if (category) {
      where += ' AND category=$2';
      params.push(category);
    }

    const { rows: templates } = await pool.query(
      `SELECT * FROM whiteboard_templates WHERE ${where} ORDER BY is_builtin DESC, category, name`,
      params
    );

    // Get distinct categories
    const { rows: categories } = await pool.query(
      `SELECT DISTINCT category FROM whiteboard_templates
       WHERE (tenant_id=0 AND is_builtin=1) OR tenant_id=$1
       ORDER BY category`,
      [tid]
    );

    const html = renderPage('Whiteboard Templates', `
      <div class="wb-templates">
        <h2 class="mb-4"><i class="fas fa-th-large me-2"></i>Whiteboard Templates</h2>

        <!-- Category Filter -->
        <div class="d-flex flex-wrap gap-2 mb-4">
          <a href="${PREFIX}/templates" class="btn btn-sm ${!category ? 'btn-primary' : 'btn-outline-primary'}">All</a>
          ${categories.map(c => `
            <a href="${PREFIX}/templates?category=${encodeURIComponent(c.category)}" class="btn btn-sm ${category === c.category ? 'btn-primary' : 'btn-outline-primary'}">${esc(c.category)}</a>
          `).join('')}
        </div>

        <!-- Templates Grid -->
        <div class="row g-3">
          ${templates.map(t => `
            <div class="col-md-4 col-lg-3">
              <div class="card h-100">
                <div class="card-body text-center p-3">
                  <div class="bg-light rounded mb-2" style="height:120px;display:flex;align-items:center;justify-content:center;">
                    <i class="fas fa-file-alt fa-2x text-muted"></i>
                  </div>
                  <h6 class="mb-1">${esc(t.name)}</h6>
                  <p class="text-muted small mb-2">${esc(t.description || '').substring(0, 80)}</p>
                  <span class="badge bg-secondary">${esc(t.category)}</span>
                  ${t.is_builtin ? '<span class="badge bg-info ms-1">Built-in</span>' : ''}
                </div>
                <div class="card-footer p-2">
                  <a href="${PREFIX}/sessions/new?template=${t.id}" class="btn btn-sm btn-primary w-100">
                    <i class="fas fa-plus me-1"></i>Use Template
                  </a>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        ${!templates.length ? '<div class="text-center text-muted py-5">No templates found in this category.</div>' : ''}

        <!-- Create Custom Template -->
        <div class="card mt-4">
          <div class="card-header"><i class="fas fa-paint-brush me-2"></i>Create Custom Template</div>
          <div class="card-body">
            <form method="POST" action="${PREFIX}/templates">
              <div class="row g-3">
                <div class="col-md-4">
                  <label class="form-label">Template Name *</label>
                  <input type="text" name="name" class="form-control" required maxlength="255">
                </div>
                <div class="col-md-3">
                  <label class="form-label">Category</label>
                  <input type="text" name="category" class="form-control" placeholder="e.g., science" maxlength="100">
                </div>
                <div class="col-md-3">
                  <label class="form-label">Source Session ID</label>
                  <input type="number" name="session_id" class="form-control" placeholder="Copy from session">
                </div>
                <div class="col-md-2 d-flex align-items-end">
                  <button type="submit" class="btn btn-primary w-100"><i class="fas fa-save me-1"></i>Create</button>
                </div>
                <div class="col-12">
                  <label class="form-label">Description</label>
                  <textarea name="description" class="form-control" rows="2"></textarea>
                </div>
              </div>
            </form>
          </div>
        </div>
      </div>
    `, req);

    res.send(html);
  }));

  // 6b. Create custom template
  app.post(`${PREFIX}/templates`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { name, description, category, session_id } = req.body;

    if (!name || !name.trim()) {
      return res.redirect(`${PREFIX}/templates?error=Name+required`);
    }

    let config = JSON.stringify({ background: '#FFFFFF' });

    if (session_id) {
      // Copy background config from the session
      const { rows: sessions } = await pool.query(
        'SELECT background_config FROM whiteboard_sessions WHERE id=$1 AND tenant_id=$2',
        [session_id, tid]
      );
      if (sessions.length && sessions[0].background_config) {
        config = sessions[0].background_config;
      }
    }

    await pool.query(
      `INSERT INTO whiteboard_templates (tenant_id, name, description, category, config, is_builtin, is_public, created_by)
       VALUES ($1, $2, $3, $4, $5, 0, 1, $6)`,
      [tid, name.trim(), description || null, category || 'custom', config, uid]
    );

    audit(req, 'whiteboard_template_create', { name });
    res.redirect(`${PREFIX}/templates?success=1`);
  }));

  // 6c. Delete template
  app.post(`${PREFIX}/templates/:id/delete`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const tplId = int(req.params.id);

    // Only allow deleting non-builtin tenant-specific templates
    await pool.query(
      'DELETE FROM whiteboard_templates WHERE id=$1 AND tenant_id=$2 AND is_builtin=0',
      [tplId, tid]
    );

    json(res, { success: true });
  }));

  // 6d. API: Get template config
  app.get(`${PREFIX}/api/templates/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const tplId = int(req.params.id);

    const { rows: templates } = await pool.query(
      'SELECT * FROM whiteboard_templates WHERE id=$1 AND (tenant_id=0 OR tenant_id=$2)',
      [tplId, tid]
    );

    if (!templates.length) return json(res, { error: 'Template not found' }, 404);
    json(res, templates[0]);
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  7. GALLERY — Browse & Search saved whiteboards
  // ══════════════════════════════════════════════════════════════════════════

  // 7a. Gallery page
  app.get(`${PREFIX}/gallery`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const page = int(req.query.page, 1);
    const perPage = int(req.query.perPage, 12);
    const search = (req.query.q || '').trim();
    const status = req.query.status || '';
    const mode = req.query.mode || '';
    const sortBy = req.query.sort || 'updated_at';
    const sortOrder = req.query.order || 'DESC';

    // Build WHERE clause
    let where = 'ws.tenant_id=$1';
    const params = [tid];

    // Only show sessions user owns or is collaborator on
    where += ' AND (ws.created_by=$2 OR ws.id IN (SELECT session_id FROM whiteboard_collaborators WHERE user_id=$3))';
    params.push(uid, uid);

    if (search) {
      where += ` AND (ws.title LIKE $${params.length + 1} OR ws.description LIKE $${params.length + 2})`;
      const searchPattern = '%' + search + '%';
      params.push(searchPattern, searchPattern);
    }

    if (status) {
      where += ` AND ws.status=$${params.length + 1}`;
      params.push(status);
    }

    if (mode) {
      where += ` AND ws.mode=$${params.length + 1}`;
      params.push(mode);
    }

    const validSortColumns = ['title', 'created_at', 'updated_at', 'status', 'mode'];
    const sortCol = validSortColumns.includes(sortBy) ? sortBy : 'updated_at';
    const sortDir = sortOrder.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

    // Get total count
    const { rows: countResult } = await pool.query(
      `SELECT COUNT(*) AS total FROM whiteboard_sessions ws WHERE ${where}`,
      params
    );
    const total = countResult[0]?.total || 0;
    const pag = paginate(page, perPage, total);

    // Get sessions
    const { rows: sessions } = await pool.query(
      `SELECT ws.*, u.display_name AS creator_name,
        (SELECT COUNT(*) FROM whiteboard_pages WHERE session_id=ws.id) AS page_count
       FROM whiteboard_sessions ws
       LEFT JOIN users u ON u.id=ws.created_by
       WHERE ${where}
       ORDER BY ws.${sortCol} ${sortDir}
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pag.perPage, pag.offset]
    );

    const html = renderPage('Whiteboard Gallery', `
      <div class="wb-gallery">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2><i class="fas fa-images me-2"></i>Whiteboard Gallery</h2>
          <a href="${PREFIX}/sessions/new" class="btn btn-primary"><i class="fas fa-plus me-1"></i>New Session</a>
        </div>

        <!-- Search & Filters -->
        <div class="card mb-4">
          <div class="card-body">
            <form method="GET" action="${PREFIX}/gallery" class="row g-2 align-items-end">
              <div class="col-md-4">
                <label class="form-label">Search</label>
                <input type="text" name="q" class="form-control" value="${esc(search)}" placeholder="Search whiteboards...">
              </div>
              <div class="col-md-2">
                <label class="form-label">Status</label>
                <select name="status" class="form-select">
                  <option value="">All</option>
                  <option value="draft" ${status === 'draft' ? 'selected' : ''}>Draft</option>
                  <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
                  <option value="archived" ${status === 'archived' ? 'selected' : ''}>Archived</option>
                </select>
              </div>
              <div class="col-md-2">
                <label class="form-label">Mode</label>
                <select name="mode" class="form-select">
                  <option value="">All</option>
                  <option value="live" ${mode === 'live' ? 'selected' : ''}>Live</option>
                  <option value="static" ${mode === 'static' ? 'selected' : ''}>Static</option>
                </select>
              </div>
              <div class="col-md-2">
                <label class="form-label">Sort</label>
                <select name="sort" class="form-select">
                  <option value="updated_at" ${sortBy === 'updated_at' ? 'selected' : ''}>Updated</option>
                  <option value="created_at" ${sortBy === 'created_at' ? 'selected' : ''}>Created</option>
                  <option value="title" ${sortBy === 'title' ? 'selected' : ''}>Title</option>
                </select>
              </div>
              <div class="col-md-2">
                <button type="submit" class="btn btn-outline-primary w-100"><i class="fas fa-search me-1"></i>Search</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Results Count -->
        <div class="text-muted small mb-3">${total} whiteboard(s) found — Page ${pag.page} of ${pag.totalPages}</div>

        <!-- Gallery Grid -->
        <div class="row g-3">
          ${sessions.map(s => `
            <div class="col-md-4 col-lg-3">
              <div class="card h-100">
                <div class="card-body p-0">
                  <a href="${PREFIX}/draw/${s.id}">
                    <div class="bg-light rounded-top" style="height:140px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
                      ${s.thumbnail
                        ? '<img src="' + esc(s.thumbnail) + '" style="width:100%;height:100%;object-fit:cover;" alt="Thumbnail">'
                        : '<div style="width:100%;height:100%;display:flex;align-items:center;justify-content:center;"><i class="fas fa-chalkboard fa-3x text-muted"></i></div>'
                      }
                    </div>
                  </a>
                  <div class="p-3">
                    <h6 class="mb-1"><a href="${PREFIX}/draw/${s.id}" class="text-decoration-none">${esc(s.title)}</a></h6>
                    <p class="text-muted small mb-2">${esc(s.description || '').substring(0, 60)}</p>
                    <div class="d-flex justify-content-between align-items-center">
                      <div>
                        <span class="badge bg-${s.status === 'active' ? 'success' : s.status === 'archived' ? 'secondary' : 'warning'}">${s.status}</span>
                        <span class="badge bg-${s.mode === 'live' ? 'primary' : 'info'} ms-1">${s.mode}</span>
                      </div>
                      <small class="text-muted">${s.page_count} pg</small>
                    </div>
                  </div>
                </div>
                <div class="card-footer p-2 d-flex justify-content-between">
                  <small class="text-muted">by ${esc(s.creator_name || 'Unknown')}</small>
                  <div>
                    <a href="${PREFIX}/draw/${s.id}" class="btn btn-sm btn-outline-primary" title="Open"><i class="fas fa-pen"></i></a>
                    <button class="btn btn-sm btn-outline-secondary share-session-btn" data-session-id="${s.id}" title="Share"><i class="fas fa-share-alt"></i></button>
                  </div>
                </div>
              </div>
            </div>
          `).join('')}
        </div>

        ${!sessions.length ? '<div class="text-center text-muted py-5"><i class="fas fa-inbox fa-3x mb-3"></i><p>No whiteboards found.</p></div>' : ''}

        <!-- Pagination -->
        ${pag.totalPages > 1 ? `
        <nav class="mt-4">
          <ul class="pagination justify-content-center">
            ${pag.page > 1 ? `<li class="page-item"><a class="page-link" href="${PREFIX}/gallery?page=${pag.page - 1}&q=${encodeURIComponent(search)}&status=${status}&mode=${mode}&sort=${sortBy}&order=${sortOrder}">Previous</a></li>` : ''}
            ${Array.from({ length: Math.min(pag.totalPages, 10) }, (_, i) => {
              const p = Math.max(1, Math.min(pag.page - 4, pag.totalPages - 9)) + i;
              if (p > pag.totalPages) return '';
              return `<li class="page-item ${p === pag.page ? 'active' : ''}"><a class="page-link" href="${PREFIX}/gallery?page=${p}&q=${encodeURIComponent(search)}&status=${status}&mode=${mode}&sort=${sortBy}&order=${sortOrder}">${p}</a></li>`;
            }).join('')}
            ${pag.page < pag.totalPages ? `<li class="page-item"><a class="page-link" href="${PREFIX}/gallery?page=${pag.page + 1}&q=${encodeURIComponent(search)}&status=${status}&mode=${mode}&sort=${sortBy}&order=${sortOrder}">Next</a></li>` : ''}
          </ul>
        </nav>
        ` : ''}
      </div>
    `, req);

    res.send(html);
  }));

  // 7b. Share session — get share link
  app.get(`${PREFIX}/api/share/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sid = int(req.params.id);

    const { rows: sessions } = await pool.query(
      'SELECT id, title FROM whiteboard_sessions WHERE id=$1 AND tenant_id=$2',
      [sid, tid]
    );

    if (!sessions.length) return json(res, { error: 'Session not found' }, 404);

    json(res, {
      success: true,
      share_url: `${PREFIX}/draw/${sid}`,
      embed_code: `<iframe src="${PREFIX}/draw/${sid}" width="100%" height="600" frameborder="0"></iframe>`,
      title: sessions[0].title
    });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  8. EXPORT
  // ══════════════════════════════════════════════════════════════════════════

  // 8a. Export as PNG
  app.get(`${PREFIX}/export/:id/png`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sid = int(req.params.id);

    const { rows: pages } = await pool.query(
      'SELECT * FROM whiteboard_pages WHERE session_id=$1 AND tenant_id=$2 ORDER BY page_number',
      [sid, tid]
    );
    const { rows: session } = await pool.query(
      'SELECT title FROM whiteboard_sessions WHERE id=$1 AND tenant_id=$2',
      [sid, tid]
    );

    if (!session.length) return res.status(404).send('Session not found');

    // Return a JSON payload with export-ready data (client will render to PNG)
    const exportData = {
      format: 'png',
      session_title: session[0].title,
      pages: pages.map(p => ({
        page_number: p.page_number,
        title: p.title,
        width: p.width,
        height: p.height,
        canvas_data: p.canvas_data,
        background_config: p.background_config
      })),
      exported_at: new Date().toISOString()
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="whiteboard-${sid}-export.json"`);
    res.send(JSON.stringify(exportData, null, 2));
  }));

  // 8b. Export as PDF
  app.get(`${PREFIX}/export/:id/pdf`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sid = int(req.params.id);

    const { rows: pages } = await pool.query(
      'SELECT * FROM whiteboard_pages WHERE session_id=$1 AND tenant_id=$2 ORDER BY page_number',
      [sid, tid]
    );
    const { rows: session } = await pool.query(
      'SELECT title FROM whiteboard_sessions WHERE id=$1 AND tenant_id=$2',
      [sid, tid]
    );

    if (!session.length) return res.status(404).send('Session not found');

    // Build an HTML document that can be printed to PDF via browser
    const pdfHtml = `<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>${esc(session[0].title)}</title>
<style>
  @page { size: landscape; margin: 10mm; }
  body { margin: 0; font-family: Arial, sans-serif; }
  .pdf-page { page-break-after: always; border: 1px solid #ccc; margin-bottom: 20px; position: relative; }
  .pdf-page:last-child { page-break-after: auto; }
  .pdf-page-header { padding: 8px 12px; background: #f0f0f0; border-bottom: 1px solid #ccc; font-size: 12px; color: #666; }
  .pdf-page canvas { display: block; margin: 0 auto; }
  .pdf-cover { text-align: center; padding: 100px 40px; }
  .pdf-cover h1 { font-size: 28px; margin-bottom: 10px; }
  .pdf-cover p { color: #888; }
</style></head><body>
  <div class="pdf-cover">
    <h1>${esc(session[0].title)}</h1>
    <p>Exported on ${new Date().toLocaleString()} &middot; ${pages.length} page(s)</p>
  </div>
  ${pages.map((p, i) => `
    <div class="pdf-page">
      <div class="pdf-page-header">Page ${p.page_number} — ${esc(p.title || '')}</div>
      <div style="background:white;min-height:500px;display:flex;align-items:center;justify-content:center;">
        <div style="color:#ccc;font-size:14px;">Canvas content — render via client-side export tool</div>
      </div>
    </div>
  `).join('')}
  <script>
    // Client-side PDF rendering would populate canvas elements here
    window.print();
  </script>
</body></html>`;

    res.setHeader('Content-Type', 'text/html');
    res.setHeader('Content-Disposition', `inline; filename="whiteboard-${sid}.html"`);
    res.send(pdfHtml);
  }));

  // 8c. Export as JSON
  app.get(`${PREFIX}/export/:id/json`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sid = int(req.params.id);

    const { rows: sessions } = await pool.query(
      'SELECT * FROM whiteboard_sessions WHERE id=$1 AND tenant_id=$2',
      [sid, tid]
    );
    if (!sessions.length) return res.status(404).send('Session not found');

    const session = sessions[0];

    const { rows: pages } = await pool.query(
      'SELECT * FROM whiteboard_pages WHERE session_id=$1 AND tenant_id=$2 ORDER BY page_number',
      [sid, tid]
    );

    const exportData = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      session: {
        title: session.title,
        description: session.description,
        mode: session.mode,
        background_config: session.background_config
      },
      pages: await Promise.all(pages.map(async (p) => {
        const { rows: contents } = await pool.query(
          'SELECT * FROM whiteboard_content WHERE page_id=$1 ORDER BY z_index, created_at',
          [p.id]
        );
        return {
          page_number: p.page_number,
          title: p.title,
          width: p.width,
          height: p.height,
          background_config: p.background_config,
          canvas_data: p.canvas_data,
          content_blocks: contents.map(c => ({
            id: c.id,
            type: c.content_type,
            data: typeof c.content_data === 'string' ? JSON.parse(c.content_data) : c.content_data,
            z_index: c.z_index,
            locked: c.locked
          }))
        };
      }))
    };

    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="whiteboard-${sid}-${Date.now()}.json"`);
    res.send(JSON.stringify(exportData, null, 2));
  }));

  // 8d. Import from JSON
  app.post(`${PREFIX}/import`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { title, import_data } = req.body;

    if (!import_data) return json(res, { error: 'import_data required' }, 400);

    let data;
    try {
      data = typeof import_data === 'string' ? JSON.parse(import_data) : import_data;
    } catch (e) {
      return json(res, { error: 'Invalid JSON data' }, 400);
    }

    const sessionTitle = title || data.session?.title || 'Imported Whiteboard';

    // Create session
    const result = await pool.query(
      `INSERT INTO whiteboard_sessions (tenant_id, title, description, mode, status, background_config, created_by, presenter_id)
       VALUES ($1, $2, $3, $4, 'draft', $5, $6, $7) RETURNING id`,
      [tid, sessionTitle, data.session?.description || null, data.session?.mode || 'static',
       data.session?.background_config || null, uid, uid]
    );

    const sessionId = result.rows[0].id;

    // Import pages
    if (Array.isArray(data.pages)) {
      for (let i = 0; i < data.pages.length; i++) {
        const p = data.pages[i];
        const pgResult = await pool.query(
          `INSERT INTO whiteboard_pages (tenant_id, session_id, page_number, title, background_config, canvas_data, width, height)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [tid, sessionId, p.page_number || (i + 1), p.title || ('Page ' + (i + 1)),
           p.background_config || null, typeof p.canvas_data === 'string' ? p.canvas_data : JSON.stringify(p.canvas_data),
           p.width || 1920, p.height || 1080]
        );

        // Import content blocks
        if (Array.isArray(p.content_blocks)) {
          for (const c of p.content_blocks) {
            await pool.query(
              `INSERT INTO whiteboard_content (tenant_id, page_id, content_type, content_data, z_index, locked, created_by)
               VALUES ($1, $2, $3, $4, $5, $6, $7)`,
              [tid, pgResult.rows[0].id, c.type || 'freehand',
               typeof c.data === 'string' ? c.data : JSON.stringify(c.data || {}),
               c.z_index || 0, c.locked ? 1 : 0, uid]
            );
          }
        }
      }
    }

    audit(req, 'whiteboard_import', { session_id: sessionId });
    json(res, { success: true, session_id: sessionId }, 201);
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  9. VERSION HISTORY
  // ══════════════════════════════════════════════════════════════════════════

  // 9a. Save version snapshot
  app.post(`${PREFIX}/api/versions`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { session_id, page_id, version_label, snapshot_data } = req.body;

    if (!session_id || !snapshot_data) {
      return json(res, { error: 'session_id and snapshot_data required' }, 400);
    }

    await pool.query(
      `INSERT INTO whiteboard_version_history (tenant_id, session_id, page_id, version_label, snapshot_data, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tid, session_id, page_id || null, version_label || 'Manual save',
       typeof snapshot_data === 'string' ? snapshot_data : JSON.stringify(snapshot_data), uid]
    );

    json(res, { success: true });
  }));

  // 9b. List versions
  app.get(`${PREFIX}/api/versions/:sessionId`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sessionId = int(req.params.sessionId);

    const { rows: versions } = await pool.query(
      `SELECT vh.*, u.display_name AS creator_name
       FROM whiteboard_version_history vh
       LEFT JOIN users u ON u.id=vh.created_by
       WHERE vh.session_id=$1 AND vh.tenant_id=$2
       ORDER BY vh.created_at DESC LIMIT 50`,
      [sessionId, tid]
    );

    json(res, versions);
  }));

  // 9c. Restore version
  app.post(`${PREFIX}/api/versions/:id/restore`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const vid = int(req.params.id);

    const { rows: versions } = await pool.query(
      'SELECT * FROM whiteboard_version_history WHERE id=$1 AND tenant_id=$2',
      [vid, tid]
    );

    if (!versions.length) return json(res, { error: 'Version not found' }, 404);

    const version = versions[0];

    // Restore snapshot data to the page (if page_id exists)
    if (version.page_id) {
      let snapshot;
      try {
        snapshot = typeof version.snapshot_data === 'string' ? JSON.parse(version.snapshot_data) : version.snapshot_data;
      } catch (e) {
        snapshot = version.snapshot_data;
      }

      if (snapshot && snapshot.canvas_data) {
        await pool.query(
          'UPDATE whiteboard_pages SET canvas_data=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
          [snapshot.canvas_data, version.page_id, tid]
        );
      }

      // Restore content blocks if present
      if (snapshot && Array.isArray(snapshot.content_blocks)) {
        // Clear existing content
        await pool.query(
          'DELETE FROM whiteboard_content WHERE page_id=$1 AND tenant_id=$2',
          [version.page_id, tid]
        );

        // Re-insert from snapshot
        for (const c of snapshot.content_blocks) {
          await pool.query(
            `INSERT INTO whiteboard_content (tenant_id, page_id, content_type, content_data, z_index, locked, created_by)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [tid, version.page_id, c.type || 'freehand',
             typeof c.data === 'string' ? c.data : JSON.stringify(c.data || {}),
             c.z_index || 0, c.locked ? 1 : 0, userId(req)]
          );
        }
      }
    }

    audit(req, 'whiteboard_version_restore', { version_id: vid });
    json(res, { success: true, restored_version: vid });
  }));

  // 9d. Delete version
  app.delete(`${PREFIX}/api/versions/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const vid = int(req.params.id);

    await pool.query(
      'DELETE FROM whiteboard_version_history WHERE id=$1 AND tenant_id=$2',
      [vid, tid]
    );

    json(res, { success: true });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  10. LESSON INTEGRATION
  // ══════════════════════════════════════════════════════════════════════════

  // 10a. Link session to lesson plan
  app.post(`${PREFIX}/api/lesson-link`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { session_id, lesson_plan_id } = req.body;

    if (!session_id) return json(res, { error: 'session_id required' }, 400);

    await pool.query(
      'UPDATE whiteboard_sessions SET lesson_plan_id=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [lesson_plan_id || null, session_id, tid]
    );

    audit(req, 'whiteboard_lesson_link', { session_id, lesson_plan_id });
    json(res, { success: true });
  }));

  // 10b. Get lesson-linked sessions
  app.get(`${PREFIX}/api/lesson/:lessonId/sessions`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const lessonId = int(req.params.lessonId);

    const { rows: sessions } = await pool.query(
      `SELECT ws.*, u.display_name AS creator_name,
        (SELECT COUNT(*) FROM whiteboard_pages WHERE session_id=ws.id) AS page_count
       FROM whiteboard_sessions ws
       JOIN users u ON u.id=ws.created_by
       WHERE ws.lesson_plan_id=$1 AND ws.tenant_id=$2
       ORDER BY ws.created_at DESC`,
      [lessonId, tid]
    );

    json(res, sessions);
  }));

  // 10c. Attach homework to session
  app.post(`${PREFIX}/api/homework-attach`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { session_id, homework_id, homework_title, homework_instructions, due_date } = req.body;

    if (!session_id || !homework_id) {
      return json(res, { error: 'session_id and homework_id required' }, 400);
    }

    // Store homework attachment as a content block on the first page
    const { rows: pages } = await pool.query(
      'SELECT id FROM whiteboard_pages WHERE session_id=$1 AND tenant_id=$2 ORDER BY page_number LIMIT 1',
      [session_id, tid]
    );

    if (!pages.length) return json(res, { error: 'No pages in session' }, 400);

    await pool.query(
      `INSERT INTO whiteboard_content (tenant_id, page_id, content_type, content_data, z_index, locked, created_by)
       VALUES ($1, $2, 'sticky_note', $3, 999, 1, $4)`,
      [tid, pages[0].id, JSON.stringify({
        x: 1500, y: 50, width: 300, height: 200,
        title: homework_title || 'Homework Assignment',
        body: homework_instructions || '',
        homework_id: homework_id,
        due_date: due_date || null,
        color: '#FFF3CD',
        borderColor: '#FFEEBA'
      }), uid]
    );

    audit(req, 'whiteboard_homework_attach', { session_id, homework_id });
    json(res, { success: true });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  11. STUDENT SUBMISSIONS
  // ══════════════════════════════════════════════════════════════════════════

  // 11a. Student submissions list (for teachers)
  app.get(`${PREFIX}/submissions`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const role = userRole(req);
    const uid = userId(req);
    const status = req.query.status || '';
    const page = int(req.query.page, 1);
    const perPage = int(req.query.perPage, 20);

    let where = 'wbs.tenant_id=$1';
    const params = [tid];

    if (role === 'student') {
      where += ` AND wbs.student_id=$${params.length + 1}`;
      params.push(uid);
    }

    if (status) {
      where += ` AND wbs.status=$${params.length + 1}`;
      params.push(status);
    }

    const { rows: countResult } = await pool.query(
      `SELECT COUNT(*) AS total FROM whiteboard_submissions wbs WHERE ${where}`,
      params
    );
    const total = countResult[0]?.total || 0;
    const pag = paginate(page, perPage, total);

    const { rows: submissions } = await pool.query(
      `SELECT wbs.*, u.display_name AS student_name, ws.title AS session_title,
        grader.display_name AS grader_name
       FROM whiteboard_submissions wbs
       JOIN users u ON u.id=wbs.student_id
       JOIN whiteboard_sessions ws ON ws.id=wbs.session_id
       LEFT JOIN users grader ON grader.id=wbs.graded_by
       WHERE ${where}
       ORDER BY wbs.updated_at DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, pag.perPage, pag.offset]
    );

    const html = renderPage('Whiteboard Submissions', `
      <div class="wb-submissions">
        <h2 class="mb-4"><i class="fas fa-clipboard-check me-2"></i>Whiteboard Submissions</h2>

        <!-- Status Filter -->
        <div class="d-flex flex-wrap gap-2 mb-3">
          <a href="${PREFIX}/submissions" class="btn btn-sm ${!status ? 'btn-primary' : 'btn-outline-primary'}">All (${total})</a>
          <a href="${PREFIX}/submissions?status=draft" class="btn btn-sm ${status === 'draft' ? 'btn-primary' : 'btn-outline-primary'}">Draft</a>
          <a href="${PREFIX}/submissions?status=submitted" class="btn btn-sm ${status === 'submitted' ? 'btn-primary' : 'btn-outline-primary'}">Submitted</a>
          <a href="${PREFIX}/submissions?status=graded" class="btn btn-sm ${status === 'graded' ? 'btn-primary' : 'btn-outline-primary'}">Graded</a>
          <a href="${PREFIX}/submissions?status=returned" class="btn btn-sm ${status === 'returned' ? 'btn-primary' : 'btn-outline-primary'}">Returned</a>
        </div>

        <!-- Submissions Table -->
        <div class="card">
          <div class="card-body p-0">
            <table class="table table-hover mb-0">
              <thead><tr>
                <th>Student</th><th>Whiteboard</th><th>Status</th><th>Grade</th><th>Submitted</th><th>Graded</th><th>Actions</th>
              </tr></thead>
              <tbody>
                ${submissions.map(s => `
                  <tr>
                    <td>${esc(s.student_name)}</td>
                    <td><a href="${PREFIX}/draw/${s.session_id}?submission=${s.id}">${esc(s.session_title)}</a></td>
                    <td><span class="badge bg-${s.status === 'submitted' ? 'primary' : s.status === 'graded' ? 'success' : s.status === 'returned' ? 'info' : 'warning'}">${s.status}</span></td>
                    <td>${s.grade ? esc(s.grade) + (s.score !== null ? ' (' + s.score + ')' : '') : '—'}</td>
                    <td class="small">${s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '—'}</td>
                    <td class="small">${s.graded_at ? new Date(s.graded_at).toLocaleString() : '—'}</td>
                    <td>
                      <a href="${PREFIX}/draw/${s.session_id}?submission=${s.id}" class="btn btn-sm btn-outline-primary" title="View">
                        <i class="fas fa-eye"></i>
                      </a>
                      ${(role === 'teacher' || role === 'admin') && s.status === 'submitted' ? `
                        <a href="${PREFIX}/submissions/${s.id}/grade" class="btn btn-sm btn-outline-success" title="Grade">
                          <i class="fas fa-star"></i>
                        </a>
                      ` : ''}
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        ${!submissions.length ? '<div class="text-center text-muted py-5">No submissions found.</div>' : ''}

        <!-- Pagination -->
        ${pag.totalPages > 1 ? `
        <nav class="mt-4">
          <ul class="pagination justify-content-center">
            ${Array.from({ length: pag.totalPages }, (_, i) => `
              <li class="page-item ${i + 1 === pag.page ? 'active' : ''}">
                <a class="page-link" href="${PREFIX}/submissions?page=${i + 1}&status=${status}">${i + 1}</a>
              </li>
            `).join('')}
          </ul>
        </nav>
        ` : ''}
      </div>
    `, req);

    res.send(html);
  }));

  // 11b. Create submission (student submits their whiteboard)
  app.post(`${PREFIX}/api/submissions`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { session_id, assignment_id } = req.body;

    if (!session_id) return json(res, { error: 'session_id required' }, 400);

    // Verify session exists
    const { rows: sessions } = await pool.query(
      'SELECT id FROM whiteboard_sessions WHERE id=$1 AND tenant_id=$2',
      [session_id, tid]
    );
    if (!sessions.length) return json(res, { error: 'Session not found' }, 404);

    // Check if submission already exists
    const { rows: existing } = await pool.query(
      'SELECT id FROM whiteboard_submissions WHERE session_id=$1 AND student_id=$2 AND tenant_id=$3',
      [session_id, uid, tid]
    );

    if (existing.length) {
      // Update existing
      await pool.query(
        `UPDATE whiteboard_submissions SET status='submitted', submitted_at=NOW(), updated_at=NOW()
         WHERE id=$1 AND tenant_id=$2`,
        [existing[0].id, tid]
      );
      json(res, { success: true, submission_id: existing[0].id, status: 'submitted' });
    } else {
      const result = await pool.query(
        `INSERT INTO whiteboard_submissions (tenant_id, assignment_id, session_id, student_id, status, submitted_at)
         VALUES ($1, $2, $3, $4, 'submitted', NOW()) RETURNING id`,
        [tid, assignment_id || null, session_id, uid]
      );
      audit(req, 'whiteboard_submission_create', { session_id, assignment_id });
      json(res, { success: true, submission_id: result.rows[0].id, status: 'submitted' }, 201);
    }
  }));

  // 11c. Grade submission page
  app.get(`${PREFIX}/submissions/:id/grade`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const subId = int(req.params.id);

    const { rows: subs } = await pool.query(
      `SELECT wbs.*, u.display_name AS student_name, ws.title AS session_title,
        (SELECT COUNT(*) FROM whiteboard_pages WHERE session_id=wbs.session_id) AS page_count
       FROM whiteboard_submissions wbs
       JOIN users u ON u.id=wbs.student_id
       JOIN whiteboard_sessions ws ON ws.id=wbs.session_id
       WHERE wbs.id=$1 AND wbs.tenant_id=$2`,
      [subId, tid]
    );

    if (!subs.length) return res.status(404).send('Submission not found');

    const sub = subs[0];

    const html = renderPage(`Grade: ${sub.session_title}`, `
      <div class="wb-grade">
        <div class="d-flex justify-content-between align-items-center mb-4">
          <h2><i class="fas fa-star me-2"></i>Grade Submission</h2>
          <a href="${PREFIX}/submissions" class="btn btn-outline-secondary"><i class="fas fa-arrow-left me-1"></i>Back</a>
        </div>

        <div class="card mb-4">
          <div class="card-body">
            <div class="row">
              <div class="col-md-6">
                <h5>${esc(sub.session_title)}</h5>
                <p class="text-muted">Student: <strong>${esc(sub.student_name)}</strong></p>
                <p class="text-muted">Submitted: ${sub.submitted_at ? new Date(sub.submitted_at).toLocaleString() : '—'}</p>
                <p class="text-muted">Pages: ${sub.page_count}</p>
              </div>
              <div class="col-md-6">
                <a href="${PREFIX}/draw/${sub.session_id}?submission=${sub.id}" class="btn btn-primary btn-lg w-100 mb-2" target="_blank">
                  <i class="fas fa-external-link-alt me-2"></i>Open Whiteboard
                </a>
              </div>
            </div>
          </div>
        </div>

        <!-- Grading Form -->
        <form method="POST" action="${PREFIX}/submissions/${subId}/grade" class="card">
          <div class="card-header"><i class="fas fa-edit me-2"></i>Grade & Feedback</div>
          <div class="card-body">
            <div class="row g-3">
              <div class="col-md-3">
                <label class="form-label">Grade *</label>
                <select name="grade" class="form-select" required>
                  <option value="">Select Grade</option>
                  <option value="A+" ${sub.grade === 'A+' ? 'selected' : ''}>A+ (Excellent)</option>
                  <option value="A" ${sub.grade === 'A' ? 'selected' : ''}>A</option>
                  <option value="A-" ${sub.grade === 'A-' ? 'selected' : ''}>A-</option>
                  <option value="B+" ${sub.grade === 'B+' ? 'selected' : ''}>B+</option>
                  <option value="B" ${sub.grade === 'B' ? 'selected' : ''}>B</option>
                  <option value="B-" ${sub.grade === 'B-' ? 'selected' : ''}>B-</option>
                  <option value="C+" ${sub.grade === 'C+' ? 'selected' : ''}>C+</option>
                  <option value="C" ${sub.grade === 'C' ? 'selected' : ''}>C</option>
                  <option value="C-" ${sub.grade === 'C-' ? 'selected' : ''}>C-</option>
                  <option value="D" ${sub.grade === 'D' ? 'selected' : ''}>D</option>
                  <option value="F" ${sub.grade === 'F' ? 'selected' : ''}>F (Fail)</option>
                </select>
              </div>
              <div class="col-md-3">
                <label class="form-label">Score (0-100)</label>
                <input type="number" name="score" class="form-control" value="${sub.score || ''}" min="0" max="100" step="0.01">
              </div>
              <div class="col-md-3">
                <label class="form-label">Status</label>
                <select name="status" class="form-select">
                  <option value="graded" ${sub.status === 'graded' ? 'selected' : ''}>Graded</option>
                  <option value="returned" ${sub.status === 'returned' ? 'selected' : ''}>Returned to Student</option>
                  <option value="submitted" ${sub.status === 'submitted' ? 'selected' : ''}>Resubmit</option>
                </select>
              </div>
              <div class="col-md-3 d-flex align-items-end">
                <button type="submit" class="btn btn-success w-100"><i class="fas fa-check me-1"></i>Save Grade</button>
              </div>
              <div class="col-12">
                <label class="form-label">Feedback for Student</label>
                <textarea name="feedback" class="form-control" rows="4" placeholder="Provide detailed feedback on the whiteboard work...">${esc(sub.feedback || '')}</textarea>
              </div>
            </div>
          </div>
        </form>

        ${sub.feedback ? `
        <!-- Previous Feedback -->
        <div class="card mt-3">
          <div class="card-header">Previous Feedback</div>
          <div class="card-body">
            <p class="mb-2"><strong>Grade:</strong> ${esc(sub.grade)} ${sub.score !== null ? '(' + sub.score + '/100)' : ''}</p>
            <p><strong>Feedback:</strong> ${esc(sub.feedback)}</p>
            ${sub.graded_at ? `<p class="text-muted small">Graded by ${esc(sub.grader_name || 'Teacher')} on ${new Date(sub.graded_at).toLocaleString()}</p>` : ''}
          </div>
        </div>
        ` : ''}
      </div>
    `, req);

    res.send(html);
  }));

  // 11d. Save grade (POST)
  app.post(`${PREFIX}/submissions/:id/grade`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const subId = int(req.params.id);
    const { grade, score, feedback, status } = req.body;

    if (!grade) {
      return res.redirect(`${PREFIX}/submissions/${subId}/grade?error=Grade+required`);
    }

    await pool.query(
      `UPDATE whiteboard_submissions
       SET grade=$1, score=$2, feedback=$3, status=$4, graded_by=$5, graded_at=NOW(), updated_at=NOW()
       WHERE id=$6 AND tenant_id=$7`,
      [grade, score || null, feedback || null, status || 'graded', uid, subId, tid]
    );

    audit(req, 'whiteboard_submission_grade', { submission_id: subId, grade, score });
    res.redirect(`${PREFIX}/submissions?graded=1`);
  }));

  // 11e. Student submit/update their submission
  app.post(`${PREFIX}/submissions/:id/submit`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const subId = int(req.params.id);

    await pool.query(
      `UPDATE whiteboard_submissions SET status='submitted', submitted_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND student_id=$3`,
      [subId, tid, uid]
    );

    audit(req, 'whiteboard_submission_submit', { submission_id: subId });
    json(res, { success: true });
  }));

  // 11f. API: Get submission details
  app.get(`${PREFIX}/api/submissions/:id`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const subId = int(req.params.id);

    const { rows: subs } = await pool.query(
      `SELECT wbs.*, u.display_name AS student_name, ws.title AS session_title
       FROM whiteboard_submissions wbs
       JOIN users u ON u.id=wbs.student_id
       JOIN whiteboard_sessions ws ON ws.id=wbs.session_id
       WHERE wbs.id=$1 AND wbs.tenant_id=$2`,
      [subId, tid]
    );

    if (!subs.length) return json(res, { error: 'Submission not found' }, 404);
    json(res, subs[0]);
  }));

  // 11g. Bulk grade submissions
  app.post(`${PREFIX}/submissions/bulk-grade`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { submissions } = req.body;

    if (!Array.isArray(submissions) || !submissions.length) {
      return json(res, { error: 'submissions array required' }, 400);
    }

    for (const sub of submissions) {
      if (!sub.id || !sub.grade) continue;
      await pool.query(
        `UPDATE whiteboard_submissions
         SET grade=$1, score=$2, feedback=$3, status='graded', graded_by=$4, graded_at=NOW(), updated_at=NOW()
         WHERE id=$5 AND tenant_id=$6`,
        [sub.grade, sub.score || null, sub.feedback || null, uid, sub.id, tid]
      );
    }

    audit(req, 'whiteboard_submission_bulk_grade', { count: submissions.length });
    json(res, { success: true, graded: submissions.length });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  12. PRESENTER MODE & REAL-TIME (Placeholder APIs)
  // ══════════════════════════════════════════════════════════════════════════

  // 12a. Set presenter mode
  app.post(`${PREFIX}/api/presenter-mode`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { session_id, enabled } = req.body;

    if (!session_id) return json(res, { error: 'session_id required' }, 400);

    if (enabled) {
      await pool.query(
        `UPDATE whiteboard_sessions SET mode='live', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
        [session_id, tid]
      );
    } else {
      await pool.query(
        `UPDATE whiteboard_sessions SET mode='static', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`,
        [session_id, tid]
      );
    }

    // Set all collaborators except presenter to viewer in static mode
    if (!enabled) {
      await pool.query(
        `UPDATE whiteboard_collaborators SET permission='viewer'
         WHERE session_id=$1 AND tenant_id=$2 AND permission != 'presenter'`,
        [session_id, tid]
      );
    }

    audit(req, 'whiteboard_presenter_mode', { session_id, enabled });
    json(res, { success: true });
  }));

  // 12b. Update cursor position (placeholder for WebSocket)
  app.post(`${PREFIX}/api/cursor`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { session_id, cursor_x, cursor_y } = req.body;

    if (!session_id) return json(res, { error: 'session_id required' }, 400);

    await pool.query(
      `UPDATE whiteboard_collaborators SET cursor_x=$1, cursor_y=$2, last_active=NOW(), is_online=1
       WHERE session_id=$3 AND user_id=$4 AND tenant_id=$5`,
      [cursor_x || 0, cursor_y || 0, session_id, uid, tid]
    );

    json(res, { success: true });
  }));

  // 12c. Set user online/offline
  app.post(`${PREFIX}/api/presence`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { session_id, online } = req.body;

    if (!session_id) return json(res, { error: 'session_id required' }, 400);

    await pool.query(
      `UPDATE whiteboard_collaborators SET is_online=$1, last_active=NOW()
       WHERE session_id=$2 AND user_id=$3 AND tenant_id=$4`,
      [online ? 1 : 0, session_id, uid, tid]
    );

    json(res, { success: true });
  }));

  // 12d. Get active collaborators (with cursors)
  app.get(`${PREFIX}/api/collaborators/:sessionId`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sessionId = int(req.params.sessionId);

    const { rows: collabs } = await pool.query(
      `SELECT wc.*, u.display_name, u.avatar_url
       FROM whiteboard_collaborators wc
       JOIN users u ON u.id=wc.user_id
       WHERE wc.session_id=$1 AND wc.tenant_id=$2 AND wc.is_online=1
       ORDER BY wc.permission DESC`,
      [sessionId, tid]
    );

    json(res, collabs);
  }));

  // 12e. Lock/unlock content for students
  app.post(`${PREFIX}/api/lock-toggle`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { content_ids, locked } = req.body;

    if (!Array.isArray(content_ids)) return json(res, { error: 'content_ids array required' }, 400);

    for (const cid of content_ids) {
      await pool.query(
        'UPDATE whiteboard_content SET locked=$1 WHERE id=$2 AND tenant_id=$3',
        [locked ? 1 : 0, cid, tid]
      );
    }

    json(res, { success: true });
  }));

  // 12f. Student permissions update
  app.post(`${PREFIX}/api/student-permissions`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { session_id, can_draw, can_edit_text, can_add_content, can_delete } = req.body;

    if (!session_id) return json(res, { error: 'session_id required' }, 400);

    // Store student permissions in session background_config
    const { rows: sessions } = await pool.query(
      'SELECT background_config FROM whiteboard_sessions WHERE id=$1 AND tenant_id=$2',
      [session_id, tid]
    );

    if (sessions.length) {
      let config = {};
      try { config = JSON.parse(sessions[0].background_config || '{}'); } catch (e) {}

      config.studentPermissions = {
        can_draw: can_draw !== false,
        can_edit_text: can_edit_text !== false,
        can_add_content: can_add_content !== false,
        can_delete: can_delete !== false
      };

      await pool.query(
        'UPDATE whiteboard_sessions SET background_config=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
        [JSON.stringify(config), session_id, tid]
      );
    }

    json(res, { success: true });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  13. REPLAY / RECORDING (Placeholder)
  // ══════════════════════════════════════════════════════════════════════════

  // 13a. Start recording session actions
  app.post(`${PREFIX}/api/recording/start`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { session_id } = req.body;

    if (!session_id) return json(res, { error: 'session_id required' }, 400);

    // Save current state as recording start point
    const { rows: pages } = await pool.query(
      'SELECT * FROM whiteboard_pages WHERE session_id=$1 AND tenant_id=$2 ORDER BY page_number',
      [session_id, tid]
    );

    const initialState = pages.map(p => ({
      page_number: p.page_number,
      canvas_data: p.canvas_data
    }));

    await pool.query(
      `INSERT INTO whiteboard_version_history (tenant_id, session_id, version_label, snapshot_data, created_by)
       VALUES ($1, $2, 'Recording Start', $3, $4)`,
      [tid, session_id, JSON.stringify({ recording: true, initial_state: initialState, started_at: new Date().toISOString() }), uid]
    );

    json(res, { success: true, recording: true });
  }));

  // 13b. Stop recording
  app.post(`${PREFIX}/api/recording/stop`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const uid = userId(req);
    const { session_id } = req.body;

    if (!session_id) return json(res, { error: 'session_id required' }, 400);

    // Save final state
    const { rows: pages } = await pool.query(
      'SELECT * FROM whiteboard_pages WHERE session_id=$1 AND tenant_id=$2 ORDER BY page_number',
      [session_id, tid]
    );

    await pool.query(
      `INSERT INTO whiteboard_version_history (tenant_id, session_id, version_label, snapshot_data, created_by)
       VALUES ($1, $2, 'Recording End', $3, $4)`,
      [tid, session_id, JSON.stringify({
        recording: false,
        final_state: pages.map(p => ({ page_number: p.page_number, canvas_data: p.canvas_data })),
        ended_at: new Date().toISOString()
      }), uid]
    );

    json(res, { success: true, recording: false });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  14. UTILITY & STATS ROUTES
  // ══════════════════════════════════════════════════════════════════════════

  // 14a. Session statistics
  app.get(`${PREFIX}/api/stats/:sessionId`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const sid = int(req.params.sessionId);

    const { rows: sessionStats } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM whiteboard_pages WHERE session_id=$1 AND tenant_id=$2) AS total_pages,
         (SELECT COUNT(*) FROM whiteboard_content wc
          JOIN whiteboard_pages wp ON wp.id=wc.page_id
          WHERE wp.session_id=$3 AND wc.tenant_id=$4) AS total_content_blocks,
         (SELECT COUNT(*) FROM whiteboard_collaborators WHERE session_id=$5 AND tenant_id=$6) AS total_collaborators,
         (SELECT COUNT(*) FROM whiteboard_collaborators WHERE session_id=$7 AND tenant_id=$8 AND is_online=1) AS online_collaborators,
         (SELECT COUNT(*) FROM whiteboard_version_history WHERE session_id=$9 AND tenant_id=$10) AS total_versions,
         (SELECT COUNT(*) FROM whiteboard_submissions WHERE session_id=$11 AND tenant_id=$12) AS total_submissions`,
      [sid, tid, sid, tid, sid, tid, sid, tid, sid, tid, sid, tid]
    );

    json(res, sessionStats[0] || {});
  }));

  // 14b. Global whiteboard statistics (admin dashboard)
  app.get(`${PREFIX}/api/global-stats`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const role = userRole(req);

    if (role !== 'admin' && role !== 'teacher') {
      return json(res, { error: 'Unauthorized' }, 403);
    }

    const { rows: globalStats } = await pool.query(
      `SELECT
         COUNT(*) AS total_sessions,
         SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) AS active_sessions,
         SUM(CASE WHEN mode='live' THEN 1 ELSE 0 END) AS live_sessions,
         (SELECT COUNT(*) FROM whiteboard_pages WHERE tenant_id=$1) AS total_pages,
         (SELECT COUNT(*) FROM whiteboard_content WHERE tenant_id=$2) AS total_content_blocks,
         (SELECT COUNT(*) FROM whiteboard_collaborators WHERE tenant_id=$3) AS total_collaborators,
         (SELECT COUNT(*) FROM whiteboard_submissions WHERE tenant_id=$4) AS total_submissions,
         (SELECT COUNT(*) FROM whiteboard_submissions WHERE tenant_id=$5 AND status='submitted') AS pending_grading,
         (SELECT COUNT(*) FROM whiteboard_version_history WHERE tenant_id=$6) AS total_versions,
         (SELECT COUNT(*) FROM whiteboard_templates WHERE tenant_id=$7 OR tenant_id=0) AS total_templates`,
      [tid, tid, tid, tid, tid, tid, tid]
    );

    // Weekly activity
    const { rows: weeklyActivity } = await pool.query(
      `SELECT DATE(created_at) AS date, COUNT(*) AS sessions_created
       FROM whiteboard_sessions
       WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '30 days'
       GROUP BY DATE(created_at)
       ORDER BY date DESC`,
      [tid]
    );

    json(res, { stats: globalStats[0] || {}, weekly_activity: weeklyActivity });
  }));

  // 14c. Search whiteboard content
  app.get(`${PREFIX}/api/search`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const q = (req.query.q || '').trim();
    const limit = Math.min(50, int(req.query.limit, 20));

    if (!q) return json(res, []);

    // Search in session titles, descriptions, and content blocks
    const { rows: results } = await pool.query(
      `SELECT 'session' AS result_type, ws.id, ws.title AS name, ws.description,
         ws.updated_at AS date, NULL AS session_id
       FROM whiteboard_sessions ws
       WHERE ws.tenant_id=$1 AND (ws.title LIKE $2 OR ws.description LIKE $3)
       UNION ALL
       SELECT 'content' AS result_type, wc.id, wc.content_type AS name, NULL,
         wc.updated_at AS date, wp.session_id
       FROM whiteboard_content wc
       JOIN whiteboard_pages wp ON wp.id=wc.page_id
       WHERE wc.tenant_id=$4 AND (wc.content_data LIKE $5 OR wc.content_type LIKE $6)
       ORDER BY date DESC
       LIMIT $7`,
      [tid, `%${q}%`, `%${q}%`, tid, `%${q}%`, `%${q}%`, limit]
    );

    json(res, results);
  }));

  // 14d. Update session thumbnail
  app.post(`${PREFIX}/api/thumbnail`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { session_id, thumbnail } = req.body;

    if (!session_id) return json(res, { error: 'session_id required' }, 400);

    await pool.query(
      'UPDATE whiteboard_sessions SET thumbnail=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3',
      [thumbnail || null, session_id, tid]
    );

    json(res, { success: true });
  }));

  // 14e. Bulk archive sessions
  app.post(`${PREFIX}/api/bulk-archive`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { session_ids } = req.body;

    if (!Array.isArray(session_ids) || !session_ids.length) {
      return json(res, { error: 'session_ids array required' }, 400);
    }

    const idPlaceholders = session_ids.map((_, i) => `$${i + 1}`).join(',');
    await pool.query(
      `UPDATE whiteboard_sessions SET status='archived', updated_at=NOW()
       WHERE id IN (${idPlaceholders}) AND tenant_id=$${session_ids.length + 1}`,
      [...session_ids, tid]
    );

    audit(req, 'whiteboard_bulk_archive', { count: session_ids.length });
    json(res, { success: true, archived: session_ids.length });
  }));

  // 14f. Get page content (for loading into canvas)
  app.get(`${PREFIX}/api/pages/:id/content`, requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const pid = int(req.params.id);

    const { rows: page } = await pool.query(
      'SELECT * FROM whiteboard_pages WHERE id=$1 AND tenant_id=$2',
      [pid, tid]
    );

    if (!page.length) return json(res, { error: 'Page not found' }, 404);

    const { rows: contents } = await pool.query(
      'SELECT * FROM whiteboard_content WHERE page_id=$1 ORDER BY z_index, created_at',
      [pid]
    );

    json(res, {
      page: page[0],
      content_blocks: contents
    });
  }));

  // ══════════════════════════════════════════════════════════════════════════
  //  MODULE INIT COMPLETE — Log
  // ══════════════════════════════════════════════════════════════════════════

  console.log('[whiteboard] Interactive Whiteboard module loaded — prefix:', PREFIX);
  console.log('[whiteboard] Routes registered: dashboard, sessions CRUD, draw, pages,');
  console.log('[whiteboard]   templates, gallery, export/import, version history,');
  console.log('[whiteboard]   lesson integration, submissions, grading, presenter,');
  console.log('[whiteboard]   collaboration, recording, search, stats');
};
