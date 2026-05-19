/**
 * Content Moderation Dashboard — School SaaS Portal
 * Review and moderate user-generated content from forum posts, gallery uploads,
 * chat messages, comments. Auto-moderation rules, blocked users, audit log.
 *
 * Usage: const mod = require('./content-moderation'); mod(app, pool, opts);
 */
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  // ── Status badge helper ──
  function badge(status) {
    const colors = {
      pending: 'background:#fef3c7;color:#92400e;border:1px solid #fcd34d',
      approved: 'background:#dcfce7;color:#166534;border:1px solid #86efac',
      rejected: 'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5',
      flagged: 'background:#fce7f3;color:#9d174d;border:1px solid #f9a8d4',
      resolved: 'background:#dbeafe;color:#1e40af;border:1px solid #93c5fd',
      blocked: 'background:#fee2e2;color:#991b1b;border:1px solid #fca5a5',
      unblocked: 'background:#dcfce7;color:#166534;border:1px solid #86efac',
    };
    return `<span style="${colors[status]||colors.pending};padding:3px 10px;border-radius:12px;font-size:12px;font-weight:600;text-transform:uppercase">${esc(status)}</span>`;
  }

  function typeIcon(type) {
    const icons = { forum_post: '💬', gallery_upload: '🖼', chat_message: '💭', comment: '🗣' };
    return icons[type] || '📄';
  }

  // ── Table creation ──
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS moderation_queue (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        content_type VARCHAR(50), content_id INT,
        content_text TEXT, author_email VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        moderated_by VARCHAR(255), moderated_at TIMESTAMPTZ,
        rejection_reason TEXT, auto_flagged BOOLEAN DEFAULT false,
        flag_reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS moderation_reports (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        reporter_email VARCHAR(255), content_type VARCHAR(50),
        content_id INT, reason TEXT, status VARCHAR(20) DEFAULT 'pending',
        resolved_by VARCHAR(255), resolved_at TIMESTAMPTZ,
        resolution TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS moderation_rules (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        rule_type VARCHAR(50), rule_value TEXT,
        action VARCHAR(20) DEFAULT 'flag', is_active BOOLEAN DEFAULT true,
        created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS blocked_users (
        id SERIAL PRIMARY KEY, tenant_id INT NOT NULL DEFAULT 0,
        user_email VARCHAR(255), blocked_by VARCHAR(255),
        reason TEXT, blocked_at TIMESTAMPTZ DEFAULT NOW(),
        unblocked_at TIMESTAMPTZ
      )`);
    // Indexes
    const indexes = [
      'CREATE INDEX IF NOT EXISTS idx_mq_tenant ON moderation_queue(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_mq_status ON moderation_queue(status)',
      'CREATE INDEX IF NOT EXISTS idx_mr_tenant ON moderation_reports(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_mr_status ON moderation_reports(status)',
      'CREATE INDEX IF NOT EXISTS idx_modrules_tenant ON moderation_rules(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_blocked_tenant ON blocked_users(tenant_id)',
      'CREATE INDEX IF NOT EXISTS idx_blocked_email ON blocked_users(user_email)',
    ];
    for (const sql of indexes) { try { await pool.query(sql); } catch(_) {} }
    console.log('[ContentModeration] Tables ready');
  })().catch(e => console.error('[ContentModeration] Table init error:', e));

  // ═══════════════════════════════════════════════════════
  // 1. DASHBOARD — /school/moderation
  // ═══════════════════════════════════════════════════════
  app.get('/school/moderation', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [stats, recent, flagged, reports] = await Promise.all([
      pool.query(`SELECT
        COUNT(*) FILTER (WHERE status='pending') AS pending,
        COUNT(*) FILTER (WHERE status='approved') AS approved,
        COUNT(*) FILTER (WHERE status='rejected') AS rejected,
        COUNT(*) FILTER (WHERE status='flagged') AS flagged,
        COUNT(*) AS total
        FROM moderation_queue WHERE tenant_id=$1`, [tid]),
      pool.query(`SELECT * FROM moderation_queue WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5`, [tid]),
      pool.query(`SELECT * FROM moderation_queue WHERE tenant_id=$1 AND (status='flagged' OR auto_flagged=true) AND status!='approved' AND status!='rejected' ORDER BY created_at DESC LIMIT 5`, [tid]),
      pool.query(`SELECT * FROM moderation_reports WHERE tenant_id=$1 AND status='pending' ORDER BY created_at DESC LIMIT 5`, [tid]),
    ]);
    const s = stats.rows[0] || {};

    let recentRows = '';
    recent.rows.forEach(r => {
      recentRows += `<div style="display:flex;align-items:center;gap:12px;padding:12px 0;border-bottom:1px solid #f3f4f6">
        <span style="font-size:20px">${typeIcon(r.content_type)}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#111827">${esc(r.content_type)} #${r.content_id}</div>
          <div style="font-size:12px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((r.content_text||'').slice(0,80))}</div>
        </div>
        ${badge(r.status)}
      </div>`;
    });

    let flaggedRows = '';
    flagged.rows.forEach(r => {
      flaggedRows += `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6">
        <span style="font-size:18px">🚩</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#111827">${esc(r.content_type)} by ${esc(r.author_email||'unknown')}</div>
          <div style="font-size:12px;color:#9ca3af">${esc(r.flag_reason||'Auto-flagged')}</div>
        </div>
        <a href="/school/moderation/pending/${r.id}" style="background:#4f46e5;color:#fff;padding:5px 14px;border-radius:6px;font-size:12px;text-decoration:none;font-weight:600">Review</a>
      </div>`;
    });

    let reportRows = '';
    reports.rows.forEach(r => {
      reportRows += `<div style="display:flex;align-items:center;gap:12px;padding:10px 0;border-bottom:1px solid #f3f4f6">
        <span style="font-size:18px">⚠️</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600;color:#111827">${esc(r.content_type)} reported by ${esc(r.reporter_email||'anonymous')}</div>
          <div style="font-size:12px;color:#6b7280">${esc((r.reason||'').slice(0,60))}</div>
        </div>
        <a href="/school/moderation/reports" style="background:#dc2626;color:#fff;padding:5px 14px;border-radius:6px;font-size:12px;text-decoration:none;font-weight:600">View</a>
      </div>`;
    });

    const html = renderPage('Content Moderation', `
      <link rel="stylesheet" href="/css/sk.css">
      <div style="max-width:1100px;margin:0 auto;padding:24px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:28px;flex-wrap:wrap;gap:12px">
          <h1 style="font-size:26px;font-weight:700;color:#111827;margin:0">🛡 Content Moderation</h1>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <a href="/school/moderation/pending" style="background:#4f46e5;color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">📋 Pending Queue</a>
            <a href="/school/moderation/reports" style="background:#dc2626;color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">🚨 Reports</a>
            <a href="/school/moderation/blocked" style="background:#374151;color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">🚫 Blocked Users</a>
            <a href="/school/moderation/rules" style="background:#7c3aed;color:#fff;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">⚙ Rules</a>
            <a href="/school/moderation/history" style="background:#fff;color:#374151;border:1px solid #d1d5db;padding:8px 18px;border-radius:8px;text-decoration:none;font-size:13px;font-weight:600">📜 History</a>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:28px">
          <div style="background:#fef3c7;border:1px solid #fcd34d;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:32px;font-weight:800;color:#92400e">${s.pending||0}</div>
            <div style="font-size:13px;color:#92400e;margin-top:4px">Pending Review</div>
          </div>
          <div style="background:#dcfce7;border:1px solid #86efac;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:32px;font-weight:800;color:#166534">${s.approved||0}</div>
            <div style="font-size:13px;color:#166534;margin-top:4px">Approved</div>
          </div>
          <div style="background:#fee2e2;border:1px solid #fca5a5;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:32px;font-weight:800;color:#991b1b">${s.rejected||0}</div>
            <div style="font-size:13px;color:#991b1b;margin-top:4px">Rejected</div>
          </div>
          <div style="background:#fce7f3;border:1px solid #f9a8d4;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:32px;font-weight:800;color:#9d174d">${s.flagged||0}</div>
            <div style="font-size:13px;color:#9d174d;margin-top:4px">Flagged</div>
          </div>
          <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:32px;font-weight:800;color:#4f46e5">${s.total||0}</div>
            <div style="font-size:13px;color:#4f46e5;margin-top:4px">Total Items</div>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
            <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 12px">🚩 Flagged Content</h2>
            ${flaggedRows || '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:16px">No flagged content</div>'}
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
            <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 12px">⚠ User Reports</h2>
            ${reportRows || '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:16px">No pending reports</div>'}
          </div>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
          <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 12px">🕐 Recent Activity</h2>
          ${recentRows || '<div style="color:#9ca3af;font-size:13px;text-align:center;padding:16px">No activity yet</div>'}
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  // ═══════════════════════════════════════════════════════
  // 2. PENDING QUEUE — /school/moderation/pending
  // ═══════════════════════════════════════════════════════
  app.get('/school/moderation/pending', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const typeFilter = String(req.query.type || '').trim();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    let where = 'WHERE tenant_id=$1 AND status=$2';
    const params = [tid, 'pending'];
    let pi = 3;
    if (typeFilter) { where += ` AND content_type=$${pi++}`; params.push(typeFilter); }

    const [countR, rowsR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM moderation_queue ${where}`, params),
      pool.query(`SELECT * FROM moderation_queue ${where} ORDER BY auto_flagged DESC, created_at ASC LIMIT $${pi++} OFFSET $${pi++}`, [...params, limit, offset]),
    ]);
    const totalPages = Math.ceil((countR.rows[0]?.total || 0) / limit);

    let cards = '';
    rowsR.rows.forEach(r => {
      cards += `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;display:flex;gap:16px;align-items:flex-start">
        <span style="font-size:28px">${typeIcon(r.content_type)}</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-weight:600;font-size:14px;color:#111827">${esc(r.content_type)}</span>
            <span style="font-size:12px;color:#9ca3af">#${r.content_id}</span>
            ${r.auto_flagged ? '<span style="background:#fee2e2;color:#991b1b;padding:2px 8px;border-radius:6px;font-size:11px">🤖 AUTO-FLAGGED</span>' : ''}
          </div>
          <div style="font-size:13px;color:#374151;margin-bottom:6px;line-height:1.5">${esc((r.content_text||'').slice(0,200))}${(r.content_text||'').length > 200 ? '...' : ''}</div>
          <div style="font-size:12px;color:#9ca3af">By ${esc(r.author_email||'unknown')} · ${r.created_at?.toISOString?.().slice(0,16)?.replace('T',' ') || ''}</div>
          ${r.flag_reason ? `<div style="font-size:12px;color:#dc2626;margin-top:4px">Flag: ${esc(r.flag_reason)}</div>` : ''}
        </div>
        <div style="display:flex;flex-direction:column;gap:6px">
          <a href="/school/moderation/pending/${r.id}" style="background:#4f46e5;color:#fff;padding:7px 16px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;text-align:center">Review</a>
        </div>
      </div>`;
    });

    let pager = '';
    if (totalPages > 1) {
      pager = `<div style="display:flex;gap:6px;justify-content:center;margin-top:20px">`;
      for (let i = 1; i <= totalPages; i++) {
        pager += `<a href="?page=${i}&type=${esc(typeFilter)}" style="padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;${i===page?'background:#4f46e5;color:#fff':'background:#fff;color:#374151;border:1px solid #d1d5db'}">${i}</a>`;
      }
      pager += '</div>';
    }

    const html = renderPage('Pending Moderation', `
      <link rel="stylesheet" href="/css/sk.css">
      <div style="max-width:900px;margin:0 auto;padding:24px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <a href="/school/moderation" style="color:#4f46e5;text-decoration:none;font-size:14px">← Back</a>
          <h1 style="font-size:24px;font-weight:700;color:#111827;margin:0">📋 Pending Queue</h1>
          <span style="background:#fef3c7;color:#92400e;padding:4px 12px;border-radius:10px;font-size:13px;font-weight:700">${countR.rows[0]?.total||0} items</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
          ${['','forum_post','gallery_upload','chat_message','comment'].map(t =>
            `<a href="?type=${t}" style="padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;${t===typeFilter?'background:#4f46e5;color:#fff':'background:#fff;color:#374151;border:1px solid #d1d5db'}">${t?typeIcon(t)+' '+t:'All Types'}</a>`
          ).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">${cards || '<div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px">🎉 No pending items — all caught up!</div>'}</div>
        ${pager}
      </div>
    `, req.session.user);
    res.send(html);
  }));

  // ═══════════════════════════════════════════════════════
  // 3. CONTENT DETAIL — /school/moderation/pending/:id
  // ═══════════════════════════════════════════════════════
  app.get('/school/moderation/pending/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const item = await pool.query(`SELECT * FROM moderation_queue WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    if (!item.rows[0]) return res.status(404).send('Item not found');
    const r = item.rows[0];

    const html = renderPage('Review Content #' + r.id, `
      <link rel="stylesheet" href="/css/sk.css">
      <div style="max-width:800px;margin:0 auto;padding:24px">
        <a href="/school/moderation/pending" style="color:#4f46e5;text-decoration:none;font-size:14px">← Back to Queue</a>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-top:16px">
          <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
            <span style="font-size:32px">${typeIcon(r.content_type)}</span>
            <div>
              <div style="font-size:18px;font-weight:700;color:#111827">${esc(r.content_type)} #${r.content_id}</div>
              <div style="font-size:13px;color:#9ca3af">Submitted ${r.created_at?.toISOString?.().slice(0,16)?.replace('T',' ') || ''}</div>
            </div>
            ${badge(r.status)}
            ${r.auto_flagged ? '<span style="background:#fee2e2;color:#991b1b;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:600">🤖 AUTO-FLAGGED</span>' : ''}
          </div>

          <div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:16px">
            <div style="font-size:12px;color:#6b7280;font-weight:600;margin-bottom:6px">CONTENT PREVIEW</div>
            <div style="font-size:14px;color:#111827;line-height:1.7;white-space:pre-wrap">${esc(r.content_text||'No content')}</div>
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:20px">
            <div style="font-size:13px"><strong>Author:</strong> ${esc(r.author_email||'Unknown')}</div>
            <div style="font-size:13px"><strong>Content ID:</strong> ${r.content_id||'N/A'}</div>
            ${r.flag_reason ? `<div style="font-size:13px;color:#dc2626"><strong>Flag Reason:</strong> ${esc(r.flag_reason)}</div>` : ''}
            ${r.moderated_by ? `<div style="font-size:13px"><strong>Moderated By:</strong> ${esc(r.moderated_by)}</div>` : ''}
            ${r.rejection_reason ? `<div style="font-size:13px;color:#dc2626"><strong>Rejection Reason:</strong> ${esc(r.rejection_reason)}</div>` : ''}
          </div>

          ${r.status === 'pending' ? `
          <div style="display:flex;gap:12px;flex-wrap:wrap;margin-bottom:20px">
            <form method="POST" action="/school/moderation/pending/${r.id}/approve" style="margin:0">
              <button type="submit" style="background:#16a34a;color:#fff;border:none;padding:10px 24px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">✅ Approve</button>
            </form>
            <form method="POST" action="/school/moderation/pending/${r.id}/reject" style="margin:0;flex:1;display:flex;gap:8px">
              <input type="text" name="reason" placeholder="Rejection reason..." required
                style="flex:1;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box" aria-label="Rejection reason"/>
              <button type="submit" style="background:#dc2626;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">❌ Reject</button>
            </form>
          </div>
          <form method="POST" action="/school/moderation/pending/${r.id}/flag" style="display:flex;gap:8px">
            <input type="text" name="reason" placeholder="Flag reason..." required
              style="flex:1;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box" aria-label="Flag reason"/>
            <button type="submit" style="background:#f59e0b;color:#fff;border:none;padding:10px 20px;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer">🚩 Flag</button>
          </form>
          ` : '<div style="padding:16px;background:#f9fafb;border-radius:8px;text-align:center;color:#6b7280;font-size:14px">This item has already been reviewed.</div>'}
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  // ═══════════════════════════════════════════════════════
  // 4. APPROVE — POST /school/moderation/pending/:id/approve
  // ═══════════════════════════════════════════════════════
  app.post('/school/moderation/pending/:id/approve', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session?.user?.email || 'admin';
    const result = await pool.query(
      `UPDATE moderation_queue SET status='approved', moderated_by=$1, moderated_at=NOW()
       WHERE id=$2 AND tenant_id=$3 AND status='pending' RETURNING id`, [email, req.params.id, tid]);
    if (!result.rows[0]) return res.redirect('/school/moderation/pending/' + req.params.id);
    audit('content_approved', { tenantId: tid, itemId: req.params.id, moderator: email });
    res.redirect('/school/moderation/pending');
  }));

  // ═══════════════════════════════════════════════════════
  // 5. REJECT — POST /school/moderation/pending/:id/reject
  // ═══════════════════════════════════════════════════════
  app.post('/school/moderation/pending/:id/reject', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session?.user?.email || 'admin';
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    const result = await pool.query(
      `UPDATE moderation_queue SET status='rejected', moderated_by=$1, moderated_at=NOW(), rejection_reason=$2
       WHERE id=$3 AND tenant_id=$4 AND status='pending' RETURNING id`, [email, reason, req.params.id, tid]);
    if (!result.rows[0]) return res.redirect('/school/moderation/pending/' + req.params.id);
    audit('content_rejected', { tenantId: tid, itemId: req.params.id, moderator: email, reason });
    res.redirect('/school/moderation/pending');
  }));

  // ═══════════════════════════════════════════════════════
  // 6. FLAG — POST /school/moderation/pending/:id/flag
  // ═══════════════════════════════════════════════════════
  app.post('/school/moderation/pending/:id/flag', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (!reason) return res.redirect('/school/moderation/pending/' + req.params.id);
    await pool.query(
      `UPDATE moderation_queue SET status='flagged', flag_reason=$1, auto_flagged=false
       WHERE id=$2 AND tenant_id=$3 AND status='pending'`, [reason, req.params.id, tid]);
    audit('content_flagged', { tenantId: tid, itemId: req.params.id, reason });
    res.redirect('/school/moderation/pending');
  }));

  // ═══════════════════════════════════════════════════════
  // 7. USER REPORTS — GET /school/moderation/reports
  // ═══════════════════════════════════════════════════════
  app.get('/school/moderation/reports', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const statusFilter = String(req.query.status || '').trim();
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = 20;
    const offset = (page - 1) * limit;

    let where = 'WHERE tenant_id=$1';
    const params = [tid];
    let pi = 2;
    if (statusFilter) { where += ` AND status=$${pi++}`; params.push(statusFilter); }

    const [countR, rowsR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM moderation_reports ${where}`, params),
      pool.query(`SELECT * FROM moderation_reports ${where} ORDER BY created_at DESC LIMIT $${pi++} OFFSET $${pi++}`, [...params, limit, offset]),
    ]);
    const totalPages = Math.ceil((countR.rows[0]?.total || 0) / limit);

    let rows = '';
    rowsR.rows.forEach(r => {
      rows += `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;display:flex;gap:16px;align-items:flex-start">
        <span style="font-size:28px">⚠️</span>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;flex-wrap:wrap">
            <span style="font-weight:600;font-size:14px;color:#111827">${esc(r.content_type)} #${r.content_id}</span>
            ${badge(r.status)}
          </div>
          <div style="font-size:13px;color:#374151;margin-bottom:4px"><strong>Reporter:</strong> ${esc(r.reporter_email||'anonymous')}</div>
          <div style="font-size:13px;color:#374151;margin-bottom:4px"><strong>Reason:</strong> ${esc(r.reason||'Not specified')}</div>
          <div style="font-size:12px;color:#9ca3af">Filed ${r.created_at?.toISOString?.().slice(0,16)?.replace('T',' ') || ''}</div>
          ${r.resolution ? `<div style="font-size:12px;color:#166534;margin-top:4px">Resolution: ${esc(r.resolution)}</div>` : ''}
        </div>
        ${r.status === 'pending' ? `<form method="POST" action="/school/moderation/reports/${r.id}/resolve" style="margin:0;display:flex;flex-direction:column;gap:6px">
          <input type="text" name="resolution" placeholder="Resolution..." required style="width:160px;padding:8px 10px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;box-sizing:border-box" aria-label="Resolution"/>
          <button type="submit" style="background:#0891b2;color:#fff;border:none;padding:7px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer">Resolve</button>
        </form>` : ''}
      </div>`;
    });

    let pager = '';
    if (totalPages > 1) {
      pager = `<div style="display:flex;gap:6px;justify-content:center;margin-top:20px">`;
      for (let i = 1; i <= Math.min(totalPages, 10); i++) {
        pager += `<a href="?page=${i}&status=${esc(statusFilter)}" style="padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;${i===page?'background:#4f46e5;color:#fff':'background:#fff;color:#374151;border:1px solid #d1d5db'}">${i}</a>`;
      }
      pager += '</div>';
    }

    const html = renderPage('User Reports', `
      <link rel="stylesheet" href="/css/sk.css">
      <div style="max-width:900px;margin:0 auto;padding:24px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <a href="/school/moderation" style="color:#4f46e5;text-decoration:none;font-size:14px">← Dashboard</a>
          <h1 style="font-size:24px;font-weight:700;color:#111827;margin:0">🚨 User Reports</h1>
          <span style="background:#fee2e2;color:#991b1b;padding:4px 12px;border-radius:10px;font-size:13px;font-weight:700">${countR.rows[0]?.total||0} reports</span>
        </div>
        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
          ${['','pending','resolved'].map(s =>
            `<a href="?status=${s}" style="padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;${s===statusFilter?'background:#4f46e5;color:#fff':'background:#fff;color:#374151;border:1px solid #d1d5db'}">${s||'All Statuses'}</a>`
          ).join('')}
        </div>
        <div style="display:flex;flex-direction:column;gap:12px">${rows || '<div style="text-align:center;padding:40px;color:#9ca3af;font-size:14px">No reports found.</div>'}</div>
        ${pager}
      </div>
    `, req.session.user);
    res.send(html);
  }));

  // ═══════════════════════════════════════════════════════
  // 8. RESOLVE REPORT — POST /school/moderation/reports/:id/resolve
  // ═══════════════════════════════════════════════════════
  app.post('/school/moderation/reports/:id/resolve', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session?.user?.email || 'admin';
    const resolution = String(req.body.resolution || '').trim().slice(0, 1000);
    if (!resolution) return res.redirect('/school/moderation/reports');
    await pool.query(
      `UPDATE moderation_reports SET status='resolved', resolved_by=$1, resolved_at=NOW(), resolution=$2
       WHERE id=$3 AND tenant_id=$4 AND status='pending'`,
      [email, resolution, req.params.id, tid]);
    audit('report_resolved', { tenantId: tid, reportId: req.params.id, resolver: email });
    res.redirect('/school/moderation/reports');
  }));

  // ═══════════════════════════════════════════════════════
  // 9. BLOCKED USERS — GET /school/moderation/blocked
  // ═══════════════════════════════════════════════════════
  app.get('/school/moderation/blocked', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const rows = await pool.query(
      `SELECT * FROM blocked_users WHERE tenant_id=$1 ORDER BY blocked_at DESC`, [tid]);

    let tableRows = '';
    rows.rows.forEach(r => {
      const isBlocked = !r.unblocked_at;
      tableRows += `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:12px;font-size:13px;font-weight:600;color:#111827">${esc(r.user_email||'N/A')}</td>
        <td style="padding:12px;font-size:13px">${esc(r.reason||'N/A')}</td>
        <td style="padding:12px;font-size:13px;color:#6b7280">${esc(r.blocked_by||'admin')}</td>
        <td style="padding:12px;font-size:12px;color:#9ca3af">${r.blocked_at?.toISOString?.().slice(0,16)?.replace('T',' ') || ''}</td>
        <td style="padding:12px">${isBlocked ? badge('blocked') : badge('unblocked')}</td>
        <td style="padding:12px">
          ${isBlocked ? `<form method="POST" action="/school/moderation/blocked/${encodeURIComponent(r.user_email||'')}/unblock" style="margin:0">
            <button type="submit" style="background:#16a34a;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer" onclick="return confirm('Unblock this user?')">Unblock</button>
          </form>` : '<span style="font-size:12px;color:#6b7280">Unblocked</span>'}
        </td>
      </tr>`;
    });

    // Block new user form
    const html = renderPage('Blocked Users', `
      <link rel="stylesheet" href="/css/sk.css">
      <div style="max-width:1000px;margin:0 auto;padding:24px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <a href="/school/moderation" style="color:#4f46e5;text-decoration:none;font-size:14px">← Dashboard</a>
          <h1 style="font-size:24px;font-weight:700;color:#111827;margin:0">🚫 Blocked Users</h1>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:24px">
          <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px">Block a User</h2>
          <form method="POST" action="/school/moderation/blocked" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
            <div style="flex:1;min-width:200px">
              <label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">User Email</label>
              <input type="email" name="user_email" required placeholder="user@example.com"
                style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box"/>
            </div>
            <div style="flex:1;min-width:200px">
              <label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Reason</label>
              <input type="text" name="reason" required placeholder="Violation reason..."
                style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box"/>
            </div>
            <button type="submit" style="background:#dc2626;color:#fff;border:none;padding:9px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">🚫 Block User</button>
          </form>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
          <table style="width:100%;border-collapse:collapse" role="table" aria-label="Blocked users">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Email</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Reason</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Blocked By</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Date</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Status</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Action</th>
            </tr></thead>
            <tbody>${tableRows || '<tr><td colspan="6" style="padding:32px;text-align:center;color:#9ca3af;font-size:14px">No blocked users — keep it that way! 🎉</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  // Block user (POST on /school/moderation/blocked)
  app.post('/school/moderation/blocked', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session?.user?.email || 'admin';
    const userEmail = String(req.body.user_email || '').trim().toLowerCase();
    const reason = String(req.body.reason || '').trim().slice(0, 500);
    if (!userEmail || !reason) return res.redirect('/school/moderation/blocked');
    await pool.query(
      `INSERT INTO blocked_users (tenant_id, user_email, blocked_by, reason) VALUES ($1,$2,$3,$4)`,
      [tid, userEmail, email, reason]);
    audit('user_blocked', { tenantId: tid, blockedEmail: userEmail, blockedBy: email, reason });
    res.redirect('/school/moderation/blocked');
  }));

  // ═══════════════════════════════════════════════════════
  // 10. UNBLOCK — POST /school/moderation/blocked/:email/unblock
  // ═══════════════════════════════════════════════════════
  app.post('/school/moderation/blocked/:email/unblock', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = decodeURIComponent(req.params.email || '');
    await pool.query(
      `UPDATE blocked_users SET unblocked_at=NOW() WHERE tenant_id=$1 AND user_email=$2 AND unblocked_at IS NULL`,
      [tid, email]);
    audit('user_unblocked', { tenantId: tid, unblockedEmail: email });
    res.redirect('/school/moderation/blocked');
  }));

  // ═══════════════════════════════════════════════════════
  // 11. AUTO-MOD RULES — GET /school/moderation/rules
  // ═══════════════════════════════════════════════════════
  app.get('/school/moderation/rules', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const rules = await pool.query(
      `SELECT * FROM moderation_rules WHERE tenant_id=$1 ORDER BY rule_type, created_at DESC`, [tid]);

    let ruleRows = '';
    rules.rows.forEach(r => {
      ruleRows += `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 12px;font-size:13px"><span style="background:#eef2ff;color:#4f46e5;padding:3px 10px;border-radius:8px;font-size:12px;font-weight:600">${esc(r.rule_type)}</span></td>
        <td style="padding:10px 12px;font-size:13px;color:#111827;font-family:monospace">${esc(r.rule_value)}</td>
        <td style="padding:10px 12px;font-size:13px">${badge(r.action)}</td>
        <td style="padding:10px 12px;font-size:13px">
          <span style="color:${r.is_active?'#16a34a':'#9ca3af'};font-weight:600">${r.is_active?'● Active':'○ Inactive'}</span>
        </td>
        <td style="padding:10px 12px;font-size:12px;color:#9ca3af">${r.created_at?.toISOString?.().slice(0,10) || ''}</td>
        <td style="padding:10px 12px">
          <a href="/school/moderation/rules?toggle=${r.id}" style="color:#4f46e5;font-size:12px;text-decoration:none;font-weight:600">${r.is_active?'Deactivate':'Activate'}</a>
        </td>
      </tr>`;
    });

    const html = renderPage('Auto-Moderation Rules', `
      <link rel="stylesheet" href="/css/sk.css">
      <div style="max-width:1000px;margin:0 auto;padding:24px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <a href="/school/moderation" style="color:#4f46e5;text-decoration:none;font-size:14px">← Dashboard</a>
          <h1 style="font-size:24px;font-weight:700;color:#111827;margin:0">⚙ Auto-Moderation Rules</h1>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:24px">
          <h2 style="font-size:16px;font-weight:700;color:#111827;margin:0 0 14px">Add New Rule</h2>
          <form method="POST" action="/school/moderation/rules">
            <div style="display:grid;grid-template-columns:1fr 2fr 1fr;gap:12px;margin-bottom:12px">
              <div>
                <label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Rule Type</label>
                <select name="rule_type" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box">
                  <option value="word_filter">Word Filter</option>
                  <option value="spam_detection">Spam Detection</option>
                  <option value="regex_pattern">Regex Pattern</option>
                  <option value="link_filter">Link Filter</option>
                </select>
              </div>
              <div>
                <label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Rule Value (word, phrase, or pattern)</label>
                <input type="text" name="rule_value" required placeholder="e.g. badword, http://, .*spam.*"
                  style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box"/>
              </div>
              <div>
                <label style="font-size:12px;font-weight:600;color:#6b7280;display:block;margin-bottom:4px">Action</label>
                <select name="action" style="width:100%;padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px;box-sizing:border-box">
                  <option value="flag">🚩 Flag for Review</option>
                  <option value="reject">❌ Auto-Reject</option>
                  <option value="warn">⚠ Warn User</option>
                </select>
              </div>
            </div>
            <button type="submit" style="background:#7c3aed;color:#fff;border:none;padding:9px 20px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">+ Add Rule</button>
          </form>
        </div>

        <div style="padding:12px;background:#eef2ff;border:1px solid #c7d2fe;border-radius:8px;margin-bottom:16px;font-size:13px;color:#4f46e5">
          💡 <strong>Tip:</strong> Word filters check for exact or partial matches. Regex patterns use JavaScript RegExp syntax. Rules are evaluated when new content is submitted.
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
          <table style="width:100%;border-collapse:collapse" role="table" aria-label="Moderation rules">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Type</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Value</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Action</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Status</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Created</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Toggle</th>
            </tr></thead>
            <tbody>${ruleRows || '<tr><td colspan="6" style="padding:32px;text-align:center;color:#9ca3af;font-size:14px">No rules configured. Add your first rule above.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  // ═══════════════════════════════════════════════════════
  // 12. SAVE RULES — POST /school/moderation/rules
  // ═══════════════════════════════════════════════════════
  app.post('/school/moderation/rules', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const email = req.session?.user?.email || 'admin';
    const ruleType = String(req.body.rule_type || 'word_filter').trim();
    const ruleValue = String(req.body.rule_value || '').trim();
    const action = String(req.body.action || 'flag').trim();

    if (!ruleValue) return res.redirect('/school/moderation/rules');

    // Handle toggle
    if (req.query.toggle) {
      await pool.query(
        `UPDATE moderation_rules SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2`,
        [req.query.toggle, tid]);
      audit('rule_toggled', { tenantId: tid, ruleId: req.query.toggle });
      return res.redirect('/school/moderation/rules');
    }

    await pool.query(
      `INSERT INTO moderation_rules (tenant_id, rule_type, rule_value, action, created_by)
       VALUES ($1,$2,$3,$4,$5)`, [tid, ruleType, ruleValue, action, email]);
    audit('rule_created', { tenantId: tid, type: ruleType, value: ruleValue, action });
    res.redirect('/school/moderation/rules');
  }));

  // ═══════════════════════════════════════════════════════
  // 13. HISTORY — GET /school/moderation/history
  // ═══════════════════════════════════════════════════════
  app.get('/school/moderation/history', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const actionFilter = String(req.query.action || '').trim();

    let where = 'WHERE tenant_id=$1 AND status != $2';
    const params = [tid, 'pending'];
    let pi = 3;
    if (actionFilter && ['approved','rejected','flagged'].includes(actionFilter)) {
      where += ` AND status=$${pi++}`; params.push(actionFilter);
    }

    const [countR, rowsR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS total FROM moderation_queue ${where}`, params),
      pool.query(`SELECT * FROM moderation_queue ${where} ORDER BY moderated_at DESC NULLS LAST, created_at DESC LIMIT $${pi++} OFFSET $${pi++}`, [...params, limit, offset]),
    ]);
    const totalPages = Math.ceil((countR.rows[0]?.total || 0) / limit);

    let rows = '';
    rowsR.rows.forEach(r => {
      rows += `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 12px;font-size:13px">${typeIcon(r.content_type)} ${esc(r.content_type)}</td>
        <td style="padding:10px 12px;font-size:13px;color:#111827;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((r.content_text||'').slice(0,80))}</td>
        <td style="padding:10px 12px;font-size:13px">${esc(r.author_email||'unknown')}</td>
        <td style="padding:10px 12px">${badge(r.status)}</td>
        <td style="padding:10px 12px;font-size:13px">${esc(r.moderated_by||'—')}</td>
        <td style="padding:10px 12px;font-size:12px;color:#dc2626;max-width:150px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.rejection_reason||r.flag_reason||'—')}</td>
        <td style="padding:10px 12px;font-size:12px;color:#9ca3af">${r.moderated_at?.toISOString?.().slice(0,16)?.replace('T',' ') || r.created_at?.toISOString?.().slice(0,16)?.replace('T',' ') || ''}</td>
      </tr>`;
    });

    // Also get blocked user activity
    const blockedActivity = await pool.query(
      `SELECT * FROM blocked_users WHERE tenant_id=$1 ORDER BY blocked_at DESC LIMIT 10`, [tid]);

    let blockedRows = '';
    blockedActivity.rows.forEach(r => {
      blockedRows += `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 12px;font-size:13px;color:#111827">${esc(r.user_email||'N/A')}</td>
        <td style="padding:10px 12px;font-size:13px">${r.unblocked_at ? badge('unblocked') : badge('blocked')}</td>
        <td style="padding:10px 12px;font-size:13px">${esc(r.blocked_by||'admin')}</td>
        <td style="padding:10px 12px;font-size:12px;color:#9ca3af">${r.blocked_at?.toISOString?.().slice(0,16)?.replace('T',' ') || ''}</td>
      </tr>`;
    });

    let pager = '';
    if (totalPages > 1) {
      pager = `<div style="display:flex;gap:6px;justify-content:center;margin-top:16px">`;
      for (let i = 1; i <= Math.min(totalPages, 10); i++) {
        pager += `<a href="?page=${i}&action=${esc(actionFilter)}" style="padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;${i===page?'background:#4f46e5;color:#fff':'background:#fff;color:#374151;border:1px solid #d1d5db'}">${i}</a>`;
      }
      pager += '</div>';
    }

    const html = renderPage('Moderation History', `
      <link rel="stylesheet" href="/css/sk.css">
      <div style="max-width:1100px;margin:0 auto;padding:24px">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <a href="/school/moderation" style="color:#4f46e5;text-decoration:none;font-size:14px">← Dashboard</a>
          <h1 style="font-size:24px;font-weight:700;color:#111827;margin:0">📜 Moderation History</h1>
        </div>

        <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
          ${['','approved','rejected','flagged'].map(a =>
            `<a href="?action=${a}" style="padding:6px 14px;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;${a===actionFilter?'background:#4f46e5;color:#fff':'background:#fff;color:#374151;border:1px solid #d1d5db'}">${a||'All Actions'}</a>`
          ).join('')}
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:24px">
          <div style="padding:16px 20px;background:#f9fafb;border-bottom:1px solid #e5e7eb">
            <h2 style="font-size:15px;font-weight:700;color:#111827;margin:0">Content Moderation Log</h2>
          </div>
          <div style="overflow-x:auto">
            <table style="width:100%;border-collapse:collapse;min-width:800px" role="table" aria-label="Moderation history">
              <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
                <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Type</th>
                <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Content</th>
                <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Author</th>
                <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Status</th>
                <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Moderator</th>
                <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Reason</th>
                <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Date</th>
              </tr></thead>
              <tbody>${rows || '<tr><td colspan="7" style="padding:32px;text-align:center;color:#9ca3af;font-size:14px">No moderation history yet.</td></tr>'}</tbody>
            </table>
          </div>
        </div>
        ${pager}

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
          <div style="padding:16px 20px;background:#f9fafb;border-bottom:1px solid #e5e7eb">
            <h2 style="font-size:15px;font-weight:700;color:#111827;margin:0">Block/Unblock Activity</h2>
          </div>
          <table style="width:100%;border-collapse:collapse" role="table" aria-label="Block activity log">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">User Email</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Action</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">By</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Date</th>
            </tr></thead>
            <tbody>${blockedRows || '<tr><td colspan="4" style="padding:24px;text-align:center;color:#9ca3af;font-size:14px">No block activity.</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  console.log('[ContentModeration] 13 routes registered under /school/moderation');
};
