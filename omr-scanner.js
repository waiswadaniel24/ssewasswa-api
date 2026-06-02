/**
 * OMR (Optical Mark Recognition) Scanner Module
 * Automated exam grading via bubble sheet scanning
 * Prefix: /school/omr/
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  /* ─── helpers ─────────────────────────────────────────────── */
  const tid = (req) => req.session?.user?.tenant_id || 0;
  const uid = (req) => req.session?.user?.id || 0;

  const LAYOUTS = { 40: { cols: 4, rows: 10 }, 60: { cols: 5, rows: 12 }, 100: { cols: 5, rows: 20 }, 200: { cols: 5, rows: 40 } };

  function gradeFromPct(p) {
    if (p >= 90) return 'A+'; if (p >= 80) return 'A'; if (p >= 70) return 'B+';
    if (p >= 60) return 'B'; if (p >= 50) return 'C'; if (p >= 40) return 'D'; return 'F';
  }

  function calcStats(arr) {
    if (!arr.length) return { mean: 0, median: 0, mode: 0, stdDev: 0, min: 0, max: 0 };
    const sorted = [...arr].sort((a,b) => a - b);
    const n = arr.length;
    const mean = arr.reduce((s,v) => s+v, 0) / n;
    const median = n % 2 === 0 ? (sorted[n/2-1] + sorted[n/2]) / 2 : sorted[Math.floor(n/2)];
    const freq = {};
    arr.forEach(v => freq[v] = (freq[v]||0) + 1);
    const mode = +Object.keys(freq).reduce((a,b) => freq[a] > freq[b] ? a : b);
    const variance = arr.reduce((s,v) => s + (v - mean)**2, 0) / n;
    return { mean: +mean.toFixed(2), median: +median.toFixed(2), mode, stdDev: +Math.sqrt(variance).toFixed(2), min: sorted[0], max: sorted[n-1] };
  }

  function cssBar(pct, color) {
    return `<div style="background:#e2e8f0;border-radius:6px;height:18px;width:140px;display:inline-block;vertical-align:middle;overflow:hidden">
      <div style="background:${color||'#3b82f6'};height:100%;width:${Math.min(100,Math.max(0,pct))}%;border-radius:6px"></div></div>
      <span style="margin-left:6px;font-size:13px">${pct.toFixed(1)}%</span>`;
  }

  function bubbleGrid(questions, options, studentAnswers, correctAnswers, negMark, showResult) {
    const opts = options || ['A','B','C','D'];
    let html = '<div style="overflow-x:auto"><table style="border-collapse:collapse;font-size:13px;margin:0 auto">';
    html += '<tr><th style="padding:4px 8px;background:#1e293b;color:#fff">Q#</th>';
    opts.forEach(o => html += `<th style="padding:4px 8px;background:#1e293b;color:#fff">${esc(o)}</th>`);
    html += '<th style="padding:4px 8px;background:#1e293b;color:#fff">Status</th></tr>';
    questions.forEach((q, i) => {
      const qNum = i + 1;
      const sa = studentAnswers ? studentAnswers[i] : null;
      const ca = correctAnswers ? correctAnswers[i] : null;
      const isCorrect = showResult && sa && ca && sa === ca;
      const isWrong = showResult && sa && ca && sa !== ca;
      const rowBg = isCorrect ? '#dcfce7' : (isWrong ? '#fef2f2' : '#fff');
      html += `<tr style="background:${rowBg}"><td style="padding:4px 6px;text-align:center;font-weight:600">${qNum}</td>`;
      opts.forEach(o => {
        const isMarked = sa === o;
        const isCorrectOpt = ca === o;
        let bubbleStyle = 'display:inline-block;width:28px;height:28px;border-radius:50%;border:2px solid #64748b;text-align:center;line-height:24px;font-weight:700;';
        if (isMarked && isCorrect) bubbleStyle += 'background:#22c55e;color:#fff;border-color:#16a34a;';
        else if (isMarked && isWrong) bubbleStyle += 'background:#ef4444;color:#fff;border-color:#dc2626;';
        else if (isCorrectOpt && showResult) bubbleStyle += 'background:#bbf7d0;color:#16a34a;border-color:#22c55e;';
        html += `<td style="text-align:center;padding:3px"><span style="${bubbleStyle}">${isMarked ? esc(o) : ''}</span></td>`;
      });
      let status = '';
      if (showResult) {
        if (!sa) status = '<span style="color:#94a3b8">--</span>';
        else if (isCorrect) status = `<span style="color:#16a34a;font-weight:600">+${esc(q.marks || 1)}</span>`;
        else status = `<span style="color:#dc2626;font-weight:600">${negMark ? negMark : 0}</span>`;
      }
      html += `<td style="padding:4px 8px">${status}</td></tr>`;
    });
    html += '</table></div>';
    return html;
  }

  /* ─── DB init ─────────────────────────────────────────────── */
  async function initDB() {
    const queries = [
      `CREATE TABLE IF NOT EXISTS omr_templates (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        name VARCHAR(200) NOT NULL, description TEXT,
        total_questions INT DEFAULT 40, options_per_q INT DEFAULT 4, sections JSON,
        layout VARCHAR(20) DEFAULT '40Q', marks_per_q DECIMAL(5,2) DEFAULT 1.00,
        negative_marking DECIMAL(5,2) DEFAULT 0.00, pass_percentage DECIMAL(5,2) DEFAULT 40.00,
        barcode_field VARCHAR(50) DEFAULT 'roll_number',
        created_by INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS omr_answer_keys (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        template_id INT NOT NULL, set_name VARCHAR(10) DEFAULT 'A',
        answers TEXT NOT NULL, marks_override TEXT,
        created_by INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS omr_exams (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        name VARCHAR(200) NOT NULL, template_id INT, subject_id INT DEFAULT 0, class_id INT DEFAULT 0,
        exam_date DATE, duration_minutes INT DEFAULT 60, total_marks DECIMAL(6,2),
        answer_key_id INT, status TEXT DEFAULT 'draft',
        sheets_uploaded INT DEFAULT 0, sheets_processed INT DEFAULT 0, sheets_total INT DEFAULT 0,
        instructions TEXT, created_by INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS omr_scanned_sheets (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        exam_id INT NOT NULL, student_id INT DEFAULT 0, roll_number VARCHAR(50),
        student_name VARCHAR(200), raw_answers TEXT,
        detected_confidence JSON, ambiguous_questions JSON,
        image_path VARCHAR(500), scan_quality TEXT DEFAULT 'medium',
        processed SMALLINT DEFAULT 0, error_message TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS omr_results (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        exam_id INT NOT NULL, student_id INT NOT NULL,
        total_marks DECIMAL(6,2) DEFAULT 0, max_marks DECIMAL(6,2) DEFAULT 0,
        correct_count INT DEFAULT 0, wrong_count INT DEFAULT 0, unattempted INT DEFAULT 0,
        negative_marks DECIMAL(6,2) DEFAULT 0, percentage DECIMAL(5,2) DEFAULT 0,
        grade VARCHAR(5), rank INT DEFAULT 0, section_wise JSON,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_exam_student UNIQUE (exam_id, student_id, tenant_id))`,
      `CREATE TABLE IF NOT EXISTS omr_result_analysis (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        exam_id INT NOT NULL, question_number INT,
        correct_pct DECIMAL(5,2) DEFAULT 0, option_a_pct DECIMAL(5,2) DEFAULT 0,
        option_b_pct DECIMAL(5,2) DEFAULT 0, option_c_pct DECIMAL(5,2) DEFAULT 0,
        option_d_pct DECIMAL(5,2) DEFAULT 0, option_e_pct DECIMAL(5,2) DEFAULT 0,
        difficulty_index DECIMAL(5,2) DEFAULT 0, discrimination_index DECIMAL(5,2) DEFAULT 0,
        most_common_wrong VARCHAR(5), created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_exam_q UNIQUE (exam_id, question_number, tenant_id))`
    ];
    for (const sql of queries) { try { await migrateQuery(pool, 'OMR', sql); } catch(e) { console.error('OMR init:', e.message); } }
  }
  initDB().catch(() => {});

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 1 — Dashboard
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/', requireAuth, ah(async (req, res) => {
    const [exams] = await pool.query(`SELECT e.*, t.name AS template_name,
      (SELECT COUNT(*) FROM omr_results r WHERE r.exam_id=e.id AND r.tenant_id=?) AS result_count
      FROM omr_exams e LEFT JOIN omr_templates t ON t.id=e.template_id
      WHERE e.tenant_id=? ORDER BY e.created_at DESC LIMIT 20`, [tid(req), tid(req)]);
    const [tmplCount] = await pool.query('SELECT COUNT(*) AS c FROM omr_templates WHERE tenant_id=?', [tid(req)]);
    const [scanCount] = await pool.query('SELECT COUNT(*) AS c FROM omr_scanned_sheets WHERE tenant_id=?', [tid(req)]);
    const statsHtml = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px">
        ${[['Templates', tmplCount[0].c, '#3b82f6', 'fa-file-alt'],
           ['Exams', exams.length, '#8b5cf6', 'fa-clipboard-check'],
           ['Scanned Sheets', scanCount[0].c, '#f59e0b', 'fa-barcode'],
           ['Result Sets', exams.reduce((s,e)=>s+e.result_count,0), '#10b981', 'fa-chart-bar']].map(([label,val,color,icon]) =>
          `<div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);border-left:4px solid ${color}">
            <div style="font-size:13px;color:#64748b">${label}</div>
            <div style="font-size:28px;font-weight:700;color:${color};margin-top:4px">${val}</div>
          </div>`).join('')}
      </div>`;

    let tableRows = exams.length === 0
      ? '<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">No OMR exams created yet</td></tr>'
      : exams.map(e => {
          const statusColors = { draft:'#94a3b8', scheduled:'#f59e0b', active:'#3b82f6', scanning:'#8b5cf6', completed:'#10b981', published:'#059669' };
          const pct = e.sheets_total > 0 ? Math.round(e.sheets_processed / e.sheets_total * 100) : 0;
          return `<tr>
            <td><a href="/school/omr/exams/${esc(e.id)}" style="color:#3b82f6;font-weight:600;text-decoration:none">${esc(e.name)}</a></td>
            <td>${esc(e.template_name || '-')}</td>
            <td>${esc(e.exam_date || '-')}</td>
            <td><span style="background:${statusColors[e.status]||'#94a3b8'};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600">${esc(e.status)}</span></td>
            <td>${cssBar(pct, '#3b82f6')}<span style="font-size:12px;color:#64748b">${e.sheets_processed}/${e.sheets_total}</span></td>
            <td>${e.result_count}</td>
            <td><a href="/school/omr/results/${esc(e.id)}" class="btn" style="font-size:12px;padding:4px 12px">Results</a>
                <a href="/school/omr/analysis/${esc(e.id)}" class="btn btn-secondary" style="font-size:12px;padding:4px 12px">Analysis</a></td>
          </tr>`;
        }).join('');

    res.send(renderPage('OMR Scanner', `
      <div class="page-header"><h2>OMR Scanner</h2>
        <div style="display:flex;gap:8px;margin-top:8px">
          <a href="/school/omr/templates/new" class="btn btn-primary">+ New Template</a>
          <a href="/school/omr/exams/new" class="btn btn-primary">+ New Exam</a>
          <a href="/school/omr/templates" class="btn">Templates</a>
          <a href="/school/omr/scan" class="btn">Scan Sheet</a>
          <a href="/school/omr/batch-scan" class="btn">Batch Scan</a>
        </div>
      </div>
      ${statsHtml}
      <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <h3 style="margin:0 0 12px;font-size:16px">Recent Exams</h3>
        <div style="overflow-x:auto"><table class="table">
          <thead><tr><th>Exam Name</th><th>Template</th><th>Date</th><th>Status</th><th>Progress</th><th>Results</th><th>Actions</th></tr></thead>
          <tbody>${tableRows}</tbody>
        </table></div>
      </div>
    `, req));
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTES 2-7 — Template CRUD
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/templates', requireAuth, ah(async (req, res) => {
    const [templates] = await pool.query('SELECT * FROM omr_templates WHERE tenant_id=? ORDER BY created_at DESC', [tid(req)]);
    const rows = templates.length === 0
      ? '<tr><td colspan="5" style="text-align:center;padding:40px;color:#94a3b8">No templates yet. Create one to get started.</td></tr>'
      : templates.map(t => `<tr>
          <td><a href="/school/omr/templates/${esc(t.id)}" style="color:#3b82f6;font-weight:600;text-decoration:none">${esc(t.name)}</a></td>
          <td>${esc(t.description || '-').substring(0, 60)}</td>
          <td><span style="background:#e0e7ff;color:#3730a3;padding:2px 8px;border-radius:8px;font-size:12px;font-weight:600">${esc(t.layout)}</span></td>
          <td>${t.total_questions} Q &bull; ${t.options_per_q} opts</td>
          <td>
            <a href="/school/omr/templates/${esc(t.id)}/edit" class="btn btn-secondary" style="font-size:12px;padding:3px 10px">Edit</a>
            <a href="/school/omr/answer-keys?template_id=${esc(t.id)}" class="btn" style="font-size:12px;padding:3px 10px">Answer Key</a>
            <a href="/school/omr/generate/${esc(t.id)}" class="btn btn-primary" style="font-size:12px;padding:3px 10px">Generate</a>
            <form method="POST" action="/school/omr/templates/${esc(t.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this template?')">
              <button class="btn btn-danger" style="font-size:12px;padding:3px 10px">Delete</button></form>
          </td></tr>`).join('');

    res.send(renderPage('OMR Templates', `
      <div class="page-header"><h2>OMR Sheet Templates</h2>
        <a href="/school/omr/templates/new" class="btn btn-primary">+ New Template</a></div>
      <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <table class="table"><thead><tr><th>Name</th><th>Description</th><th>Layout</th><th>Config</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    `, req));
  }));

  app.get('/school/omr/templates/new', requireAuth, ah(async (req, res) => {
    const formHtml = templateForm({});
    res.send(renderPage('Create OMR Template', formHtml, req));
  }));

  app.post('/school/omr/templates/new', requireAuth, ah(async (req, res) => {
    const { name, description, total_questions, options_per_q, layout, marks_per_q, negative_marking, pass_percentage, sections } = req.body;
    const sec = sections ? JSON.stringify(JSON.parse(sections)) : null;
    await pool.query(
      `INSERT INTO omr_templates (tenant_id,name,description,total_questions,options_per_q,layout,marks_per_q,negative_marking,pass_percentage,sections,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [tid(req), name, description, +total_questions, +options_per_q, layout, +marks_per_q, +negative_marking, +pass_percentage, sec, uid(req)]
    );
    audit(req, 'omr_template_create', { name });
    res.redirect('/school/omr/templates');
  }));

  app.get('/school/omr/templates/:id', requireAuth, ah(async (req, res) => {
    const [templates] = await pool.query('SELECT * FROM omr_templates WHERE id=? AND tenant_id=?', [req.params.id, tid(req)]);
    if (!templates.length) return res.status(404).send('Template not found');
    const t = templates[0];
    const [keys] = await pool.query('SELECT * FROM omr_answer_keys WHERE template_id=? AND tenant_id=?', [t.id, tid(req)]);
    const secs = t.sections ? JSON.parse(t.sections) : [];
    const secHtml = secs.length ? secs.map((s,i) => `<div style="background:#f1f5f9;padding:10px;border-radius:8px;margin-bottom:6px">
        <strong>${esc(s.name || 'Section '+(i+1))}</strong>: Q${s.start}-${s.end}</div>`).join('') : '<span style="color:#94a3b8">No sections defined</span>';

    const keyRows = keys.length === 0
      ? '<tr><td colspan="4" style="text-align:center;padding:20px;color:#94a3b8">No answer keys</td></tr>'
      : keys.map(k => `<tr><td>${esc(k.set_name)}</td><td>${esc(k.answers)}</td>
          <td>${k.created_at ? k.created_at.toISOString().split('T')[0] : '-'}</td>
          <td><a href="/school/omr/answer-keys/${esc(k.id)}/edit" class="btn btn-secondary" style="font-size:12px;padding:3px 8px">Edit</a></td></tr>`).join('');

    res.send(renderPage('Template: ' + t.name, `
      <div class="page-header"><h2>${esc(t.name)}</h2>
        <div style="display:flex;gap:8px;margin-top:8px">
          <a href="/school/omr/templates/${esc(t.id)}/edit" class="btn btn-secondary">Edit</a>
          <a href="/school/omr/answer-keys/new?template_id=${esc(t.id)}" class="btn btn-primary">+ Answer Key</a>
          <a href="/school/omr/generate/${esc(t.id)}" class="btn btn-primary">Generate Sheet</a>
        </div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <h3 style="font-size:15px;margin:0 0 12px">Configuration</h3>
          <table style="width:100%;font-size:14px">
            <tr><td style="padding:6px;color:#64748b">Questions</td><td style="font-weight:600">${t.total_questions}</td></tr>
            <tr><td style="padding:6px;color:#64748b">Options per Q</td><td style="font-weight:600">${t.options_per_q}</td></tr>
            <tr><td style="padding:6px;color:#64748b">Layout</td><td style="font-weight:600">${esc(t.layout)}</td></tr>
            <tr><td style="padding:6px;color:#64748b">Marks/Question</td><td style="font-weight:600">${t.marks_per_q}</td></tr>
            <tr><td style="padding:6px;color:#64748b">Negative Marking</td><td style="font-weight:600">${t.negative_marking}</td></tr>
            <tr><td style="padding:6px;color:#64748b">Pass %</td><td style="font-weight:600">${t.pass_percentage}%</td></tr>
          </table>
          <h4 style="font-size:14px;margin:16px 0 8px">Sections</h4>${secHtml}
        </div>
        <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <h3 style="font-size:15px;margin:0 0 12px">Answer Keys</h3>
          <table class="table"><thead><tr><th>Set</th><th>Answers</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>${keyRows}</tbody></table>
        </div>
      </div>
    `, req));
  }));

  app.get('/school/omr/templates/:id/edit', requireAuth, ah(async (req, res) => {
    const [templates] = await pool.query('SELECT * FROM omr_templates WHERE id=? AND tenant_id=?', [req.params.id, tid(req)]);
    if (!templates.length) return res.status(404).send('Template not found');
    res.send(renderPage('Edit Template', templateForm(templates[0]), req));
  }));

  app.post('/school/omr/templates/:id/edit', requireAuth, ah(async (req, res) => {
    const { name, description, total_questions, options_per_q, layout, marks_per_q, negative_marking, pass_percentage, sections } = req.body;
    const sec = sections ? JSON.stringify(JSON.parse(sections)) : null;
    await pool.query(
      `UPDATE omr_templates SET name=?,description=?,total_questions=?,options_per_q=?,layout=?,marks_per_q=?,negative_marking=?,pass_percentage=?,sections=? WHERE id=? AND tenant_id=?`,
      [name, description, +total_questions, +options_per_q, layout, +marks_per_q, +negative_marking, +pass_percentage, sec, req.params.id, tid(req)]
    );
    audit(req, 'omr_template_edit', { id: req.params.id });
    res.redirect('/school/omr/templates');
  }));

  app.post('/school/omr/templates/:id/delete', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM omr_templates WHERE id=? AND tenant_id=?', [req.params.id, tid(req)]);
    audit(req, 'omr_template_delete', { id: req.params.id });
    res.redirect('/school/omr/templates');
  }));

  function templateForm(t) {
    const isEdit = t && t.id;
    const secs = t.sections ? JSON.parse(t.sections) : [];
    const secRows = secs.map((s, i) =>
      `<div class="section-row" style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
        <input name="sec_name[]" value="${esc(s.name||'')}" placeholder="Section Name" style="flex:1;padding:6px;border:1px solid #cbd5e1;border-radius:6px">
        <input name="sec_start[]" type="number" value="${s.start||''}" placeholder="From Q" style="width:80px;padding:6px;border:1px solid #cbd5e1;border-radius:6px">
        <input name="sec_end[]" type="number" value="${s.end||''}" placeholder="To Q" style="width:80px;padding:6px;border:1px solid #cbd5e1;border-radius:6px">
        <button type="button" onclick="this.parentElement.remove()" class="btn btn-danger" style="padding:4px 8px">✕</button></div>`).join('');

    return `<div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:800px">
      <h3 style="margin:0 0 16px">${isEdit ? 'Edit' : 'Create'} OMR Template</h3>
      <form method="POST" action="${isEdit ? '/school/omr/templates/'+t.id+'/edit' : '/school/omr/templates/new'}">
        <div style="margin-bottom:12px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Template Name *</label>
          <input name="name" value="${esc(t.name||'')}" required style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px"></div>
        <div style="margin-bottom:12px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Description</label>
          <textarea name="description" rows="2" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px">${esc(t.description||'')}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Sheet Layout</label>
            <select name="layout" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
              ${['40Q','60Q','100Q','200Q'].map(l => `<option value="${l}" ${(t.layout||'40Q')===l?'selected':''}>${l}</option>`).join('')}
            </select></div>
          <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Options per Question</label>
            <select name="options_per_q" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
              ${[4,5].map(n => `<option value="${n}" ${(t.options_per_q||4)===n?'selected':''}>${n} (A${n===5?'-E':'-D'})</option>`).join('')}
            </select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Total Questions</label>
            <input name="total_questions" type="number" value="${t.total_questions||40}" min="1" max="300" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Marks / Question</label>
            <input name="marks_per_q" type="number" step="0.5" value="${t.marks_per_q||1}" min="0" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Negative Marking</label>
            <input name="negative_marking" type="number" step="0.25" value="${t.negative_marking||0}" min="0" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
        </div>
        <div style="margin-bottom:12px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Pass Percentage</label>
          <input name="pass_percentage" type="number" value="${t.pass_percentage||40}" min="0" max="100" style="width:200px;padding:8px;border:1px solid #cbd5e1;border-radius:8px">%</div>
        <div style="margin-bottom:16px">
          <label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Sections (optional)</label>
          <div id="sections-container">${secRows}</div>
          <button type="button" onclick="addSection()" class="btn btn-secondary" style="margin-top:6px">+ Add Section</button>
        </div>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Update' : 'Create'} Template</button>
        <a href="/school/omr/templates" class="btn">Cancel</a>
      </form>
    </div>
    <script>
      function addSection() {
        const c = document.getElementById('sections-container');
        const div = document.createElement('div');
        div.className = 'section-row';
        div.style.cssText = 'display:flex;gap:8px;align-items:center;margin-bottom:6px';
        div.innerHTML = '<input name="sec_name[]" placeholder="Section Name" style="flex:1;padding:6px;border:1px solid #cbd5e1;border-radius:6px">'
          + '<input name="sec_start[]" type="number" placeholder="From Q" style="width:80px;padding:6px;border:1px solid #cbd5e1;border-radius:6px">'
          + '<input name="sec_end[]" type="number" placeholder="To Q" style="width:80px;padding:6px;border:1px solid #cbd5e1;border-radius:6px">'
          + '<button type="button" onclick="this.parentElement.remove()" class="btn btn-danger" style="padding:4px 8px">✕</button>';
        c.appendChild(div);
      }
    </script>`;
  }

  /* ═══════════════════════════════════════════════════════════════
     ROUTES 8-11 — Answer Keys
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/answer-keys', requireAuth, ah(async (req, res) => {
    const templateId = req.query.template_id;
    const sql = templateId
      ? 'SELECT ak.*, t.name AS template_name FROM omr_answer_keys ak JOIN omr_templates t ON t.id=ak.template_id WHERE ak.tenant_id=? AND ak.template_id=?'
      : 'SELECT ak.*, t.name AS template_name FROM omr_answer_keys ak JOIN omr_templates t ON t.id=ak.template_id WHERE ak.tenant_id=?';
    const params = templateId ? [tid(req), +templateId] : [tid(req)];
    const [keys] = await pool.query(sql, params);
    const rows = keys.length === 0
      ? '<tr><td colspan="5" style="text-align:center;padding:40px;color:#94a3b8">No answer keys</td></tr>'
      : keys.map(k => `<tr>
          <td>${esc(k.template_name)}</td><td>${esc(k.set_name)}</td>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k.answers)}</td>
          <td>${k.created_at ? k.created_at.toISOString().split('T')[0] : '-'}</td>
          <td><a href="/school/omr/answer-keys/${esc(k.id)}/edit" class="btn btn-secondary" style="font-size:12px;padding:3px 8px">Edit</a></td>
        </tr>`).join('');

    res.send(renderPage('Answer Keys', `
      <div class="page-header"><h2>Answer Keys</h2>
        <a href="/school/omr/answer-keys/new${templateId ? '?template_id='+templateId : ''}" class="btn btn-primary">+ New Answer Key</a></div>
      <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <table class="table"><thead><tr><th>Template</th><th>Set</th><th>Answers</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    `, req));
  }));

  app.get('/school/omr/answer-keys/new', requireAuth, ah(async (req, res) => {
    const [templates] = await pool.query('SELECT id, name, total_questions, options_per_q FROM omr_templates WHERE tenant_id=?', [tid(req)]);
    const selId = req.query.template_id || (templates.length ? templates[0].id : 0);
    let qCount = 40, optsPerQ = 4;
    if (selId) { const t = templates.find(x => x.id === +selId); if (t) { qCount = t.total_questions; optsPerQ = t.options_per_q; } }
    res.send(renderPage('New Answer Key', answerKeyForm(null, templates, +selId, qCount, optsPerQ), req));
  }));

  app.post('/school/omr/answer-keys/new', requireAuth, ah(async (req, res) => {
    const { template_id, set_name, answers } = req.body;
    await pool.query(
      `INSERT INTO omr_answer_keys (tenant_id,template_id,set_name,answers,created_by) VALUES (?,?,?,?,?)`,
      [tid(req), +template_id, set_name, answers, uid(req)]
    );
    audit(req, 'omr_answer_key_create', { template_id, set_name });
    res.redirect('/school/omr/answer-keys?template_id=' + template_id);
  }));

  app.get('/school/omr/answer-keys/:id/edit', requireAuth, ah(async (req, res) => {
    const [keys] = await pool.query('SELECT ak.*, t.total_questions, t.options_per_q FROM omr_answer_keys ak JOIN omr_templates t ON t.id=ak.template_id WHERE ak.id=? AND ak.tenant_id=?', [req.params.id, tid(req)]);
    if (!keys.length) return res.status(404).send('Answer key not found');
    const k = keys[0];
    const [templates] = await pool.query('SELECT id, name, total_questions, options_per_q FROM omr_templates WHERE tenant_id=?', [tid(req)]);
    res.send(renderPage('Edit Answer Key', answerKeyForm(k, templates, k.template_id, k.total_questions, k.options_per_q), req));
  }));

  app.post('/school/omr/answer-keys/:id/edit', requireAuth, ah(async (req, res) => {
    const { template_id, set_name, answers } = req.body;
    await pool.query('UPDATE omr_answer_keys SET template_id=?,set_name=?,answers=? WHERE id=? AND tenant_id=?',
      [+template_id, set_name, answers, req.params.id, tid(req)]);
    audit(req, 'omr_answer_key_edit', { id: req.params.id });
    res.redirect('/school/omr/answer-keys?template_id=' + template_id);
  }));

  function answerKeyForm(k, templates, selId, qCount, optsPerQ) {
    const isEdit = k && k.id;
    const answers = k ? k.answers : '';
    const opts = 'ABCDE'.substring(0, optsPerQ).split('');
    return `<div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:900px">
      <h3 style="margin:0 0 16px">${isEdit ? 'Edit' : 'Create'} Answer Key</h3>
      <form method="POST" action="${isEdit ? '/school/omr/answer-keys/'+k.id+'/edit' : '/school/omr/answer-keys/new'}">
        <div style="display:flex;gap:12px;margin-bottom:16px">
          <div style="flex:1"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Template</label>
            <select name="template_id" id="ak_template" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px" ${isEdit ? 'disabled' : ''}>
              ${templates.map(t => `<option value="${t.id}" ${t.id===selId?'selected':''}>${esc(t.name)} (${t.total_questions}Q)</option>`).join('')}
            </select></div>
          <div style="width:160px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Set Name</label>
            <select name="set_name" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
              ${['A','B','C','D'].map(s => `<option value="${s}" ${(!isEdit||k.set_name===s)?'selected':''}>Set ${s}</option>`).join('')}
            </select></div>
        </div>
        <div style="margin-bottom:16px">
          <label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Answers (comma-separated, one per question: A,B,C,...)</label>
          <textarea name="answers" id="ak_answers" rows="3" placeholder="A,B,C,D,A,B,..." style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px;font-family:monospace;font-size:14px">${esc(answers)}</textarea>
          <div style="font-size:12px;color:#64748b;margin-top:4px">Total: <span id="ak_count">0</span> answers expected for selected template</div>
        </div>
        <div id="ak_grid" style="margin-bottom:16px"></div>
        <div><button type="submit" class="btn btn-primary">${isEdit ? 'Update' : 'Create'} Answer Key</button>
          <a href="/school/omr/answer-keys" class="btn">Cancel</a></div>
      </form>
    </div>
    <script>
      const opts = ${JSON.stringify(opts)};
      const templates = ${JSON.stringify(templates.map(t=>({id:t.id,q:t.total_questions,o:t.options_per_q})))};
      function renderGrid() {
        const sel = document.getElementById('ak_template');
        const t = templates.find(x => x.id == sel.value);
        if (!t) return;
        const answers = document.getElementById('ak_answers').value.split(',').map(s=>s.trim().toUpperCase());
        let html = '<table style="border-collapse:collapse;font-size:13px"><tr><th style="padding:4px 6px;background:#1e293b;color:#fff">Q#</th>';
        for (const o of opts) html += '<th style="padding:4px 6px;background:#1e293b;color:#fff">'+o+'</th>';
        html += '</tr>';
        for (let i = 0; i < t.q; i++) {
          const a = answers[i] || '';
          html += '<tr><td style="padding:4px 6px;font-weight:600;text-align:center">'+(i+1)+'</td>';
          for (const o of opts) {
            const marked = a === o;
            html += '<td style="text-align:center;padding:3px"><span style="display:inline-block;width:28px;height:28px;border-radius:50%;border:2px solid #64748b;text-align:center;line-height:24px;font-weight:700;'
              + (marked ? 'background:#3b82f6;color:#fff;border-color:#2563eb;' : '') + '">' + (marked ? o : '') + '</span></td>';
          }
          html += '</tr>';
        }
        html += '</table>';
        document.getElementById('ak_grid').innerHTML = html;
        document.getElementById('ak_count').textContent = t.q;
      }
      document.getElementById('ak_template')?.addEventListener('change', renderGrid);
      document.getElementById('ak_answers')?.addEventListener('input', renderGrid);
      renderGrid();
    </script>`;
  }

  /* ═══════════════════════════════════════════════════════════════
     ROUTES 12-13 — Sheet Generation
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/generate/:id', requireAuth, ah(async (req, res) => {
    const [templates] = await pool.query('SELECT * FROM omr_templates WHERE id=? AND tenant_id=?', [req.params.id, tid(req)]);
    if (!templates.length) return res.status(404).send('Template not found');
    const t = templates[0];
    res.send(renderPage('Generate OMR Sheet', `
      <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:600px">
        <h3 style="margin:0 0 16px">Generate Sheet: ${esc(t.name)}</h3>
        <form method="POST" action="/school/omr/generate/${esc(t.id)}" target="_blank">
          <div style="margin-bottom:12px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Student Name</label>
            <input name="student_name" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Roll Number</label>
              <input name="roll_number" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
            <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Class / Section</label>
              <input name="class_section" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Subject</label>
              <input name="subject" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
            <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Set</label>
              <select name="answer_set" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
                ${['A','B','C','D'].map(s=>`<option value="${s}">Set ${s}</option>`).join('')}
              </select></div>
          </div>
          <div style="margin-bottom:16px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Answer Key ID (optional, for quick link)</label>
            <input name="exam_id" type="number" style="width:200px;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          <button type="submit" class="btn btn-primary">Generate Printable Sheet</button>
        </form>
      </div>
    `, req));
  }));

  app.post('/school/omr/generate/:id', ah(async (req, res) => {
    const [templates] = await pool.query('SELECT * FROM omr_templates WHERE id=?', [req.params.id]);
    if (!templates.length) return res.status(404).send('Template not found');
    const t = templates[0];
    const { student_name, roll_number, class_section, subject, answer_set, exam_id } = req.body;
    const opts = 'ABCDE'.substring(0, t.options_per_q).split('');
    const totalQ = t.total_questions;
    const cols = t.options_per_q <= 4 ? 5 : 4;
    const bubblesPerRow = cols;

    const barcode = `OMR|${exam_id||0}|${roll_number||'0000'}|${answer_set||'A'}|${Date.now()}`;
    const barcodeSvg = generateBarcodeSvg(barcode);

    let sheetHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><title>OMR Sheet - ${esc(student_name||'')}</title>
      <style>
        @media print { body { margin: 0; } .no-print { display: none !important; } }
        * { box-sizing: border-box; margin: 0; padding: 0; }
        body { font-family: 'Courier New', monospace; background: #fff; padding: 20px; }
        .sheet { border: 3px solid #000; padding: 24px; max-width: 900px; margin: 0 auto; }
        .header { text-align: center; border-bottom: 3px double #000; padding-bottom: 12px; margin-bottom: 16px; }
        .header h1 { font-size: 20px; letter-spacing: 3px; }
        .info-grid { display: grid; grid-template-columns: 1fr 1fr 1fr; gap: 12px; margin-bottom: 16px; }
        .info-box { border: 2px solid #000; padding: 8px; }
        .info-box label { display: block; font-size: 11px; font-weight: bold; text-transform: uppercase; margin-bottom: 4px; }
        .info-box input { border: none; border-bottom: 1px solid #000; width: 100%; font-family: inherit; font-size: 14px; padding: 2px 0; outline: none; }
        .bubble-table { width: 100%; border-collapse: collapse; margin-top: 8px; }
        .bubble-table td, .bubble-table th { text-align: center; padding: 3px; font-size: 12px; }
        .bubble { display: inline-block; width: 22px; height: 22px; border-radius: 50%; border: 2px solid #000; }
        .set-indicator { display: flex; gap: 16px; justify-content: center; margin-bottom: 12px; }
        .set-box { padding: 8px 20px; border: 2px solid #000; font-size: 14px; font-weight: bold; }
        .barcode-area { text-align: center; margin-top: 16px; padding: 12px; border: 2px dashed #999; }
        .footer { text-align: center; font-size: 10px; color: #666; margin-top: 12px; }
        .section-header { background: #000; color: #fff; padding: 4px 8px; font-size: 12px; font-weight: bold; margin-top: 12px; }
      </style></head><body>
      <div class="sheet">
        <div class="header">
          <h1>OPTICAL MARK RECOGNITION SHEET</h1>
          <div style="font-size:12px;margin-top:4px">${esc(subject||'Subject Examination')}</div>
          <div style="font-size:11px;color:#666">Total Questions: ${totalQ} &bull; Marks per Question: ${t.marks_per_q} &bull; Negative: ${t.negative_marking}</div>
        </div>
        <div class="info-grid">
          <div class="info-box"><label>Student Name</label><input value="${esc(student_name||'')}"></div>
          <div class="info-box"><label>Roll Number</label><input value="${esc(roll_number||'')}"></div>
          <div class="info-box"><label>Class &amp; Section</label><input value="${esc(class_section||'')}"></div>
        </div>
        <div class="set-indicator">
          <div style="font-size:12px;line-height:36px;font-weight:bold">ANSWER SET:</div>
          ${['A','B','C','D'].map(s => `<div class="set-box" style="${s===(answer_set||'A')?'background:#000;color:#fff':''}">${s}</div>`).join('')}
        </div>
        <table class="bubble-table">
          <tr><th style="width:50px">Q#</th>${opts.map(o => `<th>${o}</th>`).join('')}</tr>`;
    const secs = t.sections ? JSON.parse(t.sections) : [];
    for (let i = 0; i < totalQ; i++) {
      if (i % bubblesPerRow === 0 && i > 0) sheetHtml += '</tr>';
      if (i % bubblesPerRow === 0) sheetHtml += '<tr>';
      const secLabel = secs.find(s => i + 1 >= s.start && i + 1 <= s.end);
      sheetHtml += `<td style="width:50px;font-weight:bold">${i+1}${secLabel && i+1 === secLabel.start ? ' <span style="color:#3b82f6;font-size:9px">'+secLabel.name+'</span>' : ''}</td>`;
      opts.forEach(o => { sheetHtml += `<td><span class="bubble"></span></td>`; });
      if (i % bubblesPerRow === bubblesPerRow - 1 || i === totalQ - 1) {
        while ((i % bubblesPerRow) < bubblesPerRow - 1) { sheetHtml += '<td colspan="'+(opts.length+1)+'"></td>'; i = (i+1); }
        sheetHtml += '</tr>';
        i = (i > 0 ? i-1 : 0);
      }
    }
    sheetHtml += `</table>
        <div class="barcode-area">
          <div style="font-size:10px;margin-bottom:6px">▌ DO NOT WRITE IN THIS AREA ▐</div>
          ${barcodeSvg}
          <div style="font-size:9px;margin-top:4px;color:#999;font-family:monospace">${esc(barcode)}</div>
        </div>
        <div class="footer">
          <div>▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌▌</div>
          <div>Use only BLACK/BLUE ballpoint pen. Fill bubbles completely. Do not overwrite.</div>
        </div>
      </div>
      <div class="no-print" style="text-align:center;margin-top:20px">
        <button onclick="window.print()" style="padding:10px 24px;font-size:16px;background:#1e293b;color:#fff;border:none;border-radius:8px;cursor:pointer">Print Sheet</button>
      </div></body></html>`;
    res.send(sheetHtml);
  }));

  function generateBarcodeSvg(code) {
    let x = 10;
    let svg = `<svg width="400" height="50" viewBox="0 0 400 50" xmlns="http://www.w3.org/2000/svg">`;
    for (let i = 0; i < code.length; i++) {
      const c = code.charCodeAt(i);
      const w1 = (c % 3) + 1;
      const w2 = ((c + 1) % 2) + 1;
      svg += `<rect x="${x}" y="0" width="${w1}" height="40" fill="#000"/>`;
      x += w1 + 1;
      svg += `<rect x="${x}" y="0" width="${w2}" height="40" fill="#fff"/>`;
      x += w2 + 1;
    }
    svg += '</svg>';
    return svg;
  }

  /* ═══════════════════════════════════════════════════════════════
     ROUTES 14-15 — Single Scan Upload
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/scan', requireAuth, ah(async (req, res) => {
    const [exams] = await pool.query('SELECT id, name, status FROM omr_exams WHERE tenant_id=? AND status IN ("active","scanning") ORDER BY name', [tid(req)]);
    res.send(renderPage('Scan OMR Sheet', `
      <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:700px">
        <h3 style="margin:0 0 16px">Upload Scanned Sheet</h3>
        <form method="POST" action="/school/omr/scan" enctype="multipart/form-data">
          <div style="margin-bottom:12px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Exam *</label>
            <select name="exam_id" required style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
              <option value="">Select exam...</option>
              ${exams.map(e => `<option value="${e.id}">${esc(e.name)} (${e.status})</option>`).join('')}
            </select></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Sheet Image *</label>
            <input type="file" name="sheet_image" accept="image/*" required style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Roll Number (optional, for manual entry)</label>
            <input name="roll_number" placeholder="e.g. 2024-001" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          <div style="margin-bottom:16px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Student Name (optional)</label>
            <input name="student_name" placeholder="Auto-detected from sheet" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          <button type="submit" class="btn btn-primary">Upload & Process Sheet</button>
        </form>
      </div>
    `, req));
  }));

  app.post('/school/omr/scan', requireAuth, ah(async (req, res) => {
    const { exam_id, roll_number, student_name } = req.body;
    if (!exam_id) return res.status(400).send('Exam ID required');
    const [exams] = await pool.query('SELECT e.*, t.total_questions, t.options_per_q, t.marks_per_q, t.negative_marking FROM omr_exams e JOIN omr_templates t ON t.id=e.template_id WHERE e.id=? AND e.tenant_id=?', [exam_id, tid(req)]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const exam = exams[0];

    /* Simulated OMR detection */
    const totalQ = exam.total_questions;
    const opts = 'ABCDE'.substring(0, exam.options_per_q).split('');
    const detectedAnswers = [];
    const confidence = {};
    const ambiguous = [];

    for (let i = 0; i < totalQ; i++) {
      /* Random simulation: 85% chance of a clear mark, 10% ambiguous, 5% blank */
      const rand = Math.random();
      if (rand < 0.05) {
        detectedAnswers.push(null);
        confidence[i+1] = { option: null, confidence: 0 };
      } else if (rand < 0.15) {
        const opt = opts[Math.floor(Math.random() * opts.length)];
        detectedAnswers.push(opt);
        confidence[i+1] = { option: opt, confidence: +(0.55 + Math.random() * 0.25).toFixed(2) };
        ambiguous.push({ question: i+1, detected: opt, confidence: confidence[i+1].confidence });
      } else {
        const opt = opts[Math.floor(Math.random() * opts.length)];
        detectedAnswers.push(opt);
        confidence[i+1] = { option: opt, confidence: +(0.82 + Math.random() * 0.18).toFixed(2) };
      }
    }

    const imagePath = req.files?.sheet_image?.path || '/uploads/omr/' + Date.now() + '.jpg';
    const scanQuality = Math.random() > 0.2 ? (Math.random() > 0.5 ? 'high' : 'medium') : 'low';

    await pool.query(
      `INSERT INTO omr_scanned_sheets (tenant_id,exam_id,student_id,roll_number,student_name,raw_answers,detected_confidence,ambiguous_questions,image_path,scan_quality,processed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [tid(req), +exam_id, 0, roll_number || 'AUTO-' + Math.random().toString(36).substring(2,6).toUpperCase(),
       student_name || 'Auto-detected', JSON.stringify(detectedAnswers), JSON.stringify(confidence),
       ambiguous.length > 0 ? JSON.stringify(ambiguous) : null, imagePath, scanQuality, 0]
    );
    await pool.query('UPDATE omr_exams SET sheets_uploaded=sheets_uploaded+1 WHERE id=? AND tenant_id=?', [exam_id, tid(req)]);
    audit(req, 'omr_scan_upload', { exam_id, roll_number, quality: scanQuality, ambiguous: ambiguous.length });

    /* Score if answer key exists */
    let resultHtml = '';
    if (exam.answer_key_id) {
      const [keys] = await pool.query('SELECT * FROM omr_answer_keys WHERE id=?', [exam.answer_key_id]);
      if (keys.length) {
        const correctArr = keys[0].answers.split(',').map(s => s.trim().toUpperCase());
        const negMark = +exam.negative_marking;
        let correct = 0, wrong = 0, unattempted = 0;
        detectedAnswers.forEach((a, i) => {
          if (!a) unattempted++;
          else if (a === correctArr[i]) correct++;
          else wrong++;
        });
        const totalMarks = +(correct * exam.marks_per_q - wrong * negMark).toFixed(2);
        const maxMarks = totalQ * exam.marks_per_q;
        const pct = +((totalMarks / maxMarks) * 100).toFixed(2);
        resultHtml = `
          <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-top:16px">
            <h3 style="margin:0 0 12px;color:#10b981">Score Calculated</h3>
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px">
              <div style="background:#dcfce7;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:11px;color:#166534">Correct</div>
                <div style="font-size:24px;font-weight:700;color:#16a34a">${correct}</div></div>
              <div style="background:#fef2f2;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:11px;color:#991b1b">Wrong</div>
                <div style="font-size:24px;font-weight:700;color:#dc2626">${wrong}</div></div>
              <div style="background:#f1f5f9;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:11px;color:#475569">Unattempted</div>
                <div style="font-size:24px;font-weight:700;color:#64748b">${unattempted}</div></div>
              <div style="background:#eff6ff;border-radius:8px;padding:12px;text-align:center">
                <div style="font-size:11px;color:#1e40af">Total</div>
                <div style="font-size:24px;font-weight:700;color:#2563eb">${totalMarks}/${maxMarks}</div></div>
            </div>
            <div style="margin-top:12px;font-size:15px">Percentage: <strong>${pct}%</strong> &bull; Grade: <strong>${gradeFromPct(pct)}</strong></div>
          </div>`;
      }
    }

    const ambHtml = ambiguous.length > 0
      ? `<div style="background:#fef3c7;border-radius:12px;padding:16px;margin-top:16px;border:1px solid #f59e0b">
          <h4 style="color:#92400e;margin:0 0 8px">⚠ ${ambiguous.length} Ambiguous Detection(s)</h4>
          <table style="width:100%;font-size:13px"><tr><th>Question</th><th>Detected</th><th>Confidence</th></tr>
          ${ambiguous.map(a => `<tr><td>Q${a.question}</td><td>${esc(a.detected)}</td><td>${cssBar(a.confidence * 100, '#f59e0b')}</td></tr>`).join('')}
          </table></div>`
      : '<div style="background:#dcfce7;padding:12px;border-radius:8px;margin-top:16px;color:#166534;font-weight:600">All marks detected with high confidence</div>';

    res.send(renderPage('Scan Result', `
      <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <h3 style="margin:0 0 12px">Scan Complete</h3>
        <table style="width:100%;font-size:14px;margin-bottom:12px">
          <tr><td style="padding:4px;color:#64748b;width:140px">Exam</td><td style="font-weight:600">${esc(exam.name)}</td></tr>
          <tr><td style="padding:4px;color:#64748b">Roll Number</td><td>${esc(roll_number || 'AUTO')}</td></tr>
          <tr><td style="padding:4px;color:#64748b">Scan Quality</td><td><span style="color:${scanQuality==='high'?'#16a34a':scanQuality==='medium'?'#f59e0b':'#dc2626'};font-weight:600">${scanQuality}</span></td></tr>
          <tr><td style="padding:4px;color:#64748b">Questions</td><td>${detectedAnswers.filter(Boolean).length} answered / ${totalQ}</td></tr>
        </table>
      </div>
      ${resultHtml}
      ${ambHtml}
      <div style="margin-top:16px">
        <a href="/school/omr/scan" class="btn btn-primary">Scan Another</a>
        <a href="/school/omr/batch-scan" class="btn">Batch Scan</a>
      </div>
    `, req));
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTES 16-18 — Batch Scanning
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/batch-scan', requireAuth, ah(async (req, res) => {
    const [exams] = await pool.query('SELECT id, name, status, sheets_uploaded, sheets_processed, sheets_total FROM omr_exams WHERE tenant_id=? AND status IN ("active","scanning","completed") ORDER BY name', [tid(req)]);
    res.send(renderPage('Batch Scan', `
      <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:700px">
        <h3 style="margin:0 0 16px">Batch Upload Scanned Sheets</h3>
        <form method="POST" action="/school/omr/batch-scan" enctype="multipart/form-data">
          <div style="margin-bottom:12px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Exam *</label>
            <select name="exam_id" required style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
              <option value="">Select exam...</option>
              ${exams.map(e => `<option value="${e.id}">${esc(e.name)} (${e.sheets_processed}/${e.sheets_total || '?'} processed)</option>`).join('')}
            </select></div>
          <div style="margin-bottom:12px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Sheet Images (multiple) *</label>
            <input type="file" name="sheets" accept="image/*" multiple required style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          <div style="margin-bottom:16px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Total sheets in batch</label>
            <input name="total_sheets" type="number" value="0" min="0" style="width:160px;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          <button type="submit" class="btn btn-primary">Start Batch Processing</button>
        </form>
      </div>
      ${exams.length > 0 ? `<div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-top:16px">
        <h3 style="margin:0 0 12px">Scanning Progress</h3>
        <table class="table"><thead><tr><th>Exam</th><th>Status</th><th>Progress</th><th>Sheets</th></tr></thead>
        <tbody>${exams.map(e => {
          const pct = e.sheets_total > 0 ? Math.round(e.sheets_processed / e.sheets_total * 100) : 0;
          return `<tr><td>${esc(e.name)}</td>
            <td><span style="background:${e.status==='completed'?'#10b981':e.status==='scanning'?'#8b5cf6':'#3b82f6'};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px">${e.status}</span></td>
            <td>${cssBar(pct)}</td>
            <td>${e.sheets_processed}/${e.sheets_total}</td></tr>`;
        }).join('')}</tbody></table>
      </div>` : ''}
    `, req));
  }));

  app.post('/school/omr/batch-scan', requireAuth, ah(async (req, res) => {
    const { exam_id, total_sheets } = req.body;
    if (!exam_id) return res.status(400).send('Exam ID required');
    const sheets = req.files?.sheets;
    const fileCount = Array.isArray(sheets) ? sheets.length : (sheets ? 1 : 0);
    const batchCount = Math.max(+total_sheets || fileCount, fileCount);

    await pool.query('UPDATE omr_exams SET status="scanning", sheets_total=sheets_total+? WHERE id=? AND tenant_id=?', [batchCount, exam_id, tid(req)]);

    /* Process each sheet (simulated) */
    const [exams] = await pool.query('SELECT e.*, t.total_questions, t.options_per_q, t.negative_marking, t.marks_per_q FROM omr_exams e JOIN omr_templates t ON t.id=e.template_id WHERE e.id=? AND e.tenant_id=?', [exam_id, tid(req)]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const exam = exams[0];
    const opts = 'ABCDE'.substring(0, exam.options_per_q).split('');

    let processed = 0, flagged = 0;
    for (let b = 0; b < batchCount; b++) {
      const totalQ = exam.total_questions;
      const answers = [];
      const conf = {};
      const ambList = [];
      for (let i = 0; i < totalQ; i++) {
        const r = Math.random();
        if (r < 0.05) { answers.push(null); conf[i+1] = { option: null, confidence: 0 }; }
        else if (r < 0.12) {
          const o = opts[Math.floor(Math.random()*opts.length)];
          answers.push(o); conf[i+1] = { option: o, confidence: +(0.5+Math.random()*0.3).toFixed(2) };
          ambList.push({ question: i+1, detected: o, confidence: conf[i+1].confidence });
        } else {
          const o = opts[Math.floor(Math.random()*opts.length)];
          answers.push(o); conf[i+1] = { option: o, confidence: +(0.85+Math.random()*0.15).toFixed(2) };
        }
      }
      const rollNum = 'BATCH-' + String(b+1).padStart(4,'0');
      const quality = Math.random() > 0.15 ? (Math.random() > 0.5 ? 'high' : 'medium') : 'low';
      if (ambList.length > 5 || quality === 'low') flagged++;
      await pool.query(
        `INSERT INTO omr_scanned_sheets (tenant_id,exam_id,roll_number,raw_answers,detected_confidence,ambiguous_questions,image_path,scan_quality,processed)
         VALUES (?,?,?,?,?,?,?,?,?)`,
        [tid(req), +exam_id, rollNum, JSON.stringify(answers), JSON.stringify(conf),
         ambList.length > 0 ? JSON.stringify(ambList) : null,
         `/uploads/omr/batch_${Date.now()}_${b}.jpg`, quality, ambList.length <= 5 ? 1 : 0]
      );
      processed++;
      await pool.query('UPDATE omr_exams SET sheets_uploaded=sheets_uploaded+1, sheets_processed=sheets_processed+1 WHERE id=?', [exam_id]);
    }

    if (processed >= batchCount) {
      await pool.query("UPDATE omr_exams SET status='completed' WHERE id=? AND sheets_processed >= sheets_total AND tenant_id=?", [exam_id, tid(req)]);
    }

    audit(req, 'omr_batch_scan', { exam_id, batch_count: batchCount, flagged });
    res.send(renderPage('Batch Scan Complete', `
      <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <h3 style="margin:0 0 16px;color:#10b981">Batch Processing Complete</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px">
          <div style="background:#eff6ff;border-radius:8px;padding:16px;text-align:center">
            <div style="font-size:32px;font-weight:700;color:#2563eb">${batchCount}</div>
            <div style="color:#64748b;font-size:13px">Total Sheets</div></div>
          <div style="background:#dcfce7;border-radius:8px;padding:16px;text-align:center">
            <div style="font-size:32px;font-weight:700;color:#16a34a">${processed - flagged}</div>
            <div style="color:#64748b;font-size:13px">Processed OK</div></div>
          <div style="background:#fef2f2;border-radius:8px;padding:16px;text-align:center">
            <div style="font-size:32px;font-weight:700;color:#dc2626">${flagged}</div>
            <div style="color:#64748b;font-size:13px">Flagged for Review</div></div>
        </div>
      </div>
      <div style="margin-top:16px">
        <a href="/school/omr/results/${esc(exam_id)}" class="btn btn-primary">View Results</a>
        <a href="/school/omr/batch-scan" class="btn">Scan More</a>
      </div>
    `, req));
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTES 19-20 — Results
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/results/:examId', requireAuth, ah(async (req, res) => {
    await calculateExamResults(req, res, +req.params.examId);
    const [exams] = await pool.query('SELECT e.*, t.name AS template_name FROM omr_exams e JOIN omr_templates t ON t.id=e.template_id WHERE e.id=? AND e.tenant_id=?', [req.params.examId, tid(req)]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const exam = exams[0];
    const [results] = await pool.query('SELECT * FROM omr_results WHERE exam_id=? AND tenant_id=? ORDER BY percentage DESC', [exam.id, tid(req)]);

    /* Assign ranks */
    for (let i = 0; i < results.length; i++) {
      await pool.query('UPDATE omr_results SET rank=? WHERE id=?', [i+1, results[i].id]);
      results[i].rank = i + 1;
    }

    const summary = results.length > 0 ? calcStats(results.map(r => +r.percentage)) : { mean:0, median:0, mode:0, stdDev:0, min:0, max:0 };
    const topPerformer = results.length > 0 ? results[0] : null;

    const summaryHtml = `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">
      ${[['Students', results.length, '#3b82f6'], ['Highest', summary.max+'%', '#10b981'], ['Average', summary.mean+'%', '#8b5cf6'],
         ['Lowest', summary.min+'%', '#f59e0b'], ['Std Dev', summary.stdDev, '#64748b']].map(([l,v,c]) =>
        `<div style="background:#fff;border-radius:10px;padding:14px;box-shadow:0 1px 3px rgba(0,0,0,.06);text-align:center;border-top:3px solid ${c}">
          <div style="font-size:11px;color:#64748b;text-transform:uppercase">${l}</div>
          <div style="font-size:22px;font-weight:700;color:${c};margin-top:2px">${v}</div></div>`).join('')}
    </div>`;

    const rows = results.length === 0
      ? '<tr><td colspan="8" style="text-align:center;padding:40px;color:#94a3b8">No results yet. Scan sheets first.</td></tr>'
      : results.map(r => {
          const pct = +r.percentage;
          const grade = gradeFromPct(pct);
          const passed = pct >= 40;
          const badgeColors = { 'A+':'#059669', 'A':'#10b981', 'B+':'#3b82f6', 'B':'#6366f1', 'C':'#f59e0b', 'D':'#f97316', 'F':'#ef4444' };
          return `<tr style="background:${passed?'':'#fef2f2'}">
            <td style="font-weight:600;text-align:center">${r.rank}</td>
            <td>${esc(r.student_id || '-')}</td>
            <td style="font-weight:600">${esc('Student #' + r.student_id)}</td>
            <td style="color:#16a34a;font-weight:600">${r.correct_count}</td>
            <td style="color:#dc2626">${r.wrong_count}</td>
            <td style="font-weight:700">${r.total_marks}/${r.max_marks}</td>
            <td>${cssBar(pct, pct >= 60 ? '#10b981' : pct >= 40 ? '#f59e0b' : '#ef4444')}</td>
            <td><span style="background:${badgeColors[grade]||'#94a3b8'};color:#fff;padding:2px 10px;border-radius:10px;font-size:12px;font-weight:700">${grade}</span></td>
            <td><a href="/school/omr/student-report/${esc(exam.id)}/${esc(r.student_id)}" class="btn btn-secondary" style="font-size:11px;padding:2px 8px">Report</a></td>
          </tr>`;
        }).join('');

    /* Distribution histogram */
    const buckets = [0,0,0,0,0,0,0,0,0,0]; // 0-10, 10-20, ..., 90-100
    results.forEach(r => { const b = Math.min(9, Math.floor(+r.percentage / 10)); buckets[b]++; });
    const maxBucket = Math.max(...buckets, 1);
    const histHtml = `<div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-top:16px">
      <h3 style="font-size:15px;margin:0 0 12px">Score Distribution</h3>
      <div style="display:flex;align-items:flex-end;gap:6px;height:120px">
        ${buckets.map((count, i) => {
          const h = (count / maxBucket) * 100;
          const color = i < 4 ? '#ef4444' : i < 7 ? '#f59e0b' : '#10b981';
          return `<div style="flex:1;text-align:center">
            <div style="font-size:11px;font-weight:600;margin-bottom:4px">${count}</div>
            <div style="background:${color};height:${Math.max(2,h)}%;border-radius:4px 4px 0 0;min-height:2px;transition:height .3s"></div>
            <div style="font-size:10px;color:#64748b;margin-top:4px">${i*10}-${i*10+10}</div></div>`;
        }).join('')}
      </div></div>`;

    res.send(renderPage('Results: ' + exam.name, `
      <div class="page-header"><h2>${esc(exam.name)} — Results</h2>
        <div style="display:flex;gap:8px;margin-top:8px">
          <a href="/school/omr/export/${esc(exam.id)}?format=csv" class="btn btn-secondary">Export CSV</a>
          <a href="/school/omr/analysis/${esc(exam.id)}" class="btn">Analysis</a>
        </div></div>
      ${summaryHtml}
      <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <table class="table"><thead><tr><th>Rank</th><th>ID</th><th>Student</th><th>Correct</th><th>Wrong</th><th>Marks</th><th>Percentage</th><th>Grade</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
      ${histHtml}
    `, req));
  }));

  async function calculateExamResults(req, res, examId) {
    const [exams] = await pool.query('SELECT e.*, t.total_questions, t.options_per_q, t.marks_per_q, t.negative_marking, t.pass_percentage FROM omr_exams e JOIN omr_templates t ON t.id=e.template_id WHERE e.id=? AND e.tenant_id=?', [examId, tid(req)]);
    if (!exams.length) return;
    const exam = exams[0];
    if (!exam.answer_key_id) return;

    const [keys] = await pool.query('SELECT * FROM omr_answer_keys WHERE id=?', [exam.answer_key_id]);
    if (!keys.length) return;
    const correctArr = keys[0].answers.split(',').map(s => s.trim().toUpperCase());
    const negMark = +exam.negative_marking;

    const [sheets] = await pool.query('SELECT * FROM omr_scanned_sheets WHERE exam_id=? AND tenant_id=? AND processed=1', [examId, tid(req)]);
    for (const sheet of sheets) {
      const answers = JSON.parse(sheet.raw_answers || '[]');
      let correct = 0, wrong = 0, unattempted = 0;
      answers.forEach((a, i) => {
        if (!a) unattempted++;
        else if (a === correctArr[i]) correct++;
        else wrong++;
      });
      const totalMarks = +(correct * exam.marks_per_q - wrong * negMark).toFixed(2);
      const maxMarks = exam.total_questions * exam.marks_per_q;
      const pct = maxMarks > 0 ? +((totalMarks / maxMarks) * 100).toFixed(2) : 0;
      const negMarks = +(wrong * negMark).toFixed(2);

      await pool.query(
        `INSERT INTO omr_results (tenant_id,exam_id,student_id,total_marks,max_marks,correct_count,wrong_count,unattempted,negative_marks,percentage,grade,section_wise)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE total_marks=VALUES(total_marks),max_marks=VALUES(max_marks),correct_count=VALUES(correct_count),wrong_count=VALUES(wrong_count),
         unattempted=VALUES(unattempted),negative_marks=VALUES(negative_marks),percentage=VALUES(percentage),grade=VALUES(grade)`,
        [tid(req), examId, sheet.student_id || sheet.id, totalMarks, maxMarks, correct, wrong, unattempted, negMarks, pct, gradeFromPct(pct), null]
      );
    }
  }

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 21 — Analysis
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/analysis/:examId', requireAuth, ah(async (req, res) => {
    const examId = +req.params.examId;
    const [exams] = await pool.query('SELECT e.*, t.name AS template_name, t.total_questions, t.options_per_q FROM omr_exams e JOIN omr_templates t ON t.id=e.template_id WHERE e.id=? AND e.tenant_id=?', [examId, tid(req)]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const exam = exams[0];

    /* Compute analysis per question */
    const [sheets] = await pool.query('SELECT * FROM omr_scanned_sheets WHERE exam_id=? AND tenant_id=? AND processed=1', [examId, tid(req)]);
    const [keys] = await pool.query('SELECT * FROM omr_answer_keys WHERE id=?', [exam.answer_key_id]);
    const correctArr = keys.length ? keys[0].answers.split(',').map(s=>s.trim().toUpperCase()) : [];
    const opts = 'ABCDE'.substring(0, exam.options_per_q).split('');
    const totalStudents = sheets.length;

    const questionAnalysis = [];
    for (let q = 0; q < exam.total_questions; q++) {
      const optionCounts = {}; opts.forEach(o => optionCounts[o] = 0);
      let unattempted = 0;
      sheets.forEach(s => {
        const answers = JSON.parse(s.raw_answers || '[]');
        const a = answers[q];
        if (!a) unattempted++;
        else if (optionCounts[a] !== undefined) optionCounts[a]++;
      });
      const correctCount = correctArr[q] ? (optionCounts[correctArr[q]] || 0) : 0;
      const correctPct = totalStudents > 0 ? (correctCount / totalStudents * 100) : 0;
      const difficulty = totalStudents > 0 ? (correctCount / totalStudents) : 0;

      /* Find most common wrong option */
      let mostCommonWrong = null, maxWrong = 0;
      opts.forEach(o => {
        if (o !== correctArr[q] && optionCounts[o] > maxWrong) { maxWrong = optionCounts[o]; mostCommonWrong = o; }
      });

      questionAnalysis.push({
        question: q + 1, correctPct: +correctPct.toFixed(1), difficulty: +difficulty.toFixed(3),
        mostCommonWrong, optionPcts: opts.map(o => totalStudents > 0 ? +(optionCounts[o]/totalStudents*100).toFixed(1) : 0),
        correct: correctArr[q] || '-', unattempted
      });

      /* Upsert analysis */
      await pool.query(
        `INSERT INTO omr_result_analysis (tenant_id,exam_id,question_number,correct_pct,option_a_pct,option_b_pct,option_c_pct,option_d_pct,option_e_pct,difficulty_index,most_common_wrong)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE correct_pct=VALUES(correct_pct),option_a_pct=VALUES(option_a_pct),option_b_pct=VALUES(option_b_pct),
         option_c_pct=VALUES(option_c_pct),option_d_pct=VALUES(option_d_pct),option_e_pct=VALUES(option_e_pct),difficulty_index=VALUES(difficulty_index),most_common_wrong=VALUES(most_common_wrong)`,
        [tid(req), examId, q+1, correctPct, questionAnalysis[q].optionPcts[0], questionAnalysis[q].optionPcts[1],
         questionAnalysis[q].optionPcts[2], questionAnalysis[q].optionPcts[3], questionAnalysis[q].optionPcts[4] || 0,
         difficulty, mostCommonWrong]
      );
    }

    /* Difficulty distribution */
    const easy = questionAnalysis.filter(q => q.difficulty >= 0.7).length;
    const moderate = questionAnalysis.filter(q => q.difficulty >= 0.3 && q.difficulty < 0.7).length;
    const hard = questionAnalysis.filter(q => q.difficulty < 0.3).length;
    const total = questionAnalysis.length || 1;

    const diffBar = `<div style="display:flex;gap:2px;height:30px;border-radius:8px;overflow:hidden;margin-bottom:8px">
      <div style="width:${easy/total*100}%;background:#10b981" title="Easy: ${easy}"></div>
      <div style="width:${moderate/total*100}%;background:#f59e0b" title="Moderate: ${moderate}"></div>
      <div style="width:${hard/total*100}%;background:#ef4444" title="Hard: ${hard}"></div>
    </div>
    <div style="display:flex;gap:16px;font-size:12px">
      <span><span style="display:inline-block;width:12px;height:12px;background:#10b981;border-radius:3px"></span> Easy (${easy})</span>
      <span><span style="display:inline-block;width:12px;height:12px;background:#f59e0b;border-radius:3px"></span> Moderate (${moderate})</span>
      <span><span style="display:inline-block;width:12px;height:12px;background:#ef4444;border-radius:3px"></span> Hard (${hard})</span>
    </div>`;

    const optColors = { A: '#3b82f6', B: '#10b981', C: '#f59e0b', D: '#ef4444', E: '#8b5cf6' };

    const qRows = questionAnalysis.map(q => {
      const diffColor = q.difficulty >= 0.7 ? '#10b981' : q.difficulty >= 0.3 ? '#f59e0b' : '#ef4444';
      const optBars = opts.map((o, i) =>
        `<div style="display:flex;align-items:center;gap:4px;font-size:11px">
          <span style="width:14px;font-weight:700;color:${o===q.correct?'#059669':'#64748b'}">${o}</span>
          <div style="flex:1;background:#f1f5f9;height:16px;border-radius:4px;overflow:hidden;position:relative">
            <div style="background:${o===q.correct?'#22c55e':optColors[o]||'#94a3b8'};height:100%;width:${q.optionPcts[i]}%;border-radius:4px"></div>
          </div>
          <span style="width:36px;text-align:right">${q.optionPcts[i]}%</span>
        </div>`).join('');
      return `<tr>
        <td style="font-weight:600;text-align:center">${q.question}</td>
        <td style="font-weight:700;color:#059669;text-align:center">${q.correct}</td>
        <td style="width:240px">${optBars}</td>
        <td style="text-align:center"><span style="background:${diffColor};color:#fff;padding:2px 8px;border-radius:8px;font-size:11px;font-weight:600">${q.difficulty.toFixed(2)}</span></td>
        <td style="text-align:center;font-size:12px">${q.mostCommonWrong ? `<span style="color:#ef4444;font-weight:600">${esc(q.mostCommonWrong)}</span>` : '<span style="color:#94a3b8">-</span>'}</td>
      </tr>`;
    }).join('');

    res.send(renderPage('Analysis: ' + exam.name, `
      <div class="page-header"><h2>${esc(exam.name)} — Question Analysis</h2>
        <a href="/school/omr/results/${esc(exam.id)}" class="btn">Back to Results</a></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <h3 style="font-size:15px;margin:0 0 12px">Question Difficulty Distribution</h3>
          ${diffBar}</div>
        <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <h3 style="font-size:15px;margin:0 0 12px">Overview</h3>
          <table style="width:100%;font-size:13px">
            <tr><td style="padding:4px;color:#64748b">Total Questions</td><td style="font-weight:600">${exam.total_questions}</td></tr>
            <tr><td style="padding:4px;color:#64748b">Students Attempted</td><td style="font-weight:600">${totalStudents}</td></tr>
            <tr><td style="padding:4px;color:#64748b">Avg Difficulty</td><td style="font-weight:600">${(questionAnalysis.reduce((s,q)=>s+q.difficulty,0)/(questionAnalysis.length||1)).toFixed(3)}</td></tr>
          </table></div>
      </div>
      <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <h3 style="font-size:15px;margin:0 0 12px">Question-wise Analysis</h3>
        <div style="overflow-x:auto"><table class="table">
          <thead><tr><th>Q#</th><th>Answer</th><th>Option Distribution</th><th>Difficulty</th><th>Most Wrong</th></tr></thead>
          <tbody>${qRows}</tbody>
        </table></div>
      </div>
    `, req));
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 22 — Student Report Card
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/student-report/:examId/:studentId', requireAuth, ah(async (req, res) => {
    const examId = +req.params.examId;
    const studentId = +req.params.studentId;
    const [exams] = await pool.query('SELECT e.*, t.* FROM omr_exams e JOIN omr_templates t ON t.id=e.template_id WHERE e.id=? AND e.tenant_id=?', [examId, tid(req)]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const exam = exams[0];
    const [results] = await pool.query('SELECT * FROM omr_results WHERE exam_id=? AND student_id=? AND tenant_id=?', [examId, studentId, tid(req)]);
    if (!results.length) return res.status(404).send('No result found for this student');
    const r = results[0];

    const [sheets] = await pool.query('SELECT * FROM omr_scanned_sheets WHERE exam_id=? AND (student_id=? OR id=?) AND tenant_id=? LIMIT 1', [examId, studentId, studentId, tid(req)]);
    const sheet = sheets[0];
    const studentAnswers = sheet ? JSON.parse(sheet.raw_answers || '[]') : [];

    const [keys] = await pool.query('SELECT * FROM omr_answer_keys WHERE id=?', [exam.answer_key_id]);
    const correctAnswers = keys.length ? keys[0].answers.split(',').map(s => s.trim().toUpperCase()) : [];

    /* Class stats for comparison */
    const [allResults] = await pool.query('SELECT * FROM omr_results WHERE exam_id=? AND tenant_id=?', [examId, tid(req)]);
    const stats = calcStats(allResults.map(x => +x.percentage));
    const classAvg = stats.mean;
    const percentile = allResults.filter(x => +x.percentage <= +r.percentage).length / (allResults.length || 1) * 100;
    const aboveAvg = +r.percentage >= classAvg;

    /* Strengths & weaknesses */
    const strengths = [], weaknesses = [];
    studentAnswers.forEach((a, i) => {
      if (a && correctAnswers[i] && a === correctAnswers[i]) strengths.push(i + 1);
      else if (a && correctAnswers[i] && a !== correctAnswers[i]) weaknesses.push(i + 1);
    });

    /* Performance trend (mock previous exams) */
    const [prevExams] = await pool.query('SELECT e.id, e.name, e.exam_date FROM omr_exams WHERE tenant_id=? AND id != ? AND status IN ("completed","published") ORDER BY exam_date DESC LIMIT 5', [tid, examId]);
    const trend = [];
    for (const pe of prevExams) {
      const [pr] = await pool.query('SELECT percentage FROM omr_results WHERE exam_id=? AND student_id=? AND tenant_id=?', [pe.id, studentId, tid]);
      trend.push({ name: pe.name, date: pe.exam_date, pct: pr.length ? +pr[0].percentage : null });
    }

    const trendHtml = trend.length > 0 ? `<div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-top:16px">
      <h3 style="font-size:15px;margin:0 0 12px">Performance Trend</h3>
      <div style="display:flex;align-items:flex-end;gap:12px;height:100px;padding:0 10px">
        ${trend.map(t => {
          const h = t.pct || 0;
          return `<div style="flex:1;text-align:center">
            <div style="font-size:11px;font-weight:600;margin-bottom:4px">${t.pct !== null ? t.pct+'%' : 'N/A'}</div>
            <div style="background:#3b82f6;height:${Math.max(2, h)}%;border-radius:4px 4px 0 0;min-height:2px"></div>
            <div style="font-size:10px;color:#64748b;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name)}</div>
          </div>`;
        }).join('')}
      </div></div>` : '';

    res.send(renderPage('Report Card', `
      <div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <div style="display:flex;justify-content:space-between;align-items:center;border-bottom:3px solid #1e293b;padding-bottom:12px;margin-bottom:16px">
          <div>
            <h2 style="margin:0;font-size:20px">${esc(exam.name)}</h2>
            <div style="font-size:13px;color:#64748b">Student #${studentId} &bull; ${esc(exam.exam_date || '')}</div></div>
          <div style="text-align:right">
            <div style="font-size:36px;font-weight:800;color:${+r.percentage >= 40 ? '#059669' : '#dc2626'}">${esc(r.grade)}</div>
            <div style="font-size:14px;color:#64748b">${r.percentage}%</div></div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:16px">
          <div style="background:#dcfce7;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:11px;color:#166534">Correct</div>
            <div style="font-size:24px;font-weight:700;color:#16a34a">${r.correct_count}</div></div>
          <div style="background:#fef2f2;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:11px;color:#991b1b">Wrong</div>
            <div style="font-size:24px;font-weight:700;color:#dc2626">${r.wrong_count}</div></div>
          <div style="background:#f1f5f9;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:11px;color:#475569">Unattempted</div>
            <div style="font-size:24px;font-weight:700;color:#64748b">${r.unattempted}</div></div>
          <div style="background:#eff6ff;border-radius:8px;padding:12px;text-align:center">
            <div style="font-size:11px;color:#1e40af">Total Marks</div>
            <div style="font-size:24px;font-weight:700;color:#2563eb">${r.total_marks}/${r.max_marks}</div></div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
          <div style="padding:12px;border-radius:8px;background:${aboveAvg?'#dcfce7':'#fef2f2'}">
            <span style="font-weight:600">${aboveAvg ? '📈' : '📉'}</span>
            Class Average: <strong>${classAvg}%</strong> &mdash; You are <strong style="color:${aboveAvg?'#16a34a':'#dc2626'}">${aboveAvg ? 'above' : 'below'}</strong> average
          </div>
          <div style="padding:12px;border-radius:8px;background:#f1f5f9">
            Percentile: <strong>${percentile.toFixed(1)}%</strong> &bull; Rank: <strong>#${r.rank || '-'}</strong> / ${allResults.length}
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <h4 style="color:#16a34a;margin:0 0 8px">✅ Strengths (${strengths.length} correct)</h4>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${strengths.length > 0
            ? strengths.slice(0,30).map(q => `<span style="background:#dcfce7;color:#166534;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">Q${q}</span>`).join('')
            : '<span style="color:#94a3b8;font-size:13px">None</span>'}${strengths.length > 30 ? '<span style="color:#64748b;font-size:12px">+' + (strengths.length-30) + ' more</span>' : ''}</div>
        </div>
        <div style="background:#fff;border-radius:12px;padding:16px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <h4 style="color:#dc2626;margin:0 0 8px">❌ Weaknesses (${weaknesses.length} wrong)</h4>
          <div style="display:flex;flex-wrap:wrap;gap:4px">${weaknesses.length > 0
            ? weaknesses.slice(0,30).map(q => `<span style="background:#fef2f2;color:#991b1b;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600">Q${q}</span>`).join('')
            : '<span style="color:#94a3b8;font-size:13px">None</span>'}${weaknesses.length > 30 ? '<span style="color:#64748b;font-size:12px">+' + (weaknesses.length-30) + ' more</span>' : ''}</div>
        </div>
      </div>

      <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-top:16px">
        <h3 style="font-size:15px;margin:0 0 12px">Question-wise Breakdown</h3>
        ${bubbleGrid(
          Array.from({length: exam.total_questions}, (_,i) => ({ marks: exam.marks_per_q })),
          'ABCDE'.substring(0, exam.options_per_q).split(''),
          studentAnswers, correctAnswers, +exam.negative_marking, true
        )}
      </div>

      ${trendHtml}

      <div style="text-align:center;margin-top:20px">
        <button onclick="window.print()" class="btn btn-primary">Print Report Card</button>
        <a href="/school/omr/results/${esc(examId)}" class="btn">Back to Results</a>
      </div>
    `, req));
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTES 23-24 — Export
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/export/:examId', requireAuth, ah(async (req, res) => {
    const examId = +req.params.examId;
    const format = req.query.format || 'csv';
    await calculateExamResults(req, res, examId);

    const [exams] = await pool.query('SELECT e.*, t.name AS template_name FROM omr_exams e JOIN omr_templates t ON t.id=e.template_id WHERE e.id=? AND e.tenant_id=?', [examId, tid(req)]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const exam = exams[0];
    const [results] = await pool.query('SELECT * FROM omr_results WHERE exam_id=? AND tenant_id=? ORDER BY rank', [examId, tid(req)]);

    if (format === 'csv') {
      let csv = 'Rank,Student ID,Correct,Wrong,Unattempted,Total Marks,Max Marks,Percentage,Grade\n';
      results.forEach(r => {
        csv += `${r.rank},${r.student_id},${r.correct_count},${r.wrong_count},${r.unattempted},${r.total_marks},${r.max_marks},${r.percentage},${r.grade}\n`;
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="omr_results_${exam.name.replace(/\s+/g,'_')}.csv"`);
      return res.send(csv);
    }

    /* Print-friendly view */
    const rows = results.map(r => `<tr>
      <td>${r.rank}</td><td>${r.student_id}</td><td style="color:#16a34a;font-weight:600">${r.correct_count}</td>
      <td style="color:#dc2626">${r.wrong_count}</td><td>${r.unattempted}</td>
      <td style="font-weight:700">${r.total_marks}/${r.max_marks}</td><td>${r.percentage}%</td>
      <td><strong>${r.grade}</strong></td></tr>`).join('');

    res.send(renderPage('Print Results', `
      <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <h3 style="text-align:center;margin:0 0 12px">${esc(exam.name)} — Result Summary</h3>
        <p style="text-align:center;color:#64748b;font-size:13px;margin-bottom:16px">Total Students: ${results.length} &bull; Date: ${exam.exam_date || 'N/A'}</p>
        <table class="table" style="width:100%"><thead><tr><th>Rank</th><th>Student ID</th><th>Correct</th><th>Wrong</th><th>Blank</th><th>Marks</th><th>%</th><th>Grade</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
      <div style="text-align:center;margin-top:16px">
        <button onclick="window.print()" class="btn btn-primary">Print</button>
        <a href="/school/omr/export/${esc(examId)}?format=csv" class="btn btn-secondary">Download CSV</a>
      </div>
    `, req));
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTES 25-28 — Exam Management
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/exams', requireAuth, ah(async (req, res) => {
    const [exams] = await pool.query(`SELECT e.*, t.name AS template_name FROM omr_exams e LEFT JOIN omr_templates t ON t.id=e.template_id
      WHERE e.tenant_id=? ORDER BY e.exam_date DESC`, [tid(req)]);
    const statusColors = { draft:'#94a3b8', scheduled:'#f59e0b', active:'#3b82f6', scanning:'#8b5cf6', completed:'#10b981', published:'#059669' };
    const rows = exams.length === 0
      ? '<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">No exams created</td></tr>'
      : exams.map(e => {
          const pct = e.sheets_total > 0 ? Math.round(e.sheets_processed / e.sheets_total * 100) : 0;
          return `<tr>
            <td><a href="/school/omr/exams/${esc(e.id)}" style="color:#3b82f6;font-weight:600;text-decoration:none">${esc(e.name)}</a></td>
            <td>${esc(e.template_name || '-')}</td>
            <td>${esc(e.exam_date || '-')}</td>
            <td><span style="background:${statusColors[e.status]||'#94a3b8'};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px">${esc(e.status)}</span></td>
            <td>${cssBar(pct)}</td>
            <td>${e.sheets_processed}/${e.sheets_total}</td>
            <td>
              <a href="/school/omr/exams/${esc(e.id)}/edit" class="btn btn-secondary" style="font-size:12px;padding:3px 8px">Edit</a>
              ${e.status==='draft'||e.status==='scheduled' ? `<a href="/school/omr/exams/${esc(e.id)}/activate" class="btn btn-primary" style="font-size:12px;padding:3px 8px">Activate</a>` : ''}
              ${e.status==='completed' ? `<a href="/school/omr/exams/${esc(e.id)}/publish" class="btn" style="font-size:12px;padding:3px 8px;background:#059669;color:#fff">Publish</a>` : ''}
              <form method="POST" action="/school/omr/exams/${esc(e.id)}/delete" style="display:inline" onsubmit="return confirm('Delete this exam?')">
                <button class="btn btn-danger" style="font-size:12px;padding:3px 8px">Delete</button></form>
            </td></tr>`;
        }).join('');

    res.send(renderPage('Exam Management', `
      <div class="page-header"><h2>OMR Exam Management</h2>
        <a href="/school/omr/exams/new" class="btn btn-primary">+ New Exam</a></div>
      <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <table class="table"><thead><tr><th>Exam</th><th>Template</th><th>Date</th><th>Status</th><th>Progress</th><th>Sheets</th><th>Actions</th></tr></thead>
        <tbody>${rows}</tbody></table></div>
    `, req));
  }));

  app.get('/school/omr/exams/new', requireAuth, ah(async (req, res) => {
    const [templates] = await pool.query('SELECT id, name, total_questions FROM omr_templates WHERE tenant_id=?', [tid(req)]);
    const [keyList] = await pool.query(`SELECT ak.id, ak.set_name, t.name AS template_name FROM omr_answer_keys ak JOIN omr_templates t ON t.id=ak.template_id WHERE ak.tenant_id=?`, [tid(req)]);
    res.send(renderPage('New OMR Exam', examForm(null, templates, keyList), req));
  }));

  app.post('/school/omr/exams/new', requireAuth, ah(async (req, res) => {
    const { name, template_id, subject_id, class_id, exam_date, duration_minutes, answer_key_id, instructions } = req.body;
    const [templates] = await pool.query('SELECT * FROM omr_templates WHERE id=? AND tenant_id=?', [+template_id, tid(req)]);
    const totalMarks = templates.length ? templates[0].total_questions * templates[0].marks_per_q : 0;
    await pool.query(
      `INSERT INTO omr_exams (tenant_id,name,template_id,subject_id,class_id,exam_date,duration_minutes,total_marks,answer_key_id,instructions,created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [tid(req), name, +template_id, +(subject_id||0), +(class_id||0), exam_date || null, +(duration_minutes||60), totalMarks, +(answer_key_id||0), instructions, uid(req)]
    );
    audit(req, 'omr_exam_create', { name });
    res.redirect('/school/omr/exams');
  }));

  app.get('/school/omr/exams/:id', requireAuth, ah(async (req, res) => {
    const [exams] = await pool.query(`SELECT e.*, t.name AS template_name, t.total_questions, t.marks_per_q, t.negative_marking
      FROM omr_exams e LEFT JOIN omr_templates t ON t.id=e.template_id WHERE e.id=? AND e.tenant_id=?`, [req.params.id, tid(req)]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const e = exams[0];
    const [keys] = await pool.query('SELECT * FROM omr_answer_keys WHERE id=?', [e.answer_key_id]);
    const key = keys.length ? keys[0] : null;
    const statusColors = { draft:'#94a3b8', scheduled:'#f59e0b', active:'#3b82f6', scanning:'#8b5cf6', completed:'#10b981', published:'#059669' };

    res.send(renderPage('Exam: ' + e.name, `
      <div class="page-header"><h2>${esc(e.name)}</h2>
        <div style="display:flex;gap:8px;margin-top:8px">
          <a href="/school/omr/exams/${esc(e.id)}/edit" class="btn btn-secondary">Edit</a>
          <a href="/school/omr/scan?exam_id=${esc(e.id)}" class="btn btn-primary">Scan Sheet</a>
          <a href="/school/omr/batch-scan" class="btn">Batch Scan</a>
          <a href="/school/omr/results/${esc(e.id)}" class="btn">Results</a>
          <a href="/school/omr/analysis/${esc(e.id)}" class="btn">Analysis</a>
        </div></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px">
        <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <h3 style="font-size:14px;margin:0 0 10px">Details</h3>
          <table style="width:100%;font-size:13px">
            <tr><td style="padding:3px;color:#64748b">Template</td><td style="font-weight:600">${esc(e.template_name||'-')}</td></tr>
            <tr><td style="padding:3px;color:#64748b">Date</td><td style="font-weight:600">${esc(e.exam_date||'Not set')}</td></tr>
            <tr><td style="padding:3px;color:#64748b">Duration</td><td style="font-weight:600">${e.duration_minutes} min</td></tr>
            <tr><td style="padding:3px;color:#64748b">Max Marks</td><td style="font-weight:600">${e.total_marks}</td></tr>
            <tr><td style="padding:3px;color:#64748b">Status</td><td><span style="background:${statusColors[e.status]};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600">${e.status}</span></td></tr>
          </table></div>
        <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <h3 style="font-size:14px;margin:0 0 10px">Scanning Progress</h3>
          <div style="text-align:center;padding:20px 0">
            <div style="font-size:48px;font-weight:800;color:#3b82f6">${e.sheets_total > 0 ? Math.round(e.sheets_processed/e.sheets_total*100) : 0}%</div>
            ${cssBar(e.sheets_total > 0 ? e.sheets_processed/e.sheets_total*100 : 0, '#3b82f6')}
            <div style="font-size:13px;color:#64748b;margin-top:8px">${e.sheets_processed} / ${e.sheets_total} sheets processed</div>
          </div></div>
        <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
          <h3 style="font-size:14px;margin:0 0 10px">Answer Key</h3>
          ${key ? `<p style="font-size:13px"><strong>Set ${esc(key.set_name)}</strong></p>
            <p style="font-size:12px;color:#64748b;word-break:break-all">${esc(key.answers)}</p>`
            : '<p style="color:#94a3b8;font-size:13px">No answer key assigned</p>'}
          ${e.instructions ? `<div style="margin-top:12px;padding-top:8px;border-top:1px solid #e2e8f0">
            <h4 style="font-size:13px;margin:0 0 4px">Instructions</h4>
            <p style="font-size:12px;color:#64748b">${esc(e.instructions)}</p></div>` : ''}
        </div>
      </div>
    `, req));
  }));

  app.get('/school/omr/exams/:id/edit', requireAuth, ah(async (req, res) => {
    const [exams] = await pool.query('SELECT * FROM omr_exams WHERE id=? AND tenant_id=?', [req.params.id, tid(req)]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const [templates] = await pool.query('SELECT id, name, total_questions FROM omr_templates WHERE tenant_id=?', [tid(req)]);
    const [keyList] = await pool.query(`SELECT ak.id, ak.set_name, t.name AS template_name FROM omr_answer_keys ak JOIN omr_templates t ON t.id=ak.template_id WHERE ak.tenant_id=?`, [tid(req)]);
    res.send(renderPage('Edit Exam', examForm(exams[0], templates, keyList), req));
  }));

  app.post('/school/omr/exams/:id/edit', requireAuth, ah(async (req, res) => {
    const { name, template_id, subject_id, class_id, exam_date, duration_minutes, answer_key_id, instructions } = req.body;
    const [templates] = await pool.query('SELECT * FROM omr_templates WHERE id=?', [+template_id]);
    const totalMarks = templates.length ? templates[0].total_questions * templates[0].marks_per_q : 0;
    await pool.query(
      `UPDATE omr_exams SET name=?,template_id=?,subject_id=?,class_id=?,exam_date=?,duration_minutes=?,total_marks=?,answer_key_id=?,instructions=? WHERE id=? AND tenant_id=?`,
      [name, +template_id, +(subject_id||0), +(class_id||0), exam_date || null, +(duration_minutes||60), totalMarks, +(answer_key_id||0), instructions, req.params.id, tid(req)]
    );
    audit(req, 'omr_exam_edit', { id: req.params.id });
    res.redirect('/school/omr/exams');
  }));

  app.get('/school/omr/exams/:id/activate', requireAuth, ah(async (req, res) => {
    await pool.query("UPDATE omr_exams SET status='active' WHERE id=? AND tenant_id=? AND status IN ('draft','scheduled')", [req.params.id, tid(req)]);
    res.redirect('/school/omr/exams');
  }));

  app.get('/school/omr/exams/:id/publish', requireAuth, ah(async (req, res) => {
    await pool.query("UPDATE omr_exams SET status='published' WHERE id=? AND tenant_id=? AND status='completed'", [req.params.id, tid(req)]);
    audit(req, 'omr_exam_publish', { id: req.params.id });
    res.redirect('/school/omr/exams');
  }));

  app.post('/school/omr/exams/:id/delete', requireAuth, ah(async (req, res) => {
    const examId = req.params.id;
    await pool.query('DELETE FROM omr_result_analysis WHERE exam_id=? AND tenant_id=?', [examId, tid(req)]);
    await pool.query('DELETE FROM omr_results WHERE exam_id=? AND tenant_id=?', [examId, tid(req)]);
    await pool.query('DELETE FROM omr_scanned_sheets WHERE exam_id=? AND tenant_id=?', [examId, tid(req)]);
    await pool.query('DELETE FROM omr_exams WHERE id=? AND tenant_id=?', [examId, tid(req)]);
    audit(req, 'omr_exam_delete', { id: examId });
    res.redirect('/school/omr/exams');
  }));

  function examForm(e, templates, keyList) {
    const isEdit = e && e.id;
    return `<div style="background:#fff;border-radius:12px;padding:24px;box-shadow:0 1px 3px rgba(0,0,0,.08);max-width:800px">
      <h3 style="margin:0 0 16px">${isEdit ? 'Edit' : 'Create'} OMR Exam</h3>
      <form method="POST" action="${isEdit ? '/school/omr/exams/'+e.id+'/edit' : '/school/omr/exams/new'}">
        <div style="margin-bottom:12px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Exam Name *</label>
          <input name="name" value="${esc(e?.name||'')}" required style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Template *</label>
            <select name="template_id" required style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
              <option value="">Select template...</option>
              ${templates.map(t => `<option value="${t.id}" ${e?.template_id===t.id?'selected':''}>${esc(t.name)} (${t.total_questions}Q)</option>`).join('')}
            </select></div>
          <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Answer Key</label>
            <select name="answer_key_id" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px">
              <option value="">None</option>
              ${keyList.map(k => `<option value="${k.id}" ${e?.answer_key_id===k.id?'selected':''}>${esc(k.template_name)} - Set ${esc(k.set_name)}</option>`).join('')}
            </select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:12px">
          <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Exam Date</label>
            <input name="exam_date" type="date" value="${e?.exam_date ? e.exam_date.toISOString().split('T')[0] : ''}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Duration (min)</label>
            <input name="duration_minutes" type="number" value="${e?.duration_minutes||60}" min="10" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
          <div><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Subject ID</label>
            <input name="subject_id" type="number" value="${e?.subject_id||0}" style="width:100%;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
        </div>
        <div style="margin-bottom:12px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Class ID</label>
          <input name="class_id" type="number" value="${e?.class_id||0}" style="width:200px;padding:8px;border:1px solid #cbd5e1;border-radius:8px"></div>
        <div style="margin-bottom:16px"><label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Instructions for Students</label>
          <textarea name="instructions" rows="3" style="width:100%;padding:8px 12px;border:1px solid #cbd5e1;border-radius:8px">${esc(e?.instructions||'')}</textarea></div>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Update' : 'Create'} Exam</button>
        <a href="/school/omr/exams" class="btn">Cancel</a>
      </form>
    </div>`;
  }

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 29 — Scanned Sheets Review (Flagged)
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/scanned-sheets', requireAuth, ah(async (req, res) => {
    const examId = req.query.exam_id;
    const sql = examId
      ? 'SELECT s.*, e.name AS exam_name FROM omr_scanned_sheets s JOIN omr_exams e ON e.id=s.exam_id WHERE s.tenant_id=? AND s.exam_id=? ORDER BY s.created_at DESC'
      : 'SELECT s.*, e.name AS exam_name FROM omr_scanned_sheets s JOIN omr_exams e ON e.id=s.exam_id WHERE s.tenant_id=? ORDER BY s.created_at DESC';
    const params = examId ? [tid(req), +examId] : [tid(req)];
    const [sheets] = await pool.query(sql, params);

    const rows = sheets.length === 0
      ? '<tr><td colspan="7" style="text-align:center;padding:40px;color:#94a3b8">No scanned sheets</td></tr>'
      : sheets.map(s => {
          const amb = s.ambiguous_questions ? JSON.parse(s.ambiguous_questions) : [];
          const qualityColors = { high:'#10b981', medium:'#f59e0b', low:'#ef4444', rejected:'#991b1b' };
          return `<tr style="${amb.length > 5 ? 'background:#fef2f2' : ''}">
            <td>${esc(s.exam_name)}</td>
            <td style="font-weight:600">${esc(s.roll_number)}</td>
            <td>${esc(s.student_name || '-')}</td>
            <td><span style="background:${qualityColors[s.scan_quality]||'#94a3b8'};color:#fff;padding:2px 8px;border-radius:8px;font-size:12px">${s.scan_quality}</span></td>
            <td>${amb.length > 0 ? `<span style="color:#f59e0b;font-weight:600">${amb.length} ambiguous</span>` : '<span style="color:#10b981">Clean</span>'}</td>
            <td>${s.processed ? '✅' : '⏳'}</td>
            <td>${s.created_at ? s.created_at.toISOString().split('T')[0] : '-'}</td>
          </tr>`;
        }).join('');

    res.send(renderPage('Scanned Sheets', `
      <div class="page-header"><h2>Scanned Sheets</h2></div>
      <div style="background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)">
        <table class="table"><thead><tr><th>Exam</th><th>Roll No</th><th>Student</th><th>Quality</th><th>Status</th><th>Processed</th><th>Date</th></tr></thead>
        <tbody>${rows}</tbody></table>
      </div>
    `, req));
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 30 — Bulk Certificate Generation (Top Performers)
     ═══════════════════════════════════════════════════════════════ */
  app.get('/school/omr/certificates/:examId', requireAuth, ah(async (req, res) => {
    const examId = +req.params.examId;
    await calculateExamResults(req, res, examId);
    const [exams] = await pool.query('SELECT e.*, t.name AS template_name FROM omr_exams e JOIN omr_templates t ON t.id=e.template_id WHERE e.id=? AND e.tenant_id=?', [examId, tid(req)]);
    if (!exams.length) return res.status(404).send('Exam not found');
    const exam = exams[0];
    const topN = +req.query.top || 10;
    const [results] = await pool.query('SELECT * FROM omr_results WHERE exam_id=? AND tenant_id=? ORDER BY rank LIMIT ?', [examId, tid(req), topN]);

    const certs = results.map(r => `
      <div style="border:4px double #1e293b;padding:40px;text-align:center;page-break-after:always;max-width:700px;margin:20px auto;background:linear-gradient(135deg,#fefce8,#fff)">
        <div style="font-size:12px;letter-spacing:4px;color:#64748b;text-transform:uppercase">Certificate of Achievement</div>
        <div style="font-size:28px;font-weight:800;color:#1e293b;margin:12px 0">${esc(exam.name)}</div>
        <div style="width:60px;height:3px;background:#f59e0b;margin:0 auto 20px"></div>
        <div style="font-size:14px;color:#64748b;margin-bottom:8px">This is to certify that</div>
        <div style="font-size:24px;font-weight:700;color:#3b82f6;margin-bottom:8px">Student #${r.student_id}</div>
        <div style="font-size:14px;color:#64748b;margin-bottom:16px">has secured</div>
        <div style="font-size:36px;font-weight:800;color:#059669">${r.percentage}%</div>
        <div style="font-size:14px;color:#64748b;margin-top:4px">Grade: <strong>${esc(r.grade)}</strong> &bull; Rank: <strong>#${r.rank}</strong></div>
        <div style="font-size:14px;color:#64748b;margin-top:4px">Marks: ${r.total_marks} / ${r.max_marks}</div>
        <div style="margin-top:24px;font-size:12px;color:#94a3b8">Awarded on ${new Date().toLocaleDateString()}</div>
      </div>`).join('');

    res.send(renderPage('Certificates', `
      <div style="text-align:center;margin-bottom:20px">
        <h2>Certificates — ${esc(exam.name)}</h2>
        <p style="color:#64748b">Top ${results.length} performers</p>
        <button onclick="window.print()" class="btn btn-primary" style="margin-top:8px">Print All Certificates</button>
      </div>
      ${certs}
    `, req));
  }));

  /* ─── module info ─────────────────────────────────────────── */
  console.log('[OMR Scanner] Module loaded — 30 routes under /school/omr/');
};
