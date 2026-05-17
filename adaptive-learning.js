module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const C = '#6366f1'; const CL = '#818cf8'; const CBG = '#eef2ff'; const CG = '#059669'; const CR = '#dc2626'; const CY = '#d97706';
  const MASTERY_LEVELS = [{name:'Novice',color:'#9ca3af',min:0},{name:'Apprentice',color:'#cd7f32',min:20},{name:'Proficient',color:'#c0c0c0',min:50},{name:'Expert',color:'#ffd700',min:75},{name:'Master',color:'#b45309',min:95}];

  // ─── Tables ───────────────────────────────────────────────────────
  async function initTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS learning_paths (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(200), subject VARCHAR(100), description TEXT, difficulty VARCHAR(20) DEFAULT 'beginner', estimated_hours INT DEFAULT 10, module_count INT DEFAULT 0, status ENUM('draft','published','archived') DEFAULT 'draft', cover_color VARCHAR(7) DEFAULT '#6366f1', created_by INT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_tenant (tenant_id), INDEX idx_subject (tenant_id, subject))`,
      `CREATE TABLE IF NOT EXISTS path_modules (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NOT NULL, path_id INT, title VARCHAR(200), description TEXT, module_order INT DEFAULT 0, prerequisite_module_id INT, estimated_minutes INT DEFAULT 30, difficulty VARCHAR(20) DEFAULT 'medium', resource_urls JSON, objectives JSON, status ENUM('draft','published') DEFAULT 'draft', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_tenant (tenant_id), INDEX idx_path (tenant_id, path_id), INDEX idx_order (tenant_id, path_id, module_order))`,
      `CREATE TABLE IF NOT EXISTS skill_tree (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NOT NULL, skill_name VARCHAR(150), skill_code VARCHAR(50) UNIQUE, subject VARCHAR(100), description TEXT, parent_skill_id INT, difficulty_level INT DEFAULT 1, points_required INT DEFAULT 100, icon VARCHAR(10) DEFAULT '🎯', color VARCHAR(7) DEFAULT '#6366f1', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_tenant (tenant_id), INDEX idx_parent (tenant_id, parent_skill_id))`,
      `CREATE TABLE IF NOT EXISTS student_skills (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL, skill_id INT NOT NULL, mastery_level INT DEFAULT 0, total_xp INT DEFAULT 0, assessments_taken INT DEFAULT 0, avg_score DECIMAL(5,2) DEFAULT 0, status ENUM('locked','in_progress','mastered') DEFAULT 'locked', unlocked_at DATETIME, mastered_at DATETIME, last_practiced_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uk_student_skill (tenant_id, student_id, skill_id), INDEX idx_tenant (tenant_id), INDEX idx_student (tenant_id, student_id))`,
      `CREATE TABLE IF NOT EXISTS adaptive_assessments (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NOT NULL, student_id INT, path_id INT, module_id INT, skill_id INT, assessment_type ENUM('placement','micro','summative','practice') DEFAULT 'micro', total_questions INT DEFAULT 10, correct_count INT DEFAULT 0, score DECIMAL(5,2) DEFAULT 0, difficulty_level VARCHAR(20), time_taken_seconds INT DEFAULT 0, status ENUM('in_progress','completed','abandoned') DEFAULT 'in_progress', started_at DATETIME DEFAULT CURRENT_TIMESTAMP, completed_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_tenant (tenant_id), INDEX idx_student (tenant_id, student_id), INDEX idx_path (tenant_id, path_id))`,
      `CREATE TABLE IF NOT EXISTS assessment_questions (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NOT NULL, assessment_id INT, question_text TEXT, question_type ENUM('mcq','true_false','fill_blank','short_answer') DEFAULT 'mcq', options JSON, correct_answer TEXT, student_answer TEXT, is_correct TINYINT(1) DEFAULT 0, points INT DEFAULT 10, difficulty VARCHAR(20) DEFAULT 'medium', question_order INT DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_tenant (tenant_id), INDEX idx_assessment (tenant_id, assessment_id))`,
      `CREATE TABLE IF NOT EXISTS learning_progress (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL, path_id INT, module_id INT, status ENUM('not_started','in_progress','completed') DEFAULT 'not_started', progress_percent INT DEFAULT 0, time_spent_seconds INT DEFAULT 0, attempts INT DEFAULT 0, best_score DECIMAL(5,2) DEFAULT 0, last_accessed_at DATETIME, completed_at DATETIME, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, UNIQUE KEY uk_student_module (tenant_id, student_id, module_id), INDEX idx_tenant (tenant_id), INDEX idx_student (tenant_id, student_id))`,
      `CREATE TABLE IF NOT EXISTS intervention_alerts (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NOT NULL, student_id INT, alert_type ENUM('stuck','declining','absent','at_risk') DEFAULT 'stuck', severity ENUM('low','medium','high','critical') DEFAULT 'medium', message TEXT, skill_id INT, path_id INT, module_id INT, assigned_teacher_id INT, status ENUM('active','acknowledged','resolved','dismissed') DEFAULT 'active', resolved_at DATETIME, resolution_notes TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, INDEX idx_tenant (tenant_id), INDEX idx_student (tenant_id, student_id), INDEX idx_status (tenant_id, status))`,
      `CREATE TABLE IF NOT EXISTS learning_goals (id INT AUTO_INCREMENT PRIMARY KEY, tenant_id INT NOT NULL, student_id INT, goal_title VARCHAR(200), goal_description TEXT, target_skill_id INT, target_mastery INT DEFAULT 100, target_date DATE, current_progress INT DEFAULT 0, status ENUM('not_started','in_progress','achieved','abandoned') DEFAULT 'in_progress', milestones JSON, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP, INDEX idx_tenant (tenant_id), INDEX idx_student (tenant_id, student_id))`
    ];
    for (const sql of tables) { try { await pool.query(sql); } catch(e) { console.warn('[AdaptiveLearning] Table error:', e.message); } }
  }
  initTables();

  // ─── Dashboard ────────────────────────────────────────────────────
  app.get('/school/adaptive-learning', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const role = req.session.user.role;
    const [paths] = await pool.query('SELECT COUNT(*) as c FROM learning_paths WHERE tenant_id=? AND status="published"', [tid]);
    const [skills] = await pool.query('SELECT COUNT(*) as c FROM student_skills WHERE tenant_id=? AND student_id=?', [tid, uid]);
    const [inProg] = await pool.query('SELECT COUNT(*) as c FROM learning_progress WHERE tenant_id=? AND student_id=? AND status="in_progress"', [tid, uid]);
    const [completed] = await pool.query('SELECT COUNT(*) as c FROM learning_progress WHERE tenant_id=? AND student_id=? AND status="completed"', [tid, uid]);
    const [alerts] = await pool.query('SELECT COUNT(*) as c FROM intervention_alerts WHERE tenant_id=? AND student_id=? AND status="active"', [tid, uid]);
    const [recentModules] = await pool.query('SELECT lp.id,lp.title,lp.subject,lp.progress_percent,lp.last_accessed_at FROM learning_progress lp WHERE lp.tenant_id=? AND lp.student_id=? AND lp.status="in_progress" ORDER BY lp.last_accessed_at DESC LIMIT 5', [tid, uid]);
    const mastery = MASTERY_LEVELS;
    res.send(renderPage('Adaptive Learning', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">🎯 Adaptive Learning Dashboard</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:25px;">
        ${[{l:'Published Paths',v:paths[0].c,c:C},{l:'Skills Unlocked',v:skills[0].c,c:'#059669'},{l:'In Progress',v:inProg[0].c,c:CY},{l:'Completed',v:completed[0].c,c:CG},{l:'Active Alerts',v:alerts[0].c,c:CR}].map(s=>`<div style="background:${CBG};border-radius:12px;padding:20px;text-align:center;"><div style="font-size:2em;font-weight:bold;color:${s.c};">${s.v}</div><div style="color:#6b7280;font-size:0.9em;">${s.l}</div></div>`).join('')}
      </div>
      <h3 style="color:${C};margin-bottom:15px;">📊 Mastery Levels</h3>
      <div style="display:flex;gap:15px;margin-bottom:25px;flex-wrap:wrap;">
        ${mastery.map(m=>`<div style="background:white;border:2px solid ${m.color};border-radius:10px;padding:12px 20px;text-align:center;min-width:100px;"><div style="width:40px;height:40px;border-radius:50%;background:${m.color};margin:0 auto 8px;display:flex;align-items:center;justify-content:center;color:white;font-weight:bold;">${m.min}</div><div style="font-weight:600;font-size:0.85em;">${m.name}</div><div style="color:#9ca3af;font-size:0.75em;">${m.min}%+</div></div>`).join('')}
      </div>
      ${recentModules.length?`<h3 style="color:${C};margin-bottom:15px;">📚 Continue Learning</h3><div style="display:grid;gap:12px;">${recentModules.map(m=>`<div style="background:white;border-radius:10px;padding:15px;border-left:4px solid ${C};display:flex;justify-content:space-between;align-items:center;"><div><strong>${esc(m.title)}</strong><div style="color:#6b7280;font-size:0.85em;">${esc(m.subject)} • Last accessed: ${m.last_accessed_at?new Date(m.last_accessed_at).toLocaleDateString():'Never'}</div></div><div style="display:flex;align-items:center;gap:10px;"><div style="background:#f3f4f6;border-radius:20px;height:8px;width:120px;"><div style="background:${CG};border-radius:20px;height:8px;width:${m.progress_percent}%;"></div></div><span style="font-weight:600;color:${C};">${m.progress_percent}%</span></div></div>`).join('')}</div>`:'<p style="color:#6b7280;">No modules in progress yet. Start a learning path below!</p>'}
      <div style="margin-top:20px;display:flex;gap:10px;flex-wrap:wrap;">
        <a href="/school/adaptive-learning/paths" class="btn" style="background:${C};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">📖 Browse Paths</a>
        <a href="/school/adaptive-learning/skill-tree" class="btn" style="background:#059669;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">🌳 Skill Tree</a>
        <a href="/school/adaptive-learning/analytics" class="btn" style="background:${CY};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">📈 Analytics</a>
        ${role==='teacher'||role==='admin'?`<a href="/school/adaptive-learning/teacher" class="btn" style="background:#7c3aed;color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">👨‍🏫 Teacher View</a>`:''}
      </div>
    </div>`, req.session.user));
  }));

  // ─── Learning Paths ───────────────────────────────────────────────
  app.get('/school/adaptive-learning/paths', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [paths] = await pool.query('SELECT lp.*, (SELECT COUNT(*) FROM path_modules WHERE tenant_id=lp.tenant_id AND path_id=lp.id) as mods FROM learning_paths lp WHERE lp.tenant_id=? ORDER BY lp.created_at DESC', [tid]);
    res.send(renderPage('Learning Paths', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="color:${C};">📖 Learning Paths</h2>
        <a href="/school/adaptive-learning/paths/new" style="background:${C};color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ New Path</a>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:15px;">
        ${paths.map(p=>`<div style="background:white;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
          <div style="height:8px;background:${p.cover_color||C};"></div>
          <div style="padding:15px;">
            <div style="display:flex;justify-content:space-between;align-items:start;">
              <h3 style="margin:0 0 8px;color:#1f2937;">${esc(p.title)}</h3>
              <span style="background:${p.status==='published'?'#dcfce7':'#fef3c7'};color:${p.status==='published'?'#059669':'#d97706'};padding:2px 8px;border-radius:12px;font-size:0.75em;">${p.status}</span>
            </div>
            <p style="color:#6b7280;font-size:0.85em;margin-bottom:10px;">${esc(p.description||'')}</p>
            <div style="display:flex;gap:10px;font-size:0.8em;color:#9ca3af;">
              <span>📚 ${p.subject||'General'}</span>
              <span>📦 ${p.mods} modules</span>
              <span>⏱ ${p.estimated_hours}h</span>
              <span>📊 ${p.difficulty}</span>
            </div>
            <div style="margin-top:10px;display:flex;gap:8px;">
              <a href="/school/adaptive-learning/paths/${p.id}" style="color:${C};text-decoration:none;font-size:0.85em;">View</a>
              <a href="/school/adaptive-learning/paths/${p.id}/edit" style="color:#6b7280;text-decoration:none;font-size:0.85em;">Edit</a>
            </div>
          </div>
        </div>`).join('')||'<p style="color:#6b7280;grid-column:1/-1;">No learning paths yet. Create your first one!</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/adaptive-learning/paths/new', requireAuth, ah(async (req, res) => {
    const subjects = ['Mathematics','English','Science','Physics','Chemistry','Biology','History','Geography','Computer Science','Art','Music','Physical Education'];
    res.send(renderPage('New Learning Path', `<div style="max-width:700px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">➕ Create Learning Path</h2>
      <form method="POST" action="/school/adaptive-learning/paths/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Title</label><input name="title" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Subject</label><select name="subject" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">${subjects.map(s=>`<option value="${s}">${s}</option>`).join('')}</select></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Description</label><textarea name="description" rows="3" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Difficulty</label><select name="difficulty" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Estimated Hours</label><input type="number" name="estimated_hours" value="10" min="1" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
        </div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Cover Color</label><input type="color" name="cover_color" value="#6366f1" style="width:60px;height:40px;border:none;cursor:pointer;"></div>
        <div style="display:flex;gap:10px;"><button type="submit" style="background:${C};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Create Path</button><a href="/school/adaptive-learning/paths" style="padding:10px 20px;color:#6b7280;text-decoration:none;">Cancel</a></div>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/adaptive-learning/paths/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const {title, subject, description, difficulty, estimated_hours, cover_color, id} = req.body;
    if (id) {
      await pool.query('UPDATE learning_paths SET title=?, subject=?, description=?, difficulty=?, estimated_hours=?, cover_color=?, updated_at=NOW() WHERE id=? AND tenant_id=?', [title, subject, description, difficulty, estimated_hours, cover_color, id, tid]);
    } else {
      await pool.query('INSERT INTO learning_paths (tenant_id, title, subject, description, difficulty, estimated_hours, cover_color, created_by) VALUES (?,?,?,?,?,?,?,?)', [tid, title, subject, description, difficulty, estimated_hours, cover_color, uid]);
    }
    res.redirect('/school/adaptive-learning/paths');
  }));

  app.get('/school/adaptive-learning/paths/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [path] = await pool.query('SELECT * FROM learning_paths WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!path[0]) return res.redirect('/school/adaptive-learning/paths');
    const [modules] = await pool.query('SELECT * FROM path_modules WHERE tenant_id=? AND path_id=? ORDER BY module_order', [tid, req.params.id]);
    const uid = req.session.user.id;
    const [progress] = await pool.query('SELECT module_id, status, progress_percent, best_score FROM learning_progress WHERE tenant_id=? AND student_id=? AND module_id IN (SELECT id FROM path_modules WHERE tenant_id=? AND path_id=?)', [tid, uid, tid, req.params.id]);
    const progMap = {};
    progress.forEach(p => { progMap[p.module_id] = p; });
    res.send(renderPage('Path Detail', `<div style="max-width:900px;margin:0 auto;padding:20px;">
      <a href="/school/adaptive-learning/paths" style="color:${C};text-decoration:none;">← Back to Paths</a>
      <div style="margin-top:15px;background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
        <h2 style="color:${C};margin-bottom:5px;">${esc(path[0].title)}</h2>
        <p style="color:#6b7280;">${esc(path[0].description||'')} • ${path[0].difficulty} • ${path[0].estimated_hours}h estimated</p>
      </div>
      <h3 style="color:${C};margin:20px 0 15px;">📦 Modules (${modules.length})</h3>
      <div style="display:grid;gap:12px;">
        ${modules.map((m,i) => {
          const p = progMap[m.id] || {status:'not_started', progress_percent:0, best_score:0};
          const colors = {not_started:'#e5e7eb',in_progress:C,completed:CG};
          return `<div style="background:white;border-radius:10px;padding:15px;border-left:4px solid ${colors[p.status]||'#e5e7eb'};display:flex;justify-content:space-between;align-items:center;">
            <div><span style="color:#9ca3af;font-weight:bold;margin-right:10px;">#${i+1}</span><strong>${esc(m.title)}</strong><div style="color:#6b7280;font-size:0.8em;margin-top:4px;">${esc(m.description||'')} • ${m.estimated_minutes}min • ${m.difficulty}</div></div>
            <div style="display:flex;align-items:center;gap:10px;">
              <div style="background:#f3f4f6;border-radius:20px;height:6px;width:80px;"><div style="background:${colors[p.status]};border-radius:20px;height:6px;width:${p.progress_percent}%;"></div></div>
              <span style="font-size:0.85em;color:${colors[p.status]};font-weight:600;">${p.status==='completed'?'✓ '+p.best_score+'%':p.status==='in_progress'?p.progress_percent+'%':'Start'}</span>
              ${p.status!=='completed'?`<a href="/school/adaptive-learning/assess/start?module_id=${m.id}&path_id=${path[0].id}" style="background:${C};color:white;text-decoration:none;padding:5px 12px;border-radius:6px;font-size:0.85em;">Study</a>`:''}
            </div>
          </div>`;
        }).join('')||'<p style="color:#6b7280;">No modules in this path yet.</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/adaptive-learning/paths/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [path] = await pool.query('SELECT * FROM learning_paths WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!path[0]) return res.redirect('/school/adaptive-learning/paths');
    const p = path[0];
    const subjects = ['Mathematics','English','Science','Physics','Chemistry','Biology','History','Geography','Computer Science','Art','Music','Physical Education'];
    res.send(renderPage('Edit Path', `<div style="max-width:700px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">✏️ Edit Learning Path</h2>
      <form method="POST" action="/school/adaptive-learning/paths/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <input type="hidden" name="id" value="${p.id}">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Title</label><input name="title" value="${esc(p.title)}" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Subject</label><select name="subject" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">${subjects.map(s=>`<option value="${s}" ${s===p.subject?'selected':''}>${s}</option>`).join('')}</select></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Description</label><textarea name="description" rows="3" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;">${esc(p.description||'')}</textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Difficulty</label><select name="difficulty" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option value="beginner" ${p.difficulty==='beginner'?'selected':''}>Beginner</option><option value="intermediate" ${p.difficulty==='intermediate'?'selected':''}>Intermediate</option><option value="advanced" ${p.difficulty==='advanced'?'selected':''}>Advanced</option></select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Estimated Hours</label><input type="number" name="estimated_hours" value="${p.estimated_hours}" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
        </div>
        <button type="submit" style="background:${C};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Save Changes</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/adaptive-learning/paths/:id/delete', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM learning_paths WHERE id=? AND tenant_id=?', [req.params.id, req.session.user.tenant_id]);
    res.redirect('/school/adaptive-learning/paths');
  }));

  // ─── Module Management ────────────────────────────────────────────
  app.get('/school/adaptive-learning/modules/:pathId/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [path] = await pool.query('SELECT title FROM learning_paths WHERE id=? AND tenant_id=?', [req.params.pathId, tid]);
    if (!path[0]) return res.redirect('/school/adaptive-learning/paths');
    const [existing] = await pool.query('SELECT id,title,module_order FROM path_modules WHERE tenant_id=? AND path_id=? ORDER BY module_order', [tid, req.params.pathId]);
    res.send(renderPage('Add Module', `<div style="max-width:700px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">➕ Add Module to "${esc(path[0].title)}"</h2>
      <form method="POST" action="/school/adaptive-learning/modules/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <input type="hidden" name="path_id" value="${req.params.pathId}">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Module Title</label><input name="title" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Description</label><textarea name="description" rows="3" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Order</label><input type="number" name="module_order" value="${existing.length+1}" min="1" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Duration (min)</label><input type="number" name="estimated_minutes" value="30" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Difficulty</label><select name="difficulty" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option>easy</option><option selected>medium</option><option>hard</option></select></div>
        </div>
        <button type="submit" style="background:${C};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Add Module</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/adaptive-learning/modules/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const {title, description, path_id, module_order, estimated_minutes, difficulty, prerequisite_module_id, id} = req.body;
    if (id) {
      await pool.query('UPDATE path_modules SET title=?, description=?, module_order=?, estimated_minutes=?, difficulty=? WHERE id=? AND tenant_id=?', [title, description, module_order, estimated_minutes, difficulty, id, tid]);
    } else {
      await pool.query('INSERT INTO path_modules (tenant_id, path_id, title, description, module_order, estimated_minutes, difficulty, prerequisite_module_id, status) VALUES (?,?,?,?,?,?,?,?,"published")', [tid, path_id, title, description, module_order, estimated_minutes, difficulty, prerequisite_module_id||null]);
    }
    res.redirect('/school/adaptive-learning/paths/'+path_id);
  }));

  // ─── Skill Tree ───────────────────────────────────────────────────
  app.get('/school/adaptive-learning/skill-tree', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [skills] = await pool.query('SELECT st.*, COALESCE(ss.mastery_level,0) as student_mastery, ss.status as student_status FROM skill_tree st LEFT JOIN student_skills ss ON ss.skill_id=st.id AND ss.student_id=? AND ss.tenant_id=st.tenant_id WHERE st.tenant_id=? ORDER BY st.difficulty_level, st.skill_name', [uid, tid]);
    const [progress] = await pool.query('SELECT COUNT(*) as total, SUM(CASE WHEN mastery_level>=95 THEN 1 ELSE 0 END) as mastered FROM student_skills WHERE tenant_id=? AND student_id=?', [tid, uid]);
    res.send(renderPage('Skill Tree', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:5px;">🌳 Skill Tree</h2>
      <p style="color:#6b7280;margin-bottom:20px;">${progress[0].mastered||0} of ${progress[0].total||0} skills mastered</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:15px;">
        ${skills.map(s => {
          const ml = MASTERY_LEVELS.find(m=>s.student_mastery>=m.min) || MASTERY_LEVELS[0];
          const locked = s.student_status==='locked';
          return `<div style="background:${locked?'#f9fafb':'white'};border-radius:12px;padding:15px;border:2px solid ${ml.color};${locked?'opacity:0.5;':''}">
            <div style="font-size:1.5em;margin-bottom:5px;">${locked?'🔒':s.icon||'🎯'}</div>
            <strong style="font-size:0.9em;">${esc(s.skill_name)}</strong>
            <div style="color:#6b7280;font-size:0.75em;margin:4px 0;">${esc(s.subject||'General')} • Level ${s.difficulty_level}</div>
            <div style="background:#f3f4f6;border-radius:20px;height:6px;margin-top:8px;"><div style="background:${ml.color};border-radius:20px;height:6px;width:${s.student_mastery}%;"></div></div>
            <div style="display:flex;justify-content:space-between;font-size:0.75em;margin-top:4px;"><span style="color:${ml.color};">${ml.name}</span><span>${s.student_mastery}%</span></div>
          </div>`;
        }).join('')||'<p style="color:#6b7280;">No skills defined yet. Teachers can add skills from the admin panel.</p>'}
      </div>
    </div>`, req.session.user));
  }));

  // ─── Adaptive Assessment ──────────────────────────────────────────
  const SAMPLE_QS = {
    math_easy: [{q:'What is 7 × 8?',opts:['54','56','58','64'],a:1},{q:'What is 15 + 27?',opts:['40','42','44','38'],a:1},{q:'What is 100 - 37?',opts:['63','67','73','57'],a:0},{q:'What is 144 ÷ 12?',opts:['11','12','13','14'],a:1},{q:'Round 3.7 to the nearest whole number',opts:['3','4','3.5','3.7'],a:1}],
    math_medium: [{q:'Solve: 3x + 7 = 22',opts:['x=3','x=4','x=5','x=6'],a:2},{q:'What is the area of a triangle with base 10 and height 6?',opts:['60','30','16','20'],a:1},{q:'What is 25% of 360?',opts:['80','90','85','95'],a:1},{q:'Simplify: 2(3x - 4) + x',opts:['7x-8','7x-4','6x-8','5x-4'],a:0},{q:'What is the square root of 169?',opts:['11','12','13','14'],a:2}],
    math_hard: [{q:'If f(x) = 2x² - 3x + 1, what is f(3)?',opts:['10','12','8','14'],a:0},{q:'Solve: x² - 5x + 6 = 0',opts:['x=1,6','x=2,3','x=-2,-3','x=1,5'],a:1},{q:'What is log₂(64)?',opts:['5','6','7','8'],a:1},{q:'What is the sum of interior angles of a hexagon?',opts:['540°','720°','900°','360°'],a:1},{q:'If sin θ = 0.5, what is θ in degrees?',opts:['30°','45°','60°','90°'],a:0}],
    science_easy: [{q:'What planet is known as the Red Planet?',opts:['Venus','Mars','Jupiter','Saturn'],a:1},{q:'What gas do plants absorb?',opts:['Oxygen','Nitrogen','CO₂','Hydrogen'],a:2},{q:'What is the boiling point of water?',opts:['90°C','100°C','110°C','120°C'],a:1}],
    science_medium: [{q:'What is the chemical formula for table salt?',opts:['NaCl','KCl','CaCl₂','NaOH'],a:0},{q:'What organelle is the powerhouse of the cell?',opts:['Nucleus','Ribosome','Mitochondria','Golgi body'],a:2},{q:'What is Newton\'s second law?',opts:['F=ma','E=mc²','V=IR','PV=nRT'],a:0}]
  };

  function getQuestions(subject, difficulty, count) {
    const key = (subject||'math').toLowerCase().split(' ')[0] + '_' + (difficulty||'medium');
    let pool = SAMPLE_QS[key] || SAMPLE_QS.math_medium;
    const shuffled = [...pool].sort(() => Math.random() - 0.5);
    return shuffled.slice(0, Math.min(count || 5, shuffled.length));
  }

  app.get('/school/adaptive-learning/assess/start', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const {module_id, path_id, skill_id, assessment_type} = req.query;
    const aType = assessment_type || 'micro';
    const difficulty = req.query.difficulty || 'medium';
    const subject = req.query.subject || 'math';
    const questions = getQuestions(subject, difficulty, 5);
    const [result] = await pool.query('INSERT INTO adaptive_assessments (tenant_id,student_id,path_id,module_id,skill_id,assessment_type,total_questions,difficulty_level,status) VALUES (?,?,?,?,?,?,?,"'+aType+'","'+difficulty+'","in_progress")', [tid, uid, path_id||null, module_id||null, skill_id||null, aType, questions.length]);
    const assessId = result.insertId;
    for (let i = 0; i < questions.length; i++) {
      await pool.query('INSERT INTO assessment_questions (tenant_id,assessment_id,question_text,question_type,options,correct_answer,difficulty,question_order,points) VALUES (?,?,?,"mcq",?,?,?,?,'+i+',10)', [tid, assessId, questions[i].q, JSON.stringify(questions[i].opts), questions[i].opts[questions[i].a], difficulty]);
    }
    res.redirect('/school/adaptive-learning/assess/'+assessId);
  }));

  app.get('/school/adaptive-learning/assess/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [assess] = await pool.query('SELECT * FROM adaptive_assessments WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!assess[0]) return res.redirect('/school/adaptive-learning');
    if (assess[0].status === 'completed') return res.redirect('/school/adaptive-learning/assess/'+req.params.id+'/result');
    const [questions] = await pool.query('SELECT * FROM assessment_questions WHERE tenant_id=? AND assessment_id=? ORDER BY question_order', [tid, req.params.id]);
    res.send(renderPage('Assessment', `<div style="max-width:800px;margin:0 auto;padding:20px;">
      <div style="background:${CBG};border-radius:12px;padding:15px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center;">
        <div><h3 style="color:${C};margin:0;">📝 ${assess[0].assessment_type.toUpperCase()} Assessment</h3><p style="color:#6b7280;margin:5px 0 0;font-size:0.85em;">Difficulty: ${assess[0].difficulty_level} • ${questions.length} questions</p></div>
        <span style="background:white;color:${C};padding:5px 15px;border-radius:20px;font-weight:bold;">${assess[0].status==='in_progress'?'In Progress':'Pending'}</span>
      </div>
      <form method="POST" action="/school/adaptive-learning/assess/${req.params.id}/submit">
        ${questions.map((q,i) => `<div style="background:white;border-radius:12px;padding:20px;margin-bottom:15px;border:1px solid #e5e7eb;">
          <h4 style="margin:0 0 12px;color:#1f2937;">Q${i+1}. ${esc(q.question_text)}</h4>
          ${JSON.parse(q.options||'[]').map((opt,j) => `<label style="display:block;padding:10px 15px;margin:5px 0;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;"><input type="radio" name="q_${q.id}" value="${j}" required style="margin-right:8px;">${esc(opt)}</label>`).join('')}
          <input type="hidden" name="correct_${q.id}" value="${esc(q.correct_answer)}">
        </div>`).join('')}
        <button type="submit" style="background:${CG};color:white;padding:12px 30px;border:none;border-radius:8px;cursor:pointer;font-size:1em;">Submit Assessment</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/adaptive-learning/assess/:id/submit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const assessId = req.params.id;
    const [assess] = await pool.query('SELECT * FROM adaptive_assessments WHERE id=? AND tenant_id=?', [tid, assessId]);
    if (!assess[0]) return res.redirect('/school/adaptive-learning');
    const [questions] = await pool.query('SELECT * FROM assessment_questions WHERE tenant_id=? AND assessment_id=?', [tid, assessId]);
    let correct = 0;
    for (const q of questions) {
      const studentAns = req.body['q_'+q.id];
      const correctAns = q.correct_answer;
      const opts = JSON.parse(q.options || '[]');
      const studentAnsText = studentAns !== undefined ? opts[parseInt(studentAns)] : '';
      const isCorrect = studentAnsText === correctAns;
      if (isCorrect) correct++;
      await pool.query('UPDATE assessment_questions SET student_answer=?, is_correct=? WHERE id=? AND tenant_id=?', [studentAnsText, isCorrect?1:0, q.id, tid]);
    }
    const score = Math.round((correct / questions.length) * 100);
    await pool.query('UPDATE adaptive_assessments SET correct_count=?, score=?, status="completed", completed_at=NOW() WHERE id=? AND tenant_id=?', [correct, score, assessId, tid]);
    // Update progress
    const a = assess[0];
    if (a.module_id) {
      await pool.query('INSERT INTO learning_progress (tenant_id,student_id,path_id,module_id,status,progress_percent,best_score,last_accessed_at) VALUES (?,?,?,?,?,?,"completed",?,NOW()) ON DUPLICATE KEY UPDATE status="completed", progress_percent=?, best_score=GREATEST(best_score,?), attempts=attempts+1, last_accessed_at=NOW()', [tid, a.student_id, a.path_id, a.module_id, score, score, score, score]);
    }
    if (a.skill_id) {
      const newMastery = Math.min(100, score);
      await pool.query('INSERT INTO student_skills (tenant_id,student_id,skill_id,mastery_level,total_xp,assessments_taken,avg_score,status,unlocked_at) VALUES (?,?,?,?,'+(score*10)+',1,?,"in_progress",NOW()) ON DUPLICATE KEY UPDATE mastery_level=GREATEST(mastery_level,?), total_xp=total_xp+(score*10), assessments_taken=assessments_taken+1, avg_score=(avg_score*assessments_taken+?)/(assessments_taken+1), status=IF(?>=95,"mastered","in_progress"), last_practiced_at=NOW(), mastered_at=IF(?>=95 AND mastered_at IS NULL,NOW(),mastered_at)', [tid, a.student_id, a.skill_id, newMastery, score, newMastery, score, newMastery, newMastery]);
    }
    res.redirect('/school/adaptive-learning/assess/'+assessId+'/result');
  }));

  app.get('/school/adaptive-learning/assess/:id/result', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [assess] = await pool.query('SELECT * FROM adaptive_assessments WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!assess[0]) return res.redirect('/school/adaptive-learning');
    const [questions] = await pool.query('SELECT * FROM assessment_questions WHERE tenant_id=? AND assessment_id=? ORDER BY question_order', [tid, req.params.id]);
    const a = assess[0];
    const emoji = a.score >= 80 ? '🎉' : a.score >= 60 ? '👍' : a.score >= 40 ? '💪' : '📚';
    const msg = a.score >= 80 ? 'Excellent work!' : a.score >= 60 ? 'Good effort, keep practicing!' : a.score >= 40 ? 'Keep trying, you can improve!' : 'Review the material and try again.';
    // Determine next difficulty suggestion
    const nextDiff = a.score >= 80 ? (a.difficulty_level==='easy'?'medium':a.difficulty_level==='medium'?'hard':'advanced') : a.score < 40 ? (a.difficulty_level==='hard'?'medium':a.difficulty_level==='medium'?'easy':'easy') : a.difficulty_level;
    res.send(renderPage('Assessment Result', `<div style="max-width:800px;margin:0 auto;padding:20px;">
      <div style="text-align:center;background:${a.score>=60?CBG:'#fef2f2'};border-radius:16px;padding:30px;margin-bottom:20px;">
        <div style="font-size:3em;margin-bottom:10px;">${emoji}</div>
        <h2 style="color:${C};margin:0 0 5px;">Score: ${a.score}%</h2>
        <p style="color:#6b7280;margin:0;">${a.correct_count}/${a.total_questions} correct • ${msg}</p>
      </div>
      <h3 style="color:${C};margin-bottom:15px;">📋 Question Review</h3>
      <div style="display:grid;gap:10px;">
        ${questions.map((q,i) => `<div style="background:${q.is_correct?'#f0fdf4':'#fef2f2'};border-radius:10px;padding:15px;border-left:4px solid ${q.is_correct?CG:CR};">
          <div style="display:flex;justify-content:space-between;"><strong>Q${i+1}. ${esc(q.question_text)}</strong><span style="font-size:1.2em;">${q.is_correct?'✅':'❌'}</span></div>
          ${!q.is_correct?`<div style="margin-top:8px;font-size:0.85em;"><span style="color:#9ca3af;">Your answer: </span><span style="color:${CR};">${esc(q.student_answer||'No answer')}</span><br><span style="color:#9ca3af;">Correct: </span><span style="color:${CG};">${esc(q.correct_answer)}</span></div>`:''}
        </div>`).join('')}
      </div>
      <div style="margin-top:20px;text-align:center;">
        <p style="color:#6b7280;margin-bottom:10px;">Suggested next difficulty: <strong>${nextDiff}</strong></p>
        <div style="display:flex;gap:10px;justify-content:center;">
          <a href="/school/adaptive-learning/assess/start?difficulty=${nextDiff}&module_id=${a.module_id}&path_id=${a.path_id}&skill_id=${a.skill_id}" style="background:${C};color:white;text-decoration:none;padding:10px 20px;border-radius:8px;">Take Another Assessment</a>
          <a href="/school/adaptive-learning" style="color:${C};text-decoration:none;padding:10px 20px;border:1px solid ${C};border-radius:8px;">Back to Dashboard</a>
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── Interventions ────────────────────────────────────────────────
  app.get('/school/adaptive-learning/interventions', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const role = req.session.user.role;
    let alerts;
    if (role==='teacher'||role==='admin') {
      [alerts] = await pool.query('SELECT ia.*, u.name as student_name FROM intervention_alerts ia LEFT JOIN users u ON u.id=ia.student_id WHERE ia.tenant_id=? ORDER BY ia.created_at DESC LIMIT 50', [tid]);
    } else {
      [alerts] = await pool.query('SELECT * FROM intervention_alerts WHERE tenant_id=? AND student_id=? ORDER BY created_at DESC LIMIT 50', [tid, uid]);
    }
    const sevColors = {low:'#3b82f6',medium:CY,high:'#f97316',critical:CR};
    res.send(renderPage('Interventions', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">🚨 Intervention Alerts</h2>
      <div style="display:grid;gap:12px;">
        ${alerts.map(a=>`<div style="background:white;border-radius:10px;padding:15px;border-left:4px solid ${sevColors[a.severity]||CY};display:flex;justify-content:space-between;align-items:center;">
          <div>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:5px;">
              <span style="background:${sevColors[a.severity]||CY};color:white;padding:2px 8px;border-radius:4px;font-size:0.75em;">${a.severity}</span>
              <span style="background:#f3f4f6;padding:2px 8px;border-radius:4px;font-size:0.75em;">${a.alert_type}</span>
              ${a.student_name?`<strong style="font-size:0.9em;">${esc(a.student_name)}</strong>`:''}
            </div>
            <p style="margin:0;color:#6b7280;font-size:0.85em;">${esc(a.message)}</p>
          </div>
          <span style="background:${a.status==='resolved'?'#dcfce7':a.status==='acknowledged'?'#fef3c7':'#fee2e2'};color:${a.status==='resolved'?CG:a.status==='acknowledged'?CY:CR};padding:4px 12px;border-radius:12px;font-size:0.8em;">${a.status}</span>
        </div>`).join('')||'<p style="color:#6b7280;">No active alerts. Great job!</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.post('/school/adaptive-learning/interventions/:id/resolve', requireAuth, ah(async (req, res) => {
    const {resolution_notes} = req.body;
    await pool.query('UPDATE intervention_alerts SET status="resolved", resolved_at=NOW(), resolution_notes=?, assigned_teacher_id=? WHERE id=? AND tenant_id=?', [resolution_notes, req.session.user.id, req.params.id, req.session.user.tenant_id]);
    res.redirect('/school/adaptive-learning/interventions');
  }));

  // ─── Analytics ────────────────────────────────────────────────────
  app.get('/school/adaptive-learning/analytics', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const role = req.session.user.role;
    const [assessments] = await pool.query('SELECT assessment_type, AVG(score) as avg_score, COUNT(*) as count, difficulty_level FROM adaptive_assessments WHERE tenant_id=? AND student_id=? AND status="completed" GROUP BY assessment_type, difficulty_level', [tid, uid]);
    const [skills] = await pool.query('SELECT ss.mastery_level, ss.skill_id, st.skill_name, st.subject FROM student_skills ss JOIN skill_tree st ON st.id=ss.skill_id WHERE ss.tenant_id=? AND ss.student_id=? ORDER BY ss.mastery_level DESC', [tid, uid]);
    const [recent] = await pool.query('SELECT aa.score, aa.assessment_type, aa.completed_at FROM adaptive_assessments aa WHERE aa.tenant_id=? AND aa.student_id=? AND aa.status="completed" ORDER BY aa.completed_at DESC LIMIT 10', [tid, uid]);
    const totalMastered = skills.filter(s=>s.mastery_level>=95).length;
    const avgMastery = skills.length ? Math.round(skills.reduce((a,s)=>a+s.mastery_level,0)/skills.length) : 0;
    res.send(renderPage('Learning Analytics', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">📈 Learning Analytics</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:15px;margin-bottom:25px;">
        ${[{l:'Assessments Taken',v:assessments.reduce((a,b)=>a+b.count,0),c:C},{l:'Avg Score',v:assessments.length?Math.round(assessments.reduce((a,b)=>a+parseFloat(b.avg_score),0)/assessments.length)+'%':'N/A',c:CG},{l:'Skills Mastered',v:totalMastered,c:'#ffd700'},{l:'Avg Mastery',v:avgMastery+'%',c:'#818cf8'}].map(s=>`<div style="background:white;border-radius:12px;padding:20px;text-align:center;border:1px solid #e5e7eb;"><div style="font-size:2em;font-weight:bold;color:${s.c};">${s.v}</div><div style="color:#6b7280;font-size:0.9em;">${s.l}</div></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
          <h3 style="color:${C};margin:0 0 15px;">📊 Skill Mastery</h3>
          ${skills.map(s=>{const ml=MASTERY_LEVELS.find(m=>s.mastery_level>=m.min)||MASTERY_LEVELS[0];return `<div style="margin-bottom:10px;"><div style="display:flex;justify-content:space-between;font-size:0.85em;margin-bottom:3px;"><span>${esc(s.skill_name)}</span><span style="color:${ml.color};">${s.mastery_level}%</span></div><div style="background:#f3f4f6;border-radius:10px;height:8px;"><div style="background:${ml.color};border-radius:10px;height:8px;width:${s.mastery_level}%;"></div></div></div>`;}).join('')||'<p style="color:#9ca3af;">No skills yet</p>'}
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
          <h3 style="color:${C};margin:0 0 15px;">📋 Recent Results</h3>
          ${recent.map(r=>`<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:0.85em;"><span>${r.assessment_type}</span><span style="color:${r.score>=60?CG:CR};font-weight:bold;">${r.score}%</span><span style="color:#9ca3af;">${r.completed_at?new Date(r.completed_at).toLocaleDateString():''}</span></div>`).join('')||'<p style="color:#9ca3af;">No results yet</p>'}
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── Goals ────────────────────────────────────────────────────────
  app.get('/school/adaptive-learning/goals', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [goals] = await pool.query('SELECT lg.*, st.skill_name FROM learning_goals lg LEFT JOIN skill_tree st ON st.id=lg.target_skill_id WHERE lg.tenant_id=? AND lg.student_id=? ORDER BY lg.created_at DESC', [tid, uid]);
    res.send(renderPage('Learning Goals', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="color:${C};">🎯 Learning Goals</h2>
        <a href="/school/adaptive-learning/goals/new" style="background:${C};color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ Set Goal</a>
      </div>
      <div style="display:grid;gap:12px;">
        ${goals.map(g=>{
          const statusColors={not_started:'#9ca3af',in_progress:C,achieved:CG,abandoned:CR};
          return `<div style="background:white;border-radius:10px;padding:15px;border-left:4px solid ${statusColors[g.status]};">
            <div style="display:flex;justify-content:space-between;align-items:center;"><strong>${esc(g.goal_title)}</strong><span style="background:${statusColors[g.status]}22;color:${statusColors[g.status]};padding:2px 10px;border-radius:12px;font-size:0.8em;">${g.status}</span></div>
            <p style="color:#6b7280;font-size:0.85em;margin:5px 0;">${esc(g.goal_description||'')} ${g.skill_name?'• Target: '+esc(g.skill_name):''} ${g.target_date?'• Due: '+g.target_date:''}</p>
            <div style="background:#f3f4f6;border-radius:20px;height:8px;margin-top:8px;"><div style="background:${statusColors[g.status]};border-radius:20px;height:8px;width:${g.current_progress}%;"></div></div>
          </div>`;}).join('')||'<p style="color:#6b7280;">No goals set yet. Set your first learning goal!</p>'}
      </div>
    </div>`, req.session.user));
  }));

  app.get('/school/adaptive-learning/goals/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [skills] = await pool.query('SELECT id, skill_name, subject FROM skill_tree WHERE tenant_id=? ORDER BY skill_name', [tid]);
    res.send(renderPage('Set Goal', `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">🎯 Set Learning Goal</h2>
      <form method="POST" action="/school/adaptive-learning/goals/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Goal Title</label><input name="goal_title" required placeholder="e.g., Master Algebra" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Description</label><textarea name="goal_description" rows="2" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></textarea></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Target Skill</label><select name="target_skill_id" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option value="">None</option>${skills.map(s=>`<option value="${s.id}">${esc(s.skill_name)} (${esc(s.subject)})</option>`).join('')}</select></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Target Date</label><input type="date" name="target_date" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
        </div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Target Mastery (%)</label><input type="range" name="target_mastery" min="10" max="100" value="100" style="width:100%;" oninput="document.getElementById('mv').textContent=this.value+'%'"><span id="mv">100%</span></div>
        <button type="submit" style="background:${C};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Set Goal</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/adaptive-learning/goals/save', requireAuth, ah(async (req, res) => {
    const {goal_title, goal_description, target_skill_id, target_date, target_mastery, id} = req.body;
    const tid = req.session.user.tenant_id;
    if (id) {
      await pool.query('UPDATE learning_goals SET goal_title=?, goal_description=?, target_skill_id=?, target_date=?, target_mastery=? WHERE id=? AND tenant_id=?', [goal_title, goal_description, target_skill_id||null, target_date||null, target_mastery, id, tid]);
    } else {
      await pool.query('INSERT INTO learning_goals (tenant_id,student_id,goal_title,goal_description,target_skill_id,target_date,target_mastery) VALUES (?,?,?,?,?,?,?)', [tid, req.session.user.id, goal_title, goal_description, target_skill_id||null, target_date||null, target_mastery]);
    }
    res.redirect('/school/adaptive-learning/goals');
  }));

  app.post('/school/adaptive-learning/goals/:id/update-progress', requireAuth, ah(async (req, res) => {
    const {current_progress} = req.body;
    await pool.query('UPDATE learning_goals SET current_progress=?, status=IF(?>=target_mastery,"achieved","in_progress") WHERE id=? AND tenant_id=?', [current_progress, current_progress, req.params.id, req.session.user.tenant_id]);
    res.redirect('/school/adaptive-learning/goals');
  }));

  // ─── Teacher Dashboard ────────────────────────────────────────────
  app.get('/school/adaptive-learning/teacher', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [pathStats] = await pool.query('SELECT lp.title, lp.subject, COUNT(DISTINCT lp2.student_id) as students, AVG(lp2.progress_percent) as avg_progress FROM learning_paths lp LEFT JOIN learning_progress lp2 ON lp2.path_id=lp.id AND lp2.tenant_id=lp.tenant_id WHERE lp.tenant_id=? AND lp.status="published" GROUP BY lp.id LIMIT 10', [tid]);
    const [struggling] = await pool.query('SELECT ia.student_id, ia.message, ia.alert_type, ia.severity, ia.created_at FROM intervention_alerts ia WHERE ia.tenant_id=? AND ia.status="active" ORDER BY ia.severity DESC LIMIT 10', [tid]);
    const [assessStats] = await pool.query('SELECT assessment_type, COUNT(*) as count, AVG(score) as avg_score FROM adaptive_assessments WHERE tenant_id=? AND status="completed" GROUP BY assessment_type', [tid]);
    res.send(renderPage('Teacher Dashboard', `<div style="max-width:1200px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">👨‍🏫 Teacher Analytics Dashboard</h2>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:15px;margin-bottom:25px;">
        ${assessStats.map(s=>`<div style="background:${CBG};border-radius:12px;padding:20px;text-align:center;"><div style="font-size:1.8em;font-weight:bold;color:${C};">${Math.round(parseFloat(s.avg_score||0))}%</div><div style="color:#6b7280;font-size:0.85em;">Avg ${s.assessment_type}</div><div style="color:#9ca3af;font-size:0.75em;">${s.count} taken</div></div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;">
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
          <h3 style="color:${C};margin:0 0 15px;">📖 Path Performance</h3>
          ${pathStats.map(p=>`<div style="margin-bottom:12px;padding-bottom:12px;border-bottom:1px solid #f3f4f6;"><div style="display:flex;justify-content:space-between;"><strong style="font-size:0.9em;">${esc(p.title)}</strong><span style="color:#6b7280;font-size:0.85em;">${p.students} students</span></div><div style="background:#f3f4f6;border-radius:10px;height:6px;margin-top:5px;"><div style="background:${C};border-radius:10px;height:6px;width:${Math.round(parseFloat(p.avg_progress||0))}%;"></div></div><div style="color:#9ca3af;font-size:0.75em;margin-top:2px;">Avg progress: ${Math.round(parseFloat(p.avg_progress||0))}%</div></div>`).join('')||'<p style="color:#9ca3af;">No paths published yet</p>'}
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid #e5e7eb;">
          <h3 style="color:${CR};margin:0 0 15px;">🚨 Active Alerts</h3>
          ${struggling.map(a=>{const sc={low:'#3b82f6',medium:CY,high:'#f97316',critical:CR};return `<div style="display:flex;gap:10px;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6;"><span style="background:${sc[a.severity]};color:white;padding:2px 8px;border-radius:4px;font-size:0.7em;">${a.severity}</span><div style="flex:1;"><div style="font-size:0.85em;">${esc(a.message)}</div><div style="color:#9ca3af;font-size:0.75em;">${a.alert_type} • ${new Date(a.created_at).toLocaleDateString()}</div></div></div>`;}).join('')||'<p style="color:#9ca3af;">No active alerts</p>'}
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── Skill Management (Teacher) ───────────────────────────────────
  app.get('/school/adaptive-learning/skills/manage', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [skills] = await pool.query('SELECT st.*, (SELECT COUNT(*) FROM student_skills WHERE skill_id=st.id AND tenant_id=st.tenant_id AND mastery_level>=95) as mastered_count FROM skill_tree st WHERE st.tenant_id=? ORDER BY st.subject, st.difficulty_level', [tid]);
    res.send(renderPage('Manage Skills', `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;">
        <h2 style="color:${C};">🌳 Manage Skill Tree</h2>
        <a href="/school/adaptive-learning/skills/new" style="background:${C};color:white;text-decoration:none;padding:8px 16px;border-radius:8px;">+ Add Skill</a>
      </div>
      <table style="width:100%;border-collapse:collapse;background:white;border-radius:12px;overflow:hidden;border:1px solid #e5e7eb;">
        <thead><tr style="background:${CBG};"><th style="padding:12px;text-align:left;">Skill</th><th>Subject</th><th>Level</th><th>Mastered</th><th>Actions</th></tr></thead>
        <tbody>${skills.map(s=>`<tr style="border-bottom:1px solid #f3f4f6;"><td style="padding:10px;">${s.icon} <strong>${esc(s.skill_name)}</strong></td><td style="padding:10px;text-align:center;">${esc(s.subject||'-')}</td><td style="padding:10px;text-align:center;">${s.difficulty_level}</td><td style="padding:10px;text-align:center;">${s.mastered_count}</td><td style="padding:10px;text-align:center;"><a href="/school/adaptive-learning/skills/${s.id}/edit" style="color:${C};">Edit</a></td></tr>`).join('')}</tbody>
      </table>
    </div>`, req.session.user));
  }));

  app.get('/school/adaptive-learning/skills/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [existing] = await pool.query('SELECT id, skill_name FROM skill_tree WHERE tenant_id=? ORDER BY skill_name', [tid]);
    const subjects = ['Mathematics','English','Science','Physics','Chemistry','Biology','History','Geography','Computer Science','Art','Music'];
    res.send(renderPage('Add Skill', `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <h2 style="color:${C};margin-bottom:20px;">➕ Add Skill</h2>
      <form method="POST" action="/school/adaptive-learning/skills/save" style="background:white;padding:20px;border-radius:12px;border:1px solid #e5e7eb;">
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Skill Name</label><input name="skill_name" required style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;"></div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Subject</label><select name="subject" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;">${subjects.map(s=>`<option>${s}</option>`).join('')}</select></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:15px;margin-bottom:15px;">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Difficulty Level (1-10)</label><input type="number" name="difficulty_level" value="1" min="1" max="10" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;">Icon</label><input name="icon" value="🎯" maxlength="4" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"></div>
        </div>
        <div style="margin-bottom:15px;"><label style="font-weight:600;display:block;margin-bottom:5px;">Prerequisite Skill</label><select name="parent_skill_id" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;"><option value="">None</option>${existing.map(s=>`<option value="${s.id}">${esc(s.skill_name)}</option>`).join('')}</select></div>
        <button type="submit" style="background:${C};color:white;padding:10px 20px;border:none;border-radius:8px;cursor:pointer;">Add Skill</button>
      </form>
    </div>`, req.session.user));
  }));

  app.post('/school/adaptive-learning/skills/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const {skill_name, subject, description, difficulty_level, icon, color, parent_skill_id, id} = req.body;
    const code = skill_name.toLowerCase().replace(/[^a-z0-9]/g,'_').substring(0,50);
    if (id) {
      await pool.query('UPDATE skill_tree SET skill_name=?, subject=?, description=?, difficulty_level=?, icon=?, color=?, parent_skill_id=? WHERE id=? AND tenant_id=?', [skill_name, subject, description, difficulty_level, icon, color, parent_skill_id||null, id, tid]);
    } else {
      await pool.query('INSERT INTO skill_tree (tenant_id, skill_name, skill_code, subject, description, difficulty_level, icon, color, parent_skill_id) VALUES (?,?,?,?,?,?,?,?,?,?)', [tid, skill_name, code, subject, description, difficulty_level, icon||'🎯', color||'#6366f1', parent_skill_id||null]);
    }
    res.redirect('/school/adaptive-learning/skills/manage');
  }));

  console.log('[AdaptiveLearning] Module loaded — adaptive learning paths, skill tree, assessments');
};
