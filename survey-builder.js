// ============================================================
// SURVEY BUILDER MODULE — SSEWASSWA Comfort Platform
// Create surveys, build questions, collect public responses,
// analyze results, share via unique links, export CSV.
// ============================================================
// Usage in server.js:
//   const surveyBuilder = require('./survey-builder');
//   surveyBuilder(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt);
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
const formatDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const formatDateTime = d => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
const generateCode = () => Math.random().toString(36).substring(2, 10).toUpperCase();

const QUESTION_TYPES = [
  { value: 'text', label: 'Text (Long)' }, { value: 'multiple_choice', label: 'Multiple Choice' },
  { value: 'checkbox', label: 'Checkboxes' }, { value: 'rating', label: 'Rating (1-5 Stars)' },
  { value: 'yes_no', label: 'Yes / No' }, { value: 'date', label: 'Date' },
  { value: 'email', label: 'Email' }, { value: 'number', label: 'Number' }
];

const SB_CSS = `<style>
.sb-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px}
.sb-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center;transition:.15s}
.sb-stat:hover{box-shadow:0 2px 12px rgba(0,0,0,.06)}
.sb-stat-val{font-size:28px;font-weight:800;color:#1e293b}
.sb-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
.sb-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.sb-btn:hover{opacity:.9;transform:translateY(-1px)}
.sb-btn-primary{background:#4f46e5;color:#fff}.sb-btn-success{background:#059669;color:#fff}
.sb-btn-danger{background:#fee2e2;color:#dc2626}.sb-btn-secondary{background:#f1f5f9;color:#475569}
.sb-table{width:100%;border-collapse:collapse;font-size:13px}
.sb-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.sb-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.sb-table tr:hover{background:#f8fafc}
.sb-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
.sb-card{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:22px;transition:.2s}
.sb-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.06)}
.sb-builder{display:grid;grid-template-columns:1fr 1fr;gap:20px}
.sb-preview{position:sticky;top:20px}
.sb-question{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:16px;margin-bottom:12px}
.sb-bar{height:24px;border-radius:6px;min-width:2px;transition:width .3s}
@media(max-width:768px){.sb-builder{grid-template-columns:1fr}.sb-stats{grid-template-columns:1fr 1fr}.sb-cards{grid-template-columns:1fr}}
@media print{.sb-no-print{display:none!important}}
</style>`;

function statusBadge(status) {
  const m = { open: { bg: '#dcfce7', c: '#16a34a' }, closed: { bg: '#fee2e2', c: '#dc2626' }, draft: { bg: '#f1f5f9', c: '#64748b' } };
  const s = m[status] || m.draft;
  return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${s.bg};color:${s.c}">${status.charAt(0).toUpperCase() + status.slice(1)}</span>`;
}

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function surveyBuilder(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt) {
  if (!esc) esc = s => String(s == null ? '' : typeof s === 'object' ? JSON.stringify(s) : s).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  if (!ah) ah = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'SurveyBuilder', `CREATE TABLE IF NOT EXISTS surveys (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, title TEXT NOT NULL, description TEXT, questions JSONB, is_active BOOLEAN DEFAULT true, responses_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await migrateQuery(pool, 'SurveyBuilder', `CREATE TABLE IF NOT EXISTS survey_responses (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, survey_id INTEGER REFERENCES surveys(id) ON DELETE CASCADE, respondent_email TEXT, answers JSONB, submitted_at TIMESTAMPTZ DEFAULT NOW())`);
      await migrateQuery(pool, 'SurveyBuilder', `CREATE TABLE IF NOT EXISTS survey_questions (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, survey_id INTEGER REFERENCES surveys(id) ON DELETE CASCADE, question_text TEXT NOT NULL, question_type VARCHAR(30) NOT NULL DEFAULT 'text', options JSONB DEFAULT '[]'::jsonb, is_required BOOLEAN DEFAULT false, sort_order INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
      await migrateQuery(pool, 'SurveyBuilder', `CREATE TABLE IF NOT EXISTS survey_answers (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, response_id INTEGER REFERENCES survey_responses(id) ON DELETE CASCADE, question_id INTEGER REFERENCES survey_questions(id) ON DELETE CASCADE, answer_text TEXT, answer_json JSONB)`);
      await migrateQuery(pool, 'SurveyBuilder', `CREATE TABLE IF NOT EXISTS survey_share_links (id SERIAL PRIMARY KEY, tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE, survey_id INTEGER REFERENCES surveys(id) ON DELETE CASCADE, share_code VARCHAR(20) UNIQUE NOT NULL, is_active BOOLEAN DEFAULT true, expires_at TIMESTAMPTZ, max_responses INTEGER, response_count INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
      // Extend surveys table with extra columns if missing
      try { await migrateQuery(pool, 'SurveyBuilder', `ALTER TABLE surveys ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'draft'`); } catch(e){}
      try { await migrateQuery(pool, 'SurveyBuilder', `ALTER TABLE surveys ADD COLUMN IF NOT EXISTS welcome_message TEXT`); } catch(e){}
      try { await migrateQuery(pool, 'SurveyBuilder', `ALTER TABLE surveys ADD COLUMN IF NOT EXISTS deadline TIMESTAMPTZ`); } catch(e){}
      await migrateQuery(pool, 'SurveyBuilder', `CREATE INDEX IF NOT EXISTS idx_sq_tenant ON survey_questions(tenant_id)`);
      await migrateQuery(pool, 'SurveyBuilder', `CREATE INDEX IF NOT EXISTS idx_sq_survey ON survey_questions(survey_id)`);
      await migrateQuery(pool, 'SurveyBuilder', `CREATE INDEX IF NOT EXISTS idx_sa_tenant ON survey_answers(tenant_id)`);
      await migrateQuery(pool, 'SurveyBuilder', `CREATE INDEX IF NOT EXISTS idx_sa_response ON survey_answers(response_id)`);
      await migrateQuery(pool, 'SurveyBuilder', `CREATE INDEX IF NOT EXISTS idx_ssl_code ON survey_share_links(share_code)`);
      logger.info('[SurveyBuilder] Migrations applied');
    } catch (e) { logger.error({ msg: '[SurveyBuilder] Migration error', error: e.message }); }
  })();

  // ============================================================
  // ROUTE 1: GET /surveys — Survey Dashboard
  // ============================================================
  app.get('/surveys', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id;
    const surveys = (await pool.query('SELECT s.*, (SELECT COUNT(*) FROM survey_share_links ssl WHERE ssl.survey_id=s.id AND ssl.is_active=true) as share_links FROM surveys s WHERE s.tenant_id=$1 ORDER BY s.created_at DESC', [tid])).rows;
    const totalResponses = surveys.reduce((a, s) => a + (s.responses_count || 0), 0);
    const activeCount = surveys.filter(s => s.is_active).length;
    const avgRate = surveys.length ? Math.round(surveys.reduce((a, s) => a + (s.responses_count || 0), 0) / surveys.length) : 0;

    const nav = `<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap"><a href="/surveys" class="sb-btn sb-btn-primary">📋 Dashboard</a><a href="/surveys/new" class="sb-btn sb-btn-secondary">+ New Survey</a></div>`;
    const cards = surveys.map(s => {
      const st = s.status || (s.is_active ? 'open' : 'closed');
      return `<div class="sb-card">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px">
          <h3 style="margin:0;font-size:16px;color:#1e293b">${esc(s.title)}</h3>
          ${statusBadge(st)}
        </div>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:12px;line-height:1.5">${esc(s.description || 'No description')}</p>
        <div style="display:flex;gap:16px;font-size:12px;color:#64748b;margin-bottom:14px">
          <span>📊 ${s.responses_count || 0} responses</span>
          <span>📅 ${formatDate(s.created_at)}</span>
          <span>🔗 ${s.share_links || 0} links</span>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <a href="/surveys/${s.id}/build" class="sb-btn sb-btn-secondary" style="font-size:11px;padding:6px 12px">🔨 Build</a>
          <a href="/surveys/${s.id}" class="sb-btn sb-btn-secondary" style="font-size:11px;padding:6px 12px">👁 View</a>
          <a href="/surveys/${s.id}/results" class="sb-btn sb-btn-secondary" style="font-size:11px;padding:6px 12px">📈 Results</a>
          <a href="/surveys/${s.id}/share" class="sb-btn sb-btn-secondary" style="font-size:11px;padding:6px 12px">🔗 Share</a>
          <a href="/surveys/${s.id}/analyze" class="sb-btn sb-btn-secondary" style="font-size:11px;padding:6px 12px">🔍 Analyze</a>
        </div>
      </div>`;
    }).join('');

    const html = SB_CSS + nav + `
    <div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📋 Survey Builder</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Create surveys, collect responses, analyze results</p></div>
        <a href="/surveys/new" class="sb-btn sb-btn-primary">+ Create Survey</a>
      </div>
      <div class="sb-stats">
        <div class="sb-stat"><div class="sb-stat-val" style="color:#4f46e5">${surveys.length}</div><div class="sb-stat-lbl">Total Surveys</div></div>
        <div class="sb-stat"><div class="sb-stat-val" style="color:#059669">${totalResponses}</div><div class="sb-stat-lbl">Total Responses</div></div>
        <div class="sb-stat"><div class="sb-stat-val" style="color:#f59e0b">${activeCount}</div><div class="sb-stat-lbl">Active Surveys</div></div>
        <div class="sb-stat"><div class="sb-stat-val" style="color:#8b5cf6">${avgRate}</div><div class="sb-stat-lbl">Avg Responses/Survey</div></div>
      </div>
      ${surveys.length ? `<div class="sb-cards">${cards}</div>` : '<div class="card" style="text-align:center;padding:48px"><p style="font-size:18px;color:#64748b;margin-bottom:16px">No surveys yet</p><a href="/surveys/new" class="sb-btn sb-btn-primary">Create Your First Survey</a></div>'}
    </div>`;
    res.send(renderPage('Survey Dashboard', html, u));
  }));

  // ============================================================
  // ROUTE 2: GET /surveys/new — Create Survey Form
  // ============================================================
  app.get('/surveys/new', requireAuth, ah(async (req, res) => {
    const u = req.session.user;
    const html = SB_CSS + `<div style="max-width:700px;margin:0 auto">
      <a href="/surveys" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Surveys</a>
      <div class="card" style="padding:28px">
        <h2 style="margin-bottom:4px;color:#1e293b">📝 Create New Survey</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Fill in the details below to get started</p>
        <form method="POST" action="/surveys/save" style="display:flex;flex-direction:column;gap:18px">
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Survey Title *</label>
            <input type="text" name="title" required placeholder="e.g., Parent Satisfaction Survey" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Description</label>
            <textarea name="description" rows="3" placeholder="Brief description of this survey..." style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Welcome Message</label>
            <textarea name="welcome_message" rows="2" placeholder="Shown to respondents at the top..." style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Deadline (optional)</label>
            <input type="datetime-local" name="deadline" style="width:100%;padding:11px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:6px">Initial Status</label>
            <select name="status" style="padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
              <option value="draft">Draft</option><option value="open">Open</option><option value="closed">Closed</option></select></div>
          <button type="submit" class="sb-btn sb-btn-primary" style="padding:14px 28px;font-size:15px;justify-content:center">🚀 Create Survey</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Survey', html, u));
  }));

  // ============================================================
  // ROUTE 3: POST /surveys/save — Save Survey
  // ============================================================
  app.post('/surveys/save', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id;
    const { title, description, welcome_message, deadline, status } = req.body;
    if (!title || !title.trim()) return res.redirect('/surveys/new');
    const isActive = status === 'open';
    await pool.query('INSERT INTO surveys(tenant_id,title,description,welcome_message,deadline,status,is_active) VALUES($1,$2,$3,$4,$5,$6,$7)',
      [tid, title.trim(), (description || '').trim(), (welcome_message || '').trim(), deadline || null, status || 'draft', isActive]);
    audit(u.email, 'survey_created', `Created survey: ${title.trim()}`);
    logger.info({ msg: '[SurveyBuilder] Survey created', title: title.trim(), by: u.email });
    res.redirect('/surveys');
  }));

  // ============================================================
  // ROUTE 4: GET /surveys/:id/build — Survey Question Builder
  // ============================================================
  app.get('/surveys/:id/build', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const survey = (await pool.query('SELECT * FROM surveys WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!survey) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Survey not found</h2><a href="/surveys" class="sb-btn sb-btn-primary" style="margin-top:12px">← Back</a></div>', u));
    const questions = (await pool.query('SELECT * FROM survey_questions WHERE survey_id=$1 AND tenant_id=$2 ORDER BY sort_order, id', [id, tid])).rows;

    const typeOptions = QUESTION_TYPES.map(t => `<option value="${t.value}">${esc(t.label)}</option>`).join('');
    const questionList = questions.map((q, i) => `
      <div class="sb-question" id="q-${q.id}" style="border-left:4px solid ${q.is_required ? '#f59e0b' : '#e2e8f0'}">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Q${i + 1} · ${esc(q.question_type.replace('_', ' '))}</span>
          <div style="display:flex;gap:4px">
            ${i > 0 ? `<button type="button" class="sb-btn sb-btn-secondary" style="padding:3px 8px;font-size:10px" onclick="moveQ(${q.id},${q.sort_order},'up')">↑</button>` : ''}
            ${i < questions.length - 1 ? `<button type="button" class="sb-btn sb-btn-secondary" style="padding:3px 8px;font-size:10px" onclick="moveQ(${q.id},${q.sort_order},'down')">↓</button>` : ''}
            <button type="button" class="sb-btn sb-btn-danger" style="padding:3px 8px;font-size:10px" onclick="removeQ(${q.id})">✕</button>
          </div>
        </div>
        <input type="hidden" name="q_id" value="${q.id}">
        <input type="text" name="q_text" value="${esc(q.question_text)}" placeholder="Question text..." style="width:100%;padding:9px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:8px">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <select name="q_type" style="padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px">${QUESTION_TYPES.map(t => `<option value="${t.value}" ${q.question_type === t.value ? 'selected' : ''}>${esc(t.label)}</option>`).join('')}</select>
          ${(q.question_type === 'multiple_choice' || q.question_type === 'checkbox') ? `<input type="text" name="q_options" value="${esc(Array.isArray(q.options) ? q.options.join(', ') : '')}" placeholder="Option1, Option2, Option3" style="flex:1;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px">` : ''}
          <label style="font-size:12px;color:#475569;display:flex;align-items:center;gap:4px"><input type="checkbox" name="q_required" value="1" ${q.is_required ? 'checked' : ''} style="accent-color:#f59e0b"> Required</label>
        </div>
      </div>`).join('');

    const previewHtml = questions.map((q, i) => {
      let input = '';
      if (q.question_type === 'text') input = '<textarea rows="3" style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;resize:vertical" disabled></textarea>';
      else if (q.question_type === 'multiple_choice') input = (Array.isArray(q.options) ? q.options : []).map(o => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;color:#475569"><input type="radio" disabled> ${esc(o)}</label>`).join('');
      else if (q.question_type === 'checkbox') input = (Array.isArray(q.options) ? q.options : []).map(o => `<label style="display:flex;align-items:center;gap:8px;padding:6px 0;font-size:13px;color:#475569"><input type="checkbox" disabled> ${esc(o)}</label>`).join('');
      else if (q.question_type === 'rating') input = '<span style="color:#f59e0b;font-size:24px;letter-spacing:4px">★ ★ ★ ★ ★</span>';
      else if (q.question_type === 'yes_no') input = '<label style="display:flex;gap:12px;font-size:13px;color:#475569"><input type="radio" disabled> Yes &nbsp; <input type="radio" disabled> No</label>';
      else if (q.question_type === 'date') input = '<input type="date" disabled style="padding:8px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">';
      else if (q.question_type === 'email') input = '<input type="email" placeholder="email@example.com" disabled style="width:100%;padding:8px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">';
      else if (q.question_type === 'number') input = '<input type="number" disabled style="width:200px;padding:8px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px">';
      return `<div style="margin-bottom:20px;padding:14px;background:#f8fafc;border-radius:10px">
        <label style="font-size:14px;font-weight:600;color:#1e293b;display:block;margin-bottom:8px">${i + 1}. ${esc(q.question_text)}${q.is_required ? ' <span style="color:#dc2626">*</span>' : ''}</label>
        ${input}</div>`;
    }).join('');

    const html = SB_CSS + `<div style="max-width:1400px;margin:0 auto">
      <a href="/surveys" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Surveys</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">🔨 ${esc(survey.title)}</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Build and arrange your questions</p></div>
        <div style="display:flex;gap:8px">
          <a href="/surveys/${id}/share" class="sb-btn sb-btn-secondary">🔗 Share</a>
          <a href="/surveys/${id}" class="sb-btn sb-btn-secondary">👁 View</a>
        </div>
      </div>
      <div class="sb-builder">
        <div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
            <h3 style="font-size:15px;color:#1e293b;margin:0">Questions (${questions.length})</h3>
            <button type="button" class="sb-btn sb-btn-success" style="padding:6px 14px;font-size:12px" onclick="addQuestion()">+ Add Question</button>
          </div>
          <form id="builder-form" method="POST" action="/surveys/${id}/questions/save">
            <div id="questions-list">${questionList || '<div style="text-align:center;padding:40px;color:#94a3b8"><p>No questions yet. Click "+ Add Question" to start.</p></div>'}</div>
            <div style="margin-top:16px"><button type="submit" class="sb-btn sb-btn-primary" style="padding:12px 28px;justify-content:center">💾 Save All Questions</button></div>
          </form>
        </div>
        <div class="sb-preview">
          <div class="card" style="padding:20px">
            <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">👁 Live Preview</h3>
            ${survey.welcome_message ? `<div style="padding:12px;background:#eef2ff;border-radius:8px;margin-bottom:16px;font-size:13px;color:#4f46e5">${esc(survey.welcome_message)}</div>` : ''}
            ${previewHtml || '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:40px">Questions will appear here as you add them</p>'}
          </div>
        </div>
      </div>
    </div>
    <script>
      let qCounter = ${questions.length || 0};
      function addQuestion(){qCounter++;const d=document.createElement('div');d.className='sb-question';d.id='q-new-'+qCounter;
        d.innerHTML='<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px"><span style="font-size:11px;font-weight:700;color:#64748b;text-transform:uppercase">Q'+qCounter+' (New)</span><button type="button" class="sb-btn sb-btn-danger" style="padding:3px 8px;font-size:10px" onclick="this.closest(\\'.sb-question\\').remove()">✕</button></div>'
        +'<input type="hidden" name="q_id" value="new-'+qCounter+'">'
        +'<input type="text" name="q_text" placeholder="Question text..." style="width:100%;padding:9px 12px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px;margin-bottom:8px">'
        +'<div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap"><select name="q_type" style="padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px">${typeOptions}</select><input type="text" name="q_options" placeholder="Option1, Option2 (for MC/Checkbox)" style="flex:1;padding:7px 10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px"><label style="font-size:12px;color:#475569;display:flex;align-items:center;gap:4px"><input type="checkbox" name="q_required" value="1" style="accent-color:#f59e0b"> Required</label></div>';
        document.getElementById('questions-list').appendChild(d)}
      function removeQ(id){if(confirm('Remove this question?')){const el=document.getElementById('q-'+id);if(el)el.remove()}}
      function moveQ(id,order,dir){const form=document.getElementById('builder-form');const inp=document.createElement('input');inp.type='hidden';inp.name='move';inp.value=id+':'+dir;form.appendChild(inp);form.submit()}
    </script>`;
    res.send(renderPage('Build Survey — ' + survey.title, html, u));
  }));

  // ============================================================
  // ROUTE 5: POST /surveys/:id/questions/save — Save Questions
  // ============================================================
  app.post('/surveys/:id/questions/save', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const survey = (await pool.query('SELECT id FROM surveys WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!survey) return res.redirect('/surveys');
    const { q_id, q_text, q_type, q_options, q_required, move } = req.body;
    const ids = Array.isArray(q_id) ? q_id : [q_id];
    const texts = Array.isArray(q_text) ? q_text : [q_text];
    const types = Array.isArray(q_type) ? q_type : [q_type];
    const opts = Array.isArray(q_options) ? q_options : [q_options];
    const reqs = Array.isArray(q_required) ? q_required : [q_required];

    // Handle reorder
    if (move) {
      const [qId, dir] = move.split(':');
      const qRow = (await pool.query('SELECT id, sort_order FROM survey_questions WHERE id=$1 AND tenant_id=$2', [qId, tid])).rows[0];
      if (qRow) {
        const all = (await pool.query('SELECT id, sort_order FROM survey_questions WHERE survey_id=$1 AND tenant_id=$2 ORDER BY sort_order, id', [id, tid])).rows;
        const idx = all.findIndex(q => q.id == qId);
        if ((dir === 'up' && idx > 0) || (dir === 'down' && idx < all.length - 1)) {
          const swap = all[dir === 'up' ? idx - 1 : idx + 1];
          await pool.query('UPDATE survey_questions SET sort_order=$1 WHERE id=$2', [qRow.sort_order, swap.id]);
          await pool.query('UPDATE survey_questions SET sort_order=$1 WHERE id=$2', [swap.sort_order, qId]);
        }
      }
    }

    for (let i = 0; i < ids.length; i++) {
      if (!texts[i] || !texts[i].trim()) continue;
      const isReq = reqs.includes(String(ids[i])) || reqs[i] === '1';
      const options = (types[i] === 'multiple_choice' || types[i] === 'checkbox') && opts[i] ? opts[i].split(',').map(o => o.trim()).filter(Boolean) : [];
      if (String(ids[i]).startsWith('new-')) {
        await pool.query('INSERT INTO survey_questions(tenant_id,survey_id,question_text,question_type,options,is_required,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7)',
          [tid, id, texts[i].trim(), types[i], JSON.stringify(options), isReq, i]);
      } else {
        await pool.query('UPDATE survey_questions SET question_text=$1,question_type=$2,options=$3,is_required=$4,sort_order=$5 WHERE id=$6 AND tenant_id=$7',
          [texts[i].trim(), types[i], JSON.stringify(options), isReq, i, ids[i], tid]);
      }
    }
    audit(u.email, 'survey_questions_saved', `Saved questions for survey #${id}`);
    res.redirect('/surveys/' + id + '/build');
  }));

  // ============================================================
  // ROUTE 6: GET /surveys/:id — Survey Detail
  // ============================================================
  app.get('/surveys/:id', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const survey = (await pool.query('SELECT * FROM surveys WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!survey) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Survey not found</h2><a href="/surveys" class="sb-btn sb-btn-primary" style="margin-top:12px">← Back</a></div>', u));
    const questions = (await pool.query('SELECT * FROM survey_questions WHERE survey_id=$1 ORDER BY sort_order, id', [id])).rows;
    const responses = (await pool.query('SELECT * FROM survey_responses WHERE survey_id=$1 ORDER BY submitted_at DESC', [id])).rows;
    const st = survey.status || (survey.is_active ? 'open' : 'closed');
    const completionRate = questions.length ? Math.round(responses.length / Math.max(questions.length, 1) * 100) : 0;

    const respTable = responses.map((r, ri) => `<tr>
      <td style="font-size:12px;color:#94a3b8">#${ri + 1}</td>
      <td style="font-size:13px">${esc(r.respondent_email || 'Anonymous')}</td>
      <td style="font-size:12px;color:#64748b">${formatDateTime(r.submitted_at)}</td>
      <td><a href="/surveys/${id}/results" class="sb-btn sb-btn-secondary" style="padding:3px 10px;font-size:10px">View</a></td>
    </tr>`).join('');

    const html = SB_CSS + `<div style="max-width:1000px;margin:0 auto">
      <a href="/surveys" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Surveys</a>
      <div class="card" style="padding:28px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div><h1 style="font-size:22px;color:#1e293b;margin-bottom:4px">${esc(survey.title)}</h1>
            <p style="font-size:13px;color:#94a3b8">${esc(survey.description || '')}</p>
            ${survey.welcome_message ? `<p style="font-size:13px;color:#4f46e5;margin-top:8px;padding:10px;background:#eef2ff;border-radius:8px">${esc(survey.welcome_message)}</p>` : ''}</div>
          <div style="display:flex;gap:6px">${statusBadge(st)}</div>
        </div>
      </div>
      <div class="sb-stats" style="margin-bottom:20px">
        <div class="sb-stat"><div class="sb-stat-val" style="color:#4f46e5">${questions.length}</div><div class="sb-stat-lbl">Questions</div></div>
        <div class="sb-stat"><div class="sb-stat-val" style="color:#059669">${responses.length}</div><div class="sb-stat-lbl">Responses</div></div>
        <div class="sb-stat"><div class="sb-stat-val" style="color:#f59e0b">${completionRate}%</div><div class="sb-stat-lbl">Completion Rate</div></div>
        <div class="sb-stat"><div class="sb-stat-val" style="color:#64748b">${formatDate(survey.created_at)}</div><div class="sb-stat-lbl">Created</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
        <a href="/surveys/${id}/build" class="sb-btn sb-btn-primary">🔨 Edit Questions</a>
        <a href="/surveys/${id}/results" class="sb-btn sb-btn-success">📈 View Results</a>
        <a href="/surveys/${id}/share" class="sb-btn sb-btn-secondary">🔗 Share</a>
        <a href="/surveys/${id}/analyze" class="sb-btn sb-btn-secondary">🔍 Analyze</a>
        <a href="/surveys/${id}/results/export" class="sb-btn sb-btn-secondary">📥 Export CSV</a>
      </div>
      <div class="card" style="padding:20px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📋 Questions</h3>
        ${questions.map((q, i) => `<div style="padding:10px 0;border-bottom:1px solid #f1f5f9;font-size:13px"><span style="color:#64748b;font-weight:600">Q${i + 1}.</span> ${esc(q.question_text)} <span style="color:#94a3b8;font-size:11px">(${esc(q.question_type.replace('_', ' '))})</span>${q.is_required ? ' <span style="color:#dc2626;font-size:11px">*required</span>' : ''}</div>`).join('')}
      </div>
      <div class="card" style="padding:20px;margin-top:16px">
        <h3 style="font-size:15px;color:#1e293b;margin-bottom:14px">📊 Responses (${responses.length})</h3>
        ${responses.length ? `<div style="overflow-x:auto"><table class="sb-table"><thead><tr><th>#</th><th>Respondent</th><th>Submitted</th><th>Actions</th></tr></thead><tbody>${respTable}</tbody></table></div>` : '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:20px">No responses yet</p>'}
      </div>
    </div>`;
    res.send(renderPage(survey.title, html, u));
  }));

  // ============================================================
  // ROUTE 7: GET /surveys/:id/results — Results Dashboard
  // ============================================================
  app.get('/surveys/:id/results', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const survey = (await pool.query('SELECT * FROM surveys WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!survey) return res.redirect('/surveys');
    const questions = (await pool.query('SELECT * FROM survey_questions WHERE survey_id=$1 ORDER BY sort_order, id', [id])).rows;
    const answers = (await pool.query('SELECT sa.* FROM survey_answers sa JOIN survey_responses sr ON sr.id=sa.response_id WHERE sr.survey_id=$1', [id])).rows;

    const resultsHtml = questions.map((q, qi) => {
      const qAnswers = answers.filter(a => a.question_id === q.id);
      if (!qAnswers.length) return `<div class="card" style="padding:20px;margin-bottom:14px"><h4 style="margin:0 0 8px;color:#1e293b;font-size:14px">Q${qi + 1}. ${esc(q.question_text)}</h4><p style="color:#94a3b8;font-size:12px">No answers yet</p></div>`;

      if (q.question_type === 'multiple_choice' || q.question_type === 'checkbox') {
        const counts = {};
        qAnswers.forEach(a => { (Array.isArray(a.answer_json) ? a.answer_json : a.answer_text ? [a.answer_text] : []).forEach(v => { counts[v] = (counts[v] || 0) + 1; }); });
        const max = Math.max(...Object.values(counts), 1);
        const bars = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([label, cnt]) =>
          `<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:3px"><span style="color:#475569">${esc(label)}</span><span style="font-weight:700;color:#1e293b">${cnt} (${Math.round(cnt / qAnswers.length * 100)}%)</span></div><div style="background:#f1f5f9;border-radius:6px;overflow:hidden"><div class="sb-bar" style="width:${Math.round(cnt / max * 100)}%;background:linear-gradient(90deg,#4f46e5,#818cf8)"></div></div></div>`
        ).join('');
        return `<div class="card" style="padding:20px;margin-bottom:14px"><h4 style="margin:0 0 12px;color:#1e293b;font-size:14px">Q${qi + 1}. ${esc(q.question_text)}</h4>${bars}</div>`;
      } else if (q.question_type === 'rating') {
        const counts = {}; for (let i = 1; i <= 5; i++) counts[i] = 0;
        qAnswers.forEach(a => { const v = parseInt(a.answer_text); if (v >= 1 && v <= 5) counts[v]++; });
        const max = Math.max(...Object.values(counts), 1);
        const avg = qAnswers.length ? (qAnswers.reduce((s, a) => s + (parseInt(a.answer_text) || 0), 0) / qAnswers.length).toFixed(1) : '0';
        const bars = Object.entries(counts).reverse().map(([star, cnt]) =>
          `<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px"><span style="font-size:14px;color:#f59e0b;min-width:30px">${'★'.repeat(star)}${'☆'.repeat(5 - star)}</span><div style="flex:1;background:#f1f5f9;border-radius:6px;overflow:hidden"><div class="sb-bar" style="width:${Math.round(cnt / max * 100)}%;background:linear-gradient(90deg,#f59e0b,#fbbf24)"></div></div><span style="font-size:12px;font-weight:700;color:#1e293b;min-width:30px">${cnt}</span></div>`
        ).join('');
        return `<div class="card" style="padding:20px;margin-bottom:14px"><h4 style="margin:0 0 4px;color:#1e293b;font-size:14px">Q${qi + 1}. ${esc(q.question_text)}</h4><p style="font-size:13px;color:#f59e0b;font-weight:700;margin:0 0 12px">Average: ${avg} / 5</p>${bars}</div>`;
      } else if (q.question_type === 'yes_no') {
        const yes = qAnswers.filter(a => a.answer_text === 'Yes' || a.answer_text === 'true').length;
        const no = qAnswers.length - yes;
        return `<div class="card" style="padding:20px;margin-bottom:14px"><h4 style="margin:0 0 12px;color:#1e293b;font-size:14px">Q${qi + 1}. ${esc(q.question_text)}</h4><div style="display:flex;gap:20px"><div style="text-align:center;flex:1"><div style="font-size:28px;font-weight:800;color:#059669">${yes}</div><div style="font-size:11px;color:#94a3b8">Yes (${Math.round(yes / qAnswers.length * 100)}%)</div></div><div style="text-align:center;flex:1"><div style="font-size:28px;font-weight:800;color:#dc2626">${no}</div><div style="font-size:11px;color:#94a3b8">No (${Math.round(no / qAnswers.length * 100)}%)</div></div></div></div>`;
      } else {
        const textAnswers = qAnswers.map(a => `<div style="padding:10px;background:#f8fafc;border-radius:8px;margin-bottom:6px;font-size:13px;color:#475569;border-left:3px solid #4f46e5">${esc(a.answer_text || (a.answer_json ? JSON.stringify(a.answer_json) : '—'))}</div>`).join('');
        return `<div class="card" style="padding:20px;margin-bottom:14px"><h4 style="margin:0 0 12px;color:#1e293b;font-size:14px">Q${qi + 1}. ${esc(q.question_text)} <span style="font-size:11px;color:#94a3b8">(${qAnswers.length} answers)</span></h4>${textAnswers}</div>`;
      }
    }).join('');

    const html = SB_CSS + `<div style="max-width:900px;margin:0 auto">
      <a href="/surveys/${id}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Survey</a>
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:22px;color:#1e293b">📈 Results — ${esc(survey.title)}</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${questions.length} questions · ${answers.length || 0} answers</p></div>
        <a href="/surveys/${id}/results/export" class="sb-btn sb-btn-success">📥 Export CSV</a>
      </div>
      ${resultsHtml || '<div class="card" style="text-align:center;padding:40px"><p style="color:#94a3b8">No questions or responses yet</p></div>'}
    </div>`;
    res.send(renderPage('Survey Results', html, u));
  }));

  // ============================================================
  // ROUTE 8: GET /surveys/:id/results/export — CSV Export
  // ============================================================
  app.get('/surveys/:id/results/export', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const survey = (await pool.query('SELECT * FROM surveys WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!survey) return res.redirect('/surveys');
    const questions = (await pool.query('SELECT * FROM survey_questions WHERE survey_id=$1 ORDER BY sort_order, id', [id])).rows;
    const responses = (await pool.query('SELECT * FROM survey_responses WHERE survey_id=$1 ORDER BY submitted_at', [id])).rows;
    const answers = (await pool.query('SELECT sa.* FROM survey_answers sa JOIN survey_responses sr ON sr.id=sa.response_id WHERE sr.survey_id=$1', [id])).rows;

    const header = ['Response #', 'Respondent Email', 'Submitted At', ...questions.map((q, i) => `Q${i + 1}: ${q.question_text}`)];
    const rows = responses.map((r, ri) => {
      const qAnswers = answers.filter(a => a.response_id === r.id);
      const vals = questions.map(q => {
        const ans = qAnswers.find(a => a.question_id === q.id);
        if (!ans) return '';
        if (ans.answer_json) return Array.isArray(ans.answer_json) ? ans.answer_json.join('; ') : JSON.stringify(ans.answer_json);
        return ans.answer_text || '';
      });
      return [ri + 1, r.respondent_email || 'Anonymous', r.submitted_at, ...vals];
    });
    let csv = header.map(h => '"' + h.replace(/"/g, '""') + '"').join(',') + '\n';
    rows.forEach(row => { csv += row.map(v => '"' + String(v || '').replace(/"/g, '""') + '"').join(',') + '\n'; });

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="survey-${id}-results.csv"`);
    audit(u.email, 'survey_exported', `Exported CSV for survey #${id}`);
    res.send(csv);
  }));

  // ============================================================
  // ROUTE 9: GET /surveys/:id/share — Share Survey Page
  // ============================================================
  app.get('/surveys/:id/share', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const survey = (await pool.query('SELECT * FROM surveys WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!survey) return res.redirect('/surveys');
    const links = (await pool.query('SELECT * FROM survey_share_links WHERE survey_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [id, tid])).rows;
    const baseUrl = (req.protocol + '://' + req.get('host'));

    const linksList = links.map(l => {
      const url = `${baseUrl}/s/${l.share_code}`;
      const expired = l.expires_at && new Date(l.expires_at) < new Date();
      return `<div class="card" style="padding:16px;margin-bottom:10px;border-left:4px solid ${l.is_active && !expired ? '#059669' : '#dc2626'}">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div>
            <div style="font-family:monospace;font-size:13px;color:#4f46e5;margin-bottom:4px">${esc(url)}</div>
            <div style="font-size:11px;color:#94a3b8">Responses: ${l.response_count || 0}${l.max_responses ? ' / ' + l.max_responses : ''} ${expired ? ' · <span style="color:#dc2626">Expired</span>' : ''} ${l.expires_at && !expired ? ' · Expires: ' + formatDate(l.expires_at) : ''}</div>
          </div>
          <div style="display:flex;gap:6px">
            <button class="sb-btn sb-btn-secondary" style="padding:5px 12px;font-size:11px" onclick="navigator.clipboard.writeText('${url}');this.textContent='Copied!'">📋 Copy</button>
            <button class="sb-btn sb-btn-secondary" style="padding:5px 12px;font-size:11px" onclick="printSurvey('${l.share_code}')">🖨 Print</button>
          </div>
        </div>
      </div>`;
    }).join('');

    const embedCode = links.length ? `<div class="card" style="padding:16px;margin-top:16px">
      <h4 style="margin:0 0 8px;font-size:14px;color:#1e293b">Embed Code</h4>
      <textarea readonly style="width:100%;height:60px;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:12px;font-family:monospace" onclick="this.select()">&lt;iframe src="${baseUrl}/s/${links[0].share_code}" width="100%" height="600" frameborder="0"&gt;&lt;/iframe&gt;</textarea>
    </div>` : '';

    const html = SB_CSS + `<div style="max-width:800px;margin:0 auto">
      <a href="/surveys/${id}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Survey</a>
      <h1 style="font-size:22px;color:#1e293b;margin-bottom:4px">🔗 Share Survey</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">${esc(survey.title)}</p>
      <div class="card" style="padding:20px;margin-bottom:20px">
        <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Generate Share Link</h3>
        <form method="POST" action="/surveys/${id}/share/generate" style="display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:end">
          <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Expires At (optional)</label>
            <input type="datetime-local" name="expires_at" style="width:100%;padding:9px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"></div>
          <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Max Responses (optional)</label>
            <input type="number" name="max_responses" min="1" placeholder="Unlimited" style="width:100%;padding:9px;border:2px solid #e2e8f0;border-radius:8px;font-size:13px"></div>
          <div style="grid-column:1/-1"><button type="submit" class="sb-btn sb-btn-primary" style="padding:11px 24px">🔗 Generate New Link</button></div>
        </form>
      </div>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="margin:0 0 12px;font-size:15px;color:#1e293b">Active Links (${links.filter(l => l.is_active).length})</h3>
        ${linksList || '<p style="color:#94a3b8;font-size:13px;text-align:center;padding:16px">No share links yet. Generate one above.</p>'}
      </div>
      ${embedCode}
    </div>
    <script>function printSurvey(code){window.open('/s/'+code+'?print=1','_blank')}</script>`;
    res.send(renderPage('Share Survey', html, u));
  }));

  // ============================================================
  // ROUTE 10: POST /surveys/:id/share/generate — Generate Link
  // ============================================================
  app.post('/surveys/:id/share/generate', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const survey = (await pool.query('SELECT id FROM surveys WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!survey) return res.redirect('/surveys');
    let code = generateCode();
    while ((await pool.query('SELECT 1 FROM survey_share_links WHERE share_code=$1', [code])).rows.length) code = generateCode();
    await pool.query('INSERT INTO survey_share_links(tenant_id,survey_id,share_code,is_active,expires_at,max_responses) VALUES($1,$2,$3,true,$4,$5)',
      [tid, id, code, req.body.expires_at || null, req.body.max_responses ? parseInt(req.body.max_responses) : null]);
    await pool.query('UPDATE surveys SET is_active=true, status=COALESCE(status,\'open\') WHERE id=$1 AND status=\'draft\'', [id]);
    audit(u.email, 'share_link_generated', `Generated share link ${code} for survey #${id}`);
    res.redirect('/surveys/' + id + '/share');
  }));

  // ============================================================
  // ROUTE 11: GET /s/:code — Public Survey Response Page
  // ============================================================
  app.get('/s/:code', ah(async (req, res) => {
    const code = req.params.code;
    const link = (await pool.query('SELECT * FROM survey_share_links WHERE share_code=$1', [code])).rows[0];
    if (!link) return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Survey Not Found</title></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9"><div style="text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(0,0,0,.08)"><div style="font-size:48px;margin-bottom:12px">🔍</div><h2 style="color:#1e293b;margin:0 0 8px">Survey Not Found</h2><p style="color:#94a3b8">This link may be invalid or expired.</p></div></body></html>`);
    const expired = link.expires_at && new Date(link.expires_at) < new Date();
    if (!link.is_active || expired) return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Survey Closed</title></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9"><div style="text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(0,0,0,.08)"><div style="font-size:48px;margin-bottom:12px">🔒</div><h2 style="color:#1e293b;margin:0 0 8px">Survey Closed</h2><p style="color:#94a3b8">This survey is no longer accepting responses.</p></div></body></html>`);
    const survey = (await pool.query('SELECT * FROM surveys WHERE id=$1', [link.survey_id])).rows[0];
    const questions = (await pool.query('SELECT * FROM survey_questions WHERE survey_id=$1 ORDER BY sort_order, id', [link.survey_id])).rows;
    if (!survey || !questions.length) return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>No Questions</title></head><body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9"><div style="text-align:center;padding:40px;background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(0,0,0,.08)"><div style="font-size:48px;margin-bottom:12px">📋</div><h2 style="color:#1e293b;margin:0 0 8px">Coming Soon</h2><p style="color:#94a3b8">This survey has no questions yet.</p></div></body></html>`);

    const isPrint = req.query.print === '1';
    const questionFields = questions.map((q, i) => {
      let input = '';
      if (q.question_type === 'text') input = `<textarea name="answer_${q.id}" rows="3" ${q.is_required ? 'required' : ''} style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px;resize:vertical"></textarea>`;
      else if (q.question_type === 'multiple_choice') input = (Array.isArray(q.options) ? q.options : []).map(o => `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;font-size:14px;color:#475569;cursor:pointer"><input type="radio" name="answer_${q.id}" value="${esc(o)}" ${q.is_required ? 'required' : ''} style="accent-color:#4f46e5;width:18px;height:18px"> ${esc(o)}</label>`).join('');
      else if (q.question_type === 'checkbox') input = (Array.isArray(q.options) ? q.options : []).map(o => `<label style="display:flex;align-items:center;gap:10px;padding:8px 0;font-size:14px;color:#475569;cursor:pointer"><input type="checkbox" name="answer_${q.id}" value="${esc(o)}" style="accent-color:#4f46e5;width:18px;height:18px"> ${esc(o)}</label>`).join('');
      else if (q.question_type === 'rating') input = `<div style="display:flex;gap:6px;font-size:32px">${[1,2,3,4,5].map(n => `<label style="cursor:pointer;color:#e2e8f0" title="${n}"><input type="radio" name="answer_${q.id}" value="${n}" ${q.is_required ? 'required' : ''} style="display:none" onchange="this.closest('div').querySelectorAll('label').forEach((l,i)=>l.style.color=i<${n}?'#f59e0b':'#e2e8f0')">★</label>`).join('')}</div>`;
      else if (q.question_type === 'yes_no') input = `<div style="display:flex;gap:16px"><label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer"><input type="radio" name="answer_${q.id}" value="Yes" ${q.is_required ? 'required' : ''} style="accent-color:#059669;width:18px;height:18px"> Yes</label><label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer"><input type="radio" name="answer_${q.id}" value="No" ${q.is_required ? 'required' : ''} style="accent-color:#dc2626;width:18px;height:18px"> No</label></div>`;
      else if (q.question_type === 'date') input = `<input type="date" name="answer_${q.id}" ${q.is_required ? 'required' : ''} style="padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">`;
      else if (q.question_type === 'email') input = `<input type="email" name="answer_${q.id}" placeholder="email@example.com" ${q.is_required ? 'required' : ''} style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">`;
      else if (q.question_type === 'number') input = `<input type="number" name="answer_${q.id}" ${q.is_required ? 'required' : ''} style="width:220px;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px">`;
      return `<div style="margin-bottom:24px"><label style="font-size:15px;font-weight:600;color:#1e293b;display:block;margin-bottom:8px">${i + 1}. ${esc(q.question_text)}${q.is_required ? ' <span style="color:#dc2626">*</span>' : ''}</label>${input}</div>`;
    }).join('');

    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(survey.title)}</title>${SB_CSS}</head>
    <body style="font-family:system-ui,-apple-system,sans-serif;background:#f1f5f9;margin:0;padding:20px">
    <div style="max-width:640px;margin:40px auto;background:#fff;border-radius:16px;padding:36px;box-shadow:0 2px 20px rgba(0,0,0,.06)">
      <h1 style="font-size:22px;color:#1e293b;margin:0 0 8px;text-align:center">${esc(survey.title)}</h1>
      ${survey.welcome_message ? `<p style="text-align:center;color:#4f46e5;font-size:14px;margin-bottom:20px">${esc(survey.welcome_message)}</p>` : ''}
      ${survey.description ? `<p style="text-align:center;color:#94a3b8;font-size:13px;margin-bottom:24px">${esc(survey.description)}</p>` : ''}
      ${!isPrint ? `<form method="POST" action="/s/${code}/submit">${questionFields}<div style="margin-top:8px"><button type="submit" style="width:100%;padding:14px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer">Submit Response</button></div></form>` : questionFields}
    </div></body></html>`;
    res.send(html);
  }));

  // ============================================================
  // ROUTE 12: POST /s/:code/submit — Submit Public Response
  // ============================================================
  app.post('/s/:code/submit', ah(async (req, res) => {
    const code = req.params.code;
    const link = (await pool.query('SELECT * FROM survey_share_links WHERE share_code=$1 AND is_active=true', [code])).rows[0];
    if (!link) return res.send('<h2>Invalid link</h2>');
    const expired = link.expires_at && new Date(link.expires_at) < new Date();
    if (expired) return res.send('<h2>Survey has expired</h2>');
    if (link.max_responses && link.response_count >= link.max_responses) return res.send('<h2>Maximum responses reached</h2>');
    const questions = (await pool.query('SELECT * FROM survey_questions WHERE survey_id=$1', [link.survey_id])).rows;

    const respResult = await pool.query('INSERT INTO survey_responses(tenant_id,survey_id,respondent_email,answers) VALUES($1,$2,$3,$4) RETURNING id',
      [link.tenant_id, link.survey_id, req.body.respondent_email || null, '{}']);
    const respId = respResult.rows[0].id;

    for (const q of questions) {
      let answer = req.body['answer_' + q.id];
      let textVal = '', jsonVal = null;
      if (q.question_type === 'checkbox' && Array.isArray(answer)) {
        jsonVal = answer; textVal = answer.join(', ');
      } else if (answer !== undefined && answer !== null) {
        textVal = String(answer);
      }
      if (!textVal && !jsonVal && q.is_required) continue; // skip empty required (validation could be stricter)
      await pool.query('INSERT INTO survey_answers(tenant_id,response_id,question_id,answer_text,answer_json) VALUES($1,$2,$3,$4,$5)',
        [link.tenant_id, respId, q.id, textVal, jsonVal]);
    }

    await pool.query('UPDATE survey_share_links SET response_count=response_count+1 WHERE id=$1', [link.id]);
    await pool.query('UPDATE surveys SET responses_count=COALESCE(responses_count,0)+1 WHERE id=$1', [link.survey_id]);
    logger.info({ msg: '[SurveyBuilder] Public response submitted', code, surveyId: link.survey_id });

    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Thank You</title></head>
    <body style="font-family:system-ui;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f1f5f9">
    <div style="text-align:center;padding:48px;background:#fff;border-radius:16px;box-shadow:0 2px 20px rgba(0,0,0,.08);max-width:480px">
      <div style="font-size:56px;margin-bottom:16px">✅</div>
      <h2 style="color:#1e293b;margin:0 0 8px">Thank You!</h2>
      <p style="color:#94a3b8;font-size:15px">Your response has been recorded successfully.</p>
    </div></body></html>`);
  }));

  // ============================================================
  // ROUTE: POST /surveys/:id/toggle — Toggle Survey Active/Closed
  // ============================================================
  app.post('/surveys/:id/toggle', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const survey = (await pool.query('SELECT id,is_active,status FROM surveys WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!survey) return res.redirect('/surveys');
    const newActive = !survey.is_active;
    const newStatus = newActive ? 'open' : 'closed';
    await pool.query('UPDATE surveys SET is_active=$1, status=$2 WHERE id=$3 AND tenant_id=$4', [newActive, newStatus, id, tid]);
    audit(u.email, 'survey_toggled', `${newActive ? 'Opened' : 'Closed'} survey #${id}`);
    res.redirect('/surveys/' + id);
  }));

  // ============================================================
  // ROUTE: POST /surveys/:id/share/:linkId/toggle — Toggle Share Link
  // ============================================================
  app.post('/surveys/:id/share/:linkId/toggle', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id;
    const { id, linkId } = req.params;
    await pool.query('UPDATE survey_share_links SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2', [linkId, tid]);
    audit(u.email, 'share_link_toggled', `Toggled share link #${linkId}`);
    res.redirect('/surveys/' + id + '/share');
  }));

  // ============================================================
  // ROUTE: POST /surveys/:id/delete — Delete Survey
  // ============================================================
  app.post('/surveys/:id/delete', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const survey = (await pool.query('SELECT title FROM surveys WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!survey) return res.redirect('/surveys');
    await pool.query('DELETE FROM survey_answers WHERE question_id IN (SELECT id FROM survey_questions WHERE survey_id=$1)', [id]);
    await pool.query('DELETE FROM survey_questions WHERE survey_id=$1', [id]);
    await pool.query('DELETE FROM survey_answers WHERE response_id IN (SELECT id FROM survey_responses WHERE survey_id=$1)', [id]);
    await pool.query('DELETE FROM survey_responses WHERE survey_id=$1', [id]);
    await pool.query('DELETE FROM survey_share_links WHERE survey_id=$1', [id]);
    await pool.query('DELETE FROM surveys WHERE id=$1 AND tenant_id=$2', [id, tid]);
    audit(u.email, 'survey_deleted', `Deleted survey: ${survey.title}`);
    logger.info({ msg: '[SurveyBuilder] Survey deleted', id, by: u.email });
    res.redirect('/surveys');
  }));

  // ============================================================
  // ROUTE 13: GET /surveys/:id/analyze — Analysis Page
  // ============================================================
  app.get('/surveys/:id/analyze', requireAuth, ah(async (req, res) => {
    const u = req.session.user, tid = u.tenant_id, id = req.params.id;
    const survey = (await pool.query('SELECT * FROM surveys WHERE id=$1 AND tenant_id=$2', [id, tid])).rows[0];
    if (!survey) return res.redirect('/surveys');
    const questions = (await pool.query('SELECT * FROM survey_questions WHERE survey_id=$1 ORDER BY sort_order, id', [id])).rows;
    const responses = (await pool.query('SELECT * FROM survey_responses WHERE survey_id=$1 ORDER BY submitted_at', [id])).rows;
    const answers = (await pool.query('SELECT sa.* FROM survey_answers sa JOIN survey_responses sr ON sr.id=sa.response_id WHERE sr.survey_id=$1', [id])).rows;

    // Response trend (daily)
    const dailyCounts = {};
    responses.forEach(r => { const d = r.submitted_at ? r.submitted_at.toISOString().split('T')[0] : 'unknown'; dailyCounts[d] = (dailyCounts[d] || 0) + 1; });
    const sortedDays = Object.entries(dailyCounts).sort((a, b) => a[0].localeCompare(b[0]));
    const maxDaily = Math.max(...Object.values(dailyCounts), 1);
    const trendHtml = sortedDays.map(([date, cnt]) =>
      `<div style="display:flex;align-items:center;gap:10px;margin-bottom:4px"><span style="font-size:11px;color:#64748b;min-width:80px">${date}</span><div style="flex:1;background:#f1f5f9;border-radius:6px;overflow:hidden"><div class="sb-bar" style="width:${Math.round(cnt / maxDaily * 100)}%;background:linear-gradient(90deg,#4f46e5,#818cf8)"></div></div><span style="font-size:12px;font-weight:700;min-width:20px">${cnt}</span></div>`
    ).join('');

    // Cross-tabulation for first MC/checkbox pair
    const mcQuestions = questions.filter(q => q.question_type === 'multiple_choice' || q.question_type === 'checkbox');
    let crossTabHtml = '';
    if (mcQuestions.length >= 2) {
      const q1 = mcQuestions[0], q2 = mcQuestions[1];
      const q1Opts = Array.isArray(q1.options) ? q1.options : [];
      const q2Opts = Array.isArray(q2.options) ? q2.options : [];
      const matrix = {};
      q1Opts.forEach(o1 => { matrix[o1] = {}; q2Opts.forEach(o2 => { matrix[o1][o2] = 0; }); });
      responses.forEach(r => {
        const rAnswers = answers.filter(a => a.response_id === r.id);
        const a1 = rAnswers.find(a => a.question_id === q1.id);
        const a2 = rAnswers.find(a => a.question_id === q2.id);
        if (a1 && a2) {
          const v1 = Array.isArray(a1.answer_json) ? a1.answer_json : [a1.answer_text];
          const v2 = Array.isArray(a2.answer_json) ? a2.answer_json : [a2.answer_text];
          v1.forEach(val1 => { v2.forEach(val2 => { if (matrix[val1] && matrix[val1][val2] !== undefined) matrix[val1][val2]++; }); });
        }
      });
      crossTabHtml = `<div class="card" style="padding:20px;margin-bottom:16px;overflow-x:auto">
        <h4 style="margin:0 0 12px;font-size:14px;color:#1e293b">Cross-Tabulation: Q${questions.indexOf(q1) + 1} vs Q${questions.indexOf(q2) + 1}</h4>
        <table class="sb-table"><thead><tr><th></th>${q2Opts.map(o => `<th style="text-align:center">${esc(o)}</th>`).join('')}</tr></thead>
        <tbody>${q1Opts.map(o1 => `<tr><td style="font-weight:600">${esc(o1)}</td>${q2Opts.map(o2 => `<td style="text-align:center;background:#eef2ff;border-radius:4px;font-weight:700;color:#4f46e5">${matrix[o1] ? matrix[o1][o2] || 0 : 0}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }

    // Word cloud placeholder for text responses
    const textQs = questions.filter(q => q.question_type === 'text');
    let wordCloudHtml = '';
    if (textQs.length) {
      const tq = textQs[0];
      const tAnswers = answers.filter(a => a.question_id === tq.id && a.answer_text).map(a => a.answer_text);
      const allWords = tAnswers.join(' ').toLowerCase().replace(/[^a-z\s]/g, '').split(/\s+/).filter(w => w.length > 3);
      const wordFreq = {};
      allWords.forEach(w => { wordFreq[w] = (wordFreq[w] || 0) + 1; });
      const topWords = Object.entries(wordFreq).sort((a, b) => b[1] - a[1]).slice(0, 20);
      const maxFreq = topWords.length ? topWords[0][1] : 1;
      const colors = ['#4f46e5','#818cf8','#6366f1','#a5b4fc','#c7d2fe','#059669','#f59e0b','#dc2626','#8b5cf6','#ec4899'];
      wordCloudHtml = `<div class="card" style="padding:20px;margin-bottom:16px">
        <h4 style="margin:0 0 12px;font-size:14px;color:#1e293b">Word Cloud — Q${questions.indexOf(tq) + 1}: ${esc(tq.question_text)}</h4>
        <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;justify-content:center;min-height:120px;padding:16px;background:#f8fafc;border-radius:10px">
          ${topWords.length ? topWords.map(([word, freq], i) => `<span style="font-size:${Math.max(12, Math.round(freq / maxFreq * 36))}px;font-weight:${freq > maxFreq * 0.5 ? 800 : 600};color:${colors[i % colors.length]}">${esc(word)}</span>`).join('') : '<p style="color:#94a3b8;font-size:13px">No text responses yet</p>'}
        </div>
      </div>`;
    }

    const html = SB_CSS + `<div style="max-width:1000px;margin:0 auto">
      <a href="/surveys/${id}" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Survey</a>
      <h1 style="font-size:22px;color:#1e293b;margin-bottom:4px">🔍 Analysis — ${esc(survey.title)}</h1>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">${responses.length} responses · ${questions.length} questions</p>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="margin:0 0 12px;font-size:15px;color:#1e293b">Response Trend</h3>
        ${trendHtml || '<p style="color:#94a3b8;font-size:13px">No data yet</p>'}
      </div>
      ${crossTabHtml}
      ${wordCloudHtml}
      <div class="card" style="padding:20px">
        <h3 style="margin:0 0 12px;font-size:15px;color:#1e293b">Summary Statistics</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:14px">
          <div style="padding:14px;background:#f8fafc;border-radius:10px"><div style="font-size:24px;font-weight:800;color:#4f46e5">${responses.length}</div><div style="font-size:11px;color:#94a3b8">Total Responses</div></div>
          <div style="padding:14px;background:#f8fafc;border-radius:10px"><div style="font-size:24px;font-weight:800;color:#059669">${sortedDays.length}</div><div style="font-size:11px;color:#94a3b8">Active Days</div></div>
          <div style="padding:14px;background:#f8fafc;border-radius:10px"><div style="font-size:24px;font-weight:800;color:#f59e0b">${sortedDays.length ? (responses.length / sortedDays.length).toFixed(1) : 0}</div><div style="font-size:11px;color:#94a3b8">Avg Responses/Day</div></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Survey Analysis', html, u));
  }));
};
