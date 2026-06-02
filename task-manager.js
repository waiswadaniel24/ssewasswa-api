// ============================================================
// PROJECT TASK MANAGER MODULE — SSEWASSWA Comfort Platform
// Kanban board, Gantt timeline, calendar, list views, projects,
// task CRUD, comments, status workflow, and progress tracking.
// ============================================================
// Usage in server.js:
//   const taskManager = require('./task-manager');
//   taskManager(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const { migrateQuery } = require('./db');
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const formatDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

function priorityBadge(p) {
  const m = { critical: { bg: '#fee2e2', c: '#dc2626' }, high: { bg: '#ffedd5', c: '#ea580c' }, medium: { bg: '#fef9c3', c: '#a16207' }, low: { bg: '#dcfce7', c: '#16a34a' } };
  const s = m[p] || m.low;
  return `<span style="display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:700;background:${s.bg};color:${s.c}">${p || 'low'}</span>`;
}

function priorityBorder(p) {
  const m = { critical: '#dc2626', high: '#ea580c', medium: '#eab308', low: '#22c55e' };
  return m[p] || m.low;
}

function statusLabel(s) {
  const m = { todo: 'To Do', in_progress: 'In Progress', review: 'Review', done: 'Done', blocked: 'Blocked' };
  return m[s] || s;
}

function statusColor(s) {
  const m = { todo: '#94a3b8', in_progress: '#3b82f6', review: '#a855f7', done: '#22c55e', blocked: '#ef4444' };
  return m[s] || '#94a3b8';
}

function projectStatusBadge(s) {
  const m = { planning: { bg: '#dbeafe', c: '#1d4ed8', l: 'Planning' }, active: { bg: '#dcfce7', c: '#16a34a', l: 'Active' }, on_hold: { bg: '#fef9c3', c: '#a16207', l: 'On Hold' }, completed: { bg: '#e0e7ff', c: '#4f46e5', l: 'Completed' } };
  const v = m[s] || m.planning;
  return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${v.bg};color:${v.c}">${v.l}</span>`;
}

function progressBar(pct) {
  const c = pct >= 80 ? '#22c55e' : pct >= 50 ? '#3b82f6' : pct >= 25 ? '#f59e0b' : '#94a3b8';
  return `<div style="background:#e2e8f0;border-radius:10px;height:8px;overflow:hidden;width:100%"><div style="background:${c};height:100%;border-radius:10px;width:${Math.min(100, pct)}%;transition:.3s"></div></div><span style="font-size:11px;color:#64748b">${pct}%</span>`;
}

const STATUS_FLOW = ['todo', 'in_progress', 'review', 'done'];

// Shared CSS
const TM_CSS = `<style>
.tm-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.tm-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.tm-nav a:hover{background:#e2e8f0}.tm-nav a.active{background:#4f46e5;color:#fff}
.tm-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px}
.tm-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center}
.tm-stat-val{font-size:28px;font-weight:800;color:#1e293b}.tm-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
.tm-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.tm-btn:hover{opacity:.9;transform:translateY(-1px)}
.tm-btn-primary{background:#4f46e5;color:#fff}.tm-btn-success{background:#059669;color:#fff}.tm-btn-danger{background:#fee2e2;color:#dc2626}.tm-btn-secondary{background:#f1f5f9;color:#475569}
.tm-table{width:100%;border-collapse:collapse;font-size:13px}
.tm-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.tm-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}.tm-table tr:hover{background:#f8fafc}
.tm-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.tm-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.tm-filter input,.tm-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.tm-filter input:focus,.tm-filter select:focus{outline:none;border-color:#6366f1}
.tm-kanban{display:grid;grid-template-columns:repeat(5,1fr);gap:14px;overflow-x:auto}
.tm-col{background:#f8fafc;border-radius:14px;padding:14px;min-height:300px}
.tm-col-header{font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;padding:8px 12px;border-radius:10px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:center}
.tm-col-header .cnt{font-size:11px;background:rgba(255,255,255,.3);padding:2px 8px;border-radius:12px}
.tm-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:14px;margin-bottom:10px;border-left:4px solid #22c55e;transition:.15s;cursor:pointer}
.tm-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06);transform:translateY(-1px)}
.tm-card-title{font-size:13px;font-weight:700;color:#1e293b;margin-bottom:6px}
.tm-card-meta{font-size:11px;color:#94a3b8;display:flex;gap:8px;flex-wrap:wrap;align-items:center}
.tm-comment{background:#f8fafc;border-radius:10px;padding:12px;margin-bottom:8px;border-left:3px solid #c7d2fe}
.tm-comment-author{font-size:12px;font-weight:700;color:#4f46e5}.tm-comment-text{font-size:13px;color:#1e293b;margin-top:4px}.tm-comment-time{font-size:11px;color:#94a3b8;margin-top:4px}
.tm-cal-grid{display:grid;grid-template-columns:repeat(7,1fr);gap:2px;font-size:12px}
.tm-cal-head{text-align:center;padding:8px;font-weight:700;color:#475569;background:#f1f5f9;border-radius:6px}
.tm-cal-day{min-height:80px;padding:6px;background:#fff;border:1px solid #f1f5f9;border-radius:6px}
.tm-cal-day.today{border-color:#4f46e5;background:#eef2ff}.tm-cal-day-num{font-weight:700;color:#1e293b;font-size:12px}
.tm-cal-task{font-size:10px;padding:2px 6px;border-radius:4px;margin-top:2px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;display:block;color:#fff}
.tm-gantt-bar{height:28px;border-radius:6px;position:absolute;display:flex;align-items:center;padding:0 8px;font-size:11px;font-weight:600;color:#fff;white-space:nowrap;overflow:hidden;cursor:pointer;transition:.15s}
.tm-gantt-bar:hover{opacity:.85;transform:scaleY(1.1)}
@media(max-width:900px){.tm-kanban{grid-template-columns:1fr}.tm-stats{grid-template-columns:1fr 1fr}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function taskManager(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  if (!ah) ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // 1. DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS projects (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(255) NOT NULL, description TEXT, status VARCHAR(20) DEFAULT 'planning',
      priority VARCHAR(20) DEFAULT 'medium', start_date DATE, end_date DATE,
      budget NUMERIC(12,2) DEFAULT 0, progress INTEGER DEFAULT 0,
      created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS project_tasks (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      project_id INTEGER REFERENCES projects(id) ON DELETE CASCADE,
      title VARCHAR(500) NOT NULL, description TEXT, status VARCHAR(20) DEFAULT 'todo',
      priority VARCHAR(20) DEFAULT 'medium', assignee_email VARCHAR(255),
      due_date DATE, estimated_hours NUMERIC(6,2), actual_hours NUMERIC(6,2),
      sort_order INTEGER DEFAULT 0, created_by VARCHAR(255),
      created_at TIMESTAMPTZ DEFAULT NOW(), completed_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS task_comments (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      task_id INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
      user_email VARCHAR(255) NOT NULL, comment_text TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS task_attachments (
      id SERIAL PRIMARY KEY, task_id INTEGER NOT NULL REFERENCES project_tasks(id) ON DELETE CASCADE,
      file_url TEXT, file_name VARCHAR(500), uploaded_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_proj_tenant ON projects(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ptask_tenant ON project_tasks(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ptask_proj ON project_tasks(project_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ptask_status ON project_tasks(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_ptask_due ON project_tasks(due_date)`,
    `CREATE INDEX IF NOT EXISTS idx_tcomment_task ON task_comments(task_id)`,
    `CREATE INDEX IF NOT EXISTS idx_tattach_task ON task_attachments(task_id)`
  ];

  (async () => {
    try { for (const sql of migrations) await migrateQuery(pool, 'TaskManager', sql); logger.info({ msg: '[TaskManager] Migrations applied', count: migrations.length }); }
    catch (e) { /* migration OK */ }
  })().catch(() => {});

  // Nav helper
  const nav = (active) => `<div class="tm-nav">
    <a href="/tasks" class="${active==='dash'?'active':''}">📊 Dashboard</a>
    <a href="/tasks/board" class="${active==='board'?'active':''}">📋 Board</a>
    <a href="/tasks/list" class="${active==='list'?'active':''}">📄 List</a>
    <a href="/tasks/timeline" class="${active==='timeline'?'active':''}">📅 Timeline</a>
    <a href="/tasks/calendar" class="${active==='calendar'?'active':''}">🗓 Calendar</a>
    <a href="/projects" class="${active==='projects'?'active':''}" style="margin-left:auto">📁 Projects</a>
  </div>`;

  const projNav = (active, pid) => `<div class="tm-nav">
    <a href="/tasks" style="color:#64748b">← Tasks</a>
    <a href="/projects" class="${active==='list'?'active':''}">📁 Projects</a>
    <a href="/projects/${pid}" class="${active==='detail'?'active':''}">Overview</a>
    <a href="/projects/${pid}/board" class="${active==='board'?'active':''}">Board</a>
  </div>`;

  // ============================================================
  // ROUTE 1: GET /tasks — Task Dashboard
  // ============================================================
  app.get('/tasks', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const st = (await pool.query(`SELECT status, COUNT(*)::int as cnt FROM project_tasks WHERE tenant_id=$1 GROUP BY status`, [tid])).rows;
    const total = st.reduce((s, r) => s + r.cnt, 0);
    const overdue = (await pool.query(`SELECT COUNT(*)::int as cnt FROM project_tasks WHERE tenant_id=$1 AND status NOT IN ('done') AND due_date < CURRENT_DATE`, [tid])).rows[0].cnt;
    const thisWeek = (await pool.query(`SELECT COUNT(*)::int as cnt FROM project_tasks WHERE tenant_id=$1 AND status='done' AND completed_at >= date_trunc('week', NOW())`, [tid])).rows[0].cnt;
    const recent = (await pool.query(`SELECT pt.*, p.name as project_name FROM project_tasks pt LEFT JOIN projects p ON p.id=pt.project_id WHERE pt.tenant_id=$1 ORDER BY pt.created_at DESC LIMIT 10`, [tid])).rows;

    const statusMap = { todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0 };
    st.forEach(r => { statusMap[r.status] = (statusMap[r.status] || 0) + r.cnt; });

    const recentRows = recent.map(t => `<tr>
      <td><a href="/tasks/${t.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(t.title)}</a></td>
      <td>${esc(t.project_name || '—')}</td>
      <td>${priorityBadge(t.priority)}</td>
      <td><span style="color:${statusColor(t.status)};font-weight:600">${statusLabel(t.status)}</span></td>
      <td>${esc(t.assignee_email || '—')}</td>
      <td style="color:${t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' ? '#dc2626' : '#64748b'}">${formatDate(t.due_date)}</td>
    </tr>`).join('');

    const html = TM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📋 Task Manager</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Track tasks, projects, and team progress</p></div>
        <div style="display:flex;gap:8px"><a href="/tasks/new" class="tm-btn tm-btn-primary">➕ New Task</a><a href="/projects/new" class="tm-btn tm-btn-secondary">📁 New Project</a></div>
      </div>
      <div class="tm-stats">
        <div class="stats"><div class="tm-stat-val">${total}</div><div class="tm-stat-lbl">Total Tasks</div></div>
        <div class="stats"><div class="tm-stat-val" style="color:#3b82f6">${statusMap.in_progress}</div><div class="tm-stat-lbl">In Progress</div></div>
        <div class="stats"><div class="tm-stat-val" style="color:#22c55e">${statusMap.done}</div><div class="tm-stat-lbl">Done</div></div>
        <div class="stats"><div class="tm-stat-val" style="color:#ef4444">${overdue}</div><div class="tm-stat-lbl">Overdue</div></div>
        <div class="stats"><div class="tm-stat-val" style="color:#a855f7">${thisWeek}</div><div class="tm-stat-lbl">Done This Week</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:20px">
        <div class="card" style="padding:16px"><h3 style="font-size:14px;color:#1e293b;margin-bottom:12px">Status Breakdown</h3>
          ${Object.entries(statusMap).map(([s, c]) => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px"><span style="width:10px;height:10px;border-radius:50%;background:${statusColor(s)};display:inline-block"></span><span style="font-size:13px;color:#475569;flex:1">${statusLabel(s)}</span><span style="font-weight:700;font-size:13px">${c}</span></div>`).join('')}
        </div>
        <div class="card" style="padding:16px"><h3 style="font-size:14px;color:#1e293b;margin-bottom:12px">Quick Filters</h3>
          <div style="display:flex;flex-wrap:wrap;gap:6px">
            <a href="/tasks/board?status=in_progress" class="tm-btn tm-btn-secondary" style="font-size:12px;padding:6px 12px">🔵 In Progress (${statusMap.in_progress})</a>
            <a href="/tasks/board?status=todo" class="tm-btn tm-btn-secondary" style="font-size:12px;padding:6px 12px">⬜ To Do (${statusMap.todo})</a>
            <a href="/tasks/board?status=review" class="tm-btn tm-btn-secondary" style="font-size:12px;padding:6px 12px">🟣 Review (${statusMap.review})</a>
            <a href="/tasks/board?status=blocked" class="tm-btn tm-btn-secondary" style="font-size:12px;padding:6px 12px">🔴 Blocked (${statusMap.blocked})</a>
            <a href="/tasks/list?status=done" class="tm-btn tm-btn-secondary" style="font-size:12px;padding:6px 12px">✅ Done (${statusMap.done})</a>
          </div>
        </div>
      </div>
      <div class="card"><h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">Recent Tasks</h3>
        <div style="overflow-x:auto"><table class="tm-table"><thead><tr><th>Task</th><th>Project</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Due</th></tr></thead>
        <tbody>${recentRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No tasks yet. Create your first task!</td></tr>'}</tbody></table></div>
      </div>
    </div>`;
    res.send(renderPage('Task Dashboard', html, user));
  }));

  // ============================================================
  // ROUTE 2: GET /tasks/board — Kanban Board
  // ============================================================
  app.get('/tasks/board', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { project, assignee, priority } = req.query;
    let where = ['pt.tenant_id=$1'], params = [tid], pi = 2;
    if (project) { where.push(`pt.project_id=$${pi++}`); params.push(project); }
    if (assignee) { where.push(`pt.assignee_email=$${pi++}`); params.push(assignee); }
    if (priority) { where.push(`pt.priority=$${pi++}`); params.push(priority); }
    const tasks = (await pool.query(`SELECT pt.*, p.name as project_name FROM project_tasks pt LEFT JOIN projects p ON p.id=pt.project_id WHERE ${where.join(' AND ')} ORDER BY pt.sort_order, pt.created_at`, params)).rows;
    const projects = (await pool.query(`SELECT id, name FROM projects WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const columns = ['todo', 'in_progress', 'review', 'done', 'blocked'];
    const colColors = { todo: '#94a3b8', in_progress: '#3b82f6', review: '#a855f7', done: '#22c55e', blocked: '#ef4444' };
    const grouped = {};
    columns.forEach(c => { grouped[c] = tasks.filter(t => t.status === c); });

    const boardHtml = columns.map(col => {
      const cards = grouped[col].map(t => `<div class="tm-card" style="border-left-color:${priorityBorder(t.priority)}" onclick="location.href='/tasks/${t.id}'">
        <div class="tm-card-title">${esc(t.title)}</div>
        ${t.project_name ? `<div style="font-size:11px;color:#94a3b8;margin-bottom:4px">📁 ${esc(t.project_name)}</div>` : ''}
        <div class="tm-card-meta">
          ${priorityBadge(t.priority)}
          ${t.due_date ? `<span style="color:${t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' ? '#dc2626' : '#64748b'}">📅 ${formatDate(t.due_date)}</span>` : ''}
          ${t.assignee_email ? `<span>👤 ${esc(t.assignee_email.split('@')[0])}</span>` : ''}
        </div>
      </div>`).join('');
      return `<div class="tm-col">
        <div class="tm-col-header" style="background:${colColors[col]};color:#fff"><span>${statusLabel(col)}</span><span class="cnt">${grouped[col].length}</span></div>
        ${cards || '<div style="text-align:center;padding:30px;color:#cbd5e1;font-size:13px">No tasks</div>'}
      </div>`;
    }).join('');

    const html = TM_CSS + `<div style="max-width:1400px;margin:0 auto">
      ${nav('board')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">📋 Kanban Board</h1>
        <a href="/tasks/new${project ? '?project='+project : ''}" class="tm-btn tm-btn-primary">➕ Add Task</a>
      </div>
      <div class="tm-filter">
        <div><label>Project</label><select name="project" onchange="location.href='/tasks/board?project='+this.value"><option value="">All Projects</option>${projects.map(p => `<option value="${p.id}" ${project==p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
        <div><label>Priority</label><select name="priority" onchange="location.href='/tasks/board?priority='+this.value+(project?'&project='+project:'')"><option value="">All</option><option value="critical" ${priority==='critical'?'selected':''}>Critical</option><option value="high" ${priority==='high'?'selected':''}>High</option><option value="medium" ${priority==='medium'?'selected':''}>Medium</option><option value="low" ${priority==='low'?'selected':''}>Low</option></select></div>
      </div>
      <div class="tm-kanban">${boardHtml}</div>
    </div>`;
    res.send(renderPage('Kanban Board', html, user));
  }));

  // ============================================================
  // ROUTE 3: GET /tasks/list — List View
  // ============================================================
  app.get('/tasks/list', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status, priority, assignee, due_from, due_to, page = 1, sort = 'created_at', dir = 'desc' } = req.query;
    let where = ['pt.tenant_id=$1'], params = [tid], pi = 2;
    if (status) { where.push(`pt.status=$${pi++}`); params.push(status); }
    if (priority) { where.push(`pt.priority=$${pi++}`); params.push(priority); }
    if (assignee) { where.push(`pt.assignee_email ILIKE $${pi++}`); params.push('%' + assignee + '%'); }
    if (due_from) { where.push(`pt.due_date >= $${pi++}`); params.push(due_from); }
    if (due_to) { where.push(`pt.due_date <= $${pi++}`); params.push(due_to); }
    const allowedSort = { title: 'pt.title', status: 'pt.status', priority: 'pt.priority', due_date: 'pt.due_date', created_at: 'pt.created_at' };
    const order = (allowedSort[sort] || 'pt.created_at') + ' ' + (dir === 'asc' ? 'ASC' : 'DESC');
    const limit = 25, offset = (parseInt(page) - 1) * limit;
    const countR = (await pool.query(`SELECT COUNT(*) as cnt FROM project_tasks pt WHERE ${where.join(' AND ')}`, params)).rows[0].cnt;
    const totalPages = Math.ceil(countR / limit);
    const tasks = (await pool.query(`SELECT pt.*, p.name as project_name FROM project_tasks pt LEFT JOIN projects p ON p.id=pt.project_id WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT $${pi++} OFFSET $${pi++}`, [...params, limit, offset])).rows;
    const projects = (await pool.query(`SELECT id, name FROM projects WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const rows = tasks.map(t => `<tr>
      <td><a href="/tasks/${t.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(t.title)}</a></td>
      <td>${esc(t.project_name || '—')}</td>
      <td>${priorityBadge(t.priority)}</td>
      <td><span style="color:${statusColor(t.status)};font-weight:600">${statusLabel(t.status)}</span></td>
      <td>${esc(t.assignee_email ? t.assignee_email.split('@')[0] : '—')}</td>
      <td style="color:${t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' ? '#dc2626;font-weight:700' : '#64748b'}">${formatDate(t.due_date)}</td>
      <td>${t.estimated_hours || '—'}</td>
      <td>${formatDateTime(t.created_at)}</td>
    </tr>`).join('');

    const pageLinks = Array.from({ length: Math.min(totalPages, 10) }, (_, i) => `<a href="/tasks/list?page=${i + 1}&status=${status || ''}&priority=${priority || ''}&sort=${sort}&dir=${dir}" class="tm-btn ${parseInt(page) === i + 1 ? 'tm-btn-primary' : 'tm-btn-secondary'}" style="padding:4px 10px;font-size:12px">${i + 1}</a>`).join('');

    const html = TM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('list')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">📄 Task List</h1>
        <a href="/tasks/new" class="tm-btn tm-btn-primary">➕ New Task</a>
      </div>
      <div class="tm-filter">
        <div><label>Status</label><select onchange="location.href='/tasks/list?status='+this.value"><option value="">All</option>${['todo','in_progress','review','done','blocked'].map(s => `<option value="${s}" ${status===s?'selected':''}>${statusLabel(s)}</option>`).join('')}</select></div>
        <div><label>Priority</label><select onchange="location.href='/tasks/list?priority='+this.value"><option value="">All</option>${['critical','high','medium','low'].map(p => `<option value="${p}" ${priority===p?'selected':''}>${p}</option>`).join('')}</select></div>
        <div><label>Project</label><select onchange="location.href='/tasks/list?project='+this.value"><option value="">All</option>${projects.map(p => `<option value="${p.id}">${esc(p.name)}</option>`).join('')}</select></div>
        <div><label>Due From</label><input type="date" value="${due_from || ''}" onchange="location.href='/tasks/list?due_from='+this.value"></div>
        <div><label>Due To</label><input type="date" value="${due_to || ''}" onchange="location.href='/tasks/list?due_to='+this.value"></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="tm-table">
        <thead><tr><th>Title</th><th>Project</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Due</th><th>Hours</th><th>Created</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No tasks found</td></tr>'}</tbody>
      </table></div>
        <div style="display:flex;justify-content:space-between;align-items:center;margin-top:14px">
          <span style="font-size:13px;color:#64748b">${countR} tasks — Page ${page} of ${totalPages}</span>
          <div style="display:flex;gap:4px">${pageLinks}</div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Task List', html, user));
  }));

  // ============================================================
  // ROUTE 4: GET /tasks/timeline — Gantt/Timeline View
  // ============================================================
  app.get('/tasks/timeline', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { project } = req.query;
    let where = ['pt.tenant_id=$1', 'pt.due_date IS NOT NULL'], params = [tid], pi = 2;
    if (project) { where.push(`pt.project_id=$${pi++}`); params.push(project); }
    const tasks = (await pool.query(`SELECT pt.*, p.name as project_name FROM project_tasks pt LEFT JOIN projects p ON p.id=pt.project_id WHERE ${where.join(' AND ')} ORDER BY pt.due_date`, params)).rows;
    const projects = (await pool.query(`SELECT id, name FROM projects WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    if (!tasks.length) return res.send(renderPage('Timeline', TM_CSS + `<div style="max-width:1200px;margin:0 auto">${nav('timeline')}<div class="card" style="text-align:center;padding:60px"><div style="font-size:48px;margin-bottom:12px">📅</div><p style="color:#94a3b8">No tasks with due dates to display on timeline</p><a href="/tasks/new" class="tm-btn tm-btn-primary" style="margin-top:16px">➕ Create Task</a></div></div>`, user));

    const dates = tasks.map(t => new Date(t.created_at)).concat(tasks.map(t => new Date(t.due_date)));
    const minDate = new Date(Math.min(...dates)); minDate.setDate(minDate.getDate() - 2);
    const maxDate = new Date(Math.max(...dates)); maxDate.setDate(maxDate.getDate() + 3);
    const totalDays = Math.ceil((maxDate - minDate) / 86400000);
    const dayW = Math.max(30, totalDays * 3);
    const toLeft = (d) => Math.max(0, Math.ceil((new Date(d) - minDate) / 86400000)) * 3;
    const toWidth = (start, end) => Math.max(20, Math.ceil((new Date(end) - new Date(start)) / 86400000) * 3);

    const barsHtml = tasks.map((t, i) => {
      const left = toLeft(t.created_at);
      const width = toWidth(t.created_at, t.due_date);
      return `<div style="display:flex;align-items:center;margin-bottom:8px;gap:12px">
        <div style="width:200px;min-width:200px;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">
          <a href="/tasks/${t.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(t.title)}</a>
        </div>
        <div style="position:relative;height:32px;flex:1">
          <div class="tm-gantt-bar" style="left:${left}px;width:${width}px;background:${statusColor(t.status)};top:2px">${statusLabel(t.status)}</div>
        </div>
      </div>`;
    }).join('');

    const html = TM_CSS + `<div style="max-width:1400px;margin:0 auto">
      ${nav('timeline')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h1 style="font-size:22px;color:#1e293b">📅 Task Timeline</h1>
        <div class="tm-filter" style="margin-bottom:0">
          <select onchange="location.href='/tasks/timeline?project='+this.value"><option value="">All Projects</option>${projects.map(p => `<option value="${p.id}" ${project==p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="card" style="overflow-x:auto;padding:20px">
        <div style="font-size:11px;color:#94a3b8;margin-bottom:12px;display:flex;gap:16px">${['todo','in_progress','review','done','blocked'].map(s => `<span><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${statusColor(s)};margin-right:4px"></span>${statusLabel(s)}</span>`).join('')}</div>
        <div style="min-width:${dayW}px">${barsHtml}</div>
      </div>
    </div>`;
    res.send(renderPage('Task Timeline', html, user));
  }));

  // ============================================================
  // ROUTE 5: GET /tasks/new — Create Task Form
  // ============================================================
  app.get('/tasks/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const projects = (await pool.query(`SELECT id, name FROM projects WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;
    const html = TM_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('')}
      <a href="/tasks" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Tasks</a>
      <div class="card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">➕ New Task</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Create a new task and assign it to a team member</p>
        <form method="POST" action="/tasks/save" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Title *</label>
            <input type="text" name="title" required placeholder="Task title" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3" placeholder="Task details..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Project</label>
              <select name="project_id" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"><option value="">— No Project —</option>${projects.map(p => `<option value="${p.id}" ${req.query.project==p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Assignee Email</label>
              <input type="email" name="assignee_email" placeholder="user@example.com" value="${esc(user.email)}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Status</label>
              <select name="status" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">${['todo','in_progress','review','done','blocked'].map(s => `<option value="${s}">${statusLabel(s)}</option>`).join('')}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Priority</label>
              <select name="priority" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">${['medium','low','high','critical'].map(p => `<option value="${p}">${p}</option>`).join('')}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Due Date</label>
              <input type="date" name="due_date" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Estimated Hours</label>
              <input type="number" name="estimated_hours" step="0.5" min="0" placeholder="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="tm-btn tm-btn-primary" style="padding:12px 28px">💾 Save Task</button>
            <a href="/tasks" class="tm-btn tm-btn-secondary" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Task', html, user));
  }));

  // ============================================================
  // ROUTE 6: POST /tasks/save — Save Task
  // ============================================================
  app.post('/tasks/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, description, project_id, assignee_email, status, priority, due_date, estimated_hours } = req.body;
    if (!title || !title.trim()) return res.redirect('/tasks/new');
    const result = await pool.query(
      `INSERT INTO project_tasks (tenant_id, project_id, title, description, status, priority, assignee_email, due_date, estimated_hours, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [tid, project_id || null, title.trim(), (description || '').trim(), status || 'todo', priority || 'medium', (assignee_email || '').trim() || null, due_date || null, parseFloat(estimated_hours) || null, user.email]
    );
    audit(user.email, 'task_created', `Task "${title.trim()}" created (ID: ${result.rows[0].id})`);
    logger.info({ msg: '[TaskManager] Task created', id: result.rows[0].id, title: title.trim(), by: user.email });
    try { if (assignee_email) await notify(assignee_email, 'New Task Assigned', `You have been assigned: "${title.trim()}"`); } catch (e) { /* non-critical */ }
    res.redirect('/tasks/' + result.rows[0].id);
  }));

  // ============================================================
  // ROUTE 7: GET /tasks/:id — Task Detail
  // ============================================================
  app.get('/tasks/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, taskId = req.params.id;
    const task = (await pool.query(`SELECT pt.*, p.name as project_name FROM project_tasks pt LEFT JOIN projects p ON p.id=pt.project_id WHERE pt.id=$1 AND pt.tenant_id=$2`, [taskId, tid])).rows[0];
    if (!task) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Task not found</h2><a href="/tasks" class="tm-btn tm-btn-primary" style="margin-top:12px">← Back</a></div>', user));

    const comments = (await pool.query(`SELECT * FROM task_comments WHERE task_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`, [taskId, tid])).rows;
    const idx = STATUS_FLOW.indexOf(task.status);
    const prevStatus = idx > 0 ? STATUS_FLOW[idx - 1] : null;
    const nextStatus = idx < STATUS_FLOW.length - 1 ? STATUS_FLOW[idx + 1] : null;
    const isOverdue = task.due_date && new Date(task.due_date) < new Date() && task.status !== 'done';

    const commentsHtml = comments.map(c => `<div class="tm-comment">
      <div class="tm-comment-author">${esc(c.user_email)}</div>
      <div class="tm-comment-text">${esc(c.comment_text)}</div>
      <div class="tm-comment-time">${formatDateTime(c.created_at)}</div>
    </div>`).join('');

    const html = TM_CSS + `<div style="max-width:900px;margin:0 auto">
      ${nav('')}
      <a href="/tasks/board" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Board</a>
      <div class="card" style="padding:24px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="margin:0 0 8px;color:#1e293b;font-size:22px">${esc(task.title)}</h1>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              ${priorityBadge(task.priority)}
              <span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700;background:${statusColor(task.status)};color:#fff">${statusLabel(task.status)}</span>
              ${isOverdue ? '<span style="background:#fee2e2;color:#dc2626;padding:3px 12px;border-radius:20px;font-size:12px;font-weight:700">OVERDUE</span>' : ''}
              ${task.project_name ? `<a href="/projects/${task.project_id}" style="font-size:12px;color:#4f46e5;text-decoration:none;background:#eef2ff;padding:3px 12px;border-radius:20px;font-weight:600">📁 ${esc(task.project_name)}</a>` : ''}
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${prevStatus ? `<form method="POST" action="/tasks/${task.id}/status" style="display:inline"><input type="hidden" name="status" value="${prevStatus}"><button class="tm-btn tm-btn-secondary" style="padding:6px 14px;font-size:12px">← ${statusLabel(prevStatus)}</button></form>` : ''}
            ${nextStatus ? `<form method="POST" action="/tasks/${task.id}/status" style="display:inline"><input type="hidden" name="status" value="${nextStatus}"><button class="tm-btn tm-btn-primary" style="padding:6px 14px;font-size:12px">${statusLabel(nextStatus)} →</button></form>` : ''}
            <form method="POST" action="/tasks/${task.id}/status" style="display:inline">${task.status !== 'blocked' ? '<input type="hidden" name="status" value="blocked"><button class="tm-btn" style="background:#fee2e2;color:#dc2626;padding:6px 14px;font-size:12px">🚫 Block</button>' : '<input type="hidden" name="status" value="todo"><button class="tm-btn tm-btn-secondary" style="padding:6px 14px;font-size:12px">Unblock</button>'}</form>
          </div>
        </div>
        ${task.description ? `<div style="margin-top:16px;padding:14px;background:#f8fafc;border-radius:10px;font-size:14px;color:#334155;white-space:pre-wrap">${esc(task.description)}</div>` : ''}
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0">
          <div><span style="font-size:11px;color:#94a3b8;display:block">Assignee</span><span style="font-size:14px;font-weight:600;color:#1e293b">${esc(task.assignee_email || 'Unassigned')}</span></div>
          <div><span style="font-size:11px;color:#94a3b8;display:block">Due Date</span><span style="font-size:14px;font-weight:600;color:${isOverdue ? '#dc2626' : '#1e293b'}">${formatDate(task.due_date)}</span></div>
          <div><span style="font-size:11px;color:#94a3b8;display:block">Estimated Hours</span><span style="font-size:14px;font-weight:600;color:#1e293b">${task.estimated_hours || '—'}</span></div>
          <div><span style="font-size:11px;color:#94a3b8;display:block">Actual Hours</span><span style="font-size:14px;font-weight:600;color:#1e293b">${task.actual_hours || '—'}</span></div>
          <div><span style="font-size:11px;color:#94a3b8;display:block">Created</span><span style="font-size:14px;font-weight:600;color:#1e293b">${formatDateTime(task.created_at)}</span></div>
          <div><span style="font-size:11px;color:#94a3b8;display:block">Completed</span><span style="font-size:14px;font-weight:600;color:#1e293b">${task.completed_at ? formatDateTime(task.completed_at) : '—'}</span></div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">💬 Comments (${comments.length})</h3>
          ${commentsHtml || '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">No comments yet</p>'}
          <form method="POST" action="/tasks/${task.id}/comment" style="margin-top:12px;display:flex;gap:8px">
            <input type="text" name="comment" placeholder="Add a comment..." required style="flex:1;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
            <button type="submit" class="tm-btn tm-btn-primary">Post</button>
          </form>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin-bottom:12px">✏️ Edit Task</h3>
          <form method="POST" action="/tasks/${task.id}/update" style="display:flex;flex-direction:column;gap:10px">
            <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Title</label><input type="text" name="title" value="${esc(task.title)}" required style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"></div>
            <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;resize:vertical">${esc(task.description)}</textarea></div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Priority</label><select name="priority" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px">${['critical','high','medium','low'].map(p => `<option value="${p}" ${task.priority===p?'selected':''}>${p}</option>`).join('')}</select></div>
              <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Assignee</label><input type="email" name="assignee_email" value="${esc(task.assignee_email || '')}" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px"></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
              <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Due Date</label><input type="date" name="due_date" value="${task.due_date || ''}" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px"></div>
              <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Est. Hours</label><input type="number" name="estimated_hours" step="0.5" value="${task.estimated_hours || ''}" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px"></div>
              <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Actual Hours</label><input type="number" name="actual_hours" step="0.5" value="${task.actual_hours || ''}" style="width:100%;padding:8px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px"></div>
            </div>
            <button type="submit" class="tm-btn tm-btn-primary" style="justify-content:center;margin-top:4px">💾 Save Changes</button>
          </form>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Task — ' + task.title, html, user));
  }));

  // ============================================================
  // ROUTE 8: POST /tasks/:id/update — Update Task
  // ============================================================
  app.post('/tasks/:id/update', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, taskId = req.params.id;
    const { title, description, priority, assignee_email, due_date, estimated_hours, actual_hours } = req.body;
    await pool.query(
      `UPDATE project_tasks SET title=$1, description=$2, priority=$3, assignee_email=$4, due_date=$5, estimated_hours=$6, actual_hours=$7, updated_at=NOW() WHERE id=$8 AND tenant_id=$9`,
      [(title || '').trim(), (description || '').trim(), priority || 'medium', (assignee_email || '').trim() || null, due_date || null, parseFloat(estimated_hours) || null, parseFloat(actual_hours) || null, taskId, tid]
    );
    audit(user.email, 'task_updated', `Task #${taskId} updated`);
    res.redirect('/tasks/' + taskId);
  }));

  // ============================================================
  // ROUTE 9: POST /tasks/:id/status — Quick Status Change
  // ============================================================
  app.post('/tasks/:id/status', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, taskId = req.params.id;
    const { status } = req.body;
    if (!status || !['todo', 'in_progress', 'review', 'done', 'blocked'].includes(status)) return res.redirect('/tasks/' + taskId);
    const completedAt = status === 'done' ? 'NOW()' : (status !== 'done' ? 'NULL' : 'completed_at');
    await pool.query(
      `UPDATE project_tasks SET status=$1, completed_at=${completedAt === 'NULL' ? 'NULL' : completedAt} WHERE id=$2 AND tenant_id=$3`,
      [status, taskId, tid]
    );
    // Update project progress
    const projRow = (await pool.query(`SELECT project_id FROM project_tasks WHERE id=$1`, [taskId])).rows[0];
    if (projRow && projRow.project_id) {
      await pool.query(`UPDATE projects SET progress = (SELECT ROUND(COUNT(*) FILTER (WHERE status='done')::numeric / NULLIF(COUNT(*),0) * 100) FROM project_tasks WHERE project_id=$1), updated_at=NOW() WHERE id=$1`, [projRow.project_id]);
    }
    audit(user.email, 'task_status_change', `Task #${taskId} → ${status}`);
    logger.info({ msg: '[TaskManager] Status changed', taskId, status, by: user.email });
    res.redirect('/tasks/' + taskId);
  }));

  // ============================================================
  // ROUTE 10: POST /tasks/:id/comment — Add Comment
  // ============================================================
  app.post('/tasks/:id/comment', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, taskId = req.params.id;
    const { comment } = req.body;
    if (!comment || !comment.trim()) return res.redirect('/tasks/' + taskId);
    await pool.query(`INSERT INTO task_comments (tenant_id, task_id, user_email, comment_text) VALUES ($1,$2,$3,$4)`, [tid, taskId, user.email, comment.trim()]);
    audit(user.email, 'task_comment', `Comment on task #${taskId}`);
    res.redirect('/tasks/' + taskId);
  }));

  // ============================================================
  // ROUTE 11: GET /tasks/:id/comments — Load Comments JSON
  // ============================================================
  app.get('/tasks/:id/comments', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, taskId = req.params.id;
    const comments = (await pool.query(`SELECT * FROM task_comments WHERE task_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`, [taskId, tid])).rows;
    res.json({ success: true, comments });
  }));

  // ============================================================
  // ROUTE 12: GET /tasks/calendar — Calendar View
  // ============================================================
  app.get('/tasks/calendar', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { month: qm, year: qy, project } = req.query;
    const now = new Date();
    const month = parseInt(qm) || now.getMonth() + 1;
    const year = parseInt(qy) || now.getFullYear();
    const firstDay = new Date(year, month - 1, 1);
    const lastDay = new Date(year, month, 0);
    const startPad = firstDay.getDay();
    const daysInMonth = lastDay.getDate();
    const monthName = firstDay.toLocaleString('en-US', { month: 'long', year: 'numeric' });

    let where = ['pt.tenant_id=$1', 'pt.due_date IS NOT NULL', `pt.due_date BETWEEN $2 AND $3`], params = [tid, firstDay, lastDay], pi = 4;
    if (project) { where.push(`pt.project_id=$${pi++}`); params.push(project); }
    const tasks = (await pool.query(`SELECT pt.id, pt.title, pt.status, pt.priority, pt.due_date FROM project_tasks pt WHERE ${where.join(' AND ')}`, params)).rows;
    const projects = (await pool.query(`SELECT id, name FROM projects WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const tasksByDay = {};
    tasks.forEach(t => { const d = new Date(t.due_date).getDate(); if (!tasksByDay[d]) tasksByDay[d] = []; tasksByDay[d].push(t); });

    const today = new Date();
    let cells = '';
    for (let i = 0; i < startPad; i++) cells += '<div class="tm-cal-day" style="background:#f8fafc"></div>';
    for (let d = 1; d <= daysInMonth; d++) {
      const isToday = d === today.getDate() && month === today.getMonth() + 1 && year === today.getFullYear();
      const dayTasks = tasksByDay[d] || [];
      const taskDots = dayTasks.slice(0, 3).map(t => `<a href="/tasks/${t.id}" class="tm-cal-task" style="background:${statusColor(t.status)}">${esc(t.title)}</a>`).join('') + (dayTasks.length > 3 ? `<span style="font-size:10px;color:#94a3b8">+${dayTasks.length - 3} more</span>` : '');
      cells += `<div class="tm-cal-day ${isToday ? 'today' : ''}"><div class="tm-cal-day-num">${d}</div>${taskDots}</div>`;
    }

    const prevM = month === 1 ? 12 : month - 1, prevY = month === 1 ? year - 1 : year;
    const nextM = month === 12 ? 1 : month + 1, nextY = month === 12 ? year + 1 : year;

    const html = TM_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('calendar')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div style="display:flex;align-items:center;gap:12px">
          <a href="/tasks/calendar?month=${prevM}&year=${prevY}${project ? '&project='+project : ''}" class="tm-btn tm-btn-secondary" style="padding:8px 14px">←</a>
          <h1 style="font-size:22px;color:#1e293b;min-width:220px;text-align:center">${monthName}</h1>
          <a href="/tasks/calendar?month=${nextM}&year=${nextY}${project ? '&project='+project : ''}" class="tm-btn tm-btn-secondary" style="padding:8px 14px">→</a>
        </div>
        <select onchange="location.href='/tasks/calendar?project='+this.value" style="padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"><option value="">All Projects</option>${projects.map(p => `<option value="${p.id}" ${project==p.id?'selected':''}>${esc(p.name)}</option>`).join('')}</select>
      </div>
      <div class="card" style="padding:16px">
        <div class="tm-cal-grid">
          <div class="tm-cal-head">Sun</div><div class="tm-cal-head">Mon</div><div class="tm-cal-head">Tue</div><div class="tm-cal-head">Wed</div><div class="tm-cal-head">Thu</div><div class="tm-cal-head">Fri</div><div class="tm-cal-head">Sat</div>
          ${cells}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Task Calendar', html, user));
  }));

  // ============================================================
  // ROUTE 13: GET /projects — Projects List
  // ============================================================
  app.get('/projects', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const projects = (await pool.query(
      `SELECT p.*, (SELECT COUNT(*)::int FROM project_tasks WHERE project_id=p.id) as task_count, (SELECT COUNT(*)::int FROM project_tasks WHERE project_id=p.id AND status='done') as done_count FROM projects p WHERE p.tenant_id=$1 ORDER BY p.created_at DESC`, [tid]
    )).rows;

    const cards = projects.map(p => {
      const pct = p.task_count > 0 ? Math.round(p.done_count / p.task_count * 100) : 0;
      return `<div class="card" style="padding:20px;cursor:pointer" onclick="location.href='/projects/${p.id}'">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <h3 style="margin:0;font-size:16px;color:#1e293b">${esc(p.name)}</h3>
          ${projectStatusBadge(p.status)}
        </div>
        ${p.description ? `<p style="font-size:13px;color:#64748b;margin-bottom:12px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden">${esc(p.description)}</p>` : ''}
        <div style="margin-bottom:10px">${progressBar(pct)}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px;color:#94a3b8">
          <span>${p.task_count} tasks</span>
          <span>${priorityBadge(p.priority)}</span>
          <span>${formatDate(p.end_date)}</span>
        </div>
      </div>`;
    }).join('');

    const html = TM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('projects')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📁 Projects</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage projects and track progress</p></div>
        <a href="/projects/new" class="tm-btn tm-btn-primary">➕ New Project</a>
      </div>
      <div class="grid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">
        ${cards || '<div class="card" style="grid-column:1/-1;text-align:center;padding:60px"><div style="font-size:48px;margin-bottom:12px">📁</div><p style="color:#94a3b8">No projects yet</p><a href="/projects/new" class="tm-btn tm-btn-primary" style="margin-top:16px">Create Your First Project</a></div>'}
      </div>
    </div>`;
    res.send(renderPage('Projects', html, user));
  }));

  // ============================================================
  // ROUTE 14: GET /projects/new — Create Project Form
  // ============================================================
  app.get('/projects/new', requireAuth, ah(async (req, res) => {
    const html = TM_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('projects')}
      <a href="/projects" style="color:#64748b;font-size:14px;text-decoration:none;margin-bottom:16px;display:inline-block">← Back to Projects</a>
      <div class="card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">📁 New Project</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Set up a new project to organize tasks</p>
        <form method="POST" action="/projects/save" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Project Name *</label>
            <input type="text" name="name" required placeholder="Project name" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="3" placeholder="Project description..." style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Status</label>
              <select name="status" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">${['planning','active','on_hold','completed'].map(s => `<option value="${s}" ${s==='planning'?'selected':''}>${s.replace('_',' ')}</option>`).join('')}</select></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Priority</label>
              <select name="priority" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">${['medium','low','high','critical'].map(p => `<option value="${p}">${p}</option>`).join('')}</select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Start Date</label>
              <input type="date" name="start_date" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">End Date</label>
              <input type="date" name="end_date" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Budget (UGX)</label>
              <input type="number" name="budget" step="1000" min="0" placeholder="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="tm-btn tm-btn-primary" style="padding:12px 28px">💾 Create Project</button>
            <a href="/projects" class="tm-btn tm-btn-secondary" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Project', html, user));
  }));

  // ============================================================
  // ROUTE 15: POST /projects/save — Save Project
  // ============================================================
  app.post('/projects/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, description, status, priority, start_date, end_date, budget } = req.body;
    if (!name || !name.trim()) return res.redirect('/projects/new');
    const result = await pool.query(
      `INSERT INTO projects (tenant_id, name, description, status, priority, start_date, end_date, budget, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [tid, name.trim(), (description || '').trim(), status || 'planning', priority || 'medium', start_date || null, end_date || null, parseFloat(budget) || 0, user.email]
    );
    audit(user.email, 'project_created', `Project "${name.trim()}" created (ID: ${result.rows[0].id})`);
    logger.info({ msg: '[TaskManager] Project created', id: result.rows[0].id, name: name.trim(), by: user.email });
    res.redirect('/projects/' + result.rows[0].id);
  }));

  // ============================================================
  // ROUTE 16: GET /projects/:id — Project Detail
  // ============================================================
  app.get('/projects/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, pid = req.params.id;
    const project = (await pool.query(`SELECT * FROM projects WHERE id=$1 AND tenant_id=$2`, [pid, tid])).rows[0];
    if (!project) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Project not found</h2><a href="/projects" class="tm-btn tm-btn-primary" style="margin-top:12px">← Projects</a></div>', user));

    const tasks = (await pool.query(`SELECT * FROM project_tasks WHERE project_id=$1 AND tenant_id=$2 ORDER BY sort_order, created_at`, [pid, tid])).rows;
    const taskStats = { todo: 0, in_progress: 0, review: 0, done: 0, blocked: 0 };
    tasks.forEach(t => { taskStats[t.status] = (taskStats[t.status] || 0) + 1; });
    const totalTasks = tasks.length;
    const pct = totalTasks > 0 ? Math.round(taskStats.done / totalTasks * 100) : 0;

    const taskRows = tasks.map(t => `<tr>
      <td><a href="/tasks/${t.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(t.title)}</a></td>
      <td>${priorityBadge(t.priority)}</td>
      <td><span style="color:${statusColor(t.status)};font-weight:600">${statusLabel(t.status)}</span></td>
      <td>${esc(t.assignee_email ? t.assignee_email.split('@')[0] : '—')}</td>
      <td style="color:${t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' ? '#dc2626' : '#64748b'}">${formatDate(t.due_date)}</td>
      <td>${t.estimated_hours || '—'}h</td>
    </tr>`).join('');

    const teamMembers = [...new Set(tasks.filter(t => t.assignee_email).map(t => t.assignee_email))];
    const teamHtml = teamMembers.map(e => `<span style="display:inline-flex;align-items:center;gap:4px;background:#f1f5f9;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600;color:#475569">👤 ${esc(e.split('@')[0])}</span>`).join('');

    const html = TM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${projNav('detail', pid)}
      <div style="display:flex;align-items:start;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <a href="/projects" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:8px">← All Projects</a>
          <h1 style="margin:0 0 6px;color:#1e293b;font-size:24px">${esc(project.name)}</h1>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${projectStatusBadge(project.status)} ${priorityBadge(project.priority)}
            <span style="font-size:12px;color:#94a3b8">${formatDate(project.start_date)} → ${formatDate(project.end_date)}</span></div>
          ${project.description ? `<p style="font-size:14px;color:#64748b;margin-top:8px;max-width:600px">${esc(project.description)}</p>` : ''}
        </div>
        <a href="/projects/${pid}/board" class="tm-btn tm-btn-primary">📋 Open Board</a>
      </div>
      <div class="tm-stats" style="grid-template-columns:repeat(6,1fr)">
        <div class="stats"><div class="tm-stat-val">${totalTasks}</div><div class="tm-stat-lbl">Total</div></div>
        <div class="stats"><div class="tm-stat-val" style="color:#94a3b8">${taskStats.todo}</div><div class="tm-stat-lbl">To Do</div></div>
        <div class="stats"><div class="tm-stat-val" style="color:#3b82f6">${taskStats.in_progress}</div><div class="tm-stat-lbl">In Progress</div></div>
        <div class="stats"><div class="tm-stat-val" style="color:#a855f7">${taskStats.review}</div><div class="tm-stat-lbl">Review</div></div>
        <div class="stats"><div class="tm-stat-val" style="color:#22c55e">${taskStats.done}</div><div class="tm-stat-lbl">Done</div></div>
        <div class="stats"><div class="tm-stat-val" style="color:#ef4444">${taskStats.blocked}</div><div class="tm-stat-lbl">Blocked</div></div>
      </div>
      <div style="margin-bottom:20px"><span style="font-size:13px;font-weight:600;color:#475569">Progress</span><div style="margin-top:6px">${progressBar(pct)}</div></div>
      ${teamHtml ? `<div style="margin-bottom:20px"><span style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:8px">Team</span><div style="display:flex;gap:6px;flex-wrap:wrap">${teamHtml}</div></div>` : ''}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <h2 style="font-size:18px;color:#1e293b">Tasks</h2>
        <a href="/tasks/new?project=${pid}" class="tm-btn tm-btn-primary" style="font-size:12px">➕ Add Task</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="tm-table">
        <thead><tr><th>Task</th><th>Priority</th><th>Status</th><th>Assignee</th><th>Due</th><th>Hours</th></tr></thead>
        <tbody>${taskRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No tasks in this project yet</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Project — ' + project.name, html, user));
  }));

  // ============================================================
  // ROUTE 17: GET /projects/:id/board — Project Kanban Board
  // ============================================================
  app.get('/projects/:id/board', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, pid = req.params.id;
    const project = (await pool.query(`SELECT * FROM projects WHERE id=$1 AND tenant_id=$2`, [pid, tid])).rows[0];
    if (!project) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Project not found</h2><a href="/projects" class="tm-btn tm-btn-primary" style="margin-top:12px">← Projects</a></div>', user));

    const tasks = (await pool.query(`SELECT * FROM project_tasks WHERE project_id=$1 AND tenant_id=$2 ORDER BY sort_order, created_at`, [pid, tid])).rows;
    const columns = ['todo', 'in_progress', 'review', 'done', 'blocked'];
    const colColors = { todo: '#94a3b8', in_progress: '#3b82f6', review: '#a855f7', done: '#22c55e', blocked: '#ef4444' };
    const grouped = {};
    columns.forEach(c => { grouped[c] = tasks.filter(t => t.status === c); });

    const boardHtml = columns.map(col => {
      const cards = grouped[col].map(t => `<div class="tm-card" style="border-left-color:${priorityBorder(t.priority)}" onclick="location.href='/tasks/${t.id}'">
        <div class="tm-card-title">${esc(t.title)}</div>
        <div class="tm-card-meta">
          ${priorityBadge(t.priority)}
          ${t.due_date ? `<span style="color:${t.due_date && new Date(t.due_date) < new Date() && t.status !== 'done' ? '#dc2626' : '#64748b'}">📅 ${formatDate(t.due_date)}</span>` : ''}
          ${t.assignee_email ? `<span>👤 ${esc(t.assignee_email.split('@')[0])}</span>` : ''}
        </div>
      </div>`).join('');
      return `<div class="tm-col">
        <div class="tm-col-header" style="background:${colColors[col]};color:#fff"><span>${statusLabel(col)}</span><span class="cnt">${grouped[col].length}</span></div>
        ${cards || '<div style="text-align:center;padding:30px;color:#cbd5e1;font-size:13px">No tasks</div>'}
      </div>`;
    }).join('');

    const html = TM_CSS + `<div style="max-width:1400px;margin:0 auto">
      ${projNav('board', pid)}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">📁 ${esc(project.name)} — Board</h1>
          <p style="font-size:13px;color:#94a3b8;margin-top:2px">${tasks.length} tasks</p></div>
        <a href="/tasks/new?project=${pid}" class="tm-btn tm-btn-primary">➕ Add Task</a>
      </div>
      <div class="tm-kanban">${boardHtml}</div>
    </div>`;
    res.send(renderPage('Project Board — ' + project.name, html, user));
  }));

  logger.info('[TaskManager] Module loaded — 17 routes registered');
};
