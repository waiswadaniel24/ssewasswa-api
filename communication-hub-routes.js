// ============================================================
// COMMUNICATION HUB MODULE — Comfort Zone Multi-Tenant SaaS
// Unified messaging, SMS, email campaigns, notifications,
// and announcements across all channels.
// Usage: const commsHub = require('./communication-hub-routes');
//        commsHub(app, pool, { esc, renderPage, ah, requireAuth, audit });
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t,c,u) => c);
  const ah = (opts && opts.ah) || (fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(e => res.status(500).send('Error: '+e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  // ── helpers ────────────────────────────────────────────
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB',{day:'2-digit',month:'short',year:'numeric'}) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '\u2014';
  const relativeTime = (d) => {
    if (!d) return '';
    const diff = Math.floor((Date.now() - new Date(d)) / 1000);
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff/60) + ' min ago';
    if (diff < 86400) return Math.floor(diff/3600) + 'h ago';
    if (diff < 604800) return Math.floor(diff/86400) + 'd ago';
    return fmtDate(d);
  };
  const initials = (name) => { if (!name) return '?'; return name.replace(/@.*/,'').split(/[._\-\s]+/).slice(0,2).map(p=>(p[0]||'').toUpperCase()).join(''); };
  const avatarColor = (str) => {
    if (!str) return '#6366f1';
    let h = 0; for (let i = 0; i < str.length; i++) h = str.charCodeAt(i) + ((h << 5) - h);
    return ['#6366f1','#8b5cf6','#ec4899','#f59e0b','#10b981','#ef4444','#06b6d4','#f97316','#14b8a6','#a855f7'][Math.abs(h)%10];
  };
  const priorityBadge = (p) => {
    const m = {high:{bg:'#fee2e2',c:'#dc2626',l:'High'},medium:{bg:'#fef3c7',c:'#d97706',l:'Medium'},low:{bg:'#f1f5f9',c:'#64748b',l:'Low'}};
    const s = m[p] || m.low;
    return `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:11px;font-weight:700;background:${s.bg};color:${s.c}">${s.l}</span>`;
  };

  // ── CSS ────────────────────────────────────────────────
  const COMMS_CSS = `<style>
.comms-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.comms-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s;display:flex;align-items:center;gap:5px}
.comms-nav a:hover{background:#e2e8f0}.comms-nav a.active{background:#4f46e5;color:#fff}
.comms-nav .badge-sm{background:#ef4444;color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:10px}
.comms-tbl{width:100%;border-collapse:collapse;font-size:13px}
.comms-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc;white-space:nowrap}
.comms-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.comms-tbl tr:hover{background:#f8fafc}
.comms-tbl td.right,.comms-tbl th.right{text-align:right}
.stat-cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;cursor:pointer;transition:.2s}
.stat-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.08)}
.stat-card .num{font-size:24px;font-weight:800;color:#1e293b}
.stat-card .label{font-size:12px;color:#94a3b8;margin-top:4px}
.stat-card .icon{font-size:28px;margin-bottom:8px}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.form-grid .full{grid-column:1/-1}
.comms-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:16px}
.filter-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.filter-bar input,.filter-bar select{padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px}
.filter-bar label{font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px}
.thread-msg{padding:12px 16px;border-left:3px solid #e2e8f0;margin-bottom:12px;background:#f8fafc;border-radius:0 10px 10px 0}
.thread-msg.sent{border-left-color:#4f46e5;background:#eef2ff}
.thread-msg .meta{font-size:11px;color:#94a3b8;margin-bottom:4px;display:flex;justify-content:space-between}
.thread-msg .meta .name{font-weight:700;color:#4f46e5}
.notif-item{display:flex;gap:12px;padding:12px 16px;border-bottom:1px solid #f1f5f9;cursor:pointer;transition:.15s}
.notif-item:hover{background:#f8fafc}
.notif-item.unread{background:#eff6ff;border-left:3px solid #3b82f6}
.notif-item .dot{width:8px;height:8px;border-radius:50%;background:#3b82f6;flex-shrink:0;margin-top:6px}
.notif-item .dot.read{background:#e2e8f0}
.announce-card{border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px;transition:.2s}
.announce-card:hover{box-shadow:0 2px 12px rgba(0,0,0,.06)}
.announce-card.high-priority{border-left:4px solid #dc2626}
.announce-card.medium-priority{border-left:4px solid #d97706}
.pagination{display:flex;gap:6px;justify-content:center;margin-top:16px}
.pagination a,.pagination span{padding:8px 14px;border-radius:8px;font-size:13px;text-decoration:none;color:#475569;background:#f1f5f9}
.pagination a:hover{background:#e2e8f0}.pagination span.current{background:#4f46e5;color:#fff}
@media(max-width:768px){.form-grid{grid-template-columns:1fr}.stat-cards{grid-template-columns:1fr 1fr}}
</style>`;

  // ── navigation ─────────────────────────────────────────
  function nav(active, counts) {
    counts = counts || {};
    const links = [
      ['/comms','&#x1F4E8; Hub',counts.totalUnread],
      ['/comms/messages','&#x1F4AC; Messages',counts.messages],
      ['/comms/sms','&#x1F4F1; SMS',0],
      ['/comms/emails','&#x2709;&#xFE0F; Email',0],
      ['/comms/notifications','&#x1F514; Notifications',counts.notifications],
      ['/comms/announcements','&#x1F4E2; Announcements',0]
    ];
    return '<div class="comms-nav">' + links.map(([href,label,badge]) =>
      `<a href="${href}" class="${active===href?'active':''}">${label}${badge>0?'<span class="badge-sm">'+badge+'</span>':''}</a>`
    ).join('') + '</div>';
  }

  // ── pagination ─────────────────────────────────────────
  function pagHtml(page, total, base) {
    const pages = Math.ceil(total/20);
    if (pages <= 1) return '';
    let h = '<div class="pagination">';
    if (page > 1) h += `<a href="${base}?page=${page-1}">&laquo;</a>`;
    for (let i = Math.max(1,page-2); i <= Math.min(pages,page+2); i++)
      h += i===page ? `<span class="current">${i}</span>` : `<a href="${base}?page=${i}">${i}</a>`;
    if (page < pages) h += `<a href="${base}?page=${page+1}">&raquo;</a>`;
    return h + '</div>';
  }

  // ── form helpers ───────────────────────────────────────
  function field(label, name, type, val, extra) {
    extra = extra || {};
    return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" name="${name}" value="${esc(String(val||''))}" ${extra.required?'required':''}
        style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"
        ${extra.placeholder?'placeholder="'+esc(extra.placeholder)+'"':''}></div>`;
  }
  function selectField(label, name, options, val) {
    return `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <select name="${name}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">${options.map(([v,l]) =>
      `<option value="${esc(v)}" ${val===v?'selected':''}>${esc(l)}</option>`).join('')}</select></div>`;
  }

  // ══════════════════════════════════════════════════════════
  // DATABASE MIGRATIONS
  // ══════════════════════════════════════════════════════════
  const migrations = [
    `CREATE TABLE IF NOT EXISTS comms_messages (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      sender_id INTEGER NOT NULL,
      recipient_id INTEGER,
      subject VARCHAR(500),
      body TEXT NOT NULL,
      is_read BOOLEAN DEFAULT false,
      read_at TIMESTAMPTZ,
      parent_id INTEGER REFERENCES comms_messages(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS comms_sms_log (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      phone VARCHAR(30) NOT NULL,
      message TEXT NOT NULL,
      template_id INTEGER,
      status VARCHAR(20) DEFAULT 'queued',
      cost DECIMAL(10,4) DEFAULT 0,
      sent_at TIMESTAMPTZ,
      delivered_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS comms_sms_templates (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      name VARCHAR(200) NOT NULL,
      content TEXT NOT NULL,
      category VARCHAR(100),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS comms_email_log (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      to_email VARCHAR(255) NOT NULL,
      subject VARCHAR(500) NOT NULL,
      body TEXT,
      status VARCHAR(20) DEFAULT 'queued',
      sent_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS comms_notifications (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      title VARCHAR(500) NOT NULL,
      body TEXT,
      type VARCHAR(50) DEFAULT 'info',
      is_read BOOLEAN DEFAULT false,
      read_at TIMESTAMPTZ,
      link_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS comms_announcements (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER NOT NULL,
      author_id INTEGER NOT NULL,
      title VARCHAR(500) NOT NULL,
      body TEXT NOT NULL,
      target_roles TEXT[],
      priority VARCHAR(20) DEFAULT 'medium',
      published_at TIMESTAMPTZ DEFAULT NOW(),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_comms_msg_tenant ON comms_messages(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_msg_sender ON comms_messages(tenant_id,sender_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_msg_recip ON comms_messages(tenant_id,recipient_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_msg_parent ON comms_messages(parent_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_msg_read ON comms_messages(tenant_id,recipient_id,is_read)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_sms_tenant ON comms_sms_log(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_sms_phone ON comms_sms_log(tenant_id,phone)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_sms_status ON comms_sms_log(tenant_id,status)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_sms_tpl_tenant ON comms_sms_templates(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_email_tenant ON comms_email_log(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_email_status ON comms_email_log(tenant_id,status)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_notif_tenant ON comms_notifications(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_notif_user ON comms_notifications(tenant_id,user_id,is_read)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_notif_type ON comms_notifications(tenant_id,type)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_announce_tenant ON comms_announcements(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_comms_announce_priority ON comms_announcements(tenant_id,priority)`
  ];

  (async () => {
    try {
      for (const sql of migrations) await migrateQuery(pool, 'CommunicationHubRoutes', sql);
      console.log('[CommHub] Migrations applied: ' + migrations.length + ' statements');
    } catch (e) { console.error('[CommHub] Migration error:', e.message); }
  })();

  // ══════════════════════════════════════════════════════════
  // GET /comms — Communication Hub Dashboard
  // ══════════════════════════════════════════════════════════
  app.get('/comms', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);

    const counts = (await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM comms_messages WHERE tenant_id=$1 AND recipient_id=$2 AND is_read=false) AS unread_messages,
        (SELECT COUNT(*) FROM comms_notifications WHERE tenant_id=$1 AND user_id=$2 AND is_read=false) AS unread_notifications,
        (SELECT COUNT(*) FROM comms_sms_log WHERE tenant_id=$1 AND created_at >= CURRENT_DATE) AS sms_today,
        (SELECT COUNT(*) FROM comms_email_log WHERE tenant_id=$1 AND created_at >= CURRENT_DATE) AS emails_today,
        (SELECT COUNT(*) FROM comms_announcements WHERE tenant_id=$1 AND published_at >= date_trunc('week',CURRENT_DATE)) AS announcements_week,
        (SELECT COUNT(*) FROM comms_messages WHERE tenant_id=$1) AS total_messages
    `, [tid, user.id])).rows[0];

    const recentMsgs = (await pool.query(`
      SELECT m.*, s.name AS sender_name FROM comms_messages m
      LEFT JOIN users s ON s.id=m.sender_id
      WHERE m.tenant_id=$1 ORDER BY m.created_at DESC LIMIT 5`, [tid])).rows;
    const recentNotifs = (await pool.query(`
      SELECT * FROM comms_notifications WHERE tenant_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 5`, [tid, user.id])).rows;

    const msgsHtml = recentMsgs.map(m => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
      <div style="display:flex;justify-content:space-between">
        <span style="font-weight:600;color:#1e293b">${esc(m.sender_name||'User #'+m.sender_id)}</span>
        <span style="color:#94a3b8;font-size:11px">${relativeTime(m.created_at)}</span>
      </div>
      <div style="color:#475569;margin-top:2px">${esc(m.subject||(m.body||'').substring(0,60))}</div>
    </div>`).join('');

    const notifsHtml = recentNotifs.map(n => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
      <div style="display:flex;justify-content:space-between">
        <span style="font-weight:600;color:#1e293b">${esc(n.title)}</span>
        <span style="color:#94a3b8;font-size:11px">${relativeTime(n.created_at)}</span>
      </div>
      <div style="color:#475569;margin-top:2px">${esc((n.body||'').substring(0,60))}</div>
    </div>`).join('');

    const html = COMMS_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/comms', {totalUnread: parseInt(counts.unread_messages)+parseInt(counts.unread_notifications), messages: parseInt(counts.unread_messages), notifications: parseInt(counts.unread_notifications)})}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">&#x1F4E8; Communication Hub</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Messages, SMS, email &amp; notifications</p></div>
        <div style="display:flex;gap:8px">
          <a href="/comms/messages?action=compose" class="btn" style="background:#4f46e5;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">+ New Message</a>
          <a href="/comms/sms/send" class="btn" style="background:#16a34a;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">Send SMS</a>
        </div>
      </div>
      <div class="stat-cards">
        <a href="/comms/messages" class="stat-card" style="text-decoration:none">
          <div class="icon">&#x1F4AC;</div>
          <div class="num">${counts.unread_messages}</div><div class="label">Unread Messages</div>
        </a>
        <a href="/comms/notifications" class="stat-card" style="text-decoration:none">
          <div class="icon">&#x1F514;</div>
          <div class="num">${counts.unread_notifications}</div><div class="label">Unread Notifications</div>
        </a>
        <a href="/comms/sms" class="stat-card" style="text-decoration:none">
          <div class="icon">&#x1F4F1;</div>
          <div class="num">${counts.sms_today}</div><div class="label">SMS Sent Today</div>
        </a>
        <a href="/comms/emails" class="stat-card" style="text-decoration:none">
          <div class="icon">&#x2709;&#xFE0F;</div>
          <div class="num">${counts.emails_today}</div><div class="label">Emails Sent Today</div>
        </a>
        <a href="/comms/announcements" class="stat-card" style="text-decoration:none">
          <div class="icon">&#x1F4E2;</div>
          <div class="num">${counts.announcements_week}</div><div class="label">Announcements This Week</div>
        </a>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="comms-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="font-size:15px;color:#1e293b">&#x1F4AC; Recent Messages</h3>
            <a href="/comms/messages" style="font-size:13px;color:#4f46e5;text-decoration:none">View All &rarr;</a>
          </div>
          ${msgsHtml || '<div style="text-align:center;color:#94a3b8;padding:20px">No messages yet</div>'}
        </div>
        <div class="comms-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="font-size:15px;color:#1e293b">&#x1F514; Recent Notifications</h3>
            <a href="/comms/notifications" style="font-size:13px;color:#4f46e5;text-decoration:none">View All &rarr;</a>
          </div>
          ${notifsHtml || '<div style="text-align:center;color:#94a3b8;padding:20px">No notifications yet</div>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Communication Hub', html, user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // GET /comms/messages — Message inbox
  // ══════════════════════════════════════════════════════════
  app.get('/comms/messages', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const page = parseInt(req.query.page) || 1;
    const filter = req.query.filter || 'all'; // all, unread, sent

    let where = 'WHERE m.tenant_id=$1', params = [tid];
    if (filter === 'unread') { where += ' AND m.recipient_id=$2 AND m.is_read=false'; params.push(user.id); }
    else if (filter === 'sent') { where += ' AND m.sender_id=$2'; params.push(user.id); }
    else { where += ' AND (m.recipient_id=$2 OR m.sender_id=$2)'; params.push(user.id, user.id); }

    const count = (await pool.query(`SELECT COUNT(*) FROM comms_messages m ${where}`, params)).rows[0].count;
    const messages = (await pool.query(
      `SELECT m.*, s.name AS sender_name, r.name AS recipient_name
       FROM comms_messages m
       LEFT JOIN users s ON s.id=m.sender_id
       LEFT JOIN users r ON r.id=m.recipient_id
       ${where} AND m.parent_id IS NULL ORDER BY m.created_at DESC LIMIT 20 OFFSET $${params.length+1}`,
      [...params, (page-1)*20]
    )).rows;

    const unread = (await pool.query(
      'SELECT COUNT(*) FROM comms_messages WHERE tenant_id=$1 AND recipient_id=$2 AND is_read=false', [tid, user.id])).rows[0].count;

    const rows = messages.map(m => {
      const isSent = m.sender_id === user.id;
      const otherName = isSent ? (m.recipient_name || 'User #'+m.recipient_id) : (m.sender_name || 'User #'+m.sender_id);
      return `<tr style="${m.is_read===false && m.recipient_id===user.id ? 'background:#eff6ff;font-weight:600' : ''}">
        <td>
          <div style="display:flex;align-items:center;gap:10px">
            <div style="width:36px;height:36px;border-radius:50%;background:${avatarColor(otherName)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:13px;font-weight:700;flex-shrink:0">${esc(initials(otherName))}</div>
            <div>
              <div style="font-weight:600;color:#1e293b">${esc(otherName)}</div>
              <div style="font-size:11px;color:#94a3b8">${isSent?'&#x27A4; Sent':'&#x27A5; Received'}</div>
            </div>
          </div>
        </td>
        <td><a href="/comms/messages/${m.id}" style="color:#4f46e5;text-decoration:none">${esc(m.subject||(m.body||'').substring(0,60))}</a></td>
        <td style="color:#94a3b8;font-size:12px">${relativeTime(m.created_at)}</td>
        <td>${m.is_read || isSent ? '<span style="color:#94a3b8;font-size:11px">Read</span>' : '<span style="background:#3b82f6;color:#fff;font-size:10px;font-weight:700;padding:2px 8px;border-radius:10px">New</span>'}</td>
      </tr>`;
    }).join('');

    const html = COMMS_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/comms/messages', {messages: parseInt(unread)})}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">&#x1F4AC; Messages</h1>
        <a href="/comms/messages?action=compose" class="btn" style="background:#4f46e5;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">+ Compose</a>
      </div>
      <div class="filter-bar">
        <a href="/comms/messages?filter=all" style="padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;${filter==='all'?'background:#4f46e5;color:#fff':'background:#f1f5f9;color:#64748b'}">All</a>
        <a href="/comms/messages?filter=unread" style="padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;${filter==='unread'?'background:#4f46e5;color:#fff':'background:#f1f5f9;color:#64748b'}">Unread (${unread})</a>
        <a href="/comms/messages?filter=sent" style="padding:6px 14px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;${filter==='sent'?'background:#4f46e5;color:#fff':'background:#f1f5f9;color:#64748b'}">Sent</a>
      </div>
      <div class="comms-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table class="comms-tbl">
          <thead><tr><th>From / To</th><th>Subject</th><th>Time</th><th>Status</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:40px">No messages</td></tr>'}</tbody>
        </table></div>
      </div>
      ${pagHtml(page, parseInt(count), '/comms/messages?filter='+filter)}
    </div>`;
    res.send(renderPage('Messages', html, user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // GET /comms/messages/:id — View message thread
  // ══════════════════════════════════════════════════════════
  app.get('/comms/messages/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req), id = req.params.id;

    const msg = (await pool.query('SELECT m.*, s.name AS sender_name, r.name AS recipient_name FROM comms_messages m LEFT JOIN users s ON s.id=m.sender_id LEFT JOIN users r ON r.id=m.recipient_id WHERE m.id=$1 AND m.tenant_id=$2', [id, tid])).rows[0];
    if (!msg) return res.status(404).send('Message not found');

    // Mark as read
    if (msg.recipient_id === user.id && !msg.is_read) {
      await pool.query('UPDATE comms_messages SET is_read=true, read_at=NOW() WHERE id=$1', [id]);
    }

    // Get thread replies
    const thread = (await pool.query(
      `SELECT m.*, s.name AS sender_name FROM comms_messages m
       LEFT JOIN users s ON s.id=m.sender_id
       WHERE (m.id=$1 OR m.parent_id=$1) AND m.tenant_id=$2 ORDER BY m.created_at ASC`, [id, tid])).rows;

    const threadHtml = thread.map(t => {
      const isSent = t.sender_id === user.id;
      return `<div class="thread-msg ${isSent?'sent':''}">
        <div class="meta">
          <span class="name">${esc(t.sender_name || 'User #'+t.sender_id)}</span>
          <span>${fmtDateTime(t.created_at)}</span>
        </div>
        <div style="font-size:14px;line-height:1.6;color:#1e293b">${esc(t.body).replace(/\n/g,'<br>')}</div>
      </div>`;
    }).join('');

    const html = COMMS_CSS + `
    <div style="max-width:900px;margin:0 auto">
      ${nav('/comms/messages')}
      <a href="/comms/messages" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">&larr; Back to Messages</a>
      <div class="comms-card">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:16px">
          <div>
            <h2 style="font-size:18px;color:#1e293b">${esc(msg.subject||'(No Subject)')}</h2>
            <p style="font-size:13px;color:#94a3b8;margin-top:4px">From: ${esc(msg.sender_name||'User #'+msg.sender_id)} &middot; To: ${esc(msg.recipient_name||'User #'+msg.recipient_id)} &middot; ${fmtDateTime(msg.created_at)}</p>
          </div>
        </div>
        <div style="border-top:1px solid #e2e8f0;padding-top:16px">${threadHtml}</div>
      </div>
      <div class="comms-card">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">Reply</h3>
        <form method="POST" action="/comms/messages/${id}/reply">
          <div style="margin-bottom:12px">
            <textarea name="body" rows="4" required style="width:100%;padding:12px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit;resize:vertical" placeholder="Type your reply..."></textarea>
          </div>
          <button type="submit" class="btn" style="background:#4f46e5;color:#fff;border:none;padding:10px 24px;border-radius:10px;font-weight:600;font-size:14px;cursor:pointer">Send Reply</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Message: ' + (msg.subject||'Thread'), html, user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // POST /comms/messages — Send new message
  // ══════════════════════════════════════════════════════════
  app.post('/comms/messages', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const { recipient_id, subject, body } = req.body;
    if (!recipient_id || !body || !body.trim()) return res.status(400).send('Recipient and message body are required');

    await pool.query(
      `INSERT INTO comms_messages (tenant_id,sender_id,recipient_id,subject,body) VALUES ($1,$2,$3,$4,$5)`,
      [tid, user.id, parseInt(recipient_id), (subject||'').trim()||null, body.trim()]);

    // Create notification for recipient
    await pool.query(
      `INSERT INTO comms_notifications (tenant_id,user_id,title,body,type,link_url)
       VALUES ($1,$2,$3,$4,'message',$5)`,
      [tid, parseInt(recipient_id), 'New message from ' + (user.name||'User #'+user.id),
       (subject||'Message: '+(body||'').substring(0,50)), '/comms/messages']);

    audit(user.email, 'comms_msg_send', 'Sent message to user #' + recipient_id);
    res.redirect('/comms/messages');
  }));

  // ══════════════════════════════════════════════════════════
  // POST /comms/messages/:id/reply — Reply to message
  // ══════════════════════════════════════════════════════════
  app.post('/comms/messages/:id/reply', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req), id = req.params.id;
    const { body } = req.body;
    if (!body || !body.trim()) return res.redirect('/comms/messages/' + id);

    const orig = (await pool.query('SELECT * FROM comms_messages WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!orig) return res.status(404).send('Message not found');

    const replyTo = orig.sender_id === user.id ? orig.recipient_id : orig.sender_id;
    await pool.query(
      `INSERT INTO comms_messages (tenant_id,sender_id,recipient_id,subject,body,parent_id) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, user.id, replyTo, orig.subject, body.trim(), parseInt(id)]);

    // Notify reply recipient
    if (replyTo) {
      await pool.query(
        `INSERT INTO comms_notifications (tenant_id,user_id,title,body,type,link_url)
         VALUES ($1,$2,$3,$4,'message',$5)`,
        [tid, replyTo, 'Reply from ' + (user.name||'User'), (body||'').substring(0,60), '/comms/messages/' + id]);
    }

    audit(user.email, 'comms_msg_reply', 'Replied to message #' + id);
    res.redirect('/comms/messages/' + id);
  }));

  // ══════════════════════════════════════════════════════════
  // GET /comms/sms — SMS management
  // ══════════════════════════════════════════════════════════
  app.get('/comms/sms', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const page = parseInt(req.query.page) || 1;

    const stats = (await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM comms_sms_log WHERE tenant_id=$1 AND created_at >= CURRENT_DATE) AS today,
        (SELECT COUNT(*) FROM comms_sms_log WHERE tenant_id=$1 AND status='delivered') AS delivered,
        (SELECT COUNT(*) FROM comms_sms_log WHERE tenant_id=$1 AND status='failed') AS failed,
        (SELECT COUNT(*) FROM comms_sms_templates WHERE tenant_id=$1) AS templates
    `, [tid])).rows[0];

    const logs = (await pool.query(
      'SELECT * FROM comms_sms_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20 OFFSET $2', [tid, (page-1)*20])).rows;
    const count = (await pool.query('SELECT COUNT(*) FROM comms_sms_log WHERE tenant_id=$1', [tid])).rows[0].count;

    const statusBadge = (s) => {
      const m = {queued:{bg:'#fef3c7',c:'#d97706'},sent:{bg:'#dbeafe',c:'#2563eb'},delivered:{bg:'#dcfce7',c:'#16a34a'},failed:{bg:'#fee2e2',c:'#dc2626'}};
      const st = m[s] || m.queued;
      return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;background:${st.bg};color:${st.c}">${esc(s)}</span>`;
    };

    const rows = logs.map(l => `<tr>
      <td>${esc(l.phone)}</td>
      <td style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((l.message||'').substring(0,50))}</td>
      <td>${statusBadge(l.status)}</td>
      <td>${fmtDateTime(l.sent_at)}</td>
    </tr>`).join('');

    const html = COMMS_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/comms/sms')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">&#x1F4F1; SMS Management</h1>
        <div style="display:flex;gap:8px">
          <a href="/comms/sms/send" class="btn" style="background:#16a34a;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">+ Send SMS</a>
          <a href="/comms/sms/templates" class="btn" style="background:#64748b;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">Templates</a>
        </div>
      </div>
      <div class="stat-cards">
        <div class="stat-card"><div class="icon">&#x1F4E8;</div><div class="num">${stats.today}</div><div class="label">Sent Today</div></div>
        <div class="stat-card"><div class="icon">&#x2705;</div><div class="num" style="color:#16a34a">${stats.delivered}</div><div class="label">Delivered</div></div>
        <div class="stat-card"><div class="icon">&#x274C;</div><div class="num" style="color:#dc2626">${stats.failed}</div><div class="label">Failed</div></div>
        <div class="stat-card"><div class="icon">&#x1F4DD;</div><div class="num">${stats.templates}</div><div class="label">Templates</div></div>
      </div>
      <div class="comms-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table class="comms-tbl">
          <thead><tr><th>Phone</th><th>Message</th><th>Status</th><th>Sent At</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:40px">No SMS history</td></tr>'}</tbody>
        </table></div>
      </div>
      ${pagHtml(page, parseInt(count), '/comms/sms')}
    </div>`;
    res.send(renderPage('SMS Management', html, user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // POST /comms/sms/send — Send SMS
  // ══════════════════════════════════════════════════════════
  app.post('/comms/sms/send', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const { phone, message, template_id } = req.body;
    if (!phone || !message || !message.trim()) return res.status(400).send('Phone and message are required');

    await pool.query(
      `INSERT INTO comms_sms_log (tenant_id,phone,message,template_id,status,sent_at)
       VALUES ($1,$2,$3,$4,'sent',NOW())`,
      [tid, phone.trim(), message.trim(), template_id ? parseInt(template_id) : null]);

    audit(user.email, 'comms_sms_send', 'Sent SMS to ' + phone);
    res.redirect('/comms/sms');
  }));

  // ══════════════════════════════════════════════════════════
  // GET /comms/sms/templates — SMS templates
  // ══════════════════════════════════════════════════════════
  app.get('/comms/sms/templates', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const templates = (await pool.query(
      'SELECT * FROM comms_sms_templates WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;

    const rows = templates.map(t => `<div class="comms-card" style="margin-bottom:8px">
      <div style="display:flex;justify-content:space-between;align-items:start">
        <div><div style="font-weight:700;color:#1e293b;font-size:14px">${esc(t.name)}</div>
          <div style="font-size:12px;color:#94a3b8;margin-top:2px">${esc(t.category||'General')}</div></div>
        <span style="font-size:11px;color:#94a3b8">${fmtDate(t.created_at)}</span>
      </div>
      <div style="margin-top:8px;padding:10px;background:#f8fafc;border-radius:8px;font-size:13px;color:#475569;line-height:1.5">${esc(t.content)}</div>
    </div>`).join('');

    const html = COMMS_CSS + `
    <div style="max-width:900px;margin:0 auto">
      ${nav('/comms/sms')}
      <a href="/comms/sms" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">&larr; Back to SMS</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
        <h1 style="font-size:22px;color:#1e293b">&#x1F4DD; SMS Templates</h1>
      </div>
      <div class="comms-card">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">Create Template</h3>
        <form method="POST" action="/comms/sms/templates">
          <div class="form-grid">
            ${field('Template Name *', 'name', 'text', '', {required:true, placeholder:'e.g. Welcome Message'})}
            ${field('Category', 'category', 'text', '', {placeholder:'e.g. onboarding'})}
          </div>
          <div style="margin-top:12px"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Content *</label>
            <textarea name="content" rows="3" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="Hello {{name}}, welcome to our platform!"></textarea>
            <p style="font-size:11px;color:#94a3b8;margin-top:4px">Use &#123;&#123;name&#125;&#125;, &#123;&#123;date&#125;&#125; etc. for placeholders</p></div>
          <button type="submit" class="btn" style="background:#64748b;color:#fff;border:none;padding:10px 24px;border-radius:10px;font-weight:600;margin-top:12px;cursor:pointer">Save Template</button>
        </form>
      </div>
      <h3 style="font-size:15px;color:#1e293b;margin:20px 0 12px">Saved Templates (${templates.length})</h3>
      ${rows || '<div style="text-align:center;color:#94a3b8;padding:40px">No templates yet</div>'}
    </div>`;

    // Also handle POST for template creation
    app.post('/comms/sms/templates', requireAuth, ah(async (req, res2) => {
      const user2 = req.session.user, tid2 = tenantId(req);
      const { name, category, content } = req.body;
      if (!name || !content) return res2.status(400).send('Name and content required');
      await pool.query(
        'INSERT INTO comms_sms_templates (tenant_id,name,content,category) VALUES ($1,$2,$3,$4)',
        [tid2, name.trim(), content.trim(), (category||'').trim()||null]);
      audit(user2.email, 'comms_sms_tpl', 'Created SMS template: ' + name);
      res2.redirect('/comms/sms/templates');
    }));

    res.send(renderPage('SMS Templates', html, req.session.user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // GET /comms/emails — Email campaigns
  // ══════════════════════════════════════════════════════════
  app.get('/comms/emails', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const page = parseInt(req.query.page) || 1;
    const count = (await pool.query('SELECT COUNT(*) FROM comms_email_log WHERE tenant_id=$1', [tid])).rows[0].count;
    const emails = (await pool.query(
      'SELECT * FROM comms_email_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20 OFFSET $2', [tid, (page-1)*20])).rows;

    const stats = (await pool.query(`
      SELECT
        (SELECT COUNT(*) FROM comms_email_log WHERE tenant_id=$1 AND status='sent') AS sent,
        (SELECT COUNT(*) FROM comms_email_log WHERE tenant_id=$1 AND status='failed') AS failed,
        (SELECT COUNT(*) FROM comms_email_log WHERE tenant_id=$1 AND created_at >= CURRENT_DATE) AS today
    `, [tid])).rows[0];

    const statusBadge = (s) => {
      const m = {queued:{bg:'#fef3c7',c:'#d97706'},sent:{bg:'#dcfce7',c:'#16a34a'},failed:{bg:'#fee2e2',c:'#dc2626'}};
      const st = m[s] || m.queued;
      return `<span style="display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:700;background:${st.bg};color:${st.c}">${esc(s)}</span>`;
    };

    const rows = emails.map(e => `<tr>
      <td>${esc(e.to_email)}</td>
      <td><a href="#" style="color:#4f46e5;text-decoration:none">${esc(e.subject)}</a></td>
      <td>${statusBadge(e.status)}</td>
      <td>${fmtDateTime(e.sent_at)}</td>
    </tr>`).join('');

    const html = COMMS_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${nav('/comms/emails')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">&#x2709;&#xFE0F; Email Campaigns</h1>
        <a href="/comms/emails?action=compose" class="btn" style="background:#4f46e5;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">+ Compose Email</a>
      </div>
      <div class="stat-cards" style="margin-bottom:16px">
        <div class="stat-card"><div class="num">${stats.sent}</div><div class="label">Emails Sent</div></div>
        <div class="stat-card"><div class="num" style="color:#dc2626">${stats.failed}</div><div class="label">Failed</div></div>
        <div class="stat-card"><div class="num">${stats.today}</div><div class="label">Sent Today</div></div>
      </div>

      ${req.query.action === 'compose' ? `
      <div class="comms-card" style="margin-bottom:16px">
        <h2 style="color:#1e293b;margin-bottom:16px">Compose Email</h2>
        <form method="POST" action="/comms/emails/send">
          <div class="form-grid">
            ${field('To Email *', 'to_email', 'email', '', {required:true, placeholder:'recipient@example.com'})}
            ${field('Subject *', 'subject', 'text', '', {required:true, placeholder:'Email subject'})}
          </div>
          <div style="margin-top:12px"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Body *</label>
            <textarea name="body" rows="8" required style="width:100%;padding:12px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit" placeholder="Write your email content here..."></textarea></div>
          <div style="display:flex;gap:10px;margin-top:16px">
            <button type="submit" class="btn" style="background:#4f46e5;color:#fff;border:none;padding:10px 24px;border-radius:10px;font-weight:600;cursor:pointer">Send Email</button>
            <a href="/comms/emails" class="btn" style="padding:10px 24px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:10px">Cancel</a>
          </div>
        </form>
      </div>` : ''}

      <div class="comms-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table class="comms-tbl">
          <thead><tr><th>To</th><th>Subject</th><th>Status</th><th>Sent At</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="4" style="text-align:center;color:#94a3b8;padding:40px">No emails sent</td></tr>'}</tbody>
        </table></div>
      </div>
      ${pagHtml(page, parseInt(count), '/comms/emails')}
    </div>`;
    res.send(renderPage('Email Campaigns', html, user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // POST /comms/emails/send — Send email
  // ══════════════════════════════════════════════════════════
  app.post('/comms/emails/send', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const { to_email, subject, body } = req.body;
    if (!to_email || !subject || !body) return res.status(400).send('To email, subject, and body are required');

    await pool.query(
      `INSERT INTO comms_email_log (tenant_id,to_email,subject,body,status,sent_at)
       VALUES ($1,$2,$3,$4,'sent',NOW())`,
      [tid, to_email.trim(), subject.trim(), body.trim()]);

    audit(user.email, 'comms_email_send', 'Sent email to ' + to_email);
    res.redirect('/comms/emails');
  }));

  // ══════════════════════════════════════════════════════════
  // GET /comms/notifications — Notification center
  // ══════════════════════════════════════════════════════════
  app.get('/comms/notifications', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const page = parseInt(req.query.page) || 1;

    const count = (await pool.query(
      'SELECT COUNT(*) FROM comms_notifications WHERE tenant_id=$1 AND user_id=$2', [tid, user.id])).rows[0].count;
    const unreadCount = (await pool.query(
      'SELECT COUNT(*) FROM comms_notifications WHERE tenant_id=$1 AND user_id=$2 AND is_read=false', [tid, user.id])).rows[0].count;

    const notifs = (await pool.query(
      `SELECT * FROM comms_notifications WHERE tenant_id=$1 AND user_id=$2 ORDER BY is_read ASC, created_at DESC LIMIT 25 OFFSET $3`,
      [tid, user.id, (page-1)*25])).rows;

    const typeIcon = (t) => {
      const m = {message:'&#x1F4AC;',alert:'&#x26A0;&#xFE0F;',system:'&#x2699;&#xFE0F;',info:'&#x2139;&#xFE0F;',success:'&#x2705;',reminder:'&#x23F0;'};
      return m[t] || '&#x1F514;';
    };

    const notifsHtml = notifs.map(n => `<div class="notif-item ${n.is_read?'':'unread'}" onclick="window.location='/comms/notifications/${n.id}/read'">
      <div class="dot ${n.is_read?'read':''}"></div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <div style="font-weight:${n.is_read?'400':'700'};color:#1e293b;font-size:14px">${typeIcon(n.type)} ${esc(n.title)}</div>
          <span style="color:#94a3b8;font-size:11px;white-space:nowrap;margin-left:12px">${relativeTime(n.created_at)}</span>
        </div>
        ${n.body ? `<div style="font-size:13px;color:#64748b;margin-top:2px">${esc((n.body||'').substring(0,100))}</div>` : ''}
        ${n.link_url ? `<a href="${esc(n.link_url)}" style="font-size:12px;color:#4f46e5;text-decoration:none;margin-top:4px;display:inline-block">View &rarr;</a>` : ''}
      </div>
    </div>`).join('');

    const html = COMMS_CSS + `
    <div style="max-width:900px;margin:0 auto">
      ${nav('/comms/notifications', {notifications: parseInt(unreadCount)})}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">&#x1F514; Notifications</h1>
        ${parseInt(unreadCount) > 0 ? `<form method="POST" action="/comms/notifications/read-all" style="display:inline">
          <button type="submit" class="btn" style="background:#3b82f6;color:#fff;border:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:13px;cursor:pointer">Mark All as Read (${unreadCount})</button>
        </form>` : ''}
      </div>
      <div class="comms-card" style="padding:0;overflow:hidden">
        ${notifsHtml || '<div style="text-align:center;color:#94a3b8;padding:60px;font-size:14px">&#x1F389; All caught up! No notifications.</div>'}
      </div>
      ${pagHtml(page, parseInt(count), '/comms/notifications')}
    </div>`;
    res.send(renderPage('Notifications', html, user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // PUT /comms/notifications/:id/read — Mark as read
  // ══════════════════════════════════════════════════════════
  app.get('/comms/notifications/:id/read', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req), id = req.params.id;
    const notif = (await pool.query(
      'SELECT * FROM comms_notifications WHERE id=$1 AND tenant_id=$2 AND user_id=$3', [id, tid, user.id])).rows[0];
    if (!notif) return res.status(404).send('Notification not found');

    await pool.query('UPDATE comms_notifications SET is_read=true, read_at=NOW() WHERE id=$1', [id]);

    if (notif.link_url) return res.redirect(notif.link_url);
    res.redirect('/comms/notifications');
  }));

  app.put('/comms/notifications/:id/read', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req), id = req.params.id;
    await pool.query(
      'UPDATE comms_notifications SET is_read=true, read_at=NOW() WHERE id=$1 AND tenant_id=$2 AND user_id=$3',
      [id, tid, user.id]);
    res.json({success:true});
  }));

  // ══════════════════════════════════════════════════════════
  // PUT /comms/notifications/read-all — Mark all as read
  // ══════════════════════════════════════════════════════════
  app.post('/comms/notifications/read-all', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    await pool.query(
      'UPDATE comms_notifications SET is_read=true, read_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND is_read=false',
      [tid, user.id]);
    audit(user.email, 'comms_notif_readall', 'Marked all notifications as read');
    res.redirect('/comms/notifications');
  }));

  app.put('/comms/notifications/read-all', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const r = await pool.query(
      'UPDATE comms_notifications SET is_read=true, read_at=NOW() WHERE tenant_id=$1 AND user_id=$2 AND is_read=false',
      [tid, user.id]);
    res.json({success:true, updated:r.rowCount});
  }));

  // ══════════════════════════════════════════════════════════
  // GET /comms/announcements — Announcements list
  // ══════════════════════════════════════════════════════════
  app.get('/comms/announcements', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const page = parseInt(req.query.page) || 1;
    const count = (await pool.query('SELECT COUNT(*) FROM comms_announcements WHERE tenant_id=$1', [tid])).rows[0].count;

    const anns = (await pool.query(
      `SELECT a.*, u.name AS author_name FROM comms_announcements a
       LEFT JOIN users u ON u.id=a.author_id
       WHERE a.tenant_id=$1 ORDER BY a.published_at DESC LIMIT 20 OFFSET $2`, [tid, (page-1)*20])).rows;

    const cards = anns.map(a => `<div class="announce-card ${a.priority}-priority">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
        <div>
          <h3 style="font-size:16px;color:#1e293b;font-weight:700">${esc(a.title)}</h3>
          <p style="font-size:12px;color:#94a3b8;margin-top:2px">By ${esc(a.author_name||'Unknown')} &middot; ${fmtDateTime(a.published_at)}</p>
        </div>
        <div style="display:flex;gap:6px;align-items:center">
          ${priorityBadge(a.priority)}
          ${a.target_roles && a.target_roles.length > 0 ? `<span style="font-size:11px;color:#94a3b8">&#x1F465; ${esc(a.target_roles.join(', '))}</span>` : ''}
        </div>
      </div>
      <div style="font-size:14px;color:#475569;line-height:1.6">${esc((a.body||'').substring(0,200))}${(a.body||'').length > 200 ? '...' : ''}</div>
    </div>`).join('');

    const html = COMMS_CSS + `
    <div style="max-width:900px;margin:0 auto">
      ${nav('/comms/announcements')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">&#x1F4E2; Announcements</h1>
        <a href="/comms/announcements?action=create" class="btn" style="background:#7c3aed;color:#fff;text-decoration:none;padding:8px 20px;border-radius:10px;font-weight:600;font-size:14px">+ Post Announcement</a>
      </div>

      ${req.query.action === 'create' ? `
      <div class="comms-card" style="margin-bottom:16px">
        <h2 style="color:#1e293b;margin-bottom:16px">Post New Announcement</h2>
        <form method="POST" action="/comms/announcements">
          ${field('Title *', 'title', 'text', '', {required:true, placeholder:'Important announcement...'})}
          <div class="form-grid" style="margin-top:12px">
            ${selectField('Priority', 'priority', [['high','High'],['medium','Medium'],['low','Low']], 'medium')}
            ${field('Target Roles', 'target_roles', 'text', '', {placeholder:'admin, teacher, parent (comma-separated)'})}
          </div>
          <div style="margin-top:12px"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Body *</label>
            <textarea name="body" rows="6" required style="width:100%;padding:12px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;font-family:inherit" placeholder="Write your announcement..."></textarea></div>
          <div style="display:flex;gap:10px;margin-top:16px">
            <button type="submit" class="btn" style="background:#7c3aed;color:#fff;border:none;padding:10px 24px;border-radius:10px;font-weight:600;cursor:pointer">Publish Announcement</button>
            <a href="/comms/announcements" class="btn" style="padding:10px 24px;background:#f1f5f9;color:#475569;text-decoration:none;border-radius:10px">Cancel</a>
          </div>
        </form>
      </div>` : ''}

      <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">All Announcements (${count})</h3>
      ${cards || '<div style="text-align:center;color:#94a3b8;padding:60px;font-size:14px">No announcements yet</div>'}
      ${pagHtml(page, parseInt(count), '/comms/announcements')}
    </div>`;
    res.send(renderPage('Announcements', html, user, req));
  }));

  // ══════════════════════════════════════════════════════════
  // POST /comms/announcements — Post announcement
  // ══════════════════════════════════════════════════════════
  app.post('/comms/announcements', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = tenantId(req);
    const { title, body, priority, target_roles } = req.body;
    if (!title || !body || !body.trim()) return res.status(400).send('Title and body are required');

    const roles = target_roles ? target_roles.split(',').map(r => r.trim()).filter(Boolean) : null;
    await pool.query(
      `INSERT INTO comms_announcements (tenant_id,author_id,title,body,target_roles,priority,published_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [tid, user.id, title.trim(), body.trim(), roles, priority || 'medium']);

    // Create notifications for tenant users about this announcement
    const notifBody = (body||'').substring(0, 80) + ((body||'').length > 80 ? '...' : '');
    await pool.query(
      `INSERT INTO comms_notifications (tenant_id,user_id,title,body,type,link_url)
       SELECT $1, id, $2, $3, 'announcement', '/comms/announcements'
       FROM users WHERE tenant_id=$1 AND is_active=true AND id != $4`,
      [tid, title.trim(), notifBody, user.id]).catch(() => {});

    audit(user.email, 'comms_announce', 'Posted announcement: ' + title);
    res.redirect('/comms/announcements');
  }));

  console.log('[CommHub] Routes registered successfully');
};
