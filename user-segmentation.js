'use strict';
// ============================================================
// USER SEGMENTATION MODULE — School SaaS Portal
// Dynamic user segmentation engine: create segments based on
// behavior, attributes, engagement scores, then target
// announcements and features by segment.
// ============================================================
// Usage in server.js:
//   const userSegmentation = require('./user-segmentation');
//   userSegmentation(app, pool, { renderPage, esc, ah, requireAuth, audit });
// ============================================================

const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  opts = opts || {};
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const fmtDT = (d) => d ? new Date(d).toLocaleString('en-GB',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}) : '—';

  // ── Color Theme ──────────────────────────────────────────
  const P = '#4f46e5', M = '#6b7280', G = '#059669', R = '#dc2626', O = '#d97706', BL = '#2563eb';
  const PL = '#eef2ff', ML = '#f3f4f6', GL = '#d1fae5', RL = '#fee2e2', OL = '#fef3c7';

  // ── Shared CSS ───────────────────────────────────────────
  const SK_CSS = '<link rel="stylesheet" href="/css/sk.css">';
  const CSS = `<style>
    .seg-root{max-width:1200px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif}
    .seg-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;align-items:center;padding:12px 16px;background:${PL};border-radius:14px;border:1px solid #c7d2fe}
    .seg-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:${M};background:#fff;transition:.15s;border:1px solid transparent}
    .seg-nav a:hover{background:#e0e7ff;color:#312e81}
    .seg-nav a.active{background:${P};color:#fff;border-color:${P};box-shadow:0 2px 8px rgba(79,70,229,.25)}
    .seg-hero{background:linear-gradient(135deg,#312e81,${P});padding:28px 32px;border-radius:16px;margin-bottom:24px;color:#fff;position:relative;overflow:hidden}
    .seg-hero::after{content:"";position:absolute;top:-40px;right:-40px;width:200px;height:200px;border-radius:50%;background:rgba(129,140,248,.15)}
    .seg-hero h1{font-size:24px;margin:0 0 4px;position:relative;z-index:1}
    .seg-hero p{opacity:.85;margin:0;font-size:14px;position:relative;z-index:1}
    .seg-hero-actions{margin-top:14px;display:flex;gap:8px;flex-wrap:wrap;position:relative;z-index:1}
    .seg-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px}
    .seg-stat{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;text-align:center;transition:.2s}
    .seg-stat:hover{box-shadow:0 4px 24px rgba(79,70,229,.1);transform:translateY(-2px)}
    .seg-stat-val{font-size:32px;font-weight:800;color:#1e1b4b}
    .seg-stat-lbl{font-size:11px;color:${M};margin-top:4px;text-transform:uppercase;letter-spacing:.5px}
    .seg-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .seg-btn:hover{opacity:.9;transform:translateY(-1px)}
    .seg-btn-primary{background:${P};color:#fff}
    .seg-btn-danger{background:${RL};color:${R};border:1px solid #fecaca}
    .seg-btn-success{background:${GL};color:#065f46;border:1px solid #a7f3d0}
    .seg-btn-secondary{background:${ML};color:${M};border:1px solid #e5e7eb}
    .seg-btn-sm{padding:6px 12px;font-size:12px;border-radius:8px}
    .seg-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;transition:.15s}
    .seg-card:hover{box-shadow:0 4px 20px rgba(79,70,229,.06)}
    .seg-table{width:100%;border-collapse:collapse;font-size:13px}
    .seg-table th{padding:10px 14px;text-align:left;border-bottom:2px solid #e5e7eb;color:${M};font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:${ML}}
    .seg-table td{padding:10px 14px;border-bottom:1px solid #f3f4f6;color:#1e1b4b}
    .seg-table tr:hover{background:#eef2ff}
    .seg-input{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;transition:.15s;box-sizing:border-box;font-family:inherit}
    .seg-input:focus{outline:none;border-color:${P};box-shadow:0 0 0 3px ${PL}}
    .seg-select{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:13px;background:#fff;box-sizing:border-box;font-family:inherit}
    .seg-form-group{margin-bottom:16px}
    .seg-form-group label{display:block;font-size:13px;font-weight:600;color:#1e1b4b;margin-bottom:5px}
    .seg-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700}
    .seg-progress{background:#e5e7eb;border-radius:8px;height:10px;overflow:hidden;width:100%}
    .seg-progress-bar{height:100%;border-radius:8px;transition:width .4s ease}
    .seg-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:14px}
    .seg-grid-3{display:grid;grid-template-columns:repeat(3,1fr);gap:14px}
    .seg-empty{text-align:center;padding:40px;color:#9ca3af}
    .seg-alert{padding:14px 18px;border-radius:10px;font-size:13px;margin-bottom:16px;display:flex;align-items:center;gap:8px}
    .seg-alert-success{background:${GL};color:#065f46;border:1px solid #a7f3d0}
    .seg-alert-info{background:${PL};color:#312e81;border:1px solid #c7d2fe}
    .seg-alert-warn{background:${OL};color:#92400e;border:1px solid #fde68a}
    .rule-row{display:flex;gap:8px;align-items:center;padding:10px 14px;border:1px solid #e5e7eb;border-radius:10px;margin-bottom:8px;background:#fafbfc;flex-wrap:wrap}
    .rule-row select,.rule-row input{padding:7px 10px;border:2px solid #e5e7eb;border-radius:8px;font-size:12px;font-family:inherit}
    .rule-row select:focus,.rule-row input:focus{outline:none;border-color:${P}}
    .rule-andor{font-weight:800;font-size:14px;color:${P};min-width:36px;text-align:center}
    .seg-insight-bar{display:flex;align-items:center;gap:10px;margin-bottom:12px}
    .seg-insight-bar .bar{flex:1;height:28px;border-radius:8px;overflow:hidden;background:#e5e7eb}
    .seg-insight-bar .fill{height:100%;border-radius:8px;transition:width .5s ease;display:flex;align-items:center;padding-left:8px;font-size:11px;color:#fff;font-weight:700}
    ::-webkit-scrollbar{width:6px;height:6px}
    ::-webkit-scrollbar-track{background:#f1f5f9;border-radius:3px}
    ::-webkit-scrollbar-thumb{background:#c7d2fe;border-radius:3px}
    @media(max-width:768px){.seg-stats{grid-template-columns:1fr 1fr}.seg-grid-2,.seg-grid-3{grid-template-columns:1fr}.seg-nav{flex-direction:column}.seg-hero{padding:20px}.rule-row{flex-direction:column;align-items:stretch}.rule-andor{text-align:left}}
  </style>`;

  // ── Rule Types Catalog ───────────────────────────────────
  const RULE_TYPES = [
    { key:'role_is', label:'Role Is', type:'select', options:['admin','teacher','parent','student'], desc:'Match user by role' },
    { key:'class_in', label:'Class In', type:'text', placeholder:'e.g. 10-A, 10-B', desc:'Users in specific classes (comma-separated)' },
    { key:'fee_status', label:'Fee Status', type:'select', options:['paid','partial','unpaid','overdue'], desc:'Fee payment status' },
    { key:'attendance_above', label:'Attendance Above', type:'number', placeholder:'85', desc:'Minimum attendance percentage' },
    { key:'attendance_below', label:'Attendance Below', type:'number', placeholder:'50', desc:'Maximum attendance percentage' },
    { key:'grade_above', label:'Grade Above', type:'number', placeholder:'80', desc:'Minimum grade score' },
    { key:'grade_below', label:'Grade Below', type:'number', placeholder:'40', desc:'Maximum grade score' },
    { key:'login_after', label:'Login After', type:'date', desc:'Last login after this date' },
    { key:'login_before', label:'Login Before', type:'date', desc:'Last login before this date' },
    { key:'has_feature_usage', label:'Has Feature Usage', type:'text', placeholder:'e.g. lms, assignments', desc:'Used a specific module' },
    { key:'engagement_score_above', label:'Engagement Score Above', type:'number', placeholder:'70', desc:'Minimum composite engagement score' },
    { key:'engagement_score_below', label:'Engagement Score Below', type:'number', placeholder:'30', desc:'Maximum composite engagement score' },
    { key:'account_age_days_above', label:'Account Age Above', type:'number', placeholder:'90', desc:'Account created at least N days ago' },
    { key:'created_between', label:'Created Between', type:'daterange', desc:'Account created in date range' },
  ];

  // ── Navigation ───────────────────────────────────────────
  function nav(active) {
    const items = [
      { href:'/school/segments', label:'📊 Dashboard', key:'dash' },
      { href:'/school/segments/create', label:'➕ Create Segment', key:'create' },
      { href:'/school/segments/insights', label:'📈 Insights', key:'insights' },
      { href:'/school/segments/rules', label:'🔧 Rule Catalog', key:'rules' },
    ];
    return `<nav class="seg-nav" aria-label="User Segmentation Navigation">${items.map(i =>
      `<a href="${i.href}" class="${active===i.key?'active':''}">${i.label}</a>`).join('')}</nav>`;
  }

  // ── Database Migrations ──────────────────────────────────
  const migrations = [
    `CREATE TABLE IF NOT EXISTS user_segments (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      name VARCHAR(255) NOT NULL, description TEXT,
      rules JSONB DEFAULT '[]',
      is_active BOOLEAN DEFAULT true,
      user_count INTEGER DEFAULT 0,
      last_refreshed TIMESTAMPTZ,
      created_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS user_segment_members (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      segment_id INTEGER REFERENCES user_segments(id) ON DELETE CASCADE,
      user_email VARCHAR(255) NOT NULL,
      matched_rules JSONB DEFAULT '{}',
      added_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(segment_id, user_email))`,
    `CREATE TABLE IF NOT EXISTS segment_activity_log (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL DEFAULT 0,
      segment_id INTEGER, action VARCHAR(50) NOT NULL,
      target_count INTEGER DEFAULT 0, details TEXT,
      performed_by VARCHAR(255), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_us_tid ON user_segments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_us_active ON user_segments(tenant_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_usm_sid ON user_segment_members(segment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_usm_tid ON user_segment_members(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sal_tid ON segment_activity_log(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sal_sid ON segment_activity_log(segment_id)`,
  ];

  // ── Helper: build SQL WHERE clause from rules ───────────
  function buildRuleSQL(rules) {
    if (!rules || !Array.isArray(rules) || !rules.length) return { sql: '1=1', params: [], paramIdx: 0 };
    const clauses = [];
    let idx = 0;
    for (const rule of rules) {
      const { field, operator, value } = rule;
      idx++;
      switch (field) {
        case 'role_is':
          clauses.push({ sql: `role = $${idx}`, val: value }); break;
        case 'class_in': {
          const classes = value.split(',').map(c => c.trim());
          const ph = classes.map((_, i) => `$${idx + i}`);
          clauses.push({ sql: `class_name IN (${ph.join(',')})`, val: classes });
          idx += classes.length - 1; break;
        }
        case 'fee_status':
          clauses.push({ sql: `fee_status = $${idx}`, val: value }); break;
        case 'attendance_above':
          clauses.push({ sql: `attendance_pct >= $${idx}`, val: parseFloat(value) }); break;
        case 'attendance_below':
          clauses.push({ sql: `attendance_pct <= $${idx}`, val: parseFloat(value) }); break;
        case 'grade_above':
          clauses.push({ sql: `avg_grade >= $${idx}`, val: parseFloat(value) }); break;
        case 'grade_below':
          clauses.push({ sql: `avg_grade <= $${idx}`, val: parseFloat(value) }); break;
        case 'login_after':
          clauses.push({ sql: `last_login >= $${idx}`, val: value }); break;
        case 'login_before':
          clauses.push({ sql: `last_login <= $${idx}`, val: value }); break;
        case 'has_feature_usage':
          clauses.push({ sql: `feature_usage @> $${idx}`, val: JSON.stringify([value]) }); break;
        case 'engagement_score_above':
          clauses.push({ sql: `engagement_score >= $${idx}`, val: parseFloat(value) }); break;
        case 'engagement_score_below':
          clauses.push({ sql: `engagement_score <= $${idx}`, val: parseFloat(value) }); break;
        case 'account_age_days_above':
          clauses.push({ sql: `created_at <= NOW() - ($${idx} || ' days')::INTERVAL`, val: String(value) }); break;
        case 'created_between':
          clauses.push({ sql: `created_at BETWEEN $${idx} AND $${idx+1}`, val: [value.split(',')[0]?.trim(), value.split(',')[1]?.trim()] });
          idx++; break;
        default:
          clauses.push({ sql: '1=1', val: null });
      }
    }
    const params = [];
    const sqlParts = clauses.map((c, i) => {
      const logic = i > 0 ? ` ${(rules[i].logic || 'AND')} ` : '';
      if (Array.isArray(c.val)) { params.push(...c.val); }
      else { params.push(c.val); }
      return logic + c.sql;
    });
    return { sql: sqlParts.join(''), params };
  }

  // ── Helper: log segment activity ────────────────────────
  async function logActivity(tid, segId, action, count, details, email) {
    await pool.query(
      `INSERT INTO segment_activity_log (tenant_id,segment_id,action,target_count,details,performed_by,created_at) VALUES ($1,$2,$3,$4,$5,$6,NOW())`,
      [tid, segId, action, count, details, email]);
  }

  // ── Helper: rule builder HTML ───────────────────────────
  function ruleBuilderHTML(rules, namePrefix) {
    const prefix = namePrefix || 'rules';
    const parsed = typeof rules === 'string' ? JSON.parse(rules || '[]') : (rules || []);
    let html = '<div id="rules-container">';
    parsed.forEach((r, i) => {
      const logicHtml = i > 0 ? `<div class="rule-andor"><select name="${prefix}[${i}][logic]" style="border:2px solid ${P};border-radius:6px;padding:4px 8px;font-size:12px;font-weight:800;background:#fff;color:${P}"><option value="AND" ${r.logic!=='OR'?'selected':''}>AND</option><option value="OR" ${r.logic==='OR'?'selected':''}>OR</option></select></div>` : '';
      const ruleType = RULE_TYPES.find(rt => rt.key === r.field) || RULE_TYPES[0];
      let valueInput = `<input name="${prefix}[${i}][value]" value="${esc(r.value||'')}" placeholder="${esc(ruleType.placeholder||'value')}" style="flex:1;min-width:120px">`;
      if (ruleType.type === 'select') {
        valueInput = `<select name="${prefix}[${i}][value]">${ruleType.options.map(o => `<option value="${o}" ${r.value===o?'selected':''}>${o}</option>`).join('')}</select>`;
      } else if (ruleType.type === 'date') {
        valueInput = `<input type="date" name="${prefix}[${i}][value]" value="${esc(r.value||'')}" style="flex:1;min-width:120px">`;
      } else if (ruleType.type === 'daterange') {
        const parts = (r.value||'').split(',');
        valueInput = `<input type="date" name="${prefix}[${i}][value_from]" value="${esc(parts[0]?.trim()||'')}" placeholder="From" style="flex:1;min-width:100px"><span style="color:${M};font-size:12px">to</span><input type="date" name="${prefix}[${i}][value_to]" value="${esc(parts[1]?.trim()||'')}" placeholder="To" style="flex:1;min-width:100px">`;
      }
      html += `${logicHtml}<div class="rule-row">
        <select name="${prefix}[${i}][field]" onchange="updateValueField(this,${i},'${prefix}')" style="min-width:160px">
          ${RULE_TYPES.map(rt => `<option value="${rt.key}" ${r.field===rt.key?'selected':''}>${rt.label}</option>`).join('')}
        </select>
        <span id="${prefix}_val_${i}">${valueInput}</span>
        <button type="button" onclick="this.parentElement.previousElementSibling?.remove();this.parentElement.remove()" style="background:none;border:none;color:${R};cursor:pointer;font-size:18px;padding:4px" title="Remove rule">✕</button>
      </div>`;
    });
    html += '</div>';
    html += `<button type="button" onclick="addRule('${prefix}')" class="seg-btn seg-btn-secondary" style="margin-top:8px">+ Add Rule</button>`;
    return html;
  }

  // ── Run migrations on startup ────────────────────────────
  (async () => {
    const client = await pool.connect();
    try {
      for (const sql of migrations) await client.query(sql);
      console.log('[UserSegmentation] Migrations applied (' + migrations.length + ' statements)');
    } catch(e) { /* migration OK */ }
    finally { client.release(); }
  })();

  // ── Shared JS for rule builder ───────────────────────────
  const RULE_BUILDER_JS = `<script>
    const RULE_TYPES = ${JSON.stringify(RULE_TYPES)};
    function updateValueField(sel, idx, prefix) {
      const rt = RULE_TYPES.find(r => r.key === sel.value) || RULE_TYPES[0];
      const container = document.getElementById(prefix + '_val_' + idx);
      let html = '';
      if (rt.type === 'select') {
        html = '<select name="' + prefix + '[' + idx + '][value]">' + rt.options.map(o => '<option value="' + o + '">' + o + '</option>').join('') + '</select>';
      } else if (rt.type === 'date') {
        html = '<input type="date" name="' + prefix + '[' + idx + '][value]" placeholder="' + (rt.placeholder||'') + '" style="flex:1;min-width:120px">';
      } else if (rt.type === 'daterange') {
        html = '<input type="date" name="' + prefix + '[' + idx + '][value_from]" placeholder="From" style="flex:1;min-width:100px"><span style="color:#6b7280;font-size:12px">to</span><input type="date" name="' + prefix + '[' + idx + '][value_to]" placeholder="To" style="flex:1;min-width:100px">';
      } else {
        html = '<input name="' + prefix + '[' + idx + '][value]" placeholder="' + (rt.placeholder||'value') + '" style="flex:1;min-width:120px">';
      }
      container.innerHTML = html;
    }
    function addRule(prefix) {
      const container = document.getElementById('rules-container');
      const count = container.querySelectorAll('.rule-row').length;
      const logicHtml = count > 0 ? '<div class="rule-andor"><select name="' + prefix + '[' + count + '][logic]" style="border:2px solid #4f46e5;border-radius:6px;padding:4px 8px;font-size:12px;font-weight:800;background:#fff;color:#4f46e5"><option value="AND">AND</option><option value="OR">OR</option></select></div>' : '';
      const ruleOpts = RULE_TYPES.map(r => '<option value="' + r.key + '">' + r.label + '</option>').join('');
      const row = logicHtml + '<div class="rule-row"><select name="' + prefix + '[' + count + '][field]" onchange="updateValueField(this,' + count + ',\\'' + prefix + '\\')" style="min-width:160px">' + ruleOpts + '</select><span id="' + prefix + '_val_' + count + '"><input name="' + prefix + '[' + count + '][value]" placeholder="value" style="flex:1;min-width:120px"></span><button type="button" onclick="this.parentElement.previousElementSibling?.remove();this.parentElement.remove()" style="background:none;border:none;color:#dc2626;cursor:pointer;font-size:18px;padding:4px" title="Remove rule">✕</button></div>';
      container.insertAdjacentHTML('beforeend', row);
    }
  </script>`;

  // ── ROUTE 1: GET /school/segments — Dashboard ────────────
  app.get('/school/segments', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { rows: segments } = await pool.query(
      'SELECT * FROM user_segments WHERE tenant_id=$1 ORDER BY created_at DESC', [tid]);
    const totalUsers = segments.reduce((s, seg) => s + (seg.user_count || 0), 0);
    const activeSegs = segments.filter(s => s.is_active).length;
    const totalSegs = segments.length;
    const coverage = totalSegs > 0 ? Math.round(activeSegs / totalSegs * 100) : 0;
    const { rows: recentLogs } = await pool.query(
      'SELECT * FROM segment_activity_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 8', [tid]);

    const segRows = segments.map(s => {
      const rules = typeof s.rules === 'string' ? JSON.parse(s.rules || '[]') : (s.rules || []);
      const ruleLabels = rules.map(r => { const rt = RULE_TYPES.find(t => t.key === r.field); return rt ? rt.label : r.field; }).join(', ') || 'No rules';
      return `<tr>
        <td><strong style="color:#1e1b4b">${esc(s.name)}</strong><div style="font-size:11px;color:${M};max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(ruleLabels)}</div></td>
        <td><span class="seg-badge" style="background:${s.is_active?GL:RL};color:${s.is_active?'#065f46':R}">${s.is_active?'Active':'Inactive'}</span></td>
        <td style="font-weight:700">${s.user_count || 0}</td>
        <td style="font-size:12px;color:${M}">${fmtDT(s.last_refreshed)}</td>
        <td>${fmtDT(s.created_at)}</td>
        <td><a href="/school/segments/${s.id}" class="seg-btn seg-btn-sm seg-btn-primary">View</a>
          <a href="/school/segments/${s.id}/export" class="seg-btn seg-btn-sm seg-btn-secondary">📥 CSV</a>
          <button onclick="refreshSegment(${s.id})" class="seg-btn seg-btn-sm seg-btn-success">🔄</button>
          <form method="POST" action="/school/segments/${s.id}" style="display:inline" onsubmit="return confirm('Delete this segment?')"><button class="seg-btn seg-btn-sm seg-btn-danger">🗑</button></form></td>
      </tr>`;
    }).join('');

    const logItems = recentLogs.map(l => `<div style="display:flex;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid #f3f4f6">
      <span class="seg-badge" style="background:${PL};color:${P}">${esc(l.action)}</span>
      <span style="flex:1;font-size:12px;color:#1e1b4b">${esc(l.details||l.action)}</span>
      <span style="font-size:11px;color:${M}">${l.target_count || 0} users</span>
    </div>`).join('');

    const html = SK_CSS + CSS + `<div class="seg-root">${nav('dash')}
      <div class="seg-hero"><h1>👥 User Segmentation Engine</h1><p>Create dynamic user segments based on behavior, attributes, and engagement scores — then target announcements and features</p>
        <div class="seg-hero-actions">
          <a href="/school/segments/create" class="seg-btn" style="background:#818cf8;color:#fff">➕ Create Segment</a>
          <a href="/school/segments/insights" class="seg-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3)">📈 Insights</a>
          <a href="/school/segments/rules" class="seg-btn" style="background:rgba(255,255,255,.15);color:#fff;border:1px solid rgba(255,255,255,.3)">🔧 Rule Catalog</a>
        </div></div>
      <div class="seg-stats">
        <div class="seg-stat"><div class="seg-stat-val">${totalSegs}</div><div class="seg-stat-lbl">Total Segments</div></div>
        <div class="seg-stat"><div class="seg-stat-val" style="color:${G}">${activeSegs}</div><div class="seg-stat-lbl">Active</div></div>
        <div class="seg-stat"><div class="seg-stat-val" style="color:${P}">${totalUsers}</div><div class="seg-stat-lbl">Segmented Users</div></div>
        <div class="seg-stat"><div class="seg-stat-val" style="color:${O}">${coverage}%</div><div class="seg-stat-lbl">Coverage</div></div>
      </div>
      <div class="seg-grid-2">
        <div class="seg-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;font-size:16px;font-weight:700;color:#1e1b4b">📋 Segments</h3></div>
          <div style="max-height:420px;overflow-y:auto"><table class="seg-table"><thead><tr><th>Segment</th><th>Status</th><th>Users</th><th>Refreshed</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>${segRows || '<tr><td colspan="6" class="seg-empty">No segments yet — create your first one</td></tr>'}</tbody></table></div></div>
        <div class="seg-card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;font-size:16px;font-weight:700;color:#1e1b4b">📋 Recent Activity</h3></div>
          <div style="max-height:420px;overflow-y:auto">${logItems || '<div class="seg-empty">No activity yet</div>'}</div></div>
      </div></div>
    <script>function refreshSegment(id){fetch('/school/segments/'+id+'/refresh',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>{if(d.success)location.reload();else alert(d.error||'Error');}).catch(e=>alert('Error: '+e.message));}</script>`;
    res.send(renderPage('User Segments', html, u, req));
  }));

  // ── ROUTE 2: GET /school/segments/create — Form ──────────
  app.get('/school/segments/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const html = SK_CSS + CSS + `<div class="seg-root">${nav('create')}
      <a href="/school/segments" style="color:${M};text-decoration:none;font-size:14px;margin-bottom:16px;display:inline-block">← Back to Segments</a>
      <div class="seg-card" style="max-width:800px">
        <h3 style="margin:0 0 6px;font-size:18px;font-weight:700;color:#1e1b4b">➕ Create User Segment</h3>
        <p style="color:${M};font-size:13px;margin:0 0 16px">Define rules to dynamically group users. Use AND/OR logic to combine multiple conditions.</p>
        <form method="POST" action="/school/segments/create">
          <div class="seg-grid-2">
            <div class="seg-form-group"><label>Segment Name *</label><input class="seg-input" name="name" required placeholder="e.g. At-Risk Students"></div>
            <div class="seg-form-group"><label>Initial Status</label><select class="seg-select" name="is_active"><option value="true">Active</option><option value="false">Inactive</option></select></div>
          </div>
          <div class="seg-form-group"><label>Description</label><textarea class="seg-input" name="description" rows="2" placeholder="What is this segment for?"></textarea></div>
          <div class="seg-form-group"><label style="display:flex;align-items:center;gap:8px">Rule Conditions
            <span class="seg-badge" style="background:${PL};color:${P}">Visual Builder</span></label>
            ${ruleBuilderHTML([], 'rules')}
          </div>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <button type="submit" class="seg-btn seg-btn-primary">💾 Create Segment</button>
            <button type="submit" name="auto_refresh" value="1" class="seg-btn seg-btn-success">💾 Create & Refresh</button>
            <a href="/school/segments" class="seg-btn seg-btn-secondary">Cancel</a>
          </div>
        </form></div>
      ${RULE_BUILDER_JS}</div>`;
    res.send(renderPage('Create Segment', html, u, req));
  }));

  // ── ROUTE 3: POST /school/segments/create — Save ─────────
  app.post('/school/segments/create', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { name, description='', is_active='true', auto_refresh, rules } = req.body;
    const parsedRules = parseRulesFromBody(rules);
    const { rows } = await pool.query(
      `INSERT INTO user_segments (tenant_id,name,description,rules,is_active,created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
      [tid, name, description, JSON.stringify(parsedRules), is_active === 'true', u.email]);
    const segId = rows[0].id;
    await logActivity(tid, segId, 'created', 0, `Segment "${name}" created with ${parsedRules.length} rules`, u.email);
    audit(u.email, 'segment_created', `Created segment: ${name}`);
    if (auto_refresh) {
      try {
        const count = await refreshSegmentMembership(tid, segId, parsedRules);
        await logActivity(tid, segId, 'refreshed', count, `Auto-refresh matched ${count} users`, u.email);
      } catch(e) { /* non-blocking */ }
    }
    res.redirect('/school/segments?msg=Segment+created');
  }));

  // ── ROUTE 4: GET /school/segments/:id — View Detail ──────
  app.get('/school/segments/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, segId = req.params.id;
    const { rows: segs } = await pool.query('SELECT * FROM user_segments WHERE id=$1 AND tenant_id=$2', [segId, tid]);
    if (!segs.length) return res.status(404).send('Segment not found');
    const seg = segs[0];
    const rules = typeof seg.rules === 'string' ? JSON.parse(seg.rules || '[]') : (seg.rules || []);
    const { rows: members } = await pool.query(
      'SELECT * FROM user_segment_members WHERE segment_id=$1 AND tenant_id=$2 ORDER BY added_at DESC LIMIT 200', [segId, tid]);
    const { rows: logs } = await pool.query(
      'SELECT * FROM segment_activity_log WHERE segment_id=$1 AND tenant_id=$2 ORDER BY created_at DESC LIMIT 15', [tid, segId]);

    const ruleDisplay = rules.map((r, i) => {
      const rt = RULE_TYPES.find(t => t.key === r.field) || { label: r.field };
      const logic = i > 0 ? `<span class="seg-badge" style="background:${r.logic==='OR'?OL:PL};color:${r.logic==='OR'?O:P};margin-right:6px">${r.logic}</span>` : '';
      return `${logic}<span style="display:inline-flex;align-items:center;gap:4px;padding:4px 10px;background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;margin:2px">
        <strong>${esc(rt.label)}</strong> <span style="color:${M}">=</span> <code style="background:${PL};color:${P};padding:1px 6px;border-radius:4px">${esc(r.value||'')}</code></span>`;
    }).join(' ') || '<span style="color:#9ca3af">No rules defined</span>';

    const memberRows = members.map(m => `<tr>
      <td style="font-weight:600">${esc(m.user_email)}</td>
      <td style="font-size:12px;color:${M}">${fmtDT(m.added_at)}</td>
      <td>${Object.keys(typeof m.matched_rules === 'string' ? JSON.parse(m.matched_rules||'{}') : (m.matched_rules||{})).length} rules</td>
    </tr>`).join('');

    const logItems = logs.map(l => `<div style="display:flex;gap:8px;align-items:center;padding:5px 0;border-bottom:1px solid #f3f4f6;font-size:12px">
      <span class="seg-badge" style="background:${PL};color:${P}">${esc(l.action)}</span>
      <span style="flex:1">${esc(l.details||'')}</span>
      <span style="color:${M}">${l.target_count||0} users</span>
      <span style="color:${M};font-size:11px">${fmtDT(l.created_at)}</span>
    </div>`).join('');

    const html = SK_CSS + CSS + `<div class="seg-root">${nav('dash')}
      <a href="/school/segments" style="color:${M};text-decoration:none;font-size:14px;margin-bottom:16px;display:inline-block">← Back to Segments</a>
      <div class="seg-hero" style="background:linear-gradient(135deg,${P},#7c3aed)">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px;position:relative;z-index:1">
          <div><h1>${esc(seg.name)}</h1><p style="margin-top:4px">${esc(seg.description||'No description')}</p>
            <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">${ruleDisplay}</div></div>
          <div style="text-align:right;position:relative;z-index:1">
            <span class="seg-badge" style="background:${seg.is_active?GL:RL};color:${seg.is_active?'#065f46':R};font-size:14px;padding:6px 16px">${seg.is_active?'● Active':'○ Inactive'}</span>
            <div style="font-size:13px;color:rgba(255,255,255,.8);margin-top:6px">Last refreshed: ${fmtDT(seg.last_refreshed)}</div>
          </div>
        </div></div>
      <div class="seg-stats">
        <div class="seg-stat"><div class="seg-stat-val">${seg.user_count||0}</div><div class="seg-stat-lbl">Matched Users</div></div>
        <div class="seg-stat"><div class="seg-stat-val">${rules.length}</div><div class="seg-stat-lbl">Active Rules</div></div>
        <div class="seg-stat"><div class="seg-stat-val">${logs.length}</div><div class="seg-stat-lbl">Actions Taken</div></div>
        <div class="seg-stat"><div class="seg-stat-val" style="font-size:18px">${fmtDT(seg.created_at)}</div><div class="seg-stat-lbl">Created</div></div>
      </div>
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap">
        <button onclick="refreshSegment(${segId})" class="seg-btn seg-btn-success">🔄 Refresh Membership</button>
        <a href="/school/segments/${segId}/export" class="seg-btn seg-btn-secondary">📥 Export CSV</a>
        <button onclick="document.getElementById('bulk-panel').style.display=document.getElementById('bulk-panel').style.display==='none'?'block':'none'" class="seg-btn seg-btn-primary">⚡ Bulk Action</a>
        <button onclick="document.getElementById('edit-form').style.display=document.getElementById('edit-form').style.display==='none'?'block':'none'" class="seg-btn seg-btn-secondary">✏️ Edit Rules</button>
      </div>
      <div id="bulk-panel" style="display:none;margin-bottom:20px" class="seg-card">
        <h4 style="margin:0 0 12px;color:#1e1b4b">⚡ Bulk Action — Apply to ${seg.user_count||0} users</h4>
        <form method="POST" action="/school/segments/bulk-action">
          <input type="hidden" name="segment_id" value="${segId}">
          <div class="seg-grid-3">
            <div class="seg-form-group"><label>Action Type</label><select class="seg-select" name="action_type">
              <option value="email">Send Email</option><option value="assign_role">Assign Role</option>
              <option value="tag">Add Tag</option><option value="remove_tag">Remove Tag</option></select></div>
            <div class="seg-form-group"><label>Value</label><input class="seg-input" name="action_value" placeholder="email subject / role / tag name"></div>
            <div class="seg-form-group"><label>Details (optional)</label><textarea class="seg-input" name="action_details" rows="1" placeholder="Additional notes"></textarea></div>
          </div>
          <button type="submit" class="seg-btn seg-btn-primary">🚀 Execute Action</button>
        </form></div>
      <div id="edit-form" style="display:none;margin-bottom:20px" class="seg-card">
        <h4 style="margin:0 0 12px;color:#1e1b4b">✏️ Edit Segment Rules</h4>
        <form method="POST" action="/school/segments/${segId}/edit">
          <div class="seg-form-group"><label>Name</label><input class="seg-input" name="name" value="${esc(seg.name)}" required></div>
          <div class="seg-form-group"><label>Description</label><textarea class="seg-input" name="description" rows="2">${esc(seg.description||'')}</textarea></div>
          <div class="seg-form-group"><label>Status</label><select class="seg-select" name="is_active"><option value="true" ${seg.is_active?'selected':''}>Active</option><option value="false" ${!seg.is_active?'selected':''}>Inactive</option></select></div>
          <div class="seg-form-group"><label>Rules</label>${ruleBuilderHTML(rules, 'rules')}</div>
          <button type="submit" class="seg-btn seg-btn-primary">💾 Save Changes</button>
          <button type="button" onclick="document.getElementById('edit-form').style.display='none'" class="seg-btn seg-btn-secondary">Cancel</button>
        </form></div>
      <div class="seg-grid-2">
        <div class="seg-card"><h3 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1e1b4b">👥 Matched Users (${members.length})</h3>
          <div style="max-height:400px;overflow-y:auto"><table class="seg-table"><thead><tr><th>Email</th><th>Added</th><th>Rules Matched</th></tr></thead>
          <tbody>${memberRows || '<tr><td colspan="3" class="seg-empty">No members — refresh to populate</td></tr>'}</tbody></table></div></div>
        <div class="seg-card"><h3 style="margin:0 0 12px;font-size:16px;font-weight:700;color:#1e1b4b">📋 Activity Log</h3>
          <div style="max-height:400px;overflow-y:auto">${logItems || '<div class="seg-empty">No activity recorded</div>'}</div></div>
      </div></div>
    <script>function refreshSegment(id){fetch('/school/segments/'+id+'/refresh',{method:'POST',headers:{'Content-Type':'application/json'}}).then(r=>r.json()).then(d=>{if(d.success)location.reload();else alert(d.error||'Error');}).catch(e=>alert('Error: '+e.message));}</script>
    ${RULE_BUILDER_JS}</div>`;
    res.send(renderPage('Segment: ' + seg.name, html, u, req));
  }));

  // ── ROUTE 5: POST /school/segments/:id/edit — Update ─────
  app.post('/school/segments/:id/edit', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, segId = req.params.id;
    const { name, description, is_active='true', rules } = req.body;
    const { rows: segs } = await pool.query('SELECT * FROM user_segments WHERE id=$1 AND tenant_id=$2', [segId, tid]);
    if (!segs.length) return res.status(404).send('Segment not found');
    const parsedRules = parseRulesFromBody(rules);
    await pool.query(
      'UPDATE user_segments SET name=$1,description=$2,is_active=$3,rules=$4,last_refreshed=NOW() WHERE id=$5 AND tenant_id=$6',
      [name, description, is_active === 'true', JSON.stringify(parsedRules), segId, tid]);
    await logActivity(tid, parseInt(segId), 'updated', 0, `Segment updated to "${name}" with ${parsedRules.length} rules`, u.email);
    audit(u.email, 'segment_updated', `Updated segment: ${name}`);
    res.redirect('/school/segments/' + segId + '?msg=Updated');
  }));

  // ── ROUTE 6: DELETE /school/segments/:id ─────────────────
  app.delete('/school/segments/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, segId = req.params.id;
    const { rows: segs } = await pool.query('SELECT * FROM user_segments WHERE id=$1 AND tenant_id=$2', [segId, tid]);
    if (!segs.length) return res.status(404).json({ error: 'Segment not found' });
    const seg = segs[0];
    await pool.query('DELETE FROM segment_activity_log WHERE segment_id=$1 AND tenant_id=$2', [segId, tid]);
    await pool.query('DELETE FROM user_segment_members WHERE segment_id=$1 AND tenant_id=$2', [segId, tid]);
    await pool.query('DELETE FROM user_segments WHERE id=$1 AND tenant_id=$2', [segId, tid]);
    audit(u.email, 'segment_deleted', `Deleted segment: ${seg.name}`);
    res.json({ success: true });
  }));

  // ── ROUTE 7: POST /school/segments/:id/refresh ───────────
  app.post('/school/segments/:id/refresh', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user, segId = req.params.id;
    const { rows: segs } = await pool.query('SELECT * FROM user_segments WHERE id=$1 AND tenant_id=$2', [segId, tid]);
    if (!segs.length) return res.status(404).json({ error: 'Segment not found' });
    const seg = segs[0];
    const rules = typeof seg.rules === 'string' ? JSON.parse(seg.rules || '[]') : (seg.rules || []);
    try {
      const count = await refreshSegmentMembership(tid, parseInt(segId), rules);
      await logActivity(tid, parseInt(segId), 'refreshed', count, `Refresh matched ${count} users`, u.email);
      audit(u.email, 'segment_refreshed', `Refreshed segment "${seg.name}": ${count} users`);
      res.json({ success: true, user_count: count });
    } catch(e) {
      res.status(500).json({ error: e.message });
    }
  }));

  // ── ROUTE 8: GET /school/segments/:id/export — CSV ───────
  app.get('/school/segments/:id/export', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), segId = req.params.id;
    const { rows: segs } = await pool.query('SELECT * FROM user_segments WHERE id=$1 AND tenant_id=$2', [segId, tid]);
    if (!segs.length) return res.status(404).send('Segment not found');
    const { rows: members } = await pool.query(
      'SELECT user_email, matched_rules, added_at FROM user_segment_members WHERE segment_id=$1 AND tenant_id=$2 ORDER BY user_email', [segId, tid]);
    const csvRows = ['Email,Matched Rules,Added At'];
    for (const m of members) {
      const matched = typeof m.matched_rules === 'string' ? JSON.parse(m.matched_rules || '{}') : (m.matched_rules || {});
      csvRows.push(`"${m.user_email}","${JSON.stringify(matched).replace(/"/g,'""')}","${fmtDT(m.added_at)}"`);
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="segment-${segs[0].name.replace(/\s+/g,'-').toLowerCase()}-${Date.now()}.csv"`);
    res.send(csvRows.join('\n'));
  }));

  // ── ROUTE 9: POST /school/segments/bulk-action ───────────
  app.post('/school/segments/bulk-action', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { segment_id, action_type, action_value='', action_details='' } = req.body;
    const { rows: segs } = await pool.query('SELECT * FROM user_segments WHERE id=$1 AND tenant_id=$2', [segment_id, tid]);
    if (!segs.length) return res.status(404).send('Segment not found');
    const seg = segs[0];
    const { rows: members } = await pool.query(
      'SELECT user_email FROM user_segment_members WHERE segment_id=$1 AND tenant_id=$2', [segment_id, tid]);
    const emails = members.map(m => m.user_email);
    const details = `${action_type}: "${action_value}" on ${emails.length} users. ${action_details}`;
    await logActivity(tid, parseInt(segment_id), action_type, emails.length, details, u.email);
    audit(u.email, 'bulk_action', `Bulk ${action_type} on segment "${seg.name}": ${emails.length} users`);
    if (action_type === 'email') {
      // Placeholder: integrate with email service
    } else if (action_type === 'assign_role') {
      // Placeholder: integrate with RBAC
    } else if (action_type === 'tag' || action_type === 'remove_tag') {
      // Placeholder: integrate with tagging system
    }
    res.redirect('/school/segments/' + segment_id + '?msg=Bulk+action+applied+to+' + emails.length + '+users');
  }));

  // ── ROUTE 10: GET /school/segments/insights ──────────────
  app.get('/school/segments/insights', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const { rows: segments } = await pool.query(
      'SELECT * FROM user_segments WHERE tenant_id=$1 ORDER BY user_count DESC', [tid]);
    const { rows: ruleCounts } = await pool.query(
      `SELECT jsonb_array_length(rules) as rule_count, COUNT(*)::int as seg_count FROM user_segments WHERE tenant_id=$1 GROUP BY rule_count ORDER BY rule_count`, [tid]);
    const totalMembers = segments.reduce((s, seg) => s + (seg.user_count || 0), 0);
    const avgMembers = segments.length > 0 ? Math.round(totalMembers / segments.length) : 0;
    const maxSeg = segments.length > 0 ? segments[0] : null;

    const colors = [P, G, BL, O, '#7c3aed', '#0891b2', R, '#db2777'];
    const segComparison = segments.slice(0, 8).map((s, i) => {
      const c = colors[i % colors.length];
      const pct = totalMembers > 0 ? Math.round((s.user_count || 0) / totalMembers * 100) : 0;
      return `<div class="seg-insight-bar">
        <span style="min-width:160px;font-size:13px;font-weight:600;color:#1e1b4b;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(s.name)}">${esc(s.name)}</span>
        <div class="bar"><div class="fill" style="width:${Math.max(pct, 2)}%;background:${c}">${s.user_count || 0} (${pct}%)</div></div>
      </div>`;
    }).join('');

    const ruleDist = ruleCounts.map(rc => {
      const pct = segments.length > 0 ? Math.round(rc.seg_count / segments.length * 100) : 0;
      return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f3f4f6">
        <span style="font-size:13px;font-weight:700;color:#1e1b4b;min-width:60px">${rc.rule_count} rules</span>
        <div class="seg-progress" style="flex:1"><div class="seg-progress-bar" style="width:${pct}%;background:${P}"></div></div>
        <span style="font-size:12px;color:${M};min-width:40px">${rc.seg_count} segs</span></div>`;
    }).join('');

    const ruleTypeUsage = {};
    for (const s of segments) {
      const rules = typeof s.rules === 'string' ? JSON.parse(s.rules || '[]') : (s.rules || []);
      for (const r of rules) { ruleTypeUsage[r.field] = (ruleTypeUsage[r.field] || 0) + 1; }
    }
    const topRules = Object.entries(ruleTypeUsage).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => {
      const rt = RULE_TYPES.find(t => t.key === key) || { label: key };
      const c = colors[Object.keys(ruleTypeUsage).indexOf(key) % colors.length];
      return `<div style="display:flex;align-items:center;gap:10px;padding:6px 0;border-bottom:1px solid #f3f4f6">
        <span style="min-width:160px;font-size:13px;font-weight:600;color:#1e1b4b">${esc(rt.label)}</span>
        <div class="seg-progress" style="flex:1"><div class="seg-progress-bar" style="width:${Math.min(100, count * 15)}%;background:${c}"></div></div>
        <span style="font-size:12px;font-weight:700;color:${M}">${count}×</span></div>`;
    }).join('');

    const html = SK_CSS + CSS + `<div class="seg-root">${nav('insights')}
      <div class="seg-hero" style="background:linear-gradient(135deg,#1e1b4b,${P})">
        <h1>📈 Segmentation Insights</h1><p>Cross-segment analytics and rule usage patterns to optimize your targeting strategy</p></div>
      <div class="seg-stats">
        <div class="seg-stat"><div class="seg-stat-val">${segments.length}</div><div class="seg-stat-lbl">Total Segments</div></div>
        <div class="seg-stat"><div class="seg-stat-val" style="color:${P}">${totalMembers}</div><div class="seg-stat-lbl">Total Members</div></div>
        <div class="seg-stat"><div class="seg-stat-val" style="color:${G}">${avgMembers}</div><div class="seg-stat-lbl">Avg per Segment</div></div>
        <div class="seg-stat"><div class="seg-stat-val" style="color:${O}">${maxSeg ? esc(maxSeg.name) : '—'}</div><div class="seg-stat-lbl">Largest Segment</div></div>
      </div>
      <div class="seg-grid-2">
        <div class="seg-card"><h3 style="margin:0 0 14px;font-size:16px;font-weight:700;color:#1e1b4b">📊 Segment Size Comparison</h3>
          ${segComparison || '<div class="seg-empty">No segments to compare</div>'}</div>
        <div class="seg-card"><h3 style="margin:0 0 14px;font-size:16px;font-weight:700;color:#1e1b4b">🔧 Most Used Rule Types</h3>
          ${topRules || '<div class="seg-empty">No rules used yet</div>'}</div>
        <div class="seg-card"><h3 style="margin:0 0 14px;font-size:16px;font-weight:700;color:#1e1b4b">📐 Rules per Segment Distribution</h3>
          ${ruleDist || '<div class="seg-empty">No data yet</div>'}</div>
        <div class="seg-card"><h3 style="margin:0 0 14px;font-size:16px;font-weight:700;color:#1e1b4b">💡 Recommendations</h3>
          ${generateRecommendations(segments, ruleTypeUsage)}</div>
      </div></div>`;
    res.send(renderPage('Segment Insights', html, u, req));
  }));

  // ── ROUTE 11: GET /school/segments/rules — Rule Catalog ──
  app.get('/school/segments/rules', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), u = req.session.user;
    const ruleCards = RULE_TYPES.map(rt => {
      const examples = getRuleExample(rt.key);
      return `<div class="seg-card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
          <div><h4 style="margin:0;font-size:14px;font-weight:700;color:#1e1b4b">${esc(rt.label)}</h4>
            <div style="font-size:12px;color:${M};margin-top:2px"><code style="background:${PL};color:${P};padding:1px 6px;border-radius:4px;font-size:11px">${rt.key}</code></div>
            <p style="margin:6px 0 0;font-size:12px;color:#374151">${esc(rt.desc)}</p></div>
          <div style="text-align:right">
            <span class="seg-badge" style="background:${PL};color:${P}">${rt.type}</span>
            ${rt.options ? `<div style="font-size:11px;color:${M};margin-top:4px">${rt.options.map(o => `<span style="display:inline-block;padding:2px 6px;background:#f3f4f6;border-radius:4px;margin:1px">${o}</span>`).join('')}</div>` : ''}
          </div></div>
        <div style="margin-top:10px;padding:8px 12px;background:#fafbfc;border-radius:8px;border:1px dashed #e5e7eb">
          <span style="font-size:11px;color:${M};font-weight:700">EXAMPLE:</span>
          <code style="font-size:12px;color:#1e1b4b;margin-left:6px">${esc(examples)}</code></div>
      </div>`;
    }).join('');

    const html = SK_CSS + CSS + `<div class="seg-root">${nav('rules')}
      <div class="seg-hero" style="background:linear-gradient(135deg,#1e1b4b,#7c3aed)">
        <h1>🔧 Rule Types Catalog</h1><p>All available rule types for building segments — ${RULE_TYPES.length} rules supported</p></div>
      <div class="seg-alert seg-alert-info">💡 <strong>Tip:</strong> Combine rules with AND/OR logic to create precise segments. Rules are evaluated in order.</div>
      <div>${ruleCards}</div></div>`;
    res.send(renderPage('Rule Catalog', html, u, req));
  }));

  // ── ROUTE 12: GET /school/segments/api/:id — JSON API ────
  app.get('/school/segments/api/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req), segId = req.params.id;
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 50));
    const offset = Math.max(0, parseInt(req.query.offset) || 0);
    const { rows: segs } = await pool.query('SELECT * FROM user_segments WHERE id=$1 AND tenant_id=$2', [segId, tid]);
    if (!segs.length) return res.status(404).json({ error: 'Segment not found' });
    const seg = segs[0];
    const { rows: members } = await pool.query(
      'SELECT user_email, matched_rules, added_at FROM user_segment_members WHERE segment_id=$1 AND tenant_id=$2 ORDER BY user_email LIMIT $3 OFFSET $4',
      [segId, tid, limit, offset]);
    const { rows: total } = await pool.query(
      'SELECT COUNT(*)::int as c FROM user_segment_members WHERE segment_id=$1 AND tenant_id=$2', [segId, tid]);
    res.json({
      segment: { id: seg.id, name: seg.name, description: seg.description, rules: seg.rules, is_active: seg.is_active, user_count: seg.user_count, last_refreshed: seg.last_refreshed },
      pagination: { total: total[0].c, limit, offset, has_more: offset + limit < total[0].c },
      members: members.map(m => ({ email: m.user_email, matched_rules: typeof m.matched_rules === 'string' ? JSON.parse(m.matched_rules||'{}') : m.matched_rules, added_at: m.added_at }))
    });
  }));

  // ── Helper: parse rules from request body ────────────────
  function parseRulesFromBody(rules) {
    if (!rules) return [];
    if (typeof rules === 'string') { try { return JSON.parse(rules); } catch { return []; } }
    if (Array.isArray(rules)) return rules;
    // Handle bracket notation: rules[0][field], rules[0][value], etc.
    const result = [];
    const keys = Object.keys(rules);
    const indices = new Set();
    for (const k of keys) { const m = k.match(/\[(\d+)\]/); if (m) indices.add(parseInt(m[1])); }
    for (const i of [...indices].sort((a, b) => a - b)) {
      const field = rules[`rules[${i}][field]`];
      const value = rules[`rules[${i}][value]`];
      const logic = rules[`rules[${i}][logic]`] || 'AND';
      const valueFrom = rules[`rules[${i}][value_from]`];
      const valueTo = rules[`rules[${i}][value_to]`];
      if (!field) continue;
      const finalValue = valueFrom && valueTo ? `${valueFrom},${valueTo}` : (value || '');
      result.push({ field, value: finalValue, logic });
    }
    return result;
  }

  // ── Helper: refresh segment membership ───────────────────
  async function refreshSegmentMembership(tid, segId, rules) {
    if (!rules || !rules.length) {
      await pool.query('DELETE FROM user_segment_members WHERE segment_id=$1 AND tenant_id=$2', [segId, tid]);
      await pool.query('UPDATE user_segments SET user_count=0, last_refreshed=NOW() WHERE id=$1 AND tenant_id=$2', [segId, tid]);
      return 0;
    }
    const { sql, params } = buildRuleSQL(rules);
    const query = `SELECT email, role, class_name, fee_status, attendance_pct, avg_grade, last_login, engagement_score, created_at, feature_usage FROM users WHERE tenant_id=$1 AND (${sql})`;
    const { rows: matched } = await pool.query(query, [tid, ...params]);
    await pool.query('DELETE FROM user_segment_members WHERE segment_id=$1 AND tenant_id=$2', [segId, tid]);
    if (matched.length > 0) {
      const values = matched.map((m, i) => {
        const matchedRules = {};
        rules.forEach((r, ri) => { matchedRules[r.field] = evaluateRule(r, m); });
        return `($1, $${i*3+2}, $${i*3+3}, $${i*3+4}, NOW())`;
      }).join(',');
      const flatParams = matched.flatMap(m => {
        const matchedRules = {};
        rules.forEach(r => { matchedRules[r.field] = evaluateRule(r, m); });
        return [segId, m.email, JSON.stringify(matchedRules), tid];
      });
      // Build batch insert
      const insertQuery = `INSERT INTO user_segment_members (segment_id, user_email, matched_rules, tenant_id, added_at) VALUES `;
      const placeholders = matched.map((_, i) => `($1, $${i*3+2}, $${i*3+3}, $${i*3+4}, NOW())`).join(',');
      await pool.query(insertQuery + placeholders, flatParams);
    }
    await pool.query('UPDATE user_segments SET user_count=$1, last_refreshed=NOW() WHERE id=$2 AND tenant_id=$3', [matched.length, segId, tid]);
    return matched.length;
  }

  // ── Helper: evaluate single rule against user record ────
  function evaluateRule(rule, user) {
    const { field, value } = rule;
    switch (field) {
      case 'role_is': return user.role === value;
      case 'class_in': return value.split(',').map(c => c.trim()).includes(user.class_name);
      case 'fee_status': return user.fee_status === value;
      case 'attendance_above': return (user.attendance_pct || 0) >= parseFloat(value);
      case 'attendance_below': return (user.attendance_pct || 0) <= parseFloat(value);
      case 'grade_above': return (user.avg_grade || 0) >= parseFloat(value);
      case 'grade_below': return (user.avg_grade || 0) <= parseFloat(value);
      case 'login_after': return user.last_login && new Date(user.last_login) >= new Date(value);
      case 'login_before': return user.last_login && new Date(user.last_login) <= new Date(value);
      case 'has_feature_usage': return Array.isArray(user.feature_usage) && user.feature_usage.includes(value);
      case 'engagement_score_above': return (user.engagement_score || 0) >= parseFloat(value);
      case 'engagement_score_below': return (user.engagement_score || 0) <= parseFloat(value);
      case 'account_age_days_above': {
        const age = user.created_at ? (Date.now() - new Date(user.created_at).getTime()) / (1000*60*60*24) : 0;
        return age >= parseFloat(value);
      }
      case 'created_between': {
        const parts = value.split(',');
        if (parts.length < 2) return false;
        const d = user.created_at ? new Date(user.created_at) : null;
        return d && d >= new Date(parts[0].trim()) && d <= new Date(parts[1].trim());
      }
      default: return false;
    }
  }

  // ── Helper: get rule example string ─────────────────────
  function getRuleExample(key) {
    const examples = {
      role_is: 'role_is = "student" → matches all students',
      class_in: 'class_in = "10-A, 10-B" → matches classes 10-A and 10-B',
      fee_status: 'fee_status = "overdue" → matches users with overdue fees',
      attendance_above: 'attendance_above = 85 → users with ≥85% attendance',
      attendance_below: 'attendance_below = 50 → users with ≤50% attendance',
      grade_above: 'grade_above = 80 → users scoring ≥80 average',
      grade_below: 'grade_below = 40 → users scoring ≤40 average',
      login_after: 'login_after = 2025-01-01 → active since Jan 2025',
      login_before: 'login_before = 2024-06-01 → inactive since before Jun 2024',
      has_feature_usage: 'has_feature_usage = "lms" → used the LMS module',
      engagement_score_above: 'engagement_score_above = 70 → highly engaged users',
      engagement_score_below: 'engagement_score_below = 30 → disengaged users',
      account_age_days_above: 'account_age_days_above = 90 → accounts older than 90 days',
      created_between: 'created_between = 2024-01-01, 2024-12-31 → accounts created in 2024',
    };
    return examples[key] || key;
  }

  // ── Helper: generate insight recommendations ─────────────
  function generateRecommendations(segments, ruleTypeUsage) {
    const recs = [];
    if (segments.length === 0) {
      recs.push('Create your first segment to start targeting users dynamically.');
      recs.push('Start with simple role-based segments (e.g., "All Students").');
      return recs.map(r => `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#1e1b4b">💡 ${esc(r)}</div>`).join('');
    }
    const inactiveSegs = segments.filter(s => !s.is_active).length;
    if (inactiveSegs > 0) recs.push(`You have <strong>${inactiveSegs} inactive</strong> segment${inactiveSegs > 1 ? 's' : ''}. Consider activating or deleting them.`);
    const emptySegs = segments.filter(s => !s.user_count || s.user_count === 0).length;
    if (emptySegs > 0) recs.push(`<strong>${emptySegs} segment${emptySegs > 1 ? 's have' : ' has'}</strong> no matched users. Try broadening the rules.`);
    const singleRuleSegs = segments.filter(s => { const r = typeof s.rules === 'string' ? JSON.parse(s.rules||'[]') : s.rules||[]; return r.length <= 1; });
    if (singleRuleSegs.length > 0 && segments.length > 2) recs.push(`${singleRuleSegs.length} segment${singleRuleSegs.length > 1 ? 's use' : ' uses'} only 1 rule. Consider combining rules for more precise targeting.`);
    const topRule = Object.entries(ruleTypeUsage).sort((a, b) => b[1] - a[1])[0];
    if (topRule) { const rt = RULE_TYPES.find(t => t.key === topRule[0]); recs.push(`"<strong>${rt ? rt.label : topRule[0]}</strong>" is your most used rule (${topRule[1]}×). Consider exploring less-used rules for deeper insights.`); }
    if (segments.length > 5) recs.push('With many segments, use the <strong>insights page</strong> regularly to avoid overlapping definitions.');
    recs.push('Use the <strong>bulk action</strong> feature to send targeted emails or assign roles to entire segments at once.');
    return recs.map(r => `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6;font-size:13px;color:#1e1b4b">💡 ${r}</div>`).join('');
  }

  console.log('[UserSegmentation] Module loaded — 12 routes registered under /school/segments');
};
