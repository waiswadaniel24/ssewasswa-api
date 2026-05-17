module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}.btn-sm{padding:4px 10px;font-size:12px}.btn-green{background:#059669}.btn-green:hover{background:#047857}.btn-yellow{background:#d97706}.btn-yellow:hover{background:#b45309}.btn-red{background:#dc2626}.btn-red:hover{background:#b91c1c}.btn-purple{background:#7c3aed}.btn-purple:hover{background:#6d28d9}.btn-gray{background:#6b7280}.btn-gray:hover{background:#4b5563}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}.grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:12px}.grid-4{display:grid;grid-template-columns:repeat(4,1fr);gap:12px}.badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600}.badge-green{background:#d1fae5;color:#059669}.badge-yellow{background:#fef3c7;color:#d97706}.badge-red{background:#fee2e2;color:#dc2626}.badge-blue{background:#dbeafe;color:#2563eb}.badge-purple{background:#ede9fe;color:#7c3aed}.metric-card{text-align:center;padding:16px}.metric-card h3{font-size:28px;margin:4px 0}.metric-card small{color:#6b7280}.mood-1{background:#fee2e2;color:#dc2626}.mood-2{background:#fed7aa;color:#ea580c}.mood-3{background:#fef3c7;color:#d97706}.mood-4{background:#d1fae5;color:#059669}.mood-5{background:#dcfce7;color:#16a34a}.alert-critical{background:#fef2f2;border:2px solid #fecaca;padding:12px 16px;border-radius:8px;margin-bottom:12px}.alert-warn{background:#fffbeb;border:2px solid #fde68a;padding:12px 16px;border-radius:8px;margin-bottom:12px}.alert-ok{background:#f0fdf4;border:2px solid #bbf7d0;padding:12px 16px;border-radius:8px;margin-bottom:12px}.emoji-scale{font-size:28px;cursor:pointer;padding:4px 8px;border-radius:8px;transition:transform 0.1s}.emoji-scale:hover{transform:scale(1.2)}.journal-entry{background:#f9fafb;border-radius:8px;padding:12px;margin-bottom:8px;border-left:4px solid ${P}}.progress-ring{width:80px;height:80px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:20px;font-weight:700}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS emotion_checkins (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        student_id INT NOT NULL, mood_score INT DEFAULT 3,
        emotions JSONB DEFAULT '[]',
        triggers TEXT,
        journal_entry TEXT,
        gratitude TEXT,
        energy_level INT DEFAULT 3,
        sleep_quality INT DEFAULT 3,
        confidence_level INT DEFAULT 3,
        date DATE DEFAULT CURRENT_DATE,
        period VARCHAR(20) DEFAULT 'morning',
        location VARCHAR(50),
        anonymous BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS emotion_surveys (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        title VARCHAR(200) NOT NULL, description TEXT,
        questions JSONB DEFAULT '[]',
        target_audience VARCHAR(50) DEFAULT 'all',
        status VARCHAR(20) DEFAULT 'draft',
        frequency VARCHAR(20) DEFAULT 'one_time',
        start_date DATE, end_date DATE,
        response_count INT DEFAULT 0,
        avg_score NUMERIC(5,2),
        created_by INT, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS emotion_survey_responses (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        survey_id INT NOT NULL, student_id INT,
        answers JSONB DEFAULT '[]', score INT,
        submitted_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS emotion_alerts (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL,
        student_id INT NOT NULL, student_name VARCHAR(100),
        alert_type VARCHAR(50) DEFAULT 'low_mood',
        severity VARCHAR(20) DEFAULT 'medium',
        message TEXT, context TEXT,
        consecutive_days INT DEFAULT 1,
        counselor_notified BOOLEAN DEFAULT false,
        counselor_id INT, counselor_name VARCHAR(100),
        parent_notified BOOLEAN DEFAULT false,
        resolved BOOLEAN DEFAULT false,
        resolved_by INT, resolved_at TIMESTAMPTZ,
        intervention_type VARCHAR(50),
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[Mod] emotion-analytics OK');
    } catch(e) { console.warn('[Mod] emotion-analytics Warn:', e.message); }
  })();

  /* ─── Dashboard ─── */
  app.get('/school/emotion-analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const today = new Date().toISOString().slice(0, 10);
    const [todayCheckins] = await pool.query('SELECT COUNT(*) AS c FROM emotion_checkins WHERE tenant_id=$1 AND date=CURRENT_DATE', [tid]);
    const [avgMood] = await pool.query('SELECT AVG(mood_score)::numeric(5,2) AS avg FROM emotion_checkins WHERE tenant_id=$1 AND date=CURRENT_DATE', [tid]);
    const [weekTrend] = await pool.query('SELECT date, AVG(mood_score)::numeric(5,2) AS avg_mood, COUNT(*) AS checkins FROM emotion_checkins WHERE tenant_id=$1 AND date > CURRENT_DATE - INTERVAL \'7 days\' GROUP BY date ORDER BY date', [tid]);
    const [activeAlerts] = await pool.query("SELECT COUNT(*) AS c FROM emotion_alerts WHERE tenant_id=$1 AND resolved=false", [tid]);
    const [criticalAlerts] = await pool.query("SELECT COUNT(*) AS c FROM emotion_alerts WHERE tenant_id=$1 AND resolved=false AND severity='high'", [tid]);
    const [topEmotions] = await pool.query(
      "SELECT key AS emotion, SUM(val) AS total FROM emotion_checkins, jsonb_each_text(emotions) WHERE tenant_id=$1 AND date > CURRENT_DATE - INTERVAL '7 days' GROUP BY key ORDER BY total DESC LIMIT 6",
      [tid]);
    const [recentAlerts] = await pool.query(
      "SELECT * FROM emotion_alerts WHERE tenant_id=$1 AND resolved=false ORDER BY created_at DESC LIMIT 5", [tid]);
    const [lowMoodStudents] = await pool.query(
      "SELECT student_id, AVG(mood_score)::numeric(5,2) AS avg_mood, COUNT(*) AS days FROM emotion_checkins WHERE tenant_id=$1 AND date > CURRENT_DATE - INTERVAL '7 days' AND mood_score <= 2 GROUP BY student_id ORDER BY avg_mood ASC LIMIT 5",
      [tid]);
    const moodLabel = avgMood.avg >= 4 ? 'Great' : avgMood.avg >= 3 ? 'Good' : avgMood.avg >= 2 ? 'Fair' : 'Low';
    const moodColor = avgMood.avg >= 4 ? '#059669' : avgMood.avg >= 3 ? '#d97706' : '#dc2626';
    res.send(renderPage(req, 'Emotion Analytics', SKIP + `
      <div class="card">
        <h2 style="color:${P}">Student Emotion & Wellbeing Analytics</h2>
        ${criticalAlerts.c > 0 ? `<div class="alert-critical">
          <strong>🚨 ${criticalAlerts.c} critical student wellbeing alert(s) require immediate attention.</strong>
          <a href="/school/emotion-analytics/alerts" style="color:#dc2626;text-decoration:underline;margin-left:8px">View Alerts →</a></div>` : ''}
        ${activeAlerts.c > 0 && criticalAlerts.c === 0 ? `<div class="alert-warn">
          <strong>⚠ ${activeAlerts.c} active wellbeing alert(s).</strong>
          <a href="/school/emotion-analytics/alerts" style="color:#d97706;text-decoration:underline;margin-left:8px">Review →</a></div>` : ''}
        ${activeAlerts.c === 0 ? `<div class="alert-ok"><strong>✓ No active alerts. Campus wellbeing is positive today.</strong></div>` : ''}
        <div class="grid-4" style="margin:20px 0">
          <div class="card metric-card" style="border-left:4px solid ${P}"><h3 style="color:${P}">${todayCheckins.c}</h3><small>Check-ins Today</small></div>
          <div class="card metric-card" style="border-left:4px solid ${moodColor}"><h3 style="color:${moodColor}">${avgMood.avg || '-'}/5</h3><small>Avg Mood Today (${moodLabel})</small></div>
          <div class="card metric-card" style="border-left:4px solid #dc2626"><h3 style="color:#dc2626">${activeAlerts.c}</h3><small>Active Alerts</small></div>
          <div class="card metric-card" style="border-left:4px solid #059669"><h3 style="color:#059669">${topEmotions.length}</h3><small>Tracked Emotions</small></div>
        </div>
        <div class="grid-2">
          <div class="card"><h3 style="color:${P}">Weekly Mood Trend</h3>
            <div style="display:flex;align-items:flex-end;gap:8px;height:160px;padding:12px 0">
              ${weekTrend.map(d => {
                const h = (d.avg_mood / 5) * 140;
                const c = d.avg_mood >= 4 ? '#059669' : d.avg_mood >= 3 ? '#d97706' : '#dc2626';
                return `<div style="flex:1;text-align:center">
                  <div style="height:${h}px;background:${c};border-radius:4px 4px 0 0;margin:0 auto;max-width:40px;min-width:20px"></div>
                  <small style="color:${GRAY}">${d.date.slice(5)}</small>
                  <div style="font-size:11px;color:${c}">${d.avg_mood}</div></div>`;
              }).join('')}
            </div></div>
          <div class="card"><h3 style="color:${P}">Top Emotions (7 days)</h3>
            <div style="display:flex;gap:12px;flex-wrap:wrap;padding:8px 0">
              ${topEmotions.map(e => `<div class="card" style="flex:1;min-width:100px;text-align:center;padding:12px">
                <div style="font-size:20px;font-weight:600;color:${P}">${e.total}</div>
                <small style="color:${GRAY}">${esc(e.emotion)}</small></div>`).join('')}
            </div></div>
        </div>
        <div class="grid-2" style="margin-top:16px">
          <div class="card"><h3 style="color:${P}">Active Alerts</h3>
            ${recentAlerts.length === 0 ? '<p style="color:'+GRAY+'">No active alerts.</p>' :
              `<table><tr><th>Student</th><th>Type</th><th>Severity</th><th>Days</th></tr>
              ${recentAlerts.map(a => `<tr>
                <td>${esc(a.student_name||'ID:'+a.student_id)}</td>
                <td>${esc(a.alert_type)}</td>
                <td><span class="badge ${a.severity==='high'?'badge-red':'badge-yellow'}">${esc(a.severity)}</span></td>
                <td>${a.consecutive_days}d</td></tr>`).join('')}</table>`}
          </div>
          <div class="card"><h3 style="color:#dc2626">Students Needing Attention (7d)</h3>
            ${lowMoodStudents.length === 0 ? '<p style="color:#059669">All students reporting positive moods this week.</p>' :
              `<table><tr><th>Student ID</th><th>Avg Mood</th><th>Low Days</th></tr>
              ${lowMoodStudents.map(s => `<tr>
                <td>${s.student_id}</td>
                <td style="color:#dc2626;font-weight:600">${s.avg_mood}/5</td>
                <td>${s.days}</td></tr>`).join('')}</table>`}
          </div>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
          <a class="btn" href="/school/emotion-analytics/checkin">Check-in</a>
          <a class="btn btn-green" href="/school/emotion-analytics/journals">Journals</a>
          <a class="btn btn-yellow" href="/school/emotion-analytics/surveys">Surveys</a>
          <a class="btn btn-red" href="/school/emotion-analytics/alerts">Alerts</a>
          <a class="btn btn-purple" href="/school/emotion-analytics/reports">Reports</a>
          <a class="btn btn-gray" href="/school/emotion-analytics/class-analytics">Class Analytics</a>
        </div>
      </div>`, {activeNav: 'emotion-analytics'}));
  }));

  /* ─── Mood Check-in Form ─── */
  app.get('/school/emotion-analytics/checkin', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [lastCheckin] = await pool.query(
      'SELECT * FROM emotion_checkins WHERE tenant_id=$1 AND student_id=$2 AND date=CURRENT_DATE ORDER BY created_at DESC LIMIT 1',
      [tid, req.user.id]);
    const hasTodayCheckin = lastCheckin.length > 0;
    res.send(renderPage(req, 'Mood Check-in', SKIP + `
      <div class="card" style="max-width:650px;margin:0 auto">
        <h2 style="color:${P};text-align:center">How are you feeling today?</h2>
        <p style="text-align:center;color:${GRAY}">Your check-ins are private and help us support your wellbeing.</p>
        ${hasTodayCheckin ? `<div class="alert-ok"><strong>✓ You've already checked in today.</strong> Last score: ${lastCheckin[0].mood_score}/5. <a href="/school/emotion-analytics/checkin" style="color:#059669">Submit another →</a></div>` : ''}
        <form method="POST" action="/school/emotion-analytics/checkin">
          <div style="text-align:center;margin:24px 0">
            <label style="font-size:16px;font-weight:600;display:block;margin-bottom:12px">Mood Score</label>
            <div style="display:flex;justify-content:center;gap:8px">
              ${[1,2,3,4,5].map(n => `<label class="emoji-scale" style="cursor:pointer">
                <input type="radio" name="mood_score" value="${n}" ${hasTodayCheckin && lastCheckin[0].mood_score===n?'checked':''} required style="display:none">
                <span>${['😢','😕','😐','🙂','😊'][n-1]}</span><br><small>${['Very Low','Low','Neutral','Good','Great'][n-1]}</small></label>`).join('')}
            </div>
          </div>
          <div style="margin:16px 0">
            <label style="font-weight:600">What emotions are you feeling? (Select all that apply)</label>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
              ${['happy','sad','anxious','excited','calm','frustrated','confident','tired','lonely','grateful','angry','nervous','hopeful','stressed','bored','motivated'].map(e =>
                `<label style="display:flex;align-items:center;gap:4px;padding:6px 12px;background:#f3f4f6;border-radius:20px;cursor:pointer">
                  <input type="checkbox" name="emotions" value="${e}"> <small>${esc(e)}</small></label>`).join('')}
            </div>
          </div>
          <div class="grid-2" style="margin:16px 0">
            <div><label>Energy Level</label>
              <select name="energy_level">
                ${[1,2,3,4,5].map(n => `<option value="${n}">${['Very Low','Low','Moderate','High','Very High'][n-1]}</option>`).join('')}
              </select></div>
            <div><label>Sleep Quality</label>
              <select name="sleep_quality">
                ${[1,2,3,4,5].map(n => `<option value="${n}">${['Very Poor','Poor','Average','Good','Excellent'][n-1]}</option>`).join('')}
              </select></div>
          </div>
          <div style="margin:12px 0"><label>Confidence Level</label>
            <select name="confidence_level">
              ${[1,2,3,4,5].map(n => `<option value="${n}">${['Very Low','Low','Moderate','High','Very High'][n-1]}</option>`).join('')}
            </select></div>
          <div style="margin:12px 0"><label>What triggered these feelings? (Optional)</label>
            <input name="triggers" placeholder="e.g., exam results, friend, weather, sleep"></div>
          <div style="margin:12px 0"><label>Journal Entry (Optional)</label>
            <textarea name="journal_entry" rows="3" placeholder="Write about how you're feeling today..."></textarea></div>
          <div style="margin:12px 0"><label>What are you grateful for? (Optional)</label>
            <input name="gratitude" placeholder="e.g., My friends, a good meal, sunny weather"></div>
          <div style="margin:12px 0"><label>Period</label>
            <select name="period"><option value="morning">Morning</option><option value="afternoon">Afternoon</option><option value="evening">Evening</option></select></div>
          <div style="text-align:center"><button class="btn btn-green" type="submit" style="padding:12px 32px;font-size:16px">Submit Check-in</button></div>
        </form></div>`, {activeNav: 'emotion-analytics'}));
  }));

  app.post('/school/emotion-analytics/checkin', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { mood_score, emotions, triggers, journal_entry, gratitude, energy_level, sleep_quality, confidence_level, period, anonymous } = req.body;
    const emotionList = Array.isArray(emotions) ? emotions : emotions ? [emotions] : [];
    await pool.query(
      `INSERT INTO emotion_checkins (tenant_id, student_id, mood_score, emotions, triggers, journal_entry, gratitude,
       energy_level, sleep_quality, confidence_level, period, anonymous)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tid, req.user.id, mood_score, JSON.stringify(emotionList), triggers, journal_entry, gratitude,
       energy_level, sleep_quality, confidence_level, period || 'morning', anonymous === 'on']);
    await audit(req, 'emotion_checkin', { mood_score: parseInt(mood_score), emotion_count: emotionList.length });
    if (parseInt(mood_score) <= 1) {
      const [existing] = await pool.query(
        "SELECT COUNT(*) AS c FROM emotion_alerts WHERE tenant_id=$1 AND student_id=$2 AND alert_type='low_mood' AND resolved=false",
        [tid, req.user.id]);
      const consecutiveDays = existing.c > 0 ? await pool.query(
        "SELECT consecutive_days FROM emotion_alerts WHERE tenant_id=$1 AND student_id=$2 AND alert_type='low_mood' AND resolved=false ORDER BY created_at DESC LIMIT 1",
        [tid, req.user.id]) : [{consecutive_days: 0}];
      const days = (consecutiveDays[0]?.consecutive_days || 0) + 1;
      await pool.query(
        "INSERT INTO emotion_alerts (tenant_id, student_id, student_name, alert_type, severity, message, consecutive_days) VALUES ($1,$2,$3,'low_mood',$4,$5,$6)",
        [tid, req.user.id, req.user.name || `Student ${req.user.id}`, days >= 3 ? 'high' : 'medium',
         `Student reported mood score ${mood_score}/5. Trigger: ${triggers || 'Not specified'}. Journal: ${journal_entry ? journal_entry.substring(0, 100) : 'N/A'}`, days]);
      if (days >= 3) {
        queueEmail(tid, { to: 'counselor', subject: `Wellbeing Alert: ${req.user.name}`, body: `Student has reported low mood for ${days} consecutive days. Immediate attention recommended.` });
      }
    }
    res.redirect('/school/emotion-analytics/checkin');
  }));

  /* ─── Journals ─── */
  app.get('/school/emotion-analytics/journals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const studentId = req.query.student_id || req.user.id;
    const [journals] = await pool.query(
      'SELECT * FROM emotion_checkins WHERE tenant_id=$1 AND student_id=$2 AND journal_entry IS NOT NULL AND journal_entry != \'\' ORDER BY date DESC LIMIT 30',
      [tid, studentId]);
    const [moodHistory] = await pool.query(
      'SELECT date, mood_score FROM emotion_checkins WHERE tenant_id=$1 AND student_id=$2 AND date > CURRENT_DATE - INTERVAL \'14 days\' ORDER BY date',
      [tid, studentId]);
    res.send(renderPage(req, 'Emotion Journals', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">Emotion Journal</h2>
          <a class="btn" href="/school/emotion-analytics/checkin">+ New Entry</a>
        </div>
        <div style="display:flex;align-items:flex-end;gap:2px;height:80px;margin-bottom:16px">
          ${moodHistory.map(d => {
            const h = (d.mood_score / 5) * 70;
            const c = d.mood_score >= 4 ? '#059669' : d.mood_score >= 3 ? '#d97706' : '#dc2626';
            return `<div style="flex:1;height:${h}px;background:${c};border-radius:2px" title="${d.date}: ${d.mood_score}/5"></div>`;
          }).join('')}
        </div>
        <div style="font-size:12px;color:${GRAY};margin-bottom:16px">14-day mood history (Student ID: ${studentId})</div>
        ${journals.length === 0 ? '<div style="text-align:center;color:'+GRAY+';padding:40px">No journal entries yet. Start by submitting a check-in with a journal entry.</div>' :
          journals.map(j => {
            const moodEmoji = ['','😢','😕','😐','🙂','😊'][j.mood_score] || '😐';
            const moodBg = `mood-${j.mood_score}`;
            const emotionTags = Array.isArray(j.emotions) ? j.emotions : JSON.parse(j.emotions || '[]');
            return `<div class="journal-entry">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <div style="display:flex;align-items:center;gap:8px">
                  <span class="badge ${moodBg}">${moodEmoji} ${j.mood_score}/5</span>
                  <strong>${j.date}</strong>
                  <small style="color:${GRAY}">${esc(j.period||'')}</small>
                </div>
                ${j.energy_level ? `<small style="color:${GRAY}">Energy: ${j.energy_level}/5 | Sleep: ${j.sleep_quality}/5</small>` : ''}
              </div>
              ${emotionTags.length > 0 ? `<div style="margin-bottom:6px">${emotionTags.map(e => `<span class="badge badge-purple" style="font-size:10px">${esc(e)}</span>`).join(' ')}</div>` : ''}
              ${j.triggers ? `<div style="font-size:13px;color:${GRAY};margin-bottom:4px">Triggers: ${esc(j.triggers)}</div>` : ''}
              <p style="line-height:1.6">${esc(j.journal_entry)}</p>
              ${j.gratitude ? `<div style="margin-top:6px;font-style:italic;color:#059669">🙏 Grateful for: ${esc(j.gratitude)}</div>` : ''}
            </div>`;
          }).join('')}
      </div>`, {activeNav: 'emotion-analytics'}));
  }));

  /* ─── Surveys List ─── */
  app.get('/school/emotion-analytics/surveys', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [rows] = await pool.query('SELECT * FROM emotion_surveys WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    res.send(renderPage(req, 'Wellbeing Surveys', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">Surveys (${rows.length})</h2>
          <a class="btn" href="/school/emotion-analytics/surveys/new">+ Create Survey</a>
        </div>
        <table><tr><th>Title</th><th>Target</th><th>Status</th><th>Responses</th><th>Avg Score</th><th>Created</th><th>Actions</th></tr>
        ${rows.map(s => `<tr>
          <td><strong>${esc(s.title)}</strong></td>
          <td>${esc(s.target_audience)}</td>
          <td><span class="badge ${s.status==='active'?'badge-green':s.status==='closed'?'badge-red':'badge-yellow'}">${esc(s.status)}</span></td>
          <td>${s.response_count}</td>
          <td>${s.avg_score || '-'}</td>
          <td>${s.created_at ? new Date(s.created_at).toLocaleDateString() : '-'}</td>
          <td>${s.status==='draft' ? `<a href="/school/emotion-analytics/surveys/${s.id}/edit" style="color:${P}">Edit</a> |` : ''}
              <a href="/school/emotion-analytics/surveys/${s.id}/results" style="color:#059669">Results</a>
              ${s.status==='draft' ? ` | <a href="/school/emotion-analytics/surveys/${s.id}/activate" style="color:#7c3aed">Activate</a>` : ''}
              ${s.status==='active' ? ` | <a href="/school/emotion-analytics/surveys/${s.id}/close" style="color:#dc2626">Close</a>` : ''}
          </td></tr>`).join('')}
      </table></div>`, {activeNav: 'emotion-analytics'}));
  }));

  /* ─── Create Survey ─── */
  app.get('/school/emotion-analytics/surveys/new', requireAuth, requireNotBanned, (req, res) => {
    res.send(renderPage(req, 'Create Wellbeing Survey', SKIP + `
      <div class="card"><h2 style="color:${P}">Create Wellbeing Survey</h2>
        <form method="POST" action="/school/emotion-analytics/surveys/new">
          <div class="grid-2">
            <div><label>Survey Title *</label><input name="title" required placeholder="e.g. Weekly Classroom Climate Survey"></div>
            <div><label>Target Audience</label><select name="target_audience">
              <option value="all">All Students</option><option value="elementary">Elementary</option>
              <option value="middle">Middle School</option><option value="high">High School</option>
              <option value="teachers">Teachers</option><option value="staff">Staff</option></select></div>
            <div><label>Frequency</label><select name="frequency">
              <option value="one_time">One Time</option><option value="weekly">Weekly</option>
              <option value="monthly">Monthly</option><option value="quarterly">Quarterly</option></select></div>
            <div><label>Status</label><select name="status">
              <option value="draft">Draft</option><option value="active">Active</option></select></div>
            <div><label>Start Date</label><input name="start_date" type="date"></div>
            <div><label>End Date</label><input name="end_date" type="date"></div>
            <div style="grid-column:span 2"><label>Description</label><textarea name="description" rows="2" placeholder="Brief description of the survey purpose..."></textarea></div>
          </div>
          <h3 style="color:${P};margin-top:16px">Questions</h3>
          <p style="color:${GRAY};font-size:13px">Add questions as JSON. Each question: { "text": "...", "type": "scale_1_5"|"yes_no"|"text", "category": "mood"|"safety"|"engagement"|"social" }</p>
          <textarea name="questions" rows="8" style="margin:8px 0;font-family:monospace" placeholder='[
  {"text":"How safe do you feel at school?","type":"scale_1_5","category":"safety"},
  {"text":"Do you enjoy coming to school?","type":"yes_no","category":"engagement"},
  {"text":"What would make school better?","type":"text","category":"general"}
]'></textarea>
          <button class="btn" type="submit" style="margin-top:12px">Create Survey</button>
          <a href="/school/emotion-analytics/surveys" class="btn btn-gray">Cancel</a>
        </form></div>`, {activeNav: 'emotion-analytics'}));
  });

  app.post('/school/emotion-analytics/surveys/new', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const { title, description, target_audience, frequency, status, start_date, end_date, questions } = req.body;
    let qList = []; try { qList = JSON.parse(questions || '[]'); } catch(e) { qList = []; }
    await pool.query(
      `INSERT INTO emotion_surveys (tenant_id, title, description, target_audience, frequency, status, start_date, end_date, questions, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tid, title, description, target_audience, frequency, status, start_date, end_date, JSON.stringify(qList), req.user.id]);
    await audit(req, 'survey_created', { title, target_audience });
    res.redirect('/school/emotion-analytics/surveys');
  }));

  /* ─── Edit Survey ─── */
  app.get('/school/emotion-analytics/surveys/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [rows] = await pool.query('SELECT * FROM emotion_surveys WHERE id=$1 AND tenant_id=$2', [req.params.id, req.user.tenant_id]);
    if (!rows.length) return res.send('Not found');
    const s = rows[0];
    const qStr = Array.isArray(s.questions) ? JSON.stringify(s.questions, null, 2) : (typeof s.questions === 'string' ? s.questions : '[]');
    res.send(renderPage(req, 'Edit Survey', SKIP + `
      <div class="card"><h2 style="color:${P}">Edit: ${esc(s.title)}</h2>
        <form method="POST" action="/school/emotion-analytics/surveys/${s.id}/edit">
          <div class="grid-2">
            <div><label>Title *</label><input name="title" value="${esc(s.title)}" required></div>
            <div><label>Target</label><select name="target_audience">
              ${['all','elementary','middle','high','teachers','staff'].map(a => `<option value="${a}" ${s.target_audience===a?'selected':''}>${a}</option>`).join('')}</select></div>
            <div><label>Status</label><select name="status">
              ${['draft','active','closed'].map(st => `<option value="${st}" ${s.status===st?'selected':''}>${st}</option>`).join('')}</select></div>
            <div><label>Frequency</label><select name="frequency">
              ${['one_time','weekly','monthly','quarterly'].map(f => `<option value="${f}" ${s.frequency===f?'selected':''}>${f}</option>`).join('')}</select></div>
            <div><label>Start Date</label><input name="start_date" type="date" value="${s.start_date||''}"></div>
            <div><label>End Date</label><input name="end_date" type="date" value="${s.end_date||''}"></div>
            <div style="grid-column:span 2"><label>Description</label><textarea name="description" rows="2">${esc(s.description||'')}</textarea></div>
          </div>
          <h3 style="color:${P};margin-top:12px">Questions (JSON)</h3>
          <textarea name="questions" rows="8" style="font-family:monospace">${esc(qStr)}</textarea>
          <button class="btn" type="submit" style="margin-top:12px">Save</button>
          <a href="/school/emotion-analytics/surveys" class="btn btn-gray">Cancel</a>
        </form></div>`, {activeNav: 'emotion-analytics'}));
  }));

  app.post('/school/emotion-analytics/surveys/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { title, description, target_audience, frequency, status, start_date, end_date, questions } = req.body;
    let qList = []; try { qList = JSON.parse(questions || '[]'); } catch(e) {}
    await pool.query(
      `UPDATE emotion_surveys SET title=$1, description=$2, target_audience=$3, frequency=$4, status=$5, start_date=$6, end_date=$7, questions=$8, updated_at=NOW() WHERE id=$9 AND tenant_id=$10`,
      [title, description, target_audience, frequency, status, start_date, end_date, JSON.stringify(qList), req.params.id, req.user.tenant_id]);
    res.redirect('/school/emotion-analytics/surveys');
  }));

  /* ─── Activate Survey ─── */
  app.get('/school/emotion-analytics/surveys/:id/activate', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE emotion_surveys SET status='active', updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, req.user.tenant_id]);
    res.redirect('/school/emotion-analytics/surveys');
  }));

  /* ─── Close Survey ─── */
  app.get('/school/emotion-analytics/surveys/:id/close', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query("UPDATE emotion_surveys SET status='closed', updated_at=NOW() WHERE id=$1 AND tenant_id=$2", [req.params.id, req.user.tenant_id]);
    res.redirect('/school/emotion-analytics/surveys');
  }));

  /* ─── Survey Results ─── */
  app.get('/school/emotion-analytics/surveys/:id/results', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [survey] = await pool.query('SELECT * FROM emotion_surveys WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!survey.length) return res.send('Not found');
    const s = survey[0];
    const questions = Array.isArray(s.questions) ? s.questions : JSON.parse(s.questions || '[]');
    const [responses] = await pool.query(
      'SELECT * FROM emotion_survey_responses WHERE tenant_id=$1 AND survey_id=$2 ORDER BY submitted_at DESC', [tid, req.params.id]);
    const questionStats = questions.map((q, idx) => {
      const vals = responses.map(r => {
        const answers = Array.isArray(r.answers) ? r.answers : JSON.parse(r.answers || '[]');
        return answers[idx];
      }).filter(Boolean);
      if (q.type === 'scale_1_5' || q.type === 'scale_1_10') {
        const nums = vals.map(Number).filter(n => !isNaN(n));
        const avg = nums.length > 0 ? (nums.reduce((a,b) => a+b, 0) / nums.length).toFixed(1) : '-';
        return { ...q, avg, count: nums.length, distribution: nums.reduce((acc, n) => { acc[n] = (acc[n]||0)+1; return acc; }, {}) };
      }
      if (q.type === 'yes_no') {
        const yCount = vals.filter(v => v === 'yes' || v === 'Yes' || v === true).length;
        return { ...q, yes_pct: vals.length > 0 ? Math.round(yCount/vals.length*100) : 0, count: vals.length };
      }
      return { ...q, count: vals.length, responses: vals };
    });
    res.send(renderPage(req, `Survey Results: ${s.title}`, SKIP + `
      <div class="card">
        <a href="/school/emotion-analytics/surveys" style="color:${P}">← Back to Surveys</a>
        <h2 style="color:${P};margin-top:8px">${esc(s.title)}</h2>
        <p style="color:${GRAY}">${responses.length} responses | Target: ${esc(s.target_audience)} | ${esc(s.frequency)}</p>
        ${questionStats.map((q, i) => `<div class="card" style="margin-top:16px">
          <h4 style="color:${P}">Q${i+1}: ${esc(q.text)}</h4>
          <small class="badge badge-purple">${esc(q.category || 'general')}</small>
          ${q.type === 'scale_1_5' || q.type === 'scale_1_10' ?
            `<div style="margin:12px 0">
              <div style="font-size:24px;font-weight:600;color:${P}">${q.avg} / ${q.type === 'scale_1_5' ? '5' : '10'}</div>
              <small>${q.count} responses</small>
              <div style="display:flex;gap:4px;margin-top:8px">
                ${Object.entries(q.distribution || {}).sort((a,b) => a[0]-b[0]).map(([k,v]) =>
                  `<div style="text-align:center;flex:1"><div style="background:${P};height:${(v/q.count)*60}px;border-radius:4px;min-height:4px"></div>
                  <small>${k}</small><div style="font-size:11px">${v}</div></div>`).join('')}
              </div></div>` :
            q.type === 'yes_no' ?
            `<div style="margin:12px 0"><div style="display:flex;gap:12px;align-items:center">
              <span class="badge badge-green" style="font-size:14px;padding:4px 16px">Yes: ${q.yes_pct}%</span>
              <span class="badge badge-red" style="font-size:14px;padding:4px 16px">No: ${100-q.yes_pct}%</span></div>
              <div class="progress-ring" style="margin-top:8px;background:#e5e7eb">
                <span style="color:#059669">${q.yes_pct}%</span></div></div>` :
            `<div style="margin:12px 0"><p style="color:${GRAY};font-size:13px">${q.count} text responses</p>
              <div style="max-height:200px;overflow-y:auto">${(q.responses || []).map(r => `<div class="journal-entry" style="margin:4px 0"><small>${esc(String(r))}</small></div>`).join('')}</div></div>`}
        </div>`).join('')}
      </div>`, {activeNav: 'emotion-analytics'}));
  }));

  /* ─── Take Survey (Student View) ─── */
  app.get('/school/emotion-analytics/surveys/:id/take', requireAuth, requireNotBanned, ah(async (req, res) => {
    const [survey] = await pool.query("SELECT * FROM emotion_surveys WHERE id=$1 AND tenant_id=$2 AND status='active'", [req.params.id, req.user.tenant_id]);
    if (!survey.length) return res.send('Survey not found or not active.');
    const s = survey[0];
    const questions = Array.isArray(s.questions) ? s.questions : JSON.parse(s.questions || '[]');
    const [existing] = await pool.query(
      'SELECT id FROM emotion_survey_responses WHERE tenant_id=$1 AND survey_id=$2 AND student_id=$3', [req.user.tenant_id, s.id, req.user.id]);
    if (existing.length > 0) return res.send(renderPage(req, 'Survey Completed', SKIP + `
      <div class="card" style="text-align:center;max-width:500px;margin:40px auto">
        <div style="font-size:48px">✅</div>
        <h2 style="color:#059669">Thank You!</h2>
        <p style="color:${GRAY}">You have already completed this survey. Your response is appreciated.</p>
        <a href="/school/emotion-analytics" class="btn" style="margin-top:16px">Back to Dashboard</a>
      </div>`));
    res.send(renderPage(req, `Survey: ${s.title}`, SKIP + `
      <div class="card" style="max-width:650px;margin:0 auto">
        <h2 style="color:${P}">${esc(s.title)}</h2>
        <p style="color:${GRAY}">${esc(s.description || '')}</p>
        <form method="POST" action="/school/emotion-analytics/surveys/${s.id}/take">
          ${questions.map((q, i) => {
            if (q.type === 'scale_1_5') {
              return `<div class="card" style="margin:12px 0"><label style="font-weight:600">Q${i+1}: ${esc(q.text)}</label>
                <div style="display:flex;gap:4px;margin-top:8px">
                  ${[1,2,3,4,5].map(n => `<label style="flex:1;text-align:center;cursor:pointer;padding:8px;background:#f3f4f6;border-radius:8px">
                    <input type="radio" name="q_${i}" value="${n}" required style="display:none"><span style="font-size:18px">${n}</span></label>`).join('')}
                </div></div>`;
            }
            if (q.type === 'scale_1_10') {
              return `<div class="card" style="margin:12px 0"><label style="font-weight:600">Q${i+1}: ${esc(q.text)}</label>
                <div style="display:flex;gap:2px;margin-top:8px">
                  ${[1,2,3,4,5,6,7,8,9,10].map(n => `<label style="flex:1;text-align:center;cursor:pointer;padding:6px 2px;background:#f3f4f6;border-radius:6px;font-size:13px">
                    <input type="radio" name="q_${i}" value="${n}" required style="display:none">${n}</label>`).join('')}
                </div></div>`;
            }
            if (q.type === 'yes_no') {
              return `<div class="card" style="margin:12px 0"><label style="font-weight:600">Q${i+1}: ${esc(q.text)}</label>
                <div style="display:flex;gap:8px;margin-top:8px">
                  <label style="flex:1;text-align:center;cursor:pointer;padding:10px;background:#dcfce7;border-radius:8px;font-weight:600;color:#059669">
                    <input type="radio" name="q_${i}" value="yes" required style="display:none"> Yes</label>
                  <label style="flex:1;text-align:center;cursor:pointer;padding:10px;background:#fee2e2;border-radius:8px;font-weight:600;color:#dc2626">
                    <input type="radio" name="q_${i}" value="no" required style="display:none"> No</label>
                </div></div>`;
            }
            return `<div class="card" style="margin:12px 0"><label style="font-weight:600">Q${i+1}: ${esc(q.text)}</label>
              <textarea name="q_${i}" rows="2" style="margin-top:8px" placeholder="Type your answer..."></textarea></div>`;
          }).join('')}
          <div style="text-align:center"><button class="btn btn-green" type="submit" style="padding:12px 32px">Submit Survey</button></div>
        </form></div>`, {activeNav: 'emotion-analytics'}));
  }));

  app.post('/school/emotion-analytics/surveys/:id/take', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [survey] = await pool.query('SELECT questions FROM emotion_surveys WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!survey.length) return res.send('Survey not found');
    const questions = Array.isArray(survey[0].questions) ? survey[0].questions : JSON.parse(survey[0].questions || '[]');
    const answers = questions.map((q, i) => {
      const val = req.body[`q_${i}`];
      return q.type === 'scale_1_5' || q.type === 'scale_1_10' ? parseInt(val) : val;
    });
    const score = answers.filter(a => typeof a === 'number').reduce((s,v) => s+v, 0);
    const numAnswers = answers.filter(a => typeof a === 'number').length;
    const avgScore = numAnswers > 0 ? score / numAnswers : null;
    await pool.query(
      'INSERT INTO emotion_survey_responses (tenant_id, survey_id, student_id, answers, score) VALUES ($1,$2,$3,$4,$5)',
      [tid, req.params.id, req.user.id, JSON.stringify(answers), avgScore]);
    await pool.query(
      'UPDATE emotion_surveys SET response_count = response_count + 1 WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    await audit(req, 'survey_submitted', { survey_id: req.params.id });
    res.send(renderPage(req, 'Thank You', SKIP + `
      <div class="card" style="text-align:center;max-width:500px;margin:60px auto">
        <div style="font-size:64px">🌟</div>
        <h2 style="color:#059669">Thank You!</h2>
        <p style="color:${GRAY}">Your response has been recorded. Your voice helps us create a better school environment.</p>
        <a href="/school/emotion-analytics" class="btn" style="margin-top:16px">Back to Dashboard</a>
      </div>`));
  }));

  /* ─── Alerts Management ─── */
  app.get('/school/emotion-analytics/alerts', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const filter = req.query.filter || '';
    let where = 'WHERE tenant_id=$1', params = [tid];
    if (filter === 'unresolved') { where += ' AND resolved=false'; }
    else if (filter === 'resolved') { where += ' AND resolved=true'; }
    else if (filter === 'critical') { where += " AND severity='high' AND resolved=false"; }
    const [rows] = await pool.query(
      `SELECT * FROM emotion_alerts ${where} ORDER BY created_at DESC LIMIT 50`, params);
    const [unresolved] = await pool.query('SELECT COUNT(*) AS c FROM emotion_alerts WHERE tenant_id=$1 AND resolved=false', [tid]);
    const [highSeverity] = await pool.query("SELECT COUNT(*) AS c FROM emotion_alerts WHERE tenant_id=$1 AND severity='high' AND resolved=false", [tid]);
    const [notifiedCount] = await pool.query('SELECT COUNT(*) AS c FROM emotion_alerts WHERE tenant_id=$1 AND counselor_notified=true', [tid]);
    res.send(renderPage(req, 'Wellbeing Alerts', SKIP + `
      <div class="card">
        <h2 style="color:${P}">Student Wellbeing Alerts</h2>
        ${highSeverity.c > 0 ? `<div class="alert-critical"><strong>🚨 ${highSeverity.c} high-severity alert(s) need immediate action.</strong></div>` : ''}
        <div class="grid-3" style="margin:16px 0">
          <div class="card metric-card" style="border-left:4px solid #dc2626"><h3 style="color:#dc2626">${unresolved.c}</h3><small>Unresolved</small></div>
          <div class="card metric-card" style="border-left:4px solid #dc2626"><h3 style="color:#dc2626">${highSeverity.c}</h3><small>High Severity</small></div>
          <div class="card metric-card" style="border-left:4px solid #2563eb"><h3 style="color:#2563eb">${notifiedCount.c}</h3><small>Counselor Notified</small></div>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:12px;flex-wrap:wrap">
          <a href="/school/emotion-analytics/alerts" class="btn btn-sm btn-gray">All</a>
          <a href="/school/emotion-analytics/alerts?filter=unresolved" class="btn btn-sm ${filter==='unresolved'?'btn-red':'btn-gray'}">Unresolved</a>
          <a href="/school/emotion-analytics/alerts?filter=critical" class="btn btn-sm ${filter==='critical'?'btn-red':'btn-gray'}">Critical</a>
          <a href="/school/emotion-analytics/alerts?filter=resolved" class="btn btn-sm ${filter==='resolved'?'btn-green':'btn-gray'}">Resolved</a>
        </div>
        <table><tr><th>Student</th><th>Type</th><th>Severity</th><th>Message</th><th>Consecutive</th><th>Counselor</th><th>Status</th><th>Actions</th></tr>
        ${rows.map(a => `<tr>
          <td><strong>${esc(a.student_name||'ID:'+a.student_id)}</strong></td>
          <td><span class="badge badge-blue">${esc(a.alert_type)}</span></td>
          <td><span class="badge ${a.severity==='high'?'badge-red':'badge-yellow'}">${esc(a.severity)}</span></td>
          <td><small>${esc((a.message||'').substring(0, 80))}${(a.message||'').length > 80 ? '...' : ''}</small></td>
          <td>${a.consecutive_days}d</td>
          <td>${a.counselor_notified ? `<span class="badge badge-green">${esc(a.counselor_name||'Notified')}</span>` : '<span class="badge badge-yellow">Pending</span>'}</td>
          <td>${a.resolved ? '<span class="badge badge-green">Resolved</span>' : '<span class="badge badge-red">Open</span>'}</td>
          <td>${!a.resolved ? `<a href="/school/emotion-analytics/alerts/${a.id}/resolve" class="btn btn-sm btn-green">Resolve</a>
            ${!a.counselor_notified ? `<a href="/school/emotion-analytics/alerts/${a.id}/notify-counselor" class="btn btn-sm btn-yellow" style="margin-left:4px">Notify</a>` : ''}` :
            `<a href="/school/emotion-analytics/alerts/${a.id}/reopen" class="btn btn-sm btn-red">Reopen</a>`}
          </td></tr>`).join('')}
      </table></div>`, {activeNav: 'emotion-analytics'}));
  }));

  /* ─── Notify Counselor ─── */
  app.get('/school/emotion-analytics/alerts/:id/notify-counselor', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [alert] = await pool.query('SELECT * FROM emotion_alerts WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!alert.length) return res.send('Not found');
    const a = alert[0];
    await pool.query(
      "UPDATE emotion_alerts SET counselor_notified=true, counselor_id=$1, counselor_name=$2, updated_at=NOW() WHERE id=$3 AND tenant_id=$4",
      [req.user.id, req.user.name || `Staff ${req.user.id}`, req.params.id, tid]);
    queueEmail(tid, {
      to: 'counselor',
      subject: `Student Wellbeing Alert: ${a.student_name || 'Student ' + a.student_id}`,
      body: `ALERT TYPE: ${a.alert_type}\nSEVERITY: ${a.severity}\nCONSECUTIVE DAYS: ${a.consecutive_days}\n\nMESSAGE: ${a.message}\n\nPlease follow up with the student as soon as possible.`
    });
    await audit(req, 'counselor_notified', { alert_id: req.params.id, student_id: a.student_id });
    res.redirect('/school/emotion-analytics/alerts');
  }));

  /* ─── Resolve Alert ─── */
  app.get('/school/emotion-analytics/alerts/:id/resolve', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [alert] = await pool.query('SELECT * FROM emotion_alerts WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!alert.length) return res.send('Not found');
    const a = alert[0];
    res.send(renderPage(req, 'Resolve Alert', SKIP + `
      <div class="card" style="max-width:550px;margin:20px auto">
        <h2 style="color:#059669">Resolve Alert</h2>
        <p><strong>Student:</strong> ${esc(a.student_name||'ID:'+a.student_id)}</p>
        <p><strong>Type:</strong> ${esc(a.alert_type)} | <strong>Severity:</strong> ${esc(a.severity)}</p>
        <p><strong>Message:</strong> ${esc(a.message||'')}</p>
        <form method="POST" action="/school/emotion-analytics/alerts/${a.id}/resolve">
          <div style="margin:12px 0"><label>Intervention Type</label><select name="intervention_type">
            <option value="counseling_session">Counseling Session</option>
            <option value="parent_meeting">Parent Meeting</option>
            <option value="peer_support">Peer Support Group</option>
            <option value="teacher_checkin">Teacher Check-in</option>
            <option value="referral">External Referral</option>
            <option value="monitoring">Continue Monitoring</option>
            <option value="resolved_naturally">Resolved Naturally</option>
            <option value="other">Other</option></select></div>
          <div style="margin:12px 0"><label>Resolution Notes</label><textarea name="notes" rows="3" placeholder="Describe the intervention and outcome..."></textarea></div>
          <button class="btn btn-green" type="submit">Mark as Resolved</button>
          <a href="/school/emotion-analytics/alerts" class="btn btn-gray">Cancel</a>
        </form></div>`, {activeNav: 'emotion-analytics'}));
  }));

  app.post('/school/emotion-analytics/alerts/:id/resolve', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { intervention_type, notes } = req.body;
    await pool.query(
      "UPDATE emotion_alerts SET resolved=true, resolved_by=$1, resolved_at=NOW(), intervention_type=$2, notes=$3, updated_at=NOW() WHERE id=$4 AND tenant_id=$5",
      [req.user.id, intervention_type, notes, req.params.id, req.user.tenant_id]);
    await audit(req, 'alert_resolved', { alert_id: req.params.id, intervention_type });
    res.redirect('/school/emotion-analytics/alerts');
  }));

  /* ─── Reopen Alert ─── */
  app.get('/school/emotion-analytics/alerts/:id/reopen', requireAuth, requireNotBanned, ah(async (req, res) => {
    await pool.query(
      "UPDATE emotion_alerts SET resolved=false, resolved_by=null, resolved_at=null, updated_at=NOW() WHERE id=$1 AND tenant_id=$2",
      [req.params.id, req.user.tenant_id]);
    res.redirect('/school/emotion-analytics/alerts');
  }));

  /* ─── Reports ─── */
  app.get('/school/emotion-analytics/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const days = parseInt(req.query.days) || 30;
    const [moodTrend] = await pool.query(
      `SELECT date, AVG(mood_score)::numeric(5,2) AS avg_mood, AVG(energy_level)::numeric(5,2) AS avg_energy,
       AVG(sleep_quality)::numeric(5,2) AS avg_sleep, AVG(confidence_level)::numeric(5,2) AS avg_confidence,
       COUNT(*) AS checkins, COUNT(DISTINCT student_id) AS unique_students
       FROM emotion_checkins WHERE tenant_id=$1 AND date > CURRENT_DATE - ($2 || ' days')::INTERVAL
       GROUP BY date ORDER BY date`, [tid, days]);
    const [emotionBreakdown] = await pool.query(
      `SELECT key AS emotion, SUM(val)::int AS total FROM emotion_checkins, jsonb_each_text(emotions)
       WHERE tenant_id=$1 AND date > CURRENT_DATE - ($2 || ' days')::INTERVAL GROUP BY key ORDER BY total DESC`,
      [tid, days]);
    const [triggerBreakdown] = await pool.query(
      `SELECT triggers, COUNT(*) AS c FROM emotion_checkins WHERE tenant_id=$1 AND date > CURRENT_DATE - ($2 || ' days')::INTERVAL
       AND triggers IS NOT NULL AND triggers != '' GROUP BY triggers ORDER BY c DESC LIMIT 15`,
      [tid, days]);
    const [periodBreakdown] = await pool.query(
      `SELECT period, AVG(mood_score)::numeric(5,2) AS avg_mood, COUNT(*) AS c FROM emotion_checkins
       WHERE tenant_id=$1 AND date > CURRENT_DATE - ($2 || ' days')::INTERVAL GROUP BY period ORDER BY period`,
      [tid, days]);
    const [alertsSummary] = await pool.query(
      `SELECT alert_type, COUNT(*) AS c, COUNT(*) FILTER (WHERE resolved=true) AS resolved_count
       FROM emotion_alerts WHERE tenant_id=$1 AND created_at > CURRENT_DATE - ($2 || ' days')::INTERVAL
       GROUP BY alert_type ORDER BY c DESC`, [tid, days]);
    const [interventionStats] = await pool.query(
      `SELECT intervention_type, COUNT(*) AS c FROM emotion_alerts WHERE tenant_id=$1 AND resolved=true AND intervention_type IS NOT NULL
       GROUP BY intervention_type ORDER BY c DESC`, [tid]);
    const overallAvg = moodTrend.length > 0 ? (moodTrend.reduce((s,r) => s + parseFloat(r.avg_mood), 0) / moodTrend.length).toFixed(1) : '-';
    res.send(renderPage(req, 'Wellbeing Reports', SKIP + `
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="color:${P}">Wellbeing Report (${days} days)</h2>
          <div style="display:flex;gap:6px">
            <a href="/school/emotion-analytics/reports?days=7" class="btn btn-sm btn-gray">7d</a>
            <a href="/school/emotion-analytics/reports?days=30" class="btn btn-sm ${days===30?'btn-purple':'btn-gray'}">30d</a>
            <a href="/school/emotion-analytics/reports?days=90" class="btn btn-sm ${days===90?'btn-purple':'btn-gray'}">90d</a>
          </div>
        </div>
        <div class="grid-4" style="margin:16px 0">
          <div class="card metric-card" style="border-left:4px solid #059669"><h3 style="color:#059669">${overallAvg}/5</h3><small>Avg Mood</small></div>
          <div class="card metric-card" style="border-left:4px solid #2563eb"><h3 style="color:#2563eb">${moodTrend.reduce((s,r) => s + parseInt(r.unique_students), 0)}</h3><small>Unique Students</small></div>
          <div class="card metric-card" style="border-left:4px solid #d97706"><h3 style="color:#d97706">${moodTrend.reduce((s,r) => s + parseInt(r.checkins), 0)}</h3><small>Total Check-ins</small></div>
          <div class="card metric-card" style="border-left:4px solid #dc2626"><h3 style="color:#dc2626">${alertsSummary.reduce((s,r) => s + parseInt(r.c), 0)}</h3><small>Total Alerts</small></div>
        </div>
        <div class="grid-2">
          <div class="card"><h3 style="color:${P}">Daily Mood Trend</h3>
            <div style="display:flex;align-items:flex-end;gap:3px;height:140px;padding:8px 0">
              ${moodTrend.map(d => {
                const h = (d.avg_mood / 5) * 130;
                const c = d.avg_mood >= 4 ? '#059669' : d.avg_mood >= 3 ? '#d97706' : '#dc2626';
                return `<div style="flex:1;text-align:center" title="${d.date}: mood=${d.avg_mood}, energy=${d.avg_energy}, sleep=${d.avg_sleep}">
                  <div style="height:${h}px;background:${c};border-radius:3px;min-height:3px"></div>
                  <small style="font-size:9px;color:${GRAY}">${d.date.slice(5)}</small></div>`;
              }).join('')}
            </div>
            <div class="grid-4" style="margin-top:8px">
              <div style="text-align:center"><small style="color:#059669">Mood</small><br><strong>${moodTrend.reduce((s,r)=>s+parseFloat(r.avg_mood),0)/moodTrend.length || 0}</strong></div>
              <div style="text-align:center"><small style="color:#2563eb">Energy</small><br><strong>${moodTrend.reduce((s,r)=>s+parseFloat(r.avg_energy),0)/moodTrend.length || 0}</strong></div>
              <div style="text-align:center"><small style="color:#7c3aed">Sleep</small><br><strong>${moodTrend.reduce((s,r)=>s+parseFloat(r.avg_sleep),0)/moodTrend.length || 0}</strong></div>
              <div style="text-align:center"><small style="color:#d97706">Confidence</small><br><strong>${moodTrend.reduce((s,r)=>s+parseFloat(r.avg_confidence),0)/moodTrend.length || 0}</strong></div>
            </div></div>
          <div class="card"><h3 style="color:${P}">Emotion Breakdown</h3>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${emotionBreakdown.map((e,i) => {
                const colors = ['#dc2626','#ea580c','#d97706','#059669','#2563eb','#7c3aed','#ec4899','#14b8a6','#6366f1','#84cc16'];
                return `<div style="flex:1;min-width:80px;text-align:center;padding:8px;background:#f9fafb;border-radius:8px;border-top:3px solid ${colors[i%colors.length]}">
                  <div style="font-size:18px;font-weight:600;color:${colors[i%colors.length]}">${e.total}</div>
                  <small style="color:${GRAY}">${esc(e.emotion)}</small></div>`;
              }).join('')}
            </div></div>
        </div>
        <div class="grid-2" style="margin-top:16px">
          <div class="card"><h3 style="color:${P}">Top Triggers</h3>
            <table><tr><th>Trigger</th><th>Mentions</th></tr>
            ${triggerBreakdown.map(t => `<tr><td>${esc(t.triggers)}</td><td>${t.c}</td></tr>`).join('')}
          </table></div>
          <div class="card"><h3 style="color:${P}">By Time of Day</h3>
            <table><tr><th>Period</th><th>Avg Mood</th><th>Check-ins</th></tr>
            ${periodBreakdown.map(p => `<tr><td style="text-transform:capitalize">${esc(p.period)}</td>
              <td>${p.avg_mood}</td><td>${p.c}</td></tr>`).join('')}
          </table></div>
        </div>
        <div class="grid-2" style="margin-top:16px">
          <div class="card"><h3 style="color:${P}">Alert Types</h3>
            <table><tr><th>Type</th><th>Total</th><th>Resolved</th></tr>
            ${alertsSummary.map(a => `<tr><td>${esc(a.alert_type)}</td><td>${a.c}</td>
              <td><span class="badge badge-green">${a.resolved_count}</span></td></tr>`).join('')}
          </table></div>
          <div class="card"><h3 style="color:${P}">Interventions Used</h3>
            ${interventionStats.length === 0 ? '<p style="color:'+GRAY+'">No interventions recorded yet.</p>' :
              `<table><tr><th>Intervention</th><th>Count</th></tr>
              ${interventionStats.map(i => `<tr><td style="text-transform:capitalize">${esc(i.intervention_type.replace(/_/g,' '))}</td><td>${i.c}</td></tr>`).join('')}</table>`}
          </div>
        </div>
      </div>`, {activeNav: 'emotion-analytics'}));
  }));

  /* ─── Class-level Analytics ─── */
  app.get('/school/emotion-analytics/class-analytics', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [classData] = await pool.query(
      `SELECT 
         (SELECT name FROM classes WHERE id = ec.student_id) AS class_name,
         ec.student_id, 
         AVG(ec.mood_score)::numeric(5,2) AS avg_mood,
         AVG(ec.energy_level)::numeric(5,2) AS avg_energy,
         AVG(ec.sleep_quality)::numeric(5,2) AS avg_sleep,
         COUNT(*) AS checkins,
         MIN(ec.mood_score) AS min_mood,
         MAX(ec.mood_score) AS max_mood
       FROM emotion_checkins ec
       WHERE ec.tenant_id=$1 AND ec.date > CURRENT_DATE - INTERVAL '14 days'
       GROUP BY ec.student_id
       ORDER BY avg_mood ASC LIMIT 30`, [tid]);
    const [weeklyTrend] = await pool.query(
      `SELECT date, COUNT(DISTINCT student_id) AS students, AVG(mood_score)::numeric(5,2) AS avg_mood,
       COUNT(*) FILTER (WHERE mood_score <= 2) AS low_mood_count
       FROM emotion_checkins WHERE tenant_id=$1 AND date > CURRENT_DATE - INTERVAL '14 days'
       GROUP BY date ORDER BY date`, [tid]);
    const [interventionSuggestions] = [];
    if (classData.some(s => s.avg_mood < 2.5)) interventionSuggestions.push({ level: 'high', text: 'Multiple students showing consistently low moods. Consider whole-class wellbeing sessions.' });
    if (weeklyTrend.some(w => parseFloat(w.low_mood_count) > 5)) interventionSuggestions.push({ level: 'high', text: 'High number of low mood reports detected. Schedule counselor availability.' });
    if (classData.filter(s => s.avg_energy < 2.5).length > 3) interventionSuggestions.push({ level: 'medium', text: 'Many students report low energy. Consider reviewing workload and schedule.' });
    if (classData.filter(s => s.avg_sleep < 2.5).length > 3) interventionSuggestions.push({ level: 'medium', text: 'Sleep quality concerns detected. Consider hosting a sleep hygiene workshop.' });
    if (interventionSuggestions.length === 0) interventionSuggestions.push({ level: 'ok', text: 'Overall student wellbeing appears positive. Continue regular monitoring.' });
    res.send(renderPage(req, 'Class Analytics', SKIP + `
      <div class="card">
        <h2 style="color:${P}">Class-Level Analytics (14 days)</h2>
        ${interventionSuggestions.map(s => `<div class="${s.level==='high'?'alert-critical':s.level==='medium'?'alert-warn':'alert-ok'}">
          <strong>${s.level==='high'?'🔴 ':s.level==='medium'?'🟡 ':'🟢 '}${esc(s.text)}</strong></div>`).join('')}
        <div class="grid-2" style="margin-top:16px">
          <div class="card"><h3 style="color:${P}">Weekly Participation & Mood</h3>
            <table><tr><th>Date</th><th>Students</th><th>Avg Mood</th><th>Low Mood Reports</th></tr>
            ${weeklyTrend.map(w => `<tr>
              <td>${w.date}</td><td>${w.students}</td>
              <td style="color:${parseFloat(w.avg_mood)>=4?'#059669':parseFloat(w.avg_mood)>=3?'#d97706':'#dc2626'};font-weight:600">${w.avg_mood}</td>
              <td style="color:${w.low_mood_count>3?'#dc2626':'inherit'}">${w.low_mood_count}</td></tr>`).join('')}
          </table></div>
          <div class="card"><h3 style="color:${P}">Student Wellbeing Ranking</h3>
            <p style="color:${GRAY};font-size:13px;margin-bottom:8px">Students ranked by average mood (lowest first)</p>
            <table><tr><th>Student</th><th>Avg Mood</th><th>Energy</th><th>Sleep</th><th>Check-ins</th></tr>
            ${classData.slice(0, 20).map(s => `<tr>
              <td>${esc(s.class_name||'Student '+s.student_id)}</td>
              <td style="font-weight:600;color:${s.avg_mood<2.5?'#dc2626':s.avg_mood<3.5?'#d97706':'#059669'}">${s.avg_mood}</td>
              <td>${s.avg_energy}</td><td>${s.avg_sleep}</td><td>${s.checkins}</td></tr>`).join('')}
          </table></div>
        </div>
      </div>`, {activeNav: 'emotion-analytics'}));
  }));

  /* ─── API: Student Mood History ─── */
  app.get('/school/emotion-analytics/api/student/:studentId/moods', requireAuth, ah(async (req, res) => {
    const [rows] = await pool.query(
      'SELECT date, mood_score, emotions, energy_level, sleep_quality, confidence_level, period FROM emotion_checkins WHERE tenant_id=$1 AND student_id=$2 ORDER BY date DESC LIMIT 90',
      [req.user.tenant_id, req.params.studentId]);
    res.json(rows);
  }));

  /* ─── API: Real-time Mood Aggregation ─── */
  app.get('/school/emotion-analytics/api/realtime', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [todayStats] = await pool.query(
      `SELECT COUNT(*) AS checkins, AVG(mood_score)::numeric(5,2) AS avg_mood, AVG(energy_level)::numeric(5,2) AS avg_energy,
       COUNT(DISTINCT student_id) AS unique_students FROM emotion_checkins WHERE tenant_id=$1 AND date=CURRENT_DATE`, [tid]);
    const [activeAlerts] = await pool.query(
      "SELECT COUNT(*) AS c FROM emotion_alerts WHERE tenant_id=$1 AND resolved=false", [tid]);
    const [emotionDist] = await pool.query(
      "SELECT key AS emotion, SUM(val)::int AS total FROM emotion_checkins, jsonb_each_text(emotions) WHERE tenant_id=$1 AND date=CURRENT_DATE GROUP BY key ORDER BY total DESC LIMIT 8",
      [tid]);
    const [moodDist] = await pool.query(
      "SELECT mood_score, COUNT(*) AS c FROM emotion_checkins WHERE tenant_id=$1 AND date=CURRENT_DATE GROUP BY mood_score ORDER BY mood_score", [tid]);
    res.json({
      today: todayStats[0] || {},
      activeAlerts: activeAlerts[0].c,
      emotionDistribution: emotionDist,
      moodDistribution: moodDist,
      timestamp: new Date().toISOString()
    });
  }));

  /* ─── API: Intervention Suggestions ─── */
  app.get('/school/emotion-analytics/api/interventions/:studentId', requireAuth, ah(async (req, res) => {
    const tid = req.user.tenant_id;
    const [moodHistory] = await pool.query(
      'SELECT mood_score, date, triggers, emotions FROM emotion_checkins WHERE tenant_id=$1 AND student_id=$2 AND date > CURRENT_DATE - INTERVAL \'14 days\' ORDER BY date',
      [tid, req.params.studentId]);
    const suggestions = [];
    const avgMood = moodHistory.length > 0 ? moodHistory.reduce((s,r) => s + r.mood_score, 0) / moodHistory.length : 3;
    const lowDays = moodHistory.filter(r => r.mood_score <= 2).length;
    const triggers = {};
    moodHistory.forEach(r => {
      if (r.triggers) triggers[r.triggers] = (triggers[r.triggers] || 0) + 1;
    });
    if (avgMood < 2.0) suggestions.push({ priority: 'high', type: 'counseling', message: 'Student mood critically low. Immediate counselor session recommended.' });
    else if (avgMood < 2.5) suggestions.push({ priority: 'high', type: 'teacher_checkin', message: 'Mood trending below average. Teacher should check in privately.' });
    if (lowDays >= 5) suggestions.push({ priority: 'high', type: 'parent_meeting', message: `${lowDays} low-mood days in 2 weeks. Consider parent/guardian meeting.` });
    if (lowDays >= 3 && lowDays < 5) suggestions.push({ priority: 'medium', type: 'monitoring', message: `${lowDays} low-mood days detected. Continue monitoring and consider peer support.` });
    const topTrigger = Object.entries(triggers).sort((a,b) => b[1]-a[1])[0];
    if (topTrigger && topTrigger[1] >= 3) suggestions.push({ priority: 'medium', type: 'trigger_intervention', message: `Recurring trigger: "${topTrigger[0]}" (${topTrigger[1]} times). Address root cause.` });
    const emotionCounts = {};
    moodHistory.forEach(r => {
      const emos = Array.isArray(r.emotions) ? r.emotions : JSON.parse(r.emotions || '[]');
      emos.forEach(e => { emotionCounts[e] = (emotionCounts[e] || 0) + 1; });
    });
    const topEmotion = Object.entries(emotionCounts).sort((a,b) => b[1]-a[1])[0];
    if (topEmotion) suggestions.push({ priority: 'info', type: 'emotion_note', message: `Most common emotion: ${topEmotion[0]} (${topEmotion[1]} times in 2 weeks).` });
    if (suggestions.length === 0) suggestions.push({ priority: 'ok', type: 'none', message: 'Student wellbeing appears stable. No immediate intervention needed.' });
    res.json({ student_id: req.params.studentId, avg_mood: avgMood.toFixed(2), low_days: lowDays, top_triggers: triggers, suggestions });
  }));
};
