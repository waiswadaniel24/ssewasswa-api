module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS resumes (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL, title VARCHAR(255),
        sections JSONB DEFAULT '{}', template VARCHAR(100) DEFAULT 'modern',
        ats_score INT DEFAULT 0, status VARCHAR(50) DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS resume_templates (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(255),
        category VARCHAR(100), structure JSONB DEFAULT '{}', preview_url TEXT, is_default BOOLEAN DEFAULT false
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS cover_letters (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL,
        title VARCHAR(255), content TEXT, job_title VARCHAR(255),
        company VARCHAR(255), status VARCHAR(50) DEFAULT 'draft', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS resume_reviews (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, resume_id INT NOT NULL,
        reviewer_id INT, feedback TEXT, score INT DEFAULT 0,
        reviewed_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[Mod] ai-resume-builder OK');
    } catch(e) { console.warn('[Mod] ai-resume-builder Warn:', e.message); }
  })();

  const PREFIX = '/school/ai-resume-builder';

  // ─── 1. Dashboard ───
  app.get(PREFIX, requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [resumes, templates, letters] = await Promise.all([
        pool.query('SELECT * FROM resumes WHERE tenant_id=$1 AND student_id=$2 ORDER BY updated_at DESC LIMIT 10', [req.tenant.id, req.user.id]),
        pool.query('SELECT * FROM resume_templates WHERE tenant_id=$1 ORDER BY name', [req.tenant.id]),
        pool.query('SELECT * FROM cover_letters WHERE tenant_id=$1 AND student_id=$2 ORDER BY created_at DESC LIMIT 5', [req.tenant.id, req.user.id])
      ]);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:4px">AI Resume Builder</h2>
          <p style="color:${GRAY}">Create professional resumes optimized for ATS systems</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px">
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${resumes.rows.length}</div>
            <div style="color:${GRAY}">My Resumes</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${templates.rows.length}</div>
            <div style="color:${GRAY}">Templates</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${letters.rows.length}</div>
            <div style="color:${GRAY}">Cover Letters</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
          <a href="${PREFIX}/new" class="btn">+ New Resume</a>
          <a href="${PREFIX}/templates" class="btn" style="background:#059669">Browse Templates</a>
          <a href="${PREFIX}/cover-letter/new" class="btn" style="background:#d97706">+ Cover Letter</a>
          <a href="${PREFIX}/interview-tips" class="btn" style="background:#7c3aed">Interview Tips</a>
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">My Resumes</h3>
          ${resumes.rows.length ? `<table><tr><th>Title</th><th>Template</th><th>ATS Score</th><th>Status</th><th>Updated</th><th>Actions</th></tr>
          ${resumes.rows.map(r => `<tr>
            <td>${esc(r.title)}</td>
            <td>${esc(r.template)}</td>
            <td><span style="font-weight:700;color:${r.ats_score >= 70 ? '#059669' : r.ats_score >= 40 ? '#d97706' : '#dc2626'}">${r.ats_score}%</span></td>
            <td><span style="background:${r.status === 'published' ? '#dcfce7' : r.status === 'draft' ? '#fef3c7' : '#fee2e2'};padding:2px 10px;border-radius:20px;font-size:.85em">${r.status}</span></td>
            <td>${r.updated_at.toLocaleDateString()}</td>
            <td><a href="${PREFIX}/edit/${r.id}" class="btn" style="padding:4px 10px;font-size:.85em">Edit</a>
                <a href="${PREFIX}/preview/${r.id}" class="btn" style="padding:4px 10px;font-size:.85em;background:#059669">Preview</a></td>
          </tr>`).join('')}
          </table>` : '<p style="color:${GRAY}">No resumes yet. Create your first resume!</p>'}
        </div>
        ${letters.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Recent Cover Letters</h3>
          <table><tr><th>Title</th><th>Job Title</th><th>Company</th><th>Created</th><th>Actions</th></tr>
          ${letters.rows.map(l => `<tr>
            <td>${esc(l.title)}</td><td>${esc(l.job_title || '-')}</td><td>${esc(l.company || '-')}</td>
            <td>${l.created_at.toLocaleDateString()}</td>
            <td><a href="${PREFIX}/cover-letter/edit/${l.id}" class="btn" style="padding:4px 10px;font-size:.85em">Edit</a></td>
          </tr>`).join('')}
          </table>
        </div>` : ''}
      `;
      res.send(renderPage(req, 'AI Resume Builder', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 2. New Resume ───
  app.get(PREFIX + '/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const templates = await pool.query('SELECT * FROM resume_templates WHERE tenant_id=$1 ORDER BY name', [req.tenant.id]);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Create New Resume</h2>
          <form method="POST" action="${PREFIX}/new">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Resume Title</label>
              <input type="text" name="title" placeholder="e.g., Software Engineer Resume" required>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Template</label>
              <select name="template">
                ${templates.rows.map(t => `<option value="${esc(t.name)}">${esc(t.name)} (${esc(t.category || 'General')})</option>`).join('')}
                <option value="modern">Modern (Default)</option>
                <option value="classic">Classic</option>
                <option value="minimal">Minimal</option>
                <option value="creative">Creative</option>
                <option value="executive">Executive</option>
              </select>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Target Job Title</label>
              <input type="text" name="target_job" placeholder="e.g., Frontend Developer">
            </div>
            <button type="submit" class="btn">Create Resume</button>
            <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'New Resume', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, template, target_job } = req.body;
      const sections = JSON.stringify({
        personal: { name: '', email: '', phone: '', location: '', linkedin: '', website: '' },
        objective: '',
        education: [],
        experience: [],
        skills: [],
        projects: [],
        certifications: [],
        languages: [],
        target_job: target_job || ''
      });
      const result = await pool.query(
        'INSERT INTO resumes (tenant_id, student_id, title, sections, template) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [req.tenant.id, req.user.id, title, sections, template || 'modern']
      );
      audit(req, 'resume_created', { resume_id: result.rows[0].id, title });
      res.redirect(PREFIX + '/edit/' + result.rows[0].id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 3. Edit Resume ───
  app.get(PREFIX + '/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const resume = await pool.query('SELECT * FROM resumes WHERE id=$1 AND tenant_id=$2 AND student_id=$3', [req.params.id, req.tenant.id, req.user.id]);
      if (!resume.rows.length) return res.status(404).send('Resume not found');
      const r = resume.rows[0];
      const s = typeof r.sections === 'string' ? JSON.parse(r.sections) : r.sections;
      const body = `
        ${SKIP}
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="color:${P}">Edit: ${esc(r.title)}</h2>
            <div style="display:flex;gap:8px">
              <a href="${PREFIX}/ats-check/${r.id}" class="btn" style="background:#059669">Run ATS Check</a>
              <a href="${PREFIX}/preview/${r.id}" class="btn" style="background:#7c3aed">Preview</a>
            </div>
          </div>
          <form method="POST" action="${PREFIX}/edit/${r.id}" id="resumeForm">
            <input type="hidden" name="sections" id="sectionsInput" value='${esc(JSON.stringify(s))}'>
            <div class="card" style="border-left:4px solid ${P}">
              <h3 style="margin-bottom:12px">Personal Information</h3>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
                <div><label style="font-weight:600;display:block;margin-bottom:4px">Full Name</label>
                  <input type="text" id="pName" value="${esc(s.personal?.name || '')}"></div>
                <div><label style="font-weight:600;display:block;margin-bottom:4px">Email</label>
                  <input type="email" id="pEmail" value="${esc(s.personal?.email || '')}"></div>
                <div><label style="font-weight:600;display:block;margin-bottom:4px">Phone</label>
                  <input type="tel" id="pPhone" value="${esc(s.personal?.phone || '')}"></div>
                <div><label style="font-weight:600;display:block;margin-bottom:4px">Location</label>
                  <input type="text" id="pLocation" value="${esc(s.personal?.location || '')}"></div>
                <div><label style="font-weight:600;display:block;margin-bottom:4px">LinkedIn</label>
                  <input type="url" id="pLinkedin" value="${esc(s.personal?.linkedin || '')}"></div>
                <div><label style="font-weight:600;display:block;margin-bottom:4px">Website</label>
                  <input type="url" id="pWebsite" value="${esc(s.personal?.website || '')}"></div>
              </div>
            </div>
            <div class="card" style="border-left:4px solid #059669">
              <h3 style="margin-bottom:12px">Professional Summary / Objective</h3>
              <textarea id="objText" rows="4" placeholder="Write a compelling 2-3 sentence professional summary...">${esc(s.objective || '')}</textarea>
            </div>
            <div class="card" style="border-left:4px solid #d97706" id="educationCard">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <h3>Education</h3>
                <button type="button" class="btn" onclick="addEducation()" style="background:#059669">+ Add</button>
              </div>
              <div id="educationList">
                ${(s.education || []).map((edu, i) => `
                  <div class="card" style="background:#f9fafb;margin-bottom:8px" data-eidx="${i}">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                      <input placeholder="Degree / Diploma" value="${esc(edu.degree || '')}" class="edu-degree">
                      <input placeholder="Institution" value="${esc(edu.institution || '')}" class="edu-inst">
                      <input placeholder="Graduation Year" value="${esc(edu.year || '')}" class="edu-year">
                      <input placeholder="GPA (optional)" value="${esc(edu.gpa || '')}" class="edu-gpa">
                    </div>
                    <textarea placeholder="Relevant coursework, honors..." class="edu-details" style="margin-top:8px">${esc(edu.details || '')}</textarea>
                    <button type="button" onclick="this.parentElement.remove()" style="color:#dc2626;background:none;border:none;cursor:pointer;margin-top:4px">Remove</button>
                  </div>
                `).join('')}
              </div>
            </div>
            <div class="card" style="border-left:4px solid #dc2626" id="experienceCard">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <h3>Work Experience</h3>
                <button type="button" class="btn" onclick="addExperience()" style="background:#059669">+ Add</button>
              </div>
              <div id="experienceList">
                ${(s.experience || []).map((exp, i) => `
                  <div class="card" style="background:#f9fafb;margin-bottom:8px" data-eidx="${i}">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                      <input placeholder="Job Title" value="${esc(exp.title || '')}" class="exp-title">
                      <input placeholder="Company" value="${esc(exp.company || '')}" class="exp-company">
                      <input placeholder="Start Date" value="${esc(exp.start || '')}" class="exp-start">
                      <input placeholder="End Date" value="${esc(exp.end || '')}" class="exp-end">
                    </div>
                    <textarea placeholder="Key achievements and responsibilities (use bullet points)" class="exp-desc" rows="4" style="margin-top:8px">${esc(exp.description || '')}</textarea>
                    <button type="button" onclick="this.parentElement.remove()" style="color:#dc2626;background:none;border:none;cursor:pointer;margin-top:4px">Remove</button>
                  </div>
                `).join('')}
              </div>
            </div>
            <div class="card" style="border-left:4px solid #7c3aed" id="skillsCard">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <h3>Skills</h3>
                <button type="button" class="btn" onclick="addSkill()" style="background:#059669">+ Add</button>
              </div>
              <div id="skillsList" style="display:flex;flex-wrap:wrap;gap:8px">
                ${(s.skills || []).map((sk, i) => `
                  <span style="display:flex;align-items:center;gap:4px;background:#ede9fe;padding:6px 12px;border-radius:20px">
                    <input value="${esc(sk.name || sk || '')}" class="skill-name" style="width:auto;border:none;padding:0;background:transparent">
                    <button type="button" onclick="this.parentElement.remove()" style="color:#dc2626;background:none;border:none;cursor:pointer;font-size:1.2em">&times;</button>
                  </span>
                `).join('')}
              </div>
            </div>
            <div class="card" style="border-left:4px solid #0891b2" id="projectsCard">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
                <h3>Projects</h3>
                <button type="button" class="btn" onclick="addProject()" style="background:#059669">+ Add</button>
              </div>
              <div id="projectsList">
                ${(s.projects || []).map((pr, i) => `
                  <div class="card" style="background:#f9fafb;margin-bottom:8px">
                    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
                      <input placeholder="Project Name" value="${esc(pr.name || '')}" class="proj-name">
                      <input placeholder="Technologies Used" value="${esc(pr.tech || '')}" class="proj-tech">
                      <input placeholder="Link (optional)" value="${esc(pr.link || '')}" class="proj-link">
                    </div>
                    <textarea placeholder="Brief description of the project and your role..." class="proj-desc" rows="3" style="margin-top:8px">${esc(pr.description || '')}</textarea>
                    <button type="button" onclick="this.parentElement.remove()" style="color:#dc2626;background:none;border:none;cursor:pointer;margin-top:4px">Remove</button>
                  </div>
                `).join('')}
              </div>
            </div>
            <div class="card" style="border-left:4px solid #be185d">
              <h3 style="margin-bottom:12px">Certifications & Languages</h3>
              <textarea id="certsInput" rows="3" placeholder="List certifications, one per line...">${esc((s.certifications || []).join('\n'))}</textarea>
              <label style="font-weight:600;display:block;margin-top:12px;margin-bottom:4px">Languages</label>
              <input id="langsInput" placeholder="English (Native), Spanish (Conversational)...">
            </div>
            <div style="display:flex;gap:8px;margin-top:16px">
              <button type="submit" class="btn" style="background:#059669">Save Resume</button>
              <button type="submit" name="publish" value="1" class="btn">Save & Publish</button>
              <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none">Cancel</a>
            </div>
          </form>
        </div>
        <script>
          function collectAndSubmit() {
            const sections = {
              personal: {
                name: document.getElementById('pName').value,
                email: document.getElementById('pEmail').value,
                phone: document.getElementById('pPhone').value,
                location: document.getElementById('pLocation').value,
                linkedin: document.getElementById('pLinkedin').value,
                website: document.getElementById('pWebsite').value
              },
              objective: document.getElementById('objText').value,
              education: [...document.querySelectorAll('#educationList .card')].map(c => ({
                degree: c.querySelector('.edu-degree')?.value || '',
                institution: c.querySelector('.edu-inst')?.value || '',
                year: c.querySelector('.edu-year')?.value || '',
                gpa: c.querySelector('.edu-gpa')?.value || '',
                details: c.querySelector('.edu-details')?.value || ''
              })),
              experience: [...document.querySelectorAll('#experienceList .card')].map(c => ({
                title: c.querySelector('.exp-title')?.value || '',
                company: c.querySelector('.exp-company')?.value || '',
                start: c.querySelector('.exp-start')?.value || '',
                end: c.querySelector('.exp-end')?.value || '',
                description: c.querySelector('.exp-desc')?.value || ''
              })),
              skills: [...document.querySelectorAll('.skill-name')].map(i => i.value).filter(Boolean),
              projects: [...document.querySelectorAll('#projectsList .card')].map(c => ({
                name: c.querySelector('.proj-name')?.value || '',
                tech: c.querySelector('.proj-tech')?.value || '',
                link: c.querySelector('.proj-link')?.value || '',
                description: c.querySelector('.proj-desc')?.value || ''
              })),
              certifications: document.getElementById('certsInput').value.split('\\n').filter(Boolean),
              languages: document.getElementById('langsInput').value
            };
            document.getElementById('sectionsInput').value = JSON.stringify(sections);
            return true;
          }
          document.getElementById('resumeForm').addEventListener('submit', collectAndSubmit);
          function addEducation() {
            const idx = document.querySelectorAll('#educationList .card').length;
            document.getElementById('educationList').insertAdjacentHTML('beforeend',
              '<div class="card" style="background:#f9fafb;margin-bottom:8px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><input placeholder="Degree / Diploma" class="edu-degree"><input placeholder="Institution" class="edu-inst"><input placeholder="Graduation Year" class="edu-year"><input placeholder="GPA (optional)" class="edu-gpa"></div><textarea placeholder="Relevant coursework, honors..." class="edu-details" style="margin-top:8px"></textarea><button type="button" onclick="this.parentElement.remove()" style="color:#dc2626;background:none;border:none;cursor:pointer;margin-top:4px">Remove</button></div>');
          }
          function addExperience() {
            document.getElementById('experienceList').insertAdjacentHTML('beforeend',
              '<div class="card" style="background:#f9fafb;margin-bottom:8px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><input placeholder="Job Title" class="exp-title"><input placeholder="Company" class="exp-company"><input placeholder="Start Date" class="exp-start"><input placeholder="End Date" class="exp-end"></div><textarea placeholder="Key achievements and responsibilities (use bullet points)" class="exp-desc" rows="4" style="margin-top:8px"></textarea><button type="button" onclick="this.parentElement.remove()" style="color:#dc2626;background:none;border:none;cursor:pointer;margin-top:4px">Remove</button></div>');
          }
          function addSkill() {
            document.getElementById('skillsList').insertAdjacentHTML('beforeend',
              '<span style="display:flex;align-items:center;gap:4px;background:#ede9fe;padding:6px 12px;border-radius:20px"><input placeholder="Skill name" class="skill-name" style="width:auto;border:none;padding:0;background:transparent"><button type="button" onclick="this.parentElement.remove()" style="color:#dc2626;background:none;border:none;cursor:pointer;font-size:1.2em">&times;</button></span>');
          }
          function addProject() {
            document.getElementById('projectsList').insertAdjacentHTML('beforeend',
              '<div class="card" style="background:#f9fafb;margin-bottom:8px"><div style="display:grid;grid-template-columns:1fr 1fr;gap:8px"><input placeholder="Project Name" class="proj-name"><input placeholder="Technologies Used" class="proj-tech"><input placeholder="Link (optional)" class="proj-link"></div><textarea placeholder="Brief description..." class="proj-desc" rows="3" style="margin-top:8px"></textarea><button type="button" onclick="this.parentElement.remove()" style="color:#dc2626;background:none;border:none;cursor:pointer;margin-top:4px">Remove</button></div>');
          }
        </script>
      `;
      res.send(renderPage(req, 'Edit Resume', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { sections, publish } = req.body;
      const parsed = typeof sections === 'string' ? sections : JSON.stringify(sections);
      const status = publish ? 'published' : 'draft';
      await pool.query(
        'UPDATE resumes SET sections=$1, template=$2, status=$3, updated_at=NOW() WHERE id=$4 AND tenant_id=$5 AND student_id=$6',
        [parsed, req.body.template, status, req.params.id, req.tenant.id, req.user.id]
      );
      audit(req, 'resume_updated', { resume_id: req.params.id });
      req.flash = req.flash || {};
      res.redirect(PREFIX + '/edit/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 4. Preview Resume ───
  app.get(PREFIX + '/preview/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const resume = await pool.query('SELECT * FROM resumes WHERE id=$1 AND tenant_id=$2 AND student_id=$3', [req.params.id, req.tenant.id, req.user.id]);
      if (!resume.rows.length) return res.status(404).send('Resume not found');
      const r = resume.rows[0];
      const s = typeof r.sections === 'string' ? JSON.parse(r.sections) : r.sections;
      const personal = s.personal || {};
      const body = `
        ${SKIP}
        <style>
          .resume-preview{max-width:800px;margin:0 auto;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:40px;box-shadow:0 4px 12px rgba(0,0,0,.08)}
          .resume-header{text-align:center;border-bottom:2px solid ${P};padding-bottom:20px;margin-bottom:20px}
          .resume-header h1{color:${P};font-size:1.8em;margin-bottom:4px}
          .resume-section{margin-bottom:20px}
          .resume-section h3{color:${P};border-bottom:1px solid #e5e7eb;padding-bottom:6px;margin-bottom:10px;text-transform:uppercase;font-size:.9em;letter-spacing:.5px}
          .resume-entry{margin-bottom:12px}
          .resume-entry h4{margin:0 0 2px 0;color:#111}
          .resume-entry .subtitle{color:${GRAY};font-size:.9em}
          .skill-tag{display:inline-block;background:#ede9fe;color:#4f46e5;padding:4px 12px;border-radius:20px;margin:2px 4px 2px 0;font-size:.9em}
        </style>
        <div style="margin-bottom:16px">
          <a href="${PREFIX}/edit/${r.id}" class="btn">&larr; Back to Editor</a>
          <button onclick="window.print()" class="btn" style="background:#059669;margin-left:8px">Print / PDF</button>
          <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Dashboard</a>
        </div>
        <div class="resume-preview">
          <div class="resume-header">
            <h1>${esc(personal.name || 'Your Name')}</h1>
            <div style="color:${GRAY}">
              ${personal.email ? `<span>${esc(personal.email)}</span>` : ''}
              ${personal.phone ? `<span> | ${esc(personal.phone)}</span>` : ''}
              ${personal.location ? `<span> | ${esc(personal.location)}</span>` : ''}
            </div>
            <div style="margin-top:4px">
              ${personal.linkedin ? `<span style="color:${P}">${esc(personal.linkedin)}</span>` : ''}
              ${personal.website ? `<span style="color:${P};margin-left:12px">${esc(personal.website)}</span>` : ''}
            </div>
          </div>
          ${s.objective ? `<div class="resume-section"><h3>Professional Summary</h3><p>${esc(s.objective)}</p></div>` : ''}
          ${(s.education || []).length ? `<div class="resume-section"><h3>Education</h3>
            ${s.education.map(e => `<div class="resume-entry"><h4>${esc(e.degree)}</h4><div class="subtitle">${esc(e.institution)} ${e.year ? '- ' + esc(e.year) : ''} ${e.gpa ? '| GPA: ' + esc(e.gpa) : ''}</div>${e.details ? `<p style="white-space:pre-line;margin-top:4px;font-size:.9em">${esc(e.details)}</p>` : ''}</div>`).join('')}
          </div>` : ''}
          ${(s.experience || []).length ? `<div class="resume-section"><h3>Experience</h3>
            ${s.experience.map(e => `<div class="resume-entry"><h4>${esc(e.title)}</h4><div class="subtitle">${esc(e.company)} ${e.start && e.end ? '| ' + esc(e.start) + ' - ' + esc(e.end) : ''}</div>${e.description ? `<p style="white-space:pre-line;margin-top:4px;font-size:.9em">${esc(e.description)}</p>` : ''}</div>`).join('')}
          </div>` : ''}
          ${(s.skills || []).length ? `<div class="resume-section"><h3>Skills</h3><div>${s.skills.map(sk => {
            const name = typeof sk === 'object' ? sk.name : sk;
            return `<span class="skill-tag">${esc(name)}</span>`;
          }).join('')}</div></div>` : ''}
          ${(s.projects || []).length ? `<div class="resume-section"><h3>Projects</h3>
            ${s.projects.map(p => `<div class="resume-entry"><h4>${esc(p.name)}</h4><div class="subtitle">${esc(p.tech || '')} ${p.link ? `| <a href="${esc(p.link)}" style="color:${P}">Link</a>` : ''}</div>${p.description ? `<p style="white-space:pre-line;margin-top:4px;font-size:.9em">${esc(p.description)}</p>` : ''}</div>`).join('')}
          </div>` : ''}
          ${(s.certifications || []).length ? `<div class="resume-section"><h3>Certifications</h3><ul>${s.certifications.map(c => `<li>${esc(c)}</li>`).join('')}</ul></div>` : ''}
          ${s.languages ? `<div class="resume-section"><h3>Languages</h3><p>${esc(s.languages)}</p></div>` : ''}
        </div>
      `;
      res.send(renderPage(req, 'Preview: ' + r.title, body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 5. ATS Score Check ───
  app.get(PREFIX + '/ats-check/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const resume = await pool.query('SELECT * FROM resumes WHERE id=$1 AND tenant_id=$2 AND student_id=$3', [req.params.id, req.tenant.id, req.user.id]);
      if (!resume.rows.length) return res.status(404).send('Resume not found');
      const r = resume.rows[0];
      const s = typeof r.sections === 'string' ? JSON.parse(r.sections) : r.sections;
      const personal = s.personal || {};
      const allText = [
        personal.name, personal.email, s.objective || '',
        ...(s.education || []).map(e => `${e.degree} ${e.institution} ${e.details}`),
        ...(s.experience || []).map(e => `${e.title} ${e.company} ${e.description}`),
        ...(s.skills || []).map(sk => typeof sk === 'object' ? sk.name : sk),
        ...(s.projects || []).map(p => `${p.name} ${p.description} ${p.tech}`)
      ].join(' ').toLowerCase();

      const checks = [
        { name: 'Contact Information', weight: 15, passed: !!(personal.email && personal.phone), detail: personal.email && personal.phone ? 'Email and phone present' : 'Missing email or phone' },
        { name: 'Professional Summary', weight: 15, passed: !!(s.objective && s.objective.length > 30), detail: s.objective ? `${s.objective.length} characters` : 'No summary provided' },
        { name: 'Education Section', weight: 15, passed: (s.education || []).length > 0, detail: `${(s.education || []).length} entry(ies)` },
        { name: 'Work Experience', weight: 20, passed: (s.experience || []).length > 0, detail: `${(s.experience || []).length} entry(ies)` },
        { name: 'Skills Section', weight: 15, passed: (s.skills || []).length >= 5, detail: `${(s.skills || []).length} skills listed (recommend 5+)` },
        { name: 'Quantifiable Achievements', weight: 10, passed: /\d+%|\$\d+|\d+\+|\d+ (users|clients|projects|team|people)/.test(allText), detail: 'Numbers and metrics detected' },
        { name: 'Keywords from Target Job', weight: 10, passed: allText.includes((s.target_job || '').toLowerCase()), detail: s.target_job ? `Target: "${s.target_job}"` : 'No target job set' }
      ];

      const totalScore = checks.reduce((sum, c) => sum + (c.passed ? c.weight : 0), 0);
      const maxScore = checks.reduce((sum, c) => sum + c.weight, 0);
      const pct = Math.round((totalScore / maxScore) * 100);

      await pool.query('UPDATE resumes SET ats_score=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3', [pct, req.params.id, req.tenant.id]);
      audit(req, 'ats_check', { resume_id: req.params.id, score: pct });

      const body = `
        ${SKIP}
        <style>.score-circle{width:120px;height:120px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:2em;font-weight:700;margin:0 auto 20px}</style>
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">ATS Optimization Score</h2>
          <div style="text-align:center;margin-bottom:20px">
            <div class="score-circle" style="background:${pct >= 70 ? '#dcfce7' : pct >= 40 ? '#fef3c7' : '#fee2e2'};color:${pct >= 70 ? '#059669' : pct >= 40 ? '#d97706' : '#dc2626'}">${pct}%</div>
            <p style="font-size:1.2em;font-weight:600;color:${pct >= 70 ? '#059669' : pct >= 40 ? '#d97706' : '#dc2626'}">
              ${pct >= 80 ? 'Excellent! Your resume is highly ATS-friendly' : pct >= 60 ? 'Good, but there is room for improvement' : 'Needs significant improvement for ATS systems'}
            </p>
          </div>
          <table>
            <tr><th>Check</th><th>Weight</th><th>Status</th><th>Details</th></tr>
            ${checks.map(c => `<tr>
              <td style="font-weight:600">${c.name}</td>
              <td>${c.weight}%</td>
              <td><span style="color:${c.passed ? '#059669' : '#dc2626'};font-weight:700">${c.passed ? 'PASS' : 'FAIL'}</span></td>
              <td>${c.detail}</td>
            </tr>`).join('')}
          </table>
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">Recommendations</h3>
          <ul style="line-height:2">
            ${!personal.phone ? '<li style="color:#dc2626">Add your phone number to contact information</li>' : ''}
            ${!(s.objective && s.objective.length > 30) ? '<li style="color:#dc2626">Write a professional summary of at least 30 characters</li>' : ''}
            ${(s.skills || []).length < 5 ? '<li style="color:#d97706">Add more skills (aim for at least 5-10 relevant skills)</li>' : ''}
            ${!(s.experience || []).length ? '<li style="color:#dc2626">Add work experience entries</li>' : ''}
            ${!/\d+%|\$\d+|\d+\+/.test(allText) ? '<li style="color:#d97706">Include quantifiable achievements with numbers and metrics</li>' : ''}
            ${!s.target_job ? '<li style="color:#d97706">Set a target job title to get keyword-specific recommendations</li>' : ''}
            ${pct >= 80 ? '<li style="color:#059669">Great job! Consider adding more specific achievements to push toward 100%</li>' : ''}
          </ul>
        </div>
        <div style="display:flex;gap:8px">
          <a href="${PREFIX}/edit/${r.id}" class="btn">Improve Resume</a>
          <a href="${PREFIX}/preview/${r.id}" class="btn" style="background:#7c3aed">Preview</a>
          <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none">Dashboard</a>
        </div>
      `;
      res.send(renderPage(req, 'ATS Check: ' + r.title, body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 6. Templates Library ───
  app.get(PREFIX + '/templates', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const templates = await pool.query('SELECT * FROM resume_templates WHERE tenant_id=$1 ORDER BY category, name', [req.tenant.id]);
      const categories = [...new Set(templates.rows.map(t => t.category || 'General'))];
      const body = `
        ${SKIP}
        <style>.template-card{border:2px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center;transition:border-color .2s}.template-card:hover{border-color:${P}}</style>
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Resume Templates</h2>
          <p style="color:${GRAY};margin-bottom:16px">Choose a professional template to get started</p>
        </div>
        ${categories.map(cat => `
          <h3 style="margin:16px 0 8px;color:${P}">${esc(cat)}</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px;margin-bottom:20px">
            ${templates.rows.filter(t => (t.category || 'General') === cat).map(t => `
              <div class="template-card">
                <div style="height:160px;background:linear-gradient(135deg,#eef2ff,#e0e7ff);border-radius:8px;margin-bottom:12px;display:flex;align-items:center;justify-content:center">
                  <span style="font-size:2em">&#128196;</span>
                </div>
                <h4>${esc(t.name)}</h4>
                <p style="color:${GRAY};font-size:.85em;margin:4px 0 12px">${esc(t.category || 'General')}</p>
                <a href="${PREFIX}/new?template=${encodeURIComponent(t.name)}" class="btn" style="width:100%">Use Template</a>
              </div>
            `).join('')}
          </div>
        `).join('')}
        <div style="margin-top:20px">
          <h3 style="margin-bottom:12px">Default Templates</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:16px">
            ${['modern', 'classic', 'minimal', 'creative', 'executive'].map(t => `
              <div class="template-card">
                <div style="height:160px;background:linear-gradient(135deg,${t === 'modern' ? '#eef2ff,#c7d2fe' : t === 'classic' ? '#f9fafb,#d1d5db' : t === 'minimal' ? '#fff,#f3f4f6' : t === 'creative' ? '#fef3c7,#fde68a' : '#ede9fe,#ddd6fe'});border-radius:8px;margin-bottom:12px;display:flex;align-items:center;justify-content:center">
                  <span style="font-size:2em">&#128196;</span>
                </div>
                <h4>${t.charAt(0).toUpperCase() + t.slice(1)}</h4>
                <a href="${PREFIX}/new?template=${t}" class="btn" style="width:100%;margin-top:8px">Use Template</a>
              </div>
            `).join('')}
          </div>
        </div>
      `;
      res.send(renderPage(req, 'Resume Templates', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 7. Admin: Manage Templates ───
  app.get(PREFIX + '/admin/templates', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const templates = await pool.query('SELECT * FROM resume_templates WHERE tenant_id=$1 ORDER BY name', [req.tenant.id]);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Manage Resume Templates</h2>
          <form method="POST" action="${PREFIX}/admin/templates" style="margin-bottom:20px">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
              <input type="text" name="name" placeholder="Template name" required>
              <select name="category">
                <option value="General">General</option><option value="Technology">Technology</option>
                <option value="Business">Business</option><option value="Creative">Creative</option>
                <option value="Healthcare">Healthcare</option><option value="Education">Education</option>
                <option value="Engineering">Engineering</option>
              </select>
              <button type="submit" class="btn">Add Template</button>
            </div>
            <div style="margin-top:12px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Structure (JSON)</label>
              <textarea name="structure" rows="3" placeholder='{"sections":["personal","objective","education","experience","skills","projects"],"colors":{"primary":"#4f46e5"}}'></textarea>
            </div>
          </form>
          ${templates.rows.length ? `<table><tr><th>Name</th><th>Category</th><th>Default</th><th>Actions</th></tr>
            ${templates.rows.map(t => `<tr>
              <td>${esc(t.name)}</td><td>${esc(t.category || 'General')}</td>
              <td>${t.is_default ? '<span style="color:#059669">Yes</span>' : 'No'}</td>
              <td>
                <form method="POST" action="${PREFIX}/admin/templates/delete/${t.id}" style="display:inline">
                  <button type="submit" class="btn" style="background:#dc2626;padding:4px 10px;font-size:.85em">Delete</button>
                </form>
              </td>
            </tr>`).join('')}
          </table>` : '<p style="color:${GRAY}">No custom templates yet.</p>'}
        </div>
      `;
      res.send(renderPage(req, 'Admin Templates', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/admin/templates', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { name, category, structure, preview_url } = req.body;
      const struct = typeof structure === 'string' ? structure : JSON.stringify(structure || {});
      await pool.query(
        'INSERT INTO resume_templates (tenant_id, name, category, structure, preview_url) VALUES ($1,$2,$3,$4,$5)',
        [req.tenant.id, name, category || 'General', struct, preview_url || null]
      );
      audit(req, 'template_created', { name });
      res.redirect(PREFIX + '/admin/templates');
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/admin/templates/delete/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query('DELETE FROM resume_templates WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
      audit(req, 'template_deleted', { template_id: req.params.id });
      res.redirect(PREFIX + '/admin/templates');
    } catch(e) { ah(e, req, res); }
  });

  // ─── 8. Cover Letter: New ───
  app.get(PREFIX + '/cover-letter/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const resumes = await pool.query('SELECT id, title FROM resumes WHERE tenant_id=$1 AND student_id=$2 ORDER BY updated_at DESC', [req.tenant.id, req.user.id]);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Create Cover Letter</h2>
          <form method="POST" action="${PREFIX}/cover-letter/new">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Cover Letter Title</label>
              <input type="text" name="title" placeholder="e.g., Cover Letter - Google SWE" required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Target Job Title</label>
                <input type="text" name="job_title" placeholder="e.g., Software Engineer"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Company Name</label>
                <input type="text" name="company" placeholder="e.g., Google"></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Based on Resume (optional)</label>
              <select name="resume_id">
                <option value="">-- Select a resume --</option>
                ${resumes.rows.map(r => `<option value="${r.id}">${esc(r.title)}</option>`).join('')}
              </select>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Cover Letter Content</label>
              <textarea name="content" rows="12" placeholder="Write your cover letter here, or leave blank to generate one based on your resume..."></textarea>
            </div>
            <div style="display:flex;gap:8px">
              <button type="submit" name="action" value="save" class="btn">Save Draft</button>
              <button type="submit" name="action" value="generate" class="btn" style="background:#7c3aed">AI Generate</button>
              <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none">Cancel</a>
            </div>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'New Cover Letter', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/cover-letter/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      let { title, job_title, company, content, resume_id, action } = req.body;
      if (action === 'generate' && !content && resume_id) {
        const resume = await pool.query('SELECT * FROM resumes WHERE id=$1 AND tenant_id=$2 AND student_id=$3', [resume_id, req.tenant.id, req.user.id]);
        if (resume.rows.length) {
          const s = typeof resume.rows[0].sections === 'string' ? JSON.parse(resume.rows[0].sections) : resume.rows[0].sections;
          const personal = s.personal || {};
          const expText = (s.experience || []).map(e => `${e.title} at ${e.company}`).join(', ');
          const skillText = (s.skills || []).map(sk => typeof sk === 'object' ? sk.name : sk).join(', ');
          content = `Dear Hiring Manager,\n\nI am writing to express my interest in the ${job_title || 'open position'} at ${company || 'your company'}. With my background in ${skillText || 'relevant skills'} and experience ${expText ? 'including ' + expText : 'in the field'}, I am confident I would be a valuable addition to your team.\n\nThroughout my career, I have developed strong skills in ${skillText || 'my field'}. ${expText ? 'My previous roles have given me hands-on experience with ' + expText + '.' : ''} I am particularly drawn to ${company || 'your organization'} because of its reputation for excellence and innovation.\n\nI would welcome the opportunity to discuss how my background, skills, and enthusiasms align with the needs of your team. Thank you for considering my application.\n\nSincerely,\n${personal.name || 'Your Name'}\n${personal.email || ''}\n${personal.phone || ''}`;
        }
      }
      const result = await pool.query(
        'INSERT INTO cover_letters (tenant_id, student_id, title, content, job_title, company) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
        [req.tenant.id, req.user.id, title, content || '', job_title, company]
      );
      audit(req, 'cover_letter_created', { cover_letter_id: result.rows[0].id, title });
      res.redirect(PREFIX + '/cover-letter/edit/' + result.rows[0].id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 9. Cover Letter: Edit ───
  app.get(PREFIX + '/cover-letter/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const letter = await pool.query('SELECT * FROM cover_letters WHERE id=$1 AND tenant_id=$2 AND student_id=$3', [req.params.id, req.tenant.id, req.user.id]);
      if (!letter.rows.length) return res.status(404).send('Cover letter not found');
      const l = letter.rows[0];
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Edit Cover Letter: ${esc(l.title)}</h2>
          <form method="POST" action="${PREFIX}/cover-letter/edit/${l.id}">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Title</label>
              <input type="text" name="title" value="${esc(l.title)}" required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Job Title</label>
                <input type="text" name="job_title" value="${esc(l.job_title || '')}"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Company</label>
                <input type="text" name="company" value="${esc(l.company || '')}"></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Content</label>
              <textarea name="content" rows="16">${esc(l.content || '')}</textarea>
            </div>
            <div style="display:flex;gap:8px">
              <button type="submit" class="btn">Save Changes</button>
              <button type="submit" name="action" value="generate" class="btn" style="background:#7c3aed">Regenerate with AI</button>
              <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none">Cancel</a>
            </div>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Edit Cover Letter', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/cover-letter/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query(
        'UPDATE cover_letters SET title=$1, content=$2, job_title=$3, company=$4 WHERE id=$5 AND tenant_id=$6 AND student_id=$7',
        [req.body.title, req.body.content, req.body.job_title, req.body.company, req.params.id, req.tenant.id, req.user.id]
      );
      audit(req, 'cover_letter_updated', { cover_letter_id: req.params.id });
      res.redirect(PREFIX + '/cover-letter/edit/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 10. Interview Tips ───
  app.get(PREFIX + '/interview-tips', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const resumes = await pool.query('SELECT id, title, ats_score, sections FROM resumes WHERE tenant_id=$1 AND student_id=$2 ORDER BY updated_at DESC LIMIT 3', [req.tenant.id, req.user.id]);
      const skills = [];
      resumes.rows.forEach(r => {
        const s = typeof r.sections === 'string' ? JSON.parse(r.sections) : r.sections;
        (s.skills || []).forEach(sk => { const n = typeof sk === 'object' ? sk.name : sk; if (n && !skills.includes(n)) skills.push(n); });
      });
      const tips = [
        { category: 'Preparation', icon: '&#128221;', items: [
          'Research the company thoroughly - mission, values, recent news, and culture',
          'Review the job description and match your skills to each requirement',
          'Prepare your STAR stories (Situation, Task, Action, Result)',
          'Practice answering common behavioral questions aloud',
          'Prepare 3-5 thoughtful questions to ask the interviewer'
        ]},
        { category: 'Technical', icon: '&#128187;', items: [
          skills.length ? `Brush up on your core skills: ${skills.slice(0, 5).join(', ')}` : 'Review core technical skills relevant to your field',
          'Practice coding problems or technical scenarios on a whiteboard',
          'Be ready to explain your thought process, not just the answer',
          'Understand common design patterns and best practices in your field'
        ]},
        { category: 'Behavioral', icon: '&#129309;', items: [
          'Use the STAR method: Situation, Task, Action, Result',
          'Quantify your achievements with specific numbers and metrics',
          'Show enthusiasm and genuine interest in the role',
          'Demonstrate teamwork and leadership through specific examples',
          'Be honest about what you do not know, but show willingness to learn'
        ]},
        { category: 'Follow-up', icon: '&#128233;', items: [
          'Send a thank-you email within 24 hours of the interview',
          'Reference specific topics discussed during the interview',
          'Reiterate your interest and fit for the role',
          'If you do not hear back within the stated timeframe, follow up professionally',
          'Ask for feedback regardless of the outcome to improve'
        ]}
      ];

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:4px">Interview Preparation Guide</h2>
          <p style="color:${GRAY}">Personalized tips based on your profile and resume</p>
        </div>
        ${skills.length ? `<div class="card" style="border-left:4px solid ${P}">
          <h3 style="margin-bottom:8px">Your Key Skills for Interviews</h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${skills.map(s => `<span style="background:#ede9fe;color:#4f46e5;padding:4px 12px;border-radius:20px;font-size:.9em">${esc(s)}</span>`).join('')}
          </div>
        </div>` : ''}
        ${tips.map(t => `
          <div class="card" style="border-left:4px solid ${P}">
            <h3 style="margin-bottom:12px">${t.icon} ${t.category}</h3>
            <ol style="line-height:2;padding-left:20px">
              ${t.items.map(item => `<li>${item}</li>`).join('')}
            </ol>
          </div>
        `).join('')}
        <div class="card" style="background:#f0fdf4;border-left:4px solid #059669">
          <h3 style="color:#059669;margin-bottom:8px">Common Interview Questions to Practice</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            ${['Tell me about yourself.', 'Why do you want to work here?', 'What are your greatest strengths?', 'What is your biggest weakness?',
              'Describe a challenging situation and how you handled it.', 'Where do you see yourself in 5 years?', 'Why should we hire you?',
              'Tell me about a time you worked in a team.', 'Describe a time you failed and what you learned.', 'What are your salary expectations?'
            ].map(q => `<div style="padding:8px;background:#fff;border-radius:8px;border:1px solid #bbf7d0">&#8226; ${q}</div>`).join('')}
          </div>
        </div>
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:16px">&larr; Back to Dashboard</a>
      `;
      res.send(renderPage(req, 'Interview Tips', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 11. Resume Versions (Duplicate) ───
  app.post(PREFIX + '/duplicate/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const original = await pool.query('SELECT * FROM resumes WHERE id=$1 AND tenant_id=$2 AND student_id=$3', [req.params.id, req.tenant.id, req.user.id]);
      if (!original.rows.length) return res.status(404).send('Resume not found');
      const o = original.rows[0];
      const result = await pool.query(
        'INSERT INTO resumes (tenant_id, student_id, title, sections, template, ats_score, status) VALUES ($1,$2,$3,$4,$5,0,$6) RETURNING id',
        [req.tenant.id, req.user.id, o.title + ' (Copy)', o.sections, o.template, 'draft']
      );
      audit(req, 'resume_duplicated', { from: o.id, to: result.rows[0].id });
      res.redirect(PREFIX + '/edit/' + result.rows[0].id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 12. Delete Resume ───
  app.post(PREFIX + '/delete/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query('DELETE FROM resumes WHERE id=$1 AND tenant_id=$2 AND student_id=$3', [req.params.id, req.tenant.id, req.user.id]);
      audit(req, 'resume_deleted', { resume_id: req.params.id });
      res.redirect(PREFIX);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 13. Admin: All Resumes ───
  app.get(PREFIX + '/admin/all', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const resumes = await pool.query(
        `SELECT r.*, s.name as student_name FROM resumes r
         LEFT JOIN students s ON s.id = r.student_id
         WHERE r.tenant_id=$1 ORDER BY r.updated_at DESC LIMIT 50`, [req.tenant.id]);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">All Student Resumes</h2>
          <p style="color:${GRAY};margin-bottom:16px">Total: ${resumes.rows.length} resumes</p>
          ${resumes.rows.length ? `<table>
            <tr><th>Student</th><th>Title</th><th>Template</th><th>ATS Score</th><th>Status</th><th>Updated</th></tr>
            ${resumes.rows.map(r => `<tr>
              <td>${esc(r.student_name || 'Unknown')}</td><td>${esc(r.title)}</td>
              <td>${esc(r.template)}</td>
              <td style="font-weight:700;color:${r.ats_score >= 70 ? '#059669' : r.ats_score >= 40 ? '#d97706' : '#dc2626'}">${r.ats_score}%</td>
              <td>${r.status}</td><td>${r.updated_at.toLocaleDateString()}</td>
            </tr>`).join('')}
          </table>` : '<p style="color:${GRAY}">No resumes found.</p>'}
        </div>
      `;
      res.send(renderPage(req, 'Admin - All Resumes', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 14. Resume Review Request ───
  app.post(PREFIX + '/request-review/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const resume = await pool.query('SELECT * FROM resumes WHERE id=$1 AND tenant_id=$2 AND student_id=$3', [req.params.id, req.tenant.id, req.user.id]);
      if (!resume.rows.length) return res.status(404).send('Resume not found');
      await pool.query('UPDATE resumes SET status=$1 WHERE id=$2 AND tenant_id=$3', ['review_pending', req.params.id, req.tenant.id]);
      audit(req, 'resume_review_requested', { resume_id: req.params.id });
      res.redirect(PREFIX + '/edit/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 15. Admin: Review Resume ───
  app.get(PREFIX + '/admin/review/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const resume = await pool.query(
        `SELECT r.*, s.name as student_name, s.email as student_email FROM resumes r
         LEFT JOIN students s ON s.id = r.student_id
         WHERE r.id=$1 AND r.tenant_id=$2`, [req.params.id, req.tenant.id]);
      if (!resume.rows.length) return res.status(404).send('Resume not found');
      const r = resume.rows[0];
      const s = typeof r.sections === 'string' ? JSON.parse(r.sections) : r.sections;
      const existing = await pool.query('SELECT * FROM resume_reviews WHERE resume_id=$1 AND tenant_id=$2 ORDER BY reviewed_at DESC', [r.id, req.tenant.id]);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:4px">Review Resume: ${esc(r.title)}</h2>
          <p style="color:${GRAY}">Student: ${esc(r.student_name || 'Unknown')} | ATS Score: ${r.ats_score}%</p>
        </div>
        <form method="POST" action="${PREFIX}/admin/review/${r.id}">
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Score (0-100)</label>
            <input type="number" name="score" min="0" max="100" value="${r.ats_score}" required>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Feedback</label>
            <textarea name="feedback" rows="8" placeholder="Provide detailed feedback on the resume...">${esc(s.objective || '')}</textarea>
          </div>
          <button type="submit" class="btn">Submit Review</button>
        </form>
        ${existing.rows.length ? `<div class="card" style="margin-top:16px">
          <h3 style="margin-bottom:12px">Previous Reviews</h3>
          ${existing.rows.map(rev => `<div class="card" style="background:#f9fafb">
            <div style="display:flex;justify-content:space-between">
              <strong>Score: ${rev.score}%</strong>
              <span style="color:${GRAY}">${rev.reviewed_at.toLocaleDateString()}</span>
            </div>
            <p style="margin-top:8px;white-space:pre-line">${esc(rev.feedback || '')}</p>
          </div>`).join('')}
        </div>` : ''}
      `;
      res.send(renderPage(req, 'Review Resume', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/admin/review/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { score, feedback } = req.body;
      await pool.query(
        'INSERT INTO resume_reviews (tenant_id, resume_id, reviewer_id, feedback, score) VALUES ($1,$2,$3,$4,$5)',
        [req.tenant.id, req.params.id, req.user.id, feedback, score]
      );
      await pool.query('UPDATE resumes SET ats_score=$1, status=$2 WHERE id=$3 AND tenant_id=$4', [score, 'reviewed', req.params.id, req.tenant.id]);
      audit(req, 'resume_review_submitted', { resume_id: req.params.id, score });
      const resume = await pool.query('SELECT r.*, s.email FROM resumes r LEFT JOIN students s ON s.id=r.student_id WHERE r.id=$1 AND r.tenant_id=$2', [req.params.id, req.tenant.id]);
      if (resume.rows.length && resume.rows[0].email) {
        queueEmail(resume.rows[0].email, 'Resume Review Complete', `Your resume "${resume.rows[0].title}" has been reviewed. Score: ${score}%. Please check the portal for detailed feedback.`);
      }
      res.redirect(PREFIX + '/admin/all');
    } catch(e) { ah(e, req, res); }
  });
};
