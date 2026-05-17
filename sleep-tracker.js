module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS sleep_records (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        sleep_date DATE NOT NULL, bed_time TIME, wake_time TIME,
        duration_hours DECIMAL(4,1), quality_score INTEGER DEFAULT 5,
        disturbances JSONB DEFAULT '[]', mood_morning VARCHAR(20),
        notes TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS sleep_recommendations (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        recommendation TEXT NOT NULL, priority VARCHAR(20) DEFAULT 'medium',
        generated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS sleep_goals (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, student_id INTEGER NOT NULL,
        target_hours DECIMAL(4,1) DEFAULT 9.0, bedtime_target TIME DEFAULT '21:00:00',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP, achieved BOOLEAN DEFAULT false
      )`);
      console.log('[sleep-tracker] OK');
    } catch(e) { console.warn('[sleep-tracker] Warn:', e.message); }
  })();

  // Helper: Sleep quality assessment
  function assessSleep(duration, quality, disturbances, mood) {
    let score = 50;
    if (duration >= 8 && duration <= 10) score += 20;
    else if (duration >= 7) score += 10;
    else if (duration < 6) score -= 20;
    else if (duration < 5) score -= 30;
    score += (quality - 5) * 5;
    if (disturbances && disturbances.length > 3) score -= 15;
    else if (disturbances && disturbances.length > 1) score -= 5;
    if (mood === 'energized') score += 10;
    else if (mood === 'tired') score -= 10;
    else if (mood === 'exhausted') score -= 20;
    score = Math.max(0, Math.min(100, score));
    let level = 'Good';
    if (score >= 80) level = 'Excellent';
    else if (score >= 60) level = 'Good';
    else if (score >= 40) level = 'Fair';
    else level = 'Poor';
    return { score, level, color: score >= 70 ? '#22c55e' : score >= 40 ? '#eab308' : '#ef4444' };
  }

  // Helper: Fatigue risk calculation
  function fatigueRisk(records) {
    if (!records.length) return { risk: 'unknown', score: 0 };
    const recent = records.slice(0, 7);
    const avgDuration = recent.reduce((s, r) => s + (r.duration_hours || 0), 0) / recent.length;
    const poorNights = recent.filter(r => (r.quality_score || 5) <= 3).length;
    const tiredMornings = recent.filter(r => r.mood_morning === 'tired' || r.mood_morning === 'exhausted').length;
    let riskScore = 0;
    if (avgDuration < 6) riskScore += 40;
    else if (avgDuration < 7) riskScore += 20;
    else if (avgDuration < 8) riskScore += 10;
    if (poorNights >= 3) riskScore += 30;
    else if (poorNights >= 2) riskScore += 15;
    if (tiredMornings >= 4) riskScore += 20;
    else if (tiredMornings >= 2) riskScore += 10;
    let level = 'Low';
    if (riskScore >= 60) level = 'High';
    else if (riskScore >= 30) level = 'Medium';
    return { risk: level, score: riskScore, avgDuration: Math.round(avgDuration * 10) / 10, poorNights, tiredMornings, color: riskScore >= 60 ? '#ef4444' : riskScore >= 30 ? '#eab308' : '#22c55e' };
  }

  // Helper: SVG line chart
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
    const labels = data.map((d, i) => {
      const x = 40 + i * stepX;
      return `<text x="${x}" y="${height - 12}" text-anchor="middle" font-size="9" fill="${GRAY}">${esc(String(d.label).substring(0, 8))}</text>`;
    }).join('');
    const dots = data.map((d, i) => {
      const x = 40 + i * stepX;
      const y = height - 30 - ((d.value - min) / range) * chartH;
      return `<circle cx="${x}" cy="${y}" r="4" fill="${d.color || P}"/>`;
    }).join('');
    return `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg">
      <text x="${width/2}" y="18" text-anchor="middle" font-size="13" font-weight="bold" fill="${P}">${esc(label)}</text>
      <polyline fill="none" stroke="${P}" stroke-width="2" points="${points}"/>${dots}${labels}</svg>`;
  }

  // Helper: SVG bar chart
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

  // Helper: SVG donut chart
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
  app.get('/school/sleep-tracker', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [totalRecs] = await pool.query('SELECT COUNT(*)::int as cnt FROM sleep_records WHERE tenant_id=?', [tid]);
      const [goals] = await pool.query('SELECT COUNT(*)::int as cnt FROM sleep_goals WHERE tenant_id=?', [tid]);
      const [recs] = await pool.query('SELECT COUNT(*)::int as cnt FROM sleep_recommendations WHERE tenant_id=?', [tid]);
      const [recent] = await pool.query(
        'SELECT AVG(duration_hours)::numeric(3,1) as avg_dur, AVG(quality_score)::numeric(2,1) as avg_qual, COUNT(CASE WHEN mood_morning=\'tired\' OR mood_morning=\'exhausted\' THEN 1 END)::int as tired_cnt FROM sleep_records WHERE tenant_id=? AND sleep_date >= CURRENT_DATE - INTERVAL \'7 days\'', [tid]);
      const r = recent[0];
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Sleep Tracker Dashboard</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">😴 Sleep Tracker Dashboard</h2>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:20px">
          <div class="card" style="border-left:4px solid ${P}"><div style="font-size:28px;font-weight:bold;color:${P}">${totalRecs[0].cnt}</div><div style="color:${GRAY}">Total Sleep Records</div></div>
          <div class="card" style="border-left:4px solid #8b5cf6"><div style="font-size:28px;font-weight:bold;color:#8b5cf6">${r.avg_dur || 0}h</div><div style="color:${GRAY}">Avg Duration (7d)</div></div>
          <div class="card" style="border-left:4px solid #22c55e"><div style="font-size:28px;font-weight:bold;color:#22c55e">${r.avg_qual || 0}/10</div><div style="color:${GRAY}">Avg Quality (7d)</div></div>
          <div class="card" style="border-left:4px solid #f97316"><div style="font-size:28px;font-weight:bold;color:#f97316">${r.tired_cnt || 0}</div><div style="color:${GRAY}">Tired Mornings (7d)</div></div>
        </div>
        <div class="card">
          <a href="/school/sleep-tracker/log" class="btn" style="margin-right:8px">📝 Log Sleep</a>
          <a href="/school/sleep-tracker/records" class="btn" style="margin-right:8px">📋 Records</a>
          <a href="/school/sleep-tracker/goals" class="btn" style="margin-right:8px">🎯 Goals</a>
          <a href="/school/sleep-tracker/fatigue-report" class="btn" style="margin-right:8px;background:#f97316">⚠️ Fatigue Report</a>
          <a href="/school/sleep-tracker/recommendations" class="btn" style="margin-right:8px;background:#8b5cf6">💡 Recommendations</a>
          <a href="/school/sleep-tracker/parent-report" class="btn" style="background:#059669">📧 Parent Report</a>
        </div>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 2: Log Sleep =====
  app.get('/school/sleep-tracker/log', requireAuth, requireNotBanned, (req, res) => {
    const yesterday = new Date(Date.now() - 86400000).toISOString().split('T')[0];
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>Log Sleep</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">📝 Log Sleep</h2>
      <div class="card">
        <form method="POST" action="/school/sleep-tracker/log">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label>Student ID *</label><input type="number" name="student_id" required></div>
            <div><label>Sleep Date *</label><input type="date" name="sleep_date" value="${yesterday}" required></div>
            <div><label>Quality Score (1-10)</label><input type="number" name="quality_score" min="1" max="10" value="7"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div><label>Bed Time</label><input type="time" name="bed_time" value="21:00"></div>
            <div><label>Wake Time</label><input type="time" name="wake_time" value="06:30"></div>
          </div>
          <div style="margin-top:12px"><label>Morning Mood</label>
            <select name="mood_morning">
              <option value="energized">⚡ Energized</option><option value="good">😊 Good</option>
              <option value="okay">😐 Okay</option><option value="tired">😴 Tired</option>
              <option value="exhausted">😫 Exhausted</option>
            </select>
          </div>
          <div style="margin-top:12px"><label>Sleep Disturbances (one per line)</label>
            <textarea name="disturbances" rows="2" placeholder="Woke up once at 3am\nNightmare"></textarea></div>
          <div style="margin-top:12px"><label>Notes</label>
            <textarea name="notes" rows="2" placeholder="Any additional observations"></textarea></div>
          <button type="submit" class="btn" style="margin-top:12px;background:#8b5cf6">💤 Save Sleep Record</button>
        </form>
      </div>
      <a href="/school/sleep-tracker" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/sleep-tracker/log', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, sleep_date, bed_time, wake_time, quality_score, mood_morning, disturbances, notes } = req.body;
    if (!student_id || !sleep_date) return res.status(400).send('Student ID and date required');
    let duration = null;
    if (bed_time && wake_time) {
      const bt = bed_time.split(':').map(Number);
      const wt = wake_time.split(':').map(Number);
      let bedMin = bt[0] * 60 + (bt[1] || 0);
      let wakeMin = wt[0] * 60 + (wt[1] || 0);
      if (wakeMin <= bedMin) wakeMin += 1440;
      duration = (wakeMin - bedMin) / 60;
      duration = Math.round(duration * 10) / 10;
    }
    const distArr = disturbances ? disturbances.split('\n').map(d => d.trim()).filter(Boolean) : [];
    const qScore = parseInt(quality_score) || 5;
    await pool.query(
      'INSERT INTO sleep_records (tenant_id, student_id, sleep_date, bed_time, wake_time, duration_hours, quality_score, disturbances, mood_morning, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      [tid, parseInt(student_id), sleep_date, bed_time || null, wake_time || null, duration, qScore, JSON.stringify(distArr), mood_morning || 'okay', notes || '']);
    const assessment = assessSleep(duration, qScore, distArr, mood_morning);
    if (assessment.score < 40) {
      await pool.query(
        'INSERT INTO sleep_recommendations (tenant_id, student_id, recommendation, priority) VALUES (?,?,?,?)',
        [tid, parseInt(student_id), `Low sleep quality detected (${assessment.score}/100). Duration: ${duration}h, Quality: ${qScore}/10. Consider sleep hygiene intervention.`, 'high']);
    }
    audit(req, 'sleep_logged', { student_id, duration, quality_score: qScore });
    res.redirect('/school/sleep-tracker/log');
  }));

  // ===== ROUTE 3: Sleep Records =====
  app.get('/school/sleep-tracker/records', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [list] = await pool.query(
        'SELECT * FROM sleep_records WHERE tenant_id=? ORDER BY sleep_date DESC LIMIT 100', [tid]);
      const moodIcons = { energized: '⚡', good: '😊', okay: '😐', tired: '😴', exhausted: '😫' };
      let rows = list.map(r => {
        const assessment = assessSleep(r.duration_hours, r.quality_score, r.disturbances, r.mood_morning);
        return `<tr>
          <td>${r.id}</td><td>#${r.student_id}</td>
          <td>${r.sleep_date?.toISOString().split('T')[0]}</td>
          <td>${r.bed_time || '-'} → ${r.wake_time || '-'}</td>
          <td>${r.duration_hours || '-'}h</td>
          <td>${r.quality_score}/10</td>
          <td>${moodIcons[r.mood_morning] || '😐'} ${r.mood_morning || 'okay'}</td>
          <td><span style="color:${assessment.color};font-weight:bold">${assessment.level}</span></td>
          <td><a href="/school/sleep-tracker/records/${r.id}/delete" class="btn" style="padding:4px 8px;font-size:12px;background:#ef4444" onclick="return confirm('Delete?')">✕</a></td>
        </tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Sleep Records</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📋 Sleep Records</h2>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Student</th><th>Date</th><th>Times</th><th>Duration</th><th>Quality</th><th>Mood</th><th>Assessment</th><th></th></tr>
          ${rows || '<tr><td colspan="9" style="text-align:center;color:'+GRAY+'">No sleep records</td></tr>'}
        </table></div>
        <a href="/school/sleep-tracker" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.get('/school/sleep-tracker/records/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM sleep_records WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
    res.redirect('/school/sleep-tracker/records');
  }));

  // ===== ROUTE 4: Sleep Goals =====
  app.get('/school/sleep-tracker/goals', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [goals] = await pool.query(
        'SELECT g.*, (SELECT AVG(duration_hours)::numeric(3,1) FROM sleep_records WHERE tenant_id=g.tenant_id AND student_id=g.student_id AND sleep_date >= CURRENT_DATE - INTERVAL \'7 days\') as avg_actual FROM sleep_goals g WHERE g.tenant_id=? ORDER BY g.id DESC', [tid]);
      let rows = goals.map(g => {
        const met = g.avg_actual && g.avg_actual >= g.target_hours;
        return `<tr>
          <td>${g.id}</td><td>#${g.student_id}</td>
          <td>${g.target_hours}h</td>
          <td>${g.bedtime_target}</td>
          <td>${g.avg_actual || '-'}h avg</td>
          <td>${met ? '<span style="color:#22c55e;font-weight:bold">✅ On Track</span>' : '<span style="color:#f97316">⚠ Below Target</span>'}</td>
          <td><a href="/school/sleep-tracker/goals/${g.id}/delete" class="btn" style="padding:4px 8px;font-size:12px;background:#ef4444" onclick="return confirm('Delete?')">✕</a></td>
        </tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Sleep Goals</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">🎯 Sleep Goals</h2>
        <a href="/school/sleep-tracker/goals/new" class="btn" style="margin-bottom:16px;display:inline-block">+ Set Goal</a>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Student</th><th>Target</th><th>Bedtime</th><th>Actual Avg</th><th>Status</th><th></th></tr>
          ${rows || '<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No sleep goals set</td></tr>'}
        </table></div>
        <a href="/school/sleep-tracker" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.get('/school/sleep-tracker/goals/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
      <title>Set Sleep Goal</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
      <h2 style="color:${P}">🎯 Set Sleep Goal</h2>
      <div class="card">
        <form method="POST" action="/school/sleep-tracker/goals/new">
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
            <div><label>Student ID *</label><input type="number" name="student_id" required></div>
            <div><label>Target Hours</label><input type="number" name="target_hours" step="0.5" value="9.0" min="4" max="14"></div>
            <div><label>Target Bedtime</label><input type="time" name="bedtime_target" value="21:00"></div>
          </div>
          <button type="submit" class="btn" style="margin-top:12px;background:#8b5cf6">Save Goal</button>
        </form>
      </div>
      <a href="/school/sleep-tracker/goals" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
      </body></html>`;
    res.send(html);
  });

  app.post('/school/sleep-tracker/goals/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { student_id, target_hours, bedtime_target } = req.body;
    if (!student_id) return res.status(400).send('Student ID required');
    await pool.query(
      'INSERT INTO sleep_goals (tenant_id, student_id, target_hours, bedtime_target) VALUES (?,?,?,?)',
      [tid, parseInt(student_id), parseFloat(target_hours) || 9.0, bedtime_target || '21:00']);
    audit(req, 'sleep_goal_set', { student_id, target_hours });
    res.redirect('/school/sleep-tracker/goals');
  }));

  app.get('/school/sleep-tracker/goals/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM sleep_goals WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
    res.redirect('/school/sleep-tracker/goals');
  }));

  // ===== ROUTE 5: Fatigue Report =====
  app.get('/school/sleep-tracker/fatigue-report', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [students] = await pool.query(
        'SELECT student_id FROM sleep_records WHERE tenant_id=? GROUP BY student_id ORDER BY student_id LIMIT 50', [tid]);
      const fatigueData = [];
      for (const s of students) {
        const [recs] = await pool.query(
          'SELECT * FROM sleep_records WHERE tenant_id=? AND student_id=? AND sleep_date >= CURRENT_DATE - INTERVAL \'7 days\' ORDER BY sleep_date DESC', [tid, s.student_id]);
        const fr = fatigueRisk(recs);
        fatigueData.push({ student_id: s.student_id, ...fr, records: recs.length });
      }
      fatigueData.sort((a, b) => b.score - a.score);
      const highRisk = fatigueData.filter(f => f.risk === 'High');
      const medRisk = fatigueData.filter(f => f.risk === 'Medium');
      const lowRisk = fatigueData.filter(f => f.risk === 'Low');
      const riskDonut = [
        { label: 'High Risk', value: highRisk.length, color: '#ef4444' },
        { label: 'Medium Risk', value: medRisk.length, color: '#eab308' },
        { label: 'Low Risk', value: lowRisk.length, color: '#22c55e' }
      ];
      const barData = fatigueData.slice(0, 15).map(f => ({
        label: '#' + f.student_id, value: f.avgDuration || 0, color: f.color
      }));
      let rows = fatigueData.map(f => `<tr>
        <td>#${f.student_id}</td><td>${f.records} records</td>
        <td>${f.avgDuration || '-'}h avg</td>
        <td>${f.poorNights} poor nights</td>
        <td>${f.tiredMornings} tired mornings</td>
        <td><span style="color:${f.color};font-weight:bold">${f.risk}</span></td>
      </tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Fatigue Risk Report</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">⚠️ Fatigue Risk Report</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card">${svgDonut(riskDonut, 300, 'Fatigue Risk Distribution')}</div>
          <div class="card">${svgBarChart(barData, 500, 220, 'Avg Sleep Duration by Student')}</div>
        </div>
        <div class="card" style="margin-top:16px;overflow-x:auto"><table>
          <tr><th>Student</th><th>Records</th><th>Avg Duration</th><th>Poor Nights</th><th>Tired Mornings</th><th>Risk Level</th></tr>
          ${rows || '<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No data</td></tr>'}
        </table></div>
        <a href="/school/sleep-tracker" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 6: Recommendations =====
  app.get('/school/sleep-tracker/recommendations', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [recs] = await pool.query(
        'SELECT * FROM sleep_recommendations WHERE tenant_id=? ORDER BY generated_at DESC LIMIT 50', [tid]);
      const priColors = { high: '#ef4444', medium: '#eab308', low: '#22c55e' };
      let rows = recs.map(r => `<tr>
        <td>${r.id}</td><td>#${r.student_id}</td>
        <td><span style="color:${priColors[r.priority] || GRAY};font-weight:bold">${r.priority}</span></td>
        <td style="max-width:400px">${esc(r.recommendation).substring(0, 150)}${(r.recommendation||'').length > 150 ? '...' : ''}</td>
        <td>${r.generated_at?.toISOString().replace('T', ' ').substring(0, 16)}</td>
        <td><a href="/school/sleep-tracker/recommendations/${r.id}/delete" class="btn" style="padding:4px 8px;font-size:12px;background:#ef4444" onclick="return confirm('Delete?')">✕</a></td>
      </tr>`).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Sleep Recommendations</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">💡 Sleep Recommendations</h2>
        <div class="card" style="overflow-x:auto"><table>
          <tr><th>ID</th><th>Student</th><th>Priority</th><th>Recommendation</th><th>Generated</th><th></th></tr>
          ${rows || '<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No recommendations yet</td></tr>'}
        </table></div>
        <a href="/school/sleep-tracker" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.get('/school/sleep-tracker/recommendations/:id/delete', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query('DELETE FROM sleep_recommendations WHERE id=? AND tenant_id=?', [req.params.id, req.user.tenant_id]);
    res.redirect('/school/sleep-tracker/recommendations');
  }));

  // ===== ROUTE 7: Student Sleep Detail =====
  app.get('/school/sleep-tracker/student/:studentId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sid = req.params.studentId;
      const [recs] = await pool.query(
        'SELECT * FROM sleep_records WHERE tenant_id=? AND student_id=? ORDER BY sleep_date DESC LIMIT 30', [tid, sid]);
      const [goal] = await pool.query(
        'SELECT * FROM sleep_goals WHERE tenant_id=? AND student_id=? ORDER BY id DESC LIMIT 1', [tid, sid]);
      const durData = recs.slice().reverse().map(r => ({
        label: r.sleep_date?.toISOString().split('T')[0].substring(5) || '',
        value: r.duration_hours || 0,
        color: r.duration_hours >= (goal[0]?.target_hours || 8) ? '#22c55e' : '#f97316'
      }));
      const qualData = recs.slice().reverse().map(r => ({
        label: r.sleep_date?.toISOString().split('T')[0].substring(5) || '',
        value: r.quality_score || 5,
        color: r.quality_score >= 7 ? '#22c55e' : r.quality_score >= 5 ? '#eab308' : '#ef4444'
      }));
      const fr = fatigueRisk(recs);
      const avgDur = recs.length ? (recs.reduce((s, r) => s + (r.duration_hours || 0), 0) / recs.length).toFixed(1) : '-';
      const avgQual = recs.length ? (recs.reduce((s, r) => s + (r.quality_score || 0), 0) / recs.length).toFixed(1) : '-';
      const moodDist = { energized: 0, good: 0, okay: 0, tired: 0, exhausted: 0 };
      recs.forEach(r => { if (r.mood_morning) moodDist[r.mood_morning] = (moodDist[r.mood_morning] || 0) + 1; });
      const moodDonut = Object.entries(moodDist).filter(([,v]) => v > 0).map(([k, v]) => ({
        label: k, value: v,
        color: { energized: '#22c55e', good: '#3b82f6', okay: '#eab308', tired: '#f97316', exhausted: '#ef4444' }[k]
      }));
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Sleep - Student #${sid}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">😴 Student #${sid} — Sleep Profile</h2>
        <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:16px">
          <div class="card" style="border-left:4px solid ${P}"><div style="font-size:24px;font-weight:bold;color:${P}">${avgDur}h</div><div style="color:${GRAY}">Avg Duration</div></div>
          <div class="card" style="border-left:4px solid #22c55e"><div style="font-size:24px;font-weight:bold;color:#22c55e">${avgQual}/10</div><div style="color:${GRAY}">Avg Quality</div></div>
          <div class="card" style="border-left:4px solid #8b5cf6"><div style="font-size:24px;font-weight:bold;color:#8b5cf6">${recs.length}</div><div style="color:${GRAY}">Total Records</div></div>
          <div class="card" style="border-left:4px solid ${fr.color}"><div style="font-size:24px;font-weight:bold;color:${fr.color}">${fr.risk}</div><div style="color:${GRAY}">Fatigue Risk</div></div>
        </div>
        ${goal[0] ? '<div class="card" style="border-left:4px solid #8b5cf6"><strong>Goal:</strong> ' + goal[0].target_hours + 'h sleep, bedtime ' + goal[0].bedtime_target + '</div>' : ''}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card">${svgLineChart(durData, 500, 200, 'Sleep Duration (hours)')}</div>
          <div class="card">${svgLineChart(qualData, 500, 200, 'Sleep Quality (1-10)')}</div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
          <div class="card">${svgDonut(moodDonut, 280, 'Morning Mood Distribution')}</div>
          <div class="card">
            <h4 style="color:${P}">Sleep Hygiene Tips</h4>
            <ul style="font-size:13px">
              <li>Keep a consistent sleep schedule, even on weekends</li>
              <li>Avoid screens 1 hour before bedtime</li>
              <li>Keep the bedroom cool, dark, and quiet</li>
              <li>Avoid caffeine after 2 PM</li>
              <li>Get regular physical activity (not close to bedtime)</li>
              <li>Practice a calming bedtime routine</li>
            </ul>
          </div>
        </div>
        <a href="/school/sleep-tracker" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  // ===== ROUTE 8: Parent Sleep Report =====
  app.get('/school/sleep-tracker/parent-report/:studentId', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const sid = req.params.studentId;
      const [recs] = await pool.query(
        'SELECT * FROM sleep_records WHERE tenant_id=? AND student_id=? AND sleep_date >= CURRENT_DATE - INTERVAL \'14 days\' ORDER BY sleep_date DESC', [tid, sid]);
      const avgDur = recs.length ? (recs.reduce((s, r) => s + (r.duration_hours || 0), 0) / recs.length).toFixed(1) : '-';
      const avgQual = recs.length ? (recs.reduce((s, r) => s + (r.quality_score || 0), 0) / recs.length).toFixed(1) : '-';
      const fr = fatigueRisk(recs);
      const summary = `Sleep Report for Student #${sid}\n\nPeriod: Last 14 days\nTotal records: ${recs.length}\nAverage duration: ${avgDur} hours\nAverage quality: ${avgQual}/10\nFatigue risk: ${fr.risk}\n\n${fr.risk !== 'Low' ? 'ATTENTION: Your child may not be getting adequate sleep. Consider establishing an earlier bedtime routine and limiting screen time before bed.' : 'Your child\'s sleep patterns look healthy. Keep up the good routine!'}`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Parent Report - Student #${sid}</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📧 Parent Sleep Report — Student #${sid}</h2>
        <div class="card">
          <p style="color:${GRAY}">Preview and send sleep report to parent/guardian.</p>
          <form method="POST" action="/school/sleep-tracker/parent-report/${sid}">
            <div><label>Parent Email</label><input type="email" name="email" required placeholder="parent@email.com"></div>
            <div style="margin-top:12px"><label>Report Preview</label>
              <textarea name="message" rows="10" readonly style="background:#f9fafb">${esc(summary)}</textarea></div>
            <button type="submit" class="btn" style="margin-top:12px;background:#059669">📨 Send Report</button>
          </form>
        </div>
        <a href="/school/sleep-tracker" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

  app.post('/school/sleep-tracker/parent-report/:studentId', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { email, message } = req.body;
    if (!email || !message) return res.status(400).send('Email and message required');
    await queueEmail({ to: email, subject: `Sleep Report — Student #${req.params.studentId}`, html: message.replace(/\n/g, '<br>') });
    audit(req, 'sleep_parent_report_sent', { student_id: req.params.studentId, email });
    res.send(`<html><body style="font-family:system-ui;padding:40px"><div class="card" style="max-width:500px;margin:auto;text-align:center">
      <h2 style="color:#22c55e">✅ Report Sent</h2>
      <p>Sleep report sent to <strong>${esc(email)}</strong></p>
      <a href="/school/sleep-tracker" class="btn" style="display:inline-block;margin-top:16px">← Dashboard</a>
    </div></body></html>`);
  }));

  // ===== ROUTE 9: Classroom Performance Correlation =====
  app.get('/school/sleep-tracker/correlation', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.user.tenant_id;
      const [students] = await pool.query(
        'SELECT student_id, AVG(duration_hours)::numeric(3,1) as avg_sleep, AVG(quality_score)::numeric(2,1) as avg_qual FROM sleep_records WHERE tenant_id=? AND sleep_date >= CURRENT_DATE - INTERVAL \'30 days\' GROUP BY student_id ORDER BY avg_sleep ASC', [tid]);
      const bars = students.map(s => ({
        label: '#' + s.student_id,
        value: parseFloat(s.avg_sleep) || 0,
        color: (parseFloat(s.avg_sleep) || 0) >= 8 ? '#22c55e' : (parseFloat(s.avg_sleep) || 0) >= 7 ? '#eab308' : '#ef4444'
      }));
      const [moodStats] = await pool.query(
        "SELECT mood_morning, COUNT(*)::int as cnt FROM sleep_records WHERE tenant_id=? AND sleep_date >= CURRENT_DATE - INTERVAL \'30 days\' GROUP BY mood_morning ORDER BY cnt DESC", [tid]);
      const moodDonut = moodStats.map(m => ({
        label: m.mood_morning || 'unknown',
        value: m.cnt,
        color: { energized: '#22c55e', good: '#3b82f6', okay: '#eab308', tired: '#f97316', exhausted: '#ef4444' }[m.mood_morning] || GRAY
      }));
      let insightRows = students.map(s => {
        const sleep = parseFloat(s.avg_sleep) || 0;
        const qual = parseFloat(s.avg_qual) || 0;
        let insight = 'Adequate sleep — likely performing well.';
        if (sleep < 6) insight = '🔴 Severe sleep deficit — high risk of attention and learning issues.';
        else if (sleep < 7) insight = '🟠 Below recommended — may affect concentration.';
        else if (sleep < 8) insight = '🟡 Slightly below ideal — monitor for changes.';
        else if (qual < 5) insight = '🟠 Adequate duration but poor quality — investigate disturbances.';
        return `<tr><td>#${s.student_id}</td><td>${s.avg_sleep}h</td><td>${s.avg_qual}/10</td><td style="font-size:13px">${insight}</td></tr>`;
      }).join('');
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8">${SKIP}
        <title>Sleep-Academic Correlation</title></head><body style="font-family:system-ui;background:#f3f4f6;padding:20px">
        <h2 style="color:${P}">📈 Sleep & Classroom Performance Correlation</h2>
        <div class="card" style="padding:12px 20px;background:#eff6ff;border-radius:8px;margin-bottom:16px">
          <strong>Research Insight:</strong> Students aged 6-17 need 8-12 hours of sleep. Chronic sleep deprivation is linked to decreased attention, lower grades, and behavioral issues.
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
          <div class="card">${svgBarChart(bars, 600, 250, 'Avg Sleep by Student (30 days)')}</div>
          <div class="card">${svgDonut(moodDonut, 280, 'Morning Mood (30 days)')}</div>
        </div>
        <div class="card" style="margin-top:16px;overflow-x:auto">
          <h4>Student Insights</h4>
          <table><tr><th>Student</th><th>Avg Sleep</th><th>Avg Quality</th><th>Insight</th></tr>
          ${insightRows || '<tr><td colspan="4" style="text-align:center;color:'+GRAY+'">No data</td></tr>'}
          </table>
        </div>
        <a href="/school/sleep-tracker" class="btn" style="background:${GRAY};display:inline-block;margin-top:8px">← Back</a>
        </body></html>`;
      res.send(html);
    } catch(e) { res.status(500).send('Error: ' + e.message); }
  });

};
