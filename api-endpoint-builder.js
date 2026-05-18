/**
 * School SaaS Portal — API Endpoint Builder
 * Visual SQL-driven custom API endpoint creation, testing, logging, and documentation.
 *
 * Tables: custom_api_endpoints, api_call_logs
 */
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || req.session?.user?.school_id || 1;

  /* ── SQL Query Templates ─────────────────────────────────────── */
  const SQL_TEMPLATES = [
    { name: 'Student List', category: 'Students', sql: 'SELECT id, name, email, grade, class_name FROM students WHERE school_id = :school_id ORDER BY name', desc: 'Retrieve all students in the school' },
    { name: 'Attendance Summary', category: 'Attendance', sql: 'SELECT s.name, COUNT(a.id) as present_days FROM students s LEFT JOIN attendance a ON a.student_id = s.id AND a.status = \'present\' AND a.date >= CURRENT_DATE - INTERVAL \'30 days\' WHERE s.school_id = :school_id GROUP BY s.id ORDER BY present_days DESC LIMIT 50', desc: 'Attendance stats for the last 30 days' },
    { name: 'Fee Balances', category: 'Finance', sql: 'SELECT s.name, s.class_name, COALESCE(SUM(f.amount_due) - SUM(f.amount_paid), 0) as balance FROM students s LEFT JOIN fee_records f ON f.student_id = s.id WHERE s.school_id = :school_id GROUP BY s.id HAVING COALESCE(SUM(f.amount_due) - SUM(f.amount_paid), 0) > 0 ORDER BY balance DESC', desc: 'Students with outstanding fee balances' },
    { name: 'Grade Distribution', category: 'Academics', sql: 'SELECT subject, COUNT(*) FILTER (WHERE grade >= 80) as A, COUNT(*) FILTER (WHERE grade >= 60 AND grade < 80) as B, COUNT(*) FILTER (WHERE grade >= 40 AND grade < 60) as C, COUNT(*) FILTER (WHERE grade < 40) as F FROM exam_results WHERE school_id = :school_id GROUP BY subject', desc: 'Grade distribution by subject' },
    { name: 'Teacher Schedule', category: 'Staff', sql: 'SELECT t.name, c.subject, c.day_of_week, c.start_time, c.end_time FROM teachers t JOIN class_schedule c ON c.teacher_id = t.id WHERE t.school_id = :school_id ORDER BY t.name, c.day_of_week, c.start_time', desc: 'Weekly teacher class schedule' },
    { name: 'Library Inventory', category: 'Library', sql: 'SELECT title, author, isbn, total_copies, available_copies, location FROM library_books WHERE school_id = :school_id ORDER BY title', desc: 'All books in the school library' },
    { name: 'Top Performers', category: 'Academics', sql: 'SELECT s.name, s.class_name, AVG(er.grade) as avg_grade FROM students s JOIN exam_results er ON er.student_id = s.id WHERE s.school_id = :school_id GROUP BY s.id ORDER BY avg_grade DESC LIMIT 20', desc: 'Top 20 students by average grade' },
    { name: 'Recent Announcements', category: 'Communication', sql: 'SELECT title, body, priority, created_at, created_by FROM announcements WHERE school_id = :school_id AND is_active = true ORDER BY created_at DESC LIMIT 10', desc: 'Latest 10 active announcements' },
    { name: 'Bus Routes', category: 'Transport', sql: 'SELECT r.route_name, d.driver_name, d.phone, COUNT(rs.student_id) as students FROM bus_routes r LEFT JOIN bus_drivers d ON d.route_id = r.id LEFT JOIN route_students rs ON rs.route_id = r.id WHERE r.school_id = :school_id GROUP BY r.id ORDER BY r.route_name', desc: 'Transport routes and student counts' },
    { name: 'Parent Contacts', category: 'Communication', sql: 'SELECT s.name as student_name, s.class_name, p.father_name, p.mother_name, p.phone, p.email FROM students s JOIN parent_info p ON p.student_id = s.id WHERE s.school_id = :school_id ORDER BY s.class_name, s.name', desc: 'Parent/guardian contact information' },
    { name: 'Exam Results by Term', category: 'Academics', sql: 'SELECT er.student_id, s.name, er.subject, er.grade, er.term FROM exam_results er JOIN students s ON s.id = er.student_id WHERE er.school_id = :school_id AND er.term = :term ORDER BY s.name, er.subject', desc: 'Results for a specific term (param: term)', desc: 'Exam results filtered by term' },
    { name: 'Daily Revenue', category: 'Finance', sql: 'SELECT DATE(created_at) as date, SUM(amount) as total, COUNT(*) as transactions FROM payments WHERE school_id = :school_id AND created_at >= CURRENT_DATE - INTERVAL \'30 days\' GROUP BY DATE(created_at) ORDER BY date DESC', desc: 'Revenue breakdown for last 30 days' },
    { name: 'Class Enrollment', category: 'Students', sql: 'SELECT class_name, COUNT(*) as enrolled, gender_count.male as boys, gender_count.female as girls FROM students s, LATERAL (SELECT COUNT(*) FILTER (WHERE gender = \'M\') as male, COUNT(*) FILTER (WHERE gender = \'F\') as female FROM students WHERE class_name = s.class_name AND school_id = s.school_id) gender_count WHERE s.school_id = :school_id GROUP BY s.class_name, gender_count ORDER BY s.class_name', desc: 'Enrollment count by class and gender' },
    { name: 'Staff Attendance', category: 'Staff', sql: 'SELECT t.name, t.department, COUNT(sa.id) FILTER (WHERE sa.status = \'present\') as present, COUNT(sa.id) FILTER (WHERE sa.status = \'absent\') as absent FROM teachers t LEFT JOIN staff_attendance sa ON sa.teacher_id = t.id AND sa.date >= CURRENT_DATE - INTERVAL \'30 days\' WHERE t.school_id = :school_id GROUP BY t.id ORDER BY t.name', desc: 'Staff attendance for the last 30 days' }
  ];

  /* ── Available tables for SQL builder ────────────────────────── */
  const KNOWN_TABLES = [
    { name: 'students', columns: ['id','name','email','grade','class_name','gender','school_id','created_at'] },
    { name: 'teachers', columns: ['id','name','email','department','phone','school_id'] },
    { name: 'attendance', columns: ['id','student_id','date','status','school_id'] },
    { name: 'exam_results', columns: ['id','student_id','subject','grade','term','school_id'] },
    { name: 'fee_records', columns: ['id','student_id','amount_due','amount_paid','due_date','school_id'] },
    { name: 'announcements', columns: ['id','title','body','priority','is_active','school_id','created_at'] },
    { name: 'library_books', columns: ['id','title','author','isbn','total_copies','available_copies','school_id'] },
    { name: 'payments', columns: ['id','student_id','amount','method','school_id','created_at'] },
    { name: 'bus_routes', columns: ['id','route_name','school_id'] },
    { name: 'parent_info', columns: ['id','student_id','father_name','mother_name','phone','email'] },
    { name: 'class_schedule', columns: ['id','teacher_id','subject','day_of_week','start_time','end_time'] }
  ];

  /* ── Database migrations ────────────────────────────────────── */
  async function migrate() {
    await pool.query(`CREATE TABLE IF NOT EXISTS custom_api_endpoints (
      id SERIAL PRIMARY KEY, name TEXT NOT NULL, path TEXT UNIQUE NOT NULL,
      method TEXT DEFAULT 'GET', description TEXT, sql_query TEXT,
      request_params JSONB DEFAULT '[]'::jsonb, response_format TEXT DEFAULT 'json',
      rate_limit INT DEFAULT 100, rate_window INT DEFAULT 60,
      auth_required BOOLEAN DEFAULT true, allowed_roles TEXT[] DEFAULT '{}',
      cache_ttl INT DEFAULT 0, is_active BOOLEAN DEFAULT true,
      version TEXT DEFAULT 'v1', hits_count INT DEFAULT 0,
      avg_response_time FLOAT, last_hit_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(), school_id INT DEFAULT 1
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS api_call_logs (
      id SERIAL PRIMARY KEY, endpoint_id INT REFERENCES custom_api_endpoints(id),
      requester_ip TEXT, requester_user INT, status_code INT,
      response_time_ms INT, request_body JSONB, created_at TIMESTAMPTZ DEFAULT NOW()
    )`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_endpoints_school ON custom_api_endpoints(school_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_endpoints_active ON custom_api_endpoints(is_active)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_logs_endpoint ON api_call_logs(endpoint_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_call_logs_created ON api_call_logs(created_at)`);
  }
  migrate().catch(e => console.error('API Endpoint Builder migration error:', e));

  /* ── Execute endpoint SQL safely ─────────────────────────────── */
  async function executeEndpointSQL(sql, params, schoolId) {
    // Only allow SELECT statements
    const trimmed = (sql||'').trim();
    if (!trimmed.toUpperCase().startsWith('SELECT')) {
      throw new Error('Only SELECT queries are allowed');
    }
    // Replace :school_id placeholder
    let preparedSql = trimmed.replace(/:school_id/g, '$1');
    const queryArgs = [schoolId];
    // Handle additional named params
    if (params && Array.isArray(params)) {
      params.forEach(p => {
        if (p.value !== undefined) {
          queryArgs.push(p.value);
        }
      });
    }
    // Replace additional :param placeholders
    let idx = 2;
    preparedSql = preparedSql.replace(/:(\w+)/g, (match, name) => {
      if (name === 'school_id') return '$1';
      const paramIndex = params?.findIndex(p => p.name === name);
      if (paramIndex >= 0) return `$${paramIndex + 2}`;
      return match;
    });
    const start = Date.now();
    const result = await pool.query(preparedSql, queryArgs);
    const elapsed = Date.now() - start;
    return { rows: result.rows, rowCount: result.rowCount, elapsed };
  }

  /* ── UI Stylesheet ──────────────────────────────────────────── */
  const CSS = `
    <link rel="stylesheet" href="/css/sk.css">
    <style>
    :root{--blue:#3b82f6;--blue-dark:#2563eb;--blue-light:#60a5fa;--bg:#0f172a;--bg2:#1e293b;--bg3:#334155;--text:#e2e8f0;--text2:#94a3b8;--border:#475569;--success:#22c55e;--danger:#ef4444;--warn:#f59e0b;--purple:#a855f7}
    .ab-wrap{max-width:1200px;margin:0 auto;padding:0 16px;color:var(--text);font-family:'Inter',system-ui,sans-serif}
    .ab-card{background:var(--bg2);border:1px solid var(--border);border-radius:12px;padding:20px;margin-bottom:16px}
    .ab-grid{display:grid;gap:16px}
    .ab-grid-2{grid-template-columns:1fr 1fr}
    .ab-grid-3{grid-template-columns:repeat(3,1fr)}
    .ab-grid-4{grid-template-columns:repeat(4,1fr)}
    .ab-stat{text-align:center;padding:16px 12px}
    .ab-stat-val{font-size:32px;font-weight:700;color:var(--blue);line-height:1.2}
    .ab-stat-label{font-size:12px;color:var(--text2);margin-top:4px}
    .ab-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .ab-badge-green{background:rgba(34,197,94,.15);color:var(--success)}
    .ab-badge-red{background:rgba(239,68,68,.15);color:var(--danger)}
    .ab-badge-blue{background:rgba(59,130,246,.15);color:var(--blue-light)}
    .ab-badge-gray{background:rgba(148,163,184,.15);color:var(--text2)}
    .ab-badge-purple{background:rgba(168,85,247,.15);color:var(--purple)}
    .ab-table{width:100%;border-collapse:collapse;font-size:13px}
    .ab-table th{text-align:left;padding:10px 12px;background:var(--bg3);color:var(--text2);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px;border-bottom:1px solid var(--border)}
    .ab-table td{padding:10px 12px;border-bottom:1px solid rgba(71,85,105,.4)}
    .ab-table tr:hover td{background:rgba(59,130,246,.05)}
    .ab-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;border:none;transition:all .2s;text-decoration:none;color:var(--text)}
    .ab-btn-primary{background:var(--blue);color:#fff}.ab-btn-primary:hover{background:var(--blue-dark);transform:translateY(-1px)}
    .ab-btn-danger{background:rgba(239,68,68,.15);color:var(--danger);border:1px solid rgba(239,68,68,.3)}.ab-btn-danger:hover{background:rgba(239,68,68,.25)}
    .ab-btn-ghost{background:rgba(59,130,246,.1);color:var(--blue-light);border:1px solid rgba(59,130,246,.3)}.ab-btn-ghost:hover{background:rgba(59,130,246,.2)}
    .ab-btn-sm{padding:5px 10px;font-size:12px}
    .ab-btn-success{background:rgba(34,197,94,.15);color:var(--success);border:1px solid rgba(34,197,94,.3)}
    .ab-input,.ab-select,.ab-textarea{padding:9px 12px;background:var(--bg);border:1px solid var(--border);border-radius:8px;font-size:14px;width:100%;outline:none;transition:.2s;color:var(--text);box-sizing:border-box;font-family:inherit}
    .ab-input:focus,.ab-select:focus,.ab-textarea:focus{border-color:var(--blue);box-shadow:0 0 0 3px rgba(59,130,246,.15)}
    .ab-textarea{min-height:120px;font-family:'Fira Code',monospace;font-size:13px;resize:vertical;line-height:1.6}
    .ab-label{display:block;font-weight:600;margin-bottom:6px;font-size:13px;color:var(--text2)}
    .ab-form-group{margin-bottom:16px}
    .ab-chip{display:inline-block;padding:3px 8px;background:rgba(59,130,246,.12);color:var(--blue-light);border-radius:6px;font-size:11px;margin:2px;font-weight:500}
    .ab-code{font-family:'Fira Code',monospace;font-size:12px;background:var(--bg);padding:2px 6px;border-radius:4px;color:var(--blue-light)}
    .ab-bar{height:6px;background:var(--bg);border-radius:3px;overflow:hidden;margin-top:4px}
    .ab-bar-fill{height:100%;background:var(--blue);border-radius:3px;transition:.3s}
    .ab-method{font-weight:700;font-size:11px;padding:2px 8px;border-radius:4px;display:inline-block;text-transform:uppercase}
    .ab-method-get{background:rgba(59,130,246,.15);color:var(--blue-light)}
    .ab-method-post{background:rgba(34,197,94,.15);color:var(--success)}
    .ab-method-put{background:rgba(245,158,11,.15);color:var(--warn)}
    .ab-method-delete{background:rgba(239,68,68,.15);color:var(--danger)}
    .ab-toggle{position:relative;width:40px;height:22px;cursor:pointer;display:inline-block;vertical-align:middle}
    .ab-toggle input{opacity:0;width:0;height:0}
    .ab-toggle .slider{position:absolute;inset:0;background:var(--bg3);border-radius:22px;transition:.3s}
    .ab-toggle .slider::before{content:'';position:absolute;width:16px;height:16px;left:3px;top:3px;background:var(--text2);border-radius:50%;transition:.3s}
    .ab-toggle input:checked+.slider{background:var(--blue)}
    .ab-toggle input:checked+.slider::before{transform:translateX(18px);background:#fff}
    .ab-scroll{max-height:400px;overflow-y:auto;scrollbar-width:thin}
    .ab-scroll::-webkit-scrollbar{width:6px}.ab-scroll::-webkit-scrollbar-thumb{background:var(--border);border-radius:3px}
    .ab-empty{text-align:center;padding:40px;color:var(--text2)}
    .ab-empty-icon{font-size:48px;margin-bottom:12px;opacity:.5}
    .ab-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px}
    .ab-header h2{margin:0;font-size:22px;display:flex;align-items:center;gap:10px}
    .ab-header h2 svg{color:var(--blue)}
    .ab-filter{display:flex;gap:8px;margin-bottom:16px;align-items:center;flex-wrap:wrap}
    .ab-filter .ab-select{width:auto;min-width:140px;padding:6px 10px;font-size:12px}
    .ab-tab-bar{display:flex;gap:4px;margin-bottom:20px;background:var(--bg);padding:4px;border-radius:10px;border:1px solid var(--border)}
    .ab-tab{padding:8px 16px;cursor:pointer;font-weight:500;font-size:13px;color:var(--text2);border-radius:8px;transition:.2s;text-decoration:none;display:flex;align-items:center;gap:6px}
    .ab-tab:hover{color:var(--text);background:rgba(255,255,255,.03)}
    .ab-tab.active{background:var(--blue);color:#fff}
    .ab-modal-bg{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:1000;display:flex;align-items:center;justify-content:center;backdrop-filter:blur(4px)}
    .ab-modal{background:var(--bg2);border:1px solid var(--border);border-radius:16px;padding:24px;max-width:680px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.3)}
    .ab-modal h3{margin:0 0 16px;font-size:18px;color:var(--text)}
    .ab-modal-actions{display:flex;gap:8px;justify-content:flex-end;margin-top:20px}
    .ab-notify{position:fixed;top:16px;right:16px;z-index:2000;padding:12px 20px;border-radius:10px;color:#fff;font-size:14px;font-weight:500;opacity:0;transition:opacity .3s;pointer-events:none;box-shadow:0 8px 24px rgba(0,0,0,.3)}
    .ab-notify.show{opacity:1}.ab-notify.success{background:var(--success)}.ab-notify.error{background:var(--danger)}
    .ab-json-block{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:'Fira Code',monospace;font-size:12px;line-height:1.5;overflow-x:auto;white-space:pre-wrap;color:var(--text2);max-height:400px;overflow-y:auto}
    .ab-divider{border:none;border-top:1px solid var(--border);margin:16px 0}
    .ab-param-row{display:flex;gap:8px;align-items:end;margin-bottom:8px}
    .ab-param-row .ab-form-group{margin-bottom:0;flex:1}
    .ab-sql-preview{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:12px;font-family:'Fira Code',monospace;font-size:13px;color:var(--blue-light);line-height:1.6;margin-top:8px;white-space:pre-wrap}
    .ab-tpl-card{background:var(--bg);border:1px solid var(--border);border-radius:10px;padding:14px;cursor:pointer;transition:.2s}
    .ab-tpl-card:hover{border-color:var(--blue);background:rgba(59,130,246,.05);transform:translateY(-1px)}
    .ab-tpl-card h4{margin:0 0 6px;font-size:14px;color:var(--text)}
    .ab-tpl-card p{margin:0;font-size:12px;color:var(--text2)}
    .ab-doc-section{margin-bottom:24px}
    .ab-doc-section h3{font-size:16px;color:var(--blue-light);margin:0 0 10px;padding-bottom:6px;border-bottom:1px solid var(--border)}
    .ab-endpoint-doc{background:var(--bg);border-radius:8px;padding:14px;margin-bottom:12px;border-left:3px solid var(--blue)}
    </style>`;

  function pageWrap(activeTab, content, user) {
    const tabs = [
      { id:'dash', label:'Endpoints', href:'/admin/api-builder', icon:'&#128268;' },
      { id:'create', label:'Create New', href:'/admin/api-builder/create', icon:'&#10010;' },
      { id:'templates', label:'Templates', href:'/admin/api-builder/templates', icon:'&#128196;' },
      { id:'docs', label:'API Docs', href:'/admin/api-builder/docs', icon:'&#128214;' },
      { id:'import', label:'Import', href:'/admin/api-builder/import', icon:'&#128229;' }
    ];
    const tabHtml = tabs.map(t => `<a class="ab-tab ${activeTab===t.id?'active':''}" href="${t.href}">${t.icon} ${t.label}</a>`).join('');
    return `${CSS}<div class="ab-wrap">
      <div class="ab-header"><h2><svg width="24" height="24" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path d="M4 7h16M4 12h16M4 17h10"/><circle cx="20" cy="17" r="2"/></svg> API Endpoint Builder</h2>
      <div style="display:flex;gap:8px"><a class="ab-btn ab-btn-primary" href="/admin/api-builder/create">&#10010; New Endpoint</a></div></div>
      <div class="ab-tab-bar">${tabHtml}</div>
      ${content}
    </div>
    <div id="ab-notify" class="ab-notify"></div>
    <script>
    function abNotify(msg,type){var n=document.getElementById('ab-notify');n.textContent=msg;n.className='ab-notify '+type+' show';setTimeout(function(){n.className='ab-notify'},3000)}
    function abCopy(text){navigator.clipboard.writeText(text).then(function(){abNotify('Copied!','success')})}
    function abModal(title,bodyHtml){var area=document.getElementById('ab-modal-area');if(!area){area=document.createElement('div');area.id='ab-modal-area';document.body.appendChild(area)}area.innerHTML='<div class=ab-modal-bg onclick=abCloseModal()><div class=ab-modal onclick=event.stopPropagation()><h3>'+title+'</h3>'+bodyHtml+'<div class=ab-modal-actions><button class=ab-btn ab-btn-ghost onclick=abCloseModal()>Close</button></div></div></div>'}
    function abCloseModal(){var a=document.getElementById('ab-modal-area');if(a)a.innerHTML=''}
    </script>`;
  }

  /* ══════════════════════════════════════════════════════════════
     ROUTE 1 — Dashboard listing all custom endpoints
     ══════════════════════════════════════════════════════════════ */
  app.get('/admin/api-builder', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const [endpoints] = await pool.query('SELECT id, name, path, method, description, response_format, rate_limit, auth_required, is_active, version, hits_count, avg_response_time, last_hit_at, cache_ttl, allowed_roles, created_at FROM custom_api_endpoints WHERE school_id=$1 ORDER BY created_at DESC', [sid]);
    const [stats] = await pool.query('SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE is_active) as active, COALESCE(SUM(hits_count),0) as total_hits, COALESCE(AVG(avg_response_time),0) as avg_resp FROM custom_api_endpoints WHERE school_id=$1', [sid]);
    const [logs7d] = await pool.query('SELECT COUNT(*) as total, COALESCE(AVG(response_time_ms),0) as avg_ms, COUNT(*) FILTER (WHERE status_code >= 400) as errors FROM api_call_logs l JOIN custom_api_endpoints e ON e.id=l.endpoint_id WHERE e.school_id=$1 AND l.created_at > NOW() - INTERVAL \'7 days\'', [sid]);
    const s = stats.rows[0];
    const l = logs7d.rows[0];
    const rowsHtml = endpoints.rows.length === 0
      ? '<tr><td colspan="8"><div class="ab-empty"><div class="ab-empty-icon">&#128268;</div>No custom endpoints yet.<br>Create your first API endpoint to get started.</div></td></tr>'
      : endpoints.rows.map(ep => {
        const statusBadge = ep.is_active
          ? '<span class="ab-badge ab-badge-green">Active</span>'
          : '<span class="ab-badge ab-badge-red">Inactive</span>';
        const methodClass = `ab-method-${(ep.method||'GET').toLowerCase()}`;
        const roles = (ep.allowed_roles||[]).length > 0
          ? (ep.allowed_roles||[]).map(r => `<span class="ab-chip">${esc(r)}</span>`).join('')
          : '<span style="color:var(--text2);font-size:11px">All roles</span>';
        return `<tr>
          <td><strong style="color:var(--text)">${esc(ep.name)}</strong><br><span class="ab-code">${esc(ep.path)}</span></td>
          <td><span class="ab-method ${methodClass}">${esc(ep.method||'GET')}</span> ${ep.version ? `<span class="ab-badge ab-badge-purple">${esc(ep.version)}</span>` : ''}</td>
          <td>${statusBadge}</td>
          <td style="color:var(--text2)">${parseInt(ep.hits_count||0).toLocaleString()}</td>
          <td style="color:var(--text2)">${ep.avg_response_time ? Math.round(ep.avg_response_time)+'ms' : '-'}</td>
          <td>${roles}</td>
          <td style="color:var(--text2);font-size:11px">${ep.last_hit_at ? new Date(ep.last_hit_at).toLocaleDateString() : 'Never'}</td>
          <td><nobr>
            <a class="ab-btn ab-btn-sm ab-btn-ghost" href="/admin/api-builder/${ep.id}/logs" title="Logs">&#128220;</a>
            <a class="ab-btn ab-btn-sm ab-btn-success" href="/admin/api-builder/${ep.id}/stats" title="Stats">&#128200;</a>
            <button class="ab-btn ab-btn-sm ab-btn-ghost" onclick="testEndpoint(${ep.id})" title="Test">&#9889;</button>
            <button class="ab-btn ab-btn-sm ab-btn-ghost" onclick="editEndpoint(${ep.id})" title="Edit">&#9998;</button>
            <button class="ab-btn ab-btn-sm ab-btn-danger" onclick="deleteEndpoint(${ep.id})" title="Delete">&#128465;</button>
          </nobr></td>
        </tr>`;
      }).join('');
    const body = `
    <div class="ab-grid ab-grid-4">
      <div class="ab-card ab-stat"><div class="ab-stat-val">${s.total}</div><div class="ab-stat-label">Total Endpoints <span style="color:var(--success)">(${s.active} active)</span></div></div>
      <div class="ab-card ab-stat"><div class="ab-stat-val">${parseInt(s.total_hits||0).toLocaleString()}</div><div class="ab-stat-label">Total API Hits</div></div>
      <div class="ab-card ab-stat"><div class="ab-stat-val">${Math.round(l.avg_ms||0)}ms</div><div class="ab-stat-label">Avg Response (7d)</div></div>
      <div class="ab-card ab-stat"><div class="ab-stat-val">${parseInt(l.errors||0)}</div><div class="ab-stat-label">Errors (7d) ${parseInt(l.errors||0) > 0 ? '<span style="color:var(--danger)">&#9888;</span>' : ''}</div></div>
    </div>
    <div class="ab-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
        <h3 style="margin:0;font-size:16px">Custom API Endpoints</h3>
        <div class="ab-filter">
          <select class="ab-select" onchange="location.href='/admin/api-builder?filter='+this.value">
            <option value="all">All Status</option>
            <option value="active" ${req.query.filter==='active'?'selected':''}>Active Only</option>
            <option value="inactive" ${req.query.filter==='inactive'?'selected':''}>Inactive</option>
          </select>
        </div>
      </div>
      <div class="ab-scroll"><table class="ab-table"><thead><tr>
        <th>Endpoint</th><th>Method</th><th>Status</th><th>Hits</th><th>Avg Time</th><th>Roles</th><th>Last Hit</th><th>Actions</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table></div>
    </div>
    <div id="ab-modal-area"></div>
    <script>
    function deleteEndpoint(id){if(confirm('Delete this endpoint permanently? All call logs will also be removed.'))fetch('/admin/api-builder/'+id,{method:'DELETE',headers:{'Content-Type':'application/json'}}).then(function(r){return r.json()}).then(function(d){if(d.ok){abNotify('Endpoint deleted','success');setTimeout(function(){location.reload()},600)}else alert(d.error)})}catch(function(e){alert(e)})}
    function editEndpoint(id){location.href='/admin/api-builder/create?edit='+id}
    function testEndpoint(id){abModal('Test Endpoint','<div id=test-result><p>Running test...</p></div>');fetch('/admin/api-builder/'+id+'/test',{method:'POST',headers:{'Content-Type':'application/json'}}).then(function(r){return r.json()}).then(function(d){var el=document.getElementById('test-result');if(d.error){el.innerHTML='<p style="color:var(--danger)">'+d.error+'</p>'}else{var pre=JSON.stringify(d,null,2);el.innerHTML='<div style=display:flex;justify-content:space-between;margin-bottom:8px><span>Status: <span class=ab-badge ab-badge-green>'+d.status_code+'</span></span><span style=color:var(--text2)>'+d.response_time+'ms | '+d.row_count+' rows</span></div><div class=ab-json-block>'+pre.replace(/</g,'&lt;')+'</div><div style=margin-top:8px><button class=ab-btn ab-btn-sm ab-btn-ghost onclick=abCopy(JSON.stringify(d.data,null,2))>Copy JSON</button></div>'}})}
    </script>`;
    res.send(renderPage('API Endpoint Builder', pageWrap('dash', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 2 — JSON endpoints list
     ══════════════════════════════════════════════════════════════ */
  app.get('/admin/api-builder/data', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const { rows } = await pool.query('SELECT id, name, path, method, description, response_format, rate_limit, rate_window, auth_required, allowed_roles, cache_ttl, is_active, version, hits_count, avg_response_time, last_hit_at, created_at FROM custom_api_endpoints WHERE school_id=$1 ORDER BY name', [sid]);
    res.json({ ok: true, endpoints: rows, total: rows.length });
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 3 — Create / Edit endpoint
     ══════════════════════════════════════════════════════════════ */
  app.get('/admin/api-builder/create', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const editId = parseInt(req.query.edit) || 0;
    let ep = { name:'', path:'/api/custom/', method:'GET', description:'', sql_query:'', request_params:[], response_format:'json', rate_limit:100, rate_window:60, auth_required:true, allowed_roles:[], cache_ttl:0, version:'v1' };
    if (editId) {
      const { rows } = await pool.query('SELECT * FROM custom_api_endpoints WHERE id=$1 AND school_id=$2', [editId, sid]);
      if (rows.length) ep = rows[0];
    }
    const tablesOptions = KNOWN_TABLES.map(t => `<option value="${t.name}">${t.name}</option>`).join('');
    const columnsHtml = KNOWN_TABLES.map(t => {
      const cols = t.columns.map(c => `<span class="ab-chip">${c}</span>`).join('');
      return `<div id="cols-${t.name}" style="display:none;padding:8px;background:var(--bg);border-radius:6px;margin-top:6px">${cols}</div>`;
    }).join('');
    const existingParams = (ep.request_params||[]).map((p,i) => `<div class="ab-param-row" id="param-${i}"><div class="ab-form-group"><label class="ab-label">Name</label><input class="ab-input param-name" value="${esc(p.name||'')}"></div><div class="ab-form-group"><label class="ab-label">Type</label><select class="ab-select param-type"><option ${p.type==='string'?'selected':''}>string</option><option ${p.type==='int'?'selected':''}>int</option><option ${p.type==='date'?'selected':''}>date</option></select></div><div class="ab-form-group"><label class="ab-label">Default</label><input class="ab-input param-default" value="${esc(p.default_val||'')}"></div><div class="ab-form-group"><label class="ab-label">Required</label><select class="ab-select param-req"><option value="true" ${p.required?'selected':''}>Yes</option><option value="false" ${!p.required?'selected':''}>No</option></select></div><button class="ab-btn ab-btn-sm ab-btn-danger" onclick="removeParam(${i})" type="button">&#10005;</button></div>`).join('');
    const rolesAvailable = ['admin','teacher','student','parent','staff','accountant'];
    const rolesChecks = rolesAvailable.map(r => `<label style="display:flex;align-items:center;gap:6px;font-size:13px"><input type="checkbox" name="allowed_roles" value="${r}" ${(ep.allowed_roles||[]).includes(r)?'checked':''}> ${r}</label>`).join('');
    const body = `
    <div class="ab-grid ab-grid-2">
      <div class="ab-card">
        <h3 style="margin:0 0 16px;font-size:16px">${editId ? 'Edit Endpoint' : 'Create New Endpoint'}</h3>
        <form id="endpoint-form" method="POST" action="/admin/api-builder${editId ? '/'+editId : '/create'}">
          ${editId ? '<input type="hidden" name="_method" value="PUT">' : ''}
          <div class="ab-form-group"><label class="ab-label">Endpoint Name *</label><input class="ab-input" name="name" value="${esc(ep.name)}" required placeholder="e.g. Student List API"></div>
          <div class="ab-form-group"><label class="ab-label">API Path *</label><input class="ab-input" name="path" value="${esc(ep.path)}" required placeholder="/api/custom/students" pattern="^/api/.+"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div class="ab-form-group"><label class="ab-label">Method</label><select class="ab-select" name="method">
              <option ${ep.method==='GET'?'selected':''}>GET</option><option ${ep.method==='POST'?'selected':''}>POST</option><option ${ep.method==='PUT'?'selected':''}>PUT</option><option ${ep.method==='DELETE'?'selected':''}>DELETE</option></select></div>
            <div class="ab-form-group"><label class="ab-label">Version</label><input class="ab-input" name="version" value="${esc(ep.version||'v1')}" pattern="^v\\d+$"></div>
            <div class="ab-form-group"><label class="ab-label">Response Format</label><select class="ab-select" name="response_format"><option ${ep.response_format==='json'?'selected':''}>json</option><option ${ep.response_format==='csv'?'selected':''}>csv</option><option ${ep.response_format==='xml'?'selected':''}>xml</option></select></div>
          </div>
          <div class="ab-form-group"><label class="ab-label">Description</label><textarea class="ab-input" name="description" rows="2" style="resize:vertical;font-family:inherit">${esc(ep.description||'')}</textarea></div>
          <hr class="ab-divider">
          <h4 style="margin:0 0 12px;font-size:14px;color:var(--blue-light)">&#128187; SQL Query Builder</h4>
          <div class="ab-form-group"><label class="ab-label">SQL Query * <span style="font-weight:400;color:var(--text2)">— Use :school_id and :param_name for variables</span></label>
            <textarea class="ab-textarea" name="sql_query" id="sql-editor" rows="8" placeholder="SELECT id, name, email FROM students WHERE school_id = :school_id">${esc(ep.sql_query||'')}</textarea></div>
          <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
            <select class="ab-select" id="table-select" style="width:auto" onchange="showTableCols()">
              <option value="">Insert table columns...</option>${tablesOptions}</select>
            <button type="button" class="ab-btn ab-btn-sm ab-btn-ghost" onclick="insertTemplate()">&#128196; Load Template</button>
            <button type="button" class="ab-btn ab-btn-sm ab-btn-ghost" onclick="validateSQL()">&#10003; Validate</button>
          </div>
          ${columnsHtml}
          <div id="sql-validate-msg" style="margin-top:8px;font-size:13px"></div>
          <hr class="ab-divider">
          <h4 style="margin:0 0 12px;font-size:14px;color:var(--blue-light)">&#9881; Request Parameters</h4>
          <div id="params-container">${existingParams}</div>
          <button type="button" class="ab-btn ab-btn-sm ab-btn-ghost" onclick="addParam()">+ Add Parameter</button>
          <hr class="ab-divider">
          <h4 style="margin:0 0 12px;font-size:14px;color:var(--blue-light)">&#128274; Access Control</h4>
          <div class="ab-grid ab-grid-2">
            <div class="ab-form-group"><label class="ab-label">Rate Limit (req/window)</label><input class="ab-input" name="rate_limit" type="number" value="${ep.rate_limit||100}" min="1"></div>
            <div class="ab-form-group"><label class="ab-label">Rate Window (seconds)</label><input class="ab-input" name="rate_window" type="number" value="${ep.rate_window||60}" min="1"></div>
          </div>
          <div class="ab-grid ab-grid-2">
            <div class="ab-form-group"><label class="ab-label">Cache TTL (seconds, 0=off)</label><input class="ab-input" name="cache_ttl" type="number" value="${ep.cache_ttl||0}" min="0"></div>
            <div class="ab-form-group"><label class="ab-label">Auth Required</label><select class="ab-select" name="auth_required"><option value="true" ${ep.auth_required?'selected':''}>Yes</option><option value="false" ${!ep.auth_required?'selected':''}>No (Public)</option></select></div>
          </div>
          <div class="ab-form-group"><label class="ab-label">Allowed Roles <span style="font-weight:400;color:var(--text2)">(empty = all)</span></label><div style="display:flex;flex-wrap:wrap;gap:10px">${rolesChecks}</div></div>
          <div style="margin-top:20px;display:flex;gap:8px">
            <button type="submit" class="ab-btn ab-btn-primary">${editId ? 'Update Endpoint' : 'Create Endpoint'}</button>
            ${editId ? '<button type="button" class="ab-btn ab-btn-success" onclick="testFromForm()">Test Query</button>' : ''}
            <a href="/admin/api-builder" class="ab-btn ab-btn-ghost">Cancel</a>
          </div>
        </form>
      </div>
      <div>
        <div class="ab-card">
          <h4 style="margin:0 0 10px;font-size:14px;color:var(--blue-light)">&#128269; SQL Preview</h4>
          <div class="ab-sql-preview" id="sql-preview">${esc(ep.sql_query||'-- Enter a SQL query to see a preview...')}</div>
        </div>
        <div class="ab-card">
          <h4 style="margin:0 0 10px;font-size:14px;color:var(--blue-light)">&#128218; Quick Reference</h4>
          <div style="font-size:12px;color:var(--text2);line-height:1.8">
            <p><strong style="color:var(--text)">Variables:</strong> Use <code class="ab-code">:school_id</code> (auto), <code class="ab-code">:term</code>, <code class="ab-code">:class</code>, etc.</p>
            <p><strong style="color:var(--text)">Security:</strong> Only SELECT statements are allowed. No DDL/DML.</p>
            <p><strong style="color:var(--text)">Pagination:</strong> Add <code class="ab-code">:limit</code> and <code class="ab-code">:offset</code> params for pagination.</p>
            <p><strong style="color:var(--text)">Aggregates:</strong> Use COUNT, AVG, SUM, GROUP BY for summary data.</p>
          </div>
        </div>
        <div class="ab-card">
          <h4 style="margin:0 0 10px;font-size:14px;color:var(--blue-light)">&#127919; Templates</h4>
          <div style="display:flex;flex-direction:column;gap:8px">${SQL_TEMPLATES.slice(0,5).map(t => `<div class="ab-tpl-card" onclick="loadTemplate(\`${t.sql.replace(/`/g,"\\`").replace(/\\/g,"\\\\")}\`)"><h4>${esc(t.name)} <span class="ab-badge ab-badge-blue">${esc(t.category)}</span></h4><p>${esc(t.desc)}</p></div>`).join('')}</div>
          <a href="/admin/api-builder/templates" class="ab-btn ab-btn-sm ab-btn-ghost" style="margin-top:10px">View All Templates &#8594;</a>
        </div>
      </div>
    </div>
    <script>
    var sqlEditor=document.getElementById('sql-editor');
    var sqlPreview=document.getElementById('sql-preview');
    sqlEditor.addEventListener('input',function(){sqlPreview.textContent=this.value||'-- Enter a SQL query to see a preview...'});
    function showTableCols(){var sel=document.getElementById('table-select').value;if(!sel)return;document.querySelectorAll('[id^=cols-]').forEach(function(el){el.style.display='none'});var cols=document.getElementById('cols-'+sel);if(cols)cols.style.display='block'}
    function addParam(){var c=document.getElementById('params-container');var i=c.children.length;var div=document.createElement('div');div.className='ab-param-row';div.id='param-'+i;div.innerHTML='<div class=ab-form-group><label class=ab-label>Name</label><input class=ab-input param-name placeholder="term"></div><div class=ab-form-group><label class=ab-label>Type</label><select class=ab-select param-type><option>string</option><option>int</option><option>date</option></select></div><div class=ab-form-group><label class=ab-label>Default</label><input class=ab-input param-default></div><div class=ab-form-group><label class=ab-label>Required</label><select class=ab-select param-req><option value=true>Yes</option><option value=false>No</option></select></div><button class="ab-btn ab-btn-sm ab-btn-danger" onclick="removeParam('+i+')" type=button>&#10005;</button>';c.appendChild(div)}
    function removeParam(i){var el=document.getElementById('param-'+i);if(el)el.remove()}
    function validateSQL(){var sql=sqlEditor.value.trim();var msg=document.getElementById('sql-validate-msg');if(!sql){msg.innerHTML='<span style=color:var(--danger)>SQL query is required</span>';return}if(!sql.toUpperCase().startsWith('SELECT')){msg.innerHTML='<span style=color:var(--danger)>Only SELECT queries are allowed</span>';return}fetch('/admin/api-builder/validate-sql',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({sql:sql})}).then(function(r){return r.json()}).then(function(d){if(d.ok){msg.innerHTML='<span style=color:var(--success)>&#10003; SQL is valid — Query plan ready</span>'}else{msg.innerHTML='<span style=color:var(--danger)>&#10007; '+d.error+'</span>'}})}
    function loadTemplate(sql){sqlEditor.value=sql;sqlPreview.textContent=sql;document.getElementById('sql-validate-msg').innerHTML='<span style=color:var(--success)>Template loaded!</span>'}
    function insertTemplate(){var sel=document.getElementById('table-select').value;if(sel){var cur=sqlEditor.value;sqlEditor.value=cur+(cur?'\\n':'')+'SELECT * FROM '+sel+' WHERE school_id = :school_id';sqlPreview.textContent=sqlEditor.value}}
    </script>`;
    res.send(renderPage(editId ? 'Edit Endpoint' : 'Create Endpoint', pageWrap('create', body, req.session.user), req.session.user));
  }));

  /* POST /create — save new endpoint */
  app.post('/admin/api-builder/create', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const name = (req.body.name||'').trim();
    let path = (req.body.path||'').trim();
    if (!path.startsWith('/')) path = '/' + path;
    const sql_query = (req.body.sql_query||'').trim();
    if (!name || !path || !sql_query) return res.json({ error: 'Name, path, and SQL query are required' });
    const allowed_roles = Array.isArray(req.body.allowed_roles) ? req.body.allowed_roles : (req.body.allowed_roles ? [req.body.allowed_roles] : []);
    const { rows } = await pool.query(`INSERT INTO custom_api_endpoints (name,path,method,description,sql_query,response_format,rate_limit,rate_window,auth_required,allowed_roles,cache_ttl,version,school_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
      [name, path, req.body.method||'GET', req.body.description||'', sql_query, req.body.response_format||'json',
       parseInt(req.body.rate_limit)||100, parseInt(req.body.rate_window)||60,
       req.body.auth_required==='true', allowed_roles, parseInt(req.body.cache_ttl)||0,
       req.body.version||'v1', sid]);
    audit(req, 'api_endpoint_created', { endpointId: rows[0].id, name, path });
    res.json({ ok: true, id: rows[0].id, message: 'Endpoint created successfully' });
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 4 — Update endpoint (PUT /:id)
     ══════════════════════════════════════════════════════════════ */
  app.put('/admin/api-builder/:id', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req), id = parseInt(req.params.id);
    const { rows: existing } = await pool.query('SELECT id FROM custom_api_endpoints WHERE id=$1 AND school_id=$2', [id, sid]);
    if (!existing.length) return res.json({ error: 'Endpoint not found' });
    const name = (req.body.name||'').trim();
    let path = (req.body.path||'').trim();
    if (!path.startsWith('/')) path = '/' + path;
    const sql_query = (req.body.sql_query||'').trim();
    if (!name || !path || !sql_query) return res.json({ error: 'Name, path, and SQL query are required' });
    const allowed_roles = Array.isArray(req.body.allowed_roles) ? req.body.allowed_roles : (req.body.allowed_roles ? [req.body.allowed_roles] : []);
    await pool.query(`UPDATE custom_api_endpoints SET name=$1,path=$2,method=$3,description=$4,sql_query=$5,response_format=$6,rate_limit=$7,rate_window=$8,auth_required=$9,allowed_roles=$10,cache_ttl=$11,version=$12 WHERE id=$13 AND school_id=$14`,
      [name, path, req.body.method||'GET', req.body.description||'', sql_query, req.body.response_format||'json',
       parseInt(req.body.rate_limit)||100, parseInt(req.body.rate_window)||60,
       req.body.auth_required==='true', allowed_roles, parseInt(req.body.cache_ttl)||0,
       req.body.version||'v1', id, sid]);
    audit(req, 'api_endpoint_updated', { endpointId: id, name });
    res.json({ ok: true, message: 'Endpoint updated successfully' });
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 5 — Delete endpoint
     ══════════════════════════════════════════════════════════════ */
  app.delete('/admin/api-builder/:id', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req), id = parseInt(req.params.id);
    const { rows: existing } = await pool.query('SELECT name FROM custom_api_endpoints WHERE id=$1 AND school_id=$2', [id, sid]);
    if (!existing.length) return res.json({ error: 'Endpoint not found' });
    await pool.query('DELETE FROM api_call_logs WHERE endpoint_id=$1', [id]);
    await pool.query('DELETE FROM custom_api_endpoints WHERE id=$1 AND school_id=$2', [id, sid]);
    audit(req, 'api_endpoint_deleted', { endpointId: id, name: existing[0].name });
    res.json({ ok: true, message: 'Endpoint deleted' });
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 6 — Toggle activate/deactivate
     ══════════════════════════════════════════════════════════════ */
  app.post('/admin/api-builder/:id/toggle', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req), id = parseInt(req.params.id);
    const { rows } = await pool.query('UPDATE custom_api_endpoints SET is_active = NOT is_active WHERE id=$1 AND school_id=$2 RETURNING id, name, is_active', [id, sid]);
    if (!rows.length) return res.json({ error: 'Endpoint not found' });
    audit(req, 'api_endpoint_toggled', { endpointId: id, name: rows[0].name, active: rows[0].is_active });
    res.json({ ok: true, is_active: rows[0].is_active, message: rows[0].is_active ? 'Endpoint activated' : 'Endpoint deactivated' });
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 7 — Test endpoint and show response
     ══════════════════════════════════════════════════════════════ */
  app.post('/admin/api-builder/:id/test', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req), id = parseInt(req.params.id);
    const { rows: eps } = await pool.query('SELECT * FROM custom_api_endpoints WHERE id=$1 AND school_id=$2', [id, sid]);
    if (!eps.length) return res.json({ error: 'Endpoint not found' });
    const ep = eps[0];
    try {
      const params = req.body.params || ep.request_params || [];
      const { rows, rowCount, elapsed } = await executeEndpointSQL(ep.sql_query, params, sid);
      // Update stats
      await pool.query('UPDATE custom_api_endpoints SET hits_count = hits_count + 1, avg_response_time = LEAST($1, 5000), last_hit_at = NOW() WHERE id = $2',
        [elapsed, id]);
      // Log the call
      await pool.query('INSERT INTO api_call_logs (endpoint_id, requester_ip, requester_user, status_code, response_time_ms, request_body) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, req.ip, req.session.user?.id, 200, elapsed, JSON.stringify(req.body)]);
      const responseData = ep.response_format === 'csv' ? convertToCSV(rows) : rows;
      res.json({ ok: true, status_code: 200, data: responseData, row_count: rowCount, response_time: elapsed, format: ep.response_format });
    } catch (err) {
      await pool.query('INSERT INTO api_call_logs (endpoint_id, requester_ip, requester_user, status_code, response_time_ms, request_body) VALUES ($1,$2,$3,$4,$5,$6)',
        [id, req.ip, req.session.user?.id, 500, 0, JSON.stringify({ error: err.message })]);
      res.json({ error: err.message });
    }
  }));

  /* CSV converter helper */
  function convertToCSV(rows) {
    if (!rows.length) return '';
    const headers = Object.keys(rows[0]);
    const lines = [headers.join(',')];
    rows.forEach(r => {
      lines.push(headers.map(h => {
        const v = String(r[h] ?? '');
        return v.includes(',') || v.includes('"') ? '"' + v.replace(/"/g, '""') + '"' : v;
      }).join(','));
    });
    return lines.join('\n');
  }

  /* SQL validation endpoint */
  app.post('/admin/api-builder/validate-sql', requireAuth, ah(async (req, res) => {
    const sql = (req.body.sql||'').trim();
    if (!sql) return res.json({ error: 'SQL query is required' });
    if (!sql.toUpperCase().startsWith('SELECT')) return res.json({ error: 'Only SELECT queries are allowed' });
    try {
      const testSql = sql.replace(/:school_id/g, '1').replace(/:\w+/g, 'NULL');
      await pool.query(`EXPLAIN ${testSql}`);
      res.json({ ok: true });
    } catch (err) {
      res.json({ error: err.message });
    }
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 8 — Call logs for endpoint
     ══════════════════════════════════════════════════════════════ */
  app.get('/admin/api-builder/:id/logs', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req), id = parseInt(req.params.id);
    const { rows: eps } = await pool.query('SELECT id, name, path, method FROM custom_api_endpoints WHERE id=$1 AND school_id=$2', [id, sid]);
    if (!eps.length) return res.status(404).send('Endpoint not found');
    const ep = eps[0];
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;
    const [logs] = await pool.query('SELECT id, requester_ip, requester_user, status_code, response_time_ms, request_body, created_at FROM api_call_logs WHERE endpoint_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [id, limit, offset]);
    const [countRes] = await pool.query('SELECT COUNT(*) as total FROM api_call_logs WHERE endpoint_id=$1', [id]);
    const totalPages = Math.ceil(parseInt(countRes.rows[0].total) / limit);
    const rowsHtml = logs.rows.length === 0
      ? '<tr><td colspan="6"><div class="ab-empty"><div class="ab-empty-icon">&#128220;</div>No call logs recorded yet.</div></td></tr>'
      : logs.rows.map(l => {
        const statusBadge = l.status_code >= 400
          ? `<span class="ab-badge ab-badge-red">${l.status_code}</span>`
          : `<span class="ab-badge ab-badge-green">${l.status_code}</span>`;
        const bodyPreview = l.request_body ? JSON.stringify(l.request_body).substring(0, 60) : '-';
        return `<tr>
          <td style="font-size:11px;color:var(--text2)">${l.created_at ? new Date(l.created_at).toLocaleString() : '-'}</td>
          <td>${esc(l.requester_ip || '-')}</td>
          <td>${l.requester_user || '-'}</td>
          <td>${statusBadge}</td>
          <td style="color:${l.response_time_ms > 1000 ? 'var(--warn)' : 'var(--text2)'}">${l.response_time_ms || 0}ms</td>
          <td style="font-size:11px;color:var(--text2);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(bodyPreview)}">${esc(bodyPreview)}</td>
        </tr>`;
      }).join('');
    const pagination = totalPages > 1 ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:16px">${Array.from({length: Math.min(totalPages,10)}, (_,i) => `<a class="ab-btn ab-btn-sm ${page===i+1?'ab-btn-primary':'ab-btn-ghost'}" href="?page=${i+1}">${i+1}</a>`).join('')}${totalPages > 10 ? '...' : ''}</div>` : '';
    const body = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <a href="/admin/api-builder" class="ab-btn ab-btn-ghost" style="font-size:12px">&#8592; Back</a>
      <h3 style="margin:0;font-size:16px">Call Logs: <span class="ab-code">${esc(ep.name)}</span></h3>
      <span class="ab-method ab-method-${(ep.method||'GET').toLowerCase()}">${esc(ep.method||'GET')}</span>
      <span class="ab-code">${esc(ep.path)}</span>
      <span style="color:var(--text2);font-size:12px">${countRes.rows[0].total} total calls</span>
    </div>
    <div class="ab-card">
      <div class="ab-scroll"><table class="ab-table"><thead><tr>
        <th>Timestamp</th><th>IP</th><th>User</th><th>Status</th><th>Response Time</th><th>Request Body</th>
      </tr></thead><tbody>${rowsHtml}</tbody></table></div>
      ${pagination}
    </div>`;
    res.send(renderPage('Call Logs — ' + ep.name, pageWrap('dash', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 9 — Usage statistics
     ══════════════════════════════════════════════════════════════ */
  app.get('/admin/api-builder/:id/stats', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req), id = parseInt(req.params.id);
    const { rows: eps } = await pool.query('SELECT * FROM custom_api_endpoints WHERE id=$1 AND school_id=$2', [id, sid]);
    if (!eps.length) return res.status(404).send('Endpoint not found');
    const ep = eps[0];
    const [dailyStats] = await pool.query(`SELECT DATE(created_at) as day, COUNT(*) as calls, AVG(response_time_ms) as avg_ms, COUNT(*) FILTER (WHERE status_code >= 400) as errors FROM api_call_logs WHERE endpoint_id=$1 AND created_at > NOW() - INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY day`, [id]);
    const [topIPs] = await pool.query(`SELECT requester_ip, COUNT(*) as calls, AVG(response_time_ms) as avg_ms FROM api_call_logs WHERE endpoint_id=$1 GROUP BY requester_ip ORDER BY calls DESC LIMIT 10`, [id]);
    const [hourlyStats] = await pool.query(`SELECT EXTRACT(HOUR FROM created_at)::int as hour, COUNT(*) as calls FROM api_call_logs WHERE endpoint_id=$1 AND created_at > NOW() - INTERVAL '7 days' GROUP BY hour ORDER BY hour`, [id]);
    const maxCalls = Math.max(...dailyStats.rows.map(d => parseInt(d.calls)), 1);
    const dailyBarsHtml = dailyStats.rows.map(d => {
      const cnt = parseInt(d.calls);
      const pct = Math.round((cnt / maxCalls) * 100);
      const errCnt = parseInt(d.errors || 0);
      return `<div style="display:flex;align-items:center;gap:8px;font-size:12px">
        <span style="min-width:80px;color:var(--text2)">${d.day}</span>
        <div class="ab-bar" style="flex:1"><div class="ab-bar-fill" style="width:${pct}%"></div></div>
        <span style="min-width:40px;text-align:right;color:var(--text)">${cnt}</span>
        <span style="min-width:50px;text-align:right;color:${errCnt > 0 ? 'var(--danger)' : 'var(--text2)'}">${Math.round(d.avg_ms||0)}ms</span>
      </div>`;
    }).join('');
    const maxHourly = Math.max(...hourlyStats.rows.map(h => parseInt(h.calls)), 1);
    const hourlyHtml = hourlyStats.rows.map(h => {
      const cnt = parseInt(h.calls);
      const pct = Math.round((cnt / maxHourly) * 100);
      const label = String(h.hour).padStart(2, '0') + ':00';
      return `<div style="display:flex;align-items:center;gap:6px;font-size:11px">
        <span style="min-width:36px;color:var(--text2)">${label}</span>
        <div style="height:60px;min-width:24px;display:flex;align-items:flex-end"><div style="height:${Math.max(pct, 2)}%;background:var(--blue);border-radius:3px 3px 0 0;min-height:2px;width:100%"></div></div>
        <span style="color:var(--text)">${cnt}</span>
      </div>`;
    }).join('');
    const ipRowsHtml = topIPs.rows.map((r, i) => `<tr>
      <td style="color:var(--text2)">${i + 1}</td>
      <td><code class="ab-code">${esc(r.requester_ip || 'unknown')}</code></td>
      <td style="color:var(--text)">${parseInt(r.calls).toLocaleString()}</td>
      <td style="color:var(--text2)">${Math.round(r.avg_ms || 0)}ms</td>
    </tr>`).join('');
    const body = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:16px">
      <a href="/admin/api-builder" class="ab-btn ab-btn-ghost" style="font-size:12px">&#8592; Back</a>
      <h3 style="margin:0;font-size:16px">Statistics: <span class="ab-code">${esc(ep.name)}</span></h3>
    </div>
    <div class="ab-grid ab-grid-4">
      <div class="ab-card ab-stat"><div class="ab-stat-val">${parseInt(ep.hits_count||0).toLocaleString()}</div><div class="ab-stat-label">Total Hits</div></div>
      <div class="ab-card ab-stat"><div class="ab-stat-val">${ep.avg_response_time ? Math.round(ep.avg_response_time)+'ms' : '-'}</div><div class="ab-stat-label">Avg Response</div></div>
      <div class="ab-card ab-stat"><div class="ab-stat-val">${ep.rate_limit}</div><div class="ab-stat-label">Rate Limit / ${ep.rate_window}s</div></div>
      <div class="ab-card ab-stat"><div class="ab-stat-val">${ep.cache_ttl > 0 ? ep.cache_ttl+'s' : 'Off'}</div><div class="ab-stat-label">Cache TTL</div></div>
    </div>
    <div class="ab-grid ab-grid-2">
      <div class="ab-card">
        <h4 style="margin:0 0 14px;font-size:14px;color:var(--blue-light)">&#128200; Daily Calls (30 days)</h4>
        <div style="margin-bottom:8px;font-size:11px;display:flex;gap:8px;color:var(--text2)"><span style="min-width:80px">Date</span><span style="flex:1">Volume</span><span style="min-width:40px">Calls</span><span style="min-width:50px">Avg Ms</span></div>
        <div class="ab-scroll">${dailyBarsHtml || '<div class="ab-empty">No data in the last 30 days</div>'}</div>
      </div>
      <div class="ab-card">
        <h4 style="margin:0 0 14px;font-size:14px;color:var(--blue-light)">&#128336; Hourly Distribution (7 days)</h4>
        <div style="display:flex;align-items:flex-end;gap:2px;height:80px;padding:0 4px">${hourlyHtml || '<div class="ab-empty">No data</div>'}</div>
      </div>
    </div>
    <div class="ab-card">
      <h4 style="margin:0 0 14px;font-size:14px;color:var(--blue-light)">&#127760; Top Requesters by IP</h4>
      <table class="ab-table"><thead><tr><th>#</th><th>IP Address</th><th>Calls</th><th>Avg Response</th></tr></thead><tbody>${ipRowsHtml || '<tr><td colspan="4" class="ab-empty">No data</td></tr>'}</tbody></table>
    </div>`;
    res.send(renderPage('Stats — ' + ep.name, pageWrap('dash', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 10 — SQL query templates
     ══════════════════════════════════════════════════════════════ */
  app.get('/admin/api-builder/templates', requireAuth, ah(async (req, res) => {
    const categories = [...new Set(SQL_TEMPLATES.map(t => t.category))];
    const categoryFilter = req.query.category || '';
    const filtered = categoryFilter ? SQL_TEMPLATES.filter(t => t.category === categoryFilter) : SQL_TEMPLATES;
    const catTabs = categories.map(c => `<button class="ab-btn ab-btn-sm ${categoryFilter===c?'ab-btn-primary':'ab-btn-ghost'}" onclick="location.href='/admin/api-builder/templates?category=${c}'">${esc(c)}</button>`).join('');
    const templatesHtml = filtered.map(t => `<div class="ab-tpl-card" onclick="useTemplate('${encodeURIComponent(t.sql)}','${encodeURIComponent(t.name)}')">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
        <h4>${esc(t.name)}</h4>
        <span class="ab-badge ab-badge-blue">${esc(t.category)}</span>
      </div>
      <p style="margin-bottom:8px">${esc(t.desc)}</p>
      <div class="ab-sql-preview" style="font-size:11px;max-height:80px;overflow:hidden">${esc(t.sql)}</div>
    </div>`).join('');
    const body = `
    <div style="margin-bottom:16px">
      <h3 style="margin:0 0 12px;font-size:16px">SQL Query Templates</h3>
      <p style="color:var(--text2);font-size:13px;margin:0 0 12px">Click any template to use it as a starting point for a new endpoint.</p>
      <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center">
        <span style="font-size:12px;color:var(--text2);font-weight:600">Filter:</span>
        <button class="ab-btn ab-btn-sm ${!categoryFilter?'ab-btn-primary':'ab-btn-ghost'}" onclick="location.href='/admin/api-builder/templates'">All</button>
        ${catTabs}
      </div>
    </div>
    <div class="ab-grid" style="grid-template-columns:repeat(auto-fill,minmax(340px,1fr))">${templatesHtml}</div>
    <script>
    function useTemplate(sqlEncoded,nameEncoded){var sql=decodeURIComponent(sqlEncoded);var name=decodeURIComponent(nameEncoded);sessionStorage.setItem('ab_tpl_sql',sql);sessionStorage.setItem('ab_tpl_name',name);location.href='/admin/api-builder/create'}
    </script>`;
    res.send(renderPage('SQL Templates', pageWrap('templates', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 11 — Generate API documentation
     ══════════════════════════════════════════════════════════════ */
  app.get('/admin/api-builder/docs', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const { rows: eps } = await pool.query('SELECT * FROM custom_api_endpoints WHERE school_id=$1 AND is_active=true ORDER BY path', [sid]);
    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const endpointDocs = eps.map(ep => {
      const methodClass = `ab-method-${(ep.method||'GET').toLowerCase()}`;
      const roles = (ep.allowed_roles||[]).length > 0 ? (ep.allowed_roles||[]).join(', ') : 'All authenticated users';
      const params = (ep.request_params||[]).map(p => `<tr><td style="color:var(--text)">${esc(p.name)}</td><td><span class="ab-badge ab-badge-purple">${esc(p.type||'string')}</span></td><td style="color:var(--text2)">${p.required ? '<span style="color:var(--danger)">Required</span>' : 'Optional'}</td><td style="color:var(--text2)">${esc(p.default_val||'-')}</td></tr>`).join('');
      return `<div class="ab-endpoint-doc">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
          <span class="ab-method ${methodClass}" style="font-size:12px">${esc(ep.method||'GET')}</span>
          <strong style="color:var(--text);font-size:14px">${esc(ep.path)}</strong>
          <span class="ab-badge ab-badge-gray">${esc(ep.version||'v1')}</span>
          ${!ep.auth_required ? '<span class="ab-badge ab-badge-red">Public</span>' : ''}
        </div>
        <p style="color:var(--text2);font-size:13px;margin:0 0 8px">${esc(ep.description||'No description provided.')}</p>
        <div style="font-size:12px;color:var(--text2);margin-bottom:8px;display:flex;gap:16px;flex-wrap:wrap">
          <span>&#128270; Roles: ${esc(roles)}</span>
          <span>&#9889; Rate: ${ep.rate_limit} req/${ep.rate_window}s</span>
          <span>&#128190; Cache: ${ep.cache_ttl > 0 ? ep.cache_ttl+'s' : 'Disabled'}</span>
          <span>&#128202; Format: ${esc(ep.response_format||'json')}</span>
          <span>&#128268; Hits: ${ep.hits_count||0}</span>
        </div>
        ${params ? `<div style="margin-top:8px"><strong style="font-size:12px;color:var(--text2)">Parameters:</strong><table class="ab-table" style="margin-top:4px"><thead><tr><th>Name</th><th>Type</th><th>Required</th><th>Default</th></tr></thead><tbody>${params}</tbody></table></div>` : ''}
        <div style="margin-top:8px;font-size:11px;color:var(--text2)">
          Example: <code class="ab-code">curl -X ${ep.method} "${baseUrl}${esc(ep.path)}" -H "Authorization: Bearer YOUR_TOKEN"</code>
        </div>
      </div>`;
    }).join('');
    const body = `
    <div class="ab-doc-section">
      <h3>&#128214; API Documentation</h3>
      <p style="color:var(--text2);font-size:13px;margin:0 0 12px">Auto-generated documentation for all active custom endpoints. Base URL: <code class="ab-code">${baseUrl}</code></p>
      <div style="display:flex;gap:8px;margin-bottom:16px">
        <button class="ab-btn ab-btn-sm ab-btn-ghost" onclick="abCopy(JSON.stringify(${JSON.stringify(eps.map(ep => ({name:ep.name,path:ep.path,method:ep.method,description:ep.description,version:ep.version,auth_required:ep.auth_required,rate_limit:ep.rate_limit,response_format:ep.response_format})))},null,2))">&#128203; Copy as JSON</button>
      </div>
    </div>
    <div class="ab-doc-section">
      <h3>&#128268; Authentication</h3>
      <div style="color:var(--text2);font-size:13px;line-height:1.8">
        <p>All endpoints (unless marked Public) require a valid API key or session token.</p>
        <p>Include your API key in the <code class="ab-code">Authorization</code> header: <code class="ab-code">Bearer YOUR_API_KEY</code></p>
        <p>Rate limits are enforced per API key. Exceeding the limit returns HTTP 429.</p>
      </div>
    </div>
    <div class="ab-doc-section">
      <h3>&#128269; Active Endpoints (${eps.length})</h3>
      ${endpointDocs || '<div class="ab-empty"><div class="ab-empty-icon">&#128214;</div>No active endpoints to document.</div>'}
    </div>`;
    res.send(renderPage('API Documentation', pageWrap('docs', body, req.session.user), req.session.user));
  }));

  /* ══════════════════════════════════════════════════════════════
     ROUTE 12 — Import endpoint from JSON
     ══════════════════════════════════════════════════════════════ */
  app.get('/admin/api-builder/import', requireAuth, ah(async (req, res) => {
    const body = `
    <div class="ab-grid ab-grid-2">
      <div class="ab-card">
        <h3 style="margin:0 0 16px;font-size:16px">&#128229; Import Endpoint from JSON</h3>
        <p style="color:var(--text2);font-size:13px;margin:0 0 16px">Paste a JSON definition or upload a .json file to create a new endpoint.</p>
        <form id="import-form" method="POST" action="/admin/api-builder/import" enctype="multipart/form-data">
          <div class="ab-form-group">
            <label class="ab-label">JSON Definition</label>
            <textarea class="ab-textarea" name="json_data" rows="12" placeholder='{
  "name": "My Endpoint",
  "path": "/api/custom/students",
  "method": "GET",
  "description": "List all students",
  "sql_query": "SELECT id, name FROM students WHERE school_id = :school_id",
  "rate_limit": 100,
  "rate_window": 60,
  "auth_required": true,
  "allowed_roles": ["admin", "teacher"]
}'></textarea>
          </div>
          <div class="ab-form-group">
            <label class="ab-label">Or upload a .json file</label>
            <input type="file" name="json_file" accept=".json" class="ab-input" style="padding:8px">
          </div>
          <button type="submit" class="ab-btn ab-btn-primary">&#128229; Import Endpoint</button>
        </form>
      </div>
      <div>
        <div class="ab-card">
          <h4 style="margin:0 0 12px;font-size:14px;color:var(--blue-light)">&#128196; JSON Format Reference</h4>
          <div class="ab-json-block" style="font-size:11px">{
  "name": "Student List",
  "path": "/api/custom/students",
  "method": "GET",
  "description": "Retrieve all students",
  "sql_query": "SELECT * FROM students WHERE school_id = :school_id",
  "request_params": [
    { "name": "class", "type": "string", "default_val": "", "required": false }
  ],
  "response_format": "json",
  "rate_limit": 100,
  "rate_window": 60,
  "auth_required": true,
  "allowed_roles": ["admin", "teacher"],
  "cache_ttl": 300,
  "version": "v1"
}</div>
        </div>
        <div class="ab-card">
          <h4 style="margin:0 0 10px;font-size:14px;color:var(--blue-light)">&#128161; Tips</h4>
          <ul style="color:var(--text2);font-size:13px;line-height:1.8;margin:0;padding-left:18px">
            <li>Required fields: <code class="ab-code">name</code>, <code class="ab-code">path</code>, <code class="ab-code">sql_query</code></li>
            <li><code class="ab-code">method</code> defaults to GET if omitted</li>
            <li><code class="ab-code">response_format</code> supports: json, csv, xml</li>
            <li><code class="ab-code">allowed_roles</code> can be empty for all authenticated users</li>
            <li>Import will fail if the path already exists</li>
          </ul>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Import Endpoint', pageWrap('import', body, req.session.user), req.session.user));
  }));

  app.post('/admin/api-builder/import', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    let jsonData = req.body.json_data;
    if (!jsonData && req.files && req.files.json_file) {
      try { jsonData = req.files.json_file.data.toString('utf8'); } catch(e) { return res.json({ error: 'Failed to read uploaded file' }); }
    }
    if (!jsonData) return res.json({ error: 'No JSON data provided' });
    let config;
    try { config = JSON.parse(jsonData); } catch(e) { return res.json({ error: 'Invalid JSON: ' + e.message }); }
    const name = (config.name||'').trim();
    let path = (config.path||'').trim();
    const sql_query = (config.sql_query||'').trim();
    if (!name || !path || !sql_query) return res.json({ error: 'Required fields: name, path, sql_query' });
    if (!path.startsWith('/')) path = '/' + path;
    const allowed_roles = Array.isArray(config.allowed_roles) ? config.allowed_roles : [];
    try {
      const { rows } = await pool.query(`INSERT INTO custom_api_endpoints (name,path,method,description,sql_query,request_params,response_format,rate_limit,rate_window,auth_required,allowed_roles,cache_ttl,version,school_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [name, path, config.method||'GET', config.description||'', sql_query,
         JSON.stringify(config.request_params||[]), config.response_format||'json',
         parseInt(config.rate_limit)||100, parseInt(config.rate_window)||60,
         config.auth_required !== false, allowed_roles,
         parseInt(config.cache_ttl)||0, config.version||'v1', sid]);
      audit(req, 'api_endpoint_imported', { endpointId: rows[0].id, name, path });
      res.json({ ok: true, id: rows[0].id, message: `Endpoint "${name}" imported successfully` });
    } catch(err) {
      if (err.code === '23505') return res.json({ error: 'An endpoint with this path already exists' });
      return res.json({ error: err.message });
    }
  }));

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API ROUTER — Execute active custom endpoints
     ══════════════════════════════════════════════════════════════ */
  app.all('/api/custom/*', ah(async (req, res) => {
    const fullPath = '/api/custom/' + req.params[0];
    const { rows: eps } = await pool.query('SELECT * FROM custom_api_endpoints WHERE path=$1 AND is_active=true', [fullPath]);
    if (!eps.length) return res.status(404).json({ error: 'Endpoint not found' });
    const ep = eps[0];
    // Method check
    if (ep.method && req.method !== ep.method) {
      return res.status(405).json({ error: `Method ${req.method} not allowed. Use ${ep.method}` });
    }
    const start = Date.now();
    try {
      const params = { ...(req.query || {}), ...(req.body || {}) };
      const paramArray = (ep.request_params||[]).map(p => ({ name: p.name, value: params[p.name] || p.default_val }));
      const { rows, rowCount, elapsed } = await executeEndpointSQL(ep.sql_query, paramArray, ep.school_id);
      // Update hit stats
      await pool.query('UPDATE custom_api_endpoints SET hits_count = hits_count + 1, avg_response_time = LEAST($1, 5000), last_hit_at = NOW() WHERE id = $2', [elapsed, ep.id]);
      // Log the call
      await pool.query('INSERT INTO api_call_logs (endpoint_id, requester_ip, requester_user, status_code, response_time_ms, request_body) VALUES ($1,$2,$3,$4,$5,$6)',
        [ep.id, req.ip, req.session?.user?.id, 200, elapsed, JSON.stringify(params)]);
      if (ep.response_format === 'csv') {
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${ep.name.replace(/\s+/g,'_')}.csv"`);
        return res.send(convertToCSV(rows));
      }
      res.json({ ok: true, data: rows, meta: { count: rowCount, endpoint: ep.name, version: ep.version, response_time: elapsed } });
    } catch(err) {
      const elapsed = Date.now() - start;
      await pool.query('INSERT INTO api_call_logs (endpoint_id, requester_ip, requester_user, status_code, response_time_ms, request_body) VALUES ($1,$2,$3,$4,$5,$6)',
        [ep.id, req.ip, req.session?.user?.id, 500, elapsed, JSON.stringify({ error: err.message })]);
      res.status(500).json({ error: err.message });
    }
  }));

};
