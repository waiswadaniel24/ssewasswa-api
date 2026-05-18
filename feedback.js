// ============================================================
// FEEDBACK & RATING SYSTEM MODULE — Multi-Tenant SaaS Platform
// Manage feedback forms, collect ratings/NPS, analyze responses,
// track sentiment, and generate actionable insights.
// ============================================================
// Usage in server.js:
//   const feedback = require('./feedback');
//   feedback(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const formatDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

function typeBadge(type) {
  const map = { satisfaction: { bg: '#dbeafe', c: '#1d4ed8', l: '⭐ Satisfaction' }, nps: { bg: '#ede9fe', c: '#7c3aed', l: '📊 NPS' }, survey: { bg: '#fef3c7', c: '#b45309', l: '📋 Survey' }, review: { bg: '#dcfce7', c: '#16a34a', l: '💬 Review' } };
  const s = map[type] || map.satisfaction;
  return `<span class="badge" style="background:${s.bg};color:${s.c}">${s.l}</span>`;
}

function activeBadge(active) {
  return active
    ? '<span class="badge badge-success">● Active</span>'
    : '<span class="badge badge-warning">○ Inactive</span>';
}

function sentimentBadge(rating) {
  if (!rating) return '<span class="muted">N/A</span>';
  if (rating >= 4) return '<span class="badge badge-success">😊 Positive</span>';
  if (rating >= 3) return '<span class="badge badge-warning">😐 Neutral</span>';
  return '<span class="badge" style="background:#fee2e2;color:#dc2626">😞 Negative</span>';
}

function starDisplay(val, size) {
  size = size || 16;
  let s = '';
  for (let i = 1; i <= 5; i++) s += i <= val ? '★' : '☆';
  return `<span style="color:#f59e0b;font-size:${size}px;letter-spacing:2px">${s}</span>`;
}

function npsLabel(score) {
  if (score === null || score === undefined) return '-';
  if (score >= 9) return '<span style="color:#16a34a;font-weight:700">Promoter</span>';
  if (score >= 7) return '<span style="color:#f59e0b;font-weight:700">Passive</span>';
  return '<span style="color:#dc2626;font-weight:700">Detractor</span>';
}

function progressBar(pct, color) {
  return `<div style="display:flex;align-items:center;gap:10px"><div style="flex:1;background:#f1f5f9;border-radius:8px;overflow:hidden;height:24px"><div style="width:${pct}%;background:${color};height:100%;border-radius:8px;transition:width .3s;min-width:${pct > 0 ? '2px' : '0'}"></div></div><span style="font-size:12px;font-weight:700;color:#1e293b;min-width:40px;text-align:right">${pct}%</span></div>`;
}

function categoryDot(color) {
  return `<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${color || '#3b82f6'};margin-right:6px;vertical-align:middle"></span>`;
}

// Shared CSS
const FB_CSS = `<style>
.fb-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.fb-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.fb-nav a:hover{background:#e2e8f0}.fb-nav a.active{background:#4f46e5;color:#fff}
.fb-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:20px}
.fb-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px}
.fb-grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
.fb-table{width:100%;border-collapse:collapse;font-size:13px}
.fb-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.fb-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}.fb-table tr:hover{background:#f8fafc}
.fb-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.fb-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.fb-filter input,.fb-filter select{padding:8px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.fb-filter input:focus,.fb-filter select:focus{outline:none;border-color:#6366f1}
.fb-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
.fb-form input,.fb-form select,.fb-form textarea{width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box}
.fb-form input:focus,.fb-form select:focus,.fb-form textarea:focus{outline:none;border-color:#6366f1}
.fb-nps-scale{display:flex;gap:4px;margin:10px 0}
.fb-nps-btn{width:40px;height:40px;border-radius:8px;border:2px solid #e2e8f0;background:#fff;font-size:14px;font-weight:700;cursor:pointer;transition:.15s;display:flex;align-items:center;justify-content:center}
.fb-nps-btn:hover{border-color:#6366f1;background:#eef2ff}
.fb-nps-btn.selected{border-color:#4f46e5;background:#4f46e5;color:#fff}
.fb-nps-labels{display:flex;justify-content:space-between;font-size:11px;color:#94a3b8;margin-top:4px}
.fb-star-input{display:flex;gap:4px}.fb-star-input span{font-size:32px;cursor:pointer;color:#d1d5db;transition:.1s}
.fb-star-input span.filled{color:#f59e0b}
.fb-question{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px}
.fb-timeline{position:relative;padding-left:30px;margin-top:16px}
.fb-timeline::before{content:'';position:absolute;left:12px;top:0;bottom:0;width:2px;background:#e2e8f0}
.fb-tl-item{position:relative;margin-bottom:12px;padding:12px 16px;background:#fff;border:1px solid #e2e8f0;border-radius:10px}
.fb-tl-item::before{content:'';position:absolute;left:-22px;top:16px;width:12px;height:12px;border-radius:50%;background:#4f46e5;border:2px solid #fff;box-shadow:0 0 0 2px #e2e8f0}
.fb-cloud{display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:16px;background:#f8fafc;border-radius:12px;min-height:80px}
.fb-cloud span{padding:4px 12px;border-radius:16px;font-size:13px;background:#eef2ff;color:#4f46e5;font-weight:500}
@media(max-width:768px){.fb-grid,.fb-grid-3{grid-template-columns:1fr}.fb-stats{grid-template-columns:1fr 1fr}.fb-filter{flex-direction:column}.fb-nps-scale{flex-wrap:wrap}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function feedback(app, db, pool, renderPage, esc) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  const requireAuth = (req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // 1. DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS feedback_forms (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      title VARCHAR(255) NOT NULL, description TEXT,
      type VARCHAR(30) DEFAULT 'satisfaction',
      target_audience VARCHAR(50) DEFAULT 'all',
      questions JSONB DEFAULT '[]',
      is_active BOOLEAN DEFAULT true,
      response_count INTEGER DEFAULT 0,
      start_date DATE, end_date DATE,
      created_by INTEGER, created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS feedback_responses (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      form_id INTEGER NOT NULL REFERENCES feedback_forms(id) ON DELETE CASCADE,
      respondent_name VARCHAR(255), respondent_email VARCHAR(255),
      answers JSONB DEFAULT '{}', rating INTEGER,
      nps_score INTEGER, comment TEXT,
      submitted_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS feedback_categories (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      name VARCHAR(100) NOT NULL, color VARCHAR(20) DEFAULT '#3b82f6',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    // ALTER TABLE for all columns — feedback_forms)
    `ALTER TABLE IF EXISTS feedback_forms ADD COLUMN IF NOT EXISTS description TEXT`,
    `ALTER TABLE IF EXISTS feedback_forms ADD COLUMN IF NOT EXISTS type VARCHAR(30) DEFAULT 'satisfaction'`,
    `ALTER TABLE IF EXISTS feedback_forms ADD COLUMN IF NOT EXISTS target_audience VARCHAR(50) DEFAULT 'all'`,
    `ALTER TABLE IF EXISTS feedback_forms ADD COLUMN IF NOT EXISTS questions JSONB DEFAULT '[]'`,
    `ALTER TABLE IF EXISTS feedback_forms ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`,
    `ALTER TABLE IF EXISTS feedback_forms ADD COLUMN IF NOT EXISTS response_count INTEGER DEFAULT 0`,
    `ALTER TABLE IF EXISTS feedback_forms ADD COLUMN IF NOT EXISTS start_date DATE`,
    `ALTER TABLE IF EXISTS feedback_forms ADD COLUMN IF NOT EXISTS end_date DATE`,
    `ALTER TABLE IF EXISTS feedback_forms ADD COLUMN IF NOT EXISTS created_by INTEGER`,
    // ALTER TABLE for all columns — feedback_responses
    `ALTER TABLE IF EXISTS feedback_responses ADD COLUMN IF NOT EXISTS respondent_name VARCHAR(255)`,
    `ALTER TABLE IF EXISTS feedback_responses ADD COLUMN IF NOT EXISTS respondent_email VARCHAR(255)`,
    `ALTER TABLE IF EXISTS feedback_responses ADD COLUMN IF NOT EXISTS answers JSONB DEFAULT '{}'`,
    `ALTER TABLE IF EXISTS feedback_responses ADD COLUMN IF NOT EXISTS rating INTEGER`,
    `ALTER TABLE IF EXISTS feedback_responses ADD COLUMN IF NOT EXISTS nps_score INTEGER`,
    `ALTER TABLE IF EXISTS feedback_responses ADD COLUMN IF NOT EXISTS comment TEXT`,
    // ALTER TABLE for all columns — feedback_categories
    `ALTER TABLE IF EXISTS feedback_categories ADD COLUMN IF NOT EXISTS color VARCHAR(20) DEFAULT '#3b82f6'`,
    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_ff_tenant ON feedback_forms(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ff_active ON feedback_forms(tenant_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_fr_tenant ON feedback_responses(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fr_form ON feedback_responses(form_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fr_submitted ON feedback_responses(submitted_at)`,
    `CREATE INDEX IF NOT EXISTS idx_fc_tenant ON feedback_categories(tenant_id)`
  ];

  const seedCategories = [
    `INSERT INTO feedback_categories (tenant_id, name, color) VALUES (0, 'Service Quality', '#3b82f6') ON CONFLICT DO NOTHING`,
    `INSERT INTO feedback_categories (tenant_id, name, color) VALUES (0, 'Product Experience', '#8b5cf6') ON CONFLICT DO NOTHING`,
    `INSERT INTO feedback_categories (tenant_id, name, color) VALUES (0, 'Support', '#06b6d4') ON CONFLICT DO NOTHING`,
    `INSERT INTO feedback_categories (tenant_id, name, color) VALUES (0, 'Billing', '#f59e0b') ON CONFLICT DO NOTHING`,
    `INSERT INTO feedback_categories (tenant_id, name, color) VALUES (0, 'Onboarding', '#10b981') ON CONFLICT DO NOTHING`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.warn('[Feedback] Cannot connect to DB'); return; }
    try {
      for (const sql of migrations) await client.query(sql);
      const tenants = (await client.query('SELECT id FROM tenants')).rows;
      for (const t of tenants) {
        for (const seed of seedCategories) {
          await client.query(seed.replace('(0,', `(${t.id},`));
        }
      }
      console.log('[Feedback] Migrations applied, categories seeded');
    } catch (e) { console.error('[Feedback] Migration error:', e.message); }
    finally { client.release(); }
  })();
  // HELPERS
  const nav = (active) => `<div class="fb-nav">
    <a href="/feedback" class="${active === 'dash' ? 'active' : ''}">📊 Dashboard</a>
    <a href="/feedback/forms" class="${active === 'forms' ? 'active' : ''}">📝 Forms</a>
    <a href="/feedback/responses" class="${active === 'responses' ? 'active' : ''}">💬 Responses</a>
    <a href="/feedback/report" class="${active === 'report' ? 'active' : ''}">📈 Reports</a>
    <a href="/feedback/categories" class="${active === 'cats' ? 'active' : ''}">📂 Categories</a>
  </div>`;

  // ============================================================
  // ROUTE 1: GET /feedback — Dashboard
  // ============================================================
  app.get('/feedback', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const forms = (await pool.query('SELECT * FROM feedback_forms WHERE tenant_id=$1 ORDER BY created_at DESC', [tid])).rows;
    const totalResponses = (await pool.query('SELECT COUNT(*)::int as cnt FROM feedback_responses WHERE tenant_id=$1', [tid])).rows[0].cnt;
    const avgRating = (await pool.query('SELECT COALESCE(ROUND(AVG(rating),1),0) as avg FROM feedback_responses WHERE tenant_id=$1 AND rating IS NOT NULL', [tid])).rows[0].avg;
    const npsData = (await pool.query('SELECT nps_score FROM feedback_responses WHERE tenant_id=$1 AND nps_score IS NOT NULL', [tid])).rows;
    let npsScore = 0;
    if (npsData.length) {
      const promoters = npsData.filter(r => r.nps_score >= 9).length;
      const detractors = npsData.filter(r => r.nps_score <= 6).length;
      npsScore = Math.round((promoters - detractors) / npsData.length * 100);
    }
    const activeForms = forms.filter(f => f.is_active);

    const recentResponses = (await pool.query(
      `SELECT fr.*, ff.title as form_title FROM feedback_responses fr
       JOIN feedback_forms ff ON ff.id = fr.form_id
       WHERE fr.tenant_id=$1 ORDER BY fr.submitted_at DESC LIMIT 8`, [tid]
    )).rows;

    const timelineHtml = recentResponses.map(r => `<div class="fb-tl-item">
      <div style="display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;font-weight:700;color:#1e293b">${esc(r.respondent_name || r.respondent_email || 'Anonymous')}</span>
        <div style="display:flex;gap:6px;align-items:center">${r.rating ? starDisplay(r.rating, 14) : ''}${sentimentBadge(r.rating)}</div>
      </div>
      <div style="font-size:12px;color:#94a3b8;margin-top:4px">on <strong>${esc(r.form_title)}</strong> · ${formatDateTime(r.submitted_at)}</div>
      ${r.comment ? `<div style="font-size:13px;color:#334155;margin-top:6px;white-space:pre-wrap">${esc(r.comment.length > 120 ? r.comment.substring(0, 120) + '...' : r.comment)}</div>` : ''}
    </div>`).join('');

    const html = FB_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📊 Feedback & Ratings</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Collect, analyze, and act on feedback</p></div>
        <a href="/feedback/forms/new" class="btn btn-green">+ New Form</a>
      </div>
      <div class="stats grid">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${activeForms.length}</div><div class="muted">Active Forms</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#059669">${totalResponses}</div><div class="muted">Total Responses</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${avgRating} ★</div><div class="muted">Avg Rating</div></div>
        <div class="stat-card"><div class="stat-num" style="color:${npsScore >= 0 ? '#16a34a' : '#dc2626'}">${npsScore}</div><div class="muted">NPS Score</div></div>
        <div class="stat-card"><div class="stat-num">${forms.length}</div><div class="muted">Total Forms</div></div>
      </div>
      <div class="fb-grid">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📝 Active Forms</h3>
          ${activeForms.length ? activeForms.slice(0, 5).map(f => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9">
            <div><a href="/feedback/forms/${f.id}" style="color:#1e293b;text-decoration:none;font-weight:600;font-size:13px">${esc(f.title)}</a><div style="font-size:11px;color:#94a3b8">${typeBadge(f.type)} · ${f.response_count} responses</div></div>
            ${activeBadge(f.is_active)}
          </div>`).join('') : '<p class="muted" style="text-align:center;padding:20px">No active forms</p>'}
          ${activeForms.length > 5 ? `<a href="/feedback/forms" style="font-size:12px;color:#4f46e5;text-decoration:none;display:block;text-align:center;padding-top:8px">View all →</a>` : ''}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">🕐 Recent Activity</h3>
          <div class="fb-timeline">${timelineHtml || '<p class="muted" style="padding-left:10px">No responses yet</p>'}</div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Feedback Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /feedback/forms — Form Management
  // ============================================================
  app.get('/feedback/forms', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { type, status } = req.query;
    let where = ['tenant_id=$1'], params = [tid], pi = 2;
    if (type) { where.push(`type=$${pi++}`); params.push(type); }
    if (status === 'active') { where.push('is_active=true'); }
    else if (status === 'inactive') { where.push('is_active=false'); }

    const forms = (await pool.query(`SELECT * FROM feedback_forms WHERE ${where.join(' AND ')} ORDER BY created_at DESC`, params)).rows;
    const rows = forms.map(f => `<tr>
      <td><a href="/feedback/forms/${f.id}" style="color:#1e293b;text-decoration:none;font-weight:600">${esc(f.title)}</a></td>
      <td>${typeBadge(f.type)}</td>
      <td>${activeBadge(f.is_active)}</td>
      <td>${f.response_count || 0}</td>
      <td style="font-size:12px;color:#94a3b8">${f.start_date ? formatDate(f.start_date) : '-'}${f.end_date ? ' → ' + formatDate(f.end_date) : ''}</td>
      <td style="font-size:12px;color:#94a3b8">${formatDate(f.created_at)}</td>
      <td style="white-space:nowrap">
        <a href="/feedback/forms/${f.id}" class="btn btn-sm btn-blue">View</a>
        <a href="/feedback/submit/${f.id}" class="btn btn-sm" target="_blank">Open</a>
        <form method="POST" action="/feedback/forms/${f.id}/toggle" style="display:inline"><button class="btn btn-sm ${f.is_active ? 'btn-red' : 'btn-green'}">${f.is_active ? 'Disable' : 'Enable'}</button></form>
      </td>
    </tr>`).join('');

    const html = FB_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('forms')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📝 Feedback Forms</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Manage your feedback collection forms</p></div>
        <a href="/feedback/forms/new" class="btn btn-green">+ Create Form</a>
      </div>
      <div class="fb-filter">
        <div><label>Type</label><select onchange="location.href='/feedback/forms?type='+this.value"><option value="">All</option>
          ${['satisfaction','nps','survey','review'].map(t => `<option value="${t}" ${type === t ? 'selected' : ''}>${t}</option>`).join('')}</select></div>
        <div><label>Status</label><select onchange="location.href='/feedback/forms?status='+this.value"><option value="">All</option>
          <option value="active" ${status === 'active' ? 'selected' : ''}>Active</option>
          <option value="inactive" ${status === 'inactive' ? 'selected' : ''}>Inactive</option></select></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="fb-table">
        <thead><tr><th>Title</th><th>Type</th><th>Status</th><th>Responses</th><th>Schedule</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No forms found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Feedback Forms', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /feedback/forms/new — Create Form
  // ============================================================
  app.get('/feedback/forms/new', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const html = FB_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('forms')}
      <a href="/feedback/forms" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Forms</a>
      <div class="card" style="padding:24px">
        <h2 style="margin:0 0 4px;color:#1e293b">📝 Create Feedback Form</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Design a form to collect feedback from your audience</p>
        <form method="POST" action="/feedback/forms/create" class="fb-form" style="display:flex;flex-direction:column;gap:16px">
          <div><label>Form Title *</label><input type="text" name="title" required placeholder="e.g., Customer Satisfaction Survey"></div>
          <div><label>Description</label><textarea name="description" rows="3" placeholder="Brief description..."></textarea></div>
          <div class="fb-grid">
            <div><label>Form Type</label><select name="type"><option value="satisfaction">⭐ Satisfaction (Star Rating)</option><option value="nps">📊 NPS (Net Promoter Score)</option><option value="survey">📋 Survey (Custom Questions)</option><option value="review">💬 Review (Rating + Comment)</option></select></div>
            <div><label>Target Audience</label><select name="target_audience"><option value="all">Everyone</option><option value="customers">Customers</option><option value="employees">Employees</option><option value="students">Students</option><option value="parents">Parents</option></select></div>
          </div>
          <div class="fb-grid">
            <div><label>Start Date</label><input type="date" name="start_date"></div>
            <div><label>End Date</label><input type="date" name="end_date"></div>
          </div>
          <div class="card" style="padding:16px;background:#f8fafc">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
              <label style="margin:0;color:#475569">Questions</label>
              <button type="button" class="btn btn-sm btn-blue" onclick="addQuestion()">+ Add Question</button>
            </div>
            <div id="questions-list"></div>
          </div>
          <div style="display:flex;gap:10px;margin-top:8px">
            <button type="submit" class="btn btn-green" style="padding:12px 28px">🚀 Create Form</button>
            <a href="/feedback/forms" class="btn btn-sm" style="padding:12px 28px">Cancel</a>
          </div>
        </form>
      </div>
    </div>
    <script>
      let qCounter = 0;
      function addQuestion() {
        qCounter++;
        const div = document.createElement('div');
        div.className = 'fb-question';
        div.id = 'q-' + qCounter;
        div.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">'
          + '<span style="font-size:12px;font-weight:700;color:#64748b">Q' + qCounter + '</span>'
          + '<button type="button" class="btn btn-sm btn-red" style="padding:2px 8px;font-size:10px" onclick="this.closest(\\'.fb-question\\').remove()">✕</button></div>'
          + '<input type="text" name="q_text" placeholder="Enter question text..." style="width:100%;padding:9px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:8px;box-sizing:border-box">'
          + '<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">'
          + '<select name="q_type" style="padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px">'
          + '<option value="text">Text</option><option value="rating">Rating (1-5)</option>'
          + '<option value="yes_no">Yes / No</option><option value="multiple_choice">Multiple Choice</option></select>'
          + '<input type="text" name="q_options" placeholder="Options (comma-separated)" style="flex:1;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px">'
          + '</div>';
        document.getElementById('questions-list').appendChild(div);
      }
    </script>`;
    res.send(renderPage('Create Feedback Form', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /feedback/forms/create — Save Form
  // ============================================================
  app.post('/feedback/forms/create', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, description, type, target_audience, start_date, end_date, q_text, q_type, q_options } = req.body;
    if (!title || !title.trim()) return res.redirect('/feedback/forms/new');

    const questions = [];
    const texts = Array.isArray(q_text) ? q_text : (q_text ? [q_text] : []);
    const types = Array.isArray(q_type) ? q_type : (q_type ? [q_type] : []);
    const opts = Array.isArray(q_options) ? q_options : (q_options ? [q_options] : []);
    for (let i = 0; i < texts.length; i++) {
      if (!texts[i] || !texts[i].trim()) continue;
      questions.push({ text: texts[i].trim(), type: types[i] || 'text', options: opts[i] ? opts[i].split(',').map(o => o.trim()).filter(Boolean) : [] });
    }

    await pool.query(
      `INSERT INTO feedback_forms (tenant_id, title, description, type, target_audience, questions, start_date, end_date, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, title.trim(), (description || '').trim(), type || 'satisfaction', target_audience || 'all',
       JSON.stringify(questions), start_date || null, end_date || null, user.id]
    );
    console.log(`[Feedback] Form "${title.trim()}" created by ${user.email}`);
    res.redirect('/feedback/forms');
  }));

  // ============================================================
  // ROUTE 5: GET /feedback/forms/:id — View Form Results
  // ============================================================
  app.get('/feedback/forms/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, formId = req.params.id;
    const form = (await pool.query('SELECT * FROM feedback_forms WHERE id=$1 AND tenant_id=$2', [formId, tid])).rows[0];
    if (!form) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Form not found</h2><a href="/feedback/forms" class="btn btn-sm" style="margin-top:12px">← Back</a></div>', user, req));

    const responses = (await pool.query('SELECT * FROM feedback_responses WHERE form_id=$1 ORDER BY submitted_at DESC', [formId])).rows;
    const rated = responses.filter(r => r.rating);
    const avgR = rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : '-';
    const npsRes = responses.filter(r => r.nps_score !== null && r.nps_score !== undefined);

    // Rating distribution
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    rated.forEach(r => { if (dist[r.rating] !== undefined) dist[r.rating]++; });
    const maxDist = Math.max(...Object.values(dist), 1);
    const distHtml = Object.entries(dist).reverse().map(([star, cnt]) => {
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px"><span style="font-size:14px;color:#f59e0b;min-width:40px">${'★'.repeat(parseInt(star))}</span>${progressBar(rated.length ? Math.round(cnt / maxDist * 100) : 0, '#f59e0b')}<span style="font-size:12px;font-weight:700;color:#1e293b;min-width:40px">${cnt}</span></div>`;
    }).join('');

    const respRows = responses.slice(0, 20).map(r => `<tr>
      <td>${r.rating ? starDisplay(r.rating, 12) : '-'}</td>
      <td>${r.nps_score != null ? `<strong>${r.nps_score}</strong>/10 ${npsLabel(r.nps_score)}` : '-'}</td>
      <td style="font-size:13px">${esc(r.respondent_name || r.respondent_email || 'Anonymous')}</td>
      <td style="font-size:12px;max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.comment || '-')}</td>
      <td style="font-size:12px;color:#94a3b8">${formatDateTime(r.submitted_at)}</td>
    </tr>`).join('');

    const questions = Array.isArray(form.questions) ? form.questions : [];
    const qHtml = questions.map((q, i) => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;font-size:13px">
      <span style="color:#64748b;font-weight:600">Q${i + 1}.</span> ${esc(q.text)}
      <span class="muted" style="font-size:11px">(${esc(q.type)})</span>
    </div>`).join('');

    const html = FB_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${nav('forms')}
      <a href="/feedback/forms" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Forms</a>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div><h1 style="font-size:20px;color:#1e293b;margin:0 0 6px">${esc(form.title)}</h1>
            <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">${typeBadge(form.type)} ${activeBadge(form.is_active)}<span class="muted" style="font-size:12px">${esc(form.target_audience)}</span></div>
            ${form.description ? `<p style="font-size:13px;color:#64748b;margin-top:8px">${esc(form.description)}</p>` : ''}</div>
          <div style="display:flex;gap:6px">
            <a href="/feedback/submit/${form.id}" class="btn btn-sm btn-blue" target="_blank">🔗 Open Form</a>
            <a href="/feedback/forms" class="btn btn-sm btn-gold">↩ All Forms</a>
            <form method="POST" action="/feedback/forms/${form.id}/toggle" style="display:inline"><button class="btn btn-sm ${form.is_active ? 'btn-red' : 'btn-green'}">${form.is_active ? 'Disable' : 'Enable'}</button></form>
            <form method="POST" action="/feedback/forms/${form.id}" onsubmit="return confirm('Delete this form and all responses?')" style="display:inline"><input type="hidden" name="_method" value="DELETE"><button class="btn btn-sm btn-red">🗑 Delete</button></form>
          </div>
        </div>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${responses.length}</div><div class="muted">Responses</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${avgR} ★</div><div class="muted">Avg Rating</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#7c3aed">${npsRes.length}</div><div class="muted">NPS Responses</div></div>
        <div class="stat-card"><div class="stat-num">${questions.length}</div><div class="muted">Questions</div></div>
      </div>
      <div class="fb-grid" style="margin-bottom:16px">
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">⭐ Rating Distribution</h3>${distHtml || '<p class="muted">No ratings yet</p>'}</div>
        <div class="card" style="padding:20px"><h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Questions</h3>${qHtml || '<p class="muted">No questions configured</p>'}</div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">💬 Responses (${responses.length})</h3>
        ${responses.length ? `<div style="overflow-x:auto"><table class="fb-table"><thead><tr><th>Rating</th><th>NPS</th><th>Respondent</th><th>Comment</th><th>Submitted</th></tr></thead><tbody>${respRows}</tbody></table></div>` : '<p class="muted" style="text-align:center;padding:20px">No responses yet.</p>'}
      </div>
    </div>`;
    res.send(renderPage(form.title, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /feedback/forms/:id/toggle — Toggle Active
  // ============================================================
  app.post('/feedback/forms/:id/toggle', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, formId = req.params.id;
    const form = (await pool.query('SELECT id, is_active FROM feedback_forms WHERE id=$1 AND tenant_id=$2', [formId, tid])).rows[0];
    if (!form) return res.redirect('/feedback/forms');
    await pool.query('UPDATE feedback_forms SET is_active=$1 WHERE id=$2 AND tenant_id=$3', [!form.is_active, formId, tid]);
    console.log(`[Feedback] Form #${formId} ${!form.is_active ? 'activated' : 'deactivated'} by ${user.email}`);
    res.redirect('/feedback/forms/' + formId);
  }));

  // ============================================================
  // ROUTE 7: DELETE /feedback/forms/:id — Delete Form
  // ============================================================
  app.delete('/feedback/forms/:id', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM feedback_forms WHERE id=$1 AND tenant_id=$2', [req.params.id, req.session.user.tenant_id]);
    res.json({ success: true });
  }));
  app.post('/feedback/forms/:id', requireAuth, ah(async (req, res) => {
    if (req.body._method !== 'DELETE') return res.redirect('/feedback/forms');
    const tid = req.session.user.tenant_id;
    await pool.query('DELETE FROM feedback_forms WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    res.redirect('/feedback/forms');
  }));

  // ============================================================
  // ROUTE 8: GET /feedback/submit/:id — Public Submission Page
  // ============================================================
  app.get('/feedback/submit/:id', ah(async (req, res) => {
    const formId = req.params.id;
    const form = (await pool.query('SELECT * FROM feedback_forms WHERE id=$1 AND is_active=true', [formId])).rows[0];
    if (!form) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#dc2626">Form not found or inactive</h2></div>', null, req));
    if (form.end_date && new Date(form.end_date) < new Date()) return res.send(renderPage('Closed', '<div class="card" style="text-align:center;padding:48px"><h2 style="color:#f59e0b">⏰ This form has closed</h2></div>', null, req));

    const questions = Array.isArray(form.questions) ? form.questions : [];
    const questionsHtml = questions.map((q, i) => {
      let input = '';
      if (q.type === 'text') input = `<textarea name="a_${i}" rows="3" placeholder="Your answer..." style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;box-sizing:border-box;resize:vertical"></textarea>`;
      else if (q.type === 'rating') input = `<div class="fb-star-input" id="star-${i}">${[1,2,3,4,5].map(s => `<span data-val="${s}" onclick="setStars(${i},${s})">★</span>`).join('')}<input type="hidden" name="a_${i}" id="star-val-${i}"></div>`;
      else if (q.type === 'yes_no') input = `<div style="display:flex;gap:16px"><label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="radio" name="a_${i}" value="Yes"> Yes</label><label style="display:flex;align-items:center;gap:6px;font-size:14px"><input type="radio" name="a_${i}" value="No"> No</label></div>`;
      else if (q.type === 'multiple_choice' && Array.isArray(q.options)) input = q.options.map(o => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:14px"><input type="radio" name="a_${i}" value="${esc(o)}"> ${esc(o)}</label>`).join('');
      return `<div class="fb-question" style="margin-bottom:16px">
        <label style="font-size:14px;font-weight:600;color:#1e293b;display:block;margin-bottom:8px">${i + 1}. ${esc(q.text)}</label>
        ${input}
      </div>`;
    }).join('');

    const showRating = form.type === 'satisfaction' || form.type === 'review';
    const showNps = form.type === 'nps';
    const showComment = form.type !== 'survey' || questions.length === 0;

    const html = FB_CSS + `<div style="max-width:640px;margin:0 auto;padding:20px 0">
      <div class="card" style="padding:32px;text-align:center;margin-bottom:24px">
        <div style="font-size:48px;margin-bottom:12px">📝</div>
        <h1 style="font-size:22px;color:#1e293b;margin:0 0 6px">${esc(form.title)}</h1>
        ${form.description ? `<p style="font-size:14px;color:#64748b;margin:0">${esc(form.description)}</p>` : ''}
      </div>
      <form method="POST" action="/feedback/submit/${form.id}" class="fb-form" style="display:flex;flex-direction:column;gap:20px">
        <div class="fb-grid">
          <div><label>Your Name</label><input type="text" name="respondent_name" placeholder="Optional"></div>
          <div><label>Your Email</label><input type="email" name="respondent_email" placeholder="Optional"></div>
        </div>
        ${showRating ? `<div class="card" style="padding:20px;text-align:center">
          <label style="font-size:15px;font-weight:700;color:#1e293b;display:block;margin-bottom:12px">How would you rate your experience?</label>
          <div class="fb-star-input" id="main-stars" style="justify-content:center">${[1,2,3,4,5].map(s => `<span data-val="${s}" onclick="setStars('main',${s})" style="font-size:40px">★</span>`).join('')}<input type="hidden" name="rating" id="star-val-main"></div>
        </div>` : ''}
        ${showNps ? `<div class="card" style="padding:20px;text-align:center">
          <label style="font-size:15px;font-weight:700;color:#1e293b;display:block;margin-bottom:4px">How likely are you to recommend us?</label>
          <p class="muted" style="font-size:12px;margin-bottom:12px">0 = Not at all likely, 10 = Extremely likely</p>
          <div class="fb-nps-scale" style="justify-content:center">${Array.from({length:11}, (_, i) =>
            `<button type="button" class="fb-nps-btn" onclick="selectNps(${i},this)">${i}</button>`).join('')}</div>
          <input type="hidden" name="nps_score" id="nps-val">
          <div class="fb-nps-labels" style="max-width:100%"><span>Not Likely</span><span>Very Likely</span></div>
        </div>` : ''}
        ${questionsHtml}
        ${showComment ? `<div><label>Additional Comments</label><textarea name="comment" rows="4" placeholder="Share your thoughts..."></textarea></div>` : ''}
        <button type="submit" class="btn btn-green" style="padding:14px 28px;font-size:15px;justify-content:center">📤 Submit Feedback</button>
      </form>
    </div>
    <script>
      function setStars(id, val) {
        const container = document.getElementById('star-' + id);
        container.querySelectorAll('span').forEach((s, i) => { s.classList.toggle('filled', i < val); });
        const hidden = document.getElementById('star-val-' + id);
        if (hidden) hidden.value = val;
      }
      function selectNps(val, btn) {
        document.querySelectorAll('.fb-nps-btn').forEach(b => b.classList.remove('selected'));
        btn.classList.add('selected');
        document.getElementById('nps-val').value = val;
      }
    </script>`;
    res.send(renderPage(form.title, html, null, req));
  }));

  // ============================================================
  // ROUTE 9: POST /feedback/submit/:id — Process Submission
  // ============================================================
  app.post('/feedback/submit/:id', ah(async (req, res) => {
    const formId = req.params.id;
    const form = (await pool.query('SELECT * FROM feedback_forms WHERE id=$1 AND is_active=true', [formId])).rows[0];
    if (!form) return res.send(renderPage('Error', '<div class="alert" style="background:#fee2e2;color:#dc2626;padding:20px;border-radius:10px;text-align:center">Form not found or inactive.</div>', null, req));

    const { respondent_name, respondent_email, rating, nps_score, comment } = req.body;
    const questions = Array.isArray(form.questions) ? form.questions : [];
    const answers = {};
    for (let i = 0; i < questions.length; i++) {
      const val = req.body['a_' + i];
      if (val !== undefined && val !== '') answers[i] = val;
    }

    await pool.query(
      `INSERT INTO feedback_responses (tenant_id, form_id, respondent_name, respondent_email, answers, rating, nps_score, comment)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [form.tenant_id, formId, (respondent_name || '').trim() || null, (respondent_email || '').trim() || null,
       JSON.stringify(answers), rating ? parseInt(rating) : null, nps_score !== undefined && nps_score !== '' ? parseInt(nps_score) : null,
       (comment || '').trim() || null]
    );
    await pool.query('UPDATE feedback_forms SET response_count = response_count + 1 WHERE id=$1', [formId]);
    console.log(`[Feedback] Response submitted for form #${formId}`);

    const html = FB_CSS + `<div style="max-width:500px;margin:80px auto;text-align:center">
      <div class="card" style="padding:40px">
        <div style="font-size:64px;margin-bottom:16px">🎉</div>
        <h1 style="font-size:24px;color:#1e293b;margin:0 0 8px">Thank You!</h1>
        <p style="font-size:15px;color:#64748b;margin:0 0 24px">Your feedback has been submitted successfully.</p>
        <a href="/feedback/submit/${formId}" class="btn btn-blue" style="padding:10px 24px">Submit Another Response</a>
      </div>
    </div>`;
    res.send(renderPage('Thank You', html, null, req));
  }));

  // ============================================================
  // ROUTE 10: GET /feedback/responses — All Responses
  // ============================================================
  app.get('/feedback/responses', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { form_id, rating, search } = req.query;
    let where = ['fr.tenant_id=$1'], params = [tid], pi = 2;
    if (form_id) { where.push(`fr.form_id=$${pi++}`); params.push(form_id); }
    if (rating) { where.push(`fr.rating=$${pi++}`); params.push(rating); }
    if (search) { where.push(`(fr.comment ILIKE $${pi} OR fr.respondent_name ILIKE $${pi} OR fr.respondent_email ILIKE $${pi})`); params.push('%' + search + '%'); pi++; }

    const forms = (await pool.query('SELECT id, title FROM feedback_forms WHERE tenant_id=$1 ORDER BY title', [tid])).rows;
    const responses = (await pool.query(
      `SELECT fr.*, ff.title as form_title, ff.type as form_type
       FROM feedback_responses fr JOIN feedback_forms ff ON ff.id = fr.form_id
       WHERE ${where.join(' AND ')} ORDER BY fr.submitted_at DESC LIMIT 100`, params
    )).rows;

    const rows = responses.map(r => `<tr>
      <td><a href="/feedback/forms/${r.form_id}" style="color:#4f46e5;text-decoration:none;font-size:13px;font-weight:600">${esc(r.form_title)}</a></td>
      <td>${r.rating ? `${starDisplay(r.rating, 12)} <span class="muted">${r.rating}/5</span>` : '<span class="muted">-</span>'}</td>
      <td>${r.nps_score !== null && r.nps_score !== undefined ? `<strong>${r.nps_score}</strong>/10 ${npsLabel(r.nps_score)}` : '<span class="muted">-</span>'}</td>
      <td>${sentimentBadge(r.rating)}</td>
      <td style="font-size:13px">${esc(r.respondent_name || r.respondent_email || 'Anonymous')}</td>
      <td style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.comment || '-')}</td>
      <td style="font-size:12px;color:#94a3b8">${formatDateTime(r.submitted_at)}</td>
    </tr>`).join('');

    const html = FB_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('responses')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">💬 All Responses</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${responses.length} responses found</p></div>
      </div>
      <div class="fb-filter">
        <div><label>Form</label><select onchange="location.href='/feedback/responses?form_id='+this.value"><option value="">All Forms</option>
          ${forms.map(f => `<option value="${f.id}" ${form_id == f.id ? 'selected' : ''}>${esc(f.title)}</option>`).join('')}</select></div>
        <div><label>Rating</label><select onchange="location.href='/feedback/responses?rating='+this.value"><option value="">All</option>
          ${[5,4,3,2,1].map(r => `<option value="${r}" ${rating == r ? 'selected' : ''}>${r} Star${r > 1 ? 's' : ''}</option>`).join('')}</select></div>
        <div><label>Search</label><form method="GET" style="display:flex;gap:6px"><input type="text" name="search" value="${esc(search || '')}" placeholder="Search comments..." style="width:220px"><button class="btn btn-sm btn-blue" type="submit">🔍</button></form></div>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="fb-table">
        <thead><tr><th>Form</th><th>Rating</th><th>NPS</th><th>Sentiment</th><th>Respondent</th><th>Comment</th><th>Submitted</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#94a3b8;padding:30px">No responses found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('All Responses', html, user, req));
  }));

  // ============================================================
  // ROUTE 11: GET /feedback/report — Analytics
  // ============================================================
  app.get('/feedback/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const allResponses = (await pool.query('SELECT fr.*, ff.title as form_title, ff.type as form_type FROM feedback_responses fr JOIN feedback_forms ff ON ff.id=fr.form_id WHERE fr.tenant_id=$1', [tid])).rows;

    // Rating stats
    const rated = allResponses.filter(r => r.rating);
    const avgR = rated.length ? (rated.reduce((s, r) => s + r.rating, 0) / rated.length).toFixed(1) : 0;
    const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    rated.forEach(r => { if (dist[r.rating] !== undefined) dist[r.rating]++; });
    const maxD = Math.max(...Object.values(dist), 1);

    // NPS breakdown
    const npsAll = allResponses.filter(r => r.nps_score !== null && r.nps_score !== undefined);
    const promoters = npsAll.filter(r => r.nps_score >= 9).length;
    const passives = npsAll.filter(r => r.nps_score >= 7 && r.nps_score <= 8).length;
    const detractors = npsAll.filter(r => r.nps_score <= 6).length;
    const npsTotal = npsAll.length || 1;
    const npsScore = Math.round((promoters - detractors) / npsTotal * 100);

    // Trend: responses per day (last 30 days)
    const trendData = (await pool.query(
      `SELECT DATE(submitted_at) as day, COUNT(*)::int as cnt, ROUND(AVG(rating)::numeric, 1) as avg_r
       FROM feedback_responses WHERE tenant_id=$1 AND submitted_at > NOW() - INTERVAL '30 days'
       GROUP BY DATE(submitted_at) ORDER BY day`, [tid]
    )).rows;
    const maxTrend = Math.max(...trendData.map(t => t.cnt), 1);
    const trendHtml = trendData.map(t => `<div style="display:flex;align-items:flex-end;gap:2px;flex:1;min-width:20px;max-width:40px" title="${formatDate(t.day)}: ${t.cnt} responses, avg ${t.avg_r}">
      <div style="flex:1;background:linear-gradient(180deg,#4f46e5,#818cf8);border-radius:4px 4px 0 0;height:${Math.round(t.cnt / maxTrend * 80)}px;min-height:2px;transition:height .2s"></div>
    </div>`).join('');

    // Sentiment breakdown
    const positive = rated.filter(r => r.rating >= 4).length;
    const neutral = rated.filter(r => r.rating === 3).length;
    const negative = rated.filter(r => r.rating <= 2).length;

    // Word cloud from comments
    const comments = allResponses.map(r => r.comment).filter(Boolean).join(' ').toLowerCase();
    const stopWords = new Set(['the','a','an','is','are','was','were','be','been','being','have','has','had','do','does','did','will','would','could','should','may','might','can','shall','to','of','in','for','on','with','at','by','from','as','into','through','during','before','after','above','below','between','out','off','over','under','again','further','then','once','here','there','when','where','why','how','all','both','each','few','more','most','other','some','such','no','nor','not','only','own','same','so','than','too','very','just','because','but','and','or','if','while','that','this','it','its','i','me','my','we','our','you','your','he','she','they','them','their','what','which','who','about','up']);
    const wordFreq = {};
    comments.split(/[^a-z]+/).filter(w => w.length > 2 && !stopWords.has(w)).forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
    const topWords = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 25);
    const cloudHtml = topWords.map(([word, cnt]) => {
      const size = 12 + Math.min(cnt, 10) * 2;
      return `<span style="font-size:${size}px;padding:4px 12px">${esc(word)} <span class="muted" style="font-size:10px">(${cnt})</span></span>`;
    }).join('');

    // Per-form breakdown
    const formStats = (await pool.query(
      `SELECT ff.id, ff.title, ff.type, COUNT(fr.id)::int as total, ROUND(AVG(fr.rating)::numeric, 1) as avg_rating, ROUND(AVG(fr.nps_score)::numeric, 1) as avg_nps
       FROM feedback_forms ff LEFT JOIN feedback_responses fr ON fr.form_id = ff.id
       WHERE ff.tenant_id=$1 GROUP BY ff.id ORDER BY total DESC`, [tid]
    )).rows;

    const html = FB_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('report')}
      <div style="margin-bottom:20px"><h1 style="font-size:24px;color:#1e293b">📈 Feedback Analytics</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Insights and trends from all feedback</p></div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#059669">${allResponses.length}</div><div class="muted">Total Responses</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${avgR} ★</div><div class="muted">Avg Rating</div></div>
        <div class="stat-card"><div class="stat-num" style="color:${npsScore >= 0 ? '#16a34a' : '#dc2626'}">${npsScore}</div><div class="muted">NPS Score</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${formStats.length}</div><div class="muted">Active Forms</div></div>
      </div>
      <div class="fb-grid-3" style="margin-bottom:16px">
        ${[{l:'😊 Positive',v:positive,c:'#16a34a'},{l:'😐 Neutral',v:neutral,c:'#f59e0b'},{l:'😞 Negative',v:negative,c:'#dc2626'}].map(s=>
          `<div class="card grid" style="padding:20px;text-align:center"><h3 style="font-size:14px;color:#1e293b;margin:0 0 8px">${s.l}</h3><div style="font-size:32px;font-weight:800;color:${s.c}">${s.v}</div>${progressBar(rated.length?Math.round(s.v/rated.length*100):0,s.c)}</div>`).join('')}
      </div>
      <div class="fb-grid" style="margin-bottom:16px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">⭐ Rating Distribution</h3>
          ${Object.entries(dist).reverse().map(([star, cnt]) => {
            const pct = rated.length ? Math.round(cnt / rated.length * 100) : 0;
            return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="font-size:14px;color:#f59e0b;min-width:50px">${'★'.repeat(parseInt(star))}</span>${progressBar(rated.length ? Math.round(cnt / maxD * 100) : 0, '#f59e0b')}<span style="font-size:12px;font-weight:700;min-width:50px">${cnt} (${pct}%)</span></div>`;
          }).join('')}
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📊 NPS Breakdown</h3>
          ${[{l:'Promoters (9-10)',v:promoters,c:'#16a34a'},{l:'Passives (7-8)',v:passives,c:'#f59e0b'},{l:'Detractors (0-6)',v:detractors,c:'#dc2626'}].map(s=>
            `<div style="margin-bottom:10px">${progressBar(npsAll.length?Math.round(s.v/npsTotal*100):0,s.c)}<span style="font-size:12px;color:${s.c};font-weight:600">${s.l}: ${s.v}</span></div>`).join('')}
          <div style="margin-top:12px;padding:14px;background:#f8fafc;border-radius:10px;text-align:center">
            <span class="muted" style="font-size:12px">Net Promoter Score</span>
            <div style="font-size:36px;font-weight:800;color:${npsScore >= 50 ? '#16a34a' : npsScore >= 0 ? '#f59e0b' : '#dc2626'}">${npsScore}</div>
          </div>
        </div>
      </div>
      <div class="fb-grid" style="margin-bottom:16px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📅 Response Trend (Last 30 Days)</h3>
          <div style="display:flex;align-items:flex-end;gap:3px;height:100px;padding:10px 0">${trendHtml || '<p class="muted" style="margin:auto">No data</p>'}</div>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">💬 Word Cloud (from comments)</h3>
          <div class="fb-cloud">${cloudHtml || '<span class="muted">No comments to analyze</span>'}</div>
        </div>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">📋 Per-Form Performance</h3>
        <div style="overflow-x:auto"><table class="fb-table">
          <thead><tr><th>Form</th><th>Type</th><th>Responses</th><th>Avg Rating</th><th>Avg NPS</th></tr></thead>
          <tbody>${formStats.map(f => `<tr>
            <td><a href="/feedback/forms/${f.id}" style="color:#4f46e5;text-decoration:none;font-weight:600">${esc(f.title)}</a></td>
            <td>${typeBadge(f.type)}</td>
            <td><strong>${f.total}</strong></td>
            <td>${f.avg_rating ? `${f.avg_rating} ★` : '-'}</td>
            <td>${f.avg_nps ? f.avg_nps : '-'}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Feedback Analytics', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: GET /feedback/categories — Category Management
  // ============================================================
  app.get('/feedback/categories', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const categories = (await pool.query('SELECT * FROM feedback_categories WHERE tenant_id=$1 ORDER BY name', [tid])).rows;
    const rows = categories.map(c => `<div class="card" style="padding:16px;display:flex;justify-content:space-between;align-items:center">
        <div style="display:flex;align-items:center;gap:10px">
          ${categoryDot(c.color)}
          <div><strong style="font-size:14px;color:#1e293b">${esc(c.name)}</strong>
            <div class="muted" style="font-size:11px">Created ${formatDate(c.created_at)}</div></div>
        </div>
        <span class="badge" style="background:#f1f5f9;color:#64748b">${esc(c.color)}</span>
      </div>`).join('');

    const html = FB_CSS + `<div style="max-width:800px;margin:0 auto">
      ${nav('cats')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📂 Feedback Categories</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Organize feedback into meaningful groups</p></div>
      </div>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">+ Add Category</h3>
        <form method="POST" action="/feedback/categories/add" class="fb-form" style="display:flex;gap:12px;align-items:end;flex-wrap:wrap">
          <div style="flex:1;min-width:200px"><label>Category Name</label><input type="text" name="name" required placeholder="e.g., Product Quality"></div>
          <div style="min-width:120px"><label>Color</label><input type="color" name="color" value="#3b82f6" style="width:100%;height:42px;padding:4px;border:2px solid #e2e8f0;border-radius:10px;cursor:pointer"></div>
          <button type="submit" class="btn btn-green" style="height:42px;padding:0 24px">Add</button>
        </form>
      </div>
      ${rows || '<div class="card" style="text-align:center;padding:40px"><p class="muted">No categories yet. Add one above.</p></div>'}
    </div>`;
    res.send(renderPage('Feedback Categories', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: POST /feedback/categories/add — Add Category
  // ============================================================
  app.post('/feedback/categories/add', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { name, color } = req.body;
    if (!name || !name.trim()) return res.redirect('/feedback/categories');
    await pool.query('INSERT INTO feedback_categories (tenant_id, name, color) VALUES ($1,$2,$3)', [tid, name.trim(), color || '#3b82f6']);
    console.log(`[Feedback] Category "${name.trim()}" added by ${user.email}`);
    res.redirect('/feedback/categories');
  }));

  // ============================================================
  console.log('[Feedback] Feedback system loaded');
};
