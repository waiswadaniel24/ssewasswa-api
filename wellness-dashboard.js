module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS wellness_scores (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        physical_score DECIMAL(5,1) DEFAULT 0, mental_score DECIMAL(5,1) DEFAULT 0,
        social_score DECIMAL(5,1) DEFAULT 0, academic_score DECIMAL(5,1) DEFAULT 0,
        overall_score DECIMAL(5,1) DEFAULT 0, period VARCHAR(50),
        calculated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS wellness_programs (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, title VARCHAR(200) NOT NULL,
        description TEXT, type VARCHAR(100), start_date DATE, end_date DATE,
        participants JSONB DEFAULT '[]', status VARCHAR(20) DEFAULT 'active'
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS wellness_goals (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        goal_type VARCHAR(100) NOT NULL, target VARCHAR(200),
        current VARCHAR(200), deadline DATE,
        status VARCHAR(20) DEFAULT 'in_progress'
      )`);
      console.log('[wellness-dashboard] OK');
    } catch(e) { console.warn('[wellness-dashboard] Warn:', e.message); }
  })();

  // Helper: Aggregate wellness score from sub-modules
  function computeWellnessScore(physical, mental, social, academic) {
    const p = parseFloat(physical) || 0;
    const m = parseFloat(mental) || 0;
    const s = parseFloat(social) || 0;
    const a = parseFloat(academic) || 0;
    const overall = ((p * 0.25) + (m * 0.3) + (s * 0.2) + (a * 0.25));
    return Math.round(overall * 10) / 10;
  }

  // Helper: Wellness level label
  function wellnessLevel(score) {
    if (score >= 85) return { label: 'Excellent', color: '#22c55e', icon: '🌟' };
    if (score >= 70) return { label: 'Good', color: '#3b82f6', icon: '👍' };
    if (score >= 55) return { label: 'Fair', color: '#eab308', icon: '😐' };
    if (score >= 40) return { label: 'Needs Attention', color: '#f97316', icon: '⚠️' };
    return { label: 'Critical', color: '#ef4444', icon: '🚨' };
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
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="18" font-weight="bold" fill="${P}">${Math.round(total * 10) / 10}</text>
      ${arcs}</svg><div style="text-align:center;margin-top:4px">${legend}</div>`;
  }

  function svgRadar(scores, size, label) {
    const cx = size / 2, cy = size / 2 + 15, r = size / 2 - 45;
    const labels = ['Physical', 'Mental', 'Social', 'Academic'];
    const values = [scores.physical || 0, scores.mental || 0, scores.social || 0, scores.academic || 0];
    const colors = ['#22c55e', '#3b82f6', '#8b5cf6', '#f97316'];
    const n = labels.length;
    let grid = '';
    for (let ring = 1; ring <= 4; ring++) {
      const rr = (r / 4) * ring;
      const pts = labels.map((_, i) => {
        const angle = (2 * Math.PI * i / n) - Math.PI / 2;
        return `${cx + rr * Math.cos(angle)},${cy + rr * Math.sin(angle)}`;
      }).join(' ');
      grid += `<polygon points="${pts}" fill="none" stroke="#e5e7eb" stroke-width="1"/>`;
    }
    const valuePts = values.map((v, i) => {
      const angle = (2 * Math.PI * i / n) - Math.PI / 2;
      const vr = (v / 100) * r;
      return `${cx + vr * Math.cos(angle)},${cy + vr * Math.sin(angle)}`;
    }).join(' ');
    const labelEls = labels.map((l, i) => {
      const angle = (2 * Math.PI * i / n) - Math.PI / 2;
      const lx = cx + (r + 25) * Math.cos(angle);
      const ly = cy + (r + 25) * Math.sin(angle);
      return `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="11" fill="${colors[i]}" font-weight="bold">${l} (${values[i]})</text>`;
    }).join('');
    return `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
      <text x="${cx}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="${P}">${esc(label)}</text>
      ${grid}
      <polygon points="${valuePts}" fill="rgba(79,70,229,0.2)" stroke="${P}" stroke-width="2"/>
      ${values.map((v, i) => {
        const angle = (2 * Math.PI * i / n) - Math.PI / 2;
        const vr = (v / 100) * r;
        return `<circle cx="${cx + vr * Math.cos(angle)}" cy="${cy + vr * Math.sin(angle)}" r="5" fill="${colors[i]}"/>`;
      }).join('')}
      ${labelEls}</svg>`;
  }

  // ===== ROUTE 1: Dashboard =====
  app.get('/school/wellness-dashboard', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [scores] = await pool.query('SELECT COUNT(*)::int as cnt FROM wellness_scores WHERE tenant_id=?', [tid]);
      const [programs] = await pool.query('SELECT COUNT(*)::int as cnt FROM wellness_programs WHERE tenant_id=?', [tid]);
      const [goals] = await pool.query('SELECT COUNT(*)::int as total, SUM(CASE WHEN status=\'completed\' THEN 1 ELSE 0 END)::int as completed FROM wellness_goals WHERE tenant_id=?', [tid]);
      const [latestScores] = await pool.query(
        'SELECT AVG(overall_score)::numeric(5,1) as avg_overall, AVG(physical_score)::numeric(5,1) as avg_phys, AVG(mental_score)::numeric(5,1) as avg_mental, AVG(social_score)::numeric(5,1) as avg_social, AVG(academic_score)::numeric(5,1) as avg_acad FROM wellness_scores WHERE tenant_id=? AND calculated_at >= CURRENT_DATE - INTERVAL \'30 days\'', [tid]);
      const ls = latestScores[0];
      const atRisk = await pool.query(
        'SELECT COUNT(DISTINCT student_id)::int as cnt FROM wellness_scores WHERE tenant_id=? AND overall_score < 50 AND calculated_at >= CURRENT_DATE - INTERVAL \'30 days\'', [tid]);
      const g = goals[0];
      const goalPct = g.total > 0 ? Math.round((g.completed / g.total) * 100) : 0;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Wellness Dashboard</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🌟 Wellness Dashboard</h2>
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
          <div class="card" style="border-left:4px solid ${P}"><div style="font-size:24px;font-weight:bold;color:${P}">${scores[0].cnt}</div><div style="color:${GRAY}">Score Records</div></div>
          <div class="card" style="border-left:4px solid #22c55e"><div style="font-size:24px;font-weight:bold;color:#22c55e">${ls.avg_overall || 0}</div><div style="color:${GRAY}">Avg Score (30d)</div></div>
          <div class="card" style="border-left:4px solid #ef4444"><div style="font-size:24px;font-weight:bold;color:#ef4444">${atRisk[0].cnt}</div><div style="color:${GRAY}">At-Risk Students</div></div>
          <div class="card" style="border-left:4px solid #f97316"><div style="font-size:24px;font-weight:bold;color:#f97316">${programs[0].cnt}</div><div style="color:${GRAY}">Programs</div></div>
          <div class="card" style="border-left:4px solid #8b5cf6"><div style="font-size:24px;font-weight:bold;color:#8b5cf6">${goalPct}%</div><div style="color:${GRAY}">Goals Done</div></div>
        </div>
        <div class="card">
          <a href="/school/wellness-dashboard/scores" class="btn" style="margin-right:6px">📊 Scores</a>
          <a href="/school/wellness-dashboard/scores/calculate" class="btn" style="margin-right:6px;background:#059669">🔄 Calculate Scores</a>
          <a href="/school/wellness-dashboard/programs" class="btn" style="margin-right:6px;background:#f97316">📋 Programs</a>
          <a href="/school/wellness-dashboard/goals" class="btn" style="margin-right:6px;background:#8b5cf6">🎯 Goals</a>
          <a href="/school/wellness-dashboard/alerts" class="btn" style="margin-right:6px;background:#ef4444">🔔 Alerts</a>
          <a href="/school/wellness-dashboard/reports" class="btn" style="margin-right:6px;background:#0ea5e9">📈 Reports</a>
          <a href="/school/wellness-dashboard/counselor" class="btn" style="margin-right:6px;background:#6d28d9">🧑‍⚕️ Counselor</a>
          <a href="/school/wellness-dashboard/compare" class="btn">⚖️ Compare</a>
        </div>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 2: Wellness Scores =====
  app.get('/school/wellness-dashboard/scores', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT * FROM wellness_scores WHERE tenant_id=? ORDER BY calculated_at DESC LIMIT 100', [tid]);
      let rows = list.map(s => {
        const wl = wellnessLevel(parseFloat(s.overall_score));
        return `<tr>
          <td>${s.id}</td><td>#${s.student_id}</td>
          <td>${s.physical_score}</td><td>${s.mental_score}</td>
          <td>${s.social_score}</td><td>${s.academic_score}</td>
          <td><strong style="color:${wl.color}">${s.overall_score}</strong> ${wl.icon}</td>
          <td>${esc(s.period || '')}</td>
          <td>${s.calculated_at?.toISOString().replace('T', ' ').substring(0, 16)}</td>
          <td><a href="/school/wellness-dashboard/student/${s.student_id}" class="btn" style="padding:4px 8px;font-size:12px">Profile</a></td>
        </tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Wellness Scores</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📊 Wellness Scores</h2>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Student</th><th>Physical</th><th>Mental</th><th>Social</th><th>Academic</th><th>Overall</th><th>Period</th><th>Calculated</th><th></th></tr>
          ${rows || '<tr><td colspan="10" style="text-align:center;color:'+GRAY+'">No scores calculated yet</td></tr>'}
        </table></div>
        <a href="/school/wellness-dashboard" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 3: Calculate Scores =====
  app.get('/school/wellness-dashboard/scores/calculate', requireAuth, requireNotBanned, async (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>Calculate Wellness Scores</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">🔄 Calculate Wellness Scores</h2>
      <div class="card">
        <p style="color:${GRAY};margin-bottom:16px">Enter wellness dimensions for each student to calculate their comprehensive wellness score.</p>
        <form method="POST" action="/school/wellness-dashboard/scores/calculate">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label>Student ID *</label><input type="number" name="student_id" required></div>
            <div><label>Period</label><input name="period" placeholder="e.g., 2024-Q1, Week-12"></div>
            <div><label></label></div>
          </div>
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-top:12px">
            <div><label>Physical (0-100)</label><input type="number" name="physical_score" min="0" max="100" required></div>
            <div><label>Mental (0-100)</label><input type="number" name="mental_score" min="0" max="100" required></div>
            <div><label>Social (0-100)</label><input type="number" name="social_score" min="0" max="100" required></div>
            <div><label>Academic (0-100)</label><input type="number" name="academic_score" min="0" max="100" required></div>
          </div>
          <button type="submit" class="btn" style="margin-top:12px;background:#059669">Calculate & Save</button>
        </form>
      </div>
      <div class="card" style="margin-top:16px">
        <h4>Scoring Guide</h4>
        <table><tr><th>Range</th><th>Level</th><th>Action</th></tr>
          <tr><td>85-100</td><td style="color:#22c55e;font-weight:bold">Excellent</td><td>Maintain and recognize</td></tr>
          <tr><td>70-84</td><td style="color:#3b82f6;font-weight:bold">Good</td><td>Continue support</td></tr>
          <tr><td>55-69</td><td style="color:#eab308;font-weight:bold">Fair</td><td>Monitor closely</td></tr>
          <tr><td>40-54</td><td style="color:#f97316;font-weight:bold">Needs Attention</td><td>Intervention recommended</td></tr>
          <tr><td>0-39</td><td style="color:#ef4444;font-weight:bold">Critical</td><td>Immediate support required</td></tr>
        </table>
      </div>
      <a href="/school/wellness-dashboard" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/wellness-dashboard/scores/calculate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, period, physical_score, mental_score, social_score, academic_score } = req.body;
    if (!student_id) return res.status(400).send('Student ID required');
    const overall = computeWellnessScore(physical_score, mental_score, social_score, academic_score);
    await pool.query(
      'INSERT INTO wellness_scores (tenant_id, student_id, physical_score, mental_score, social_score, academic_score, overall_score, period) VALUES (?,?,?,?,?,?,?,?)',
      [tid, parseInt(student_id), physical_score, mental_score, social_score, academic_score, overall, period || null]);
    if (overall < 50) {
      audit(req, 'wellness_critical_alert', { student_id, overall });
    }
    audit(req, 'wellness_score_calculated', { student_id, overall, period });
    res.redirect('/school/wellness-dashboard/scores');
  }));

  // ===== ROUTE 4: Wellness Programs =====
  app.get('/school/wellness-dashboard/programs', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT * FROM wellness_programs WHERE tenant_id=? ORDER BY id DESC LIMIT 50', [tid]);
      const statusColors = { active: '#22c55e', planned: '#3b82f6', completed: '#8b5cf6', paused: '#eab308' };
      let rows = list.map(p => {
        const participants = typeof p.participants === 'string' ? JSON.parse(p.participants) : (p.participants || []);
        return `<tr>
          <td>${p.id}</td><td>${esc(p.title)}</td>
          <td>${esc(p.type || 'General')}</td>
          <td>${p.start_date?.toISOString().split('T')[0] || '-'} — ${p.end_date?.toISOString().split('T')[0] || 'Ongoing'}</td>
          <td>${participants.length}</td>
          <td><span style="color:${statusColors[p.status] || GRAY};font-weight:bold">${p.status}</span></td>
          <td>
            <a href="/school/wellness-dashboard/programs/${p.id}" class="btn" style="padding:4px 8px;font-size:12px">View</a>
            <a href="/school/wellness-dashboard/programs/${p.id}/delete" class="btn" style="padding:4px 8px;font-size:12px;background:#ef4444" onclick="return confirm('Delete?')">✕</a>
          </td>
        </tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Wellness Programs</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📋 Wellness Programs</h2>
        <a href="/school/wellness-dashboard/programs/new" class="btn" style="margin-bottom:16px;display:inline-block;background:#f97316">+ New Program</a>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Title</th><th>Type</th><th>Period</th><th>Participants</th><th>Status</th><th>Actions</th></tr>
          ${rows || '<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No programs</td></tr>'}
        </table></div>
        <a href="/school/wellness-dashboard" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.get('/school/wellness-dashboard/programs/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>New Wellness Program</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">🆕 New Wellness Program</h2>
      <div class="card">
        <form method="POST" action="/school/wellness-dashboard/programs/new">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Program Title *</label><input name="title" required placeholder="e.g., Mindfulness Monday"></div>
            <div><label>Type</label>
              <select name="type">
                <option value="mental_health">Mental Health</option><option value="physical">Physical Wellness</option>
                <option value="social">Social Skills</option><option value="nutritional">Nutrition</option>
                <option value="sleep">Sleep Hygiene</option><option value="stress_management">Stress Management</option>
                <option value="anti_bullying">Anti-Bullying</option><option value="general">General Wellness</option>
              </select>
            </div>
            <div><label>Start Date</label><input type="date" name="start_date" value="${new Date().toISOString().split('T')[0]}"></div>
            <div><label>End Date</label><input type="date" name="end_date"></div>
          </div>
          <div style="margin-top:12px"><label>Description</label>
            <textarea name="description" rows="3" placeholder="Program goals, activities, and expected outcomes"></textarea></div>
          <button type="submit" class="btn" style="margin-top:12px;background:#f97316">Create Program</button>
        </form>
      </div>
      <a href="/school/wellness-dashboard/programs" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/wellness-dashboard/programs/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { title, type, description, start_date, end_date } = req.body;
    if (!title) return res.status(400).send('Title required');
    await pool.query(
      'INSERT INTO wellness_programs (tenant_id, title, description, type, start_date, end_date) VALUES (?,?,?,?,?,?)',
      [tid, title, description || '', type || 'general', start_date || null, end_date || null]);
    audit(req, 'wellness_program_created', { title, type });
    res.redirect('/school/wellness-dashboard/programs');
  }));

  app.get('/school/wellness-dashboard/programs/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT * FROM wellness_programs WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
      if (!rows.length) return res.status(404).send('Not found');
      const p = rows[0];
      const participants = typeof p.participants === 'string' ? JSON.parse(p.participants) : (p.participants || []);
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>${esc(p.title)}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📋 ${esc(p.title)}</h2>
        <div class="card">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><strong>Type:</strong> ${esc(p.type || 'General')}</div>
            <div><strong>Start:</strong> ${p.start_date?.toISOString().split('T')[0] || 'N/A'}</div>
            <div><strong>End:</strong> ${p.end_date?.toISOString().split('T')[0] || 'Ongoing'}</div>
          </div>
          <div style="margin-top:12px"><strong>Status:</strong> ${p.status} | <strong>Participants:</strong> ${participants.length}</div>
          <div style="margin-top:12px"><strong>Description:</strong><p>${esc(p.description || 'No description')}</p></div>
        </div>
        <form method="POST" action="/school/wellness-dashboard/programs/${p.id}/status" style="margin-top:12px">
          <div style="display:flex;gap:8px;align-items:center">
            <label>Update Status:</label>
            <select name="status" style="width:auto">
              <option value="active" ${p.status==='active'?'selected':''}>Active</option>
              <option value="planned" ${p.status==='planned'?'selected':''}>Planned</option>
              <option value="paused" ${p.status==='paused'?'selected':''}>Paused</option>
              <option value="completed" ${p.status==='completed'?'selected':''}>Completed</option>
            </select>
            <button type="submit" class="btn" style="padding:6px 12px">Update</button>
          </div>
        </form>
        <a href="/school/wellness-dashboard/programs" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.post('/school/wellness-dashboard/programs/:id/status', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('UPDATE wellness_programs SET status=? WHERE id=? AND tenant_id=?',
      [req.body.status, req.params.id, req.user.tenant_id]);
    res.redirect(`/school/wellness-dashboard/programs/${req.params.id}`);
  }));

  app.get('/school/wellness-dashboard/programs/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM wellness_programs WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
    res.redirect('/school/wellness-dashboard/programs');
  }));

  // ===== ROUTE 5: Wellness Goals =====
  app.get('/school/wellness-dashboard/goals', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT * FROM wellness_goals WHERE tenant_id=? ORDER BY status, deadline ASC LIMIT 100', [tid]);
      const statusColors = { in_progress: '#3b82f6', completed: '#22c55e', missed: '#ef4444', paused: '#eab308' };
      let rows = list.map(g => `<tr>
        <td>${g.id}</td><td>#${g.student_id}</td>
        <td>${esc(g.goal_type)}</td>
        <td>${esc(g.target || '')}</td>
        <td>${esc(g.current || '-')}</td>
        <td>${g.deadline?.toISOString().split('T')[0] || 'No deadline'}</td>
        <td><span style="color:${statusColors[g.status] || GRAY};font-weight:bold">${g.status.replace('_', ' ')}</span></td>
        <td>
          ${g.status !== 'completed' ? `<a href="/school/wellness-dashboard/goals/${g.id}/complete" class="btn" style="padding:4px 8px;font-size:12px;background:#22c55e">✓</a>` : ''}
          <a href="/school/wellness-dashboard/goals/${g.id}/delete" class="btn" style="padding:4px 8px;font-size:12px;background:#ef4444" onclick="return confirm('Delete?')">✕</a>
        </td>
      </tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Wellness Goals</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🎯 Wellness Goals</h2>
        <a href="/school/wellness-dashboard/goals/new" class="btn" style="margin-bottom:16px;display:inline-block;background:#8b5cf6">+ New Goal</a>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Student</th><th>Type</th><th>Target</th><th>Current</th><th>Deadline</th><th>Status</th><th>Actions</th></tr>
          ${rows || '<tr><td colspan="8" style="text-align:center;color:'+GRAY+'">No goals set</td></tr>'}
        </table></div>
        <a href="/school/wellness-dashboard" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.get('/school/wellness-dashboard/goals/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>New Wellness Goal</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">🎯 New Wellness Goal</h2>
      <div class="card">
        <form method="POST" action="/school/wellness-dashboard/goals/new">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Student ID *</label><input type="number" name="student_id" required></div>
            <div><label>Goal Type *</label>
              <select name="goal_type" required>
                <option value="physical">Physical Fitness</option><option value="mental">Mental Wellness</option>
                <option value="social">Social Development</option><option value="academic">Academic Improvement</option>
                <option value="nutrition">Nutrition</option><option value="sleep">Sleep Quality</option>
                <option value="behavioral">Behavioral Goals</option>
              </select>
            </div>
            <div><label>Target</label><input name="target" placeholder="e.g., Run 1 mile under 8 min"></div>
            <div><label>Current Status</label><input name="current" placeholder="e.g., Can run 1 mile in 12 min"></div>
          </div>
          <div style="margin-top:12px"><label>Deadline</label><input type="date" name="deadline"></div>
          <button type="submit" class="btn" style="margin-top:12px;background:#8b5cf6">Set Goal</button>
        </form>
      </div>
      <a href="/school/wellness-dashboard/goals" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/wellness-dashboard/goals/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, goal_type, target, current, deadline } = req.body;
    if (!student_id || !goal_type) return res.status(400).send('Student ID and goal type required');
    await pool.query(
      'INSERT INTO wellness_goals (tenant_id, student_id, goal_type, target, current, deadline) VALUES (?,?,?,?,?,?)',
      [tid, parseInt(student_id), goal_type, target || '', current || '', deadline || null]);
    audit(req, 'wellness_goal_set', { student_id, goal_type });
    res.redirect('/school/wellness-dashboard/goals');
  }));

  app.get('/school/wellness-dashboard/goals/:id/complete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('UPDATE wellness_goals SET status=?, current=? WHERE id=? AND tenant_id=?',
      ['completed', 'Completed', req.params.id, req.user.tenant_id]);
    audit(req, 'wellness_goal_completed', { id: req.params.id });
    res.redirect('/school/wellness-dashboard/goals');
  }));

  app.get('/school/wellness-dashboard/goals/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM wellness_goals WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
    res.redirect('/school/wellness-dashboard/goals');
  }));

  // ===== ROUTE 6: Alerts =====
  app.get('/school/wellness-dashboard/alerts', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [lowScores] = await pool.query(
        'SELECT DISTINCT ON (student_id) student_id, overall_score, calculated_at FROM wellness_scores WHERE tenant_id=? AND overall_score < 50 ORDER BY student_id, calculated_at DESC LIMIT 30', [tid]);
      const [missedGoals] = await pool.query(
        "SELECT * FROM wellness_goals WHERE tenant_id=? AND status='in_progress' AND deadline < CURRENT_DATE LIMIT 20", [tid]);
      let alertRows = '';
      lowScores.forEach(s => {
        const wl = wellnessLevel(parseFloat(s.overall_score));
        alertRows += `<tr><td style="color:#ef4444">🚨</td><td>#${s.student_id}</td><td>Low wellness score: ${s.overall_score} — ${wl.label}</td><td>${s.calculated_at?.toISOString().split('T')[0]}</td></tr>`;
      });
      missedGoals.forEach(g => {
        alertRows += `<tr><td style="color:#f97316">⚠️</td><td>#${g.student_id}</td><td>Goal overdue: ${esc(g.goal_type)} — ${esc(g.target || '')}</td><td>${g.deadline?.toISOString().split('T')[0]}</td></tr>`;
      });
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Wellness Alerts</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🔔 Wellness Alerts</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div class="card" style="border-left:4px solid #ef4444"><div style="font-size:24px;font-weight:bold;color:#ef4444">${lowScores.length}</div><div style="color:${GRAY}">Students with Low Scores</div></div>
          <div class="card" style="border-left:4px solid #f97316"><div style="font-size:24px;font-weight:bold;color:#f97316">${missedGoals.length}</div><div style="color:${GRAY}">Overdue Goals</div></div>
        </div>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th></th><th>Student</th><th>Alert</th><th>Date</th></tr>
          ${alertRows || '<tr><td colspan="4" style="text-align:center;color:'+GRAY+'">🎉 No alerts — everything looks good!</td></tr>'}
        </table></div>
        <a href="/school/wellness-dashboard" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 7: Reports =====
  app.get('/school/wellness-dashboard/reports', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [trendData] = await pool.query(
        "SELECT TO_CHAR(calculated_at,'YYYY-MM') as month, AVG(overall_score)::numeric(5,1) as avg_score, AVG(physical_score)::numeric(5,1) as avg_phys, AVG(mental_score)::numeric(5,1) as avg_mental, COUNT(DISTINCT student_id)::int as students FROM wellness_scores WHERE tenant_id=? GROUP BY TO_CHAR(calculated_at,'YYYY-MM') ORDER BY month DESC LIMIT 12", [tid]);
      const trend = trendData.reverse();
      const overallLine = trend.map(t => ({ label: t.month.substring(2), value: parseFloat(t.avg_score) || 0, color: P }));
      const mentalLine = trend.map(t => ({ label: t.month.substring(2), value: parseFloat(t.avg_mental) || 0, color: '#3b82f6' }));
      const physicalLine = trend.map(t => ({ label: t.month.substring(2), value: parseFloat(t.avg_phys) || 0, color: '#22c55e' }));
      const studentCount = trend.map(t => ({ label: t.month.substring(2), value: t.students, color: '#8b5cf6' }));

      const [goalStats] = await pool.query(
        "SELECT goal_type, COUNT(*)::int as total, SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END)::int as completed FROM wellness_goals WHERE tenant_id=? GROUP BY goal_type ORDER BY total DESC", [tid]);
      const goalBars = goalStats.map(g => ({
        label: g.goal_type.replace('_', ' '), value: g.total, color: '#f97316'
      }));
      const goalCompleteBars = goalStats.map(g => ({
        label: g.goal_type.replace('_', ' '), value: g.completed, color: '#22c55e'
      }));

      const [distData] = await pool.query(
        "SELECT CASE WHEN overall_score >= 85 THEN 'Excellent' WHEN overall_score >= 70 THEN 'Good' WHEN overall_score >= 55 THEN 'Fair' WHEN overall_score >= 40 THEN 'Needs Attention' ELSE 'Critical' END as level, COUNT(*)::int as cnt FROM wellness_scores WHERE tenant_id=? GROUP BY level ORDER BY cnt DESC", [tid]);
      const distDonut = distData.map(d => ({
        label: d.level, value: d.cnt,
        color: { Excellent: '#22c55e', Good: '#3b82f6', Fair: '#eab308', 'Needs Attention': '#f97316', Critical: '#ef4444' }[d.level] || GRAY
      }));

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Wellness Reports</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📈 Wellness Reports</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card">${svgLineChart(overallLine, 500, 220, 'Overall Wellness Trend')}</div>
          <div class="card">${svgDonut(distDonut, 300, 'Score Distribution')}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
          <div class="card">${svgLineChart(mentalLine, 500, 200, 'Mental Health Trend')}</div>
          <div class="card">${svgLineChart(physicalLine, 500, 200, 'Physical Health Trend')}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
          <div class="card">${svgBarChart(goalBars, 400, 200, 'Goals by Type (Total)')}</div>
          <div class="card">${svgBarChart(goalCompleteBars, 400, 200, 'Goals by Type (Completed)')}</div>
        </div>
        <a href="/school/wellness-dashboard" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 8: Counselor Dashboard =====
  app.get('/school/wellness-dashboard/counselor', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [priorityStudents] = await pool.query(
        'SELECT DISTINCT ON (student_id) student_id, overall_score, mental_score, physical_score, social_score FROM wellness_scores WHERE tenant_id=? AND (mental_score < 50 OR overall_score < 45) ORDER BY student_id, calculated_at DESC LIMIT 25', [tid]);
      const [recentPrograms] = await pool.query(
        "SELECT * FROM wellness_programs WHERE tenant_id=? AND status='active' ORDER BY start_date DESC LIMIT 5", [tid]);
      let priorityRows = priorityStudents.map(s => {
        const wl = wellnessLevel(parseFloat(s.overall_score));
        const mentalLow = parseFloat(s.mental_score) < 50;
        return `<tr>
          <td>#${s.student_id}</td>
          <td><strong style="color:${wl.color}">${s.overall_score}</strong></td>
          <td style="color:${mentalLow ? '#ef4444' : '#22c55e'};font-weight:bold">${s.mental_score}</td>
          <td>${s.physical_score}</td>
          <td>${s.social_score}</td>
          <td><a href="/school/wellness-dashboard/student/${s.student_id}" class="btn" style="padding:4px 8px;font-size:12px">View</a></td>
        </tr>`;
      }).join('');
      let programRows = recentPrograms.map(p =>
        `<div class="card" style="border-left:4px solid #6d28d9"><strong>${esc(p.title)}</strong> (${esc(p.type || '')})<br><span style="color:${GRAY}">${esc((p.description || '').substring(0, 100))}</span></div>`
      ).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Counselor Dashboard</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:#6d28d9">🧑‍⚕️ Counselor Dashboard</h2>
        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px">
          <div class="card" style="border-left:4px solid #ef4444;text-align:center"><div style="font-size:32px;font-weight:bold;color:#ef4444">${priorityStudents.length}</div><div style="color:${GRAY}">Priority Students</div></div>
          <div class="card" style="border-left:4px solid #3b82f6;text-align:center"><div style="font-size:32px;font-weight:bold;color:#3b82f6">${recentPrograms.length}</div><div style="color:${GRAY}">Active Programs</div></div>
          <div class="card" style="border-left:4px solid #22c55e;text-align:center"><div style="font-size:32px;font-weight:bold;color:#22c55e">✓</div><div style="color:${GRAY}">Ready for Session</div></div>
        </div>
        <h3 style="color:#6d28d9">Priority Students (Mental Health / Low Wellness)</h3>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>Student</th><th>Overall</th><th>Mental</th><th>Physical</th><th>Social</th><th>Action</th></tr>
          ${priorityRows || '<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No priority students</td></tr>'}
        </table></div>
        <h3 style="color:#6d28d9;margin-top:20px">Active Programs</h3>
        ${programRows || '<div class="card" style="color:'+GRAY+'">No active programs</div>'}
        <a href="/school/wellness-dashboard" class="btn" style="background:${GRAY};display:inline-block;margin-top:16px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 9: Parent Wellness Portal =====
  app.get('/school/wellness-dashboard/parent/:studentId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sid = req.params.studentId;
      const [scores] = await pool.query(
        'SELECT * FROM wellness_scores WHERE tenant_id=? AND student_id=? ORDER BY calculated_at DESC LIMIT 10', [tid, sid]);
      const [goals] = await pool.query(
        'SELECT * FROM wellness_goals WHERE tenant_id=? AND student_id=? ORDER BY deadline ASC', [tid, sid]);
      const [programs] = await pool.query(
        'SELECT title, type FROM wellness_programs WHERE tenant_id=? AND status=\'active\' LIMIT 5', [tid]);
      const latest = scores[0];
      const radarData = latest ? {
        physical: parseFloat(latest.physical_score) || 0,
        mental: parseFloat(latest.mental_score) || 0,
        social: parseFloat(latest.social_score) || 0,
        academic: parseFloat(latest.academic_score) || 0
      } : { physical: 0, mental: 0, social: 0, academic: 0 };
      const wl = latest ? wellnessLevel(parseFloat(latest.overall_score)) : { label: 'N/A', color: GRAY, icon: '❓' };
      const scoreTrend = scores.slice().reverse().map(s => ({
        label: s.calculated_at?.toISOString().split('T')[0].substring(5) || '',
        value: parseFloat(s.overall_score) || 0,
        color: (parseFloat(s.overall_score) || 0) >= 70 ? '#22c55e' : '#f97316'
      }));
      const activePrograms = programs.map(p => `<div style="padding:6px 0;border-bottom:1px solid #f3f4f6">${esc(p.title)} <span style="color:${GRAY};font-size:12px">(${esc(p.type || '')})</span></div>`).join('');

      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Parent Portal - Student #${sid}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">👨‍👩‍👧 Parent Wellness Portal — Student #${sid}</h2>
        ${latest ? `
        <div style="display:grid;grid-template-columns:200px 1fr 1fr;gap:16px;margin-bottom:16px">
          <div class="card" style="text-align:center">
            <div style="font-size:48px;font-weight:bold;color:${wl.color}">${latest.overall_score}</div>
            <div>${wl.icon} ${wl.label}</div>
            <div style="color:${GRAY};font-size:12px;margin-top:8px">Overall Score</div>
          </div>
          <div class="card">${svgRadar(radarData, 280, 'Wellness Profile')}</div>
          <div class="card">
            <h4>Active School Programs</h4>
            ${activePrograms || '<span style="color:'+GRAY+'">No active programs</span>'}
          </div>
        </div>` : '<div class="card" style="text-align:center;color:'+GRAY+'"><p>No wellness data available for this student yet.</p></div>'}
        ${scores.length > 1 ? `<div class="card" style="margin-bottom:16px">${svgLineChart(scoreTrend, 600, 200, 'Wellness Score Trend')}</div>` : ''}
        ${goals.length ? `
        <div class="card"><h4>🎯 Wellness Goals</h4>
          <table><tr><th>Type</th><th>Target</th><th>Current</th><th>Deadline</th><th>Status</th></tr>
          ${goals.map(g => `<tr><td>${esc(g.goal_type)}</td><td>${esc(g.target || '')}</td><td>${esc(g.current || '-')}</td><td>${g.deadline?.toISOString().split('T')[0] || '-'}</td><td>${g.status}</td></tr>`).join('')}
          </table>
        </div>` : ''}
        <a href="/school/wellness-dashboard" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 10: Student Profile =====
  app.get('/school/wellness-dashboard/student/:studentId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sid = req.params.studentId;
      const [scores] = await pool.query(
        'SELECT * FROM wellness_scores WHERE tenant_id=? AND student_id=? ORDER BY calculated_at DESC', [tid, sid]);
      const [goals] = await pool.query(
        'SELECT * FROM wellness_goals WHERE tenant_id=? AND student_id=? ORDER BY deadline ASC', [tid, sid]);
      const latest = scores[0];
      if (!latest) return res.redirect('/school/wellness-dashboard/scores/calculate?student_id=' + sid);
      const radarData = {
        physical: parseFloat(latest.physical_score) || 0,
        mental: parseFloat(latest.mental_score) || 0,
        social: parseFloat(latest.social_score) || 0,
        academic: parseFloat(latest.academic_score) || 0
      };
      const wl = wellnessLevel(parseFloat(latest.overall_score));
      const scoreTrend = scores.slice().reverse().map(s => ({
        label: s.calculated_at?.toISOString().split('T')[0].substring(5) || '',
        value: parseFloat(s.overall_score) || 0,
        color: (parseFloat(s.overall_score) || 0) >= 70 ? '#22c55e' : '#f97316'
      }));
      const dimLines = ['physical_score', 'mental_score', 'social_score', 'academic_score'].map(dim => ({
        label: dim.replace('_score', ''),
        data: scores.slice().reverse().map(s => ({
          label: s.calculated_at?.toISOString().split('T')[0].substring(5) || '',
          value: parseFloat(s[dim]) || 0,
          color: dim === 'physical_score' ? '#22c55e' : dim === 'mental_score' ? '#3b82f6' : dim === 'social_score' ? '#8b5cf6' : '#f97316'
        }))
      }));
      const goalRows = goals.map(g => {
        const statusColor = { in_progress: '#3b82f6', completed: '#22c55e', missed: '#ef4444' }[g.status] || GRAY;
        return `<tr><td>${esc(g.goal_type)}</td><td>${esc(g.target || '')}</td><td>${esc(g.current || '-')}</td><td>${g.deadline?.toISOString().split('T')[0] || '-'}</td><td style="color:${statusColor};font-weight:bold">${g.status}</td></tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Student #${sid} Wellness</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🌟 Student #${sid} — Wellness Profile</h2>
        <div style="display:grid;grid-template-columns:200px 1fr;gap:16px;margin-bottom:16px">
          <div class="card" style="text-align:center">
            <div style="font-size:48px;font-weight:bold;color:${wl.color}">${latest.overall_score}</div>
            <div style="font-size:20px">${wl.icon} ${wl.label}</div>
            <div style="margin-top:8px;font-size:13px">
              <div>Physical: ${latest.physical_score}</div>
              <div>Mental: ${latest.mental_score}</div>
              <div>Social: ${latest.social_score}</div>
              <div>Academic: ${latest.academic_score}</div>
            </div>
            <div style="margin-top:12px">
              <a href="/school/wellness-dashboard/parent/${sid}" class="btn" style="font-size:12px;padding:6px">👨‍👩‍👧 Parent View</a>
            </div>
          </div>
          <div class="card">${svgRadar(radarData, 350, 'Wellness Dimensions')}</div>
        </div>
        <div class="card" style="margin-bottom:16px">${svgLineChart(scoreTrend, 600, 200, 'Overall Score Trend')}</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
          <div class="card">${svgLineChart(dimLines[0].data, 400, 180, 'Physical Trend')}</div>
          <div class="card">${svgLineChart(dimLines[1].data, 400, 180, 'Mental Trend')}</div>
        </div>
        ${goals.length ? `<div class="card"><h4>🎯 Goals</h4>
          <table><tr><th>Type</th><th>Target</th><th>Current</th><th>Deadline</th><th>Status</th></tr>
          ${goalRows || ''}</table></div>` : ''}
        <a href="/school/wellness-dashboard" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 11: Comparison Tool =====
  app.get('/school/wellness-dashboard/compare', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>Compare Students</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">⚖️ Student Comparison</h2>
      <div class="card">
        <p style="color:${GRAY}">Enter student IDs to compare their wellness scores side by side.</p>
        <form method="POST" action="/school/wellness-dashboard/compare">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label>Student A ID *</label><input type="number" name="student_a" required></div>
            <div><label>Student B ID *</label><input type="number" name="student_b" required></div>
            <div><label>Student C ID (optional)</label><input type="number" name="student_c"></div>
          </div>
          <button type="submit" class="btn" style="margin-top:12px">Compare</button>
        </form>
      </div>
      <a href="/school/wellness-dashboard" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/wellness-dashboard/compare', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const ids = [parseInt(req.body.student_a), parseInt(req.body.student_b)];
      if (req.body.student_c) ids.push(parseInt(req.body.student_c));
      const students = [];
      for (const sid of ids) {
        if (!sid) continue;
        const [rows] = await pool.query(
          'SELECT * FROM wellness_scores WHERE tenant_id=? AND student_id=? ORDER BY calculated_at DESC LIMIT 1', [tid, sid]);
        if (rows[0]) students.push(rows[0]);
      }
      const dims = ['Physical', 'Mental', 'Social', 'Academic'];
      const fields = ['physical_score', 'mental_score', 'social_score', 'academic_score'];
      const colors = ['#22c55e', '#3b82f6', '#8b5cf6'];
      let dimBars = dims.map((dim, di) => {
        const barData = students.map((s, si) => ({
          label: '#' + s.student_id, value: parseFloat(s[fields[di]]) || 0, color: colors[si]
        }));
        return `<div class="card">${svgBarChart(barData, 400, 160, dim)}</div>`;
      }).join('');
      const overallBars = students.map((s, si) => ({
        label: '#' + s.student_id, value: parseFloat(s.overall_score) || 0, color: colors[si]
      }));
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Comparison Results</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">⚖️ Comparison Results</h2>
        <div class="card">${svgBarChart(overallBars, 600, 200, 'Overall Wellness Score')}</div>
        <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:16px;margin-top:16px">${dimBars}</div>
        <a href="/school/wellness-dashboard/compare" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← New Comparison</a>
        <a href="/school/wellness-dashboard" class="btn" style="display:inline-block;margin-top:8px;margin-left:8px">Dashboard</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

};
