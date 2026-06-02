// ============================================================
// SCHOOL SAAS PORTAL — Theme Manager Module
// Visual theme customization: colors, fonts, logo, dark/light
// mode, custom CSS, branding presets for schools
// ============================================================
// Usage in server.js:
//   const themeManager = require('./theme-manager');
//   themeManager(app, pool, { renderPage, ah, requireAuth, audit, esc });
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function themeManager(app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c) => c);
  const ah = opts.ah || ((fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  // ============================================================
  // PRESETS
  // ============================================================
  const PRESETS = {
    classic_blue:  { label: 'Classic Blue',      primary: '#2563eb', secondary: '#1d4ed8', accent: '#3b82f6', bg: '#ffffff', text: '#1e293b', heading: 'Georgia', body: 'Segoe UI', sidebar: 'light' },
    modern_dark:   { label: 'Modern Dark',        primary: '#818cf8', secondary: '#6366f1', accent: '#c084fc', bg: '#0f172a', text: '#e2e8f0', heading: 'Inter', body: 'Inter', sidebar: 'dark' },
    nature_green:  { label: 'Nature Green',       primary: '#16a34a', secondary: '#15803d', accent: '#22c55e', bg: '#f0fdf4', text: '#14532d', heading: 'Merriweather', body: 'Open Sans', sidebar: 'light' },
    corporate_gray:{ label: 'Corporate Gray',     primary: '#475569', secondary: '#334155', accent: '#0ea5e9', bg: '#f8fafc', text: '#0f172a', heading: 'Helvetica Neue', body: 'Helvetica Neue', sidebar: 'light' },
    playful:       { label: 'Playful Colorful',   primary: '#e11d48', secondary: '#8b5cf6', accent: '#f59e0b', bg: '#fffbeb', text: '#1c1917', heading: 'Nunito', body: 'Quicksand', sidebar: 'light' },
  };

  const FONT_OPTIONS = [
    'Inter','Roboto','Open Sans','Lato','Poppins','Montserrat','Nunito','Quicksand',
    'Merriweather','Georgia','Playfair Display','Source Sans Pro','Raleway','Ubuntu',
    'Helvetica Neue','Segoe UI','Arial','Verdana'
  ];

  // ============================================================
  // HELPERS
  // ============================================================
  function swatch(color, size) {
    const s = size || 32;
    return `<span style="display:inline-block;width:${s}px;height:${s}px;border-radius:6px;vertical-align:middle;border:2px solid #e2e8f0;background:${esc(color)}"></span>`;
  }

  function sanitizeCSS(css) {
    if (!css) return '';
    return css
      .replace(/url\s*\(/gi, '/* url removed */(')
      .replace(/@import/gi, '/* @import removed */')
      .replace(/expression\s*\(/gi, '/* expression removed */(')
      .replace(/behavior\s*:/gi, '/* behavior removed */:')
      .replace(/javascript\s*:/gi, '/* javascript removed */:')
      .replace(/vbscript\s*:/gi, '/* vbscript removed */:');
  }

  async function getTheme(tid) {
    const row = (await pool.query('SELECT * FROM tenant_themes WHERE tenant_id = $1', [tid])).rows[0];
    if (row) return row;
    const inserted = (await pool.query(
      `INSERT INTO tenant_themes (tenant_id) VALUES ($1) ON CONFLICT (tenant_id) DO NOTHING RETURNING *`, [tid]
    )).rows[0];
    return inserted || { tenant_id: tid, primary_color: '#4f46e5', secondary_color: '#059669', accent_color: '#d97706',
      bg_color: '#ffffff', text_color: '#1f2937', heading_font: 'Inter', body_font: 'Inter',
      heading_size: 24, body_size: 14, logo_url: '', favicon_url: '', custom_css: '',
      dark_mode: false, preset_name: '', sidebar_style: 'light', border_radius: 8 };
  }

  function themeNav(active) {
    const links = [
      ['/', 'Dashboard'], ['/colors', 'Colors'], ['/typography', 'Typography'],
      ['/logo', 'Logo'], ['/custom-css', 'Custom CSS'], ['/presets', 'Presets']
    ];
    return `<div style="display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;border-bottom:2px solid #e2e8f0;padding-bottom:12px">
      ${links.map(([href, label]) => `<a href="/school/theme${href}" class="btn btn-sm ${active === href ? '' : 'btn-outline'}" style="${active === href ? 'background:#4f46e5;color:white' : ''}">${esc(label)}</a>`).join('')}
    </div>`;
  }

  function livePreview(t) {
    const dark = t.dark_mode;
    const bg = dark ? '#0f172a' : (t.bg_color || '#ffffff');
    const text = dark ? '#e2e8f0' : (t.text_color || '#1f2937');
    const primary = t.primary_color || '#4f46e5';
    const secondary = t.secondary_color || '#059669';
    const accent = t.accent_color || '#d97706';
    const sbBg = t.sidebar_style === 'dark' ? '#1e293b' : '#f1f5f9';
    const sbText = t.sidebar_style === 'dark' ? '#e2e8f0' : '#334155';
    const hFont = t.heading_font || 'Inter';
    const bFont = t.body_font || 'Inter';
    const hSize = t.heading_size || 24;
    const bSize = t.body_size || 14;
    const br = t.border_radius || 8;
    const logo = t.logo_url || '';
    return `<div id="live-preview" style="border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;margin-bottom:20px;background:${esc(bg)}">
  <div style="display:flex;height:280px">
    <!-- Mock Sidebar -->
    <div style="width:200px;background:${esc(sbBg)};padding:16px;flex-shrink:0">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px">
        ${logo ? `<img src="${esc(logo)}" style="width:28px;height:28px;border-radius:6px;object-fit:cover">` : `<div style="width:28px;height:28px;border-radius:6px;background:${esc(primary)}"></div>`}
        <span style="font-weight:700;font-size:14px;color:${esc(sbText)};font-family:${esc(hFont)}">My School</span>
      </div>
      ${['Dashboard','Students','Teachers','Classes','Calendar','Reports'].map((item, i) =>
        `<div style="padding:8px 12px;border-radius:${br}px;margin-bottom:4px;font-size:12px;color:${esc(sbText)};background:${i === 0 ? primary + '22' : 'transparent'};font-weight:${i === 0 ? '600' : '400'};cursor:default;font-family:${esc(bFont)};border-left:3px solid ${i === 0 ? primary : 'transparent'}">${item}</div>`
      ).join('')}
    </div>
    <!-- Mock Content -->
    <div style="flex:1;padding:20px;overflow:hidden">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h2 style="font-family:${esc(hFont)};font-size:${hSize}px;color:${esc(text)};margin:0;font-weight:700">Welcome Back!</h2>
        <div style="display:flex;gap:8px">
          <span style="background:${esc(primary)};color:white;padding:6px 14px;border-radius:${br}px;font-size:12px;font-weight:600">Primary</span>
          <span style="background:${esc(secondary)};color:white;padding:6px 14px;border-radius:${br}px;font-size:12px;font-weight:600">Secondary</span>
          <span style="background:${esc(accent)};color:white;padding:6px 14px;border-radius:${br}px;font-size:12px;font-weight:600">Accent</span>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:16px">
        ${[
          { label: 'Students', val: '1,248', color: primary },
          { label: 'Teachers', val: '86', color: secondary },
          { label: 'Attendance', val: '94%', color: accent },
          { label: 'Revenue', val: '$42K', color: '#e11d48' }
        ].map(c => `<div style="background:${esc(bg)};border:1px solid ${dark ? '#334155' : '#e2e8f0'};border-radius:${br}px;padding:14px">
          <div style="font-size:11px;color:${dark ? '#94a3b8' : '#64748b'};font-family:${esc(bFont)}">${c.label}</div>
          <div style="font-size:22px;font-weight:700;color:${esc(c.color)};font-family:${esc(hFont)};margin-top:4px">${c.val}</div>
        </div>`).join('')}
      </div>
      <p style="font-family:${esc(bFont)};font-size:${bSize}px;color:${esc(text)};line-height:1.6;margin:0">
        This is a live preview of your school portal theme. Changes to colors, fonts, and layout are reflected here in real-time.
      </p>
    </div>
  </div>
</div>`;
  }

  // ============================================================
  // DATABASE MIGRATION
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'ThemeManager', `CREATE TABLE IF NOT EXISTS tenant_themes (
        id SERIAL PRIMARY KEY,
        tenant_id INT UNIQUE,
        primary_color VARCHAR(7) DEFAULT '#4f46e5',
        secondary_color VARCHAR(7) DEFAULT '#059669',
        accent_color VARCHAR(7) DEFAULT '#d97706',
        bg_color VARCHAR(7) DEFAULT '#ffffff',
        text_color VARCHAR(7) DEFAULT '#1f2937',
        heading_font VARCHAR(50) DEFAULT 'Inter',
        body_font VARCHAR(50) DEFAULT 'Inter',
        heading_size INT DEFAULT 24,
        body_size INT DEFAULT 14,
        logo_url TEXT,
        favicon_url TEXT,
        custom_css TEXT,
        dark_mode BOOLEAN DEFAULT false,
        preset_name VARCHAR(50),
        sidebar_style VARCHAR(20) DEFAULT 'light',
        border_radius INT DEFAULT 8,
        updated_by VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[ThemeManager] tenant_themes table ready');
    } catch (e) {
      console.error('[ThemeManager] Migration error:', e.message);
    }
  })();

  // ============================================================
  // ROUTE 1: GET /school/theme — Theme editor dashboard
  // ============================================================
  app.get('/school/theme', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const t = await getTheme(tid);
    const html = `
    <div style="background:linear-gradient(135deg,#4f46e5,#7c3aed);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1 style="margin:0">&#127912; Theme Manager</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Customize your school portal appearance &mdash; colors, fonts, logos, and more</p>
    </div>
    ${themeNav('/')}
    ${livePreview(t)}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:16px">
      <div class="card" style="border-left:4px solid ${esc(t.primary_color)}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          ${swatch(t.primary_color)} ${swatch(t.secondary_color)} ${swatch(t.accent_color)}
          <strong style="font-size:14px">Colors</strong>
        </div>
        <p style="font-size:13px;color:#64748b;margin:0">Primary, secondary, accent, background, and text colors</p>
        <a href="/school/theme/colors" class="btn btn-sm" style="margin-top:12px;background:${esc(t.primary_color)}">Edit Colors</a>
      </div>
      <div class="card" style="border-left:4px solid ${esc(t.secondary_color)}">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
          <span style="font-family:${esc(t.heading_font)};font-size:18px;font-weight:700">Aa</span>
          <span style="font-family:${esc(t.body_font)};font-size:14px">Body text sample</span>
        </div>
        <p style="font-size:13px;color:#64748b;margin:0">Heading: ${esc(t.heading_font)}, Body: ${esc(t.body_font)}</p>
        <a href="/school/theme/typography" class="btn btn-sm" style="margin-top:12px;background:${esc(t.secondary_color)}">Edit Typography</a>
      </div>
      <div class="card" style="border-left:4px solid ${esc(t.accent_color)}">
        <div style="margin-bottom:12px">
          ${t.logo_url ? `<img src="${esc(t.logo_url)}" style="height:36px;border-radius:6px;object-fit:contain">` : '<span style="color:#94a3b8;font-size:13px">No logo uploaded</span>'}
        </div>
        <p style="font-size:13px;color:#64748b;margin:0">Logo, favicon, and brand imagery</p>
        <a href="/school/theme/logo" class="btn btn-sm" style="margin-top:12px;background:${esc(t.accent_color)}">Manage Logo</a>
      </div>
      <div class="card">
        <div style="margin-bottom:12px;font-size:20px">&#128396;</div>
        <p style="font-size:13px;color:#64748b;margin:0">Advanced custom CSS for full control</p>
        <a href="/school/theme/custom-css" class="btn btn-sm btn-outline" style="margin-top:12px">Custom CSS</a>
      </div>
      <div class="card">
        <div style="margin-bottom:12px;font-size:20px">&#127912;</div>
        <p style="font-size:13px;color:#64748b;margin:0">Pre-built theme presets for quick setup</p>
        <a href="/school/theme/presets" class="btn btn-sm btn-outline" style="margin-top:12px">Browse Presets</a>
      </div>
      <div class="card">
        <div style="margin-bottom:12px;display:flex;align-items:center;gap:8px">
          <span style="font-size:20px">${t.dark_mode ? '&#127769;' : '&#9728;&#65039;'}</span>
          <strong>${t.dark_mode ? 'Dark Mode' : 'Light Mode'}</strong>
        </div>
        <p style="font-size:13px;color:#64748b;margin:0">Sidebar: ${esc(t.sidebar_style)}, Radius: ${t.border_radius}px</p>
        <p style="font-size:11px;color:#94a3b8;margin-top:4px">Preset: ${esc(t.preset_name || 'Custom')}</p>
      </div>
    </div>`;
    res.send(renderPage('Theme Manager', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 2: POST /school/theme/save — Save all theme settings
  // ============================================================
  app.post('/school/theme/save', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const fields = ['primary_color','secondary_color','accent_color','bg_color','text_color',
      'heading_font','body_font','logo_url','favicon_url','custom_css','preset_name','sidebar_style'];
    const numFields = ['heading_size','body_size','border_radius'];
    const dark = req.body.dark_mode === 'true' || req.body.dark_mode === 'on';
    const sets = []; const vals = []; let i = 1;
    fields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(String(req.body[f]).substring(0, 500)); } });
    numFields.forEach(f => { if (req.body[f] !== undefined) { sets.push(`${f} = $${i++}`); vals.push(Math.max(0, Math.min(999, parseInt(req.body[f]) || 0))); } });
    sets.push(`dark_mode = $${i++}`); vals.push(dark);
    sets.push(`updated_by = $${i++}`); vals.push((req.session.user?.email || '').substring(0, 255));
    sets.push(`updated_at = NOW()`);
    vals.push(tid);
    await pool.query(`INSERT INTO tenant_themes (tenant_id) VALUES ($${i}) ON CONFLICT (tenant_id) DO UPDATE SET ${sets.join(', ')}`, vals);
    audit(req.session.user?.email, 'theme_saved', { tenant_id: tid });
    req.session.toast = { type: 'success', message: 'Theme settings saved' };
    res.redirect('/school/theme');
  }));

  // ============================================================
  // ROUTE 3: GET /school/theme/presets — Browse presets
  // ============================================================
  app.get('/school/theme/presets', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const t = await getTheme(tid);
    const cards = Object.entries(PRESETS).map(([key, p]) => {
      const isActive = t.preset_name === key;
      return `<div class="card" style="border:2px solid ${isActive ? '#4f46e5' : '#e2e8f0'};position:relative">
        ${isActive ? '<span style="position:absolute;top:8px;right:8px;background:#4f46e5;color:white;font-size:11px;padding:3px 10px;border-radius:20px;font-weight:600">Active</span>' : ''}
        <div style="display:flex;gap:6px;margin-bottom:14px">
          ${swatch(p.primary)} ${swatch(p.secondary)} ${swatch(p.accent)}
        </div>
        <h3 style="margin:0 0 6px;font-size:16px">${esc(p.label)}</h3>
        <p style="font-size:12px;color:#64748b;margin:0 0 4px">Heading: <span style="font-family:${esc(p.heading)};font-weight:700">${esc(p.heading)}</span></p>
        <p style="font-size:12px;color:#64748b;margin:0 0 4px">Body: <span style="font-family:${esc(p.body)}">${esc(p.body)}</span></p>
        <p style="font-size:12px;color:#64748b;margin:0 0 14px">BG: ${esc(p.bg)} &bull; Text: ${esc(p.text)} &bull; Sidebar: ${esc(p.sidebar)}</p>
        <form method="POST" action="/school/theme/presets/apply" style="margin:0">
          <input type="hidden" name="preset" value="${esc(key)}">
          <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
          <button class="btn btn-sm ${isActive ? 'btn-outline' : ''}" type="submit" ${isActive ? 'disabled style="opacity:0.5;cursor:not-allowed"' : ''}>
            ${isActive ? '&#10003; Applied' : 'Apply Preset'}
          </button>
        </form>
      </div>`;
    }).join('');
    const html = `
    <div style="background:linear-gradient(135deg,#7c3aed,#a855f7);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1 style="margin:0">&#127912; Theme Presets</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Choose a pre-built theme to quickly style your school portal</p>
    </div>
    ${themeNav('/presets')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:20px">${cards}</div>`;
    res.send(renderPage('Theme Presets', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 4: POST /school/theme/presets/apply — Apply a preset
  // ============================================================
  app.post('/school/theme/presets/apply', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const key = req.body.preset;
    const p = PRESETS[key];
    if (!p) { req.session.toast = { type: 'error', message: 'Invalid preset' }; return res.redirect('/school/theme/presets'); }
    await pool.query(`INSERT INTO tenant_themes (tenant_id, primary_color, secondary_color, accent_color, bg_color, text_color,
      heading_font, body_font, dark_mode, preset_name, sidebar_style, updated_by, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET primary_color=$2, secondary_color=$3, accent_color=$4,
      bg_color=$5, text_color=$6, heading_font=$7, body_font=$8, dark_mode=$9, preset_name=$10,
      sidebar_style=$11, updated_by=$12, updated_at=NOW()`,
      [tid, p.primary, p.secondary, p.accent, p.bg, p.text, p.heading, p.body,
        p.sidebar === 'dark', key, p.sidebar, (req.session.user?.email || '').substring(0, 255)]);
    audit(req.session.user?.email, 'preset_applied', { preset: key });
    req.session.toast = { type: 'success', message: `"${p.label}" preset applied` };
    res.redirect('/school/theme');
  }));

  // ============================================================
  // ROUTE 5: GET /school/theme/logo — Logo management
  // ============================================================
  app.get('/school/theme/logo', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const t = await getTheme(tid);
    const html = `
    <div style="background:linear-gradient(135deg,#d97706,#f59e0b);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1 style="margin:0">&#128247; Logo Management</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Upload and configure your school logo and favicon</p>
    </div>
    ${themeNav('/logo')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card">
        <h3 style="margin-bottom:16px">School Logo</h3>
        <div style="text-align:center;padding:24px;background:#f8fafc;border-radius:12px;border:2px dashed #e2e8f0;margin-bottom:16px">
          ${t.logo_url
            ? `<img src="${esc(t.logo_url)}" style="max-height:120px;max-width:100%;border-radius:8px;object-fit:contain" alt="School Logo">`
            : '<div style="color:#94a3b8;font-size:48px;margin-bottom:8px">&#127912;</div><p style="color:#94a3b8;font-size:13px;margin:0">No logo uploaded</p>'}
        </div>
        <form method="POST" action="/school/theme/logo">
          <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
          <div style="margin-bottom:12px">
            <label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Logo URL</label>
            <input type="url" name="logo_url" value="${esc(t.logo_url)}" placeholder="https://example.com/logo.png">
            <p style="font-size:12px;color:#64748b;margin:4px 0 0">Paste a direct URL to your logo image (PNG, SVG, or JPG)</p>
          </div>
          <button class="btn" type="submit" style="background:#d97706">Save Logo</button>
        </form>
      </div>
      <div class="card">
        <h3 style="margin-bottom:16px">Favicon</h3>
        <div style="text-align:center;padding:24px;background:#f8fafc;border-radius:12px;border:2px dashed #e2e8f0;margin-bottom:16px">
          ${t.favicon_url
            ? `<img src="${esc(t.favicon_url)}" style="width:48px;height:48px;border-radius:8px;object-fit:contain" alt="Favicon">`
            : '<div style="color:#94a3b8;font-size:32px">&#127760;</div><p style="color:#94a3b8;font-size:13px;margin:4px 0 0">No favicon set</p>'}
        </div>
        <form method="POST" action="/school/theme/logo">
          <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
          <div style="margin-bottom:12px">
            <label style="font-weight:600;font-size:14px;display:block;margin-bottom:4px">Favicon URL</label>
            <input type="url" name="favicon_url" value="${esc(t.favicon_url)}" placeholder="https://example.com/favicon.ico">
            <p style="font-size:12px;color:#64748b;margin:4px 0 0">Recommended: 32x32 or 64x64 ICO or PNG</p>
          </div>
          <button class="btn btn-outline" type="submit">Save Favicon</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Logo Management', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /school/theme/logo — Update logo URL
  // ============================================================
  app.post('/school/theme/logo', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const { logo_url, favicon_url } = req.body;
    const sets = ['updated_at = NOW()', `updated_by = '${(req.session.user?.email || '').substring(0, 255).replace(/'/g, "''")}'`];
    const vals = []; let i = 1;
    if (logo_url !== undefined) { sets.push(`logo_url = $${i++}`); vals.push(String(logo_url).substring(0, 2000)); }
    if (favicon_url !== undefined) { sets.push(`favicon_url = $${i++}`); vals.push(String(favicon_url).substring(0, 2000)); }
    if (vals.length === 0) { return res.redirect('/school/theme/logo'); }
    vals.push(tid);
    await pool.query(`INSERT INTO tenant_themes (tenant_id) VALUES ($${i}) ON CONFLICT (tenant_id) DO UPDATE SET ${sets.join(', ')}`, vals);
    audit(req.session.user?.email, 'logo_updated', { logo_url: !!logo_url, favicon_url: !!favicon_url });
    req.session.toast = { type: 'success', message: 'Logo settings saved' };
    res.redirect('/school/theme/logo');
  }));

  // ============================================================
  // ROUTE 7: GET /school/theme/colors — Color picker
  // ============================================================
  app.get('/school/theme/colors', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const t = await getTheme(tid);
    const colorFields = [
      { name: 'primary_color', label: 'Primary Color', desc: 'Buttons, links, active states, main brand color' },
      { name: 'secondary_color', label: 'Secondary Color', desc: 'Success states, secondary actions, navigation' },
      { name: 'accent_color', label: 'Accent Color', desc: 'Highlights, badges, warnings, call-to-action' },
      { name: 'bg_color', label: 'Background Color', desc: 'Main page background' },
      { name: 'text_color', label: 'Text Color', desc: 'Primary body text color' },
    ];
    const fields = colorFields.map(cf => `
      <div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #f1f5f9">
        <div>
          <label style="font-weight:600;font-size:14px;display:block">${esc(cf.label)}</label>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">${esc(cf.desc)}</p>
        </div>
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <input type="color" name="${esc(cf.name)}" value="${esc(t[cf.name])}" id="cp_${cf.name}" style="width:44px;height:36px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;padding:2px">
          <input type="text" name="${esc(cf.name)}" value="${esc(t[cf.name])}" style="width:100px;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:monospace" maxlength="7">
          <button type="button" class="btn btn-sm btn-outline copy-btn" data-target="cp_${cf.name}" style="padding:6px 10px;font-size:11px">Copy</button>
        </div>
      </div>`).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#4f46e5,#6366f1);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1 style="margin:0">&#127912; Color Settings</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Fine-tune every color in your school portal</p>
    </div>
    ${themeNav('/colors')}
    ${livePreview(t)}
    <div class="card">
      <form method="POST" action="/school/theme/colors" id="colorForm">
        <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
        ${fields}
        <div style="margin-top:16px;display:flex;gap:10px">
          <button class="btn" type="submit">Save Colors</button>
          <a href="/school/theme/reset" class="btn btn-red btn-sm" style="padding:10px 20px" onclick="return confirm('Reset all theme settings to defaults?')">Reset to Defaults</a>
        </div>
      </form>
    </div>
    <script>
    document.querySelectorAll('.copy-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        var t = document.getElementById(btn.dataset.target);
        if (t) { navigator.clipboard.writeText(t.value); btn.textContent = 'Copied!'; setTimeout(() => btn.textContent = 'Copy', 1500); }
      });
    });
    </script>`;
    res.send(renderPage('Color Settings', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 8: POST /school/theme/colors — Save colors
  // ============================================================
  app.post('/school/theme/colors', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const colorNames = ['primary_color', 'secondary_color', 'accent_color', 'bg_color', 'text_color'];
    const sets = []; const vals = []; let i = 1;
    colorNames.forEach(f => {
      const v = String(req.body[f] || '').trim().match(/^#[0-9a-fA-F]{6}$/) ? req.body[f] : null;
      if (v) { sets.push(`${f} = $${i++}`); vals.push(v); }
    });
    if (sets.length === 0) { req.session.toast = { type: 'error', message: 'No valid colors provided' }; return res.redirect('/school/theme/colors'); }
    sets.push(`updated_by = $${i++}`); vals.push((req.session.user?.email || '').substring(0, 255));
    sets.push('updated_at = NOW()'); vals.push(tid);
    await pool.query(`INSERT INTO tenant_themes (tenant_id) VALUES ($${i}) ON CONFLICT (tenant_id) DO UPDATE SET ${sets.join(', ')}`, vals);
    audit(req.session.user?.email, 'colors_updated', Object.fromEntries(colorNames.map(f => [f, req.body[f]])));
    req.session.toast = { type: 'success', message: 'Colors saved successfully' };
    res.redirect('/school/theme/colors');
  }));

  // ============================================================
  // ROUTE 9: GET /school/theme/typography — Font selection
  // ============================================================
  app.get('/school/theme/typography', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const t = await getTheme(tid);
    const fontOpts = FONT_OPTIONS.map(f =>
      `<option value="${esc(f)}" ${t.heading_font === f ? 'selected' : ''}>${esc(f)}</option>`
    ).join('');
    const bodyFontOpts = FONT_OPTIONS.map(f =>
      `<option value="${esc(f)}" ${t.body_font === f ? 'selected' : ''}>${esc(f)}</option>`
    ).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#059669,#10b981);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1 style="margin:0">&#128221; Typography</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Choose fonts and sizes for headings and body text</p>
    </div>
    ${themeNav('/typography')}
    ${livePreview(t)}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <div class="card">
        <h3 style="margin-bottom:16px">Heading Font</h3>
        <form method="POST" action="/school/theme/typography">
          <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
          <div style="margin-bottom:14px">
            <label style="font-weight:600;font-size:14px;display:block;margin-bottom:6px">Font Family</label>
            <select name="heading_font" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px">${fontOpts}</select>
          </div>
          <div style="margin-bottom:14px">
            <label style="font-weight:600;font-size:14px;display:block;margin-bottom:6px">Heading Size: <span id="hSizeVal">${t.heading_size}</span>px</label>
            <input type="range" name="heading_size" min="16" max="48" value="${t.heading_size}" style="width:100%" oninput="document.getElementById('hSizeVal').textContent=this.value">
          </div>
          <div style="padding:16px;background:#f8fafc;border-radius:8px;margin-bottom:14px">
            <p id="headingPreview" style="font-family:${esc(t.heading_font)};font-size:${t.heading_size}px;margin:0;font-weight:700;color:#1f2937">The Quick Brown Fox Jumps Over The Lazy Dog</p>
          </div>
          <button class="btn" type="submit" style="background:#059669">Save Typography</button>
        </form>
      </div>
      <div class="card">
        <h3 style="margin-bottom:16px">Body Font</h3>
        <div style="margin-bottom:14px">
          <label style="font-weight:600;font-size:14px;display:block;margin-bottom:6px">Font Family</label>
          <select name="body_font" style="width:100%;padding:10px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px">${bodyFontOpts}</select>
        </div>
        <div style="margin-bottom:14px">
          <label style="font-weight:600;font-size:14px;display:block;margin-bottom:6px">Body Size: <span id="bSizeVal">${t.body_size}</span>px</label>
          <input type="range" name="body_size" min="10" max="24" value="${t.body_size}" style="width:100%" oninput="document.getElementById('bSizeVal').textContent=this.value">
        </div>
        <div style="padding:16px;background:#f8fafc;border-radius:8px;margin-bottom:14px">
          <p id="bodyPreview" style="font-family:${esc(t.body_font)};font-size:${t.body_size}px;margin:0;color:#374151;line-height:1.7">Education is the most powerful weapon which you can use to change the world. The function of education is to teach one to think intensively and to think critically. Intelligence plus character &mdash; that is the goal of true education.</p>
        </div>
        <div style="padding:16px;background:#f8fafc;border-radius:8px">
          <label style="font-weight:600;font-size:14px;display:block;margin-bottom:8px">Border Radius: <span id="brVal">${t.border_radius}</span>px</label>
          <input type="range" name="border_radius" min="0" max="24" value="${t.border_radius}" style="width:100%" oninput="document.getElementById('brVal').textContent=this.value">
          <div style="display:flex;gap:8px;margin-top:8px">
            <div style="width:40px;height:40px;background:#4f46e5;border-radius:var(--br,${t.border_radius}px)" id="brDemo"></div>
          </div>
        </div>
      </div>
    </div>
    <script>
    document.querySelector('select[name=heading_font]').addEventListener('change', function(){
      document.getElementById('headingPreview').style.fontFamily = this.value;
    });
    document.querySelector('select[name=body_font]').addEventListener('change', function(){
      document.getElementById('bodyPreview').style.fontFamily = this.value;
    });
    </script>`;
    res.send(renderPage('Typography Settings', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /school/theme/typography — Save typography
  // ============================================================
  app.post('/school/theme/typography', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const hFont = FONT_OPTIONS.includes(req.body.heading_font) ? req.body.heading_font : 'Inter';
    const bFont = FONT_OPTIONS.includes(req.body.body_font) ? req.body.body_font : 'Inter';
    const hSize = Math.max(16, Math.min(48, parseInt(req.body.heading_size) || 24));
    const bSize = Math.max(10, Math.min(24, parseInt(req.body.body_size) || 14));
    const br = Math.max(0, Math.min(24, parseInt(req.body.border_radius) || 8));
    await pool.query(`INSERT INTO tenant_themes (tenant_id, heading_font, body_font, heading_size, body_size, border_radius, updated_by, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7,NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET heading_font=$2, body_font=$3, heading_size=$4, body_size=$5, border_radius=$6, updated_by=$7, updated_at=NOW()`,
      [tid, hFont, bFont, hSize, bSize, br, (req.session.user?.email || '').substring(0, 255)]);
    audit(req.session.user?.email, 'typography_updated', { heading_font: hFont, body_font: bFont, heading_size: hSize, body_size: bSize });
    req.session.toast = { type: 'success', message: 'Typography settings saved' };
    res.redirect('/school/theme/typography');
  }));

  // ============================================================
  // ROUTE 11: GET /school/theme/custom-css — Custom CSS editor
  // ============================================================
  app.get('/school/theme/custom-css', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const t = await getTheme(tid);
    const html = `
    <div style="background:linear-gradient(135deg,#475569,#64748b);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1 style="margin:0">&#128396; Custom CSS</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Add custom styles for advanced theme customization</p>
    </div>
    ${themeNav('/custom-css')}
    <div class="card">
      <form method="POST" action="/school/theme/custom-css">
        <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
        <div style="margin-bottom:12px">
          <label style="font-weight:600;font-size:14px;display:block;margin-bottom:6px">Custom CSS</label>
          <p style="font-size:12px;color:#64748b;margin:0 0 8px">Write CSS that will be injected into the &lt;head&gt; of every page. Dangerous patterns (url(), @import, expression) are automatically stripped.</p>
          <textarea name="custom_css" rows="16" style="width:100%;padding:14px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px;font-family:'Fira Code','Cascadia Code',monospace;line-height:1.6;resize:vertical;background:#1e293b;color:#e2e8f0;tab-size:2" placeholder="/* Example: Custom button styles */&#10;.btn-primary {&#10;  background: linear-gradient(135deg, #4f46e5, #7c3aed);&#10;  border-radius: 12px;&#10;  font-weight: 700;&#10;}" spellcheck="false">${esc(t.custom_css || '')}</textarea>
        </div>
        <div style="display:flex;gap:10px;align-items:center">
          <button class="btn" type="submit" style="background:#475569">Save Custom CSS</button>
          <span style="font-size:12px;color:#64748b" id="charCount">${(t.custom_css || '').length} characters</span>
        </div>
      </form>
    </div>
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:12px">Quick Snippets</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px">
        ${[
          { label: 'Rounded Buttons', css: '.btn { border-radius: 20px !important; }' },
          { label: 'Card Shadows', css: '.card { box-shadow: 0 10px 40px rgba(0,0,0,0.12) !important; }' },
          { label: 'Custom Font Import', css: '@import url("https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&display=swap");' },
          { label: 'Smooth Transitions', css: '* { transition: all 0.3s ease !important; }' },
          { label: 'Hover Effects', css: '.btn:hover { transform: translateY(-2px) !important; }' },
          { label: 'Hide Sidebar on Mobile', css: '@media (max-width: 768px) { .sidebar { display: none !important; } }' }
        ].map(s => `<button type="button" class="snippet-btn" data-css="${esc(s.css)}" style="padding:10px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;cursor:pointer;text-align:left;font-size:13px;color:#1e293b;transition:0.2s">
          <strong>${esc(s.label)}</strong>
        </button>`).join('')}
      </div>
    </div>
    <script>
    var ta = document.querySelector('textarea[name=custom_css]');
    var cc = document.getElementById('charCount');
    ta.addEventListener('input', function(){ cc.textContent = this.value.length + ' characters'; });
    document.querySelectorAll('.snippet-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        ta.value = (ta.value ? ta.value + '\\n\\n' : '') + this.dataset.css;
        cc.textContent = ta.value.length + ' characters';
        ta.focus();
      });
    });
    </script>`;
    res.send(renderPage('Custom CSS Editor', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 12: POST /school/theme/custom-css — Save custom CSS
  // ============================================================
  app.post('/school/theme/custom-css', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const raw = String(req.body.custom_css || '');
    const safe = sanitizeCSS(raw).substring(0, 50000);
    await pool.query(`INSERT INTO tenant_themes (tenant_id, custom_css, updated_by, updated_at)
      VALUES ($1,$2,$3,NOW())
      ON CONFLICT (tenant_id) DO UPDATE SET custom_css=$2, updated_by=$3, updated_at=NOW()`,
      [tid, safe, (req.session.user?.email || '').substring(0, 255)]);
    audit(req.session.user?.email, 'custom_css_updated', { length: raw.length });
    req.session.toast = { type: 'success', message: 'Custom CSS saved' };
    res.redirect('/school/theme/custom-css');
  }));

  // ============================================================
  // ROUTE 13: POST /school/theme/reset — Reset to defaults
  // ============================================================
  app.post('/school/theme/reset', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    await pool.query(`UPDATE tenant_themes SET
      primary_color='#4f46e5', secondary_color='#059669', accent_color='#d97706',
      bg_color='#ffffff', text_color='#1f2937', heading_font='Inter', body_font='Inter',
      heading_size=24, body_size=14, logo_url='', favicon_url='', custom_css='',
      dark_mode=false, preset_name='', sidebar_style='light', border_radius=8,
      updated_by=$1, updated_at=NOW() WHERE tenant_id=$2`,
      [(req.session.user?.email || '').substring(0, 255), tid]);
    audit(req.session.user?.email, 'theme_reset', {});
    req.session.toast = { type: 'success', message: 'Theme reset to defaults' };
    res.redirect('/school/theme');
  }));

  // ============================================================
  // ROUTE 14: GET /school/theme/api — JSON API for current theme
  // ============================================================
  app.get('/school/theme/api', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const t = await getTheme(tid);
    res.json({
      success: true,
      theme: {
        primary_color: t.primary_color,
        secondary_color: t.secondary_color,
        accent_color: t.accent_color,
        bg_color: t.bg_color,
        text_color: t.text_color,
        heading_font: t.heading_font,
        body_font: t.body_font,
        heading_size: t.heading_size,
        body_size: t.body_size,
        logo_url: t.logo_url || '',
        favicon_url: t.favicon_url || '',
        custom_css: t.custom_css || '',
        dark_mode: !!t.dark_mode,
        preset_name: t.preset_name || '',
        sidebar_style: t.sidebar_style || 'light',
        border_radius: t.border_radius || 8,
        updated_at: t.updated_at
      },
      presets: Object.entries(PRESETS).map(([k, v]) => ({ key: k, label: v.label, colors: { primary: v.primary, secondary: v.secondary, accent: v.accent, bg: v.bg, text: v.text } }))
    });
  }));
};
