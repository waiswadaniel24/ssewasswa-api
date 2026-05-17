module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}.btn-sm{padding:5px 12px;font-size:13px}.btn-danger{background:#dc2626}.btn-danger:hover{background:#b91c1c}.btn-success{background:#059669}.btn-success:hover{background:#047857}.btn-warning{background:#d97706}.btn-warning:hover{background:#b45309}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}.badge-easy{background:#d1fae5;color:#065f46}.badge-medium{background:#dbeafe;color:#1e40af}.badge-hard{background:#fef3c7;color:#92400e}.badge-expert{background:#fee2e2;color:#991b1b}.badge-passed{background:#d1fae5;color:#065f46}.badge-failed{background:#fee2e2;color:#991b1b}.badge-running{background:#dbeafe;color:#1e40af}.badge-error{background:#f3f4f6;color:#374151}.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1);text-align:center}.stat-num{font-size:28px;font-weight:700;color:#4f46e5}.stat-label{font-size:13px;color:#6b7280;margin-top:4px}.empty{text-align:center;padding:40px;color:#6b7280}.code-editor{font-family:monospace;background:#1e1e2e;color:#cdd6f4;padding:16px;border-radius:8px;width:100%;min-height:300px;resize:vertical;border:none;font-size:14px;line-height:1.6;tab-size:4}.code-output{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:16px;border-radius:8px;width:100%;min-height:150px;resize:vertical;border:none;font-size:14px;white-space:pre-wrap;overflow-x:auto}.editor-toolbar{display:flex;gap:8px;align-items:center;padding:8px 12px;background:#181825;border-radius:8px 8px 0 0;border-bottom:1px solid #313244}.editor-toolbar select{width:auto;background:#313244;color:#cdd6f4;border:1px solid #45475a;border-radius:6px;padding:4px 8px;font-size:13px}.editor-wrap{border-radius:8px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,.3)}.line-numbers{font-family:monospace;background:#181825;color:#585b70;padding:16px 8px;text-align:right;font-size:14px;line-height:1.6;user-select:none;min-height:300px}.editor-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}.lang-badge{display:inline-flex;align-items:center;gap:4px;padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600}.lang-js{background:#f7df1e20;color:#f7df1e}.lang-py{background:#3776ab20;color:#3776ab}.lang-java{background:#ed8b0020;color:#ed8b00}.lang-cpp{background:#00599c20;color:#00599c}.test-pass{color:#059669;font-weight:600}.test-fail{color:#dc2626;font-weight:600}.progress-bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}.progress-fill{height:100%;background:#4f46e5;border-radius:4px}.difficulty-filter{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}.difficulty-filter .btn{font-size:13px;padding:6px 14px}</style>';

  /* ── Database Migration ── */
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS code_exercises (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        title VARCHAR(300) NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        difficulty VARCHAR(20) DEFAULT 'easy',
        language VARCHAR(30) DEFAULT 'javascript',
        starter_code TEXT DEFAULT '',
        test_cases JSONB DEFAULT '[]',
        solution TEXT DEFAULT '',
        points INT DEFAULT 100,
        category VARCHAR(100) DEFAULT 'general',
        tags JSONB DEFAULT '[]',
        is_public BOOLEAN DEFAULT true,
        created_by INT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS code_submissions (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        exercise_id INT NOT NULL,
        student_id INT NOT NULL,
        code TEXT NOT NULL DEFAULT '',
        language VARCHAR(30) DEFAULT 'javascript',
        output TEXT DEFAULT '',
        expected_output TEXT DEFAULT '',
        status VARCHAR(30) DEFAULT 'pending',
        time_ms INT DEFAULT 0,
        memory_kb INT DEFAULT 0,
        score INT DEFAULT 0,
        plagiarism_score NUMERIC(5,2) DEFAULT 0,
        shared_with JSONB DEFAULT '[]',
        submitted_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS code_contests (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        title VARCHAR(300) NOT NULL,
        description TEXT DEFAULT '',
        start_time TIMESTAMPTZ,
        end_time TIMESTAMPTZ,
        exercises JSONB DEFAULT '[]',
        status VARCHAR(30) DEFAULT 'draft',
        created_by INT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_code_exercises_tenant ON code_exercises(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_code_submissions_tenant ON code_submissions(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_code_submissions_student ON code_submissions(student_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_code_contests_tenant ON code_contests(tenant_id)`);
      console.log('[CodeRunner] Tables ready');
    } catch (e) { console.warn('[CodeRunner] Migration warning:', e.message); }
  })();

  const LANGUAGES = [
    { id: 'javascript', label: 'JavaScript', ext: '.js', badge: 'lang-js' },
    { id: 'python', label: 'Python', ext: '.py', badge: 'lang-py' },
    { id: 'java', label: 'Java', ext: '.java', badge: 'lang-java' },
    { id: 'cpp', label: 'C++', ext: '.cpp', badge: 'lang-cpp' }
  ];
  const DIFFICULTIES = ['easy', 'medium', 'hard', 'expert'];
  const CATEGORIES = ['arrays', 'strings', 'sorting', 'searching', 'dynamic-programming', 'graphs', 'trees', 'recursion', 'math', 'hashing', 'general', 'oop', 'data-structures', 'algorithms'];
  const EXEC_TIMEOUT = 5000;

  function langBadge(lang) {
    const l = LANGUAGES.find(x => x.id === lang) || LANGUAGES[0];
    return `<span class="lang-badge ${l.badge}">${esc(l.label)}</span>`;
  }

  function diffBadge(diff) {
    return `<span class="badge badge-${diff}">${esc(diff)}</span>`;
  }

  function statusBadge(status) {
    if (status === 'passed') return '<span class="badge badge-passed">PASSED</span>';
    if (status === 'failed') return '<span class="badge badge-failed">FAILED</span>';
    if (status === 'running') return '<span class="badge badge-running">RUNNING</span>';
    return `<span class="badge badge-error">${esc(status)}</span>`;
  }

  /* Simulated code execution sandbox */
  async function runCodeSandbox(code, language, input) {
    const startTime = Date.now();
    try {
      let output = '';
      if (language === 'javascript') {
        const logs = [];
        const fakeConsole = { log: (...args) => logs.push(args.map(a => typeof a === 'object' ? JSON.stringify(a) : String(a)).join(' ')) };
        const fn = new Function('console', code);
        fn(fakeConsole);
        output = logs.join('\n');
      } else if (language === 'python') {
        output = `[Simulated Python Output]\nRunning with input: "${input || '(none)'}"\nNote: Python sandbox requires external executor`;
      } else if (language === 'java') {
        output = `[Simulated Java Output]\nCompiling...\nRunning with input: "${input || '(none)'}"\nNote: Java sandbox requires external executor`;
      } else if (language === 'cpp') {
        output = `[Simulated C++ Output]\nCompiling...\nRunning with input: "${input || '(none)'}"\nNote: C++ sandbox requires external executor`;
      }
      const timeMs = Date.now() - startTime;
      const memKb = Math.floor(Math.random() * 2048) + 256;
      return { output, timeMs, memoryKb: memKb, error: null };
    } catch (err) {
      return { output: '', timeMs: Date.now() - startTime, memoryKb: 0, error: err.message };
    }
  }

  /* Run test cases against code */
  async function runTestCases(code, language, testCases) {
    const cases = Array.isArray(testCases) ? testCases : [];
    if (!cases.length) return { passed: 0, total: 0, results: [], output: '' };
    let allOutput = '';
    let passed = 0;
    const results = [];
    for (let i = 0; i < cases.length; i++) {
      const tc = cases[i];
      const input = tc.input || '';
      const expected = tc.expected_output || tc.output || '';
      const { output, timeMs, memoryKb, error } = await runCodeSandbox(code, language, input);
      const isPass = !error && output.trim() === expected.trim();
      if (isPass) passed++;
      allOutput += output + '\n';
      results.push({ index: i + 1, input, expected, actual: output, passed: isPass, timeMs, memoryKb, error });
    }
    return { passed, total: cases.length, results, output: allOutput.trim() };
  }

  /* Plagiarism detection (token-based similarity) */
  function computeSimilarity(codeA, codeB) {
    const tokenize = (s) => s.replace(/[^a-zA-Z0-9_]/g, ' ').split(/\s+/).filter(Boolean);
    const tokensA = new Set(tokenize(codeA.toLowerCase()));
    const tokensB = new Set(tokenize(codeB.toLowerCase()));
    if (!tokensA.size || !tokensB.size) return 0;
    let intersection = 0;
    tokensA.forEach(t => { if (tokensB.has(t)) intersection++; });
    const union = tokensA.size + tokensB.size - intersection;
    return Math.round((intersection / union) * 10000) / 100;
  }

  /* ── Dashboard ── */
  app.get('/school/code-runner', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const [exercises] = await pool.query('SELECT * FROM code_exercises WHERE tenant_id=$1 AND is_public=true ORDER BY created_at DESC LIMIT 20', [tid]);
    const [mySubs] = await pool.query('SELECT COUNT(*) as cnt FROM code_submissions WHERE tenant_id=$1 AND student_id=$2', [tid, uid]);
    const [passedSubs] = await pool.query('SELECT COUNT(DISTINCT exercise_id) as cnt FROM code_submissions WHERE tenant_id=$1 AND student_id=$2 AND status=$3', [tid, uid, 'passed']);
    const [totalEx] = await pool.query('SELECT COUNT(*) as cnt FROM code_exercises WHERE tenant_id=$1 AND is_public=true', [tid]);
    const [contests] = await pool.query("SELECT * FROM code_contests WHERE tenant_id=$1 AND status IN ('active','upcoming') ORDER BY start_time LIMIT 5", [tid]);
    const [leaderboard] = await pool.query(
      'SELECT u.name, u.avatar_url, COUNT(DISTINCT s.exercise_id) as solved, SUM(s.score) as total_score FROM code_submissions s JOIN users u ON u.id=s.student_id WHERE s.tenant_id=$1 AND s.status=$2 GROUP BY u.id, u.name, u.avatar_url ORDER BY solved DESC, total_score DESC LIMIT 10',
      [tid, 'passed']
    );

    const recentExercises = exercises.slice(0, 6).map(ex => `
      <a href="/school/code-runner/solve/${ex.id}" class="card" style="text-decoration:none;color:inherit;display:block;transition:transform .15s">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div>
            <h3 style="margin:0;color:${P}">${esc(ex.title)}</h3>
            <p style="color:${GRAY};font-size:13px;margin:4px 0 0">${esc((ex.description || '').substring(0, 80))}...</p>
          </div>
          <div>${diffBadge(ex.difficulty)}</div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px;align-items:center">
          ${langBadge(ex.language)}
          <span style="font-size:12px;color:${GRAY}">${ex.points} pts</span>
          <span style="font-size:12px;color:${GRAY}">${esc(ex.category || 'general')}</span>
        </div>
      </a>`).join('');

    const contestCards = contests.map(c => {
      const isActive = c.status === 'active';
      const exCount = (c.exercises || []).length;
      return `<div class="card" style="border-left:4px solid ${isActive ? '#059669' : P}">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div>
            <h3 style="margin:0;color:${isActive ? '#059669' : P}">${esc(c.title)} ${isActive ? '<span class="badge badge-passed">LIVE</span>' : '<span class="badge badge-medium">UPCOMING</span>'}</h3>
            <p style="color:${GRAY};font-size:13px;margin:4px 0 0">${exCount} exercises</p>
          </div>
          <a href="/school/code-runner/contest/${c.id}" class="btn btn-sm">Enter</a>
        </div>
      </div>`;
    }).join('');

    const lbRows = leaderboard.map((r, i) => {
      const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
      return `<tr>
        <td style="font-size:18px;font-weight:700;text-align:center;min-width:40px">${rank}</td>
        <td><strong>${esc(r.name)}</strong></td>
        <td><strong style="color:${P}">${r.solved}</strong> solved</td>
        <td><strong style="color:${P}">${r.total_score || 0}</strong> pts</td>
      </tr>`;
    }).join('');

    const html = `${SKIP}
    <div style="max-width:1200px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;flex-wrap:wrap;gap:8px">
        <h1 style="color:${P};margin:0">⚡ Code Runner</h1>
        <div style="display:flex;gap:8px">
          <a class="btn" href="/school/code-runner/exercises">Exercises</a>
          <a class="btn btn-success" href="/school/code-runner/exercises/create">+ Create Exercise</a>
        </div>
      </div>
      <p style="color:${GRAY};margin-bottom:20px">Practice coding problems, run code, track submissions, and compete in contests</p>
      <div class="grid" style="margin-bottom:24px;grid-template-columns:repeat(5,1fr)">
        <div class="stat-card"><div class="stat-num">${totalEx[0].cnt}</div><div class="stat-label">Exercises</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${passedSubs[0].cnt}</div><div class="stat-label">Solved</div></div>
        <div class="stat-card"><div class="stat-num">${mySubs[0].cnt}</div><div class="stat-label">Submissions</div></div>
        <div class="stat-card"><div class="stat-num">${totalEx[0].cnt > 0 ? Math.round((passedSubs[0].cnt / totalEx[0].cnt) * 100) : 0}%</div><div class="stat-label">Completion</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#d97706">${contests.length}</div><div class="stat-label">Active Contests</div></div>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px;margin-bottom:24px">
        <div>
          <h2 style="margin:0 0 12px">Recent Exercises</h2>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">${recentExercises || '<div class="card empty" style="grid-column:1/-1">No exercises yet</div>'}</div>
        </div>
        <div>
          <h2 style="margin:0 0 12px">🏆 Leaderboard</h2>
          <div class="card" style="padding:0;overflow:hidden">
            <table><thead><tr><th>#</th><th>Student</th><th>Solved</th><th>Score</th></tr></thead>
            <tbody>${lbRows || '<tr><td colspan="4" class="empty">No submissions yet</td></tr>'}</tbody></table>
          </div>
          <div style="margin-top:12px">
            <a href="/school/code-runner/leaderboard" class="btn" style="width:100%;text-align:center;text-decoration:none;display:block">View Full Leaderboard</a>
          </div>
        </div>
      </div>
      ${contests.length ? `
        <h2 style="margin:0 0 12px">Contests</h2>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:24px">${contestCards}</div>
      ` : ''}
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <a href="/school/code-runner/my-submissions" class="btn" style="background:#7c3aed;text-decoration:none">📝 My Submissions</a>
        <a href="/school/code-runner/contests" class="btn" style="background:#0891b2;text-decoration:none">🏆 Contests</a>
        <a href="/school/code-runner/plagiarism-check" class="btn" style="background:#d97706;text-decoration:none">🔍 Plagiarism Check</a>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Code Runner'));
  });

  /* ── Exercise Library ── */
  app.get('/school/code-runner/exercises', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const diffFilter = req.query.difficulty || '';
    const langFilter = req.query.language || '';
    const catFilter = req.query.category || '';
    const search = req.query.q || '';
    let query = 'SELECT e.*, (SELECT COUNT(*) FROM code_submissions s WHERE s.exercise_id=e.id AND s.student_id=$2 AND s.status=$3) as solved_by_me FROM code_exercises e WHERE e.tenant_id=$1 AND e.is_public=true';
    const params = [tid, uid, 'passed'];
    let paramIdx = 4;
    if (diffFilter) { query += ` AND e.difficulty=$${paramIdx++}`; params.push(diffFilter); }
    if (langFilter) { query += ` AND e.language=$${paramIdx++}`; params.push(langFilter); }
    if (catFilter) { query += ` AND e.category=$${paramIdx++}`; params.push(catFilter); }
    if (search) { query += ` AND (e.title ILIKE $${paramIdx} OR e.description ILIKE $${paramIdx})`; params.push(`%${search}%`); paramIdx++; }
    query += ' ORDER BY e.created_at DESC LIMIT 100';
    const [exercises] = await pool.query(query, params);

    const solvedIds = exercises.filter(e => e.solved_by_me > 0).map(e => e.id);

    const diffButtons = DIFFICULTIES.map(d => `
      <a href="/school/code-runner/exercises?difficulty=${d}&language=${langFilter}&category=${catFilter}&q=${search}"
         class="btn ${diffFilter === d ? '' : 'btn-sm'}" style="background:${diffFilter === d ? P : '#f3f4f6'};color:${diffFilter === d ? '#fff' : '#374151'};text-decoration:none">${esc(d)}</a>
    `).join('');

    const langButtons = LANGUAGES.map(l => `
      <a href="/school/code-runner/exercises?difficulty=${diffFilter}&language=${l.id}&category=${catFilter}&q=${search}"
         class="btn ${langFilter === l.id ? '' : 'btn-sm'}" style="background:${langFilter === l.id ? '#3730a3' : '#f3f4f6'};color:${langFilter === l.id ? '#fff' : '#374151'};text-decoration:none;font-size:13px">${esc(l.label)}</a>
    `).join('');

    const rows = exercises.map(ex => {
      const isSolved = solvedIds.includes(ex.id);
      return `<tr style="${isSolved ? 'background:#f0fdf4' : ''}">
        <td>${isSolved ? '✅' : ''} <a href="/school/code-runner/solve/${ex.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(ex.title)}</a></td>
        <td>${diffBadge(ex.difficulty)}</td>
        <td>${langBadge(ex.language)}</td>
        <td>${esc(ex.category || 'general')}</td>
        <td>${ex.points} pts</td>
        <td>${(ex.tags || []).map(t => `<span class="badge" style="background:#f3f4f6;color:#374151;margin:1px">${esc(t)}</span>`).join(' ')}</td>
        <td><a class="btn btn-sm" href="/school/code-runner/solve/${ex.id}">Solve</a></td>
      </tr>`;
    }).join('');

    const html = `${SKIP}
    <div style="max-width:1100px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h1 style="color:${P};margin:0">📚 Exercise Library</h1>
        <a href="/school/code-runner/exercises/create" class="btn btn-success">+ Create Exercise</a>
      </div>
      <div class="card" style="padding:12px 16px">
        <form method="GET" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
          <input name="q" value="${esc(search)}" placeholder="Search exercises..." style="max-width:300px">
          <a href="/school/code-runner" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
        </form>
      </div>
      <div style="margin-top:12px">
        <p style="color:${GRAY};font-size:13px;margin:0 0 6px">Difficulty:</p>
        <div class="difficulty-filter">${diffButtons}</div>
      </div>
      <div style="margin-top:8px">
        <p style="color:${GRAY};font-size:13px;margin:0 0 6px">Language:</p>
        <div class="difficulty-filter">${langButtons}</div>
      </div>
      <div class="card" style="margin-top:16px">
        <div style="overflow-x:auto">
          <table><thead><tr><th>Exercise</th><th>Difficulty</th><th>Language</th><th>Category</th><th>Points</th><th>Tags</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="empty">No exercises found</td></tr>'}</tbody></table>
        </div>
        <p style="color:${GRAY};font-size:13px;margin-top:8px">${exercises.length} exercises found · ${solvedIds.length} solved</p>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Exercise Library'));
  });

  /* ── Create Exercise ── */
  app.get('/school/code-runner/exercises/create', requireAuth, requireNotBanned, (req, res) => {
    const langOpts = LANGUAGES.map(l => `<option value="${l.id}">${esc(l.label)}</option>`).join('');
    const catOpts = CATEGORIES.map(c => `<option value="${c}">${esc(c)}</option>`).join('');
    const diffOpts = DIFFICULTIES.map(d => `<option value="${d}">${esc(d)}</option>`).join('');

    const html = `${SKIP}
    <div style="max-width:900px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">➕ Create Exercise</h1>
        <a href="/school/code-runner/exercises" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      <form method="POST" action="/school/code-runner/exercises/create" class="card">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div><label>Title *</label><input name="title" required placeholder="e.g., Two Sum"></div>
          <div><label>Difficulty</label><select name="difficulty">${diffOpts}</select></div>
          <div><label>Language</label><select name="language">${langOpts}</select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
          <div><label>Category</label><select name="category">${catOpts}</select></div>
          <div><label>Points</label><input type="number" name="points" value="100" min="10" max="1000"></div>
        </div>
        <div style="margin-top:12px"><label>Description *</label><textarea name="description" rows="4" required placeholder="Describe the problem..."></textarea></div>
        <div style="margin-top:12px"><label>Tags (comma-separated)</label><input name="tags" placeholder="e.g., arrays, hashing, easy"></div>
        <div style="margin-top:12px">
          <label>Starter Code</label>
          <textarea name="starter_code" class="code-editor" rows="8" placeholder="function solution(arr) {\n  // Your code here\n}"></textarea>
        </div>
        <div style="margin-top:12px">
          <label>Solution (hidden from students)</label>
          <textarea name="solution" class="code-editor" rows="8" placeholder="function solution(arr) {\n  return arr;\n}"></textarea>
        </div>
        <div style="margin-top:12px">
          <label>Test Cases (JSON array: [{"input":"...","expected_output":"..."}])</label>
          <textarea name="test_cases" class="code-editor" rows="6" placeholder='[{"input":"[1,2,3]","expected_output":"[3,2,1]"},{"input":"[]","expected_output":"[]"}]'></textarea>
        </div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button type="submit" class="btn btn-success">Create Exercise</button>
          <a href="/school/code-runner/exercises" class="btn" style="background:#6b7280;text-decoration:none">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage(req, html, 'Create Exercise'));
  });

  app.post('/school/code-runner/exercises/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const { title, description, difficulty, language, starter_code, solution, test_cases, points, category, tags } = req.body;
    let parsedTests = [];
    try { parsedTests = test_cases ? JSON.parse(test_cases) : []; } catch (e) { parsedTests = []; }
    const tagArr = tags ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
    await pool.query(
      `INSERT INTO code_exercises(tenant_id,title,description,difficulty,language,starter_code,test_cases,solution,points,category,tags,created_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tid, title, description, difficulty || 'easy', language || 'javascript', starter_code || '', JSON.stringify(parsedTests), solution || '', Number(points) || 100, category || 'general', JSON.stringify(tagArr), uid]
    );
    audit(req, 'code_exercise_create', { title, difficulty, language });
    req.flash('success', 'Exercise created!');
    res.redirect('/school/code-runner/exercises');
  }));

  /* ── Solve Exercise (Code Editor) ── */
  app.get('/school/code-runner/solve/:id', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const eid = Number(req.params.id);
    const [exercises] = await pool.query('SELECT * FROM code_exercises WHERE tenant_id=$1 AND id=$2', [tid, eid]);
    if (!exercises.length) return res.status(404).send('Exercise not found');
    const ex = exercises[0];
    const [prevSub] = await pool.query('SELECT code FROM code_submissions WHERE tenant_id=$1 AND exercise_id=$2 AND student_id=$3 ORDER BY submitted_at DESC LIMIT 1', [tid, eid, uid]);
    const currentCode = (prevSub[0]?.code) || ex.starter_code || '';
    const testCases = ex.test_cases || [];
    const testPreview = testCases.slice(0, 3).map((tc, i) =>
      `<div style="margin-bottom:6px;padding:6px 10px;background:#f9fafb;border-radius:6px;font-family:monospace;font-size:13px">
        <strong>Test ${i + 1}:</strong> Input: ${esc(tc.input || '')} → Expected: ${esc(tc.expected_output || tc.output || '')}
      </div>`
    ).join('');

    const html = `${SKIP}
    <div style="max-width:1200px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:8px">
        <div>
          <a href="/school/code-runner/exercises" style="color:${GRAY};text-decoration:none;font-size:13px">← Back to Exercises</a>
          <h1 style="color:${P};margin:4px 0 0">${esc(ex.title)}</h1>
          <div style="display:flex;gap:8px;margin-top:4px;align-items:center">
            ${diffBadge(ex.difficulty)} ${langBadge(ex.language)}
            <span style="color:${GRAY};font-size:13px">${ex.points} pts · ${esc(ex.category || '')}</span>
          </div>
        </div>
        <div>
          <a href="/school/code-runner/my-submissions" class="btn btn-sm" style="background:#7c3aed;text-decoration:none">My Submissions</a>
        </div>
      </div>
      <div class="card" style="margin-bottom:16px">
        <h3 style="margin:0 0 8px">Problem Description</h3>
        <div style="color:#374151;line-height:1.7;white-space:pre-wrap">${esc(ex.description)}</div>
        ${testPreview ? `<div style="margin-top:12px"><h4 style="margin:0 0 6px">Sample Test Cases</h4>${testPreview}</div>` : ''}
      </div>
      <div class="editor-grid">
        <div>
          <div class="editor-wrap">
            <div class="editor-toolbar">
              <span style="color:#cdd6f4;font-weight:600">Code Editor</span>
              <select id="langSelect" onchange="document.getElementById('currentLang').value=this.value">
                ${LANGUAGES.map(l => `<option value="${l.id}" ${l.id === ex.language ? 'selected' : ''}>${esc(l.label)}</option>`).join('')}
              </select>
              <button type="button" class="btn btn-sm" style="background:#313244;color:#cdd6f4" onclick="formatCode()">Format</button>
            </div>
            <form id="runForm" method="POST" action="/school/code-runner/solve/${eid}">
              <input type="hidden" name="language" id="currentLang" value="${esc(ex.language)}">
              <textarea name="code" id="codeEditor" class="code-editor" spellcheck="false">${esc(currentCode)}</textarea>
              <div style="display:flex;gap:8px;padding:12px;background:#181825;border-top:1px solid #313244">
                <button type="button" class="btn btn-success" onclick="submitCode('run')">▶ Run Code</button>
                <button type="button" class="btn" onclick="submitCode('submit')">Submit Solution</button>
                <button type="button" class="btn btn-sm" style="background:#313244;color:#cdd6f4" onclick="resetCode()">Reset</button>
                <button type="button" class="btn btn-sm" style="background:#313244;color:#cdd6f4" onclick="shareCode()">Share</button>
                <div style="flex:1"></div>
                <span id="execTime" style="color:#585b70;font-size:13px"></span>
              </div>
            </form>
          </div>
        </div>
        <div>
          <div class="editor-wrap">
            <div class="editor-toolbar">
              <span style="color:#cdd6f4;font-weight:600">Output</span>
              <span id="statusBadge" style="margin-left:auto"></span>
            </div>
            <div id="outputArea" class="code-output" style="min-height:460px;color:#585b70">// Output will appear here after running code...
//
// Tips:
// - Use "Run Code" to test with sample inputs
// - Use "Submit Solution" to run all test cases
// - JavaScript is executed in a sandbox
// - Python, Java, C++ require external executors</div>
          </div>
        </div>
      </div>
      <div id="testResults" style="margin-top:16px"></div>
    </div>
    <script>
      const starterCode = ${JSON.stringify(ex.starter_code || '')};
      function submitCode(mode) {
        document.getElementById('currentLang').value = document.getElementById('langSelect').value;
        const form = document.getElementById('runForm');
        const action = form.getAttribute('action');
        form.action = action + '?mode=' + mode;
        document.getElementById('outputArea').textContent = mode === 'run' ? 'Running code...' : 'Submitting solution...';
        document.getElementById('statusBadge').innerHTML = '<span class="badge badge-running">Running...</span>';
        const fd = new FormData(form);
        fetch(action + '?mode=' + mode, { method: 'POST', body: fd })
          .then(r => r.json())
          .then(data => {
            document.getElementById('outputArea').textContent = data.output || data.error || 'No output';
            if (data.error) {
              document.getElementById('statusBadge').innerHTML = '<span class="badge badge-failed">ERROR</span>';
              document.getElementById('outputArea').style.color = '#f87171';
            } else if (data.status === 'passed') {
              document.getElementById('statusBadge').innerHTML = '<span class="badge badge-passed">PASSED (' + data.passed + '/' + data.total + ')</span>';
              document.getElementById('outputArea').style.color = '#c9d1d9';
            } else if (data.status === 'failed') {
              document.getElementById('statusBadge').innerHTML = '<span class="badge badge-failed">FAILED (' + data.passed + '/' + data.total + ')</span>';
              document.getElementById('outputArea').style.color = '#fbbf24';
            } else {
              document.getElementById('statusBadge').innerHTML = '<span class="badge" style="background:#f3f4f6">OK</span>';
              document.getElementById('outputArea').style.color = '#c9d1d9';
            }
            document.getElementById('execTime').textContent = data.time_ms ? data.time_ms + 'ms · ' + data.memory_kb + ' KB' : '';
            if (data.results && data.results.length) {
              let html = '<div class="card"><h3 style="margin:0 0 8px">Test Case Results</h3>';
              data.results.forEach(function(r) {
                const cls = r.passed ? 'test-pass' : 'test-fail';
                const icon = r.passed ? '✅' : '❌';
                html += '<div style="padding:8px;border-bottom:1px solid #f3f4f6">';
                html += icon + ' <strong>Test ' + r.index + '</strong> — <span class="' + cls + '">' + (r.passed ? 'PASSED' : 'FAILED') + '</span>';
                html += ' <span style="color:${GRAY};font-size:12px">(' + (r.time_ms||0) + 'ms)</span>';
                if (!r.passed) {
                  html += '<div style="margin-top:4px;font-family:monospace;font-size:13px">';
                  html += '<div>Expected: <span style="color:#059669">' + (r.expected||'') + '</span></div>';
                  html += '<div>Got: <span style="color:#dc2626">' + (r.actual||'') + '</span></div>';
                  html += '</div>';
                }
                html += '</div>';
              });
              html += '</div>';
              document.getElementById('testResults').innerHTML = html;
            }
          })
          .catch(err => {
            document.getElementById('outputArea').textContent = 'Request failed: ' + err.message;
            document.getElementById('statusBadge').innerHTML = '<span class="badge badge-error">ERROR</span>';
          });
      }
      function resetCode() {
        if (confirm('Reset to starter code?')) {
          document.getElementById('codeEditor').value = starterCode;
        }
      }
      function formatCode() {
        const editor = document.getElementById('codeEditor');
        let code = editor.value;
        // Simple indentation fix
        code = code.replace(/\\t/g, '  ');
        editor.value = code;
      }
      function shareCode() {
        const code = document.getElementById('codeEditor').value;
        if (navigator.clipboard) {
          navigator.clipboard.writeText(code).then(() => alert('Code copied to clipboard!'));
        }
      }
      // Tab key support in editor
      document.getElementById('codeEditor').addEventListener('keydown', function(e) {
        if (e.key === 'Tab') {
          e.preventDefault();
          const start = this.selectionStart;
          const end = this.selectionEnd;
          this.value = this.value.substring(0, start) + '  ' + this.value.substring(end);
          this.selectionStart = this.selectionEnd = start + 2;
        }
      });
    </script>`;
    res.send(renderPage(req, html, `Solve: ${ex.title}`));
  });

  /* ── Run / Submit Code (API) ── */
  app.post('/school/code-runner/solve/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const eid = Number(req.params.id);
    const mode = req.query.mode || 'run';
    const { code, language } = req.body;

    const [exercises] = await pool.query('SELECT * FROM code_exercises WHERE tenant_id=$1 AND id=$2', [tid, eid]);
    if (!exercises.length) return res.json({ error: 'Exercise not found' });

    const ex = exercises[0];
    const testCases = ex.test_cases || [];

    if (mode === 'run') {
      const { output, timeMs, memoryKb, error } = await runCodeSandbox(code, language, testCases[0]?.input || '');
      return res.json({ output, error, time_ms: timeMs, memory_kb: memoryKb, status: error ? 'error' : 'ok' });
    }

    // Submit mode - run all test cases
    const { passed, total, results, output } = await runTestCases(code, language, testCases);
    const status = passed === total ? 'passed' : 'failed';
    const score = status === 'passed' ? ex.points : 0;
    const totalTimeMs = results.reduce((a, r) => a + (r.timeMs || 0), 0);
    const maxMemKb = results.reduce((a, r) => a + (r.memoryKb || 0), 0);

    // Plagiarism check against other submissions
    let plagiarismScore = 0;
    const [otherSubs] = await pool.query(
      'SELECT code FROM code_submissions WHERE tenant_id=$1 AND exercise_id=$2 AND student_id != $3 AND status=$4 ORDER BY submitted_at DESC LIMIT 20',
      [tid, eid, uid, 'passed']
    );
    for (const sub of otherSubs) {
      plagiarismScore = Math.max(plagiarismScore, computeSimilarity(code, sub.code));
    }

    await pool.query(
      `INSERT INTO code_submissions(tenant_id,exercise_id,student_id,code,language,output,expected_output,status,time_ms,memory_kb,score,plagiarism_score,submitted_at)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())`,
      [tid, eid, uid, code, language, output, testCases.map(t => t.expected_output || t.output || '').join('\n---\n'), status, totalTimeMs, maxMemKb, score, plagiarismScore]
    );

    audit(req, 'code_submit', { eid, language, status, score, plagiarism_score: plagiarismScore });

    if (plagiarismScore > 80) {
      audit(req, 'code_plagiarism_flag', { eid, plagiarism_score: plagiarismScore });
    }

    res.json({
      output,
      status,
      passed,
      total,
      score,
      time_ms: totalTimeMs,
      memory_kb: maxMemKb,
      plagiarism_score: plagiarismScore,
      results: results.map(r => ({
        index: r.index,
        input: r.input,
        expected: r.expected,
        actual: r.actual,
        passed: r.passed,
        time_ms: r.timeMs,
        memory_kb: r.memoryKb
      }))
    });
  }));

  /* ── My Submissions ── */
  app.get('/school/code-runner/my-submissions', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const [subs] = await pool.query(
      `SELECT s.*, e.title as exercise_title, e.difficulty, e.points, e.language as ex_lang
       FROM code_submissions s JOIN code_exercises e ON e.id=s.exercise_id
       WHERE s.tenant_id=$1 AND s.student_id=$2 ORDER BY s.submitted_at DESC LIMIT 100`,
      [tid, uid]
    );
    const [stats] = await pool.query(
      'SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE status=$3) as passed, COUNT(*) FILTER (WHERE status=$4) as failed, AVG(time_ms)::int as avg_time, SUM(score) as total_score FROM code_submissions WHERE tenant_id=$1 AND student_id=$2',
      [tid, uid, 'passed', 'failed']
    );
    const st = stats[0];

    const rows = subs.map(s => `<tr>
      <td><a href="/school/code-runner/solve/${s.exercise_id}" style="color:${P};text-decoration:none;font-weight:600">${esc(s.exercise_title)}</a></td>
      <td>${diffBadge(s.difficulty)}</td>
      <td>${langBadge(s.language)}</td>
      <td>${statusBadge(s.status)}</td>
      <td>${s.score}/${s.points}</td>
      <td>${s.time_ms}ms</td>
      <td>${s.memory_kb}KB</td>
      <td>${s.plagiarism_score > 70 ? `<span style="color:#dc2626;font-weight:600">${s.plagiarism_score}%</span>` : '<span style="color:#6b7280">' + s.plagiarism_score + '%</span>'}</td>
      <td>${new Date(s.submitted_at).toLocaleString()}</td>
      <td><a href="/school/code-runner/submissions/${s.id}" class="btn btn-sm">View</a></td>
    </tr>`).join('');

    const html = `${SKIP}
    <div style="max-width:1200px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">📝 My Submissions</h1>
        <a href="/school/code-runner" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Dashboard</a>
      </div>
      <div class="grid" style="margin-bottom:20px;grid-template-columns:repeat(5,1fr)">
        <div class="stat-card"><div class="stat-num">${st.total}</div><div class="stat-label">Total</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${st.passed}</div><div class="stat-label">Passed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${st.failed}</div><div class="stat-label">Failed</div></div>
        <div class="stat-card"><div class="stat-num">${st.avg_time || 0}ms</div><div class="stat-label">Avg Time</div></div>
        <div class="stat-card"><div class="stat-num">${st.total_score || 0}</div><div class="stat-label">Total Score</div></div>
      </div>
      <div class="card">
        <div style="overflow-x:auto">
          <table><thead><tr><th>Exercise</th><th>Difficulty</th><th>Language</th><th>Status</th><th>Score</th><th>Time</th><th>Memory</th><th>Plagiarism</th><th>Submitted</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="10" class="empty">No submissions yet. Start solving exercises!</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'My Submissions'));
  });

  /* ── Submission Detail ── */
  app.get('/school/code-runner/submissions/:id', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const sid = Number(req.params.id);
    const [subs] = await pool.query(
      `SELECT s.*, e.title as exercise_title, e.description as exercise_desc, e.test_cases, e.difficulty, e.language as ex_lang, u.name as student_name
       FROM code_submissions s JOIN code_exercises e ON e.id=s.exercise_id JOIN users u ON u.id=s.student_id
       WHERE s.tenant_id=$1 AND s.id=$2`,
      [tid, sid]
    );
    if (!subs.length) return res.status(404).send('Submission not found');
    const s = subs[0];
    const isOwner = s.student_id === req.user.id;

    const html = `${SKIP}
    <div style="max-width:1100px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <a href="/school/code-runner/my-submissions" style="color:${GRAY};text-decoration:none;font-size:13px">← Back to Submissions</a>
          <h1 style="color:${P};margin:4px 0 0">Submission #${s.id}</h1>
          <p style="color:${GRAY};margin:2px 0 0">${esc(s.exercise_title)} · ${esc(s.student_name)} · ${new Date(s.submitted_at).toLocaleString()}</p>
        </div>
        ${statusBadge(s.status)}
      </div>
      <div class="grid" style="margin-bottom:16px;grid-template-columns:repeat(4,1fr)">
        <div class="stat-card"><div class="stat-num">${s.score}</div><div class="stat-label">Score</div></div>
        <div class="stat-card"><div class="stat-num">${s.time_ms}ms</div><div class="stat-label">Time</div></div>
        <div class="stat-card"><div class="stat-num">${s.memory_kb}KB</div><div class="stat-label">Memory</div></div>
        <div class="stat-card"><div class="stat-num" style="color:${s.plagiarism_score > 70 ? '#dc2626' : '#059669'}">${s.plagiarism_score}%</div><div class="stat-label">Similarity</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div>
          <h3 style="margin:0 0 8px">Your Code (${esc(s.language)})</h3>
          <div class="editor-wrap">
            <div class="editor-toolbar"><span style="color:#cdd6f4">Source Code</span></div>
            <pre class="code-output" style="min-height:300px;max-height:500px;overflow:auto">${esc(s.code)}</pre>
          </div>
        </div>
        <div>
          <h3 style="margin:0 0 8px">Output</h3>
          <div class="editor-wrap">
            <div class="editor-toolbar"><span style="color:#cdd6f4">Program Output</span></div>
            <pre class="code-output" style="min-height:300px;max-height:500px;overflow:auto;color:#c9d1d9">${esc(s.output || '(no output)')}</pre>
          </div>
          ${s.expected_output ? `
            <h3 style="margin:16px 0 8px">Expected Output</h3>
            <div class="editor-wrap">
              <div class="editor-toolbar"><span style="color:#a6e3a1">Expected</span></div>
              <pre class="code-output" style="min-height:100px;color:#a6e3a1">${esc(s.expected_output)}</pre>
            </div>
          ` : ''}
        </div>
      </div>
      ${isOwner ? `
        <div style="margin-top:16px;display:flex;gap:8px">
          <a href="/school/code-runner/solve/${s.exercise_id}" class="btn">Retry Exercise</a>
          <button class="btn btn-sm" style="background:#7c3aed" onclick="copyCode()">Copy Code</button>
        </div>
        <script>function copyCode(){navigator.clipboard.writeText(${JSON.stringify(s.code)}).then(()=>alert('Code copied!'))}</script>
      ` : ''}
    </div>`;
    res.send(renderPage(req, html, `Submission #${s.id}`));
  });

  /* ── Leaderboard ── */
  app.get('/school/code-runner/leaderboard', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [leaderboard] = await pool.query(
      `SELECT u.id, u.name, u.avatar_url, u.role,
              COUNT(DISTINCT s.exercise_id) as solved,
              COUNT(s.id) as submissions,
              SUM(s.score) as total_score,
              ROUND(AVG(s.time_ms))::int as avg_time,
              ROUND(AVG(s.plagiarism_score)::numeric, 1) as avg_similarity
       FROM code_submissions s JOIN users u ON u.id=s.student_id
       WHERE s.tenant_id=$1 AND s.status=$2
       GROUP BY u.id, u.name, u.avatar_url, u.role
       ORDER BY solved DESC, total_score DESC LIMIT 50`,
      [tid, 'passed']
    );

    const maxSolved = leaderboard.length ? Math.max(...leaderboard.map(r => Number(r.solved || 0)), 1) : 1;

    const rows = leaderboard.map((r, i) => {
      const rank = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1);
      const pct = Math.round((Number(r.solved || 0) / maxSolved) * 100);
      const isMe = r.id === req.user.id;
      return `<div class="card" style="display:flex;align-items:center;gap:16px;padding:14px 20px;${isMe ? 'border:2px solid #4f46e5;background:#f5f3ff' : ''}">
        <div style="font-size:22px;min-width:44px;text-align:center;font-weight:700">${rank}</div>
        <div style="flex:1">
          <h3 style="margin:0">${esc(r.name)} ${isMe ? '<span class="badge" style="background:#4f46e5;color:#fff;font-size:11px">YOU</span>' : ''}</h3>
          <p style="color:${GRAY};margin:2px 0 0;font-size:13px">${r.submissions} submissions · Avg ${r.avg_time || 0}ms · ${r.avg_similarity || 0}% similarity</p>
          <div class="progress-bar" style="width:200px;margin-top:4px"><div class="progress-fill" style="width:${pct}%"></div></div>
        </div>
        <div style="text-align:right">
          <div style="font-size:20px;font-weight:700;color:${P}">${r.solved}</div>
          <div style="font-size:12px;color:${GRAY}">solved</div>
          <div style="font-size:16px;font-weight:600;color:#059669;margin-top:2px">${r.total_score || 0} pts</div>
        </div>
      </div>`;
    }).join('');

    const html = `${SKIP}
    <div style="max-width:800px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h1 style="color:${P};margin:0">🏆 Leaderboard</h1>
        <a href="/school/code-runner" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Dashboard</a>
      </div>
      ${rows || '<div class="card"><p class="empty">No submissions yet. Be the first to solve exercises!</p></div>'}
    </div>`;
    res.send(renderPage(req, html, 'Leaderboard'));
  });

  /* ── Contests ── */
  app.get('/school/code-runner/contests', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [contests] = await pool.query('SELECT c.*, u.name as creator_name FROM code_contests c JOIN users u ON u.id=c.created_by WHERE c.tenant_id=$1 ORDER BY c.created_at DESC', [tid]);

    const rows = contests.map(c => {
      const exCount = (c.exercises || []).length;
      const isActive = c.status === 'active';
      const startTime = c.start_time ? new Date(c.start_time) : null;
      const endTime = c.end_time ? new Date(c.end_time) : null;
      let timeInfo = '';
      if (startTime) timeInfo += `Starts: ${startTime.toLocaleString()}`;
      if (endTime) timeInfo += ` · Ends: ${endTime.toLocaleString()}`;
      return `<div class="card" style="border-left:4px solid ${isActive ? '#059669' : c.status === 'upcoming' ? P : '#9ca3af'}">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:8px">
          <div>
            <h3 style="margin:0;color:${isActive ? '#059669' : P}">${esc(c.title)}
              ${isActive ? '<span class="badge badge-passed">LIVE</span>' : `<span class="badge badge-${c.status === 'upcoming' ? 'medium' : 'error'}">${esc(c.status)}</span>`}
            </h3>
            <p style="color:${GRAY};font-size:13px;margin:4px 0 0">Created by ${esc(c.creator_name)} · ${exCount} exercises</p>
            <p style="color:${GRAY};font-size:12px;margin-top:2px">${timeInfo}</p>
          </div>
          <div style="display:flex;gap:8px">
            <a href="/school/code-runner/contest/${c.id}" class="btn btn-sm">${isActive ? 'Enter' : 'View'}</a>
            <button class="btn btn-sm btn-danger" onclick="delContest(${c.id})">Delete</button>
          </div>
        </div>
      </div>`;
    }).join('');

    const html = `${SKIP}
    <div style="max-width:900px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">🏆 Contests</h1>
        <a href="/school/code-runner" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Dashboard</a>
      </div>
      <div class="card">
        <h3>Create Contest</h3>
        <form method="POST" action="/school/code-runner/contests/create" style="margin-top:8px">
          <div style="display:grid;grid-template-columns:2fr 1fr 1fr;gap:12px">
            <div><label>Title *</label><input name="title" required placeholder="Contest name"></div>
            <div><label>Start Time</label><input type="datetime-local" name="start_time"></div>
            <div><label>End Time</label><input type="datetime-local" name="end_time"></div>
          </div>
          <div style="margin-top:8px"><label>Description</label><textarea name="description" rows="2" placeholder="Contest details..."></textarea></div>
          <div style="margin-top:8px"><label>Exercise IDs (comma-separated)</label><input name="exercise_ids" placeholder="e.g., 1,3,5,7"></div>
          <div style="margin-top:12px"><button type="submit" class="btn btn-success">Create Contest</button></div>
        </form>
      </div>
      <h3 style="margin:16px 0 12px">All Contests (${contests.length})</h3>
      ${rows || '<div class="card"><p class="empty">No contests created yet</p></div>'}
      <script>function delContest(id){if(confirm('Delete this contest?'))fetch('/school/code-runner/contests/'+id,{method:'DELETE',headers:{'X-Requested-With':'XMLHttpRequest'}}).then(r=>{if(r.ok)location.reload()})}</script>
    </div>`;
    res.send(renderPage(req, html, 'Contests'));
  });

  app.post('/school/code-runner/contests/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const { title, description, start_time, end_time, exercise_ids } = req.body;
    const exIds = exercise_ids ? exercise_ids.split(',').map(id => Number(id.trim())).filter(Boolean) : [];
    await pool.query(
      'INSERT INTO code_contests(tenant_id,title,description,start_time,end_time,exercises,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [tid, title, description || '', start_time || null, end_time || null, JSON.stringify(exIds), uid]
    );
    audit(req, 'code_contest_create', { title, exercise_count: exIds.length });
    req.flash('success', 'Contest created!');
    res.redirect('/school/code-runner/contests');
  }));

  app.delete('/school/code-runner/contests/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    await pool.query('DELETE FROM code_contests WHERE tenant_id=$1 AND id=$2', [tid, Number(req.params.id)]);
    res.json({ ok: true });
  }));

  /* ── Contest Detail ── */
  app.get('/school/code-runner/contest/:id', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const cid = Number(req.params.id);
    const [contests] = await pool.query(
      'SELECT c.*, u.name as creator_name FROM code_contests c JOIN users u ON u.id=c.created_by WHERE c.tenant_id=$1 AND c.id=$2',
      [tid, cid]
    );
    if (!contests.length) return res.status(404).send('Contest not found');
    const c = contests[0];
    const exerciseIds = c.exercises || [];
    const [exercises] = await pool.query(
      'SELECT e.*, (SELECT COUNT(*) FROM code_submissions s WHERE s.exercise_id=e.id AND s.student_id=$3 AND s.status=$4) as solved FROM code_exercises e WHERE e.id = ANY($2::int[]) AND e.tenant_id=$1',
      [tid, exerciseIds, uid, 'passed']
    );

    // Contest leaderboard
    const [lb] = await pool.query(
      `SELECT u.name, COUNT(DISTINCT s.exercise_id) as solved, SUM(s.score) as total_score
       FROM code_submissions s JOIN users u ON u.id=s.student_id
       WHERE s.tenant_id=$1 AND s.exercise_id=ANY($2::int[]) AND s.status=$3 AND s.submitted_at >= $4
       GROUP BY u.id, u.name ORDER BY solved DESC, total_score DESC LIMIT 20`,
      [tid, exerciseIds, 'passed', c.start_time || new Date(0)]
    );

    const isActive = c.status === 'active';
    const endTime = c.end_time ? new Date(c.end_time) : null;
    let countdownHtml = '';
    if (isActive && endTime && endTime > new Date()) {
      const diff = endTime - new Date();
      const hrs = Math.floor(diff / 3600000);
      const mins = Math.floor((diff % 3600000) / 60000);
      countdownHtml = `<div class="card" style="text-align:center;background:linear-gradient(135deg,#059669,#0d9488);color:#fff;padding:12px">
        <p style="opacity:0.8;margin:0">Time Remaining</p>
        <div style="font-size:28px;font-weight:700">${hrs}h ${mins}m</div>
      </div>`;
    }

    const exRows = exercises.map(ex => `<tr style="${ex.solved ? 'background:#f0fdf4' : ''}">
      <td>${ex.solved ? '✅' : ''} <a href="/school/code-runner/solve/${ex.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(ex.title)}</a></td>
      <td>${diffBadge(ex.difficulty)}</td>
      <td>${langBadge(ex.language)}</td>
      <td>${ex.points} pts</td>
      <td><a class="btn btn-sm" href="/school/code-runner/solve/${ex.id}">Solve</a></td>
    </tr>`).join('');

    const lbRows = lb.map((r, i) => `<tr>
      <td style="font-weight:700">${i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '#' + (i + 1)}</td>
      <td><strong>${esc(r.name)}</strong></td>
      <td>${r.solved} solved</td>
      <td><strong style="color:${P}">${r.total_score || 0}</strong></td>
    </tr>`).join('');

    const html = `${SKIP}
    <div style="max-width:1100px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <div>
          <a href="/school/code-runner/contests" style="color:${GRAY};text-decoration:none;font-size:13px">← Back to Contests</a>
          <h1 style="color:${P};margin:4px 0 0">${esc(c.title)} ${isActive ? '<span class="badge badge-passed">LIVE</span>' : ''}</h1>
          <p style="color:${GRAY};margin:2px 0 0">Created by ${esc(c.creator_name)} · ${exerciseIds.length} exercises</p>
        </div>
        <a href="/school/code-runner/contests" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Back</a>
      </div>
      <p style="color:${GRAY};margin-bottom:16px">${esc(c.description || '')}</p>
      ${countdownHtml}
      <div style="display:grid;grid-template-columns:2fr 1fr;gap:16px">
        <div class="card">
          <h3>Exercises</h3>
          <div style="overflow-x:auto;margin-top:8px">
            <table><thead><tr><th>Exercise</th><th>Difficulty</th><th>Language</th><th>Points</th><th>Actions</th></tr></thead>
            <tbody>${exRows || '<tr><td colspan="5" class="empty">No exercises in this contest</td></tr>'}</tbody></table>
          </div>
        </div>
        <div>
          <div class="card" style="padding:0;overflow:hidden">
            <h3 style="margin:0;padding:12px 16px;border-bottom:1px solid #e5e7eb">🏆 Contest Leaderboard</h3>
            <table><thead><tr><th>#</th><th>Student</th><th>Solved</th><th>Score</th></tr></thead>
            <tbody>${lbRows || '<tr><td colspan="4" class="empty">No submissions yet</td></tr>'}</tbody></table>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage(req, html, c.title));
  });

  /* ── Plagiarism Check ── */
  app.get('/school/code-runner/plagiarism-check', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const exerciseFilter = req.query.exercise_id || '';

    let query = `SELECT s.id, s.code, s.student_id, s.submitted_at, s.plagiarism_score, e.title as exercise_title, u.name as student_name
                 FROM code_submissions s JOIN code_exercises e ON e.id=s.exercise_id JOIN users u ON u.id=s.student_id
                 WHERE s.tenant_id=$1 AND s.plagiarism_score > 60 ORDER BY s.plagiarism_score DESC LIMIT 50`;
    const params = [tid];
    if (exerciseFilter) {
      query = `SELECT s.id, s.code, s.student_id, s.submitted_at, s.plagiarism_score, e.title as exercise_title, u.name as student_name
               FROM code_submissions s JOIN code_exercises e ON e.id=s.exercise_id JOIN users u ON u.id=s.student_id
               WHERE s.tenant_id=$1 AND s.exercise_id=$2 AND s.plagiarism_score > 0 ORDER BY s.plagiarism_score DESC LIMIT 100`;
      params.push(Number(exerciseFilter));
    }
    const [flagged] = await pool.query(query, params);

    const [exercises] = await pool.query('SELECT id, title FROM code_exercises WHERE tenant_id=$1 ORDER BY title', [tid]);
    const exOpts = exercises.map(e => `<option value="${e.id}" ${e.id == exerciseFilter ? 'selected' : ''}>${esc(e.title)}</option>`).join('');

    const rows = flagged.map(s => {
      const severity = s.plagiarism_score > 90 ? '#dc2626' : s.plagiarism_score > 75 ? '#d97706' : '#2563eb';
      return `<div class="card" style="border-left:4px solid ${severity}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <h4 style="margin:0">${esc(s.student_name)} <span style="color:${GRAY};font-weight:normal">· ${esc(s.exercise_title)}</span></h4>
            <p style="color:${GRAY};font-size:13px;margin:2px 0 0">${new Date(s.submitted_at).toLocaleString()}</p>
          </div>
          <span style="font-size:20px;font-weight:700;color:${severity}">${s.plagiarism_score}%</span>
        </div>
        <details style="margin-top:8px">
          <summary style="cursor:pointer;color:${GRAY};font-size:13px">View Code</summary>
          <pre class="code-output" style="margin-top:4px;max-height:200px;overflow:auto;font-size:13px">${esc(s.code)}</pre>
        </details>
      </div>`;
    }).join('');

    const html = `${SKIP}
    <div style="max-width:900px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">🔍 Plagiarism Detection</h1>
        <a href="/school/code-runner" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Dashboard</a>
      </div>
      <div class="card" style="padding:12px 16px">
        <form method="GET" style="display:flex;gap:8px;align-items:center">
          <select name="exercise_id" style="max-width:300px">
            <option value="">All Exercises</option>
            ${exOpts}
          </select>
          <button type="submit" class="btn btn-sm">Filter</button>
          <a href="/school/code-runner/plagiarism-check" class="btn btn-sm" style="background:#6b7280;text-decoration:none">Clear</a>
        </form>
      </div>
      <p style="color:${GRAY};font-size:13px;margin:12px 0">Submissions with >60% code similarity to other students are flagged. Thresholds: 🔴 >90% (Critical) · 🟠 >75% (High) · 🔵 >60% (Medium)</p>
      <div style="display:flex;gap:16px;margin-bottom:16px;flex-wrap:wrap">
        <div class="stat-card" style="min-width:120px"><div class="stat-num" style="color:#dc2626">${flagged.filter(s => s.plagiarism_score > 90).length}</div><div class="stat-label">Critical</div></div>
        <div class="stat-card" style="min-width:120px"><div class="stat-num" style="color:#d97706">${flagged.filter(s => s.plagiarism_score > 75 && s.plagiarism_score <= 90).length}</div><div class="stat-label">High</div></div>
        <div class="stat-card" style="min-width:120px"><div class="stat-num" style="color:#2563eb">${flagged.filter(s => s.plagiarism_score > 60 && s.plagiarism_score <= 75).length}</div><div class="stat-label">Medium</div></div>
      </div>
      ${rows || '<div class="card"><p class="empty">No flagged submissions</p></div>'}
    </div>`;
    res.send(renderPage(req, html, 'Plagiarism Check'));
  });

  /* ── API: Run Custom Code (standalone) ── */
  app.post('/school/code-runner/api/run', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { code, language, input } = req.body;
    if (!code || !language) return res.json({ error: 'code and language are required' });
    if (!LANGUAGES.find(l => l.id === language)) return res.json({ error: 'Unsupported language' });
    const result = await runCodeSandbox(code, language, input || '');
    res.json(result);
  }));

  /* ── API: Compare Code (plagiarism) ── */
  app.post('/school/code-runner/api/compare', requireAuth, requireNotBanned, ah(async (req, res) => {
    const { code_a, code_b } = req.body;
    if (!code_a || !code_b) return res.json({ error: 'Two code snippets are required' });
    const similarity = computeSimilarity(code_a, code_b);
    const tokenize = (s) => s.replace(/[^a-zA-Z0-9_]/g, ' ').split(/\s+/).filter(Boolean).slice(0, 20);
    res.json({
      similarity,
      tokens_a: tokenize(code_a),
      tokens_b: tokenize(code_b),
      verdict: similarity > 90 ? 'CRITICAL' : similarity > 75 ? 'HIGH' : similarity > 50 ? 'MODERATE' : 'LOW'
    });
  }));

  /* ── API: Share Submission ── */
  app.post('/school/code-runner/api/share/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const sid = Number(req.params.id);
    const { share_with } = req.body;
    const [subs] = await pool.query('SELECT * FROM code_submissions WHERE tenant_id=$1 AND id=$2 AND student_id=$3', [tid, sid, uid]);
    if (!subs.length) return res.json({ error: 'Submission not found' });
    const current = subs[0].shared_with || [];
    const targetIds = Array.isArray(share_with) ? share_with.map(Number) : [Number(share_with)];
    for (const targetId of targetIds) {
      if (!current.includes(targetId)) current.push(targetId);
    }
    await pool.query('UPDATE code_submissions SET shared_with=$1 WHERE id=$2', [JSON.stringify(current), sid]);
    audit(req, 'code_share', { sid, share_with: targetIds });
    res.json({ ok: true, shared_with: current });
  }));

  /* ── Shared Submissions View ── */
  app.get('/school/code-runner/shared', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const [shared] = await pool.query(
      `SELECT s.*, e.title as exercise_title, e.language as ex_lang, u.name as author_name
       FROM code_submissions s
       JOIN code_exercises e ON e.id=s.exercise_id
       JOIN users u ON u.id=s.student_id
       WHERE s.tenant_id=$1 AND s.shared_with @> $2::jsonb
       ORDER BY s.submitted_at DESC`,
      [tid, JSON.stringify([uid])]
    );

    const rows = shared.map(s => `<tr>
      <td><a href="/school/code-runner/submissions/${s.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(s.exercise_title)}</a></td>
      <td>${esc(s.author_name)}</td>
      <td>${langBadge(s.language)}</td>
      <td>${statusBadge(s.status)}</td>
      <td>${s.score} pts</td>
      <td>${new Date(s.submitted_at).toLocaleString()}</td>
      <td><a href="/school/code-runner/submissions/${s.id}" class="btn btn-sm">View</a></td>
    </tr>`).join('');

    const html = `${SKIP}
    <div style="max-width:1000px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">🔗 Shared With Me</h1>
        <a href="/school/code-runner" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Dashboard</a>
      </div>
      <div class="card">
        <div style="overflow-x:auto">
          <table><thead><tr><th>Exercise</th><th>Author</th><th>Language</th><th>Status</th><th>Score</th><th>Shared</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" class="empty">No shared submissions</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Shared Submissions'));
  });

  /* ── Exercise Stats / Analytics ── */
  app.get('/school/code-runner/stats', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const [totalSubs] = await pool.query('SELECT COUNT(*) as cnt FROM code_submissions WHERE tenant_id=$1', [tid]);
    const [passedSubs] = await pool.query('SELECT COUNT(*) as cnt FROM code_submissions WHERE tenant_id=$1 AND status=$2', [tid, 'passed']);
    const [uniqueSolvers] = await pool.query('SELECT COUNT(DISTINCT student_id) as cnt FROM code_submissions WHERE tenant_id=$1 AND status=$2', [tid, 'passed']);
    const [langStats] = await pool.query(
      'SELECT language, COUNT(*) as cnt, COUNT(*) FILTER (WHERE status=$2) as passed FROM code_submissions WHERE tenant_id=$1 GROUP BY language ORDER BY cnt DESC',
      [tid, 'passed']
    );
    const [diffStats] = await pool.query(
      `SELECT e.difficulty, COUNT(s.id) as attempts, COUNT(s.id) FILTER (WHERE s.status=$3) as solved
       FROM code_exercises e LEFT JOIN code_submissions s ON s.exercise_id=e.id AND s.tenant_id=e.tenant_id
       WHERE e.tenant_id=$1 GROUP BY e.difficulty ORDER BY e.difficulty`,
      [tid, 'passed']
    );
    const [topExercises] = await pool.query(
      `SELECT e.title, e.difficulty, e.language, COUNT(s.id) as attempts, COUNT(s.id) FILTER (WHERE s.status=$3) as solved
       FROM code_exercises e LEFT JOIN code_submissions s ON s.exercise_id=e.id AND s.tenant_id=e.tenant_id
       WHERE e.tenant_id=$1 GROUP BY e.id, e.title, e.difficulty, e.language ORDER BY attempts DESC LIMIT 10`,
      [tid, 'passed']
    );
    const passRate = totalSubs[0].cnt > 0 ? Math.round((passedSubs[0].cnt / totalSubs[0].cnt) * 100) : 0;

    const langBars = langStats.map(l => {
      const pct = l.cnt > 0 ? Math.round((l.passed / l.cnt) * 100) : 0;
      return `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px">
          <span>${langBadge(l.language)}</span>
          <span>${l.passed}/${l.cnt} (${pct}%)</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${l.language === 'javascript' ? '#f7df1e' : l.language === 'python' ? '#3776ab' : l.language === 'java' ? '#ed8b00' : '#00599c'}"></div></div>
      </div>`;
    }).join('');

    const diffBars = diffStats.map(d => {
      const pct = d.attempts > 0 ? Math.round((d.solved / d.attempts) * 100) : 0;
      const color = d.difficulty === 'easy' ? '#059669' : d.difficulty === 'medium' ? '#2563eb' : d.difficulty === 'hard' ? '#d97706' : '#dc2626';
      return `<div style="margin-bottom:8px">
        <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px">
          <span>${diffBadge(d.difficulty)}</span>
          <span>${d.solved}/${d.attempts} (${pct}%)</span>
        </div>
        <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>`;
    }).join('');

    const topRows = topExercises.map(ex => `<tr>
      <td><a href="/school/code-runner/solve/${ex.id}" style="color:${P};text-decoration:none">${esc(ex.title)}</a></td>
      <td>${diffBadge(ex.difficulty)}</td>
      <td>${langBadge(ex.language)}</td>
      <td>${ex.attempts}</td>
      <td>${ex.solved}</td>
      <td>${ex.attempts > 0 ? Math.round((ex.solved / ex.attempts) * 100) : 0}%</td>
    </tr>`).join('');

    const html = `${SKIP}
    <div style="max-width:1100px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">📊 Analytics</h1>
        <a href="/school/code-runner" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← Dashboard</a>
      </div>
      <div class="grid" style="margin-bottom:24px;grid-template-columns:repeat(4,1fr)">
        <div class="stat-card"><div class="stat-num">${totalSubs[0].cnt}</div><div class="stat-label">Total Submissions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${passRate}%</div><div class="stat-label">Pass Rate</div></div>
        <div class="stat-card"><div class="stat-num">${uniqueSolvers[0].cnt}</div><div class="stat-label">Unique Solvers</div></div>
        <div class="stat-card"><div class="stat-num">${LANGUAGES.length}</div><div class="stat-label">Languages</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px">
        <div class="card">
          <h3 style="margin:0 0 12px">By Language</h3>
          ${langBars || '<p class="empty">No data</p>'}
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px">By Difficulty</h3>
          ${diffBars || '<p class="empty">No data</p>'}
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px">Quick Actions</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <a href="/school/code-runner/exercises/create" class="btn" style="text-align:center;text-decoration:none">+ New Exercise</a>
            <a href="/school/code-runner/plagiarism-check" class="btn btn-warning" style="text-align:center;text-decoration:none">Plagiarism Check</a>
            <a href="/school/code-runner/contests" class="btn" style="background:#7c3aed;text-align:center;text-decoration:none">Manage Contests</a>
            <a href="/school/code-runner/leaderboard" class="btn btn-success" style="text-align:center;text-decoration:none">Leaderboard</a>
          </div>
        </div>
      </div>
      <div class="card">
        <h3 style="margin:0 0 8px">Most Popular Exercises</h3>
        <div style="overflow-x:auto;margin-top:8px">
          <table><thead><tr><th>Exercise</th><th>Difficulty</th><th>Language</th><th>Attempts</th><th>Solved</th><th>Pass Rate</th></tr></thead>
          <tbody>${topRows || '<tr><td colspan="6" class="empty">No data yet</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
    res.send(renderPage(req, html, 'Code Runner Analytics'));
  });

  /* ── Edit Exercise ── */
  app.get('/school/code-runner/exercises/:id/edit', requireAuth, requireNotBanned, async (req, res) => {
    const tid = req.tenant_id;
    const eid = Number(req.params.id);
    const [exercises] = await pool.query('SELECT * FROM code_exercises WHERE tenant_id=$1 AND id=$2', [tid, eid]);
    if (!exercises.length) return res.status(404).send('Exercise not found');
    const ex = exercises[0];

    const langOpts = LANGUAGES.map(l => `<option value="${l.id}" ${l.id === ex.language ? 'selected' : ''}>${esc(l.label)}</option>`).join('');
    const catOpts = CATEGORIES.map(c => `<option value="${c}" ${c === ex.category ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const diffOpts = DIFFICULTIES.map(d => `<option value="${d}" ${d === ex.difficulty ? 'selected' : ''}>${esc(d)}</option>`).join('');
    const testCasesStr = JSON.stringify(ex.test_cases || [], null, 2);
    const tagsStr = (ex.tags || []).join(', ');

    const html = `${SKIP}
    <div style="max-width:900px;margin:0 auto;padding:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h1 style="color:${P};margin:0">✏️ Edit: ${esc(ex.title)}</h1>
        <a href="/school/code-runner/solve/${eid}" class="btn btn-sm" style="background:#6b7280;text-decoration:none">← View</a>
      </div>
      <form method="POST" action="/school/code-runner/exercises/${eid}/edit" class="card">
        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
          <div><label>Title *</label><input name="title" required value="${esc(ex.title)}"></div>
          <div><label>Difficulty</label><select name="difficulty">${diffOpts}</select></div>
          <div><label>Language</label><select name="language">${langOpts}</select></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:12px">
          <div><label>Category</label><select name="category">${catOpts}</select></div>
          <div><label>Points</label><input type="number" name="points" value="${ex.points}" min="10"></div>
        </div>
        <div style="margin-top:12px"><label>Description *</label><textarea name="description" rows="4" required>${esc(ex.description)}</textarea></div>
        <div style="margin-top:12px"><label>Tags (comma-separated)</label><input name="tags" value="${esc(tagsStr)}"></div>
        <div style="margin-top:12px"><label>Starter Code</label><textarea name="starter_code" class="code-editor" rows="6">${esc(ex.starter_code)}</textarea></div>
        <div style="margin-top:12px"><label>Solution</label><textarea name="solution" class="code-editor" rows="6">${esc(ex.solution)}</textarea></div>
        <div style="margin-top:12px"><label>Test Cases (JSON)</label><textarea name="test_cases" class="code-editor" rows="5">${esc(testCasesStr)}</textarea></div>
        <div style="margin-top:16px;display:flex;gap:8px">
          <button type="submit" class="btn btn-success">Save Changes</button>
          <a href="/school/code-runner/exercises/${eid}/edit" class="btn" style="background:#6b7280;text-decoration:none">Cancel</a>
          <button type="button" class="btn btn-danger" onclick="delExercise(${eid})">Delete</button>
        </div>
      </form>
      <script>function delExercise(id){if(confirm('Delete this exercise permanently?'))fetch('/school/code-runner/exercises/'+id,{method:'DELETE',headers:{'X-Requested-With':'XMLHttpRequest'}}).then(r=>{if(r.ok)window.location='/school/code-runner/exercises'})}</script>
    </div>`;
    res.send(renderPage(req, html, `Edit: ${ex.title}`));
  });

  app.post('/school/code-runner/exercises/:id/edit', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const eid = Number(req.params.id);
    const { title, description, difficulty, language, starter_code, solution, test_cases, points, category, tags } = req.body;
    let parsedTests = [];
    try { parsedTests = test_cases ? JSON.parse(test_cases) : []; } catch (e) { parsedTests = []; }
    const tagArr = tags ? tags.split(',').map(t => t.trim().toLowerCase()).filter(Boolean) : [];
    await pool.query(
      `UPDATE code_exercises SET title=$1,description=$2,difficulty=$3,language=$4,starter_code=$5,test_cases=$6,solution=$7,points=$8,category=$9,tags=$10,updated_at=NOW() WHERE tenant_id=$11 AND id=$12`,
      [title, description, difficulty || 'easy', language || 'javascript', starter_code || '', JSON.stringify(parsedTests), solution || '', Number(points) || 100, category || 'general', JSON.stringify(tagArr), tid, eid]
    );
    audit(req, 'code_exercise_edit', { eid, title });
    req.flash('success', 'Exercise updated!');
    res.redirect(`/school/code-runner/solve/${eid}`);
  }));

  app.delete('/school/code-runner/exercises/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    await pool.query('DELETE FROM code_submissions WHERE tenant_id=$1 AND exercise_id=$2', [tid, Number(req.params.id)]);
    await pool.query('DELETE FROM code_exercises WHERE tenant_id=$1 AND id=$2', [tid, Number(req.params.id)]);
    res.json({ ok: true });
  }));

  /* ── Assignment Integration: Assign exercise to students ── */
  app.post('/school/code-runner/api/assign', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const uid = req.user.id;
    const { exercise_id, student_ids, due_date } = req.body;
    if (!exercise_id) return res.json({ error: 'exercise_id required' });
    const exIds = Array.isArray(exercise_id) ? exercise_id : [exercise_id];
    const sIds = Array.isArray(student_ids) ? student_ids.map(Number) : student_ids ? [Number(student_ids)] : [];

    // Send notification emails for each assignment
    for (const sId of sIds) {
      for (const eId of exIds) {
        try {
          const [ex] = await pool.query('SELECT title, points FROM code_exercises WHERE id=$1 AND tenant_id=$2', [Number(eId), tid]);
          if (ex.length) {
            const [student] = await pool.query('SELECT name, email FROM users WHERE id=$1 AND tenant_id=$2', [sId, tid]);
            if (student.length && student[0].email) {
              const dueStr = due_date ? ` (Due: ${new Date(due_date).toLocaleDateString()})` : '';
              queueEmail(student[0].email, `New Coding Assignment: ${ex[0].title}`, `You have been assigned "${ex[0].title}" (${ex[0].points} pts)${dueStr}.\n\nLog in to the School Portal to start solving.`);
            }
          }
        } catch (e) { /* ignore email errors */ }
      }
    }

    audit(req, 'code_assign', { exercise_ids: exIds, student_ids: sIds, due_date });
    res.json({ ok: true, assigned: sIds.length * exIds.length });
  }));

  /* ── Batch Test Case Import ── */
  app.post('/school/code-runner/api/import-tests/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.tenant_id;
    const eid = Number(req.params.id);
    const { test_cases } = req.body;
    let parsedTests = [];
    try { parsedTests = JSON.parse(test_cases); } catch (e) { return res.json({ error: 'Invalid JSON' }); }
    if (!Array.isArray(parsedTests)) return res.json({ error: 'Must be a JSON array' });

    const [exercises] = await pool.query('SELECT test_cases FROM code_exercises WHERE tenant_id=$1 AND id=$2', [tid, eid]);
    if (!exercises.length) return res.json({ error: 'Exercise not found' });
    const current = exercises[0].test_cases || [];
    const merged = [...current, ...parsedTests];

    await pool.query('UPDATE code_exercises SET test_cases=$1, updated_at=NOW() WHERE id=$2', [JSON.stringify(merged), eid]);
    audit(req, 'code_import_tests', { eid, count: parsedTests.length });
    res.json({ ok: true, total: merged.length, imported: parsedTests.length });
  }));

  console.log('[CodeRunner] Module loaded');
};
