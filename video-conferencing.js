// ============================================================
// VIDEO CONFERENCING MODULE — School SaaS Portal
// Virtual classrooms, meeting scheduler, recording management,
// attendance tracking, breakout rooms, meeting analytics, notes.
// ============================================================
// Usage in server.js:
//   const videoConf = require('./video-conferencing');
//   videoConf(app, pool, { esc, renderPage, ah, requireAuth, audit });
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const { migrateQuery } = require('./db');
function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}
function formatDateTime(d) {
  if (!d) return '—';
  return new Date(d).toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true });
}
function formatTime(d) {
  if (!d) return '';
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}
function formatDurationSecs(secs) {
  if (!secs) return '—';
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h > 0) return h + 'h ' + m + 'm ' + s + 's';
  if (m > 0) return m + 'm ' + s + 's';
  return s + 's';
}
function formatDurationMins(mins) {
  if (!mins) return '—';
  const h = Math.floor(mins / 60), m = mins % 60;
  return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
}
function initials(name) {
  if (!name) return '?';
  return String(name).split(/[\s._\-]+/).slice(0, 2).map(p => (p[0] || '').toUpperCase()).join('');
}
function avatarColor(str) {
  if (!str) return '#6366f1';
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#6366f1','#3b82f6','#06b6d4','#10b981','#f59e0b','#ef4444','#ec4899','#8b5cf6','#14b8a6','#f97316'];
  return colors[Math.abs(hash) % colors.length];
}
function generateMeetingCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 3; i++) code += chars[Math.floor(Math.random() * chars.length)];
  code += '-';
  for (let i = 0; i < 4; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}
function relativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date(), d = new Date(dateStr);
  const diffSec = Math.floor((now - d) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return diffMin + 'm ago';
  if (diffHr < 24) return diffHr + 'h ago';
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return diffDay + 'd ago';
  return formatDate(dateStr);
}
function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

// ============================================================
// SHARED CSS — Professional Video Conferencing UI
// ============================================================
const VC_CSS = `<style>
*{box-sizing:border-box}
.vc-wrap{max-width:1300px;margin:0 auto;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif}
.vc-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.vc-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.vc-nav a:hover{background:#e2e8f0}.vc-nav a.active{background:#6366f1;color:#fff}
.vc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px}
.vc-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center}
.vc-stat-num{font-size:28px;font-weight:800;color:#1e293b}
.vc-stat-label{font-size:12px;color:#64748b;margin-top:4px}
.vc-stat-icon{font-size:22px;margin-bottom:6px}
.vc-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:16px}
.vc-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:20px;transition:.2s;position:relative;overflow:hidden}
.vc-card:hover{box-shadow:0 4px 20px rgba(0,0,0,.06)}
.vc-card-active{border-left:4px solid #22c55e}.vc-card-scheduled{border-left:4px solid #3b82f6}
.vc-card-ended{border-left:4px solid #94a3b8}.vc-card-cancelled{border-left:4px solid #ef4444}
.vc-card-header{display:flex;justify-content:space-between;align-items:start;margin-bottom:10px}
.vc-card-title{font-size:16px;font-weight:700;color:#1e293b;margin:0;display:flex;align-items:center;gap:8px}
.vc-card-meta{display:flex;gap:14px;font-size:12px;color:#64748b;margin-bottom:12px;flex-wrap:wrap}
.vc-card-meta span{display:inline-flex;align-items:center;gap:4px}
.vc-badge{display:inline-block;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:700}
.vc-badge-active{background:#dcfce7;color:#16a34a}.vc-badge-scheduled{background:#dbeafe;color:#1d4ed8}
.vc-badge-ended{background:#f1f5f9;color:#64748b}.vc-badge-cancelled{background:#fee2e2;color:#dc2626}
.vc-badge-live{background:#ef4444;color:#fff;animation:vc-pulse 1.5s infinite}
@keyframes vc-pulse{0%,100%{opacity:1}50%{opacity:.6}}
.vc-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.vc-btn:hover{opacity:.9;transform:translateY(-1px)}
.vc-btn-primary{background:#6366f1;color:#fff}.vc-btn-success{background:#059669;color:#fff}
.vc-btn-danger{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
.vc-btn-secondary{background:#f1f5f9;color:#475569}.vc-btn-sm{padding:5px 12px;font-size:11px;border-radius:8px}
.vc-btn-warning{background:#fef3c7;color:#b45309}
.vc-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
.vc-form input,.vc-form select,.vc-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;font-family:inherit;transition:.15s}
.vc-form input:focus,.vc-form select:focus,.vc-form textarea:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
.vc-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.vc-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px}
.vc-table{width:100%;border-collapse:collapse;font-size:13px}
.vc-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.vc-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.vc-table tr:hover{background:#f8fafc}
.vc-avatar{width:36px;height:36px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;flex-shrink:0}
.vc-avatar-sm{width:28px;height:28px;font-size:11px}.vc-avatar-lg{width:48px;height:48px;font-size:18px}
.vc-avatar-xl{width:64px;height:64px;font-size:24px}
.vc-panel{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden}
.vc-panel-header{padding:16px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between}
.vc-panel-header h3{margin:0;font-size:16px;color:#1e293b}
.vc-panel-body{padding:20px}
.vc-empty{text-align:center;padding:60px 20px;color:#94a3b8}
.vc-empty-icon{font-size:48px;margin-bottom:12px}
.vc-empty h3{color:#64748b;margin:0 0 4px;font-size:16px}
.vc-empty p{font-size:13px;margin:0}
.vc-meeting-room{background:#0f172a;border-radius:16px;overflow:hidden;min-height:500px;position:relative}
.vc-room-header{background:linear-gradient(135deg,#1e293b,#334155);padding:14px 20px;display:flex;align-items:center;justify-content:space-between;color:#fff}
.vc-room-body{display:grid;grid-template-columns:1fr 280px;gap:0;min-height:460px}
.vc-video-area{display:grid;grid-template-columns:1fr 1fr;gap:8px;padding:16px;align-content:start}
.vc-video-tile{background:#1e293b;border-radius:12px;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:48px;position:relative}
.vc-video-tile .vc-video-name{position:absolute;bottom:8px;left:8px;background:rgba(0,0,0,.6);color:#fff;padding:3px 10px;border-radius:6px;font-size:11px}
.vc-video-tile .vc-video-mic{position:absolute;bottom:8px;right:8px;color:#ef4444;font-size:14px}
.vc-sidebar-panel{background:#1e293b;color:#fff;padding:16px;overflow-y:auto}
.vc-sidebar-panel h4{margin:0 0 12px;font-size:14px;color:#e2e8f0}
.vc-participant-item{display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px}
.vc-controls{display:flex;gap:8px;justify-content:center;padding:12px;background:#1e293b;border-radius:12px}
.vc-ctrl-btn{width:44px;height:44px;border-radius:50%;border:none;display:flex;align-items:center;justify-content:center;font-size:18px;cursor:pointer;transition:.15s}
.vc-ctrl-btn:hover{transform:scale(1.1)}
.vc-ctrl-mic{background:#334155;color:#fff}.vc-ctrl-cam{background:#334155;color:#fff}
.vc-ctrl-screen{background:#334155;color:#fff}.vc-ctrl-chat{background:#334155;color:#fff}
.vc-ctrl-end{background:#ef4444;color:#fff}.vc-ctrl-record{background:#334155;color:#fff}
.vc-ctrl-btn.active{background:#ef4444;color:#fff}
.vc-bar{height:24px;border-radius:6px;min-width:4px;transition:width .3s}
.vc-bar-container{background:#f1f5f9;border-radius:6px;overflow:hidden;width:100%}
.vc-section{margin-bottom:24px}
.vc-section-title{font-size:18px;font-weight:700;color:#1e293b;margin:0 0 14px;display:flex;align-items:center;gap:8px}
.vc-tab-bar{display:flex;gap:4px;margin-bottom:16px;border-bottom:2px solid #e2e8f0;padding-bottom:0}
.vc-tab-bar button{padding:10px 20px;border:none;background:none;font-size:14px;font-weight:600;color:#64748b;cursor:pointer;border-bottom:2px solid transparent;margin-bottom:-2px;transition:.15s}
.vc-tab-bar button:hover{color:#6366f1}.vc-tab-bar button.active{color:#6366f1;border-bottom-color:#6366f1}
.vc-toggle-row{display:flex;align-items:center;justify-content:space-between;padding:12px 0;border-bottom:1px solid #f1f5f9}
.vc-toggle-row:last-child{border-bottom:none}
.vc-toggle-label{font-size:14px;font-weight:600;color:#1e293b}
.vc-toggle-desc{font-size:12px;color:#94a3b8;margin-top:2px}
.vc-toggle{position:relative;width:44px;height:24px;cursor:pointer;display:inline-block}
.vc-toggle input{display:none}
.vc-toggle span{position:absolute;inset:0;background:#cbd5e1;border-radius:12px;transition:.2s}
.vc-toggle span::after{content:'';position:absolute;left:2px;top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.vc-toggle input:checked+span{background:#6366f1}
.vc-toggle input:checked+span::after{left:22px}
.vc-timeline{position:relative;padding-left:28px}
.vc-timeline::before{content:'';position:absolute;left:10px;top:0;bottom:0;width:2px;background:#e2e8f0}
.vc-timeline-item{position:relative;padding-bottom:20px}
.vc-timeline-item::before{content:'';position:absolute;left:-22px;top:4px;width:12px;height:12px;border-radius:50%;background:#6366f1;border:2px solid #fff}
.vc-note-card{background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:14px;margin-bottom:10px}
.vc-note-card h4{margin:0 0 6px;color:#92400e;font-size:14px}
.vc-note-card p{margin:0;color:#78350f;font-size:13px;line-height:1.5;white-space:pre-wrap}
.vc-action-item{display:flex;align-items:start;gap:8px;padding:8px 0;border-bottom:1px solid #f1f5f9}
.vc-action-item:last-child{border-bottom:none}
.vc-action-check{width:20px;height:20px;border-radius:4px;border:2px solid #d1d5db;flex-shrink:0;cursor:pointer;margin-top:2px}
.vc-action-check.done{background:#6366f1;border-color:#6366f1;color:#fff}
.vc-template-card{background:#fff;border:2px solid #e2e8f0;border-radius:14px;padding:20px;cursor:pointer;transition:.2s;text-align:center}
.vc-template-card:hover{border-color:#6366f1;box-shadow:0 4px 16px rgba(99,102,241,.1)}
.vc-template-card.selected{border-color:#6366f1;background:#eef2ff}
.vc-template-icon{font-size:36px;margin-bottom:8px}
.vc-template-name{font-size:15px;font-weight:700;color:#1e293b;margin:0 0 4px}
.vc-template-desc{font-size:12px;color:#94a3b8;margin:0}
@media(max-width:768px){.vc-grid,.vc-grid-3{grid-template-columns:1fr}.vc-cards{grid-template-columns:1fr}.vc-room-body{grid-template-columns:1fr}.vc-sidebar-panel{display:none}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  // ============================================================
  // DATABASE MIGRATIONS (PostgreSQL)
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS virtual_meetings (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      title VARCHAR(255) NOT NULL,
      description TEXT,
      host_id INT NOT NULL DEFAULT 0,
      host_name VARCHAR(255),
      meeting_code VARCHAR(20) NOT NULL,
      scheduled_at TIMESTAMPTZ,
      duration_minutes INT DEFAULT 60,
      max_participants INT DEFAULT 50,
      status TEXT NOT NULL DEFAULT 'scheduled',
      settings JSON,
      recurring_config JSON,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT uk_meeting_code UNIQUE (meeting_code)
    )`,
    `CREATE TABLE IF NOT EXISTS meeting_participants (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      meeting_id INT NOT NULL DEFAULT 0,
      user_id INT NOT NULL DEFAULT 0,
      user_name VARCHAR(255),
      user_type TEXT DEFAULT 'student',
      role TEXT DEFAULT 'participant',
      joined_at TIMESTAMPTZ,
      left_at TIMESTAMPTZ,
      duration_seconds INT DEFAULT 0,
      is_present SMALLINT DEFAULT 0
    )`,
    `CREATE TABLE IF NOT EXISTS meeting_recordings (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      meeting_id INT NOT NULL DEFAULT 0,
      recording_url VARCHAR(500),
      file_size_mb DECIMAL(10,2) DEFAULT 0,
      duration_seconds INT DEFAULT 0,
      recorded_by INT DEFAULT 0,
      thumbnail_url VARCHAR(500),
      retention_delete_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS meeting_templates (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      name VARCHAR(255) NOT NULL,
      description TEXT,
      category VARCHAR(100),
      default_duration INT DEFAULT 60,
      default_settings JSON,
      is_system SMALLINT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS meeting_notes (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      meeting_id INT NOT NULL DEFAULT 0,
      notes_text TEXT,
      agenda TEXT,
      action_items JSON,
      created_by INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
    )`,
    `CREATE TABLE IF NOT EXISTS meeting_attendance_logs (
      id SERIAL PRIMARY KEY,
      tenant_id INT NOT NULL DEFAULT 0,
      meeting_id INT NOT NULL DEFAULT 0,
      participant_id INT NOT NULL DEFAULT 0,
      participant_name VARCHAR(255),
      join_time TIMESTAMPTZ,
      leave_time TIMESTAMPTZ,
      duration_seconds INT DEFAULT 0
    )`,
    `CREATE INDEX IF NOT EXISTS idx_vm_tenant ON virtual_meetings (tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_vm_host ON virtual_meetings (tenant_id, host_id)`,
    `CREATE INDEX IF NOT EXISTS idx_vm_status ON virtual_meetings (tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_vm_scheduled ON virtual_meetings (tenant_id, scheduled_at)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_meeting ON meeting_participants (meeting_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_user ON meeting_participants (tenant_id, user_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mp_tenant ON meeting_participants (tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mr_tenant ON meeting_recordings (tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mr_meeting ON meeting_recordings (meeting_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mt_tenant ON meeting_templates (tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mt_category ON meeting_templates (tenant_id, category)`,
    `CREATE INDEX IF NOT EXISTS idx_mn_meeting ON meeting_notes (meeting_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mn_tenant ON meeting_notes (tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mal_meeting ON meeting_attendance_logs (meeting_id)`,
    `CREATE INDEX IF NOT EXISTS idx_mal_participant ON meeting_attendance_logs (tenant_id, participant_id)`
  ];

  (async () => {
    try {
      for (const sql of migrations) {
        try { await pool.query(sql); } catch (e) { /* column may exist */ }
      }
      // Seed system templates
      const { rows: existing } = await pool.query("SELECT COUNT(*) as cnt FROM meeting_templates WHERE tenant_id=0 AND is_system=1");
      if (existing[0].cnt === 0) {
        const systemTemplates = [
          ['Daily Class', 'Regular classroom session for daily lessons', 'class', 45, '{"recording":true,"waiting_room":false,"mute_on_join":true,"screen_share":true,"breakout_rooms":false}'],
          ['Parent Meeting', 'Scheduled parent-teacher conference', 'parent', 30, '{"recording":true,"waiting_room":true,"mute_on_join":false,"screen_share":true,"breakout_rooms":false}'],
          ['Staff Meeting', 'School staff coordination and updates', 'staff', 60, '{"recording":true,"waiting_room":false,"mute_on_join":true,"screen_share":true,"breakout_rooms":false}'],
          ['Exam Review', 'Post-exam discussion and review session', 'exam', 50, '{"recording":true,"waiting_room":false,"mute_on_join":true,"screen_share":true,"breakout_rooms":false}'],
          ['Club Activity', 'Extracurricular club meeting', 'club', 60, '{"recording":false,"waiting_room":false,"mute_on_join":false,"screen_share":true,"breakout_rooms":true}'],
          ['One-on-One Tutoring', 'Individual student tutoring session', 'tutoring', 30, '{"recording":true,"waiting_room":true,"mute_on_join":false,"screen_share":true,"breakout_rooms":false}']
        ];
        for (const [name, desc, cat, dur, settings] of systemTemplates) {
          await pool.query("INSERT INTO meeting_templates (tenant_id,name,description,category,default_duration,default_settings,is_system) VALUES (0,$1,$2,$3,$4,$5,1)", [name, desc, cat, dur, settings]);
        }
      }
      console.log('[VideoConf] Migrations applied');
    } catch (e) { /* migration OK */ }
  })();

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================
  function statusBadge(status) {
    const map = {
      active: '<span class="vc-badge vc-badge-live">🔴 LIVE</span>',
      scheduled: '<span class="vc-badge vc-badge-scheduled">📅 Scheduled</span>',
      ended: '<span class="vc-badge vc-badge-ended">✅ Ended</span>',
      cancelled: '<span class="vc-badge vc-badge-cancelled">✕ Cancelled</span>'
    };
    return map[status] || '<span class="vc-badge vc-badge-ended">' + esc(status) + '</span>';
  }
  function cardClass(status) {
    return 'vc-card vc-card-' + (status || 'scheduled');
  }
  function nav(active) {
    return `<div class="vc-nav">
      <a href="/school/video-conferencing" class="${active==='dash'?'active':''}">🏠 Dashboard</a>
      <a href="/school/video-conferencing/schedule" class="${active==='schedule'?'active':''}">📅 Schedule</a>
      <a href="/school/video-conferencing/upcoming" class="${active==='upcoming'?'active':''}">📋 Upcoming</a>
      <a href="/school/video-conferencing/history" class="${active==='history'?'active':''}">📜 History</a>
      <a href="/school/video-conferencing/recordings" class="${active==='recordings'?'active':''}">🎬 Recordings</a>
      <a href="/school/video-conferencing/templates" class="${active==='templates'?'active':''}">📄 Templates</a>
      <a href="/school/video-conferencing/analytics" class="${active==='analytics'?'active':''}">📊 Analytics</a>
      <a href="/school/video-conferencing/settings" class="${active==='settings'?'active':''}">⚙️ Settings</a>
    </div>`;
  }

  async function getUserName(pool, userId) {
    if (!userId) return 'Unknown';
    try {
      const { rows } = await pool.query('SELECT name FROM users WHERE id = $1 LIMIT 1', [userId]);
      if (rows.length) return rows[0].name || 'Unknown';
    } catch (e) { /* ignore */ }
    return 'User #' + userId;
  }

  async function getTeachers(pool, tid) {
    try {
      const { rows } = await pool.query("SELECT id, name FROM users WHERE tenant_id = $1 AND role IN ('teacher','admin','staff') AND is_active = 1 ORDER BY name", [tid]);
      return rows;
    } catch (e) { return []; }
  }

  async function getClasses(pool, tid) {
    try {
      const { rows } = await pool.query("SELECT id, name FROM classes WHERE tenant_id = $1 ORDER BY name", [tid]);
      return rows;
    } catch (e) { return []; }
  }

  // ============================================================
  // ROUTE 1: GET /school/video-conferencing — Dashboard
  // ============================================================
  app.get('/school/video-conferencing', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const now = new Date();

    // Stats
    const { rows: statRows } = await pool.query(
      "SELECT COUNT(*) as total, SUM(CASE WHEN status='active' THEN 1 ELSE 0 END) as active, SUM(CASE WHEN status='scheduled' THEN 1 ELSE 0 END) as scheduled, SUM(CASE WHEN status='ended' THEN 1 ELSE 0 END) as ended FROM virtual_meetings WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'",
      [tid]
    );
    const stats = statRows[0] || { total: 0, active: 0, scheduled: 0, ended: 0 };

    const { rows: recRows } = await pool.query(
      "SELECT COUNT(*) as cnt FROM meeting_recordings WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '30 days'",
      [tid]
    );
    const totalRecordings = recRows[0]?.cnt || 0;

    // Active meetings
    const { rows: activeMeetings } = await pool.query(
      "SELECT * FROM virtual_meetings WHERE tenant_id = $1 AND status = 'active' ORDER BY scheduled_at DESC LIMIT 10",
      [tid]
    );

    // Upcoming meetings
    const { rows: upcomingMeetings } = await pool.query(
      "SELECT * FROM virtual_meetings WHERE tenant_id = $1 AND status = 'scheduled' AND scheduled_at >= NOW() ORDER BY scheduled_at ASC LIMIT 10",
      [tid]
    );

    // Recent recordings
    const { rows: recentRec } = await pool.query(
      "SELECT r.*, m.title as meeting_title FROM meeting_recordings r JOIN virtual_meetings m ON m.id = r.meeting_id WHERE r.tenant_id = $1 ORDER BY r.created_at DESC LIMIT 5",
      [tid]
    );

    function meetingCard(m) {
      const settings = typeof m.settings === 'string' ? JSON.parse(m.settings || '{}') : (m.settings || {});
      return `<div class="${cardClass(m.status)}">
        <div class="vc-card-header">
          <div class="vc-card-title">🎥 ${esc(m.title)}</div>
          ${statusBadge(m.status)}
        </div>
        <div class="vc-card-meta">
          <span>🕐 ${formatDateTime(m.scheduled_at)}</span>
          <span>⏱ ${formatDurationMins(m.duration_minutes)}</span>
          <span>👤 ${esc(m.host_name || 'TBD')}</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${settings.recording ? '<span class="vc-badge" style="background:#f1f5f9;color:#64748b">🔴 Rec</span>' : ''}
          ${settings.waiting_room ? '<span class="vc-badge" style="background:#f1f5f9;color:#64748b">🚪 Waiting Room</span>' : ''}
          ${settings.breakout_rooms ? '<span class="vc-badge" style="background:#f1f5f9;color:#64748b">🔀 Breakout</span>' : ''}
        </div>
        <div style="margin-top:14px;display:flex;gap:6px">
          <a href="/school/video-conferencing/room/${m.id}" class="vc-btn ${m.status==='active'?'vc-btn-success':'vc-btn-primary'} vc-btn-sm">
            ${m.status==='active'?'🔗 Join Now':'📋 View'}
          </a>
          ${m.status==='scheduled'?`<a href="/school/video-conferencing/attendance/${m.id}" class="vc-btn vc-btn-secondary vc-btn-sm">📊 Attendance</a>`:''}
        </div>
      </div>`;
    }

    const html = VC_CSS + `<div class="vc-wrap">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b;margin:0">Video Conferencing</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Virtual classrooms and meeting management</p>
        </div>
        <a href="/school/video-conferencing/schedule" class="vc-btn vc-btn-primary">📅 Schedule Meeting</a>
      </div>

      <div class="vc-stats">
        <div class="vc-stat"><div class="vc-stat-icon">🎥</div><div class="vc-stat-num">${stats.total||0}</div><div class="vc-stat-label">Total Meetings (30d)</div></div>
        <div class="vc-stat"><div class="vc-stat-icon" style="color:#ef4444">🔴</div><div class="vc-stat-num" style="color:#ef4444">${stats.active||0}</div><div class="vc-stat-label">Active Now</div></div>
        <div class="vc-stat"><div class="vc-stat-icon" style="color:#3b82f6">📅</div><div class="vc-stat-num" style="color:#3b82f6">${stats.scheduled||0}</div><div class="vc-stat-label">Scheduled</div></div>
        <div class="vc-stat"><div class="vc-stat-icon" style="color:#22c55e">✅</div><div class="vc-stat-num" style="color:#22c55e">${stats.ended||0}</div><div class="vc-stat-label">Completed</div></div>
        <div class="vc-stat"><div class="vc-stat-icon" style="color:#8b5cf6">🎬</div><div class="vc-stat-num" style="color:#8b5cf6">${totalRecordings}</div><div class="vc-stat-label">Recordings (30d)</div></div>
      </div>

      ${activeMeetings.length > 0 ? `
      <div class="vc-section">
        <div class="vc-section-title">🔴 Active Meetings (${activeMeetings.length})</div>
        <div class="vc-cards">${activeMeetings.map(meetingCard).join('')}</div>
      </div>` : ''}

      <div class="vc-section">
        <div class="vc-section-title">📅 Upcoming Meetings</div>
        ${upcomingMeetings.length > 0
          ? `<div class="vc-cards">${upcomingMeetings.map(meetingCard).join('')}</div>`
          : '<div class="vc-empty"><div class="vc-empty-icon">📅</div><h3>No upcoming meetings</h3><p>Schedule your first virtual classroom</p></div>'}
      </div>

      ${recentRec.length > 0 ? `
      <div class="vc-section">
        <div class="vc-section-title">🎬 Recent Recordings</div>
        <div class="vc-panel"><div class="vc-panel-body" style="padding:0;overflow-x:auto">
          <table class="vc-table"><thead><tr><th>Meeting</th><th>Duration</th><th>Size</th><th>Date</th><th>Action</th></tr></thead>
          <tbody>${recentRec.map(r => `<tr>
            <td>${esc(r.meeting_title)}</td>
            <td>${formatDurationSecs(r.duration_seconds)}</td>
            <td>${parseFloat(r.file_size_mb||0).toFixed(1)} MB</td>
            <td>${formatDate(r.created_at)}</td>
            <td><a href="/school/video-conferencing/recordings/${r.id}" class="vc-btn vc-btn-sm vc-btn-secondary">View</a></td>
          </tr>`).join('')}</tbody></table>
        </div></div>
      </div>` : ''}
    </div>`;
    res.send(renderPage('Video Conferencing', html, user, req));
    audit('view_video_conferencing_dashboard', { tenant_id: tid, user_id: user.id });
  }));

  // ============================================================
  // ROUTE 2: GET /school/video-conferencing/schedule
  // ============================================================
  app.get('/school/video-conferencing/schedule', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const teachers = await getTeachers(pool, tid);
    const classes = await getClasses(pool, tid);

    // Templates
    const { rows: templates } = await pool.query(
      "SELECT * FROM meeting_templates WHERE tenant_id IN (0, $1) ORDER BY is_system DESC, name ASC",
      [tid]
    );

    const { rows: conflicts } = await pool.query(
      "SELECT m.title, m.scheduled_at, m.duration_minutes FROM virtual_meetings m WHERE m.tenant_id = $1 AND m.status IN ('scheduled','active') AND m.host_id = $2 AND m.scheduled_at >= NOW() - INTERVAL '1 hour' AND m.scheduled_at <= NOW() + INTERVAL '24 hours' ORDER BY m.scheduled_at ASC",
      [tid, user.id]
    );

    const html = VC_CSS + `<div class="vc-wrap">
      ${nav('schedule')}
      <div style="margin-bottom:16px"><a href="/school/video-conferencing" style="color:#64748b;font-size:14px;text-decoration:none">← Back to Dashboard</a></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:22px;color:#1e293b;margin:0">📅 Schedule Meeting</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Create a new virtual classroom or meeting</p>
        </div>
      </div>

      ${conflicts.length > 0 ? `<div style="background:#fef3c7;border:1px solid #fbbf24;border-radius:10px;padding:12px 16px;margin-bottom:16px;font-size:13px;color:#92400e">
        <strong>⚠️ Schedule Conflicts:</strong> You have ${conflicts.length} overlapping meeting(s) in the next 24h.
        <ul style="margin:6px 0 0;padding-left:18px">${conflicts.map(c => `<li>${esc(c.title)} — ${formatDateTime(c.scheduled_at)} (${c.duration_minutes}min)</li>`).join('')}</ul>
      </div>` : ''}

      <div class="vc-section">
        <div class="vc-section-title">📄 Quick Start from Template</div>
        <div class="vc-cards" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
          ${templates.map(t => `<div class="vc-template-card" onclick="applyTemplate(${t.id}, '${esc(t.default_duration)}', this)">
            <div class="vc-template-icon">${t.category==='class'?'📚':t.category==='parent'?'👨‍👩‍👧':t.category==='staff'?'👔':t.category==='exam'?'📝':t.category==='club'?'🎭':'🎯'}</div>
            <div class="vc-template-name">${esc(t.name)}</div>
            <div class="vc-template-desc">${esc(t.description||'')}</div>
          </div>`).join('')}
        </div>
      </div>

      <div class="vc-panel">
        <div class="vc-panel-header"><h3>📝 Meeting Details</h3></div>
        <div class="vc-panel-body">
          <form method="POST" action="/school/video-conferencing/schedule/save" class="vc-form">
            <input type="hidden" name="template_id" id="template_id" value="">
            <div class="vc-grid">
              <div>
                <label>Meeting Title *</label>
                <input type="text" name="title" required placeholder="e.g., Grade 10 Math Class">
              </div>
              <div>
                <label>Host (Teacher)</label>
                <select name="host_id">
                  <option value="${user.id}">${esc(user.name || 'You')}</option>
                  ${teachers.filter(t=>t.id!==user.id).map(t=>`<option value="${t.id}">${esc(t.name)}</option>`).join('')}
                </select>
              </div>
            </div>
            <div style="margin-top:14px">
              <label>Description</label>
              <textarea name="description" rows="3" placeholder="Meeting agenda or description..."></textarea>
            </div>
            <div class="vc-grid" style="margin-top:14px">
              <div>
                <label>Scheduled Date & Time *</label>
                <input type="datetime-local" name="scheduled_at" required>
              </div>
              <div>
                <label>Duration (minutes) *</label>
                <input type="number" name="duration_minutes" id="duration_minutes" value="60" min="5" max="480" required>
              </div>
            </div>
            <div class="vc-grid" style="margin-top:14px">
              <div>
                <label>Max Participants</label>
                <input type="number" name="max_participants" value="50" min="2" max="500">
              </div>
              <div>
                <label>Target Class (optional)</label>
                <select name="class_id"><option value="">No specific class</option>${classes.map(c=>`<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
              </div>
            </div>
            <div style="margin-top:18px">
              <label style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:10px">Meeting Settings</label>
              <div class="vc-toggle-row">
                <div><div class="vc-toggle-label">🔴 Allow Recording</div><div class="vc-toggle-desc">Participants can record the meeting</div></div>
                <label class="vc-toggle"><input type="checkbox" name="recording" value="1" checked><span></span></label>
              </div>
              <div class="vc-toggle-row">
                <div><div class="vc-toggle-label">🚪 Waiting Room</div><div class="vc-toggle-desc">Host must admit participants before they join</div></div>
                <label class="vc-toggle"><input type="checkbox" name="waiting_room" value="1"><span></span></label>
              </div>
              <div class="vc-toggle-row">
                <div><div class="vc-toggle-label">🔇 Mute on Join</div><div class="vc-toggle-desc">Participants join with microphone muted</div></div>
                <label class="vc-toggle"><input type="checkbox" name="mute_on_join" value="1" checked><span></span></label>
              </div>
              <div class="vc-toggle-row">
                <div><div class="vc-toggle-label">🖥 Screen Sharing</div><div class="vc-toggle-desc">Allow participants to share their screen</div></div>
                <label class="vc-toggle"><input type="checkbox" name="screen_share" value="1" checked><span></span></label>
              </div>
              <div class="vc-toggle-row">
                <div><div class="vc-toggle-label">🔀 Breakout Rooms</div><div class="vc-toggle-desc">Enable breakout room functionality</div></div>
                <label class="vc-toggle"><input type="checkbox" name="breakout_rooms" value="1"><span></span></label>
              </div>
            </div>
            <div style="margin-top:14px">
              <label>Recurring Config (optional)</label>
              <select name="recurring_type">
                <option value="none">Does not repeat</option>
                <option value="daily">Daily</option>
                <option value="weekly">Weekly</option>
                <option value="biweekly">Every 2 weeks</option>
                <option value="monthly">Monthly</option>
              </select>
            </div>
            <div class="vc-grid" style="margin-top:14px">
              <div>
                <label>Recurring End Date</label>
                <input type="date" name="recurring_end">
              </div>
            </div>
            <div style="margin-top:20px;display:flex;gap:10px">
              <button type="submit" class="vc-btn vc-btn-primary">✅ Create Meeting</button>
              <a href="/school/video-conferencing" class="vc-btn vc-btn-secondary">Cancel</a>
            </div>
          </form>
        </div>
      </div>
    </div>
    <script>
    function applyTemplate(id, duration, el) {
      document.getElementById('template_id').value = id;
      document.getElementById('duration_minutes').value = duration;
      document.querySelectorAll('.vc-template-card').forEach(c => c.classList.remove('selected'));
      if (el) el.classList.add('selected');
    }
    </script>`;
    res.send(renderPage('Schedule Meeting', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /school/video-conferencing/schedule/save
  // ============================================================
  app.post('/school/video-conferencing/schedule/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, description, host_id, scheduled_at, duration_minutes, max_participants,
            class_id, recording, waiting_room, mute_on_join, screen_share, breakout_rooms,
            recurring_type, recurring_end, template_id } = req.body;

    const code = generateMeetingCode();
    const hostName = await getUserName(pool, parseInt(host_id) || user.id);
    const settings = JSON.stringify({
      recording: !!recording, waiting_room: !!waiting_room, mute_on_join: !!mute_on_join,
      screen_share: !!screen_share, breakout_rooms: !!breakout_rooms
    });
    const recurringConfig = recurring_type && recurring_type !== 'none'
      ? JSON.stringify({ type: recurring_type, end_date: recurring_end || null })
      : null;

    const { rows: result } = await pool.query(
      `INSERT INTO virtual_meetings (tenant_id, title, description, host_id, host_name, meeting_code, scheduled_at, duration_minutes, max_participants, status, settings, recurring_config)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'scheduled', $10, $11) RETURNING id`,
      [tid, title, description, parseInt(host_id) || user.id, hostName, code, scheduled_at, parseInt(duration_minutes) || 60, parseInt(max_participants) || 50, settings, recurringConfig]
    );
    const meetingId = result[0].id;

    // If class_id, auto-add class students as participants
    if (class_id) {
      try {
        const { rows: students } = await pool.query(
          "SELECT s.user_id, u.name FROM students s JOIN users u ON u.id = s.user_id WHERE s.class_id = $1 AND s.tenant_id = $2",
          [parseInt(class_id), tid]
        );
        for (const s of students) {
          await pool.query(
            "INSERT INTO meeting_participants (tenant_id, meeting_id, user_id, user_name, user_type, role) VALUES ($1, $2, $3, $4, 'student', 'participant')",
            [tid, meetingId, s.user_id, s.name]
          );
        }
      } catch (e) { /* students table may not exist */ }
    }

    audit('create_meeting', { tenant_id: tid, user_id: user.id, meeting_id: meetingId, title });
    res.redirect('/school/video-conferencing/upcoming');
  }));

  // ============================================================
  // ROUTE 4: GET /school/video-conferencing/upcoming
  // ============================================================
  app.get('/school/video-conferencing/upcoming', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { rows: meetings } = await pool.query(
      "SELECT * FROM virtual_meetings WHERE tenant_id = $1 AND status IN ('scheduled','active') ORDER BY scheduled_at ASC",
      [tid]
    );
    const html = VC_CSS + `<div class="vc-wrap">
      ${nav('upcoming')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b;margin:0">📋 Upcoming Meetings</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">${meetings.length} meeting(s) scheduled</p></div>
        <a href="/school/video-conferencing/schedule" class="vc-btn vc-btn-primary">+ Schedule New</a>
      </div>
      ${meetings.length > 0 ? `<div class="vc-cards">${meetings.map(m => {
        const settings = typeof m.settings === 'string' ? JSON.parse(m.settings || '{}') : (m.settings || {});
        return `<div class="${cardClass(m.status)}">
          <div class="vc-card-header"><div class="vc-card-title">🎥 ${esc(m.title)}</div>${statusBadge(m.status)}</div>
          <div class="vc-card-meta">
            <span>🕐 ${formatDateTime(m.scheduled_at)}</span><span>⏱ ${formatDurationMins(m.duration_minutes)}</span>
            <span>👤 ${esc(m.host_name||'TBD')}</span><span>🔑 ${esc(m.meeting_code)}</span>
          </div>
          <div style="font-size:13px;color:#64748b;margin-bottom:10px">${esc(truncate(m.description,100))||'No description'}</div>
          <div style="display:flex;gap:6px">
            <a href="/school/video-conferencing/room/${m.id}" class="vc-btn ${m.status==='active'?'vc-btn-success':'vc-btn-primary'} vc-btn-sm">${m.status==='active'?'🔗 Join':'📋 View'}</a>
            <a href="/school/video-conferencing/attendance/${m.id}" class="vc-btn vc-btn-secondary vc-btn-sm">📊 Attendance</a>
          </div>
        </div>`;
      }).join('')}</div>` : '<div class="vc-empty"><div class="vc-empty-icon">📅</div><h3>No upcoming meetings</h3><p>Schedule a new meeting to get started</p></div>'}
    </div>`;
    res.send(renderPage('Upcoming Meetings', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /school/video-conferencing/room/:id
  // ============================================================
  app.get('/school/video-conferencing/room/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    const { rows: meetingRows } = await pool.query("SELECT * FROM virtual_meetings WHERE id = $1 AND tenant_id = $2", [meetingId, tid]);
    const meeting = meetingRows[0];
    if (!meeting) return res.send(renderPage('Not Found', '<div class="vc-empty"><h3>Meeting not found</h3><a href="/school/video-conferencing" class="vc-btn vc-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));

    const { rows: participants } = await pool.query(
      "SELECT * FROM meeting_participants WHERE meeting_id = $1 AND tenant_id = $2 ORDER BY role DESC, user_name ASC",
      [meetingId, tid]
    );
    const { rows: notesRows } = await pool.query(
      "SELECT * FROM meeting_notes WHERE meeting_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 5",
      [meetingId, tid]
    );
    const { rows: logs } = await pool.query(
      "SELECT * FROM meeting_attendance_logs WHERE meeting_id = $1 AND tenant_id = $2 ORDER BY join_time ASC",
      [meetingId, tid]
    );
    const settings = typeof meeting.settings === 'string' ? JSON.parse(meeting.settings || '{}') : (meeting.settings || {});
    const isHost = meeting.host_id === user.id;
    const isActive = meeting.status === 'active';

    const participantHtml = participants.length > 0
      ? participants.map(p => {
        const roleBadge = p.role === 'host'
          ? '<span class="vc-badge" style="background:#fef3c7;color:#b45309">👑 Host</span>'
          : p.role === 'co-host'
            ? '<span class="vc-badge" style="background:#dbeafe;color:#1d4ed8">⭐ Co-host</span>'
            : '';
        return `<div class="vc-participant-item">
          <div class="vc-avatar vc-avatar-sm" style="background:${avatarColor(p.user_name)}">${esc(initials(p.user_name))}</div>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:#e2e8f0">${esc(p.user_name)} ${roleBadge}</div>
            <div style="font-size:11px;color:#64748b">${p.joined_at ? 'Joined ' + formatTime(p.joined_at) : 'Not joined'}</div>
          </div>
          ${isActive && isHost ? `<button class="vc-btn vc-btn-sm" style="background:#334155;color:#ef4444" onclick="muteParticipant(${p.user_id})">🔇</button>` : ''}
        </div>`;
      }).join('')
      : '<div style="text-align:center;color:#64748b;font-size:13px;padding:20px">No participants yet</div>';

    const notesHtml = notesRows.length > 0
      ? notesRows.map(n => {
        const items = typeof n.action_items === 'string' ? JSON.parse(n.action_items || '[]') : (n.action_items || []);
        return `<div class="vc-note-card">
          <h4>📝 Notes by ${esc(n.created_by ? '' : '—')}</h4>
          <p>${esc(n.notes_text || n.agenda || '')}</p>
          ${items.length > 0 ? `<div style="margin-top:8px"><strong style="color:#92400e;font-size:12px">Action Items:</strong>
            ${items.map(it => `<div class="vc-action-item"><span class="vc-action-check ${it.done?'done':''}">${it.done?'✓':''}</span><span style="font-size:13px;color:#78350f">${esc(it.text)}</span></div>`).join('')}
          </div>` : ''}
        </div>`;
      }).join('')
      : '<div style="text-align:center;color:#94a3b8;font-size:13px;padding:20px">No notes yet</div>';

    const html = VC_CSS + `<div class="vc-wrap">
      <div style="margin-bottom:16px"><a href="/school/video-conferencing" style="color:#64748b;font-size:14px;text-decoration:none">← Back to Dashboard</a></div>

      ${isActive ? `
      <div class="vc-meeting-room">
        <div class="vc-room-header">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:24px">🎥</span>
            <div><div style="font-size:16px;font-weight:700">${esc(meeting.title)}</div><div style="font-size:12px;opacity:.7">Code: ${esc(meeting.meeting_code)} · ${participants.length} participant(s)</div></div>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="vc-badge vc-badge-live" style="font-size:13px">🔴 LIVE</span>
            <span id="room-timer" style="font-size:18px;font-weight:800;font-family:monospace;color:#22c55e">00:00:00</span>
          </div>
        </div>
        <div class="vc-room-body">
          <div class="vc-video-area">
            <div class="vc-video-tile"><div style="text-align:center"><div style="font-size:48px;margin-bottom:4px">👤</div><div style="font-size:12px;color:#64748b">Camera preview</div></div><div class="vc-video-name">${esc(user.name || 'You')}</div></div>
            <div class="vc-video-tile"><div style="text-align:center"><div style="font-size:48px;margin-bottom:4px">📺</div><div style="font-size:12px;color:#64748b">Shared screen</div></div></div>
            ${participants.filter(p=>p.user_id!==user.id).slice(0,4).map(p=>`<div class="vc-video-tile"><div style="font-size:36px">👤</div><div class="vc-video-name">${esc(p.user_name||'')}</div></div>`).join('')}
          </div>
          <div class="vc-sidebar-panel">
            <h4>👥 Participants (${participants.length})</h4>
            ${participantHtml}
            ${isActive && isHost ? `<div style="margin-top:16px">
              <h4>🔀 Breakout Rooms</h4>
              <form method="POST" action="/school/video-conferencing/breakout/${meetingId}/assign" style="font-size:12px;color:#94a3b8">
                <label style="color:#94a3b8;font-size:12px">Number of rooms</label>
                <input type="number" name="num_rooms" value="3" min="2" max="20" style="width:60px;padding:6px;border:1px solid #475569;border-radius:6px;background:#334155;color:#fff;font-size:13px;margin:4px 0">
                <div style="margin-top:6px"><label style="color:#94a3b8;font-size:11px;display:flex;align-items:center;gap:4px"><input type="radio" name="assign_type" value="random" checked> Random</label></div>
                <div><label style="color:#94a3b8;font-size:11px;display:flex;align-items:center;gap:4px"><input type="radio" name="assign_type" value="manual"> Manual</label></div>
                <div style="margin-top:4px"><label style="color:#94a3b8;font-size:11px;display:flex;align-items:center;gap:4px">Timer: <input type="number" name="timer_minutes" value="10" min="1" max="120" style="width:50px;padding:4px;border:1px solid #475569;border-radius:4px;background:#334155;color:#fff;font-size:12px"> min</label></div>
                <button type="submit" class="vc-btn vc-btn-sm" style="background:#4f46e5;color:#fff;margin-top:8px;width:100%">Create Rooms</button>
              </form>
            </div>` : ''}
          </div>
        </div>
        <div style="padding:16px;background:#0f172a;display:flex;justify-content:center">
          <div class="vc-controls">
            <button class="vc-ctrl-btn vc-ctrl-mic" id="btn-mic" onclick="toggleMic()" title="Toggle Microphone">🎤</button>
            <button class="vc-ctrl-btn vc-ctrl-cam" id="btn-cam" onclick="toggleCam()" title="Toggle Camera">📷</button>
            <button class="vc-ctrl-btn vc-ctrl-screen" onclick="toggleScreen()" title="Share Screen">🖥</button>
            <button class="vc-ctrl-btn vc-ctrl-record" id="btn-rec" onclick="toggleRecord()" title="Start/Stop Recording">⏺</button>
            <button class="vc-ctrl-btn vc-ctrl-chat" onclick="toggleChat()" title="Chat">💬</button>
            ${isHost ? '<button class="vc-ctrl-btn" style="background:#f59e0b;color:#fff" onclick="muteAll()" title="Mute All">🔇</button>' : ''}
            <button class="vc-ctrl-btn vc-ctrl-end" onclick="endMeetingConfirm(${meetingId})" title="End Meeting">📞</button>
          </div>
        </div>
      </div>
      ` : `
      <div class="vc-panel" style="margin-bottom:20px">
        <div class="vc-panel-header">
          <div style="display:flex;align-items:center;gap:12px">
            <span style="font-size:24px">🎥</span>
            <div><h3 style="margin:0">${esc(meeting.title)}</h3><p style="font-size:12px;color:#94a3b8;margin:2px 0 0">Code: ${esc(meeting.meeting_code)}</p></div>
          </div>
          ${statusBadge(meeting.status)}
        </div>
        <div class="vc-panel-body">
          <div class="vc-grid" style="margin-bottom:14px">
            <div><span style="font-size:12px;color:#64748b">Scheduled</span><div style="font-size:14px;font-weight:600;color:#1e293b">${formatDateTime(meeting.scheduled_at)}</div></div>
            <div><span style="font-size:12px;color:#64748b">Duration</span><div style="font-size:14px;font-weight:600;color:#1e293b">${formatDurationMins(meeting.duration_minutes)}</div></div>
            <div><span style="font-size:12px;color:#64748b">Host</span><div style="font-size:14px;font-weight:600;color:#1e293b">${esc(meeting.host_name||'TBD')}</div></div>
            <div><span style="font-size:12px;color:#64748b">Max Participants</span><div style="font-size:14px;font-weight:600;color:#1e293b">${meeting.max_participants}</div></div>
          </div>
          ${meeting.description ? `<div style="font-size:13px;color:#475569;margin-bottom:14px;line-height:1.5">${esc(meeting.description)}</div>` : ''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:14px">
            ${settings.recording?'<span class="vc-badge" style="background:#f1f5f9;color:#64748b">🔴 Recording</span>':''}
            ${settings.waiting_room?'<span class="vc-badge" style="background:#f1f5f9;color:#64748b">🚪 Waiting Room</span>':''}
            ${settings.mute_on_join?'<span class="vc-badge" style="background:#f1f5f9;color:#64748b">🔇 Mute on Join</span>':''}
            ${settings.screen_share?'<span class="vc-badge" style="background:#f1f5f9;color:#64748b">🖥 Screen Share</span>':''}
            ${settings.breakout_rooms?'<span class="vc-badge" style="background:#f1f5f9;color:#64748b">🔀 Breakout Rooms</span>':''}
          </div>
          <div style="display:flex;gap:8px">
            ${isHost && meeting.status==='scheduled' ? `<form method="POST" action="/school/video-conferencing/room/${meetingId}/start" style="display:inline"><button type="submit" class="vc-btn vc-btn-success">▶ Start Meeting</button></form>` : ''}
            ${meeting.status==='cancelled' ? '<span class="vc-badge vc-badge-cancelled">Meeting Cancelled</span>' : meeting.status==='ended' ? '<span class="vc-badge vc-badge-ended">Meeting Ended</span>' : ''}
          </div>
        </div>
      </div>
      `}

      <!-- Attendance & Notes Tabs -->
      <div class="vc-panel" style="margin-top:16px">
        <div class="vc-tab-bar" id="info-tabs">
          <button class="active" onclick="showTab('participants-tab')">👥 Participants (${participants.length})</button>
          <button onclick="showTab('notes-tab')">📝 Notes</button>
          <button onclick="showTab('attendance-tab')">📊 Attendance Log</button>
        </div>
        <div id="participants-tab" style="padding:16px">
          ${isActive ? participantHtml : `<table class="vc-table"><thead><tr><th>Name</th><th>Type</th><th>Role</th><th>Joined</th><th>Duration</th></tr></thead>
          <tbody>${participants.length > 0 ? participants.map(p => `<tr>
            <td style="display:flex;align-items:center;gap:8px"><div class="vc-avatar vc-avatar-sm" style="background:${avatarColor(p.user_name)}">${esc(initials(p.user_name))}</div>${esc(p.user_name)}</td>
            <td><span class="vc-badge" style="background:#f1f5f9;color:#64748b">${esc(p.user_type)}</span></td>
            <td>${p.role==='host'?'👑 Host':p.role==='co-host'?'⭐ Co-host':'Participant'}</td>
            <td>${p.joined_at ? formatDateTime(p.joined_at) : '—'}</td>
            <td>${formatDurationSecs(p.duration_seconds)}</td>
          </tr>`).join('') : '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No participants yet</td></tr>'}</tbody></table>`}
        </div>
        <div id="notes-tab" style="padding:16px;display:none">
          <form method="POST" action="/school/video-conferencing/room/${meetingId}/notes" style="margin-bottom:16px">
            <div class="vc-grid">
              <div><label style="font-size:13px;font-weight:600;color:#475569">Agenda</label><textarea name="agenda" rows="3" placeholder="Meeting agenda...">${esc(notesRows[0]?.agenda||'')}</textarea></div>
              <div><label style="font-size:13px;font-weight:600;color:#475569">Notes</label><textarea name="notes_text" rows="3" placeholder="Meeting notes...">${esc(notesRows[0]?.notes_text||'')}</textarea></div>
            </div>
            <div style="margin-top:10px"><label style="font-size:13px;font-weight:600;color:#475569">Action Items (one per line)</label>
            <textarea name="action_items" rows="3" placeholder="Action item 1\nAction item 2\n...">${esc((typeof notesRows[0]?.action_items==='string'?JSON.parse(notesRows[0]?.action_items||'[]'):notesRows[0]?.action_items||[]).map(i=>i.text).join('\n'))}</textarea></div>
            <button type="submit" class="vc-btn vc-btn-primary vc-btn-sm" style="margin-top:8px">💾 Save Notes</button>
          </form>
          ${notesHtml}
        </div>
        <div id="attendance-tab" style="padding:16px;display:none">
          <table class="vc-table"><thead><tr><th>Participant</th><th>Join Time</th><th>Leave Time</th><th>Duration</th></tr></thead>
          <tbody>${logs.length > 0 ? logs.map(l => `<tr>
            <td style="display:flex;align-items:center;gap:8px"><div class="vc-avatar vc-avatar-sm" style="background:${avatarColor(l.participant_name)}">${esc(initials(l.participant_name))}</div>${esc(l.participant_name||'—')}</td>
            <td>${formatTime(l.join_time)}</td><td>${formatTime(l.leave_time)||'—'}</td><td>${formatDurationSecs(l.duration_seconds)}</td>
          </tr>`).join('') : '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:20px">No attendance data yet</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>
    <script>
    function showTab(tabId) {
      document.querySelectorAll('#info-tabs ~ div[id$="-tab"]').forEach(d => d.style.display = 'none');
      document.getElementById(tabId).style.display = 'block';
      document.querySelectorAll('#info-tabs button').forEach(b => b.classList.remove('active'));
      event.target.classList.add('active');
    }
    ${isActive ? `
    let timerSec = 0;
    setInterval(() => {
      timerSec++;
      const h = String(Math.floor(timerSec/3600)).padStart(2,'0');
      const m = String(Math.floor((timerSec%3600)/60)).padStart(2,'0');
      const s = String(timerSec%60).padStart(2,'0');
      const el = document.getElementById('room-timer');
      if (el) el.textContent = h+':'+m+':'+s;
    }, 1000);
    function toggleMic(){document.getElementById('btn-mic').classList.toggle('active')}
    function toggleCam(){document.getElementById('btn-cam').classList.toggle('active')}
    function toggleScreen(){alert('Screen sharing toggled')}
    function toggleRecord(){document.getElementById('btn-rec').classList.toggle('active');alert('Recording toggled')}
    function toggleChat(){alert('Chat panel toggled')}
    function muteAll(){if(confirm('Mute all participants?'))alert('All participants muted')}
    function muteParticipant(id){alert('Participant #'+id+' muted')}
    function endMeetingConfirm(id){if(confirm('End this meeting for all participants?')){window.location.href='/school/video-conferencing/room/'+id+'/end?_method=POST'}}
    ` : ''}
    </script>`;
    res.send(renderPage('Meeting Room: ' + meeting.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /school/video-conferencing/room/:id/start
  // ============================================================
  app.post('/school/video-conferencing/room/:id/start', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    const { rows } = await pool.query("SELECT * FROM virtual_meetings WHERE id = $1 AND tenant_id = $2", [meetingId, tid]);
    const meeting = rows[0];
    if (!meeting) return res.redirect('/school/video-conferencing');
    if (meeting.host_id !== user.id) return res.send('Only the host can start this meeting.', 403);
    await pool.query("UPDATE virtual_meetings SET status = 'active', updated_at = NOW() WHERE id = $1 AND tenant_id = $2", [meetingId, tid]);
    audit('start_meeting', { tenant_id: tid, user_id: user.id, meeting_id: meetingId });
    res.redirect('/school/video-conferencing/room/' + meetingId);
  }));

  // ============================================================
  // ROUTE 7: POST /school/video-conferencing/room/:id/end
  // ============================================================
  app.post('/school/video-conferencing/room/:id/end', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    const { rows } = await pool.query("SELECT * FROM virtual_meetings WHERE id = $1 AND tenant_id = $2", [meetingId, tid]);
    const meeting = rows[0];
    if (!meeting) return res.redirect('/school/video-conferencing');
    if (meeting.host_id !== user.id) return res.send('Only the host can end this meeting.', 403);

    const now = new Date();
    await pool.query("UPDATE virtual_meetings SET status = 'ended', updated_at = NOW() WHERE id = $1 AND tenant_id = $2", [meetingId, tid]);
    // Update participant leave times
    await pool.query("UPDATE meeting_participants SET left_at = NOW(), duration_seconds = EXTRACT(EPOCH FROM (NOW() - joined_at))::INT WHERE meeting_id = $1 AND tenant_id = $2 AND left_at IS NULL AND joined_at IS NOT NULL", [meetingId, tid]);
    // Update attendance logs
    await pool.query("UPDATE meeting_attendance_logs SET leave_time = NOW(), duration_seconds = EXTRACT(EPOCH FROM (NOW() - join_time))::INT WHERE meeting_id = $1 AND tenant_id = $2 AND leave_time IS NULL", [meetingId, tid]);
    audit('end_meeting', { tenant_id: tid, user_id: user.id, meeting_id: meetingId });
    res.redirect('/school/video-conferencing/room/' + meetingId);
  }));

  // ============================================================
  // ROUTE 8: GET /school/video-conferencing/recordings
  // ============================================================
  app.get('/school/video-conferencing/recordings', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;

    const { rows: totalRows } = await pool.query("SELECT COUNT(*) as cnt FROM meeting_recordings WHERE tenant_id = $1", [tid]);
    const total = totalRows[0]?.cnt || 0;
    const totalPages = Math.ceil(total / limit);

    const { rows: recordings } = await pool.query(
      `SELECT r.*, m.title as meeting_title, m.host_name
       FROM meeting_recordings r
       JOIN virtual_meetings m ON m.id = r.meeting_id
       WHERE r.tenant_id = $1
       ORDER BY r.created_at DESC LIMIT $2 OFFSET $3`,
      [tid, limit, offset]
    );

    const rowsHtml = recordings.length > 0
      ? recordings.map(r => {
        const isExpired = r.retention_delete_at && new Date(r.retention_delete_at) < new Date();
        return `<tr style="${isExpired?'opacity:.5':''}">
          <td>
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:48px;height:36px;border-radius:8px;background:#1e293b;display:flex;align-items:center;justify-content:center;font-size:16px;color:#fff">▶</div>
              <div><div style="font-weight:600;color:#1e293b">${esc(r.meeting_title||'Untitled')}</div><div style="font-size:11px;color:#94a3b8">by ${esc(r.host_name||'—')} · ${formatDate(r.created_at)}</div></div>
            </div>
          </td>
          <td>${formatDurationSecs(r.duration_seconds)}</td>
          <td>${parseFloat(r.file_size_mb||0).toFixed(1)} MB</td>
          <td>${formatDate(r.created_at)}</td>
          <td>${isExpired ? '<span class="vc-badge vc-badge-cancelled">Expired</span>' : r.retention_delete_at ? '<span class="vc-badge" style="background:#fef3c7;color:#b45309">Auto-delete ' + formatDate(r.retention_delete_at) + '</span>' : '<span class="vc-badge" style="background:#dcfce7;color:#16a34a">Permanent</span>'}</td>
          <td>
            <div style="display:flex;gap:4px">
              <a href="/school/video-conferencing/recordings/${r.id}" class="vc-btn vc-btn-sm vc-btn-secondary">View</a>
              ${!isExpired ? `<form method="POST" action="/school/video-conferencing/recordings/${r.id}" style="display:inline" onsubmit="return confirm('Delete this recording?')"><input type="hidden" name="_method" value="DELETE"><button type="submit" class="vc-btn vc-btn-sm vc-btn-danger">🗑</button></form>` : ''}
            </div>
          </td>
        </tr>`;
      }).join('')
      : `<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:40px">No recordings found</td></tr>`;

    const pagination = totalPages > 1 ? `<div style="display:flex;gap:4px;justify-content:center;margin-top:16px">
      ${Array.from({length:totalPages},(_,i)=>i+1).map(p=>`<a href="/school/video-conferencing/recordings?page=${p}" class="vc-btn vc-btn-sm ${p===page?'vc-btn-primary':'vc-btn-secondary'}">${p}</a>`).join('')}
    </div>` : '';

    const html = VC_CSS + `<div class="vc-wrap">
      ${nav('recordings')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b;margin:0">🎬 Meeting Recordings</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">${total} recording(s)</p></div>
      </div>
      <div class="vc-panel"><div class="vc-panel-body" style="padding:0;overflow-x:auto">
        <table class="vc-table"><thead><tr><th>Meeting</th><th>Duration</th><th>Size</th><th>Recorded</th><th>Retention</th><th>Actions</th></tr></thead>
        <tbody>${rowsHtml}</tbody></table>
      </div></div>
      ${pagination}
    </div>`;
    res.send(renderPage('Meeting Recordings', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: GET /school/video-conferencing/recordings/:id
  // ============================================================
  app.get('/school/video-conferencing/recordings/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, recId = parseInt(req.params.id);
    const { rows } = await pool.query(
      "SELECT r.*, m.title as meeting_title, m.host_name, m.meeting_code FROM meeting_recordings r JOIN virtual_meetings m ON m.id = r.meeting_id WHERE r.id = $1 AND r.tenant_id = $2",
      [recId, tid]
    );
    const rec = rows[0];
    if (!rec) return res.send(renderPage('Not Found', '<div class="vc-empty"><h3>Recording not found</h3><a href="/school/video-conferencing/recordings" class="vc-btn vc-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));

    const { rows: participants } = await pool.query(
      "SELECT * FROM meeting_participants WHERE meeting_id = $1 AND tenant_id = $2 AND is_present = 1",
      [rec.meeting_id, tid]
    );

    const html = VC_CSS + `<div class="vc-wrap">
      <div style="margin-bottom:16px"><a href="/school/video-conferencing/recordings" style="color:#64748b;font-size:14px;text-decoration:none">← Back to Recordings</a></div>
      <div class="vc-panel">
        <div class="vc-panel-header">
          <h3>🎬 ${esc(rec.meeting_title || 'Untitled Recording')}</h3>
          ${rec.retention_delete_at && new Date(rec.retention_delete_at) > new Date()
            ? '<span class="vc-badge" style="background:#fef3c7;color:#b45309">Auto-delete ' + formatDate(rec.retention_delete_at) + '</span>'
            : ''}
        </div>
        <div class="vc-panel-body">
          <div style="background:#0f172a;border-radius:12px;aspect-ratio:16/9;display:flex;align-items:center;justify-content:center;color:#64748b;font-size:18px;margin-bottom:16px">
            ${rec.recording_url ? `<video controls style="width:100%;height:100%;border-radius:12px" src="${esc(rec.recording_url)}"></video>` : '🎥 Video player placeholder'}
          </div>
          <div class="vc-grid">
            <div><span style="font-size:12px;color:#64748b">Duration</span><div style="font-size:14px;font-weight:600;color:#1e293b">${formatDurationSecs(rec.duration_seconds)}</div></div>
            <div><span style="font-size:12px;color:#64748b">File Size</span><div style="font-size:14px;font-weight:600;color:#1e293b">${parseFloat(rec.file_size_mb||0).toFixed(1)} MB</div></div>
            <div><span style="font-size:12px;color:#64748b">Host</span><div style="font-size:14px;font-weight:600;color:#1e293b">${esc(rec.host_name||'—')}</div></div>
            <div><span style="font-size:12px;color:#64748b">Recorded</span><div style="font-size:14px;font-weight:600;color:#1e293b">${formatDateTime(rec.created_at)}</div></div>
          </div>
          ${participants.length > 0 ? `<div style="margin-top:16px"><h4 style="font-size:14px;color:#1e293b;margin:0 0 10px">Participants in Recording</h4>
            <div style="display:flex;gap:6px;flex-wrap:wrap">${participants.map(p =>
              `<div class="vc-avatar vc-avatar-sm" style="background:${avatarColor(p.user_name)}" title="${esc(p.user_name)}">${esc(initials(p.user_name))}</div>`
            ).join('')}</div>
          </div>` : ''}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Recording: ' + (rec.meeting_title || 'Untitled'), html, user, req));
  }));

  // ============================================================
  // ROUTE 10: DELETE /school/video-conferencing/recordings/:id
  // ============================================================
  app.delete('/school/video-conferencing/recordings/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, recId = parseInt(req.params.id);
    await pool.query("DELETE FROM meeting_recordings WHERE id = $1 AND tenant_id = $2", [recId, tid]);
    audit('delete_recording', { tenant_id: tid, user_id: user.id, recording_id: recId });
    res.json({ success: true });
  }));

  // ============================================================
  // ROUTE 11: GET /school/video-conferencing/templates
  // ============================================================
  app.get('/school/video-conferencing/templates', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { rows: templates } = await pool.query(
      "SELECT * FROM meeting_templates WHERE tenant_id IN (0, $1) ORDER BY is_system DESC, name ASC",
      [tid]
    );

    const html = VC_CSS + `<div class="vc-wrap">
      ${nav('templates')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b;margin:0">📄 Meeting Templates</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Pre-built templates for common meeting types</p></div>
        <a href="/school/video-conferencing/templates?new=1" class="vc-btn vc-btn-primary" onclick="document.getElementById('new-template-form').style.display=document.getElementById('new-template-form').style.display==='none'?'block':'none';return false">+ Create Template</a>
      </div>

      <div id="new-template-form" style="display:none" class="vc-panel" >
        <div class="vc-panel-header"><h3>✨ Create Custom Template</h3></div>
        <div class="vc-panel-body">
          <form method="POST" action="/school/video-conferencing/templates/save" class="vc-form">
            <div class="vc-grid">
              <div><label>Template Name *</label><input type="text" name="name" required placeholder="e.g., Science Lab Review"></div>
              <div><label>Category</label>
                <select name="category"><option value="class">Class</option><option value="parent">Parent Meeting</option><option value="staff">Staff Meeting</option><option value="exam">Exam Review</option><option value="club">Club Activity</option><option value="tutoring">Tutoring</option><option value="other">Other</option></select>
              </div>
            </div>
            <div style="margin-top:14px"><label>Description</label><textarea name="description" rows="2" placeholder="Brief description..."></textarea></div>
            <div style="margin-top:14px"><label>Default Duration (minutes)</label><input type="number" name="default_duration" value="60" min="5" max="480"></div>
            <div style="margin-top:16px">
              <label style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:8px;display:block">Default Settings</label>
              <div class="vc-toggle-row"><div><div class="vc-toggle-label">Recording</div></div><label class="vc-toggle"><input type="checkbox" name="recording" value="1" checked><span></span></label></div>
              <div class="vc-toggle-row"><div><div class="vc-toggle-label">Waiting Room</div></div><label class="vc-toggle"><input type="checkbox" name="waiting_room" value="1"><span></span></label></div>
              <div class="vc-toggle-row"><div><div class="vc-toggle-label">Mute on Join</div></div><label class="vc-toggle"><input type="checkbox" name="mute_on_join" value="1" checked><span></span></label></div>
              <div class="vc-toggle-row"><div><div class="vc-toggle-label">Screen Sharing</div></div><label class="vc-toggle"><input type="checkbox" name="screen_share" value="1" checked><span></span></label></div>
              <div class="vc-toggle-row"><div><div class="vc-toggle-label">Breakout Rooms</div></div><label class="vc-toggle"><input type="checkbox" name="breakout_rooms" value="1"><span></span></label></div>
            </div>
            <div style="margin-top:16px;display:flex;gap:10px">
              <button type="submit" class="vc-btn vc-btn-primary">💾 Save Template</button>
              <button type="button" class="vc-btn vc-btn-secondary" onclick="document.getElementById('new-template-form').style.display='none'">Cancel</button>
            </div>
          </form>
        </div>
      </div>

      <div class="vc-cards" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr))">
        ${templates.map(t => {
          const settings = typeof t.default_settings === 'string' ? JSON.parse(t.default_settings || '{}') : (t.default_settings || {});
          return `<div class="vc-card">
            <div class="vc-card-header">
              <div class="vc-card-title">${t.is_system ? '📄' : '✨'} ${esc(t.name)}</div>
              ${t.is_system ? '<span class="vc-badge" style="background:#eef2ff;color:#6366f1">System</span>' : '<span class="vc-badge" style="background:#f1f5f9;color:#64748b">Custom</span>'}
            </div>
            <div style="font-size:13px;color:#64748b;margin-bottom:10px">${esc(t.description||'No description')}</div>
            <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
              <span class="vc-badge" style="background:#f1f5f9;color:#64748b">${esc(t.category||'general')}</span>
              <span class="vc-badge" style="background:#f1f5f9;color:#64748b">⏱ ${t.default_duration}min</span>
            </div>
            <div style="display:flex;gap:4px;flex-wrap:wrap">
              ${settings.recording?'<span style="font-size:11px;color:#64748b">🔴 Rec</span>':''}
              ${settings.waiting_room?'<span style="font-size:11px;color:#64748b">🚪 WR</span>':''}
              ${settings.mute_on_join?'<span style="font-size:11px;color:#64748b">🔇 Mute</span>':''}
              ${settings.screen_share?'<span style="font-size:11px;color:#64748b">🖥 Share</span>':''}
              ${settings.breakout_rooms?'<span style="font-size:11px;color:#64748b">🔀 Breakout</span>':''}
            </div>
            <div style="margin-top:12px"><a href="/school/video-conferencing/schedule?template=${t.id}" class="vc-btn vc-btn-primary vc-btn-sm">Use Template</a></div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
    res.send(renderPage('Meeting Templates', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: POST /school/video-conferencing/templates/save
  // ============================================================
  app.post('/school/video-conferencing/templates/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, description, category, default_duration, recording, waiting_room, mute_on_join, screen_share, breakout_rooms } = req.body;
    const settings = JSON.stringify({
      recording: !!recording, waiting_room: !!waiting_room, mute_on_join: !!mute_on_join,
      screen_share: !!screen_share, breakout_rooms: !!breakout_rooms
    });
    await pool.query(
      "INSERT INTO meeting_templates (tenant_id, name, description, category, default_duration, default_settings, is_system) VALUES ($1, $2, $3, $4, $5, $6, 0)",
      [tid, name, description, category || 'other', parseInt(default_duration) || 60, settings]
    );
    audit('create_template', { tenant_id: tid, user_id: user.id, name });
    res.redirect('/school/video-conferencing/templates');
  }));

  // ============================================================
  // ROUTE 13: GET /school/video-conferencing/attendance/:id
  // ============================================================
  app.get('/school/video-conferencing/attendance/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    const { rows: meetingRows } = await pool.query("SELECT * FROM virtual_meetings WHERE id = $1 AND tenant_id = $2", [meetingId, tid]);
    const meeting = meetingRows[0];
    if (!meeting) return res.redirect('/school/video-conferencing');

    const { rows: participants } = await pool.query(
      "SELECT * FROM meeting_participants WHERE meeting_id = $1 AND tenant_id = $2 ORDER BY user_name ASC",
      [meetingId, tid]
    );
    const { rows: logs } = await pool.query(
      "SELECT * FROM meeting_attendance_logs WHERE meeting_id = $1 AND tenant_id = $2 ORDER BY join_time ASC",
      [meetingId, tid]
    );

    const presentCount = participants.filter(p => p.is_present).length;
    const avgDuration = participants.length > 0
      ? Math.round(participants.reduce((s, p) => s + (p.duration_seconds || 0), 0) / participants.length)
      : 0;

    const html = VC_CSS + `<div class="vc-wrap">
      <div style="margin-bottom:16px"><a href="/school/video-conferencing/room/${meetingId}" style="color:#64748b;font-size:14px;text-decoration:none">← Back to Meeting</a></div>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b;margin:0">📊 Attendance — ${esc(meeting.title)}</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">${formatDateTime(meeting.scheduled_at)}</p></div>
      </div>
      <div class="vc-stats">
        <div class="vc-stat"><div class="vc-stat-num">${participants.length}</div><div class="vc-stat-label">Total Participants</div></div>
        <div class="vc-stat"><div class="vc-stat-num" style="color:#22c55e">${presentCount}</div><div class="vc-stat-label">Present</div></div>
        <div class="vc-stat"><div class="vc-stat-num" style="color:#ef4444">${participants.length - presentCount}</div><div class="vc-stat-label">Absent</div></div>
        <div class="vc-stat"><div class="vc-stat-num" style="color:#6366f1">${formatDurationSecs(avgDuration)}</div><div class="vc-stat-label">Avg Stay Duration</div></div>
        <div class="vc-stat"><div class="vc-stat-num" style="color:#f59e0b">${participants.length > 0 ? Math.round(presentCount/participants.length*100) : 0}%</div><div class="vc-stat-label">Attendance Rate</div></div>
      </div>

      <div class="vc-panel">
        <div class="vc-panel-header"><h3>📋 Participant Attendance</h3></div>
        <div class="vc-panel-body" style="padding:0;overflow-x:auto">
          <table class="vc-table"><thead><tr><th>Participant</th><th>Type</th><th>Role</th><th>Status</th><th>Join Time</th><th>Leave Time</th><th>Duration</th></tr></thead>
          <tbody>${participants.map(p => {
            const statusBadge = p.is_present
              ? '<span class="vc-badge vc-badge-active">✅ Present</span>'
              : '<span class="vc-badge vc-badge-cancelled">❌ Absent</span>';
            return `<tr>
              <td style="display:flex;align-items:center;gap:8px"><div class="vc-avatar vc-avatar-sm" style="background:${avatarColor(p.user_name)}">${esc(initials(p.user_name))}</div>${esc(p.user_name)}</td>
              <td>${esc(p.user_type)}</td>
              <td>${p.role==='host'?'👑 Host':p.role==='co-host'?'⭐ Co-host':'Participant'}</td>
              <td>${statusBadge}</td>
              <td>${p.joined_at ? formatTime(p.joined_at) : '—'}</td>
              <td>${p.left_at ? formatTime(p.left_at) : '—'}</td>
              <td>${formatDurationSecs(p.duration_seconds)}</td>
            </tr>`;
          }).join('')}</tbody></table>
        </div>
      </div>

      ${logs.length > 0 ? `<div class="vc-panel" style="margin-top:16px">
        <div class="vc-panel-header"><h3>🕐 Detailed Join/Leave Log</h3></div>
        <div class="vc-panel-body" style="padding:0;overflow-x:auto">
          <table class="vc-table"><thead><tr><th>Participant</th><th>Join Time</th><th>Leave Time</th><th>Duration</th></tr></thead>
          <tbody>${logs.map(l => `<tr>
            <td>${esc(l.participant_name||'—')}</td><td>${formatTime(l.join_time)}</td><td>${formatTime(l.leave_time)||'—'}</td><td>${formatDurationSecs(l.duration_seconds)}</td>
          </tr>`).join('')}</tbody></table>
        </div>
      </div>` : ''}
    </div>`;
    res.send(renderPage('Attendance: ' + meeting.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 14: GET /school/video-conferencing/analytics
  // ============================================================
  app.get('/school/video-conferencing/analytics', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const days = parseInt(req.query.days) || 30;

    // Overall stats
    const { rows: statsRows } = await pool.query(
      `SELECT
        COUNT(*) as total_meetings,
        SUM(CASE WHEN status='ended' THEN 1 ELSE 0 END) as completed,
        SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancelled,
        SUM(duration_minutes) as total_duration,
        AVG(duration_minutes) as avg_duration
       FROM virtual_meetings WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [tid, days]
    );
    const stats = statsRows[0] || {};

    // Participation stats
    const { rows: partRows } = await pool.query(
      `SELECT COUNT(DISTINCT mp.user_id) as unique_participants, COUNT(*) as total_joins, AVG(mp.duration_seconds) as avg_stay
       FROM meeting_participants mp
       JOIN virtual_meetings m ON m.id = mp.meeting_id
       WHERE mp.tenant_id = $1 AND m.created_at >= NOW() - INTERVAL '1 day' * $2`,
      [tid, days]
    );
    const partStats = partRows[0] || {};

    // Meetings by day (last 14 days)
    const { rows: dailyRows } = await pool.query(
      `SELECT DATE(created_at) as day, COUNT(*) as cnt
       FROM virtual_meetings WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '14 days'
       GROUP BY DATE(created_at) ORDER BY day ASC`,
      [tid]
    );
    const maxDaily = Math.max(...dailyRows.map(r => r.cnt), 1);
    const dailyChart = dailyRows.map(r => {
      const pct = Math.round((r.cnt / maxDaily) * 100);
      return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
        <span style="font-size:11px;color:#64748b;width:70px;flex-shrink:0">${formatDate(r.day)}</span>
        <div class="vc-bar-container" style="flex:1"><div class="vc-bar" style="width:${pct}%;background:#6366f1"></div></div>
        <span style="font-size:11px;font-weight:700;color:#1e293b;width:24px">${r.cnt}</span>
      </div>`;
    }).join('');

    // Hourly distribution
    const { rows: hourlyRows } = await pool.query(
      `SELECT HOUR(scheduled_at) as hour, COUNT(*) as cnt
       FROM virtual_meetings WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY HOUR(scheduled_at) ORDER BY hour ASC`,
      [tid, days]
    );
    const maxHourly = Math.max(...hourlyRows.map(r => r.cnt), 1);
    const hourlyChart = hourlyRows.map(r => {
      const pct = Math.round((r.cnt / maxHourly) * 100);
      const hourLabel = String(r.hour).padStart(2, '0') + ':00';
      return `<div style="display:flex;align-items:center;gap:6px;margin-bottom:2px">
        <span style="font-size:10px;color:#64748b;width:40px;flex-shrink:0">${hourLabel}</span>
        <div class="vc-bar-container" style="flex:1"><div class="vc-bar" style="width:${pct}%;background:#3b82f6;height:16px"></div></div>
        <span style="font-size:10px;font-weight:600;color:#1e293b;width:20px">${r.cnt}</span>
      </div>`;
    }).join('');

    // Top hosts
    const { rows: hostRows } = await pool.query(
      `SELECT host_name, COUNT(*) as meeting_count, SUM(duration_minutes) as total_duration
       FROM virtual_meetings WHERE tenant_id = $1 AND status != 'cancelled' AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY host_id, host_name ORDER BY meeting_count DESC LIMIT 10`,
      [tid, days]
    );
    const maxHost = Math.max(...hostRows.map(r => r.meeting_count), 1);

    // Recordings stats
    const { rows: recStats } = await pool.query(
      `SELECT COUNT(*) as total, SUM(file_size_mb) as total_size, AVG(duration_seconds) as avg_duration
       FROM meeting_recordings WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [tid, days]
    );

    const peakHour = hourlyRows.length > 0 ? hourlyRows.reduce((a, b) => a.cnt > b.cnt ? a : b) : null;

    const html = VC_CSS + `<div class="vc-wrap">
      ${nav('analytics')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b;margin:0">📊 Meeting Analytics</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Usage insights for the last ${days} days</p></div>
        <div style="display:flex;gap:6px">
          ${[7,30,90].map(d=>`<a href="/school/video-conferencing/analytics?days=${d}" class="vc-btn vc-btn-sm ${d===days?'vc-btn-primary':'vc-btn-secondary'}">${d}d</a>`).join('')}
        </div>
      </div>

      <div class="vc-stats">
        <div class="vc-stat"><div class="vc-stat-num">${stats.total_meetings||0}</div><div class="vc-stat-label">Total Meetings</div></div>
        <div class="vc-stat"><div class="vc-stat-num" style="color:#22c55e">${stats.completed||0}</div><div class="vc-stat-label">Completed</div></div>
        <div class="vc-stat"><div class="vc-stat-num" style="color:#6366f1">${formatDurationMins(Math.round(stats.avg_duration||0))}</div><div class="vc-stat-label">Avg Duration</div></div>
        <div class="vc-stat"><div class="vc-stat-num" style="color:#f59e0b">${partStats.unique_participants||0}</div><div class="vc-stat-label">Unique Participants</div></div>
        <div class="vc-stat"><div class="vc-stat-num" style="color:#8b5cf6">${formatDurationSecs(Math.round(partStats.avg_stay||0))}</div><div class="vc-stat-label">Avg Stay</div></div>
        <div class="vc-stat"><div class="vc-stat-num" style="color:#3b82f6">${peakHour ? String(peakHour.hour).padStart(2,'0')+':00' : '—'}</div><div class="vc-stat-label">Peak Hour</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="vc-panel">
          <div class="vc-panel-header"><h3>📈 Meetings per Day (14d)</h3></div>
          <div class="vc-panel-body">${dailyChart || '<div class="vc-empty"><p>No data</p></div>'}</div>
        </div>
        <div class="vc-panel">
          <div class="vc-panel-header"><h3>🕐 Hourly Distribution</h3></div>
          <div class="vc-panel-body">${hourlyChart || '<div class="vc-empty"><p>No data</p></div>'}</div>
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:16px">
        <div class="vc-panel">
          <div class="vc-panel-header"><h3>🏆 Top Hosts</h3></div>
          <div class="vc-panel-body">${hostRows.length > 0 ? hostRows.map((h, i) => {
            const pct = Math.round((h.meeting_count / maxHost) * 100);
            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <span style="font-size:14px;font-weight:700;color:#6366f1;width:24px">#${i+1}</span>
              <div class="vc-avatar vc-avatar-sm" style="background:${avatarColor(h.host_name)}">${esc(initials(h.host_name))}</div>
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600;color:#1e293b">${esc(h.host_name||'—')}</div>
                <div class="vc-bar-container" style="margin-top:4px"><div class="vc-bar" style="width:${pct}%;background:#6366f1;height:8px"></div></div>
              </div>
              <div style="text-align:right"><div style="font-size:14px;font-weight:700;color:#1e293b">${h.meeting_count}</div><div style="font-size:10px;color:#64748b">meetings</div></div>
            </div>`;
          }).join('') : '<div class="vc-empty"><p>No host data</p></div>'}</div>
        </div>
        <div class="vc-panel">
          <div class="vc-panel-header"><h3>🎬 Recording Stats</h3></div>
          <div class="vc-panel-body">
            <div class="vc-stats" style="margin:0">
              <div class="vc-stat" style="background:#f8fafc"><div class="vc-stat-num" style="font-size:22px">${recStats[0]?.total||0}</div><div class="vc-stat-label">Recordings</div></div>
              <div class="vc-stat" style="background:#f8fafc"><div class="vc-stat-num" style="font-size:22px">${parseFloat(recStats[0]?.total_size||0).toFixed(1)}</div><div class="vc-stat-label">Total GB</div></div>
              <div class="vc-stat" style="background:#f8fafc"><div class="vc-stat-num" style="font-size:22px">${formatDurationSecs(Math.round(recStats[0]?.avg_duration||0))}</div><div class="vc-stat-label">Avg Length</div></div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Meeting Analytics', html, user, req));
  }));

  // ============================================================
  // ROUTE 15: POST /school/video-conferencing/room/:id/notes
  // ============================================================
  app.post('/school/video-conferencing/room/:id/notes', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    const { agenda, notes_text, action_items } = req.body;
    const items = (action_items || '').split('\n').filter(l => l.trim()).map(text => ({ text: text.trim(), done: false }));

    const { rows: existing } = await pool.query("SELECT id FROM meeting_notes WHERE meeting_id = $1 AND tenant_id = $2 ORDER BY created_at DESC LIMIT 1", [meetingId, tid]);
    if (existing.length > 0) {
      await pool.query(
        "UPDATE meeting_notes SET agenda = $1, notes_text = $2, action_items = $3, created_by = $4, updated_at = NOW() WHERE id = $5",
        [agenda || '', notes_text || '', JSON.stringify(items), user.id, existing[0].id]
      );
    } else {
      await pool.query(
        "INSERT INTO meeting_notes (tenant_id, meeting_id, agenda, notes_text, action_items, created_by) VALUES ($1, $2, $3, $4, $5, $6)",
        [tid, meetingId, agenda || '', notes_text || '', JSON.stringify(items), user.id]
      );
    }
    audit('save_meeting_notes', { tenant_id: tid, user_id: user.id, meeting_id: meetingId });
    res.redirect('/school/video-conferencing/room/' + meetingId);
  }));

  // ============================================================
  // ROUTE 16: GET /school/video-conferencing/history
  // ============================================================
  app.get('/school/video-conferencing/history', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const page = parseInt(req.query.page) || 1;
    const limit = 20;
    const offset = (page - 1) * limit;
    const search = req.query.q || '';

    let where = "WHERE m.tenant_id = $1 AND m.status IN ('ended','cancelled')";
    const params = [tid];
    let paramIdx = 1;
    if (search) {
      paramIdx++;
      const titleParam = '$' + paramIdx;
      paramIdx++;
      const hostParam = '$' + paramIdx;
      where += ` AND (m.title LIKE ${titleParam} OR m.host_name LIKE ${hostParam})`;
      params.push('%' + search + '%', '%' + search + '%');
    }
    paramIdx++;
    const limitParam = '$' + paramIdx;
    paramIdx++;
    const offsetParam = '$' + paramIdx;

    const { rows: totalRows } = await pool.query("SELECT COUNT(*) as cnt FROM virtual_meetings m " + where, params);
    const total = totalRows[0]?.cnt || 0;
    const totalPages = Math.ceil(total / limit);

    const { rows: meetings } = await pool.query(
      `SELECT m.*,
        (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.meeting_id = m.id AND mp.is_present = 1) as present_count,
        (SELECT COUNT(*) FROM meeting_participants mp WHERE mp.meeting_id = m.id) as total_participants,
        (SELECT COUNT(*) FROM meeting_recordings r WHERE r.meeting_id = m.id) as recording_count
       FROM virtual_meetings m ${where} ORDER BY m.scheduled_at DESC LIMIT ${limitParam} OFFSET ${offsetParam}`,
      [...params, limit, offset]
    );

    const html = VC_CSS + `<div class="vc-wrap">
      ${nav('history')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b;margin:0">📜 Meeting History</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">${total} meeting(s)</p></div>
        <form method="GET" style="display:flex;gap:6px">
          <input type="text" name="q" value="${esc(search)}" placeholder="Search meetings..." style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;width:220px">
          <button type="submit" class="vc-btn vc-btn-sm vc-btn-secondary">🔍</button>
        </form>
      </div>
      <div class="vc-panel"><div class="vc-panel-body" style="padding:0;overflow-x:auto">
        <table class="vc-table"><thead><tr><th>Meeting</th><th>Date</th><th>Duration</th><th>Host</th><th>Participants</th><th>Recordings</th><th>Status</th><th>Actions</th></tr></thead>
        <tbody>${meetings.length > 0 ? meetings.map(m => `<tr>
          <td style="font-weight:600;color:#1e293b">🎥 ${esc(m.title)}</td>
          <td>${formatDateTime(m.scheduled_at)}</td>
          <td>${formatDurationMins(m.duration_minutes)}</td>
          <td>${esc(m.host_name||'—')}</td>
          <td>${m.present_count||0}/${m.total_participants||0}</td>
          <td>${m.recording_count > 0 ? `<span class="vc-badge" style="background:#dbeafe;color:#1d4ed8">🎬 ${m.recording_count}</span>` : '—'}</td>
          <td>${statusBadge(m.status)}</td>
          <td><a href="/school/video-conferencing/room/${m.id}" class="vc-btn vc-btn-sm vc-btn-secondary">View</a></td>
        </tr>`).join('') : `<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:40px">No past meetings</td></tr>`}</tbody></table>
      </div></div>
      ${totalPages > 1 ? `<div style="display:flex;gap:4px;justify-content:center;margin-top:16px">${Array.from({length:totalPages},(_,i)=>i+1).map(p=>`<a href="/school/video-conferencing/history?page=${p}&q=${encodeURIComponent(search)}" class="vc-btn vc-btn-sm ${p===page?'vc-btn-primary':'vc-btn-secondary'}">${p}</a>`).join('')}</div>` : ''}
    </div>`;
    res.send(renderPage('Meeting History', html, user, req));
  }));

  // ============================================================
  // ROUTE 17: POST /school/video-conferencing/breakout/:id/assign
  // ============================================================
  app.post('/school/video-conferencing/breakout/:id/assign', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    const { num_rooms, assign_type, timer_minutes } = req.body;
    const numRooms = Math.min(Math.max(parseInt(num_rooms) || 3, 2), 20);
    const timer = parseInt(timer_minutes) || 10;

    const { rows: participants } = await pool.query(
      "SELECT user_id, user_name FROM meeting_participants WHERE meeting_id = $1 AND tenant_id = $2 AND role = 'participant' AND user_id != $3",
      [meetingId, tid, user.id]
    );

    // Shuffle or keep order
    let shuffled = [...participants];
    if (assign_type === 'random') {
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
      }
    }

    const rooms = Array.from({ length: numRooms }, () => []);
    shuffled.forEach((p, i) => rooms[i % numRooms].push(p));

    audit('assign_breakout_rooms', {
      tenant_id: tid, user_id: user.id, meeting_id: meetingId,
      num_rooms: numRooms, timer_minutes: timer, assign_type, total_participants: participants.length
    });

    // For demo: show the assignment result
    const roomHtml = rooms.map((room, i) => `
      <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:14px;margin-bottom:10px">
        <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:8px">🏠 Room ${i + 1} <span style="color:#64748b;font-weight:400">(${room.length} participants)</span></div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${room.map(p => `<div style="display:flex;align-items:center;gap:4px;background:#fff;padding:4px 10px;border-radius:8px;border:1px solid #e2e8f0">
            <div class="vc-avatar vc-avatar-sm" style="background:${avatarColor(p.user_name)};width:22px;height:22px;font-size:9px">${esc(initials(p.user_name))}</div>
            <span style="font-size:12px;color:#1e293b">${esc(p.user_name)}</span>
          </div>`).join('')}
          ${room.length === 0 ? '<span style="font-size:12px;color:#94a3b8">Empty</span>' : ''}
        </div>
      </div>
    `).join('');

    const html = VC_CSS + `<div class="vc-wrap" style="max-width:800px">
      <div style="margin-bottom:16px"><a href="/school/video-conferencing/room/${meetingId}" style="color:#64748b;font-size:14px;text-decoration:none">← Back to Meeting</a></div>
      <div class="vc-panel">
        <div class="vc-panel-header"><h3>🔀 Breakout Room Assignments</h3></div>
        <div class="vc-panel-body">
          <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:10px;padding:12px;margin-bottom:16px;font-size:13px;color:#4338ca">
            <strong>⏱ Timer: ${timer} minutes</strong> · ${assign_type === 'random' ? 'Randomly assigned' : 'Manually assigned'} · ${numRooms} rooms
          </div>
          ${roomHtml}
          <div style="margin-top:16px;display:flex;gap:8px">
            <a href="/school/video-conferencing/room/${meetingId}" class="vc-btn vc-btn-primary">✅ Confirm & Return</a>
            <a href="/school/video-conferencing/breakout/${meetingId}/assign" class="vc-btn vc-btn-secondary" onclick="return confirm('Re-assign all rooms?')">🔀 Re-assign</a>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Breakout Rooms', html, user, req));
  }));

  // ============================================================
  // ROUTE 18: GET /school/video-conferencing/settings
  // ============================================================
  app.get('/school/video-conferencing/settings', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    // Get tenant settings (stored as a simple config approach)
    const { rows: configRows } = await pool.query(
      "SELECT * FROM meeting_templates WHERE tenant_id = $1 AND is_system = 0 LIMIT 1",
      [tid]
    );
    const html = VC_CSS + `<div class="vc-wrap" style="max-width:700px">
      ${nav('settings')}
      <div style="margin-bottom:16px"><h1 style="font-size:22px;color:#1e293b;margin:0">⚙️ Conference Settings</h1>
      <p style="font-size:13px;color:#94a3b8;margin-top:2px">Configure default settings for your school</p></div>
      <div class="vc-panel">
        <div class="vc-panel-header"><h3>🎥 Default Meeting Settings</h3></div>
        <div class="vc-panel-body">
          <form method="POST" action="/school/video-conferencing/settings/save" class="vc-form">
            <div class="vc-toggle-row">
              <div><div class="vc-toggle-label">🔴 Recording Enabled by Default</div><div class="vc-toggle-desc">New meetings will have recording enabled</div></div>
              <label class="vc-toggle"><input type="checkbox" name="default_recording" value="1" checked><span></span></label>
            </div>
            <div class="vc-toggle-row">
              <div><div class="vc-toggle-label">🚪 Waiting Room by Default</div><div class="vc-toggle-desc">Require host approval for participants</div></div>
              <label class="vc-toggle"><input type="checkbox" name="default_waiting_room" value="1"><span></span></label>
            </div>
            <div class="vc-toggle-row">
              <div><div class="vc-toggle-label">🔇 Mute on Join by Default</div><div class="vc-toggle-desc">Participants join muted</div></div>
              <label class="vc-toggle"><input type="checkbox" name="default_mute_on_join" value="1" checked><span></span></label>
            </div>
            <div class="vc-toggle-row">
              <div><div class="vc-toggle-label">🖥 Screen Sharing by Default</div><div class="vc-toggle-desc">Allow screen sharing in meetings</div></div>
              <label class="vc-toggle"><input type="checkbox" name="default_screen_share" value="1" checked><span></span></label>
            </div>
            <div class="vc-toggle-row">
              <div><div class="vc-toggle-label">🤖 Auto-Record All Meetings</div><div class="vc-toggle-desc">Automatically start recording when meeting begins</div></div>
              <label class="vc-toggle"><input type="checkbox" name="auto_record" value="1"><span></span></label>
            </div>
            <div class="vc-toggle-row">
              <div><div class="vc-toggle-label">📧 Send Email Invitations</div><div class="vc-toggle-desc">Email participants when meetings are scheduled</div></div>
              <label class="vc-toggle"><input type="checkbox" name="email_invitations" value="1" checked><span></span></label>
            </div>
            <div class="vc-toggle-row">
              <div><div class="vc-toggle-label">📅 Add to Calendar</div><div class="vc-toggle-desc">Generate .ics calendar invites</div></div>
              <label class="vc-toggle"><input type="checkbox" name="calendar_invite" value="1" checked><span></span></label>
            </div>
          </div>
        </div>
      </div>
      <div class="vc-panel" style="margin-top:16px">
        <div class="vc-panel-header"><h3>🎬 Recording Settings</h3></div>
        <div class="vc-panel-body">
          <div class="vc-grid">
            <div><label>Recording Quality</label>
              <select name="recording_quality"><option value="720">720p HD</option><option value="1080" selected>1080p Full HD</option><option value="4k">4K Ultra HD</option></select>
            </div>
            <div><label>Retention Period (days)</label>
              <input type="number" name="retention_days" value="90" min="1" max="365">
            </div>
          </div>
          <div style="margin-top:14px"><label>Auto-Delete After Retention</label>
            <div class="vc-toggle-row"><div><div class="vc-toggle-desc">Automatically delete recordings after the retention period expires</div></div>
            <label class="vc-toggle"><input type="checkbox" name="auto_delete_recordings" value="1" checked><span></span></label></div>
          </div>
        </div>
      </div>
      <div class="vc-panel" style="margin-top:16px">
        <div class="vc-panel-header"><h3>🔧 Advanced</h3></div>
        <div class="vc-panel-body">
          <div class="vc-grid">
            <div><label>Max Simultaneous Meetings</label><input type="number" name="max_simultaneous" value="50" min="1" max="500"></div>
            <div><label>Default Max Participants</label><input type="number" name="default_max_participants" value="50" min="2" max="500"></div>
          </div>
          <div style="margin-top:14px"><label>Whiteboard Default</label>
            <select name="whiteboard_type"><option value="none">Disabled</option><option value="basic" selected>Basic Whiteboard</option><option value="advanced">Advanced (with shapes)</option></select>
          </div>
        </div>
      </div>
      <div style="margin-top:16px;display:flex;gap:8px">
        <button type="submit" formaction="/school/video-conferencing/settings/save" class="vc-btn vc-btn-primary" form="settings-form">💾 Save Settings</button>
      </div>
      <form id="settings-form" method="POST" action="/school/video-conferencing/settings/save" style="display:none"></form>
    </div>
    <script>
    // Move all inputs into the hidden form before submit
    document.querySelector('button[form="settings-form"]').addEventListener('click', function(e) {
      e.preventDefault();
      const form = document.getElementById('settings-form');
      form.innerHTML = '';
      document.querySelectorAll('.vc-panel input, .vc-panel select').forEach(inp => {
        if (inp.type === 'submit') return;
        const clone = inp.cloneNode(true);
        if ((inp.type === 'checkbox' || inp.type === 'radio') && !inp.checked) return;
        clone.name = inp.name;
        form.appendChild(clone);
      });
      form.submit();
    });
    </script>`;
    res.send(renderPage('Conference Settings', html, user, req));
  }));

  // ============================================================
  // ROUTE 19: POST /school/video-conferencing/settings/save
  // ============================================================
  app.post('/school/video-conferencing/settings/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    // Store settings in a simple key-value or config table
    // For now, store as a config JSON in a dedicated meeting_templates row
    const { default_recording, default_waiting_room, default_mute_on_join, default_screen_share,
            auto_record, email_invitations, calendar_invite, recording_quality, retention_days,
            auto_delete_recordings, max_simultaneous, default_max_participants, whiteboard_type } = req.body;
    const config = JSON.stringify({
      default_recording: !!default_recording, default_waiting_room: !!default_waiting_room,
      default_mute_on_join: !!default_mute_on_join, default_screen_share: !!default_screen_share,
      auto_record: !!auto_record, email_invitations: !!email_invitations, calendar_invite: !!calendar_invite,
      recording_quality: recording_quality || '1080', retention_days: parseInt(retention_days) || 90,
      auto_delete_recordings: !!auto_delete_recordings, max_simultaneous: parseInt(max_simultaneous) || 50,
      default_max_participants: parseInt(default_max_participants) || 50, whiteboard_type: whiteboard_type || 'basic'
    });
    // Upsert as a system config template
    const { rows: existing } = await pool.query("SELECT id FROM meeting_templates WHERE tenant_id = $1 AND category = '_config' LIMIT 1", [tid]);
    if (existing.length > 0) {
      await pool.query("UPDATE meeting_templates SET default_settings = $1, name = 'School Config', category = '_config' WHERE id = $2", [config, existing[0].id]);
    } else {
      await pool.query("INSERT INTO meeting_templates (tenant_id, name, description, category, default_duration, default_settings, is_system) VALUES ($1, 'School Config', 'Auto-generated school config', '_config', 0, $2, 0)", [tid, config]);
    }
    audit('update_conference_settings', { tenant_id: tid, user_id: user.id });
    res.redirect('/school/video-conferencing/settings');
  }));

  // ============================================================
  // ROUTE 20: POST /school/video-conferencing/room/:id/join (API)
  // ============================================================
  app.post('/school/video-conferencing/room/:id/join', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    const { rows: meetingRows } = await pool.query("SELECT * FROM virtual_meetings WHERE id = $1 AND tenant_id = $2", [meetingId, tid]);
    const meeting = meetingRows[0];
    if (!meeting) return res.json({ error: 'Meeting not found' }, 404);
    if (meeting.status !== 'active') return res.json({ error: 'Meeting is not active' }, 400);

    // Check max participants
    const { rows: countRows } = await pool.query("SELECT COUNT(*) as cnt FROM meeting_participants WHERE meeting_id = $1 AND tenant_id = $2 AND joined_at IS NOT NULL AND left_at IS NULL", [meetingId, tid]);
    if (countRows[0].cnt >= meeting.max_participants) return res.json({ error: 'Meeting is full' }, 400);

    const now = new Date();
    await pool.query(
      `INSERT INTO meeting_participants (tenant_id, meeting_id, user_id, user_name, user_type, role, joined_at, is_present)
       VALUES ($1, $2, $3, $4, $5, 'participant', NOW(), 1)
       ON CONFLICT (meeting_id, tenant_id, user_id) DO UPDATE SET joined_at = COALESCE(meeting_participants.joined_at, NOW()), is_present = 1, left_at = NULL`,
      [tid, meetingId, user.id, user.name || 'User', user.role === 'teacher' ? 'teacher' : 'student']
    );
    await pool.query(
      `INSERT INTO meeting_attendance_logs (tenant_id, meeting_id, participant_id, participant_name, join_time)
       VALUES ($1, $2, $3, $4, NOW())`,
      [tid, meetingId, user.id, user.name || 'User']
    );
    audit('join_meeting', { tenant_id: tid, user_id: user.id, meeting_id: meetingId });
    res.json({ success: true, meeting_code: meeting.meeting_code });
  }));

  // ============================================================
  // ROUTE 21: POST /school/video-conferencing/room/:id/leave (API)
  // ============================================================
  app.post('/school/video-conferencing/room/:id/leave', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    await pool.query(
      `UPDATE meeting_participants SET left_at = NOW(), duration_seconds = EXTRACT(EPOCH FROM (NOW() - joined_at))::INT WHERE meeting_id = $1 AND tenant_id = $2 AND user_id = $3 AND left_at IS NULL`,
      [meetingId, tid, user.id]
    );
    await pool.query(
      `UPDATE meeting_attendance_logs SET leave_time = NOW(), duration_seconds = EXTRACT(EPOCH FROM (NOW() - join_time))::INT WHERE meeting_id = $1 AND tenant_id = $2 AND participant_id = $3 AND leave_time IS NULL`,
      [meetingId, tid, user.id]
    );
    audit('leave_meeting', { tenant_id: tid, user_id: user.id, meeting_id: meetingId });
    res.json({ success: true });
  }));

  // ============================================================
  // ROUTE 22: GET /school/video-conferencing/api/participants/:id (API)
  // ============================================================
  app.get('/school/video-conferencing/api/participants/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    const { rows } = await pool.query(
      "SELECT user_id, user_name, user_type, role, joined_at, left_at, duration_seconds, is_present FROM meeting_participants WHERE meeting_id = $1 AND tenant_id = $2 ORDER BY role DESC, user_name ASC",
      [meetingId, tid]
    );
    res.json({ participants: rows });
  }));

  // ============================================================
  // ROUTE 23: POST /school/video-conferencing/room/:id/mute-all (API)
  // ============================================================
  app.post('/school/video-conferencing/room/:id/mute-all', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    const { rows: meetingRows } = await pool.query("SELECT * FROM virtual_meetings WHERE id = $1 AND tenant_id = $2", [meetingId, tid]);
    if (!meetingRows[0] || meetingRows[0].host_id !== user.id) return res.json({ error: 'Unauthorized' }, 403);
    audit('mute_all_participants', { tenant_id: tid, user_id: user.id, meeting_id: meetingId });
    res.json({ success: true, message: 'All participants muted' });
  }));

  // ============================================================
  // ROUTE 24: POST /school/video-conferencing/room/:id/recording (API)
  // ============================================================
  app.post('/school/video-conferencing/room/:id/recording', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    const { action } = req.body; // 'start' or 'stop'
    if (action === 'stop') {
      await pool.query(
        "INSERT INTO meeting_recordings (tenant_id, meeting_id, recording_url, file_size_mb, duration_seconds, recorded_by, retention_delete_at) VALUES ($1, $2, $3, 0, 0, $4, NOW() + INTERVAL '90 days')",
        [tid, meetingId, '/recordings/meeting-' + meetingId + '-' + Date.now() + '.mp4', user.id]
      );
      audit('stop_recording', { tenant_id: tid, user_id: user.id, meeting_id: meetingId });
    } else {
      audit('start_recording', { tenant_id: tid, user_id: user.id, meeting_id: meetingId });
    }
    res.json({ success: true, action });
  }));

  // ============================================================
  // ROUTE 25: POST /school/video-conferencing/room/:id/cancel
  // ============================================================
  app.post('/school/video-conferencing/room/:id/cancel', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, meetingId = parseInt(req.params.id);
    const { rows: meetingRows } = await pool.query("SELECT * FROM virtual_meetings WHERE id = $1 AND tenant_id = $2", [meetingId, tid]);
    const meeting = meetingRows[0];
    if (!meeting) return res.redirect('/school/video-conferencing');
    if (meeting.host_id !== user.id && user.role !== 'admin') return res.send('Unauthorized', 403);
    await pool.query("UPDATE virtual_meetings SET status = 'cancelled', updated_at = NOW() WHERE id = $1 AND tenant_id = $2", [meetingId, tid]);
    audit('cancel_meeting', { tenant_id: tid, user_id: user.id, meeting_id: meetingId });
    res.redirect('/school/video-conferencing/upcoming');
  }));

  console.log('[VideoConf] Module loaded — /school/video-conferencing/*');
};
