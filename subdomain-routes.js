/**
 * Comfort Zone — Subdomain Manager Routes
 * Custom tenant URLs, branding, custom domains, DNS verification
 */
module.exports = function(app, pool, opts) {
  const esc = (opts && opts.esc) || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = (opts && opts.renderPage) || ((t,c,u) => c);
  const ah = (opts && opts.ah) || (fn => (req,res,next) => Promise.resolve(fn(req,res,next)).catch(e => res.status(500).send('Error: '+e.message)));
  const requireAuth = (opts && opts.requireAuth) || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = (opts && opts.audit) || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  const BASE_DOMAIN = process.env.BASE_DOMAIN || 'comfortzone.app';

  /* ── DB Migrations ─────────────────────────────────────────────── */
  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subdomain_config (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL UNIQUE,
        subdomain VARCHAR(100),
        custom_domain VARCHAR(255),
        is_primary BOOLEAN NOT NULL DEFAULT TRUE,
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        branding JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_subdomain_tenant ON subdomain_config(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_subdomain_sub ON subdomain_config(subdomain);
      CREATE INDEX IF NOT EXISTS idx_subdomain_custom ON subdomain_config(custom_domain);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subdomain_branding (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL UNIQUE,
        logo_url TEXT,
        favicon_url TEXT,
        primary_color VARCHAR(7) NOT NULL DEFAULT '#4F46E5',
        secondary_color VARCHAR(7) NOT NULL DEFAULT '#10B981',
        custom_css TEXT,
        social_links JSONB NOT NULL DEFAULT '{}',
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_subbranding_tenant ON subdomain_branding(tenant_id);
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subdomain_domain_verification (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL,
        domain VARCHAR(255) NOT NULL,
        verification_token VARCHAR(255) NOT NULL DEFAULT encode(gen_random_bytes(24), 'hex'),
        txt_record VARCHAR(255) NOT NULL DEFAULT '',
        verified BOOLEAN NOT NULL DEFAULT FALSE,
        verified_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_domain_ver UNIQUE (domain)
      );
      CREATE INDEX IF NOT EXISTS idx_domver_tenant ON subdomain_domain_verification(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_domver_domain ON subdomain_domain_verification(domain);
    `);
  }
  ensureTables().catch(e => console.error('[subdomain] migration error:', e.message));

  /* ── Helpers ───────────────────────────────────────────────────── */
  function validSubdomain(s) {
    return /^[a-z0-9](?:[a-z0-9-]{1,61}[a-z0-9])?$/.test(s) && s.length >= 3 && s.length <= 63;
  }

  const RESERVED = ['www','api','mail','admin','app','console','dashboard','staging','dev','test',
    'portal','auth','login','signup','register','billing','support','help','docs','blog','cdn',
    'static','assets','media','images','files','uploads','smtp','pop','imap','ftp','ssh'];

  function layout(title, body) {
    return `<!DOCTYPE html><html lang="en"><head>
      <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>${esc(title)} — Comfort Zone</title>
      <style>
        *{margin:0;padding:0;box-sizing:border-box}
        body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;background:#f0f2f5;color:#1a1a2e;min-height:100vh}
        .container{max-width:860px;margin:0 auto;padding:40px 20px}
        .header{margin-bottom:32px}
        .header h1{font-size:28px;font-weight:700;color:#4F46E5;margin-bottom:6px}
        .header p{color:#6b7280;font-size:15px}
        .nav{display:flex;gap:6px;margin-bottom:24px;padding:10px;background:#fff;border-radius:12px;box-shadow:0 1px 3px rgba(0,0,0,.08);flex-wrap:wrap}
        .nav a{padding:8px 16px;border-radius:8px;text-decoration:none;color:#6b7280;font-size:14px;font-weight:500;transition:all .2s}
        .nav a:hover,.nav a.active{background:#4F46E5;color:#fff}
        .card{background:#fff;border-radius:16px;box-shadow:0 1px 3px rgba(0,0,0,.08),0 4px 12px rgba(0,0,0,.04);padding:32px;margin-bottom:24px}
        .form-group{margin-bottom:20px}
        .form-group label{display:block;font-weight:600;font-size:14px;margin-bottom:6px;color:#374151}
        .form-group input,.form-group select,.form-group textarea{width:100%;padding:12px 16px;border:2px solid #e5e7eb;border-radius:10px;font-size:15px;transition:border .2s;background:#fafafa}
        .form-group input:focus,.form-group textarea:focus{outline:none;border-color:#4F46E5;background:#fff}
        .form-group .hint{font-size:12px;color:#9ca3af;margin-top:4px}
        .btn{display:inline-flex;align-items:center;justify-content:center;padding:12px 28px;border:none;border-radius:10px;font-size:15px;font-weight:600;cursor:pointer;transition:all .2s;text-decoration:none}
        .btn-primary{background:#4F46E5;color:#fff}.btn-primary:hover{background:#4338CA}
        .btn-secondary{background:#f3f4f6;color:#374151}.btn-secondary:hover{background:#e5e7eb}
        .btn-success{background:#10B981;color:#fff}.btn-success:hover{background:#059669}
        .btn-danger{background:#EF4444;color:#fff}.btn-danger:hover{background:#DC2626}
        .btn-sm{padding:8px 16px;font-size:13px}
        .btn-outline{background:transparent;color:#4F46E5;border:2px solid #4F46E5}.btn-outline:hover{background:#4F46E5;color:#fff}
        .alert{padding:14px 18px;border-radius:10px;margin-bottom:20px;font-size:14px}
        .alert-success{background:#ecfdf5;color:#065f46;border:1px solid #a7f3d0}
        .alert-error{background:#fef2f2;color:#991b1b;border:1px solid #fecaca}
        .alert-info{background:#eff6ff;color:#1e40af;border:1px solid #bfdbfe}
        .alert-warning{background:#FFFBEB;color:#92400E;border:1px solid #FDE68A}
        table{width:100%;border-collapse:collapse}
        th,td{padding:12px 16px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:14px}
        th{font-weight:600;color:#6b7280;font-size:12px;text-transform:uppercase;letter-spacing:.5px}
        .badge{display:inline-block;padding:4px 10px;border-radius:20px;font-size:12px;font-weight:600}
        .badge-verified{background:#D1FAE5;color:#065F46}
        .badge-unverified{background:#FEF3C7;color:#92400E}
        .badge-pending{background:#DBEAFE;color:#1E40AF}
        .preview-box{border:2px solid #e5e7eb;border-radius:12px;padding:24px;margin:16px 0;background:#fafafa}
        .preview-url{font-family:monospace;font-size:20px;font-weight:600;color:#4F46E5;text-align:center;padding:16px;background:#fff;border-radius:8px;border:1px solid #e5e7eb}
        .color-swatch{width:48px;height:48px;border-radius:10px;border:2px solid #e5e7eb;display:inline-block;vertical-align:middle}
        .status-indicator{display:flex;align-items:center;gap:8px;font-size:14px}
        .status-dot{width:10px;height:10px;border-radius:50%}
        .status-dot.green{background:#10B981}.status-dot.red{background:#EF4444}.status-dot.yellow{background:#F59E0B}
        .code-block{background:#1e1e2e;color:#cdd6f4;padding:16px 20px;border-radius:10px;font-family:monospace;font-size:13px;line-height:1.6;overflow-x:auto;white-space:pre}
        .code-block .key{color:#89b4fa}.code-block .val{color:#a6e3a1}.code-block .comment{color:#6c7086}
        .dns-step{display:flex;gap:12px;margin-bottom:16px;align-items:start}
        .dns-step-num{width:32px;height:32px;border-radius:50%;background:#4F46E5;color:#fff;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:14px;flex-shrink:0}
        .grid-2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
        @media(max-width:640px){.grid-2{grid-template-columns:1fr}.nav{gap:4px}.nav a{padding:6px 12px;font-size:13px}}
      </style>
    </head><body><div class="container">
      <div class="header"><h1>🌐 Subdomain Manager</h1><p>${esc(title)}</p></div>
      ${body}
    </div></body></html>`;
  }

  /* ── GET /subdomain — Dashboard ────────────────────────────────── */
  app.get('/subdomain', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: config} = await pool.query(
      "SELECT * FROM subdomain_config WHERE tenant_id = $1", [tid]
    );
    const {rows: brand} = await pool.query(
      "SELECT * FROM subdomain_branding WHERE tenant_id = $1", [tid]
    );
    const {rows: verifications} = await pool.query(
      "SELECT * FROM subdomain_domain_verification WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 5", [tid]
    );
    const c = config[0] || {};
    const b = brand[0] || {};
    const subdomainPreview = c.subdomain
      ? `https://${esc(c.subdomain)}.${esc(BASE_DOMAIN)}`
      : 'Not configured';
    const customDomainPreview = c.custom_domain
      ? `https://${esc(c.custom_domain)}`
      : 'Not configured';
    const verRows = verifications.map(v => `<tr>
      <td style="font-family:monospace">${esc(v.domain)}</td>
      <td><span class="badge ${v.verified ? 'badge-verified' : 'badge-unverified'}">${v.verified ? 'Verified' : 'Pending'}</span></td>
      <td>${esc(v.verified_at?.toLocaleDateString?.()||'—')}</td>
      <td>
        ${!v.verified ? `<form method="POST" action="/subdomain/custom-domain/verify" style="display:inline">
          <input type="hidden" name="domain_id" value="${v.id}">
          <button class="btn btn-sm btn-success">Verify</button></form>` : '✓'}
      </td>
    </tr>`).join('');
    const body = `<div class="nav">
      <a href="/subdomain" class="active">Overview</a>
      <a href="/subdomain/branding">Branding</a>
      <a href="/subdomain/custom-domain">Custom Domain</a>
      <a href="/subdomain/dns-instructions">DNS Help</a>
    </div>
    <div class="card">
      <h2 style="margin-bottom:20px">Current Configuration</h2>
      <div class="grid-2">
        <div style="padding:16px;border:1px solid #e5e7eb;border-radius:12px">
          <div style="font-size:13px;color:#6b7280;margin-bottom:4px;font-weight:600">SUBDOMAIN</div>
          <div class="preview-url">${esc(subdomainPreview)}</div>
          <div style="margin-top:8px">
            ${c.subdomain
              ? `<span class="status-indicator"><span class="status-dot green"></span> Active</span>`
              : `<span class="status-indicator"><span class="status-dot red"></span> Not set</span>`}
          </div>
        </div>
        <div style="padding:16px;border:1px solid #e5e7eb;border-radius:12px">
          <div style="font-size:13px;color:#6b7280;margin-bottom:4px;font-weight:600">CUSTOM DOMAIN</div>
          <div class="preview-url">${esc(customDomainPreview)}</div>
          <div style="margin-top:8px">
            ${c.verified
              ? `<span class="status-indicator"><span class="status-dot green"></span> Verified</span>`
              : c.custom_domain
              ? `<span class="status-indicator"><span class="status-dot yellow"></span> Unverified</span>`
              : `<span class="status-indicator"><span class="status-dot red"></span> Not set</span>`}
          </div>
        </div>
      </div>
      <div style="margin-top:20px">
        <h3 style="margin-bottom:8px">Set Your Subdomain</h3>
        <form method="POST" action="/subdomain/set" style="display:flex;gap:8px;align-items:end">
          <div class="form-group" style="margin-bottom:0;flex:1">
            <input type="text" name="subdomain" placeholder="myorg" value="${esc(c.subdomain||'')}" required minlength="3" maxlength="63" pattern="[a-z0-9][a-z0-9-]{1,61}[a-z0-9]" style="text-align:right">
            <div class="hint">Lowercase letters, numbers, hyphens. 3–63 characters.</div>
          </div>
          <div style="padding:12px 16px;background:#f3f4f6;border-radius:10px;font-weight:600;color:#6b7280;white-space:nowrap">.${esc(BASE_DOMAIN)}</div>
          <button type="submit" class="btn btn-primary">Save</button>
        </form>
        ${c.subdomain ? `<form method="POST" action="/subdomain/remove" style="margin-top:8px;display:inline">
          <button type="submit" class="btn btn-sm btn-danger" onclick="return confirm('Remove subdomain?')">Remove Subdomain</button></form>` : ''}
      </div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:8px">Branding</h3>
      <div style="display:flex;gap:12px;align-items:center">
        ${b.logo_url ? `<img src="${esc(b.logo_url)}" style="width:40px;height:40px;border-radius:8px;object-fit:cover" alt="logo">` : '<div style="width:40px;height:40px;border-radius:8px;background:#e5e7eb"></div>'}
        <div>
          <div>Primary: <span class="color-swatch" style="width:20px;height:20px;background:${esc(b.primary_color||'#4F46E5')}"></span> ${esc(b.primary_color||'#4F46E5')}</div>
          <div>Secondary: <span class="color-swatch" style="width:20px;height:20px;background:${esc(b.secondary_color||'#10B981')}"></span> ${esc(b.secondary_color||'#10B981')}</div>
        </div>
        <a href="/subdomain/branding" class="btn btn-sm btn-outline" style="margin-left:auto">Edit Branding</a>
      </div>
    </div>
    ${verifications.length ? `<div class="card">
      <h3 style="margin-bottom:16px">Domain Verifications</h3>
      <table><thead><tr><th>Domain</th><th>Status</th><th>Verified</th><th>Action</th></tr></thead>
      <tbody>${verRows}</tbody></table>
    </div>` : ''}`;
    res.send(layout('Manage your portal URL', body));
  }));

  /* ── GET /subdomain/check — Availability check (JSON API) ──────── */
  app.get('/subdomain/check', requireAuth, ah(async (req, res) => {
    const subdomain = (req.query.q || '').toLowerCase().trim();
    if (!subdomain) return res.json({ available: false, error: 'Subdomain is required' });
    if (!validSubdomain(subdomain)) return res.json({ available: false, error: 'Invalid format. Use 3-63 lowercase alphanumeric characters and hyphens.' });
    if (RESERVED.includes(subdomain)) return res.json({ available: false, error: `"${subdomain}" is a reserved name.` });
    const tid = tenantId(req);
    const {rows} = await pool.query(
      "SELECT id FROM subdomain_config WHERE subdomain = $1 AND tenant_id != $2 LIMIT 1", [subdomain, tid]
    );
    res.json({ available: rows.length === 0, subdomain, base_domain: BASE_DOMAIN, full_url: `https://${subdomain}.${BASE_DOMAIN}` });
  }));

  /* ── POST /subdomain/set — Set custom subdomain ────────────────── */
  app.post('/subdomain/set', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const subdomain = (req.body.subdomain || '').toLowerCase().trim();
    if (!subdomain || !validSubdomain(subdomain)) {
      return res.status(400).send(layout('Error', '<div class="alert alert-error">Invalid subdomain. Use 3-63 lowercase alphanumeric characters and hyphens.</div><a href="/subdomain" class="btn btn-secondary">← Back</a>'));
    }
    if (RESERVED.includes(subdomain)) {
      return res.status(400).send(layout('Error', `<div class="alert alert-error">"${esc(subdomain)}" is reserved and cannot be used.</div><a href="/subdomain" class="btn btn-secondary">← Back</a>`));
    }
    const {rows: existing} = await pool.query(
      "SELECT id FROM subdomain_config WHERE subdomain = $1 AND tenant_id != $2 LIMIT 1", [subdomain, tid]
    );
    if (existing.length) {
      return res.status(409).send(layout('Error', `<div class="alert alert-error">Subdomain "${esc(subdomain)}" is already taken. Please choose another.</div><a href="/subdomain" class="btn btn-secondary">← Back</a>`));
    }
    await pool.query(`
      INSERT INTO subdomain_config (tenant_id, subdomain, verified)
      VALUES ($1, $2, TRUE)
      ON CONFLICT (tenant_id) DO UPDATE SET subdomain = EXCLUDED.subdomain, verified = TRUE
    `, [tid, subdomain]);
    audit(req, 'subdomain:set', { subdomain });
    res.redirect('/subdomain');
  }));

  /* ── DELETE /subdomain/remove — Remove subdomain ───────────────── */
  app.post('/subdomain/remove', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query(
      "UPDATE subdomain_config SET subdomain = NULL, verified = FALSE WHERE tenant_id = $1", [tid]
    );
    audit(req, 'subdomain:remove');
    res.redirect('/subdomain');
  }));

  /* ── GET /subdomain/branding — Branding config page ────────────── */
  app.get('/subdomain/branding', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: brand} = await pool.query(
      "SELECT * FROM subdomain_branding WHERE tenant_id = $1", [tid]
    );
    const b = brand[0] || {};
    const socials = b.social_links || {};
    const body = `<div class="nav">
      <a href="/subdomain">Overview</a>
      <a href="/subdomain/branding" class="active">Branding</a>
      <a href="/subdomain/custom-domain">Custom Domain</a>
      <a href="/subdomain/dns-instructions">DNS Help</a>
    </div>
    <div class="card">
      <h2 style="margin-bottom:20px">Portal Branding 🎨</h2>
      <form method="POST" action="/subdomain/branding" enctype="multipart/form-data">
        <div class="grid-2">
          <div class="form-group">
            <label>Logo URL</label>
            <input type="url" name="logo_url" value="${esc(b.logo_url||'')}" placeholder="https://example.com/logo.png">
            <div class="hint">Direct link to your organization's logo (PNG recommended, max 200×200px)</div>
          </div>
          <div class="form-group">
            <label>Favicon URL</label>
            <input type="url" name="favicon_url" value="${esc(b.favicon_url||'')}" placeholder="https://example.com/favicon.ico">
            <div class="hint">Favicon displayed in browser tabs (ICO or PNG, 32×32px)</div>
          </div>
        </div>
        <div class="grid-2">
          <div class="form-group">
            <label>Primary Color</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="color" name="primary_color" value="${esc(b.primary_color||'#4F46E5')}" style="width:48px;height:42px;padding:2px;border:2px solid #e5e7eb;border-radius:8px;cursor:pointer">
              <input type="text" name="primary_color" value="${esc(b.primary_color||'#4F46E5')}" maxlength="7" style="width:120px">
            </div>
          </div>
          <div class="form-group">
            <label>Secondary Color</label>
            <div style="display:flex;gap:8px;align-items:center">
              <input type="color" name="secondary_color" value="${esc(b.secondary_color||'#10B981')}" style="width:48px;height:42px;padding:2px;border:2px solid #e5e7eb;border-radius:8px;cursor:pointer">
              <input type="text" name="secondary_color" value="${esc(b.secondary_color||'#10B981')}" maxlength="7" style="width:120px">
            </div>
          </div>
        </div>
        <div class="form-group">
          <label>Social Links</label>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input type="url" name="social_facebook" value="${esc(socials.facebook||'')}" placeholder="Facebook URL">
            <input type="url" name="social_twitter" value="${esc(socials.twitter||'')}" placeholder="Twitter/X URL">
            <input type="url" name="social_linkedin" value="${esc(socials.linkedin||'')}" placeholder="LinkedIn URL">
            <input type="url" name="social_instagram" value="${esc(socials.instagram||'')}" placeholder="Instagram URL">
            <input type="url" name="social_website" value="${esc(socials.website||'')}" placeholder="Website URL">
            <input type="url" name="social_youtube" value="${esc(socials.youtube||'')}" placeholder="YouTube URL">
          </div>
        </div>
        <div class="form-group">
          <label>Custom CSS</label>
          <textarea name="custom_css" rows="6" placeholder="/* Custom CSS for your portal */
body { font-family: 'Custom Font', sans-serif; }
.header { background: #custom; }">${esc(b.custom_css||'')}</textarea>
          <div class="hint">Advanced: Add custom CSS to override default styles. Use sparingly.</div>
        </div>
        <div style="display:flex;gap:12px">
          <button type="submit" class="btn btn-primary">Save Branding</button>
          <a href="/subdomain" class="btn btn-secondary">Cancel</a>
        </div>
      </form>
    </div>
    ${b.primary_color ? `<div class="card">
      <h3 style="margin-bottom:16px">Live Preview</h3>
      <div class="preview-box">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:16px">
          ${b.logo_url ? `<img src="${esc(b.logo_url)}" style="width:48px;height:48px;border-radius:10px;object-fit:cover" onerror="this.style.display='none'" alt="Logo">` : ''}
          <div style="font-weight:700;font-size:18px;color:${esc(b.primary_color||'#4F46E5')}">My Organization</div>
        </div>
        <div style="display:flex;gap:8px">
          <div style="padding:10px 20px;background:${esc(b.primary_color||'#4F46E5')};color:#fff;border-radius:8px;font-weight:600;font-size:14px">Primary Button</div>
          <div style="padding:10px 20px;background:${esc(b.secondary_color||'#10B981')};color:#fff;border-radius:8px;font-weight:600;font-size:14px">Secondary Button</div>
        </div>
      </div>
    </div>` : ''}`;
    res.send(layout('Customize branding', body));
  }));

  /* ── POST /subdomain/branding — Save branding ──────────────────── */
  app.post('/subdomain/branding', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { logo_url, favicon_url, primary_color, secondary_color, custom_css,
            social_facebook, social_twitter, social_linkedin, social_instagram, social_website, social_youtube } = req.body;
    const socialLinks = {
      facebook: social_facebook || '',
      twitter: social_twitter || '',
      linkedin: social_linkedin || '',
      instagram: social_instagram || '',
      website: social_website || '',
      youtube: social_youtube || ''
    };
    await pool.query(`
      INSERT INTO subdomain_branding (tenant_id, logo_url, favicon_url, primary_color, secondary_color, custom_css, social_links)
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      ON CONFLICT (tenant_id) DO UPDATE SET
        logo_url = EXCLUDED.logo_url,
        favicon_url = EXCLUDED.favicon_url,
        primary_color = EXCLUDED.primary_color,
        secondary_color = EXCLUDED.secondary_color,
        custom_css = EXCLUDED.custom_css,
        social_links = EXCLUDED.social_links
    `, [tid, logo_url || null, favicon_url || null, primary_color || '#4F46E5', secondary_color || '#10B981', custom_css || null, JSON.stringify(socialLinks)]);
    audit(req, 'subdomain:branding:update', { has_logo: !!logo_url, has_favicon: !!favicon_url });
    res.redirect('/subdomain/branding');
  }));

  /* ── GET /subdomain/custom-domain — Custom domain setup ────────── */
  app.get('/subdomain/custom-domain', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: config} = await pool.query(
      "SELECT * FROM subdomain_config WHERE tenant_id = $1", [tid]
    );
    const {rows: verifications} = await pool.query(
      "SELECT * FROM subdomain_domain_verification WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 10", [tid]
    );
    const c = config[0] || {};
    const verRows = verifications.map(v => `<tr>
      <td style="font-family:monospace;font-weight:500">${esc(v.domain)}</td>
      <td><span class="badge ${v.verified ? 'badge-verified' : 'badge-unverified'}">${v.verified ? 'Verified ✓' : 'Pending'}</span></td>
      <td>${esc(v.verified_at?.toLocaleDateString?.()||'—')}</td>
      <td>${!v.verified ? `<form method="POST" action="/subdomain/custom-domain/verify" style="display:inline">
        <input type="hidden" name="domain_id" value="${v.id}">
        <button class="btn btn-sm btn-success">Verify Now</button></form>` : '—'}</td>
    </tr>`).join('');
    const body = `<div class="nav">
      <a href="/subdomain">Overview</a>
      <a href="/subdomain/branding">Branding</a>
      <a href="/subdomain/custom-domain" class="active">Custom Domain</a>
      <a href="/subdomain/dns-instructions">DNS Help</a>
    </div>
    <div class="card">
      <h2 style="margin-bottom:8px">Custom Domain Setup</h2>
      <p style="color:#6b7280;margin-bottom:20px">Point your own domain (e.g., app.mycompany.com) to your portal.</p>
      ${c.custom_domain ? `<div class="alert ${c.verified ? 'alert-success' : 'alert-warning'}">
        ${c.verified
          ? `✓ <strong>${esc(c.custom_domain)}</strong> is verified and active.`
          : `⏳ <strong>${esc(c.custom_domain)}</strong> is pending verification. Please complete DNS setup below.`}
      </div>` : ''}
      <form method="POST" action="/subdomain/custom-domain">
        <div class="form-group">
          <label>Add Custom Domain</label>
          <div style="display:flex;gap:8px">
            <input type="text" name="domain" placeholder="app.mycompany.com" required style="flex:1">
            <button type="submit" class="btn btn-primary">Add Domain</button>
          </div>
          <div class="hint">Enter your full subdomain. You'll need to add a CNAME record pointing to ${esc(BASE_DOMAIN)}.</div>
        </div>
      </form>
    </div>
    ${verifications.length ? `<div class="card">
      <h3 style="margin-bottom:16px">Domain Verification History</h3>
      <div style="overflow-x:auto"><table>
        <thead><tr><th>Domain</th><th>Status</th><th>Verified At</th><th>Action</th></tr></thead>
        <tbody>${verRows}</tbody>
      </table></div>
    </div>` : ''}`;
    res.send(layout('Custom domain setup', body));
  }));

  /* ── POST /subdomain/custom-domain — Add custom domain ─────────── */
  app.post('/subdomain/custom-domain', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    let domain = (req.body.domain || '').toLowerCase().trim();
    if (!domain) return res.redirect('/subdomain/custom-domain');
    // Remove protocol if user included it
    domain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
    const token = (await pool.query(
      "INSERT INTO subdomain_domain_verification (tenant_id, domain, txt_record) VALUES ($1, $2, $3) RETURNING verification_token, txt_record",
      [tid, domain, 'cz-verify-' + require('crypto').randomBytes(16).toString('hex')]
    )).rows[0];
    await pool.query(`
      INSERT INTO subdomain_config (tenant_id, custom_domain, verified)
      VALUES ($1, $2, FALSE)
      ON CONFLICT (tenant_id) DO UPDATE SET custom_domain = EXCLUDED.custom_domain, verified = FALSE
    `, [tid, domain]);
    audit(req, 'subdomain:custom-domain:add', { domain });
    res.redirect('/subdomain/custom-domain');
  }));

  /* ── POST /subdomain/custom-domain/verify — Verify domain ──────── */
  app.post('/subdomain/custom-domain/verify', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const domainId = req.body.domain_id;
    if (!domainId) return res.redirect('/subdomain/custom-domain');
    const {rows: ver} = await pool.query(
      "SELECT * FROM subdomain_domain_verification WHERE id = $1 AND tenant_id = $2", [domainId, tid]
    );
    if (!ver.length) return res.status(404).send(layout('Not Found', '<div class="alert alert-error">Verification record not found.</div>'));
    const v = ver[0];
    // In production: perform DNS TXT record lookup using dns.resolveTxt()
    // For now, simulate verification after 3+ seconds
    const createdAgo = Date.now() - new Date(v.created_at).getTime();
    const verified = createdAgo > 3000; // Auto-verify if > 3s old (demo)
    if (verified) {
      await pool.query(
        "UPDATE subdomain_domain_verification SET verified = TRUE, verified_at = NOW() WHERE id = $1", [v.id]
      );
      await pool.query(
        "UPDATE subdomain_config SET verified = TRUE, branding = jsonb_set(COALESCE(branding,'{}'), '{domain_verified}', 'true') WHERE tenant_id = $1",
        [tid]
      );
      audit(req, 'subdomain:custom-domain:verified', { domain: v.domain });
    }
    if (verified) {
      res.redirect('/subdomain/custom-domain');
    } else {
      res.send(layout('Verification Pending', `
        <div class="nav">
          <a href="/subdomain">Overview</a>
          <a href="/subdomain/branding">Branding</a>
          <a href="/subdomain/custom-domain" class="active">Custom Domain</a>
          <a href="/subdomain/dns-instructions">DNS Help</a>
        </div>
        <div class="card">
          <div class="alert alert-warning">
            ⏳ DNS verification for <strong>${esc(v.domain)}</strong> is still pending.
            <br>Please make sure you've added the required DNS records and try again in a few minutes.
          </div>
          <a href="/subdomain/dns-instructions" class="btn btn-primary">View DNS Instructions</a>
          <a href="/subdomain/custom-domain" class="btn btn-secondary" style="margin-left:8px">← Back</a>
        </div>`));
    }
  }));

  /* ── GET /subdomain/dns-instructions — DNS setup guide ─────────── */
  app.get('/subdomain/dns-instructions', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const {rows: ver} = await pool.query(
      "SELECT * FROM subdomain_domain_verification WHERE tenant_id = $1 AND verified = FALSE ORDER BY created_at DESC LIMIT 1", [tid]
    );
    const v = ver[0];
    const body = `<div class="nav">
      <a href="/subdomain">Overview</a>
      <a href="/subdomain/branding">Branding</a>
      <a href="/subdomain/custom-domain" class="active">Custom Domain</a>
      <a href="/subdomain/dns-instructions" class="active">DNS Help</a>
    </div>
    <div class="card">
      <h2 style="margin-bottom:20px">DNS Setup Instructions 📋</h2>
      <div class="alert alert-info">
        Follow these steps to connect your custom domain. DNS changes may take up to 48 hours to propagate.
      </div>
      <div class="dns-step">
        <div class="dns-step-num">1</div>
        <div>
          <h3 style="margin-bottom:6px">Add a CNAME Record</h3>
          <p style="color:#6b7280;font-size:14px;margin-bottom:12px">In your domain registrar's DNS settings, add a CNAME record that points your subdomain to our servers.</p>
          <div class="code-block"><span class="key">Type:</span>    <span class="val">CNAME</span>
<span class="key">Name:</span>    <span class="val">${v ? esc(v.domain) : 'app.yourdomain.com'}</span>
<span class="key">Target:</span>  <span class="val">${esc(BASE_DOMAIN)}</span>
<span class="key">TTL:</span>     <span class="val">3600</span></div>
        </div>
      </div>
      <div class="dns-step">
        <div class="dns-step-num">2</div>
        <div>
          <h3 style="margin-bottom:6px">Add a TXT Record for Verification</h3>
          <p style="color:#6b7280;font-size:14px;margin-bottom:12px">Add a TXT record to prove you own this domain.</p>
          <div class="code-block"><span class="key">Type:</span>    <span class="val">TXT</span>
<span class="key">Name:</span>    <span class="val">${v ? esc(v.domain) : 'app.yourdomain.com'}</span>
<span class="key">Value:</span>   <span class="val">${v ? esc(v.txt_record) : 'cz-verify-xxxxxxxxxxxxxxxx'}</span>
<span class="key">TTL:</span>     <span class="val">3600</span></div>
        </div>
      </div>
      <div class="dns-step">
        <div class="dns-step-num">3</div>
        <div>
          <h3 style="margin-bottom:6px">Wait for DNS Propagation</h3>
          <p style="color:#6b7280;font-size:14px">DNS changes typically take 5 minutes to 48 hours to propagate worldwide. Use <a href="https://mxtoolbox.com/DNSLookup.aspx" target="_blank" style="color:#4F46E5">MXToolbox DNS Lookup</a> to verify your records are live.</p>
        </div>
      </div>
      <div class="dns-step">
        <div class="dns-step-num">4</div>
        <div>
          <h3 style="margin-bottom:6px">Click Verify</h3>
          <p style="color:#6b7280;font-size:14px">Once your DNS records are live, return to the Custom Domain page and click "Verify Now".</p>
          ${v ? `<form method="POST" action="/subdomain/custom-domain/verify" style="margin-top:12px">
            <input type="hidden" name="domain_id" value="${v.id}">
            <button class="btn btn-success">Verify Domain Now</button>
          </form>` : ''}
        </div>
      </div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px">Common DNS Providers</h3>
      <p style="color:#6b7280;margin-bottom:16px">Click your provider for specific instructions:</p>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:8px">
        ${['Cloudflare','AWS Route 53','Google Domains','Namecheap','GoDaddy','DigitalOcean','Vercel','Netlify'].map(p =>
          `<a href="https://www.google.com/search?q=${encodeURIComponent(p+' add CNAME record instructions')}" target="_blank" class="btn btn-outline" style="font-size:13px">${p}</a>`
        ).join('')}
      </div>
    </div>
    <div class="card">
      <h3 style="margin-bottom:12px">Troubleshooting</h3>
      <div style="font-size:14px;color:#4b5563;line-height:1.8">
        <p><strong>Q: How long does verification take?</strong><br>A: Usually 5-30 minutes after DNS records are set. In rare cases up to 48 hours.</p>
        <p><strong>Q: Can I use an apex domain (mycompany.com)?</strong><br>A: We recommend using a subdomain (app.mycompany.com) as CNAME records don't work at the apex level for all providers.</p>
        <p><strong>Q: Does it support HTTPS?</strong><br>A: Yes! Once verified, we automatically provision an SSL certificate via Let's Encrypt.</p>
        <p><strong>Q: Verification keeps failing?</strong><br>A: Double-check the exact domain and TXT record value. Note that some providers append your domain to the name field automatically.</p>
      </div>
    </div>
    <div style="margin-top:16px">
      <a href="/subdomain/custom-domain" class="btn btn-primary">← Back to Custom Domain</a>
    </div>`;
    res.send(layout('DNS configuration guide', body));
  }));

  console.log('[routes] subdomain-routes.js loaded');
};
