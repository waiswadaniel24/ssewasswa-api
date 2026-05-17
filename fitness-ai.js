module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS fitness_assessments (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        type VARCHAR(100) NOT NULL, scores JSONB DEFAULT '{}',
        overall_score DECIMAL(5,1), date DATE DEFAULT CURRENT_DATE, assessed_by INTEGER
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS fitness_routines (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, name VARCHAR(200) NOT NULL,
        exercises JSONB DEFAULT '[]', difficulty VARCHAR(20) DEFAULT 'beginner',
        target_group VARCHAR(100), duration_min INTEGER DEFAULT 30
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS fitness_logs (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        routine_id INTEGER, exercises_completed JSONB DEFAULT '[]',
        duration_min INTEGER DEFAULT 0, calories_burned DECIMAL(8,1) DEFAULT 0,
        date DATE DEFAULT CURRENT_DATE
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS fitness_challenges (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, title VARCHAR(200) NOT NULL,
        description TEXT, start_date DATE, end_date DATE,
        metric VARCHAR(100), participants JSONB DEFAULT '[]'
      )`);
      console.log('[fitness-ai] OK');
    } catch(e) { console.warn('[fitness-ai] Warn:', e.message); }
  })();

  // Helper: Fitness badge calculation
  function calculateBadges(logs) {
    if (!logs || !logs.length) return [];
    const badges = [];
    const totalLogs = logs.length;
    const totalMin = logs.reduce((s, l) => s + (l.duration_min || 0), 0);
    const totalCal = logs.reduce((s, l) => s + parseFloat(l.calories_burned || 0), 0);
    if (totalLogs >= 10) badges.push({ name: 'Dedicated', icon: '🏆', color: '#f59e0b' });
    if (totalLogs >= 25) badges.push({ name: 'Committed', icon: '💎', color: '#8b5cf6' });
    if (totalLogs >= 50) badges.push({ name: 'Iron Will', icon: '🔥', color: '#ef4444' });
    if (totalMin >= 300) badges.push({ name: '5 Hour Club', icon: '⏱️', color: '#3b82f6' });
    if (totalMin >= 600) badges.push({ name: '10 Hour Club', icon: '⏱️', color: '#059669' });
    if (totalMin >= 1500) badges.push({ name: 'Marathoner', icon: '🏃', color: '#dc2626' });
    if (totalCal >= 1000) badges.push({ name: 'Calorie Crusher', icon: '💪', color: '#f97316' });
    if (totalCal >= 5000) badges.push({ name: 'Inferno', icon: '🔥', color: '#dc2626' });
    const streak = calcStreak(logs);
    if (streak >= 3) badges.push({ name: '3-Day Streak', icon: '⚡', color: '#eab308' });
    if (streak >= 7) badges.push({ name: '7-Day Streak', icon: '⚡', color: '#f97316' });
    if (streak >= 14) badges.push({ name: '14-Day Streak', icon: '⚡', color: '#ef4444' });
    if (streak >= 30) badges.push({ name: 'Monthly Warrior', icon: '⚡', color: '#dc2626' });
    return badges;
  }

  // Helper: Streak calculation
  function calcStreak(logs) {
    if (!logs || !logs.length) return 0;
    const dates = [...new Set(logs.map(l => l.date?.toISOString().split('T')[0]))].sort().reverse();
    let streak = 0;
    const today = new Date();
    for (let i = 0; i < dates.length; i++) {
      const expected = new Date(today);
      expected.setDate(today.getDate() - i);
      const expStr = expected.toISOString().split('T')[0];
      if (dates.includes(expStr)) streak++;
      else if (i > 0) break;
    }
    return streak;
  }

  // Helper: SVG chart builders
  function svgBarChart(data, width, height, label) {
    if (!data.length) return '<p style="color:' + GRAY + '">No data available</p>';
    const max = Math.max(...data.map(d => d.value), 1);
    const barW = Math.max(16, (width - 60) / data.length - 8);
    let bars = '';
    data.forEach((d, i) => {
      const h = (d.value / max) * (height - 50);
      const x = 40 + i * (barW + 8);
      bars += `<rect x="${x}" y="${height - 30 - h}" width="${barW}" height="${h}" fill="${d.color || P}" rx="4"/>`;
      bars += `<text x="${x + barW/2}" y="${height - 12}" text-anchor="middle" font-size="9" fill="${GRAY}">${esc(String(d.label).substring(0, 10))}</text>`;
      bars += `<text x="${x + barW/2}" y="${height - 35 - h}" text-anchor="middle" font-size="9" fill="${GRAY}">${d.value}</text>`;
    });
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="${width/2}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="${P}">${esc(label)}</text>${bars}</svg>`;
  }

  function svgLineChart(data, width, height, label) {
    if (data.length < 2) return '<p style="color:' + GRAY + '">Need more data points</p>';
    const max = Math.max(...data.map(d => d.value), 1);
    const min = Math.min(...data.map(d => d.value), 0);
    const range = max - min || 1;
    const stepX = (width - 60) / (data.length - 1);
    const chartH = height - 50;
    const points = data.map((d, i) => {
      const x = 40 + i * stepX;
      const y = height - 30 - ((d.value - min) / range) * chartH;
      return `${x},${y}`;
    }).join(' ');
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="${width/2}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="${P}">${esc(label)}</text>
      <polyline fill="none" stroke="${P}" stroke-width="2" points="${points}"/>
      ${data.map((d, i) => {
        const x = 40 + i * stepX;
        const y = height - 30 - ((d.value - min) / range) * chartH;
        return `<circle cx="${x}" cy="${y}" r="4" fill="${d.color || P}"/>`;
      }).join('')}
      ${data.map((d, i) => `<text x="${40 + i * stepX}" y="${height - 12}" text-anchor="middle" font-size="9" fill="${GRAY}">${esc(String(d.label).substring(0, 8))}</text>`).join('')}
    </svg>`;
  }

  function svgDonut(data, size, label) {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    let offset = 0, arcs = '';
    const r = size / 2 - 20, cx = size / 2, cy = size / 2 + 10;
    data.forEach(d => {
      const pct = d.value / total;
      const circ = 2 * Math.PI * r;
      const dash = pct * circ;
      arcs += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="28" stroke-dasharray="${dash} ${circ - dash}" stroke-dashoffset="${-offset}" transform="rotate(-90 ${cx} ${cy})"/>`;
      offset += dash;
    });
    let legend = data.map(d => {
      const pct = Math.round((d.value / total) * 100);
      return `<span style="display:inline-flex;align-items:center;margin-right:12px;font-size:12px"><span style="width:10px;height:10px;border-radius:50%;background:${d.color};display:inline-block;margin-right:4px"></span>${esc(d.label)} (${pct}%)</span>`;
    }).join('');
    return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <text x="${cx}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="${P}">${esc(label)}</text>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="20" font-weight="bold" fill="${P}">${total}</text>
      ${arcs}</svg><div style="text-align:center;margin-top:4px">${legend}</div>`;
  }

  // ===== ROUTE 1: Dashboard =====
  app.get('/school/fitness-ai', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [assessments] = await pool.query('SELECT COUNT(*)::int as cnt FROM fitness_assessments WHERE tenant_id=?', [tid]);
      const [routines] = await pool.query('SELECT COUNT(*)::int as cnt FROM fitness_routines WHERE tenant_id=?', [tid]);
      const [logs] = await pool.query('SELECT COUNT(*)::int as cnt FROM fitness_logs WHERE tenant_id=?', [tid]);
      const [challenges] = await pool.query('SELECT COUNT(*)::int as cnt FROM fitness_challenges WHERE tenant_id=?', [tid]);
      const [weeklyStats] = await pool.query(
        'SELECT COUNT(DISTINCT student_id)::int as active_students, SUM(duration_min)::int as total_min, SUM(calories_burned)::int as total_cal FROM fitness_logs WHERE tenant_id=? AND date >= CURRENT_DATE - INTERVAL \'7 days\'', [tid]);
      const ws = weeklyStats[0];
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Fitness AI Dashboard</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">💪 Fitness AI Dashboard</h2>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div class="card" style="border-left:4px solid ${P}"><div style="font-size:28px;font-weight:bold;color:${P}">${assessments[0].cnt}</div><div style="color:${GRAY}">Assessments</div></div>
          <div class="card" style="border-left:4px solid #22c55e"><div style="font-size:28px;font-weight:bold;color:#22c55e">${ws.active_students || 0}</div><div style="color:${GRAY}">Active Students (7d)</div></div>
          <div class="card" style="border-left:4px solid #f97316"><div style="font-size:28px;font-weight:bold;color:#f97316">${ws.total_min || 0} min</div><div style="color:${GRAY}">Total Activity (7d)</div></div>
          <div class="card" style="border-left:4px solid #ef4444"><div style="font-size:28px;font-weight:bold;color:#ef4444">${challenges[0].cnt}</div><div style="color:${GRAY}">Active Challenges</div></div>
        </div>
        <div class="card">
          <a href="/school/fitness-ai/assessments" class="btn" style="margin-right:8px">📋 Assessments</a>
          <a href="/school/fitness-ai/routines" class="btn" style="margin-right:8px">🏋️ Routines</a>
          <a href="/school/fitness-ai/log-workout" class="btn" style="margin-right:8px;background:#059669">📝 Log Workout</a>
          <a href="/school/fitness-ai/challenges" class="btn" style="margin-right:8px;background:#f97316">🏆 Challenges</a>
          <a href="/school/fitness-ai/badges" class="btn" style="margin-right:8px;background:#8b5cf6">🏅 Badges</a>
          <a href="/school/fitness-ai/analytics" class="btn">📊 Analytics</a>
        </div>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 2: Fitness Assessments =====
  app.get('/school/fitness-ai/assessments', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT * FROM fitness_assessments WHERE tenant_id=? ORDER BY date DESC LIMIT 100', [tid]);
      let rows = list.map(a => {
        const scores = typeof a.scores === 'string' ? JSON.parse(a.scores) : (a.scores || {});
        return `<tr>
          <td>${a.id}</td><td>#${a.student_id}</td>
          <td>${esc(a.type)}</td>
          <td>${a.overall_score || '-'}</td>
          <td>${a.date?.toISOString().split('T')[0]}</td>
          <td><a href="/school/fitness-ai/assessments/${a.id}" class="btn" style="padding:4px 8px;font-size:12px">View</a></td>
        </tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Fitness Assessments</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📋 Fitness Assessments</h2>
        <a href="/school/fitness-ai/assessments/new" class="btn" style="margin-bottom:16px;display:inline-block">+ New Assessment</a>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Student</th><th>Type</th><th>Score</th><th>Date</th><th>Action</th></tr>
          ${rows || '<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No assessments</td></tr>'}
        </table></div>
        <a href="/school/fitness-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 3: New Assessment =====
  app.get('/school/fitness-ai/assessments/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>New Fitness Assessment</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">📋 New Fitness Assessment</h2>
      <div class="card">
        <form method="POST" action="/school/fitness-ai/assessments/new">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label>Student ID *</label><input type="number" name="student_id" required></div>
            <div><label>Assessment Type *</label>
              <select name="type" required>
                <option value="cardio">Cardio Endurance</option>
                <option value="strength">Strength</option>
                <option value="flexibility">Flexibility</option>
                <option value="agility">Agility</option>
                <option value="balance">Balance</option>
                <option value="body_composition">Body Composition</option>
                <option value="comprehensive">Comprehensive</option>
              </select>
            </div>
            <div><label>Date</label><input type="date" name="date" value="${new Date().toISOString().split('T')[0]}"></div>
          </div>
          <div style="margin-top:12px"><label>Test Scores (JSON)</label>
            <textarea name="scores" rows="4" placeholder='{"pushups": 20, "situps": 30, "mile_run_min": 8.5, "sit_reach_cm": 25}'></textarea></div>
          <div style="margin-top:12px"><label>Overall Score (0-100)</label>
            <input type="number" name="overall_score" min="0" max="100" step="0.1"></div>
          <button type="submit" class="btn" style="margin-top:12px">Save Assessment</button>
        </form>
      </div>
      <a href="/school/fitness-ai/assessments" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/fitness-ai/assessments/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, type, date, scores, overall_score } = req.body;
    if (!student_id || !type) return res.status(400).send('Student ID and type required');
    let scoresObj = {};
    if (scores) { try { scoresObj = JSON.parse(scores); } catch(e) {} }
    await pool.query(
      'INSERT INTO fitness_assessments (tenant_id, student_id, type, scores, overall_score, date, assessed_by) VALUES (?,?,?,?,?,?,?)',
      [tid, parseInt(student_id), type, JSON.stringify(scoresObj), parseFloat(overall_score) || null, date || new Date().toISOString().split('T')[0], req.user.id]);
    audit(req, 'fitness_assessment_created', { student_id, type });
    res.redirect('/school/fitness-ai/assessments');
  }));

  app.get('/school/fitness-ai/assessments/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM fitness_assessments WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
      if (!rows.length) return res.status(404).send('Not found');
      const a = rows[0];
      const scores = typeof a.scores === 'string' ? JSON.parse(a.scores) : (a.scores || {});
      const scoreBars = Object.entries(scores).map(([k, v]) => ({
        label: k.replace(/_/g, ' '),
        value: typeof v === 'number' ? v : 0,
        color: P
      }));
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Assessment #${a.id}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📋 Assessment #${a.id}</h2>
        <div style="display:grid;grid-template-columns:1fr 2fr;gap:16px">
          <div class="card">
            <div style="font-size:36px;font-weight:bold;color:${P};text-align:center">${a.overall_score || 'N/A'}</div>
            <div style="text-align:center;color:${GRAY}">Overall Score</div>
            <div style="margin-top:12px;font-size:14px">
              <div><strong>Student:</strong> #${a.student_id}</div>
              <div><strong>Type:</strong> ${esc(a.type)}</div>
              <div><strong>Date:</strong> ${a.date?.toISOString().split('T')[0]}</div>
            </div>
          </div>
          <div class="card">${svgBarChart(scoreBars, 500, 250, 'Test Scores')}</div>
        </div>
        <a href="/school/fitness-ai/assessments" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 4: Fitness Routines =====
  app.get('/school/fitness-ai/routines', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT * FROM fitness_routines WHERE tenant_id=? ORDER BY id DESC LIMIT 50', [tid]);
      const diffColors = { beginner: '#22c55e', intermediate: '#eab308', advanced: '#f97316', elite: '#ef4444' };
      let rows = list.map(r => {
        const exercises = typeof r.exercises === 'string' ? JSON.parse(r.exercises) : (r.exercises || []);
        return `<tr>
          <td>${r.id}</td><td>${esc(r.name)}</td>
          <td><span style="color:${diffColors[r.difficulty] || GRAY};font-weight:bold">${r.difficulty}</span></td>
          <td>${esc(r.target_group || 'Full Body')}</td>
          <td>${r.duration_min} min</td>
          <td>${exercises.length} exercises</td>
          <td>
            <a href="/school/fitness-ai/routines/${r.id}" class="btn" style="padding:4px 8px;font-size:12px">View</a>
            <a href="/school/fitness-ai/routines/${r.id}/delete" class="btn" style="padding:4px 8px;font-size:12px;background:#ef4444" onclick="return confirm('Delete?')">✕</a>
          </td>
        </tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Fitness Routines</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🏋️ Fitness Routines</h2>
        <a href="/school/fitness-ai/routines/new" class="btn" style="margin-bottom:16px;display:inline-block">+ Create Routine</a>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Name</th><th>Difficulty</th><th>Target</th><th>Duration</th><th>Exercises</th><th>Actions</th></tr>
          ${rows || '<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No routines</td></tr>'}
        </table></div>
        <a href="/school/fitness-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.get('/school/fitness-ai/routines/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>Create Routine</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">🏋️ Create Fitness Routine</h2>
      <div class="card">
        <form method="POST" action="/school/fitness-ai/routines/new">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label>Routine Name *</label><input name="name" required placeholder="e.g., Morning PE Warm-up"></div>
            <div><label>Difficulty</label>
              <select name="difficulty">
                <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option><option value="elite">Elite</option>
              </select>
            </div>
            <div><label>Target Group</label>
              <select name="target_group">
                <option value="Full Body">Full Body</option><option value="Upper Body">Upper Body</option>
                <option value="Lower Body">Lower Body</option><option value="Core">Core</option>
                <option value="Cardio">Cardio</option><option value="Flexibility">Flexibility</option>
              </select>
            </div>
          </div>
          <div style="margin-top:12px"><label>Duration (minutes)</label><input type="number" name="duration_min" value="30"></div>
          <div style="margin-top:12px"><label>Exercises (one per line: name, reps/duration)</label>
            <textarea name="exercises" rows="5" placeholder="Jumping Jacks, 30\nPush-ups, 15\nSquats, 20\nPlank, 45sec\nHigh Knees, 30"></textarea></div>
          <button type="submit" class="btn" style="margin-top:12px;background:#059669">Save Routine</button>
        </form>
      </div>
      <a href="/school/fitness-ai/routines" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/fitness-ai/routines/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { name, difficulty, target_group, duration_min, exercises } = req.body;
    if (!name) return res.status(400).send('Routine name required');
    const exArr = exercises ? exercises.split('\n').map(l => {
      const parts = l.split(',').map(s => s.trim());
      return { name: parts[0], detail: parts[1] || '' };
    }).filter(e => e.name) : [];
    await pool.query(
      'INSERT INTO fitness_routines (tenant_id, name, exercises, difficulty, target_group, duration_min) VALUES (?,?,?,?,?,?)',
      [tid, name, JSON.stringify(exArr), difficulty || 'beginner', target_group || 'Full Body', parseInt(duration_min) || 30]);
    audit(req, 'fitness_routine_created', { name, difficulty });
    res.redirect('/school/fitness-ai/routines');
  }));

  app.get('/school/fitness-ai/routines/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM fitness_routines WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
      if (!rows.length) return res.status(404).send('Not found');
      const r = rows[0];
      const exercises = typeof r.exercises === 'string' ? JSON.parse(r.exercises) : (r.exercises || []);
      let exList = exercises.map((e, i) =>
        `<div style="display:flex;justify-content:space-between;padding:8px;border-bottom:1px solid #f3f4f6">
          <span><strong>${i + 1}.</strong> ${esc(e.name)}</span>
          <span style="color:${GRAY}">${esc(e.detail || '')}</span>
        </div>`
      ).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>${esc(r.name)}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🏋️ ${esc(r.name)}</h2>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:16px">
          <div class="card" style="text-align:center"><div style="font-size:20px;font-weight:bold;color:${P}">${esc(r.difficulty)}</div><div style="color:${GRAY}">Difficulty</div></div>
          <div class="card" style="text-align:center"><div style="font-size:20px;font-weight:bold;color:#22c55e">${esc(r.target_group)}</div><div style="color:${GRAY}">Target</div></div>
          <div class="card" style="text-align:center"><div style="font-size:20px;font-weight:bold;color:#f97316">${r.duration_min}</div><div style="color:${GRAY}">Minutes</div></div>
          <div class="card" style="text-align:center"><div style="font-size:20px;font-weight:bold;color:#8b5cf6">${exercises.length}</div><div style="color:${GRAY}">Exercises</div></div>
        </div>
        <div class="card"><h4>Exercise List</h4>${exList}</div>
        <a href="/school/fitness-ai/routines" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.get('/school/fitness-ai/routines/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM fitness_routines WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
    res.redirect('/school/fitness-ai/routines');
  }));

  // ===== ROUTE 5: Log Workout =====
  app.get('/school/fitness-ai/log-workout', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [routines] = await pool.query(
        'SELECT id, name FROM fitness_routines WHERE tenant_id=? ORDER BY name', [tid]);
      const opts = routines.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Log Workout</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📝 Log Workout</h2>
        <div class="card">
          <form method="POST" action="/school/fitness-ai/log-workout">
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
              <div><label>Student ID *</label><input type="number" name="student_id" required></div>
              <div><label>Routine (optional)</label><select name="routine_id"><option value="">Custom</option>${opts}</select></div>
              <div><label>Date</label><input type="date" name="date" value="${new Date().toISOString().split('T')[0]}"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
              <div><label>Duration (min)</label><input type="number" name="duration_min" value="30"></div>
              <div><label>Calories Burned</label><input type="number" name="calories_burned" step="0.1" value="200"></div>
            </div>
            <div style="margin-top:12px"><label>Exercises Completed (one per line)</label>
              <textarea name="exercises_completed" rows="3" placeholder="Push-ups, 15 reps\nSquats, 20 reps\nPlank, 45 sec"></textarea></div>
            <button type="submit" class="btn" style="margin-top:12px;background:#059669">💪 Save Workout Log</button>
          </form>
        </div>
        <a href="/school/fitness-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.post('/school/fitness-ai/log-workout', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, routine_id, date, duration_min, calories_burned, exercises_completed } = req.body;
    if (!student_id) return res.status(400).send('Student ID required');
    const exArr = exercises_completed ? exercises_completed.split('\n').map(l => {
      const parts = l.split(',').map(s => s.trim());
      return { name: parts[0], detail: parts[1] || '' };
    }).filter(e => e.name) : [];
    await pool.query(
      'INSERT INTO fitness_logs (tenant_id, student_id, routine_id, exercises_completed, duration_min, calories_burned, date) VALUES (?,?,?,?,?,?,?)',
      [tid, parseInt(student_id), parseInt(routine_id) || null, JSON.stringify(exArr),
       parseInt(duration_min) || 0, parseFloat(calories_burned) || 0, date || new Date().toISOString().split('T')[0]]);
    audit(req, 'fitness_workout_logged', { student_id, duration_min, calories_burned });
    res.redirect('/school/fitness-ai/log-workout');
  }));

  // ===== ROUTE 6: Fitness Challenges =====
  app.get('/school/fitness-ai/challenges', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT * FROM fitness_challenges WHERE tenant_id=? ORDER BY id DESC LIMIT 50', [tid]);
      let rows = list.map(c => {
        const participants = typeof c.participants === 'string' ? JSON.parse(c.participants) : (c.participants || []);
        const isActive = c.end_date && new Date(c.end_date) >= new Date();
        const statusColor = isActive ? '#22c55e' : GRAY;
        return `<tr>
          <td>${c.id}</td><td>${esc(c.title)}</td>
          <td>${esc((c.description || '').substring(0, 40))}</td>
          <td>${c.start_date?.toISOString().split('T')[0]} — ${c.end_date?.toISOString().split('T')[0] || 'Ongoing'}</td>
          <td>${esc(c.metric || '')}</td>
          <td>${participants.length} students</td>
          <td><span style="color:${statusColor};font-weight:bold">${isActive ? 'Active' : 'Ended'}</span></td>
          <td><a href="/school/fitness-ai/challenges/${c.id}/delete" class="btn" style="padding:4px 8px;font-size:12px;background:#ef4444" onclick="return confirm('Delete?')">✕</a></td>
        </tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Fitness Challenges</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🏆 Fitness Challenges</h2>
        <a href="/school/fitness-ai/challenges/new" class="btn" style="margin-bottom:16px;display:inline-block;background:#f97316">+ New Challenge</a>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Title</th><th>Description</th><th>Period</th><th>Metric</th><th>Participants</th><th>Status</th><th></th></tr>
          ${rows || '<tr><td colspan="8" style="text-align:center;color:'+GRAY+'">No challenges</td></tr>'}
        </table></div>
        <a href="/school/fitness-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.get('/school/fitness-ai/challenges/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>New Challenge</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">🏆 New Fitness Challenge</h2>
      <div class="card">
        <form method="POST" action="/school/fitness-ai/challenges/new">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Challenge Title *</label><input name="title" required placeholder="e.g., 30-Day Push-up Challenge"></div>
            <div><label>Metric</label>
              <select name="metric">
                <option value="total_workouts">Total Workouts</option><option value="total_minutes">Total Minutes</option>
                <option value="total_calories">Total Calories Burned</option><option value="streak_days">Streak Days</option>
                <option value="steps">Steps</option>
              </select>
            </div>
            <div><label>Start Date</label><input type="date" name="start_date" value="${new Date().toISOString().split('T')[0]}"></div>
            <div><label>End Date</label><input type="date" name="end_date"></div>
          </div>
          <div style="margin-top:12px"><label>Description</label>
            <textarea name="description" rows="3" placeholder="Describe the challenge goals and rules"></textarea></div>
          <button type="submit" class="btn" style="margin-top:12px;background:#f97316">Create Challenge</button>
        </form>
      </div>
      <a href="/school/fitness-ai/challenges" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/fitness-ai/challenges/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { title, description, metric, start_date, end_date } = req.body;
    if (!title) return res.status(400).send('Title required');
    await pool.query(
      'INSERT INTO fitness_challenges (tenant_id, title, description, start_date, end_date, metric) VALUES (?,?,?,?,?,?)',
      [tid, title, description || '', start_date || null, end_date || null, metric || 'total_workouts']);
    audit(req, 'fitness_challenge_created', { title, metric });
    res.redirect('/school/fitness-ai/challenges');
  }));

  app.get('/school/fitness-ai/challenges/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM fitness_challenges WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
    res.redirect('/school/fitness-ai/challenges');
  }));

  // ===== ROUTE 7: Badges =====
  app.get('/school/fitness-ai/badges', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [students] = await pool.query(
        'SELECT student_id FROM fitness_logs WHERE tenant_id=? GROUP BY student_id ORDER BY student_id', [tid]);
      const badgeData = [];
      for (const s of students) {
        const [logs] = await pool.query(
          'SELECT * FROM fitness_logs WHERE tenant_id=? AND student_id=? ORDER BY date DESC', [tid, s.student_id]);
        const badges = calculateBadges(logs);
        if (badges.length) badgeData.push({ student_id: s.student_id, badges, totalLogs: logs.length });
      }
      badgeData.sort((a, b) => b.badges.length - a.badges.length);
      let rows = badgeData.map(s => `<tr>
        <td>#${s.student_id}</td>
        <td>${s.totalLogs} workouts</td>
        <td>${s.badges.length} badges</td>
        <td>${s.badges.map(b => `<span title="${esc(b.name)}" style="font-size:20px;cursor:help">${b.icon}</span>`).join(' ')}</td>
      </tr>`).join('');
      const allBadges = [
        { name: 'Dedicated (10 workouts)', icon: '🏆', color: '#f59e0b' },
        { name: 'Committed (25 workouts)', icon: '💎', color: '#8b5cf6' },
        { name: 'Iron Will (50 workouts)', icon: '🔥', color: '#ef4444' },
        { name: '5 Hour Club', icon: '⏱️', color: '#3b82f6' },
        { name: '10 Hour Club', icon: '⏱️', color: '#059669' },
        { name: 'Calorie Crusher (1000 cal)', icon: '💪', color: '#f97316' },
        { name: '3-Day Streak', icon: '⚡', color: '#eab308' },
        { name: '7-Day Streak', icon: '⚡', color: '#f97316' },
        { name: '14-Day Streak', icon: '⚡', color: '#ef4444' }
      ];
      const badgeRef = allBadges.map(b =>
        `<div class="card" style="text-align:center;padding:12px"><span style="font-size:32px">${b.icon}</span><div style="font-size:11px;color:${GRAY}">${esc(b.name)}</div></div>`
      ).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Fitness Badges</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🏅 Fitness Badges</h2>
        <h3 style="color:${GRAY}">Available Badges</h3>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:8px;margin-bottom:20px">${badgeRef}</div>
        <h3 style="color:${GRAY}">Student Badges</h3>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>Student</th><th>Workouts</th><th>Badge Count</th><th>Badges</th></tr>
          ${rows || '<tr><td colspan="4" style="text-align:center;color:'+GRAY+'">No badges earned yet</td></tr>'}
        </table></div>
        <a href="/school/fitness-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 8: Class-Level Analytics =====
  app.get('/school/fitness-ai/analytics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [weeklyActivity] = await pool.query(
        "SELECT TO_CHAR(date,'YYYY-MM-DD') as day, SUM(duration_min)::int as total_min, SUM(calories_burned)::int as total_cal, COUNT(DISTINCT student_id)::int as students FROM fitness_logs WHERE tenant_id=? AND date >= CURRENT_DATE - INTERVAL \'14 days\' GROUP BY date ORDER BY date", [tid]);
      const [typeStats] = await pool.query(
        'SELECT r.name, COUNT(l.id)::int as usage_count FROM fitness_logs l LEFT JOIN fitness_routines r ON l.routine_id=r.id WHERE l.tenant_id=? GROUP BY r.name ORDER BY usage_count DESC LIMIT 10', [tid]);
      const [topPerformers] = await pool.query(
        "SELECT student_id, SUM(duration_min)::int as total_min, SUM(calories_burned)::int as total_cal, COUNT(*)::int as workouts FROM fitness_logs WHERE tenant_id=? AND date >= CURRENT_DATE - INTERVAL \'30 days\' GROUP BY student_id ORDER BY total_min DESC LIMIT 15", [tid]);

      const minData = weeklyActivity.map(d => ({
        label: d.day.substring(5), value: d.total_min, color: P
      }));
      const calData = weeklyActivity.map(d => ({
        label: d.day.substring(5), value: d.total_cal, color: '#ef4444'
      }));
      const studentData = topPerformers.map(s => ({
        label: '#' + s.student_id, value: s.total_min, color: '#22c55e'
      }));
      const routineData = typeStats.filter(t => t.name).map(t => ({
        label: t.name.substring(0, 15), value: t.usage_count, color: '#8b5cf6'
      }));

      const totalMin30 = topPerformers.reduce((s, t) => s + t.total_min, 0);
      const totalCal30 = topPerformers.reduce((s, t) => s + t.total_cal, 0);

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Fitness Analytics</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📊 Class-Level Fitness Analytics</h2>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div class="card" style="border-left:4px solid ${P}"><div style="font-size:24px;font-weight:bold;color:${P}">${topPerformers.length}</div><div style="color:${GRAY}">Active Students (30d)</div></div>
          <div class="card" style="border-left:4px solid #22c55e"><div style="font-size:24px;font-weight:bold;color:#22c55e">${totalMin30} min</div><div style="color:${GRAY}">Total Activity (30d)</div></div>
          <div class="card" style="border-left:4px solid #f97316"><div style="font-size:24px;font-weight:bold;color:#f97316">${totalCal30}</div><div style="color:${GRAY}">Calories Burned (30d)</div></div>
          <div class="card" style="border-left:4px solid #8b5cf6"><div style="font-size:24px;font-weight:bold;color:#8b5cf6">${totalMin30 ? Math.round(totalMin30 / topPerformers.length) : 0} min</div><div style="color:${GRAY}">Avg per Student</div></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card">${svgLineChart(minData, 500, 220, 'Daily Activity (min, 14 days)')}</div>
          <div class="card">${svgLineChart(calData, 500, 220, 'Daily Calories Burned (14 days)')}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
          <div class="card">${svgBarChart(studentData, 500, 220, 'Top Students by Minutes (30d)')}</div>
          <div class="card">${svgBarChart(routineData, 500, 220, 'Most Used Routines')}</div>
        </div>
        <a href="/school/fitness-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 9: Student Fitness Profile =====
  app.get('/school/fitness-ai/student/:studentId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sid = req.params.studentId;
      const [logs] = await pool.query(
        'SELECT * FROM fitness_logs WHERE tenant_id=? AND student_id=? ORDER BY date DESC LIMIT 30', [tid, sid]);
      const [assessments] = await pool.query(
        'SELECT * FROM fitness_assessments WHERE tenant_id=? AND student_id=? ORDER BY date DESC LIMIT 10', [tid, sid]);
      const badges = calculateBadges(logs);
      const streak = calcStreak(logs);
      const totalMin = logs.reduce((s, l) => s + (l.duration_min || 0), 0);
      const totalCal = logs.reduce((s, l) => s + parseFloat(l.calories_burned || 0), 0);
      const scoreData = assessments.slice().reverse().map(a => ({
        label: a.date?.toISOString().split('T')[0].substring(5) || '',
        value: parseFloat(a.overall_score) || 0,
        color: (parseFloat(a.overall_score) || 0) >= 70 ? '#22c55e' : (parseFloat(a.overall_score) || 0) >= 50 ? '#eab308' : '#ef4444'
      }));
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Student Fitness #${sid}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">💪 Student #${sid} — Fitness Profile</h2>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:16px">
          <div class="card" style="border-left:4px solid ${P}"><div style="font-size:24px;font-weight:bold;color:${P}">${logs.length}</div><div style="color:${GRAY}">Total Workouts</div></div>
          <div class="card" style="border-left:4px solid #22c55e"><div style="font-size:24px;font-weight:bold;color:#22c55e">${totalMin} min</div><div style="color:${GRAY}">Total Minutes</div></div>
          <div class="card" style="border-left:4px solid #f97316"><div style="font-size:24px;font-weight:bold;color:#f97316">${Math.round(totalCal)}</div><div style="color:${GRAY}">Calories Burned</div></div>
          <div class="card" style="border-left:4px solid #eab308"><div style="font-size:24px;font-weight:bold;color:#eab308">🔥 ${streak}</div><div style="color:${GRAY}">Day Streak</div></div>
        </div>
        <div class="card" style="margin-bottom:16px">
          <h4>🏅 Badges (${badges.length})</h4>
          ${badges.length ? badges.map(b => `<span title="${esc(b.name)}" style="font-size:28px;cursor:help;margin-right:8px">${b.icon}</span>`).join('') : '<span style="color:'+GRAY+'">No badges yet. Keep working out!</span>'}
        </div>
        <div class="card" style="margin-bottom:16px">${svgLineChart(scoreData, 600, 200, 'Assessment Scores Over Time')}</div>
        <div class="card" style="margin-bottom:16px">
          <h4>Injury Prevention Tips</h4>
          <ul style="font-size:13px">
            <li>Always warm up before exercise and cool down after</li>
            <li>Progress gradually — don't increase intensity by more than 10% per week</li>
            <li>Use proper form for all exercises</li>
            <li>Stay hydrated before, during, and after workouts</li>
            <li>Get adequate rest between intense sessions</li>
          </ul>
        </div>
        <a href="/school/fitness-ai" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

};
