/**
 * Comfort Zone — Pricing Routes
 * Plans, usage metering, enterprise requests, invoices
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t,c,u) => c);
  const ah = (opts && opts.ah) || (fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(e => res.status(500).send('Error: '+e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  /* ── DB Migrations ─────────────────────────────────────────────── */
  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_plans (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        slug VARCHAR(50) NOT NULL UNIQUE,
        description TEXT,
        price_monthly DECIMAL(10,2) NOT NULL DEFAULT 0,
        price_yearly DECIMAL(10,2) NOT NULL DEFAULT 0,
        features JSONB NOT NULL DEFAULT '{}',
        max_users INTEGER NOT NULL DEFAULT 10,
        max_storage INTEGER NOT NULL DEFAULT 1024,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pricing_plans_slug ON pricing_plans(slug);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_subscriptions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        plan_id INTEGER NOT NULL REFERENCES pricing_plans(id),
        status VARCHAR(20) NOT NULL DEFAULT 'active',
        current_period_start TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        current_period_end TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 month',
        trial_ends_at TIMESTAMPTZ,
        cancelled_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_pricing_sub_tenant UNIQUE (tenant_id)
      );
      CREATE INDEX IF NOT EXISTS idx_pricing_sub_tenant ON pricing_subscriptions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_pricing_sub_status ON pricing_subscriptions(status);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_usage (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        metric_name VARCHAR(100) NOT NULL,
        value BIGINT NOT NULL DEFAULT 0,
        recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pricing_usage_tenant ON pricing_usage(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_pricing_usage_metric ON pricing_usage(tenant_id, metric_name);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_invoices (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        plan_id INTEGER REFERENCES pricing_plans(id),
        amount DECIMAL(10,2) NOT NULL,
        currency VARCHAR(3) NOT NULL DEFAULT 'USD',
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        paid_at TIMESTAMPTZ,
        invoice_number VARCHAR(50) NOT NULL UNIQUE DEFAULT '',
        pdf_url TEXT,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pricing_inv_tenant ON pricing_invoices(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_pricing_inv_status ON pricing_invoices(status);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS pricing_enterprise_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        company_name VARCHAR(255) NOT NULL,
        contact_name VARCHAR(255) NOT NULL,
        contact_email VARCHAR(255) NOT NULL,
        requirements TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_pricing_ent_tenant ON pricing_enterprise_requests(tenant_id);
    `);

    // Seed default plans
    const {rows} = await pool.query("SELECT COUNT(*) as c FROM pricing_plans");
    if (parseInt(rows[0].c) === 0) {
      await pool.query(`
        INSERT INTO pricing_plans (name, slug, description, price_monthly, price_yearly, features, max_users, max_storage, sort_order) VALUES
        ('Free', 'free', 'Perfect for getting started', 0, 0,
         '{"dashboard":true,"basic_reports":true,"5_team_members":true,"1gb_storage":true}',
         5, 1024, 0),
        ('Starter', 'starter', 'Great for growing teams', 29, 290,
         '{"dashboard":true,"advanced_reports":true,"api_access":true,"25_team_members":true,"10gb_storage":true,"email_support":true}',
         25, 10240, 1),
        ('Professional', 'professional', 'Best for established organizations', 79, 790,
         '{"dashboard":true,"advanced_reports":true,"api_access":true,"unlimited_members":true,"100gb_storage":true,"priority_support":true,"custom_branding":true,"sso":true}',
         250, 102400, 2),
        ('Enterprise', 'enterprise', 'For large-scale deployments', 0, 0,
         '{"dashboard":true,"advanced_reports":true,"api_access":true,"unlimited_members":true,"unlimited_storage":true,"dedicated_support":true,"custom_branding":true,"sso":true,"sla":true,"custom_integrations":true,"on_premise":true}',
         999999, 999999999, 3);
      `);
    }
  }
  ensureTables().catch(e => console.error('[pricing] migration error:', e.message));

  /* ── Helpers ───────────────────────────────────────────────────── */
  function priceLayout(title, body) {
    return `<!DOCTYPE html><html lang="en"><head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${esc(title)} — Comfort Zone</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#f0f2f5;color:#1a1a2e;min-height:100vh}
        .container{max-width:1100px;margin:0 auto;padding:40px 20px}
        .header{text-align:center;margin-bottom:40px}
        .header h1{font-size:32px;font-weight:700;margin-bottom:8px}
        .header p{color:#6b7280;font-size:16px}
        .toggle-billing{display:inline-flex;background:#e5e7eb;border-radius:10px;padding:4px;margin:16px 0 32px}
        .toggle-billing button{padding:10px 24px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;background:transparent;color:#6b7280;transition:all .2s}
        .toggle-billing button.active{background:#4F46E5;color:#fff}
        .plans{display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;margin-bottom:40px}
        .plan-card{background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:32px 24px;text-align:center;transition:all .3s;position:relative;border:2px solid transparent}
        .plan-card:hover{transform:translateY(-4px);box-shadow:0 8px 24px rgba(0,0,0,.12)}
        .plan-card.popular{border-color:#4F46E5}
        .plan-card.popular::before{content:'Most Popular';position:absolute;top:-12px;left:50%;transform:translateX(-50%);background:#4F46E5;color:#fff;padding:4px 16px;border-radius:20px;font-size:12px;font-weight:600}
        .plan-name{font-size:20px;font-weight:700;margin-bottom:4px}
        .plan-desc{color:#6b7280;font-size:13px;margin-bottom:16px;min-height:36px}
        .plan-price{font-size:40px;font-weight:800;margin-bottom:4px}
        .plan-price .period{font-size:14px;font-weight:400;color:#6b7280}
        .plan-features{text-align:left;margin:20px 0;list-style:none}
        .plan-features li{padding:6px 0;font-size:14px;color:#4b5563;display:flex;align-items:center;gap:8px}
        .plan-features li::before{content:'✓';color:#10B981;font-weight:700}
        .plan-features li.disabled{color:#d1d5db}.plan-features li.disabled::before{content:'✕';color:#d1d5db}
        .btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 28px;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;transition:all .2s;text-decoration:none;width:100%}
        .btn-primary{background:#4F46E5;color:#fff}.btn-primary:hover{background:#4338CA}
        .btn-outline{background:transparent;color:#4F46E5;border:2px solid #4F46E5}.btn-outline:hover{background:#4F46E5;color:#fff}
        .btn-success{background:#10B981;color:#fff}.btn-success:hover{background:#059669}
        .btn-secondary{background:#f3f4f6;color:#374151}.btn-secondary:hover{background:#e5e7eb}
        .btn-danger{background:#EF4444;color:#fff}
        .btn-sm{padding:8px 16px;font-size:13px;width:auto}
        .card{background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08);padding:32px;margin-bottom:24px}
        .alert{padding:14px 18px;border-radius:10px;margin-bottom:20px;font-size:14px}
        .alert-success{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}
        .alert-error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
        .alert-info{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}
        table{width:100%;border-collapse:collapse}
        th,td{padding:12px 16px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:14px}
        th{font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
        .badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600}
        .badge-active{background:#D1FAE5;color:#065F46}
        .badge-pending{background:#FEF3C7;color:#92400E}
        .badge-paid{background:#D1FAE5;color:#065F46}
        .badge-cancelled{background:#FEE2E2;color:#991B1B}
        .form-group{margin-bottom:20px}
        .form-group label{display:block;font-weight:600;font-size:14px;margin-bottom:6px;color:#374151}
        .form-group input,.form-group select,.form-group textarea{width:100%;padding:12px 16px;border:2px solid #e5e7eb;border-radius:10px;font-size:15px;transition:border .2s}
        .form-group input:focus,.form-group textarea:focus{outline:none;border-color:#4F46E5}
        .usage-bar{height:12px;background:#e5e7eb;border-radius:6px;overflow:hidden;margin:6px 0}
        .usage-bar .fill{height:100%;border-radius:6px;transition:width .5s}
        .compare-table td,.compare-table th{text-align:center}
        .compare-table td:first-child,.compare-table th:first-child{text-align:left}
        .compare-table th{font-size:13px;padding:16px}
        .check{color:#10B981;font-weight:700;font-size:16px}.cross{color:#d1d5db;font-size:16px}
        .nav{display:flex;gap:8px;margin-bottom:24px;padding:12px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08)}
        .nav a{padding:8px 16px;border-radius:8px;text-decoration:none;color:#6b7280;font-size:14px;font-weight:500;transition:all .2s}
        .nav a:hover,.nav a.active{background:#4F46E5;color:#fff}
        @media(max-width:768px){.plans{grid-template-columns:1fr}.nav{flex-wrap:wrap}}
      </style>
    </head><body><div class="container">
      ${body}
    </div></body></html>`;
  }

  /* ── GET /pricing — Public pricing page ────────────────────────── */
  app.get('/pricing', ah(async (req, res) => {
    const {rows: plans} = await pool.query(
      "SELECT * FROM pricing_plans WHERE is_active = TRUE ORDER BY sort_order"
    );
    const planCards = plans.map((p, i) => {
      const features = p.features || {};
      const featureList = Object.keys(features).map(k =>
        `<li class="${features[k] ? '' : 'disabled'}">${esc(k.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase()))}</li>`
      ).join('');
      const price = p.price_monthly;
      const yearlyPrice = p.price_yearly;
      const isPopular = p.slug === 'professional';
      return `<div class="plan-card ${isPopular ? 'popular' : ''}">
        <div class="plan-name">${esc(p.name)}</div>
        <div class="plan-desc">${esc(p.description || '')}</div>
        <div class="plan-price" data-monthly="${price}" data-yearly="${yearlyPrice}">
          $${price}<span class="period">/mo</span>
        </div>
        ${yearlyPrice > 0 ? `<div style="color:#10B981;font-size:13px;margin-bottom:12px">$${Math.round(yearlyPrice/12)}/mo billed yearly</div>` : ''}
        <ul class="plan-features">${featureList}</ul>
        ${price === 0 && p.slug === 'free'
          ? `<a href="/register" class="btn btn-outline">Get Started Free</a>`
          : price === 0
          ? `<a href="/pricing/enterprise/request" class="btn btn-primary">Contact Sales</a>`
          : `<a href="/pricing/upgrade?plan=${esc(p.slug)}" class="btn ${isPopular ? 'btn-primary' : 'btn-outline'}">Choose ${esc(p.name)}</a>`
        }
      </div>`;
    }).join('');
    const body = `<div class="header">
      <h1>Simple, Transparent Pricing</h1>
      <p>Choose the plan that fits your organization. Upgrade or downgrade anytime.</p>
      <div class="toggle-billing" id="billing-toggle">
        <button class="active" onclick="setBilling('monthly')">Monthly</button>
        <button onclick="setBilling('yearly')">Yearly <span style="color:#10B981;font-size:12px">Save 17%</span></button>
      </div>
    </div>
    <div class="plans" id="plans-grid">${planCards}</div>
    <div style="text-align:center;color:#6b7280;font-size:14px">
      <p>All plans include SSL encryption, 99.9% uptime, and 24/7 monitoring.</p>
      <p>Questions? <a href="/contact" style="color:#4F46E5">Contact our sales team</a></p>
    </div>
    <script>
      let billing='monthly';
      function setBilling(mode){billing=mode;document.querySelectorAll('#billing-toggle button').forEach((b,i)=>b.classList.toggle('active',i===(mode==='monthly'?0:1)));
        document.querySelectorAll('.plan-price').forEach(el=>{const p=parseFloat(el.dataset.monthly);const y=parseFloat(el.dataset.yearly);
          if(billing==='yearly'&&y>0){el.innerHTML='$'+Math.round(y/12)+'<span class="period">/mo</span>'}
          else if(billing==='monthly'){el.innerHTML='$'+p+'<span class="period">/mo</span>'}});}
    </script>`;
    res.send(priceLayout('Pricing Plans', body));
  }));

  /* ── GET /pricing/compare — Plan comparison ────────────────────── */
  app.get('/pricing/compare', ah(async (req, res) => {
    const {rows: plans} = await pool.query(
      "SELECT * FROM pricing_plans WHERE is_active = TRUE ORDER BY sort_order"
    );
    const featureKeys = ['dashboard','advanced_reports','api_access','custom_branding','sso','sla','email_support','priority_support','dedicated_support'];
    const thCols = plans.map(p => `<th><strong>${esc(p.name)}</strong><br><span style="font-weight:400;color:#6b7280">$${p.price_monthly}/mo</span></th>`).join('');
    const comparisonRows = featureKeys.map(key => {
      const label = key.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase());
      const tds = plans.map(p => {
        const f = p.features || {};
        const val = f[key];
        if (val === true) return '<td><span class="check">✓</span></td>';
        if (val === false || !val) return '<td><span class="cross">✕</span></td>';
        return `<td>${esc(String(val))}</td>`;
      }).join('');
      return `<tr><td style="font-weight:500">${esc(label)}</td>${tds}</tr>`;
    }).join('');
    const extraRows = `
      <tr><td style="font-weight:500">Max Users</td>${plans.map(p => `<td>${p.max_users >= 999999 ? 'Unlimited' : p.max_users}</td>`).join('')}</tr>
      <tr><td style="font-weight:500">Storage</td>${plans.map(p => `<td>${p.max_storage >= 999999999 ? 'Unlimited' : p.max_storage >= 102400 ? Math.round(p.max_storage/1024)+'GB' : p.max_storage+'MB'}</td>`).join('')}</tr>
    `;
    const body = `<div class="header">
      <h1>Plan Comparison</h1>
      <p>Compare features side by side to find the right plan for you.</p>
    </div>
    <div class="card" style="overflow-x:auto">
      <table class="compare-table">
        <thead><tr><th>Feature</th>${thCols}</tr></thead>
        <tbody>${comparisonRows}${extraRows}</tbody>
      </table>
    </div>
    <div style="text-align:center;margin-top:16px">
      <a href="/pricing" class="btn btn-primary btn-sm">← Back to Plans</a>
    </div>`;
    res.send(priceLayout('Compare Plans', body));
  }));

  /* ── GET /pricing/current — Current plan details ───────────────── */
  app.get('/pricing/current', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: subs} = await pool.query(
      `SELECT s.*, p.name as plan_name, p.slug as plan_slug, p.price_monthly, p.features as plan_features,
              p.max_users, p.max_storage
       FROM pricing_subscriptions s
       JOIN pricing_plans p ON s.plan_id = p.id
       WHERE s.tenant_id = $1`, [tid]
    );
    const sub = subs[0];
    if (!sub) {
      return res.redirect('/pricing');
    }
    const features = sub.plan_features || {};
    const featureList = Object.entries(features).filter(([,v])=>v).map(([k]) =>
      `<li>${esc(k.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase()))}</li>`
    ).join('');
    const body = `<div class="nav">
      <a href="/pricing">Plans</a>
      <a href="/pricing/current" class="active">Current Plan</a>
      <a href="/pricing/usage">Usage</a>
      <a href="/pricing/invoices">Invoices</a>
    </div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="font-size:24px">${esc(sub.plan_name)} Plan</h2>
          <p style="color:#6b7280">Period: ${esc(sub.current_period_start?.toLocaleDateString?.()||'')} — ${esc(sub.current_period_end?.toLocaleDateString?.()||'')}</p>
        </div>
        <span class="badge badge-active">Active</span>
      </div>
      <div style="font-size:36px;font-weight:800;margin-bottom:16px">$${sub.price_monthly}<span style="font-size:16px;color:#6b7280;font-weight:400">/month</span></div>
      <h3 style="margin-bottom:12px">Included Features</h3>
      <ul style="list-style:none">${featureList}</ul>
      <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap">
        ${sub.plan_slug !== 'free' ? `<form method="POST" action="/pricing/downgrade"><button class="btn btn-secondary">Downgrade Plan</button></form>` : ''}
        ${sub.plan_slug !== 'enterprise' ? `<a href="/pricing" class="btn btn-primary">Upgrade Plan</a>` : ''}
      </div>
    </div>
    ${sub.plan_slug === 'free' ? `<div class="card"><div class="alert alert-info">You're on the free plan. Upgrade to unlock advanced features, more storage, and priority support.</div>
      <a href="/pricing" class="btn btn-primary">View Plans</a></div>` : ''}`;
    res.send(priceLayout('Current Plan', body));
  }));

  /* ── POST /pricing/upgrade — Upgrade plan ──────────────────────── */
  app.post('/pricing/upgrade', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const planSlug = req.body.plan_slug || req.query.plan;
    if (!planSlug) return res.redirect('/pricing');
    const {rows: plans} = await pool.query(
      "SELECT * FROM pricing_plans WHERE slug = $1 AND is_active = TRUE", [planSlug]
    );
    if (!plans.length) return res.redirect('/pricing');
    const plan = plans[0];
    await pool.query(`
      INSERT INTO pricing_subscriptions (tenant_id, plan_id, status, current_period_start, current_period_end)
      VALUES ($1, $2, 'active', NOW(), NOW() + INTERVAL '1 month')
      ON CONFLICT (tenant_id) DO UPDATE SET
        plan_id = EXCLUDED.plan_id,
        status = 'active',
        current_period_start = NOW(),
        current_period_end = NOW() + INTERVAL '1 month',
        cancelled_at = NULL
    `, [tid, plan.id]);
    // Generate invoice
    const invNum = 'INV-' + Date.now().toString(36).toUpperCase() + '-' + Math.random().toString(36).substr(2,4).toUpperCase();
    await pool.query(`
      INSERT INTO pricing_invoices (tenant_id, plan_id, amount, currency, status, invoice_number)
      VALUES ($1, $2, $3, 'USD', 'pending', $4)
    `, [tid, plan.id, plan.price_monthly, invNum]);
    audit(req, 'pricing:upgrade', { plan: planSlug, amount: plan.price_monthly });
    res.redirect('/pricing/current');
  }));

  /* ── POST /pricing/downgrade — Downgrade plan ──────────────────── */
  app.post('/pricing/downgrade', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: subs} = await pool.query(
      "SELECT s.plan_id, p.slug FROM pricing_subscriptions s JOIN pricing_plans p ON s.plan_id=p.id WHERE s.tenant_id=$1", [tid]
    );
    if (!subs.length) return res.redirect('/pricing');
    const currentSlug = subs[0].slug;
    const downgrades = {professional:'starter', starter:'free', enterprise:'professional'};
    const newSlug = downgrades[currentSlug];
    if (!newSlug) return res.redirect('/pricing');
    const {rows: plans} = await pool.query("SELECT * FROM pricing_plans WHERE slug=$1", [newSlug]);
    if (!plans.length) return res.redirect('/pricing');
    await pool.query(`
      UPDATE pricing_subscriptions SET plan_id=$1, current_period_end=NOW() WHERE tenant_id=$2
    `, [plans[0].id, tid]);
    audit(req, 'pricing:downgrade', { from: currentSlug, to: newSlug });
    res.redirect('/pricing/current');
  }));

  /* ── GET /pricing/usage — Usage metrics ────────────────────────── */
  app.get('/pricing/usage', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: sub} = await pool.query(
      `SELECT p.max_users, p.max_storage, p.name as plan_name
       FROM pricing_subscriptions s JOIN pricing_plans p ON s.plan_id=p.id WHERE s.tenant_id=$1`, [tid]
    );
    const limits = sub[0] || { max_users: 5, max_storage: 1024, plan_name: 'Free' };
    const {rows: usage} = await pool.query(
      "SELECT metric_name, value FROM pricing_usage WHERE tenant_id=$1", [tid]
    );
    const metrics = {};
    usage.forEach(u => { metrics[u.metric_name] = parseInt(u.value) || 0; });
    const usageItems = [
      { name: 'Active Users', used: metrics.users || 1, max: limits.max_users, unit: '', color: '#4F46E5' },
      { name: 'Storage Used', used: metrics.storage_mb || 50, max: limits.max_storage, unit: ' MB', color: '#10B981' },
      { name: 'API Calls This Month', used: metrics.api_calls || 120, max: 10000, unit: '', color: '#F59E0B' },
      { name: 'Reports Generated', used: metrics.reports || 8, max: 100, unit: '', color: '#EF4444' }
    ];
    const usageCards = usageItems.map(item => {
      const pct = Math.min(100, Math.round((item.used / item.max) * 100));
      const barColor = pct > 90 ? '#EF4444' : pct > 70 ? '#F59E0B' : item.color;
      return `<div style="padding:16px;border:1px solid #e5e7eb;border-radius:12px;margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px">
          <span style="font-weight:600;font-size:14px">${esc(item.name)}</span>
          <span style="color:#6b7280;font-size:13px">${item.used.toLocaleString()}${esc(item.unit)} / ${item.max >= 999999 ? '∞' : item.max.toLocaleString()+item.unit}</span>
        </div>
        <div class="usage-bar"><div class="fill" style="width:${pct}%;background:${barColor}"></div></div>
        <div style="text-align:right;font-size:12px;color:${barColor};font-weight:600">${pct}% used</div>
      </div>`;
    }).join('');
    const body = `<div class="nav">
      <a href="/pricing">Plans</a>
      <a href="/pricing/current">Current Plan</a>
      <a href="/pricing/usage" class="active">Usage</a>
      <a href="/pricing/invoices">Invoices</a>
    </div>
    <div class="card">
      <h2 style="margin-bottom:4px">Usage &amp; Limits</h2>
      <p style="color:#6b7280;margin-bottom:24px">Current billing period — ${esc(limits.plan_name)} Plan</p>
      ${usageCards}
    </div>`;
    res.send(priceLayout('Usage Metrics', body));
  }));

  /* ── GET /pricing/invoices — Invoice list ──────────────────────── */
  app.get('/pricing/invoices', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: invoices} = await pool.query(
      `SELECT i.*, p.name as plan_name
       FROM pricing_invoices i
       LEFT JOIN pricing_plans p ON i.plan_id = p.id
       WHERE i.tenant_id = $1 ORDER BY i.created_at DESC LIMIT 50`, [tid]
    );
    const invRows = invoices.map(inv => `<tr>
      <td><a href="/pricing/invoices/${inv.id}" style="color:#4F46E5;text-decoration:none;font-weight:600">${esc(inv.invoice_number)}</a></td>
      <td>${esc(inv.plan_name || '—')}</td>
      <td>$${parseFloat(inv.amount).toFixed(2)}</td>
      <td>${esc(inv.created_at?.toLocaleDateString?.()||'')}</td>
      <td><span class="badge ${inv.status==='paid'?'badge-paid':inv.status==='cancelled'?'badge-cancelled':'badge-pending'}">${esc(inv.status)}</span></td>
      <td>${inv.pdf_url ? `<a href="${esc(inv.pdf_url)}" class="btn btn-sm btn-outline" target="_blank">PDF</a>` : '—'}</td>
    </tr>`).join('');
    const body = `<div class="nav">
      <a href="/pricing">Plans</a>
      <a href="/pricing/current">Current Plan</a>
      <a href="/pricing/usage">Usage</a>
      <a href="/pricing/invoices" class="active">Invoices</a>
    </div>
    <div class="card">
      <h2 style="margin-bottom:20px">Invoice History</h2>
      ${invRows ? `<div style="overflow-x:auto"><table>
        <thead><tr><th>Invoice #</th><th>Plan</th><th>Amount</th><th>Date</th><th>Status</th><th>PDF</th></tr></thead>
        <tbody>${invRows}</tbody>
      </table></div>` : '<div class="alert alert-info">No invoices yet.</div>'}
    </div>`;
    res.send(priceLayout('Invoices', body));
  }));

  /* ── GET /pricing/invoices/:id — Invoice detail ────────────────── */
  app.get('/pricing/invoices/:id', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: invoices} = await pool.query(
      `SELECT i.*, p.name as plan_name, p.price_monthly, p.features
       FROM pricing_invoices i
       LEFT JOIN pricing_plans p ON i.plan_id = p.id
       WHERE i.id = $1 AND i.tenant_id = $2`, [req.params.id, tid]
    );
    const inv = invoices[0];
    if (!inv) return res.status(404).send(priceLayout('Not Found', '<div class="alert alert-error">Invoice not found.</div>'));
    const body = `<div style="margin-bottom:16px"><a href="/pricing/invoices" class="btn btn-sm btn-secondary">← All Invoices</a></div>
    <div class="card">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="margin-bottom:4px">Invoice ${esc(inv.invoice_number)}</h2>
          <p style="color:#6b7280">${esc(inv.created_at?.toLocaleDateString?.()||'')}</p>
        </div>
        <div style="text-align:right">
          <div style="font-size:32px;font-weight:800">$${parseFloat(inv.amount).toFixed(2)}</div>
          <span class="badge ${inv.status==='paid'?'badge-paid':'badge-pending'}" style="font-size:14px">${esc(inv.status)}</span>
        </div>
      </div>
      <div style="border-top:1px solid #e5e7eb;padding-top:20px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div><strong>Plan:</strong> ${esc(inv.plan_name||'—')}</div>
          <div><strong>Currency:</strong> ${esc(inv.currency)}</div>
          <div><strong>Status:</strong> ${esc(inv.status)}</div>
          <div><strong>Paid:</strong> ${inv.paid_at ? esc(inv.paid_at.toLocaleDateString()) : 'Not paid'}</div>
        </div>
      </div>
      ${inv.pdf_url ? `<div style="margin-top:20px"><a href="${esc(inv.pdf_url)}" class="btn btn-primary" target="_blank">Download PDF</a></div>` : ''}
    </div>`;
    res.send(priceLayout('Invoice Detail', body));
  }));

  /* ── POST /pricing/enterprise/request — Request enterprise ─────── */
  app.post('/pricing/enterprise/request', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { company_name, contact_name, contact_email, requirements } = req.body;
    if (!company_name || !contact_email) {
      return res.status(400).send(priceLayout('Error', '<div class="alert alert-error">Company name and contact email are required.</div>'));
    }
    await pool.query(`
      INSERT INTO pricing_enterprise_requests (tenant_id, company_name, contact_name, contact_email, requirements)
      VALUES ($1, $2, $3, $4, $5)
    `, [tid, company_name, contact_name || '', contact_email, requirements || '']);
    audit(req, 'pricing:enterprise:request', { company_name, contact_email });
    res.redirect('/pricing/enterprise/status');
  }));

  /* ── GET /pricing/enterprise/status — Enterprise request status ── */
  app.get('/pricing/enterprise/status', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: requests} = await pool.query(
      "SELECT * FROM pricing_enterprise_requests WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 5", [tid]
    );
    const reqRows = requests.map(r => `<tr>
      <td>${esc(r.company_name)}</td>
      <td>${esc(r.contact_email)}</td>
      <td><span class="badge ${r.status==='approved'?'badge-paid':r.status==='rejected'?'badge-cancelled':'badge-pending'}">${esc(r.status)}</span></td>
      <td>${esc(r.created_at?.toLocaleDateString?.()||'')}</td>
    </tr>`).join('');
    const body = `<div style="margin-bottom:16px"><a href="/pricing" class="btn btn-sm btn-secondary">← Plans</a></div>
    <div class="card">
      <h2 style="margin-bottom:20px">Enterprise Request Status</h2>
      ${reqRows ? `<table>
        <thead><tr><th>Company</th><th>Contact</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${reqRows}</tbody>
      </table>` : '<div class="alert alert-info">No enterprise requests submitted.</div>'}
      <form method="POST" action="/pricing/enterprise/request" style="margin-top:24px">
        <h3 style="margin-bottom:16px">Submit New Request</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="form-group"><label>Company Name *</label><input type="text" name="company_name" required></div>
          <div class="form-group"><label>Contact Name</label><input type="text" name="contact_name"></div>
        </div>
        <div class="form-group"><label>Contact Email *</label><input type="email" name="contact_email" required></div>
        <div class="form-group"><label>Requirements</label><textarea name="requirements" rows="4" placeholder="Describe your needs..."></textarea></div>
        <button type="submit" class="btn btn-primary">Submit Request</button>
      </form>
    </div>`;
    res.send(priceLayout('Enterprise Status', body));
  }));

  console.log('[routes] pricing-routes.js loaded');
};
