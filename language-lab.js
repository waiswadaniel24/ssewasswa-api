/**
 * Language Lab Module
 * SaaS School Portal - Multi-language learning with spaced repetition,
 * pronunciation, grammar, listening, speaking, reading, translation,
 * CEFR tracking, cultural lessons, language exchange, and certificates.
 */
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style><div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:#4f46e5">School</a> &rsaquo; Language Lab</div>';

  const CEFR_LEVELS = ['A1','A1+','A2','A2+','B1','B1+','B2','B2+','C1','C1+','C2'];
  const SUPPORTED_LANGUAGES = [
    { code:'en', name:'English', flag:'🇬🇧' },
    { code:'es', name:'Spanish', flag:'🇪🇸' },
    { code:'fr', name:'French', flag:'🇫🇷' },
    { code:'de', name:'German', flag:'🇩🇪' },
    { code:'zh', name:'Mandarin', flag:'🇨🇳' },
    { code:'ja', name:'Japanese', flag:'🇯🇵' },
    { code:'ko', name:'Korean', flag:'🇰🇷' },
    { code:'pt', name:'Portuguese', flag:'🇧🇷' },
    { code:'it', name:'Italian', flag:'🇮🇹' },
    { code:'ar', name:'Arabic', flag:'🇸🇦' },
    { code:'hi', name:'Hindi', flag:'🇮🇳' },
    { code:'ru', name:'Russian', flag:'🇷🇺' }
  ];
  const EXERCISE_TYPES = [
    'vocabulary','grammar','listening','reading','speaking','translation','pronunciation','culture'
  ];

  /* ── Auto-migration ─────────────────────────────────────────────────── */
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS language_courses (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          language VARCHAR(5) NOT NULL,
          level VARCHAR(10) NOT NULL DEFAULT 'A1',
          title VARCHAR(255) NOT NULL,
          description TEXT,
          lessons_count INTEGER DEFAULT 0,
          duration_hours NUMERIC(5,1) DEFAULT 0,
          cover_image TEXT,
          is_published BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT now(),
          updated_at TIMESTAMPTZ DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS vocabulary_sets (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          course_id INTEGER NOT NULL REFERENCES language_courses(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          words JSONB DEFAULT '[]',
          language VARCHAR(5) NOT NULL,
          difficulty VARCHAR(10) DEFAULT 'A1',
          created_at TIMESTAMPTZ DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS language_exercises (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          course_id INTEGER NOT NULL REFERENCES language_courses(id) ON DELETE CASCADE,
          lesson_id INTEGER,
          type VARCHAR(30) NOT NULL,
          content JSONB DEFAULT '{}',
          answers JSONB DEFAULT '{}',
          difficulty VARCHAR(10) DEFAULT 'A1',
          points INTEGER DEFAULT 10,
          created_at TIMESTAMPTZ DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS student_language_progress (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          student_id INTEGER NOT NULL REFERENCES users(id),
          course_id INTEGER NOT NULL REFERENCES language_courses(id) ON DELETE CASCADE,
          level VARCHAR(10) DEFAULT 'A1',
          xp_points INTEGER DEFAULT 0,
          streak_days INTEGER DEFAULT 0,
          completed_lessons INTEGER DEFAULT 0,
          total_exercises_done INTEGER DEFAULT 0,
          correct_answers INTEGER DEFAULT 0,
          last_practice TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE(tenant_id, student_id, course_id)
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS speaking_recordings (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          student_id INTEGER NOT NULL REFERENCES users(id),
          course_id INTEGER NOT NULL REFERENCES language_courses(id) ON DELETE CASCADE,
          exercise_id INTEGER REFERENCES language_exercises(id),
          audio_url TEXT,
          duration_sec NUMERIC(6,2),
          score NUMERIC(5,2),
          feedback TEXT,
          created_at TIMESTAMPTZ DEFAULT now()
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS language_exchange_partners (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          student_id INTEGER NOT NULL REFERENCES users(id),
          partner_id INTEGER NOT NULL REFERENCES users(id),
          native_language VARCHAR(5),
          target_language VARCHAR(5),
          status VARCHAR(20) DEFAULT 'pending',
          matched_at TIMESTAMPTZ DEFAULT now(),
          UNIQUE(tenant_id, student_id, partner_id)
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS language_certificates (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          student_id INTEGER NOT NULL REFERENCES users(id),
          course_id INTEGER NOT NULL REFERENCES language_courses(id) ON DELETE CASCADE,
          cefr_level VARCHAR(10) NOT NULL,
          certificate_code VARCHAR(50) UNIQUE NOT NULL,
          issued_at TIMESTAMPTZ DEFAULT now(),
          template_data JSONB DEFAULT '{}'
        )`);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS spaced_repetition_cards (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id),
          student_id INTEGER NOT NULL REFERENCES users(id),
          vocab_set_id INTEGER REFERENCES vocabulary_sets(id) ON DELETE CASCADE,
          word_index INTEGER DEFAULT 0,
          ease_factor NUMERIC(4,2) DEFAULT 2.5,
          interval_days INTEGER DEFAULT 1,
          repetitions INTEGER DEFAULT 0,
          next_review TIMESTAMPTZ DEFAULT now(),
          last_review TIMESTAMPTZ,
          UNIQUE(tenant_id, student_id, vocab_set_id, word_index)
        )`);
      console.log('[LanguageLab] Tables ready');
    } catch(e) { console.warn('[LanguageLab] Migration warning:', e.message); }
  })();

  /* ── Helpers ────────────────────────────────────────────────────────── */
  function langFlag(code) {
    const l = SUPPORTED_LANGUAGES.find(x => x.code === code);
    return l ? l.flag : '🌐';
  }
  function langName(code) {
    const l = SUPPORTED_LANGUAGES.find(x => x.code === code);
    return l ? l.name : code;
  }
  function generateCertCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = 'LL-';
    for (let i = 0; i < 12; i++) code += chars[Math.floor(Math.random() * chars.length)];
    return code;
  }
  function calcSpacedRep(card, quality) {
    // SM-2 algorithm simplified
    let { ease_factor, interval_days, repetitions } = card;
    if (quality >= 3) {
      if (repetitions === 0) interval_days = 1;
      else if (repetitions === 1) interval_days = 6;
      else interval_days = Math.round(interval_days * ease_factor);
      repetitions += 1;
    } else {
      repetitions = 0;
      interval_days = 1;
    }
    ease_factor = Math.max(1.3, ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
    return { ease_factor, interval_days, repetitions };
  }
  function levelColor(level) {
    if (level.startsWith('A')) return '#22c55e';
    if (level.startsWith('B')) return '#f59e0b';
    return '#ef4444';
  }
  function streakHTML(streak) {
    if (!streak || streak < 1) return '<span style="color:' + GRAY + '">No streak</span>';
    const fire = streak >= 30 ? '🔥🔥🔥' : streak >= 7 ? '🔥🔥' : '🔥';
    return `<span style="color:#f59e0b">${fire} ${streak} day${streak > 1 ? 's' : ''}</span>`;
  }
  function xpBar(xp, max) {
    max = max || 1000;
    const pct = Math.min(100, Math.round((xp / max) * 100));
    return `<div style="background:#e5e7eb;border-radius:8px;height:8px;overflow:hidden;width:100%">
      <div style="background:${P};height:100%;width:${pct}%;border-radius:8px;transition:width .3s"></div>
    </div><small style="color:${GRAY}">${xp}/${max} XP</small>`;
  }

  /* ── Dashboard ──────────────────────────────────────────────────────── */
  app.get('/school/language-lab', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const { rows: courses } = await pool.query(
        `SELECT * FROM language_courses WHERE tenant_id = $1 AND is_published = true ORDER BY language, level`, [tid]);
      const { rows: progress } = await pool.query(
        `SELECT p.*, c.title as course_title, c.language, c.level FROM student_language_progress p
         JOIN language_courses c ON c.id = p.course_id
         WHERE p.tenant_id = $1 AND p.student_id = $2 ORDER BY p.last_practice DESC NULLS LAST`, [tid, uid]);
      const totalXP = progress.reduce((s, p) => s + (p.xp_points || 0), 0);
      const totalLessons = progress.reduce((s, p) => s + (p.completed_lessons || 0), 0);
      const activeStreak = progress.length > 0 ? Math.max(...progress.map(p => p.streak_days || 0)) : 0;
      const coursesEnrolled = progress.length;

      let rows = '';
      // Quick-stats row
      rows += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">`;
      rows += `<div class="card" style="text-align:center;border-left:4px solid ${P}">
        <div style="font-size:28px;font-weight:700;color:${P}">${totalXP.toLocaleString()}</div>
        <div style="color:${GRAY};font-size:13px">Total XP</div></div>`;
      rows += `<div class="card" style="text-align:center;border-left:4px solid #22c55e">
        <div style="font-size:28px;font-weight:700;color:#22c55e">${totalLessons}</div>
        <div style="color:${GRAY};font-size:13px">Lessons Done</div></div>`;
      rows += `<div class="card" style="text-align:center;border-left:4px solid #f59e0b">
        <div style="font-size:28px;font-weight:700;color:#f59e0b">${activeStreak}</div>
        <div style="color:${GRAY};font-size:13px">Best Streak</div></div>`;
      rows += `<div class="card" style="text-align:center;border-left:4px solid #8b5cf6">
        <div style="font-size:28px;font-weight:700;color:#8b5cf6">${coursesEnrolled}</div>
        <div style="color:${GRAY};font-size:13px">Courses Enrolled</div></div>`;
      rows += `</div>`;

      // Daily practice CTA
      const todayStr = new Date().toISOString().slice(0, 10);
      const practicedToday = progress.some(p => p.last_practice && p.last_practice.toISOString().slice(0, 10) === todayStr);
      if (!practicedToday) {
        rows += `<div class="card" style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;text-align:center;padding:24px">
          <div style="font-size:20px;font-weight:600">Keep Your Streak Alive!</div>
          <p style="margin:8px 0 16px;opacity:.9">Practice today to maintain your learning momentum.</p>
          <a href="/school/language-lab/courses" style="display:inline-block;background:#fff;color:#4f46e5;padding:10px 24px;border-radius:8px;font-weight:600;text-decoration:none">Start Practicing</a>
        </div>`;
      }

      // Available courses
      rows += `<div class="card"><h3 style="margin:0 0 16px">📚 Available Courses</h3>`;
      if (courses.length === 0) {
        rows += `<p style="color:${GRAY}">No courses published yet. Check back soon!</p>`;
      } else {
        rows += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px">`;
        for (const c of courses) {
          const enrolled = progress.find(p => p.course_id === c.id);
          rows += `<div class="card" style="margin:0;border:1px solid #e5e7eb">
            <div style="font-size:24px">${langFlag(c.language)}</div>
            <div style="font-weight:600;margin:4px 0">${esc(c.title)}</div>
            <span style="display:inline-block;background:${levelColor(c.level)};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px">${c.level}</span>
            <div style="color:${GRAY};font-size:13px;margin-top:4px">${c.lessons_count} lessons · ${c.duration_hours}h</div>
            ${enrolled ? `<div style="margin-top:8px">${xpBar(enrolled.xp_points, 1000)}<br>${streakHTML(enrolled.streak_days)}</div>
              <a href="/school/language-lab/practice/${c.id}" class="btn" style="display:block;text-align:center;margin-top:8px;text-decoration:none">Continue</a>` :
              `<form method="post" action="/school/language-lab/courses/enroll" style="margin-top:8px">
                <input type="hidden" name="course_id" value="${c.id}">
                <button class="btn" style="width:100%">Enroll Free</button>
              </form>`}
          </div>`;
        }
        rows += `</div>`;
      }
      rows += `</div>`;

      // Recent progress
      if (progress.length > 0) {
        rows += `<div class="card"><h3 style="margin:0 0 16px">📈 Your Progress</h3><table>
          <tr><th>Course</th><th>Level</th><th>XP</th><th>Streak</th><th>Last Practice</th></tr>`;
        for (const p of progress.slice(0, 10)) {
          rows += `<tr>
            <td>${langFlag(p.language)} ${esc(p.course_title)}</td>
            <td><span style="color:${levelColor(p.level)};font-weight:600">${p.level}</span></td>
            <td>${p.xp_points} XP</td>
            <td>${streakHTML(p.streak_days)}</td>
            <td>${p.last_practice ? p.last_practice.toLocaleDateString() : 'Never'}</td></tr>`;
        }
        rows += `</table></div>`;
      }

      const navItems = [
        { href: '/school/language-lab/courses', label: '📚 Courses', desc: 'Browse & enroll' },
        { href: '/school/language-lab/vocabulary', label: '📖 Vocabulary', desc: 'Build your words' },
        { href: '/school/language-lab/exercises', label: '✏️ Exercises', desc: 'Practice skills' },
        { href: '/school/language-lab/my-progress', label: '📊 My Progress', desc: 'Track learning' },
        { href: '/school/language-lab/leaderboard', label: '🏆 Leaderboard', desc: 'Compete' },
        { href: '/school/language-lab/exchange-partners', label: '🤝 Exchange', desc: 'Language partners' },
        { href: '/school/language-lab/certificates', label: '🎓 Certificates', desc: 'Your awards' },
      ];
      rows += `<div class="card"><h3 style="margin:0 0 16px">Quick Links</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:10px">`;
      for (const n of navItems) {
        rows += `<a href="${n.href}" class="card" style="text-decoration:none;display:block;margin:0;border:1px solid #e5e7eb;cursor:pointer">
          <div style="font-size:18px;font-weight:600;color:${P}">${n.label}</div>
          <div style="color:${GRAY};font-size:13px">${n.desc}</div></a>`;
      }
      rows += `</div></div>`;

      renderPage(req, res, 'Language Lab – Dashboard', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Courses List ───────────────────────────────────────────────────── */
  app.get('/school/language-lab/courses', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const filterLang = req.query.lang || '';
      const filterLevel = req.query.level || '';
      let sql = `SELECT * FROM language_courses WHERE tenant_id = $1 AND is_published = true`;
      const params = [tid];
      let idx = 2;
      if (filterLang) { sql += ` AND language = $${idx++}`; params.push(filterLang); }
      if (filterLevel) { sql += ` AND level = $${idx++}`; params.push(filterLevel); }
      sql += ` ORDER BY language, level, title`;
      const { rows: courses } = await pool.query(sql, params);
      const { rows: enrolled } = await pool.query(
        `SELECT course_id FROM student_language_progress WHERE tenant_id = $1 AND student_id = $2`, [tid, uid]);
      const enrolledIds = new Set(enrolled.map(e => e.course_id));

      const filterLevelQS = filterLevel ? "&level=" + encodeURIComponent(filterLevel) : '';
      const filterLangQS = filterLang ? "&lang=" + encodeURIComponent(filterLang) : '';
      let rows = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;margin-bottom:16px">
        <h2 style="margin:0">📚 Language Courses</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <select name="lang" onchange="location.href='/school/language-lab/courses?lang='+this.value+'${filterLevelQS}'" style="width:auto;padding:6px 10px">
            <option value="">All Languages</option>
            ${SUPPORTED_LANGUAGES.map(l => `<option value="${l.code}"${filterLang === l.code ? ' selected' : ''}>${l.flag} ${l.name}</option>`).join('')}
          </select>
          <select name="level" onchange="location.href='/school/language-lab/courses?level='+this.value+'${filterLangQS}'" style="width:auto;padding:6px 10px">
            <option value="">All Levels</option>
            ${CEFR_LEVELS.map(l => `<option value="${l}"${filterLevel === l ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </div></div>`;

      if (courses.length === 0) {
        rows += `<p style="color:${GRAY}">No courses match your filters.</p>`;
      } else {
        rows += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px">`;
        for (const c of courses) {
          const isEnrolled = enrolledIds.has(c.id);
          rows += `<div class="card" style="margin:0;border:1px solid ${isEnrolled ? P : '#e5e7eb'};position:relative">
            ${isEnrolled ? `<span style="position:absolute;top:8px;right:8px;background:#22c55e;color:#fff;padding:2px 8px;border-radius:4px;font-size:11px">Enrolled</span>` : ''}
            <div style="font-size:32px">${langFlag(c.language)}</div>
            <div style="font-size:18px;font-weight:600;margin:6px 0">${esc(c.title)}</div>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">
              <span style="background:${levelColor(c.level)};color:#fff;padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600">${c.level}</span>
              <span style="color:${GRAY};font-size:13px">${langName(c.language)}</span>
            </div>
            ${c.description ? `<p style="color:${GRAY};font-size:14px;margin:6px 0">${esc(c.description).slice(0, 120)}</p>` : ''}
            <div style="color:${GRAY};font-size:13px;margin:6px 0">📋 ${c.lessons_count} lessons · ⏱ ${c.duration_hours}h</div>
            ${isEnrolled
              ? `<a href="/school/language-lab/practice/${c.id}" class="btn" style="display:block;text-align:center;text-decoration:none;margin-top:8px">Continue Learning →</a>`
              : `<form method="post" action="/school/language-lab/courses/enroll" style="margin-top:8px">
                  <input type="hidden" name="course_id" value="${c.id}">
                  <button class="btn" style="width:100%">Enroll</button>
                </form>`}
          </div>`;
        }
        rows += `</div>`;
      }
      rows += `</div>`;

      renderPage(req, res, 'Language Lab – Courses', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Enroll in Course ───────────────────────────────────────────────── */
  app.post('/school/language-lab/courses/enroll', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const courseId = parseInt(req.body.course_id) || 0;
      if (!courseId) return res.redirect('/school/language-lab/courses');
      const { rows: course } = await pool.query(
        `SELECT id FROM language_courses WHERE id = $1 AND tenant_id = $2 AND is_published = true`, [courseId, tid]);
      if (!course.length) return res.redirect('/school/language-lab/courses');
      await pool.query(`
        INSERT INTO student_language_progress (tenant_id, student_id, course_id, last_practice)
        VALUES ($1, $2, $3, now())
        ON CONFLICT (tenant_id, student_id, course_id) DO NOTHING`, [tid, uid, courseId]);
      audit(req, 'language_enroll', { course_id: courseId });
      req.flash('success', 'Enrolled successfully! Start learning now.');
      res.redirect('/school/language-lab/practice/' + courseId);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Practice Area (Course Detail) ──────────────────────────────────── */
  app.get('/school/language-lab/practice/:course_id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const courseId = parseInt(req.params.course_id) || 0;
      if (!courseId) return res.redirect('/school/language-lab/courses');

      const { rows: course } = await pool.query(
        `SELECT * FROM language_courses WHERE id = $1 AND tenant_id = $2`, [courseId, tid]);
      if (!course.length) return res.redirect('/school/language-lab/courses');
      const c = course[0];

      const { rows: prog } = await pool.query(
        `SELECT * FROM student_language_progress WHERE tenant_id = $1 AND student_id = $2 AND course_id = $3`,
        [tid, uid, courseId]);
      const p = prog[0] || {};

      const { rows: vocabSets } = await pool.query(
        `SELECT * FROM vocabulary_sets WHERE tenant_id = $1 AND course_id = $2 ORDER BY title`, [tid, courseId]);
      const { rows: exercises } = await pool.query(
        `SELECT * FROM language_exercises WHERE tenant_id = $1 AND course_id = $2 ORDER BY type, difficulty`, [tid, courseId]);

      // Group exercises by type
      const byType = {};
      for (const ex of exercises) {
        if (!byType[ex.type]) byType[ex.type] = [];
        byType[ex.type].push(ex);
      }

      let rows = `<div class="card" style="background:linear-gradient(135deg,#4f46e5,#7c3aed);color:#fff;padding:24px;border:none">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <div style="font-size:32px">${langFlag(c.language)} ${esc(c.title)}</div>
            <div style="opacity:.9;margin-top:4px">${langName(c.language)} · Level ${c.level} · ${c.lessons_count} lessons</div>
          </div>
          <div style="text-align:right">
            <div style="font-size:28px;font-weight:700">${(p.xp_points || 0).toLocaleString()} XP</div>
            ${streakHTML(p.streak_days)}
          </div>
        </div>
        <div style="margin-top:12px">
          <div style="background:rgba(255,255,255,.2);border-radius:8px;height:10px;overflow:hidden">
            <div style="background:#fff;height:100%;width:${Math.min(100, Math.round(((p.completed_lessons || 0) / Math.max(1, c.lessons_count)) * 100))}%;border-radius:8px"></div>
          </div>
          <div style="font-size:13px;opacity:.8;margin-top:4px">${p.completed_lessons || 0}/${c.lessons_count} lessons completed</div>
        </div>
      </div>`;

      // Practice sections
      rows += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:16px;margin-top:16px">`;

      // Vocabulary practice
      rows += `<div class="card">
        <h3 style="margin:0 0 12px">📖 Vocabulary Builder</h3>
        <p style="color:${GRAY};font-size:14px;margin-bottom:12px">${vocabSets.length} word sets available</p>`;
      if (vocabSets.length > 0) {
        for (const vs of vocabSets.slice(0, 5)) {
          const wordCount = (vs.words || []).length;
          rows += `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f3f4f6">
            <div><strong>${esc(vs.title)}</strong><br><span style="color:${GRAY};font-size:13px">${wordCount} words · ${vs.difficulty}</span></div>
            <a href="/school/language-lab/vocabulary/practice/${vs.id}" class="btn" style="text-decoration:none;font-size:13px;padding:6px 12px">Study</a>
          </div>`;
        }
      } else {
        rows += `<p style="color:${GRAY};font-size:14px">No vocabulary sets yet for this course.</p>`;
      }
      rows += `</div>`;

      // Exercises by type
      const typeIcons = {
        vocabulary: '📝', grammar: '📐', listening: '🎧', reading: '📄',
        speaking: '🎤', translation: '🔀', pronunciation: '🗣️', culture: '🌏'
      };
      const typeLabels = {
        vocabulary: 'Vocabulary', grammar: 'Grammar', listening: 'Listening',
        reading: 'Reading', speaking: 'Speaking', translation: 'Translation',
        pronunciation: 'Pronunciation', culture: 'Culture'
      };
      rows += `<div class="card">
        <h3 style="margin:0 0 12px">✏️ Practice Exercises</h3>
        <p style="color:${GRAY};font-size:14px;margin-bottom:12px">${exercises.length} exercises available</p>`;
      if (exercises.length > 0) {
        for (const [type, exs] of Object.entries(byType)) {
          rows += `<div style="margin-bottom:12px">
            <div style="font-weight:600;margin-bottom:6px">${typeIcons[type] || '📋'} ${typeLabels[type] || type} <span style="color:${GRAY};font-weight:400">(${exs.length})</span></div>`;
          for (const ex of exs.slice(0, 3)) {
            rows += `<a href="/school/language-lab/exercises/do/${ex.id}" class="btn" style="display:block;text-align:left;margin-bottom:4px;text-decoration:none;font-size:13px;padding:8px 12px">
              ${ex.difficulty} · ${ex.points} pts →</a>`;
          }
          rows += `</div>`;
        }
      } else {
        rows += `<p style="color:${GRAY};font-size:14px">No exercises yet for this course.</p>`;
      }
      rows += `</div>`;

      // Quick actions
      rows += `<div class="card">
        <h3 style="margin:0 0 12px">⚡ Quick Actions</h3>
        <a href="/school/language-lab/exercises?course_id=${courseId}&type=grammar" class="btn" style="display:block;text-align:center;text-decoration:none;margin-bottom:8px">📐 Grammar Drill</a>
        <a href="/school/language-lab/exercises?course_id=${courseId}&type=listening" class="btn" style="display:block;text-align:center;text-decoration:none;margin-bottom:8px;background:#059669">🎧 Listening Practice</a>
        <a href="/school/language-lab/exercises?course_id=${courseId}&type=speaking" class="btn" style="display:block;text-align:center;text-decoration:none;margin-bottom:8px;background:#dc2626">🎤 Speaking Practice</a>
        <a href="/school/language-lab/vocabulary?course_id=${courseId}" class="btn" style="display:block;text-align:center;text-decoration:none;background:#7c3aed">📖 Vocabulary Review</a>
      </div>`;

      rows += `</div>`;

      renderPage(req, res, `Language Lab – ${c.title}`, SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Vocabulary List & Practice ─────────────────────────────────────── */
  app.get('/school/language-lab/vocabulary', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const filterCourse = parseInt(req.query.course_id) || 0;
      const filterLang = req.query.lang || '';
      let sql = `SELECT v.*, c.title as course_title, c.language FROM vocabulary_sets v
        JOIN language_courses c ON c.id = v.course_id
        WHERE v.tenant_id = $1`;
      const params = [tid];
      let idx = 2;
      if (filterCourse) { sql += ` AND v.course_id = $${idx++}`; params.push(filterCourse); }
      if (filterLang) { sql += ` AND c.language = $${idx++}`; params.push(filterLang); }
      sql += ` ORDER BY c.language, v.difficulty, v.title`;
      const { rows: sets } = await pool.query(sql, params);

      // Spaced repetition: cards due today
      const { rows: dueCards } = await pool.query(
        `SELECT sr.*, v.title as set_title, v.words FROM spaced_repetition_cards sr
         JOIN vocabulary_sets v ON v.id = sr.vocab_set_id
         WHERE sr.tenant_id = $1 AND sr.student_id = $2 AND sr.next_review <= now()
         ORDER BY sr.next_review ASC LIMIT 50`, [tid, uid]);

      let rows = `<div class="card"><h2 style="margin:0 0 16px">📖 Vocabulary Builder</h2>

        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          <a href="/school/language-lab/vocabulary" class="btn" style="text-decoration:none;font-size:13px">All Sets</a>
          ${SUPPORTED_LANGUAGES.map(l =>
            `<a href="/school/language-lab/vocabulary?lang=${l.code}" class="btn" style="text-decoration:none;font-size:13px;${filterLang === l.code ? 'background:#3730a3' : ''}">${l.flag} ${l.name}</a>`
          ).join('')}
        </div>`;

      // Due for review
      if (dueCards.length > 0) {
        rows += `<div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:12px;padding:16px;margin-bottom:16px">
          <div style="font-weight:600;color:#92400e">⏰ ${dueCards.length} cards due for review!</div>
          <p style="color:#92400e;font-size:14px;margin:4px 0 12px">Review your spaced repetition cards to retain vocabulary.</p>
          <a href="/school/language-lab/vocabulary/spaced-review" class="btn" style="background:#f59e0b;text-decoration:none">Start Review →</a>
        </div>`;
      }

      if (sets.length === 0) {
        rows += `<p style="color:${GRAY}">No vocabulary sets available yet.</p>`;
      } else {
        rows += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">`;
        for (const s of sets) {
          const words = s.words || [];
          rows += `<div class="card" style="margin:0;border:1px solid #e5e7eb">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-weight:600">${langFlag(s.language)} ${esc(s.title)}</div>
                <div style="color:${GRAY};font-size:13px">${s.course_title} · ${s.difficulty}</div>
              </div>
              <span style="background:${levelColor(s.difficulty)};color:#fff;padding:2px 8px;border-radius:4px;font-size:12px">${words.length} words</span>
            </div>
            <div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">
              <a href="/school/language-lab/vocabulary/study/${s.id}" class="btn" style="text-decoration:none;font-size:12px;padding:5px 10px">📖 Study</a>
              <a href="/school/language-lab/vocabulary/quiz/${s.id}" class="btn" style="text-decoration:none;font-size:12px;padding:5px 10px;background:#059669">✏️ Quiz</a>
              <a href="/school/language-lab/vocabulary/flashcards/${s.id}" class="btn" style="text-decoration:none;font-size:12px;padding:5px 10px;background:#7c3aed">🃏 Flashcards</a>
            </div>
          </div>`;
        }
        rows += `</div>`;
      }
      rows += `</div>`;

      renderPage(req, res, 'Language Lab – Vocabulary', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Study Vocabulary Set ───────────────────────────────────────────── */
  app.get('/school/language-lab/vocabulary/study/:set_id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const setId = parseInt(req.params.set_id) || 0;
      const { rows: set } = await pool.query(
        `SELECT v.*, c.title as course_title, c.language FROM vocabulary_sets v
         JOIN language_courses c ON c.id = v.course_id
         WHERE v.id = $1 AND v.tenant_id = $2`, [setId, tid]);
      if (!set.length) return res.redirect('/school/language-lab/vocabulary');
      const s = set[0];
      const words = s.words || [];

      let rows = `<div class="card">
        <a href="/school/language-lab/vocabulary" style="color:${P};text-decoration:none">← Back to Vocabulary</a>
        <h2 style="margin:12px 0 4px">${langFlag(s.language)} ${esc(s.title)}</h2>
        <p style="color:${GRAY}">${s.course_title} · ${s.difficulty} · ${words.length} words</p>
      </div>`;

      rows += `<div class="card"><h3 style="margin:0 0 16px">Word List</h3><table>
        <tr><th>#</th><th>Word</th><th>Translation</th><th>Pronunciation</th><th>Example</th></tr>`;
      words.forEach((w, i) => {
        rows += `<tr>
          <td>${i + 1}</td>
          <td style="font-weight:600">${esc(w.word || w.term || '')}</td>
          <td>${esc(w.translation || w.meaning || '')}</td>
          <td style="color:${GRAY};font-style:italic">${esc(w.pronunciation || w.phonetic || '—')}</td>
          <td style="color:${GRAY};font-size:14px">${esc(w.example || '—')}</td>
        </tr>`;
      });
      rows += `</table></div>`;

      // Initialize spaced repetition cards for this set
      rows += `<div class="card" style="text-align:center">
        <h3 style="margin:0 0 12px">Ready to Practice?</h3>
        <p style="color:${GRAY};margin-bottom:16px">Add these words to your spaced repetition schedule.</p>
        <form method="post" action="/school/language-lab/vocabulary/spaced-init">
          <input type="hidden" name="set_id" value="${s.id}">
          <button class="btn" style="font-size:16px;padding:12px 32px">🧠 Add to Spaced Repetition</button>
        </form>
      </div>`;

      renderPage(req, res, `Vocabulary – ${s.title}`, SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Initialize Spaced Repetition ───────────────────────────────────── */
  app.post('/school/language-lab/vocabulary/spaced-init', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const setId = parseInt(req.body.set_id) || 0;
      const { rows: set } = await pool.query(
        `SELECT words FROM vocabulary_sets WHERE id = $1 AND tenant_id = $2`, [setId, tid]);
      if (!set.length) return res.redirect('/school/language-lab/vocabulary');
      const words = set[0].words || [];
      for (let i = 0; i < words.length; i++) {
        await pool.query(`
          INSERT INTO spaced_repetition_cards (tenant_id, student_id, vocab_set_id, word_index, next_review)
          VALUES ($1, $2, $3, $4, now())
          ON CONFLICT (tenant_id, student_id, vocab_set_id, word_index) DO NOTHING`,
          [tid, uid, setId, i]);
      }
      audit(req, 'spaced_rep_init', { set_id: setId, word_count: words.length });
      req.flash('success', `${words.length} words added to your spaced repetition schedule!`);
      res.redirect('/school/language-lab/vocabulary/spaced-review');
    } catch(e) { ah(e, req, res); }
  });

  /* ── Spaced Repetition Review ───────────────────────────────────────── */
  app.get('/school/language-lab/vocabulary/spaced-review', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const { rows: dueCards } = await pool.query(`
        SELECT sr.*, v.words, v.title as set_title, v.language
        FROM spaced_repetition_cards sr
        JOIN vocabulary_sets v ON v.id = sr.vocab_set_id
        WHERE sr.tenant_id = $1 AND sr.student_id = $2 AND sr.next_review <= now()
        ORDER BY sr.next_review ASC LIMIT 30`, [tid, uid]);

      let rows = `<div class="card">
        <a href="/school/language-lab/vocabulary" style="color:${P};text-decoration:none">← Back to Vocabulary</a>
        <h2 style="margin:12px 0">🧠 Spaced Repetition Review</h2>
        <p style="color:${GRAY}">${dueCards.length} cards due for review</p>
      </div>`;

      if (dueCards.length === 0) {
        rows += `<div class="card" style="text-align:center;padding:40px">
          <div style="font-size:48px;margin-bottom:12px">🎉</div>
          <h3 style="color:#22c55e">All caught up!</h3>
          <p style="color:${GRAY}">No cards due for review. Come back later!</p>
        </div>`;
      } else {
        rows += `<div id="review-area" class="card">
          <div style="text-align:center;padding:20px">
            <div style="color:${GRAY};font-size:14px;margin-bottom:12px">Card 1 of ${dueCards.length}</div>
            <div id="question-text" style="font-size:28px;font-weight:600;margin-bottom:24px"></div>
            <div id="answer-text" style="font-size:20px;color:${P};display:none;margin-bottom:16px"></div>
            <div id="actions"></div>
          </div>
        </div>
        <script>
          const cards = ${JSON.stringify(dueCards.map(c => ({
            id: c.id,
            word: (c.words || [])[c.word_index] || {},
            set_title: c.set_title,
            language: c.language
          })))};
          let idx = 0;
          let shown = false;
          function showCard() {
            if (idx >= cards.length) {
              document.getElementById('review-area').innerHTML = '<div style="text-align:center;padding:40px"><div style="font-size:48px">🎉</div><h3 style="color:#22c55e">Review Complete!</h3><p style="color:${GRAY}">Great work! Come back when more cards are due.</p></div>';
              return;
            }
            shown = false;
            const c = cards[idx];
            document.getElementById('question-text').textContent = c.word.word || c.word.term || '—';
            document.getElementById('answer-text').textContent = '';
            document.getElementById('answer-text').style.display = 'none';
            document.querySelector('#review-area > div > div:first-child').textContent = 'Card ' + (idx+1) + ' of ' + cards.length;
            document.getElementById('actions').innerHTML = '<button class="btn" onclick="flip()" style="font-size:16px;padding:12px 32px">Show Answer</button>';
          }
          function flip() {
            shown = true;
            const c = cards[idx];
            document.getElementById('answer-text').textContent = c.word.translation || c.word.meaning || '—';
            document.getElementById('answer-text').style.display = 'block';
            document.getElementById('actions').innerHTML = [
              {label:'Again',q:1,color:'#ef4444'},
              {label:'Hard',q:3,color:'#f59e0b'},
              {label:'Good',q:4,color:'#22c55e'},
              {label:'Easy',q:5,color:'#4f46e5'}
            ].map(r => '<button class="btn" style="background:'+r.color+';margin:0 4px;font-size:14px" onclick="rate('+r.q+')">'+r.label+'</button>').join('');
          }
          async function rate(quality) {
            const c = cards[idx];
            await fetch('/school/language-lab/vocabulary/spaced-rate', {
              method:'POST', headers:{'Content-Type':'application/json'},
              body: JSON.stringify({card_id: c.id, quality: quality})
            });
            idx++;
            showCard();
          }
          showCard();
        </script>`;
      }

      // Stats
      const { rows: stats } = await pool.query(`
        SELECT COUNT(*) as total,
               COUNT(*) FILTER (WHERE next_review <= now()) as due,
               COUNT(*) FILTER (WHERE repetitions > 0) as mature
        FROM spaced_repetition_cards WHERE tenant_id = $1 AND student_id = $2`, [tid, uid]);
      if (stats.length) {
        const st = stats[0];
        rows += `<div class="card" style="margin-top:16px"><h3 style="margin:0 0 12px">📊 Repetition Stats</h3>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px;text-align:center">
            <div><div style="font-size:24px;font-weight:700;color:${P}">${st.total}</div><div style="color:${GRAY};font-size:13px">Total Cards</div></div>
            <div><div style="font-size:24px;font-weight:700;color:#f59e0b">${st.due}</div><div style="color:${GRAY};font-size:13px">Due Now</div></div>
            <div><div style="font-size:24px;font-weight:700;color:#22c55e">${st.mature}</div><div style="color:${GRAY};font-size:13px">Mature</div></div>
          </div>
        </div>`;
      }

      renderPage(req, res, 'Language Lab – Spaced Review', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Rate Spaced Repetition Card (API) ──────────────────────────────── */
  app.post('/school/language-lab/vocabulary/spaced-rate', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const cardId = parseInt(req.body.card_id) || 0;
      const quality = Math.max(0, Math.min(5, parseInt(req.body.quality) || 3));
      const { rows: card } = await pool.query(
        `SELECT * FROM spaced_repetition_cards WHERE id = $1 AND tenant_id = $2 AND student_id = $3`,
        [cardId, tid, uid]);
      if (!card.length) return res.json({ ok: false });
      const c = card[0];
      const updated = calcSpacedRep(c, quality);
      await pool.query(`
        UPDATE spaced_repetition_cards
        SET ease_factor = $1, interval_days = $2, repetitions = $3,
            next_review = now() + ($2 || ' days')::interval, last_review = now()
        WHERE id = $4`, [updated.ease_factor, updated.interval_days, updated.repetitions, cardId]);
      res.json({ ok: true, interval: updated.interval_days });
    } catch(e) { ah(e, req, res); }
  });

  /* ── Flashcard Mode ─────────────────────────────────────────────────── */
  app.get('/school/language-lab/vocabulary/flashcards/:set_id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const setId = parseInt(req.params.set_id) || 0;
      const { rows: set } = await pool.query(
        `SELECT v.*, c.language FROM vocabulary_sets v JOIN language_courses c ON c.id = v.course_id
         WHERE v.id = $1 AND v.tenant_id = $2`, [setId, tid]);
      if (!set.length) return res.redirect('/school/language-lab/vocabulary');
      const words = set[0].words || [];

      let rows = `<div class="card">
        <a href="/school/language-lab/vocabulary" style="color:${P};text-decoration:none">← Back to Vocabulary</a>
        <h2 style="margin:12px 0">🃏 Flashcards – ${esc(set[0].title)}</h2>
      </div>
      <div id="fc-area" class="card" style="text-align:center;padding:30px;cursor:pointer;min-height:250px" onclick="flip()">
        <div style="color:${GRAY};font-size:14px;margin-bottom:12px" id="fc-counter">1 / ${words.length}</div>
        <div id="fc-front" style="font-size:36px;font-weight:700;padding:20px 0">Tap to start</div>
        <div id="fc-back" style="font-size:24px;color:${P};display:none;padding:20px 0"></div>
        <div style="margin-top:16px;display:flex;justify-content:center;gap:8px">
          <button class="btn" style="background:#ef4444" onclick="event.stopPropagation();nav(-1)">← Hard</button>
          <button class="btn" style="background:#22c55e" onclick="event.stopPropagation();nav(1)">Easy →</button>
        </div>
      </div>
      <script>
        const words = ${JSON.stringify(words)};
        let i = 0, flipped = false;
        function show() {
          if (i < 0) i = 0;
          if (i >= words.length) i = words.length - 1;
          flipped = false;
          document.getElementById('fc-front').textContent = words[i].word || words[i].term || '';
          document.getElementById('fc-front').style.display = 'block';
          document.getElementById('fc-back').style.display = 'none';
          document.getElementById('fc-counter').textContent = (i+1) + ' / ' + words.length;
        }
        function flip() { if (!words.length) return; flipped = !flipped;
          document.getElementById('fc-front').style.display = flipped ? 'none' : 'block';
          document.getElementById('fc-back').style.display = flipped ? 'block' : 'none';
          document.getElementById('fc-back').textContent = words[i].translation || words[i].meaning || '';
        }
        function nav(dir) { i += dir; show(); }
        show();
      </script>`;
      renderPage(req, res, 'Flashcards', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Vocabulary Quiz ────────────────────────────────────────────────── */
  app.get('/school/language-lab/vocabulary/quiz/:set_id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const setId = parseInt(req.params.set_id) || 0;
      const { rows: set } = await pool.query(
        `SELECT * FROM vocabulary_sets WHERE id = $1 AND tenant_id = $2`, [setId, tid]);
      if (!set.length) return res.redirect('/school/language-lab/vocabulary');
      const words = set[0].words || [];
      if (words.length < 4) {
        req.flash('error', 'Need at least 4 words for a quiz.');
        return res.redirect('/school/language-lab/vocabulary');
      }
      // Shuffle and pick 10 questions
      const shuffled = [...words].sort(() => Math.random() - 0.5).slice(0, 10);
      const questions = shuffled.map(w => {
        const correct = w.translation || w.meaning || '';
        const wrongPool = words.filter(x => (x.translation || x.meaning) !== correct);
        const wrongs = wrongPool.sort(() => Math.random() - 0.5).slice(0, 3).map(x => x.translation || x.meaning);
        const options = [correct, ...wrongs].sort(() => Math.random() - 0.5);
        return { word: w.word || w.term, correct, options };
      });

      let rows = `<div class="card">
        <a href="/school/language-lab/vocabulary" style="color:${P};text-decoration:none">← Back to Vocabulary</a>
        <h2 style="margin:12px 0">✏️ Vocabulary Quiz – ${esc(set[0].title)}</h2>
      </div>
      <div id="quiz-area" class="card">
        <div style="display:flex;justify-content:space-between;margin-bottom:16px">
          <span id="q-num" style="color:${GRAY}">Question 1/${questions.length}</span>
          <span id="q-score" style="font-weight:600;color:${P}">Score: 0</span>
        </div>
        <div id="q-word" style="font-size:32px;font-weight:700;text-align:center;padding:20px 0"></div>
        <div id="q-options" style="display:grid;gap:8px"></div>
        <div id="q-feedback" style="margin-top:12px;text-align:center;font-weight:600;min-height:24px"></div>
      </div>
      <script>
        const qs = ${JSON.stringify(questions)};
        let qi = 0, score = 0, answered = false;
        function render() {
          if (qi >= qs.length) {
            document.getElementById('quiz-area').innerHTML = '<div style="text-align:center;padding:40px">'+
              '<div style="font-size:48px;margin-bottom:12px">'+(score>=7?'🏆':score>=4?'👍':'💪')+'</div>'+
              '<h3>Quiz Complete!</h3><p style="font-size:20px;color:${P};font-weight:700">'+score+'/'+qs.length+'</p>'+
              '<a href="/school/language-lab/vocabulary" class="btn" style="margin-top:16px;display:inline-block;text-decoration:none">Back to Vocabulary</a></div>';
            return;
          }
          answered = false;
          document.getElementById('q-num').textContent = 'Question '+(qi+1)+'/'+qs.length;
          document.getElementById('q-score').textContent = 'Score: '+score;
          document.getElementById('q-word').textContent = qs[qi].word;
          document.getElementById('q-feedback').textContent = '';
          document.getElementById('q-options').innerHTML = qs[qi].options.map(o =>
            '<button class="btn" style="padding:14px;font-size:16px;text-align:left" onclick="answer(this,\\''+o.replace(/'/g,"\\\\'")+'\\')">'+o+'</button>'
          ).join('');
        }
        function answer(btn, chosen) {
          if (answered) return;
          answered = true;
          const correct = qs[qi].correct;
          if (chosen === correct) { score++; btn.style.background='#22c55e'; }
          else { btn.style.background='#ef4444'; btn.style.color='#fff';
            document.querySelectorAll('#q-options button').forEach(b=>{if(b.textContent===correct){b.style.background='#22c55e';}});
          }
          document.getElementById('q-feedback').textContent = chosen===correct?'✅ Correct!':'❌ Answer: '+correct;
          document.getElementById('q-feedback').style.color = chosen===correct?'#22c55e':'#ef4444';
          setTimeout(()=>{ qi++; render(); }, 1200);
        }
        render();
      </script>`;
      renderPage(req, res, 'Vocabulary Quiz', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Vocabulary Practice (simplified) ───────────────────────────────── */
  app.get('/school/language-lab/vocabulary/practice/:set_id', requireAuth, requireNotBanned, async (req, res) => {
    res.redirect('/school/language-lab/vocabulary/quiz/' + req.params.set_id);
  });

  /* ── Exercises List ─────────────────────────────────────────────────── */
  app.get('/school/language-lab/exercises', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const filterCourse = parseInt(req.query.course_id) || 0;
      const filterType = req.query.type || '';
      const filterDiff = req.query.difficulty || '';
      let sql = `SELECT e.*, c.title as course_title, c.language FROM language_exercises e
        JOIN language_courses c ON c.id = e.course_id
        WHERE e.tenant_id = $1`;
      const params = [tid];
      let idx = 2;
      if (filterCourse) { sql += ` AND e.course_id = $${idx++}`; params.push(filterCourse); }
      if (filterType) { sql += ` AND e.type = $${idx++}`; params.push(filterType); }
      if (filterDiff) { sql += ` AND e.difficulty = $${idx++}`; params.push(filterDiff); }
      sql += ` ORDER BY e.type, e.difficulty`;
      const { rows: exercises } = await pool.query(sql, params);

      const typeIcons = {
        vocabulary: '📝', grammar: '📐', listening: '🎧', reading: '📄',
        speaking: '🎤', translation: '🔀', pronunciation: '🗣️', culture: '🌏'
      };

      let rows = `<div class="card"><h2 style="margin:0 0 16px">✏️ Practice Exercises</h2>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
          <select onchange="location.href='/school/language-lab/exercises?course_id='+$('select[name=course]').val()+'&type='+this.value" style="width:auto;padding:6px 10px">
            <option value="">All Types</option>
            ${EXERCISE_TYPES.map(t => `<option value="${t}"${filterType === t ? ' selected' : ''}>${typeIcons[t] || ''} ${t}</option>`).join('')}
          </select>
          <select onchange="location.href='/school/language-lab/exercises?course_id='+$('select[name=course]').val()+'&type='+encodeURIComponent('${filterType}')+'&difficulty='+this.value" style="width:auto;padding:6px 10px">
            <option value="">All Levels</option>
            ${CEFR_LEVELS.map(l => `<option value="${l}"${filterDiff === l ? ' selected' : ''}>${l}</option>`).join('')}
          </select>
        </div>`;

      if (exercises.length === 0) {
        rows += `<p style="color:${GRAY}">No exercises match your filters.</p>`;
      } else {
        rows += `<table><tr><th>Type</th><th>Course</th><th>Difficulty</th><th>Points</th><th>Action</th></tr>`;
        for (const ex of exercises) {
          rows += `<tr>
            <td>${typeIcons[ex.type] || '📋'} ${ex.type}</td>
            <td>${langFlag(ex.language)} ${esc(ex.course_title)}</td>
            <td><span style="color:${levelColor(ex.difficulty)};font-weight:600">${ex.difficulty}</span></td>
            <td>${ex.points} pts</td>
            <td><a href="/school/language-lab/exercises/do/${ex.id}" class="btn" style="text-decoration:none;font-size:13px;padding:5px 12px">Start →</a></td>
          </tr>`;
        }
        rows += `</table>`;
      }
      rows += `</div>`;

      renderPage(req, res, 'Language Lab – Exercises', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Do Exercise ────────────────────────────────────────────────────── */
  app.get('/school/language-lab/exercises/do/:ex_id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const exId = parseInt(req.params.ex_id) || 0;
      const { rows: exercises } = await pool.query(
        `SELECT e.*, c.title as course_title, c.language FROM language_exercises e
         JOIN language_courses c ON c.id = e.course_id
         WHERE e.id = $1 AND e.tenant_id = $2`, [exId, tid]);
      if (!exercises.length) return res.redirect('/school/language-lab/exercises');
      const ex = exercises[0];
      const content = ex.content || {};
      const answers = ex.answers || {};

      let rows = `<div class="card">
        <a href="/school/language-lab/exercises" style="color:${P};text-decoration:none">← Back to Exercises</a>
        <h2 style="margin:12px 0 4px">${esc(ex.course_title)}</h2>
        <p style="color:${GRAY}">${ex.type} · ${ex.difficulty} · ${ex.points} points</p>
      </div>`;

      // Build exercise UI based on type
      if (ex.type === 'grammar' || ex.type === 'reading' || ex.type === 'translation') {
        // Multiple choice / fill-in-the-blank style
        rows += `<div class="card">
          <form id="ex-form" method="post" action="/school/language-lab/exercises/submit">
            <input type="hidden" name="exercise_id" value="${ex.id}">
            <div id="ex-prompt" style="font-size:18px;padding:16px 0;margin-bottom:16px">${esc(content.prompt || content.question || 'Complete the exercise.')}</div>`;
        if (content.sentences && content.sentences.length) {
          content.sentences.forEach((s, i) => {
            if (s.blanks && s.blanks.length) {
              rows += `<div style="margin-bottom:16px;padding:12px;background:#f9fafb;border-radius:8px">
                <div style="font-size:16px;margin-bottom:8px">${esc(s.text || s.sentence || '')}</div>`;
              s.blanks.forEach((b, j) => {
                if (b.options && b.options.length) {
                  rows += `<select name="q_${i}_${j}" style="width:auto;margin-right:8px">
                    <option value="">Select...</option>
                    ${b.options.map(o => `<option value="${esc(o)}">${esc(o)}</option>`).join('')}
                  </select>`;
                } else {
                  rows += `<input type="text" name="q_${i}_${j}" placeholder="${esc(b.hint || 'Answer...')}" style="width:200px;display:inline-block;margin-right:8px">`;
                }
              });
              rows += `</div>`;
            }
          });
        } else if (content.options && content.options.length) {
          rows += `<div style="display:grid;gap:8px;margin-top:12px">`;
          content.options.forEach((o, i) => {
            rows += `<label style="display:flex;align-items:center;gap:8px;padding:10px;background:#f9fafb;border-radius:8px;cursor:pointer">
              <input type="radio" name="answer" value="${esc(o)}"> ${esc(o)}</label>`;
          });
          rows += `</div>`;
        }
        rows += `<button type="submit" class="btn" style="margin-top:16px;font-size:16px;padding:12px 32px">Submit Answer</button>
          </form></div>`;
      } else if (ex.type === 'listening') {
        rows += `<div class="card" style="text-align:center;padding:30px">
          <div style="font-size:48px;margin-bottom:12px">🎧</div>
          <p style="color:${GRAY};margin-bottom:16px">${esc(content.prompt || 'Listen to the audio and answer the questions.')}</p>
          <div style="background:#f3f4f6;border-radius:12px;padding:20px;margin-bottom:16px">
            <div style="font-size:16px">${esc(content.transcript || content.text || 'Audio content would play here.')}</div>
          </div>
          <form method="post" action="/school/language-lab/exercises/submit">
            <input type="hidden" name="exercise_id" value="${ex.id}">
            ${(content.questions || []).map((q, i) => `
              <div style="margin-bottom:16px;text-align:left">
                <div style="font-weight:600;margin-bottom:6px">${i + 1}. ${esc(q.text || q.q || '')}</div>
                ${(q.options || []).map(o => `<label style="display:block;padding:4px 0"><input type="radio" name="q_${i}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}
              </div>`).join('')}
            <button type="submit" class="btn" style="font-size:16px;padding:12px 32px">Submit Answers</button>
          </form>
        </div>`;
      } else if (ex.type === 'speaking') {
        rows += `<div class="card" style="text-align:center;padding:30px">
          <div style="font-size:48px;margin-bottom:12px">🎤</div>
          <h3>Speaking Practice</h3>
          <p style="color:${GRAY};margin-bottom:16px">${esc(content.prompt || 'Read the following text aloud and record yourself.')}</p>
          <div style="background:#f3f4f6;border-radius:12px;padding:20px;margin-bottom:16px;font-size:18px">
            ${esc(content.text || content.sentence || 'Practice text will appear here.')}
          </div>
          <div style="margin-bottom:16px">
            <button class="btn" id="rec-btn" onclick="toggleRec()" style="font-size:16px;padding:12px 32px;background:#dc2626">⏺ Start Recording</button>
            <span id="rec-timer" style="margin-left:12px;font-size:18px;font-weight:600;color:#dc2626"></span>
          </div>
          <form method="post" action="/school/language-lab/exercises/submit-speaking" enctype="multipart/form-data">
            <input type="hidden" name="exercise_id" value="${ex.id}">
            <input type="file" name="audio" accept="audio/*" style="margin-bottom:12px">
            <textarea name="notes" placeholder="Any notes about your pronunciation..." style="margin-bottom:12px" rows="2"></textarea>
            <button type="submit" class="btn" style="font-size:16px;padding:12px 32px">📤 Submit Recording</button>
          </form>
        </div>
        <script>
          let rec=false,timer=null,sec=0;
          function toggleRec(){rec=!rec;const b=document.getElementById('rec-btn'),t=document.getElementById('rec-timer');
            if(rec){b.textContent='⏹ Stop Recording';sec=0;timer=setInterval(()=>{sec++;t.textContent=Math.floor(sec/60)+':'+String(sec%60).padStart(2,'0');},1000);}
            else{b.textContent='⏺ Start Recording';clearInterval(timer);t.textContent='';}}
        </script>`;
      } else if (ex.type === 'pronunciation') {
        rows += `<div class="card" style="text-align:center;padding:30px">
          <div style="font-size:48px;margin-bottom:12px">🗣️</div>
          <h3>Pronunciation Practice</h3>
          <p style="color:${GRAY};margin-bottom:16px">${esc(content.prompt || 'Practice pronouncing these words and phrases.')}</p>`;
        const items = content.words || content.phrases || [];
        if (items.length) {
          rows += `<div style="display:grid;gap:12px;text-align:left;max-width:500px;margin:0 auto">`;
          items.forEach((w, i) => {
            rows += `<div style="background:#f9fafb;padding:12px;border-radius:8px">
              <div style="font-size:20px;font-weight:600">${esc(w.word || w.text || w)}</div>
              <div style="color:${GRAY};font-size:14px">${esc(w.phonetic || w.pronunciation || '')}</div>
              ${w.example ? `<div style="color:${GRAY};font-size:13px;font-style:italic">"${esc(w.example)}"</div>` : ''}
            </div>`;
          });
          rows += `</div>`;
        }
        rows += `</div>`;
      } else if (ex.type === 'culture') {
        rows += `<div class="card">
          <h3 style="margin:0 0 12px">🌏 Cultural Lesson</h3>
          <div style="font-size:16px;line-height:1.8">${esc(content.lesson || content.text || 'Cultural content will appear here.')}</div>
          ${(content.facts || []).length ? `<div style="margin-top:16px"><h4>Key Facts</h4>
            ${(content.facts).map(f => `<div style="background:#eff6ff;padding:10px 14px;border-radius:8px;margin-bottom:6px;border-left:3px solid ${P}">💡 ${esc(f)}</div>`).join('')}
          </div>` : ''}
          <form method="post" action="/school/language-lab/exercises/submit" style="margin-top:16px">
            <input type="hidden" name="exercise_id" value="${ex.id}">
            ${(content.questions || []).map((q, i) => `
              <div style="margin-bottom:12px">
                <div style="font-weight:600;margin-bottom:6px">${i + 1}. ${esc(q.text || '')}</div>
                ${(q.options || []).map(o => `<label style="display:block;padding:4px 0"><input type="radio" name="q_${i}" value="${esc(o)}"> ${esc(o)}</label>`).join('')}
              </div>`).join('')}
            <button type="submit" class="btn">Complete Lesson</button>
          </form>
        </div>`;
      } else {
        rows += `<div class="card"><p style="color:${GRAY}">Exercise type "${ex.type}" – Content:</p>
          <pre style="background:#f3f4f6;padding:12px;border-radius:8px;overflow:auto">${esc(JSON.stringify(content, null, 2))}</pre></div>`;
      }

      renderPage(req, res, 'Exercise', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Submit Exercise ────────────────────────────────────────────────── */
  app.post('/school/language-lab/exercises/submit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const exId = parseInt(req.body.exercise_id) || 0;
      const { rows: ex } = await pool.query(
        `SELECT * FROM language_exercises WHERE id = $1 AND tenant_id = $2`, [exId, tid]);
      if (!ex.length) return res.redirect('/school/language-lab/exercises');
      const exercise = ex[0];
      const answers = exercise.answers || {};
      let correct = 0;
      let total = 0;
      // Simple grading: check if any submitted answer matches expected
      for (const [key, val] of Object.entries(req.body)) {
        if (key.startsWith('q_') && val) {
          total++;
          if (answers[key] && String(answers[key]).toLowerCase().trim() === String(val).toLowerCase().trim()) {
            correct++;
          }
        }
        if (key === 'answer' && val) {
          total++;
          if (answers.correct && String(answers.correct).toLowerCase() === String(val).toLowerCase()) correct++;
          else if (Array.isArray(answers.correct) && answers.correct.map(a => a.toLowerCase()).includes(String(val).toLowerCase())) correct++;
        }
      }
      if (total === 0) total = 1;
      const score = Math.round((correct / total) * exercise.points);
      // Update progress
      await pool.query(`
        UPDATE student_language_progress
        SET xp_points = xp_points + $1, total_exercises_done = total_exercises_done + 1,
            correct_answers = correct_answers + $2, last_practice = now()
        WHERE tenant_id = $3 AND student_id = $4 AND course_id = $5`,
        [score, correct, tid, uid, exercise.course_id]);
      // Update streak
      const todayStr = new Date().toISOString().slice(0, 10);
      await pool.query(`
        UPDATE student_language_progress SET streak_days = CASE
          WHEN DATE(last_practice) = (now() - INTERVAL '1 day')::date THEN streak_days + 1
          WHEN DATE(last_practice) = now()::date THEN streak_days
          ELSE 1 END
        WHERE tenant_id = $1 AND student_id = $2 AND course_id = $3`,
        [tid, uid, exercise.course_id]);
      audit(req, 'exercise_submit', { exercise_id: exId, score, correct, total });
      req.flash('success', `Score: ${score}/${exercise.points} XP! (${correct}/${total} correct)`);
      res.redirect('/school/language-lab/exercises/do/' + exId);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Submit Speaking Exercise ───────────────────────────────────────── */
  app.post('/school/language-lab/exercises/submit-speaking', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const exId = parseInt(req.body.exercise_id) || 0;
      const { rows: ex } = await pool.query(
        `SELECT * FROM language_exercises WHERE id = $1 AND tenant_id = $2`, [exId, tid]);
      if (!ex.length) return res.redirect('/school/language-lab/exercises');
      // Save recording info (actual file upload handled by middleware)
      const notes = req.body.notes || '';
      await pool.query(`
        INSERT INTO speaking_recordings (tenant_id, student_id, course_id, exercise_id, feedback)
        VALUES ($1, $2, $3, $4, $5)`,
        [tid, uid, ex[0].course_id, exId, notes]);
      await pool.query(`
        UPDATE student_language_progress
        SET xp_points = xp_points + $1, total_exercises_done = total_exercises_done + 1, last_practice = now()
        WHERE tenant_id = $2 AND student_id = $3 AND course_id = $4`,
        [ex[0].points, tid, uid, ex[0].course_id]);
      audit(req, 'speaking_submit', { exercise_id: exId });
      req.flash('success', 'Recording submitted! + ' + ex[0].points + ' XP');
      res.redirect('/school/language-lab/practice/' + ex[0].course_id);
    } catch(e) { ah(e, req, res); }
  });

  /* ── My Progress ────────────────────────────────────────────────────── */
  app.get('/school/language-lab/my-progress', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const { rows: progress } = await pool.query(`
        SELECT p.*, c.title as course_title, c.language, c.level as course_level, c.lessons_count
        FROM student_language_progress p
        JOIN language_courses c ON c.id = p.course_id
        WHERE p.tenant_id = $1 AND p.student_id = $2
        ORDER BY c.language, p.level`, [tid, uid]);

      const totalXP = progress.reduce((s, p) => s + (p.xp_points || 0), 0);
      const totalExercises = progress.reduce((s, p) => s + (p.total_exercises_done || 0), 0);
      const totalCorrect = progress.reduce((s, p) => s + (p.correct_answers || 0), 0);
      const accuracy = totalExercises > 0 ? Math.round((totalCorrect / totalExercises) * 100) : 0;

      // CEFR level distribution
      const levelCounts = {};
      for (const p of progress) {
        const lvl = p.level || 'A1';
        levelCounts[lvl] = (levelCounts[lvl] || 0) + 1;
      }

      let rows = `<div class="card"><h2 style="margin:0 0 16px">📊 My Language Learning Progress</h2>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;margin-bottom:20px">
          <div style="background:#eff6ff;padding:16px;border-radius:12px;text-align:center;border:1px solid #bfdbfe">
            <div style="font-size:24px;font-weight:700;color:${P}">${totalXP.toLocaleString()}</div>
            <div style="color:${GRAY};font-size:13px">Total XP</div></div>
          <div style="background:#f0fdf4;padding:16px;border-radius:12px;text-align:center;border:1px solid #bbf7d0">
            <div style="font-size:24px;font-weight:700;color:#22c55e">${progress.length}</div>
            <div style="color:${GRAY};font-size:13px">Languages</div></div>
          <div style="background:#fefce8;padding:16px;border-radius:12px;text-align:center;border:1px solid #fef08a">
            <div style="font-size:24px;font-weight:700;color:#f59e0b">${accuracy}%</div>
            <div style="color:${GRAY};font-size:13px">Accuracy</div></div>
          <div style="background:#fdf2f8;padding:16px;border-radius:12px;text-align:center;border:1px solid #fbcfe8">
            <div style="font-size:24px;font-weight:700;color:#ec4899">${totalExercises}</div>
            <div style="color:${GRAY};font-size:13px">Exercises Done</div></div>
        </div>

        <h3 style="margin:0 0 12px">CEFR Levels Achieved</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">
          ${CEFR_LEVELS.map(l => `<div style="background:${levelCounts[l] ? levelColor(l) : '#e5e7eb'};color:${levelCounts[l] ? '#fff' : GRAY};padding:8px 14px;border-radius:8px;font-weight:600;font-size:14px">${l}${levelCounts[l] ? ' ✓' : ''}</div>`).join('')}
        </div>`;

      if (progress.length === 0) {
        rows += `<div style="text-align:center;padding:30px;color:${GRAY}">
          <div style="font-size:48px;margin-bottom:12px">🌍</div>
          <p>Start learning a language to see your progress here!</p>
          <a href="/school/language-lab/courses" class="btn" style="display:inline-block;text-decoration:none;margin-top:8px">Browse Courses</a>
        </div>`;
      } else {
        rows += `<table><tr><th>Course</th><th>Language</th><th>Level</th><th>XP</th><th>Exercises</th><th>Accuracy</th><th>Streak</th><th>Last Practice</th></tr>`;
        for (const p of progress) {
          const acc = (p.total_exercises_done || 0) > 0
            ? Math.round(((p.correct_answers || 0) / p.total_exercises_done) * 100) + '%'
            : '—';
          rows += `<tr>
            <td><a href="/school/language-lab/practice/${p.course_id}" style="color:${P};text-decoration:none;font-weight:600">${esc(p.course_title)}</a></td>
            <td>${langFlag(p.language)} ${langName(p.language)}</td>
            <td><span style="color:${levelColor(p.level)};font-weight:600">${p.level}</span></td>
            <td>${xpBar(p.xp_points, 1000)}</td>
            <td>${p.total_exercises_done || 0}</td>
            <td>${acc}</td>
            <td>${streakHTML(p.streak_days)}</td>
            <td style="color:${GRAY}">${p.last_practice ? p.last_practice.toLocaleDateString() : 'Never'}</td>
          </tr>`;
        }
        rows += `</table>`;
      }
      rows += `</div>`;

      // Weekly activity heatmap
      rows += `<div class="card"><h3 style="margin:0 0 12px">📅 Recent Activity</h3>
        <div style="display:flex;gap:4px;flex-wrap:wrap">`;
      for (let i = 13; i >= 0; i--) {
        const d = new Date(); d.setDate(d.getDate() - i);
        const ds = d.toISOString().slice(0, 10);
        const active = progress.some(p => p.last_practice && p.last_practice.toISOString().slice(0, 10) === ds);
        rows += `<div style="width:20px;height:20px;background:${active ? P : '#e5e7eb'};border-radius:3px" title="${ds}"></div>`;
      }
      rows += `</div>
        <div style="display:flex;gap:8px;align-items:center;margin-top:8px;font-size:12px;color:${GRAY}">
          <span>Less</span>
          <div style="width:12px;height:12px;background:#e5e7eb;border-radius:2px"></div>
          <div style="width:12px;height:12px;background:${P};border-radius:2px"></div>
          <span>More</span></div>
      </div>`;

      renderPage(req, res, 'Language Lab – My Progress', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Leaderboard ────────────────────────────────────────────────────── */
  app.get('/school/language-lab/leaderboard', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const period = req.query.period || 'all'; // all, month, week
      let dateFilter = '';
      if (period === 'week') dateFilter = ` AND p.last_practice >= now() - INTERVAL '7 days'`;
      if (period === 'month') dateFilter = ` AND p.last_practice >= now() - INTERVAL '30 days'`;

      const { rows: leaders } = await pool.query(`
        SELECT u.id, u.name, u.avatar, SUM(p.xp_points) as total_xp,
               SUM(p.streak_days) as max_streak, COUNT(DISTINCT p.course_id) as courses,
               SUM(p.total_exercises_done) as exercises
        FROM student_language_progress p
        JOIN users u ON u.id = p.student_id
        WHERE p.tenant_id = $1 ${dateFilter}
        GROUP BY u.id, u.name, u.avatar
        ORDER BY total_xp DESC LIMIT 50`, [tid]);

      let rows = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <h2 style="margin:0">🏆 Language Leaderboard</h2>
        <div style="display:flex;gap:6px">
          <a href="/school/language-lab/leaderboard?period=all" class="btn" style="text-decoration:none;font-size:13px;padding:5px 10px;${period === 'all' ? 'background:#3730a3' : ''}">All Time</a>
          <a href="/school/language-lab/leaderboard?period=month" class="btn" style="text-decoration:none;font-size:13px;padding:5px 10px;${period === 'month' ? 'background:#3730a3' : ''}">This Month</a>
          <a href="/school/language-lab/leaderboard?period=week" class="btn" style="text-decoration:none;font-size:13px;padding:5px 10px;${period === 'week' ? 'background:#3730a3' : ''}">This Week</a>
        </div></div>`;

      if (leaders.length === 0) {
        rows += `<p style="color:${GRAY};text-align:center;padding:30px">No activity yet. Be the first to start learning!</p>`;
      } else {
        rows += `<table><tr><th>Rank</th><th>Student</th><th>Total XP</th><th>Courses</th><th>Exercises</th><th>Streak</th></tr>`;
        leaders.forEach((l, i) => {
          const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
          const isMe = l.id === uid;
          rows += `<tr style="${isMe ? 'background:#eff6ff;font-weight:600' : ''}">
            <td style="font-size:18px">${medal}</td>
            <td>${isMe ? '⭐ ' : ''}${esc(l.name)}</td>
            <td style="font-weight:700;color:${P}">${(l.total_xp || 0).toLocaleString()}</td>
            <td>${l.courses || 0}</td>
            <td>${l.exercises || 0}</td>
            <td>${streakHTML(l.max_streak)}</td>
          </tr>`;
        });
        rows += `</table>`;
      }
      rows += `</div>`;

      renderPage(req, res, 'Language Lab – Leaderboard', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Certificates ───────────────────────────────────────────────────── */
  app.get('/school/language-lab/certificates', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const { rows: certs } = await pool.query(`
        SELECT lc.*, c.title as course_title, c.language, c.level
        FROM language_certificates lc
        JOIN language_courses c ON c.id = lc.course_id
        WHERE lc.tenant_id = $1 AND lc.student_id = $2
        ORDER BY lc.issued_at DESC`, [tid, uid]);

      let rows = `<div class="card"><h2 style="margin:0 0 16px">🎓 Language Certificates</h2>
        <p style="color:${GRAY};margin-bottom:16px">Earn certificates by completing language courses and passing proficiency assessments.</p>`;

      if (certs.length === 0) {
        rows += `<div style="text-align:center;padding:40px;color:${GRAY}">
          <div style="font-size:48px;margin-bottom:12px">📜</div>
          <p>No certificates earned yet.</p>
          <p style="font-size:14px">Complete courses and maintain good progress to earn certificates!</p>
          <a href="/school/language-lab/courses" class="btn" style="display:inline-block;text-decoration:none;margin-top:12px">Start Learning</a>
        </div>`;
      } else {
        rows += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">`;
        for (const c of certs) {
          rows += `<div class="card" style="margin:0;border:2px solid #f59e0b;position:relative;background:linear-gradient(135deg,#fffbeb,#fef3c7)">
            <div style="position:absolute;top:-1px;right:16px;background:#f59e0b;color:#fff;padding:2px 12px;border-radius:0 0 6px 6px;font-size:11px;font-weight:600">CEFR ${c.cefr_level}</div>
            <div style="text-align:center;padding:16px 0">
              <div style="font-size:36px;margin-bottom:8px">🎓</div>
              <div style="font-size:18px;font-weight:700;color:#92400e">${esc(c.course_title)}</div>
              <div style="color:#92400e;margin:4px 0">${langFlag(c.language)} ${langName(c.language)}</div>
              <div style="color:${GRAY};font-size:13px">Issued: ${c.issued_at.toLocaleDateString()}</div>
              <div style="color:${GRAY};font-size:12px;font-family:monospace;margin-top:4px">${c.certificate_code}</div>
            </div>
          </div>`;
        }
        rows += `</div>`;
      }
      rows += `</div>`;

      // Eligibility check
      const { rows: eligible } = await pool.query(`
        SELECT p.*, c.title as course_title, c.language, c.lessons_count
        FROM student_language_progress p
        JOIN language_courses c ON c.id = p.course_id
        LEFT JOIN language_certificates lc ON lc.student_id = p.student_id AND lc.course_id = p.course_id AND lc.tenant_id = p.tenant_id
        WHERE p.tenant_id = $1 AND p.student_id = $2 AND lc.id IS NULL
          AND p.xp_points >= 500 AND p.completed_lessons >= 3
        ORDER BY p.xp_points DESC`, [tid, uid]);
      if (eligible.length > 0) {
        rows += `<div class="card" style="border:2px solid #22c55e">
          <h3 style="color:#22c55e;margin:0 0 12px">🎊 Eligible for Certificates!</h3>
          <p style="color:${GRAY};margin-bottom:12px">You qualify for certificates in the following courses:</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">`;
        for (const e of eligible) {
          rows += `<form method="post" action="/school/language-lab/certificates/claim" style="margin:0">
            <input type="hidden" name="course_id" value="${e.course_id}">
            <button class="btn" style="background:#22c55e;font-size:13px;padding:6px 12px">🎓 Claim: ${langFlag(e.language)} ${esc(e.course_title)}</button>
          </form>`;
        }
        rows += `</div></div>`;
      }

      renderPage(req, res, 'Language Lab – Certificates', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Claim Certificate ──────────────────────────────────────────────── */
  app.post('/school/language-lab/certificates/claim', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const courseId = parseInt(req.body.course_id) || 0;
      if (!courseId) return res.redirect('/school/language-lab/certificates');
      const { rows: prog } = await pool.query(
        `SELECT * FROM student_language_progress WHERE tenant_id = $1 AND student_id = $2 AND course_id = $3`,
        [tid, uid, courseId]);
      if (!prog.length || (prog[0].xp_points || 0) < 500) {
        req.flash('error', 'Not eligible for certificate yet. Keep practicing!');
        return res.redirect('/school/language-lab/certificates');
      }
      const { rows: existing } = await pool.query(
        `SELECT id FROM language_certificates WHERE tenant_id = $1 AND student_id = $2 AND course_id = $3`,
        [tid, uid, courseId]);
      if (existing.length) {
        req.flash('error', 'You already have a certificate for this course.');
        return res.redirect('/school/language-lab/certificates');
      }
      const code = generateCertCode();
      const level = prog[0].level || 'A1';
      await pool.query(`
        INSERT INTO language_certificates (tenant_id, student_id, course_id, cefr_level, certificate_code)
        VALUES ($1, $2, $3, $4, $5)`, [tid, uid, courseId, level, code]);
      const { rows: course } = await pool.query(`SELECT title FROM language_courses WHERE id = $1`, [courseId]);
      audit(req, 'cert_claim', { course_id: courseId, code, level });
      queueEmail(tid, uid, 'Language Certificate Earned! 🎓',
        `Congratulations! You've earned a CEFR ${level} certificate in ${(course[0] || {}).title || 'your language course'}. Certificate code: ${code}`);
      req.flash('success', `🎓 Certificate earned! CEFR Level: ${level}`);
      res.redirect('/school/language-lab/certificates');
    } catch(e) { ah(e, req, res); }
  });

  /* ── Language Exchange Partners ─────────────────────────────────────── */
  app.get('/school/language-lab/exchange-partners', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const { rows: partners } = await pool.query(`
        SELECT ep.*, u.name as partner_name, u.avatar as partner_avatar,
               ul.language as native_lang, ut.language as target_lang
        FROM language_exchange_partners ep
        JOIN users u ON u.id = ep.partner_id
        LEFT JOIN user_languages ul ON ul.user_id = ep.partner_id AND ul.is_native = true
        LEFT JOIN user_languages ut ON ut.user_id = ep.partner_id AND ut.is_learning = true
        WHERE ep.tenant_id = $1 AND ep.student_id = $2
        ORDER BY ep.matched_at DESC`, [tid, uid]);

      // Find potential partners
      const { rows: myProgress } = await pool.query(
        `SELECT DISTINCT language FROM student_language_progress WHERE tenant_id = $1 AND student_id = $2`, [tid, uid]);
      const myLangs = myProgress.map(p => p.language);

      const { rows: potentials } = await pool.query(`
        SELECT DISTINCT u.id, u.name, u.avatar, p.language
        FROM users u
        JOIN student_language_progress p ON p.student_id = u.id
        WHERE u.tenant_id = $1 AND u.id != $2
          AND p.language = ANY($3)
          AND NOT EXISTS (SELECT 1 FROM language_exchange_partners ep
            WHERE ep.tenant_id = $1 AND ((ep.student_id = $2 AND ep.partner_id = u.id) OR (ep.student_id = u.id AND ep.partner_id = $2)))
        LIMIT 20`, [tid, uid, myLangs.length > 0 ? myLangs : ['en']]);

      let rows = `<div class="card"><h2 style="margin:0 0 16px">🤝 Language Exchange Partners</h2>
        <p style="color:${GRAY};margin-bottom:16px">Practice with native speakers and fellow learners.</p>`;

      // Potential partners
      if (potentials.length > 0) {
        rows += `<h3 style="margin:0 0 12px">💡 Suggested Partners</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:10px;margin-bottom:20px">`;
        for (const pp of potentials) {
          rows += `<div class="card" style="margin:0;border:1px solid #e5e7eb;display:flex;align-items:center;gap:10px">
            <div style="flex:1">
              <div style="font-weight:600">${esc(pp.name)}</div>
              <div style="color:${GRAY};font-size:13px">${langFlag(pp.language)} Learning ${langName(pp.language)}</div>
            </div>
            <form method="post" action="/school/language-lab/exchange-partners/request">
              <input type="hidden" name="partner_id" value="${pp.id}">
              <input type="hidden" name="language" value="${pp.language}">
              <button class="btn" style="font-size:12px;padding:5px 10px">Request</button>
            </form>
          </div>`;
        }
        rows += `</div>`;
      }

      // Current partnerships
      rows += `<h3 style="margin:0 0 12px">Your Partnerships</h3>`;
      if (partners.length === 0) {
        rows += `<p style="color:${GRAY};text-align:center;padding:20px">No partnerships yet. Find a language partner above!</p>`;
      } else {
        rows += `<table><tr><th>Partner</th><th>Language</th><th>Status</th><th>Matched</th><th>Actions</th></tr>`;
        for (const p of partners) {
          const statusColors = { pending: '#f59e0b', accepted: '#22c55e', declined: '#ef4444' };
          rows += `<tr>
            <td style="font-weight:600">${esc(p.partner_name)}</td>
            <td>${langFlag(p.target_lang || p.native_lang)} ${langName(p.target_lang || p.native_lang)}</td>
            <td><span style="background:${statusColors[p.status] || '#e5e7eb'};color:#fff;padding:2px 10px;border-radius:12px;font-size:12px">${p.status}</span></td>
            <td style="color:${GRAY}">${p.matched_at.toLocaleDateString()}</td>
            <td>${p.status === 'pending' ? `<form method="post" action="/school/language-lab/exchange-partners/cancel" style="display:inline">
              <input type="hidden" name="id" value="${p.id}"><button class="btn" style="background:#ef4444;font-size:12px;padding:4px 8px">Cancel</button></form>` : '—'}</td>
          </tr>`;
        }
        rows += `</table>`;
      }
      rows += `</div>`;

      renderPage(req, res, 'Language Lab – Exchange Partners', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Request Exchange Partner ───────────────────────────────────────── */
  app.post('/school/language-lab/exchange-partners/request', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const partnerId = parseInt(req.body.partner_id) || 0;
      const language = req.body.language || 'en';
      if (!partnerId) return res.redirect('/school/language-lab/exchange-partners');
      await pool.query(`
        INSERT INTO language_exchange_partners (tenant_id, student_id, partner_id, native_language, target_language, status)
        VALUES ($1, $2, $3, $4, $4, 'pending')
        ON CONFLICT DO NOTHING`, [tid, uid, partnerId, language]);
      audit(req, 'exchange_request', { partner_id: partnerId, language });
      req.flash('success', 'Partner request sent!');
      res.redirect('/school/language-lab/exchange-partners');
    } catch(e) { ah(e, req, res); }
  });

  /* ── Cancel Exchange Request ────────────────────────────────────────── */
  app.post('/school/language-lab/exchange-partners/cancel', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const id = parseInt(req.body.id) || 0;
      await pool.query(`DELETE FROM language_exchange_partners WHERE id = $1 AND tenant_id = $2 AND student_id = $3`, [id, tid, uid]);
      res.redirect('/school/language-lab/exchange-partners');
    } catch(e) { ah(e, req, res); }
  });

  /* ── Admin: Create Course ───────────────────────────────────────────── */
  app.get('/school/language-lab/admin/courses', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const { rows: courses } = await pool.query(
        `SELECT c.*, (SELECT COUNT(*) FROM student_language_progress p WHERE p.course_id = c.id) as enrolled
         FROM language_courses c WHERE c.tenant_id = $1 ORDER BY c.created_at DESC`, [tid]);

      let rows = `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="margin:0">🔧 Manage Courses</h2>
        <a href="/school/language-lab/admin/courses/new" class="btn" style="text-decoration:none">+ New Course</a>
      </div>`;

      if (courses.length === 0) {
        rows += `<p style="color:${GRAY}">No courses yet. Create your first language course!</p>`;
      } else {
        rows += `<table><tr><th>Course</th><th>Language</th><th>Level</th><th>Lessons</th><th>Enrolled</th><th>Status</th><th>Actions</th></tr>`;
        for (const c of courses) {
          rows += `<tr>
            <td style="font-weight:600">${esc(c.title)}</td>
            <td>${langFlag(c.language)} ${langName(c.language)}</td>
            <td><span style="color:${levelColor(c.level)};font-weight:600">${c.level}</span></td>
            <td>${c.lessons_count}</td>
            <td>${c.enrolled}</td>
            <td>${c.is_published ? '<span style="color:#22c55e">Published</span>' : '<span style="color:#f59e0b">Draft</span>'}</td>
            <td>
              <a href="/school/language-lab/admin/courses/${c.id}/edit" class="btn" style="text-decoration:none;font-size:12px;padding:4px 8px;margin-right:4px">Edit</a>
              <form method="post" action="/school/language-lab/admin/courses/toggle" style="display:inline">
                <input type="hidden" name="id" value="${c.id}">
                <button class="btn" style="font-size:12px;padding:4px 8px;background:${c.is_published ? '#f59e0b' : '#22c55e'}">${c.is_published ? 'Unpublish' : 'Publish'}</button>
              </form>
            </td></tr>`;
        }
        rows += `</table>`;
      }
      rows += `</div>`;

      renderPage(req, res, 'Language Lab – Admin Courses', SKIP + rows);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Admin: New Course Form ─────────────────────────────────────────── */
  app.get('/school/language-lab/admin/courses/new', requireAuth, requireNotBanned, async (req, res) => {
    const langOptions = SUPPORTED_LANGUAGES.map(l => `<option value="${l.code}">${l.flag} ${l.name}</option>`).join('');
    const levelOptions = CEFR_LEVELS.map(l => `<option value="${l}">${l}</option>`).join('');
    const form = `<div class="card"><h2 style="margin:0 0 16px">➕ Create Language Course</h2>
      <form method="post" action="/school/language-lab/admin/courses/create">
        <div style="display:grid;gap:12px">
          <div><label style="font-weight:600;display:block;margin-bottom:4px">Course Title *</label>
            <input type="text" name="title" required placeholder="e.g. Spanish for Beginners"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Language *</label>
              <select name="language" required>${langOptions}</select></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">CEFR Level *</label>
              <select name="level" required>${levelOptions}</select></div>
          </div>
          <div><label style="font-weight:600;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3" placeholder="Course description..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Number of Lessons</label>
              <input type="number" name="lessons_count" min="0" value="0"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Duration (hours)</label>
              <input type="number" name="duration_hours" min="0" step="0.5" value="0"></div>
          </div>
          <div><label style="font-weight:600;display:block;margin-bottom:4px">Cover Image URL</label>
            <input type="url" name="cover_image" placeholder="https://..."></div>
          <div style="display:flex;gap:8px">
            <button type="submit" class="btn" style="font-size:16px;padding:12px 32px">Create Course</button>
            <a href="/school/language-lab/admin/courses" class="btn" style="text-decoration:none;background:${GRAY}">Cancel</a>
          </div>
        </div>
      </form></div>`;
    renderPage(req, res, 'Create Language Course', SKIP + form);
  });

  /* ── Admin: Create Course POST ──────────────────────────────────────── */
  app.post('/school/language-lab/admin/courses/create', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const { title, language, level, description, lessons_count, duration_hours, cover_image } = req.body;
      if (!title || !language || !level) {
        req.flash('error', 'Title, language, and level are required.');
        return res.redirect('/school/language-lab/admin/courses/new');
      }
      await pool.query(`
        INSERT INTO language_courses (tenant_id, language, level, title, description, lessons_count, duration_hours, cover_image)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [tid, language, level, title, description, parseInt(lessons_count) || 0, parseFloat(duration_hours) || 0, cover_image]);
      audit(req, 'course_create', { title, language, level });
      req.flash('success', 'Course created successfully!');
      res.redirect('/school/language-lab/admin/courses');
    } catch(e) { ah(e, req, res); }
  });

  /* ── Admin: Toggle Publish ──────────────────────────────────────────── */
  app.post('/school/language-lab/admin/courses/toggle', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const id = parseInt(req.body.id) || 0;
      await pool.query(
        `UPDATE language_courses SET is_published = NOT is_published, updated_at = now() WHERE id = $1 AND tenant_id = $2`,
        [id, tid]);
      res.redirect('/school/language-lab/admin/courses');
    } catch(e) { ah(e, req, res); }
  });

  /* ── Admin: Add Vocabulary Set ──────────────────────────────────────── */
  app.get('/school/language-lab/admin/vocabulary/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const { rows: courses } = await pool.query(
        `SELECT id, title, language FROM language_courses WHERE tenant_id = $1 AND is_published = true ORDER BY title`, [tid]);
      const courseOpts = courses.map(c => `<option value="${c.id}">${langFlag(c.language)} ${esc(c.title)}</option>`).join('');
      const form = `<div class="card"><h2 style="margin:0 0 16px">📖 Add Vocabulary Set</h2>
        <form method="post" action="/school/language-lab/admin/vocabulary/create">
          <div style="display:grid;gap:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Course *</label>
              <select name="course_id" required><option value="">Select course...</option>${courseOpts}</select></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Set Title *</label>
              <input type="text" name="title" required placeholder="e.g. Basic Greetings"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Difficulty</label>
              <select name="difficulty">${CEFR_LEVELS.map(l => `<option value="${l}">${l}</option>`).join('')}</select></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Words (JSON) *</label>
              <p style="color:${GRAY};font-size:13px">Format: [{"word":"hola","translation":"hello","pronunciation":"OH-lah","example":"¡Hola! ¿Cómo estás?"}]</p>
              <textarea name="words" rows="8" required placeholder='[{"word":"","translation":"","pronunciation":"","example":""}]'></textarea></div>
            <button type="submit" class="btn" style="font-size:16px;padding:12px 32px">Create Vocabulary Set</button>
          </div>
        </form></div>`;
      renderPage(req, res, 'Add Vocabulary Set', SKIP + form);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Admin: Create Vocabulary Set POST ──────────────────────────────── */
  app.post('/school/language-lab/admin/vocabulary/create', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const courseId = parseInt(req.body.course_id) || 0;
      const { title, difficulty, words: wordsStr } = req.body;
      if (!courseId || !title || !wordsStr) {
        req.flash('error', 'Course, title, and words are required.');
        return res.redirect('/school/language-lab/admin/vocabulary/new');
      }
      let words;
      try { words = JSON.parse(wordsStr); } catch(e) {
        req.flash('error', 'Invalid JSON format for words.');
        return res.redirect('/school/language-lab/admin/vocabulary/new');
      }
      if (!Array.isArray(words)) words = [words];
      const { rows: course } = await pool.query(`SELECT language FROM language_courses WHERE id = $1 AND tenant_id = $2`, [courseId, tid]);
      await pool.query(`
        INSERT INTO vocabulary_sets (tenant_id, course_id, title, words, language, difficulty)
        VALUES ($1, $2, $3, $4, $5, $6)`,
        [tid, courseId, title, JSON.stringify(words), course[0]?.language || 'en', difficulty || 'A1']);
      audit(req, 'vocab_set_create', { course_id: courseId, title, word_count: words.length });
      req.flash('success', `Vocabulary set "${title}" created with ${words.length} words!`);
      res.redirect('/school/language-lab/admin/courses');
    } catch(e) { ah(e, req, res); }
  });

  /* ── Admin: Add Exercise ────────────────────────────────────────────── */
  app.get('/school/language-lab/admin/exercises/new', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const { rows: courses } = await pool.query(
        `SELECT id, title, language FROM language_courses WHERE tenant_id = $1 AND is_published = true ORDER BY title`, [tid]);
      const courseOpts = courses.map(c => `<option value="${c.id}">${langFlag(c.language)} ${esc(c.title)}</option>`).join('');
      const form = `<div class="card"><h2 style="margin:0 0 16px">✏️ Add Exercise</h2>
        <form method="post" action="/school/language-lab/admin/exercises/create">
          <div style="display:grid;gap:12px">
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Course *</label>
              <select name="course_id" required><option value="">Select course...</option>${courseOpts}</select></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Type *</label>
                <select name="type" required>${EXERCISE_TYPES.map(t => `<option value="${t}">${t}</option>`).join('')}</select></div>
              <div><label style="font-weight:600;display:block;margin-bottom:4px">Difficulty</label>
                <select name="difficulty">${CEFR_LEVELS.map(l => `<option value="${l}">${l}</option>`).join('')}</select></div>
            </div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Points</label>
              <input type="number" name="points" min="1" value="10"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Content (JSON) *</label>
              <p style="color:${GRAY};font-size:13px">Exercise content: prompt, sentences, questions, options, etc.</p>
              <textarea name="content" rows="6" required placeholder='{"prompt":"...","sentences":[...]}'></textarea></div>
            <div><label style="font-weight:600;display:block;margin-bottom:4px">Answers (JSON)</label>
              <textarea name="answers" rows="4" placeholder='{"q_0_0":"answer","correct":"option"}'></textarea></div>
            <button type="submit" class="btn" style="font-size:16px;padding:12px 32px">Create Exercise</button>
          </div>
        </form></div>`;
      renderPage(req, res, 'Add Exercise', SKIP + form);
    } catch(e) { ah(e, req, res); }
  });

  /* ── Admin: Create Exercise POST ────────────────────────────────────── */
  app.post('/school/language-lab/admin/exercises/create', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const courseId = parseInt(req.body.course_id) || 0;
      const { type, difficulty, content: contentStr, answers: answersStr } = req.body;
      const points = parseInt(req.body.points) || 10;
      if (!courseId || !type || !contentStr) {
        req.flash('error', 'Course, type, and content are required.');
        return res.redirect('/school/language-lab/admin/exercises/new');
      }
      let content;
      try { content = JSON.parse(contentStr); } catch(e) {
        req.flash('error', 'Invalid JSON for content.');
        return res.redirect('/school/language-lab/admin/exercises/new');
      }
      let answers = {};
      if (answersStr) { try { answers = JSON.parse(answersStr); } catch(e) { /* skip */ } }
      await pool.query(`
        INSERT INTO language_exercises (tenant_id, course_id, type, content, answers, difficulty, points)
        VALUES ($1, $2, $3, $4, $5, $6, $7)`,
        [tid, courseId, type, JSON.stringify(content), JSON.stringify(answers), difficulty || 'A1', points]);
      audit(req, 'exercise_create', { course_id: courseId, type, difficulty });
      req.flash('success', `Exercise created (${type}, ${difficulty})!`);
      res.redirect('/school/language-lab/admin/courses');
    } catch(e) { ah(e, req, res); }
  });

  /* ── API: Get Student Stats (for widgets) ───────────────────────────── */
  app.get('/school/language-lab/api/stats', requireAuth, async (req, res) => {
    try {
      const tid = req.tenant_id;
      const uid = req.session.userId;
      const { rows: stats } = await pool.query(`
        SELECT COUNT(DISTINCT course_id) as courses, SUM(xp_points) as total_xp,
               SUM(total_exercises_done) as exercises, MAX(streak_days) as best_streak,
               SUM(completed_lessons) as lessons
        FROM student_language_progress WHERE tenant_id = $1 AND student_id = $2`, [tid, uid]);
      const { rows: due } = await pool.query(`
        SELECT COUNT(*) as count FROM spaced_repetition_cards
        WHERE tenant_id = $1 AND student_id = $2 AND next_review <= now()`, [tid, uid]);
      res.json({ ...stats[0], due_cards: parseInt(due[0]?.count || 0) });
    } catch(e) { res.status(500).json({ error: e.message }); }
  });

  console.log('[LanguageLab] Module loaded – /school/language-lab');
};
