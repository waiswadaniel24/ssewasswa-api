/**
 * Comfort Zone — Onboarding Wizard Routes
 * Guided setup for new tenants: org profile, team invites, portal settings, data import
 */
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
      CREATE TABLE IF NOT EXISTS onboarding_progress (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        current_step INTEGER NOT NULL DEFAULT 1,
        completed_steps TEXT[] NOT NULL DEFAULT '{}',
        started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        completed_at TIMESTAMPTZ,
        CONSTRAINT uq_onboarding_tenant UNIQUE (tenant_id)
      );
      CREATE INDEX IF NOT EXISTS idx_onb_prog_tenant ON onboarding_progress(tenant_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS onboarding_invitations (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        email VARCHAR(255) NOT NULL,
        role VARCHAR(100) NOT NULL DEFAULT 'member',
        invited_by INTEGER NOT NULL,
        accepted BOOLEAN NOT NULL DEFAULT FALSE,
        token VARCHAR(255) NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
        sent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        accepted_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_onb_inv_tenant ON onboarding_invitations(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_onb_inv_token ON onboarding_invitations(token);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS onboarding_settings (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        primary_color VARCHAR(7) NOT NULL DEFAULT '#4F46E5',
        secondary_color VARCHAR(7) NOT NULL DEFAULT '#10B981',
        logo_url TEXT,
        timezone VARCHAR(50) NOT NULL DEFAULT 'UTC',
        language VARCHAR(10) NOT NULL DEFAULT 'en',
        features TEXT[] NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_onboarding_settings_tenant UNIQUE (tenant_id)
      );
      CREATE INDEX IF NOT EXISTS idx_onb_sett_tenant ON onboarding_settings(tenant_id);
    `);
  }
  ensureTables().catch(e => console.error('[onboarding] migration error:', e.message));

  /* ── Helpers ───────────────────────────────────────────────────── */
  async function getProgress(tid) {
    const {rows} = await pool.query(
      'SELECT * FROM onboarding_progress WHERE tenant_id = $1', [tid]
    );
    if (!rows.length) {
      await pool.query(
        'INSERT INTO onboarding_progress (tenant_id, current_step) VALUES ($1, 1)', [tid]
      );
      return { tenant_id: tid, current_step: 1, completed_steps: [], started_at: new Date(), completed_at: null };
    }
    return rows[0];
  }

  async function markStepComplete(tid, step) {
    await pool.query(
      `INSERT INTO onboarding_progress (tenant_id, current_step, completed_steps)
       VALUES ($1, $2, ARRAY[$3])
       ON CONFLICT (tenant_id)
       DO UPDATE SET completed_steps = array_append(onboarding_progress.completed_steps, $3),
                      current_step = $2,
                      completed_at = CASE WHEN $2 > 4 THEN NOW() ELSE onboarding_progress.completed_at END`,
      [tid, step, String(step)]
    );
  }

  function layout(title, body, step) {
    const steps = [
      {n:1, label:'Organization'},
      {n:2, label:'Team'},
      {n:3, label:'Settings'},
      {n:4, label:'Import'}
    ];
    const stepBar = steps.map(s => {
      const active = s.n === step ? 'active' : '';
      const done = step > s.n ? 'done' : '';
      return `<div class="step-item ${active} ${done}">
        <div class="step-circle">${done ? '✓' : s.n}</div>
        <span class="step-label">${s.label}</span>
      </div>`;
    }).join('');
    return `<!DOCTYPE html><html lang="en"><head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${esc(title)} — Comfort Zone</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#f0f2f5;color:#1a1a2e;min-height:100vh}
        .container{max-width:720px;margin:0 auto;padding:40px 20px}
        .header{text-align:center;margin-bottom:32px}
        .header h1{font-size:28px;font-weight:700;color:#4F46E5;margin-bottom:6px}
        .header p{color:#6b7280;font-size:15px}
        .stepper{display:flex;justify-content:center;gap:8px;margin-bottom:36px}
        .step-item{display:flex;align-items:center;gap:8px}
        .step-circle{width:36px;height:36px;border-radius:50%;background:#e5e7eb;color:#9ca3af;display:flex;align-items:center;justify-content:center;font-weight:600;font-size:14px;transition:all .3s}
        .step-item.active .step-circle{background:#4F46E5;color:#fff;box-shadow:0 0 0 4px rgba(79,70,229,.25)}
        .step-item.done .step-circle{background:#10B981;color:#fff}
        .step-label{font-size:13px;color:#9ca3af;font-weight:500}
        .step-item.active .step-label,.step-item.done .step-label{color:#1a1a2e}
        .card{background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08),0 4px 12px rgba(0,0,0,.04);padding:36px;margin-bottom:24px}
        .form-group{margin-bottom:20px}
        .form-group label{display:block;font-weight:600;font-size:14px;margin-bottom:6px;color:#374151}
        .form-group input,.form-group select,.form-group textarea{width:100%;padding:12px 16px;border:2px solid #e5e7eb;border-radius:10px;font-size:15px;transition:border .2s;background:#fafafa}
        .form-group input:focus,.form-group select:focus,.form-group textarea:focus{outline:none;border-color:#4F46E5;background:#fff}
        .form-group .hint{font-size:12px;color:#9ca3af;margin-top:4px}
        .btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 28px;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;transition:all .2s;text-decoration:none}
        .btn-primary{background:#4F46E5;color:#fff}.btn-primary:hover{background:#4338CA}
        .btn-secondary{background:#f3f4f6;color:#374151}.btn-secondary:hover{background:#e5e7eb}
        .btn-success{background:#10B981;color:#fff}.btn-success:hover{background:#059669}
        .btn-sm{padding:8px 16px;font-size:13px}
        .btn-danger{background:#EF4444;color:#fff}.btn-danger:hover{background:#DC2626}
        .actions{display:flex;justify-content:space-between;margin-top:28px}
        .alert{padding:14px 18px;border-radius:10px;margin-bottom:20px;font-size:14px}
        .alert-success{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}
        .alert-error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
        .alert-info{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}
        table{width:100%;border-collapse:collapse}
        th,td{padding:12px 16px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:14px}
        th{font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
        .badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600}
        .badge-pending{background:#FEF3C7;color:#92400E}
        .badge-accepted{background:#D1FAE5;color:#065F46}
        .file-upload{border:2px dashed #d1d5db;border-radius:12px;padding:40px;text-align:center;cursor:pointer;transition:border .2s}
        .file-upload:hover{border-color:#4F46E5}
        .file-upload input[type="file"]{display:none}
        .celebration{text-align:center;padding:40px 0}
        .celebration h2{font-size:36px;color:#10B981;margin-bottom:12px}
        .celebration .confetti{font-size:64px;margin-bottom:20px}
        .color-preview{width:48px;height:48px;border-radius:10px;border:2px solid #e5e7eb;display:inline-block;vertical-align:middle}
        .skip-link{text-align:center;margin-top:16px}
        .skip-link a{color:#9ca3af;font-size:13px;text-decoration:underline}
        @media(max-width:640px){.container{padding:20px 16px}.card{padding:24px 20px}.stepper{flex-wrap:wrap}.step-label{display:none}}
      </style>
    </head><body><div class="container">
      <div class="header"><h1>🚀 Comfort Zone</h1><p>${esc(title)}</p></div>
      ${step >= 1 && step <= 4 ? `<div class="stepper">${stepBar}</div>` : ''}
      ${body}
    </div></body></html>`;
  }

  /* ── GET /onboarding — Start / resume wizard ──────────────────── */
  app.get('/onboarding', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const prog = await getProgress(tid);
    if (prog.completed_at) return res.redirect('/onboarding/complete');
    audit(req, 'onboarding:view', { step: prog.current_step });
    const body = `<div class="card">
      <h2 style="margin-bottom:12px">Welcome to Comfort Zone! 🎉</h2>
      <p style="color:#6b7280;margin-bottom:20px">Let's get your organization set up. This should take about 5 minutes.</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
        <div class="alert alert-info"><strong>Step 1:</strong> Organization Profile</div>
        <div class="alert alert-info"><strong>Step 2:</strong> Invite Your Team</div>
        <div class="alert alert-info"><strong>Step 3:</strong> Portal Settings</div>
        <div class="alert alert-info"><strong>Step 4:</strong> Import Data</div>
      </div>
      <div class="actions"><div></div>
        <a href="/onboarding/step/${prog.current_step}" class="btn btn-primary">
          ${prog.current_step > 1 ? 'Continue Step ' + prog.current_step : 'Get Started'} →
        </a>
      </div>
    </div>
    <div class="skip-link"><a href="/onboarding/skip">Skip onboarding for now</a></div>`;
    res.send(layout('Get Started', body, prog.current_step));
  }));

  /* ── GET /onboarding/step/1 — Organization profile form ───────── */
  app.get('/onboarding/step/1', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows} = await pool.query(
      "SELECT name FROM tenants WHERE id = $1 LIMIT 1", [tid]
    );
    const orgName = rows[0]?.name || '';
    const body = `<div class="card">
      <h2 style="margin-bottom:20px">Organization Profile</h2>
      <form method="POST" action="/onboarding/step/1" enctype="multipart/form-data">
        <div class="form-group">
          <label>Organization Name *</label>
          <input type="text" name="org_name" value="${esc(orgName)}" required placeholder="e.g. Springfield Academy">
          <div class="hint">This will appear on your portal and communications</div>
        </div>
        <div class="form-group">
          <label>Organization Type</label>
          <select name="org_type">
            <option value="school">🏫 School / Academy</option>
            <option value="university">🎓 University</option>
            <option value="corporate">🏢 Corporate</option>
            <option value="nonprofit">💚 Non-Profit</option>
            <option value="government">🏛️ Government</option>
            <option value="healthcare">🏥 Healthcare</option>
            <option value="other">📋 Other</option>
          </select>
        </div>
        <div class="form-group">
          <label>Organization Logo</label>
          <div class="file-upload" onclick="this.querySelector('input').click()">
            <input type="file" name="logo" accept="image/*">
            <div style="font-size:32px;margin-bottom:8px">📁</div>
            <p>Click to upload logo (PNG, JPG, max 2MB)</p>
          </div>
        </div>
        <div class="form-group">
          <label>Organization Size</label>
          <select name="org_size">
            <option value="1-10">1–10 people</option>
            <option value="11-50">11–50 people</option>
            <option value="51-200">51–200 people</option>
            <option value="201-1000">201–1,000 people</option>
            <option value="1000+">1,000+ people</option>
          </select>
        </div>
        <div class="form-group">
          <label>Country</label>
          <input type="text" name="country" placeholder="e.g. Uganda">
        </div>
        <div class="actions">
          <a href="/onboarding" class="btn btn-secondary">← Back</a>
          <button type="submit" class="btn btn-primary">Save &amp; Continue →</button>
        </div>
      </form>
    </div>
    <div class="skip-link"><a href="/onboarding/skip">Skip onboarding</a></div>`;
    res.send(layout('Step 1 — Organization Profile', body, 1));
  }));

  /* ── POST /onboarding/step/1 — Save organization profile ──────── */
  app.post('/onboarding/step/1', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { org_name, org_type, org_size, country } = req.body;
    if (!org_name || !org_name.trim()) {
      return res.status(400).send(layout('Step 1 — Error', `<div class="card"><div class="alert alert-error">Organization name is required.</div>
        <a href="/onboarding/step/1" class="btn btn-primary">← Try Again</a></div>`, 1));
    }
    await pool.query(
      "UPDATE tenants SET name = $1, type = $2 WHERE id = $3",
      [org_name.trim(), org_type || 'school', tid]
    );
    await markStepComplete(tid, 1);
    audit(req, 'onboarding:step1:complete', { org_name: org_name.trim(), org_type, org_size });
    res.redirect('/onboarding/step/2');
  }));

  /* ── GET /onboarding/step/2 — Invite team members ─────────────── */
  app.get('/onboarding/step/2', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: invites} = await pool.query(
      "SELECT * FROM onboarding_invitations WHERE tenant_id = $1 ORDER BY sent_at DESC LIMIT 20", [tid]
    );
    const rows = invites.map(inv => `<tr>
      <td>${esc(inv.email)}</td>
      <td>${esc(inv.role)}</td>
      <td><span class="badge ${inv.accepted ? 'badge-accepted' : 'badge-pending'}">${inv.accepted ? 'Accepted' : 'Pending'}</span></td>
      <td>${esc(inv.sent_at?.toLocaleString?.() || '')}</td>
    </tr>`).join('');
    const body = `<div class="card">
      <h2 style="margin-bottom:8px">Invite Team Members 👥</h2>
      <p style="color:#6b7280;margin-bottom:20px">Add your colleagues to get started collaborating.</p>
      <form method="POST" action="/onboarding/step/2">
        <div id="invites-container">
          <div class="invite-row" style="display:grid;grid-template-columns:2fr 1fr auto;gap:8px;margin-bottom:8px;align-items:end">
            <div class="form-group" style="margin-bottom:0"><label>Email</label><input type="email" name="email[]" required placeholder="colleague@example.com"></div>
            <div class="form-group" style="margin-bottom:0"><label>Role</label><select name="role[]"><option value="admin">Admin</option><option value="member" selected>Member</option><option value="viewer">Viewer</option></select></div>
          </div>
        </div>
        <button type="button" onclick="addInviteRow()" class="btn btn-sm btn-secondary" style="margin-bottom:20px">+ Add Another</button>
        <div class="actions">
          <a href="/onboarding/step/1" class="btn btn-secondary">← Back</a>
          <button type="submit" class="btn btn-primary">Send Invitations →</button>
        </div>
      </form>
    </div>
    ${rows ? `<div class="card"><h3 style="margin-bottom:16px">Sent Invitations</h3>
      <div style="overflow-x:auto"><table><thead><tr><th>Email</th><th>Role</th><th>Status</th><th>Sent</th></tr></thead>
      <tbody>${rows}</tbody></table></div></div>` : ''}
    <div class="skip-link"><a href="/onboarding/skip">Skip for now</a></div>
    <script>
      function addInviteRow(){
        const c=document.getElementById('invites-container');
        const d=document.createElement('div');d.className='invite-row';
        d.style.cssText='display:grid;grid-template-columns:2fr 1fr auto;gap:8px;margin-bottom:8px;align-items:end';
        d.innerHTML='<div class="form-group" style="margin-bottom:0"><label>Email</label><input type="email" name="email[]" required placeholder="colleague@example.com"></div><div class="form-group" style="margin-bottom:0"><label>Role</label><select name="role[]"><option value="admin">Admin</option><option value="member" selected>Member</option><option value="viewer">Viewer</option></select></div><button type="button" onclick="this.parentElement.remove()" class="btn btn-sm btn-danger" style="height:42px;margin-bottom:0">✕</button>';
        c.appendChild(d);
      }
    </script>`;
    res.send(layout('Step 2 — Invite Team', body, 2));
  }));

  /* ── POST /onboarding/step/2 — Send invitations ───────────────── */
  app.post('/onboarding/step/2', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const userId = req.session.user.id;
    const emails = Array.isArray(req.body.email) ? req.body.email : [req.body.email];
    const roles = Array.isArray(req.body.role) ? req.body.role : [req.body.role];
    let sent = 0;
    for (let i = 0; i < emails.length; i++) {
      const email = (emails[i] || '').trim().toLowerCase();
      if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      const role = roles[i] || 'member';
      const {rows: existing} = await pool.query(
        "SELECT id FROM onboarding_invitations WHERE tenant_id=$1 AND email=$2", [tid, email]
      );
      if (existing.length) continue;
      const token = (await pool.query(
        "INSERT INTO onboarding_invitations (tenant_id, email, role, invited_by, token) VALUES ($1,$2,$3,$4,encode(gen_random_bytes(24),'hex')) RETURNING token",
        [tid, email, role, userId]
      )).rows[0].token;
      sent++;
      // In production: send email via SMTP with link /invite/accept?token=...
    }
    await markStepComplete(tid, 2);
    audit(req, 'onboarding:step2:complete', { invitations_sent: sent });
    res.redirect('/onboarding/step/3');
  }));

  /* ── GET /onboarding/step/3 — Portal settings ─────────────────── */
  app.get('/onboarding/step/3', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows} = await pool.query(
      "SELECT * FROM onboarding_settings WHERE tenant_id = $1", [tid]
    );
    const s = rows[0] || {};
    const features = ['dashboard','analytics','messaging','files','calendar','reports','api_access'];
    const featureChecks = features.map(f => {
      const checked = Array.isArray(s.features) && s.features.includes(f) ? 'checked' : '';
      return `<label style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-radius:8px;cursor:pointer;border:1px solid #e5e7eb;margin-bottom:6px">
        <input type="checkbox" name="features" value="${esc(f)}" ${checked}> ${esc(f.replace(/_/g,' ').replace(/\b\w/g,l=>l.toUpperCase()))}
      </label>`;
    }).join('');
    const body = `<div class="card">
      <h2 style="margin-bottom:8px">Portal Settings 🎨</h2>
      <p style="color:#6b7280;margin-bottom:20px">Customize the look and feel of your portal.</p>
      <form method="POST" action="/onboarding/step/3">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="form-group">
            <label>Primary Color</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="color" name="primary_color" value="${esc(s.primary_color||'#4F46E5')}" style="width:48px;height:42px;padding:2px;border:2px solid #e5e7eb;border-radius:8px;cursor:pointer">
              <input type="text" name="primary_color" value="${esc(s.primary_color||'#4F46E5')}" maxlength="7" style="width:120px">
            </div>
          </div>
          <div class="form-group">
            <label>Secondary Color</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="color" name="secondary_color" value="${esc(s.secondary_color||'#10B981')}" style="width:48px;height:42px;padding:2px;border:2px solid #e5e7eb;border-radius:8px;cursor:pointer">
              <input type="text" name="secondary_color" value="${esc(s.secondary_color||'#10B981')}" maxlength="7" style="width:120px">
            </div>
          </div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
          <div class="form-group">
            <label>Timezone</label>
            <select name="timezone">
              ${['UTC','Africa/Kampala','Africa/Nairobi','America/New_York','America/Los_Angeles','Europe/London','Asia/Tokyo','Asia/Dubai','Asia/Kolkata'].map(tz =>
                `<option value="${tz}" ${s.timezone===tz?'selected':''}>${tz}</option>`
              ).join('')}
            </select>
          </div>
          <div class="form-group">
            <label>Language</label>
            <select name="language">
              ${[['en','English'],['fr','French'],['es','Spanish'],['sw','Swahili'],['lg','Luganda'],['ar','Arabic']].map(([v,l]) =>
                `<option value="${v}" ${s.language===v?'selected':''}>${l}</option>`
              ).join('')}
            </select>
          </div>
        </div>
        <div class="form-group">
          <label>Enable Features</label>
          ${featureChecks}
        </div>
        <div class="actions">
          <a href="/onboarding/step/2" class="btn btn-secondary">← Back</a>
          <button type="submit" class="btn btn-primary">Save &amp; Continue →</button>
        </div>
      </form>
    </div>
    <div class="skip-link"><a href="/onboarding/skip">Skip for now</a></div>`;
    res.send(layout('Step 3 — Portal Settings', body, 3));
  }));

  /* ── POST /onboarding/step/3 — Save portal settings ───────────── */
  app.post('/onboarding/step/3', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { primary_color, secondary_color, timezone, language } = req.body;
    const features = Array.isArray(req.body.features) ? req.body.features : (req.body.features ? [req.body.features] : []);
    await pool.query(`
      INSERT INTO onboarding_settings (tenant_id, primary_color, secondary_color, timezone, language, features)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (tenant_id) DO UPDATE SET
        primary_color = EXCLUDED.primary_color,
        secondary_color = EXCLUDED.secondary_color,
        timezone = EXCLUDED.timezone,
        language = EXCLUDED.language,
        features = EXCLUDED.features
    `, [tid, primary_color || '#4F46E5', secondary_color || '#10B981', timezone || 'UTC', language || 'en', features]);
    await markStepComplete(tid, 3);
    audit(req, 'onboarding:step3:complete', { primary_color, timezone, language, feature_count: features.length });
    res.redirect('/onboarding/step/4');
  }));

  /* ── GET /onboarding/step/4 — Import data ─────────────────────── */
  app.get('/onboarding/step/4', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: imports} = await pool.query(
      "SELECT * FROM data_imports WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10", [tid]
    );
    const importRows = imports.map(imp => `<tr>
      <td>${esc(imp.filename || '—')}</td>
      <td>${esc(imp.import_type || '—')}</td>
      <td>${esc(imp.status || '—')}</td>
      <td>${imp.rows_processed || 0} rows</td>
      <td>${esc(imp.created_at?.toLocaleString?.() || '')}</td>
    </tr>`).join('');
    const body = `<div class="card">
      <h2 style="margin-bottom:8px">Import Data 📊</h2>
      <p style="color:#6b7280;margin-bottom:20px">Upload CSV files to import existing data into your portal.</p>
      <form method="POST" action="/onboarding/step/4" enctype="multipart/form-data">
        <div class="form-group">
          <label>Data Type</label>
          <select name="import_type">
            <option value="users">Users / Members</option>
            <option value="students">Students</option>
            <option value="staff">Staff</option>
            <option value="courses">Courses</option>
            <option value="contacts">Contacts</option>
          </select>
        </div>
        <div class="form-group">
          <label>CSV File *</label>
          <div class="file-upload" onclick="this.querySelector('input').click()">
            <input type="file" name="csvfile" accept=".csv,.txt" required id="csv-input">
            <div style="font-size:32px;margin-bottom:8px">📄</div>
            <p id="file-name">Click to upload CSV file</p>
          </div>
        </div>
        <div class="alert alert-info">
          <strong>💡 Tip:</strong> Your CSV should have headers in the first row. Required fields vary by type.
          <a href="#" onclick="alert('Users: name, email, role\\nStudents: name, email, grade, class\\nStaff: name, email, department, title')" style="color:#4F46E5">View format guide</a>
        </div>
        <div class="actions">
          <a href="/onboarding/step/3" class="btn btn-secondary">← Back</a>
          <button type="submit" class="btn btn-primary">Import Data →</button>
        </div>
      </form>
    </div>
    ${importRows ? `<div class="card"><h3 style="margin-bottom:16px">Recent Imports</h3>
      <div style="overflow-x:auto"><table><thead><tr><th>File</th><th>Type</th><th>Status</th><th>Rows</th><th>Date</th></tr></thead>
      <tbody>${importRows}</tbody></table></div></div>` : ''}
    <div class="skip-link"><a href="/onboarding/skip">Skip for now</a></div>
    <script>
      document.getElementById('csv-input').addEventListener('change',function(e){
        const f=e.target.files[0];document.getElementById('file-name').textContent=f?f.name:'Click to upload CSV file';
      });
    </script>`;
    res.send(layout('Step 4 — Import Data', body, 4));
  }));

  /* ── POST /onboarding/step/4 — Process import ─────────────────── */
  app.post('/onboarding/step/4', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const importType = req.body.import_type || 'users';
    if (!req.file && !req.body.csvfile) {
      // Simple CSV text fallback
      await markStepComplete(tid, 4);
      audit(req, 'onboarding:step4:complete', { import_type: importType, rows: 0 });
      return res.redirect('/onboarding/complete');
    }
    // In production: parse CSV file, validate rows, bulk insert
    const rowsProcessed = 0; // placeholder
    try {
      await pool.query(`
        INSERT INTO data_imports (tenant_id, import_type, filename, status, rows_processed)
        VALUES ($1, $2, $3, 'pending', $4)
      `, [tid, importType, req.file?.originalname || 'upload.csv', rowsProcessed]);
    } catch(e) { /* data_imports table may not exist — ignore */ }
    await markStepComplete(tid, 4);
    audit(req, 'onboarding:step4:complete', { import_type: importType });
    res.redirect('/onboarding/complete');
  }));

  /* ── GET /onboarding/complete — Celebration page ──────────────── */
  app.get('/onboarding/complete', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const prog = await getProgress(tid);
    const userName = req.session.user?.name || 'there';
    const body = `<div class="celebration">
      <div class="confetti">🎊🎉🎊</div>
      <h2>You're All Set!</h2>
      <p style="font-size:18px;color:#6b7280;margin-bottom:24px">Welcome aboard, ${esc(userName)}! Your organization is configured and ready.</p>
      <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:32px">
        <div class="card" style="padding:20px;text-align:center;flex:1;min-width:140px">
          <div style="font-size:32px;margin-bottom:4px">📊</div>
          <div style="font-weight:600">Dashboard</div>
          <div style="color:#6b7280;font-size:13px">View analytics</div>
        </div>
        <div class="card" style="padding:20px;text-align:center;flex:1;min-width:140px">
          <div style="font-size:32px;margin-bottom:4px">👥</div>
          <div style="font-weight:600">Team</div>
          <div style="color:#6b7280;font-size:13px">Manage members</div>
        </div>
        <div class="card" style="padding:20px;text-align:center;flex:1;min-width:140px">
          <div style="font-size:32px;margin-bottom:4px">⚙️</div>
          <div style="font-weight:600">Settings</div>
          <div style="color:#6b7280;font-size:13px">Configure portal</div>
        </div>
      </div>
      <div style="display:flex;gap:12px;justify-content:center">
        <a href="/dashboard" class="btn btn-primary" style="font-size:16px;padding:14px 36px">Go to Dashboard →</a>
        <a href="/onboarding/step/1" class="btn btn-secondary">Redo Setup</a>
      </div>
      ${!prog.completed_at ? '<div class="alert alert-info" style="max-width:400px;margin:20px auto 0">Some steps were skipped. You can complete them later from Settings.</div>' : ''}
    </div>`;
    res.send(layout('Setup Complete!', body, 5));
  }));

  /* ── GET /onboarding/skip — Skip onboarding ───────────────────── */
  app.get('/onboarding/skip', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query(
      "UPDATE onboarding_progress SET completed_at = NOW() WHERE tenant_id = $1", [tid]
    );
    audit(req, 'onboarding:skip');
    res.redirect('/dashboard');
  }));

  /* ── GET /onboarding/status — JSON status check ───────────────── */
  app.get('/onboarding/status', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const prog = await getProgress(tid);
    const {rows: invites} = await pool.query(
      "SELECT COUNT(*) as total, COUNT(*) FILTER (WHERE accepted) as accepted FROM onboarding_invitations WHERE tenant_id=$1", [tid]
    );
    const {rows: settings} = await pool.query(
      "SELECT EXISTS(SELECT 1 FROM onboarding_settings WHERE tenant_id=$1) as has_settings", [tid]
    );
    res.json({
      current_step: prog.current_step,
      completed_steps: prog.completed_steps || [],
      completed: !!prog.completed_at,
      total_invitations: parseInt(invites[0]?.total) || 0,
      accepted_invitations: parseInt(invites[0]?.accepted) || 0,
      has_settings: !!settings[0]?.has_settings,
      started_at: prog.started_at,
      completed_at: prog.completed_at
    });
  }));

  console.log('[routes] onboarding-routes.js loaded');
};
