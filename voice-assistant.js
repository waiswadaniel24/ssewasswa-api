module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS voice_commands (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, user_id INT NOT NULL,
        command_text TEXT NOT NULL, intent VARCHAR(100), response TEXT,
        confidence DECIMAL(5,4) DEFAULT 0, language VARCHAR(10) DEFAULT 'en',
        duration_ms INT DEFAULT 0, context JSONB DEFAULT '{}',
        timestamp TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS voice_faqs (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, question TEXT NOT NULL,
        answer TEXT NOT NULL, category VARCHAR(50) DEFAULT 'general',
        language VARCHAR(10) DEFAULT 'en', audio_url TEXT,
        keywords JSONB DEFAULT '[]', hit_count INT DEFAULT 0,
        helpful_yes INT DEFAULT 0, helpful_no INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS voice_announcements (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, title VARCHAR(255) NOT NULL,
        content TEXT NOT NULL, audio_url TEXT, scheduled_at TIMESTAMPTZ,
        target_audience VARCHAR(50) DEFAULT 'all', priority VARCHAR(20) DEFAULT 'normal',
        played BOOLEAN DEFAULT false, play_count INT DEFAULT 0,
        created_by INT, status VARCHAR(20) DEFAULT 'active',
        expires_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS voice_feedback (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, user_id INT NOT NULL,
        rating INT NOT NULL CHECK (rating BETWEEN 1 AND 5),
        comment TEXT, command_context TEXT, language VARCHAR(10) DEFAULT 'en',
        sentiment VARCHAR(20), tags JSONB DEFAULT '[]',
        resolved BOOLEAN DEFAULT false, admin_response TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS voice_languages (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, code VARCHAR(10) NOT NULL,
        name VARCHAR(100) NOT NULL, tts_enabled BOOLEAN DEFAULT true,
        stt_enabled BOOLEAN DEFAULT true, is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS voice_reminders (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL, user_id INT NOT NULL,
        title VARCHAR(255) NOT NULL, content TEXT, reminder_at TIMESTAMPTZ NOT NULL,
        recurring VARCHAR(20), voice_enabled BOOLEAN DEFAULT true,
        status VARCHAR(20) DEFAULT 'active', delivered BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[Mod] voice-assistant OK');
    } catch(e) { console.warn('[Mod] voice-assistant Warn:', e.message); }
  })();

  const INTENTS = ['schedule_query','homework_check','navigation','announcement','faq','reminder','general','unknown'];
  const LANGUAGES = ['en','es','fr','de','pt','zh','ja','ko','ar','hi'];
  const CATEGORIES = ['general','academic','schedule','homework','navigation','emergency','it_support','health','events','fees'];

  /* ════════════════════════════════════════════════
     ROUTE 1 — Dashboard
     ════════════════════════════════════════════════ */
  app.get('/school/voice-assistant', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const [commands, faqs, announcements, feedback] = await Promise.all([
        pool.query('SELECT COUNT(*) AS cnt FROM voice_commands WHERE tenant_id=$1 AND timestamp > NOW() - INTERVAL \'7 days\'', [tid]),
        pool.query('SELECT COUNT(*) AS cnt FROM voice_faqs WHERE tenant_id=$1', [tid]),
        pool.query('SELECT COUNT(*) AS cnt FROM voice_announcements WHERE tenant_id=$1 AND status=$2', [tid, 'active']),
        pool.query('SELECT COUNT(*) AS cnt, COALESCE(AVG(rating),0) AS avg_rating FROM voice_feedback WHERE tenant_id=$1', [tid])
      ]);
      const recentCmds = await pool.query(`SELECT v.*, u.name AS user_name FROM voice_commands v
        LEFT JOIN users u ON v.user_id=u.id WHERE v.tenant_id=$1 ORDER BY v.timestamp DESC LIMIT 8`, [tid]);
      const intentCounts = await pool.query(`SELECT intent, COUNT(*) AS cnt FROM voice_commands
        WHERE tenant_id=$1 AND timestamp > NOW() - INTERVAL '30 days' GROUP BY intent ORDER BY cnt DESC`, [tid]);
      const rows = `
        <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${commands.rows[0].cnt}</div><div style="color:${GRAY}">Commands (7d)</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:${P}">${faqs.rows[0].cnt}</div><div style="color:${GRAY}">FAQ Entries</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#10b981">${announcements.rows[0].cnt}</div><div style="color:${GRAY}">Active Announcements</div></div>
          <div class="card" style="text-align:center"><div style="font-size:2em;color:#f59e0b">${Number(feedback.rows[0].avg_rating).toFixed(1)}★</div><div style="color:${GRAY}">Avg Rating (${feedback.rows[0].cnt})</div></div>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
          <a class="btn" href="/school/voice-assistant/command" style="background:#10b981;text-decoration:none">Voice Command</a>
          <a class="btn" href="/school/voice-assistant/commands" style="text-decoration:none">Command Log</a>
          <a class="btn" href="/school/voice-assistant/faqs" style="background:#8b5cf6;text-decoration:none">FAQs</a>
          <a class="btn" href="/school/voice-assistant/announcements" style="background:#f59e0b;text-decoration:none">Announcements</a>
          <a class="btn" href="/school/voice-assistant/reminders" style="background:#ec4899;text-decoration:none">Reminders</a>
          <a class="btn" href="/school/voice-assistant/feedback" style="background:#06b6d4;text-decoration:none">Feedback</a>
          <a class="btn" href="/school/voice-assistant/languages" style="background:${GRAY};text-decoration:none">Languages</a>
          <a class="btn" href="/school/voice-assistant/analytics" style="background:#64748b;text-decoration:none">Analytics</a>
        </div>
        <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
          <div class="card"><h3 style="margin-top:0">Recent Commands</h3>
            <table><tr><th>User</th><th>Command</th><th>Intent</th><th>Confidence</th><th>Time</th></tr>
            ${recentCmds.rows.map(c => `<tr><td>${esc(c.user_name||'ID:'+c.user_id)}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.command_text)}</td><td>${esc(c.intent||'—')}</td><td>${(c.confidence*100).toFixed(0)}%</td><td>${new Date(c.timestamp).toLocaleString()}</td></tr>`).join('')}
            ${recentCmds.rows.length===0?'<tr><td colspan="5" style="text-align:center;color:'+GRAY+'">No commands yet</td></tr>':''}
            </table>
          </div>
          <div class="card"><h3 style="margin-top:0">Top Intents</h3>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${intentCounts.rows.map(ic => `<div style="display:flex;justify-content:space-between;align-items:center">
                <span style="font-size:0.9em">${esc(ic.intent||'unknown')}</span>
                <span style="background:${P};color:#fff;padding:2px 10px;border-radius:12px;font-size:0.85em">${ic.cnt}</span>
              </div>`).join('')}
              ${intentCounts.rows.length===0?'<p style="color:'+GRAY+';font-size:0.9em">No data yet</p>':''}
            </div>
          </div>
        </div>`;
      renderPage(req, res, 'Voice Assistant', rows, SKIP, '/school/voice-assistant');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 2 — Voice Command Interface
     ════════════════════════════════════════════════ */
  app.get('/school/voice-assistant/command', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Voice Command</h3>
        <p style="color:${GRAY}">Type a command or use voice input to interact with the school assistant.</p>
        <div style="background:#f9fafb;border-radius:12px;padding:24px;margin-top:16px;text-align:center">
          <div id="voice-status" style="font-size:3em;margin-bottom:12px">🎤</div>
          <div id="transcript" style="min-height:60px;padding:12px;background:#fff;border-radius:8px;border:2px solid #e5e7eb;margin-bottom:12px;font-size:1.1em">Speak or type your command...</div>
          <div style="display:flex;gap:8px;justify-content:center;margin-bottom:16px">
            <button class="btn" onclick="startListening()" style="background:#10b981" id="mic-btn">🎤 Start Listening</button>
            <button class="btn" onclick="stopListening()" style="background:#ef4444" id="stop-btn" disabled>⏹ Stop</button>
          </div>
          <form method="post" action="/school/voice-assistant/command" style="display:flex;gap:8px;max-width:500px;margin:0 auto">
            <input name="command_text" id="cmd-input" placeholder="Or type a command..." required style="flex:1">
            <select name="language" style="width:80px">${LANGUAGES.map(l=>`<option value="${l}">${l.toUpperCase()}</option>`).join('')}</select>
            <button class="btn" type="submit">Send</button>
          </form>
        </div>
        <div style="margin-top:16px"><label>Select Language:</label>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">${LANGUAGES.map(l=>`<span style="background:#f3f4f6;padding:4px 10px;border-radius:8px;cursor:pointer;font-size:0.85em">${l.toUpperCase()}</span>`).join('')}</div>
        </div>
        <div class="card" style="margin-top:16px"><h3 style="margin-top:0">Example Commands</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div style="background:#f9fafb;padding:10px;border-radius:8px;font-size:0.9em">📅 "What is my schedule today?"</div>
            <div style="background:#f9fafb;padding:10px;border-radius:8px;font-size:0.9em">📝 "What homework is due tomorrow?"</div>
            <div style="background:#f9fafb;padding:10px;border-radius:8px;font-size:0.9em">📍 "Where is the library?"</div>
            <div style="background:#f9fafb;padding:10px;border-radius:8px;font-size:0.9em">📢 "Any new announcements?"</div>
            <div style="background:#f9fafb;padding:10px;border-radius:8px;font-size:0.9em">⏰ "Remind me about math test at 2pm"</div>
            <div style="background:#f9fafb;padding:10px;border-radius:8px;font-size:0.9em">❓ "What is the refund policy?"</div>
          </div>
        </div>
      </div>
      <script>
      var recognition = null;
      function startListening() {
        if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
          document.getElementById('transcript').textContent = 'Speech recognition not supported in this browser.';
          return;
        }
        recognition = new (window.SpeechRecognition || window.webkitSpeechRecognition)();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.onresult = function(e) {
          var transcript = '';
          for (var i = 0; i < e.results.length; i++) { transcript += e.results[i][0].transcript; }
          document.getElementById('transcript').textContent = transcript;
          document.getElementById('cmd-input').value = transcript;
        };
        recognition.onend = function() { document.getElementById('voice-status').textContent = '🎤'; };
        recognition.start();
        document.getElementById('voice-status').textContent = '🔴';
        document.getElementById('mic-btn').disabled = true;
        document.getElementById('stop-btn').disabled = false;
      }
      function stopListening() {
        if (recognition) { recognition.stop(); }
        document.getElementById('voice-status').textContent = '🎤';
        document.getElementById('mic-btn').disabled = false;
        document.getElementById('stop-btn').disabled = true;
      }
      </script>`;
    renderPage(req, res, 'Voice Command', html, SKIP, '/school/voice-assistant');
  });

  app.post('/school/voice-assistant/command', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { command_text, language } = req.body;
      const cmd = command_text.toLowerCase().trim();
      let intent = 'general', response = '', confidence = 0.7;
      /* Simple intent matching */
      if (cmd.includes('schedule') || cmd.includes('timetable') || cmd.includes('class today')) {
        intent = 'schedule_query'; confidence = 0.92;
        response = 'Your schedule for today: Mathematics 8:00-9:00, Science 9:30-10:30, English 11:00-12:00, Lunch 12:00-1:00, History 2:00-3:00.';
      } else if (cmd.includes('homework') || cmd.includes('assignment') || cmd.includes('due')) {
        intent = 'homework_check'; confidence = 0.9;
        response = 'You have 3 pending assignments: Math worksheet due tomorrow, Science lab report due Friday, English essay due next Monday.';
      } else if (cmd.includes('where') || cmd.includes('location') || cmd.includes('find') || cmd.includes('navigate')) {
        intent = 'navigation'; confidence = 0.88;
        response = 'I can help you navigate the campus. Please specify what you are looking for (e.g., library, cafeteria, admin office).';
      } else if (cmd.includes('announcement') || cmd.includes('news') || cmd.includes('update')) {
        intent = 'announcement'; confidence = 0.91;
        response = 'Latest announcements: Sports day is next Friday, Parent-teacher meeting scheduled for March 15th, Library hours extended during exam week.';
      } else if (cmd.includes('remind') || cmd.includes('alarm') || cmd.includes('alert')) {
        intent = 'reminder'; confidence = 0.85;
        response = 'Reminder set. I will notify you at the specified time.';
      } else {
        response = 'I understood your request. Let me find the best answer for you. You can ask about schedules, homework, locations, announcements, or set reminders.';
      }
      await pool.query(`INSERT INTO voice_commands (tenant_id,user_id,command_text,intent,response,confidence,language)
        VALUES ($1,$2,$3,$4,$5,$6,$7)`, [req.tenant_id, req.user_id, command_text, intent, response, confidence, language || 'en']);
      audit(req, 'voice_command', { intent, confidence });
      const html = `
        <div class="card"><h3 style="margin-top:0">Command Result</h3>
          <div style="background:#f0fdf4;border:2px solid #10b981;padding:16px;border-radius:12px;margin-bottom:16px">
            <p style="margin:0 0 8px;color:${GRAY}">You said:</p>
            <p style="font-size:1.1em;font-weight:bold">${esc(command_text)}</p>
          </div>
          <div style="background:#eff6ff;border:2px solid ${P};padding:16px;border-radius:12px">
            <p style="margin:0 0 8px;color:${GRAY}">Response (Intent: ${esc(intent)}, Confidence: ${(confidence*100).toFixed(0)}%):</p>
            <p style="font-size:1.1em">${esc(response)}</p>
          </div>
          <div style="margin-top:16px;display:flex;gap:8px">
            <a class="btn" href="/school/voice-assistant/command" style="text-decoration:none">Ask Another</a>
            <a class="btn" href="/school/voice-assistant" style="background:${GRAY};text-decoration:none">Dashboard</a>
          </div>
        </div>`;
      renderPage(req, res, 'Command Result', html, SKIP, '/school/voice-assistant');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 3 — Command Log
     ════════════════════════════════════════════════ */
  app.get('/school/voice-assistant/commands', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { intent, user_id, from, to } = req.query;
      let sql = `SELECT v.*, u.name AS user_name FROM voice_commands v LEFT JOIN users u ON v.user_id=u.id WHERE v.tenant_id=$1`;
      const params = [req.tenant_id];
      let i = 2;
      if (intent) { sql += ` AND v.intent=$${i++}`; params.push(intent); }
      if (user_id) { sql += ` AND v.user_id=$${i++}`; params.push(user_id); }
      if (from) { sql += ` AND v.timestamp >= $${i++}`; params.push(from); }
      if (to) { sql += ` AND v.timestamp <= $${i++}`; params.push(to); }
      sql += ' ORDER BY v.timestamp DESC LIMIT 200';
      const result = await pool.query(sql, params);
      const html = `
        <div class="card"><h3 style="margin-top:0">Command Log</h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <select name="intent" style="width:150px"><option value="">All Intents</option>${INTENTS.map(x=>`<option value="${x}" ${intent===x?'selected':''}>${x}</option>`).join('')}</select>
            <input name="user_id" placeholder="User ID" value="${esc(user_id||'')}" style="width:100px">
            <input name="from" type="date" value="${esc(from||'')}" style="width:140px">
            <input name="to" type="date" value="${esc(to||'')}" style="width:140px">
            <button class="btn" type="submit">Filter</button>
          </form>
          <table><tr><th>Time</th><th>User</th><th>Command</th><th>Intent</th><th>Confidence</th><th>Language</th><th>Duration</th></tr>
          ${result.rows.map(c => `<tr><td style="white-space:nowrap">${new Date(c.timestamp).toLocaleString()}</td><td>${esc(c.user_name||'ID:'+c.user_id)}</td><td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(c.command_text)}">${esc(c.command_text)}</td><td>${esc(c.intent||'—')}</td><td style="color:${c.confidence>0.8?'#10b981':c.confidence>0.6?'#f59e0b':'#ef4444'}">${(c.confidence*100).toFixed(0)}%</td><td>${esc(c.language)}</td><td>${c.duration_ms||0}ms</td></tr>`).join('')}
          ${result.rows.length===0?'<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No commands logged</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Command Log', html, SKIP, '/school/voice-assistant');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 4 — FAQ Management
     ════════════════════════════════════════════════ */
  app.get('/school/voice-assistant/faqs', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { category, search, language } = req.query;
      let sql = 'SELECT * FROM voice_faqs WHERE tenant_id=$1';
      const params = [req.tenant_id];
      let i = 2;
      if (category) { sql += ` AND category=$${i++}`; params.push(category); }
      if (language) { sql += ` AND language=$${i++}`; params.push(language); }
      if (search) { sql += ` AND (question ILIKE $${i++} OR answer ILIKE $${i++})`; params.push(`%${search}%`,`%${search}%`); }
      sql += ' ORDER BY hit_count DESC, created_at DESC';
      const result = await pool.query(sql, params);
      const html = `
        <div class="card"><h3 style="margin-top:0">FAQ System <a class="btn" href="/school/voice-assistant/faqs/new" style="background:#8b5cf6;font-size:0.85em;padding:4px 12px;text-decoration:none">+ Add FAQ</a></h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <input name="search" placeholder="Search FAQs..." value="${esc(search||'')}" style="width:200px">
            <select name="category" style="width:150px"><option value="">All Categories</option>${CATEGORIES.map(c=>`<option value="${c}" ${category===c?'selected':''}>${c.replace(/_/g,' ')}</option>`).join('')}</select>
            <select name="language" style="width:100px"><option value="">All</option>${LANGUAGES.map(l=>`<option value="${l}" ${language===l?'selected':''}>${l.toUpperCase()}</option>`).join('')}</select>
            <button class="btn" type="submit">Search</button>
          </form>
          <div style="display:grid;gap:12px">
            ${result.rows.map(f => `<div style="background:#f9fafb;padding:16px;border-radius:8px;border-left:4px solid ${P}">
              <div style="display:flex;justify-content:space-between;align-items:start">
                <h4 style="margin:0">${esc(f.question)}</h4>
                <div style="display:flex;gap:8px;font-size:0.8em;color:${GRAY}">
                  <span>${esc(f.category)}</span><span>${f.language.toUpperCase()}</span>
                  <span>${f.hit_count} hits</span>
                  <span>👍${f.helpful_yes} 👎${f.helpful_no}</span>
                </div>
              </div>
              <p style="margin:8px 0 0;color:#374151">${esc(f.answer)}</p>
              ${f.keywords&&f.keywords.length?`<div style="margin-top:6px">${f.keywords.map(k=>`<span style="background:#e0e7ff;color:${P};padding:1px 8px;border-radius:8px;font-size:0.8em;margin-right:4px">${esc(k)}</span>`).join('')}</div>`:''}
              <div style="margin-top:8px;display:flex;gap:8px">
                <a class="btn" href="/school/voice-assistant/faqs/${f.id}/edit" style="font-size:0.85em;padding:4px 12px">Edit</a>
                <form method="post" action="/school/voice-assistant/faqs/${f.id}/delete" style="display:inline"><button class="btn" style="background:#ef4444;font-size:0.85em;padding:4px 12px" onclick="return confirm('Delete this FAQ?')">Delete</button></form>
              </div>
            </div>`).join('')}
            ${result.rows.length===0?'<p style="color:'+GRAY+';text-align:center">No FAQs found</p>':''}
          </div>
        </div>`;
      renderPage(req, res, 'FAQs', html, SKIP, '/school/voice-assistant');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/voice-assistant/faqs/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Add FAQ</h3>
        <form method="post" action="/school/voice-assistant/faqs/new">
          <div style="margin-bottom:12px"><label>Question *</label><input name="question" required placeholder="e.g. What time does school start?"></div>
          <div style="margin-bottom:12px"><label>Answer *</label><textarea name="answer" rows="3" required placeholder="Clear and concise answer..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Category</label><select name="category">${CATEGORIES.map(c=>`<option value="${c}">${c.replace(/_/g,' ')}</option>`).join('')}</select></div>
            <div><label>Language</label><select name="language">${LANGUAGES.map(l=>`<option value="${l}" ${l==='en'?'selected':''}>${l.toUpperCase()}</option>`).join('')}</select></div>
          </div>
          <div style="margin-top:12px"><label>Keywords (JSON array)</label><input name="keywords" placeholder='["school","start","time","hours"]'></div>
          <div style="margin-top:12px"><label>Audio URL (optional TTS)</label><input name="audio_url" placeholder="https://..."></div>
          <div style="margin-top:16px"><button class="btn" type="submit" style="background:#8b5cf6">Add FAQ</button> <a class="btn" href="/school/voice-assistant/faqs" style="background:${GRAY}">Cancel</a></div>
        </form>
      </div>`;
    renderPage(req, res, 'Add FAQ', html, SKIP, '/school/voice-assistant');
  });

  app.post('/school/voice-assistant/faqs/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { question, answer, category, language, keywords, audio_url } = req.body;
      let kw = [];
      try { kw = JSON.parse(keywords || '[]'); } catch(_) {}
      await pool.query(`INSERT INTO voice_faqs (tenant_id,question,answer,category,language,keywords,audio_url) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [req.tenant_id, question, answer, category, language || 'en', JSON.stringify(kw), audio_url]);
      audit(req, 'faq_added', { question });
      req.flash('success', 'FAQ added');
      res.redirect('/school/voice-assistant/faqs');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/voice-assistant/faqs/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const faq = await pool.query('SELECT * FROM voice_faqs WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      if (!faq.rows[0]) return res.status(404).send('Not found');
      const f = faq.rows[0];
      const html = `
        <div class="card"><h3 style="margin-top:0">Edit FAQ</h3>
          <form method="post" action="/school/voice-assistant/faqs/${f.id}/edit">
            <div style="margin-bottom:12px"><label>Question *</label><input name="question" value="${esc(f.question)}" required></div>
            <div style="margin-bottom:12px"><label>Answer *</label><textarea name="answer" rows="3" required>${esc(f.answer)}</textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Category</label><select name="category">${CATEGORIES.map(c=>`<option value="${c}" ${f.category===c?'selected':''}>${c.replace(/_/g,' ')}</option>`).join('')}</select></div>
              <div><label>Language</label><select name="language">${LANGUAGES.map(l=>`<option value="${l}" ${f.language===l?'selected':''}>${l.toUpperCase()}</option>`).join('')}</select></div>
            </div>
            <div style="margin-top:12px"><label>Keywords (JSON)</label><input name="keywords" value="${esc(JSON.stringify(f.keywords||[]))}"></div>
            <div style="margin-top:12px"><label>Audio URL</label><input name="audio_url" value="${esc(f.audio_url||'')}"></div>
            <div style="margin-top:16px"><button class="btn" type="submit">Save</button> <a class="btn" href="/school/voice-assistant/faqs" style="background:${GRAY}">Cancel</a></div>
          </form>
        </div>`;
      renderPage(req, res, 'Edit FAQ', html, SKIP, '/school/voice-assistant');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/voice-assistant/faqs/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { question, answer, category, language, keywords, audio_url } = req.body;
      let kw = [];
      try { kw = JSON.parse(keywords || '[]'); } catch(_) {}
      await pool.query(`UPDATE voice_faqs SET question=$1,answer=$2,category=$3,language=$4,keywords=$5,audio_url=$6,updated_at=NOW() WHERE id=$7 AND tenant_id=$8`,
        [question, answer, category, language, JSON.stringify(kw), audio_url, req.params.id, req.tenant_id]);
      audit(req, 'faq_edited', { id: req.params.id });
      req.flash('success', 'FAQ updated');
      res.redirect('/school/voice-assistant/faqs');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/voice-assistant/faqs/:id/delete', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query('DELETE FROM voice_faqs WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      audit(req, 'faq_deleted', { id: req.params.id });
      req.flash('success', 'FAQ deleted');
      res.redirect('/school/voice-assistant/faqs');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 5 — Announcements
     ════════════════════════════════════════════════ */
  app.get('/school/voice-assistant/announcements', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { status: st, priority } = req.query;
      let sql = `SELECT a.*, u.name AS created_by_name FROM voice_announcements a
        LEFT JOIN users u ON a.created_by=u.id WHERE a.tenant_id=$1`;
      const params = [req.tenant_id];
      let i = 2;
      if (st) { sql += ` AND a.status=$${i++}`; params.push(st); }
      if (priority) { sql += ` AND a.priority=$${i++}`; params.push(priority); }
      sql += ' ORDER BY a.scheduled_at DESC NULLS LAST, a.created_at DESC';
      const result = await pool.query(sql, params);
      const html = `
        <div class="card"><h3 style="margin-top:0">Announcements <a class="btn" href="/school/voice-assistant/announcements/new" style="background:#f59e0b;font-size:0.85em;padding:4px 12px;text-decoration:none">+ New</a></h3>
          <form method="get" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <select name="status" style="width:130px"><option value="">All Status</option><option value="active" ${st==='active'?'selected':''}>Active</option><option value="expired" ${st==='expired'?'selected':''}>Expired</option><option value="archived" ${st==='archived'?'selected':''}>Archived</option></select>
            <select name="priority" style="width:130px"><option value="">All</option><option value="urgent" ${priority==='urgent'?'selected':''}>Urgent</option><option value="normal" ${priority==='normal'?'selected':''}>Normal</option><option value="low" ${priority==='low'?'selected':''}>Low</option></select>
            <button class="btn" type="submit">Filter</button>
          </form>
          <div style="display:grid;gap:12px">
            ${result.rows.map(a => `<div style="background:#fff;border:1px solid #e5e7eb;padding:16px;border-radius:8px;border-left:4px solid ${a.priority==='urgent'?'#ef4444':a.priority==='normal'?'#f59e0b':'#10b981'}">
              <div style="display:flex;justify-content:space-between;align-items:start">
                <div><h4 style="margin:0">${esc(a.title)}</h4><p style="color:#374151;margin:4px 0 0">${esc(a.content).substring(0,200)}${(a.content||'').length>200?'...':''}</p></div>
                <span style="background:${a.status==='active'?'#d1fae5':'#f3f4f6'};color:${a.status==='active'?'#065f46':GRAY};padding:2px 10px;border-radius:12px;font-size:0.8em;white-space:nowrap">${esc(a.status)}</span>
              </div>
              <div style="display:flex;gap:16px;margin-top:8px;font-size:0.85em;color:${GRAY}">
                <span>${a.priority.toUpperCase()}</span>
                <span>Target: ${esc(a.target_audience)}</span>
                <span>By: ${esc(a.created_by_name||'—')}</span>
                <span>Played: ${a.play_count} times</span>
                ${a.scheduled_at?`<span>Scheduled: ${new Date(a.scheduled_at).toLocaleString()}</span>`:''}
              </div>
            </div>`).join('')}
            ${result.rows.length===0?'<p style="color:'+GRAY+';text-align:center">No announcements</p>':''}
          </div>
        </div>`;
      renderPage(req, res, 'Announcements', html, SKIP, '/school/voice-assistant');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/voice-assistant/announcements/new', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Create Announcement</h3>
        <form method="post" action="/school/voice-assistant/announcements/new">
          <div style="margin-bottom:12px"><label>Title *</label><input name="title" required placeholder="e.g. School Closure Notice"></div>
          <div style="margin-bottom:12px"><label>Content *</label><textarea name="content" rows="4" required placeholder="Announcement content..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Priority</label><select name="priority"><option value="normal">Normal</option><option value="urgent">Urgent</option><option value="low">Low</option></select></div>
            <div><label>Target Audience</label><select name="target_audience"><option value="all">All</option><option value="students">Students</option><option value="teachers">Teachers</option><option value="parents">Parents</option><option value="staff">Staff</option></select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
            <div><label>Schedule At</label><input name="scheduled_at" type="datetime-local"></div>
            <div><label>Expires At</label><input name="expires_at" type="datetime-local"></div>
          </div>
          <div style="margin-top:12px"><label>Audio URL (pre-recorded)</label><input name="audio_url" placeholder="https://..."></div>
          <div style="margin-top:16px"><button class="btn" type="submit" style="background:#f59e0b">Create Announcement</button> <a class="btn" href="/school/voice-assistant/announcements" style="background:${GRAY}">Cancel</a></div>
        </form>
      </div>`;
    renderPage(req, res, 'New Announcement', html, SKIP, '/school/voice-assistant');
  });

  app.post('/school/voice-assistant/announcements/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, content, priority, target_audience, scheduled_at, expires_at, audio_url } = req.body;
      await pool.query(`INSERT INTO voice_announcements (tenant_id,title,content,priority,target_audience,scheduled_at,expires_at,audio_url,created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`, [req.tenant_id, title, content, priority, target_audience, scheduled_at||null, expires_at||null, audio_url, req.user_id]);
      audit(req, 'announcement_created', { title, priority });
      req.flash('success', 'Announcement created');
      res.redirect('/school/voice-assistant/announcements');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 6 — Reminders
     ════════════════════════════════════════════════ */
  app.get('/school/voice-assistant/reminders', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const reminders = await pool.query(`SELECT * FROM voice_reminders WHERE tenant_id=$1 AND user_id=$2 ORDER BY reminder_at DESC`, [req.tenant_id, req.user_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">My Reminders</h3>
          <form method="post" action="/school/voice-assistant/reminders" style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
            <input name="title" placeholder="Reminder title..." required style="width:250px">
            <input name="content" placeholder="Details..." style="width:200px">
            <input name="reminder_at" type="datetime-local" required style="width:200px">
            <button class="btn" type="submit" style="background:#ec4899">Set Reminder</button>
          </form>
          <table><tr><th>Title</th><th>Details</th><th>When</th><th>Recurring</th><th>Voice</th><th>Status</th><th>Actions</th></tr>
          ${reminders.rows.map(r => `<tr><td>${esc(r.title)}</td><td>${esc(r.content||'—')}</td><td>${new Date(r.reminder_at).toLocaleString()}</td><td>${esc(r.recurring||'—')}</td><td>${r.voice_enabled?'🔊':'🔇'}</td><td>${esc(r.status)}</td><td>${r.status==='active'?`<form method="post" action="/school/voice-assistant/reminders/${r.id}/complete" style="display:inline"><button class="btn" style="font-size:0.85em;padding:4px 12px;background:#10b981">Done</button></form>`:''}</td></tr>`).join('')}
          ${reminders.rows.length===0?'<tr><td colspan="7" style="text-align:center;color:'+GRAY+'">No reminders set</td></tr>':''}
          </table>
        </div>`;
      renderPage(req, res, 'Reminders', html, SKIP, '/school/voice-assistant');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/voice-assistant/reminders', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { title, content, reminder_at } = req.body;
      await pool.query(`INSERT INTO voice_reminders (tenant_id,user_id,title,content,reminder_at) VALUES ($1,$2,$3,$4,$5)`,
        [req.tenant_id, req.user_id, title, content, reminder_at]);
      audit(req, 'reminder_created', { title });
      req.flash('success', 'Reminder set');
      res.redirect('/school/voice-assistant/reminders');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/voice-assistant/reminders/:id/complete', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query('UPDATE voice_reminders SET status=$1, delivered=true WHERE id=$2 AND tenant_id=$3 AND user_id=$4', ['completed', req.params.id, req.tenant_id, req.user_id]);
      req.flash('success', 'Reminder completed');
      res.redirect('/school/voice-assistant/reminders');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 7 — Feedback
     ════════════════════════════════════════════════ */
  app.get('/school/voice-assistant/feedback', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const isAdmin = req.user_role === 'admin';
      let feedback;
      if (isAdmin) {
        feedback = await pool.query(`SELECT f.*, u.name AS user_name FROM voice_feedback f
          JOIN users u ON f.user_id=u.id WHERE f.tenant_id=$1 ORDER BY f.created_at DESC LIMIT 100`, [req.tenant_id]);
      } else {
        feedback = await pool.query(`SELECT * FROM voice_feedback WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 50`, [req.tenant_id, req.user_id]);
      }
      const html = `
        <div class="card"><h3 style="margin-top:0">Voice Feedback</h3>
          <form method="post" action="/school/voice-assistant/feedback" style="background:#f9fafb;padding:16px;border-radius:8px;margin-bottom:16px">
            <div style="margin-bottom:12px"><label>Rating *</label>
              <div style="display:flex;gap:4px;margin-top:4px">${[1,2,3,4,5].map(n=>`<label style="font-size:1.5em;cursor:pointer"><input type="radio" name="rating" value="${n}" required style="display:none" onclick="highlightStars(${n})"><span id="star${n}">${n<=3?'⭐':'🌟'}</span></label>`).join('')}</div>
            </div>
            <div style="margin-bottom:12px"><label>Comment</label><textarea name="comment" rows="2" placeholder="How can the voice assistant improve?"></textarea></div>
            <div style="margin-bottom:12px"><label>Context (what were you trying to do?)</label><input name="command_context" placeholder="e.g. I asked about the timetable but got homework info"></div>
            <button class="btn" type="submit" style="background:#06b6d4">Submit Feedback</button>
          </form>
          <table><tr><th>Date</th><th>${isAdmin?'User':'Rating'}</th><th>Rating</th><th>Comment</th><th>Context</th><th>Status</th></tr>
          ${feedback.rows.map(f => `<tr><td>${new Date(f.created_at).toLocaleDateString()}</td>${isAdmin?`<td>${esc(f.user_name)}</td>`:''}<td>${'⭐'.repeat(f.rating)}</td><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.comment||'—')}</td><td style="max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.command_context||'—')}</td><td>${f.resolved?'✅ Resolved':'Pending'}</td></tr>`).join('')}
          ${feedback.rows.length===0?'<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No feedback yet</td></tr>':''}
          </table>
        </div>
        <script>function highlightStars(n){for(var i=1;i<=5;i++){document.getElementById('star'+i).textContent=i<=n?'🌟':'⭐';}}</script>`;
      renderPage(req, res, 'Feedback', html, SKIP, '/school/voice-assistant');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/voice-assistant/feedback', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const { rating, comment, command_context } = req.body;
      await pool.query(`INSERT INTO voice_feedback (tenant_id,user_id,rating,comment,command_context,sentiment)
        VALUES ($1,$2,$3,$4,$5,$6)`, [req.tenant_id, req.user_id, parseInt(rating), comment, command_context, rating >= 4 ? 'positive' : rating >= 3 ? 'neutral' : 'negative']);
      audit(req, 'voice_feedback', { rating });
      req.flash('success', 'Thank you for your feedback!');
      res.redirect('/school/voice-assistant/feedback');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 8 — Multi-language Settings
     ════════════════════════════════════════════════ */
  app.get('/school/voice-assistant/languages', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const langs = await pool.query('SELECT * FROM voice_languages WHERE tenant_id=$1 ORDER BY name', [req.tenant_id]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Language Support</h3>
          <p style="color:${GRAY};margin-bottom:16px">Configure TTS (Text-to-Speech) and STT (Speech-to-Text) support for multiple languages.</p>
          <table><tr><th>Code</th><th>Language</th><th>TTS</th><th>STT</th><th>Active</th><th>Actions</th></tr>
          ${langs.rows.map(l => `<tr><td><code>${esc(l.code)}</code></td><td>${esc(l.name)}</td><td>${l.tts_enabled?'✅':'❌'}</td><td>${l.stt_enabled?'✅':'❌'}</td><td>${l.is_active?'🟢':'🔴'}</td>
            <td><a class="btn" href="/school/voice-assistant/languages/${l.id}/toggle" style="font-size:0.85em;padding:4px 12px;background:${l.is_active?'#ef4444':'#10b981'}">${l.is_active?'Disable':'Enable'}</a></td></tr>`).join('')}
          ${langs.rows.length===0?'<tr><td colspan="6" style="text-align:center;color:'+GRAY+'">No languages configured</td></tr>':''}
          </table>
          <form method="post" action="/school/voice-assistant/languages" style="margin-top:16px;display:flex;gap:8px;flex-wrap:wrap">
            <input name="code" placeholder="Language code (e.g. fr)" required style="width:120px">
            <input name="name" placeholder="Language name (e.g. French)" required style="width:200px">
            <button class="btn" type="submit">Add Language</button>
          </form>
        </div>`;
      renderPage(req, res, 'Languages', html, SKIP, '/school/voice-assistant');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/voice-assistant/languages', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query(`INSERT INTO voice_languages (tenant_id,code,name) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`,
        [req.tenant_id, req.body.code.toLowerCase(), req.body.name]);
      req.flash('success', 'Language added');
      res.redirect('/school/voice-assistant/languages');
    } catch(e) { ah(e, req, res); }
  });

  app.get('/school/voice-assistant/languages/:id/toggle', requireAuth, requireNotBanned, async (req, res) => {
    try {
      await pool.query('UPDATE voice_languages SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2', [req.params.id, req.tenant_id]);
      res.redirect('/school/voice-assistant/languages');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 9 — Analytics
     ════════════════════════════════════════════════ */
  app.get('/school/voice-assistant/analytics', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const [totalCmds, avgConf, byLanguage, byIntent, dailyUsage, feedbackStats] = await Promise.all([
        pool.query('SELECT COUNT(*) AS cnt FROM voice_commands WHERE tenant_id=$1', [req.tenant_id]),
        pool.query('SELECT AVG(confidence) AS avg_conf FROM voice_commands WHERE tenant_id=$1', [req.tenant_id]),
        pool.query(`SELECT language, COUNT(*) AS cnt FROM voice_commands WHERE tenant_id=$1 GROUP BY language ORDER BY cnt DESC`, [req.tenant_id]),
        pool.query(`SELECT intent, COUNT(*) AS cnt, AVG(confidence) AS avg_conf FROM voice_commands WHERE tenant_id=$1 GROUP BY intent ORDER BY cnt DESC`, [req.tenant_id]),
        pool.query(`SELECT DATE(timestamp) AS day, COUNT(*) AS cnt FROM voice_commands WHERE tenant_id=$1 AND timestamp > NOW() - INTERVAL '30 days' GROUP BY DATE(timestamp) ORDER BY day DESC LIMIT 30`, [req.tenant_id]),
        pool.query(`SELECT sentiment, COUNT(*) AS cnt, AVG(rating) AS avg_rating FROM voice_feedback WHERE tenant_id=$1 GROUP BY sentiment ORDER BY cnt DESC`, [req.tenant_id])
      ]);
      const html = `
        <div class="card"><h3 style="margin-top:0">Voice Assistant Analytics</h3>
          <div class="stats-grid" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px">
            <div style="text-align:center"><div style="font-size:2em;color:${P}">${totalCmds.rows[0].cnt}</div><div style="color:${GRAY}">Total Commands</div></div>
            <div style="text-align:center"><div style="font-size:2em;color:#10b981">${(Number(avgConf.rows[0].avg_conf)*100).toFixed(1)}%</div><div style="color:${GRAY}">Avg Confidence</div></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
            <div class="card"><h4>Commands by Intent</h4>
              <table><tr><th>Intent</th><th>Count</th><th>Avg Confidence</th></tr>
              ${byIntent.rows.map(i=>`<tr><td>${esc(i.intent||'unknown')}</td><td>${i.cnt}</td><td>${(Number(i.avg_conf)*100).toFixed(0)}%</td></tr>`).join('')}
              </table>
            </div>
            <div class="card"><h4>Commands by Language</h4>
              <table><tr><th>Language</th><th>Count</th></tr>
              ${byLanguage.rows.map(l=>`<tr><td>${esc(l.language).toUpperCase()}</td><td>${l.cnt}</td></tr>`).join('')}
              </table>
            </div>
            <div class="card"><h4>Daily Usage (30 days)</h4>
              <table><tr><th>Date</th><th>Commands</th></tr>
              ${dailyUsage.rows.slice(0,15).map(d=>`<tr><td>${new Date(d.day).toLocaleDateString()}</td><td>${d.cnt}</td></tr>`).join('')}
              </table>
            </div>
            <div class="card"><h4>Feedback Sentiment</h4>
              <table><tr><th>Sentiment</th><th>Count</th><th>Avg Rating</th></tr>
              ${feedbackStats.rows.map(f=>`<tr><td>${esc(f.sentiment||'N/A')}</td><td>${f.cnt}</td><td>${Number(f.avg_rating).toFixed(1)}</td></tr>`).join('')}
              </table>
            </div>
          </div>
        </div>`;
      renderPage(req, res, 'Analytics', html, SKIP, '/school/voice-assistant');
    } catch(e) { ah(e, req, res); }
  });

  /* ════════════════════════════════════════════════
     ROUTE 10 — Accessibility Support
     ════════════════════════════════════════════════ */
  app.get('/school/voice-assistant/accessibility', requireAuth, requireNotBanned, (req, res) => {
    const html = `
      <div class="card"><h3 style="margin-top:0">Accessibility Settings</h3>
        <p style="color:${GRAY};margin-bottom:16px">Configure voice assistant accessibility features.</p>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="card"><h4>Speech Rate Control</h4><p>Adjust TTS speed for comprehension</p><input type="range" min="0.5" max="2" step="0.1" value="1" style="width:100%"><div style="display:flex;justify-content:space-between;font-size:0.8em;color:${GRAY}"><span>Slow</span><span>Normal</span><span>Fast</span></div></div>
          <div class="card"><h4>Volume Control</h4><p>Set preferred volume level</p><input type="range" min="0" max="100" value="80" style="width:100%"><div style="display:flex;justify-content:space-between;font-size:0.8em;color:${GRAY}"><span>Mute</span><span>100%</span></div></div>
          <div class="card"><h4>Auto-Repeat</h4><p>Automatically repeat responses for clarity</p><label><input type="checkbox"> Enable auto-repeat</label></div>
          <div class="card"><h4>Visual Feedback</h4><p>Show text alongside voice responses</p><label><input type="checkbox" checked> Enable visual feedback</label></div>
          <div class="card"><h4>High Contrast Mode</h4><p>Enhanced contrast for visibility</p><label><input type="checkbox"> Enable high contrast</label></div>
          <div class="card"><h4>Haptic Feedback</h4><p>Vibration for command confirmation</p><label><input type="checkbox"> Enable haptic feedback</label></div>
        </div>
      </div>`;
    renderPage(req, res, 'Accessibility', html, SKIP, '/school/voice-assistant');
  });
};
