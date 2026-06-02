// ============================================================
// SCHOOL SAAS PORTAL — Visual Theme Builder Module
// Advanced school branding: multi-theme management, visual
// editor with color pickers, component overrides, templates,
// import/export, live previews, and per-component customization
// ============================================================
// Usage in server.js:
//   const themeBuilder = require('./theme-builder');
//   themeBuilder(app, pool, { renderPage, ah, requireAuth, audit, esc });
// ============================================================

'use strict';

const { migrateQuery } = require('./db');
module.exports = function themeBuilder(app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((title, content, user) => content);
  const ah = opts.ah || ((fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const PREFIX = '/admin/theme-builder';

  // ============================================================
  // FONT OPTIONS
  // ============================================================
  const FONT_OPTIONS = [
    'Inter', 'Roboto', 'Open Sans', 'Lato', 'Poppins', 'Montserrat', 'Nunito',
    'Quicksand', 'Merriweather', 'Georgia', 'Playfair Display', 'Source Sans Pro',
    'Raleway', 'Ubuntu', 'Helvetica Neue', 'Segoe UI', 'Arial', 'Verdana'
  ];

  const SIDEBAR_STYLES = ['dark', 'light', 'transparent', 'colored'];
  const LAYOUT_OPTIONS = ['sidebar', 'topbar', 'minimal', 'fullwidth'];

  // ============================================================
  // THEME TEMPLATES (pre-built)
  // ============================================================
  const THEME_TEMPLATES = [
    {
      id: 'classic_academy',
      name: 'Classic Academy',
      description: 'Traditional dark sidebar with deep navy blue accents — perfect for established institutions',
      primary_color: '#1e3a5f',
      secondary_color: '#2d5986',
      accent_color: '#c9a227',
      font_heading: 'Georgia',
      font_body: 'Open Sans',
      border_radius: 4,
      sidebar_style: 'dark',
      layout: 'sidebar',
      tags: ['Traditional', 'Formal', 'Academic']
    },
    {
      id: 'modern_blue',
      name: 'Modern Blue',
      description: 'Clean and contemporary with vibrant blue tones, ideal for tech-focused schools',
      primary_color: '#3b82f6',
      secondary_color: '#8b5cf6',
      accent_color: '#06b6d4',
      font_heading: 'Inter',
      font_body: 'Inter',
      border_radius: 8,
      sidebar_style: 'dark',
      layout: 'sidebar',
      tags: ['Modern', 'Tech', 'Clean']
    },
    {
      id: 'nature_green',
      name: 'Nature Campus',
      description: 'Fresh green palette reflecting growth, sustainability, and outdoor learning environments',
      primary_color: '#16a34a',
      secondary_color: '#15803d',
      accent_color: '#f59e0b',
      font_heading: 'Merriweather',
      font_body: 'Source Sans Pro',
      border_radius: 12,
      sidebar_style: 'light',
      layout: 'sidebar',
      tags: ['Eco', 'Organic', 'Fresh']
    },
    {
      id: 'creative_playful',
      name: 'Creative Playful',
      description: 'Vibrant multi-color theme designed for preschools and primary schools',
      primary_color: '#e11d48',
      secondary_color: '#8b5cf6',
      accent_color: '#f59e0b',
      font_heading: 'Nunito',
      font_body: 'Quicksand',
      border_radius: 16,
      sidebar_style: 'colored',
      layout: 'topbar',
      tags: ['Playful', 'Colorful', 'Kids']
    },
    {
      id: 'corporate_professional',
      name: 'Corporate Professional',
      description: 'Sleek gray and blue palette suitable for business schools and universities',
      primary_color: '#475569',
      secondary_color: '#334155',
      accent_color: '#0ea5e9',
      font_heading: 'Helvetica Neue',
      font_body: 'Helvetica Neue',
      border_radius: 6,
      sidebar_style: 'light',
      layout: 'topbar',
      tags: ['Corporate', 'Professional', 'Sleek']
    },
    {
      id: 'warm_welcome',
      name: 'Warm Welcome',
      description: 'Warm orange and amber tones creating a friendly, inviting atmosphere',
      primary_color: '#ea580c',
      secondary_color: '#dc2626',
      accent_color: '#f59e0b',
      font_heading: 'Poppins',
      font_body: 'Lato',
      border_radius: 10,
      sidebar_style: 'dark',
      layout: 'sidebar',
      tags: ['Warm', 'Friendly', 'Inviting']
    },
    {
      id: 'minimal_purist',
      name: 'Minimal Purist',
      description: 'Ultra-clean design with maximum whitespace and minimal color distractions',
      primary_color: '#18181b',
      secondary_color: '#52525b',
      accent_color: '#3b82f6',
      font_heading: 'Inter',
      font_body: 'Inter',
      border_radius: 2,
      sidebar_style: 'transparent',
      layout: 'minimal',
      tags: ['Minimal', 'Clean', 'Focused']
    },
    {
      id: 'purple_royalty',
      name: 'Purple Royalty',
      description: 'Rich purple gradients conveying prestige and excellence in education',
      primary_color: '#7c3aed',
      secondary_color: '#a855f7',
      accent_color: '#fbbf24',
      font_heading: 'Playfair Display',
      font_body: 'Raleway',
      border_radius: 12,
      sidebar_style: 'dark',
      layout: 'sidebar',
      tags: ['Premium', 'Elegant', 'Royal']
    }
  ];

  // ============================================================
  // COMPONENT TYPES
  // ============================================================
  const COMPONENT_TYPES = [
    { type: 'navbar', label: 'Navigation Bar', icon: '&#9776;', desc: 'Top navigation menu styling' },
    { type: 'sidebar', label: 'Sidebar Menu', icon: '&#9654;', desc: 'Left sidebar navigation panel' },
    { type: 'cards', label: 'Content Cards', icon: '&#9635;', desc: 'Dashboard cards and content blocks' },
    { type: 'buttons', label: 'Buttons', icon: '&#9112;', desc: 'Primary, secondary, and action buttons' },
    { type: 'forms', label: 'Form Inputs', icon: '&#9998;', desc: 'Text inputs, selects, checkboxes' },
    { type: 'tables', label: 'Data Tables', icon: '&#9776;', desc: 'Sortable data grids and tables' },
    { type: 'modals', label: 'Modal Dialogs', icon: '&#9633;', desc: 'Popup dialogs and overlays' },
    { type: 'alerts', label: 'Alerts & Toasts', icon: '&#9888;', desc: 'Success, warning, error notifications' },
    { type: 'badges', label: 'Badges & Tags', icon: '&#9679;', desc: 'Status badges and category tags' },
    { type: 'login', label: 'Login Page', icon: '&#9919;', desc: 'Authentication page layout' },
    { type: 'footer', label: 'Footer', icon: '&#9608;', desc: 'Bottom footer section' },
    { type: 'charts', label: 'Chart Containers', icon: '&#9670;', desc: 'Analytics chart wrappers' }
  ];

  // ============================================================
  // HELPER FUNCTIONS
  // ============================================================
  function swatch(color, size) {
    const s = size || 28;
    const c = color || '#3b82f6';
    return `<span style="display:inline-block;width:${s}px;height:${s}px;border-radius:6px;vertical-align:middle;border:2px solid #334155;background:${esc(c)}"></span>`;
  }

  function hexToRgb(hex) {
    if (!hex || !/^#[0-9a-fA-F]{6}$/.test(hex)) return { r: 59, g: 130, b: 246 };
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    return { r, g, b };
  }

  function lightenColor(hex, pct) {
    const { r, g, b } = hexToRgb(hex);
    const lr = Math.min(255, Math.round(r + (255 - r) * (pct / 100)));
    const lg = Math.min(255, Math.round(g + (255 - g) * (pct / 100)));
    const lb = Math.min(255, Math.round(b + (255 - b) * (pct / 100)));
    return `#${lr.toString(16).padStart(2, '0')}${lg.toString(16).padStart(2, '0')}${lb.toString(16).padStart(2, '0')}`;
  }

  function darkenColor(hex, pct) {
    const { r, g, b } = hexToRgb(hex);
    const dr = Math.max(0, Math.round(r * (1 - pct / 100)));
    const dg = Math.max(0, Math.round(g * (1 - pct / 100)));
    const db = Math.max(0, Math.round(b * (1 - pct / 100)));
    return `#${dr.toString(16).padStart(2, '0')}${dg.toString(16).padStart(2, '0')}${db.toString(16).padStart(2, '0')}`;
  }

  function validateHex(val) {
    const v = String(val || '').trim();
    return /^#[0-9a-fA-F]{6}$/.test(v) ? v.toLowerCase() : null;
  }

  function sanitizeCSS(css) {
    if (!css) return '';
    return css
      .replace(/url\s*\(/gi, '/* url removed */(')
      .replace(/@import/gi, '/* @import removed */')
      .replace(/expression\s*\(/gi, '/* expression removed */(')
      .replace(/behavior\s*:/gi, '/* behavior removed */:')
      .replace(/javascript\s*:/gi, '/* javascript removed */:')
      .replace(/vbscript\s*:/gi, '/* vbscript removed */:')
      .replace(/-moz-binding\s*:/gi, '/* moz-binding removed */:');
  }

  function navHtml(active) {
    const links = [
      ['/', 'Theme List'],
      ['/templates', 'Templates'],
      ['/settings', 'Settings']
    ];
    return `<div style="display:flex;gap:4px;margin-bottom:24px;flex-wrap:wrap;border-bottom:1px solid #1e293b;padding-bottom:12px">
      ${links.map(([href, label]) => {
        const isActive = active === href;
        return `<a href="${PREFIX}${href}" style="padding:8px 16px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;transition:all 0.2s;${isActive ? 'background:#3b82f6;color:white;' : 'color:#94a3b8;background:#1e293b;'}">${esc(label)}</a>`;
      }).join('')}
    </div>`;
  }

  function themeCard(t) {
    if (!t) return '';
    const isActive = t.is_active;
    return `<div style="background:#1e293b;border:1px solid ${isActive ? '#3b82f6' : '#334155'};border-radius:12px;overflow:hidden;transition:all 0.3s;position:relative">
      ${isActive ? '<div style="position:absolute;top:0;left:0;right:0;background:#3b82f6;color:white;text-align:center;font-size:11px;font-weight:700;padding:4px;z-index:2;letter-spacing:1px">&#9679; ACTIVE THEME</div>' : ''}
      <div style="padding:20px">
        <div style="display:flex;gap:6px;margin-bottom:12px">
          ${swatch(t.primary_color)} ${swatch(t.secondary_color)} ${swatch(t.accent_color)}
        </div>
        <h3 style="margin:0 0 4px;font-size:16px;font-weight:700;color:#f1f5f9">${esc(t.name)}</h3>
        <p style="margin:0 0 10px;font-size:12px;color:#64748b;line-height:1.5;min-height:32px">${esc(t.description || 'No description')}</p>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
          <span style="font-size:11px;color:#94a3b8;background:#0f172a;padding:3px 8px;border-radius:4px">Font: ${esc(t.font_heading)}</span>
          <span style="font-size:11px;color:#94a3b8;background:#0f172a;padding:3px 8px;border-radius:4px">Radius: ${t.border_radius}px</span>
          <span style="font-size:11px;color:#94a3b8;background:#0f172a;padding:3px 8px;border-radius:4px">${esc(t.sidebar_style)}</span>
        </div>
        <!-- Mini Preview -->
        <div style="background:#0f172a;border-radius:8px;overflow:hidden;margin-bottom:14px;border:1px solid #334155">
          <div style="display:flex;height:100px">
            <div style="width:60px;background:${esc(t.sidebar_style === 'dark' ? '#111827' : t.sidebar_style === 'transparent' ? 'transparent' : t.sidebar_style === 'colored' ? t.primary_color + '22' : '#f1f5f9')};border-right:1px solid #1e293b;padding:8px">
              <div style="width:16px;height:16px;border-radius:4px;background:${esc(t.primary_color)};margin-bottom:6px"></div>
              ${[0,1,2,3].map(i => `<div style="height:4px;border-radius:2px;background:${i===0 ? t.primary_color + '44' : '#334155'};margin-bottom:4px"></div>`).join('')}
            </div>
            <div style="flex:1;padding:8px">
              <div style="height:6px;border-radius:3px;background:${esc(t.primary_color)};width:40%;margin-bottom:6px"></div>
              <div style="display:grid;grid-template-columns:1fr 1fr;gap:4px">
                <div style="height:24px;border-radius:4px;background:#1e293b;border:1px solid #334155"></div>
                <div style="height:24px;border-radius:4px;background:#1e293b;border:1px solid #334155"></div>
              </div>
              <div style="height:4px;border-radius:2px;background:#334155;width:70%;margin-top:6px"></div>
              <div style="height:4px;border-radius:2px;background:#334155;width:50%;margin-top:4px"></div>
            </div>
          </div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          ${!isActive ? `<form method="POST" action="${PREFIX}/${t.id}/activate" style="margin:0"><button class="btn" type="submit" style="background:#3b82f6;font-size:12px;padding:6px 12px">Activate</button></form>` : ''}
          <a href="${PREFIX}/editor/${t.id}" class="btn btn-outline" style="font-size:12px;padding:6px 12px">Edit</a>
          <a href="${PREFIX}/preview/${t.id}" class="btn btn-outline" style="font-size:12px;padding:6px 12px">Preview</a>
          <a href="${PREFIX}/components/${t.id}" class="btn btn-outline" style="font-size:12px;padding:6px 12px">Components</a>
          <form method="POST" action="${PREFIX}/${t.id}/duplicate" style="margin:0"><button type="submit" class="btn btn-outline" style="font-size:12px;padding:6px 12px">Duplicate</button></form>
          <a href="${PREFIX}/export/${t.id}" class="btn btn-outline" style="font-size:12px;padding:6px 12px">Export</a>
          <button onclick="confirmDelete(${t.id},'${esc(t.name).replace(/'/g, "\\'")}')" class="btn" style="font-size:12px;padding:6px 12px;background:#dc2626;color:white;border:none;border-radius:8px;cursor:pointer" ${isActive ? 'disabled title="Cannot delete active theme"' : ''}>Delete</button>
        </div>
      </div>
    </div>`;
  }

  function livePreviewHtml(t) {
    if (!t) return '';
    const p = t.primary_color || '#3b82f6';
    const s = t.secondary_color || '#8b5cf6';
    const a = t.accent_color || '#06b6d4';
    const hf = t.font_heading || 'Inter';
    const bf = t.font_body || 'Inter';
    const br = t.border_radius || 8;
    const sbBg = t.sidebar_style === 'dark' ? '#111827' : t.sidebar_style === 'transparent' ? 'transparent' : t.sidebar_style === 'colored' ? p + '18' : '#f1f5f9';
    const sbText = t.sidebar_style === 'dark' || t.sidebar_style === 'colored' ? '#e2e8f0' : '#334155';
    const navItems = ['Dashboard', 'Students', 'Teachers', 'Classes', 'Calendar', 'Reports'];
    return `<div style="border:1px solid #334155;border-radius:12px;overflow:hidden;background:#0f172a">
      <div style="display:flex;height:320px">
        <div style="width:200px;background:${esc(sbBg)};padding:16px;flex-shrink:0;border-right:1px solid #1e293b">
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:20px;padding-bottom:12px;border-bottom:1px solid #1e293b">
            <div style="width:28px;height:28px;border-radius:${br}px;background:${esc(p)}"></div>
            <span style="font-weight:700;font-size:13px;color:${esc(sbText)};font-family:'${esc(hf)}'">My School</span>
          </div>
          ${navItems.map((item, i) =>
            `<div style="padding:8px 12px;border-radius:${br}px;margin-bottom:3px;font-size:12px;color:${esc(sbText)};background:${i === 0 ? p + '22' : 'transparent'};font-weight:${i === 0 ? '600' : '400'};font-family:'${esc(bf)}';border-left:3px solid ${i === 0 ? p : 'transparent'}">${item}</div>`
          ).join('')}
        </div>
        <div style="flex:1;padding:20px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
            <h2 style="font-family:'${esc(hf)}';font-size:20px;color:#f1f5f9;margin:0;font-weight:700">Welcome Back!</h2>
            <div style="display:flex;gap:6px">
              <span style="background:${esc(p)};color:white;padding:5px 12px;border-radius:${br}px;font-size:11px;font-weight:600">Primary</span>
              <span style="background:${esc(s)};color:white;padding:5px 12px;border-radius:${br}px;font-size:11px;font-weight:600">Secondary</span>
              <span style="background:${esc(a)};color:white;padding:5px 12px;border-radius:${br}px;font-size:11px;font-weight:600">Accent</span>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:14px">
            ${[
              { label: 'Students', val: '1,248', color: p },
              { label: 'Teachers', val: '86', color: s },
              { label: 'Attendance', val: '94%', color: a },
              { label: 'Revenue', val: '$42K', color: '#e11d48' }
            ].map(c => `<div style="background:#1e293b;border:1px solid #334155;border-radius:${br}px;padding:12px">
              <div style="font-size:10px;color:#64748b;font-family:'${esc(bf)}'">${c.label}</div>
              <div style="font-size:20px;font-weight:700;color:${esc(c.color)};font-family:'${esc(hf)}';margin-top:3px">${c.val}</div>
            </div>`).join('')}
          </div>
          <p style="font-family:'${esc(bf)}';font-size:13px;color:#94a3b8;line-height:1.6;margin:0">This is a live preview of your school portal theme. Adjust colors, fonts, and layout to see changes in real-time.</p>
        </div>
      </div>
    </div>`;
  }

  function colorPickerField(name, label, value, desc) {
    const v = value || '#3b82f6';
    const rgb = hexToRgb(v);
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #1e293b">
      <div style="flex:1">
        <label style="font-weight:600;font-size:13px;color:#f1f5f9;display:block">${esc(label)}</label>
        <p style="font-size:11px;color:#64748b;margin:2px 0 0">${esc(desc)}</p>
      </div>
      <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
        <div style="position:relative">
          <input type="color" name="${esc(name)}" value="${esc(v)}" id="cp_${name}" style="width:48px;height:40px;border:2px solid #334155;border-radius:10px;cursor:pointer;padding:3px;background:#1e293b">
        </div>
        <div style="display:flex;flex-direction:column;gap:4px">
          <input type="text" name="${esc(name)}" value="${esc(v)}" style="width:110px;padding:7px 10px;border:1px solid #334155;border-radius:8px;font-size:13px;font-family:'Fira Code',monospace;background:#0f172a;color:#f1f5f9" maxlength="7" oninput="this.form.querySelector('input[type=color][name=${esc(name)}]').value=this.value" id="ct_${name}">
          <div style="display:flex;gap:3px">
            <span style="font-size:10px;color:#64748b;font-family:monospace">R:${rgb.r}</span>
            <span style="font-size:10px;color:#64748b;font-family:monospace">G:${rgb.g}</span>
            <span style="font-size:10px;color:#64748b;font-family:monospace">B:${rgb.b}</span>
          </div>
        </div>
        <button type="button" class="btn btn-outline copy-color-btn" data-target="ct_${name}" style="padding:7px 10px;font-size:11px;border-radius:8px;border:1px solid #334155;background:#1e293b;color:#94a3b8;cursor:pointer" title="Copy hex value">Copy</button>
      </div>
    </div>`;
  }

  // ============================================================
  // DATABASE MIGRATION
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool, 'ThemeBuilder', `CREATE TABLE IF NOT EXISTS school_themes (
        id SERIAL PRIMARY KEY,
        name TEXT NOT NULL,
        description TEXT,
        primary_color TEXT DEFAULT '#3b82f6',
        secondary_color TEXT DEFAULT '#8b5cf6',
        accent_color TEXT DEFAULT '#06b6d4',
        font_heading TEXT DEFAULT 'Inter',
        font_body TEXT DEFAULT 'Inter',
        border_radius INT DEFAULT 8,
        sidebar_style TEXT DEFAULT 'dark',
        layout TEXT DEFAULT 'sidebar',
        logo_url TEXT,
        favicon_url TEXT,
        login_bg_image TEXT,
        custom_css TEXT,
        is_active BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ,
        school_id INT DEFAULT 1
      )`);
      console.log('[ThemeBuilder] school_themes table ready');
    } catch (e) {
      console.error('[ThemeBuilder] school_themes migration error:', e.message);
    }
    try {
      await migrateQuery(pool, 'ThemeBuilder', `CREATE TABLE IF NOT EXISTS theme_components (
        id SERIAL PRIMARY KEY,
        theme_id INT REFERENCES school_themes(id) ON DELETE CASCADE,
        component_type TEXT,
        custom_styles JSONB,
        overrides TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      console.log('[ThemeBuilder] theme_components table ready');
    } catch (e) {
      console.error('[ThemeBuilder] theme_components migration error:', e.message);
    }
  })();

  // ============================================================
  // ROUTE 1: GET / - Theme list with live previews
  // ============================================================
  app.get(PREFIX + '/', requireAuth, ah(async (req, res) => {
    const sid = req.query.school_id || 1;
    const { rows: themes } = await pool.query(
      'SELECT * FROM school_themes WHERE school_id = $1 ORDER BY is_active DESC, created_at DESC', [sid]
    );
    const activeCount = themes.filter(t => t.is_active).length;

    const html = `
    <div style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);padding:28px;border-radius:16px;margin-bottom:24px;color:white">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="margin:0;font-size:24px;font-weight:800">&#127912; Visual Theme Builder</h1>
          <p style="opacity:0.9;margin-top:6px;font-size:14px">Create and manage branded themes for your school portal</p>
        </div>
        <div style="display:flex;gap:8px;align-items:center">
          <span style="background:rgba(255,255,255,0.2);padding:6px 14px;border-radius:20px;font-size:12px;font-weight:600">${themes.length} themes &bull; ${activeCount} active</span>
          <a href="${PREFIX}/templates" class="btn" style="background:white;color:#3b82f6;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:10px;font-size:13px">Browse Templates</a>
        </div>
      </div>
    </div>

    <div style="display:flex;gap:12px;margin-bottom:24px;flex-wrap:wrap;align-items:center">
      <input type="text" id="themeSearch" placeholder="Search themes..." style="flex:1;min-width:200px;padding:10px 14px;border:1px solid #334155;border-radius:10px;background:#1e293b;color:#f1f5f9;font-size:13px;outline:none" onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#334155'">
      <select id="themeSort" style="padding:10px 14px;border:1px solid #334155;border-radius:10px;background:#1e293b;color:#f1f5f9;font-size:13px;outline:none">
        <option value="name">Sort by Name</option>
        <option value="date">Sort by Date</option>
        <option value="active">Active First</option>
      </select>
      <form method="POST" action="${PREFIX}/create" style="margin:0">
        <input type="text" name="name" placeholder="New theme name..." required style="padding:10px 14px;border:1px solid #334155;border-radius:10px 0 0 10px;background:#1e293b;color:#f1f5f9;font-size:13px;outline:none;width:200px" onfocus="this.style.borderColor='#3b82f6'" onblur="this.style.borderColor='#334155'">
        <button type="submit" class="btn" style="background:#3b82f6;color:white;border:none;padding:10px 20px;border-radius:0 10px 10px 0;font-size:13px;font-weight:700;cursor:pointer">Create</button>
      </form>
    </div>

    <!-- Stats Row -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px">
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;border-left:4px solid #3b82f6">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Total Themes</div>
        <div style="font-size:28px;font-weight:800;color:#f1f5f9;margin-top:4px">${themes.length}</div>
      </div>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;border-left:4px solid #22c55e">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Active Theme</div>
        <div style="font-size:16px;font-weight:700;color:#22c55e;margin-top:4px">${activeCount > 0 ? esc(themes.find(t => t.is_active)?.name || 'Unknown') : 'None'}</div>
      </div>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;border-left:4px solid #f59e0b">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Dark Sidebar</div>
        <div style="font-size:28px;font-weight:800;color:#f59e0b;margin-top:4px">${themes.filter(t => t.sidebar_style === 'dark').length}</div>
      </div>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;border-left:4px solid #8b5cf6">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Custom CSS</div>
        <div style="font-size:28px;font-weight:800;color:#8b5cf6;margin-top:4px">${themes.filter(t => t.custom_css && t.custom_css.trim().length > 0).length}</div>
      </div>
    </div>

    <div id="themeGrid" style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px">
      ${themes.length === 0 ? `<div style="grid-column:1/-1;text-align:center;padding:60px;color:#64748b">
        <div style="font-size:48px;margin-bottom:16px">&#127912;</div>
        <h3 style="color:#f1f5f9;margin-bottom:8px">No Themes Yet</h3>
        <p style="font-size:14px">Create your first theme or start from a <a href="${PREFIX}/templates" style="color:#3b82f6;text-decoration:underline">template</a></p>
      </div>` : themes.map(t => themeCard(t)).join('')}
    </div>

    <form id="deleteForm" method="POST" style="display:none">
      <input type="hidden" name="_method" value="DELETE">
    </form>

    <script>
    document.getElementById('themeSearch').addEventListener('input', function(){
      var q = this.value.toLowerCase();
      document.querySelectorAll('#themeGrid > div').forEach(function(card){
        var text = card.textContent.toLowerCase();
        card.style.display = text.includes(q) ? '' : 'none';
      });
    });

    document.querySelectorAll('.copy-color-btn').forEach(function(btn){
      btn.addEventListener('click', function(){
        var t = document.getElementById(this.dataset.target);
        if (t && navigator.clipboard) {
          navigator.clipboard.writeText(t.value);
          var orig = this.textContent;
          this.textContent = 'Copied!';
          var self = this;
          setTimeout(function(){ self.textContent = orig; }, 1500);
        }
      });
    });

    function confirmDelete(id, name) {
      if (confirm('Delete theme "' + name + '"? This cannot be undone.')) {
        var f = document.getElementById('deleteForm');
        f.action = '${PREFIX}/' + id;
        f.submit();
      }
    }
    </script>`;

    res.send(renderPage('Theme Builder', html, req.session.user));
  }));

  // ============================================================
  // ROUTE 2: GET /data - JSON themes list
  // ============================================================
  app.get(PREFIX + '/data', requireAuth, ah(async (req, res) => {
    const sid = parseInt(req.query.school_id) || 1;
    const { rows } = await pool.query(
      'SELECT id, name, description, primary_color, secondary_color, accent_color, font_heading, font_body, border_radius, sidebar_style, layout, logo_url, is_active, created_at, updated_at FROM school_themes WHERE school_id = $1 ORDER BY created_at DESC',
      [sid]
    );
    res.json({ success: true, themes: rows, count: rows.length });
  }));

  // ============================================================
  // ROUTE 3: POST /create - Create new theme
  // ============================================================
  app.post(PREFIX + '/create', requireAuth, ah(async (req, res) => {
    const name = String(req.body.name || '').trim().substring(0, 120);
    if (!name) {
      req.session.toast = { type: 'error', message: 'Theme name is required' };
      return res.redirect(PREFIX + '/');
    }
    const description = String(req.body.description || '').trim().substring(0, 500);
    const primary = validateHex(req.body.primary_color) || '#3b82f6';
    const secondary = validateHex(req.body.secondary_color) || '#8b5cf6';
    const accent = validateHex(req.body.accent_color) || '#06b6d4';
    const fontH = FONT_OPTIONS.includes(req.body.font_heading) ? req.body.font_heading : 'Inter';
    const fontB = FONT_OPTIONS.includes(req.body.font_body) ? req.body.font_body : 'Inter';
    const br = Math.max(0, Math.min(32, parseInt(req.body.border_radius) || 8));
    const sidebar = SIDEBAR_STYLES.includes(req.body.sidebar_style) ? req.body.sidebar_style : 'dark';
    const layout = LAYOUT_OPTIONS.includes(req.body.layout) ? req.body.layout : 'sidebar';

    const { rows } = await pool.query(
      `INSERT INTO school_themes (name, description, primary_color, secondary_color, accent_color,
        font_heading, font_body, border_radius, sidebar_style, layout, school_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [name, description, primary, secondary, accent, fontH, fontB, br, sidebar, layout, 1]
    );
    const newId = rows[0].id;
    audit(req.session.user?.email, 'theme_created', { theme_id: newId, name });
    req.session.toast = { type: 'success', message: `Theme "${name}" created` };
    res.redirect(PREFIX + '/editor/' + newId);
  }));

  // ============================================================
  // ROUTE 4: PUT /:id - Update theme
  // ============================================================
  app.put(PREFIX + '/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const { rows: existing } = await pool.query('SELECT id FROM school_themes WHERE id = $1', [id]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Theme not found' });

    const fields = ['name', 'description', 'font_heading', 'font_body', 'sidebar_style', 'layout',
      'logo_url', 'favicon_url', 'login_bg_image', 'custom_css'];
    const sets = []; const vals = []; let i = 1;

    fields.forEach(f => {
      if (req.body[f] !== undefined) {
        const v = String(req.body[f]).substring(0, f === 'custom_css' ? 50000 : 2000);
        sets.push(`${f} = $${i++}`);
        vals.push(f === 'custom_css' ? sanitizeCSS(v) : v);
      }
    });

    ['primary_color', 'secondary_color', 'accent_color'].forEach(f => {
      const v = validateHex(req.body[f]);
      if (v) { sets.push(`${f} = $${i++}`); vals.push(v); }
    });

    if (req.body.border_radius !== undefined) {
      sets.push(`border_radius = $${i++}`);
      vals.push(Math.max(0, Math.min(32, parseInt(req.body.border_radius) || 8)));
    }

    if (sets.length === 0) return res.status(400).json({ success: false, error: 'No fields to update' });

    sets.push('updated_at = NOW()');
    vals.push(id);
    await pool.query(`UPDATE school_themes SET ${sets.join(', ')} WHERE id = $${i}`, vals);

    audit(req.session.user?.email, 'theme_updated', { theme_id: id });
    res.json({ success: true, message: 'Theme updated' });
  }));

  // ============================================================
  // ROUTE 5: DELETE /:id - Delete theme
  // ============================================================
  app.delete(PREFIX + '/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const { rows: theme } = await pool.query('SELECT id, name, is_active FROM school_themes WHERE id = $1', [id]);
    if (!theme.length) return res.status(404).json({ success: false, error: 'Theme not found' });
    if (theme[0].is_active) return res.status(400).json({ success: false, error: 'Cannot delete active theme' });

    await pool.query('DELETE FROM theme_components WHERE theme_id = $1', [id]);
    await pool.query('DELETE FROM school_themes WHERE id = $1', [id]);
    audit(req.session.user?.email, 'theme_deleted', { theme_id: id, name: theme[0].name });

    if (req.accepts('html')) {
      req.session.toast = { type: 'success', message: `Theme "${theme[0].name}" deleted` };
      res.redirect(PREFIX + '/');
    } else {
      res.json({ success: true, message: 'Theme deleted' });
    }
  }));

  // ============================================================
  // ROUTE 6: POST /:id/activate - Set as active theme
  // ============================================================
  app.post(PREFIX + '/:id/activate', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const { rows: theme } = await pool.query('SELECT id, name FROM school_themes WHERE id = $1', [id]);
    if (!theme.length) {
      req.session.toast = { type: 'error', message: 'Theme not found' };
      return res.redirect(PREFIX + '/');
    }

    await pool.query('UPDATE school_themes SET is_active = false WHERE school_id = 1');
    await pool.query('UPDATE school_themes SET is_active = true, updated_at = NOW() WHERE id = $1', [id]);
    audit(req.session.user?.email, 'theme_activated', { theme_id: id, name: theme[0].name });
    req.session.toast = { type: 'success', message: `"${theme[0].name}" is now the active theme` };
    res.redirect(PREFIX + '/');
  }));

  // ============================================================
  // ROUTE 7: GET /editor/:id - Visual theme editor
  // ============================================================
  app.get(PREFIX + '/editor/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const { rows: themes } = await pool.query('SELECT * FROM school_themes WHERE id = $1', [id]);
    if (!themes.length) { req.session.toast = { type: 'error', message: 'Theme not found' }; return res.redirect(PREFIX + '/'); }
    const t = themes[0];

    const fontHeadingOpts = FONT_OPTIONS.map(f =>
      `<option value="${esc(f)}" ${t.font_heading === f ? 'selected' : ''}>${esc(f)}</option>`
    ).join('');
    const fontBodyOpts = FONT_OPTIONS.map(f =>
      `<option value="${esc(f)}" ${t.font_body === f ? 'selected' : ''}>${esc(f)}</option>`
    ).join('');
    const sidebarOpts = SIDEBAR_STYLES.map(s =>
      `<option value="${esc(s)}" ${t.sidebar_style === s ? 'selected' : ''}>${esc(s.charAt(0).toUpperCase() + s.slice(1))}</option>`
    ).join('');
    const layoutOpts = LAYOUT_OPTIONS.map(l =>
      `<option value="${esc(l)}" ${t.layout === l ? 'selected' : ''}>${esc(l.charAt(0).toUpperCase() + l.slice(1))}</option>`
    ).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#3b82f6,#8b5cf6);padding:24px;border-radius:16px;margin-bottom:24px;color:white">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="margin:0;font-size:22px;font-weight:800">&#127912; Theme Editor</h1>
          <p style="opacity:0.9;margin-top:4px;font-size:13px">${esc(t.name)} ${t.is_active ? '&#9679; Active' : ''}</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="${PREFIX}/preview/${t.id}" target="_blank" class="btn" style="background:white;color:#3b82f6;font-weight:700;text-decoration:none;padding:8px 16px;border-radius:10px;font-size:12px">&#9654; Preview</a>
          <a href="${PREFIX}/components/${t.id}" class="btn" style="background:rgba(255,255,255,0.2);color:white;text-decoration:none;padding:8px 16px;border-radius:10px;font-size:12px">Components</a>
          <a href="${PREFIX}/" class="btn" style="background:rgba(255,255,255,0.15);color:white;text-decoration:none;padding:8px 16px;border-radius:10px;font-size:12px">&larr; Back</a>
        </div>
      </div>
    </div>

    <form id="editorForm" method="POST" action="${PREFIX}/${t.id}?_method=PUT">
      <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">

      <!-- Live Preview Panel -->
      <div style="margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <h3 style="margin:0;color:#f1f5f9;font-size:14px;font-weight:700">Live Preview</h3>
          <span style="font-size:11px;color:#64748b">Updates as you change settings</span>
        </div>
        <div id="livePreviewContainer">
          ${livePreviewHtml(t)}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <!-- LEFT COLUMN -->
        <div>
          <!-- Basic Info -->
          <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px">
              <span style="width:28px;height:28px;background:#3b82f6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px">&#9998;</span>
              Basic Information
            </h3>
            <div style="margin-bottom:12px">
              <label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Theme Name</label>
              <input type="text" name="name" value="${esc(t.name)}" required class="editor-input" data-preview="name" style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none">
            </div>
            <div style="margin-bottom:12px">
              <label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Description</label>
              <textarea name="description" rows="3" style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none;resize:vertical">${esc(t.description || '')}</textarea>
            </div>
          </div>

          <!-- Color Palette -->
          <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px">
              <span style="width:28px;height:28px;background:#8b5cf6;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px">&#127912;</span>
              Color Palette
            </h3>
            ${colorPickerField('primary_color', 'Primary Color', t.primary_color, 'Main brand color for buttons, links, and active states')}
            ${colorPickerField('secondary_color', 'Secondary Color', t.secondary_color, 'Secondary actions, gradients, and navigation highlights')}
            ${colorPickerField('accent_color', 'Accent Color', t.accent_color, 'Highlights, badges, warnings, and call-to-action elements')}

            <!-- Color Harmony -->
            <div style="margin-top:14px;padding:14px;background:#0f172a;border-radius:8px;border:1px solid #1e293b">
              <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px;margin-bottom:8px">Color Harmony</div>
              <div id="colorHarmony" style="display:flex;gap:6px;flex-wrap:wrap">
                <div style="text-align:center">
                  <div style="width:40px;height:40px;border-radius:8px;background:${esc(lightenColor(t.primary_color, 30))};border:1px solid #334155"></div>
                  <span style="font-size:9px;color:#64748b">Light</span>
                </div>
                <div style="text-align:center">
                  <div style="width:40px;height:40px;border-radius:8px;background:${esc(t.primary_color)};border:1px solid #334155"></div>
                  <span style="font-size:9px;color:#64748b">Base</span>
                </div>
                <div style="text-align:center">
                  <div style="width:40px;height:40px;border-radius:8px;background:${esc(darkenColor(t.primary_color, 20))};border:1px solid #334155"></div>
                  <span style="font-size:9px;color:#64748b">Dark</span>
                </div>
                <div style="text-align:center">
                  <div style="width:40px;height:40px;border-radius:8px;background:${esc(t.secondary_color)};border:1px solid #334155"></div>
                  <span style="font-size:9px;color:#64748b">Secondary</span>
                </div>
                <div style="text-align:center">
                  <div style="width:40px;height:40px;border-radius:8px;background:${esc(t.accent_color)};border:1px solid #334155"></div>
                  <span style="font-size:9px;color:#64748b">Accent</span>
                </div>
                <div style="text-align:center">
                  <div style="width:40px;height:40px;border-radius:8px;background:${esc(lightenColor(t.secondary_color, 40))};border:1px solid #334155"></div>
                  <span style="font-size:9px;color:#64748b">Tint</span>
                </div>
                <div style="text-align:center">
                  <div style="width:40px;height:40px;border-radius:8px;background:${esc(darkenColor(t.accent_color, 30))};border:1px solid #334155"></div>
                  <span style="font-size:9px;color:#64748b">Shade</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <!-- RIGHT COLUMN -->
        <div>
          <!-- Typography -->
          <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px">
              <span style="width:28px;height:28px;background:#06b6d4;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px">Aa</span>
              Typography
            </h3>
            <div style="margin-bottom:12px">
              <label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Heading Font</label>
              <select name="font_heading" id="selHeading" style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none">
                ${fontHeadingOpts}
              </select>
              <div id="headingSample" style="margin-top:8px;padding:12px;background:#0f172a;border-radius:8px;border:1px solid #1e293b">
                <p style="font-family:'${esc(t.font_heading)}';font-size:20px;font-weight:700;color:#f1f5f9;margin:0">The Quick Brown Fox</p>
              </div>
            </div>
            <div style="margin-bottom:12px">
              <label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Body Font</label>
              <select name="font_body" id="selBody" style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none">
                ${fontBodyOpts}
              </select>
              <div id="bodySample" style="margin-top:8px;padding:12px;background:#0f172a;border-radius:8px;border:1px solid #1e293b">
                <p style="font-family:'${esc(t.font_body)}';font-size:14px;color:#94a3b8;margin:0;line-height:1.6">Education is the most powerful weapon which you can use to change the world.</p>
              </div>
            </div>
            <div>
              <label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Border Radius: <span id="brVal">${t.border_radius}</span>px</label>
              <input type="range" name="border_radius" id="brSlider" min="0" max="32" value="${t.border_radius}" style="width:100%;accent-color:#3b82f6">
              <div style="display:flex;gap:8px;margin-top:8px">
                ${[0, 4, 8, 12, 16, 24].map(v => `<button type="button" onclick="document.getElementById('brSlider').value=${v};document.getElementById('brVal').textContent=${v}" style="width:36px;height:36px;border-radius:${v}px;border:1px solid #334155;background:#0f172a;color:#94a3b8;font-size:10px;cursor:pointer">${v}</button>`).join('')}
              </div>
            </div>
          </div>

          <!-- Layout -->
          <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px">
              <span style="width:28px;height:28px;background:#f59e0b;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px">&#9638;</span>
              Layout Options
            </h3>
            <div style="margin-bottom:12px">
              <label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Sidebar Style</label>
              <select name="sidebar_style" style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none">
                ${sidebarOpts}
              </select>
            </div>
            <div style="margin-bottom:12px">
              <label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Layout Mode</label>
              <select name="layout" style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none">
                ${layoutOpts}
              </select>
            </div>
            <!-- Layout Visual Selection -->
            <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-top:12px">
              ${LAYOUT_OPTIONS.map(l => {
                const isActive = t.layout === l;
                return `<div style="text-align:center;padding:10px;border:2px solid ${isActive ? '#3b82f6' : '#334155'};border-radius:8px;cursor:pointer;background:${isActive ? '#3b82f611' : 'transparent'}" onclick="document.querySelector('select[name=layout]').value='${l}';document.querySelector('select[name=layout]').dispatchEvent(new Event('change'))">
                  <div style="margin:0 auto 6px;width:32px;height:24px;border-radius:3px;border:1px solid #64748b;background:#0f172a;position:relative">
                    ${l === 'sidebar' ? '<div style="position:absolute;left:0;top:0;bottom:0;width:8px;background:#3b82f6;border-radius:3px 0 0 3px"></div>' :
                      l === 'topbar' ? '<div style="position:absolute;top:0;left:0;right:0;height:6px;background:#3b82f6;border-radius:3px 3px 0 0"></div>' :
                      l === 'minimal' ? '' :
                      '<div style="position:absolute;left:0;top:0;bottom:0;width:8px;background:#3b82f6;border-radius:3px 0 0 3px"></div><div style="position:absolute;top:0;left:0;right:0;height:6px;background:#8b5cf6;border-radius:3px 3px 0 0"></div>'}
                  </div>
                  <span style="font-size:9px;color:#94a3b8;text-transform:uppercase">${l}</span>
                </div>`;
              }).join('')}
            </div>
          </div>

          <!-- Branding Assets -->
          <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px">
            <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px">
              <span style="width:28px;height:28px;background:#22c55e;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px">&#128247;</span>
              Branding Assets
            </h3>
            <div style="margin-bottom:12px">
              <label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Logo URL</label>
              <input type="url" name="logo_url" value="${esc(t.logo_url || '')}" placeholder="https://example.com/logo.png" style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none">
            </div>
            <div style="margin-bottom:12px">
              <label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Favicon URL</label>
              <input type="url" name="favicon_url" value="${esc(t.favicon_url || '')}" placeholder="https://example.com/favicon.ico" style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none">
            </div>
            <div>
              <label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Login Background Image</label>
              <input type="url" name="login_bg_image" value="${esc(t.login_bg_image || '')}" placeholder="https://example.com/login-bg.jpg" style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none">
            </div>
          </div>
        </div>
      </div>

      <!-- Custom CSS -->
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;color:#f1f5f9;font-size:15px;font-weight:700;display:flex;align-items:center;gap:8px">
            <span style="width:28px;height:28px;background:#64748b;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:14px">&lt;/&gt;</span>
            Custom CSS
          </h3>
          <span style="font-size:11px;color:#64748b" id="cssCharCount">${(t.custom_css || '').length} chars</span>
        </div>
        <textarea name="custom_css" id="customCssEditor" rows="10" style="width:100%;padding:14px;border:1px solid #334155;border-radius:10px;background:#0f172a;color:#e2e8f0;font-size:13px;font-family:'Fira Code','Cascadia Code','JetBrains Mono',monospace;line-height:1.6;resize:vertical;tab-size:2;outline:none" placeholder="/* Add custom CSS overrides here */
.my-custom-class {
  background: #1e293b;
  border-radius: 12px;
}" spellcheck="false">${esc(t.custom_css || '')}</textarea>
      </div>

      <!-- Save Bar -->
      <div style="position:sticky;bottom:0;background:#0f172a;border-top:1px solid #334155;padding:16px 0;display:flex;justify-content:space-between;align-items:center;z-index:10;margin-top:20px">
        <div style="display:flex;gap:8px">
          <a href="${PREFIX}/" class="btn" style="padding:10px 20px;border-radius:10px;border:1px solid #334155;background:transparent;color:#94a3b8;text-decoration:none;font-size:13px">Cancel</a>
        </div>
        <div style="display:flex;gap:8px">
          ${!t.is_active ? `<form method="POST" action="${PREFIX}/${t.id}/activate" style="margin:0"><button type="submit" class="btn" style="padding:10px 20px;border-radius:10px;border:none;background:#22c55e;color:white;font-size:13px;font-weight:700;cursor:pointer">Activate Theme</button></form>` : ''}
          <button type="submit" class="btn" style="padding:10px 28px;border-radius:10px;border:none;background:linear-gradient(135deg,#3b82f6,#8b5cf6);color:white;font-size:13px;font-weight:700;cursor:pointer;box-shadow:0 4px 15px rgba(59,130,246,0.3)">Save Changes</button>
        </div>
      </div>
    </form>

    <script>
    (function(){
      var form = document.getElementById('editorForm');
      // Heading font live preview
      var selH = document.getElementById('selHeading');
      if(selH) selH.addEventListener('change', function(){
        document.getElementById('headingSample').querySelector('p').style.fontFamily = "'" + this.value + "'";
        updatePreview();
      });
      // Body font live preview
      var selB = document.getElementById('selBody');
      if(selB) selB.addEventListener('change', function(){
        document.getElementById('bodySample').querySelector('p').style.fontFamily = "'" + this.value + "'";
        updatePreview();
      });
      // Border radius slider
      var brSlider = document.getElementById('brSlider');
      if(brSlider) brSlider.addEventListener('input', function(){
        document.getElementById('brVal').textContent = this.value;
        updatePreview();
      });
      // Color pickers sync
      document.querySelectorAll('input[type=color]').forEach(function(cp){
        cp.addEventListener('input', function(){
          var textInput = form.querySelector('input[type=text][name="' + this.name + '"]');
          if(textInput) textInput.value = this.value;
          updatePreview();
        });
      });
      // CSS char count
      var cssTa = document.getElementById('customCssEditor');
      var cssCc = document.getElementById('cssCharCount');
      if(cssTa) cssTa.addEventListener('input', function(){
        cssCc.textContent = this.value.length + ' chars';
      });

      function updatePreview() {
        // Color harmony update
        var p = form.querySelector('input[name=primary_color]').value || '#3b82f6';
        var s = form.querySelector('input[name=secondary_color]').value || '#8b5cf6';
        var a = form.querySelector('input[name=accent_color]').value || '#06b6d4';
        var hf = selH ? selH.value : 'Inter';
        var bf = selB ? selB.value : 'Inter';
        var br = brSlider ? brSlider.value : 8;
        var harmony = document.getElementById('colorHarmony');
        if(harmony) {
          // Simple visual update
        }
        // Note: Full live preview refresh would require AJAX; for simplicity we show the initial preview
      }
    })();
    </script>`;

    res.send(renderPage('Theme Editor — ' + t.name, html, req.session.user));
  }));

  // ============================================================
  // ROUTE 8: GET /preview/:id - Live theme preview
  // ============================================================
  app.get(PREFIX + '/preview/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const { rows: themes } = await pool.query('SELECT * FROM school_themes WHERE id = $1', [id]);
    if (!themes.length) { req.session.toast = { type: 'error', message: 'Theme not found' }; return res.redirect(PREFIX + '/'); }
    const t = themes[0];
    const p = t.primary_color || '#3b82f6';
    const s = t.secondary_color || '#8b5cf6';
    const a = t.accent_color || '#06b6d4';
    const pRgb = hexToRgb(p);
    const { rows: components } = await pool.query(
      'SELECT component_type, custom_styles, overrides FROM theme_components WHERE theme_id = $1', [id]
    );
    const compMap = {};
    components.forEach(c => { compMap[c.component_type] = c; });

    const html = `
    <div style="margin-bottom:20px;display:flex;justify-content:space-between;align-items:center">
      <h2 style="margin:0;color:#f1f5f9;font-size:20px;font-weight:800">Preview: ${esc(t.name)}</h2>
      <a href="${PREFIX}/editor/${t.id}" class="btn" style="background:#3b82f6;color:white;text-decoration:none;padding:8px 16px;border-radius:10px;font-size:12px;font-weight:700">&larr; Back to Editor</a>
    </div>

    <div id="previewFrame" style="border:2px solid #334155;border-radius:16px;overflow:hidden;background:#0f172a">
      <!-- Preview Header Bar -->
      <div style="background:#111827;padding:8px 16px;display:flex;align-items:center;gap:8px;border-bottom:1px solid #334155">
        <div style="display:flex;gap:4px">
          <span style="width:10px;height:10px;border-radius:50%;background:#ef4444"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#f59e0b"></span>
          <span style="width:10px;height:10px;border-radius:50%;background:#22c55e"></span>
        </div>
        <div style="flex:1;text-align:center">
          <span style="font-size:11px;color:#64748b;background:#1e293b;padding:4px 16px;border-radius:20px">school-portal.example.com/dashboard</span>
        </div>
      </div>

      <!-- Mock Portal -->
      <div style="display:flex;min-height:600px">
        <!-- Sidebar -->
        <div style="width:240px;background:${t.sidebar_style === 'dark' ? '#111827' : t.sidebar_style === 'transparent' ? '#0f172a' : t.sidebar_style === 'colored' ? `rgba(${pRgb.r},${pRgb.g},${pRgb.b},0.1)` : '#f1f5f9'};padding:20px;flex-shrink:0;border-right:1px solid #1e293b">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid ${t.sidebar_style === 'dark' ? '#1e293b' : '#e2e8f0'}">
            ${t.logo_url ? `<img src="${esc(t.logo_url)}" style="width:32px;height:32px;border-radius:8px;object-fit:cover">` : `<div style="width:32px;height:32px;border-radius:8px;background:${esc(p)}"></div>`}
            <div>
              <div style="font-weight:700;font-size:14px;color:${t.sidebar_style === 'light' ? '#1f2937' : '#f1f5f9'};font-family:'${esc(t.font_heading)}'">${esc(t.name)}</div>
              <div style="font-size:11px;color:${t.sidebar_style === 'light' ? '#64748b' : '#64748b'}">School Portal</div>
            </div>
          </div>
          ${['Dashboard', 'Students', 'Teachers', 'Classes', 'Calendar', 'Reports', 'Settings'].map((item, i) =>
            `<div style="padding:10px 14px;border-radius:${t.border_radius}px;margin-bottom:3px;font-size:13px;color:${t.sidebar_style === 'light' ? '#475569' : '#cbd5e1'};background:${i === 0 ? p + '22' : 'transparent'};font-weight:${i === 0 ? '600' : '400'};font-family:'${esc(t.font_body)}';cursor:default;display:flex;align-items:center;gap:8px;border-left:3px solid ${i === 0 ? p : 'transparent'}">
              <span style="font-size:14px">${i === 0 ? '&#9776;' : i === 1 ? '&#128100;' : i === 2 ? '&#128187;' : i === 3 ? '&#127979;' : i === 4 ? '&#128197;' : i === 5 ? '&#128200;' : '&#9881;'}</span>
              ${item}
            </div>`
          ).join('')}
        </div>

        <!-- Content Area -->
        <div style="flex:1;padding:24px;overflow-y:auto">
          <!-- Top Bar -->
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;padding-bottom:16px;border-bottom:1px solid #1e293b">
            <div>
              <h1 style="font-family:'${esc(t.font_heading)}';font-size:24px;color:#f1f5f9;margin:0;font-weight:800">Dashboard</h1>
              <p style="font-size:13px;color:#64748b;margin:4px 0 0;font-family:'${esc(t.font_body)}'">Welcome back! Here's what's happening today.</p>
            </div>
            <div style="display:flex;align-items:center;gap:10px">
              <div style="width:36px;height:36px;border-radius:50%;background:${esc(p)};display:flex;align-items:center;justify-content:center;color:white;font-weight:700;font-size:14px">A</div>
            </div>
          </div>

          <!-- Stats Cards -->
          <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:24px">
            ${[
              { label: 'Total Students', val: '1,248', change: '+12%', color: p },
              { label: 'Active Teachers', val: '86', change: '+3%', color: s },
              { label: 'Attendance Rate', val: '94.2%', change: '+1.5%', color: a },
              { label: 'Monthly Revenue', val: '$42,580', change: '+8%', color: '#22c55e' }
            ].map(c => `<div style="background:#1e293b;border:1px solid #334155;border-radius:${t.border_radius}px;padding:16px">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
                <span style="font-size:11px;color:#64748b;font-family:'${esc(t.font_body)}';text-transform:uppercase;letter-spacing:0.5px">${c.label}</span>
                <span style="font-size:11px;color:#22c55e;background:#22c55e11;padding:2px 8px;border-radius:10px">${c.change}</span>
              </div>
              <div style="font-size:26px;font-weight:800;color:${esc(c.color)};font-family:'${esc(t.font_heading)}'">${c.val}</div>
            </div>`).join('')}
          </div>

          <!-- Button Samples -->
          <div style="margin-bottom:24px">
            <h3 style="font-size:14px;color:#94a3b8;margin-bottom:12px;font-weight:600">Button Samples</h3>
            <div style="display:flex;gap:10px;flex-wrap:wrap">
              <button style="background:${esc(p)};color:white;padding:10px 20px;border:none;border-radius:${t.border_radius}px;font-size:13px;font-weight:600;cursor:default">Primary Button</button>
              <button style="background:${esc(s)};color:white;padding:10px 20px;border:none;border-radius:${t.border_radius}px;font-size:13px;font-weight:600;cursor:default">Secondary Button</button>
              <button style="background:${esc(a)};color:white;padding:10px 20px;border:none;border-radius:${t.border_radius}px;font-size:13px;font-weight:600;cursor:default">Accent Button</button>
              <button style="background:transparent;color:${esc(p)};padding:10px 20px;border:2px solid ${esc(p)};border-radius:${t.border_radius}px;font-size:13px;font-weight:600;cursor:default">Outline</button>
              <button style="background:#1e293b;color:#94a3b8;padding:10px 20px;border:1px solid #334155;border-radius:${t.border_radius}px;font-size:13px;font-weight:600;cursor:default">Ghost</button>
            </div>
          </div>

          <!-- Form Inputs Preview -->
          <div style="margin-bottom:24px">
            <h3 style="font-size:14px;color:#94a3b8;margin-bottom:12px;font-weight:600">Form Elements</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
              <input type="text" placeholder="Text input..." style="padding:10px 14px;border:1px solid #334155;border-radius:${t.border_radius}px;background:#0f172a;color:#f1f5f9;font-size:13px;font-family:'${esc(t.font_body)}';outline:none;width:100%">
              <select style="padding:10px 14px;border:1px solid #334155;border-radius:${t.border_radius}px;background:#0f172a;color:#f1f5f9;font-size:13px;font-family:'${esc(t.font_body)}';outline:none;width:100%">
                <option>Select option...</option>
                <option>Option A</option>
                <option>Option B</option>
              </select>
              <textarea placeholder="Textarea..." rows="2" style="padding:10px 14px;border:1px solid #334155;border-radius:${t.border_radius}px;background:#0f172a;color:#f1f5f9;font-size:13px;font-family:'${esc(t.font_body)}';outline:none;resize:vertical;width:100%"></textarea>
              <div style="display:flex;align-items:center;gap:12px;padding:10px 0">
                <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#94a3b8;cursor:pointer">
                  <input type="checkbox" checked style="accent-color:${esc(p)}"> Checkbox
                </label>
                <label style="display:flex;align-items:center;gap:6px;font-size:13px;color:#94a3b8;cursor:pointer">
                  <input type="radio" name="previewRadio" checked style="accent-color:${esc(p)}"> Radio
                </label>
              </div>
            </div>
          </div>

          <!-- Typography Samples -->
          <div style="margin-bottom:24px">
            <h3 style="font-size:14px;color:#94a3b8;margin-bottom:12px;font-weight:600">Typography Scale</h3>
            <div style="background:#1e293b;border:1px solid #334155;border-radius:${t.border_radius}px;padding:20px">
              <h1 style="font-family:'${esc(t.font_heading)}';color:#f1f5f9;margin:0 0 8px;font-size:28px;font-weight:800">Heading 1 Display</h1>
              <h2 style="font-family:'${esc(t.font_heading)}';color:#f1f5f9;margin:0 0 8px;font-size:22px;font-weight:700">Heading 2 Section</h2>
              <h3 style="font-family:'${esc(t.font_heading)}';color:#e2e8f0;margin:0 0 8px;font-size:18px;font-weight:600">Heading 3 Subsection</h3>
              <h4 style="font-family:'${esc(t.font_heading)}';color:#cbd5e1;margin:0 0 12px;font-size:15px;font-weight:600">Heading 4 Detail</h4>
              <p style="font-family:'${esc(t.font_body)}';color:#94a3b8;font-size:14px;line-height:1.7;margin:0 0 8px">Body text — The quick brown fox jumps over the lazy dog. Education empowers individuals and transforms communities through knowledge and critical thinking.</p>
              <p style="font-family:'${esc(t.font_body)}';color:#64748b;font-size:12px;line-height:1.6;margin:0">Small caption text — Secondary information and helper text for form fields and descriptions.</p>
            </div>
          </div>

          <!-- Badge Samples -->
          <div>
            <h3 style="font-size:14px;color:#94a3b8;margin-bottom:12px;font-weight:600">Badges & Status</h3>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <span style="background:#22c55e1a;color:#22c55e;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600">Active</span>
              <span style="background:#f59e0b1a;color:#f59e0b;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600">Pending</span>
              <span style="background:#ef44441a;color:#ef4444;padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600">Inactive</span>
              <span style="background:${p}1a;color:${esc(p)};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600">Primary</span>
              <span style="background:${s}1a;color:${esc(s)};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600">Secondary</span>
              <span style="background:${a}1a;color:${esc(a)};padding:4px 12px;border-radius:20px;font-size:12px;font-weight:600">Accent</span>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Theme Info -->
    <div style="margin-top:20px;background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
      <h3 style="color:#f1f5f9;font-size:14px;font-weight:700;margin:0 0 12px">Theme Configuration</h3>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px">
        <div style="padding:10px;background:#0f172a;border-radius:8px">
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Primary</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px">${swatch(p, 18)} <span style="font-size:12px;color:#f1f5f9;font-family:monospace">${esc(p)}</span></div>
        </div>
        <div style="padding:10px;background:#0f172a;border-radius:8px">
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Secondary</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px">${swatch(s, 18)} <span style="font-size:12px;color:#f1f5f9;font-family:monospace">${esc(s)}</span></div>
        </div>
        <div style="padding:10px;background:#0f172a;border-radius:8px">
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Accent</div>
          <div style="display:flex;align-items:center;gap:6px;margin-top:4px">${swatch(a, 18)} <span style="font-size:12px;color:#f1f5f9;font-family:monospace">${esc(a)}</span></div>
        </div>
        <div style="padding:10px;background:#0f172a;border-radius:8px">
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Fonts</div>
          <div style="font-size:12px;color:#f1f5f9;margin-top:4px">${esc(t.font_heading)} / ${esc(t.font_body)}</div>
        </div>
        <div style="padding:10px;background:#0f172a;border-radius:8px">
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Radius</div>
          <div style="font-size:12px;color:#f1f5f9;margin-top:4px">${t.border_radius}px</div>
        </div>
        <div style="padding:10px;background:#0f172a;border-radius:8px">
          <div style="font-size:10px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Layout</div>
          <div style="font-size:12px;color:#f1f5f9;margin-top:4px">${esc(t.sidebar_style)} / ${esc(t.layout)}</div>
        </div>
      </div>
    </div>`;

    res.send(renderPage('Preview — ' + t.name, html, req.session.user));
  }));

  // ============================================================
  // ROUTE 9: POST /:id/duplicate - Duplicate theme
  // ============================================================
  app.post(PREFIX + '/:id/duplicate', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const { rows: source } = await pool.query('SELECT * FROM school_themes WHERE id = $1', [id]);
    if (!source.length) { req.session.toast = { type: 'error', message: 'Theme not found' }; return res.redirect(PREFIX + '/'); }
    const s = source[0];

    const { rows: dup } = await pool.query(
      `INSERT INTO school_themes (name, description, primary_color, secondary_color, accent_color,
        font_heading, font_body, border_radius, sidebar_style, layout, logo_url, favicon_url,
        login_bg_image, custom_css, school_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [s.name + ' (Copy)', s.description, s.primary_color, s.secondary_color, s.accent_color,
       s.font_heading, s.font_body, s.border_radius, s.sidebar_style, s.layout,
       s.logo_url, s.favicon_url, s.login_bg_image, s.custom_css, s.school_id || 1]
    );

    // Duplicate components
    const { rows: comps } = await pool.query('SELECT * FROM theme_components WHERE theme_id = $1', [id]);
    for (const c of comps) {
      await pool.query(
        `INSERT INTO theme_components (theme_id, component_type, custom_styles, overrides)
         VALUES ($1,$2,$3,$4)`,
        [dup[0].id, c.component_type, c.custom_styles, c.overrides]
      );
    }

    audit(req.session.user?.email, 'theme_duplicated', { from_id: id, to_id: dup[0].id });
    req.session.toast = { type: 'success', message: `Theme duplicated as "${s.name} (Copy)"` };
    res.redirect(PREFIX + '/');
  }));

  // ============================================================
  // ROUTE 10: POST /import - Import theme from JSON
  // ============================================================
  app.post(PREFIX + '/import', requireAuth, ah(async (req, res) => {
    try {
      let data;
      if (req.body.json_data) {
        data = JSON.parse(req.body.json_data);
      } else if (req.file) {
        data = JSON.parse(req.file.buffer.toString('utf-8'));
      } else {
        req.session.toast = { type: 'error', message: 'No JSON data provided' };
        return res.redirect(PREFIX + '/');
      }

      const name = String(data.name || 'Imported Theme').substring(0, 120);
      const description = String(data.description || '').substring(0, 500);
      const primary = validateHex(data.primary_color) || '#3b82f6';
      const secondary = validateHex(data.secondary_color) || '#8b5cf6';
      const accent = validateHex(data.accent_color) || '#06b6d4';
      const fontH = FONT_OPTIONS.includes(data.font_heading) ? data.font_heading : 'Inter';
      const fontB = FONT_OPTIONS.includes(data.font_body) ? data.font_body : 'Inter';
      const br = Math.max(0, Math.min(32, parseInt(data.border_radius) || 8));
      const sidebar = SIDEBAR_STYLES.includes(data.sidebar_style) ? data.sidebar_style : 'dark';
      const layout = LAYOUT_OPTIONS.includes(data.layout) ? data.layout : 'sidebar';

      const { rows } = await pool.query(
        `INSERT INTO school_themes (name, description, primary_color, secondary_color, accent_color,
          font_heading, font_body, border_radius, sidebar_style, layout, logo_url, favicon_url,
          login_bg_image, custom_css, school_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
        [name, description, primary, secondary, accent, fontH, fontB, br, sidebar, layout,
         String(data.logo_url || ''), String(data.favicon_url || ''),
         String(data.login_bg_image || ''), sanitizeCSS(String(data.custom_css || '')), 1]
      );

      // Import components if present
      if (Array.isArray(data.components)) {
        for (const c of data.components) {
          if (c.component_type) {
            await pool.query(
              `INSERT INTO theme_components (theme_id, component_type, custom_styles, overrides)
               VALUES ($1,$2,$3,$4)`,
              [rows[0].id, String(c.component_type).substring(0, 50),
               typeof c.custom_styles === 'object' ? JSON.stringify(c.custom_styles) : null,
               String(c.overrides || '').substring(0, 50000)]
            );
          }
        }
      }

      audit(req.session.user?.email, 'theme_imported', { theme_id: rows[0].id, name });
      req.session.toast = { type: 'success', message: `Theme "${name}" imported successfully` };
      res.redirect(PREFIX + '/editor/' + rows[0].id);
    } catch (e) {
      req.session.toast = { type: 'error', message: 'Import failed: ' + e.message };
      res.redirect(PREFIX + '/');
    }
  }));

  // ============================================================
  // ROUTE 11: GET /export/:id - Export theme as JSON
  // ============================================================
  app.get(PREFIX + '/export/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const { rows: themes } = await pool.query('SELECT * FROM school_themes WHERE id = $1', [id]);
    if (!themes.length) { req.session.toast = { type: 'error', message: 'Theme not found' }; return res.redirect(PREFIX + '/'); }
    const t = themes[0];

    const { rows: components } = await pool.query(
      'SELECT component_type, custom_styles, overrides FROM theme_components WHERE theme_id = $1', [id]
    );

    const exportData = {
      name: t.name,
      description: t.description,
      primary_color: t.primary_color,
      secondary_color: t.secondary_color,
      accent_color: t.accent_color,
      font_heading: t.font_heading,
      font_body: t.font_body,
      border_radius: t.border_radius,
      sidebar_style: t.sidebar_style,
      layout: t.layout,
      logo_url: t.logo_url,
      favicon_url: t.favicon_url,
      login_bg_image: t.login_bg_image,
      custom_css: t.custom_css,
      exported_at: new Date().toISOString(),
      exported_by: req.session.user?.email,
      version: '1.0',
      components: components.map(c => ({
        component_type: c.component_type,
        custom_styles: c.custom_styles,
        overrides: c.overrides
      }))
    };

    if (req.query.download === 'true' || req.query.format === 'file') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="theme-${t.name.toLowerCase().replace(/\s+/g, '-')}.json"`);
      res.send(JSON.stringify(exportData, null, 2));
    } else {
      // Show export page
      const jsonStr = JSON.stringify(exportData, null, 2);
      const html = `
      <div style="background:linear-gradient(135deg,#22c55e,#16a34a);padding:24px;border-radius:16px;margin-bottom:24px;color:white">
        <h1 style="margin:0;font-size:22px">&#128230; Export Theme</h1>
        <p style="opacity:0.9;margin-top:4px;font-size:13px">${esc(t.name)} — Download or copy the theme configuration</p>
      </div>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:20px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;color:#f1f5f9;font-size:14px">Theme JSON</h3>
          <div style="display:flex;gap:8px">
            <button onclick="navigator.clipboard.writeText(document.getElementById('exportJson').textContent);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)" class="btn" style="padding:6px 14px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#94a3b8;font-size:12px;cursor:pointer">Copy</button>
            <a href="${PREFIX}/export/${t.id}?download=true&format=file" class="btn" style="padding:6px 14px;border-radius:8px;border:none;background:#22c55e;color:white;font-size:12px;text-decoration:none;font-weight:600">Download JSON</a>
          </div>
        </div>
        <pre id="exportJson" style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:16px;font-size:12px;font-family:'Fira Code',monospace;color:#94a3b8;overflow-x:auto;max-height:500px;line-height:1.6;white-space:pre-wrap;word-break:break-all">${esc(jsonStr)}</pre>
      </div>
      <div style="display:flex;gap:10px">
        <a href="${PREFIX}/editor/${t.id}" class="btn" style="padding:8px 16px;border-radius:10px;border:1px solid #334155;background:transparent;color:#94a3b8;text-decoration:none;font-size:13px">&larr; Back to Editor</a>
      </div>`;
      res.send(renderPage('Export — ' + t.name, html, req.session.user));
    }
  }));

  // ============================================================
  // ROUTE 12: GET /components/:id - Component customization
  // ============================================================
  app.get(PREFIX + '/components/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const { rows: themes } = await pool.query('SELECT * FROM school_themes WHERE id = $1', [id]);
    if (!themes.length) { req.session.toast = { type: 'error', message: 'Theme not found' }; return res.redirect(PREFIX + '/'); }
    const t = themes[0];

    const { rows: components } = await pool.query(
      'SELECT * FROM theme_components WHERE theme_id = $1 ORDER BY component_type', [id]
    );
    const compMap = {};
    components.forEach(c => { compMap[c.component_type] = c; });

    const compCards = COMPONENT_TYPES.map(ct => {
      const existing = compMap[ct.type];
      const hasCustom = !!existing;
      const styles = existing?.custom_styles || {};
      return `<div style="background:#1e293b;border:1px solid ${hasCustom ? '#3b82f6' : '#334155'};border-radius:12px;padding:16px;transition:all 0.2s">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:10px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="width:32px;height:32px;background:#0f172a;border-radius:8px;display:flex;align-items:center;justify-content:center;font-size:16px">${ct.icon}</span>
            <div>
              <h4 style="margin:0;color:#f1f5f9;font-size:13px;font-weight:700">${esc(ct.label)}</h4>
              <p style="margin:0;font-size:11px;color:#64748b">${esc(ct.desc)}</p>
            </div>
          </div>
          ${hasCustom ? '<span style="font-size:10px;color:#3b82f6;background:#3b82f622;padding:2px 8px;border-radius:10px;font-weight:600">Customized</span>' : ''}
        </div>
        ${hasCustom ? `<div style="background:#0f172a;border-radius:8px;padding:10px;margin-bottom:10px;font-size:11px;color:#64748b;font-family:monospace;max-height:60px;overflow:hidden">${esc(JSON.stringify(styles, null, 2))}</div>` : ''}
        <div style="display:flex;gap:6px">
          <a href="${PREFIX}/components/${existing?.id || 'new'}?theme_id=${id}&type=${ct.type}" class="btn" style="padding:6px 12px;border-radius:8px;border:1px solid #334155;background:#0f172a;color:#94a3b8;text-decoration:none;font-size:11px">${hasCustom ? 'Edit Styles' : 'Customize'}</a>
          ${hasCustom ? `<form method="POST" action="${PREFIX}/components/${existing.id}?_method=DELETE" style="margin:0"><button type="submit" class="btn" style="padding:6px 12px;border-radius:8px;border:none;background:#dc262633;color:#ef4444;font-size:11px;cursor:pointer" onclick="return confirm('Reset this component?')">Reset</button></form>` : ''}
        </div>
      </div>`;
    }).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:24px;border-radius:16px;margin-bottom:24px;color:white">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="margin:0;font-size:22px;font-weight:800">&#9881; Component Customization</h1>
          <p style="opacity:0.9;margin-top:4px;font-size:13px">Fine-tune individual UI components for "${esc(t.name)}"</p>
        </div>
        <a href="${PREFIX}/editor/${t.id}" class="btn" style="background:white;color:#8b5cf6;font-weight:700;text-decoration:none;padding:8px 16px;border-radius:10px;font-size:12px">&larr; Back to Editor</a>
      </div>
    </div>

    <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px 16px;margin-bottom:20px;display:flex;justify-content:space-between;align-items:center">
      <div style="display:flex;align-items:center;gap:10px">
        ${swatch(t.primary_color)} ${swatch(t.secondary_color)} ${swatch(t.accent_color)}
        <span style="font-size:13px;color:#f1f5f9;font-weight:600">${esc(t.name)}</span>
      </div>
      <span style="font-size:12px;color:#64748b">${components.length} customized components</span>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:14px">
      ${compCards}
    </div>`;

    res.send(renderPage('Components — ' + t.name, html, req.session.user));
  }));

  // ============================================================
  // ROUTE 13: PUT /components/:compId - Update component styles
  // ============================================================
  app.put(PREFIX + '/components/:compId', requireAuth, ah(async (req, res) => {
    const compId = parseInt(req.params.compId);
    const { rows: existing } = await pool.query('SELECT * FROM theme_components WHERE id = $1', [compId]);
    if (!existing.length) return res.status(404).json({ success: false, error: 'Component not found' });

    let customStyles = {};
    if (req.body.custom_styles) {
      try { customStyles = typeof req.body.custom_styles === 'string' ? JSON.parse(req.body.custom_styles) : req.body.custom_styles; }
      catch (e) { customStyles = {}; }
    }

    const overrides = sanitizeCSS(String(req.body.overrides || ''));

    await pool.query(
      `UPDATE theme_components SET custom_styles = $1, overrides = $2 WHERE id = $3`,
      [JSON.stringify(customStyles), overrides, compId]
    );

    audit(req.session.user?.email, 'component_updated', { comp_id: compId });
    res.json({ success: true, message: 'Component styles updated' });
  }));

  // Also handle the GET for individual component editing (new or existing)
  app.get(PREFIX + '/components/:compId', requireAuth, ah(async (req, res) => {
    const compId = req.params.compId;
    const themeId = parseInt(req.query.theme_id);
    const compType = req.query.type;

    if (compId === 'new' && themeId && compType) {
      // Create new component
      const { rows: created } = await pool.query(
        `INSERT INTO theme_components (theme_id, component_type) VALUES ($1, $2) RETURNING id`,
        [themeId, compType]
      );
      return res.redirect(`${PREFIX}/components/${created[0].id}?theme_id=${themeId}&type=${compType}`);
    }

    const id = parseInt(compId);
    const { rows: comp } = await pool.query('SELECT * FROM theme_components WHERE id = $1', [id]);
    if (!comp.length) { req.session.toast = { type: 'error', message: 'Component not found' }; return res.redirect(PREFIX + '/'); }
    const c = comp[0];
    const { rows: theme } = await pool.query('SELECT * FROM school_themes WHERE id = $1', [c.theme_id]);
    const t = theme[0] || {};
    const ctInfo = COMPONENT_TYPES.find(ct => ct.type === c.component_type) || { label: c.component_type, desc: '' };
    const styles = c.custom_styles || {};
    const styleFields = Object.entries(styles).map(([key, val]) =>
      `<div style="margin-bottom:10px">
        <label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">${esc(key)}</label>
        <div style="display:flex;gap:6px">
          <input type="text" name="style_${esc(key)}" value="${esc(String(val))}" style="flex:1;padding:8px 10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none">
          <button type="button" onclick="this.parentElement.remove()" style="padding:8px;border-radius:8px;border:1px solid #dc2626;background:transparent;color:#ef4444;font-size:11px;cursor:pointer">Remove</button>
        </div>
      </div>`
    ).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:24px;border-radius:16px;margin-bottom:24px;color:white">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="margin:0;font-size:22px;font-weight:800">${ctInfo.icon} ${esc(ctInfo.label)} Styles</h1>
          <p style="opacity:0.9;margin-top:4px;font-size:13px">Theme: ${esc(t.name || 'Unknown')} &bull; Component: ${esc(c.component_type)}</p>
        </div>
        <a href="${PREFIX}/components/${c.theme_id}" class="btn" style="background:white;color:#8b5cf6;font-weight:700;text-decoration:none;padding:8px 16px;border-radius:10px;font-size:12px">&larr; All Components</a>
      </div>
    </div>

    <form method="POST" action="${PREFIX}/components/${c.id}?_method=PUT">
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <!-- JSON Styles -->
        <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
          <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:14px;font-weight:700">Style Properties (JSON)</h3>
          ${styleFields}
          <div style="display:flex;gap:8px;margin-bottom:12px">
            <input type="text" id="newStyleKey" placeholder="Property name (e.g. background)" style="flex:1;padding:8px 10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none">
            <input type="text" id="newStyleVal" placeholder="Value" style="flex:1;padding:8px 10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none">
            <button type="button" onclick="addStyleField()" style="padding:8px 14px;border-radius:8px;border:none;background:#8b5cf6;color:white;font-size:12px;cursor:pointer;font-weight:600">Add</button>
          </div>
        </div>

        <!-- CSS Overrides -->
        <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
          <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:14px;font-weight:700">CSS Overrides</h3>
          <textarea name="overrides" rows="12" style="width:100%;padding:12px;border:1px solid #334155;border-radius:10px;background:#0f172a;color:#e2e8f0;font-size:13px;font-family:'Fira Code',monospace;line-height:1.6;resize:vertical;outline:none" placeholder="/* CSS rules for this component */&#10;.navbar {&#10;  box-shadow: 0 2px 10px rgba(0,0,0,0.1);&#10;}" spellcheck="false">${esc(c.overrides || '')}</textarea>
          <p style="font-size:11px;color:#64748b;margin:8px 0 0">These CSS rules apply specifically to the ${esc(c.component_type)} component</p>
        </div>
      </div>

      <!-- Quick Presets -->
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-top:16px">
        <h3 style="margin:0 0 12px;color:#f1f5f9;font-size:14px;font-weight:700">Quick Style Presets</h3>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          ${[
            { label: 'Rounded', json: '{"border-radius":"16px","overflow":"hidden"}' },
            { label: 'Shadowed', json: '{"box-shadow":"0 4px 20px rgba(0,0,0,0.15)"}' },
            { label: 'Bordered', json: '{"border":"1px solid #334155"}' },
            { label: 'Glassmorphism', json: '{"background":"rgba(255,255,255,0.05)","backdrop-filter":"blur(10px)","border":"1px solid rgba(255,255,255,0.1)"}' },
            { label: 'Gradient', json: '{"background":"linear-gradient(135deg,#3b82f6,#8b5cf6)"}' },
            { label: 'Compact', json: '{"padding":"8px 12px","font-size":"12px"}' }
          ].map(p => `<button type="button" onclick="applyPreset(${esc(p.json)})" style="padding:8px 14px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#94a3b8;font-size:12px;cursor:pointer;transition:0.2s">${esc(p.label)}</button>`).join('')}
        </div>
      </div>

      <div style="margin-top:20px;display:flex;gap:10px;justify-content:flex-end">
        <a href="${PREFIX}/components/${c.theme_id}" style="padding:10px 20px;border-radius:10px;border:1px solid #334155;background:transparent;color:#94a3b8;text-decoration:none;font-size:13px">Cancel</a>
        <button type="submit" class="btn" style="padding:10px 28px;border-radius:10px;border:none;background:linear-gradient(135deg,#8b5cf6,#6366f1);color:white;font-size:13px;font-weight:700;cursor:pointer">Save Component</button>
      </div>
    </form>

    <script>
    function addStyleField() {
      var key = document.getElementById('newStyleKey');
      var val = document.getElementById('newStyleVal');
      if (!key.value.trim()) return;
      var container = key.closest('div').parentElement;
      var div = document.createElement('div');
      div.style.marginBottom = '10px';
      div.innerHTML = '<label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">' + key.value + '</label><div style="display:flex;gap:6px"><input type="text" name="style_' + key.value + '" value="' + val.value + '" style="flex:1;padding:8px 10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none"><button type="button" onclick="this.parentElement.parentElement.remove()" style="padding:8px;border-radius:8px;border:1px solid #dc2626;background:transparent;color:#ef4444;font-size:11px;cursor:pointer">Remove</button></div>';
      container.insertBefore(div, key.closest('div'));
      key.value = '';
      val.value = '';
    }

    function applyPreset(json) {
      var presets = JSON.parse(json);
      var container = document.querySelector('form > div:first-child');
      Object.entries(presets).forEach(function(entry) {
        var key = entry[0];
        var val = entry[1];
        var existing = document.querySelector('input[name="style_' + key + '"]');
        if (existing) {
          existing.value = val;
        } else {
          var div = document.createElement('div');
          div.style.marginBottom = '10px';
          div.innerHTML = '<label style="font-weight:600;font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">' + key + '</label><div style="display:flex;gap:6px"><input type="text" name="style_' + key + '" value="' + val + '" style="flex:1;padding:8px 10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:13px;outline:none"><button type="button" onclick="this.parentElement.parentElement.remove()" style="padding:8px;border-radius:8px;border:1px solid #dc2626;background:transparent;color:#ef4444;font-size:11px;cursor:pointer">Remove</button></div>';
          container.appendChild(div);
        }
      });
    }
    </script>`;

    res.send(renderPage('Component Editor — ' + ctInfo.label, html, req.session.user));
  }));

  // Handle component deletion
  app.delete(PREFIX + '/components/:compId', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.compId);
    await pool.query('DELETE FROM theme_components WHERE id = $1', [id]);
    audit(req.session.user?.email, 'component_deleted', { comp_id: id });
    if (req.accepts('html')) {
      req.session.toast = { type: 'success', message: 'Component styles reset' };
      res.redirect('back');
    } else {
      res.json({ success: true, message: 'Component deleted' });
    }
  }));

  // ============================================================
  // ROUTE 14: GET /templates - Pre-built theme templates
  // ============================================================
  app.get(PREFIX + '/templates', requireAuth, ah(async (req, res) => {
    const tagFilter = req.query.tag || '';

    const filteredTemplates = tagFilter
      ? THEME_TEMPLATES.filter(t => t.tags && t.tags.includes(tagFilter))
      : THEME_TEMPLATES;

    const allTags = [...new Set(THEME_TEMPLATES.flatMap(t => t.tags || []))];

    const templateCards = filteredTemplates.map(tpl => {
      const p = tpl.primary_color;
      const s = tpl.secondary_color;
      const a = tpl.accent_color;
      return `<div style="background:#1e293b;border:1px solid #334155;border-radius:16px;overflow:hidden;transition:all 0.3s">
        <!-- Mini Preview -->
        <div style="height:140px;background:#0f172a;position:relative;overflow:hidden;border-bottom:1px solid #334155">
          <div style="position:absolute;top:0;left:0;right:0;height:30px;background:linear-gradient(135deg,${esc(p)},${esc(s)})"></div>
          <div style="position:absolute;top:10px;left:12px;display:flex;align-items:center;gap:6px">
            <div style="width:14px;height:14px;border-radius:3px;background:white;opacity:0.9"></div>
            <div style="height:6px;width:60px;background:white;opacity:0.6;border-radius:2px"></div>
          </div>
          <div style="position:absolute;bottom:12px;left:12px;right:12px;display:grid;grid-template-columns:1fr 1fr;gap:6px">
            <div style="height:32px;background:${esc(p)}22;border-radius:${tpl.border_radius}px;border:1px solid ${esc(p)}33"></div>
            <div style="height:32px;background:${esc(s)}22;border-radius:${tpl.border_radius}px;border:1px solid ${esc(s)}33"></div>
          </div>
          <div style="position:absolute;bottom:12px;right:12px">
            <div style="width:40px;height:24px;background:${esc(a)};border-radius:${tpl.border_radius}px"></div>
          </div>
        </div>
        <div style="padding:16px">
          <div style="display:flex;gap:5px;margin-bottom:10px">
            ${swatch(p, 22)} ${swatch(s, 22)} ${swatch(a, 22)}
          </div>
          <h3 style="margin:0 0 4px;font-size:16px;font-weight:700;color:#f1f5f9">${esc(tpl.name)}</h3>
          <p style="margin:0 0 10px;font-size:12px;color:#64748b;line-height:1.5">${esc(tpl.description)}</p>
          <div style="display:flex;gap:4px;flex-wrap:wrap;margin-bottom:12px">
            ${(tpl.tags || []).map(tag => `<span style="font-size:10px;color:#94a3b8;background:#0f172a;padding:3px 8px;border-radius:10px">${esc(tag)}</span>`).join('')}
          </div>
          <div style="font-size:11px;color:#64748b;margin-bottom:10px">
            ${esc(tpl.font_heading)} / ${esc(tpl.font_body)} &bull; ${tpl.border_radius}px &bull; ${esc(tpl.sidebar_style)}
          </div>
          <form method="POST" action="${PREFIX}/apply-template/${tpl.id}" style="margin:0">
            <button type="submit" class="btn" style="width:100%;padding:10px;border-radius:10px;border:none;background:linear-gradient(135deg,${esc(p)},${esc(s)});color:white;font-size:13px;font-weight:700;cursor:pointer">Use Template</button>
          </form>
        </div>
      </div>`;
    }).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#3b82f6,#06b6d4);padding:28px;border-radius:16px;margin-bottom:24px;color:white">
      <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="margin:0;font-size:24px;font-weight:800">&#127912; Theme Templates</h1>
          <p style="opacity:0.9;margin-top:6px;font-size:14px">Choose a pre-built template to get started quickly</p>
        </div>
        <a href="${PREFIX}/" class="btn" style="background:white;color:#3b82f6;font-weight:700;text-decoration:none;padding:10px 20px;border-radius:10px;font-size:13px">&larr; Theme List</a>
      </div>
    </div>

    <!-- Tag Filters -->
    <div style="display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;align-items:center">
      <span style="font-size:12px;color:#64748b;font-weight:600">Filter:</span>
      <a href="${PREFIX}/templates" style="padding:6px 14px;border-radius:20px;font-size:12px;text-decoration:none;${!tagFilter ? 'background:#3b82f6;color:white;font-weight:600;' : 'background:#1e293b;color:#94a3b8;border:1px solid #334155;'}">All</a>
      ${allTags.map(tag => `<a href="${PREFIX}/templates?tag=${encodeURIComponent(tag)}" style="padding:6px 14px;border-radius:20px;font-size:12px;text-decoration:none;${tagFilter === tag ? 'background:#3b82f6;color:white;font-weight:600;' : 'background:#1e293b;color:#94a3b8;border:1px solid #334155;'}">${esc(tag)}</a>`).join('')}
    </div>

    <!-- Import Section -->
    <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:20px">
      <h3 style="margin:0 0 12px;color:#f1f5f9;font-size:14px;font-weight:700">Import Theme from JSON</h3>
      <form method="POST" action="${PREFIX}/import" enctype="multipart/form-data">
        <div style="display:flex;gap:10px;align-items:start">
          <div style="flex:1">
            <textarea name="json_data" rows="3" placeholder='Paste theme JSON here...' style="width:100%;padding:10px;border:1px solid #334155;border-radius:8px;background:#0f172a;color:#f1f5f9;font-size:12px;font-family:monospace;outline:none;resize:vertical"></textarea>
          </div>
          <button type="submit" class="btn" style="padding:10px 20px;border-radius:10px;border:none;background:#22c55e;color:white;font-size:13px;font-weight:700;cursor:pointer;white-space:nowrap">Import Theme</button>
        </div>
      </form>
    </div>

    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px">
      ${templateCards}
    </div>`;

    res.send(renderPage('Theme Templates', html, req.session.user));
  }));

  // ============================================================
  // ROUTE 15: POST /apply-template/:templateId - Apply template
  // ============================================================
  app.post(PREFIX + '/apply-template/:templateId', requireAuth, ah(async (req, res) => {
    const tplId = req.params.templateId;
    const tpl = THEME_TEMPLATES.find(t => t.id === tplId);
    if (!tpl) { req.session.toast = { type: 'error', message: 'Template not found' }; return res.redirect(PREFIX + '/templates'); }

    const { rows } = await pool.query(
      `INSERT INTO school_themes (name, description, primary_color, secondary_color, accent_color,
        font_heading, font_body, border_radius, sidebar_style, layout, school_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [tpl.name, tpl.description, tpl.primary_color, tpl.secondary_color, tpl.accent_color,
       tpl.font_heading, tpl.font_body, tpl.border_radius, tpl.sidebar_style, tpl.layout, 1]
    );

    audit(req.session.user?.email, 'template_applied', { template_id: tplId, theme_id: rows[0].id });
    req.session.toast = { type: 'success', message: `"${tpl.name}" template applied — customize it in the editor` };
    res.redirect(PREFIX + '/editor/' + rows[0].id);
  }));

  // ============================================================
  // ROUTE 16: GET /settings - Theme settings
  // ============================================================
  app.get(PREFIX + '/settings', requireAuth, ah(async (req, res) => {
    const sid = 1;
    const { rows: themes } = await pool.query(
      'SELECT * FROM school_themes WHERE school_id = $1 ORDER BY created_at DESC', [sid]
    );
    const activeTheme = themes.find(t => t.is_active);
    const totalComponents = (await pool.query(
      'SELECT COUNT(*) as cnt FROM theme_components tc JOIN school_themes st ON tc.theme_id = st.id WHERE st.school_id = $1', [sid]
    )).rows[0].cnt;

    const html = `
    <div style="background:linear-gradient(135deg,#475569,#64748b);padding:24px;border-radius:16px;margin-bottom:24px;color:white">
      <h1 style="margin:0;font-size:22px;font-weight:800">&#9881; Theme Builder Settings</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:13px">Global configuration for the Visual Theme Builder</p>
    </div>

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <!-- Current Theme Info -->
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
        <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:15px;font-weight:700">Active Theme</h3>
        ${activeTheme ? `
          <div style="display:flex;gap:6px;margin-bottom:12px">
            ${swatch(activeTheme.primary_color)} ${swatch(activeTheme.secondary_color)} ${swatch(activeTheme.accent_color)}
          </div>
          <p style="font-size:16px;color:#f1f5f9;font-weight:700;margin:0 0 4px">${esc(activeTheme.name)}</p>
          <p style="font-size:12px;color:#64748b;margin:0 0 8px">${esc(activeTheme.description || 'No description')}</p>
          <div style="display:flex;gap:8px;flex-wrap:wrap">
            <span style="font-size:11px;color:#94a3b8;background:#0f172a;padding:4px 8px;border-radius:6px">${esc(activeTheme.font_heading)}</span>
            <span style="font-size:11px;color:#94a3b8;background:#0f172a;padding:4px 8px;border-radius:6px">${esc(activeTheme.font_body)}</span>
            <span style="font-size:11px;color:#94a3b8;background:#0f172a;padding:4px 8px;border-radius:6px">${activeTheme.border_radius}px radius</span>
            <span style="font-size:11px;color:#94a3b8;background:#0f172a;padding:4px 8px;border-radius:6px">${esc(activeTheme.sidebar_style)} sidebar</span>
            <span style="font-size:11px;color:#94a3b8;background:#0f172a;padding:4px 8px;border-radius:6px">${esc(activeTheme.layout)} layout</span>
          </div>
          <div style="margin-top:12px">
            <a href="${PREFIX}/editor/${activeTheme.id}" class="btn" style="background:#3b82f6;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:12px;font-weight:600">Edit Active Theme</a>
          </div>
        ` : `<div style="text-align:center;padding:20px;color:#64748b">
          <div style="font-size:32px;margin-bottom:8px">&#127912;</div>
          <p>No active theme set</p>
          <a href="${PREFIX}/" class="btn" style="margin-top:8px;display:inline-block;background:#3b82f6;color:white;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:12px">Create Theme</a>
        </div>`}
      </div>

      <!-- Statistics -->
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
        <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:15px;font-weight:700">Builder Statistics</h3>
        <div style="display:grid;gap:10px">
          ${[
            { label: 'Total Themes', val: themes.length, color: '#3b82f6' },
            { label: 'Custom Components', val: totalComponents, color: '#8b5cf6' },
            { label: 'Available Templates', val: THEME_TEMPLATES.length, color: '#06b6d4' },
            { label: 'Dark Sidebar Themes', val: themes.filter(t => t.sidebar_style === 'dark').length, color: '#f59e0b' },
            { label: 'Themes with Custom CSS', val: themes.filter(t => t.custom_css && t.custom_css.trim().length > 0).length, color: '#22c55e' },
            { label: 'Available Fonts', val: FONT_OPTIONS.length, color: '#ef4444' }
          ].map(s => `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:#0f172a;border-radius:8px">
            <span style="font-size:13px;color:#94a3b8">${esc(s.label)}</span>
            <span style="font-size:16px;font-weight:800;color:${esc(s.color)}">${s.val}</span>
          </div>`).join('')}
        </div>
      </div>

      <!-- Font Registry -->
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
        <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:15px;font-weight:700">Available Fonts</h3>
        <div style="display:grid;gap:6px;max-height:300px;overflow-y:auto">
          ${FONT_OPTIONS.map((f, i) => `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#0f172a;border-radius:8px;border:1px solid #1e293b">
            <span style="font-family:'${esc(f)}';font-size:14px;color:#f1f5f9;font-weight:600">${esc(f)}</span>
            <span style="font-size:11px;color:#64748b">${themes.filter(t => t.font_heading === f || t.font_body === f).length} themes</span>
          </div>`).join('')}
        </div>
      </div>

      <!-- Available Sidebar Styles & Layouts -->
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
        <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:15px;font-weight:700">Layout Options Reference</h3>
        <div style="margin-bottom:16px">
          <h4 style="margin:0 0 8px;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px">Sidebar Styles</h4>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">
            ${SIDEBAR_STYLES.map(s => `<div style="padding:10px;background:#0f172a;border-radius:8px;border:1px solid #1e293b">
              <span style="font-size:13px;color:#f1f5f9;font-weight:600">${esc(s.charAt(0).toUpperCase() + s.slice(1))}</span>
              <span style="font-size:11px;color:#64748b;display:block;margin-top:2px">${themes.filter(t => t.sidebar_style === s).length} themes</span>
            </div>`).join('')}
          </div>
        </div>
        <div>
          <h4 style="margin:0 0 8px;color:#94a3b8;font-size:12px;text-transform:uppercase;letter-spacing:1px">Layout Modes</h4>
          <div style="display:grid;grid-template-columns:repeat(2,1fr);gap:6px">
            ${LAYOUT_OPTIONS.map(l => `<div style="padding:10px;background:#0f172a;border-radius:8px;border:1px solid #1e293b">
              <span style="font-size:13px;color:#f1f5f9;font-weight:600">${esc(l.charAt(0).toUpperCase() + l.slice(1))}</span>
              <span style="font-size:11px;color:#64748b;display:block;margin-top:2px">${themes.filter(t => t.layout === l).length} themes</span>
            </div>`).join('')}
          </div>
        </div>
      </div>

      <!-- Bulk Actions -->
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;grid-column:1/-1">
        <h3 style="margin:0 0 16px;color:#f1f5f9;font-size:15px;font-weight:700">Bulk Actions</h3>
        <div style="display:flex;gap:10px;flex-wrap:wrap">
          <form method="POST" action="${PREFIX}/import" style="margin:0">
            <button type="submit" class="btn" style="padding:10px 20px;border-radius:10px;border:none;background:#22c55e;color:white;font-size:13px;font-weight:700;cursor:pointer">Import Theme JSON</button>
          </form>
          <a href="${PREFIX}/templates" class="btn" style="padding:10px 20px;border-radius:10px;border:1px solid #334155;background:transparent;color:#94a3b8;text-decoration:none;font-size:13px">Browse Templates</a>
          ${activeTheme ? `<a href="${PREFIX}/export/${activeTheme.id}" class="btn" style="padding:10px 20px;border-radius:10px;border:1px solid #334155;background:transparent;color:#94a3b8;text-decoration:none;font-size:13px">Export Active Theme</a>` : ''}
        </div>
        <div style="margin-top:16px;padding:14px;background:#0f172a;border-radius:10px;border:1px solid #1e293b">
          <h4 style="margin:0 0 8px;color:#f1f5f9;font-size:13px;font-weight:600">API Endpoints</h4>
          <div style="display:grid;gap:6px;font-family:monospace;font-size:12px">
            ${[
              ['GET', PREFIX + '/data', 'List all themes (JSON)'],
              ['POST', PREFIX + '/create', 'Create new theme'],
              ['PUT', PREFIX + '/:id', 'Update theme'],
              ['DELETE', PREFIX + '/:id', 'Delete theme'],
              ['POST', PREFIX + '/:id/activate', 'Activate theme'],
              ['POST', PREFIX + '/:id/duplicate', 'Duplicate theme'],
              ['POST', PREFIX + '/import', 'Import from JSON'],
              ['GET', PREFIX + '/export/:id', 'Export as JSON']
            ].map(([method, path, desc]) => `<div style="display:flex;gap:8px;align-items:center">
              <span style="color:${method === 'GET' ? '#22c55e' : method === 'POST' ? '#3b82f6' : method === 'PUT' ? '#f59e0b' : '#ef4444'};font-weight:700;min-width:50px">${method}</span>
              <span style="color:#94a3b8">${esc(path)}</span>
              <span style="color:#64748b">— ${esc(desc)}</span>
            </div>`).join('')}
          </div>
        </div>
      </div>
    </div>`;

    res.send(renderPage('Theme Builder Settings', html, req.session.user));
  }));

  console.log('[ThemeBuilder] Module loaded with prefix: ' + PREFIX);
};
