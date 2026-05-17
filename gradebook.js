// ============================================================
// GRADEBOOK MODULE — Multi-Tenant SaaS Platform (Comfort Zone)
// Marks entry, report cards, grade overview, bulk entry,
// marksheets, class performance, grading scales, JSON APIs.
// ============================================================
// Usage in server.js:
//   const gradebook = require('./gradebook');
//   gradebook(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function gradebook(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // -- internal helpers ---------------------------------------------------
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtTime = (t) => t ? String(t).substring(0, 5) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  function gradeBadge(score, maxScore) {
    const max = Number(maxScore) || 100;
    const pct = max > 0 ? (Number(score) || 0) / max * 100 : 0;
    let color = '#dc2626', label = 'F';
    if (pct >= 80) { color = '#16a34a'; label = 'A'; }
    else if (pct >= 70) { color = '#059669'; label = 'B'; }
    else if (pct >= 60) { color = '#2563eb'; label = 'C'; }
    else if (pct >= 50) { color = '#d97706'; label = 'D'; }
    return `<span style="display:inline-block;padding:3px 10px;border-radius:8px;font-size:12px;font-weight:700;background:${color}20;color:${color}">${label} (${Math.round(pct)}%)</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const GB_CSS = `<style>
    .gb-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .gb-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .gb-nav a:hover{background:#e2e8f0}.gb-nav a.active{background:#4f46e5;color:#fff}
    .gb-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .gb-btn:hover{opacity:.9;transform:translateY(-1px)}
    .gb-btn-primary{background:#4f46e5;color:#fff}.gb-btn-success{background:#059669;color:#fff}
    .gb-btn-danger{background:#fee2e2;color:#dc2626}.gb-btn-secondary{background:#f1f5f9;color:#475569}
    .gb-table{width:100%;border-collapse:collapse;font-size:13px}
    .gb-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .gb-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .gb-table tr:hover{background:#f8fafc}
    .gb-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .gb-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .gb-filter input,.gb-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .gb-filter input:focus,.gb-filter select:focus{outline:none;border-color:#6366f1}
    .gb-mark-input{width:70px;padding:6px 8px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;text-align:center}
    .gb-mark-input:focus{outline:none;border-color:#6366f1;background:#f5f3ff}
    .gb-card{background:#fff;border-radius:14px;border:1px solid #f1f5f9;padding:20px;margin-bottom:16px}
    @media(max-width:768px){.gb-nav{gap:4px}.gb-nav a{padding:6px 12px;font-size:12px}.gb-filter{flex-direction:column}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="gb-nav">
    <a href="/gradebook" class="${active === 'dash' ? 'active' : ''}">📊 Dashboard</a>
    <a href="/gradebook/entry" class="${active === 'entry' ? 'active' : ''}">✏️ Marks Entry</a>
    <a href="/gradebook/reports" class="${active === 'reports' ? 'active' : ''}">📈 Reports</a>
    <a href="/gradebook/bulk-entry" class="${active === 'bulk' ? 'active' : ''}">📋 Bulk Entry</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[Gradebook] Cannot connect to DB for migrations'); return; }
    try {
      // Ensure grades table columns
      const gradesCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'student_id', type: 'INTEGER' },
        { name: 'class_id', type: 'INTEGER' },
        { name: 'subject_id', type: 'INTEGER' },
        { name: 'exam_id', type: 'INTEGER' },
        { name: 'term', type: 'VARCHAR(50)' },
        { name: 'year', type: 'VARCHAR(10)' },
        { name: 'score', type: 'NUMERIC(6,2)' },
        { name: 'max_score', type: 'NUMERIC(6,2) DEFAULT 100' },
        { name: 'grade', type: 'VARCHAR(5)' },
        { name: 'remarks', type: 'TEXT' },
        { name: 'created_by', type: 'INTEGER' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of gradesCols) { try { await c.query(`ALTER TABLE grades ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure marks table columns
      const marksCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'student_id', type: 'INTEGER' },
        { name: 'class_id', type: 'INTEGER' },
        { name: 'subject_id', type: 'INTEGER' },
        { name: 'exam_type', type: 'VARCHAR(50)' },
        { name: 'marks_obtained', type: 'NUMERIC(6,2)' },
        { name: 'total_marks', type: 'NUMERIC(6,2) DEFAULT 100' },
        { name: 'term', type: 'VARCHAR(50)' },
        { name: 'year', type: 'VARCHAR(10)' },
        { name: 'comments', type: 'TEXT' },
        { name: 'created_by', type: 'INTEGER' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of marksCols) { try { await c.query(`ALTER TABLE marks ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure marksheets table columns
      const marksheetCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'student_id', type: 'INTEGER' },
        { name: 'class_id', type: 'INTEGER' },
        { name: 'term', type: 'VARCHAR(50)' },
        { name: 'year', type: 'VARCHAR(10)' },
        { name: 'total_score', type: 'NUMERIC(8,2)' },
        { name: 'average_score', type: 'NUMERIC(6,2)' },
        { name: 'rank', type: 'INTEGER' },
        { name: 'teacher_comment', type: 'TEXT' },
        { name: 'principal_comment', type: 'TEXT' },
        { name: 'status', type: 'VARCHAR(20) DEFAULT \'draft\'' },
        { name: 'generated_at', type: 'TIMESTAMPTZ DEFAULT NOW()' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of marksheetCols) { try { await c.query(`ALTER TABLE marksheets ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure grading_scales table columns
      const scaleCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'name', type: 'VARCHAR(100)' },
        { name: 'min_score', type: 'NUMERIC(6,2)' },
        { name: 'max_score', type: 'NUMERIC(6,2)' },
        { name: 'grade_label', type: 'VARCHAR(10)' },
        { name: 'grade_point', type: 'NUMERIC(4,2)' },
        { name: 'description', type: 'TEXT' },
        { name: 'is_active', type: 'BOOLEAN DEFAULT true' }
      ];
      for (const col of scaleCols) { try { await c.query(`ALTER TABLE grading_scales ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Ensure class_subjects table columns
      const csCols = [
        { name: 'tenant_id', type: 'INTEGER NOT NULL DEFAULT 0' },
        { name: 'class_id', type: 'INTEGER' },
        { name: 'subject_id', type: 'INTEGER' },
        { name: 'teacher_id', type: 'INTEGER' },
        { name: 'is_active', type: 'BOOLEAN DEFAULT true' },
        { name: 'created_at', type: 'TIMESTAMPTZ DEFAULT NOW()' }
      ];
      for (const col of csCols) { try { await c.query(`ALTER TABLE class_subjects ADD COLUMN IF NOT EXISTS ${col.name} ${col.type}`); } catch(e){} }

      // Indexes
      await c.query(`CREATE INDEX IF NOT EXISTS idx_grades_tenant ON grades(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_grades_student ON grades(student_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_grades_class ON grades(class_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_marks_tenant ON marks(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_marks_student ON marks(student_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_marks_class ON marks(class_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_marksheets_tenant ON marksheets(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_marksheets_student ON marksheets(student_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_grading_scales_tenant ON grading_scales(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_class_subjects_tenant ON class_subjects(tenant_id)`);
      console.log('[Gradebook] Migrations applied successfully');
    } catch (e) { console.error('[Gradebook] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // ROUTE 1: GET /gradebook — Dashboard
  // ============================================================
  app.get('/gradebook', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const classId = req.query.class_id || '';
    const term = req.query.term || '';
    const year = req.query.year || new Date().getFullYear().toString();

    // Fetch classes
    const classes = (await pool.query(`SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    // Stats
    const totalGrades = (await pool.query(`SELECT COUNT(*)::int as cnt FROM grades WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const totalMarks = (await pool.query(`SELECT COUNT(*)::int as cnt FROM marks WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const avgScore = (await pool.query(`SELECT COALESCE(ROUND(AVG(score), 1), 0) as avg FROM grades WHERE tenant_id=$1 AND score IS NOT NULL`, [tid])).rows[0].avg;

    // Grade distribution
    const gradeDist = (await pool.query(
      `SELECT CASE WHEN score >= 80 THEN 'A' WHEN score >= 70 THEN 'B' WHEN score >= 60 THEN 'C' WHEN score >= 50 THEN 'D' ELSE 'F' END as grade, COUNT(*)::int as cnt FROM grades WHERE tenant_id=$1 AND score IS NOT NULL GROUP BY grade ORDER BY grade`,
      [tid]
    )).rows;

    // Class averages
    let classAvgRows = [];
    if (classId) {
      classAvgRows = (await pool.query(
        `SELECT sub.name as subject_name, ROUND(AVG(g.score), 1) as avg_score, COUNT(*)::int as entries FROM grades g LEFT JOIN subjects sub ON sub.id = g.subject_id WHERE g.tenant_id=$1 AND g.class_id=$2 AND g.score IS NOT NULL GROUP BY sub.name ORDER BY avg_score DESC`,
        [tid, classId]
      )).rows;
    } else {
      classAvgRows = (await pool.query(
        `SELECT c.name as class_name, ROUND(AVG(g.score), 1) as avg_score, COUNT(*)::int as entries FROM grades g LEFT JOIN classes c ON c.id = g.class_id WHERE g.tenant_id=$1 AND g.score IS NOT NULL GROUP BY c.name ORDER BY avg_score DESC LIMIT 20`,
        [tid]
      )).rows;
    }

    // Recent marks
    const recentMarks = (await pool.query(
      `SELECT g.*, s.name as student_name, sub.name as subject_name, c.name as class_name FROM grades g LEFT JOIN students s ON s.id = g.student_id LEFT JOIN subjects sub ON sub.id = g.subject_id LEFT JOIN classes c ON c.id = g.class_id WHERE g.tenant_id=$1 ORDER BY g.created_at DESC LIMIT 15`,
      [tid]
    )).rows;

    const gradeBar = gradeDist.map(g => {
      const pct = totalGrades > 0 ? Math.round(g.cnt / totalGrades * 100) : 0;
      const colors = { A: '#16a34a', B: '#059669', C: '#2563eb', D: '#d97706', F: '#dc2626' };
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:13px;font-weight:700;color:${colors[g.grade] || '#64748b'};min-width:20px">${g.grade}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:20px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;background:${colors[g.grade] || '#94a3b8'};border-radius:6px"></div>
          <span style="position:absolute;right:6px;top:2px;font-size:11px;font-weight:700;color:#1e293b">${g.cnt}</span>
        </div>
        <span style="font-size:11px;color:#94a3b8;min-width:40px">${pct}%</span>
      </div>`;
    }).join('');

    const recentHtml = recentMarks.map(r => `<tr>
      <td><strong>${esc(r.student_name || 'Student #' + r.student_id)}</strong></td>
      <td>${esc(r.class_name)}</td>
      <td>${esc(r.subject_name)}</td>
      <td>${gradeBadge(r.score, r.max_score)}</td>
      <td>${esc(r.term || '—')}</td>
      <td class="muted">${fmtDateTime(r.created_at)}</td>
    </tr>`).join('');

    const classAvgHtml = classAvgRows.map(r => `<tr>
      <td><strong>${esc(r.class_name || r.subject_name)}</strong></td>
      <td><span style="font-size:18px;font-weight:700;color:#4f46e5">${r.avg_score}</span></td>
      <td>${r.entries} entries</td>
    </tr>`).join('');

    const html = GB_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📚 Gradebook Dashboard</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Track academic performance and manage grades</p></div>
        <div style="display:flex;gap:8px">
          <a href="/gradebook/entry" class="gb-btn gb-btn-primary">✏️ Enter Marks</a>
          <a href="/gradebook/bulk-entry" class="gb-btn gb-btn-secondary">📋 Bulk Entry</a>
        </div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${totalGrades}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Grades</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${totalMarks}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Marks Records</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${avgScore}%</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Average Score</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#a855f7">${classes.length}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Active Classes</div></div>
      </div>
      <div class="gb-filter">
        <div><label>Class</label><select onchange="location.href='/gradebook?class_id='+this.value+'&term=${esc(term)}&year=${esc(year)}'">
          <option value="">All Classes</option>
          ${classes.map(c => `<option value="${c.id}" ${classId == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></div>
        <div><label>Term</label><select onchange="location.href='/gradebook?class_id=${esc(classId)}&term='+this.value+'&year=${esc(year)}'">
          <option value="">All Terms</option>
          <option value="Term 1" ${term==='Term 1'?'selected':''}>Term 1</option>
          <option value="Term 2" ${term==='Term 2'?'selected':''}>Term 2</option>
          <option value="Term 3" ${term==='Term 3'?'selected':''}>Term 3</option>
        </select></div>
        <div><label>Year</label><input type="text" value="${esc(year)}" onchange="location.href='/gradebook?class_id=${esc(classId)}&term=${esc(term)}&year='+this.value"></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="gb-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Grade Distribution</h3>
          ${gradeBar || '<p class="muted" style="font-size:13px">No grade data available</p>'}
        </div>
        <div class="gb-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">${classId ? 'Subject Averages' : 'Class Averages'}</h3>
          <div style="overflow-x:auto"><table class="gb-table">
            <thead><tr><th>${classId ? 'Subject' : 'Class'}</th><th>Average</th><th>Entries</th></tr></thead>
            <tbody>${classAvgHtml || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:20px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>
      <div class="gb-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">Recent Grades</h3>
        <div style="overflow-x:auto"><table class="gb-table">
          <thead><tr><th>Student</th><th>Class</th><th>Subject</th><th>Score</th><th>Term</th><th>Recorded</th></tr></thead>
          <tbody>${recentHtml || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No grades recorded yet</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Gradebook Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /gradebook/entry — Marks entry form
  // ============================================================
  app.get('/gradebook/entry', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const classes = (await pool.query(`SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const subjects = (await pool.query(`SELECT id, name FROM subjects WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const selectedClass = req.query.class_id || '';
    const selectedSubject = req.query.subject_id || '';
    const selectedTerm = req.query.term || 'Term 1';
    const selectedYear = req.query.year || new Date().getFullYear().toString();

    // Fetch students in selected class
    let students = [];
    if (selectedClass) {
      students = (await pool.query(
        `SELECT s.id, s.first_name, s.last_name, s.admission_number FROM students s WHERE s.tenant_id=$1 AND s.class_id=$2 ORDER BY s.last_name, s.first_name`,
        [tid, selectedClass]
      )).rows;
    }

    // Fetch existing marks for the selection
    let existingMarks = {};
    if (selectedClass && selectedSubject) {
      const marks = (await pool.query(
        `SELECT student_id, score, remarks FROM grades WHERE tenant_id=$1 AND class_id=$2 AND subject_id=$3 AND term=$4 AND year=$5`,
        [tid, selectedClass, selectedSubject, selectedTerm, selectedYear]
      )).rows;
      marks.forEach(m => { existingMarks[m.student_id] = { score: m.score, remarks: m.remarks }; });
    }

    const studentsHtml = students.map(s => {
      const ex = existingMarks[s.id] || {};
      return `<tr>
        <td><strong>${esc(s.last_name + ', ' + s.first_name)}</strong> <span class="muted" style="font-size:11px">${esc(s.admission_number || '')}</span></td>
        <td><input type="number" name="score_${s.id}" class="gb-mark-input" min="0" max="100" value="${ex.score || ''}" placeholder="—"></td>
        <td><input type="text" name="remark_${s.id}" style="width:180px;padding:6px 10px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px" value="${esc(ex.remarks || '')}" placeholder="Optional"></td>
      </tr>`;
    }).join('');

    const html = GB_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('entry')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">✏️ Marks Entry</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Enter scores for students by class and subject</p></div>
        <a href="/gradebook/bulk-entry" class="gb-btn gb-btn-secondary">📋 Bulk Entry</a>
      </div>
      <div class="gb-filter" style="background:#f8fafc;padding:16px;border-radius:12px;margin-bottom:20px">
        <div><label>Class *</label><select id="classSelect" onchange="location.href='/gradebook/entry?class_id='+this.value+'&subject_id=${esc(selectedSubject)}&term='+document.getElementById('termSelect').value">
          <option value="">Select class</option>
          ${classes.map(c => `<option value="${c.id}" ${selectedClass == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></div>
        <div><label>Subject *</label><select onchange="location.href='/gradebook/entry?class_id=${esc(selectedClass)}&subject_id='+this.value">
          <option value="">Select subject</option>
          ${subjects.map(s => `<option value="${s.id}" ${selectedSubject == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
        </select></div>
        <div><label>Term</label><select id="termSelect">
          <option value="Term 1" ${selectedTerm==='Term 1'?'selected':''}>Term 1</option>
          <option value="Term 2" ${selectedTerm==='Term 2'?'selected':''}>Term 2</option>
          <option value="Term 3" ${selectedTerm==='Term 3'?'selected':''}>Term 3</option>
        </select></div>
        <div><label>Year</label><input type="text" value="${esc(selectedYear)}" style="width:100px"></div>
      </div>
      ${selectedClass && selectedSubject ? `
      <form method="POST" action="/gradebook/entry">
        <input type="hidden" name="class_id" value="${esc(selectedClass)}">
        <input type="hidden" name="subject_id" value="${esc(selectedSubject)}">
        <input type="hidden" name="term" value="${esc(selectedTerm)}">
        <input type="hidden" name="year" value="${esc(selectedYear)}">
        <div class="gb-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="margin:0;color:#1e293b">Students (${students.length})</h3>
            <button type="submit" class="gb-btn gb-btn-primary">💾 Save Marks</button>
          </div>
          <div style="overflow-x:auto"><table class="gb-table">
            <thead><tr><th>Student</th><th>Score (0-100)</th><th>Remarks</th></tr></thead>
            <tbody>${studentsHtml || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:30px">No students in this class</td></tr>'}</tbody>
          </table></div>
        </div>
      </form>` : '<div class="gb-card" style="text-align:center;padding:40px;color:#94a3b8"><p style="font-size:14px">Select a class and subject to begin entering marks</p></div>'}
    </div>`;
    res.send(renderPage('Marks Entry', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /gradebook/entry — Save marks
  // ============================================================
  app.post('/gradebook/entry', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { class_id, subject_id, term, year } = req.body;
    if (!class_id || !subject_id) return res.redirect('/gradebook/entry');

    const students = (await pool.query(`SELECT id FROM students WHERE tenant_id=$1 AND class_id=$2`, [tid, class_id])).rows;
    let saved = 0;

    for (const s of students) {
      const scoreVal = req.body['score_' + s.id];
      const remarkVal = req.body['remark_' + s.id];

      if (scoreVal !== undefined && scoreVal !== '') {
        const score = Math.min(100, Math.max(0, Number(scoreVal)));

        // Upsert
        const existing = (await pool.query(
          `SELECT id FROM grades WHERE tenant_id=$1 AND student_id=$2 AND class_id=$3 AND subject_id=$4 AND term=$5 AND year=$6`,
          [tid, s.id, class_id, subject_id, term, year]
        )).rows[0];

        if (existing) {
          await pool.query(`UPDATE grades SET score=$1, max_score=100, remarks=$2, grade=$3, created_by=$4 WHERE id=$5 AND tenant_id=$6`,
            [score, remarkVal || null, null, user.id, existing.id, tid]);
        } else {
          await pool.query(
            `INSERT INTO grades (tenant_id, student_id, class_id, subject_id, term, year, score, max_score, remarks, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,100,$8,$9)`,
            [tid, s.id, class_id, subject_id, term, year, score, remarkVal || null, user.id]
          );
        }
        saved++;
      }
    }

    req.session.flash = { type: 'success', msg: `Saved marks for ${saved} student(s)` };
    res.redirect(`/gradebook/entry?class_id=${class_id}&subject_id=${subject_id}&term=${esc(term)}&year=${esc(year)}`);
  }));

  // ============================================================
  // ROUTE 4: GET /gradebook/reports — Report cards & class performance
  // ============================================================
  app.get('/gradebook/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const classes = (await pool.query(`SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const selectedClass = req.query.class_id || '';
    const selectedTerm = req.query.term || 'Term 1';
    const selectedYear = req.query.year || new Date().getFullYear().toString();

    // Class performance summary
    let classReport = [];
    if (selectedClass) {
      classReport = (await pool.query(
        `SELECT s.id as student_id, s.first_name, s.last_name, s.admission_number,
          COALESCE(AVG(g.score), 0)::numeric(6,2) as avg_score,
          COUNT(g.id)::int as subjects_taken,
          MAX(g.score) as highest,
          MIN(g.score) as lowest,
          RANK() OVER (ORDER BY AVG(g.score) DESC) as class_rank
        FROM students s
        LEFT JOIN grades g ON g.student_id = s.id AND g.tenant_id=$1 AND g.class_id=$2 AND g.term=$3 AND g.year=$4
        WHERE s.tenant_id=$1 AND s.class_id=$2
        GROUP BY s.id, s.first_name, s.last_name, s.admission_number
        ORDER BY avg_score DESC`,
        [tid, selectedClass, selectedTerm, selectedYear]
      )).rows;
    }

    // Subject-wise class average
    let subjectAvgs = [];
    if (selectedClass) {
      subjectAvgs = (await pool.query(
        `SELECT sub.name as subject_name,
          ROUND(AVG(g.score), 1)::numeric(6,2) as class_avg,
          MAX(g.score) as highest,
          MIN(g.score) as lowest,
          COUNT(g.id)::int as entries
        FROM grades g
        LEFT JOIN subjects sub ON sub.id = g.subject_id
        WHERE g.tenant_id=$1 AND g.class_id=$2 AND g.term=$3 AND g.year=$4
        GROUP BY sub.name ORDER BY class_avg DESC`,
        [tid, selectedClass, selectedTerm, selectedYear]
      )).rows;
    }

    const reportHtml = classReport.map(r => `<tr>
      <td>${r.class_rank}</td>
      <td><strong>${esc(r.last_name + ', ' + r.first_name)}</strong> <span class="muted" style="font-size:11px">${esc(r.admission_number || '')}</span></td>
      <td>${gradeBadge(r.avg_score, 100)}</td>
      <td style="font-weight:600;color:#4f46e5">${r.avg_score}</td>
      <td>${r.highest || '—'}</td>
      <td>${r.lowest || '—'}</td>
      <td>${r.subjects_taken}</td>
    </tr>`).join('');

    const subjectHtml = subjectAvgs.map(r => `<tr>
      <td><strong>${esc(r.subject_name)}</strong></td>
      <td style="font-weight:600;color:#4f46e5">${r.class_avg}</td>
      <td>${r.highest || '—'}</td>
      <td>${r.lowest || '—'}</td>
      <td>${r.entries}</td>
    </tr>`).join('');

    const html = GB_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('reports')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📈 Grade Reports</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Report cards and class performance analysis</p></div>
      </div>
      <div class="gb-filter" style="background:#f8fafc;padding:16px;border-radius:12px;margin-bottom:20px">
        <div><label>Class</label><select onchange="location.href='/gradebook/reports?class_id='+this.value+'&term='+document.getElementById('termR').value">
          <option value="">Select class</option>
          ${classes.map(c => `<option value="${c.id}" ${selectedClass == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></div>
        <div><label>Term</label><select id="termR" onchange="location.href='/gradebook/reports?class_id=${esc(selectedClass)}&term='+this.value">
          <option value="Term 1" ${selectedTerm==='Term 1'?'selected':''}>Term 1</option>
          <option value="Term 2" ${selectedTerm==='Term 2'?'selected':''}>Term 2</option>
          <option value="Term 3" ${selectedTerm==='Term 3'?'selected':''}>Term 3</option>
        </select></div>
        <div><label>Year</label><input type="text" value="${esc(selectedYear)}" style="width:100px"></div>
      </div>
      ${selectedClass ? `
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:20px">
        <div class="gb-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Class Performance — ${esc(classes.find(c => c.id == selectedClass)?.name || '')}</h3>
          <div style="overflow-x:auto;max-height:500px;overflow-y:auto"><table class="gb-table">
            <thead style="position:sticky;top:0"><tr><th>#</th><th>Student</th><th>Grade</th><th>Average</th><th>High</th><th>Low</th><th>Subjects</th></tr></thead>
            <tbody>${reportHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="gb-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📊 Subject Averages</h3>
          <div style="overflow-x:auto;max-height:500px;overflow-y:auto"><table class="gb-table">
            <thead style="position:sticky;top:0"><tr><th>Subject</th><th>Avg</th><th>High</th><th>Low</th></tr></thead>
            <tbody>${subjectHtml || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:30px">No data</td></tr>'}</tbody>
          </table></div>
        </div>
      </div>` : '<div class="gb-card" style="text-align:center;padding:40px;color:#94a3b8"><p style="font-size:14px">Select a class to view performance reports</p></div>'}
    </div>`;
    res.send(renderPage('Grade Reports', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /gradebook/marksheet/:id — Individual marksheet
  // ============================================================
  app.get('/gradebook/marksheet/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, studentId = req.params.id;
    const term = req.query.term || 'Term 1';
    const year = req.query.year || new Date().getFullYear().toString();

    // Student info
    const student = (await pool.query(`SELECT * FROM students WHERE id=$1 AND tenant_id=$2`, [studentId, tid])).rows[0];
    if (!student) return res.send(renderPage('Not Found', '<div class="gb-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Student not found</h2></div>', user, req));

    // Fetch all grades for this student
    const grades = (await pool.query(
      `SELECT g.*, sub.name as subject_name, sub.short_name, c.name as class_name
       FROM grades g
       LEFT JOIN subjects sub ON sub.id = g.subject_id
       LEFT JOIN classes c ON c.id = g.class_id
       WHERE g.tenant_id=$1 AND g.student_id=$2 AND g.term=$3 AND g.year=$4
       ORDER BY sub.name`,
      [tid, studentId, term, year]
    )).rows;

    const totalScore = grades.reduce((s, g) => s + (Number(g.score) || 0), 0);
    const count = grades.filter(g => g.score !== null).length;
    const avgScore = count > 0 ? (totalScore / count).toFixed(1) : '—';
    const bestSubject = grades.length > 0 ? grades.reduce((a, b) => (Number(a.score) || 0) >= (Number(b.score) || 0) ? a : b) : null;
    const worstSubject = grades.length > 0 ? grades.reduce((a, b) => (Number(a.score) || 0) <= (Number(b.score) || 0) ? a : b) : null;

    const gradesHtml = grades.map(g => `<tr>
      <td><strong>${esc(g.subject_name)}</strong></td>
      <td>${g.score !== null ? g.score : '—'}</td>
      <td>${g.score !== null ? '100' : '—'}</td>
      <td>${g.score !== null ? gradeBadge(g.score, 100) : '—'}</td>
      <td class="muted">${esc(g.remarks || '')}</td>
    </tr>`).join('');

    const html = GB_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('reports')}
      <div style="margin-bottom:20px">
        <a href="/gradebook/reports" style="color:#64748b;font-size:14px;text-decoration:none">← Back to Reports</a>
      </div>
      <div class="gb-card" style="text-align:center;padding:28px;border:2px solid #e2e8f0;margin-bottom:20px">
        <h2 style="margin:0 0 4px;color:#1e293b;font-size:20px">📝 Academic Marksheet</h2>
        <p style="font-size:13px;color:#94a3b8">${esc(term)} — ${esc(year)}</p>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="gb-card">
          <h3 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;color:#64748b;letter-spacing:.5px">Student Details</h3>
          <div style="font-size:14px;line-height:2">
            <strong>Name:</strong> ${esc(student.first_name + ' ' + student.last_name)}<br>
            <strong>Admission:</strong> ${esc(student.admission_number || '—')}<br>
            <strong>Class:</strong> ${esc(grades[0]?.class_name || '—')}<br>
            <strong>Term/Year:</strong> ${esc(term)} / ${esc(year)}
          </div>
        </div>
        <div class="gb-card">
          <h3 style="margin:0 0 10px;font-size:13px;text-transform:uppercase;color:#64748b;letter-spacing:.5px">Performance Summary</h3>
          <div style="font-size:14px;line-height:2">
            <strong>Total Score:</strong> <span style="color:#4f46e5;font-weight:700">${totalScore}</span> / ${count * 100}<br>
            <strong>Average:</strong> <span style="color:#4f46e5;font-weight:700;font-size:18px">${avgScore}%</span><br>
            <strong>Best Subject:</strong> ${bestSubject ? esc(bestSubject.subject_name) + ' (' + bestSubject.score + ')' : '—'}<br>
            <strong>Needs Improvement:</strong> ${worstSubject ? esc(worstSubject.subject_name) + ' (' + worstSubject.score + ')' : '—'}
          </div>
        </div>
      </div>
      <div class="gb-card">
        <div style="overflow-x:auto"><table class="gb-table">
          <thead><tr><th>Subject</th><th>Score</th><th>Total</th><th>Grade</th><th>Remarks</th></tr></thead>
          <tbody>${gradesHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No grades available for this term</td></tr>'}</tbody>
          <tfoot><tr style="background:#f8fafc;font-weight:700"><td>TOTAL / AVERAGE</td><td>${totalScore}</td><td>${count * 100}</td><td>${gradeBadge(avgScore, 100)}</td><td></td></tr></tfoot>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage(`Marksheet — ${student.first_name} ${student.last_name}`, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /gradebook/bulk-entry — Bulk marks entry
  // ============================================================
  app.get('/gradebook/bulk-entry', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const classes = (await pool.query(`SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const subjects = (await pool.query(`SELECT id, name FROM subjects WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const html = GB_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('bulk')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📋 Bulk Marks Entry</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Quickly paste marks for all students at once</p></div>
      </div>
      <div class="gb-card" style="padding:28px">
        <form method="POST" action="/gradebook/bulk-entry" style="display:flex;flex-direction:column;gap:18px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Class *</label>
              <select name="class_id" required style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="">Select class</option>
                ${classes.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}
              </select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Subject *</label>
              <select name="subject_id" required style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="">Select subject</option>
                ${subjects.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
              </select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Term *</label>
              <select name="term" required style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
                <option value="Term 1">Term 1</option><option value="Term 2">Term 2</option><option value="Term 3">Term 3</option>
              </select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Year *</label>
              <input type="text" name="year" required value="${new Date().getFullYear()}" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Marks (CSV: student_id,score — one per line) *</label>
            <textarea name="marks_data" required rows="10" placeholder="e.g.:\n1,85\n2,72\n3,91\n4,66\n5,78" style="width:100%;padding:12px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;font-family:monospace;resize:vertical"></textarea>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Max Score</label>
            <input type="number" name="max_score" value="100" min="1" style="width:120px;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <button type="submit" class="gb-btn gb-btn-primary" style="padding:14px 28px;font-size:15px;justify-content:center">💾 Save Bulk Marks</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Bulk Marks Entry', html, user, req));
  }));

  app.post('/gradebook/bulk-entry', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { class_id, subject_id, term, year, marks_data, max_score } = req.body;
    if (!class_id || !subject_id || !marks_data) {
      req.session.flash = { type: 'error', msg: 'Please fill all required fields' };
      return res.redirect('/gradebook/bulk-entry');
    }

    const max = Number(max_score) || 100;
    const lines = String(marks_data).trim().split('\n').filter(l => l.trim());
    let saved = 0, errors = 0;

    for (const line of lines) {
      const parts = line.split(',').map(p => p.trim());
      if (parts.length >= 2) {
        const studentId = Number(parts[0]);
        const score = Math.min(max, Math.max(0, Number(parts[1])));

        if (!studentId) { errors++; continue; }

        const existing = (await pool.query(
          `SELECT id FROM grades WHERE tenant_id=$1 AND student_id=$2 AND class_id=$3 AND subject_id=$4 AND term=$5 AND year=$6`,
          [tid, studentId, class_id, subject_id, term, year]
        )).rows[0];

        if (existing) {
          await pool.query(`UPDATE grades SET score=$1, max_score=$2, created_by=$3 WHERE id=$4 AND tenant_id=$5`,
            [score, max, user.id, existing.id, tid]);
        } else {
          await pool.query(
            `INSERT INTO grades (tenant_id, student_id, class_id, subject_id, term, year, score, max_score, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
            [tid, studentId, class_id, subject_id, term, year, score, max, user.id]
          );
        }
        saved++;
      } else {
        errors++;
      }
    }

    req.session.flash = { type: 'success', msg: `Bulk entry complete: ${saved} saved, ${errors} errors` };
    res.redirect('/gradebook/bulk-entry');
  }));

  // ============================================================
  // ROUTE 7: GET /gradebook/api/grades — JSON API
  // ============================================================
  app.get('/gradebook/api/grades', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const studentId = req.query.student_id || '';
    const classId = req.query.class_id || '';
    const subjectId = req.query.subject_id || '';
    const term = req.query.term || '';
    const year = req.query.year || '';

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (studentId) { where.push(`student_id=$${pi++}`); params.push(studentId); }
    if (classId) { where.push(`class_id=$${pi++}`); params.push(classId); }
    if (subjectId) { where.push(`subject_id=$${pi++}`); params.push(subjectId); }
    if (term) { where.push(`term=$${pi++}`); params.push(term); }
    if (year) { where.push(`year=$${pi++}`); params.push(year); }

    const grades = (await pool.query(
      `SELECT g.*, s.first_name, s.last_name, sub.name as subject_name, c.name as class_name
       FROM grades g
       LEFT JOIN students s ON s.id = g.student_id
       LEFT JOIN subjects sub ON sub.id = g.subject_id
       LEFT JOIN classes c ON c.id = g.class_id
       WHERE ${where.join(' AND ')} ORDER BY g.created_at DESC LIMIT 500`,
      params
    )).rows;

    res.json({ success: true, count: grades.length, grades });
  }));

  // ============================================================
  // NEW DATABASE MIGRATIONS — report_cards
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) return;
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS report_cards (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
        student_id INTEGER NOT NULL, term VARCHAR(50),
        class_name VARCHAR(100), grades_json TEXT,
        teacher_comment TEXT, principal_comment TEXT,
        generated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_rc_tenant ON report_cards(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_rc_student ON report_cards(student_id)`);
      console.log('[Gradebook] New migrations applied');
    } catch (e) { console.error('[Gradebook] New migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // GRADE ANALYTICS DASHBOARD
  // ============================================================

  // GET /gradebook/analytics — Trend analysis, outliers, top/bottom performers
  app.get('/gradebook/analytics', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const classId = req.query.class_id || '';
    const term = req.query.term || '';
    const year = req.query.year || new Date().getFullYear().toString();

    const classes = (await pool.query(`SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    // Grade distribution with trend
    const distData = (await pool.query(
      `SELECT CASE WHEN score >= 80 THEN 'A' WHEN score >= 70 THEN 'B' WHEN score >= 60 THEN 'C' WHEN score >= 50 THEN 'D' ELSE 'F' END as grade, COUNT(*)::int as cnt, ROUND(AVG(score),1)::numeric(6,2) as avg FROM grades WHERE tenant_id=$1 AND score IS NOT NULL ${classId ? 'AND class_id=$2' : ''} ${term ? 'AND term=$3' : ''} GROUP BY grade ORDER BY grade`,
      classId ? (term ? [tid, classId, term] : [tid, classId]) : (term ? [tid, term] : [tid])
    )).rows;
    const totalGrades = distData.reduce((s, d) => s + d.cnt, 0);
    const distBar = distData.map(d => {
      const pct = totalGrades > 0 ? Math.round(d.cnt / totalGrades * 100) : 0;
      const colors = { A: '#16a34a', B: '#059669', C: '#2563eb', D: '#d97706', F: '#dc2626' };
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
        <span style="font-size:13px;font-weight:700;color:${colors[d.grade] || '#64748b'};min-width:20px">${d.grade}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:24px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;background:${colors[d.grade] || '#94a3b8'};border-radius:6px"></div>
          <span style="position:absolute;right:6px;top:3px;font-size:11px;font-weight:700;color:#1e293b">${d.cnt} (${pct}%)</span>
        </div>
        <span style="font-size:11px;color:#64748b;min-width:50px">avg ${d.avg}</span>
      </div>`;
    }).join('');

    // Top & Bottom performers
    let performers = [];
    if (classId) {
      performers = (await pool.query(
        `SELECT s.id, s.first_name, s.last_name, s.admission_number,
          COALESCE(AVG(g.score),0)::numeric(6,2) as avg_score,
          RANK() OVER (ORDER BY AVG(g.score) DESC) as rank
        FROM students s LEFT JOIN grades g ON g.student_id=s.id AND g.tenant_id=$1 AND g.class_id=$2 AND g.score IS NOT NULL
        WHERE s.tenant_id=$1 AND s.class_id=$2 GROUP BY s.id, s.first_name, s.last_name, s.admission_number ORDER BY avg_score DESC`,
        [tid, classId]
      )).rows;
    }

    const top5 = performers.filter(p => p.rank <= 5);
    const bottom5 = performers.slice(-5).reverse();
    const stdDev = performers.length > 1 ? Math.sqrt(performers.reduce((s, p) => s + Math.pow(Number(p.avg_score) - performers.reduce((a, b) => a + Number(b.avg_score), 0) / performers.length, 2), 0) / (performers.length - 1)).toFixed(1) : '0';

    // Outlier detection (> 2 std devs from mean)
    const mean = performers.length > 0 ? performers.reduce((a, b) => a + Number(b.avg_score), 0) / performers.length : 0;
    const sd = Number(stdDev) || 1;
    const outliers = performers.filter(p => Math.abs(Number(p.avg_score) - mean) > 2 * sd);

    // Subject comparison chart
    const subjectComp = (await pool.query(
      `SELECT sub.name as subject_name, ROUND(AVG(g.score),1)::numeric(6,2) as class_avg, MIN(g.score) as min_score, MAX(g.score) as max_score, COUNT(*)::int as entries, STDDEV(g.score)::numeric(6,2) as stddev FROM grades g LEFT JOIN subjects sub ON sub.id=g.subject_id WHERE g.tenant_id=$1 AND g.score IS NOT NULL ${classId ? 'AND g.class_id=$2' : ''} ${term ? 'AND g.term=$3' : ''} GROUP BY sub.name ORDER BY class_avg DESC`,
      classId ? (term ? [tid, classId, term] : [tid, classId]) : (term ? [tid, term] : [tid])
    )).rows;
    const maxSubjAvg = Math.max(...subjectComp.map(s => Number(s.class_avg)), 1);

    const subjChartHtml = subjectComp.map(s => {
      const pct = Math.round(Number(s.class_avg) / maxSubjAvg * 100);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;color:#64748b;min-width:120px">${esc(s.subject_name || 'Unknown')}</span>
        <div style="flex:1;background:#f1f5f9;border-radius:6px;height:22px;overflow:hidden;position:relative">
          <div style="height:100%;width:${pct}%;background:${gradeBadge(s.class_avg, 100).includes('#16a34a') ? '#16a34a' : gradeBadge(s.class_avg, 100).includes('#059669') ? '#059669' : '#2563eb'};border-radius:6px"></div>
          <span style="position:absolute;right:6px;top:2px;font-size:11px;font-weight:700;color:#1e293b">${s.class_avg}</span>
        </div>
        <span style="font-size:10px;color:#94a3b8;min-width:50px">σ=${s.stddev || 0}</span>
      </div>`;
    }).join('');

    const topHtml = top5.map(p => `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <div><strong style="color:#16a34a">#${p.rank}</strong> ${esc(p.last_name + ', ' + p.first_name)}</div>
      <span style="font-weight:700;color:#16a34a">${p.avg_score}%</span>
    </div>`).join('');
    const bottomHtml = bottom5.map(p => `<div style="display:flex;align-items:center;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <div><strong style="color:#dc2626">#${p.rank}</strong> ${esc(p.last_name + ', ' + p.first_name)}</div>
      <span style="font-weight:700;color:#dc2626">${p.avg_score}%</span>
    </div>`).join('');
    const outlierHtml = outliers.map(p => `<div style="display:flex;align-items:center;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f1f5f9">
      <div>${esc(p.last_name + ', ' + p.first_name)}</div>
      <span style="font-weight:700;color:#f59e0b">${p.avg_score}% (Δ${Math.abs(Number(p.avg_score) - mean).toFixed(1)})</span>
    </div>`).join('');

    const html = GB_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">🔬 Grade Analytics</h1>
      <div class="gb-filter" style="background:#f8fafc;padding:16px;border-radius:12px;margin-bottom:20px">
        <div><label>Class</label><select onchange="location.href='/gradebook/analytics?class_id='+this.value+'&term=${esc(term)}&year=${esc(year)}'">
          <option value="">All Classes</option>
          ${classes.map(c => `<option value="${c.id}" ${classId == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}
        </select></div>
        <div><label>Term</label><select onchange="location.href='/gradebook/analytics?class_id=${esc(classId)}&term='+this.value+'&year=${esc(year)}'">
          <option value="">All Terms</option>
          <option value="Term 1" ${term==='Term 1'?'selected':''}>Term 1</option>
          <option value="Term 2" ${term==='Term 2'?'selected':''}>Term 2</option>
          <option value="Term 3" ${term==='Term 3'?'selected':''}>Term 3</option>
        </select></div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${totalGrades}</div><div class="muted" style="font-size:11px">Total Entries</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#a855f7">${stdDev}</div><div class="muted" style="font-size:11px">Std Deviation</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${mean.toFixed(1)}%</div><div class="muted" style="font-size:11px">Mean Score</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${outliers.length}</div><div class="muted" style="font-size:11px">Outliers</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="gb-card"><h3 style="margin:0 0 14px;color:#1e293b">Grade Distribution</h3>${distBar || '<p class="muted">No data</p>'}</div>
        <div class="gb-card"><h3 style="margin:0 0 14px;color:#1e293b">Subject Comparison</h3>${subjChartHtml || '<p class="muted">No data</p>'}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="gb-card"><h3 style="margin:0 0 10px;color:#1e293b">🏆 Top 5</h3>${topHtml || '<p class="muted">No data</p>'}</div>
        <div class="gb-card"><h3 style="margin:0 0 10px;color:#1e293b">⚠️ Bottom 5</h3>${bottomHtml || '<p class="muted">No data</p>'}</div>
        <div class="gb-card"><h3 style="margin:0 0 10px;color:#1e293b">🔍 Outliers (±2σ)</h3>${outlierHtml || '<p class="muted">No outliers detected</p>'}</div>
      </div>
    </div>`;
    res.send(renderPage('Grade Analytics', html, user, req));
  }));

  // ============================================================
  // REPORT CARD GENERATION
  // ============================================================

  // GET /gradebook/report-card/:studentId — HTML report card
  app.get('/gradebook/report-card/:studentId', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, studentId = req.params.id;
    const term = req.query.term || 'Term 1';
    const year = req.query.year || new Date().getFullYear().toString();

    const student = (await pool.query(`SELECT * FROM students WHERE id=$1 AND tenant_id=$2`, [studentId, tid])).rows[0];
    if (!student) return res.send(renderPage('Not Found', '<div class="gb-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Student not found</h2></div>', user, req));

    const grades = (await pool.query(
      `SELECT g.*, sub.name as subject_name, c.name as class_name FROM grades g LEFT JOIN subjects sub ON sub.id=g.subject_id LEFT JOIN classes c ON c.id=g.class_id WHERE g.tenant_id=$1 AND g.student_id=$2 AND g.term=$3 AND g.year=$4 AND g.score IS NOT NULL ORDER BY sub.name`,
      [tid, studentId, term, year]
    )).rows;

    const totalScore = grades.reduce((s, g) => s + Number(g.score || 0), 0);
    const count = grades.length;
    const avgScore = count > 0 ? (totalScore / count).toFixed(1) : '0';
    const best = grades.length > 0 ? grades.reduce((a, b) => Number(a.score) >= Number(b.score) ? a : b) : null;
    const worst = grades.length > 0 ? grades.reduce((a, b) => Number(a.score) <= Number(b.score) ? a : b) : null;

    // Rank in class
    let classRank = '—';
    try {
      const rankRow = (await pool.query(
        `SELECT rank FROM (SELECT student_id, RANK() OVER (ORDER BY AVG(score) DESC) as rank FROM grades WHERE tenant_id=$1 AND class_id=$2 AND term=$3 AND year=$4 AND score IS NOT NULL GROUP BY student_id) sub WHERE student_id=$4`,
        [tid, grades[0]?.class_id || 0, term, year, studentId]
      )).rows[0];
      if (rankRow) classRank = '#' + rankRow.rank;
    } catch(e){}

    // Save report card
    try {
      await pool.query(
        `INSERT INTO report_cards (tenant_id, student_id, term, class_name, grades_json, teacher_comment, principal_comment) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, studentId, term, grades[0]?.class_name || '', JSON.stringify(grades.map(g => ({ subject: g.subject_name, score: g.score, remarks: g.remarks }))), '', '']
      );
    } catch(e){}

    const gradesHtml = grades.map(g => `<tr>
      <td><strong>${esc(g.subject_name)}</strong></td>
      <td>${g.score}</td><td>100</td>
      <td>${gradeBadge(g.score, 100)}</td>
      <td class="muted">${esc(g.remarks || '')}</td>
    </tr>`).join('');

    const html = GB_CSS + `<div style="max-width:850px;margin:0 auto;padding:20px">
      <div style="margin-bottom:20px"><a href="/gradebook/reports" style="color:#64748b;text-decoration:none">← Back to Reports</a></div>
      <div class="gb-card" style="text-align:center;padding:32px;border:3px solid #4f46e5;margin-bottom:24px">
        <h1 style="margin:0 0 4px;font-size:22px;color:#1e293b">🏫 Official Report Card</h1>
        <p style="margin:0;color:#94a3b8">${esc(term)} — ${esc(year)}</p>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:24px">
        <div class="gb-card">
          <h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;color:#64748b;letter-spacing:.5px">Student Information</h3>
          <div style="font-size:14px;line-height:2.2">
            <strong>Name:</strong> ${esc(student.first_name + ' ' + student.last_name)}<br>
            <strong>Admission:</strong> ${esc(student.admission_number || '—')}<br>
            <strong>Class:</strong> ${esc(grades[0]?.class_name || '—')}<br>
            <strong>Class Rank:</strong> ${esc(classRank)}
          </div>
        </div>
        <div class="gb-card">
          <h3 style="margin:0 0 12px;font-size:13px;text-transform:uppercase;color:#64748b;letter-spacing:.5px">Performance Summary</h3>
          <div style="font-size:14px;line-height:2.2">
            <strong>Total:</strong> ${totalScore} / ${count * 100}<br>
            <strong>Average:</strong> <span style="font-size:18px;font-weight:700;color:#4f46e5">${avgScore}%</span><br>
            <strong>Best:</strong> ${best ? esc(best.subject_name) + ' (' + best.score + ')' : '—'}<br>
            <strong>Weakest:</strong> ${worst ? esc(worst.subject_name) + ' (' + worst.score + ')' : '—'}
          </div>
        </div>
      </div>
      <div class="gb-card" style="margin-bottom:24px">
        <div style="overflow-x:auto"><table class="gb-table">
          <thead><tr><th>Subject</th><th>Score</th><th>Total</th><th>Grade</th><th>Remarks</th></tr></thead>
          <tbody>${gradesHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No grades</td></tr>'}</tbody>
          <tfoot><tr style="background:#f8fafc;font-weight:700"><td>TOTAL / AVERAGE</td><td>${totalScore}</td><td>${count * 100}</td><td>${gradeBadge(avgScore, 100)}</td><td></td></tr></tfoot>
        </table></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="gb-card"><h3 style="margin:0 0 8px;font-size:13px;color:#64748b;text-transform:uppercase">Class Teacher Comment</h3><p style="color:#94a3b8;font-size:13px">No comment yet.</p></div>
        <div class="gb-card"><h3 style="margin:0 0 8px;font-size:13px;color:#64748b;text-transform:uppercase">Principal Comment</h3><p style="color:#94a3b8;font-size:13px">No comment yet.</p></div>
      </div>
    </div>`;
    res.send(renderPage(`Report Card — ${student.first_name} ${student.last_name}`, html, user, req));
  }));

  // ============================================================
  // GRADE EXPORT (CSV)
  // ============================================================

  // GET /gradebook/export — CSV export of class grades
  app.get('/gradebook/export', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { class_id, subject_id, term, year, format } = req.query;

    let where = ['g.tenant_id=$1'];
    const params = [tid];
    let pi = 2;

    if (class_id) { where.push(`g.class_id=$${pi++}`); params.push(class_id); }
    if (subject_id) { where.push(`g.subject_id=$${pi++}`); params.push(subject_id); }
    if (term) { where.push(`g.term=$${pi++}`); params.push(term); }
    if (year) { where.push(`g.year=$${pi++}`); params.push(year); }

    const grades = (await pool.query(
      `SELECT g.*, s.first_name, s.last_name, s.admission_number, sub.name as subject_name, c.name as class_name
       FROM grades g
       LEFT JOIN students s ON s.id = g.student_id
       LEFT JOIN subjects sub ON sub.id = g.subject_id
       LEFT JOIN classes c ON c.id = g.class_id
       WHERE ${where.join(' AND ')} ORDER BY s.last_name, s.first_name, sub.name`,
      params
    )).rows;

    // Build CSV
    const headers = ['Student Name', 'Admission #', 'Class', 'Subject', 'Score', 'Max Score', 'Term', 'Year', 'Remarks', 'Created At'];
    const rows = grades.map(g => [
      `"${(g.last_name || '') + ', ' + (g.first_name || '')}"`,
      g.admission_number || '',
      g.class_name || '',
      g.subject_name || '',
      g.score ?? '',
      g.max_score ?? '100',
      g.term || '',
      g.year || '',
      `"${(g.remarks || '').replace(/"/g, '""')}"`,
      g.created_at ? new Date(g.created_at).toISOString() : ''
    ]);

    const csv = [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="grades_export_${Date.now()}.csv"`);
    res.send(csv);
  }));

  // ============================================================
  // GRADING SCALES MANAGEMENT
  // ============================================================

  // GET /gradebook/scales — List grading scales
  app.get('/gradebook/scales', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    try {
      const scales = (await pool.query(
        `SELECT * FROM grading_scales WHERE tenant_id=$1 ORDER BY min_score DESC`,
        [tid]
      )).rows;

      const scalesHtml = scales.map(s => `<tr>
        <td><span style="display:inline-block;padding:4px 12px;border-radius:8px;font-weight:700;font-size:14px;background:${gradeBadge(s.max_score, 100).includes('#16a34a') ? '#dcfce7' : gradeBadge(s.max_score, 100).includes('#059669') ? '#d1fae5' : gradeBadge(s.max_score, 100).includes('#2563eb') ? '#dbeafe' : '#fef3c7'};color:#1e293b">${esc(s.grade_label || '—')}</span></td>
        <td>${s.min_score} — ${s.max_score}</td>
        <td>${s.grade_point || '—'}</td>
        <td class="muted">${esc(s.description || s.name || '—')}</td>
        <td>${s.is_active !== false ? '<span class="badge badge-success">Active</span>' : '<span class="badge badge-error">Inactive</span>'}</td>
      </tr>`).join('');

      const html = GB_CSS + `<div style="max-width:1000px;margin:0 auto">
        ${nav('')}
        <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📐 Grading Scales</h1>
        <div class="gb-card" style="padding:20px;margin-bottom:16px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Current Grading Scale</h3>
          <div style="overflow-x:auto"><table class="gb-table">
            <thead><tr><th>Grade</th><th>Score Range</th><th>Grade Point</th><th>Description</th><th>Status</th></tr></thead>
            <tbody>${scalesHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:30px">No grading scales configured. Use the API or default A-F scale applies.</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="gb-card" style="padding:24px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:16px">➕ Add Grading Scale Entry</h3>
          <form method="POST" action="/gradebook/scales" style="display:flex;flex-wrap:wrap;gap:14px;align-items:end">
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Grade Label *</label>
              <input type="text" name="grade_label" required placeholder="A, B, C..." style="width:100px;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Min Score *</label>
              <input type="number" name="min_score" required placeholder="80" style="width:100px;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Max Score *</label>
              <input type="number" name="max_score" required placeholder="100" style="width:100px;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Grade Point</label>
              <input type="number" step="0.01" name="grade_point" placeholder="4.0" style="width:100px;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Description</label>
              <input type="text" name="description" placeholder="Excellent" style="width:200px;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <button type="submit" class="gb-btn gb-btn-primary">➕ Add Scale</button>
          </form>
        </div>
      </div>`;
      res.send(renderPage('Grading Scales', html, user, req));
    } catch(e) {
      res.status(500).send('Failed to load grading scales');
    }
  }));

  // POST /gradebook/scales — Create grading scale
  app.post('/gradebook/scales', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { grade_label, min_score, max_score, grade_point, description } = req.body;
    if (!grade_label || min_score == null || max_score == null) {
      req.session.flash = { type: 'error', msg: 'Grade label and score range are required' };
      return res.redirect('/gradebook/scales');
    }
    try {
      await pool.query(
        `INSERT INTO grading_scales (tenant_id, name, grade_label, min_score, max_score, grade_point, description) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [tid, grade_label.trim(), grade_label.trim(), Number(min_score), Number(max_score), grade_point ? Number(grade_point) : null, (description || '').trim()]
      );
      req.session.flash = { type: 'success', msg: `Grading scale "${grade_label}" added successfully` };
    } catch(e) {
      req.session.flash = { type: 'error', msg: 'Failed to add grading scale' };
    }
    res.redirect('/gradebook/scales');
  }));

  // ============================================================
  // DARK MODE CSS — Gradebook
  // ============================================================
  const GB_DARK_CSS = `<style>
    @media(prefers-color-scheme:dark){
      .gb-nav a{background:#1e293b;color:#cbd5e1}
      .gb-nav a:hover{background:#334155}
      .gb-nav a.active{background:#4f46e5;color:#fff}
      .gb-btn-secondary{background:#1e293b;color:#cbd5e1}
      .gb-btn-danger{background:#451a1a;color:#fca5a5}
      .gb-card{background:#1e293b;border-color:#334155}
      .gb-table th{background:#0f172a;color:#94a3b8;border-bottom-color:#334155}
      .gb-table td{color:#e2e8f0;border-bottom-color:#1e293b}
      .gb-table tr:hover{background:#1e293b}
      .gb-filter input,.gb-filter select{background:#0f172a;border-color:#334155;color:#e2e8f0}
      .gb-mark-input{background:#0f172a;border-color:#334155;color:#e2e8f0}
      .gb-mark-input:focus{background:#1e1b4b}
      .stat-card{background:#1e293b}
      .stat-num{color:#f1f5f9}
      .card{background:#1e293b;border-color:#334155}
      .badge{border:1px solid #334155}
      input,select,textarea{background:#0f172a!important;border-color:#334155!important;color:#e2e8f0!important}
      form input,form select,form textarea{background:#0f172a;border-color:#334155;color:#e2e8f0}
      h1,h2,h3,h4,h5,h6{color:#f1f5f9!important}
      p,.muted{color:#94a3b8!important}
      thead tr{background:#0f172a!important}
    }
  </style>`;

  // Serve dark mode CSS for gradebook pages
  app.get('/gradebook/dark-mode.css', requireAuth, (req, res) => {
    res.type('text/css').send(GB_DARK_CSS);
  });

};
