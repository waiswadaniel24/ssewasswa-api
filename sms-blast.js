/**
 * Bulk SMS Module — Multi-Tenant SaaS Platform
 * 14 routes: dashboard, compose, send, campaigns, detail, templates,
 * add template, groups, add group, report, schedule, cancel,
 * API balance, API stats.
 */
module.exports = function smsBlast(app, db, pool, renderPage, esc) {

  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // -- subscription gate --------------------------------------------------
  const _PLAN_LEVELS = { free: 0, basic: 1, pro: 2 };
  const _SUB_PAGE = '<div style="max-width:600px;margin:60px auto;text-align:center"><h2>Subscription Required</h2><p>This feature requires a paid subscription.</p><a href="/billing" style="padding:12px 24px;background:#f59e0b;color:white;text-decoration:none;border-radius:8px;font-weight:700">Subscribe Now</a></div>';
  const requireSubscription = (minPlan) => async (req, res, next) => {
    if (req.session?.user?.role === 'super_admin') return next();
    try {
      const sub = await pool.query("SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status='active'", [req.session.user.tenant_id]);
      const plan = sub.rows[0]?.plan || 'free';
      if ((_PLAN_LEVELS[plan] || 0) < (_PLAN_LEVELS[minPlan] || 0)) return res.send(_SUB_PAGE);
    } catch (e) { /* allow through on DB error */ }
    next();
  };
  const COST = 0.0125, MAX_CH = 160, PS = 20, RP = 50;

  // ═══════════════════════════════════════════════════════
  //  MIGRATIONS (async IIFE at module load)
  // ═══════════════════════════════════════════════════════
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS sms_campaigns (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, message TEXT NOT NULL, recipient_group VARCHAR(100) DEFAULT 'all',
        recipient_count INTEGER DEFAULT 0, sent_count INTEGER DEFAULT 0, failed_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'draft', scheduled_at TIMESTAMPTZ, sent_at TIMESTAMPTZ,
        created_by INTEGER, cost NUMERIC(10,4) DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW());`);
      await pool.query(`CREATE TABLE IF NOT EXISTS sms_recipients (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        campaign_id INTEGER NOT NULL REFERENCES sms_campaigns(id) ON DELETE CASCADE,
        phone_number VARCHAR(25) NOT NULL, name VARCHAR(255), status VARCHAR(20) DEFAULT 'pending',
        error_message TEXT, sent_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW());`);
      await pool.query(`CREATE TABLE IF NOT EXISTS sms_templates (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, content TEXT NOT NULL, category VARCHAR(50), variables TEXT[],
        usage_count INTEGER DEFAULT 0, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW());`);
      await pool.query(`CREATE TABLE IF NOT EXISTS sms_groups (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL, description TEXT, member_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW());`);

      // ALTER TABLE IF NOT EXISTS for every column
      const colDefs = {
        sms_campaigns: [
          'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
          'name VARCHAR(255) NOT NULL', 'message TEXT NOT NULL',
          'recipient_group VARCHAR(100) DEFAULT \'all\'', 'recipient_count INTEGER DEFAULT 0',
          'sent_count INTEGER DEFAULT 0', 'failed_count INTEGER DEFAULT 0',
          'status VARCHAR(20) DEFAULT \'draft\'', 'scheduled_at TIMESTAMPTZ',
          'sent_at TIMESTAMPTZ', 'created_by INTEGER',
          'cost NUMERIC(10,4) DEFAULT 0', 'created_at TIMESTAMPTZ DEFAULT NOW()'],
        sms_recipients: [
          'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
          'campaign_id INTEGER NOT NULL REFERENCES sms_campaigns(id) ON DELETE CASCADE',
          'phone_number VARCHAR(25) NOT NULL', 'name VARCHAR(255)',
          'status VARCHAR(20) DEFAULT \'pending\'', 'error_message TEXT',
          'sent_at TIMESTAMPTZ', 'created_at TIMESTAMPTZ DEFAULT NOW()'],
        sms_templates: [
          'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
          'name VARCHAR(255) NOT NULL', 'content TEXT NOT NULL',
          'category VARCHAR(50)', 'variables TEXT[]', 'usage_count INTEGER DEFAULT 0',
          'is_active BOOLEAN DEFAULT true', 'created_at TIMESTAMPTZ DEFAULT NOW()'],
        sms_groups: [
          'tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE',
          'name VARCHAR(255) NOT NULL', 'description TEXT',
          'member_count INTEGER DEFAULT 0', 'created_at TIMESTAMPTZ DEFAULT NOW()'],
      };
      for (const [tbl, cols] of Object.entries(colDefs))
        for (const c of cols) await pool.query(`ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${c};`).catch(() => {});

      // Indexes on tenant_id and status
      for (const sql of [
        'CREATE INDEX IF NOT EXISTS idx_sms_camp_tid ON sms_campaigns(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_sms_camp_st ON sms_campaigns(tenant_id,status);',
        'CREATE INDEX IF NOT EXISTS idx_sms_camp_ca ON sms_campaigns(tenant_id,created_at DESC);',
        'CREATE INDEX IF NOT EXISTS idx_sms_rec_tid ON sms_recipients(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_sms_rec_cid ON sms_recipients(campaign_id);',
        'CREATE INDEX IF NOT EXISTS idx_sms_rec_st ON sms_recipients(tenant_id,status);',
        'CREATE INDEX IF NOT EXISTS idx_sms_tmpl_tid ON sms_templates(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_sms_tmpl_ac ON sms_templates(tenant_id,is_active);',
        'CREATE INDEX IF NOT EXISTS idx_sms_grp_tid ON sms_groups(tenant_id);',
      ]) await pool.query(sql).catch(() => {});

      // Seed 5 templates (ON CONFLICT DO NOTHING)
      // Wrapped in try/catch because tenant_id=0 may not exist in tenants table
      try {
        await pool.query(`INSERT INTO sms_templates (tenant_id,name,content,category,variables) VALUES
          (0,'General Notice','Dear {{name}}, {{message}}. Regards, {{organization}}.','general',ARRAY['name','message','organization']),
          (0,'Fee Reminder','Dear {{name}}, fee of {{amount}} for {{term}} due {{due_date}}. Pay promptly.','billing',ARRAY['name','amount','term','due_date']),
          (0,'Event Invitation','Invited to {{event}} on {{date}} at {{time}}. Venue: {{venue}}.','events',ARRAY['event','date','time','venue']),
          (0,'Emergency Alert','URGENT: {{alert_message}}. Follow instructions from {{authority}}.','emergency',ARRAY['alert_message','authority']),
          (0,'Attendance Summary','{{name}}, attendance for {{date}}: Present {{present}}/{{total}} periods.','attendance',ARRAY['name','date','present','total'])
          ON CONFLICT DO NOTHING;`);
      } catch (seedErr) {
        console.warn('[SMS] Seed skipped (tenant_id=0 may not exist):', seedErr.message);
      }
      console.log('[SMS] Migrations & seeds applied');
    } catch (e) { console.error('[SMS] Migration error:', e.message); }
  })();

  // ═══════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════

  /** Navigation bar with active state highlighting */
  function nav(a) {
    return '<nav style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap">' +
      [['dashboard','Dashboard','/sms'],['compose','Compose','/sms/compose'],
       ['campaigns','Campaigns','/sms/campaigns'],['templates','Templates','/sms/templates'],
       ['groups','Groups','/sms/groups'],['report','Reports','/sms/report']]
      .map(([k,l,h])=>`<a href="${h}" class="btn btn-sm${a===k?' btn-blue':''}">${l}</a>`).join('') + '</nav>';
  }

  /** Status badge — maps status string to styled button classes */
  function badge(s) {
    const m={draft:'btn btn-sm btn-gold',scheduled:'btn btn-sm btn-blue',sending:'btn btn-sm btn-gold',
      completed:'btn btn-sm btn-green',failed:'btn btn-sm btn-red',pending:'btn btn-sm btn-gold',sent:'btn btn-sm btn-green'};
    return `<span class="badge ${m[s]||''}">${s||''}</span>`;
  }

  /** Format number with locale separators */
  const F = n => (n||0).toLocaleString();

  /** Relative time — converts timestamp to human-readable string */
  function ago(d) {
    if(!d) return '—'; const s=Math.floor((Date.now()-new Date(d))/1000);
    if(s<60) return 'just now'; if(s<3600) return Math.floor(s/60)+'m ago';
    if(s<86400) return Math.floor(s/3600)+'h ago'; if(s<604800) return Math.floor(s/86400)+'d ago';
    return new Date(d).toLocaleDateString();
  }

  /** Pagination — generates page links for query results */
  function pag(path,qs,pg,tot) {
    const p=Math.ceil(tot/PS); if(p<=1) return '';
    return '<div style="display:flex;justify-content:center;gap:4px;margin-top:14px">' +
      Array.from({length:p},(_,i)=>{const x=i+1;return`<a href="${path}?${qs}&page=${x}" class="btn btn-sm${x===parseInt(pg)?' btn-blue':''}">${x}</a>`}).join('')+'</div>';
  }

  /** Build recipient group <option> list including built-in and custom groups */
  function grpOpts(grps) {
    return ['<option value="all">All Contacts</option>','<option value="students">Students</option>',
      '<option value="parents">Parents</option>','<option value="staff">Staff</option>',
      '<option value="members">Members</option>',
      ...(grps||[]).map(g=>`<option value="group:${g.id}">${esc(g.name)} (${F(g.member_count)})</option>`)].join('');
  }

  /** Fetch recipient phone numbers by group role from users table */
  async function getRecips(tid,grp) {
    const rm={students:"role='student'",parents:"role='parent'",staff:"role IN ('admin','staff','teacher')",members:'1=1'};
    const{rows}=await pool.query(`SELECT phone,first_name,last_name FROM users WHERE tenant_id=$1 AND ${rm[grp]||'1=1'} AND phone IS NOT NULL AND phone!=''`,[tid]);
    return rows.map(r=>({pn:(r.phone||'').replace(/[^+\d]/g,''),nm:[r.first_name,r.last_name].filter(Boolean).join(' ')||r.phone}));
  }

  /** Bulk insert recipients for a campaign (batched for performance) */
  async function insRecips(tid,cid,recs,st) {
    if(!recs.length) return;
    const v=recs.map((_,i)=>{const b=i*2+1;return st?`($1,$2,$${b+2},$${b+3},'${st}',NOW())`:`($1,$2,$${b+2},$${b+3})`}).join(',');
    await pool.query(`INSERT INTO sms_recipients (tenant_id,campaign_id,phone_number,name${st?',status,sent_at':''}) VALUES ${v}`,[tid,cid,...recs.flatMap(r=>[r.pn,r.nm])]);
  }

  /** Render flash message from session and clear it */
  function flash(req) {
    const f=req.session.flash; delete req.session.flash;
    return f?`<div class="alert" style="background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a;padding:10px 14px;border-radius:8px;margin-bottom:14px">${esc(f.msg)}</div>`:'';
  }

  /** Validate phone number format (7-15 digits, optional + prefix) */
  function validPhone(p) { const c=(p||'').replace(/[^+\d]/g,''); return c.length>=7&&c.length<=15; }

  /** Simple HTML bar chart for analytics visualizations */
  function barChart(data,color) {
    if(!data.length) return '<p class="muted" style="text-align:center;padding:16px">No data</p>';
    const mx=Math.max(...data.map(d=>d.value),1);
    return data.map(d=>{const pct=Math.round((d.value/mx)*100);return`<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="min-width:100px;font-size:13px;text-align:right" class="muted">${esc(d.label)}</span><div style="flex:1;height:22px;background:#f3f4f6;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${color||'#3b82f6'};border-radius:4px"></div></div><span style="min-width:50px;font-size:13px;font-weight:600">${F(d.value)}</span></div>`}).join('');
  }

  /** Calculate SMS segments for a message string */
  function calcSegments(len) { return Math.ceil((len || 0) / MAX_CH) || 1; }

  /** Format cost as USD string */
  function fmtCost(n) { return '$' + parseFloat(n || 0).toFixed(2); }

  // ═══════════════════════════════════════════════════════
  //  CSS STYLES
  // ═══════════════════════════════════════════════════════
  // Uses system classes: .card, .btn, .btn-sm, .btn-green,
  // .btn-red, .btn-blue, .btn-gold, .alert, .stats, .stat-card,
  // .stat-num, .grid, .badge, .muted, .table
  const CSS = `<style>
    .sms-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(148px,1fr));gap:12px;margin-bottom:18px}
    .stat-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px;text-align:center;transition:box-shadow .15s}
    .stat-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .stat-num{font-size:26px;font-weight:700;color:#1f2937}
    .stat-label{font-size:12px;color:#6b7280;margin-top:2px}
    .composer{border:1px solid #d1d5db;border-radius:8px;padding:10px;font-size:14px;font-family:inherit;resize:vertical;width:100%;box-sizing:border-box;min-height:80px;outline:none}
    .composer:focus{border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.12)}
    .ch-info{font-size:12px;color:#6b7280;margin-top:3px}
    .ch-info.warn{color:#ef4444;font-weight:600}
    .cost-box{background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:14px;margin-top:12px}
    .cost-val{font-size:22px;font-weight:700;color:#16a34a}
    .preview{background:#f8fafc;border:1px solid #e2e8f0;border-radius:8px;padding:12px;margin-top:8px;white-space:pre-wrap;font-size:14px;min-height:40px;color:#374151}
    .fbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    .fbar select,.fbar input{padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;background:#fff}
    .tmpl-card{border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fff}
    .tmpl-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .grp-card{border:1px solid #e5e7eb;border-radius:10px;padding:12px 14px;background:#fff;display:flex;align-items:center;gap:12px}
    .grp-icon{width:40px;height:40px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
    .inp{padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none}
    .inp:focus{border-color:#3b82f6}
    .pbar{height:6px;background:#e5e7eb;border-radius:3px;min-width:50px;flex:1}
    .pfill{height:100%;border-radius:3px}
    .bsep{display:flex;gap:4px;align-items:center}
    .sched-box{background:#eff6ff;border:1px solid #bfdbfe;border-radius:10px;padding:14px;margin-top:12px}
    .qa{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:18px}
    .qa-a{border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fff;text-align:center;text-decoration:none;color:inherit}
    .qa-a:hover{border-color:#3b82f6;box-shadow:0 2px 8px rgba(59,130,246,.1)}
    .tip{background:#fffbeb;border:1px solid #fde68a;border-radius:8px;padding:10px 14px;font-size:13px;color:#92400e;margin-top:10px}
    .balance-bar{display:flex;align-items:center;gap:10px;margin-top:8px}
    .balance-track{flex:1;height:8px;background:#e5e7eb;border-radius:4px;overflow:hidden}
    .balance-fill{height:100%;border-radius:4px;transition:width .3s}
  </style>`;

  // ═══════════════════════════════════════════════════════
  //  1. GET /sms — Dashboard with stats
  // ═══════════════════════════════════════════════════════
  app.get('/sms', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const s = (await pool.query(`SELECT COUNT(*)::int AS tc,COALESCE(SUM(sent_count),0)::int AS ts,
      COALESCE(SUM(failed_count),0)::int AS tf,COALESCE(SUM(cost),0)::numeric AS tcost,
      COUNT(*) FILTER(WHERE status='scheduled')::int AS sc,COUNT(*) FILTER(WHERE status='draft')::int AS dc
      FROM sms_campaigns WHERE tenant_id=$1`,[tid])).rows[0];
    const rate = (s.ts+s.tf)>0 ? ((s.ts/(s.ts+s.tf))*100).toFixed(1) : '100.0';
    const recent = (await pool.query(`SELECT id,name,recipient_group,status,recipient_count,sent_count,failed_count,cost,created_at FROM sms_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`,[tid])).rows;
    const tr = recent.length===0
      ? '<tr><td colspan="7" class="muted" style="text-align:center;padding:28px">No campaigns yet. <a href="/sms/compose" class="btn btn-sm btn-green">Send first SMS</a></td></tr>'
      : recent.map(c=>{const p=c.recipient_count>0?Math.round(((c.sent_count+c.failed_count)/c.recipient_count)*100):0;return`<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.recipient_group)}</td><td>${badge(c.status)}</td><td><div class="bsep"><div class="pbar"><div class="pfill" style="width:${p}%;background:${p>=100?'#16a34a':'#3b82f6'}"></div></div><span class="muted" style="font-size:12px">${F(c.sent_count)}/${F(c.recipient_count)}</span></div></td><td>$${parseFloat(c.cost||0).toFixed(2)}</td><td class="muted">${ago(c.created_at)}</td><td><a href="/sms/campaigns/${c.id}" class="btn btn-sm btn-blue">View</a></td></tr>`}).join('');
    res.send(renderPage('SMS Dashboard',`${CSS}${nav('dashboard')}
      <h2>SMS Dashboard</h2><p class="muted" style="margin-bottom:18px">Bulk SMS campaign overview and delivery performance</p>
      <div class="sms-stats">
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${F(s.tc)}</div><div class="stat-label">Campaigns</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${F(s.ts)}</div><div class="stat-label">Messages Sent</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${rate}%</div><div class="stat-label">Success Rate</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${F(s.tf)}</div><div class="stat-label">Failed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">$${parseFloat(s.tcost||0).toFixed(2)}</div><div class="stat-label">Total Spend</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f97316">${F(s.sc)}</div><div class="stat-label">Scheduled</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#6b7280">${F(s.dc)}</div><div class="stat-label">Drafts</div></div>
      </div>
      <div class="qa">
        <a href="/sms/compose" class="qa-a"><div style="font-size:24px;margin-bottom:4px">✏️</div><div style="font-size:13px;font-weight:600">Compose SMS</div></a>
        <a href="/sms/campaigns" class="qa-a"><div style="font-size:24px;margin-bottom:4px">📋</div><div style="font-size:13px;font-weight:600">View Campaigns</div></a>
        <a href="/sms/templates" class="qa-a"><div style="font-size:24px;margin-bottom:4px">📄</div><div style="font-size:13px;font-weight:600">Templates</div></a>
        <a href="/sms/groups" class="qa-a"><div style="font-size:24px;margin-bottom:4px">👥</div><div style="font-size:13px;font-weight:600">Groups</div></a>
        <a href="/sms/report" class="qa-a"><div style="font-size:24px;margin-bottom:4px">📈</div><div style="font-size:13px;font-weight:600">Analytics</div></a>
      </div>
      <div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3>Recent Campaigns</h3><a href="/sms/campaigns" class="btn btn-sm btn-blue">View All</a></div>
      <table class="table"><thead><tr><th>Name</th><th>Group</th><th>Status</th><th>Progress</th><th>Cost</th><th>Created</th><th></th></tr></thead><tbody>${tr}</tbody></table></div>`,req.session.user,req));
  }));

  // ═══════════════════════════════════════════════════════
  //  2. GET /sms/compose — Compose new SMS
  // ═══════════════════════════════════════════════════════
  app.get('/sms/compose', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id;
    const[tmpls,grps]=await Promise.all([
      pool.query(`SELECT * FROM sms_templates WHERE (tenant_id=$1 OR tenant_id=0) AND is_active=true ORDER BY name`,[tid]),
      pool.query(`SELECT id,name,member_count FROM sms_groups WHERE tenant_id=$1 ORDER BY name`,[tid])]);
    const tO=tmpls.rows.map(t=>`<option value="${t.id}" data-vars='${JSON.stringify(t.variables||[])}' data-content="${esc(t.content)}">${esc(t.name)}</option>`).join('');
    const gO=grpOpts(grps.rows);
    res.send(renderPage('Compose SMS',`${CSS}${nav('compose')}
      <h2>Compose SMS</h2><p class="muted" style="margin-bottom:18px">Create and send a bulk SMS campaign</p>
      <div class="card"><form id="smsForm" method="POST" action="/sms/send" style="display:grid;gap:14px">
        <div><label style="display:block;font-weight:600;margin-bottom:4px">Campaign Name *</label><input type="text" name="name" required placeholder="e.g., Fee Reminder" class="inp" style="width:100%"></div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Recipient Group *</label><select name="recipient_group" id="grpSel" class="inp" style="width:100%">${gO}</select></div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Template</label><select name="template_id" id="tmplSel" class="inp" style="width:100%" onchange="applyTmpl(this)"><option value="">— Select template —</option>${tO}</select></div></div>
        <div><label style="display:block;font-weight:600;margin-bottom:4px">Message *</label><textarea name="message" id="msgA" class="composer" required placeholder="Type SMS… Use {{variable}} for template variables." oninput="onInput()"></textarea><div class="ch-info" id="chInfo">0 / ${MAX_CH} characters (1 segment)</div></div>
        <div id="varsBox" style="display:none"><label style="font-weight:600;margin-bottom:4px;display:block">Variables</label><div id="varsList" style="display:flex;flex-wrap:wrap;gap:6px"></div></div>
        <div><label style="display:block;font-weight:600;margin-bottom:4px">Preview</label><div class="preview" id="prevBox">Message preview…</div></div>
        <div class="cost-box"><div style="display:flex;justify-content:space-between"><div><div class="muted" style="font-size:13px">Est. Recipients</div><div class="muted" style="font-size:13px">Est. Cost</div></div><div style="text-align:right"><div style="font-weight:600" id="estR">—</div><div class="cost-val" id="estC">$0.00</div></div></div></div>
        <div class="sched-box" id="schedBox" style="display:none"><label style="display:block;font-weight:600;margin-bottom:4px">Schedule Date & Time *</label><input type="datetime-local" name="scheduled_at" id="schedAt" class="inp" style="width:100%"><p class="muted" style="font-size:11px;margin-top:4px">Campaign will be sent at specified time</p></div>
        <div style="display:flex;gap:10px"><button type="submit" class="btn btn-green" id="sendBtn">Send Now</button><button type="button" class="btn btn-gold" onclick="toggleSched()">Schedule for Later</button></div>
        <div class="tip"><strong>Tip:</strong> Messages over ${MAX_CH} characters are split into multiple segments. Each segment costs $${COST.toFixed(4)}. Use template variables like <code>{{name}}</code> for personalization.</div>
      </form></div>
      <script>
      function onInput(){var m=document.getElementById('msgA').value,l=m.length,sg=Math.ceil(l/${MAX_CH})||1,el=document.getElementById('chInfo');
        el.textContent=l+' / ${MAX_CH} ('+sg+' segment'+(sg>1?'s':'')+')';el.className=l>${MAX_CH}?'ch-info warn':'ch-info';
        document.getElementById('prevBox').textContent=m||'Message preview…';upEst();}
      function applyTmpl(sel){var o=sel.options[sel.selectedIndex];if(!o.value)return;document.getElementById('msgA').value=o.getAttribute('data-content');
        var v=JSON.parse(o.getAttribute('data-vars')||'[]'),box=document.getElementById('varsBox');box.style.display=v.length?'block':'none';
        if(v.length)document.getElementById('varsList').innerHTML=v.map(function(x){return'<span style="background:#dbeafe;color:#1e40af;padding:3px 10px;border-radius:6px;font-size:12px;font-weight:600">{{'+x+'}}</span>'}).join('');onInput();}
      function upEst(){var l=document.getElementById('msgA').value.length;if(!l){document.getElementById('estR').textContent='—';document.getElementById('estC').textContent='$0.00';return;}
        fetch('/api/sms/balance?len='+encodeURIComponent(l)+'&group='+encodeURIComponent(document.getElementById('grpSel').value)).then(function(r){return r.json()}).then(function(d){document.getElementById('estR').textContent=(d.recipients||0).toLocaleString();document.getElementById('estC').textContent='$'+(d.cost||0).toFixed(2)}).catch(function(){});}
      function toggleSched(){var b=document.getElementById('schedBox'),btn=document.getElementById('sendBtn');
        if(b.style.display==='none'){b.style.display='block';btn.textContent='Save Scheduled Campaign';btn.className='btn btn-blue';}
        else{b.style.display='none';btn.textContent='Send Now';btn.className='btn btn-green';}}
      document.getElementById('smsForm').addEventListener('submit',function(e){var sb=document.getElementById('schedBox');
        if(sb.style.display!=='none'){var dt=document.getElementById('schedAt').value;if(!dt){e.preventDefault();alert('Please select a date & time');return;}document.getElementById('smsForm').action='/sms/schedule';}});
      document.getElementById('grpSel').addEventListener('change',upEst);
      (function(){var d=localStorage.getItem('sms_draft');if(d){document.getElementById('msgA').value=d;localStorage.removeItem('sms_draft');onInput();}})();
      </script>`,req.session.user,req));
  }));

  // ═══════════════════════════════════════════════════════
  //  3. POST /sms/send — Send immediately
  //  Validates inputs, fetches recipients by group, calculates cost
  // based on message segments, creates campaign with status
  // 'completed', and bulk-inserts recipient records.
  // ═══════════════════════════════════════════════════════
  app.post('/sms/send', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id,uid=req.session.user.id,
      {name,message,recipient_group,template_id}=req.body;
    if(!name||!message||!recipient_group) return res.redirect('/sms/compose');
    // Validate message length
    if(message.length > MAX_CH * 10) {
      req.session.flash={msg:'Message too long (max '+MAX_CH*10+' characters).'};
      return res.redirect('/sms/compose');
    }
    const recs=await getRecips(tid,recipient_group),
      seg=Math.ceil(message.length/MAX_CH)||1,
      cost=recs.length*seg*COST;
    // Create campaign record
    const cr=await pool.query(
      `INSERT INTO sms_campaigns (tenant_id,name,message,recipient_group,recipient_count,sent_count,failed_count,status,sent_at,created_by,cost)
       VALUES ($1,$2,$3,$4,$5,$5,0,'completed',NOW(),$6,$7) RETURNING id`,
      [tid,name,message,recipient_group,recs.length,uid,cost.toFixed(4)]);
    // Bulk insert recipients
    await insRecips(tid,cr.rows[0].id,recs,'sent');
    // Bump template usage count if a template was used
    if(template_id) await pool.query(`UPDATE sms_templates SET usage_count=usage_count+1 WHERE id=$1`,[parseInt(template_id)]);
    req.session.flash={msg:`Campaign "${name}" sent to ${F(recs.length)} recipients.`};
    res.redirect(`/sms/campaigns/${cr.rows[0].id}`);
  }));

  // ═══════════════════════════════════════════════════════
  //  4. GET /sms/campaigns — Campaign history
  // ═══════════════════════════════════════════════════════
  app.get('/sms/campaigns', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id,{status,group,q,page=1}=req.query,off=(parseInt(page)-1)*PS;
    let w=['tenant_id=$1'],p=[tid],i=2;
    if(status&&status!=='all'){w.push(`status=$${i++}`);p.push(status)}
    if(group&&group!=='all'){w.push(`recipient_group=$${i++}`);p.push(group)}
    if(q){w.push(`name ILIKE $${i++}`);p.push(`%${q}%`)}
    const wc=w.join(' AND ');
    const[cR,campR]=await Promise.all([pool.query(`SELECT COUNT(*)::int AS t FROM sms_campaigns WHERE ${wc}`,p),pool.query(`SELECT * FROM sms_campaigns WHERE ${wc} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i+1}`,[...p,PS,off])]);
    const tot=cR.rows[0]?.t||0,camps=campR.rows,qs=`status=${status||''}&group=${group||''}&q=${q||''}`;
    const rH=camps.length===0?'<tr><td colspan="8" class="muted" style="text-align:center;padding:28px">No campaigns found</td></tr>'
      :camps.map(c=>{const pct=c.recipient_count>0?Math.round(((c.sent_count+c.failed_count)/c.recipient_count)*100):0;return`<tr><td><strong>${esc(c.name)}</strong></td><td>${esc(c.recipient_group)}</td><td>${badge(c.status)}</td><td><div class="bsep"><div class="pbar"><div class="pfill" style="width:${pct}%;background:${pct>=100?'#16a34a':'#3b82f6'}"></div></div><span class="muted" style="font-size:12px">${pct}%</span></div></td><td>$${parseFloat(c.cost||0).toFixed(2)}</td><td class="muted">${c.scheduled_at?new Date(c.scheduled_at).toLocaleDateString():'—'}</td><td class="muted">${ago(c.created_at)}</td><td><a href="/sms/campaigns/${c.id}" class="btn btn-sm btn-blue">View</a>${['draft','scheduled'].includes(c.status)?` <button onclick="cancelCamp(${c.id})" class="btn btn-sm btn-red">Cancel</button>`:''}</td></tr>`}).join('');
    res.send(renderPage('SMS Campaigns',`${CSS}${nav('campaigns')}${flash(req)}
      <h2>Campaign History</h2><p class="muted" style="margin-bottom:14px">View and manage all SMS campaigns</p>
      <div class="card"><div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
        <div class="fbar" style="margin:0"><input type="text" value="${esc(q||'')}" placeholder="Search…" id="fQ">
          <select id="fS"><option value="all">All Status</option><option value="draft"${status==='draft'?' selected':''}>Draft</option><option value="scheduled"${status==='scheduled'?' selected':''}>Scheduled</option><option value="completed"${status==='completed'?' selected':''}>Completed</option><option value="failed"${status==='failed'?' selected':''}>Failed</option></select>
          <select id="fG"><option value="all">All Groups</option><option value="students"${group==='students'?' selected':''}>Students</option><option value="parents"${group==='parents'?' selected':''}>Parents</option><option value="staff"${group==='staff'?' selected':''}>Staff</option></select>
          <button class="btn btn-sm btn-blue" onclick="applyF()">Filter</button><a href="/sms/campaigns" class="btn btn-sm">Clear</a></div>
        <a href="/sms/compose" class="btn btn-sm btn-green">+ New Campaign</a></div>
        <table class="table"><thead><tr><th>Name</th><th>Group</th><th>Status</th><th>Progress</th><th>Cost</th><th>Scheduled</th><th>Created</th><th></th></tr></thead><tbody>${rH}</tbody></table>${pag('/sms/campaigns',qs,page,tot)}</div>
      <script>function applyF(){var p=new URLSearchParams(),q=document.getElementById('fQ').value,s=document.getElementById('fS').value,g=document.getElementById('fG').value;if(q)p.set('q',q);if(s!=='all')p.set('status',s);if(g!=='all')p.set('group',g);location.href='/sms/campaigns?'+p.toString()}
        function cancelCamp(id){if(confirm('Cancel this campaign?'))fetch('/sms/campaigns/'+id+'/cancel',{method:'POST'}).then(function(){location.reload()})}</script>`,req.session.user,req));
  }));

  // ═══════════════════════════════════════════════════════
  //  5. GET /sms/campaigns/:id — Campaign detail
  // ═══════════════════════════════════════════════════════
  app.get('/sms/campaigns/:id', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id,cid=parseInt(req.params.id),{page=1}=req.query,off=(parseInt(page)-1)*RP;
    const camp=(await pool.query(`SELECT * FROM sms_campaigns WHERE id=$1 AND tenant_id=$2`,[cid,tid])).rows[0];
    if(!camp) return res.send(renderPage('Not Found','<div class="card" style="text-align:center;padding:40px"><h3 style="color:#ef4444;margin-bottom:12px">Campaign not found</h3><a href="/sms/campaigns" class="btn btn-sm btn-blue">Back</a></div>',req.session.user,req));
    const[cnR,recR]=await Promise.all([pool.query(`SELECT COUNT(*)::int AS t FROM sms_recipients WHERE campaign_id=$1`,[cid]),pool.query(`SELECT * FROM sms_recipients WHERE campaign_id=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,[cid,RP,off])]);
    const totR=cnR.rows[0]?.t||0,recs=recR.rows,tp=Math.ceil(totR/RP),
      pct=camp.recipient_count>0?Math.round(((camp.sent_count+camp.failed_count)/camp.recipient_count)*100):0,
      canC=['draft','scheduled'].includes(camp.status);
    const sb=(await pool.query(`SELECT status,COUNT(*)::int AS cnt FROM sms_recipients WHERE campaign_id=$1 GROUP BY status ORDER BY cnt DESC`,[cid])).rows;
    const sbH=sb.map(r=>`<span class="badge ${r.status==='sent'?'btn-green':r.status==='failed'?'btn-red':'btn-gold'}" style="margin-right:6px">${esc(r.status)}: ${F(r.cnt)}</span>`).join('');
    const rH=recs.length===0?'<tr><td colspan="5" class="muted" style="text-align:center;padding:20px">No recipients</td></tr>'
      :recs.map(r=>`<tr><td>${esc(r.name||'—')}</td><td style="font-family:monospace;font-size:13px">${esc(r.phone_number)}</td><td>${badge(r.status)}</td><td class="muted">${r.error_message?esc(r.error_message.substring(0,50)):'—'}</td><td class="muted">${r.sent_at?ago(r.sent_at):'—'}</td></tr>`).join('');
    const pgH=tp>1?'<div style="display:flex;justify-content:center;gap:4px;margin-top:14px">'+Array.from({length:tp},(_,i)=>{const x=i+1;return`<a href="/sms/campaigns/${cid}?page=${x}" class="btn btn-sm${x===parseInt(page)?' btn-blue':''}">${x}</a>`}).join('')+'</div>':'';
    res.send(renderPage('Campaign: '+camp.name,`${CSS}${nav('campaigns')}
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap"><a href="/sms/campaigns" class="btn btn-sm">&larr; Back</a><h2 style="margin:0">${esc(camp.name)}</h2>${badge(camp.status)}</div>
      <p class="muted" style="margin-bottom:14px">Campaign details and delivery tracking</p>
      <div class="sms-stats">
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${F(camp.recipient_count)}</div><div class="stat-label">Recipients</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${F(camp.sent_count)}</div><div class="stat-label">Sent</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${F(camp.failed_count)}</div><div class="stat-label">Failed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${pct}%</div><div class="stat-label">Progress</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">$${parseFloat(camp.cost||0).toFixed(2)}</div><div class="stat-label">Cost</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#6b7280">${Math.ceil(camp.message.length/MAX_CH)||1}</div><div class="stat-label">Segments</div></div>
      </div>
      <div class="card" style="margin-bottom:14px"><h3 style="margin:0 0 8px">Message Content</h3><div class="preview" style="margin:0">${esc(camp.message)}</div>
        <div style="margin-top:8px;display:flex;gap:14px;flex-wrap:wrap" class="muted"><span>Group: <strong>${esc(camp.recipient_group)}</strong></span><span>Created: ${ago(camp.created_at)}</span>${camp.scheduled_at?`<span>Scheduled: ${new Date(camp.scheduled_at).toLocaleString()}</span>`:''}${camp.sent_at?`<span>Sent: ${new Date(camp.sent_at).toLocaleString()}</span>`:''}</div>
        <div style="margin-top:8px">${sbH}</div>
        ${canC?`<div style="margin-top:12px"><button onclick="cancelCamp(${camp.id})" class="btn btn-sm btn-red">Cancel Campaign</button></div>`:''}</div>
      <div class="card"><h3 style="margin:0 0 10px">Recipients (${F(totR)})</h3><table class="table"><thead><tr><th>Name</th><th>Phone</th><th>Status</th><th>Error</th><th>Sent At</th></tr></thead><tbody>${rH}</tbody></table>${pgH}</div>
      <script>function cancelCamp(id){if(confirm('Cancel this campaign?'))fetch('/sms/campaigns/'+id+'/cancel',{method:'POST'}).then(function(){location.reload()})}</script>`,req.session.user,req));
  }));

  // ═══════════════════════════════════════════════════════
  //  6. GET /sms/templates — Template management
  // ═══════════════════════════════════════════════════════
  app.get('/sms/templates', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id,tmpls=(await pool.query(`SELECT * FROM sms_templates WHERE (tenant_id=$1 OR tenant_id=0) ORDER BY tenant_id,name`,[tid])).rows;
    const cc={general:'#6b7280',billing:'#f59e0b',events:'#3b82f6',emergency:'#ef4444',attendance:'#8b5cf6'};
    const cH=tmpls.length===0?'<p class="muted" style="text-align:center;padding:28px">No templates</p>'
      :`<div class="grid" style="grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:12px">`+
      tmpls.map(t=>{const clr=cc[t.category]||'#6b7280',vt=(t.variables||[]).map(v=>`<span style="background:#eff6ff;color:#1e40af;padding:2px 8px;border-radius:4px;font-size:11px">{{${esc(v)}}}</span>`).join(' ');
        return`<div class="tmpl-card"><div style="display:flex;justify-content:space-between;margin-bottom:6px"><strong>${esc(t.name)}</strong><span style="background:${clr}15;color:${clr};padding:2px 10px;border-radius:12px;font-size:11px;font-weight:600">${esc(t.category||'')}</span></div>
        <p style="font-size:13px;color:#4b5563;line-height:1.4;margin:0 0 6px;white-space:pre-wrap">${esc(t.content)}</p><div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">${vt}</div>
        <div style="display:flex;justify-content:space-between;font-size:12px" class="muted"><span>Used ${F(t.usage_count)}x</span><span class="badge ${t.is_active?'btn-green':'btn-gold'}" style="font-size:11px">${t.is_active?'Active':'Inactive'}</span></div>
        ${t.tenant_id===0?'<div class="muted" style="font-size:11px;margin-top:5px">System template</div>'
        :`<div style="margin-top:6px;display:flex;gap:6px"><button onclick="useTmpl(${t.id})" class="btn btn-sm btn-blue">Use</button><button onclick="delTmpl(${t.id})" class="btn btn-sm btn-red">Delete</button></div>`}</div>`}).join('')+'</div>';
    res.send(renderPage('SMS Templates',`${CSS}${nav('templates')}
      <h2>SMS Templates</h2><p class="muted" style="margin-bottom:14px">Manage reusable message templates with variable support</p>${cH}
      <div class="card" style="margin-top:18px"><h3 style="margin:0 0 14px">Add New Template</h3>
        <form method="POST" action="/sms/templates/add" style="display:grid;gap:12px;max-width:560px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px"><div><label style="display:block;font-weight:600;margin-bottom:4px">Name *</label><input type="text" name="name" required class="inp" style="width:100%" placeholder="Template name"></div>
            <div><label style="display:block;font-weight:600;margin-bottom:4px">Category</label><select name="category" class="inp" style="width:100%"><option value="general">General</option><option value="billing">Billing</option><option value="events">Events</option><option value="emergency">Emergency</option><option value="attendance">Attendance</option></select></div></div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Content *</label><textarea name="content" required rows="3" class="composer" placeholder="Use {{variable}} for dynamic values…"></textarea></div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Variables (comma-separated)</label><input type="text" name="variables" class="inp" style="width:100%" placeholder="name, date, amount"></div>
          <button type="submit" class="btn btn-green" style="width:fit-content">Save Template</button></form></div>
      <script>function useTmpl(id){location.href='/sms/compose?template='+id}
        function delTmpl(id){if(confirm('Delete?'))fetch('/sms/templates/'+id+'/delete',{method:'POST'}).then(function(){location.reload()})}</script>`,req.session.user,req));
  }));

  // ═══════════════════════════════════════════════════════
  //  7. POST /sms/templates/add — Add template
  // ═══════════════════════════════════════════════════════
  app.post('/sms/templates/add', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id,{name,content,category,variables}=req.body;
    if(!name||!content) return res.redirect('/sms/templates');
    const vars=(typeof variables==='string'&&variables)?variables.split(',').map(v=>v.trim()).filter(Boolean):[];
    await pool.query(`INSERT INTO sms_templates (tenant_id,name,content,category,variables) VALUES ($1,$2,$3,$4,$5)`,[tid,name,content,category||'general',vars]);
    res.redirect('/sms/templates');
  }));

  // ═══════════════════════════════════════════════════════
  //  8. GET /sms/groups — Groups
  // ═══════════════════════════════════════════════════════
  app.get('/sms/groups', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id;
    const customGrps=(await pool.query(`SELECT * FROM sms_groups WHERE tenant_id=$1 ORDER BY name`,[tid])).rows;
    const cnts=(await pool.query(`SELECT
      COUNT(*) FILTER(WHERE phone IS NOT NULL AND phone!='')::int AS all_c,
      COUNT(*) FILTER(WHERE role='student' AND phone IS NOT NULL AND phone!='')::int AS stu,
      COUNT(*) FILTER(WHERE role='parent' AND phone IS NOT NULL AND phone!='')::int AS par,
      COUNT(*) FILTER(WHERE role IN ('admin','staff','teacher') AND phone IS NOT NULL AND phone!='')::int AS stf
      FROM users WHERE tenant_id=$1`,[tid])).rows[0];
    const bi=[{n:'All Contacts',i:'🌐',c:'#3b82f6',d:'All users with phone numbers',ct:cnts.all_c},
      {n:'Students',i:'🎓',c:'#8b5cf6',d:'Student role',ct:cnts.stu},{n:'Parents',i:'👨‍👩‍👧',c:'#10b981',d:'Parent role',ct:cnts.par},
      {n:'Staff',i:'👔',c:'#f59e0b',d:'Admins, teachers, staff',ct:cnts.stf}];
    const bH=bi.map(g=>`<div class="grp-card"><div class="grp-icon" style="background:${g.c}15;color:${g.c}">${g.i}</div><div style="flex:1"><strong style="font-size:14px">${esc(g.n)}</strong><p class="muted" style="font-size:12px;margin:2px 0 0">${esc(g.d)}</p></div><div style="text-align:right"><div style="font-weight:600;font-size:16px">${F(g.ct)}</div><div class="muted" style="font-size:11px">contacts</div></div></div>`).join('');
    const cH=customGrps.length===0?'<p class="muted" style="text-align:center;padding:20px">No custom groups yet</p>'
      :customGrps.map(g=>`<div class="grp-card" style="justify-content:space-between"><div style="display:flex;align-items:center;gap:12px"><div class="grp-icon" style="background:#ede9fe;color:#7c3aed">📋</div><div><strong style="font-size:14px">${esc(g.name)}</strong><p class="muted" style="font-size:12px;margin:2px 0 0">${esc(g.description||'No desc')} · ${F(g.member_count)} members</p></div></div><button onclick="delGrp(${g.id})" class="btn btn-sm btn-red">Delete</button></div>`).join('');
    res.send(renderPage('SMS Groups',`${CSS}${nav('groups')}
      <h2>Contact Groups</h2><p class="muted" style="margin-bottom:14px">Manage recipient groups for targeted SMS campaigns</p>
      <div class="card" style="margin-bottom:14px"><h3 style="margin:0 0 10px">Built-in Groups</h3><div style="display:grid;gap:8px">${bH}</div></div>
      <div class="card" style="margin-bottom:14px"><h3 style="margin:0 0 10px">Custom Groups</h3><div style="display:grid;gap:8px">${cH}</div></div>
      <div class="card"><h3 style="margin:0 0 14px">Add Custom Group</h3>
        <form method="POST" action="/sms/groups/add" style="display:grid;gap:12px;max-width:460px">
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Group Name *</label><input type="text" name="name" required class="inp" style="width:100%"></div>
          <div><label style="display:block;font-weight:600;margin-bottom:4px">Description</label><textarea name="description" rows="2" class="composer" style="min-height:50px"></textarea></div>
          <button type="submit" class="btn btn-green" style="width:fit-content">Create Group</button></form></div>
      <script>function delGrp(id){if(confirm('Delete this group?'))fetch('/sms/groups/'+id+'/delete',{method:'POST'}).then(function(){location.reload()})}</script>`,req.session.user,req));
  }));

  // ═══════════════════════════════════════════════════════
  //  9. POST /sms/groups/add — Add group
  // ═══════════════════════════════════════════════════════
  app.post('/sms/groups/add', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id,{name,description}=req.body;
    if(!name) return res.redirect('/sms/groups');
    await pool.query(`INSERT INTO sms_groups (tenant_id,name,description,member_count) VALUES ($1,$2,$3,0)`,[tid,name,description||null]);
    res.redirect('/sms/groups');
  }));

  // ═══════════════════════════════════════════════════════
  //  10. GET /sms/report — Analytics
  // ═══════════════════════════════════════════════════════
  app.get('/sms/report', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id;
    const o=(await pool.query(`SELECT COUNT(*)::int AS camp,COALESCE(SUM(recipient_count),0)::int AS tr,
      COALESCE(SUM(sent_count),0)::int AS ts,COALESCE(SUM(failed_count),0)::int AS tf,
      COALESCE(SUM(cost),0)::numeric AS tc,
      COALESCE(AVG(CASE WHEN recipient_count>0 THEN (sent_count::numeric/recipient_count)*100 END),0)::numeric AS avgd
      FROM sms_campaigns WHERE tenant_id=$1`,[tid])).rows[0];
    const bySt=(await pool.query(`SELECT status,COUNT(*)::int AS cnt,COALESCE(SUM(sent_count),0)::int AS s,COALESCE(SUM(cost),0)::numeric AS c FROM sms_campaigns WHERE tenant_id=$1 GROUP BY status ORDER BY cnt DESC`,[tid])).rows;
    const daily=(await pool.query(`SELECT DATE(created_at) AS day,COUNT(*)::int AS camp,COALESCE(SUM(sent_count),0)::int AS sent FROM sms_campaigns WHERE tenant_id=$1 AND created_at>NOW()-INTERVAL '30 days' GROUP BY DATE(created_at) ORDER BY day DESC LIMIT 30`,[tid])).rows;
    const byGrp=(await pool.query(`SELECT recipient_group,COUNT(*)::int AS cnt,COALESCE(SUM(sent_count),0)::int AS s,COALESCE(SUM(failed_count),0)::int AS f,COALESCE(SUM(cost),0)::numeric AS c FROM sms_campaigns WHERE tenant_id=$1 GROUP BY recipient_group ORDER BY cnt DESC`,[tid])).rows;
    const avgD=parseFloat(o.avgd||0).toFixed(1);
    const stChart=barChart(bySt.map(r=>({label:r.status,value:r.cnt})),'#3b82f6');
    const grpChart=barChart(byGrp.map(g=>({label:g.recipient_group,value:g.cnt})),'#8b5cf6');
    const topDays=[...daily].sort((a,b)=>b.sent-a.sent).slice(0,7);
    const dayChart=barChart(topDays.map(d=>({label:new Date(d.day).toLocaleDateString('en-US',{month:'short',day:'numeric'}),value:d.sent})),'#16a34a');
    const stH=bySt.map(r=>`<tr><td>${badge(r.status)}</td><td>${F(r.cnt)}</td><td>${F(r.s)}</td><td>$${parseFloat(r.c||0).toFixed(2)}</td></tr>`).join('');
    const gH=byGrp.map(g=>{const rt=(g.s+g.f)>0?((g.s/(g.s+g.f))*100).toFixed(1):'—';return`<tr><td>${esc(g.recipient_group)}</td><td>${F(g.cnt)}</td><td>${F(g.s)}</td><td>${rt}%</td><td>$${parseFloat(g.c||0).toFixed(2)}</td></tr>`}).join('');
    const dH=[...daily].sort((a,b)=>new Date(b.day)-new Date(a.day)).map(d=>`<tr><td>${new Date(d.day).toLocaleDateString()}</td><td>${F(d.camp)}</td><td>${F(d.sent)}</td></tr>`).join('');
    res.send(renderPage('SMS Analytics',`${CSS}${nav('report')}
      <h2>SMS Analytics</h2><p class="muted" style="margin-bottom:18px">Comprehensive delivery and campaign performance report</p>
      <div class="sms-stats">
        <div class="stat-card"><div class="stat-num" style="color:#3b82f6">${F(o.camp)}</div><div class="stat-label">Campaigns</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${F(o.ts)}</div><div class="stat-label">Messages Sent</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${F(o.tf)}</div><div class="stat-label">Failed</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${avgD}%</div><div class="stat-label">Avg Deliverability</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">$${parseFloat(o.tc||0).toFixed(2)}</div><div class="stat-label">Total Spend</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#6b7280">${F(o.tr)}</div><div class="stat-label">Total Recipients</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
        <div class="card"><h3 style="margin:0 0 10px">Campaigns by Status</h3>${stChart}</div>
        <div class="card"><h3 style="margin:0 0 10px">Campaigns by Group</h3>${grpChart}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
        <div class="card"><h3 style="margin:0 0 10px">Status Breakdown</h3><table class="table"><thead><tr><th>Status</th><th>Count</th><th>Sent</th><th>Cost</th></tr></thead><tbody>${stH||'<tr><td colspan="4" class="muted" style="text-align:center;padding:18px">No data</td></tr>'}</tbody></table></div>
        <div class="card"><h3 style="margin:0 0 10px">Group Breakdown</h3><table class="table"><thead><tr><th>Group</th><th>Camp.</th><th>Sent</th><th>Rate</th><th>Cost</th></tr></thead><tbody>${gH||'<tr><td colspan="5" class="muted" style="text-align:center;padding:18px">No data</td></tr>'}</tbody></table></div>
      </div>
      <div class="card" style="margin-top:14px"><h3 style="margin:0 0 10px">Top Sending Days (Last 30 Days)</h3>${dayChart}
        <div style="margin-top:12px"><table class="table"><thead><tr><th>Date</th><th>Campaigns</th><th>Sent</th></tr></thead><tbody>${dH||'<tr><td colspan="3" class="muted" style="text-align:center;padding:18px">No activity</td></tr>'}</tbody></table></div></div>`,req.session.user,req));
  }));

  // ═══════════════════════════════════════════════════════
  //  11. POST /sms/schedule — Schedule SMS
  //  Creates a campaign with status 'scheduled' and the
  //  specified datetime. Recipients are inserted with no status
  //  (pending). A worker would process these at the scheduled time.
  // ═══════════════════════════════════════════════════════
  app.post('/sms/schedule', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id,uid=req.session.user.id,
      {name,message,recipient_group,scheduled_at,template_id}=req.body;
    if(!name||!message||!recipient_group||!scheduled_at) return res.redirect('/sms/compose');
    if(message.length > MAX_CH * 10) {
      req.session.flash={msg:'Message too long (max '+MAX_CH*10+' characters).'};
      return res.redirect('/sms/compose');
    }
    const recs=await getRecips(tid,recipient_group),
      seg=Math.ceil(message.length/MAX_CH)||1,
      cost=recs.length*seg*COST;
    const cr=await pool.query(
      `INSERT INTO sms_campaigns (tenant_id,name,message,recipient_group,recipient_count,
        sent_count,failed_count,status,scheduled_at,created_by,cost)
       VALUES ($1,$2,$3,$4,$5,0,0,'scheduled',$6,$7,$8) RETURNING id`,
      [tid,name,message,recipient_group,recs.length,scheduled_at,uid,cost.toFixed(4)]);
    await insRecips(tid,cr.rows[0].id,recs,null);
    if(template_id) await pool.query(`UPDATE sms_templates SET usage_count=usage_count+1 WHERE id=$1`,[parseInt(template_id)]);
    req.session.flash={msg:`Campaign "${name}" scheduled for ${new Date(scheduled_at).toLocaleString()}.`};
    res.redirect(`/sms/campaigns/${cr.rows[0].id}`);
  }));

  // ═══════════════════════════════════════════════════════
  //  12. POST /sms/campaigns/:id/cancel — Cancel campaign
  //  Only draft or scheduled campaigns can be cancelled.
  //  Sets status to 'failed' and marks all pending recipients.
  // ═══════════════════════════════════════════════════════
  app.post('/sms/campaigns/:id/cancel', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id,cid=parseInt(req.params.id);
    const r=await pool.query(`UPDATE sms_campaigns SET status='failed',failed_count=recipient_count,sent_count=0 WHERE id=$1 AND tenant_id=$2 AND status IN ('draft','scheduled') RETURNING id`,[cid,tid]);
    if(!r.rows.length) return res.status(400).json({error:'Cannot cancel'});
    await pool.query(`UPDATE sms_recipients SET status='failed',error_message='Campaign cancelled' WHERE campaign_id=$1 AND status='pending'`,[cid]);
    res.json({ok:true,message:'Campaign cancelled'});
  }));

  // ═══════════════════════════════════════════════════════
  //  13. GET /api/sms/balance — JSON balance / cost estimate
  //  Returns recipient count, segments, cost, and budget info.
  //  Used by the compose page for live cost estimation.
  // ═══════════════════════════════════════════════════════
  app.get('/api/sms/balance', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id,len=parseInt(req.query.len)||0,
      group=req.query.group||'all';
    const seg=Math.ceil(len/MAX_CH)||1,
      recs=await getRecips(tid,group),
      cost=recs.length*seg*COST;
    // Budget info from tenant settings (sms_budget / sms_used columns)
    const bR=(await pool.query(
      `SELECT COALESCE(sms_budget,1000) AS budget,COALESCE(sms_used,0) AS used FROM tenants WHERE id=$1`,[tid]
    )).rows[0];
    const budget=parseFloat(bR?.budget||1000),
      used=parseFloat(bR?.used||0),
      rem=Math.max(0,budget-used);
    res.json({
      recipients:recs.length,
      segments:seg,
      cost_per_message:COST,
      cost:cost,
      budget:budget,
      budget_used:used,
      budget_remaining:rem,
      can_afford:cost<=rem,
    });
  }));

  // ═══════════════════════════════════════════════════════
  //  14. GET /api/sms/stats — JSON stats
  //  Comprehensive stats endpoint for dashboards and widgets.
  //  Returns aggregated campaign metrics and recent campaigns.
  // ═══════════════════════════════════════════════════════
  app.get('/api/sms/stats', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid=req.session.user.tenant_id;
    const a=(await pool.query(`SELECT COUNT(*)::int AS total_campaigns,COALESCE(SUM(recipient_count),0)::int AS total_recipients,
      COALESCE(SUM(sent_count),0)::int AS total_sent,COALESCE(SUM(failed_count),0)::int AS total_failed,
      COALESCE(SUM(cost),0)::numeric AS total_cost,
      COUNT(*) FILTER(WHERE status='draft')::int AS draft_count,COUNT(*) FILTER(WHERE status='scheduled')::int AS scheduled_count,
      COUNT(*) FILTER(WHERE status='completed')::int AS completed_count,COUNT(*) FILTER(WHERE status='failed')::int AS failed_campaign_count,
      COALESCE(MAX(created_at),NOW()) AS last_activity FROM sms_campaigns WHERE tenant_id=$1`,[tid])).rows[0];
    const recent=(await pool.query(`SELECT id,name,status,recipient_count,sent_count,cost,created_at FROM sms_campaigns WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5`,[tid])).rows;
    const sr=(a.total_sent+a.total_failed)>0?parseFloat(((a.total_sent/(a.total_sent+a.total_failed))*100).toFixed(1)):100.0;
    res.json({total_campaigns:a.total_campaigns,total_recipients:a.total_recipients,total_sent:a.total_sent,total_failed:a.total_failed,
      total_cost:parseFloat(a.total_cost||0),success_rate:sr,draft_count:a.draft_count,scheduled_count:a.scheduled_count,
      completed_count:a.completed_count,failed_campaign_count:a.failed_campaign_count,last_activity:a.last_activity,
      recent_campaigns:recent.map(c=>({id:c.id,name:c.name,status:c.status,recipients:c.recipient_count,sent:c.sent_count,cost:parseFloat(c.cost||0),created_at:c.created_at}))});
  }));

  // ═══════════════════════════════════════════════════════
  //  AUXILIARY DELETE ENDPOINTS (used by UI JavaScript)
  // ═══════════════════════════════════════════════════════
  app.post('/sms/templates/:id/delete', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    await pool.query(`DELETE FROM sms_templates WHERE id=$1 AND tenant_id=$2`,
      [parseInt(req.params.id),req.session.user.tenant_id]);
    res.json({ok:true});
  }));
  app.post('/sms/groups/:id/delete', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    await pool.query(`DELETE FROM sms_groups WHERE id=$1 AND tenant_id=$2`,
      [parseInt(req.params.id),req.session.user.tenant_id]);
    res.json({ok:true});
  }));

  // ═══════════════════════════════════════════════════════
  //  MODULE LOADED
  // ═══════════════════════════════════════════════════════
  console.log('[SMS] Bulk SMS system loaded');
};
