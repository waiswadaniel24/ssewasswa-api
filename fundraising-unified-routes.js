/**
 * Fundraising Unified — Consolidates all fundraising into one module
 * Comfort Zone SaaS Platform
 */
module.exports = function(app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t,c,u) => c);
  const ah = (opts && opts.ah) || (fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(e => res.status(500).send('Error: '+e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  /* ── DB Migration ── */
  async function migrate() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fr_campaigns (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        title VARCHAR(500) NOT NULL,
        description TEXT,
        goal_amount NUMERIC(15,2) DEFAULT 0,
        currency VARCHAR(3) DEFAULT 'USD',
        raised_amount NUMERIC(15,2) DEFAULT 0,
        donor_count INTEGER DEFAULT 0,
        status VARCHAR(20) DEFAULT 'draft',
        start_date DATE,
        end_date DATE,
        cover_url VARCHAR(500),
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_frc_tenant ON fr_campaigns(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_frc_status ON fr_campaigns(tenant_id, status);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fr_donations (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        campaign_id INTEGER REFERENCES fr_campaigns(id) ON DELETE SET NULL,
        donor_id INTEGER DEFAULT NULL,
        amount NUMERIC(15,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        method VARCHAR(50) DEFAULT 'manual',
        status VARCHAR(20) DEFAULT 'completed',
        transaction_ref VARCHAR(255),
        donated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_frd_tenant ON fr_donations(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_frd_campaign ON fr_donations(tenant_id, campaign_id);
      CREATE INDEX IF NOT EXISTS idx_frd_donor ON fr_donations(tenant_id, donor_id);
      CREATE INDEX IF NOT EXISTS idx_frd_date ON fr_donations(tenant_id, donated_at);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fr_donors (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255),
        phone VARCHAR(50),
        total_donated NUMERIC(15,2) DEFAULT 0,
        donation_count INTEGER DEFAULT 0,
        first_donation DATE,
        last_donation DATE
      );
      CREATE INDEX IF NOT EXISTS idx_frdo_tenant ON fr_donors(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_frdo_email ON fr_donors(tenant_id, email);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fr_recurring (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        donor_id INTEGER DEFAULT NULL,
        campaign_id INTEGER REFERENCES fr_campaigns(id) ON DELETE SET NULL,
        amount NUMERIC(15,2) NOT NULL,
        currency VARCHAR(3) DEFAULT 'USD',
        frequency VARCHAR(20) DEFAULT 'monthly',
        next_date DATE,
        status VARCHAR(20) DEFAULT 'active',
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_frr_tenant ON fr_recurring(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_frr_status ON fr_recurring(tenant_id, status);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS fr_goals (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        name VARCHAR(255) NOT NULL,
        target_amount NUMERIC(15,2) NOT NULL,
        current_amount NUMERIC(15,2) DEFAULT 0,
        start_date DATE,
        target_date DATE,
        created_at TIMESTAMP DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_frg_tenant ON fr_goals(tenant_id);
    `);
  }
  migrate().then(() => console.log('[fundraising-unified] migration done')).catch(e => console.error('[fundraising-unified] migration error:', e));

  /* ── Helpers ── */
  function fmtMoney(n, currency) {
    currency = currency || 'USD';
    const symbols = { USD: '$', EUR: '€', GBP: '£', UGX: 'USh', KES: 'KSh', TZS: 'TSh', RWF: 'RFw', NGN: '₦' };
    return (symbols[currency] || currency + ' ') + parseFloat(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function pctBar(current, goal) {
    const p = goal > 0 ? Math.min(100, (current / goal * 100)) : 0;
    return `<div style="background:#e9ecef;border-radius:8px;height:24px;overflow:hidden;margin-top:6px">
      <div style="background:linear-gradient(90deg,#43e97b,#38f9d7);height:100%;width:${p}%;border-radius:8px;transition:width .3s"></div>
    </div><div style="font-size:13px;color:#666;margin-top:4px">${p.toFixed(1)}% of goal</div>`;
  }

  function fundPage(title, body, req) {
    const html = `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} — Comfort Zone</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f0f2f5;color:#1a1a2e}
.topbar{background:linear-gradient(135deg,#43e97b 0%,#38f9d7 100%);color:#fff;padding:16px 24px;display:flex;align-items:center;justify-content:space-between}
.topbar h1{font-size:20px;font-weight:700;color:#1a1a2e}
.topbar a{color:#2d6a4f;text-decoration:none;font-size:14px;font-weight:500}
.container{max-width:1200px;margin:24px auto;padding:0 16px}
.stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
.stat-card h3{font-size:12px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
.stat-card .val{font-size:28px;font-weight:700;color:#2d6a4f}
.card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.08);margin-bottom:16px}
.card h2{font-size:18px;margin-bottom:12px;color:#333}
table{width:100%;border-collapse:collapse}
th,td{text-align:left;padding:10px 12px;border-bottom:1px solid #eee;font-size:14px}
th{background:#f8f9fa;color:#555;font-weight:600;text-transform:uppercase;font-size:11px;letter-spacing:.3px}
.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}
.badge-active,.badge-completed{background:#d4edda;color:#155724}
.badge-draft{background:#fff3cd;color:#856404}
.badge-paused{background:#f8d7da;color:#721c24}
.btn{display:inline-block;padding:8px 18px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;cursor:pointer;border:none;transition:all .2s}
.btn-primary{background:#2d6a4f;color:#fff}.btn-primary:hover{background:#1b4332}
.btn-success{background:#43e97b;color:#1a1a2e}.btn-success:hover{background:#38f9d7}
.btn-danger{background:#dc3545;color:#fff}.btn-danger:hover{background:#c82333}
.btn-outline{background:#fff;border:1px solid #ddd;color:#333}.btn-outline:hover{background:#f8f9fa}
.btn-sm{padding:5px 12px;font-size:12px}
nav.sub{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
nav.sub a{padding:8px 16px;background:#fff;border-radius:8px;text-decoration:none;color:#333;font-size:14px;font-weight:500;transition:all .2s;border:1px solid #e9ecef}
nav.sub a:hover,nav.sub a.active{background:#2d6a4f;color:#fff;border-color:#2d6a4f}
.empty{text-align:center;padding:40px;color:#999}
.form-group{margin-bottom:16px}
.form-group label{display:block;font-weight:600;margin-bottom:4px;font-size:14px;color:#444}
.form-group input,.form-group select,.form-group textarea{width:100%;padding:10px 12px;border:1px solid #ddd;border-radius:8px;font-size:14px}
.campaign-card{border:1px solid #e9ecef;border-radius:12px;overflow:hidden;transition:all .2s}
.campaign-card:hover{box-shadow:0 4px 12px rgba(0,0,0,.1)}
.campaign-card .cover{height:120px;background:linear-gradient(135deg,#43e97b,#38f9d7);display:flex;align-items:center;justify-content:center;color:#fff;font-size:24px}
.campaign-card .info{padding:16px}
.campaign-card .info h3{margin-bottom:6px}
.campaign-card .info .desc{font-size:13px;color:#666;margin-bottom:8px}
.grid-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px}
</style></head>
<body>
<div class="topbar"><h1>💚 Fundraising</h1><a href="/">← Dashboard</a></div>
<div class="container">
<nav class="sub">
<a href="/fundraising" class="active">Overview</a>
<a href="/fundraising/campaigns">Campaigns</a>
<a href="/fundraising/donors">Donors</a>
<a href="/fundraising/reports">Reports</a>
<a href="/fundraising/recurring">Recurring</a>
<a href="/fundraising/goals">Goals</a>
</nav>
${body}
</div></body></html>`;
    return renderPage('fundraising', html, req);
  }

  /* ── GET /fundraising ── */
  app.get('/fundraising', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [totals] = await pool.query(
      'SELECT COUNT(*) AS campaigns, SUM(raised_amount) AS total_raised, SUM(goal_amount) AS total_goal, SUM(donor_count) AS total_donors FROM fr_campaigns WHERE tenant_id=?', [tid]);
    const [monthDonations] = await pool.query(
      'SELECT COUNT(*) AS count, SUM(amount) AS total FROM fr_donations WHERE tenant_id=? AND donated_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY) AND status=?', [tid, 'completed']);
    const [activeCampaigns] = await pool.query(
      'SELECT * FROM fr_campaigns WHERE tenant_id=? AND status=? ORDER BY raised_amount DESC LIMIT 6', [tid, 'active']);
    const [recentDonations] = await pool.query(
      'SELECT d.*, dn.name AS donor_name FROM fr_donations d LEFT JOIN fr_donors dn ON d.donor_id = dn.id WHERE d.tenant_id=? ORDER BY d.donated_at DESC LIMIT 8', [tid]);
    const [goals] = await pool.query('SELECT * FROM fr_goals WHERE tenant_id=? ORDER BY target_date ASC LIMIT 3', [tid]);

    res.send(fundPage('Fundraising Dashboard', `
<div class="stats">
  <div class="stat-card"><h3>Total Raised</h3><div class="val">${fmtMoney(totals[0].total_raised)}</div></div>
  <div class="stat-card"><h3>Total Goal</h3><div class="val">${fmtMoney(totals[0].total_goal)}</div></div>
  <div class="stat-card"><h3>Donors</h3><div class="val">${(totals[0].total_donors || 0).toLocaleString()}</div></div>
  <div class="stat-card"><h3>This Month</h3><div class="val">${fmtMoney(monthDonations[0].total)}</div><div style="font-size:13px;color:#888;margin-top:4px">${monthDonations[0].count} donations</div></div>
</div>
<div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap">
  <a href="/fundraising/campaigns" class="btn btn-primary">📋 All Campaigns</a>
  <a href="/fundraising/donate" class="btn btn-success">💳 Record Donation</a>
  <a href="/fundraising/reports" class="btn btn-outline">📊 Reports</a>
</div>

${goals.length ? `<div class="card"><h2>Goals Progress</h2>
${goals.map(g => `<div style="margin-bottom:16px">
  <div style="display:flex;justify-content:space-between;align-items:center">
    <strong>${esc(g.name)}</strong>
    <span>${fmtMoney(g.current_amount)} / ${fmtMoney(g.target_amount)}</span>
  </div>
  ${pctBar(g.current_amount, g.target_amount)}
</div>`).join('')}</div>` : ''}

<div class="card"><h2>Active Campaigns</h2>
<div class="grid-cards">
${activeCampaigns.map(c => `<div class="campaign-card">
  <div class="cover">💰</div>
  <div class="info">
    <h3>${esc(c.title)}</h3>
    <div class="desc">${esc((c.description||'').substring(0, 100))}</div>
    <div style="font-size:20px;font-weight:700;color:#2d6a4f">${fmtMoney(c.raised_amount, c.currency)} <span style="font-size:14px;color:#888">of ${fmtMoney(c.goal_amount, c.currency)}</span></div>
    ${pctBar(c.raised_amount, c.goal_amount)}
    <div style="font-size:13px;color:#888;margin-top:8px">${c.donor_count || 0} donors</div>
    <a href="/fundraising/campaigns/${c.id}" class="btn btn-sm btn-outline" style="margin-top:8px">View Details</a>
  </div>
</div>`).join('')}
${activeCampaigns.length === 0 ? '<div class="empty" style="grid-column:1/-1">No active campaigns</div>' : ''}
</div></div>

<div class="card"><h2>Recent Donations</h2>
<table><thead><tr><th>Donor</th><th>Campaign</th><th>Amount</th><th>Method</th><th>Date</th></tr></thead><tbody>
${recentDonations.map(d => `<tr><td>${esc(d.donor_name || 'Anonymous')}</td><td>${d.campaign_id ? '#' + d.campaign_id : '—'}</td><td><strong>${fmtMoney(d.amount, d.currency)}</strong></td><td>${esc(d.method)}</td><td>${new Date(d.donated_at).toLocaleDateString()}</td></tr>`).join('')}
</tbody></table></div>`, req));
  }));

  /* ── GET /fundraising/campaigns ── */
  app.get('/fundraising/campaigns', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const status = req.query.status || 'all';
    const [campaigns] = status === 'all'
      ? await pool.query('SELECT * FROM fr_campaigns WHERE tenant_id=? ORDER BY created_at DESC', [tid])
      : await pool.query('SELECT * FROM fr_campaigns WHERE tenant_id=? AND status=? ORDER BY created_at DESC', [tid, status]);

    const html = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:8px">
  <div style="display:flex;gap:8px;flex-wrap:wrap">
    <a href="/fundraising/campaigns?status=all" class="btn btn-sm ${status === 'all' ? 'btn-primary' : 'btn-outline'}">All</a>
    <a href="/fundraising/campaigns?status=active" class="btn btn-sm ${status === 'active' ? 'btn-primary' : 'btn-outline'}">Active</a>
    <a href="/fundraising/campaigns?status=draft" class="btn btn-sm ${status === 'draft' ? 'btn-primary' : 'btn-outline'}">Draft</a>
    <a href="/fundraising/campaigns?status=completed" class="btn btn-sm ${status === 'completed' ? 'btn-primary' : 'btn-outline'}">Completed</a>
    <a href="/fundraising/campaigns?status=paused" class="btn btn-sm ${status === 'paused' ? 'btn-primary' : 'btn-outline'}">Paused</a>
  </div>
  <button onclick="document.getElementById('addCamp').style.display='block'" class="btn btn-success">+ New Campaign</button>
</div>
<div id="addCamp" class="card" style="display:none;margin-bottom:16px">
  <h2>Create Campaign</h2>
  <form method="POST" action="/fundraising/campaigns">
    <div class="form-group"><label>Title</label><input name="title" required placeholder="Campaign name"></div>
    <div class="form-group"><label>Description</label><textarea name="description" rows="3"></textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label>Goal Amount</label><input name="goal_amount" type="number" step="0.01" value="10000"></div>
      <div class="form-group"><label>Currency</label><select name="currency"><option>USD</option><option>EUR</option><option>GBP</option><option>UGX</option><option>KES</option><option>TZS</option></select></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label>Start Date</label><input name="start_date" type="date"></div>
      <div class="form-group"><label>End Date</label><input name="end_date" type="date"></div>
    </div>
    <button type="submit" class="btn btn-primary">Create Campaign</button>
  </form>
</div>
<div class="card"><table><thead><tr><th>ID</th><th>Title</th><th>Goal</th><th>Raised</th><th>Donors</th><th>Status</th><th>Actions</th></tr></thead><tbody>
${campaigns.map(c => `<tr>
<td>#${c.id}</td><td><a href="/fundraising/campaigns/${c.id}" style="font-weight:600;color:#2d6a4f;text-decoration:none">${esc(c.title)}</a></td>
<td>${fmtMoney(c.goal_amount, c.currency)}</td><td><strong>${fmtMoney(c.raised_amount, c.currency)}</strong></td>
<td>${c.donor_count || 0}</td>
<td><span class="badge badge-${c.status}">${esc(c.status)}</span></td>
<td><a href="/fundraising/campaigns/${c.id}" class="btn btn-sm btn-outline">View</a></td>
</tr>`).join('')}
${campaigns.length === 0 ? '<tr><td colspan="7" class="empty">No campaigns found</td></tr>' : ''}
</tbody></table></div>`;
    res.send(fundPage('Campaigns', html, req));
  }));

  /* ── POST /fundraising/campaigns ── */
  app.post('/fundraising/campaigns', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query(
      `INSERT INTO fr_campaigns (tenant_id, title, description, goal_amount, currency, start_date, end_date) VALUES (?,?,?,?,?,?,?)`,
      [tid, req.body.title, req.body.description || '', parseFloat(req.body.goal_amount) || 0, req.body.currency || 'USD', req.body.start_date || null, req.body.end_date || null]);
    audit({ actor: req.session.user.id, action: 'fundraising:campaign-create', tid, meta: { title: req.body.title } });
    res.redirect('/fundraising/campaigns?msg=Campaign+created');
  }));

  /* ── GET /fundraising/campaigns/:id ── */
  app.get('/fundraising/campaigns/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [campaigns] = await pool.query('SELECT * FROM fr_campaigns WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!campaigns.length) return res.redirect('/fundraising/campaigns');
    const c = campaigns[0];
    const [donations] = await pool.query(
      'SELECT d.*, dn.name AS donor_name FROM fr_donations d LEFT JOIN fr_donors dn ON d.donor_id = dn.id WHERE d.tenant_id=? AND d.campaign_id=? ORDER BY d.donated_at DESC LIMIT 50', [tid, c.id]);

    const html = `
<div class="card" style="margin-bottom:16px">
  <div style="display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px">
    <div>
      <h2 style="margin-bottom:4px">${esc(c.title)}</h2>
      <span class="badge badge-${c.status}" style="margin-bottom:8px">${esc(c.status)}</span>
      <p style="color:#666;margin-top:8px">${esc(c.description || 'No description')}</p>
    </div>
    <div style="text-align:right">
      <div style="font-size:32px;font-weight:700;color:#2d6a4f">${fmtMoney(c.raised_amount, c.currency)}</div>
      <div style="font-size:14px;color:#888">of ${fmtMoney(c.goal_amount, c.currency)}</div>
    </div>
  </div>
  ${pctBar(c.raised_amount, c.goal_amount)}
  <div style="display:flex;gap:24px;margin-top:16px;font-size:14px;color:#666">
    <span>👥 ${c.donor_count || 0} donors</span>
    <span>📅 ${c.start_date || 'No start date'} — ${c.end_date || 'No end date'}</span>
    <span>💵 ${esc(c.currency)}</span>
  </div>
</div>
<div style="display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap">
  <a href="/fundraising/donate?campaign_id=${c.id}" class="btn btn-success">💳 Record Donation</a>
  <button onclick="document.getElementById('editCamp').style.display='block'" class="btn btn-outline">✏️ Edit Campaign</button>
</div>
<div id="editCamp" class="card" style="display:none;margin-bottom:16px">
  <h2>Edit Campaign</h2>
  <form method="POST" action="/fundraising/campaigns/${c.id}">
    <input type="hidden" name="_method" value="PUT">
    <div class="form-group"><label>Title</label><input name="title" value="${esc(c.title)}" required></div>
    <div class="form-group"><label>Description</label><textarea name="description" rows="3">${esc(c.description||'')}</textarea></div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div class="form-group"><label>Goal Amount</label><input name="goal_amount" type="number" step="0.01" value="${c.goal_amount}"></div>
      <div class="form-group"><label>Status</label><select name="status"><option ${c.status==='draft'?'selected':''}>draft</option><option ${c.status==='active'?'selected':''}>active</option><option ${c.status==='paused'?'selected':''}>paused</option><option ${c.status==='completed'?'selected':''}>completed</option></select></div>
      <div class="form-group"><label>Currency</label><select name="currency"><option ${c.currency==='USD'?'selected':''}>USD</option><option ${c.currency==='EUR'?'selected':''}>EUR</option><option ${c.currency==='GBP'?'selected':''}>GBP</option><option ${c.currency==='UGX'?'selected':''}>UGX</option><option ${c.currency==='KES'?'selected':''}>KES</option></select></div>
    </div>
    <button type="submit" class="btn btn-primary">Save Changes</button>
  </form>
</div>
<div class="card"><h2>Donations (${donations.length})</h2>
<table><thead><tr><th>ID</th><th>Donor</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead><tbody>
${donations.map(d => `<tr>
<td>#${d.id}</td><td>${esc(d.donor_name || 'Anonymous')}</td>
<td><strong>${fmtMoney(d.amount, d.currency)}</strong></td>
<td>${esc(d.method)}</td><td><span class="badge badge-${d.status === 'completed' ? 'completed' : 'paused'}">${esc(d.status)}</span></td>
<td>${new Date(d.donated_at).toLocaleDateString()}</td>
</tr>`).join('')}
${donations.length === 0 ? '<tr><td colspan="6" class="empty">No donations yet</td></tr>' : ''}
</tbody></table></div>`;
    res.send(fundPage('Campaign: ' + c.title, html, req));
  }));

  /* ── PUT /fundraising/campaigns/:id ── */
  app.put('/fundraising/campaigns/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [result] = await pool.query(
      `UPDATE fr_campaigns SET title=?, description=?, goal_amount=?, currency=?, status=?, start_date=?, end_date=? WHERE id=? AND tenant_id=?`,
      [req.body.title, req.body.description, parseFloat(req.body.goal_amount) || 0, req.body.currency, req.body.status, req.body.start_date, req.body.end_date, req.params.id, tid]);
    res.json({ ok: result.affectedRows > 0 });
  }));

  // POST fallback for HTML form
  app.post('/fundraising/campaigns/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query(
      `UPDATE fr_campaigns SET title=?, description=?, goal_amount=?, currency=?, status=?, start_date=?, end_date=? WHERE id=? AND tenant_id=?`,
      [req.body.title, req.body.description, parseFloat(req.body.goal_amount) || 0, req.body.currency, req.body.status, req.body.start_date, req.body.end_date, req.params.id, tid]);
    audit({ actor: req.session.user.id, action: 'fundraising:campaign-update', tid, meta: { id: req.params.id } });
    res.redirect('/fundraising/campaigns/' + req.params.id + '?msg=Campaign+updated');
  }));

  /* ── POST /fundraising/donate ── */
  app.get('/fundraising/donate', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [campaigns] = await pool.query('SELECT id, title FROM fr_campaigns WHERE tenant_id=? AND status=? ORDER BY title', [tid, 'active']);
    const [donors] = await pool.query('SELECT id, name FROM fr_donors WHERE tenant_id=? ORDER BY name LIMIT 200', [tid]);
    const html = `
<div class="card"><h2>Record Donation</h2>
<form method="POST" action="/fundraising/donate">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
    <div class="form-group"><label>Campaign</label>
      <select name="campaign_id" required>
        <option value="">— Select Campaign —</option>
        ${campaigns.map(c => `<option value="${c.id}" ${c.id == req.query.campaign_id ? 'selected' : ''}>${esc(c.title)}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Donor</label>
      <select name="donor_id"><option value="">— New Donor —</option>
        ${donors.map(d => `<option value="${d.id}">${esc(d.name)}</option>`).join('')}
      </select>
    </div>
  </div>
  <div id="newDonorFields" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
    <div class="form-group"><label>Donor Name</label><input name="donor_name" placeholder="Full name"></div>
    <div class="form-group"><label>Email</label><input name="donor_email" type="email" placeholder="email@example.com"></div>
    <div class="form-group"><label>Phone</label><input name="donor_phone" placeholder="+1234567890"></div>
  </div>
  <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
    <div class="form-group"><label>Amount</label><input name="amount" type="number" step="0.01" required></div>
    <div class="form-group"><label>Currency</label><select name="currency"><option>USD</option><option>EUR</option><option>GBP</option><option>UGX</option><option>KES</option></select></div>
    <div class="form-group"><label>Method</label><select name="method"><option>card</option><option>mobile_money</option><option>bank_transfer</option><option>cash</option><option>check</option><option>online</option></select></div>
  </div>
  <div class="form-group"><label>Transaction Reference</label><input name="transaction_ref" placeholder="Optional reference number"></div>
  <button type="submit" class="btn btn-success">Record Donation</button>
</form></div>
<script>
document.querySelector('[name=donor_id]').addEventListener('change',e=>{document.getElementById('newDonorFields').style.display=e.target.value?'none':'grid'});
</script>`;
    res.send(fundPage('Record Donation', html, req));
  }));

  app.post('/fundraising/donate', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    let donorId = parseInt(req.body.donor_id) || null;

    // Create donor if new
    if (!donorId && req.body.donor_name) {
      const [ins] = await pool.query(
        'INSERT INTO fr_donors (tenant_id, name, email, phone, first_donation, last_donation) VALUES (?,?,?,?,CURDATE(),CURDATE())',
        [tid, req.body.donor_name, req.body.donor_email || null, req.body.donor_phone || null]);
      donorId = ins.insertId;
    }

    const amount = parseFloat(req.body.amount) || 0;
    const campaignId = parseInt(req.body.campaign_id) || null;

    // Record donation
    await pool.query(
      `INSERT INTO fr_donations (tenant_id, campaign_id, donor_id, amount, currency, method, transaction_ref, status) VALUES (?,?,?,?,?,?,?,?)`,
      [tid, campaignId, donorId, amount, req.body.currency || 'USD', req.body.method || 'manual', req.body.transaction_ref || null, 'completed']);

    // Update campaign totals
    if (campaignId) {
      await pool.query(
        `UPDATE fr_campaigns SET raised_amount = raised_amount + ?, donor_count = (SELECT COUNT(DISTINCT donor_id) FROM fr_donations WHERE campaign_id=? AND status='completed' AND tenant_id=?) WHERE id=? AND tenant_id=?`,
        [amount, campaignId, tid, campaignId, tid]);
    }

    // Update donor totals
    if (donorId) {
      await pool.query(
        `UPDATE fr_donors SET total_donated = total_donated + ?, donation_count = donation_count + 1, last_donation = CURDATE() WHERE id=? AND tenant_id=?`,
        [amount, donorId, tid]);
    }

    audit({ actor: req.session.user.id, action: 'fundraising:donation', tid, meta: { amount, campaignId, donorId, method: req.body.method } });
    res.redirect('/fundraising?msg=Donation+recorded+' + fmtMoney(amount, req.body.currency));
  }));

  /* ── GET /fundraising/donors ── */
  app.get('/fundraising/donors', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const [donors] = await pool.query('SELECT * FROM fr_donors WHERE tenant_id=? ORDER BY total_donated DESC LIMIT ? OFFSET ?', [tid, limit, offset]);
    const [total] = await pool.query('SELECT COUNT(*) AS c FROM fr_donors WHERE tenant_id=?', [tid]);
    const totalPages = Math.ceil(total[0].c / limit);
    const html = `
<div class="card"><h2>Donors (${total[0].c})</h2>
<table><thead><tr><th>ID</th><th>Name</th><th>Email</th><th>Total Donated</th><th>Donations</th><th>First</th><th>Last</th></tr></thead><tbody>
${donors.map(d => `<tr>
<td>#${d.id}</td><td><a href="/fundraising/donors/${d.id}" style="font-weight:600;color:#2d6a4f;text-decoration:none">${esc(d.name)}</a></td>
<td>${esc(d.email || '—')}</td><td><strong>${fmtMoney(d.total_donated)}</strong></td>
<td>${d.donation_count}</td><td>${d.first_donation || '—'}</td><td>${d.last_donation || '—'}</td>
</tr>`).join('')}
${donors.length === 0 ? '<tr><td colspan="7" class="empty">No donors yet</td></tr>' : ''}
</tbody></table>
${totalPages > 1 ? `<div style="text-align:center;margin-top:12px">${page > 1 ? `<a href="?page=${page-1}" class="btn btn-sm btn-outline">← Prev</a>` : ''}<span style="margin:0 12px;color:#888">Page ${page} of ${totalPages}</span>${page < totalPages ? `<a href="?page=${page+1}" class="btn btn-sm btn-outline">Next →</a>` : ''}</div>` : ''}
</div>`;
    res.send(fundPage('Donors', html, req));
  }));

  /* ── GET /fundraising/donors/:id ── */
  app.get('/fundraising/donors/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [donors] = await pool.query('SELECT * FROM fr_donors WHERE id=? AND tenant_id=?', [req.params.id, tid]);
    if (!donors.length) return res.redirect('/fundraising/donors');
    const d = donors[0];
    const [donations] = await pool.query(
      'SELECT dn.*, cmp.title AS campaign_title FROM fr_donations dn LEFT JOIN fr_campaigns cmp ON dn.campaign_id = cmp.id WHERE dn.tenant_id=? AND dn.donor_id=? ORDER BY dn.donated_at DESC', [tid, d.id]);
    const [recurring] = await pool.query('SELECT r.*, cmp.title AS campaign_title FROM fr_recurring r LEFT JOIN fr_campaigns cmp ON r.campaign_id = cmp.id WHERE r.tenant_id=? AND r.donor_id=? AND r.status=?', [tid, d.id, 'active']);

    res.send(fundPage('Donor: ' + d.name, `
<div class="card" style="margin-bottom:16px">
  <h2>${esc(d.name)}</h2>
  <div style="display:flex;gap:24px;margin-top:8px;font-size:14px;color:#666">
    <span>📧 ${esc(d.email || '—')}</span><span>📱 ${esc(d.phone || '—')}</span>
  </div>
  <div class="stats" style="margin-top:16px">
    <div class="stat-card"><h3>Total Donated</h3><div class="val">${fmtMoney(d.total_donated)}</div></div>
    <div class="stat-card"><h3>Donations</h3><div class="val">${d.donation_count}</div></div>
    <div class="stat-card"><h3>Active Recurring</h3><div class="val">${recurring.length}</div></div>
  </div>
</div>
<div class="card"><h2>Donation History</h2>
<table><thead><tr><th>ID</th><th>Campaign</th><th>Amount</th><th>Method</th><th>Status</th><th>Date</th></tr></thead><tbody>
${donations.map(dn => `<tr>
<td>#${dn.id}</td><td>${esc(dn.campaign_title || 'General')}</td>
<td><strong>${fmtMoney(dn.amount, dn.currency)}</strong></td>
<td>${esc(dn.method)}</td><td><span class="badge badge-${dn.status === 'completed' ? 'completed' : 'paused'}">${esc(dn.status)}</span></td>
<td>${new Date(dn.donated_at).toLocaleDateString()}</td>
</tr>`).join('')}
</tbody></table></div>`, req));
  }));

  /* ── GET /fundraising/reports ── */
  app.get('/fundraising/reports', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [byCampaign] = await pool.query(
      'SELECT c.id, c.title, c.goal_amount, c.raised_amount, c.donor_count, c.currency FROM fr_campaigns c WHERE c.tenant_id=? ORDER BY c.raised_amount DESC', [tid]);
    const [monthly] = await pool.query(
      `SELECT DATE_FORMAT(donated_at, '%Y-%m') AS month, COUNT(*) AS donations, SUM(amount) AS total
       FROM fr_donations WHERE tenant_id=? AND status='completed' AND donated_at >= DATE_SUB(CURDATE(), INTERVAL 12 MONTH)
       GROUP BY DATE_FORMAT(donated_at, '%Y-%m') ORDER BY month DESC`, [tid]);
    const [byMethod] = await pool.query(
      `SELECT method, COUNT(*) AS c, SUM(amount) AS total FROM fr_donations WHERE tenant_id=? AND status='completed' GROUP BY method ORDER BY total DESC`, [tid]);
    const [byDonor] = await pool.query(
      'SELECT name, total_donated, donation_count FROM fr_donors WHERE tenant_id=? ORDER BY total_donated DESC LIMIT 10', [tid]);
    const totalRaised = byCampaign.reduce((s, c) => s + parseFloat(c.raised_amount || 0), 0);
    const totalGoal = byCampaign.reduce((s, c) => s + parseFloat(c.goal_amount || 0), 0);
    const maxMonthly = monthly.reduce((m, d) => Math.max(m, parseFloat(d.total) || 0), 1);

    res.send(fundPage('Fundraising Reports', `
<div class="stats">
  <div class="stat-card"><h3>Total Raised</h3><div class="val">${fmtMoney(totalRaised)}</div></div>
  <div class="stat-card"><h3>Total Goal</h3><div class="val">${fmtMoney(totalGoal)}</div></div>
  <div class="stat-card"><h3>Overall Progress</h3><div class="val">${totalGoal > 0 ? (totalRaised / totalGoal * 100).toFixed(1) : 0}%</div></div>
</div>
<div class="card"><h2>Monthly Revenue (12 months)</h2>
<div style="display:flex;align-items:end;gap:6px;height:180px;padding:8px 0">
${monthly.map(m => {
  const v = parseFloat(m.total) || 0;
  const h = Math.max(4, (v / maxMonthly) * 160);
  return `<div style="flex:1;background:linear-gradient(to top,#43e97b,#38f9d7);border-radius:4px 4px 0 0;height:${h}px;min-width:20px;position:relative">
    <span style="position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:11px;font-weight:600;color:#333">${fmtMoney(v)}</span>
    <span style="position:absolute;bottom:-20px;left:50%;transform:translateX(-50%);font-size:10px;color:#888;white-space:nowrap">${m.month}</span>
  </div>`;
}).join('')}</div></div>
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
<div class="card"><h2>By Campaign</h2>
<table><thead><tr><th>Campaign</th><th>Raised</th><th>Goal</th></tr></thead><tbody>
${byCampaign.map(c => `<tr><td>${esc(c.title)}</td><td><strong>${fmtMoney(c.raised_amount, c.currency)}</strong></td><td>${fmtMoney(c.goal_amount, c.currency)}</td></tr>`).join('')}
</tbody></table></div>
<div class="card"><h2>By Payment Method</h2>
<table><thead><tr><th>Method</th><th>Total</th><th>Count</th></tr></thead><tbody>
${byMethod.map(m => `<tr><td>${esc(m.method)}</td><td><strong>${fmtMoney(m.total)}</strong></td><td>${m.c}</td></tr>`).join('')}
</tbody></table></div>
</div>
<div class="card"><h2>Top Donors</h2>
<table><thead><tr><th>Name</th><th>Total Donated</th><th>Donations</th></tr></thead><tbody>
${byDonor.map(d => `<tr><td>${esc(d.name)}</td><td><strong>${fmtMoney(d.total_donated)}</strong></td><td>${d.donation_count}</td></tr>`).join('')}
</tbody></table></div>`, req));
  }));

  /* ── GET /fundraising/recurring ── */
  app.get('/fundraising/recurring', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [recurring] = await pool.query(
      `SELECT r.*, dn.name AS donor_name, cmp.title AS campaign_title
       FROM fr_recurring r LEFT JOIN fr_donors dn ON r.donor_id = dn.id LEFT JOIN fr_campaigns cmp ON r.campaign_id = cmp.id
       WHERE r.tenant_id=? ORDER BY r.created_at DESC`, [tid]);
    const [totals] = await pool.query(
      'SELECT COUNT(*) AS c, SUM(amount) AS monthly_total FROM fr_recurring WHERE tenant_id=? AND status=?', [tid, 'active']);
    const html = `
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
  <div>
    <h2 style="color:#333">Recurring Donations</h2>
    <div style="font-size:14px;color:#888">${totals[0].c} active · ${fmtMoney(totals[0].monthly_total)}/month</div>
  </div>
  <button onclick="document.getElementById('addRec').style.display='block'" class="btn btn-success">+ New Recurring</button>
</div>
<div id="addRec" class="card" style="display:none;margin-bottom:16px">
  <h2>Create Recurring Donation</h2>
  <form method="POST" action="/fundraising/recurring">
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
      <div class="form-group"><label>Donor</label><input name="donor_name" required placeholder="Donor name"></div>
      <div class="form-group"><label>Campaign (optional)</label><input name="campaign_id" type="number" placeholder="Campaign ID"></div>
    </div>
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px">
      <div class="form-group"><label>Amount</label><input name="amount" type="number" step="0.01" required></div>
      <div class="form-group"><label>Currency</label><select name="currency"><option>USD</option><option>EUR</option><option>UGX</option><option>KES</option></select></div>
      <div class="form-group"><label>Frequency</label><select name="frequency"><option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="quarterly">Quarterly</option><option value="yearly">Yearly</option></select></div>
    </div>
    <button type="submit" class="btn btn-primary">Create</button>
  </form>
</div>
<div class="card"><table><thead><tr><th>ID</th><th>Donor</th><th>Campaign</th><th>Amount</th><th>Frequency</th><th>Next Date</th><th>Status</th></tr></thead><tbody>
${recurring.map(r => `<tr>
<td>#${r.id}</td><td>${esc(r.donor_name || '—')}</td><td>${esc(r.campaign_title || 'General')}</td>
<td><strong>${fmtMoney(r.amount, r.currency)}</strong></td><td>${esc(r.frequency)}</td>
<td>${r.next_date || '—'}</td>
<td><span class="badge badge-${r.status === 'active' ? 'active' : r.status === 'paused' ? 'draft' : 'paused'}">${esc(r.status)}</span></td>
</tr>`).join('')}
${recurring.length === 0 ? '<tr><td colspan="7" class="empty">No recurring donations</td></tr>' : ''}
</tbody></table></div>`;
    res.send(fundPage('Recurring Donations', html, req));
  }));

  /* ── POST /fundraising/recurring ── */
  app.post('/fundraising/recurring', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    // Find or create donor
    let donorId = null;
    if (req.body.donor_name) {
      const [existing] = await pool.query('SELECT id FROM fr_donors WHERE tenant_id=? AND name=?', [tid, req.body.donor_name]);
      if (existing.length) {
        donorId = existing[0].id;
      } else {
        const [ins] = await pool.query('INSERT INTO fr_donors (tenant_id, name, first_donation, last_donation) VALUES (?,?,CURDATE(),CURDATE())', [tid, req.body.donor_name]);
        donorId = ins.insertId;
      }
    }
    const frequency = req.body.frequency || 'monthly';
    const nextDates = { weekly: 7, monthly: 30, quarterly: 90, yearly: 365 };
    const nextDate = new Date(Date.now() + (nextDates[frequency] || 30) * 86400000).toISOString().slice(0, 10);

    await pool.query(
      'INSERT INTO fr_recurring (tenant_id, donor_id, campaign_id, amount, currency, frequency, next_date, status) VALUES (?,?,?,?,?,?,?,?)',
      [tid, donorId, req.body.campaign_id || null, parseFloat(req.body.amount) || 0, req.body.currency || 'USD', frequency, nextDate, 'active']);
    audit({ actor: req.session.user.id, action: 'fundraising:recurring-create', tid, meta: { donorId, amount: req.body.amount } });
    res.redirect('/fundraising/recurring?msg=Recurring+donation+created');
  }));

  /* ── GET /fundraising/goals ── */
  app.get('/fundraising/goals', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const [goals] = await pool.query('SELECT * FROM fr_goals WHERE tenant_id=? ORDER BY target_date ASC', [tid]);
    const html = `
<div class="card"><h2>Fundraising Goals</h2>
${goals.length ? goals.map(g => {
  const pct = g.target_amount > 0 ? Math.min(100, (g.current_amount / g.target_amount * 100)) : 0;
  const daysLeft = g.target_date ? Math.max(0, Math.ceil((new Date(g.target_date) - new Date()) / 86400000)) : null;
  return `<div style="padding:16px 0;border-bottom:1px solid #eee">
    <div style="display:flex;justify-content:space-between;align-items:center">
      <div>
        <h3 style="margin-bottom:4px">${esc(g.name)}</h3>
        <span style="font-size:13px;color:#888">${g.start_date || '—'} → ${g.target_date || '—'} ${daysLeft !== null ? `(${daysLeft} days left)` : ''}</span>
      </div>
      <div style="text-align:right">
        <div style="font-size:22px;font-weight:700;color:#2d6a4f">${fmtMoney(g.current_amount)}</div>
        <div style="font-size:14px;color:#888">of ${fmtMoney(g.target_amount)}</div>
      </div>
    </div>
    ${pctBar(g.current_amount, g.target_amount)}
  </div>`;
}).join('') : '<div class="empty">No goals set. Goals help track your fundraising progress.</div>'}
</div>`;
    res.send(fundPage('Goals', html, req));
  }));

  console.log('[fundraising-unified] 5 tables, 14 routes registered');
};
