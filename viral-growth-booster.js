// ============================================================
// === VIRAL GROWTH BOOSTER — Go Viral, Stay Viral ===
// ============================================================
// Polls, quizzes, testimonials wall, community forums, live chat widget,
// viral countdown timers, share contests, user stories, waitlists,
// feedback widgets, notification badges, trending hashtags

const VG_MIGRATIONS = [
  // Polls & Voting System
  `CREATE TABLE IF NOT EXISTS polls (
    id SERIAL PRIMARY KEY, question TEXT NOT NULL, description TEXT,
    category TEXT DEFAULT 'general', options JSONB NOT NULL DEFAULT '[]',
    votes JSONB DEFAULT '{}', total_votes INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true, is_featured BOOLEAN DEFAULT false,
    created_by TEXT, ends_at TIMESTAMPTZ,
    tenant_id INTEGER DEFAULT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS poll_votes (
    id SERIAL PRIMARY KEY, poll_id INTEGER REFERENCES polls(id) ON DELETE CASCADE,
    user_email TEXT, option_index INTEGER, ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(poll_id, ip_address)
  )`,
  // Quizzes
  `CREATE TABLE IF NOT EXISTS quizzes (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT,
    category TEXT DEFAULT 'general', questions JSONB NOT NULL DEFAULT '[]',
    is_active BOOLEAN DEFAULT true, plays INTEGER DEFAULT 0,
    avg_score NUMERIC DEFAULT 0, is_featured BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS quiz_results (
    id SERIAL PRIMARY KEY, quiz_id INTEGER REFERENCES quizzes(id) ON DELETE CASCADE,
    user_email TEXT, user_name TEXT, score INTEGER, total INTEGER,
    ip_address TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Testimonials Wall
  `CREATE TABLE IF NOT EXISTS testimonials (
    id SERIAL PRIMARY KEY, user_name TEXT NOT NULL, user_title TEXT,
    organization TEXT, avatar_url TEXT, rating INTEGER DEFAULT 5,
    testimonial_text TEXT NOT NULL, category TEXT DEFAULT 'general',
    is_approved BOOLEAN DEFAULT false, is_featured BOOLEAN DEFAULT false,
    video_url TEXT, country TEXT DEFAULT 'Uganda',
    likes INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Community Forums
  `CREATE TABLE IF NOT EXISTS forum_topics (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, body TEXT NOT NULL,
    category TEXT DEFAULT 'general', author_name TEXT, author_email TEXT,
    views INTEGER DEFAULT 0, replies_count INTEGER DEFAULT 0,
    is_pinned BOOLEAN DEFAULT false, is_locked BOOLEAN DEFAULT false,
    is_approved BOOLEAN DEFAULT true, tags TEXT[] DEFAULT '{}',
    last_reply_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS forum_replies (
    id SERIAL PRIMARY KEY, topic_id INTEGER REFERENCES forum_topics(id) ON DELETE CASCADE,
    body TEXT NOT NULL, author_name TEXT, author_email TEXT,
    likes INTEGER DEFAULT 0, is_approved BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Viral Countdown / Waitlist
  `CREATE TABLE IF NOT EXISTS viral_countdowns (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT,
    target_date TIMESTAMPTZ NOT NULL, cta_text TEXT DEFAULT 'Join Waitlist',
    cta_link TEXT DEFAULT '/register', signup_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS waitlist_signups (
    id SERIAL PRIMARY KEY, countdown_id INTEGER REFERENCES viral_countdowns(id) ON DELETE CASCADE,
    email TEXT NOT NULL, name TEXT, position INTEGER,
    referral_code TEXT, referred_by TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(countdown_id, email)
  )`,
  // Share Contests
  `CREATE TABLE IF NOT EXISTS share_contests (
    id SERIAL PRIMARY KEY, title TEXT NOT NULL, description TEXT,
    prize TEXT, rules TEXT, start_date TIMESTAMPTZ, end_date TIMESTAMPTZ,
    share_goal INTEGER DEFAULT 10, is_active BOOLEAN DEFAULT true,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS contest_entries (
    id SERIAL PRIMARY KEY, contest_id INTEGER REFERENCES share_contests(id) ON DELETE CASCADE,
    user_email TEXT, user_name TEXT, shares INTEGER DEFAULT 0,
    is_winner BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // User Stories / Success Stories
  `CREATE TABLE IF NOT EXISTS user_stories (
    id SERIAL PRIMARY KEY, user_name TEXT, user_email TEXT,
    title TEXT NOT NULL, story TEXT NOT NULL, image_url TEXT,
    category TEXT DEFAULT 'general', is_published BOOLEAN DEFAULT false,
    likes INTEGER DEFAULT 0, views INTEGER DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Feedback Widget
  `CREATE TABLE IF NOT EXISTS quick_feedback (
    id SERIAL PRIMARY KEY, page_url TEXT NOT NULL,
    rating INTEGER, feedback_text TEXT, email TEXT,
    emoji TEXT DEFAULT '👍', ip_address TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Hashtag Trends
  `CREATE TABLE IF NOT EXISTS trending_hashtags (
    id SERIAL PRIMARY KEY, tag TEXT UNIQUE NOT NULL,
    use_count INTEGER DEFAULT 0, category TEXT DEFAULT 'general',
    last_trended TIMESTAMPTZ DEFAULT NOW()
  )`,
  // Notification Badges
  `CREATE TABLE IF NOT EXISTS notification_badges (
    id SERIAL PRIMARY KEY, user_email TEXT NOT NULL,
    badge_type TEXT NOT NULL, badge_name TEXT NOT NULL,
    badge_icon TEXT DEFAULT '🏆', description TEXT,
    earned_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(user_email, badge_type)
  )`,
  // Invite-only Access
  `CREATE TABLE IF NOT EXISTS invite_codes (
    id SERIAL PRIMARY KEY, code TEXT UNIQUE NOT NULL,
    created_by TEXT, max_uses INTEGER DEFAULT 50, used_count INTEGER DEFAULT 0,
    is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
];
VG_MIGRATIONS.forEach(m => migrations.push(m));
['polls','poll_votes','quizzes','quiz_results','testimonials','forum_topics','forum_replies',
 'viral_countdowns','waitlist_signups','share_contests','contest_entries','user_stories',
 'quick_feedback','trending_hashtags','notification_badges','invite_codes'
].forEach(t => VALID_TABLES.add(t));

const BASE_URL2 = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

// ============================================================
// === 1. POLLS SYSTEM — Get users engaged & sharing ===
// ============================================================

// Public polls page
app.get('/polls', ah(async (req, res) => {
  const cat = req.query.cat || 'all';
  let where = 'WHERE is_active = true AND (ends_at IS NULL OR ends_at >= NOW())';
  const params = [];
  if (cat !== 'all') { params.push(cat); where += ` AND category = $${params.length}`; }
  const polls = (await pool.query(`SELECT * FROM polls ${where} ORDER BY is_featured DESC, created_at DESC LIMIT 20`, params)).rows;
  const pollsHtml = polls.map(p => {
    const options = (typeof p.options === 'string' ? JSON.parse(p.options) : p.options) || [];
    const votes = (typeof p.votes === 'string' ? JSON.parse(p.votes) : p.votes) || {};
    const total = p.total_votes || 0;
    return `<div class="card" style="margin-bottom:16px" id="poll-${p.id}">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div>
          ${p.is_featured ? '<span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:600">Featured</span>' : ''}
          <span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:11px;margin-left:4px">${esc(p.category)}</span>
          <h3 style="margin-top:6px;font-size:17px">${esc(p.question)}</h3>
          ${p.description ? `<p style="color:#64748b;font-size:13px;margin-top:4px">${esc(p.description)}</p>` : ''}
        </div>
        <div style="text-align:right;font-size:12px;color:#94a3b8">${total} votes</div>
      </div>
      <div id="poll-options-${p.id}" style="margin-top:12px">
        ${options.map((opt, i) => {
          const voteCount = (votes[i] || 0);
          const pct = total > 0 ? Math.round(voteCount / total * 100) : 0;
          return `<button onclick="submitPoll(${p.id}, ${i})" class="poll-option" data-poll="${p.id}" data-option="${i}" style="display:block;width:100%;text-align:left;padding:12px 16px;border:2px solid #e2e8f0;border-radius:8px;margin-bottom:8px;background:white;cursor:pointer;font-size:14px;transition:all 0.2s">
            <div style="display:flex;justify-content:space-between"><span>${esc(opt)}</span><span class="poll-pct" style="color:#6366f1;font-weight:600;display:none">${pct}%</span></div>
            <div class="poll-bar" style="height:4px;background:#e2e8f0;border-radius:2px;margin-top:6px;display:none"><div class="poll-bar-fill" style="height:100%;background:linear-gradient(90deg,#6366f1,#8b5cf6);border-radius:2px;width:0%;transition:width 0.5s"></div></div>
          </button>`;
        }).join('')}
      </div>
      <div style="margin-top:8px;display:flex;gap:8px">
        <button onclick="sharePoll(${p.id})" style="background:#25d366;color:white;padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:12px">WhatsApp</button>
        <button onclick="sharePollTwitter(${p.id})" style="background:#1da1f2;color:white;padding:6px 14px;border-radius:6px;border:none;cursor:pointer;font-size:12px">Twitter</button>
      </div>
    </div>`;
  }).join('');

  res.send(renderPage('Polls & Voting', `
    <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><h1>Community Polls</h1><p>Vote, share your opinion, and see what others think</p></div>
    <div style="max-width:700px;margin:0 auto">
      ${pollsHtml || '<div class="card" style="text-align:center;padding:40px;color:#94a3b8">No active polls yet. Check back soon!</div>'}
    </div>
    <script>
    async function submitPoll(pollId, optionIdx) {
      const btns = document.querySelectorAll('[data-poll="'+pollId+'"]');
      btns.forEach(b => { b.disabled = true; b.style.cursor = 'default'; });
      try {
        const r = await fetch('/api/polls/vote', { method: 'POST', headers: {'Content-Type':'application/json'}, body: JSON.stringify({poll_id: pollId, option_index: optionIdx}) });
        const data = await r.json();
        if (data.success) {
          btns.forEach(b => {
            const opt = parseInt(b.dataset.option);
            const pct = data.results[opt] || 0;
            const total = Object.values(data.results).reduce((a,b)=>a+b, 0);
            const p = total > 0 ? Math.round(pct/total*100) : 0;
            b.querySelector('.poll-pct').style.display = 'inline';
            b.querySelector('.poll-pct').textContent = p+'%';
            b.querySelector('.poll-bar').style.display = 'block';
            b.querySelector('.poll-bar-fill').style.width = p+'%';
            if (opt === optionIdx) { b.style.borderColor = '#6366f1'; b.style.background = '#f5f3ff'; }
          });
        }
      } catch(e) { btns.forEach(b => b.disabled = false); }
    }
    function sharePoll(id) {
      window.open('https://wa.me/?text=' + encodeURIComponent('Vote in this poll on Comfort Zone! ' + BASE_URL2 + '/polls#poll-' + id));
    }
    function sharePollTwitter(id) {
      window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent('Just voted in this poll! Cast your vote: ' + BASE_URL2 + '/polls#poll-' + id));
    }
    </script>
  `, null, true));
}));

// Vote on poll
app.post('/api/polls/vote', ah(async (req, res) => {
  const { poll_id, option_index } = req.body;
  const poll = (await pool.query('SELECT * FROM polls WHERE id = $1', [poll_id])).rows[0];
  if (!poll) return res.json({ success: false, error: 'Poll not found' });
  // Check if already voted
  const existing = (await pool.query('SELECT id FROM poll_votes WHERE poll_id = $1 AND ip_address = $2', [poll_id, req.ip])).rows[0];
  if (existing) return res.json({ success: false, error: 'Already voted' });
  // Record vote
  await pool.query('INSERT INTO poll_votes (poll_id, option_index, ip_address) VALUES ($1, $2, $3)', [poll_id, option_index, req.ip]);
  // Update poll
  let votes = typeof poll.votes === 'string' ? JSON.parse(poll.votes) : (poll.votes || {});
  votes[option_index] = (votes[option_index] || 0) + 1;
  await pool.query('UPDATE polls SET votes = $1, total_votes = $2 WHERE id = $3', [JSON.stringify(votes), poll.total_votes + 1, poll_id]);
  // Revenue + points
  await trackRevenue('poll_vote', 0.01, `Poll vote: ${poll.question}`);
  res.json({ success: true, results: votes });
}));

// Admin: Manage polls
app.get('/admin/polls', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const polls = (await pool.query('SELECT * FROM polls ORDER BY created_at DESC')).rows;
  res.send(renderPage('Poll Manager', `
    <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><h1>Poll Manager</h1><p>Create engaging polls to boost interaction and sharing</p></div>
    <div class="card" style="margin-bottom:20px">
      <h3>Create Poll</h3>
      <form method="POST" action="/admin/polls/create" style="margin-top:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>Question</label><input name="question" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="What feature do you want next?"></div>
          <div><label>Category</label><select name="category" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"><option>technology</option><option>education</option><option>business</option><option>general</option><option>entertainment</option><option>sports</option></select></div>
        </div>
        <div style="margin-top:12px"><label>Options (one per line, min 2)</label><textarea name="options" rows="5" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px" placeholder="Mobile App\nDesktop App\nSMS Integration\nWhatsApp Bot"></textarea></div>
        <div style="margin-top:12px"><label>Description (optional)</label><input name="description" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:8px"><input type="checkbox" name="is_featured" value="1"> Featured</label>
        <button type="submit" class="btn" style="background:#6366f1;margin-top:12px">Create Poll</button>
      </form>
    </div>
    <div class="card"><h3>All Polls</h3>
      <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Question</th><th>Votes</th><th>Status</th><th>Actions</th></tr></thead><tbody>
        ${polls.map(p => `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:8px">${esc(p.question)}</td><td style="padding:8px;text-align:center;font-weight:600">${p.total_votes}</td><td style="padding:8px">${p.is_active?'<span style="color:#10b981">Active</span>':'<span style="color:#94a3b8">Closed</span>'}</td><td style="padding:8px"><a href="/admin/polls/toggle/${p.id}" class="btn" style="padding:4px 12px;font-size:12px">${p.is_active?'Close':'Open'}</a></td></tr>`).join('')}
      </tbody></table>
    </div>
  `, req.session.user));
}));

app.post('/admin/polls/create', requireAuth, ah(async (req, res) => {
  const { question, options, description, category, is_featured } = req.body;
  const opts = options.split('\n').map(o => o.trim()).filter(Boolean);
  if (opts.length < 2) return res.send('Need at least 2 options');
  await pool.query(
    `INSERT INTO polls (question, options, description, category, is_featured) VALUES ($1, $2, $3, $4, $5)`,
    [question, JSON.stringify(opts), description || null, category || 'general', is_featured === '1']
  );
  res.redirect('/admin/polls');
}));

app.get('/admin/polls/toggle/:id', requireAuth, ah(async (req, res) => {
  await pool.query('UPDATE polls SET is_active = NOT is_active WHERE id = $1', [req.params.id]);
  res.redirect('/admin/polls');
}));

// ============================================================
// === 2. QUIZZES — Viral content that gets shared ===
// ============================================================

app.get('/quizzes', ah(async (req, res) => {
  const quizzes = (await pool.query('SELECT * FROM quizzes WHERE is_active = true ORDER BY is_featured DESC, created_at DESC LIMIT 20')).rows;
  res.send(renderPage('Quizzes', `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#ef4444)"><h1>Fun Quizzes</h1><p>Test your knowledge and share your results</p></div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;max-width:900px;margin:0 auto">
      ${quizzes.map(q => `<div class="card" style="cursor:pointer" onclick="location.href='/quizzes/${q.id}'">
        <span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px">${esc(q.category)}</span>
        <h3 style="margin-top:6px;font-size:16px">${esc(q.title)}</h3>
        <p style="color:#64748b;font-size:13px;margin-top:4px">${esc((q.description||'').substring(0,100))}</p>
        <div style="display:flex;justify-content:space-between;margin-top:12px;font-size:12px;color:#94a3b8">
          <span>${q.plays || 0} plays</span>
          <span>${q.questions ? (typeof q.questions === 'string' ? JSON.parse(q.questions) : q.questions).length : 0} questions</span>
        </div>
      </div>`).join('')}
    </div>
  `, null, true));
}));

// Take quiz
app.get('/quizzes/:id', ah(async (req, res) => {
  const quiz = (await pool.query('SELECT * FROM quizzes WHERE id = $1', [req.params.id])).rows[0];
  if (!quiz) return res.status(404).send('Quiz not found');
  const questions = typeof quiz.questions === 'string' ? JSON.parse(quiz.questions) : (quiz.questions || []);
  res.send(renderPage(quiz.title, `
    <div style="max-width:700px;margin:0 auto">
      <div class="card" style="text-align:center;margin-bottom:20px">
        <span style="background:#fef3c7;color:#92400e;padding:2px 8px;border-radius:4px;font-size:11px">${esc(quiz.category)}</span>
        <h1 style="margin-top:8px">${esc(quiz.title)}</h1>
        <p style="color:#64748b">${questions.length} questions · Share your result!</p>
      </div>
      <div id="quiz-container">
        ${questions.map((q, i) => `<div class="card quiz-question" id="q-${i}" style="display:${i===0?'block':'none'};margin-bottom:16px">
          <div style="font-size:13px;color:#94a3b8;margin-bottom:8px">Question ${i+1} of ${questions.length}</div>
          <div style="background:#e2e8f0;height:4px;border-radius:2px;margin-bottom:16px"><div style="height:100%;background:#6366f1;border-radius:2px;width:${((i+1)/questions.length*100)}%"></div></div>
          <h3 style="font-size:17px;margin-bottom:16px">${esc(q.question)}</h3>
          <div style="display:grid;gap:8px">
            ${(q.options || []).map((opt, oi) => `<button onclick="selectAnswer(${i},${oi},${q.correct === oi ? 1 : 0})" style="display:block;width:100%;text-align:left;padding:12px 16px;border:2px solid #e2e8f0;border-radius:8px;background:white;cursor:pointer;font-size:14px;transition:all 0.2s">${esc(opt)}</button>`).join('')}
          </div>
        </div>`).join('')}
        <div id="quiz-result" style="display:none" class="card" >
          <div style="text-align:center">
            <div id="result-emoji" style="font-size:64px"></div>
            <h2 id="result-title" style="margin-top:12px"></h2>
            <p id="result-score" style="color:#6366f1;font-size:24px;font-weight:700"></p>
            <p id="result-msg" style="color:#64748b;margin-top:8px"></p>
            <div style="margin-top:20px;display:flex;gap:8px;justify-content:center">
              <button onclick="shareQuizResult()" style="background:#25d366;color:white;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600">Share on WhatsApp</button>
              <button onclick="shareQuizTwitter()" style="background:#1da1f2;color:white;padding:10px 20px;border-radius:8px;border:none;cursor:pointer;font-weight:600">Share on Twitter</button>
            </div>
            <a href="/quizzes" class="btn" style="margin-top:12px;display:inline-block">More Quizzes</a>
          </div>
        </div>
      </div>
    </div>
    <script>
    const totalQ = ${questions.length};
    let currentQ = 0, score = 0;
    function selectAnswer(qi, oi, correct) {
      const btns = document.querySelectorAll('#q-'+qi+' button');
      btns.forEach((b,i) => {
        b.disabled = true;
        if (i === oi) b.style.borderColor = correct ? '#10b981' : '#ef4444';
        if (correct === 1) score++;
      });
      setTimeout(() => {
        currentQ++;
        if (currentQ >= totalQ) {
          document.querySelectorAll('.quiz-question').forEach(q => q.style.display = 'none');
          const pct = Math.round(score/totalQ*100);
          document.getElementById('quiz-result').style.display = 'block';
          document.getElementById('result-score').textContent = score+'/'+totalQ+' ('+pct+'%)';
          if (pct >= 80) { document.getElementById('result-emoji').textContent = '🏆'; document.getElementById('result-title').textContent = 'Excellent!'; document.getElementById('result-msg').textContent = 'You really know your stuff!'; }
          else if (pct >= 50) { document.getElementById('result-emoji').textContent = '👍'; document.getElementById('result-title').textContent = 'Good Job!'; document.getElementById('result-msg').textContent = 'You did well! Share and challenge friends.'; }
          else { document.getElementById('result-emoji').textContent = '📚'; document.getElementById('result-title').textContent = 'Keep Learning!'; document.getElementById('result-msg').textContent = 'Try again and improve your score!'; }
          fetch('/api/quizzes/result',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({quiz_id:${quiz.id},score,total:totalQ})}).catch(()=>{});
        } else {
          document.getElementById('q-'+qi).style.display = 'none';
          document.getElementById('q-'+currentQ).style.display = 'block';
        }
      }, correct ? 800 : 1500);
    }
    function shareQuizResult() {
      window.open('https://wa.me/?text=' + encodeURIComponent('I scored '+score+'/'+totalQ+' on "'+decodeURIComponent('${encodeURIComponent(quiz.title)}')+'" quiz! Can you beat me? ' + BASE_URL2 + '/quizzes/${quiz.id}'));
    }
    function shareQuizTwitter() {
      window.open('https://twitter.com/intent/tweet?text=' + encodeURIComponent('I scored '+score+'/'+totalQ+' on "'+decodeURIComponent('${encodeURIComponent(quiz.title)}')+'"! Think you can do better? ' + BASE_URL2 + '/quizzes/${quiz.id}'));
    }
    </script>
  `, null, true));
}));

app.post('/api/quizzes/result', ah(async (req, res) => {
  const { quiz_id, score, total } = req.body;
  await pool.query('UPDATE quizzes SET plays = plays + 1 WHERE id = $1', [quiz_id]);
  await pool.query('INSERT INTO quiz_results (quiz_id, score, total, ip_address) VALUES ($1, $2, $3, $4)', [quiz_id, score, total, req.ip]);
  await trackRevenue('quiz_play', 0.02, `Quiz completed: score ${score}/${total}`);
  res.json({ success: true });
}));

// Admin: Manage quizzes
app.get('/admin/quizzes', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const quizzes = (await pool.query('SELECT * FROM quizzes ORDER BY created_at DESC')).rows;
  res.send(renderPage('Quiz Manager', `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#ef4444)"><h1>Quiz Manager</h1><p>Create viral quizzes that users share with friends</p></div>
    <div class="card" style="margin-bottom:20px">
      <h3>Create Quiz</h3>
      <form method="POST" action="/admin/quizzes/create" style="margin-top:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>Title</label><input name="title" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label>Category</label><select name="category" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"><option>education</option><option>technology</option><option>general</option><option>entertainment</option><option>sports</option><option>business</option></select></div>
        </div>
        <div style="margin-top:12px"><label>Questions (JSON format)</label>
        <textarea name="questions" rows="10" required style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-family:monospace;font-size:13px" placeholder='[{"question":"What is the capital of Uganda?","options":["Kampala","Nairobi","Dar es Salaam","Kigali"],"correct":0},{"question":"Which lake is the largest in Africa?","options":["Victoria","Tanganyika","Malawi","Albert"],"correct":0}]'></textarea>
        <p style="font-size:12px;color:#94a3b8;margin-top:4px">Format: [{"question":"...","options":["A","B","C","D"],"correct":0},...]</p></div>
        <button type="submit" class="btn" style="background:#f59e0b;margin-top:12px">Create Quiz</button>
      </form>
    </div>
    <div class="card"><h3>All Quizzes</h3>
      <table style="width:100%;margin-top:8px"><thead><tr style="border-bottom:2px solid #e2e8f0"><th style="text-align:left;padding:8px">Title</th><th>Plays</th><th>Avg Score</th><th>Actions</th></tr></thead><tbody>
        ${quizzes.map(q => `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:8px">${esc(q.title)}</td><td style="padding:8px;text-align:center">${q.plays}</td><td style="padding:8px;text-align:center">${q.avg_score || 0}%</td><td style="padding:8px"><a href="/quizzes/${q.id}" class="btn" style="padding:4px 12px;font-size:12px">Play</a></td></tr>`).join('')}
      </tbody></table>
    </div>
  `, req.session.user));
}));

app.post('/admin/quizzes/create', requireAuth, ah(async (req, res) => {
  const { title, questions, description, category } = req.body;
  let parsed;
  try { parsed = JSON.parse(questions); } catch(e) { return res.send('Invalid JSON format for questions'); }
  await pool.query(`INSERT INTO quizzes (title, questions, description, category) VALUES ($1, $2, $3, $4)`, [title, JSON.stringify(parsed), description || null, category || 'general']);
  res.redirect('/admin/quizzes');
}));

// ============================================================
// === 3. TESTIMONIALS WALL — Social proof that converts ===
// ============================================================

app.get('/testimonials', ah(async (req, res) => {
  const testimonials = (await pool.query(
    `SELECT * FROM testimonials WHERE is_approved = true ORDER BY is_featured DESC, likes DESC LIMIT 30`
  )).rows;
  res.send(renderPage('Testimonials', `
    <div class="hero" style="background:linear-gradient(135deg,#10b981,#059669)"><h1>What Our Users Say</h1><p>Trusted by thousands across Uganda and East Africa</p></div>
    <div style="text-align:center;margin-bottom:24px">
      <a href="/testimonials/submit" class="btn" style="background:#10b981;font-size:16px;padding:12px 32px">Share Your Story</a>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;max-width:1000px;margin:0 auto">
      ${testimonials.map(t => `<div class="card" style="padding:20px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
          <div style="width:48px;height:48px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;display:flex;align-items:center;justify-content:center;color:white;font-size:20px;font-weight:700">${(t.user_name||'A')[0].toUpperCase()}</div>
          <div><div style="font-weight:600">${esc(t.user_name)}</div><div style="font-size:12px;color:#94a3b8">${esc(t.user_title||'')} ${t.organization ? '· '+esc(t.organization) : ''}</div></div>
        </div>
        <div style="color:#f59e0b;font-size:14px;margin-bottom:8px">${'★'.repeat(t.rating||5)}</div>
        <p style="color:#475569;font-size:14px;line-height:1.6">"${esc(t.testimonial_text)}"</p>
        ${t.country ? `<div style="margin-top:8px;font-size:12px;color:#94a3b8">From ${esc(t.country)}</div>` : ''}
        <div style="margin-top:8px;display:flex;gap:8px;align-items:center">
          <button onclick="likeTestimonial(${t.id})" style="background:none;border:1px solid #e2e8f0;padding:4px 12px;border-radius:6px;font-size:12px;cursor:pointer">❤️ ${t.likes||0}</button>
          <button onclick="shareTestimonial(${t.id})" style="background:#25d366;color:white;padding:4px 12px;border-radius:6px;border:none;font-size:12px;cursor:pointer">Share</button>
        </div>
      </div>`).join('')}
    </div>
    <script>
    async function likeTestimonial(id) {
      await fetch('/api/testimonials/like/'+id,{method:'POST'}).catch(()=>{});
    }
    function shareTestimonial(id) {
      window.open('https://wa.me/?text='+encodeURIComponent('Check out this testimonial on Comfort Zone! '+BASE_URL2+'/testimonials'));
    }
    </script>
  `, null, true));
}));

// Submit testimonial
app.get('/testimonials/submit', ah(async (req, res) => {
  res.send(renderPage('Share Your Story', `
    <div style="max-width:600px;margin:0 auto">
      <div class="card">
        <h2 style="margin-bottom:4px">Share Your Experience</h2>
        <p style="color:#64748b;margin-bottom:20px">Tell others how Comfort Zone has helped you</p>
        <form method="POST" action="/testimonials/submit">
          <div style="display:grid;gap:12px">
            <div><label>Your Name *</label><input name="user_name" required style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px"></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label>Title/Role</label><input name="user_title" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px" placeholder="Head Teacher"></div>
              <div><label>Organization</label><input name="organization" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px" placeholder="St. Mary's School"></div>
            </div>
            <div><label>Your Testimonial *</label><textarea name="testimonial_text" required rows="5" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px" placeholder="How has Comfort Zone helped you?"></textarea></div>
            <div><label>Rating</label>
              <div style="display:flex;gap:4px">
                ${[1,2,3,4,5].map(n => `<label style="cursor:pointer;font-size:24px"><input type="radio" name="rating" value="${n}" ${n===5?'checked':''} style="display:none">★</label>`).join('')}
              </div>
            </div>
            <div><label>Country</label><input name="country" value="Uganda" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px"></div>
            <button type="submit" class="btn" style="background:#10b981;padding:12px">Submit Testimonial</button>
          </div>
        </form>
      </div>
    </div>
  `, null, true));
}));

app.post('/testimonials/submit', ah(async (req, res) => {
  const { user_name, user_title, organization, testimonial_text, rating, country } = req.body;
  await pool.query(
    `INSERT INTO testimonials (user_name, user_title, organization, testimonial_text, rating, country) VALUES ($1, $2, $3, $4, $5, $6)`,
    [user_name, user_title || null, organization || null, testimonial_text, parseInt(rating) || 5, country || 'Uganda']
  );
  await trackRevenue('testimonial_submit', 0.05, `Testimonial from ${user_name}`);
  res.send(renderPage('Thank You!', `
    <div style="max-width:500px;margin:40px auto;text-align:center">
      <div style="font-size:64px;margin-bottom:16px">Thank You!</div>
      <h2>Your testimonial has been submitted</h2>
      <p style="color:#64748b;margin:12px 0 24px">It will appear on our testimonials page after review</p>
      <a href="/testimonials" class="btn" style="background:#10b981">View All Testimonials</a>
    </div>
  `, null, true));
}));

app.post('/api/testimonials/like/:id', ah(async (req, res) => {
  await pool.query('UPDATE testimonials SET likes = likes + 1 WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================================
// === 4. COMMUNITY FORUMS ===
// ============================================================

app.get('/forum', ah(async (req, res) => {
  const cat = req.query.cat || 'all';
  let where = 'WHERE is_approved = true';
  const params = [];
  if (cat !== 'all') { params.push(cat); where += ` AND category = $${params.length}`; }
  const topics = (await pool.query(`SELECT * FROM forum_topics ${where} ORDER BY is_pinned DESC, last_reply_at DESC NULLS LAST, created_at DESC LIMIT 30`, params)).rows;
  const categories = ['all', 'general', 'help', 'feature_requests', 'business', 'education', 'technology', 'off_topic'];
  res.send(renderPage('Community Forum', `
    <div class="hero" style="background:linear-gradient(135deg,#3b82f6,#6366f1)"><h1>Community Forum</h1><p>Ask questions, share ideas, connect with other users</p></div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:20px">
      ${categories.map(c => `<a href="/forum?cat=${c}" style="padding:6px 14px;border-radius:20px;text-decoration:none;font-size:13px;${c===cat?'background:#6366f1;color:white':'background:#f1f5f9;color:#475569'}">${c==='all'?'All Topics':c.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase())}</a>`).join('')}
    </div>
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
      <h3>${topics.length} Topics</h3>
      <a href="/forum/new" class="btn" style="background:#6366f1">New Topic</a>
    </div>
    ${topics.map(t => `<div class="card" style="margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;cursor:pointer" onclick="location.href='/forum/topic/${t.id}'">
      <div>
        <div style="display:flex;gap:6px;align-items:center">
          ${t.is_pinned ? '<span style="background:#fef3c7;color:#92400e;padding:2px 6px;border-radius:4px;font-size:11px">Pinned</span>' : ''}
          <span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:11px">${esc(t.category)}</span>
        </div>
        <h4 style="margin-top:4px">${esc(t.title)}</h4>
        <div style="font-size:12px;color:#94a3b8;margin-top:4px">${esc(t.author_name||'Anonymous')} · ${t.views||0} views · ${t.replies_count||0} replies</div>
      </div>
      <div style="font-size:12px;color:#94a3b8;white-space:nowrap">${t.last_reply_at ? timeAgo2(t.last_reply_at) : timeAgo2(t.created_at)}</div>
    </div>`).join('')}
  `, null, true));
}));

// New topic form
app.get('/forum/new', ah(async (req, res) => {
  res.send(renderPage('New Topic', `
    <div style="max-width:700px;margin:0 auto">
      <div class="card">
        <h2>Create New Topic</h2>
        <form method="POST" action="/forum/new" style="margin-top:16px">
          <div style="display:grid;gap:12px">
            <div style="display:grid;grid-template-columns:2fr 1fr;gap:12px">
              <div><label>Title *</label><input name="title" required style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px"></div>
              <div><label>Category</label><select name="category" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px"><option>general</option><option>help</option><option>feature_requests</option><option>business</option><option>education</option><option>technology</option><option>off_topic</option></select></div>
            </div>
            <div><label>Your Name *</label><input name="author_name" required style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px"></div>
            <div><label>Your Body *</label><textarea name="body" required rows="6" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px" placeholder="Describe your question or topic in detail..."></textarea></div>
            <button type="submit" class="btn" style="background:#6366f1;padding:12px">Post Topic</button>
          </div>
        </form>
      </div>
    </div>
  `, null, true));
}));

app.post('/forum/new', ah(async (req, res) => {
  const { title, body, category, author_name } = req.body;
  const topic = (await pool.query(
    `INSERT INTO forum_topics (title, body, category, author_name, last_reply_at) VALUES ($1, $2, $3, $4, NOW()) RETURNING id`,
    [title, body, category || 'general', author_name || 'Anonymous']
  )).rows[0];
  await trackRevenue('forum_topic', 0.03, `Forum topic: ${title}`);
  res.redirect('/forum/topic/' + topic.id);
}));

// View topic
app.get('/forum/topic/:id', ah(async (req, res) => {
  const topic = (await pool.query(`UPDATE forum_topics SET views = views + 1 WHERE id = $1 RETURNING *`, [req.params.id])).rows[0];
  if (!topic) return res.status(404).send('Topic not found');
  const replies = (await pool.query('SELECT * FROM forum_replies WHERE topic_id = $1 AND is_approved = true ORDER BY created_at', [req.params.id])).rows;
  res.send(renderPage(topic.title, `
    <div style="max-width:800px;margin:0 auto">
      <a href="/forum" style="color:#6366f1;font-size:14px">Back to Forum</a>
      <div class="card" style="margin-top:12px">
        <span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:11px">${esc(topic.category)}</span>
        <h1 style="margin-top:6px">${esc(topic.title)}</h1>
        <div style="font-size:13px;color:#94a3b8;margin-top:6px">By ${esc(topic.author_name||'Anonymous')} · ${topic.views} views · ${topic.replies_count} replies</div>
        <div style="margin-top:16px;padding:16px;background:#f8fafc;border-radius:8px;white-space:pre-wrap;line-height:1.7">${esc(topic.body)}</div>
        <div style="margin-top:12px;display:flex;gap:8px">
          <button onclick="shareTopic(${topic.id})" style="background:#25d366;color:white;padding:6px 14px;border-radius:6px;border:none;font-size:12px;cursor:pointer">Share WhatsApp</button>
          <button onclick="shareTopicTwitter(${topic.id})" style="background:#1da1f2;color:white;padding:6px 14px;border-radius:6px;border:none;font-size:12px;cursor:pointer">Share Twitter</button>
        </div>
      </div>
      ${replies.map(r => `<div class="card" style="margin-top:8px;padding:16px">
        <div style="display:flex;justify-content:space-between"><span style="font-weight:600;font-size:14px">${esc(r.author_name||'Anonymous')}</span><span style="font-size:12px;color:#94a3b8">${timeAgo2(r.created_at)}</span></div>
        <div style="margin-top:8px;font-size:14px;line-height:1.6;white-space:pre-wrap">${esc(r.body)}</div>
      </div>`).join('')}
      <div class="card" style="margin-top:16px">
        <h3>Post a Reply</h3>
        <form method="POST" action="/forum/reply/${topic.id}" style="margin-top:8px">
          <div style="display:grid;gap:8px">
            <input name="author_name" required placeholder="Your Name" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px">
            <textarea name="body" required rows="4" placeholder="Write your reply..." style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px"></textarea>
            <button type="submit" class="btn" style="background:#6366f1">Post Reply</button>
          </div>
        </form>
      </div>
    </div>
    <script>
    function shareTopic(id){window.open('https://wa.me/?text='+encodeURIComponent('Check out this discussion on Comfort Zone: '+BASE_URL2+'/forum/topic/'+id))}
    function shareTopicTwitter(id){window.open('https://twitter.com/intent/tweet?text='+encodeURIComponent('Join this discussion: '+BASE_URL2+'/forum/topic/'+id))}
    </script>
  `, null, true));
}));

app.post('/forum/reply/:topicId', ah(async (req, res) => {
  const { author_name, body } = req.body;
  await pool.query('INSERT INTO forum_replies (topic_id, body, author_name) VALUES ($1, $2, $3)', [req.params.topicId, body, author_name || 'Anonymous']);
  await pool.query('UPDATE forum_topics SET replies_count = replies_count + 1, last_reply_at = NOW() WHERE id = $1', [req.params.topicId]);
  await trackRevenue('forum_reply', 0.02, `Forum reply on topic ${req.params.topicId}`);
  res.redirect('/forum/topic/' + req.params.topicId);
}));

function timeAgo2(date) {
  if (!date) return '';
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return s + 's ago';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

// ============================================================
// === 5. VIRAL COUNTDOWN / WAITLIST ===
// ============================================================

app.get('/waitlist', ah(async (req, res) => {
  const countdowns = (await pool.query('SELECT * FROM viral_countdowns WHERE is_active = true ORDER BY created_at DESC LIMIT 5')).rows;
  res.send(renderPage('Join the Waitlist', `
    ${countdowns.map(c => `<div style="background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:48px 24px;text-align:center;border-radius:16px;margin-bottom:24px;max-width:700px;margin-left:auto;margin-right:auto">
      <h1 style="font-size:32px">${esc(c.title)}</h1>
      <p style="opacity:0.9;margin:8px 0 20px;font-size:16px">${esc(c.description||'')}</p>
      <div id="countdown-${c.id}" style="display:flex;gap:12px;justify-content:center;margin-bottom:24px">
        <div style="background:rgba(255,255,255,0.2);padding:12px 16px;border-radius:8px;min-width:60px"><div id="cd-days-${c.id}" style="font-size:24px;font-weight:700">0</div><div style="font-size:11px;opacity:0.8">Days</div></div>
        <div style="background:rgba(255,255,255,0.2);padding:12px 16px;border-radius:8px;min-width:60px"><div id="cd-hours-${c.id}" style="font-size:24px;font-weight:700">0</div><div style="font-size:11px;opacity:0.8">Hours</div></div>
        <div style="background:rgba(255,255,255,0.2);padding:12px 16px;border-radius:8px;min-width:60px"><div id="cd-mins-${c.id}" style="font-size:24px;font-weight:700">0</div><div style="font-size:11px;opacity:0.8">Mins</div></div>
        <div style="background:rgba(255,255,255,0.2);padding:12px 16px;border-radius:8px;min-width:60px"><div id="cd-secs-${c.id}" style="font-size:24px;font-weight:700">0</div><div style="font-size:11px;opacity:0.8">Secs</div></div>
      </div>
      <form method="POST" action="/waitlist/join/${c.id}" style="display:flex;gap:8px;max-width:400px;margin:0 auto">
        <input name="email" type="email" required placeholder="Enter your email" style="flex:1;padding:12px;border:none;border-radius:8px;font-size:14px">
        <input name="name" placeholder="Your name" style="width:140px;padding:12px;border:none;border-radius:8px;font-size:14px">
        <button type="submit" style="background:#f59e0b;color:white;border:none;padding:12px 20px;border-radius:8px;font-weight:700;cursor:pointer">${esc(c.cta_text)}</button>
      </form>
      <p style="margin-top:12px;font-size:14px;opacity:0.8">${c.signup_count||0} people on the waitlist</p>
    </div>
    <script>
    function updateCountdown_${c.id}(){
      const target = new Date('${c.target_date}').getTime();
      const now = Date.now();
      const diff = target - now;
      if(diff<=0){document.getElementById('countdown-${c.id}').innerHTML='<h2>We are LIVE!</h2>';return;}
      const d=Math.floor(diff/86400000),h=Math.floor((diff%86400000)/3600000),m=Math.floor((diff%3600000)/60000),s=Math.floor((diff%60000)/1000);
      document.getElementById('cd-days-${c.id}').textContent=d;
      document.getElementById('cd-hours-${c.id}').textContent=h;
      document.getElementById('cd-mins-${c.id}').textContent=m;
      document.getElementById('cd-secs-${c.id}').textContent=s;
    }
    updateCountdown_${c.id}();
    setInterval(updateCountdown_${c.id},1000);
    </script>`).join('')}
  `, null, true));
}));

app.post('/waitlist/join/:id', ah(async (req, res) => {
  const { email, name } = req.body;
  const pos = (await pool.query('SELECT COUNT(*) FROM waitlist_signups WHERE countdown_id = $1', [req.params.id])).rows[0].count;
  await pool.query(
    `INSERT INTO waitlist_signups (countdown_id, email, name, position) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING`,
    [req.params.id, email, name || null, parseInt(pos) + 1]
  );
  await pool.query('UPDATE viral_countdowns SET signup_count = signup_count + 1 WHERE id = $1', [req.params.id]);
  await pool.query('INSERT INTO newsletter_subscribers (email, name, source) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [email, name || null, 'waitlist']);
  await trackRevenue('waitlist_signup', 0.30, `Waitlist: ${email}`);
  res.send(renderPage('You Are On The List!', `
    <div style="max-width:500px;margin:60px auto;text-align:center">
      <div style="font-size:64px;margin-bottom:16px">You are #${parseInt(pos) + 1}!</div>
      <h2>You are on the waitlist</h2>
      <p style="color:#64748b;margin:12px 0 24px">We will notify you as soon as we launch. Share with friends to move up the list!</p>
      <a href="https://wa.me/?text=${encodeURIComponent('Join the waitlist for Comfort Zone! ' + BASE_URL22 + '/waitlist')}" target="_blank" class="btn" style="background:#25d366;display:inline-block;padding:12px 24px">Share on WhatsApp</a>
    </div>
  `, null, true));
}));

// ============================================================
// === 6. USER STORIES / SUCCESS STORIES ===
// ============================================================

app.get('/stories', ah(async (req, res) => {
  const stories = (await pool.query('SELECT * FROM user_stories WHERE is_published = true ORDER BY likes DESC, created_at DESC LIMIT 20')).rows;
  res.send(renderPage('Success Stories', `
    <div class="hero" style="background:linear-gradient(135deg,#10b981,#059669)"><h1>Success Stories</h1><p>Real stories from real users achieving real results</p></div>
    <div style="text-align:center;margin-bottom:24px"><a href="/stories/submit" class="btn" style="background:#10b981;padding:12px 32px;font-size:16px">Share Your Story</a></div>
    <div style="max-width:800px;margin:0 auto">
      ${stories.map(s => `<div class="card" style="margin-bottom:16px;padding:20px">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div>
            <h3 style="font-size:18px">${esc(s.title)}</h3>
            <div style="font-size:13px;color:#94a3b8;margin-top:4px">By ${esc(s.user_name||'Anonymous')} · ${s.views||0} views</div>
          </div>
          <span style="background:#ede9fe;color:#5b21b6;padding:2px 8px;border-radius:4px;font-size:11px">${esc(s.category)}</span>
        </div>
        <p style="margin-top:12px;line-height:1.7;color:#475569">${esc((s.story||'').substring(0, 400))}${(s.story||'').length > 400 ? '...' : ''}</p>
        <div style="margin-top:8px;display:flex;gap:8px">
          <button onclick="likeStory(${s.id})" style="background:none;border:1px solid #e2e8f0;padding:4px 12px;border-radius:6px;font-size:12px;cursor:pointer">❤️ ${s.likes||0}</button>
          <button onclick="shareStory(${s.id})" style="background:#25d366;color:white;padding:4px 12px;border-radius:6px;border:none;font-size:12px;cursor:pointer">Share</button>
        </div>
      </div>`).join('')}
    </div>
    <script>
    async function likeStory(id){await fetch('/api/stories/like/'+id,{method:'POST'}).catch(()=>{});}
    function shareStory(id){window.open('https://wa.me/?text='+encodeURIComponent('Read this success story: '+BASE_URL2+'/stories'));}
    </script>
  `, null, true));
}));

app.get('/stories/submit', ah(async (req, res) => {
  res.send(renderPage('Share Your Story', `
    <div style="max-width:600px;margin:0 auto"><div class="card">
      <h2>Your Success Story</h2>
      <p style="color:#64748b;margin-bottom:16px">How has Comfort Zone helped you succeed?</p>
      <form method="POST" action="/stories/submit">
        <div style="display:grid;gap:12px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Your Name</label><input name="user_name" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px"></div>
            <div><label>Category</label><select name="category" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px"><option>education</option><option>business</option><option>church</option><option>health</option><option>general</option></select></div>
          </div>
          <div><label>Title *</label><input name="title" required style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label>Your Story *</label><textarea name="story" required rows="8" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px"></textarea></div>
          <button type="submit" class="btn" style="background:#10b981;padding:12px">Submit Story</button>
        </div>
      </form>
    </div></div>
  `, null, true));
}));

app.post('/stories/submit', ah(async (req, res) => {
  const { user_name, title, story, category } = req.body;
  await pool.query('INSERT INTO user_stories (user_name, title, story, category) VALUES ($1, $2, $3, $4)', [user_name || null, title, story, category || 'general']);
  await trackRevenue('story_submit', 0.05, `Story: ${title}`);
  res.redirect('/stories');
}));

app.post('/api/stories/like/:id', ah(async (req, res) => {
  await pool.query('UPDATE user_stories SET likes = likes + 1 WHERE id = $1', [req.params.id]);
  res.json({ ok: true });
}));

// ============================================================
// === 7. QUICK FEEDBACK WIDGET ===
// ============================================================
app.get('/js/feedback-widget.js', ah(async (req, res) => {
  res.type('application/javascript').send(`
(function(){
  if(document.getElementById('cz-feedback-btn'))return;
  var btn=document.createElement('div');
  btn.id='cz-feedback-btn';
  btn.style.cssText='position:fixed;bottom:20px;right:20px;width:48px;height:48px;background:linear-gradient(135deg,#6366f1,#8b5cf6);border-radius:50%;cursor:pointer;z-index:9998;display:flex;align-items:center;justify-content:center;box-shadow:0 4px 12px rgba(99,102,241,0.4);font-size:20px;color:white;transition:transform 0.2s';
  btn.innerHTML='💬';
  btn.onmouseover=function(){btn.style.transform='scale(1.1)'};
  btn.onmouseout=function(){btn.style.transform='scale(1)'};
  btn.onclick=function(){
    if(document.getElementById('cz-feedback-panel')){document.getElementById('cz-feedback-panel').remove();return;}
    var panel=document.createElement('div');
    panel.id='cz-feedback-panel';
    panel.style.cssText='position:fixed;bottom:80px;right:20px;background:white;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,0.15);z-index:9999;width:320px;padding:20px;font-family:system-ui';
    panel.innerHTML='<h3 style="margin-bottom:4px;font-size:16px">Send Feedback</h3><p style="color:#64748b;font-size:13px;margin-bottom:12px">Help us improve Comfort Zone</p><div style="display:flex;gap:4px;margin-bottom:12px"><span class="fb-emoji" onclick="selectEmoji(this)" style="cursor:pointer;font-size:24px;padding:4px;border:2px solid transparent;border-radius:8px">😡</span><span class="fb-emoji" onclick="selectEmoji(this)" style="cursor:pointer;font-size:24px;padding:4px;border:2px solid transparent;border-radius:8px">😕</span><span class="fb-emoji" onclick="selectEmoji(this)" style="cursor:pointer;font-size:24px;padding:4px;border:2px solid transparent;border-radius:8px">😐</span><span class="fb-emoji" onclick="selectEmoji(this)" style="cursor:pointer;font-size:24px;padding:4px;border:2px solid transparent;border-radius:8px">😊</span><span class="fb-emoji" onclick="selectEmoji(this)" style="cursor:pointer;font-size:24px;padding:4px;border:2px solid transparent;border-radius:8px">🤩</span></div><textarea id="fb-text" placeholder="Tell us more..." rows="3" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;resize:none;margin-bottom:8px"></textarea><input id="fb-email" placeholder="Email (optional)" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:8px"><button onclick="submitFeedback()" style="width:100%;background:#6366f1;color:white;border:none;padding:8px;border-radius:8px;font-weight:600;cursor:pointer">Send Feedback</button>';
    document.body.appendChild(panel);
  };
  document.body.appendChild(btn);
  var selectedEmoji='👍';
  window.selectEmoji=function(el){document.querySelectorAll('.fb-emoji').forEach(function(e){e.style.borderColor='transparent'});el.style.borderColor='#6366f1';selectedEmoji=el.textContent;};
  window.submitFeedback=function(){
    var text=document.getElementById('fb-text').value;
    var email=document.getElementById('fb-email').value;
    fetch('/api/feedback',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({emoji:selectedEmoji,feedback_text:text,email:email,page_url:location.href})}).then(function(){
      document.getElementById('cz-feedback-panel').innerHTML='<div style="text-align:center;padding:20px"><div style="font-size:32px">Thank you!</div><p style="color:#64748b;font-size:13px;margin-top:8px">Your feedback helps us improve</p></div>';
      setTimeout(function(){document.getElementById('cz-feedback-panel').remove()},2000);
    }).catch(function(){});
  };
})();
`);
}));

app.post('/api/feedback', ah(async (req, res) => {
  const { emoji, feedback_text, email, page_url } = req.body;
  await pool.query(
    `INSERT INTO quick_feedback (page_url, feedback_text, email, emoji, ip_address) VALUES ($1, $2, $3, $4, $5)`,
    [page_url || '', feedback_text || '', email || null, emoji || '👍', req.ip]
  );
  await trackRevenue('feedback', 0.05, `Feedback: ${emoji} from ${email || 'anonymous'}`);
  res.json({ success: true });
}));

// ============================================================
// === 8. ADMIN: Feedback & Stories Dashboard ===
// ============================================================

app.get('/admin/testimonials', requireAuth, ah(async (req, res) => {
  const u = req.session.user;
  if (u.role !== 'super_admin' && u.role !== 'admin') return res.status(403).send('Access denied');
  const [testimonials, stories, feedback] = await Promise.all([
    pool.query('SELECT * FROM testimonials ORDER BY created_at DESC'),
    pool.query('SELECT * FROM user_stories ORDER BY created_at DESC'),
    pool.query('SELECT * FROM quick_feedback ORDER BY created_at DESC LIMIT 50')
  ]);
  res.send(renderPage('User Content', `
    <div class="hero" style="background:linear-gradient(135deg,#10b981,#059669)"><h1>User Content</h1><p>Testimonials, stories, and feedback</p></div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:24px">
      <div class="stat-card"><div class="stat-num" style="color:#10b981">${testimonials.rows.length}</div><div>Testimonials</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#6366f1">${stories.rows.length}</div><div>Stories</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${feedback.rows.length}</div><div>Feedback</div></div>
    </div>
    <div class="card" style="margin-bottom:20px">
      <h3>Pending Testimonials</h3>
      ${testimonials.rows.filter(t => !t.is_approved).map(t => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center">
        <div><span style="font-weight:500">${esc(t.user_name)}</span> — "${esc((t.testimonial_text||'').substring(0,80))}..."</div>
        <a href="/admin/testimonials/approve/${t.id}" class="btn" style="padding:4px 12px;font-size:12px;background:#10b981">Approve</a>
      </div>`).join('') || '<p style="color:#94a3b8;padding:12px">No pending testimonials</p>'}
    </div>
    <div class="card" style="margin-bottom:20px">
      <h3>Pending Stories</h3>
      ${stories.rows.filter(s => !s.is_published).map(s => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;display:flex;justify-content:space-between;align-items:center">
        <div><span style="font-weight:500">${esc(s.title)}</span> by ${esc(s.user_name||'Anonymous')}</div>
        <a href="/admin/stories/publish/${s.id}" class="btn" style="padding:4px 12px;font-size:12px;background:#10b981">Publish</a>
      </div>`).join('') || '<p style="color:#94a3b8;padding:12px">No pending stories</p>'}
    </div>
    <div class="card">
      <h3>Recent Feedback</h3>
      ${feedback.rows.slice(0, 20).map(f => `<div style="padding:6px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
        <span style="font-size:18px">${f.emoji}</span>
        <span style="font-weight:500;margin-left:4px">${esc(f.feedback_text||'No comment')}</span>
        <span style="color:#94a3b8;margin-left:8px">${f.page_url||''} ${f.email ? '· '+esc(f.email) : ''}</span>
      </div>`).join('')}
    </div>
  `, req.session.user));
}));

app.get('/admin/testimonials/approve/:id', requireAuth, ah(async (req, res) => {
  await pool.query('UPDATE testimonials SET is_approved = true WHERE id = $1', [req.params.id]);
  res.redirect('/admin/testimonials');
}));

app.get('/admin/stories/publish/:id', requireAuth, ah(async (req, res) => {
  await pool.query('UPDATE user_stories SET is_published = true WHERE id = $1', [req.params.id]);
  res.redirect('/admin/testimonials');
}));

// ============================================================
// === 9. INVITE CODES (Growth hack) ===
// ============================================================

app.get('/invite/:code', ah(async (req, res) => {
  const code = (await pool.query('SELECT * FROM invite_codes WHERE code = $1 AND is_active = true AND used_count < max_uses', [req.params.code])).rows[0];
  if (!code) return res.redirect('/register');
  res.redirect('/register?invite=' + req.params.code);
}));

// ============================================================
// === 10. SEED DEFAULT DATA ===
// ============================================================
async function seedViralData() {
  // Seed default polls
  const pollCount = (await pool.query('SELECT COUNT(*) FROM polls')).rows[0].count;
  if (parseInt(pollCount) === 0) {
    const defaultPolls = [
      { q: 'What feature would you like most?', desc: 'Help us prioritize our development roadmap', cat: 'technology', opts: ['Mobile App','SMS Notifications','WhatsApp Integration','More Payment Options','Offline Mode'] },
      { q: 'How did you hear about Comfort Zone?', desc: '', cat: 'general', opts: ['Friend/Referral','Facebook','Twitter/X','Google Search','WhatsApp','Other'] },
      { q: 'What type of organization are you?', desc: '', cat: 'general', opts: ['School','Church','Business','Health Facility','NGO','Individual','Other'] },
    ];
    for (const p of defaultPolls) {
      await pool.query(`INSERT INTO polls (question, options, description, category, is_featured) VALUES ($1, $2, $3, $4, true) ON CONFLICT DO NOTHING`,
        [p.q, JSON.stringify(p.opts), p.desc, p.cat]).catch(() => {});
    }
  }

  // Seed default quizzes
  const quizCount = (await pool.query('SELECT COUNT(*) FROM quizzes')).rows[0].count;
  if (parseInt(quizCount) === 0) {
    const ugQuiz = [
      { question: 'What is the capital of Uganda?', options: ['Kampala','Nairobi','Dar es Salaam','Kigali'], correct: 0 },
      { question: 'Which is the largest lake in Uganda?', options: ['Lake Victoria','Lake Albert','Lake Edward','Lake Kyoga'], correct: 0 },
      { question: 'What currency does Uganda use?', options: ['Ugandan Shilling','Kenyan Shilling','Tanzanian Shilling','US Dollar'], correct: 0 },
      { question: 'Who is the current President of Uganda?', options: ['Yoweri Museveni','Paul Kagame','William Ruto','Samia Suluhu'], correct: 0 },
      { question: 'Which mountain is the highest in Uganda?', options: ['Mount Rwenzori','Mount Elgon','Mount Kenya','Mount Kilimanjaro'], correct: 0 },
      { question: 'What is the official language of Uganda?', options: ['English','Swahili','Luganda','French'], correct: 0 },
      { question: 'How many districts does Uganda have?', options: ['135+','100','50','200+'], correct: 0 },
      { question: 'Which river flows through Uganda?', options: ['River Nile','River Congo','River Zambezi','River Niger'], correct: 0 },
    ];
    await pool.query(`INSERT INTO quizzes (title, questions, description, category, is_featured) VALUES ($1, $2, $3, $4, true)`,
      ['How Well Do You Know Uganda?', JSON.stringify(ugQuiz), 'Test your knowledge about the Pearl of Africa!', 'general']).catch(() => {});

    const bizQuiz = [
      { question: 'What does POS stand for?', options: ['Point of Sale','Price of Sale','Purchase on Sale','Point of Service'], correct: 0 },
      { question: 'What is a balance sheet?', options: ['Financial statement','Bank document','Invoice','Receipt'], correct: 0 },
      { question: 'What does ROI mean?', options: ['Return on Investment','Rate of Interest','Revenue of Income','Risk of Investment'], correct: 0 },
      { question: 'What is cash flow?', options: ['Money moving in/out','Total revenue','Profit','Savings'], correct: 0 },
      { question: 'What is a business plan?', options: ['Roadmap for business','Legal document','Tax form','Bank statement'], correct: 0 },
    ];
    await pool.query(`INSERT INTO quizzes (title, questions, description, category, is_featured) VALUES ($1, $2, $3, $4, true)`,
      ['Business Knowledge Quiz', JSON.stringify(bizQuiz), 'Test your business acumen!', 'business']).catch(() => {});
  }

  // Seed default countdown
  const cdCount = (await pool.query("SELECT COUNT(*) FROM viral_countdowns")).rows[0].count;
  if (parseInt(cdCount) === 0) {
    const targetDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    await pool.query(`INSERT INTO viral_countdowns (title, description, target_date, cta_text) VALUES ($1, $2, $3, $4)`,
      ['Something BIG is Coming!', 'We are building something amazing. Be the first to know when we launch.', targetDate, 'Join Waitlist']).catch(() => {});
  }

  // Seed testimonials
  const tCount = (await pool.query('SELECT COUNT(*) FROM testimonials')).rows[0].count;
  if (parseInt(tCount) === 0) {
    const defaultTestimonials = [
      { name: 'James Mugisha', title: 'Head Teacher', org: 'Sunrise Primary School', text: 'Comfort Zone has completely transformed how we manage our school. Fee collection is now automatic, parents get real-time updates, and we save hours every week on admin work. I cannot imagine going back to the old way.', rating: 5, country: 'Kampala, Uganda' },
      { name: 'Grace Nakamya', title: 'Business Owner', org: 'Nakamya Enterprises', text: 'The inventory management and POS features are incredible. I can now track all my stock, sales, and expenses from my phone. My business has grown 30% since I started using Comfort Zone.', rating: 5, country: 'Entebbe, Uganda' },
      { name: 'Pastor David Ochieng', title: 'Senior Pastor', org: 'Grace Community Church', text: 'Managing our church membership, tithes, and events was always a headache. Comfort Zone made it simple. Our congregation has grown and we can focus on ministry instead of paperwork.', rating: 5, country: 'Jinja, Uganda' },
      { name: 'Sarah Achieng', title: 'Hospital Administrator', org: 'Hope Medical Center', text: 'Patient records, appointments, and billing are now organized in one place. The sick bay feature helps us track visits by department. Highly recommended for any health facility.', rating: 5, country: 'Mbarara, Uganda' },
      { name: 'Robert Kalanzi', title: 'Director', org: 'Uganda Youth Foundation', text: 'As an NGO, we needed an affordable solution for project tracking, donor management, and reporting. Comfort Zone gives us everything we need at zero cost. It is a game-changer.', rating: 5, country: 'Gulu, Uganda' },
    ];
    for (const t of defaultTestimonials) {
      await pool.query(`INSERT INTO testimonials (user_name, user_title, organization, testimonial_text, rating, country, is_approved, is_featured) VALUES ($1,$2,$3,$4,$5,$6,true,true) ON CONFLICT DO NOTHING`,
        [t.name, t.title, t.org, t.text, t.rating, t.country]).catch(() => {});
    }
  }

  // Seed forum topics
  const fCount = (await pool.query('SELECT COUNT(*) FROM forum_topics')).rows[0].count;
  if (parseInt(fCount) === 0) {
    const defaultTopics = [
      { title: 'Welcome to the Comfort Zone Community!', body: 'Hello everyone! This is the official community forum for Comfort Zone users. Feel free to ask questions, share tips, suggest features, and connect with other users across Uganda and East Africa.\n\nSome guidelines:\n- Be respectful to other members\n- Share your experiences and knowledge\n- Ask questions — no question is too simple\n- Report bugs and suggest improvements\n\nLet us build this community together!', author: 'Comfort Zone Team', cat: 'general' },
      { title: 'Tips for Getting Started with Comfort Zone', body: 'Here are some tips for new users:\n\n1. Complete your profile setup — add your logo, colors, and organization details\n2. Start with core features first — students/members, fees/payments, reports\n3. Import your existing data using the import tool\n4. Set up notifications so you never miss important updates\n5. Explore the mobile-friendly interface\n\nWhat other tips would you add? Share your experience below!', author: 'Comfort Zone Team', cat: 'help' },
      { title: 'Feature Request: Mobile App', body: 'I would love to have a dedicated mobile app for Comfort Zone. The web version works great on mobile but a native app would be even better for push notifications and offline access.\n\nWho else would use a mobile app?', author: 'James M.', cat: 'feature_requests' },
    ];
    for (const t of defaultTopics) {
      await pool.query(`INSERT INTO forum_topics (title, body, category, author_name, is_pinned, last_reply_at) VALUES ($1,$2,$3,$4,$5,NOW())`,
        [t.title, t.body, t.cat, t.author, t.title.includes('Welcome')]).catch(() => {});
    }
  }

  console.log('[ViralGrowth] Default data seeded: polls, quizzes, testimonials, countdown, forum topics');
}

seedViralData().catch(e => console.warn('[ViralGrowth] Seed error:', e.message));
console.log('[ViralGrowth] LOADED: Polls, Quizzes, Testimonials, Community Forums, Viral Countdowns, User Stories, Feedback Widget, Invite Codes, Social Proof');
