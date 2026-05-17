// ============================================================
// REAL-TIME ENGINE — Server-Sent Events (SSE) for Comfort Zone
// ============================================================
// Self-executing module. Uses globals set by server.js:
//   app, pool, ah, esc, renderPage, requireAuth, migrations,
//   VALID_TABLES, notify, notifyAll
// ============================================================

'use strict';

// ── Database Migrations ──────────────────────────────────────
migrations.push(`
  CREATE TABLE IF NOT EXISTS sse_connections (
    id SERIAL PRIMARY KEY,
    user_email TEXT NOT NULL,
    tenant_id INTEGER,
    connected_at TIMESTAMPTZ DEFAULT NOW(),
    last_heartbeat TIMESTAMPTZ DEFAULT NOW(),
    ip_address TEXT,
    user_agent TEXT
  )`);
migrations.push(`
  CREATE TABLE IF NOT EXISTS live_activity (
    id SERIAL PRIMARY KEY,
    tenant_id INTEGER,
    user_email TEXT,
    action TEXT NOT NULL,
    target_type TEXT,
    target_id INTEGER,
    details TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`);
migrations.push(`
  CREATE TABLE IF NOT EXISTS user_presence (
    user_email TEXT NOT NULL,
    tenant_id INTEGER NOT NULL,
    last_seen TIMESTAMPTZ DEFAULT NOW(),
    status TEXT DEFAULT 'online',
    ip_address TEXT,
    PRIMARY KEY(user_email, tenant_id)
  )`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_sse_conn_tenant ON sse_connections(tenant_id)`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_sse_conn_email ON sse_connections(user_email)`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_live_activity_tenant ON live_activity(tenant_id, created_at DESC)`);
migrations.push(`CREATE INDEX IF NOT EXISTS idx_live_activity_created ON live_activity(created_at DESC)`);

['sse_connections', 'live_activity', 'user_presence'].forEach(t => VALID_TABLES.add(t));

// ── In-Memory Stores ─────────────────────────────────────────
const sseClients = new Map();        // connectionId -> { res, email, tenantId, heartbeatTimer, lastEventId }
let sseConnectionCounter = 0;

const typingState = new Map();       // room -> Map(email -> timeoutId)

const collabSessions = new Map();    // pageId -> Map(email -> { lastActive, data })

// ── Global Event Bus ─────────────────────────────────────────
const eventListeners = new Map();

global.eventBus = {
  on(event, callback) {
    if (!eventListeners.has(event)) eventListeners.set(event, new Set());
    eventListeners.get(event).add(callback);
  },
  off(event, callback) {
    const cbs = eventListeners.get(event);
    if (cbs) { cbs.delete(callback); if (cbs.size === 0) eventListeners.delete(event); }
  },
  emit(event, data) {
    const cbs = eventListeners.get(event);
    if (cbs) {
      try { cbs.forEach(cb => { try { cb(data); } catch (_) {} }); } catch (_) {}
    }
  }
};

// ── Helper: Broadcast SSE event to all tenant clients ────────
global.broadcastToTenant = function broadcastToTenant(tenantId, event, data) {
  let sent = 0;
  for (const [cid, client] of sseClients) {
    if (client.tenantId === tenantId && !client.res.writableEnded) {
      try {
        const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
        client.res.write(payload);
        sent++;
      } catch (_) {}
    }
  }
  return sent;
};

// ── Helper: Broadcast SSE event to a specific user ───────────
global.broadcastToUser = function broadcastToUser(email, event, data) {
  let sent = 0;
  for (const [cid, client] of sseClients) {
    if (client.email === email && !client.res.writableEnded) {
      try {
        client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        sent++;
      } catch (_) {}
    }
  }
  return sent;
};

// ── Helper: Broadcast to all connected clients ───────────────
global.broadcastToAll = function broadcastToAll(event, data) {
  let sent = 0;
  for (const [cid, client] of sseClients) {
    if (!client.res.writableEnded) {
      try {
        client.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
        sent++;
      } catch (_) {}
    }
  }
  return sent;
};

// ── Helper: Send SSE formatted data ──────────────────────────
function sseSend(res, event, data, id) {
  try {
    let msg = '';
    if (id) msg += `id: ${id}\n`;
    if (event) msg += `event: ${event}\ndata: `;
    else msg += `data: `;
    msg += JSON.stringify(data) + '\n\n';
    res.write(msg);
  } catch (_) {}
}

// ── Helper: relative time ────────────────────────────────────
function relTime(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr), now = new Date();
  const s = Math.floor((now - d) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  if (s < 604800) return Math.floor(s / 86400) + 'd ago';
  return d.toLocaleDateString();
}

// ══════════════════════════════════════════════════════════════
// 1. SSE NOTIFICATION STREAM
//    GET /api/sse/notifications
// ══════════════════════════════════════════════════════════════
app.get('/api/sse/notifications', async (req, res) => {
  if (!req.session?.user?.email) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  const userEmail = req.session.user.email;
  const tenantId = req.session.user.tenant_id;
  const lastEventId = parseInt(req.headers['last-event-id']) || 0;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Register client
  const connId = ++sseConnectionCounter;
  const client = { res, email: userEmail, tenantId, lastEventId };
  sseClients.set(connId, client);

  // Track in DB
  pool.query(
    `INSERT INTO sse_connections (user_email, tenant_id, ip_address, user_agent) VALUES ($1, $2, $3, $4)`,
    [userEmail, tenantId, req.ip, req.headers['user-agent'] || '']
  ).catch(() => {});

  // Send missed notifications since lastEventId
  if (lastEventId > 0) {
    try {
      const { rows } = await pool.query(
        `SELECT id, type, title, message, icon, priority, action_url, is_read, created_at
         FROM notifications WHERE id > $1 AND tenant_id = $2 AND user_id IN
           (SELECT id FROM users WHERE email = $3)
         ORDER BY id ASC LIMIT 50`,
        [lastEventId, tenantId, userEmail]
      );
      rows.forEach(n => sseSend(res, 'notification', n, n.id));
    } catch (_) {}
  }

  // Send initial online count
  const { rows: onlineRows } = await pool.query(
    `SELECT COUNT(*)::int AS cnt FROM user_presence WHERE tenant_id = $1 AND status = 'online'`,
    [tenantId]
  );
  sseSend(res, 'online-count', { count: onlineRows[0]?.cnt || 0 });

  // Heartbeat every 30s
  const heartbeatTimer = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
      pool.query(
        `UPDATE sse_connections SET last_heartbeat = NOW() WHERE user_email = $1 AND tenant_id = $2`,
        [userEmail, tenantId]
      ).catch(() => {});
    } catch (_) {
      clearInterval(heartbeatTimer);
      sseClients.delete(connId);
    }
  }, 30000);
  client.heartbeatTimer = heartbeatTimer;

  req.on('close', () => {
    clearInterval(heartbeatTimer);
    sseClients.delete(connId);
    pool.query(`DELETE FROM sse_connections WHERE user_email = $1 AND tenant_id = $2`, [userEmail, tenantId]).catch(() => {});
  });

  // Send connected confirmation
  sseSend(res, 'connected', { email: userEmail, tenantId, connId });
});

// ══════════════════════════════════════════════════════════════
// 2. LIVE ACTIVITY FEED
//    GET /api/sse/activity/:tenant_id — SSE stream
//    GET /live-feed — public activity page
//    GET /admin/live-feed — admin activity monitor
// ══════════════════════════════════════════════════════════════

// SSE stream for activity
app.get('/api/sse/activity/:tenant_id', async (req, res) => {
  const tenantId = parseInt(req.params.tenant_id);
  if (!tenantId || !req.session?.user) {
    return res.status(401).json({ error: 'Auth required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Send last 20 activities immediately
  try {
    const { rows } = await pool.query(
      `SELECT * FROM live_activity WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [tenantId]
    );
    rows.reverse().forEach(a => sseSend(res, 'activity', a));
  } catch (_) {}

  // Listen for new activity events on the bus
  const handler = (data) => {
    if (data.tenant_id === tenantId) {
      sseSend(res, 'activity', data);
    }
  };
  global.eventBus.on('live:activity', handler);

  // Heartbeat
  const hb = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch (_) { clearInterval(hb); }
  }, 30000);

  req.on('close', () => {
    clearInterval(hb);
    global.eventBus.off('live:activity', handler);
  });
});

// Public live feed page
app.get('/live-feed', ah(async (req, res) => {
  const tenantId = req.session?.user?.tenant_id;
  if (!tenantId) return res.redirect('/login');
  const { rows: activities } = await pool.query(
    `SELECT * FROM live_activity WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [tenantId]
  );
  const feedHTML = activities.map(a => `
    <div class="activity-item" data-id="${a.id}">
      <div class="activity-dot"></div>
      <div class="activity-body">
        <div class="activity-header">
          <strong>${esc(a.user_email || 'System')}</strong>
          <span class="activity-action">${esc(a.action)}</span>
          ${a.target_type ? `<span class="activity-target">${esc(a.target_type)}${a.target_id ? ' #' + a.target_id : ''}</span>` : ''}
        </div>
        ${a.details ? `<div class="activity-details">${esc(a.details)}</div>` : ''}
        <div class="activity-time">${relTime(a.created_at)}</div>
      </div>
    </div>
  `).join('');

  res.send(renderPage('Live Activity Feed', `
    <style>
      .feed-container { max-width: 640px; margin: 0 auto; }
      .feed-header { display: flex; align-items: center; gap: 12px; margin-bottom: 20px; }
      .live-dot { width: 12px; height: 12px; border-radius: 50%; background: #ef4444; animation: pulse-dot 1.5s infinite; }
      @keyframes pulse-dot { 0%,100%{ opacity:1; transform:scale(1); } 50%{ opacity:.6; transform:scale(1.2); } }
      .activity-list { display: flex; flex-direction: column; gap: 0; }
      .activity-item { display: flex; gap: 14px; padding: 14px 0; border-bottom: 1px solid #f1f5f9; animation: fadeSlideIn .3s ease; }
      .activity-dot { width: 10px; height: 10px; border-radius: 50%; background: #3b82f6; margin-top: 6px; flex-shrink: 0; }
      .activity-body { flex: 1; min-width: 0; }
      .activity-header { font-size: 14px; color: #1e293b; line-height: 1.4; }
      .activity-action { color: #6366f1; font-weight: 600; }
      .activity-target { color: #64748b; font-size: 12px; background: #f1f5f9; padding: 1px 8px; border-radius: 4px; margin-left: 6px; }
      .activity-details { font-size: 13px; color: #64748b; margin-top: 4px; }
      .activity-time { font-size: 11px; color: #94a3b8; margin-top: 4px; }
      @keyframes fadeSlideIn { from { opacity:0; transform:translateY(-8px); } to { opacity:1; transform:translateY(0); } }
      .empty-feed { text-align: center; padding: 60px 20px; color: #94a3b8; }
      .connection-status { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; padding: 4px 12px; border-radius: 20px; background: #dcfce7; color: #166534; }
    </style>
    <div class="feed-container">
      <div class="feed-header">
        <div class="live-dot"></div>
        <h2 style="margin: 0; font-size: 22px;">Live Activity Feed</h2>
        <span class="connection-status" id="conn-status">● Connected</span>
      </div>
      <div class="card" style="padding: 0; overflow: hidden;">
        <div class="activity-list" id="activity-list">
          ${feedHTML || '<div class="empty-feed"><div style="font-size:40px;margin-bottom:12px">📡</div><h3>No activity yet</h3><p>New events will appear here in real-time</p></div>'}
        </div>
      </div>
    </div>
    <script>
      const es = new EventSource('/api/sse/activity/${tenantId}');
      es.addEventListener('activity', function(e) {
        const a = JSON.parse(e.data);
        const list = document.getElementById('activity-list');
        const empty = list.querySelector('.empty-feed');
        if (empty) empty.remove();
        const div = document.createElement('div');
        div.className = 'activity-item';
        div.dataset.id = a.id;
        div.innerHTML = '<div class="activity-dot"></div><div class="activity-body">' +
          '<div class="activity-header"><strong>' + '${esc('')}' + (a.user_email || 'System').replace(/</g,'&lt;') + '</strong> ' +
          '<span class="activity-action">' + (a.action || '').replace(/</g,'&lt;') + '</span></div>' +
          (a.details ? '<div class="activity-details">' + a.details.replace(/</g,'&lt;') + '</div>' : '') +
          '</div>';
        list.insertBefore(div, list.firstChild);
        if (list.children.length > 50) list.removeChild(list.lastChild);
      });
      es.onerror = function() { document.getElementById('conn-status').innerHTML = '● Reconnecting...'; document.getElementById('conn-status').style.background='#fef3c7'; document.getElementById('conn-status').style.color='#92400e'; };
      es.onopen = function() { document.getElementById('conn-status').innerHTML = '● Connected'; document.getElementById('conn-status').style.background='#dcfce7'; document.getElementById('conn-status').style.color='#166534'; };
    </script>
  `, req.session.user, req));
}));

// Admin live feed monitor
app.get('/admin/live-feed', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  if (!['admin', 'superadmin'].includes((user.role || '').toLowerCase())) {
    return res.status(403).send(renderPage('Forbidden', '<div class="card"><p class="alert alert-error">Admin access required.</p></div>', user, req));
  }
  const tenantId = user.tenant_id;
  const { rows: activities } = await pool.query(
    `SELECT * FROM live_activity WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [tenantId]
  );
  const filterBtns = ['All', 'Login', 'Signup', 'Edit', 'Delete', 'Payment', 'Message'].map(f =>
    `<button class="filter-btn ${f === 'All' ? 'active' : ''}" data-filter="${f.toLowerCase()}" onclick="filterFeed(this)">${esc(f)}</button>`
  ).join('');

  const feedHTML = activities.map(a => {
    const actionColor = { login: '#10b981', signup: '#6366f1', edit: '#f59e0b', delete: '#ef4444', payment: '#14b8a6', message: '#3b82f6' }[a.action?.toLowerCase()] || '#64748b';
    return `
    <div class="activity-item admin" data-action="${(a.action || '').toLowerCase()}">
      <div class="activity-dot" style="background:${actionColor}"></div>
      <div class="activity-body">
        <div class="activity-header">
          <strong>${esc(a.user_email || 'System')}</strong>
          <span class="activity-badge" style="background:${actionColor}20;color:${actionColor}">${esc(a.action || '')}</span>
          ${a.target_type ? `<span class="activity-target">${esc(a.target_type)}${a.target_id ? ' #' + a.target_id : ''}</span>` : ''}
        </div>
        ${a.details ? `<div class="activity-details">${esc(a.details)}</div>` : ''}
        <div class="activity-time">${a.created_at ? new Date(a.created_at).toLocaleString() : ''}</div>
      </div>
    </div>`;
  }).join('');

  res.send(renderPage('Admin Live Feed', `
    <style>
      .admin-feed { max-width: 800px; margin: 0 auto; }
      .filter-bar { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 16px; }
      .filter-btn { padding: 6px 16px; border: 1px solid #e2e8f0; border-radius: 8px; background: #fff; font-size: 13px; cursor: pointer; transition: .15s; color: #475569; }
      .filter-btn:hover { background: #f1f5f9; }
      .filter-btn.active { background: #6366f1; color: #fff; border-color: #6366f1; }
      .live-dot { width: 12px; height: 12px; border-radius: 50%; background: #ef4444; animation: pulse-dot 1.5s infinite; display: inline-block; }
      @keyframes pulse-dot { 0%,100%{ opacity:1; transform:scale(1); } 50%{ opacity:.6; transform:scale(1.2); } }
      .activity-list { display: flex; flex-direction: column; }
      .activity-item.admin { display: flex; gap: 12px; padding: 12px 16px; border-bottom: 1px solid #f1f5f9; transition: background .15s; animation: fadeSlideIn .3s ease; }
      .activity-item.admin:hover { background: #f8fafc; }
      .activity-dot { width: 10px; height: 10px; border-radius: 50%; margin-top: 5px; flex-shrink: 0; }
      .activity-body { flex: 1; }
      .activity-header { font-size: 14px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
      .activity-badge { font-size: 11px; font-weight: 700; padding: 2px 10px; border-radius: 6px; text-transform: uppercase; letter-spacing: .5px; }
      .activity-target { font-size: 12px; color: #64748b; background: #f1f5f9; padding: 1px 8px; border-radius: 4px; }
      .activity-details { font-size: 13px; color: #64748b; margin-top: 3px; }
      .activity-time { font-size: 11px; color: #94a3b8; margin-top: 3px; }
      @keyframes fadeSlideIn { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:translateY(0); } }
      .empty-feed { text-align: center; padding: 60px 20px; color: #94a3b8; }
    </style>
    <div class="admin-feed">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
        <div class="live-dot"></div>
        <h2 style="margin:0;font-size:22px">Admin Live Feed</h2>
        <span style="font-size:13px;color:#64748b;background:#f1f5f9;padding:4px 12px;border-radius:20px">Real-time activity monitor</span>
      </div>
      <div class="filter-bar" id="filter-bar">
        ${filterBtns}
      </div>
      <div class="card" style="padding:0;overflow:hidden">
        <div class="activity-list" id="activity-list">
          ${feedHTML || '<div class="empty-feed"><div style="font-size:40px;margin-bottom:12px">📡</div><h3>No activity yet</h3></div>'}
        </div>
      </div>
    </div>
    <script>
      function filterFeed(btn) {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        const f = btn.dataset.filter;
        document.querySelectorAll('.activity-item.admin').forEach(item => {
          if (f === 'all') item.style.display = 'flex';
          else item.style.display = item.dataset.action === f ? 'flex' : 'none';
        });
      }
      const es = new EventSource('/api/sse/activity/${tenantId}');
      es.addEventListener('activity', function(e) {
        const a = JSON.parse(e.data);
        const list = document.getElementById('activity-list');
        const empty = list.querySelector('.empty-feed');
        if (empty) empty.remove();
        const color = {login:'#10b981',signup:'#6366f1',edit:'#f59e0b',delete:'#ef4444',payment:'#14b8a6',message:'#3b82f6'}[(a.action||'').toLowerCase()]||'#64748b';
        const div = document.createElement('div');
        div.className = 'activity-item admin';
        div.dataset.action = (a.action||'').toLowerCase();
        div.innerHTML = '<div class="activity-dot" style="background:'+color+'"></div><div class="activity-body">' +
          '<div class="activity-header"><strong>'+(a.user_email||'System').replace(/</g,'&lt;')+'</strong> ' +
          '<span class="activity-badge" style="background:'+color+'20;color:'+color+'">'+(a.action||'').replace(/</g,'&lt;')+'</span></div>' +
          (a.details ? '<div class="activity-details">'+a.details.replace(/</g,'&lt;')+'</div>' : '') + '</div>';
        list.insertBefore(div, list.firstChild);
        if (list.children.length > 100) list.removeChild(list.lastChild);
      });
    </script>
  `, user, req));
}));

// ══════════════════════════════════════════════════════════════
// 3. REAL-TIME PRESENCE (Who's Online)
//    POST /api/presence/heartbeat
//    GET  /api/presence/online
//    GET  /api/presence/status/:email
// ══════════════════════════════════════════════════════════════
app.post('/api/presence/heartbeat', ah(async (req, res) => {
  const user = req.session?.user;
  if (!user?.email) return res.status(401).json({ error: 'Auth required' });
  const tenantId = user.tenant_id;
  try {
    await pool.query(
      `INSERT INTO user_presence (user_email, tenant_id, last_seen, status, ip_address)
       VALUES ($1, $2, NOW(), 'online', $3)
       ON CONFLICT (user_email, tenant_id)
       DO UPDATE SET last_seen = NOW(), status = 'online', ip_address = $3`,
      [user.email, tenantId, req.ip]
    );
    // Broadcast updated online count to tenant
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM user_presence WHERE tenant_id = $1 AND status = 'online'`,
      [tenantId]
    );
    global.broadcastToTenant(tenantId, 'online-count', { count: rows[0]?.cnt || 0 });
    global.broadcastToTenant(tenantId, 'presence:update', { email: user.email, status: 'online' });
    res.json({ ok: true, online_count: rows[0]?.cnt || 0 });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}));

app.get('/api/presence/online', ah(async (req, res) => {
  const tenantId = req.session?.user?.tenant_id;
  if (!tenantId) return res.status(401).json({ error: 'Auth required' });
  const { rows } = await pool.query(
    `SELECT user_email, status, last_seen FROM user_presence
     WHERE tenant_id = $1 AND status IN ('online', 'away')
     ORDER BY last_seen DESC`,
    [tenantId]
  );
  // Enrich with user names
  const enriched = [];
  for (const r of rows) {
    try {
      const { rows: u } = await pool.query(
        `SELECT first_name, last_name, role, avatar_url FROM users WHERE email = $1 LIMIT 1`, [r.user_email]
      );
      enriched.push({
        email: r.user_email,
        name: u[0] ? `${u[0].first_name || ''} ${u[0].last_name || ''}`.trim() || r.user_email : r.user_email,
        role: u[0]?.role || '',
        avatar: u[0]?.avatar_url || '',
        status: r.status,
        last_seen: r.last_seen
      });
    } catch (_) {
      enriched.push({ email: r.user_email, status: r.status, last_seen: r.last_seen });
    }
  }
  res.json({ users: enriched });
}));

app.get('/api/presence/status/:email', ah(async (req, res) => {
  const email = req.params.email;
  const tenantId = req.session?.user?.tenant_id;
  if (!tenantId) return res.status(401).json({ error: 'Auth required' });
  const { rows } = await pool.query(
    `SELECT status, last_seen FROM user_presence WHERE user_email = $1 AND tenant_id = $2`,
    [email, tenantId]
  );
  if (rows.length === 0) return res.json({ email, status: 'offline', last_seen: null });
  res.json({ email, status: rows[0].status, last_seen: rows[0].last_seen });
}));

// ── Presence Cleanup Timer (every 3 min) ─────────────────────
setInterval(async () => {
  try {
    // Mark away after 3 min
    await pool.query(
      `UPDATE user_presence SET status = 'away' WHERE status = 'online' AND last_seen < NOW() - INTERVAL '3 minutes'`
    );
    // Mark offline after 10 min
    await pool.query(
      `DELETE FROM user_presence WHERE last_seen < NOW() - INTERVAL '10 minutes'`
    );
    // Broadcast updated counts to all active tenants
    const { rows: tenants } = await pool.query(
      `SELECT DISTINCT tenant_id FROM user_presence WHERE tenant_id IS NOT NULL`
    );
    for (const t of tenants) {
      const { rows: cnt } = await pool.query(
        `SELECT COUNT(*)::int AS online, (SELECT COUNT(*)::int FROM user_presence WHERE tenant_id = $1 AND status = 'away') AS away
         FROM user_presence WHERE tenant_id = $1 AND status = 'online'`,
        [t.tenant_id]
      );
      global.broadcastToTenant(t.tenant_id, 'online-count', {
        count: cnt[0]?.online || 0,
        away: cnt[0]?.away || 0
      });
    }
  } catch (_) {}
}, 3 * 60 * 1000);

// ══════════════════════════════════════════════════════════════
// 4. TYPING INDICATORS
//    POST /api/typing/start
//    POST /api/typing/stop
//    GET  /api/sse/typing/:room
// ══════════════════════════════════════════════════════════════
app.post('/api/typing/start', ah(async (req, res) => {
  const user = req.session?.user;
  if (!user?.email) return res.status(401).json({ error: 'Auth required' });
  const { room } = req.body;
  if (!room) return res.status(400).json({ error: 'Room required' });

  if (!typingState.has(room)) typingState.set(room, new Map());

  // Clear existing timeout for this user in this room
  const existing = typingState.get(room).get(user.email);
  if (existing) clearTimeout(existing);

  // Auto-stop after 4 seconds of inactivity
  const timer = setTimeout(() => {
    typingState.get(room)?.delete(user.email);
    global.broadcastToUser(user.email.replace(/.*$/, ''), 'typing:stop', { email: user.email, room });
    // Broadcast stop to room
    if (global.broadcastToTenant) {
      // Use event bus
      global.eventBus.emit('typing:stop', { email: user.email, room });
    }
  }, 4000);

  typingState.get(room).set(user.email, timer);
  global.eventBus.emit('typing:start', { email: user.email, room });
  res.json({ ok: true });
}));

app.post('/api/typing/stop', ah(async (req, res) => {
  const user = req.session?.user;
  if (!user?.email) return res.status(401).json({ error: 'Auth required' });
  const { room } = req.body;
  if (!room) return res.status(400).json({ error: 'Room required' });

  if (typingState.has(room)) {
    const timer = typingState.get(room).get(user.email);
    if (timer) clearTimeout(timer);
    typingState.get(room).delete(user.email);
  }
  global.eventBus.emit('typing:stop', { email: user.email, room });
  res.json({ ok: true });
}));

// SSE stream for typing indicators per room
app.get('/api/sse/typing/:room', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Auth required' });
  const room = req.params.room;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const startHandler = (data) => {
    if (data.room === room && data.email !== req.session.user.email) {
      sseSend(res, 'typing:start', data);
    }
  };
  const stopHandler = (data) => {
    if (data.room === room && data.email !== req.session.user.email) {
      sseSend(res, 'typing:stop', data);
    }
  };
  global.eventBus.on('typing:start', startHandler);
  global.eventBus.on('typing:stop', stopHandler);

  // Patch typing/start to also emit on eventBus
  // typing:start events emitted from POST route via eventBus

  const hb = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch (_) { clearInterval(hb); }
  }, 30000);

  req.on('close', () => {
    clearInterval(hb);
    global.eventBus.off('typing:start', startHandler);
    global.eventBus.off('typing:stop', stopHandler);
  });
});

// ══════════════════════════════════════════════════════════════
// 5. LIVE COLLABORATION EVENTS
//    POST /api/collaborate/broadcast
//    GET  /api/sse/collaborate/:page_id
// ══════════════════════════════════════════════════════════════
app.post('/api/collaborate/broadcast', ah(async (req, res) => {
  const user = req.session?.user;
  if (!user?.email) return res.status(401).json({ error: 'Auth required' });
  const { page_id, event_type, data } = req.body;
  if (!page_id || !event_type) return res.status(400).json({ error: 'page_id and event_type required' });

  const validEvents = ['cursor_move', 'selection_change', 'edit', 'comment', 'highlight'];
  if (!validEvents.includes(event_type)) return res.status(400).json({ error: 'Invalid event_type' });

  // Track collaboration session
  if (!collabSessions.has(page_id)) collabSessions.set(page_id, new Map());
  collabSessions.get(page_id).set(user.email, { lastActive: Date.now(), data });

  // Broadcast to all other users in the collaboration
  const payload = {
    page_id,
    event_type,
    email: user.email,
    data: data || {},
    timestamp: new Date().toISOString()
  };
  global.eventBus.emit('collab:' + page_id, payload);
  res.json({ ok: true, viewers: collabSessions.get(page_id).size });
}));

// SSE stream for collaboration events
app.get('/api/sse/collaborate/:page_id', async (req, res) => {
  if (!req.session?.user) return res.status(401).json({ error: 'Auth required' });
  const pageId = req.params.page_id;
  const userEmail = req.session.user.email;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Register in collaboration session
  if (!collabSessions.has(pageId)) collabSessions.set(pageId, new Map());
  collabSessions.get(pageId).set(userEmail, { lastActive: Date.now(), data: {} });

  // Notify others of new viewer
  global.eventBus.emit('collab:' + pageId, {
    page_id: pageId, event_type: 'viewer_join', email: userEmail,
    viewers: collabSessions.get(pageId).size,
    timestamp: new Date().toISOString()
  });

  const handler = (data) => {
    if (data.email !== userEmail) {
      sseSend(res, 'collab', data);
    }
  };
  global.eventBus.on('collab:' + pageId, handler);

  // Auto-expire collaboration after 30 min idle
  const idleTimer = setInterval(() => {
    const session = collabSessions.get(pageId)?.get(userEmail);
    if (session && Date.now() - session.lastActive > 30 * 60 * 1000) {
      clearInterval(idleTimer);
      collabSessions.get(pageId)?.delete(userEmail);
    }
  }, 60000);

  const hb = setInterval(() => {
    try {
      res.write(':heartbeat\n\n');
      const session = collabSessions.get(pageId)?.get(userEmail);
      if (session) session.lastActive = Date.now();
    } catch (_) { clearInterval(hb); clearInterval(idleTimer); }
  }, 30000);

  req.on('close', () => {
    clearInterval(hb);
    clearInterval(idleTimer);
    collabSessions.get(pageId)?.delete(userEmail);
    global.eventBus.off('collab:' + pageId, handler);
    global.eventBus.emit('collab:' + pageId, {
      page_id: pageId, event_type: 'viewer_leave', email: userEmail,
      viewers: collabSessions.get(pageId)?.size || 0,
      timestamp: new Date().toISOString()
    });
  });
});

// ══════════════════════════════════════════════════════════════
// 6. REAL-TIME STATS COUNTERS
//    GET /api/sse/stats/:tenant_id
//    GET /admin/realtime-dashboard
// ══════════════════════════════════════════════════════════════
app.get('/api/sse/stats/:tenant_id', async (req, res) => {
  const tenantId = parseInt(req.params.tenant_id);
  if (!tenantId || !req.session?.user) {
    return res.status(401).json({ error: 'Auth required' });
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  // Immediately send current stats
  try {
    const stats = await fetchTenantStats(tenantId);
    sseSend(res, 'stats', stats);
  } catch (_) {}

  // Push updates every 30 seconds
  const interval = setInterval(async () => {
    try {
      const stats = await fetchTenantStats(tenantId);
      sseSend(res, 'stats', stats);
    } catch (_) { clearInterval(interval); }
  }, 30000);

  const hb = setInterval(() => {
    try { res.write(':heartbeat\n\n'); } catch (_) { clearInterval(hb); clearInterval(interval); }
  }, 30000);

  req.on('close', () => { clearInterval(interval); clearInterval(hb); });
});

async function fetchTenantStats(tenantId) {
  try {
    const [users, signups, tasks, unread] = await Promise.all([
      pool.query(`SELECT COUNT(*) FILTER (WHERE last_login > NOW() - INTERVAL '1 hour')::int AS active FROM users WHERE tenant_id = $1`, [tenantId]),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM users WHERE tenant_id = $1 AND DATE(created_at) = CURRENT_DATE`, [tenantId]),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM tasks WHERE tenant_id = $1 AND status = 'pending'`).catch(() => ({ rows: [{ cnt: 0 }] })),
      pool.query(`SELECT COUNT(*)::int AS cnt FROM chat_messages cm JOIN chat_participants cp ON cp.conversation_id = cm.conversation_id WHERE cp.user_email IN (SELECT email FROM users WHERE tenant_id = $1) AND cm.is_read = false`).catch(() => ({ rows: [{ cnt: 0 }] })),
    ]);
    return {
      tenant_id: tenantId,
      active_users_now: users.rows[0]?.active || 0,
      signups_today: signups.rows[0]?.cnt || 0,
      pending_tasks: tasks.rows[0]?.cnt || 0,
      unread_messages: unread.rows[0]?.cnt || 0,
      timestamp: new Date().toISOString()
    };
  } catch (e) {
    return { tenant_id: tenantId, error: e.message, timestamp: new Date().toISOString() };
  }
}

// Admin real-time dashboard
app.get('/admin/realtime-dashboard', requireAuth, ah(async (req, res) => {
  const user = req.session.user;
  if (!['admin', 'superadmin'].includes((user.role || '').toLowerCase())) {
    return res.status(403).send(renderPage('Forbidden', '<div class="card"><p class="alert alert-error">Admin access required.</p></div>', user, req));
  }
  const tenantId = user.tenant_id;

  res.send(renderPage('Real-Time Dashboard', `
    <style>
      .rt-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
      .rt-card { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px 24px; position: relative; overflow: hidden; transition: box-shadow .2s; }
      .rt-card:hover { box-shadow: 0 4px 16px rgba(0,0,0,.06); }
      .rt-card .icon { font-size: 28px; margin-bottom: 8px; }
      .rt-card .value { font-size: 32px; font-weight: 800; color: #1e293b; line-height: 1; }
      .rt-card .label { font-size: 13px; color: #64748b; margin-top: 6px; }
      .rt-card .delta { font-size: 12px; font-weight: 600; margin-top: 4px; }
      .delta-up { color: #10b981; }
      .delta-down { color: #ef4444; }
      .rt-card .bg-accent { position: absolute; top: -10px; right: -10px; font-size: 80px; opacity: .06; }
      .live-badge { display: inline-flex; align-items: center; gap: 6px; background: #dcfce7; color: #166534; font-size: 12px; font-weight: 700; padding: 4px 14px; border-radius: 20px; }
      .live-badge .dot { width: 8px; height: 8px; border-radius: 50%; background: #10b981; animation: pulse-dot 1.5s infinite; }
      @keyframes pulse-dot { 0%,100%{ opacity:1; } 50%{ opacity:.4; } }
      .conn-info { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; margin-bottom: 24px; }
      .conn-panel { background: #fff; border: 1px solid #e2e8f0; border-radius: 14px; padding: 20px; }
      .conn-panel h3 { font-size: 15px; margin: 0 0 12px; color: #1e293b; }
      .conn-list { max-height: 240px; overflow-y: auto; }
      .conn-item { display: flex; align-items: center; gap: 10px; padding: 8px 0; border-bottom: 1px solid #f1f5f9; font-size: 13px; }
      .status-dot { width: 8px; height: 8px; border-radius: 50%; flex-shrink: 0; }
      .status-online { background: #10b981; }
      .status-away { background: #f59e0b; }
      @keyframes counterPop { 0%{ transform:scale(1); } 50%{ transform:scale(1.08); } 100%{ transform:scale(1); } }
      .counter-pop { animation: counterPop .3s ease; }
    </style>
    <div style="max-width:960px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
        <h2 style="margin:0;font-size:22px">Real-Time Dashboard</h2>
        <span class="live-badge"><span class="dot"></span> Live</span>
        <span id="update-time" style="font-size:12px;color:#94a3b8;margin-left:auto">Updated just now</span>
      </div>

      <div class="rt-grid">
        <div class="rt-card">
          <div class="bg-accent">👥</div>
          <div class="icon">🟢</div>
          <div class="value" id="stat-active">—</div>
          <div class="label">Active Users Now</div>
          <div class="delta delta-up" id="delta-active"></div>
        </div>
        <div class="rt-card">
          <div class="bg-accent">🆕</div>
          <div class="icon">📋</div>
          <div class="value" id="stat-signups">—</div>
          <div class="label">Signups Today</div>
        </div>
        <div class="rt-card">
          <div class="bg-accent">✅</div>
          <div class="icon">📝</div>
          <div class="value" id="stat-tasks">—</div>
          <div class="label">Pending Tasks</div>
        </div>
        <div class="rt-card">
          <div class="bg-accent">💬</div>
          <div class="icon">📨</div>
          <div class="value" id="stat-unread">—</div>
          <div class="label">Unread Messages</div>
        </div>
      </div>

      <div class="conn-info">
        <div class="conn-panel">
          <h3>📡 SSE Connections (<span id="sse-count">${sseClients.size}</span>)</h3>
          <div class="conn-list" id="sse-list">
            <div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px">Loading...</div>
          </div>
        </div>
        <div class="conn-panel">
          <h3>🌐 Online Presence</h3>
          <div class="conn-list" id="presence-list">
            <div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px">Loading...</div>
          </div>
        </div>
      </div>
    </div>
    <script>
      // SSE stats stream
      const es = new EventSource('/api/sse/stats/${tenantId}');
      es.addEventListener('stats', function(e) {
        const s = JSON.parse(e.data);
        animateCounter('stat-active', s.active_users_now || 0);
        animateCounter('stat-signups', s.signups_today || 0);
        animateCounter('stat-tasks', s.pending_tasks || 0);
        animateCounter('stat-unread', s.unread_messages || 0);
        document.getElementById('update-time').textContent = 'Updated ' + new Date().toLocaleTimeString();
      });

      // Presence SSE
      const pes = new EventSource('/api/sse/notifications');
      pes.addEventListener('online-count', function(e) {
        const d = JSON.parse(e.data);
        document.getElementById('delta-active').textContent = d.count + ' online';
      });
      pes.addEventListener('presence:update', function(e) {
        loadPresence();
      });

      function animateCounter(id, val) {
        const el = document.getElementById(id);
        el.textContent = val.toLocaleString();
        el.classList.remove('counter-pop');
        void el.offsetWidth;
        el.classList.add('counter-pop');
      }

      async function loadPresence() {
        try {
          const r = await fetch('/api/presence/online');
          const d = await r.json();
          const list = document.getElementById('presence-list');
          if (d.users.length === 0) {
            list.innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px">No one online</div>';
          } else {
            list.innerHTML = d.users.map(u =>
              '<div class="conn-item"><div class="status-dot status-'+u.status+'"></div>' +
              '<span>'+u.name.replace(/</g,'&lt;')+'</span>' +
              '<span style="color:#94a3b8;margin-left:auto;font-size:11px">'+u.status+'</span></div>'
            ).join('');
          }
        } catch(e) {}
      }

      async function loadSSE() {
        document.getElementById('sse-count').textContent = '...';
        try {
          const r = await fetch('/api/sse/stats/${tenantId}');
          // SSE connections are server-side only
          document.getElementById('sse-list').innerHTML = '<div style="text-align:center;padding:20px;color:#94a3b8;font-size:13px">See server logs for SSE connection details</div>';
        } catch(e) {}
      }

      loadPresence();
      loadSSE();
      setInterval(loadPresence, 30000);
    </script>
  `, user, req));
}));

// ══════════════════════════════════════════════════════════════
// 7. EVENT BUS — Inter-Module Communication & Integration
// ══════════════════════════════════════════════════════════════

// Helper: Log activity to live_activity table and broadcast
global.logActivity = async function logActivity(tenantId, userEmail, action, targetType, targetId, details) {
  try {
    const { rows } = await pool.query(
      `INSERT INTO live_activity (tenant_id, user_email, action, target_type, target_id, details)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [tenantId, userEmail, action, targetType, targetId, details]
    );
    if (rows[0]) {
      global.eventBus.emit('live:activity', rows[0]);
    }
  } catch (_) {}
};

// Hook into notification:new — broadcast via SSE
global.eventBus.on('notification:new', (data) => {
  if (data && data.tenant_id) {
    global.broadcastToTenant(data.tenant_id, 'notification', data);
  }
});

// Hook into message:new — broadcast via SSE
global.eventBus.on('message:new', (data) => {
  if (data && data.tenant_id) {
    global.broadcastToTenant(data.tenant_id, 'message', data);
  }
});

// Hook into payment events
global.eventBus.on('payment:received', (data) => {
  if (data && data.tenant_id) {
    global.broadcastToTenant(data.tenant_id, 'payment', data);
    global.logActivity(data.tenant_id, data.email || 'System', 'Payment', 'payment', data.id, data.amount || '');
  }
});

// Hook into content events
global.eventBus.on('content:published', (data) => {
  if (data && data.tenant_id) {
    global.broadcastToTenant(data.tenant_id, 'content', data);
    global.logActivity(data.tenant_id, data.email, 'Published', data.content_type || 'content', data.id, data.title || '');
  }
});

// Hook into user events
global.eventBus.on('user:login', (data) => {
  if (data && data.email) {
    global.logActivity(data.tenant_id || null, data.email, 'Login', 'user', data.user_id, `Logged in from ${data.ip || 'unknown'}`);
  }
});

global.eventBus.on('user:signup', (data) => {
  if (data && data.email) {
    global.logActivity(data.tenant_id || null, data.email, 'Signup', 'user', data.user_id, 'New account created');
  }
});

global.eventBus.on('referral:complete', (data) => {
  if (data && data.tenant_id) {
    global.logActivity(data.tenant_id, data.email, 'Referral', 'referral', data.id, data.referral_code || '');
  }
});

// ── SSE Connection Cleanup (every 5 min) ─────────────────────
setInterval(async () => {
  try {
    // Clean stale DB records
    await pool.query(`DELETE FROM sse_connections WHERE last_heartbeat < NOW() - INTERVAL '5 minutes'`);

    // Expire old activity (keep 30 days)
    await pool.query(`DELETE FROM live_activity WHERE created_at < NOW() - INTERVAL '30 days'`);

    // Clean up stale collaboration sessions
    const now = Date.now();
    for (const [pageId, sessions] of collabSessions) {
      for (const [email, session] of sessions) {
        if (now - session.lastActive > 30 * 60 * 1000) {
          sessions.delete(email);
        }
      }
      if (sessions.size === 0) collabSessions.delete(pageId);
    }

    // Clean up stale typing state
    for (const [room, users] of typingState) {
      if (users.size === 0) typingState.delete(room);
    }

    console.log(`[RealTime] Cleanup: ${sseClients.size} SSE clients, ${collabSessions.size} collab sessions, ${typingState.size} typing rooms active`);
  } catch (_) {}
}, 5 * 60 * 1000);

// ══════════════════════════════════════════════════════════════
// API: GET /api/realtime/status — System status for debugging
// ══════════════════════════════════════════════════════════════
app.get('/api/realtime/status', requireAuth, ah(async (req, res) => {
  const { rows: connCount } = await pool.query(`SELECT COUNT(*)::int AS cnt FROM sse_connections`);
  const { rows: presCount } = await pool.query(`SELECT COUNT(*) FILTER (WHERE status='online')::int AS online, COUNT(*) FILTER (WHERE status='away')::int AS away FROM user_presence`);
  res.json({
    sse_connections: sseClients.size,
    sse_connections_db: connCount[0]?.cnt || 0,
    collaboration_sessions: collabSessions.size,
    typing_rooms: typingState.size,
    event_listeners: eventListeners.size,
    presence_online: presCount[0]?.online || 0,
    presence_away: presCount[0]?.away || 0,
    uptime: process.uptime()
  });
}));

console.log('[RealTime] LOADED: SSE notification stream, live activity feed, presence tracking, typing indicators, collaboration events, live stats counters, event bus');
