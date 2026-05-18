// ============================================================
// AI-TUTOR MODULE — School SaaS Portal
// AI-powered tutoring sessions, doubt clearing, concept maps,
// practice problems, learning style adaptation, progress tracking.
// 12+ routes, MySQL-backed, tenant-aware.
// ============================================================
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ─── Helpers ──────────────────────────────────────────────
  const nav = (active) => `<div style="display:flex;gap:6px;margin-bottom:24px;flex-wrap:wrap;padding:4px 0">
    <a href="/school/ai-tutor" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='dash'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">🤖 Dashboard</a>
    <a href="/school/ai-tutor/session/new" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='new'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">💬 New Session</a>
    <a href="/school/ai-tutor/history" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='history'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📚 History</a>
    <a href="/school/ai-tutor/concepts" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='concepts'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">🧠 Concepts</a>
    <a href="/school/ai-tutor/progress" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='progress'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📈 Progress</a>
    <a href="/school/ai-tutor/practice" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='practice'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">✏️ Practice</a>
  </div>`;

  const statCard = (label, value, color, icon) => `<div style="background:#fff;border-radius:14px;padding:20px;text-align:center;border:1px solid #e5e7eb;position:relative;overflow:hidden"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:${color}"></div><div style="font-size:28px;font-weight:800;color:${color}">${value}</div><div style="font-size:12px;color:${GRAY};font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:4px">${icon} ${label}</div></div>`;

  const badge = (text, color) => `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${color}20;color:${color}">${text}</span>`;

  // ─── Database Migration ──────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS ai_tutor_sessions (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        student_id INT NOT NULL,
        subject VARCHAR(100),
        topic VARCHAR(255),
        messages JSONB DEFAULT NULL,
        duration_min INT DEFAULT 0,
        rating INT DEFAULT 0,
        learning_style VARCHAR(50) DEFAULT 'visual',
        status TEXT DEFAULT 'active',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ
      `);
      console.log('[AI-Tutor] ai_tutor_sessions OK');
    } catch(e) { console.warn('[AI-Tutor] Warn:', e.message); }

    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS ai_concepts (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        subject VARCHAR(100),
        topic VARCHAR(255) NOT NULL,
        prerequisite_ids JSONB DEFAULT NULL,
        difficulty TEXT DEFAULT 'beginner',
        explanation TEXT,
        tags JSONB DEFAULT NULL,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      `);
      console.log('[AI-Tutor] ai_concepts OK');
    } catch(e) { console.warn('[AI-Tutor] Warn:', e.message); }

    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS ai_tutor_progress (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        student_id INT NOT NULL,
        subject VARCHAR(100),
        concepts_mastered JSONB DEFAULT NULL,
        weak_areas JSONB DEFAULT NULL,
        total_sessions INT DEFAULT 0,
        avg_score DECIMAL(5,2) DEFAULT 0,
        learning_style VARCHAR(50) DEFAULT 'visual',
        study_streak INT DEFAULT 0,
        last_session_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_progress UNIQUE (tenant_id, student_id, subject)
      `);
      console.log('[AI-Tutor] ai_tutor_progress OK');
    } catch(e) { console.warn('[AI-Tutor] Warn:', e.message); }
  })();

  // ─── ROUTE 1: Dashboard ──────────────────────────────────
  app.get('/school/ai-tutor', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [totalSess] = await pool.query('SELECT COUNT(*) as c FROM ai_tutor_sessions WHERE tenant_id=? AND student_id=?', [tid, uid]);
    const [activeSess] = await pool.query('SELECT COUNT(*) as c FROM ai_tutor_sessions WHERE tenant_id=? AND student_id=? AND status="active"', [tid, uid]);
    const [concepts] = await pool.query('SELECT COUNT(*) as c FROM ai_concepts WHERE tenant_id=?', [tid, uid]);
    const [totalProg] = await pool.query('SELECT COALESCE(SUM(total_sessions),0) as c FROM ai_tutor_progress WHERE tenant_id=? AND student_id=?', [tid, uid]);
    const [recentSess] = await pool.query('SELECT * FROM ai_tutor_sessions WHERE tenant_id=? AND student_id=? ORDER BY created_at DESC LIMIT 5', [tid, uid]);
    const [subjects] = await pool.query('SELECT DISTINCT subject FROM ai_tutor_sessions WHERE tenant_id=? AND student_id=? AND subject IS NOT NULL', [tid, uid]);

    res.send(renderPage('AI Tutor', SKIP + `<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:${P};margin:0">🤖 AI Tutor Dashboard</h1>
          <p style="font-size:13px;color:${GRAY};margin-top:4px">Personalized AI-powered learning assistant</p>
        </div>
        <a href="/school/ai-tutor/session/new" class="btn" style="padding:10px 24px;font-size:14px;text-decoration:none">💬 Start New Session</a>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px">
        ${statCard('Total Sessions', totalSess[0].c, P, '📚')}
        ${statCard('Active Sessions', activeSess[0].c, '#059669', '🟢')}
        ${statCard('Concepts Available', concepts[0].c, '#7c3aed', '🧠')}
        ${statCard('Study Minutes', totalProg[0].c, '#d97706', '⏱')}
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:18px">
        <div class="card">
          <h3 style="color:${P};margin:0 0 14px">📚 Recent Sessions</h3>
          ${recentSess.length ? `<div style="display:grid;gap:10px">${recentSess.map(s => {
            const msgs = Array.isArray(s.messages) ? s.messages.length : 0;
            return `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:#f9fafb;border-radius:10px;border-left:4px solid ${s.status==='active'?'#059669':P}">
              <div>
                <strong style="color:#1f2937">${esc(s.topic||'General Session')}</strong>
                <div style="color:${GRAY};font-size:0.8em;margin-top:3px">${esc(s.subject||'General')} • ${msgs} messages • ${s.duration_min}min</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                ${s.rating ? `<span style="color:#f59e0b">${'★'.repeat(s.rating)}</span>` : ''}
                ${badge(s.status, s.status==='active'?'#059669':'#6b7280')}
                <a href="/school/ai-tutor/session/${s.id}" style="color:${P};text-decoration:none;font-size:13px">View →</a>
              </div>
            </div>`;
          }).join('')}</div>` : '<p style="color:'+GRAY+';text-align:center;padding:30px">No sessions yet. Start your first AI tutoring session!</p>'}
        </div>

        <div class="card">
          <h3 style="color:${P};margin:0 0 14px">📖 Subjects Explored</h3>
          ${subjects.length ? subjects.map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px;border-bottom:1px solid #f3f4f6">
            <span style="font-weight:600;color:#1f2937">${esc(s.subject)}</span>
            <a href="/school/ai-tutor/progress" style="color:${P};text-decoration:none;font-size:12px">Details →</a>
          </div>`).join('') : '<p style="color:'+GRAY+';text-align:center;padding:20px">Start a session to explore subjects</p>'}
          <div style="margin-top:16px;padding-top:14px;border-top:1px solid #e5e7eb">
            <h4 style="color:#1f2937;margin:0 0 10px">🎯 Quick Start</h4>
            ${['Mathematics','Science','English','Physics','Chemistry'].map(s => `<a href="/school/ai-tutor/session/new?subject=${encodeURIComponent(s)}" style="display:block;padding:8px 12px;margin:4px 0;background:#f3f4f6;border-radius:8px;text-decoration:none;color:#1f2937;font-size:13px;transition:.2s">${esc(s)}</a>`).join('')}
          </div>
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 2: New Session ────────────────────────────────
  app.get('/school/ai-tutor/session/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const preSubject = req.query.subject || '';
    const subjects = ['Mathematics','Science','English','Physics','Chemistry','Biology','History','Geography','Computer Science','Economics'];
    const styles = ['visual','auditory','reading','kinesthetic'];

    res.send(renderPage('New AI Session', SKIP + `<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('new')}
      <div class="card" style="padding:32px">
        <h2 style="color:${P};margin:0 0 4px">💬 Start New Tutoring Session</h2>
        <p style="color:${GRAY};font-size:13px;margin-bottom:24px">Choose a subject and topic, and your AI tutor will adapt to your learning style</p>

        <form method="POST" action="/school/ai-tutor/session/create" style="display:flex;flex-direction:column;gap:16px">
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Subject *</label>
            <select name="subject" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box">
              <option value="">Select a subject...</option>
              ${subjects.map(s => `<option value="${s}" ${preSubject===s?'selected':''}>${s}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Topic *</label>
            <input type="text" name="topic" required placeholder="e.g., Quadratic Equations, Photosynthesis, Newton's Laws" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box">
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Preferred Learning Style</label>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:6px">
              ${styles.map(s => `<label style="display:flex;align-items:center;gap:6px;padding:10px;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;font-size:13px">
                <input type="radio" name="learning_style" value="${s}" ${s==='visual'?'checked':''} style="width:auto">
                ${s==='visual'?'👁️':s==='auditory'?'🎧':s==='reading'?'📖':'✋'} ${esc(s.charAt(0).toUpperCase()+s.slice(1))}
              </label>`).join('')}
            </div>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Additional Instructions (optional)</label>
            <textarea name="instructions" rows="3" placeholder="Any specific areas you need help with..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box"></textarea>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn" style="padding:12px 28px;font-size:15px">🚀 Start Session</button>
            <a href="/school/ai-tutor" style="padding:12px 20px;color:${GRAY};text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 3: Create Session ─────────────────────────────
  app.post('/school/ai-tutor/session/create', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { subject, topic, learning_style, instructions } = req.body;

    const initialMessages = [
      { role: 'tutor', text: `Welcome! I'm your AI tutor for ${esc(subject)}. Today we'll explore "${esc(topic)}". Let me know what you'd like to understand better!`, time: new Date().toISOString() }
    ];

    const [result] = await pool.query(
      'INSERT INTO ai_tutor_sessions (tenant_id, student_id, subject, topic, messages, learning_style, status) VALUES (?, ?, ?, ?, ?, ?, "active")',
      [tid, uid, subject, topic, JSON.stringify(initialMessages), learning_style || 'visual']
    );

    audit({ action: 'ai_tutor_session_start', subject, topic, sessionId: result.insertId, user: req.session.user });
    res.redirect('/school/ai-tutor/session/' + result.insertId);
  }));

  // ─── ROUTE 4: View Session / Chat Interface ──────────────
  app.get('/school/ai-tutor/session/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [sess] = await pool.query('SELECT * FROM ai_tutor_sessions WHERE id=? AND tenant_id=? AND student_id=?', [req.params.id, tid, uid]);
    if (!sess[0]) return res.redirect('/school/ai-tutor');

    const s = sess[0];
    const messages = Array.isArray(s.messages) ? s.messages : [];

    // Simulate AI explanation generation for available concepts
    const [relatedConcepts] = await pool.query('SELECT * FROM ai_concepts WHERE tenant_id=? AND subject=? LIMIT 5', [tid, s.subject]);

    res.send(renderPage('AI Session', SKIP + `<div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <div>
          <a href="/school/ai-tutor" style="color:${P};text-decoration:none;font-size:13px">← Back to Dashboard</a>
          <h2 style="color:${P};margin:4px 0 0">💬 ${esc(s.topic)}</h2>
          <p style="color:${GRAY};font-size:12px">${esc(s.subject)} • ${s.learning_style} mode • Started ${new Date(s.created_at).toLocaleDateString()}</p>
        </div>
        <div style="display:flex;gap:8px">
          ${s.status==='active' ? `<button onclick="endSession()" class="btn" style="background:#dc2626">⏹ End Session</button>` : ''}
          <a href="/school/ai-tutor/session/${s.id}/explanation" class="btn" style="text-decoration:none">📝 Generate Explanation</a>
        </div>
      </div>

      <div class="card" style="padding:16px;max-height:450px;overflow-y:auto;margin-bottom:16px" id="chat-area">
        <div style="display:grid;gap:12px">
          ${messages.map(m => {
            const isTutor = m.role === 'tutor';
            return `<div style="display:flex;justify-content:${isTutor?'flex-start':'flex-end'}">
              <div style="max-width:75%;padding:12px 16px;border-radius:12px;${isTutor?'background:#f3f4f6;color:#1f2937;border-bottom-left-radius:4px':'background:'+P+';color:#fff;border-bottom-right-radius:4px'}">
                <div style="font-size:10px;opacity:0.7;margin-bottom:4px">${isTutor?'🤖 AI Tutor':'👤 You'}</div>
                <div style="font-size:14px;line-height:1.6">${esc(m.text)}</div>
                <div style="font-size:10px;opacity:0.6;margin-top:4px">${new Date(m.time).toLocaleTimeString()}</div>
              </div>
            </div>`;
          }).join('')}
        </div>
      </div>

      ${s.status === 'active' ? `<form method="POST" action="/school/ai-tutor/session/${s.id}/message" class="card" style="display:flex;gap:10px;align-items:end">
        <div style="flex:1">
          <textarea name="message" rows="2" placeholder="Ask a question, request an explanation, or ask for practice problems..." required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;resize:none"></textarea>
        </div>
        <button type="submit" class="btn" style="padding:12px 20px;white-space:nowrap;height:fit-content">📤 Send</button>
      </form>` : `<div class="card" style="text-align:center;padding:20px;background:#f0fdf4;border:1px solid #bbf7d0">
        <p style="color:#059669;font-weight:600;margin:0">Session completed • Duration: ${s.duration_min} min</p>
        ${s.rating ? `<p style="color:#059669;margin-top:4px">Your rating: ${'★'.repeat(s.rating)}</p>` : ''}
      </div>`}

      ${s.status !== 'active' ? `<div style="margin-top:16px" class="card">
        <h4 style="color:${P};margin:0 0 12px">⭐ Rate This Session</h4>
        <form method="POST" action="/school/ai-tutor/session/${s.id}/rate" style="display:flex;gap:6px">
          ${[1,2,3,4,5].map(n => `<button type="submit" name="rating" value="${n}" class="btn" style="background:${s.rating>=n?'#f59e0b':'#f3f4f6'};color:${s.rating>=n?'#fff':'#6b7280'};padding:8px 14px;font-size:18px">★</button>`).join('')}
          <input type="hidden" name="current" value="${s.rating||0}">
        </form>
      </div>` : ''}

      ${relatedConcepts.length ? `<div style="margin-top:16px" class="card">
        <h4 style="color:${P};margin:0 0 12px">🔗 Related Concepts</h4>
        ${relatedConcepts.map(c => `<div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #f3f4f6">
          <span style="color:#1f2937">${esc(c.topic)}</span>
          ${badge(c.difficulty, c.difficulty==='beginner'?'#059669':c.difficulty==='intermediate'?'#d97706':'#dc2626')}
        </div>`).join('')}
      </div>` : ''}

      <script>
        function endSession() {
          if (confirm('End this tutoring session?')) {
            fetch('/school/ai-tutor/session/${s.id}/end', { method: 'POST' }).then(r => r.json()).then(d => {
              if (d.ok) window.location.reload();
            });
          }
        }
        var chatArea = document.getElementById('chat-area');
        if (chatArea) chatArea.scrollTop = chatArea.scrollHeight;
      </script>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 5: Send Message ───────────────────────────────
  app.post('/school/ai-tutor/session/:id/message', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { message } = req.body;
    const sid = req.params.id;

    const [sess] = await pool.query('SELECT * FROM ai_tutor_sessions WHERE id=? AND tenant_id=? AND student_id=? AND status="active"', [sid, tid, uid]);
    if (!sess[0]) return res.redirect('/school/ai-tutor');

    const messages = Array.isArray(sess[0].messages) ? sess[0].messages : [];
    messages.push({ role: 'student', text: message, time: new Date().toISOString() });

    // Generate AI response (simulated)
    const topic = sess[0].topic || 'this topic';
    const responses = [
      `Great question! Let me explain ${topic} in a way that relates to your ${sess[0].learning_style||'visual'} learning style. The key concept here involves understanding the fundamental principles and how they apply in practice.`,
      `That's an excellent point about ${topic}. Let me break it down step by step. First, consider the basic framework, then build upon it with more complex applications.`,
      `I understand your question about ${topic}. Here's a clear explanation: the core idea connects to several related concepts. Let me walk you through each one systematically.`,
      `Let me provide a detailed explanation of ${topic} that will help you grasp this concept thoroughly. Think of it like building blocks — each piece supports the next.`,
      `That's a common question about ${topic}! The best way to understand this is through practical examples. Let me illustrate with a few scenarios you might encounter.`
    ];
    const aiResponse = responses[Math.floor(Math.random() * responses.length)];
    messages.push({ role: 'tutor', text: aiResponse, time: new Date().toISOString() });

    await pool.query('UPDATE ai_tutor_sessions SET messages=? WHERE id=? AND tenant_id=?', [JSON.stringify(messages), sid, tid]);
    res.redirect('/school/ai-tutor/session/' + sid);
  }));

  // ─── ROUTE 6: End Session ────────────────────────────────
  app.post('/school/ai-tutor/session/:id/end', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const sid = req.params.id;

    const [sess] = await pool.query('SELECT * FROM ai_tutor_sessions WHERE id=? AND tenant_id=? AND student_id=? AND status="active"', [sid, tid, uid]);
    if (!sess[0]) return res.json({ ok: false });

    const created = new Date(sess[0].created_at);
    const now = new Date();
    const duration = Math.round((now - created) / 60000);

    await pool.query('UPDATE ai_tutor_sessions SET status="completed", duration_min=?, completed_at=NOW() WHERE id=? AND tenant_id=?', [duration, sid, tid]);

    // Update progress
    await pool.query(`INSERT INTO ai_tutor_progress (tenant_id, student_id, subject, total_sessions, last_session_at)
      VALUES (?, ?, ?, 1, NOW())
      ON DUPLICATE KEY UPDATE total_sessions = total_sessions + 1, last_session_at = NOW()`,
      [tid, uid, sess[0].subject]);

    audit({ action: 'ai_tutor_session_end', sessionId: sid, duration, user: req.session.user });
    res.json({ ok: true });
  }));

  // ─── ROUTE 7: Rate Session ───────────────────────────────
  app.post('/school/ai-tutor/session/:id/rate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { rating } = req.body;
    await pool.query('UPDATE ai_tutor_sessions SET rating=? WHERE id=? AND tenant_id=? AND student_id=?', [parseInt(rating), req.params.id, tid, uid]);
    res.redirect('/school/ai-tutor/session/' + req.params.id);
  }));

  // ─── ROUTE 8: Generate Explanation ───────────────────────
  app.get('/school/ai-tutor/session/:id/explanation', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [sess] = await pool.query('SELECT * FROM ai_tutor_sessions WHERE id=? AND tenant_id=? AND student_id=?', [req.params.id, tid, uid]);
    if (!sess[0]) return res.redirect('/school/ai-tutor');

    const s = sess[0];
    const style = s.learning_style || 'visual';
    const explanations = {
      visual: `<h3 style="color:${P}">📊 Visual Explanation: ${esc(s.topic)}</h3>
        <div style="background:#f0f9ff;border-radius:12px;padding:20px;margin:12px 0">
          <p><strong>Diagram:</strong> Imagine a flowchart showing the relationship between concepts in ${esc(s.topic)}. Each node represents a key principle, connected by arrows showing cause-and-effect relationships.</p>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;margin:16px 0">
            <div style="background:#dbeafe;border-radius:8px;padding:12px;text-align:center"><strong>Input</strong><br><small>Core Variables</small></div>
            <div style="background:${P};border-radius:8px;padding:12px;text-align:center;color:#fff"><strong>Process</strong><br><small>Key Mechanism</small></div>
            <div style="background:#dcfce7;border-radius:8px;padding:12px;text-align:center"><strong>Output</strong><br><small>Result</small></div>
          </div>
          <p>As you can see from the diagram above, the input flows through the central process to produce the output. This visual representation makes it easier to understand the relationships.</p>
        </div>`,
      auditory: `<h3 style="color:${P}">🎧 Audio-Style Explanation: ${esc(s.topic)}</h3>
        <div style="background:#faf5ff;border-radius:12px;padding:20px;margin:12px 0">
          <p><strong>Read aloud for best results:</strong> "When we talk about ${esc(s.topic)}, think of it like a story. The main character — the central concept — goes through a journey of transformation."</p>
          <p style="margin-top:12px">"First, we introduce the variables — these are the setting of our story. Then, the key mechanism acts like the plot twist, changing everything. Finally, the result is our conclusion."</p>
          <p style="margin-top:12px">Try explaining this out loud to a friend — teaching is one of the best ways to learn!</p>
        </div>`,
      reading: `<h3 style="color:${P}">📖 Text-Based Explanation: ${esc(s.topic)}</h3>
        <div style="background:#f0fdf4;border-radius:12px;padding:20px;margin:12px 0">
          <h4>Definition</h4>
          <p>${esc(s.topic)} is a fundamental concept in ${esc(s.subject||'this field')} that describes the relationship between key variables and their outcomes.</p>
          <h4 style="margin-top:12px">Key Points</h4>
          <ol style="padding-left:20px;line-height:2">
            <li>The primary principle establishes the foundation of understanding</li>
            <li>Secondary principles build upon the foundation to create a complete picture</li>
            <li>Applications extend the theory into practical, real-world scenarios</li>
            <li>Common misconceptions can be avoided by understanding the core mechanics</li>
          </ol>
          <h4 style="margin-top:12px">Summary</h4>
          <p>By mastering these key points, you'll have a solid understanding of ${esc(s.topic)} that you can apply in exams and real-world situations.</p>
        </div>`,
      kinesthetic: `<h3 style="color:${P}">✋ Hands-On Explanation: ${esc(s.topic)}</h3>
        <div style="background:#fff7ed;border-radius:12px;padding:20px;margin:12px 0">
          <h4>Try This Activity</h4>
          <p>Let's learn ${esc(s.topic)} through a hands-on approach:</p>
          <ol style="padding-left:20px;line-height:2">
            <li><strong>Step 1 — Gather materials:</strong> Use everyday objects to represent the variables in ${esc(s.topic)}</li>
            <li><strong>Step 2 — Build a model:</strong> Arrange the objects to show the relationships between concepts</li>
            <li><strong>Step 3 — Manipulate:</strong> Change one variable and observe how the output changes</li>
            <li><strong>Step 4 — Record:</strong> Write down your observations and compare with the theoretical predictions</li>
          </ol>
          <p style="margin-top:12px">Physical engagement helps cement these abstract concepts in your memory!</p>
        </div>`
    };

    res.send(renderPage('AI Explanation', SKIP + `<div style="max-width:800px;margin:0 auto;padding:20px">
      <a href="/school/ai-tutor/session/${s.id}" style="color:${P};text-decoration:none;font-size:13px">← Back to Session</a>
      ${explanations[style] || explanations.visual}
      <div class="card" style="margin-top:16px">
        <h4 style="color:${P};margin:0 0 12px">🔑 Key Takeaways</h4>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          ${['Core principle identified','Variable relationships mapped','Practical applications covered','Common misconceptions addressed'].map(t =>
            `<div style="display:flex;align-items:center;gap:8px;padding:10px;background:#f9fafb;border-radius:8px"><span style="color:#059669;font-size:18px">✓</span><span style="color:#1f2937;font-size:13px">${t}</span></div>`
          ).join('')}
        </div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px">
        <a href="/school/ai-tutor/session/${s.id}" class="btn" style="text-decoration:none">← Back to Chat</a>
        <a href="/school/ai-tutor/practice?subject=${encodeURIComponent(s.subject||'')}" class="btn" style="background:#059669;text-decoration:none">✏️ Practice Problems</a>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 9: Session History ────────────────────────────
  app.get('/school/ai-tutor/history', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const subjectFilter = req.query.subject || '';
    const page = parseInt(req.query.page) || 1;
    const limit = 15;
    const offset = (page - 1) * limit;

    let whereClause = 'WHERE tenant_id=? AND student_id=?';
    const params = [tid, uid];
    if (subjectFilter) {
      whereClause += ' AND subject=?';
      params.push(subjectFilter);
    }

    const [total] = await pool.query(`SELECT COUNT(*) as c FROM ai_tutor_sessions ${whereClause}`, params);
    const [sessions] = await pool.query(`SELECT * FROM ai_tutor_sessions ${whereClause} ORDER BY created_at DESC LIMIT ${limit} OFFSET ${offset}`, params);
    const [subjects] = await pool.query('SELECT DISTINCT subject, COUNT(*) as cnt FROM ai_tutor_sessions WHERE tenant_id=? AND student_id=? AND subject IS NOT NULL GROUP BY subject ORDER BY cnt DESC', [tid, uid]);
    const totalPages = Math.ceil(total[0].c / limit);

    res.send(renderPage('Session History', SKIP + `<div style="max-width:1000px;margin:0 auto;padding:20px">
      ${nav('history')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h2 style="color:${P};margin:0">📚 Session History</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <select onchange="location.href='/school/ai-tutor/history?subject='+this.value" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;width:auto">
            <option value="">All Subjects</option>
            ${subjects.map(s => `<option value="${esc(s.subject)}" ${subjectFilter===s.subject?'selected':''}>${esc(s.subject)} (${s.cnt})</option>`).join('')}
          </select>
          <a href="/school/ai-tutor/session/new" class="btn" style="text-decoration:none;padding:8px 16px">+ New Session</a>
        </div>
      </div>

      <div class="card" style="overflow-x:auto">
        <table>
          <thead><tr>
            <th>Topic</th><th>Subject</th><th>Messages</th><th>Duration</th><th>Rating</th><th>Status</th><th>Date</th><th>Actions</th>
          </tr></thead>
          <tbody>
            ${sessions.length ? sessions.map(s => {
              const msgCount = Array.isArray(s.messages) ? s.messages.length : 0;
              return `<tr>
                <td><a href="/school/ai-tutor/session/${s.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(s.topic||'General')}</a></td>
                <td>${esc(s.subject||'—')}</td>
                <td>${msgCount}</td>
                <td>${s.duration_min}min</td>
                <td style="color:#f59e0b">${s.rating ? '★'.repeat(s.rating) : '—'}</td>
                <td>${badge(s.status, s.status==='completed'?'#059669':s.status==='active'?'#d97706':'#6b7280')}</td>
                <td style="color:${GRAY};font-size:12px">${new Date(s.created_at).toLocaleDateString()}</td>
                <td><a href="/school/ai-tutor/session/${s.id}" style="color:${P};text-decoration:none;font-size:12px">View</a></td>
              </tr>`;
            }).join('') : `<tr><td colspan="8" style="text-align:center;color:${GRAY};padding:30px">No sessions found</td></tr>`}
          </tbody>
        </table>
      </div>

      ${totalPages > 1 ? `<div style="display:flex;justify-content:center;gap:6px;margin-top:16px">
        ${Array.from({length:totalPages},(_, i) => `<a href="/school/ai-tutor/history?page=${i+1}${subjectFilter?'&subject='+encodeURIComponent(subjectFilter):''}" class="btn" style="text-decoration:none;padding:6px 12px;${page===i+1?'background:'+P:'background:#f3f4f6;color:#1f2937'}">${i+1}</a>`).join('')}
      </div>` : ''}
    </div>`, req.session.user));
  }));

  // ─── ROUTE 10: Concept Library ───────────────────────────
  app.get('/school/ai-tutor/concepts', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const subjectFilter = req.query.subject || '';
    const difficultyFilter = req.query.difficulty || '';

    let whereClause = 'WHERE tenant_id=?';
    const params = [tid];
    if (subjectFilter) { whereClause += ' AND subject=?'; params.push(subjectFilter); }
    if (difficultyFilter) { whereClause += ' AND difficulty=?'; params.push(difficultyFilter); }

    const [concepts] = await pool.query(`SELECT * FROM ai_concepts ${whereClause} ORDER BY subject, topic`, params);
    const [subjects] = await pool.query('SELECT DISTINCT subject FROM ai_concepts WHERE tenant_id=? ORDER BY subject', [tid]);

    res.send(renderPage('Concept Library', SKIP + `<div style="max-width:1100px;margin:0 auto;padding:20px">
      ${nav('concepts')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h2 style="color:${P};margin:0">🧠 Concept Library</h2>
        <div style="display:flex;gap:8px">
          <select onchange="location.href='/school/ai-tutor/concepts?subject='+this.value+'&difficulty=${difficultyFilter}'" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;width:auto">
            <option value="">All Subjects</option>
            ${subjects.map(s => `<option value="${esc(s.subject)}" ${subjectFilter===s.subject?'selected':''}>${esc(s.subject)}</option>`).join('')}
          </select>
          <select onchange="location.href='/school/ai-tutor/concepts?difficulty='+this.value+'&subject=${subjectFilter}'" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;width:auto">
            <option value="">All Levels</option>
            <option value="beginner" ${difficultyFilter==='beginner'?'selected':''}>Beginner</option>
            <option value="intermediate" ${difficultyFilter==='intermediate'?'selected':''}>Intermediate</option>
            <option value="advanced" ${difficultyFilter==='advanced'?'selected':''}>Advanced</option>
          </select>
          <a href="/school/ai-tutor/concepts/new" class="btn" style="text-decoration:none;padding:8px 16px">+ Add Concept</a>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">
        ${concepts.length ? concepts.map(c => {
          const prereqs = Array.isArray(c.prerequisite_ids) ? c.prerequisite_ids : [];
          const tags = Array.isArray(c.tags) ? c.tags : [];
          return `<div class="card" style="border-top:4px solid ${c.difficulty==='beginner'?'#059669':c.difficulty==='intermediate'?'#d97706':'#dc2626'}">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
              <h3 style="color:#1f2937;margin:0;font-size:15px">${esc(c.topic)}</h3>
              ${badge(c.difficulty, c.difficulty==='beginner'?'#059669':c.difficulty==='intermediate'?'#d97706':'#dc2626')}
            </div>
            <div style="color:${GRAY};font-size:12px;margin-bottom:10px">${esc(c.subject)}</div>
            <p style="color:#374151;font-size:13px;line-height:1.6;margin-bottom:10px">${esc((c.explanation||'').substring(0, 120))}${(c.explanation||'').length > 120 ? '...' : ''}</p>
            ${tags.length ? `<div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px">${tags.map(t => `<span style="background:#f3f4f6;color:#6b7280;padding:2px 8px;border-radius:12px;font-size:10px">${esc(t)}</span>`).join('')}</div>` : ''}
            ${prereqs.length ? `<div style="color:${GRAY};font-size:11px;margin-top:6px">📚 ${prereqs.length} prerequisite(s)</div>` : ''}
            <div style="margin-top:12px;display:flex;gap:8px">
              <a href="/school/ai-tutor/concepts/${c.id}" style="color:${P};text-decoration:none;font-size:12px">View Details</a>
              <a href="/school/ai-tutor/concepts/${c.id}/edit" style="color:${GRAY};text-decoration:none;font-size:12px">Edit</a>
              <form method="POST" action="/school/ai-tutor/concepts/${c.id}/delete" style="display:inline" onsubmit="return confirm('Delete this concept?')"><button style="color:#dc2626;background:none;border:none;cursor:pointer;font-size:12px">Delete</button></form>
            </div>
          </div>`;
        }).join('') : '<div style="text-align:center;color:'+GRAY+';padding:40px;grid-column:1/-1">No concepts found. Add your first concept!</div>'}
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 11: Add Concept ───────────────────────────────
  app.get('/school/ai-tutor/concepts/new', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [existing] = await pool.query('SELECT id, topic FROM ai_concepts WHERE tenant_id=? ORDER BY subject, topic', [tid]);
    const subjects = ['Mathematics','Science','English','Physics','Chemistry','Biology','History','Geography','Computer Science','Economics'];

    res.send(renderPage('Add Concept', SKIP + `<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('concepts')}
      <div class="card" style="padding:32px">
        <h2 style="color:${P};margin:0 0 20px">🧠 Add New Concept</h2>
        <form method="POST" action="/school/ai-tutor/concepts/save" style="display:flex;flex-direction:column;gap:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div>
              <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Subject *</label>
              <select name="subject" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
                ${subjects.map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Difficulty *</label>
              <select name="difficulty" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
                <option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option>
              </select>
            </div>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Topic *</label>
            <input type="text" name="topic" required placeholder="e.g., Quadratic Formula" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Explanation</label>
            <textarea name="explanation" rows="5" placeholder="Detailed explanation of this concept..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></textarea>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Prerequisites</label>
            <select name="prerequisite_ids" multiple style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;min-height:80px">
              ${existing.map(c => `<option value="${c.id}">${esc(c.topic)}</option>`).join('')}
            </select>
            <small style="color:${GRAY}">Hold Ctrl/Cmd to select multiple</small>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Tags (comma-separated)</label>
            <input type="text" name="tags" placeholder="e.g., algebra, equations, graphing" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
          </div>
          <button type="submit" class="btn" style="padding:12px 28px;font-size:15px">💾 Save Concept</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 12: Save Concept ──────────────────────────────
  app.post('/school/ai-tutor/concepts/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { id, subject, topic, difficulty, explanation, prerequisite_ids, tags } = req.body;

    const prereqs = Array.isArray(prerequisite_ids) ? prerequisite_ids : (prerequisite_ids ? [prerequisite_ids] : []);
    const tagArr = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

    if (id) {
      await pool.query('UPDATE ai_concepts SET subject=?, topic=?, difficulty=?, explanation=?, prerequisite_ids=?, tags=? WHERE id=? AND tenant_id=?',
        [subject, topic, difficulty, explanation, JSON.stringify(prereqs.map(Number)), JSON.stringify(tagArr), id, tid]);
      audit({ action: 'update_concept', conceptId: id, user: req.session.user });
    } else {
      await pool.query('INSERT INTO ai_concepts (tenant_id, subject, topic, difficulty, explanation, prerequisite_ids, tags) VALUES (?,?,?,?,?,?,?)',
        [tid, subject, topic, difficulty, explanation, JSON.stringify(prereqs.map(Number)), JSON.stringify(tagArr)]);
      audit({ action: 'create_concept', topic, subject, user: req.session.user });
    }
    res.redirect('/school/ai-tutor/concepts');
  }));

  // ─── ROUTE 13: View Concept Detail ───────────────────────
  app.get('/school/ai-tutor/concepts/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [concept] = await pool.query('SELECT * FROM ai_concepts WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!concept[0]) return res.redirect('/school/ai-tutor/concepts');

    const c = concept[0];
    const prereqs = Array.isArray(c.prerequisite_ids) ? c.prerequisite_ids : [];
    const tags = Array.isArray(c.tags) ? c.tags : [];

    let prereqNames = [];
    if (prereqs.length) {
      const [pr] = await pool.query('SELECT id, topic FROM ai_concepts WHERE id IN (?) AND tenant_id=?', [prereqs, tid]);
      prereqNames = pr;
    }

    res.send(renderPage('Concept Detail', SKIP + `<div style="max-width:800px;margin:0 auto;padding:20px">
      <a href="/school/ai-tutor/concepts" style="color:${P};text-decoration:none;font-size:13px">← Back to Concepts</a>
      <div class="card" style="margin-top:12px;border-top:4px solid ${c.difficulty==='beginner'?'#059669':c.difficulty==='intermediate'?'#d97706':'#dc2626'}">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <h2 style="color:${P};margin:0">${esc(c.topic)}</h2>
          ${badge(c.difficulty, c.difficulty==='beginner'?'#059669':c.difficulty==='intermediate'?'#d97706':'#dc2626')}
        </div>
        <div style="color:${GRAY};font-size:13px;margin:8px 0 16px">${esc(c.subject)} • Added ${new Date(c.created_at).toLocaleDateString()}</div>
        ${c.explanation ? `<div style="line-height:1.8;color:#374151;font-size:14px;white-space:pre-wrap">${esc(c.explanation)}</div>` : '<p style="color:'+GRAY+'">No explanation provided.</p>'}
      </div>

      ${prereqNames.length ? `<div class="card" style="margin-top:12px">
        <h4 style="color:${P};margin:0 0 10px">📚 Prerequisites</h4>
        ${prereqNames.map(p => `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6"><a href="/school/ai-tutor/concepts/${p.id}" style="color:${P};text-decoration:none">${esc(p.topic)}</a></div>`).join('')}
      </div>` : ''}

      ${tags.length ? `<div class="card" style="margin-top:12px">
        <h4 style="color:${P};margin:0 0 10px">🏷️ Tags</h4>
        <div style="display:flex;gap:6px;flex-wrap:wrap">${tags.map(t => `<span style="background:#eef2ff;color:${P};padding:4px 12px;border-radius:16px;font-size:12px;font-weight:600">${esc(t)}</span>`).join('')}</div>
      </div>` : ''}

      <div style="margin-top:16px;display:flex;gap:10px">
        <a href="/school/ai-tutor/concepts/${c.id}/edit" class="btn" style="text-decoration:none">✏️ Edit</a>
        <a href="/school/ai-tutor/session/new?subject=${encodeURIComponent(c.subject||'')}&topic=${encodeURIComponent(c.topic||'')}" class="btn" style="background:#059669;text-decoration:none">💬 Start Tutoring on This Topic</a>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 14: Edit Concept ──────────────────────────────
  app.get('/school/ai-tutor/concepts/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [concept] = await pool.query('SELECT * FROM ai_concepts WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!concept[0]) return res.redirect('/school/ai-tutor/concepts');

    const c = concept[0];
    const [existing] = await pool.query('SELECT id, topic FROM ai_concepts WHERE tenant_id=? AND id!=? ORDER BY topic', [tid, c.id]);
    const subjects = ['Mathematics','Science','English','Physics','Chemistry','Biology','History','Geography','Computer Science','Economics'];
    const prereqs = Array.isArray(c.prerequisite_ids) ? c.prerequisite_ids : [];
    const tags = Array.isArray(c.tags) ? c.tags.join(', ') : '';

    res.send(renderPage('Edit Concept', SKIP + `<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('concepts')}
      <div class="card" style="padding:32px">
        <h2 style="color:${P};margin:0 0 20px">✏️ Edit Concept</h2>
        <form method="POST" action="/school/ai-tutor/concepts/save" style="display:flex;flex-direction:column;gap:16px">
          <input type="hidden" name="id" value="${c.id}">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div>
              <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Subject</label>
              <select name="subject" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
                ${subjects.map(s => `<option value="${s}" ${s===c.subject?'selected':''}>${s}</option>`).join('')}
              </select>
            </div>
            <div>
              <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Difficulty</label>
              <select name="difficulty" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
                ${['beginner','intermediate','advanced'].map(d => `<option value="${d}" ${d===c.difficulty?'selected':''}>${d}</option>`).join('')}
              </select>
            </div>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Topic</label>
            <input type="text" name="topic" value="${esc(c.topic)}" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Explanation</label>
            <textarea name="explanation" rows="5" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">${esc(c.explanation||'')}</textarea>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Prerequisites</label>
            <select name="prerequisite_ids" multiple style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;min-height:80px">
              ${existing.map(e => `<option value="${e.id}" ${prereqs.includes(e.id)?'selected':''}>${esc(e.topic)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Tags</label>
            <input type="text" name="tags" value="${esc(tags)}" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
          </div>
          <button type="submit" class="btn" style="padding:12px 28px">💾 Save Changes</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 15: Delete Concept ────────────────────────────
  app.post('/school/ai-tutor/concepts/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM ai_concepts WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    audit({ action: 'delete_concept', conceptId: req.params.id, user: req.session.user });
    res.redirect('/school/ai-tutor/concepts');
  }));

  // ─── ROUTE 16: Progress Tracking ─────────────────────────
  app.get('/school/ai-tutor/progress', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [progress] = await pool.query('SELECT * FROM ai_tutor_progress WHERE tenant_id=? AND student_id=? ORDER BY total_sessions DESC', [tid, uid]);
    const [totalSessions] = await pool.query('SELECT COUNT(*) as c FROM ai_tutor_sessions WHERE tenant_id=? AND student_id=? AND status="completed"', [tid, uid]);
    const [totalMinutes] = await pool.query('SELECT COALESCE(SUM(duration_min),0) as c FROM ai_tutor_sessions WHERE tenant_id=? AND student_id=?', [tid, uid]);
    const [avgRating] = await pool.query('SELECT COALESCE(AVG(rating),0) as c FROM ai_tutor_sessions WHERE tenant_id=? AND student_id=? AND rating>0', [tid, uid]);

    res.send(renderPage('Learning Progress', SKIP + `<div style="max-width:1000px;margin:0 auto;padding:20px">
      ${nav('progress')}
      <h2 style="color:${P};margin:0 0 20px">📈 Learning Progress</h2>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px;margin-bottom:24px">
        ${statCard('Completed Sessions', totalSessions[0].c, P, '📚')}
        ${statCard('Study Minutes', totalMinutes[0].c, '#059669', '⏱')}
        ${statCard('Avg Rating', (avgRating[0].c || 0).toFixed(1), '#f59e0b', '⭐')}
        ${statCard('Subjects Studied', progress.length, '#7c3aed', '📖')}
      </div>

      ${progress.length ? `<div class="card">
        <h3 style="color:${P};margin:0 0 14px">📊 Subject-wise Progress</h3>
        <table>
          <thead><tr><th>Subject</th><th>Sessions</th><th>Avg Score</th><th>Learning Style</th><th>Concepts Mastered</th><th>Weak Areas</th><th>Last Session</th></tr></thead>
          <tbody>
            ${progress.map(p => {
              const mastered = Array.isArray(p.concepts_mastered) ? p.concepts_mastered.length : 0;
              const weak = Array.isArray(p.weak_areas) ? p.weak_areas.length : 0;
              return `<tr>
                <td><strong style="color:${P}">${esc(p.subject||'General')}</strong></td>
                <td>${p.total_sessions}</td>
                <td>${p.avg_score > 0 ? p.avg_score.toFixed(1) + '%' : '—'}</td>
                <td>${badge(p.learning_style||'visual', P)}</td>
                <td><span style="color:#059669;font-weight:600">${mastered}</span></td>
                <td>${weak > 0 ? `<span style="color:#dc2626;font-weight:600">${weak} area(s)</span>` : '<span style="color:#059669">None</span>'}</td>
                <td style="color:${GRAY};font-size:12px">${p.last_session_at ? new Date(p.last_session_at).toLocaleDateString() : '—'}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>` : '<div class="card" style="text-align:center;padding:40px;color:'+GRAY+'">No progress data yet. Start a tutoring session to begin tracking!</div>'}

      <div style="margin-top:20px" class="card">
        <h3 style="color:${P};margin:0 0 14px">💡 Learning Tips</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px">
          ${[
            {icon:'🎯', title:'Set Daily Goals', desc:'Aim for at least one tutoring session per day to build consistency.'},
            {icon:'🔄', title:'Review Weak Areas', desc:'Focus extra time on subjects where your score is below average.'},
            {icon:'📝', title:'Take Notes', desc:'Jot down key points during sessions for better retention.'},
            {icon:'⏰', title:'Space Your Learning', desc:'Shorter, frequent sessions are more effective than long cram sessions.'}
          ].map(t => `<div style="padding:14px;background:#f9fafb;border-radius:10px;border-left:4px solid ${P}">
            <div style="font-size:20px;margin-bottom:6px">${t.icon}</div>
            <strong style="color:#1f2937">${t.title}</strong>
            <p style="color:${GRAY};font-size:13px;margin:4px 0 0">${t.desc}</p>
          </div>`).join('')}
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 17: Practice Problems ─────────────────────────
  app.get('/school/ai-tutor/practice', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const preSubject = req.query.subject || '';
    const subjects = ['Mathematics','Science','English','Physics','Chemistry','Biology','Computer Science'];

    // Generate practice problems based on subject
    const practiceProblems = {
      Mathematics: [
        {q:'Solve: 3x + 7 = 22', options:['x=3','x=4','x=5','x=6'], answer:2},
        {q:'What is the area of a circle with radius 7?', options:['154','44','49','154π'], answer:3},
        {q:'Simplify: (x² + 2x + 1) / (x + 1)', options:['x','x+1','x-1','x²'], answer:1},
        {q:'If f(x) = 2x² - 3x + 1, find f(3)', options:['10','12','8','14'], answer:0},
        {q:'What is the sum of angles in a pentagon?', options:['360°','540°','720°','180°'], answer:1}
      ],
      Science: [
        {q:'What is the chemical formula for water?', options:['H2O','CO2','NaCl','O2'], answer:0},
        {q:'What organelle is the powerhouse of the cell?', options:['Nucleus','Ribosome','Mitochondria','Golgi body'], answer:2},
        {q:'What is Newton\'s first law about?', options:['Inertia','Acceleration','Gravity','Energy'], answer:0},
        {q:'What gas do plants absorb during photosynthesis?', options:['Oxygen','Nitrogen','Carbon dioxide','Hydrogen'], answer:2},
        {q:'What is the SI unit of force?', options:['Joule','Watt','Newton','Pascal'], answer:2}
      ]
    };

    const problems = practiceProblems[preSubject] || practiceProblems.Mathematics;

    res.send(renderPage('Practice Problems', SKIP + `<div style="max-width:800px;margin:0 auto;padding:20px">
      ${nav('practice')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="color:${P};margin:0">✏️ Practice Problems</h2>
          <p style="color:${GRAY};font-size:13px;margin-top:4px">Test your understanding with AI-generated practice questions</p>
        </div>
        <select onchange="location.href='/school/ai-tutor/practice?subject='+this.value" style="padding:8px 14px;border:1px solid #d1d5db;border-radius:8px;width:auto">
          <option value="">Select Subject</option>
          ${subjects.map(s => `<option value="${s}" ${preSubject===s?'selected':''}>${s}</option>`).join('')}
        </select>
      </div>

      <form method="POST" action="/school/ai-tutor/practice/submit" id="practice-form">
        <input type="hidden" name="subject" value="${esc(preSubject)}">
        ${problems.map((p, i) => `<div class="card" style="border-left:4px solid ${P}">
          <h4 style="color:#1f2937;margin:0 0 12px">Q${i+1}. ${esc(p.q)}</h4>
          <div style="display:grid;gap:6px">
            ${p.options.map((opt, j) => `<label style="display:flex;align-items:center;gap:8px;padding:10px 14px;border:1px solid #e5e7eb;border-radius:8px;cursor:pointer;transition:.2s">
              <input type="radio" name="q_${i}" value="${j}" required style="width:auto">
              <span style="font-size:14px;color:#374151">${esc(opt)}</span>
            </label>`).join('')}
          </div>
        </div>`).join('')}
        <button type="submit" class="btn" style="padding:12px 28px;font-size:15px;margin-top:16px">📋 Submit Answers</button>
      </form>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 18: Submit Practice ───────────────────────────
  app.post('/school/ai-tutor/practice/submit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const subject = req.body.subject || 'Mathematics';
    const correctAnswers = { Mathematics: [2,3,1,0,1], Science: [0,2,0,2,2] };
    const answers = correctAnswers[subject] || [2,3,1,0,1];

    let correct = 0;
    const results = answers.map((a, i) => {
      const userAnswer = parseInt(req.body['q_' + i]);
      const isCorrect = userAnswer === a;
      if (isCorrect) correct++;
      return { index: i, userAnswer, correctAnswer: a, isCorrect };
    });

    const score = Math.round((correct / answers.length) * 100);

    // Update progress
    if (subject) {
      await pool.query(`INSERT INTO ai_tutor_progress (tenant_id, student_id, subject, avg_score, total_sessions, last_session_at)
        VALUES (?, ?, ?, ?, 0, NOW())
        ON DUPLICATE KEY UPDATE avg_score = (avg_score * total_sessions + ?) / (total_sessions + 1)`,
        [tid, uid, subject, score, score]);
    }

    res.send(renderPage('Practice Results', SKIP + `<div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="text-align:center;padding:30px;border-radius:16px;background:${score>=60?'#f0fdf4':'#fef2f2'};border:1px solid ${score>=60?'#bbf7d0':'#fecaca'};margin-bottom:20px">
        <div style="font-size:48px;margin-bottom:10px">${score >= 80 ? '🎉' : score >= 60 ? '👍' : score >= 40 ? '💪' : '📚'}</div>
        <h2 style="color:${P};margin:0 0 4px">Score: ${score}%</h2>
        <p style="color:${GRAY}">${correct}/${answers.length} correct in ${esc(subject)}</p>
      </div>

      <div style="display:grid;gap:10px;margin-bottom:20px">
        ${results.map(r => `<div style="padding:14px;border-radius:10px;background:${r.isCorrect?'#f0fdf4':'#fef2f2'};border-left:4px solid ${r.isCorrect?'#059669':'#dc2626'}">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <strong style="color:#1f2937">Question ${r.index + 1}</strong>
            <span style="font-size:18px">${r.isCorrect ? '✅' : '❌'}</span>
          </div>
          ${!r.isCorrect ? `<p style="color:${GRAY};font-size:13px;margin:6px 0 0">Your answer: Option ${r.userAnswer + 1} • Correct: Option ${r.correctAnswer + 1}</p>` : ''}
        </div>`).join('')}
      </div>

      <div style="display:flex;gap:10px">
        <a href="/school/ai-tutor/practice?subject=${encodeURIComponent(subject)}" class="btn" style="text-decoration:none">🔄 Try Again</a>
        <a href="/school/ai-tutor/session/new?subject=${encodeURIComponent(subject)}" class="btn" style="background:#059669;text-decoration:none">💬 Get Tutoring Help</a>
        <a href="/school/ai-tutor" class="btn" style="background:#6b7280;text-decoration:none">← Dashboard</a>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 19: Concept Map View ──────────────────────────
  app.get('/school/ai-tutor/concept-map', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const subjectFilter = req.query.subject || '';
    const [subjects] = await pool.query('SELECT DISTINCT subject FROM ai_concepts WHERE tenant_id=? ORDER BY subject', [tid]);

    let whereClause = 'WHERE tenant_id=?';
    const params = [tid];
    if (subjectFilter) { whereClause += ' AND subject=?'; params.push(subjectFilter); }

    const [concepts] = await pool.query(`SELECT * FROM ai_concepts ${whereClause} ORDER BY topic`, params);

    // Build concept map visualization
    const colors = ['#4f46e5','#059669','#d97706','#dc2626','#7c3aed','#0891b2'];
    const nodes = concepts.map((c, i) => {
      const prereqs = Array.isArray(c.prerequisite_ids) ? c.prerequisite_ids : [];
      return { id: c.id, topic: c.topic, subject: c.subject, difficulty: c.difficulty, prereqs, color: colors[i % colors.length], x: 50 + (i % 4) * 120, y: 50 + Math.floor(i / 4) * 100 };
    });

    res.send(renderPage('Concept Map', SKIP + `<div style="max-width:1200px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="color:${P};margin:0">🗺️ Concept Map</h2>
          <p style="color:${GRAY};font-size:13px;margin-top:4px">Visualize relationships between concepts</p>
        </div>
        <select onchange="location.href='/school/ai-tutor/concept-map?subject='+this.value" style="padding:8px 14px;border:1px solid #d1d5db;border-radius:8px;width:auto">
          <option value="">All Subjects</option>
          ${subjects.map(s => `<option value="${esc(s.subject)}" ${subjectFilter===s.subject?'selected':''}>${esc(s.subject)}</option>`).join('')}
        </select>
      </div>

      <div class="card" style="min-height:400px;position:relative;overflow:hidden">
        ${concepts.length ? `<svg width="100%" height="400" style="position:absolute;top:0;left:0">
          ${nodes.map(n => n.prereqs.map(pid => {
            const target = nodes.find(t => t.id === pid);
            if (!target) return '';
            return `<line x1="${n.x}" y1="${n.y}" x2="${target.x}" y2="${target.y}" stroke="#d1d5db" stroke-width="2" stroke-dasharray="5,5"/>`;
          }).join('')).join('')}
          ${nodes.map(n => `<circle cx="${n.x}" cy="${n.y}" r="35" fill="${n.color}" opacity="0.9"/><text x="${n.x}" y="${n.y}" text-anchor="middle" dominant-baseline="middle" fill="white" font-size="10" font-weight="bold">${esc(n.topic.substring(0, 10))}</text>`).join('')}
        </svg>` : '<div style="display:flex;align-items:center;justify-content:center;height:400px;color:'+GRAY+'">No concepts to map. Add concepts from the Concept Library first.</div>'}
      </div>

      <div class="card" style="margin-top:12px">
        <h4 style="color:${P};margin:0 0 12px">Concept Legend</h4>
        <div style="display:flex;gap:12px;flex-wrap:wrap">
          ${concepts.map((c, i) => `<div style="display:flex;align-items:center;gap:6px">
            <div style="width:16px;height:16px;border-radius:50%;background:${colors[i % colors.length]}"></div>
            <span style="font-size:13px;color:#1f2937">${esc(c.topic)}</span>
            ${badge(c.difficulty, c.difficulty==='beginner'?'#059669':c.difficulty==='intermediate'?'#d97706':'#dc2626')}
          </div>`).join('')}
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 20: Delete Session ────────────────────────────
  app.post('/school/ai-tutor/session/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    await pool.query('DELETE FROM ai_tutor_sessions WHERE id=? AND tenant_id=? AND student_id=?', [req.params.id, tid, uid]);
    audit({ action: 'delete_ai_session', sessionId: req.params.id, user: req.session.user });
    res.redirect('/school/ai-tutor/history');
  }));

};
