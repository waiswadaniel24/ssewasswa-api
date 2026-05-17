module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600}.badge-green{background:#d1fae5;color:#065f46}.badge-yellow{background:#fef3c7;color:#92400e}.badge-red{background:#fee2e2;color:#991b1b}.badge-blue{background:#dbeafe;color:#1e40af}.badge-gray{background:#f3f4f6;color:#374151}.stat-card{text-align:center;padding:20px}.stat-card .num{font-size:2.2em;font-weight:700}.stat-card .lbl{color:'+GRAY+';font-size:13px;margin-top:4px}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS smart_desks (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, location VARCHAR(150) NOT NULL,
        room_id VARCHAR(50), desk_type VARCHAR(50) DEFAULT 'standing',
        height_range VARCHAR(50) DEFAULT '70-120cm', sensors JSONB DEFAULT '{}',
        status VARCHAR(30) DEFAULT 'available', firmware_version VARCHAR(50),
        last_calibrated DATE, installed_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS desk_usage (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, desk_id INT NOT NULL,
        student_id INT, session_start TIMESTAMPTZ, session_end TIMESTAMPTZ,
        sitting_duration INT DEFAULT 0, standing_duration INT DEFAULT 0,
        posture_score DECIMAL(3,1), comfort_rating INT,
        notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS desk_bookings (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, desk_id INT NOT NULL,
        student_id INT, date DATE NOT NULL, period VARCHAR(50),
        purpose TEXT, status VARCHAR(30) DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[smart-desk] OK');
    } catch(e) { console.warn('[smart-desk] Warn:', e.message); }
  })();

  /* ─── Dashboard ─── */
  app.get('/school/smart-desk', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    try {
      const [desks, recentUsage, activeBookings, postureStats] = await Promise.all([
        pool.query('SELECT * FROM smart_desks WHERE tenant_id=$1 ORDER BY location, room_id', [tid]),
        pool.query(`SELECT du.*, sd.location AS desk_location, sd.desk_type, u.name AS student_name
          FROM desk_usage du JOIN smart_desks sd ON sd.id=du.desk_id
          LEFT JOIN users u ON u.id=du.student_id
          WHERE du.tenant_id=$1 ORDER BY du.session_start DESC LIMIT 30`, [tid]),
        pool.query(`SELECT db.*, sd.location AS desk_location, sd.room_id, u.name AS student_name
          FROM desk_bookings db JOIN smart_desks sd ON sd.id=db.desk_id
          LEFT JOIN users u ON u.id=db.student_id
          WHERE db.tenant_id=$1 AND db.status='active' AND db.date >= NOW()::date
          ORDER BY db.date, db.period`, [tid]),
        pool.query(`SELECT ROUND(AVG(posture_score)::numeric,1) AS avg_posture,
          MIN(posture_score) AS min_posture, MAX(posture_score) AS max_posture,
          ROUND(AVG(sitting_duration)::numeric,0) AS avg_sit,
          ROUND(AVG(standing_duration)::numeric,0) AS avg_stand
          FROM desk_usage WHERE tenant_id=$1 AND posture_score IS NOT NULL`, [tid])
      ]);
      const totalDesks = desks.rows.length;
      const availableDesks = desks.rows.filter(d => d.status === 'available').length;
      const inUse = desks.rows.filter(d => d.status === 'in_use').length;
      const todaySessions = (await pool.query("SELECT COUNT(*) FROM desk_usage WHERE tenant_id=$1 AND session_start::date=NOW()::date", [tid])).rows[0].count;
      const ps = postureStats.rows[0];

      const statusBadge = s => {
        const map = { available: 'badge-green', in_use: 'badge-blue', maintenance: 'badge-red', offline: 'badge-gray', reserved: 'badge-yellow' };
        return `<span class="badge ${map[s] || 'badge-gray'}">${s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>`;
      };

      res.send(renderPage(req, 'Smart Desk Hub', SKIP + `
        <div class="page-head">
          <h2>Smart Desk Hub</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="/school/smart-desk/desks/new" class="btn">+ Add Desk</a>
            <a href="/school/smart-desk/book" class="btn" style="background:#059669">+ Book a Desk</a>
            <a href="/school/smart-desk/analytics" class="btn" style="background:#7c3aed">Analytics</a>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px">
          <div class="card stat-card"><div class="num" style="color:${P}">${totalDesks}</div><div class="lbl">Total Desks</div></div>
          <div class="card stat-card"><div class="num" style="color:#059669">${availableDesks}</div><div class="lbl">Available</div></div>
          <div class="card stat-card"><div class="num" style="color:#3b82f6">${inUse}</div><div class="lbl">In Use</div></div>
          <div class="card stat-card"><div class="num" style="color:#f59e0b">${todaySessions}</div><div class="lbl">Today's Sessions</div></div>
          <div class="card stat-card"><div class="num" style="color:#8b5cf6">${ps.avg_posture || '-'}</div><div class="lbl>Avg Posture Score</div></div>
        </div>

        <div class="card"><h3>Desk Fleet (${desks.rows.length})</h3>
          <table><thead><tr><th>ID</th><th>Location</th><th>Room</th><th>Type</th><th>Height Range</th><th>Status</th><th>Actions</th></tr></thead>
          <tbody>${desks.rows.map(d => {
            const sensors = d.sensors || {};
            return `<tr>
              <td>Desk #${d.id}</td><td>${esc(d.location)}</td><td>${esc(d.room_id||'-')}</td>
              <td><span class="badge badge-blue">${d.desk_type}</span></td>
              <td>${esc(d.height_range)}</td><td>${statusBadge(d.status)}</td>
              <td>
                <a href="/school/smart-desk/desks/${d.id}" class="btn" style="padding:3px 8px;font-size:11px">View</a>
                <a href="/school/smart-desk/desks/${d.id}/edit" class="btn" style="padding:3px 8px;font-size:11px;background:#f59e0b;color:#000">Edit</a>
              </td>
            </tr>`;
          }).join('')}</tbody></table>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card"><h3>Recent Sessions</h3>
            <table><thead><tr><th>Time</th><th>Desk</th><th>Student</th><th>Sit Time</th><th>Stand Time</th><th>Posture</th></tr></thead>
            <tbody>${recentUsage.rows.map(u => {
              const sitMin = u.sitting_duration || 0;
              const standMin = u.standing_duration || 0;
              return `<tr>
                <td>${new Date(u.session_start).toLocaleString()}</td>
                <td>${esc(u.desk_location)} #${u.desk_id}</td>
                <td>${esc(u.student_name||'Walk-in')}</td>
                <td>${sitMin}m</td><td>${standMin}m</td>
                <td><span style="color:${(u.posture_score||0)>=8?'#059669':(u.posture_score||0)>=5?'#f59e0b':'#ef4444'}">${u.posture_score||'-'}</span></td>
              </tr>`;
            }).join('')}</tbody></table>
          </div>

          <div class="card"><h3>Active Bookings (${activeBookings.rows.length})</h3>
            <table><thead><tr><th>Date</th><th>Period</th><th>Desk</th><th>Student</th><th>Purpose</th></tr></thead>
            <tbody>${activeBookings.rows.map(b => `<tr>
              <td>${new Date(b.date).toLocaleDateString()}</td><td>${esc(b.period||'All day')}</td>
              <td>${esc(b.desk_location)} #${b.desk_id}</td><td>${esc(b.student_name||'N/A')}</td>
              <td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(b.purpose||'-')}</td>
            </tr>`).join('')}
            ${activeBookings.rows.length === 0 ? '<tr><td colspan="5" style="text-align:center;color:'+GRAY+'">No active bookings</td></tr>' : ''}
            </tbody></table>
          </div>
        </div>

        <div class="card"><h3>Posture &amp; Comfort Summary</h3>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;text-align:center">
            <div><div style="font-size:1.8em;color:#059669">${ps.avg_posture || 'N/A'}</div><div style="color:${GRAY};font-size:13px">Avg Posture Score</div></div>
            <div><div style="font-size:1.8em;color:#ef4444">${ps.min_posture || 'N/A'}</div><div style="color:${GRAY};font-size:13px">Lowest Score</div></div>
            <div><div style="font-size:1.8em;color:#3b82f6">${ps.avg_sit || 'N/A'}m</div><div style="color:${GRAY};font-size:13px">Avg Sitting / Session</div></div>
            <div><div style="font-size:1.8em;color:#8b5cf6">${ps.avg_stand || 'N/A'}m</div><div style="color:${GRAY};font-size:13px">Avg Standing / Session</div></div>
          </div>
        </div>
      `, { nav: 'smart-desk' }));
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  /* ─── Analytics Page ─── */
  app.get('/school/smart-desk/analytics', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    try {
      const [dailyUsage, postureTrend, standSitRatio, byDesk, comfortDist] = await Promise.all([
        pool.query(`SELECT session_start::date AS day, COUNT(*) AS sessions,
          ROUND(AVG(sitting_duration)::numeric,0) AS avg_sit,
          ROUND(AVG(standing_duration)::numeric,0) AS avg_stand,
          ROUND(AVG(posture_score)::numeric,1) AS avg_posture
          FROM desk_usage WHERE tenant_id=$1 AND session_start >= NOW() - INTERVAL '30 days'
          GROUP BY day ORDER BY day`, [tid]),
        pool.query(`SELECT ROUND(posture_score::numeric) AS score, COUNT(*) AS cnt
          FROM desk_usage WHERE tenant_id=$1 AND posture_score IS NOT NULL
          GROUP BY ROUND(posture_score::numeric) ORDER BY score`, [tid]),
        pool.query(`SELECT SUM(sitting_duration) AS total_sit, SUM(standing_duration) AS total_stand
          FROM desk_usage WHERE tenant_id=$1`, [tid]),
        pool.query(`SELECT sd.location, sd.desk_type, COUNT(du.id) AS sessions,
          ROUND(AVG(du.posture_score)::numeric,1) AS avg_posture,
          SUM(du.sitting_duration) AS total_sit_min,
          SUM(du.standing_duration) AS total_stand_min
          FROM smart_desks sd LEFT JOIN desk_usage du ON du.desk_id=sd.id AND du.tenant_id=$1
          WHERE sd.tenant_id=$1 GROUP BY sd.id, sd.location, sd.desk_type ORDER BY sessions DESC`, [tid]),
        pool.query(`SELECT comfort_rating, COUNT(*) AS cnt FROM desk_usage
          WHERE tenant_id=$1 AND comfort_rating IS NOT NULL GROUP BY comfort_rating ORDER BY comfort_rating`, [tid])
      ]);
      const ssr = standSitRatio.rows[0];
      const totalSit = parseInt(ssr.total_sit) || 0;
      const totalStand = parseInt(ssr.total_stand) || 0;
      const totalAll = totalSit + totalStand || 1;
      const sitPct = (totalSit / totalAll * 100).toFixed(1);
      const standPct = (totalStand / totalAll * 100).toFixed(1);
      const maxSessions = Math.max(...dailyUsage.rows.map(r => parseInt(r.sessions)), 1);

      res.send(renderPage(req, 'Smart Desk Analytics', SKIP + `
        <div class="page-head"><h2>Smart Desk Analytics</h2>
          <a href="/school/smart-desk" class="btn" style="background:${GRAY}">&larr; Back</a></div>

        <div class="card"><h3>Sit vs Stand Ratio (All Time)</h3>
          <div style="display:flex;height:40px;border-radius:8px;overflow:hidden;margin-bottom:8px">
            <div style="background:#3b82f6;width:${sitPct}%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:14px">Sitting ${sitPct}%</div>
            <div style="background:#059669;width:${standPct}%;display:flex;align-items:center;justify-content:center;color:#fff;font-weight:600;font-size:14px">Standing ${standPct}%</div>
          </div>
          <p style="color:${GRAY};font-size:13px">Total: ${(totalAll/60).toFixed(1)} hours sitting, ${(totalStand/60).toFixed(1)} hours standing</p>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card"><h3>Daily Sessions (30 days)</h3>
            <div style="display:flex;align-items:flex-end;gap:2px;height:160px">
              ${dailyUsage.rows.map(d => `<div title="${d.day}: ${d.sessions} sessions" style="flex:1;background:${P};height:${(parseInt(d.sessions)/maxSessions)*100}%;min-height:2px;border-radius:2px 2px 0 0"></div>`).join('')}
            </div>
            <div style="display:flex;justify-content:space-between;font-size:10px;color:${GRAY};margin-top:4px">
              <span>${dailyUsage.rows.length > 0 ? dailyUsage.rows[0].day : ''}</span>
              <span>${dailyUsage.rows.length > 0 ? dailyUsage.rows[dailyUsage.rows.length-1].day : ''}</span></div>
          </div>

          <div class="card"><h3>Posture Score Distribution</h3>
            <div style="display:flex;flex-direction:column;gap:4px">
              ${postureTrend.rows.map(p => {
                const maxCnt = Math.max(...postureTrend.rows.map(r => parseInt(r.cnt)), 1);
                const color = parseInt(p.score) >= 8 ? '#059669' : parseInt(p.score) >= 5 ? '#f59e0b' : '#ef4444';
                return `<div style="display:flex;align-items:center;gap:8px">
                  <span style="width:30px;text-align:right;font-size:13px">${p.score}</span>
                  <div style="flex:1;background:#f3f4f6;border-radius:4px;height:16px;overflow:hidden">
                    <div style="background:${color};height:100%;width:${(parseInt(p.cnt)/maxCnt)*100}%;border-radius:4px"></div></div>
                  <span style="width:30px;font-size:12px;color:${GRAY}">${p.cnt}</span></div>`;
              }).join('')}
            </div>
          </div>

          <div class="card"><h3>Desk Performance</h3>
            <table><thead><tr><th>Location</th><th>Type</th><th>Sessions</th><th>Avg Posture</th><th>Total Sit</th><th>Total Stand</th></tr></thead>
            <tbody>${byDesk.rows.map(d => `<tr>
              <td>${esc(d.location)}</td><td>${d.desk_type}</td><td>${d.sessions}</td>
              <td><span style="color:${(d.avg_posture||0)>=8?'#059669':(d.avg_posture||0)>=5?'#f59e0b':'#ef4444'}">${d.avg_posture||'-'}</span></td>
              <td>${d.total_sit_min ? (parseInt(d.total_sit_min)/60).toFixed(1)+'h' : '-'}</td>
              <td>${d.total_stand_min ? (parseInt(d.total_stand_min)/60).toFixed(1)+'h' : '-'}</td>
            </tr>`).join('')}</tbody></table>
          </div>

          <div class="card"><h3>Comfort Ratings</h3>
            <table><thead><tr><th>Rating</th><th>Count</th><th>Bar</th></tr></thead>
            <tbody>${comfortDist.rows.map(c => {
              const maxC = Math.max(...comfortDist.rows.map(r => parseInt(r.cnt)), 1);
              const stars = '&#9733;'.repeat(parseInt(c.comfort_rating)) + '&#9734;'.repeat(5 - parseInt(c.comfort_rating));
              return `<tr><td>${stars}</td><td>${c.cnt}</td>
                <td><div style="background:#f59e0b;height:12px;border-radius:6px;width:${(parseInt(c.cnt)/maxC)*100}%"></div></td></tr>`;
            }).join('')}
            ${comfortDist.rows.length === 0 ? '<tr><td colspan="3" style="text-align:center;color:'+GRAY+'">No ratings yet</td></tr>' : ''}
            </tbody></table>
          </div>
        </div>
      `, { nav: 'smart-desk' }));
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  /* ─── Add Desk Form ─── */
  app.get('/school/smart-desk/desks/new', requireAuth, requireNotBanned, async (req, res) => {
    res.send(renderPage(req, 'Add Smart Desk', SKIP + `
      <div class="page-head"><h2>Add Smart Desk</h2>
        <a href="/school/smart-desk" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:600px">
        <form method="POST" action="/school/smart-desk/desks">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Location *</label><input name="location" required placeholder="e.g. Building A, Floor 2"></div>
            <div><label>Room ID</label><input name="room_id" placeholder="e.g. R204"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Desk Type</label>
              <select name="desk_type">
                <option value="standing">Standing Desk</option>
                <option value="sit_stand">Sit-Stand Adjustable</option>
                <option value="traditional">Traditional (Fixed)</option>
                <option value="collaborative">Collaborative Pod</option>
                <option value="exam">Exam Desk</option>
              </select></div>
            <div><label>Height Range</label><input name="height_range" value="70-120cm" placeholder="e.g. 70-120cm"></div>
          </div>
          <div style="margin-bottom:12px"><label>Sensors (comma-separated)</label>
            <input name="sensors_list" value="pressure,proximity,height,tilt" placeholder="e.g. pressure,proximity,height,tilt,temperature"></div>
          <div style="margin-bottom:12px"><label>Firmware Version</label><input name="firmware_version" placeholder="e.g. v2.1.3"></div>
          <button type="submit" class="btn">Add Desk</button>
        </form>
      </div>
    `, { nav: 'smart-desk' }));
  });

  /* ─── Create Desk ─── */
  app.post('/school/smart-desk/desks', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { location, room_id, desk_type, height_range, sensors_list, firmware_version } = req.body;
    const sensors = sensors_list ? sensors_list.split(',').map(s => ({ type: s.trim(), status: 'active' })) : [];
    await pool.query(
      'INSERT INTO smart_desks (tenant_id, location, room_id, desk_type, height_range, sensors, firmware_version) VALUES ($1,$2,$3,$4,$5,$6,$7)',
      [tid, location, room_id, desk_type, height_range, JSON.stringify(sensors), firmware_version]
    );
    audit(req, 'smart_desk_added', { location, desk_type });
    req.flash('success', 'Smart desk added');
    res.redirect('/school/smart-desk');
  }));

  /* ─── View Desk Detail ─── */
  app.get('/school/smart-desk/desks/:id', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const desk = (await pool.query('SELECT * FROM smart_desks WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!desk) return res.status(404).send('Not found');
    const [usage, bookings] = await Promise.all([
      pool.query(`SELECT du.*, u.name AS student_name FROM desk_usage du
        LEFT JOIN users u ON u.id=du.student_id WHERE du.desk_id=$1 AND du.tenant_id=$2
        ORDER BY du.session_start DESC LIMIT 20`, [desk.id, tid]),
      pool.query(`SELECT db.*, u.name AS student_name FROM desk_bookings db
        LEFT JOIN users u ON u.id=db.student_id WHERE db.desk_id=$1 AND db.tenant_id=$2
        ORDER BY db.date DESC`, [desk.id, tid])
    ]);
    const sensors = desk.sensors || [];
    const statusBadge = s => {
      const map = { available: 'badge-green', in_use: 'badge-blue', maintenance: 'badge-red', offline: 'badge-gray', reserved: 'badge-yellow' };
      return `<span class="badge ${map[s] || 'badge-gray'}">${s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>`;
    };

    res.send(renderPage(req, 'Desk #' + desk.id, SKIP + `
      <div class="page-head"><h2>Desk #${desk.id} - ${esc(desk.location)}</h2>
        <a href="/school/smart-desk" class="btn" style="background:${GRAY}">&larr; Back</a>
        <a href="/school/smart-desk/desks/${desk.id}/edit" class="btn" style="background:#f59e0b;color:#000">Edit</a>
        <form method="POST" action="/school/smart-desk/desks/${desk.id}/calibrate" style="display:inline">
          <button class="btn" style="background:#0891b2">Calibrate</button></form>
      </div>
      <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px">
        <div>
          <div class="card" style="text-align:center">
            <div style="font-size:1.5em;margin-bottom:8px">${statusBadge(desk.status)}</div>
            <p style="color:${GRAY};font-size:13px">${esc(desk.desk_type)} &middot; ${esc(desk.height_range)}</p>
          </div>
          <div class="card"><h4>Sensors (${sensors.length})</h4>
            ${sensors.map(s => `<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f3f4f6">
              <span>${esc(s.type)}</span>
              <span class="badge badge-green">${s.status || 'active'}</span>
            </div>`).join('')}
          </div>
          <div class="card"><h4>Quick Actions</h4>
            <form method="POST" action="/school/smart-desk/desks/${desk.id}/session/start" style="margin-bottom:6px">
              <button class="btn" style="width:100%;background:#059669">Start Session</button></form>
            <form method="POST" action="/school/smart-desk/desks/${desk.id}/height" style="margin-bottom:6px">
              <div style="display:flex;gap:4px">
                <input name="height" type="number" placeholder="cm" style="flex:1" min="60" max="130">
                <button type="submit" class="btn" style="background:#7c3aed">Set Height</button></div></form>
          </div>
        </div>
        <div>
          <div class="card"><h3>Usage History</h3>
            <table><thead><tr><th>Start</th><th>Student</th><th>Sit</th><th>Stand</th><th>Posture</th><th>Comfort</th></tr></thead>
            <tbody>${usage.rows.map(u => `<tr>
              <td>${new Date(u.session_start).toLocaleString()}</td>
              <td>${esc(u.student_name||'Walk-in')}</td>
              <td>${u.sitting_duration||0}m</td><td>${u.standing_duration||0}m</td>
              <td><span style="color:${(u.posture_score||0)>=8?'#059669':(u.posture_score||0)>=5?'#f59e0b':'#ef4444'}">${u.posture_score||'-'}</span></td>
              <td>${u.comfort_rating ? '&#9733;'.repeat(u.comfort_rating) : '-'}</td>
            </tr>`).join('')}</tbody></table>
          </div>
          <div class="card"><h3>Bookings</h3>
            <table><thead><tr><th>Date</th><th>Period</th><th>Student</th><th>Purpose</th><th>Status</th></tr></thead>
            <tbody>${bookings.rows.map(b => `<tr>
              <td>${new Date(b.date).toLocaleDateString()}</td><td>${esc(b.period||'-')}</td>
              <td>${esc(b.student_name||'-')}</td><td>${esc(b.purpose||'-')}</td>
              <td><span class="badge ${b.status==='active'?'badge-green':'badge-gray'}">${b.status}</span></td>
            </tr>`).join('')}</tbody></table>
          </div>
        </div>
      </div>
    `, { nav: 'smart-desk' }));
  });

  /* ─── Edit Desk ─── */
  app.get('/school/smart-desk/desks/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const d = (await pool.query('SELECT * FROM smart_desks WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (!d) return res.status(404).send('Not found');
    const sensorList = (d.sensors || []).map(s => s.type).join(', ');
    res.send(renderPage(req, 'Edit Desk #' + d.id, SKIP + `
      <div class="page-head"><h2>Edit Desk #${d.id}</h2>
        <a href="/school/smart-desk/desks/${d.id}" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:600px">
        <form method="POST" action="/school/smart-desk/desks/${d.id}">
          <input type="hidden" name="_method" value="PUT">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Location</label><input name="location" value="${esc(d.location)}" required></div>
            <div><label>Room ID</label><input name="room_id" value="${esc(d.room_id||'')}"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Desk Type</label>
              <select name="desk_type">${['standing','sit_stand','traditional','collaborative','exam'].map(t =>
                `<option value="${t}" ${t===d.desk_type?'selected':''}>${t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('')}
              </select></div>
            <div><label>Status</label>
              <select name="status">${['available','in_use','maintenance','offline','reserved'].map(s =>
                `<option value="${s}" ${s===d.status?'selected':''}>${s.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</option>`).join('')}
              </select></div>
          </div>
          <div style="margin-bottom:12px"><label>Height Range</label><input name="height_range" value="${esc(d.height_range||'')}"></div>
          <div style="margin-bottom:12px"><label>Sensors</label><input name="sensors_list" value="${esc(sensorList)}"></div>
          <div style="margin-bottom:12px"><label>Firmware</label><input name="firmware_version" value="${esc(d.firmware_version||'')}"></div>
          <button type="submit" class="btn">Update Desk</button>
        </form>
      </div>
    `, { nav: 'smart-desk' }));
  });

  /* ─── Update Desk ─── */
  app.post('/school/smart-desk/desks/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { location, room_id, desk_type, status, height_range, sensors_list, firmware_version } = req.body;
    const sensors = sensors_list ? sensors_list.split(',').map(s => ({ type: s.trim(), status: 'active' })) : [];
    await pool.query(
      'UPDATE smart_desks SET location=$1, room_id=$2, desk_type=$3, status=$4, height_range=$5, sensors=$6, firmware_version=$7 WHERE id=$8 AND tenant_id=$9',
      [location, room_id, desk_type, status, height_range, JSON.stringify(sensors), firmware_version, req.params.id, tid]
    );
    audit(req, 'smart_desk_updated', { id: req.params.id });
    req.flash('success', 'Desk updated');
    res.redirect('/school/smart-desk/desks/' + req.params.id);
  }));

  /* ─── Calibrate Desk ─── */
  app.post('/school/smart-desk/desks/:id/calibrate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    await pool.query('UPDATE smart_desks SET last_calibrated=NOW() WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    audit(req, 'desk_calibrated', { id: req.params.id });
    req.flash('success', 'Desk calibrated successfully');
    res.redirect('/school/smart-desk/desks/' + req.params.id);
  }));

  /* ─── Start Session ─── */
  app.post('/school/smart-desk/desks/:id/session/start', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const deskId = req.params.id;
    await pool.query('UPDATE smart_desks SET status=$1 WHERE id=$2 AND tenant_id=$3', ['in_use', deskId, tid]);
    const result = await pool.query(
      'INSERT INTO desk_usage (tenant_id, desk_id, student_id, session_start) VALUES ($1,$2,$3,NOW()) RETURNING id',
      [tid, deskId, req.user.id]
    );
    audit(req, 'desk_session_started', { desk_id: deskId, session_id: result.rows[0].id });
    req.flash('success', 'Session started at Desk #' + deskId);
    res.redirect('/school/smart-desk/desks/' + deskId);
  }));

  /* ─── End Session API ─── */
  app.post('/school/smart-desk/desks/:id/session/end', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const deskId = req.params.id;
    const { sitting_duration, standing_duration, posture_score, comfort_rating } = req.body;
    const session = (await pool.query(
      'SELECT id FROM desk_usage WHERE desk_id=$1 AND tenant_id=$2 AND student_id=$3 AND session_end IS NULL ORDER BY session_start DESC LIMIT 1',
      [deskId, tid, req.user.id]
    )).rows[0];
    if (session) {
      await pool.query(
        'UPDATE desk_usage SET session_end=NOW(), sitting_duration=$1, standing_duration=$2, posture_score=$3, comfort_rating=$4 WHERE id=$5',
        [sitting_duration || 0, standing_duration || 0, posture_score || null, comfort_rating || null, session.id]
      );
    }
    await pool.query("UPDATE smart_desks SET status='available' WHERE id=$1 AND tenant_id=$2", [deskId, tid]);
    audit(req, 'desk_session_ended', { desk_id: deskId, posture_score });
    res.json({ success: true });
  }));

  /* ─── Adjust Height ─── */
  app.post('/school/smart-desk/desks/:id/height', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { height } = req.body;
    const cm = Math.min(130, Math.max(60, parseInt(height) || 75));
    const desk = (await pool.query('SELECT sensors FROM smart_desks WHERE id=$1 AND tenant_id=$2', [req.params.id, tid])).rows[0];
    if (desk) {
      const sensors = desk.sensors || [];
      const heightSensor = sensors.find(s => s.type === 'height');
      if (heightSensor) heightSensor.current = cm + 'cm';
      await pool.query('UPDATE smart_desks SET sensors=$1 WHERE id=$2 AND tenant_id=$3', [JSON.stringify(sensors), req.params.id, tid]);
    }
    audit(req, 'desk_height_adjusted', { id: req.params.id, height: cm });
    req.flash('success', `Desk height set to ${cm}cm`);
    res.redirect('/school/smart-desk/desks/' + req.params.id);
  }));

  /* ─── Book a Desk Form ─── */
  app.get('/school/smart-desk/book', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const desks = (await pool.query("SELECT * FROM smart_desks WHERE tenant_id=$1 AND status IN ('available','reserved') ORDER BY location", [tid])).rows;
    res.send(renderPage(req, 'Book a Smart Desk', SKIP + `
      <div class="page-head"><h2>Book a Smart Desk</h2>
        <a href="/school/smart-desk" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:600px">
        <form method="POST" action="/school/smart-desk/bookings">
          <div style="margin-bottom:12px"><label>Desk *</label>
            <select name="desk_id" required>
              ${desks.map(d => `<option value="${d.id}">${esc(d.location)} #${d.id} (${d.desk_type})</option>`).join('')}
            </select></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Date *</label><input name="date" type="date" required></div>
            <div><label>Period</label>
              <select name="period">
                <option value="morning">Morning (8:00-12:00)</option>
                <option value="afternoon">Afternoon (12:00-16:00)</option>
                <option value="evening">Evening (16:00-20:00)</option>
                <option value="full_day">Full Day</option>
              </select></div>
          </div>
          <div style="margin-bottom:12px"><label>Purpose</label>
            <textarea name="purpose" rows="2" placeholder="e.g. Study session, Exam prep, Collaborative project..."></textarea></div>
          <button type="submit" class="btn" style="background:#059669">Book Desk</button>
        </form>
      </div>
      <div class="card"><h3>My Bookings</h3>
        <div id="myBookings"></div>
      </div>
      <script>
        fetch('/school/smart-desk/bookings/mine').then(r=>r.json()).then(data => {
          const el = document.getElementById('myBookings');
          if (!data.length) { el.innerHTML = '<p style="color:${GRAY}">No bookings yet</p>'; return; }
          el.innerHTML = '<table><thead><tr><th>Date</th><th>Period</th><th>Desk</th><th>Status</th><th>Actions</th></tr></thead><tbody>' +
            data.map(b => '<tr><td>'+new Date(b.date).toLocaleDateString()+'</td><td>'+b.period+'</td><td>'+b.desk_location+' #'+b.desk_id+'</td><td>'+b.status+'</td>'+
            '<td>'+(b.status==='active'?'<button class="btn" style="padding:2px 8px;font-size:11px;background:#ef4444" onclick="cancelBooking('+b.id+')">Cancel</button>':'')+'</td></tr>').join('') +
            '</tbody></table>';
        });
        async function cancelBooking(id) {
          if (!confirm('Cancel this booking?')) return;
          await fetch('/school/smart-desk/bookings/'+id+'/cancel', {method:'POST'});
          location.reload();
        }
      </script>
    `, { nav: 'smart-desk' }));
  });

  /* ─── Create Booking ─── */
  app.post('/school/smart-desk/bookings', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { desk_id, date, period, purpose } = req.body;
    // Check for conflicts
    const conflict = (await pool.query(
      'SELECT id FROM desk_bookings WHERE desk_id=$1 AND tenant_id=$2 AND date=$3 AND period=$4 AND status=$5',
      [desk_id, tid, date, period, 'active']
    )).rows[0];
    if (conflict) {
      req.flash('error', 'This desk is already booked for that date/period');
      return res.redirect('/school/smart-desk/book');
    }
    await pool.query(
      'INSERT INTO desk_bookings (tenant_id, desk_id, student_id, date, period, purpose) VALUES ($1,$2,$3,$4,$5,$6)',
      [tid, desk_id, req.user.id, date, period, purpose]
    );
    audit(req, 'desk_booked', { desk_id, date, period });
    req.flash('success', 'Desk booked');
    res.redirect('/school/smart-desk/book');
  }));

  /* ─── My Bookings API ─── */
  app.get('/school/smart-desk/bookings/mine', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const bookings = (await pool.query(
      'SELECT db.*, sd.location AS desk_location FROM desk_bookings db JOIN smart_desks sd ON sd.id=db.desk_id WHERE db.tenant_id=$1 AND db.student_id=$2 ORDER BY db.date DESC',
      [tid, req.user.id]
    )).rows;
    res.json(bookings);
  }));

  /* ─── Cancel Booking ─── */
  app.post('/school/smart-desk/bookings/:id/cancel', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    await pool.query("UPDATE desk_bookings SET status='cancelled' WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    audit(req, 'desk_booking_cancelled', { id: req.params.id });
    res.json({ success: true });
  }));

  /* ─── Ergonomic Recommendations ─── */
  app.get('/school/smart-desk/ergonomics', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const studentSessions = (await pool.query(
      'SELECT ROUND(AVG(posture_score)::numeric,1) AS avg_posture, ROUND(AVG(sitting_duration)::numeric,0) AS avg_sit, ROUND(AVG(standing_duration)::numeric,0) AS avg_stand, AVG(comfort_rating) AS avg_comfort FROM desk_usage WHERE tenant_id=$1 AND student_id=$2',
      [tid, req.user.id]
    )).rows[0];

    const recommendations = [];
    if (studentSessions.avg_posture && studentSessions.avg_posture < 6) {
      recommendations.push({ icon: '🪑', title: 'Improve Posture', desc: 'Your average posture score is low. Try keeping your back straight, feet flat on the floor, and monitor at eye level.', severity: 'high' });
    }
    if (studentSessions.avg_sit && parseInt(studentSessions.avg_sit) > 90) {
      recommendations.push({ icon: '⏰', title: 'Take More Standing Breaks', desc: `You sit an average of ${studentSessions.avg_sit} minutes per session. Try standing for at least 30% of your desk time.`, severity: 'medium' });
    }
    if (studentSessions.avg_stand && parseInt(studentSessions.avg_stand) < 15) {
      recommendations.push({ icon: '🧍', title: 'Increase Standing Time', desc: 'Your standing duration is very low. Gradually increase to 15-30 minutes of standing per hour.', severity: 'medium' });
    }
    if (studentSessions.avg_comfort && parseFloat(studentSessions.avg_comfort) < 3) {
      recommendations.push({ icon: '😊', title: 'Low Comfort Score', desc: 'Your comfort rating is below average. Consider adjusting desk height, using a footrest, or changing chair.', severity: 'high' });
    }
    if (recommendations.length === 0) {
      recommendations.push({ icon: '✅', title: 'Great Ergonomics!', desc: 'Your desk usage patterns look healthy. Keep up the good balance of sitting and standing!', severity: 'good' });
    }

    res.send(renderPage(req, 'Ergonomic Recommendations', SKIP + `
      <div class="page-head"><h2>Ergonomic Recommendations</h2>
        <a href="/school/smart-desk" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="text-align:center;margin-bottom:20px">
        <h3>Your Desk Usage Profile</h3>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-top:12px">
          <div><div style="font-size:1.5em;color:${(studentSessions.avg_posture||0)>=8?'#059669':(studentSessions.avg_posture||0)>=5?'#f59e0b':'#ef4444'}">${studentSessions.avg_posture||'N/A'}</div><div style="color:${GRAY};font-size:12px">Avg Posture</div></div>
          <div><div style="font-size:1.5em;color:${P}">${studentSessions.avg_sit||'N/A'}m</div><div style="color:${GRAY};font-size:12px">Avg Sitting</div></div>
          <div><div style="font-size:1.5em;color:#8b5cf6">${studentSessions.avg_stand||'N/A'}m</div><div style="color:${GRAY};font-size:12px">Avg Standing</div></div>
          <div><div style="font-size:1.5em;color:#f59e0b">${studentSessions.avg_comfort ? parseFloat(studentSessions.avg_comfort).toFixed(1) : 'N/A'}</div><div style="color:${GRAY};font-size:12px">Avg Comfort</div></div>
        </div>
      </div>
      <h3 style="margin-bottom:12px">Personalized Recommendations</h3>
      ${recommendations.map(r => `<div class="card" style="border-left:4px solid ${r.severity==='high'?'#ef4444':r.severity==='medium'?'#f59e0b':'#059669'}">
        <div style="display:flex;align-items:center;gap:12px">
          <span style="font-size:2rem">${r.icon}</span>
          <div><h4>${r.title}</h4><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${r.desc}</p></div>
        </div>
      </div>`).join('')}
      <div class="card"><h3>General Ergonomic Tips</h3>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:12px">
          ${[
            {tip: 'Screen at arm\'s length, top at eye level', cat: 'Monitor'},
            {tip: 'Elbows at 90 degrees when typing', cat: 'Arms'},
            {tip: 'Feet flat on floor or use footrest', cat: 'Legs'},
            {tip: 'Alternate sit/stand every 30-45 min', cat: 'Movement'},
            {tip: 'Desk height: elbows at desk level when standing', cat: 'Desk Height'},
            {tip: 'Take 5-minute stretch breaks hourly', cat: 'Breaks'}
          ].map(t => `<div style="padding:12px;border:1px solid #e5e7eb;border-radius:8px">
            <span class="badge badge-blue">${t.cat}</span>
            <p style="margin-top:6px;font-size:13px">${t.tip}</p></div>`).join('')}
        </div>
      </div>
    `, { nav: 'smart-desk' }));
  });
};
