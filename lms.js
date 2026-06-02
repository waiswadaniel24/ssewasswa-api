// ============================================================
// LMS (Learning Management System) MODULE — Multi-Tenant SaaS
// Course catalog, content management, assignments, quizzes,
// grading, progress tracking, and completion certificates.
// ============================================================
// Usage in server.js:
//   const lms = require('./lms');
//   lms(app, db, pool, renderPage, esc);
// ============================================================
// Tables this module creates:
//   lms_enrollments, lms_content, lms_assignments, lms_submissions
// Tables this module also uses (must already exist or be created
// by other modules):
//   courses, quiz_questions, quizzes, quiz_attempts
// Add to VALID_TABLES in server.js:
//   ['lms_enrollments','lms_content','lms_assignments','lms_submissions',
//    'courses','quiz_questions','quizzes','quiz_attempts']
//   .forEach(t => VALID_TABLES.add(t));
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function lms(app, db, pool, renderPage, esc) {

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
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtTime = (t) => t ? String(t).substring(0, 5) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  function statusBadge(s) {
    const m = {
      active: { bg: '#dcfce7', c: '#16a34a', l: 'Active' },
      completed: { bg: '#dbeafe', c: '#1d4ed8', l: 'Completed' },
      dropped: { bg: '#f1f5f9', c: '#64748b', l: 'Dropped' },
      draft: { bg: '#f1f5f9', c: '#64748b', l: 'Draft' },
      published: { bg: '#dcfce7', c: '#16a34a', l: 'Published' },
      archived: { bg: '#fee2e2', c: '#dc2626', l: 'Archived' },
      submitted: { bg: '#dbeafe', c: '#1d4ed8', l: 'Submitted' },
      graded: { bg: '#dcfce7', c: '#16a34a', l: 'Graded' },
      pending: { bg: '#fef3c7', c: '#b45309', l: 'Pending' },
      late: { bg: '#fee2e2', c: '#dc2626', l: 'Late' }
    };
    const v = m[s] || { bg: '#f1f5f9', c: '#64748b', l: s || '—' };
    return '<span class="badge" style="background:' + v.bg + ';color:' + v.c + '">' + v.l + '</span>';
  }

  function progressBar(pct) {
    const color = pct >= 80 ? '#16a34a' : pct >= 50 ? '#f59e0b' : '#dc2626';
    return '<div style="display:flex;align-items:center;gap:8px">' +
      '<div style="flex:1;background:#f1f5f9;border-radius:6px;height:8px;overflow:hidden">' +
        '<div style="height:100%;width:' + pct + '%;background:' + color + ';border-radius:6px;transition:.3s"></div>' +
      '</div>' +
      '<span style="font-size:12px;font-weight:700;color:' + color + ';min-width:36px;text-align:right">' + pct + '%</span>' +
    '</div>';
  }

  // -- shared CSS --------------------------------------------------------
  const LMS_CSS = '<style>\n\
.lms-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}\n\
.lms-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}\n\
.lms-nav a:hover{background:#e2e8f0}.lms-nav a.active{background:#4f46e5;color:#fff}\n\
.lms-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}\n\
.lms-btn:hover{opacity:.9;transform:translateY(-1px)}\n\
.lms-btn-primary{background:#4f46e5;color:#fff}.lms-btn-success{background:#059669;color:#fff}\n\
.lms-btn-danger{background:#fee2e2;color:#dc2626}.lms-btn-secondary{background:#f1f5f9;color:#475569}\n\
.lms-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px}\n\
.lms-course-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;transition:.2s;cursor:pointer}\n\
.lms-course-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-2px)}\n\
.lms-course-card-title{font-size:16px;font-weight:700;color:#1e293b;margin:0 0 6px}\n\
.lms-course-card-meta{display:flex;gap:12px;font-size:12px;color:#64748b;margin-bottom:12px}\n\
.lms-table{width:100%;border-collapse:collapse;font-size:13px}\n\
.lms-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}\n\
.lms-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}\n\
.lms-table tr:hover{background:#f8fafc}\n\
.lms-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}\n\
.lms-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}\n\
.lms-filter input,.lms-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}\n\
.lms-filter input:focus,.lms-filter select:focus{outline:none;border-color:#6366f1}\n\
.lms-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}\n\
.lms-form input,.lms-form select,.lms-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}\n\
.lms-form input:focus,.lms-form select:focus,.lms-form textarea:focus{outline:none;border-color:#6366f1}\n\
.lms-form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}\n\
.lms-form-grid .full{grid-column:1/-1}\n\
.lms-module{background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:10px}\n\
.lms-module-title{font-weight:700;color:#1e293b;font-size:14px;margin:0 0 8px}\n\
.lms-content-item{display:flex;align-items:center;gap:10px;padding:8px 10px;border-radius:8px;margin-bottom:4px;font-size:13px}\n\
.lms-content-item:hover{background:#eef2ff}\n\
.lms-content-icon{width:32px;height:32px;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px;flex-shrink:0}\n\
.lms-sidebar{position:sticky;top:20px;max-height:70vh;overflow-y:auto}\n\
@media(max-width:768px){.lms-cards{grid-template-columns:1fr}.lms-nav{gap:4px}.lms-nav a{padding:6px 12px;font-size:12px}.lms-form-grid{grid-template-columns:1fr}}\n\
</style>';

  // -- navigation helper --------------------------------------------------
  const nav = (active) => '<div class="lms-nav">' +
    '<a href="/lms" class="' + (active === 'dash' ? 'active' : '') + '">📊 Dashboard</a>' +
    '<a href="/lms/courses" class="' + (active === 'courses' ? 'active' : '') + '">📚 Courses</a>' +
    '<a href="/lms/assignments" class="' + (active === 'assignments' ? 'active' : '') + '">📝 Assignments</a>' +
    '<a href="/lms/quizzes" class="' + (active === 'quizzes' ? 'active' : '') + '">❓ Quizzes</a>' +
    '<a href="/lms/grades" class="' + (active === 'grades' ? 'active' : '') + '">📊 Grades</a>' +
    '<a href="/lms/certificates" class="' + (active === 'certificates' ? 'active' : '') + '">🎓 Certificates</a>' +
    '</div>';

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'Lms', `CREATE TABLE IF NOT EXISTS lms_enrollments (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        course_id INTEGER, student_id INTEGER, enrolled_by INTEGER,
        status VARCHAR(20) DEFAULT 'active', progress DECIMAL(5,2) DEFAULT 0,
        completed_at TIMESTAMPTZ,
        enrolled_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Lms', `CREATE TABLE IF NOT EXISTS lms_content (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        course_id INTEGER, module_id INTEGER, title VARCHAR(255),
        content_type VARCHAR(50) DEFAULT 'text', content TEXT,
        file_url TEXT, video_url TEXT, order_seq INTEGER DEFAULT 0,
        duration_minutes INTEGER DEFAULT 0, is_published BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Lms', `CREATE TABLE IF NOT EXISTS lms_assignments (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        course_id INTEGER, title VARCHAR(255), description TEXT,
        due_date TIMESTAMPTZ, max_score DECIMAL(5,2) DEFAULT 100,
        is_published BOOLEAN DEFAULT true, created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Lms', `CREATE TABLE IF NOT EXISTS lms_submissions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        assignment_id INTEGER, student_id INTEGER, content TEXT,
        file_url TEXT, grade DECIMAL(5,2), feedback TEXT,
        status VARCHAR(20) DEFAULT 'submitted',
        submitted_at TIMESTAMPTZ DEFAULT NOW(), graded_at TIMESTAMPTZ
      )`);
      // ALTER TABLE columns
      const leCols = ['course_id INTEGER','student_id INTEGER','enrolled_by INTEGER',
        'status VARCHAR(20) DEFAULT \'active\'','progress DECIMAL(5,2) DEFAULT 0','completed_at TIMESTAMPTZ'];
      for (const col of leCols) { try { await migrateQuery(pool, 'Lms', 'ALTER TABLE lms_enrollments ADD COLUMN IF NOT EXISTS ' + col); } catch(e){} }
      const lcCols = ['course_id INTEGER','module_id INTEGER','title VARCHAR(255)',
        'content_type VARCHAR(50) DEFAULT \'text\'','content TEXT','file_url TEXT','video_url TEXT',
        'order_seq INTEGER DEFAULT 0','duration_minutes INTEGER DEFAULT 0','is_published BOOLEAN DEFAULT true'];
      for (const col of lcCols) { try { await migrateQuery(pool, 'Lms', 'ALTER TABLE lms_content ADD COLUMN IF NOT EXISTS ' + col); } catch(e){} }
      const laCols = ['course_id INTEGER','title VARCHAR(255)','description TEXT',
        'due_date TIMESTAMPTZ','max_score DECIMAL(5,2) DEFAULT 100',
        'is_published BOOLEAN DEFAULT true','created_by INTEGER'];
      for (const col of laCols) { try { await migrateQuery(pool, 'Lms', 'ALTER TABLE lms_assignments ADD COLUMN IF NOT EXISTS ' + col); } catch(e){} }
      const lsCols = ['assignment_id INTEGER','student_id INTEGER','content TEXT',
        'file_url TEXT','grade DECIMAL(5,2)','feedback TEXT',
        'status VARCHAR(20) DEFAULT \'submitted\'','graded_at TIMESTAMPTZ'];
      for (const col of lsCols) { try { await migrateQuery(pool, 'Lms', 'ALTER TABLE lms_submissions ADD COLUMN IF NOT EXISTS ' + col); } catch(e){} }
      // Indexes
      await migrateQuery(pool, 'Lms', 'CREATE INDEX IF NOT EXISTS idx_le_tenant ON lms_enrollments(tenant_id)');
      await migrateQuery(pool, 'Lms', 'CREATE INDEX IF NOT EXISTS idx_le_course ON lms_enrollments(tenant_id, course_id)');
      await migrateQuery(pool, 'Lms', 'CREATE INDEX IF NOT EXISTS idx_le_student ON lms_enrollments(tenant_id, student_id)');
      await migrateQuery(pool, 'Lms', 'CREATE INDEX IF NOT EXISTS idx_lc_tenant ON lms_content(tenant_id)');
      await migrateQuery(pool, 'Lms', 'CREATE INDEX IF NOT EXISTS idx_lc_course ON lms_content(tenant_id, course_id)');
      await migrateQuery(pool, 'Lms', 'CREATE INDEX IF NOT EXISTS idx_la_tenant ON lms_assignments(tenant_id)');
      await migrateQuery(pool, 'Lms', 'CREATE INDEX IF NOT EXISTS idx_la_course ON lms_assignments(tenant_id, course_id)');
      await migrateQuery(pool, 'Lms', 'CREATE INDEX IF NOT EXISTS idx_ls_tenant ON lms_submissions(tenant_id)');
      await migrateQuery(pool, 'Lms', 'CREATE INDEX IF NOT EXISTS idx_ls_assignment ON lms_submissions(assignment_id)');
      await migrateQuery(pool, 'Lms', 'CREATE INDEX IF NOT EXISTS idx_ls_student ON lms_submissions(tenant_id, student_id)');
      console.log('[LMS] Migrations applied successfully');
    } catch (e) { console.error('[LMS] Migration error:', e.message); }
  })();

  // ============================================================
  // ROUTE 1: GET /lms — LMS Dashboard
  // ============================================================
  app.get('/lms', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const enrollments = (await pool.query(
      `SELECT le.*, c.title as course_title, c.description as course_desc
       FROM lms_enrollments le
       LEFT JOIN courses c ON c.id = le.course_id AND c.tenant_id = le.tenant_id
       WHERE le.tenant_id=$1 AND le.student_id=$2 AND le.status='active'
       ORDER BY le.enrolled_at DESC LIMIT 20`, [tid, user.id]
    )).rows;

    const totalCourses = enrollments.length;
    const completedCount = enrollments.filter(e => e.status === 'completed').length;
    const avgProgress = enrollments.length ? Math.round(enrollments.reduce((s, e) => s + parseFloat(e.progress || 0), 0) / enrollments.length) : 0;

    const courseCards = enrollments.map(e => {
      const pct = Math.round(parseFloat(e.progress || 0));
      return '<div class="lms-course-card" onclick="location.href=\'/lms/courses/' + (e.course_id || '') + '\'">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">' +
          '<h3 class="lms-course-card-title">' + esc(e.course_title || 'Untitled Course') + '</h3>' +
          statusBadge(e.status) +
        '</div>' +
        (e.course_desc ? '<p style="font-size:12px;color:#64748b;margin-bottom:12px">' + esc(e.course_desc).substring(0, 80) + '</p>' : '') +
        progressBar(pct) +
        '<div style="margin-top:8px;font-size:11px;color:#94a3b8">Enrolled ' + fmtDate(e.enrolled_at) + '</div>' +
      '</div>';
    }).join('');

    // Recent assignments
    const recentAssignments = (await pool.query(
      `SELECT la.*, c.title as course_title
       FROM lms_assignments la
       LEFT JOIN courses c ON c.id = la.course_id AND c.tenant_id = la.tenant_id
       WHERE la.tenant_id=$1 AND la.is_published=true
       ORDER BY la.created_at DESC LIMIT 5`, [tid]
    )).rows;

    const assignRows = recentAssignments.map(a => '<tr>' +
      '<td><strong>' + esc(a.title || '—') + '</strong></td>' +
      '<td class="muted">' + esc(a.course_title || '—') + '</td>' +
      '<td>' + fmtDate(a.due_date) + '</td>' +
      '<td>' + statusBadge(a.is_published ? 'published' : 'draft') + '</td>' +
    '</tr>').join('');

    const html = LMS_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('dash') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📊 LMS Dashboard</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Your courses, assignments, and progress</p></div>' +
        '<a href="/lms/courses" class="lms-btn lms-btn-primary">📚 Browse Courses</a>' +
      '</div>' +
      '<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:24px">' +
        '<div class="stat-card"><div class="stat-num" style="color:#4f46e5">' + totalCourses + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Enrolled Courses</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#16a34a">' + completedCount + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Completed</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">' + avgProgress + '%</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Avg Progress</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#8b5cf6">' + recentAssignments.length + '</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Active Assignments</div></div>' +
      '</div>' +
      '<h2 style="font-size:18px;color:#1e293b;margin:0 0 14px">📖 My Courses</h2>' +
      '<div class="lms-cards" style="margin-bottom:24px">' +
        (courseCards || '<p class="muted" style="text-align:center;padding:30px;grid-column:1/-1">No courses enrolled yet. <a href="/lms/courses" style="color:#4f46e5">Browse courses</a></p>') +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📝 Recent Assignments</h3>' +
        '<div style="overflow-x:auto"><table class="lms-table">' +
          '<thead><tr><th>Title</th><th>Course</th><th>Due Date</th><th>Status</th></tr></thead>' +
          '<tbody>' + (assignRows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No assignments</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('LMS Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /lms/courses — Course Catalog
  // ============================================================
  app.get('/lms/courses', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const search = req.query.q || '';
    const category = req.query.category || '';

    let where = ['c.tenant_id=$1'], params = [tid], pi = 2;
    if (search) { where.push('(c.title ILIKE $' + pi + ' OR c.description ILIKE $' + pi + ')'); params.push('%' + search + '%'); pi++; }
    if (category) { where.push('c.category=$' + pi); params.push(category); pi++; }

    const courses = (await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM lms_enrollments le WHERE le.course_id = c.id AND le.tenant_id = c.tenant_id) as enrollment_count
       FROM courses c
       WHERE ${where.join(' AND ')}
       ORDER BY c.created_at DESC LIMIT 50`, params
    )).rows;

    const courseCards = courses.map(co => {
      const pct = 0;
      return '<div class="lms-course-card" onclick="location.href=\'/lms/courses/' + co.id + '\'">' +
        '<h3 class="lms-course-card-title">' + esc(co.title || 'Untitled') + '</h3>' +
        (co.description ? '<p style="font-size:12px;color:#64748b;margin-bottom:12px">' + esc(co.description).substring(0, 100) + '</p>' : '') +
        '<div class="lms-course-card-meta">' +
          '<span>👥 ' + (co.enrollment_count || 0) + ' enrolled</span>' +
          (co.category ? '<span>' + esc(co.category) + '</span>' : '') +
        '</div>' +
        '<a href="/lms/courses/' + co.id + '" class="lms-btn lms-btn-primary" style="padding:6px 14px;font-size:12px" onclick="event.stopPropagation()">View Course →</a>' +
      '</div>';
    }).join('');

    const html = LMS_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('courses') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📚 Course Catalog</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Browse and enroll in available courses</p></div>' +
      '</div>' +
      '<div class="lms-filter">' +
        '<div><label>Search</label><form method="GET" style="display:flex;gap:6px"><input type="text" name="q" value="' + esc(search) + '" placeholder="Course title or description..."><button type="submit" class="btn btn-sm btn-blue">Search</button></form></div>' +
      '</div>' +
      '<div class="lms-cards">' +
        (courseCards || '<p class="muted" style="text-align:center;padding:40px;grid-column:1/-1">No courses available yet.</p>') +
      '</div>' +
    '</div>';
    res.send(renderPage('Course Catalog', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /lms/courses — Create/Update Course
  // ============================================================
  app.post('/lms/courses', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { id, title, description, category } = req.body;
    if (!title || !title.trim()) return res.redirect('/lms/courses');

    try {
      if (id) {
        await pool.query(
          'UPDATE courses SET title=$1, description=$2, category=$3 WHERE id=$4 AND tenant_id=$5',
          [title.trim(), description || null, category || null, parseInt(id), tid]
        );
        console.log('[LMS] Course #' + id + ' updated');
      } else {
        await pool.query(
          'INSERT INTO courses (tenant_id, title, description, category, created_by) VALUES ($1,$2,$3,$4,$5)',
          [tid, title.trim(), description || null, category || null, user.id]
        );
        console.log('[LMS] Course "' + title.trim() + '" created by ' + user.email);
      }
    } catch (e) {
      console.error('[LMS] Error saving course:', e.message);
    }
    res.redirect('/lms/courses');
  }));

  // ============================================================
  // ROUTE 4: GET /lms/courses/:id — Course Detail
  // ============================================================
  app.get('/lms/courses/:id', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, courseId = req.params.id;
    const course = (await pool.query(
      'SELECT c.*, u.name as instructor_name FROM courses c LEFT JOIN users u ON u.id = c.created_by WHERE c.id=$1 AND c.tenant_id=$2', [courseId, tid]
    )).rows[0];
    if (!course) return res.redirect('/lms/courses');

    // Course content
    const contents = (await pool.query(
      'SELECT * FROM lms_content WHERE tenant_id=$1 AND course_id=$2 AND is_published=true ORDER BY order_seq, id', [tid, courseId]
    )).rows;

    // Check enrollment
    const enrollment = (await pool.query(
      'SELECT * FROM lms_enrollments WHERE tenant_id=$1 AND course_id=$2 AND student_id=$3',
      [tid, courseId, user.id]
    )).rows[0];

    const contentIcon = (type) => {
      const map = { video: '🎬', text: '📄', pdf: '📕', link: '🔗', quiz: '❓', assignment: '📝' };
      return map[type] || '📄';
    };
    const contentColor = (type) => {
      const map = { video: '#dcfce7', text: '#dbeafe', pdf: '#fee2e2', link: '#fef3c7', quiz: '#f3e8ff', assignment: '#e0e7ff' };
      return map[type] || '#f1f5f9';
    };

    const contentList = contents.map((ct, i) =>
      '<div class="lms-content-item">' +
        '<div class="lms-content-icon" style="background:' + contentColor(ct.content_type) + '">' + contentIcon(ct.content_type) + '</div>' +
        '<div style="flex:1"><strong style="font-size:13px;color:#1e293b">' + esc(ct.title || 'Content ' + (i + 1)) + '</strong>' +
          '<div style="font-size:11px;color:#94a3b8">' + (ct.content_type || 'text') + (ct.duration_minutes ? ' · ' + ct.duration_minutes + ' min' : '') + '</div>' +
        '</div>' +
        (ct.video_url ? '<a href="' + esc(ct.video_url) + '" target="_blank" class="btn btn-sm btn-green" style="font-size:11px">Play</a>' : '') +
      '</div>'
    ).join('');

    // Assignments for this course
    const assignments = (await pool.query(
      'SELECT * FROM lms_assignments WHERE tenant_id=$1 AND course_id=$2 AND is_published=true ORDER BY due_date', [tid, courseId]
    )).rows;

    const assignRows = assignments.map(a => {
      const isLate = a.due_date && new Date(a.due_date) < new Date();
      return '<tr>' +
        '<td><strong>' + esc(a.title) + '</strong></td>' +
        '<td>' + fmtDate(a.due_date) + (isLate ? ' <span style="color:#dc2626;font-weight:600;font-size:11px">OVERDUE</span>' : '') + '</td>' +
        '<td>' + (a.max_score || 100) + ' pts</td>' +
      '</tr>';
    }).join('');

    const html = LMS_CSS + '<div style="max-width:1100px;margin:0 auto">' +
      nav('courses') +
      '<a href="/lms/courses" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Courses</a>' +
      '<div class="card" style="padding:24px;margin-bottom:20px">' +
        '<div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">' +
          '<div><h1 style="font-size:22px;color:#1e293b;margin:0">' + esc(course.title) + '</h1>' +
            '<p style="font-size:13px;color:#64748b;margin-top:4px">' + (course.instructor_name ? 'By ' + esc(course.instructor_name) : '') + '</p>' +
          '</div>' +
          (enrollment ? '' : '<form method="POST" action="/lms/courses/' + courseId + '/enroll"><button class="lms-btn lms-btn-success">Enroll Now</button></form>') +
        '</div>' +
        (course.description ? '<p style="font-size:14px;color:#475569;margin-top:12px">' + esc(course.description) + '</p>' : '') +
        (enrollment ? '<div style="margin-top:12px">Progress: ' + progressBar(Math.round(parseFloat(enrollment.progress || 0))) + '</div>' : '') +
      '</div>' +
      '<div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">' +
        '<div class="card" style="padding:20px">' +
          '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📖 Course Content (' + contents.length + ')</h3>' +
          (contentList || '<p class="muted" style="text-align:center;padding:20px">No content yet</p>') +
        '</div>' +
        '<div class="card" style="padding:20px">' +
          '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📝 Assignments (' + assignments.length + ')</h3>' +
          '<div style="overflow-x:auto"><table class="lms-table">' +
            '<thead><tr><th>Title</th><th>Due</th><th>Points</th></tr></thead>' +
            '<tbody>' + (assignRows || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:20px">No assignments</td></tr>') + '</tbody>' +
          '</table></div>' +
        '</div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Course: ' + course.title, html, user, req));
  }));

  // Enroll in course
  app.post('/lms/courses/:id/enroll', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, courseId = req.params.id;
    const existing = (await pool.query(
      'SELECT id FROM lms_enrollments WHERE tenant_id=$1 AND course_id=$2 AND student_id=$3', [tid, courseId, user.id]
    )).rows[0];
    if (!existing) {
      await pool.query(
        'INSERT INTO lms_enrollments (tenant_id, course_id, student_id, enrolled_by, status, progress) VALUES ($1,$2,$3,$4,\'active\',0)',
        [tid, courseId, user.id, user.id]
      );
      console.log('[LMS] User ' + user.email + ' enrolled in course #' + courseId);
    }
    res.redirect('/lms/courses/' + courseId);
  }));

  // ============================================================
  // ROUTE 5: GET /lms/courses/:id/content — Content Management
  // ============================================================
  app.get('/lms/courses/:id/content', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, courseId = req.params.id;
    const course = (await pool.query('SELECT * FROM courses WHERE id=$1 AND tenant_id=$2', [courseId, tid])).rows[0];
    if (!course) return res.redirect('/lms/courses');

    const contents = (await pool.query(
      'SELECT * FROM lms_content WHERE tenant_id=$1 AND course_id=$2 ORDER BY order_seq, id', [tid, courseId]
    )).rows;

    const contentRows = contents.map(ct => '<tr>' +
      '<td><strong>' + esc(ct.title || '—') + '</strong></td>' +
      '<td><span class="badge" style="background:#f1f5f9;color:#64748b;font-size:11px">' + esc(ct.content_type || 'text') + '</span></td>' +
      '<td>' + (ct.duration_minutes || 0) + ' min</td>' +
      '<td>' + (ct.is_published ? '<span class="badge badge-success">Published</span>' : '<span class="badge badge-warning">Draft</span>') + '</td>' +
      '<td class="muted">' + fmtDateTime(ct.created_at) + '</td>' +
      '<td><form method="POST" action="/lms/courses/' + courseId + '/content/delete" style="display:inline" onsubmit="return confirm(\'Delete this content?\')">' +
        '<input type="hidden" name="id" value="' + ct.id + '"><button class="btn btn-sm btn-red" type="submit">Delete</button></form></td>' +
    '</tr>').join('');

    const html = LMS_CSS + '<div style="max-width:1100px;margin:0 auto">' +
      nav('courses') +
      '<a href="/lms/courses/' + courseId + '" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Course</a>' +
      '<div class="card" style="padding:24px;margin-bottom:20px">' +
        '<h2 style="color:#1e293b;margin:0 0 16px">+ Add Content to "' + esc(course.title) + '"</h2>' +
        '<form method="POST" action="/lms/courses/' + courseId + '/content" class="lms-form-grid lms-form">' +
          '<div><label>Title *</label><input type="text" name="title" required placeholder="Content title"></div>' +
          '<div><label>Type</label><select name="content_type"><option value="text">Text</option><option value="video">Video</option><option value="pdf">PDF</option><option value="link">Link</option><option value="quiz">Quiz</option><option value="assignment">Assignment</option></select></div>' +
          '<div class="full"><label>Content / Body</label><textarea name="content" rows="4" placeholder="Content text..."></textarea></div>' +
          '<div><label>Video URL</label><input type="url" name="video_url" placeholder="https://..."></div>' +
          '<div><label>File URL</label><input type="url" name="file_url" placeholder="https://..."></div>' +
          '<div><label>Duration (min)</label><input type="number" name="duration_minutes" value="0" min="0"></div>' +
          '<div><label>Order</label><input type="number" name="order_seq" value="' + (contents.length + 1) + '" min="1"></div>' +
          '<div><label><input type="checkbox" name="is_published" checked> Published</label></div>' +
          '<div><button type="submit" class="lms-btn lms-btn-primary">💾 Add Content</button></div>' +
        '</form>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Course Content (' + contents.length + ')</h3>' +
        '<div style="overflow-x:auto"><table class="lms-table">' +
          '<thead><tr><th>Title</th><th>Type</th><th>Duration</th><th>Status</th><th>Created</th><th>Action</th></tr></thead>' +
          '<tbody>' + (contentRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">No content added yet</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Course Content', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /lms/courses/:id/content — Add Content
  // ============================================================
  app.post('/lms/courses/:id/content', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, courseId = req.params.id;
    const { title, content_type, content, video_url, file_url, duration_minutes, order_seq, is_published } = req.body;
    if (!title || !title.trim()) return res.redirect('/lms/courses/' + courseId + '/content');

    await pool.query(
      `INSERT INTO lms_content (tenant_id, course_id, title, content_type, content, video_url, file_url, duration_minutes, order_seq, is_published)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tid, courseId, title.trim(), content_type || 'text', content || null, video_url || null,
       file_url || null, parseInt(duration_minutes) || 0, parseInt(order_seq) || 1, is_published === 'on']
    );
    console.log('[LMS] Content "' + title.trim() + '" added to course #' + courseId);
    res.redirect('/lms/courses/' + courseId + '/content');
  }));

  // Delete content
  app.post('/lms/courses/:id/content/delete', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id, courseId = req.params.id, id = req.body.id;
    await pool.query('DELETE FROM lms_content WHERE id=$1 AND tenant_id=$2', [id, tid]);
    res.redirect('/lms/courses/' + courseId + '/content');
  }));

  // ============================================================
  // ROUTE 7: GET /lms/assignments — Assignment Management
  // ============================================================
  app.get('/lms/assignments', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const courses = (await pool.query('SELECT id, title FROM courses WHERE tenant_id=$1 ORDER BY title', [tid])).rows;

    const assignments = (await pool.query(
      `SELECT la.*, c.title as course_title,
              (SELECT COUNT(*)::int FROM lms_submissions ls WHERE ls.assignment_id = la.id) as submission_count
       FROM lms_assignments la
       LEFT JOIN courses c ON c.id = la.course_id AND c.tenant_id = la.tenant_id
       WHERE la.tenant_id=$1
       ORDER BY la.created_at DESC LIMIT 100`, [tid]
    )).rows;

    const rows = assignments.map(a => {
      const isLate = a.due_date && new Date(a.due_date) < new Date();
      return '<tr>' +
        '<td><strong>' + esc(a.title) + '</strong></td>' +
        '<td class="muted">' + esc(a.course_title || '—') + '</td>' +
        '<td>' + fmtDate(a.due_date) + (isLate ? ' <span style="color:#dc2626;font-size:11px">OVERDUE</span>' : '') + '</td>' +
        '<td>' + (a.max_score || 100) + '</td>' +
        '<td>' + (a.is_published ? statusBadge('published') : statusBadge('draft')) + '</td>' +
        '<td>' + (a.submission_count || 0) + '</td>' +
      '</tr>';
    }).join('');

    const courseOpts = courses.map(c => '<option value="' + c.id + '">' + esc(c.title) + '</option>').join('');

    const html = LMS_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('assignments') +
      '<div style="display:grid;grid-template-columns:360px 1fr;gap:20px">' +
        '<div class="card" style="padding:24px">' +
          '<h2 style="color:#1e293b;margin:0 0 16px">+ Create Assignment</h2>' +
          '<form method="POST" action="/lms/assignments" class="lms-form">' +
            '<div style="margin-bottom:12px"><label>Title *</label><input type="text" name="title" required placeholder="Assignment title"></div>' +
            '<div style="margin-bottom:12px"><label>Course</label><select name="course_id"><option value="">— Select —</option>' + courseOpts + '</select></div>' +
            '<div style="margin-bottom:12px"><label>Due Date</label><input type="datetime-local" name="due_date"></div>' +
            '<div style="margin-bottom:12px"><label>Max Score</label><input type="number" name="max_score" value="100" min="1"></div>' +
            '<div style="margin-bottom:12px"><label>Description</label><textarea name="description" rows="3" placeholder="Assignment instructions..."></textarea></div>' +
            '<button type="submit" class="lms-btn lms-btn-primary">Create Assignment</button>' +
          '</form>' +
        '</div>' +
        '<div class="card" style="padding:20px">' +
          '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Assignments (' + assignments.length + ')</h3>' +
          '<div style="overflow-x:auto"><table class="lms-table">' +
            '<thead><tr><th>Title</th><th>Course</th><th>Due</th><th>Max</th><th>Status</th><th>Submissions</th></tr></thead>' +
            '<tbody>' + (rows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">No assignments</td></tr>') + '</tbody>' +
          '</table></div>' +
        '</div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Assignments', html, user, req));
  }));

  // ============================================================
  // ROUTE 8: POST /lms/assignments — Create Assignment
  // ============================================================
  app.post('/lms/assignments', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, course_id, due_date, max_score, description } = req.body;
    if (!title || !title.trim()) return res.redirect('/lms/assignments');

    await pool.query(
      `INSERT INTO lms_assignments (tenant_id, course_id, title, description, due_date, max_score, is_published, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,true,$7)`,
      [tid, course_id ? parseInt(course_id) : null, title.trim(), description || null, due_date || null,
       parseFloat(max_score) || 100, user.id]
    );
    console.log('[LMS] Assignment "' + title.trim() + '" created');
    res.redirect('/lms/assignments');
  }));

  // ============================================================
  // ROUTE 9: GET /lms/quizzes — Quiz Management
  // ============================================================
  app.get('/lms/quizzes', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const courses = (await pool.query('SELECT id, title FROM courses WHERE tenant_id=$1 ORDER BY title', [tid])).rows;

    let quizRows = '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:20px">No quizzes yet</td></tr>';
    try {
      const quizzes = (await pool.query(
        `SELECT q.*, c.title as course_title,
                (SELECT COUNT(*)::int FROM quiz_questions qq WHERE qq.quiz_id = q.id) as question_count,
                (SELECT COUNT(*)::int FROM quiz_attempts qa WHERE qa.quiz_id = q.id) as attempt_count
         FROM quizzes q
         LEFT JOIN courses c ON c.id = q.course_id AND c.tenant_id = q.tenant_id
         WHERE q.tenant_id=$1
         ORDER BY q.created_at DESC LIMIT 100`, [tid]
      )).rows;

      quizRows = quizzes.map(q => '<tr>' +
        '<td><strong>' + esc(q.title) + '</strong></td>' +
        '<td class="muted">' + esc(q.course_title || '—') + '</td>' +
        '<td>' + (q.question_count || 0) + ' questions</td>' +
        '<td>' + (q.duration_minutes || 30) + ' min</td>' +
        '<td>' + (q.attempt_count || 0) + ' attempts</td>' +
      '</tr>').join('');
    } catch (e) {}

    const courseOpts = courses.map(c => '<option value="' + c.id + '">' + esc(c.title) + '</option>').join('');

    const html = LMS_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('quizzes') +
      '<div class="card" style="padding:24px;margin-bottom:20px">' +
        '<h2 style="color:#1e293b;margin:0 0 16px">+ Create Quiz</h2>' +
        '<form method="POST" action="/lms/quizzes" class="lms-form-grid lms-form">' +
          '<div><label>Title *</label><input type="text" name="title" required placeholder="Quiz title"></div>' +
          '<div><label>Course</label><select name="course_id"><option value="">— Select —</option>' + courseOpts + '</select></div>' +
          '<div><label>Duration (min)</label><input type="number" name="duration_minutes" value="30" min="5"></div>' +
          '<div><label>Pass Mark (%)</label><input type="number" name="pass_mark" value="50" min="0" max="100"></div>' +
          '<div class="full"><label>Description</label><textarea name="description" rows="2" placeholder="Quiz description..."></textarea></div>' +
          '<div><button type="submit" class="lms-btn lms-btn-primary">Create Quiz</button></div>' +
        '</form>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Quizzes</h3>' +
        '<div style="overflow-x:auto"><table class="lms-table">' +
          '<thead><tr><th>Title</th><th>Course</th><th>Questions</th><th>Duration</th><th>Attempts</th></tr></thead>' +
          '<tbody>' + quizRows + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Quizzes', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /lms/quizzes — Create Quiz
  // ============================================================
  app.post('/lms/quizzes', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, course_id, duration_minutes, pass_mark, description } = req.body;
    if (!title || !title.trim()) return res.redirect('/lms/quizzes');

    try {
      await pool.query(
        `INSERT INTO quizzes (tenant_id, title, course_id, duration_minutes, pass_mark, description, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, title.trim(), course_id ? parseInt(course_id) : null, parseInt(duration_minutes) || 30,
         parseInt(pass_mark) || 50, description || null, user.id]
      );
      console.log('[LMS] Quiz "' + title.trim() + '" created');
    } catch (e) {
      console.error('[LMS] Error creating quiz:', e.message);
    }
    res.redirect('/lms/quizzes');
  }));

  // ============================================================
  // ROUTE 11: GET /lms/grades — Grading & Results
  // ============================================================
  app.get('/lms/grades', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const submissions = (await pool.query(
      `SELECT ls.*, la.title as assignment_title, c.title as course_title,
              u.name as student_name
       FROM lms_submissions ls
       JOIN lms_assignments la ON la.id = ls.assignment_id AND la.tenant_id = ls.tenant_id
       LEFT JOIN courses c ON c.id = la.course_id AND c.tenant_id = la.tenant_id
       LEFT JOIN users u ON u.id = ls.student_id
       WHERE ls.tenant_id=$1
       ORDER BY ls.submitted_at DESC LIMIT 100`, [tid]
    )).rows;

    const gradedCount = submissions.filter(s => s.status === 'graded').length;
    const pendingCount = submissions.filter(s => s.status === 'submitted').length;
    const avgGrade = submissions.filter(s => s.grade).length
      ? (submissions.filter(s => s.grade).reduce((sum, s) => sum + parseFloat(s.grade), 0) / submissions.filter(s => s.grade).length).toFixed(1)
      : '—';

    const rows = submissions.map(s => {
      const gradeVal = s.grade ? parseFloat(s.grade) : null;
      const color = gradeVal !== null ? (gradeVal >= 70 ? '#16a34a' : gradeVal >= 50 ? '#f59e0b' : '#dc2626') : '#94a3b8';
      return '<tr>' +
        '<td><strong>' + esc(s.student_name || 'ID ' + s.student_id) + '</strong></td>' +
        '<td>' + esc(s.assignment_title || '—') + '</td>' +
        '<td class="muted">' + esc(s.course_title || '—') + '</td>' +
        '<td>' + statusBadge(s.status) + '</td>' +
        '<td style="font-weight:700;color:' + color + '">' + (gradeVal !== null ? gradeVal : '—') + '</td>' +
        '<td class="muted">' + fmtDateTime(s.submitted_at) + '</td>' +
        (s.status === 'submitted' ?
          '<td><form method="POST" action="/lms/grades" style="display:flex;gap:4px">' +
            '<input type="hidden" name="submission_id" value="' + s.id + '">' +
            '<input type="number" name="grade" placeholder="Score" style="width:70px;padding:4px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:12px">' +
            '<button type="submit" class="btn btn-sm btn-green">Grade</button></form></td>' : '<td>—</td>') +
      '</tr>';
    }).join('');

    const html = LMS_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('grades') +
      '<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">' +
        '<div><h1 style="font-size:24px;color:#1e293b">📊 Grades & Results</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Review and grade student submissions</p></div>' +
      '</div>' +
      '<div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:14px;margin-bottom:20px">' +
        '<div class="stat-card"><div class="stat-num" style="color:#4f46e5">' + submissions.length + '</div><div class="muted" style="font-size:11px">Total Submissions</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#16a34a">' + gradedCount + '</div><div class="muted" style="font-size:11px">Graded</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#f59e0b">' + pendingCount + '</div><div class="muted" style="font-size:11px">Pending</div></div>' +
        '<div class="stat-card"><div class="stat-num" style="color:#8b5cf6">' + avgGrade + '</div><div class="muted" style="font-size:11px">Avg Grade</div></div>' +
      '</div>' +
      '<div class="card" style="padding:20px">' +
        '<h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 All Submissions</h3>' +
        '<div style="overflow-x:auto"><table class="lms-table">' +
          '<thead><tr><th>Student</th><th>Assignment</th><th>Course</th><th>Status</th><th>Grade</th><th>Submitted</th><th>Action</th></tr></thead>' +
          '<tbody>' + (rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:20px">No submissions</td></tr>') + '</tbody>' +
        '</table></div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Grades', html, user, req));
  }));

  // Grade submission
  app.post('/lms/grades', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { submission_id, grade, feedback } = req.body;
    if (!submission_id) return res.redirect('/lms/grades');
    await pool.query(
      'UPDATE lms_submissions SET grade=$1, feedback=$2, status=\'graded\', graded_at=NOW() WHERE id=$3 AND tenant_id=$4',
      [parseFloat(grade) || null, feedback || null, parseInt(submission_id), tid]
    );
    console.log('[LMS] Submission #' + submission_id + ' graded: ' + (grade || 0));
    res.redirect('/lms/grades');
  }));

  // ============================================================
  // ROUTE 12: GET /lms/certificates — Certificates
  // ============================================================
  app.get('/lms/certificates', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const enrollments = (await pool.query(
      `SELECT le.*, c.title as course_title, c.description as course_desc
       FROM lms_enrollments le
       LEFT JOIN courses c ON c.id = le.course_id AND c.tenant_id = le.tenant_id
       WHERE le.tenant_id=$1 AND le.student_id=$2 AND le.status='completed'
       ORDER BY le.completed_at DESC`, [tid, user.id]
    )).rows;

    const certCards = enrollments.map(e =>
      '<div class="card" style="padding:20px;border:2px solid #e2e8f0;border-radius:14px;text-align:center">' +
        '<div style="font-size:48px;margin-bottom:12px">🎓</div>' +
        '<h3 style="font-size:16px;color:#1e293b;margin:0 0 4px">Certificate of Completion</h3>' +
        '<p style="font-size:14px;color:#4f46e5;font-weight:600;margin:0 0 8px">' + esc(e.course_title || 'Course') + '</p>' +
        '<p class="muted" style="font-size:12px">Awarded to <strong>' + esc(user.name || user.email) + '</strong></p>' +
        '<p class="muted" style="font-size:12px">Completed on ' + fmtDate(e.completed_at) + '</p>' +
        '<div style="margin-top:12px"><button class="lms-btn lms-btn-secondary" style="font-size:12px">🖨️ Download PDF</button></div>' +
      '</div>'
    ).join('');

    const html = LMS_CSS + '<div style="max-width:1200px;margin:0 auto">' +
      nav('certificates') +
      '<div style="margin-bottom:20px"><h1 style="font-size:24px;color:#1e293b">🎓 Certificates</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Course completion certificates</p></div>' +
      '<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">' +
        (certCards || '<div class="card" style="padding:40px;text-align:center;grid-column:1/-1"><p style="font-size:16px;color:#64748b">No certificates earned yet</p><p class="muted" style="font-size:13px;margin-top:4px">Complete a course to earn your first certificate!</p></div>') +
      '</div>' +
    '</div>';
    res.send(renderPage('Certificates', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: GET /lms/api/courses — JSON API
  // ============================================================
  app.get('/lms/api/courses', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const courses = (await pool.query(
      `SELECT c.*,
              (SELECT COUNT(*)::int FROM lms_enrollments le WHERE le.course_id = c.id AND le.tenant_id = c.tenant_id) as enrollment_count
       FROM courses c WHERE c.tenant_id=$1 ORDER BY c.created_at DESC LIMIT 100`, [tid]
    )).rows;
    res.json({ success: true, count: courses.length, data: courses });
  }));

  // ============================================================
  // ROUTE 14: GET /lms/api/progress/:studentId — JSON API
  // ============================================================
  app.get('/lms/api/progress/:studentId', requireAuth, requireSubscription('basic'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id, studentId = req.params.studentId;
    const enrollments = (await pool.query(
      `SELECT le.*, c.title as course_title
       FROM lms_enrollments le
       LEFT JOIN courses c ON c.id = le.course_id AND c.tenant_id = le.tenant_id
       WHERE le.tenant_id=$1 AND le.student_id=$2
       ORDER BY le.enrolled_at DESC`, [tid, studentId]
    )).rows;
    res.json({ success: true, student_id: studentId, count: enrollments.length, data: enrollments });
  }));

  // ============================================================
  // END MODULE
  // ============================================================
};
