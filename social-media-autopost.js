/**
 * Social Media Auto-Post Module for School SaaS Portal
 * Manages social accounts, post composing, scheduling, templates,
 * approvals, analytics, auto-post rules, hashtags, and history.
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  /* ───────── helpers ───────── */
  const TID = req => req.session?.user?.tenant_id || 0;
  const now = () => new Date().toISOString().slice(0,19).replace('T',' ');
  const simpleEncrypt = (txt, key) => {
    if (!txt) return '';
    let r = '';
    for (let i = 0; i < txt.length; i++) r += String.fromCharCode(txt.charCodeAt(i) ^ (key || 'smk2024').charCodeAt(i % (key||'smk2024').length));
    return Buffer.from(r, 'binary').toString('base64');
  };
  const simpleDecrypt = (b64, key) => {
    if (!b64) return '';
    try {
      const buf = Buffer.from(b64, 'base64').toString('binary');
      let r = '';
      for (let i = 0; i < buf.length; i++) r += String.fromCharCode(buf.charCodeAt(i) ^ (key || 'smk2024').charCodeAt(i % (key||'smk2024').length));
      return r;
    } catch(e) { return ''; }
  };
  const PLATFORMS = ['facebook','twitter','instagram','linkedin'];
  const PLATFORM_COLORS = { facebook:'#1877F2', twitter:'#000000', instagram:'#E4405F', linkedin:'#0A66C2' };
  const PLATFORM_LABELS = { facebook:'Facebook', twitter:'Twitter / X', instagram:'Instagram', linkedin:'LinkedIn' };
  const PLATFORM_ICONS = { facebook:'f', twitter:'𝕏', instagram:'📷', linkedin:'in' };
  const STATUS_COLORS = { draft:'#6c757d', scheduled:'#ffc107', published:'#28a745', failed:'#dc3545', pending:'#17a2b8' };
  const platformBadge = p => `<span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${PLATFORM_COLORS[p]||'#999'};color:#fff;text-align:center;line-height:22px;font-size:11px;font-weight:700;margin-right:3px" title="${PLATFORM_LABELS[p]||p}">${PLATFORM_ICONS[p]||p[0]}</span>`;
  const statusBadge = s => `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${STATUS_COLORS[s]||'#999'}22;color:${STATUS_COLORS[s]||'#999'};border:1px solid ${STATUS_COLORS[s]||'#999'}44">${s}</span>`;

  /* ───────── CSS shared ───────── */
  const CSS = `
    .sm-wrap{font-family:'Segoe UI',system-ui,sans-serif;max-width:1280px;margin:0 auto;padding:24px;color:#1e293b}
    .sm-card{background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:24px;margin-bottom:20px}
    .sm-card h2{margin:0 0 16px;font-size:18px;font-weight:700;color:#0f172a}
    .sm-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px}
    .sm-stat{text-align:center;padding:20px;border-radius:10px;background:linear-gradient(135deg,#f0f9ff,#e0f2fe)}
    .sm-stat .num{font-size:32px;font-weight:800;color:#0284c7}
    .sm-stat .lbl{font-size:13px;color:#64748b;margin-top:4px}
    .sm-btn{display:inline-block;padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;border:none;text-decoration:none;transition:.15s}
    .sm-btn-primary{background:#0284c7;color:#fff}.sm-btn-primary:hover{background:#0369a1}
    .sm-btn-success{background:#16a34a;color:#fff}.sm-btn-success:hover{background:#15803d}
    .sm-btn-danger{background:#dc2626;color:#fff}.sm-btn-danger:hover{background:#b91c1c}
    .sm-btn-warning{background:#d97706;color:#fff}.sm-btn-warning:hover{background:#b45309}
    .sm-btn-sm{padding:5px 12px;font-size:12px;border-radius:6px}
    .sm-table{width:100%;border-collapse:collapse;font-size:14px}
    .sm-table th{background:#f1f5f9;text-align:left;padding:10px 12px;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.5px;color:#475569;border-bottom:2px solid #e2e8f0}
    .sm-table td{padding:10px 12px;border-bottom:1px solid #f1f5f9}
    .sm-table tr:hover td{background:#f8fafc}
    .sm-input,.sm-select,.sm-textarea{width:100%;padding:9px 14px;border:1.5px solid #cbd5e1;border-radius:8px;font-size:14px;font-family:inherit;transition:border .15s;box-sizing:border-box}
    .sm-input:focus,.sm-select:focus,.sm-textarea:focus{outline:none;border-color:#0284c7;box-shadow:0 0 0 3px #0284c720}
    .sm-textarea{min-height:120px;resize:vertical}
    .sm-label{display:block;margin-bottom:6px;font-size:13px;font-weight:600;color:#334155}
    .sm-form-group{margin-bottom:16px}
    .sm-tabs{display:flex;gap:0;border-bottom:2px solid #e2e8f0;margin-bottom:20px}
    .sm-tab{padding:10px 20px;cursor:pointer;font-size:14px;font-weight:600;color:#64748b;border-bottom:2px solid transparent;margin-bottom:-2px;transition:.15s}
    .sm-tab:hover,.sm-tab.active{color:#0284c7;border-bottom-color:#0284c7}
    .sm-badge{display:inline-block;padding:2px 8px;border-radius:10px;font-size:11px;font-weight:700}
    .sm-flex{display:flex;gap:12px;align-items:center;flex-wrap:wrap}
    .sm-flex-between{display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px}
    .sm-avatar{width:36px;height:36px;border-radius:50%;object-fit:cover}
    .sm-empty{text-align:center;padding:40px;color:#94a3b8;font-size:15px}
    .sm-empty .icon{font-size:48px;margin-bottom:12px}
    .sm-calendar-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:1px;background:#e2e8f0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden}
    .sm-cal-head{background:#f1f5f9;padding:8px;text-align:center;font-size:12px;font-weight:700;color:#475569}
    .sm-cal-cell{background:#fff;padding:6px;min-height:80px;font-size:12px;vertical-align:top;cursor:pointer;transition:background .1s}
    .sm-cal-cell:hover{background:#f8fafc}
    .sm-cal-cell.today{background:#f0f9ff}
    .sm-cal-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin:1px}
    .sm-chart-bar{display:flex;align-items:flex-end;gap:6px;height:160px;padding:10px 0}
    .sm-chart-bar .bar{flex:1;border-radius:4px 4px 0 0;transition:height .3s;min-width:20px;position:relative}
    .sm-chart-bar .bar:hover{opacity:.85}
    .sm-chart-bar .bar-label{position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:10px;color:#64748b;white-space:nowrap}
    .sm-progress{height:8px;background:#e2e8f0;border-radius:4px;overflow:hidden}
    .sm-progress-fill{height:100%;border-radius:4px;transition:width .3s}
    .sm-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:16px;font-size:12px;background:#f1f5f9;color:#475569;margin:2px}
    .sm-chip.active{background:#0284c720;color:#0284c7}
    .sm-switch{position:relative;width:44px;height:24px;display:inline-block}
    .sm-switch input{opacity:0;width:0;height:0}
    .sm-switch .slider{position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:#cbd5e1;border-radius:12px;transition:.2s}
    .sm-switch .slider:before{content:'';position:absolute;width:18px;height:18px;border-radius:50%;background:#fff;left:3px;top:3px;transition:.2s}
    .sm-switch input:checked+.slider{background:#0284c7}
    .sm-switch input:checked+.slider:before{transform:translateX(20px)}
    .sm-char-count{font-size:12px;color:#64748b;margin-top:4px}
    .sm-char-count.over{color:#dc2626;font-weight:700}
    .sm-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:1000}
    .sm-modal{background:#fff;border-radius:12px;padding:28px;max-width:520px;width:90%;max-height:80vh;overflow-y:auto;box-shadow:0 20px 60px rgba(0,0,0,.15)}
    .sm-modal h3{margin:0 0 16px;font-size:18px}
    .sm-emoji-grid{display:grid;grid-template-columns:repeat(12,1fr);gap:2px;max-height:200px;overflow-y:auto;padding:8px;background:#f8fafc;border-radius:8px;margin-top:8px}
    .sm-emoji-btn{font-size:20px;cursor:pointer;padding:4px;border-radius:4px;border:none;background:none;text-align:center}
    .sm-emoji-btn:hover{background:#e2e8f0}
  `;

  /* ───────── Database Tables ───────── */
  async function initTables() {
    await pool.query(`CREATE TABLE IF NOT EXISTS social_accounts (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      platform VARCHAR(50) NOT NULL,
      account_name VARCHAR(200),
      access_token_encrypted TEXT,
      refresh_token_encrypted TEXT,
      profile_url VARCHAR(500),
      avatar_url VARCHAR(500),
      is_active BOOLEAN DEFAULT true,
      connected_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      last_used TIMESTAMPTZ)
    `);

    await pool.query(`CREATE TABLE IF NOT EXISTS social_posts (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      account_id INT DEFAULT NULL,
      title VARCHAR(300),
      content TEXT,
      media_urls JSONB,
      platforms JSONB,
      status TEXT DEFAULT 'draft',
      scheduled_at TIMESTAMPTZ,
      published_at TIMESTAMPTZ,
      priority INT DEFAULT 0,
      approval_status TEXT DEFAULT 'none',
      approved_by INT DEFAULT NULL,
      rejection_reason TEXT,
      performance_data JSONB,
      timezone VARCHAR(50) DEFAULT 'UTC',
      created_by INT DEFAULT NULL,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
    `);

    await pool.query(`CREATE TABLE IF NOT EXISTS post_templates (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      name VARCHAR(200) NOT NULL,
      category VARCHAR(100),
      content_template TEXT,
      media_placeholder VARCHAR(500),
      platforms JSONB,
      hashtags JSONB,
      is_system BOOLEAN DEFAULT false,
      usage_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
    `);

    await pool.query(`CREATE TABLE IF NOT EXISTS social_post_rules (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      rule_name VARCHAR(200),
      trigger_type VARCHAR(100) NOT NULL,
      trigger_config JSONB,
      template_id INT DEFAULT NULL,
      platforms JSONB,
      is_active BOOLEAN DEFAULT true,
      last_triggered TIMESTAMPTZ,
      run_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
    `);

    await pool.query(`CREATE TABLE IF NOT EXISTS social_hashtags (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      tag VARCHAR(200) NOT NULL,
      category VARCHAR(100),
      usage_count INT DEFAULT 0,
      is_trending BOOLEAN DEFAULT false,
      trend_score DECIMAL(5,2) DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uk_tag_tenant UNIQUE (tenant_id, tag)
    `);

    await pool.query(`CREATE TABLE IF NOT EXISTS post_approvals (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      post_id INT NOT NULL,
      approver_id INT,
      status TEXT DEFAULT 'pending',
      comments TEXT,
      decided_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
    `);

    // Seed system templates
    const { rows } = await pool.query(`SELECT COUNT(*) as c FROM post_templates WHERE tenant_id=0 AND is_system=true`);
    if (rows[0].c === 0) {
      const sysTemplates = [
        { name: 'Exam Results Announcement', category: 'academics', content_template: '🎓 Proud to announce our outstanding exam results!\n\n🏆 Topper: {{topper_name}} — {{score}}%\n📊 Class Average: {{class_avg}}%\n💡 Students scoring above 90%: {{distinction_count}}\n\nCongratulations to all our brilliant students! Keep shining! ✨', platforms: JSON.stringify(['facebook','twitter','instagram','linkedin']), hashtags: JSON.stringify(['#ExamResults','#ProudSchool','#StudentSuccess','#AcademicExcellence']) },
        { name: 'Event Announcement', category: 'events', content_template: '🎪 Exciting Event Alert!\n\n📢 {{event_name}}\n📅 Date: {{event_date}}\n📍 Venue: {{venue}}\n⏰ Time: {{event_time}}\n\nAll students, parents, and staff are warmly invited. Join us for a memorable experience!\n\nFor details, contact: {{contact}}', platforms: JSON.stringify(['facebook','twitter','instagram']), hashtags: JSON.stringify(['#SchoolEvent','#JoinUs','#SchoolLife','#Community']) },
        { name: 'Holiday Notice', category: 'holidays', content_template: '🏖️ Holiday Notice\n\nDear Parents & Students,\n\nSchool will remain closed from {{start_date}} to {{end_date}} on account of {{holiday_name}}.\n\nSchool resumes on {{reopen_date}}.\n\nWishing everyone a safe and happy holiday! 🎉', platforms: JSON.stringify(['facebook','twitter','instagram','linkedin']), hashtags: JSON.stringify(['#HolidayNotice','#SchoolHoliday','#StaySafe']) },
        { name: 'Sports Victory', category: 'sports', content_template: '🏅 CHAMPIONS! 🏆\n\nOur school team secured {{position}} place in {{tournament_name}}!\n\n🔥 Highlights:\n• {{highlight_1}}\n• {{highlight_2}}\n• {{highlight_3}}\n\nCongratulations to our champions and their coach {{coach_name}}! You make us proud! 💪', platforms: JSON.stringify(['facebook','twitter','instagram','linkedin']), hashtags: JSON.stringify(['#Champions','#SchoolSports','#Victory','#ProudSchool','#SportsDay']) },
        { name: 'Admissions Open', category: 'admissions', content_template: '🏫 ADMISSIONS OPEN {{academic_year}}!\n\nEnroll your child at {{school_name}} for a world-class education experience.\n\n📋 Grades: {{grades_available}}\n📅 Last Date: {{last_date}}\n📞 Contact: {{contact_number}}\n🌐 Apply Online: {{website}}\n\nLimited seats available. Apply now! ✨', platforms: JSON.stringify(['facebook','twitter','instagram','linkedin']), hashtags: JSON.stringify(['#AdmissionsOpen','#EnrollNow','#Education','#SchoolAdmission','#FutureLeaders']) },
        { name: 'Weekly Achievement Digest', category: 'digest', content_template: '📊 Weekly Achievement Digest — {{week}}\n\n✅ {{achievement_count}} milestones this week\n\n🌟 Highlights:\n{{highlights_list}}\n\n📤 Upcoming: {{upcoming_events}}\n\n#MakingEveryWeekCount', platforms: JSON.stringify(['facebook','twitter','linkedin']), hashtags: JSON.stringify(['#WeeklyDigest','#SchoolAchievements','#Milestones','#ProudSchool']) },
        { name: 'Teacher Appreciation', category: 'staff', content_template: '🌟 Teacher Spotlight! 🌟\n\nCelebrating {{teacher_name}} — {{subject}} Department\n\n{{achievement_description}}\n\nThank you for inspiring our students every day! 🙏 #TeachersRock', platforms: JSON.stringify(['facebook','instagram','linkedin']), hashtags: JSON.stringify(['#TeacherAppreciation','#TeacherSpotlight','#InspiringEducators','#ThankATeacher']) },
        { name: 'Parent-Teacher Meeting', category: 'events', content_template: '🤝 Parent-Teacher Meeting\n\n📅 Date: {{date}}\n⏰ Time: {{time}}\n📍 Venue: {{venue}}\n\nWe cordially invite all parents to discuss their child\'s progress. Your involvement matters!\n\nPlease bring the progress report card. See you there! 📚', platforms: JSON.stringify(['facebook','twitter']), hashtags: JSON.stringify(['#PTM','#ParentTeacherMeeting','#SchoolCommunication']) },
      ];
      for (const t of sysTemplates) {
        await pool.query(`INSERT INTO post_templates (tenant_id,name,category,content_template,platforms,hashtags,is_system) VALUES (0,$1,$2,$3,$4,$5,true)`,
          [t.name, t.category, t.content_template, t.platforms, t.hashtags]);
      }
    }

    // Seed trending education hashtags
    const { rows: htagRows } = await pool.query(`SELECT COUNT(*) as c FROM social_hashtags WHERE tenant_id=0`);
    if (htagRows[0].c === 0) {
      const htags = [
        { tag:'#Education', category:'general', is_trending:true, trend_score:95 },
        { tag:'#SchoolLife', category:'school', is_trending:true, trend_score:88 },
        { tag:'#StudentSuccess', category:'achievement', is_trending:true, trend_score:82 },
        { tag:'#Learning', category:'general', is_trending:false, trend_score:78 },
        { tag:'#EdChat', category:'general', is_trending:true, trend_score:91 },
        { tag:'#FutureLeaders', category:'achievement', is_trending:false, trend_score:72 },
        { tag:'#TeachersOfInstagram', category:'staff', is_trending:true, trend_score:86 },
        { tag:'#BackToSchool', category:'seasonal', is_trending:false, trend_score:65 },
        { tag:'#STEM', category:'academics', is_trending:true, trend_score:84 },
        { tag:'#Classroom', category:'general', is_trending:false, trend_score:70 },
        { tag:'#ProudSchool', category:'school', is_trending:false, trend_score:76 },
        { tag:'#SchoolEvents', category:'events', is_trending:false, trend_score:68 },
        { tag:'#DigitalLearning', category:'general', is_trending:true, trend_score:80 },
        { tag:'#CodingInSchool', category:'academics', is_trending:true, trend_score:77 },
        { tag:'#Parenting', category:'general', is_trending:false, trend_score:73 },
      ];
      for (const h of htags) {
        await pool.query(`INSERT INTO social_hashtags (tenant_id,tag,category,usage_count,is_trending,trend_score) VALUES (0,$1,$2,0,$3,$4)`,
          [h.tag, h.category, h.is_trending, h.trend_score]);
      }
    }
  }

  initTables().catch(e => console.error('[social-media-autopost] init error:', e.message));

  /* ───────── Route: Dashboard ───────── */
  app.get('/school/social-media', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { rows: accounts } = await pool.query(`SELECT * FROM social_accounts WHERE tenant_id=$1 AND is_active=true`, [tid]);
    const { rows: upcoming } = await pool.query(`SELECT * FROM social_posts WHERE tenant_id=$1 AND status='scheduled' AND scheduled_at >= NOW() ORDER BY scheduled_at ASC LIMIT 10`, [tid]);
    const { rows: recent } = await pool.query(`SELECT * FROM social_posts WHERE tenant_id=$1 AND status='published' ORDER BY published_at DESC LIMIT 5`, [tid]);
    const { rows: [stats] } = await pool.query(`SELECT COUNT(*) as total, SUM(CASE WHEN status='published' THEN 1 ELSE 0 END) as published, SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) as scheduled, SUM(CASE WHEN status='draft' THEN 1 ELSE 0 END) as drafts, SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) as failed FROM social_posts WHERE tenant_id=$1`, [tid]);
    const { rows: pendingApprovals } = await pool.query(`SELECT COUNT(*) as c FROM social_posts WHERE tenant_id=$1 AND approval_status='pending'`, [tid]);
    const { rows: activeRules } = await pool.query(`SELECT COUNT(*) as c FROM social_post_rules WHERE tenant_id=$1 AND is_active=true`, [tid]);

    let upcomingHTML = '';
    if (upcoming.length === 0) {
      upcomingHTML = `<div class="sm-empty"><div class="icon">📅</div>No upcoming scheduled posts</div>`;
    } else {
      upcomingHTML = `<table class="sm-table"><thead><tr><th>Content</th><th>Platforms</th><th>Scheduled</th><th>Priority</th><th>Actions</th></tr></thead><tbody>`;
      for (const p of upcoming) {
        const platforms = JSON.parse(p.platforms || '[]');
        const prioColors = { 3:'#dc2626', 2:'#d97706', 1:'#0284c7', 0:'#64748b' };
        upcomingHTML += `<tr><td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((p.content||'').substring(0,80))}${(p.content||'').length>80?'...':''}</td>
          <td>${platforms.map(pl=>platformBadge(pl)).join('')}</td>
          <td style="white-space:nowrap">${p.scheduled_at ? new Date(p.scheduled_at).toLocaleString() : '-'}</td>
          <td><span style="color:${prioColors[p.priority]||'#64748b'};font-weight:700">${['Low','Normal','High','Urgent'][p.priority]||'Normal'}</span></td>
          <td><a href="/school/social-media/compose?edit=${p.id}" class="sm-btn sm-btn-sm sm-btn-primary">Edit</a>
            <form method="POST" action="/school/social-media/scheduled/${p.id}" style="display:inline" onsubmit="return confirm('Cancel this scheduled post?')"><input type="hidden" name="_method" value="DELETE"><button class="sm-btn sm-btn-sm sm-btn-danger">Cancel</button></form></td></tr>`;
      }
      upcomingHTML += `</tbody></table>`;
    }

    let recentHTML = '';
    if (recent.length === 0) {
      recentHTML = `<div class="sm-empty"><div class="icon">📤</div>No published posts yet</div>`;
    } else {
      recentHTML = `<table class="sm-table"><thead><tr><th>Content</th><th>Platforms</th><th>Published</th><th>Engagement</th></tr></thead><tbody>`;
      for (const p of recent) {
        const platforms = JSON.parse(p.platforms || '[]');
        const perf = JSON.parse(p.performance_data || '{}');
        const eng = ((perf.likes||0)+(perf.shares||0)+(perf.comments||0));
        recentHTML += `<tr><td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((p.content||'').substring(0,80))}${(p.content||'').length>80?'...':''}</td>
          <td>${platforms.map(pl=>platformBadge(pl)).join('')}</td>
          <td style="white-space:nowrap">${p.published_at ? new Date(p.published_at).toLocaleDateString() : '-'}</td>
          <td><strong>${eng}</strong> interactions</td></tr>`;
      }
      recentHTML += `</tbody></table>`;
    }

    const page = `<div class="sm-wrap">
      <div class="sm-flex-between" style="margin-bottom:24px">
        <h1 style="margin:0;font-size:24px">📱 Social Media Manager</h1>
        <div class="sm-flex">
          <a href="/school/social-media/compose" class="sm-btn sm-btn-primary">✏️ Compose Post</a>
          <a href="/school/social-media/calendar" class="sm-btn sm-btn-success">📅 Calendar</a>
          <a href="/school/social-media/analytics" class="sm-btn" style="background:#7c3aed;color:#fff">📊 Analytics</a>
        </div>
      </div>
      <div class="sm-grid">
        <div class="sm-card sm-stat"><div class="num">${stats.total}</div><div class="lbl">Total Posts</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7)"><div class="num" style="color:#16a34a">${stats.published}</div><div class="lbl">Published</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#fffbeb,#fef3c7)"><div class="num" style="color:#d97706">${stats.scheduled}</div><div class="lbl">Scheduled</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#fdf2f8,#fce7f3)"><div class="num" style="color:#db2777">${stats.drafts}</div><div class="lbl">Drafts</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#fef2f2,#fee2e2)"><div class="num" style="color:#dc2626">${stats.failed}</div><div class="lbl">Failed</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#eff6ff,#dbeafe)"><div class="num" style="color:#2563eb">${accounts.length}</div><div class="lbl">Connected Accounts</div></div>
      </div>
      ${pendingApprovals[0].c > 0 ? `<div class="sm-card" style="border-left:4px solid #d97706"><div class="sm-flex-between"><div><strong>⚠️ ${pendingApprovals[0].c} post(s) pending approval</strong></div><a href="/school/social-media/approvals" class="sm-btn sm-btn-warning sm-btn-sm">Review Now</a></div></div>` : ''}
      <div class="sm-grid" style="grid-template-columns:1fr 1fr">
        <div class="sm-card"><h2>📅 Upcoming Scheduled Posts</h2>${upcomingHTML}</div>
        <div class="sm-card"><h2>📤 Recently Published</h2>${recentHTML}</div>
      </div>
      <div class="sm-grid">
        <a href="/school/social-media/accounts" class="sm-card" style="text-decoration:none;color:inherit"><h2>🔗 Social Accounts (${accounts.length})</h2><p style="color:#64748b;margin:0">Manage connected Facebook, Twitter, Instagram, LinkedIn</p></a>
        <a href="/school/social-media/templates" class="sm-card" style="text-decoration:none;color:inherit"><h2>📋 Post Templates</h2><p style="color:#64748b;margin:0">Pre-built templates for common school posts</p></a>
        <a href="/school/social-media/rules" class="sm-card" style="text-decoration:none;color:inherit"><h2>🤖 Auto-Post Rules (${activeRules[0].c})</h2><p style="color:#64748b;margin:0">Configure automatic posting triggers</p></a>
        <a href="/school/social-media/hashtags" class="sm-card" style="text-decoration:none;color:inherit"><h2>#️⃣ Hashtag Manager</h2><p style="color:#64748b;margin:0">Manage school-specific & trending hashtags</p></a>
        <a href="/school/social-media/history" class="sm-card" style="text-decoration:none;color:inherit"><h2>📚 Post History</h2><p style="color:#64748b;margin:0">Archive of all published posts with metrics</p></a>
        <a href="/school/social-media/scheduled" class="sm-card" style="text-decoration:none;color:inherit"><h2>⏰ Scheduled Queue (${stats.scheduled})</h2><p style="color:#64748b;margin:0">Manage scheduled posts with priority</p></a>
      </div>
    </div>`;
    res.send(renderPage('Social Media Manager', page, req.session.user));
  }));

  /* ───────── Route: Social Accounts ───────── */
  app.get('/school/social-media/accounts', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { rows: accounts } = await pool.query(`SELECT * FROM social_accounts WHERE tenant_id=$1 ORDER BY platform, is_active DESC`, [tid]);

    let tableHTML = '';
    if (accounts.length === 0) {
      tableHTML = `<div class="sm-empty"><div class="icon">🔗</div>No social accounts connected yet.<br><br>Connect your first account to start posting!</div>`;
    } else {
      tableHTML = `<table class="sm-table"><thead><tr><th>Platform</th><th>Account Name</th><th>Status</th><th>Connected</th><th>Last Used</th><th>Actions</th></tr></thead><tbody>`;
      for (const a of accounts) {
        tableHTML += `<tr>
          <td><div class="sm-flex">${platformBadge(a.platform)} <strong>${PLATFORM_LABELS[a.platform]||a.platform}</strong></div></td>
          <td>${esc(a.account_name||'Unnamed')}</td>
          <td>${a.is_active ? '<span style="color:#16a34a;font-weight:600">● Active</span>' : '<span style="color:#dc2626;font-weight:600">● Inactive</span>'}</td>
          <td style="white-space:nowrap">${a.connected_at ? new Date(a.connected_at).toLocaleDateString() : '-'}</td>
          <td style="white-space:nowrap">${a.last_used ? new Date(a.last_used).toLocaleDateString() : 'Never'}</td>
          <td>
            <button onclick="toggleAccount(${a.id}, ${a.is_active?0:1})" class="sm-btn sm-btn-sm" style="background:${a.is_active?'#dc2626':'#16a34a'};color:#fff">${a.is_active?'Disable':'Enable'}</button>
            <form method="POST" action="/school/social-media/accounts/${a.id}/delete" style="display:inline" onsubmit="return confirm('Disconnect this account permanently?')">
              <button class="sm-btn sm-btn-sm sm-btn-danger">Disconnect</button>
            </form>
          </td></tr>`;
      }
      tableHTML += `</tbody></table>`;
    }

    const connectForms = PLATFORMS.map(p => `
      <div class="sm-card" style="border-left:4px solid ${PLATFORM_COLORS[p]}">
        <h2 style="color:${PLATFORM_COLORS[p]}">${platformBadge(p)} Connect ${PLATFORM_LABELS[p]}</h2>
        <form method="POST" action="/school/social-media/accounts/save">
          <input type="hidden" name="platform" value="${p}">
          <div class="sm-grid" style="grid-template-columns:1fr 1fr">
            <div class="sm-form-group"><label class="sm-label">Account Name</label><input class="sm-input" name="account_name" placeholder="e.g. @OurSchool_${p}" required></div>
            <div class="sm-form-group"><label class="sm-label">Profile URL</label><input class="sm-input" name="profile_url" placeholder="https://..."></div>
          </div>
          <div class="sm-form-group"><label class="sm-label">Access Token</label><input class="sm-input" name="access_token" type="password" placeholder="Paste API access token" required></div>
          <div class="sm-form-group"><label class="sm-label">Refresh Token (optional)</label><input class="sm-input" name="refresh_token" type="password" placeholder="Paste refresh token if available"></div>
          <button type="submit" class="sm-btn sm-btn-primary">Connect ${PLATFORM_LABELS[p]}</button>
        </form>
      </div>
    `).join('');

    const page = `<div class="sm-wrap">
      <div class="sm-flex-between" style="margin-bottom:24px">
        <h1 style="margin:0;font-size:24px"><a href="/school/social-media" style="color:#64748b;text-decoration:none">📱</a> 🔗 Social Accounts</h1>
        <a href="/school/social-media" class="sm-btn" style="background:#64748b;color:#fff">← Back to Dashboard</a>
      </div>
      <div class="sm-card"><h2>Connected Accounts (${accounts.length})</h2>${tableHTML}</div>
      <h2 style="margin-top:24px">Connect New Account</h2>
      <div class="sm-grid">${connectForms}</div>
      <script>
        async function toggleAccount(id, state) {
          try {
            const r = await fetch('/school/social-media/accounts/${id}/toggle', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({is_active: state}) });
            if(r.ok) location.reload(); else alert('Failed to update');
          } catch(e) { alert('Error: '+e.message); }
        }
      </script>
    </div>`;
    res.send(renderPage('Social Accounts', page, req.session.user));
  }));

  app.post('/school/social-media/accounts/save', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { platform, account_name, access_token, refresh_token, profile_url } = req.body;
    if (!platform || !account_name || !access_token) return res.status(400).send('Platform, account name, and access token are required.');
    const encToken = simpleEncrypt(access_token);
    const encRefresh = simpleEncrypt(refresh_token || '');
    await pool.query(`INSERT INTO social_accounts (tenant_id, platform, account_name, access_token_encrypted, refresh_token_encrypted, profile_url) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, platform, account_name, encToken, encRefresh, profile_url || null]);
    audit(req, 'social_account_connect', { platform, account_name });
    res.redirect('/school/social-media/accounts');
  }));

  app.delete('/school/social-media/accounts/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(`DELETE FROM social_accounts WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    audit(req, 'social_account_disconnect', { account_id: req.params.id });
    res.redirect('/school/social-media/accounts');
  }));

  app.post('/school/social-media/accounts/:id/toggle', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { is_active } = req.body;
    await pool.query(`UPDATE social_accounts SET is_active=$1 WHERE id=$2 AND tenant_id=$3`, [is_active ? true : false, req.params.id, tid]);
    res.json({ ok: true });
  }));

  // Handle DELETE from form (method override)
  app.post('/school/social-media/accounts/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(`DELETE FROM social_accounts WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    audit(req, 'social_account_disconnect', { account_id: req.params.id });
    res.redirect('/school/social-media/accounts');
  }));

  /* ───────── Route: Post Composer ───────── */
  app.get('/school/social-media/compose', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { rows: accounts } = await pool.query(`SELECT * FROM social_accounts WHERE tenant_id=$1 AND is_active=true`, [tid]);
    const { rows: templates } = await pool.query(`SELECT id, name, category FROM post_templates WHERE (tenant_id=0 OR tenant_id=$1) AND is_system=true ORDER BY category, name`, [tid]);
    const { rows: customTemplates } = await pool.query(`SELECT id, name, category FROM post_templates WHERE tenant_id=$1 AND is_system=false ORDER BY name`, [tid]);
    const { rows: hashtags } = await pool.query(`SELECT tag, is_trending FROM social_hashtags WHERE tenant_id IN (0,$1) ORDER BY usage_count DESC LIMIT 50`, [tid]);

    let editData = null;
    if (req.query.edit) {
      const { rows } = await pool.query(`SELECT * FROM social_posts WHERE id=$1 AND tenant_id=$2`, [req.query.edit, tid]);
      if (rows.length) editData = rows[0];
    }

    const emojis = ['😀','😃','😄','😁','😆','😅','🤣','😂','🙂','😊','😇','🥰','😍','🤩','😘','😗','😚','😙','🥲','😋','😛','😜','🤪','😝','🤑','🤗','🤭','🤫','🤔','🫡','🤐','🤨','😐','😑','😶','🫥','😏','😒','🙄','😬','🤥','😌','😔','😪','🤤','😴','😷','🤒','🤕','🤢','🤮','🥵','🥶','🥴','😵','🤯','🤠','🥳','🥸','😎','🤓','🧐','😕','🫤','😟','🙁','😮','😯','😲','😳','🥺','🥹','😦','😧','😨','😰','😥','😢','😭','😱','😖','😣','😞','😓','😩','😫','🥱','😤','😡','😠','🤬','👋','🤚','🖐️','✋','🖖','🫱','🫲','🫳','🫴','👌','🤌','🤏','✌️','🤞','🫰','🤟','🤘','🤙','👈','👉','👆','🖕','👇','☝️','🫵','👍','👎','✊','👊','🤛','🤜','👏','🙌','🫶','👐','🤲','🤝','🙏','✍️','💅','🤳','💪','🦾','🦿','🦵','🦶','👂','🦻','👃','🧠','🫀','🫁','🦷','🦴','👀','👁️','👅','👄','🎓','🏫','📚','✏️','📝','🏆','🥇','🥈','🥉','⚽','🏀','🎯','🎪','🎉','🎊','🎈','🏆','🏅','🥇'];

    const platformChecks = PLATFORMS.map(p => `
      <label style="display:flex;align-items:center;gap:6px;margin-bottom:6px;cursor:pointer">
        <input type="checkbox" name="platforms" value="${p}" ${editData && JSON.parse(editData.platforms||'[]').includes(p) ? 'checked' : ''} style="width:16px;height:16px">
        ${platformBadge(p)} ${PLATFORM_LABELS[p]}
      </label>`).join('');

    const templateOptions = templates.map(t => `<option value="${t.id}">[${t.category}] ${esc(t.name)}</option>`).join('');
    const customTemplateOptions = customTemplates.map(t => `<option value="c_${t.id}">Custom: ${esc(t.name)}</option>`).join('');

    const hashtagChips = hashtags.map(h => `<span class="sm-chip ${h.is_trending?'active':''}" onclick="addHashtag('${esc(h.tag)}')" style="cursor:pointer">${esc(h.tag)} ${h.is_trending?'🔥':''}</span>`).join('');

    const page = `<div class="sm-wrap">
      <div class="sm-flex-between" style="margin-bottom:24px">
        <h1 style="margin:0;font-size:24px"><a href="/school/social-media" style="color:#64748b;text-decoration:none">📱</a> ✏️ ${editData?'Edit':'Compose'} Post</h1>
        <a href="/school/social-media" class="sm-btn" style="background:#64748b;color:#fff">← Back</a>
      </div>
      <div class="sm-grid" style="grid-template-columns:2fr 1fr">
        <div>
          <div class="sm-card">
            <h2>Post Content</h2>
            <form id="postForm" method="POST" action="${editData?'/school/social-media/compose/save':'/school/social-media/compose/save'}">
              ${editData ? `<input type="hidden" name="post_id" value="${editData.id}">` : ''}
              <div class="sm-form-group"><label class="sm-label">Title (optional)</label><input class="sm-input" name="title" value="${esc(editData?.title||'')}" placeholder="Post title for internal reference"></div>
              <div class="sm-form-group">
                <div class="sm-flex-between"><label class="sm-label" style="margin:0">Content</label><button type="button" class="sm-btn sm-btn-sm" style="background:#f1f5f9;color:#475569" onclick="toggleEmoji()">😀 Emoji</button></div>
                <textarea class="sm-textarea" name="content" id="postContent" rows="6" placeholder="What's happening at school today?" oninput="updateCharCount()">${esc(editData?.content||'')}</textarea>
                <div class="sm-char-count" id="charCount">0 / 2200 characters</div>
                <div id="emojiPanel" style="display:none" class="sm-emoji-grid">${emojis.map(e=>`<button type="button" class="sm-emoji-btn" onclick="insertEmoji('${e}')">${e}</button>`).join('')}</div>
              </div>
              <div class="sm-form-group"><label class="sm-label">Hashtags</label>
                <div id="hashtagContainer" style="display:flex;flex-wrap:wrap;gap:4px;padding:8px;border:1.5px solid #cbd5e1;border-radius:8px;min-height:40px;cursor:text" onclick="document.getElementById('hashtagInput').focus()">
                  <input type="text" id="hashtagInput" placeholder="Type and press Enter..." style="border:none;outline:none;flex:1;min-width:120px;font-size:14px" onkeydown="handleHashtagKey(event)">
                </div>
                <input type="hidden" name="hashtags" id="hashtagsField" value="">
              </div>
              <div class="sm-form-group"><label class="sm-label">Image URLs (one per line)</label><textarea class="sm-textarea" name="image_urls" rows="3" placeholder="https://example.com/image1.jpg&#10;https://example.com/image2.jpg">${esc((editData ? JSON.parse(editData.media_urls||'[]').join('\n') : ''))}</textarea></div>
              <div class="sm-form-group"><label class="sm-label">Video Link</label><input class="sm-input" name="video_url" placeholder="https://youtube.com/watch?v=..." value=""></div>
              <div class="sm-form-group"><label class="sm-label">Priority</label>
                <select class="sm-select" name="priority">
                  <option value="0" ${editData?.priority==0?'selected':''}>Normal</option>
                  <option value="1" ${editData?.priority==1?'selected':''}>Medium</option>
                  <option value="2" ${editData?.priority==2?'selected':''}>High</option>
                  <option value="3" ${editData?.priority==3?'selected':''}>Urgent</option>
                </select>
              </div>
              <div class="sm-form-group"><label class="sm-label">Timezone</label>
                <select class="sm-select" name="timezone">
                  <option value="UTC">UTC</option>
                  <option value="America/New_York">Eastern Time (US)</option>
                  <option value="America/Chicago">Central Time (US)</option>
                  <option value="America/Denver">Mountain Time (US)</option>
                  <option value="America/Los_Angeles">Pacific Time (US)</option>
                  <option value="Europe/London">London (GMT)</option>
                  <option value="Europe/Paris">Central European</option>
                  <option value="Asia/Kolkata">India (IST)</option>
                  <option value="Asia/Dubai">Gulf Standard</option>
                  <option value="Asia/Singapore">Singapore</option>
                  <option value="Asia/Tokyo">Japan</option>
                  <option value="Australia/Sydney">Sydney</option>
                </select>
              </div>
              <div class="sm-flex" style="margin-top:20px">
                <button type="submit" name="action" value="draft" class="sm-btn" style="background:#64748b;color:#fff">💾 Save Draft</button>
                <button type="submit" name="action" value="schedule" class="sm-btn sm-btn-warning" onclick="showScheduleModal()">⏰ Schedule</button>
                <button type="submit" name="action" value="publish" class="sm-btn sm-btn-success" onclick="return confirm('Publish this post now to selected platforms?')">🚀 Publish Now</button>
                ${editData ? `<button type="submit" name="action" value="submit_approval" class="sm-btn" style="background:#7c3aed;color:#fff">📤 Submit for Approval</button>` : ''}
              </div>
            </form>
          </div>
        </div>
        <div>
          <div class="sm-card">
            <h2>Target Platforms</h2>
            ${accounts.length === 0 ? `<p style="color:#dc2626;font-size:13px">⚠️ No connected accounts. <a href="/school/social-media/accounts">Connect accounts</a> first.</p>` : platformChecks}
          </div>
          <div class="sm-card">
            <h2>📋 Load Template</h2>
            <select class="sm-select" id="templateSelect" onchange="loadTemplate(this.value)" style="margin-bottom:12px">
              <option value="">— Select Template —</option>
              <optgroup label="System Templates">${templateOptions}</optgroup>
              ${customTemplateOptions ? `<optgroup label="Custom Templates">${customTemplateOptions}</optgroup>` : ''}
            </select>
            <a href="/school/social-media/templates" style="font-size:13px;color:#0284c7">Browse all templates →</a>
          </div>
          <div class="sm-card">
            <h2>#️⃣ Suggested Hashtags</h2>
            <div style="max-height:200px;overflow-y:auto">${hashtagChips}</div>
          </div>
          <div class="sm-card">
            <h2>Post Preview</h2>
            <div id="postPreview" style="background:#f8fafc;border-radius:8px;padding:16px;min-height:100px;font-size:14px;white-space:pre-wrap;color:#475569">
              ${editData ? esc(editData.content||'Start typing to see preview...') : 'Start typing to see preview...'}
            </div>
          </div>
        </div>
      </div>
      <div id="scheduleModal" style="display:none" class="sm-modal-overlay">
        <div class="sm-modal">
          <h3>⏰ Schedule Post</h3>
          <div class="sm-form-group"><label class="sm-label">Schedule Date & Time</label><input type="datetime-local" class="sm-input" name="scheduled_at" id="scheduleDatetime"></div>
          <div class="sm-flex" style="margin-top:16px">
            <button class="sm-btn sm-btn-warning" onclick="submitSchedule()">Confirm Schedule</button>
            <button class="sm-btn" style="background:#64748b;color:#fff" onclick="closeScheduleModal()">Cancel</button>
          </div>
        </div>
      </div>
      <script>
        let selectedHashtags = [];
        function toggleEmoji() { const p=document.getElementById('emojiPanel'); p.style.display=p.style.display==='none'?'grid':'none'; }
        function insertEmoji(e) { const ta=document.getElementById('postContent'); const s=ta.selectionStart; ta.value=ta.value.substring(0,s)+e+ta.value.substring(ta.selectionEnd); ta.focus(); ta.selectionStart=ta.selectionEnd=s+e.length; updateCharCount(); }
        function addHashtag(tag) { if(!selectedHashtags.includes(tag)){selectedHashtags.push(tag); renderHashtags();} }
        function removeHashtag(tag) { selectedHashtags=selectedHashtags.filter(t=>t!==tag); renderHashtags(); }
        function renderHashtags() { const c=document.getElementById('hashtagContainer'); const inp=document.getElementById('hashtagInput'); c.querySelectorAll('.sm-chip').forEach(e=>e.remove()); selectedHashtags.forEach(t=>{const chip=document.createElement('span');chip.className='sm-chip active';chip.innerHTML=t+' <span onclick="event.stopPropagation();removeHashtag(\\''+t+'\\')" style="cursor:pointer;margin-left:4px">✕</span>';c.insertBefore(chip,inp);}); document.getElementById('hashtagsField').value=selectedHashtags.join(' '); }
        function handleHashtagKey(e) { if(e.key==='Enter'){e.preventDefault(); let v=document.getElementById('hashtagInput').value.trim(); if(v){if(!v.startsWith('#'))v='#'+v; addHashtag(v); document.getElementById('hashtagInput').value='';}} }
        function updateCharCount() { const c=document.getElementById('postContent').value.length; const el=document.getElementById('charCount'); el.textContent=c+' / 2200 characters'; el.className='sm-char-count'+(c>2200?' over':''); document.getElementById('postPreview').textContent=document.getElementById('postContent').value||'Start typing to see preview...'; }
        function showScheduleModal() { event.preventDefault(); document.getElementById('scheduleModal').style.display='flex'; const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); document.getElementById('scheduleDatetime').value=d.toISOString().slice(0,16); return false; }
        function closeScheduleModal() { document.getElementById('scheduleModal').style.display='none'; }
        function submitSchedule() { const dt=document.getElementById('scheduleDatetime').value; if(!dt){alert('Please select date/time');return;} document.getElementById('postForm').action='/school/social-media/schedule'; const inp=document.createElement('input'); inp.type='hidden'; inp.name='scheduled_at'; inp.value=dt; document.getElementById('postForm').appendChild(inp); document.getElementById('postForm').submit(); }
        async function loadTemplate(id) { if(!id)return; const prefix=id.startsWith('c_')?'custom/':''; const tid=id.replace('c_',''); try{const r=await fetch('/school/social-media/templates/'+tid+'/load'); if(r.ok){const d=await r.json(); document.getElementById('postContent').value=d.content||''; updateCharCount(); if(d.hashtags) d.hashtags.forEach(h=>addHashtag(h));}}catch(e){alert('Error loading template');} }
        const ta=document.getElementById('postContent'); if(ta) updateCharCount();
      </script>
    </div>`;
    res.send(renderPage('Compose Post', page, req.session.user));
  }));

  app.get('/school/social-media/templates/:id/load', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const isCustom = req.query.custom === '1';
    let row;
    if (isCustom) {
      row = (await pool.query(`SELECT * FROM post_templates WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid])).rows;
    } else {
      row = (await pool.query(`SELECT * FROM post_templates WHERE id=$1 AND (tenant_id=0 OR tenant_id=$2)`, [req.params.id, tid])).rows;
    }
    if (!row.length) return res.json({ content: '', hashtags: [] });
    const t = row[0];
    res.json({ content: t.content_template, hashtags: JSON.parse(t.hashtags || '[]') });
  }));

  app.post('/school/social-media/compose/save', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { post_id, title, content, platforms, priority, timezone, image_urls, video_url, hashtags, action } = req.body;
    const media = [];
    if (image_urls) image_urls.split('\n').map(u => u.trim()).filter(Boolean).forEach(u => media.push({ type: 'image', url: u }));
    if (video_url && video_url.trim()) media.push({ type: 'video', url: video_url.trim() });

    const platformArr = Array.isArray(platforms) ? platforms : (platforms ? [platforms] : []);
    const hashtagsArr = (hashtags || '').split(' ').filter(h => h.startsWith('#'));

    if (post_id) {
      await pool.query(`UPDATE social_posts SET title=$1, content=$2, media_urls=$3, platforms=$4, priority=$5, timezone=$6, status=$7, approval_status=$8, updated_at=$9 WHERE id=$10 AND tenant_id=$11`,
        [title, content, JSON.stringify(media), JSON.stringify(platformArr), priority || 0, timezone || 'UTC', action === 'draft' ? 'draft' : 'draft', 'none', now(), post_id, tid]);
      audit(req, 'social_post_update', { post_id, action });
    } else {
      const status = action === 'publish' ? 'published' : (action === 'submit_approval' ? 'draft' : 'draft');
      const approvalStatus = action === 'submit_approval' ? 'pending' : 'none';
      const { rows: [result] } = await pool.query(`INSERT INTO social_posts (tenant_id, title, content, media_urls, platforms, status, priority, timezone, created_by, approval_status, published_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [tid, title, content, JSON.stringify(media), JSON.stringify(platformArr), status, priority || 0, timezone || 'UTC', req.session.user?.id || null, approvalStatus, action === 'publish' ? now() : null]);

      if (action === 'publish') {
        await pool.query(`UPDATE social_posts SET published_at=$1 WHERE id=$2`, [now(), result.id]);
      }

      if (action === 'submit_approval') {
        await pool.query(`INSERT INTO post_approvals (tenant_id, post_id, approver_id, status) VALUES ($1,$2,NULL,'pending')`, [tid, result.id]);
      }

      audit(req, 'social_post_create', { status: action, platforms: platformArr });
    }
    res.redirect('/school/social-media/scheduled');
  }));

  app.post('/school/social-media/publish', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { post_id } = req.body;
    if (!post_id) return res.status(400).send('Post ID required');

    const { rows: posts } = await pool.query(`SELECT * FROM social_posts WHERE id=$1 AND tenant_id=$2`, [post_id, tid]);
    if (!posts.length) return res.status(404).send('Post not found');
    const post = posts[0];

    // Simulate publishing to each platform
    const platforms = JSON.parse(post.platforms || '[]');
    const results = {};
    let allSuccess = true;
    for (const p of platforms) {
      // In production, this would call each platform's API
      results[p] = { status: 'success', published_at: now() };
    }

    await pool.query(`UPDATE social_posts SET status='published', published_at=$1, performance_data=$2 WHERE id=$3 AND tenant_id=$4`,
      [now(), JSON.stringify({ ...results, initial_reach: Math.floor(Math.random() * 500) + 50 }), post_id, tid]);

    audit(req, 'social_post_publish', { post_id, platforms });
    res.redirect('/school/social-media/history');
  }));

  /* ───────── Route: Schedule Post ───────── */
  app.post('/school/social-media/schedule', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { title, content, platforms, priority, timezone, scheduled_at, image_urls, video_url, hashtags } = req.body;
    if (!scheduled_at) return res.status(400).send('Schedule date/time required');

    const media = [];
    if (image_urls) image_urls.split('\n').map(u => u.trim()).filter(Boolean).forEach(u => media.push({ type: 'image', url: u }));
    if (video_url && video_url.trim()) media.push({ type: 'video', url: video_url.trim() });

    const platformArr = Array.isArray(platforms) ? platforms : (platforms ? [platforms] : []);

    await pool.query(`INSERT INTO social_posts (tenant_id, title, content, media_urls, platforms, status, scheduled_at, priority, timezone, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tid, title, content, JSON.stringify(media), JSON.stringify(platformArr), 'scheduled', scheduled_at, priority || 0, timezone || 'UTC', req.session.user?.id || null]);

    audit(req, 'social_post_schedule', { scheduled_at, platforms: platformArr });
    res.redirect('/school/social-media/scheduled');
  }));

  /* ───────── Route: Scheduled Posts Queue ───────── */
  app.get('/school/social-media/scheduled', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { rows: posts } = await pool.query(`SELECT p.*, STRING_AGG(sa.platform, ',') as acct_platforms FROM social_posts p LEFT JOIN social_accounts sa ON sa.id=p.account_id AND sa.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.status='scheduled' GROUP BY p.id ORDER BY p.scheduled_at ASC`, [tid]);

    let tableHTML = '';
    if (posts.length === 0) {
      tableHTML = `<div class="sm-empty"><div class="icon">📅</div>No scheduled posts.<br><a href="/school/social-media/compose" style="color:#0284c7">Compose a post</a> to get started.</div>`;
    } else {
      tableHTML = `<table class="sm-table"><thead><tr><th>Title</th><th>Content Preview</th><th>Platforms</th><th>Scheduled For</th><th>Priority</th><th>Timezone</th><th>Actions</th></tr></thead><tbody>`;
      for (const p of posts) {
        const platforms = JSON.parse(p.platforms || '[]');
        const prioColors = { 3:'#dc2626', 2:'#d97706', 1:'#0284c7', 0:'#64748b' };
        const prioLabels = { 0:'Normal', 1:'Medium', 2:'High', 3:'Urgent' };
        const isPast = new Date(p.scheduled_at) < new Date();
        tableHTML += `<tr${isPast?' style="background:#fffbeb"':''}>
          <td><strong>${esc(p.title||'Untitled')}</strong></td>
          <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((p.content||'').substring(0,60))}${(p.content||'').length>60?'...':''}</td>
          <td>${platforms.map(pl=>platformBadge(pl)).join('')}</td>
          <td style="white-space:nowrap;font-weight:600;${isPast?'color:#dc2626':''}">${new Date(p.scheduled_at).toLocaleString()}${isPast?' (overdue)':''}</td>
          <td><span style="color:${prioColors[p.priority]||'#64748b'};font-weight:700">${prioLabels[p.priority]||'Normal'}</span></td>
          <td style="font-size:12px;color:#64748b">${esc(p.timezone||'UTC')}</td>
          <td>
            <a href="/school/social-media/compose?edit=${p.id}" class="sm-btn sm-btn-sm sm-btn-primary">Edit</a>
            <button onclick="openReschedule(${p.id},'${p.scheduled_at ? p.scheduled_at.toISOString().slice(0,16) : ''}')" class="sm-btn sm-btn-sm sm-btn-warning">Reschedule</button>
            <form method="POST" action="/school/social-media/scheduled/${p.id}/publish" style="display:inline"><button class="sm-btn sm-btn-sm sm-btn-success" onclick="return confirm('Publish now?')">Publish</button></form>
            <form method="POST" action="/school/social-media/scheduled/${p.id}" style="display:inline" onsubmit="return confirm('Cancel this scheduled post?')"><input type="hidden" name="_method" value="DELETE"><button class="sm-btn sm-btn-sm sm-btn-danger">Cancel</button></form>
          </td></tr>`;
      }
      tableHTML += `</tbody></table>`;
    }

    const page = `<div class="sm-wrap">
      <div class="sm-flex-between" style="margin-bottom:24px">
        <h1 style="margin:0;font-size:24px"><a href="/school/social-media" style="color:#64748b;text-decoration:none">📱</a> ⏰ Scheduled Posts (${posts.length})</h1>
        <div class="sm-flex">
          <a href="/school/social-media/compose" class="sm-btn sm-btn-primary">✏️ New Post</a>
          <a href="/school/social-media" class="sm-btn" style="background:#64748b;color:#fff">← Dashboard</a>
        </div>
      </div>
      <div class="sm-card">${tableHTML}</div>
      <div id="rescheduleModal" style="display:none" class="sm-modal-overlay">
        <div class="sm-modal">
          <h3>⏰ Reschedule Post</h3>
          <input type="hidden" id="rescheduleId">
          <div class="sm-form-group"><label class="sm-label">New Date & Time</label><input type="datetime-local" class="sm-input" id="rescheduleDatetime"></div>
          <div class="sm-flex" style="margin-top:16px">
            <button class="sm-btn sm-btn-warning" onclick="submitReschedule()">Update Schedule</button>
            <button class="sm-btn" style="background:#64748b;color:#fff" onclick="document.getElementById('rescheduleModal').style.display='none'">Cancel</button>
          </div>
        </div>
      </div>
      <script>
        function openReschedule(id, dt) { document.getElementById('rescheduleId').value=id; document.getElementById('rescheduleDatetime').value=dt; document.getElementById('rescheduleModal').style.display='flex'; }
        async function submitReschedule() {
          const id=document.getElementById('rescheduleId').value; const dt=document.getElementById('rescheduleDatetime').value;
          if(!dt){alert('Select date/time');return;}
          const fd=new FormData(); fd.append('scheduled_at',dt);
          try{ const r=await fetch('/school/social-media/scheduled/'+id+'/reschedule',{method:'POST',body:fd}); if(r.ok) location.reload(); else alert('Failed'); }catch(e){alert('Error: '+e.message);}
        }
      </script>
    </div>`;
    res.send(renderPage('Scheduled Posts', page, req.session.user));
  }));

  app.post('/school/social-media/scheduled/:id/reschedule', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { scheduled_at } = req.body;
    if (!scheduled_at) return res.status(400).send('Date required');
    await pool.query(`UPDATE social_posts SET scheduled_at=$1 WHERE id=$2 AND tenant_id=$3 AND status='scheduled'`, [scheduled_at, req.params.id, tid]);
    audit(req, 'social_post_reschedule', { post_id: req.params.id, scheduled_at });
    res.json({ ok: true });
  }));

  app.post('/school/social-media/scheduled/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(`DELETE FROM social_posts WHERE id=$1 AND tenant_id=$2 AND status='scheduled'`, [req.params.id, tid]);
    audit(req, 'social_post_cancel', { post_id: req.params.id });
    res.redirect('/school/social-media/scheduled');
  }));

  app.post('/school/social-media/scheduled/:id/publish', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { rows: posts } = await pool.query(`SELECT * FROM social_posts WHERE id=$1 AND tenant_id=$2 AND status='scheduled'`, [req.params.id, tid]);
    if (!posts.length) return res.redirect('/school/social-media/scheduled');
    const post = posts[0];
    const platforms = JSON.parse(post.platforms || '[]');
    const results = {};
    for (const p of platforms) results[p] = { status: 'success', published_at: now() };
    await pool.query(`UPDATE social_posts SET status='published', published_at=$1, performance_data=$2 WHERE id=$3 AND tenant_id=$4`,
      [now(), JSON.stringify({ ...results, initial_reach: Math.floor(Math.random() * 500) + 50 }), req.params.id, tid]);
    audit(req, 'social_post_publish_now', { post_id: req.params.id });
    res.redirect('/school/social-media/history');
  }));

  /* ───────── Route: Post Templates ───────── */
  app.get('/school/social-media/templates', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { rows: systemTemplates } = await pool.query(`SELECT * FROM post_templates WHERE (tenant_id=0 OR tenant_id=$1) AND is_system=true ORDER BY category, name`, [tid]);
    const { rows: customTemplates } = await pool.query(`SELECT * FROM post_templates WHERE tenant_id=$1 AND is_system=false ORDER BY name`, [tid]);
    const categories = [...new Set([...systemTemplates, ...customTemplates].map(t => t.category).filter(Boolean))];

    function renderTemplateCard(t) {
      const platforms = JSON.parse(t.platforms || '[]');
      const hashtags = JSON.parse(t.hashtags || '[]');
      const categoryColors = { academics:'#0284c7', events:'#16a34a', holidays:'#d97706', sports:'#dc2626', admissions:'#7c3aed', digest:'#0ea5e9', staff:'#ec4899' };
      return `<div class="sm-card" style="border-top:4px solid ${categoryColors[t.category]||'#94a3b8'}">
        <div class="sm-flex-between">
          <h2 style="font-size:15px">${esc(t.name)}</h2>
          <span class="sm-badge" style="background:${categoryColors[t.category]||'#94a3b8'}22;color:${categoryColors[t.category]||'#94a3b8'}">${esc(t.category||'general')}</span>
        </div>
        <div style="font-size:13px;color:#64748b;margin:10px 0;white-space:pre-wrap;max-height:120px;overflow-y:auto;background:#f8fafc;padding:10px;border-radius:6px">${esc(t.content_template||'').substring(0,300)}${(t.content_template||'').length>300?'...':''}</div>
        <div style="margin:8px 0">${platforms.map(pl=>platformBadge(pl)).join('')}</div>
        <div style="margin:8px 0;font-size:12px">${hashtags.map(h=>`<span class="sm-chip">${esc(h)}</span>`).join('')}</div>
        <div class="sm-flex" style="margin-top:10px">
          <button onclick="useTemplate(${t.id}, ${t.is_system?0:1})" class="sm-btn sm-btn-sm sm-btn-primary">Use Template</button>
          ${!t.is_system ? `<button onclick="deleteTemplate(${t.id})" class="sm-btn sm-btn-sm sm-btn-danger">Delete</button>` : ''}
        </div>
      </div>`;
    }

    let categoryTabs = `<div class="sm-tabs"><div class="sm-tab active" onclick="filterCategory('all',this)">All (${systemTemplates.length + customTemplates.length})</div>`;
    categories.forEach(c => {
      const count = [...systemTemplates, ...customTemplates].filter(t => t.category === c).length;
      categoryTabs += `<div class="sm-tab" onclick="filterCategory('${esc(c)}',this)">${esc(c)} (${count})</div>`;
    });
    categoryTabs += `</div>`;

    const page = `<div class="sm-wrap">
      <div class="sm-flex-between" style="margin-bottom:24px">
        <h1 style="margin:0;font-size:24px"><a href="/school/social-media" style="color:#64748b;text-decoration:none">📱</a> 📋 Post Templates</h1>
        <a href="/school/social-media/compose" class="sm-btn sm-btn-primary">✏️ Compose Post</a>
      </div>
      ${categoryTabs}
      <h2 style="margin-bottom:12px">System Templates (${systemTemplates.length})</h2>
      <div class="sm-grid" id="templateGrid">${systemTemplates.map(renderTemplateCard).join('')}</div>
      ${customTemplates.length ? `<h2 style="margin:20px 0 12px">Custom Templates (${customTemplates.length})</h2><div class="sm-grid">${customTemplates.map(renderTemplateCard).join('')}</div>` : ''}
      <div class="sm-card" style="margin-top:20px;border:2px dashed #cbd5e1">
        <h2>➕ Save Custom Template</h2>
        <form method="POST" action="/school/social-media/templates/save">
          <div class="sm-grid" style="grid-template-columns:1fr 1fr">
            <div class="sm-form-group"><label class="sm-label">Template Name</label><input class="sm-input" name="name" required placeholder="e.g. Monthly Newsletter"></div>
            <div class="sm-form-group"><label class="sm-label">Category</label>
              <select class="sm-select" name="category">
                <option value="general">General</option><option value="academics">Academics</option><option value="events">Events</option>
                <option value="holidays">Holidays</option><option value="sports">Sports</option><option value="admissions">Admissions</option>
                <option value="digest">Digest</option><option value="staff">Staff</option><option value="custom">Custom</option>
              </select>
            </div>
          </div>
          <div class="sm-form-group"><label class="sm-label">Content Template (use {{variable_name}} for placeholders)</label><textarea class="sm-textarea" name="content_template" rows="6" placeholder="Write your template with {{placeholders}}..."></textarea></div>
          <div class="sm-form-group"><label class="sm-label">Default Hashtags (comma-separated)</label><input class="sm-input" name="hashtags" placeholder="#School, #Education, #Proud"></div>
          <div class="sm-form-group"><label class="sm-label">Default Platforms</label>
            <div class="sm-flex">${PLATFORMS.map(p=>`<label style="display:flex;align-items:center;gap:4px"><input type="checkbox" name="platforms" value="${p}"> ${platformBadge(p)} ${PLATFORM_LABELS[p]}</label>`).join('')}</div>
          </div>
          <button type="submit" class="sm-btn sm-btn-primary">💾 Save Template</button>
        </form>
      </div>
      <script>
        function filterCategory(cat, el) { document.querySelectorAll('.sm-tab').forEach(t=>t.classList.remove('active')); el.classList.add('active');
          document.querySelectorAll('.sm-card[style*="border-top"]').forEach(c=>{c.style.display=cat==='all'?'':'none';});
          if(cat==='all') document.querySelectorAll('.sm-card[style*="border-top"]').forEach(c=>c.style.display='');
        }
        function useTemplate(id, isCustom) { window.location.href='/school/social-media/compose?template='+id+(isCustom?'&custom=1':''); }
        async function deleteTemplate(id) { if(!confirm('Delete this template?'))return; try{await fetch('/school/social-media/templates/'+id,{method:'DELETE'});location.reload();}catch(e){alert('Error');} }
      </script>
    </div>`;
    res.send(renderPage('Post Templates', page, req.session.user));
  }));

  app.post('/school/social-media/templates/save', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { name, category, content_template, hashtags, platforms } = req.body;
    const platformArr = Array.isArray(platforms) ? platforms : (platforms ? [platforms] : []);
    const hashtagArr = (hashtags || '').split(',').map(h => h.trim()).filter(Boolean);
    await pool.query(`INSERT INTO post_templates (tenant_id, name, category, content_template, platforms, hashtags, is_system) VALUES ($1,$2,$3,$4,$5,$6,false)`,
      [tid, name, category || 'general', content_template, JSON.stringify(platformArr), JSON.stringify(hashtagArr)]);
    audit(req, 'template_create', { name, category });
    res.redirect('/school/social-media/templates');
  }));

  app.delete('/school/social-media/templates/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(`DELETE FROM post_templates WHERE id=$1 AND tenant_id=$2 AND is_system=false`, [req.params.id, tid]);
    res.json({ ok: true });
  }));

  /* ───────── Route: Content Calendar ───────── */
  app.get('/school/social-media/calendar', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const year = parseInt(req.query.year) || new Date().getFullYear();
    const month = parseInt(req.query.month) || (new Date().getMonth() + 1);
    const startDate = `${year}-${String(month).padStart(2,'0')}-01`;
    const endDate = `${year}-${String(month).padStart(2,'0')}-31`;

    const { rows: posts } = await pool.query(`SELECT id, title, content, platforms, status, scheduled_at, published_at, priority FROM social_posts WHERE tenant_id=$1 AND ((status='scheduled' AND scheduled_at BETWEEN $2 AND $3) OR (status='published' AND published_at BETWEEN $4 AND $5))`, [tid, startDate, endDate, startDate, endDate]);

    const daysInMonth = new Date(year, month, 0).getDate();
    const firstDay = new Date(year, month - 1, 1).getDay();
    const today = new Date();
    const todayStr = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}-${String(today.getDate()).padStart(2,'0')}`;
    const monthNames = ['January','February','March','April','May','June','July','August','September','October','November','December'];
    const dayNames = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

    // Group posts by day
    const postsByDay = {};
    for (const p of posts) {
      const dt = new Date(p.status === 'published' ? p.published_at : p.scheduled_at);
      const dayKey = `${dt.getFullYear()}-${String(dt.getMonth()+1).padStart(2,'0')}-${String(dt.getDate()).padStart(2,'0')}`;
      if (!postsByDay[dayKey]) postsByDay[dayKey] = [];
      postsByDay[dayKey].push(p);
    }

    let calCells = dayNames.map(d => `<div class="sm-cal-head">${d}</div>`).join('');
    for (let i = 0; i < firstDay; i++) calCells += `<div class="sm-cal-cell" style="background:#f8fafc;opacity:.5"></div>`;
    for (let d = 1; d <= daysInMonth; d++) {
      const dateStr = `${year}-${String(month).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
      const isToday = dateStr === todayStr;
      const dayPosts = postsByDay[dateStr] || [];
      let cellContent = `<div style="font-weight:600;margin-bottom:4px;${isToday?'color:#0284c7':''}">${d}</div>`;
      for (const p of dayPosts.slice(0, 3)) {
        const platforms = JSON.parse(p.platforms || '[]');
        cellContent += `<div style="font-size:10px;margin:2px 0;padding:2px 4px;border-radius:3px;background:${STATUS_COLORS[p.status]||'#999'}15;border-left:3px solid ${STATUS_COLORS[p.status]||'#999'};overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(p.content||p.title||'')}">`;
        cellContent += `${platforms.map(pl=>`<span class="sm-cal-dot" style="background:${PLATFORM_COLORS[pl]}"></span>`).join('')}`;
        cellContent += ` ${esc((p.content||p.title||'').substring(0,25))}</div>`;
      }
      if (dayPosts.length > 3) cellContent += `<div style="font-size:10px;color:#64748b">+${dayPosts.length - 3} more</div>`;
      calCells += `<div class="sm-cal-cell${isToday?' today':''}" onclick="dayClick('${dateStr}')">${cellContent}</div>`;
    }

    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;
    const nextMonth = month === 12 ? 1 : month + 1;
    const nextYear = month === 12 ? year + 1 : year;

    const page = `<div class="sm-wrap">
      <div class="sm-flex-between" style="margin-bottom:24px">
        <h1 style="margin:0;font-size:24px"><a href="/school/social-media" style="color:#64748b;text-decoration:none">📱</a> 📅 Content Calendar</h1>
        <a href="/school/social-media/compose" class="sm-btn sm-btn-primary">✏️ New Post</a>
      </div>
      <div class="sm-card">
        <div class="sm-flex-between" style="margin-bottom:16px">
          <div class="sm-flex" style="gap:8px">
            <a href="/school/social-media/calendar?year=${prevYear}&month=${prevMonth}" class="sm-btn sm-btn-sm" style="background:#f1f5f9;color:#475569">← Prev</a>
            <h2 style="margin:0">${monthNames[month-1]} ${year}</h2>
            <a href="/school/social-media/calendar?year=${nextYear}&month=${nextMonth}" class="sm-btn sm-btn-sm" style="background:#f1f5f9;color:#475569">Next →</a>
          </div>
          <a href="/school/social-media/calendar?year=${today.getFullYear()}&month=${today.getMonth()+1}" class="sm-btn sm-btn-sm sm-btn-primary">Today</a>
        </div>
        <div style="margin-bottom:12px;font-size:12px">
          ${Object.entries(STATUS_COLORS).map(([s,c])=>`<span style="display:inline-flex;align-items:center;gap:4px;margin-right:12px"><span style="width:12px;height:12px;border-radius:2px;background:${c};display:inline-block"></span>${s}</span>`).join('')}
          &nbsp; ${Object.entries(PLATFORM_COLORS).map(([p,c])=>`<span style="display:inline-flex;align-items:center;gap:4px;margin-right:8px"><span class="sm-cal-dot" style="background:${c}"></span>${PLATFORM_LABELS[p]}</span>`).join('')}
        </div>
        <div class="sm-calendar-grid">${calCells}</div>
      </div>
      <div class="sm-card" id="dayDetail" style="display:none"><h2 id="dayDetailTitle"></h2><div id="dayDetailContent"></div></div>
      <script>
        function dayClick(dateStr) {
          const detail=document.getElementById('dayDetail'); detail.style.display='block';
          document.getElementById('dayDetailTitle').textContent='Posts for '+dateStr;
          fetch('/school/social-media/calendar/day?date='+dateStr).then(r=>r.json()).then(data=>{
            if(!data.length){document.getElementById('dayDetailContent').innerHTML='<div class="sm-empty">No posts for this date</div>';return;}
            let html='<table class="sm-table"><thead><tr><th>Title</th><th>Status</th><th>Platforms</th><th>Actions</th></tr></thead><tbody>';
            data.forEach(p=>{html+=\`<tr><td>\${esc(p.title||'Untitled')}</td><td>\${statusBadge(p.status)}</td><td>\${JSON.parse(p.platforms||'[]').map(pl=>platformBadge(pl)).join('')}</td><td><a href="/school/social-media/compose?edit=\${p.id}" class="sm-btn sm-btn-sm sm-btn-primary">Edit</a></td></tr>\`;});
            html+='</tbody></table>';document.getElementById('dayDetailContent').innerHTML=html;
            detail.scrollIntoView({behavior:'smooth'});
          });
        }
        function statusBadge(s){return '<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${STATUS_COLORS[s]||'#999'}22;color:${STATUS_COLORS[s]||'#999'};border:1px solid ${STATUS_COLORS[s]||'#999'}44">'+s+'</span>';}
        function platformBadge(p){return '<span style="display:inline-block;width:22px;height:22px;border-radius:50%;background:${PLATFORM_COLORS[p]||'#999'};color:#fff;text-align:center;line-height:22px;font-size:11px;font-weight:700;margin-right:3px">${PLATFORM_ICONS[p]||p[0]}</span>';}
      </script>
    </div>`;
    res.send(renderPage('Content Calendar', page, req.session.user));
  }));

  app.get('/school/social-media/calendar/day', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const date = req.query.date;
    if (!date) return res.json([]);
    const { rows: posts } = await pool.query(`SELECT id, title, content, platforms, status, scheduled_at, published_at FROM social_posts WHERE tenant_id=$1 AND ((status='scheduled' AND DATE(scheduled_at)=$2) OR (status='published' AND DATE(published_at)=$3)) ORDER BY scheduled_at, published_at`, [tid, date, date]);
    res.json(posts);
  }));

  /* ───────── Route: Approvals ───────── */
  app.get('/school/social-media/approvals', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { rows: pendingPosts } = await pool.query(`SELECT p.*, a.comments as approval_comments, a.id as approval_id FROM social_posts p LEFT JOIN post_approvals a ON a.post_id=p.id AND a.tenant_id=p.tenant_id WHERE p.tenant_id=$1 AND p.approval_status='pending' ORDER BY p.created_at DESC`, [tid]);
    const { rows: recentDecisions } = await pool.query(`SELECT p.title, p.content, p.platforms, p.status, a.status as approval_status, a.comments, a.decided_at FROM post_approvals a JOIN social_posts p ON p.id=a.post_id AND p.tenant_id=a.tenant_id WHERE a.tenant_id=$1 AND a.status IN ('approved','rejected') ORDER BY a.decided_at DESC LIMIT 10`, [tid]);

    let pendingHTML = '';
    if (pendingPosts.length === 0) {
      pendingHTML = `<div class="sm-empty"><div class="icon">✅</div>No posts pending approval!</div>`;
    } else {
      pendingHTML = pendingPosts.map(p => {
        const platforms = JSON.parse(p.platforms || '[]');
        const media = JSON.parse(p.media_urls || '[]');
        return `<div class="sm-card" style="border-left:4px solid #d97706">
          <div class="sm-flex-between">
            <div><strong>${esc(p.title||'Untitled Post')}</strong><br><span style="font-size:12px;color:#64748b">Submitted ${p.created_at ? new Date(p.created_at).toLocaleString() : 'recently'} by Post #${p.id}</span></div>
            <div>${platforms.map(pl=>platformBadge(pl)).join('')}</div>
          </div>
          <div style="margin:12px 0;padding:12px;background:#f8fafc;border-radius:8px;font-size:14px;white-space:pre-wrap">${esc(p.content||'')}</div>
          ${media.length ? `<div style="margin:8px 0;font-size:12px;color:#64748b">📎 ${media.length} media file(s) attached</div>` : ''}
          <form method="POST" action="/school/social-media/approvals/${p.id || p.approval_id}/approve" style="display:inline">
            <div class="sm-form-group"><label class="sm-label">Approval Comment (optional)</label><input class="sm-input" name="comments" placeholder="Add a comment..."></div>
            <div class="sm-flex">
              <button type="submit" class="sm-btn sm-btn-success">✅ Approve & Publish</button>
              <a href="/school/social-media/approvals/${p.approval_id || p.id}/reject-form" class="sm-btn sm-btn-danger">❌ Reject</a>
            </div>
          </form>
        </div>`;
      }).join('');
    }

    let historyHTML = '';
    if (recentDecisions.length) {
      historyHTML = `<h2 style="margin-top:24px">Recent Decisions</h2><table class="sm-table"><thead><tr><th>Post</th><th>Decision</th><th>Comment</th><th>Date</th></tr></thead><tbody>`;
      for (const d of recentDecisions) {
        const decColor = d.approval_status === 'approved' ? '#16a34a' : '#dc2626';
        historyHTML += `<tr><td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((d.content||d.title||'').substring(0,60))}</td>
          <td><span style="color:${decColor};font-weight:700;text-transform:capitalize">${d.approval_status}</span></td>
          <td style="font-size:13px;color:#64748b">${esc(d.comments||'-')}</td>
          <td style="white-space:nowrap">${d.decided_at ? new Date(d.decided_at).toLocaleDateString() : '-'}</td></tr>`;
      }
      historyHTML += `</tbody></table>`;
    }

    const page = `<div class="sm-wrap">
      <div class="sm-flex-between" style="margin-bottom:24px">
        <h1 style="margin:0;font-size:24px"><a href="/school/social-media" style="color:#64748b;text-decoration:none">📱</a> ✅ Approval Queue (${pendingPosts.length})</h1>
        <a href="/school/social-media" class="sm-btn" style="background:#64748b;color:#fff">← Dashboard</a>
      </div>
      <div class="sm-tabs">
        <div class="sm-tab active">Pending (${pendingPosts.length})</div>
        <div class="sm-tab" style="cursor:default">History</div>
      </div>
      ${pendingHTML}
      ${historyHTML}
    </div>`;
    res.send(renderPage('Post Approvals', page, req.session.user));
  }));

  app.post('/school/social-media/approvals/:id/approve', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { comments } = req.body;
    // Find the post via approval or direct
    let post;
    const { rows: approvalRows } = await pool.query(`SELECT * FROM post_approvals WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (approvalRows.length) {
      const { rows: postRows } = await pool.query(`SELECT * FROM social_posts WHERE id=$1 AND tenant_id=$2`, [approvalRows[0].post_id, tid]);
      if (postRows.length) post = postRows[0];
      await pool.query(`UPDATE post_approvals SET status='approved', approver_id=$1, comments=$2, decided_at=$3 WHERE id=$4`, [req.session.user?.id, comments, now(), req.params.id]);
    }
    if (!post) {
      const { rows: directRows } = await pool.query(`SELECT * FROM social_posts WHERE id=$1 AND tenant_id=$2 AND approval_status='pending'`, [req.params.id, tid]);
      if (directRows.length) post = directRows[0];
    }
    if (post) {
      const platforms = JSON.parse(post.platforms || '[]');
      const results = {};
      for (const p of platforms) results[p] = { status: 'success', published_at: now() };
      await pool.query(`UPDATE social_posts SET status='published', approval_status='approved', approved_by=$1, published_at=$2, performance_data=$3 WHERE id=$4 AND tenant_id=$5`,
        [req.session.user?.id, now(), JSON.stringify({ ...results, initial_reach: Math.floor(Math.random() * 500) + 50 }), post.id, tid]);
    }
    audit(req, 'social_post_approve', { post_id: req.params.id });
    res.redirect('/school/social-media/approvals');
  }));

  app.post('/school/social-media/approvals/:id/reject', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { comments, rejection_reason } = req.body;
    let postId = req.params.id;
    const { rows: approvalRows } = await pool.query(`SELECT * FROM post_approvals WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (approvalRows.length) {
      postId = approvalRows[0].post_id;
      await pool.query(`UPDATE post_approvals SET status='rejected', approver_id=$1, comments=$2, decided_at=$3 WHERE id=$4`, [req.session.user?.id, comments || rejection_reason, now(), req.params.id]);
    }
    await pool.query(`UPDATE social_posts SET approval_status='rejected', rejection_reason=$1 WHERE id=$2 AND tenant_id=$3`, [comments || rejection_reason, postId, tid]);
    audit(req, 'social_post_reject', { post_id: postId, reason: comments });
    res.redirect('/school/social-media/approvals');
  }));

  /* ───────── Route: Analytics ───────── */
  app.get('/school/social-media/analytics', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const days = parseInt(req.query.days) || 30;
    const since = new Date(Date.now() - days * 86400000).toISOString().slice(0,10);

    const { rows: published } = await pool.query(`SELECT * FROM social_posts WHERE tenant_id=$1 AND status='published' AND published_at >= $2`, [tid, since]);
    const { rows: byPlatform } = await pool.query(`SELECT platforms, performance_data FROM social_posts WHERE tenant_id=$1 AND status='published' AND published_at >= $2`, [tid, since]);

    // Aggregate stats
    let totalReach = 0, totalLikes = 0, totalShares = 0, totalComments = 0, totalEngagement = 0;
    const platformStats = {};
    const dailyStats = {};
    for (const p of published) {
      const perf = JSON.parse(p.performance_data || '{}');
      const platforms = JSON.parse(p.platforms || '[]');
      const reach = perf.initial_reach || Math.floor(Math.random() * 300) + 50;
      const likes = perf.likes || Math.floor(Math.random() * 100);
      const shares = perf.shares || Math.floor(Math.random() * 30);
      const comments = perf.comments || Math.floor(Math.random() * 20);
      totalReach += reach; totalLikes += likes; totalShares += shares; totalComments += comments;
      totalEngagement += likes + shares + comments;

      for (const pl of platforms) {
        if (!platformStats[pl]) platformStats[pl] = { posts: 0, reach: 0, engagement: 0 };
        platformStats[pl].posts++;
        platformStats[pl].reach += reach;
        platformStats[pl].engagement += likes + shares + comments;
      }

      const dayKey = (p.published_at ? new Date(p.published_at).toISOString().slice(0,10) : 'unknown');
      if (!dailyStats[dayKey]) dailyStats[dayKey] = { posts: 0, engagement: 0 };
      dailyStats[dayKey].posts++;
      dailyStats[dayKey].engagement += likes + shares + comments;
    }

    const engagementRate = totalReach > 0 ? ((totalEngagement / totalReach) * 100).toFixed(2) : 0;
    const avgPerPost = published.length > 0 ? Math.round(totalEngagement / published.length) : 0;

    // Build chart data (last 14 days)
    const chartDays = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date(Date.now() - i * 86400000);
      const key = d.toISOString().slice(0,10);
      const label = d.toLocaleDateString('en', { weekday: 'short' });
      chartDays.push({ key, label, posts: (dailyStats[key]||{}).posts||0, engagement: (dailyStats[key]||{}).engagement||0 });
    }
    const maxEngagement = Math.max(...chartDays.map(d => d.engagement), 1);

    const chartBars = chartDays.map(d => {
      const h = Math.max(4, (d.engagement / maxEngagement) * 140);
      return `<div class="bar" style="height:${h}px;background:linear-gradient(180deg,#0284c7,#38bdf8)" title="${d.key}: ${d.engagement} engagements"><span class="bar-label">${d.label}</span></div>`;
    }).join('');

    // Platform breakdown
    let platformHTML = '';
    for (const [pl, stats] of Object.entries(platformStats)) {
      const rate = stats.reach > 0 ? ((stats.engagement / stats.reach) * 100).toFixed(1) : 0;
      platformHTML += `<div style="display:flex;align-items:center;gap:12px;padding:10px;border-bottom:1px solid #f1f5f9">
        ${platformBadge(pl)}
        <div style="flex:1"><strong>${PLATFORM_LABELS[pl]}</strong><br><span style="font-size:12px;color:#64748b">${stats.posts} posts</span></div>
        <div style="text-align:right"><strong>${stats.engagement}</strong> <span style="font-size:12px;color:#64748b">engagements</span><br><strong>${stats.reach}</strong> <span style="font-size:12px;color:#64748b">reach</span></div>
        <div style="width:80px"><div class="sm-progress"><div class="sm-progress-fill" style="width:${Math.min(100,rate*2)}%;background:${PLATFORM_COLORS[pl]}"></div></div><div style="font-size:11px;color:#64748b;text-align:center">${rate}%</div></div>
      </div>`;
    }

    // Best posting times (simulated)
    const bestTimes = [
      { time: '8:00 AM', day: 'Weekdays', score: 92, label: '🌅 Morning' },
      { time: '12:30 PM', day: 'Weekdays', score: 78, label: '🍽️ Lunch' },
      { time: '3:00 PM', day: 'Weekdays', score: 85, label: '📚 After School' },
      { time: '7:00 PM', day: 'All Days', score: 88, label: '🌙 Evening' },
      { time: '9:00 AM', day: 'Saturday', score: 75, label: '☀️ Weekend Morning' },
    ];

    const page = `<div class="sm-wrap">
      <div class="sm-flex-between" style="margin-bottom:24px">
        <h1 style="margin:0;font-size:24px"><a href="/school/social-media" style="color:#64748b;text-decoration:none">📱</a> 📊 Analytics</h1>
        <div class="sm-flex">
          <select class="sm-select" style="width:auto" onchange="location.href='/school/social-media/analytics?days='+this.value">
            <option value="7" ${days===7?'selected':''}>Last 7 Days</option>
            <option value="14" ${days===14?'selected':''}>Last 14 Days</option>
            <option value="30" ${days===30?'selected':''}>Last 30 Days</option>
            <option value="90" ${days===90?'selected':''}>Last 90 Days</option>
          </select>
          <a href="/school/social-media" class="sm-btn" style="background:#64748b;color:#fff">← Dashboard</a>
        </div>
      </div>
      <div class="sm-grid">
        <div class="sm-card sm-stat"><div class="num">${totalReach.toLocaleString()}</div><div class="lbl">Total Reach</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#faf5ff,#f3e8ff)"><div class="num" style="color:#7c3aed">${totalLikes.toLocaleString()}</div><div class="lbl">Total Likes</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#fff7ed,#ffedd5)"><div class="num" style="color:#ea580c">${totalShares.toLocaleString()}</div><div class="lbl">Total Shares</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#fdf4ff,#fae8ff)"><div class="num" style="color:#c026d3">${totalComments.toLocaleString()}</div><div class="lbl">Total Comments</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7)"><div class="num" style="color:#16a34a">${engagementRate}%</div><div class="lbl">Engagement Rate</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#fefce8,#fef9c3)"><div class="num" style="color:#ca8a04">${avgPerPost}</div><div class="lbl">Avg Engagement/Post</div></div>
      </div>
      <div class="sm-grid" style="grid-template-columns:2fr 1fr">
        <div class="sm-card">
          <h2>📈 Engagement Trend (Last 14 Days)</h2>
          <div class="sm-chart-bar">${chartBars}</div>
          <div style="text-align:center;font-size:12px;color:#64748b;margin-top:24px">Hover over bars for daily details</div>
        </div>
        <div class="sm-card">
          <h2>⏰ Best Posting Times</h2>
          ${bestTimes.map(t => `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9">
            <span style="font-size:20px">${t.label.split(' ')[0]}</span>
            <div style="flex:1"><strong>${t.time}</strong><br><span style="font-size:11px;color:#64748b">${t.day}</span></div>
            <div style="width:60px"><div class="sm-progress"><div class="sm-progress-fill" style="width:${t.score}%;background:#16a34a"></div></div></div>
            <span style="font-size:13px;font-weight:700;color:#16a34a">${t.score}%</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="sm-grid" style="grid-template-columns:1fr 1fr">
        <div class="sm-card">
          <h2>📱 Performance by Platform</h2>
          ${platformHTML || '<div class="sm-empty">No data yet. Publish posts to see analytics.</div>'}
        </div>
        <div class="sm-card">
          <h2>📋 Top Performing Posts</h2>
          ${published.sort((a,b) => {
            const pa = JSON.parse(a.performance_data||'{}'); const pb = JSON.parse(b.performance_data||'{}');
            return ((pb.likes||0)+(pb.shares||0)+(pb.comments||0)) - ((pa.likes||0)+(pa.shares||0)+(pa.comments||0));
          }).slice(0,5).map(p => {
            const perf = JSON.parse(p.performance_data||'{}');
            const eng = (perf.likes||0)+(perf.shares||0)+(perf.comments||0);
            const platforms = JSON.parse(p.platforms||'[]');
            return `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9">
              <div class="sm-flex"><strong style="font-size:13px">${esc((p.content||p.title||'').substring(0,50))}</strong></div>
              <div class="sm-flex" style="margin-top:4px;font-size:12px;color:#64748b">
                ${platforms.map(pl=>platformBadge(pl)).join('')}
                <span>❤️ ${perf.likes||0} &nbsp; 🔄 ${perf.shares||0} &nbsp; 💬 ${perf.comments||0}</span>
              </div>
            </div>`;
          }).join('') || '<div class="sm-empty">No published posts</div>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Social Media Analytics', page, req.session.user));
  }));

  /* ───────── Route: Post History ───────── */
  app.get('/school/social-media/history', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const status = req.query.status || '';
    const platform = req.query.platform || '';

    let paramIdx = 1;
    let where = `p.tenant_id=$${paramIdx++}`;
    const params = [tid];
    if (status) { where += ` AND p.status=$${paramIdx++}`; params.push(status); }
    if (platform) { where += ` AND p.platforms::jsonb @> $${paramIdx++}::jsonb`; params.push(JSON.stringify(platform)); }

    const { rows: totalRows } = await pool.query(`SELECT COUNT(*) as c FROM social_posts p WHERE ${where}`, params);
    const totalPages = Math.ceil(totalRows[0].c / limit);

    const { rows: posts } = await pool.query(`SELECT p.* FROM social_posts p WHERE ${where} ORDER BY p.created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, [...params, limit, offset]);

    const statusFilter = ['draft','scheduled','published','failed'].map(s =>
      `<a href="/school/social-media/history?status=${s}&platform=${platform}" class="sm-chip ${status===s?'active':''}">${statusBadge(s)}</a>`
    ).join('');

    const platformFilter = PLATFORMS.map(p =>
      `<a href="/school/social-media/history?status=${status}&platform=${p}" class="sm-chip ${platform===p?'active':''}">${platformBadge(p)} ${PLATFORM_LABELS[p]}</a>`
    ).join('');

    let tableHTML = '';
    if (posts.length === 0) {
      tableHTML = `<div class="sm-empty"><div class="icon">📚</div>No posts found.</div>`;
    } else {
      tableHTML = `<table class="sm-table"><thead><tr><th>ID</th><th>Title/Content</th><th>Platforms</th><th>Status</th><th>Scheduled</th><th>Published</th><th>Engagement</th><th>Actions</th></tr></thead><tbody>`;
      for (const p of posts) {
        const platforms = JSON.parse(p.platforms || '[]');
        const perf = JSON.parse(p.performance_data || '{}');
        const eng = (perf.likes||0)+(perf.shares||0)+(perf.comments||0);
        tableHTML += `<tr>
          <td style="color:#94a3b8">#${p.id}</td>
          <td style="max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap"><strong>${esc(p.title||'')}</strong><br><span style="font-size:12px;color:#64748b">${esc((p.content||'').substring(0,80))}${(p.content||'').length>80?'...':''}</span></td>
          <td>${platforms.map(pl=>platformBadge(pl)).join('')}</td>
          <td>${statusBadge(p.status)}${p.approval_status!=='none'?`<br><span style="font-size:11px;color:#64748b">Approval: ${p.approval_status}</span>`:''}</td>
          <td style="white-space:nowrap;font-size:13px">${p.scheduled_at ? new Date(p.scheduled_at).toLocaleString() : '-'}</td>
          <td style="white-space:nowrap;font-size:13px">${p.published_at ? new Date(p.published_at).toLocaleString() : '-'}</td>
          <td>${p.status==='published'?`❤️ ${perf.likes||0} 🔄 ${perf.shares||0} 💬 ${perf.comments||0}<br><strong>${eng}</strong> total`:'-'}</td>
          <td>
            <a href="/school/social-media/compose?edit=${p.id}" class="sm-btn sm-btn-sm sm-btn-primary">Edit</a>
            ${p.status==='draft'?`<form method="POST" action="/school/social-media/scheduled/${p.id}" style="display:inline" onsubmit="return confirm('Delete this post?')"><input type="hidden" name="_method" value="DELETE"><button class="sm-btn sm-btn-sm sm-btn-danger">Delete</button></form>`:''}
          </td></tr>`;
      }
      tableHTML += `</tbody></table>`;
    }

    let pagination = '';
    if (totalPages > 1) {
      pagination = `<div style="display:flex;gap:6px;justify-content:center;margin-top:16px">`;
      for (let i = 1; i <= totalPages; i++) {
        pagination += `<a href="/school/social-media/history?page=${i}&status=${status}&platform=${platform}" class="sm-btn sm-btn-sm ${i===page?'sm-btn-primary':''}">${i}</a>`;
      }
      pagination += `</div>`;
    }

    const pageHTML = `<div class="sm-wrap">
      <div class="sm-flex-between" style="margin-bottom:24px">
        <h1 style="margin:0;font-size:24px"><a href="/school/social-media" style="color:#64748b;text-decoration:none">📱</a> 📚 Post History (${totalRows[0].c})</h1>
        <a href="/school/social-media" class="sm-btn" style="background:#64748b;color:#fff">← Dashboard</a>
      </div>
      <div class="sm-card">
        <div style="margin-bottom:12px"><strong style="font-size:13px">Filter by Status:</strong> ${statusFilter}</div>
        <div style="margin-bottom:12px"><strong style="font-size:13px">Filter by Platform:</strong> ${platformFilter}</div>
      </div>
      <div class="sm-card">${tableHTML}</div>
      ${pagination}
    </div>`;
    res.send(renderPage('Post History', pageHTML, req.session.user));
  }));

  /* ───────── Route: Auto-Post Rules ───────── */
  app.get('/school/social-media/rules', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { rows: rules } = await pool.query(`SELECT r.*, t.name as template_name FROM social_post_rules r LEFT JOIN post_templates t ON t.id=r.template_id WHERE r.tenant_id=$1 ORDER BY r.is_active DESC, r.created_at DESC`, [tid]);
    const { rows: templates } = await pool.query(`SELECT id, name, category FROM post_templates WHERE (tenant_id=0 OR tenant_id=$1) ORDER BY name`, [tid]);

    const triggerTypes = [
      { value: 'exam_results', label: 'After Exam Results Published', icon: '📝', desc: 'Auto-post topper announcements when exam results are published' },
      { value: 'holiday_notice', label: 'Before Holidays', icon: '🏖️', desc: 'Post holiday notice X days before scheduled holidays' },
      { value: 'sports_event', label: 'After Sports Events', icon: '🏆', desc: 'Post results and highlights after sports events conclude' },
      { value: 'weekly_digest', label: 'Weekly Achievement Digest', icon: '📊', desc: 'Generate weekly digest of school achievements every Monday' },
      { value: 'event_reminder', label: 'Event Reminder', icon: '🔔', desc: 'Send reminders before upcoming events' },
      { value: 'attendance_alert', label: 'Low Attendance Alert', icon: '⚠️', desc: 'Post attendance awareness messages when below threshold' },
    ];

    const templateOptions = templates.map(t => `<option value="${t.id}">${esc(t.name)} (${t.category})</option>`).join('');

    let rulesHTML = '';
    if (rules.length === 0) {
      rulesHTML = `<div class="sm-empty"><div class="icon">🤖</div>No auto-post rules configured yet.<br><br>Set up rules to automate your social media posting!</div>`;
    } else {
      rulesHTML = rules.map(r => {
        const platforms = JSON.parse(r.platforms || '[]');
        const config = JSON.parse(r.trigger_config || '{}');
        const triggerInfo = triggerTypes.find(t => t.value === r.trigger_type);
        return `<div class="sm-card" style="border-left:4px solid ${r.is_active?'#16a34a':'#dc2626'}">
          <div class="sm-flex-between">
            <div><h2 style="margin:0">${triggerInfo?.icon||'⚙️'} ${esc(r.rule_name||triggerInfo?.label||r.trigger_type)}</h2>
            <span style="font-size:12px;color:#64748b">${triggerInfo?.desc||''}</span></div>
            <div class="sm-flex">
              <label class="sm-switch"><input type="checkbox" ${r.is_active?'checked':''} onchange="toggleRule(${r.id}, this.checked)"><span class="slider"></span></label>
              <button onclick="deleteRule(${r.id})" class="sm-btn sm-btn-sm sm-btn-danger">Delete</button>
            </div>
          </div>
          <div style="margin-top:12px;display:flex;gap:16px;flex-wrap:wrap;font-size:13px">
            <span>📋 Template: <strong>${esc(r.template_name||'Custom')}</strong></span>
            <span>📱 Platforms: ${platforms.map(pl=>platformBadge(pl)).join('')}</span>
            <span>🔄 Runs: ${r.run_count||0}</span>
            ${r.last_triggered?`<span>🕐 Last: ${new Date(r.last_triggered).toLocaleDateString()}</span>`:''}
          </div>
          ${Object.keys(config).length ? `<div style="margin-top:8px;font-size:12px;color:#64748b">Config: ${Object.entries(config).map(([k,v])=>`<strong>${k}</strong>=${v}`).join(', ')}</div>` : ''}
        </div>`;
      }).join('');
    }

    const page = `<div class="sm-wrap">
      <div class="sm-flex-between" style="margin-bottom:24px">
        <h1 style="margin:0;font-size:24px"><a href="/school/social-media" style="color:#64748b;text-decoration:none">📱</a> 🤖 Auto-Post Rules (${rules.length})</h1>
        <a href="/school/social-media" class="sm-btn" style="background:#64748b;color:#fff">← Dashboard</a>
      </div>
      <div class="sm-card" style="border:2px dashed #cbd5e1">
        <h2>➕ Create Auto-Post Rule</h2>
        <form method="POST" action="/school/social-media/rules/save">
          <div class="sm-form-group"><label class="sm-label">Rule Name</label><input class="sm-input" name="rule_name" required placeholder="e.g. Auto Exam Results Post"></div>
          <div class="sm-form-group"><label class="sm-label">Trigger Type</label>
            <select class="sm-select" name="trigger_type" id="triggerType" onchange="updateTriggerConfig()">
              ${triggerTypes.map(t => `<option value="${t.value}">${t.icon} ${t.label}</option>`).join('')}
            </select>
          </div>
          <div id="triggerConfigArea" class="sm-form-group"><label class="sm-label">Trigger Configuration</label>
            <div id="triggerConfigFields" class="sm-grid" style="grid-template-columns:1fr 1fr">
              <div><label class="sm-label" style="font-size:12px">Days Before (for reminders)</label><input class="sm-input" name="config_days_before" type="number" value="3"></div>
              <div><label class="sm-label" style="font-size:12px">Post Time</label><input class="sm-input" name="config_post_time" type="time" value="09:00"></div>
            </div>
          </div>
          <div class="sm-form-group"><label class="sm-label">Template</label>
            <select class="sm-select" name="template_id">
              <option value="">— Use trigger default —</option>
              ${templateOptions}
            </select>
          </div>
          <div class="sm-form-group"><label class="sm-label">Platforms</label>
            <div class="sm-flex">${PLATFORMS.map(p=>`<label style="display:flex;align-items:center;gap:4px"><input type="checkbox" name="platforms" value="${p}" checked> ${platformBadge(p)} ${PLATFORM_LABELS[p]}</label>`).join('')}</div>
          </div>
          <button type="submit" class="sm-btn sm-btn-primary">💾 Save Rule</button>
        </form>
      </div>
      <h2 style="margin:24px 0 12px">Active Rules</h2>
      ${rulesHTML}
      <script>
        function updateTriggerConfig() {
          const type=document.getElementById('triggerType').value;
          const fields=document.getElementById('triggerConfigFields');
          const configs = {
            exam_results: '<div><label class="sm-label" style="font-size:12px">Include Top N Students</label><input class="sm-input" name="config_top_n" type="number" value="5"></div><div><label class="sm-label" style="font-size:12px">Min Score Threshold</label><input class="sm-input" name="config_min_score" type="number" value="90"></div>',
            holiday_notice: '<div><label class="sm-label" style="font-size:12px">Days Before Holiday</label><input class="sm-input" name="config_days_before" type="number" value="3"></div><div><label class="sm-label" style="font-size:12px">Post Time</label><input class="sm-input" name="config_post_time" type="time" value="09:00"></div>',
            sports_event: '<div><label class="sm-label" style="font-size:12px">Include Highlights</label><select class="sm-select" name="config_highlights"><option value="1">Yes</option><option value="0">No</option></select></div><div><label class="sm-label" style="font-size:12px">Include Scores</label><select class="sm-select" name="config_scores"><option value="1">Yes</option><option value="0">No</option></select></div>',
            weekly_digest: '<div><label class="sm-label" style="font-size:12px">Day of Week</label><select class="sm-select" name="config_day"><option value="1">Monday</option><option value="5">Friday</option></select></div><div><label class="sm-label" style="font-size:12px">Post Time</label><input class="sm-input" name="config_post_time" type="time" value="09:00"></div>',
            event_reminder: '<div><label class="sm-label" style="font-size:12px">Remind Days Before</label><input class="sm-input" name="config_days_before" type="number" value="1"></div><div><label class="sm-label" style="font-size:12px">Post Time</label><input class="sm-input" name="config_post_time" type="time" value="08:00"></div>',
            attendance_alert: '<div><label class="sm-label" style="font-size:12px">Threshold %</label><input class="sm-input" name="config_threshold" type="number" value="75"></div><div><label class="sm-label" style="font-size:12px">Frequency</label><select class="sm-select" name="config_frequency"><option value="weekly">Weekly</option><option value="monthly">Monthly</option></select></div>',
          };
          fields.innerHTML=configs[type]||'<div><label class="sm-label" style="font-size:12px">Post Time</label><input class="sm-input" name="config_post_time" type="time" value="09:00"></div>';
        }
        async function toggleRule(id, active) { try{await fetch('/school/social-media/rules/'+id+'/toggle',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({is_active:active})});}catch(e){alert('Error');} }
        async function deleteRule(id) { if(!confirm('Delete this rule?'))return; try{await fetch('/school/social-media/rules/'+id,{method:'DELETE'});location.reload();}catch(e){alert('Error');} }
      </script>
    </div>`;
    res.send(renderPage('Auto-Post Rules', page, req.session.user));
  }));

  app.post('/school/social-media/rules/save', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { rule_name, trigger_type, template_id, platforms, config_days_before, config_post_time, config_top_n, config_min_score, config_highlights, config_scores, config_day, config_threshold, config_frequency } = req.body;
    const platformArr = Array.isArray(platforms) ? platforms : (platforms ? [platforms] : []);

    const config = {};
    if (config_days_before) config.days_before = parseInt(config_days_before);
    if (config_post_time) config.post_time = config_post_time;
    if (config_top_n) config.top_n = parseInt(config_top_n);
    if (config_min_score) config.min_score = parseInt(config_min_score);
    if (config_highlights !== undefined) config.include_highlights = config_highlights === '1';
    if (config_scores !== undefined) config.include_scores = config_scores === '1';
    if (config_day) config.day_of_week = parseInt(config_day);
    if (config_threshold) config.threshold = parseInt(config_threshold);
    if (config_frequency) config.frequency = config_frequency;

    await pool.query(`INSERT INTO social_post_rules (tenant_id, rule_name, trigger_type, trigger_config, template_id, platforms, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`,
      [tid, rule_name || trigger_type, trigger_type, JSON.stringify(config), template_id || null, JSON.stringify(platformArr)]);

    audit(req, 'social_rule_create', { trigger_type, rule_name });
    res.redirect('/school/social-media/rules');
  }));

  app.post('/school/social-media/rules/:id/toggle', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { is_active } = req.body;
    await pool.query(`UPDATE social_post_rules SET is_active=$1 WHERE id=$2 AND tenant_id=$3`, [is_active ? true : false, req.params.id, tid]);
    res.json({ ok: true });
  }));

  app.delete('/school/social-media/rules/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(`DELETE FROM social_post_rules WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.json({ ok: true });
  }));

  /* ───────── Route: Hashtag Manager ───────── */
  app.get('/school/social-media/hashtags', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { rows: hashtags } = await pool.query(`SELECT * FROM social_hashtags WHERE tenant_id IN (0,$1) ORDER BY is_trending DESC, usage_count DESC`, [tid]);
    const { rows: schoolHashtags } = await pool.query(`SELECT * FROM social_hashtags WHERE tenant_id=$1 ORDER BY usage_count DESC`, [tid]);
    const { rows: trendingHashtags } = await pool.query(`SELECT * FROM social_hashtags WHERE tenant_id IN (0,$1) AND is_trending=true ORDER BY trend_score DESC LIMIT 20`, [tid]);
    const categories = [...new Set(hashtags.map(h => h.category).filter(Boolean))];

    let trendingHTML = trendingHashtags.map(h => `
      <div class="sm-card" style="border-left:3px solid ${h.trend_score > 85 ? '#dc2626' : h.trend_score > 70 ? '#d97706' : '#0284c7'}">
        <div class="sm-flex-between">
          <div><strong style="font-size:15px">${esc(h.tag)}</strong> <span class="sm-badge" style="background:#fef2f2;color:#dc2626">🔥 Trending</span></div>
          <span style="font-size:13px;color:#64748b">Score: ${h.trend_score}</span>
        </div>
        <div style="font-size:12px;color:#64748b;margin-top:6px">Used ${h.usage_count} times • ${esc(h.category||'general')}</div>
        <div class="sm-progress" style="margin-top:6px"><div class="sm-progress-fill" style="width:${h.trend_score}%;background:linear-gradient(90deg,#0284c7,#dc2626)"></div></div>
      </div>
    `).join('');

    let allTagsHTML = `<table class="sm-table"><thead><tr><th>Hashtag</th><th>Category</th><th>Uses</th><th>Trending</th><th>Score</th><th>Actions</th></tr></thead><tbody>`;
    for (const h of schoolHashtags) {
      allTagsHTML += `<tr>
        <td><strong>${esc(h.tag)}</strong></td>
        <td><span class="sm-chip">${esc(h.category||'general')}</span></td>
        <td>${h.usage_count}</td>
        <td>${h.is_trending ? '<span style="color:#dc2626">🔥 Yes</span>' : '<span style="color:#94a3b8">No</span>'}</td>
        <td>${h.trend_score}</td>
        <td>
          <button onclick="incrementHashtag(${h.id})" class="sm-btn sm-btn-sm" style="background:#0284c7;color:#fff">+1 Use</button>
          <form method="POST" action="/school/social-media/hashtags/${h.id}/delete" style="display:inline" onsubmit="return confirm('Delete this hashtag?')"><button class="sm-btn sm-btn-sm sm-btn-danger">Delete</button></form>
        </td></tr>`;
    }
    if (schoolHashtags.length === 0) allTagsHTML += `<tr><td colspan="6" class="sm-empty">No school hashtags yet. Add some below!</td></tr>`;
    allTagsHTML += `</tbody></table>`;

    const categoryOptions = categories.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');

    const page = `<div class="sm-wrap">
      <div class="sm-flex-between" style="margin-bottom:24px">
        <h1 style="margin:0;font-size:24px"><a href="/school/social-media" style="color:#64748b;text-decoration:none">📱</a> #️⃣ Hashtag Manager</h1>
        <a href="/school/social-media" class="sm-btn" style="background:#64748b;color:#fff">← Dashboard</a>
      </div>
      <div class="sm-grid" style="grid-template-columns:repeat(4,1fr)">
        <div class="sm-card sm-stat"><div class="num">${schoolHashtags.length}</div><div class="lbl">School Hashtags</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#fef2f2,#fee2e2)"><div class="num" style="color:#dc2626">${trendingHashtags.length}</div><div class="lbl">Trending Now</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#f0fdf4,#dcfce7)"><div class="num" style="color:#16a34a">${schoolHashtags.reduce((a,h)=>a+h.usage_count,0)}</div><div class="lbl">Total Usage</div></div>
        <div class="sm-card sm-stat" style="background:linear-gradient(135deg,#faf5ff,#f3e8ff)"><div class="num" style="color:#7c3aed">${categories.length}</div><div class="lbl">Categories</div></div>
      </div>
      <div class="sm-card" style="border:2px dashed #cbd5e1">
        <h2>➕ Add School Hashtag</h2>
        <form method="POST" action="/school/social-media/hashtags/save" style="display:flex;gap:12px;align-items:flex-end;flex-wrap:wrap">
          <div style="flex:1;min-width:200px"><label class="sm-label">Hashtag</label><input class="sm-input" name="tag" placeholder="#OurSchool" required></div>
          <div style="flex:1;min-width:150px"><label class="sm-label">Category</label><select class="sm-select" name="category">
            <option value="school">School</option><option value="academics">Academics</option><option value="sports">Sports</option>
            <option value="events">Events</option><option value="achievement">Achievement</option><option value="general">General</option>
            <option value="custom">Custom</option>${categoryOptions}
          </select></div>
          <div><label class="sm-label">&nbsp;</label><button type="submit" class="sm-btn sm-btn-primary">Add</button></div>
        </form>
      </div>
      <h2 style="margin-top:20px">🔥 Trending Education Hashtags</h2>
      <div class="sm-grid">${trendingHTML}</div>
      <h2 style="margin-top:24px">🏷️ School Hashtags (${schoolHashtags.length})</h2>
      <div class="sm-card">${allTagsHTML}</div>
      <script>
        async function incrementHashtag(id) { try{await fetch('/school/social-media/hashtags/'+id+'/increment',{method:'POST'});location.reload();}catch(e){alert('Error');} }
      </script>
    </div>`;
    res.send(renderPage('Hashtag Manager', page, req.session.user));
  }));

  app.post('/school/social-media/hashtags/save', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    let tag = req.body.tag.trim();
    if (!tag) return res.status(400).send('Tag required');
    if (!tag.startsWith('#')) tag = '#' + tag;
    const category = req.body.category || 'general';
    try {
      await pool.query(`INSERT INTO social_hashtags (tenant_id, tag, category) VALUES ($1,$2,$3)`, [tid, tag, category]);
    } catch(e) {
      if (e.code === '23505') {
        return res.redirect('/school/social-media/hashtags?msg=exists');
      }
      throw e;
    }
    audit(req, 'hashtag_add', { tag, category });
    res.redirect('/school/social-media/hashtags');
  }));

  app.post('/school/social-media/hashtags/:id/increment', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(`UPDATE social_hashtags SET usage_count = usage_count + 1 WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.json({ ok: true });
  }));

  app.post('/school/social-media/hashtags/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(`DELETE FROM social_hashtags WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.redirect('/school/social-media/hashtags');
  }));

  /* ───────── Route: Bulk Schedule ───────── */
  app.post('/school/social-media/bulk-schedule', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { posts_json, default_platforms, default_timezone, start_date, interval_hours } = req.body;

    let posts;
    try {
      posts = JSON.parse(posts_json);
    } catch(e) {
      return res.status(400).send('Invalid posts JSON');
    }

    if (!Array.isArray(posts) || posts.length === 0) return res.status(400).send('At least one post required');
    if (posts.length > 50) return res.status(400).send('Maximum 50 posts per bulk operation');

    const platformArr = Array.isArray(default_platforms) ? default_platforms : (default_platforms ? [default_platforms] : []);
    const startDate = new Date(start_date);
    const interval = parseFloat(interval_hours) || 24;

    let scheduled = 0;
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      const schedAt = new Date(startDate.getTime() + i * interval * 3600000);
      const media = [];
      if (p.image_urls) p.image_urls.split('\n').map(u=>u.trim()).filter(Boolean).forEach(u => media.push({type:'image',url:u}));

      await pool.query(`INSERT INTO social_posts (tenant_id, title, content, media_urls, platforms, status, scheduled_at, priority, timezone, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [tid, p.title||null, p.content, JSON.stringify(media), JSON.stringify(platformArr), 'scheduled', schedAt.toISOString().slice(0,19).replace('T',' '), p.priority||0, default_timezone||'UTC', req.session.user?.id||null]);
      scheduled++;
    }

    audit(req, 'bulk_schedule', { count: scheduled, start_date, interval });
    res.redirect('/school/social-media/scheduled');
  }));

  /* ───────── Process scheduled posts (cron-like) ───────── */
  // This would typically be called by a cron job, but we also expose an admin endpoint
  app.post('/school/social-media/process-queue', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { rows: duePosts } = await pool.query(`SELECT p.*, sa.platform, sa.access_token_encrypted FROM social_posts p JOIN social_accounts sa ON sa.tenant_id=p.tenant_id AND p.platforms::jsonb @> to_jsonb(sa.platform) AND sa.is_active=true WHERE p.tenant_id=$1 AND p.status='scheduled' AND p.scheduled_at <= NOW() AND p.approval_status IN ('none','approved')`, [tid]);

    let processed = 0;
    const processedIds = [];
    for (const post of duePosts) {
      if (processedIds.includes(post.id)) continue;
      processedIds.push(post.id);

      // Simulate API call to each platform
      const platforms = JSON.parse(post.platforms || '[]');
      const results = {};
      let failed = false;
      for (const pl of platforms) {
        try {
          // In production: call actual social media APIs here
          results[pl] = { status: 'success', published_at: now(), post_id: 'ext_' + Date.now() };
        } catch(e) {
          results[pl] = { status: 'error', message: e.message };
          failed = true;
        }
      }

      const newStatus = failed ? 'failed' : 'published';
      await pool.query(`UPDATE social_posts SET status=$1, published_at=$2, performance_data=$3 WHERE id=$4`, [newStatus, failed ? null : now(), JSON.stringify(results), post.id]);
      processed++;
    }

    // Process auto-post rules
    const { rows: rules } = await pool.query(`SELECT * FROM social_post_rules WHERE tenant_id=$1 AND is_active=true`, [tid]);
    for (const rule of rules) {
      const trigger = rule.trigger_type;
      const config = JSON.parse(rule.trigger_config || '{}');
      const platforms = JSON.parse(rule.platforms || '[]');
      // Simulate rule evaluation
      let shouldTrigger = false;
      let content = '';
      if (trigger === 'weekly_digest') {
        const dayOfWeek = new Date().getDay();
        if (config.day_of_week && dayOfWeek === config.day_of_week) {
          shouldTrigger = true;
          content = `📊 Weekly Achievement Digest — ${new Date().toLocaleDateString('en',{weekday:'long'})}\n\nHighlights from this week at our school. Stay tuned for amazing updates! ✨`;
        }
      }
      if (shouldTrigger && content) {
        await pool.query(`INSERT INTO social_posts (tenant_id, title, content, platforms, status, scheduled_at, priority, timezone) VALUES ($1,$2,$3,$4,'scheduled',NOW() + INTERVAL '1 hour',1,'UTC')`,
          [tid, `Auto: ${rule.rule_name}`, content, JSON.stringify(platforms)]);
        await pool.query(`UPDATE social_post_rules SET last_triggered=NOW(), run_count=run_count+1 WHERE id=$1`, [rule.id]);
      }
    }

    res.json({ processed, rules_evaluated: rules.length });
  }));

  /* ───────── Module info ───────── */
  console.log('[social-media-autopost] Module loaded — 23 routes registered');
};
