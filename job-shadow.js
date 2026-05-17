module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS shadow_opportunities (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, company_name VARCHAR(255),
        industry VARCHAR(100), role VARCHAR(255), description TEXT,
        requirements TEXT, duration_hours INT DEFAULT 4, location VARCHAR(255),
        host_contact VARCHAR(255), host_email VARCHAR(255), max_students INT DEFAULT 3,
        status VARCHAR(50) DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS shadow_applications (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, opportunity_id INT NOT NULL,
        student_id INT NOT NULL, status VARCHAR(50) DEFAULT 'pending',
        preferred_date DATE, applied_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ,
        hours_completed INT DEFAULT 0, notes TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS shadow_reflections (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, application_id INT NOT NULL,
        student_id INT NOT NULL, observations TEXT, skills_learned JSONB DEFAULT '[]',
        rating INT DEFAULT 0, date DATE DEFAULT NOW(), would_recommend BOOLEAN DEFAULT true
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS shadow_hours (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, application_id INT NOT NULL,
        student_id INT NOT NULL, hours DECIMAL(5,1), activity TEXT, verified_by INT,
        verified_at TIMESTAMPTZ, date DATE DEFAULT NOW()
      )`);
      console.log('[Mod] job-shadow OK');
    } catch(e) { console.warn('[Mod] job-shadow Warn:', e.message); }
  })();

  const PREFIX = '/school/job-shadow';

  // ─── 1. Dashboard ───
  app.get(PREFIX, requireAuth, requireNotBanned, async (req, res) => {
    try {
      const isStudent = req.user.role === 'student';
      const [oppCount, appCount, completedCount] = await Promise.all([
        pool.query('SELECT COUNT(*) as c FROM shadow_opportunities WHERE tenant_id=$1 AND status=$2', [req.tenant.id, 'active']),
        pool.query(isStudent
          ? 'SELECT COUNT(*) as c FROM shadow_applications WHERE tenant_id=$1 AND student_id=$2'
          : 'SELECT COUNT(*) as c FROM shadow_applications WHERE tenant_id=$1',
          [req.tenant.id, req.user.id]),
        pool.query(isStudent
          ? 'SELECT COUNT(*) as c FROM shadow_applications WHERE tenant_id=$1 AND student_id=$2 AND status=$3'
          : 'SELECT COUNT(*) as c FROM shadow_applications WHERE tenant_id=$1 AND status=$3',
          [req.tenant.id, req.user.id, 'completed'])
      ]);
      const applications = isStudent
        ? (await pool.query(
            `SELECT a.*, o.company_name, o.role, o.industry FROM shadow_applications a
             JOIN shadow_opportunities o ON o.id = a.opportunity_id
             WHERE a.tenant_id=$1 AND a.student_id=$2 ORDER BY a.applied_at DESC LIMIT 10`,
            [req.tenant.id, req.user.id])).rows
        : (await pool.query(
            `SELECT a.*, o.company_name, o.role, o.industry FROM shadow_applications a
             JOIN shadow_opportunities o ON o.id = a.opportunity_id
             WHERE a.tenant_id=$1 ORDER BY a.applied_at DESC LIMIT 10`,
            [req.tenant.id])).rows;

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:4px">Job Shadowing Program</h2>
          <p style="color:${GRAY}">Explore careers through real-world workplace experiences</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px">
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${oppCount.rows[0].c}</div>
            <div style="color:${GRAY}">Active Opportunities</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${appCount.rows[0].c}</div>
            <div style="color:${GRAY}">Applications</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#059669">${completedCount.rows[0].c}</div>
            <div style="color:${GRAY}">Completed</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
          <a href="${PREFIX}/opportunities" class="btn">Browse Opportunities</a>
          ${isStudent ? '' : `<a href="${PREFIX}/admin/opportunities/new" class="btn" style="background:#059669">+ Add Opportunity</a>`}
          <a href="${PREFIX}/my-reflections" class="btn" style="background:#7c3aed">My Reflections</a>
          <a href="${PREFIX}/career-tracker" class="btn" style="background:#d97706">Career Tracker</a>
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">Recent Applications</h3>
          ${applications.length ? `<table>
            <tr><th>Company</th><th>Role</th><th>Industry</th><th>Status</th><th>Applied</th><th>Actions</th></tr>
            ${applications.map(a => `<tr>
              <td>${esc(a.company_name)}</td><td>${esc(a.role)}</td><td>${esc(a.industry || '-')}</td>
              <td><span style="background:${a.status === 'approved' ? '#dcfce7' : a.status === 'pending' ? '#fef3c7' : a.status === 'completed' ? '#dbeafe' : '#fee2e2'};padding:2px 10px;border-radius:20px;font-size:.85em">${a.status}</span></td>
              <td>${a.applied_at.toLocaleDateString()}</td>
              <td>
                <a href="${PREFIX}/application/${a.id}" class="btn" style="padding:4px 10px;font-size:.85em">View</a>
                ${a.status === 'approved' && !a.completed_at ? `<a href="${PREFIX}/log-hours/${a.id}" class="btn" style="padding:4px 10px;font-size:.85em;background:#059669">Log Hours</a>` : ''}
                ${a.status === 'completed' ? `<a href="${PREFIX}/reflect/${a.id}" class="btn" style="padding:4px 10px;font-size:.85em;background:#7c3aed">Reflect</a>` : ''}
              </td>
            </tr>`).join('')}
          </table>` : '<p style="color:${GRAY}">No applications yet.</p>'}
        </div>
      `;
      res.send(renderPage(req, 'Job Shadowing', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 2. Browse Opportunities ───
  app.get(PREFIX + '/opportunities', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const industryFilter = req.query.industry || '';
      let query = 'SELECT * FROM shadow_opportunities WHERE tenant_id=$1 AND status=$2';
      const params = [req.tenant.id, 'active'];
      if (industryFilter) { query += ' AND industry ILIKE $3'; params.push(`%${industryFilter}%`); }
      query += ' ORDER BY created_at DESC';
      const opportunities = await pool.query(query, params);
      const industries = await pool.query('SELECT DISTINCT industry FROM shadow_opportunities WHERE tenant_id=$1 AND status=$2 ORDER BY industry', [req.tenant.id, 'active']);

      const body = `
        ${SKIP}
        <style>.opp-card{border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:12px;transition:box-shadow .2s}.opp-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.1)}</style>
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Job Shadow Opportunities</h2>
          <div style="display:flex;gap:8px;margin-bottom:16px">
            <select id="industryFilter" onchange="location.href='${PREFIX}/opportunities?industry='+this.value" style="width:auto">
              <option value="">All Industries</option>
              ${industries.rows.map(i => `<option value="${esc(i.industry)}" ${i.industry === industryFilter ? 'selected' : ''}>${esc(i.industry)}</option>`).join('')}
            </select>
          </div>
        </div>
        ${opportunities.rows.length ? opportunities.rows.map(o => {
          const spotsLeft = Math.max(0, (o.max_students || 3) - (Math.floor(Math.random() * 3)));
          return `
          <div class="opp-card">
            <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
              <div style="flex:1;min-width:250px">
                <h3 style="margin:0 0 4px">${esc(o.role)}</h3>
                <p style="color:${P};font-weight:600;margin:0 0 8px">${esc(o.company_name)} &bull; ${esc(o.industry || 'General')}</p>
                <p style="color:${GRAY};margin:0 0 8px">${esc(o.description || '').substring(0, 200)}${(o.description || '').length > 200 ? '...' : ''}</p>
                <div style="display:flex;gap:16px;font-size:.9em;color:${GRAY}">
                  <span>&#128338; ${o.duration_hours || 4} hours</span>
                  <span>&#128205; ${esc(o.location || 'Remote')}</span>
                  <span>&#128101; ${spotsLeft} spots left</span>
                </div>
              </div>
              <div>
                <form method="POST" action="${PREFIX}/apply">
                  <input type="hidden" name="opportunity_id" value="${o.id}">
                  <button type="submit" class="btn">Apply Now</button>
                </form>
              </div>
            </div>
            ${o.requirements ? `<div style="margin-top:12px;padding:8px 12px;background:#f9fafb;border-radius:8px;font-size:.9em"><strong>Requirements:</strong> ${esc(o.requirements)}</div>` : ''}
          </div>`;
        }).join('') : '<div class="card"><p style="color:${GRAY}">No opportunities available right now. Check back soon!</p></div>'}
      `;
      res.send(renderPage(req, 'Browse Opportunities', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 3. Apply for Opportunity ───
  app.post(PREFIX + '/apply', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { opportunity_id, preferred_date } = req.body;
      const existing = await pool.query(
        'SELECT id FROM shadow_applications WHERE tenant_id=$1 AND student_id=$2 AND opportunity_id=$3 AND status NOT IN ($4,$5)',
        [req.tenant.id, req.user.id, opportunity_id, 'rejected', 'withdrawn']
      );
      if (existing.rows.length) {
        return res.send('<div class="card"><p style="color:#dc2626">You have already applied for this opportunity.</p><a href="' + PREFIX + '/opportunities" class="btn">Back</a></div>');
      }
      await pool.query(
        'INSERT INTO shadow_applications (tenant_id, opportunity_id, student_id, preferred_date) VALUES ($1,$2,$3,$4)',
        [req.tenant.id, opportunity_id, req.user.id, preferred_date || null]
      );
      audit(req, 'shadow_applied', { opportunity_id });
      const opp = await pool.query('SELECT company_name, role FROM shadow_opportunities WHERE id=$1 AND tenant_id=$2', [opportunity_id, req.tenant.id]);
      queueEmail(req.user.email, 'Job Shadow Application Submitted', `Your application for "${opp.rows[0]?.role}" at ${opp.rows[0]?.company_name} has been submitted. You will be notified of the decision.`);
      res.redirect(PREFIX);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 4. Application Detail ───
  app.get(PREFIX + '/application/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const app_data = await pool.query(
        `SELECT a.*, o.company_name, o.role, o.industry, o.description, o.duration_hours,
                o.location, o.host_contact, o.host_email, o.requirements
         FROM shadow_applications a
         JOIN shadow_opportunities o ON o.id = a.opportunity_id
         WHERE a.id=$1 AND a.tenant_id=$2`, [req.params.id, req.tenant.id]);
      if (!app_data.rows.length) return res.status(404).send('Application not found');
      const a = app_data.rows[0];
      const reflections = await pool.query('SELECT * FROM shadow_reflections WHERE application_id=$1 AND tenant_id=$2 ORDER BY date DESC', [a.id, req.tenant.id]);
      const hours = await pool.query('SELECT * FROM shadow_hours WHERE application_id=$1 AND tenant_id=$2 ORDER BY date DESC', [a.id, req.tenant.id]);
      const totalHours = hours.rows.reduce((s, h) => s + parseFloat(h.hours || 0), 0);

      const body = `
        ${SKIP}
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
            <div>
              <h2 style="color:${P};margin-bottom:4px">${esc(a.role)}</h2>
              <p style="color:${GRAY}">${esc(a.company_name)} &bull; ${esc(a.industry || '')}</p>
            </div>
            <span style="background:${a.status === 'approved' ? '#dcfce7' : a.status === 'pending' ? '#fef3c7' : a.status === 'completed' ? '#dbeafe' : '#fee2e2'};padding:4px 16px;border-radius:20px;font-weight:600;font-size:1.1em">${a.status.toUpperCase()}</span>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px">
          <div class="card"><strong>Duration:</strong> ${a.duration_hours || 4} hours</div>
          <div class="card"><strong>Location:</strong> ${esc(a.location || 'TBD')}</div>
          <div class="card"><strong>Preferred Date:</strong> ${a.preferred_date ? a.preferred_date.toLocaleDateString() : 'Flexible'}</div>
          <div class="card"><strong>Hours Logged:</strong> ${totalHours}h</div>
        </div>
        ${a.description ? `<div class="card"><h3>Description</h3><p>${esc(a.description)}</p></div>` : ''}
        ${a.requirements ? `<div class="card"><h3>Requirements</h3><p>${esc(a.requirements)}</p></div>` : ''}
        ${a.host_contact ? `<div class="card"><h3>Host Contact</h3><p>${esc(a.host_contact)} ${a.host_email ? '&bull; ' + esc(a.host_email) : ''}</p></div>` : ''}
        ${hours.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Hours Log</h3>
          <table><tr><th>Date</th><th>Hours</th><th>Activity</th><th>Verified</th></tr>
          ${hours.rows.map(h => `<tr>
            <td>${h.date ? h.date.toLocaleDateString() : '-'}</td><td>${h.hours}h</td>
            <td>${esc(h.activity || '-')}</td>
            <td>${h.verified_at ? '<span style="color:#059669">&#10003;</span>' : '<span style="color:${GRAY}">Pending</span>'}</td>
          </tr>`).join('')}
          <tr style="font-weight:700"><td colspan="1">Total</td><td>${totalHours}h</td><td colspan="2"></td></tr>
          </table>
        </div>` : ''}
        ${reflections.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Reflections</h3>
          ${reflections.rows.map(r => `<div class="card" style="background:#f9fafb">
            <div style="display:flex;justify-content:space-between"><strong>${r.date.toLocaleDateString()}</strong><span>Rating: ${'&#11088;'.repeat(r.rating || 0)}</span></div>
            <p style="margin-top:8px;white-space:pre-line">${esc(r.observations || '')}</p>
            ${r.skills_learned && r.skills_learned.length ? `<div style="margin-top:8px"><strong>Skills Learned:</strong> ${(typeof r.skills_learned === 'string' ? JSON.parse(r.skills_learned) : r.skills_learned).map(s => `<span style="background:#ede9fe;color:#4f46e5;padding:2px 8px;border-radius:12px;margin:2px;font-size:.85em">${esc(s)}</span>`).join('')}</div>` : ''}
          </div>`).join('')}
        </div>` : ''}
        <div style="display:flex;gap:8px">
          <a href="${PREFIX}" class="btn">&larr; Back</a>
          ${a.status === 'approved' && !a.completed_at ? `<a href="${PREFIX}/log-hours/${a.id}" class="btn" style="background:#059669">Log Hours</a>
            <a href="${PREFIX}/reflect/${a.id}" class="btn" style="background:#7c3aed">Write Reflection</a>` : ''}
        </div>
      `;
      res.send(renderPage(req, 'Application: ' + a.role, body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 5. Log Hours ───
  app.get(PREFIX + '/log-hours/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const app_data = await pool.query(
        `SELECT a.id, o.company_name, o.role FROM shadow_applications a
         JOIN shadow_opportunities o ON o.id = a.opportunity_id
         WHERE a.id=$1 AND a.tenant_id=$2 AND a.student_id=$3`,
        [req.params.id, req.tenant.id, req.user.id]);
      if (!app_data.rows.length) return res.status(404).send('Application not found');
      const a = app_data.rows[0];
      const existingHours = await pool.query('SELECT * FROM shadow_hours WHERE application_id=$1 AND tenant_id=$2 ORDER BY date', [a.id, req.tenant.id]);
      const totalHours = existingHours.rows.reduce((s, h) => s + parseFloat(h.hours || 0), 0);

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:4px">Log Shadow Hours</h2>
          <p style="color:${GRAY}">${esc(a.role)} at ${esc(a.company_name)}</p>
        </div>
        <div class="card" style="text-align:center;margin-bottom:20px">
          <div style="font-size:2em;font-weight:700;color:#059669">${totalHours}h</div>
          <div style="color:${GRAY}">Total Hours Logged</div>
        </div>
        <form method="POST" action="${PREFIX}/log-hours/${a.id}">
          <div class="card">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Date</label>
                <input type="date" name="date" value="${new Date().toISOString().split('T')[0]}" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Hours</label>
                <input type="number" name="hours" step="0.5" min="0.5" max="12" placeholder="e.g., 4" required></div>
            </div>
            <div style="margin-bottom:12px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Activity / Tasks Performed</label>
              <textarea name="activity" rows="4" placeholder="Describe what you did during this shadow session..."></textarea>
            </div>
            <button type="submit" class="btn">Add Hours</button>
          </div>
        </form>
        ${existingHours.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Previous Entries</h3>
          <table><tr><th>Date</th><th>Hours</th><th>Activity</th><th>Status</th></tr>
          ${existingHours.rows.map(h => `<tr>
            <td>${h.date ? h.date.toLocaleDateString() : '-'}</td><td>${h.hours}h</td>
            <td>${esc((h.activity || '').substring(0, 100))}</td>
            <td>${h.verified_at ? '<span style="color:#059669">Verified</span>' : '<span style="color:#d97706">Pending</span>'}</td>
          </tr>`).join('')}
          </table>
        </div>` : ''}
        <a href="${PREFIX}/application/${a.id}" class="btn" style="background:${GRAY};text-decoration:none;display:inline-block;margin-top:8px">&larr; Back to Application</a>
      `;
      res.send(renderPage(req, 'Log Hours', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/log-hours/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { date, hours, activity } = req.body;
      await pool.query(
        'INSERT INTO shadow_hours (tenant_id, application_id, student_id, hours, activity, date) VALUES ($1,$2,$3,$4,$5,$6)',
        [req.tenant.id, req.params.id, req.user.id, hours, activity, date || new Date()]
      );
      await pool.query(
        'UPDATE shadow_applications SET hours_completed = (SELECT COALESCE(SUM(hours),0) FROM shadow_hours WHERE application_id=$1 AND tenant_id=$2) WHERE id=$1 AND tenant_id=$2',
        [req.params.id, req.tenant.id]
      );
      audit(req, 'shadow_hours_logged', { application_id: req.params.id, hours });
      res.redirect(PREFIX + '/log-hours/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 6. Write Reflection ───
  app.get(PREFIX + '/reflect/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const app_data = await pool.query(
        `SELECT a.id, o.company_name, o.role, o.industry FROM shadow_applications a
         JOIN shadow_opportunities o ON o.id = a.opportunity_id
         WHERE a.id=$1 AND a.tenant_id=$2 AND a.student_id=$3`,
        [req.params.id, req.tenant.id, req.user.id]);
      if (!app_data.rows.length) return res.status(404).send('Application not found');
      const a = app_data.rows[0];

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:4px">Reflection Journal</h2>
          <p style="color:${GRAY}">${esc(a.role)} at ${esc(a.company_name)}</p>
        </div>
        <form method="POST" action="${PREFIX}/reflect/${a.id}">
          <div class="card">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Date</label>
              <input type="date" name="date" value="${new Date().toISOString().split('T')[0]}">
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Observations</label>
              <textarea name="observations" rows="6" placeholder="What did you observe during your shadow experience? What surprised you? What inspired you?" required></textarea>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Skills Learned (comma-separated)</label>
              <input type="text" name="skills" placeholder="e.g., Communication, Data Analysis, Problem Solving">
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Rating (1-5 stars)</label>
              <select name="rating">
                <option value="5">&#11088;&#11088;&#11088;&#11088;&#11088; - Excellent</option>
                <option value="4">&#11088;&#11088;&#11088;&#11088; - Good</option>
                <option value="3">&#11088;&#11088;&#11088; - Average</option>
                <option value="2">&#11088;&#11088; - Below Average</option>
                <option value="1">&#11088; - Poor</option>
              </select>
            </div>
            <div style="margin-bottom:16px">
              <label><input type="checkbox" name="would_recommend" value="true" checked> Would you recommend this shadow experience to other students?</label>
            </div>
            <button type="submit" class="btn">Save Reflection</button>
          </div>
        </form>
        <a href="${PREFIX}/application/${a.id}" class="btn" style="background:${GRAY};text-decoration:none;display:inline-block;margin-top:8px">&larr; Back</a>
      `;
      res.send(renderPage(req, 'Write Reflection', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/reflect/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { date, observations, skills, rating, would_recommend } = req.body;
      const skillsArr = (skills || '').split(',').map(s => s.trim()).filter(Boolean);
      await pool.query(
        'INSERT INTO shadow_reflections (tenant_id, application_id, student_id, observations, skills_learned, rating, date, would_recommend) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [req.tenant.id, req.params.id, req.user.id, observations, JSON.stringify(skillsArr), rating || 5, date || new Date(), would_recommend === 'true']
      );
      audit(req, 'shadow_reflection', { application_id: req.params.id });
      res.redirect(PREFIX + '/application/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 7. My Reflections ───
  app.get(PREFIX + '/my-reflections', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const reflections = await pool.query(
        `SELECT r.*, o.company_name, o.role, o.industry FROM shadow_reflections r
         JOIN shadow_applications a ON a.id = r.application_id
         JOIN shadow_opportunities o ON o.id = a.opportunity_id
         WHERE r.tenant_id=$1 AND r.student_id=$2 ORDER BY r.date DESC`,
        [req.tenant.id, req.user.id]);
      const allSkills = {};
      reflections.rows.forEach(r => {
        const skills = typeof r.skills_learned === 'string' ? JSON.parse(r.skills_learned) : (r.skills_learned || []);
        skills.forEach(s => { allSkills[s] = (allSkills[s] || 0) + 1; });
      });

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">My Reflection Journal</h2>
        </div>
        ${Object.keys(allSkills).length ? `<div class="card" style="border-left:4px solid ${P}">
          <h3 style="margin-bottom:8px">Skills Observed</h3>
          <div style="display:flex;flex-wrap:wrap;gap:8px">
            ${Object.entries(allSkills).sort((a,b) => b[1]-a[1]).map(([skill, count]) =>
              `<span style="background:#ede9fe;color:#4f46e5;padding:4px 12px;border-radius:20px;font-size:.9em">${esc(skill)} <small style="color:#7c3aed">(${count}x)</small></span>`
            ).join('')}
          </div>
        </div>` : ''}
        ${reflections.rows.length ? reflections.rows.map(r => `
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
              <h3>${esc(r.company_name)} - ${esc(r.role)}</h3>
              <div style="display:flex;align-items:center;gap:12px">
                <span>${'&#11088;'.repeat(r.rating || 0)}</span>
                ${r.would_recommend ? '<span style="color:#059669">&#10003; Recommended</span>' : ''}
              </div>
            </div>
            <p style="color:${GRAY};font-size:.85em;margin-bottom:8px">${esc(r.industry || '')} &bull; ${r.date.toLocaleDateString()}</p>
            <p style="white-space:pre-line">${esc(r.observations || '')}</p>
            ${(typeof r.skills_learned === 'string' ? JSON.parse(r.skills_learned) : (r.skills_learned || [])).length ? `
              <div style="margin-top:8px">${(typeof r.skills_learned === 'string' ? JSON.parse(r.skills_learned) : (r.skills_learned || [])).map(s => `<span style="background:#dbeafe;color:#1d4ed8;padding:2px 8px;border-radius:12px;margin:2px;font-size:.85em">${esc(s)}</span>`).join('')}</div>
            ` : ''}
          </div>
        `).join('') : '<div class="card"><p style="color:${GRAY}">No reflections yet. Complete a job shadow experience and write your first reflection!</p></div>'}
      `;
      res.send(renderPage(req, 'My Reflections', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 8. Career Tracker ───
  app.get(PREFIX + '/career-tracker', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const data = await pool.query(
        `SELECT o.industry, o.role, o.company_name, a.status, a.hours_completed,
                r.rating, r.skills_learned
         FROM shadow_applications a
         JOIN shadow_opportunities o ON o.id = a.opportunity_id
         LEFT JOIN shadow_reflections r ON r.application_id = a.id
         WHERE a.tenant_id=$1 AND a.student_id=$2`,
        [req.tenant.id, req.user.id]);
      const industries = {};
      const roles = {};
      let totalHours = 0;
      let avgRating = 0;
      let ratingCount = 0;
      data.rows.forEach(r => {
        if (r.industry) industries[r.industry] = (industries[r.industry] || 0) + 1;
        if (r.role) roles[r.role] = (roles[r.role] || 0) + 1;
        totalHours += parseFloat(r.hours_completed || 0);
        if (r.rating) { avgRating += r.rating; ratingCount++; }
      });
      avgRating = ratingCount > 0 ? (avgRating / ratingCount).toFixed(1) : 0;

      const body = `
        ${SKIP}
        <style>.bar{height:24px;border-radius:12px;transition:width .3s}</style>
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Career Exploration Tracker</h2>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px">
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${totalHours}h</div>
            <div style="color:${GRAY}">Total Shadow Hours</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#059669">${Object.keys(industries).length}</div>
            <div style="color:${GRAY}">Industries Explored</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#d97706">${avgRating}</div>
            <div style="color:${GRAY}">Avg Rating</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#7c3aed">${data.rows.length}</div>
            <div style="color:${GRAY}">Total Experiences</div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">Industries Explored</h3>
          ${Object.entries(industries).sort((a,b) => b[1]-a[1]).map(([ind, count]) => {
            const max = Math.max(...Object.values(industries));
            const pct = Math.round((count / max) * 100);
            return `<div style="margin-bottom:8px">
              <div style="display:flex;justify-content:space-between;margin-bottom:2px"><span>${esc(ind)}</span><span style="color:${GRAY}">${count} experience(s)</span></div>
              <div style="background:#e5e7eb;border-radius:12px;height:24px"><div class="bar" style="width:${pct}%;background:${P}"></div></div>
            </div>`;
          }).join('') || '<p style="color:${GRAY}">No data yet.</p>'}
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">Roles Explored</h3>
          ${Object.entries(roles).sort((a,b) => b[1]-a[1]).map(([role, count]) => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:8px;border-bottom:1px solid #e5e7eb">
              <span>${esc(role)}</span><span style="color:${GRAY}">${count}x</span>
            </div>
          `).join('') || '<p style="color:${GRAY}">No data yet.</p>'}
        </div>
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:8px">&larr; Back to Dashboard</a>
      `;
      res.send(renderPage(req, 'Career Tracker', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 9. Admin: Create Opportunity ───
  app.get(PREFIX + '/admin/opportunities/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Create Shadow Opportunity</h2>
          <form method="POST" action="${PREFIX}/admin/opportunities/new">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Company Name</label>
                <input type="text" name="company_name" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Industry</label>
                <input type="text" name="industry" placeholder="e.g., Technology, Healthcare, Finance"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Role / Position</label>
                <input type="text" name="role" required></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Location</label>
                <input type="text" name="location" placeholder="e.g., Office address or Remote"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Duration (hours)</label>
                <input type="number" name="duration_hours" value="4" min="1" max="40"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Max Students</label>
                <input type="number" name="max_students" value="3" min="1" max="20"></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
              <textarea name="description" rows="4" placeholder="Describe what students will experience..."></textarea>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Requirements</label>
              <textarea name="requirements" rows="2" placeholder="Any prerequisites for students..."></textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Host Contact Name</label>
                <input type="text" name="host_contact"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Host Email</label>
                <input type="email" name="host_email"></div>
            </div>
            <button type="submit" class="btn">Create Opportunity</button>
            <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Create Opportunity', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/admin/opportunities/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { company_name, industry, role, description, requirements, duration_hours, location, host_contact, host_email, max_students } = req.body;
      await pool.query(
        `INSERT INTO shadow_opportunities (tenant_id, company_name, industry, role, description, requirements, duration_hours, location, host_contact, host_email, max_students)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [req.tenant.id, company_name, industry, role, description, requirements, duration_hours || 4, location, host_contact, host_email, max_students || 3]
      );
      audit(req, 'shadow_opportunity_created', { company_name, role });
      res.redirect(PREFIX);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 10. Admin: Manage Applications ───
  app.get(PREFIX + '/admin/applications', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const statusFilter = req.query.status || '';
      let query = `SELECT a.*, o.company_name, o.role, o.industry, s.name as student_name, s.email as student_email
        FROM shadow_applications a
        JOIN shadow_opportunities o ON o.id = a.opportunity_id
        LEFT JOIN students s ON s.id = a.student_id
        WHERE a.tenant_id=$1`;
      const params = [req.tenant.id];
      if (statusFilter) { query += ' AND a.status=$2'; params.push(statusFilter); }
      query += ' ORDER BY a.applied_at DESC';
      const applications = await pool.query(query, params);

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Manage Applications</h2>
          <div style="display:flex;gap:8px">
            ${['', 'pending', 'approved', 'rejected', 'withdrawn', 'completed'].map(s =>
              `<a href="${PREFIX}/admin/applications${s ? '?status=' + s : ''}" class="btn" style="padding:4px 12px;font-size:.85em;${(statusFilter || '') === s ? 'background:#3730a3' : ''}">${s || 'All'}</a>`
            ).join('')}
          </div>
        </div>
        ${applications.rows.length ? `<table>
          <tr><th>Student</th><th>Company</th><th>Role</th><th>Status</th><th>Preferred Date</th><th>Applied</th><th>Actions</th></tr>
          ${applications.rows.map(a => `<tr>
            <td>${esc(a.student_name || 'Unknown')}</td><td>${esc(a.company_name)}</td>
            <td>${esc(a.role)}</td>
            <td><span style="background:${a.status === 'approved' ? '#dcfce7' : a.status === 'pending' ? '#fef3c7' : a.status === 'completed' ? '#dbeafe' : '#fee2e2'};padding:2px 10px;border-radius:20px;font-size:.85em">${a.status}</span></td>
            <td>${a.preferred_date ? a.preferred_date.toLocaleDateString() : '-'}</td>
            <td>${a.applied_at.toLocaleDateString()}</td>
            <td>
              ${a.status === 'pending' ? `
                <form method="POST" action="${PREFIX}/admin/approve/${a.id}" style="display:inline">
                  <button type="submit" class="btn" style="padding:4px 8px;font-size:.8em;background:#059669">Approve</button>
                </form>
                <form method="POST" action="${PREFIX}/admin/reject/${a.id}" style="display:inline">
                  <button type="submit" class="btn" style="padding:4px 8px;font-size:.8em;background:#dc2626">Reject</button>
                </form>
              ` : ''}
              ${a.status === 'approved' ? `
                <form method="POST" action="${PREFIX}/admin/complete/${a.id}" style="display:inline">
                  <button type="submit" class="btn" style="padding:4px 8px;font-size:.8em;background:#2563eb">Mark Complete</button>
                </form>
              ` : ''}
            </td>
          </tr>`).join('')}
        </table>` : '<div class="card"><p style="color:${GRAY}">No applications found.</p></div>'}
      `;
      res.send(renderPage(req, 'Manage Applications', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/admin/approve/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query('UPDATE shadow_applications SET status=$1 WHERE id=$2 AND tenant_id=$3', ['approved', req.params.id, req.tenant.id]);
      const app_data = await pool.query(`SELECT a.student_id, o.role, o.company_name, s.email FROM shadow_applications a JOIN shadow_opportunities o ON o.id=a.opportunity_id LEFT JOIN students s ON s.id=a.student_id WHERE a.id=$1 AND a.tenant_id=$2`, [req.params.id, req.tenant.id]);
      if (app_data.rows.length && app_data.rows[0].email) {
        queueEmail(app_data.rows[0].email, 'Job Shadow Application Approved', `Your application for "${app_data.rows[0].role}" at ${app_data.rows[0].company_name} has been approved! Please contact the host to arrange your shadow experience.`);
      }
      audit(req, 'shadow_application_approved', { application_id: req.params.id });
      res.redirect(PREFIX + '/admin/applications');
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/admin/reject/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query('UPDATE shadow_applications SET status=$1 WHERE id=$2 AND tenant_id=$3', ['rejected', req.params.id, req.tenant.id]);
      audit(req, 'shadow_application_rejected', { application_id: req.params.id });
      res.redirect(PREFIX + '/admin/applications');
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/admin/complete/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query('UPDATE shadow_applications SET status=$1, completed_at=NOW() WHERE id=$2 AND tenant_id=$3', ['completed', req.params.id, req.tenant.id]);
      audit(req, 'shadow_application_completed', { application_id: req.params.id });
      res.redirect(PREFIX + '/admin/applications');
    } catch(e) { ah(e, req, res); }
  });

  // ─── 11. Admin: Verify Hours ───
  app.get(PREFIX + '/admin/verify-hours', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const hours = await pool.query(
        `SELECT h.*, s.name as student_name, o.company_name, o.role
         FROM shadow_hours h
         LEFT JOIN students s ON s.id = h.student_id
         LEFT JOIN shadow_applications a ON a.id = h.application_id
         LEFT JOIN shadow_opportunities o ON o.id = a.opportunity_id
         WHERE h.tenant_id=$1 AND h.verified_at IS NULL
         ORDER BY h.date DESC`, [req.tenant.id]);

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Verify Shadow Hours</h2>
          <p style="color:${GRAY}">${hours.rows.length} entries pending verification</p>
        </div>
        ${hours.rows.length ? `<table>
          <tr><th>Student</th><th>Company/Role</th><th>Date</th><th>Hours</th><th>Activity</th><th>Actions</th></tr>
          ${hours.rows.map(h => `<tr>
            <td>${esc(h.student_name || 'Unknown')}</td>
            <td>${esc(h.company_name || '-')} / ${esc(h.role || '-')}</td>
            <td>${h.date ? h.date.toLocaleDateString() : '-'}</td>
            <td>${h.hours}h</td>
            <td>${esc((h.activity || '').substring(0, 80))}</td>
            <td>
              <form method="POST" action="${PREFIX}/admin/verify-hours/${h.id}" style="display:inline">
                <button type="submit" class="btn" style="padding:4px 10px;font-size:.85em;background:#059669">Verify</button>
              </form>
            </td>
          </tr>`).join('')}
        </table>` : '<div class="card"><p style="color:${GRAY}">No pending hours to verify.</p></div>'}
      `;
      res.send(renderPage(req, 'Verify Hours', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/admin/verify-hours/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query('UPDATE shadow_hours SET verified_by=$1, verified_at=NOW() WHERE id=$2 AND tenant_id=$3', [req.user.id, req.params.id, req.tenant.id]);
      audit(req, 'shadow_hours_verified', { hours_id: req.params.id });
      res.redirect(PREFIX + '/admin/verify-hours');
    } catch(e) { ah(e, req, res); }
  });

  // ─── 12. Admin: Reports ───
  app.get(PREFIX + '/admin/reports', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [totalOpp, totalApps, totalCompleted, industryStats] = await Promise.all([
        pool.query('SELECT COUNT(*) as c FROM shadow_opportunities WHERE tenant_id=$1', [req.tenant.id]),
        pool.query('SELECT COUNT(*) as c FROM shadow_applications WHERE tenant_id=$1', [req.tenant.id]),
        pool.query('SELECT COUNT(*) as c FROM shadow_applications WHERE tenant_id=$1 AND status=$2', [req.tenant.id, 'completed']),
        pool.query(`SELECT o.industry, COUNT(*) as apps, AVG(r.rating) as avg_rating
          FROM shadow_applications a
          JOIN shadow_opportunities o ON o.id = a.opportunity_id
          LEFT JOIN shadow_reflections r ON r.application_id = a.id
          WHERE a.tenant_id=$1 GROUP BY o.industry ORDER BY apps DESC`, [req.tenant.id])
      ]);

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Job Shadow Program Reports</h2>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:20px">
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${totalOpp.rows[0].c}</div>
            <div style="color:${GRAY}">Total Opportunities</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${totalApps.rows[0].c}</div>
            <div style="color:${GRAY}">Total Applications</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#059669">${totalCompleted.rows[0].c}</div>
            <div style="color:${GRAY}">Completed</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#d97706">${totalApps.rows[0].c > 0 ? Math.round((totalCompleted.rows[0].c / totalApps.rows[0].c) * 100) : 0}%</div>
            <div style="color:${GRAY}">Completion Rate</div>
          </div>
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">Industry Breakdown</h3>
          ${industryStats.rows.length ? `<table>
            <tr><th>Industry</th><th>Applications</th><th>Avg Rating</th></tr>
            ${industryStats.rows.map(s => `<tr>
              <td>${esc(s.industry || 'Other')}</td><td>${s.apps}</td>
              <td>${s.avg_rating ? parseFloat(s.avg_rating).toFixed(1) : '-'}</td>
            </tr>`).join('')}
          </table>` : '<p style="color:${GRAY}">No data yet.</p>'}
        </div>
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:8px">&larr; Back</a>
      `;
      res.send(renderPage(req, 'Shadow Reports', body));
    } catch(e) { ah(e, req, res); }
  });
};
