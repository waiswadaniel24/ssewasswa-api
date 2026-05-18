/**
 * Campus Podcast System
 * School SaaS Portal Module — Student/Teacher Audio Content Management
 *
 * Routes (prefix /school/podcast/):
 *   Dashboard, Channels CRUD, Episodes CRUD, RSS Feed, Audio Player,
 *   Scheduler, Student Submissions, Analytics, Comments, Search, Subscriptions
 *
 * Tables:
 *   podcast_channels, podcast_episodes, podcast_listens,
 *   podcast_comments, podcast_subscriptions, podcast_student_submissions
 */

module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  const PFX = '/school/podcast';

  // ─── helpers ──────────────────────────────────────────────────────────
  const uid = (r) => (r.session && r.session.user ? r.session.user.id : 0);
  const tid = (r) => (r.session && r.session.user ? r.session.user.tenant_id : 0);
  const role = (r) => (r.session && r.session.user ? r.session.user.role : 'student');
  const isTeacher = (r) => role(r) === 'teacher' || role(r) === 'admin';
  const now = () => new Date().toISOString().slice(0, 19).replace('T', ' ');
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US', { year:'numeric', month:'short', day:'numeric' }) : '';
  const fmtDuration = (sec) => {
    if (!sec || sec <= 0) return '0:00';
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    return h > 0 ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}` : `${m}:${String(s).padStart(2,'0')}`;
  };
  const xmlEsc = (s) => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');
  const slugify = (s) => String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');

  // ─── DB schema auto-creation ──────────────────────────────────────────
  async function ensureTables() {
    const tables = [
      `CREATE TABLE IF NOT EXISTS podcast_channels (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        name VARCHAR(200) NOT NULL,
        slug VARCHAR(220),
        description TEXT,
        cover_url VARCHAR(500),
        category VARCHAR(100) DEFAULT 'general',
        author_name VARCHAR(150),
        owner_id INT,
        is_public TINYINT(1) DEFAULT 1,
        sort_order INT DEFAULT 0,
        episode_count INT DEFAULT 0,
        total_plays INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_slug (tenant_id, slug)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS podcast_episodes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        channel_id INT NOT NULL,
        title VARCHAR(300) NOT NULL,
        slug VARCHAR(320),
        description TEXT,
        show_notes LONGTEXT,
        audio_url VARCHAR(500),
        audio_size BIGINT DEFAULT 0,
        duration_sec INT DEFAULT 0,
        episode_number INT,
        season_number INT,
        tags VARCHAR(500),
        category VARCHAR(100),
        status ENUM('draft','scheduled','published','archived') DEFAULT 'draft',
        scheduled_at DATETIME,
        published_at DATETIME,
        explicit TINYINT(1) DEFAULT 0,
        chapter_data TEXT,
        waveform_data TEXT,
        play_count INT DEFAULT 0,
        complete_count INT DEFAULT 0,
        avg_listen_pct DECIMAL(5,2) DEFAULT 0,
        rating_avg DECIMAL(3,2) DEFAULT 0,
        rating_count INT DEFAULT 0,
        featured TINYINT(1) DEFAULT 0,
        created_by INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_channel (tenant_id, channel_id),
        INDEX idx_status (tenant_id, status),
        INDEX idx_published (tenant_id, published_at),
        FULLTEXT idx_search (title, description, show_notes, tags)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS podcast_listens (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        episode_id INT NOT NULL,
        user_id INT NOT NULL,
        listened_sec INT DEFAULT 0,
        completed TINYINT(1) DEFAULT 0,
        pct_completed DECIMAL(5,2) DEFAULT 0,
        ip_address VARCHAR(45),
        user_agent VARCHAR(500),
        listened_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_episode (tenant_id, episode_id),
        INDEX idx_user (tenant_id, user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS podcast_comments (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        episode_id INT NOT NULL,
        user_id INT NOT NULL,
        user_name VARCHAR(150),
        user_role VARCHAR(50),
        comment_text TEXT NOT NULL,
        rating TINYINT DEFAULT 0,
        is_featured TINYINT(1) DEFAULT 0,
        is_approved TINYINT(1) DEFAULT 1,
        parent_id INT DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_episode (tenant_id, episode_id),
        INDEX idx_user (tenant_id, user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS podcast_subscriptions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        user_id INT NOT NULL,
        channel_id INT NOT NULL,
        notification_enabled TINYINT(1) DEFAULT 1,
        subscribed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uk_user_channel (tenant_id, user_id, channel_id),
        INDEX idx_tenant (tenant_id),
        INDEX idx_user (tenant_id, user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`,

      `CREATE TABLE IF NOT EXISTS podcast_student_submissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tenant_id INT NOT NULL,
        student_id INT NOT NULL,
        student_name VARCHAR(150),
        channel_id INT,
        title VARCHAR(300),
        description TEXT,
        audio_url VARCHAR(500),
        duration_sec INT DEFAULT 0,
        status ENUM('pending','approved','rejected','revision') DEFAULT 'pending',
        teacher_notes TEXT,
        reviewed_by INT,
        reviewed_at DATETIME,
        host_profile TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        INDEX idx_tenant (tenant_id),
        INDEX idx_student (tenant_id, student_id),
        INDEX idx_status (tenant_id, status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;`
    ];
    for (const sql of tables) {
      try { await pool.query(sql); } catch(e) { /* table may already exist */ }
    }
  }

  // ─── scheduler: auto-publish scheduled episodes ───────────────────────
  async function publishScheduled() {
    try {
      const [rows] = await pool.query(
        `UPDATE podcast_episodes SET status='published', published_at=NOW()
         WHERE status='scheduled' AND scheduled_at <= NOW() AND tenant_id IN (SELECT DISTINCT tenant_id FROM podcast_episodes)`
      );
    } catch(e) { /* silent */ }
  }
  setInterval(publishScheduled, 60000);

  // ─── UI theme CSS ─────────────────────────────────────────────────────
  const THEME_CSS = `
  .pod-theme{--pod-bg:#0f0f1a;--pod-surface:#1a1a2e;--pod-surface2:#25253e;--pod-primary:#7c3aed;--pod-primary-light:#a78bfa;
    --pod-accent:#06d6a0;--pod-text:#e2e8f0;--pod-text-dim:#94a3b8;--pod-border:#334155;--pod-danger:#ef4444;--pod-warn:#f59e0b;--pod-radius:12px;font-family:'Inter',system-ui,sans-serif;color:var(--pod-text)}
  .pod-theme *,.pod-theme *::before,.pod-theme *::after{box-sizing:border-box}
  .pod-container{max-width:1200px;margin:0 auto;padding:20px}
  .pod-grid{display:grid;gap:20px}
  .pod-grid-2{grid-template-columns:repeat(auto-fill,minmax(320px,1fr))}
  .pod-grid-3{grid-template-columns:repeat(auto-fill,minmax(280px,1fr))}
  .pod-grid-4{grid-template-columns:repeat(auto-fill,minmax(240px,1fr))}
  .pod-card{background:var(--pod-surface);border:1px solid var(--pod-border);border-radius:var(--pod-radius);overflow:hidden;transition:transform .2s,box-shadow .2s}
  .pod-card:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(0,0,0,.3)}
  .pod-card-img{position:relative;width:100%;aspect-ratio:16/9;background:linear-gradient(135deg,#1a1a2e,#7c3aed);overflow:hidden}
  .pod-card-img img{width:100%;height:100%;object-fit:cover}
  .pod-play-overlay{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.4);opacity:0;transition:opacity .2s}
  .pod-card:hover .pod-play-overlay{opacity:1}
  .pod-play-btn{width:56px;height:56px;border-radius:50%;background:var(--pod-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:22px;border:none;cursor:pointer;box-shadow:0 4px 15px rgba(124,58,237,.4);transition:transform .15s}
  .pod-play-btn:hover{transform:scale(1.1)}
  .pod-card-body{padding:16px}
  .pod-card-title{font-size:1rem;font-weight:600;margin:0 0 6px;color:var(--pod-text);line-height:1.4}
  .pod-card-meta{font-size:.8rem;color:var(--pod-text-dim);margin-bottom:8px}
  .pod-badge{display:inline-block;padding:2px 8px;border-radius:20px;font-size:.7rem;font-weight:600}
  .pod-badge-pub{background:rgba(6,214,160,.15);color:#06d6a0}
  .pod-badge-draft{background:rgba(245,158,11,.15);color:#f59e0b}
  .pod-badge-sched{background:rgba(124,58,237,.15);color:#a78bfa}
  .pod-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 18px;border-radius:8px;border:none;font-size:.85rem;font-weight:600;cursor:pointer;transition:all .15s;text-decoration:none}
  .pod-btn-primary{background:var(--pod-primary);color:#fff}
  .pod-btn-primary:hover{background:#6d28d9}
  .pod-btn-secondary{background:var(--pod-surface2);color:var(--pod-text);border:1px solid var(--pod-border)}
  .pod-btn-secondary:hover{background:var(--pod-border)}
  .pod-btn-accent{background:var(--pod-accent);color:#0f0f1a}
  .pod-btn-sm{padding:5px 12px;font-size:.75rem}
  .pod-btn-danger{background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3)}
  .pod-input,.pod-select,.pod-textarea{width:100%;padding:10px 14px;background:var(--pod-surface2);border:1px solid var(--pod-border);border-radius:8px;color:var(--pod-text);font-size:.9rem;outline:none;transition:border-color .2s}
  .pod-input:focus,.pod-select:focus,.pod-textarea:focus{border-color:var(--pod-primary)}
  .pod-textarea{min-height:100px;resize:vertical;font-family:inherit}
  .pod-label{display:block;font-size:.8rem;font-weight:600;color:var(--pod-text-dim);margin-bottom:4px}
  .pod-form-group{margin-bottom:16px}
  .pod-header{display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;margin-bottom:24px}
  .pod-header h1{font-size:1.6rem;font-weight:700;margin:0;background:linear-gradient(135deg,#7c3aed,#06d6a0);-webkit-background-clip:text;-webkit-text-fill-color:transparent}
  .pod-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:16px;margin-bottom:28px}
  .pod-stat-card{background:var(--pod-surface);border:1px solid var(--pod-border);border-radius:var(--pod-radius);padding:18px;text-align:center}
  .pod-stat-num{font-size:1.8rem;font-weight:800;color:var(--pod-primary)}
  .pod-stat-label{font-size:.78rem;color:var(--pod-text-dim);margin-top:4px}
  .pod-player-bar{position:fixed;bottom:0;left:0;right:0;background:var(--pod-surface);border-top:1px solid var(--pod-border);padding:12px 24px;display:flex;align-items:center;gap:16px;z-index:1000}
  .pod-player-info{flex:0 0 260px;display:flex;align-items:center;gap:10px}
  .pod-player-controls{flex:1;display:flex;flex-direction:column;align-items:center;gap:6px}
  .pod-player-btns{display:flex;align-items:center;gap:12px}
  .pod-player-ctrl{background:none;border:none;color:var(--pod-text);font-size:18px;cursor:pointer;padding:4px}
  .pod-player-ctrl:hover{color:var(--pod-primary)}
  .pod-progress-wrap{width:100%;max-width:600px;display:flex;align-items:center;gap:8px}
  .pod-progress-bar{flex:1;height:5px;background:var(--pod-surface2);border-radius:3px;cursor:pointer;position:relative}
  .pod-progress-fill{height:100%;background:linear-gradient(90deg,var(--pod-primary),var(--pod-accent));border-radius:3px;transition:width .1s}
  .pod-time{font-size:.72rem;color:var(--pod-text-dim);min-width:40px}
  .pod-speed-btn{background:var(--pod-surface2);border:1px solid var(--pod-border);color:var(--pod-accent);padding:3px 8px;border-radius:4px;font-size:.72rem;font-weight:700;cursor:pointer}
  .pod-waveform{display:flex;align-items:end;gap:1px;height:40px;padding:0 4px}
  .pod-waveform-bar{width:3px;border-radius:2px;background:var(--pod-primary);opacity:.5;transition:opacity .2s}
  .pod-waveform-bar.played{opacity:1;background:var(--pod-accent)}
  .pod-tabs{display:flex;gap:4px;margin-bottom:20px;border-bottom:1px solid var(--pod-border);padding-bottom:0}
  .pod-tab{padding:10px 18px;border:none;background:none;color:var(--pod-text-dim);font-size:.85rem;font-weight:600;cursor:pointer;border-bottom:2px solid transparent;transition:all .2s}
  .pod-tab:hover{color:var(--pod-text)}
  .pod-tab.active{color:var(--pod-primary);border-bottom-color:var(--pod-primary)}
  .pod-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:20px;font-size:.75rem;background:var(--pod-surface2);border:1px solid var(--pod-border);color:var(--pod-text-dim)}
  .pod-stars{color:var(--pod-warn);font-size:.85rem}
  .pod-empty{text-align:center;padding:60px 20px;color:var(--pod-text-dim)}
  .pod-empty svg{width:64px;height:64px;margin-bottom:12px;opacity:.4}
  .pod-search-wrap{position:relative;max-width:420px}
  .pod-search-input{width:100%;padding:10px 14px 10px 38px;background:var(--pod-surface2);border:1px solid var(--pod-border);border-radius:24px;color:var(--pod-text);font-size:.88rem;outline:none}
  .pod-search-input:focus{border-color:var(--pod-primary)}
  .pod-search-icon{position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--pod-text-dim)}
  .pod-modal-overlay{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:2000;display:flex;align-items:center;justify-content:center;padding:20px}
  .pod-modal{background:var(--pod-surface);border:1px solid var(--pod-border);border-radius:var(--pod-radius);max-width:560px;width:100%;max-height:80vh;overflow-y:auto;padding:24px}
  .pod-modal h2{margin:0 0 16px;font-size:1.2rem}
  .pod-divider{border:none;border-top:1px solid var(--pod-border);margin:16px 0}
  .pod-avatar{width:32px;height:32px;border-radius:50%;background:var(--pod-primary);color:#fff;display:flex;align-items:center;justify-content:center;font-size:.75rem;font-weight:700}
  .pod-comment{display:flex;gap:12px;padding:14px 0;border-bottom:1px solid var(--pod-border)}
  .pod-chapter-item{display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:6px;cursor:pointer;transition:background .15s}
  .pod-chapter-item:hover{background:var(--pod-surface2)}
  .pod-sidebar{width:280px;flex-shrink:0}
  .pod-main{flex:1;min-width:0}
  .pod-layout{display:flex;gap:24px}
  @media(max-width:768px){.pod-layout{flex-direction:column}.pod-sidebar{width:100%}.pod-grid-2,.pod-grid-3,.pod-grid-4{grid-template-columns:1fr}.pod-player-bar{flex-wrap:wrap}.pod-player-info{flex:1 1 100%}}
  .pod-table{width:100%;border-collapse:collapse}
  .pod-table th,.pod-table td{padding:10px 14px;text-align:left;border-bottom:1px solid var(--pod-border);font-size:.85rem}
  .pod-table th{font-weight:600;color:var(--pod-text-dim);font-size:.75rem;text-transform:uppercase;letter-spacing:.5px}
  .pod-table tr:hover td{background:var(--pod-surface2)}
  .pod-retention-bar{display:flex;gap:2px;height:20px;border-radius:4px;overflow:hidden}
  .pod-retention-seg{flex:1;transition:opacity .15s}
  .pod-filter-bar{display:flex;flex-wrap:wrap;gap:10px;margin-bottom:20px;align-items:center}
  `;

  function pageWrap(title, body, extraHead = '') {
    return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Campus Podcast</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>${THEME_CSS}</style>
${extraHead}
</head><body class="pod-theme" style="background:var(--pod-bg);padding-bottom:80px">
<div class="pod-container">${body}</div>
<script>
const POD={};
POD.play=(url,epId,title,dur)=>{
  const bar=document.getElementById('pod-player-bar');if(!bar)return;
  bar.style.display='flex';
  document.getElementById('pod-player-title').textContent=title;
  const audio=document.getElementById('pod-audio-hidden');
  audio.src=url;audio.play();
  POD.currentEp=epId;POD.currentDur=dur||0;
};
POD.seek=(sec)=>{const a=document.getElementById('pod-audio-hidden');if(a)a.currentTime+=sec;};
POD.setSpeed=(s)=>{const a=document.getElementById('pod-audio-hidden');if(a)a.playbackRate=s;
  document.querySelectorAll('.pod-speed-btn').forEach(b=>{b.style.background=b.dataset.speed==s?'var(--pod-primary)':'var(--pod-surface2)';b.style.color=b.dataset.speed==s?'#fff':'var(--pod-accent)';});};
POD.trackProgress=()=>{
  const a=document.getElementById('pod-audio-hidden');if(!a)return;
  const pct=(a.currentTime/a.duration*100)||0;
  const fill=document.getElementById('pod-progress-fill');
  const timeEl=document.getElementById('pod-time-current');
  if(fill)fill.style.width=pct+'%';
  if(timeEl)timeEl.textContent=POD.fmtT(a.currentTime);
  requestAnimationFrame(POD.trackProgress);
};
POD.fmtT=(s)=>{if(isNaN(s))return'0:00';const m=Math.floor(s/60),ss=Math.floor(s%60);return m+':'+String(ss).padStart(2,'0');};
POD.skipTo=(sec)=>{const a=document.getElementById('pod-audio-hidden');if(a)a.currentTime=sec;};
document.addEventListener('DOMContentLoaded',()=>{
  const a=document.getElementById('pod-audio-hidden');
  if(a){a.addEventListener('timeupdate',POD.trackProgress);
    a.addEventListener('ended',()=>{if(POD.currentEp){fetch('/school/podcast/api/listen/complete',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({episode_id:POD.currentEp})}).catch(()=>{});}});
    a.addEventListener('play',()=>{if(POD.currentEp){fetch('/school/podcast/api/listen/start',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({episode_id:POD.currentEp})}).catch(()=>{});}});
  }
});
</script>
<audio id="pod-audio-hidden" preload="auto"></audio>
<div id="pod-player-bar" class="pod-player-bar" style="display:none">
  <div class="pod-player-info">
    <div class="pod-avatar">🎧</div>
    <div style="min-width:0"><div id="pod-player-title" style="font-size:.88rem;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">—</div></div>
  </div>
  <div class="pod-player-controls">
    <div class="pod-player-btns">
      <button class="pod-player-ctrl" onclick="POD.seek(-15)" title="Back 15s">⏪</button>
      <button class="pod-player-ctrl" id="pod-play-toggle" onclick="const a=document.getElementById('pod-audio-hidden');a.paused?a.play():a.pause()" title="Play/Pause">▶️</button>
      <button class="pod-player-ctrl" onclick="POD.seek(15)" title="Forward 15s">⏩</button>
    </div>
    <div class="pod-progress-wrap">
      <span class="pod-time" id="pod-time-current">0:00</span>
      <div class="pod-progress-bar" onclick="const a=document.getElementById('pod-audio-hidden');const r=this.getBoundingClientRect();a.currentTime=(event.clientX-r.left)/r.width*a.duration">
        <div class="pod-progress-fill" id="pod-progress-fill" style="width:0%"></div>
      </div>
      <span class="pod-time" id="pod-time-total">0:00</span>
    </div>
  </div>
  <div style="display:flex;gap:4px;flex-shrink:0">
    <button class="pod-speed-btn" data-speed="0.5" onclick="POD.setSpeed(0.5)">0.5x</button>
    <button class="pod-speed-btn" data-speed="1" onclick="POD.setSpeed(1)" style="background:var(--pod-primary);color:#fff">1x</button>
    <button class="pod-speed-btn" data-speed="1.5" onclick="POD.setSpeed(1.5)">1.5x</button>
    <button class="pod-speed-btn" data-speed="2" onclick="POD.setSpeed(2)">2x</button>
  </div>
</div>
</body></html>`;
  }

  // ─── 1. DASHBOARD ─────────────────────────────────────────────────────
  app.get(PFX + '/', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const [[{ channels, episodes, total_plays, subscribers }]] = await pool.query(
      `SELECT
        (SELECT COUNT(*) FROM podcast_channels WHERE tenant_id=?) AS channels,
        (SELECT COUNT(*) FROM podcast_episodes WHERE tenant_id=? AND status='published') AS episodes,
        (SELECT COALESCE(SUM(play_count),0) FROM podcast_episodes WHERE tenant_id=?) AS total_plays,
        (SELECT COUNT(DISTINCT user_id) FROM podcast_subscriptions WHERE tenant_id=?) AS subscribers`,
      [t, t, t, t]
    );
    const [recentEps] = await pool.query(
      `SELECT e.*, c.name AS channel_name, c.cover_url AS channel_cover
       FROM podcast_episodes e JOIN podcast_channels c ON c.id=e.channel_id
       WHERE e.tenant_id=? AND e.status='published' ORDER BY e.published_at DESC LIMIT 8`,
      [t]
    );
    const [topEps] = await pool.query(
      `SELECT e.*, c.name AS channel_name
       FROM podcast_episodes e JOIN podcast_channels c ON c.id=e.channel_id
       WHERE e.tenant_id=? AND e.status='published' ORDER BY e.play_count DESC LIMIT 5`,
      [t]
    );
    const [recentComments] = await pool.query(
      `SELECT pc.*, e.title AS episode_title FROM podcast_comments pc
       JOIN podcast_episodes e ON e.id=pc.episode_id
       WHERE pc.tenant_id=? AND pc.is_approved=1 ORDER BY pc.created_at DESC LIMIT 5`,
      [t]
    );
    let epCards = '';
    for (const ep of recentEps) {
      epCards += `<div class="pod-card">
        <div class="pod-card-img" style="background:linear-gradient(135deg,${ep.channel_cover?'url('+esc(ep.channel_cover)+') center/cover':'#1a1a2e,#7c3aed'})">
          <div class="pod-play-overlay"><button class="pod-play-btn" onclick="POD.play('${esc(ep.audio_url)}',${ep.id},'${esc(ep.title)}',${ep.duration_sec})">▶</button></div>
        </div>
        <div class="pod-card-body">
          <div class="pod-card-title">${esc(ep.title)}</div>
          <div class="pod-card-meta">${esc(ep.channel_name)} · ${fmtDate(ep.published_at)} · ${fmtDuration(ep.duration_sec)}</div>
        </div></div>`;
    }
    let topRows = '';
    for (const ep of topEps) {
      topRows += `<tr><td><strong>${esc(ep.title)}</strong></td><td>${esc(ep.channel_name)}</td><td>${Number(ep.play_count).toLocaleString()}</td>
        <td><span class="pod-stars">${'★'.repeat(Math.round(ep.rating_avg||0))}${'☆'.repeat(5-Math.round(ep.rating_avg||0))}</span> ${ep.rating_avg||0}</td></tr>`;
    }
    const body = `
    <div class="pod-header"><h1>🎙️ Campus Podcast</h1>
      <div class="pod-search-wrap"><span class="pod-search-icon">🔍</span><input class="pod-search-input" placeholder="Search episodes..." onclick="location.href='/school/podcast/search'"></div>
    </div>
    <div class="pod-stats">
      <div class="pod-stat-card"><div class="pod-stat-num">${channels}</div><div class="pod-stat-label">Channels</div></div>
      <div class="pod-stat-card"><div class="pod-stat-num">${episodes}</div><div class="pod-stat-label">Episodes</div></div>
      <div class="pod-stat-card"><div class="pod-stat-num">${Number(total_plays).toLocaleString()}</div><div class="pod-stat-label">Total Plays</div></div>
      <div class="pod-stat-card"><div class="pod-stat-num">${subscribers}</div><div class="pod-stat-label">Subscribers</div></div>
    </div>
    <h2 style="font-size:1.15rem;margin-bottom:14px">🎤 Recent Episodes</h2>
    <div class="pod-grid pod-grid-4" style="margin-bottom:32px">${epCards || '<div class="pod-empty">No episodes yet. Create your first channel!</div>'}</div>
    <div class="pod-layout">
      <div class="pod-main">
        <h2 style="font-size:1.15rem;margin-bottom:14px">🔥 Top Episodes</h2>
        <div class="pod-card"><table class="pod-table"><thead><tr><th>Title</th><th>Channel</th><th>Plays</th><th>Rating</th></tr></thead><tbody>${topRows||'<tr><td colspan="4" style="text-align:center;color:var(--pod-text-dim)">No data</td></tr>'}</tbody></table></div>
      </div>
      <div class="pod-sidebar">
        <h2 style="font-size:1.15rem;margin-bottom:14px">💬 Recent Comments</h2>
        ${recentComments.map(c => `<div class="pod-card" style="padding:12px;margin-bottom:8px"><div style="font-weight:600;font-size:.85rem">${esc(c.user_name||'Anonymous')}</div><div style="font-size:.78rem;color:var(--pod-text-dim);margin:4px 0">${esc(c.episode_title)}</div><div style="font-size:.82rem">${esc(c.comment_text).slice(0,100)}</div></div>`).join('')||'<div class="pod-empty">No comments yet</div>'}
      </div>
    </div>`;
    res.send(renderPage('podcast-dashboard', pageWrap('Podcast Dashboard', body), req));
  }));

  // ─── 2. CHANNELS CRUD ────────────────────────────────────────────────
  app.get(PFX + '/channels', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const [channels] = await pool.query(
      `SELECT c.*, (SELECT COUNT(*) FROM podcast_episodes WHERE channel_id=c.id AND status='published') AS ep_count,
        (SELECT COALESCE(SUM(play_count),0) FROM podcast_episodes WHERE channel_id=c.id) AS total_plays
       FROM podcast_channels c WHERE c.tenant_id=? ORDER BY c.sort_order, c.name`, [t]
    );
    let cards = '';
    for (const ch of channels) {
      cards += `<div class="pod-card">
        <div class="pod-card-img" style="${ch.cover_url ? 'background:url('+esc(ch.cover_url)+') center/cover' : 'background:linear-gradient(135deg,#1a1a2e,#7c3aed)'}">
          <div style="position:absolute;bottom:10px;left:12px;color:#fff;font-weight:700;text-shadow:0 1px 4px rgba(0,0,0,.6)">${esc(ch.name)}</div>
        </div>
        <div class="pod-card-body">
          <p style="font-size:.82rem;color:var(--pod-text-dim);margin:0 0 8px">${esc(ch.description||'').slice(0,120)}</p>
          <div class="pod-card-meta">${ch.ep_count} episodes · ${Number(ch.total_plays).toLocaleString()} plays · ${ch.category||'General'}</div>
          <div style="display:flex;gap:6px;margin-top:10px">
            <a href="/school/podcast/channels/${ch.id}" class="pod-btn pod-btn-primary pod-btn-sm">View</a>
            ${isTeacher(req)?`<a href="/school/podcast/channels/${ch.id}/edit" class="pod-btn pod-btn-secondary pod-btn-sm">Edit</a>`:''}
          </div></div></div>`;
    }
    const body = `<div class="pod-header"><h1>📻 Podcast Channels</h1>${isTeacher(req)?'<a href="/school/podcast/channels/new" class="pod-btn pod-btn-primary">+ New Channel</a>':''}</div>
      <div class="pod-grid pod-grid-3">${cards||'<div class="pod-empty"><div style="font-size:2.5rem;margin-bottom:8px">🎙️</div>No channels yet. Start broadcasting!</div>'}</div>`;
    res.send(renderPage('podcast-channels', pageWrap('Podcast Channels', body), req));
  }));

  app.get(PFX + '/channels/new', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/channels');
    const categories = ['School News','Sports','Academic','Music','Drama','Student Voices','Technology','Arts','General'];
    const catOpts = categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const body = `<div class="pod-header"><h1>Create Channel</h1><a href="/school/podcast/channels" class="pod-btn pod-btn-secondary">← Back</a></div>
      <div class="pod-card" style="max-width:600px"><form method="POST" action="/school/podcast/channels">
        <div class="pod-form-group"><label class="pod-label">Channel Name *</label><input class="pod-input" name="name" required maxlength="200"></div>
        <div class="pod-form-group"><label class="pod-label">Slug (auto-generated)</label><input class="pod-input" name="slug" readonly></div>
        <div class="pod-form-group"><label class="pod-label">Description</label><textarea class="pod-textarea" name="description" rows="3"></textarea></div>
        <div class="pod-form-group"><label class="pod-label">Cover Image URL</label><input class="pod-input" name="cover_url" placeholder="https://..."></div>
        <div class="pod-form-group"><label class="pod-label">Category</label><select class="pod-select" name="category">${catOpts}</select></div>
        <div class="pod-form-group"><label class="pod-label">Author / Host Name</label><input class="pod-input" name="author_name" maxlength="150"></div>
        <div class="pod-form-group"><label class="pod-label">Public Channel</label><select class="pod-select" name="is_public"><option value="1">Yes</option><option value="0">No (School Only)</option></select></div>
        <button type="submit" class="pod-btn pod-btn-primary">Create Channel</button>
      </form></div>
      <script>document.querySelector('[name=name]').addEventListener('input',e=>{document.querySelector('[name=slug]').value=e.target.value.toLowerCase().replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'');});</script>`;
    res.send(renderPage('podcast-channels-new', pageWrap('New Channel', body), req));
  }));

  app.post(PFX + '/channels', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/channels');
    const t = tid(req);
    const { name, slug, description, cover_url, category, author_name, is_public } = req.body;
    const s = slugify(slug || name);
    await pool.query(
      `INSERT INTO podcast_channels (tenant_id,name,slug,description,cover_url,category,author_name,owner_id,is_public) VALUES (?,?,?,?,?,?,?,?,?)`,
      [t, name, s, description||'', cover_url||'', category||'General', author_name||'', uid(req), is_public==='1'?1:0]
    );
    audit(req, 'podcast_channel_create', { name });
    res.redirect(PFX + '/channels');
  }));

  app.get(PFX + '/channels/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const [channels] = await pool.query(`SELECT * FROM podcast_channels WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    if (!channels[0]) return res.send('Channel not found');
    const ch = channels[0];
    const page = parseInt(req.query.page) || 1;
    const limit = 12;
    const offset = (page - 1) * limit;
    const [eps] = await pool.query(
      `SELECT * FROM podcast_episodes WHERE channel_id=? AND tenant_id=? AND status='published' ORDER BY episode_number DESC, published_at DESC LIMIT ? OFFSET ?`,
      [ch.id, t, limit, offset]
    );
    const [[{total}]] = await pool.query(`SELECT COUNT(*) AS total FROM podcast_episodes WHERE channel_id=? AND tenant_id=? AND status='published'`, [ch.id, t]);
    const totalPages = Math.ceil(total / limit);
    let epList = '';
    for (const ep of eps) {
      epList += `<div class="pod-card">
        <div class="pod-card-img" style="${ch.cover_url?'background:url('+esc(ch.cover_url)+') center/cover':'background:linear-gradient(135deg,#1a1a2e,#7c3aed)'}">
          <div class="pod-play-overlay"><button class="pod-play-btn" onclick="POD.play('${esc(ep.audio_url)}',${ep.id},'${esc(ep.title)}',${ep.duration_sec})">▶</button></div>
        </div>
        <div class="pod-card-body">
          <div class="pod-card-title">Ep ${ep.episode_number||'?'}: ${esc(ep.title)}</div>
          <div class="pod-card-meta">${fmtDate(ep.published_at)} · ${fmtDuration(ep.duration_sec)} · ${Number(ep.play_count).toLocaleString()} plays</div>
          <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">${(ep.tags||'').split(',').filter(Boolean).slice(0,4).map(t=>`<span class="pod-chip">${esc(t.trim())}</span>`).join('')}</div>
          <a href="/school/podcast/episodes/${ep.id}" class="pod-btn pod-btn-secondary pod-btn-sm" style="margin-top:8px">Show Notes</a>
        </div></div>`;
    }
    const pagination = totalPages > 1 ? `<div style="display:flex;gap:8px;justify-content:center;margin-top:20px">${Array.from({length:totalPages},(_,i)=>`<a href="?page=${i+1}" class="pod-btn pod-btn-sm ${i+1===page?'pod-btn-primary':'pod-btn-secondary'}">${i+1}</a>`).join('')}</div>` : '';
    const body = `<div class="pod-header"><h1>📻 ${esc(ch.name)}</h1><a href="/school/podcast/channels" class="pod-btn pod-btn-secondary">← All Channels</a></div>
      <div class="pod-card" style="padding:20px;margin-bottom:24px;display:flex;gap:20px;align-items:center;flex-wrap:wrap">
        <div style="width:100px;height:100px;border-radius:12px;flex-shrink:0;${ch.cover_url?'background:url('+esc(ch.cover_url)+') center/cover':'background:linear-gradient(135deg,#7c3aed,#06d6a0)'}"></div>
        <div style="flex:1"><h2 style="margin:0 0 6px">${esc(ch.name)}</h2><p style="margin:0;color:var(--pod-text-dim);font-size:.88rem">${esc(ch.description)}</p>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap"><span class="pod-chip">${esc(ch.category)}</span><span class="pod-chip">${total} episodes</span><span class="pod-chip">By ${esc(ch.author_name||'Campus Radio')}</span></div></div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <a href="/school/podcast/channels/${ch.id}/rss" class="pod-btn pod-btn-accent pod-btn-sm">📡 RSS Feed</a>
          ${isTeacher(req)?`<a href="/school/podcast/channels/${ch.id}/episodes/new" class="pod-btn pod-btn-primary pod-btn-sm">+ New Episode</a>`:''}
        </div>
      </div>
      <div class="pod-grid pod-grid-3">${epList||'<div class="pod-empty">No episodes published yet</div>'}</div>${pagination}`;
    res.send(renderPage('podcast-channel-view', pageWrap(ch.name, body), req));
  }));

  app.get(PFX + '/channels/:id/edit', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/channels');
    const t = tid(req);
    const [channels] = await pool.query(`SELECT * FROM podcast_channels WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    if (!channels[0]) return res.send('Not found');
    const ch = channels[0];
    const categories = ['School News','Sports','Academic','Music','Drama','Student Voices','Technology','Arts','General'];
    const catOpts = categories.map(c => `<option value="${esc(c)}" ${c===ch.category?'selected':''}>${esc(c)}</option>`).join('');
    const body = `<div class="pod-header"><h1>Edit Channel</h1><a href="/school/podcast/channels/${ch.id}" class="pod-btn pod-btn-secondary">← Back</a></div>
      <div class="pod-card" style="max-width:600px"><form method="POST" action="/school/podcast/channels/${ch.id}">
        <div class="pod-form-group"><label class="pod-label">Channel Name *</label><input class="pod-input" name="name" value="${esc(ch.name)}" required></div>
        <div class="pod-form-group"><label class="pod-label">Slug</label><input class="pod-input" name="slug" value="${esc(ch.slug)}"></div>
        <div class="pod-form-group"><label class="pod-label">Description</label><textarea class="pod-textarea" name="description" rows="3">${esc(ch.description)}</textarea></div>
        <div class="pod-form-group"><label class="pod-label">Cover Image URL</label><input class="pod-input" name="cover_url" value="${esc(ch.cover_url||'')}"></div>
        <div class="pod-form-group"><label class="pod-label">Category</label><select class="pod-select" name="category">${catOpts}</select></div>
        <div class="pod-form-group"><label class="pod-label">Author / Host Name</label><input class="pod-input" name="author_name" value="${esc(ch.author_name||'')}"></div>
        <div class="pod-form-group"><label class="pod-label">Public</label><select class="pod-select" name="is_public"><option value="1" ${ch.is_public?'selected':''}>Yes</option><option value="0" ${!ch.is_public?'selected':''}>No</option></select></div>
        <button type="submit" class="pod-btn pod-btn-primary">Save Changes</button>
        <a href="/school/podcast/channels/${ch.id}/delete" class="pod-btn pod-btn-danger" style="margin-left:8px">Delete</a>
      </form></div>`;
    res.send(renderPage('podcast-channels-edit', pageWrap('Edit Channel', body), req));
  }));

  app.post(PFX + '/channels/:id', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/channels');
    const t = tid(req);
    const { name, slug, description, cover_url, category, author_name, is_public } = req.body;
    await pool.query(
      `UPDATE podcast_channels SET name=?,slug=?,description=?,cover_url=?,category=?,author_name=?,is_public=?,updated_at=NOW() WHERE id=? AND tenant_id=?`,
      [name, slugify(slug||name), description, cover_url, category, author_name, is_public==='1'?1:0, req.params.id, t]
    );
    audit(req, 'podcast_channel_update', { channel_id: req.params.id });
    res.redirect(PFX + '/channels/' + req.params.id);
  }));

  app.get(PFX + '/channels/:id/delete', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/channels');
    const t = tid(req);
    await pool.query(`DELETE FROM podcast_episodes WHERE channel_id=? AND tenant_id=?`, [req.params.id, t]);
    await pool.query(`DELETE FROM podcast_channels WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    audit(req, 'podcast_channel_delete', { channel_id: req.params.id });
    res.redirect(PFX + '/channels');
  }));

  // ─── 3. EPISODES CRUD ────────────────────────────────────────────────
  app.get(PFX + '/channels/:chId/episodes/new', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/channels');
    const t = tid(req);
    const [chs] = await pool.query(`SELECT * FROM podcast_channels WHERE id=? AND tenant_id=?`, [req.params.chId, t]);
    if (!chs[0]) return res.send('Channel not found');
    const ch = chs[0];
    const [[{nextEp}]] = await pool.query(`SELECT COALESCE(MAX(episode_number),0)+1 AS nextEp FROM podcast_episodes WHERE channel_id=? AND tenant_id=?`, [ch.id, t]);
    const [[{nextSeason}]] = await pool.query(`SELECT COALESCE(MAX(season_number),1) AS nextSeason FROM podcast_episodes WHERE channel_id=? AND tenant_id=?`, [ch.id, t]);
    const body = `<div class="pod-header"><h1>New Episode — ${esc(ch.name)}</h1><a href="/school/podcast/channels/${ch.id}" class="pod-btn pod-btn-secondary">← Back</a></div>
      <div class="pod-card" style="max-width:700px"><form method="POST" action="/school/podcast/channels/${ch.id}/episodes">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="pod-form-group"><label class="pod-label">Episode Number</label><input class="pod-input" name="episode_number" type="number" value="${nextEp}" min="1"></div>
          <div class="pod-form-group"><label class="pod-label">Season Number</label><input class="pod-input" name="season_number" type="number" value="${nextSeason}" min="1"></div>
        </div>
        <div class="pod-form-group"><label class="pod-label">Title *</label><input class="pod-input" name="title" required maxlength="300"></div>
        <div class="pod-form-group"><label class="pod-label">Description</label><textarea class="pod-textarea" name="description" rows="2"></textarea></div>
        <div class="pod-form-group"><label class="pod-label">Show Notes (supports links)</label><textarea class="pod-textarea" name="show_notes" rows="5" placeholder="Detailed notes, timestamps, resources, links..."></textarea></div>
        <div class="pod-form-group"><label class="pod-label">Audio File URL *</label><input class="pod-input" name="audio_url" required placeholder="https://...mp3"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="pod-form-group"><label class="pod-label">Duration (seconds)</label><input class="pod-input" name="duration_sec" type="number" value="0" min="0"></div>
          <div class="pod-form-group"><label class="pod-label">Category</label><input class="pod-input" name="category" placeholder="e.g. Interview, Solo"></div>
        </div>
        <div class="pod-form-group"><label class="pod-label">Tags (comma-separated)</label><input class="pod-input" name="tags" placeholder="interview, science, fun"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="pod-form-group"><label class="pod-label">Status</label><select class="pod-select" name="status"><option value="draft">Draft</option><option value="scheduled">Scheduled</option><option value="published">Published</option></select></div>
          <div class="pod-form-group"><label class="pod-label">Scheduled At</label><input class="pod-input" name="scheduled_at" type="datetime-local"></div>
        </div>
        <div class="pod-form-group"><label class="pod-label">Explicit Content</label><select class="pod-select" name="explicit"><option value="0">No</option><option value="1">Yes</option></select></div>
        <div class="pod-form-group"><label class="pod-label">Chapter Markers (JSON: [{title, time_sec}])</label><textarea class="pod-textarea" name="chapter_data" rows="3" placeholder='[{"title":"Intro","time_sec":0},{"title":"Main Topic","time_sec":120}]'></textarea></div>
        <button type="submit" class="pod-btn pod-btn-primary">Create Episode</button>
      </form></div>`;
    res.send(renderPage('podcast-episodes-new', pageWrap('New Episode', body), req));
  }));

  app.post(PFX + '/channels/:chId/episodes', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/channels');
    const t = tid(req);
    const { title, description, show_notes, audio_url, duration_sec, episode_number, season_number, tags, category, status, scheduled_at, explicit, chapter_data } = req.body;
    const s = slugify(title);
    const publishedAt = status === 'published' ? now() : null;
    await pool.query(
      `INSERT INTO podcast_episodes (tenant_id,channel_id,title,slug,description,show_notes,audio_url,duration_sec,episode_number,season_number,tags,category,status,scheduled_at,published_at,explicit,chapter_data,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [t, req.params.chId, title, s, description, show_notes, audio_url, parseInt(duration_sec)||0, parseInt(episode_number)||0, parseInt(season_number)||1, tags, category, status, scheduled_at||null, publishedAt, explicit==='1'?1:0, chapter_data||null, uid(req)]
    );
    audit(req, 'podcast_episode_create', { title, channel_id: req.params.chId });
    res.redirect(PFX + '/channels/' + req.params.chId);
  }));

  app.get(PFX + '/episodes/:id', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const [eps] = await pool.query(
      `SELECT e.*, c.name AS channel_name, c.slug AS channel_slug, c.cover_url, c.author_name
       FROM podcast_episodes e JOIN podcast_channels c ON c.id=e.channel_id
       WHERE e.id=? AND e.tenant_id=?`, [req.params.id, t]
    );
    if (!eps[0]) return res.send('Episode not found');
    const ep = eps[0];
    const [comments] = await pool.query(
      `SELECT * FROM podcast_comments WHERE episode_id=? AND tenant_id=? AND is_approved=1 AND parent_id=0 ORDER BY created_at DESC`, [ep.id, t]
    );
    const [replies] = await pool.query(
      `SELECT * FROM podcast_comments WHERE episode_id=? AND tenant_id=? AND is_approved=1 AND parent_id>0 ORDER BY created_at`, [ep.id, t]
    );
    let chapters = [];
    try { chapters = ep.chapter_data ? JSON.parse(ep.chapter_data) : []; } catch(e) {}
    const waveBars = Array.from({length:60}, () => Math.floor(Math.random()*80+20));
    const waveform = waveBars.map(h => `<div class="pod-waveform-bar" style="height:${h}%"></div>`).join('');
    const commentsHtml = comments.map(c => {
      const cReplies = replies.filter(r => r.parent_id === c.id);
      return `<div class="pod-comment"><div class="pod-avatar">${esc((c.user_name||'A')[0].toUpperCase())}</div>
        <div style="flex:1"><div style="display:flex;align-items:center;gap:8px"><strong style="font-size:.85rem">${esc(c.user_name||'Anonymous')}</strong><span class="pod-chip">${esc(c.user_role||'listener')}</span><span style="font-size:.72rem;color:var(--pod-text-dim)">${fmtDate(c.created_at)}</span></div>
        ${c.rating ? `<div class="pod-stars" style="font-size:.75rem;margin:2px 0">${'★'.repeat(c.rating)}${'☆'.repeat(5-c.rating)}</div>` : ''}
        <p style="margin:4px 0;font-size:.88rem">${esc(c.comment_text)}</p>
        <button class="pod-btn pod-btn-sm pod-btn-secondary" onclick="document.getElementById('reply-${c.id}').style.display=document.getElementById('reply-${c.id}').style.display==='none'?'block':'none'">Reply</button>
        <div id="reply-${c.id}" style="display:none;margin-top:8px"><form method="POST" action="/school/podcast/episodes/${ep.id}/comments"><input type="hidden" name="parent_id" value="${c.id}"><textarea class="pod-textarea" name="comment_text" rows="2" placeholder="Write a reply..." required></textarea><button type="submit" class="pod-btn pod-btn-primary pod-btn-sm" style="margin-top:6px">Reply</button></form></div>
        ${cReplies.map(r => `<div style="margin-left:20px;padding:8px 0;border-bottom:1px solid var(--pod-border)"><strong style="font-size:.82rem">${esc(r.user_name||'Anonymous')}</strong> <span style="font-size:.72rem;color:var(--pod-text-dim)">${fmtDate(r.created_at)}</span><p style="margin:3px 0;font-size:.82rem">${esc(r.comment_text)}</p></div>`).join('')}
        </div></div>`;
    }).join('');
    const body = `
    <div class="pod-header"><h1>${esc(ep.title)}</h1><a href="/school/podcast/channels/${ep.channel_id}" class="pod-btn pod-btn-secondary">← ${esc(ep.channel_name)}</a></div>
    <div class="pod-layout">
      <div class="pod-main">
        <div class="pod-card" style="padding:20px;margin-bottom:20px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
            <div style="width:80px;height:80px;border-radius:10px;flex-shrink:0;${ep.cover_url?'background:url('+esc(ep.cover_url)+') center/cover':'background:linear-gradient(135deg,#7c3aed,#06d6a0)'}"></div>
            <div><h2 style="margin:0 0 4px">${esc(ep.channel_name)}</h2>
              <div style="font-size:.82rem;color:var(--pod-text-dim)">Season ${ep.season_number||1} · Episode ${ep.episode_number||'?'} · ${fmtDate(ep.published_at)} · ${fmtDuration(ep.duration_sec)}</div>
              <div style="display:flex;gap:4px;margin-top:6px;flex-wrap:wrap">${(ep.tags||'').split(',').filter(Boolean).map(t=>`<span class="pod-chip">${esc(t.trim())}</span>`).join('')}</div>
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:14px;margin-bottom:12px">
            <button class="pod-play-btn" onclick="POD.play('${esc(ep.audio_url)}',${ep.id},'${esc(ep.title)}',${ep.duration_sec})">▶</button>
            <div style="flex:1"><div class="pod-waveform" style="height:50px">${waveform}</div></div>
            <div style="text-align:right"><div style="font-size:.82rem;color:var(--pod-text-dim)">${Number(ep.play_count).toLocaleString()} plays</div>
              <div class="pod-stars" style="font-size:.9rem">${'★'.repeat(Math.round(ep.rating_avg||0))}${'☆'.repeat(5-Math.round(ep.rating_avg||0))} <span style="font-size:.8rem;color:var(--pod-text-dim)">${ep.rating_avg||0} (${ep.rating_count} ratings)</span></div>
            </div>
          </div>
          ${ep.description ? `<p style="font-size:.92rem;color:var(--pod-text-dim);margin-bottom:16px">${esc(ep.description)}</p>` : ''}
          <hr class="pod-divider">
          ${ep.show_notes ? `<div><h3 style="font-size:1rem;margin-bottom:8px">📝 Show Notes</h3><div style="font-size:.88rem;line-height:1.7;white-space:pre-wrap">${esc(ep.show_notes).replace(/(https?:\/\/[^\s]+)/g,'<a href="$1" target="_blank" style="color:var(--pod-primary)">$1</a>')}</div></div>` : ''}
        </div>
        ${chapters.length ? `<div class="pod-card" style="padding:16px;margin-bottom:20px"><h3 style="font-size:.95rem;margin:0 0 10px">📑 Chapters</h3>${chapters.map(ch => `<div class="pod-chapter-item" onclick="POD.skipTo(${ch.time_sec})"><span style="font-size:.82rem;color:var(--pod-primary);font-weight:600;min-width:50px">${fmtDuration(ch.time_sec)}</span><span style="font-size:.88rem">${esc(ch.title)}</span></div>`).join('')}</div>` : ''}
        <div class="pod-card" style="padding:20px">
          <h3 style="font-size:.95rem;margin:0 0 14px">💬 Comments (${comments.length})</h3>
          <form method="POST" action="/school/podcast/episodes/${ep.id}/comments" style="margin-bottom:16px">
            <textarea class="pod-textarea" name="comment_text" rows="2" placeholder="Share your thoughts..." required></textarea>
            <div style="display:flex;gap:8px;align-items:center;margin-top:8px">
              <label class="pod-label" style="margin:0">Rating:</label>
              <select class="pod-select" name="rating" style="width:80px"><option value="0">—</option>${[1,2,3,4,5].map(n=>`<option value="${n}">${'★'.repeat(n)}</option>`).join('')}</select>
              <button type="submit" class="pod-btn pod-btn-primary pod-btn-sm">Post</button>
            </div>
          </form>
          ${commentsHtml || '<div class="pod-empty">Be the first to comment!</div>'}
        </div>
      </div>
      <div class="pod-sidebar">
        ${isTeacher(req) ? `<div class="pod-card" style="padding:16px;margin-bottom:16px"><h3 style="font-size:.9rem;margin:0 0 10px">⚙️ Admin</h3>
          <div style="display:flex;flex-direction:column;gap:6px">
            <a href="/school/podcast/episodes/${ep.id}/edit" class="pod-btn pod-btn-secondary pod-btn-sm">Edit Episode</a>
            ${ep.status==='draft'?`<form method="POST" action="/school/podcast/episodes/${ep.id}/publish" style="display:inline"><button class="pod-btn pod-btn-accent pod-btn-sm">Publish Now</button></form>`:''}
            ${ep.status==='published'?`<form method="POST" action="/school/podcast/episodes/${ep.id}/feature"><button class="pod-btn pod-btn-primary pod-btn-sm">${ep.featured?'Unfeature':'⭐ Feature'}</button></form>`:''}
          </div>
        </div>` : ''}
        <div class="pod-card" style="padding:16px;margin-bottom:16px">
          <h3 style="font-size:.9rem;margin:0 0 10px">📡 Subscribe</h3>
          <form method="POST" action="/school/podcast/subscribe"><input type="hidden" name="channel_id" value="${ep.channel_id}">
            <button class="pod-btn pod-btn-accent pod-btn-sm" style="width:100%">Subscribe to ${esc(ep.channel_name)}</button></form>
        </div>
        <div class="pod-card" style="padding:16px">
          <h3 style="font-size:.9rem;margin:0 0 10px">📊 Stats</h3>
          <div style="font-size:.82rem;color:var(--pod-text-dim)">
            <div style="margin-bottom:4px">Plays: <strong style="color:var(--pod-text)">${Number(ep.play_count).toLocaleString()}</strong></div>
            <div style="margin-bottom:4px">Completes: <strong style="color:var(--pod-text)">${ep.complete_count}</strong></div>
            <div style="margin-bottom:4px">Avg Listen: <strong style="color:var(--pod-text)">${ep.avg_listen_pct}%</strong></div>
            <div>Duration: <strong style="color:var(--pod-text)">${fmtDuration(ep.duration_sec)}</strong></div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('podcast-episode-view', pageWrap(ep.title, body), req));
  }));

  app.get(PFX + '/episodes/:id/edit', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const [eps] = await pool.query(`SELECT * FROM podcast_episodes WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    if (!eps[0]) return res.send('Not found');
    const ep = eps[0];
    const body = `<div class="pod-header"><h1>Edit Episode</h1><a href="/school/podcast/episodes/${ep.id}" class="pod-btn pod-btn-secondary">← Back</a></div>
      <div class="pod-card" style="max-width:700px"><form method="POST" action="/school/podcast/episodes/${ep.id}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="pod-form-group"><label class="pod-label">Episode Number</label><input class="pod-input" name="episode_number" type="number" value="${ep.episode_number}"></div>
          <div class="pod-form-group"><label class="pod-label">Season Number</label><input class="pod-input" name="season_number" type="number" value="${ep.season_number||1}"></div>
        </div>
        <div class="pod-form-group"><label class="pod-label">Title *</label><input class="pod-input" name="title" value="${esc(ep.title)}" required></div>
        <div class="pod-form-group"><label class="pod-label">Description</label><textarea class="pod-textarea" name="description" rows="2">${esc(ep.description)}</textarea></div>
        <div class="pod-form-group"><label class="pod-label">Show Notes</label><textarea class="pod-textarea" name="show_notes" rows="5">${esc(ep.show_notes||'')}</textarea></div>
        <div class="pod-form-group"><label class="pod-label">Audio URL</label><input class="pod-input" name="audio_url" value="${esc(ep.audio_url)}" required></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="pod-form-group"><label class="pod-label">Duration (sec)</label><input class="pod-input" name="duration_sec" type="number" value="${ep.duration_sec}"></div>
          <div class="pod-form-group"><label class="pod-label">Category</label><input class="pod-input" name="category" value="${esc(ep.category||'')}"></div>
        </div>
        <div class="pod-form-group"><label class="pod-label">Tags</label><input class="pod-input" name="tags" value="${esc(ep.tags||'')}"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div class="pod-form-group"><label class="pod-label">Status</label><select class="pod-select" name="status"><option value="draft" ${ep.status==='draft'?'selected':''}>Draft</option><option value="scheduled" ${ep.status==='scheduled'?'selected':''}>Scheduled</option><option value="published" ${ep.status==='published'?'selected':''}>Published</option><option value="archived" ${ep.status==='archived'?'selected':''}>Archived</option></select></div>
          <div class="pod-form-group"><label class="pod-label">Scheduled At</label><input class="pod-input" name="scheduled_at" type="datetime-local" value="${ep.scheduled_at?ep.scheduled_at.slice(0,16):''}"></div>
        </div>
        <div class="pod-form-group"><label class="pod-label">Chapter Markers (JSON)</label><textarea class="pod-textarea" name="chapter_data" rows="3">${esc(ep.chapter_data||'')}</textarea></div>
        <button type="submit" class="pod-btn pod-btn-primary">Save</button>
        <a href="/school/podcast/episodes/${ep.id}/delete" class="pod-btn pod-btn-danger" style="margin-left:8px">Delete</a>
      </form></div>`;
    res.send(renderPage('podcast-episodes-edit', pageWrap('Edit Episode', body), req));
  }));

  app.post(PFX + '/episodes/:id', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const { title, description, show_notes, audio_url, duration_sec, episode_number, season_number, tags, category, status, scheduled_at, chapter_data } = req.body;
    const publishedAt = status === 'published' && !req.body._already_published ? 'COALESCE(published_at,NOW())' : 'published_at';
    await pool.query(
      `UPDATE podcast_episodes SET title=?,description=?,show_notes=?,audio_url=?,duration_sec=?,episode_number=?,season_number=?,tags=?,category=?,status=?,scheduled_at=?,chapter_data=?,updated_at=NOW(),published_at=IF(?='published' AND published_at IS NULL,NOW(),published_at) WHERE id=? AND tenant_id=?`,
      [title, description, show_notes, audio_url, parseInt(duration_sec)||0, parseInt(episode_number)||0, parseInt(season_number)||1, tags, category, status, scheduled_at||null, chapter_data||null, status, req.params.id, t]
    );
    audit(req, 'podcast_episode_update', { episode_id: req.params.id });
    res.redirect(PFX + '/episodes/' + req.params.id);
  }));

  app.get(PFX + '/episodes/:id/delete', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const [eps] = await pool.query(`SELECT channel_id FROM podcast_episodes WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    if (eps[0]) {
      await pool.query(`DELETE FROM podcast_comments WHERE episode_id=? AND tenant_id=?`, [req.params.id, t]);
      await pool.query(`DELETE FROM podcast_listens WHERE episode_id=? AND tenant_id=?`, [req.params.id, t]);
      await pool.query(`DELETE FROM podcast_episodes WHERE id=? AND tenant_id=?`, [req.params.id, t]);
      audit(req, 'podcast_episode_delete', { episode_id: req.params.id });
    }
    res.redirect(PFX + '/channels/' + (eps[0]?.channel_id || ''));
  }));

  app.post(PFX + '/episodes/:id/publish', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    await pool.query(`UPDATE podcast_episodes SET status='published',published_at=NOW(),updated_at=NOW() WHERE id=? AND tenant_id=?`, [req.params.id, tid(req)]);
    audit(req, 'podcast_episode_publish', { episode_id: req.params.id });
    res.redirect(PFX + '/episodes/' + req.params.id);
  }));

  app.post(PFX + '/episodes/:id/feature', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    await pool.query(`UPDATE podcast_episodes SET featured=IF(featured=1,0,1),updated_at=NOW() WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    res.redirect(PFX + '/episodes/' + req.params.id);
  }));

  // ─── 4. RSS FEED ─────────────────────────────────────────────────────
  app.get(PFX + '/channels/:id/rss', ah(async (req, res) => {
    const t = tid(req);
    const [chs] = await pool.query(`SELECT * FROM podcast_channels WHERE id=? AND tenant_id=? AND is_public=1`, [req.params.id, t]);
    if (!chs[0]) return res.status(404).send('Channel not found or not public');
    const ch = chs[0];
    const [eps] = await pool.query(
      `SELECT * FROM podcast_episodes WHERE channel_id=? AND tenant_id=? AND status='published' ORDER BY published_at DESC LIMIT 100`,
      [ch.id, t]
    );
    const baseUrl = (req.protocol + '://' + req.get('host'));
    const items = eps.map(ep => `    <item>
      <title>${xmlEsc(ep.title)}</title>
      <link>${baseUrl}${PFX}/episodes/${ep.id}</link>
      <description>${xmlEsc(ep.description || ep.show_notes || '')}</description>
      <enclosure url="${xmlEsc(ep.audio_url)}" length="${ep.audio_size||0}" type="audio/mpeg"/>
      <guid isPermaLink="true">${baseUrl}${PFX}/episodes/${ep.id}</guid>
      <pubDate>${ep.published_at ? new Date(ep.published_at).toUTCString() : ''}</pubDate>
      <itunes:duration>${fmtDuration(ep.duration_sec)}</itunes:duration>
      <itunes:episode>${ep.episode_number||''}</itunes:episode>
      <itunes:season>${ep.season_number||1}</itunes:season>
      <itunes:summary>${xmlEsc(ep.description||'')}</itunes:summary>
      ${ep.explicit ? '<itunes:explicit>yes</itunes:explicit>' : '<itunes:explicit>no</itunes:explicit>'}
      <itunes:image href="${xmlEsc(ch.cover_url||baseUrl+'/public/icon.png')}"/>
    </item>`).join('\n');
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:itunes="http://www.itunes.com/dtds/podcast-1.0.dtd" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xmlEsc(ch.name)}</title>
    <link>${baseUrl}${PFX}/channels/${ch.id}</link>
    <description>${xmlEsc(ch.description||'')}</description>
    <language>en-us</language>
    <atom:link href="${baseUrl}${PFX}/channels/${ch.id}/rss" rel="self" type="application/rss+xml"/>
    <itunes:type>episodic</itunes:type>
    <itunes:author>${xmlEsc(ch.author_name||'Campus Podcast')}</itunes:author>
    <itunes:owner><itunes:name>${xmlEsc(ch.author_name||'Campus Podcast')}</itunes:name></itunes:owner>
    <itunes:category text="${xmlEsc(ch.category||'Education')}"/>
    <itunes:image href="${xmlEsc(ch.cover_url||baseUrl+'/public/icon.png')}"/>
    <itunes:explicit>no</itunes:explicit>
${items}
  </channel>
</rss>`;
    res.set('Content-Type', 'application/rss+xml; charset=utf-8');
    res.send(xml);
  }));

  // ─── 5. SCHEDULER ────────────────────────────────────────────────────
  app.get(PFX + '/scheduler', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const [scheduled] = await pool.query(
      `SELECT e.*, c.name AS channel_name FROM podcast_episodes e JOIN podcast_channels c ON c.id=e.channel_id
       WHERE e.tenant_id=? AND e.status IN ('scheduled','draft') ORDER BY e.scheduled_at ASC`, [t]
    );
    const [published] = await pool.query(
      `SELECT e.*, c.name AS channel_name FROM podcast_episodes e JOIN podcast_channels c ON c.id=e.channel_id
       WHERE e.tenant_id=? AND e.status='published' ORDER BY e.published_at DESC LIMIT 20`, [t]
    );
    const schedRows = scheduled.map(ep => `<tr>
      <td><strong>${esc(ep.title)}</strong></td><td>${esc(ep.channel_name)}</td>
      <td><span class="pod-badge ${ep.status==='scheduled'?'pod-badge-sched':'pod-badge-draft'}">${ep.status}</span></td>
      <td>${ep.scheduled_at ? fmtDate(ep.scheduled_at) : '—'}</td>
      <td>Season ${ep.season_number||1} · Ep ${ep.episode_number||'?'}</td>
      <td>${isTeacher(req)?`<a href="/school/podcast/episodes/${ep.id}/edit" class="pod-btn pod-btn-sm pod-btn-secondary">Edit</a>
        ${ep.status==='draft'?`<form method="POST" action="/school/podcast/episodes/${ep.id}/publish" style="display:inline"><button class="pod-btn pod-btn-sm pod-btn-accent">Publish</button></form>`:''}
      `:''}</td></tr>`).join('');
    const pubRows = published.map(ep => `<tr>
      <td><strong>${esc(ep.title)}</strong></td><td>${esc(ep.channel_name)}</td>
      <td>${fmtDate(ep.published_at)}</td><td>${Number(ep.play_count).toLocaleString()} plays</td></tr>`).join('');
    const body = `<div class="pod-header"><h1>📅 Episode Scheduler</h1><a href="/school/podcast/" class="pod-btn pod-btn-secondary">← Dashboard</a></div>
      <div class="pod-card" style="margin-bottom:24px"><div style="padding:16px">
        <h3 style="margin:0 0 12px;font-size:1rem">⏳ Scheduled & Draft Episodes</h3>
        <table class="pod-table"><thead><tr><th>Title</th><th>Channel</th><th>Status</th><th>Scheduled</th><th>Season/Ep</th><th>Actions</th></tr></thead>
        <tbody>${schedRows||'<tr><td colspan="6" style="text-align:center;color:var(--pod-text-dim)">No scheduled episodes</td></tr>'}</tbody></table>
      </div></div>
      <div class="pod-card"><div style="padding:16px">
        <h3 style="margin:0 0 12px;font-size:1rem">✅ Recently Published</h3>
        <table class="pod-table"><thead><tr><th>Title</th><th>Channel</th><th>Published</th><th>Plays</th></tr></thead>
        <tbody>${pubRows||'<tr><td colspan="4" style="text-align:center;color:var(--pod-text-dim)">No published episodes</td></tr>'}</tbody></table>
      </div></div>`;
    res.send(renderPage('podcast-scheduler', pageWrap('Episode Scheduler', body), req));
  }));

  // ─── 6. STUDENT SUBMISSIONS ──────────────────────────────────────────
  app.get(PFX + '/submit', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const [chs] = await pool.query(`SELECT id,name FROM podcast_channels WHERE tenant_id=? AND is_public=1 ORDER BY name`, [t]);
    const channelOpts = chs.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const [mySubs] = await pool.query(`SELECT * FROM podcast_student_submissions WHERE tenant_id=? AND student_id=? ORDER BY created_at DESC LIMIT 10`, [t, uid(req)]);
    let subList = mySubs.map(s => `<div class="pod-card" style="padding:14px;margin-bottom:10px">
      <div style="display:flex;justify-content:space-between;align-items:center"><strong>${esc(s.title||'Untitled')}</strong><span class="pod-badge ${s.status==='approved'?'pod-badge-pub':s.status==='rejected'?'pod-badge-draft':'pod-badge-sched'}">${s.status}</span></div>
      <div style="font-size:.82rem;color:var(--pod-text-dim);margin-top:4px">${esc(s.description||'').slice(0,120)}</div>
      ${s.teacher_notes ? `<div style="font-size:.8rem;color:var(--pod-warn);margin-top:4px">Teacher: ${esc(s.teacher_notes)}</div>` : ''}
    </div>`).join('');
    const body = `<div class="pod-header"><h1>🎤 Submit Episode</h1><a href="/school/podcast/" class="pod-btn pod-btn-secondary">← Dashboard</a></div>
      <div class="pod-layout"><div class="pod-main">
        <div class="pod-card" style="padding:20px;margin-bottom:20px">
          <h3 style="margin:0 0 14px;font-size:1rem">🎙️ New Submission</h3>
          <form method="POST" action="/school/podcast/submit">
            <div class="pod-form-group"><label class="pod-label">Channel</label><select class="pod-select" name="channel_id"><option value="">— Select Channel —</option>${channelOpts}</select></div>
            <div class="pod-form-group"><label class="pod-label">Episode Title *</label><input class="pod-input" name="title" required></div>
            <div class="pod-form-group"><label class="pod-label">Description</label><textarea class="pod-textarea" name="description" rows="2"></textarea></div>
            <div class="pod-form-group"><label class="pod-label">Audio URL *</label><input class="pod-input" name="audio_url" required placeholder="https://..."></div>
            <div class="pod-form-group"><label class="pod-label">Duration (seconds)</label><input class="pod-input" name="duration_sec" type="number" value="0"></div>
            <div class="pod-form-group"><label class="pod-label">Host Profile Bio</label><textarea class="pod-textarea" name="host_profile" rows="2" placeholder="Tell us about yourself as a podcast host..."></textarea></div>
            <button type="submit" class="pod-btn pod-btn-primary">Submit for Review</button>
          </form>
        </div>
        <h3 style="font-size:1rem;margin-bottom:12px">📁 My Submissions</h3>
        ${subList||'<div class="pod-empty">No submissions yet</div>'}
      </div></div>`;
    res.send(renderPage('podcast-submit', pageWrap('Submit Episode', body), req));
  }));

  app.post(PFX + '/submit', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { channel_id, title, description, audio_url, duration_sec, host_profile } = req.body;
    const userName = req.session.user.name || req.session.user.email || 'Student';
    await pool.query(
      `INSERT INTO podcast_student_submissions (tenant_id,student_id,student_name,channel_id,title,description,audio_url,duration_sec,host_profile) VALUES (?,?,?,?,?,?,?,?,?)`,
      [t, uid(req), userName, channel_id||null, title, description, audio_url, parseInt(duration_sec)||0, host_profile]
    );
    audit(req, 'podcast_submission', { title });
    res.redirect(PFX + '/submit');
  }));

  app.get(PFX + '/submissions', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const [subs] = await pool.query(
      `SELECT s.*, c.name AS channel_name FROM podcast_student_submissions s LEFT JOIN podcast_channels c ON c.id=s.channel_id
       WHERE s.tenant_id=? ORDER BY s.created_at DESC`, [t]
    );
    const rows = subs.map(s => `<tr>
      <td><strong>${esc(s.title||'Untitled')}</strong><br><span style="font-size:.75rem;color:var(--pod-text-dim)">by ${esc(s.student_name||'Unknown')}</span></td>
      <td>${esc(s.channel_name||'—')}</td>
      <td><span class="pod-badge ${s.status==='approved'?'pod-badge-pub':s.status==='rejected'?'pod-badge-draft':'pod-badge-sched'}">${s.status}</span></td>
      <td>${s.audio_url ? `<a href="${esc(s.audio_url)}" target="_blank" class="pod-btn pod-btn-sm pod-btn-secondary">Play</a>` : '—'}</td>
      <td>${fmtDate(s.created_at)}</td>
      <td>${s.status==='pending'?`<form method="POST" action="/school/podcast/submissions/${s.id}/review" style="display:inline-flex;gap:4px">
        <input name="action" type="hidden" value="approve"><input name="notes" type="hidden" value="">
        <button class="pod-btn pod-btn-sm pod-btn-accent">Approve</button></form>
        <form method="POST" action="/school/podcast/submissions/${s.id}/review" style="display:inline"><input name="action" type="hidden" value="reject"><button class="pod-btn pod-btn-sm pod-btn-danger">Reject</button></form>`:'—'}</td>
    </tr>`).join('');
    const body = `<div class="pod-header"><h1>📝 Student Submissions</h1><a href="/school/podcast/" class="pod-btn pod-btn-secondary">← Dashboard</a></div>
      <div class="pod-card"><div style="padding:16px">
        <table class="pod-table"><thead><tr><th>Title / Student</th><th>Channel</th><th>Status</th><th>Audio</th><th>Date</th><th>Actions</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--pod-text-dim)">No submissions</td></tr>'}</tbody></table>
      </div></div>`;
    res.send(renderPage('podcast-submissions', pageWrap('Student Submissions', body), req));
  }));

  app.post(PFX + '/submissions/:id/review', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const { action, notes } = req.body;
    const status = action === 'approve' ? 'approved' : 'rejected';
    await pool.query(
      `UPDATE podcast_student_submissions SET status=?,teacher_notes=?,reviewed_by=?,reviewed_at=NOW() WHERE id=? AND tenant_id=?`,
      [status, notes||'', uid(req), req.params.id, t]
    );
    if (action === 'approve') {
      const [subs] = await pool.query(`SELECT * FROM podcast_student_submissions WHERE id=? AND tenant_id=?`, [req.params.id, t]);
      const sub = subs[0];
      if (sub && sub.channel_id && sub.audio_url) {
        const [[{nextEp}]] = await pool.query(`SELECT COALESCE(MAX(episode_number),0)+1 AS nextEp FROM podcast_episodes WHERE channel_id=? AND tenant_id=?`, [sub.channel_id, t]);
        await pool.query(
          `INSERT INTO podcast_episodes (tenant_id,channel_id,title,slug,description,audio_url,duration_sec,status,published_at,created_by) VALUES (?,?,?,?,?,?,?,?,NOW(),?)`,
          [t, sub.channel_id, sub.title||'Student Episode', slugify(sub.title||''), sub.description||'', sub.audio_url, sub.duration_sec||0, 'published', uid(req)]
        );
      }
    }
    audit(req, 'podcast_submission_review', { submission_id: req.params.id, action });
    res.redirect(PFX + '/submissions');
  }));

  // ─── 7. ANALYTICS ────────────────────────────────────────────────────
  app.get(PFX + '/analytics', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const [[{ total_plays, total_completes, total_episodes, total_listeners }]] = await pool.query(
      `SELECT
        (SELECT COALESCE(SUM(play_count),0) FROM podcast_episodes WHERE tenant_id=?) AS total_plays,
        (SELECT COALESCE(SUM(complete_count),0) FROM podcast_episodes WHERE tenant_id=?) AS total_completes,
        (SELECT COUNT(*) FROM podcast_episodes WHERE tenant_id=? AND status='published') AS total_episodes,
        (SELECT COUNT(DISTINCT user_id) FROM podcast_listens WHERE tenant_id=?) AS total_listeners`,
      [t, t, t, t]
    );
    const [topEps] = await pool.query(
      `SELECT e.*, c.name AS channel_name FROM podcast_episodes e JOIN podcast_channels c ON c.id=e.channel_id
       WHERE e.tenant_id=? AND e.status='published' ORDER BY e.play_count DESC LIMIT 10`, [t]
    );
    const [retentionData] = await pool.query(
      `SELECT e.id, e.title, e.duration_sec, e.play_count, e.complete_count, e.avg_listen_pct, c.name AS channel_name
       FROM podcast_episodes e JOIN podcast_channels c ON c.id=e.channel_id
       WHERE e.tenant_id=? AND e.status='published' AND e.play_count>0 ORDER BY e.avg_listen_pct DESC LIMIT 10`, [t]
    );
    const [recentListens] = await pool.query(
      `SELECT l.*, e.title AS episode_title, c.name AS channel_name
       FROM podcast_listens l JOIN podcast_episodes e ON e.id=l.episode_id JOIN podcast_channels c ON c.id=e.channel_id
       WHERE l.tenant_id=? ORDER BY l.listened_at DESC LIMIT 20`, [t]
    );
    const completionRate = total_plays > 0 ? ((total_completes / total_plays) * 100).toFixed(1) : 0;
    const topRows = topEps.map(ep => `<tr><td><strong>${esc(ep.title)}</strong></td><td>${esc(ep.channel_name)}</td><td>${Number(ep.play_count).toLocaleString()}</td>
      <td>${Number(ep.complete_count).toLocaleString()}</td><td><div style="display:flex;align-items:center;gap:8px"><div style="flex:1;height:6px;background:var(--pod-surface2);border-radius:3px"><div style="height:100%;width:${Math.min(ep.avg_listen_pct,100)}%;background:var(--pod-accent);border-radius:3px"></div></div><span style="font-size:.78rem">${ep.avg_listen_pct}%</span></div></td></tr>`).join('');
    const retentionRows = retentionData.map(ep => {
      const segments = 10;
      const segHtml = Array.from({length:segments}, (_,i) => {
        const pct = ep.avg_listen_pct || 0;
        const segPct = Math.max(0, pct - (i * (100-pct)/segments));
        const hue = Math.round(200 - (i * 180 / segments));
        return `<div class="pod-retention-seg" style="background:hsl(${hue},70%,55%);opacity:${Math.max(0.2, 1 - i*0.08)}" title="Segment ${i+1}: ${Math.round(segPct)}%"></div>`;
      }).join('');
      return `<tr><td><strong style="font-size:.82rem">${esc(ep.title)}</strong></td>
        <td><div class="pod-retention-bar">${segHtml}</div></td>
        <td style="font-size:.82rem">${ep.avg_listen_pct}% avg</td></tr>`;
    }).join('');
    const recentRows = recentListens.map(l => `<tr><td>${esc(l.episode_title)}</td><td>${esc(l.channel_name)}</td><td>${fmtDuration(l.listened_sec)}</td>
      <td>${l.completed?'✅':'⏸️'}</td><td>${fmtDate(l.listened_at)}</td></tr>`).join('');
    const body = `<div class="pod-header"><h1>📊 Listening Analytics</h1><a href="/school/podcast/" class="pod-btn pod-btn-secondary">← Dashboard</a></div>
      <div class="pod-stats">
        <div class="pod-stat-card"><div class="pod-stat-num">${Number(total_plays).toLocaleString()}</div><div class="pod-stat-label">Total Plays</div></div>
        <div class="pod-stat-card"><div class="pod-stat-num">${completionRate}%</div><div class="pod-stat-label">Completion Rate</div></div>
        <div class="pod-stat-card"><div class="pod-stat-num">${total_listeners}</div><div class="pod-stat-label">Unique Listeners</div></div>
        <div class="pod-stat-card"><div class="pod-stat-num">${total_episodes}</div><div class="pod-stat-label">Published Episodes</div></div>
      </div>
      <div class="pod-layout">
        <div class="pod-main">
          <div class="pod-card" style="margin-bottom:20px"><div style="padding:16px">
            <h3 style="margin:0 0 12px;font-size:1rem">🔥 Most Popular Episodes</h3>
            <table class="pod-table"><thead><tr><th>Title</th><th>Channel</th><th>Plays</th><th>Completes</th><th>Avg Listen</th></tr></thead>
            <tbody>${topRows||'<tr><td colspan="5" style="text-align:center;color:var(--pod-text-dim)">No data</td></tr>'}</tbody></table>
          </div></div>
          <div class="pod-card"><div style="padding:16px">
            <h3 style="margin:0 0 12px;font-size:1rem">📉 Listener Retention</h3>
            <table class="pod-table"><thead><tr><th>Episode</th><th>Retention</th><th>Avg %</th></tr></thead>
            <tbody>${retentionRows||'<tr><td colspan="3" style="text-align:center;color:var(--pod-text-dim)">No data</td></tr>'}</tbody></table>
          </div></div>
        </div>
        <div class="pod-sidebar">
          <div class="pod-card" style="margin-bottom:16px"><div style="padding:16px">
            <h3 style="margin:0 0 12px;font-size:.95rem">🌍 Listener Geography (Simulated)</h3>
            <div style="font-size:.82rem;color:var(--pod-text-dim)">
              ${['Campus Network — 62%','City Region — 18%','Other Regions — 12%','International — 8%'].map(l => `<div style="padding:6px 0;border-bottom:1px solid var(--pod-border)">${l}</div>`).join('')}
            </div>
          </div></div>
          <div class="pod-card"><div style="padding:16px">
            <h3 style="margin:0 0 12px;font-size:.95rem">🕐 Recent Listens</h3>
            <table class="pod-table"><thead><tr><th>Episode</th><th>Duration</th><th>Done</th></tr></thead>
            <tbody>${recentRows||'<tr><td colspan="4" style="text-align:center;color:var(--pod-text-dim)">No listens yet</td></tr>'}</tbody></table>
          </div></div>
        </div>
      </div>`;
    res.send(renderPage('podcast-analytics', pageWrap('Listening Analytics', body), req));
  }));

  // ─── 8. COMMENTS & REVIEWS ───────────────────────────────────────────
  app.post(PFX + '/episodes/:id/comments', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { comment_text, rating, parent_id } = req.body;
    const userName = req.session.user.name || req.session.user.email || 'Anonymous';
    const userRole = role(req);
    await pool.query(
      `INSERT INTO podcast_comments (tenant_id,episode_id,user_id,user_name,user_role,comment_text,rating,parent_id) VALUES (?,?,?,?,?,?,?,?)`,
      [t, req.params.id, uid(req), userName, userRole, comment_text, parseInt(rating)||0, parseInt(parent_id)||0]
    );
    if (parseInt(rating) > 0) {
      await pool.query(
        `UPDATE podcast_episodes SET rating_avg=(SELECT AVG(rating) FROM podcast_comments WHERE episode_id=? AND tenant_id=? AND rating>0), rating_count=(SELECT COUNT(*) FROM podcast_comments WHERE episode_id=? AND tenant_id=? AND rating>0) WHERE id=? AND tenant_id=?`,
        [req.params.id, t, req.params.id, t, req.params.id, t]
      );
    }
    audit(req, 'podcast_comment', { episode_id: req.params.id });
    res.redirect(PFX + '/episodes/' + req.params.id);
  }));

  app.get(PFX + '/comments/moderate', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const [comments] = await pool.query(
      `SELECT pc.*, e.title AS episode_title FROM podcast_comments pc JOIN podcast_episodes e ON e.id=pc.episode_id
       WHERE pc.tenant_id=? ORDER BY pc.is_approved ASC, pc.created_at DESC LIMIT 50`, [t]
    );
    const rows = comments.map(c => `<tr>
      <td><strong>${esc(c.user_name)}</strong> <span class="pod-chip">${esc(c.user_role)}</span></td>
      <td>${esc(c.episode_title)}</td><td style="max-width:250px">${esc(c.comment_text).slice(0,80)}...</td>
      <td>${c.rating ? `<span class="pod-stars">${'★'.repeat(c.rating)}</span>` : '—'}</td>
      <td><span class="pod-badge ${c.is_approved?'pod-badge-pub':'pod-badge-draft'}">${c.is_approved?'Approved':'Pending'}</span></td>
      <td>${c.is_featured?'⭐':''} <a href="/school/podcast/comments/${c.id}/feature" class="pod-btn pod-btn-sm pod-btn-secondary">${c.is_featured?'Unfeature':'Feature'}</a>
        ${!c.is_approved?`<a href="/school/podcast/comments/${c.id}/approve" class="pod-btn pod-btn-sm pod-btn-accent">Approve</a>`:''}
        <a href="/school/podcast/comments/${c.id}/delete" class="pod-btn pod-btn-sm pod-btn-danger">Delete</a>
      </td></tr>`).join('');
    const body = `<div class="pod-header"><h1>💬 Comment Moderation</h1><a href="/school/podcast/" class="pod-btn pod-btn-secondary">← Dashboard</a></div>
      <div class="pod-card"><div style="padding:16px">
        <table class="pod-table"><thead><tr><th>User</th><th>Episode</th><th>Comment</th><th>Rating</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="6" style="text-align:center;color:var(--pod-text-dim)">No comments</td></tr>'}</tbody></table>
      </div></div>`;
    res.send(renderPage('podcast-moderate', pageWrap('Comment Moderation', body), req));
  }));

  app.get(PFX + '/comments/:id/approve', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    await pool.query(`UPDATE podcast_comments SET is_approved=1 WHERE id=? AND tenant_id=?`, [req.params.id, tid(req)]);
    res.redirect(PFX + '/comments/moderate');
  }));

  app.get(PFX + '/comments/:id/feature', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    await pool.query(`UPDATE podcast_comments SET is_featured=IF(is_featured=1,0,1) WHERE id=? AND tenant_id=?`, [req.params.id, tid(req)]);
    res.redirect(PFX + '/comments/moderate');
  }));

  app.get(PFX + '/comments/:id/delete', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const [cmts] = await pool.query(`SELECT episode_id FROM podcast_comments WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    await pool.query(`DELETE FROM podcast_comments WHERE id=? AND tenant_id=?`, [req.params.id, t]);
    if (cmts[0]) {
      const epId = cmts[0].episode_id;
      await pool.query(
        `UPDATE podcast_episodes SET rating_avg=(SELECT AVG(rating) FROM podcast_comments WHERE episode_id=? AND tenant_id=? AND rating>0), rating_count=(SELECT COUNT(*) FROM podcast_comments WHERE episode_id=? AND tenant_id=? AND rating>0) WHERE id=? AND tenant_id=?`,
        [epId, t, epId, t, epId, t]
      );
    }
    res.redirect(PFX + '/comments/moderate');
  }));

  // ─── 9. SEARCH ───────────────────────────────────────────────────────
  app.get(PFX + '/search', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const q = (req.query.q || '').trim();
    const channelFilter = req.query.channel || '';
    const tagFilter = req.query.tag || '';
    const [chs] = await pool.query(`SELECT id,name FROM podcast_channels WHERE tenant_id=? ORDER BY name`, [t]);
    const channelOpts = chs.map(c => `<option value="${c.id}" ${c.id==channelFilter?'selected':''}>${esc(c.name)}</option>`).join('');
    let results = [];
    if (q) {
      let sql = `SELECT e.*, c.name AS channel_name, c.cover_url FROM podcast_episodes e JOIN podcast_channels c ON c.id=e.channel_id
                 WHERE e.tenant_id=? AND e.status='published' AND (e.title LIKE ? OR e.description LIKE ? OR e.show_notes LIKE ? OR e.tags LIKE ?)`;
      const params = [t, `%${q}%`, `%${q}%`, `%${q}%`, `%${q}%`];
      if (channelFilter) { sql += ` AND e.channel_id=?`; params.push(channelFilter); }
      if (tagFilter) { sql += ` AND e.tags LIKE ?`; params.push(`%${tagFilter}%`); }
      sql += ` ORDER BY e.published_at DESC LIMIT 50`;
      [results] = await pool.query(sql, params);
    }
    const resultCards = results.map(ep => `<div class="pod-card">
      <div class="pod-card-img" style="${ep.cover_url?'background:url('+esc(ep.cover_url)+') center/cover':'background:linear-gradient(135deg,#1a1a2e,#06d6a0)'}">
        <div class="pod-play-overlay"><button class="pod-play-btn" onclick="POD.play('${esc(ep.audio_url)}',${ep.id},'${esc(ep.title)}',${ep.duration_sec})">▶</button></div>
      </div>
      <div class="pod-card-body">
        <div class="pod-card-title">${esc(ep.title)}</div>
        <div class="pod-card-meta">${esc(ep.channel_name)} · ${fmtDate(ep.published_at)} · ${fmtDuration(ep.duration_sec)}</div>
        <p style="font-size:.8rem;color:var(--pod-text-dim);margin:4px 0 0">${esc(ep.description||'').slice(0,100)}</p>
        <a href="/school/podcast/episodes/${ep.id}" class="pod-btn pod-btn-secondary pod-btn-sm" style="margin-top:6px">View</a>
      </div></div>`).join('');
    const body = `<div class="pod-header"><h1>🔍 Search Podcasts</h1><a href="/school/podcast/" class="pod-btn pod-btn-secondary">← Dashboard</a></div>
      <form method="GET" class="pod-filter-bar">
        <div class="pod-search-wrap"><span class="pod-search-icon">🔍</span><input class="pod-search-input" name="q" value="${esc(q)}" placeholder="Search episodes, show notes, tags..."></div>
        <select class="pod-select" name="channel" style="width:200px"><option value="">All Channels</option>${channelOpts}</select>
        <input class="pod-input" name="tag" value="${esc(tagFilter)}" placeholder="Filter by tag" style="width:160px">
        <button type="submit" class="pod-btn pod-btn-primary">Search</button>
      </form>
      ${q ? `<p style="color:var(--pod-text-dim);font-size:.85rem;margin-bottom:16px">${results.length} result${results.length!==1?'s':''} for "${esc(q)}"</p>` : ''}
      <div class="pod-grid pod-grid-3">${resultCards||'<div class="pod-empty"><div style="font-size:2rem;margin-bottom:8px">🎧</div>Search for episodes, topics, or tags</div>'}</div>`;
    res.send(renderPage('podcast-search', pageWrap('Search Podcasts', body), req));
  }));

  // ─── 10. SUBSCRIPTIONS ───────────────────────────────────────────────
  app.post(PFX + '/subscribe', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { channel_id } = req.body;
    if (!channel_id) return res.redirect('back');
    try {
      await pool.query(`INSERT IGNORE INTO podcast_subscriptions (tenant_id,user_id,channel_id) VALUES (?,?,?)`, [t, uid(req), channel_id]);
    } catch(e) { /* already subscribed */ }
    audit(req, 'podcast_subscribe', { channel_id });
    res.redirect('back');
  }));

  app.post(PFX + '/unsubscribe', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { channel_id } = req.body;
    await pool.query(`DELETE FROM podcast_subscriptions WHERE tenant_id=? AND user_id=? AND channel_id=?`, [t, uid(req), channel_id]);
    audit(req, 'podcast_unsubscribe', { channel_id });
    res.redirect(PFX + '/subscriptions');
  }));

  app.get(PFX + '/subscriptions', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);
    const [subs] = await pool.query(
      `SELECT s.*, c.name, c.description, c.cover_url, c.category,
        (SELECT COUNT(*) FROM podcast_episodes WHERE channel_id=s.channel_id AND status='published') AS ep_count,
        (SELECT MAX(published_at) FROM podcast_episodes WHERE channel_id=s.channel_id AND status='published') AS latest_ep
       FROM podcast_subscriptions s JOIN podcast_channels c ON c.id=s.channel_id
       WHERE s.tenant_id=? AND s.user_id=? ORDER BY s.subscribed_at DESC`, [t, userId]
    );
    const [history] = await pool.query(
      `SELECT l.*, e.title, c.name AS channel_name, c.cover_url
       FROM podcast_listens l JOIN podcast_episodes e ON e.id=l.episode_id JOIN podcast_channels c ON c.id=e.channel_id
       WHERE l.tenant_id=? AND l.user_id=? ORDER BY l.listened_at DESC LIMIT 30`, [t, userId]
    );
    const subCards = subs.map(s => `<div class="pod-card" style="padding:14px;display:flex;gap:14px;align-items:center">
      <div style="width:56px;height:56px;border-radius:10px;flex-shrink:0;${s.cover_url?'background:url('+esc(s.cover_url)+') center/cover':'background:linear-gradient(135deg,#7c3aed,#06d6a0)'}"></div>
      <div style="flex:1;min-width:0"><strong>${esc(s.name)}</strong><div class="pod-card-meta">${s.ep_count} episodes · ${s.latest_ep?'Latest: '+fmtDate(s.latest_ep):'No episodes'}</div></div>
      <div style="display:flex;flex-direction:column;gap:4px">
        <a href="/school/podcast/channels/${s.channel_id}" class="pod-btn pod-btn-sm pod-btn-secondary">View</a>
        <form method="POST" action="/school/podcast/unsubscribe"><input type="hidden" name="channel_id" value="${s.channel_id}"><button class="pod-btn pod-btn-sm pod-btn-danger">Unsub</button></form>
      </div></div>`).join('');
    const histRows = history.map(h => `<tr>
      <td><strong style="font-size:.82rem">${esc(h.title)}</strong></td><td>${esc(h.channel_name)}</td>
      <td>${fmtDuration(h.listened_sec)}</td><td>${h.completed?'✅':'⏸️'}</td><td style="font-size:.78rem">${fmtDate(h.listened_at)}</td></tr>`).join('');
    const body = `<div class="pod-header"><h1>📋 My Subscriptions</h1><a href="/school/podcast/" class="pod-btn pod-btn-secondary">← Dashboard</a></div>
      <div class="pod-tabs"><a class="pod-tab active" href="#subscribed" onclick="document.getElementById('tab-sub').style.display='block';document.getElementById('tab-hist').style.display='none';this.classList.add('active');this.nextElementSibling.classList.remove('active')">Subscribed (${subs.length})</a>
        <a class="pod-tab" href="#history" onclick="document.getElementById('tab-hist').style.display='block';document.getElementById('tab-sub').style.display='none';this.classList.add('active');this.previousElementSibling.classList.remove('active')">History</a></div>
      <div id="tab-sub">${subCards||'<div class="pod-empty"><div style="font-size:2rem;margin-bottom:8px">📻</div>Subscribe to channels to get updates</div>'}</div>
      <div id="tab-hist" style="display:none">
        <div class="pod-card"><div style="padding:16px">
          <table class="pod-table"><thead><tr><th>Episode</th><th>Channel</th><th>Listened</th><th>Done</th><th>Date</th></tr></thead>
          <tbody>${histRows||'<tr><td colspan="5" style="text-align:center;color:var(--pod-text-dim)">No listening history</td></tr>'}</tbody></table>
        </div></div>
      </div>`;
    res.send(renderPage('podcast-subscriptions', pageWrap('My Subscriptions', body), req));
  }));

  // ─── LISTEN TRACKING API ─────────────────────────────────────────────
  app.post(PFX + '/api/listen/start', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { episode_id } = req.body;
    if (!episode_id) return res.json({ok:false});
    await pool.query(
      `INSERT INTO podcast_listens (tenant_id,episode_id,user_id,ip_address,user_agent) VALUES (?,?,?,?,?)`,
      [t, episode_id, uid(req), req.ip||'', req.get('User-Agent')||'']
    );
    await pool.query(`UPDATE podcast_episodes SET play_count=play_count+1 WHERE id=? AND tenant_id=?`, [episode_id, t]);
    res.json({ok:true});
  }));

  app.post(PFX + '/api/listen/complete', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const { episode_id } = req.body;
    if (!episode_id) return res.json({ok:false});
    const ep = await pool.query(`SELECT duration_sec FROM podcast_episodes WHERE id=? AND tenant_id=?`, [episode_id, t]);
    const dur = ep[0]?.[0]?.duration_sec || 0;
    await pool.query(
      `UPDATE podcast_listens SET completed=1, listened_sec=?, pct_completed=100 WHERE episode_id=? AND user_id=? AND tenant_id=? AND completed=0 ORDER BY id DESC LIMIT 1`,
      [dur, episode_id, uid(req), t]
    );
    await pool.query(
      `UPDATE podcast_episodes SET complete_count=complete_count+1,
        avg_listen_pct=(SELECT AVG(pct_completed) FROM podcast_listens WHERE episode_id=? AND tenant_id=? AND completed=1)
       WHERE id=? AND tenant_id=?`,
      [episode_id, episode_id, t, episode_id, t]
    );
    res.json({ok:true});
  }));

  // ─── NOTIFICATIONS: check subscribed channels for new episodes ───────
  app.get(PFX + '/notifications', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const userId = uid(req);
    const [notifs] = await pool.query(
      `SELECT e.*, c.name AS channel_name, c.cover_url, s.subscribed_at
       FROM podcast_subscriptions s
       JOIN podcast_episodes e ON e.channel_id=s.channel_id AND e.status='published'
       JOIN podcast_channels c ON c.id=e.channel_id
       WHERE s.tenant_id=? AND s.user_id=? AND e.published_at > s.subscribed_at
       ORDER BY e.published_at DESC LIMIT 20`, [t, userId]
    );
    let items = notifs.map(n => `<div class="pod-card" style="padding:12px;margin-bottom:8px;display:flex;gap:12px;align-items:center">
      <div style="width:48px;height:48px;border-radius:8px;flex-shrink:0;${n.cover_url?'background:url('+esc(n.cover_url)+') center/cover':'background:linear-gradient(135deg,#7c3aed,#06d6a0)'}"></div>
      <div style="flex:1"><div style="font-size:.82rem"><strong>${esc(n.channel_name)}</strong> published a new episode</div>
        <div style="font-weight:600;font-size:.88rem">${esc(n.title)}</div><div class="pod-card-meta">${fmtDate(n.published_at)}</div></div>
      <button class="pod-play-btn" style="width:40px;height:40px;font-size:14px" onclick="POD.play('${esc(n.audio_url)}',${n.id},'${esc(n.title)}',${n.duration_sec})">▶</button>
    </div>`).join('');
    const body = `<div class="pod-header"><h1>🔔 New Episodes</h1><a href="/school/podcast/" class="pod-btn pod-btn-secondary">← Dashboard</a></div>
      ${items||'<div class="pod-empty"><div style="font-size:2rem;margin-bottom:8px">🔔</div>No new episodes from your subscriptions</div>'}`;
    res.send(renderPage('podcast-notifications', pageWrap('Notifications', body), req));
  }));

  // ─── CHANNEL MANAGEMENT: All episodes (teacher admin) ────────────────
  app.get(PFX + '/manage/episodes', requireAuth, ah(async (req, res) => {
    if (!isTeacher(req)) return res.redirect(PFX + '/');
    const t = tid(req);
    const statusFilter = req.query.status || '';
    const channelFilter = req.query.channel || '';
    const [chs] = await pool.query(`SELECT id,name FROM podcast_channels WHERE tenant_id=? ORDER BY name`, [t]);
    let sql = `SELECT e.*, c.name AS channel_name FROM podcast_episodes e JOIN podcast_channels c ON c.id=e.channel_id WHERE e.tenant_id=?`;
    const params = [t];
    if (statusFilter) { sql += ` AND e.status=?`; params.push(statusFilter); }
    if (channelFilter) { sql += ` AND e.channel_id=?`; params.push(channelFilter); }
    sql += ` ORDER BY e.updated_at DESC LIMIT 100`;
    const [eps] = await pool.query(sql, params);
    const channelOpts = chs.map(c => `<option value="${c.id}" ${c.id==channelFilter?'selected':''}>${esc(c.name)}</option>`).join('');
    const rows = eps.map(ep => `<tr>
      <td><strong>${esc(ep.title)}</strong></td><td>${esc(ep.channel_name)}</td>
      <td><span class="pod-badge ${ep.status==='published'?'pod-badge-pub':ep.status==='draft'?'pod-badge-draft':'pod-badge-sched'}">${ep.status}</span></td>
      <td>S${ep.season_number||1}E${ep.episode_number||'?'}</td>
      <td>${Number(ep.play_count).toLocaleString()}</td>
      <td>${ep.featured?'⭐':''}</td>
      <td><a href="/school/podcast/episodes/${ep.id}/edit" class="pod-btn pod-btn-sm pod-btn-secondary">Edit</a></td>
    </tr>`).join('');
    const body = `<div class="pod-header"><h1>📋 Manage Episodes</h1><a href="/school/podcast/" class="pod-btn pod-btn-secondary">← Dashboard</a></div>
      <form method="GET" class="pod-filter-bar">
        <select class="pod-select" name="channel" style="width:200px"><option value="">All Channels</option>${channelOpts}</select>
        <select class="pod-select" name="status" style="width:160px">
          <option value="">All Status</option><option value="draft" ${statusFilter==='draft'?'selected':''}>Draft</option>
          <option value="scheduled" ${statusFilter==='scheduled'?'selected':''}>Scheduled</option>
          <option value="published" ${statusFilter==='published'?'selected':''}>Published</option>
          <option value="archived" ${statusFilter==='archived'?'selected':''}>Archived</option>
        </select>
        <button type="submit" class="pod-btn pod-btn-primary">Filter</button>
      </form>
      <div class="pod-card"><div style="padding:16px;overflow-x:auto">
        <table class="pod-table"><thead><tr><th>Title</th><th>Channel</th><th>Status</th><th>Season/Ep</th><th>Plays</th><th>Featured</th><th>Actions</th></tr></thead>
        <tbody>${rows||'<tr><td colspan="7" style="text-align:center;color:var(--pod-text-dim)">No episodes</td></tr>'}</tbody></table>
      </div></div>`;
    res.send(renderPage('podcast-manage-episodes', pageWrap('Manage Episodes', body), req));
  }));

  // ─── INIT ────────────────────────────────────────────────────────────
  ensureTables().then(() => {
    console.log('[campus-podcast] Tables ready');
  }).catch(e => {
    console.error('[campus-podcast] Table init error:', e.message);
  });
};
