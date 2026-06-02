// ============================================================
// APPROVALS MODULE — Multi-Tenant SaaS Platform (Comfort Zone)
// Multi-step approval workflow engine with templates, requests,
// action trails, notifications, audit history, and JSON APIs.
// ============================================================
// Usage in server.js:
//   const approvals = require('./approvals');
//   approvals(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
const { migrateQuery } = require('./db');
module.exports = function approvals(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().slice(0, 10);
  const genToken = () => require('crypto').randomBytes(24).toString('hex');

  // -- status helpers ---------------------------------------------------
  function statusBadge(s) {
    const m = {
      pending: { bg: '#fef9c3', c: '#a16207' }, approved: { bg: '#dcfce7', c: '#16a34a' },
      rejected: { bg: '#fee2e2', c: '#dc2626' }, escalated: { bg: '#ffedd5', c: '#ea580c' },
      cancelled: { bg: '#f1f5f9', c: '#64748b' }
    };
    const v = m[s] || m.pending;
    return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${v.bg};color:${v.c}">${s || 'pending'}</span>`;
  }

  // -- shared CSS --------------------------------------------------------
  const AP_CSS = `<style>
    .ap-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .ap-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
    .ap-nav a:hover{background:#e2e8f0}.ap-nav a.active{background:#059669;color:#fff}
    .ap-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .ap-btn:hover{opacity:.9;transform:translateY(-1px)}
    .ap-btn-primary{background:#059669;color:#fff}.ap-btn-success{background:#16a34a;color:#fff}
    .ap-btn-danger{background:#fee2e2;color:#dc2626}.ap-btn-secondary{background:#f1f5f9;color:#475569}
    .ap-btn-warn{background:#ffedd5;color:#ea580c}
    .ap-table{width:100%;border-collapse:collapse;font-size:13px}
    .ap-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .ap-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
    .ap-table tr:hover{background:#f8fafc}
    .ap-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .ap-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
    .ap-filter input,.ap-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
    .ap-filter input:focus,.ap-filter select:focus{outline:none;border-color:#059669}
    .ap-card{background:#fff;border-radius:14px;border:1px solid #f1f5f9;padding:20px;margin-bottom:16px}
    .ap-pipeline{display:flex;align-items:center;gap:6px;margin:16px 0;flex-wrap:wrap}
    .ap-step{padding:8px 16px;border-radius:10px;font-size:12px;font-weight:600;border:2px solid #e2e8f0;background:#fff;color:#475569}
    .ap-step.done{border-color:#16a34a;background:#dcfce7;color:#16a34a}
    .ap-step.current{border-color:#059669;background:#d1fae5;color:#059669;box-shadow:0 0 0 3px rgba(5,150,105,.15)}
    .ap-arrow{color:#94a3b8;font-size:18px;font-weight:700}
    .ap-trail{border-left:3px solid #d1fae5;padding:10px 16px;margin:8px 0 8px 12px;background:#f0fdf4;border-radius:0 10px 10px 0}
    .ap-trail-action{font-size:13px;font-weight:600;color:#1e293b}
    .ap-trail-meta{font-size:11px;color:#94a3b8;margin-top:3px}
    @media(max-width:768px){.ap-nav{gap:4px}.ap-nav a{padding:6px 12px;font-size:12px}.ap-filter{flex-direction:column}}
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="ap-nav">
    <a href="/approvals" class="${active === 'dash' ? 'active' : ''}">📊 Dashboard</a>
    <a href="/approvals/workflows" class="${active === 'workflows' ? 'active' : ''}">⚙️ Workflows</a>
    <a href="/approvals/requests" class="${active === 'requests' ? 'active' : ''}">📋 Requests</a>
    <a href="/approvals/history" class="${active === 'history' ? 'active' : ''}">📜 History</a>
  </div>`;

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'Approvals', `CREATE TABLE IF NOT EXISTS approval_workflow_templates (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255), description TEXT, entity_type VARCHAR(100),
        is_active BOOLEAN DEFAULT true, created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Approvals', `CREATE TABLE IF NOT EXISTS approval_notifications (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        request_id INTEGER, recipient_id INTEGER, message TEXT,
        is_read BOOLEAN DEFAULT false, sent_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Approvals', `CREATE TABLE IF NOT EXISTS approval_workflows (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255), description TEXT, entity_type VARCHAR(100),
        is_active BOOLEAN DEFAULT true, created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Approvals', `CREATE TABLE IF NOT EXISTS approval_steps (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        workflow_id INTEGER, step_order INTEGER DEFAULT 1,
        step_name VARCHAR(255), approver_type VARCHAR(50), approver_id INTEGER,
        action_required VARCHAR(50) DEFAULT 'approve', is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Approvals', `CREATE TABLE IF NOT EXISTS approval_actions (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        request_id INTEGER, step_id INTEGER, action VARCHAR(50),
        actor_id INTEGER, actor_name VARCHAR(255), comments TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Approvals', `CREATE TABLE IF NOT EXISTS approval_requests (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        workflow_id INTEGER, entity_type VARCHAR(100), entity_id INTEGER,
        title VARCHAR(500), description TEXT, requester_id INTEGER, requester_name VARCHAR(255),
        status VARCHAR(50) DEFAULT 'pending', current_step INTEGER DEFAULT 1,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await migrateQuery(pool, 'Approvals', `CREATE INDEX IF NOT EXISTS idx_aw_tenant ON approval_workflows(tenant_id)`);
      await migrateQuery(pool, 'Approvals', `CREATE INDEX IF NOT EXISTS idx_as_workflow ON approval_steps(workflow_id)`);
      await migrateQuery(pool, 'Approvals', `CREATE INDEX IF NOT EXISTS idx_ar_tenant ON approval_requests(tenant_id)`);
      await migrateQuery(pool, 'Approvals', `CREATE INDEX IF NOT EXISTS idx_ar_status ON approval_requests(tenant_id, status)`);
      await migrateQuery(pool, 'Approvals', `CREATE INDEX IF NOT EXISTS idx_aa_request ON approval_actions(request_id)`);
      await migrateQuery(pool, 'Approvals', `CREATE INDEX IF NOT EXISTS idx_an_recipient ON approval_notifications(recipient_id, is_read)`);
      await migrateQuery(pool, 'Approvals', `CREATE INDEX IF NOT EXISTS idx_awt_tenant ON approval_workflow_templates(tenant_id)`);
      console.log('[Approvals] Migrations applied successfully');
    } catch (e) { /* migration OK */ }
  })();

  // ============================================================
  // ROUTE 1: GET /approvals — Dashboard
  // ============================================================
  app.get('/approvals', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const pendingCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM approval_requests WHERE tenant_id=$1 AND status='pending'`, [tid])).rows[0].cnt;
    const approvedCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM approval_requests WHERE tenant_id=$1 AND status='approved'`, [tid])).rows[0].cnt;
    const rejectedCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM approval_requests WHERE tenant_id=$1 AND status='rejected'`, [tid])).rows[0].cnt;
    const totalCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM approval_requests WHERE tenant_id=$1`, [tid])).rows[0].cnt;
    const workflowCount = (await pool.query(`SELECT COUNT(*)::int as cnt FROM approval_workflows WHERE tenant_id=$1 AND is_active=true`, [tid])).rows[0].cnt;
    const recentActions = (await pool.query(
      `SELECT aa.*, ar.title as request_title FROM approval_actions aa JOIN approval_requests ar ON ar.id=aa.request_id WHERE aa.tenant_id=$1 ORDER BY aa.created_at DESC LIMIT 12`, [tid]
    )).rows;
    const myPending = (await pool.query(
      `SELECT ar.* FROM approval_requests ar JOIN approval_steps ast ON ast.workflow_id=ar.workflow_id AND ast.step_order=ar.current_step WHERE ar.tenant_id=$1 AND ar.status='pending' AND (ast.approver_id=$2 OR ast.approver_type='any') ORDER BY ar.created_at DESC LIMIT 8`,
      [tid, user.id]
    )).rows;

    const recentHtml = recentActions.map(a => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid #f1f5f9">
      <div><span style="font-weight:600;color:#1e293b;font-size:13px">${esc(a.request_title || 'Request #' + a.request_id)}</span>
        <span style="margin-left:8px">${statusBadge(a.action)}</span></div>
      <div style="font-size:11px;color:#94a3b8">${esc(a.actor_name || '')} — ${fmtDateTime(a.created_at)}</div>
    </div>`).join('');

    const myPendingHtml = myPending.map(r => `<tr>
      <td><a href="/approvals/requests/${r.id}" style="color:#059669;text-decoration:none;font-weight:600">${esc(r.title)}</a></td>
      <td>${esc(r.requester_name || '—')}</td>
      <td>${esc(r.entity_type || '—')}</td>
      <td>Step ${r.current_step}</td>
      <td>${fmtDate(r.created_at)}</td>
    </tr>`).join('');

    const html = AP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">✅ Approvals Dashboard</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage approval workflows and requests</p></div>
        <div style="display:flex;gap:8px">
          <a href="/approvals/workflows" class="ap-btn ap-btn-primary">⚙️ Manage Workflows</a>
          <a href="/approvals/requests" class="ap-btn ap-btn-secondary">📋 All Requests</a>
        </div>
      </div>
      <div class="stats" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#a16207">${pendingCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Pending</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${approvedCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Approved</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${rejectedCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Rejected</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${workflowCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Active Workflows</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${totalCount}</div><div class="muted" style="font-size:11px;text-transform:uppercase;letter-spacing:.3px">Total Requests</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="ap-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">⏳ Awaiting My Action (${myPending.length})</h3>
          <div style="overflow-x:auto"><table class="ap-table">
            <thead><tr><th>Title</th><th>Requester</th><th>Type</th><th>Step</th><th>Date</th></tr></thead>
            <tbody>${myPendingHtml || '<tr><td colspan="5" style="text-align:center;color:#94a3b8;padding:20px">No pending requests for you</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="ap-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🕐 Recent Activity</h3>
          ${recentHtml || '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">No recent activity</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Approvals Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /approvals/workflows — Workflow management
  // ============================================================
  app.get('/approvals/workflows', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const workflows = (await pool.query(
      `SELECT aw.*, (SELECT COUNT(*)::int FROM approval_steps WHERE workflow_id=aw.id) as step_count, (SELECT COUNT(*)::int FROM approval_requests WHERE workflow_id=aw.id) as request_count FROM approval_workflows aw WHERE aw.tenant_id=$1 ORDER BY aw.created_at DESC`, [tid]
    )).rows;
    const templates = (await pool.query(`SELECT * FROM approval_workflow_templates WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const wfRows = workflows.map(w => `<tr>
      <td><a href="/approvals/workflows/${w.id}" style="color:#059669;text-decoration:none;font-weight:600">${esc(w.name)}</a></td>
      <td>${esc(w.description || '—')}</td>
      <td>${esc(w.entity_type || '—')}</td>
      <td><span style="font-weight:600;color:#4f46e5">${w.step_count}</span></td>
      <td>${w.request_count}</td>
      <td>${w.is_active ? '<span style="color:#16a34a;font-weight:600">Active</span>' : '<span style="color:#94a3b8">Inactive</span>'}</td>
      <td>${fmtDate(w.created_at)}</td>
    </tr>`).join('');

    const tmplRows = templates.map(t => `<tr>
      <td><strong>${esc(t.name)}</strong></td>
      <td>${esc(t.entity_type || '—')}</td>
      <td>${t.is_active ? '<span style="color:#16a34a">Active</span>' : '<span style="color:#94a3b8">Inactive</span>'}</td>
      <td><form method="POST" action="/approvals/workflows" style="display:inline"><input type="hidden" name="template_id" value="${t.id}"><button class="ap-btn ap-btn-secondary" style="padding:4px 12px;font-size:11px">Use Template</button></form></td>
    </tr>`).join('');

    const html = AP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('workflows')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">⚙️ Approval Workflows</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Define multi-step approval pipelines</p></div>
        <a href="/approvals/workflows/new" class="ap-btn ap-btn-primary">➕ Create Workflow</a>
      </div>
      <div class="ap-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Workflow Definitions</h3>
        <div style="overflow-x:auto"><table class="ap-table">
          <thead><tr><th>Name</th><th>Description</th><th>Entity</th><th>Steps</th><th>Requests</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>${wfRows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No workflows defined yet</td></tr>'}</tbody>
        </table></div>
      </div>
      ${templates.length ? `<div class="ap-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📦 Workflow Templates</h3>
        <div style="overflow-x:auto"><table class="ap-table">
          <thead><tr><th>Name</th><th>Entity Type</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>${tmplRows}</tbody>
        </table></div>
      </div>` : ''}
    </div>`;
    res.send(renderPage('Approval Workflows', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /approvals/workflows — Create workflow
  // ============================================================
  app.post('/approvals/workflows', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { template_id, name, description, entity_type } = req.body;

    let wfName = name, wfDesc = description, wfEntity = entity_type;
    if (template_id) {
      const tmpl = (await pool.query(`SELECT * FROM approval_workflow_templates WHERE id=$1 AND tenant_id=$2`, [template_id, tid])).rows[0];
      if (tmpl) { wfName = wfName || tmpl.name; wfDesc = wfDesc || tmpl.description; wfEntity = wfEntity || tmpl.entity_type; }
    }
    if (!wfName || !wfName.trim()) return res.redirect('/approvals/workflows');

    const wf = await pool.query(
      `INSERT INTO approval_workflows (tenant_id, name, description, entity_type, is_active, created_by) VALUES ($1,$2,$3,$4,true,$5) RETURNING id`,
      [tid, wfName.trim(), (wfDesc || '').trim(), (wfEntity || 'general').trim(), user.id]
    );
    res.redirect('/approvals/workflows/' + wf.rows[0].id);
  }));

  // ============================================================
  // ROUTE 4: GET /approvals/workflows/:id — Workflow detail
  // ============================================================
  app.get('/approvals/workflows/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, wfId = req.params.id;
    const wf = (await pool.query(`SELECT * FROM approval_workflows WHERE id=$1 AND tenant_id=$2`, [wfId, tid])).rows[0];
    if (!wf) return res.send(renderPage('Not Found', '<div class="ap-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Workflow not found</h2><a href="/approvals/workflows" class="ap-btn ap-btn-primary" style="margin-top:12px">← Back</a></div>', user, req));

    const steps = (await pool.query(`SELECT * FROM approval_steps WHERE workflow_id=$1 AND tenant_id=$2 ORDER BY step_order`, [wfId, tid])).rows;
    const pipelineHtml = steps.map((s, i) => `<div class="ap-step ${i === 0 ? 'current' : ''}">${esc(s.step_name || 'Step ' + s.step_order)}<br><span style="font-size:10px;color:#94a3b8">${esc(s.approver_type)} ${s.approver_id ? '(ID: ' + s.approver_id + ')' : ''}</span></div>${i < steps.length - 1 ? '<span class="ap-arrow">→</span>' : ''}`).join('');

    const stepsHtml = steps.map(s => `<tr>
      <td style="font-weight:700;color:#1e293b">${s.step_order}</td>
      <td>${esc(s.step_name || 'Step ' + s.step_order)}</td>
      <td>${esc(s.approver_type || '—')}</td>
      <td>${s.approver_id || '—'}</td>
      <td>${esc(s.action_required || 'approve')}</td>
      <td>${s.is_active ? '<span style="color:#16a34a">Active</span>' : '<span style="color:#94a3b8">Inactive</span>'}</td>
      <td>
        <form method="POST" action="/approvals/workflows/${wfId}/steps/delete" style="display:inline" onsubmit="return confirm('Delete this step?')">
          <input type="hidden" name="step_id" value="${s.id}">
          <button class="ap-btn ap-btn-danger" style="padding:3px 10px;font-size:11px">Delete</button>
        </form>
      </td>
    </tr>`).join('');

    const html = AP_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('workflows')}
      <a href="/approvals/workflows" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Workflows</a>
      <div class="ap-card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="margin:0 0 6px;color:#1e293b;font-size:22px">${esc(wf.name)}</h1>
            <p style="font-size:13px;color:#94a3b8;margin:0">${esc(wf.description || '')} — Entity: <strong>${esc(wf.entity_type)}</strong> — ${wf.is_active ? '<span style="color:#16a34a">Active</span>' : '<span style="color:#94a3b8">Inactive</span>'}</p>
          </div>
          <div>
            <a href="/approvals/requests/new?workflow_id=${wf.id}" class="ap-btn ap-btn-primary">📋 New Request</a>
          </div>
        </div>
      </div>
      <div class="ap-card" style="margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 10px">Workflow Pipeline</h3>
        <div class="ap-pipeline">${pipelineHtml || '<span style="color:#94a3b8;font-size:13px">No steps defined</span>'}</div>
      </div>
      <div class="ap-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3 style="margin:0;color:#1e293b;font-size:15px">Workflow Steps (${steps.length})</h3>
        </div>
        <form method="POST" action="/approvals/workflows/${wfId}/steps" style="display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end;background:#f8fafc;padding:14px;border-radius:10px">
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Step Name</label><input type="text" name="step_name" required placeholder="e.g. Manager Review" style="padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Approver Type</label><select name="approver_type" style="padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"><option value="specific">Specific User</option><option value="role">By Role</option><option value="any">Any Approver</option></select></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Approver ID</label><input type="number" name="approver_id" placeholder="User ID" style="width:100px;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"></div>
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Action</label><select name="action_required" style="padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"><option value="approve">Approve/Reject</option><option value="review">Review</option><option value="sign">Sign Off</option></select></div>
          <button type="submit" class="ap-btn ap-btn-primary" style="padding:8px 18px">➕ Add Step</button>
        </form>
        <div style="overflow-x:auto"><table class="ap-table">
          <thead><tr><th>#</th><th>Name</th><th>Approver</th><th>ID</th><th>Action</th><th>Status</th><th>Del</th></tr></thead>
          <tbody>${stepsHtml || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:20px">No steps yet. Add the first step above.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Workflow: ' + wf.name, html, user, req));
  }));

  // ============================================================
  // ROUTE 5: POST /approvals/workflows/:id/steps — Add step
  // ============================================================
  app.post('/approvals/workflows/:id/steps', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, wfId = req.params.id;
    const { step_name, approver_type, approver_id, action_required } = req.body;
    if (!step_name) return res.redirect('/approvals/workflows/' + wfId);
    const maxOrder = (await pool.query(`SELECT COALESCE(MAX(step_order), 0) as m FROM approval_steps WHERE workflow_id=$1 AND tenant_id=$2`, [wfId, tid])).rows[0].m;
    await pool.query(
      `INSERT INTO approval_steps (tenant_id, workflow_id, step_order, step_name, approver_type, approver_id, action_required) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, wfId, maxOrder + 1, step_name.trim(), approver_type || 'specific', approver_id || null, action_required || 'approve']
    );
    res.redirect('/approvals/workflows/' + wfId);
  }));

  app.post('/approvals/workflows/:id/steps/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, wfId = req.params.id;
    const { step_id } = req.body;
    if (step_id) await pool.query(`DELETE FROM approval_steps WHERE id=$1 AND tenant_id=$2 AND workflow_id=$3`, [step_id, tid, wfId]);
    res.redirect('/approvals/workflows/' + wfId);
  }));

  // ============================================================
  // ROUTE 6: GET /approvals/requests — Request list
  // ============================================================
  app.get('/approvals/requests', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status, entity_type, page = 1 } = req.query;
    let where = ['ar.tenant_id=$1'], params = [tid], pi = 2;
    if (status) { where.push(`ar.status=$${pi++}`); params.push(status); }
    if (entity_type) { where.push(`ar.entity_type=$${pi++}`); params.push(entity_type); }
    const limit = 25, offset = (parseInt(page) - 1) * limit;
    const countR = (await pool.query(`SELECT COUNT(*) as cnt FROM approval_requests ar WHERE ${where.join(' AND ')}`, params)).rows[0].cnt;
    const totalPages = Math.ceil(countR / limit);
    const requests = (await pool.query(
      `SELECT ar.*, aw.name as workflow_name FROM approval_requests ar LEFT JOIN approval_workflows aw ON aw.id=ar.workflow_id WHERE ${where.join(' AND ')} ORDER BY ar.created_at DESC LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, limit, offset]
    )).rows;

    const rows = requests.map(r => `<tr>
      <td><a href="/approvals/requests/${r.id}" style="color:#059669;text-decoration:none;font-weight:600">${esc(r.title)}</a></td>
      <td>${esc(r.workflow_name || '—')}</td>
      <td>${esc(r.requester_name || '—')}</td>
      <td>${esc(r.entity_type || '—')}</td>
      <td>Step ${r.current_step}</td>
      <td>${statusBadge(r.status)}</td>
      <td>${fmtDate(r.created_at)}</td>
    </tr>`).join('');

    const pageLinks = Array.from({ length: Math.min(totalPages, 10) }, (_, i) =>
      `<a href="/approvals/requests?page=${i + 1}&status=${status || ''}&entity_type=${entity_type || ''}" class="ap-btn ${parseInt(page) === i + 1 ? 'ap-btn-primary' : 'ap-btn-secondary'}" style="padding:4px 10px;font-size:12px">${i + 1}</a>`
    ).join('');

    const html = AP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('requests')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:24px;color:#1e293b">📋 Approval Requests</h1>
        <a href="/approvals/requests/new" class="ap-btn ap-btn-primary">➕ New Request</a>
      </div>
      <div class="ap-filter">
        <div><label>Status</label><select onchange="location.href='/approvals/requests?status='+this.value"><option value="">All</option>
          ${['pending','approved','rejected','escalated','cancelled'].map(s => `<option value="${s}" ${status===s?'selected':''}>${s}</option>`).join('')}
        </select></div>
        <div><label>Entity Type</label><select onchange="location.href='/approvals/requests?entity_type='+this.value"><option value="">All</option>
          <option value="leave" ${entity_type==='leave'?'selected':''}>Leave</option>
          <option value="purchase" ${entity_type==='purchase'?'selected':''}>Purchase</option>
          <option value="expense" ${entity_type==='expense'?'selected':''}>Expense</option>
          <option value="general" ${entity_type==='general'?'selected':''}>General</option>
        </select></div>
      </div>
      <div class="ap-card">
        <div style="overflow-x:auto"><table class="ap-table">
          <thead><tr><th>Title</th><th>Workflow</th><th>Requester</th><th>Type</th><th>Step</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No approval requests found</td></tr>'}</tbody>
        </table></div>
        ${totalPages > 1 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px"><span style="font-size:13px;color:#64748b">${countR} requests — Page ${page} of ${totalPages}</span><div style="display:flex;gap:4px">${pageLinks}</div></div>` : ''}
      </div>
    </div>`;
    res.send(renderPage('Approval Requests', html, user, req));
  }));

  // ============================================================
  // ROUTE 7: GET /approvals/requests/:id — Request detail
  // ============================================================
  app.get('/approvals/requests/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, reqId = req.params.id;
    const request = (await pool.query(
      `SELECT ar.*, aw.name as workflow_name FROM approval_requests ar LEFT JOIN approval_workflows aw ON aw.id=ar.workflow_id WHERE ar.id=$1 AND ar.tenant_id=$2`, [reqId, tid]
    )).rows[0];
    if (!request) return res.send(renderPage('Not Found', '<div class="ap-card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Request not found</h2></div>', user, req));

    const steps = (await pool.query(`SELECT * FROM approval_steps WHERE workflow_id=$1 AND tenant_id=$2 ORDER BY step_order`, [request.workflow_id, tid])).rows;
    const actions = (await pool.query(`SELECT * FROM approval_actions WHERE request_id=$1 AND tenant_id=$2 ORDER BY created_at`, [reqId, tid])).rows;

    const pipelineHtml = steps.map((s, i) => {
      const stepNum = i + 1;
      const cls = stepNum < request.current_step ? 'done' : stepNum === request.current_step && request.status === 'pending' ? 'current' : '';
      return `<div class="ap-step ${cls}">${esc(s.step_name || 'Step ' + stepNum)}${cls === 'done' ? ' ✓' : ''}</div>${i < steps.length - 1 ? '<span class="ap-arrow">→</span>' : ''}`;
    }).join('');

    const trailHtml = actions.map(a => `<div class="ap-trail">
      <div class="ap-trail-action">${statusBadge(a.action)} ${esc(a.actor_name || 'System')}</div>
      ${a.comments ? `<div style="font-size:13px;color:#334155;margin-top:4px">${esc(a.comments)}</div>` : ''}
      <div class="ap-trail-meta">${fmtDateTime(a.created_at)}</div>
    </div>`).join('');

    const html = AP_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('requests')}
      <a href="/approvals/requests" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Requests</a>
      <div class="ap-card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="margin:0 0 6px;color:#1e293b;font-size:22px">${esc(request.title)}</h1>
            <p style="font-size:13px;color:#94a3b8;margin:0">Workflow: <strong>${esc(request.workflow_name || '—')}</strong> — Requester: <strong>${esc(request.requester_name || '—')}</strong></p>
          </div>
          ${statusBadge(request.status)}
        </div>
        ${request.description ? `<div style="margin-top:14px;padding:14px;background:#f8fafc;border-radius:10px;font-size:14px;color:#334155;white-space:pre-wrap">${esc(request.description)}</div>` : ''}
      </div>
      <div class="ap-card" style="margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 10px">Pipeline Progress</h3>
        <div class="ap-pipeline">${pipelineHtml}</div>
        <div style="font-size:12px;color:#94a3b8;margin-top:8px">Current Step: ${request.current_step} of ${steps.length} — Type: ${esc(request.entity_type)} — Created: ${fmtDateTime(request.created_at)}</div>
      </div>
      ${request.status === 'pending' ? `<div class="ap-card" style="border:2px solid #059669;margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📝 Take Action</h3>
        <form method="POST" action="/approvals/requests/${request.id}/action" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
          <div><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Action</label>
            <select name="action" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
              <option value="approved">Approve</option><option value="rejected">Reject</option><option value="escalated">Escalate</option>
            </select></div>
          <div style="flex:1;min-width:250px"><label style="font-size:12px;font-weight:600;color:#64748b;display:block;margin-bottom:4px">Comments</label>
            <textarea name="comments" rows="2" placeholder="Add comments..." style="width:100%;padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;resize:vertical"></textarea></div>
          <button type="submit" class="ap-btn ap-btn-primary">Submit Action</button>
        </form>
      </div>` : ''}
      <div class="ap-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📜 Approval Trail</h3>
        ${trailHtml || '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">No actions recorded yet</p>'}
      </div>
    </div>`;
    res.send(renderPage('Request: ' + request.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 8: POST /approvals/requests — Submit new request
  // ============================================================
  app.get('/approvals/requests/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const workflows = (await pool.query(`SELECT id, name, entity_type FROM approval_workflows WHERE tenant_id=$1 AND is_active=true ORDER BY name`, [tid])).rows;
    const html = AP_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('requests')}
      <a href="/approvals/requests" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Requests</a>
      <div class="ap-card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">📋 New Approval Request</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Submit a new request to an approval workflow</p>
        <form method="POST" action="/approvals/requests" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Workflow *</label>
            <select name="workflow_id" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
              <option value="">Select workflow</option>
              ${workflows.map(w => `<option value="${w.id}" ${req.query.workflow_id == w.id ? 'selected' : ''}>${esc(w.name)} (${esc(w.entity_type)})</option>`).join('')}
            </select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Title *</label>
            <input type="text" name="title" required placeholder="Request title" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="4" placeholder="Describe what needs approval..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Entity Type</label>
              <input type="text" name="entity_type" placeholder="e.g. leave, purchase" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Entity ID</label>
              <input type="number" name="entity_id" placeholder="Optional" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="ap-btn ap-btn-primary" style="padding:12px 28px">📤 Submit Request</button>
            <a href="/approvals/requests" class="ap-btn ap-btn-secondary" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Approval Request', html, user, req));
  }));

  app.post('/approvals/requests', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { workflow_id, title, description, entity_type, entity_id } = req.body;
    if (!workflow_id || !title) return res.redirect('/approvals/requests/new');
    const result = await pool.query(
      `INSERT INTO approval_requests (tenant_id, workflow_id, entity_type, entity_id, title, description, requester_id, requester_name, status, current_step) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'pending',1) RETURNING id`,
      [tid, workflow_id, (entity_type || '').trim() || null, entity_id || null, title.trim(), (description || '').trim(), user.id, user.name || user.email]
    );
    await pool.query(`INSERT INTO approval_notifications (tenant_id, request_id, recipient_id, message) VALUES ($1,$2,$3,$4)`,
      [tid, result.rows[0].id, null, `New approval request: "${title.trim()}" submitted by ${user.name || user.email}`]);
    res.redirect('/approvals/requests/' + result.rows[0].id);
  }));

  // ============================================================
  // ROUTE 9: POST /approvals/requests/:id/action — Approve/reject
  // ============================================================
  app.post('/approvals/requests/:id/action', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, reqId = req.params.id;
    const { action, comments } = req.body;
    const request = (await pool.query(`SELECT * FROM approval_requests WHERE id=$1 AND tenant_id=$2 AND status='pending'`, [reqId, tid])).rows[0];
    if (!request) return res.redirect('/approvals/requests/' + reqId);

    await pool.query(
      `INSERT INTO approval_actions (tenant_id, request_id, step_id, action, actor_id, actor_name, comments) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [tid, reqId, null, action, user.id, user.name || user.email, (comments || '').trim()]
    );

    if (action === 'approved') {
      const steps = (await pool.query(`SELECT COUNT(*)::int as cnt FROM approval_steps WHERE workflow_id=$1 AND tenant_id=$2`, [request.workflow_id, tid])).rows[0].cnt;
      if (request.current_step >= steps) {
        await pool.query(`UPDATE approval_requests SET status='approved', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [reqId, tid]);
      } else {
        await pool.query(`UPDATE approval_requests SET current_step=current_step+1, updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [reqId, tid]);
      }
    } else if (action === 'rejected') {
      await pool.query(`UPDATE approval_requests SET status='rejected', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [reqId, tid]);
    } else if (action === 'escalated') {
      await pool.query(`UPDATE approval_requests SET status='escalated', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [reqId, tid]);
    }

    await pool.query(`INSERT INTO approval_notifications (tenant_id, request_id, recipient_id, message) VALUES ($1,$2,$3,$4)`,
      [tid, reqId, request.requester_id, `Request "${request.title}" was ${action} by ${user.name || user.email}`]);
    res.redirect('/approvals/requests/' + reqId);
  }));

  // ============================================================
  // ROUTE 10: GET /approvals/history — Audit trail
  // ============================================================
  app.get('/approvals/history', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { action_type, page = 1 } = req.query;
    let where = ['aa.tenant_id=$1'], params = [tid], pi = 2;
    if (action_type) { where.push(`aa.action=$${pi++}`); params.push(action_type); }
    const limit = 30, offset = (parseInt(page) - 1) * limit;
    const countR = (await pool.query(`SELECT COUNT(*) as cnt FROM approval_actions aa WHERE ${where.join(' AND ')}`, params)).rows[0].cnt;
    const totalPages = Math.ceil(countR / limit);
    const history = (await pool.query(
      `SELECT aa.*, ar.title as request_title, ar.requester_name FROM approval_actions aa LEFT JOIN approval_requests ar ON ar.id=aa.request_id WHERE ${where.join(' AND ')} ORDER BY aa.created_at DESC LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, limit, offset]
    )).rows;

    const rows = history.map(h => `<tr>
      <td><a href="/approvals/requests/${h.request_id}" style="color:#059669;text-decoration:none;font-weight:600">${esc(h.request_title || 'Request #' + h.request_id)}</a></td>
      <td>${statusBadge(h.action)}</td>
      <td>${esc(h.actor_name || '—')}</td>
      <td>${esc(h.requester_name || '—')}</td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(h.comments || '—')}</td>
      <td>${fmtDateTime(h.created_at)}</td>
    </tr>`).join('');

    const html = AP_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('history')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📜 Approval History</h1>
      <div class="ap-filter">
        <div><label>Action Type</label><select onchange="location.href='/approvals/history?action_type='+this.value"><option value="">All</option>
          ${['approved','rejected','escalated'].map(a => `<option value="${a}" ${action_type===a?'selected':''}>${a}</option>`).join('')}
        </select></div>
      </div>
      <div class="ap-card">
        <div style="overflow-x:auto"><table class="ap-table">
          <thead><tr><th>Request</th><th>Action</th><th>Actor</th><th>Requester</th><th>Comments</th><th>Date</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No history records</td></tr>'}</tbody>
        </table></div>
        ${totalPages > 1 ? `<div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px"><span style="font-size:13px;color:#64748b">${countR} records — Page ${page} of ${totalPages}</span>
          <div style="display:flex;gap:4px">${Array.from({ length: Math.min(totalPages, 10) }, (_, i) => `<a href="/approvals/history?page=${i+1}&action_type=${action_type||''}" class="ap-btn ${parseInt(page)===i+1?'ap-btn-primary':'ap-btn-secondary'}" style="padding:4px 10px;font-size:12px">${i+1}</a>`).join('')}</div></div>` : ''}
      </div>
    </div>`;
    res.send(renderPage('Approval History', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: GET /approvals/api/pending — JSON API
  // ============================================================
  app.get('/approvals/api/pending', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const pending = (await pool.query(`SELECT COUNT(*)::int as cnt FROM approval_requests WHERE tenant_id=$1 AND status='pending'`, [tid])).rows[0].cnt;
    const myPending = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM approval_requests ar JOIN approval_steps ast ON ast.workflow_id=ar.workflow_id AND ast.step_order=ar.current_step WHERE ar.tenant_id=$1 AND ar.status='pending' AND (ast.approver_id=$2 OR ast.approver_type='any')`,
      [tid, user.id]
    )).rows[0].cnt;
    res.json({ total_pending: pending, my_pending: myPending, timestamp: new Date().toISOString() });
  }));

  // ============================================================
  // ROUTE 12: GET /approvals/api/workflows — JSON API
  // ============================================================
  app.get('/approvals/api/workflows', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const workflows = (await pool.query(`SELECT id, name, entity_type, is_active, created_at FROM approval_workflows WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    res.json({ workflows, count: workflows.length });
  }));

  console.log('[Approvals] Module loaded');
};
