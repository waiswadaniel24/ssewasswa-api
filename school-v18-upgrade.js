/**
 * School Portal v18 Upgrade — SaaS School Management Module
 * 10 Features: Teacher Dashboard, Rankings, Certificates, Clubs, Field Trips,
 *   Counselling, Special Needs, Academic Terms, Newsletter, Continuous Assessment
 */
'use strict';

module.exports = function (app, pool, opts) {

  /* ── Helper extraction ─────────────────────────────────────────────── */
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); });
  const requireNotBanned = opts.requireNotBanned || ((req, res, next) => { if (req.session?.user?.banned) return res.send('Account banned'); next(); });
  const trackRevenue = opts.trackRevenue || global.trackRevenue || (() => {});
  const queueEmail = opts.queueEmail || (() => {});
  const audit = opts.audit || (() => {});
  const uiT = opts.uiT || ((k) => k);
  const awardPoints = opts.awardPoints || (() => {});

  const COLORS = {
    primary: '#4f46e5',
    success: '#059669',
    warning: '#f59e0b',
    danger: '#dc2626',
    bg: '#f3f4f6',
    cardBg: '#ffffff',
    text: '#1f2937',
    muted: '#6b7280',
    border: '#e5e7eb',
  };

  function card(title, bodyHtml) {
    return `<div style="background:${COLORS.cardBg};border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,0.1);padding:24px;margin-bottom:20px;">
      <h3 style="margin:0 0 16px 0;color:${COLORS.text};font-size:1.15rem;">${esc(title)}</h3>
      ${bodyHtml}
    </div>`;
  }

  function badge(color, text) {
    return `<span style="display:inline-block;padding:2px 10px;border-radius:9999px;font-size:0.75rem;font-weight:600;color:#fff;background:${color};">${esc(text)}</span>`;
  }

  function btn(href, label, color) {
    const c = color || COLORS.primary;
    return `<a href="${esc(href)}" style="display:inline-block;padding:8px 18px;border-radius:8px;background:${c};color:#fff;text-decoration:none;font-size:0.875rem;font-weight:600;margin-right:8px;">${esc(label)}</a>`;
  }

  function postBtn(label, color) {
    const c = color || COLORS.primary;
    return `<button type="submit" style="padding:8px 18px;border-radius:8px;background:${c};color:#fff;border:none;font-size:0.875rem;font-weight:600;cursor:pointer;">${esc(label)}</button>`;
  }

  function pageWrap(title, bodyHtml) {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head><body style="background:${COLORS.bg};margin:0;font-family:system-ui,sans-serif;color:${COLORS.text};">
<a href="#main" style="position:absolute;top:-9999px;left:0;background:${COLORS.primary};color:#fff;padding:8px;z-index:9999;" onfocus="this.style.top='0'" onblur="this.style.top='-9999px'">Skip to content</a>
<div style="max-width:1100px;margin:0 auto;padding:20px;" role="main" id="main">
<div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
  <h1 style="margin:0;font-size:1.5rem;">${esc(title)}</h1>
  <nav aria-label="School navigation">
    ${btn('/school/teacher/dashboard', 'Dashboard')}${btn('/school/rankings', 'Rankings')}${btn('/school/certificates/transfer', 'Certificates')}${btn('/school/clubs', 'Clubs')}${btn('/school/field-trips', 'Trips')}
  </nav>
</div>
${bodyHtml}
</div></body></html>`;
  }

  function getTenantId(req) {
    return (req.session && req.session.user && req.session.user.tenant_id) || null;
  }

  /* ── Table Creation ─────────────────────────────────────────────────── */
  async function init() {
    const client = await pool.connect();
    try {
      await client.query(`
        CREATE TABLE IF NOT EXISTS school_certificates_issued (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          student_id INTEGER NOT NULL,
          certificate_type VARCHAR(30) NOT NULL,
          certificate_number VARCHAR(50) UNIQUE NOT NULL,
          details JSONB DEFAULT '{}',
          issued_by INTEGER,
          issued_at TIMESTAMPTZ DEFAULT now(),
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS school_clubs (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          name VARCHAR(150) NOT NULL,
          description TEXT,
          patron VARCHAR(150),
          meeting_day VARCHAR(20),
          venue VARCHAR(150),
          max_members INTEGER DEFAULT 50,
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS school_club_members (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          club_id INTEGER NOT NULL REFERENCES school_clubs(id),
          student_id INTEGER NOT NULL,
          role VARCHAR(50) DEFAULT 'member',
          joined_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE(club_id, student_id)
        );

        CREATE TABLE IF NOT EXISTS school_club_meetings (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          club_id INTEGER NOT NULL REFERENCES school_clubs(id),
          meeting_date DATE NOT NULL,
          agenda TEXT,
          minutes TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS school_club_attendance (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          meeting_id INTEGER NOT NULL REFERENCES school_club_meetings(id),
          student_id INTEGER NOT NULL,
          present BOOLEAN DEFAULT false,
          UNIQUE(meeting_id, student_id)
        );

        CREATE TABLE IF NOT EXISTS school_field_trips (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          destination VARCHAR(200) NOT NULL,
          trip_date DATE NOT NULL,
          target_class VARCHAR(50),
          cost NUMERIC(10,2) DEFAULT 0,
          teacher_in_charge VARCHAR(150),
          description TEXT,
          max_participants INTEGER DEFAULT 60,
          status VARCHAR(20) DEFAULT 'planning',
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS field_trip_participants (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          trip_id INTEGER NOT NULL REFERENCES school_field_trips(id),
          student_id INTEGER NOT NULL,
          parent_consent BOOLEAN DEFAULT false,
          consent_form TEXT,
          paid BOOLEAN DEFAULT false,
          amount_paid NUMERIC(10,2) DEFAULT 0,
          signed_up_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE(trip_id, student_id)
        );

        CREATE TABLE IF NOT EXISTS school_counselling_sessions (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          student_id INTEGER NOT NULL,
          counsellor_id INTEGER,
          session_date DATE NOT NULL,
          session_type VARCHAR(30) NOT NULL,
          notes TEXT,
          follow_up_date DATE,
          status VARCHAR(20) DEFAULT 'open',
          confidential BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS school_special_needs (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          student_id INTEGER NOT NULL,
          need_type VARCHAR(30) NOT NULL,
          severity VARCHAR(20) NOT NULL,
          accommodations JSONB DEFAULT '[]',
          iep_notes TEXT,
          diagnosed_date DATE,
          status VARCHAR(20) DEFAULT 'active',
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS special_needs_services (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          special_need_id INTEGER NOT NULL REFERENCES school_special_needs(id),
          service_type VARCHAR(100) NOT NULL,
          provider VARCHAR(150),
          service_date DATE,
          notes TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS academic_terms (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          name VARCHAR(100) NOT NULL,
          start_date DATE NOT NULL,
          end_date DATE NOT NULL,
          academic_year VARCHAR(20),
          is_current BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS school_newsletters (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          title VARCHAR(250) NOT NULL,
          content TEXT,
          target_audience VARCHAR(30) DEFAULT 'all',
          status VARCHAR(20) DEFAULT 'draft',
          sent_at TIMESTAMPTZ,
          created_by INTEGER,
          created_at TIMESTAMPTZ DEFAULT now()
        );

        CREATE TABLE IF NOT EXISTS continuous_assessments (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL,
          student_id INTEGER NOT NULL,
          subject VARCHAR(100) NOT NULL,
          assessment_type VARCHAR(30) NOT NULL,
          score NUMERIC(6,2) NOT NULL,
          max_score NUMERIC(6,2) NOT NULL DEFAULT 100,
          assessment_date DATE NOT NULL,
          term_id INTEGER,
          comments TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        );
      `);
      console.log('[school-v18-upgrade] Tables ensured');
    } finally {
      client.release();
    }
  }
  init();

  /* ═══════════════════════════════════════════════════════════════════
     FEATURE 1 — Teacher Dashboard
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/teacher/dashboard', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = req.session.user.id;
    const today = new Date().toISOString().slice(0, 10);
    const weekStart = new Date(); weekStart.setDate(weekStart.getDate() - weekStart.getDay());
    const ws = weekStart.toISOString().slice(0, 10);

    const [staffRow, schedule, homework, announcements] = await Promise.all([
      pool.query(`SELECT * FROM staff WHERE tenant_id=$1 AND user_id=$2 LIMIT 1`, [tid, uid]).then(r => r.rows[0]),
      pool.query(`SELECT t.*, c.name AS class_name, s.name AS subject_name FROM timetable t
        LEFT JOIN classes c ON c.id=t.class_id AND c.tenant_id=$1
        LEFT JOIN subjects s ON s.id=t.subject_id AND s.tenant_id=$1
        WHERE t.tenant_id=$1 AND t.staff_id=$2 AND t.day=EXTRACT(DOW FROM DATE $3)
        ORDER BY t.start_time`, [tid, uid, today]).then(r => r.rows),
      pool.query(`SELECT h.*, s.name AS student_name, c.name AS class_name FROM homework h
        LEFT JOIN students s ON s.id=h.student_id AND s.tenant_id=$1
        LEFT JOIN classes c ON c.id=h.class_id AND c.tenant_id=$1
        WHERE h.tenant_id=$1 AND h.assigned_by=$2 AND h.graded=false
        ORDER BY h.due_date`, [tid, uid]).then(r => r.rows),
      pool.query(`SELECT * FROM announcements WHERE tenant_id=$1 AND target_role='teacher' AND active=true ORDER BY created_at DESC LIMIT 5`, [tid]).then(r => r.rows),
    ]);

    const attendanceRows = await pool.query(
      `SELECT COUNT(*) AS total, COUNT(CASE WHEN present THEN 1 END) AS present FROM attendance a
       JOIN timetable t ON t.id=a.timetable_id AND t.tenant_id=$1
       WHERE a.tenant_id=$1 AND t.staff_id=$2 AND a.date >= $3`,
      [tid, uid, ws]
    ).then(r => r.rows[0]);

    const attPct = attendanceRows && attendanceRows.total > 0
      ? Math.round((Number(attendanceRows.present) / Number(attendanceRows.total)) * 100)
      : 100;

    let html = pageWrap('Teacher Dashboard', `
      ${card('Welcome, ' + esc(staffRow ? staffRow.name : req.session.user.name), `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;">
          <div style="background:${COLORS.primary}11;border-left:4px solid ${COLORS.primary};padding:12px;border-radius:4px;">
            <div style="font-size:0.8rem;color:${COLORS.muted};">Classes Today</div>
            <div style="font-size:1.5rem;font-weight:700;">${schedule.length}</div>
          </div>
          <div style="background:${COLORS.warning}11;border-left:4px solid ${COLORS.warning};padding:12px;border-radius:4px;">
            <div style="font-size:0.8rem;color:${COLORS.muted};">Homework to Grade</div>
            <div style="font-size:1.5rem;font-weight:700;">${homework.length}</div>
          </div>
          <div style="background:${COLORS.success}11;border-left:4px solid ${COLORS.success};padding:12px;border-radius:4px;">
            <div style="font-size:0.8rem;color:${COLORS.muted};">Weekly Attendance</div>
            <div style="font-size:1.5rem;font-weight:700;">${attPct}%</div>
          </div>
        </div>
      `)}

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        ${card('Quick Actions', `
          <div style="display:flex;flex-wrap:wrap;gap:10px;">
            ${btn('/school/attendance/take', 'Take Attendance', COLORS.primary)}
            ${btn('/school/homework/assign', 'Assign Homework', COLORS.warning)}
            ${btn('/school/marks/entry', 'View Marks', COLORS.success)}
            ${btn('/school/clubs', 'Manage Clubs', '#7c3aed')}
          </div>
        `)}

        ${card('Recent Announcements', announcements.length ? announcements.map(a => `
          <div style="padding:8px 0;border-bottom:1px solid ${COLORS.border};">
            <strong>${esc(a.title)}</strong>
            <span style="color:${COLORS.muted};font-size:0.8rem;margin-left:8px;">${esc(String(a.created_at || '').slice(0, 10))}</span>
            <p style="margin:4px 0 0;font-size:0.85rem;">${esc(String(a.message || '').slice(0, 120))}</p>
          </div>
        `).join('') : '<p style="color:' + COLORS.muted + ';">No announcements</p>')}
      </div>

      ${card("Today's Schedule", schedule.length ? `
        <table style="width:100%;border-collapse:collapse;" aria-label="Today's timetable">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Time</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Subject</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Class</th>
          </tr></thead>
          <tbody>${schedule.map(s => `<tr>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(s.start_time)} - ${esc(s.end_time)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(s.subject_name || s.subject_id || '')}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(s.class_name || s.class_id || '')}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p style="color:' + COLORS.muted + ';">No classes scheduled for today.</p>')}

      ${card('Pending Homework to Grade', homework.length ? `
        <table style="width:100%;border-collapse:collapse;" aria-label="Homework to grade">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Student</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Class</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Due</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Action</th>
          </tr></thead>
          <tbody>${homework.map(h => `<tr>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(h.student_name)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(h.class_name)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(String(h.due_date).slice(0, 10))}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${btn('/school/homework/grade/' + h.id, 'Grade', COLORS.success)}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p style="color:' + COLORS.muted + ';">All homework graded! Great job.</p>')}
    `);
    res.send(renderPage('teacher-dashboard', html, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     FEATURE 2 — Student Rankings & Leaderboard
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/rankings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const classFilter = req.query.class || '';
    const examFilter = req.query.exam || '';

    let sql = `SELECT s.id, s.name, s.class_name,
      COALESCE(SUM(m.score),0) AS total_marks,
      COUNT(DISTINCT m.subject_id) AS subjects,
      CASE WHEN COUNT(m.id)>0 THEN ROUND(AVG(m.score),1) ELSE 0 END AS average
      FROM students s
      LEFT JOIN marks m ON m.student_id=s.id AND m.tenant_id=$1`;
    const params = [tid];
    let pi = 2;
    if (examFilter) { sql += ` AND m.exam_id=$${pi++}`; params.push(examFilter); }
    if (classFilter) { sql += ` WHERE s.class_name=$${pi++}`; params.push(classFilter); }
    sql += ` WHERE s.tenant_id=$1 GROUP BY s.id, s.name, s.class_name ORDER BY average DESC, total_marks DESC`;
    // Rebuild to avoid duplicate WHERE
    sql = `SELECT sub.*, ROW_NUMBER() OVER (ORDER BY sub.average DESC, sub.total_marks DESC) AS position FROM (
      SELECT s.id, s.name, s.class_name,
        COALESCE(SUM(m.score),0) AS total_marks,
        COUNT(DISTINCT m.subject_id) AS subjects,
        CASE WHEN COUNT(m.id)>0 THEN ROUND(AVG(m.score),1) ELSE 0 END AS average
        FROM students s
        LEFT JOIN marks m ON m.student_id=s.id AND m.tenant_id=$1
        ${examFilter ? 'AND m.exam_id=$2' : ''}
        WHERE s.tenant_id=$1 ${classFilter ? (examFilter ? 'AND s.class_name=$3' : 'AND s.class_name=$2') : ''}
        GROUP BY s.id, s.name, s.class_name
    ) sub ORDER BY sub.average DESC, sub.total_marks DESC`;

    const rankings = await pool.query(sql, params).then(r => r.rows);
    const exams = await pool.query(`SELECT id, name FROM exams WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]).then(r => r.rows);
    const classes = await pool.query(`SELECT DISTINCT class_name FROM students WHERE tenant_id=$1 ORDER BY class_name`, [tid]).then(r => r.rows);

    function medal(pos) {
      if (pos === 1) return badge('#FFD700', 'Gold');
      if (pos === 2) return badge('#C0C0C0', 'Silver');
      if (pos === 3) return badge('#CD7F32', 'Bronze');
      return '';
    }

    let html = pageWrap('Student Rankings', `
      <div style="display:flex;flex-wrap:wrap;gap:12px;margin-bottom:20px;align-items:end;">
        <div>
          <label for="filter-class" style="display:block;font-size:0.8rem;margin-bottom:4px;color:${COLORS.muted};">Filter by Class</label>
          <select id="filter-class" onchange="location.href='/school/rankings?class='+this.value+'&exam=${esc(examFilter)}'"
            style="padding:8px 12px;border:1px solid ${COLORS.border};border-radius:8px;font-size:0.875rem;">
            <option value="">All Classes</option>
            ${classes.map(c => `<option value="${esc(c.class_name)}" ${classFilter === c.class_name ? 'selected' : ''}>${esc(c.class_name)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label for="filter-exam" style="display:block;font-size:0.8rem;margin-bottom:4px;color:${COLORS.muted};">Filter by Exam</label>
          <select id="filter-exam" onchange="location.href='/school/rankings?class=${esc(classFilter)}&exam='+this.value"
            style="padding:8px 12px;border:1px solid ${COLORS.border};border-radius:8px;font-size:0.875rem;">
            <option value="">All Exams</option>
            ${exams.map(e => `<option value="${esc(String(e.id))}" ${String(examFilter) === String(e.id) ? 'selected' : ''}>${esc(e.name)}</option>`).join('')}
          </select>
        </div>
        <button onclick="window.print()" style="padding:8px 18px;border-radius:8px;background:${COLORS.success};color:#fff;border:none;cursor:pointer;">Print</button>
      </div>

      ${card('Leaderboard — Top ' + rankings.length + ' Students', `
        <table style="width:100%;border-collapse:collapse;" aria-label="Student rankings leaderboard">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:10px;border-bottom:2px solid ${COLORS.primary};">Position</th>
            <th scope="col" style="text-align:left;padding:10px;border-bottom:2px solid ${COLORS.primary};">Name</th>
            <th scope="col" style="text-align:left;padding:10px;border-bottom:2px solid ${COLORS.primary};">Class</th>
            <th scope="col" style="text-align:right;padding:10px;border-bottom:2px solid ${COLORS.primary};">Total Marks</th>
            <th scope="col" style="text-align:right;padding:10px;border-bottom:2px solid ${COLORS.primary};">Average</th>
            <th scope="col" style="text-align:right;padding:10px;border-bottom:2px solid ${COLORS.primary};">Subjects</th>
          </tr></thead>
          <tbody>${rankings.map(r => `<tr style="${r.position <= 3 ? 'background:' + COLORS.warning + '11;' : ''}">
            <td style="padding:10px;border-bottom:1px solid ${COLORS.border};font-weight:700;">${r.position} ${medal(r.position)}</td>
            <td style="padding:10px;border-bottom:1px solid ${COLORS.border};">${esc(r.name)}</td>
            <td style="padding:10px;border-bottom:1px solid ${COLORS.border};">${esc(r.class_name)}</td>
            <td style="padding:10px;border-bottom:1px solid ${COLORS.border};text-align:right;font-weight:600;">${r.total_marks}</td>
            <td style="padding:10px;border-bottom:1px solid ${COLORS.border};text-align:right;font-weight:600;">${r.average}%</td>
            <td style="padding:10px;border-bottom:1px solid ${COLORS.border};text-align:right;">${r.subjects}</td>
          </tr>`).join('')}</tbody>
        </table>
      `)}
    `);
    res.send(renderPage('rankings', html, req));
  }));

  app.get('/school/rankings/class/:className', requireAuth, requireNotBanned, ah(async (req, res) => {
    res.redirect('/school/rankings?class=' + encodeURIComponent(req.params.className));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     FEATURE 3 — Transfer / Leaving / Character Certificates
     ═══════════════════════════════════════════════════════════════════ */
  function certForm(action, type) {
    return `<form method="POST" action="${esc(action)}" style="max-width:600px;">
      <div style="margin-bottom:16px;">
        <label for="student_id" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Student</label>
        <select id="student_id" name="student_id" required aria-required="true"
          style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
          <option value="">-- Select Student --</option>
        </select>
      </div>
      ${type === 'transfer' ? `
      <div style="margin-bottom:16px;">
        <label for="reason" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Reason for Transfer</label>
        <textarea id="reason" name="reason" rows="3" required style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;"></textarea>
      </div>
      <div style="margin-bottom:16px;">
        <label for="conduct" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Conduct Remarks</label>
        <input type="text" id="conduct" name="conduct" required style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
      </div>` : ''}
      ${type === 'leaving' ? `
      <div style="margin-bottom:16px;">
        <label for="clearance_status" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Clearance Status</label>
        <select id="clearance_status" name="clearance_status" style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
          <option value="pending">Pending</option><option value="cleared">Cleared</option>
        </select>
      </div>` : ''}
      ${type === 'character' ? `
      <div style="margin-bottom:16px;">
        <label for="academic_performance" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Academic Performance</label>
        <textarea id="academic_performance" name="academic_performance" rows="2" required style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;"></textarea>
      </div>
      <div style="margin-bottom:16px;">
        <label for="behavior" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Behavior Assessment</label>
        <textarea id="behavior" name="behavior" rows="2" required style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;"></textarea>
      </div>
      <div style="margin-bottom:16px;">
        <label for="extracurricular" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Extracurricular Activities</label>
        <textarea id="extracurricular" name="extracurricular" rows="2" style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;"></textarea>
      </div>` : ''}
      ${postBtn('Generate Certificate')}
    </form>`;
  }

  app.get('/school/certificates/transfer', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const students = await pool.query(`SELECT id, name, class_name FROM students WHERE tenant_id=$1 ORDER BY name`, [tid]).then(r => r.rows);
    let html = pageWrap('Transfer Certificate', card('Issue Transfer Certificate', certForm('/school/certificates/transfer/generate', 'transfer')));
    res.send(renderPage('cert-transfer', html, req));
  }));

  app.post('/school/certificates/transfer/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { student_id, reason, conduct } = req.body;
    if (!student_id || !reason || !conduct) return res.status(400).send('All fields are required');
    const certNum = 'TC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await pool.query(
      `INSERT INTO school_certificates_issued (tenant_id, student_id, certificate_type, certificate_number, details, issued_by)
       VALUES ($1,$2,'transfer',$3,$4,$5)`,
      [tid, student_id, certNum, JSON.stringify({ reason, conduct }), req.session.user.id]
    );
    audit({ tenant_id: tid, action: 'generate_transfer_cert', entity: 'certificates', id: student_id, by: req.session.user.id });
    const student = await pool.query(`SELECT * FROM students WHERE id=$1 AND tenant_id=$2`, [student_id, tid]).then(r => r.rows[0]);
    let certHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Transfer Certificate</title></head>
    <body style="font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:40px;border:3px solid ${COLORS.primary};">
    <div style="text-align:center;margin-bottom:40px;">
      <h1 style="color:${COLORS.primary};margin-bottom:4px;">TRANSFER CERTIFICATE</h1>
      <p style="color:${COLORS.muted};">Certificate No: ${esc(certNum)}</p>
    </div>
    <p>This is to certify that <strong>${esc(student ? student.name : '')}</strong>,
    bearing Student ID <strong>${esc(String(student_id))}</strong>,
    Class <strong>${esc(student ? student.class_name : '')}</strong>,
    was admitted on <strong>${esc(student ? String(student.admission_date || '').slice(0, 10) : 'N/A')}</strong>.</p>
    <p><strong>Reason for Transfer:</strong> ${esc(reason)}</p>
    <p><strong>Conduct:</strong> ${esc(conduct)}</p>
    <p style="margin-top:40px;">Date of Issue: ${esc(new Date().toISOString().slice(0, 10))}</p>
    <div style="display:flex;justify-content:space-between;margin-top:60px;">
      <div>_________________<br>Class Teacher</div>
      <div>_________________<br>Principal</div>
    </div>
    <div style="text-align:center;margin-top:30px;">
      <button onclick="window.print()" style="padding:10px 24px;background:${COLORS.primary};color:#fff;border:none;border-radius:8px;cursor:pointer;font-size:1rem;">Print Certificate</button>
      ${btn('/school/certificates/records', 'View All Records')}
    </div></body></html>`;
    res.send(certHtml);
  }));

  app.get('/school/certificates/leaving', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    let html = pageWrap('Leaving Certificate', card('Issue Leaving Certificate', certForm('/school/certificates/leaving/generate', 'leaving')));
    res.send(renderPage('cert-leaving', html, req));
  }));

  app.post('/school/certificates/leaving/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { student_id, clearance_status } = req.body;
    if (!student_id) return res.status(400).send('Student is required');
    const certNum = 'LC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await pool.query(
      `INSERT INTO school_certificates_issued (tenant_id, student_id, certificate_type, certificate_number, details, issued_by)
       VALUES ($1,$2,'leaving',$3,$4,$5)`,
      [tid, student_id, certNum, JSON.stringify({ clearance_status }), req.session.user.id]
    );
    audit({ tenant_id: tid, action: 'generate_leaving_cert', entity: 'certificates', id: student_id, by: req.session.user.id });
    const student = await pool.query(`SELECT * FROM students WHERE id=$1 AND tenant_id=$2`, [student_id, tid]).then(r => r.rows[0]);
    let certHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Leaving Certificate</title></head>
    <body style="font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:40px;border:3px solid ${COLORS.primary};">
    <div style="text-align:center;margin-bottom:40px;">
      <h1 style="color:${COLORS.primary};margin-bottom:4px;">SCHOOL LEAVING CERTIFICATE</h1>
      <p style="color:${COLORS.muted};">Certificate No: ${esc(certNum)}</p>
    </div>
    <p>This is to certify that <strong>${esc(student ? student.name : '')}</strong>,
    Class <strong>${esc(student ? student.class_name : '')}</strong>,
    has been granted a leaving certificate.</p>
    <p><strong>Clearance Status:</strong> ${esc(clearance_status || 'pending')}</p>
    <p style="margin-top:40px;">Date of Issue: ${esc(new Date().toISOString().slice(0, 10))}</p>
    <div style="display:flex;justify-content:space-between;margin-top:60px;">
      <div>_________________<br>Class Teacher</div>
      <div>_________________<br>Principal</div>
    </div>
    <div style="text-align:center;margin-top:30px;">
      <button onclick="window.print()" style="padding:10px 24px;background:${COLORS.primary};color:#fff;border:none;border-radius:8px;cursor:pointer;">Print</button>
      ${btn('/school/certificates/records', 'View All Records')}
    </div></body></html>`;
    res.send(certHtml);
  }));

  app.get('/school/certificates/character', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    let html = pageWrap('Character Certificate', card('Issue Character Certificate', certForm('/school/certificates/character/generate', 'character')));
    res.send(renderPage('cert-character', html, req));
  }));

  app.post('/school/certificates/character/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { student_id, academic_performance, behavior, extracurricular } = req.body;
    if (!student_id || !academic_performance || !behavior) return res.status(400).send('Required fields missing');
    const certNum = 'CC-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();
    await pool.query(
      `INSERT INTO school_certificates_issued (tenant_id, student_id, certificate_type, certificate_number, details, issued_by)
       VALUES ($1,$2,'character',$3,$4,$5)`,
      [tid, student_id, certNum, JSON.stringify({ academic_performance, behavior, extracurricular }), req.session.user.id]
    );
    audit({ tenant_id: tid, action: 'generate_character_cert', entity: 'certificates', id: student_id, by: req.session.user.id });
    const student = await pool.query(`SELECT * FROM students WHERE id=$1 AND tenant_id=$2`, [student_id, tid]).then(r => r.rows[0]);
    let certHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Character Certificate</title></head>
    <body style="font-family:Georgia,serif;max-width:800px;margin:40px auto;padding:40px;border:3px solid ${COLORS.primary};">
    <div style="text-align:center;margin-bottom:40px;">
      <h1 style="color:${COLORS.primary};margin-bottom:4px;">CHARACTER CERTIFICATE</h1>
      <p style="color:${COLORS.muted};">Certificate No: ${esc(certNum)}</p>
    </div>
    <p>This is to certify that <strong>${esc(student ? student.name : '')}</strong>,
    Class <strong>${esc(student ? student.class_name : '')}</strong>,
    is a student of this institution.</p>
    <p><strong>Academic Performance:</strong> ${esc(academic_performance)}</p>
    <p><strong>Behavior:</strong> ${esc(behavior)}</p>
    ${extracurricular ? '<p><strong>Extracurricular:</strong> ' + esc(extracurricular) + '</p>' : ''}
    <p style="margin-top:40px;">Date of Issue: ${esc(new Date().toISOString().slice(0, 10))}</p>
    <div style="display:flex;justify-content:space-between;margin-top:60px;">
      <div>_________________<br>Class Teacher</div>
      <div>_________________<br>Principal</div>
    </div>
    <div style="text-align:center;margin-top:30px;">
      <button onclick="window.print()" style="padding:10px 24px;background:${COLORS.primary};color:#fff;border:none;border-radius:8px;cursor:pointer;">Print</button>
      ${btn('/school/certificates/records', 'View All Records')}
    </div></body></html>`;
    res.send(certHtml);
  }));

  app.get('/school/certificates/records', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const records = await pool.query(
      `SELECT ci.*, s.name AS student_name, s.class_name
       FROM school_certificates_issued ci
       LEFT JOIN students s ON s.id=ci.student_id AND s.tenant_id=$1
       WHERE ci.tenant_id=$1 ORDER BY ci.issued_at DESC LIMIT 100`,
      [tid]
    ).then(r => r.rows);
    let html = pageWrap('Certificate Records', `
      <div style="display:flex;gap:10px;margin-bottom:20px;">
        ${btn('/school/certificates/transfer', 'Transfer Cert', COLORS.primary)}
        ${btn('/school/certificates/leaving', 'Leaving Cert', COLORS.warning)}
        ${btn('/school/certificates/character', 'Character Cert', COLORS.success)}
      </div>
      ${card('Issued Certificates (' + records.length + ')', records.length ? `
        <table style="width:100%;border-collapse:collapse;" aria-label="Certificate records">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Cert #</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Student</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Type</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Date</th>
          </tr></thead>
          <tbody>${records.map(r => `<tr>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};font-family:monospace;font-size:0.85rem;">${esc(r.certificate_number)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(r.student_name)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${badge(COLORS.primary, r.certificate_type)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(String(r.issued_at).slice(0, 10))}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p style="color:' + COLORS.muted + ';">No certificates issued yet.</p>')}
    `);
    res.send(renderPage('cert-records', html, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     FEATURE 4 — Clubs & Societies
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/clubs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const clubs = await pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM school_club_members m WHERE m.club_id=c.id AND m.tenant_id=$1) AS member_count
       FROM school_clubs c WHERE c.tenant_id=$1 ORDER BY c.name`,
      [tid]
    ).then(r => r.rows);
    let html = pageWrap('Clubs & Societies', `
      ${btn('/school/clubs?action=create', 'Create Club', COLORS.primary)}
      ${card('All Clubs (' + clubs.length + ')', clubs.length ? `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;">
          ${clubs.map(c => `
            <div style="border:1px solid ${COLORS.border};border-radius:12px;padding:16px;cursor:pointer;" onclick="location.href='/school/clubs/${c.id}'">
              <h4 style="margin:0 0 8px;color:${COLORS.primary};">${esc(c.name)}</h4>
              <p style="margin:0 0 8px;font-size:0.85rem;color:${COLORS.muted};">${esc(String(c.description || '').slice(0, 80))}</p>
              <div style="font-size:0.8rem;color:${COLORS.muted};">
                ${c.meeting_day ? esc(c.meeting_day) + 's' : ''} ${c.venue ? '• ' + esc(c.venue) : ''}
              </div>
              <div style="margin-top:8px;">${badge(COLORS.success, c.member_count + ' members')}</div>
            </div>
          `).join('')}
        </div>` : '<p style="color:' + COLORS.muted + ';">No clubs yet. Create the first one!</p>')}
    `);
    res.send(renderPage('clubs-list', html, req));
  }));

  app.post('/school/clubs/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { name, description, patron, meeting_day, venue, max_members } = req.body;
    if (!name) return res.status(400).send('Club name is required');
    await pool.query(
      `INSERT INTO school_clubs (tenant_id, name, description, patron, meeting_day, venue, max_members)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, name, description || '', patron || '', meeting_day || '', max_members ? parseInt(max_members) : 50]
    );
    audit({ tenant_id: tid, action: 'create_club', entity: 'clubs', by: req.session.user.id });
    req.session.flash = { type: 'success', message: 'Club created successfully!' };
    res.redirect('/school/clubs');
  }));

  app.get('/school/clubs/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const clubId = req.params.id;
    const club = await pool.query(`SELECT * FROM school_clubs WHERE id=$1 AND tenant_id=$2`, [clubId, tid]).then(r => r.rows[0]);
    if (!club) return res.status(404).send('Club not found');
    const members = await pool.query(
      `SELECT m.*, s.name AS student_name FROM school_club_members m
       LEFT JOIN students s ON s.id=m.student_id AND s.tenant_id=$1
       WHERE m.club_id=$2 AND m.tenant_id=$1 ORDER BY m.joined_at`,
      [tid, clubId]
    ).then(r => r.rows);
    const students = await pool.query(`SELECT id, name FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 500`, [tid]).then(r => r.rows);
    let html = pageWrap('Club: ' + club.name, `
      ${card(club.name, `
        <p style="color:${COLORS.muted};margin-bottom:12px;">${esc(club.description || 'No description')}</p>
        <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:0.875rem;color:${COLORS.muted};">
          ${club.patron ? '<span>Patron: <strong>' + esc(club.patron) + '</strong></span>' : ''}
          ${club.meeting_day ? '<span>Meets: <strong>' + esc(club.meeting_day) + 's</strong></span>' : ''}
          ${club.venue ? '<span>Venue: <strong>' + esc(club.venue) + '</strong></span>' : ''}
          <span>Members: <strong>${members.length}/${club.max_members || '∞'}</strong></span>
        </div>
      `)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        ${card('Members (' + members.length + ')', members.length ? `
          <table style="width:100%;border-collapse:collapse;" aria-label="Club members">
            <thead><tr>
              <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Name</th>
              <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Role</th>
            </tr></thead>
            <tbody>${members.map(m => `<tr>
              <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(m.student_name)}</td>
              <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${badge(COLORS.muted, m.role)}</td>
            </tr>`).join('')}</tbody>
          </table>` : '<p style="color:' + COLORS.muted + ';">No members yet.</p>')}
        ${card('Enroll Student', `
          <form method="POST" action="/school/clubs/${clubId}/enroll">
            <label for="enroll-student" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Student</label>
            <select id="enroll-student" name="student_id" required aria-required="true"
              style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;margin-bottom:12px;box-sizing:border-box;">
              <option value="">-- Select --</option>
              ${students.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
            </select>
            ${postBtn('Enroll')}
          </form>
        `)}
      </div>
      ${btn('/school/clubs/' + clubId + '/attendance', 'Meeting Attendance', COLORS.success)}
    `);
    res.send(renderPage('club-detail', html, req));
  }));

  app.post('/school/clubs/:id/enroll', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const clubId = req.params.id;
    const { student_id } = req.body;
    if (!student_id) return res.status(400).send('Student required');
    try {
      await pool.query(
        `INSERT INTO school_club_members (tenant_id, club_id, student_id) VALUES ($1,$2,$3)`,
        [tid, clubId, student_id]
      );
      awardPoints(req.session.user.id, 5, 'Club enrollment');
    } catch (e) {
      if (e.code === '23505') return res.status(400).send('Student already enrolled');
      throw e;
    }
    res.redirect('/school/clubs/' + clubId);
  }));

  app.get('/school/clubs/:id/attendance', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const clubId = req.params.id;
    const club = await pool.query(`SELECT * FROM school_clubs WHERE id=$1 AND tenant_id=$2`, [clubId, tid]).then(r => r.rows[0]);
    if (!club) return res.status(404).send('Club not found');
    const meetings = await pool.query(
      `SELECT m.*, (SELECT COUNT(*) FROM school_club_attendance a WHERE a.meeting_id=m.id AND a.present=true) AS present_count
       FROM school_club_meetings m WHERE m.club_id=$1 AND m.tenant_id=$2 ORDER BY m.meeting_date DESC`,
      [clubId, tid]
    ).then(r => r.rows);
    let html = pageWrap('Attendance — ' + club.name, `
      ${card('Record Meeting', `
        <form method="POST" action="/school/clubs/${clubId}/attendance/record" style="max-width:500px;">
          <div style="margin-bottom:12px;">
            <label for="meeting_date" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Meeting Date</label>
            <input type="date" id="meeting_date" name="meeting_date" required aria-required="true" value="${new Date().toISOString().slice(0, 10)}"
              style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
          </div>
          <div style="margin-bottom:12px;">
            <label for="agenda" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Agenda</label>
            <textarea id="agenda" name="agenda" rows="2" style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;"></textarea>
          </div>
          ${postBtn('Record Attendance')}
        </form>
      `)}
      ${card('Meeting History', meetings.length ? `
        <table style="width:100%;border-collapse:collapse;" aria-label="Club meeting history">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Date</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Agenda</th>
            <th scope="col" style="text-align:right;padding:8px;border-bottom:2px solid ${COLORS.primary};">Present</th>
          </tr></thead>
          <tbody>${meetings.map(m => `<tr>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(String(m.meeting_date).slice(0, 10))}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(String(m.agenda || '').slice(0, 60))}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};text-align:right;">${m.present_count}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p style="color:' + COLORS.muted + ';">No meetings recorded.</p>')}
      ${btn('/school/clubs/' + clubId, 'Back to Club')}
    `);
    res.send(renderPage('club-attendance', html, req));
  }));

  app.post('/school/clubs/:id/attendance/record', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const clubId = req.params.id;
    const { meeting_date, agenda } = req.body;
    if (!meeting_date) return res.status(400).send('Date required');
    const meeting = await pool.query(
      `INSERT INTO school_club_meetings (tenant_id, club_id, meeting_date, agenda) VALUES ($1,$2,$3,$4) RETURNING id`,
      [tid, clubId, meeting_date, agenda || '']
    ).then(r => r.rows[0]);
    const members = await pool.query(
      `SELECT student_id FROM school_club_members WHERE club_id=$1 AND tenant_id=$2`,
      [clubId, tid]
    ).then(r => r.rows);
    for (const m of members) {
      const present = req.body['present_' + m.student_id] === 'on';
      await pool.query(
        `INSERT INTO school_club_attendance (tenant_id, meeting_id, student_id, present) VALUES ($1,$2,$3,$4)`,
        [tid, meeting.id, m.student_id, present]
      );
    }
    audit({ tenant_id: tid, action: 'club_attendance', entity: 'clubs', id: clubId, by: req.session.user.id });
    res.redirect('/school/clubs/' + clubId + '/attendance');
  }));

  /* ═══════════════════════════════════════════════════════════════════
     FEATURE 5 — Field Trip Management
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/field-trips', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const trips = await pool.query(
      `SELECT ft.*, (SELECT COUNT(*) FROM field_trip_participants p WHERE p.trip_id=ft.id AND p.tenant_id=$1) AS signup_count
       FROM school_field_trips ft WHERE ft.tenant_id=$1 ORDER BY ft.trip_date DESC`,
      [tid]
    ).then(r => r.rows);
    let html = pageWrap('Field Trips', `
      ${btn('/school/field-trips?action=create', 'Plan Trip', COLORS.primary)}
      ${card('All Trips (' + trips.length + ')', trips.length ? `
        <table style="width:100%;border-collapse:collapse;" aria-label="Field trips list">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Destination</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Date</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Class</th>
            <th scope="col" style="text-align:right;padding:8px;border-bottom:2px solid ${COLORS.primary};">Cost</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Status</th>
            <th scope="col" style="text-align:right;padding:8px;border-bottom:2px solid ${COLORS.primary};">Signups</th>
          </tr></thead>
          <tbody>${trips.map(t => `<tr>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};"><a href="/school/field-trips/${t.id}" style="color:${COLORS.primary};text-decoration:none;font-weight:600;">${esc(t.destination)}</a></td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(String(t.trip_date).slice(0, 10))}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(t.target_class || 'All')}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};text-align:right;">$${Number(t.cost).toFixed(2)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${badge(t.status === 'active' ? COLORS.success : t.status === 'cancelled' ? COLORS.danger : COLORS.warning, t.status)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};text-align:right;">${t.signup_count}/${t.max_participants}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p style="color:' + COLORS.muted + ';">No trips planned.</p>')}
    `);
    res.send(renderPage('field-trips', html, req));
  }));

  app.post('/school/field-trips/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { destination, trip_date, target_class, cost, teacher_in_charge, description, max_participants } = req.body;
    if (!destination || !trip_date) return res.status(400).send('Destination and date required');
    await pool.query(
      `INSERT INTO school_field_trips (tenant_id, destination, trip_date, target_class, cost, teacher_in_charge, description, max_participants)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, destination, trip_date, target_class || '', cost || 0, teacher_in_charge || '', description || '', max_participants || 60]
    );
    audit({ tenant_id: tid, action: 'create_field_trip', entity: 'field_trips', by: req.session.user.id });
    req.session.flash = { type: 'success', message: 'Trip planned successfully!' };
    res.redirect('/school/field-trips');
  }));

  app.get('/school/field-trips/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const trip = await pool.query(`SELECT * FROM school_field_trips WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]).then(r => r.rows[0]);
    if (!trip) return res.status(404).send('Trip not found');
    const participants = await pool.query(
      `SELECT p.*, s.name AS student_name FROM field_trip_participants p
       LEFT JOIN students s ON s.id=p.student_id AND s.tenant_id=$1
       WHERE p.trip_id=$2 AND p.tenant_id=$1`,
      [tid, req.params.id]
    ).then(r => r.rows);
    const students = await pool.query(`SELECT id, name FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 500`, [tid]).then(r => r.rows);
    let html = pageWrap('Field Trip: ' + trip.destination, `
      ${card(trip.destination, `
        <p>${esc(trip.description || 'No description provided.')}</p>
        <div style="display:flex;gap:16px;flex-wrap:wrap;margin-top:12px;font-size:0.875rem;">
          <span>Date: <strong>${esc(String(trip.trip_date).slice(0, 10))}</strong></span>
          <span>Class: <strong>${esc(trip.target_class || 'All')}</strong></span>
          <span>Cost: <strong>$${Number(trip.cost).toFixed(2)}</strong></span>
          <span>In-Charge: <strong>${esc(trip.teacher_in_charge || 'TBD')}</strong></span>
          <span>Status: ${badge(trip.status === 'active' ? COLORS.success : COLORS.warning, trip.status)}</span>
        </div>
      `)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        ${card('Participants (' + participants.length + ')', participants.length ? `
          <table style="width:100%;border-collapse:collapse;" aria-label="Trip participants">
            <thead><tr>
              <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Student</th>
              <th scope="col" style="text-align:center;padding:8px;border-bottom:2px solid ${COLORS.primary};">Consent</th>
              <th scope="col" style="text-align:center;padding:8px;border-bottom:2px solid ${COLORS.primary};">Paid</th>
            </tr></thead>
            <tbody>${participants.map(p => `<tr>
              <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(p.student_name)}</td>
              <td style="padding:8px;border-bottom:1px solid ${COLORS.border};text-align:center;">${p.parent_consent ? badge(COLORS.success, 'Yes') : badge(COLORS.danger, 'No')}</td>
              <td style="padding:8px;border-bottom:1px solid ${COLORS.border};text-align:center;">${p.paid ? badge(COLORS.success, 'Yes') : badge(COLORS.warning, 'No')}</td>
            </tr>`).join('')}</tbody>
          </table>` : '<p style="color:' + COLORS.muted + ';">No signups yet.</p>')}
        ${card('Student Signup', `
          <form method="POST" action="/school/field-trips/${trip.id}/signup">
            <label for="trip-student" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Student</label>
            <select id="trip-student" name="student_id" required aria-required="true"
              style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;margin-bottom:12px;box-sizing:border-box;">
              <option value="">-- Select --</option>
              ${students.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
            </select>
            ${postBtn('Sign Up')}
          </form>
        `)}
      </div>
      ${btn('/school/field-trips', 'Back to Trips')}
    `);
    res.send(renderPage('field-trip-detail', html, req));
  }));

  app.post('/school/field-trips/:id/signup', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const tripId = req.params.id;
    const { student_id } = req.body;
    if (!student_id) return res.status(400).send('Student required');
    try {
      await pool.query(
        `INSERT INTO field_trip_participants (tenant_id, trip_id, student_id) VALUES ($1,$2,$3)`,
        [tid, tripId, student_id]
      );
    } catch (e) {
      if (e.code === '23505') return res.status(400).send('Already signed up');
      throw e;
    }
    res.redirect('/school/field-trips/' + tripId);
  }));

  app.post('/school/field-trips/:id/permission', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const tripId = req.params.id;
    const { student_id, parent_consent } = req.body;
    if (!student_id) return res.status(400).send('Student required');
    await pool.query(
      `UPDATE field_trip_participants SET parent_consent=$1 WHERE trip_id=$2 AND student_id=$3 AND tenant_id=$4`,
      [parent_consent === 'on', tripId, student_id, tid]
    );
    if (parent_consent === 'on') {
      const trip = await pool.query(`SELECT * FROM school_field_trips WHERE id=$1 AND tenant_id=$2`, [tripId, tid]).then(r => r.rows[0]);
      if (trip) {
        const student = await pool.query(`SELECT name FROM students WHERE id=$1 AND tenant_id=$2`, [student_id, tid]).then(r => r.rows[0]);
        queueEmail({ tenant_id: tid, to: student_id, subject: 'Field Trip Permission: ' + trip.destination, body: 'Permission confirmed for ' + (student ? student.name : '') });
      }
    }
    res.redirect('/school/field-trips/' + tripId);
  }));

  /* ═══════════════════════════════════════════════════════════════════
     FEATURE 6 — School Counselling
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/counselling', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const sessions = await pool.query(
      `SELECT cs.*, s.name AS student_name, st.name AS counsellor_name
       FROM school_counselling_sessions cs
       LEFT JOIN students s ON s.id=cs.student_id AND s.tenant_id=$1
       LEFT JOIN staff st ON st.id=cs.counsellor_id AND st.tenant_id=$1
       WHERE cs.tenant_id=$1 ORDER BY cs.session_date DESC LIMIT 50`,
      [tid]
    ).then(r => r.rows);
    const students = await pool.query(`SELECT id, name FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 500`, [tid]).then(r => r.rows);
    let html = pageWrap('School Counselling', `
      ${btn('/school/counselling/stats', 'View Statistics', COLORS.success)}
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;">
        ${card('Record Session', `
          <form method="POST" action="/school/counselling/record" style="max-width:500px;">
            <div style="margin-bottom:12px;">
              <label for="cs-student" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Student</label>
              <select id="cs-student" name="student_id" required aria-required="true"
                style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
                <option value="">-- Select --</option>
                ${students.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
              </select>
            </div>
            <div style="margin-bottom:12px;">
              <label for="cs-date" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Session Date</label>
              <input type="date" id="cs-date" name="session_date" required aria-required="true" value="${new Date().toISOString().slice(0, 10)}"
                style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
              <label for="cs-type" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Type</label>
              <select id="cs-type" name="session_type" required
                style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
                <option value="academic">Academic</option>
                <option value="behavioral">Behavioral</option>
                <option value="emotional">Emotional</option>
                <option value="career">Career</option>
              </select>
            </div>
            <div style="margin-bottom:12px;">
              <label for="cs-notes" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Notes</label>
              <textarea id="cs-notes" name="notes" rows="3" style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;"></textarea>
            </div>
            <div style="margin-bottom:12px;">
              <label for="cs-followup" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Follow-up Date</label>
              <input type="date" id="cs-followup" name="follow_up_date"
                style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px;">
              <input type="checkbox" id="cs-confidential" name="confidential">
              <label for="cs-confidential" style="font-size:0.85rem;">Confidential</label>
            </div>
            ${postBtn('Record Session')}
          </form>
        `)}
        ${card('Recent Sessions (' + sessions.length + ')', sessions.length ? sessions.slice(0, 10).map(s => `
          <div style="padding:8px 0;border-bottom:1px solid ${COLORS.border};">
            <a href="/school/counselling/student/${s.student_id}" style="color:${COLORS.primary};text-decoration:none;font-weight:600;">${esc(s.student_name)}</a>
            <span style="margin-left:8px;">${badge(COLORS.primary, s.session_type)} ${badge(s.status === 'open' ? COLORS.warning : COLORS.success, s.status)}</span>
            ${s.confidential ? badge(COLORS.danger, 'Confidential') : ''}
            <div style="font-size:0.8rem;color:${COLORS.muted};margin-top:2px;">${esc(String(s.session_date).slice(0, 10))} ${s.notes ? '— ' + esc(String(s.notes).slice(0, 50)) : ''}</div>
          </div>
        `).join('') : '<p style="color:' + COLORS.muted + ';">No sessions recorded.</p>')}
      </div>
    `);
    res.send(renderPage('counselling', html, req));
  }));

  app.post('/school/counselling/record', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { student_id, session_date, session_type, notes, follow_up_date, confidential } = req.body;
    if (!student_id || !session_date || !session_type) return res.status(400).send('Student, date, and type are required');
    await pool.query(
      `INSERT INTO school_counselling_sessions (tenant_id, student_id, counsellor_id, session_date, session_type, notes, follow_up_date, confidential)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, student_id, req.session.user.id, session_date, session_type, notes || '', follow_up_date || null, confidential === 'on']
    );
    audit({ tenant_id: tid, action: 'counselling_session', entity: 'counselling', id: student_id, by: req.session.user.id });
    req.session.flash = { type: 'success', message: 'Session recorded.' };
    res.redirect('/school/counselling');
  }));

  app.get('/school/counselling/student/:studentId', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const studentId = req.params.studentId;
    const student = await pool.query(`SELECT * FROM students WHERE id=$1 AND tenant_id=$2`, [studentId, tid]).then(r => r.rows[0]);
    if (!student) return res.status(404).send('Student not found');
    const sessions = await pool.query(
      `SELECT * FROM school_counselling_sessions WHERE student_id=$1 AND tenant_id=$2 ORDER BY session_date DESC`,
      [studentId, tid]
    ).then(r => r.rows);
    let html = pageWrap('Counselling — ' + student.name, `
      ${card('Session History (' + sessions.length + ')', sessions.length ? `
        <table style="width:100%;border-collapse:collapse;" aria-label="Counselling sessions for student">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Date</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Type</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Notes</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Follow-up</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Status</th>
          </tr></thead>
          <tbody>${sessions.map(s => `<tr>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(String(s.session_date).slice(0, 10))}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${badge(COLORS.primary, s.session_type)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};font-size:0.85rem;max-width:300px;">${s.confidential ? '<em>Confidential</em>' : esc(String(s.notes || '').slice(0, 80))}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${s.follow_up_date ? esc(String(s.follow_up_date).slice(0, 10)) : '—'}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${badge(s.status === 'open' ? COLORS.warning : COLORS.success, s.status)}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p style="color:' + COLORS.muted + ';">No counselling sessions.</p>')}
      ${btn('/school/counselling', 'Back to Counselling')}
    `);
    res.send(renderPage('counselling-student', html, req));
  }));

  app.get('/school/counselling/stats', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const typeStats = await pool.query(
      `SELECT session_type, COUNT(*) AS cnt FROM school_counselling_sessions WHERE tenant_id=$1 GROUP BY session_type ORDER BY cnt DESC`,
      [tid]
    ).then(r => r.rows);
    const monthStats = await pool.query(
      `SELECT TO_CHAR(session_date, 'YYYY-MM') AS month, COUNT(*) AS cnt
       FROM school_counselling_sessions WHERE tenant_id=$1 GROUP BY month ORDER BY month`,
      [tid]
    ).then(r => r.rows);

    // SVG Bar Chart — Sessions by Type
    const maxCnt = Math.max(...typeStats.map(t => Number(t.cnt)), 1);
    const barColors = { academic: COLORS.primary, behavioral: COLORS.warning, emotional: COLORS.danger, career: COLORS.success };
    let barsSvg = typeStats.map((t, i) => {
      const h = (Number(t.cnt) / maxCnt) * 160;
      const x = 40 + i * 70;
      return `<rect x="${x}" y="${180 - h}" width="50" height="${h}" fill="${barColors[t.session_type] || COLORS.primary}" rx="4"/>
        <text x="${x + 25}" y="200" text-anchor="middle" font-size="11" fill="${COLORS.text}">${esc(t.session_type).slice(0, 5)}</text>
        <text x="${x + 25}" y="${175 - h}" text-anchor="middle" font-size="12" font-weight="bold" fill="${COLORS.text}">${t.cnt}</text>`;
    }).join('');

    // SVG Line Chart — Sessions by Month
    const maxMonth = Math.max(...monthStats.map(m => Number(m.cnt)), 1);
    const chartW = Math.max(monthStats.length * 60 + 80, 300);
    let points = monthStats.map((m, i) => {
      const x = 40 + i * 60;
      const y = 180 - (Number(m.cnt) / maxMonth) * 160;
      return `${x},${y}`;
    }).join(' ');
    let monthLabels = monthStats.map((m, i) =>
      `<text x="${40 + i * 60}" y="200" text-anchor="middle" font-size="10" fill="${COLORS.muted}">${esc(m.month || '')}</text>`
    ).join('');

    let html = pageWrap('Counselling Statistics', `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        ${card('Sessions by Type', `
          <svg width="350" height="220" aria-label="Bar chart of sessions by type" role="img">
            ${barsSvg}
            <line x1="40" y1="180" x2="${40 + typeStats.length * 70}" y2="180" stroke="${COLORS.border}" stroke-width="1"/>
          </svg>
        `)}
        ${card('Sessions by Month', `
          <svg width="${chartW}" height="220" aria-label="Line chart of sessions by month" role="img">
            <line x1="40" y1="180" x2="${chartW - 20}" y2="180" stroke="${COLORS.border}" stroke-width="1"/>
            ${monthLabels}
            ${points ? `<polyline points="${points}" fill="none" stroke="${COLORS.primary}" stroke-width="2.5"/>
            ${monthStats.map((m, i) => {
              const x = 40 + i * 60;
              const y = 180 - (Number(m.cnt) / maxMonth) * 160;
              return `<circle cx="${x}" cy="${y}" r="4" fill="${COLORS.primary}"/><text x="${x}" y="${y - 8}" text-anchor="middle" font-size="11" fill="${COLORS.text}">${m.cnt}</text>`;
            }).join('')}` : '<text x="120" y="100" fill="' + COLORS.muted + '">No data</text>'}
          </svg>
        `)}
      </div>
      ${card('Summary', `
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
          <div style="text-align:center;padding:16px;background:${COLORS.primary}11;border-radius:8px;">
            <div style="font-size:1.5rem;font-weight:700;">${typeStats.reduce((a, t) => a + Number(t.cnt), 0)}</div>
            <div style="font-size:0.8rem;color:${COLORS.muted};">Total Sessions</div>
          </div>
          <div style="text-align:center;padding:16px;background:${COLORS.warning}11;border-radius:8px;">
            <div style="font-size:1.5rem;font-weight:700;">${typeStats.length}</div>
            <div style="font-size:0.8rem;color:${COLORS.muted};">Session Types</div>
          </div>
          <div style="text-align:center;padding:16px;background:${COLORS.success}11;border-radius:8px;">
            <div style="font-size:1.5rem;font-weight:700;">${monthStats.length}</div>
            <div style="font-size:0.8rem;color:${COLORS.muted};">Active Months</div>
          </div>
        </div>
      `)}
      ${btn('/school/counselling', 'Back to Counselling')}
    `);
    res.send(renderPage('counselling-stats', html, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     FEATURE 7 — Special Needs Tracking
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/special-needs', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const needs = await pool.query(
      `SELECT sn.*, s.name AS student_name, s.class_name FROM school_special_needs sn
       LEFT JOIN students s ON s.id=sn.student_id AND s.tenant_id=$1
       WHERE sn.tenant_id=$1 ORDER BY sn.created_at DESC`,
      [tid]
    ).then(r => r.rows);
    const students = await pool.query(`SELECT id, name FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 500`, [tid]).then(r => r.rows);
    const sevColors = { mild: COLORS.success, moderate: COLORS.warning, severe: COLORS.danger };
    let html = pageWrap('Special Needs Tracking', `
      ${btn('/school/special-needs/accommodations', 'Accommodations Guide', '#7c3aed')}
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;">
        ${card('Register Student', `
          <form method="POST" action="/school/special-needs/register" style="max-width:500px;">
            <div style="margin-bottom:12px;">
              <label for="sn-student" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Student</label>
              <select id="sn-student" name="student_id" required aria-required="true"
                style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
                <option value="">-- Select --</option>
                ${students.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
              </select>
            </div>
            <div style="margin-bottom:12px;">
              <label for="sn-type" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Need Type</label>
              <select id="sn-type" name="need_type" required
                style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
                <option value="physical">Physical</option><option value="learning">Learning</option>
                <option value="behavioral">Behavioral</option><option value="visual">Visual</option>
                <option value="hearing">Hearing</option><option value="speech">Speech</option>
              </select>
            </div>
            <div style="margin-bottom:12px;">
              <label for="sn-severity" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Severity</label>
              <select id="sn-severity" name="severity" required
                style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
                <option value="mild">Mild</option><option value="moderate">Moderate</option><option value="severe">Severe</option>
              </select>
            </div>
            <div style="margin-bottom:12px;">
              <label for="sn-accommodations" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Accommodations (comma-separated)</label>
              <input type="text" id="sn-accommodations" name="accommodations"
                placeholder="Extra time, preferential seating, enlarged text"
                style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
            </div>
            <div style="margin-bottom:12px;">
              <label for="sn-iep" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">IEP Notes</label>
              <textarea id="sn-iep" name="iep_notes" rows="2" style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;"></textarea>
            </div>
            ${postBtn('Register')}
          </form>
        `)}
        ${card('Registered Students (' + needs.length + ')', needs.length ? needs.map(n => `
          <div style="padding:8px 0;border-bottom:1px solid ${COLORS.border};">
            <a href="/school/special-needs/${n.id}" style="color:${COLORS.primary};text-decoration:none;font-weight:600;">${esc(n.student_name)}</a>
            <span style="margin-left:8px;">${badge(COLORS.primary, n.need_type)} ${badge(sevColors[n.severity] || COLORS.muted, n.severity)}</span>
            <div style="font-size:0.8rem;color:${COLORS.muted};">${esc(n.class_name || '')}</div>
          </div>
        `).join('') : '<p style="color:' + COLORS.muted + ';">No students registered.</p>')}
      </div>
    `);
    res.send(renderPage('special-needs', html, req));
  }));

  app.post('/school/special-needs/register', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { student_id, need_type, severity, accommodations, iep_notes } = req.body;
    if (!student_id || !need_type || !severity) return res.status(400).send('Student, type, and severity required');
    const accArray = accommodations ? accommodations.split(',').map(s => s.trim()).filter(Boolean) : [];
    await pool.query(
      `INSERT INTO school_special_needs (tenant_id, student_id, need_type, severity, accommodations, iep_notes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, student_id, need_type, severity, JSON.stringify(accArray), iep_notes || '']
    );
    audit({ tenant_id: tid, action: 'register_special_need', entity: 'special_needs', id: student_id, by: req.session.user.id });
    req.session.flash = { type: 'success', message: 'Student registered for special needs support.' };
    res.redirect('/school/special-needs');
  }));

  app.get('/school/special-needs/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const need = await pool.query(
      `SELECT sn.*, s.name AS student_name, s.class_name FROM school_special_needs sn
       LEFT JOIN students s ON s.id=sn.student_id AND s.tenant_id=$1
       WHERE sn.id=$2 AND sn.tenant_id=$1`,
      [tid, req.params.id]
    ).then(r => r.rows[0]);
    if (!need) return res.status(404).send('Record not found');
    const services = await pool.query(
      `SELECT * FROM special_needs_services WHERE special_need_id=$1 AND tenant_id=$2 ORDER BY service_date DESC`,
      [req.params.id, tid]
    ).then(r => r.rows);
    const accommodations = Array.isArray(need.accommodations) ? need.accommodations : [];
    let html = pageWrap('Special Needs — ' + need.student_name, `
      ${card(need.student_name, `
        <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:12px;">
          ${badge(COLORS.primary, need.need_type)}
          ${badge(need.severity === 'severe' ? COLORS.danger : need.severity === 'moderate' ? COLORS.warning : COLORS.success, need.severity)}
          ${badge(COLORS.muted, need.status)}
        </div>
        <div style="margin-bottom:12px;">
          <strong>Class:</strong> ${esc(need.class_name || 'N/A')}<br>
          <strong>Diagnosed:</strong> ${esc(String(need.diagnosed_date || '').slice(0, 10)) || 'N/A'}
        </div>
        ${accommodations.length ? `<div style="margin-bottom:12px;"><strong>Accommodations:</strong>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:4px;">
            ${accommodations.map(a => badge('#7c3aed', a)).join('')}
          </div>
        </div>` : ''}
        ${need.iep_notes ? '<p><strong>IEP Notes:</strong> ' + esc(need.iep_notes) + '</p>' : ''}
      `)}
      ${card('Support Services', `
        <form method="POST" action="/school/special-needs/${need.id}/service" style="margin-bottom:16px;">
          <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:end;">
            <div>
              <label for="svc-type" style="display:block;font-size:0.8rem;margin-bottom:2px;">Type</label>
              <input type="text" id="svc-type" name="service_type" required placeholder="e.g. Speech Therapy"
                style="padding:6px;border:1px solid ${COLORS.border};border-radius:6px;">
            </div>
            <div>
              <label for="svc-provider" style="display:block;font-size:0.8rem;margin-bottom:2px;">Provider</label>
              <input type="text" id="svc-provider" name="provider"
                style="padding:6px;border:1px solid ${COLORS.border};border-radius:6px;">
            </div>
            <div>
              <label for="svc-date" style="display:block;font-size:0.8rem;margin-bottom:2px;">Date</label>
              <input type="date" id="svc-date" name="service_date" value="${new Date().toISOString().slice(0, 10)}"
                style="padding:6px;border:1px solid ${COLORS.border};border-radius:6px;">
            </div>
            ${postBtn('Add Service', COLORS.success)}
          </div>
        </form>
        ${services.length ? `<table style="width:100%;border-collapse:collapse;" aria-label="Support services">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Date</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Service</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Provider</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Notes</th>
          </tr></thead>
          <tbody>${services.map(sv => `<tr>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(String(sv.service_date || '').slice(0, 10))}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(sv.service_type)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(sv.provider || '')}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};font-size:0.85rem;">${esc(String(sv.notes || '').slice(0, 60))}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p style="color:' + COLORS.muted + ';">No services recorded.</p>'}
      `)}
      ${btn('/school/special-needs', 'Back to List')}
    `);
    res.send(renderPage('special-needs-detail', html, req));
  }));

  app.post('/school/special-needs/:id/service', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { service_type, provider, service_date, notes } = req.body;
    if (!service_type) return res.status(400).send('Service type required');
    await pool.query(
      `INSERT INTO special_needs_services (tenant_id, special_need_id, service_type, provider, service_date, notes)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, req.params.id, service_type, provider || '', service_date || null, notes || '']
    );
    res.redirect('/school/special-needs/' + req.params.id);
  }));

  app.get('/school/special-needs/accommodations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const records = await pool.query(
      `SELECT sn.*, s.name AS student_name, s.class_name, c.name AS class_teacher
       FROM school_special_needs sn
       LEFT JOIN students s ON s.id=sn.student_id AND s.tenant_id=$1
       LEFT JOIN staff c ON c.id=s.class_teacher_id AND c.tenant_id=$1
       WHERE sn.tenant_id=$1 AND sn.status='active' ORDER BY sn.severity DESC`,
      [tid]
    ).then(r => r.rows);
    let html = pageWrap('Accommodations Overview', `
      ${card('Active Accommodations (' + records.length + ')', `
        <p style="color:${COLORS.muted};margin-bottom:16px;font-size:0.9rem;">This view shows teachers which students need accommodations in their classes.</p>
        ${records.length ? `<table style="width:100%;border-collapse:collapse;" aria-label="Student accommodations">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Student</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Class</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Type</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Severity</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Accommodations</th>
          </tr></thead>
          <tbody>${records.map(r => {
            const accs = Array.isArray(r.accommodations) ? r.accommodations : [];
            const sevColors = { mild: COLORS.success, moderate: COLORS.warning, severe: COLORS.danger };
            return `<tr>
              <td style="padding:8px;border-bottom:1px solid ${COLORS.border};font-weight:600;">${esc(r.student_name)}</td>
              <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(r.class_name || '')}</td>
              <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${badge(COLORS.primary, r.need_type)}</td>
              <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${badge(sevColors[r.severity] || COLORS.muted, r.severity)}</td>
              <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${accs.map(a => badge('#7c3aed', a)).join(' ')}</td>
            </tr>`;
          }).join('')}</tbody>
        </table>` : '<p style="color:' + COLORS.muted + ';">No active accommodations.</p>'}
      `)}
      ${btn('/school/special-needs', 'Back to Special Needs')}
    `);
    res.send(renderPage('accommodations', html, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     FEATURE 8 — Academic Terms
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/terms', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const terms = await pool.query(
      `SELECT *, CASE WHEN end_date >= CURRENT_DATE THEN
        ROUND((CURRENT_DATE - start_date)::numeric / GREATEST((end_date - start_date)::numeric, 1) * 100, 1)
        ELSE 100 END AS progress
       FROM academic_terms WHERE tenant_id=$1 ORDER BY start_date DESC`,
      [tid]
    ).then(r => r.rows);
    const current = terms.find(t => t.is_current);
    let html = pageWrap('Academic Terms', `
      ${badge(current ? COLORS.success : COLORS.danger, current ? 'Current: ' + current.name : 'No Current Term')}
      <div style="margin:12px 0 20px;">
        ${btn('#', 'Create Term', COLORS.primary)} ${/* Triggered via form below */
        ''}
      </div>
      <form method="POST" action="/school/terms/create" style="margin-bottom:20px;max-width:600px;">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;align-items:end;">
          <div>
            <label for="term-name" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Term Name</label>
            <input type="text" id="term-name" name="name" required placeholder="Term 1"
              style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
          </div>
          <div>
            <label for="term-start" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Start Date</label>
            <input type="date" id="term-start" name="start_date" required
              style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
          </div>
          <div>
            <label for="term-end" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">End Date</label>
            <input type="date" id="term-end" name="end_date" required
              style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
          </div>
          <div>
            <label for="term-year" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Year</label>
            <input type="text" id="term-year" name="academic_year" placeholder="2024-2025"
              style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
          </div>
          <div style="grid-column:span 2;">
            ${postBtn('Create Term')}
          </div>
        </div>
      </form>
      ${card('All Terms (' + terms.length + ')', terms.length ? terms.map(t => {
        const prog = Number(t.progress) || 0;
        const progColor = prog >= 100 ? COLORS.success : COLORS.primary;
        return `<div style="border:1px solid ${COLORS.border};border-radius:8px;padding:16px;margin-bottom:12px;${t.is_current ? 'border-left:4px solid ' + COLORS.primary + ';' : ''}">
          <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
            <div>
              <h4 style="margin:0 0 4px;">${esc(t.name)} ${t.is_current ? badge(COLORS.primary, 'Current') : ''}</h4>
              <div style="font-size:0.85rem;color:${COLORS.muted};">${esc(String(t.start_date).slice(0, 10))} — ${esc(String(t.end_date).slice(0, 10))} ${t.academic_year ? '(' + esc(t.academic_year) + ')' : ''}</div>
            </div>
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="width:120px;">
                <div style="font-size:0.75rem;color:${COLORS.muted};margin-bottom:2px;">Progress: ${prog}%</div>
                <div style="background:${COLORS.border};border-radius:99px;height:8px;overflow:hidden;">
                  <div style="height:100%;width:${Math.min(prog, 100)}%;background:${progColor};border-radius:99px;transition:width 0.3s;"></div>
                </div>
              </div>
              ${!t.is_current ? `<form method="POST" action="/school/terms/${t.id}/set-current" style="display:inline;">
                <button type="submit" style="padding:4px 12px;border-radius:6px;background:${COLORS.success};color:#fff;border:none;cursor:pointer;font-size:0.8rem;">Set Current</button>
              </form>` : ''}
            </div>
          </div>
        </div>`;
      }).join('') : '<p style="color:' + COLORS.muted + ';">No terms defined.</p>')}
    `);
    res.send(renderPage('terms', html, req));
  }));

  app.post('/school/terms/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { name, start_date, end_date, academic_year } = req.body;
    if (!name || !start_date || !end_date) return res.status(400).send('Name, start and end dates required');
    await pool.query(
      `INSERT INTO academic_terms (tenant_id, name, start_date, end_date, academic_year) VALUES ($1,$2,$3,$4,$5)`,
      [tid, name, start_date, end_date, academic_year || '']
    );
    audit({ tenant_id: tid, action: 'create_term', entity: 'academic_terms', by: req.session.user.id });
    req.session.flash = { type: 'success', message: 'Term created!' };
    res.redirect('/school/terms');
  }));

  app.post('/school/terms/:id/set-current', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`UPDATE academic_terms SET is_current=false WHERE tenant_id=$1`, [tid]);
      await client.query(`UPDATE academic_terms SET is_current=true WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    audit({ tenant_id: tid, action: 'set_current_term', entity: 'academic_terms', id: req.params.id, by: req.session.user.id });
    res.redirect('/school/terms');
  }));

  /* ═══════════════════════════════════════════════════════════════════
     FEATURE 9 — School Newsletter
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/newsletter', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const newsletters = await pool.query(
      `SELECT n.*, u.name AS author FROM school_newsletters n
       LEFT JOIN users u ON u.id=n.created_by
       WHERE n.tenant_id=$1 ORDER BY n.created_at DESC LIMIT 50`,
      [tid]
    ).then(r => r.rows);
    const statusColors = { draft: COLORS.muted, published: COLORS.success, sent: COLORS.primary };
    let html = pageWrap('School Newsletter', `
      ${btn('/school/newsletter?action=create', 'Create Newsletter', COLORS.primary)}
      ${btn('/school/newsletter/archive', 'Archive', COLORS.warning)}
      ${card('Newsletters (' + newsletters.length + ')', newsletters.length ? `
        <table style="width:100%;border-collapse:collapse;" aria-label="Newsletters list">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Title</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Audience</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Status</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Author</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Created</th>
          </tr></thead>
          <tbody>${newsletters.map(n => `<tr>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};"><a href="/school/newsletter/${n.id}" style="color:${COLORS.primary};text-decoration:none;font-weight:600;">${esc(n.title)}</a></td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${badge(COLORS.muted, n.target_audience)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${badge(statusColors[n.status] || COLORS.muted, n.status)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(n.author || 'System')}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(String(n.created_at).slice(0, 10))}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p style="color:' + COLORS.muted + ';">No newsletters yet.</p>')}
    `);
    res.send(renderPage('newsletter', html, req));
  }));

  app.post('/school/newsletter/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { title, content, target_audience, status } = req.body;
    if (!title) return res.status(400).send('Title is required');
    const result = await pool.query(
      `INSERT INTO school_newsletters (tenant_id, title, content, target_audience, status, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tid, title, content || '', target_audience || 'all', status || 'draft', req.session.user.id]
    ).then(r => r.rows[0]);
    audit({ tenant_id: tid, action: 'create_newsletter', entity: 'newsletters', id: result.id, by: req.session.user.id });
    res.redirect('/school/newsletter/' + result.id);
  }));

  app.get('/school/newsletter/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const nl = await pool.query(`SELECT * FROM school_newsletters WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]).then(r => r.rows[0]);
    if (!nl) return res.status(404).send('Newsletter not found');
    let html = pageWrap('Newsletter: ' + nl.title, `
      ${card(nl.title, `
        <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap;">
          ${badge(COLORS.muted, nl.target_audience)}
          ${badge(nl.status === 'published' ? COLORS.success : nl.status === 'sent' ? COLORS.primary : COLORS.warning, nl.status)}
          ${nl.sent_at ? '<span style="font-size:0.8rem;color:' + COLORS.muted + ';">Sent: ' + esc(String(nl.sent_at).slice(0, 16)) + '</span>' : ''}
        </div>
        <div style="border-top:1px solid ${COLORS.border};padding-top:16px;line-height:1.7;">
          ${nl.content || '<p style="color:' + COLORS.muted + ';">No content yet.</p>'}
        </div>
      `)}
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        ${nl.status !== 'sent' ? `<form method="POST" action="/school/newsletter/${nl.id}/send" style="display:inline;">
          ${postBtn('Send to ' + nl.target_audience, COLORS.success)}
        </form>` : ''}
        ${btn('/school/newsletter', 'Back to List')}
      </div>
    `);
    res.send(renderPage('newsletter-view', html, req));
  }));

  app.post('/school/newsletter/:id/send', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const nlId = req.params.id;
    const nl = await pool.query(`SELECT * FROM school_newsletters WHERE id=$1 AND tenant_id=$2`, [nlId, tid]).then(r => r.rows[0]);
    if (!nl) return res.status(404).send('Newsletter not found');

    let recipientQuery;
    if (nl.target_audience === 'parents') {
      recipientQuery = `SELECT u.id, u.email FROM users u JOIN students s ON s.parent_id=u.id AND s.tenant_id=$1 WHERE u.tenant_id=$1`;
    } else if (nl.target_audience === 'staff') {
      recipientQuery = `SELECT u.id, u.email FROM users u JOIN staff st ON st.user_id=u.id AND st.tenant_id=$1 WHERE u.tenant_id=$1`;
    } else if (nl.target_audience === 'students') {
      recipientQuery = `SELECT u.id, u.email FROM users u JOIN students s ON s.user_id=u.id AND s.tenant_id=$1 WHERE u.tenant_id=$1`;
    } else {
      recipientQuery = `SELECT id, email FROM users WHERE tenant_id=$1 AND email IS NOT NULL`;
    }

    const recipients = await pool.query(recipientQuery, [tid]).then(r => r.rows);
    for (const r of recipients) {
      queueEmail({ tenant_id: tid, to: r.id, subject: nl.title, body: nl.content || '' });
    }

    await pool.query(
      `UPDATE school_newsletters SET status='sent', sent_at=now() WHERE id=$1 AND tenant_id=$2`,
      [nlId, tid]
    );
    audit({ tenant_id: tid, action: 'send_newsletter', entity: 'newsletters', id: nlId, by: req.session.user.id });
    req.session.flash = { type: 'success', message: 'Newsletter sent to ' + recipients.length + ' recipients!' };
    res.redirect('/school/newsletter/' + nlId);
  }));

  app.get('/school/newsletter/archive', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const newsletters = await pool.query(
      `SELECT * FROM school_newsletters WHERE tenant_id=$1 AND status='sent' ORDER BY sent_at DESC`,
      [tid]
    ).then(r => r.rows);
    let html = pageWrap('Newsletter Archive', `
      ${card('Archived Newsletters (' + newsletters.length + ')', newsletters.length ? newsletters.map(n => `
        <div style="padding:12px 0;border-bottom:1px solid ${COLORS.border};">
          <a href="/school/newsletter/${n.id}" style="color:${COLORS.primary};text-decoration:none;font-weight:600;font-size:1rem;">${esc(n.title)}</a>
          <div style="font-size:0.8rem;color:${COLORS.muted};margin-top:4px;">
            Sent: ${esc(String(n.sent_at).slice(0, 16))} • ${badge(COLORS.muted, n.target_audience)}
          </div>
        </div>
      `).join('') : '<p style="color:' + COLORS.muted + ';">No sent newsletters.</p>')}
      ${btn('/school/newsletter', 'Back to Newsletters')}
    `);
    res.send(renderPage('newsletter-archive', html, req));
  }));

  /* ═══════════════════════════════════════════════════════════════════
     FEATURE 10 — Continuous Assessment
     ═══════════════════════════════════════════════════════════════════ */
  app.get('/school/assessments', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const assessments = await pool.query(
      `SELECT ca.*, s.name AS student_name, at.name AS term_name
       FROM continuous_assessments ca
       LEFT JOIN students s ON s.id=ca.student_id AND s.tenant_id=$1
       LEFT JOIN academic_terms at ON at.id=ca.term_id AND at.tenant_id=$1
       WHERE ca.tenant_id=$1 ORDER BY ca.assessment_date DESC LIMIT 50`,
      [tid]
    ).then(r => r.rows);
    const students = await pool.query(`SELECT id, name FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 500`, [tid]).then(r => r.rows);
    const terms = await pool.query(`SELECT id, name FROM academic_terms WHERE tenant_id=$1 ORDER BY start_date DESC`, [tid]).then(r => r.rows);
    const typeColors = { quiz: COLORS.primary, classwork: COLORS.success, homework: COLORS.warning, project: '#7c3aed', practical: COLORS.danger, midterm: '#0891b2' };
    let html = pageWrap('Continuous Assessment', `
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:20px;">
        ${card('Record Assessment', `
          <form method="POST" action="/school/assessments/record" style="max-width:500px;">
            <div style="margin-bottom:12px;">
              <label for="ca-student" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Student</label>
              <select id="ca-student" name="student_id" required aria-required="true"
                style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
                <option value="">-- Select --</option>
                ${students.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
              </select>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
              <div style="margin-bottom:12px;">
                <label for="ca-subject" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Subject</label>
                <input type="text" id="ca-subject" name="subject" required placeholder="Mathematics"
                  style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
              </div>
              <div style="margin-bottom:12px;">
                <label for="ca-type" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Type</label>
                <select id="ca-type" name="assessment_type" required
                  style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
                  <option value="quiz">Quiz</option><option value="classwork">Classwork</option>
                  <option value="homework">Homework</option><option value="project">Project</option>
                  <option value="practical">Practical</option><option value="midterm">Midterm</option>
                </select>
              </div>
              <div style="margin-bottom:12px;">
                <label for="ca-score" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Score</label>
                <input type="number" id="ca-score" name="score" required min="0" step="0.5"
                  style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
              </div>
              <div style="margin-bottom:12px;">
                <label for="ca-max" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Max Score</label>
                <input type="number" id="ca-max" name="max_score" required min="1" value="100"
                  style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
              </div>
              <div style="margin-bottom:12px;">
                <label for="ca-date" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Date</label>
                <input type="date" id="ca-date" name="assessment_date" required value="${new Date().toISOString().slice(0, 10)}"
                  style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
              </div>
              <div style="margin-bottom:12px;">
                <label for="ca-term" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Term</label>
                <select id="ca-term" name="term_id"
                  style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;">
                  <option value="">-- Select --</option>
                  ${terms.map(t => `<option value="${t.id}" ${t.is_current ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div style="margin-bottom:12px;">
              <label for="ca-comments" style="display:block;font-size:0.85rem;margin-bottom:4px;font-weight:600;">Comments</label>
              <textarea id="ca-comments" name="comments" rows="2"
                style="width:100%;padding:8px;border:1px solid ${COLORS.border};border-radius:8px;box-sizing:border-box;"></textarea>
            </div>
            ${postBtn('Record Assessment')}
          </form>
        `)}
        ${card('Recent Assessments (' + assessments.length + ')', assessments.length ? `
          <table style="width:100%;border-collapse:collapse;" aria-label="Recent assessments">
            <thead><tr>
              <th scope="col" style="text-align:left;padding:6px;border-bottom:2px solid ${COLORS.primary};font-size:0.8rem;">Student</th>
              <th scope="col" style="text-align:left;padding:6px;border-bottom:2px solid ${COLORS.primary};font-size:0.8rem;">Subject</th>
              <th scope="col" style="text-align:left;padding:6px;border-bottom:2px solid ${COLORS.primary};font-size:0.8rem;">Type</th>
              <th scope="col" style="text-align:right;padding:6px;border-bottom:2px solid ${COLORS.primary};font-size:0.8rem;">Score</th>
            </tr></thead>
            <tbody>${assessments.slice(0, 15).map(a => {
              const pct = a.max_score > 0 ? Math.round((Number(a.score) / Number(a.max_score)) * 100) : 0;
              return `<tr>
                <td style="padding:6px;border-bottom:1px solid ${COLORS.border};font-size:0.8rem;">
                  <a href="/school/assessments/student/${a.student_id}" style="color:${COLORS.primary};text-decoration:none;">${esc(a.student_name)}</a>
                </td>
                <td style="padding:6px;border-bottom:1px solid ${COLORS.border};font-size:0.8rem;">${esc(a.subject)}</td>
                <td style="padding:6px;border-bottom:1px solid ${COLORS.border};">${badge(typeColors[a.assessment_type] || COLORS.muted, a.assessment_type)}</td>
                <td style="padding:6px;border-bottom:1px solid ${COLORS.border};text-align:right;font-size:0.8rem;font-weight:600;">${a.score}/${a.max_score} (${pct}%)</td>
              </tr>`;
            }).join('')}</tbody>
          </table>` : '<p style="color:' + COLORS.muted + ';">No assessments recorded.</p>')}
      </div>
    `);
    res.send(renderPage('assessments', html, req));
  }));

  app.post('/school/assessments/record', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { student_id, subject, assessment_type, score, max_score, assessment_date, term_id, comments } = req.body;
    if (!student_id || !subject || !assessment_type || score === undefined || !max_score || !assessment_date) {
      return res.status(400).send('All required fields must be filled');
    }
    if (Number(score) < 0 || Number(max_score) <= 0 || Number(score) > Number(max_score)) {
      return res.status(400).send('Invalid score values');
    }
    await pool.query(
      `INSERT INTO continuous_assessments (tenant_id, student_id, subject, assessment_type, score, max_score, assessment_date, term_id, comments)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, student_id, subject, assessment_type, Number(score), Number(max_score), assessment_date, term_id || null, comments || '']
    );
    awardPoints(req.session.user.id, 3, 'Assessment recorded');
    audit({ tenant_id: tid, action: 'record_assessment', entity: 'assessments', id: student_id, by: req.session.user.id });
    req.session.flash = { type: 'success', message: 'Assessment recorded!' };
    res.redirect('/school/assessments');
  }));

  app.get('/school/assessments/student/:studentId', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const studentId = req.params.studentId;
    const student = await pool.query(`SELECT * FROM students WHERE id=$1 AND tenant_id=$2`, [studentId, tid]).then(r => r.rows[0]);
    if (!student) return res.status(404).send('Student not found');
    const assessments = await pool.query(
      `SELECT ca.*, at.name AS term_name FROM continuous_assessments ca
       LEFT JOIN academic_terms at ON at.id=ca.term_id AND at.tenant_id=$1
       WHERE ca.student_id=$2 AND ca.tenant_id=$1 ORDER BY ca.assessment_date DESC`,
      [tid, studentId]
    ).then(r => r.rows);
    const averages = await pool.query(
      `SELECT subject, ROUND(AVG(score * 100.0 / NULLIF(max_score, 0)), 1) AS avg_pct, COUNT(*) AS cnt
       FROM continuous_assessments WHERE student_id=$1 AND tenant_id=$2 GROUP BY subject ORDER BY avg_pct DESC`,
      [studentId, tid]
    ).then(r => r.rows);
    const typeColors = { quiz: COLORS.primary, classwork: COLORS.success, homework: COLORS.warning, project: '#7c3aed', practical: COLORS.danger, midterm: '#0891b2' };
    let html = pageWrap('Assessments — ' + student.name, `
      ${card('Subject Averages', `
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;">
          ${averages.map(a => `<div style="background:${COLORS.bg};border-radius:8px;padding:12px;text-align:center;">
            <div style="font-size:1.3rem;font-weight:700;color:${COLORS.primary};">${a.avg_pct}%</div>
            <div style="font-size:0.85rem;color:${COLORS.text};font-weight:600;">${esc(a.subject)}</div>
            <div style="font-size:0.75rem;color:${COLORS.muted};">${a.cnt} assessments</div>
          </div>`).join('')}
        </div>
      `)}
      ${card('All Assessments (' + assessments.length + ')', assessments.length ? `
        <table style="width:100%;border-collapse:collapse;" aria-label="Student assessment records">
          <thead><tr>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Date</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Subject</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Type</th>
            <th scope="col" style="text-align:right;padding:8px;border-bottom:2px solid ${COLORS.primary};">Score</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Term</th>
            <th scope="col" style="text-align:left;padding:8px;border-bottom:2px solid ${COLORS.primary};">Comments</th>
          </tr></thead>
          <tbody>${assessments.map(a => `<tr>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(String(a.assessment_date).slice(0, 10))}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};font-weight:600;">${esc(a.subject)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${badge(typeColors[a.assessment_type] || COLORS.muted, a.assessment_type)}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};text-align:right;font-weight:600;">${a.score}/${a.max_score}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};">${esc(a.term_name || '—')}</td>
            <td style="padding:8px;border-bottom:1px solid ${COLORS.border};font-size:0.85rem;color:${COLORS.muted};">${esc(String(a.comments || '').slice(0, 50))}</td>
          </tr>`).join('')}</tbody>
        </table>` : '<p style="color:' + COLORS.muted + ';">No assessments recorded.</p>')}
      <div style="display:flex;gap:10px;margin-top:16px;">
        ${btn('/school/assessments/progress/' + studentId, 'View Progress Chart', COLORS.success)}
        ${btn('/school/assessments', 'Back to Assessments')}
      </div>
    `);
    res.send(renderPage('assessment-student', html, req));
  }));

  app.get('/school/assessments/progress/:studentId', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const studentId = req.params.studentId;
    const student = await pool.query(`SELECT * FROM students WHERE id=$1 AND tenant_id=$2`, [studentId, tid]).then(r => r.rows[0]);
    if (!student) return res.status(404).send('Student not found');
    const assessments = await pool.query(
      `SELECT assessment_date, subject, score, max_score, assessment_type,
        ROUND(score * 100.0 / NULLIF(max_score, 0), 1) AS percentage
       FROM continuous_assessments
       WHERE student_id=$1 AND tenant_id=$2 ORDER BY assessment_date ASC`,
      [studentId, tid]
    ).then(r => r.rows);

    // Build SVG line chart of progress over time
    const maxPct = 100;
    const chartW = Math.max(assessments.length * 40 + 100, 400);
    const chartH = 280;

    if (assessments.length === 0) {
      let html = pageWrap('Progress — ' + student.name, `
        ${card('Assessment Progress', '<p style="color:' + COLORS.muted + ';">No assessments to chart.</p>')}
        ${btn('/school/assessments/student/' + studentId, 'Back to Student')}
      `);
      res.send(renderPage('assessment-progress', html, req));
      return;
    }

    // Grid lines
    let gridLines = [0, 25, 50, 75, 100].map(pct => {
      const y = chartH - 40 - (pct / maxPct) * (chartH - 70);
      return `<line x1="60" y1="${y}" x2="${chartW - 20}" y2="${y}" stroke="${COLORS.border}" stroke-width="0.5" stroke-dasharray="4"/>
        <text x="55" y="${y + 4}" text-anchor="end" font-size="10" fill="${COLORS.muted}">${pct}%</text>`;
    }).join('');

    // Overall trend line
    let overallPoints = assessments.map((a, i) => {
      const x = 60 + i * 40;
      const y = chartH - 40 - (Number(a.percentage) / maxPct) * (chartH - 70);
      return `${x},${y}`;
    }).join(' ');

    let dataPoints = assessments.map((a, i) => {
      const x = 60 + i * 40;
      const y = chartH - 40 - (Number(a.percentage) / maxPct) * (chartH - 70);
      return `<circle cx="${x}" cy="${y}" r="4" fill="${COLORS.primary}" stroke="#fff" stroke-width="1.5">
        <title>${esc(a.subject)} (${esc(a.assessment_type)}): ${a.percentage}% on ${String(a.assessment_date).slice(0, 10)}</title>
      </circle>`;
    }).join(' ');

    let dateLabels = assessments.map((a, i) => {
      const x = 60 + i * 40;
      return `<text x="${x}" y="${chartH - 22}" text-anchor="middle" font-size="9" fill="${COLORS.muted}" transform="rotate(-45,${x},${chartH - 22})">${esc(String(a.assessment_date).slice(5, 10))}</text>`;
    }).join(' ');

    let html = pageWrap('Progress Report — ' + student.name, `
      ${card('Assessment Trend Over Time', `
        <svg width="${chartW}" height="${chartH}" aria-label="Assessment progress chart showing percentage over time" role="img">
          <!-- Grid -->
          ${gridLines}
          <!-- Axes -->
          <line x1="60" y1="${chartH - 40}" x2="${chartW - 20}" y2="${chartH - 40}" stroke="${COLORS.text}" stroke-width="1"/>
          <line x1="60" y1="10" x2="60" y2="${chartH - 40}" stroke="${COLORS.text}" stroke-width="1"/>
          <!-- Line -->
          <polyline points="${overallPoints}" fill="none" stroke="${COLORS.primary}" stroke-width="2.5" stroke-linejoin="round"/>
          <!-- Area fill -->
          <polygon points="60,${chartH - 40} ${overallPoints} ${60 + (assessments.length - 1) * 40},${chartH - 40}"
            fill="${COLORS.primary}" opacity="0.08"/>
          <!-- Data points -->
          ${dataPoints}
          <!-- Date labels -->
          ${dateLabels}
          <!-- Legend -->
          <text x="60" y="15" font-size="11" fill="${COLORS.text}" font-weight="600">Score %</text>
        </svg>
      `)}
      ${card('Summary Statistics', `
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;">
          <div style="text-align:center;padding:16px;background:${COLORS.primary}11;border-radius:8px;">
            <div style="font-size:1.5rem;font-weight:700;">${assessments.length}</div>
            <div style="font-size:0.8rem;color:${COLORS.muted};">Total Assessments</div>
          </div>
          <div style="text-align:center;padding:16px;background:${COLORS.success}11;border-radius:8px;">
            <div style="font-size:1.5rem;font-weight:700;">${Math.round(assessments.reduce((a, c) => a + Number(c.percentage), 0) / assessments.length)}%</div>
            <div style="font-size:0.8rem;color:${COLORS.muted};">Average Score</div>
          </div>
          <div style="text-align:center;padding:16px;background:${COLORS.warning}11;border-radius:8px;">
            <div style="font-size:1.5rem;font-weight:700;">${Math.max(...assessments.map(a => Number(a.percentage)))}%</div>
            <div style="font-size:0.8rem;color:${COLORS.muted};">Highest Score</div>
          </div>
          <div style="text-align:center;padding:16px;background:${COLORS.danger}11;border-radius:8px;">
            <div style="font-size:1.5rem;font-weight:700;">${Math.min(...assessments.map(a => Number(a.percentage)))}%</div>
            <div style="font-size:0.8rem;color:${COLORS.muted};">Lowest Score</div>
          </div>
        </div>
      `)}
      <div style="display:flex;gap:10px;margin-top:16px;">
        ${btn('/school/assessments/student/' + studentId, 'Back to Student')}
        ${btn('/school/assessments', 'All Assessments')}
      </div>
    `);
    res.send(renderPage('assessment-progress', html, req));
  }));

}; // end module.exports
