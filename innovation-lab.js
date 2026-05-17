module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS innovation_projects (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(255),
        description TEXT, team_id INT, mentor_id INT, category VARCHAR(100),
        status VARCHAR(50) DEFAULT 'idea', budget DECIMAL(10,2) DEFAULT 0,
        start_date DATE, expected_completion DATE, progress INT DEFAULT 0,
        tags JSONB DEFAULT '[]', created_by INT, created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS maker_spaces (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, name VARCHAR(255),
        location VARCHAR(255), equipment JSONB DEFAULT '[]',
        capacity INT DEFAULT 20, open_hours VARCHAR(255),
        booking_required BOOLEAN DEFAULT true, status VARCHAR(50) DEFAULT 'active',
        description TEXT, image_url TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS idea_submissions (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL,
        title VARCHAR(255), description TEXT, category VARCHAR(100),
        votes INT DEFAULT 0, status VARCHAR(50) DEFAULT 'open',
        comments JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS maker_bookings (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, space_id INT NOT NULL,
        user_id INT NOT NULL, booking_date DATE, start_time TIME,
        end_time TIME, purpose TEXT, status VARCHAR(50) DEFAULT 'pending',
        equipment_requested JSONB DEFAULT '[]', created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS print_queue (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, project_id INT,
        user_id INT NOT NULL, file_name VARCHAR(255), file_url TEXT,
        material VARCHAR(100), color VARCHAR(50), infill INT DEFAULT 20,
        dimensions TEXT, estimated_hours DECIMAL(5,2),
        status VARCHAR(50) DEFAULT 'queued', priority INT DEFAULT 0,
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS innovation_challenges (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(255),
        description TEXT, category VARCHAR(100), start_date DATE,
        end_date DATE, prizes TEXT, rules TEXT, judge_ids JSONB DEFAULT '[]',
        max_participants INT, status VARCHAR(50) DEFAULT 'upcoming'
      )`);
      console.log('[Mod] innovation-lab OK');
    } catch(e) { console.warn('[Mod] innovation-lab Warn:', e.message); }
  })();

  const PREFIX = '/school/innovation-lab';

  // ─── 1. Dashboard ───
  app.get(PREFIX, requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [projects, spaces, ideas, prints, challenges] = await Promise.all([
        pool.query('SELECT * FROM innovation_projects WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 10', [req.tenant.id]),
        pool.query('SELECT * FROM maker_spaces WHERE tenant_id=$1 ORDER BY name', [req.tenant.id]),
        pool.query('SELECT i.*, s.name as student_name FROM idea_submissions i LEFT JOIN students s ON s.id=i.student_id WHERE i.tenant_id=$1 ORDER BY votes DESC, created_at DESC LIMIT 10', [req.tenant.id]),
        pool.query('SELECT p.*, s.name as student_name FROM print_queue p LEFT JOIN students s ON s.id=p.user_id WHERE p.tenant_id=$1 ORDER BY created_at DESC LIMIT 5', [req.tenant.id]),
        pool.query('SELECT * FROM innovation_challenges WHERE tenant_id=$1 ORDER BY start_date DESC', [req.tenant.id])
      ]);
      const activeProjects = projects.rows.filter(p => p.status !== 'completed' && p.status !== 'archived').length;
      const pendingPrints = prints.rows.filter(p => p.status === 'queued' || p.status === 'printing').length;

      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:4px">Innovation Lab</h2>
          <p style="color:${GRAY}">Explore ideas, build prototypes, and bring innovations to life</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:20px">
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:${P}">${projects.rows.length}</div>
            <div style="color:${GRAY}">Projects</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#059669">${activeProjects}</div>
            <div style="color:${GRAY}">Active</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#d97706">${spaces.rows.length}</div>
            <div style="color:${GRAY}">Maker Spaces</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#7c3aed">${ideas.rows.length}</div>
            <div style="color:${GRAY}">Ideas</div>
          </div>
          <div class="card" style="text-align:center">
            <div style="font-size:2em;font-weight:700;color:#dc2626">${pendingPrints}</div>
            <div style="color:${GRAY}">Print Jobs</div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
          <a href="${PREFIX}/projects/new" class="btn" style="background:#059669">+ New Project</a>
          <a href="${PREFIX}/ideas/submit" class="btn" style="background:#d97706">+ Submit Idea</a>
          <a href="${PREFIX}/maker-spaces" class="btn" style="background:#7c3aed">Maker Spaces</a>
          <a href="${PREFIX}/3d-print" class="btn" style="background:#dc2626">3D Print Queue</a>
          <a href="${PREFIX}/challenges" class="btn" style="background:#0891b2">Challenges</a>
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">Innovation Projects</h3>
          ${projects.rows.length ? `<table>
            <tr><th>Title</th><th>Category</th><th>Status</th><th>Progress</th><th>Budget</th><th>Updated</th></tr>
            ${projects.rows.map(p => `<tr>
              <td><a href="${PREFIX}/projects/${p.id}" style="color:${P};font-weight:600">${esc(p.title)}</a></td>
              <td>${esc(p.category || '-')}</td>
              <td><span style="background:${p.status === 'completed' ? '#dcfce7' : p.status === 'in-progress' ? '#dbeafe' : p.status === 'idea' ? '#fef3c7' : '#f3f4f6'};padding:2px 10px;border-radius:20px;font-size:.85em">${p.status}</span></td>
              <td>
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="flex:1;background:#e5e7eb;border-radius:8px;height:8px;max-width:100px">
                    <div style="background:${p.progress >= 75 ? '#059669' : p.progress >= 40 ? '#d97706' : P};height:8px;border-radius:8px;width:${p.progress}%"></div>
                  </div>
                  <span style="font-size:.85em">${p.progress}%</span>
                </div>
              </td>
              <td>$${parseFloat(p.budget || 0).toLocaleString()}</td>
              <td>${p.updated_at.toLocaleDateString()}</td>
            </tr>`).join('')}
          </table>` : '<p style="color:${GRAY}">No projects yet. Start your first innovation project!</p>'}
        </div>
        ${ideas.rows.length ? `<div class="card">
          <h3 style="margin-bottom:12px">Top Ideas &#128293;</h3>
          ${ideas.rows.slice(0, 5).map(i => `
            <div style="display:flex;align-items:center;gap:12px;padding:8px 0;border-bottom:1px solid #e5e7eb">
              <div style="text-align:center;min-width:50px">
                <div style="font-size:1.2em;font-weight:700;color:${P}">${i.votes}</div>
                <div style="font-size:.75em;color:${GRAY}">votes</div>
              </div>
              <div style="flex:1">
                <a href="${PREFIX}/ideas/${i.id}" style="color:${P};font-weight:600">${esc(i.title)}</a>
                <p style="color:${GRAY};font-size:.85em">by ${esc(i.student_name || 'Anonymous')} &bull; ${i.created_at.toLocaleDateString()}</p>
              </div>
            </div>
          `).join('')}
          <a href="${PREFIX}/ideas" class="btn" style="margin-top:12px">View All Ideas</a>
        </div>` : ''}
      `;
      res.send(renderPage(req, 'Innovation Lab', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 2. New Project ───
  app.get(PREFIX + '/projects/new', requireAuth, requireNotBanned, async (req, res) => {
    const body = `
      ${SKIP}
      <div class="card">
        <h2 style="color:${P};margin-bottom:16px">Create Innovation Project</h2>
        <form method="POST" action="${PREFIX}/projects/new">
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Project Title *</label>
            <input type="text" name="title" placeholder="Give your project a catchy name" required>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Description *</label>
            <textarea name="description" rows="5" placeholder="Describe the problem you are solving and your proposed solution..." required></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Category</label>
              <select name="category">
                <option value="Technology">Technology</option>
                <option value="Robotics">Robotics</option>
                <option value="IoT">IoT</option>
                <option value="AI/ML">AI/ML</option>
                <option value="Sustainability">Sustainability</option>
                <option value="Healthcare">Healthcare</option>
                <option value="Education">Education</option>
                <option value="Social Impact">Social Impact</option>
                <option value="Engineering">Engineering</option>
                <option value="Design">Design</option>
                <option value="Other">Other</option>
              </select></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Estimated Budget</label>
              <input type="number" name="budget" step="0.01" min="0" value="0"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Expected Completion</label>
              <input type="date" name="expected_completion"></div>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Tags (comma-separated)</label>
            <input type="text" name="tags" placeholder="e.g., arduino, sensor, prototype">
          </div>
          <div style="display:flex;gap:8px">
            <button type="submit" class="btn">Create Project</button>
            <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    `;
    res.send(renderPage(req, 'New Innovation Project', body));
  });

  app.post(PREFIX + '/projects/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, description, category, budget, expected_completion, tags } = req.body;
      const tagsArr = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
      const result = await pool.query(
        `INSERT INTO innovation_projects (tenant_id, title, description, category, budget, start_date, expected_completion, tags, created_by, status)
         VALUES ($1,$2,$3,$4,$5,NOW(),$6,$7,$8,'idea') RETURNING id`,
        [req.tenant.id, title, description, category, budget || 0, expected_completion, JSON.stringify(tagsArr), req.user.id]
      );
      audit(req, 'innovation_project_created', { project_id: result.rows[0].id, title });
      res.redirect(PREFIX + '/projects/' + result.rows[0].id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 3. Project Detail ───
  app.get(PREFIX + '/projects/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const project = await pool.query('SELECT * FROM innovation_projects WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
      if (!project.rows.length) return res.status(404).send('Project not found');
      const p = project.rows[0];
      const tags = typeof p.tags === 'string' ? JSON.parse(p.tags) : (p.tags || []);

      const statusColors = { idea: '#fef3c7', planning: '#e0e7ff', 'in-progress': '#dbeafe', testing: '#fef3c7', completed: '#dcfce7', archived: '#f3f4f6', onhold: '#fee2e2' };

      const body = `
        ${SKIP}
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
            <div>
              <h2 style="color:${P};margin-bottom:4px">${esc(p.title)}</h2>
              <p style="color:${GRAY}">${esc(p.category || '')} &bull; Created ${p.created_at.toLocaleDateString()}</p>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <span style="background:${statusColors[p.status] || '#f3f4f6'};padding:4px 16px;border-radius:20px;font-weight:600">${p.status.replace('-', ' ').toUpperCase()}</span>
              <a href="${PREFIX}/projects/edit/${p.id}" class="btn" style="padding:4px 10px;font-size:.85em;background:#d97706">Edit</a>
            </div>
          </div>
        </div>
        <div style="margin-bottom:20px">
          <div style="display:flex;justify-content:space-between;margin-bottom:4px">
            <span style="font-weight:600">Progress</span>
            <span style="color:${GRAY}">${p.progress}%</span>
          </div>
          <div style="background:#e5e7eb;border-radius:12px;height:16px">
            <div style="background:${p.progress >= 75 ? '#059669' : p.progress >= 40 ? '#d97706' : P};height:16px;border-radius:12px;width:${p.progress}%;transition:width .3s"></div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:20px">
          <div class="card"><strong>Budget:</strong> $${parseFloat(p.budget || 0).toLocaleString()}</div>
          <div class="card"><strong>Start:</strong> ${p.start_date ? p.start_date.toLocaleDateString() : '-'}</div>
          <div class="card"><strong>Expected:</strong> ${p.expected_completion ? p.expected_completion.toLocaleDateString() : '-'}</div>
          <div class="card"><strong>Last Updated:</strong> ${p.updated_at.toLocaleDateString()}</div>
        </div>
        ${tags.length ? `<div style="margin-bottom:16px">${tags.map(t => `<span style="background:#ede9fe;color:#4f46e5;padding:4px 12px;border-radius:20px;margin:2px">${esc(t)}</span>`).join('')}</div>` : ''}
        <div class="card">
          <h3 style="margin-bottom:8px">Description</h3>
          <p style="white-space:pre-line">${esc(p.description || '')}</p>
        </div>
        <div class="card">
          <h3 style="margin-bottom:12px">Update Progress</h3>
          <form method="POST" action="${PREFIX}/projects/update-progress/${p.id}">
            <div style="display:flex;gap:12px;align-items:end">
              <div style="flex:1">
                <label style="font-weight:600;display:block;margin-bottom:4px">Progress (%)</label>
                <input type="range" name="progress" min="0" max="100" value="${p.progress}" oninput="this.nextElementSibling.textContent=this.value+'%'" style="width:100%">
                <span>${p.progress}%</span>
              </div>
              <div>
                <label style="font-weight:600;display:block;margin-bottom:4px">Status</label>
                <select name="status">
                  ${['idea','planning','in-progress','testing','completed','onhold','archived'].map(s => `<option value="${s}" ${p.status === s ? 'selected' : ''}>${s.replace('-',' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('')}
                </select>
              </div>
              <button type="submit" class="btn">Update</button>
            </div>
          </form>
        </div>
        <div style="display:flex;gap:8px;margin-top:16px">
          <a href="${PREFIX}/3d-print/new/${p.id}" class="btn" style="background:#dc2626">Submit 3D Print Job</a>
          <a href="${PREFIX}" class="btn" style="background:${GRAY};text-decoration:none">&larr; Back</a>
        </div>
      `;
      res.send(renderPage(req, p.title, body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/projects/update-progress/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { progress, status } = req.body;
      await pool.query(
        'UPDATE innovation_projects SET progress=$1, status=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4',
        [progress || 0, status, req.params.id, req.tenant.id]
      );
      audit(req, 'project_progress_updated', { project_id: req.params.id, progress });
      res.redirect(PREFIX + '/projects/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 4. Edit Project ───
  app.get(PREFIX + '/projects/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const project = await pool.query('SELECT * FROM innovation_projects WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
      if (!project.rows.length) return res.status(404).send('Project not found');
      const p = project.rows[0];
      const tags = typeof p.tags === 'string' ? JSON.parse(p.tags) : (p.tags || []);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Edit: ${esc(p.title)}</h2>
          <form method="POST" action="${PREFIX}/projects/edit/${p.id}">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Title *</label>
              <input type="text" name="title" value="${esc(p.title)}" required>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Description *</label>
              <textarea name="description" rows="5" required>${esc(p.description || '')}</textarea>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Category</label>
                <select name="category">
                  ${['Technology','Robotics','IoT','AI/ML','Sustainability','Healthcare','Education','Social Impact','Engineering','Design','Other'].map(c =>
                    `<option value="${c}" ${p.category === c ? 'selected' : ''}>${c}</option>`).join('')}
                </select></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Budget</label>
                <input type="number" name="budget" step="0.01" min="0" value="${p.budget || 0}"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Expected Completion</label>
                <input type="date" name="expected_completion" value="${p.expected_completion ? p.expected_completion.toISOString().split('T')[0] : ''}"></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Tags (comma-separated)</label>
              <input type="text" name="tags" value="${esc(tags.join(', '))}">
            </div>
            <button type="submit" class="btn">Save Changes</button>
            <a href="${PREFIX}/projects/${p.id}" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Edit Project', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/projects/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, description, category, budget, expected_completion, tags } = req.body;
      const tagsArr = (tags || '').split(',').map(t => t.trim()).filter(Boolean);
      await pool.query(
        'UPDATE innovation_projects SET title=$1, description=$2, category=$3, budget=$4, expected_completion=$5, tags=$6, updated_at=NOW() WHERE id=$7 AND tenant_id=$8',
        [title, description, category, budget || 0, expected_completion, JSON.stringify(tagsArr), req.params.id, req.tenant.id]
      );
      res.redirect(PREFIX + '/projects/' + req.params.id);
    } catch(e) { ah(e, req, res); }
  });

  // ─── 5. Ideas Board ───
  app.get(PREFIX + '/ideas', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const categoryFilter = req.query.category || '';
      let query = `SELECT i.*, s.name as student_name FROM idea_submissions i
        LEFT JOIN students s ON s.id = i.student_id WHERE i.tenant_id=$1`;
      const params = [req.tenant.id];
      if (categoryFilter) { query += ' AND i.category=$2'; params.push(categoryFilter); }
      query += ' ORDER BY i.votes DESC, i.created_at DESC';
      const ideas = await pool.query(query, params);

      const categories = [...new Set(ideas.rows.map(i => i.category || 'Other'))];

      const body = `
        ${SKIP}
        <style>.idea-card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:12px;transition:border-color .2s}.idea-card:hover{border-color:${P}}</style>
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Idea Board</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="${PREFIX}/ideas/submit" class="btn" style="background:#059669">+ Submit Idea</a>
            ${['', ...categories].map(c => `
              <a href="${PREFIX}/ideas${c ? '?category=' + encodeURIComponent(c) : ''}" class="btn" style="padding:4px 12px;font-size:.85em;${(categoryFilter || '') === c ? 'background:#3730a3' : ''}">${c || 'All'}</a>
            `).join('')}
          </div>
        </div>
        ${ideas.rows.length ? ideas.rows.map(i => {
          const comments = typeof i.comments === 'string' ? JSON.parse(i.comments) : (i.comments || []);
          return `
          <div class="idea-card">
            <div style="display:flex;gap:16px">
              <div style="text-align:center;min-width:60px">
                <form method="POST" action="${PREFIX}/ideas/vote/${i.id}" style="display:inline">
                  <button type="submit" style="background:none;border:1px solid #e5e7eb;border-radius:8px;padding:4px 12px;cursor:pointer;font-size:1.1em">&#9650;</button>
                </form>
                <div style="font-size:1.5em;font-weight:700;color:${P};margin:4px 0">${i.votes}</div>
              </div>
              <div style="flex:1">
                <h3 style="margin:0 0 4px"><a href="${PREFIX}/ideas/${i.id}" style="color:${P}">${esc(i.title)}</a></h3>
                <p style="color:${GRAY};font-size:.85em;margin-bottom:6px">by ${esc(i.student_name || 'Anonymous')} &bull; ${esc(i.category || 'Other')} &bull; ${i.created_at.toLocaleDateString()}</p>
                <p style="margin:0">${esc((i.description || '').substring(0, 200))}${(i.description || '').length > 200 ? '...' : ''}</p>
                <div style="margin-top:6px;font-size:.85em;color:${GRAY}">${comments.length} comment(s) &bull; <span style="background:${i.status === 'open' ? '#dcfce7' : i.status === 'in-progress' ? '#dbeafe' : '#f3f4f6'};padding:1px 8px;border-radius:12px">${i.status}</span></div>
              </div>
            </div>
          </div>`;
        }).join('') : '<div class="card"><p style="color:${GRAY}">No ideas yet. Be the first to submit an idea!</p></div>'}
      `;
      res.send(renderPage(req, 'Idea Board', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 6. Submit Idea ───
  app.get(PREFIX + '/ideas/submit', requireAuth, requireNotBanned, async (req, res) => {
    const body = `
      ${SKIP}
      <div class="card">
        <h2 style="color:${P};margin-bottom:16px">Submit Your Idea</h2>
        <form method="POST" action="${PREFIX}/ideas/submit">
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Idea Title *</label>
            <input type="text" name="title" placeholder="A catchy title for your idea" required>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Category</label>
            <select name="category">
              <option value="Technology">Technology</option>
              <option value="Robotics">Robotics</option>
              <option value="Sustainability">Sustainability</option>
              <option value="Healthcare">Healthcare</option>
              <option value="Education">Education</option>
              <option value="Social Impact">Social Impact</option>
              <option value="Other">Other</option>
            </select>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Description *</label>
            <textarea name="description" rows="6" placeholder="Describe your idea in detail. What problem does it solve? How would it work? Who would benefit?" required></textarea>
          </div>
          <button type="submit" class="btn">Submit Idea</button>
          <a href="${PREFIX}/ideas" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
        </form>
      </div>
    `;
    res.send(renderPage(req, 'Submit Idea', body));
  });

  app.post(PREFIX + '/ideas/submit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, description, category } = req.body;
      await pool.query(
        'INSERT INTO idea_submissions (tenant_id, student_id, title, description, category) VALUES ($1,$2,$3,$4,$5)',
        [req.tenant.id, req.user.id, title, description, category]
      );
      audit(req, 'idea_submitted', { title });
      res.redirect(PREFIX + '/ideas');
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/ideas/vote/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query('UPDATE idea_submissions SET votes = votes + 1 WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant.id]);
      res.redirect(PREFIX + '/ideas' + (req.query.category ? '?category=' + req.query.category : ''));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 7. Maker Spaces ───
  app.get(PREFIX + '/maker-spaces', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const spaces = await pool.query('SELECT * FROM maker_spaces WHERE tenant_id=$1 ORDER BY name', [req.tenant.id]);
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Maker Spaces</h2>
          <p style="color:${GRAY}">Book workspaces and access tools for your projects</p>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
          ${spaces.rows.map(s => {
            const equipment = typeof s.equipment === 'string' ? JSON.parse(s.equipment) : (s.equipment || []);
            return `
            <div class="card" style="border-top:4px solid ${P}">
              <h3 style="color:${P};margin-bottom:4px">${esc(s.name)}</h3>
              <p style="color:${GRAY};margin-bottom:8px">${esc(s.location || '')}</p>
              ${equipment.length ? `<div style="margin-bottom:8px"><strong>Equipment:</strong>
                ${equipment.map(e => `<span style="background:#f3f4f6;padding:2px 8px;border-radius:12px;margin:2px;font-size:.85em">${esc(typeof e === 'object' ? e.name : e)}</span>`).join('')}
              </div>` : ''}
              <div style="font-size:.9em;color:${GRAY};margin-bottom:8px">
                <div>&#128338; ${esc(s.open_hours || 'Not specified')}</div>
                <div>&#128101; Capacity: ${s.capacity || 'N/A'}${s.booking_required ? ' &bull; Booking Required' : ''}</div>
              </div>
              <a href="${PREFIX}/maker-spaces/book/${s.id}" class="btn" style="width:100%">Book Space</a>
            </div>`;
          }).join('')}
        </div>
        ${spaces.rows.length === 0 ? '<div class="card"><p style="color:${GRAY}">No maker spaces configured yet.</p></div>' : ''}
      `;
      res.send(renderPage(req, 'Maker Spaces', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 8. 3D Print Queue ───
  app.get(PREFIX + '/3d-print', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const prints = await pool.query(
        `SELECT pq.*, s.name as student_name, ip.title as project_title
         FROM print_queue pq
         LEFT JOIN students s ON s.id = pq.user_id
         LEFT JOIN innovation_projects ip ON ip.id = pq.project_id
         WHERE pq.tenant_id=$1 ORDER BY
           CASE pq.status WHEN 'printing' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END,
           pq.priority DESC, pq.created_at ASC`, [req.tenant.id]);

      const body = `
        ${SKIP}
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <h2 style="color:${P};margin-bottom:4px">3D Print Queue</h2>
              <p style="color:${GRAY}">${prints.rows.filter(p => p.status === 'queued' || p.status === 'printing').length} jobs in queue</p>
            </div>
            <a href="${PREFIX}/3d-print/new" class="btn" style="background:#dc2626">+ Submit Print Job</a>
          </div>
        </div>
        ${prints.rows.length ? `<table>
          <tr><th>File</th><th>Student</th><th>Project</th><th>Material</th><th>Hours</th><th>Priority</th><th>Status</th><th>Actions</th></tr>
          ${prints.rows.map(p => `<tr>
            <td>${esc(p.file_name || '-')}</td>
            <td>${esc(p.student_name || '-')}</td>
            <td>${esc(p.project_title || '-')}</td>
            <td>${esc(p.material || 'PLA')} ${p.color ? '/ ' + esc(p.color) : ''}</td>
            <td>${p.estimated_hours || '-'}h</td>
            <td>${p.priority || 0}</td>
            <td><span style="background:${p.status === 'completed' ? '#dcfce7' : p.status === 'printing' ? '#dbeafe' : p.status === 'failed' ? '#fee2e2' : '#fef3c7'};padding:2px 10px;border-radius:20px;font-size:.85em">${p.status}</span></td>
            <td>
              ${p.status === 'queued' ? `<form method="POST" action="${PREFIX}/3d-print/start/${p.id}" style="display:inline"><button type="submit" class="btn" style="padding:4px 8px;font-size:.8em;background:#059669">Start</button></form>` : ''}
              ${p.status === 'printing' ? `<form method="POST" action="${PREFIX}/3d-print/complete/${p.id}" style="display:inline"><button type="submit" class="btn" style="padding:4px 8px;font-size:.8em;background:#2563eb">Complete</button></form>` : ''}
            </td>
          </tr>`).join('')}
        </table>` : '<div class="card"><p style="color:${GRAY}">No print jobs in the queue.</p></div>'}
      `;
      res.send(renderPage(req, '3D Print Queue', body));
    } catch(e) { ah(e, req, res); }
  });

  app.get(PREFIX + '/3d-print/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const projects = await pool.query('SELECT id, title FROM innovation_projects WHERE tenant_id=$1 AND status != $2 ORDER BY title', [req.tenant.id, 'archived']);
      const prefill = req.query.project || '';
      const body = `
        ${SKIP}
        <div class="card">
          <h2 style="color:${P};margin-bottom:16px">Submit 3D Print Job</h2>
          <form method="POST" action="${PREFIX}/3d-print/new" enctype="multipart/form-data">
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Project (optional)</label>
              <select name="project_id">
                <option value="">-- No Project --</option>
                ${projects.rows.map(p => `<option value="${p.id}" ${p.id == prefill ? 'selected' : ''}>${esc(p.title)}</option>`).join('')}
              </select>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">File Name *</label>
              <input type="text" name="file_name" placeholder="e.g., robot_arm_v2.stl" required>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Material</label>
                <select name="material">
                  <option value="PLA">PLA</option><option value="ABS">ABS</option>
                  <option value="PETG">PETG</option><option value="TPU">TPU (Flexible)</option>
                  <option value="Nylon">Nylon</option><option value="Resin">Resin</option>
                </select></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Color</label>
                <input type="text" name="color" placeholder="e.g., White, Blue" value="White"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Infill (%)</label>
                <input type="number" name="infill" min="5" max="100" value="20"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Dimensions (L x W x H mm)</label>
                <input type="text" name="dimensions" placeholder="e.g., 100x50x80"></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Estimated Hours</label>
                <input type="number" name="estimated_hours" step="0.25" min="0.25" placeholder="e.g., 4.5"></div>
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Priority (0=normal, higher=urgent)</label>
              <input type="number" name="priority" min="0" max="10" value="0">
            </div>
            <div style="margin-bottom:16px">
              <label style="font-weight:600;display:block;margin-bottom:4px">Notes</label>
              <textarea name="notes" rows="2" placeholder="Special instructions..."></textarea>
            </div>
            <button type="submit" class="btn">Submit Print Job</button>
            <a href="${PREFIX}/3d-print" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
          </form>
        </div>
      `;
      res.send(renderPage(req, 'Submit Print Job', body));
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/3d-print/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { project_id, file_name, material, color, infill, dimensions, estimated_hours, priority, notes } = req.body;
      await pool.query(
        `INSERT INTO print_queue (tenant_id, project_id, user_id, file_name, material, color, infill, dimensions, estimated_hours, priority, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [req.tenant.id, project_id || null, req.user.id, file_name, material, color, infill || 20, dimensions, estimated_hours, priority || 0, notes]
      );
      audit(req, 'print_job_submitted', { file_name, material });
      res.redirect(PREFIX + '/3d-print');
    } catch(e) { ah(e, req, res); }
  });

  app.get(PREFIX + '/3d-print/new/:projectId', requireAuth, requireNotBanned, (req, res) => {
    res.redirect(PREFIX + '/3d-print/new?project=' + req.params.projectId);
  });

  app.post(PREFIX + '/3d-print/start/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query("UPDATE print_queue SET status=$1 WHERE id=$2 AND tenant_id=$3", ['printing', req.params.id, req.tenant.id]);
      audit(req, 'print_job_started', { id: req.params.id });
      res.redirect(PREFIX + '/3d-print');
    } catch(e) { ah(e, req, res); }
  });

  app.post(PREFIX + '/3d-print/complete/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query("UPDATE print_queue SET status=$1, completed_at=NOW() WHERE id=$2 AND tenant_id=$3", ['completed', req.params.id, req.tenant.id]);
      audit(req, 'print_job_completed', { id: req.params.id });
      res.redirect(PREFIX + '/3d-print');
    } catch(e) { ah(e, req, res); }
  });

  // ─── 9. Innovation Challenges ───
  app.get(PREFIX + '/challenges', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const challenges = await pool.query('SELECT * FROM innovation_challenges WHERE tenant_id=$1 ORDER BY start_date DESC', [req.tenant.id]);
      const body = `
        ${SKIP}
        <div class="card">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <h2 style="color:${P};margin-bottom:4px">Innovation Challenges</h2>
              <p style="color:${GRAY}">Compete, innovate, and win prizes</p>
            </div>
          </div>
        </div>
        ${challenges.rows.length ? challenges.rows.map(c => {
          const now = new Date();
          const start = c.start_date ? new Date(c.start_date) : null;
          const end = c.end_date ? new Date(c.end_date) : null;
          const isActive = start && end && now >= start && now <= end;
          return `
          <div class="card" style="border-left:4px solid ${isActive ? '#059669' : c.status === 'upcoming' ? '#d97706' : GRAY}">
            <div style="display:flex;justify-content:space-between;align-items:start">
              <div>
                <h3 style="color:${P}">${esc(c.title)}</h3>
                <p style="color:${GRAY};font-size:.9em">${esc(c.category || '')} &bull; ${start ? start.toLocaleDateString() : 'TBD'} to ${end ? end.toLocaleDateString() : 'TBD'}</p>
              </div>
              <span style="background:${isActive ? '#dcfce7' : c.status === 'upcoming' ? '#fef3c7' : '#f3f4f6'};padding:2px 12px;border-radius:20px;font-size:.85em;font-weight:600">
                ${isActive ? 'ACTIVE' : c.status.toUpperCase()}
              </span>
            </div>
            <p style="margin-top:8px">${esc((c.description || '').substring(0, 200))}</p>
            ${c.prizes ? `<p style="margin-top:6px;font-size:.9em"><strong>Prizes:</strong> ${esc(c.prizes)}</p>` : ''}
            ${c.max_participants ? `<p style="font-size:.9em"><strong>Max Participants:</strong> ${c.max_participants}</p>` : ''}
          </div>`;
        }).join('') : '<div class="card"><p style="color:${GRAY}">No challenges available right now.</p></div>'}
        <a href="${PREFIX}" class="btn" style="display:inline-block;margin-top:16px">&larr; Back</a>
      `;
      res.send(renderPage(req, 'Innovation Challenges', body));
    } catch(e) { ah(e, req, res); }
  });

  // ─── 10. Admin: Manage Spaces ───
  app.get(PREFIX + '/admin/spaces/new', requireAuth, requireNotBanned, async (req, res) => {
    const body = `
      ${SKIP}
      <div class="card">
        <h2 style="color:${P};margin-bottom:16px">Add Maker Space</h2>
        <form method="POST" action="${PREFIX}/admin/spaces/new">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Space Name *</label>
              <input type="text" name="name" required></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Location</label>
              <input type="text" name="location" placeholder="e.g., Building B, Room 101"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Capacity</label>
              <input type="number" name="capacity" min="1" value="20"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Open Hours</label>
              <input type="text" name="open_hours" placeholder="e.g., Mon-Fri 8am-6pm"></div>
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Equipment (comma-separated)</label>
            <input type="text" name="equipment" placeholder="e.g., 3D Printer, Laser Cutter, Soldering Station">
          </div>
          <div style="margin-bottom:16px">
            <label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3"></textarea>
          </div>
          <label style="margin-bottom:16px;display:block"><input type="checkbox" name="booking_required" value="true" checked> Booking Required</label>
          <button type="submit" class="btn">Add Space</button>
          <a href="${PREFIX}/maker-spaces" class="btn" style="background:${GRAY};text-decoration:none;margin-left:8px">Cancel</a>
        </form>
      </div>
    `;
    res.send(renderPage(req, 'Add Maker Space', body));
  });

  app.post(PREFIX + '/admin/spaces/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { name, location, capacity, open_hours, equipment, description, booking_required } = req.body;
      const equipArr = (equipment || '').split(',').map(e => e.trim()).filter(Boolean);
      await pool.query(
        `INSERT INTO maker_spaces (tenant_id, name, location, equipment, capacity, open_hours, booking_required, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [req.tenant.id, name, location, JSON.stringify(equipArr), capacity || 20, open_hours, booking_required === 'true', description]
      );
      audit(req, 'maker_space_created', { name });
      res.redirect(PREFIX + '/maker-spaces');
    } catch(e) { ah(e, req, res); }
  });
};
