// ============================================================
// WORKFLOW AUTOMATION & APPROVALS — SSEWASSWA Comfort Platform
// Approval workflows, step-based routing, pipeline visualization,
// comment threads, notifications, audit logging, and statistics.
// ============================================================
// Usage in server.js:
//   const workflowAutomation = require('./workflow-automation');
//   workflowAutomation(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const { migrateQuery } = require('./db');
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const formatDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
const fmtDur = (ms) => { if (!ms || ms < 0) return '—'; const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000); return h > 0 ? `${h}h ${m}m` : `${m}m`; };

function statusBadge(s) {
  const m = { pending: { bg: '#fef9c3', c: '#a16207', l: '⏳ Pending' }, approved: { bg: '#dcfce7', c: '#16a34a', l: '✅ Approved' }, rejected: { bg: '#fee2e2', c: '#dc2626', l: '❌ Rejected' }, cancelled: { bg: '#f1f5f9', c: '#64748b', l: '🚫 Cancelled' } };
  const v = m[s] || m.pending;
  return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${v.bg};color:${v.c}">${v.l}</span>`;
}
function entityBadge(t) {
  const m = { leave: '🏖 Leave', expense: '💰 Expense', purchase: '🛒 Purchase', asset: '🖥 Asset', custom: '⚙️ Custom' };
  return `<span style="display:inline-block;padding:3px 10px;border-radius:8px;font-size:11px;font-weight:600;background:#eef2ff;color:#4f46e5">${m[t] || t}</span>`;
}
function stepTypeBadge(t) {
  const m = { approve: { bg: '#dcfce7', c: '#16a34a' }, review: { bg: '#dbeafe', c: '#2563eb' }, notify: { bg: '#fef3c7', c: '#d97706' } };
  const v = m[t] || m.approve;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:11px;font-weight:700;background:${v.bg};color:${v.c}">${t}</span>`;
}
function activeBadge(a) {
  return a ? '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#dcfce7;color:#16a34a">● Active</span>' : '<span style="display:inline-block;padding:3px 10px;border-radius:12px;font-size:11px;font-weight:700;background:#f1f5f9;color:#94a3b8">○ Inactive</span>';
}

// Shared CSS
const WA_CSS = `<style>
.wa-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.wa-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.wa-nav a:hover{background:#e2e8f0}.wa-nav a.active{background:#4f46e5;color:#fff}
.wa-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px}
.wa-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center}
.wa-stat-val{font-size:28px;font-weight:800;color:#1e293b}.wa-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
.wa-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.wa-btn:hover{opacity:.9;transform:translateY(-1px)}
.wa-btn-primary{background:#4f46e5;color:#fff}.wa-btn-success{background:#059669;color:#fff}.wa-btn-danger{background:#fee2e2;color:#dc2626}.wa-btn-secondary{background:#f1f5f9;color:#475569}.wa-btn-warn{background:#fef3c7;color:#d97706}
.wa-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;transition:.15s}
.wa-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06)}
.wa-table{width:100%;border-collapse:collapse;font-size:13px}
.wa-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.wa-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}.wa-table tr:hover{background:#f8fafc}
.wa-pipeline{display:flex;align-items:center;gap:0;margin:16px 0;flex-wrap:nowrap;overflow-x:auto;padding:8px 0}
.wa-pipe-step{display:flex;flex-direction:column;align-items:center;min-width:120px;position:relative}
.wa-pipe-circle{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:#fff;border:3px solid #e2e8f0;transition:.2s}
.wa-pipe-circle.done{background:#22c55e;border-color:#22c55e}.wa-pipe-circle.current{background:#3b82f6;border-color:#3b82f6;box-shadow:0 0 0 4px rgba(59,130,246,.2)}.wa-pipe-circle.pending{background:#e2e8f0;border-color:#cbd5e1;color:#94a3b8}.wa-pipe-circle.rejected{background:#ef4444;border-color:#ef4444}
.wa-pipe-label{font-size:11px;font-weight:600;color:#475569;margin-top:6px;text-align:center;max-width:100px}
.wa-pipe-sub{font-size:10px;color:#94a3b8;margin-top:2px}
.wa-pipe-connector{width:40px;height:3px;background:#e2e8f0;flex-shrink:0;margin-bottom:30px}
.wa-pipe-connector.done{background:#22c55e}.wa-pipe-connector.active{background:#3b82f6}
.wa-timeline{position:relative;padding-left:24px;border-left:3px solid #e2e8f0;margin:16px 0}
.wa-tl-item{position:relative;margin-bottom:16px;padding-left:16px}
.wa-tl-dot{position:absolute;left:-32px;top:2px;width:16px;height:16px;border-radius:50%;border:3px solid #fff;box-shadow:0 0 0 2px #e2e8f0}
.wa-tl-dot.approved{background:#22c55e;box-shadow:0 0 0 2px #22c55e}.wa-tl-dot.rejected{background:#ef4444;box-shadow:0 0 0 2px #ef4444}.wa-tl-dot.commented{background:#3b82f6;box-shadow:0 0 0 2px #3b82f6}
.wa-inbox-tabs{display:flex;gap:4px;margin-bottom:16px;background:#f1f5f9;border-radius:12px;padding:4px}
.wa-tab{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;transition:.15s;position:relative}
.wa-tab.active{background:#fff;color:#4f46e5;box-shadow:0 1px 3px rgba(0,0,0,.08)}.wa-tab:hover{color:#1e293b}
.wa-badge{position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;font-size:10px;font-weight:800;padding:1px 6px;border-radius:10px;min-width:18px;text-align:center}
.wa-req-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;margin-bottom:10px;cursor:pointer;transition:.15s;border-left:4px solid #eab308}
.wa-req-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-1px)}
.wa-input{padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;width:100%;transition:.15s}
.wa-input:focus{outline:none;border-color:#6366f1;background:#fff}
.wa-label{font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px}
@media(max-width:768px){.wa-stats{grid-template-columns:1fr 1fr}.wa-pipeline{flex-wrap:wrap}.wa-pipe-connector{width:20px}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function workflowAutomation(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  if (!ah) ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS approval_workflows (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL, description TEXT, entity_type VARCHAR(50) NOT NULL DEFAULT 'custom',
      trigger_event VARCHAR(100), is_active BOOLEAN DEFAULT true,
      created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS approval_steps (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id INTEGER NOT NULL REFERENCES approval_workflows(id) ON DELETE CASCADE,
      step_order INTEGER NOT NULL, step_type VARCHAR(20) NOT NULL DEFAULT 'approve',
      assignee_email VARCHAR(255), title VARCHAR(255) NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS approval_requests (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      workflow_id INTEGER REFERENCES approval_workflows(id) ON DELETE SET NULL,
      requester_email VARCHAR(255) NOT NULL, entity_type VARCHAR(50), entity_id VARCHAR(255),
      title VARCHAR(500) NOT NULL, description TEXT,
      status VARCHAR(20) DEFAULT 'pending', current_step INTEGER DEFAULT 1,
      created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS approval_actions (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      request_id INTEGER NOT NULL REFERENCES approval_requests(id) ON DELETE CASCADE,
      step_id INTEGER REFERENCES approval_steps(id) ON DELETE SET NULL,
      actor_email VARCHAR(255) NOT NULL, action VARCHAR(20) NOT NULL,
      comment TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_wf_tenant ON approval_workflows(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_wf_active ON approval_workflows(tenant_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_as_wf ON approval_steps(workflow_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ar_tenant ON approval_requests(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ar_status ON approval_requests(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_ar_requester ON approval_requests(tenant_id, requester_email)`,
    `CREATE INDEX IF NOT EXISTS idx_aa_request ON approval_actions(request_id)`
  ];

  (async () => {
    try { for (const sql of migrations) await migrateQuery(pool, 'WorkflowAutomation', sql); logger.info({ msg: '[WorkflowAutomation] Migrations applied', count: migrations.length }); }
    catch (e) { /* migration OK */ }
  })().catch(() => {});

  // Nav helper
  const wfNav = (active) => `<div class="wa-nav">
    <a href="/workflows" class="${active==='list'?'active':''}">🔄 Workflows</a>
    <a href="/approvals" class="${active==='inbox'?'active':''}">📬 Approvals</a>
    <a href="/approvals/stats" class="${active==='stats'?'active':''}" style="margin-left:auto">📊 Stats</a>
  </div>`;

  // Pipeline HTML builder
  function pipelineHtml(steps, currentStep, actions) {
    const actionMap = {};
    actions.forEach(a => { actionMap[a.step_id] = a; });
    return `<div class="wa-pipeline">${steps.map((s, i) => {
      const ord = s.step_order;
      const isDone = ord < currentStep;
      const isCurrent = ord === currentStep;
      const act = actionMap[s.id];
      let circleClass = 'pending', icon = (i + 1);
      if (isDone && act && act.action === 'rejected') { circleClass = 'rejected'; icon = '✕'; }
      else if (isDone) { circleClass = 'done'; icon = '✓'; }
      else if (isCurrent) { circleClass = 'current'; icon = (i + 1); }
      const connClass = isDone ? (act && act.action === 'rejected' ? '' : 'done') : isCurrent ? 'active' : '';
      return `<div class="wa-pipe-step">
        <div class="wa-pipe-circle ${circleClass}">${icon}</div>
        <div class="wa-pipe-label">${esc(s.title)}</div>
        <div class="wa-pipe-sub">${stepTypeBadge(s.step_type)} ${s.assignee_email ? '· ' + esc(s.assignee_email.split('@')[0]) : ''}</div>
      </div>${i < steps.length - 1 ? `<div class="wa-pipe-connector ${connClass}"></div>` : ''}`;
    }).join('')}</div>`;
  }

  // ============================================================
  // ROUTE 1: GET /workflows — Workflow Dashboard
  // ============================================================
  app.get('/workflows', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const workflows = (await pool.query(
      `SELECT w.*, (SELECT COUNT(*)::int FROM approval_requests WHERE workflow_id=w.id AND tenant_id=w.tenant_id) as total_requests,
        (SELECT COUNT(*)::int FROM approval_steps WHERE workflow_id=w.id AND tenant_id=w.tenant_id) as step_count
       FROM approval_workflows w WHERE w.tenant_id=$1 ORDER BY w.created_at DESC`, [tid]
    )).rows;
    const totalActive = workflows.filter(w => w.is_active).length;

    const wfRows = workflows.map(w => `<tr>
      <td><a href="/workflows/${w.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(w.name)}</a></td>
      <td>${entityBadge(w.entity_type)}</td>
      <td>${activeBadge(w.is_active)}</td>
      <td><span style="font-weight:600;color:#1e293b">${w.step_count}</span> steps</td>
      <td><span style="font-weight:600;color:#1e293b">${w.total_requests}</span></td>
      <td>${formatDate(w.created_at)}</td>
      <td><a href="/workflows/${w.id}/edit" class="wa-btn wa-btn-secondary" style="padding:5px 12px;font-size:12px">✏️ Edit</a></td>
    </tr>`).join('');

    const html = WA_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${wfNav('list')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🔄 Approval Workflows</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Design and manage multi-step approval processes</p></div>
        <a href="/workflows/new" class="wa-btn wa-btn-primary">➕ New Workflow</a>
      </div>
      <div class="wa-stats">
        <div class="wa-stat"><div class="wa-stat-val">${workflows.length}</div><div class="wa-stat-lbl">Total Workflows</div></div>
        <div class="wa-stat"><div class="wa-stat-val" style="color:#22c55e">${totalActive}</div><div class="wa-stat-lbl">Active</div></div>
        <div class="wa-stat"><div class="wa-stat-val" style="color:#94a3b8">${workflows.length - totalActive}</div><div class="wa-stat-lbl">Inactive</div></div>
        <div class="wa-stat"><div class="wa-stat-val" style="color:#3b82f6">${workflows.reduce((s, w) => s + w.step_count, 0)}</div><div class="wa-stat-lbl">Total Steps</div></div>
      </div>
      <div class="wa-card"><h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">All Workflows</h3>
        <div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Name</th><th>Entity</th><th>Status</th><th>Steps</th><th>Requests</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>${wfRows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No workflows yet. Create your first approval workflow!</td></tr>'}</tbody></table></div>
      </div>
    </div>`;
    res.send(renderPage('Approval Workflows', html, user));
  }));

  // ============================================================
  // ROUTE 2: GET /workflows/new — Create Workflow Form
  // ============================================================
  app.get('/workflows/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const entityTypes = ['leave', 'expense', 'purchase', 'asset', 'custom'];
    const html = WA_CSS + `<div style="max-width:800px;margin:0 auto">
      ${wfNav('list')}
      <a href="/workflows" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Workflows</a>
      <div class="wa-card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">➕ New Approval Workflow</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Define the steps for this approval process</p>
        <form method="POST" action="/workflows/save" style="display:flex;flex-direction:column;gap:16px">
          <div><label class="wa-label">Workflow Name *</label>
            <input type="text" name="name" required placeholder="e.g., Leave Approval" class="wa-input"></div>
          <div><label class="wa-label">Description</label>
            <textarea name="description" rows="2" placeholder="What is this workflow for?" class="wa-input" style="resize:vertical"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label class="wa-label">Entity Type</label>
              <select name="entity_type" class="wa-input">${entityTypes.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}</select></div>
            <div><label class="wa-label">Trigger Event</label>
              <input type="text" name="trigger_event" placeholder="e.g., leave.submit" class="wa-input"></div>
          </div>
          <div>
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <label class="wa-label" style="margin:0">Approval Steps</label>
              <button type="button" onclick="addStep()" class="wa-btn wa-btn-secondary" style="padding:6px 14px;font-size:12px">+ Add Step</button>
            </div>
            <div id="steps-container">
              <div class="wa-card" style="padding:14px;margin-bottom:8px;background:#f8fafc" data-step="1">
                <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="background:#4f46e5;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800">1</span><strong style="font-size:13px;color:#1e293b">Step 1</strong></div>
                <div style="display:grid;grid-template-columns:2fr 1fr 2fr;gap:10px">
                  <input type="text" name="step_title_1" placeholder="Step title" class="wa-input" value="Manager Approval" required>
                  <select name="step_type_1" class="wa-input"><option value="approve">Approve</option><option value="review">Review</option><option value="notify">Notify</option></select>
                  <input type="email" name="step_assignee_1" placeholder="Assignee email" class="wa-input">
                </div>
              </div>
            </div>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="wa-btn wa-btn-primary" style="padding:12px 28px">💾 Save Workflow</button>
            <a href="/workflows" class="wa-btn wa-btn-secondary" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
      <script>
        let stepCount = 1;
        function addStep() {
          stepCount++;
          const c = document.getElementById('steps-container');
          const d = document.createElement('div');
          d.className = 'wa-card'; d.style.cssText = 'padding:14px;margin-bottom:8px;background:#f8fafc'; d.dataset.step = stepCount;
          d.innerHTML = '<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="background:#4f46e5;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800">'+stepCount+'</span><strong style="font-size:13px;color:#1e293b">Step '+stepCount+'</strong><button type="button" onclick="this.closest(\\'[data-step]\\').remove()" style="margin-left:auto;background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px">✕</button></div><div style="display:grid;grid-template-columns:2fr 1fr 2fr;gap:10px"><input type="text" name="step_title_'+stepCount+'" placeholder="Step title" class="wa-input" required><select name="step_type_'+stepCount+'" class="wa-input"><option value="approve">Approve</option><option value="review">Review</option><option value="notify">Notify</option></select><input type="email" name="step_assignee_'+stepCount+'" placeholder="Assignee email" class="wa-input"></div>';
          c.appendChild(d);
        }
      </script>
    </div>`;
    res.send(renderPage('New Workflow', html, user));
  }));

  // ============================================================
  // ROUTE 3: POST /workflows/save — Save Workflow + Steps
  // ============================================================
  app.post('/workflows/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, description, entity_type, trigger_event } = req.body;
    if (!name || !name.trim()) return res.redirect('/workflows/new');
    const result = await pool.query(
      `INSERT INTO approval_workflows (tenant_id, name, description, entity_type, trigger_event, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tid, name.trim(), (description || '').trim(), entity_type || 'custom', (trigger_event || '').trim(), user.email]
    );
    const wfId = result.rows[0].id;
    const keys = Object.keys(req.body).filter(k => k.startsWith('step_title_'));
    for (const key of keys.sort((a, b) => parseInt(a.split('_')[2]) - parseInt(b.split('_')[2]))) {
      const num = key.split('_')[2];
      const title = (req.body[`step_title_${num}`] || '').trim();
      if (!title) continue;
      const type = req.body[`step_type_${num}`] || 'approve';
      const assignee = (req.body[`step_assignee_${num}`] || '').trim() || null;
      await pool.query(
        `INSERT INTO approval_steps (tenant_id, workflow_id, step_order, step_type, assignee_email, title) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, wfId, parseInt(num), type, assignee, title]
      );
    }
    audit(user.email, 'workflow_created', `Workflow "${name.trim()}" created (ID: ${wfId})`);
    logger.info({ msg: '[WorkflowAutomation] Workflow created', id: wfId, name: name.trim(), by: user.email });
    res.redirect('/workflows/' + wfId);
  }));

  // ============================================================
  // ROUTE 4: GET /workflows/:id — Workflow Detail
  // ============================================================
  app.get('/workflows/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, wfId = req.params.id;
    const wf = (await pool.query(`SELECT * FROM approval_workflows WHERE id=$1 AND tenant_id=$2`, [wfId, tid])).rows[0];
    if (!wf) return res.status(404).send(renderPage('Not Found', '<div class="wa-card" style="text-align:center;padding:60px"><h2 style="color:#dc2626">Workflow not found</h2><a href="/workflows" class="wa-btn wa-btn-primary" style="margin-top:12px">← Back</a></div>', user));

    const steps = (await pool.query(`SELECT * FROM approval_steps WHERE workflow_id=$1 AND tenant_id=$2 ORDER BY step_order`, [wfId, tid])).rows;
    const stats = (await pool.query(
      `SELECT status, COUNT(*)::int as cnt, AVG(EXTRACT(EPOCH FROM (COALESCE(completed_at, NOW()) - created_at)))::numeric(10,0) as avg_sec
       FROM approval_requests WHERE workflow_id=$1 AND tenant_id=$2 GROUP BY status`, [wfId, tid]
    )).rows;
    const statsMap = {}; stats.forEach(s => { statsMap[s.status] = s; });
    const totalReqs = stats.reduce((s, r) => s + r.cnt, 0);

    const stepsHtml = steps.map((s, i) => `<div class="wa-card" style="display:flex;align-items:center;gap:14px;margin-bottom:8px;${i === 0 ? '' : 'margin-top:0'}">
      <div style="width:40px;height:40px;border-radius:50%;background:${s.step_type === 'approve' ? '#dcfce7' : s.step_type === 'review' ? '#dbeafe' : '#fef3c7'};display:flex;align-items:center;justify-content:center;font-size:16px;font-weight:800;color:${s.step_type === 'approve' ? '#16a34a' : s.step_type === 'review' ? '#2563eb' : '#d97706'};flex-shrink:0">${i + 1}</div>
      <div style="flex:1"><div style="font-size:14px;font-weight:700;color:#1e293b">${esc(s.title)}</div>
        <div style="font-size:12px;color:#64748b;margin-top:2px">${stepTypeBadge(s.step_type)} ${s.assignee_email ? '· 👤 ' + esc(s.assignee_email) : ''}</div></div>
    </div>`).join('');

    const html = WA_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${wfNav('list')}
      <a href="/workflows" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Workflows</a>
      <div class="wa-card" style="padding:24px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">${entityBadge(wf.entity_type)} ${activeBadge(wf.is_active)}</div>
            <h1 style="margin:0 0 6px;color:#1e293b;font-size:22px">${esc(wf.name)}</h1>
            ${wf.description ? `<p style="font-size:14px;color:#64748b;margin:0">${esc(wf.description)}</p>` : ''}
          </div>
          <div style="display:flex;gap:6px">
            <a href="/workflows/${wf.id}/edit" class="wa-btn wa-btn-secondary">✏️ Edit</a>
            <a href="/workflows/${wf.id}/toggle" class="wa-btn ${wf.is_active ? 'wa-btn-warn' : 'wa-btn-success'}" style="text-decoration:none">${wf.is_active ? '⏸ Deactivate' : '▶ Activate'}</a>
          </div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
        <div class="wa-card"><h3 style="font-size:14px;color:#1e293b;margin-bottom:10px">📋 Pipeline Steps (${steps.length})</h3>${stepsHtml || '<p style="color:#94a3b8;font-size:13px">No steps defined</p>'}</div>
        <div class="wa-card"><h3 style="font-size:14px;color:#1e293b;margin-bottom:10px">📊 Request Statistics</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <div style="background:#f8fafc;border-radius:10px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800;color:#1e293b">${totalReqs}</div><div style="font-size:11px;color:#94a3b8">Total</div></div>
            <div style="background:#f0fdf4;border-radius:10px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800;color:#16a34a">${statsMap.approved?.cnt || 0}</div><div style="font-size:11px;color:#94a3b8">Approved</div></div>
            <div style="background:#fef2f2;border-radius:10px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800;color:#ef4444">${statsMap.rejected?.cnt || 0}</div><div style="font-size:11px;color:#94a3b8">Rejected</div></div>
            <div style="background:#fefce8;border-radius:10px;padding:12px;text-align:center"><div style="font-size:22px;font-weight:800;color:#a16207">${statsMap.pending?.cnt || 0}</div><div style="font-size:11px;color:#94a3b8">Pending</div></div>
          </div>
          <div style="margin-top:12px;padding:10px;background:#f8fafc;border-radius:10px;text-align:center">
            <span style="font-size:12px;color:#64748b">Avg Processing Time</span>
            <div style="font-size:18px;font-weight:800;color:#4f46e5">${fmtDur(statsMap.approved?.avg_sec ? parseFloat(statsMap.approved.avg_sec) * 1000 : null)}</div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Workflow: ' + wf.name, html, user));
  }));

  // Toggle active
  app.get('/workflows/:id/toggle', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    await pool.query(`UPDATE approval_workflows SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    audit(user.email, 'workflow_toggled', `Workflow ${req.params.id} toggled`);
    res.redirect('/workflows/' + req.params.id);
  }));

  // ============================================================
  // ROUTE 5: GET /workflows/:id/edit — Edit Workflow
  // ============================================================
  app.get('/workflows/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, wfId = req.params.id;
    const wf = (await pool.query(`SELECT * FROM approval_workflows WHERE id=$1 AND tenant_id=$2`, [wfId, tid])).rows[0];
    if (!wf) return res.redirect('/workflows');
    const steps = (await pool.query(`SELECT * FROM approval_steps WHERE workflow_id=$1 AND tenant_id=$2 ORDER BY step_order`, [wfId, tid])).rows;
    const entityTypes = ['leave', 'expense', 'purchase', 'asset', 'custom'];

    const stepsHtml = steps.map((s, i) => `<div class="wa-card" style="padding:14px;margin-bottom:8px;background:#f8fafc" data-step="${i + 1}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="background:#4f46e5;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800">${i + 1}</span>
        <strong style="font-size:13px;color:#1e293b">Step ${i + 1}</strong>
        <input type="hidden" name="step_id_${i + 1}" value="${s.id}">
        <button type="button" onclick="this.closest('[data-step]').remove()" style="margin-left:auto;background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px">✕</button>
      </div>
      <div style="display:grid;grid-template-columns:2fr 1fr 2fr;gap:10px">
        <input type="text" name="step_title_${i + 1}" value="${esc(s.title)}" class="wa-input" required>
        <select name="step_type_${i + 1}" class="wa-input">${['approve', 'review', 'notify'].map(t => `<option value="${t}" ${s.step_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select>
        <input type="email" name="step_assignee_${i + 1}" value="${esc(s.assignee_email || '')}" class="wa-input">
      </div>
    </div>`).join('');

    const html = WA_CSS + `<div style="max-width:800px;margin:0 auto">
      ${wfNav('list')}
      <a href="/workflows/${wfId}" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Workflow</a>
      <div class="wa-card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">✏️ Edit Workflow</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Update workflow details and steps</p>
        <form method="POST" action="/workflows/${wfId}/update">
          <div style="display:flex;flex-direction:column;gap:16px">
            <div><label class="wa-label">Workflow Name *</label><input type="text" name="name" value="${esc(wf.name)}" required class="wa-input"></div>
            <div><label class="wa-label">Description</label><textarea name="description" rows="2" class="wa-input" style="resize:vertical">${esc(wf.description || '')}</textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div><label class="wa-label">Entity Type</label><select name="entity_type" class="wa-input">${entityTypes.map(t => `<option value="${t}" ${wf.entity_type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
              <div><label class="wa-label">Trigger Event</label><input type="text" name="trigger_event" value="${esc(wf.trigger_event || '')}" class="wa-input"></div>
            </div>
            <div>
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
                <label class="wa-label" style="margin:0">Steps</label>
                <button type="button" onclick="addStep(${steps.length})" class="wa-btn wa-btn-secondary" style="padding:6px 14px;font-size:12px">+ Add Step</button>
              </div>
              <div id="steps-container">${stepsHtml}</div>
            </div>
            <div style="display:flex;gap:10px;margin-top:8px">
              <button type="submit" class="wa-btn wa-btn-primary" style="padding:12px 28px">💾 Update</button>
              <a href="/workflows/${wfId}" class="wa-btn wa-btn-secondary" style="padding:12px 28px">Cancel</a>
            </div>
          </div>
        </form>
      </div>
      <script>
        let stepCount = ${steps.length};
        function addStep(base) {
          stepCount++;
          const c = document.getElementById('steps-container');
          const d = document.createElement('div');
          d.className='wa-card'; d.style.cssText='padding:14px;margin-bottom:8px;background:#f8fafc'; d.dataset.step=stepCount;
          d.innerHTML='<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="background:#4f46e5;color:#fff;width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:800">'+stepCount+'</span><strong style="font-size:13px;color:#1e293b">Step '+stepCount+'</strong><button type="button" onclick="this.closest(\\'[data-step]\\').remove()" style="margin-left:auto;background:none;border:none;color:#ef4444;cursor:pointer;font-size:16px">✕</button></div><div style="display:grid;grid-template-columns:2fr 1fr 2fr;gap:10px"><input type="text" name="step_title_'+stepCount+'" placeholder="Step title" class="wa-input" required><select name="step_type_'+stepCount+'" class="wa-input"><option value="approve">Approve</option><option value="review">Review</option><option value="notify">Notify</option></select><input type="email" name="step_assignee_'+stepCount+'" placeholder="Assignee email" class="wa-input"></div>';
          c.appendChild(d);
        }
      </script>
    </div>`;
    res.send(renderPage('Edit Workflow', html, user));
  }));

  // ============================================================
  // ROUTE 6: POST /workflows/:id/update — Update Workflow
  // ============================================================
  app.post('/workflows/:id/update', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, wfId = req.params.id;
    const { name, description, entity_type, trigger_event } = req.body;
    if (!name || !name.trim()) return res.redirect(`/workflows/${wfId}/edit`);
    await pool.query(`UPDATE approval_workflows SET name=$1, description=$2, entity_type=$3, trigger_event=$4 WHERE id=$5 AND tenant_id=$6`,
      [name.trim(), (description || '').trim(), entity_type || 'custom', (trigger_event || '').trim(), wfId, tid]);

    // Replace steps
    await pool.query(`DELETE FROM approval_steps WHERE workflow_id=$1 AND tenant_id=$2`, [wfId, tid]);
    const keys = Object.keys(req.body).filter(k => k.startsWith('step_title_'));
    for (const key of keys.sort((a, b) => parseInt(a.split('_')[2]) - parseInt(b.split('_')[2]))) {
      const num = key.split('_')[2];
      const title = (req.body[`step_title_${num}`] || '').trim();
      if (!title) continue;
      await pool.query(`INSERT INTO approval_steps (tenant_id, workflow_id, step_order, step_type, assignee_email, title) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, wfId, parseInt(num), req.body[`step_type_${num}`] || 'approve', (req.body[`step_assignee_${num}`] || '').trim() || null, title]);
    }
    audit(user.email, 'workflow_updated', `Workflow ${wfId} updated`);
    res.redirect('/workflows/' + wfId);
  }));

  // ============================================================
  // ROUTE 7: GET /approvals — Approval Inbox
  // ============================================================
  app.get('/approvals', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const tab = req.query.tab || 'pending';

    let requests = [];
    if (tab === 'pending') {
      requests = (await pool.query(
        `SELECT ar.*, w.name as workflow_name, s.title as step_title, s.assignee_email as step_assignee
         FROM approval_requests ar
         LEFT JOIN approval_workflows w ON w.id=ar.workflow_id
         LEFT JOIN approval_steps s ON s.workflow_id=w.id AND s.step_order=ar.current_step AND s.tenant_id=w.tenant_id
         WHERE ar.tenant_id=$1 AND ar.status='pending' AND (ar.requester_email=$2 OR s.assignee_email=$2)
         ORDER BY ar.created_at DESC`, [tid, user.email]
      )).rows;
    } else if (tab === 'mine') {
      requests = (await pool.query(
        `SELECT ar.*, w.name as workflow_name
         FROM approval_requests ar LEFT JOIN approval_workflows w ON w.id=ar.workflow_id
         WHERE ar.tenant_id=$1 AND ar.requester_email=$2 ORDER BY ar.created_at DESC`, [tid, user.email]
      )).rows;
    } else {
      requests = (await pool.query(
        `SELECT ar.*, w.name as workflow_name
         FROM approval_requests ar LEFT JOIN approval_workflows w ON w.id=ar.workflow_id
         WHERE ar.tenant_id=$1 ORDER BY ar.created_at DESC LIMIT 50`, [tid]
      )).rows;
    }

    const pendingCount = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM approval_requests ar
       LEFT JOIN approval_steps s ON s.workflow_id=ar.workflow_id AND s.step_order=ar.current_step AND s.tenant_id=ar.tenant_id
       WHERE ar.tenant_id=$1 AND ar.status='pending' AND s.assignee_email=$2`, [tid, user.email]
    )).rows[0].cnt;

    const reqCards = requests.map(r => {
      const isMyAction = r.step_assignee === user.email;
      return `<div class="wa-req-card" style="border-left-color:${r.status === 'approved' ? '#22c55e' : r.status === 'rejected' ? '#ef4444' : '#eab308'}" onclick="location.href='/approvals/${r.id}'">
        <div style="display:flex;justify-content:space-between;align-items:start;gap:10px">
          <div style="flex:1">
            <div style="font-size:15px;font-weight:700;color:#1e293b;margin-bottom:4px">${esc(r.title)}</div>
            <div style="font-size:12px;color:#64748b;display:flex;gap:8px;flex-wrap:wrap;align-items:center">
              ${entityBadge(r.entity_type)}
              <span>👤 ${esc(r.requester_email.split('@')[0])}</span>
              <span>📅 ${formatDate(r.created_at)}</span>
              ${r.workflow_name ? `<span>🔄 ${esc(r.workflow_name)}</span>` : ''}
              <span>Step ${r.current_step}</span>
            </div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            ${statusBadge(r.status)}
            ${isMyAction && r.status === 'pending' ? '<span style="font-size:10px;font-weight:700;background:#4f46e5;color:#fff;padding:2px 8px;border-radius:8px">ACTION</span>' : ''}
          </div>
        </div>
      </div>`;
    }).join('');

    const html = WA_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${wfNav('inbox')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:24px;color:#1e293b">📬 Approval Inbox</h1>
      </div>
      <div class="wa-inbox-tabs">
        <a href="/approvals?tab=pending" class="wa-tab ${tab === 'pending' ? 'active' : ''}">Pending${pendingCount > 0 ? `<span class="wa-badge">${pendingCount}</span>` : ''}</a>
        <a href="/approvals?tab=mine" class="wa-tab ${tab === 'mine' ? 'active' : ''}">My Requests</a>
        <a href="/approvals?tab=all" class="wa-tab ${tab === 'all' ? 'active' : ''}">All</a>
      </div>
      ${reqCards || '<div class="wa-card" style="text-align:center;padding:40px;color:#94a3b8"><div style="font-size:40px;margin-bottom:8px">📭</div>No approval requests found</div>'}
    </div>`;
    res.send(renderPage('Approval Inbox', html, user));
  }));

  // ============================================================
  // ROUTE 8: POST /approvals/:id/approve — Approve Request
  // ============================================================
  app.post('/approvals/:id/approve', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, reqId = req.params.id;
    const ar = (await pool.query(`SELECT ar.*, (SELECT MAX(step_order) FROM approval_steps WHERE workflow_id=ar.workflow_id AND tenant_id=ar.tenant_id) as max_step
      FROM approval_requests ar WHERE ar.id=$1 AND ar.tenant_id=$2 AND ar.status='pending'`, [reqId, tid])).rows[0];
    if (!ar) return res.redirect('/approvals');

    const currentStep = (await pool.query(`SELECT * FROM approval_steps WHERE workflow_id=$1 AND step_order=$2 AND tenant_id=$3`, [ar.workflow_id, ar.current_step, tid])).rows[0];
    if (!currentStep) return res.redirect('/approvals');

    await pool.query(`INSERT INTO approval_actions (tenant_id, request_id, step_id, actor_email, action, comment) VALUES ($1,$2,$3,$4,'approved',$5)`,
      [tid, reqId, currentStep.id, user.email, (req.body.comment || '').trim() || null]);

    if (ar.current_step >= ar.max_step) {
      await pool.query(`UPDATE approval_requests SET status='approved', completed_at=NOW() WHERE id=$1 AND tenant_id=$2`, [reqId, tid]);
      audit(user.email, 'request_approved', `Request ${reqId} fully approved`);
      try { await notify(ar.requester_email, 'Request Approved', `Your request "${ar.title}" has been fully approved!`); } catch (e) {}
    } else {
      await pool.query(`UPDATE approval_requests SET current_step=current_step+1 WHERE id=$1 AND tenant_id=$2`, [reqId, tid]);
      audit(user.email, 'step_approved', `Step ${ar.current_step} approved on request ${reqId}`);
      const nextStep = (await pool.query(`SELECT * FROM approval_steps WHERE workflow_id=$1 AND step_order=$2 AND tenant_id=$3`, [ar.workflow_id, ar.current_step + 1, tid])).rows[0];
      if (nextStep && nextStep.assignee_email) {
        try { await notify(nextStep.assignee_email, 'Approval Required', `Your approval is needed for "${ar.title}" (Step ${ar.current_step + 1})`); } catch (e) {}
      }
    }
    res.redirect('/approvals/' + reqId);
  }));

  // ============================================================
  // ROUTE 9: POST /approvals/:id/reject — Reject Request
  // ============================================================
  app.post('/approvals/:id/reject', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, reqId = req.params.id;
    const ar = (await pool.query(`SELECT ar.* FROM approval_requests ar WHERE ar.id=$1 AND ar.tenant_id=$2 AND ar.status='pending'`, [reqId, tid])).rows[0];
    if (!ar) return res.redirect('/approvals');

    const currentStep = (await pool.query(`SELECT * FROM approval_steps WHERE workflow_id=$1 AND step_order=$2 AND tenant_id=$3`, [ar.workflow_id, ar.current_step, tid])).rows[0];
    await pool.query(`INSERT INTO approval_actions (tenant_id, request_id, step_id, actor_email, action, comment) VALUES ($1,$2,$3,$4,'rejected',$5)`,
      [tid, reqId, currentStep?.id, user.email, (req.body.comment || '').trim() || null]);
    await pool.query(`UPDATE approval_requests SET status='rejected', completed_at=NOW() WHERE id=$1 AND tenant_id=$2`, [reqId, tid]);
    audit(user.email, 'request_rejected', `Request ${reqId} rejected`);
    try { await notify(ar.requester_email, 'Request Rejected', `Your request "${ar.title}" has been rejected.`); } catch (e) {}
    res.redirect('/approvals/' + reqId);
  }));

  // ============================================================
  // ROUTE 10: POST /approvals/:id/comment — Add Comment
  // ============================================================
  app.post('/approvals/:id/comment', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, reqId = req.params.id;
    const ar = (await pool.query(`SELECT ar.* FROM approval_requests ar WHERE ar.id=$1 AND ar.tenant_id=$2`, [reqId, tid])).rows[0];
    if (!ar) return res.redirect('/approvals');
    if (!req.body.comment || !req.body.comment.trim()) return res.redirect('/approvals/' + reqId);

    const currentStep = (await pool.query(`SELECT * FROM approval_steps WHERE workflow_id=$1 AND step_order=$2 AND tenant_id=$3`, [ar.workflow_id, ar.current_step, tid])).rows[0];
    await pool.query(`INSERT INTO approval_actions (tenant_id, request_id, step_id, actor_email, action, comment) VALUES ($1,$2,$3,$4,'commented',$5)`,
      [tid, reqId, currentStep?.id, user.email, req.body.comment.trim()]);
    audit(user.email, 'approval_comment', `Comment on request ${reqId}`);
    res.redirect('/approvals/' + reqId);
  }));

  // ============================================================
  // ROUTE 11: GET /approvals/:id — Approval Detail
  // ============================================================
  app.get('/approvals/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, reqId = req.params.id;
    const ar = (await pool.query(`SELECT ar.*, w.name as workflow_name FROM approval_requests ar LEFT JOIN approval_workflows w ON w.id=ar.workflow_id WHERE ar.id=$1 AND ar.tenant_id=$2`, [reqId, tid])).rows[0];
    if (!ar) return res.status(404).send(renderPage('Not Found', '<div class="wa-card" style="text-align:center;padding:60px"><h2 style="color:#dc2626">Request not found</h2><a href="/approvals" class="wa-btn wa-btn-primary" style="margin-top:12px">← Inbox</a></div>', user));

    const steps = (await pool.query(`SELECT * FROM approval_steps WHERE workflow_id=$1 AND tenant_id=$2 ORDER BY step_order`, [ar.workflow_id, tid])).rows;
    const actions = (await pool.query(`SELECT aa.*, s.title as step_title FROM approval_actions aa LEFT JOIN approval_steps s ON s.id=aa.step_id WHERE aa.request_id=$1 AND aa.tenant_id=$2 ORDER BY aa.created_at`, [reqId, tid])).rows;
    const currentStep = steps.find(s => s.step_order === ar.current_step);
    const isAssignee = currentStep && currentStep.assignee_email === user.email;
    const isRequester = ar.requester_email === user.email;

    const timelineHtml = actions.map(a => `<div class="wa-tl-item">
      <div class="wa-tl-dot ${a.action}"></div>
      <div style="display:flex;justify-content:space-between;align-items:start;gap:8px">
        <div>
          <div style="font-size:13px;font-weight:700;color:#1e293b">${esc(a.actor_email.split('@')[0])}
            <span style="font-weight:500;color:${a.action === 'approved' ? '#16a34a' : a.action === 'rejected' ? '#ef4444' : '#3b82f6'}">${a.action}</span>
            ${a.step_title ? `<span style="color:#94a3b8;font-weight:400">on ${esc(a.step_title)}</span>` : ''}
          </div>
          ${a.comment ? `<div style="font-size:13px;color:#475569;margin-top:4px;padding:8px 12px;background:#f8fafc;border-radius:8px">${esc(a.comment)}</div>` : ''}
        </div>
        <span style="font-size:11px;color:#94a3b8;white-space:nowrap">${formatDateTime(a.created_at)}</span>
      </div>
    </div>`).join('');

    const html = WA_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${wfNav('inbox')}
      <a href="/approvals" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Inbox</a>
      <div class="wa-card" style="padding:24px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <div style="display:flex;gap:8px;align-items:center;margin-bottom:6px">${entityBadge(ar.entity_type)} ${statusBadge(ar.status)}</div>
            <h1 style="margin:0 0 6px;color:#1e293b;font-size:22px">${esc(ar.title)}</h1>
            <div style="font-size:13px;color:#64748b;display:flex;gap:12px;flex-wrap:wrap">
              <span>👤 ${esc(ar.requester_email)}</span>
              <span>📅 ${formatDateTime(ar.created_at)}</span>
              ${ar.workflow_name ? `<span>🔄 ${esc(ar.workflow_name)}</span>` : ''}
              ${ar.completed_at ? `<span>⏱ Completed ${formatDateTime(ar.completed_at)}</span>` : ''}
            </div>
          </div>
        </div>
        ${ar.description ? `<div style="margin-top:14px;padding:12px;background:#f8fafc;border-radius:10px;font-size:14px;color:#334155;white-space:pre-wrap">${esc(ar.description)}</div>` : ''}
      </div>

      <div class="wa-card" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:14px;color:#1e293b;margin-bottom:8px">Pipeline Progress</h3>
        ${pipelineHtml(steps, ar.current_step, actions)}
      </div>

      ${ar.status === 'pending' && (isAssignee || isRequester) ? `
      <div class="wa-card" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:14px;color:#1e293b;margin-bottom:12px">${isAssignee ? 'Take Action' : 'Request Actions'}</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap;margin-bottom:12px">
          ${isAssignee ? `
            <form method="POST" action="/approvals/${ar.id}/approve" style="display:inline-flex;gap:8px;align-items:center">
              <input type="text" name="comment" placeholder="Comment (optional)" class="wa-input" style="width:250px">
              <button type="submit" class="wa-btn wa-btn-success">✅ Approve</button>
            </form>
            <form method="POST" action="/approvals/${ar.id}/reject" style="display:inline-flex;gap:8px;align-items:center">
              <input type="text" name="comment" placeholder="Reason" class="wa-input" style="width:200px" required>
              <button type="submit" class="wa-btn wa-btn-danger">❌ Reject</button>
            </form>
          ` : ''}
          ${isRequester ? `
            <form method="POST" action="/approvals/${ar.id}/cancel" style="display:inline">
              <button type="submit" class="wa-btn wa-btn-warn">🚫 Cancel Request</button>
            </form>
          ` : ''}
        </div>
        <form method="POST" action="/approvals/${ar.id}/comment" style="display:flex;gap:8px;align-items:center">
          <input type="text" name="comment" placeholder="Add a comment..." class="wa-input" style="flex:1" required>
          <button type="submit" class="wa-btn wa-btn-secondary">💬 Comment</button>
        </form>
      </div>` : ''}

      <div class="wa-card" style="padding:20px">
        <h3 style="font-size:14px;color:#1e293b;margin-bottom:12px">Activity Timeline</h3>
        <div class="wa-timeline">
          ${timelineHtml || `<div class="wa-tl-item"><div class="wa-tl-dot commented"></div><div style="font-size:13px;color:#94a3b8">Request created by ${esc(ar.requester_email)} — ${formatDateTime(ar.created_at)}</div></div>`}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Approval: ' + ar.title, html, user));
  }));

  // Cancel request
  app.post('/approvals/:id/cancel', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, reqId = req.params.id;
    const ar = (await pool.query(`SELECT * FROM approval_requests WHERE id=$1 AND tenant_id=$2 AND requester_email=$3 AND status='pending'`, [reqId, tid, user.email])).rows[0];
    if (!ar) return res.redirect('/approvals/' + reqId);
    await pool.query(`UPDATE approval_requests SET status='cancelled', completed_at=NOW() WHERE id=$1 AND tenant_id=$2`, [reqId, tid]);
    const currentStep = (await pool.query(`SELECT * FROM approval_steps WHERE workflow_id=$1 AND step_order=$2 AND tenant_id=$3`, [ar.workflow_id, ar.current_step, tid])).rows[0];
    await pool.query(`INSERT INTO approval_actions (tenant_id, request_id, step_id, actor_email, action, comment) VALUES ($1,$2,$3,$4,'commented',$5)`,
      [tid, reqId, currentStep?.id, user.email, 'Request cancelled by requester']);
    audit(user.email, 'request_cancelled', `Request ${reqId} cancelled`);
    res.redirect('/approvals/' + reqId);
  }));

  // ============================================================
  // ROUTE 12: GET /approvals/stats — Approval Statistics
  // ============================================================
  app.get('/approvals/stats', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const statusCounts = (await pool.query(`SELECT status, COUNT(*)::int as cnt FROM approval_requests WHERE tenant_id=$1 GROUP BY status`, [tid])).rows;
    const statusMap = { pending: 0, approved: 0, rejected: 0, cancelled: 0 };
    statusCounts.forEach(s => { statusMap[s.status] = s.cnt; });
    const total = Object.values(statusMap).reduce((a, b) => a + b, 0);

    // Approval rate by workflow
    const wfStats = (await pool.query(
      `SELECT w.name, COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE ar.status='approved')::int as approved,
        COUNT(*) FILTER (WHERE ar.status='rejected')::int as rejected,
        AVG(EXTRACT(EPOCH FROM (COALESCE(ar.completed_at, NOW()) - ar.created_at)))::numeric(10,0) as avg_sec
       FROM approval_requests ar JOIN approval_workflows w ON w.id=ar.workflow_id
       WHERE ar.tenant_id=$1 GROUP BY w.name ORDER BY total DESC`, [tid]
    )).rows;

    // Monthly volume (last 6 months)
    const monthly = (await pool.query(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COUNT(*)::int as total,
        COUNT(*) FILTER (WHERE status='approved')::int as approved
       FROM approval_requests WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '6 months'
       GROUP BY month ORDER BY month`, [tid]
    )).rows;

    // Donut chart SVG
    const donutData = [
      { label: 'Approved', value: statusMap.approved, color: '#22c55e' },
      { label: 'Pending', value: statusMap.pending, color: '#eab308' },
      { label: 'Rejected', value: statusMap.rejected, color: '#ef4444' },
      { label: 'Cancelled', value: statusMap.cancelled, color: '#94a3b8' }
    ];
    const donutTotal = Math.max(1, donutData.reduce((s, d) => s + d.value, 0));
    let cumAngle = -90;
    const donutPaths = donutData.map(d => {
      const pct = d.value / donutTotal;
      if (pct === 0) return '';
      const angle = pct * 360;
      const startRad = cumAngle * Math.PI / 180;
      const endRad = (cumAngle + angle) * Math.PI / 180;
      const x1 = 100 + 70 * Math.cos(startRad), y1 = 100 + 70 * Math.sin(startRad);
      const x2 = 100 + 70 * Math.cos(endRad), y2 = 100 + 70 * Math.sin(endRad);
      const x3 = 100 + 40 * Math.cos(endRad), y3 = 100 + 40 * Math.sin(endRad);
      const x4 = 100 + 40 * Math.cos(startRad), y4 = 100 + 40 * Math.sin(startRad);
      const large = angle > 180 ? 1 : 0;
      cumAngle += angle;
      return `<path d="M${x1},${y1} A70,70 0 ${large},1 ${x2},${y2} L${x3},${y3} A40,40 0 ${large},0 ${x4},${y4} Z" fill="${d.color}" stroke="#fff" stroke-width="2"/>`;
    }).join('');

    const donutLegend = donutData.map(d => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <span style="width:12px;height:12px;border-radius:3px;background:${d.color};display:inline-block"></span>
      <span style="font-size:13px;color:#475569;flex:1">${d.label}</span>
      <span style="font-weight:700;font-size:13px;color:#1e293b">${d.value}</span>
      <span style="font-size:11px;color:#94a3b8">${total > 0 ? Math.round(d.value / donutTotal * 100) : 0}%</span>
    </div>`).join('');

    // Bar chart SVG
    const maxMonth = Math.max(1, ...monthly.map(m => m.total));
    const barWidth = Math.max(30, Math.min(60, 400 / Math.max(1, monthly.length)));
    const chartH = 160;
    const barsHtml = monthly.map(m => {
      const h1 = Math.max(2, (m.total / maxMonth) * (chartH - 30));
      const h2 = Math.max(0, (m.approved / maxMonth) * (chartH - 30));
      const x = monthly.indexOf(m) * (barWidth + 8) + 20;
      return `<rect x="${x}" y="${chartH - h1 - 20}" width="${barWidth * 0.45}" height="${h1}" rx="4" fill="#6366f1" opacity="0.8"/>
        <rect x="${x + barWidth * 0.5}" y="${chartH - h2 - 20}" width="${barWidth * 0.45}" height="${h2}" rx="4" fill="#22c55e" opacity="0.8"/>
        <text x="${x + barWidth / 2}" y="${chartH - 4}" text-anchor="middle" font-size="10" fill="#64748b">${m.month.slice(5)}</text>
        <text x="${x + barWidth / 2}" y="${chartH - h1 - 24}" text-anchor="middle" font-size="10" font-weight="700" fill="#1e293b">${m.total}</text>`;
    }).join('');

    const wfTableRows = wfStats.map(w => `<tr>
      <td style="font-weight:600;color:#1e293b">${esc(w.name)}</td>
      <td>${w.total}</td>
      <td style="color:#16a34a;font-weight:600">${w.approved}</td>
      <td style="color:#ef4444;font-weight:600">${w.rejected}</td>
      <td style="color:#4f46e5;font-weight:600">${w.total > 0 ? Math.round(w.approved / w.total * 100) : 0}%</td>
      <td>${fmtDur(w.avg_sec ? parseFloat(w.avg_sec) * 1000 : null)}</td>
    </tr>`).join('');

    const html = WA_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${wfNav('stats')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📊 Approval Statistics</h1>
      <div class="wa-stats">
        <div class="wa-stat"><div class="wa-stat-val">${total}</div><div class="wa-stat-lbl">Total Requests</div></div>
        <div class="wa-stat"><div class="wa-stat-val" style="color:#22c55e">${statusMap.approved}</div><div class="wa-stat-lbl">Approved</div></div>
        <div class="wa-stat"><div class="wa-stat-val" style="color:#ef4444">${statusMap.rejected}</div><div class="wa-stat-lbl">Rejected</div></div>
        <div class="wa-stat"><div class="wa-stat-val" style="color:#eab308">${statusMap.pending}</div><div class="wa-stat-lbl">Pending</div></div>
        <div class="wa-stat"><div class="wa-stat-val" style="color:#4f46e5">${total > 0 ? Math.round(statusMap.approved / total * 100) : 0}%</div><div class="wa-stat-lbl">Approval Rate</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:16px">
        <div class="wa-card" style="padding:20px">
          <h3 style="font-size:14px;color:#1e293b;margin-bottom:12px">Approval Rate Distribution</h3>
          <div style="display:flex;align-items:center;gap:20px;flex-wrap:wrap">
            <svg width="200" height="200" viewBox="0 0 200 200">${donutPaths}
              <text x="100" y="96" text-anchor="middle" font-size="24" font-weight="800" fill="#1e293b">${total > 0 ? Math.round(statusMap.approved / total * 100) : 0}%</text>
              <text x="100" y="114" text-anchor="middle" font-size="11" fill="#94a3b8">approved</text>
            </svg>
            <div style="flex:1">${donutLegend}</div>
          </div>
        </div>
        <div class="wa-card" style="padding:20px">
          <h3 style="font-size:14px;color:#1e293b;margin-bottom:12px">Monthly Volume (6 months)</h3>
          <div style="display:flex;align-items:center;gap:16px;margin-bottom:10px;font-size:11px;color:#64748b">
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#6366f1;margin-right:4px"></span>Total</span>
            <span><span style="display:inline-block;width:10px;height:10px;border-radius:2px;background:#22c55e;margin-right:4px"></span>Approved</span>
          </div>
          <svg width="${Math.max(300, monthly.length * (barWidth + 8) + 40)}" height="${chartH}" viewBox="0 0 ${Math.max(300, monthly.length * (barWidth + 8) + 40)} ${chartH}">
            <line x1="10" y1="${chartH - 20}" x2="${Math.max(300, monthly.length * (barWidth + 8) + 40)}" y2="${chartH - 20}" stroke="#e2e8f0" stroke-width="1"/>
            ${barsHtml || '<text x="50%" y="50%" text-anchor="middle" fill="#94a3b8" font-size="13">No data</text>'}
          </svg>
        </div>
      </div>
      <div class="wa-card" style="padding:20px">
        <h3 style="font-size:14px;color:#1e293b;margin-bottom:12px">Performance by Workflow</h3>
        <div style="overflow-x:auto"><table class="wa-table"><thead><tr><th>Workflow</th><th>Total</th><th>Approved</th><th>Rejected</th><th>Rate</th><th>Avg Time</th></tr></thead>
        <tbody>${wfTableRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No data yet</td></tr>'}</tbody></table></div>
      </div>
    </div>`;
    res.send(renderPage('Approval Statistics', html, user));
  }));
};
