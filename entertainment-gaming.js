module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit } = opts;
  const P = '#f59e0b', P2 = '#ef4444', GRAY = '#6b7280';
  const SKIP = `<link rel="stylesheet" href="/css/sk.css"><style>
    .card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}
    .btn{display:inline-block;background:${P};color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;text-decoration:none;font-size:14px;text-align:center}
    .btn:hover{background:#d97706}.btn-red{background:${P2}}.btn-red:hover{background:#dc2626}
    .btn-green{background:#059669}.btn-green:hover{background:#047857}.btn-gray{background:${GRAY}}
    .btn-gray:hover{background:#4b5563}.btn-sm{padding:4px 10px;font-size:12px}
    .hero{background:linear-gradient(135deg,#f59e0b,#ef4444);color:#fff;padding:32px 24px;border-radius:16px;margin-bottom:24px}
    .badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600}
    .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
    .game-card{background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08);transition:transform .2s}
    .game-card:hover{transform:translateY(-3px)}
    .game-thumb{height:120px;display:flex;align-items:center;justify-content:center;font-size:48px}
    .star{color:#d1d5db}.star.active{color:#f59e0b}
    .tab{padding:6px 14px;border-radius:20px;cursor:pointer;font-size:13px;text-decoration:none;color:${GRAY};background:#f3f4f6}
    .tab.active{background:${P};color:#fff}
    table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb;font-size:13px}
    input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}
    .flex{display:flex;gap:12px;align-items:center}.flex-wrap{flex-wrap:wrap}
    .stat-box{text-align:center;padding:16px;border-radius:12px}
    .progress-bar{height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}.progress-fill{height:100%;border-radius:4px;transition:width .3s}
  </style>`;

  // ======================== DATABASE TABLES ========================
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_games (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, name VARCHAR(255) NOT NULL,
        slug TEXT UNIQUE, description TEXT, category VARCHAR(100),
        thumbnail_url VARCHAR(500), game_url VARCHAR(500),
        is_builtin BOOLEAN DEFAULT false, builtin_type TEXT,
        play_count INTEGER DEFAULT 0, avg_rating NUMERIC DEFAULT 0,
        is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_game_sessions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        game_id INTEGER REFERENCES ent_games(id), user_email VARCHAR(255),
        score INTEGER DEFAULT 0, time_played INTEGER DEFAULT 0,
        moves INTEGER DEFAULT 0, result TEXT,
        coins_earned INTEGER DEFAULT 0, played_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_game_tournaments (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, name VARCHAR(255) NOT NULL,
        game_id INTEGER REFERENCES ent_games(id), max_players INTEGER,
        start_date TIMESTAMPTZ, end_date TIMESTAMPTZ,
        prize_description TEXT, status TEXT DEFAULT 'open',
        created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_game_tournament_players (
        id SERIAL PRIMARY KEY, tournament_id INTEGER REFERENCES ent_game_tournaments(id),
        user_email VARCHAR(255), score INTEGER DEFAULT 0, joined_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_game_achievements (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, user_email VARCHAR(255),
        achievement_key TEXT, achievement_name VARCHAR(255),
        description TEXT, icon TEXT, unlocked_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, user_email, achievement_key)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_game_reviews (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        game_id INTEGER REFERENCES ent_games(id), user_email VARCHAR(255),
        rating INTEGER CHECK (rating BETWEEN 1 AND 5),
        review_text TEXT, created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, game_id, user_email)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_game_currency (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, user_email VARCHAR(255),
        balance INTEGER DEFAULT 0, total_earned INTEGER DEFAULT 0,
        total_spent INTEGER DEFAULT 0, updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, user_email)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_game_shop_items (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, name VARCHAR(255) NOT NULL,
        description TEXT, icon TEXT, price INTEGER,
        item_type VARCHAR(100), is_active BOOLEAN DEFAULT true
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_game_purchases (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, user_email VARCHAR(255),
        item_id INTEGER REFERENCES ent_game_shop_items(id),
        price INTEGER, purchased_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_game_daily_challenges (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        challenge_date DATE DEFAULT CURRENT_DATE,
        game_id INTEGER REFERENCES ent_games(id),
        challenge_text TEXT, target_score INTEGER DEFAULT 50,
        reward_coins INTEGER DEFAULT 50, UNIQUE(tenant_id, challenge_date)
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS ent_game_daily_completions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, user_email VARCHAR(255),
        challenge_id INTEGER REFERENCES ent_game_daily_challenges(id),
        completed BOOLEAN DEFAULT false, completed_at TIMESTAMPTZ
      )`);
      console.log('[EntertainmentGaming] All tables ready');
    } catch(e) { console.warn('[EntertainmentGaming] Migration warning:', e.message); }
  })();

  // ======================== HELPERS ========================
  const BASE = '/entertainment/games';
  const CATEGORIES = ['All','Puzzle','Arcade','Strategy','Trivia','Sports','Racing','Word','Math','Memory','Adventure','Board'];
  const BUILTIN_GAMES = [
    { name:'Memory Match', slug:'memory', category:'Memory', icon:'🃏', builtin_type:'memory', desc:'Flip cards and find matching pairs!' },
    { name:'Math Quiz', slug:'math-quiz', category:'Math', icon:'🧮', builtin_type:'math', desc:'Test your math skills with quick problems!' },
    { name:'Word Scramble', slug:'word-scramble', category:'Word', icon:'🔤', builtin_type:'word', desc:'Unscramble letters to form words!' },
    { name:'Trivia Challenge', slug:'trivia', category:'Trivia', icon:'❓', builtin_type:'trivia', desc:'Answer questions across multiple categories!' },
    { name:'Tic Tac Toe', slug:'tic-tac-toe', category:'Board', icon:'⭕', builtin_type:'tictactoe', desc:'Classic X and O — challenge the AI!' }
  ];
  const ACHIEVEMENT_DEFS = [
    { key:'first_win', name:'First Win', desc:'Win your first game', icon:'🏆' },
    { key:'score_100', name:'Score 100+', desc:'Achieve a score of 100 or more', icon:'💯' },
    { key:'play_10', name:'Play 10 Games', desc:'Complete 10 game sessions', icon:'🎮' },
    { key:'win_streak_5', name:'Win Streak 5', desc:'Win 5 games in a row', icon:'🔥' },
    { key:'speed_demon', name:'Speed Demon', desc:'Complete a game in under 30 seconds', icon:'⚡' },
    { key:'perfect_score', name:'Perfect Score', desc:'Get a perfect score in any game', icon:'✨' },
    { key:'marathon', name:'Marathon', desc:'Play games for 1 hour total', icon:'🏃' }
  ];

  function page(title, body) {
    return renderPage(title, SKIP + `<div style="max-width:1200px;margin:0 auto;padding:20px">${body}</div>`);
  }

  function nav(active) {
    const links = [
      ['🎮 Hub', BASE], ['📚 Library', BASE+'/library'], ['🏆 Tournaments', BASE+'/tournaments'],
      ['🏅 Achievements', BASE+'/achievements'], ['📊 Leaderboards', BASE+'/leaderboards'],
      ['🛒 Shop', BASE+'/shop'], ['📅 Daily', BASE+'/daily'], ['📂 Categories', BASE+'/categories']
    ];
    let h = '<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px;padding:12px;background:#f9fafb;border-radius:10px">';
    links.forEach(([l, u]) => { h += `<a href="${u}" style="padding:6px 12px;border-radius:6px;text-decoration:none;font-size:13px;${u===active?'background:'+P+';color:#fff':'background:#fff;color:'+GRAY+';border:1px solid #e5e7eb'}">${l}</a>`; });
    return h + '</div>';
  }

  function stars(rating) {
    let s = '';
    for (let i = 1; i <= 5; i++) s += `<span class="star ${i <= Math.round(rating) ? 'active' : ''}">★</span>`;
    return s;
  }

  function getUserEmail(req) { return req.session.user ? req.session.user.email : null; }
  function getTenantId(req) { return req.session.user ? req.session.user.tenant_id : null; }

  async function ensureCurrency(tid, email) {
    const r = await pool.query('SELECT balance FROM ent_game_currency WHERE tenant_id=$1 AND user_email=$2', [tid, email]);
    if (!r.rows.length) await pool.query('INSERT INTO ent_game_currency (tenant_id,user_email) VALUES ($1,$2)', [tid, email]);
    return r.rows[0] ? r.rows[0].balance : 0;
  }

  async function addCoins(tid, email, amount) {
    await pool.query(`INSERT INTO ent_game_currency (tenant_id,user_email,balance,total_earned) VALUES ($1,$2,$3,$3)
      ON CONFLICT (tenant_id,user_email) DO UPDATE SET balance=balance+$3, total_earned=total_earned+$3, updated_at=NOW()`, [tid, email, amount]);
  }

  async function seedBuiltinGames(tid) {
    for (const g of BUILTIN_GAMES) {
      await pool.query(`INSERT INTO ent_games (tenant_id,name,slug,description,category,thumbnail_url,is_builtin,builtin_type,play_count,avg_rating)
        VALUES ($1,$2,$3,$4,$5,$6,true,$7,0,0) ON CONFLICT (slug) DO NOTHING`,
        [tid, g.name, g.slug, g.desc, g.category, '', g.builtin_type]);
    }
  }

  async function checkAchievements(tid, email) {
    const stats = await pool.query(`SELECT COUNT(*)::int AS games, COALESCE(SUM(time_played),0)::int AS total_time,
      COUNT(*) FILTER (WHERE result='win')::int AS wins FROM ent_game_sessions WHERE tenant_id=$1 AND user_email=$2`, [tid, email]);
    const s = stats.rows[0];
    const maxScore = await pool.query(`SELECT COALESCE(MAX(score),0)::int AS ms FROM ent_game_sessions WHERE tenant_id=$1 AND user_email=$2`, [tid, email]);
    const ms = maxScore.rows[0].ms;
    const fastest = await pool.query(`SELECT COALESCE(MIN(time_played),999999)::int AS ft FROM ent_game_sessions WHERE tenant_id=$1 AND user_email=$2 AND time_played>0`, [tid, email]);
    const ft = fastest.rows[0].ft;
    const checks = [
      ['first_win', s.wins >= 1], ['score_100', ms >= 100], ['play_10', s.games >= 10],
      ['speed_demon', ft <= 30], ['marathon', s.total_time >= 3600]
    ];
    const unlocked = [];
    for (const [key, cond] of checks) {
      if (cond) {
        const exists = await pool.query('SELECT 1 FROM ent_game_achievements WHERE tenant_id=$1 AND user_email=$2 AND achievement_key=$3', [tid, email, key]);
        if (!exists.rows.length) {
          const def = ACHIEVEMENT_DEFS.find(a => a.key === key);
          await pool.query('INSERT INTO ent_game_achievements (tenant_id,user_email,achievement_key,achievement_name,description,icon) VALUES ($1,$2,$3,$4,$5,$6)',
            [tid, email, key, def.name, def.desc, def.icon]);
          unlocked.push(def);
        }
      }
    }
    return unlocked;
  }

  // ======================== 1. GAMES HUB ========================
  app.get(BASE, requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    await seedBuiltinGames(tid);
    const cat = req.query.cat || 'All';
    const search = req.query.q || '';
    let q = 'SELECT * FROM ent_games WHERE tenant_id=$1 AND is_active=true';
    const params = [tid];
    if (cat !== 'All') { q += ' AND category=$2'; params.push(cat); }
    if (search) { q += ` AND (name ILIKE $${params.length+1} OR description ILIKE $${params.length+1})`; params.push('%'+search+'%'); }
    q += ' ORDER BY play_count DESC, avg_rating DESC LIMIT 50';
    const { rows: games } = await pool.query(q, params);
    const featured = games.length ? games[0] : null;
    const balance = await ensureCurrency(tid, email);
    let html = nav(BASE);
    // Hero
    html += `<div class="hero"><h1 style="font-size:28px;margin:0 0 8px">🎮 Game Center</h1>
      <p style="margin:0;opacity:.9">Play, compete, and earn rewards!</p>
      <div style="margin-top:12px;display:flex;gap:16px;align-items:center">
        <span style="background:rgba(255,255,255,.2);padding:6px 14px;border-radius:20px;font-size:14px">🪙 ${balance} coins</span>
        <a href="${BASE}/shop" style="background:#fff;color:#f59e0b;padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px">Shop</a>
      </div></div>`;
    // Search
    html += `<form method="get" style="margin-bottom:16px;display:flex;gap:8px">
      <input name="q" placeholder="Search games..." value="${esc(search)}" style="flex:1">
      <button class="btn" type="submit">🔍 Search</button></form>`;
    // Category tabs
    html += '<div class="flex flex-wrap" style="margin-bottom:20px">';
    CATEGORIES.forEach(c => {
      const count = c === 'All' ? games.length : BUILTIN_GAMES.filter(g => g.category === c).length;
      html += `<a href="${BASE}?cat=${c}" class="tab ${cat===c?'active':''}">${c} (${count})</a>`;
    });
    html += '</div>';
    // Featured
    if (featured) {
      html += `<div style="margin-bottom:20px">
        <div style="background:linear-gradient(135deg,#fbbf24,#f97316);border-radius:14px;padding:24px;color:#fff;display:flex;gap:20px;align-items:center">
          <div style="font-size:64px">⭐</div>
          <div style="flex:1"><div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;opacity:.8">Featured Game</div>
            <h2 style="font-size:22px;margin:4px 0">${esc(featured.name)}</h2>
            <p style="margin:0;opacity:.9;font-size:14px">${esc(featured.description||'')}</p>
            <div style="margin-top:8px;display:flex;gap:12px;align-items:center">
              <span class="badge" style="background:rgba(255,255,255,.2)">${esc(featured.category)}</span>
              <span style="font-size:13px">${featured.play_count} plays · ${stars(featured.avg_rating)}</span>
            </div></div>
          <a href="${featured.is_builtin ? BASE+'/'+featured.slug : (featured.game_url||'#')}" class="btn" style="background:#fff;color:#f59e0b;font-weight:700;padding:12px 24px">▶ Play Now</a>
        </div></div>`;
    }
    // Games grid
    html += '<div class="grid">';
    games.forEach(g => {
      const icon = BUILTIN_GAMES.find(b => b.slug === g.slug);
      const thumb = icon ? icon.icon : '🎮';
      const thumbBg = { Puzzle:'#6366f1', Arcade:'#ef4444', Strategy:'#059669', Trivia:'#8b5cf6',
        Sports:'#16a34a', Racing:'#ea580c', Word:'#2563eb', Math:'#7c3aed', Memory:'#0891b2',
        Adventure:'#b91c1c', Board:'#a16207' };
      html += `<div class="game-card">
        <div class="game-thumb" style="background:linear-gradient(135deg,${thumbBg[g.category]||'#6366f1'},${thumbBg[g.category]||'#6366f1'}88)">${thumb}</div>
        <div style="padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
            <h3 style="font-size:15px;margin:0">${esc(g.name)}</h3>
            <span class="badge" style="background:${thumbBg[g.category]||'#6366f1'}22;color:${thumbBg[g.category]||'#6366f1'}">${esc(g.category)}</span>
          </div>
          <p style="font-size:12px;color:${GRAY};margin:0 0 8px">${esc((g.description||'').substring(0,60))}</p>
          <div style="display:flex;justify-content:space-between;align-items:center">
            <span style="font-size:12px;color:${GRAY}">${stars(g.avg_rating)} · ${g.play_count} plays</span>
            <a href="${g.is_builtin ? BASE+'/'+g.slug : (g.game_url||'#')}" class="btn btn-sm">▶ Play</a>
          </div></div></div>`;
    });
    html += '</div>';
    res.send(page('Game Center', html));
  }));

  // ======================== 2. GAME LIBRARY ========================
  app.get(BASE+'/library', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    await seedBuiltinGames(tid);
    const { rows: games } = await pool.query('SELECT g.*, (SELECT COUNT(*) FROM ent_game_reviews WHERE game_id=g.id)::int AS review_count FROM ent_games g WHERE g.tenant_id=$1 AND g.is_active=true ORDER BY g.name', [tid]);
    const { rows: favs } = await pool.query('SELECT game_id FROM ent_game_reviews WHERE tenant_id=$1 AND user_email=$2 AND rating=5', [tid, email]);
    const favIds = new Set(favs.map(f => f.game_id));
    let html = nav(BASE+'/library') + '<h1 style="font-size:24px;margin-bottom:20px">📚 Game Library</h1>';
    html += '<div class="grid">';
    games.forEach(g => {
      const icon = BUILTIN_GAMES.find(b => b.slug === g.slug);
      const thumb = icon ? icon.icon : '🎮';
      const isFav = favIds.has(g.id);
      html += `<div class="game-card">
        <div class="game-thumb" style="background:linear-gradient(135deg,#fbbf24,#f97316)">${thumb}</div>
        <div style="padding:14px">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:6px">
            <h3 style="font-size:15px;margin:0">${esc(g.name)}</h3>
            <button onclick="toggleFav(this,${g.id})" style="background:none;border:none;font-size:20px;cursor:pointer" title="Favorite">${isFav?'❤️':'🤍'}</button>
          </div>
          <div style="margin-bottom:6px">${stars(g.avg_rating)} <span style="font-size:11px;color:${GRAY}">(${g.review_count})</span></div>
          <div class="flex flex-wrap" style="margin-bottom:8px">
            <span class="badge" style="background:#f3f4f6">${esc(g.category)}</span>
            <span style="font-size:12px;color:${GRAY}">${g.play_count} plays</span>
          </div>
          <a href="${g.is_builtin ? BASE+'/'+g.slug : (g.game_url||'#')}" class="btn btn-green" style="width:100%">▶ Play Now</a>
        </div></div>`;
    });
    html += '</div>';
    html += `<script>async function toggleFav(btn,gid){const r=await fetch('${BASE}/'+gid+'/rate',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({rating:5,review_text:'Favorite'})});btn.textContent=r.ok?'❤️':'🤍'}</script>`;
    res.send(page('Game Library', html));
  }));

  // ======================== 3A. MEMORY MATCH GAME ========================
  app.get(BASE+'/memory', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    await seedBuiltinGames(tid);
    const { rows } = await pool.query("SELECT id FROM ent_games WHERE slug='memory' AND tenant_id=$1", [tid]);
    const gameId = rows[0] ? rows[0].id : 0;
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">🃏 Memory Match</h1>';
    html += `<div class="card">
      <div class="flex" style="margin-bottom:16px">
        <div class="stat-box" style="flex:1;background:#fef3c7"><div style="font-size:12px;color:${GRAY}">Moves</div><div id="mem-moves" style="font-size:24px;font-weight:700;color:${P}">0</div></div>
        <div class="stat-box" style="flex:1;background:#fee2e2"><div style="font-size:12px;color:${GRAY}">Time</div><div id="mem-time" style="font-size:24px;font-weight:700;color:${P2}">0:00</div></div>
        <div class="stat-box" style="flex:1;background:#d1fae5"><div style="font-size:12px;color:${GRAY}">Pairs</div><div id="mem-pairs" style="font-size:24px;font-weight:700;color:#059669">0/8</div></div>
      </div>
      <div id="mem-board" style="display:grid;grid-template-columns:repeat(4,1fr);gap:10px;max-width:400px;margin:0 auto"></div>
      <div class="flex" style="justify-content:center;margin-top:16px">
        <button onclick="memInit()" class="btn">🔄 New Game</button>
      </div>
      <div id="mem-result" style="text-align:center;margin-top:12px;font-size:18px;font-weight:700"></div>
    </div>`;
    html += `<script>
    const EMOJIS=['🐶','🐱','🐭','🐹','🐰','🦊','🐻','🐼'];
    let memCards=[],memFlipped=[],memMatched=0,memMoves=0,memTimer=null,memSec=0,memLocked=false,memGameId=${gameId};
    function memInit(){
      memCards=[];memFlipped=[];memMatched=0;memMoves=0;memSec=0;memLocked=false;
      if(memTimer)clearInterval(memTimer);
      document.getElementById('mem-moves').textContent='0';
      document.getElementById('mem-time').textContent='0:00';
      document.getElementById('mem-pairs').textContent='0/8';
      document.getElementById('mem-result').textContent='';
      const pairs=[...EMOJIS,...EMOJIS].sort(()=>Math.random()-.5);
      const board=document.getElementById('mem-board');board.innerHTML='';
      pairs.forEach((e,i)=>{
        const card=document.createElement('div');
        card.style.cssText='aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:32px;cursor:pointer;border-radius:10px;transition:transform .3s;transform-style:preserve-3d;background:linear-gradient(135deg,${P},${P2});color:#fff;font-weight:bold;font-size:20px';
        card.textContent='?';card.dataset.idx=i;card.dataset.emoji=e;
        card.addEventListener('click',()=>memFlip(card));
        board.appendChild(card);memCards.push(card);
      });
      memTimer=setInterval(()=>{memSec++;document.getElementById('mem-time').textContent=Math.floor(memSec/60)+':'+String(memSec%60).padStart(2,'0');},1000);
    }
    function memFlip(card){
      if(memLocked||memFlipped.length>=2||card.dataset.flipped||card.dataset.matched)return;
      if(memFlipped.length===0&&memMoves===0){/* started */}
      card.textContent=card.dataset.emoji;card.style.background='#fff';card.dataset.flipped='1';memFlipped.push(card);
      if(memFlipped.length===2){
        memMoves++;document.getElementById('mem-moves').textContent=memMoves;
        memLocked=true;
        if(memFlipped[0].dataset.emoji===memFlipped[1].dataset.emoji){
          memFlipped[0].dataset.matched='1';memFlipped[1].dataset.matched='1';
          memFlipped[0].style.background='#d1fae5';memFlipped[1].style.background='#d1fae5';
          memMatched++;document.getElementById('mem-pairs').textContent=memMatched+'/8';
          memFlipped=[];memLocked=false;
          if(memMatched===8){clearInterval(memTimer);memWin();}
        } else {
          setTimeout(()=>{memFlipped[0].textContent='?';memFlipped[0].style.background='linear-gradient(135deg,${P},${P2})';delete memFlipped[0].dataset.flipped;
            memFlipped[1].textContent='?';memFlipped[1].style.background='linear-gradient(135deg,${P},${P2})';delete memFlipped[1].dataset.flipped;
            memFlipped=[];memLocked=false;},800);
        }
      }
    }
    async function memWin(){
      document.getElementById('mem-result').innerHTML='<span style="color:#059669">🎉 You Won!</span>';
      const coins=memSec<30?100:memSec<60?50:10;
      await fetch('${BASE}/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game_id:memGameId,score:Math.max(100-memMoves*5,0),time_played:memSec,moves:memMoves,result:'win',coins_earned:coins})});
    }
    memInit();</script>`;
    res.send(page('Memory Match', html));
  }));

  // ======================== 3B. MATH QUIZ GAME ========================
  app.get(BASE+'/math-quiz', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    await seedBuiltinGames(tid);
    const { rows } = await pool.query("SELECT id FROM ent_games WHERE slug='math-quiz' AND tenant_id=$1", [tid]);
    const gameId = rows[0] ? rows[0].id : 0;
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">🧮 Math Quiz</h1>';
    html += `<div class="card">
      <div class="flex" style="margin-bottom:16px;justify-content:center;gap:8px">
        <button onclick="mathStart('easy')" class="btn btn-green btn-sm">Easy (+/-)</button>
        <button onclick="mathStart('medium')" class="btn btn-sm" style="background:#f59e0b">Medium (×)</button>
        <button onclick="mathStart('hard')" class="btn btn-red btn-sm">Hard (all)</button>
      </div>
      <div class="flex" style="margin-bottom:16px">
        <div class="stat-box" style="flex:1;background:#fef3c7"><div style="font-size:12px;color:${GRAY}">Score</div><div id="math-score" style="font-size:24px;font-weight:700;color:${P}">0</div></div>
        <div class="stat-box" style="flex:1;background:#fee2e2"><div style="font-size:12px;color:${GRAY}">Streak</div><div id="math-streak" style="font-size:24px;font-weight:700;color:${P2}">0</div></div>
        <div class="stat-box" style="flex:1;background:#d1fae5"><div style="font-size:12px;color:${GRAY}">Question</div><div id="math-qnum" style="font-size:24px;font-weight:700;color:#059669">0/10</div></div>
      </div>
      <div id="math-problem" style="text-align:center;font-size:36px;font-weight:700;margin:20px 0;padding:24px;background:#f9fafb;border-radius:12px">Press a difficulty to start!</div>
      <div id="math-answers" style="display:grid;grid-template-columns:1fr 1fr;gap:10px;max-width:400px;margin:0 auto"></div>
      <div id="math-result" style="text-align:center;margin-top:16px;font-size:18px;font-weight:700"></div>
    </div>`;
    html += `<script>
    let mathScore=0,mathQ=0,mathTotal=10,mathDiff='easy',mathStreak=0,mathMaxStreak=0,mathCorrect=0,mathGameId=${gameId},mathStartTime=0,mathActive=false;
    function mathGenQ(){
      let a,b,op,ans;
      if(mathDiff==='easy'){a=Math.floor(Math.random()*20)+1;b=Math.floor(Math.random()*20)+1;op=Math.random()>.5?'+':'-';if(op==='-'&&a<b)[a,b]=[b,a];ans=op==='+'?a+b:a-b;}
      else if(mathDiff==='medium'){a=Math.floor(Math.random()*12)+1;b=Math.floor(Math.random()*12)+1;op='×';ans=a*b;}
      else{const ops=['+','-','×'];op=ops[Math.floor(Math.random()*3)];if(op==='-'){a=Math.floor(Math.random()*20)+1;b=Math.floor(Math.random()*20)+1;if(a<b)[a,b]=[b,a];ans=a-b;}else if(op==='×'){a=Math.floor(Math.random()*12)+1;b=Math.floor(Math.random()*12)+1;ans=a*b;}else{a=Math.floor(Math.random()*20)+1;b=Math.floor(Math.random()*20)+1;ans=a+b;}}
      return{a,b,op,ans,text:a+' '+op+' '+b+' = ?'};
    }
    function mathStart(diff){
      mathDiff=diff;mathScore=0;mathQ=0;mathStreak=0;mathMaxStreak=0;mathCorrect=0;mathActive=true;mathStartTime=Date.now();
      document.getElementById('math-score').textContent='0';document.getElementById('math-streak').textContent='0';
      document.getElementById('math-qnum').textContent='0/'+mathTotal;document.getElementById('math-result').textContent='';
      mathNextQ();
    }
    function mathNextQ(){
      if(mathQ>=mathTotal){mathEnd();return;}
      mathQ++;document.getElementById('math-qnum').textContent=mathQ+'/'+mathTotal;
      const q=mathGenQ();window._mathAns=q.ans;
      document.getElementById('math-problem').textContent=q.text;
      const wrongs=new Set();while(wrongs.size<3){const w=q.ans+Math.floor(Math.random()*21)-10;if(w!==q.ans&&w>=0)wrongs.add(w);}
      const opts=[q.ans,...wrongs].sort(()=>Math.random()-.5);
      const box=document.getElementById('math-answers');box.innerHTML='';
      opts.forEach(o=>{const b=document.createElement('button');b.className='btn';b.style.cssText='padding:16px;font-size:20px;font-weight:700';b.textContent=o;b.onclick=()=>mathCheck(o,b);box.appendChild(b);});
    }
    function mathCheck(val,btn){
      if(!mathActive)return;
      document.querySelectorAll('#math-answers button').forEach(b=>b.disabled=true);
      if(val===window._mathAns){
        btn.style.background='#059669';mathScore+=10;mathStreak++;mathCorrect++;if(mathStreak>mathMaxStreak)mathMaxStreak=mathStreak;
        if(mathStreak>=3)mathScore+=5;
      } else {btn.style.background='#dc2626';mathStreak=0;}
      document.getElementById('math-score').textContent=mathScore;
      document.getElementById('math-streak').textContent=mathStreak;
      setTimeout(mathNextQ,600);
    }
    async function mathEnd(){
      mathActive=false;
      const timePlayed=Math.floor((Date.now()-mathStartTime)/1000);
      const coins=mathCorrect===mathTotal?100:mathScore>=50?50:10;
      document.getElementById('math-result').innerHTML=mathCorrect===mathTotal?'<span style="color:#059669">⭐ Perfect Score! +'+coins+' coins</span>':mathScore>=50?'<span style="color:'+P+'">👍 Great job! +'+coins+' coins</span>':'<span style="color:'+GRAY+'">Keep practicing! +'+coins+' coins</span>';
      await fetch('${BASE}/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game_id:mathGameId,score:mathScore,time_played:timePlayed,moves:mathTotal,result:mathCorrect>=7?'win':'lose',coins_earned:coins})});
    }</script>`;
    res.send(page('Math Quiz', html));
  }));

  // ======================== 3C. WORD SCRAMBLE GAME ========================
  app.get(BASE+'/word-scramble', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    await seedBuiltinGames(tid);
    const { rows } = await pool.query("SELECT id FROM ent_games WHERE slug='word-scramble' AND tenant_id=$1", [tid]);
    const gameId = rows[0] ? rows[0].id : 0;
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">🔤 Word Scramble</h1>';
    html += `<div class="card">
      <div class="flex" style="margin-bottom:16px">
        <div class="stat-box" style="flex:1;background:#fef3c7"><div style="font-size:12px;color:${GRAY}">Score</div><div id="ws-score" style="font-size:24px;font-weight:700;color:${P}">0</div></div>
        <div class="stat-box" style="flex:1;background:#d1fae5"><div style="font-size:12px;color:${GRAY}">Words</div><div id="ws-words" style="font-size:24px;font-weight:700;color:#059669">0</div></div>
        <div class="stat-box" style="flex:1;background:#ede9fe"><div style="font-size:12px;color:${GRAY}">Time</div><div id="ws-time" style="font-size:24px;font-weight:700;color:#7c3aed">0:00</div></div>
      </div>
      <div id="ws-scrambled" style="text-align:center;font-size:40px;font-weight:700;letter-spacing:8px;margin:20px 0;padding:24px;background:linear-gradient(135deg,#fef3c7,#fde68a);border-radius:12px;cursor:pointer" onclick="wsHint()">Press Start!</div>
      <div style="max-width:400px;margin:0 auto 12px">
        <form onsubmit="wsGuess(event)" style="display:flex;gap:8px">
          <input id="ws-input" placeholder="Type your guess..." autocomplete="off" style="flex:1;font-size:16px;text-transform:uppercase;text-align:center">
          <button type="submit" class="btn">Guess</button></form>
      </div>
      <div id="ws-hint" style="text-align:center;font-size:14px;color:${GRAY};min-height:20px"></div>
      <div id="ws-msg" style="text-align:center;margin-top:8px;font-size:16px;font-weight:600;min-height:24px"></div>
      <div class="flex" style="justify-content:center;margin-top:12px">
        <button onclick="wsStart()" class="btn btn-green">▶ Start Game</button>
        <button onclick="wsStart()" class="btn">🔄 New Word</button>
      </div>
    </div>`;
    html += `<script>
    const WORDS=['PLANET','ROCKET','GARDEN','CASTLE','PYTHON','BRIDGE','FOREST','WIZARD','TEMPLE','JUNGLE','FROZEN','PIRATE','CANDLE','DRAGON','SILVER','BREEZE','ANCHOR','GALAXY','PUZZLE','OXYGEN','SPIRIT','SHADOW','MIRROR','VOYAGE','ZENITH','COSMOS','BAMBOO','FALCON','MOSAIC','QUARTZ'];
    let wsScore=0,wsWords=0,wsAnswer='',wsHints=0,wsTimer=null,wsSec=0,wsGameId=${gameId},wsActive=false,wsStartTime=0;
    function wsScramble(w){const a=w.split('');for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]];}let s=a.join('');return s===w?wsScramble(w):s;}
    function wsStart(){
      wsAnswer=WORDS[Math.floor(Math.random()*WORDS.length)];wsHints=0;wsActive=true;
      if(!wsTimer)wsStartTime=Date.now();
      document.getElementById('ws-scrambled').textContent=wsScramble(wsAnswer);
      document.getElementById('ws-input').value='';document.getElementById('ws-hint').textContent='';document.getElementById('ws-msg').textContent='';
    }
    function wsHint(){
      if(!wsActive||!wsAnswer)return;wsHints++;
      const hint=wsAnswer.substring(0,wsHints)+'_'.repeat(wsAnswer.length-wsHints);
      document.getElementById('ws-hint').textContent='💡 Hint: '+hint;
    }
    function wsGuess(e){
      e.preventDefault();if(!wsActive||!wsAnswer)return;
      const guess=document.getElementById('ws-input').value.trim().toUpperCase();
      if(guess===wsAnswer){
        const pts=Math.max(10-wsHints*3,2);wsScore+=pts;wsWords++;
        document.getElementById('ws-score').textContent=wsScore;document.getElementById('ws-words').textContent=wsWords;
        document.getElementById('ws-msg').innerHTML='<span style="color:#059669">✅ Correct! +'+pts+' pts</span>';
        if(wsWords>=10){wsEndGame();}else{setTimeout(wsStart,1000);}
      } else {
        document.getElementById('ws-msg').innerHTML='<span style="color:#dc2626">❌ Try again!</span>';
      }
      document.getElementById('ws-input').value='';
    }
    async function wsEndGame(){
      wsActive=false;if(wsTimer)clearInterval(wsTimer);
      const timePlayed=Math.floor((Date.now()-wsStartTime)/1000);
      const coins=wsScore>=80?100:wsScore>=50?50:10;
      document.getElementById('ws-msg').innerHTML='<span style="color:#059669">🎉 Game Over! Score: '+wsScore+' — +'+coins+' coins</span>';
      await fetch('${BASE}/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game_id:wsGameId,score:wsScore,time_played:timePlayed,moves:wsWords,result:wsScore>=50?'win':'lose',coins_earned:coins})});
    }
    if(!wsTimer)wsTimer=setInterval(()=>{if(wsActive){wsSec++;document.getElementById('ws-time').textContent=Math.floor(wsSec/60)+':'+String(wsSec%60).padStart(2,'0');}},1000);
    </script>`;
    res.send(page('Word Scramble', html));
  }));

  // ======================== 3D. TRIVIA CHALLENGE GAME ========================
  app.get(BASE+'/trivia', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    await seedBuiltinGames(tid);
    const { rows } = await pool.query("SELECT id FROM ent_games WHERE slug='trivia' AND tenant_id=$1", [tid]);
    const gameId = rows[0] ? rows[0].id : 0;
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">❓ Trivia Challenge</h1>';
    html += `<div class="card">
      <div class="flex" style="margin-bottom:16px">
        <div class="stat-box" style="flex:1;background:#fef3c7"><div style="font-size:12px;color:${GRAY}">Score</div><div id="tr-score" style="font-size:24px;font-weight:700;color:${P}">0</div></div>
        <div class="stat-box" style="flex:1;background:#d1fae5"><div style="font-size:12px;color:${GRAY}">Correct</div><div id="tr-correct" style="font-size:24px;font-weight:700;color:#059669">0</div></div>
        <div class="stat-box" style="flex:1;background:#ede9fe"><div style="font-size:12px;color:${GRAY}">Question</div><div id="tr-qnum" style="font-size:24px;font-weight:700;color:#7c3aed">0/15</div></div>
      </div>
      <div id="tr-category" style="text-align:center;font-size:12px;color:${GRAY};margin-bottom:8px">Choose a category to begin</div>
      <div id="tr-question" style="text-align:center;font-size:20px;font-weight:600;margin:16px 0;padding:20px;background:#f9fafb;border-radius:12px;min-height:80px">❓ Trivia Time!</div>
      <div id="tr-answers" style="display:grid;gap:8px;max-width:500px;margin:0 auto"></div>
      <div id="tr-result" style="text-align:center;margin-top:16px;font-size:18px;font-weight:700"></div>
      <div class="flex flex-wrap" style="justify-content:center;margin-top:16px;gap:8px">
        <button onclick="trStart('science')" class="btn btn-sm" style="background:#059669">🔬 Science</button>
        <button onclick="trStart('history')" class="btn btn-sm" style="background:#7c3aed">📜 History</button>
        <button onclick="trStart('geography')" class="btn btn-sm" style="background:#2563eb">🌍 Geography</button>
        <button onclick="trStart('entertainment')" class="btn btn-sm" style="background:#ea580c">🎬 Entertainment</button>
        <button onclick="trStart('sports')" class="btn btn-sm" style="background:#16a34a">⚽ Sports</button>
        <button onclick="trStart('mixed')" class="btn btn-sm">🎲 Mixed</button>
      </div>
    </div>`;
    html += `<script>
    const QS={
      science:[
        {q:"What is the chemical symbol for gold?",o:["Au","Ag","Fe","Cu"],a:0},{q:"How many planets are in our solar system?",o:["7","8","9","10"],a:1},
        {q:"What gas do plants absorb?",o:["Oxygen","Nitrogen","Carbon Dioxide","Hydrogen"],a:2},{q:"What is the speed of light approximately?",o:["300k km/s","150k km/s","500k km/s","1M km/s"],a:0},
        {q:"What is the largest organ in the human body?",o:["Heart","Liver","Skin","Brain"],a:2}
      ],
      history:[
        {q:"In what year did World War II end?",o:["1943","1944","1945","1946"],a:2},{q:"Who painted the Mona Lisa?",o:["Michelangelo","Leonardo da Vinci","Raphael","Donatello"],a:1},
        {q:"What ancient wonder was in Alexandria?",o:["Colossus","Hanging Gardens","Lighthouse","Temple of Artemis"],a:2},{q:"Who was the first US President?",o:["Jefferson","Adams","Washington","Lincoln"],a:2},
        {q:"The Great Wall was primarily built to protect against whom?",o:["Mongols","Japanese","Koreans","Russians"],a:0}
      ],
      geography:[
        {q:"What is the largest continent?",o:["Africa","Asia","Europe","N. America"],a:1},{q:"What is the capital of Australia?",o:["Sydney","Melbourne","Canberra","Perth"],a:2},
        {q:"Which river is the longest?",o:["Amazon","Nile","Mississippi","Yangtze"],a:1},{q:"What is the smallest country?",o:["Monaco","Vatican City","San Marino","Liechtenstein"],a:1},
        {q:"Mount Everest is in which mountain range?",o:["Andes","Alps","Himalayas","Rockies"],a:2}
      ],
      entertainment:[
        {q:"Who directed 'Jurassic Park'?",o:["Cameron","Spielberg","Lucas","Nolan"],a:1},{q:"What instrument has 88 keys?",o:["Guitar","Violin","Piano","Organ"],a:2},
        {q:"Which band sang 'Bohemian Rhapsody'?",o:["Beatles","Led Zeppelin","Queen","Pink Floyd"],a:2},{q:"Who wrote 'Romeo and Juliet'?",o:["Dickens","Shakespeare","Austen","Twain"],a:1},
        {q:"What year was the first iPhone released?",o:["2005","2006","2007","2008"],a:2}
      ],
      sports:[
        {q:"How many players on a soccer team?",o:["9","10","11","12"],a:2},{q:"In which sport is the term 'ace' used?",o:["Basketball","Tennis","Football","Hockey"],a:1},
        {q:"How many rings in the Olympics logo?",o:["4","5","6","7"],a:1},{q:"What country won the first FIFA World Cup?",o:["Brazil","Germany","Argentina","Uruguay"],a:3},
        {q:"In what sport do you use a shuttlecock?",o:["Tennis","Badminton","Squash","Ping Pong"],a:1}
      ]
    };
    let trScore=0,trQ=0,trCorrect=0,trTotal=15,trCat='',trGameId=${gameId},trStartTime=0,trActive=false;
    function trStart(cat){
      trCat=cat;trScore=0;trQ=0;trCorrect=0;trActive=true;trStartTime=Date.now();
      document.getElementById('tr-score').textContent='0';document.getElementById('tr-correct').textContent='0';
      document.getElementById('tr-qnum').textContent='0/'+trTotal;document.getElementById('tr-result').textContent='';
      let pool=[];
      if(cat==='mixed'){Object.values(QS).forEach(arr=>pool.push(...arr));}
      else{pool=[...QS[cat],...QS[cat]];}
      window._trQs=pool.sort(()=>Math.random()-.5).slice(0,trTotal);
      trNextQ();
    }
    function trNextQ(){
      if(trQ>=trTotal){trEnd();return;}
      const q=window._trQs[trQ];trQ++;
      document.getElementById('tr-qnum').textContent=trQ+'/'+trTotal;
      document.getElementById('tr-category').textContent='📂 '+trCat.charAt(0).toUpperCase()+trCat.slice(1);
      document.getElementById('tr-question').textContent=q.q;
      const box=document.getElementById('tr-answers');box.innerHTML='';
      q.o.forEach((opt,i)=>{const b=document.createElement('button');b.className='btn';b.style.cssText='text-align:left;padding:12px 16px;font-size:15px';b.textContent=opt;b.onclick=()=>trCheck(i,b);box.appendChild(b);});
    }
    function trCheck(idx,btn){
      if(!trActive)return;
      document.querySelectorAll('#tr-answers button').forEach(b=>b.disabled=true);
      const q=window._trQs[trQ-1];
      if(idx===q.a){btn.style.background='#059669';trScore+=10;trCorrect++;
        document.querySelectorAll('#tr-answers button')[q.a].style.background='#059669';
      } else {btn.style.background='#dc2626';document.querySelectorAll('#tr-answers button')[q.a].style.background='#059669';}
      document.getElementById('tr-score').textContent=trScore;document.getElementById('tr-correct').textContent=trCorrect;
      setTimeout(trNextQ,800);
    }
    async function trEnd(){
      trActive=false;const timePlayed=Math.floor((Date.now()-trStartTime)/1000);
      const coins=trCorrect>=12?100:trCorrect>=8?50:10;
      document.getElementById('tr-result').innerHTML=trCorrect>=12?'<span style="color:#059669">🏆 Expert! +'+coins+' coins</span>':trCorrect>=8?'<span style="color:${P}">👍 Good job! +'+coins+' coins</span>':'<span style="color:${GRAY}">Keep learning! +'+coins+' coins</span>';
      await fetch('${BASE}/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game_id:trGameId,score:trScore,time_played:timePlayed,moves:trTotal,result:trCorrect>=8?'win':'lose',coins_earned:coins})});
    }</script>`;
    res.send(page('Trivia Challenge', html));
  }));

  // ======================== 3E. TIC TAC TOE GAME ========================
  app.get(BASE+'/tic-tac-toe', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    await seedBuiltinGames(tid);
    const { rows } = await pool.query("SELECT id FROM ent_games WHERE slug='tic-tac-toe' AND tenant_id=$1", [tid]);
    const gameId = rows[0] ? rows[0].id : 0;
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">⭕ Tic Tac Toe</h1>';
    html += `<div class="card" style="text-align:center">
      <div class="flex" style="justify-content:center;margin-bottom:16px">
        <div class="stat-box" style="flex:1;background:#dbeafe"><div style="font-size:12px;color:${GRAY}">You (X)</div><div id="ttt-wins" style="font-size:24px;font-weight:700;color:#2563eb">0</div></div>
        <div class="stat-box" style="flex:1;background:#f3f4f6"><div style="font-size:12px;color:${GRAY}">Draws</div><div id="ttt-draws" style="font-size:24px;font-weight:700;color:${GRAY}">0</div></div>
        <div class="stat-box" style="flex:1;background:#fee2e2"><div style="font-size:12px;color:${GRAY}">AI (O)</div><div id="ttt-losses" style="font-size:24px;font-weight:700;color:${P2}">0</div></div>
      </div>
      <div id="ttt-status" style="font-size:18px;font-weight:600;margin-bottom:12px">Your turn (X)</div>
      <div id="ttt-board" style="display:grid;grid-template-columns:repeat(3,1fr);gap:6px;max-width:240px;margin:0 auto"></div>
      <div class="flex" style="justify-content:center;margin-top:16px">
        <button onclick="tttReset()" class="btn">🔄 New Round</button>
        <button onclick="tttFullReset()" class="btn btn-gray">New Game</button>
      </div>
      <div id="ttt-total-msg" style="margin-top:12px;font-size:14px;color:${GRAY}"></div>
    </div>`;
    html += `<script>
    let tttBoard,tttTurn,tttOver,tttWins=0,tttLosses=0,tttDraws=0,tttTotal=0,tttGameId=${gameId},tttStartTime=0;
    function tttReset(){
      tttBoard=Array(9).fill('');tttTurn='X';tttOver=false;tttTotal++;
      document.getElementById('ttt-status').textContent='Your turn (X)';
      document.getElementById('ttt-status').style.color='#2563eb';
      if(tttTotal===1)tttStartTime=Date.now();
      renderTTT();
    }
    function tttFullReset(){
      tttWins=0;tttLosses=0;tttDraws=0;tttTotal=0;tttReset();
      document.getElementById('ttt-total-msg').textContent='';
    }
    function renderTTT(){
      const b=document.getElementById('ttt-board');b.innerHTML='';
      tttBoard.forEach((c,i)=>{const cell=document.createElement('div');
        cell.style.cssText='aspect-ratio:1;display:flex;align-items:center;justify-content:center;font-size:36px;font-weight:700;cursor:'+(tttOver||c?'default':'pointer')+';border-radius:8px;background:'+(c==='X'?'#dbeafe':c==='O'?'#fee2e2':'#f9fafb')+';transition:background .2s';
        cell.textContent=c;cell.addEventListener('click',()=>tttMove(i));b.appendChild(cell);});
      document.getElementById('ttt-wins').textContent=tttWins;document.getElementById('ttt-losses').textContent=tttLosses;document.getElementById('ttt-draws').textContent=tttDraws;
    }
    function tttCheck(bd){const wins=[[0,1,2],[3,4,5],[6,7,8],[0,3,6],[1,4,7],[2,5,8],[0,4,8],[2,4,6]];
      for(const[a,c,d]of wins){if(bd[a]&&bd[a]===bd[c]&&bd[a]===bd[d])return bd[a];}return bd.every(c=>c)?'draw':null;}
    function tttMove(i){
      if(tttOver||tttBoard[i]||tttTurn!=='X')return;
      tttBoard[i]='X';const r=tttCheck(tttBoard);renderTTT();
      if(r){tttEndRound(r);return;}
      tttTurn='O';document.getElementById('ttt-status').textContent='AI thinking...';document.getElementById('ttt-status').style.color=${P2};
      setTimeout(tttAI,400);
    }
    function tttAI(){
      // Minimax AI
      let bestScore=-Infinity,bestMove=-1;
      for(let i=0;i<9;i++){if(!tttBoard[i]){tttBoard[i]='O';const s=minimax(tttBoard,0,false);tttBoard[i]='';if(s>bestScore){bestScore=s;bestMove=i;}}}
      if(bestMove>=0)tttBoard[bestMove]='O';
      const r=tttCheck(tttBoard);renderTTT();
      if(r){tttEndRound(r);return;}
      tttTurn='X';document.getElementById('ttt-status').textContent='Your turn (X)';document.getElementById('ttt-status').style.color='#2563eb';
    }
    function minimax(bd,depth,isMax){
      const r=tttCheck(bd);if(r==='O')return 10-depth;if(r==='X')return depth-10;if(r==='draw')return 0;
      if(isMax){let best=-Infinity;for(let i=0;i<9;i++){if(!bd[i]){bd[i]='O';best=Math.max(best,minimax(bd,depth+1,false));bd[i]='';}}return best;}
      else{let best=Infinity;for(let i=0;i<9;i++){if(!bd[i]){bd[i]='X';best=Math.min(best,minimax(bd,depth+1,true));bd[i]='';}}return best;}
    }
    function tttEndRound(result){
      tttOver=true;
      if(result==='X'){tttWins++;document.getElementById('ttt-status').textContent='🎉 You Win!';document.getElementById('ttt-status').style.color='#059669';}
      else if(result==='O'){tttLosses++;document.getElementById('ttt-status').textContent='😔 AI Wins!';document.getElementById('ttt-status').style.color='#dc2626';}
      else{tttDraws++;document.getElementById('ttt-status').textContent='🤝 Draw!';document.getElementById('ttt-status').style.color='${GRAY}';}
      renderTTT();
      if(tttWins+tttLosses+tttDraws>=5){tttFinish();}
    }
    async function tttFinish(){
      const timePlayed=Math.floor((Date.now()-tttStartTime)/1000);
      const coins=tttWins>=4?100:tttWins>=3?50:10;
      document.getElementById('ttt-total-msg').textContent='Game complete! Won '+tttWins+'/5 — +'+coins+' coins';
      await fetch('${BASE}/api/session',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({game_id:tttGameId,score:tttWins*20,time_played:timePlayed,moves:tttTotal,result:tttWins>=3?'win':'lose',coins_earned:coins})});
    }
    tttReset();</script>`;
    res.send(page('Tic Tac Toe', html));
  }));

  // ======================== API: Save Game Session ========================
  app.post(BASE+'/api/session', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const { game_id, score, time_played, moves, result, coins_earned } = req.body;
    await pool.query('INSERT INTO ent_game_sessions (tenant_id,game_id,user_email,score,time_played,moves,result,coins_earned) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
      [tid, game_id, email, score || 0, time_played || 0, moves || 0, result || '', coins_earned || 0]);
    if (coins_earned > 0) await addCoins(tid, email, coins_earned);
    await pool.query('UPDATE ent_games SET play_count=play_count+1 WHERE id=$1', [game_id]);
    // Update avg rating
    await pool.query('UPDATE ent_games SET avg_rating=(SELECT AVG(rating) FROM ent_game_reviews WHERE game_id=$1) WHERE id=$1', [game_id]);
    const newAch = await checkAchievements(tid, email);
    audit(req, 'game_session', 'Played game #' + game_id + ' score=' + score);
    res.json({ ok: true, coins: coins_earned, achievements: newAch });
  }));

  // ======================== 4. TOURNAMENTS ========================
  app.get(BASE+'/tournaments', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const { rows: tournaments } = await pool.query(
      `SELECT t.*, g.name AS game_name, g.category, (SELECT COUNT(*)::int FROM ent_game_tournament_players WHERE tournament_id=t.id) AS player_count
       FROM ent_game_tournaments t LEFT JOIN ent_games g ON g.id=t.game_id WHERE t.tenant_id=$1 ORDER BY t.created_at DESC LIMIT 30`, [tid]);
    let html = nav(BASE+'/tournaments') + '<h1 style="font-size:24px;margin-bottom:20px">🏆 Tournaments</h1>';
    html += `<div class="flex" style="margin-bottom:16px"><a href="${BASE}/tournaments/create" class="btn btn-green">+ Create Tournament</a></div>`;
    if (!tournaments.length) {
      html += '<div class="card" style="text-align:center;padding:40px"><p style="font-size:48px">🏆</p><p style="color:'+GRAY+'">No tournaments yet. Create one!</p></div>';
    } else {
      const tIds = tournaments.map(t => t.id);
      const { rows: myJoins } = await pool.query('SELECT DISTINCT tournament_id FROM ent_game_tournament_players WHERE tournament_id = ANY($1) AND user_email=$2', [tIds, email]);
      const joinedSet = new Set(myJoins.map(j => j.tournament_id));
      html += '<div class="grid">';
      tournaments.forEach(t => {
        const statusColor = t.status === 'open' ? '#059669' : t.status === 'active' ? '#2563eb' : t.status === 'completed' ? '#7c3aed' : GRAY;
        const hasJoined = joinedSet.has(t.id);
        html += `<div class="game-card">
          <div style="padding:16px">
            <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
              <span class="badge" style="background:${statusColor}22;color:${statusColor}">${esc(t.status)}</span>
              <span style="font-size:12px;color:${GRAY}">${t.player_count}/${t.max_players || '∞'} players</span>
            </div>
            <h3 style="font-size:16px;margin:0 0 4px">${esc(t.name)}</h3>
            <p style="font-size:12px;color:${GRAY};margin:0 0 4px">🎮 ${esc(t.game_name || 'Any game')} · ${esc(t.category || '')}</p>
            ${t.prize_description ? `<p style="font-size:12px;color:${P}">🎁 ${esc(t.prize_description)}</p>` : ''}
            ${t.start_date ? `<p style="font-size:11px;color:${GRAY};margin-top:4px">📅 ${t.start_date.toISOString().split('T')[0]}</p>` : ''}
            <div style="margin-top:8px">
              ${t.status === 'open' && !hasJoined ? `<a href="${BASE}/tournaments/${t.id}/join" class="btn btn-green btn-sm">Join</a>` : hasJoined ? '<span class="badge" style="background:#059669">✓ Joined</span>' : ''}
              <a href="${BASE}/tournaments/${t.id}" class="btn btn-sm btn-gray" style="margin-left:4px">View</a>
            </div></div></div>`;
      });
      html += '</div>';
    }
    res.send(page('Tournaments', html));
  }));

  app.get(BASE+'/tournaments/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    await seedBuiltinGames(tid);
    const { rows: games } = await pool.query('SELECT id, name FROM ent_games WHERE tenant_id=$1 AND is_active=true ORDER BY name', [tid]);
    let html = nav(BASE+'/tournaments') + '<h1 style="font-size:24px;margin-bottom:20px">🏆 Create Tournament</h1>';
    html += `<div class="card" style="max-width:500px"><form method="post" action="${BASE}/tournaments/create"><div style="display:grid;gap:14px">
      <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Tournament Name *</label><input name="name" required placeholder="e.g. Math Masters Cup"></div>
      <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Game *</label><select name="game_id" required><option value="">Select game</option>`;
    games.forEach(g => { html += `<option value="${g.id}">${esc(g.name)}</option>`; });
    html += `</select></div>
      <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Max Players</label><input type="number" name="max_players" min="2" max="100" placeholder="16"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Start Date</label><input type="datetime-local" name="start_date"></div>
        <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">End Date</label><input type="datetime-local" name="end_date"></div></div>
      <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Prize Description</label><input name="prize_description" placeholder="e.g. 500 coins + Golden Badge"></div>
      <button type="submit" class="btn btn-green">Create Tournament</button></div></form></div>`;
    res.send(page('Create Tournament', html));
  }));

  app.post(BASE+'/tournaments/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const { name, game_id, max_players, start_date, end_date, prize_description } = req.body;
    const r = await pool.query('INSERT INTO ent_game_tournaments (tenant_id,name,game_id,max_players,start_date,end_date,prize_description,created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
      [tid, name, game_id, max_players || null, start_date || null, end_date || null, prize_description, email]);
    audit(req, 'tournament_create', 'Created tournament: ' + name);
    res.redirect(BASE + '/tournaments/' + r.rows[0].id);
  }));

  app.get(BASE+'/tournaments/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const { rows } = await pool.query(
      `SELECT t.*, g.name AS game_name FROM ent_game_tournaments t LEFT JOIN ent_games g ON g.id=t.game_id WHERE t.id=$1 AND t.tenant_id=$2`, [req.params.id, tid]);
    if (!rows.length) return res.status(404).send(page('Not Found', '<p>Tournament not found.</p>'));
    const t = rows[0];
    const { rows: players } = await pool.query(
      `SELECT tp.*, u.name FROM ent_game_tournament_players tp LEFT JOIN users u ON u.email=tp.user_email WHERE tp.tournament_id=$1 ORDER BY tp.score DESC`, [t.id]);
    const statusColor = t.status === 'open' ? '#059669' : t.status === 'active' ? '#2563eb' : t.status === 'completed' ? '#7c3aed' : GRAY;
    let html = nav(BASE+'/tournaments') + `<h1 style="font-size:24px;margin-bottom:20px">🏆 ${esc(t.name)}</h1>`;
    html += `<div class="card" style="border-left:4px solid ${statusColor}">
      <div class="flex" style="margin-bottom:12px">
        <span class="badge" style="background:${statusColor}22;color:${statusColor}">${esc(t.status)}</span>
        <span style="font-size:13px;color:${GRAY}">🎮 ${esc(t.game_name || 'N/A')}</span>
        <span style="font-size:13px;color:${GRAY}">${players.length}/${t.max_players || '∞'} players</span>
      </div>
      ${t.prize_description ? `<p style="color:${P};font-weight:600">🎁 ${esc(t.prize_description)}</p>` : ''}
      ${t.start_date ? `<p style="font-size:13px;color:${GRAY}">📅 Starts: ${t.start_date.toISOString().replace('T',' ').substring(0,16)}</p>` : ''}
    </div>`;
    // Leaderboard
    html += '<div class="card"><h2 style="margin-bottom:12px">📊 Leaderboard</h2>';
    if (!players.length) {
      html += '<p style="color:'+GRAY+'">No players yet.</p>';
    } else {
      html += '<table><thead><tr><th>Rank</th><th>Player</th><th>Score</th><th>Joined</th></tr></thead><tbody>';
      players.forEach((p, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
        html += `<tr><td>${medal}</td><td>${esc(p.name || p.user_email)}</td><td>${p.score}</td><td>${p.joined_at ? p.joined_at.toISOString().split('T')[0] : ''}</td></tr>`;
      });
      html += '</tbody></table>';
    }
    html += '</div>';
    res.send(page('Tournament: ' + t.name, html));
  }));

  app.get(BASE+'/tournaments/:id/join', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    await pool.query('INSERT INTO ent_game_tournament_players (tournament_id,user_email) VALUES ($1,$2) ON CONFLICT DO NOTHING',
      [req.params.id, email]);
    audit(req, 'tournament_join', 'Joined tournament #' + req.params.id);
    res.redirect(BASE + '/tournaments/' + req.params.id);
  }));

  // ======================== 5. ACHIEVEMENTS ========================
  app.get(BASE+'/achievements', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const { rows: unlocked } = await pool.query('SELECT * FROM ent_game_achievements WHERE tenant_id=$1 AND user_email=$2 ORDER BY unlocked_at', [tid, email]);
    const unlockedKeys = new Set(unlocked.map(u => u.achievement_key));
    const { rows: stats } = await pool.query(`SELECT COUNT(*)::int AS games, COUNT(*) FILTER (WHERE result='win')::int AS wins,
      COALESCE(SUM(time_played),0)::int AS total_time, COALESCE(MAX(score),0)::int AS top_score FROM ent_game_sessions WHERE tenant_id=$1 AND user_email=$2`, [tid, email]);
    const s = stats.rows[0];
    let html = nav(BASE+'/achievements') + '<h1 style="font-size:24px;margin-bottom:20px">🏅 Achievements</h1>';
    // Stats summary
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:12px;margin-bottom:20px">
      <div class="stat-box" style="background:#dbeafe"><div style="font-size:28px">🎮</div><div style="font-size:22px;font-weight:700;color:#2563eb">${s.games}</div><div style="font-size:11px;color:${GRAY}">Games Played</div></div>
      <div class="stat-box" style="background:#d1fae5"><div style="font-size:28px">🏆</div><div style="font-size:22px;font-weight:700;color:#059669">${s.wins}</div><div style="font-size:11px;color:${GRAY}">Wins</div></div>
      <div class="stat-box" style="background:#fef3c7"><div style="font-size:28px">⭐</div><div style="font-size:22px;font-weight:700;color:${P}">${s.top_score}</div><div style="font-size:11px;color:${GRAY}">Top Score</div></div>
      <div class="stat-box" style="background:#ede9fe"><div style="font-size:28px">⏱️</div><div style="font-size:22px;font-weight:700;color:#7c3aed">${Math.floor(s.total_time / 60)}m</div><div style="font-size:11px;color:${GRAY}">Play Time</div></div>
    </div>`;
    html += `<div style="margin-bottom:16px"><span class="badge" style="background:#059669">${unlocked.length}/${ACHIEVEMENT_DEFS.length} Unlocked</span></div>`;
    // Achievement cards
    html += '<div class="grid">';
    ACHIEVEMENT_DEFS.forEach(a => {
      const isUnlocked = unlockedKeys.has(a.key);
      const uData = unlocked.find(u => u.achievement_key === a.key);
      html += `<div class="game-card" style="opacity:${isUnlocked ? 1 : 0.5}">
        <div style="padding:20px;text-align:center">
          <div style="font-size:48px;margin-bottom:8px">${a.icon}</div>
          <h3 style="font-size:15px;margin:0 0 4px">${esc(a.name)}</h3>
          <p style="font-size:12px;color:${GRAY};margin:0">${esc(a.desc)}</p>
          ${isUnlocked ? `<div style="margin-top:8px"><span class="badge" style="background:#059669">✓ Unlocked</span><div style="font-size:11px;color:${GRAY};margin-top:4px">${uData.unlocked_at.toISOString().split('T')[0]}</div></div>` : '<div style="margin-top:8px"><span class="badge" style="background:#e5e7eb">🔒 Locked</span></div>'}
        </div></div>`;
    });
    html += '</div>';
    res.send(page('Achievements', html));
  }));

  // ======================== 6. LEADERBOARDS ========================
  app.get(BASE+'/leaderboards', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const scope = req.query.scope || 'school';
    const gameFilter = req.query.game || '';
    await seedBuiltinGames(tid);
    const { rows: games } = await pool.query('SELECT id, name FROM ent_games WHERE tenant_id=$1 AND is_active=true ORDER BY name', [tid]);
    let q, params;
    if (scope === 'global') {
      q = `SELECT s.user_email, u.name, s.game_id, g.name AS game_name, s.score, s.result
           FROM ent_game_sessions s LEFT JOIN users u ON u.email=s.user_email LEFT JOIN ent_games g ON g.id=s.game_id
           ORDER BY s.score DESC LIMIT 50`;
      params = [];
    } else if (gameFilter) {
      q = `SELECT s.user_email, u.name, s.game_id, g.name AS game_name, s.score, s.result
           FROM ent_game_sessions s LEFT JOIN users u ON u.email=s.user_email LEFT JOIN ent_games g ON g.id=s.game_id
           WHERE s.tenant_id=$1 AND s.game_id=$2 ORDER BY s.score DESC LIMIT 50`;
      params = [tid, gameFilter];
    } else {
      q = `SELECT s.user_email, u.name, s.game_id, g.name AS game_name, s.score, s.result
           FROM ent_game_sessions s LEFT JOIN users u ON u.email=s.user_email LEFT JOIN ent_games g ON g.id=s.game_id
           WHERE s.tenant_id=$1 ORDER BY s.score DESC LIMIT 50`;
      params = [tid];
    }
    const { rows: leaderboard } = await pool.query(q, params);
    let html = nav(BASE+'/leaderboards') + '<h1 style="font-size:24px;margin-bottom:20px">📊 Leaderboards</h1>';
    // Scope tabs
    html += `<div class="flex flex-wrap" style="margin-bottom:16px">
      <a href="${BASE}/leaderboards?scope=school" class="tab ${scope==='school'?'active':''}">🏫 School</a>
      <a href="${BASE}/leaderboards?scope=global" class="tab ${scope==='global'?'active':''}">🌍 Global</a>
    </div>`;
    // Game filter
    html += `<form method="get" style="display:flex;gap:8px;margin-bottom:16px">
      <input type="hidden" name="scope" value="${esc(scope)}">
      <select name="game" style="width:auto;min-width:200px"><option value="">All Games</option>`;
    games.forEach(g => { html += `<option value="${g.id}" ${gameFilter == g.id ? 'selected' : ''}>${esc(g.name)}</option>`; });
    html += `</select><button class="btn" type="submit">Filter</button></form>`;
    // Table
    html += '<div class="card"><table><thead><tr><th>Rank</th><th>Player</th><th>Game</th><th>Score</th><th>Result</th></tr></thead><tbody>';
    if (!leaderboard.length) {
      html += '<tr><td colspan="5" style="text-align:center;color:'+GRAY+'">No scores yet. Play some games!</td></tr>';
    } else {
      leaderboard.forEach((row, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i + 1}`;
        const resultColor = row.result === 'win' ? '#059669' : row.result === 'lose' ? '#dc2626' : GRAY;
        html += `<tr><td>${medal}</td><td>${esc(row.name || row.user_email || 'Unknown')}</td><td>${esc(row.game_name || 'N/A')}</td><td style="font-weight:700">${row.score}</td><td><span style="color:${resultColor};font-weight:600">${esc(row.result || '-')}</span></td></tr>`;
      });
    }
    html += '</tbody></table></div>';
    res.send(page('Leaderboards', html));
  }));

  // ======================== 7. REVIEWS & RATINGS ========================
  app.post(BASE+'/:id/rate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const rating = parseInt(req.body.rating);
    if (isNaN(rating) || rating < 1 || rating > 5) return res.json({ ok: false, error: 'Rating must be 1-5' });
    await pool.query(`INSERT INTO ent_game_reviews (tenant_id,game_id,user_email,rating,review_text) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (tenant_id,game_id,user_email) DO UPDATE SET rating=$4, review_text=COALESCE($5,review_text), created_at=NOW()`,
      [tid, req.params.id, email, rating, req.body.review_text || '']);
    await pool.query('UPDATE ent_games SET avg_rating=(SELECT AVG(rating) FROM ent_game_reviews WHERE game_id=$1) WHERE id=$1', [req.params.id]);
    res.json({ ok: true });
  }));

  app.post(BASE+'/:id/review', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const { rating, review_text } = req.body;
    if (!rating || !review_text) return res.json({ ok: false, error: 'Rating and review text required' });
    const r = parseInt(rating);
    if (isNaN(r) || r < 1 || r > 5) return res.json({ ok: false, error: 'Rating must be 1-5' });
    await pool.query(`INSERT INTO ent_game_reviews (tenant_id,game_id,user_email,rating,review_text) VALUES ($1,$2,$3,$4,$5)
      ON CONFLICT (tenant_id,game_id,user_email) DO UPDATE SET rating=$4, review_text=$5, created_at=NOW()`,
      [tid, req.params.id, email, r, review_text]);
    await pool.query('UPDATE ent_games SET avg_rating=(SELECT AVG(rating) FROM ent_game_reviews WHERE game_id=$1) WHERE id=$1', [req.params.id]);
    res.redirect(BASE + '/' + req.params.id);
  }));

  // ======================== 8. VIRTUAL CURRENCY & SHOP ========================
  app.get(BASE+'/shop', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const balance = await ensureCurrency(tid, email);
    const { rows: currency } = await pool.query('SELECT * FROM ent_game_currency WHERE tenant_id=$1 AND user_email=$2', [tid, email]);
    const c = currency[0] || {};
    // Seed shop items if empty
    const { rows: existing } = await pool.query('SELECT COUNT(*)::int AS c FROM ent_game_shop_items WHERE tenant_id=$1', [tid]);
    if (existing[0].c === 0) {
      const items = [
        ['Golden Frame', 'Shiny gold avatar frame', '🖼️', 200, 'avatar_frame'],
        ['Neon Frame', 'Cool neon glow frame', '✨', 300, 'avatar_frame'],
        ['Dark Theme', 'Sleek dark profile theme', '🌙', 500, 'theme'],
        ['Ocean Theme', 'Relaxing ocean profile theme', '🌊', 500, 'theme'],
        ['Extra Time +30s', 'Get 30 extra seconds in timed games', '⏰', 100, 'powerup'],
        ['Hint Reveal', 'Get a free hint in any game', '💡', 50, 'powerup'],
        ['Skip Question', 'Skip one question without penalty', '⏭️', 75, 'powerup'],
        ['Double Coins', 'Earn double coins for 1 game', '💰', 150, 'powerup'],
        ['Fire Crown', 'Legendary fire crown avatar frame', '👑', 1000, 'avatar_frame'],
        ['Crystal Theme', 'Beautiful crystal profile theme', '💎', 800, 'theme']
      ];
      for (const [name, desc, icon, price, type] of items) {
        await pool.query('INSERT INTO ent_game_shop_items (tenant_id,name,description,icon,price,item_type) VALUES ($1,$2,$3,$4,$5,$6)',
          [tid, name, desc, icon, price, type]);
      }
    }
    const { rows: items } = await pool.query('SELECT * FROM ent_game_shop_items WHERE tenant_id=$1 AND is_active=true ORDER BY price', [tid]);
    const { rows: purchases } = await pool.query(`SELECT si.* FROM ent_game_purchases p JOIN ent_game_shop_items si ON si.id=p.item_id
      WHERE p.tenant_id=$1 AND p.user_email=$2 ORDER BY p.purchased_at DESC LIMIT 20`, [tid, email]);
    let html = nav(BASE+'/shop') + '<h1 style="font-size:24px;margin-bottom:20px">🛒 Coin Shop</h1>';
    // Balance card
    html += `<div style="background:linear-gradient(135deg,#fbbf24,#f97316);border-radius:14px;padding:24px;color:#fff;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-size:14px;opacity:.8">Your Balance</div><div style="font-size:36px;font-weight:700">🪙 ${balance}</div></div>
        <div style="text-align:right"><div style="font-size:12px;opacity:.8">Total Earned</div><div style="font-size:18px;font-weight:600">🪙 ${c.total_earned || 0}</div>
        <div style="font-size:12px;opacity:.8;margin-top:4px">Total Spent</div><div style="font-size:18px;font-weight:600">🪙 ${c.total_spent || 0}</div></div>
      </div></div>`;
    // Earning info
    html += `<div class="card" style="margin-bottom:16px"><h3 style="margin:0 0 8px">💡 How to Earn Coins</h3>
      <div style="display:flex;gap:16px;flex-wrap:wrap;font-size:13px;color:${GRAY}">
        <span>🎮 Play a game: <strong>+10</strong></span><span>🏆 Win a game: <strong>+50</strong></span>
        <span>🏅 Tournament win: <strong>+100</strong></span><span>⭐ Perfect score: <strong>+100</strong></span></div></div>`;
    // Shop items
    html += '<div class="grid">';
    items.forEach(item => {
      const canBuy = balance >= item.price;
      const typeColor = item.item_type === 'avatar_frame' ? '#7c3aed' : item.item_type === 'theme' ? '#2563eb' : '#059669';
      html += `<div class="game-card">
        <div style="padding:16px;text-align:center">
          <div style="font-size:40px;margin-bottom:8px">${item.icon}</div>
          <h3 style="font-size:15px;margin:0 0 4px">${esc(item.name)}</h3>
          <p style="font-size:12px;color:${GRAY};margin:0 0 8px">${esc(item.description)}</p>
          <span class="badge" style="background:${typeColor}22;color:${typeColor}">${esc(item.item_type.replace('_',' '))}</span>
          <div style="margin-top:10px;font-size:16px;font-weight:700;color:${P}">🪙 ${item.price}</div>
          <form method="post" action="${BASE}/shop/buy" style="margin-top:8px">
            <input type="hidden" name="item_id" value="${item.id}">
            <button class="btn btn-sm ${canBuy ? 'btn-green' : 'btn-gray'}" ${canBuy ? '' : 'disabled'}>${canBuy ? 'Buy Now' : 'Not enough coins'}</button>
          </form></div></div>`;
    });
    html += '</div>';
    // Purchase history
    if (purchases.length) {
      html += '<div class="card" style="margin-top:20px"><h3 style="margin-bottom:12px">📦 Recent Purchases</h3><div style="display:flex;flex-wrap:wrap;gap:8px">';
      purchases.forEach(p => { html += `<span style="background:#f3f4f6;padding:6px 12px;border-radius:8px;font-size:13px">${p.icon} ${esc(p.name)}</span>`; });
      html += '</div></div>';
    }
    res.send(page('Coin Shop', html));
  }));

  app.post(BASE+'/shop/buy', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const { item_id } = req.body;
    const balance = await ensureCurrency(tid, email);
    const { rows: item } = await pool.query('SELECT * FROM ent_game_shop_items WHERE id=$1 AND tenant_id=$2 AND is_active=true', [item_id, tid]);
    if (!item.length) return res.redirect(BASE + '/shop');
    if (balance < item[0].price) return res.redirect(BASE + '/shop');
    await pool.query('UPDATE ent_game_currency SET balance=balance-$1, total_spent=total_spent+$1, updated_at=NOW() WHERE tenant_id=$2 AND user_email=$3', [item[0].price, tid, email]);
    await pool.query('INSERT INTO ent_game_purchases (tenant_id,user_email,item_id,price) VALUES ($1,$2,$3,$4)', [tid, email, item_id, item[0].price]);
    audit(req, 'shop_buy', 'Bought item: ' + item[0].name);
    res.redirect(BASE + '/shop');
  }));

  // ======================== 9. DAILY CHALLENGES ========================
  app.get(BASE+'/daily', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const balance = await ensureCurrency(tid, email);
    await seedBuiltinGames(tid);
    // Seed daily challenges
    const today = new Date().toISOString().split('T')[0];
    const { rows: existing } = await pool.query('SELECT id FROM ent_game_daily_challenges WHERE tenant_id=$1 AND challenge_date=$2', [tid, today]);
    if (!existing.length) {
      const challenges = [
        { text: 'Score 50+ in Math Quiz', game: 'math-quiz', target: 50 },
        { text: 'Win 3 Tic Tac Toe games', game: 'tic-tac-toe', target: 60 },
        { text: 'Complete Memory Match in under 2 minutes', game: 'memory', target: 40 },
        { text: 'Score 30+ in Word Scramble', game: 'word-scramble', target: 30 },
        { text: 'Answer 10+ Trivia correctly', game: 'trivia', target: 100 }
      ];
      const ch = challenges[Math.floor(Math.random() * challenges.length)];
      const { rows: game } = await pool.query("SELECT id FROM ent_games WHERE slug=$1 AND tenant_id=$2", [ch.game, tid]);
      if (game.length) {
        await pool.query('INSERT INTO ent_game_daily_challenges (tenant_id,challenge_date,game_id,challenge_text,target_score,reward_coins) VALUES ($1,$2,$3,$4,$5,50)',
          [tid, today, game[0].id, ch.text, ch.target]);
      }
    }
    const { rows: challenge } = await pool.query('SELECT dc.*, g.name AS game_name, g.slug FROM ent_game_daily_challenges dc LEFT JOIN ent_games g ON g.id=dc.game_id WHERE dc.tenant_id=$1 AND dc.challenge_date=$2', [tid, today]);
    const { rows: completion } = challenge.length ? await pool.query('SELECT * FROM ent_game_daily_completions WHERE tenant_id=$1 AND user_email=$2 AND challenge_id=$3', [tid, email, challenge[0].id]) : [];
    const isCompleted = completion.length > 0 && completion[0].completed;
    let html = nav(BASE+'/daily') + '<h1 style="font-size:24px;margin-bottom:20px">📅 Daily Challenge</h1>';
    html += `<div style="background:linear-gradient(135deg,#7c3aed,#2563eb);border-radius:14px;padding:24px;color:#fff;margin-bottom:20px">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <div><div style="font-size:14px;opacity:.8">Today's Challenge</div><div style="font-size:12px;opacity:.6">${today}</div></div>
        <div style="font-size:36px">🎯</div>
      </div></div>`;
    if (challenge.length) {
      const ch = challenge[0];
      html += `<div class="card" style="border-left:4px solid ${isCompleted ? '#059669' : P}">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <h3 style="font-size:18px;margin:0">${esc(ch.challenge_text)}</h3>
          ${isCompleted ? '<span class="badge" style="background:#059669">✓ Completed!</span>' : '<span class="badge" style="background:#f59e0b">Active</span>'}
        </div>
        <div class="flex" style="gap:16px;margin:8px 0">
          <span style="font-size:13px;color:${GRAY}">🎮 ${esc(ch.game_name || 'N/A')}</span>
          <span style="font-size:13px;color:${GRAY}">Target: ${ch.target_score} pts</span>
          <span style="font-size:13px;color:#059669;font-weight:600">Reward: 🪙 ${ch.reward_coins} coins</span>
        </div>
        ${!isCompleted && ch.slug ? `<a href="${BASE}/${ch.slug}" class="btn btn-green" style="margin-top:8px">▶ Play Now</a>` : ''}
      </div>`;
    } else {
      html += '<div class="card" style="text-align:center"><p style="color:'+GRAY+'">No challenge today.</p></div>';
    }
    // Coins balance
    html += `<div class="card" style="margin-top:16px;display:flex;justify-content:space-between;align-items:center">
      <span style="font-size:16px">Your Coins</span><span style="font-size:24px;font-weight:700;color:${P}">🪙 ${balance}</span></div>`;
    res.send(page('Daily Challenge', html));
  }));

  // ======================== 10. CATEGORIES ========================
  app.get(BASE+'/categories', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    await seedBuiltinGames(tid);
    const { rows: cats } = await pool.query(`SELECT category, COUNT(*)::int AS game_count,
      MAX(avg_rating) AS top_rating, (ARRAY_AGG(name ORDER BY play_count DESC))[1] AS top_game
      FROM ent_games WHERE tenant_id=$1 AND is_active=true GROUP BY category ORDER BY game_count DESC`, [tid]);
    const catIcons = { Puzzle:'🧩', Arcade:'👾', Strategy:'♟️', Trivia:'❓', Sports:'⚽', Racing:'🏎️',
      Word:'📝', Math:'🔢', Memory:'🧠', Adventure:'🗺️', Board:'🎲' };
    const catColors = { Puzzle:'#6366f1', Arcade:'#ef4444', Strategy:'#059669', Trivia:'#8b5cf6',
      Sports:'#16a34a', Racing:'#ea580c', Word:'#2563eb', Math:'#7c3aed', Memory:'#0891b2',
      Adventure:'#b91c1c', Board:'#a16207' };
    let html = nav(BASE+'/categories') + '<h1 style="font-size:24px;margin-bottom:20px">📂 Game Categories</h1>';
    html += '<div class="grid">';
    cats.forEach(c => {
      const icon = catIcons[c.category] || '🎮';
      const color = catColors[c.category] || GRAY;
      html += `<div class="game-card" style="cursor:pointer" onclick="location.href='${BASE}?cat=${esc(c.category)}'">
        <div style="padding:20px;text-align:center">
          <div style="font-size:48px;margin-bottom:8px">${icon}</div>
          <h3 style="font-size:16px;margin:0 0 4px">${esc(c.category)}</h3>
          <p style="font-size:12px;color:${GRAY};margin:0 0 8px">${c.game_count} game(s)</p>
          ${c.top_game ? `<p style="font-size:12px;color:${color};font-weight:600">Top: ${esc(c.top_game)}</p>` : ''}
          <div style="margin-top:8px"><span class="badge" style="background:${color}22;color:${color}">Browse →</span></div>
        </div></div>`;
    });
    html += '</div>';
    res.send(page('Game Categories', html));
  }));

  // ======================== 11. GAME SAVES & PROGRESS ========================
  app.get(BASE+'/progress', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const { rows: stats } = await pool.query(`SELECT COUNT(*)::int AS total_games,
      COUNT(*) FILTER (WHERE result='win')::int AS total_wins,
      COALESCE(SUM(time_played),0)::int AS total_time,
      COALESCE(SUM(score),0)::int AS total_score,
      COALESCE(MAX(score),0)::int AS high_score,
      COALESCE(SUM(coins_earned),0)::int AS total_coins
      FROM ent_game_sessions WHERE tenant_id=$1 AND user_email=$2`, [tid, email]);
    const s = stats.rows[0];
    const { rows: recent } = await pool.query(`SELECT gs.*, g.name AS game_name, g.category
      FROM ent_game_sessions gs LEFT JOIN ent_games g ON g.id=gs.game_id
      WHERE gs.tenant_id=$1 AND gs.user_email=$2 ORDER BY gs.played_at DESC LIMIT 20`, [tid, email]);
    const { rows: perGame } = await pool.query(`SELECT g.name, g.category, COUNT(*)::int AS sessions,
      MAX(gs.score)::int AS best_score, COALESCE(SUM(gs.time_played),0)::int AS time_spent
      FROM ent_game_sessions gs JOIN ent_games g ON g.id=gs.game_id
      WHERE gs.tenant_id=$1 AND gs.user_email=$2 GROUP BY g.name, g.category ORDER BY sessions DESC`, [tid, email]);
    let html = nav(BASE) + '<h1 style="font-size:24px;margin-bottom:20px">📈 Your Progress</h1>';
    html += `<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;margin-bottom:20px">
      <div class="stat-box" style="background:#dbeafe"><div style="font-size:28px">🎮</div><div style="font-size:24px;font-weight:700;color:#2563eb">${s.total_games}</div><div style="font-size:11px;color:${GRAY}">Games Played</div></div>
      <div class="stat-box" style="background:#d1fae5"><div style="font-size:28px">🏆</div><div style="font-size:24px;font-weight:700;color:#059669">${s.total_wins}</div><div style="font-size:11px;color:${GRAY}">Total Wins</div></div>
      <div class="stat-box" style="background:#fef3c7"><div style="font-size:28px">⭐</div><div style="font-size:24px;font-weight:700;color:${P}">${s.high_score}</div><div style="font-size:11px;color:${GRAY}">High Score</div></div>
      <div class="stat-box" style="background:#ede9fe"><div style="font-size:28px">⏱️</div><div style="font-size:24px;font-weight:700;color:#7c3aed">${Math.floor(s.total_time/60)}m</div><div style="font-size:11px;color:${GRAY}">Total Play Time</div></div>
      <div class="stat-box" style="background:#fce7f3"><div style="font-size:28px">🪙</div><div style="font-size:24px;font-weight:700;color:#ec4899">${s.total_coins}</div><div style="font-size:11px;color:${GRAY}">Coins Earned</div></div>
    </div>`;
    // Per-game breakdown
    if (perGame.length) {
      html += '<div class="card"><h2 style="margin-bottom:12px">📊 Per-Game Stats</h2><table><thead><tr><th>Game</th><th>Sessions</th><th>Best Score</th><th>Time Spent</th></tr></thead><tbody>';
      perGame.forEach(pg => {
        html += `<tr><td><strong>${esc(pg.name)}</strong><br><span class="badge" style="background:#f3f4f6">${esc(pg.category)}</span></td><td>${pg.sessions}</td><td style="font-weight:700">${pg.best_score}</td><td>${Math.floor(pg.time_spent/60)}m ${pg.time_spent%60}s</td></tr>`;
      });
      html += '</tbody></table></div>';
    }
    // Recent sessions
    if (recent.length) {
      html += '<div class="card"><h2 style="margin-bottom:12px">🕐 Recent Sessions</h2><table><thead><tr><th>Game</th><th>Score</th><th>Result</th><th>Time</th><th>Coins</th><th>Played</th></tr></thead><tbody>';
      recent.forEach(r => {
        const rc = r.result === 'win' ? '#059669' : r.result === 'lose' ? '#dc2626' : GRAY;
        html += `<tr><td>${esc(r.game_name||'N/A')}</td><td style="font-weight:700">${r.score}</td><td style="color:${rc};font-weight:600">${esc(r.result||'-')}</td><td>${Math.floor(r.time_played/60)}m ${r.time_played%60}s</td><td>🪙 ${r.coins_earned}</td><td style="font-size:12px;color:${GRAY}">${r.played_at ? r.played_at.toISOString().replace('T',' ').substring(0,16) : ''}</td></tr>`;
      });
      html += '</tbody></table></div>';
    }
    res.send(page('Your Progress', html));
  }));

  // ======================== GAME DETAIL PAGE ========================
  app.get(BASE+'/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const { rows: game } = await pool.query('SELECT * FROM ent_games WHERE id=$1 AND tenant_id=$2 AND is_active=true', [req.params.id, tid]);
    if (!game.length) return res.status(404).send(page('Not Found', '<p>Game not found.</p>'));
    const g = game[0];
    const icon = BUILTIN_GAMES.find(b => b.slug === g.slug);
    const thumb = icon ? icon.icon : '🎮';
    const thumbBg = { Puzzle:'#6366f1', Arcade:'#ef4444', Strategy:'#059669', Trivia:'#8b5cf6',
      Sports:'#16a34a', Racing:'#ea580c', Word:'#2563eb', Math:'#7c3aed', Memory:'#0891b2',
      Adventure:'#b91c1c', Board:'#a16207' };
    const color = thumbBg[g.category] || GRAY;
    const { rows: reviews } = await pool.query(
      'SELECT r.*, u.name AS reviewer_name FROM ent_game_reviews r LEFT JOIN users u ON u.email=r.user_email WHERE r.tenant_id=$1 AND r.game_id=$2 ORDER BY r.created_at DESC LIMIT 20',
      [tid, g.id]);
    const { rows: topScores } = await pool.query(
      `SELECT gs.user_email, u.name, gs.score, gs.time_played, gs.played_at FROM ent_game_sessions gs
       LEFT JOIN users u ON u.email=gs.user_email WHERE gs.tenant_id=$1 AND gs.game_id=$2 ORDER BY gs.score DESC LIMIT 10`,
      [tid, g.id]);
    const { rows: myReview } = await pool.query('SELECT * FROM ent_game_reviews WHERE tenant_id=$1 AND game_id=$2 AND user_email=$3', [tid, g.id, email]);
    const userStats = await pool.query(
      `SELECT COUNT(*)::int AS sessions, MAX(score)::int AS best, COALESCE(SUM(time_played),0)::int AS total_time, COUNT(*) FILTER (WHERE result='win')::int AS wins
       FROM ent_game_sessions WHERE tenant_id=$1 AND game_id=$2 AND user_email=$3`, [tid, g.id, email]);
    const us = userStats.rows[0];
    let html = nav(BASE) + '<div style="display:flex;gap:20px;flex-wrap:wrap;margin-bottom:24px">';
    // Game info card
    html += `<div style="flex:1;min-width:300px">
      <div style="background:linear-gradient(135deg,${color},${color}88);border-radius:14px;padding:24px;color:#fff;margin-bottom:16px">
        <div style="display:flex;gap:16px;align-items:center">
          <div style="font-size:64px">${thumb}</div>
          <div style="flex:1">
            <h1 style="font-size:24px;margin:0 0 4px">${esc(g.name)}</h1>
            <span class="badge" style="background:rgba(255,255,255,.2)">${esc(g.category)}</span>
            <div style="margin-top:8px">${stars(g.avg_rating)} <span style="font-size:13px;opacity:.9">(${g.play_count} plays)</span></div>
          </div>
        </div></div>
      <p style="font-size:15px;line-height:1.6;margin-bottom:16px">${esc(g.description || 'No description available.')}</p>`;
    if (g.is_builtin && g.slug) {
      html += `<a href="${BASE}/${g.slug}" class="btn btn-green" style="padding:14px 32px;font-size:16px;font-weight:700">▶ Play Now</a>`;
    } else if (g.game_url) {
      html += `<a href="${g.game_url}" class="btn btn-green" style="padding:14px 32px;font-size:16px;font-weight:700" target="_blank">▶ Play Now</a>`;
    }
    html += '</div>';
    // Your stats card
    html += `<div style="flex:0 0 280px">
      <div class="card"><h3 style="margin:0 0 12px">📊 Your Stats</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
          <div class="stat-box" style="background:#dbeafe"><div style="font-size:20px;font-weight:700;color:#2563eb">${us.sessions}</div><div style="font-size:11px;color:${GRAY}">Sessions</div></div>
          <div class="stat-box" style="background:#fef3c7"><div style="font-size:20px;font-weight:700;color:${P}">${us.best || 0}</div><div style="font-size:11px;color:${GRAY}">Best Score</div></div>
          <div class="stat-box" style="background:#d1fae5"><div style="font-size:20px;font-weight:700;color:#059669">${us.wins}</div><div style="font-size:11px;color:${GRAY}">Wins</div></div>
          <div class="stat-box" style="background:#ede9fe"><div style="font-size:20px;font-weight:700;color:#7c3aed">${Math.floor((us.total_time||0)/60)}m</div><div style="font-size:11px;color:${GRAY}">Play Time</div></div>
        </div></div></div>`;
    html += '</div>';
    // Rate this game
    html += `<div class="card"><h3 style="margin:0 0 12px">⭐ Rate & Review</h3>
      <form method="post" action="${BASE}/${g.id}/review" style="max-width:500px">
        <div style="margin-bottom:12px">
          <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Rating</label>
          <select name="rating" style="width:auto">
            <option value="5" ${myReview.length && myReview[0].rating===5?'selected':''}>★★★★★ (5)</option>
            <option value="4" ${myReview.length && myReview[0].rating===4?'selected':''}>★★★★ (4)</option>
            <option value="3" ${myReview.length && myReview[0].rating===3?'selected':''}>★★★ (3)</option>
            <option value="2" ${myReview.length && myReview[0].rating===2?'selected':''}>★★ (2)</option>
            <option value="1" ${myReview.length && myReview[0].rating===1?'selected':''}>★ (1)</option>
          </select></div>
        <div style="margin-bottom:12px">
          <label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Review</label>
          <textarea name="review_text" rows="3" placeholder="Share your thoughts...">${myReview.length ? esc(myReview[0].review_text||'') : ''}</textarea></div>
        <button type="submit" class="btn">${myReview.length ? 'Update Review' : 'Submit Review'}</button>
      </form></div>`;
    // Reviews
    if (reviews.length) {
      html += '<div class="card"><h3 style="margin:0 0 12px">💬 Reviews</h3>';
      reviews.forEach(r => {
        html += `<div style="padding:10px 0;border-bottom:1px solid #f3f4f6">
          <div class="flex" style="margin-bottom:4px"><strong style="font-size:14px">${esc(r.reviewer_name || r.user_email)}</strong><span style="margin-left:8px">${stars(r.rating)}</span></div>
          <p style="font-size:13px;color:${GRAY};margin:0">${esc(r.review_text || 'No comment')}</p>
          <span style="font-size:11px;color:${GRAY}">${r.created_at ? r.created_at.toISOString().split('T')[0] : ''}</span></div>`;
      });
      html += '</div>';
    }
    // Top Scores
    if (topScores.length) {
      html += '<div class="card"><h3 style="margin:0 0 12px">🏆 Top Scores</h3><table><thead><tr><th>Rank</th><th>Player</th><th>Score</th><th>Time</th></tr></thead><tbody>';
      topScores.forEach((s, i) => {
        const medal = i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : `#${i+1}`;
        html += `<tr><td>${medal}</td><td>${esc(s.name || s.user_email)}</td><td style="font-weight:700">${s.score}</td><td>${Math.floor(s.time_played/60)}m ${s.time_played%60}s</td></tr>`;
      });
      html += '</tbody></table></div>';
    }
    res.send(page(g.name, html));
  }));

  // ======================== USER STATS API ========================
  app.get(BASE+'/api/stats', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = getTenantId(req);
    const email = getUserEmail(req);
    const balance = await ensureCurrency(tid, email);
    const { rows: sessions } = await pool.query(
      `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE result='win')::int AS wins,
       COALESCE(SUM(score),0)::int AS total_score, COALESCE(MAX(score),0)::int AS high_score,
       COALESCE(SUM(time_played),0)::int AS total_time, COALESCE(SUM(coins_earned),0)::int AS total_coins
       FROM ent_game_sessions WHERE tenant_id=$1 AND user_email=$2`, [tid, email]);
    const { rows: achievements } = await pool.query(
      'SELECT COUNT(*)::int AS unlocked FROM ent_game_achievements WHERE tenant_id=$1 AND user_email=$2', [tid, email]);
    const { rows: activeTournaments } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM ent_game_tournament_players tp
       JOIN ent_game_tournaments t ON t.id=tp.tournament_id
       WHERE t.tenant_id=$1 AND tp.user_email=$2 AND t.status IN ('open','active')`, [tid, email]);
    const s = sessions[0] || {};
    res.json({
      total_games: s.total || 0, wins: s.wins || 0, total_score: s.total_score || 0,
      high_score: s.high_score || 0, total_time: s.total_time || 0, total_coins: s.total_coins || 0,
      coins_balance: balance, achievements_unlocked: achievements[0]?.unlocked || 0,
      achievements_total: ACHIEVEMENT_DEFS.length, active_tournaments: activeTournaments[0]?.cnt || 0
    });
  }));

  // ======================== MARKETING ROUTES ========================
  app.get('/entertainment', requireAuth, ah(async (req, res) => {
    res.redirect(BASE);
  }));

  app.get('/entertainment/games/progress', requireAuth, ah(async (req, res) => {
    res.redirect(BASE + '/progress');
  }));

  console.log('[EntertainmentGaming] Module loaded — ' + BASE);
};
