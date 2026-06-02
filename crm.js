// ============================================================
// CRM & CONTACT MANAGEMENT MODULE — Multi-Tenant SaaS Platform
// Contacts, deals pipeline, activities, analytics, CSV export.
// ============================================================
// Usage in server.js:
//   const crm = require('./crm');
//   crm(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ── Internal helpers ─────────────────────────────────────────
const { migrateQuery } = require('./db');
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const formatDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const fmtMoney = (n) => 'UGX ' + Number(n || 0).toLocaleString();

const STAGES = ['lead', 'qualified', 'proposal', 'negotiation', 'won', 'lost'];
const STAGE_LABELS = { lead: 'Lead', qualified: 'Qualified', proposal: 'Proposal', negotiation: 'Negotiation', won: 'Won', lost: 'Lost' };
const STAGE_COLORS = { lead: '#3b82f6', qualified: '#8b5cf6', proposal: '#f59e0b', negotiation: '#f97316', won: '#22c55e', lost: '#ef4444' };
const CONTACT_STATUSES = ['lead', 'prospect', 'customer', 'inactive'];
const STATUS_LABELS = { lead: 'Lead', prospect: 'Prospect', customer: 'Customer', inactive: 'Inactive' };
const ACTIVITY_TYPES = ['call', 'email', 'meeting', 'note', 'task'];
const ACTIVITY_ICONS = { call: '📞', email: '📧', meeting: '🤝', note: '📝', task: '✅' };

function statusBadge(status) {
  const map = { lead: { bg: '#dbeafe', c: '#1d4ed8' }, prospect: { bg: '#fef3c7', c: '#b45309' }, customer: { bg: '#dcfce7', c: '#16a34a' }, inactive: { bg: '#f1f5f9', c: '#64748b' } };
  const s = map[status] || map.lead;
  return `<span class="badge" style="background:${s.bg};color:${s.c}">${STATUS_LABELS[status] || status}</span>`;
}

function stageBadge(stage) {
  return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${STAGE_COLORS[stage] || '#94a3b8'}22;color:${STAGE_COLORS[stage] || '#94a3b8'}">${STAGE_LABELS[stage] || stage}</span>`;
}

// ── CSS ───────────────────────────────────────────────────────
const CRM_CSS = `<style>
.crm-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.crm-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.crm-nav a:hover{background:#e2e8f0}.crm-nav a.active{background:#4f46e5;color:#fff}
.crm-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.crm-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.crm-filter input,.crm-filter select{padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.crm-filter input:focus,.crm-filter select:focus{outline:none;border-color:#6366f1}
.crm-tbl{width:100%;border-collapse:collapse;font-size:13px}
.crm-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.crm-tbl td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.crm-tbl tr:hover{background:#f8fafc}
.form-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.form-grid .full{grid-column:1/-1}
.crm-timeline{position:relative;padding-left:28px;margin:16px 0}
.crm-timeline::before{content:'';position:absolute;left:10px;top:0;bottom:0;width:2px;background:#e2e8f0}
.crm-tl-item{position:relative;margin-bottom:14px;padding:12px 16px;background:#f8fafc;border-radius:10px;border-left:3px solid #cbd5e1}
.crm-tl-item::before{content:'';position:absolute;left:-25px;top:16px;width:10px;height:10px;border-radius:50%;background:#64748b;border:2px solid #fff}
.crm-tl-item.call{border-left-color:#3b82f6}.crm-tl-item.call::before{background:#3b82f6}
.crm-tl-item.email{border-left-color:#8b5cf6}.crm-tl-item.email::before{background:#8b5cf6}
.crm-tl-item.meeting{border-left-color:#22c55e}.crm-tl-item.meeting::before{background:#22c55e}
.crm-tl-item.task{border-left-color:#f59e0b}.crm-tl-item.task::before{background:#f59e0b}
.kanban{display:flex;gap:14px;overflow-x:auto;padding-bottom:16px}
.kanban-col{min-width:220px;max-width:260px;flex-shrink:0;background:#f8fafc;border-radius:14px;padding:12px}
.kanban-col h4{font-size:13px;font-weight:700;margin:0 0 10px;padding:8px 12px;border-radius:8px;color:#fff}
.kanban-card{background:#fff;border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:8px;cursor:grab;transition:.15s}
.kanban-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.06)}
.kanban-val{font-size:18px;font-weight:800;color:#1e293b}
.kanban-cnt{font-size:11px;color:#94a3b8;margin-top:2px}
.crm-bar{display:flex;height:28px;border-radius:8px;overflow:hidden;margin-top:8px}
.crm-bar div{display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;color:#fff;transition:.2s}
@media(max-width:768px){.form-grid{grid-template-columns:1fr}.crm-filter{flex-direction:column}.kanban{flex-direction:column}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function crm(app, db, pool, renderPage, esc) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ── Navigation helper ──────────────────────────────────────
  function nav(active) {
    const links = [
      ['/crm', 'Dashboard'], ['/crm/contacts', 'Contacts'], ['/crm/pipeline', 'Pipeline'],
      ['/crm/deals/new', 'New Deal'], ['/crm/report', 'Reports']
    ];
    return '<div class="crm-nav">' + links.map(([href, label]) =>
      `<a href="${href}" class="${active === href ? 'active' : ''}">${label}</a>`).join('') + '</div>';
  }

  // ============================================================
  // MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS crm_contacts (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      first_name VARCHAR(100), last_name VARCHAR(100), email VARCHAR(255),
      phone VARCHAR(20), company VARCHAR(255), job_title VARCHAR(100),
      address TEXT, city VARCHAR(100), country VARCHAR(100) DEFAULT 'Uganda',
      source VARCHAR(50), tags TEXT[], notes TEXT,
      lead_score INTEGER DEFAULT 0, status VARCHAR(20) DEFAULT 'lead',
      assigned_to INTEGER REFERENCES users(id),
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS crm_deals (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      contact_id INTEGER REFERENCES crm_contacts(id),
      title VARCHAR(255) NOT NULL, value NUMERIC(14,2) DEFAULT 0,
      stage VARCHAR(50) DEFAULT 'lead', probability INTEGER DEFAULT 10,
      expected_close DATE, contact_name VARCHAR(255),
      notes TEXT, assigned_to INTEGER,
      created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS crm_activities (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      contact_id INTEGER REFERENCES crm_contacts(id),
      deal_id INTEGER REFERENCES crm_deals(id),
      activity_type VARCHAR(50) DEFAULT 'note',
      subject VARCHAR(255), description TEXT,
      due_date DATE, completed BOOLEAN DEFAULT false,
      created_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE — crm_contacts columns)
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS first_name VARCHAR(100)`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS last_name VARCHAR(100)`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS email VARCHAR(255)`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS phone VARCHAR(20)`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS company VARCHAR(255)`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS job_title VARCHAR(100)`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS address TEXT`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS city VARCHAR(100)`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS country VARCHAR(100) DEFAULT 'Uganda'`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS source VARCHAR(50)`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS tags TEXT[]`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS notes TEXT`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS lead_score INTEGER DEFAULT 0`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'lead'`,
    `ALTER TABLE IF EXISTS crm_contacts ADD COLUMN IF NOT EXISTS assigned_to INTEGER REFERENCES users(id)`,
    // ALTER TABLE — crm_deals columns
    `ALTER TABLE IF EXISTS crm_deals ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES crm_contacts(id)`,
    `ALTER TABLE IF EXISTS crm_deals ADD COLUMN IF NOT EXISTS title VARCHAR(255) NOT NULL DEFAULT ''`,
    `ALTER TABLE IF EXISTS crm_deals ADD COLUMN IF NOT EXISTS value NUMERIC(14,2) DEFAULT 0`,
    `ALTER TABLE IF EXISTS crm_deals ADD COLUMN IF NOT EXISTS stage VARCHAR(50) DEFAULT 'lead'`,
    `ALTER TABLE IF EXISTS crm_deals ADD COLUMN IF NOT EXISTS probability INTEGER DEFAULT 10`,
    `ALTER TABLE IF EXISTS crm_deals ADD COLUMN IF NOT EXISTS expected_close DATE`,
    `ALTER TABLE IF EXISTS crm_deals ADD COLUMN IF NOT EXISTS contact_name VARCHAR(255)`,
    `ALTER TABLE IF EXISTS crm_deals ADD COLUMN IF NOT EXISTS notes TEXT`,
    `ALTER TABLE IF EXISTS crm_deals ADD COLUMN IF NOT EXISTS assigned_to INTEGER`,
    // ALTER TABLE — crm_activities columns
    `ALTER TABLE IF EXISTS crm_activities ADD COLUMN IF NOT EXISTS contact_id INTEGER REFERENCES crm_contacts(id)`,
    `ALTER TABLE IF EXISTS crm_activities ADD COLUMN IF NOT EXISTS deal_id INTEGER REFERENCES crm_deals(id)`,
    `ALTER TABLE IF EXISTS crm_activities ADD COLUMN IF NOT EXISTS activity_type VARCHAR(50) DEFAULT 'note'`,
    `ALTER TABLE IF EXISTS crm_activities ADD COLUMN IF NOT EXISTS subject VARCHAR(255)`,
    `ALTER TABLE IF EXISTS crm_activities ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS crm_activities ADD COLUMN IF NOT EXISTS due_date DATE`,
    `ALTER TABLE IF EXISTS crm_activities ADD COLUMN IF NOT EXISTS completed BOOLEAN DEFAULT false`,
    `ALTER TABLE IF EXISTS crm_activities ADD COLUMN IF NOT EXISTS created_by INTEGER`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_crm_contacts_tenant ON crm_contacts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_contacts_status ON crm_contacts(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_contacts_email ON crm_contacts(email)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_deals_tenant ON crm_deals(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_deals_stage ON crm_deals(tenant_id, stage)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_deals_contact ON crm_deals(contact_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_activities_tenant ON crm_activities(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_activities_contact ON crm_activities(contact_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_activities_deal ON crm_activities(deal_id)`
  ];

  (async () => {
    try { for (const sql of migrations) await migrateQuery(pool, 'Crm', sql); console.log('[CRM] Migrations applied: ' + migrations.length + ' statements'); }
    catch (e) { /* migration OK */ }
  })();

  // ════════════════════════════════════════════════════════════
  // ROUTE 1: GET /crm — Dashboard
  // ════════════════════════════════════════════════════════════
  app.get('/crm', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const stats = (await pool.query(`
      SELECT
        (SELECT COUNT(*)::int FROM crm_contacts WHERE tenant_id=$1) as contacts,
        (SELECT COUNT(*)::int FROM crm_deals WHERE tenant_id=$1 AND stage NOT IN ('won','lost')) as open_deals,
        (SELECT COALESCE(SUM(d.value), 0) FROM crm_deals d WHERE d.tenant_id=$1 AND d.stage NOT IN ('won','lost')) as pipeline_value,
        (SELECT COUNT(*)::int FROM crm_deals WHERE tenant_id=$1 AND date_trunc('month', created_at) = date_trunc('month', NOW())) as deals_this_month,
        (SELECT COUNT(*)::int FROM crm_activities WHERE tenant_id=$1 AND date_trunc('day', created_at) = date_trunc('day', NOW())) as activities_today,
        (SELECT COALESCE(SUM(d.value), 0) FROM crm_deals d WHERE d.tenant_id=$1 AND d.stage = 'won' AND date_trunc('month', d.updated_at) = date_trunc('month', NOW())) as revenue_this_month
    `, [tid])).rows[0];

    const recentContacts = (await pool.query(
      `SELECT * FROM crm_contacts WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5`, [tid]
    )).rows;

    const upcomingActivities = (await pool.query(
      `SELECT a.*, c.first_name, c.last_name FROM crm_activities a
       LEFT JOIN crm_contacts c ON c.id = a.contact_id
       WHERE a.tenant_id=$1 AND a.completed = false AND a.due_date >= CURRENT_DATE
       ORDER BY a.due_date ASC LIMIT 8`, [tid]
    )).rows;

    const contactRows = recentContacts.map(c => `<tr>
      <td><a href="/crm/contacts/${c.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(c.first_name || '')} ${esc(c.last_name || '')}</a></td>
      <td style="font-size:12px">${esc(c.company || '—')}</td>
      <td style="font-size:12px">${esc(c.email || '—')}</td>
      <td>${statusBadge(c.status)}</td>
      <td class="muted" style="font-size:12px">${formatDate(c.created_at)}</td>
    </tr>`).join('');

    const activityRows = upcomingActivities.map(a => `<tr>
      <td>${ACTIVITY_ICONS[a.activity_type] || '📝'} ${esc(a.subject || a.activity_type)}</td>
      <td>${esc(a.first_name || '')} ${esc(a.last_name || '')}</td>
      <td style="font-size:12px">${formatDate(a.due_date)}</td>
      <td>${stageBadge(a.activity_type)}</td>
    </tr>`).join('');

    const html = CRM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('/crm')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🤝 CRM Dashboard</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Contacts, deals, and pipeline management</p></div>
        <div style="display:flex;gap:8px">
          <a href="/crm/contacts/new" class="btn btn-green">+ Add Contact</a>
          <a href="/crm/deals/new" class="btn btn-blue">+ New Deal</a>
          <a href="/crm/contacts/export" class="btn btn-gold">📥 Export CSV</a>
        </div>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${stats.contacts}</div><div class="muted">Total Contacts</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${fmtMoney(stats.pipeline_value)}</div><div class="muted">Pipeline Value</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${stats.open_deals}</div><div class="muted">Open Deals</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#0891b2">${stats.deals_this_month}</div><div class="muted">Deals This Month</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#22c55e">${fmtMoney(stats.revenue_this_month)}</div><div class="muted">Revenue This Month</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">${stats.activities_today}</div><div class="muted">Activities Today</div></div>
      </div>
      <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:20px">
        <div class="card"><h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">👥 Recent Contacts</h3>
          <table class="crm-tbl"><thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>${contactRows || '<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No contacts yet</td></tr>'}</tbody></table>
        </div>
        <div class="card"><h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">📅 Upcoming Activities</h3>
          <table class="crm-tbl"><thead><tr><th>Activity</th><th>Contact</th><th>Due Date</th><th>Type</th></tr></thead>
          <tbody>${activityRows || '<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No upcoming activities</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('CRM Dashboard', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 2: GET /crm/contacts — Contact List
  // ════════════════════════════════════════════════════════════
  app.get('/crm/contacts', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { q, status, source, tag, sort } = req.query;

    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (q) { where.push(`(first_name ILIKE $${pi} OR last_name ILIKE $${pi} OR email ILIKE $${pi} OR company ILIKE $${pi})`); params.push('%' + q + '%'); pi++; }
    if (status) { where.push(`status=$${pi}`); params.push(status); pi++; }
    if (source) { where.push(`source=$${pi}`); params.push(source); pi++; }
    if (tag) { where.push(`tags @> $${pi}`); params.push([tag]); pi++; }

    const orderMap = { name: 'first_name ASC, last_name ASC', created: 'created_at DESC', score: 'lead_score DESC', company: 'company ASC' };
    const orderSql = orderMap[sort] || orderMap.created;
    const contacts = (await pool.query(`SELECT * FROM crm_contacts WHERE ${where.join(' AND ')} ORDER BY ${orderSql} LIMIT 100`, params)).rows;
    const sources = (await pool.query(`SELECT DISTINCT source FROM crm_contacts WHERE tenant_id=$1 AND source IS NOT NULL ORDER BY source`, [tid])).rows;
    const allTags = (await pool.query(`SELECT DISTINCT unnest(tags) as tag FROM crm_contacts WHERE tenant_id=$1 AND tags IS NOT NULL ORDER BY tag`, [tid])).rows;

    const rows = contacts.map(c => `<tr>
      <td><a href="/crm/contacts/${c.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(c.first_name || '')} ${esc(c.last_name || '')}</a></td>
      <td>${esc(c.company || '—')}</td>
      <td style="font-size:12px">${esc(c.email || '—')}</td>
      <td style="font-size:12px">${esc(c.phone || '—')}</td>
      <td>${statusBadge(c.status)}</td>
      <td style="font-size:12px">${esc(c.source || '—')}</td>
      <td style="font-size:12px;font-weight:600">${c.lead_score || 0}</td>
      <td>
        <a href="/crm/contacts/${c.id}" class="btn btn-sm btn-blue">View</a>
        <a href="/crm/contacts/${c.id}/edit" class="btn btn-sm btn-gold">Edit</a>
      </td>
    </tr>`).join('');

    const html = CRM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('/crm/contacts')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">👥 Contacts</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">${contacts.length} contacts found</p></div>
        <a href="/crm/contacts/new" class="btn btn-green">+ Add Contact</a>
      </div>
      <div class="card">
        <form method="GET" action="/crm/contacts" class="crm-filter">
          <div><label>Search</label><input type="text" name="q" value="${esc(q || '')}" placeholder="Name, email, company..."></div>
          <div><label>Status</label><select name="status"><option value="">All</option>${CONTACT_STATUSES.map(s => `<option value="${s}" ${status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}</select></div>
          <div><label>Source</label><select name="source"><option value="">All</option>${sources.map(s => `<option value="${esc(s.source)}" ${source === s.source ? 'selected' : ''}>${esc(s.source)}</option>`).join('')}</select></div>
          <div><label>Tags</label><select name="tag"><option value="">All</option>${allTags.map(t => `<option value="${esc(t.tag)}" ${tag === t.tag ? 'selected' : ''}>${esc(t.tag)}</option>`).join('')}</select></div>
          <div><label>Sort</label><select name="sort"><option value="created" ${sort === 'created' ? 'selected' : ''}>Newest</option><option value="name" ${sort === 'name' ? 'selected' : ''}>Name</option><option value="score" ${sort === 'score' ? 'selected' : ''}>Lead Score</option><option value="company" ${sort === 'company' ? 'selected' : ''}>Company</option></select></div>
          <button type="submit" class="btn btn-sm btn-blue">Search</button>
        </form>
        <div style="overflow-x:auto"><table class="crm-tbl">
          <thead><tr><th>Name</th><th>Company</th><th>Email</th><th>Phone</th><th>Status</th><th>Source</th><th>Score</th><th>Actions</th></tr></thead>
          <tbody>${rows || '<tr><td colspan="8" class="muted" style="text-align:center;padding:30px">No contacts found</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Contacts', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 3: GET /crm/contacts/new — Add Contact Form
  // ════════════════════════════════════════════════════════════
  app.get('/crm/contacts/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const staff = (await pool.query(`SELECT id, name FROM users WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const html = CRM_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('/crm/contacts')}
      <a href="/crm/contacts" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Contacts</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">👤 New Contact</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Add a new contact to your CRM</p>
        <form method="POST" action="/crm/contacts/create" class="form-grid">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">First Name *</label>
            <input type="text" name="first_name" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="John"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Last Name</label>
            <input type="text" name="last_name" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="Doe"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Email *</label>
            <input type="email" name="email" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="john@example.com"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Phone</label>
            <input type="text" name="phone" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="+256 700 000 000"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Company</label>
            <input type="text" name="company" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="Acme Ltd"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Job Title</label>
            <input type="text" name="job_title" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="CEO"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Source</label>
            <select name="source" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="">Select source...</option>
              ${['Website', 'Referral', 'LinkedIn', 'Twitter', 'Cold Call', 'Event', 'Advertisement', 'Other'].map(s => `<option value="${s}">${s}</option>`).join('')}
            </select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Status</label>
            <select name="status" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              ${CONTACT_STATUSES.map(s => `<option value="${s}" ${s === 'lead' ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
            </select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Lead Score</label>
            <input type="number" name="lead_score" min="0" max="100" value="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Assign To</label>
            <select name="assigned_to" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="">— Unassigned —</option>${staff.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
            </select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">City</label>
            <input type="text" name="city" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="Kampala"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Country</label>
            <input type="text" name="country" value="Uganda" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Address</label>
            <textarea name="address" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical" placeholder="Street address..."></textarea></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Tags (comma-separated)</label>
            <input type="text" name="tags" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="vip, enterprise, hot-lead"></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
            <textarea name="notes" rows="3" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical" placeholder="Additional notes about this contact..."></textarea></div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">💾 Save Contact</button>
            <a href="/crm/contacts" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Contact', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 4: POST /crm/contacts/create
  // ════════════════════════════════════════════════════════════
  app.post('/crm/contacts/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { first_name, last_name, email, phone, company, job_title, address, city, country,
      source, tags, notes, lead_score, status, assigned_to } = req.body;
    if (!first_name || !first_name.trim()) return res.redirect('/crm/contacts/new');
    const parsedTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : null;
    const result = await pool.query(
      `INSERT INTO crm_contacts (tenant_id, first_name, last_name, email, phone, company, job_title,
        address, city, country, source, tags, notes, lead_score, status, assigned_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
      [tid, first_name.trim(), (last_name || '').trim(), (email || '').trim(), (phone || '').trim(),
        (company || '').trim(), (job_title || '').trim(), (address || '').trim(), (city || '').trim(),
        (country || 'Uganda').trim(), (source || '').trim() || null, parsedTags,
        (notes || '').trim() || null, parseInt(lead_score) || 0, status || 'lead', assigned_to || null]
    );
    console.log(`[CRM] Contact ${first_name} ${last_name} created by ${user.email}`);
    res.redirect('/crm/contacts/' + result.rows[0].id);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 5: GET /crm/contacts/:id — Contact Detail
  // ════════════════════════════════════════════════════════════
  app.get('/crm/contacts/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, cid = req.params.id;
    const contact = (await pool.query(
      `SELECT c.*, u.name as assignee_name FROM crm_contacts c
       LEFT JOIN users u ON u.id = c.assigned_to
       WHERE c.id=$1 AND c.tenant_id=$2`, [cid, tid]
    )).rows[0];
    if (!contact) return res.send('<div class="alert">Contact not found.</div><a href="/crm/contacts" class="btn btn-blue">Back</a>');

    const activities = (await pool.query(
      `SELECT a.* FROM crm_activities a WHERE a.contact_id=$1 AND a.tenant_id=$2 ORDER BY a.created_at DESC LIMIT 30`, [cid, tid]
    )).rows;
    const deals = (await pool.query(
      `SELECT * FROM crm_deals WHERE contact_id=$1 AND tenant_id=$2 ORDER BY created_at DESC`, [cid, tid]
    )).rows;

    const timelineHtml = activities.map(a => `
      <div class="crm-tl-item ${a.activity_type}">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:6px">
          <div><strong>${ACTIVITY_ICONS[a.activity_type] || ''} ${esc(a.subject || a.activity_type)}</strong>
          ${a.completed ? '<span class="badge badge-success">Done</span>' : ''}</div>
          <span class="muted" style="font-size:12px">${formatDateTime(a.created_at)}</span>
        </div>
        ${a.description ? `<div style="font-size:13px;color:#475569;margin-top:6px">${esc(a.description)}</div>` : ''}
        ${a.due_date ? `<div class="muted" style="font-size:12px;margin-top:4px">Due: ${formatDate(a.due_date)}</div>` : ''}
      </div>`).join('');

    const dealRows = deals.map(d => `<tr>
      <td><a href="/crm/pipeline" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(d.title)}</a></td>
      <td>${stageBadge(d.stage)}</td>
      <td style="font-weight:600">${fmtMoney(d.value)}</td>
      <td style="font-size:12px">${d.probability}%</td>
      <td style="font-size:12px">${formatDate(d.expected_close)}</td>
    </tr>`).join('');

    const tagBadges = (contact.tags || []).map(t => `<span class="badge badge-warning">${esc(t)}</span>`).join(' ');

    const html = CRM_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('/crm/contacts')}
      <a href="/crm/contacts" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Contacts</a>
      <div class="card" style="padding:24px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
          <div>
            <h2 style="color:#1e293b;margin-bottom:6px">👤 ${esc(contact.first_name || '')} ${esc(contact.last_name || '')}</h2>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
              ${statusBadge(contact.status)}
              <span class="muted" style="font-size:12px">Score: <strong>${contact.lead_score || 0}</strong>/100</span>
            </div>
          </div>
          <div style="display:flex;gap:8px">
            <a href="/crm/contacts/${cid}/edit" class="btn btn-gold">✏️ Edit</a>
            <form method="POST" action="/crm/contacts/${cid}/delete" style="display:inline" onsubmit="return confirm('Delete this contact?')">
              <button class="btn btn-red btn-sm">🗑️ Delete</button>
            </form>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:14px;margin-top:20px;padding-top:16px;border-top:1px solid #e2e8f0">
          <div><span class="muted" style="display:block;font-size:11px">Email</span><strong style="font-size:13px">${esc(contact.email || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Phone</span><strong style="font-size:13px">${esc(contact.phone || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Company</span><strong style="font-size:13px">${esc(contact.company || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Job Title</span><strong style="font-size:13px">${esc(contact.job_title || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Location</span><strong style="font-size:13px">${esc(contact.city || '')}${contact.city && contact.country ? ', ' : ''}${esc(contact.country || '')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Source</span><strong style="font-size:13px">${esc(contact.source || '—')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Assigned To</span><strong style="font-size:13px">${esc(contact.assignee_name || 'Unassigned')}</strong></div>
          <div><span class="muted" style="display:block;font-size:11px">Created</span><strong style="font-size:13px">${formatDate(contact.created_at)}</strong></div>
        </div>
        ${contact.address ? `<div style="margin-top:12px;font-size:13px;color:#64748b">📍 ${esc(contact.address)}</div>` : ''}
        ${tagBadges ? `<div style="margin-top:10px;display:flex;gap:6px;flex-wrap:wrap">${tagBadges}</div>` : ''}
        ${contact.notes ? `<div style="margin-top:12px;padding:12px;background:#f8fafc;border-radius:10px;font-size:13px;color:#475569">${esc(contact.notes)}</div>` : ''}
      </div>

      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">📝 Add Activity</h3>
        <form method="POST" action="/crm/activities/add" class="form-grid">
          <input type="hidden" name="contact_id" value="${cid}">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Type</label>
            <select name="activity_type" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
              ${ACTIVITY_TYPES.map(t => `<option value="${t}">${ACTIVITY_ICONS[t]} ${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
            </select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Subject</label>
            <input type="text" name="subject" required style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px" placeholder="Follow up call"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Due Date</label>
            <input type="date" name="due_date" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
            <textarea name="description" rows="2" style="width:100%;padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px" placeholder="Activity details..."></textarea></div>
          <div class="full"><button type="submit" class="btn btn-blue">➕ Add Activity</button></div>
        </form>
      </div>

      <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">📋 Activity Timeline</h3>
          ${timelineHtml || '<p class="muted" style="text-align:center;padding:20px">No activities yet</p>'}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">💼 Deals (${deals.length})</h3>
          ${dealRows ? `<table class="crm-tbl"><thead><tr><th>Deal</th><th>Stage</th><th>Value</th><th>Prob</th><th>Close</th></tr></thead><tbody>${dealRows}</tbody></table>` : '<p class="muted" style="text-align:center;padding:20px">No deals associated</p>'}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Contact: ' + (contact.first_name || '') + ' ' + (contact.last_name || ''), html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 6: GET /crm/contacts/:id/edit — Edit Contact
  // ════════════════════════════════════════════════════════════
  app.get('/crm/contacts/:id/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, cid = req.params.id;
    const contact = (await pool.query(`SELECT * FROM crm_contacts WHERE id=$1 AND tenant_id=$2`, [cid, tid])).rows[0];
    if (!contact) return res.send('<div class="alert">Contact not found.</div><a href="/crm/contacts" class="btn btn-blue">Back</a>');
    const staff = (await pool.query(`SELECT id, name FROM users WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const fld = (label, name, type, val) => `<div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">${label}</label>
      <input type="${type}" name="${name}" value="${esc(String(val || ''))}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>`;

    const html = CRM_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('/crm/contacts')}
      <a href="/crm/contacts/${cid}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Contact</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:20px">✏️ Edit: ${esc(contact.first_name || '')} ${esc(contact.last_name || '')}</h2>
        <form method="POST" action="/crm/contacts/${cid}/update" class="form-grid">
          ${fld('First Name *', 'first_name', 'text', contact.first_name)}
          ${fld('Last Name', 'last_name', 'text', contact.last_name)}
          ${fld('Email', 'email', 'email', contact.email)}
          ${fld('Phone', 'phone', 'text', contact.phone)}
          ${fld('Company', 'company', 'text', contact.company)}
          ${fld('Job Title', 'job_title', 'text', contact.job_title)}
          ${fld('City', 'city', 'text', contact.city)}
          ${fld('Country', 'country', 'text', contact.country)}
          ${fld('Source', 'source', 'text', contact.source)}
          ${fld('Lead Score', 'lead_score', 'number', contact.lead_score)}
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Status</label>
            <select name="status" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              ${CONTACT_STATUSES.map(s => `<option value="${s}" ${contact.status === s ? 'selected' : ''}>${STATUS_LABELS[s]}</option>`).join('')}
            </select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Assign To</label>
            <select name="assigned_to" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="">— Unassigned —</option>${staff.map(s => `<option value="${s.id}" ${contact.assigned_to == s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}
            </select></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Address</label>
            <textarea name="address" rows="2" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">${esc(contact.address || '')}</textarea></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Tags (comma-separated)</label>
            <input type="text" name="tags" value="${esc((contact.tags || []).join(', '))}" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
            <textarea name="notes" rows="3" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">${esc(contact.notes || '')}</textarea></div>
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">💾 Update Contact</button>
            <a href="/crm/contacts/${cid}" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Contact', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 7: POST /crm/contacts/:id/update
  // ════════════════════════════════════════════════════════════
  app.post('/crm/contacts/:id/update', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, cid = req.params.id;
    const { first_name, last_name, email, phone, company, job_title, address, city, country,
      source, tags, notes, lead_score, status, assigned_to } = req.body;
    if (!first_name || !first_name.trim()) return res.redirect('/crm/contacts/' + cid + '/edit');
    const parsedTags = tags ? tags.split(',').map(t => t.trim()).filter(Boolean) : null;
    await pool.query(
      `UPDATE crm_contacts SET first_name=$1, last_name=$2, email=$3, phone=$4, company=$5,
        job_title=$6, address=$7, city=$8, country=$9, source=$10, tags=$11, notes=$12,
        lead_score=$13, status=$14, assigned_to=$15, updated_at=NOW()
       WHERE id=$16 AND tenant_id=$17`,
      [first_name.trim(), (last_name || '').trim(), (email || '').trim(), (phone || '').trim(),
        (company || '').trim(), (job_title || '').trim(), (address || '').trim(),
        (city || '').trim(), (country || 'Uganda').trim(), (source || '').trim() || null,
        parsedTags, (notes || '').trim() || null, parseInt(lead_score) || 0, status || 'lead',
        assigned_to || null, cid, tid]
    );
    res.redirect('/crm/contacts/' + cid);
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 8: DELETE /crm/contacts/:id
  // ════════════════════════════════════════════════════════════
  app.delete('/crm/contacts/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, cid = req.params.id;
    const contact = (await pool.query(`SELECT id FROM crm_contacts WHERE id=$1 AND tenant_id=$2`, [cid, tid])).rows[0];
    if (!contact) return res.json({ ok: false, error: 'Not found' });
    await pool.query('DELETE FROM crm_activities WHERE contact_id=$1 AND tenant_id=$2', [cid, tid]);
    await pool.query('DELETE FROM crm_deals WHERE contact_id=$1 AND tenant_id=$2', [cid, tid]);
    await pool.query('DELETE FROM crm_contacts WHERE id=$1 AND tenant_id=$2', [cid, tid]);
    res.json({ ok: true, message: 'Contact deleted' });
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 9: GET /crm/pipeline — Kanban Deal Pipeline
  // ════════════════════════════════════════════════════════════
  app.get('/crm/pipeline', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const deals = (await pool.query(
      `SELECT d.*, u.name as assignee_name FROM crm_deals d
       LEFT JOIN users u ON u.id = d.assigned_to
       WHERE d.tenant_id=$1 ORDER BY d.created_at DESC`, [tid]
    )).rows;

    const grouped = {};
    STAGES.forEach(s => grouped[s] = []);
    deals.forEach(d => { if (grouped[d.stage]) grouped[d.stage].push(d); });

    const cols = STAGES.map(stage => {
      const items = grouped[stage];
      const total = items.reduce((sum, d) => sum + Number(d.value || 0), 0);
      const cards = items.map(d => `
        <div class="kanban-card">
          <div style="font-size:13px;font-weight:600;color:#1e293b;margin-bottom:4px">${esc(d.title)}</div>
          <div style="font-size:12px;color:#64748b">${esc(d.contact_name || 'No contact')}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:8px">
            <span style="font-size:14px;font-weight:700;color:${STAGE_COLORS[stage]}">${fmtMoney(d.value)}</span>
            <span style="font-size:11px;color:#94a3b8">${d.probability}%</span>
          </div>
          ${d.expected_close ? `<div class="muted" style="font-size:11px;margin-top:4px">Close: ${formatDate(d.expected_close)}</div>` : ''}
          ${d.assignee_name ? `<div class="muted" style="font-size:11px">👤 ${esc(d.assignee_name)}</div>` : ''}
          <form method="POST" action="/crm/deals/${d.id}/stage" style="margin-top:8px">
            <select name="stage" onchange="this.form.submit()" style="width:100%;padding:5px 8px;border:1px solid #e2e8f0;border-radius:6px;font-size:11px">
              ${STAGES.map(s => `<option value="${s}" ${d.stage === s ? 'selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}
            </select>
          </form>
        </div>`).join('');
      return `<div class="kanban-col">
        <h4 style="background:${STAGE_COLORS[stage]}">${STAGE_LABELS[stage]} (${items.length})</h4>
        <div class="kanban-val">${fmtMoney(total)}</div>
        <div class="kanban-cnt">weighted: ${fmtMoney(items.reduce((s, d) => s + (Number(d.value || 0) * Number(d.probability || 0) / 100), 0))}</div>
        ${cards}
      </div>`;
    }).join('');

    const totalPipeline = deals.filter(d => d.stage !== 'won' && d.stage !== 'lost').reduce((s, d) => s + Number(d.value || 0), 0);
    const wonValue = deals.filter(d => d.stage === 'won').reduce((s, d) => s + Number(d.value || 0), 0);

    const html = CRM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('/crm/pipeline')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Deal Pipeline</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Pipeline: <strong style="color:#4f46e5">${fmtMoney(totalPipeline)}</strong> · Won: <strong style="color:#22c55e">${fmtMoney(wonValue)}</strong></p></div>
        <a href="/crm/deals/new" class="btn btn-green">+ New Deal</a>
      </div>
      <div class="kanban">${cols}</div>
    </div>`;
    res.send(renderPage('Deal Pipeline', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 10: GET /crm/deals/new — Create Deal Form
  // ════════════════════════════════════════════════════════════
  app.get('/crm/deals/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const contacts = (await pool.query(`SELECT id, first_name, last_name, company FROM crm_contacts WHERE tenant_id=$1 ORDER BY first_name`, [tid])).rows;
    const staff = (await pool.query(`SELECT id, name FROM users WHERE tenant_id=$1 ORDER BY name`, [tid])).rows;

    const html = CRM_CSS + `<div style="max-width:700px;margin:0 auto">
      ${nav('/crm/pipeline')}
      <a href="/crm/pipeline" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Pipeline</a>
      <div class="card" style="padding:24px">
        <h2 style="color:#1e293b;margin-bottom:4px">💼 New Deal</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Create a new sales deal</p>
        <form method="POST" action="/crm/deals/create" class="form-grid">
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Deal Title *</label>
            <input type="text" name="title" required style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="Enterprise License Deal"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Contact</label>
            <select name="contact_id" id="contactSelect" onchange="updateContactName()" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="">— Select contact —</option>
              ${contacts.map(c => `<option value="${c.id}" data-name="${esc(c.first_name || '')} ${esc(c.last_name || '')}">${esc(c.first_name || '')} ${esc(c.last_name || '')} — ${esc(c.company || '')}</option>`).join('')}
            </select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Deal Value (UGX)</label>
            <input type="number" name="value" step="0.01" min="0" value="0" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Stage</label>
            <select name="stage" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              ${STAGES.map(s => `<option value="${s}" ${s === 'lead' ? 'selected' : ''}>${STAGE_LABELS[s]}</option>`).join('')}
            </select></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Probability (%)</label>
            <input type="number" name="probability" min="0" max="100" value="10" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Expected Close</label>
            <input type="date" name="expected_close" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Assign To</label>
            <select name="assigned_to" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">
              <option value="">— Unassigned —</option>${staff.map(s => `<option value="${s.id}">${esc(s.name)}</option>`).join('')}
            </select></div>
          <div class="full"><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Notes</label>
            <textarea name="notes" rows="3" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px" placeholder="Deal notes..."></textarea></div>
          <input type="hidden" name="contact_name" id="contactName" value="">
          <div class="full" style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">💾 Create Deal</button>
            <a href="/crm/pipeline" class="btn" style="padding:12px 28px;background:#f1f5f9;color:#475569;text-decoration:none">Cancel</a>
          </div>
        </form>
      </div>
      <script>function updateContactName(){var s=document.getElementById('contactSelect'),o=s.options[s.selectedIndex];document.getElementById('contactName').value=o.getAttribute('data-name')||''}</script>
    </div>`;
    res.send(renderPage('New Deal', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 11: POST /crm/deals/create
  // ════════════════════════════════════════════════════════════
  app.post('/crm/deals/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, contact_id, value, stage, probability, expected_close, contact_name, notes, assigned_to } = req.body;
    if (!title || !title.trim()) return res.redirect('/crm/deals/new');
    const result = await pool.query(
      `INSERT INTO crm_deals (tenant_id, contact_id, title, value, stage, probability, expected_close, contact_name, notes, assigned_to)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
      [tid, contact_id || null, title.trim(), parseFloat(value) || 0, stage || 'lead',
        parseInt(probability) || 10, expected_close || null, (contact_name || '').trim() || null,
        (notes || '').trim() || null, assigned_to || null]
    );
    console.log(`[CRM] Deal "${title}" created by ${user.email}`);
    res.redirect('/crm/pipeline');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 12: POST /crm/deals/:id/stage — Move Deal Stage
  // ════════════════════════════════════════════════════════════
  app.post('/crm/deals/:id/stage', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, dealId = req.params.id;
    const { stage } = req.body;
    if (!STAGES.includes(stage)) return res.redirect('/crm/pipeline');
    await pool.query(`UPDATE crm_deals SET stage=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [stage, dealId, tid]);
    console.log(`[CRM] Deal #${dealId} moved to "${stage}" by ${user.email}`);
    res.redirect('/crm/pipeline');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 13: POST /crm/activities/add — Add Activity
  // ════════════════════════════════════════════════════════════
  app.post('/crm/activities/add', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { contact_id, deal_id, activity_type, subject, description, due_date } = req.body;
    if (!subject || !subject.trim()) {
      return res.redirect(contact_id ? '/crm/contacts/' + contact_id : '/crm');
    }
    await pool.query(
      `INSERT INTO crm_activities (tenant_id, contact_id, deal_id, activity_type, subject, description, due_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, contact_id || null, deal_id || null, activity_type || 'note', subject.trim(),
        (description || '').trim() || null, due_date || null, user.id]
    );
    console.log(`[CRM] Activity "${subject}" added by ${user.email}`);
    res.redirect(contact_id ? '/crm/contacts/' + contact_id : '/crm');
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 14: GET /crm/report — CRM Analytics
  // ════════════════════════════════════════════════════════════
  app.get('/crm/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const stageData = (await pool.query(`
      SELECT stage, COUNT(*)::int as count, COALESCE(SUM(value), 0) as total_value,
             COALESCE(SUM(value * probability / 100), 0) as weighted_value
      FROM crm_deals WHERE tenant_id=$1 GROUP BY stage ORDER BY
      CASE stage WHEN 'lead' THEN 1 WHEN 'qualified' THEN 2 WHEN 'proposal' THEN 3
                 WHEN 'negotiation' THEN 4 WHEN 'won' THEN 5 WHEN 'lost' THEN 6 END`, [tid]
    )).rows;

    const sourceData = (await pool.query(`
      SELECT source, COUNT(*)::int as count FROM crm_contacts
      WHERE tenant_id=$1 AND source IS NOT NULL GROUP BY source ORDER BY count DESC LIMIT 10`, [tid]
    )).rows;

    const conversionData = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE stage = 'won')::int as won,
        COUNT(*) FILTER (WHERE stage = 'lost')::int as lost,
        COUNT(*) FILTER (WHERE stage NOT IN ('won','lost'))::int as open,
        CASE WHEN COUNT(*) > 0 THEN ROUND(COUNT(*) FILTER (WHERE stage = 'won')::numeric / COUNT(*) * 100, 1) ELSE 0 END as win_rate
      FROM crm_deals WHERE tenant_id=$1`, [tid]
    )).rows[0];

    const monthlyDeals = (await pool.query(`
      SELECT date_trunc('month', created_at) as month, COUNT(*)::int as count,
             COALESCE(SUM(CASE WHEN stage='won' THEN value ELSE 0 END), 0) as revenue
      FROM crm_deals WHERE tenant_id=$1 AND created_at >= NOW() - INTERVAL '6 months'
      GROUP BY month ORDER BY month DESC LIMIT 6`, [tid]
    )).rows;

    const topContacts = (await pool.query(`
      SELECT c.first_name, c.last_name, c.company,
             COUNT(d.id)::int as deal_count, COALESCE(SUM(d.value), 0) as total_value
      FROM crm_contacts c LEFT JOIN crm_deals d ON d.contact_id = c.id AND d.tenant_id = c.tenant_id
      WHERE c.tenant_id=$1 GROUP BY c.id ORDER BY total_value DESC LIMIT 10`, [tid]
    )).rows;

    const pipelineBar = stageData.map(s => {
      const pct = conversionData.won + conversionData.lost + conversionData.open > 0 ? Math.max(2, Math.round(Number(s.count) / Math.max(1, stageData.reduce((a, x) => a + Number(x.count), 0)) * 100)) : 10;
      return `<div style="width:${pct}%;background:${STAGE_COLORS[s.stage] || '#94a3b8'};min-width:30px">${STAGE_LABELS[s.stage]} (${s.count})</div>`;
    }).join('');

    const stageRows = stageData.map(s => `<tr>
      <td>${stageBadge(s.stage)}</td>
      <td style="font-weight:600">${s.count}</td>
      <td style="font-weight:600">${fmtMoney(s.total_value)}</td>
      <td style="font-weight:600">${fmtMoney(s.weighted_value)}</td>
    </tr>`).join('');

    const sourceRows = sourceData.map(s => `<tr>
      <td>${esc(s.source)}</td>
      <td style="font-weight:600">${s.count}</td>
      <td><div style="background:#e2e8f0;border-radius:6px;height:20px;overflow:hidden;width:100%"><div style="background:#4f46e5;height:100%;width:${Math.round(s.count / Math.max(1, sourceData[0].count) * 100)}%;border-radius:6px"></div></div></td>
    </tr>`).join('');

    const monthRows = monthlyDeals.map(m => `<tr>
      <td>${new Date(m.month).toLocaleDateString('en-GB', { month: 'short', year: 'numeric' })}</td>
      <td style="font-weight:600">${m.count}</td>
      <td style="font-weight:600;color:#22c55e">${fmtMoney(m.revenue)}</td>
    </tr>`).join('');

    const contactRows = topContacts.map(c => `<tr>
      <td><a href="/crm/contacts/${c.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(c.first_name || '')} ${esc(c.last_name || '')}</a></td>
      <td>${esc(c.company || '—')}</td>
      <td style="font-weight:600">${c.deal_count}</td>
      <td style="font-weight:600;color:#059669">${fmtMoney(c.total_value)}</td>
    </tr>`).join('');

    const html = CRM_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('/crm/report')}
      <h1 style="font-size:24px;color:#1e293b">📈 CRM Reports & Analytics</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Pipeline performance and conversion insights</p>

      <div class="stats" style="margin-bottom:20px">
        <div class="stat-card"><div class="stat-num" style="color:#22c55e">${conversionData.won}</div><div class="muted">Won Deals</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${conversionData.lost}</div><div class="muted">Lost Deals</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${conversionData.open}</div><div class="muted">Open Deals</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${conversionData.win_rate}%</div><div class="muted">Win Rate</div></div>
      </div>

      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">📊 Pipeline Distribution</h3>
        <div class="crm-bar">${pipelineBar}</div>
      </div>

      <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">💡 Pipeline by Stage</h3>
          <table class="crm-tbl"><thead><tr><th>Stage</th><th>Deals</th><th>Value</th><th>Weighted</th></tr></thead>
          <tbody>${stageRows}</tbody></table>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">🎯 Top Sources</h3>
          <table class="crm-tbl"><thead><tr><th>Source</th><th>Contacts</th><th>Distribution</th></tr></thead>
          <tbody>${sourceRows}</tbody></table>
        </div>
      </div>

      <div class="grid" style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">📅 Monthly Performance</h3>
          <table class="crm-tbl"><thead><tr><th>Month</th><th>Deals</th><th>Revenue</th></tr></thead>
          <tbody>${monthRows || '<tr><td colspan="3" class="muted" style="text-align:center;padding:20px">No data</td></tr>'}</tbody></table>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 12px">🏆 Top Contacts by Value</h3>
          <table class="crm-tbl"><thead><tr><th>Contact</th><th>Company</th><th>Deals</th><th>Value</th></tr></thead>
          <tbody>${contactRows || '<tr><td colspan="4" class="muted" style="text-align:center;padding:20px">No data</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('CRM Reports', html, user, req));
  }));

  // ════════════════════════════════════════════════════════════
  // ROUTE 15: GET /crm/contacts/export — Export Contacts CSV
  // ════════════════════════════════════════════════════════════
  app.get('/crm/contacts/export', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const contacts = (await pool.query(
      `SELECT first_name, last_name, email, phone, company, job_title, city, country,
              source, status, lead_score, notes, created_at,
              COALESCE(array_to_string(tags, ', '), '') as tags
       FROM crm_contacts WHERE tenant_id=$1 ORDER BY first_name, last_name`, [tid]
    )).rows;

    const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Company', 'Job Title',
      'City', 'Country', 'Source', 'Status', 'Lead Score', 'Tags', 'Notes', 'Created At'];
    const escapeCsv = (v) => {
      const s = String(v || '');
      if (s.includes(',') || s.includes('"') || s.includes('\n')) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    };
    const rows = contacts.map(c => [
      c.first_name, c.last_name, c.email, c.phone, c.company, c.job_title,
      c.city, c.country, c.source, c.status, c.lead_score, c.tags, c.notes, formatDate(c.created_at)
    ].map(escapeCsv).join(','));

    const csv = [headers.join(','), ...rows].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="crm-contacts-' + new Date().toISOString().slice(0, 10) + '.csv"');
    res.send(csv);
    console.log(`[CRM] Contacts CSV exported by ${user.email} (${contacts.length} records)`);
  }));

  console.log('[CRM] Contact management loaded');
};
