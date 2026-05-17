module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:12px;font-weight:600}.badge-green{background:#d1fae5;color:#065f46}.badge-yellow{background:#fef3c7;color:#92400e}.badge-red{background:#fee2e2;color:#991b1b}.badge-blue{background:#dbeafe;color:#1e40af}.badge-gray{background:#f3f4f6;color:#374151}.heatmap-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:2px}.heatmap-cell{aspect-ratio:1;border-radius:2px;min-width:20px;transition:all 0.2s}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS eye_tracking_sessions (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL,
        activity_type VARCHAR(50) NOT NULL, duration_sec INT DEFAULT 0,
        attention_score DECIMAL(5,2),
        fixation_points JSONB DEFAULT '[]',
        gaze_pattern JSONB DEFAULT '{}',
        date DATE DEFAULT NOW(), created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS eye_tracking_analytics (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT NOT NULL,
        avg_attention DECIMAL(5,2), peak_attention DECIMAL(5,2),
        distraction_events INT DEFAULT 0, reading_speed_wpm INT,
        focus_duration_avg INT DEFAULT 0, sessions_count INT DEFAULT 0,
        last_session_date DATE, computed_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS eye_tracking_alerts (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, student_id INT,
        alert_type VARCHAR(50) NOT NULL, message TEXT,
        threshold DECIMAL(5,2), acknowledged BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[eye-tracking] OK');
    } catch(e) { console.warn('[eye-tracking] Warn:', e.message); }
  })();

  /* ─── Dashboard ─── */
  app.get('/school/eye-tracking', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    try {
      const [sessions, analytics, alerts, recentSessions] = await Promise.all([
        pool.query(`SELECT ets.*, u.name AS student_name FROM eye_tracking_sessions ets
          JOIN users u ON u.id=ets.student_id WHERE ets.tenant_id=$1
          ORDER BY ets.created_at DESC LIMIT 40`, [tid]),
        pool.query(`SELECT eta.*, u.name AS student_name FROM eye_tracking_analytics eta
          JOIN users u ON u.id=eta.student_id WHERE eta.tenant_id=$1
          ORDER BY eta.computed_at DESC LIMIT 25`, [tid]),
        pool.query(`SELECT eta.*, u.name AS student_name FROM eye_tracking_alerts eta
          LEFT JOIN users u ON u.id=eta.student_id WHERE eta.tenant_id=$1 AND eta.acknowledged=false
          ORDER BY eta.created_at DESC LIMIT 20`, [tid]),
        pool.query(`SELECT ets.*, u.name AS student_name FROM eye_tracking_sessions ets
          JOIN users u ON u.id=ets.student_id WHERE ets.tenant_id=$1
          AND ets.date >= NOW() - INTERVAL '7 days' ORDER BY ets.created_at DESC`, [tid])
      ]);
      const totalSessions = (await pool.query("SELECT COUNT(*) FROM eye_tracking_sessions WHERE tenant_id=$1", [tid])).rows[0].count;
      const todaySessions = (await pool.query("SELECT COUNT(*) FROM eye_tracking_sessions WHERE tenant_id=$1 AND date=NOW()::date", [tid])).rows[0].count;
      const avgAttentionAll = (await pool.query("SELECT ROUND(AVG(attention_score)::numeric,1) FROM eye_tracking_sessions WHERE tenant_id=$1 AND attention_score IS NOT NULL", [tid])).rows[0].round;
      const activeAlerts = alerts.rows.length;
      const avgWpm = (await pool.query("SELECT ROUND(AVG(reading_speed_wpm)::numeric,0) FROM eye_tracking_analytics WHERE tenant_id=$1 AND reading_speed_wpm IS NOT NULL", [tid])).rows[0].round;

      const attentionColor = v => v >= 80 ? '#059669' : v >= 60 ? '#f59e0b' : '#ef4444';
      const activityBadge = a => {
        const map = { reading: 'badge-blue', exam: 'badge-yellow', lecture: 'badge-green', assignment: 'badge-gray', video: 'badge-red' };
        return `<span class="badge ${map[a] || 'badge-gray'}">${a.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>`;
      };

      res.send(renderPage(req, 'Eye Tracking Hub', SKIP + `
        <div class="page-head">
          <h2>Eye Tracking Hub</h2>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="/school/eye-tracking/sessions/new" class="btn">+ New Session</a>
            <a href="/school/eye-tracking/analytics" class="btn" style="background:#7c3aed">Analytics</a>
            <a href="/school/eye-tracking/alerts" class="btn" style="background:#ef4444">Alerts ${activeAlerts > 0 ? '('+activeAlerts+')' : ''}</a>
            <a href="/school/eye-tracking/reports" class="btn" style="background:#059669">Reports</a>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:24px">
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${totalSessions}</div><div style="color:${GRAY};font-size:13px">Total Sessions</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#3b82f6">${todaySessions}</div><div style="color:${GRAY};font-size:13px">Today</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${attentionColor(avgAttentionAll||0)}">${avgAttentionAll || 0}%</div><div style="color:${GRAY};font-size:13px">Avg Attention</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#8b5cf6">${avgWpm || 0}</div><div style="color:${GRAY};font-size:13px">Avg WPM</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#ef4444">${activeAlerts}</div><div style="color:${GRAY};font-size:13px">Active Alerts</div></div>
        </div>

        ${activeAlerts > 0 ? `<div class="card" style="border-left:4px solid #ef4444;background:#fef2f2">
          <h3 style="color:#991b1b">Active Alerts</h3>
          ${alerts.rows.slice(0, 5).map(a => `<div style="padding:8px 0;border-bottom:1px solid #fecaca">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><span class="badge badge-red">${esc(a.alert_type)}</span> <strong>${esc(a.student_name || 'Unknown')}</strong></div>
              <span style="font-size:12px;color:${GRAY}">${new Date(a.created_at).toLocaleString()}</span>
            </div>
            <p style="font-size:13px;color:#7f1d1d;margin-top:4px">${esc(a.message)}</p>
          </div>`).join('')}
          ${activeAlerts > 5 ? `<p style="color:${GRAY};font-size:13px">...and ${activeAlerts - 5} more</p>` : ''}
        </div>` : ''}

        <div class="card"><h3>Recent Tracking Sessions</h3>
          <table><thead><tr><th>Date</th><th>Student</th><th>Activity</th><th>Duration</th><th>Attention</th><th>Fixations</th><th>Actions</th></tr></thead>
          <tbody>${sessions.rows.map(s => {
            const fp = s.fixation_points || [];
            const dur = s.duration_sec || 0;
            return `<tr>
              <td>${new Date(s.date).toLocaleDateString()}</td>
              <td>${esc(s.student_name)}</td>
              <td>${activityBadge(s.activity_type)}</td>
              <td>${dur >= 60 ? Math.floor(dur/60)+'m '+dur%60+'s' : dur+'s'}</td>
              <td><span style="color:${attentionColor(s.attention_score||0)};font-weight:600">${s.attention_score||'-'}%</span></td>
              <td>${fp.length}</td>
              <td><a href="/school/eye-tracking/sessions/${s.id}" class="btn" style="padding:3px 8px;font-size:11px">View</a>
                  <a href="/school/eye-tracking/sessions/${s.id}/heatmap" class="btn" style="padding:3px 8px;font-size:11px;background:#7c3aed">Heatmap</a></td>
            </tr>`;
          }).join('')}</tbody></table>
        </div>

        <div class="card"><h3>Student Analytics Summary</h3>
          <table><thead><tr><th>Student</th><th>Avg Attention</th><th>Peak Attention</th><th>Distractions</th><th>Reading WPM</th><th>Focus Avg</th><th>Sessions</th></tr></thead>
          <tbody>${analytics.rows.map(a => `<tr>
            <td><strong>${esc(a.student_name)}</strong></td>
            <td><span style="color:${attentionColor(a.avg_attention||0)}">${a.avg_attention||'-'}%</span></td>
            <td>${a.peak_attention||'-'}%</td>
            <td>${a.distraction_events || 0}</td>
            <td>${a.reading_speed_wpm || '-'}</td>
            <td>${a.focus_duration_avg ? a.focus_duration_avg+'s' : '-'}</td>
            <td>${a.sessions_count || 0}</td>
          </tr>`).join('')}</tbody></table>
        </div>
      `, { nav: 'eye-tracking' }));
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  /* ─── New Session Form ─── */
  app.get('/school/eye-tracking/sessions/new', requireAuth, requireNotBanned, async (req, res) => {
    res.send(renderPage(req, 'New Eye Tracking Session', SKIP + `
      <div class="page-head"><h2>New Eye Tracking Session</h2>
        <a href="/school/eye-tracking" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card" style="max-width:600px">
        <form method="POST" action="/school/eye-tracking/sessions">
          <div style="margin-bottom:12px"><label>Student ID *</label>
            <input name="student_id" type="number" required placeholder="Student user ID"></div>
          <div style="margin-bottom:12px"><label>Activity Type *</label>
            <select name="activity_type" required>
              <option value="reading">Reading</option>
              <option value="exam">Exam</option>
              <option value="lecture">Lecture</option>
              <option value="assignment">Assignment</option>
              <option value="video">Video Watching</option>
              <option value="research">Research</option>
              <option value="drill">Practice Drill</option>
              <option value="other">Other</option>
            </select></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Duration (seconds)</label><input name="duration_sec" type="number" placeholder="1800"></div>
            <div><label>Attention Score (%)</label><input name="attention_score" type="number" min="0" max="100" step="0.1" placeholder="72.5"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Reading Speed (WPM)</label><input name="reading_speed_wpm" type="number" placeholder="250"></div>
            <div><label>Distraction Events</label><input name="distraction_events" type="number" value="0"></div>
          </div>
          <div style="margin-bottom:12px"><label>Notes</label>
            <textarea name="notes" rows="2" placeholder="Optional session notes"></textarea></div>
          <button type="submit" class="btn">Create Session</button>
        </form>
      </div>
    `, { nav: 'eye-tracking' }));
  });

  /* ─── Create Session ─── */
  app.post('/school/eye-tracking/sessions', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, activity_type, duration_sec, attention_score, reading_speed_wpm, distraction_events, notes } = req.body;
    const gazePattern = {
      reading_speed_wpm: reading_speed_wpm || null,
      distraction_events: distraction_events || 0,
      notes: notes || null
    };
    const result = await pool.query(
      'INSERT INTO eye_tracking_sessions (tenant_id, student_id, activity_type, duration_sec, attention_score, gaze_pattern) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [tid, student_id, activity_type, duration_sec || null, attention_score || null, JSON.stringify(gazePattern)]
    );
    // Update or create analytics record
    await pool.query(`
      INSERT INTO eye_tracking_analytics (tenant_id, student_id, avg_attention, peak_attention, distraction_events, reading_speed_wpm, focus_duration_avg, sessions_count, last_session_date)
      SELECT $1, $2,
        ROUND(AVG(attention_score)::numeric,1),
        ROUND(MAX(attention_score)::numeric,1),
        $3,
        $4,
        $5,
        COUNT(*),
        NOW()::date
      FROM eye_tracking_sessions WHERE tenant_id=$1 AND student_id=$2 AND attention_score IS NOT NULL
      ON CONFLICT (id) DO UPDATE SET
        avg_attention = EXCLUDED.avg_attention,
        peak_attention = EXCLUDED.peak_attention,
        distraction_events = EXCLUDED.distraction_events,
        reading_speed_wpm = EXCLUDED.reading_speed_wpm,
        sessions_count = EXCLUDED.sessions_count,
        last_session_date = EXCLUDED.last_session_date,
        computed_at = NOW()
    `, [tid, student_id, distraction_events || 0, reading_speed_wpm || null, duration_sec || 0]);
    // Check thresholds and create alerts
    if (attention_score && parseFloat(attention_score) < 40) {
      await pool.query(
        'INSERT INTO eye_tracking_alerts (tenant_id, student_id, alert_type, message, threshold) VALUES ($1,$2,$3,$4,$5)',
        [tid, student_id, 'low_attention', `Very low attention score of ${attention_score}% during ${activity_type}. Consider follow-up.`, 40]
      );
    }
    if (distraction_events && parseInt(distraction_events) > 10) {
      await pool.query(
        'INSERT INTO eye_tracking_alerts (tenant_id, student_id, alert_type, message, threshold) VALUES ($1,$2,$3,$4,$5)',
        [tid, student_id, 'high_distraction', `High distraction count (${distraction_events}) during ${activity_type}. Student may need support.`, 10]
      );
    }
    audit(req, 'eye_tracking_session_created', { id: result.rows[0].id, student_id, activity_type });
    req.flash('success', 'Session recorded');
    res.redirect('/school/eye-tracking');
  }));

  /* ─── View Session Detail ─── */
  app.get('/school/eye-tracking/sessions/:id', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const session = (await pool.query(
      'SELECT ets.*, u.name AS student_name FROM eye_tracking_sessions ets JOIN users u ON u.id=ets.student_id WHERE ets.id=$1 AND ets.tenant_id=$2',
      [req.params.id, tid]
    )).rows[0];
    if (!session) return res.status(404).send('Not found');
    const fixationPoints = session.fixation_points || [];
    const gazePattern = session.gaze_pattern || {};
    const attentionColor = v => v >= 80 ? '#059669' : v >= 60 ? '#f59e0b' : '#ef4444';
    const dur = session.duration_sec || 0;
    const activityBadge = a => {
      const map = { reading: 'badge-blue', exam: 'badge-yellow', lecture: 'badge-green', assignment: 'badge-gray', video: 'badge-red' };
      return `<span class="badge ${map[a] || 'badge-gray'}">${a.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>`;
    };

    res.send(renderPage(req, 'Session #' + session.id, SKIP + `
      <div class="page-head"><h2>Session #${session.id}</h2>
        <a href="/school/eye-tracking" class="btn" style="background:${GRAY}">&larr; Back</a>
        <a href="/school/eye-tracking/sessions/${session.id}/heatmap" class="btn" style="background:#7c3aed">View Heatmap</a>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
        <div>
          <div class="card">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <h3>${esc(session.student_name)} - ${activityBadge(session.activity_type)}</h3>
              <span style="font-size:13px;color:${GRAY}">${new Date(session.date).toLocaleDateString()}</span>
            </div>
            <table>
              <tr><td style="width:160px;color:${GRAY}">Duration</td><td>${dur >= 3600 ? Math.floor(dur/3600)+'h '+Math.floor((dur%3600)/60)+'m' : dur >= 60 ? Math.floor(dur/60)+'m '+dur%60+'s' : dur+'s'}</td></tr>
              <tr><td style="color:${GRAY}">Attention Score</td><td><span style="font-size:1.4em;color:${attentionColor(session.attention_score||0)};font-weight:700">${session.attention_score || 'N/A'}%</span></td></tr>
              <tr><td style="color:${GRAY}">Fixation Points</td><td>${fixationPoints.length}</td></tr>
              <tr><td style="color:${GRAY}">Reading Speed</td><td>${gazePattern.reading_speed_wpm ? gazePattern.reading_speed_wpm + ' WPM' : 'N/A'}</td></tr>
              <tr><td style="color:${GRAY}">Distraction Events</td><td>${gazePattern.distraction_events || 0}</td></tr>
              <tr><td style="color:${GRAY}">Notes</td><td>${esc(gazePattern.notes || 'None')}</td></tr>
            </table>
          </div>
          <div class="card"><h3>Engagement Visualization</h3>
            <div style="position:relative;height:80px;background:#f9fafb;border-radius:8px;overflow:hidden">
              <div style="position:absolute;left:0;top:0;bottom:0;width:${session.attention_score||0}%;background:linear-gradient(90deg,${attentionColor(session.attention_score||0)},${attentionColor(session.attention_score||0)}88);border-radius:8px;transition:width 0.5s"></div>
              <div style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-size:1.5em;font-weight:700;color:#fff;text-shadow:0 1px 2px rgba(0,0,0,.3)">${session.attention_score||0}%</div>
            </div>
            <div style="display:flex;justify-content:space-between;margin-top:6px;font-size:12px;color:${GRAY}">
              <span>0% - No Focus</span><span>50% - Moderate</span><span>100% - Full Focus</span></div>
          </div>
          ${fixationPoints.length > 0 ? `<div class="card"><h3>Fixation Points (${fixationPoints.length})</h3>
            <table><thead><tr><th>#</th><th>X</th><th>Y</th><th>Duration (ms)</th><th>Region</th></tr></thead>
            <tbody>${fixationPoints.slice(0, 20).map((fp, i) => `<tr>
              <td>${i+1}</td><td>${fp.x}</td><td>${fp.y}</td><td>${fp.duration_ms || '-'}</td><td>${esc(fp.region || '-')}</td>
            </tr>`).join('')}
            ${fixationPoints.length > 20 ? `<tr><td colspan="5" style="text-align:center;color:${GRAY}">...and ${fixationPoints.length - 20} more points</td></tr>` : ''}
            </tbody></table>
          </div>` : ''}
        </div>
        <div>
          <div class="card" style="text-align:center">
            <div style="font-size:4em;color:${attentionColor(session.attention_score||0)}">${session.attention_score||'?'}</div>
            <div style="color:${GRAY}">Attention Score</div>
            <p style="color:${GRAY};font-size:13px;margin-top:8px">${
              (session.attention_score||0) >= 85 ? 'Excellent focus and engagement' :
              (session.attention_score||0) >= 70 ? 'Good attention maintained' :
              (session.attention_score||0) >= 50 ? 'Moderate focus, some distractions' :
              (session.attention_score||0) >= 30 ? 'Low attention - intervention may help' :
              'Very low attention - immediate follow-up recommended'
            }</p>
          </div>
          <div class="card"><h4>Quick Actions</h4>
            <a href="/school/eye-tracking/sessions/${session.id}/heatmap" class="btn" style="width:100%;margin-bottom:6px;background:#7c3aed">Generate Heatmap</a>
            <button class="btn" style="width:100%;margin-bottom:6px;background:#f59e0b;color:#000" onclick="window.print()">Print Report</button>
          </div>
        </div>
      </div>
    `, { nav: 'eye-tracking' }));
  });

  /* ─── Heatmap Visualization ─── */
  app.get('/school/eye-tracking/sessions/:id/heatmap', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const session = (await pool.query(
      'SELECT ets.*, u.name AS student_name FROM eye_tracking_sessions ets JOIN users u ON u.id=ets.student_id WHERE ets.id=$1 AND ets.tenant_id=$2',
      [req.params.id, tid]
    )).rows[0];
    if (!session) return res.status(404).send('Not found');
    const fixationPoints = session.fixation_points || [];
    // Generate a simulated heatmap grid based on fixation data
    const gridSize = 10;
    const grid = Array.from({length: gridSize}, () => Array.from({length: gridSize}, () => 0));
    if (fixationPoints.length > 0) {
      fixationPoints.forEach(fp => {
        const gx = Math.min(gridSize-1, Math.max(0, Math.floor((fp.x || 50) / 100 * gridSize)));
        const gy = Math.min(gridSize-1, Math.max(0, Math.floor((fp.y || 50) / 100 * gridSize)));
        grid[gy][gx] += (fp.duration_ms || 200) / 100;
        // Spread heat to neighbors
        if (gx > 0) grid[gy][gx-1] += 0.3;
        if (gx < gridSize-1) grid[gy][gx+1] += 0.3;
        if (gy > 0) grid[gy-1][gx] += 0.3;
        if (gy < gridSize-1) grid[gy+1][gx] += 0.3;
      });
    } else {
      // Generate simulated pattern if no real data
      for (let y = 0; y < gridSize; y++) {
        for (let x = 0; x < gridSize; x++) {
          grid[y][x] = Math.random() * 5 + (y < 3 ? 3 : 0); // More attention at top
        }
      }
    }
    const maxVal = Math.max(...grid.flat(), 1);

    res.send(renderPage(req, 'Heatmap - Session #' + session.id, SKIP + `
      <div class="page-head"><h2>Gaze Heatmap - ${esc(session.student_name)}</h2>
        <a href="/school/eye-tracking/sessions/${session.id}" class="btn" style="background:${GRAY}">&larr; Back to Session</a>
      </div>
      <div class="card">
        <div style="display:flex;gap:20px;flex-wrap:wrap">
          <div style="flex:1;min-width:300px">
            <h3>Visual Attention Heatmap</h3>
            <p style="color:${GRAY};font-size:13px;margin-bottom:12px">${session.activity_type} &middot; ${(session.duration_sec||0)}s &middot; ${fixationPoints.length} fixation points</p>
            <div style="background:#f9fafb;border-radius:8px;padding:16px;border:1px solid #e5e7eb">
              <div style="display:flex;justify-content:space-between;margin-bottom:8px;font-size:11px;color:${GRAY}">
                <span>Left / Start</span><span>Right / End</span></div>
              <div class="heatmap-grid">
                ${grid.map(row => row.map(val => {
                  const intensity = Math.min(1, val / maxVal);
                  const r = Math.round(255);
                  const g = Math.round(255 * (1 - intensity * 0.8));
                  const b = Math.round(255 * (1 - intensity));
                  return `<div class="heatmap-cell" style="background:rgba(${r},${g},${b},${0.2+intensity*0.8});border-radius:3px" title="Intensity: ${val.toFixed(1)}"></div>`;
                }).join('')).join('')}
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:8px;font-size:11px;color:${GRAY}">
                <span>Top</span><span>Bottom</span></div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-top:12px;font-size:12px;color:${GRAY}">
              <span>Low focus</span>
              <div style="flex:1;height:12px;border-radius:6px;background:linear-gradient(90deg,#dbeafe,#3b82f6,#7c3aed,#ef4444)"></div>
              <span>High focus</span>
            </div>
          </div>
          <div style="flex:0 0 300px">
            <div class="card"><h4>Heatmap Insights</h4>
              <div style="margin-bottom:10px">
                ${(() => {
                  const topRow = grid[0].reduce((s,v) => s+v, 0);
                  const midRow = grid[4].reduce((s,v) => s+v, 0);
                  const botRow = grid[9].reduce((s,v) => s+v, 0);
                  const leftCol = grid.reduce((s,r) => s+r[0], 0);
                  const rightCol = grid.reduce((s,r) => s+r[9], 0);
                  const center = grid.slice(3,7).reduce((s,r) => s + r.slice(3,7).reduce((ss,v) => ss+v, 0), 0);
                  return `
                    <p style="font-size:13px;margin-bottom:6px">&#128065; <strong>Primary focus:</strong> ${topRow > botRow ? 'Upper portion' : 'Lower portion'} of content</p>
                    <p style="font-size:13px;margin-bottom:6px">&#128200; <strong>Reading pattern:</strong> ${leftCol > rightCol ? 'Left-to-right flow' : rightCol > leftCol ? 'Right-focused' : 'Balanced'}</p>
                    <p style="font-size:13px;margin-bottom:6px">&#127919; <strong>Center engagement:</strong> ${center > maxVal * 20 ? 'Strong center focus' : 'Scattered attention'}</p>
                    <p style="font-size:13px">&#9888;&#65039; <strong>Coverage:</strong> ${fixationPoints.length > 50 ? 'Comprehensive scanning' : fixationPoints.length > 20 ? 'Moderate coverage' : 'Limited scanning area'}</p>
                  `;
                })()}
              </div>
            </div>
            <div class="card"><h4>Session Summary</h4>
              <table style="font-size:13px">
                <tr><td style="color:${GRAY}">Student</td><td>${esc(session.student_name)}</td></tr>
                <tr><td style="color:${GRAY}">Activity</td><td>${session.activity_type}</td></tr>
                <tr><td style="color:${GRAY}">Duration</td><td>${session.duration_sec}s</td></tr>
                <tr><td style="color:${GRAY}">Attention</td><td>${session.attention_score}%</td></tr>
                <tr><td style="color:${GRAY}">Points</td><td>${fixationPoints.length}</td></tr>
              </table>
            </div>
          </div>
        </div>
      </div>
    `, { nav: 'eye-tracking' }));
  });

  /* ─── Analytics Page ─── */
  app.get('/school/eye-tracking/analytics', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const [byActivity, attentionTrend, topStudents, wpmDist, focusDist] = await Promise.all([
      pool.query(`SELECT activity_type, COUNT(*) AS cnt, ROUND(AVG(attention_score)::numeric,1) AS avg_att,
        ROUND(AVG(duration_sec)::numeric,0) AS avg_dur
        FROM eye_tracking_sessions WHERE tenant_id=$1 AND attention_score IS NOT NULL
        GROUP BY activity_type ORDER BY cnt DESC`, [tid]),
      pool.query(`SELECT date, COUNT(*) AS sessions, ROUND(AVG(attention_score)::numeric,1) AS avg_att
        FROM eye_tracking_sessions WHERE tenant_id=$1 AND attention_score IS NOT NULL
        AND date >= NOW() - INTERVAL '30 days'
        GROUP BY date ORDER BY date`, [tid]),
      pool.query(`SELECT u.name, eta.avg_attention, eta.peak_attention, eta.reading_speed_wpm,
        eta.distraction_events, eta.sessions_count
        FROM eye_tracking_analytics eta JOIN users u ON u.id=eta.student_id
        WHERE eta.tenant_id=$1 ORDER BY eta.avg_attention DESC LIMIT 20`, [tid]),
      pool.query(`SELECT CASE WHEN reading_speed_wpm < 150 THEN 'Slow (<150)' WHEN reading_speed_wpm < 250 THEN 'Average (150-250)' WHEN reading_speed_wpm < 350 THEN 'Good (250-350)' ELSE 'Excellent (350+)' END AS range, COUNT(*) AS cnt FROM eye_tracking_analytics WHERE tenant_id=$1 AND reading_speed_wpm IS NOT NULL GROUP BY range ORDER BY MIN(reading_speed_wpm)`, [tid]),
      pool.query(`SELECT CASE WHEN avg_attention < 40 THEN 'Very Low' WHEN avg_attention < 60 THEN 'Low' WHEN avg_attention < 75 THEN 'Moderate' WHEN avg_attention < 85 THEN 'Good' ELSE 'Excellent' END AS level, COUNT(*) AS cnt FROM eye_tracking_analytics WHERE tenant_id=$1 AND avg_attention IS NOT NULL GROUP BY level ORDER BY MIN(avg_attention)`, [tid])
    ]);
    const maxTrend = Math.max(...attentionTrend.rows.map(r => parseInt(r.sessions)), 1);
    const attentionColor = v => v >= 80 ? '#059669' : v >= 60 ? '#f59e0b' : '#ef4444';

    res.send(renderPage(req, 'Eye Tracking Analytics', SKIP + `
      <div class="page-head"><h2>Eye Tracking Analytics</h2>
        <a href="/school/eye-tracking" class="btn" style="background:${GRAY}">&larr; Back</a></div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card"><h3>Session Trend (30 days)</h3>
          <div style="display:flex;align-items:flex-end;gap:2px;height:150px">
            ${attentionTrend.rows.map(d => `<div title="${d.date}: ${d.sessions} sessions, avg ${d.avg_att}%" style="flex:1;background:${P};height:${(parseInt(d.sessions)/maxTrend)*100}%;min-height:2px;border-radius:2px 2px 0 0"></div>`).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;font-size:10px;color:${GRAY};margin-top:4px">
            <span>${attentionTrend.rows[0]?.date || ''}</span><span>${attentionTrend.rows[attentionTrend.rows.length-1]?.date || ''}</span></div>
        </div>

        <div class="card"><h3>Activity Breakdown</h3>
          <table><thead><tr><th>Activity</th><th>Sessions</th><th>Avg Attention</th><th>Avg Duration</th></tr></thead>
          <tbody>${byActivity.rows.map(a => `<tr>
            <td>${a.activity_type.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</td>
            <td>${a.cnt}</td>
            <td style="color:${attentionColor(a.avg_att||0)}">${a.avg_att||'-'}%</td>
            <td>${a.avg_dur ? Math.floor(a.avg_dur/60)+'m' : '-'}</td>
          </tr>`).join('')}</tbody></table>
        </div>

        <div class="card"><h3>Reading Speed Distribution</h3>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${wpmDist.rows.map(w => {
              const maxC = Math.max(...wpmDist.rows.map(r => parseInt(r.cnt)), 1);
              return `<div><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px">
                <span>${w.range}</span><span>${w.cnt}</span></div>
                <div style="background:#f3f4f6;border-radius:4px;height:16px;overflow:hidden">
                  <div style="background:${P};height:100%;width:${(parseInt(w.cnt)/maxC)*100}%;border-radius:4px"></div></div></div>`;
            }).join('')}
            ${wpmDist.rows.length === 0 ? '<p style="color:'+GRAY+';text-align:center">No data yet</p>' : ''}
          </div>
        </div>

        <div class="card"><h3>Attention Level Distribution</h3>
          <div style="display:flex;flex-direction:column;gap:6px">
            ${focusDist.rows.map(f => {
              const maxC = Math.max(...focusDist.rows.map(r => parseInt(r.cnt)), 1);
              const color = f.level === 'Excellent' ? '#059669' : f.level === 'Good' ? '#3b82f6' : f.level === 'Moderate' ? '#f59e0b' : '#ef4444';
              return `<div><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px">
                <span style="color:${color}">${f.level}</span><span>${f.cnt} students</span></div>
                <div style="background:#f3f4f6;border-radius:4px;height:16px;overflow:hidden">
                  <div style="background:${color};height:100%;width:${(parseInt(f.cnt)/maxC)*100}%;border-radius:4px"></div></div></div>`;
            }).join('')}
          </div>
        </div>

        <div class="card" style="grid-column:1/-1"><h3>Student Performance Rankings</h3>
          <table><thead><tr><th>Rank</th><th>Student</th><th>Avg Attention</th><th>Peak</th><th>Reading WPM</th><th>Distractions</th><th>Sessions</th></tr></thead>
          <tbody>${topStudents.map((s, i) => `<tr>
            <td style="font-weight:700;color:${i<3?'#f59e0b':GRAY}">${i+1}</td>
            <td><strong>${esc(s.name)}</strong></td>
            <td><span style="color:${attentionColor(s.avg_attention||0)};font-weight:600">${s.avg_attention||'-'}%</span></td>
            <td>${s.peak_attention||'-'}%</td>
            <td>${s.reading_speed_wpm||'-'}</td>
            <td>${s.distraction_events||0}</td>
            <td>${s.sessions_count||0}</td>
          </tr>`).join('')}</tbody></table>
        </div>
      </div>
    `, { nav: 'eye-tracking' }));
  });

  /* ─── Alerts Page ─── */
  app.get('/school/eye-tracking/alerts', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const [activeAlerts, allAlerts] = await Promise.all([
      pool.query(`SELECT eta.*, u.name AS student_name FROM eye_tracking_alerts eta
        LEFT JOIN users u ON u.id=eta.student_id WHERE eta.tenant_id=$1 AND eta.acknowledged=false
        ORDER BY eta.created_at DESC`, [tid]),
      pool.query(`SELECT eta.*, u.name AS student_name FROM eye_tracking_alerts eta
        LEFT JOIN users u ON u.id=eta.student_id WHERE eta.tenant_id=$1
        ORDER BY eta.created_at DESC LIMIT 50`, [tid])
    ]);
    const alertTypeBadge = t => {
      const map = { low_attention: 'badge-red', high_distraction: 'badge-yellow', low_comprehension: 'badge-red', fatigue_detected: 'badge-yellow', irregular_pattern: 'badge-blue' };
      return `<span class="badge ${map[t] || 'badge-gray'}">${t.replace(/_/g,' ').replace(/\b\w/g,c=>c.toUpperCase())}</span>`;
    };

    res.send(renderPage(req, 'Eye Tracking Alerts', SKIP + `
      <div class="page-head"><h2>Attention &amp; Focus Alerts</h2>
        <a href="/school/eye-tracking" class="btn" style="background:${GRAY}">&larr; Back</a>
        ${activeAlerts.rows.length > 0 ? `<button class="btn" style="background:#059669" onclick="acknowledgeAll()">Acknowledge All</button>` : ''}
      </div>

      ${activeAlerts.rows.length > 0 ? `<div class="card" style="border:2px solid #ef4444">
        <h3 style="color:#991b1b">Active Alerts (${activeAlerts.rows.length})</h3>
        ${activeAlerts.rows.map(a => `<div style="padding:12px 0;border-bottom:1px solid #fecaca">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>${alertTypeBadge(a.alert_type)} <strong>${esc(a.student_name||'System')}</strong></div>
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:12px;color:${GRAY}">${new Date(a.created_at).toLocaleString()}</span>
              <form method="POST" action="/school/eye-tracking/alerts/${a.id}/acknowledge" style="display:inline">
                <button class="btn" style="padding:3px 10px;font-size:11px;background:#059669">Ack</button></form>
            </div>
          </div>
          <p style="font-size:13px;margin-top:6px">${esc(a.message)}</p>
          ${a.threshold ? `<p style="font-size:11px;color:${GRAY}">Threshold: ${a.threshold}%</p>` : ''}
        </div>`).join('')}
      </div>` : '<div class="card" style="text-align:center;padding:40px;color:#059669;font-size:1.2em">No active alerts</div>'}

      <div class="card"><h3>All Alerts History</h3>
        <table><thead><tr><th>Time</th><th>Student</th><th>Type</th><th>Message</th><th>Status</th></tr></thead>
        <tbody>${allAlerts.rows.map(a => `<tr>
          <td style="white-space:nowrap">${new Date(a.created_at).toLocaleString()}</td>
          <td>${esc(a.student_name||'-')}</td>
          <td>${alertTypeBadge(a.alert_type)}</td>
          <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis">${esc(a.message)}</td>
          <td><span class="badge ${a.acknowledged ? 'badge-green' : 'badge-red'}">${a.acknowledged ? 'Acknowledged' : 'Active'}</span></td>
        </tr>`).join('')}</tbody></table>
      </div>
      <script>
        async function acknowledgeAll() {
          if (!confirm('Acknowledge all active alerts?')) return;
          await fetch('/school/eye-tracking/alerts/acknowledge-all', {method:'POST'});
          location.reload();
        }
      </script>
    `, { nav: 'eye-tracking' }));
  });

  /* ─── Acknowledge Alert ─── */
  app.post('/school/eye-tracking/alerts/:id/acknowledge', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    await pool.query("UPDATE eye_tracking_alerts SET acknowledged=true WHERE id=$1 AND tenant_id=$2", [req.params.id, tid]);
    audit(req, 'eye_tracking_alert_acknowledged', { id: req.params.id });
    req.flash('success', 'Alert acknowledged');
    res.redirect('/school/eye-tracking/alerts');
  }));

  /* ─── Acknowledge All Alerts ─── */
  app.post('/school/eye-tracking/alerts/acknowledge-all', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    await pool.query("UPDATE eye_tracking_alerts SET acknowledged=true WHERE tenant_id=$1 AND acknowledged=false", [tid]);
    audit(req, 'eye_tracking_alerts_ack_all', {});
    res.json({ success: true });
  }));

  /* ─── Reports Page ─── */
  app.get('/school/eye-tracking/reports', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const students = (await pool.query(
      'SELECT DISTINCT u.id, u.name FROM eye_tracking_sessions ets JOIN users u ON u.id=ets.student_id WHERE ets.tenant_id=$1 ORDER BY u.name',
      [tid]
    )).rows;

    res.send(renderPage(req, 'Eye Tracking Reports', SKIP + `
      <div class="page-head"><h2>Eye Tracking Reports</h2>
        <a href="/school/eye-tracking" class="btn" style="background:${GRAY}">&larr; Back</a></div>

      <div class="card" style="max-width:600px">
        <h3>Generate Report</h3>
        <form method="POST" action="/school/eye-tracking/reports/generate">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Student</label>
              <select name="student_id">
                <option value="">All Students</option>
                ${students.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
              </select></div>
            <div><label>Activity Type</label>
              <select name="activity_type">
                <option value="">All Activities</option>
                <option value="reading">Reading</option><option value="exam">Exam</option>
                <option value="lecture">Lecture</option><option value="assignment">Assignment</option>
                <option value="video">Video</option>
              </select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label>Start Date</label><input name="start_date" type="date"></div>
            <div><label>End Date</label><input name="end_date" type="date"></div>
          </div>
          <button type="submit" class="btn" style="background:#059669">Generate Report</button>
        </form>
      </div>

      <div class="card"><h3>Report Templates</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
          ${[
            {title: 'Individual Student Report', desc: 'Comprehensive eye tracking analysis for a single student including attention trends, reading speed, and focus patterns.', icon: '👤'},
            {title: 'Class Comparison Report', desc: 'Compare attention and engagement metrics across an entire class. Identifies students who may need additional support.', icon: '📊'},
            {title: 'Reading Proficiency Report', desc: 'Analyze reading speed, comprehension correlation, and visual scanning patterns for literacy assessment.', icon: '📖'},
            {title: 'Engagement Trend Report', desc: 'Track attention and focus trends over time to identify patterns and measure intervention effectiveness.', icon: '📈'},
            {title: 'Exam Focus Report', desc: 'Detailed analysis of student attention during examinations. Detect potential focus issues or test anxiety.', icon: '📝'},
            {title: 'Accessibility Assessment', desc: 'Evaluate eye tracking data for accessibility support needs. Identify students who may benefit from visual aids.', icon: '♿'}
          ].map(t => `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px">
            <div style="font-size:2rem;margin-bottom:8px">${t.icon}</div>
            <h4>${t.title}</h4>
            <p style="color:${GRAY};font-size:12px;margin-top:6px">${t.desc}</p>
          </div>`).join('')}
        </div>
      </div>
    `, { nav: 'eye-tracking' }));
  });

  /* ─── Generate Report ─── */
  app.post('/school/eye-tracking/reports/generate', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, activity_type, start_date, end_date } = req.body;
    let where = 'WHERE ets.tenant_id=$1';
    const params = [tid];
    let pIdx = 2;
    if (student_id) { where += ` AND ets.student_id=$${pIdx++}`; params.push(student_id); }
    if (activity_type) { where += ` AND ets.activity_type=$${pIdx++}`; params.push(activity_type); }
    if (start_date) { where += ` AND ets.date >= $${pIdx++}`; params.push(start_date); }
    if (end_date) { where += ` AND ets.date <= $${pIdx++}`; params.push(end_date); }

    const report = (await pool.query(`
      SELECT ets.*, u.name AS student_name
      FROM eye_tracking_sessions ets JOIN users u ON u.id=ets.student_id
      ${where} ORDER BY ets.date DESC, ets.created_at DESC`, params)).rows;

    const totalSessions = report.length;
    const avgAttention = totalSessions > 0 ? (report.reduce((s,r) => s + (parseFloat(r.attention_score)||0), 0) / totalSessions).toFixed(1) : 0;
    const totalDuration = report.reduce((s,r) => s + (r.duration_sec||0), 0);
    const totalFixations = report.reduce((s,r) => s + (r.fixation_points||[]).length, 0);

    res.send(renderPage(req, 'Generated Report', SKIP + `
      <div class="page-head"><h2>Eye Tracking Report</h2>
        <a href="/school/eye-tracking/reports" class="btn" style="background:${GRAY}">&larr; Back</a>
        <button class="btn" style="background:#059669" onclick="window.print()">Print Report</button></div>
      <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:24px">
        <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${totalSessions}</div><div style="color:${GRAY}">Sessions</div></div>
        <div class="card" style="text-align:center"><div style="font-size:2em;color:#059669">${avgAttention}%</div><div style="color:${GRAY}">Avg Attention</div></div>
        <div class="card" style="text-align:center"><div style="font-size:2em;color:#3b82f6">${Math.floor(totalDuration/60)}m</div><div style="color:${GRAY}">Total Duration</div></div>
        <div class="card" style="text-align:center"><div style="font-size:2em;color:#8b5cf6">${totalFixations}</div><div style="color:${GRAY}">Fixation Points</div></div>
      </div>
      <div class="card"><h3>Sessions in Report</h3>
        <table><thead><tr><th>Date</th><th>Student</th><th>Activity</th><th>Duration</th><th>Attention</th></tr></thead>
        <tbody>${report.map(r => `<tr>
          <td>${new Date(r.date).toLocaleDateString()}</td><td>${esc(r.student_name)}</td>
          <td>${r.activity_type}</td><td>${r.duration_sec||0}s</td>
          <td>${r.attention_score||'-'}%</td>
        </tr>`).join('')}
        ${totalSessions === 0 ? '<tr><td colspan="5" style="text-align:center;color:'+GRAY+'">No sessions match the criteria</td></tr>' : ''}
        </tbody></table>
      </div>
    `, { nav: 'eye-tracking' }));
  });

  /* ─── Session Log API (for real-time eye tracking devices) ─── */
  app.post('/school/eye-tracking/api/log', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, activity_type, duration_sec, attention_score, fixation_points, gaze_data } = req.body;
    const result = await pool.query(
      'INSERT INTO eye_tracking_sessions (tenant_id, student_id, activity_type, duration_sec, attention_score, fixation_points, gaze_pattern) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [tid, student_id, activity_type, duration_sec || null, attention_score || null, JSON.stringify(fixation_points || []), JSON.stringify(gaze_data || {})]
    );
    // Auto-alert on low attention
    if (attention_score && parseFloat(attention_score) < 30) {
      await pool.query(
        'INSERT INTO eye_tracking_alerts (tenant_id, student_id, alert_type, message, threshold) VALUES ($1,$2,$3,$4,$5)',
        [tid, student_id, 'low_attention', `Critical: ${attention_score}% attention during ${activity_type}`, 30]
      );
    }
    res.json({ logged: true, session_id: result.rows[0].id });
  }));

  /* ─── Accessibility Support Page ─── */
  app.get('/school/eye-tracking/accessibility', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.user.tenant_id;
    const lowAttentionStudents = (await pool.query(
      'SELECT eta.*, u.name AS student_name FROM eye_tracking_analytics eta JOIN users u ON u.id=eta.student_id WHERE eta.tenant_id=$1 AND eta.avg_attention < 50 ORDER BY eta.avg_attention ASC LIMIT 15',
      [tid]
    )).rows;

    res.send(renderPage(req, 'Eye Tracking Accessibility', SKIP + `
      <div class="page-head"><h2>Accessibility Support</h2>
        <a href="/school/eye-tracking" class="btn" style="background:${GRAY}">&larr; Back</a></div>
      <div class="card"><h3>Students Who May Need Visual Support</h3>
        <p style="color:${GRAY};margin-bottom:12px">Based on eye tracking data, these students show patterns that may indicate visual or attention support needs.</p>
        ${lowAttentionStudents.length > 0 ? `<table><thead><tr><th>Student</th><th>Avg Attention</th><th>Peak</th><th>Distractions</th><th>Sessions</th><th>Recommendation</th></tr></thead>
        <tbody>${lowAttentionStudents.map(s => `<tr>
          <td><strong>${esc(s.name)}</strong></td>
          <td style="color:#ef4444;font-weight:600">${s.avg_attention}%</td>
          <td>${s.peak_attention||'-'}%</td>
          <td>${s.distraction_events||0}</td>
          <td>${s.sessions_count||0}</td>
          <td style="font-size:12px">${
            s.avg_attention < 30 ? 'Immediate visual assessment recommended' :
            'Consider larger fonts, higher contrast materials'
          }</td>
        </tr>`).join('')}</tbody></table>` :
        '<p style="text-align:center;color:#059669;padding:20px">No students currently flagged for visual support</p>'}
      </div>
      <div class="card"><h3>Accessibility Features</h3>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
          ${[
            {feat: 'Text-to-Speech Integration', desc: 'Auto-trigger TTS when low reading speed detected', icon: '🔊'},
            {feat: 'Font Size Adjustment', desc: 'Recommend larger fonts based on fixation patterns', icon: '🔤'},
            {feat: 'Contrast Enhancement', desc: 'Suggest high-contrast mode for students with visual difficulties', icon: '🔲'},
            {feat: 'Break Reminders', desc: 'Automatic break suggestions based on fatigue detection', icon: '⏰'},
            {feat: 'Focus Guides', desc: 'Visual focus guides that follow gaze patterns', icon: '🎯'},
            {feat: 'Audio Descriptions', desc: 'Provide audio alternatives when visual engagement drops', icon: '🎧'}
          ].map(f => `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px">
            <div style="font-size:1.5rem;margin-bottom:6px">${f.icon}</div>
            <h4>${f.feat}</h4>
            <p style="color:${GRAY};font-size:12px;margin-top:4px">${f.desc}</p>
          </div>`).join('')}
        </div>
      </div>
    `, { nav: 'eye-tracking' }));
  });
};
