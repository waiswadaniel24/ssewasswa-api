// ============================================================
// PARENT-TEACHER CHAT MODULE — School Communication Platform
// Real-time messaging between parents and teachers with
// conversation list, chat bubbles, search, attachments,
// announcements, read receipts, mute/block settings.
// ============================================================
// Usage in server.js:
//   const parentTeacherChat = require('./parent-teacher-chat');
//   parentTeacherChat(app, pool, { esc, renderPage, ah, requireAuth, audit });
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
function relativeTime(dateStr) {
  if (!dateStr) return '';
  const now = new Date(), d = new Date(dateStr);
  const diffSec = Math.floor((now - d) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffSec < 10) return 'just now';
  if (diffSec < 60) return diffSec + 's ago';
  if (diffMin < 60) return diffMin + 'm ago';
  if (diffHr < 24) return diffHr + 'h ago';
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return diffDay + 'd ago';
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function formatFullDate(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
}

function initials(name) {
  if (!name) return '?';
  return String(name).replace(/@.*/, '').split(/[\s._\-]+/).slice(0, 2).map(p => (p[0] || '').toUpperCase()).join('');
}

function avatarColor(str) {
  if (!str) return '#4f46e5';
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#4f46e5', '#3b82f6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#8b5cf6', '#14b8a6', '#f97316'];
  return colors[Math.abs(hash) % colors.length];
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.substring(0, len) + '...' : str;
}

// ============================================================
// SHARED CSS — Modern Chat UI with Message Bubbles
// ============================================================
const PTC_CSS = `<style>
*{box-sizing:border-box}
.ptc-wrap{max-width:1200px;margin:0 auto}
.ptc-container{display:grid;grid-template-columns:340px 1fr;gap:0;height:calc(100vh - 100px);background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);border:1px solid #e2e8f0}
.ptc-sidebar{background:#f8fafc;border-right:1px solid #e2e8f0;display:flex;flex-direction:column;overflow:hidden}
.ptc-sidebar-hdr{padding:16px 18px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#4f46e5,#4338ca);color:#fff}
.ptc-sidebar-hdr h2{margin:0;font-size:18px;font-weight:700}
.ptc-sidebar-hdr p{margin:4px 0 0;font-size:12px;opacity:.8}
.ptc-sidebar-tabs{display:flex;border-bottom:1px solid #e2e8f0;background:#fff}
.ptc-sidebar-tabs a{flex:1;text-align:center;padding:10px 8px;font-size:12px;font-weight:600;color:#64748b;text-decoration:none;border-bottom:2px solid transparent;transition:.15s}
.ptc-sidebar-tabs a:hover{color:#4f46e5;background:#f8fafc}
.ptc-sidebar-tabs a.active{color:#4f46e5;border-bottom-color:#4f46e5}
.ptc-conv-list{flex:1;overflow-y:auto}
.ptc-conv-item{display:flex;align-items:center;gap:12px;padding:14px 18px;cursor:pointer;border-bottom:1px solid #f1f5f9;transition:.15s;text-decoration:none;color:inherit}
.ptc-conv-item:hover{background:#f1f5f9}
.ptc-conv-item.active{background:#eef2ff;border-left:3px solid #4f46e5}
.ptc-conv-item.muted{opacity:.6}
.ptc-avatar{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:700;flex-shrink:0;position:relative}
.ptc-avatar .ptc-online{position:absolute;bottom:1px;right:1px;width:10px;height:10px;border-radius:50%;background:#22c55e;border:2px solid #fff}
.ptc-conv-info{flex:1;min-width:0}
.ptc-conv-name{font-size:14px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ptc-conv-preview{font-size:12px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.ptc-conv-meta{text-align:right;flex-shrink:0}
.ptc-conv-time{font-size:11px;color:#94a3b8}
.ptc-unread-badge{display:inline-block;background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;margin-top:4px;min-width:20px;text-align:center}
.ptc-main{display:flex;flex-direction:column;overflow:hidden;background:#f1f5f9}
.ptc-chat-hdr{padding:14px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;background:#fff}
.ptc-chat-title{font-size:16px;font-weight:700;color:#1e293b}
.ptc-chat-sub{font-size:12px;color:#94a3b8;margin-top:2px}
.ptc-actions{display:flex;gap:6px}
.ptc-action-btn{background:none;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:13px;color:#64748b;transition:.15s;text-decoration:none}
.ptc-action-btn:hover{background:#f1f5f9;color:#1e293b}
.ptc-action-btn.danger:hover{background:#fee2e2;color:#dc2626}
.ptc-messages{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:6px}
.ptc-msg-row{display:flex;max-width:72%;margin-bottom:4px}
.ptc-msg-row.parent{align-self:flex-start}
.ptc-msg-row.teacher{align-self:flex-end}
.ptc-msg-bubble{padding:10px 16px;border-radius:18px;font-size:14px;line-height:1.55;position:relative;word-wrap:break-word;white-space:pre-wrap}
.ptc-msg-row.parent .ptc-msg-bubble{background:#3b82f6;color:#fff;border-bottom-left-radius:4px}
.ptc-msg-row.teacher .ptc-msg-bubble{background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;border-bottom-right-radius:4px}
.ptc-msg-row.announcement{align-self:center;max-width:90%}
.ptc-msg-row.announcement .ptc-msg-bubble{background:linear-gradient(135deg,#f59e0b,#d97706);color:#fff;border-radius:12px;text-align:center}
.ptc-msg-time{font-size:10px;margin-top:4px;text-align:right}
.ptc-msg-row.parent .ptc-msg-time{color:rgba(59,130,246,.6)}
.ptc-msg-row.teacher .ptc-msg-time{color:rgba(99,102,241,.6)}
.ptc-msg-row.announcement .ptc-msg-time{color:rgba(245,158,11,.7);text-align:center}
.ptc-msg-receipt{font-size:10px;display:inline-block;margin-left:4px}
.ptc-msg-attachment{margin-top:8px;padding:8px 12px;background:rgba(0,0,0,.08);border-radius:8px}
.ptc-msg-row.parent .ptc-msg-attachment{background:rgba(255,255,255,.15)}
.ptc-msg-attachment a{color:inherit;text-decoration:underline;font-weight:600;font-size:13px}
.ptc-msg-system{text-align:center;padding:8px;margin:6px auto}
.ptc-msg-system span{background:#e2e8f0;color:#64748b;padding:4px 14px;border-radius:12px;font-size:12px}
.ptc-date-divider{text-align:center;padding:12px 0}
.ptc-date-divider span{background:#e2e8f0;color:#64748b;padding:4px 16px;border-radius:12px;font-size:11px;font-weight:600}
.ptc-input-area{padding:12px 18px;border-top:1px solid #e2e8f0;background:#fff;display:flex;align-items:flex-end;gap:8px}
.ptc-input-area textarea{flex:1;padding:10px 16px;border:2px solid #e2e8f0;border-radius:22px;font-size:14px;font-family:inherit;resize:none;min-height:44px;max-height:120px;line-height:1.4;transition:.2s}
.ptc-input-area textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
.ptc-send-btn{width:44px;height:44px;border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;transition:.2s;background:#4f46e5;color:#fff;flex-shrink:0}
.ptc-send-btn:hover{background:#4338ca;transform:scale(1.05)}
.ptc-attach-btn{width:44px;height:44px;border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;background:#f1f5f9;color:#64748b;transition:.15s;flex-shrink:0}
.ptc-attach-btn:hover{background:#e2e8f0}
.ptc-search-box{padding:10px 18px;border-bottom:1px solid #e2e8f0;background:#fff}
.ptc-search-box input{width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px}
.ptc-search-box input:focus{outline:none;border-color:#4f46e5}
.ptc-search-results{padding:8px 0}
.ptc-search-result{padding:10px 18px;cursor:pointer;border-bottom:1px solid #f1f5f9;transition:.15s}
.ptc-search-result:hover{background:#f1f5f9}
.ptc-search-hl{background:#fef08a;padding:0 2px;border-radius:2px}
.ptc-empty{text-align:center;padding:60px 20px}
.ptc-empty-icon{font-size:48px;margin-bottom:12px}
.ptc-empty h3{color:#64748b;margin:0 0 4px}
.ptc-empty p{color:#94a3b8;font-size:13px;margin:0}
.ptc-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden}
.ptc-form{display:flex;flex-direction:column;gap:16px}
.ptc-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
.ptc-form input,.ptc-form select,.ptc-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
.ptc-form input:focus,.ptc-form select:focus,.ptc-form textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
.ptc-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;transition:.15s;text-decoration:none}
.ptc-btn:hover{opacity:.9;transform:translateY(-1px)}
.ptc-btn-primary{background:#4f46e5;color:#fff}
.ptc-btn-secondary{background:#f1f5f9;color:#475569}
.ptc-btn-danger{background:#fee2e2;color:#dc2626}
.ptc-btn-success{background:#dcfce7;color:#16a34a}
.ptc-badge{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600}
.ptc-announce-bar{background:linear-gradient(135deg,#fef3c7,#fde68a);border:1px solid #fbbf24;border-radius:10px;padding:10px 14px;margin-bottom:10px;display:flex;align-items:center;gap:8px;font-size:13px;color:#92400e}
.ptc-settings-panel{padding:20px;max-width:500px;margin:0 auto}
.ptc-settings-panel h3{font-size:18px;color:#1e293b;margin:0 0 20px}
.ptc-setting-row{display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #f1f5f9}
.ptc-setting-row:last-child{border-bottom:none}
.ptc-setting-label{font-size:14px;font-weight:600;color:#1e293b}
.ptc-setting-desc{font-size:12px;color:#94a3b8;margin-top:2px}
.ptc-toggle{position:relative;width:44px;height:24px;cursor:pointer}
.ptc-toggle input{display:none}
.ptc-toggle span{position:absolute;inset:0;background:#cbd5e1;border-radius:12px;transition:.2s}
.ptc-toggle span::after{content:'';position:absolute;left:2px;top:2px;width:20px;height:20px;border-radius:50%;background:#fff;transition:.2s;box-shadow:0 1px 3px rgba(0,0,0,.2)}
.ptc-toggle input:checked+span{background:#4f46e5}
.ptc-toggle input:checked+span::after{left:22px}
.ptc-poll-bar{background:#f8fafc;border-radius:10px;padding:12px;margin-top:8px;text-align:center}
@media(max-width:768px){.ptc-container{grid-template-columns:1fr;height:calc(100vh - 70px)}.ptc-sidebar{display:none}.ptc-sidebar.show-mobile{display:flex;position:absolute;inset:0;z-index:50;width:100%}.ptc-msg-row{max-width:88%}.ptc-mobile-nav{display:flex!important}}
.ptc-mobile-nav{display:none}
</style>`;

// ============================================================
// SHARED JS — Client-side chat interactions
// ============================================================
const PTC_JS = `<script>
function ptcAutoResize(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px'}
function ptcScrollToBottom(sm){var a=document.getElementById('ptc-msgs');if(a)a.scrollTo({top:a.scrollHeight,behavior:sm?'smooth':'auto'})}
function ptcHandleKeydown(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('ptc-msg-form').submit()}}
window.addEventListener('load',function(){ptcScrollToBottom(false)});
function ptcToggleSidebar(){var s=document.getElementById('ptc-sidebar');if(s)s.classList.toggle('show-mobile')}
function ptcSearchMsgs(){var q=document.getElementById('ptc-search-q').value;var convId=document.getElementById('ptc-search-conv').value;if(!q||!convId)return;window.location.href='/parent-teacher-chat/'+convId+'/search?q='+encodeURIComponent(q)}
function ptcToggleSettings(){var p=document.getElementById('ptc-settings-panel');if(p)p.style.display=p.style.display==='none'?'block':'none'}
function ptcConfirmBlock(name){return confirm('Are you sure you want to block '+name+'? They will not be able to message you.')}
function ptcConfirmUnblock(name){return confirm('Unblock '+name+'? They will be able to message you again.')}
</script>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function parentTeacherChat(app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const notify = opts.notify || (() => {});

  // ============================================================
  // 1. DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS chat_conversations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 0,
      participant1_id INTEGER NOT NULL DEFAULT 0,
      participant1_type VARCHAR(20) NOT NULL DEFAULT 'parent',
      participant2_id INTEGER NOT NULL DEFAULT 0,
      participant2_type VARCHAR(20) NOT NULL DEFAULT 'teacher',
      last_message TEXT,
      last_message_at TIMESTAMPTZ,
      unread_p1 INTEGER NOT NULL DEFAULT 0,
      unread_p2 INTEGER NOT NULL DEFAULT 0,
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      is_muted_p1 BOOLEAN DEFAULT false,
      is_muted_p2 BOOLEAN DEFAULT false,
      is_blocked BOOLEAN DEFAULT false,
      blocked_by INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 0,
      conversation_id INTEGER NOT NULL DEFAULT 0,
      sender_id INTEGER NOT NULL DEFAULT 0,
      sender_type VARCHAR(20) NOT NULL DEFAULT 'parent',
      message TEXT NOT NULL DEFAULT '',
      message_type VARCHAR(20) NOT NULL DEFAULT 'text',
      attachment_url TEXT,
      attachment_name VARCHAR(500),
      is_read BOOLEAN DEFAULT false,
      read_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS chat_announcements (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL DEFAULT 0,
      sender_id INTEGER NOT NULL DEFAULT 0,
      sender_type VARCHAR(20) NOT NULL DEFAULT 'teacher',
      class_id INTEGER DEFAULT 0,
      class_name VARCHAR(255),
      subject VARCHAR(500) NOT NULL DEFAULT '',
      message TEXT NOT NULL DEFAULT '',
      attachment_url TEXT,
      attachment_name VARCHAR(500),
      recipient_count INTEGER DEFAULT 0,
      read_count INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS chat_announcement_reads (
      id SERIAL PRIMARY KEY,
      announcement_id INTEGER NOT NULL DEFAULT 0,
      user_id INTEGER NOT NULL DEFAULT 0,
      read_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(announcement_id, user_id)
    )`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_cc_tenant ON chat_conversations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cc_p1 ON chat_conversations(tenant_id, participant1_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cc_p2 ON chat_conversations(tenant_id, participant2_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cc_last_msg ON chat_conversations(tenant_id, last_message_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_cc_status ON chat_conversations(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_cm_tenant ON chat_messages(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cm_conv ON chat_messages(conversation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cm_sender ON chat_messages(tenant_id, sender_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cm_created ON chat_messages(conversation_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_cm_read ON chat_messages(conversation_id, is_read)`,
    `CREATE INDEX IF NOT EXISTS idx_ca_tenant ON chat_announcements(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ca_class ON chat_announcements(tenant_id, class_id)`,
    `CREATE INDEX IF NOT EXISTS idx_car_ann ON chat_announcement_reads(announcement_id)`,
    `CREATE INDEX IF NOT EXISTS idx_car_user ON chat_announcement_reads(user_id)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) return;
    try {
      for (const sql of migrations) { try { await client.query(sql); } catch (e) { /* skip */ } }
    } catch (e) { /* skip */ }
    finally { client.release(); }
  })();

  // ============================================================
  // INTERNAL HELPERS
  // ============================================================
  function getUserRole(req) {
    const user = req.session.user;
    if (!user) return 'parent';
    const role = (user.role || '').toLowerCase();
    if (role === 'teacher' || role === 'admin' || role === 'staff') return 'teacher';
    return 'parent';
  }

  function getUserId(req) {
    return req.session.user ? (req.session.user.id || 0) : 0;
  }

  function getTenantId(req) {
    return req.session.user ? (req.session.user.tenant_id || 0) : 0;
  }

  async function getUserName(pool, userId) {
    if (!userId) return 'Unknown';
    try {
      const r = await pool.query('SELECT name, email FROM users WHERE id = $1 LIMIT 1', [userId]);
      if (r.rows.length) return r.rows[0].name || r.rows[0].email || 'Unknown';
    } catch (e) { /* ignore */ }
    return 'User #' + userId;
  }

  async function findOrCreateConversation(tenantId, userId, userType, otherId, otherType) {
    // Look for existing conversation between these two participants
    const existing = (await pool.query(
      `SELECT id FROM chat_conversations
       WHERE tenant_id = $1 AND status = 'active' AND is_blocked = false
       AND (
         (participant1_id = $2 AND participant1_type = $3 AND participant2_id = $4 AND participant2_type = $5)
         OR
         (participant1_id = $4 AND participant1_type = $5 AND participant2_id = $2 AND participant2_type = $3)
       )
       LIMIT 1`,
      [tenantId, userId, userType, otherId, otherType]
    )).rows[0];
    if (existing) return existing.id;

    // Create new conversation
    const result = await pool.query(
      `INSERT INTO chat_conversations (tenant_id, participant1_id, participant1_type, participant2_id, participant2_type, status)
       VALUES ($1, $2, $3, $4, $5, 'active') RETURNING id`,
      [tenantId, userId, userType, otherId, otherType]
    );
    return result.rows[0].id;
  }

  async function getUserConversations(pool, tenantId, userId, userType) {
    const rows = (await pool.query(
      `SELECT * FROM chat_conversations
       WHERE tenant_id = $1 AND status = 'active'
       AND ((participant1_id = $2 AND participant1_type = $3) OR (participant2_id = $2 AND participant2_type = $3))
       ORDER BY last_message_at DESC NULLS LAST, created_at DESC`,
      [tenantId, userId, userType]
    )).rows;

    const conversations = [];
    for (const row of rows) {
      const isP1 = (row.participant1_id === userId && row.participant1_type === userType);
      const otherId = isP1 ? row.participant2_id : row.participant1_id;
      const otherType = isP1 ? row.participant2_type : row.participant1_type;
      const unread = isP1 ? (row.unread_p1 || 0) : (row.unread_p2 || 0);
      const isMuted = isP1 ? !!row.is_muted_p1 : !!row.is_muted_p2;
      const otherName = await getUserName(pool, otherId);
      conversations.push({
        ...row,
        otherId,
        otherType,
        otherName,
        unread,
        isMuted
      });
    }
    return conversations;
  }

  async function getConversationMessages(pool, tenantId, convId, offset, limit, searchQuery) {
    let where = 'conversation_id = $1 AND tenant_id = $2';
    const params = [convId, tenantId];
    if (searchQuery) {
      params.push('%' + searchQuery + '%');
      where += ' AND message ILIKE $3';
    }
    params.push(limit, offset);

    const messages = (await pool.query(
      `SELECT * FROM chat_messages WHERE ${where} ORDER BY created_at ASC LIMIT $4 OFFSET $5`,
      params
    )).rows;
    return messages;
  }

  async function getParentsForTeacher(pool, tenantId, teacherId) {
    // Try to get parents linked to the teacher's students
    try {
      const r = await pool.query(
        `SELECT DISTINCT p.id, p.name, p.email, s.name AS student_name, s.class_name
         FROM users p
         JOIN students s ON s.parent_id = p.id
         JOIN class_assignments ca ON ca.student_id = s.id
         WHERE p.tenant_id = $1 AND ca.teacher_id = $2 AND p.role = 'parent'
         ORDER BY p.name ASC LIMIT 500`,
        [tenantId, teacherId]
      );
      if (r.rows.length > 0) return r.rows;
    } catch (e) { /* fallback */ }
    // Fallback: get all parents
    try {
      const r = await pool.query(
        `SELECT id, name, email FROM users WHERE tenant_id = $1 AND role = 'parent' AND is_active = true ORDER BY name ASC LIMIT 500`,
        [tenantId]
      );
      return r.rows;
    } catch (e) { return []; }
  }

  async function getTeachersForParent(pool, tenantId, parentId) {
    // Try to get teachers linked to the parent's children
    try {
      const r = await pool.query(
        `SELECT DISTINCT t.id, t.name, t.email, s.name AS student_name, s.class_name
         FROM users t
         JOIN class_assignments ca ON ca.teacher_id = t.id
         JOIN students s ON s.id = ca.student_id AND s.parent_id = $2
         WHERE t.tenant_id = $1 AND t.role = 'teacher' AND t.is_active = true
         ORDER BY t.name ASC LIMIT 500`,
        [tenantId, parentId]
      );
      if (r.rows.length > 0) return r.rows;
    } catch (e) { /* fallback */ }
    // Fallback: get all teachers
    try {
      const r = await pool.query(
        `SELECT id, name, email FROM users WHERE tenant_id = $1 AND role = 'teacher' AND is_active = true ORDER BY name ASC LIMIT 500`,
        [tenantId]
      );
      return r.rows;
    } catch (e) { return []; }
  }

  async function getClassesForTeacher(pool, tenantId, teacherId) {
    try {
      const r = await pool.query(
        `SELECT DISTINCT c.id, c.name FROM classes c
         JOIN class_assignments ca ON ca.class_id = c.id
         WHERE c.tenant_id = $1 AND ca.teacher_id = $2
         ORDER BY c.name ASC LIMIT 100`,
        [tenantId, teacherId]
      );
      return r.rows;
    } catch (e) { return []; }
  }

  // ============================================================
  // ROUTE 1: GET /parent-teacher-chat — Conversation List
  // ============================================================
  app.get('/parent-teacher-chat', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);

    const conversations = await getUserConversations(pool, tid, uid, uType);
    const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

    const convListHtml = conversations.length === 0
      ? `<div class="ptc-empty">
           <div class="ptc-empty-icon">💬</div>
           <h3>No conversations yet</h3>
           <p>Start a new conversation to begin messaging</p>
           <a href="/parent-teacher-chat/new" class="ptc-btn ptc-btn-primary" style="margin-top:16px">Start New Chat</a>
         </div>`
      : conversations.map(c => {
          const preview = c.last_message
            ? esc(truncate(c.last_message.replace(/<[^>]*>/g, ''), 60))
            : '<span style="color:#cbd5e1">No messages yet</span>';
          return `<a href="/parent-teacher-chat/${esc(c.id)}" class="ptc-conv-item ${c.isMuted ? 'muted' : ''}" aria-label="Conversation with ${esc(c.otherName)}">
            <div class="ptc-avatar" style="background:${avatarColor(c.otherName)}">
              ${esc(initials(c.otherName))}
              ${c.otherType === 'teacher' ? '<span class="ptc-online"></span>' : ''}
            </div>
            <div class="ptc-conv-info">
              <div class="ptc-conv-name">${esc(c.otherName)} <span style="font-size:11px;color:#94a3b8;font-weight:400">${c.otherType === 'teacher' ? '(Teacher)' : '(Parent)'}</span></div>
              <div class="ptc-conv-preview">${preview}</div>
            </div>
            <div class="ptc-conv-meta">
              <div class="ptc-conv-time">${c.last_message_at ? relativeTime(c.last_message_at) : ''}</div>
              ${c.unread > 0 ? `<div class="ptc-unread-badge" aria-label="${c.unread} unread messages">${c.unread > 99 ? '99+' : c.unread}</div>` : ''}
            </div>
          </a>`;
        }).join('');

    const html = PTC_CSS + PTC_JS + `<div class="ptc-wrap">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b;margin:0">Parent-Teacher Chat</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Communicate directly with ${uType === 'teacher' ? 'parents' : 'teachers'}</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          ${totalUnread > 0 ? `<span style="background:#ef4444;color:#fff;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600" aria-label="${totalUnread} total unread messages">${totalUnread} unread</span>` : ''}
          ${uType === 'teacher' ? '<a href="/parent-teacher-chat/announcements" class="ptc-btn ptc-btn-primary" style="background:#f59e0b;color:#fff">Announcements</a>' : ''}
          <a href="/parent-teacher-chat/new" class="ptc-btn ptc-btn-primary">New Chat</a>
        </div>
      </div>
      <div class="ptc-container">
        <div class="ptc-sidebar" id="ptc-sidebar">
          <div class="ptc-sidebar-hdr">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <h2>Messages</h2>
              <a href="/parent-teacher-chat/new" style="color:#fff;font-size:20px;text-decoration:none" aria-label="New conversation">✏️</a>
            </div>
            <p>${totalUnread > 0 ? totalUnread + ' unread messages' : 'All caught up!'}</p>
          </div>
          <div class="ptc-sidebar-tabs">
            <a href="/parent-teacher-chat" class="active">All</a>
            <a href="/parent-teacher-chat?filter=unread">Unread</a>
            ${uType === 'teacher' ? '<a href="/parent-teacher-chat/announcements">Announcements</a>' : ''}
          </div>
          <div class="ptc-conv-list">${convListHtml}</div>
        </div>
        <div class="ptc-main" style="display:flex;align-items:center;justify-content:center">
          <div class="ptc-empty">
            <div class="ptc-empty-icon">💬</div>
            <h3>Select a conversation</h3>
            <p>Choose a chat from the list or start a new one</p>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Parent-Teacher Chat', html, user));
  }));

  // ============================================================
  // ROUTE 2: GET /parent-teacher-chat/new — New Conversation
  // ============================================================
  app.get('/parent-teacher-chat/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);

    let contacts = [];
    if (uType === 'teacher') {
      contacts = await getParentsForTeacher(pool, tid, uid);
    } else {
      contacts = await getTeachersForParent(pool, tid, uid);
    }

    const searchQuery = (req.query.q || '').toLowerCase();

    const contactsHtml = contacts.length === 0
      ? `<div style="text-align:center;padding:40px;color:#94a3b8;font-size:13px">No ${uType === 'teacher' ? 'parents' : 'teachers'} found</div>`
      : contacts
          .filter(c => !searchQuery || (c.name || '').toLowerCase().includes(searchQuery) || (c.email || '').toLowerCase().includes(searchQuery) || (c.student_name || '').toLowerCase().includes(searchQuery))
          .map(c => `<a href="/parent-teacher-chat/new?to=${esc(c.id)}" class="ptc-conv-item" style="text-decoration:none;color:inherit" aria-label="Start chat with ${esc(c.name || c.email)}">
            <div class="ptc-avatar" style="background:${avatarColor(c.name || c.email)}">${esc(initials(c.name || c.email))}</div>
            <div class="ptc-conv-info">
              <div class="ptc-conv-name">${esc(c.name || c.email)}</div>
              <div class="ptc-conv-preview">${c.student_name ? 'Student: ' + esc(c.student_name) : esc(c.email || '')}</div>
            </div>
            <div class="ptc-conv-meta"><div style="color:#4f46e5;font-size:13px;font-weight:600">Message →</div></div>
          </a>`).join('');

    // Auto-redirect if "to" param provided
    if (req.query.to) {
      const toId = parseInt(req.query.to);
      if (toId) {
        const otherType = uType === 'teacher' ? 'parent' : 'teacher';
        const convId = await findOrCreateConversation(tid, uid, uType, toId, otherType);
        return res.redirect('/parent-teacher-chat/' + convId);
      }
    }

    const html = PTC_CSS + `<div class="ptc-wrap" style="max-width:700px">
      <a href="/parent-teacher-chat" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Messages</a>
      <div class="ptc-card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b;font-size:20px">New Conversation</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Select a ${uType === 'teacher' ? 'parent' : 'teacher'} to start chatting with</p>
        <div class="ptc-search-box" style="margin-bottom:16px">
          <form method="GET">
            <input type="text" name="q" value="${esc(req.query.q || '')}" placeholder="Search by name, email, or student..." aria-label="Search contacts">
          </form>
        </div>
        <div style="max-height:500px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:12px">${contactsHtml}</div>
      </div>
    </div>`;
    res.send(renderPage('New Conversation', html, user));
  }));

  // ============================================================
  // ROUTE 3: GET /parent-teacher-chat/:id — Chat Window
  // ============================================================
  app.get('/parent-teacher-chat/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);
    const convId = parseInt(req.params.id);
    const offset = parseInt(req.query.offset) || 0;
    const limit = 50;

    // Validate conversation exists and user is a participant
    const conv = (await pool.query(
      `SELECT * FROM chat_conversations WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [convId, tid]
    )).rows[0];

    if (!conv) {
      return res.send(renderPage('Not Found', '<div class="ptc-empty"><h3>Conversation not found</h3><a href="/parent-teacher-chat" class="ptc-btn ptc-btn-primary" style="margin-top:12px">Back to Messages</a></div>', user));
    }

    // Check user is participant
    const isP1 = (conv.participant1_id === uid && conv.participant1_type === uType);
    const isP2 = (conv.participant2_id === uid && conv.participant2_type === uType);
    if (!isP1 && !isP2) {
      return res.send(renderPage('Access Denied', '<div class="ptc-empty"><h3>Access denied</h3><a href="/parent-teacher-chat" class="ptc-btn ptc-btn-primary" style="margin-top:12px">Back to Messages</a></div>', user));
    }

    // Check if blocked
    if (conv.is_blocked && conv.blocked_by !== uid) {
      return res.send(renderPage('Blocked', '<div class="ptc-empty"><div class="ptc-empty-icon">🚫</div><h3>Conversation is blocked</h3><p>This conversation has been blocked.</p><a href="/parent-teacher-chat" class="ptc-btn ptc-btn-primary" style="margin-top:12px">Back to Messages</a></div>', user));
    }

    // Get other participant info
    const otherId = isP1 ? conv.participant2_id : conv.participant1_id;
    const otherType = isP1 ? conv.participant2_type : conv.participant1_type;
    const otherName = await getUserName(pool, otherId);

    // Auto-mark messages as read
    const updateCol = isP1 ? 'unread_p1' : 'unread_p2';
    await pool.query(
      `UPDATE chat_conversations SET ${updateCol} = 0, updated_at = NOW() WHERE id = $1`,
      [convId]
    );
    await pool.query(
      `UPDATE chat_messages SET is_read = true, read_at = NOW() WHERE conversation_id = $1 AND tenant_id = $2 AND sender_id != $3 AND is_read = false`,
      [convId, tid, uid]
    );

    // Get messages
    const messages = await getConversationMessages(pool, tid, convId, offset, limit, null);
    const hasMore = messages.length >= limit;

    // Get user conversations for sidebar
    const conversations = await getUserConversations(pool, tid, uid, uType);

    // Build message bubbles HTML
    let lastDate = '';
    const messagesHtml = messages.map(m => {
      let dateHd = '';
      const mDate = m.created_at ? new Date(m.created_at).toLocaleDateString() : '';
      if (mDate && mDate !== lastDate) {
        lastDate = mDate;
        const today = new Date().toLocaleDateString();
        const yest = new Date(Date.now() - 86400000).toLocaleDateString();
        let dl = mDate === today ? 'Today' : mDate === yest ? 'Yesterday' : formatFullDate(m.created_at);
        dateHd = `<div class="ptc-date-divider"><span>${esc(dl)}</span></div>`;
      }

      const isAnnouncement = m.message_type === 'announcement';
      const isSystem = m.message_type === 'system';
      if (isSystem) return dateHd + `<div class="ptc-msg-system"><span>${esc(m.message)}</span></div>`;

      const isSent = m.sender_id === uid;
      const alignClass = isAnnouncement ? 'announcement' : (isSent ? 'teacher' : 'parent');

      const senderName = isSent ? 'You' : otherName;
      const receiptIcon = isSent
        ? (m.is_read ? '✓✓' : '✓')
        : '';
      const receiptColor = isSent
        ? (m.is_read ? 'color:#93c5fd' : 'color:rgba(255,255,255,.5)')
        : '';

      const attachmentHtml = (m.attachment_url || m.attachment_name)
        ? `<div class="ptc-msg-attachment">📎 <a href="${esc(m.attachment_url || '#')}" target="_blank" rel="noopener noreferrer">${esc(m.attachment_name || 'Attachment')}</a></div>`
        : '';

      // Linkify URLs in the message text
      let msgText = esc(m.message);
      msgText = msgText.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener noreferrer" style="color:inherit;text-decoration:underline">$1</a>');

      return `${dateHd}<div class="ptc-msg-row ${alignClass}" role="log" aria-label="${isSent ? 'You' : esc(senderName)} at ${shortTime(m.created_at)}">
        <div class="ptc-msg-bubble">
          ${isAnnouncement ? '<div style="font-size:11px;font-weight:700;opacity:.8;margin-bottom:4px">📢 ANNOUNCEMENT</div>' : ''}
          <div>${msgText}</div>
          ${attachmentHtml}
          <div class="ptc-msg-time">${shortTime(m.created_at)} <span class="ptc-msg-receipt" style="${receiptColor}">${receiptIcon}</span></div>
        </div>
      </div>`;
    }).join('');

    // Sidebar conversations
    const convListHtml = conversations.map(c => {
      const isActive = c.id === convId ? ' active' : '';
      const preview = c.last_message ? esc(truncate(c.last_message.replace(/<[^>]*>/g, ''), 50)) : '<span style="color:#cbd5e1">No messages yet</span>';
      return `<a href="/parent-teacher-chat/${esc(c.id)}" class="ptc-conv-item${isActive} ${c.isMuted ? 'muted' : ''}">
        <div class="ptc-avatar" style="background:${avatarColor(c.otherName)}">${esc(initials(c.otherName))}</div>
        <div class="ptc-conv-info">
          <div class="ptc-conv-name">${esc(c.otherName)}</div>
          <div class="ptc-conv-preview">${preview}</div>
        </div>
        <div class="ptc-conv-meta">
          <div class="ptc-conv-time">${c.last_message_at ? relativeTime(c.last_message_at) : ''}</div>
          ${c.unread > 0 ? `<div class="ptc-unread-badge">${c.unread > 99 ? '99+' : c.unread}</div>` : ''}
        </div>
      </a>`;
    }).join('');

    // Blocked indicator
    const blockedHtml = conv.is_blocked
      ? `<div class="ptc-announce-bar" style="background:#fee2e2;border-color:#fca5a5;color:#991b1b">🚫 This conversation is blocked by ${conv.blocked_by === uid ? 'you' : 'the other participant'}.</div>`
      : '';

    const html = PTC_CSS + PTC_JS + `<div class="ptc-wrap">
      <div class="ptc-container">
        <div class="ptc-sidebar" id="ptc-sidebar">
          <div class="ptc-sidebar-hdr">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <h2>Messages</h2>
              <div>
                <button class="ptc-action-btn" onclick="ptcToggleSidebar()" style="background:rgba(255,255,255,.2);border:none;color:#fff;display:none" id="ptc-sidebar-close">✕</button>
                <a href="/parent-teacher-chat/new" style="color:#fff;font-size:18px;text-decoration:none;margin-left:6px" aria-label="New conversation">✏️</a>
              </div>
            </div>
            <div class="ptc-search-box" style="margin:10px -18px 0;border:none;padding:0">
              <input type="text" placeholder="Search conversations..." onclick="window.location='/parent-teacher-chat/new'" style="background:rgba(255,255,255,.2);border:none;color:#fff;font-size:12px" aria-label="Search conversations">
            </div>
          </div>
          <div class="ptc-conv-list">${convListHtml}</div>
        </div>
        <div class="ptc-main">
          <div class="ptc-chat-hdr">
            <div style="display:flex;align-items:center;gap:12px">
              <button class="ptc-action-btn" onclick="ptcToggleSidebar()" style="display:none" id="ptc-mobile-menu" aria-label="Show conversations menu">☰</button>
              <div class="ptc-avatar" style="background:${avatarColor(otherName)};width:38px;height:38px;font-size:14px">
                ${esc(initials(otherName))}
                <span class="ptc-online"></span>
              </div>
              <div>
                <div class="ptc-chat-title">${esc(otherName)}</div>
                <div class="ptc-chat-sub">${otherType === 'teacher' ? 'Teacher' : 'Parent'}${conv.is_blocked ? ' · Blocked' : ''}</div>
              </div>
            </div>
            <div class="ptc-actions">
              <a href="/parent-teacher-chat/${convId}/search" class="ptc-action-btn" aria-label="Search messages">🔍</a>
              <a href="/parent-teacher-chat/${convId}/settings" class="ptc-action-btn" aria-label="Conversation settings">⚙️</a>
              ${uType === 'teacher' ? '<a href="/parent-teacher-chat/announcements" class="ptc-action-btn" style="background:#fef3c7;border-color:#fbbf24;color:#92400e" aria-label="Send announcement">📢</a>' : ''}
            </div>
          </div>
          ${blockedHtml}
          <div class="ptc-messages" id="ptc-msgs" role="log" aria-label="Chat messages" aria-live="polite">
            ${messagesHtml}
            ${hasMore ? `<div style="text-align:center;padding:10px">
              <a href="/parent-teacher-chat/${convId}?offset=${offset + limit}" class="ptc-btn ptc-btn-secondary" style="font-size:13px">Load earlier messages</a>
            </div>` : ''}
          </div>
          ${!conv.is_blocked ? `
          <form method="POST" action="/parent-teacher-chat/${convId}/send" id="ptc-msg-form" class="ptc-input-area" aria-label="Send message form">
            <input type="hidden" name="attachment_url" id="ptc-attach-url" value="">
            <input type="hidden" name="attachment_name" id="ptc-attach-name" value="">
            <button type="button" class="ptc-attach-btn" onclick="document.getElementById('ptc-attach-dialog').style.display=document.getElementById('ptc-attach-dialog').style.display==='none'?'block':'none'" title="Attach link" aria-label="Attach a link">📎</button>
            <textarea id="ptc-msg-input" name="message" placeholder="Type a message..." rows="1" oninput="ptcAutoResize(this)" onkeydown="ptcHandleKeydown(event)" required aria-label="Message input"></textarea>
            <button type="submit" class="ptc-send-btn" title="Send message" aria-label="Send message">➤</button>
          </form>
          <div id="ptc-attach-dialog" style="display:none;position:absolute;bottom:80px;left:18px;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;box-shadow:0 8px 30px rgba(0,0,0,.15);z-index:100;width:320px">
            <div style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:8px">📎 Attach a Link</div>
            <input type="url" id="ptc-url-input" placeholder="https://example.com/file.pdf" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:6px" aria-label="Attachment URL">
            <input type="text" id="ptc-name-input" placeholder="File name (optional)" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:10px" aria-label="Attachment file name">
            <div style="display:flex;gap:6px;justify-content:flex-end">
              <button type="button" class="ptc-btn ptc-btn-secondary" style="padding:6px 12px;font-size:12px" onclick="document.getElementById('ptc-attach-dialog').style.display='none'">Cancel</button>
              <button type="button" class="ptc-btn ptc-btn-primary" style="padding:6px 12px;font-size:12px" onclick="var u=document.getElementById('ptc-url-input').value,n=document.getElementById('ptc-name-input').value;if(u){document.getElementById('ptc-attach-url').value=u;document.getElementById('ptc-attach-name').value=n||'Attachment';document.getElementById('ptc-attach-dialog').style.display='none';document.getElementById('ptc-msg-input').focus()}else{alert('Please enter a URL')}">Attach</button>
            </div>
          </div>` : ''}
        </div>
      </div>
    </div>
    <script>
    if(window.innerWidth<=768){document.getElementById('ptc-mobile-menu').style.display='flex';document.getElementById('ptc-sidebar-close').style.display='block'}
    window.addEventListener('resize',function(){var m=document.getElementById('ptc-mobile-menu'),c=document.getElementById('ptc-sidebar-close');if(window.innerWidth<=768){m.style.display='flex';c.style.display='block'}else{m.style.display='none';c.style.display='none';document.getElementById('ptc-sidebar').classList.remove('show-mobile')}});
    </script>`;
    res.send(renderPage('Chat with ' + otherName, html, user));
  }));

  // ============================================================
  // ROUTE 4: POST /parent-teacher-chat/:id/send — Send Message
  // ============================================================
  app.post('/parent-teacher-chat/:id/send', requireAuth, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);
    const convId = parseInt(req.params.id);
    const { message, attachment_url, attachment_name } = req.body;

    if (!message || !message.trim()) return res.redirect('/parent-teacher-chat/' + convId);

    // Validate conversation
    const conv = (await pool.query(
      `SELECT * FROM chat_conversations WHERE id = $1 AND tenant_id = $2 AND status = 'active' AND is_blocked = false`,
      [convId, tid]
    )).rows[0];
    if (!conv) return res.redirect('/parent-teacher-chat');

    const isP1 = (conv.participant1_id === uid && conv.participant1_type === uType);
    const isP2 = (conv.participant2_id === uid && conv.participant2_type === uType);
    if (!isP1 && !isP2) return res.redirect('/parent-teacher-chat');

    // Insert message
    const msgType = attachment_url ? 'attachment' : 'text';
    await pool.query(
      `INSERT INTO chat_messages (tenant_id, conversation_id, sender_id, sender_type, message, message_type, attachment_url, attachment_name, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, NOW())`,
      [tid, convId, uid, uType, message.trim(), msgType, attachment_url || null, attachment_name || null]
    );

    // Update conversation
    const incrementCol = isP1 ? 'unread_p2' : 'unread_p1';
    await pool.query(
      `UPDATE chat_conversations SET last_message = $1, last_message_at = NOW(), ${incrementCol} = ${incrementCol} + 1, updated_at = NOW() WHERE id = $2`,
      [message.trim().substring(0, 255), convId]
    );

    // Notify the other participant
    const otherId = isP1 ? conv.participant2_id : conv.participant1_id;
    try { notify(tid, otherId, 'New Message', truncate(message.trim(), 80), 'chat'); } catch (e) { /* ignore */ }

    audit(uid, 'ptc_send_message', 'Sent message in conversation #' + convId);
    res.redirect('/parent-teacher-chat/' + convId + '#' + Date.now());
  }));

  // ============================================================
  // ROUTE 5: GET /parent-teacher-chat/:id/search — Search Messages
  // ============================================================
  app.get('/parent-teacher-chat/:id/search', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);
    const convId = parseInt(req.params.id);
    const q = (req.query.q || '').trim();

    // Validate conversation
    const conv = (await pool.query(
      `SELECT * FROM chat_conversations WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [convId, tid]
    )).rows[0];
    if (!conv) return res.redirect('/parent-teacher-chat');

    const isP1 = (conv.participant1_id === uid && conv.participant1_type === uType);
    const isP2 = (conv.participant2_id === uid && conv.participant2_type === uType);
    if (!isP1 && !isP2) return res.redirect('/parent-teacher-chat');

    const otherId = isP1 ? conv.participant2_id : conv.participant1_id;
    const otherName = await getUserName(pool, otherId);

    let messages = [];
    if (q) {
      messages = await getConversationMessages(pool, tid, convId, 0, 100, q);
    }

    function highlightText(text, query) {
      if (!query || !text) return esc(text);
      const safe = esc(text);
      const safeQ = esc(query);
      const regex = new RegExp('(' + safeQ.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'gi');
      return safe.replace(regex, '<span class="ptc-search-hl">$1</span>');
    }

    const resultsHtml = !q
      ? `<div class="ptc-empty"><div class="ptc-empty-icon">🔍</div><h3>Search Messages</h3><p>Enter a keyword to search within this conversation</p></div>`
      : messages.length === 0
        ? `<div class="ptc-empty"><div class="ptc-empty-icon">🔍</div><h3>No results</h3><p>No messages matching "${esc(q)}" were found</p></div>`
        : `<div style="padding:8px 0">${messages.map(m => {
            const isSent = m.sender_id === uid;
            const alignClass = isSent ? 'teacher' : 'parent';
            const senderLbl = isSent ? 'You' : esc(otherName);
            return `<div class="ptc-search-result" onclick="window.location='/parent-teacher-chat/${convId}'">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
                <span style="font-size:12px;font-weight:700;color:#4f46e5">${senderLbl}</span>
                <span style="font-size:11px;color:#94a3b8">${relativeTime(m.created_at)}</span>
              </div>
              <div style="font-size:13px;color:#334155;line-height:1.5">${highlightText(m.message, q)}</div>
            </div>`;
          }).join('')}</div>`;

    const html = PTC_CSS + `<div class="ptc-wrap" style="max-width:700px">
      <a href="/parent-teacher-chat/${convId}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Chat</a>
      <div class="ptc-card" style="padding:24px">
        <h2 style="margin:0 0 16px;color:#1e293b;font-size:20px">🔍 Search Messages</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:16px">Search in conversation with ${esc(otherName)}</p>
        <form method="GET" style="display:flex;gap:8px;margin-bottom:20px">
          <input type="text" name="q" value="${esc(q)}" placeholder="Enter keyword..." style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" aria-label="Search keyword">
          <button type="submit" class="ptc-btn ptc-btn-primary">Search</button>
        </form>
        <div style="max-height:500px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:12px">${resultsHtml}</div>
      </div>
    </div>`;
    res.send(renderPage('Search Messages', html, user));
  }));

  // ============================================================
  // ROUTE 6: GET /parent-teacher-chat/:id/settings — Conv Settings
  // ============================================================
  app.get('/parent-teacher-chat/:id/settings', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);
    const convId = parseInt(req.params.id);

    const conv = (await pool.query(
      `SELECT * FROM chat_conversations WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [convId, tid]
    )).rows[0];
    if (!conv) return res.redirect('/parent-teacher-chat');

    const isP1 = (conv.participant1_id === uid && conv.participant1_type === uType);
    const isP2 = (conv.participant2_id === uid && conv.participant2_type === uType);
    if (!isP1 && !isP2) return res.redirect('/parent-teacher-chat');

    const otherId = isP1 ? conv.participant2_id : conv.participant1_id;
    const otherName = await getUserName(pool, otherId);
    const isMuted = isP1 ? !!conv.is_muted_p1 : !!conv.is_muted_p2;
    const isBlocked = !!conv.is_blocked;
    const blockedByMe = isBlocked && conv.blocked_by === uid;

    const html = PTC_CSS + `<div class="ptc-wrap" style="max-width:600px">
      <a href="/parent-teacher-chat/${convId}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Chat</a>
      <div class="ptc-card">
        <div style="padding:20px 20px 0;display:flex;align-items:center;gap:14px;border-bottom:1px solid #e2e8f0;padding-bottom:16px">
          <div class="ptc-avatar" style="background:${avatarColor(otherName)};width:56px;height:56px;font-size:22px">${esc(initials(otherName))}</div>
          <div>
            <h3 style="margin:0;font-size:18px;color:#1e293b">${esc(otherName)}</h3>
            <p style="margin:4px 0 0;font-size:13px;color:#94a3b8">Conversation #${convId} · Started ${formatFullDate(conv.created_at)}</p>
          </div>
        </div>
        <div class="ptc-settings-panel">
          <!-- Mute Notifications -->
          <div class="ptc-setting-row">
            <div>
              <div class="ptc-setting-label">Mute Notifications</div>
              <div class="ptc-setting-desc">You won't receive notifications for new messages</div>
            </div>
            <form method="POST" action="/parent-teacher-chat/${convId}/settings/mute" style="margin:0">
              <label class="ptc-toggle" aria-label="Toggle mute notifications">
                <input type="checkbox" name="is_muted" ${isMuted ? 'checked' : ''} onchange="this.form.submit()">
                <span></span>
              </label>
            </form>
          </div>

          <!-- Block User -->
          <div class="ptc-setting-row">
            <div>
              <div class="ptc-setting-label">${blockedByMe ? 'Unblock User' : 'Block User'}</div>
              <div class="ptc-setting-desc">${blockedByMe ? 'Allow messages from this user again' : 'Prevent this user from messaging you'}</div>
            </div>
            ${blockedByMe
              ? `<form method="POST" action="/parent-teacher-chat/${convId}/settings/unblock" style="margin:0">
                   <button type="submit" class="ptc-btn ptc-btn-success" style="padding:6px 14px;font-size:12px">Unblock</button>
                 </form>`
              : `<form method="POST" action="/parent-teacher-chat/${convId}/settings/block" style="margin:0" onsubmit="return ptcConfirmBlock('${esc(otherName)}')">
                   <button type="submit" class="ptc-btn ptc-btn-danger" style="padding:6px 14px;font-size:12px">Block</button>
                 </form>`
            }
          </div>

          <!-- Clear Chat -->
          <div class="ptc-setting-row">
            <div>
              <div class="ptc-setting-label">Clear Chat History</div>
              <div class="ptc-setting-desc">Delete all messages in this conversation</div>
            </div>
            <form method="POST" action="/parent-teacher-chat/${convId}/settings/clear" style="margin:0" onsubmit="return confirm('Are you sure? This will delete all messages permanently.')">
              <button type="submit" class="ptc-btn ptc-btn-danger" style="padding:6px 14px;font-size:12px">Clear</button>
            </form>
          </div>

          <!-- Info -->
          <div style="margin-top:20px;padding:14px;background:#f8fafc;border-radius:10px">
            <div style="font-size:12px;font-weight:600;color:#64748b;margin-bottom:8px">CONVERSATION INFO</div>
            <div style="display:grid;gap:6px;font-size:13px;color:#334155">
              <div><strong>Participant:</strong> ${esc(otherName)}</div>
              <div><strong>Type:</strong> ${otherType === 'teacher' ? 'Teacher' : 'Parent'}</div>
              <div><strong>Started:</strong> ${formatFullDate(conv.created_at)}</div>
              <div><strong>Last Activity:</strong> ${conv.last_message_at ? formatFullDate(conv.last_message_at) : 'Never'}</div>
              <div><strong>Status:</strong> ${isBlocked ? '<span style="color:#dc2626;font-weight:600">Blocked</span>' : '<span style="color:#16a34a;font-weight:600">Active</span>'}</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Chat Settings', html, user));
  }));

  // ============================================================
  // ROUTE 7: POST settings endpoints
  // ============================================================
  // Mute toggle
  app.post('/parent-teacher-chat/:id/settings/mute', requireAuth, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);
    const convId = parseInt(req.params.id);
    const isMuted = req.body.is_muted === 'on';

    const conv = (await pool.query('SELECT * FROM chat_conversations WHERE id = $1 AND tenant_id = $2', [convId, tid])).rows[0];
    if (!conv) return res.redirect('/parent-teacher-chat');

    const isP1 = (conv.participant1_id === uid && conv.participant1_type === uType);
    const col = isP1 ? 'is_muted_p1' : 'is_muted_p2';
    await pool.query(`UPDATE chat_conversations SET ${col} = $1, updated_at = NOW() WHERE id = $2`, [isMuted, convId]);

    audit(uid, 'ptc_mute_toggle', `${isMuted ? 'Muted' : 'Unmuted'} conversation #${convId}`);
    res.redirect('/parent-teacher-chat/' + convId + '/settings');
  }));

  // Block
  app.post('/parent-teacher-chat/:id/settings/block', requireAuth, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);
    const convId = parseInt(req.params.id);

    const conv = (await pool.query('SELECT * FROM chat_conversations WHERE id = $1 AND tenant_id = $2', [convId, tid])).rows[0];
    if (!conv) return res.redirect('/parent-teacher-chat');

    await pool.query(
      'UPDATE chat_conversations SET is_blocked = true, blocked_by = $1, updated_at = NOW() WHERE id = $2',
      [uid, convId]
    );

    audit(uid, 'ptc_block', 'Blocked conversation #' + convId);
    res.redirect('/parent-teacher-chat/' + convId + '/settings');
  }));

  // Unblock
  app.post('/parent-teacher-chat/:id/settings/unblock', requireAuth, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const convId = parseInt(req.params.id);

    const conv = (await pool.query('SELECT * FROM chat_conversations WHERE id = $1 AND tenant_id = $2', [convId, tid])).rows[0];
    if (!conv) return res.redirect('/parent-teacher-chat');

    await pool.query(
      'UPDATE chat_conversations SET is_blocked = false, blocked_by = 0, updated_at = NOW() WHERE id = $1',
      [convId]
    );

    audit(uid, 'ptc_unblock', 'Unblocked conversation #' + convId);
    res.redirect('/parent-teacher-chat/' + convId + '/settings');
  }));

  // Clear chat
  app.post('/parent-teacher-chat/:id/settings/clear', requireAuth, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const convId = parseInt(req.params.id);

    const conv = (await pool.query('SELECT * FROM chat_conversations WHERE id = $1 AND tenant_id = $2', [convId, tid])).rows[0];
    if (!conv) return res.redirect('/parent-teacher-chat');

    await pool.query('DELETE FROM chat_messages WHERE conversation_id = $1 AND tenant_id = $2', [convId, tid]);
    await pool.query(
      'UPDATE chat_conversations SET last_message = NULL, last_message_at = NULL, unread_p1 = 0, unread_p2 = 0, updated_at = NOW() WHERE id = $1',
      [convId]
    );

    audit(uid, 'ptc_clear_chat', 'Cleared chat history for conversation #' + convId);
    res.redirect('/parent-teacher-chat/' + convId);
  }));

  // ============================================================
  // ROUTE 8: GET /parent-teacher-chat/announcements — Announcements
  // ============================================================
  app.get('/parent-teacher-chat/announcements', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);

    if (uType !== 'teacher' && uType !== 'admin') {
      return res.redirect('/parent-teacher-chat');
    }

    const classes = await getClassesForTeacher(pool, tid, uid);
    const announcements = (await pool.query(
      `SELECT a.*, u.name AS sender_name FROM chat_announcements a
       LEFT JOIN users u ON u.id = a.sender_id
       WHERE a.tenant_id = $1 AND a.sender_id = $2
       ORDER BY a.created_at DESC LIMIT 50`,
      [tid, uid]
    )).rows;

    const announcementsHtml = announcements.length === 0
      ? `<div class="ptc-empty"><div class="ptc-empty-icon">📢</div><h3>No announcements yet</h3><p>Create your first announcement to broadcast to parents</p></div>`
      : announcements.map(a => `<div style="padding:16px;border-bottom:1px solid #f1f5f9">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div>
              <div style="font-size:14px;font-weight:700;color:#1e293b">${esc(a.subject)}</div>
              <div style="font-size:12px;color:#94a3b8">${a.class_name ? esc(a.class_name) + ' · ' : ''}${relativeTime(a.created_at)}</div>
            </div>
            <div style="display:flex;align-items:center;gap:6px">
              <span class="ptc-badge" style="background:#dcfce7;color:#16a34a">${a.read_count || 0}/${a.recipient_count || 0} read</span>
              <form method="POST" action="/parent-teacher-chat/announcements/${a.id}/delete" style="display:inline" onsubmit="return confirm('Delete this announcement?')">
                <button type="submit" style="background:none;border:none;cursor:pointer;font-size:14px;color:#94a3b8" title="Delete" aria-label="Delete announcement">🗑️</button>
              </form>
            </div>
          </div>
          <div style="font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap">${esc(a.message)}</div>
          ${a.attachment_url ? `<div style="margin-top:8px;padding:8px 12px;background:#f8fafc;border-radius:8px;font-size:12px">📎 <a href="${esc(a.attachment_url)}" target="_blank" style="color:#4f46e5;text-decoration:underline">${esc(a.attachment_name || 'View Attachment')}</a></div>` : ''}
        </div>`).join('');

    const html = PTC_CSS + `<div class="ptc-wrap" style="max-width:800px">
      <a href="/parent-teacher-chat" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Messages</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#1e293b;margin:0">Announcements</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">Broadcast messages to parents</p>
        </div>
      </div>

      <!-- New Announcement Form -->
      <div class="ptc-card" style="padding:20px;margin-bottom:16px">
        <h3 style="margin:0 0 16px;color:#1e293b;font-size:16px">📢 New Announcement</h3>
        <form method="POST" action="/parent-teacher-chat/announcements/send" class="ptc-form">
          <div>
            <label for="announce-class">Class (leave empty for all parents)</label>
            <select name="class_id" id="announce-class">
              <option value="">All Parents</option>
              ${classes.map(c => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('')}
            </select>
          </div>
          <div>
            <label for="announce-subject">Subject</label>
            <input type="text" name="subject" id="announce-subject" required placeholder="Announcement subject..." maxlength="500">
          </div>
          <div>
            <label for="announce-message">Message</label>
            <textarea name="message" id="announce-message" rows="4" required placeholder="Write your announcement..."></textarea>
          </div>
          <div>
            <label for="announce-url">Attachment Link (optional)</label>
            <input type="url" name="attachment_url" id="announce-url" placeholder="https://example.com/document.pdf">
          </div>
          <div>
            <label for="announce-file">Attachment Name (optional)</label>
            <input type="text" name="attachment_name" id="announce-file" placeholder="e.g., Homework Sheet.pdf">
          </div>
          <button type="submit" class="ptc-btn ptc-btn-primary" style="background:#f59e0b;color:#fff">📢 Send Announcement</button>
        </form>
      </div>

      <!-- Announcements List -->
      <div class="ptc-card">
        <div style="padding:14px 18px;border-bottom:1px solid #e2e8f0;font-size:14px;font-weight:700;color:#1e293b">
          Recent Announcements (${announcements.length})
        </div>
        ${announcementsHtml}
      </div>
    </div>`;
    res.send(renderPage('Announcements', html, user));
  }));

  // ============================================================
  // ROUTE 9: POST /parent-teacher-chat/announcements/send — Send Announcement
  // ============================================================
  app.post('/parent-teacher-chat/announcements/send', requireAuth, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);
    const { class_id, subject, message, attachment_url, attachment_name } = req.body;

    if (!subject || !subject.trim() || !message || !message.trim()) {
      return res.redirect('/parent-teacher-chat/announcements');
    }

    // Get class info if specified
    let className = 'All Parents';
    let parentIds = [];
    if (class_id) {
      const classInfo = (await pool.query('SELECT name FROM classes WHERE id = $1 AND tenant_id = $2', [parseInt(class_id), tid])).rows[0];
      if (classInfo) className = classInfo.name;
      // Get parents of students in this class
      try {
        const r = await pool.query(
          `SELECT DISTINCT s.parent_id FROM students s
           JOIN class_assignments ca ON ca.student_id = s.id
           WHERE ca.class_id = $1 AND s.parent_id IS NOT NULL AND s.tenant_id = $2`,
          [parseInt(class_id), tid]
        );
        parentIds = r.rows.map(r => r.parent_id);
      } catch (e) { /* ignore */ }
    } else {
      // Get all parents
      try {
        const r = await pool.query(
          `SELECT id FROM users WHERE tenant_id = $1 AND role = 'parent' AND is_active = true`,
          [tid]
        );
        parentIds = r.rows.map(r => r.id);
      } catch (e) { /* ignore */ }
    }

    // Create announcement record
    const annResult = await pool.query(
      `INSERT INTO chat_announcements (tenant_id, sender_id, sender_type, class_id, class_name, subject, message, attachment_url, attachment_name, recipient_count, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW()) RETURNING id`,
      [tid, uid, uType, class_id ? parseInt(class_id) : 0, className, subject.trim(), message.trim(), attachment_url || null, attachment_name || null, parentIds.length]
    );
    const annId = annResult.rows[0].id;

    // Send as individual messages to each parent's conversation
    let sentCount = 0;
    for (const parentId of parentIds) {
      try {
        const convId = await findOrCreateConversation(tid, uid, 'teacher', parentId, 'parent');

        // Insert as announcement message
        await pool.query(
          `INSERT INTO chat_messages (tenant_id, conversation_id, sender_id, sender_type, message, message_type, attachment_url, attachment_name, is_read, created_at)
           VALUES ($1, $2, $3, $4, $5, 'announcement', $6, $7, false, NOW())`,
          [tid, convId, uid, 'teacher', '[Announcement] ' + subject.trim() + '\n' + message.trim(), attachment_url || null, attachment_name || null]
        );

        // Update conversation
        await pool.query(
          `UPDATE chat_conversations SET last_message = $1, last_message_at = NOW(), unread_p1 = unread_p1 + 1, updated_at = NOW()
           WHERE id = $2 AND participant1_id = $3 AND participant1_type = 'parent'`,
          ['📢 ' + subject.trim(), convId, parentId]
        );
        await pool.query(
          `UPDATE chat_conversations SET last_message = $1, last_message_at = NOW(), unread_p2 = unread_p2 + 1, updated_at = NOW()
           WHERE id = $2 AND participant2_id = $3 AND participant2_type = 'parent'`,
          ['📢 ' + subject.trim(), convId, parentId]
        );

        sentCount++;
        try { notify(tid, parentId, 'Announcement: ' + subject.trim(), truncate(message.trim(), 100), 'announcement'); } catch (e) { /* ignore */ }
      } catch (e) { /* skip individual failures */ }
    }

    audit(uid, 'ptc_announcement', `Sent announcement "${subject.trim()}" to ${sentCount} parents`);
    res.redirect('/parent-teacher-chat/announcements');
  }));

  // ============================================================
  // ROUTE 10: POST /parent-teacher-chat/announcements/:id/delete
  // ============================================================
  app.post('/parent-teacher-chat/announcements/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const annId = parseInt(req.params.id);

    await pool.query('DELETE FROM chat_announcement_reads WHERE announcement_id = $1', [annId]);
    await pool.query('DELETE FROM chat_announcements WHERE id = $1 AND tenant_id = $2 AND sender_id = $3', [annId, tid, uid]);

    audit(uid, 'ptc_announcement_delete', 'Deleted announcement #' + annId);
    res.redirect('/parent-teacher-chat/announcements');
  }));

  // ============================================================
  // ROUTE 11: GET /parent-teacher-chat/announcements/view — Parent view
  // ============================================================
  app.get('/parent-teacher-chat/announcements/view', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const tid = getTenantId(req);
    const uid = getUserId(req);

    const announcements = (await pool.query(
      `SELECT a.*, u.name AS sender_name,
        (SELECT COUNT(*) FROM chat_announcement_reads WHERE announcement_id = a.id AND user_id = $2) > 0 AS is_read_by_me
       FROM chat_announcements a
       LEFT JOIN users u ON u.id = a.sender_id
       WHERE a.tenant_id = $1
       ORDER BY a.created_at DESC LIMIT 50`,
      [tid, uid]
    )).rows;

    // Mark all as read
    for (const a of announcements) {
      try {
        await pool.query(
          `INSERT INTO chat_announcement_reads (announcement_id, user_id, read_at) VALUES ($1, $2, NOW()) ON CONFLICT DO NOTHING`,
          [a.id, uid]
        );
        await pool.query(
          'UPDATE chat_announcements SET read_count = read_count + 1 WHERE id = $1 AND read_count < recipient_count',
          [a.id]
        );
      } catch (e) { /* ignore */ }
    }

    const announcementsHtml = announcements.length === 0
      ? `<div class="ptc-empty"><div class="ptc-empty-icon">📢</div><h3>No announcements</h3><p>Your teachers haven't posted any announcements yet</p></div>`
      : announcements.map(a => `<div style="padding:16px;border-bottom:1px solid #f1f5f9;${!a.is_read_by_me ? 'background:#fffbeb;border-left:3px solid #f59e0b' : ''}">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div>
              <div style="font-size:14px;font-weight:700;color:#1e293b">${esc(a.subject)}</div>
              <div style="font-size:12px;color:#94a3b8">By ${esc(a.sender_name || 'Teacher')} · ${a.class_name ? esc(a.class_name) + ' · ' : ''}${relativeTime(a.created_at)}</div>
            </div>
            ${!a.is_read_by_me ? '<span class="ptc-badge" style="background:#fef3c7;color:#92400e">New</span>' : ''}
          </div>
          <div style="font-size:13px;color:#334155;line-height:1.6;white-space:pre-wrap">${esc(a.message)}</div>
          ${a.attachment_url ? `<div style="margin-top:8px;padding:8px 12px;background:#f8fafc;border-radius:8px;font-size:12px">📎 <a href="${esc(a.attachment_url)}" target="_blank" style="color:#4f46e5;text-decoration:underline">${esc(a.attachment_name || 'View Attachment')}</a></div>` : ''}
        </div>`).join('');

    const html = PTC_CSS + `<div class="ptc-wrap" style="max-width:800px">
      <a href="/parent-teacher-chat" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Messages</a>
      <h1 style="font-size:24px;color:#1e293b;margin:0 0 16px">Announcements</h1>
      <div class="ptc-card">
        ${announcementsHtml}
      </div>
    </div>`;
    res.send(renderPage('Announcements', html, user));
  }));

  // ============================================================
  // ROUTE 12: GET /parent-teacher-chat/unread-count — JSON unread
  // ============================================================
  app.get('/parent-teacher-chat/unread-count', requireAuth, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);

    const conversations = (await pool.query(
      `SELECT * FROM chat_conversations
       WHERE tenant_id = $1 AND status = 'active' AND is_blocked = false
       AND ((participant1_id = $2 AND participant1_type = $3) OR (participant2_id = $2 AND participant2_type = $3))`,
      [tid, uid, uType]
    )).rows;

    let totalUnread = 0;
    const unreadByConv = {};
    for (const c of conversations) {
      const isP1 = (c.participant1_id === uid && c.participant1_type === uType);
      const unread = isP1 ? (c.unread_p1 || 0) : (c.unread_p2 || 0);
      totalUnread += unread;
      if (unread > 0) unreadByConv[c.id] = unread;
    }

    // Count unread announcements for parents
    let unreadAnnouncements = 0;
    if (uType === 'parent') {
      const annResult = (await pool.query(
        `SELECT COUNT(*) AS cnt FROM chat_announcements a
         WHERE a.tenant_id = $1
         AND NOT EXISTS (SELECT 1 FROM chat_announcement_reads ar WHERE ar.announcement_id = a.id AND ar.user_id = $2)`,
        [tid, uid]
      )).rows[0];
      unreadAnnouncements = parseInt(annResult.cnt) || 0;
    }

    res.json({
      total: totalUnread,
      unreadAnnouncements,
      conversations: unreadByConv
    });
  }));

  // ============================================================
  // ROUTE 13: POST /parent-teacher-chat/:id/read — Mark as read (AJAX)
  // ============================================================
  app.post('/parent-teacher-chat/:id/read', requireAuth, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);
    const convId = parseInt(req.params.id);

    const conv = (await pool.query('SELECT * FROM chat_conversations WHERE id = $1 AND tenant_id = $2', [convId, tid])).rows[0];
    if (!conv) return res.status(404).json({ error: 'Not found' });

    const isP1 = (conv.participant1_id === uid && conv.participant1_type === uType);
    const updateCol = isP1 ? 'unread_p1' : 'unread_p2';
    await pool.query(
      `UPDATE chat_conversations SET ${updateCol} = 0, updated_at = NOW() WHERE id = $1`,
      [convId]
    );
    await pool.query(
      `UPDATE chat_messages SET is_read = true, read_at = NOW() WHERE conversation_id = $1 AND tenant_id = $2 AND sender_id != $3 AND is_read = false`,
      [convId, tid, uid]
    );

    res.json({ success: true });
  }));

  // ============================================================
  // ROUTE 14: GET /parent-teacher-chat/api/conversations — JSON list
  // ============================================================
  app.get('/parent-teacher-chat/api/conversations', requireAuth, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const uType = getUserRole(req);

    const conversations = await getUserConversations(pool, tid, uid, uType);
    const totalUnread = conversations.reduce((sum, c) => sum + c.unread, 0);

    res.json({
      total: conversations.length,
      totalUnread,
      conversations: conversations.map(c => ({
        id: c.id,
        otherId: c.otherId,
        otherName: c.otherName,
        otherType: c.otherType,
        lastMessage: c.last_message,
        lastMessageAt: c.last_message_at,
        unread: c.unread,
        isMuted: c.isMuted,
        isBlocked: !!c.is_blocked
      }))
    });
  }));

  // ============================================================
  // ROUTE 15: GET /parent-teacher-chat/api/messages/:convId — JSON messages
  // ============================================================
  app.get('/parent-teacher-chat/api/messages/:convId', requireAuth, ah(async (req, res) => {
    const tid = getTenantId(req);
    const uid = getUserId(req);
    const convId = parseInt(req.params.convId);
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);

    const conv = (await pool.query(
      `SELECT * FROM chat_conversations WHERE id = $1 AND tenant_id = $2 AND status = 'active'`,
      [convId, tid]
    )).rows[0];
    if (!conv) return res.status(404).json({ error: 'Conversation not found' });

    const isP1 = (conv.participant1_id === uid && conv.participant1_type === getUserRole(req));
    const isP2 = (conv.participant2_id === uid && conv.participant2_type === getUserRole(req));
    if (!isP1 && !isP2) return res.status(403).json({ error: 'Access denied' });

    const messages = await getConversationMessages(pool, tid, convId, offset, limit, null);

    res.json({
      conversationId: convId,
      messages: messages.map(m => ({
        id: m.id,
        senderId: m.sender_id,
        senderType: m.sender_type,
        message: m.message,
        messageType: m.message_type,
        attachmentUrl: m.attachment_url,
        attachmentName: m.attachment_name,
        isRead: m.is_read,
        createdAt: m.created_at
      }))
    });
  }));

};
