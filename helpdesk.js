// ============================================================
// HELP DESK / TICKET SYSTEM MODULE — Multi-Tenant SaaS Platform
// Full ticket lifecycle: create, reply, assign, prioritize, close,
// rate, categorize. Dashboard analytics, SLA tracking, reports.
// ============================================================
// Usage in server.js:
//   const helpdesk = require('./helpdesk');
//   helpdesk(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const { migrateQuery } = require('./db');
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const formatDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

function statusBadge(status) {
  const map = {
    open:       { bg: '#dbeafe', c: '#1d4ed8', l: 'Open' },
    in_progress:{ bg: '#fef3c7', c: '#b45309', l: 'In Progress' },
    pending:    { bg: '#fef9c3', c: '#a16207', l: 'Pending' },
    resolved:   { bg: '#dcfce7', c: '#16a34a', l: 'Resolved' },
    closed:     { bg: '#f1f5f9', c: '#64748b', l: 'Closed' }
  };
  const s = map[status] || map.open;
  return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
}

function priorityBadge(p) {
  const map = {
    urgent:  { bg: '#fee2e2', c: '#dc2626', l: '🔴 Urgent' },
    high:    { bg: '#ffedd5', c: '#ea580c', l: '🟠 High' },
    normal:  { bg: '#dbeafe', c: '#2563eb', l: '🔵 Normal' },
    low:     { bg: '#dcfce7', c: '#16a34a', l: '🟢 Low' }
  };
  const s = map[p] || map.normal;
  return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
}

function categoryDot(color) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color || '#3b82f6'};margin-right:6px;vertical-align:middle"></span>`;
}

function slaCountdown(createdAt, slaHours) {
  if (!createdAt || !slaHours) return '<span class="muted">No SLA</span>';
  const deadline = new Date(createdAt).getTime() + slaHours * 3600000;
  const now = Date.now();
  const diff = deadline - now;
  if (diff <= 0) return '<span class="badge badge-error">⏰ Overdue</span>';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  const color = diff < 3600000 ? '#dc2626' : diff < 86400000 ? '#f59e0b' : '#16a34a';
  return `<span style="color:${color};font-weight:600;font-size:12px">${h}h ${m}m left</span>`;
}

function starRating(val) {
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= val ? '★' : '☆';
  return `<span style="color:#f59e0b;font-size:18px;letter-spacing:2px">${s}</span>`;
}

// Shared CSS
const HD_CSS = `<style>
.hd-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.hd-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.hd-nav a:hover{background:#e2e8f0}.hd-nav a.active{background:#4f46e5;color:#fff}
.hd-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-bottom:20px}
.hd-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:16px;text-align:center;transition:.15s}
.hd-stat:hover{box-shadow:0 2px 12px rgba(0,0,0,.05)}
.hd-stat-val{font-size:28px;font-weight:800;color:#1e293b}.hd-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
.hd-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.hd-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.hd-filter input,.hd-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.hd-filter input:focus,.hd-filter select:focus{outline:none;border-color:#6366f1}
.hd-table{width:100%;border-collapse:collapse;font-size:13px}
.hd-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.hd-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}.hd-table tr:hover{background:#f8fafc}
.hd-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.hd-btn:hover{opacity:.9;transform:translateY(-1px)}
.hd-btn-primary{background:#4f46e5;color:#fff}.hd-btn-success{background:#059669;color:#fff}
.hd-btn-danger{background:#fee2e2;color:#dc2626}.hd-btn-secondary{background:#f1f5f9;color:#475569}
.hd-timeline{position:relative;padding-left:30px;margin-top:16px}
.hd-timeline::before{content:'';position:absolute;left:12px;top:0;bottom:0;width:2px;background:#e2e8f0}
.hd-tl-item{position:relative;margin-bottom:16px;padding:14px;background:#fff;border:1px solid #e2e8f0;border-radius:10px}
.hd-tl-item::before{content:'';position:absolute;left:-22px;top:18px;width:12px;height:12px;border-radius:50%;background:#4f46e5;border:2px solid #fff;box-shadow:0 0 0 2px #e2e8f0}
.hd-tl-item.internal{border-left:3px solid #f59e0b;background:#fffbeb}
.hd-tl-item.internal::before{background:#f59e0b}
.hd-tl-item.system{border-left:3px solid #94a3b8;background:#f8fafc}
.hd-tl-item.system::before{background:#94a3b8}
.hd-tl-author{font-size:13px;font-weight:700;color:#1e293b}.hd-tl-time{font-size:11px;color:#94a3b8;margin-top:4px}
.hd-tl-body{font-size:13px;color:#334155;margin-top:6px;white-space:pre-wrap}
.hd-sla-bar{display:flex;align-items:center;gap:8px;padding:10px 14px;border-radius:8px;font-size:12px;font-weight:600}
.hd-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
.hd-form input,.hd-form select,.hd-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
.hd-form input:focus,.hd-form select:focus,.hd-form textarea:focus{outline:none;border-color:#6366f1}
.hd-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:768px){.hd-grid{grid-template-columns:1fr}.hd-stats{grid-template-columns:1fr 1fr}.hd-filter{flex-direction:column}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function helpdesk(app, db, pool, renderPage, esc) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // 1. DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS support_tickets (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      ticket_number VARCHAR(20) UNIQUE, subject VARCHAR(255) NOT NULL,
      description TEXT, category VARCHAR(50) DEFAULT 'general', priority VARCHAR(20) DEFAULT 'normal',
      status VARCHAR(20) DEFAULT 'open', assigned_to INTEGER REFERENCES users(id),
      created_by INTEGER REFERENCES users(id), contact_name VARCHAR(255), contact_email VARCHAR(255),
      contact_phone VARCHAR(20), due_date DATE, resolution TEXT, resolution_time INTEGER,
      satisfaction_rating INTEGER, tags TEXT[], attachments TEXT[],
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS ticket_replies (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      ticket_id INTEGER NOT NULL REFERENCES support_tickets(id) ON DELETE CASCADE,
      author_id INTEGER REFERENCES users(id), author_name VARCHAR(255),
      body TEXT NOT NULL, is_internal BOOLEAN DEFAULT false,
      attachments TEXT[], created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS ticket_categories (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL, description TEXT, color VARCHAR(20) DEFAULT '#3b82f6',
      sla_hours INTEGER DEFAULT 48, is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE columns)
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS ticket_number VARCHAR(20) UNIQUE`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS subject VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'general'`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS priority VARCHAR(20) DEFAULT 'normal'`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'open'`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id)`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS created_by INTEGER REFERENCES users(id)`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255)`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255)`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(20)`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS due_date DATE`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS resolution TEXT`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS resolution_time INTEGER`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS satisfaction_rating INTEGER`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS tags TEXT[]`,
    `ALTER TABLE IF EXISTS support_tickets ADD COLUMN IF NOT EXISTS attachments TEXT[]`,
    `ALTER TABLE IF EXISTS ticket_replies ADD COLUMN IF NOT EXISTS author_name VARCHAR(255)`,
    `ALTER TABLE IF EXISTS ticket_replies ADD COLUMN IF NOT EXISTS is_internal BOOLEAN DEFAULT false`,
    `ALTER TABLE IF EXISTS ticket_replies ADD COLUMN IF NOT EXISTS attachments TEXT[]`,
    `ALTER TABLE IF EXISTS ticket_categories ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS ticket_categories ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#3b82f6'`,
    `ALTER TABLE IF EXISTS ticket_categories ADD COLUMN IF NOT EXISTS sla_hours INTEGER DEFAULT 48`,
    `ALTER TABLE IF EXISTS ticket_categories ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_stickets_tenant ON support_tickets(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_stickets_status ON support_tickets(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_stickets_priority ON support_tickets(tenant_id, priority)`,
    `CREATE INDEX IF NOT EXISTS idx_stickets_category ON support_tickets(tenant_id, category)`,
    `CREATE INDEX IF NOT EXISTS idx_stickets_assigned ON support_tickets(assigned_to)`,
    `CREATE INDEX IF NOT EXISTS idx_sreplies_ticket ON ticket_replies(ticket_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sreplies_tenant ON ticket_replies(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_scats_tenant ON ticket_categories(tenant_id)`
  ];

  const seedCategories = [
    `INSERT INTO ticket_categories (tenant_id, name, description, color, sla_hours) VALUES
      (0, 'Technical Support', 'Hardware, software, and network issues', '#3b82f6', 24) ON CONFLICT DO NOTHING`,
    `INSERT INTO ticket_categories (tenant_id, name, description, color, sla_hours) VALUES
      (0, 'Billing', 'Invoices, payments, and billing disputes', '#f59e0b', 48) ON CONFLICT DO NOTHING`,
    `INSERT INTO ticket_categories (tenant_id, name, description, color, sla_hours) VALUES
      (0, 'General Inquiry', 'General questions and information requests', '#8b5cf6', 72) ON CONFLICT DO NOTHING`,
    `INSERT INTO ticket_categories (tenant_id, name, description, color, sla_hours) VALUES
      (0, 'Feature Request', 'Product enhancement and feature suggestions', '#06b6d4', 168) ON CONFLICT DO NOTHING`,
    `INSERT INTO ticket_categories (tenant_id, name, description, color, sla_hours) VALUES
      (0, 'Bug Report', 'Software defects and error reports', '#ef4444', 12) ON CONFLICT DO NOTHING`,
    `INSERT INTO ticket_categories (tenant_id, name, description, color, sla_hours) VALUES
      (0, 'Account Issue', 'Login, access, and account management', '#64748b', 24) ON CONFLICT DO NOTHING`
  ];

  (async () => {
    try {
      for (const sql of migrations) await migrateQuery(pool, 'Helpdesk', sql);
      // Seed categories per tenant
      const tenants = (await migrateQuery(pool, 'Helpdesk', 'SELECT id FROM tenants')).rows;
      for (const t of tenants) {
        for (const seed of seedCategories) {
          await migrateQuery(pool, 'Helpdesk', seed.replace('(0,', `(${t.id},`).replace(' ON CONFLICT DO NOTHING', ' ON CONFLICT DO NOTHING'));
        }
      }
      console.log('[Helpdesk] Migrations applied, categories seeded');
    } catch (e) { console.error('[Helpdesk] Migration error:', e.message); }
  })();

  // ============================================================
  // HELPERS
  // ============================================================
  const nav = (active) => `<div class="hd-nav">
    <a href="/helpdesk" class="${active==='all'?'active':''}">🎫 All Tickets</a>
    <a href="/helpdesk/my-tickets" class="${active==='mine'?'active':''}">👤 My Tickets</a>
    <a href="/helpdesk/categories" class="${active==='cats'?'active':''}">📂 Categories</a>
    <a href="/helpdesk/report" class="${active==='report'?'active':''}">📊 Reports</a>
  </div>`;

  async function generateTicketNumber(tid) {
    const r = await pool.query(`SELECT ticket_number FROM support_tickets WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1`, [tid]);
    let next = 1;
    if (r.rows.length && r.rows[0].ticket_number) {
      const m = r.rows[0].ticket_number.match(/TK-(\d+)/);
      if (m) next = parseInt(m[1]) + 1;
    }
    return 'TK-' + String(next).padStart(6, '0');
  }

  // ============================================================
  // ROUTE 1: GET /helpdesk — Dashboard
  // ============================================================
  app.get('/helpdesk', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { status, priority, category, search } = req.query;
    let where = ['st.tenant_id=$1'], params = [tid], pi = 2;
    if (status) { where.push(`st.status=$${pi++}`); params.push(status); }
    if (priority) { where.push(`st.priority=$${pi++}`); params.push(priority); }
    if (category) { where.push(`st.category=$${pi++}`); params.push(category); }
    if (search) { where.push(`(st.subject ILIKE $${pi} OR st.ticket_number ILIKE $${pi})`); params.push('%' + search + '%'); pi++; }

    const statsR = await pool.query(`SELECT status, COUNT(*)::int as cnt FROM support_tickets WHERE tenant_id=$1 GROUP BY status`, [tid]);
    const statsMap = {}; let total = 0;
    statsR.rows.forEach(r => { statsMap[r.status] = r.cnt; total += r.cnt; });
    const open = statsMap.open || 0, closed = (statsMap.closed || 0) + (statsMap.resolved || 0);
    const pending = statsMap.in_progress || 0;
    const overdueR = (await pool.query(`SELECT COUNT(*)::int as cnt FROM support_tickets WHERE tenant_id=$1 AND status NOT IN ('closed','resolved') AND created_at < NOW() - INTERVAL '72 hours'`, [tid])).rows[0].cnt;

    const categories = (await pool.query(`SELECT * FROM ticket_categories WHERE tenant_id=$1 AND is_active=true ORDER BY name`, [tid])).rows;
    const tickets = (await pool.query(
      `SELECT st.*, u1.name as assignee_name, u2.name as creator_name, tc.color as cat_color, tc.sla_hours
       FROM support_tickets st
       LEFT JOIN users u1 ON u1.id = st.assigned_to
       LEFT JOIN users u2 ON u2.id = st.created_by
       LEFT JOIN ticket_categories tc ON tc.name = st.category AND tc.tenant_id = st.tenant_id
       WHERE ${where.join(' AND ')} ORDER BY st.created_at DESC LIMIT 50`, params
    )).rows;

    const rows = tickets.map(t => `<tr>
      <td><a href="/helpdesk/${t.id}" style="color:#4f46e5;text-decoration:none;font-weight:600;font-family:monospace">${esc(t.ticket_number)}</a></td>
      <td><a href="/helpdesk/${t.id}" style="color:#1e293b;text-decoration:none;font-weight:600">${esc(t.subject)}</a></td>
      <td>${statusBadge(t.status)}</td>
      <td>${priorityBadge(t.priority)}</td>
      <td>${categoryDot(t.cat_color)}<span style="font-size:12px">${esc(t.category)}</span></td>
      <td>${esc(t.assignee_name || 'Unassigned')}</td>
      <td>${slaCountdown(t.created_at, t.sla_hours)}</td>
      <td style="font-size:12px;color:#94a3b8">${formatDate(t.created_at)}</td>
    </tr>`).join('');

    const html = HD_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('all')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🎫 Help Desk</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage support tickets and customer requests</p></div>
        <a href="/helpdesk/new" class="hd-btn hd-btn-primary">➕ New Ticket</a>
      </div>
      <div class="hd-stats">
        <div class="stat-card"><div class="stat-num">${total}</div><div class="muted">Total Tickets</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${open}</div><div class="muted">Open</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${pending}</div><div class="muted">In Progress</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#22c55e">${closed}</div><div class="muted">Resolved / Closed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${overdueR}</div><div class="muted">Overdue</div></div>
      </div>
      <div class="hd-filter">
        <div><label>Status</label><select onchange="location.href='/helpdesk?status='+this.value${category ? " + \"&category=\" + encodeURIComponent('" + esc(category) + "')" : ''}"><option value="">All</option>${['open','in_progress','pending','resolved','closed'].map(s=>`<option value="${s}" ${status===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}</select></div>
        <div><label>Priority</label><select onchange="location.href='/helpdesk?priority='+this.value"><option value="">All</option>${['urgent','high','normal','low'].map(p=>`<option value="${p}" ${priority===p?'selected':''}>${p}</option>`).join('')}</select></div>
        <div><label>Category</label><select onchange="location.href='/helpdesk?category='+this.value"><option value="">All</option>${categories.map(c=>`<option value="${esc(c.name)}" ${category===c.name?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>
        <div><label>Search</label><form method="GET" style="display:flex;gap:6px"><input type="text" name="search" value="${esc(search||'')}" placeholder="Search tickets..." style="width:200px"><button class="hd-btn hd-btn-secondary" type="submit">🔍</button></form></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="hd-table">
        <thead><tr><th>Ticket</th><th>Subject</th><th>Status</th><th>Priority</th><th>Category</th><th>Assignee</th><th>SLA</th><th>Created</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No tickets found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Help Desk', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /helpdesk/new — Create Ticket Form
  // ============================================================
  app.get('/helpdesk/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const categories = (await pool.query(`SELECT * FROM ticket_categories WHERE tenant_id=$1 AND is_active=true ORDER BY name`, [tid])).rows;
    const staff = (await pool.query(`SELECT id, name, email FROM users WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const html = HD_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('')}
      <a href="/helpdesk" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Help Desk</a>
      <div class="card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">➕ New Support Ticket</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Fill in the details to create a new support request</p>
        <form method="POST" action="/helpdesk/create" class="hd-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Subject *</label><input type="text" name="subject" required placeholder="Brief description of the issue"></div>
          <div><label>Description *</label><textarea name="description" rows="5" required placeholder="Provide detailed information about the issue or request..."></textarea></div>
          <div class="hd-grid">
            <div><label>Category</label><select name="category">${categories.map(c=>`<option value="${esc(c.name)}">${categoryDot(c.color)}${esc(c.name)}</option>`).join('')}</select></div>
            <div><label>Priority</label><select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="urgent">Urgent</option><option value="low">Low</option></select></div>
          </div>
          <div class="hd-grid">
            <div><label>Assign To</label><select name="assigned_to"><option value="">— Auto-assign —</option>${staff.map(s=>`<option value="${s.id}">${esc(s.name)} (${esc(s.email)})</option>`).join('')}</select></div>
            <div><label>Due Date</label><input type="date" name="due_date"></div>
          </div>
          <div class="hd-grid">
            <div><label>Contact Name</label><input type="text" name="contact_name" value="${esc(user.name || '')}"></div>
            <div><label>Contact Email</label><input type="email" name="contact_email" value="${esc(user.email || '')}"></div>
          </div>
          <div><label>Contact Phone</label><input type="tel" name="contact_phone" placeholder="Optional phone number"></div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">🎫 Create Ticket</button>
            <a href="/helpdesk" class="btn btn-sm" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Ticket', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /helpdesk/create — Create Ticket
  // ============================================================
  app.post('/helpdesk/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { subject, description, category, priority, assigned_to, due_date, contact_name, contact_email, contact_phone } = req.body;
    if (!subject || !subject.trim()) return res.redirect('/helpdesk/new');
    const ticketNumber = await generateTicketNumber(tid);
    const result = await pool.query(
      `INSERT INTO support_tickets (tenant_id, ticket_number, subject, description, category, priority, status, assigned_to, created_by, contact_name, contact_email, contact_phone, due_date)
       VALUES ($1,$2,$3,$4,$5,$6,'open',$7,$8,$9,$10,$11,$12) RETURNING id`,
      [tid, ticketNumber, subject.trim(), (description || '').trim(), category || 'general', priority || 'normal',
       assigned_to || null, user.id, (contact_name || '').trim() || user.name, (contact_email || '').trim() || user.email, (contact_phone || '').trim() || null, due_date || null]
    );
    console.log(`[Helpdesk] Ticket ${ticketNumber} created by ${user.email}`);
    res.redirect('/helpdesk/' + result.rows[0].id);
  }));

  // ============================================================
  // ROUTE 4: GET /helpdesk/:id — Ticket Detail
  // ============================================================
  app.get('/helpdesk/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, ticketId = req.params.id;
    const ticket = (await pool.query(
      `SELECT st.*, u1.name as assignee_name, u2.name as creator_name, tc.color as cat_color, tc.sla_hours
       FROM support_tickets st
       LEFT JOIN users u1 ON u1.id = st.assigned_to
       LEFT JOIN users u2 ON u2.id = st.created_by
       LEFT JOIN ticket_categories tc ON tc.name = st.category AND tc.tenant_id = st.tenant_id
       WHERE st.id=$1 AND st.tenant_id=$2`, [ticketId, tid]
    )).rows[0];
    if (!ticket) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Ticket not found</h2><a href="/helpdesk" class="btn btn-sm" style="margin-top:12px">← Back</a></div>', user, req));

    const replies = (await pool.query(
      `SELECT tr.*, u.name as author_display FROM ticket_replies tr LEFT JOIN users u ON u.id = tr.author_id WHERE tr.ticket_id=$1 AND tr.tenant_id=$2 ORDER BY tr.created_at ASC`, [ticketId, tid]
    )).rows;
    const staff = (await pool.query(`SELECT id, name, email FROM users WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const timeline = replies.map(r => {
      const cls = r.is_internal ? 'internal' : '';
      const label = r.is_internal ? '<span class="badge badge-warning">Internal Note</span>' : '';
      return `<div class="hd-tl-item ${cls}">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span class="hd-tl-author">${esc(r.author_name || r.author_display || 'Unknown')}</span>
          ${label}
        </div>
        <div class="hd-tl-body">${esc(r.body)}</div>
        <div class="hd-tl-time">${formatDateTime(r.created_at)}</div>
      </div>`;
    }).join('');

    const systemNote = `<div class="hd-tl-item system">
      <div class="hd-tl-author" style="color:#64748b">System</div>
      <div class="hd-tl-body">Ticket created by ${esc(ticket.creator_name || ticket.contact_name || 'Unknown')} on ${formatDateTime(ticket.created_at)}</div>
      <div class="hd-tl-time">${formatDateTime(ticket.created_at)}</div>
    </div>`;

    const html = HD_CSS + `<div style="max-width:960px;margin:0 auto">
      ${nav('')}
      <a href="/helpdesk" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Help Desk</a>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="margin:0 0 8px;color:#1e293b;font-size:20px">${esc(ticket.ticket_number)} — ${esc(ticket.subject)}</h1>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              ${statusBadge(ticket.status)}
              ${priorityBadge(ticket.priority)}
              ${categoryDot(ticket.cat_color)}<span style="font-size:12px;color:#475569">${esc(ticket.category)}</span>
            </div>
          </div>
          <div style="display:flex;gap:6px;flex-wrap:wrap">
            ${ticket.status !== 'closed' ? `<a href="/helpdesk/${ticket.id}/close" class="hd-btn hd-btn-success">✅ Close</a>` : ''}
            <form method="POST" action="/helpdesk/${ticket.id}/status" style="display:inline"><input type="hidden" name="status" value="${ticket.status==='open'?'in_progress':'open'}"><button class="hd-btn hd-btn-secondary">${ticket.status==='open'?'▶ Start Progress':'↩ Reopen'}</button></form>
          </div>
        </div>
        <div class="hd-grid" style="margin-top:16px;padding-top:16px;border-top:1px solid #e2e8f0">
          <div><span class="muted" style="display:block;font-size:11px">Assignee</span><strong>${esc(ticket.assignee_name || 'Unassigned')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Created By</span><strong>${esc(ticket.creator_name || ticket.contact_name || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Contact</span><strong>${esc(ticket.contact_email || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Due Date</span><strong>${formatDate(ticket.due_date)}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">SLA</span>${slaCountdown(ticket.created_at, ticket.sla_hours)}</div>
          <div><span class="muted" style="display:block;font-size:11px">Created</span><strong>${formatDateTime(ticket.created_at)}</strong></div>
        </div>
        ${ticket.description ? `<div style="margin-top:16px;padding:14px;background:#f8fafc;border-radius:10px;font-size:14px;color:#334155;white-space:pre-wrap">${esc(ticket.description)}</div>` : ''}
        ${ticket.resolution ? `<div style="margin-top:12px;padding:14px;background:#f0fdf4;border-radius:10px;border-left:4px solid #22c55e"><strong style="color:#16a34a">Resolution:</strong><p style="margin:6px 0 0;font-size:14px;color:#334155;white-space:pre-wrap">${esc(ticket.resolution)}</p></div>` : ''}
        ${ticket.satisfaction_rating ? `<div style="margin-top:12px;padding:10px 14px;background:#fffbeb;border-radius:10px;font-size:13px"><strong>Customer Rating:</strong> ${starRating(ticket.satisfaction_rating)} (${ticket.satisfaction_rating}/5)</div>` : ''}
      </div>

      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">📝 Quick Actions</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <form method="POST" action="/helpdesk/${ticket.id}/priority" style="display:flex;gap:4px">
            <select name="priority" style="padding:6px 10px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px">${['low','normal','high','urgent'].map(p=>`<option value="${p}" ${ticket.priority===p?'selected':''}>${p}</option>`).join('')}</select>
            <button class="btn btn-sm btn-blue" type="submit">Set Priority</button>
          </form>
          <form method="POST" action="/helpdesk/${ticket.id}/assign" style="display:flex;gap:4px">
            <select name="assigned_to" style="padding:6px 10px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px"><option value="">Unassign</option>${staff.map(s=>`<option value="${s.id}" ${ticket.assigned_to==s.id?'selected':''}>${esc(s.name)}</option>`).join('')}</select>
            <button class="btn btn-sm btn-gold" type="submit">Assign</button>
          </form>
          <form method="POST" action="/helpdesk/${ticket.id}/status" style="display:flex;gap:4px">
            <select name="status" style="padding:6px 10px;border:2px solid #e2e8f0;border-radius:8px;font-size:12px">${['open','in_progress','pending','resolved','closed'].map(s=>`<option value="${s}" ${ticket.status===s?'selected':''}>${s.replace('_',' ')}</option>`).join('')}</select>
            <button class="btn btn-sm" type="submit">Set Status</button>
          </form>
        </div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">💬 Conversation</h3>
        <div class="hd-timeline">${systemNote}${timeline}</div>
        ${ticket.status !== 'closed' ? `
        <form method="POST" action="/helpdesk/${ticket.id}/reply" class="hd-form" style="margin-top:20px;display:flex;flex-direction:column;gap:10px">
          <textarea name="body" rows="3" required placeholder="Type your reply..."></textarea>
          <div style="display:flex;gap:10px;align-items:center">
            <label style="display:flex;align-items:center;gap:4px;font-size:12px;color:#64748b"><input type="checkbox" name="is_internal"> Internal Note</label>
            <button type="submit" class="btn btn-blue" style="margin-left:auto">📤 Send Reply</button>
          </div>
        </form>` : '<p class="muted" style="margin-top:12px;font-size:13px">This ticket is closed. Reopen to add replies.</p>'}
      </div>

      ${ticket.status === 'closed' && !ticket.satisfaction_rating ? `
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">⭐ Rate Your Experience</h3>
        <form method="POST" action="/helpdesk/${ticket.id}/rate" style="display:flex;gap:6px;align-items:center">
          ${[1,2,3,4,5].map(i=>`<label style="font-size:28px;cursor:pointer;color:#d1d5db"><input type="radio" name="rating" value="${i}" required style="display:none" onchange="document.querySelectorAll('label span').forEach(s=>s.style.color='#d1d5db');this.parentElement.querySelectorAll('span').forEach(s=>s.style.color='#f59e0b')"><span>★</span></label>`).join('')}
          <button class="btn btn-green" type="submit" style="margin-left:12px">Submit Rating</button>
        </form>
      </div>` : ''}
    </div>`;
    res.send(renderPage('Ticket ' + ticket.ticket_number, html, user, req));
  }));

  // ============================================================
  // ROUTE 5: POST /helpdesk/:id/reply — Add Reply
  // ============================================================
  app.post('/helpdesk/:id/reply', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, ticketId = req.params.id;
    const { body, is_internal } = req.body;
    if (!body || !body.trim()) return res.redirect('/helpdesk/' + ticketId);
    const ticket = (await pool.query(`SELECT id, status FROM support_tickets WHERE id=$1 AND tenant_id=$2`, [ticketId, tid])).rows[0];
    if (!ticket) return res.redirect('/helpdesk');
    await pool.query(
      `INSERT INTO ticket_replies (tenant_id, ticket_id, author_id, author_name, body, is_internal) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, ticketId, user.id, user.name || user.email, body.trim(), is_internal === 'on']
    );
    if (ticket.status === 'open') await pool.query(`UPDATE support_tickets SET status='in_progress', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [ticketId, tid]);
    await pool.query(`UPDATE support_tickets SET updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [ticketId, tid]);
    console.log(`[Helpdesk] Reply added to ticket #${ticketId} by ${user.email}`);
    res.redirect('/helpdesk/' + ticketId);
  }));

  // ============================================================
  // ROUTE 6: POST /helpdesk/:id/assign — Assign Ticket
  // ============================================================
  app.post('/helpdesk/:id/assign', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, ticketId = req.params.id;
    const { assigned_to } = req.body;
    await pool.query(`UPDATE support_tickets SET assigned_to=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [assigned_to || null, ticketId, tid]);
    console.log(`[Helpdesk] Ticket #${ticketId} assigned to ${assigned_to || 'unassigned'} by ${user.email}`);
    res.redirect('/helpdesk/' + ticketId);
  }));

  // ============================================================
  // ROUTE 7: POST /helpdesk/:id/status — Change Status
  // ============================================================
  app.post('/helpdesk/:id/status', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, ticketId = req.params.id;
    const { status } = req.body;
    const allowed = ['open', 'in_progress', 'pending', 'resolved', 'closed'];
    if (!allowed.includes(status)) return res.redirect('/helpdesk/' + ticketId);
    const old = (await pool.query(`SELECT status FROM support_tickets WHERE id=$1 AND tenant_id=$2`, [ticketId, tid])).rows[0];
    await pool.query(`UPDATE support_tickets SET status=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [status, ticketId, tid]);
    if (status === 'closed' && old) {
      await pool.query(`UPDATE support_tickets SET resolution_time=EXTRACT(EPOCH FROM (NOW() - created_at))/3600 WHERE id=$1 AND tenant_id=$2`, [ticketId, tid]);
    }
    console.log(`[Helpdesk] Ticket #${ticketId} status changed to "${status}" by ${user.email}`);
    res.redirect('/helpdesk/' + ticketId);
  }));

  // ============================================================
  // ROUTE 8: POST /helpdesk/:id/priority — Change Priority
  // ============================================================
  app.post('/helpdesk/:id/priority', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, ticketId = req.params.id;
    const { priority } = req.body;
    const allowed = ['low', 'normal', 'high', 'urgent'];
    if (!allowed.includes(priority)) return res.redirect('/helpdesk/' + ticketId);
    await pool.query(`UPDATE support_tickets SET priority=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [priority, ticketId, tid]);
    console.log(`[Helpdesk] Ticket #${ticketId} priority set to "${priority}" by ${user.email}`);
    res.redirect('/helpdesk/' + ticketId);
  }));

  // ============================================================
  // ROUTE 9: GET /helpdesk/:id/close — Close Ticket Form
  // ============================================================
  app.get('/helpdesk/:id/close', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, ticketId = req.params.id;
    const ticket = (await pool.query(`SELECT * FROM support_tickets WHERE id=$1 AND tenant_id=$2`, [ticketId, tid])).rows[0];
    if (!ticket) return res.redirect('/helpdesk');
    const html = HD_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('')}
      <div class="card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">✅ Close Ticket ${esc(ticket.ticket_number)}</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">${esc(ticket.subject)}</p>
        <form method="POST" action="/helpdesk/${ticket.id}/status" class="hd-form" style="display:flex;flex-direction:column;gap:16px">
          <input type="hidden" name="status" value="closed">
          <div><label>Resolution *</label><textarea name="resolution" rows="4" required placeholder="Describe how this issue was resolved...">${esc(ticket.resolution || '')}</textarea></div>
          <div style="display:flex;gap:10px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">✅ Close Ticket</button>
            <a href="/helpdesk/${ticket.id}" class="btn btn-sm" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Close Ticket', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /helpdesk/:id/rate — Satisfaction Rating
  // ============================================================
  app.post('/helpdesk/:id/rate', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, ticketId = req.params.id;
    const { rating } = req.body;
    const r = parseInt(rating);
    if (isNaN(r) || r < 1 || r > 5) return res.redirect('/helpdesk/' + ticketId);
    await pool.query(`UPDATE support_tickets SET satisfaction_rating=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [r, ticketId, tid]);
    console.log(`[Helpdesk] Ticket #${ticketId} rated ${r}/5 by ${user.email}`);
    res.redirect('/helpdesk/' + ticketId);
  }));

  // ============================================================
  // ROUTE 11: GET /helpdesk/categories — Category Management
  // ============================================================
  app.get('/helpdesk/categories', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const categories = (await pool.query(
      `SELECT tc.*, COUNT(st.id)::int as ticket_count
       FROM ticket_categories tc
       LEFT JOIN support_tickets st ON st.category = tc.name AND st.tenant_id = tc.tenant_id
       WHERE tc.tenant_id=$1 GROUP BY tc.id ORDER BY tc.name`, [tid]
    )).rows;

    const rows = categories.map(c => `<tr>
      <td>${categoryDot(c.color)}<strong>${esc(c.name)}</strong></td>
      <td style="font-size:12px;color:#64748b">${esc(c.description || '—')}</td>
      <td><span style="font-weight:600">${c.sla_hours}h</span></td>
      <td><span class="badge ${c.is_active ? 'badge-success' : 'badge-warning'}">${c.is_active ? 'Active' : 'Inactive'}</span></td>
      <td style="font-weight:600">${c.ticket_count}</td>
      <td>
        <form method="POST" action="/helpdesk/categories/${c.id}/delete" style="display:inline" onsubmit="return confirm('Delete category &quot;${esc(c.name)}&quot;?')">
          <button class="btn btn-sm btn-red" type="submit">🗑</button>
        </form>
      </td>
    </tr>`).join('');

    const html = HD_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('cats')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📂 Ticket Categories</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage support categories and SLA targets</p></div>
        <button class="hd-btn hd-btn-primary" onclick="document.getElementById('add-cat-form').style.display='block'">➕ Add Category</button>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="hd-table">
        <thead><tr><th>Name</th><th>Description</th><th>SLA</th><th>Status</th><th>Tickets</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No categories configured</td></tr>'}</tbody>
      </table></div></div>
      <div id="add-cat-form" class="card" style="padding:24px;margin-top:20px;display:none">
        <h3 style="margin:0 0 16px;color:#1e293b">➕ Add Category</h3>
        <form method="POST" action="/helpdesk/categories/add" class="hd-form" style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
          <div><label>Name *</label><input type="text" name="name" required placeholder="Category name"></div>
          <div><label>Color</label><input type="color" name="color" value="#3b82f6" style="height:42px;padding:4px"></div>
          <div><label>SLA (hours)</label><input type="number" name="sla_hours" value="48" min="1" max="720"></div>
          <div><label>Description</label><input type="text" name="description" placeholder="Brief description"></div>
          <div style="display:flex;gap:10px;align-items:end;grid-column:1/-1">
            <button type="submit" class="btn btn-green">💾 Save Category</button>
            <button type="button" class="btn btn-sm" onclick="document.getElementById('add-cat-form').style.display='none'">Cancel</button>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Ticket Categories', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: POST /helpdesk/categories/add — Add Category
  // ============================================================
  app.post('/helpdesk/categories/add', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, description, color, sla_hours } = req.body;
    if (!name || !name.trim()) return res.redirect('/helpdesk/categories');
    await pool.query(
      `INSERT INTO ticket_categories (tenant_id, name, description, color, sla_hours) VALUES ($1,$2,$3,$4,$5)`,
      [tid, name.trim(), (description || '').trim(), color || '#3b82f6', parseInt(sla_hours) || 48]
    );
    console.log(`[Helpdesk] Category "${name.trim()}" added by ${user.email}`);
    res.redirect('/helpdesk/categories');
  }));

  // ============================================================
  // ROUTE 13: DELETE /helpdesk/categories/:id — Delete Category
  // ============================================================
  app.delete('/helpdesk/categories/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, catId = req.params.id;
    const cat = (await pool.query(`SELECT name FROM ticket_categories WHERE id=$1 AND tenant_id=$2`, [catId, tid])).rows[0];
    if (!cat) return res.status(404).json({ error: 'Category not found' });
    await pool.query(`DELETE FROM ticket_categories WHERE id=$1 AND tenant_id=$2`, [catId, tid]);
    console.log(`[Helpdesk] Category "${cat.name}" deleted by ${user.email}`);
    res.json({ success: true });
  }));

  // ============================================================
  // ROUTE 14: GET /helpdesk/my-tickets — Current User's Tickets
  // ============================================================
  app.get('/helpdesk/my-tickets', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const tickets = (await pool.query(
      `SELECT st.*, u.name as assignee_name, tc.color as cat_color, tc.sla_hours
       FROM support_tickets st
       LEFT JOIN users u ON u.id = st.assigned_to
       LEFT JOIN ticket_categories tc ON tc.name = st.category AND tc.tenant_id = st.tenant_id
       WHERE st.tenant_id=$1 AND (st.created_by=$2 OR st.contact_email=$3)
       ORDER BY st.updated_at DESC`, [tid, user.id, user.email]
    )).rows;

    const rows = tickets.map(t => `<tr>
      <td><a href="/helpdesk/${t.id}" style="color:#4f46e5;text-decoration:none;font-weight:600;font-family:monospace">${esc(t.ticket_number)}</a></td>
      <td><a href="/helpdesk/${t.id}" style="color:#1e293b;text-decoration:none">${esc(t.subject)}</a></td>
      <td>${statusBadge(t.status)}</td>
      <td>${priorityBadge(t.priority)}</td>
      <td>${esc(t.assignee_name || 'Unassigned')}</td>
      <td>${slaCountdown(t.created_at, t.sla_hours)}</td>
      <td style="font-size:12px;color:#94a3b8">${formatDateTime(t.updated_at)}</td>
    </tr>`).join('');

    const html = HD_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('mine')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">👤 My Tickets</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Tickets you submitted or are associated with</p></div>
        <a href="/helpdesk/new" class="hd-btn hd-btn-primary">➕ New Ticket</a>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="hd-table">
        <thead><tr><th>Ticket</th><th>Subject</th><th>Status</th><th>Priority</th><th>Assignee</th><th>SLA</th><th>Updated</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">You have no tickets yet</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('My Tickets', html, user, req));
  }));

  // ============================================================
  // ROUTE 15: GET /helpdesk/report — Ticket Analytics
  // ============================================================
  app.get('/helpdesk/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const statusBreakdown = (await pool.query(`SELECT status, COUNT(*)::int as cnt FROM support_tickets WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC`, [tid])).rows;
    const priorityBreakdown = (await pool.query(`SELECT priority, COUNT(*)::int as cnt FROM support_tickets WHERE tenant_id=$1 GROUP BY priority ORDER BY cnt DESC`, [tid])).rows;
    const categoryBreakdown = (await pool.query(
      `SELECT st.category, COUNT(*)::int as cnt, tc.color FROM support_tickets st LEFT JOIN ticket_categories tc ON tc.name=st.category AND tc.tenant_id=st.tenant_id WHERE st.tenant_id=$1 GROUP BY st.category, tc.color ORDER BY cnt DESC`, [tid]
    )).rows;
    const monthlyTrend = (await pool.query(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COUNT(*)::int as total, COUNT(*) FILTER (WHERE status='closed' OR status='resolved')::int as resolved_cnt FROM support_tickets WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '6 months' GROUP BY month ORDER BY month`, [tid]
    )).rows;
    const avgResolution = (await pool.query(
      `SELECT ROUND(AVG(resolution_time), 1) as avg_hours FROM support_tickets WHERE tenant_id=$1 AND resolution_time IS NOT NULL`, [tid]
    )).rows[0].avg_hours;
    const avgRating = (await pool.query(
      `SELECT ROUND(AVG(satisfaction_rating), 1) as avg_rating FROM support_tickets WHERE tenant_id=$1 AND satisfaction_rating IS NOT NULL`, [tid]
    )).rows[0].avg_rating;
    const topAssignees = (await pool.query(
      `SELECT u.name, COUNT(st.id)::int as ticket_count, ROUND(AVG(st.resolution_time),1) as avg_res FROM support_tickets st JOIN users u ON u.id=st.assigned_to WHERE st.tenant_id=$1 AND st.assigned_to IS NOT NULL GROUP BY u.name ORDER BY ticket_count DESC LIMIT 10`, [tid]
    )).rows;

    const maxCount = Math.max(...statusBreakdown.map(r => r.cnt), 1);
    const maxPriCount = Math.max(...priorityBreakdown.map(r => r.cnt), 1);

    const html = HD_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('report')}
      <h1 style="font-size:24px;color:#1e293b;margin-bottom:20px">📊 Ticket Analytics</h1>
      <div class="hd-stats">
        <div class="stat-card"><div class="stat-num">${statusBreakdown.reduce((s,r)=>s+r.cnt,0)}</div><div class="muted">Total Tickets</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${avgResolution || '—'}</div><div class="muted">Avg Resolution (hrs)</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${avgRating ? starRating(Math.round(avgRating)) : '—'}</div><div class="muted">Avg Rating (${avgRating || 0}/5)</div></div>
      </div>
      <div class="hd-grid" style="margin-bottom:20px">
        <div class="card" style="padding:16px">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">Status Distribution</h3>
          ${statusBreakdown.map(r => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            ${statusBadge(r.status).replace('badge', 'badge').replace(/style="[^"]*"/, 'style="font-size:10px;padding:2px 8px"')}
            <div style="flex:1;background:#f1f5f9;border-radius:6px;height:20px;overflow:hidden"><div style="height:100%;border-radius:6px;background:${{open:'#3b82f6',in_progress:'#f59e0b',pending:'#a16207',resolved:'#22c55e',closed:'#64748b'}[r.status]||'#94a3b8'};width:${Math.round(r.cnt/maxCount*100)}%;transition:.3s"></div></div>
            <span style="font-size:13px;font-weight:700;min-width:30px;text-align:right">${r.cnt}</span>
          </div>`).join('')}
        </div>
        <div class="card" style="padding:16px">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">Priority Distribution</h3>
          ${priorityBreakdown.map(r => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            ${priorityBadge(r.priority).replace(/style="[^"]*"/, 'style="font-size:10px;padding:2px 8px"')}
            <div style="flex:1;background:#f1f5f9;border-radius:6px;height:20px;overflow:hidden"><div style="height:100%;border-radius:6px;background:${{urgent:'#dc2626',high:'#ea580c',normal:'#3b82f6',low:'#22c55e'}[r.priority]||'#94a3b8'};width:${Math.round(r.cnt/maxPriCount*100)}%;transition:.3s"></div></div>
            <span style="font-size:13px;font-weight:700;min-width:30px;text-align:right">${r.cnt}</span>
          </div>`).join('')}
        </div>
      </div>
      <div class="hd-grid" style="margin-bottom:20px">
        <div class="card" style="padding:16px">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">Categories</h3>
          ${categoryBreakdown.map(c => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            ${categoryDot(c.color)}<span style="font-size:13px;flex:1">${esc(c.category || 'Uncategorized')}</span>
            <span style="font-size:13px;font-weight:700">${c.cnt}</span>
          </div>`).join('')}
        </div>
        <div class="card" style="padding:16px">
          <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">Monthly Trend (6 months)</h3>
          ${monthlyTrend.length ? monthlyTrend.map(m => `<div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
            <span style="font-size:12px;color:#64748b;min-width:70px">${esc(m.month)}</span>
            <div style="flex:1;display:flex;gap:2px;align-items:end;height:24px">
              <div style="background:#3b82f6;border-radius:3px 3px 0 0;height:${Math.max(4, m.total/5)}px;flex:${m.total};max-width:100%" title="Opened: ${m.total}"></div>
              <div style="background:#22c55e;border-radius:3px 3px 0 0;height:${Math.max(4, m.resolved_cnt/5)}px;flex:${m.resolved_cnt};max-width:100%" title="Resolved: ${m.resolved_cnt}"></div>
            </div>
            <span style="font-size:11px;color:#94a3b8;min-width:60px;text-align:right">${m.total} / ${m.resolved_cnt} ✓</span>
          </div>`).join('') : '<p class="muted" style="font-size:13px">No data in the last 6 months</p>'}
          <div style="display:flex;gap:12px;margin-top:8px;font-size:11px;color:#64748b">
            <span><span style="display:inline-block;width:10px;height:10px;background:#3b82f6;border-radius:2px;margin-right:4px"></span>Opened</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:#22c55e;border-radius:2px;margin-right:4px"></span>Resolved</span>
          </div>
        </div>
      </div>
      <div class="card" style="padding:16px">
        <h3 style="font-size:14px;color:#1e293b;margin:0 0 12px">🏆 Top Assignees</h3>
        <table class="hd-table"><thead><tr><th>Agent</th><th>Tickets Handled</th><th>Avg Resolution (hrs)</th></tr></thead>
        <tbody>${topAssignees.map(a => `<tr><td style="font-weight:600">${esc(a.name)}</td><td>${a.ticket_count}</td><td>${a.avg_res || '—'}</td></tr>`).join('') || '<tr><td colspan="3" style="text-align:center;color:#94a3b8;padding:20px">No assignment data yet</td></tr>'}</tbody></table>
      </div>
    </div>`;
    res.send(renderPage('Ticket Reports', html, user, req));
  }));

  // ============================================================
  // ROUTE 16: GET /api/helpdesk/stats — JSON API
  // ============================================================
  app.get('/api/helpdesk/stats', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const statusCounts = (await pool.query(`SELECT status, COUNT(*)::int as count FROM support_tickets WHERE tenant_id=$1 GROUP BY status`, [tid])).rows;
    const total = statusCounts.reduce((s, r) => s + r.count, 0);
    const overdue = (await pool.query(`SELECT COUNT(*)::int as count FROM support_tickets WHERE tenant_id=$1 AND status NOT IN ('closed','resolved') AND created_at < NOW() - INTERVAL '72 hours'`, [tid])).rows[0].count;
    const avgResolution = (await pool.query(`SELECT ROUND(AVG(resolution_time),1) as val FROM support_tickets WHERE tenant_id=$1 AND resolution_time IS NOT NULL`, [tid])).rows[0].val;
    const avgRating = (await pool.query(`SELECT ROUND(AVG(satisfaction_rating),1) as val FROM support_tickets WHERE tenant_id=$1 AND satisfaction_rating IS NOT NULL`, [tid])).rows[0].val;
    const recent = (await pool.query(
      `SELECT st.ticket_number, st.subject, st.status, st.priority, st.created_at, u.name as assignee_name
       FROM support_tickets st LEFT JOIN users u ON u.id=st.assigned_to
       WHERE st.tenant_id=$1 ORDER BY st.created_at DESC LIMIT 10`, [tid]
    )).rows;

    const byStatus = {};
    statusCounts.forEach(r => { byStatus[r.status] = r.count; });

    res.json({
      total,
      open: byStatus.open || 0,
      in_progress: byStatus.in_progress || 0,
      pending: byStatus.pending || 0,
      resolved: byStatus.resolved || 0,
      closed: byStatus.closed || 0,
      overdue,
      avg_resolution_hours: parseFloat(avgResolution) || null,
      avg_satisfaction_rating: parseFloat(avgRating) || null,
      recent_tickets: recent.map(r => ({
        ticket_number: r.ticket_number,
        subject: r.subject,
        status: r.status,
        priority: r.priority,
        assignee: r.assignee_name,
        created_at: r.created_at
      }))
    });
  }));

  console.log('[Helpdesk] Ticket system loaded');
};
