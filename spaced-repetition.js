/**
 * Spaced Repetition Flashcard Learning System
 * Implements SM-2 algorithm for optimal review scheduling
 * Module for school SaaS portal
 */
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  // ─── SM-2 Algorithm Helpers ──────────────────────────────────────────

  function sm2(easeFactor, interval, repetitions, quality) {
    // quality: 1=Again, 2=Hard, 3=Good, 4=Easy
    let q = Math.max(0, Math.min(5, quality));
    let ef = easeFactor;
    let iv = interval;
    let rep = repetitions;

    if (q < 3) {
      // Failed — reset repetitions
      rep = 0;
      iv = 1;
    } else {
      // Correct response
      if (rep === 0) {
        iv = 1;
      } else if (rep === 1) {
        iv = 6;
      } else {
        iv = Math.round(iv * ef);
      }
      rep++;
    }

    // Update ease factor
    ef = ef + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02));
    if (ef < 1.3) ef = 1.3;

    // Determine status
    let status = 'learning';
    if (rep >= 2 && ef >= 2.0) status = 'mastered';
    else if (rep >= 1) status = 'learning';

    return { easeFactor: ef, interval: iv, repetitions: rep, status };
  }

  function nextReviewDate(intervalDays) {
    const d = new Date();
    d.setDate(d.getDate() + intervalDays);
    return d;
  }

  function formatDuration(seconds) {
    if (!seconds || seconds < 0) return '0m';
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return m > 0 ? `${m}m ${s}s` : `${s}s`;
  }

  function dateStr(d) {
    if (!d) return '';
    return new Date(d).toISOString().slice(0, 10);
  }

  function escapeHtml(s) {
    return esc(s);
  }

  // ─── Create Tables ───────────────────────────────────────────────────

  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flashcard_decks (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        description TEXT,
        subject VARCHAR(100),
        topic VARCHAR(100),
        chapter VARCHAR(100),
        owner_id INT NOT NULL DEFAULT 0,
        owner_type TEXT NOT NULL DEFAULT 'student',
        card_count INT NOT NULL DEFAULT 0,
        new_count INT NOT NULL DEFAULT 0,
        learning_count INT NOT NULL DEFAULT 0,
        mastered_count INT NOT NULL DEFAULT 0,
        is_shared SMALLINT NOT NULL DEFAULT 0,
        share_count INT NOT NULL DEFAULT 0,
        download_count INT NOT NULL DEFAULT 0,
        avg_rating DECIMAL(3,2) NOT NULL DEFAULT 0.00,
        cover_color VARCHAR(20) DEFAULT '#6366f1',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flashcards (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        deck_id INT NOT NULL DEFAULT 0,
        front_content TEXT NOT NULL,
        back_content TEXT NOT NULL,
        card_type TEXT NOT NULL DEFAULT 'basic',
        options JSON,
        hint TEXT,
        audio_url VARCHAR(500),
        image_url VARCHAR(500),
        difficulty SMALLINT NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flashcard_progress (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        card_id INT NOT NULL DEFAULT 0,
        user_id INT NOT NULL DEFAULT 0,
        ease_factor DECIMAL(4,2) NOT NULL DEFAULT 2.50,
        interval_days INT NOT NULL DEFAULT 0,
        repetitions INT NOT NULL DEFAULT 0,
        next_review_date DATE,
        last_review_date DATE,
        last_quality SMALLINT DEFAULT NULL,
        total_reviews INT NOT NULL DEFAULT 0,
        correct_reviews INT NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'new',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_card_user UNIQUE (tenant_id, card_id, user_id)
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS study_sessions (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        user_id INT NOT NULL DEFAULT 0,
        deck_id INT NOT NULL DEFAULT 0,
        cards_reviewed INT NOT NULL DEFAULT 0,
        correct_count INT NOT NULL DEFAULT 0,
        hard_count INT NOT NULL DEFAULT 0,
        again_count INT NOT NULL DEFAULT 0,
        easy_count INT NOT NULL DEFAULT 0,
        duration_seconds INT NOT NULL DEFAULT 0,
        xp_earned INT NOT NULL DEFAULT 0,
        started_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        completed_at TIMESTAMPTZ DEFAULT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS flashcard_imports (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        user_id INT NOT NULL DEFAULT 0,
        deck_id INT NOT NULL DEFAULT 0,
        source_type TEXT NOT NULL,
        cards_imported INT NOT NULL DEFAULT 0,
        errors JSON,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
      )
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS deck_ratings (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        deck_id INT NOT NULL DEFAULT 0,
        user_id INT NOT NULL DEFAULT 0,
        rating SMALLINT NOT NULL DEFAULT 5,
        review_text TEXT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        CONSTRAINT uk_deck_user UNIQUE (tenant_id, deck_id, user_id)
      )
    `);
  }

  // ─── Common CSS / Layout ─────────────────────────────────────────────

  const CSS = `
    :root { --primary:#6366f1; --primary-dark:#4f46e5; --accent:#8b5cf6;
      --bg:#f8fafc; --card:#fff; --text:#1e293b; --muted:#64748b;
      --green:#22c55e; --red:#ef4444; --orange:#f97316; --blue:#3b82f6;
      --border:#e2e8f0; --radius:12px; }
    * { box-sizing:border-box; margin:0; padding:0; }
    body { font-family:'Inter',system-ui,-apple-system,sans-serif; background:var(--bg); color:var(--text); line-height:1.6; }
    .container { max-width:1200px; margin:0 auto; padding:20px; }
    .header { display:flex; align-items:center; justify-content:space-between; margin-bottom:24px; flex-wrap:wrap; gap:12px; }
    .header h1 { font-size:1.75rem; color:var(--primary-dark); }
    .header h1 span { font-size:0.9rem; color:var(--muted); font-weight:400; display:block; }
    .btn { display:inline-flex; align-items:center; gap:6px; padding:10px 20px;
      border:none; border-radius:8px; font-size:0.9rem; cursor:pointer;
      text-decoration:none; font-weight:500; transition:all .2s; }
    .btn-primary { background:var(--primary); color:#fff; }
    .btn-primary:hover { background:var(--primary-dark); }
    .btn-secondary { background:var(--border); color:var(--text); }
    .btn-secondary:hover { background:#cbd5e1; }
    .btn-sm { padding:6px 14px; font-size:0.82rem; }
    .btn-danger { background:var(--red); color:#fff; }
    .btn-danger:hover { background:#dc2626; }
    .btn-success { background:var(--green); color:#fff; }
    .btn-success:hover { background:#16a34a; }
    .card { background:var(--card); border:1px solid var(--border); border-radius:var(--radius);
      padding:20px; margin-bottom:16px; }
    .card h3 { margin-bottom:12px; color:var(--primary-dark); }
    .grid { display:grid; gap:16px; }
    .grid-2 { grid-template-columns:repeat(auto-fill,minmax(340px,1fr)); }
    .grid-3 { grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); }
    .grid-4 { grid-template-columns:repeat(auto-fill,minmax(220px,1fr)); }
    .stat-box { text-align:center; padding:16px; }
    .stat-box .num { font-size:2rem; font-weight:700; color:var(--primary); }
    .stat-box .label { font-size:0.85rem; color:var(--muted); margin-top:4px; }
    .progress-bar { height:8px; background:var(--border); border-radius:4px; overflow:hidden; }
    .progress-bar .fill { height:100%; background:var(--green); border-radius:4px; transition:width .3s; }
    .progress-bar .fill.orange { background:var(--orange); }
    .progress-bar .fill.blue { background:var(--blue); }
    .progress-bar .fill.red { background:var(--red); }
    table { width:100%; border-collapse:collapse; }
    th,td { padding:10px 12px; text-align:left; border-bottom:1px solid var(--border); font-size:0.88rem; }
    th { background:var(--bg); font-weight:600; color:var(--muted); text-transform:uppercase; font-size:0.78rem; }
    tr:hover { background:#f1f5f9; }
    .badge { display:inline-block; padding:3px 10px; border-radius:20px; font-size:0.75rem; font-weight:500; }
    .badge-new { background:#dbeafe; color:#1d4ed8; }
    .badge-learning { background:#fef3c7; color:#b45309; }
    .badge-mastered { background:#dcfce7; color:#16a34a; }
    .badge-suspended { background:#f1f5f9; color:#64748b; }
    .badge-shared { background:#f3e8ff; color:#7c3aed; }
    form label { display:block; font-weight:500; margin-bottom:4px; font-size:0.88rem; }
    form input,form select,form textarea { width:100%; padding:10px 12px; border:1px solid var(--border);
      border-radius:8px; font-size:0.9rem; margin-bottom:12px; }
    form textarea { min-height:80px; resize:vertical; }
    .form-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .flashcard-container { perspective:1000px; width:100%; max-width:560px; height:340px; margin:20px auto; cursor:pointer; }
    .flashcard-inner { position:relative; width:100%; height:100%; transition:transform 0.6s; transform-style:preserve-3d; }
    .flashcard-inner.flipped { transform:rotateY(180deg); }
    .flashcard-front,.flashcard-back { position:absolute; width:100%; height:100%;
      backface-visibility:hidden; border-radius:var(--radius); display:flex;
      align-items:center; justify-content:center; padding:30px; text-align:center;
      font-size:1.2rem; box-shadow:0 4px 20px rgba(0,0,0,0.1); }
    .flashcard-front { background:linear-gradient(135deg,#6366f1,#8b5cf6); color:#fff; }
    .flashcard-back { background:var(--card); color:var(--text); border:2px solid var(--primary);
      transform:rotateY(180deg); }
    .rating-btns { display:flex; gap:10px; justify-content:center; margin-top:20px; flex-wrap:wrap; }
    .rating-btn { padding:12px 24px; border:none; border-radius:10px; font-size:0.95rem;
      font-weight:600; cursor:pointer; transition:all .2s; color:#fff; min-width:90px; }
    .rating-btn:hover { transform:translateY(-2px); box-shadow:0 4px 12px rgba(0,0,0,0.2); }
    .rating-btn.again { background:var(--red); }
    .rating-btn.hard { background:var(--orange); }
    .rating-btn.good { background:var(--green); }
    .rating-btn.easy { background:var(--blue); }
    .heatmap-grid { display:grid; grid-template-columns:repeat(20,1fr); gap:3px; }
    .heatmap-cell { width:100%; aspect-ratio:1; border-radius:3px; background:#e2e8f0; }
    .heatmap-cell.l1 { background:#bbf7d0; }
    .heatmap-cell.l2 { background:#86efac; }
    .heatmap-cell.l3 { background:#4ade80; }
    .heatmap-cell.l4 { background:#22c55e; }
    .bar-chart { display:flex; align-items:end; gap:6px; height:140px; padding:10px 0; }
    .bar-chart .bar { flex:1; background:var(--primary); border-radius:4px 4px 0 0; min-width:16px;
      transition:height .3s; position:relative; }
    .bar-chart .bar-label { font-size:0.7rem; text-align:center; color:var(--muted); margin-top:4px; }
    .tabs { display:flex; gap:4px; margin-bottom:20px; flex-wrap:wrap; }
    .tab { padding:8px 18px; border:1px solid var(--border); border-radius:8px; background:var(--card);
      cursor:pointer; font-size:0.88rem; text-decoration:none; color:var(--text); transition:all .2s; }
    .tab.active { background:var(--primary); color:#fff; border-color:var(--primary); }
    .search-bar { display:flex; gap:8px; margin-bottom:16px; }
    .search-bar input { flex:1; }
    .empty-state { text-align:center; padding:40px; color:var(--muted); }
    .empty-state .icon { font-size:3rem; margin-bottom:12px; }
    .streak-fire { font-size:1.5rem; }
    .deck-cover { width:48px; height:48px; border-radius:10px; display:inline-block; vertical-align:middle; margin-right:10px; }
    .tag { display:inline-block; padding:2px 8px; background:#f1f5f9; border-radius:4px; font-size:0.78rem; color:var(--muted); margin-right:4px; }
    .stars { color:#fbbf24; letter-spacing:2px; }
    .modal-overlay { display:none; position:fixed; top:0; left:0; right:0; bottom:0;
      background:rgba(0,0,0,0.5); z-index:1000; align-items:center; justify-content:center; }
    .modal-overlay.open { display:flex; }
    .modal { background:#fff; border-radius:var(--radius); padding:24px; max-width:540px;
      width:90%; max-height:85vh; overflow-y:auto; }
    .modal h3 { margin-bottom:16px; }
    .chip { display:inline-flex; align-items:center; gap:4px; padding:4px 12px;
      background:var(--primary); color:#fff; border-radius:20px; font-size:0.82rem; margin:2px; }
    .chip .remove { cursor:pointer; font-weight:bold; margin-left:4px; }
    @media(max-width:600px) {
      .form-row { grid-template-columns:1fr; }
      .grid-2,.grid-3,.grid-4 { grid-template-columns:1fr; }
      .flashcard-container { height:280px; }
    }
  `;

  function page(title, body, opts2) {
    return renderPage(title, `<!DOCTYPE html><html lang="en"><head>
      <meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${esc(title)}</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
      <style>${CSS}</style>
      ${(opts2 && opts2.head) || ''}
    </head><body><div class="container">${body}</div>
    ${(opts2 && opts2.scripts) || ''}</body></html>`, (opts2 && opts2.req) ? opts2.req.user : null);
  }

  // ─── Refresh Deck Counts ─────────────────────────────────────────────

  async function refreshDeckCounts(tid, deckId) {
    const totalCards = await pool.query(
      'SELECT COUNT(*) as cnt FROM flashcards WHERE tenant_id=? AND deck_id=?', [tid, deckId]
    );
    const cardCount = totalCards[0][0].cnt;
    if (cardCount === 0) return;

    // Get progress for this deck's cards
    const progressData = await pool.query(`
      SELECT p.status, COUNT(*) as cnt
      FROM flashcard_progress p
      JOIN flashcards c ON c.id = p.card_id AND c.tenant_id = p.tenant_id
      WHERE p.tenant_id=? AND c.deck_id=? AND c.tenant_id=?
      GROUP BY p.status
    `, [tid, deckId, tid]);

    const counts = { new: 0, learning: 0, mastered: 0, suspended: 0 };
    for (const row of progressData[0]) {
      counts[row.status] = row.cnt;
    }
    counts.new = Math.max(0, cardCount - counts.learning - counts.mastered - counts.suspended);

    await pool.query(`
      UPDATE flashcard_decks SET card_count=?, new_count=?, learning_count=?, mastered_count=?,
        updated_at=NOW() WHERE id=? AND tenant_id=?
    `, [cardCount, counts.new, counts.learning, counts.mastered, deckId, tid]);
  }

  // ─── XP & Gamification ───────────────────────────────────────────────

  function calculateXP(quality, isReview) {
    const base = { 1: 0, 2: 5, 3: 10, 4: 15 };
    return (base[quality] || 0) + (isReview ? 0 : 5); // bonus for new cards
  }

  async function getUserStats(tid, userId) {
    const rows = await pool.query(`
      SELECT
        COALESCE(SUM(cards_reviewed),0) as total_reviews,
        COALESCE(SUM(correct_count),0) as total_correct,
        COALESCE(SUM(xp_earned),0) as total_xp,
        COALESCE(SUM(duration_seconds),0) as total_time,
        COUNT(DISTINCT DATE(started_at)) as study_days
      FROM study_sessions WHERE tenant_id=? AND user_id=?
    `, [tid, userId]);
    return rows[0][0];
  }

  async function getStudyStreak(tid, userId) {
    const rows = await pool.query(`
      SELECT DISTINCT DATE(started_at) as study_date
      FROM study_sessions WHERE tenant_id=? AND user_id=? AND started_at >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
      ORDER BY study_date DESC
    `, [tid, userId]);
    const dates = rows[0].map(r => r.study_date.toISOString().slice(0, 10));
    if (dates.length === 0) return { current: 0, longest: 0 };
    const today = new Date().toISOString().slice(0, 10);
    let streak = 0;
    let checkDate = new Date();
    // If didn't study today, start from yesterday
    if (dates[0] !== today) checkDate.setDate(checkDate.getDate() - 1);
    for (let i = 0; i < 365; i++) {
      const ds = checkDate.toISOString().slice(0, 10);
      if (dates.includes(ds)) {
        streak++;
        checkDate.setDate(checkDate.getDate() - 1);
      } else break;
    }
    // Calculate longest streak
    let longest = 0, cur = 1;
    for (let i = 1; i < dates.length; i++) {
      const prev = new Date(dates[i - 1]);
      const curr = new Date(dates[i]);
      const diff = (prev - curr) / (1000 * 60 * 60 * 24);
      if (Math.abs(diff - 1) < 0.1) cur++;
      else { longest = Math.max(longest, cur); cur = 1; }
    }
    longest = Math.max(longest, cur);
    return { current: streak, longest };
  }

  // ─── Routes ──────────────────────────────────────────────────────────

  // GET /school/flashcards — Dashboard
  app.get('/school/flashcards', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    await ensureTables();
    const userStats = await getUserStats(tid, uid);
    const streak = await getStudyStreak(tid, uid);

    // Due cards today
    const dueCards = await pool.query(`
      SELECT c.id, c.front_content, c.deck_id, d.name as deck_name, d.cover_color,
        p.ease_factor, p.interval_days, p.repetitions, p.status
      FROM flashcard_progress p
      JOIN flashcards c ON c.id = p.card_id AND c.tenant_id = p.tenant_id
      LEFT JOIN flashcard_decks d ON d.id = c.deck_id AND d.tenant_id = c.tenant_id
      WHERE p.tenant_id=? AND p.user_id=? AND (p.next_review_date <= CURDATE() OR p.next_review_date IS NULL)
        AND p.status != 'suspended'
      ORDER BY p.next_review_date ASC LIMIT 50
    `, [tid, uid]);

    // Deck summary
    const decks = await pool.query(`
      SELECT d.*, (
        SELECT COUNT(*) FROM flashcard_progress p JOIN flashcards c ON c.id=p.card_id
        WHERE c.deck_id=d.id AND p.user_id=? AND p.tenant_id=d.tenant_id
          AND (p.next_review_date <= CURDATE() OR p.next_review_date IS NULL)
          AND p.status != 'suspended'
      ) as due_count
      FROM flashcard_decks d WHERE d.tenant_id=? AND d.owner_id=?
      ORDER BY d.updated_at DESC LIMIT 10
    `, [uid, tid, uid]);

    // Study goal (daily)
    const todaySessions = await pool.query(`
      SELECT COALESCE(SUM(cards_reviewed),0) as today_cards,
        COALESCE(SUM(xp_earned),0) as today_xp,
        COALESCE(SUM(duration_seconds),0) as today_time
      FROM study_sessions WHERE tenant_id=? AND user_id=? AND DATE(started_at)=CURDATE()
    `, [tid, uid]);
    const td = todaySessions[0][0];
    const dailyGoal = 20; // default
    const goalPct = Math.min(100, Math.round((td.today_cards / dailyGoal) * 100));

    // Badges
    const badges = [];
    if (userStats.total_reviews >= 100) badges.push({ name: 'Century Scholar', icon: '\u{1F4DA}', desc: '100 reviews completed' });
    if (streak.longest >= 7) badges.push({ name: 'Week Warrior', icon: '\u{1F525}', desc: '7-day study streak' });
    if (streak.longest >= 30) badges.push({ name: 'Monthly Master', icon: '\u{1F3C6}', desc: '30-day study streak' });
    if (userStats.total_xp >= 500) badges.push({ name: 'XP Hunter', icon: '\u{2B50}', desc: '500 XP earned' });
    if (userStats.total_xp >= 2000) badges.push({ name: 'XP Legend', icon: '\u{1F48E}', desc: '2000 XP earned' });
    if (userStats.study_days >= 30) badges.push({ name: 'Consistent Learner', icon: '\u{1F4AA}', desc: '30 days of study' });
    if (badges.length === 0) badges.push({ name: 'Getting Started', icon: '\u{1F31F}', desc: 'Begin your flashcard journey' });

    const body = `
      <div class="header">
        <h1>\u{1F4DA} Flashcards <span>Spaced Repetition Learning System</span></h1>
        <div>
          <a href="/school/flashcards/marketplace" class="btn btn-secondary btn-sm">\u{1F6D2} Marketplace</a>
          <a href="/school/flashcards/import" class="btn btn-secondary btn-sm">\u{1F4E5} Import</a>
          <a href="/school/flashcards/stats" class="btn btn-secondary btn-sm">\u{1F4CA} Stats</a>
          <a href="/school/flashcards/decks" class="btn btn-primary btn-sm">+ New Deck</a>
        </div>
      </div>

      <div class="grid grid-4" style="margin-bottom:20px;">
        <div class="card stat-box">
          <div class="num">${streak.current}<span class="streak-fire">\u{1F525}</span></div>
          <div class="label">Day Streak</div>
        </div>
        <div class="card stat-box">
          <div class="num">${dueCards[0].length}</div>
          <div class="label">Cards Due</div>
        </div>
        <div class="card stat-box">
          <div class="num">${userStats.total_xp}</div>
          <div class="label">Total XP</div>
        </div>
        <div class="card stat-box">
          <div class="num">${userStats.total_reviews}</div>
          <div class="label">Reviews Done</div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>\u{1F3AF} Daily Goal Progress</h3>
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;">
            <span>${td.today_cards} / ${dailyGoal} cards today</span>
            <span style="margin-left:auto;color:var(--primary);font-weight:600;">${goalPct}%</span>
          </div>
          <div class="progress-bar"><div class="fill" style="width:${goalPct}%"></div></div>
          <div style="margin-top:10px;font-size:0.85rem;color:var(--muted);">
            ${goalPct >= 100 ? '\u{2705} Goal reached! Great work!' : `${dailyGoal - td.today_cards} more cards to reach your daily goal`}
          </div>
          <div style="margin-top:12px;font-size:0.85rem;">
            Today: ${td.today_cards} cards &middot; ${td.today_xp} XP &middot; ${formatDuration(td.today_time)}
          </div>
        </div>
        <div class="card">
          <h3>\u{1F3C6} Badges</h3>
          <div style="display:flex;flex-wrap:wrap;gap:12px;">
            ${badges.map(b => `
              <div style="text-align:center;padding:10px;width:90px;">
                <div style="font-size:2rem;">${b.icon}</div>
                <div style="font-size:0.78rem;font-weight:600;margin-top:4px;">${esc(b.name)}</div>
                <div style="font-size:0.7rem;color:var(--muted);">${esc(b.desc)}</div>
              </div>
            `).join('')}
          </div>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <h3 style="margin:0;">\u{1F4CB} Due for Review</h3>
          ${dueCards[0].length > 0 ? `<a href="/school/flashcards/study/all" class="btn btn-primary btn-sm">\u{25B6} Study Now</a>` : ''}
        </div>
        ${dueCards[0].length === 0 ? `
          <div class="empty-state">
            <div class="icon">\u{2705}</div>
            <p>All caught up! No cards due for review.</p>
            <a href="/school/flashcards/decks" class="btn btn-secondary btn-sm" style="margin-top:12px;">Browse Decks</a>
          </div>
        ` : `
          <div style="max-height:320px;overflow-y:auto;">
            <table>
              <tr><th>Card</th><th>Deck</th><th>Status</th><th>Interval</th><th></th></tr>
              ${dueCards[0].slice(0, 20).map(c => `
                <tr>
                  <td>${esc(String(c.front_content).substring(0, 60))}${String(c.front_content).length > 60 ? '...' : ''}</td>
                  <td><span class="deck-cover" style="background:${esc(c.cover_color || '#6366f1')};"></span>${esc(c.deck_name)}</td>
                  <td><span class="badge badge-${esc(c.status)}">${esc(c.status)}</span></td>
                  <td>${c.interval_days}d</td>
                  <td><a href="/school/flashcards/study/${esc(c.deck_id)}" class="btn btn-sm btn-secondary">Study</a></td>
                </tr>
              `).join('')}
            </table>
            ${dueCards[0].length > 20 ? `<p style="text-align:center;margin-top:8px;color:var(--muted);font-size:0.85rem;">and ${dueCards[0].length - 20} more...</p>` : ''}
          </div>
        `}
      </div>

      <div class="card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;">
          <h3 style="margin:0;">\u{1F5C2}\u{FE0F} Your Decks</h3>
          <a href="/school/flashcards/decks" class="btn btn-secondary btn-sm">View All</a>
        </div>
        ${decks[0].length === 0 ? `
          <div class="empty-state">
            <div class="icon">\u{1F4DA}</div>
            <p>No decks yet. Create your first deck to start learning!</p>
            <a href="/school/flashcards/decks" class="btn btn-primary btn-sm" style="margin-top:12px;">+ Create Deck</a>
          </div>
        ` : `
          <div class="grid grid-3">
            ${decks[0].map(d => `
              <a href="/school/flashcards/decks/${esc(d.id)}" style="text-decoration:none;color:inherit;">
                <div class="card" style="border-left:4px solid ${esc(d.cover_color || '#6366f1')};cursor:pointer;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <span class="deck-cover" style="background:${esc(d.cover_color || '#6366f1')};flex-shrink:0;"></span>
                    <strong style="font-size:0.95rem;">${esc(d.name)}</strong>
                  </div>
                  <div style="font-size:0.82rem;color:var(--muted);margin-bottom:8px;">
                    ${esc(d.subject || '')} ${d.topic ? '&middot; ' + esc(d.topic) : ''} ${d.chapter ? '&middot; Ch. ' + esc(d.chapter) : ''}
                  </div>
                  <div style="display:flex;gap:8px;font-size:0.78rem;">
                    <span class="badge badge-new">${d.card_count} cards</span>
                    ${d.due_count > 0 ? `<span class="badge" style="background:#fef2f2;color:#dc2626;">${d.due_count} due</span>` : '<span class="badge badge-mastered">All done</span>'}
                  </div>
                  <div class="progress-bar" style="margin-top:8px;">
                    <div class="fill" style="width:${d.card_count > 0 ? Math.round((d.mastered_count / d.card_count) * 100) : 0}%"></div>
                  </div>
                  <div style="font-size:0.75rem;color:var(--muted);margin-top:4px;">
                    ${d.mastered_count}/${d.card_count} mastered
                  </div>
                </div>
              </a>
            `).join('')}
          </div>
        `}
      </div>
    `;
    res.send(page('Flashcards Dashboard', body, { req }));
  }));

  // GET /school/flashcards/decks — Deck list
  app.get('/school/flashcards/decks', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    await ensureTables();

    // Show deck form for new creation
    const body = `
      <div class="header">
        <h1>\u{1F5C2}\u{FE0F} Flashcard Decks</h1>
      </div>

      <div class="card" id="deckFormCard">
        <h3>\u{2795} Create New Deck</h3>
        <form method="POST" action="/school/flashcards/decks/save">
          <input type="hidden" name="id" value="">
          <div class="form-row">
            <div><label>Deck Name *</label><input name="name" required placeholder="e.g., Biology Chapter 5"></div>
            <div><label>Cover Color</label><input type="color" name="cover_color" value="#6366f1" style="height:42px;padding:4px;"></div>
          </div>
          <label>Description</label>
          <textarea name="description" placeholder="Brief description of this deck"></textarea>
          <div class="form-row">
            <div><label>Subject</label><input name="subject" placeholder="e.g., Biology"></div>
            <div><label>Topic</label><input name="topic" placeholder="e.g., Cell Division"></div>
          </div>
          <div class="form-row">
            <div><label>Chapter</label><input name="chapter" placeholder="e.g., Chapter 5"></div>
            <div>
              <label>Owner Type</label>
              <select name="owner_type">
                <option value="student">Student</option>
                <option value="teacher">Teacher</option>
              </select>
            </div>
          </div>
          <button type="submit" class="btn btn-primary">\u{1F4BE} Save Deck</button>
        </form>
      </div>
      <div id="decksList"></div>
      <script>
        function loadDecks() {
          fetch('/school/flashcards/decks?api=1').then(r=>r.json()).then(data => {
            const c = document.getElementById('decksList');
            if (!data.decks || data.decks.length === 0) {
              c.innerHTML = '<div class="card empty-state"><div class="icon">\u{1F5C2}\u{FE0F}</div><p>No decks yet</p></div>';
              return;
            }
            c.innerHTML = '<div class="grid grid-3">' + data.decks.map(d => \`
              <div class="card" style="border-left:4px solid \${d.cover_color || '#6366f1'}">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                  <span class="deck-cover" style="background:\${d.cover_color || '#6366f1'};flex-shrink:0;"></span>
                  <strong>\${d.name}</strong>
                </div>
                <div style="font-size:0.82rem;color:var(--muted);margin-bottom:6px;">
                  \${d.subject || ''} \${d.topic ? '\u00B7 '+d.topic : ''} \${d.chapter ? '\u00B7 Ch.'+d.chapter : ''}
                </div>
                <p style="font-size:0.85rem;margin-bottom:8px;">\${d.description || 'No description'}</p>
                <div style="display:flex;gap:6px;font-size:0.78rem;margin-bottom:8px;">
                  <span class="badge badge-new">\${d.new_count} new</span>
                  <span class="badge badge-learning">\${d.learning_count} learning</span>
                  <span class="badge badge-mastered">\${d.mastered_count} mastered</span>
                  \${d.is_shared ? '<span class="badge badge-shared">Shared</span>' : ''}
                </div>
                <div style="display:flex;gap:6px;margin-top:8px;">
                  <a href="/school/flashcards/decks/\${d.id}" class="btn btn-sm btn-primary">View</a>
                  <a href="/school/flashcards/study/\${d.id}" class="btn btn-sm btn-success">Study</a>
                  <a href="/school/flashcards/export/\${d.id}" class="btn btn-sm btn-secondary">Export</a>
                  <button onclick="deleteDeck(\${d.id})" class="btn btn-sm btn-danger">Delete</button>
                </div>
              </div>
            \`).join('') + '</div>';
          });
        }
        function deleteDeck(id) {
          if (!confirm('Delete this deck and all its cards?')) return;
          fetch('/school/flashcards/decks/'+id, {method:'DELETE'}).then(r=>r.json()).then(()=>loadDecks());
        }
        loadDecks();
      </script>
    `;
    res.send(page('Flashcard Decks', body, { req }));
  }));

  // GET /school/flashcards/decks?api=1 — API for deck list
  app.get('/school/flashcards/decks', requireAuth, ah(async (req, res) => {
    if (req.query.api === '1') {
      const tid = req.session.user.tenant_id;
      const uid = req.session.user.id;
      const rows = await pool.query(
        'SELECT * FROM flashcard_decks WHERE tenant_id=? AND owner_id=? ORDER BY updated_at DESC', [tid, uid]
      );
      return res.json({ decks: rows[0] });
    }
  }));

  // POST /school/flashcards/decks/save
  app.post('/school/flashcards/decks/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { id, name, description, subject, topic, chapter, cover_color, owner_type } = req.body;
    if (!name) return res.redirect('/school/flashcards/decks');

    if (id) {
      await pool.query(`
        UPDATE flashcard_decks SET name=?, description=?, subject=?, topic=?, chapter=?,
          cover_color=?, owner_type=?, updated_at=NOW() WHERE id=? AND tenant_id=?
      `, [name, description, subject, topic, chapter, cover_color || '#6366f1', owner_type || 'student', id, tid]);
      audit('deck_updated', { deckId: id });
    } else {
      await pool.query(`
        INSERT INTO flashcard_decks (tenant_id, name, description, subject, topic, chapter, owner_id, owner_type, cover_color)
        VALUES (?,?,?,?,?,?,?,?,?)
      `, [tid, name, description, subject, topic, chapter, uid, owner_type || 'student', cover_color || '#6366f1']);
      audit('deck_created', { name });
    }
    res.redirect('/school/flashcards/decks');
  }));

  // DELETE /school/flashcards/decks/:id
  app.delete('/school/flashcards/decks/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const did = parseInt(req.params.id);
    await pool.query('DELETE FROM flashcard_progress WHERE tenant_id=? AND card_id IN (SELECT id FROM flashcards WHERE tenant_id=? AND deck_id=?)', [tid, tid, did]);
    await pool.query('DELETE FROM flashcards WHERE tenant_id=? AND deck_id=?', [tid, did]);
    await pool.query('DELETE FROM deck_ratings WHERE tenant_id=? AND deck_id=?', [tid, did]);
    await pool.query('DELETE FROM flashcard_decks WHERE id=? AND tenant_id=? AND owner_id=?', [did, tid, uid]);
    audit('deck_deleted', { deckId: did });
    res.json({ ok: true });
  }));

  // GET /school/flashcards/decks/:id — Deck detail
  app.get('/school/flashcards/decks/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const did = parseInt(req.params.id);
    await ensureTables();

    const deck = await pool.query('SELECT * FROM flashcard_decks WHERE id=? AND tenant_id=?', [did, tid]);
    if (!deck[0].length) return res.status(404).send('Deck not found');
    const d = deck[0][0];

    const cards = await pool.query(`
      SELECT c.*, p.status, p.ease_factor, p.interval_days, p.repetitions, p.next_review_date,
        p.total_reviews, p.correct_reviews, p.last_review_date
      FROM flashcards c
      LEFT JOIN flashcard_progress p ON p.card_id=c.id AND p.user_id=? AND p.tenant_id=c.tenant_id
      WHERE c.tenant_id=? AND c.deck_id=? ORDER BY c.sort_order, c.id
    `, [uid, tid, did]);

    const body = `
      <div class="header">
        <h1><span class="deck-cover" style="background:${esc(d.cover_color || '#6366f1')};"></span>${esc(d.name)} <span>${esc(d.subject || '')} ${d.topic ? '&middot; ' + esc(d.topic) : ''}</span></h1>
        <div>
          <a href="/school/flashcards/browser?deck_id=${did}" class="btn btn-secondary btn-sm">\u{1F50D} Browser</a>
          <a href="/school/flashcards/study/${did}" class="btn btn-success btn-sm">\u{25B6} Study (${cards[0].length})</a>
          <a href="/school/flashcards/export/${did}" class="btn btn-secondary btn-sm">\u{1F4E4} Export</a>
          <a href="/school/flashcards/marketplace/publish/${did}" class="btn btn-sm" style="background:#f59e0b;color:#fff;">\u{1F6E1} Publish</a>
        </div>
      </div>

      <div class="card">
        <h3>\u{2795} Add New Card</h3>
        <form method="POST" action="/school/flashcards/cards/save">
          <input type="hidden" name="deck_id" value="${did}">
          <input type="hidden" name="id" value="">
          <div class="form-row">
            <div>
              <label>Card Type</label>
              <select name="card_type" id="cardTypeSelect" onchange="toggleCardFields()">
                <option value="basic">Basic (Front / Back)</option>
                <option value="multiple_choice">Multiple Choice</option>
                <option value="true_false">True / False</option>
                <option value="fill_blank">Fill in the Blank</option>
                <option value="image">Image-based</option>
              </select>
            </div>
            <div>
              <label>Difficulty (1-5)</label>
              <select name="difficulty">
                <option value="1">1 - Easy</option>
                <option value="2" selected>2 - Normal</option>
                <option value="3">3 - Medium</option>
                <option value="4">4 - Hard</option>
                <option value="5">5 - Very Hard</option>
              </select>
            </div>
          </div>
          <div id="frontFields">
            <label>Front (Question) *</label>
            <textarea name="front_content" required placeholder="Enter the question or prompt"></textarea>
          </div>
          <div id="mcOptions" style="display:none;">
            <label>Options (one per line, first = correct answer)</label>
            <textarea name="options" placeholder="Correct Answer\nOption B\nOption C\nOption D"></textarea>
          </div>
          <label>Back (Answer) *</label>
          <textarea name="back_content" required placeholder="Enter the answer"></textarea>
          <div id="imageFields" style="display:none;">
            <label>Image URL</label>
            <input name="image_url" placeholder="https://example.com/image.png">
          </div>
          <div class="form-row">
            <div>
              <label>Hint (optional)</label>
              <input name="hint" placeholder="Show before flipping card">
            </div>
            <div>
              <label>Audio Hint URL (optional)</label>
              <input name="audio_url" placeholder="https://example.com/audio.mp3">
            </div>
          </div>
          <button type="submit" class="btn btn-primary">\u{2795} Add Card</button>
        </form>
      </div>

      <div class="card">
        <h3>\u{1F4CB} Cards (${cards[0].length})</h3>
        ${cards[0].length === 0 ? `
          <div class="empty-state">
            <div class="icon">\u{1F4CF}</div>
            <p>No cards yet. Add your first card above!</p>
          </div>
        ` : `
          <div style="overflow-x:auto;">
            <table>
              <tr><th>#</th><th>Front</th><th>Type</th><th>Status</th><th>Reviews</th><th>Next Review</th><th>Actions</th></tr>
              ${cards[0].map((c, i) => `
                <tr>
                  <td>${i + 1}</td>
                  <td>${esc(String(c.front_content).substring(0, 50))}${String(c.front_content).length > 50 ? '...' : ''}</td>
                  <td><span class="tag">${esc(c.card_type)}</span></td>
                  <td><span class="badge badge-${esc(c.status || 'new')}">${esc(c.status || 'new')}</span></td>
                  <td>${c.total_reviews || 0} (${c.correct_reviews || 0}\u2713)</td>
                  <td>${c.next_review_date ? dateStr(c.next_review_date) : 'Now'}</td>
                  <td>
                    <button onclick="editCard(${c.id}, '${esc(c.card_type)}', \`${esc(c.front_content).replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`, \`${esc(c.back_content).replace(/`/g, '\\`').replace(/\\/g, '\\\\')}\`, '${esc(c.hint || '')}', '${esc(c.audio_url || '')}', '${esc(c.image_url || '')}', ${c.difficulty})" class="btn btn-sm btn-secondary">Edit</button>
                    <button onclick="deleteCard(${c.id})" class="btn btn-sm btn-danger">\u{2716}</button>
                  </td>
                </tr>
              `).join('')}
            </table>
          </div>
        `}
      </div>

      <script>
        function toggleCardFields() {
          const type = document.getElementById('cardTypeSelect').value;
          document.getElementById('mcOptions').style.display = type === 'multiple_choice' ? 'block' : 'none';
          document.getElementById('imageFields').style.display = type === 'image' ? 'block' : 'none';
          if (type === 'true_false') {
            document.querySelector('[name=back_content]').value = 'True';
          } else if (type === 'fill_blank') {
            // back is the answer, front contains ___
          }
        }
        function editCard(id, type, front, back, hint, audio, image, diff) {
          document.querySelector('[name=id]').value = id;
          document.querySelector('[name=front_content]').value = front;
          document.querySelector('[name=back_content]').value = back;
          document.querySelector('[name=hint]').value = hint || '';
          document.querySelector('[name=audio_url]').value = audio || '';
          document.querySelector('[name=image_url]').value = image || '';
          document.querySelector('[name=difficulty]').value = diff || 2;
          document.getElementById('cardTypeSelect').value = type;
          toggleCardFields();
          window.scrollTo({top:0,behavior:'smooth'});
        }
        function deleteCard(id) {
          if (!confirm('Delete this card?')) return;
          fetch('/school/flashcards/cards/'+id, {method:'DELETE'}).then(()=>location.reload());
        }
      </script>
    `;
    res.send(page('Deck: ' + d.name, body, { req }));
  }));

  // POST /school/flashcards/cards/save
  app.post('/school/flashcards/cards/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { id, deck_id, front_content, back_content, card_type, options, hint, audio_url, image_url, difficulty } = req.body;
    if (!deck_id || !front_content || !back_content) return res.redirect('back');

    let optionsJson = null;
    if (card_type === 'multiple_choice' && options) {
      const lines = options.split('\n').filter(l => l.trim());
      optionsJson = JSON.stringify({ correct: lines[0], options: lines });
    }

    if (id) {
      await pool.query(`
        UPDATE flashcards SET front_content=?, back_content=?, card_type=?, options=?,
          hint=?, audio_url=?, image_url=?, difficulty=?, updated_at=NOW()
        WHERE id=? AND tenant_id=?
      `, [front_content, back_content, card_type || 'basic', optionsJson, hint, audio_url, image_url, difficulty || 2, id, tid]);
      audit('card_updated', { cardId: id, deckId: deck_id });
    } else {
      await pool.query(`
        INSERT INTO flashcards (tenant_id, deck_id, front_content, back_content, card_type, options, hint, audio_url, image_url, difficulty)
        VALUES (?,?,?,?,?,?,?,?,?,?)
      `, [tid, deck_id, front_content, back_content, card_type || 'basic', optionsJson, hint, audio_url, image_url, difficulty || 2]);
      audit('card_created', { deckId: deck_id });
    }
    await refreshDeckCounts(tid, parseInt(deck_id));
    res.redirect(`/school/flashcards/decks/${deck_id}`);
  }));

  // DELETE /school/flashcards/cards/:id
  app.delete('/school/flashcards/cards/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const cid = parseInt(req.params.id);
    const card = await pool.query('SELECT deck_id FROM flashcards WHERE id=? AND tenant_id=?', [cid, tid]);
    const did = card[0][0]?.deck_id;
    await pool.query('DELETE FROM flashcard_progress WHERE tenant_id=? AND card_id=?', [tid, cid]);
    await pool.query('DELETE FROM flashcards WHERE id=? AND tenant_id=?', [cid, tid]);
    if (did) await refreshDeckCounts(tid, did);
    res.json({ ok: true });
  }));

  // GET /school/flashcards/study/:deckId — Study session
  app.get('/school/flashcards/study/:deckId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const did = req.params.deckId;
    await ensureTables();

    // Get due cards
    let cardRows;
    if (did === 'all') {
      cardRows = await pool.query(`
        SELECT c.id, c.front_content, c.back_content, c.card_type, c.options, c.hint, c.audio_url, c.image_url,
          p.ease_factor, p.interval_days, p.repetitions, p.status
        FROM flashcards c
        JOIN flashcard_progress p ON p.card_id=c.id AND p.user_id=? AND p.tenant_id=c.tenant_id
        WHERE c.tenant_id=? AND (p.next_review_date <= CURDATE() OR p.next_review_date IS NULL) AND p.status != 'suspended'
        ORDER BY p.next_review_date ASC, p.interval_days ASC LIMIT 200
      `, [uid, tid]);
    } else {
      // Get cards for this deck, prioritizing due cards then new
      cardRows = await pool.query(`
        SELECT c.id, c.front_content, c.back_content, c.card_type, c.options, c.hint, c.audio_url, c.image_url,
          p.ease_factor, p.interval_days, p.repetitions, p.status
        FROM flashcards c
        LEFT JOIN flashcard_progress p ON p.card_id=c.id AND p.user_id=? AND p.tenant_id=c.tenant_id
        WHERE c.tenant_id=? AND c.deck_id=?
        ORDER BY
          CASE WHEN p.status IS NULL THEN 0
               WHEN p.next_review_date <= CURDATE() OR p.next_review_date IS NULL THEN 1
               ELSE 2 END,
          p.interval_days ASC
        LIMIT 200
      `, [uid, tid, did]);
    }

    // Create or get active session
    const existingSession = await pool.query(`
      SELECT id FROM study_sessions WHERE tenant_id=? AND user_id=? AND deck_id=?
        AND completed_at IS NULL ORDER BY id DESC LIMIT 1
    `, [tid, uid, did === 'all' ? 0 : did]);

    let sessionId;
    if (existingSession[0].length > 0) {
      sessionId = existingSession[0][0].id;
    } else {
      const result = await pool.query(`
        INSERT INTO study_sessions (tenant_id, user_id, deck_id, started_at)
        VALUES (?,?,?,NOW())
      `, [tid, uid, did === 'all' ? 0 : did]);
      sessionId = result[0].insertId;
    }

    const cards = cardRows[0];
    const totalCards = cards.length;

    const body = `
      <div class="header">
        <h1>\u{1F4DA} Study Session <span>${totalCards} cards to review</span></h1>
        <div>
          <a href="/school/flashcards" class="btn btn-secondary btn-sm">\u{2716} Exit</a>
        </div>
      </div>

      <div id="studyArea">
        <div class="progress-bar" style="margin-bottom:20px;height:12px;">
          <div class="fill" id="studyProgress" style="width:0%"></div>
        </div>
        <div style="text-align:center;margin-bottom:12px;font-size:0.9rem;color:var(--muted);">
          <span id="progressText">Card 0 / ${totalCards}</span>
          <span id="timerText" style="margin-left:16px;">0:00</span>
        </div>

        <div class="flashcard-container" id="flashcardContainer" onclick="flipCard()">
          <div class="flashcard-inner" id="flashcardInner">
            <div class="flashcard-front" id="cardFront">
              <div>Click to flip</div>
            </div>
            <div class="flashcard-back" id="cardBack">
              <div></div>
            </div>
          </div>
        </div>

        <div id="hintArea" style="text-align:center;margin:8px 0;display:none;">
          <div style="padding:8px 16px;background:#fefce8;border-radius:8px;display:inline-block;font-size:0.9rem;">
            \u{1F4A1} <span id="hintText"></span>
          </div>
        </div>

        <div id="ratingBtns" style="display:none;" class="rating-btns">
          <button class="rating-btn again" onclick="rate(1)">Again<br><small>1d</small></button>
          <button class="rating-btn hard" onclick="rate(2)">Hard<br><small>modify</small></button>
          <button class="rating-btn good" onclick="rate(3)">Good<br><small>schedule</small></button>
          <button class="rating-btn easy" onclick="rate(4)">Easy<br><small>bonus</small></button>
        </div>
      </div>

      <div id="sessionComplete" style="display:none;" class="card">
        <div style="text-align:center;">
          <div style="font-size:3rem;margin-bottom:12px;">\u{1F389}</div>
          <h2>Session Complete!</h2>
          <div id="summaryContent"></div>
          <div style="margin-top:20px;">
            <a href="/school/flashcards" class="btn btn-primary">Back to Dashboard</a>
            <a href="/school/flashcards/study/${esc(did)}" class="btn btn-secondary" style="margin-left:8px;">Study Again</a>
          </div>
        </div>
      </div>

      <script>
        const cards = ${JSON.stringify(cards)};
        const sessionId = ${sessionId};
        const deckId = '${esc(did)}';
        let currentIdx = 0;
        let isFlipped = false;
        let stats = { reviewed:0, correct:0, hard:0, again:0, easy:0 };
        let startTime = Date.now();
        let timerInterval;

        function startTimer() {
          timerInterval = setInterval(() => {
            const elapsed = Math.floor((Date.now() - startTime) / 1000);
            const m = Math.floor(elapsed / 60);
            const s = elapsed % 60;
            document.getElementById('timerText').textContent = m + ':' + String(s).padStart(2, '0');
          }, 1000);
        }
        startTimer();

        function showCard(idx) {
          if (idx >= cards.length) { finishSession(); return; }
          currentIdx = idx;
          const card = cards[idx];
          isFlipped = false;
          document.getElementById('flashcardInner').classList.remove('flipped');
          document.getElementById('ratingBtns').style.display = 'none';

          // Front content
          let frontHtml = card.front_content;
          if (card.card_type === 'image' && card.image_url) {
            frontHtml = '<img src="' + card.image_url + '" style="max-width:100%;max-height:250px;border-radius:8px;object-fit:contain;"><br><br>' + frontHtml;
          }
          if (card.card_type === 'fill_blank') {
            frontHtml = card.front_content.replace(/___+/g, '<span style="border-bottom:3px dashed #fff;padding:0 20px;">&nbsp;&nbsp;&nbsp;</span>');
          }
          document.getElementById('cardFront').innerHTML = frontHtml;

          // Back content
          let backHtml = card.back_content;
          if (card.card_type === 'multiple_choice' && card.options) {
            try {
              const opts = JSON.parse(card.options);
              backHtml = '<strong>Correct Answer:</strong> ' + opts.correct + '<br><br><strong>Other Options:</strong><br>' +
                opts.options.filter((o,i) => i > 0).map(o => '<span style="display:block;margin:4px 0;">\u2716 ' + o + '</span>').join('');
            } catch(e) {}
          }
          if (card.card_type === 'true_false') {
            backHtml = '<strong>Answer: ' + card.back_content + '</strong>';
          }
          document.getElementById('cardBack').innerHTML = backHtml;

          // Hint
          if (card.hint) {
            document.getElementById('hintArea').style.display = 'block';
            document.getElementById('hintText').textContent = card.hint;
          } else {
            document.getElementById('hintArea').style.display = 'none';
          }

          // Audio hint
          // Update progress
          updateProgress();
        }

        function updateProgress() {
          const pct = cards.length > 0 ? Math.round((currentIdx / cards.length) * 100) : 0;
          document.getElementById('studyProgress').style.width = pct + '%';
          document.getElementById('progressText').textContent = 'Card ' + (currentIdx + 1) + ' / ' + cards.length;
        }

        function flipCard() {
          if (isFlipped) return;
          isFlipped = true;
          document.getElementById('flashcardInner').classList.add('flipped');
          document.getElementById('ratingBtns').style.display = 'flex';
        }

        function rate(quality) {
          if (!isFlipped) return;
          stats.reviewed++;
          if (quality >= 3) stats.correct++;
          if (quality === 1) stats.again++;
          if (quality === 2) stats.hard++;
          if (quality === 4) stats.easy++;

          const card = cards[currentIdx];
          fetch('/school/flashcards/study/answer', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ card_id:card.id, quality, session_id:sessionId, deck_id:deckId })
          }).then(() => showCard(currentIdx + 1));
        }

        function finishSession() {
          clearInterval(timerInterval);
          const duration = Math.floor((Date.now() - startTime) / 1000);
          fetch('/school/flashcards/study/session/summary?session_id=' + sessionId + '&duration=' + duration)
            .then(r=>r.json()).then(data => {
              document.getElementById('studyArea').style.display = 'none';
              document.getElementById('sessionComplete').style.display = 'block';
              const accuracy = stats.reviewed > 0 ? Math.round((stats.correct / stats.reviewed) * 100) : 0;
              document.getElementById('summaryContent').innerHTML = \`
                <div class="grid grid-4" style="margin:20px 0;">
                  <div class="card stat-box"><div class="num">\${stats.reviewed}</div><div class="label">Cards Reviewed</div></div>
                  <div class="card stat-box"><div class="num">\${accuracy}%</div><div class="label">Accuracy</div></div>
                  <div class="card stat-box"><div class="num">\${data.xp_earned || 0}</div><div class="label">XP Earned</div></div>
                  <div class="card stat-box"><div class="num">\${Math.floor(duration/60)}m \${duration%60}s</div><div class="label">Time Spent</div></div>
                </div>
                <div class="grid grid-4">
                  <div class="card stat-box"><div class="num" style="color:var(--green);">\${stats.correct}</div><div class="label">Correct</div></div>
                  <div class="card stat-box"><div class="num" style="color:var(--red);">\${stats.again}</div><div class="label">Again</div></div>
                  <div class="card stat-box"><div class="num" style="color:var(--orange);">\${stats.hard}</div><div class="label">Hard</div></div>
                  <div class="card stat-box"><div class="num" style="color:var(--blue);">\${stats.easy}</div><div class="label">Easy</div></div>
                </div>
              \`;
            });
        }

        ${cards.length > 0 ? 'showCard(0);' : 'document.getElementById("studyArea").innerHTML = \'<div class="card empty-state"><div class="icon">\\u{1F389}</div><h2>No cards to study!</h2><p>All cards are up to date. Great work!</p><a href="/school/flashcards" class="btn btn-primary" style="margin-top:12px;">Back to Dashboard</a></div>\';'}
      </script>
    `;
    res.send(page('Study Session', body, { req }));
  }));

  // POST /school/flashcards/study/answer
  app.post('/school/flashcards/study/answer', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { card_id, quality, session_id, deck_id } = req.body;
    const q = parseInt(quality);
    const cid = parseInt(card_id);
    const sid = parseInt(session_id);

    // Get or create progress record
    let prog = await pool.query(
      'SELECT * FROM flashcard_progress WHERE tenant_id=? AND card_id=? AND user_id=?', [tid, cid, uid]
    );

    let ef, iv, rep, status;
    if (prog[0].length > 0) {
      const p = prog[0][0];
      const result = sm2(parseFloat(p.ease_factor), p.interval_days, p.repetitions, q);
      ef = result.easeFactor;
      iv = result.interval;
      rep = result.repetitions;
      status = result.status;
      const nextDate = nextReviewDate(iv);

      await pool.query(`
        UPDATE flashcard_progress SET ease_factor=?, interval_days=?, repetitions=?,
          next_review_date=?, last_review_date=CURDATE(), last_quality=?,
          total_reviews=total_reviews+1, correct_reviews=correct_reviews+?,
          status=? WHERE id=?
      `, [ef, iv, rep, nextDate, q, q >= 3 ? 1 : 0, status, p.id]);
    } else {
      const result = sm2(2.5, 0, 0, q);
      ef = result.easeFactor;
      iv = result.interval;
      rep = result.repetitions;
      status = result.status;
      const nextDate = nextReviewDate(iv);

      await pool.query(`
        INSERT INTO flashcard_progress (tenant_id, card_id, user_id, ease_factor, interval_days,
          repetitions, next_review_date, last_review_date, last_quality, total_reviews, correct_reviews, status)
        VALUES (?,?,?,?,?,?,CURDATE(),CURDATE(),?,1,?,?)
      `, [tid, cid, uid, ef, iv, rep, q, q >= 3 ? 1 : 0, status]);
    }

    // Update session stats
    const xp = calculateXP(q, prog[0].length > 0);
    await pool.query(`
      UPDATE study_sessions SET
        cards_reviewed = cards_reviewed + 1,
        correct_count = correct_count + (CASE WHEN ? >= 3 THEN 1 ELSE 0 END),
        hard_count = hard_count + (CASE WHEN ? = 2 THEN 1 ELSE 0 END),
        again_count = again_count + (CASE WHEN ? = 1 THEN 1 ELSE 0 END),
        easy_count = easy_count + (CASE WHEN ? = 4 THEN 1 ELSE 0 END),
        xp_earned = xp_earned + ?
      WHERE id=? AND tenant_id=? AND user_id=?
    `, [q, q, q, q, xp, sid, tid, uid]);

    // Refresh deck counts
    if (deck_id && deck_id !== 'all') {
      await refreshDeckCounts(tid, parseInt(deck_id));
    }

    res.json({ ok: true, xp });
  }));

  // GET /school/flashcards/study/session/summary
  app.get('/school/flashcards/study/session/summary', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const sid = parseInt(req.query.session_id);
    const duration = parseInt(req.query.duration) || 0;

    // Complete the session
    await pool.query(
      'UPDATE study_sessions SET completed_at=NOW(), duration_seconds=? WHERE id=? AND tenant_id=? AND user_id=? AND completed_at IS NULL',
      [duration, sid, tid, uid]
    );

    const session = await pool.query(
      'SELECT * FROM study_sessions WHERE id=? AND tenant_id=?', [sid, tid]
    );
    const s = session[0][0] || {};

    res.json({
      cards_reviewed: s.cards_reviewed || 0,
      correct_count: s.correct_count || 0,
      hard_count: s.hard_count || 0,
      again_count: s.again_count || 0,
      easy_count: s.easy_count || 0,
      duration_seconds: duration,
      xp_earned: s.xp_earned || 0
    });
  }));

  // GET /school/flashcards/browser — Card browser
  app.get('/school/flashcards/browser', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const deckFilter = req.query.deck_id || '';
    const statusFilter = req.query.status || '';
    const typeFilter = req.query.type || '';
    const searchQ = req.query.q || '';

    let sql = `
      SELECT c.*, d.name as deck_name, d.cover_color, p.status, p.ease_factor, p.interval_days,
        p.repetitions, p.total_reviews, p.correct_reviews, p.next_review_date, p.last_review_date
      FROM flashcards c
      JOIN flashcard_decks d ON d.id = c.deck_id AND d.tenant_id = c.tenant_id
      LEFT JOIN flashcard_progress p ON p.card_id=c.id AND p.user_id=? AND p.tenant_id=c.tenant_id
      WHERE c.tenant_id=?
    `;
    const params = [uid, tid];

    if (deckFilter) { sql += ' AND c.deck_id=?'; params.push(deckFilter); }
    if (statusFilter) { sql += ' AND p.status=?'; params.push(statusFilter); }
    if (typeFilter) { sql += ' AND c.card_type=?'; params.push(typeFilter); }
    if (searchQ) { sql += ' AND (c.front_content LIKE ? OR c.back_content LIKE ?)'; params.push(`%${searchQ}%`, `%${searchQ}%`); }

    sql += ' ORDER BY p.next_review_date ASC, c.id DESC LIMIT 200';

    const cards = await pool.query(sql, params);
    const decks = await pool.query('SELECT id, name FROM flashcard_decks WHERE tenant_id=? AND owner_id=?', [tid, uid]);

    const body = `
      <div class="header">
        <h1>\u{1F50D} Card Browser</h1>
      </div>

      <div class="card">
        <form method="GET" action="/school/flashcards/browser">
          <div class="search-bar">
            <input name="q" value="${esc(searchQ)}" placeholder="Search cards...">
            <select name="deck_id" style="width:180px;">
              <option value="">All Decks</option>
              ${decks[0].map(d => `<option value="${d.id}" ${d.id == deckFilter ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}
            </select>
            <select name="type" style="width:160px;">
              <option value="">All Types</option>
              <option value="basic" ${typeFilter === 'basic' ? 'selected' : ''}>Basic</option>
              <option value="multiple_choice" ${typeFilter === 'multiple_choice' ? 'selected' : ''}>Multiple Choice</option>
              <option value="true_false" ${typeFilter === 'true_false' ? 'selected' : ''}>True/False</option>
              <option value="fill_blank" ${typeFilter === 'fill_blank' ? 'selected' : ''}>Fill Blank</option>
              <option value="image" ${typeFilter === 'image' ? 'selected' : ''}>Image</option>
            </select>
            <select name="status" style="width:140px;">
              <option value="">All Status</option>
              <option value="new" ${statusFilter === 'new' ? 'selected' : ''}>New</option>
              <option value="learning" ${statusFilter === 'learning' ? 'selected' : ''}>Learning</option>
              <option value="mastered" ${statusFilter === 'mastered' ? 'selected' : ''}>Mastered</option>
              <option value="suspended" ${statusFilter === 'suspended' ? 'selected' : ''}>Suspended</option>
            </select>
            <button type="submit" class="btn btn-primary btn-sm">Search</button>
          </div>
        </form>
        ${cards[0].length > 0 ? `
          <div style="margin-bottom:10px;">
            <label style="display:inline-flex;align-items:center;gap:4px;font-size:0.85rem;">
              <input type="checkbox" id="selectAll"> Select All
            </label>
            <span style="margin-left:8px;font-size:0.82rem;color:var(--muted);">${cards[0].length} cards</span>
          </div>
          <div style="overflow-x:auto;">
            <table>
              <tr>
                <th><input type="checkbox" id="selectAll2"></th>
                <th>Front</th><th>Back</th><th>Deck</th><th>Type</th><th>Status</th>
                <th>EF</th><th>Reviews</th><th>Next</th><th>Actions</th>
              </tr>
              ${cards[0].map(c => `
                <tr data-id="${c.id}">
                  <td><input type="checkbox" class="card-select" value="${c.id}"></td>
                  <td>${esc(String(c.front_content).substring(0, 40))}${String(c.front_content).length > 40 ? '...' : ''}</td>
                  <td>${esc(String(c.back_content).substring(0, 40))}${String(c.back_content).length > 40 ? '...' : ''}</td>
                  <td><span class="tag">${esc(c.deck_name)}</span></td>
                  <td><span class="tag">${esc(c.card_type)}</span></td>
                  <td><span class="badge badge-${esc(c.status || 'new')}">${esc(c.status || 'new')}</span></td>
                  <td>${c.ease_factor ? c.ease_factor.toFixed(2) : '2.50'}</td>
                  <td>${c.total_reviews || 0}</td>
                  <td>${c.next_review_date ? dateStr(c.next_review_date) : '-'}</td>
                  <td>
                    <a href="/school/flashcards/decks/${c.deck_id}" class="btn btn-sm btn-secondary">Edit</a>
                  </td>
                </tr>
              `).join('')}
            </table>
          </div>
          <div style="margin-top:12px;display:flex;gap:8px;">
            <button class="btn btn-sm btn-secondary" onclick="bulkAction('suspend')">Suspend Selected</button>
            <button class="btn btn-sm btn-secondary" onclick="bulkAction('resume')">Resume Selected</button>
            <button class="btn btn-sm btn-danger" onclick="bulkAction('delete')">Delete Selected</button>
          </div>
        ` : `
          <div class="empty-state">
            <div class="icon">\u{1F50D}</div>
            <p>No cards found matching your criteria.</p>
          </div>
        `}
      </div>

      <script>
        document.getElementById('selectAll').onchange = function() {
          document.querySelectorAll('.card-select').forEach(cb => cb.checked = this.checked);
        };
        document.getElementById('selectAll2').onchange = function() {
          document.querySelectorAll('.card-select').forEach(cb => cb.checked = this.checked);
          document.getElementById('selectAll').checked = this.checked;
        };
        function getSelected() {
          return [...document.querySelectorAll('.card-select:checked')].map(cb => parseInt(cb.value));
        }
        function bulkAction(action) {
          const ids = getSelected();
          if (ids.length === 0) return alert('Select cards first');
          fetch('/school/flashcards/browser/bulk-edit', {
            method:'POST',
            headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ action, card_ids: ids })
          }).then(r=>r.json()).then(() => location.reload());
        }
      </script>
    `;
    res.send(page('Card Browser', body, { req }));
  }));

  // POST /school/flashcards/browser/bulk-edit
  app.post('/school/flashcards/browser/bulk-edit', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { action, card_ids } = req.body;
    if (!card_ids || !card_ids.length) return res.json({ ok: true, count: 0 });

    let count = 0;
    if (action === 'suspend') {
      // Get card deck_ids first
      const cards = await pool.query('SELECT DISTINCT deck_id FROM flashcards WHERE id IN (?) AND tenant_id=?', [card_ids, tid]);
      await pool.query(
        'UPDATE flashcard_progress SET status=? WHERE tenant_id=? AND user_id=? AND card_id IN (?)',
        ['suspended', tid, uid, card_ids]
      );
      for (const c of cards[0]) { if (c.deck_id) await refreshDeckCounts(tid, c.deck_id); }
      count = card_ids.length;
    } else if (action === 'resume') {
      const cards = await pool.query('SELECT DISTINCT deck_id FROM flashcards WHERE id IN (?) AND tenant_id=?', [card_ids, tid]);
      await pool.query(`
        UPDATE flashcard_progress SET status='learning', next_review_date=CURDATE(), interval_days=1
        WHERE tenant_id=? AND user_id=? AND card_id IN (?) AND status='suspended'
      `, [tid, uid, card_ids]);
      for (const c of cards[0]) { if (c.deck_id) await refreshDeckCounts(tid, c.deck_id); }
      count = card_ids.length;
    } else if (action === 'delete') {
      const cards = await pool.query('SELECT DISTINCT deck_id FROM flashcards WHERE id IN (?) AND tenant_id=?', [card_ids, tid]);
      await pool.query('DELETE FROM flashcard_progress WHERE tenant_id=? AND user_id=? AND card_id IN (?)', [tid, uid, card_ids]);
      await pool.query('DELETE FROM flashcards WHERE tenant_id=? AND id IN (?)', [tid, card_ids]);
      for (const c of cards[0]) { if (c.deck_id) await refreshDeckCounts(tid, c.deck_id); }
      count = card_ids.length;
    }
    audit('bulk_edit', { action, count });
    res.json({ ok: true, count });
  }));

  // GET /school/flashcards/import — Import page
  app.get('/school/flashcards/import', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const decks = await pool.query('SELECT id, name FROM flashcard_decks WHERE tenant_id=? AND owner_id=?', [tid, uid]);

    const body = `
      <div class="header">
        <h1>\u{1F4E5} Import Cards</h1>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>\u{1F4C4} Upload File</h3>
          <form method="POST" action="/school/flashcards/import/upload" enctype="multipart/form-data">
            <label>Target Deck *</label>
            <select name="deck_id" required>
              <option value="">Select deck...</option>
              ${decks[0].map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
            </select>
            <label>Create new deck</label>
            <input name="new_deck_name" placeholder="Leave blank to use selected deck">
            <label>File (CSV or JSON) *</label>
            <input type="file" name="file" accept=".csv,.json" required style="padding:8px;">
            <div style="margin:12px 0;padding:12px;background:var(--bg);border-radius:8px;font-size:0.82rem;">
              <strong>CSV Format:</strong> front_content,back_content,card_type,hint<br>
              <strong>JSON Format:</strong> Array of {front_content, back_content, card_type, hint, options, image_url, audio_url}
            </div>
            <button type="submit" class="btn btn-primary">\u{1F4E5} Import</button>
          </form>
        </div>

        <div class="card">
          <h3>\u{270D}\u{FE0F} Bulk Text Import</h3>
          <form method="POST" action="/school/flashcards/import/upload">
            <input type="hidden" name="source_type" value="text">
            <label>Target Deck *</label>
            <select name="deck_id" required>
              <option value="">Select deck...</option>
              ${decks[0].map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
            </select>
            <label>Create new deck</label>
            <input name="new_deck_name" placeholder="Leave blank to use selected deck">
            <label>Paste Cards (one per line, front | back)</label>
            <textarea name="bulk_text" style="min-height:200px;" placeholder="What is DNA? | Deoxyribonucleic acid&#10;What is ATP? | Adenosine Triphosphate&#10;What is mitosis? | Cell division producing two identical daughter cells"></textarea>
            <button type="submit" class="btn btn-primary">\u{2795} Import Cards</button>
          </form>
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <h3>\u{2139}\u{FE0F} Import History</h3>
        <div id="importHistory"></div>
        <script>
          fetch('/school/flashcards/import?api=1').then(r=>r.json()).then(data => {
            const c = document.getElementById('importHistory');
            if (!data.imports || data.imports.length === 0) {
              c.innerHTML = '<p style="color:var(--muted);font-size:0.9rem;">No imports yet.</p>';
              return;
            }
            c.innerHTML = '<table><tr><th>Deck</th><th>Source</th><th>Cards Imported</th><th>Date</th></tr>' +
              data.imports.map(i => \`<tr><td>\${i.deck_name}</td><td>\${i.source_type}</td><td>\${i.cards_imported}</td><td>\${i.created_at}</td></tr>\`).join('') +
              '</table>';
          });
        </script>
      </div>
    `;
    res.send(page('Import Cards', body, { req }));
  }));

  // GET /school/flashcards/import?api=1
  app.get('/school/flashcards/import', requireAuth, ah(async (req, res) => {
    if (req.query.api === '1') {
      const tid = req.session.user.tenant_id;
      const uid = req.session.user.id;
      const rows = await pool.query(`
        SELECT i.*, d.name as deck_name FROM flashcard_imports i
        LEFT JOIN flashcard_decks d ON d.id=i.deck_id AND d.tenant_id=i.tenant_id
        WHERE i.tenant_id=? AND i.user_id=? ORDER BY i.created_at DESC LIMIT 20
      `, [tid, uid]);
      return res.json({ imports: rows[0] });
    }
  }));

  // POST /school/flashcards/import/upload
  app.post('/school/flashcards/import/upload', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    let { deck_id, new_deck_name, source_type, bulk_text } = req.body;
    const file = req.files?.file;

    // Determine deck
    if (new_deck_name) {
      const result = await pool.query(`
        INSERT INTO flashcard_decks (tenant_id, name, owner_id, owner_type) VALUES (?,?,?,'student')
      `, [tid, new_deck_name, uid]);
      deck_id = result[0].insertId;
    } else {
      deck_id = parseInt(deck_id);
    }
    if (!deck_id) return res.redirect('/school/flashcards/import');

    let cards = [];
    let errors = [];
    let sType = source_type || 'csv';

    if (bulk_text) {
      // Text-based import: front | back
      const lines = bulk_text.split('\n').filter(l => l.trim());
      for (const line of lines) {
        const parts = line.split('|');
        if (parts.length >= 2) {
          cards.push({ front_content: parts[0].trim(), back_content: parts.slice(1).join('|').trim(), card_type: 'basic' });
        } else {
          errors.push('Invalid line: ' + line.substring(0, 50));
        }
      }
      sType = 'text';
    } else if (file) {
      const content = file.data.toString();
      if (file.name.endsWith('.json')) {
        sType = 'json';
        try {
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            cards = parsed.map(c => ({
              front_content: c.front_content || c.front || c.question || '',
              back_content: c.back_content || c.back || c.answer || '',
              card_type: c.card_type || c.type || 'basic',
              hint: c.hint || '',
              image_url: c.image_url || '',
              audio_url: c.audio_url || '',
              options: c.options ? JSON.stringify(c.options) : null
            }));
          }
        } catch (e) {
          errors.push('Invalid JSON: ' + e.message);
        }
      } else {
        sType = 'csv';
        // Parse CSV (simple)
        const lines = content.split('\n').filter(l => l.trim());
        const header = lines[0];
        const separator = header.includes('\t') ? '\t' : ',';
        for (let i = 1; i < lines.length; i++) {
          const cols = lines[i].split(separator).map(c => c.trim().replace(/^"|"$/g, ''));
          if (cols.length >= 2) {
            cards.push({
              front_content: cols[0],
              back_content: cols[1],
              card_type: cols[2] || 'basic',
              hint: cols[3] || ''
            });
          }
        }
      }
    }

    // Insert cards
    let imported = 0;
    for (const card of cards) {
      if (!card.front_content || !card.back_content) { errors.push('Missing content'); continue; }
      try {
        await pool.query(`
          INSERT INTO flashcards (tenant_id, deck_id, front_content, back_content, card_type, hint, image_url, audio_url, options)
          VALUES (?,?,?,?,?,?,?,?,?)
        `, [tid, deck_id, card.front_content, card.back_content, card.card_type, card.hint, card.image_url, card.audio_url, card.options]);
        imported++;
      } catch (e) {
        errors.push(e.message);
      }
    }

    // Record import
    await pool.query(`
      INSERT INTO flashcard_imports (tenant_id, user_id, deck_id, source_type, cards_imported, errors)
      VALUES (?,?,?,?,?,?)
    `, [tid, uid, deck_id, sType, imported, JSON.stringify(errors.slice(0, 50))]);

    await refreshDeckCounts(tid, deck_id);
    audit('cards_imported', { deck_id, imported, errors: errors.length });
    res.redirect(`/school/flashcards/decks/${deck_id}`);
  }));

  // GET /school/flashcards/export/:deckId
  app.get('/school/flashcards/export/:deckId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const did = parseInt(req.params.deckId);
    const format = req.query.format || 'json';

    const deck = await pool.query('SELECT * FROM flashcard_decks WHERE id=? AND tenant_id=?', [did, tid]);
    if (!deck[0].length) return res.status(404).send('Deck not found');

    const cards = await pool.query('SELECT * FROM flashcards WHERE tenant_id=? AND deck_id=? ORDER BY sort_order, id', [tid, did]);
    const d = deck[0][0];

    if (format === 'csv') {
      let csv = 'front_content,back_content,card_type,hint,image_url,audio_url\n';
      for (const c of cards[0]) {
        csv += `"${String(c.front_content).replace(/"/g, '""')}","${String(c.back_content).replace(/"/g, '""')}","${c.card_type}","${(c.hint||'').replace(/"/g, '""')}","${c.image_url||''}","${c.audio_url||''}"\n`;
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${d.name.replace(/[^a-z0-9]/gi, '_')}.csv"`);
      return res.send(csv);
    } else {
      const data = {
        deck: { name: d.name, description: d.description, subject: d.subject, topic: d.topic, chapter: d.chapter },
        cards: cards[0].map(c => ({
          front_content: c.front_content,
          back_content: c.back_content,
          card_type: c.card_type,
          options: c.options ? JSON.parse(c.options) : null,
          hint: c.hint,
          image_url: c.image_url,
          audio_url: c.audio_url,
          difficulty: c.difficulty
        }))
      };
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="${d.name.replace(/[^a-z0-9]/gi, '_')}.json"`);
      return res.json(data);
    }
  }));

  // GET /school/flashcards/stats — Detailed statistics
  app.get('/school/flashcards/stats', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;

    const userStats = await getUserStats(tid, uid);
    const streak = await getStudyStreak(tid, uid);

    // Retention rate
    const retention = await pool.query(`
      SELECT
        SUM(CASE WHEN correct_reviews > 0 THEN 1 ELSE 0 END) as cards_with_correct,
        COUNT(*) as total_cards
      FROM flashcard_progress WHERE tenant_id=? AND user_id=? AND total_reviews > 0
    `, [tid, uid]);
    const retData = retention[0][0];
    const retentionRate = retData.total_cards > 0 ? Math.round((retData.cards_with_correct / retData.total_cards) * 100) : 0;

    // Ease factor distribution
    const efDist = await pool.query(`
      SELECT
        CASE
          WHEN ease_factor < 1.8 THEN 'Very Hard'
          WHEN ease_factor < 2.2 THEN 'Hard'
          WHEN ease_factor < 2.6 THEN 'Normal'
          WHEN ease_factor < 3.0 THEN 'Easy'
          ELSE 'Very Easy'
        END as bucket,
        COUNT(*) as cnt,
        AVG(ease_factor) as avg_ef
      FROM flashcard_progress WHERE tenant_id=? AND user_id=? AND status != 'suspended'
      GROUP BY bucket ORDER BY MIN(ease_factor)
    `, [tid, uid]);

    // Cards learned per day (last 30 days)
    const dailyLearning = await pool.query(`
      SELECT DATE(completed_at) as day, SUM(cards_reviewed) as reviewed, SUM(correct_count) as correct
      FROM study_sessions WHERE tenant_id=? AND user_id=? AND completed_at IS NOT NULL
        AND completed_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
      GROUP BY DATE(completed_at) ORDER BY day ASC
    `, [tid, uid]);

    // Weakest subjects
    const weakSubjects = await pool.query(`
      SELECT d.subject,
        AVG(p.ease_factor) as avg_ef,
        COUNT(DISTINCT p.card_id) as card_count,
        SUM(p.again_count) as fail_count
      FROM flashcard_progress p
      JOIN flashcards c ON c.id=p.card_id AND c.tenant_id=p.tenant_id
      JOIN flashcard_decks d ON d.id=c.deck_id AND d.tenant_id=c.tenant_id
      WHERE p.tenant_id=? AND p.user_id=? AND d.subject IS NOT NULL AND d.subject != ''
      GROUP BY d.subject ORDER BY avg_ef ASC LIMIT 10
    `, [tid, uid]);

    // Predicted review load (next 7 days)
    const predictedLoad = await pool.query(`
      SELECT DATE(next_review_date) as review_date, COUNT(*) as card_count
      FROM flashcard_progress WHERE tenant_id=? AND user_id=?
        AND next_review_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
        AND status != 'suspended'
      GROUP BY DATE(next_review_date) ORDER BY review_date ASC
    `, [tid, uid]);

    // Status breakdown
    const statusBreakdown = await pool.query(`
      SELECT status, COUNT(*) as cnt FROM flashcard_progress
      WHERE tenant_id=? AND user_id=? GROUP BY status
    `, [tid, uid]);

    const statusMap = {};
    for (const row of statusBreakdown[0]) statusMap[row.status] = row.cnt;

    const maxDaily = dailyLearning[0].reduce((m, r) => Math.max(m, r.reviewed), 1);
    const maxPred = predictedLoad[0].reduce((m, r) => Math.max(m, r.card_count), 1);
    const maxEf = efDist[0].reduce((m, r) => Math.max(m, r.cnt), 1);

    const body = `
      <div class="header">
        <h1>\u{1F4CA} Learning Statistics</h1>
        <div>
          <a href="/school/flashcards/heatmap" class="btn btn-secondary btn-sm">\u{1F321}\u{FE0F} Heatmap</a>
          <a href="/school/flashcards" class="btn btn-primary btn-sm">\u{2190} Dashboard</a>
        </div>
      </div>

      <div class="grid grid-4" style="margin-bottom:20px;">
        <div class="card stat-box">
          <div class="num">${userStats.total_reviews}</div>
          <div class="label">Total Reviews</div>
        </div>
        <div class="card stat-box">
          <div class="num" style="color:${retentionRate >= 80 ? 'var(--green)' : retentionRate >= 60 ? 'var(--orange)' : 'var(--red)'};">${retentionRate}%</div>
          <div class="label">Retention Rate</div>
        </div>
        <div class="card stat-box">
          <div class="num">${streak.current}<span class="streak-fire">\u{1F525}</span></div>
          <div class="label">Current Streak</div>
        </div>
        <div class="card stat-box">
          <div class="num">${userStats.total_xp}</div>
          <div class="label">Total XP</div>
        </div>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>\u{1F4C8} Cards Reviewed (Last 30 Days)</h3>
          <div class="bar-chart">
            ${dailyLearning[0].map(r => `
              <div style="flex:1;text-align:center;">
                <div class="bar" style="height:${Math.round((r.reviewed / maxDaily) * 120)}px;background:var(--primary);"></div>
                <div class="bar-label">${r.day.toISOString().slice(8, 10)}</div>
              </div>
            `).join('')}
          </div>
        </div>

        <div class="card">
          <h3>\u{1F4C9} Predicted Review Load (Next 7 Days)</h3>
          <div class="bar-chart">
            ${predictedLoad[0].map(r => {
              const dayName = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'][new Date(r.review_date).getDay()];
              return `
                <div style="flex:1;text-align:center;">
                  <div style="font-size:0.8rem;font-weight:600;margin-bottom:2px;">${r.card_count}</div>
                  <div class="bar" style="height:${Math.round((r.card_count / maxPred) * 110)}px;background:${r.card_count > 50 ? 'var(--red)' : r.card_count > 20 ? 'var(--orange)' : 'var(--green)'};"></div>
                  <div class="bar-label">${dayName}</div>
                </div>
              `;
            }).join('')}
            ${predictedLoad[0].length === 0 ? '<div style="text-align:center;color:var(--muted);padding:40px;">No upcoming reviews</div>' : ''}
          </div>
        </div>

        <div class="card">
          <h3>\u{1F3AF} Card Status Breakdown</h3>
          <div style="margin:16px 0;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <span style="width:100px;">New</span>
              <div class="progress-bar" style="flex:1;"><div class="fill" style="width:${statusMap.new || 0}%;background:var(--blue);"></div></div>
              <span style="width:40px;text-align:right;">${statusMap.new || 0}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <span style="width:100px;">Learning</span>
              <div class="progress-bar" style="flex:1;"><div class="fill orange" style="width:${statusMap.learning || 0}%;"></div></div>
              <span style="width:40px;text-align:right;">${statusMap.learning || 0}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;">
              <span style="width:100px;">Mastered</span>
              <div class="progress-bar" style="flex:1;"><div class="fill" style="width:${statusMap.mastered || 0}%;"></div></div>
              <span style="width:40px;text-align:right;">${statusMap.mastered || 0}</span>
            </div>
            <div style="display:flex;align-items:center;gap:8px;">
              <span style="width:100px;">Suspended</span>
              <div class="progress-bar" style="flex:1;"><div class="fill red" style="width:${statusMap.suspended || 0}%;"></div></div>
              <span style="width:40px;text-align:right;">${statusMap.suspended || 0}</span>
            </div>
          </div>
        </div>

        <div class="card">
          <h3>\u{1F9E0} Ease Factor Distribution</h3>
          ${efDist[0].length === 0 ? '<p style="color:var(--muted);">No data yet. Study some cards first!</p>' : `
            <div style="margin:16px 0;">
              ${efDist[0].map(r => {
                const colors = { 'Very Hard': 'var(--red)', 'Hard': 'var(--orange)', 'Normal': 'var(--blue)', 'Easy': 'var(--green)', 'Very Easy': '#10b981' };
                return `
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;">
                    <span style="width:80px;font-size:0.85rem;">${r.bucket}</span>
                    <div class="progress-bar" style="flex:1;">
                      <div class="fill" style="width:${Math.round((r.cnt / maxEf) * 100)}%;background:${colors[r.bucket] || 'var(--primary)'};"></div>
                    </div>
                    <span style="width:60px;text-align:right;font-size:0.85rem;">${r.cnt} (${r.avg_ef.toFixed(2)})</span>
                  </div>
                `;
              }).join('')}
            </div>
          `}
        </div>

        <div class="card" style="grid-column:span 2;">
          <h3>\u{26A0}\u{FE0F} Weakest Subjects</h3>
          ${weakSubjects[0].length === 0 ? '<p style="color:var(--muted);">No subject data yet.</p>' : `
            <table>
              <tr><th>Subject</th><th>Avg Ease Factor</th><th>Cards</th><th>Strength</th></tr>
              ${weakSubjects[0].map(w => {
                const strength = w.avg_ef < 1.8 ? 'Very Weak' : w.avg_ef < 2.2 ? 'Weak' : w.avg_ef < 2.5 ? 'Average' : 'Strong';
                const color = w.avg_ef < 2.0 ? 'var(--red)' : w.avg_ef < 2.3 ? 'var(--orange)' : 'var(--green)';
                return `
                  <tr>
                    <td><strong>${esc(w.subject)}</strong></td>
                    <td style="color:${color};font-weight:600;">${w.avg_ef.toFixed(2)}</td>
                    <td>${w.card_count}</td>
                    <td><span class="badge" style="background:${color}22;color:${color};">${strength}</span></td>
                  </tr>
                `;
              }).join('')}
            </table>
          `}
        </div>

        <div class="card" style="grid-column:span 2;">
          <h3>\u{23F0} Study Time Summary</h3>
          <div class="grid grid-3">
            <div class="stat-box">
              <div class="num">${formatDuration(userStats.total_time)}</div>
              <div class="label">Total Study Time</div>
            </div>
            <div class="stat-box">
              <div class="num">${userStats.study_days}</div>
              <div class="label">Days Studied</div>
            </div>
            <div class="stat-box">
              <div class="num">${userStats.study_days > 0 ? formatDuration(Math.round(userStats.total_time / userStats.study_days)) : '0m'}</div>
              <div class="label">Avg per Day</div>
            </div>
          </div>
        </div>
      </div>
    `;
    res.send(page('Statistics', body, { req }));
  }));

  // GET /school/flashcards/heatmap — Study activity heatmap
  app.get('/school/flashcards/heatmap', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;

    // Last 20 weeks of activity
    const activity = await pool.query(`
      SELECT DATE(started_at) as day, SUM(cards_reviewed) as cnt
      FROM study_sessions WHERE tenant_id=? AND user_id=?
        AND started_at >= DATE_SUB(CURDATE(), INTERVAL 140 DAY)
      GROUP BY DATE(started_at)
    `, [tid, uid]);

    const activityMap = {};
    const maxCnt = activity[0].reduce((m, r) => m = Math.max(m, r.cnt), 1);
    for (const row of activity[0]) {
      activityMap[row.day.toISOString().slice(0, 10)] = row.cnt;
    }

    // Generate grid (20 weeks x 7 days)
    let cells = '';
    const today = new Date();
    for (let week = 19; week >= 0; week--) {
      for (let day = 6; day >= 0; day--) {
        const d = new Date(today);
        d.setDate(d.getDate() - (week * 7 + (6 - day)));
        const ds = d.toISOString().slice(0, 10);
        const cnt = activityMap[ds] || 0;
        let level = '';
        if (cnt > 0) level = cnt >= maxCnt * 0.75 ? 'l4' : cnt >= maxCnt * 0.5 ? 'l3' : cnt >= maxCnt * 0.25 ? 'l2' : 'l1';
        cells += `<div class="heatmap-cell ${level}" title="${ds}: ${cnt} reviews"></div>`;
      }
    }

    const body = `
      <div class="header">
        <h1>\u{1F321}\u{FE0F} Study Activity Heatmap</h1>
        <div><a href="/school/flashcards/stats" class="btn btn-primary btn-sm">\u{2190} Back to Stats</a></div>
      </div>

      <div class="card">
        <h3>Last 20 Weeks</h3>
        <div style="margin-top:12px;">
          <div style="display:flex;gap:4px;margin-bottom:8px;font-size:0.75rem;color:var(--muted);">
            <span style="width:24px;"></span>
            ${['Mon','','Wed','','Fri','','Sun'].map(d => `<div style="flex:1;text-align:center;">${d}</div>`).join('')}
          </div>
          <div class="heatmap-grid">${cells}</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:12px;justify-content:flex-end;font-size:0.8rem;color:var(--muted);">
            <span>Less</span>
            <div class="heatmap-cell" style="width:16px;height:16px;"></div>
            <div class="heatmap-cell l1" style="width:16px;height:16px;"></div>
            <div class="heatmap-cell l2" style="width:16px;height:16px;"></div>
            <div class="heatmap-cell l3" style="width:16px;height:16px;"></div>
            <div class="heatmap-cell l4" style="width:16px;height:16px;"></div>
            <span>More</span>
          </div>
        </div>
      </div>

      <div class="card" style="margin-top:16px;">
        <h3>Study Activity by Day of Week</h3>
        <div style="margin-top:12px;">
          ${['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((name, i) => {
            let total = 0;
            for (const row of activity[0]) {
              if (new Date(row.day).getDay() === i) total += row.cnt;
            }
            const maxDay = Math.max(...['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].map((_, j) => {
              let t = 0;
              for (const row of activity[0]) { if (new Date(row.day).getDay() === j) t += row.cnt; }
              return t;
            }), 1);
            return `
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                <span style="width:80px;font-size:0.85rem;">${name}</span>
                <div class="progress-bar" style="flex:1;">
                  <div class="fill" style="width:${Math.round((total / maxDay) * 100)}%;"></div>
                </div>
                <span style="width:60px;text-align:right;font-size:0.85rem;">${total} cards</span>
              </div>
            `;
          }).join('')}
        </div>
      </div>
    `;
    res.send(page('Study Heatmap', body, { req }));
  }));

  // GET /school/flashcards/marketplace — Shared decks marketplace
  app.get('/school/flashcards/marketplace', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;

    const sharedDecks = await pool.query(`
      SELECT d.*, u.first_name, u.last_name,
        (SELECT COUNT(*) FROM deck_ratings WHERE deck_id=d.id AND tenant_id=d.tenant_id) as rating_count
      FROM flashcard_decks d
      LEFT JOIN users u ON u.id=d.owner_id AND u.tenant_id=d.tenant_id
      WHERE d.tenant_id=? AND d.is_shared=1
      ORDER BY d.download_count DESC, d.avg_rating DESC
    `, [tid]);

    // Get user's own published decks
    const myDecks = await pool.query(
      'SELECT * FROM flashcard_decks WHERE tenant_id=? AND owner_id=? AND is_shared=1', [tid, uid]
    );

    const body = `
      <div class="header">
        <h1>\u{1F6D2} Deck Marketplace</h1>
        <div><a href="/school/flashcards" class="btn btn-primary btn-sm">\u{2190} Dashboard</a></div>
      </div>

      ${myDecks[0].length > 0 ? `
        <div class="card">
          <h3>\u{1F4CB} Your Published Decks</h3>
          <div class="grid grid-3" style="margin-top:12px;">
            ${myDecks[0].map(d => `
              <div class="card" style="border-left:4px solid ${esc(d.cover_color || '#6366f1')};">
                <strong>${esc(d.name)}</strong>
                <div style="font-size:0.82rem;color:var(--muted);margin:4px 0;">
                  ${d.card_count} cards &middot; ${d.download_count} downloads &middot; ${'<span class="stars">' + '\u{2B50}'.repeat(Math.round(d.avg_rating)) + '</span>'} ${d.avg_rating.toFixed(1)}
                </div>
                <a href="/school/flashcards/marketplace/${d.id}" class="btn btn-sm btn-secondary">View Details</a>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="card">
        <h3>\u{1F31F} Featured Decks</h3>
        ${sharedDecks[0].length === 0 ? `
          <div class="empty-state">
            <div class="icon">\u{1F6D2}</div>
            <p>No shared decks yet. Be the first to publish!</p>
          </div>
        ` : `
          <div class="grid grid-3" style="margin-top:12px;">
            ${sharedDecks[0].map(d => `
              <a href="/school/flashcards/marketplace/${d.id}" style="text-decoration:none;color:inherit;">
                <div class="card" style="border-left:4px solid ${esc(d.cover_color || '#6366f1')};cursor:pointer;">
                  <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span class="deck-cover" style="background:${esc(d.cover_color || '#6366f1')};flex-shrink:0;"></span>
                    <strong style="font-size:0.95rem;">${esc(d.name)}</strong>
                  </div>
                  <p style="font-size:0.85rem;color:var(--muted);margin-bottom:6px;">
                    by ${esc((d.first_name || '') + ' ' + (d.last_name || ''))} &middot; ${esc(d.subject || 'General')}
                  </p>
                  <p style="font-size:0.85rem;margin-bottom:8px;">${esc(String(d.description || '').substring(0, 100))}</p>
                  <div style="display:flex;gap:8px;font-size:0.82rem;align-items:center;">
                    <span class="badge badge-new">${d.card_count} cards</span>
                    <span class="stars">${'\u{2B50}'.repeat(Math.round(d.avg_rating))}</span>
                    <span>${d.avg_rating.toFixed(1)}</span>
                    <span style="margin-left:auto;">\u{2B07}\u{FE0F} ${d.download_count}</span>
                  </div>
                </div>
              </a>
            `).join('')}
          </div>
        `}
      </div>
    `;
    res.send(page('Deck Marketplace', body, { req }));
  }));

  // POST /school/flashcards/marketplace/publish/:deckId
  app.get('/school/flashcards/marketplace/publish/:deckId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const did = parseInt(req.params.deckId);
    await pool.query('UPDATE flashcard_decks SET is_shared=1 WHERE id=? AND tenant_id=?', [did, tid]);
    audit('deck_published', { deckId: did });
    res.redirect(`/school/flashcards/marketplace/${did}`);
  }));

  // GET /school/flashcards/marketplace/:id — Shared deck details
  app.get('/school/flashcards/marketplace/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const did = parseInt(req.params.id);

    const deck = await pool.query(`
      SELECT d.*, u.first_name, u.last_name
      FROM flashcard_decks d LEFT JOIN users u ON u.id=d.owner_id AND u.tenant_id=d.tenant_id
      WHERE d.id=? AND d.tenant_id=? AND d.is_shared=1
    `, [did, tid]);
    if (!deck[0].length) return res.status(404).send('Deck not found');
    const d = deck[0][0];

    const ratings = await pool.query(`
      SELECT r.*, u.first_name, u.last_name FROM deck_ratings r
      LEFT JOIN users u ON u.id=r.user_id AND u.tenant_id=r.tenant_id
      WHERE r.deck_id=? AND r.tenant_id=? ORDER BY r.created_at DESC LIMIT 20
    `, [did, tid]);

    const userRating = await pool.query(
      'SELECT * FROM deck_ratings WHERE deck_id=? AND tenant_id=? AND user_id=?', [did, tid, uid]
    );

    // Sample cards (first 5)
    const sampleCards = await pool.query(
      'SELECT front_content, card_type FROM flashcards WHERE tenant_id=? AND deck_id=? ORDER BY RAND() LIMIT 5', [tid, did]
    );

    const body = `
      <div class="header">
        <h1><span class="deck-cover" style="background:${esc(d.cover_color || '#6366f1')};"></span>${esc(d.name)}</h1>
        <a href="/school/flashcards/marketplace" class="btn btn-secondary btn-sm">\u{2190} Marketplace</a>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>Deck Info</h3>
          <p style="margin-bottom:12px;">${esc(d.description || 'No description')}</p>
          <div style="font-size:0.9rem;line-height:2;">
            <strong>Subject:</strong> ${esc(d.subject || 'N/A')}<br>
            <strong>Topic:</strong> ${esc(d.topic || 'N/A')}<br>
            <strong>Chapter:</strong> ${esc(d.chapter || 'N/A')}<br>
            <strong>Author:</strong> ${esc((d.first_name || '') + ' ' + (d.last_name || ''))}<br>
            <strong>Cards:</strong> ${d.card_count}<br>
            <strong>Downloads:</strong> ${d.download_count}<br>
            <strong>Rating:</strong> <span class="stars">${'\u{2B50}'.repeat(Math.round(d.avg_rating))}</span> ${d.avg_rating.toFixed(1)}
          </div>

          <div style="margin-top:16px;display:flex;gap:8px;">
            <button onclick="downloadDeck()" class="btn btn-primary">\u{2B07}\u{FE0F} Copy to My Decks</button>
            ${d.owner_id === uid ? '<button onclick="unpublish()" class="btn btn-secondary btn-sm">Unpublish</button>' : ''}
          </div>
        </div>

        <div class="card">
          <h3>Rate This Deck</h3>
          <form method="POST" action="/school/flashcards/marketplace/rate">
            <input type="hidden" name="deck_id" value="${did}">
            <div style="display:flex;gap:4px;margin-bottom:12px;">
              ${[1,2,3,4,5].map(n => `
                <button type="button" class="star-btn" onclick="setRating(${n})" id="star${n}"
                  style="font-size:2rem;background:none;border:none;cursor:pointer;color:${n <= (userRating[0][0]?.rating || 0) ? '#fbbf24' : '#d1d5db'};">\u{2B50}</button>
              `).join('')}
              <input type="hidden" name="rating" id="ratingInput" value="${userRating[0][0]?.rating || 5}">
            </div>
            <label>Review (optional)</label>
            <textarea name="review_text" placeholder="Share your thoughts about this deck...">${esc(userRating[0][0]?.review_text || '')}</textarea>
            <button type="submit" class="btn btn-primary btn-sm">Submit Rating</button>
          </form>
        </div>
      </div>

      ${sampleCards[0].length > 0 ? `
        <div class="card" style="margin-top:16px;">
          <h3>\u{1F441}\u{FE0F} Sample Cards</h3>
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-top:12px;">
            ${sampleCards[0].map(c => `
              <div style="background:var(--bg);border-radius:8px;padding:16px;min-width:200px;max-width:280px;flex:1;">
                <div style="font-size:0.78rem;color:var(--muted);margin-bottom:4px;">${esc(c.card_type)}</div>
                <div style="font-size:0.9rem;">${esc(String(c.front_content).substring(0, 100))}</div>
              </div>
            `).join('')}
          </div>
        </div>
      ` : ''}

      <div class="card" style="margin-top:16px;">
        <h3>\u{1F4AC} Reviews (${ratings[0].length})</h3>
        ${ratings[0].length === 0 ? '<p style="color:var(--muted);">No reviews yet.</p>' : `
          <div style="margin-top:12px;">
            ${ratings[0].map(r => `
              <div style="padding:12px;border-bottom:1px solid var(--border);">
                <div style="display:flex;align-items:center;gap:8px;">
                  <strong style="font-size:0.9rem;">${esc((r.first_name || '') + ' ' + (r.last_name || ''))}</strong>
                  <span class="stars" style="font-size:0.8rem;">${'\u{2B50}'.repeat(r.rating)}</span>
                  <span style="font-size:0.78rem;color:var(--muted);margin-left:auto;">${r.created_at ? dateStr(r.created_at) : ''}</span>
                </div>
                ${r.review_text ? `<p style="margin-top:6px;font-size:0.9rem;color:var(--muted);">${esc(r.review_text)}</p>` : ''}
              </div>
            `).join('')}
          </div>
        `}
      </div>

      <script>
        let currentRating = ${userRating[0][0]?.rating || 5};
        function setRating(n) {
          currentRating = n;
          document.getElementById('ratingInput').value = n;
          for (let i = 1; i <= 5; i++) {
            document.getElementById('star' + i).style.color = i <= n ? '#fbbf24' : '#d1d5db';
          }
        }
        function downloadDeck() {
          fetch('/school/flashcards/marketplace/${did}/download', {method:'POST'})
            .then(r=>r.json()).then(data => {
              if (data.ok) {
                alert('Deck copied to your collection!');
                location.href = '/school/flashcards/decks/' + data.new_deck_id;
              } else {
                alert(data.error || 'Error copying deck');
              }
            });
        }
        function unpublish() {
          fetch('/school/flashcards/marketplace/${did}/unpublish', {method:'POST'})
            .then(() => location.href = '/school/flashcards/marketplace');
        }
      </script>
    `;
    res.send(page('Marketplace: ' + d.name, body, { req }));
  }));

  // POST /school/flashcards/marketplace/:id/download
  app.post('/school/flashcards/marketplace/:id/download', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const sourceId = parseInt(req.params.id);

    const sourceDeck = await pool.query('SELECT * FROM flashcard_decks WHERE id=? AND tenant_id=? AND is_shared=1', [sourceId, tid]);
    if (!sourceDeck[0].length) return res.json({ ok: false, error: 'Deck not found' });
    const src = sourceDeck[0][0];

    // Create new deck
    const result = await pool.query(`
      INSERT INTO flashcard_decks (tenant_id, name, description, subject, topic, chapter, owner_id, owner_type, cover_color)
      VALUES (?,?,?,?,?,?,?,'student',?)
    `, [tid, src.name + ' (Copy)', src.description, src.subject, src.topic, src.chapter, uid, src.cover_color || '#6366f1']);
    const newDeckId = result[0].insertId;

    // Copy cards
    const sourceCards = await pool.query('SELECT * FROM flashcards WHERE tenant_id=? AND deck_id=?', [tid, sourceId]);
    for (const c of sourceCards[0]) {
      await pool.query(`
        INSERT INTO flashcards (tenant_id, deck_id, front_content, back_content, card_type, options, hint, audio_url, image_url, difficulty)
        VALUES (?,?,?,?,?,?,?,?,?)
      `, [tid, newDeckId, c.front_content, c.back_content, c.card_type, c.options, c.hint, c.audio_url, c.image_url, c.difficulty]);
    }

    // Increment download count
    await pool.query('UPDATE flashcard_decks SET download_count=download_count+1 WHERE id=? AND tenant_id=?', [sourceId, tid]);
    await refreshDeckCounts(tid, newDeckId);
    audit('deck_downloaded', { sourceId, newDeckId });
    res.json({ ok: true, new_deck_id: newDeckId });
  }));

  // POST /school/flashcards/marketplace/:id/unpublish
  app.post('/school/flashcards/marketplace/:id/unpublish', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const did = parseInt(req.params.id);
    await pool.query('UPDATE flashcard_decks SET is_shared=0 WHERE id=? AND tenant_id=? AND owner_id=?', [did, tid, uid]);
    res.json({ ok: true });
  }));

  // POST /school/flashcards/marketplace/rate
  app.post('/school/flashcards/marketplace/rate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { deck_id, rating, review_text } = req.body;
    if (!deck_id || !rating) return res.redirect('back');

    const existing = await pool.query(
      'SELECT id FROM deck_ratings WHERE deck_id=? AND tenant_id=? AND user_id=?', [deck_id, tid, uid]
    );

    if (existing[0].length > 0) {
      await pool.query(
        'UPDATE deck_ratings SET rating=?, review_text=? WHERE id=?', [rating, review_text, existing[0][0].id]
      );
    } else {
      await pool.query(
        'INSERT INTO deck_ratings (tenant_id, deck_id, user_id, rating, review_text) VALUES (?,?,?,?,?)',
        [tid, deck_id, uid, rating, review_text]
      );
    }

    // Update average rating on deck
    await pool.query(`
      UPDATE flashcard_decks SET avg_rating = (
        SELECT AVG(rating) FROM deck_ratings WHERE deck_id=? AND tenant_id=?
      ) WHERE id=? AND tenant_id=?
    `, [deck_id, tid, deck_id, tid]);

    res.redirect(`/school/flashcards/marketplace/${deck_id}`);
  }));

  // GET /school/flashcards/settings — Study preferences
  app.get('/school/flashcards/settings', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;

    // User settings stored in session or a simple key-value approach
    // For this module, we use a simple defaults approach
    const body = `
      <div class="header">
        <h1>\u{2699}\u{FE0F} Study Settings</h1>
        <a href="/school/flashcards" class="btn btn-primary btn-sm">\u{2190} Dashboard</a>
      </div>

      <div class="grid grid-2">
        <div class="card">
          <h3>\u{1F3AF} Daily Study Goals</h3>
          <form method="POST" action="/school/flashcards/settings/save">
            <label>Daily Card Goal</label>
            <input type="number" name="daily_goal" min="5" max="500" value="20">
            <p style="font-size:0.82rem;color:var(--muted);margin:-8px 0 12px;">Number of cards to review each day</p>

            <label>Daily Time Goal (minutes)</label>
            <input type="number" name="daily_time_goal" min="5" max="240" value="15">
            <p style="font-size:0.82rem;color:var(--muted);margin:-8px 0 12px;">Minutes of study per day</p>

            <label>Session Card Limit</label>
            <input type="number" name="session_limit" min="5" max="200" value="50">
            <p style="font-size:0.82rem;color:var(--muted);margin:-8px 0 12px;">Max cards per study session</p>
            <button type="submit" class="btn btn-primary btn-sm">Save Goals</button>
          </form>
        </div>

        <div class="card">
          <h3>\u{1F916} Study Preferences</h3>
          <form method="POST" action="/school/flashcards/settings/save">
            <label>Default Study Order</label>
            <select name="study_order">
              <option value="due">Due First (Recommended)</option>
              <option value="random">Random</option>
              <option value="hardest">Hardest First</option>
              <option value="newest">Newest First</option>
            </select>

            <label>Show Hints Automatically</label>
            <select name="auto_hints">
              <option value="1">Yes</option>
              <option value="0" selected>No</option>
            </select>

            <label>Audio Auto-Play</label>
            <select name="auto_audio">
              <option value="1">Yes</option>
              <option value="0" selected>No</option>
            </select>

            <label>Max New Cards per Day</label>
            <input type="number" name="max_new_per_day" min="5" max="100" value="20">

            <label>Easy Bonus Interval Multiplier</label>
            <select name="easy_bonus">
              <option value="1.3" selected>1.3x (Standard)</option>
              <option value="1.5">1.5x (Aggressive)</option>
              <option value="2.0">2.0x (Very Aggressive)</option>
            </select>

            <button type="submit" class="btn btn-primary btn-sm">Save Preferences</button>
          </form>
        </div>

        <div class="card">
          <h3>\u{26A0}\u{FE0F} Reset Options</h3>
          <p style="font-size:0.88rem;color:var(--muted);margin-bottom:12px;">Warning: These actions cannot be undone.</p>
          <div style="display:flex;flex-direction:column;gap:8px;">
            <button onclick="if(confirm('Reset all progress? Cards will be marked as new.')){location.href='/school/flashcards/settings/reset/progress'}" class="btn btn-sm" style="background:#fef2f2;color:#dc2626;border:1px solid #fecaca;">
              \u{1F504} Reset All Progress
            </button>
            <button onclick="if(confirm('Delete ALL your flashcard data?')){location.href='/school/flashcards/settings/reset/all'}" class="btn btn-sm btn-danger">
              \u{1F5D1}\u{FE0F} Delete All Flashcard Data
            </button>
          </div>
        </div>

        <div class="card">
          <h3>\u{2139}\u{FE0F} About Spaced Repetition</h3>
          <div style="font-size:0.88rem;line-height:1.7;color:var(--muted);">
            <p style="margin-bottom:8px;">This system uses the <strong>SM-2 algorithm</strong>, developed by Piotr Wozniak for SuperMemo. It schedules reviews at optimal intervals to maximize long-term retention.</p>
            <p style="margin-bottom:8px;"><strong>How ratings work:</strong></p>
            <ul style="padding-left:20px;margin-bottom:8px;">
              <li><span style="color:var(--red);font-weight:600;">Again (1)</span> — Forgot completely. Review again in 1 minute.</li>
              <li><span style="color:var(--orange);font-weight:600;">Hard (2)</span> — Difficult, but recalled. Shorter interval.</li>
              <li><span style="color:var(--green);font-weight:600;">Good (3)</span> — Normal recall. Standard interval.</li>
              <li><span style="color:var(--blue);font-weight:600;">Easy (4)</span> — No effort. Longer interval, bonus XP.</li>
            </ul>
            <p><strong>Tip:</strong> Be honest with yourself! Rating cards too easy will cause them to pile up later.</p>
          </div>
        </div>
      </div>
    `;
    res.send(page('Study Settings', body, { req }));
  }));

  // POST /school/flashcards/settings/save
  app.post('/school/flashcards/settings/save', requireAuth, ah(async (req, res) => {
    // Settings are stored per-user. In a real app, use a user_settings table.
    // For this module, we store in session for simplicity
    const settings = {};
    if (req.body.daily_goal) settings.daily_goal = parseInt(req.body.daily_goal);
    if (req.body.daily_time_goal) settings.daily_time_goal = parseInt(req.body.daily_time_goal);
    if (req.body.session_limit) settings.session_limit = parseInt(req.body.session_limit);
    if (req.body.study_order) settings.study_order = req.body.study_order;
    if (req.body.auto_hints !== undefined) settings.auto_hints = req.body.auto_hints === '1';
    if (req.body.auto_audio !== undefined) settings.auto_audio = req.body.auto_audio === '1';
    if (req.body.max_new_per_day) settings.max_new_per_day = parseInt(req.body.max_new_per_day);
    if (req.body.easy_bonus) settings.easy_bonus = parseFloat(req.body.easy_bonus);

    // Store in session
    if (!req.session.flashcardSettings) req.session.flashcardSettings = {};
    Object.assign(req.session.flashcardSettings, settings);
    audit('settings_saved', settings);
    res.redirect('/school/flashcards/settings');
  }));

  // GET /school/flashcards/settings/reset/progress
  app.get('/school/flashcards/settings/reset/progress', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    await pool.query(`
      UPDATE flashcard_progress SET ease_factor=2.50, interval_days=0, repetitions=0,
        next_review_date=CURDATE(), last_review_date=NULL, last_quality=NULL,
        total_reviews=0, correct_reviews=0, status='new'
      WHERE tenant_id=? AND user_id=?
    `, [tid, uid]);
    await pool.query('DELETE FROM study_sessions WHERE tenant_id=? AND user_id=?', [tid, uid]);

    // Refresh all deck counts
    const decks = await pool.query('SELECT id FROM flashcard_decks WHERE tenant_id=? AND owner_id=?', [tid, uid]);
    for (const d of decks[0]) await refreshDeckCounts(tid, d.id);

    audit('progress_reset');
    res.redirect('/school/flashcards');
  }));

  // GET /school/flashcards/settings/reset/all
  app.get('/school/flashcards/settings/reset/all', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const deckIds = await pool.query('SELECT id FROM flashcard_decks WHERE tenant_id=? AND owner_id=?', [tid, uid]);
    const ids = deckIds[0].map(d => d.id);
    if (ids.length > 0) {
      await pool.query('DELETE FROM flashcard_progress WHERE tenant_id=? AND card_id IN (SELECT id FROM flashcards WHERE tenant_id=? AND deck_id IN (?))', [tid, tid, ids]);
      await pool.query('DELETE FROM flashcards WHERE tenant_id=? AND deck_id IN (?)', [tid, ids]);
      await pool.query('DELETE FROM deck_ratings WHERE tenant_id=? AND deck_id IN (?)', [tid, ids]);
      await pool.query('DELETE FROM flashcard_decks WHERE tenant_id=? AND owner_id=?', [tid, uid]);
    }
    await pool.query('DELETE FROM study_sessions WHERE tenant_id=? AND user_id=?', [tid, uid]);
    await pool.query('DELETE FROM flashcard_imports WHERE tenant_id=? AND user_id=?', [tid, uid]);
    audit('all_data_reset');
    res.redirect('/school/flashcards');
  }));

  // ─── Initialize ──────────────────────────────────────────────────────

  ensureTables().then(() => {
    console.log('[spaced-repetition] Tables verified');
  }).catch(err => {
    console.error('[spaced-repetition] Table creation error:', err);
  });
};
