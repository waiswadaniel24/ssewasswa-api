// ============================================================
// VOLUNTEER HOURS MODULE — Multi-Tenant SaaS School Portal
// Opportunity posting, hour logging & verification, org
// partnerships, service categories, certificates, leaderboards,
// impact metrics, reflection journals, service learning, goals.
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  const fmtDate = d => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtNum = n => Number(n || 0).toLocaleString();
  const statusBadge = s => {
    const m = { active: { bg: '#dcfce7', c: '#15803d' }, completed: { bg: '#dbeafe', c: '#1d4ed8' }, pending: { bg: '#fef3c7', c: '#b45309' }, verified: { bg: '#dcfce7', c: '#15803d' }, rejected: { bg: '#fee2e2', c: '#dc2626' }, cancelled: { bg: '#f1f5f9', c: '#64748b' }, open: { bg: '#ede9fe', c: '#6d28d9' }, closed: { bg: '#f1f5f9', c: '#64748b' } };
    const v = m[s] || { bg: '#f1f5f9', c: '#64748b' };
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${v.bg};color:${v.c}">${esc(s || 'unknown')}</span>`;
  };

  const navBar = (active) => `<nav style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px">
    <a href="/school/volunteer-hours" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'dash' ? '#fff' : P};background:${active === 'dash' ? P : '#eef2ff'};transition:.15s">Dashboard</a>
    <a href="/school/volunteer-hours/opportunities" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'opp' ? '#fff' : P};background:${active === 'opp' ? P : '#eef2ff'};transition:.15s">Opportunities</a>
    <a href="/school/volunteer-hours/log-hours" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'log' ? '#fff' : P};background:${active === 'log' ? P : '#eef2ff'};transition:.15s">Log Hours</a>
    <a href="/school/volunteer-hours/my-hours" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'my' ? '#fff' : P};background:${active === 'my' ? P : '#eef2ff'};transition:.15s">My Hours</a>
    <a href="/school/volunteer-hours/leaderboard" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'lb' ? '#fff' : P};background:${active === 'lb' ? P : '#eef2ff'};transition:.15s">Leaderboard</a>
    <a href="/school/volunteer-hours/certificates" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'cert' ? '#fff' : P};background:${active === 'cert' ? P : '#eef2ff'};transition:.15s">Certificates</a>
    <a href="/school/volunteer-hours/organizations" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'org' ? '#fff' : P};background:${active === 'org' ? P : '#eef2ff'};transition:.15s">Organizations</a>
    <a href="/school/volunteer-hours/reports" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'rpt' ? '#fff' : P};background:${active === 'rpt' ? P : '#eef2ff'};transition:.15s">Reports</a>
    <a href="/school/volunteer-hours/reflection-journal" style="padding:8px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;color:${active === 'ref' ? '#fff' : P};background:${active === 'ref' ? P : '#eef2ff'};transition:.15s">Journal</a>
  </nav>`;

  // ============================================================
  // DATABASE MIGRATION
  // ============================================================
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS volunteer_opportunities (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        organization VARCHAR(255),
        category VARCHAR(100),
        date DATE,
        time VARCHAR(50),
        location VARCHAR(255),
        max_volunteers INTEGER DEFAULT 0,
        hours_offered DECIMAL(5,1) DEFAULT 1,
        status VARCHAR(20) DEFAULT 'open',
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS volunteer_logs (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        opportunity_id INTEGER REFERENCES volunteer_opportunities(id),
        hours_completed DECIMAL(5,1) DEFAULT 0,
        verified_by INTEGER,
        verification_status VARCHAR(20) DEFAULT 'pending',
        reflection TEXT,
        parent_verified BOOLEAN DEFAULT false,
        parent_verified_at TIMESTAMPTZ,
        date_completed DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS volunteer_certificates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        total_hours DECIMAL(6,1) DEFAULT 0,
        semester VARCHAR(50),
        issued_at TIMESTAMPTZ DEFAULT NOW(),
        certificate_url VARCHAR(500),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query('CREATE INDEX IF NOT EXISTS idx_vo_opp_tenant ON volunteer_opportunities(tenant_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_vo_opp_status ON volunteer_opportunities(tenant_id, status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_vo_log_tenant ON volunteer_logs(tenant_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_vo_log_student ON volunteer_logs(tenant_id, student_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_vo_log_status ON volunteer_logs(tenant_id, verification_status)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_vo_cert_tenant ON volunteer_certificates(tenant_id)');
      await pool.query('CREATE INDEX IF NOT EXISTS idx_vo_cert_student ON volunteer_certificates(tenant_id, student_id)');
      console.log('[Mod] volunteer-hours OK');
    } catch (e) { console.warn('[Mod] Warn:', e.message); }
  })();

  const CATEGORIES = ['Community Service', 'Environmental', 'Education/Tutoring', 'Healthcare', 'Animal Welfare', 'Arts & Culture', 'Sports & Recreation', 'Senior Care', 'Food Bank', 'Technology', 'Fundraising', 'Mentorship', 'Religious/Spiritual', 'Civic Engagement', 'Disaster Relief'];

  // ============================================================
  // ROUTE 1: GET /school/volunteer-hours — Dashboard
  // ============================================================
  app.get('/school/volunteer-hours', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sid = user.id;
    const stats = (await pool.query(`SELECT
      (SELECT COUNT(*)::int FROM volunteer_opportunities WHERE tenant_id=$1 AND status='open') as open_opps,
      (SELECT COUNT(*)::int FROM volunteer_logs WHERE tenant_id=$1 AND student_id=$2) as my_logs,
      (SELECT COALESCE(SUM(hours_completed),0)::float FROM volunteer_logs WHERE tenant_id=$1 AND student_id=$2 AND verification_status='verified') as my_verified,
      (SELECT COALESCE(SUM(hours_completed),0)::float FROM volunteer_logs WHERE tenant_id=$1) as school_total,
      (SELECT COUNT(DISTINCT student_id)::int FROM volunteer_logs WHERE tenant_id=$1) as participants`,
      [tid, sid])).rows[0];

    const recent = (await pool.query(
      `SELECT vl.*, vo.title as opp_title, u.name as student_name
       FROM volunteer_logs vl
       LEFT JOIN volunteer_opportunities vo ON vo.id = vl.opportunity_id
       LEFT JOIN users u ON u.id = vl.student_id
       WHERE vl.tenant_id=$1 ORDER BY vl.created_at DESC LIMIT 8`, [tid])).rows;

    const upcoming = (await pool.query(
      `SELECT * FROM volunteer_opportunities WHERE tenant_id=$1 AND status='open' AND date >= CURRENT_DATE ORDER BY date ASC LIMIT 5`, [tid])).rows;

    const recentHtml = recent.map(r => `<tr>
      <td>${esc(r.student_name || 'Unknown')}</td>
      <td>${esc(r.opp_title || 'Independent')}</td>
      <td>${Number(r.hours_completed || 0).toFixed(1)}h</td>
      <td>${statusBadge(r.verification_status)}</td>
      <td>${fmtDate(r.date_completed || r.created_at)}</td>
    </tr>`).join('');

    const upcomingHtml = upcoming.map(u => `<div class="card" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px">
      <div>
        <strong style="color:#1e293b">${esc(u.title)}</strong>
        <div style="font-size:12px;color:${GRAY};margin-top:2px">${esc(u.organization || '')} &middot; ${esc(u.category || '')}</div>
      </div>
      <div style="text-align:right;font-size:12px;color:${GRAY}">
        <div>${fmtDate(u.date)}</div>
        <div>${Number(u.hours_offered || 0).toFixed(1)}h offered</div>
      </div>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">
      ${navBar('dash')}
      <h1 style="font-size:22px;color:#1e293b;margin-bottom:4px">Volunteer Hours</h1>
      <p style="color:${GRAY};font-size:13px;margin-bottom:20px">Track service, build community, earn recognition</p>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:20px">
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:${P}">${stats.open_opps}</div><div style="font-size:12px;color:${GRAY};font-weight:600">Open Opportunities</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#059669">${Number(stats.my_verified).toFixed(1)}</div><div style="font-size:12px;color:${GRAY};font-weight:600">My Verified Hours</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#d97706">${Number(stats.school_total).toFixed(0)}</div><div style="font-size:12px;color:${GRAY};font-weight:600">School Total Hours</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#dc2626">${stats.participants}</div><div style="font-size:12px;color:${GRAY};font-weight:600">Participants</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:15px;color:#1e293b">Upcoming Opportunities</h3>
          ${upcomingHtml || '<p style="color:${GRAY};font-size:13px">No upcoming opportunities</p>'}
        </div>
        <div class="card">
          <h3 style="margin:0 0 12px;font-size:15px;color:#1e293b">Recent Activity</h3>
          <table><thead><tr><th>Student</th><th>Opportunity</th><th>Hours</th><th>Status</th></tr></thead>
          <tbody>${recentHtml || '<tr><td colspan="4" style="color:${GRAY};text-align:center">No recent activity</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Volunteer Hours Dashboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /school/volunteer-hours/opportunities
  // ============================================================
  app.get('/school/volunteer-hours/opportunities', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const cat = req.query.category || '';
    const status = req.query.status || '';
    let where = 'WHERE tenant_id=$1';
    const params = [tid];
    let pi = 2;
    if (cat) { where += ` AND category=$${pi++}`; params.push(cat); }
    if (status) { where += ` AND status=$${pi++}`; params.push(status); }
    where += ' ORDER BY date DESC NULLS LAST, created_at DESC';

    const opps = (await pool.query(`SELECT * FROM volunteer_opportunities ${where}`, params)).rows;
    const catOptions = CATEGORIES.map(c => `<option value="${esc(c)}" ${cat === c ? 'selected' : ''}>${esc(c)}</option>`).join('');

    const rows = opps.map(o => `<tr>
      <td><strong style="color:#1e293b">${esc(o.title)}</strong><div style="font-size:11px;color:${GRAY}">${esc(o.location || '')}</div></td>
      <td>${esc(o.organization || '—')}</td>
      <td>${esc(o.category || '—')}</td>
      <td>${fmtDate(o.date)}</td>
      <td>${Number(o.hours_offered || 0).toFixed(1)}h</td>
      <td>${statusBadge(o.status)}</td>
      <td>
        <a href="/school/volunteer-hours/opportunities/edit/${o.id}" style="color:${P};text-decoration:none;font-size:12px;margin-right:8px">Edit</a>
        ${o.status === 'open' ? `<a href="/school/volunteer-hours/opportunities/close/${o.id}" style="color:#dc2626;text-decoration:none;font-size:12px" onclick="return confirm('Close this opportunity?')">Close</a>` : ''}
      </td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">
      ${navBar('opp')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h1 style="font-size:20px;color:#1e293b">Volunteer Opportunities</h1>
        <a href="/school/volunteer-hours/opportunities/create" class="btn" style="text-decoration:none">+ New Opportunity</a>
      </div>
      <div class="card" style="display:flex;gap:10px;align-items:end;flex-wrap:wrap">
        <div style="flex:1;min-width:160px"><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Category</label>
          <select id="fcat" onchange="location.href='/school/volunteer-hours/opportunities?category='+this.value"><option value="">All Categories</option>${catOptions}</select></div>
        <div style="flex:1;min-width:140px"><label style="font-size:12px;font-weight:600;color:${GRAY};display:block;margin-bottom:4px">Status</label>
          <select id="fst" onchange="location.href='/school/volunteer-hours/opportunities?category='+encodeURIComponent(document.getElementById('fcat').value)+'&status='+this.value">
            <option value="">All Status</option><option value="open" ${status === 'open' ? 'selected' : ''}>Open</option><option value="closed" ${status === 'closed' ? 'selected' : ''}>Closed</option><option value="cancelled" ${status === 'cancelled' ? 'selected' : ''}>Cancelled</option>
          </select></div>
      </div>
      <div class="card"><table><thead><tr><th>Opportunity</th><th>Organization</th><th>Category</th><th>Date</th><th>Hours</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="color:${GRAY};text-align:center;padding:30px">No opportunities found</td></tr>'}</tbody></table></div>
    </div>`;
    res.send(renderPage('Volunteer Opportunities', html, user, req));
  }));

  // ============================================================
  // ROUTE 3: GET /school/volunteer-hours/opportunities/create
  // ============================================================
  app.get('/school/volunteer-hours/opportunities/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user;
    const catOpts = CATEGORIES.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">
      ${navBar('opp')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">Create Opportunity</h1>
      <div class="card">
        <form method="POST" action="/school/volunteer-hours/opportunities/create">
          <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Title *</label><input type="text" name="title" required placeholder="e.g., Beach Cleanup Drive"></div>
          <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3" placeholder="Describe the volunteer opportunity..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Organization</label><input type="text" name="organization" placeholder="Partner org name"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Category</label><select name="category"><option value="">Select...</option>${catOpts}</select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Date</label><input type="date" name="date"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Time</label><input type="text" name="time" placeholder="e.g., 9:00 AM - 12:00 PM"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Location</label><input type="text" name="location" placeholder="Address or venue"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Max Volunteers</label><input type="number" name="max_volunteers" min="0" value="0"></div>
          </div>
          <div style="margin-bottom:16px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Hours Offered</label><input type="number" name="hours_offered" min="0.5" step="0.5" value="1"></div>
          <button type="submit" class="btn" style="width:100%;padding:10px">Create Opportunity</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Create Opportunity', html, user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /school/volunteer-hours/opportunities/create
  // ============================================================
  app.post('/school/volunteer-hours/opportunities/create', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, description, organization, category, date, time, location, max_volunteers, hours_offered } = req.body;
    if (!title || !title.trim()) return res.redirect('/school/volunteer-hours/opportunities/create');
    await pool.query(
      `INSERT INTO volunteer_opportunities (tenant_id, title, description, organization, category, date, time, location, max_volunteers, hours_offered, status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'open',$11)`,
      [tid, title.trim(), description || null, organization || null, category || null, date || null, time || null, location || null, parseInt(max_volunteers) || 0, parseFloat(hours_offered) || 1, user.id]
    );
    audit && audit(user.id, 'volunteer_opp_create', { title: title.trim() });
    res.redirect('/school/volunteer-hours/opportunities');
  }));

  // ============================================================
  // ROUTE 5: GET /school/volunteer-hours/opportunities/edit/:id
  // ============================================================
  app.get('/school/volunteer-hours/opportunities/edit/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const opp = (await pool.query(`SELECT * FROM volunteer_opportunities WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid])).rows[0];
    if (!opp) return res.redirect('/school/volunteer-hours/opportunities');
    const catOpts = CATEGORIES.map(c => `<option value="${esc(c)}" ${opp.category === c ? 'selected' : ''}>${esc(c)}</option>`).join('');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">
      ${navBar('opp')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">Edit Opportunity</h1>
      <div class="card">
        <form method="POST" action="/school/volunteer-hours/opportunities/edit/${opp.id}">
          <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Title *</label><input type="text" name="title" required value="${esc(opp.title)}"></div>
          <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Description</label><textarea name="description" rows="3">${esc(opp.description || '')}</textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Organization</label><input type="text" name="organization" value="${esc(opp.organization || '')}"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Category</label><select name="category"><option value="">Select...</option>${catOpts}</select></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Date</label><input type="date" name="date" value="${opp.date || ''}"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Time</label><input type="text" name="time" value="${esc(opp.time || '')}"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Location</label><input type="text" name="location" value="${esc(opp.location || '')}"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Max Volunteers</label><input type="number" name="max_volunteers" min="0" value="${opp.max_volunteers || 0}"></div>
          </div>
          <div style="margin-bottom:16px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Hours Offered</label><input type="number" name="hours_offered" min="0.5" step="0.5" value="${opp.hours_offered || 1}"></div>
          <button type="submit" class="btn" style="width:100%;padding:10px">Save Changes</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Opportunity', html, user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /school/volunteer-hours/opportunities/edit/:id
  // ============================================================
  app.post('/school/volunteer-hours/opportunities/edit/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { title, description, organization, category, date, time, location, max_volunteers, hours_offered } = req.body;
    await pool.query(
      `UPDATE volunteer_opportunities SET title=$1, description=$2, organization=$3, category=$4, date=$5, time=$6, location=$7, max_volunteers=$8, hours_offered=$9, updated_at=NOW() WHERE id=$10 AND tenant_id=$11`,
      [title.trim(), description || null, organization || null, category || null, date || null, time || null, location || null, parseInt(max_volunteers) || 0, parseFloat(hours_offered) || 1, req.params.id, tid]
    );
    audit && audit(user.id, 'volunteer_opp_edit', { opp_id: req.params.id });
    res.redirect('/school/volunteer-hours/opportunities');
  }));

  // ============================================================
  // ROUTE 7: GET /school/volunteer-hours/opportunities/close/:id
  // ============================================================
  app.get('/school/volunteer-hours/opportunities/close/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    await pool.query(`UPDATE volunteer_opportunities SET status='closed', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status='open'`, [req.params.id, tid]);
    audit && audit(user.id, 'volunteer_opp_close', { opp_id: req.params.id });
    res.redirect('/school/volunteer-hours/opportunities');
  }));

  // ============================================================
  // ROUTE 8: GET /school/volunteer-hours/log-hours
  // ============================================================
  app.get('/school/volunteer-hours/log-hours', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const opps = (await pool.query(`SELECT id, title, hours_offered FROM volunteer_opportunities WHERE tenant_id=$1 AND status='open' ORDER BY date ASC`, [tid])).rows;
    const oppOpts = opps.map(o => `<option value="${o.id}">${esc(o.title)} (${Number(o.hours_offered).toFixed(1)}h)</option>`).join('');
    const html = SKIP + `<div style="max-width:700px;margin:0 auto">
      ${navBar('log')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">Log Volunteer Hours</h1>
      <div class="card">
        <form method="POST" action="/school/volunteer-hours/log-hours">
          <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Opportunity (optional)</label><select name="opportunity_id"><option value="">Independent Service</option>${oppOpts}</select></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:12px">
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Hours Completed *</label><input type="number" name="hours_completed" min="0.5" step="0.5" required value="1"></div>
            <div><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Date Completed</label><input type="date" name="date_completed" value="${new Date().toISOString().split('T')[0]}"></div>
          </div>
          <div style="margin-bottom:12px"><label style="font-size:13px;font-weight:600;color:#374151;display:block;margin-bottom:4px">Reflection / What did you learn?</label><textarea name="reflection" rows="4" placeholder="Describe your experience, what you learned, and how it impacted the community..."></textarea></div>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:12px;margin-bottom:16px">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;color:#15803d;cursor:pointer">
              <input type="checkbox" name="parent_verified" style="width:18px;height:18px;accent-color:#059669">
              Parent/Guardian has verified these hours
            </label>
          </div>
          <button type="submit" class="btn" style="width:100%;padding:10px">Submit Hours</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Log Hours', html, user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /school/volunteer-hours/log-hours
  // ============================================================
  app.post('/school/volunteer-hours/log-hours', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { opportunity_id, hours_completed, date_completed, reflection, parent_verified } = req.body;
    const hrs = parseFloat(hours_completed);
    if (!hrs || hrs < 0.5) return res.redirect('/school/volunteer-hours/log-hours');
    await pool.query(
      `INSERT INTO volunteer_logs (tenant_id, student_id, opportunity_id, hours_completed, reflection, parent_verified, parent_verified_at, date_completed)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [tid, user.id, opportunity_id ? parseInt(opportunity_id) : null, hrs, reflection || null, parent_verified === 'on', parent_verified === 'on' ? new Date() : null, date_completed || null]
    );
    audit && audit(user.id, 'volunteer_log_create', { hours: hrs });
    res.redirect('/school/volunteer-hours/my-hours');
  }));

  // ============================================================
  // ROUTE 10: GET /school/volunteer-hours/verify/:id
  // ============================================================
  app.get('/school/volunteer-hours/verify/:id', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const log = (await pool.query(`SELECT vl.*, vo.title as opp_title, u.name as student_name FROM volunteer_logs vl LEFT JOIN volunteer_opportunities vo ON vo.id = vl.opportunity_id LEFT JOIN users u ON u.id = vl.student_id WHERE vl.id=$1 AND vl.tenant_id=$2`, [req.params.id, tid])).rows[0];
    if (!log) return res.redirect('/school/volunteer-hours');
    const action = req.query.action;
    if (action === 'approve') {
      await pool.query(`UPDATE volunteer_logs SET verification_status='verified', verified_by=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [user.id, req.params.id, tid]);
      audit && audit(user.id, 'volunteer_verify', { log_id: req.params.id, status: 'verified' });
    } else if (action === 'reject') {
      await pool.query(`UPDATE volunteer_logs SET verification_status='rejected', verified_by=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`, [user.id, req.params.id, tid]);
      audit && audit(user.id, 'volunteer_verify', { log_id: req.params.id, status: 'rejected' });
    }
    res.redirect('/school/volunteer-hours/reports');
  }));

  // ============================================================
  // ROUTE 11: GET /school/volunteer-hours/my-hours
  // ============================================================
  app.get('/school/volunteer-hours/my-hours', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sid = user.id;
    const logs = (await pool.query(
      `SELECT vl.*, vo.title as opp_title FROM volunteer_logs vl LEFT JOIN volunteer_opportunities vo ON vo.id = vl.opportunity_id
       WHERE vl.tenant_id=$1 AND vl.student_id=$2 ORDER BY vl.date_completed DESC NULLS LAST, vl.created_at DESC`, [tid, sid])).rows;

    const totalVerified = logs.filter(l => l.verification_status === 'verified').reduce((s, l) => s + Number(l.hours_completed || 0), 0);
    const totalPending = logs.filter(l => l.verification_status === 'pending').reduce((s, l) => s + Number(l.hours_completed || 0), 0);
    const semesterGoal = 40;
    const goalPct = Math.min(Math.round((totalVerified / semesterGoal) * 100), 100);

    const rows = logs.map(l => `<tr>
      <td>${fmtDate(l.date_completed || l.created_at)}</td>
      <td>${esc(l.opp_title || 'Independent')}</td>
      <td style="font-weight:700">${Number(l.hours_completed).toFixed(1)}h</td>
      <td>${statusBadge(l.verification_status)}</td>
      <td>${l.parent_verified ? '<span style="color:#059669;font-weight:600">Yes</span>' : '<span style="color:#9ca3af">No</span>'}</td>
      ${l.reflection ? `<td><button onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display==='none'?'block':'none'" style="background:#eef2ff;color:${P};border:none;padding:4px 8px;border-radius:6px;font-size:11px;cursor:pointer">View</button><div style="display:none;margin-top:6px;font-size:12px;color:#374151;background:#f9fafb;padding:8px;border-radius:6px">${esc(l.reflection)}</div></td>` : '<td>—</td>'}
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">
      ${navBar('my')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">My Volunteer Hours</h1>

      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px;margin-bottom:20px">
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#059669">${totalVerified.toFixed(1)}</div><div style="font-size:12px;color:${GRAY};font-weight:600">Verified Hours</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:#d97706">${totalPending.toFixed(1)}</div><div style="font-size:12px;color:${GRAY};font-weight:600">Pending Hours</div></div>
        <div class="card" style="text-align:center"><div style="font-size:28px;font-weight:800;color:${P}">${goalPct}%</div><div style="font-size:12px;color:${GRAY};font-weight:600">Semester Goal (${semesterGoal}h)</div>
          <div style="height:6px;background:#e5e7eb;border-radius:4px;margin-top:8px;overflow:hidden"><div style="height:100%;width:${goalPct}%;background:${P};border-radius:4px"></div></div>
        </div>
      </div>

      <div class="card"><table><thead><tr><th>Date</th><th>Opportunity</th><th>Hours</th><th>Status</th><th>Parent Verified</th><th>Reflection</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="color:${GRAY};text-align:center;padding:30px">No hours logged yet</td></tr>'}</tbody></table></div>
    </div>`;
    res.send(renderPage('My Hours', html, user, req));
  }));

  // ============================================================
  // ROUTE 12: GET /school/volunteer-hours/leaderboard
  // ============================================================
  app.get('/school/volunteer-hours/leaderboard', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const period = req.query.period || 'all';
    let dateFilter = '';
    const params = [tid];
    if (period === 'month') { dateFilter = " AND vl.date_completed >= date_trunc('month', CURRENT_DATE)"; }
    else if (period === 'semester') { dateFilter = " AND vl.date_completed >= date_trunc('quarter', CURRENT_DATE)"; }
    else if (period === 'year') { dateFilter = " AND vl.date_completed >= date_trunc('year', CURRENT_DATE)"; }

    const leaders = (await pool.query(
      `SELECT u.id, u.name, u.avatar, COALESCE(SUM(vl.hours_completed),0)::float as total_hours, COUNT(vl.id)::int as log_count
       FROM users u LEFT JOIN volunteer_logs vl ON vl.student_id = u.id AND vl.verification_status='verified'${dateFilter}
       WHERE u.tenant_id=$1 GROUP BY u.id, u.name, u.avatar HAVING SUM(vl.hours_completed) > 0 ORDER BY total_hours DESC LIMIT 50`, params)).rows;

    const medals = ['&#x1F947;', '&#x1F948;', '&#x1F949;'];
    const rows = leaders.map((l, i) => {
      const medal = i < 3 ? `<span style="font-size:20px">${medals[i]}</span>` : `<span style="color:${GRAY};font-weight:700;font-size:14px">${i + 1}</span>`;
      const isMe = l.id === user.id;
      return `<tr style="${isMe ? 'background:#eef2ff' : ''}">
        <td style="text-align:center">${medal}</td>
        <td><strong style="color:#1e293b">${esc(l.name || 'Student #' + l.id)}</strong>${isMe ? ' <span style="font-size:11px;background:#c7d2fe;color:${P};padding:2px 6px;border-radius:4px;font-weight:600">YOU</span>' : ''}</td>
        <td style="font-weight:800;color:#059669;font-size:16px">${l.total_hours.toFixed(1)}h</td>
        <td>${l.log_count} entries</td>
      </tr>`;
    }).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">
      ${navBar('lb')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h1 style="font-size:20px;color:#1e293b">Volunteer Leaderboard</h1>
        <div style="display:flex;gap:4px">
          <a href="/school/volunteer-hours/leaderboard?period=all" class="btn" style="padding:6px 12px;font-size:12px;text-decoration:none;${period === 'all' ? '' : 'background:#eef2ff;color:' + P}">All Time</a>
          <a href="/school/volunteer-hours/leaderboard?period=year" class="btn" style="padding:6px 12px;font-size:12px;text-decoration:none;${period === 'year' ? '' : 'background:#eef2ff;color:' + P}">This Year</a>
          <a href="/school/volunteer-hours/leaderboard?period=semester" class="btn" style="padding:6px 12px;font-size:12px;text-decoration:none;${period === 'semester' ? '' : 'background:#eef2ff;color:' + P}">Semester</a>
          <a href="/school/volunteer-hours/leaderboard?period=month" class="btn" style="padding:6px 12px;font-size:12px;text-decoration:none;${period === 'month' ? '' : 'background:#eef2ff;color:' + P}">Month</a>
        </div>
      </div>
      <div class="card"><table><thead><tr><th style="width:60px;text-align:center">Rank</th><th>Student</th><th>Total Hours</th><th>Entries</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="4" style="color:${GRAY};text-align:center;padding:30px">No data yet</td></tr>'}</tbody></table></div>
    </div>`;
    res.send(renderPage('Leaderboard', html, user, req));
  }));

  // ============================================================
  // ROUTE 13: GET /school/volunteer-hours/certificates
  // ============================================================
  app.get('/school/volunteer-hours/certificates', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const certs = (await pool.query(
      `SELECT vc.*, u.name as student_name FROM volunteer_certificates vc JOIN users u ON u.id = vc.student_id WHERE vc.tenant_id=$1 ORDER BY vc.issued_at DESC`, [tid])).rows;

    const rows = certs.map(c => `<tr>
      <td><strong style="color:#1e293b">${esc(c.student_name || 'Student')}</strong></td>
      <td style="font-weight:700">${Number(c.total_hours).toFixed(1)}h</td>
      <td>${esc(c.semester || '—')}</td>
      <td>${fmtDate(c.issued_at)}</td>
      <td>${c.certificate_url ? `<a href="${esc(c.certificate_url)}" target="_blank" style="color:${P};text-decoration:none;font-size:12px">View Certificate</a>` : '<span style="color:#9ca3af;font-size:12px">Pending</span>'}</td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">
      ${navBar('cert')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
        <h1 style="font-size:20px;color:#1e293b">Volunteer Certificates</h1>
        <form method="POST" action="/school/volunteer-hours/certificates/generate" style="display:flex;gap:8px;align-items:end">
          <div><label style="font-size:12px;color:${GRAY};display:block;margin-bottom:2px">Semester</label>
            <select name="semester" style="padding:6px 10px;border:1px solid #d1d5db;border-radius:8px;font-size:13px"><option>Fall 2024</option><option>Spring 2025</option><option>Summer 2025</option><option>Fall 2025</option></select></div>
          <button type="submit" class="btn" style="padding:8px 14px;white-space:nowrap">Generate Certs</button>
        </form>
      </div>
      <div class="card"><table><thead><tr><th>Student</th><th>Total Hours</th><th>Semester</th><th>Issued</th><th>Certificate</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="color:${GRAY};text-align:center;padding:30px">No certificates issued yet</td></tr>'}</tbody></table></div>
    </div>`;
    res.send(renderPage('Certificates', html, user, req));
  }));

  // ============================================================
  // ROUTE 14: POST /school/volunteer-hours/certificates/generate
  // ============================================================
  app.post('/school/volunteer-hours/certificates/generate', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const semester = req.body.semester || 'Unknown';
    const qualified = (await pool.query(
      `SELECT student_id, SUM(hours_completed)::float as total FROM volunteer_logs
       WHERE tenant_id=$1 AND verification_status='verified' GROUP BY student_id HAVING SUM(hours_completed) >= 20`, [tid])).rows;
    for (const q of qualified) {
      const exists = (await pool.query(`SELECT id FROM volunteer_certificates WHERE tenant_id=$1 AND student_id=$2 AND semester=$3`, [tid, q.student_id, semester])).rows[0];
      if (!exists) {
        await pool.query(`INSERT INTO volunteer_certificates (tenant_id, student_id, total_hours, semester, certificate_url) VALUES ($1,$2,$3,$4,$5)`,
          [tid, q.student_id, q.total, semester, `/school/volunteer-hours/certificates/view/${q.student_id}`]);
      }
    }
    audit && audit(user.id, 'volunteer_certs_generate', { semester, count: qualified.length });
    res.redirect('/school/volunteer-hours/certificates');
  }));

  // ============================================================
  // ROUTE 15: GET /school/volunteer-hours/certificates/view/:sid
  // ============================================================
  app.get('/school/volunteer-hours/certificates/view/:sid', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const cert = (await pool.query(
      `SELECT vc.*, u.name as student_name FROM volunteer_certificates vc JOIN users u ON u.id = vc.student_id WHERE vc.tenant_id=$1 AND vc.student_id=$2 ORDER BY vc.issued_at DESC LIMIT 1`,
      [tid, req.params.sid])).rows[0];
    if (!cert) return res.redirect('/school/volunteer-hours/certificates');
    const html = `<div style="display:flex;align-items:center;justify-content:center;min-height:100vh;background:#f3f4f6;font-family:Georgia,serif">
      <div style="background:#fff;border:3px solid #d4af37;border-radius:16px;padding:60px 80px;text-align:center;max-width:700px;box-shadow:0 8px 30px rgba(0,0,0,.12)">
        <div style="font-size:12px;color:#9ca3af;letter-spacing:4px;text-transform:uppercase;margin-bottom:8px">Certificate of Volunteer Service</div>
        <div style="font-size:14px;color:#d4af37;margin-bottom:24px">&#9733; &#9733; &#9733;</div>
        <div style="font-size:14px;color:#6b7280">This is to certify that</div>
        <div style="font-size:32px;font-weight:bold;color:#1e293b;margin:12px 0">${esc(cert.student_name)}</div>
        <div style="font-size:14px;color:#6b7280">has successfully completed</div>
        <div style="font-size:42px;font-weight:bold;color:#4f46e5;margin:12px 0">${Number(cert.total_hours).toFixed(1)}</div>
        <div style="font-size:14px;color:#6b7280">hours of verified community volunteer service</div>
        <div style="font-size:13px;color:#9ca3af;margin-top:8px">${esc(cert.semester)}</div>
        <div style="margin-top:32px;font-size:13px;color:#6b7280">Issued on ${fmtDate(cert.issued_at)}</div>
        <div style="margin-top:24px;border-top:1px solid #e5e7eb;padding-top:16px;font-size:11px;color:#9ca3af">School Volunteer Service Program</div>
      </div>
    </div>`;
    res.send(html);
  }));

  // ============================================================
  // ROUTE 16: GET /school/volunteer-hours/organizations
  // ============================================================
  app.get('/school/volunteer-hours/organizations', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const orgs = (await pool.query(
      `SELECT organization, COUNT(*)::int as opp_count, COALESCE(SUM(hours_offered),0)::float as total_offered,
              COUNT(vl.id)::int as log_count, COALESCE(SUM(vl.hours_completed),0)::float as hours_completed
       FROM volunteer_opportunities vo
       LEFT JOIN volunteer_logs vl ON vl.opportunity_id = vo.id AND vl.verification_status='verified'
       WHERE vo.tenant_id=$1 AND vo.organization IS NOT NULL AND vo.organization != ''
       GROUP BY organization ORDER BY opp_count DESC`, [tid])).rows;

    const rows = orgs.map(o => `<tr>
      <td><strong style="color:#1e293b">${esc(o.organization)}</strong></td>
      <td>${o.opp_count}</td>
      <td>${Number(o.total_offered).toFixed(1)}h</td>
      <td>${o.log_count}</td>
      <td style="color:#059669;font-weight:700">${Number(o.hours_completed).toFixed(1)}h</td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:900px;margin:0 auto">
      ${navBar('org')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">Partner Organizations</h1>
      <div class="card"><table><thead><tr><th>Organization</th><th>Opportunities</th><th>Hours Offered</th><th>Logs</th><th>Hours Completed</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="5" style="color:${GRAY};text-align:center;padding:30px">No organizations yet</td></tr>'}</tbody></table></div>
    </div>`;
    res.send(renderPage('Organizations', html, user, req));
  }));

  // ============================================================
  // ROUTE 17: GET /school/volunteer-hours/reports
  // ============================================================
  app.get('/school/volunteer-hours/reports', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;

    const catBreakdown = (await pool.query(
      `SELECT vo.category, COUNT(vl.id)::int as logs, COALESCE(SUM(vl.hours_completed),0)::float as hours
       FROM volunteer_logs vl JOIN volunteer_opportunities vo ON vo.id = vl.opportunity_id
       WHERE vl.tenant_id=$1 AND vl.verification_status='verified' AND vo.category IS NOT NULL
       GROUP BY vo.category ORDER BY hours DESC`, [tid])).rows;

    const pendingLogs = (await pool.query(
      `SELECT vl.*, vo.title as opp_title, u.name as student_name FROM volunteer_logs vl
       LEFT JOIN volunteer_opportunities vo ON vo.id = vl.opportunity_id
       LEFT JOIN users u ON u.id = vl.student_id
       WHERE vl.tenant_id=$1 AND vl.verification_status='pending' ORDER BY vl.created_at DESC`, [tid])).rows;

    const maxHrs = catBreakdown.length > 0 ? Math.max(...catBreakdown.map(c => c.hours)) : 1;
    const barHtml = catBreakdown.map(c => {
      const pct = Math.round((c.hours / maxHrs) * 100);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
        <div style="width:140px;font-size:12px;font-weight:600;color:#374151;text-align:right;flex-shrink:0">${esc(c.category)}</div>
        <div style="flex:1;height:22px;background:#f3f4f6;border-radius:6px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${P};border-radius:6px;display:flex;align-items:center;justify-content:flex-end;padding-right:8px"><span style="font-size:11px;color:#fff;font-weight:700">${c.hours.toFixed(1)}h</span></div></div>
      </div>`;
    }).join('');

    const pendingRows = pendingLogs.map(l => `<tr>
      <td>${esc(l.student_name || 'Unknown')}</td>
      <td>${esc(l.opp_title || 'Independent')}</td>
      <td>${Number(l.hours_completed).toFixed(1)}h</td>
      <td>${fmtDate(l.date_completed || l.created_at)}</td>
      <td style="display:flex;gap:4px">
        <a href="/school/volunteer-hours/verify/${l.id}?action=approve" class="btn" style="padding:4px 10px;font-size:11px;background:#059669;text-decoration:none">Approve</a>
        <a href="/school/volunteer-hours/verify/${l.id}?action=reject" class="btn" style="padding:4px 10px;font-size:11px;background:#dc2626;text-decoration:none">Reject</a>
      </td>
    </tr>`).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">
      ${navBar('rpt')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">Reports & Verification</h1>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px">
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Hours by Category</h3>
          ${barHtml || '<p style="color:${GRAY};font-size:13px">No category data yet</p>'}
        </div>
        <div class="card">
          <h3 style="margin:0 0 14px;font-size:15px;color:#1e293b">Pending Verification (${pendingLogs.length})</h3>
          <table><thead><tr><th>Student</th><th>Opportunity</th><th>Hours</th><th>Date</th><th>Actions</th></tr></thead>
          <tbody>${pendingRows || '<tr><td colspan="5" style="color:${GRAY};text-align:center;padding:20px">All caught up!</td></tr>'}</tbody></table>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Reports', html, user, req));
  }));

  // ============================================================
  // ROUTE 18: GET /school/volunteer-hours/reflection-journal
  // ============================================================
  app.get('/school/volunteer-hours/reflection-journal', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sid = user.id;
    const entries = (await pool.query(
      `SELECT vl.*, vo.title as opp_title FROM volunteer_logs vl
       LEFT JOIN volunteer_opportunities vo ON vo.id = vl.opportunity_id
       WHERE vl.tenant_id=$1 AND vl.student_id=$2 AND vl.reflection IS NOT NULL AND vl.reflection != ''
       ORDER BY vl.date_completed DESC NULLS LAST, vl.created_at DESC`, [tid, sid])).rows;

    const cards = entries.map(e => `<div class="card">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;flex-wrap:wrap;gap:6px">
        <strong style="color:#1e293b">${esc(e.opp_title || 'Independent Service')}</strong>
        <div style="display:flex;gap:6px;align-items:center">
          <span style="background:#eef2ff;color:${P};padding:3px 8px;border-radius:12px;font-size:11px;font-weight:600">${Number(e.hours_completed).toFixed(1)}h</span>
          <span style="font-size:11px;color:${GRAY}">${fmtDate(e.date_completed || e.created_at)}</span>
        </div>
      </div>
      <p style="margin:0;font-size:13px;color:#374151;line-height:1.6">${esc(e.reflection)}</p>
    </div>`).join('');

    const html = SKIP + `<div style="max-width:800px;margin:0 auto">
      ${navBar('ref')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:4px">Reflection Journal</h1>
      <p style="color:${GRAY};font-size:13px;margin-bottom:20px">Service learning reflections from your volunteer experiences</p>

      <div class="card" style="background:linear-gradient(135deg,#eef2ff,#faf5ff);border:1px solid #c7d2fe;margin-bottom:20px">
        <h3 style="margin:0 0 8px;color:${P};font-size:15px">Why Reflect?</h3>
        <p style="margin:0;font-size:13px;color:#4b5563;line-height:1.6">Reflection helps you process your volunteer experiences, connect service to academic learning, develop critical thinking, and deepen your understanding of community needs. Each reflection contributes to your service learning portfolio.</p>
      </div>

      ${cards || '<div class="card" style="text-align:center;padding:40px"><p style="color:${GRAY};font-size:14px">No reflections yet. Log volunteer hours with a reflection to see them here.</p><a href="/school/volunteer-hours/log-hours" class="btn" style="display:inline-block;margin-top:12px;text-decoration:none">Log Hours</a></div>'}
    </div>`;
    res.send(renderPage('Reflection Journal', html, user, req));
  }));

  // ============================================================
  // ROUTE 19: GET /school/volunteer-hours/goals
  // ============================================================
  app.get('/school/volunteer-hours/goals', requireAuth, requireNotBanned, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sid = user.id;
    const myVerified = (await pool.query(
      `SELECT COALESCE(SUM(hours_completed),0)::float as total FROM volunteer_logs WHERE tenant_id=$1 AND student_id=$2 AND verification_status='verified'`, [tid, sid])).rows[0].total;
    const myTotal = (await pool.query(
      `SELECT COALESCE(SUM(hours_completed),0)::float as total FROM volunteer_logs WHERE tenant_id=$1 AND student_id=$2`, [tid, sid])).rows[0].total;
    const schoolTotal = (await pool.query(
      `SELECT COALESCE(SUM(hours_completed),0)::float as total FROM volunteer_logs WHERE tenant_id=$1`, [tid])).rows[0].total;
    const goals = [
      { label: 'Bronze Award', target: 20, icon: '&#x1F948;', color: '#cd7f32' },
      { label: 'Silver Award', target: 50, icon: '&#x1F948;', color: '#94a3b8' },
      { label: 'Gold Award', target: 100, icon: '&#x1F947;', color: '#eab308' },
      { label: 'Platinum Award', target: 200, icon: '&#x1F451;', color: '#06b6d4' },
      { label: 'President\'s Award', target: 500, icon: '&#x1F3C6;', color: '#dc2626' }
    ];

    const goalCards = goals.map(g => {
      const pct = Math.min(Math.round((myVerified / g.target) * 100), 100);
      const achieved = myVerified >= g.target;
      return `<div class="card" style="text-align:center;border:2px solid ${achieved ? g.color : '#e5e7eb'};${achieved ? 'background:' + g.color + '0a' : ''}">
        <div style="font-size:28px">${g.icon}</div>
        <div style="font-size:14px;font-weight:700;color:#1e293b;margin-top:4px">${g.label}</div>
        <div style="font-size:24px;font-weight:800;color:${g.color};margin:8px 0">${g.target}h</div>
        <div style="height:8px;background:#e5e7eb;border-radius:6px;overflow:hidden;margin-bottom:4px"><div style="height:100%;width:${pct}%;background:${g.color};border-radius:6px"></div></div>
        <div style="font-size:11px;color:${GRAY}">${pct}% complete</div>
        ${achieved ? '<div style="margin-top:6px;font-size:12px;color:' + g.color + ';font-weight:700">&#x2713; Achieved!</div>' : ''}
      </div>`;
    }).join('');

    const html = SKIP + `<div style="max-width:1100px;margin:0 auto">
      ${navBar('dash')}
      <h1 style="font-size:20px;color:#1e293b;margin-bottom:16px">Semester Goals & Awards</h1>

      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:14px;margin-bottom:20px">
        <div class="card" style="text-align:center"><div style="font-size:32px;font-weight:800;color:#059669">${myVerified.toFixed(1)}h</div><div style="font-size:12px;color:${GRAY}">Your Verified Hours</div></div>
        <div class="card" style="text-align:center"><div style="font-size:32px;font-weight:800;color:${P}">${myTotal.toFixed(1)}h</div><div style="font-size:12px;color:${GRAY}">Total Logged (incl. pending)</div></div>
        <div class="card" style="text-align:center"><div style="font-size:32px;font-weight:800;color:#d97706">${schoolTotal.toFixed(0)}h</div><div style="font-size:12px;color:${GRAY}">School-Wide Total</div></div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px">
        ${goalCards}
      </div>
    </div>`;
    res.send(renderPage('Goals & Awards', html, user, req));
  }));

  // ============================================================
  // ROUTE 20: GET /school/volunteer-hours/parent-verify/:id
  // ============================================================
  app.get('/school/volunteer-hours/parent-verify/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    await pool.query(`UPDATE volunteer_logs SET parent_verified=true, parent_verified_at=NOW() WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    audit && audit(user.id, 'volunteer_parent_verify', { log_id: req.params.id });
    res.redirect('/school/volunteer-hours/my-hours');
  }));

  console.log('[Mod] volunteer-hours routes loaded');
};
