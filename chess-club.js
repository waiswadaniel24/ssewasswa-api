// ============================================================
// CHESS CLUB MODULE — Multi-Tenant SaaS School Portal
// Tournaments, ELO ratings, PGN games, puzzles, leaderboard, teaching
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // -- internal helpers ---------------------------------------------------
  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const nav = (active) => `<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
    <a href="/school/chess-club" class="btn ${active==='dash'?'':'btn-outline'}" style="${active==='dash'?'background:#3730a3':''}">♟️ Dashboard</a>
    <a href="/school/chess-club/members" class="btn ${active==='members'?'':'btn-outline'}" style="${active==='members'?'background:#3730a3':''}">👥 Members</a>
    <a href="/school/chess-club/play/challenge" class="btn ${active==='challenge'?'':'btn-outline'}" style="${active==='challenge'?'background:#3730a3':''}">⚔️ Challenge</a>
    <a href="/school/chess-club/games" class="btn ${active==='games'?'':'btn-outline'}" style="${active==='games'?'background:#3730a3':''}">♟️ Games</a>
    <a href="/school/chess-club/tournaments" class="btn ${active==='tournaments'?'':'btn-outline'}" style="${active==='tournaments'?'background:#3730a3':''}">🏆 Tournaments</a>
    <a href="/school/chess-club/puzzles" class="btn ${active==='puzzles'?'':'btn-outline'}" style="${active==='puzzles'?'background:#3730a3':''}">🧩 Puzzles</a>
    <a href="/school/chess-club/leaderboard" class="btn ${active==='leaderboard'?'':'btn-outline'}" style="${active==='leaderboard'?'background:#3730a3':''}">📊 Leaderboard</a>
    <a href="/school/chess-club/teaching-resources" class="btn ${active==='teaching'?'':'btn-outline'}" style="${active==='teaching'?'background:#3730a3':''}">📚 Teaching</a>
  </div>`;

  const statusBadge = s => {
    const m = { active: '#16a34a', upcoming: '#2563eb', completed: '#9ca3af', cancelled: '#dc2626', open: '#16a34a', closed: '#9ca3af', ongoing: '#f59e0b', pending: '#2563eb', accepted: '#16a34a', declined: '#dc2626', in_progress: '#f59e0b', finished: '#9ca3af' };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${m[s]||GRAY}20;color:${m[s]||GRAY}">${esc(s)}</span>`;
  };

  const statCard = (num, label, color) => `<div class="card" style="text-align:center;padding:16px"><div style="font-size:28px;font-weight:800;color:${color||P}">${num}</div><div style="font-size:12px;color:${GRAY};margin-top:4px">${esc(label)}</div></div>`;

  // ELO calculation
  const calcElo = (ratingA, ratingB, scoreA, k) => {
    k = k || 32;
    const expectedA = 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
    return Math.round(ratingA + k * (scoreA - expectedA));
  };

  const eloColor = r => r >= 2000 ? '#dc2626' : r >= 1600 ? '#f59e0b' : r >= 1200 ? '#16a34a' : r >= 800 ? '#2563eb' : GRAY;
  const eloTitle = r => r >= 2000 ? 'Grandmaster' : r >= 1600 ? 'Expert' : r >= 1200 ? 'Intermediate' : r >= 800 ? 'Beginner' : 'Novice';

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS chess_members (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL UNIQUE, elo_rating INTEGER DEFAULT 1000,
        wins INTEGER DEFAULT 0, losses INTEGER DEFAULT 0, draws INTEGER DEFAULT 0,
        games_played INTEGER DEFAULT 0, joined_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS chess_games (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        white_id INTEGER NOT NULL, black_id INTEGER NOT NULL,
        result VARCHAR(20), moves TEXT, pgn TEXT,
        game_date DATE DEFAULT CURRENT_DATE, tournament_id INTEGER,
        time_control VARCHAR(20) DEFAULT '15+10', status VARCHAR(20) DEFAULT 'pending',
        elo_change_white INTEGER DEFAULT 0, elo_change_black INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS chess_tournaments (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, format VARCHAR(50) DEFAULT 'swiss',
        start_date DATE, end_date DATE, status VARCHAR(20) DEFAULT 'upcoming',
        participants JSONB DEFAULT '[]', results JSONB DEFAULT '[]',
        rounds INTEGER DEFAULT 5, current_round INTEGER DEFAULT 0,
        max_players INTEGER DEFAULT 16, description TEXT
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS chess_puzzles (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        fen VARCHAR(500) NOT NULL, solution TEXT NOT NULL,
        difficulty VARCHAR(20) DEFAULT 'medium', theme VARCHAR(100),
        description TEXT, puzzle_type VARCHAR(50) DEFAULT 'checkmate',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS chess_challenges (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        challenger_id INTEGER NOT NULL, challenged_id INTEGER NOT NULL,
        status VARCHAR(20) DEFAULT 'pending',
        time_control VARCHAR(20) DEFAULT '15+10', message TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), responded_at TIMESTAMPTZ
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS chess_puzzle_attempts (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        puzzle_id INTEGER REFERENCES chess_puzzles(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL, correct BOOLEAN DEFAULT false,
        attempt TEXT, attempted_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS chess_teaching (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL, category VARCHAR(100), content TEXT,
        difficulty VARCHAR(20), order_num INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS chess_meetings (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255), meeting_date TIMESTAMPTZ, venue VARCHAR(255),
        description TEXT, status VARCHAR(20) DEFAULT 'upcoming'
      )`);
      // indexes
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_cm_tenant ON chess_members(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_cm_student ON chess_members(tenant_id, student_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_cg_tenant ON chess_games(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ct_tenant ON chess_tournaments(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_cpz_tenant ON chess_puzzles(tenant_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ch_tenant ON chess_challenges(tenant_id)`);
      console.log('[ChessClub] OK');
    } catch(e) { console.warn('[ChessClub] Warn:', e.message); }
  })();

  // ============================================================
  // ROUTE 1: GET /school/chess-club — Dashboard
  // ============================================================
  app.get('/school/chess-club', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, uid = user.id;
    const [memberCount, gameCount, puzzleCount, myMember, recentGames, upcomingTournaments, myChallenges, meetings] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int as c FROM chess_members WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT COUNT(*)::int as c FROM chess_games WHERE tenant_id=$1 AND status='finished'`, [tid]),
      pool.query(`SELECT COUNT(*)::int as c FROM chess_puzzles WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT * FROM chess_members WHERE tenant_id=$1 AND student_id=$2`, [tid, uid]),
      pool.query(`SELECT g.*, ws.name as white_name, bs.name as black_name FROM chess_games g LEFT JOIN students ws ON ws.id=g.white_id LEFT JOIN students bs ON bs.id=g.black_id WHERE g.tenant_id=$1 ORDER BY g.created_at DESC LIMIT 8`, [tid]),
      pool.query(`SELECT * FROM chess_tournaments WHERE tenant_id=$1 AND status IN ('upcoming','ongoing') ORDER BY start_date LIMIT 3`, [tid]),
      pool.query(`SELECT c.*, cs.name as challenger_name FROM chess_challenges c LEFT JOIN students cs ON cs.id=c.challenger_id WHERE c.tenant_id=$1 AND c.challenged_id=$2 AND c.status='pending' ORDER BY c.created_at DESC LIMIT 5`, [tid, uid]),
      pool.query(`SELECT * FROM chess_meetings WHERE tenant_id=$1 AND status='upcoming' ORDER BY meeting_date LIMIT 3`, [tid])
    ]);

    const me = myMember.rows[0];
    const myElo = me ? me.elo_rating : 1000;
    const myRecord = me ? `${me.wins}W / ${me.losses}L / ${me.draws}D` : 'Not a member';

    const recentHtml = recentGames.rows.map(g => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6">
      <div style="min-width:80px;font-size:12px;color:${GRAY}">${fmtDate(g.game_date)}</div>
      <div style="flex:1;font-size:13px"><strong>${esc(g.white_name || '?')}</strong> vs <strong>${esc(g.black_name || '?')}</strong></div>
      <div style="font-size:12px;font-weight:700;color:${g.result==='1-0'?'#16a34a':g.result==='0-1'?'#dc2626':'#f59e0b'}">${esc(g.result || '?')}</div>
      <div style="font-size:11px;color:${GRAY}">${esc(g.time_control || '—')}</div>
    </div>`).join('');

    const tournamentHtml = upcomingTournaments.rows.map(t => {
      const parts = Array.isArray(t.participants) ? t.participants : [];
      return `<div class="card" style="padding:14px;display:flex;align-items:center;gap:14px">
        <div style="font-size:28px">🏆</div>
        <div style="flex:1"><strong style="font-size:14px">${esc(t.name)}</strong><div style="font-size:12px;color:${GRAY};margin-top:2px">${esc(t.format)} · ${fmtDate(t.start_date)} · ${parts.length}/${t.max_players||16} players</div></div>
        ${statusBadge(t.status)}
      </div>`;
    }).join('');

    const challengeHtml = myChallenges.rows.map(c => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6">
      <strong style="font-size:13px">${esc(c.challenger_name || 'Someone')}</strong>
      <span style="font-size:12px;color:${GRAY}">wants to play (${esc(c.time_control || '15+10')})</span>
      <form method="POST" action="/school/chess-club/play/challenge/${c.id}/respond" style="display:flex;gap:4px">
        <button name="action" value="accept" class="btn" style="font-size:11px;padding:4px 10px;background:#16a34a">Accept</button>
        <button name="action" value="decline" class="btn" style="font-size:11px;padding:4px 10px;background:#dc2626">Decline</button>
      </form>
    </div>`).join('');

    const meetingHtml = meetings.rows.map(m => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6">
      <span style="font-size:20px">📅</span>
      <div style="flex:1"><strong style="font-size:13px">${esc(m.title)}</strong><div style="font-size:11px;color:${GRAY}">${fmtDate(m.meeting_date)} · ${esc(m.venue || 'TBD')}</div></div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1200px;margin:0 auto">${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">♟️ Chess Club</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Sharpen your mind, master the game</p></div>
        <div style="display:flex;gap:8px">
          ${!me ? `<form method="POST" action="/school/chess-club/join"><button class="btn" style="background:#16a34a;padding:10px 20px">Join Club</button></form>` : ''}
          <a href="/school/chess-club/play/challenge" class="btn" style="padding:10px 20px">⚔️ Challenge</a>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px">
        ${statCard(memberCount.rows[0].c, 'Members', P)}
        ${statCard(myElo, 'My ELO', eloColor(myElo))}
        ${statCard(gameCount.rows[0].c, 'Games Played', '#16a34a')}
        ${statCard(puzzleCount.rows[0].c, 'Puzzles', '#f59e0b')}
        ${statCard(me ? me.games_played : 0, 'My Games', '#2563eb')}
        ${statCard(myRecord, 'My Record', '#8b5cf6')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card"><h3 style="margin:0 0 12px;font-size:15px">♟️ Recent Games</h3>${recentHtml || '<p style="color:${GRAY};text-align:center;padding:20px">No games yet</p>'}</div>
        <div class="card"><h3 style="margin:0 0 12px;font-size:15px">⚔️ Pending Challenges</h3>${challengeHtml || '<p style="color:${GRAY};text-align:center;padding:20px">No pending challenges</p>'}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card"><h3 style="margin:0 0 12px;font-size:15px">🏆 Upcoming Tournaments</h3>${tournamentHtml || '<p style="color:${GRAY};text-align:center;padding:20px">No tournaments</p>'}</div>
        <div class="card"><h3 style="margin:0 0 12px;font-size:15px">📅 Club Meetings</h3>${meetingHtml || '<p style="color:${GRAY};text-align:center;padding:20px">No meetings scheduled</p>'}</div>
      </div>
    </div>`;
    res.send(renderPage('Chess Club', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: POST /school/chess-club/join
  // ============================================================
  app.post('/school/chess-club/join', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    const existing = (await pool.query(`SELECT id FROM chess_members WHERE tenant_id=$1 AND student_id=$2`, [tid, uid])).rows[0];
    if (!existing) {
      await pool.query(`INSERT INTO chess_members (tenant_id, student_id) VALUES ($1,$2)`, [tid, uid]);
      await audit(tid, uid, 'chess_join');
    }
    req.session.flash = { type: 'success', msg: 'Welcome to the Chess Club!' };
    res.redirect('/school/chess-club');
  }));

  // ============================================================
  // ROUTE 3: GET /school/chess-club/members
  // ============================================================
  app.get('/school/chess-club/members', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const members = (await pool.query(`SELECT cm.*, s.name as student_name FROM chess_members cm LEFT JOIN students s ON s.id=cm.student_id WHERE cm.tenant_id=$1 ORDER BY cm.elo_rating DESC`, [tid])).rows;

    const rowsHtml = members.map((m, i) => `<tr>
      <td><span style="width:26px;height:26px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;background:${i<3?'#fbbf24':'#f3f4f6'};color:${i<3?'#92400e':GRAY}">${i+1}</span></td>
      <td><strong style="font-size:14px">${esc(m.student_name || 'Unknown')}</strong></td>
      <td><span style="font-size:16px;font-weight:800;color:${eloColor(m.elo_rating)}">${m.elo_rating}</span> <span style="font-size:11px;color:${GRAY}">${eloTitle(m.elo_rating)}</span></td>
      <td style="font-size:13px"><span style="color:#16a34a;font-weight:600">${m.wins||0}W</span> / <span style="color:#dc2626;font-weight:600">${m.losses||0}L</span> / <span style="color:#f59e0b;font-weight:600">${m.draws||0}D</span></td>
      <td style="font-size:13px">${m.games_played||0}</td>
      <td style="font-size:12px;color:${GRAY}">${fmtDate(m.joined_at)}</td>
      <td><a href="/school/chess-club/play/challenge?opponent=${m.student_id}" class="btn" style="font-size:11px;padding:4px 10px;${m.student_id===user.id?'pointer-events:none;opacity:.5':''}">⚔️</a></td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1000px;margin:0 auto">${nav('members')}
      <div><h1 style="font-size:24px;margin:0">👥 Club Members</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${members.length} active members</p></div>
      <div class="card" style="margin-top:20px"><div style="overflow-x:auto"><table>
        <thead><tr><th>#</th><th>Player</th><th>ELO</th><th>Record</th><th>Games</th><th>Joined</th><th>Challenge</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:${GRAY};padding:30px">No members yet</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Chess Club Members', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: GET /school/chess-club/play/challenge — Challenge
  // ============================================================
  app.get('/school/chess-club/play/challenge', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, uid = user.id;
    const members = (await pool.query(`SELECT cm.student_id, s.name FROM chess_members cm LEFT JOIN students s ON s.id=cm.student_id WHERE cm.tenant_id=$1 AND cm.student_id != $2 ORDER BY cm.elo_rating DESC`, [tid, uid])).rows;
    const myOutgoing = (await pool.query(`SELECT cc.*, cs.name as challenged_name FROM chess_challenges cc LEFT JOIN students cs ON cs.id=cc.challenged_id WHERE cc.tenant_id=$1 AND cc.challenger_id=$2 AND cc.status='pending' ORDER BY cc.created_at DESC`, [tid, uid])).rows;

    const timeControls = [
      { value: '5+0', label: 'Blitz 5+0' }, { value: '5+3', label: 'Blitz 5+3' },
      { value: '10+0', label: 'Rapid 10+0' }, { value: '10+5', label: 'Rapid 10+5' },
      { value: '15+10', label: 'Classical 15+10' }, { value: '30+0', label: 'Classical 30+0' }
    ];

    const memberOpts = members.map(m => `<option value="${m.student_id}" ${m.student_id === parseInt(req.query.opponent) ? 'selected' : ''}>${esc(m.name || 'Player ' + m.student_id)}</option>`).join('');
    const tcOpts = timeControls.map(tc => `<option value="${tc.value}">${tc.label}</option>`).join('');

    const outgoingHtml = myOutgoing.map(c => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6">
      <span style="font-size:13px">Sent to <strong>${esc(c.challenged_name || '?')}</strong></span>
      <span style="font-size:11px;color:${GRAY}">(${esc(c.time_control || '15+10')})</span>
      ${statusBadge(c.status)}
    </div>`).join('');

    const html = SKIP + `<div style="max-width:800px;margin:0 auto">${nav('challenge')}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:24px">
          <h2 style="margin:0 0 20px">⚔️ Issue a Challenge</h2>
          <form method="POST" action="/school/chess-club/play/challenge" style="display:flex;flex-direction:column;gap:16px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Opponent *</label><select name="challenged_id"><option value="">Select opponent</option>${memberOpts}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Time Control</label><select name="time_control">${tcOpts}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Message (optional)</label><input type="text" name="message" placeholder="Good luck!"></div>
            <button type="submit" class="btn" style="padding:12px">Send Challenge</button>
          </form>
        </div>
        <div class="card" style="padding:24px">
          <h2 style="margin:0 0 14px">📤 My Outgoing Challenges</h2>
          ${outgoingHtml || '<p style="color:${GRAY};font-size:13px;padding:20px;text-align:center">No pending challenges</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Challenge', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: POST /school/chess-club/play/challenge
  // ============================================================
  app.post('/school/chess-club/play/challenge', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    const { challenged_id, time_control, message } = req.body;
    if (!challenged_id) { req.session.flash = { type: 'error', msg: 'Select an opponent' }; return res.redirect('/school/chess-club/play/challenge'); }
    if (parseInt(challenged_id) === uid) { req.session.flash = { type: 'error', msg: 'Cannot challenge yourself' }; return res.redirect('/school/chess-club/play/challenge'); }
    await pool.query(`INSERT INTO chess_challenges (tenant_id, challenger_id, challenged_id, time_control, message) VALUES ($1,$2,$3,$4,$5)`,
      [tid, uid, parseInt(challenged_id), time_control || '15+10', message ? message.trim() : null]);
    await audit(tid, uid, 'chess_challenge', { challenged_id: parseInt(challenged_id) });
    if (queueEmail) {
      const challenged = (await pool.query(`SELECT email FROM students WHERE id=$1`, [parseInt(challenged_id)])).rows[0];
      if (challenged?.email) await queueEmail(tid, challenged.email, 'Chess Challenge', `${user.name} has challenged you to a chess game!`);
    }
    req.session.flash = { type: 'success', msg: 'Challenge sent!' };
    res.redirect('/school/chess-club/play/challenge');
  }));

  // ============================================================
  // ROUTE 6: POST challenge respond & accept
  // ============================================================
  app.post('/school/chess-club/play/challenge/:id/respond', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id, cid = req.params.id;
    const action = req.body.action;
    const challenge = (await pool.query(`SELECT * FROM chess_challenges WHERE id=$1 AND tenant_id=$2 AND challenged_id=$3 AND status='pending'`, [cid, tid, uid])).rows[0];
    if (!challenge) return res.redirect('/school/chess-club');
    if (action === 'accept') {
      await pool.query(`UPDATE chess_challenges SET status='accepted', responded_at=NOW() WHERE id=$1`, [cid]);
      // Create the game
      await pool.query(`INSERT INTO chess_games (tenant_id, white_id, black_id, time_control, status) VALUES ($1,$2,$3,$4,'in_progress')`,
        [tid, challenge.challenger_id, uid, challenge.time_control || '15+10']);
      req.session.flash = { type: 'success', msg: 'Challenge accepted! Game created.' };
    } else {
      await pool.query(`UPDATE chess_challenges SET status='declined', responded_at=NOW() WHERE id=$1`, [cid]);
      req.session.flash = { type: 'info', msg: 'Challenge declined.' };
    }
    res.redirect('/school/chess-club');
  }));

  // ============================================================
  // ROUTE 7: GET /school/chess-club/games — Games list
  // ============================================================
  app.get('/school/chess-club/games', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const status = req.query.status || '';
    let where = ['g.tenant_id=$1'], params = [tid], pi = 2;
    if (status) { where.push(`g.status=$${pi++}`); params.push(status); }
    const games = (await pool.query(
      `SELECT g.*, ws.name as white_name, bs.name as black_name FROM chess_games g LEFT JOIN students ws ON ws.id=g.white_id LEFT JOIN students bs ON bs.id=g.black_id WHERE ${where.join(' AND ')} ORDER BY g.created_at DESC LIMIT 50`, params
    )).rows;

    const rowsHtml = games.map(g => `<tr>
      <td>${fmtDate(g.game_date)}</td>
      <td><strong>${esc(g.white_name || '?')}</strong></td>
      <td><strong>${esc(g.black_name || '?')}</strong></td>
      <td style="font-weight:700;color:${g.result==='1-0'?'#16a34a':g.result==='0-1'?'#dc2626':g.result==='1/2-1/2'?'#f59e0b':GRAY}">${esc(g.result || '—')}</td>
      <td>${esc(g.time_control || '—')}</td>
      <td>${statusBadge(g.status)}</td>
      <td>
        ${g.status === 'in_progress' ? `<a href="/school/chess-club/games/${g.id}/record" class="btn" style="font-size:11px;padding:4px 10px">Record</a>` : ''}
        ${g.pgn ? `<a href="/school/chess-club/games/${g.id}" class="btn" style="font-size:11px;padding:4px 10px">View</a>` : ''}
      </td>
    </tr>`).join('');

    const statusOpts = [{ value: '', label: 'All' }, { value: 'in_progress', label: 'In Progress' }, { value: 'finished', label: 'Finished' }, { value: 'pending', label: 'Pending' }];

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">${nav('games')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">♟️ Games</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${games.length} games</p></div>
        <div style="display:flex;gap:8px">
          ${statusOpts.map(s => `<a href="/school/chess-club/games?status=${s.value}" style="padding:6px 14px;border-radius:20px;font-size:12px;text-decoration:none;color:${GRAY};background:#f3f4f6;${status===s.value?'background:'+P+';color:#fff':''}">${s.label}</a>`).join('')}
        </div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table>
        <thead><tr><th>Date</th><th>White</th><th>Black</th><th>Result</th><th>Time</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:${GRAY};padding:30px">No games found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Chess Games', html, user, req));
  }));

  // ============================================================
  // ROUTE 8: GET /school/chess-club/games/:id — View game
  // ============================================================
  app.get('/school/chess-club/games/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, gid = req.params.id;
    const game = (await pool.query(`SELECT g.*, ws.name as white_name, bs.name as black_name, wm.elo_rating as white_elo, bm.elo_rating as black_elo FROM chess_games g LEFT JOIN students ws ON ws.id=g.white_id LEFT JOIN students bs ON bs.id=g.black_id LEFT JOIN chess_members wm ON wm.student_id=g.white_id AND wm.tenant_id=g.tenant_id LEFT JOIN chess_members bm ON bm.student_id=g.black_id AND bm.tenant_id=g.tenant_id WHERE g.id=$1 AND g.tenant_id=$2`, [gid, tid])).rows[0];
    if (!game) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Game not found</h2></div>', req.session.user, req));

    const pgnText = game.pgn || game.moves || 'No PGN available';
    const html = SKIP + `<div style="max-width:800px;margin:0 auto">${nav('games')}
      <a href="/school/chess-club/games" style="color:${GRAY};text-decoration:none;font-size:14px">← Back to Games</a>
      <div class="card" style="padding:24px;margin-top:12px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
          <h2 style="margin:0">♟️ Game Review</h2>
          ${statusBadge(game.status)}
        </div>
        <div style="display:flex;align-items:center;justify-content:center;gap:30px;padding:20px;background:#f9fafb;border-radius:12px;margin-bottom:16px">
          <div style="text-align:center">
            <div style="font-size:16px;font-weight:700">${esc(game.white_name || 'White')}</div>
            <div style="font-size:13px;color:${GRAY}">ELO: ${game.white_elo || '—'}</div>
            ${game.elo_change_white ? `<div style="font-size:12px;color:${game.elo_change_white>0?'#16a34a':'#dc2626'}">${game.elo_change_white>0?'+':''}${game.elo_change_white}</div>` : ''}
          </div>
          <div style="text-align:center">
            <div style="font-size:28px;font-weight:800;color:${game.result==='1-0'?'#16a34a':game.result==='0-1'?'#dc2626':'#f59e0b'}">${esc(game.result || '—')}</div>
            <div style="font-size:11px;color:${GRAY}">${fmtDate(game.game_date)} · ${esc(game.time_control || '')}</div>
          </div>
          <div style="text-align:center">
            <div style="font-size:16px;font-weight:700">${esc(game.black_name || 'Black')}</div>
            <div style="font-size:13px;color:${GRAY}">ELO: ${game.black_elo || '—'}</div>
            ${game.elo_change_black ? `<div style="font-size:12px;color:${game.elo_change_black>0?'#16a34a':'#dc2626'}">${game.elo_change_black>0?'+':''}${game.elo_change_black}</div>` : ''}
          </div>
        </div>
        <div style="margin-top:16px"><h3 style="font-size:14px;margin:0 0 8px">📄 PGN / Moves</h3>
          <pre style="background:#1e293b;color:#e2e8f0;padding:16px;border-radius:10px;font-size:13px;white-space:pre-wrap;overflow-x:auto;font-family:monospace;max-height:400px">${esc(pgnText)}</pre>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Game Review', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 9: GET/POST /school/chess-club/games/:id/record
  // ============================================================
  app.get('/school/chess-club/games/:id/record', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, gid = req.params.id;
    const game = (await pool.query(`SELECT g.*, ws.name as white_name, bs.name as black_name FROM chess_games g LEFT JOIN students ws ON ws.id=g.white_id LEFT JOIN students bs ON bs.id=g.black_id WHERE g.id=$1 AND g.tenant_id=$2`, [gid, tid])).rows[0];
    if (!game || game.status !== 'in_progress') return res.redirect('/school/chess-club/games');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('games')}
      <a href="/school/chess-club/games" style="color:${GRAY};text-decoration:none;font-size:14px">← Back</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 4px">📝 Record Game Result</h2>
        <p style="color:${GRAY};font-size:13px;margin-bottom:20px">${esc(game.white_name)} vs ${esc(game.black_name)} · ${esc(game.time_control)}</p>
        <form method="POST" action="/school/chess-club/games/${gid}/record" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Result *</label>
            <select name="result"><option value="1-0">White Wins (1-0)</option><option value="0-1">Black Wins (0-1)</option><option value="1/2-1/2">Draw (½-½)</option></select>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Moves (algebraic notation)</label>
            <textarea name="moves" rows="6" placeholder="1. e4 e5 2. Nf3 Nc6 3. Bb5 ..."></textarea></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Full PGN (optional)</label>
            <textarea name="pgn" rows="4" placeholder="[Event "Club Game"]&#10;[Date "2024.01.15"]&#10;1. e4 e5 ..."></textarea></div>
          <button type="submit" class="btn" style="padding:12px;background:#16a34a">Submit Result</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Record Game', html, req.session.user, req));
  }));

  app.post('/school/chess-club/games/:id/record', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id, gid = req.params.id;
    const game = (await pool.query(`SELECT * FROM chess_games WHERE id=$1 AND tenant_id=$2 AND status='in_progress'`, [gid, tid])).rows[0];
    if (!game) return res.redirect('/school/chess-club/games');
    const { result, moves, pgn } = req.body;
    if (!result) return res.redirect('/school/chess-club/games/' + gid + '/record');

    // Get ELO ratings
    const whiteMember = (await pool.query(`SELECT elo_rating FROM chess_members WHERE tenant_id=$1 AND student_id=$2`, [tid, game.white_id])).rows[0];
    const blackMember = (await pool.query(`SELECT elo_rating FROM chess_members WHERE tenant_id=$1 AND student_id=$2`, [tid, game.black_id])).rows[0];
    const whiteElo = whiteMember ? whiteMember.elo_rating : 1000;
    const blackElo = blackMember ? blackMember.elo_rating : 1000;
    const scoreWhite = result === '1-0' ? 1 : result === '0-1' ? 0 : 0.5;
    const scoreBlack = 1 - scoreWhite;
    const newWhiteElo = calcElo(whiteElo, blackElo, scoreWhite);
    const newBlackElo = calcElo(blackElo, whiteElo, scoreBlack);
    const eloChangeW = newWhiteElo - whiteElo;
    const eloChangeB = newBlackElo - blackElo;

    await pool.query(`UPDATE chess_games SET result=$1, moves=$2, pgn=$3, status='finished', elo_change_white=$4, elo_change_black=$5 WHERE id=$6 AND tenant_id=$7`,
      [result, moves ? moves.trim() : null, pgn ? pgn.trim() : null, eloChangeW, eloChangeB, gid, tid]);

    // Update member stats
    if (result === '1-0') {
      await pool.query(`UPDATE chess_members SET elo_rating=$1, wins=wins+1, games_played=games_played+1 WHERE tenant_id=$2 AND student_id=$3`, [newWhiteElo, tid, game.white_id]);
      await pool.query(`UPDATE chess_members SET elo_rating=$1, losses=losses+1, games_played=games_played+1 WHERE tenant_id=$2 AND student_id=$3`, [newBlackElo, tid, game.black_id]);
    } else if (result === '0-1') {
      await pool.query(`UPDATE chess_members SET elo_rating=$1, losses=losses+1, games_played=games_played+1 WHERE tenant_id=$2 AND student_id=$3`, [newWhiteElo, tid, game.white_id]);
      await pool.query(`UPDATE chess_members SET elo_rating=$1, wins=wins+1, games_played=games_played+1 WHERE tenant_id=$2 AND student_id=$3`, [newBlackElo, tid, game.black_id]);
    } else {
      await pool.query(`UPDATE chess_members SET elo_rating=$1, draws=draws+1, games_played=games_played+1 WHERE tenant_id=$2 AND student_id=$3`, [newWhiteElo, tid, game.white_id]);
      await pool.query(`UPDATE chess_members SET elo_rating=$1, draws=draws+1, games_played=games_played+1 WHERE tenant_id=$2 AND student_id=$3`, [newBlackElo, tid, game.black_id]);
    }

    await audit(tid, uid, 'game_record', { game_id: parseInt(gid), result });
    req.session.flash = { type: 'success', msg: 'Game result recorded! ELO updated.' };
    res.redirect('/school/chess-club/games');
  }));

  // ============================================================
  // ROUTE 10: GET /school/chess-club/tournaments
  // ============================================================
  app.get('/school/chess-club/tournaments', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const tournaments = (await pool.query(`SELECT * FROM chess_tournaments WHERE tenant_id=$1 ORDER BY start_date DESC NULLS LAST`, [tid])).rows;

    const tournamentHtml = tournaments.map(t => {
      const parts = Array.isArray(t.participants) ? t.participants : [];
      return `<div class="card" style="padding:20px">
        <div style="display:flex;align-items:flex-start;gap:16px">
          <div style="font-size:36px">🏆</div>
          <div style="flex:1">
            <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong style="font-size:16px">${esc(t.name)}</strong>${statusBadge(t.status)}</div>
            <div style="font-size:13px;color:${GRAY};margin-top:6px">${esc(t.format)} · ${fmtDate(t.start_date)}${t.end_date ? ' → ' + fmtDate(t.end_date) : ''} · ${t.rounds||5} rounds</div>
            <div style="font-size:12px;color:${GRAY};margin-top:2px">👥 ${parts.length}/${t.max_players||16} players · Round ${t.current_round||0}/${t.rounds||5}</div>
            ${t.description ? `<div style="font-size:13px;margin-top:8px">${esc(t.description)}</div>` : ''}
            <div style="margin-top:10px;display:flex;gap:8px">
              ${t.status === 'upcoming' ? (parts.includes(user.id) ? '<span style="color:#16a34a;font-weight:600;font-size:13px">✅ Registered</span>' : (parts.length < (t.max_players||16) ? `<form method="POST" action="/school/chess-club/tournaments/${t.id}/join"><button class="btn" style="background:#16a34a;font-size:12px;padding:6px 14px">Register</button></form>` : '<span style="color:#dc2626;font-size:12px">Full</span>')) : ''}
            </div>
          </div>
        </div>
      </div>`;
    }).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">${nav('tournaments')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🏆 Tournaments</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Compete and prove your skills</p></div>
        ${(user.role === 'admin' || user.role === 'teacher') ? `<a href="/school/chess-club/tournaments/create" class="btn" style="background:#16a34a">+ Create Tournament</a>` : ''}
      </div>
      ${tournamentHtml || '<div class="card" style="text-align:center;padding:40px;color:${GRAY}"><p style="font-size:40px;margin-bottom:12px">🏆</p>No tournaments yet</div>'}
    </div>`;
    res.send(renderPage('Chess Tournaments', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: POST tournament join & create
  // ============================================================
  app.post('/school/chess-club/tournaments/:id/join', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id;
    const t = (await pool.query(`SELECT participants, max_players FROM chess_tournaments WHERE id=$1 AND tenant_id=$2 AND status='upcoming'`, [req.params.id, tid])).rows[0];
    if (!t) { req.session.flash = { type: 'error', msg: 'Tournament not found' }; return res.redirect('/school/chess-club/tournaments'); }
    const parts = Array.isArray(t.participants) ? t.participants : [];
    if (parts.includes(uid)) return res.redirect('/school/chess-club/tournaments');
    parts.push(uid);
    await pool.query(`UPDATE chess_tournaments SET participants=$1 WHERE id=$2 AND tenant_id=$3`, [JSON.stringify(parts), req.params.id, tid]);
    req.session.flash = { type: 'success', msg: 'Registered for tournament!' };
    res.redirect('/school/chess-club/tournaments');
  }));

  app.get('/school/chess-club/tournaments/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/chess-club/tournaments');
    const formats = [{ value: 'swiss', label: 'Swiss System' }, { value: 'round-robin', label: 'Round Robin' }, { value: 'elimination', label: 'Single Elimination' }, { value: 'double-elimination', label: 'Double Elimination' }];
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('tournaments')}
      <a href="/school/chess-club/tournaments" style="color:${GRAY};text-decoration:none;font-size:14px">← Back</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 20px">🏆 Create Tournament</h2>
        <form method="POST" action="/school/chess-club/tournaments/create" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Tournament Name *</label><input type="text" name="name" required placeholder="e.g., Spring Chess Championship"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Format</label><select name="format">${formats.map(f => `<option value="${f.value}">${f.label}</option>`).join('')}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Max Players</label><input type="number" name="max_players" value="16" min="4"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Start Date *</label><input type="date" name="start_date" required></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">End Date</label><input type="date" name="end_date"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Rounds</label><input type="number" name="rounds" value="5" min="1"></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="Tournament details and rules..."></textarea></div>
          <button type="submit" class="btn" style="background:#16a34a;padding:12px">Create Tournament</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Tournament', html, user, req));
  }));

  app.post('/school/chess-club/tournaments/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/chess-club/tournaments');
    const { name, format, start_date, end_date, max_players, rounds, description } = req.body;
    if (!name?.trim() || !start_date) return res.redirect('/school/chess-club/tournaments/create');
    await pool.query(`INSERT INTO chess_tournaments (tenant_id, name, format, start_date, end_date, max_players, rounds, description) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, name.trim(), format || 'swiss', start_date, end_date || null, max_players ? parseInt(max_players) : 16, rounds ? parseInt(rounds) : 5, description ? description.trim() : null]);
    await audit(tid, user.id, 'tournament_create', { name: name.trim() });
    req.session.flash = { type: 'success', msg: 'Tournament created!' };
    res.redirect('/school/chess-club/tournaments');
  }));

  // ============================================================
  // ROUTE 12: GET /school/chess-club/puzzles — Puzzles
  // ============================================================
  app.get('/school/chess-club/puzzles', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const difficulty = req.query.difficulty || '';
    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (difficulty) { where.push(`difficulty=$${pi++}`); params.push(difficulty); }
    const puzzles = (await pool.query(`SELECT * FROM chess_puzzles WHERE ${where.join(' AND ')} ORDER BY created_at DESC LIMIT 30`, params)).rows;
    const myAttempts = (await pool.query(`SELECT puzzle_id, correct FROM chess_puzzle_attempts WHERE tenant_id=$1 AND student_id=$2`, [tid, user.id])).rows;

    const puzzlesHtml = puzzles.map(p => {
      const attempt = myAttempts.find(a => a.puzzle_id === p.id);
      return `<div class="card" style="padding:16px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px;flex-wrap:wrap">
          <strong style="font-size:14px">🧩 Puzzle #${p.id}</strong>
          ${diffBadge2(p.difficulty)}
          ${p.theme ? `<span style="font-size:11px;color:${GRAY}">[${esc(p.theme)}]</span>` : ''}
          ${attempt ? (attempt.correct ? '<span style="color:#16a34a;font-size:12px;font-weight:600">✅ Solved</span>' : '<span style="color:#dc2626;font-size:12px;font-weight:600">❌ Attempted</span>') : ''}
        </div>
        <div style="font-size:12px;color:${GRAY};margin-bottom:8px">${esc(p.description || 'Find the best move')}</div>
        <pre style="background:#1e293b;color:#e2e8f0;padding:10px;border-radius:8px;font-size:12px;font-family:monospace;overflow-x:auto">${esc(p.fen)}</pre>
        <form method="POST" action="/school/chess-club/puzzles/${p.id}/attempt" style="margin-top:10px;display:flex;gap:8px">
          <input type="text" name="attempt" placeholder="Your answer (e.g., Qh7#)" style="flex:1">
          <button type="submit" class="btn" style="font-size:12px;padding:6px 14px" ${attempt && attempt.correct ? 'disabled' : ''}>Check</button>
        </form>
      </div>`;
    }).join('');

    const diffBadge2 = d => {
      const m = { easy: { bg: '#dcfce7', c: '#16a34a' }, medium: { bg: '#fef9c3', c: '#ca8a04' }, hard: { bg: '#fee2e2', c: '#dc2626' } };
      const v = m[d] || { bg: '#f3f4f6', c: GRAY };
      return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${v.bg};color:${v.c}">${esc(d || 'medium')}</span>`;
    };

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">${nav('puzzles')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">🧩 Chess Puzzles</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">${puzzles.length} puzzles · Test your tactical vision</p></div>
        <div style="display:flex;gap:8px">
          ${['', 'easy', 'medium', 'hard'].map(d => `<a href="/school/chess-club/puzzles?difficulty=${d}" style="padding:6px 14px;border-radius:20px;font-size:12px;text-decoration:none;color:${GRAY};background:#f3f4f6;${difficulty===d?'background:'+P+';color:#fff':''}">${d ? d.charAt(0).toUpperCase() + d.slice(1) : 'All'}</a>`).join('')}
        </div>
      </div>
      ${puzzlesHtml || '<div class="card" style="text-align:center;padding:40px;color:${GRAY}"><p style="font-size:40px;margin-bottom:12px">🧩</p>No puzzles available yet</div>'}
    </div>`;
    res.send(renderPage('Chess Puzzles', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: POST puzzle attempt
  // ============================================================
  app.post('/school/chess-club/puzzles/:id/attempt', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, uid = req.session.user.id, pid = req.params.id;
    const puzzle = (await pool.query(`SELECT id, solution FROM chess_puzzles WHERE id=$1 AND tenant_id=$2`, [pid, tid])).rows[0];
    if (!puzzle) return res.redirect('/school/chess-club/puzzles');
    const attempt = (req.body.attempt || '').trim();
    const correct = attempt.toLowerCase() === puzzle.solution.toLowerCase().trim();
    await pool.query(`INSERT INTO chess_puzzle_attempts (tenant_id, puzzle_id, student_id, correct, attempt) VALUES ($1,$2,$3,$4,$5)`,
      [tid, pid, uid, correct, attempt]);
    await audit(tid, uid, 'puzzle_attempt', { puzzle_id: parseInt(pid), correct });
    req.session.flash = { type: correct ? 'success' : 'error', msg: correct ? '✅ Correct!' : `❌ Wrong. Solution: ${puzzle.solution}` };
    res.redirect('/school/chess-club/puzzles');
  }));

  // ============================================================
  // ROUTE 14: GET /school/chess-club/leaderboard
  // ============================================================
  app.get('/school/chess-club/leaderboard', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const members = (await pool.query(`SELECT cm.*, s.name as student_name FROM chess_members cm LEFT JOIN students s ON s.id=cm.student_id WHERE cm.tenant_id=$1 AND cm.games_played > 0 ORDER BY cm.elo_rating DESC`, [tid])).rows;

    const getWinRate = m => m.games_played > 0 ? ((m.wins || 0) / m.games_played * 100).toFixed(1) : '0.0';
    const medal = i => i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : '';

    const rowsHtml = members.map((m, i) => `<tr style="${i < 3 ? 'background:#fffbeb' : ''}">
      <td style="text-align:center;font-size:18px">${medal(i) || (i + 1)}</td>
      <td><strong style="font-size:14px">${esc(m.student_name || 'Unknown')}</strong></td>
      <td><span style="font-size:18px;font-weight:800;color:${eloColor(m.elo_rating)}">${m.elo_rating}</span><div style="font-size:10px;color:${GRAY}">${eloTitle(m.elo_rating)}</div></td>
      <td style="text-align:center"><span style="color:#16a34a;font-weight:700">${m.wins||0}</span></td>
      <td style="text-align:center"><span style="color:#dc2626;font-weight:700">${m.losses||0}</span></td>
      <td style="text-align:center"><span style="color:#f59e0b;font-weight:700">${m.draws||0}</span></td>
      <td style="text-align:center">${m.games_played||0}</td>
      <td style="text-align:center;font-weight:600;color:${P}">${getWinRate(m)}%</td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1000px;margin:0 auto">${nav('leaderboard')}
      <div><h1 style="font-size:24px;margin:0">📊 Leaderboard</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Ranked by ELO rating</p></div>
      <div class="card" style="margin-top:20px"><div style="overflow-x:auto"><table>
        <thead><tr><th style="text-align:center">#</th><th>Player</th><th>ELO</th><th style="text-align:center">Wins</th><th style="text-align:center">Losses</th><th style="text-align:center">Draws</th><th style="text-align:center">Games</th><th style="text-align:center">Win Rate</th></tr></thead>
        <tbody>${rowsHtml || '<tr><td colspan="8" style="text-align:center;color:${GRAY};padding:30px">No ranked players yet. Play some games!</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Leaderboard', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 15: GET /school/chess-club/teaching-resources
  // ============================================================
  app.get('/school/chess-club/teaching-resources', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const resources = (await pool.query(`SELECT * FROM chess_teaching WHERE tenant_id=$1 ORDER BY order_num, created_at`, [tid])).rows;

    const resourcesHtml = resources.map(r => `<div class="card" style="padding:16px;display:flex;gap:14px">
      <div style="width:48px;height:48px;border-radius:10px;background:${r.difficulty==='beginner'?'#dcfce7':r.difficulty==='intermediate'?'#fef9c3':'#fee2e2'};display:flex;align-items:center;justify-content:center;font-size:22px;flex-shrink:0">📚</div>
      <div style="flex:1">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap"><strong style="font-size:15px">${esc(r.title)}</strong>${r.difficulty ? `<span style="font-size:10px;padding:2px 8px;border-radius:10px;background:#f3f4f6;color:${GRAY}">${esc(r.difficulty)}</span>` : ''}</div>
        ${r.category ? `<div style="font-size:11px;color:${GRAY};margin-top:2px">${esc(r.category)}</div>` : ''}
        <div style="font-size:13px;margin-top:6px;line-height:1.5;color:#374151">${esc((r.content || '').substring(0, 200))}${(r.content || '').length > 200 ? '...' : ''}</div>
      </div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">${nav('teaching')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;margin:0">📚 Teaching Resources</h1><p style="color:${GRAY};font-size:13px;margin:4px 0 0">Learn and improve your chess skills</p></div>
        ${(user.role === 'admin' || user.role === 'teacher') ? `<a href="/school/chess-club/teaching-resources/add" class="btn" style="background:#16a34a">+ Add Resource</a>` : ''}
      </div>
      ${resourcesHtml || '<div class="card" style="text-align:center;padding:40px;color:${GRAY}"><p style="font-size:40px;margin-bottom:12px">📚</p>No teaching resources yet</div>'}
    </div>`;
    res.send(renderPage('Teaching Resources', html, user, req));
  }));

  // ============================================================
  // ROUTE 16: GET/POST teaching resources add
  // ============================================================
  app.get('/school/chess-club/teaching-resources/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/chess-club/teaching-resources');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">${nav('teaching')}
      <a href="/school/chess-club/teaching-resources" style="color:${GRAY};text-decoration:none;font-size:14px">← Back</a>
      <div class="card" style="padding:28px;margin-top:12px">
        <h2 style="margin:0 0 20px">➕ Add Teaching Resource</h2>
        <form method="POST" action="/school/chess-club/teaching-resources/add" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Title *</label><input type="text" name="title" required placeholder="e.g., Fundamentals of Opening Play"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Category</label><input type="text" name="category" placeholder="e.g., Openings"></div>
            <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Difficulty</label><select name="difficulty"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option></select></div>
          </div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Content *</label><textarea name="content" rows="8" required placeholder="Teaching content, explanations, examples..."></textarea></div>
          <div><label style="font-size:13px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Order</label><input type="number" name="order_num" value="0" min="0"></div>
          <button type="submit" class="btn" style="background:#16a34a;padding:12px">Add Resource</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Add Resource', html, user, req));
  }));

  app.post('/school/chess-club/teaching-resources/add', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    if (user.role !== 'admin' && user.role !== 'teacher') return res.redirect('/school/chess-club/teaching-resources');
    const { title, category, difficulty, content, order_num } = req.body;
    if (!title?.trim() || !content?.trim()) return res.redirect('/school/chess-club/teaching-resources/add');
    await pool.query(`INSERT INTO chess_teaching (tenant_id, title, category, difficulty, content, order_num) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, title.trim(), category ? category.trim() : null, difficulty || 'beginner', content.trim(), order_num ? parseInt(order_num) : 0]);
    req.session.flash = { type: 'success', msg: 'Resource added!' };
    res.redirect('/school/chess-club/teaching-resources');
  }));
};
