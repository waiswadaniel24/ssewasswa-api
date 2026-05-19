/**
 * School SaaS Portal — User Onboarding Wizard
 * Step-by-step onboarding for new schools/organizations.
 * Steps: 1) School Profile  2) Academic Structure  3) Import Students
 *        4) Module Configuration  5) Invite Staff
 *
 * 14 routes under /school/onboarding
 */

module.exports = function (app, pool, opts) {
  const esc =
    opts.esc ||
    (s =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'));
  const renderPage =
    opts.renderPage || ((t, c, u) => c);
  const ah =
    opts.ah ||
    (fn => async (req, res, next) => {
      try { await fn(req, res, next); }
      catch (e) { res.status(500).send('Error: ' + e.message); }
    });
  const requireAuth =
    opts.requireAuth ||
    ((req, res, next) => {
      if (!req.session?.user) return res.redirect('/login');
      next();
    });
  const audit = opts.audit || (() => {});

  const tenantId = req => req.session?.user?.tenant_id || 0;

  /* ── Migrations ─────────────────────────────────────────── */
  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS onboarding_progress (
        id              SERIAL PRIMARY KEY,
        tenant_id       INT UNIQUE,
        current_step    INT DEFAULT 1,
        completed_steps JSONB DEFAULT '[]',
        is_complete     BOOLEAN DEFAULT false,
        started_at      TIMESTAMPTZ DEFAULT NOW(),
        completed_at    TIMESTAMPTZ
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS onboarding_data (
        id          SERIAL PRIMARY KEY,
        tenant_id   INT NOT NULL,
        step        INT NOT NULL,
        data        JSONB DEFAULT '{}',
        updated_at  TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, step)
      )`);
  }
  migrate().catch(console.error);

  /* ── Helpers ────────────────────────────────────────────── */
  const TOTAL_STEPS = 5;

  async function getProgress(tid) {
    const r = await pool.query(
      'SELECT * FROM onboarding_progress WHERE tenant_id = $1', [tid]);
    return r.rows[0] || null;
  }

  async function initProgress(tid) {
    const existing = await getProgress(tid);
    if (existing) return existing;
    const r = await pool.query(
      'INSERT INTO onboarding_progress (tenant_id) VALUES ($1) RETURNING *', [tid]);
    return r.rows[0];
  }

  async function setProgress(tid, step) {
    const prog = await initProgress(tid);
    const done = [...(prog.completed_steps || [])];
    if (!done.includes(step - 1)) done.push(step - 1);
    if (step >= TOTAL_STEPS) {
      await pool.query(
        `UPDATE onboarding_progress SET current_step=$1, completed_steps=$2,
         is_complete=true, completed_at=NOW() WHERE tenant_id=$3`,
        [TOTAL_STEPS, JSON.stringify(done), tid]);
    } else {
      await pool.query(
        `UPDATE onboarding_progress SET current_step=$1, completed_steps=$2
         WHERE tenant_id=$3`,
        [step, JSON.stringify(done), tid]);
    }
  }

  async function saveStepData(tid, step, data) {
    const json = JSON.stringify(data);
    await pool.query(`
      INSERT INTO onboarding_data (tenant_id, step, data)
      VALUES ($1, $2, $3::jsonb)
      ON CONFLICT (tenant_id, step) DO UPDATE SET data=$3::jsonb, updated_at=NOW()`,
      [tid, step, json]);
  }

  async function getStepData(tid, step) {
    const r = await pool.query(
      'SELECT data FROM onboarding_data WHERE tenant_id=$1 AND step=$2', [tid, step]);
    return r.rows[0]?.data || {};
  }

  /* ── Step Bar HTML ──────────────────────────────────────── */
  function stepBar(current, completedSteps = []) {
    const labels = [
      'School Profile', 'Academic Structure', 'Import Students',
      'Modules', 'Invite Staff'
    ];
    const pct = Math.round((completedSteps.length / TOTAL_STEPS) * 100);
    let html = `<div class="onb-progress-wrap">
      <div class="onb-pct"><strong>${pct}%</strong> complete</div>
      <div class="onb-bar"><div class="onb-bar-fill" style="width:${pct}%"></div></div>
      <div class="onb-steps">`;
    for (let i = 1; i <= TOTAL_STEPS; i++) {
      const done = completedSteps.includes(i);
      const active = i === current;
      const icon = done ? '&#9989;' : active ? '&#10148;' : '&#9675;';
      const cls = done ? 'onb-step done' : active ? 'onb-step active' : 'onb-step';
      html += `<a href="/school/onboarding/step/${i}" class="${cls}">
        <span class="onb-icon">${icon}</span>
        <span class="onb-label">Step ${i}</span>
        <span class="onb-sublabel">${labels[i - 1]}</span>
      </a>`;
      if (i < TOTAL_STEPS) html += '<div class="onb-arrow">&#8594;</div>';
    }
    html += '</div></div>';
    return html;
  }

  /* ── Page wrapper ───────────────────────────────────────── */
  function page(title, body, req, step, prog) {
    const done = (prog?.completed_steps || []);
    return renderPage(title, `
<link rel="stylesheet" href="/css/sk.css">
<style>
  .onb-wrap{max-width:860px;margin:0 auto;padding:20px 16px 60px;font-family:system-ui,sans-serif;color:#1e293b}
  .onb-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:28px 32px;margin-bottom:20px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
  .onb-card h2{margin:0 0 4px;font-size:1.35rem;color:#0f172a}
  .onb-card .sub{color:#64748b;margin-bottom:20px;font-size:.92rem}
  .onb-progress-wrap{margin-bottom:24px}
  .onb-pct{text-align:right;font-size:.85rem;color:#64748b;margin-bottom:6px}
  .onb-bar{background:#e2e8f0;border-radius:6px;height:8px;overflow:hidden;margin-bottom:18px}
  .onb-bar-fill{height:100%;background:linear-gradient(90deg,#4f46e5,#7c3aed);border-radius:6px;transition:width .4s}
  .onb-steps{display:flex;align-items:flex-start;justify-content:space-between;gap:4px}
  .onb-step{text-decoration:none;display:flex;flex-direction:column;align-items:center;flex:1;text-align:center;padding:8px 4px;border-radius:8px;transition:background .2s}
  .onb-step:hover{background:#f1f5f9}
  .onb-step.active{background:#eef2ff}
  .onb-icon{font-size:1.4rem;line-height:1}
  .onb-label{font-weight:600;font-size:.82rem;margin-top:4px}
  .onb-sublabel{font-size:.72rem;color:#64748b;margin-top:2px}
  .onb-step.done .onb-sublabel{color:#16a34a}
  .onb-arrow{color:#cbd5e1;font-size:1.1rem;margin-top:12px;flex:0 0 20px}
  .onb-field{margin-bottom:16px}
  .onb-field label{display:block;font-weight:600;font-size:.88rem;margin-bottom:4px;color:#334155}
  .onb-field input,.onb-field select,.onb-field textarea{width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:.92rem;transition:border-color .2s}
  .onb-field input:focus,.onb-field select:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.12)}
  .onb-row{display:grid;grid-template-columns:1fr 1fr;gap:0 16px}
  @media(max-width:560px){.onb-row{grid-template-columns:1fr}}
  .onb-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 22px;border:none;border-radius:8px;font-size:.92rem;font-weight:600;cursor:pointer;transition:background .2s}
  .onb-btn-primary{background:#4f46e5;color:#fff}
  .onb-btn-primary:hover{background:#4338ca}
  .onb-btn-secondary{background:#f1f5f9;color:#334155;border:1px solid #d1d5db}
  .onb-btn-secondary:hover{background:#e2e8f0}
  .onb-btn-danger{background:#fef2f2;color:#dc2626;border:1px solid #fca5a5}
  .onb-btn-danger:hover{background:#fee2e2}
  .onb-actions{display:flex;justify-content:space-between;align-items:center;margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0}
  .onb-table{width:100%;border-collapse:collapse;font-size:.88rem;margin:12px 0}
  .onb-table th{background:#f8fafc;text-align:left;padding:8px 10px;font-weight:600;border-bottom:2px solid #e2e8f0;color:#475569}
  .onb-table td{padding:7px 10px;border-bottom:1px solid #f1f5f9}
  .onb-table tr:hover td{background:#f8fafc}
  .onb-tag{display:inline-block;background:#eef2ff;color:#4f46e5;padding:2px 10px;border-radius:20px;font-size:.78rem;font-weight:600;margin:2px}
  .onb-alert{padding:12px 16px;border-radius:8px;font-size:.88rem;margin-bottom:16px}
  .onb-alert.info{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}
  .onb-alert.success{background:#f0fdf4;color:#166534;border:1px solid #bbf7d0}
  .onb-alert.warn{background:#fffbeb;color:#92400e;border:1px solid #fde68a}
  .onb-complete-icon{font-size:3rem;text-align:center;margin-bottom:12px}
  .onb-checklist{list-style:none;padding:0;margin:16px 0}
  .onb-checklist li{padding:8px 0;border-bottom:1px solid #f1f5f9;display:flex;align-items:center;gap:8px;font-size:.92rem}
  .onb-checklist li:last-child{border:none}
  .onb-checklist li::before{content:'\\2713';color:#16a34a;font-weight:700;font-size:1.1rem}
  .onb-modules{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
  @media(max-width:560px){.onb-modules{grid-template-columns:1fr}}
  .onb-mod-group{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:14px 16px}
  .onb-mod-group h4{margin:0 0 10px;font-size:.92rem;color:#334155}
  .onb-mod-group label{display:flex;align-items:center;gap:8px;padding:4px 0;font-size:.88rem;cursor:pointer}
  .onb-mod-group input[type=checkbox]{accent-color:#4f46e5;width:16px;height:16px}
  .onb-upload{border:2px dashed #d1d5db;border-radius:10px;padding:32px;text-align:center;color:#64748b;cursor:pointer;transition:border-color .2s}
  .onb-upload:hover{border-color:#4f46e5}
  .onb-upload input{display:none}
  .onb-staff-row{display:flex;gap:10px;align-items:end;margin-bottom:10px}
  .onb-staff-row .onb-field{flex:1;margin-bottom:0}
</style>
<div class="onb-wrap">
  ${body}
</div>`, req);
  }

  /* ══════════════════════════════════════════════════════════
     ROUTE 1 — GET /school/onboarding  (status redirect)
     ══════════════════════════════════════════════════════════ */
  app.get('/school/onboarding', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const prog = await initProgress(tid);
    if (prog.is_complete) return res.redirect('/school/onboarding/complete');
    res.redirect(`/school/onboarding/step/${prog.current_step}`);
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 2 — GET /school/onboarding/step/1  (school profile)
     ══════════════════════════════════════════════════════════ */
  app.get('/school/onboarding/step/1', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const prog = await initProgress(tid);
    const d = await getStepData(tid, 1);
    res.send(page('School Profile', `
      ${stepBar(1, prog.completed_steps)}
      <div class="onb-card">
        <h2>School Profile</h2>
        <p class="sub">Tell us about your school or organization.</p>
        <form method="POST" action="/school/onboarding/step/1">
          <div class="onb-row">
            <div class="onb-field">
              <label for="name">School Name *</label>
              <input id="name" name="name" required placeholder="Springfield Academy" value="${esc(d.name || '')}">
            </div>
            <div class="onb-field">
              <label for="type">School Type *</label>
              <select id="type" name="type" required>
                <option value="">Select type...</option>
                ${['Primary','Secondary','K-12','Higher Education','Vocational','International','Other'].map(t =>
                  `<option value="${t}" ${d.type === t ? 'selected' : ''}>${t}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="onb-field">
            <label for="logo">Logo URL</label>
            <input id="logo" name="logo" placeholder="https://example.com/logo.png" value="${esc(d.logo || '')}">
          </div>
          <div class="onb-field">
            <label for="address">Address</label>
            <input id="address" name="address" placeholder="123 Education St, City, State" value="${esc(d.address || '')}">
          </div>
          <div class="onb-row">
            <div class="onb-field">
              <label for="phone">Phone</label>
              <input id="phone" name="phone" placeholder="+1 (555) 000-0000" value="${esc(d.phone || '')}">
            </div>
            <div class="onb-field">
              <label for="email">Admin Email *</label>
              <input id="email" name="email" type="email" required placeholder="admin@school.edu" value="${esc(d.email || '')}">
            </div>
          </div>
          <div class="onb-row">
            <div class="onb-field">
              <label for="academic_year">Academic Year *</label>
              <input id="academic_year" name="academic_year" required placeholder="2025-2026" value="${esc(d.academic_year || '')}">
            </div>
            <div class="onb-field">
              <label for="timezone">Timezone</label>
              <select id="timezone" name="timezone">
                ${['America/New_York','America/Chicago','America/Denver','America/Los_Angeles',
                   'Europe/London','Europe/Paris','Asia/Dubai','Asia/Kolkata','Asia/Tokyo','Australia/Sydney'].map(tz =>
                  `<option value="${tz}" ${d.timezone === tz ? 'selected' : ''}>${tz}</option>`).join('')}
              </select>
            </div>
          </div>
          <div class="onb-actions">
            <span></span>
            <button type="submit" class="onb-btn onb-btn-primary">Save &amp; Continue &rarr;</button>
          </div>
        </form>
      </div>`, req, 1, prog));
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 3 — POST /school/onboarding/step/1  (save profile)
     ══════════════════════════════════════════════════════════ */
  app.post('/school/onboarding/step/1', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { name, logo, address, type, phone, email, academic_year, timezone } = req.body;
    if (!name || !type || !email || !academic_year) {
      return res.status(400).send('Required fields: name, type, email, academic_year');
    }
    await saveStepData(tid, 1, { name, logo, address, type, phone, email, academic_year, timezone });
    await setProgress(tid, 2);
    audit(req, 'onboarding', 'step1_saved', { name });
    res.redirect('/school/onboarding/step/2');
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 4 — GET /school/onboarding/step/2  (academic structure)
     ══════════════════════════════════════════════════════════ */
  app.get('/school/onboarding/step/2', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const prog = await initProgress(tid);
    const d = await getStepData(tid, 2);
    const classes = d.classes || [];
    const subjects = d.subjects || [];
    res.send(page('Academic Structure', `
      ${stepBar(2, prog.completed_steps)}
      <div class="onb-card">
        <h2>Academic Structure</h2>
        <p class="sub">Define classes/sections and subjects offered at your school.</p>
        <div class="onb-row">
          <div>
            <h3 style="font-size:1rem;margin:0 0 8px">Classes / Sections</h3>
            <div id="class-list">
              ${classes.map((c, i) => `
                <div class="onb-staff-row" data-idx="${i}">
                  <div class="onb-field"><input name="class_name" value="${esc(c.name)}" placeholder="Class name"></div>
                  <div class="onb-field"><input name="class_teacher" value="${esc(c.teacher)}" placeholder="Class teacher"></div>
                  <button type="button" class="onb-btn onb-btn-danger" onclick="this.parentElement.remove()" style="padding:8px 12px">✕</button>
                </div>`).join('')}
            </div>
            <button type="button" class="onb-btn onb-btn-secondary" onclick="addClassRow()">+ Add Class</button>
          </div>
          <div>
            <h3 style="font-size:1rem;margin:0 0 8px">Subjects</h3>
            <div id="subject-list">
              ${subjects.map((s, i) => `
                <div class="onb-staff-row" data-idx="${i}">
                  <div class="onb-field"><input name="subject" value="${esc(s)}" placeholder="Subject name"></div>
                  <button type="button" class="onb-btn onb-btn-danger" onclick="this.parentElement.remove()" style="padding:8px 12px">✕</button>
                </div>`).join('')}
            </div>
            <button type="button" class="onb-btn onb-btn-secondary" onclick="addSubjectRow()">+ Add Subject</button>
          </div>
        </div>
        <form method="POST" action="/school/onboarding/step/2" id="step2form">
          <div class="onb-actions">
            <a href="/school/onboarding/step/1" class="onb-btn onb-btn-secondary">&larr; Back</a>
            <button type="submit" class="onb-btn onb-btn-primary">Save &amp; Continue &rarr;</button>
          </div>
        </form>
      </div>
      <script>
        function addClassRow(){
          const d=document.createElement('div');d.className='onb-staff-row';
          d.innerHTML='<div class="onb-field"><input name="class_name" placeholder="Class name"></div><div class="onb-field"><input name="class_teacher" placeholder="Class teacher"></div><button type="button" class="onb-btn onb-btn-danger" onclick="this.parentElement.remove()" style="padding:8px 12px">✕</button>';
          document.getElementById('class-list').appendChild(d);
        }
        function addSubjectRow(){
          const d=document.createElement('div');d.className='onb-staff-row';
          d.innerHTML='<div class="onb-field"><input name="subject" placeholder="Subject name"></div><button type="button" class="onb-btn onb-btn-danger" onclick="this.parentElement.remove()" style="padding:8px 12px">✕</button>';
          document.getElementById('subject-list').appendChild(d);
        }
        document.getElementById('step2form').addEventListener('submit',function(e){
          e.preventDefault();
          const classes=[], subjects=[];
          document.querySelectorAll('#class-list .onb-staff-row').forEach(r=>{
            const n=r.querySelector('input[name=class_name]').value.trim();
            const t=r.querySelector('input[name=class_teacher]').value.trim();
            if(n) classes.push({name:n,teacher:t});
          });
          document.querySelectorAll('#subject-list .onb-staff-row').forEach(r=>{
            const v=r.querySelector('input[name=subject]').value.trim();
            if(v) subjects.push(v);
          });
          const fd=new FormData();fd.append('classes',JSON.stringify(classes));fd.append('subjects',JSON.stringify(subjects));
          fetch('/school/onboarding/step/2',{method:'POST',body:fd}).then(r=>{if(r.ok)window.location.href='/school/onboarding/step/3';});
        });
      </script>`, req, 2, prog));
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 5 — POST /school/onboarding/step/2  (save structure)
     ══════════════════════════════════════════════════════════ */
  app.post('/school/onboarding/step/2', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    let classes = req.body.classes;
    let subjects = req.body.subjects;
    if (typeof classes === 'string') classes = JSON.parse(classes);
    if (typeof subjects === 'string') subjects = JSON.parse(subjects);
    classes = Array.isArray(classes) ? classes : [];
    subjects = Array.isArray(subjects) ? subjects : [];
    await saveStepData(tid, 2, { classes, subjects });
    await setProgress(tid, 3);
    audit(req, 'onboarding', 'step2_saved', { classCount: classes.length, subjectCount: subjects.length });
    res.redirect('/school/onboarding/step/3');
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 6 — GET /school/onboarding/step/3  (import students)
     ══════════════════════════════════════════════════════════ */
  app.get('/school/onboarding/step/3', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const prog = await initProgress(tid);
    const d = await getStepData(tid, 3);
    const students = d.students || [];
    res.send(page('Import Students', `
      ${stepBar(3, prog.completed_steps)}
      <div class="onb-card">
        <h2>Import Students</h2>
        <p class="sub">Upload a CSV file with student data or add them manually.</p>
        <div class="onb-alert info">
          <strong>CSV Format:</strong> name, email, class, roll_number, parent_phone (header row required)
        </div>
        <form method="POST" action="/school/onboarding/step/3" enctype="multipart/form-data" id="csvform">
          <div class="onb-upload" id="dropzone">
            <input type="file" name="csvfile" id="csvfile" accept=".csv">
            <p style="margin:8px 0 0;font-size:1.1rem">&#128196;</p>
            <p><strong>Click to upload</strong> or drag &amp; drop a CSV file</p>
          </div>
          <input type="hidden" name="action" value="upload" id="csvAction">
          ${students.length ? `
            <h3 style="font-size:1rem;margin:18px 0 8px">Preview (${students.length} students)</h3>
            <div style="max-height:260px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px">
              <table class="onb-table">
                <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Class</th><th>Roll</th><th>Parent Phone</th></tr></thead>
                <tbody>${students.map((s, i) => `<tr>
                  <td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.email)}</td>
                  <td><span class="onb-tag">${esc(s.class || '')}</span></td>
                  <td>${esc(s.roll_number || '')}</td><td>${esc(s.parent_phone || '')}</td>
                </tr>`).join('')}</tbody>
              </table>
            </div>` : ''}
          <div class="onb-actions">
            <a href="/school/onboarding/step/2" class="onb-btn onb-btn-secondary">&larr; Back</a>
            <div style="display:flex;gap:10px">
              ${students.length ? '<button type="button" class="onb-btn onb-btn-secondary" onclick="document.getElementById(\'csvAction\').value=\'clear\';document.getElementById(\'csvform\').submit()">Clear All</button>' : ''}
              <button type="submit" class="onb-btn onb-btn-primary">${students.length ? 'Save &amp; Continue &rarr;' : 'Skip &amp; Continue &rarr;'}</button>
            </div>
          </div>
        </form>
      </div>
      <script>
        document.getElementById('dropzone').addEventListener('click',()=>document.getElementById('csvfile').click());
        document.getElementById('dropzone').addEventListener('dragover',e=>{e.preventDefault();e.currentTarget.style.borderColor='#4f46e5'});
        document.getElementById('dropzone').addEventListener('dragleave',e=>{e.currentTarget.style.borderColor='#d1d5db'});
        document.getElementById('dropzone').addEventListener('drop',e=>{
          e.preventDefault();e.currentTarget.style.borderColor='#d1d5db';
          const f=e.dataTransfer.files[0];if(f)document.getElementById('csvform').submit();
        });
      </script>`, req, 3, prog));
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 7 — POST /school/onboarding/step/3  (parse & save CSV)
     ══════════════════════════════════════════════════════════ */
  app.post('/school/onboarding/step/3', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const action = req.body.action;
    if (action === 'clear') {
      await saveStepData(tid, 3, { students: [] });
      return res.redirect('/school/onboarding/step/3');
    }
    const d = await getStepData(tid, 3);
    if (req.file) {
      const content = req.file.buffer.toString('utf8');
      const lines = content.split(/\r?\n/).filter(l => l.trim());
      if (lines.length < 2) return res.redirect('/school/onboarding/step/3');
      const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
      const students = [];
      for (let i = 1; i < lines.length; i++) {
        const vals = lines[i].split(',').map(v => v.trim());
        const obj = {};
        headers.forEach((h, j) => { obj[h] = vals[j] || ''; });
        if (obj.name) students.push(obj);
      }
      await saveStepData(tid, 3, { students });
      audit(req, 'onboarding', 'step3_preview', { count: students.length });
      return res.redirect('/school/onboarding/step/3');
    }
    await setProgress(tid, 4);
    audit(req, 'onboarding', 'step3_saved', { studentCount: (d.students || []).length });
    res.redirect('/school/onboarding/step/4');
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 8 — GET /school/onboarding/step/4  (module config)
     ══════════════════════════════════════════════════════════ */
  const MODULE_CATEGORIES = [
    { name: 'Academic', modules: [
      { id: 'attendance', label: 'Student Attendance', desc: 'Track daily attendance' },
      { id: 'gradebook', label: 'Gradebook &amp; Report Cards', desc: 'Grades, GPA, transcripts' },
      { id: 'timetable', label: 'Timetable / Scheduler', desc: 'Class scheduling' },
      { id: 'homework', label: 'Homework &amp; Assignments', desc: 'Digital assignment management' },
      { id: 'exams', label: 'Exam Management', desc: 'Schedule, results, analytics' },
    ]},
    { name: 'Communication', modules: [
      { id: 'messaging', label: 'Messaging &amp; Notifications', desc: 'Announcements, SMS, email' },
      { id: 'parent_portal', label: 'Parent Portal', desc: 'Parent dashboards &amp; access' },
      { id: 'forums', label: 'Discussion Forums', desc: 'Class &amp; school forums' },
    ]},
    { name: 'Administration', modules: [
      { id: 'fees', label: 'Fee Management', desc: 'Invoicing, payments, reports' },
      { id: 'transport', label: 'Transport / Fleet', desc: 'Bus routes &amp; tracking' },
      { id: 'library', label: 'Library System', desc: 'Catalog, issue, returns' },
      { id: 'inventory', label: 'Asset Inventory', desc: 'School assets &amp; stock' },
    ]},
    { name: 'Reporting', modules: [
      { id: 'analytics', label: 'Analytics Dashboard', desc: 'Visual data insights' },
      { id: 'reports', label: 'Custom Reports', desc: 'Configurable report builder' },
      { id: 'compliance', label: 'Compliance &amp; Audit', desc: 'Regulatory compliance logs' },
    ]},
  ];

  app.get('/school/onboarding/step/4', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const prog = await initProgress(tid);
    const d = await getStepData(tid, 4);
    const enabled = new Set(d.enabled_modules || []);
    res.send(page('Module Configuration', `
      ${stepBar(4, prog.completed_steps)}
      <div class="onb-card">
        <h2>Configure Modules</h2>
        <p class="sub">Select the modules your school needs. You can change this later in Settings.</p>
        <form method="POST" action="/school/onboarding/step/4">
          <div class="onb-modules">
            ${MODULE_CATEGORIES.map(cat => `
              <div class="onb-mod-group">
                <h4>${esc(cat.name)}</h4>
                ${cat.modules.map(m => `
                  <label>
                    <input type="checkbox" name="modules" value="${m.id}" ${enabled.has(m.id) ? 'checked' : ''}>
                    <div><strong>${m.label}</strong><br><span style="color:#64748b;font-size:.8rem">${m.desc}</span></div>
                  </label>`).join('')}
              </div>`).join('')}
          </div>
          <div class="onb-actions">
            <a href="/school/onboarding/step/3" class="onb-btn onb-btn-secondary">&larr; Back</a>
            <button type="submit" class="onb-btn onb-btn-primary">Save &amp; Continue &rarr;</button>
          </div>
        </form>
      </div>`, req, 4, prog));
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 9 — POST /school/onboarding/step/4  (save modules)
     ══════════════════════════════════════════════════════════ */
  app.post('/school/onboarding/step/4', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const modules = Array.isArray(req.body.modules) ? req.body.modules : (req.body.modules ? [req.body.modules] : []);
    await saveStepData(tid, 4, { enabled_modules: modules });
    await setProgress(tid, 5);
    audit(req, 'onboarding', 'step4_saved', { modules });
    res.redirect('/school/onboarding/step/5');
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 10 — GET /school/onboarding/step/5  (invite staff)
     ══════════════════════════════════════════════════════════ */
  app.get('/school/onboarding/step/5', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const prog = await initProgress(tid);
    const d = await getStepData(tid, 5);
    const invitations = d.invitations || [];
    res.send(page('Invite Staff', `
      ${stepBar(5, prog.completed_steps)}
      <div class="onb-card">
        <h2>Invite Staff</h2>
        <p class="sub">Add teachers, administrators, and support staff to your school.</p>
        <form method="POST" action="/school/onboarding/step/5" id="staffform">
          <div class="onb-staff-row">
            <div class="onb-field"><label>Name</label><input name="name" placeholder="Full name"></div>
            <div class="onb-field"><label>Email</label><input name="email" type="email" placeholder="staff@school.edu"></div>
            <div class="onb-field"><label>Role</label>
              <select name="role">
                ${['Teacher','Administrator','Librarian','Accountant','Support Staff'].map(r =>
                  `<option value="${r}">${r}</option>`).join('')}
              </select>
            </div>
            <button type="button" class="onb-btn onb-btn-primary" onclick="addStaffInvitation()" style="margin-bottom:0;white-space:nowrap">+ Add</button>
          </div>
          <input type="hidden" name="action" value="add">
        </form>
        ${invitations.length ? `
          <h3 style="font-size:1rem;margin:18px 0 8px">Pending Invitations (${invitations.length})</h3>
          <div style="max-height:260px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:8px">
            <table class="onb-table">
              <thead><tr><th>#</th><th>Name</th><th>Email</th><th>Role</th><th>Status</th></tr></thead>
              <tbody>${invitations.map((s, i) => `<tr>
                <td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.email)}</td>
                <td><span class="onb-tag">${esc(s.role)}</span></td>
                <td style="color:#d97706">&#9203; Pending</td>
              </tr>`).join('')}</tbody>
            </table>
          </div>` : `
          <div class="onb-alert info" style="margin-top:16px">No invitations yet. Add staff members above to send invitations.</div>`}
        <form method="POST" action="/school/onboarding/step/5">
          <input type="hidden" name="action" value="finish">
          <div class="onb-actions">
            <a href="/school/onboarding/step/4" class="onb-btn onb-btn-secondary">&larr; Back</a>
            <button type="submit" class="onb-btn onb-btn-primary">Complete Setup &rarr;</button>
          </div>
        </form>
      </div>
      <script>
        function addStaffInvitation(){
          const f=document.getElementById('staffform');
          const name=f.querySelector('input[name=name]').value.trim();
          const email=f.querySelector('input[name=email]').value.trim();
          const role=f.querySelector('select[name=role]').value;
          if(!name||!email)return alert('Name and email are required.');
          const fd=new FormData();fd.append('action','add');fd.append('name',name);fd.append('email',email);fd.append('role',role);
          fetch('/school/onboarding/step/5',{method:'POST',body:fd}).then(r=>{if(r.ok)window.location.reload();});
        }
      </script>`, req, 5, prog));
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 11 — POST /school/onboarding/step/5  (process invites)
     ══════════════════════════════════════════════════════════ */
  app.post('/school/onboarding/step/5', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const action = req.body.action;
    const d = await getStepData(tid, 5);
    const invitations = d.invitations || [];

    if (action === 'add') {
      const { name, email, role } = req.body;
      if (!name || !email) return res.status(400).send('Name and email required.');
      invitations.push({ name, email, role, invited_at: new Date().toISOString(), status: 'pending' });
      await saveStepData(tid, 5, { invitations });
      audit(req, 'onboarding', 'staff_invited', { name, email, role });
      return res.redirect('/school/onboarding/step/5');
    }

    if (action === 'finish') {
      const step1 = await getStepData(tid, 1);
      const step2 = await getStepData(tid, 2);
      const step3 = await getStepData(tid, 3);
      const step4 = await getStepData(tid, 4);
      await saveStepData(tid, 5, { invitations, school_name: step1.name });
      await setProgress(tid, 5);
      await pool.query(
        `UPDATE onboarding_progress SET is_complete=true, completed_at=NOW() WHERE tenant_id=$1`, [tid]);
      audit(req, 'onboarding', 'completed', {
        schoolName: step1.name, classes: step2.classes?.length, students: step3.students?.length,
        modules: step4.enabled_modules?.length, staff: invitations.length
      });
      return res.redirect('/school/onboarding/complete');
    }

    res.redirect('/school/onboarding/step/5');
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 12 — GET /school/onboarding/complete  (summary)
     ══════════════════════════════════════════════════════════ */
  app.get('/school/onboarding/complete', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const prog = await getProgress(tid);
    const d1 = await getStepData(tid, 1);
    const d2 = await getStepData(tid, 2);
    const d3 = await getStepData(tid, 3);
    const d4 = await getStepData(tid, 4);
    const d5 = await getStepData(tid, 5);
    const modLabels = {};
    MODULE_CATEGORIES.forEach(c => c.modules.forEach(m => { modLabels[m.id] = m.label; }));
    const enabledNames = (d4.enabled_modules || []).map(id => modLabels[id] || id);
    const studentCount = (d3.students || []).length;
    const staffCount = (d5.invitations || []).length;
    res.send(page('Setup Complete', `
      <div class="onb-card" style="text-align:center">
        <div class="onb-complete-icon">&#127881;</div>
        <h2>Welcome, ${esc(d1.name || 'your school')}!</h2>
        <p class="sub">Your school portal has been configured successfully. Here's a summary of your setup:</p>
      </div>
      <div class="onb-card">
        <h3 style="font-size:1.05rem;margin:0 0 12px">&#9989; Setup Summary</h3>
        <ul class="onb-checklist">
          <li><strong>School Profile:</strong> ${esc(d1.name || '')} &mdash; ${esc(d1.type || '')} &mdash; ${esc(d1.academic_year || '')}</li>
          <li><strong>Academic Structure:</strong> ${(d2.classes || []).length} classes, ${(d2.subjects || []).length} subjects configured</li>
          <li><strong>Students:</strong> ${studentCount > 0 ? studentCount + ' students imported' : 'No students imported yet (you can add them later)'}</li>
          <li><strong>Modules Enabled:</strong> ${enabledNames.length > 0 ? enabledNames.join(', ') : 'None selected (enable in Settings)'}</li>
          <li><strong>Staff Invited:</strong> ${staffCount > 0 ? staffCount + ' invitations sent' : 'No staff invited yet (invite from Settings)'}</li>
        </ul>
      </div>
      <div class="onb-card">
        <h3 style="font-size:1.05rem;margin:0 0 12px">&#128640; Recommended Next Steps</h3>
        <ul class="onb-checklist">
          <li>Configure your <strong>academic calendar</strong> with term dates and holidays</li>
          <li>Set up <strong>fee structures</strong> if billing is enabled</li>
          <li>Customize <strong>notifications and communication preferences</strong></li>
          <li>Add <strong>school branding</strong> (logo, colors, letterhead)</li>
          <li>Review <strong>user permissions</strong> and role settings</li>
        </ul>
      </div>
      <div style="text-align:center;margin-top:8px">
        <a href="/dashboard" class="onb-btn onb-btn-primary" style="padding:12px 36px;font-size:1rem">Go to Dashboard &rarr;</a>
      </div>`, req, null, prog));
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 13 — POST /school/onboarding/skip  (skip entirely)
     ══════════════════════════════════════════════════════════ */
  app.post('/school/onboarding/skip', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query(`
      INSERT INTO onboarding_progress (tenant_id, current_step, completed_steps, is_complete, completed_at)
      VALUES ($1, $2, '[]'::jsonb, true, NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET is_complete=true, completed_at=NOW()`,
      [tid, TOTAL_STEPS]);
    audit(req, 'onboarding', 'skipped');
    res.redirect('/dashboard');
  }));

  /* ══════════════════════════════════════════════════════════
     ROUTE 14 — GET /school/onboarding/progress  (JSON API)
     ══════════════════════════════════════════════════════════ */
  app.get('/school/onboarding/progress', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const prog = await initProgress(tid);
    const done = (prog.completed_steps || []);
    const pct = Math.round((done.length / TOTAL_STEPS) * 100);
    res.json({
      current_step: prog.current_step,
      is_complete: !!prog.is_complete,
      completed_steps: done,
      completion_percent: pct,
      started_at: prog.started_at,
      completed_at: prog.completed_at || null
    });
  }));
};
