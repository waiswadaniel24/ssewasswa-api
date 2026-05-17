// ============================================================
// DRONE-EDUCATION MODULE — School SaaS Portal
// Drone flight training, simulation exercises, flight logs,
// certification tracking, drone inventory, mission planning,
// safety protocols, competition preparation.
// 10+ routes, MySQL-backed, tenant-aware.
// ============================================================
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ─── Helpers ──────────────────────────────────────────────
  const nav = (active) => `<div style="display:flex;gap:6px;margin-bottom:24px;flex-wrap:wrap;padding:4px 0">
    <a href="/school/drone-education" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='dash'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">🚁 Dashboard</a>
    <a href="/school/drone-education/modules" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='modules'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📚 Modules</a>
    <a href="/school/drone-education/fleet" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='fleet'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">✈️ Fleet</a>
    <a href="/school/drone-education/flight-logs" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='logs'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📋 Flight Logs</a>
    <a href="/school/drone-education/certifications" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='certs'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">🏆 Certifications</a>
    <a href="/school/drone-education/safety" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='safety'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">⚠️ Safety</a>
  </div>`;

  const statCard = (label, value, color, icon) => `<div style="background:#fff;border-radius:14px;padding:20px;text-align:center;border:1px solid #e5e7eb;position:relative;overflow:hidden"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:${color}"></div><div style="font-size:28px;font-weight:800;color:${color}">${value}</div><div style="font-size:12px;color:${GRAY};font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:4px">${icon} ${label}</div></div>`;

  const badge = (text, color) => `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${color}20;color:${color}">${text}</span>`;

  // ─── Database Migration ──────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS drone_modules (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        difficulty ENUM('beginner','intermediate','advanced') DEFAULT 'beginner',
        prerequisites JSONB DEFAULT NULL,
        content TEXT,
        estimated_hours INT DEFAULT 2,
        category VARCHAR(100) DEFAULT 'general',
        status ENUM('draft','published','archived') DEFAULT 'draft',
        created_by INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_category (tenant_id, category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      console.log('[DroneEducation] drone_modules OK');
    } catch(e) { console.warn('[DroneEducation] Warn:', e.message); }

    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS drone_fleet (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        name VARCHAR(200) NOT NULL,
        model VARCHAR(200),
        serial VARCHAR(100),
        status ENUM('available','in_use','maintenance','retired') DEFAULT 'available',
        battery_health INT DEFAULT 100,
        flight_hours DECIMAL(8,2) DEFAULT 0,
        max_payload_grams INT DEFAULT 500,
        max_range_meters INT DEFAULT 5000,
        camera VARCHAR(100),
        notes TEXT,
        last_maintenance DATETIME,
        purchased_date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_status (tenant_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      console.log('[DroneEducation] drone_fleet OK');
    } catch(e) { console.warn('[DroneEducation] Warn:', e.message); }

    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS flight_logs (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        drone_id INT,
        student_id INT NOT NULL,
        duration_min INT DEFAULT 0,
        max_altitude_meters INT DEFAULT 0,
        max_speed_kmh INT DEFAULT 0,
        distance_km DECIMAL(6,2) DEFAULT 0,
        mission_type VARCHAR(100),
        waypoints JSONB DEFAULT NULL,
        notes TEXT,
        weather_conditions VARCHAR(200),
        status ENUM('planned','completed','aborted','incident') DEFAULT 'planned',
        date DATE,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_student (tenant_id, student_id),
        INDEX idx_drone (tenant_id, drone_id),
        INDEX idx_date (tenant_id, date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      console.log('[DroneEducation] flight_logs OK');
    } catch(e) { console.warn('[DroneEducation] Warn:', e.message); }

    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS drone_certifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        student_id INT NOT NULL,
        level VARCHAR(100) NOT NULL,
        skills_tested JSONB DEFAULT NULL,
        score INT DEFAULT 0,
        max_score INT DEFAULT 100,
        status ENUM('passed','failed','expired') DEFAULT 'passed',
        certified_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        expires_at DATETIME,
        certifier_id INT,
        notes TEXT,
        INDEX idx_tenant (tenant_id),
        INDEX idx_student (tenant_id, student_id),
        INDEX idx_level (tenant_id, level)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`);
      console.log('[DroneEducation] drone_certifications OK');
    } catch(e) { console.warn('[DroneEducation] Warn:', e.message); }
  })();

  // ─── ROUTE 1: Dashboard ──────────────────────────────────
  app.get('/school/drone-education', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [totalModules] = await pool.query('SELECT COUNT(*) as c FROM drone_modules WHERE tenant_id=? AND status="published"', [tid]);
    const [fleetSize] = await pool.query('SELECT COUNT(*) as c FROM drone_fleet WHERE tenant_id=? AND status!="retired"', [tid]);
    const [myFlights] = await pool.query('SELECT COUNT(*) as c FROM flight_logs WHERE tenant_id=? AND student_id=? AND status="completed"', [tid, uid]);
    const [myFlightHrs] = await pool.query('SELECT COALESCE(SUM(duration_min),0) as c FROM flight_logs WHERE tenant_id=? AND student_id=? AND status="completed"', [tid, uid]);
    const [myCerts] = await pool.query('SELECT COUNT(*) as c FROM drone_certifications WHERE tenant_id=? AND student_id=? AND status="passed"', [tid, uid]);
    const [recentFlights] = await pool.query('SELECT fl.*, df.name as drone_name FROM flight_logs fl LEFT JOIN drone_fleet df ON df.id=fl.drone_id WHERE fl.tenant_id=? AND fl.student_id=? ORDER BY fl.date DESC LIMIT 5', [tid, uid]);
    const [totalFlightHrs] = await pool.query('SELECT COALESCE(SUM(flight_hours),0) as c FROM drone_fleet WHERE tenant_id=?', [tid]);

    res.send(renderPage('Drone Education', SKIP + `<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:${P};margin:0">🚁 Drone Education Center</h1>
          <p style="font-size:13px;color:${GRAY};margin-top:4px">Flight training, certifications, and aerial skills development</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/school/drone-education/modules" class="btn" style="text-decoration:none;padding:10px 20px">📚 Training Modules</a>
          <a href="/school/drone-education/flight-log/new" class="btn" style="background:#059669;text-decoration:none;padding:10px 20px">+ Log Flight</a>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px">
        ${statCard('Training Modules', totalModules[0].c, P, '📚')}
        ${statCard('Fleet Size', fleetSize[0].c, '#059669', '✈️')}
        ${statCard('My Flights', myFlights[0].c, '#7c3aed', '🛫')}
        ${statCard('Flight Hours', Math.round(myFlightHrs[0].c / 60), '#d97706', '⏱')}
        ${statCard('Certifications', myCerts[0].c, '#dc2626', '🏆')}
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:18px">
        <div>
          <h3 style="color:${P};margin:0 0 14px">📋 Recent Flights</h3>
          ${recentFlights.length ? `<div style="display:grid;gap:10px">
            ${recentFlights.map(f => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;border-left:4px solid ${f.status==='completed'?'#059669':f.status==='aborted'?'#dc2626':'#d97706'}">
              <div>
                <strong style="color:#1f2937">${esc(f.mission_type||'Training Flight')}</strong>
                <div style="color:${GRAY};font-size:12px;margin-top:2px">${esc(f.drone_name||'Simulator')} • ${f.duration_min}min • ${f.max_altitude_meters}m altitude</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                ${badge(f.status, f.status==='completed'?'#059669':f.status==='aborted'?'#dc2626':'#d97706')}
                <span style="color:${GRAY};font-size:12px">${f.date ? new Date(f.date).toLocaleDateString() : '—'}</span>
              </div>
            </div>`).join('')}
          </div>` : '<div class="card" style="text-align:center;padding:30px;color:'+GRAY+'">No flights logged yet. Start your drone training journey!</div>'}

          <h3 style="color:${P};margin:24px 0 14px">📚 Training Path</h3>
          <div style="display:grid;gap:8px">
            ${[
              {level:'Level 1 — Ground School', desc:'Theory, regulations, safety basics', status:'enroll'},
              {level:'Level 2 — Basic Flight', desc:'Hover, takeoff, landing, basic maneuvers', status:'progress'},
              {level:'Level 3 — Advanced Flight', desc:'Waypoint navigation, autonomous flight', status:'locked'},
              {level:'Level 4 — Aerial Photography', desc:'Camera operation, composition, mapping', status:'locked'},
              {level:'Level 5 — Mission Planning', desc:'Complex missions, survey, inspection', status:'locked'}
            ].map(l => `<div style="padding:14px;border-radius:10px;border:1px solid #e5e7eb;display:flex;justify-content:space-between;align-items:center">
              <div>
                <strong style="color:#1f2937;font-size:14px">${l.level}</strong>
                <div style="color:${GRAY};font-size:12px;margin-top:2px">${l.desc}</div>
              </div>
              ${l.status==='enroll'?'<a href="/school/drone-education/modules" class="btn" style="padding:6px 14px;font-size:12px;text-decoration:none">Enroll</a>':
                l.status==='progress'?'<span style="color:#d97706;font-weight:600;font-size:12px">In Progress</span>':
                '<span style="color:'+GRAY+';font-size:12px">🔒 Locked</span>'}
            </div>`).join('')}
          </div>
        </div>

        <div>
          <div class="card">
            <h4 style="color:${P};margin:0 0 12px">✈️ Fleet Status</h4>
            ${[
              {status:'available',label:'Available',color:'#059669',icon:'✅'},
              {status:'in_use',label:'In Use',color:'#d97706',icon:'🟡'},
              {status:'maintenance',label:'Maintenance',color:'#dc2626',icon:'🔧'}
            ].map(s => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6">
              <span style="font-size:13px;color:#374151">${s.icon} ${s.label}</span>
              <span style="font-weight:600;color:${s.color}">—</span>
            </div>`).join('')}
            <div style="margin-top:12px;padding-top:10px;border-top:1px solid #e5e7eb">
              <div style="font-size:12px;color:${GRAY}">Total Fleet Flight Hours</div>
              <div style="font-size:20px;font-weight:800;color:${P}">${Math.round(totalFlightHrs[0].c)}h</div>
            </div>
          </div>

          <div class="card" style="margin-top:12px">
            <h4 style="color:${P};margin:0 0 10px">⚠️ Pre-Flight Checklist</h4>
            ${['Check battery level (>60%)','Inspect propellers','Verify GPS lock','Check weather conditions','Clear flight zone','Set return-to-home altitude','Test camera (if applicable)','Confirm flight plan'].map(item =>
              `<label style="display:flex;align-items:center;gap:8px;padding:5px 0;font-size:13px;color:#374151"><input type="checkbox" style="width:auto"> ${item}</label>`
            ).join('')}
          </div>
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 2: Training Modules ───────────────────────────
  app.get('/school/drone-education/modules', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const catFilter = req.query.category || '';

    let whereClause = 'WHERE tenant_id=? AND status="published"';
    const params = [tid];
    if (catFilter) { whereClause += ' AND category=?'; params.push(catFilter); }

    const [modules] = await pool.query(`SELECT * FROM drone_modules ${whereClause} ORDER BY difficulty, title`, params);
    const [categories] = await pool.query('SELECT DISTINCT category FROM drone_modules WHERE tenant_id=? AND status="published"', [tid]);

    res.send(renderPage('Training Modules', SKIP + `<div style="max-width:1100px;margin:0 auto;padding:20px">
      ${nav('modules')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h2 style="color:${P};margin:0">📚 Drone Training Modules</h2>
        <div style="display:flex;gap:8px">
          <select onchange="location.href='/school/drone-education/modules?category='+this.value" style="width:auto;min-width:150px">
            <option value="">All Categories</option>
            ${categories.map(c => `<option value="${esc(c.category)}" ${catFilter===c.category?'selected':''}>${esc(c.category)}</option>`).join('')}
          </select>
          ${req.session.user.role==='teacher'||req.session.user.role==='admin'?`<a href="/school/drone-education/modules/new" class="btn" style="text-decoration:none;padding:8px 16px">+ New Module</a>`:''}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
        ${modules.length ? modules.map(m => {
          const prereqs = Array.isArray(m.prerequisites) ? m.prerequisites : [];
          return `<div class="card" style="border-top:4px solid ${m.difficulty==='advanced'?'#dc2626':m.difficulty==='intermediate'?'#d97706':'#059669'}">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
              <h3 style="color:#1f2937;margin:0;font-size:15px">${esc(m.title)}</h3>
              ${badge(m.difficulty, m.difficulty==='advanced'?'#dc2626':m.difficulty==='intermediate'?'#d97706':'#059669')}
            </div>
            <div style="display:flex;gap:6px;margin-bottom:10px">
              ${m.category ? badge(m.category, P) : ''}
              <span style="color:${GRAY};font-size:11px">⏱ ${m.estimated_hours}h</span>
            </div>
            <p style="color:#374151;font-size:13px;line-height:1.6;margin-bottom:10px">${esc((m.description||'').substring(0, 140))}${(m.description||'').length>140?'...':''}</p>
            ${prereqs.length ? `<div style="font-size:11px;color:${GRAY};margin-bottom:8px">📚 Prerequisites: ${prereqs.join(', ')}</div>` : ''}
            <a href="/school/drone-education/module/${m.id}" class="btn" style="text-decoration:none;padding:6px 16px;font-size:12px;display:block;text-align:center;margin-top:8px">📖 View Module</a>
          </div>`;
        }).join('') : '<div style="text-align:center;color:'+GRAY+';padding:40px;grid-column:1/-1">No training modules available yet.</div>'}
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 3: Module Detail ──────────────────────────────
  app.get('/school/drone-education/module/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [module] = await pool.query('SELECT * FROM drone_modules WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!module[0]) return res.redirect('/school/drone-education/modules');
    const m = module[0];

    res.send(renderPage(m.title, SKIP + `<div style="max-width:800px;margin:0 auto;padding:20px">
      <a href="/school/drone-education/modules" style="color:${P};text-decoration:none;font-size:13px">← Back to Modules</a>
      <div class="card" style="margin-top:12px;border-top:4px solid ${m.difficulty==='advanced'?'#dc2626':m.difficulty==='intermediate'?'#d97706':'#059669'}">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:12px">
          <h2 style="color:${P};margin:0">${esc(m.title)}</h2>
          ${badge(m.difficulty, m.difficulty==='advanced'?'#dc2626':m.difficulty==='intermediate'?'#d97706':'#059669')}
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px">
          ${m.category ? badge(m.category, P) : ''}
          <span style="color:${GRAY};font-size:12px">⏱ ${m.estimated_hours} hours estimated</span>
        </div>
        <p style="color:#374151;font-size:14px;line-height:1.8;margin-bottom:16px">${esc(m.description||'')}</p>
        ${m.content ? `<div style="border-top:1px solid #e5e7eb;padding-top:16px">
          <h4 style="color:${P};margin:0 0 10px">📖 Module Content</h4>
          <div style="color:#374151;font-size:14px;line-height:1.8;white-space:pre-wrap">${esc(m.content)}</div>
        </div>` : ''}
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 4: Fleet Management ───────────────────────────
  app.get('/school/drone-education/fleet', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [drones] = await pool.query('SELECT * FROM drone_fleet WHERE tenant_id=? ORDER BY name', [tid]);

    const statusColors = { available:'#059669', in_use:'#d97706', maintenance:'#dc2626', retired:'#6b7280' };

    res.send(renderPage('Drone Fleet', SKIP + `<div style="max-width:1100px;margin:0 auto;padding:20px">
      ${nav('fleet')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h2 style="color:${P};margin:0">✈️ Drone Fleet Management</h2>
        ${req.session.user.role==='teacher'||req.session.user.role==='admin'?`<a href="/school/drone-education/fleet/new" class="btn" style="text-decoration:none;padding:10px 20px">+ Add Drone</a>`:''}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(320px,1fr));gap:16px">
        ${drones.length ? drones.map(d => `<div class="card" style="border-top:4px solid ${statusColors[d.status]||'#6b7280'}">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px">
            <div>
              <h3 style="color:#1f2937;margin:0;font-size:15px">${esc(d.name)}</h3>
              <div style="color:${GRAY};font-size:12px">${esc(d.model||'Unknown Model')}${d.serial?' • S/N: '+esc(d.serial):''}</div>
            </div>
            ${badge(d.status, statusColors[d.status]||'#6b7280')}
          </div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:12px">
            <div style="text-align:center;padding:8px;background:#f9fafb;border-radius:8px"><div style="font-size:18px;font-weight:700;color:${d.battery_health>60?'#059669':d.battery_health>30?'#d97706':'#dc2626'}">${d.battery_health}%</div><div style="font-size:10px;color:${GRAY}">Battery</div></div>
            <div style="text-align:center;padding:8px;background:#f9fafb;border-radius:8px"><div style="font-size:18px;font-weight:700;color:${P}">${d.flight_hours}h</div><div style="font-size:10px;color:${GRAY}">Flight Hrs</div></div>
            <div style="text-align:center;padding:8px;background:#f9fafb;border-radius:8px"><div style="font-size:18px;font-weight:700;color:#7c3aed">${d.max_range_meters}m</div><div style="font-size:10px;color:${GRAY}">Range</div></div>
          </div>
          ${d.camera ? `<div style="margin-top:8px;font-size:11px;color:${GRAY}">📷 ${esc(d.camera)}</div>` : ''}
          ${req.session.user.role==='teacher'||req.session.user.role==='admin'?`<div style="margin-top:12px;display:flex;gap:6px">
            <a href="/school/drone-education/fleet/${d.id}/edit" style="color:${P};text-decoration:none;font-size:12px">Edit</a>
            <form method="POST" action="/school/drone-education/fleet/${d.id}/delete" style="display:inline" onsubmit="return confirm('Retire this drone?')"><button style="color:#dc2626;background:none;border:none;cursor:pointer;font-size:12px">Retire</button></form>
          </div>` : ''}
        </div>`).join('') : '<div style="text-align:center;color:'+GRAY+';padding:40px;grid-column:1/-1">No drones in fleet.</div>'}
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 5: Add Drone ──────────────────────────────────
  app.get('/school/drone-education/fleet/new', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Add Drone', SKIP + `<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('fleet')}
      <div class="card" style="padding:32px">
        <h2 style="color:${P};margin:0 0 20px">➕ Add Drone to Fleet</h2>
        <form method="POST" action="/school/drone-education/fleet/save" style="display:flex;flex-direction:column;gap:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Name *</label><input type="text" name="name" required placeholder="e.g., Phantom Alpha" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Model</label><input type="text" name="model" placeholder="e.g., DJI Phantom 4" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Serial Number</label><input type="text" name="serial" placeholder="e.g., DJ-2024-001" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Status</label><select name="status" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"><option value="available">Available</option><option value="in_use">In Use</option><option value="maintenance">Maintenance</option><option value="retired">Retired</option></select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Battery Health %</label><input type="number" name="battery_health" value="100" min="0" max="100" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Max Range (m)</label><input type="number" name="max_range_meters" value="5000" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Max Payload (g)</label><input type="number" name="max_payload_grams" value="500" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
          </div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Camera</label><input type="text" name="camera" placeholder="e.g., 4K HD, Thermal" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Notes</label><textarea name="notes" rows="2" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></textarea></div>
          <button type="submit" class="btn" style="padding:12px 28px;font-size:15px">💾 Add Drone</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 6: Save Drone ─────────────────────────────────
  app.post('/school/drone-education/fleet/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id, name, model, serial, status, battery_health, max_range_meters, max_payload_grams, camera, notes, purchased_date } = req.body;

    if (id) {
      await pool.query('UPDATE drone_fleet SET name=?, model=?, serial=?, status=?, battery_health=?, max_range_meters=?, max_payload_grams=?, camera=?, notes=? WHERE id=? AND tenant_id=?',
        [name, model, serial, status, battery_health, max_range_meters, max_payload_grams, camera, notes, id, tid]);
      audit({ action: 'update_drone', droneId: id, user: req.session.user });
    } else {
      await pool.query('INSERT INTO drone_fleet (tenant_id, name, model, serial, status, battery_health, max_range_meters, max_payload_grams, camera, notes, purchased_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [tid, name, model, serial, status, battery_health, max_range_meters, max_payload_grams, camera, notes, purchased_date || null]);
      audit({ action: 'add_drone', name, user: req.session.user });
    }
    res.redirect('/school/drone-education/fleet');
  }));

  // ─── ROUTE 7: Retire Drone ───────────────────────────────
  app.post('/school/drone-education/fleet/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('UPDATE drone_fleet SET status="retired" WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    audit({ action: 'retire_drone', droneId: req.params.id, user: req.session.user });
    res.redirect('/school/drone-education/fleet');
  }));

  // ─── ROUTE 8: New Flight Log ─────────────────────────────
  app.get('/school/drone-education/flight-log/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [drones] = await pool.query('SELECT id, name, model FROM drone_fleet WHERE tenant_id=? AND status="available" ORDER BY name', [tid]);

    res.send(renderPage('Log Flight', SKIP + `<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('logs')}
      <div class="card" style="padding:32px">
        <h2 style="color:${P};margin:0 0 20px">🛫 Log New Flight</h2>
        <form method="POST" action="/school/drone-education/flight-log/save" style="display:flex;flex-direction:column;gap:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Date *</label><input type="date" name="date" value="${new Date().toISOString().slice(0,10)}" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Drone</label><select name="drone_id" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"><option value="">Simulator / No Drone</option>${drones.map(d => `<option value="${d.id}">${esc(d.name)} (${esc(d.model||'')})</option>`).join('')}</select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Duration (min)</label><input type="number" name="duration_min" value="15" min="1" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Mission Type *</label>
              <select name="mission_type" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
                <option value="training">Training</option><option value="practice">Practice</option><option value="photography">Aerial Photography</option><option value="survey">Survey / Mapping</option><option value="inspection">Inspection</option><option value="competition">Competition</option><option value="other">Other</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Max Altitude (m)</label><input type="number" name="max_altitude_meters" value="50" min="0" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Max Speed (km/h)</label><input type="number" name="max_speed_kmh" value="30" min="0" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Distance (km)</label><input type="number" name="distance_km" value="1" min="0" step="0.1" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
          </div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Weather Conditions</label><input type="text" name="weather_conditions" placeholder="e.g., Clear, 20°C, Wind 5 km/h" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Status</label>
            <select name="status" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"><option value="completed">Completed</option><option value="aborted">Aborted</option><option value="incident">Incident</option></select>
          </div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Notes</label><textarea name="notes" rows="3" placeholder="Flight notes, observations, lessons learned..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></textarea></div>
          <button type="submit" class="btn" style="padding:12px 28px;font-size:15px">💾 Save Flight Log</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 9: Save Flight Log ────────────────────────────
  app.post('/school/drone-education/flight-log/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { drone_id, date, duration_min, max_altitude_meters, max_speed_kmh, distance_km, mission_type, weather_conditions, status, notes } = req.body;

    await pool.query('INSERT INTO flight_logs (tenant_id, drone_id, student_id, duration_min, max_altitude_meters, max_speed_kmh, distance_km, mission_type, weather_conditions, status, notes, date) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
      [tid, drone_id || null, uid, duration_min, max_altitude_meters, max_speed_kmh, distance_km, mission_type, weather_conditions, status, notes, date]);

    // Update drone flight hours
    if (drone_id) {
      const hrs = parseFloat(duration_min || 0) / 60;
      await pool.query('UPDATE drone_fleet SET flight_hours = flight_hours + ? WHERE id=? AND tenant_id=?', [hrs, drone_id, tid]);
    }

    audit({ action: 'log_flight', missionType: mission_type, duration: duration_min, user: req.session.user });
    res.redirect('/school/drone-education/flight-logs');
  }));

  // ─── ROUTE 10: Flight Logs List ──────────────────────────
  app.get('/school/drone-education/flight-logs', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const role = req.session.user.role;
    const [logs] = await pool.query('SELECT fl.*, df.name as drone_name FROM flight_logs fl LEFT JOIN drone_fleet df ON df.id=fl.drone_id WHERE fl.tenant_id=? AND fl.student_id=? ORDER BY fl.date DESC LIMIT 50', [tid, uid]);

    res.send(renderPage('Flight Logs', SKIP + `<div style="max-width:1000px;margin:0 auto;padding:20px">
      ${nav('logs')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h2 style="color:${P};margin:0">📋 Flight Logs</h2>
        <a href="/school/drone-education/flight-log/new" class="btn" style="text-decoration:none;padding:8px 16px">+ Log Flight</a>
      </div>
      <div class="card" style="overflow-x:auto">
        <table>
          <thead><tr><th>Date</th><th>Drone</th><th>Mission</th><th>Duration</th><th>Max Alt.</th><th>Speed</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody>
            ${logs.length ? logs.map(l => `<tr>
              <td style="color:${GRAY};font-size:12px;white-space:nowrap">${l.date?new Date(l.date).toLocaleDateString():'—'}</td>
              <td>${esc(l.drone_name||'Simulator')}</td>
              <td>${esc(l.mission_type||'—')}</td>
              <td>${l.duration_min}min</td>
              <td>${l.max_altitude_meters}m</td>
              <td>${l.max_speed_kmh}km/h</td>
              <td>${badge(l.status, l.status==='completed'?'#059669':l.status==='aborted'?'#d97706':'#dc2626')}</td>
              <td style="color:${GRAY};font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(l.notes||'—')}</td>
            </tr>`).join('') : `<tr><td colspan="8" style="text-align:center;color:${GRAY};padding:30px">No flight logs yet</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 11: Certifications ────────────────────────────
  app.get('/school/drone-education/certifications', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const role = req.session.user.role;

    let whereClause = 'WHERE dc.tenant_id=?';
    const params = [tid];
    if (role !== 'admin' && role !== 'teacher') { whereClause += ' AND dc.student_id=?'; params.push(uid); }

    const [certs] = await pool.query(`SELECT dc.*, u.name as student_name FROM drone_certifications dc ${role!=='admin'&&role!=='teacher'?'':'LEFT JOIN users u ON u.id=dc.student_id'} ${whereClause} ORDER BY dc.certified_at DESC`, params);

    const levels = [
      {level:'Ground School', desc:'Theory & regulations', icon:'📖'},
      {level:'Basic Pilot', desc:'Basic flight maneuvers', icon:'🚁'},
      {level:'Advanced Pilot', desc:'Autonomous & complex missions', icon:'✈️'},
      {level:'Aerial Photographer', desc:'Camera & mapping', icon:'📸'},
      {level:'Mission Commander', desc:'Multi-drone & complex ops', icon:'🎯'}
    ];

    res.send(renderPage('Certifications', SKIP + `<div style="max-width:1100px;margin:0 auto;padding:20px">
      ${nav('certs')}
      <h2 style="color:${P};margin:0 0 20px">🏆 Drone Certifications</h2>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:24px">
        ${levels.map(l => `<div class="card" style="text-align:center;border-top:4px solid ${P}">
          <div style="font-size:32px;margin-bottom:8px">${l.icon}</div>
          <h4 style="color:#1f2937;margin:0 0 4px">${l.level}</h4>
          <p style="color:${GRAY};font-size:12px">${l.desc}</p>
        </div>`).join('')}
      </div>

      <div class="card" style="overflow-x:auto">
        <table>
          <thead><tr><th>${role==='teacher'||role==='admin'?'Student':'#ID'}</th><th>Level</th><th>Score</th><th>Status</th><th>Certified</th><th>Expires</th></tr></thead>
          <tbody>
            ${certs.length ? certs.map(c => `<tr>
              <td>${role==='teacher'||role==='admin'?esc(c.student_name||'—'):(c.id)}</td>
              <td style="font-weight:600;color:${P}">${esc(c.level)}</td>
              <td>${c.score}/${c.max_score}</td>
              <td>${badge(c.status, c.status==='passed'?'#059669':c.status==='failed'?'#dc2626':'#d97706')}</td>
              <td style="color:${GRAY};font-size:12px">${c.certified_at?new Date(c.certified_at).toLocaleDateString():'—'}</td>
              <td style="color:${GRAY};font-size:12px">${c.expires_at?new Date(c.expires_at).toLocaleDateString():'Never'}</td>
            </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;color:${GRAY};padding:30px">No certifications yet</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 12: Safety Protocols ──────────────────────────
  app.get('/school/drone-education/safety', requireAuth, ah(async (req, res) => {
    const protocols = [
      { title: 'Pre-Flight Safety', icon: '🛫', items: ['Check local regulations and no-fly zones','Inspect drone for physical damage','Verify battery level and charge','Update firmware if needed','Check propeller attachment','Test GPS signal strength','Set geofencing boundaries','Configure return-to-home point'] },
      { title: 'During Flight', icon: '✈️', items: ['Maintain visual line of sight (VLOS)','Do not fly above 120m (400ft)','Keep distance from people and property','Monitor battery level continuously','Avoid flying in adverse weather','Be aware of other aircraft','Follow mission plan waypoints','Maintain safe speed for conditions'] },
      { title: 'Emergency Procedures', icon: '🚨', items: ['Loss of signal: activate RTH immediately','Low battery: land as soon as possible','Loss of GPS: switch to ATTI mode','Fly-away: do not chase, note last position','Motor failure: reduce throttle, land safely','Injury incident: provide first aid, report immediately','Mid-air collision: land both aircraft, assess damage','Fire risk: land away from flammable materials'] },
      { title: 'Post-Flight', icon: '🛬', items: ['Allow battery to cool before charging','Inspect for damage after each flight','Clean sensors and camera lens','Log all flight data accurately','Report any incidents or near-misses','Store drone in protective case','Charge batteries to storage level (50-60%)','Update flight log and maintenance records'] }
    ];

    res.send(renderPage('Drone Safety Protocols', SKIP + `<div style="max-width:1100px;margin:0 auto;padding:20px">
      ${nav('safety')}
      <h2 style="color:${P};margin:0 0 4px">⚠️ Drone Safety Protocols</h2>
      <p style="color:${GRAY};margin:0 0 24px">Essential safety guidelines for all drone operations</p>

      <div class="card" style="background:#fef3c7;border:1px solid #fbbf24;margin-bottom:20px">
        <div style="display:flex;align-items:center;gap:10px">
          <span style="font-size:28px">🛡️</span>
          <div>
            <h3 style="color:#92400e;margin:0">Safety Is Non-Negotiable</h3>
            <p style="color:#92400e;font-size:13px;margin:4px 0 0">All students must pass safety certification before operating any drone. Violations of safety protocols may result in suspension of flight privileges.</p>
          </div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">
        ${protocols.map(p => `<div class="card" style="border-top:4px solid #d97706">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
            <span style="font-size:24px">${p.icon}</span>
            <h3 style="color:#1f2937;margin:0;font-size:15px">${esc(p.title)}</h3>
          </div>
          <ul style="margin:0;padding-left:18px;color:#374151;font-size:13px;line-height:2">
            ${p.items.map(item => `<li>${item}</li>`).join('')}
          </ul>
        </div>`).join('')}
      </div>
    </div>`, req.session.user));
  }));

};
