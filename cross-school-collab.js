const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const C='#6366f1'; const CL='#818cf8'; const CBG='#eef2ff'; const CG='#059669'; const CR='#dc2626'; const CY='#d97706';

  async function initTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS collab_requests (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, from_tenant_id INT, to_tenant_id INT, request_type TEXT DEFAULT 'general', message TEXT, status TEXT DEFAULT 'pending', from_user_id INT, to_user_id INT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS collab_projects (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(200), description TEXT, project_type TEXT DEFAULT 'academic', status TEXT DEFAULT 'planning', start_date DATE, end_date DATE, max_teams INT DEFAULT 10, created_by INT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS collab_project_members (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, project_id INT, school_tenant_id INT, user_id INT, role TEXT DEFAULT 'participant', team_name VARCHAR(100), status TEXT DEFAULT 'invited', joined_at TIMESTAMPTZ)`,
      `CREATE TABLE IF NOT EXISTS collab_resources (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(200), description TEXT, category VARCHAR(50), file_url VARCHAR(500), file_type VARCHAR(50), subject VARCHAR(100), shared_by INT, download_count INT DEFAULT 0, rating DECIMAL(3,2) DEFAULT 0, review_count INT DEFAULT 0, is_public SMALLINT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS collab_forums (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, topic VARCHAR(200), description TEXT, category VARCHAR(50), is_cross_school SMALLINT DEFAULT 1, created_by INT, post_count INT DEFAULT 0, last_activity TIMESTAMPTZ, status TEXT DEFAULT 'active', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS collab_forum_posts (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, forum_id INT, parent_post_id INT, author_id INT, content TEXT, is_pinned SMALLINT DEFAULT 0, likes INT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS collab_exchange_pairs (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_a_id INT, student_a_tenant INT, student_b_id INT, student_b_tenant INT, program_name VARCHAR(200), start_date DATE, end_date DATE, goals TEXT, status TEXT DEFAULT 'active', communication_log JSON, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS collab_competitions (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(200), description TEXT, comp_type TEXT DEFAULT 'quiz', format TEXT DEFAULT 'individual', status TEXT DEFAULT 'registration', start_date DATE, end_date DATE, registration_deadline DATE, max_participants INT, created_by INT, rules TEXT, prizes TEXT, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS collab_competition_teams (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, competition_id INT, team_name VARCHAR(100), school_tenant_id INT, members JSON, score DECIMAL(8,2) DEFAULT 0, rank INT DEFAULT 0, status TEXT DEFAULT 'registered', registered_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS collab_knowledge_articles (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(200), content TEXT, category VARCHAR(100), tags JSON, author_id INT, version INT DEFAULT 1, views INT DEFAULT 0, likes INT DEFAULT 0, status TEXT DEFAULT 'draft', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP, updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS collab_events (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(200), description TEXT, event_date DATE, event_time TIME, venue VARCHAR(200), max_capacity INT, registered_count INT DEFAULT 0, organizer_school_id INT, category VARCHAR(50), is_cross_school SMALLINT DEFAULT 1, status TEXT DEFAULT 'upcoming', created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`,
      `CREATE TABLE IF NOT EXISTS collab_messages (id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, thread_id VARCHAR(50), sender_id INT, sender_tenant_id INT, recipient_id INT, recipient_tenant_id INT, content TEXT, is_read SMALLINT DEFAULT 0, created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)`
    ];
    for (const sql of tables) { try { await pool.query(sql); } catch(e) { console.warn('[CrossSchoolCollab] Table:', e.message); } }
  }
  initTables();

  // ─── Dashboard ────────────────────────────────────────────────────
  app.get('/school/collab', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [projects] = await pool.query('SELECT COUNT(*) as c FROM collab_projects WHERE tenant_id=? AND status="active"', [tid]);
    const [resources] = await pool.query('SELECT COUNT(*) as c FROM collab_resources WHERE tenant_id=?', [tid]);
    const [comps] = await pool.query('SELECT COUNT(*) as c FROM collab_competitions WHERE tenant_id=? AND status IN ("registration","in_progress")', [tid]);
    const [forums] = await pool.query('SELECT COUNT(*) as c FROM collab_forums WHERE tenant_id=? AND status="active"', [tid]);
    const [messages] = await pool.query('SELECT COUNT(*) as c FROM collab_messages WHERE tenant_id=? AND is_read=0 AND (recipient_id=? OR recipient_tenant_id=?)', [tid, req.session.user.id, tid]);
    const [recentProjects] = await pool.query('SELECT cp.* FROM collab_projects cp WHERE cp.tenant_id=? ORDER BY cp.created_at DESC LIMIT 5', [tid]);
    const [recentComps] = await pool.query('SELECT cc.* FROM collab_competitions cc WHERE cc.tenant_id=? ORDER BY cc.created_at DESC LIMIT 5', [tid]);
    res.send(renderPage('Cross-School Collaboration', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">🌐 Cross-School Collaboration Hub</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;margin-bottom:25px;">
        ${[{l:'Active Projects',v:projects[0].c,c:C},{l:'Shared Resources',v:resources[0].c,c:'#059669'},{l:'Open Competitions',v:comps[0].c,c:CY},{l:'Forum Topics',v:forums[0].c,c:'#7c3aed'},{l:'Unread Messages',v:messages[0].c,c:CR}].map(s=>`<div style="background:${CBG};border-radius:12px;padding:20px;text-align:center;"><div style="font-size:2em;font-weight:bold;color:${s.c};">${s.v}</div><div style="color:#6b7280;font-size:0.9em;">${s.l}</div></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:25px;">
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;"><h3 style="color:${C};margin:0;">📋 Recent Projects</h3><a href="/school/collab/projects" style="color:${C};font-size:0.85em;">View All →</a></div>
          ${recentProjects.map(p=>`<div style="padding:10px 0;border-bottom:1px solid #f3f4f6;"><strong style="font-size:0.9em;">${esc(p.title)}</strong><div style="color:#6b7280;font-size:0.8em;">${p.project_type} • <span style="color:${p.status==='active'?CG:'#9ca3af'};">${p.status}</span></div></div>`).join('')||'<p style="color:#9ca3af;">No projects yet</p>'}
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:15px;"><h3 style="color:${C};margin:0;">🏆 Competitions</h3><a href="/school/collab/competitions" style="color:${C};font-size:0.85em;">View All →</a></div>
          ${recentComps.map(c=>`<div style="padding:10px 0;border-bottom:1px solid #f3f4f6;"><strong style="font-size:0.9em;">${esc(c.title)}</strong><div style="color:#6b7280;font-size:0.8em;">${c.comp_type} • <span style="color:${CY};">${c.status}</span></div></div>`).join('')||'<p style="color:#9ca3af;">No competitions yet</p>'}
        </div>
      </div>
      <div style="display:flex;gap:10px;flex-wrap:wrap;">
        <a href="/school/collab/projects/new" style="background:${C};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">+ New Project</a>
        <a href="/school/collab/competitions/new" style="background:${CY};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">+ New Competition</a>
        <a href="/school/collab/resources/share" style="background:${CG};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">📤 Share Resource</a>
        <a href="/school/collab/forums" style="background:#7c3aed;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">💬 Forums</a>
        <a href="/school/collab/messages" style="background:${CR};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">✉️ Messages ${messages[0].c?'('+messages[0].c+')':''}</a>
        <a href="/school/collab/knowledge" style="background:#0891b2;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">📚 Knowledge Base</a>
      </div>
    </div>`, req.session.user));
  }));

  // ─── Projects ─────────────────────────────────────────────────────
  app.get('/school/collab/projects', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [projects] = await pool.query('SELECT cp.*, (SELECT COUNT(*) FROM collab_project_members WHERE project_id=cp.id AND tenant_id=cp.tenant_id) as member_count FROM collab_projects cp WHERE cp.tenant_id=? ORDER BY cp.created_at DESC', [tid]);
    const statusColors = {planning:'#3b82f6',active:CG,completed:'#8b5cf6',cancelled:'#9ca3af'};
    res.send(renderPage('Collab Projects', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="color:${C};">📋 Cross-School Projects</h2>
        <a href="/school/collab/projects/new" style="background:${C};color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ New Project</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:15px;">
        ${projects.map(p=>`<div style="background:white;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <div style="height:6px;background:${statusColors[p.status]||'#9ca3af'};"></div>
          <div style="padding:15px;"><h3 style="margin:0 0 8px;">${esc(p.title)}</h3><p style="color:#6b7280;font-size:0.85em;margin-bottom:10px;">${esc(p.description||'').substring(0,100)}</p>
          <div style="display:flex;gap:10px;font-size:0.8em;color:#9ca3af;flex-wrap:wrap;"><span>📁 ${p.project_type}</span><span>👥 ${p.member_count}</span><span style="color:${statusColors[p.status]};font-weight:600;">${p.status}</span>${p.start_date?`<span>📅 ${p.start_date} - ${p.end_date||'Ongoing'}</span>`:''}</div>
          <div style="margin-top:10px;"><a href="/school/collab/projects/${p.id}" style="color:${C};text-decoration:none;font-size:0.85em;">View Details →</a></div></div></div>`).join('')||'<p style="color:#6b7280;">No projects yet. Create the first cross-school project!</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/collab/projects/new', requireAuth, ah(async (req, res) => {
    const types = ['academic','cultural','sports','science_fair','debate','art','community'];
    res.send(renderPage('New Project', `<div style="max-width:700px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">➕ New Cross-School Project</h2>
      <form method="POST" action="/school/collab/projects/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Project Title</label><input name="title" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Description</label><textarea name="description" rows="3" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Type</label><select name="project_type" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">${types.map(t=>`<option>${t}</option>`).join('')}</select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Max Teams</label><input type="number" name="max_teams" value="10" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Start Date</label><input type="date" name="start_date" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">End Date</label><input type="date" name="end_date" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
        </div>
        <button type="submit" style="background:${C};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Create Project</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/collab/projects/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const {title,description,project_type,max_teams,start_date,end_date,id} = req.body;
    if (id) {
      await pool.query('UPDATE collab_projects SET title=?,description=?,project_type=?,max_teams=?,start_date=?,end_date=? WHERE id=? AND tenant_id=?', [title,description,project_type,max_teams,start_date,end_date,id,tid]);
    } else {
      await pool.query('INSERT INTO collab_projects (tenant_id,title,description,project_type,max_teams,start_date,end_date,created_by,status) VALUES (?,?,?,?,?,?,?,?,"planning")', [tid,title,description,project_type,max_teams,start_date,end_date,req.session.user.id]);
    }
    res.redirect('/school/collab/projects');
  }));

  app.get('/school/collab/projects/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [proj] = await pool.query('SELECT * FROM collab_projects WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!proj[0]) return res.redirect('/school/collab/projects');
    const [members] = await pool.query('SELECT cpm.*, u.name as user_name FROM collab_project_members cpm LEFT JOIN users u ON u.id=cpm.user_id WHERE cpm.tenant_id=? AND cpm.project_id=?', [tid, req.params.id]);
    const statusColors = {planning:'#3b82f6',active:CG,completed:'#8b5cf6',cancelled:'#9ca3af'};
    res.send(renderPage('Project Detail', `<div style="max-width:900px;margin:0 auto;padding:20px;">
      <a href="/school/collab/projects" style="color:${C};text-decoration:none;">← Back to Projects</a>
      <div style="margin-top:15px;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <div style="display:flex;justify-content:space-between;align-items:start;"><h2 style="color:${C};margin:0;">${esc(proj[0].title)}</h2><span style="background:${statusColors[proj[0].status]}22;color:${statusColors[proj[0].status]};padding:4px 12px;border-radius:12px;font-size:0.85em;font-weight:600;">${proj[0].status}</span></div>
        <p style="color:#6b7280;margin:10px 0;">${esc(proj[0].description||'')}</p>
        <div style="display:flex;gap:15px;font-size:0.85em;color:#6b7280;flex-wrap:wrap;">
          <span>📁 ${proj[0].project_type}</span><span>👥 ${members.length} members</span>
          ${proj[0].start_date?`<span>📅 ${proj[0].start_date} → ${proj[0].end_date||'Ongoing'}</span>`:''}
        </div>
      </div>
      <h3 style="color:${C};margin:20px 0 15px;">👥 Team Members (${members.length})</h3>
      <div style="display:grid;gap:8px;">${members.map(m=>`<div style="background:white;border-radius:8px;padding:12px;border:1px solid #e5e7eb;display:flex;justify-content:space-between;"><div><strong>${esc(m.user_name||'User #'+m.user_id)}</strong><span style="color:#9ca3af;font-size:0.85em;margin-left:8px;">${m.role}</span>${m.team_name?'<span style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-size:0.8em;margin-left:8px;">Team: '+esc(m.team_name)+'</span>':''}</div><span style="color:${m.status==='joined'?CG:CY};">${m.status}</span></div>`).join('')||'<p style="color:#9ca3af;">No members yet</p>'}</div>
      <div style="margin-top:20px;">
        <form method="POST" action="/school/collab/projects/${req.params.id}/invite" style="display:flex;gap:10px;">
          <input name="user_id" placeholder="User ID to invite" required style="flex:1;padding:8px;border:1px solid #d1d5db;border-radius:8px;">
          <input name="team_name" placeholder="Team name (optional)" style="padding:8px;border:1px solid #d1d5db;border-radius:8px;">
          <button type="submit" style="background:${C};color:white;padding:8px 16px;border:none;border-radius:8px;cursor:pointer;">Invite</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  app.post('/school/collab/projects/:id/invite', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('INSERT INTO collab_project_members (tenant_id,project_id,user_id,school_tenant_id,team_name,status) VALUES (?,?,?,?,"invited")', [tid, req.params.id, req.body.user_id, tid, req.body.team_name||'Team 1']);
    res.redirect('/school/collab/projects/'+req.params.id);
  }));

  // ─── Competitions ─────────────────────────────────────────────────
  app.get('/school/collab/competitions', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [comps] = await pool.query('SELECT cc.*, (SELECT COUNT(*) FROM collab_competition_teams WHERE competition_id=cc.id AND tenant_id=cc.tenant_id) as team_count FROM collab_competitions cc WHERE cc.tenant_id=? ORDER BY cc.created_at DESC', [tid]);
    const statusColors = {registration:CG,in_progress:CY,judging:'#8b5cf6',completed:'#3b82f6'};
    res.send(renderPage('Competitions', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="color:${C};">🏆 Competitions</h2>
        <a href="/school/collab/competitions/new" style="background:${CY};color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ New Competition</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:15px;">
        ${comps.map(c=>`<div style="background:white;border-radius:12px;padding:15px;border:1px solid #e5e7eb;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><h3 style="margin:0;">${esc(c.title)}</h3><span style="background:${statusColors[c.status]}22;color:${statusColors[c.status]};padding:2px 8px;border-radius:12px;font-size:0.75em;">${c.status}</span></div>
          <p style="color:#6b7280;font-size:0.85em;margin-bottom:10px;">${esc(c.description||'').substring(0,80)}</p>
          <div style="display:flex;gap:10px;font-size:0.8em;color:#9ca3af;flex-wrap:wrap;"><span>📋 ${c.comp_type}</span><span>👥 ${c.team_count} teams</span><span>📅 ${c.start_date||'TBD'}</span></div>
          <a href="/school/collab/competitions/${c.id}" style="color:${C};text-decoration:none;font-size:0.85em;display:inline-block;margin-top:8px;">View →</a>
        </div>`).join('')||'<p style="color:#6b7280;">No competitions yet</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/collab/competitions/new', requireAuth, ah(async (req, res) => {
    const types = ['quiz','debate','essay','art','sports','coding','music','science'];
    res.send(renderPage('New Competition', `<div style="max-width:700px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">🏆 Create Competition</h2>
      <form method="POST" action="/school/collab/competitions/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Title</label><input name="title" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Description</label><textarea name="description" rows="3" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Type</label><select name="comp_type" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">${types.map(t=>`<option>${t}</option>`).join('')}</select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Format</label><select name="format" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option value="individual">Individual</option><option value="team">Team</option></select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Max Participants</label><input type="number" name="max_participants" value="100" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Start Date</label><input type="date" name="start_date" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">End Date</label><input type="date" name="end_date" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Registration Deadline</label><input type="date" name="registration_deadline" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
        </div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Rules</label><textarea name="rules" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Prizes</label><textarea name="prizes" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <button type="submit" style="background:${CY};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Create Competition</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/collab/competitions/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const {title,description,comp_type,format,max_participants,start_date,end_date,registration_deadline,rules,prizes,id} = req.body;
    if (id) {
      await pool.query('UPDATE collab_competitions SET title=?,description=?,comp_type=?,format=?,max_participants=?,start_date=?,end_date=?,registration_deadline=?,rules=?,prizes=? WHERE id=? AND tenant_id=?', [title,description,comp_type,format,max_participants,start_date,end_date,registration_deadline,rules,prizes,id,tid]);
    } else {
      await pool.query('INSERT INTO collab_competitions (tenant_id,title,description,comp_type,format,max_participants,start_date,end_date,registration_deadline,rules,prizes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)', [tid,title,description,comp_type,format,max_participants,start_date,end_date,registration_deadline,rules,prizes,req.session.user.id]);
    }
    res.redirect('/school/collab/competitions');
  }));

  app.get('/school/collab/competitions/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [comp] = await pool.query('SELECT * FROM collab_competitions WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!comp[0]) return res.redirect('/school/collab/competitions');
    const [teams] = await pool.query('SELECT * FROM collab_competition_teams WHERE tenant_id=? AND competition_id=? ORDER BY rank, score DESC', [tid, req.params.id]);
    const statusColors = {registration:CG,in_progress:CY,judging:'#8b5cf6',completed:'#3b82f6'};
    const c = comp[0];
    res.send(renderPage('Competition Detail', `<div style="max-width:900px;margin:0 auto;padding:20px;">
      <a href="/school/collab/competitions" style="color:${C};text-decoration:none;">← Back</a>
      <div style="margin-top:15px;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <div style="display:flex;justify-content:space-between;"><h2 style="color:${C};">🏆 ${esc(c.title)}</h2><span style="background:${statusColors[c.status]}22;color:${statusColors[c.status]};padding:4px 12px;border-radius:12px;">${c.status}</span></div>
        <p style="color:#6b7280;margin:10px 0;">${esc(c.description||'')}</p>
        <div style="display:flex;gap:15px;font-size:0.85em;color:#6b7280;flex-wrap:wrap;"><span>📋 ${c.comp_type}</span><span>👤 ${c.format}</span><span>👥 ${teams.length} teams</span><span>📅 ${c.start_date||'TBD'}</span></div>
        ${c.rules?`<div style="margin-top:15px;padding:10px;background:#f9fafb;border-radius:8px;"><strong>Rules:</strong><p style="color:#6b7280;font-size:0.85em;margin:5px 0 0;">${esc(c.rules)}</p></div>`:''}
        ${c.prizes?`<div style="margin-top:10px;padding:10px;background:#fef3c7;border-radius:8px;"><strong>Prizes:</strong><p style="color:#92400e;font-size:0.85em;margin:5px 0 0;">${esc(c.prizes)}</p></div>`:''}
      </div>
      <h3 style="color:${C};margin:20px 0 15px;">📊 Leaderboard</h3>
      ${teams.length?`<table style="width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;"><thead><tr style="background:${CBG};"><th style="padding:12px;text-align:left;">Rank</th><th>Team</th><th>Score</th><th>Status</th></tr></thead><tbody>${teams.map((t,i)=>`<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px;">${t.rank||i+1}${i===0?' 🥇':i===1?' 🥈':i===2?' 🥉':''}</td><td style="padding:10px;text-align:center;">${esc(t.team_name)}</td><td style="padding:10px;text-align:center;font-weight:bold;">${t.score}</td><td style="padding:10px;text-align:center;color:${t.status==='winner'?CG:t.status==='eliminated'?CR:'#6b7280'};">${t.status}</td></tr>`).join('')}</tbody></table>`:'<p style="color:#9ca3af;">No teams registered yet</p>'}
    </div>`, req.session.user));
  }));

  // ─── Resources ────────────────────────────────────────────────────
  app.get('/school/collab/resources', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [resources] = await pool.query('SELECT * FROM collab_resources WHERE tenant_id=? ORDER BY created_at DESC', [tid]);
    res.send(renderPage('Shared Resources', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="color:${C};">📂 Shared Resources</h2>
        <a href="/school/collab/resources/share" style="background:${CG};color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">📤 Share Resource</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:15px;">
        ${resources.map(r=>`<div style="background:white;border-radius:12px;padding:15px;border:1px solid #e5e7eb;">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;"><span style="font-size:1.3em;">${r.file_type==='pdf'?'📕':r.file_type==='doc'?'📘':r.file_type==='video'?'🎬':'📄'}</span><strong style="font-size:0.9em;">${esc(r.title)}</strong></div>
          <p style="color:#6b7280;font-size:0.8em;margin-bottom:8px;">${esc(r.description||'').substring(0,80)}</p>
          <div style="display:flex;gap:10px;font-size:0.75em;color:#9ca3af;"><span>📁 ${esc(r.category||'General')}</span><span>⬇ ${r.download_count}</span><span>⭐ ${r.rating||0}</span></div>
        </div>`).join('')||'<p style="color:#6b7280;">No shared resources yet</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/collab/resources/share', requireAuth, ah(async (req, res) => {
    const categories = ['Lesson Plans','Question Banks','Worksheets','Presentations','Videos','Research Papers','Templates','Other'];
    res.send(renderPage('Share Resource', `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">📤 Share Resource</h2>
      <form method="POST" action="/school/collab/resources/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Title</label><input name="title" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Description</label><textarea name="description" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Category</label><select name="category" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">${categories.map(c=>`<option>${c}</option>`).join('')}</select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">File URL</label><input name="file_url" placeholder="https://..." style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        </div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Subject</label><input name="subject" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div><label style="font-weight:600;display:block;margin-bottom:5px;"><input type="checkbox" name="is_public" value="1"> Make publicly available</label></div>
        <button type="submit" style="background:${CG};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;margin-top:10px;">Share Resource</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/collab/resources/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('INSERT INTO collab_resources (tenant_id,title,description,category,file_url,file_type,subject,shared_by,is_public) VALUES (?,?,?,?,?,?,?,?,?)', [tid,req.body.title,req.body.description,req.body.category,req.body.file_url,req.body.file_type||'document',req.body.subject,req.session.user.id,req.body.is_public?1:0]);
    res.redirect('/school/collab/resources');
  }));

  // ─── Forums ───────────────────────────────────────────────────────
  app.get('/school/collab/forums', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [forums] = await pool.query('SELECT cf.*, u.name as author_name FROM collab_forums cf LEFT JOIN users u ON u.id=cf.created_by WHERE cf.tenant_id=? AND cf.status="active" ORDER BY cf.last_activity DESC', [tid]);
    res.send(renderPage('Forums', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="color:${C};">💬 Discussion Forums</h2>
        <a href="/school/collab/forums/new" style="background:#7c3aed;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ New Topic</a>
      </div>
      <div style="display:grid;gap:12px;">
        ${forums.map(f=>`<div style="background:white;border-radius:10px;padding:15px;border:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
          <div><h4 style="margin:0 0 5px;color:#1f2937;">${esc(f.topic)}</h4><p style="color:#6b7280;font-size:0.85em;margin:0;">${esc(f.description||'').substring(0,100)} ${f.author_name?'• by '+esc(f.author_name):''}</p></div>
          <div style="text-align:right;font-size:0.8em;color:#9ca3af;"><div>${f.post_count||0} posts</div>${f.last_activity?'<div>'+new Date(f.last_activity).toLocaleDateString()+'</div>':''}</div>
        </div>`).join('')||'<p style="color:#6b7280;">No forum topics yet. Start a discussion!</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/collab/forums/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('New Topic', `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">💬 New Discussion Topic</h2>
      <form method="POST" action="/school/collab/forums/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Topic</label><input name="topic" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Description</label><textarea name="description" rows="3" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Category</label><select name="category" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option>General</option><option>Academic</option><option>Sports</option><option>Arts</option><option>Technology</option><option>Culture</option></select></div>
        <button type="submit" style="background:#7c3aed;color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Create Topic</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/collab/forums/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [result] = await pool.query('INSERT INTO collab_forums (tenant_id,topic,description,category,is_cross_school,created_by,last_activity) VALUES (?,?,?,?,1,?,NOW())', [tid,req.body.topic,req.body.description,req.body.category,req.session.user.id]);
    res.redirect('/school/collab/forums/'+result.insertId);
  }));

  app.get('/school/collab/forums/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [forum] = await pool.query('SELECT cf.*, u.name as author_name FROM collab_forums cf LEFT JOIN users u ON u.id=cf.created_by WHERE cf.id=? AND cf.tenant_id=?', [req.params.id, tid]);
    if (!forum[0]) return res.redirect('/school/collab/forums');
    const [posts] = await pool.query('SELECT cfp.*, u.name as author_name FROM collab_forum_posts cfp LEFT JOIN users u ON u.id=cfp.author_id WHERE cfp.tenant_id=? AND cfp.forum_id=? AND cfp.parent_post_id IS NULL ORDER BY cfp.is_pinned DESC, cfp.created_at', [tid, req.params.id]);
    res.send(renderPage('Forum Thread', `<div style="max-width:900px;margin:0 auto;padding:20px;">
      <a href="/school/collab/forums" style="color:${C};text-decoration:none;">← Back to Forums</a>
      <div style="margin-top:15px;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="color:${C};margin:0 0 5px;">${esc(forum[0].topic)}</h2>
        <p style="color:#6b7280;font-size:0.85em;">${esc(forum[0].description||'')} • ${posts.length} posts</p>
      </div>
      <div style="margin-top:20px;display:grid;gap:12px;">
        ${posts.map(p=>`<div style="background:${p.is_pinned?'#fef3c7':'white'};border-radius:10px;padding:15px;border:1px solid #e5e7eb;">
          <div style="display:flex;justify-content:space-between;margin-bottom:8px;"><strong style="font-size:0.9em;">${esc(p.author_name||'User')}</strong><span style="color:#9ca3af;font-size:0.8em;">${new Date(p.created_at).toLocaleString()} ${p.is_pinned?'📌':''}</span></div>
          <p style="color:#374151;font-size:0.9em;margin:0;white-space:pre-wrap;">${esc(p.content)}</p>
          <div style="margin-top:8px;color:#9ca3af;font-size:0.8em;">👍 ${p.likes} likes</div>
        </div>`).join('')||'<p style="color:#9ca3af;">No posts yet. Be the first to respond!</p>'}
      </div>
      <div style="margin-top:20px;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h3 style="color:${C};margin:0 0 10px;">Reply</h3>
        <form method="POST" action="/school/collab/forums/${req.params.id}/reply">
          <textarea name="content" rows="3" required placeholder="Write your response..." style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea>
          <button type="submit" style="background:#7c3aed;color:white;padding:8px 16px;border:none;border-radius:8px;cursor:pointer;margin-top:10px;">Post Reply</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  app.post('/school/collab/forums/:id/reply', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('INSERT INTO collab_forum_posts (tenant_id,forum_id,author_id,content) VALUES (?,?,?,?)', [tid,req.params.id,req.session.user.id,req.body.content]);
    await pool.query('UPDATE collab_forums SET post_count=post_count+1, last_activity=NOW() WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    res.redirect('/school/collab/forums/'+req.params.id);
  }));

  // ─── Knowledge Base ───────────────────────────────────────────────
  app.get('/school/collab/knowledge', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [articles] = await pool.query('SELECT ka.*, u.name as author_name FROM collab_knowledge_articles ka LEFT JOIN users u ON u.id=ka.author_id WHERE ka.tenant_id=? AND ka.status="published" ORDER BY ka.created_at DESC', [tid]);
    res.send(renderPage('Knowledge Base', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="color:${C};">📚 Knowledge Base</h2>
        <a href="/school/collab/knowledge/new" style="background:#0891b2;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ Write Article</a>
      </div>
      <div style="display:grid;gap:12px;">
        ${articles.map(a=>`<div style="background:white;border-radius:10px;padding:15px;border:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center;">
          <div><h4 style="margin:0 0 5px;">${esc(a.title)}</h4><div style="color:#6b7280;font-size:0.8em;">${esc(a.category||'General')} • by ${esc(a.author_name||'Unknown')} • 👁 ${a.views} • 👍 ${a.likes}</div></div>
          <a href="/school/collab/knowledge/${a.id}" style="color:${C};text-decoration:none;">Read →</a>
        </div>`).join('')||'<p style="color:#6b7280;">No articles yet. Share your knowledge!</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/collab/knowledge/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Write Article', `<div style="max-width:800px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">📚 Write Knowledge Article</h2>
      <form method="POST" action="/school/collab/knowledge/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Title</label><input name="title" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Category</label><input name="category" placeholder="e.g., Mathematics, Teaching Tips" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Tags (comma-separated)</label><input name="tags" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        </div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Content</label><textarea name="content" rows="10" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <button type="submit" style="background:#0891b2;color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Publish Article</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/collab/knowledge/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tags = req.body.tags ? JSON.stringify(req.body.tags.split(',').map(t=>t.trim())) : '[]';
    await pool.query('INSERT INTO collab_knowledge_articles (tenant_id,title,content,category,tags,author_id,status) VALUES (?,?,?,?,?,?,"published")', [tid,req.body.title,req.body.content,req.body.category,tags,req.session.user.id]);
    res.redirect('/school/collab/knowledge');
  }));

  app.get('/school/collab/knowledge/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [article] = await pool.query('SELECT ka.*, u.name as author_name FROM collab_knowledge_articles ka LEFT JOIN users u ON u.id=ka.author_id WHERE ka.id=? AND ka.tenant_id=?', [req.params.id, tid]);
    if (!article[0]) return res.redirect('/school/collab/knowledge');
    await pool.query('UPDATE collab_knowledge_articles SET views=views+1 WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    const a = article[0];
    res.send(renderPage('Article', `<div style="max-width:800px;margin:0 auto;padding:20px;">
      <a href="/school/collab/knowledge" style="color:${C};text-decoration:none;">← Back to Knowledge Base</a>
      <article style="margin-top:15px;background:white;border-radius:12px;padding:25px;border:1px solid #e5e7eb;">
        <h1 style="color:${C};margin:0 0 10px;">${esc(a.title)}</h1>
        <div style="color:#6b7280;font-size:0.85em;margin-bottom:20px;padding-bottom:15px;border-bottom:1px solid #f3f4f6;">${esc(a.category||'General')} • by ${esc(a.author_name||'Unknown')} • ${new Date(a.created_at).toLocaleDateString()} • 👁 ${a.views} views • 👍 ${a.likes} likes • v${a.version}</div>
        <div style="color:#374151;line-height:1.8;white-space:pre-wrap;">${esc(a.content)}</div>
      </article>
    </div>`, req.session.user));
  }));

  // ─── Messages ─────────────────────────────────────────────────────
  app.get('/school/collab/messages', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [threads] = await pool.query('SELECT DISTINCT cm.thread_id, cm.content, cm.created_at, CASE WHEN cm.sender_id=? THEN cm.recipient_id ELSE cm.sender_id END as other_id FROM collab_messages cm WHERE cm.tenant_id=? AND (cm.sender_id=? OR cm.recipient_id=?) ORDER BY cm.created_at DESC LIMIT 50', [uid, tid, uid, uid]);
    res.send(renderPage('Messages', `<div style="max-width:900px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">✉️ Cross-School Messages</h2>
      <div style="display:grid;gap:8px;">
        ${threads.map(t=>`<div style="background:white;border-radius:10px;padding:12px;border:1px solid #e5e7eb;cursor:pointer;">
          <div style="display:flex;justify-content:space-between;"><strong style="font-size:0.9em;">User #${t.other_id}</strong><span style="color:#9ca3af;font-size:0.8em;">${new Date(t.created_at).toLocaleString()}</span></div>
          <p style="color:#6b7280;font-size:0.85em;margin:5px 0 0;">${esc(t.content).substring(0,80)}...</p>
        </div>`).join('')||'<p style="color:#9ca3af;">No messages yet. Start a cross-school conversation!</p>'}
      </div>
      <div style="margin-top:20px;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h3 style="color:${C};margin:0 0 10px;">Send Message</h3>
        <form method="POST" action="/school/collab/messages/send">
          <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px;margin-bottom:10px;">
            <input name="recipient_id" placeholder="Recipient User ID" required style="padding:8px;border:1px solid #d1d5db;border-radius:8px;">
            <input name="recipient_tenant_id" placeholder="Recipient School/Tenant ID" required style="padding:8px;border:1px solid #d1d5db;border-radius:8px;">
          </div>
          <textarea name="content" rows="2" required placeholder="Your message..." style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea>
          <button type="submit" style="background:${CR};color:white;padding:8px 16px;border:none;border-radius:8px;cursor:pointer;margin-top:10px;">Send</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  app.post('/school/collab/messages/send', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const threadId = [req.session.user.id, req.body.recipient_id].sort().join('-') + '_' + [tid, req.body.recipient_tenant_id].sort().join('-');
    await pool.query('INSERT INTO collab_messages (tenant_id,thread_id,sender_id,sender_tenant_id,recipient_id,recipient_tenant_id,content) VALUES (?,?,?,?,?,?,?)', [tid, threadId, req.session.user.id, tid, req.body.recipient_id, req.body.recipient_tenant_id, req.body.content]);
    res.redirect('/school/collab/messages');
  }));

  // ─── Exchange Programs ────────────────────────────────────────────
  app.get('/school/collab/exchange', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [pairs] = await pool.query('SELECT * FROM collab_exchange_pairs WHERE tenant_id=? ORDER BY created_at DESC', [tid]);
    res.send(renderPage('Exchange Programs', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">🔄 Virtual Exchange Programs</h2>
      <div style="display:grid;gap:12px;">
        ${pairs.map(p=>`<div style="background:white;border-radius:10px;padding:15px;border:1px solid #e5e7eb;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <div><strong>${esc(p.program_name)}</strong><div style="color:#6b7280;font-size:0.85em;">Student A (#${p.student_a_id}) ↔ Student B (#${p.student_b_id})</div><div style="color:#9ca3af;font-size:0.8em;">${p.start_date} → ${p.end_date} • ${p.status}</div></div>
          </div>
        </div>`).join('')||'<p style="color:#6b7280;">No exchange programs yet</p>'}
      </div>
    </div>`, req.session.user));
  }));

  // ─── Events ───────────────────────────────────────────────────────
  app.get('/school/collab/events', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [events] = await pool.query('SELECT * FROM collab_events WHERE tenant_id=? ORDER BY event_date', [tid]);
    res.send(renderPage('Events', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">📅 Shared Events</h2>
      <div style="display:grid;gap:12px;">
        ${events.map(e=>`<div style="background:white;border-radius:10px;padding:15px;border:1px solid #e5e7eb;">
          <div style="display:flex;justify-content:space-between;"><h4 style="margin:0;">${esc(e.title)}</h4><span style="color:${e.status==='upcoming'?CG:e.status==='ongoing'?CY:'#9ca3af'};">${e.status}</span></div>
          <p style="color:#6b7280;font-size:0.85em;">${esc(e.description||'').substring(0,100)}</p>
          <div style="font-size:0.8em;color:#9ca3af;margin-top:5px;">${e.event_date} ${e.event_time||''} • ${esc(e.venue||'TBD')} • 👥 ${e.registered_count}/${e.max_capacity||'∞'}</div>
        </div>`).join('')||'<p style="color:#6b7280;">No shared events</p>'}
      </div>
    </div>`, req.session.user));
  }));

  console.log('[CrossSchoolCollab] Module loaded — projects, competitions, resources, forums, knowledge base, messaging');
};
