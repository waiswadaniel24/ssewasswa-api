/**
 * Notification Center Module — SSEWASSWA Comfort Platform
 * Comprehensive notification inbox, preferences & announcements for multi-tenant SaaS.
 */
module.exports = function notificationCenter(app, db, pool, renderPage, esc) {

  // ── Middleware helpers ──────────────────────────────────────────────
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };
  const requireNotBanned = (req, res, next) => {
    if (req.session?.user?.banned) {
      return res.send(renderPage('Banned',
        '<div class="card"><div class="alert alert-error">Account banned</div><a href="/login" class="btn">Back</a></div>', null));
    }
    next();
  };
  const requireAdmin = (req, res, next) => {
    const role = (req.session?.user?.role || '').toLowerCase();
    if (!['admin', 'superadmin'].includes(role)) {
      return res.status(403).send(renderPage('Forbidden',
        '<div class="card"><div class="alert alert-error">Access denied. Admin privileges required.</div><a href="/notifications" class="btn">Back</a></div>',
        req.session.user, req));
    }
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ── Database migrations (run at module load) ───────────────────────
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notifications (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          type VARCHAR(50) DEFAULT 'info',
          title VARCHAR(255) NOT NULL,
          message TEXT,
          icon VARCHAR(10) DEFAULT '🔔',
          action_url TEXT,
          is_read BOOLEAN DEFAULT false,
          priority VARCHAR(20) DEFAULT 'normal',
          category VARCHAR(50),
          metadata JSONB DEFAULT '{}',
          expires_at TIMESTAMPTZ,
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS notification_preferences (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          category VARCHAR(50) NOT NULL,
          email_enabled BOOLEAN DEFAULT true,
          push_enabled BOOLEAN DEFAULT true,
          in_app_enabled BOOLEAN DEFAULT true,
          UNIQUE(tenant_id, user_id, category)
        );
      `);
      await pool.query(`
        CREATE TABLE IF NOT EXISTS announcements (
          id SERIAL PRIMARY KEY,
          tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          message TEXT NOT NULL,
          type VARCHAR(20) DEFAULT 'info',
          priority VARCHAR(20) DEFAULT 'normal',
          target_roles TEXT[] DEFAULT '{}',
          is_active BOOLEAN DEFAULT true,
          dismissible BOOLEAN DEFAULT true,
          starts_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ,
          created_by INTEGER REFERENCES users(id),
          created_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);

      // ── Ensure all columns exist (safe for re-deploys) ────────────
      const notifCols = [
        'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
        'user_id INTEGER REFERENCES users(id) ON DELETE CASCADE',
        'type VARCHAR(50) DEFAULT \'info\'',
        'title VARCHAR(255) NOT NULL',
        'message TEXT',
        'icon VARCHAR(10) DEFAULT \'🔔\'',
        'action_url TEXT',
        'is_read BOOLEAN DEFAULT false',
        'priority VARCHAR(20) DEFAULT \'normal\'',
        'category VARCHAR(50)',
        'metadata JSONB DEFAULT \'{}\'',
        'expires_at TIMESTAMPTZ',
        'created_at TIMESTAMPTZ DEFAULT NOW()',
      ];
      for (const col of notifCols) {
        const colName = col.split(' ')[0];
        await pool.query(`ALTER TABLE notifications ADD COLUMN IF NOT EXISTS ${col};`).catch(() => {});
      }

      const prefCols = [
        'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
        'user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE',
        'category VARCHAR(50) NOT NULL',
        'email_enabled BOOLEAN DEFAULT true',
        'push_enabled BOOLEAN DEFAULT true',
        'in_app_enabled BOOLEAN DEFAULT true',
      ];
      for (const col of prefCols) {
        await pool.query(`ALTER TABLE notification_preferences ADD COLUMN IF NOT EXISTS ${col};`).catch(() => {});
      }

      const annCols = [
        'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
        'title VARCHAR(255) NOT NULL',
        'message TEXT NOT NULL',
        'type VARCHAR(20) DEFAULT \'info\'',
        'priority VARCHAR(20) DEFAULT \'normal\'',
        'target_roles TEXT[] DEFAULT \'{}\'',
        'is_active BOOLEAN DEFAULT true',
        'dismissible BOOLEAN DEFAULT true',
        'starts_at TIMESTAMPTZ DEFAULT NOW()',
        'expires_at TIMESTAMPTZ',
        'created_by INTEGER REFERENCES users(id)',
        'created_at TIMESTAMPTZ DEFAULT NOW()',
      ];
      for (const col of annCols) {
        await pool.query(`ALTER TABLE announcements ADD COLUMN IF NOT EXISTS ${col};`).catch(() => {});
      }

      // ── Indexes ────────────────────────────────────────────────────
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_tenant ON notifications(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_notifications_tenant_user ON notifications(tenant_id, user_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_notification_prefs_tenant ON notification_preferences(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_notification_prefs_user ON notification_preferences(user_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_announcements_tenant ON announcements(tenant_id);`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_announcements_active ON announcements(tenant_id, is_active);`);

      console.log('[NotificationCenter] Database migrations complete');
    } catch (err) {
      console.error('[NotificationCenter] Migration error:', err.message);
    }
  })();

  // ── UI helpers ─────────────────────────────────────────────────────
  function navBar(active) {
    return `
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <a href="/notifications" class="btn btn-sm ${active === 'inbox' ? 'active' : ''}">📥 Inbox</a>
        <a href="/notifications/preferences" class="btn btn-sm ${active === 'prefs' ? 'active' : ''}">⚙️ Preferences</a>
        <a href="/announcements" class="btn btn-sm ${active === 'announcements' ? 'active' : ''}">📢 Announcements</a>
      </div>`;
  }

  function typeBadge(type) {
    const map = {
      info:    '<span class="badge badge-info">Info</span>',
      success: '<span class="badge badge-success">Success</span>',
      warning: '<span class="badge badge-warning">Warning</span>',
      error:   '<span class="badge badge-error">Error</span>',
      system:  '<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:#7c3aed;color:#fff">System</span>',
    };
    return map[type] || `<span class="badge">${esc(type)}</span>`;
  }

  function priorityBadge(priority) {
    const map = {
      low:    '<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:#e5e7eb;color:#6b7280">Low</span>',
      normal: '<span class="badge badge-info">Normal</span>',
      high:   '<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:#f97316;color:#fff">High</span>',
      urgent: '<span class="badge badge-error" style="animation:pulse 1.5s infinite">Urgent</span>',
    };
    return map[priority] || `<span class="badge">${esc(priority)}</span>`;
  }

  function typeColor(type) {
    const map = { info: '#3b82f6', success: '#16a34a', warning: '#f59e0b', error: '#ef4444', system: '#7c3aed' };
    return map[type] || '#6b7280';
  }

  function priorityDot(priority) {
    const map = { low: '#9ca3af', normal: '#3b82f6', high: '#f97316', urgent: '#ef4444' };
    return map[priority] || '#9ca3af';
  }

  function relativeTime(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    const now = new Date();
    const diff = Math.floor((now - d) / 1000);
    if (diff < 60) return 'Just now';
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
    if (diff < 604800) return `${Math.floor(diff / 86400)}d ago`;
    return d.toLocaleDateString();
  }

  function formatDateTime(dateStr) {
    if (!dateStr) return '—';
    const d = new Date(dateStr);
    return d.toLocaleString();
  }

  // ── Pulse animation CSS ────────────────────────────────────────────
  const pulseCSS = `
    <style>
      @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.5} }
      .notif-item { transition: background .15s, box-shadow .15s; border-radius: 12px; }
      .notif-item:hover { box-shadow: 0 2px 8px rgba(0,0,0,.08); }
      .notif-unread { border-left: 4px solid #3b82f6; background: #eff6ff; }
      .notif-read { border-left: 4px solid transparent; background: #fff; }
      .filter-bar { display:flex; gap:10px; flex-wrap:wrap; align-items:center; margin-bottom:16px; }
      .filter-bar select, .filter-bar input {
        padding:8px 12px; border:1px solid #d1d5db; border-radius:8px; font-size:14px;
        background:#fff; color:#374151; outline:none;
      }
      .filter-bar select:focus, .filter-bar input:focus { border-color:#3b82f6; box-shadow:0 0 0 2px rgba(59,130,246,.15); }
      .batch-bar { display:flex; gap:8px; align-items:center; margin-bottom:16px; padding:10px 16px;
        background:#f8fafc; border:1px solid #e2e8f0; border-radius:10px; }
      .notif-empty { text-align:center; padding:60px 20px; color:#9ca3af; }
      .notif-empty svg { width:64px; height:64px; margin-bottom:16px; opacity:.4; }
      .ann-card { border:1px solid #e5e7eb; border-radius:12px; padding:20px; margin-bottom:12px;
        background:#fff; transition:box-shadow .15s; }
      .ann-card:hover { box-shadow:0 4px 12px rgba(0,0,0,.06); }
      .pref-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:16px; }
      .pref-card { border:1px solid #e5e7eb; border-radius:12px; padding:20px; background:#fff; }
      .pref-card h4 { margin:0 0 12px; font-size:16px; }
      .pref-toggle { display:flex; align-items:center; gap:8px; margin:8px 0; font-size:14px; }
      .pref-toggle input[type="checkbox"] { width:18px; height:18px; accent-color:#3b82f6; }
      .stat-cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(180px,1fr)); gap:14px; margin-bottom:20px; }
      .stat-card { background:#fff; border:1px solid #e5e7eb; border-radius:12px; padding:16px 20px; text-align:center; }
      .stat-card .stat-num { font-size:28px; font-weight:700; color:#1f2937; }
      .stat-card .stat-label { font-size:13px; color:#6b7280; margin-top:4px; }
      .active-toggle { display:inline-flex; align-items:center; gap:6px; cursor:pointer; padding:4px 12px;
        border-radius:20px; font-size:13px; font-weight:600; transition:all .15s; border:none; }
      .active-on { background:#dcfce7; color:#16a34a; }
      .active-off { background:#fee2e2; color:#dc2626; }
    </style>`;

  // ══════════════════════════════════════════════════════════════════
  // 1. GET /notifications — Notification inbox
  // ══════════════════════════════════════════════════════════════════
  app.get('/notifications', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tenantId = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const { type, priority, status, page = 1, q } = req.query;
    const limit = 25;
    const offset = (parseInt(page) - 1) * limit;

    let where = ['n.tenant_id = $1', 'n.user_id = $2', '(n.expires_at IS NULL OR n.expires_at > NOW())'];
    let params = [tenantId, userId];
    let idx = 3;

    if (type && type !== 'all') { where.push(`n.type = $${idx++}`); params.push(type); }
    if (priority && priority !== 'all') { where.push(`n.priority = $${idx++}`); params.push(priority); }
    if (status === 'unread') { where.push('n.is_read = false'); }
    else if (status === 'read') { where.push('n.is_read = true'); }
    if (q) { where.push(`(n.title ILIKE $${idx} OR n.message ILIKE $${idx})`); params.push(`%${q}%`); idx++; }

    const whereClause = where.join(' AND ');

    const [countRes, notifsRes] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM notifications n WHERE ${whereClause}`, params),
      pool.query(`SELECT n.*, u.first_name, u.last_name
        FROM notifications n LEFT JOIN users u ON u.id = n.user_id
        WHERE ${whereClause} ORDER BY
          CASE n.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
          n.created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`,
        [...params, limit, offset]),
    ]);

    const total = countRes.rows[0]?.total || 0;
    const notifications = notifsRes.rows;
    const totalPages = Math.ceil(total / limit);

    // Stats
    const statsRes = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE NOT is_read) AS unread,
        COUNT(*) FILTER (WHERE type = 'error') AS errors,
        COUNT(*) FILTER (WHERE priority = 'urgent') AS urgent,
        COUNT(*) FILTER (WHERE is_read) AS read_count,
        COUNT(*) AS total
      FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND (expires_at IS NULL OR expires_at > NOW())`,
      [tenantId, userId]);
    const stats = statsRes.rows[0];

    const paginationHTML = totalPages > 1 ? `
      <div style="display:flex;justify-content:center;gap:6px;margin-top:20px">
        ${Array.from({ length: totalPages }, (_, i) => {
          const p = i + 1;
          const cls = p === parseInt(page) ? 'btn btn-sm active' : 'btn btn-sm';
          return `<a href="/notifications?page=${p}&type=${type || ''}&priority=${priority || ''}&status=${status || ''}&q=${q || ''}" class="${cls}">${p}</a>`;
        }).join('')}
      </div>` : '';

    const notifRows = notifications.length === 0
      ? `<div class="notif-empty">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/></svg>
           <h3 style="margin:0 0 8px;color:#6b7280">No notifications</h3>
           <p class="muted">You're all caught up! New notifications will appear here.</p>
         </div>`
      : notifications.map(n => `
        <div class="notif-item ${n.is_read ? 'notif-read' : 'notif-unread'}" style="padding:14px 18px;margin-bottom:6px;border:1px solid #e5e7eb">
          <div style="display:flex;align-items:flex-start;gap:14px">
            <div style="font-size:24px;flex-shrink:0;margin-top:2px">${esc(n.icon || '🔔')}</div>
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:4px">
                <strong style="font-size:15px;color:#1f2937">${esc(n.title)}</strong>
                ${typeBadge(n.type)}
                ${priorityBadge(n.priority)}
                ${!n.is_read ? '<span style="width:8px;height:8px;border-radius:50%;background:#3b82f6;display:inline-block"></span>' : ''}
              </div>
              ${n.message ? `<p style="margin:4px 0 8px;font-size:14px;color:#6b7280;line-height:1.5">${esc(n.message).substring(0, 200)}${n.message.length > 200 ? '...' : ''}</p>` : ''}
              <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
                <span class="muted" style="font-size:12px">${relativeTime(n.created_at)}</span>
                ${n.category ? `<span class="muted" style="font-size:12px">· ${esc(n.category)}</span>` : ''}
                <div style="margin-left:auto;display:flex;gap:6px">
                  ${n.action_url ? `<a href="${esc(n.action_url)}" class="btn btn-sm btn-blue">View</a>` : ''}
                  ${!n.is_read ? `<button onclick="fetch('/notifications/${n.id}/read',{method:'POST'}).then(()=>location.reload())" class="btn btn-sm">✓ Read</button>` : ''}
                  <button onclick="fetch('/notifications/${n.id}/dismiss',{method:'POST'}).then(()=>location.reload())" class="btn btn-sm btn-gold">Dismiss</button>
                  <button onclick="if(confirm('Delete this notification?'))fetch('/notifications/${n.id}',{method:'DELETE'}).then(()=>location.reload())" class="btn btn-sm btn-red">🗑</button>
                </div>
              </div>
            </div>
          </div>
        </div>`).join('');

    const content = `
      ${pulseCSS}
      ${navBar('inbox')}
      <h2 style="margin:0 0 6px">📥 Notification Inbox</h2>
      <p class="muted" style="margin-bottom:16px">Manage your notifications and stay up to date</p>

      <div class="stat-cards">
        <div class="stat-card">
          <div class="stat-num" style="color:#3b82f6">${stats.total || 0}</div>
          <div class="stat-label">Total</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:#f97316">${stats.unread || 0}</div>
          <div class="stat-label">Unread</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:#16a34a">${stats.read_count || 0}</div>
          <div class="stat-label">Read</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:#ef4444">${stats.urgent || 0}</div>
          <div class="stat-label">Urgent</div>
        </div>
        <div class="stat-card">
          <div class="stat-num" style="color:#dc2626">${stats.errors || 0}</div>
          <div class="stat-label">Errors</div>
        </div>
      </div>

      <div class="card">
        <div class="filter-bar">
          <input type="text" name="q" value="${esc(q || '')}" placeholder="Search notifications…"
            style="flex:1;min-width:200px">
          <select name="type">
            <option value="all" ${!type || type === 'all' ? 'selected' : ''}>All Types</option>
            <option value="info" ${type === 'info' ? 'selected' : ''}>Info</option>
            <option value="success" ${type === 'success' ? 'selected' : ''}>Success</option>
            <option value="warning" ${type === 'warning' ? 'selected' : ''}>Warning</option>
            <option value="error" ${type === 'error' ? 'selected' : ''}>Error</option>
            <option value="system" ${type === 'system' ? 'selected' : ''}>System</option>
          </select>
          <select name="priority">
            <option value="all" ${!priority || priority === 'all' ? 'selected' : ''}>All Priorities</option>
            <option value="low" ${priority === 'low' ? 'selected' : ''}>Low</option>
            <option value="normal" ${priority === 'normal' ? 'selected' : ''}>Normal</option>
            <option value="high" ${priority === 'high' ? 'selected' : ''}>High</option>
            <option value="urgent" ${priority === 'urgent' ? 'selected' : ''}>Urgent</option>
          </select>
          <select name="status">
            <option value="all" ${!status || status === 'all' ? 'selected' : ''}>All</option>
            <option value="unread" ${status === 'unread' ? 'selected' : ''}>Unread</option>
            <option value="read" ${status === 'read' ? 'selected' : ''}>Read</option>
          </select>
          <button onclick="const p=new URLSearchParams(location.search);['type','priority','status','q'].forEach(k=>{const s=document.querySelector('[name='+k+']');if(s)p.set(k,s.value);else p.delete(k)});location.href='/notifications?'+p"
            class="btn btn-sm btn-blue">Filter</button>
          <a href="/notifications" class="btn btn-sm">Clear</a>
        </div>

        <div class="batch-bar">
          <button onclick="fetch('/notifications/mark-all-read',{method:'POST'}).then(()=>location.reload())"
            class="btn btn-sm btn-green">✓ Mark All Read</button>
          <button onclick="if(confirm('Delete all read notifications?'))fetch('/notifications?bulk=delete-read',{method:'DELETE'}).then(()=>location.reload())"
            class="btn btn-sm btn-red">🗑 Delete All Read</button>
          <span class="muted" style="margin-left:auto;font-size:13px">Showing ${notifications.length} of ${total}</span>
        </div>

        ${notifRows}
        ${paginationHTML}
      </div>

      <script>
        // Auto-submit filter on Enter in search box
        document.querySelector('[name=q]')?.addEventListener('keydown', e => {
          if (e.key === 'Enter') e.target.closest('.filter-bar').querySelector('.btn-blue').click();
        });
      </script>`;

    res.send(renderPage('Notifications', content, req.session.user, req));
  }));

  // Bulk delete route (DELETE with query param)
  app.delete('/notifications', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tenantId = req.session.user.tenant_id;
    const userId = req.session.user.id;

    if (req.query.bulk === 'delete-read') {
      await pool.query(
        `DELETE FROM notifications WHERE tenant_id = $1 AND user_id = $2 AND is_read = true`,
        [tenantId, userId]);
    }
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════════════════════════
  // 2. GET /notifications/unread-count — JSON badge count
  // ══════════════════════════════════════════════════════════════════
  app.get('/notifications/unread-count', requireAuth, ah(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM notifications
        WHERE tenant_id = $1 AND user_id = $2 AND NOT is_read
        AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.session.user.tenant_id, req.session.user.id]);
    res.json({ count: rows[0]?.count || 0 });
  }));

  // ══════════════════════════════════════════════════════════════════
  // 3. POST /notifications/:id/read — Mark single as read
  // ══════════════════════════════════════════════════════════════════
  app.post('/notifications/:id/read', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query(
      `UPDATE notifications SET is_read = true WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
      [id, req.session.user.tenant_id, req.session.user.id]);
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════════════════════════
  // 4. POST /notifications/mark-all-read — Mark all as read
  // ══════════════════════════════════════════════════════════════════
  app.post('/notifications/mark-all-read', requireAuth, ah(async (req, res) => {
    await pool.query(
      `UPDATE notifications SET is_read = true
        WHERE tenant_id = $1 AND user_id = $2 AND NOT is_read
        AND (expires_at IS NULL OR expires_at > NOW())`,
      [req.session.user.tenant_id, req.session.user.id]);
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════════════════════════
  // 5. DELETE /notifications/:id — Delete notification
  // ══════════════════════════════════════════════════════════════════
  app.delete('/notifications/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query(
      `DELETE FROM notifications WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
      [id, req.session.user.tenant_id, req.session.user.id]);
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════════════════════════
  // 6. POST /notifications/:id/dismiss — Dismiss notification
  // ══════════════════════════════════════════════════════════════════
  app.post('/notifications/:id/dismiss', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query(
      `UPDATE notifications SET is_read = true, expires_at = NOW() WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
      [id, req.session.user.tenant_id, req.session.user.id]);
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════════════════════════
  // 7. GET /notifications/preferences — User notification preferences
  // ══════════════════════════════════════════════════════════════════
  app.get('/notifications/preferences', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tenantId = req.session.user.tenant_id;
    const userId = req.session.user.id;

    // Default categories
    const defaultCategories = [
      { key: 'general',   label: 'General Updates',   icon: '📬', desc: 'Platform updates and news' },
      { key: 'security',  label: 'Security Alerts',   icon: '🔒', desc: 'Login alerts, password changes, suspicious activity' },
      { key: 'billing',   label: 'Billing & Payments', icon: '💳', desc: 'Invoices, receipts, payment confirmations' },
      { key: 'bookings',  label: 'Bookings',          icon: '📅', desc: 'Booking confirmations, reminders, cancellations' },
      { key: 'messages',  label: 'Messages',          icon: '💬', desc: 'New messages and conversation updates' },
      { key: 'marketing', label: 'Marketing & Promos', icon: '📣', desc: 'Special offers, newsletters, and promotions' },
      { key: 'system',    label: 'System Maintenance',icon: '🔧', desc: 'Scheduled maintenance and system downtime' },
      { key: 'reports',   label: 'Reports & Analytics',icon: '📊', desc: 'Weekly/monthly reports and analytics summaries' },
    ];

    const { rows } = await pool.query(
      `SELECT * FROM notification_preferences WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId]);
    const prefsMap = {};
    rows.forEach(r => { prefsMap[r.category] = r; });

    const prefCards = defaultCategories.map(cat => {
      const pref = prefsMap[cat.key] || { email_enabled: true, push_enabled: true, in_app_enabled: true };
      return `
        <div class="pref-card">
          <h4>${cat.icon} ${esc(cat.label)}</h4>
          <p class="muted" style="font-size:13px;margin-bottom:12px">${esc(cat.desc)}</p>
          <input type="hidden" name="categories" value="${esc(cat.key)}">
          <div class="pref-toggle">
            <input type="checkbox" name="email_${cat.key}" ${pref.email_enabled ? 'checked' : ''}>
            <label for="email_${cat.key}">📧 Email</label>
          </div>
          <div class="pref-toggle">
            <input type="checkbox" name="push_${cat.key}" ${pref.push_enabled ? 'checked' : ''}>
            <label for="push_${cat.key}">🔔 Push</label>
          </div>
          <div class="pref-toggle">
            <input type="checkbox" name="inapp_${cat.key}" ${pref.in_app_enabled ? 'checked' : ''}>
            <label for="inapp_${cat.key}">📱 In-App</label>
          </div>
        </div>`;
    }).join('');

    const content = `
      ${pulseCSS}
      ${navBar('prefs')}
      <h2 style="margin:0 0 6px">⚙️ Notification Preferences</h2>
      <p class="muted" style="margin-bottom:20px">Choose how and when you want to be notified</p>

      <form method="POST" action="/notifications/preferences/save">
        <div class="pref-grid">
          ${prefCards}
        </div>
        <div style="margin-top:20px;display:flex;gap:10px">
          <button type="submit" class="btn btn-green">💾 Save Preferences</button>
          <button type="button" onclick="document.querySelectorAll('.pref-card input[type=checkbox]').forEach(cb=>cb.checked=true)"
            class="btn btn-sm">Enable All</button>
          <button type="button" onclick="document.querySelectorAll('.pref-card input[type=checkbox]').forEach(cb=>cb.checked=false)"
            class="btn btn-sm btn-red">Disable All</button>
        </div>
      </form>`;

    res.send(renderPage('Notification Preferences', content, req.session.user, req));
  }));

  // ══════════════════════════════════════════════════════════════════
  // 8. POST /notifications/preferences/save — Save preferences
  // ══════════════════════════════════════════════════════════════════
  app.post('/notifications/preferences/save', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tenantId = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const body = req.body;

    // Collect all category keys from hidden fields
    let categories = body.categories;
    if (!Array.isArray(categories)) categories = categories ? [categories] : [];

    for (const cat of categories) {
      const emailEnabled = body['email_' + cat] === 'on';
      const pushEnabled = body['push_' + cat] === 'on';
      const inAppEnabled = body['inapp_' + cat] === 'on';

      await pool.query(`
        INSERT INTO notification_preferences (tenant_id, user_id, category, email_enabled, push_enabled, in_app_enabled)
        VALUES ($1, $2, $3, $4, $5, $6)
        ON CONFLICT (tenant_id, user_id, category)
        DO UPDATE SET email_enabled = $4, push_enabled = $5, in_app_enabled = $6`,
        [tenantId, userId, cat, emailEnabled, pushEnabled, inAppEnabled]);
    }

    res.redirect('/notifications/preferences');
  }));

  // ══════════════════════════════════════════════════════════════════
  // 9. GET /announcements — Announcement management (admin)
  // ══════════════════════════════════════════════════════════════════
  app.get('/announcements', requireAuth, requireNotBanned, ah(async (req, res) => {
    const tenantId = req.session.user.tenant_id;
    const user = req.session.user;
    const isAdmin = ['admin', 'superadmin'].includes((user.role || '').toLowerCase());

    // Everyone can view active announcements; only admins see the management UI
    const { rows: announcements } = await pool.query(`
      SELECT a.*, u.first_name AS creator_first, u.last_name AS creator_last
      FROM announcements a
      LEFT JOIN users u ON u.id = a.created_by
      WHERE a.tenant_id = $1
        AND (a.is_active = true OR $2 = true)
        AND (a.starts_at IS NULL OR a.starts_at <= NOW())
        AND (a.expires_at IS NULL OR a.expires_at > NOW())
      ORDER BY
        CASE a.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        a.created_at DESC`,
      [tenantId, isAdmin]);

    // Active announcements banner (shown to all users at the top)
    const activeBanner = announcements.filter(a => a.is_active && a.target_roles.length === 0).length === 0
      ? ''
      : `<div class="alert alert-warning" style="margin-bottom:16px">
          📢 <strong>${announcements.filter(a => a.is_active).length} active announcement(s)</strong> —
          Review important updates below.
        </div>`;

    const annList = announcements.length === 0
      ? `<div class="notif-empty">
           <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M11 5.882V19.24a1.76 1.76 0 0 1-3.417.592l-2.147-6.15M18 13a3 3 0 1 0 0-6M5.436 13.683A4.001 4.001 0 0 1 7 6h1.832c4.1 0 7.625-1.234 9.168-3v14c-1.543-1.766-5.067-3-9.168-3H7a3.988 3.988 0 0 1-1.564-.317z"/></svg>
           <h3 style="margin:0 0 8px;color:#6b7280">No announcements</h3>
           <p class="muted">${isAdmin ? 'Create your first announcement to keep your team informed.' : 'No announcements at this time.'}</p>
         </div>`
      : announcements.map(a => `
        <div class="ann-card" style="border-left:4px solid ${typeColor(a.type)}">
          <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
                <strong style="font-size:16px;color:#1f2937">${esc(a.title)}</strong>
                ${typeBadge(a.type)}
                ${priorityBadge(a.priority)}
                <span class="${a.is_active ? 'badge badge-success' : 'badge badge-error'}">${a.is_active ? 'Active' : 'Inactive'}</span>
              </div>
              <div style="font-size:14px;color:#4b5563;line-height:1.6;white-space:pre-wrap">${esc(a.message)}</div>
              <div style="margin-top:10px;display:flex;gap:16px;flex-wrap:wrap;font-size:12px" class="muted">
                <span>📅 ${formatDateTime(a.starts_at)}</span>
                ${a.expires_at ? `<span>⏰ Expires: ${formatDateTime(a.expires_at)}</span>` : ''}
                ${a.creator_first ? `<span>👤 By ${esc(a.creator_first)} ${esc(a.creator_last)}</span>` : ''}
                ${a.target_roles.length > 0 ? `<span>🎯 Roles: ${a.target_roles.map(r => esc(r)).join(', ')}</span>` : '<span>🎯 All Roles</span>'}
                ${a.dismissible ? '<span>✓ Dismissible</span>' : ''}
              </div>
            </div>
            ${isAdmin ? `
              <div style="display:flex;gap:6px;flex-shrink:0">
                <a href="/announcements/${a.id}/toggle" class="btn btn-sm ${a.is_active ? 'btn-gold' : 'btn-green'}">
                  ${a.is_active ? '⏸ Deactivate' : '▶ Activate'}
                </a>
                <button onclick="if(confirm('Delete this announcement permanently?'))fetch('/announcements/${a.id}',{method:'DELETE'}).then(()=>location.reload())"
                  class="btn btn-sm btn-red">🗑</button>
              </div>` : ''}
          </div>
        </div>`).join('');

    // Admin-only creation form
    const createForm = isAdmin ? `
      <div class="card" style="margin-top:20px">
        <h3 style="margin:0 0 16px">📝 Create New Announcement</h3>
        <form method="POST" action="/announcements/create" style="display:grid;gap:14px">
          <div>
            <label style="display:block;font-size:14px;font-weight:600;margin-bottom:4px">Title</label>
            <input type="text" name="title" required placeholder="Announcement title…"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box">
          </div>
          <div>
            <label style="display:block;font-size:14px;font-weight:600;margin-bottom:4px">Message</label>
            <textarea name="message" required rows="4" placeholder="Announcement message…"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;resize:vertical"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px">
            <div>
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:4px">Type</label>
              <select name="type" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px">
                <option value="info">Info</option>
                <option value="success">Success</option>
                <option value="warning">Warning</option>
                <option value="error">Error</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:4px">Priority</label>
              <select name="priority" style="width:100%;padding:10px;border:1px solid #d1d5db;border-radius:8px;font-size:14px">
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
            <div>
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:4px">Target Roles (comma-separated)</label>
              <input type="text" name="target_roles" placeholder="e.g. admin, staff (empty = all)"
                style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box">
            </div>
            <div>
              <label style="display:block;font-size:14px;font-weight:600;margin-bottom:4px">Expires At</label>
              <input type="datetime-local" name="expires_at"
                style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box">
            </div>
          </div>
          <div style="display:flex;align-items:center;gap:16px">
            <label class="pref-toggle"><input type="checkbox" name="dismissible" checked> Users can dismiss</label>
          </div>
          <button type="submit" class="btn btn-green" style="width:fit-content">📢 Publish Announcement</button>
        </form>
      </div>` : '';

    const content = `
      ${pulseCSS}
      ${navBar('announcements')}
      <h2 style="margin:0 0 6px">📢 Announcements</h2>
      <p class="muted" style="margin-bottom:16px">${isAdmin ? 'Manage platform-wide announcements for your organization' : 'Stay informed with the latest platform updates'}</p>
      ${activeBanner}
      ${annList}
      ${createForm}`;

    res.send(renderPage('Announcements', content, user, req));
  }));

  // ══════════════════════════════════════════════════════════════════
  // 10. POST /announcements/create — Create announcement (admin)
  // ══════════════════════════════════════════════════════════════════
  app.post('/announcements/create', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tenantId = req.session.user.tenant_id;
    const { title, message, type = 'info', priority = 'normal', target_roles, expires_at, dismissible } = req.body;

    if (!title || !message) {
      return res.redirect('/announcements');
    }

    // Parse target roles
    let roles = [];
    if (target_roles && typeof target_roles === 'string') {
      roles = target_roles.split(',').map(r => r.trim().toLowerCase()).filter(Boolean);
    }

    const expires = expires_at ? new Date(expires_at) : null;

    await pool.query(`
      INSERT INTO announcements (tenant_id, title, message, type, priority, target_roles, dismissible, expires_at, created_by)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [tenantId, title, message, type, priority, roles, dismissible === 'on', expires, req.session.user.id]);

    // Also create individual notifications for all users matching target roles
    let userWhere = 'tenant_id = $1 AND banned = false';
    const params = [tenantId];
    if (roles.length > 0) {
      params.push(roles);
      userWhere += ` AND role = ANY($2)`;
    }

    const { rows: users } = await pool.query(
      `SELECT id FROM users WHERE ${userWhere}`, params);

    if (users.length > 0) {
      // Whitelist type and priority to prevent injection
      const safeType = ['info', 'success', 'warning', 'error'].includes(type) ? type : 'info';
      const safePriority = ['low', 'normal', 'high', 'urgent'].includes(priority) ? priority : 'normal';

      // Insert notifications in batches of 500 for safety
      const batchSize = 500;
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        // $1=tenant_id, $2=safeType, $3=title, $4=message, $5=safePriority, $6+ = user_ids
        const placeholders = batch.map((_, j) => {
          return `($1, $${j + 6}, $2, $3, $4, '📢', NULL, false, $5, 'announcement', '{}')`;
        }).join(', ');

        const userIds = batch.map(u => u.id);
        await pool.query(`
          INSERT INTO notifications (tenant_id, user_id, type, title, message, icon, action_url, is_read, priority, category, metadata)
          ${placeholders}`,
          [tenantId, safeType, title, message, safePriority, ...userIds]);
      }
    }

    res.redirect('/announcements');
  }));

  // ══════════════════════════════════════════════════════════════════
  // 11. GET /announcements/:id/toggle — Activate/deactivate
  // ══════════════════════════════════════════════════════════════════
  app.get('/announcements/:id/toggle', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query(
      `UPDATE announcements SET is_active = NOT is_active WHERE id = $1 AND tenant_id = $2`,
      [id, req.session.user.tenant_id]);
    res.redirect('/announcements');
  }));

  // ══════════════════════════════════════════════════════════════════
  // 12. DELETE /announcements/:id — Delete announcement
  // ══════════════════════════════════════════════════════════════════
  app.delete('/announcements/:id', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    await pool.query(
      `DELETE FROM announcements WHERE id = $1 AND tenant_id = $2`,
      [id, req.session.user.tenant_id]);
    res.json({ ok: true });
  }));

  // ══════════════════════════════════════════════════════════════════
  // 13. GET /api/notifications/recent — JSON API for recent 20
  // ══════════════════════════════════════════════════════════════════
  app.get('/api/notifications/recent', requireAuth, ah(async (req, res) => {
    const { rows } = await pool.query(`
      SELECT id, type, title, message, icon, action_url, is_read, priority, category, created_at
      FROM notifications
      WHERE tenant_id = $1 AND user_id = $2 AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY created_at DESC LIMIT 20`,
      [req.session.user.tenant_id, req.session.user.id]);
    res.json({ notifications: rows });
  }));

  // ══════════════════════════════════════════════════════════════════
  // 14. POST /api/notifications/create — Programmatic creation API
  // ══════════════════════════════════════════════════════════════════
  app.post('/api/notifications/create', requireAuth, ah(async (req, res) => {
    const tenantId = req.session.user.tenant_id;

    // Only admins or service accounts can create programmatic notifications
    const role = (req.session.user.role || '').toLowerCase();
    if (!['admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const {
      user_id,       // target user (optional; omit for broadcast)
      type = 'info',
      title,
      message,
      icon = '🔔',
      action_url,
      priority = 'normal',
      category,
      metadata = {},
      expires_at,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    let result;
    if (user_id) {
      // Single-user notification
      result = await pool.query(`
        INSERT INTO notifications (tenant_id, user_id, type, title, message, icon, action_url, priority, category, metadata, expires_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
        RETURNING id`,
        [tenantId, user_id, type, title, message, icon, action_url, priority, category, JSON.stringify(metadata || {}), expires_at || null]);
    } else {
      // Broadcast to all non-banned users in tenant
      const { rows: users } = await pool.query(
        `SELECT id FROM users WHERE tenant_id = $1 AND banned = false`, [tenantId]);

      if (users.length === 0) {
        return res.json({ ok: true, created: 0 });
      }

      // Insert in batches
      let totalCreated = 0;
      const batchSize = 500;
      for (let i = 0; i < users.length; i += batchSize) {
        const batch = users.slice(i, i + batchSize);
        const values = batch.map((u, j) => {
          const base = j * 9;
          return `($1, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
        }).join(', ');

        const flatParams = batch.flatMap(u =>
          [tenantId, u.id, type, title, message, icon, action_url, priority, category, JSON.stringify(metadata || {})]
        );

        const insertRes = await pool.query(`
          INSERT INTO notifications (tenant_id, user_id, type, title, message, icon, action_url, priority, category, metadata)
          ${values}
          RETURNING id`,
          [tenantId, ...flatParams]);

        totalCreated += insertRes.rows.length;
      }

      return res.json({ ok: true, created: totalCreated, broadcast: true });
    }

    res.json({ ok: true, id: result.rows[0]?.id, created: 1 });
  }));

  // ══════════════════════════════════════════════════════════════════
  // 15. GET /notifications/:id — View single notification detail
  // ══════════════════════════════════════════════════════════════════
  app.get('/notifications/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const { rows } = await pool.query(`
      SELECT * FROM notifications WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
      [id, req.session.user.tenant_id, req.session.user.id]);

    if (rows.length === 0) {
      return res.status(404).send(renderPage('Not Found',
        '<div class="card"><div class="alert alert-error">Notification not found</div><a href="/notifications" class="btn">← Back to Inbox</a></div>',
        req.session.user, req));
    }

    const n = rows[0];

    // Auto-mark as read on view
    if (!n.is_read) {
      await pool.query(`UPDATE notifications SET is_read = true WHERE id = $1`, [id]);
    }

    const metaHTML = n.metadata && Object.keys(n.metadata).length > 0
      ? `<div style="margin-top:16px;padding:14px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0">
           <strong style="font-size:13px;color:#64748b">Metadata</strong>
           <pre style="margin:8px 0 0;font-size:13px;color:#374151;white-space:pre-wrap">${esc(JSON.stringify(n.metadata, null, 2))}</pre>
         </div>` : '';

    const content = `
      ${pulseCSS}
      ${navBar('inbox')}
      <a href="/notifications" class="btn btn-sm" style="margin-bottom:16px">← Back to Inbox</a>
      <div class="card" style="border-left:4px solid ${typeColor(n.type)}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">
          <span style="font-size:32px">${esc(n.icon || '🔔')}</span>
          <div>
            <h2 style="margin:0;font-size:20px;color:#1f2937">${esc(n.title)}</h2>
            <div style="display:flex;gap:8px;align-items:center;margin-top:4px">
              ${typeBadge(n.type)}
              ${priorityBadge(n.priority)}
              ${n.category ? `<span class="muted" style="font-size:13px">${esc(n.category)}</span>` : ''}
            </div>
          </div>
        </div>
        <div style="font-size:15px;line-height:1.7;color:#374151;white-space:pre-wrap;margin-bottom:16px">${esc(n.message || 'No additional details.')}</div>
        <div style="display:flex;gap:12px;align-items:center;flex-wrap:wrap;font-size:13px;color:#6b7280;border-top:1px solid #e5e7eb;padding-top:12px">
          <span>📅 ${formatDateTime(n.created_at)}</span>
          ${n.expires_at ? `<span>⏰ Expires: ${formatDateTime(n.expires_at)}</span>` : ''}
          <span>ID: #${n.id}</span>
          <div style="margin-left:auto;display:flex;gap:8px">
            ${n.action_url ? `<a href="${esc(n.action_url)}" class="btn btn-sm btn-blue">🔗 Take Action</a>` : ''}
            <button onclick="fetch('/notifications/${n.id}/dismiss',{method:'POST'}).then(()=>location.href='/notifications')" class="btn btn-sm btn-gold">Dismiss</button>
            <button onclick="if(confirm('Delete?'))fetch('/notifications/${n.id}',{method:'DELETE'}).then(()=>location.href='/notifications')" class="btn btn-sm btn-red">🗑 Delete</button>
          </div>
        </div>
        ${metaHTML}
      </div>`;

    res.send(renderPage(n.title, content, req.session.user, req));
  }));

  // ══════════════════════════════════════════════════════════════════
  // 16. GET /api/notifications/stats — Dashboard stats API
  // ══════════════════════════════════════════════════════════════════
  app.get('/api/notifications/stats', requireAuth, ah(async (req, res) => {
    const tenantId = req.session.user.tenant_id;
    const userId = req.session.user.id;

    const { rows } = await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE NOT is_read AND (expires_at IS NULL OR expires_at > NOW())) AS unread,
        COUNT(*) FILTER (WHERE type = 'error' AND NOT is_read) AS unread_errors,
        COUNT(*) FILTER (WHERE priority = 'urgent' AND NOT is_read) AS unread_urgent,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '24 hours') AS last_24h,
        COUNT(*) FILTER (WHERE created_at > NOW() - INTERVAL '7 days') AS last_7d
      FROM notifications WHERE tenant_id = $1 AND user_id = $2`,
      [tenantId, userId]);

    // Active announcements count
    const { rows: annRows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM announcements WHERE tenant_id = $1 AND is_active = true
        AND (starts_at IS NULL OR starts_at <= NOW()) AND (expires_at IS NULL OR expires_at > NOW())`,
      [tenantId]);

    res.json({
      ...rows[0],
      active_announcements: annRows[0]?.count || 0,
    });
  }));

  // ══════════════════════════════════════════════════════════════════
  // 17. POST /api/notifications/clean-expired — Clean expired (admin)
  // ══════════════════════════════════════════════════════════════════
  app.post('/api/notifications/clean-expired', requireAuth, ah(async (req, res) => {
    const role = (req.session.user.role || '').toLowerCase();
    if (!['admin', 'superadmin'].includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    const { rowCount } = await pool.query(
      `DELETE FROM notifications WHERE tenant_id = $1 AND expires_at IS NOT NULL AND expires_at < NOW()`,
      [req.session.user.tenant_id]);

    res.json({ ok: true, deleted: rowCount });
  }));

  // ══════════════════════════════════════════════════════════════════
  // 18. GET /notifications/feed — Lightweight notification feed widget
  // ══════════════════════════════════════════════════════════════════
  app.get('/notifications/feed', requireAuth, ah(async (req, res) => {
    const tenantId = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const limit = Math.min(parseInt(req.query.limit) || 10, 50);

    const { rows } = await pool.query(`
      SELECT id, type, title, message, icon, action_url, is_read, priority, category, created_at
      FROM notifications
      WHERE tenant_id = $1 AND user_id = $2 AND (expires_at IS NULL OR expires_at > NOW())
      ORDER BY
        CASE priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 WHEN 'low' THEN 3 ELSE 4 END,
        created_at DESC
      LIMIT $3`,
      [tenantId, userId, limit]);

    const feedItems = rows.length === 0
      ? '<li style="padding:20px;text-align:center;color:#9ca3af;font-size:14px">No recent notifications</li>'
      : rows.map(n => `
        <li style="display:flex;align-items:flex-start;gap:10px;padding:10px 12px;border-bottom:1px solid #f3f4f6;
          cursor:pointer;transition:background .1s;${n.is_read ? 'opacity:.7' : 'background:#eff6ff;'}"
          onclick="location.href='/notifications/${n.id}'"
          onmouseover="this.style.background='#f9fafb'" onmouseout="this.style.background='${n.is_read ? '' : '#eff6ff'}'">
          <span style="font-size:18px;flex-shrink:0">${esc(n.icon || '🔔')}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:${n.is_read ? '400' : '600'};color:#1f2937;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(n.title)}</div>
            <div style="font-size:12px;color:#9ca3af">${relativeTime(n.created_at)}</div>
          </div>
          ${!n.is_read ? '<span style="width:8px;height:8px;border-radius:50%;background:#3b82f6;flex-shrink:0;margin-top:6px"></span>' : ''}
        </li>`).join('');

    const content = `
      ${pulseCSS}
      <div style="max-width:500px;margin:0 auto">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px">
          <h3 style="margin:0">🔔 Recent</h3>
          <a href="/notifications" style="font-size:13px;color:#3b82f6;text-decoration:none">View All →</a>
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
          <ul style="list-style:none;margin:0;padding:0">${feedItems}</ul>
        </div>
      </div>`;

    res.send(renderPage('Notification Feed', content, req.session.user, req));
  }));

  console.log('[NotificationCenter] Module loaded — notification inbox, preferences & announcements');
};
