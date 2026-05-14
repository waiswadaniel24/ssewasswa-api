// ============================================================
// INTERNAL MESSAGING & CHAT MODULE — Comfort Platform
// WhatsApp/Slack-style internal messaging with file uploads,
// emoji picker, @mentions, pinned messages, search, unread
// badges, and responsive mobile-friendly UI.
// ============================================================
// Usage in server.js:
//   const messagingChat = require('./messaging-chat');
//   messagingChat(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt);
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
  if (diffSec < 60) return diffSec + ' sec ago';
  if (diffMin < 60) return diffMin + ' min ago';
  if (diffHr < 24) return diffHr + (diffHr === 1 ? ' hr ago' : ' hrs ago');
  if (diffDay === 1) return 'yesterday';
  if (diffDay < 7) return diffDay + ' days ago';
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function shortTime(dateStr) {
  if (!dateStr) return '';
  return new Date(dateStr).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true });
}

function initials(email) {
  if (!email) return '?';
  return email.replace(/@.*/, '').split(/[._\-\s]+/).slice(0, 2).map(p => (p[0] || '').toUpperCase()).join('');
}

function avatarColor(str) {
  if (!str) return '#6366f1';
  let hash = 0;
  for (let i = 0; i < str.length; i++) hash = str.charCodeAt(i) + ((hash << 5) - hash);
  const colors = ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#ef4444','#06b6d4','#f97316','#14b8a6','#a855f7'];
  return colors[Math.abs(hash) % colors.length];
}

function parseMentions(text, escFn) {
  if (!text) return '';
  let safe = escFn(text);
  safe = safe.replace(/@([\w.\-]+@[\w.\-]+\.\w+)/g,
    '<span style="background:#dbeafe;color:#1e40af;padding:1px 6px;border-radius:4px;font-weight:600;font-size:12px">@$1</span>');
  safe = safe.replace(/@(\w[\w.\-]*)\b(?![.@])/g,
    '<span style="background:#fef3c7;color:#92400e;padding:1px 6px;border-radius:4px;font-weight:600;font-size:12px">@$1</span>');
  return safe;
}

function linkify(text) {
  if (!text) return '';
  return text.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener" style="color:#3b82f6;text-decoration:underline">$1</a>');
}

const EMOJI_GRID = [
  '😀','😂','🤣','😊','😍','🥰','😘','😎','🤩','🥳',
  '😏','🤔','🤫','🤐','😴','😷','🤒','🤕','🥺','😢',
  '😭','😤','😡','🤬','😱','😨','🥶','🥵','😳','🤯',
  '👍','👎','👏','🙌','🤝','✌️','🤞','💪','🫡','🙏',
  '❤️','🧡','💛','💚','💙','💜','🖤','🤍','💔','💯',
  '🔥','⭐','✨','🎉','🎊','✅','❌','⚡','💡','🚀'
];

function emojiPickerHTML() {
  return `<div id="emoji-picker" style="display:none;position:absolute;bottom:60px;left:10px;background:white;border:1px solid #e2e8f0;border-radius:12px;padding:12px;box-shadow:0 8px 30px rgba(0,0,0,0.15);z-index:100;width:300px;max-height:220px;overflow-y:auto">
    <div style="display:grid;grid-template-columns:repeat(10,1fr);gap:2px">
      ${EMOJI_GRID.map(e => `<button type="button" onclick="insertEmoji('${e}')" style="background:none;border:none;font-size:20px;cursor:pointer;padding:4px;border-radius:6px" onmouseover="this.style.background='#f1f5f9'" onmouseout="this.style.background='none'">${e}</button>`).join('')}
    </div></div>`;
}

// Compact shared CSS
const CHAT_CSS = `<style>
*{box-sizing:border-box}
.chat-container{display:grid;grid-template-columns:320px 1fr;gap:0;height:calc(100vh - 120px);max-width:1200px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08);border:1px solid #e2e8f0}
.chat-sidebar{background:#f8fafc;border-right:1px solid #e2e8f0;display:flex;flex-direction:column;overflow:hidden}
.chat-sidebar-header{padding:16px;border-bottom:1px solid #e2e8f0;background:linear-gradient(135deg,#6366f1,#4f46e5);color:#fff}
.chat-sidebar-header input{width:100%;padding:8px 12px;border:none;border-radius:8px;font-size:13px;margin-top:8px;background:rgba(255,255,255,.2);color:#fff}
.chat-sidebar-header input::placeholder{color:rgba(255,255,255,.7)}
.chat-sidebar-header input:focus{outline:none;background:rgba(255,255,255,.3)}
.conv-list{flex:1;overflow-y:auto}
.conv-item{display:flex;align-items:center;gap:12px;padding:12px 16px;cursor:pointer;border-bottom:1px solid #f1f5f9;transition:.15s;text-decoration:none;color:inherit}
.conv-item:hover{background:#f1f5f9}
.conv-item.active{background:#eef2ff;border-left:3px solid #4f46e5}
.conv-avatar{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:16px;font-weight:700;flex-shrink:0}
.conv-info{flex:1;min-width:0}
.conv-title{font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#1e293b}
.conv-preview{font-size:12px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:2px}
.conv-meta{text-align:right;flex-shrink:0}
.conv-time{font-size:11px;color:#94a3b8}
.unread-badge{display:inline-block;background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:2px 7px;border-radius:10px;margin-top:4px;min-width:20px;text-align:center}
.chat-main{display:flex;flex-direction:column;overflow:hidden}
.chat-header{padding:14px 20px;border-bottom:1px solid #e2e8f0;display:flex;align-items:center;justify-content:space-between;background:#fff}
.chat-header-title{font-size:16px;font-weight:700;color:#1e293b}
.chat-header-sub{font-size:12px;color:#94a3b8;margin-top:2px}
.messages-area{flex:1;overflow-y:auto;padding:20px;background:#f1f5f9;display:flex;flex-direction:column;gap:4px}
.msg-row{display:flex;max-width:75%;margin-bottom:4px}
.msg-row.sent{align-self:flex-end}
.msg-row.received{align-self:flex-start}
.msg-bubble{padding:10px 14px;border-radius:18px;font-size:14px;line-height:1.5;position:relative;word-wrap:break-word}
.msg-row.sent .msg-bubble{background:linear-gradient(135deg,#4f46e5,#6366f1);color:#fff;border-bottom-right-radius:4px}
.msg-row.received .msg-bubble{background:#fff;color:#1e293b;border-bottom-left-radius:4px;box-shadow:0 1px 3px rgba(0,0,0,.06)}
.msg-system{text-align:center;padding:8px;margin:8px auto}
.msg-system span{background:#e2e8f0;color:#64748b;padding:4px 14px;border-radius:12px;font-size:12px}
.msg-time{font-size:10px;color:rgba(255,255,255,.7);margin-top:4px;text-align:right}
.msg-row.received .msg-time{color:#94a3b8}
.msg-pinned{border:2px solid #f59e0b}
.msg-pin-badge{font-size:10px;color:#f59e0b;margin-bottom:2px}
.msg-attachment{margin-top:6px;padding:8px;background:rgba(0,0,0,.05);border-radius:8px;font-size:12px}
.msg-row.sent .msg-attachment{background:rgba(255,255,255,.15)}
.chat-input-area{padding:12px 16px;border-top:1px solid #e2e8f0;background:#fff;display:flex;align-items:flex-end;gap:8px}
.chat-input-area textarea{flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:20px;font-size:14px;font-family:inherit;resize:none;min-height:42px;max-height:120px;line-height:1.4;transition:.2s}
.chat-input-area textarea:focus{outline:none;border-color:#6366f1;box-shadow:0 0 0 3px rgba(99,102,241,.1)}
.chat-btn{width:42px;height:42px;border:none;border-radius:50%;cursor:pointer;display:flex;align-items:center;justify-content:center;font-size:18px;transition:.2s;background:#f1f5f9;color:#64748b;flex-shrink:0}
.chat-btn:hover{background:#e2e8f0}
.chat-btn-send{background:#4f46e5;color:#fff}
.chat-btn-send:hover{background:#4338ca}
.typing-indicator{padding:4px 20px;font-size:12px;color:#94a3b8;display:none}
.typing-indicator span{animation:blink 1.4s infinite}
.typing-indicator span:nth-child(2){animation-delay:.2s}
.typing-indicator span:nth-child(3){animation-delay:.4s}
@keyframes blink{0%,60%,100%{opacity:.2}30%{opacity:1}}
.participants-sidebar{width:240px;background:#f8fafc;border-left:1px solid #e2e8f0;padding:16px;overflow-y:auto}
.participant-item{display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f1f5f9}
.participant-avatar{width:32px;height:32px;border-radius:50%;display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700}
.date-divider{text-align:center;padding:12px 0}
.date-divider span{background:#e2e8f0;color:#64748b;padding:4px 16px;border-radius:12px;font-size:11px;font-weight:600}
.chat-actions-btn{background:none;border:1px solid #e2e8f0;border-radius:8px;padding:6px 12px;cursor:pointer;font-size:12px;color:#64748b;transition:.2s}
.chat-actions-btn:hover{background:#f1f5f9;color:#1e293b}
.search-result{padding:12px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;transition:.15s}
.search-result:hover{background:#f1f5f9}
@media(max-width:768px){.chat-container{grid-template-columns:1fr;height:calc(100vh - 80px)}.chat-sidebar{position:absolute;left:0;top:0;width:100%;z-index:10}.chat-sidebar.hidden-mobile,.chat-main.hidden-mobile{display:none}.participants-sidebar{display:none}.msg-row{max-width:90%}}
</style>`;

const CHAT_JS = `<script>
function insertEmoji(e){var t=document.getElementById('msg-input');if(!t)return;var s=t.selectionStart,n=t.selectionEnd,v=t.value;t.value=v.substring(0,s)+e+v.substring(n);t.selectionStart=t.selectionEnd=s+e.length;t.focus();document.getElementById('emoji-picker').style.display='none'}
function toggleEmojiPicker(){var p=document.getElementById('emoji-picker');p.style.display=p.style.display==='none'?'block':'none'}
function autoResizeTextarea(el){el.style.height='auto';el.style.height=Math.min(el.scrollHeight,120)+'px'}
function scrollToBottom(sm){var a=document.getElementById('messages-area');if(a)a.scrollTo({top:a.scrollHeight,behavior:sm?'smooth':'auto'})}
function simulateTyping(){var i=document.getElementById('typing-indicator'),t=document.getElementById('msg-input');if(!i||!t)return;t.addEventListener('input',function(){i.style.display=t.value.trim().length>0?'block':'none'});t.addEventListener('blur',function(){i.style.display='none'})}
window.addEventListener('load',function(){scrollToBottom(false);simulateTyping()});
document.addEventListener('click',function(e){var p=document.getElementById('emoji-picker');if(!p)return;if(!e.target.closest('#emoji-picker')&&!e.target.closest('#emoji-btn'))p.style.display='none'});
function toggleSidebar(){var s=document.getElementById('chat-sidebar'),m=document.getElementById('chat-main');if(s&&m){s.classList.toggle('hidden-mobile');m.classList.toggle('hidden-mobile')}}
function handleMsgKeydown(e){if(e.key==='Enter'&&!e.shiftKey){e.preventDefault();document.getElementById('msg-form').submit()}}
</script>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function messagingChat(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  if (!ah) ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // 1. DATABASE MIGRATIONS
  // ============================================================
  const chatMigrations = [
    `CREATE TABLE IF NOT EXISTS chat_conversations (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title VARCHAR(255), type VARCHAR(20) NOT NULL DEFAULT 'direct', created_by VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW(), is_active BOOLEAN DEFAULT true,
      last_message_at TIMESTAMPTZ, last_message_preview TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS chat_participants (
      id SERIAL PRIMARY KEY, conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      user_email VARCHAR(255) NOT NULL, joined_at TIMESTAMPTZ DEFAULT NOW(),
      is_muted BOOLEAN DEFAULT false, last_read_at TIMESTAMPTZ, UNIQUE(conversation_id, user_email)
    )`,
    `CREATE TABLE IF NOT EXISTS chat_messages (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      conversation_id INTEGER NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
      sender_email VARCHAR(255) NOT NULL, message_text TEXT, message_type VARCHAR(20) NOT NULL DEFAULT 'text',
      file_url TEXT, file_name TEXT, is_read BOOLEAN DEFAULT false, is_pinned BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS chat_attachments (
      id SERIAL PRIMARY KEY, message_id INTEGER NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
      file_url TEXT NOT NULL, file_name VARCHAR(500) NOT NULL, file_size INTEGER,
      file_type VARCHAR(100), uploaded_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_chat_conv_tenant ON chat_conversations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_conv_created ON chat_conversations(last_message_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_parts_conv ON chat_participants(conversation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_parts_user ON chat_participants(user_email)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_msg_conv ON chat_messages(conversation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_msg_tenant ON chat_messages(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_msg_created ON chat_messages(created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_chat_attach_msg ON chat_attachments(message_id)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { logger.warn('[ChatModule] Cannot connect to DB for migrations'); return; }
    try {
      for (const sql of chatMigrations) await client.query(sql);
      logger.info({ msg: '[ChatModule] Migrations applied', count: chatMigrations.length });
    } catch (e) {
      logger.error({ msg: '[ChatModule] Migration error', error: e.message });
    } finally { client.release(); }
  })();

  // ============================================================
  // 2. INTERNAL HELPERS
  // ============================================================
  async function addSystemMessage(tenantId, convId, text) {
    await pool.query(
      `INSERT INTO chat_messages (tenant_id, conversation_id, sender_email, message_text, message_type) VALUES ($1,$2,'system',$3,'system')`,
      [tenantId, convId, text]);
    await pool.query(
      `UPDATE chat_conversations SET last_message_at=NOW(), last_message_preview=$1 WHERE id=$2`, [text, convId]);
  }

  async function getUnreadCounts(tenantId, userEmail) {
    const result = await pool.query(
      `SELECT cp.conversation_id, COUNT(*) AS unread FROM chat_participants cp
       JOIN chat_messages cm ON cm.conversation_id = cp.conversation_id
       WHERE cp.user_email=$1 AND cm.tenant_id=$2 AND cm.is_read=false AND cm.sender_email!=$1 AND cm.message_type!='system'
       GROUP BY cp.conversation_id`, [userEmail, tenantId]);
    const map = {};
    result.rows.forEach(r => { map[r.conversation_id] = parseInt(r.unread); });
    return map;
  }

  async function getConvDisplayName(convId, userEmail, tenantId) {
    const conv = (await pool.query('SELECT * FROM chat_conversations WHERE id=$1 AND tenant_id=$2', [convId, tenantId])).rows[0];
    if (!conv) return 'Unknown';
    if (conv.type === 'group') return conv.title || 'Group Chat';
    const parts = (await pool.query(
      'SELECT user_email FROM chat_participants WHERE conversation_id=$1 AND user_email!=$2', [convId, userEmail]
    )).rows;
    if (parts.length === 0) return conv.title || userEmail;
    if (parts.length === 1) {
      try {
        const u = (await pool.query('SELECT name,email FROM users WHERE email=$1 AND tenant_id=$2 LIMIT 1', [parts[0].user_email, tenantId])).rows[0];
        return u ? (u.name || u.email) : parts[0].user_email;
      } catch (_) { return parts[0].user_email; }
    }
    return parts.map(p => p.user_email.split('@')[0]).join(', ');
  }

  async function getParticipants(convId) {
    const parts = (await pool.query(
      'SELECT user_email, is_muted, joined_at FROM chat_participants WHERE conversation_id=$1', [convId]
    )).rows;
    const result = [];
    for (const p of parts) {
      let name = p.user_email;
      try {
        const u = (await pool.query('SELECT name FROM users WHERE email=$1 LIMIT 1', [p.user_email])).rows[0];
        if (u && u.name) name = u.name;
      } catch (_) { /* ignore */ }
      result.push({ ...p, name });
    }
    return result;
  }

  // ============================================================
  // ROUTE 10: GET /chat/unread-count — JSON unread badge data
  // ============================================================
  app.get('/chat/unread-count', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const counts = await getUnreadCounts(user.tenant_id, user.email);
    const total = Object.values(counts).reduce((s, c) => s + c, 0);
    res.json({ total, conversations: counts });
  }));

  // ============================================================
  // ROUTE 1: GET /chat — Conversation list (inbox)
  // ============================================================
  app.get('/chat', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const conversations = (await pool.query(
      `SELECT c.*, cp.is_muted FROM chat_conversations c JOIN chat_participants cp ON cp.conversation_id=c.id
       WHERE c.tenant_id=$1 AND cp.user_email=$2 AND c.is_active=true ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC`,
      [tid, user.email]
    )).rows;
    const unreadCounts = await getUnreadCounts(tid, user.email);
    const convItems = [];
    for (const c of conversations) {
      convItems.push({ ...c, displayName: await getConvDisplayName(c.id, user.email, tid), unread: unreadCounts[c.id] || 0 });
    }
    const totalUnread = Object.values(unreadCounts).reduce((s, c) => s + c, 0);

    const html = `${CHAT_CSS}${CHAT_JS}
    <div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">💬 Messages</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Internal team communication</p></div>
        <div style="display:flex;gap:8px;align-items:center">
          ${totalUnread > 0 ? `<span style="background:#ef4444;color:#fff;padding:4px 12px;border-radius:20px;font-size:13px;font-weight:600">${totalUnread} unread</span>` : ''}
          <a href="/chat/new" class="btn" style="background:#4f46e5;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px;display:inline-flex;align-items:center;gap:6px">✏️ New Chat</a>
          <a href="/chat/search" class="chat-actions-btn" style="text-decoration:none;display:inline-flex;align-items:center;gap:4px">🔍 Search</a>
        </div>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <div class="conv-list" style="max-height:calc(100vh - 200px)">
          ${convItems.length === 0 ? `<div style="text-align:center;padding:60px 20px">
            <div style="font-size:48px;margin-bottom:12px">💬</div><h3 style="color:#64748b">No conversations yet</h3>
            <p style="color:#94a3b8;font-size:13px;margin-top:4px">Start a new chat to begin messaging</p>
            <a href="/chat/new" style="color:#4f46e5;font-size:14px;font-weight:600;margin-top:12px;display:inline-block">✏️ Start New Chat</a>
          </div>` : convItems.map(c => `
            <a href="/chat/${esc(c.id)}" class="conv-item" style="${c.is_muted ? 'opacity:0.6' : ''}">
              <div class="conv-avatar" style="background:${avatarColor(c.displayName)}">${esc(initials(c.displayName))}</div>
              <div class="conv-info">
                <div class="conv-title">${esc(c.displayName)} ${c.type === 'group' ? '<span style="font-size:11px;color:#94a3b8;font-weight:400">👥</span>' : ''}</div>
                <div class="conv-preview">${c.last_message_preview ? esc(c.last_message_preview.substring(0, 50)) : '<span style="color:#cbd5e1">No messages yet</span>'}</div>
              </div>
              <div class="conv-meta">
                <div class="conv-time">${c.last_message_at ? relativeTime(c.last_message_at) : ''}</div>
                ${c.unread > 0 ? `<div class="unread-badge">${c.unread > 99 ? '99+' : c.unread}</div>` : ''}
              </div>
            </a>`).join('')}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Messages', html, user));
  }));

  // ============================================================
  // ROUTE 2: GET /chat/new — New conversation form
  // ============================================================
  app.get('/chat/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const users = (await pool.query(
      `SELECT email, name, role FROM users WHERE tenant_id=$1 AND email!=$2 AND is_active=true ORDER BY name ASC LIMIT 500`,
      [tid, user.email]
    )).rows;
    const preSelected = req.query.to || '';

    const html = `<div style="max-width:600px;margin:0 auto">
      <a href="/chat" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Messages</a>
      <div class="card">
        <h2 style="margin-bottom:20px;color:#1e293b">✏️ New Conversation</h2>
        <form method="POST" action="/chat/new" style="display:flex;flex-direction:column;gap:16px">
          <div>
            <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Conversation Type</label>
            <div style="display:flex;gap:12px">
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 20px;border:2px solid #e2e8f0;border-radius:10px">
                <input type="radio" name="type" value="direct" checked onchange="document.getElementById('gf').style.display='none'" style="accent-color:#4f46e5">
                <span style="font-size:14px;font-weight:500">👤 Direct Message</span>
              </label>
              <label style="display:flex;align-items:center;gap:6px;cursor:pointer;padding:10px 20px;border:2px solid #e2e8f0;border-radius:10px">
                <input type="radio" name="type" value="group" onchange="document.getElementById('gf').style.display='block'" style="accent-color:#4f46e5">
                <span style="font-size:14px;font-weight:500">👥 Group Chat</span>
              </label>
            </div>
          </div>
          <div id="gf" style="display:none">
            <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Group Title</label>
            <input type="text" name="title" placeholder="e.g., Marketing Team..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
          </div>
          <div>
            <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Select Participants <span style="color:#94a3b8;font-weight:400">(required)</span></label>
            <input type="text" id="user-search" placeholder="Search users by name or email..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;margin-bottom:8px">
            <div id="selected-users" style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:10px"></div>
            <div id="user-list" style="max-height:260px;overflow-y:auto;border:1px solid #e2e8f0;border-radius:10px">
              ${users.map(u => `<label style="display:flex;align-items:center;gap:10px;padding:10px 14px;cursor:pointer;border-bottom:1px solid #f1f5f9" class="user-option" data-email="${esc(u.email)}" data-name="${esc(u.name || u.email)}">
                <input type="checkbox" name="participants" value="${esc(u.email)}" ${u.email === preSelected ? 'checked' : ''} style="accent-color:#4f46e5;width:16px;height:16px" onchange="updateSelectedUsers()">
                <div style="width:32px;height:32px;border-radius:50%;background:${avatarColor(u.name || u.email)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:12px;font-weight:700;flex-shrink:0">${esc(initials(u.name || u.email))}</div>
                <div><div style="font-size:13px;font-weight:600;color:#1e293b">${esc(u.name || u.email)}</div><div style="font-size:11px;color:#94a3b8">${esc(u.email)} · ${esc(u.role || 'member')}</div></div>
              </label>`).join('')}
              ${users.length === 0 ? '<div style="padding:24px;text-align:center;color:#94a3b8;font-size:13px">No other users found in your organization</div>' : ''}
            </div>
          </div>
          <button type="submit" class="btn" style="background:#4f46e5;color:#fff;padding:12px;border:none;border-radius:10px;font-weight:600;font-size:15px;cursor:pointer">🚀 Start Conversation</button>
        </form>
      </div>
    </div>
    <script>
    function updateSelectedUsers(){var c=document.querySelectorAll('input[name="participants"]:checked'),s=document.getElementById('selected-users');s.innerHTML='';c.forEach(function(cb){var l=cb.closest('.user-option'),n=l?l.dataset.name:cb.value,t=document.createElement('span');t.style.cssText='background:#eef2ff;color:#4f46e5;padding:4px 10px;border-radius:8px;font-size:12px;font-weight:600';t.textContent=n;s.appendChild(t)})}
    document.getElementById('user-search').addEventListener('input',function(){var q=this.value.toLowerCase();document.querySelectorAll('.user-option').forEach(function(o){o.style.display=(o.dataset.name+' '+o.dataset.email).toLowerCase().includes(q)?'flex':'none'})});
    updateSelectedUsers();
    </script>`;
    res.send(renderPage('New Conversation', html, user));
  }));

  // ============================================================
  // ROUTE 3: POST /chat/new — Create conversation
  // ============================================================
  app.post('/chat/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { type, title, participants } = req.body;
    const pList = Array.isArray(participants) ? participants : (participants ? [participants] : []);
    if (pList.length === 0) {
      return res.send(renderPage('Error', '<div class="card"><p style="color:#ef4444">Please select at least one participant.</p><a href="/chat/new" class="btn" style="margin-top:12px">← Try Again</a></div>', user));
    }
    const convType = (type === 'group') ? 'group' : 'direct';

    // Deduplicate direct messages
    if (convType === 'direct' && pList.length === 1) {
      const existing = (await pool.query(
        `SELECT c.id FROM chat_conversations c JOIN chat_participants p1 ON p1.conversation_id=c.id AND p1.user_email=$1
         JOIN chat_participants p2 ON p2.conversation_id=c.id AND p2.user_email=$2
         WHERE c.tenant_id=$3 AND c.type='direct' AND c.is_active=true LIMIT 1`,
        [user.email, pList[0], tid]
      )).rows[0];
      if (existing) return res.redirect('/chat/' + existing.id);
    }

    const convResult = await pool.query(
      `INSERT INTO chat_conversations (tenant_id, title, type, created_by, created_at, is_active) VALUES ($1,$2,$3,$4,NOW(),true) RETURNING id`,
      [tid, convType === 'group' ? (title || 'Group Chat') : null, convType, user.email]
    );
    const convId = convResult.rows[0].id;

    await pool.query('INSERT INTO chat_participants (conversation_id, user_email, joined_at) VALUES ($1,$2,NOW())', [convId, user.email]);
    for (const email of pList) {
      await pool.query('INSERT INTO chat_participants (conversation_id, user_email, joined_at) VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING', [convId, email.trim()]);
    }

    const pNames = pList.map(e => e.split('@')[0]).join(', ');
    await addSystemMessage(tid, convId, convType === 'group'
      ? `${user.email.split('@')[0]} created the group "${title || 'Group Chat'}" with ${pNames}`
      : `${user.email.split('@')[0]} started a conversation`);

    if (notify) {
      for (const email of pList) {
        try { notify(tid, email, 'New Conversation', `${user.email.split('@')[0]} started a ${convType} conversation.`, 'chat'); } catch (_) {}
      }
    }
    audit(user.email, 'chat_create', `Created ${convType} conversation #${convId}`);
    logger.info({ msg: '[Chat] Conversation created', convId, type: convType, by: user.email, tenant: tid });
    res.redirect('/chat/' + convId);
  }));

  // ============================================================
  // ROUTE 4: GET /chat/:id — Chat view with messages
  // ============================================================
  app.get('/chat/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, convId = parseInt(req.params.id);
    const conv = (await pool.query('SELECT * FROM chat_conversations WHERE id=$1 AND tenant_id=$2 AND is_active=true', [convId, tid])).rows[0];
    if (!conv) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#ef4444">Conversation not found</h2><a href="/chat" class="btn" style="margin-top:12px">← Messages</a></div>', user));

    const isPart = (await pool.query('SELECT id FROM chat_participants WHERE conversation_id=$1 AND user_email=$2', [convId, user.email])).rows.length > 0;
    if (!isPart) return res.send(renderPage('Access Denied', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#ef4444">Access denied</h2><a href="/chat" class="btn" style="margin-top:12px">← Messages</a></div>', user));

    // Auto-mark as read
    await pool.query(`UPDATE chat_messages SET is_read=true WHERE conversation_id=$1 AND tenant_id=$2 AND sender_email!=$3 AND is_read=false`, [convId, tid, user.email]);
    await pool.query('UPDATE chat_participants SET last_read_at=NOW() WHERE conversation_id=$1 AND user_email=$2', [convId, user.email]);

    const messages = (await pool.query(
      `SELECT cm.*, u.name as sender_name FROM chat_messages cm LEFT JOIN users u ON u.email=cm.sender_email
       WHERE cm.conversation_id=$1 AND cm.tenant_id=$2 ORDER BY cm.created_at ASC LIMIT 50`, [convId, tid]
    )).rows;
    const totalMsgs = (await pool.query('SELECT COUNT(*) FROM chat_messages WHERE conversation_id=$1 AND tenant_id=$2', [convId, tid])).rows[0].count;
    const hasMore = parseInt(totalMsgs) > 50;
    const displayName = await getConvDisplayName(convId, user.email, tid);
    const participants = conv.type === 'group' ? await getParticipants(convId) : [];
    const pinned = (await pool.query(
      `SELECT cm.*, u.name as sender_name FROM chat_messages cm LEFT JOIN users u ON u.email=cm.sender_email
       WHERE cm.conversation_id=$1 AND cm.tenant_id=$2 AND cm.is_pinned=true ORDER BY cm.created_at DESC`, [convId, tid]
    )).rows;

    // Build message HTML
    let lastDate = '';
    const renderMsg = (m) => {
      const isSent = m.sender_email === user.email, isSys = m.message_type === 'system';
      const senderLbl = m.sender_name || m.sender_email.split('@')[0];
      let dateHd = '';
      const mDate = m.created_at ? new Date(m.created_at).toLocaleDateString() : '';
      if (mDate && mDate !== lastDate) {
        lastDate = mDate;
        const today = new Date().toLocaleDateString(), yest = new Date(Date.now() - 86400000).toLocaleDateString();
        let dl = mDate === today ? 'Today' : mDate === yest ? 'Yesterday' : mDate;
        dateHd = `<div class="date-divider"><span>${esc(dl)}</span></div>`;
      }
      if (isSys) return dateHd + `<div class="msg-system"><span>${esc(m.message_text)}</span></div>`;
      const text = linkify(parseMentions(m.message_text, esc));
      const attach = (m.file_url || m.file_name) ? `<div class="msg-attachment">📎 <a href="${esc(m.file_url||'#')}" target="_blank" style="color:inherit;text-decoration:underline;font-weight:600">${esc(m.file_name||'File')}</a></div>` : '';
      return `${dateHd}<div class="msg-row ${isSent?'sent':'received'}"><div class="msg-bubble ${m.is_pinned?'msg-pinned':''}">
        ${!isSent && conv.type==='group' ? `<div style="font-size:11px;font-weight:700;color:#6366f1;margin-bottom:3px">${esc(senderLbl)}</div>` : ''}
        ${m.is_pinned ? '<div class="msg-pin-badge">📌 Pinned</div>' : ''}
        <div>${text}</div>${attach}<div class="msg-time">${shortTime(m.created_at)}</div>
      </div></div>`;
    };

    const pinnedHtml = pinned.length > 0 ? `<div style="background:#fffbeb;border:1px solid #fde68a;border-radius:10px;padding:10px 14px;margin-bottom:8px">
      <div style="font-size:12px;font-weight:700;color:#92400e;margin-bottom:4px">📌 Pinned (${pinned.length})</div>
      ${pinned.slice(0, 3).map(p => `<div style="font-size:12px;color:#78350f;padding:4px 0;border-bottom:1px solid #fde68a"><strong>${esc(p.sender_name||p.sender_email.split('@')[0])}:</strong> ${esc((p.message_text||'').substring(0, 80))}</div>`).join('')}
    </div>` : '';

    const html = `${CHAT_CSS}${CHAT_JS}
    <div style="max-width:1200px;margin:0 auto">
      <a href="/chat" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:8px">← Messages</a>
      <div class="chat-container">
        <div class="chat-sidebar hidden-mobile" id="chat-sidebar">
          <div class="chat-sidebar-header">
            <div style="display:flex;align-items:center;justify-content:space-between">
              <span style="font-weight:700;font-size:16px">💬 Chats</span>
              <a href="/chat/new" style="color:#fff;font-size:20px;text-decoration:none">✏️</a>
            </div>
            <input type="text" placeholder="Search..." onclick="window.location='/chat/search'">
          </div>
          <div class="conv-list"><a href="/chat" style="display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e2e8f0;text-decoration:none;color:#fff;background:rgba(255,255,255,.1)">← All Conversations</a></div>
        </div>
        <div class="chat-main" id="chat-main">
          <div class="chat-header">
            <div style="display:flex;align-items:center;gap:12px">
              <button class="chat-btn" onclick="toggleSidebar()" style="display:none" id="back-btn">←</button>
              <div class="conv-avatar" style="background:${avatarColor(displayName)};width:40px;height:40px;font-size:15px">${esc(initials(displayName))}</div>
              <div><div class="chat-header-title">${esc(displayName)}</div><div class="chat-header-sub">${conv.type === 'group' ? participants.length + ' participants' : 'Direct message'}</div></div>
            </div>
            <div style="display:flex;gap:6px">
              ${conv.type==='group' ? `<button class="chat-actions-btn" onclick="document.getElementById('pp').style.display=document.getElementById('pp').style.display==='none'?'block':'none'">👥</button>` : ''}
              <a href="/chat/search?conv=${convId}" class="chat-actions-btn" style="text-decoration:none">🔍</a>
            </div>
          </div>
          ${pinnedHtml}
          <div class="messages-area" id="messages-area">
            ${messages.map(renderMsg).join('')}
            ${hasMore ? '<div style="text-align:center;padding:10px"><a href="/chat/'+convId+'/history" style="color:#4f46e5;font-size:13px;text-decoration:none;font-weight:600">Load earlier messages</a></div>' : ''}
          </div>
          <div class="typing-indicator" id="typing-indicator"><span>●</span><span>●</span><span>●</span> <span style="margin-left:4px">typing...</span></div>
          ${emojiPickerHTML()}
          <form method="POST" action="/chat/${convId}/send" id="msg-form" enctype="multipart/form-data" class="chat-input-area">
            <button type="button" class="chat-btn" id="emoji-btn" onclick="toggleEmojiPicker()" title="Emoji">😊</button>
            <label class="chat-btn" title="Attach file" style="cursor:pointer">📎<input type="file" name="file" style="display:none" accept="*/*"></label>
            <textarea id="msg-input" name="message" placeholder="Type a message..." rows="1" oninput="autoResizeTextarea(this)" onkeydown="handleMsgKeydown(event)" required></textarea>
            <button type="submit" class="chat-btn chat-btn-send" title="Send">➤</button>
          </form>
        </div>
        ${conv.type==='group' ? `<div class="participants-sidebar" id="pp" style="display:none">
          <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px">👥 Participants (${participants.length})</h3>
          ${participants.map(p => `<div class="participant-item">
            <div class="participant-avatar" style="background:${avatarColor(p.name||p.user_email)}">${esc(initials(p.name||p.user_email))}</div>
            <div><div style="font-size:13px;font-weight:600;color:#1e293b">${esc(p.name||p.user_email)}</div><div style="font-size:11px;color:#94a3b8">${esc(p.user_email)}</div></div>
          </div>`).join('')}
        </div>` : ''}
      </div>
    </div>
    <script>if(window.innerWidth<=768)document.getElementById('back-btn').style.display='flex';
    window.addEventListener('resize',function(){document.getElementById('back-btn').style.display=window.innerWidth<=768?'flex':'none'});</script>`;
    res.send(renderPage('Chat - ' + displayName, html, user));
  }));

  // ============================================================
  // ROUTE 5: POST /chat/:id/send — Send message
  // ============================================================
  app.post('/chat/:id/send', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, convId = parseInt(req.params.id);
    const { message } = req.body;
    const isPart = (await pool.query('SELECT id FROM chat_participants WHERE conversation_id=$1 AND user_email=$2', [convId, user.email])).rows.length > 0;
    if (!isPart) return res.status(403).send('Access denied');
    if (!message || !message.trim()) return res.redirect('/chat/' + convId);

    let fileUrl = null, fileName = null;
    if (req.file) { fileUrl = '/uploads/chat/' + req.file.filename; fileName = req.file.originalname; }
    else if (req.body.file_url) { fileUrl = req.body.file_url; fileName = req.body.file_name || 'File'; }

    const msgType = fileUrl ? 'file' : 'text';
    const msgRes = await pool.query(
      `INSERT INTO chat_messages (tenant_id, conversation_id, sender_email, message_text, message_type, file_url, file_name, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,NOW()) RETURNING id`,
      [tid, convId, user.email, message.trim(), msgType, fileUrl, fileName]
    );
    const msgId = msgRes.rows[0].id;

    if (fileUrl) {
      await pool.query(
        `INSERT INTO chat_attachments (message_id, file_url, file_name, file_size, file_type, uploaded_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
        [msgId, fileUrl, fileName, req.file ? req.file.size : null, req.file ? req.file.mimetype : null, user.email]
      );
    }

    const preview = (message.trim().substring(0, 100)) || (fileName ? '📎 ' + fileName : '');
    await pool.query('UPDATE chat_conversations SET last_message_at=NOW(), last_message_preview=$1 WHERE id=$2', [preview, convId]);

    // Detect @mentions and notify
    const mentionRegex = /@([\w.\-]+@[\w.\-]+\.\w+)/g;
    let match; const mentioned = [];
    while ((match = mentionRegex.exec(message)) !== null) {
      const email = match[1].toLowerCase();
      if (email !== user.email) mentioned.push(email);
    }

    const parts = (await pool.query('SELECT user_email FROM chat_participants WHERE conversation_id=$1 AND user_email!=$2', [convId, user.email])).rows.map(r => r.user_email);
    if (notify) {
      const convName = await getConvDisplayName(convId, user.email, tid);
      for (const email of [...new Set([...parts, ...mentioned])]) {
        const isM = mentioned.includes(email);
        try { notify(tid, email, isM ? `@mention in ${convName}` : `Message in ${convName}`, `${user.email.split('@')[0]}: ${message.trim().substring(0, 100)}`, isM ? 'mention' : 'chat'); } catch (_) {}
      }
    }
    audit(user.email, 'chat_message', `Sent message in conversation #${convId}`);
    res.redirect('/chat/' + convId);
  }));

  // ============================================================
  // ROUTE 6: GET /chat/:id/history — Load more history
  // ============================================================
  app.get('/chat/:id/history', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, convId = parseInt(req.params.id);
    const beforeMsgId = parseInt(req.query.before) || 0;
    const isPart = (await pool.query('SELECT id FROM chat_participants WHERE conversation_id=$1 AND user_email=$2', [convId, user.email])).rows.length > 0;
    if (!isPart) return res.status(403).send('Access denied');

    let messages;
    if (beforeMsgId > 0) {
      messages = (await pool.query(
        `SELECT cm.*, u.name as sender_name FROM chat_messages cm LEFT JOIN users u ON u.email=cm.sender_email
         WHERE cm.conversation_id=$1 AND cm.tenant_id=$2 AND cm.id<$3 ORDER BY cm.created_at DESC LIMIT 50`,
        [convId, tid, beforeMsgId]
      )).rows.reverse();
    } else {
      messages = (await pool.query(
        `SELECT cm.*, u.name as sender_name FROM chat_messages cm LEFT JOIN users u ON u.email=cm.sender_email
         WHERE cm.conversation_id=$1 AND cm.tenant_id=$2 ORDER BY cm.created_at DESC LIMIT 50`, [convId, tid]
      )).rows.reverse();
    }

    const total = (await pool.query('SELECT COUNT(*) FROM chat_messages WHERE conversation_id=$1 AND tenant_id=$2', [convId, tid])).rows[0].count;
    const oldestId = messages.length > 0 ? messages[0].id : 0;

    let lastDate = '';
    const msgHtml = messages.map(m => {
      const isSent = m.sender_email === user.email, isSys = m.message_type === 'system';
      let dh = '';
      const mD = m.created_at ? new Date(m.created_at).toLocaleDateString() : '';
      if (mD && mD !== lastDate) { lastDate = mD; dh = `<div class="date-divider"><span>${esc(mD)}</span></div>`; }
      if (isSys) return dh + `<div class="msg-system"><span>${esc(m.message_text)}</span></div>`;
      return `${dh}<div class="msg-row ${isSent?'sent':'received'}"><div class="msg-bubble">
        <div>${linkify(parseMentions(m.message_text, esc))}</div>
        ${(m.file_url||m.file_name) ? `<div class="msg-attachment">📎 <a href="${esc(m.file_url||'#')}" target="_blank">${esc(m.file_name||'File')}</a></div>` : ''}
        <div class="msg-time">${shortTime(m.created_at)}</div></div></div>`;
    }).join('');

    const html = `${CHAT_CSS}
    <div style="max-width:800px;margin:0 auto">
      <a href="/chat/${convId}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Back to Chat</a>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="font-size:18px;color:#1e293b">📜 Message History</h2>
          <span style="font-size:13px;color:#94a3b8">${parseInt(total).toLocaleString()} messages total</span>
        </div>
        <div class="messages-area" style="max-height:60vh;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px">
          ${msgHtml || '<p style="text-align:center;color:#94a3b8;padding:20px">No more messages</p>'}
        </div>
        ${oldestId > 0 ? `<div style="text-align:center;margin-top:16px">
          <a href="/chat/${convId}/history?before=${oldestId}" class="btn" style="background:#f1f5f9;color:#475569;text-decoration:none;padding:8px 20px;border-radius:8px;font-size:13px">Load Earlier Messages</a>
        </div>` : '<p style="text-align:center;color:#94a3b8;font-size:13px;margin-top:12px">You have reached the beginning.</p>'}
      </div>
    </div>`;
    res.send(renderPage('Chat History', html, user));
  }));

  // ============================================================
  // ROUTE 7: POST /chat/:id/read — Mark messages as read
  // ============================================================
  app.post('/chat/:id/read', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, convId = parseInt(req.params.id);
    const result = await pool.query(
      `UPDATE chat_messages SET is_read=true WHERE conversation_id=$1 AND tenant_id=$2 AND sender_email!=$3 AND is_read=false`,
      [convId, tid, user.email]);
    await pool.query('UPDATE chat_participants SET last_read_at=NOW() WHERE conversation_id=$1 AND user_email=$2', [convId, user.email]);
    res.json({ success: true, marked: result.rowCount });
  }));

  // ============================================================
  // ROUTE 8: POST /chat/:id/pin/:msgId — Pin/unpin a message
  // ============================================================
  app.post('/chat/:id/pin/:msgId', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, convId = parseInt(req.params.id), msgId = parseInt(req.params.msgId);
    const isPart = (await pool.query('SELECT id FROM chat_participants WHERE conversation_id=$1 AND user_email=$2', [convId, user.email])).rows.length > 0;
    if (!isPart) return res.status(403).json({ error: 'Access denied' });

    const current = (await pool.query('SELECT is_pinned FROM chat_messages WHERE id=$1 AND conversation_id=$2 AND tenant_id=$3', [msgId, convId, tid])).rows[0];
    if (!current) return res.status(404).json({ error: 'Message not found' });

    const newPin = !current.is_pinned;
    await pool.query('UPDATE chat_messages SET is_pinned=$1 WHERE id=$2', [newPin, msgId]);
    audit(user.email, 'chat_pin', `${newPin ? 'Pinned' : 'Unpinned'} message #${msgId} in conversation #${convId}`);
    res.json({ success: true, is_pinned: newPin });
  }));

  // ============================================================
  // ROUTE 9: GET /chat/search — Search messages
  // ============================================================
  app.get('/chat/search', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, query = (req.query.q || '').trim();
    const convFilter = req.query.conv ? parseInt(req.query.conv) : null;

    if (!query) {
      const html = `<div style="max-width:700px;margin:0 auto">
        <a href="/chat" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Messages</a>
        <div class="card" style="padding:40px;text-align:center">
          <div style="font-size:48px;margin-bottom:12px">🔍</div>
          <h2 style="color:#1e293b">Search Messages</h2>
          <p style="color:#94a3b8;font-size:14px;margin-top:4px;margin-bottom:20px">Find messages across all your conversations</p>
          <form method="GET" action="/chat/search" style="max-width:500px;margin:0 auto;display:flex;gap:8px">
            <input type="text" name="q" placeholder="Search by keyword, name, or phrase..." style="flex:1;padding:12px 16px;border:2px solid #e2e8f0;border-radius:12px;font-size:15px" autofocus required>
            <button type="submit" class="btn" style="background:#4f46e5;color:#fff;padding:12px 24px;border:none;border-radius:12px;font-weight:600;cursor:pointer">Search</button>
          </form>
        </div></div>`;
      return res.send(renderPage('Search Messages', html, user));
    }

    const myConvs = (await pool.query('SELECT conversation_id FROM chat_participants WHERE user_email=$1', [user.email])).rows.map(r => r.conversation_id);
    if (myConvs.length === 0) {
      return res.send(renderPage('Search', '<div class="card" style="text-align:center;padding:40px"><h3>No conversations to search</h3><a href="/chat/new" class="btn" style="margin-top:12px;display:inline-block">Start a Chat</a></div>', user));
    }

    const params = [tid, myConvs, `%${query}%`];
    let where = 'cm.tenant_id=$1 AND cm.conversation_id=ANY($2) AND cm.message_text ILIKE $3 AND cm.message_type!=\'system\'';
    if (convFilter) { where += ' AND cm.conversation_id=$4'; params.push(convFilter); }

    const results = (await pool.query(
      `SELECT cm.*, c.title as conv_title, c.type as conv_type, u.name as sender_name
       FROM chat_messages cm JOIN chat_conversations c ON c.id=cm.conversation_id
       LEFT JOIN users u ON u.email=cm.sender_name
       WHERE ${where} ORDER BY cm.created_at DESC LIMIT 50`, params
    )).rows;

    // Safe highlight for the search term
    const safeQuery = esc(query).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const html = `<div style="max-width:700px;margin:0 auto">
      <a href="/chat" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-flex;align-items:center;gap:4px;margin-bottom:16px">← Messages</a>
      <div style="margin-bottom:16px">
        <form method="GET" action="/chat/search" style="display:flex;gap:8px">
          <input type="text" name="q" value="${esc(query)}" placeholder="Search messages..." style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
          ${convFilter ? `<input type="hidden" name="conv" value="${convFilter}">` : ''}
          <button type="submit" class="btn" style="background:#4f46e5;color:#fff;padding:10px 20px;border:none;border-radius:10px;font-weight:600;cursor:pointer">🔍</button>
        </form>
        <p style="font-size:13px;color:#94a3b8">${results.length} result${results.length !== 1 ? 's' : ''} for "<strong style="color:#1e293b">${esc(query)}</strong>"</p>
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        ${results.length === 0 ? `<div style="text-align:center;padding:40px"><div style="font-size:36px;margin-bottom:8px">🔍</div><p style="color:#94a3b8">No messages found.</p></div>` :
          results.map(r => {
            const sName = r.sender_name || r.sender_email.split('@')[0];
            const preview = esc((r.message_text||'').substring(0, 150)).replace(new RegExp(safeQuery, 'gi'), m => `<mark style="background:#fef08a;padding:1px 2px;border-radius:2px">${m}</mark>`);
            const cLabel = r.conv_type==='group' ? `👥 ${esc(r.conv_title||'Group')}` : `👤 ${esc(r.sender_email.split('@')[0])}`;
            return `<a href="/chat/${r.conversation_id}" class="search-result" style="display:block;text-decoration:none;color:inherit">
              <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
                <div style="width:28px;height:28px;border-radius:50%;background:${avatarColor(r.sender_name||r.sender_email)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:11px;font-weight:700;flex-shrink:0">${esc(initials(r.sender_name||r.sender_email))}</div>
                <div style="flex:1;min-width:0">
                  <div style="display:flex;justify-content:space-between;align-items:center">
                    <span style="font-size:13px;font-weight:600;color:#1e293b">${esc(sName)}</span>
                    <span style="font-size:11px;color:#94a3b8;flex-shrink:0">${relativeTime(r.created_at)}</span>
                  </div>
                  <div style="font-size:12px;color:#94a3b8;margin-bottom:2px">${cLabel}</div>
                  <div style="font-size:13px;color:#475569;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${preview}</div>
                </div>
              </div></a>`;
          }).join('')}
      </div></div>`;
    res.send(renderPage('Search: ' + query, html, user));
  }));

  // ============================================================
  // BONUS: POST /chat/:id/participants/add — Add participant to group
  // ============================================================
  app.post('/chat/:id/participants/add', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, convId = parseInt(req.params.id);
    const { email } = req.body;
    if (!email || !email.trim()) return res.redirect('/chat/' + convId);

    const conv = (await pool.query('SELECT * FROM chat_conversations WHERE id=$1 AND tenant_id=$2 AND type=\'group\' AND is_active=true', [convId, tid])).rows[0];
    if (!conv) return res.redirect('/chat/' + convId);
    const isPart = (await pool.query('SELECT id FROM chat_participants WHERE conversation_id=$1 AND user_email=$2', [convId, user.email])).rows.length > 0;
    if (!isPart) return res.redirect('/chat/' + convId);

    await pool.query('INSERT INTO chat_participants (conversation_id, user_email, joined_at) VALUES ($1,$2,NOW()) ON CONFLICT DO NOTHING', [convId, email.trim().toLowerCase()]);
    await addSystemMessage(tid, convId, `${user.email.split('@')[0]} added ${email.split('@')[0]} to the group`);
    if (notify) { try { notify(tid, email.trim(), `Added to ${conv.title||'Group'}`, `You were added to "${conv.title||'Group'}" by ${user.email.split('@')[0]}.`, 'chat'); } catch (_) {} }
    audit(user.email, 'chat_add_participant', `Added ${email} to conversation #${convId}`);
    res.redirect('/chat/' + convId);
  }));

  // ============================================================
  // BONUS: POST /chat/:id/participants/remove — Remove participant
  // ============================================================
  app.post('/chat/:id/participants/remove', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, convId = parseInt(req.params.id);
    const { email } = req.body;
    if (!email) return res.redirect('/chat/' + convId);

    const conv = (await pool.query('SELECT * FROM chat_conversations WHERE id=$1 AND tenant_id=$2', [convId, tid])).rows[0];
    if (!conv) return res.redirect('/chat/' + convId);
    if (conv.created_by !== user.email && email !== user.email) return res.redirect('/chat/' + convId);

    await pool.query('DELETE FROM chat_participants WHERE conversation_id=$1 AND user_email=$2', [convId, email.trim()]);
    await addSystemMessage(tid, convId, `${email.split('@')[0]} was removed from the group`);
    audit(user.email, 'chat_remove_participant', `Removed ${email} from conversation #${convId}`);
    res.redirect(email === user.email ? '/chat' : '/chat/' + convId);
  }));

  // ============================================================
  // BONUS: POST /chat/:id/mute — Mute/unmute conversation
  // ============================================================
  app.post('/chat/:id/mute', requireAuth, ah(async (req, res) => {
    const user = req.session.user, convId = parseInt(req.params.id);
    const current = (await pool.query('SELECT is_muted FROM chat_participants WHERE conversation_id=$1 AND user_email=$2', [convId, user.email])).rows[0];
    if (current) await pool.query('UPDATE chat_participants SET is_muted=$1 WHERE conversation_id=$2 AND user_email=$3', [!current.is_muted, convId, user.email]);
    res.redirect('/chat/' + convId);
  }));

  logger.info('[ChatModule] Internal Messaging & Chat module loaded — 14 routes registered');
};
