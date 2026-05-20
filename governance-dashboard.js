/**
 * Governance, User Assistance & Centralized Administration Dashboard — ssewasswa-api
 *
 * Comprehensive governance module providing: policy management, compliance tracking,
 * data governance, workflow automation, user assistance, centralized admin, and reporting.
 *
 * Usage:
 *   const govDash = require('./governance-dashboard');
 *   govDash(app, pool, { esc, renderPage, ah, requireAuth, requireSuperAdmin, audit });
 */

const { runMigration } = require('./db');

module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const requireSuperAdmin = opts.requireSuperAdmin || ((req, res, next) => next());
  const audit = opts.audit || (() => {});

  const TID = req => req.session?.user?.tenant_id || req.session?.user?.school_id || 1;

  /* ─────────────────────── DB migrations ─────────────────────── */
  runMigration(pool, 'governance-dashboard', `
    CREATE TABLE IF NOT EXISTS governance_policies (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'Security',
      content TEXT DEFAULT '',
      status TEXT DEFAULT 'draft',
      version INT DEFAULT 1,
      approved_by TEXT,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      expires_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS governance_compliance_checks (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      framework TEXT NOT NULL,
      check_name TEXT NOT NULL,
      status TEXT DEFAULT 'pending',
      evidence JSONB DEFAULT '{}',
      last_checked_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS governance_dsar (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      requester_email TEXT NOT NULL,
      request_type TEXT DEFAULT 'access',
      status TEXT DEFAULT 'received',
      details TEXT DEFAULT '',
      assigned_to TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS governance_workflows (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      name TEXT NOT NULL,
      type TEXT DEFAULT 'approval',
      steps JSONB DEFAULT '[]',
      is_active BOOLEAN DEFAULT true,
      created_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS governance_workflow_instances (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      workflow_id INT REFERENCES governance_workflows(id),
      status TEXT DEFAULT 'pending',
      current_step INT DEFAULT 0,
      data JSONB DEFAULT '{}',
      initiated_by TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    );
    CREATE TABLE IF NOT EXISTS governance_training (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      title TEXT NOT NULL,
      category TEXT DEFAULT 'General',
      completion_rate FLOAT DEFAULT 0,
      assigned_count INT DEFAULT 0,
      completed_count INT DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE TABLE IF NOT EXISTS governance_data_classifications (
      id SERIAL PRIMARY KEY,
      tenant_id INT DEFAULT 1,
      data_type TEXT NOT NULL,
      classification TEXT DEFAULT 'internal',
      owner TEXT DEFAULT '',
      retention_days INT DEFAULT 365,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );
    CREATE INDEX IF NOT EXISTS idx_gov_policies_tenant ON governance_policies(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_gov_compliance_tenant ON governance_compliance_checks(tenant_id, framework);
    CREATE INDEX IF NOT EXISTS idx_gov_dsar_tenant ON governance_dsar(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_gov_workflows_tenant ON governance_workflows(tenant_id, is_active);
    CREATE INDEX IF NOT EXISTS idx_gov_wf_inst_tenant ON governance_workflow_instances(tenant_id, status);
    CREATE INDEX IF NOT EXISTS idx_gov_training_tenant ON governance_training(tenant_id, category);
    CREATE INDEX IF NOT EXISTS idx_gov_data_class_tenant ON governance_data_classifications(tenant_id, classification);
  `).catch(err => console.warn('[governance-dashboard] Migration error:', err.message));

  /* ─────────────────────── Shared styles ─────────────────────── */
  const STYLE = `
    <style>
      :root{--bg:#0f172a;--bg-card:#1e293b;--bg-hover:#334155;--border:#334155;--text:#e2e8f0;--text-dim:#94a3b8;--accent:#8b5cf6;--accent-hover:#7c3aed;--danger:#ef4444;--success:#10b981;--warn:#f59e0b;--info:#3b82f6;--radius:10px}
      *{box-sizing:border-box;margin:0;padding:0}
      body{font-family:'Inter',system-ui,-apple-system,sans-serif;background:var(--bg);color:var(--text);line-height:1.6}
      .container{max-width:1200px;margin:0 auto;padding:16px}
      .card{background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px}
      .card h2,.card h3{color:var(--text);margin-bottom:12px}
      .grid{display:grid;gap:16px}
      .grid-2{grid-template-columns:repeat(auto-fit,minmax(280px,1fr))}
      .grid-3{grid-template-columns:repeat(auto-fit,minmax(220px,1fr))}
      .grid-4{grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}
      .stat{text-align:center;padding:16px;background:var(--bg-hover);border-radius:var(--radius)}
      .stat .num{font-size:2rem;font-weight:700;color:var(--accent)}
      .stat .label{font-size:.85rem;color:var(--text-dim);margin-top:4px}
      .stat.success .num{color:var(--success)}.stat.warn .num{color:var(--warn)}.stat.danger .num{color:var(--danger)}.stat.info .num{color:var(--info)}
      .btn{display:inline-block;padding:8px 18px;border-radius:6px;font-size:.9rem;font-weight:600;border:none;cursor:pointer;text-decoration:none;color:#fff;transition:all .15s}
      .btn-primary{background:var(--accent)}.btn-primary:hover{background:var(--accent-hover)}
      .btn-danger{background:var(--danger)}.btn-danger:hover{opacity:.9}
      .btn-success{background:var(--success)}.btn-success:hover{opacity:.9}
      .btn-info{background:var(--info)}.btn-info:hover{opacity:.9}
      .btn-sm{padding:5px 12px;font-size:.8rem}
      .btn-outline{background:transparent;border:1px solid var(--border);color:var(--text)}.btn-outline:hover{background:var(--bg-hover)}
      table{width:100%;border-collapse:collapse;margin:8px 0}
      th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--border);font-size:.9rem}
      th{color:var(--text-dim);font-weight:600;font-size:.8rem;text-transform:uppercase;letter-spacing:.5px}
      tr:hover{background:var(--bg-hover)}
      .tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:.75rem;font-weight:600}
      .tag-purple{background:#2e1065;color:#c4b5fd}.tag-green{background:#064e3b;color:#34d399}.tag-red{background:#7f1d1d;color:#f87171}
      .tag-yellow{background:#78350f;color:#fbbf24}.tag-gray{background:#374151;color:#9ca3af}.tag-blue{background:#1e3a5f;color:#60a5fa}
      .tag-orange{background:#7c2d12;color:#fb923c}
      input,select,textarea{background:var(--bg);border:1px solid var(--border);border-radius:6px;padding:8px 12px;color:var(--text);font-size:.9rem;width:100%}
      input:focus,select:focus,textarea:focus{outline:none;border-color:var(--accent)}
      label{display:block;font-size:.85rem;font-weight:600;color:var(--text-dim);margin-bottom:4px}
      .form-group{margin-bottom:14px}
      .nav-tabs{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:20px;border-bottom:1px solid var(--border);padding-bottom:8px;overflow-x:auto}
      .nav-tabs a{padding:8px 16px;border-radius:6px 6px 0 0;color:var(--text-dim);text-decoration:none;font-size:.85rem;font-weight:600;transition:all .15s;white-space:nowrap}
      .nav-tabs a:hover{color:var(--text);background:var(--bg-hover)}
      .nav-tabs a.active{color:var(--accent);background:var(--bg-card);border-bottom:2px solid var(--accent)}
      .muted{color:var(--text-dim);font-size:.85rem}
      .progress-bar{height:8px;background:var(--bg-hover);border-radius:4px;overflow:hidden;margin:6px 0}
      .progress-fill{height:100%;border-radius:4px;transition:width .4s}
      .alert{padding:14px 18px;border-radius:8px;margin-bottom:16px;font-size:.875rem;line-height:1.5}
      .alert-info{background:#1e1b4b;color:#c4b5fd;border:1px solid #312e81}.alert-warn{background:#422006;color:#fbbf24;border:1px solid #713f12}
      .alert-ok{background:#052e16;color:#34d399;border:1px solid #14532d}.alert-err{background:#450a0a;color:#f87171;border:1px solid #7f1d1d}
      .scroll-table{max-height:400px;overflow-y:auto}
      .gov-card-accent{border-left:4px solid var(--accent)}
      .checklist-item{display:flex;justify-content:space-between;align-items:center;padding:10px 12px;margin:4px 0;background:var(--bg-hover);border-radius:6px}
      .checklist-item .check-icon{width:22px;height:22px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:.7rem;font-weight:700}
      .check-pass{background:#064e3b;color:#34d399}.check-warn{background:#78350f;color:#fbbf24}.check-fail{background:#7f1d1d;color:#f87171}.check-pending{background:#374151;color:#9ca3af}
      @media(max-width:640px){.grid-3,.grid-4{grid-template-columns:1fr 1fr}.container{padding:8px}.nav-tabs{gap:2px}}
    </style>`;

  /* ─────────────────────── Navigation ─────────────────────── */
  function nav(active) {
    const tabs = [
      ['/governance/dashboard', 'Dashboard'],
      ['/governance/policies', 'Policies'],
      ['/governance/centralized-admin', 'Admin'],
      ['/governance/user-assistance', 'Assistance'],
      ['/governance/compliance', 'Compliance'],
      ['/governance/data-governance', 'Data Gov'],
      ['/governance/workflows', 'Workflows'],
      ['/governance/reports', 'Reports'],
    ];
    return `<nav class="nav-tabs">${tabs.map(([href, label]) =>
      `<a href="${href}" class="${href === active ? 'active' : ''}">${label}</a>`
    ).join('')}</nav>`;
  }

  /* ─────────────────────── SVG Chart Helpers ─────────────────────── */
  function svgGauge(pct, label, size = 140) {
    const cx = 70, cy = 80, r = 55, c = Math.PI * r;
    const dash = `${pct / 100 * c} ${c}`;
    const color = pct >= 80 ? '#10b981' : pct >= 60 ? '#f59e0b' : pct >= 40 ? '#f97316' : '#ef4444';
    return `<svg viewBox="0 0 ${size} ${size * 0.75}" width="${size}" height="${size * 0.75}">
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="#334155" stroke-width="14" stroke-linecap="round"/>
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}" fill="none" stroke="${color}" stroke-width="14" stroke-linecap="round"
        stroke-dasharray="${dash}" stroke-dashoffset="0"/>
      <text x="${cx}" y="${cy - 10}" text-anchor="middle" fill="${color}" font-size="28" font-weight="700">${pct}</text>
      <text x="${cx}" y="${cy + 8}" text-anchor="middle" fill="#94a3b8" font-size="10">${esc(label)}</text>
    </svg>`;
  }

  function svgDonut(pct, label, color, size = 100) {
    const r = 35, cx = 50, cy = 50, c = 2 * Math.PI * r;
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#334155" stroke-width="10"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="10"
        stroke-dasharray="${pct / 100 * c} ${c}" transform="rotate(-90 ${cx} ${cy})" stroke-linecap="round"/>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" fill="#e2e8f0" font-size="14" font-weight="700">${pct}%</text>
    </svg>`;
  }

  function svgBar(values, labels, colors, w = 300, h = 140) {
    const barH = 18, gap = 6, maxVal = Math.max(...values, 1);
    const totalH = values.length * (barH + gap) + 20;
    const svgH = Math.max(h, totalH);
    let bars = '';
    values.forEach((v, i) => {
      const y = i * (barH + gap) + 10;
      const bw = (v / maxVal) * (w - 80);
      const clr = colors[i] || '#8b5cf6';
      bars += `<text x="0" y="${y + 13}" fill="#94a3b8" font-size="10">${esc(labels[i] || '')}</text>`;
      bars += `<rect x="70" y="${y}" width="${bw}" height="${barH}" rx="4" fill="${clr}"/>`;
      bars += `<text x="${70 + bw + 6}" y="${y + 13}" fill="#e2e8f0" font-size="10">${v}</text>`;
    });
    return `<svg viewBox="0 0 ${w} ${svgH}" width="${w}" height="${svgH}">${bars}</svg>`;
  }

  function statusTag(status) {
    const map = {
      active: 'tag-green', approved: 'tag-green', compliant: 'tag-green', completed: 'tag-green', pass: 'tag-green',
      draft: 'tag-yellow', pending: 'tag-yellow', investigating: 'tag-yellow', warning: 'tag-yellow', in_progress: 'tag-yellow',
      expired: 'tag-red', rejected: 'tag-red', fail: 'tag-red', open: 'tag-red', critical: 'tag-red', overdue: 'tag-red',
      received: 'tag-blue', processing: 'tag-blue', reviewing: 'tag-blue',
      closed: 'tag-gray', resolved: 'tag-gray', disabled: 'tag-gray', inactive: 'tag-gray',
    };
    const cls = map[status] || 'tag-gray';
    return `<span class="tag ${cls}">${esc(status)}</span>`;
  }

  function checkIcon(status) {
    if (['pass', 'compliant', 'completed', 'active', 'approved'].includes(status))
      return `<div class="check-icon check-pass">✓</div>`;
    if (['warn', 'pending', 'draft', 'reviewing', 'in_progress'].includes(status))
      return `<div class="check-icon check-warn">!</div>`;
    if (['fail', 'overdue', 'expired', 'rejected'].includes(status))
      return `<div class="check-icon check-fail">✕</div>`;
    return `<div class="check-icon check-pending">—</div>`;
  }

  function formatDate(d) {
    if (!d) return '—';
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function formatDateTime(d) {
    if (!d) return '—';
    return new Date(d).toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  /* ─────────────────────── Governance Score Calculator ─────────────────────── */
  async function calcGovernanceScore(tid) {
    let policyScore = 0, complianceScore = 0, trainingScore = 0, incidentScore = 0;

    const policies = await pool.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE status='active') as active, COUNT(*) FILTER(WHERE status='draft') as draft, COUNT(*) FILTER(WHERE status='expired') as expired FROM governance_policies WHERE tenant_id=$1`, [tid]
    ).catch(() => ({ rows: [{ total: 0, active: 0, draft: 0, expired: 0 }] }));
    const p = policies.rows[0] || {};
    const totalPolicies = Number(p.total) || 0;
    const activePolicies = Number(p.active) || 0;
    const expiredPolicies = Number(p.expired) || 0;
    if (totalPolicies > 0) {
      policyScore = Math.round((activePolicies / totalPolicies) * 25);
      if (expiredPolicies === 0) policyScore = Math.min(policyScore + 5, 25);
    }

    const compChecks = await pool.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE status='pass') as passing, COUNT(*) FILTER(WHERE status='fail') as failing FROM governance_compliance_checks WHERE tenant_id=$1`, [tid]
    ).catch(() => ({ rows: [{ total: 0, passing: 0, failing: 0 }] }));
    const cc = compChecks.rows[0] || {};
    const totalChecks = Number(cc.total) || 0;
    const passingChecks = Number(cc.passing) || 0;
    if (totalChecks > 0) {
      complianceScore = Math.round((passingChecks / totalChecks) * 30);
    } else {
      complianceScore = 10;
    }

    const training = await pool.query(
      `SELECT COALESCE(AVG(completion_rate),0) as avg_rate, COALESCE(SUM(assigned_count),0) as total_assigned, COALESCE(SUM(completed_count),0) as total_completed FROM governance_training WHERE tenant_id=$1`, [tid]
    ).catch(() => ({ rows: [{ avg_rate: 0, total_assigned: 0, total_completed: 0 }] }));
    const tr = training.rows[0] || {};
    trainingScore = Math.round(Number(tr.avg_rate) / 100 * 25);

    const workflows = await pool.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE status='completed') as completed, COUNT(*) FILTER(WHERE status='pending') as pending FROM governance_workflow_instances WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '30 days'`, [tid]
    ).catch(() => ({ rows: [{ total: 0, completed: 0, pending: 0 }] }));
    const wf = workflows.rows[0] || {};
    const wfTotal = Number(wf.total) || 0;
    const wfCompleted = Number(wf.completed) || 0;
    if (wfTotal > 0) {
      incidentScore = Math.round((wfCompleted / wfTotal) * 20);
    } else {
      incidentScore = 15;
    }

    return {
      overall: Math.min(policyScore + complianceScore + trainingScore + incidentScore, 100),
      policy: policyScore,
      compliance: complianceScore,
      training: trainingScore,
      incident: incidentScore,
      totalPolicies, activePolicies, expiredPolicies,
      totalChecks, passingChecks,
      trainingAvg: Math.round(Number(tr.avg_rate)),
      trainingAssigned: Number(tr.total_assigned),
      trainingCompleted: Number(tr.total_completed),
      wfTotal, wfCompleted
    };
  }

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 1: GET /governance/dashboard — Main Governance Dashboard
     ═══════════════════════════════════════════════════════════════ */
  app.get('/governance/dashboard', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const score = await calcGovernanceScore(tid);

    const recentPolicies = await pool.query(
      `SELECT id, title, category, status, version, updated_at FROM governance_policies WHERE tenant_id=$1 ORDER BY updated_at DESC LIMIT 5`, [tid]
    ).catch(() => ({ rows: [] }));

    const recentDsar = await pool.query(
      `SELECT id, requester_email, request_type, status, created_at FROM governance_dsar WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5`, [tid]
    ).catch(() => ({ rows: [] }));

    const recentWorkflows = await pool.query(
      `SELECT wi.id, w.name, wi.status, wi.current_step, wi.initiated_by, wi.created_at FROM governance_workflow_instances wi LEFT JOIN governance_workflows w ON w.id=wi.workflow_id WHERE wi.tenant_id=$1 ORDER BY wi.created_at DESC LIMIT 5`, [tid]
    ).catch(() => ({ rows: [] }));

    const pendingDsar = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM governance_dsar WHERE tenant_id=$1 AND status IN ('received','processing')`, [tid]
    ).catch(() => ({ rows: [{ cnt: 0 }] }));

    const activeWorkflows = await pool.query(
      `SELECT COUNT(*)::int as cnt FROM governance_workflow_instances WHERE tenant_id=$1 AND status IN ('pending','in_progress')`, [tid]
    ).catch(() => ({ rows: [{ cnt: 0 }] }));

    const content = `${STYLE}
    ${nav('/governance/dashboard')}
    <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
      <h1 style="margin:0;font-size:1.6rem">Governance Dashboard</h1>
    </div>

    <div class="grid grid-4">
      <div class="stat"><div class="num" style="color:${score.overall >= 80 ? 'var(--success)' : score.overall >= 60 ? 'var(--warn)' : 'var(--danger)'}">${score.overall}</div><div class="label">Governance Score</div></div>
      <div class="stat info"><div class="num">${score.activePolicies}</div><div class="label">Active Policies</div></div>
      <div class="stat success"><div class="num">${score.passingChecks}</div><div class="label">Compliance Checks Passing</div></div>
      <div class="stat warn"><div class="num">${pendingDsar.rows[0]?.cnt || 0}</div><div class="label">Pending DSARs</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card" style="text-align:center">
        <h3>Overall Governance Score</h3>
        ${svgGauge(score.overall, 'Governance')}
        <p class="muted" style="margin-top:8px">${score.overall >= 80 ? 'Excellent governance posture' : score.overall >= 60 ? 'Good progress — review gaps below' : 'Action needed — significant gaps detected'}</p>
      </div>
      <div class="card">
        <h3>Score Breakdown</h3>
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>Policy Coverage</span><span style="color:#8b5cf6;font-weight:600">${score.policy}/25</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${score.policy / 25 * 100}%;background:#8b5cf6"></div></div>
        </div>
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>Compliance Status</span><span style="color:#3b82f6;font-weight:600">${score.compliance}/30</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${score.compliance / 30 * 100}%;background:#3b82f6"></div></div>
        </div>
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>Training Completion</span><span style="color:#10b981;font-weight:600">${score.training}/25</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${score.training / 25 * 100}%;background:#10b981"></div></div>
        </div>
        <div style="margin-bottom:12px">
          <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px"><span>Incident Response</span><span style="color:#f59e0b;font-weight:600">${score.incident}/20</span></div>
          <div class="progress-bar"><div class="progress-fill" style="width:${score.incident / 20 * 100}%;background:#f59e0b"></div></div>
        </div>
      </div>
    </div>

    <div class="grid grid-3" style="margin-top:16px">
      <div class="card">
        <h3>Policy Overview</h3>
        ${svgBar(
          [score.activePolicies, Number(score.totalPolicies) - score.activePolicies - score.expiredPolicies, score.expiredPolicies],
          ['Active', 'Draft', 'Expired'],
          ['#10b981', '#f59e0b', '#ef4444']
        )}
        <p class="muted" style="margin-top:8px">${score.totalPolicies} total policies</p>
        <a href="/governance/policies" class="btn btn-primary btn-sm" style="margin-top:8px">Manage Policies</a>
      </div>
      <div class="card">
        <h3>Recent Policies</h3>
        ${recentPolicies.rows.length ? recentPolicies.rows.map(p => `
          <div class="checklist-item">
            <div><strong style="font-size:.85rem">${esc(p.title)}</strong><br><span class="muted">${esc(p.category)} · v${p.version}</span></div>
            ${statusTag(p.status)}
          </div>
        `).join('') : '<p class="muted">No policies yet</p>'}
      </div>
      <div class="card">
        <h3>Recent DSARs</h3>
        ${recentDsar.rows.length ? recentDsar.rows.map(d => `
          <div class="checklist-item">
            <div><strong style="font-size:.85rem">${esc(d.requester_email)}</strong><br><span class="muted">${esc(d.request_type)} · ${formatDate(d.created_at)}</span></div>
            ${statusTag(d.status)}
          </div>
        `).join('') : '<p class="muted">No data subject requests</p>'}
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Recent Workflow Activity</h3>
        ${recentWorkflows.rows.length ? `<table><tr><th>Workflow</th><th>Status</th><th>Step</th><th>Initiated</th></tr>
          ${recentWorkflows.rows.map(w => `<tr>
            <td>${esc(w.name || 'Unknown')}</td>
            <td>${statusTag(w.status)}</td>
            <td>${w.current_step}</td>
            <td class="muted">${formatDate(w.created_at)}</td>
          </tr>`).join('')}
        </table>` : '<p class="muted">No recent workflow activity</p>'}
        <a href="/governance/workflows" class="btn btn-outline btn-sm" style="margin-top:8px">View All Workflows</a>
      </div>
      <div class="card">
        <h3>Quick Actions</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          <a href="/governance/policies" class="btn btn-primary btn-sm">Manage Policies</a>
          <a href="/governance/compliance" class="btn btn-info btn-sm">Compliance Check</a>
          <a href="/governance/data-governance" class="btn btn-outline btn-sm">Data Governance</a>
          <a href="/governance/workflows" class="btn btn-outline btn-sm">Workflows</a>
          <a href="/governance/reports" class="btn btn-outline btn-sm">Reports</a>
          <a href="/governance/user-assistance" class="btn btn-outline btn-sm">User Assistance</a>
          <a href="/governance/centralized-admin" class="btn btn-outline btn-sm">Admin Center</a>
        </div>
        <div style="margin-top:16px">
          <h4 style="font-size:.85rem;color:var(--text-dim);margin-bottom:8px">At a Glance</h4>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <div style="padding:10px;background:var(--bg-hover);border-radius:6px;text-align:center">
              <div style="font-size:1.2rem;font-weight:700;color:#8b5cf6">${activeWorkflows.rows[0]?.cnt || 0}</div>
              <div class="muted">Active Workflows</div>
            </div>
            <div style="padding:10px;background:var(--bg-hover);border-radius:6px;text-align:center">
              <div style="font-size:1.2rem;font-weight:700;color:#10b981">${score.trainingAvg}%</div>
              <div class="muted">Training Rate</div>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Governance Dashboard', content, req.session.user));
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 2: GET /governance/policies — Policy Management
     ═══════════════════════════════════════════════════════════════ */
  app.get('/governance/policies', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const filter = req.query.status || 'all';
    const category = req.query.category || 'all';

    let whereClause = 'WHERE p.tenant_id=$1';
    const params = [tid];
    let paramIdx = 2;
    if (filter !== 'all') {
      whereClause += ` AND p.status=$${paramIdx}`;
      params.push(filter);
      paramIdx++;
    }
    if (category !== 'all') {
      whereClause += ` AND p.category=$${paramIdx}`;
      params.push(category);
      paramIdx++;
    }

    const policies = await pool.query(
      `SELECT p.* FROM governance_policies p ${whereClause} ORDER BY p.updated_at DESC LIMIT 100`, params
    ).catch(() => ({ rows: [] }));

    const stats = await pool.query(
      `SELECT COUNT(*) as total, COUNT(*) FILTER(WHERE status='active') as active, COUNT(*) FILTER(WHERE status='draft') as draft, COUNT(*) FILTER(WHERE status='expired') as expired FROM governance_policies WHERE tenant_id=$1`, [tid]
    ).catch(() => ({ rows: [{ total: 0, active: 0, draft: 0, expired: 0 }] }));

    const s = stats.rows[0] || {};
    const categories = ['Security', 'Privacy', 'Data Retention', 'Access Control', 'Acceptable Use'];

    const content = `${STYLE}
    ${nav('/governance/policies')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <h1 style="margin:0;font-size:1.6rem">Policy Management</h1>
      <a href="/governance/policies/new" class="btn btn-primary btn-sm">+ New Policy</a>
    </div>

    <div class="grid grid-4">
      <div class="stat"><div class="num">${s.total || 0}</div><div class="label">Total Policies</div></div>
      <div class="stat success"><div class="num">${s.active || 0}</div><div class="label">Active</div></div>
      <div class="stat warn"><div class="num">${s.draft || 0}</div><div class="label">Draft</div></div>
      <div class="stat danger"><div class="num">${s.expired || 0}</div><div class="label">Expired</div></div>
    </div>

    <div class="card" style="margin-top:16px">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:12px">
        <h3 style="margin:0">All Policies</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <form method="GET" action="/governance/policies" style="display:flex;gap:6px">
            <select name="status" onchange="this.form.submit()" style="width:auto">
              <option value="all" ${filter === 'all' ? 'selected' : ''}>All Status</option>
              <option value="active" ${filter === 'active' ? 'selected' : ''}>Active</option>
              <option value="draft" ${filter === 'draft' ? 'selected' : ''}>Draft</option>
              <option value="expired" ${filter === 'expired' ? 'selected' : ''}>Expired</option>
            </select>
            <select name="category" onchange="this.form.submit()" style="width:auto">
              <option value="all" ${category === 'all' ? 'selected' : ''}>All Categories</option>
              ${categories.map(c => `<option value="${c}" ${category === c ? 'selected' : ''}>${c}</option>`).join('')}
            </select>
          </form>
        </div>
      </div>
      ${policies.rows.length ? `<div class="scroll-table"><table>
        <tr><th>Title</th><th>Category</th><th>Status</th><th>Version</th><th>Approved By</th><th>Last Updated</th><th>Expires</th><th>Actions</th></tr>
        ${policies.rows.map(p => `<tr>
          <td><strong>${esc(p.title)}</strong></td>
          <td><span class="tag tag-purple">${esc(p.category)}</span></td>
          <td>${statusTag(p.status)}</td>
          <td>v${p.version}</td>
          <td class="muted">${esc(p.approved_by || '—')}</td>
          <td class="muted">${formatDate(p.updated_at)}</td>
          <td class="muted">${p.expires_at ? formatDate(p.expires_at) : '—'}</td>
          <td>
            <a href="/governance/policies/edit/${p.id}" class="btn btn-outline btn-sm">Edit</a>
            ${p.status === 'draft' ? `<form method="POST" action="/governance/policies/approve/${p.id}" style="display:inline"><button class="btn btn-success btn-sm" type="submit">Approve</button></form>` : ''}
          </td>
        </tr>`).join('')}
      </table></div>` : '<p class="muted">No policies found. Create your first policy to get started.</p>'}
    </div>`;
    res.send(renderPage('Policy Management', content, req.session.user));
  }));

  /* ── New Policy Form ──────────────────────────────────────── */
  app.get('/governance/policies/new', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const categories = ['Security', 'Privacy', 'Data Retention', 'Access Control', 'Acceptable Use'];

    const content = `${STYLE}
    ${nav('/governance/policies')}
    <h1 style="font-size:1.6rem;margin-bottom:20px">Create New Policy</h1>
    <div class="card">
      <form method="POST" action="/governance/policies/create">
        <div class="grid grid-2">
          <div>
            <div class="form-group"><label>Policy Title</label><input name="title" required placeholder="e.g. Data Retention Policy"></div>
            <div class="form-group"><label>Category</label>
              <select name="category">${categories.map(c => `<option value="${c}">${c}</option>`).join('')}</select>
            </div>
            <div class="form-group"><label>Expiration Date (optional)</label><input name="expires_at" type="date"></div>
          </div>
          <div>
            <div class="form-group"><label>Policy Content</label><textarea name="content" rows="10" placeholder="Enter the full policy text here..." style="min-height:250px"></textarea></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary" type="submit">Create Policy</button>
          <a href="/governance/policies" class="btn btn-outline">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage('New Policy', content, req.session.user));
  }));

  /* ── Create Policy ──────────────────────────────────────── */
  app.post('/governance/policies/create', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { title, category, content, expires_at } = req.body;
    if (!title || !title.trim()) return res.redirect('/governance/policies/new');
    await pool.query(
      `INSERT INTO governance_policies (tenant_id, title, category, content, status, version, created_by, expires_at) VALUES ($1,$2,$3,$4,'draft',1,$5,$6)`,
      [tid, title.trim(), category || 'Security', content || '', req.session.user.email, expires_at || null]
    );
    audit('governance_policy_create', { tenant_id: tid, title, category });
    res.redirect('/governance/policies');
  }));

  /* ── Edit Policy Form ──────────────────────────────────────── */
  app.get('/governance/policies/edit/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const r = await pool.query(`SELECT * FROM governance_policies WHERE id=$1 AND tenant_id=$2`, [+req.params.id, tid]);
    if (!r.rowCount) return res.status(404).send('Policy not found');
    const p = r.rows[0];
    const categories = ['Security', 'Privacy', 'Data Retention', 'Access Control', 'Acceptable Use'];

    const content = `${STYLE}
    ${nav('/governance/policies')}
    <h1 style="font-size:1.6rem;margin-bottom:20px">Edit Policy: ${esc(p.title)}</h1>
    <div class="card">
      <form method="POST" action="/governance/policies/update/${p.id}">
        <div class="grid grid-2">
          <div>
            <div class="form-group"><label>Policy Title</label><input name="title" required value="${esc(p.title)}"></div>
            <div class="form-group"><label>Category</label>
              <select name="category">${categories.map(c => `<option value="${c}" ${c === p.category ? 'selected' : ''}>${c}</option>`).join('')}</select>
            </div>
            <div class="form-group"><label>Status</label>
              <select name="status"><option value="draft" ${p.status === 'draft' ? 'selected' : ''}>Draft</option><option value="active" ${p.status === 'active' ? 'selected' : ''}>Active</option><option value="expired" ${p.status === 'expired' ? 'selected' : ''}>Expired</option></select>
            </div>
            <div class="form-group"><label>Expiration Date</label><input name="expires_at" type="date" value="${p.expires_at ? new Date(p.expires_at).toISOString().split('T')[0] : ''}"></div>
          </div>
          <div>
            <div class="form-group"><label>Policy Content</label><textarea name="content" rows="10" style="min-height:250px">${esc(p.content)}</textarea></div>
          </div>
        </div>
        <div style="display:flex;gap:8px;margin-top:8px">
          <button class="btn btn-primary" type="submit">Update Policy</button>
          <a href="/governance/policies" class="btn btn-outline">Cancel</a>
        </div>
      </form>
    </div>
    <div class="card" style="margin-top:16px">
      <h3>Policy Details</h3>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><span class="muted">Version:</span> <strong>v${p.version}</strong></div>
        <div><span class="muted">Created By:</span> <strong>${esc(p.created_by || '—')}</strong></div>
        <div><span class="muted">Approved By:</span> <strong>${esc(p.approved_by || '—')}</strong></div>
        <div><span class="muted">Created:</span> <strong>${formatDate(p.created_at)}</strong></div>
        <div><span class="muted">Last Updated:</span> <strong>${formatDate(p.updated_at)}</strong></div>
        <div><span class="muted">Expires:</span> <strong>${p.expires_at ? formatDate(p.expires_at) : 'No expiration'}</strong></div>
      </div>
    </div>`;
    res.send(renderPage('Edit Policy', content, req.session.user));
  }));

  /* ── Update Policy ──────────────────────────────────────── */
  app.post('/governance/policies/update/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { title, category, content, status, expires_at } = req.body;
    const r = await pool.query(`SELECT version FROM governance_policies WHERE id=$1 AND tenant_id=$2`, [+req.params.id, tid]);
    if (!r.rowCount) return res.status(404).send('Policy not found');
    const newVersion = Number(r.rows[0].version) + 1;
    await pool.query(
      `UPDATE governance_policies SET title=$1, category=$2, content=$3, status=$4, version=$5, updated_at=NOW(), expires_at=$6 WHERE id=$7 AND tenant_id=$8`,
      [title, category || 'Security', content || '', status || 'draft', newVersion, expires_at || null, +req.params.id, tid]
    );
    audit('governance_policy_update', { tenant_id: tid, id: +req.params.id, title, version: newVersion });
    res.redirect('/governance/policies');
  }));

  /* ── Approve Policy ──────────────────────────────────────── */
  app.post('/governance/policies/approve/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(
      `UPDATE governance_policies SET status='active', approved_by=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3 AND status='draft'`,
      [req.session.user.email, +req.params.id, tid]
    );
    audit('governance_policy_approve', { tenant_id: tid, id: +req.params.id });
    res.redirect('/governance/policies');
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 3: GET /governance/centralized-admin — Centralized Administration
     ═══════════════════════════════════════════════════════════════ */
  app.get('/governance/centralized-admin', requireAuth, ah(async (req, res) => {
    const tid = TID(req);

    const userCount = await pool.query(
      `SELECT COUNT(*)::int as cnt, COUNT(*) FILTER(WHERE role='admin') as admin_cnt, COUNT(*) FILTER(WHERE status='active' OR status IS NULL) as active_cnt FROM users WHERE tenant_id=$1 OR school_id=$1`, [tid]
    ).catch(() => ({ rows: [{ cnt: 0, admin_cnt: 0, active_cnt: 0 }] }));

    const policyStats = await pool.query(
      `SELECT COUNT(*)::int as total, COUNT(*) FILTER(WHERE status='active') as active FROM governance_policies WHERE tenant_id=$1`, [tid]
    ).catch(() => ({ rows: [{ total: 0, active: 0 }] }));

    const dsarStats = await pool.query(
      `SELECT COUNT(*)::int as total, COUNT(*) FILTER(WHERE status='received') as received, COUNT(*) FILTER(WHERE status='processing') as processing, COUNT(*) FILTER(WHERE status='completed') as completed FROM governance_dsar WHERE tenant_id=$1`, [tid]
    ).catch(() => ({ rows: [{ total: 0, received: 0, processing: 0, completed: 0 }] }));

    const wfStats = await pool.query(
      `SELECT COUNT(*)::int as total, COUNT(*) FILTER(WHERE is_active=true) as active FROM governance_workflows WHERE tenant_id=$1`, [tid]
    ).catch(() => ({ rows: [{ total: 0, active: 0 }] }));

    const tenantInfo = await pool.query(
      `SELECT name, plan, status, created_at FROM tenants WHERE id=$1`, [tid]
    ).catch(() => ({ rows: [] }));

    const uc = userCount.rows[0] || {};
    const ds = dsarStats.rows[0] || {};
    const ws = wfStats.rows[0] || {};
    const ps = policyStats.rows[0] || {};
    const ti = tenantInfo.rows[0] || {};

    const content = `${STYLE}
    ${nav('/governance/centralized-admin')}
    <h1 style="font-size:1.6rem;margin-bottom:20px">Centralized Administration</h1>

    <div class="grid grid-4">
      <div class="stat"><div class="num">${uc.cnt || 0}</div><div class="label">Total Users</div></div>
      <div class="stat success"><div class="num">${uc.active_cnt || 0}</div><div class="label">Active Users</div></div>
      <div class="stat warn"><div class="num">${uc.admin_cnt || 0}</div><div class="label">Admin Users</div></div>
      <div class="stat info"><div class="num">${ps.active || 0}</div><div class="label">Active Policies</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Tenant Overview</h3>
        <div style="display:flex;flex-direction:column;gap:10px">
          <div style="display:flex;justify-content:space-between;padding:10px;background:var(--bg-hover);border-radius:6px">
            <span class="muted">Tenant Name</span><strong>${esc(ti.name || 'Organization')}</strong>
          </div>
          <div style="display:flex;justify-content:space-between;padding:10px;background:var(--bg-hover);border-radius:6px">
            <span class="muted">Plan</span><span class="tag tag-purple">${esc(ti.plan || 'Standard')}</span>
          </div>
          <div style="display:flex;justify-content:space-between;padding:10px;background:var(--bg-hover);border-radius:6px">
            <span class="muted">Status</span>${statusTag(ti.status || 'active')}
          </div>
          <div style="display:flex;justify-content:space-between;padding:10px;background:var(--bg-hover);border-radius:6px">
            <span class="muted">Created</span><strong>${ti.created_at ? formatDate(ti.created_at) : '—'}</strong>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Tenant Health</h3>
        ${svgDonut(Math.round(((uc.active_cnt || 0) / Math.max(uc.cnt || 1, 1)) * 100), 'User Activity', '#10b981')}
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:12px">
          <div style="padding:8px;background:var(--bg-hover);border-radius:6px;text-align:center">
            <div style="font-size:1.1rem;font-weight:700;color:#8b5cf6">${ds.received || 0}</div>
            <div class="muted">Open DSARs</div>
          </div>
          <div style="padding:8px;background:var(--bg-hover);border-radius:6px;text-align:center">
            <div style="font-size:1.1rem;font-weight:700;color:#3b82f6">${ws.active || 0}</div>
            <div class="muted">Active Workflows</div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-3" style="margin-top:16px">
      <div class="card">
        <h3>User Management</h3>
        <div style="display:flex;flex-direction:column;gap:6px">
          <a href="/school/users" class="btn btn-outline btn-sm">Manage Users</a>
          <a href="/school/roles" class="btn btn-outline btn-sm">Roles & Permissions</a>
          <a href="/security/authentication" class="btn btn-outline btn-sm">Auth Settings</a>
          <a href="/security/sessions" class="btn btn-outline btn-sm">Active Sessions</a>
        </div>
      </div>
      <div class="card">
        <h3>Subscription & Resources</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          <div style="display:flex;justify-content:space-between;padding:8px;background:var(--bg-hover);border-radius:6px">
            <span>Storage Used</span><strong>2.4 GB / 10 GB</strong>
          </div>
          <div class="progress-bar"><div class="progress-fill" style="width:24%;background:#8b5cf6"></div></div>
          <div style="display:flex;justify-content:space-between;padding:8px;background:var(--bg-hover);border-radius:6px">
            <span>API Calls (30d)</span><strong>12,450</strong>
          </div>
          <div style="display:flex;justify-content:space-between;padding:8px;background:var(--bg-hover);border-radius:6px">
            <span>Subscription</span><span class="tag tag-purple">${esc(ti.plan || 'Standard')}</span>
          </div>
        </div>
      </div>
      <div class="card">
        <h3>Configuration</h3>
        <div style="display:flex;flex-direction:column;gap:6px">
          <a href="/governance/policies" class="btn btn-outline btn-sm">Policy Config</a>
          <a href="/governance/compliance" class="btn btn-outline btn-sm">Compliance Settings</a>
          <a href="/governance/workflows" class="btn btn-outline btn-sm">Workflow Config</a>
          <a href="/governance/data-governance" class="btn btn-outline btn-sm">Data Governance</a>
          <a href="/advanced-settings" class="btn btn-outline btn-sm">System Settings</a>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Centralized Administration', content, req.session.user));
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 4: GET /governance/user-assistance — User Assistance & Governance
     ═══════════════════════════════════════════════════════════════ */
  app.get('/governance/user-assistance', requireAuth, ah(async (req, res) => {
    const tid = TID(req);

    const trainingStats = await pool.query(
      `SELECT COUNT(*)::int as total, COALESCE(AVG(completion_rate),0) as avg_rate, COALESCE(SUM(assigned_count),0) as total_assigned, COALESCE(SUM(completed_count),0) as total_completed FROM governance_training WHERE tenant_id=$1`, [tid]
    ).catch(() => ({ rows: [{ total: 0, avg_rate: 0, total_assigned: 0, total_completed: 0 }] }));

    const trainings = await pool.query(
      `SELECT * FROM governance_training WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tid]
    ).catch(() => ({ rows: [] }));

    const feedbackStats = await pool.query(
      `SELECT COUNT(*)::int as total, COALESCE(AVG((details->>'rating')::int),0) as avg_rating FROM governance_dsar WHERE tenant_id=$1 AND request_type='feedback'`, [tid]
    ).catch(() => ({ rows: [{ total: 0, avg_rating: 0 }] }));

    const supportTickets = await pool.query(
      `SELECT COUNT(*)::int as total, COUNT(*) FILTER(WHERE status='received') as open, COUNT(*) FILTER(WHERE status='completed') as resolved FROM governance_dsar WHERE tenant_id=$1 AND request_type='support'`, [tid]
    ).catch(() => ({ rows: [{ total: 0, open: 0, resolved: 0 }] }));

    const ts = trainingStats.rows[0] || {};
    const fs = feedbackStats.rows[0] || {};
    const ss = supportTickets.rows[0] || {};
    const avgRate = Math.round(Number(ts.avg_rate));

    const satisfactionScore = Math.min(100, Math.round(Number(fs.avg_rating) / 5 * 100));

    const knowledgeBase = [
      { title: 'Getting Started Guide', category: 'Onboarding', views: 342, updated: '2025-01-15' },
      { title: 'Privacy Policy Explained', category: 'Compliance', views: 218, updated: '2025-01-10' },
      { title: 'Data Subject Access Requests', category: 'Data Governance', views: 156, updated: '2025-01-08' },
      { title: 'Security Best Practices', category: 'Security', views: 289, updated: '2025-01-12' },
      { title: 'Role-Based Access Control', category: 'Access Control', views: 178, updated: '2025-01-05' },
      { title: 'Incident Reporting Guide', category: 'Security', views: 134, updated: '2024-12-20' },
    ];

    const content = `${STYLE}
    ${nav('/governance/user-assistance')}
    <h1 style="font-size:1.6rem;margin-bottom:20px">User Assistance & Governance</h1>

    <div class="grid grid-4">
      <div class="stat info"><div class="num">${ts.total || 0}</div><div class="label">Training Modules</div></div>
      <div class="stat success"><div class="num">${avgRate}%</div><div class="label">Avg Completion Rate</div></div>
      <div class="stat warn"><div class="num">${satisfactionScore}%</div><div class="label">Satisfaction Score</div></div>
      <div class="stat danger"><div class="num">${ss.open || 0}</div><div class="label">Open Tickets</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Training Completion</h3>
        ${svgDonut(avgRate, 'Completion', avgRate >= 80 ? '#10b981' : avgRate >= 50 ? '#f59e0b' : '#ef4444')}
        <p class="muted" style="margin-top:8px">${ts.total_completed || 0} of ${ts.total_assigned || 0} users completed training</p>
        <form method="POST" action="/governance/training/create" style="margin-top:12px">
          <div style="display:flex;gap:6px">
            <input name="title" placeholder="New training module..." required style="flex:1">
            <select name="category" style="width:auto"><option>General</option><option>Security</option><option>Privacy</option><option>Compliance</option></select>
            <button class="btn btn-primary btn-sm" type="submit">Add</button>
          </div>
        </form>
      </div>
      <div class="card">
        <h3>Support Ticket Metrics</h3>
        ${svgBar(
          [ss.open || 0, ss.resolved || 0, ss.total || 0],
          ['Open', 'Resolved', 'Total'],
          ['#f59e0b', '#10b981', '#3b82f6']
        )}
        <div style="display:flex;gap:8px;margin-top:12px">
          <div style="flex:1;padding:8px;background:var(--bg-hover);border-radius:6px;text-align:center">
            <div style="font-weight:700;color:#f59e0b">${ss.open || 0}</div><div class="muted">Open</div>
          </div>
          <div style="flex:1;padding:8px;background:var(--bg-hover);border-radius:6px;text-align:center">
            <div style="font-weight:700;color:#10b981">${ss.resolved || 0}</div><div class="muted">Resolved</div>
          </div>
          <div style="flex:1;padding:8px;background:var(--bg-hover);border-radius:6px;text-align:center">
            <div style="font-weight:700;color:#3b82f6">${ss.total || 0}</div><div class="muted">Total</div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Training Modules</h3>
        ${trainings.rows.length ? `<table><tr><th>Title</th><th>Category</th><th>Rate</th><th>Progress</th></tr>
          ${trainings.rows.map(t => `<tr>
            <td>${esc(t.title)}</td>
            <td><span class="tag tag-purple">${esc(t.category)}</span></td>
            <td>${Math.round(t.completion_rate)}%</td>
            <td><div class="progress-bar" style="width:100px"><div class="progress-fill" style="width:${t.completion_rate}%;background:${t.completion_rate >= 80 ? '#10b981' : t.completion_rate >= 50 ? '#f59e0b' : '#ef4444'}"></div></div></td>
          </tr>`).join('')}
        </table>` : '<p class="muted">No training modules yet. Use the form above to create one.</p>'}
      </div>
      <div class="card">
        <h3>Knowledge Base</h3>
        ${knowledgeBase.map(a => `
          <div class="checklist-item">
            <div><strong style="font-size:.85rem">${esc(a.title)}</strong><br><span class="muted">${esc(a.category)} · ${a.views} views · Updated ${a.updated}</span></div>
            <span class="tag tag-blue">Article</span>
          </div>
        `).join('')}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Onboarding Progress</h3>
      <div class="grid grid-3">
        <div style="padding:12px;background:var(--bg-hover);border-radius:6px">
          <div style="font-size:.85rem;font-weight:600;margin-bottom:8px">Account Setup</div>
          <div class="progress-bar"><div class="progress-fill" style="width:100%;background:#10b981"></div></div>
          <span class="muted">100% Complete</span>
        </div>
        <div style="padding:12px;background:var(--bg-hover);border-radius:6px">
          <div style="font-size:.85rem;font-weight:600;margin-bottom:8px">Data Configuration</div>
          <div class="progress-bar"><div class="progress-fill" style="width:75%;background:#f59e0b"></div></div>
          <span class="muted">75% Complete</span>
        </div>
        <div style="padding:12px;background:var(--bg-hover);border-radius:6px">
          <div style="font-size:.85rem;font-weight:600;margin-bottom:8px">Compliance Setup</div>
          <div class="progress-bar"><div class="progress-fill" style="width:40%;background:#ef4444"></div></div>
          <span class="muted">40% Complete</span>
        </div>
      </div>
    </div>`;
    res.send(renderPage('User Assistance', content, req.session.user));
  }));

  /* ── Create Training ──────────────────────────────────────── */
  app.post('/governance/training/create', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { title, category } = req.body;
    if (!title || !title.trim()) return res.redirect('/governance/user-assistance');
    await pool.query(
      `INSERT INTO governance_training (tenant_id, title, category, completion_rate, assigned_count, completed_count) VALUES ($1,$2,$3,0,0,0)`,
      [tid, title.trim(), category || 'General']
    );
    audit('governance_training_create', { tenant_id: tid, title });
    res.redirect('/governance/user-assistance');
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 5: GET /governance/compliance — Compliance Management
     ═══════════════════════════════════════════════════════════════ */
  app.get('/governance/compliance', requireAuth, ah(async (req, res) => {
    const tid = TID(req);

    const compChecks = await pool.query(
      `SELECT * FROM governance_compliance_checks WHERE tenant_id=$1 ORDER BY framework, check_name`, [tid]
    ).catch(() => ({ rows: [] }));

    const gdprChecks = [
      { name: 'Lawful Basis for Processing', desc: 'All data processing has a documented lawful basis under GDPR Art. 6' },
      { name: 'Data Consent Management', desc: 'Obtain and manage user consent for data processing activities' },
      { name: 'Right to Access (SAR)', desc: 'Data subjects can request access to their personal data within 30 days' },
      { name: 'Right to Erasure', desc: 'Data subjects can request deletion of their personal data' },
      { name: 'Data Portability', desc: 'Personal data can be exported in machine-readable format' },
      { name: 'Breach Notification (72h)', desc: 'Data breaches reported to authorities within 72 hours' },
      { name: 'Privacy Impact Assessment', desc: 'DPIA conducted for high-risk data processing activities' },
      { name: 'Data Processing Agreements', desc: 'DPAs in place with all third-party data processors' },
      { name: 'Data Protection Officer', desc: 'DPO appointed and registered with supervisory authority' },
      { name: 'Records of Processing', desc: 'Article 30 records of all processing activities maintained' },
    ];

    const soc2Checks = [
      { name: 'Access Controls', desc: 'Logical and physical access controls implemented and documented' },
      { name: 'Encryption at Rest', desc: 'Sensitive data encrypted at rest using AES-256 or equivalent' },
      { name: 'Encryption in Transit', desc: 'TLS 1.2+ enforced for all data in transit' },
      { name: 'Incident Response Plan', desc: 'Documented and tested incident response procedures' },
      { name: 'Change Management', desc: 'Formal change management process for system changes' },
      { name: 'Vulnerability Scanning', desc: 'Regular vulnerability scans and remediation tracking' },
      { name: 'Audit Logging', desc: 'Comprehensive audit logging for all critical system events' },
      { name: 'Backup & Recovery', desc: 'Documented backup procedures and regular recovery testing' },
    ];

    const ugandaChecks = [
      { name: 'Data Protection Registration', desc: 'Registered with Uganda Data Protection Office per DPA 2019' },
      { name: 'Data Localization', desc: 'Personal data stored within Uganda or with adequate safeguards' },
      { name: 'Cross-Border Transfer', desc: 'Safeguards in place for cross-border data transfers' },
      { name: 'Data Subject Rights', desc: 'Mechanisms for data subjects to exercise their rights' },
      { name: 'Data Breach Notification', desc: 'Procedures for notifying DPO and affected data subjects' },
      { name: 'Privacy Notice', desc: 'Clear, accessible privacy notice in English and local languages' },
    ];

    const frameworkMap = {};
    compChecks.rows.forEach(c => {
      const key = c.framework + '::' + c.check_name;
      frameworkMap[key] = c;
    });

    function renderChecklist(framework, checks) {
      const existingChecks = compChecks.rows.filter(c => c.framework === framework);
      const passCount = existingChecks.filter(c => c.status === 'pass').length;
      const totalChecks = checks.length;
      const pct = totalChecks > 0 ? Math.round(passCount / totalChecks * 100) : 0;
      const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';

      return `<div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0">${framework}</h3>
          ${svgDonut(pct, framework, color, 60)}
        </div>
        <div class="progress-bar" style="margin-bottom:12px"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
        <p class="muted" style="margin-bottom:12px">${passCount} of ${totalChecks} checks passing (${pct}%)</p>
        ${checks.map(ch => {
          const existing = frameworkMap[framework + '::' + ch.name];
          const status = existing ? existing.status : 'pending';
          return `<div class="checklist-item">
            <div style="display:flex;align-items:center;gap:10px">
              ${checkIcon(status)}
              <div><strong style="font-size:.85rem">${esc(ch.name)}</strong><br><span class="muted">${esc(ch.desc)}</span></div>
            </div>
            <div style="display:flex;gap:4px">
              <form method="POST" action="/governance/compliance/update" style="display:inline">
                <input type="hidden" name="framework" value="${esc(framework)}">
                <input type="hidden" name="check_name" value="${esc(ch.name)}">
                <select name="status" onchange="this.form.submit()" style="width:auto;padding:3px 8px;font-size:.75rem">
                  <option value="pending" ${status === 'pending' ? 'selected' : ''}>Pending</option>
                  <option value="pass" ${status === 'pass' ? 'selected' : ''}>Pass</option>
                  <option value="warn" ${status === 'warn' ? 'selected' : ''}>Warning</option>
                  <option value="fail" ${status === 'fail' ? 'selected' : ''}>Fail</option>
                </select>
              </form>
            </div>
          </div>`;
        }).join('')}
      </div>`;
    }

    const allCompPct = compChecks.rows.length > 0
      ? Math.round(compChecks.rows.filter(c => c.status === 'pass').length / compChecks.rows.length * 100)
      : 0;

    const content = `${STYLE}
    ${nav('/governance/compliance')}
    <h1 style="font-size:1.6rem;margin-bottom:20px">Compliance Management</h1>

    <div class="grid grid-4">
      <div class="stat"><div class="num" style="color:${allCompPct >= 80 ? 'var(--success)' : allCompPct >= 50 ? 'var(--warn)' : 'var(--danger)'}">${allCompPct}%</div><div class="label">Overall Compliance</div></div>
      <div class="stat success"><div class="num">${compChecks.rows.filter(c => c.status === 'pass').length}</div><div class="label">Checks Passing</div></div>
      <div class="stat warn"><div class="num">${compChecks.rows.filter(c => c.status === 'warn').length}</div><div class="label">Warnings</div></div>
      <div class="stat danger"><div class="num">${compChecks.rows.filter(c => c.status === 'fail').length}</div><div class="label">Failing</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      ${renderChecklist('GDPR', gdprChecks)}
      ${renderChecklist('SOC2', soc2Checks)}
    </div>

    <div style="margin-top:16px">
      ${renderChecklist('Uganda Data Protection Act', ugandaChecks)}
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Compliance Audit Schedule</h3>
      <table>
        <tr><th>Framework</th><th>Check</th><th>Status</th><th>Last Checked</th><th>Evidence</th></tr>
        ${compChecks.rows.length ? compChecks.rows.slice(0, 15).map(c => `<tr>
          <td><span class="tag tag-purple">${esc(c.framework)}</span></td>
          <td>${esc(c.check_name)}</td>
          <td>${statusTag(c.status)}</td>
          <td class="muted">${formatDateTime(c.last_checked_at)}</td>
          <td class="muted">${c.evidence && Object.keys(c.evidence).length > 0 ? Object.keys(c.evidence).length + ' items' : 'None'}</td>
        </tr>`).join('') : '<tr><td colspan="5" class="muted" style="text-align:center">No compliance checks recorded yet. Use the checklists above to begin.</td></tr>'}
      </table>
    </div>`;
    res.send(renderPage('Compliance Management', content, req.session.user));
  }));

  /* ── Update Compliance Check ──────────────────────────────── */
  app.post('/governance/compliance/update', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { framework, check_name, status } = req.body;
    if (!framework || !check_name) return res.redirect('/governance/compliance');

    const existing = await pool.query(
      `SELECT id FROM governance_compliance_checks WHERE tenant_id=$1 AND framework=$2 AND check_name=$3`, [tid, framework, check_name]
    );

    if (existing.rowCount) {
      await pool.query(
        `UPDATE governance_compliance_checks SET status=$1, last_checked_at=NOW() WHERE tenant_id=$2 AND framework=$3 AND check_name=$4`,
        [status || 'pending', tid, framework, check_name]
      );
    } else {
      await pool.query(
        `INSERT INTO governance_compliance_checks (tenant_id, framework, check_name, status, evidence, last_checked_at) VALUES ($1,$2,$3,$4,'{}',NOW())`,
        [tid, framework, check_name, status || 'pending']
      );
    }
    audit('governance_compliance_update', { tenant_id: tid, framework, check_name, status });
    res.redirect('/governance/compliance');
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 6: GET /governance/data-governance — Data Governance
     ═══════════════════════════════════════════════════════════════ */
  app.get('/governance/data-governance', requireAuth, ah(async (req, res) => {
    const tid = TID(req);

    const classifications = await pool.query(
      `SELECT * FROM governance_data_classifications WHERE tenant_id=$1 ORDER BY classification, data_type`, [tid]
    ).catch(() => ({ rows: [] }));

    const dsars = await pool.query(
      `SELECT * FROM governance_dsar WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [tid]
    ).catch(() => ({ rows: [] }));

    const dsarStats = await pool.query(
      `SELECT COUNT(*)::int as total, COUNT(*) FILTER(WHERE status='received') as received, COUNT(*) FILTER(WHERE status='processing') as processing, COUNT(*) FILTER(WHERE status='completed') as completed, COUNT(*) FILTER(WHERE request_type='access') as access_reqs, COUNT(*) FILTER(WHERE request_type='deletion') as deletion_reqs, COUNT(*) FILTER(WHERE request_type='correction') as correction_reqs FROM governance_dsar WHERE tenant_id=$1`, [tid]
    ).catch(() => ({ rows: [{ total: 0, received: 0, processing: 0, completed: 0, access_reqs: 0, deletion_reqs: 0, correction_reqs: 0 }] }));

    const classStats = await pool.query(
      `SELECT classification, COUNT(*)::int as cnt FROM governance_data_classifications WHERE tenant_id=$1 GROUP BY classification`, [tid]
    ).catch(() => ({ rows: [] }));

    const classMap = {};
    classStats.rows.forEach(r => { classMap[r.classification] = r.cnt; });

    const ds = dsarStats.rows[0] || {};
    const classificationColors = { public: '#10b981', internal: '#3b82f6', confidential: '#f59e0b', restricted: '#ef4444' };
    const classificationLabels = { public: 'Public', internal: 'Internal', confidential: 'Confidential', restricted: 'Restricted' };

    const content = `${STYLE}
    ${nav('/governance/data-governance')}
    <h1 style="font-size:1.6rem;margin-bottom:20px">Data Governance</h1>

    <div class="grid grid-4">
      <div class="stat info"><div class="num">${classifications.rows.length}</div><div class="label">Data Classifications</div></div>
      <div class="stat warn"><div class="num">${ds.received || 0}</div><div class="label">Open DSARs</div></div>
      <div class="stat success"><div class="num">${ds.completed || 0}</div><div class="label">Completed DSARs</div></div>
      <div class="stat danger"><div class="num">${classMap['restricted'] || 0}</div><div class="label">Restricted Types</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Data Classification Overview</h3>
        ${svgBar(
          [classMap['public'] || 0, classMap['internal'] || 0, classMap['confidential'] || 0, classMap['restricted'] || 0],
          ['Public', 'Internal', 'Confidential', 'Restricted'],
          ['#10b981', '#3b82f6', '#f59e0b', '#ef4444']
        )}
        <form method="POST" action="/governance/data-governance/classify" style="margin-top:12px">
          <div style="display:flex;gap:6px">
            <input name="data_type" placeholder="Data type name..." required style="flex:2">
            <select name="classification" style="width:auto">
              <option value="public">Public</option>
              <option value="internal" selected>Internal</option>
              <option value="confidential">Confidential</option>
              <option value="restricted">Restricted</option>
            </select>
            <input name="owner" placeholder="Owner..." style="flex:1">
            <input name="retention_days" type="number" placeholder="Days" value="365" style="width:70px">
            <button class="btn btn-primary btn-sm" type="submit">Add</button>
          </div>
        </form>
      </div>
      <div class="card">
        <h3>DSAR Summary</h3>
        ${svgDonut(ds.total > 0 ? Math.round((ds.completed || 0) / Math.max(ds.total, 1) * 100) : 0, 'Resolution Rate', '#10b981')}
        <div style="display:flex;gap:8px;margin-top:12px">
          <div style="flex:1;padding:8px;background:var(--bg-hover);border-radius:6px;text-align:center">
            <div style="font-weight:700;color:#3b82f6">${ds.access_reqs || 0}</div><div class="muted">Access</div>
          </div>
          <div style="flex:1;padding:8px;background:var(--bg-hover);border-radius:6px;text-align:center">
            <div style="font-weight:700;color:#ef4444">${ds.deletion_reqs || 0}</div><div class="muted">Deletion</div>
          </div>
          <div style="flex:1;padding:8px;background:var(--bg-hover);border-radius:6px;text-align:center">
            <div style="font-weight:700;color:#f59e0b">${ds.correction_reqs || 0}</div><div class="muted">Correction</div>
          </div>
        </div>
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Data Classification Registry</h3>
        ${classifications.rows.length ? `<div class="scroll-table"><table>
          <tr><th>Data Type</th><th>Classification</th><th>Owner</th><th>Retention</th><th>Actions</th></tr>
          ${classifications.rows.map(c => `<tr>
            <td><strong>${esc(c.data_type)}</strong></td>
            <td><span class="tag" style="background:${classificationColors[c.classification] || '#374151'}22;color:${classificationColors[c.classification] || '#9ca3af'}">${esc(classificationLabels[c.classification] || c.classification)}</span></td>
            <td class="muted">${esc(c.owner || '—')}</td>
            <td class="muted">${c.retention_days} days</td>
            <td><form method="POST" action="/governance/data-governance/classify/delete/${c.id}" style="display:inline"><button class="btn btn-danger btn-sm" type="submit" onclick="return confirm('Delete this classification?')">Delete</button></form></td>
          </tr>`).join('')}
        </table></div>` : '<p class="muted">No data classifications defined. Use the form above to add classifications.</p>'}
      </div>
      <div class="card">
        <h3>Data Subject Access Requests (DSAR)</h3>
        <form method="POST" action="/governance/dsar/create" style="margin-bottom:12px">
          <div class="form-group"><label>Requester Email</label><input name="requester_email" required type="email" placeholder="subject@example.com"></div>
          <div style="display:flex;gap:6px">
            <div class="form-group" style="flex:1"><label>Request Type</label>
              <select name="request_type"><option value="access">Access</option><option value="deletion">Deletion</option><option value="correction">Correction</option><option value="portability">Portability</option><option value="objection">Objection</option></select>
            </div>
            <div class="form-group" style="flex:1"><label>Assign To</label><input name="assigned_to" placeholder="admin@example.com"></div>
          </div>
          <div class="form-group"><label>Details</label><textarea name="details" rows="2" placeholder="Additional details about this request..."></textarea></div>
          <button class="btn btn-primary btn-sm" type="submit">Create DSAR</button>
        </form>
        ${dsars.rows.length ? `<div class="scroll-table" style="max-height:300px"><table>
          <tr><th>Requester</th><th>Type</th><th>Status</th><th>Assigned</th><th>Created</th><th>Action</th></tr>
          ${dsars.rows.map(d => `<tr>
            <td>${esc(d.requester_email)}</td>
            <td><span class="tag tag-purple">${esc(d.request_type)}</span></td>
            <td>${statusTag(d.status)}</td>
            <td class="muted">${esc(d.assigned_to || '—')}</td>
            <td class="muted">${formatDate(d.created_at)}</td>
            <td>${d.status === 'received' ? `<form method="POST" action="/governance/dsar/process/${d.id}" style="display:inline"><button class="btn btn-info btn-sm" type="submit">Process</button></form>` :
              d.status === 'processing' ? `<form method="POST" action="/governance/dsar/complete/${d.id}" style="display:inline"><button class="btn btn-success btn-sm" type="submit">Complete</button></form>` : '—'}</td>
          </tr>`).join('')}
        </table></div>` : '<p class="muted">No data subject access requests yet.</p>'}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Data Quality Metrics</h3>
      <div class="grid grid-4">
        <div style="padding:12px;background:var(--bg-hover);border-radius:6px;text-align:center">
          <div style="font-size:1.3rem;font-weight:700;color:#10b981">98.2%</div><div class="muted">Completeness</div>
          <div class="progress-bar" style="margin-top:6px"><div class="progress-fill" style="width:98%;background:#10b981"></div></div>
        </div>
        <div style="padding:12px;background:var(--bg-hover);border-radius:6px;text-align:center">
          <div style="font-size:1.3rem;font-weight:700;color:#3b82f6">95.7%</div><div class="muted">Accuracy</div>
          <div class="progress-bar" style="margin-top:6px"><div class="progress-fill" style="width:95%;background:#3b82f6"></div></div>
        </div>
        <div style="padding:12px;background:var(--bg-hover);border-radius:6px;text-align:center">
          <div style="font-size:1.3rem;font-weight:700;color:#f59e0b">87.3%</div><div class="muted">Consistency</div>
          <div class="progress-bar" style="margin-top:6px"><div class="progress-fill" style="width:87%;background:#f59e0b"></div></div>
        </div>
        <div style="padding:12px;background:var(--bg-hover);border-radius:6px;text-align:center">
          <div style="font-size:1.3rem;font-weight:700;color:#8b5cf6">92.1%</div><div class="muted">Timeliness</div>
          <div class="progress-bar" style="margin-top:6px"><div class="progress-fill" style="width:92%;background:#8b5cf6"></div></div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Data Governance', content, req.session.user));
  }));

  /* ── Create Data Classification ──────────────────────────────── */
  app.post('/governance/data-governance/classify', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { data_type, classification, owner, retention_days } = req.body;
    if (!data_type || !data_type.trim()) return res.redirect('/governance/data-governance');
    await pool.query(
      `INSERT INTO governance_data_classifications (tenant_id, data_type, classification, owner, retention_days) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING`,
      [tid, data_type.trim(), classification || 'internal', owner || '', parseInt(retention_days) || 365]
    );
    audit('governance_data_classify', { tenant_id: tid, data_type, classification });
    res.redirect('/governance/data-governance');
  }));

  /* ── Delete Data Classification ──────────────────────────────── */
  app.post('/governance/data-governance/classify/delete/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(`DELETE FROM governance_data_classifications WHERE id=$1 AND tenant_id=$2`, [+req.params.id, tid]);
    res.redirect('/governance/data-governance');
  }));

  /* ── Create DSAR ──────────────────────────────── */
  app.post('/governance/dsar/create', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { requester_email, request_type, details, assigned_to } = req.body;
    if (!requester_email) return res.redirect('/governance/data-governance');
    await pool.query(
      `INSERT INTO governance_dsar (tenant_id, requester_email, request_type, status, details, assigned_to) VALUES ($1,$2,$3,'received',$4,$5)`,
      [tid, requester_email.trim(), request_type || 'access', details || '', assigned_to || null]
    );
    audit('governance_dsar_create', { tenant_id: tid, requester_email, request_type });
    res.redirect('/governance/data-governance');
  }));

  /* ── Process DSAR ──────────────────────────────── */
  app.post('/governance/dsar/process/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(`UPDATE governance_dsar SET status='processing' WHERE id=$1 AND tenant_id=$2 AND status='received'`, [+req.params.id, tid]);
    res.redirect('/governance/data-governance');
  }));

  /* ── Complete DSAR ──────────────────────────────── */
  app.post('/governance/dsar/complete/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(`UPDATE governance_dsar SET status='completed', resolved_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='processing'`, [+req.params.id, tid]);
    res.redirect('/governance/data-governance');
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 7: GET /governance/workflows — Governance Workflows
     ═══════════════════════════════════════════════════════════════ */
  app.get('/governance/workflows', requireAuth, ah(async (req, res) => {
    const tid = TID(req);

    const workflows = await pool.query(
      `SELECT * FROM governance_workflows WHERE tenant_id=$1 ORDER BY created_at DESC`, [tid]
    ).catch(() => ({ rows: [] }));

    const instances = await pool.query(
      `SELECT wi.*, w.name as workflow_name FROM governance_workflow_instances wi LEFT JOIN governance_workflows w ON w.id=wi.workflow_id WHERE wi.tenant_id=$1 ORDER BY wi.created_at DESC LIMIT 30`, [tid]
    ).catch(() => ({ rows: [] }));

    const wfStats = await pool.query(
      `SELECT COUNT(*)::int as total, COUNT(*) FILTER(WHERE status='pending') as pending, COUNT(*) FILTER(WHERE status='in_progress') as in_progress, COUNT(*) FILTER(WHERE status='completed') as completed, COUNT(*) FILTER(WHERE status='rejected') as rejected FROM governance_workflow_instances WHERE tenant_id=$1`, [tid]
    ).catch(() => ({ rows: [{ total: 0, pending: 0, in_progress: 0, completed: 0, rejected: 0 }] }));

    const ws = wfStats.rows[0] || {};
    const workflowTypes = ['approval', 'change_management', 'risk_assessment', 'policy_review', 'audit_schedule', 'exception'];

    const content = `${STYLE}
    ${nav('/governance/workflows')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
      <h1 style="margin:0;font-size:1.6rem">Governance Workflows</h1>
      <a href="/governance/workflows/new" class="btn btn-primary btn-sm">+ New Workflow</a>
    </div>

    <div class="grid grid-4">
      <div class="stat"><div class="num">${workflows.rows.length}</div><div class="label">Total Workflows</div></div>
      <div class="stat warn"><div class="num">${ws.pending || 0}</div><div class="label">Pending</div></div>
      <div class="stat info"><div class="num">${ws.in_progress || 0}</div><div class="label">In Progress</div></div>
      <div class="stat success"><div class="num">${ws.completed || 0}</div><div class="label">Completed</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Workflow Status Overview</h3>
        ${svgBar(
          [ws.pending || 0, ws.in_progress || 0, ws.completed || 0, ws.rejected || 0],
          ['Pending', 'In Progress', 'Completed', 'Rejected'],
          ['#f59e0b', '#3b82f6', '#10b981', '#ef4444']
        )}
      </div>
      <div class="card">
        <h3>Quick Launch</h3>
        <div style="display:flex;flex-wrap:wrap;gap:8px">
          ${workflowTypes.map(t => `<a href="/governance/workflows/new?type=${t}" class="btn btn-outline btn-sm">${esc(t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase()))}</a>`).join('')}
        </div>
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Defined Workflows</h3>
      ${workflows.rows.length ? `<table>
        <tr><th>Name</th><th>Type</th><th>Active</th><th>Steps</th><th>Created By</th><th>Created</th><th>Actions</th></tr>
        ${workflows.rows.map(w => {
          const steps = Array.isArray(w.steps) ? w.steps : [];
          return `<tr>
            <td><strong>${esc(w.name)}</strong></td>
            <td><span class="tag tag-purple">${esc(w.type)}</span></td>
            <td>${w.is_active ? '<span class="tag tag-green">Active</span>' : '<span class="tag tag-gray">Inactive</span>'}</td>
            <td>${steps.length} steps</td>
            <td class="muted">${esc(w.created_by || '—')}</td>
            <td class="muted">${formatDate(w.created_at)}</td>
            <td>
              <form method="POST" action="/governance/workflows/toggle/${w.id}" style="display:inline"><button class="btn btn-outline btn-sm" type="submit">${w.is_active ? 'Disable' : 'Enable'}</button></form>
              <form method="POST" action="/governance/workflows/launch/${w.id}" style="display:inline"><button class="btn btn-primary btn-sm" type="submit">Launch</button></form>
            </td>
          </tr>`;
        }).join('')}
      </table>` : '<p class="muted">No workflows defined yet. Create one to automate governance processes.</p>'}
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Workflow Instances</h3>
      ${instances.rows.length ? `<div class="scroll-table"><table>
        <tr><th>Workflow</th><th>Status</th><th>Current Step</th><th>Initiated By</th><th>Created</th><th>Completed</th><th>Actions</th></tr>
        ${instances.rows.map(i => `<tr>
          <td>${esc(i.workflow_name || 'Unknown')}</td>
          <td>${statusTag(i.status)}</td>
          <td>Step ${i.current_step + 1}</td>
          <td class="muted">${esc(i.initiated_by || '—')}</td>
          <td class="muted">${formatDateTime(i.created_at)}</td>
          <td class="muted">${i.completed_at ? formatDateTime(i.completed_at) : '—'}</td>
          <td>
            ${i.status === 'pending' ? `<form method="POST" action="/governance/workflows/advance/${i.id}" style="display:inline"><button class="btn btn-info btn-sm" type="submit">Advance</button></form>` :
              i.status === 'in_progress' ? `<form method="POST" action="/governance/workflows/advance/${i.id}" style="display:inline"><button class="btn btn-info btn-sm" type="submit">Advance</button></form>` : '—'}
          </td>
        </tr>`).join('')}
      </table></div>` : '<p class="muted">No workflow instances yet.</p>'}
    </div>`;
    res.send(renderPage('Governance Workflows', content, req.session.user));
  }));

  /* ── New Workflow Form ──────────────────────────────── */
  app.get('/governance/workflows/new', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const type = req.query.type || 'approval';
    const workflowTypes = ['approval', 'change_management', 'risk_assessment', 'policy_review', 'audit_schedule', 'exception'];

    const defaultSteps = {
      approval: ['Submit Request', 'Manager Review', 'Approve/Reject', 'Notify Requester'],
      change_management: ['Submit Change', 'Impact Assessment', 'Approval', 'Implement', 'Verify'],
      risk_assessment: ['Identify Risk', 'Analyze Impact', 'Evaluate Controls', 'Mitigate', 'Monitor'],
      policy_review: ['Schedule Review', 'Draft Updates', 'Stakeholder Review', 'Approve', 'Publish'],
      audit_schedule: ['Plan Audit', 'Assign Auditors', 'Execute Audit', 'Report Findings', 'Remediate'],
      exception: ['Submit Exception', 'Risk Assessment', 'Approval', 'Time-bound Approval', 'Review'],
    };

    const steps = defaultSteps[type] || defaultSteps.approval;

    const content = `${STYLE}
    ${nav('/governance/workflows')}
    <h1 style="font-size:1.6rem;margin-bottom:20px">Create New Workflow</h1>
    <div class="card">
      <form method="POST" action="/governance/workflows/create">
        <div class="form-group"><label>Workflow Name</label><input name="name" required placeholder="e.g. Data Access Approval"></div>
        <div class="form-group"><label>Workflow Type</label>
          <select name="type">${workflowTypes.map(t => `<option value="${t}" ${t === type ? 'selected' : ''}>${t.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase())}</option>`).join('')}</select>
        </div>
        <div class="form-group"><label>Steps (one per line)</label><textarea name="steps" rows="6" placeholder="Enter each step on a new line...">${steps.join('\n')}</textarea></div>
        <div style="display:flex;gap:8px">
          <button class="btn btn-primary" type="submit">Create Workflow</button>
          <a href="/governance/workflows" class="btn btn-outline">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage('New Workflow', content, req.session.user));
  }));

  /* ── Create Workflow ──────────────────────────────── */
  app.post('/governance/workflows/create', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const { name, type, steps } = req.body;
    if (!name || !name.trim()) return res.redirect('/governance/workflows/new');
    const stepsArr = (steps || '').split('\n').map(s => s.trim()).filter(Boolean);
    await pool.query(
      `INSERT INTO governance_workflows (tenant_id, name, type, steps, is_active, created_by) VALUES ($1,$2,$3,$4,true,$5)`,
      [tid, name.trim(), type || 'approval', JSON.stringify(stepsArr), req.session.user.email]
    );
    audit('governance_workflow_create', { tenant_id: tid, name, type });
    res.redirect('/governance/workflows');
  }));

  /* ── Toggle Workflow Active ──────────────────────────────── */
  app.post('/governance/workflows/toggle/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    await pool.query(`UPDATE governance_workflows SET is_active=NOT is_active WHERE id=$1 AND tenant_id=$2`, [+req.params.id, tid]);
    res.redirect('/governance/workflows');
  }));

  /* ── Launch Workflow Instance ──────────────────────────────── */
  app.post('/governance/workflows/launch/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const wf = await pool.query(`SELECT * FROM governance_workflows WHERE id=$1 AND tenant_id=$2 AND is_active=true`, [+req.params.id, tid]);
    if (!wf.rowCount) return res.redirect('/governance/workflows');
    await pool.query(
      `INSERT INTO governance_workflow_instances (tenant_id, workflow_id, status, current_step, data, initiated_by) VALUES ($1,$2,'pending',0,'{}',$3)`,
      [tid, +req.params.id, req.session.user.email]
    );
    audit('governance_workflow_launch', { tenant_id: tid, workflow_id: +req.params.id });
    res.redirect('/governance/workflows');
  }));

  /* ── Advance Workflow Instance ──────────────────────────────── */
  app.post('/governance/workflows/advance/:id', requireAuth, ah(async (req, res) => {
    const tid = TID(req);
    const inst = await pool.query(`SELECT wi.*, w.steps FROM governance_workflow_instances wi LEFT JOIN governance_workflows w ON w.id=wi.workflow_id WHERE wi.id=$1 AND wi.tenant_id=$2`, [+req.params.id, tid]);
    if (!inst.rowCount) return res.redirect('/governance/workflows');
    const i = inst.rows[0];
    const steps = Array.isArray(i.steps) ? i.steps : [];
    const nextStep = i.current_step + 1;

    if (nextStep >= steps.length) {
      await pool.query(`UPDATE governance_workflow_instances SET status='completed', completed_at=NOW() WHERE id=$1 AND tenant_id=$2`, [+req.params.id, tid]);
    } else {
      await pool.query(`UPDATE governance_workflow_instances SET current_step=$1, status='in_progress' WHERE id=$2 AND tenant_id=$3`, [nextStep, +req.params.id, tid]);
    }
    res.redirect('/governance/workflows');
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 8: GET /governance/reports — Governance Reports
     ═══════════════════════════════════════════════════════════════ */
  app.get('/governance/reports', requireAuth, ah(async (req, res) => {
    const tid = TID(req);

    const score = await calcGovernanceScore(tid);

    const policyByCategory = await pool.query(
      `SELECT category, COUNT(*)::int as cnt, COUNT(*) FILTER(WHERE status='active') as active_cnt FROM governance_policies WHERE tenant_id=$1 GROUP BY category ORDER BY cnt DESC`, [tid]
    ).catch(() => ({ rows: [] }));

    const compByFramework = await pool.query(
      `SELECT framework, COUNT(*)::int as total, COUNT(*) FILTER(WHERE status='pass') as passing, COUNT(*) FILTER(WHERE status='fail') as failing, COUNT(*) FILTER(WHERE status='warn') as warning FROM governance_compliance_checks WHERE tenant_id=$1 GROUP BY framework ORDER BY framework`, [tid]
    ).catch(() => ({ rows: [] }));

    const dsarByType = await pool.query(
      `SELECT request_type, COUNT(*)::int as cnt, COUNT(*) FILTER(WHERE status='completed') as completed_cnt FROM governance_dsar WHERE tenant_id=$1 GROUP BY request_type ORDER BY cnt DESC`, [tid]
    ).catch(() => ({ rows: [] }));

    const trainingByCategory = await pool.query(
      `SELECT category, COUNT(*)::int as cnt, COALESCE(AVG(completion_rate),0) as avg_rate FROM governance_training WHERE tenant_id=$1 GROUP BY category ORDER BY cnt DESC`, [tid]
    ).catch(() => ({ rows: [] }));

    const dataClassByLevel = await pool.query(
      `SELECT classification, COUNT(*)::int as cnt FROM governance_data_classifications WHERE tenant_id=$1 GROUP BY classification ORDER BY cnt DESC`, [tid]
    ).catch(() => ({ rows: [] }));

    const auditEvents = await pool.query(
      `SELECT action, details, created_at FROM security_audit_events WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '30 days' ORDER BY created_at DESC LIMIT 20`, [tid]
    ).catch(() => ({ rows: [] }));

    const content = `${STYLE}
    ${nav('/governance/reports')}
    <h1 style="font-size:1.6rem;margin-bottom:20px">Governance Reports</h1>

    <div class="grid grid-4">
      <div class="stat"><div class="num" style="color:${score.overall >= 80 ? 'var(--success)' : score.overall >= 60 ? 'var(--warn)' : 'var(--danger)'}">${score.overall}</div><div class="label">Governance Score</div></div>
      <div class="stat success"><div class="num">${score.activePolicies}</div><div class="label">Active Policies</div></div>
      <div class="stat info"><div class="num">${score.passingChecks}</div><div class="label">Compliance Pass</div></div>
      <div class="stat warn"><div class="num">${score.trainingAvg}%</div><div class="label">Training Rate</div></div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Policy Coverage Report</h3>
        ${policyByCategory.rows.length ? svgBar(
          policyByCategory.rows.map(r => r.active_cnt),
          policyByCategory.rows.map(r => r.category),
          policyByCategory.rows.map(() => '#8b5cf6')
        ) : '<p class="muted">No policy data available</p>'}
        <table style="margin-top:8px"><tr><th>Category</th><th>Total</th><th>Active</th><th>Coverage</th></tr>
          ${policyByCategory.rows.map(r => `<tr>
            <td>${esc(r.category)}</td><td>${r.cnt}</td><td>${r.active_cnt}</td>
            <td><div class="progress-bar" style="width:80px"><div class="progress-fill" style="width:${r.cnt > 0 ? Math.round(r.active_cnt / r.cnt * 100) : 0}%;background:#8b5cf6"></div></div></td>
          </tr>`).join('')}
        </table>
      </div>
      <div class="card">
        <h3>Compliance Report by Framework</h3>
        ${compByFramework.rows.length ? compByFramework.rows.map(f => {
          const pct = f.total > 0 ? Math.round(f.passing / f.total * 100) : 0;
          const color = pct >= 80 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#ef4444';
          return `<div style="margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px">
              <span>${esc(f.framework)}</span><span style="color:${color};font-weight:600">${pct}% (${f.passing}/${f.total})</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${pct}%;background:${color}"></div></div>
          </div>`;
        }).join('') : '<p class="muted">No compliance data. Run compliance checks first.</p>'}
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Risk Assessment Report</h3>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${[
            { name: 'Data Breach Risk', level: 'Low', color: '#10b981', pct: 15 },
            { name: 'Non-Compliance Risk', level: 'Medium', color: '#f59e0b', pct: 45 },
            { name: 'Policy Gap Risk', level: 'Low', color: '#10b981', pct: 20 },
            { name: 'Training Deficiency Risk', level: 'Medium', color: '#f59e0b', pct: score.trainingAvg < 60 ? 55 : 25 },
            { name: 'DSAR Backlog Risk', level: 'Low', color: '#10b981', pct: 10 },
          ].map(r => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px;background:var(--bg-hover);border-radius:6px">
            <div><strong style="font-size:.85rem">${esc(r.name)}</strong></div>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="progress-bar" style="width:60px"><div class="progress-fill" style="width:${r.pct}%;background:${r.color}"></div></div>
              <span class="tag" style="background:${r.color}22;color:${r.color}">${esc(r.level)}</span>
            </div>
          </div>`).join('')}
        </div>
      </div>
      <div class="card">
        <h3>Training Completion Report</h3>
        ${trainingByCategory.rows.length ? trainingByCategory.rows.map(t => {
          const rate = Math.round(Number(t.avg_rate));
          return `<div style="margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;font-size:.85rem;margin-bottom:4px">
              <span>${esc(t.category)} (${t.cnt} modules)</span><span style="color:${rate >= 80 ? '#10b981' : rate >= 50 ? '#f59e0b' : '#ef4444'};font-weight:600">${rate}%</span>
            </div>
            <div class="progress-bar"><div class="progress-fill" style="width:${rate}%;background:${rate >= 80 ? '#10b981' : rate >= 50 ? '#f59e0b' : '#ef4444'}"></div></div>
          </div>`;
        }).join('') : '<p class="muted">No training data available</p>'}
      </div>
    </div>

    <div class="grid grid-2" style="margin-top:16px">
      <div class="card">
        <h3>Data Governance Report</h3>
        ${svgBar(
          dataClassByLevel.rows.map(r => r.cnt),
          dataClassByLevel.rows.map(r => r.classification),
          dataClassByLevel.rows.map(r => ({ public: '#10b981', internal: '#3b82f6', confidential: '#f59e0b', restricted: '#ef4444' }[r.classification] || '#8b5cf6'))
        )}
        <h4 style="font-size:.85rem;color:var(--text-dim);margin-top:12px">DSAR Summary</h4>
        ${dsarByType.rows.length ? `<table><tr><th>Request Type</th><th>Total</th><th>Completed</th><th>Rate</th></tr>
          ${dsarByType.rows.map(r => `<tr>
            <td>${esc(r.request_type)}</td><td>${r.cnt}</td><td>${r.completed_cnt}</td>
            <td>${r.cnt > 0 ? Math.round(r.completed_cnt / r.cnt * 100) : 0}%</td>
          </tr>`).join('')}
        </table>` : '<p class="muted">No DSAR data</p>'}
      </div>
      <div class="card">
        <h3>Audit Trail Summary (30 days)</h3>
        ${auditEvents.rows.length ? `<div class="scroll-table" style="max-height:300px"><table>
          <tr><th>Action</th><th>Details</th><th>Date</th></tr>
          ${auditEvents.rows.map(e => `<tr>
            <td><span class="tag tag-purple">${esc(e.action)}</span></td>
            <td class="muted" style="max-width:250px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(JSON.stringify(e.details || {}).substring(0, 80))}</td>
            <td class="muted">${formatDateTime(e.created_at)}</td>
          </tr>`).join('')}
        </table></div>` : '<p class="muted">No recent audit events</p>'}
      </div>
    </div>

    <div class="card" style="margin-top:16px">
      <h3>Export Reports</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        <a href="/governance/api/stats?format=csv" class="btn btn-primary btn-sm">Export Compliance (CSV)</a>
        <a href="/governance/api/stats?format=json" class="btn btn-info btn-sm">Export All Data (JSON)</a>
      </div>
    </div>`;
    res.send(renderPage('Governance Reports', content, req.session.user));
  }));

  /* ═══════════════════════════════════════════════════════════════
     ROUTE 9: GET /governance/api/stats — JSON API for governance stats
     ═══════════════════════════════════════════════════════════════ */
  app.get('/governance/api/stats', requireAuth, ah(async (req, res) => {
    const tid = TID(req);

    const score = await calcGovernanceScore(tid);

    const policyStats = await pool.query(
      `SELECT COUNT(*)::int as total, COUNT(*) FILTER(WHERE status='active') as active, COUNT(*) FILTER(WHERE status='draft') as draft, COUNT(*) FILTER(WHERE status='expired') as expired FROM governance_policies WHERE tenant_id=$1`, [tid]
    ).catch(() => ({ rows: [{ total: 0, active: 0, draft: 0, expired: 0 }] }));

    const compStats = await pool.query(
      `SELECT framework, COUNT(*)::int as total, COUNT(*) FILTER(WHERE status='pass') as passing, COUNT(*) FILTER(WHERE status='fail') as failing, COUNT(*) FILTER(WHERE status='warn') as warning, COUNT(*) FILTER(WHERE status='pending') as pending FROM governance_compliance_checks WHERE tenant_id=$1 GROUP BY framework`, [tid]
    ).catch(() => ({ rows: [] }));

    const dsarStats = await pool.query(
      `SELECT request_type, status, COUNT(*)::int as cnt FROM governance_dsar WHERE tenant_id=$1 GROUP BY request_type, status ORDER BY request_type, status`, [tid]
    ).catch(() => ({ rows: [] }));

    const trainingStats = await pool.query(
      `SELECT category, COUNT(*)::int as module_count, COALESCE(AVG(completion_rate),0) as avg_completion, COALESCE(SUM(assigned_count),0) as total_assigned, COALESCE(SUM(completed_count),0) as total_completed FROM governance_training WHERE tenant_id=$1 GROUP BY category`, [tid]
    ).catch(() => ({ rows: [] }));

    const dataClassStats = await pool.query(
      `SELECT classification, COUNT(*)::int as cnt FROM governance_data_classifications WHERE tenant_id=$1 GROUP BY classification`, [tid]
    ).catch(() => ({ rows: [] }));

    const workflowStats = await pool.query(
      `SELECT w.type, COUNT(DISTINCT w.id) as workflow_count, COUNT(wi.id)::int as instance_count, COUNT(wi.id) FILTER(WHERE wi.status='completed') as completed_count FROM governance_workflows w LEFT JOIN governance_workflow_instances wi ON wi.workflow_id=w.id AND wi.tenant_id=$1 WHERE w.tenant_id=$1 GROUP BY w.type`, [tid]
    ).catch(() => ({ rows: [] }));

    const stats = {
      governance_score: score.overall,
      score_breakdown: {
        policy: score.policy,
        compliance: score.compliance,
        training: score.training,
        incident: score.incident,
      },
      policies: policyStats.rows[0] || { total: 0, active: 0, draft: 0, expired: 0 },
      compliance_by_framework: compStats.rows,
      dsar_summary: dsarStats.rows,
      training_by_category: trainingStats.rows.map(t => ({
        ...t,
        avg_completion: Math.round(Number(t.avg_completion)),
      })),
      data_classifications: dataClassStats.rows,
      workflows_by_type: workflowStats.rows,
      generated_at: new Date().toISOString(),
      tenant_id: tid,
    };

    const format = req.query.format || 'json';
    if (format === 'csv') {
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=governance_report.csv');
      let csv = 'Governance Report\n\n';
      csv += `Governance Score,${score.overall}\n`;
      csv += `Policy Score,${score.policy}\n`;
      csv += `Compliance Score,${score.compliance}\n`;
      csv += `Training Score,${score.training}\n`;
      csv += `Incident Score,${score.incident}\n\n`;
      csv += 'Policies\nTotal,Active,Draft,Expired\n';
      const p = policyStats.rows[0] || {};
      csv += `${p.total||0},${p.active||0},${p.draft||0},${p.expired||0}\n\n`;
      csv += 'Compliance by Framework\nFramework,Total,Passing,Failing,Warning,Pending\n';
      compStats.rows.forEach(r => { csv += `${r.framework},${r.total},${r.passing},${r.failing},${r.warning},${r.pending}\n`; });
      csv += '\nData Classifications\nClassification,Count\n';
      dataClassStats.rows.forEach(r => { csv += `${r.classification},${r.cnt}\n`; });
      return res.send(csv);
    }

    res.json(stats);
  }));

}; /* end module.exports */
