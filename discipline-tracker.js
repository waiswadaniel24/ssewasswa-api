// ============================================================
// DISCIPLINE TRACKER MODULE — Multi-Tenant SaaS Platform
// Student behavior tracking, incident management, disciplinary
// actions, parent notifications, analytics, and behavior scoring.
// ============================================================
// Usage in server.js:
//   const disciplineTracker = require('./discipline-tracker');
//   disciplineTracker(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function disciplineTracker(app, db, pool, renderPage, esc) {

  // -- inline helpers ---------------------------------------------------
  const requireAuth = (req, res, next) => {
    if (!req.session || !req.session.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/([&<>"'])/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&amp;quot;', "'": '&#39;' }[m]));

  // -- internal helpers ---------------------------------------------------
  const fmtMoney = (n) => 'UGX ' + Number(n || 0).toLocaleString();
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '\u2014';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '\u2014';
  const today = () => new Date().toISOString().split('T')[0];
  const pct = (n, d) => d > 0 ? Math.round((n / d) * 100) : 0;

  function severityBadge(s) {
    const m = {
      minor:    { bg: '#fef9c3', color: '#a16207', icon: '\u26A0' },
      moderate: { bg: '#ffedd5', color: '#c2410c', icon: '\u26A0' },
      major:    { bg: '#fee2e2', color: '#dc2626', icon: '\uD83D\uDD34' },
      critical: { bg: '#7f1d1d', color: '#ffffff', icon: '\uD83D\uDED1' }
    };
    const v = m[s] || { bg: '#f1f5f9', color: '#475569', icon: '' };
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${v.bg};color:${v.color}">${v.icon} ${esc(s)}</span>`;
  }

  function statusBadge(s) {
    const m = {
      open:         { bg: '#fef3c7', color: '#b45309', label: 'Open' },
      under_review: { bg: '#dbeafe', color: '#1d4ed8', label: 'Under Review' },
      resolved:     { bg: '#dcfce7', color: '#15803d', label: 'Resolved' },
      closed:       { bg: '#f1f5f9', color: '#64748b', label: 'Closed' },
      appealed:     { bg: '#f3e8ff', color: '#7c3aed', label: 'Appealed' },
      active:       { bg: '#fee2e2', color: '#dc2626', label: 'Active' },
      completed:    { bg: '#dcfce7', color: '#15803d', label: 'Completed' },
      cancelled:    { bg: '#f1f5f9', color: '#64748b', label: 'Cancelled' }
    };
    const v = m[s] || { bg: '#f1f5f9', color: '#475569', label: s || 'Unknown' };
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${v.bg};color:${v.color}">${esc(v.label)}</span>`;
  }

  function actionTypeBadge(t) {
    const icons = {
      warning: '\uD83D\uDD14', counseling: '\uD83E\uDDD7', detention: '\uD83D\uDD6F',
      suspension: '\uD83D\uDEAB', expulsion: '\uD83D\uDD0C', community_service: '\uD83C\uDF3F',
      parent_meeting: '\uD83D\uDC65'
    };
    const colors = {
      warning: '#f59e0b', counseling: '#3b82f6', detention: '#8b5cf6',
      suspension: '#dc2626', expulsion: '#7f1d1d', community_service: '#059669',
      parent_meeting: '#6366f1'
    };
    const label = (t || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    const icon = icons[t] || '\uD83D\uDCCC';
    const color = colors[t] || '#475569';
    return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${color}18;color:${color}">${icon} ${esc(label)}</span>`;
  }

  function behaviorScoreCard(score, label) {
    let bg, color, statusText;
    if (score >= 80) { bg = '#dcfce7'; color = '#15803d'; statusText = 'Good'; }
    else if (score >= 60) { bg = '#fef9c3'; color = '#a16207'; statusText = 'Warning'; }
    else if (score >= 40) { bg = '#ffedd5'; color = '#c2410c'; statusText = 'Concern'; }
    else { bg = '#fee2e2'; color = '#dc2626'; statusText = 'Critical'; }
    return `<div style="background:${bg};border:1px solid ${color}30;border-radius:12px;padding:16px;text-align:center">
      <div style="font-size:28px;font-weight:800;color:${color}">${score}%</div>
      <div style="font-size:12px;font-weight:600;color:${color};margin-top:2px">${esc(statusText)}</div>
      ${label ? `<div style="font-size:11px;color:#64748b;margin-top:4px">${esc(label)}</div>` : ''}
    </div>`;
  }

  // -- shared CSS --------------------------------------------------------
  const DT_CSS = `<style>
    .dt-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
    .dt-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#64748b;background:#fef2f2;transition:.15s}
    .dt-nav a:hover{background:#fee2e2;color:#991b1b}.dt-nav a.active{background:#dc2626;color:#fff}
    .dt-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
    .dt-btn:hover{opacity:.9;transform:translateY(-1px)}
    .dt-btn-primary{background:#dc2626;color:#fff}.dt-btn-primary:hover{background:#b91c1c}
    .dt-btn-accent{background:#f97316;color:#fff}.dt-btn-accent:hover{background:#ea580c}
    .dt-btn-success{background:#059669;color:#fff}.dt-btn-success:hover{background:#047857}
    .dt-btn-danger{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
    .dt-btn-secondary{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
    .dt-btn-ghost{background:transparent;color:#64748b;border:1px solid #e2e8f0}
    .dt-table{width:100%;border-collapse:collapse;font-size:13px}
    .dt-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #fecaca;color:#991b1b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#fef2f2}
    .dt-table td{padding:10px 14px;border-bottom:1px solid #fef2f2;color:#1e293b}
    .dt-table tr:hover{background:#fef2f280}
    .dt-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
    .dt-filter label{display:block;font-size:12px;font-weight:600;color:#991b1b;margin-bottom:4px}
    .dt-filter input,.dt-filter select{padding:8px 14px;border:2px solid #fecaca;border-radius:10px;font-size:13px;background:#fff}
    .dt-filter input:focus,.dt-filter select:focus{outline:none;border-color:#dc2626;box-shadow:0 0 0 3px #fee2e2}
    .dt-card{background:#fff;border:1px solid #fecaca;border-radius:14px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(220,38,38,0.06)}
    .dt-stat-card{background:#fff;border:1px solid #fecaca;border-radius:14px;padding:20px;box-shadow:0 1px 3px rgba(220,38,38,0.06)}
    .dt-stat-num{font-size:28px;font-weight:800;color:#dc2626;line-height:1.1}
    .dt-stat-label{font-size:11px;font-weight:600;color:#991b1b;text-transform:uppercase;letter-spacing:.3px;margin-top:4px}
    .dt-stat-icon{width:44px;height:44px;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:20px}
    .dt-form-group{margin-bottom:16px}
    .dt-form-group label{display:block;font-size:13px;font-weight:600;color:#991b1b;margin-bottom:6px}
    .dt-form-group input,.dt-form-group select,.dt-form-group textarea{width:100%;padding:10px 14px;border:2px solid #fecaca;border-radius:10px;font-size:14px;font-family:inherit;box-sizing:border-box;transition:.15s}
    .dt-form-group input:focus,.dt-form-group select:focus,.dt-form-group textarea:focus{outline:none;border-color:#dc2626;box-shadow:0 0 0 3px #fee2e2}
    .dt-form-group textarea{resize:vertical;min-height:80px}
    .dt-timeline{position:relative;padding-left:28px}
    .dt-timeline::before{content:'';position:absolute;left:10px;top:0;bottom:0;width:2px;background:#fecaca}
    .dt-timeline-item{position:relative;margin-bottom:18px}
    .dt-timeline-item::before{content:'';position:absolute;left:-22px;top:4px;width:12px;height:12px;border-radius:50%;background:#dc2626;border:2px solid #fff;box-shadow:0 0 0 2px #fecaca}
    .dt-timeline-item.resolve::before{background:#059669}
    .dt-timeline-item.action::before{background:#f97316}
    .dt-pagination{display:flex;gap:4px;align-items:center;justify-content:center;margin-top:16px}
    .dt-pagination a,.dt-pagination span{padding:6px 12px;border-radius:8px;font-size:12px;font-weight:600;text-decoration:none;border:1px solid #fecaca}
    .dt-pagination a{color:#dc2626;background:#fff}.dt-pagination a:hover{background:#fef2f2}
    .dt-pagination span.current{background:#dc2626;color:#fff;border-color:#dc2626}
    .dt-severity-bar{display:flex;align-items:center;gap:8px;margin-bottom:6px}
    .dt-severity-bar-track{flex:1;height:24px;background:#fef2f2;border-radius:6px;overflow:hidden}
    .dt-severity-bar-fill{height:100%;border-radius:6px;transition:width .3s ease}
    .dt-empty{text-align:center;padding:40px;color:#94a3b8;font-size:14px}
    .dt-alert{padding:12px 16px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:16px;display:flex;align-items:center;gap:8px}
    .dt-alert-success{background:#dcfce7;color:#15803d;border:1px solid #bbf7d0}
    .dt-alert-error{background:#fee2e2;color:#dc2626;border:1px solid #fecaca}
    .dt-alert-warning{background:#fef3c7;color:#b45309;border:1px solid #fde68a}
    .dt-grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .dt-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
    .dt-grid-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px}
    @media(max-width:768px){
      .dt-nav{gap:4px}.dt-nav a{padding:6px 12px;font-size:12px}
      .dt-grid-2,.dt-grid-3{grid-template-columns:1fr}
      .dt-filter{flex-direction:column}
    }
  </style>`;

  // -- navigation helper --------------------------------------------------
  const nav = (active) => `<div class="dt-nav">
    <a href="/discipline" class="${active === 'dash' ? 'active' : ''}">\uD83D\uDCCA Dashboard</a>
    <a href="/discipline/report" class="${active === 'report' ? 'active' : ''}">\uD83D\uDCCB New Incident</a>
    <a href="/discipline/incidents" class="${active === 'incidents' ? 'active' : ''}">\uD83D\uDCDC Incidents</a>
    <a href="/discipline/actions" class="${active === 'actions' ? 'active' : ''}">\u2696\uFE0F Actions</a>
    <a href="/discipline/categories" class="${active === 'categories' ? 'active' : ''}">\uD83C\uDFF7\uFE0F Categories</a>
    <a href="/discipline/reports" class="${active === 'analytics' ? 'active' : ''}">\uD83D\uDCCA Analytics</a>
  </div>`;

  // -- flash message helper -----------------------------------------------
  const flashMsg = (req) => {
    const f = req.session.flash;
    if (!f) return '';
    delete req.session.flash;
    return `<div class="dt-alert dt-alert-${f.type === 'error' ? 'error' : 'success'}">${f.type === 'error' ? '\u274C' : '\u2705'} ${esc(f.msg)}</div>`;
  };

  // -- pagination helper --------------------------------------------------
  const paginate = (currentPage, totalPages, baseUrl) => {
    if (totalPages <= 1) return '';
    const pages = [];
    const maxShow = 5;
    let start = Math.max(1, currentPage - Math.floor(maxShow / 2));
    let end = Math.min(totalPages, start + maxShow - 1);
    if (end - start < maxShow - 1) start = Math.max(1, end - maxShow + 1);
    if (currentPage > 1) pages.push(`<a href="${baseUrl}&page=${currentPage - 1}">\u2190 Prev</a>`);
    for (let i = start; i <= end; i++) {
      pages.push(i === currentPage ? `<span class="current">${i}</span>` : `<a href="${baseUrl}&page=${i}">${i}</a>`);
    }
    if (currentPage < totalPages) pages.push(`<a href="${baseUrl}&page=${currentPage + 1}">Next \u2192</a>`);
    return `<div class="dt-pagination">${pages.join('')}</div>`;
  };

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE)
  // ============================================================
  (async () => {
    let c = null;
    for (let attempt = 1; attempt <= 3; attempt++) {
      c = await pool.connect().catch(() => null);
      if (c) break;
      console.warn(`[DisciplineTracker] DB connection attempt ${attempt}/3 failed, retrying in 3s...`);
      await new Promise(r => setTimeout(r, 3000));
    }
    if (!c) { console.error('[DisciplineTracker] Cannot connect to DB for migrations after 3 attempts'); return; }
    try {
      // -- Table 1: behavior_categories ---------------------------------
      await c.query(`CREATE TABLE IF NOT EXISTS behavior_categories (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        severity VARCHAR(20) DEFAULT 'minor',
        description TEXT,
        default_action VARCHAR(200),
        points INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const bcCols = [
        ['name','VARCHAR(100)'],['severity','VARCHAR(20) DEFAULT \'minor\''],
        ['description','TEXT'],['default_action','VARCHAR(200)'],
        ['points','INTEGER DEFAULT 0'],['is_active','BOOLEAN DEFAULT true']
      ];
      for (const [col, typ] of bcCols) {
        try { await c.query(`ALTER TABLE behavior_categories ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch(e) {}
      }

      // -- Table 2: discipline_incidents --------------------------------
      await c.query(`CREATE TABLE IF NOT EXISTS discipline_incidents (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        category_id INTEGER REFERENCES behavior_categories(id),
        reported_by INTEGER REFERENCES users(id),
        incident_date TIMESTAMPTZ DEFAULT NOW(),
        location VARCHAR(100),
        description TEXT,
        witnesses TEXT,
        evidence_path VARCHAR(500),
        severity VARCHAR(20) DEFAULT 'minor',
        status VARCHAR(20) DEFAULT 'open',
        parent_notified BOOLEAN DEFAULT false,
        parent_notified_at TIMESTAMPTZ,
        parent_phone VARCHAR(20),
        resolved_by INTEGER REFERENCES users(id),
        resolved_at TIMESTAMPTZ,
        resolution_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const diCols = [
        ['student_id','INTEGER'],['category_id','INTEGER'],['reported_by','INTEGER'],
        ['incident_date','TIMESTAMPTZ DEFAULT NOW()'],['location','VARCHAR(100)'],
        ['description','TEXT'],['witnesses','TEXT'],['evidence_path','VARCHAR(500)'],
        ['severity','VARCHAR(20) DEFAULT \'minor\''],['status','VARCHAR(20) DEFAULT \'open\''],
        ['parent_notified','BOOLEAN DEFAULT false'],['parent_notified_at','TIMESTAMPTZ'],
        ['parent_phone','VARCHAR(20)'],['resolved_by','INTEGER'],['resolved_at','TIMESTAMPTZ'],
        ['resolution_notes','TEXT'],['created_at','TIMESTAMPTZ DEFAULT NOW()'],['updated_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, typ] of diCols) {
        try { await c.query(`ALTER TABLE discipline_incidents ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch(e) {}
      }

      // -- Table 3: discipline_actions ----------------------------------
      await c.query(`CREATE TABLE IF NOT EXISTS discipline_actions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        incident_id INTEGER REFERENCES discipline_incidents(id) ON DELETE CASCADE,
        student_id INTEGER REFERENCES students(id) ON DELETE CASCADE,
        action_type VARCHAR(50) NOT NULL,
        description TEXT,
        duration_days INTEGER DEFAULT 0,
        start_date DATE,
        end_date DATE,
        assigned_by INTEGER REFERENCES users(id),
        status VARCHAR(20) DEFAULT 'active',
        completed_at TIMESTAMPTZ,
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const daCols = [
        ['incident_id','INTEGER'],['student_id','INTEGER'],['action_type','VARCHAR(50) NOT NULL'],
        ['description','TEXT'],['duration_days','INTEGER DEFAULT 0'],
        ['start_date','DATE'],['end_date','DATE'],['assigned_by','INTEGER'],
        ['status','VARCHAR(20) DEFAULT \'active\''],['completed_at','TIMESTAMPTZ'],
        ['notes','TEXT'],['created_at','TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, typ] of daCols) {
        try { await c.query(`ALTER TABLE discipline_actions ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch(e) {}
      }

      // -- Indexes ------------------------------------------------------
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bc_tenant ON behavior_categories(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bc_active ON behavior_categories(tenant_id, is_active)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_bc_severity ON behavior_categories(tenant_id, severity)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_di_tenant ON discipline_incidents(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_di_student ON discipline_incidents(tenant_id, student_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_di_status ON discipline_incidents(tenant_id, status)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_di_severity ON discipline_incidents(tenant_id, severity)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_di_category ON discipline_incidents(tenant_id, category_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_di_date ON discipline_incidents(tenant_id, incident_date)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_di_reported ON discipline_incidents(tenant_id, reported_by)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_da_tenant ON discipline_actions(tenant_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_da_incident ON discipline_actions(tenant_id, incident_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_da_student ON discipline_actions(tenant_id, student_id)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_da_status ON discipline_actions(tenant_id, status)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_da_type ON discipline_actions(tenant_id, action_type)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_da_assigned ON discipline_actions(tenant_id, assigned_by)`);
      await c.query(`CREATE INDEX IF NOT EXISTS idx_da_dates ON discipline_actions(tenant_id, start_date, end_date)`);

      console.log('[Discipline] Migrations applied successfully');
    } catch (e) { console.error('[Discipline] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // ROUTE 1: GET /discipline — Dashboard
  // ============================================================
  app.get('/discipline', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // -- Core stats --
    const openIncidents = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM discipline_incidents WHERE tenant_id=$1 AND status IN ('open','under_review')`, [tid]
    )).rows[0].cnt;

    const resolvedThisMonth = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM discipline_incidents WHERE tenant_id=$1 AND status IN ('resolved','closed') AND resolved_at >= date_trunc('month', CURRENT_DATE)`, [tid]
    )).rows[0].cnt;

    const suspendedNow = (await pool.query(
      `SELECT COUNT(DISTINCT da.student_id)::int as cnt FROM discipline_actions da
       WHERE da.tenant_id=$1 AND da.status='active' AND da.action_type='suspension'
       AND da.start_date <= CURRENT_DATE AND (da.end_date IS NULL OR da.end_date >= CURRENT_DATE)`, [tid]
    )).rows[0].cnt;

    const totalThisMonth = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM discipline_incidents WHERE tenant_id=$1 AND incident_date >= date_trunc('month', CURRENT_DATE)`, [tid]
    )).rows[0].cnt;

    const parentNotified = (await pool.query(
      `SELECT COUNT(*)::int as cnt FROM discipline_incidents WHERE tenant_id=$1 AND parent_notified=true`, [tid]
    )).rows[0].cnt;

    // -- Severity breakdown --
    const severityBreakdown = (await pool.query(
      `SELECT severity, COUNT(*)::int as cnt FROM discipline_incidents WHERE tenant_id=$1 GROUP BY severity ORDER BY cnt DESC`, [tid]
    )).rows;
    const totalIncidents = severityBreakdown.reduce((s, r) => s + r.cnt, 0) || 1;
    const sevColors = { minor: '#eab308', moderate: '#f97316', major: '#dc2626', critical: '#7f1d1d' };
    const severityBars = severityBreakdown.map(s => {
      const p = pct(s.cnt, totalIncidents);
      const col = sevColors[s.severity] || '#94a3b8';
      return `<div class="dt-severity-bar">
        <span style="font-size:12px;font-weight:600;color:#475569;min-width:70px">${esc(s.severity)}</span>
        <div class="dt-severity-bar-track">
          <div class="dt-severity-bar-fill" style="width:${p}%;background:${col}"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:#1e293b;min-width:80px;text-align:right">${s.cnt} (${p}%)</span>
      </div>`;
    }).join('');

    // -- Behavior trend (last 6 months) --
    const monthlyTrend = (await pool.query(
      `SELECT to_char(incident_date, 'Mon YYYY') as month_label, COUNT(*)::int as cnt
       FROM discipline_incidents WHERE tenant_id=$1 AND incident_date >= date_trunc('month', CURRENT_DATE - interval '5 months')
       GROUP BY to_char(incident_date, 'Mon YYYY'), date_trunc('month', incident_date)
       ORDER BY date_trunc('month', incident_date)`, [tid]
    )).rows;
    const maxTrend = Math.max(...monthlyTrend.map(r => r.cnt), 1);
    const trendBars = monthlyTrend.map(m => {
      const h = Math.round((m.cnt / maxTrend) * 100);
      return `<div style="display:flex;flex-direction:column;align-items:center;gap:4px;flex:1">
        <span style="font-size:11px;font-weight:700;color:#dc2626">${m.cnt}</span>
        <div style="width:100%;max-width:40px;background:#fef2f2;border-radius:6px;height:120px;position:relative;overflow:hidden">
          <div style="position:absolute;bottom:0;width:100%;height:${h}%;background:linear-gradient(to top,#dc2626,#f97316);border-radius:6px;transition:.3s"></div>
        </div>
        <span style="font-size:10px;color:#64748b;white-space:nowrap">${esc(m.month_label)}</span>
      </div>`;
    }).join('');

    // -- Top offenders (top 10 by incident count) --
    const topOffenders = (await pool.query(
      `SELECT s.id, s.first_name, s.last_name, COUNT(di.id)::int as incident_count,
              SUM(COALESCE(bc.points, 0))::int as total_points
       FROM discipline_incidents di
       LEFT JOIN students s ON s.id = di.student_id
       LEFT JOIN behavior_categories bc ON bc.id = di.category_id
       WHERE di.tenant_id=$1
       GROUP BY s.id, s.first_name, s.last_name
       ORDER BY incident_count DESC LIMIT 10`, [tid]
    )).rows;
    const offendersHtml = topOffenders.map((o, i) => {
      const score = Math.max(0, 100 - (o.total_points || 0));
      return `<div style="display:flex;align-items:center;gap:12px;padding:10px 12px;border-radius:10px;background:${i < 3 ? '#fef2f2' : 'transparent'};margin-bottom:6px">
        <span style="font-size:14px;font-weight:800;color:${i < 3 ? '#dc2626' : '#94a3b8'};min-width:24px">#${i + 1}</span>
        <div style="flex:1">
          <div style="font-size:13px;font-weight:600;color:#1e293b">${esc(o.first_name || 'Unknown')} ${esc(o.last_name || '')}</div>
          <div style="font-size:11px;color:#64748b">${o.incident_count} incident${o.incident_count !== 1 ? 's' : ''} \u00B7 ${o.total_points || 0} points</div>
        </div>
        ${behaviorScoreCard(score)}
      </div>`;
    }).join('');

    // -- Recent incidents (last 10) --
    const recentIncidents = (await pool.query(
      `SELECT di.*, s.first_name as student_first, s.last_name as student_last,
              bc.name as category_name, u.display_name as reporter_name
       FROM discipline_incidents di
       LEFT JOIN students s ON s.id = di.student_id
       LEFT JOIN behavior_categories bc ON bc.id = di.category_id
       LEFT JOIN users u ON u.id = di.reported_by
       WHERE di.tenant_id=$1
       ORDER BY di.incident_date DESC LIMIT 10`, [tid]
    )).rows;
    const recentHtml = recentIncidents.map(r => `<tr>
      <td><a href="/discipline/incidents/${r.id}" style="color:#dc2626;text-decoration:none;font-weight:600">#${r.id}</a></td>
      <td><strong>${esc(r.student_first || '')} ${esc(r.student_last || 'Unknown')}</strong></td>
      <td>${esc(r.category_name || 'N/A')}</td>
      <td>${severityBadge(r.severity)}</td>
      <td>${statusBadge(r.status)}</td>
      <td style="font-size:12px;color:#64748b">${fmtDateTime(r.incident_date)}</td>
    </tr>`).join('');

    // -- Active actions summary --
    const activeActions = (await pool.query(
      `SELECT da.*, s.first_name as student_first, s.last_name as student_last
       FROM discipline_actions da
       LEFT JOIN students s ON s.id = da.student_id
       WHERE da.tenant_id=$1 AND da.status='active'
       ORDER BY da.created_at DESC LIMIT 5`, [tid]
    )).rows;
    const actionsHtml = activeActions.map(a => `<tr>
      <td>${actionTypeBadge(a.action_type)}</td>
      <td><strong>${esc(a.student_first || '')} ${esc(a.student_last || '')}</strong></td>
      <td>${a.duration_days > 0 ? a.duration_days + ' days' : '\u2014'}</td>
      <td>${a.end_date ? fmtDate(a.end_date) : '\u2014'}</td>
      <td><a href="/discipline/incidents/${a.incident_id}" style="color:#dc2626;text-decoration:none;font-size:12px">View</a></td>
    </tr>`).join('');

    const html = DT_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDCCA Discipline Dashboard</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Track student behavior, incidents, and disciplinary actions</p></div>
        <a href="/discipline/report" class="dt-btn dt-btn-primary">\uD83D\uDCCB Report Incident</a>
      </div>

      <!-- Stats Cards -->
      <div class="dt-grid-stats" style="margin-bottom:20px">
        <div class="dt-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="dt-stat-icon" style="background:#fef2f2;color:#dc2626">\uD83D\uDD34</div>
          <div><div class="dt-stat-num">${openIncidents}</div><div class="dt-stat-label">Open Incidents</div></div>
        </div>
        <div class="dt-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="dt-stat-icon" style="background:#dcfce7;color:#059669">\u2705</div>
          <div><div class="dt-stat-num">${resolvedThisMonth}</div><div class="dt-stat-label">Resolved This Month</div></div>
        </div>
        <div class="dt-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="dt-stat-icon" style="background:#ffedd5;color:#f97316">\uD83D\uDEAB</div>
          <div><div class="dt-stat-num">${suspendedNow}</div><div class="dt-stat-label">On Suspension</div></div>
        </div>
        <div class="dt-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="dt-stat-icon" style="background:#fef3c7;color:#b45309">\uD83D\uDCC8</div>
          <div><div class="dt-stat-num">${totalThisMonth}</div><div class="dt-stat-label">This Month Total</div></div>
        </div>
        <div class="dt-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="dt-stat-icon" style="background:#dbeafe;color:#1d4ed8">\uD83D\uDCF1</div>
          <div><div class="dt-stat-num">${parentNotified}</div><div class="dt-stat-label">Parents Notified</div></div>
        </div>
      </div>

      <!-- Severity + Trend -->
      <div class="dt-grid-2" style="margin-bottom:16px">
        <div class="dt-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDD0D Severity Breakdown</h3>
          ${severityBars || '<p class="dt-empty">No incidents recorded yet</p>'}
        </div>
        <div class="dt-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCC8 Monthly Trend (6 Months)</h3>
          <div style="display:flex;gap:8px;align-items:end;height:160px">${trendBars || '<p class="dt-empty" style="width:100%">No trend data</p>'}</div>
        </div>
      </div>

      <!-- Top Offenders + Active Actions -->
      <div class="dt-grid-2" style="margin-bottom:16px">
        <div class="dt-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h3 style="font-size:15px;color:#1e293b;margin:0">\u26A0\uFE0F Top Offenders</h3>
            <a href="/discipline/reports" style="font-size:12px;color:#dc2626;text-decoration:none">View All \u2192</a>
          </div>
          <div style="max-height:320px;overflow-y:auto">${offendersHtml || '<p class="dt-empty">No offenders</p>'}</div>
        </div>
        <div class="dt-card">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
            <h3 style="font-size:15px;color:#1e293b;margin:0">\u2696\uFE0F Active Disciplinary Actions</h3>
            <a href="/discipline/actions" style="font-size:12px;color:#dc2626;text-decoration:none">View All \u2192</a>
          </div>
          <table class="dt-table">
            <thead><tr><th>Type</th><th>Student</th><th>Duration</th><th>Ends</th><th></th></tr></thead>
            <tbody>${actionsHtml || '<tr><td colspan="5" class="dt-empty">No active actions</td></tr>'}</tbody>
          </table>
        </div>
      </div>

      <!-- Recent Incidents -->
      <div class="dt-card">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:14px">
          <h3 style="font-size:15px;color:#1e293b;margin:0">\uD83D\uDCDC Recent Incidents</h3>
          <a href="/discipline/incidents" style="font-size:12px;color:#dc2626;text-decoration:none">View All \u2192</a>
        </div>
        <div style="overflow-x:auto"><table class="dt-table">
          <thead><tr><th>ID</th><th>Student</th><th>Category</th><th>Severity</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>${recentHtml || '<tr><td colspan="6" class="dt-empty">No incidents recorded yet</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Discipline Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /discipline/report — Report new incident form
  // ============================================================
  app.get('/discipline/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    // Load students
    const students = (await pool.query(
      `SELECT id, first_name, last_name, admission_number FROM students WHERE tenant_id=$1 ORDER BY last_name, first_name LIMIT 500`, [tid]
    )).rows;

    // Load active categories
    const categories = (await pool.query(
      `SELECT * FROM behavior_categories WHERE tenant_id=$1 AND is_active=true ORDER BY severity, name`, [tid]
    )).rows;

    const studentOpts = students.map(s =>
      `<option value="${s.id}">${esc(s.last_name || '')}, ${esc(s.first_name || '')} (${esc(s.admission_number || s.id)})</option>`
    ).join('');

    const catOpts = categories.map(c =>
      `<option value="${c.id}" data-severity="${esc(c.severity)}" data-action="${esc(c.default_action || '')}">${esc(c.name)} (${esc(c.severity)})</option>`
    ).join('');

    const html = DT_CSS + `<div style="max-width:720px;margin:0 auto">
      ${nav('report')}
      ${flashMsg(req)}
      <a href="/discipline" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Dashboard</a>
      <div class="dt-card" style="padding:28px">
        <h2 style="margin:0 0 4px;color:#1e293b">\uD83D\uDCCB Report New Incident</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:24px">Document a student behavior incident and assign severity</p>
        <form method="POST" action="/discipline/report" style="display:flex;flex-direction:column;gap:18px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="dt-form-group">
              <label>Student *</label>
              <select name="student_id" required>
                <option value="">Select student...</option>
                ${studentOpts}
              </select>
            </div>
            <div class="dt-form-group">
              <label>Category *</label>
              <select name="category_id" required id="catSelect">
                <option value="">Select category...</option>
                ${catOpts}
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="dt-form-group">
              <label>Severity *</label>
              <select name="severity" required id="severitySelect">
                <option value="minor">Minor</option>
                <option value="moderate">Moderate</option>
                <option value="major">Major</option>
                <option value="critical">Critical</option>
              </select>
            </div>
            <div class="dt-form-group">
              <label>Incident Date *</label>
              <input type="datetime-local" name="incident_date" value="${new Date().toISOString().slice(0, 16)}" required>
            </div>
          </div>
          <div class="dt-form-group">
            <label>Location</label>
            <input type="text" name="location" placeholder="e.g., Classroom 3B, Playground, Hallway">
          </div>
          <div class="dt-form-group">
            <label>Description *</label>
            <textarea name="description" required placeholder="Provide a detailed description of the incident..."></textarea>
          </div>
          <div class="dt-form-group">
            <label>Witnesses</label>
            <textarea name="witnesses" placeholder="Names of witnesses, separated by commas..." style="min-height:60px"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="dt-form-group">
              <label>Parent/Guardian Phone</label>
              <input type="text" name="parent_phone" placeholder="e.g., 256700123456" id="parentPhone">
            </div>
            <div class="dt-form-group" style="display:flex;align-items:end;gap:12px;padding-bottom:4px">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;font-size:13px;color:#475569">
                <input type="checkbox" name="notify_parent" value="1" id="notifyParentCheck" style="width:18px;height:18px;accent-color:#dc2626">
                Notify parent via SMS
              </label>
            </div>
          </div>
          <div class="dt-form-group">
            <label>Evidence Path (optional)</label>
            <input type="text" name="evidence_path" placeholder="File path or attachment reference">
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end;margin-top:8px">
            <a href="/discipline" class="dt-btn dt-btn-ghost">Cancel</a>
            <button type="submit" class="dt-btn dt-btn-primary" style="padding:12px 28px">\uD83D\uDCCC Submit Incident Report</button>
          </div>
        </form>
      </div>
    </div>
    <script>
      document.getElementById('catSelect').addEventListener('change', function() {
        var opt = this.options[this.selectedIndex];
        if (opt.dataset.severity) document.getElementById('severitySelect').value = opt.dataset.severity;
      });
    </script>`;
    res.send(renderPage('Report New Incident', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /discipline/report — Save incident
  // ============================================================
  app.post('/discipline/report', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { student_id, category_id, severity, incident_date, location, description, witnesses, evidence_path, parent_phone, notify_parent } = req.body;

    if (!student_id || !category_id || !description || !description.trim()) {
      req.session.flash = { type: 'error', msg: 'Please fill in all required fields (student, category, description).' };
      return res.redirect('/discipline/report');
    }

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // Get category info for auto-action
      const cat = (await client.query(
        `SELECT * FROM behavior_categories WHERE id=$1 AND tenant_id=$2`, [category_id, tid]
      )).rows[0];

      // Get student phone if not provided
      let phone = parent_phone || '';
      if (!phone && student_id) {
        const studentPhone = (await client.query(
          `SELECT guardian_phone FROM students WHERE id=$1 AND tenant_id=$2`, [student_id, tid]
        )).rows[0];
        if (studentPhone) phone = studentPhone.guardian_phone || '';
      }

      // Insert incident
      const result = await client.query(
        `INSERT INTO discipline_incidents (tenant_id, student_id, category_id, reported_by, incident_date, location, description, witnesses, evidence_path, severity, parent_phone)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
        [tid, student_id, category_id, user.id, incident_date || new Date().toISOString(), location || null, description.trim(), witnesses || null, evidence_path || null, severity || 'minor', phone || null]
      );
      const incidentId = result.rows[0].id;

      // Auto-assign default action if category has one
      if (cat && cat.default_action) {
        const actionType = cat.default_action.toLowerCase().replace(/\s+/g, '_');
        const validTypes = ['warning', 'counseling', 'detention', 'suspension', 'expulsion', 'community_service', 'parent_meeting'];
        const finalType = validTypes.includes(actionType) ? actionType : 'warning';
        const durDays = finalType === 'detention' ? 1 : finalType === 'suspension' ? 3 : 0;
        await client.query(
          `INSERT INTO discipline_actions (tenant_id, incident_id, student_id, action_type, description, duration_days, assigned_by, status)
           VALUES ($1,$2,$3,$4,$5,$6,$7,'active')`,
          [tid, incidentId, student_id, finalType, `Auto-assigned for category: ${cat.name}`, durDays, user.id]
        );
      }

      // Parent notification
      const shouldNotify = notify_parent === '1' || notify_parent === 'true';
      if (shouldNotify && phone) {
        await client.query(
          `UPDATE discipline_incidents SET parent_notified=true, parent_notified_at=NOW() WHERE id=$1 AND tenant_id=$2`,
          [incidentId, tid]
        );
        // Log SMS in sms_logs table if exists
        try {
          await client.query(
            `INSERT INTO sms_logs (tenant_id, phone_number, message, message_type, reference_id, created_by)
             VALUES ($1,$2,$3,'discipline_notice',$4,$5)`,
            [tid, phone, `DISCIPLINE NOTICE: Your child has been involved in a ${severity || 'minor'} incident at school. Please contact the school administration for details. Ref: INC-${incidentId}`, incidentId, user.id]
          );
        } catch (smsErr) {
          // SMS log table may not exist; non-critical
        }
      }

      await client.query('COMMIT');
      req.session.flash = { type: 'success', msg: `Incident #${incidentId} reported successfully.${shouldNotify && phone ? ' Parent notified via SMS.' : ''}` };
      res.redirect('/discipline/incidents/' + incidentId);
    } catch (e) {
      await client.query('ROLLBACK');
      req.session.flash = { type: 'error', msg: 'Failed to save incident: ' + e.message };
      res.redirect('/discipline/report');
    } finally { client.release(); }
  }));

  // ============================================================
  // ROUTE 4: GET /discipline/incidents — All incidents list
  // ============================================================
  app.get('/discipline/incidents', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 20;
    const offset = (page - 1) * perPage;
    const { status, severity, search, class_id, date_from, date_to } = req.query;

    // Build filter clauses
    let where = ['di.tenant_id=$1'], params = [tid], pi = 2;
    if (status) { where.push(`di.status=$${pi++}`); params.push(status); }
    if (severity) { where.push(`di.severity=$${pi++}`); params.push(severity); }
    if (search) { where.push(`(s.first_name ILIKE $${pi} OR s.last_name ILIKE $${pi} OR di.description ILIKE $${pi} OR di.location ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    if (class_id) { where.push(`s.class_id=$${pi++}`); params.push(class_id); }
    if (date_from) { where.push(`di.incident_date >= $${pi++}`); params.push(date_from); }
    if (date_to) { where.push(`di.incident_date <= $${pi++}`); params.push(date_to); }

    const whereClause = where.join(' AND ');
    const countResult = (await pool.query(`SELECT COUNT(*)::int as total FROM discipline_incidents di LEFT JOIN students s ON s.id=di.student_id WHERE ${whereClause}`, params)).rows[0];
    const totalPages = Math.ceil(countResult.total / perPage);

    const incidents = (await pool.query(
      `SELECT di.*, s.first_name as student_first, s.last_name as student_last, s.admission_number,
              bc.name as category_name, u.display_name as reporter_name
       FROM discipline_incidents di
       LEFT JOIN students s ON s.id = di.student_id
       LEFT JOIN behavior_categories bc ON bc.id = di.category_id
       LEFT JOIN users u ON u.id = di.reported_by
       WHERE ${whereClause}
       ORDER BY di.incident_date DESC LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, perPage, offset]
    )).rows;

    // Get classes for filter dropdown
    const classes = (await pool.query(
      `SELECT id, name FROM classes WHERE tenant_id=$1 ORDER BY name LIMIT 50`, [tid]
    )).rows;
    const classOpts = classes.map(c => `<option value="${c.id}" ${class_id == c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('');

    const rowsHtml = incidents.map(r => `<tr>
      <td><a href="/discipline/incidents/${r.id}" style="color:#dc2626;text-decoration:none;font-weight:600">#${r.id}</a></td>
      <td><strong>${esc(r.student_first || '')} ${esc(r.student_last || 'Unknown')}</strong>
        ${r.admission_number ? `<br><span style="font-size:11px;color:#94a3b8">${esc(r.admission_number)}</span>` : ''}</td>
      <td>${esc(r.category_name || 'N/A')}</td>
      <td>${severityBadge(r.severity)}</td>
      <td>${statusBadge(r.status)}</td>
      <td style="font-size:12px;color:#64748b">${esc(r.location || '\u2014')}</td>
      <td style="font-size:12px;color:#64748b">${fmtDate(r.incident_date)}</td>
      <td>${r.parent_notified ? '\u2705' : '\u274C'}</td>
    </tr>`).join('');

    const baseUrl = `/discipline/incidents?status=${esc(status || '')}&severity=${esc(severity || '')}&search=${esc(search || '')}&class_id=${esc(class_id || '')}&date_from=${esc(date_from || '')}&date_to=${esc(date_to || '')}`;

    const html = DT_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('incidents')}
      ${flashMsg(req)}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDCDC All Incidents</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">${countResult.total} total incidents</p></div>
        <a href="/discipline/report" class="dt-btn dt-btn-primary">\uD83D\uDCCB New Incident</a>
      </div>

      <div class="dt-filter">
        <div><label>Status</label><select onchange="location.href='/discipline/incidents?status='+this.value+'&severity=${esc(severity || '')}&search=${esc(search || '')}'">
          <option value="">All Statuses</option>
          <option value="open" ${status==='open'?'selected':''}>Open</option>
          <option value="under_review" ${status==='under_review'?'selected':''}>Under Review</option>
          <option value="resolved" ${status==='resolved'?'selected':''}>Resolved</option>
          <option value="closed" ${status==='closed'?'selected':''}>Closed</option>
          <option value="appealed" ${status==='appealed'?'selected':''}>Appealed</option>
        </select></div>
        <div><label>Severity</label><select onchange="location.href='/discipline/incidents?severity='+this.value+'&status=${esc(status || '')}&search=${esc(search || '')}'">
          <option value="">All Severities</option>
          <option value="minor" ${severity==='minor'?'selected':''}>Minor</option>
          <option value="moderate" ${severity==='moderate'?'selected':''}>Moderate</option>
          <option value="major" ${severity==='major'?'selected':''}>Major</option>
          <option value="critical" ${severity==='critical'?'selected':''}>Critical</option>
        </select></div>
        <div><label>Class</label><select onchange="location.href='/discipline/incidents?class_id='+this.value+'&status=${esc(status || '')}&search=${esc(search || '')}'">
          <option value="">All Classes</option>
          ${classOpts}
        </select></div>
        <div><label>From</label><input type="date" value="${esc(date_from || '')}" onchange="location.href='/discipline/incidents?date_from='+this.value+'&date_to=${esc(date_to || '')}&status=${esc(status || '')}&search=${esc(search || '')}'"></div>
        <div><label>To</label><input type="date" value="${esc(date_to || '')}" onchange="location.href='/discipline/incidents?date_to='+this.value+'&date_from=${esc(date_from || '')}&status=${esc(status || '')}&search=${esc(search || '')}'"></div>
        <div><label>Search</label><form method="GET" action="/discipline/incidents" style="display:flex;gap:4px">
          <input type="text" name="search" value="${esc(search || '')}" placeholder="Student, description..." style="padding:8px 12px;border:2px solid #fecaca;border-radius:10px;font-size:13px;min-width:180px">
          <button type="submit" class="dt-btn dt-btn-secondary" style="padding:8px 12px">\uD83D\uDD0D</button>
        </form></div>
      </div>

      <div class="dt-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table class="dt-table">
          <thead><tr><th>ID</th><th>Student</th><th>Category</th><th>Severity</th><th>Status</th><th>Location</th><th>Date</th><th>Parent</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" class="dt-empty">No incidents found</td></tr>'}</tbody>
        </table></div>
      </div>
      ${paginate(page, totalPages, baseUrl)}
    </div>`;
    res.send(renderPage('All Incidents', html, user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /discipline/incidents/:id — Incident detail
  // ============================================================
  app.get('/discipline/incidents/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, incidentId = req.params.id;

    const incident = (await pool.query(
      `SELECT di.*, s.first_name as student_first, s.last_name as student_last, s.admission_number, s.class_id,
              c.name as class_name, bc.name as category_name, bc.points as category_points, bc.description as category_desc,
              u.display_name as reporter_name, ru.display_name as resolver_name
       FROM discipline_incidents di
       LEFT JOIN students s ON s.id = di.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       LEFT JOIN behavior_categories bc ON bc.id = di.category_id
       LEFT JOIN users u ON u.id = di.reported_by
       LEFT JOIN users ru ON ru.id = di.resolved_by
       WHERE di.id=$1 AND di.tenant_id=$2`, [incidentId, tid]
    )).rows[0];

    if (!incident) {
      return res.send(renderPage('Not Found', `<div style="max-width:600px;margin:0 auto;text-align:center;padding:60px">
        <div style="font-size:48px;margin-bottom:16px">\uD83D\uDD0D</div>
        <h2 style="color:#dc2626;margin:0 0 8px">Incident Not Found</h2>
        <p style="color:#94a3b8;margin-bottom:20px">The incident you are looking for does not exist or has been removed.</p>
        <a href="/discipline/incidents" class="dt-btn dt-btn-primary">\u2190 Back to Incidents</a>
      </div>`, user, req));
    }

    // Get actions for this incident
    const actions = (await pool.query(
      `SELECT da.*, u.display_name as assigned_by_name
       FROM discipline_actions da
       LEFT JOIN users u ON u.id = da.assigned_by
       WHERE da.tenant_id=$1 AND da.incident_id=$2
       ORDER BY da.created_at DESC`, [tid, incidentId]
    )).rows;

    // Student discipline history
    const studentHistory = (await pool.query(
      `SELECT di.id, di.incident_date, di.severity, di.status, bc.name as category_name
       FROM discipline_incidents di
       LEFT JOIN behavior_categories bc ON bc.id = di.category_id
       WHERE di.tenant_id=$1 AND di.student_id=$2 AND di.id != $3
       ORDER BY di.incident_date DESC LIMIT 10`, [tid, incident.student_id, incidentId]
    )).rows;

    // Calculate student behavior score
    const scoreData = (await pool.query(
      `SELECT COALESCE(SUM(bc.points), 0)::int as total_points,
              COUNT(di.id)::int as total_incidents
       FROM discipline_incidents di
       LEFT JOIN behavior_categories bc ON bc.id = di.category_id
       WHERE di.tenant_id=$1 AND di.student_id=$2`, [tid, incident.student_id || 0]
    )).rows[0];
    const behaviorScore = Math.max(0, 100 - (scoreData.total_points || 0));

    // Build timeline
    const timelineItems = [];
    timelineItems.push({ type: 'default', date: incident.created_at, text: `Incident reported by ${esc(incident.reporter_name || 'Unknown')}`, detail: `Severity: ${incident.severity} | Category: ${esc(incident.category_name || 'N/A')}` });
    if (incident.status === 'under_review') {
      timelineItems.push({ type: 'action', date: incident.updated_at, text: 'Status changed to Under Review', detail: '' });
    }
    if (incident.parent_notified) {
      timelineItems.push({ type: 'action', date: incident.parent_notified_at, text: 'Parent notified via SMS', detail: `Phone: ${esc(incident.parent_phone || 'N/A')}` });
    }
    actions.forEach(a => {
      timelineItems.push({ type: 'action', date: a.created_at, text: `${esc((a.action_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))} assigned`, detail: esc(a.description || '') + (a.duration_days > 0 ? ` (${a.duration_days} days)` : '') });
      if (a.status === 'completed') {
        timelineItems.push({ type: 'resolve', date: a.completed_at, text: `${esc((a.action_type || '').replace(/_/g, ' '))} completed`, detail: '' });
      }
    });
    if (incident.resolved_at) {
      timelineItems.push({ type: 'resolve', date: incident.resolved_at, text: `Incident resolved by ${esc(incident.resolver_name || 'Unknown')}`, detail: esc(incident.resolution_notes || '') });
    }
    timelineItems.sort((a, b) => new Date(b.date) - new Date(a.date));

    const timelineHtml = timelineItems.map(t => `
      <div class="dt-timeline-item ${t.type}">
        <div style="font-size:12px;font-weight:600;color:#475569">${t.text}</div>
        <div style="font-size:11px;color:#94a3b8;margin-top:2px">${fmtDateTime(t.date)}</div>
        ${t.detail ? `<div style="font-size:12px;color:#64748b;margin-top:4px">${t.detail}</div>` : ''}
      </div>
    `).join('');

    const actionsHtml = actions.map(a => `<tr>
      <td>${actionTypeBadge(a.action_type)}</td>
      <td>${esc(a.description || '\u2014')}</td>
      <td>${a.duration_days > 0 ? a.duration_days + ' days' : '\u2014'}</td>
      <td>${a.start_date ? fmtDate(a.start_date) : '\u2014'}${a.end_date ? ' \u2014 ' + fmtDate(a.end_date) : ''}</td>
      <td>${statusBadge(a.status)}</td>
      <td style="font-size:12px;color:#64748b">${fmtDateTime(a.created_at)}</td>
    </tr>`).join('');

    const historyHtml = studentHistory.map(h => `<tr>
      <td><a href="/discipline/incidents/${h.id}" style="color:#dc2626;text-decoration:none">#${h.id}</a></td>
      <td>${esc(h.category_name || 'N/A')}</td>
      <td>${severityBadge(h.severity)}</td>
      <td>${statusBadge(h.status)}</td>
      <td style="font-size:12px;color:#64748b">${fmtDate(h.incident_date)}</td>
    </tr>`).join('');

    const canResolve = incident.status !== 'resolved' && incident.status !== 'closed';
    const canAssign = incident.status !== 'closed' && incident.status !== 'resolved';

    const html = DT_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('incidents')}
      ${flashMsg(req)}
      <a href="/discipline/incidents" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">\u2190 Back to Incidents</a>

      <!-- Incident Header -->
      <div class="dt-card" style="padding:24px;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px">
            <h1 style="font-size:22px;color:#1e293b;margin:0">Incident #${incident.id}</h1>
            ${severityBadge(incident.severity)}
            ${statusBadge(incident.status)}
          </div>
          <div style="font-size:13px;color:#64748b">
            <strong>${esc(incident.student_first || '')} ${esc(incident.student_last || 'Unknown')}</strong>
            ${incident.admission_number ? ` \u00B7 ${esc(incident.admission_number)}` : ''}
            ${incident.class_name ? ` \u00B7 ${esc(incident.class_name)}` : ''}
          </div>
        </div>
        <div style="display:flex;gap:8px">
          ${canResolve ? `<form method="POST" action="/discipline/incidents/${incident.id}/resolve" style="display:inline">
            <button type="submit" class="dt-btn dt-btn-success">\u2705 Resolve</button>
          </form>` : ''}
          ${canAssign ? `<a href="/discipline/actions?incident_id=${incident.id}" class="dt-btn dt-btn-accent">\u2696\uFE0F Assign Action</a>` : ''}
        </div>
      </div>

      <!-- Main content -->
      <div class="dt-grid-2" style="margin-bottom:16px">
        <!-- Left column: Details + Actions -->
        <div>
          <div class="dt-card">
            <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCC4 Incident Details</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;font-size:13px">
              <div><span style="color:#94a3b8">Category:</span><br><strong>${esc(incident.category_name || 'N/A')}</strong></div>
              <div><span style="color:#94a3b8">Location:</span><br><strong>${esc(incident.location || '\u2014')}</strong></div>
              <div><span style="color:#94a3b8">Date:</span><br><strong>${fmtDateTime(incident.incident_date)}</strong></div>
              <div><span style="color:#94a3b8">Reported By:</span><br><strong>${esc(incident.reporter_name || '\u2014')}</strong></div>
              <div><span style="color:#94a3b8">Parent Notified:</span><br>${incident.parent_notified ? '<span style="color:#059669;font-weight:600">Yes (' + fmtDateTime(incident.parent_notified_at) + ')</span>' : '<span style="color:#94a3b8">No</span>'}</div>
              <div><span style="color:#94a3b8">Parent Phone:</span><br><strong>${esc(incident.parent_phone || '\u2014')}</strong></div>
            </div>
            ${incident.description ? `<div style="margin-top:14px;padding:12px;background:#fef2f2;border-radius:10px;font-size:13px;color:#1e293b"><strong>Description:</strong><br>${esc(incident.description)}</div>` : ''}
            ${incident.witnesses ? `<div style="margin-top:10px;padding:12px;background:#f8fafc;border-radius:10px;font-size:13px;color:#1e293b"><strong>Witnesses:</strong><br>${esc(incident.witnesses)}</div>` : ''}
            ${incident.resolution_notes ? `<div style="margin-top:10px;padding:12px;background:#dcfce7;border-radius:10px;font-size:13px;color:#15803d"><strong>Resolution:</strong><br>${esc(incident.resolution_notes)}</div>` : ''}
          </div>

          <!-- Disciplinary Actions -->
          <div class="dt-card">
            <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\u2696\uFE0F Disciplinary Actions (${actions.length})</h3>
            ${actions.length > 0 ? `<table class="dt-table">
              <thead><tr><th>Type</th><th>Description</th><th>Duration</th><th>Dates</th><th>Status</th><th>Created</th></tr></thead>
              <tbody>${actionsHtml}</tbody>
            </table>` : '<p class="dt-empty">No disciplinary actions assigned yet</p>'}
          </div>
        </div>

        <!-- Right column: Timeline + Score + History -->
        <div>
          <!-- Behavior Score -->
          <div class="dt-card" style="margin-bottom:16px">
            <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83C\uDFAF Student Behavior Score</h3>
            <div style="display:flex;align-items:center;gap:16px">
              ${behaviorScoreCard(behaviorScore, `${incident.student_first || 'Student'}`)}
              <div style="font-size:13px;color:#64748b">
                <div>Total Incidents: <strong>${scoreData.total_incidents}</strong></div>
                <div>Demerit Points: <strong>${scoreData.total_points}</strong></div>
              </div>
            </div>
          </div>

          <!-- Timeline -->
          <div class="dt-card" style="margin-bottom:16px">
            <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDD70\uFE0F Incident Timeline</h3>
            <div class="dt-timeline" style="max-height:400px;overflow-y:auto">
              ${timelineHtml || '<p class="dt-empty">No timeline events</p>'}
            </div>
          </div>

          <!-- Student History -->
          <div class="dt-card">
            <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCDA Student Discipline History</h3>
            ${studentHistory.length > 0 ? `<div style="max-height:250px;overflow-y:auto"><table class="dt-table">
              <thead><tr><th>ID</th><th>Category</th><th>Severity</th><th>Status</th><th>Date</th></tr></thead>
              <tbody>${historyHtml}</tbody>
            </table></div>` : '<p class="dt-empty">No prior incidents</p>'}
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Incident #' + incident.id, html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /discipline/incidents/:id/resolve — Resolve
  // ============================================================
  app.post('/discipline/incidents/:id/resolve', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, incidentId = req.params.id;
    const { resolution_notes, new_status } = req.body;

    const incident = (await pool.query(
      `SELECT id, status FROM discipline_incidents WHERE id=$1 AND tenant_id=$2`, [incidentId, tid]
    )).rows[0];

    if (!incident) {
      req.session.flash = { type: 'error', msg: 'Incident not found.' };
      return res.redirect('/discipline/incidents');
    }

    if (incident.status === 'resolved' || incident.status === 'closed') {
      req.session.flash = { type: 'error', msg: 'This incident is already resolved or closed.' };
      return res.redirect('/discipline/incidents/' + incidentId);
    }

    const statusVal = new_status || 'resolved';
    await pool.query(
      `UPDATE discipline_incidents SET status=$1, resolved_by=$2, resolved_at=NOW(), resolution_notes=$3, updated_at=NOW() WHERE id=$4 AND tenant_id=$5`,
      [statusVal, user.id, resolution_notes || null, incidentId, tid]
    );

    // Also mark any active actions as completed
    await pool.query(
      `UPDATE discipline_actions SET status='completed', completed_at=NOW() WHERE tenant_id=$1 AND incident_id=$2 AND status='active'`,
      [tid, incidentId]
    );

    req.session.flash = { type: 'success', msg: `Incident #${incidentId} marked as ${statusVal}.` };
    res.redirect('/discipline/incidents/' + incidentId);
  }));

  // ============================================================
  // ROUTE 7: GET /discipline/actions — All disciplinary actions
  // ============================================================
  app.get('/discipline/actions', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const perPage = 20;
    const offset = (page - 1) * perPage;
    const { status, action_type, search, incident_id } = req.query;

    let where = ['da.tenant_id=$1'], params = [tid], pi = 2;
    if (status) { where.push(`da.status=$${pi++}`); params.push(status); }
    if (action_type) { where.push(`da.action_type=$${pi++}`); params.push(action_type); }
    if (search) { where.push(`(s.first_name ILIKE $${pi} OR s.last_name ILIKE $${pi})`); params.push(`%${search}%`); pi++; }
    if (incident_id) { where.push(`da.incident_id=$${pi++}`); params.push(incident_id); }

    const whereClause = where.join(' AND ');
    const countResult = (await pool.query(
      `SELECT COUNT(*)::int as total FROM discipline_actions da LEFT JOIN students s ON s.id=da.student_id WHERE ${whereClause}`, params
    )).rows[0];
    const totalPages = Math.ceil(countResult.total / perPage);

    const actions = (await pool.query(
      `SELECT da.*, s.first_name as student_first, s.last_name as student_last, s.admission_number,
              di.severity as incident_severity, u.display_name as assigned_by_name
       FROM discipline_actions da
       LEFT JOIN students s ON s.id = da.student_id
       LEFT JOIN discipline_incidents di ON di.id = da.incident_id
       LEFT JOIN users u ON u.id = da.assigned_by
       WHERE ${whereClause}
       ORDER BY da.created_at DESC LIMIT $${pi++} OFFSET $${pi++}`,
      [...params, perPage, offset]
    )).rows;

    // Action type summary
    const typeSummary = (await pool.query(
      `SELECT action_type, status, COUNT(*)::int as cnt FROM discipline_actions WHERE tenant_id=$1 GROUP BY action_type, status ORDER BY action_type, cnt DESC`, [tid]
    )).rows;

    const rowsHtml = actions.map(a => `<tr>
      <td>${actionTypeBadge(a.action_type)}</td>
      <td><strong>${esc(a.student_first || '')} ${esc(a.student_last || 'Unknown')}</strong>
        ${a.admission_number ? `<br><span style="font-size:11px;color:#94a3b8">${esc(a.admission_number)}</span>` : ''}</td>
      <td><a href="/discipline/incidents/${a.incident_id}" style="color:#dc2626;text-decoration:none;font-size:12px">#${a.incident_id}</a></td>
      <td style="font-size:12px">${esc(a.description || '\u2014')}</td>
      <td>${a.duration_days > 0 ? a.duration_days + ' days' : '\u2014'}</td>
      <td style="font-size:12px;color:#64748b">${a.end_date ? fmtDate(a.end_date) : '\u2014'}</td>
      <td>${statusBadge(a.status)}</td>
      <td style="font-size:12px;color:#64748b">${fmtDateTime(a.created_at)}</td>
    </tr>`).join('');

    const summaryHtml = typeSummary.map(t => `<tr>
      <td>${actionTypeBadge(t.action_type)}</td>
      <td>${statusBadge(t.status)}</td>
      <td style="font-weight:600">${t.cnt}</td>
    </tr>`).join('');

    const baseUrl = `/discipline/actions?status=${esc(status || '')}&action_type=${esc(action_type || '')}&search=${esc(search || '')}`;

    const html = DT_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('actions')}
      ${flashMsg(req)}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\u2696\uFE0F Disciplinary Actions</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">${countResult.total} total actions</p></div>
        <a href="/discipline/actions?form=1" class="dt-btn dt-btn-primary">\u2795 Assign New Action</a>
      </div>

      <!-- Assign action form (if ?form=1) -->
      ${req.query.form === '1' ? `
      <div class="dt-card" style="padding:24px;margin-bottom:16px;background:#fef2f2">
        <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">\u2795 Assign Disciplinary Action</h3>
        <form method="POST" action="/discipline/actions" style="display:flex;flex-direction:column;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="dt-form-group">
              <label>Student *</label>
              <select name="student_id" required>
                <option value="">Select student...</option>
                ${(await pool.query(`SELECT id, first_name, last_name, admission_number FROM students WHERE tenant_id=$1 ORDER BY last_name, first_name LIMIT 500`, [tid])).rows.map(s =>
                  `<option value="${s.id}">${esc(s.last_name || '')}, ${esc(s.first_name || '')} (${esc(s.admission_number || s.id)})</option>`
                ).join('')}
              </select>
            </div>
            <div class="dt-form-group">
              <label>Incident (optional)</label>
              <select name="incident_id">
                <option value="">Select incident...</option>
                ${incident_id ? `<option value="${incident_id}" selected>Incident #${incident_id}</option>` : ''}
                ${(await pool.query(
                  `SELECT di.id, s.first_name, s.last_name FROM discipline_incidents di LEFT JOIN students s ON s.id=di.student_id WHERE di.tenant_id=$1 AND di.status IN ('open','under_review') ORDER BY di.incident_date DESC LIMIT 50`, [tid]
                )).rows.map(i => `<option value="${i.id}" ${incident_id == i.id ? 'selected' : ''}>#${i.id} - ${esc(i.first_name || '')} ${esc(i.last_name || '')}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div class="dt-form-group">
              <label>Action Type *</label>
              <select name="action_type" required>
                <option value="">Select type...</option>
                <option value="warning">Warning</option>
                <option value="counseling">Counseling</option>
                <option value="detention">Detention</option>
                <option value="suspension">Suspension</option>
                <option value="expulsion">Expulsion</option>
                <option value="community_service">Community Service</option>
                <option value="parent_meeting">Parent Meeting</option>
              </select>
            </div>
            <div class="dt-form-group">
              <label>Duration (days)</label>
              <input type="number" name="duration_days" min="0" value="0" id="durationInput">
            </div>
            <div class="dt-form-group">
              <label>Start Date</label>
              <input type="date" name="start_date" value="${today()}" id="startDateInput">
            </div>
          </div>
          <div class="dt-form-group">
            <label>Description</label>
            <textarea name="description" placeholder="Describe the disciplinary action..."></textarea>
          </div>
          <div class="dt-form-group">
            <label>Notes</label>
            <textarea name="notes" placeholder="Additional notes..." style="min-height:50px"></textarea>
          </div>
          <div style="display:flex;gap:10px;justify-content:flex-end">
            <a href="/discipline/actions" class="dt-btn dt-btn-ghost">Cancel</a>
            <button type="submit" class="dt-btn dt-btn-primary">\u2705 Assign Action</button>
          </div>
        </form>
      </div>
      ` : ''}

      <div class="dt-filter">
        <div><label>Status</label><select onchange="location.href='/discipline/actions?status='+this.value+'&action_type=${esc(action_type || '')}&search=${esc(search || '')}'">
          <option value="">All Statuses</option>
          <option value="active" ${status==='active'?'selected':''}>Active</option>
          <option value="completed" ${status==='completed'?'selected':''}>Completed</option>
          <option value="cancelled" ${status==='cancelled'?'selected':''}>Cancelled</option>
          <option value="appealed" ${status==='appealed'?'selected':''}>Appealed</option>
        </select></div>
        <div><label>Action Type</label><select onchange="location.href='/discipline/actions?action_type='+this.value+'&status=${esc(status || '')}&search=${esc(search || '')}'">
          <option value="">All Types</option>
          <option value="warning" ${action_type==='warning'?'selected':''}>Warning</option>
          <option value="counseling" ${action_type==='counseling'?'selected':''}>Counseling</option>
          <option value="detention" ${action_type==='detention'?'selected':''}>Detention</option>
          <option value="suspension" ${action_type==='suspension'?'selected':''}>Suspension</option>
          <option value="expulsion" ${action_type==='expulsion'?'selected':''}>Expulsion</option>
          <option value="community_service" ${action_type==='community_service'?'selected':''}>Community Service</option>
          <option value="parent_meeting" ${action_type==='parent_meeting'?'selected':''}>Parent Meeting</option>
        </select></div>
        <div><label>Search</label><form method="GET" action="/discipline/actions" style="display:flex;gap:4px">
          <input type="text" name="search" value="${esc(search || '')}" placeholder="Student name..." style="padding:8px 12px;border:2px solid #fecaca;border-radius:10px;font-size:13px;min-width:180px">
          <button type="submit" class="dt-btn dt-btn-secondary" style="padding:8px 12px">\uD83D\uDD0D</button>
        </form></div>
      </div>

      <div class="dt-grid-2" style="margin-bottom:16px">
        <div class="dt-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCCA Action Summary</h3>
          <div style="max-height:250px;overflow-y:auto"><table class="dt-table">
            <thead><tr><th>Type</th><th>Status</th><th>Count</th></tr></thead>
            <tbody>${summaryHtml || '<tr><td colspan="3" class="dt-empty">No data</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="dt-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\u2139\uFE0F Quick Info</h3>
          <div style="font-size:13px;color:#475569;line-height:2">
            <div>\u2022 <strong>Warning</strong>: Verbal or written notice to student</div>
            <div>\u2022 <strong>Counseling</strong>: Session with school counselor</div>
            <div>\u2022 <strong>Detention</strong>: After-school supervised study</div>
            <div>\u2022 <strong>Suspension</strong>: Temporary removal from school</div>
            <div>\u2022 <strong>Expulsion</strong>: Permanent removal from school</div>
            <div>\u2022 <strong>Community Service</strong>: Assigned service tasks</div>
            <div>\u2022 <strong>Parent Meeting</strong>: Mandatory guardian conference</div>
          </div>
        </div>
      </div>

      <div class="dt-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table class="dt-table">
          <thead><tr><th>Type</th><th>Student</th><th>Incident</th><th>Description</th><th>Duration</th><th>End Date</th><th>Status</th><th>Created</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="8" class="dt-empty">No actions found</td></tr>'}</tbody>
        </table></div>
      </div>
      ${paginate(page, totalPages, baseUrl)}
    </div>
    <script>
      document.getElementById('durationInput').addEventListener('change', function() {
        var dur = parseInt(this.value) || 0;
        if (dur > 0) {
          var start = document.getElementById('startDateInput').value;
          if (start) {
            var d = new Date(start);
            d.setDate(d.getDate() + dur);
            document.getElementById('endDatePreview').textContent = 'End: ' + d.toISOString().split('T')[0];
          }
        }
      });
    </script>`;
    res.send(renderPage('Disciplinary Actions', html, user, req));
  }));

  // ============================================================
  // ROUTE 8: POST /discipline/actions — Assign action
  // ============================================================
  app.post('/discipline/actions', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { student_id, incident_id, action_type, description, duration_days, start_date, notes } = req.body;

    if (!student_id || !action_type) {
      req.session.flash = { type: 'error', msg: 'Student and action type are required.' };
      return res.redirect('/discipline/actions?form=1');
    }

    const durDays = parseInt(duration_days) || 0;
    const startDate = start_date || today();
    let endDate = null;
    if (durDays > 0 && startDate) {
      const d = new Date(startDate);
      d.setDate(d.getDate() + durDays);
      endDate = d.toISOString().split('T')[0];
    }

    await pool.query(
      `INSERT INTO discipline_actions (tenant_id, incident_id, student_id, action_type, description, duration_days, start_date, end_date, assigned_by, status, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'active',$10)`,
      [tid, incident_id || null, student_id, action_type, description || null, durDays, startDate, endDate, user.id, notes || null]
    );

    // If this is a suspension, mark the incident as under_review
    if (incident_id && action_type === 'suspension') {
      await pool.query(
        `UPDATE discipline_incidents SET status='under_review', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='open'`,
        [incident_id, tid]
      );
    }

    req.session.flash = { type: 'success', msg: `Disciplinary action (${action_type.replace(/_/g, ' ')}) assigned successfully.` };
    res.redirect(incident_id ? '/discipline/incidents/' + incident_id : '/discipline/actions');
  }));

  // ============================================================
  // ROUTE 9: GET /discipline/categories — Manage categories
  // ============================================================
  app.get('/discipline/categories', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { action, edit_id, delete_id } = req.query;

    // Handle delete
    if (delete_id) {
      await pool.query(`UPDATE behavior_categories SET is_active=false WHERE id=$1 AND tenant_id=$2`, [delete_id, tid]);
      req.session.flash = { type: 'success', msg: 'Category deactivated.' };
      return res.redirect('/discipline/categories');
    }

    // Handle edit save
    if (action === 'save' && edit_id) {
      const { name, severity, description, default_action, points } = req.body;
      await pool.query(
        `UPDATE behavior_categories SET name=$1, severity=$2, description=$3, default_action=$4, points=$5 WHERE id=$6 AND tenant_id=$7`,
        [name, severity, description || null, default_action || null, parseInt(points) || 0, edit_id, tid]
      );
      req.session.flash = { type: 'success', msg: 'Category updated.' };
      return res.redirect('/discipline/categories');
    }

    // Handle create
    if (action === 'create') {
      const { name, severity, description, default_action, points } = req.body;
      if (!name || !name.trim()) {
        req.session.flash = { type: 'error', msg: 'Category name is required.' };
        return res.redirect('/discipline/categories');
      }
      await pool.query(
        `INSERT INTO behavior_categories (tenant_id, name, severity, description, default_action, points) VALUES ($1,$2,$3,$4,$5,$6)`,
        [tid, name.trim(), severity || 'minor', description || null, default_action || null, parseInt(points) || 0]
      );
      req.session.flash = { type: 'success', msg: `Category "${name.trim()}" created.` };
      return res.redirect('/discipline/categories');
    }

    // Load categories
    const categories = (await pool.query(
      `SELECT bc.*, (SELECT COUNT(*)::int FROM discipline_incidents di WHERE di.category_id=bc.id) as incident_count
       FROM behavior_categories bc WHERE bc.tenant_id=$1 ORDER BY bc.severity, bc.name`, [tid]
    )).rows;

    // Editing category
    let editForm = '';
    if (edit_id) {
      const editCat = categories.find(c => c.id == edit_id);
      if (editCat) {
        editForm = `<div class="dt-card" style="padding:24px;margin-bottom:16px;background:#fef2f2;border-color:#f97316">
          <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">\u270F\uFE0F Edit Category: ${esc(editCat.name)}</h3>
          <form method="GET" action="/discipline/categories" style="display:flex;flex-direction:column;gap:14px">
            <input type="hidden" name="action" value="save">
            <input type="hidden" name="edit_id" value="${editCat.id}">
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div class="dt-form-group"><label>Name *</label><input type="text" name="name" value="${esc(editCat.name)}" required></div>
              <div class="dt-form-group"><label>Severity</label><select name="severity">
                <option value="minor" ${editCat.severity==='minor'?'selected':''}>Minor</option>
                <option value="moderate" ${editCat.severity==='moderate'?'selected':''}>Moderate</option>
                <option value="major" ${editCat.severity==='major'?'selected':''}>Major</option>
                <option value="critical" ${editCat.severity==='critical'?'selected':''}>Critical</option>
              </select></div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
              <div class="dt-form-group"><label>Default Action</label>
                <select name="default_action">
                  <option value="">None</option>
                  <option value="warning" ${editCat.default_action==='warning'?'selected':''}>Warning</option>
                  <option value="counseling" ${editCat.default_action==='counseling'?'selected':''}>Counseling</option>
                  <option value="detention" ${editCat.default_action==='detention'?'selected':''}>Detention</option>
                  <option value="suspension" ${editCat.default_action==='suspension'?'selected':''}>Suspension</option>
                  <option value="parent_meeting" ${editCat.default_action==='parent_meeting'?'selected':''}>Parent Meeting</option>
                </select>
              </div>
              <div class="dt-form-group"><label>Demerit Points</label><input type="number" name="points" min="0" value="${editCat.points || 0}"></div>
            </div>
            <div class="dt-form-group"><label>Description</label><textarea name="description">${esc(editCat.description || '')}</textarea></div>
            <div style="display:flex;gap:10px;justify-content:flex-end">
              <a href="/discipline/categories" class="dt-btn dt-btn-ghost">Cancel</a>
              <button type="submit" class="dt-btn dt-btn-primary">\uD83D\uDCBE Save Changes</button>
            </div>
          </form>
        </div>`;
      }
    }

    // Default categories for reference
    const defaultCategories = [
      { name: 'Disrespect', severity: 'moderate', points: 5 },
      { name: 'Bullying', severity: 'major', points: 15 },
      { name: 'Truancy', severity: 'moderate', points: 10 },
      { name: 'Vandalism', severity: 'major', points: 15 },
      { name: 'Dress Code', severity: 'minor', points: 2 },
      { name: 'Cheating', severity: 'major', points: 10 },
      { name: 'Late Coming', severity: 'minor', points: 3 },
      { name: 'Fighting', severity: 'critical', points: 20 },
      { name: 'Phone Use', severity: 'minor', points: 2 }
    ];

    const categoriesHtml = categories.map(c => `<tr>
      <td><strong style="color:#1e293b">${esc(c.name)}</strong>
        ${!c.is_active ? ' <span style="font-size:11px;color:#94a3b8">(inactive)</span>' : ''}</td>
      <td>${severityBadge(c.severity)}</td>
      <td>${c.points || 0}</td>
      <td style="font-size:12px;color:#64748b">${esc(c.default_action ? (c.default_action).replace(/_/g, ' ').replace(/\b\w/g, ch => ch.toUpperCase()) : '\u2014')}</td>
      <td style="font-weight:600">${c.incident_count}</td>
      <td>
        <div style="display:flex;gap:4px">
          <a href="/discipline/categories?edit_id=${c.id}" class="dt-btn dt-btn-ghost" style="padding:4px 10px;font-size:12px">\u270F\uFE0F</a>
          <a href="/discipline/categories?delete_id=${c.id}" class="dt-btn dt-btn-danger" style="padding:4px 10px;font-size:12px" onclick="return confirm('Deactivate this category?')">\uD83D\uDDD1\uFE0F</a>
        </div>
      </td>
    </tr>`).join('');

    const html = DT_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${nav('categories')}
      ${flashMsg(req)}
      ${editForm}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\uD83C\uDFF7\uFE0F Behavior Categories</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">${categories.length} categories configured</p></div>
      </div>

      <!-- Create new category -->
      <div class="dt-card" style="padding:24px;margin-bottom:16px">
        <h3 style="font-size:16px;color:#1e293b;margin:0 0 16px">\u2795 Create New Category</h3>
        <form method="GET" action="/discipline/categories" style="display:flex;flex-direction:column;gap:14px">
          <input type="hidden" name="action" value="create">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="dt-form-group"><label>Category Name *</label><input type="text" name="name" required placeholder="e.g., Disrespect, Bullying, Truancy"></div>
            <div class="dt-form-group"><label>Severity</label>
              <select name="severity">
                <option value="minor">Minor</option>
                <option value="moderate">Moderate</option>
                <option value="major">Major</option>
                <option value="critical">Critical</option>
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div class="dt-form-group"><label>Default Action</label>
              <select name="default_action">
                <option value="">None</option>
                <option value="warning">Warning</option>
                <option value="counseling">Counseling</option>
                <option value="detention">Detention</option>
                <option value="suspension">Suspension</option>
                <option value="parent_meeting">Parent Meeting</option>
              </select>
            </div>
            <div class="dt-form-group"><label>Demerit Points</label><input type="number" name="points" min="0" value="0"></div>
          </div>
          <div class="dt-form-group"><label>Description</label><textarea name="description" placeholder="Describe this behavior category..."></textarea></div>
          <div style="display:flex;justify-content:flex-end">
            <button type="submit" class="dt-btn dt-btn-primary">\u2795 Create Category</button>
          </div>
        </form>
      </div>

      <!-- Quick-add default categories -->
      ${categories.length === 0 ? `
      <div class="dt-alert dt-alert-warning" style="margin-bottom:16px">
        \u26A0\uFE0F No categories configured. Click below to load default categories for common school behaviors.
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">
        ${defaultCategories.map(dc => `<form method="GET" action="/discipline/categories" style="display:inline">
          <input type="hidden" name="action" value="create">
          <input type="hidden" name="name" value="${dc.name}">
          <input type="hidden" name="severity" value="${dc.severity}">
          <input type="hidden" name="points" value="${dc.points}">
          <button type="submit" class="dt-btn dt-btn-secondary" style="font-size:12px;padding:6px 12px">+ ${dc.name}</button>
        </form>`).join('')}
      </div>
      ` : ''}

      <!-- Categories list -->
      <div class="dt-card" style="padding:0;overflow:hidden">
        <div style="overflow-x:auto"><table class="dt-table">
          <thead><tr><th>Name</th><th>Severity</th><th>Points</th><th>Default Action</th><th>Incidents</th><th>Actions</th></tr></thead>
          <tbody>${categoriesHtml || '<tr><td colspan="6" class="dt-empty">No categories configured</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Behavior Categories', html, user, req));
  }));

  // ============================================================
  // ROUTE 10: GET /discipline/reports — Analytics
  // ============================================================
  app.get('/discipline/reports', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { period } = req.query;
    const monthsBack = period === 'year' ? 12 : period === 'quarter' ? 3 : 6;
    const dateSince = `date_trunc('month', CURRENT_DATE - interval '${monthsBack} months')`;

    // -- Incidents by type --
    const byType = (await pool.query(
      `SELECT bc.name, COUNT(di.id)::int as cnt
       FROM discipline_incidents di
       LEFT JOIN behavior_categories bc ON bc.id = di.category_id
       WHERE di.tenant_id=$1 AND di.incident_date >= ${dateSince}
       GROUP BY bc.name ORDER BY cnt DESC`, [tid]
    )).rows;
    const maxType = Math.max(...byType.map(r => r.cnt), 1);
    const byTypeHtml = byType.map(t => {
      const p = pct(t.cnt, maxType);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:12px;font-weight:600;color:#475569;min-width:120px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(t.name || 'Uncategorized')}</span>
        <div style="flex:1;height:24px;background:#fef2f2;border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${p}%;background:linear-gradient(90deg,#dc2626,#f97316);border-radius:6px;transition:.3s"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:#1e293b;min-width:40px;text-align:right">${t.cnt}</span>
      </div>`;
    }).join('');

    // -- Incidents by class --
    const byClass = (await pool.query(
      `SELECT c.name as class_name, COUNT(di.id)::int as cnt
       FROM discipline_incidents di
       LEFT JOIN students s ON s.id = di.student_id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE di.tenant_id=$1 AND di.incident_date >= ${dateSince}
       GROUP BY c.name ORDER BY cnt DESC LIMIT 15`, [tid]
    )).rows;
    const maxClass = Math.max(...byClass.map(r => r.cnt), 1);
    const byClassHtml = byClass.map(c => {
      const p = pct(c.cnt, maxClass);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <span style="font-size:12px;font-weight:600;color:#475569;min-width:120px">${esc(c.class_name || 'Unassigned')}</span>
        <div style="flex:1;height:24px;background:#fef2f2;border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${p}%;background:linear-gradient(90deg,#f97316,#eab308);border-radius:6px;transition:.3s"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:#1e293b;min-width:40px;text-align:right">${c.cnt}</span>
      </div>`;
    }).join('');

    // -- Incidents by month --
    const byMonth = (await pool.query(
      `SELECT to_char(di.incident_date, 'Mon YYYY') as month_label,
              date_trunc('month', di.incident_date) as month_start,
              COUNT(di.id)::int as total,
              COUNT(di.id) FILTER (WHERE di.severity IN ('major','critical'))::int as serious,
              COUNT(di.id) FILTER (WHERE di.status IN ('resolved','closed'))::int as resolved
       FROM discipline_incidents di
       WHERE di.tenant_id=$1 AND di.incident_date >= ${dateSince}
       GROUP BY to_char(di.incident_date, 'Mon YYYY'), date_trunc('month', di.incident_date)
       ORDER BY month_start`, [tid]
    )).rows;
    const maxMonth = Math.max(...byMonth.map(r => r.total), 1);

    const byMonthHtml = byMonth.map(m => {
      const pTotal = pct(m.total, maxMonth);
      const pSerious = m.total > 0 ? pct(m.serious, m.total) : 0;
      const pResolved = m.total > 0 ? pct(m.resolved, m.total) : 0;
      return `<div style="margin-bottom:12px">
        <div style="font-size:12px;font-weight:600;color:#475569;margin-bottom:4px">${esc(m.month_label)}</div>
        <div style="display:flex;gap:4px;align-items:center">
          <div style="flex:1;height:20px;background:#fef2f2;border-radius:6px;overflow:hidden;position:relative">
            <div style="height:100%;width:${pResolved}%;background:#dcfce7;position:absolute;left:0;transition:.3s"></div>
            <div style="height:100%;width:${pSerious}%;background:#fee2e2;position:absolute;left:${pResolved}%;transition:.3s"></div>
            <div style="height:100%;width:100%;background:#fecaca33;position:absolute;transition:.3s"></div>
          </div>
          <span style="font-size:11px;font-weight:700;color:#1e293b;min-width:100px;text-align:right">${m.total} total | ${m.serious} serious | ${m.resolved} resolved</span>
        </div>
      </div>`;
    }).join('');

    // -- Student behavior scores (top/bottom) --
    const studentScores = (await pool.query(
      `SELECT s.id, s.first_name, s.last_name, s.admission_number, c.name as class_name,
              COUNT(di.id)::int as incident_count,
              COALESCE(SUM(bc.points), 0)::int as total_points
       FROM students s
       LEFT JOIN discipline_incidents di ON di.student_id = s.id AND di.tenant_id = $1
       LEFT JOIN behavior_categories bc ON bc.id = di.category_id
       LEFT JOIN classes c ON c.id = s.class_id
       WHERE s.tenant_id = $1
       GROUP BY s.id, s.first_name, s.last_name, s.admission_number, c.name
       HAVING COUNT(di.id) > 0
       ORDER BY total_points DESC LIMIT 30`, [tid]
    )).rows;

    const worstStudents = studentScores.slice(0, 10);
    const bestStudents = [...studentScores].reverse().slice(0, 10);

    const worstHtml = worstStudents.map((s, i) => {
      const score = Math.max(0, 100 - s.total_points);
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:${i < 3 ? '#fee2e2' : 'transparent'};margin-bottom:4px">
        <span style="font-size:12px;font-weight:800;color:${i < 3 ? '#dc2626' : '#94a3b8'};min-width:20px">${i + 1}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.first_name || '')} ${esc(s.last_name || '')}</div>
          <div style="font-size:10px;color:#94a3b8">${esc(s.class_name || 'N/A')} \u00B7 ${s.incident_count} incidents</div>
        </div>
        <div style="font-size:14px;font-weight:800;color:${score < 40 ? '#dc2626' : score < 70 ? '#f97316' : '#059669'}">${score}%</div>
      </div>`;
    }).join('');

    const bestHtml = bestStudents.map((s, i) => {
      const score = Math.max(0, 100 - s.total_points);
      return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:${i < 3 ? '#dcfce7' : 'transparent'};margin-bottom:4px">
        <span style="font-size:12px;font-weight:800;color:${i < 3 ? '#059669' : '#94a3b8'};min-width:20px">${i + 1}</span>
        <div style="flex:1;min-width:0">
          <div style="font-size:12px;font-weight:600;color:#1e293b;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(s.first_name || '')} ${esc(s.last_name || '')}</div>
          <div style="font-size:10px;color:#94a3b8">${esc(s.class_name || 'N/A')} \u00B7 ${s.incident_count} incidents</div>
        </div>
        <div style="font-size:14px;font-weight:800;color:#059669">${score}%</div>
      </div>`;
    }).join('');

    // -- Action type distribution --
    const actionTypes = (await pool.query(
      `SELECT action_type, COUNT(*)::int as cnt, COUNT(*) FILTER (WHERE status='active')::int as active_cnt
       FROM discipline_actions WHERE tenant_id=$1 GROUP BY action_type ORDER BY cnt DESC`, [tid]
    )).rows;

    const actionTypeHtml = actionTypes.map(a => {
      const totalMax = Math.max(...actionTypes.map(x => x.cnt), 1);
      const p = pct(a.cnt, totalMax);
      const label = (a.action_type || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        ${actionTypeBadge(a.action_type)}
        <div style="flex:1;height:24px;background:#fef2f2;border-radius:6px;overflow:hidden">
          <div style="height:100%;width:${p}%;background:#f97316;border-radius:6px;transition:.3s"></div>
        </div>
        <span style="font-size:12px;font-weight:700;color:#1e293b;min-width:80px;text-align:right">${a.cnt} (${a.active_cnt} active)</span>
      </div>`;
    }).join('');

    // -- Resolution rate --
    const statusStats = (await pool.query(
      `SELECT status, COUNT(*)::int as cnt FROM discipline_incidents WHERE tenant_id=$1 AND incident_date >= ${dateSince} GROUP BY status`, [tid]
    )).rows;
    const totalStatus = statusStats.reduce((s, r) => s + r.cnt, 0) || 1;
    const openCount = (statusStats.find(r => r.status === 'open') || {}).cnt || 0;
    const reviewCount = (statusStats.find(r => r.status === 'under_review') || {}).cnt || 0;
    const resolvedCount = (statusStats.find(r => r.status === 'resolved') || {}).cnt || 0;
    const closedCount = (statusStats.find(r => r.status === 'closed') || {}).cnt || 0;
    const appealedCount = (statusStats.find(r => r.status === 'appealed') || {}).cnt || 0;
    const resolutionRate = pct(resolvedCount + closedCount, totalStatus);

    // -- Comparison chart: this month vs last month --
    const thisMonthStats = (await pool.query(
      `SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE severity IN ('major','critical'))::int as serious
       FROM discipline_incidents WHERE tenant_id=$1 AND incident_date >= date_trunc('month', CURRENT_DATE)`, [tid]
    )).rows[0];
    const lastMonthStats = (await pool.query(
      `SELECT COUNT(*)::int as total, COUNT(*) FILTER (WHERE severity IN ('major','critical'))::int as serious
       FROM discipline_incidents WHERE tenant_id=$1 AND incident_date >= date_trunc('month', CURRENT_DATE - interval '1 month') AND incident_date < date_trunc('month', CURRENT_DATE)`, [tid]
    )).rows[0];
    const totalChange = thisMonthStats.total - lastMonthStats.total;
    const seriousChange = thisMonthStats.serious - lastMonthStats.serious;

    const html = DT_CSS + `<div style="max-width:1200px;margin:0 auto">
      ${nav('analytics')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">\uD83D\uDCCA Discipline Analytics</h1>
        <p style="font-size:13px;color:#94a3b8;margin-top:2px">Comprehensive behavior and incident analysis</p></div>
        <div style="display:flex;gap:6px">
          <a href="/discipline/reports?period=quarter" class="dt-btn ${period === 'quarter' ? 'dt-btn-primary' : 'dt-btn-secondary'}" style="font-size:12px;padding:6px 14px">3 Months</a>
          <a href="/discipline/reports" class="dt-btn ${!period || period === '6' ? 'dt-btn-primary' : 'dt-btn-secondary'}" style="font-size:12px;padding:6px 14px">6 Months</a>
          <a href="/discipline/reports?period=year" class="dt-btn ${period === 'year' ? 'dt-btn-primary' : 'dt-btn-secondary'}" style="font-size:12px;padding:6px 14px">12 Months</a>
        </div>
      </div>

      <!-- Summary Stats -->
      <div class="dt-grid-stats" style="margin-bottom:20px">
        <div class="dt-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="dt-stat-icon" style="background:#fef2f2;color:#dc2626">\uD83D\uDD04</div>
          <div><div class="dt-stat-num">${resolutionRate}%</div><div class="dt-stat-label">Resolution Rate</div></div>
        </div>
        <div class="dt-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="dt-stat-icon" style="background:#fef3c7;color:#b45309">\uD83D\uDCCB</div>
          <div><div class="dt-stat-num">${openCount + reviewCount}</div><div class="dt-stat-label">Pending Cases</div></div>
        </div>
        <div class="dt-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="dt-stat-icon" style="background:#fee2e2;color:#dc2626">\uD83D\uDD34</div>
          <div><div class="dt-stat-num">${resolvedCount}</div><div class="dt-stat-label">Resolved</div></div>
        </div>
        <div class="dt-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="dt-stat-icon" style="background:#f1f5f9;color:#64748b">\uD83D\uDD12</div>
          <div><div class="dt-stat-num">${closedCount}</div><div class="dt-stat-label">Closed</div></div>
        </div>
        <div class="dt-stat-card" style="display:flex;align-items:center;gap:14px">
          <div class="dt-stat-icon" style="background:#f3e8ff;color:#7c3aed">\u2696\uFE0F</div>
          <div><div class="dt-stat-num">${appealedCount}</div><div class="dt-stat-label">Appealed</div></div>
        </div>
      </div>

      <!-- Month-over-month comparison -->
      <div class="dt-card" style="margin-bottom:16px">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCC8 Month-over-Month Comparison</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div style="text-align:center;padding:16px;background:#fef2f2;border-radius:12px">
            <div style="font-size:12px;color:#991b1b;font-weight:600;text-transform:uppercase;letter-spacing:.5px">This Month Total</div>
            <div style="font-size:32px;font-weight:800;color:#dc2626;margin:4px 0">${thisMonthStats.total}</div>
            <div style="font-size:13px;font-weight:600;color:${totalChange <= 0 ? '#059669' : '#dc2626'}">
              ${totalChange <= 0 ? '\u2193' : '\u2191'} ${Math.abs(totalChange)} vs last month
            </div>
          </div>
          <div style="text-align:center;padding:16px;background:#fef2f2;border-radius:12px">
            <div style="font-size:12px;color:#991b1b;font-weight:600;text-transform:uppercase;letter-spacing:.5px">Serious Incidents</div>
            <div style="font-size:32px;font-weight:800;color:#dc2626;margin:4px 0">${thisMonthStats.serious}</div>
            <div style="font-size:13px;font-weight:600;color:${seriousChange <= 0 ? '#059669' : '#dc2626'}">
              ${seriousChange <= 0 ? '\u2193' : '\u2191'} ${Math.abs(seriousChange)} vs last month
            </div>
          </div>
        </div>
      </div>

      <!-- By Type + By Class -->
      <div class="dt-grid-2" style="margin-bottom:16px">
        <div class="dt-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83C\uDFE5 Incidents by Category</h3>
          <div style="max-height:300px;overflow-y:auto">${byTypeHtml || '<p class="dt-empty">No data</p>'}</div>
        </div>
        <div class="dt-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83C\uDFEB Incidents by Class</h3>
          <div style="max-height:300px;overflow-y:auto">${byClassHtml || '<p class="dt-empty">No data</p>'}</div>
        </div>
      </div>

      <!-- Monthly trend + Action types -->
      <div class="dt-grid-2" style="margin-bottom:16px">
        <div class="dt-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCC5 Monthly Trend</h3>
          <div style="font-size:11px;color:#94a3b8;margin-bottom:8px;display:flex;gap:12px">
            <span><span style="display:inline-block;width:10px;height:10px;background:#fecaca;border-radius:2px"></span> Total</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:#fee2e2;border-radius:2px"></span> Serious</span>
            <span><span style="display:inline-block;width:10px;height:10px;background:#dcfce7;border-radius:2px"></span> Resolved</span>
          </div>
          <div style="max-height:300px;overflow-y:auto">${byMonthHtml || '<p class="dt-empty">No data</p>'}</div>
        </div>
        <div class="dt-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\u2696\uFE0F Action Type Distribution</h3>
          <div style="max-height:300px;overflow-y:auto">${actionTypeHtml || '<p class="dt-empty">No data</p>'}</div>
        </div>
      </div>

      <!-- Student rankings -->
      <div class="dt-grid-2" style="margin-bottom:16px">
        <div class="dt-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\u26A0\uFE0F Most At-Risk Students</h3>
          <div style="max-height:350px;overflow-y:auto">${worstHtml || '<p class="dt-empty">No data</p>'}</div>
        </div>
        <div class="dt-card">
          <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\u2B50 Best Behavior Scores</h3>
          <div style="max-height:350px;overflow-y:auto">${bestHtml || '<p class="dt-empty">No data</p>'}</div>
        </div>
      </div>

      <!-- Status breakdown -->
      <div class="dt-card">
        <h3 style="font-size:15px;color:#1e293b;margin:0 0 14px">\uD83D\uDCCA Status Distribution</h3>
        <div style="display:flex;gap:16px;flex-wrap:wrap;align-items:center;justify-content:center;padding:16px 0">
          ${statusStats.map(s => {
            const p = pct(s.cnt, totalStatus);
            const colors = { open: '#fef3c7', under_review: '#dbeafe', resolved: '#dcfce7', closed: '#f1f5f9', appealed: '#f3e8ff' };
            const textColors = { open: '#b45309', under_review: '#1d4ed8', resolved: '#15803d', closed: '#64748b', appealed: '#7c3aed' };
            const bg = colors[s.status] || '#f1f5f9';
            const tc = textColors[s.status] || '#475569';
            const label = (s.status || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
            return `<div style="text-align:center;min-width:90px">
              <div style="width:80px;height:80px;border-radius:50%;background:${bg};display:flex;align-items:center;justify-content:center;flex-direction:column;margin:0 auto 6px">
                <span style="font-size:20px;font-weight:800;color:${tc}">${s.cnt}</span>
              </div>
              <div style="font-size:11px;font-weight:600;color:${tc}">${esc(label)}</div>
              <div style="font-size:10px;color:#94a3b8">${p}%</div>
            </div>`;
          }).join('')}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Discipline Analytics', html, user, req));
  }));

}; // end module
