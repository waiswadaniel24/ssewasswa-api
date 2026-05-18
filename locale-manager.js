// ============================================================
// SCHOOL SAAS PORTAL — Locale / Language Manager Module
// Multi-language support: locale CRUD, translation key management,
// translation editor with bulk save, import/export, missing
// translation detection, progress tracking
// ============================================================
// Usage in server.js:
//   const localeManager = require('./locale-manager');
//   localeManager(app, pool, { renderPage, ah, requireAuth, audit, esc });
// ============================================================

'use strict';

module.exports = function localeManager(app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c) => c);
  const ah = opts.ah || ((fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const tenantId = (req) => req.session?.user?.tenant_id || 0;

  // ============================================================
  // CONSTANTS
  // ============================================================
  const DIRECTION_OPTIONS = ['ltr', 'rtl'];
  const CATEGORY_OPTIONS = ['general', 'auth', 'navigation', 'dashboard', 'forms', 'messages', 'emails', 'reports', 'settings', 'errors', 'validation'];
  const BULK_SAVE_LIMIT = 500;
  const IMPORT_LIMIT = 2000;

  const PRESET_LOCALES = [
    { code: 'en',    name: 'English',       native_name: 'English',       direction: 'ltr' },
    { code: 'es',    name: 'Spanish',        native_name: 'Español',      direction: 'ltr' },
    { code: 'fr',    name: 'French',         native_name: 'Français',     direction: 'ltr' },
    { code: 'de',    name: 'German',         native_name: 'Deutsch',      direction: 'ltr' },
    { code: 'ar',    name: 'Arabic',         native_name: 'العربية',      direction: 'rtl' },
    { code: 'hi',    name: 'Hindi',          native_name: 'हिन्दी',        direction: 'ltr' },
    { code: 'pt',    name: 'Portuguese',     native_name: 'Português',    direction: 'ltr' },
    { code: 'sw',    name: 'Swahili',        native_name: 'Kiswahili',    direction: 'ltr' },
    { code: 'am',    name: 'Amharic',        native_name: 'አማርኛ',        direction: 'ltr' },
    { code: 'zh',    name: 'Chinese',        native_name: '中文',         direction: 'ltr' },
    { code: 'ja',    name: 'Japanese',       native_name: '日本語',       direction: 'ltr' },
    { code: 'ko',    name: 'Korean',         native_name: '한국어',       direction: 'ltr' },
    { code: 'ru',    name: 'Russian',        native_name: 'Русский',      direction: 'ltr' },
    { code: 'tr',    name: 'Turkish',        native_name: 'Türkçe',       direction: 'ltr' },
    { code: 'vi',    name: 'Vietnamese',     native_name: 'Tiếng Việt',   direction: 'ltr' },
    { code: 'th',    name: 'Thai',           native_name: 'ไทย',         direction: 'ltr' },
    { code: 'nl',    name: 'Dutch',          native_name: 'Nederlands',   direction: 'ltr' },
    { code: 'it',    name: 'Italian',        native_name: 'Italiano',     direction: 'ltr' },
    { code: 'pl',    name: 'Polish',         native_name: 'Polski',       direction: 'ltr' },
    { code: 'fa',    name: 'Persian',        native_name: 'فارسی',       direction: 'rtl' },
  ];

  const SEED_KEYS = [
    { key: 'welcome.title',             category: 'general',    context: 'Main dashboard welcome heading' },
    { key: 'welcome.subtitle',          category: 'general',    context: 'Subtitle under welcome heading' },
    { key: 'nav.dashboard',             category: 'navigation', context: 'Dashboard nav link' },
    { key: 'nav.students',              category: 'navigation', context: 'Students nav link' },
    { key: 'nav.teachers',              category: 'navigation', context: 'Teachers nav link' },
    { key: 'nav.classes',               category: 'navigation', context: 'Classes nav link' },
    { key: 'nav.settings',              category: 'navigation', context: 'Settings nav link' },
    { key: 'nav.logout',                category: 'navigation', context: 'Logout nav link' },
    { key: 'auth.login',                category: 'auth',       context: 'Login button' },
    { key: 'auth.register',             category: 'auth',       context: 'Register button' },
    { key: 'auth.forgot_password',      category: 'auth',       context: 'Forgot password link' },
    { key: 'auth.email',                category: 'auth',       context: 'Email field label' },
    { key: 'auth.password',             category: 'auth',       context: 'Password field label' },
    { key: 'forms.save',                category: 'forms',      context: 'Save form button' },
    { key: 'forms.cancel',              category: 'forms',      context: 'Cancel form button' },
    { key: 'forms.delete',              category: 'forms',      context: 'Delete confirmation button' },
    { key: 'forms.search',              category: 'forms',      context: 'Search input placeholder' },
    { key: 'messages.success',          category: 'messages',   context: 'Generic success message' },
    { key: 'messages.error',            category: 'messages',   context: 'Generic error message' },
    { key: 'messages.no_results',       category: 'messages',   context: 'No results found message' },
    { key: 'messages.confirm_delete',   category: 'messages',   context: 'Delete confirmation prompt' },
    { key: 'reports.total_students',    category: 'reports',    context: 'Total students stat label' },
    { key: 'reports.attendance_rate',   category: 'reports',    context: 'Attendance rate stat label' },
    { key: 'settings.language',         category: 'settings',   context: 'Language setting label' },
    { key: 'errors.page_not_found',     category: 'errors',     context: '404 page title' },
    { key: 'errors.server_error',       category: 'errors',     context: '500 page title' },
    { key: 'errors.unauthorized',       category: 'errors',     context: '403 page title' },
    { key: 'validation.required',       category: 'validation', context: 'Required field error' },
    { key: 'validation.email_invalid',  category: 'validation', context: 'Invalid email error' },
    { key: 'validation.min_length',     category: 'validation', context: 'Min length error with {min}' },
  ];

  // ============================================================
  // HELPERS
  // ============================================================
  function progressBadge(pct) {
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    let color = '#ef4444';
    if (p >= 80) color = '#22c55e';
    else if (p >= 50) color = '#f59e0b';
    else if (p >= 25) color = '#f97316';
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${color}22;color:${color}">${p}%</span>`;
  }

  function progressBar(pct, width) {
    const w = width || 120;
    const p = Math.max(0, Math.min(100, Math.round(pct)));
    let color = '#ef4444';
    if (p >= 80) color = '#22c55e';
    else if (p >= 50) color = '#f59e0b';
    else if (p >= 25) color = '#f97316';
    return `<div style="width:${w}px;height:8px;background:#1e293b;border-radius:4px;overflow:hidden;display:inline-block;vertical-align:middle">
      <div style="width:${p}%;height:100%;background:${color};border-radius:4px;transition:width 0.3s"></div>
    </div>`;
  }

  function localeNav(active) {
    const links = [
      ['/', 'Locales'], ['/editor', 'Editor'], ['/keys', 'Translation Keys'],
      ['/import', 'Import/Export'], ['/missing', 'Missing Translations']
    ];
    return `<div style="display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap;border-bottom:1px solid #1e293b;padding-bottom:12px">
      ${links.map(([href, label]) => `<a href="/admin/locales${href}" class="btn btn-sm ${active === href ? '' : 'btn-outline'}" style="${active === href ? 'background:#3b82f6;color:white' : 'border-color:#334155;color:#94a3b8'}">${esc(label)}</a>`).join('')}
    </div>`;
  }

  async function recalcProgress(localeId) {
    const totalKeys = (await pool.query('SELECT COUNT(*) FROM translation_keys')).rows[0].count;
    const translated = (await pool.query(
      'SELECT COUNT(*) FROM translations WHERE locale_id = $1 AND value IS NOT NULL AND value <> \'\'',
      [localeId]
    )).rows[0].count;
    const pct = totalKeys > 0 ? Math.round((parseInt(translated) / parseInt(totalKeys)) * 100) : 0;
    await pool.query('UPDATE locales SET translation_progress = $1 WHERE id = $2', [pct, localeId]);
    return pct;
  }

  async function recalcAllProgress() {
    const locales = (await pool.query('SELECT id FROM locales WHERE is_active = true')).rows;
    for (const loc of locales) {
      await recalcProgress(loc.id);
    }
  }

  function darkCard(title, body) {
    return `<div class="card" style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px">
      ${title ? `<h3 style="margin:0 0 14px;color:#e2e8f0;font-size:16px">${title}</h3>` : ''}
      ${body}
    </div>`;
  }

  // ============================================================
  // DATABASE MIGRATION
  // ============================================================
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS locales (
        id SERIAL PRIMARY KEY,
        code TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        native_name TEXT,
        direction TEXT DEFAULT 'ltr',
        is_active BOOLEAN DEFAULT true,
        is_default BOOLEAN DEFAULT false,
        translation_progress INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        school_id INT DEFAULT 1
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS translation_keys (
        id SERIAL PRIMARY KEY,
        key TEXT UNIQUE NOT NULL,
        category TEXT DEFAULT 'general',
        context TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS translations (
        id SERIAL PRIMARY KEY,
        locale_id INT REFERENCES locales(id) ON DELETE CASCADE,
        key_id INT REFERENCES translation_keys(id) ON DELETE CASCADE,
        value TEXT,
        is_verified BOOLEAN DEFAULT false,
        last_modified_by INT,
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(locale_id, key_id)
      )`);
      // Seed translation keys
      for (const sk of SEED_KEYS) {
        await pool.query(
          `INSERT INTO translation_keys (key, category, context) VALUES ($1, $2, $3) ON CONFLICT (key) DO NOTHING`,
          [sk.key, sk.category, sk.context]
        );
      }
      console.log('[LocaleManager] Tables ready, seeded translation keys');
    } catch (e) {
      console.error('[LocaleManager] Migration error:', e.message);
    }
  })();

  // ============================================================
  // ROUTE 1: GET /admin/locales — Locale dashboard
  // ============================================================
  app.get('/admin/locales', requireAuth, ah(async (req, res) => {
    await recalcAllProgress();
    const locales = (await pool.query(
      'SELECT * FROM locales ORDER BY is_default DESC, is_active DESC, name ASC'
    )).rows;
    const totalKeys = (await pool.query('SELECT COUNT(*) FROM translation_keys')).rows[0].count;
    const activeCount = locales.filter(l => l.is_active).length;
    const defaultLocale = locales.find(l => l.is_default);
    const avgProgress = locales.length > 0
      ? Math.round(locales.reduce((s, l) => s + (l.translation_progress || 0), 0) / locales.length)
      : 0;

    const cards = locales.map(loc => `
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;display:flex;align-items:center;gap:16px;transition:0.2s">
        <div style="width:56px;height:56px;border-radius:12px;background:${loc.is_default ? '#3b82f622' : '#334155'};display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">
          ${loc.direction === 'rtl' ? '🔄' : '🌐'}
        </div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <strong style="font-size:15px;color:#e2e8f0">${esc(loc.name)}</strong>
            <span style="font-size:12px;color:#94a3b8">${esc(loc.code)}</span>
            ${loc.is_default ? '<span style="font-size:10px;padding:2px 8px;background:#3b82f6;color:white;border-radius:10px;font-weight:600">DEFAULT</span>' : ''}
            ${!loc.is_active ? '<span style="font-size:10px;padding:2px 8px;background:#ef444422;color:#ef4444;border-radius:10px;font-weight:600">DISABLED</span>' : ''}
          </div>
          ${loc.native_name ? `<div style="font-size:12px;color:#64748b;margin-top:2px">${esc(loc.native_name)}</div>` : ''}
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            ${progressBar(loc.translation_progress)}
            ${progressBadge(loc.translation_progress)}
            <span style="font-size:11px;color:#64748b">direction: ${esc(loc.direction)}</span>
          </div>
        </div>
        <div style="display:flex;flex-direction:column;gap:4px;flex-shrink:0">
          <a href="/admin/locales/editor/${loc.id}" class="btn btn-sm" style="background:#3b82f6;padding:6px 12px;font-size:11px">Edit Translations</a>
          <form method="POST" action="/admin/locales/${loc.id}/toggle" style="margin:0">
            <button type="submit" class="btn btn-sm btn-outline" style="padding:6px 12px;font-size:11px;border-color:#334155;color:#94a3b8">
              ${loc.is_active ? 'Disable' : 'Enable'}
            </button>
          </form>
        </div>
      </div>
    `).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#3b82f6,#2563eb);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1 style="margin:0">&#127760; Language / Locale Manager</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Manage languages, translations, and localization for your school portal</p>
    </div>
    ${localeNav('/')}
    <!-- Stats -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">
      ${[
        { label: 'Total Locales', val: locales.length, icon: '🌐' },
        { label: 'Active', val: activeCount, icon: '✅' },
        { label: 'Translation Keys', val: totalKeys, icon: '🔑' },
        { label: 'Avg Progress', val: avgProgress + '%', icon: '📊' }
      ].map(s => `<div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">${esc(s.label)}</div>
        <div style="font-size:24px;font-weight:700;color:#e2e8f0;margin-top:4px">${s.icon} ${esc(String(s.val))}</div>
      </div>`).join('')}
    </div>
    <!-- Add locale form -->
    <div class="card" style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:20px">
      <h3 style="color:#e2e8f0;margin:0 0 14px">Add New Locale</h3>
      <form method="POST" action="/admin/locales/create" style="display:grid;grid-template-columns:1fr 1fr 1fr auto auto auto;gap:10px;align-items:end">
        <div>
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Code (e.g. en, fr, ar)</label>
          <input type="text" name="code" placeholder="en" maxlength="10" required
            style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;width:100%;font-size:13px">
        </div>
        <div>
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Name (English)</label>
          <input type="text" name="name" placeholder="English" required
            style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;width:100%;font-size:13px">
        </div>
        <div>
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Native Name</label>
          <input type="text" name="native_name" placeholder="English"
            style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;width:100%;font-size:13px">
        </div>
        <div>
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Direction</label>
          <select name="direction" style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;width:100%;font-size:13px">
            ${DIRECTION_OPTIONS.map(d => `<option value="${d}">${d.toUpperCase()}</option>`).join('')}
          </select>
        </div>
        <button type="submit" class="btn" style="background:#3b82f6;padding:8px 20px;font-size:13px;white-space:nowrap">Add Locale</button>
      </form>
    </div>
    <!-- Locale list -->
    <div style="display:flex;flex-direction:column;gap:10px">${cards}</div>`;
    res.send(renderPage('Locale Manager', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /admin/locales/data — JSON locales list
  // ============================================================
  app.get('/admin/locales/data', requireAuth, ah(async (req, res) => {
    const locales = (await pool.query(
      'SELECT id, code, name, native_name, direction, is_active, is_default, translation_progress, created_at FROM locales ORDER BY name ASC'
    )).rows;
    res.json({ success: true, data: locales, count: locales.length });
  }));

  // ============================================================
  // ROUTE 3: POST /admin/locales/create — Add new locale
  // ============================================================
  app.post('/admin/locales/create', requireAuth, ah(async (req, res) => {
    const code = String(req.body.code || '').trim().toLowerCase().replace(/[^a-z0-9-]/g, '').substring(0, 10);
    const name = String(req.body.name || '').trim().substring(0, 100);
    const native_name = String(req.body.native_name || name).trim().substring(0, 100);
    const direction = DIRECTION_OPTIONS.includes(req.body.direction) ? req.body.direction : 'ltr';
    if (!code || !name) {
      req.session.toast = { type: 'error', message: 'Locale code and name are required' };
      return res.redirect('/admin/locales');
    }
    // Check for duplicate code
    const existing = (await pool.query('SELECT id FROM locales WHERE code = $1', [code])).rows[0];
    if (existing) {
      req.session.toast = { type: 'error', message: `Locale "${code}" already exists` };
      return res.redirect('/admin/locales');
    }
    const result = (await pool.query(
      'INSERT INTO locales (code, name, native_name, direction, school_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [code, name, native_name, direction, 1]
    )).rows[0];
    await recalcProgress(result.id);
    audit(req.session.user?.email, 'locale_created', { code, name });
    req.session.toast = { type: 'success', message: `Locale "${name}" (${code}) created` };
    res.redirect('/admin/locales');
  }));

  // ============================================================
  // ROUTE 4: PUT /admin/locales/:id — Update locale
  // ============================================================
  app.put('/admin/locales/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const name = String(req.body.name || '').trim().substring(0, 100);
    const native_name = String(req.body.native_name || '').trim().substring(0, 100);
    const direction = DIRECTION_OPTIONS.includes(req.body.direction) ? req.body.direction : null;
    if (!name) {
      return res.status(400).json({ success: false, message: 'Name is required' });
    }
    const sets = ['name = $2', 'native_name = $3'];
    const vals = [id, name, native_name];
    let idx = 4;
    if (direction) { sets.push(`direction = $${idx++}`); vals.push(direction); }
    sets.push(`updated_at = NOW()`);
    vals.push(id);
    // Fix: vals already has id at position 1, we need to append id for WHERE
    await pool.query(`UPDATE locales SET ${sets.join(', ')} WHERE id = $1`, vals);
    audit(req.session.user?.email, 'locale_updated', { id, name });
    res.json({ success: true, message: 'Locale updated' });
  }));

  // ============================================================
  // ROUTE 5: DELETE /admin/locales/:id — Delete locale
  // ============================================================
  app.delete('/admin/locales/:id', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const loc = (await pool.query('SELECT * FROM locales WHERE id = $1', [id])).rows[0];
    if (!loc) {
      return res.status(404).json({ success: false, message: 'Locale not found' });
    }
    if (loc.is_default) {
      return res.status(400).json({ success: false, message: 'Cannot delete the default locale' });
    }
    await pool.query('DELETE FROM locales WHERE id = $1', [id]);
    audit(req.session.user?.email, 'locale_deleted', { id, code: loc.code });
    res.json({ success: true, message: `Locale "${loc.name}" deleted` });
  }));

  // ============================================================
  // ROUTE 6: POST /admin/locales/:id/set-default — Set default
  // ============================================================
  app.post('/admin/locales/:id/set-default', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const loc = (await pool.query('SELECT * FROM locales WHERE id = $1', [id])).rows[0];
    if (!loc) {
      req.session.toast = { type: 'error', message: 'Locale not found' };
      return res.redirect('/admin/locales');
    }
    // Clear existing default
    await pool.query('UPDATE locales SET is_default = false WHERE school_id = 1');
    // Set new default
    await pool.query('UPDATE locales SET is_default = true WHERE id = $1', [id]);
    audit(req.session.user?.email, 'locale_set_default', { id, code: loc.code });
    req.session.toast = { type: 'success', message: `"${loc.name}" is now the default locale` };
    res.redirect('/admin/locales');
  }));

  // ============================================================
  // ROUTE 7: POST /admin/locales/:id/toggle — Enable/disable
  // ============================================================
  app.post('/admin/locales/:id/toggle', requireAuth, ah(async (req, res) => {
    const id = parseInt(req.params.id);
    const loc = (await pool.query('SELECT * FROM locales WHERE id = $1', [id])).rows[0];
    if (!loc) {
      req.session.toast = { type: 'error', message: 'Locale not found' };
      return res.redirect('/admin/locales');
    }
    const newState = !loc.is_active;
    await pool.query('UPDATE locales SET is_active = $1 WHERE id = $2', [newState, id]);
    audit(req.session.user?.email, 'locale_toggled', { id, code: loc.code, is_active: newState });
    req.session.toast = { type: 'success', message: `"${loc.name}" ${newState ? 'enabled' : 'disabled'}` };
    res.redirect('/admin/locales');
  }));

  // ============================================================
  // ROUTE 8: GET /admin/locales/editor/:localeId — Translation editor
  // ============================================================
  app.get('/admin/locales/editor/:localeId', requireAuth, ah(async (req, res) => {
    const localeId = parseInt(req.params.localeId);
    const locale = (await pool.query('SELECT * FROM locales WHERE id = $1', [localeId])).rows[0];
    if (!locale) {
      req.session.toast = { type: 'error', message: 'Locale not found' };
      return res.redirect('/admin/locales');
    }
    await recalcProgress(localeId);

    const categoryFilter = req.query.category || '';
    const searchFilter = String(req.query.q || '').trim();

    let keyQuery = 'SELECT * FROM translation_keys';
    const queryParams = [];
    const conditions = [];
    if (categoryFilter) {
      queryParams.push(categoryFilter);
      conditions.push(`category = $${queryParams.length}`);
    }
    if (searchFilter) {
      queryParams.push(`%${searchFilter}%`);
      conditions.push(`(key ILIKE $${queryParams.length} OR context ILIKE $${queryParams.length})`);
    }
    if (conditions.length > 0) {
      keyQuery += ' WHERE ' + conditions.join(' AND ');
    }
    keyQuery += ' ORDER BY category, key';

    const keys = (await pool.query(keyQuery, queryParams)).rows;
    const translations = (await pool.query(
      'SELECT key_id, value, is_verified FROM translations WHERE locale_id = $1',
      [localeId]
    )).rows;
    const transMap = {};
    translations.forEach(t => { transMap[t.key_id] = t; });

    const otherLocales = (await pool.query(
      'SELECT id, code, name FROM locales WHERE id != $1 AND is_active = true ORDER BY name',
      [localeId]
    )).rows;

    // Get reference translations from default locale for comparison
    const defaultLocale = (await pool.query('SELECT id FROM locales WHERE is_default = true LIMIT 1')).rows[0];
    let refTransMap = {};
    if (defaultLocale) {
      const refTrans = (await pool.query(
        'SELECT key_id, value FROM translations WHERE locale_id = $1',
        [defaultLocale.id]
      )).rows;
      refTrans.forEach(t => { refTransMap[t.key_id] = t.value; });
    }

    const categoryOptions = CATEGORY_OPTIONS.map(c =>
      `<option value="${esc(c)}" ${categoryFilter === c ? 'selected' : ''}>${esc(c)}</option>`
    ).join('');

    const rows = keys.map(k => {
      const t = transMap[k.id];
      const refVal = refTransMap[k.id];
      const hasValue = t && t.value && t.value.trim() !== '';
      return `<div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:14px;margin-bottom:8px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
          <span style="font-family:monospace;font-size:13px;color:#3b82f6;font-weight:600">${esc(k.key)}</span>
          <span style="font-size:10px;padding:2px 8px;background:#334155;color:#94a3b8;border-radius:6px">${esc(k.category)}</span>
          ${t?.is_verified ? '<span style="font-size:10px;padding:2px 8px;background:#22c55e22;color:#22c55e;border-radius:6px;font-weight:600">&#10003; Verified</span>' : ''}
          ${hasValue ? '<span style="font-size:10px;padding:2px 8px;background:#3b82f622;color:#3b82f6;border-radius:6px">Translated</span>' : '<span style="font-size:10px;padding:2px 8px;background:#ef444422;color:#ef4444;border-radius:6px">Missing</span>'}
        </div>
        ${k.context ? `<div style="font-size:11px;color:#64748b;margin-bottom:6px">${esc(k.context)}</div>` : ''}
        ${refVal ? `<div style="font-size:12px;color:#475569;margin-bottom:6px;padding:4px 8px;background:#1e293b;border-radius:4px">Default: ${esc(refVal)}</div>` : ''}
        <input type="hidden" name="translations[${esc(String(k.id))}][key_id]" value="${k.id}">
        <textarea name="translations[${esc(String(k.id))}][value]" rows="2" placeholder="Enter translation..."
          style="width:100%;background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;font-size:13px;resize:vertical;font-family:inherit;line-height:1.5">${hasValue ? esc(t.value) : ''}</textarea>
        <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
          <label style="font-size:12px;color:#94a3b8;display:flex;align-items:center;gap:4px;cursor:pointer">
            <input type="checkbox" name="translations[${esc(String(k.id))}][verified]" value="true" ${t?.is_verified ? 'checked' : ''} style="accent-color:#3b82f6">
            Verified
          </label>
        </div>
      </div>`;
    }).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="margin:0">&#9997;&#65039; Translation Editor</h1>
          <p style="opacity:0.9;margin-top:4px;font-size:14px">
            ${esc(locale.name)} (${esc(locale.code)}) &mdash; ${progressBadge(locale.translation_progress)} complete
          </p>
        </div>
        <div style="display:flex;gap:8px">
          <form method="POST" action="/admin/locales/${locale.id}/set-default" style="margin:0">
            ${locale.is_default
              ? '<span style="padding:8px 16px;background:#22c55e22;color:#22c55e;border-radius:8px;font-size:13px;font-weight:600">&#10003; Default</span>'
              : '<button type="submit" class="btn btn-sm" style="background:#22c55e">Set as Default</button>'}
          </form>
          <a href="/admin/locales/translations/export/${locale.id}" class="btn btn-sm" style="background:#f59e0b;color:#000">Export</a>
        </div>
      </div>
    </div>
    ${localeNav('/editor')}
    <form method="POST" action="/admin/locales/translations/bulk-save" id="bulkForm">
      <input type="hidden" name="locale_id" value="${locale.id}">
      <!-- Filters -->
      <div style="display:flex;gap:10px;margin-bottom:16px;align-items:end;flex-wrap:wrap">
        <div>
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Category</label>
          <select name="category" style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;font-size:13px" onchange="this.form.querySelector('[name=q]').value='';this.form.submit()">
            <option value="">All Categories</option>
            ${categoryOptions}
          </select>
        </div>
        <div style="flex:1;min-width:200px">
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Search Keys</label>
          <input type="text" name="q" value="${esc(searchFilter)}" placeholder="Search by key or context..."
            style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;width:100%;font-size:13px">
        </div>
        <button type="submit" class="btn" style="background:#3b82f6;padding:8px 20px;font-size:13px">
          &#128190; Save All Translations
        </button>
      </div>
      <!-- Progress bar -->
      <div style="margin-bottom:16px;padding:12px;background:#1e293b;border:1px solid #334155;border-radius:10px">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
          <span style="font-size:13px;color:#e2e8f0;font-weight:600">Translation Progress</span>
          <span style="font-size:13px;color:#94a3b8">${keys.length} keys &bull; ${Object.values(transMap).filter(t => t.value && t.value.trim()).length} translated</span>
        </div>
        ${progressBar(locale.translation_progress, 600)}
        <span style="margin-left:8px;font-size:13px;color:#e2e8f0">${locale.translation_progress}%</span>
      </div>
      <!-- Translation rows -->
      ${rows || '<div style="text-align:center;padding:40px;color:#64748b">No translation keys found. Add keys from the Translation Keys tab.</div>'}
      ${keys.length > 0 ? `
      <div style="position:sticky;bottom:0;background:#0f172a;border-top:1px solid #334155;padding:12px;border-radius:10px;margin-top:12px;display:flex;justify-content:space-between;align-items:center">
        <span style="font-size:13px;color:#94a3b8">${keys.length} keys on this page</span>
        <button type="submit" class="btn" style="background:#3b82f6">&#128190; Save All Translations</button>
      </div>` : ''}
    </form>`;
    res.send(renderPage('Translation Editor — ' + locale.name, html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 9: POST /admin/locales/translations/bulk-save
  // ============================================================
  app.post('/admin/locales/translations/bulk-save', requireAuth, ah(async (req, res) => {
    const localeId = parseInt(req.body.locale_id);
    const locale = (await pool.query('SELECT * FROM locales WHERE id = $1', [localeId])).rows[0];
    if (!locale) {
      req.session.toast = { type: 'error', message: 'Invalid locale' };
      return res.redirect('/admin/locales');
    }

    const translations = req.body.translations;
    if (!translations || typeof translations !== 'object') {
      req.session.toast = { type: 'error', message: 'No translations data received' };
      return res.redirect('/admin/locales/editor/' + localeId);
    }

    let saved = 0;
    const userId = req.session?.user?.id || null;
    const entries = Array.isArray(translations) ? translations : Object.values(translations);

    for (let i = 0; i < Math.min(entries.length, BULK_SAVE_LIMIT); i++) {
      const entry = entries[i];
      if (!entry || !entry.key_id) continue;
      const keyId = parseInt(entry.key_id);
      const value = String(entry.value || '').trim();
      const verified = entry.verified === 'true' || entry.verified === true;
      await pool.query(
        `INSERT INTO translations (locale_id, key_id, value, is_verified, last_modified_by, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (locale_id, key_id) DO UPDATE SET
           value = EXCLUDED.value,
           is_verified = EXCLUDED.is_verified,
           last_modified_by = EXCLUDED.last_modified_by,
           updated_at = NOW()`,
        [localeId, keyId, value || null, verified, userId]
      );
      saved++;
    }

    await recalcProgress(localeId);
    audit(req.session.user?.email, 'translations_bulk_saved', { locale_id: localeId, count: saved });
    req.session.toast = { type: 'success', message: `${saved} translations saved` };
    res.redirect('/admin/locales/editor/' + localeId);
  }));

  // ============================================================
  // ROUTE 10: POST /admin/locales/translations/import
  // ============================================================
  app.post('/admin/locales/translations/import', requireAuth, ah(async (req, res) => {
    const localeId = parseInt(req.body.locale_id);
    const locale = (await pool.query('SELECT * FROM locales WHERE id = $1', [localeId])).rows[0];
    if (!locale) {
      req.session.toast = { type: 'error', message: 'Invalid locale' };
      return res.redirect('/admin/locales');
    }

    const format = req.body.format || 'json';
    const rawData = String(req.body.data || '').trim();
    if (!rawData) {
      req.session.toast = { type: 'error', message: 'No import data provided' };
      return res.redirect('/admin/locales/editor/' + localeId);
    }

    let entries = {};
    try {
      if (format === 'json') {
        entries = JSON.parse(rawData);
      } else if (format === 'csv') {
        // Parse CSV: key,value (skip header if first line doesn't match pattern)
        const lines = rawData.split('\n').map(l => l.trim()).filter(l => l);
        lines.forEach((line, idx) => {
          const parts = line.split(',').map(p => p.trim());
          if (parts.length >= 2 && !parts[0].startsWith('#')) {
            entries[parts[0]] = parts.slice(1).join(',');
          }
        });
      }
    } catch (e) {
      req.session.toast = { type: 'error', message: 'Failed to parse import data: ' + e.message };
      return res.redirect('/admin/locales/editor/' + localeId);
    }

    let imported = 0;
    let keysCreated = 0;
    const userId = req.session?.user?.id || null;

    for (const [key, value] of Object.entries(entries)) {
      if (!key || typeof key !== 'string') continue;
      if (imported >= IMPORT_LIMIT) break;

      const cleanKey = key.trim().substring(0, 255);
      const cleanValue = String(value || '').trim();

      // Ensure the key exists
      const existingKey = (await pool.query('SELECT id FROM translation_keys WHERE key = $1', [cleanKey])).rows[0];
      let keyId = existingKey ? existingKey.id : null;
      if (!keyId) {
        const newKey = (await pool.query(
          'INSERT INTO translation_keys (key) VALUES ($1) RETURNING id',
          [cleanKey]
        )).rows[0];
        keyId = newKey.id;
        keysCreated++;
      }

      // Upsert translation
      await pool.query(
        `INSERT INTO translations (locale_id, key_id, value, last_modified_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (locale_id, key_id) DO UPDATE SET
           value = EXCLUDED.value,
           last_modified_by = EXCLUDED.last_modified_by,
           updated_at = NOW()`,
        [localeId, keyId, cleanValue || null, userId]
      );
      imported++;
    }

    await recalcProgress(localeId);
    audit(req.session.user?.email, 'translations_imported', { locale_id: localeId, imported, keys_created: keysCreated, format });
    req.session.toast = { type: 'success', message: `Imported ${imported} translations (${keysCreated} new keys)` };
    res.redirect('/admin/locales/editor/' + localeId);
  }));

  // ============================================================
  // ROUTE 11: GET /admin/locales/translations/export/:localeId
  // ============================================================
  app.get('/admin/locales/translations/export/:localeId', requireAuth, ah(async (req, res) => {
    const localeId = parseInt(req.params.localeId);
    const locale = (await pool.query('SELECT * FROM locales WHERE id = $1', [localeId])).rows[0];
    if (!locale) {
      req.session.toast = { type: 'error', message: 'Locale not found' };
      return res.redirect('/admin/locales');
    }

    const format = req.query.format || 'json';
    const rows = (await pool.query(
      `SELECT tk.key, t.value, t.is_verified
       FROM translation_keys tk
       LEFT JOIN translations t ON t.key_id = tk.id AND t.locale_id = $1
       ORDER BY tk.category, tk.key`,
      [localeId]
    )).rows;

    if (format === 'csv') {
      const csvLines = ['key,category,value,is_verified'];
      rows.forEach(r => {
        const val = String(r.value || '').replace(/"/g, '""');
        csvLines.push(`"${r.key}","${r.category}","${val}","${r.is_verified ? 'true' : 'false'}"`);
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="${locale.code}_translations.csv"`);
      return res.send(csvLines.join('\n'));
    }

    // Default: JSON
    const exportData = {};
    rows.forEach(r => {
      exportData[r.key] = r.value || '';
    });
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Content-Disposition', `attachment; filename="${locale.code}_translations.json"`);
    res.json({ locale: locale.code, name: locale.name, exported_at: new Date().toISOString(), translations: exportData });
  }));

  // ============================================================
  // ROUTE 12: GET /admin/locales/keys — Manage translation keys
  // ============================================================
  app.get('/admin/locales/keys', requireAuth, ah(async (req, res) => {
    const categoryFilter = req.query.category || '';
    const searchFilter = String(req.query.q || '').trim();

    let keyQuery = 'SELECT tk.*, COUNT(t.id) AS translation_count FROM translation_keys tk LEFT JOIN translations t ON t.key_id = tk.id';
    const queryParams = [];
    const conditions = [];
    if (categoryFilter) {
      queryParams.push(categoryFilter);
      conditions.push(`tk.category = $${queryParams.length}`);
    }
    if (searchFilter) {
      queryParams.push(`%${searchFilter}%`);
      conditions.push(`(tk.key ILIKE $${queryParams.length} OR tk.context ILIKE $${queryParams.length})`);
    }
    if (conditions.length > 0) {
      keyQuery += ' WHERE ' + conditions.join(' AND ');
    }
    keyQuery += ' GROUP BY tk.id ORDER BY tk.category, tk.key';

    const keys = (await pool.query(keyQuery, queryParams)).rows;
    const totalKeys = (await pool.query('SELECT COUNT(*) FROM translation_keys')).rows[0].count;
    const activeLocales = (await pool.query('SELECT COUNT(*) FROM locales WHERE is_active = true')).rows[0].count;

    // Category distribution
    const catDist = (await pool.query(
      'SELECT category, COUNT(*) AS cnt FROM translation_keys GROUP BY category ORDER BY cnt DESC'
    )).rows;

    const categoryOptions = CATEGORY_OPTIONS.map(c =>
      `<option value="${esc(c)}" ${categoryFilter === c ? 'selected' : ''}>${esc(c)}</option>`
    ).join('');

    const keyRows = keys.map(k => `
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:12px 14px;display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:6px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
            <span style="font-family:monospace;font-size:13px;color:#3b82f6;font-weight:600">${esc(k.key)}</span>
            <span style="font-size:10px;padding:2px 8px;background:#334155;color:#94a3b8;border-radius:6px">${esc(k.category)}</span>
          </div>
          ${k.context ? `<div style="font-size:11px;color:#64748b;margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(k.context)}</div>` : ''}
        </div>
        <div style="display:flex;align-items:center;gap:10px;flex-shrink:0">
          <span style="font-size:12px;color:#94a3b8">${k.translation_count}/${activeLocales} locales</span>
          <form method="POST" action="/admin/locales/keys/${k.id}?_method=DELETE" style="margin:0" onsubmit="return confirm('Delete key &quot;${esc(k.key)}&quot; and all its translations?')">
            <button type="submit" style="background:transparent;border:1px solid #ef4444;color:#ef4444;padding:4px 10px;border-radius:6px;font-size:11px;cursor:pointer" title="Delete key">&#128465;</button>
          </form>
        </div>
      </div>
    `).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#0ea5e9,#3b82f6);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1 style="margin:0">&#128273; Translation Keys</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Manage translation keys used across all locales</p>
    </div>
    ${localeNav('/keys')}
    <!-- Stats row -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px">
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Total Keys</div>
        <div style="font-size:24px;font-weight:700;color:#e2e8f0;margin-top:4px">${totalKeys}</div>
      </div>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Active Locales</div>
        <div style="font-size:24px;font-weight:700;color:#e2e8f0;margin-top:4px">${activeLocales}</div>
      </div>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Categories</div>
        <div style="font-size:24px;font-weight:700;color:#e2e8f0;margin-top:4px">${catDist.length}</div>
      </div>
    </div>
    <!-- Category distribution -->
    <div class="card" style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px">
      <h3 style="color:#e2e8f0;margin:0 0 12px;font-size:15px">Key Distribution by Category</h3>
      <div style="display:flex;flex-wrap:wrap;gap:8px">
        ${catDist.map(c => `<span style="padding:4px 12px;background:#334155;color:#e2e8f0;border-radius:8px;font-size:12px">${esc(c.category)}: <strong>${c.cnt}</strong></span>`).join('')}
      </div>
    </div>
    <!-- Add key form -->
    <div class="card" style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-bottom:16px">
      <h3 style="color:#e2e8f0;margin:0 0 14px;font-size:15px">Add Translation Key</h3>
      <form method="POST" action="/admin/locales/keys" style="display:grid;grid-template-columns:1fr 1fr 2fr auto;gap:10px;align-items:end">
        <div>
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Key (dot.notation)</label>
          <input type="text" name="key" placeholder="forms.submit_button" required maxlength="255"
            style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;width:100%;font-size:13px;font-family:monospace">
        </div>
        <div>
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Category</label>
          <select name="category" style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;width:100%;font-size:13px">
            ${CATEGORY_OPTIONS.map(c => `<option value="${c}">${c}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Context / Description</label>
          <input type="text" name="context" placeholder="Brief description of where this key is used" maxlength="500"
            style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;width:100%;font-size:13px">
        </div>
        <button type="submit" class="btn" style="background:#3b82f6;padding:8px 20px;font-size:13px;white-space:nowrap">Add Key</button>
      </form>
    </div>
    <!-- Filters -->
    <form method="GET" style="display:flex;gap:10px;margin-bottom:16px;align-items:end;flex-wrap:wrap">
      <div>
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Category</label>
        <select name="category" style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;font-size:13px">
          <option value="">All Categories</option>
          ${categoryOptions}
        </select>
      </div>
      <div style="flex:1;min-width:200px">
        <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Search</label>
        <input type="text" name="q" value="${esc(searchFilter)}" placeholder="Search keys..."
          style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;width:100%;font-size:13px">
      </div>
      <button type="submit" class="btn btn-sm" style="background:#334155;color:#e2e8f0;padding:8px 16px">Filter</button>
    </form>
    <!-- Key list -->
    ${keyRows || '<div style="text-align:center;padding:40px;color:#64748b">No translation keys found</div>'}`;
    res.send(renderPage('Translation Keys', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 13: POST /admin/locales/keys — Add translation key
  // ============================================================
  app.post('/admin/locales/keys', requireAuth, ah(async (req, res) => {
    const key = String(req.body.key || '').trim().substring(0, 255);
    const category = CATEGORY_OPTIONS.includes(req.body.category) ? req.body.category : 'general';
    const context = String(req.body.context || '').trim().substring(0, 500);
    if (!key) {
      req.session.toast = { type: 'error', message: 'Key is required' };
      return res.redirect('/admin/locales/keys');
    }
    // Check for duplicate
    const existing = (await pool.query('SELECT id FROM translation_keys WHERE key = $1', [key])).rows[0];
    if (existing) {
      req.session.toast = { type: 'error', message: `Key "${key}" already exists` };
      return res.redirect('/admin/locales/keys');
    }
    await pool.query(
      'INSERT INTO translation_keys (key, category, context) VALUES ($1, $2, $3)',
      [key, category, context || null]
    );
    // Recalculate all locale progress
    await recalcAllProgress();
    audit(req.session.user?.email, 'translation_key_created', { key, category });
    req.session.toast = { type: 'success', message: `Key "${key}" added` };
    res.redirect('/admin/locales/keys');
  }));

  // ============================================================
  // ROUTE 14: DELETE /admin/locales/keys/:keyId — Delete key
  // ============================================================
  app.delete('/admin/locales/keys/:keyId', requireAuth, ah(async (req, res) => {
    const keyId = parseInt(req.params.keyId);
    const key = (await pool.query('SELECT * FROM translation_keys WHERE id = $1', [keyId])).rows[0];
    if (!key) {
      return res.status(404).json({ success: false, message: 'Key not found' });
    }
    await pool.query('DELETE FROM translations WHERE key_id = $1', [keyId]);
    await pool.query('DELETE FROM translation_keys WHERE id = $1', [keyId]);
    await recalcAllProgress();
    audit(req.session.user?.email, 'translation_key_deleted', { id: keyId, key: key.key });
    res.json({ success: true, message: `Key "${key.key}" deleted` });
  }));

  // Also support POST with _method=DELETE for forms
  app.post('/admin/locales/keys/:keyId', requireAuth, ah(async (req, res) => {
    if (req.body._method === 'DELETE') {
      const keyId = parseInt(req.params.keyId);
      const key = (await pool.query('SELECT * FROM translation_keys WHERE id = $1', [keyId])).rows[0];
      if (!key) {
        req.session.toast = { type: 'error', message: 'Key not found' };
        return res.redirect('/admin/locales/keys');
      }
      await pool.query('DELETE FROM translations WHERE key_id = $1', [keyId]);
      await pool.query('DELETE FROM translation_keys WHERE id = $1', [keyId]);
      await recalcAllProgress();
      audit(req.session.user?.email, 'translation_key_deleted', { id: keyId, key: key.key });
      req.session.toast = { type: 'success', message: `Key "${key.key}" deleted` };
      return res.redirect('/admin/locales/keys');
    }
    res.redirect('/admin/locales/keys');
  }));

  // ============================================================
  // ROUTE 15: GET /admin/locales/missing/:localeId — Missing translations
  // ============================================================
  app.get('/admin/locales/missing/:localeId', requireAuth, ah(async (req, res) => {
    const localeId = parseInt(req.params.localeId);
    const locale = (await pool.query('SELECT * FROM locales WHERE id = $1', [localeId])).rows[0];
    if (!locale) {
      req.session.toast = { type: 'error', message: 'Locale not found' };
      return res.redirect('/admin/locales');
    }

    // Get default locale for reference values
    const defaultLocale = (await pool.query('SELECT id, code, name FROM locales WHERE is_default = true LIMIT 1')).rows[0];
    let refTransMap = {};
    if (defaultLocale) {
      const refTrans = (await pool.query(
        'SELECT key_id, value FROM translations WHERE locale_id = $1 AND value IS NOT NULL AND value <> \'\'',
        [defaultLocale.id]
      )).rows;
      refTrans.forEach(t => { refTransMap[t.key_id] = t.value; });
    }

    // Find missing translations for this locale
    const missing = (await pool.query(
      `SELECT tk.id, tk.key, tk.category, tk.context
       FROM translation_keys tk
       LEFT JOIN translations t ON t.key_id = tk.id AND t.locale_id = $1
       WHERE t.id IS NULL OR t.value IS NULL OR t.value = ''
       ORDER BY tk.category, tk.key`,
      [localeId]
    )).rows;

    const totalKeys = (await pool.query('SELECT COUNT(*) FROM translation_keys')).rows[0].count;
    const translatedCount = totalKeys - missing.length;

    const missingRows = missing.map(k => `
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:10px;padding:12px 14px;margin-bottom:6px">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <span style="font-family:monospace;font-size:13px;color:#f97316;font-weight:600">${esc(k.key)}</span>
          <span style="font-size:10px;padding:2px 8px;background:#334155;color:#94a3b8;border-radius:6px">${esc(k.category)}</span>
        </div>
        ${k.context ? `<div style="font-size:11px;color:#64748b;margin-bottom:4px">${esc(k.context)}</div>` : ''}
        ${refTransMap[k.id] ? `<div style="font-size:12px;color:#475569;padding:4px 8px;background:#1e293b;border-radius:4px;margin-top:4px">Default (${esc(defaultLocale.code)}): ${esc(refTransMap[k.id])}</div>` : ''}
      </div>
    `).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#f97316,#ea580c);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <div style="display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="margin:0">&#9888;&#65039; Missing Translations</h1>
          <p style="opacity:0.9;margin-top:4px;font-size:14px">
            ${esc(locale.name)} (${esc(locale.code)}) &mdash; ${missing.length} untranslated keys
          </p>
        </div>
        <a href="/admin/locales/editor/${locale.id}" class="btn btn-sm" style="background:white;color:#ea580c;font-weight:700">Open Editor</a>
      </div>
    </div>
    ${localeNav('/missing')}
    <!-- Progress summary -->
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:20px">
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Translated</div>
        <div style="font-size:24px;font-weight:700;color:#22c55e;margin-top:4px">${translatedCount} / ${totalKeys}</div>
      </div>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Missing</div>
        <div style="font-size:24px;font-weight:700;color:#ef4444;margin-top:4px">${missing.length}</div>
      </div>
      <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px">
        <div style="font-size:11px;color:#64748b;text-transform:uppercase;letter-spacing:1px">Progress</div>
        <div style="margin-top:8px">
          ${progressBar(locale.translation_progress, 200)}
          <span style="margin-left:8px;font-size:14px;color:#e2e8f0;font-weight:600">${locale.translation_progress}%</span>
        </div>
      </div>
    </div>
    <!-- Missing keys list -->
    ${missingRows || '<div style="text-align:center;padding:40px;color:#22c55e;font-size:16px">&#10003; All translations are complete!</div>'}`;
    res.send(renderPage('Missing Translations — ' + locale.name, html, req.session.user, req));
  }));

  // ============================================================
  // BONUS: GET /admin/locales/import — Import form page
  // ============================================================
  app.get('/admin/locales/import', requireAuth, ah(async (req, res) => {
    const locales = (await pool.query(
      'SELECT id, code, name FROM locales WHERE is_active = true ORDER BY name'
    )).rows;

    const localeOptions = locales.map(l =>
      `<option value="${l.id}">${esc(l.name)} (${esc(l.code)})</option>`
    ).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#8b5cf6,#6366f1);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1 style="margin:0">&#128229; Import / Export Translations</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Bulk import from JSON or CSV, or export for external translation tools</p>
    </div>
    ${localeNav('/import')}
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
      <!-- Import form -->
      <div class="card" style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
        <h3 style="color:#e2e8f0;margin:0 0 14px">&#128228; Import Translations</h3>
        <form method="POST" action="/admin/locales/translations/import">
          <div style="margin-bottom:12px">
            <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Target Locale</label>
            <select name="locale_id" required style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;width:100%;font-size:13px">
              <option value="">Select locale...</option>
              ${localeOptions}
            </select>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Format</label>
            <select name="format" style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:8px 12px;border-radius:8px;width:100%;font-size:13px">
              <option value="json">JSON</option>
              <option value="csv">CSV (key,value)</option>
            </select>
          </div>
          <div style="margin-bottom:12px">
            <label style="font-size:12px;color:#94a3b8;display:block;margin-bottom:4px">Data</label>
            <textarea name="data" rows="10" required placeholder='{"welcome.title": "Welcome", "nav.dashboard": "Dashboard"}'
              style="background:#0f172a;border:1px solid #334155;color:#e2e8f0;padding:10px;border-radius:8px;width:100%;font-size:13px;font-family:monospace;resize:vertical;line-height:1.5"></textarea>
          </div>
          <button type="submit" class="btn" style="background:#8b5cf6">Import</button>
        </form>
      </div>
      <!-- Export info -->
      <div class="card" style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px">
        <h3 style="color:#e2e8f0;margin:0 0 14px">&#128228; Export Translations</h3>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:16px">Export translations for any locale in JSON or CSV format. Use exported files with external translation tools like Crowdin, Transifex, or POEditor.</p>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${locales.map(l => `
            <div style="display:flex;align-items:center;justify-content:space-between;padding:10px;background:#0f172a;border:1px solid #1e293b;border-radius:8px">
              <span style="font-size:13px;color:#e2e8f0">${esc(l.name)} (${esc(l.code)})</span>
              <div style="display:flex;gap:6px">
                <a href="/admin/locales/translations/export/${l.id}?format=json" class="btn btn-sm" style="background:#3b82f6;padding:5px 10px;font-size:11px">JSON</a>
                <a href="/admin/locales/translations/export/${l.id}?format=csv" class="btn btn-sm" style="background:#f59e0b;color:#000;padding:5px 10px;font-size:11px">CSV</a>
              </div>
            </div>
          `).join('')}
        </div>
      </div>
    </div>
    <!-- Quick add preset locales -->
    <div class="card" style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:20px;margin-top:16px">
      <h3 style="color:#e2e8f0;margin:0 0 14px">Quick Add Preset Locales</h3>
      <p style="font-size:13px;color:#94a3b8;margin-bottom:12px">Common languages you can add with one click. Existing locales will be skipped.</p>
      <form method="POST" action="/admin/locales/presets/seed" style="margin:0">
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">
          ${PRESET_LOCALES.map(p => `<span style="font-size:12px;padding:4px 10px;background:#334155;color:#94a3b8;border-radius:6px">${esc(p.name)} (${esc(p.code)}) ${p.direction === 'rtl' ? '&#128304;' : ''}</span>`).join('')}
        </div>
        <button type="submit" class="btn" style="background:#3b82f6">Add Missing Preset Locales</button>
      </form>
    </div>`;
    res.send(renderPage('Import / Export', html, req.session.user, req));
  }));

  // ============================================================
  // BONUS: POST /admin/locales/presets/seed — Seed preset locales
  // ============================================================
  app.post('/admin/locales/presets/seed', requireAuth, ah(async (req, res) => {
    let added = 0;
    for (const preset of PRESET_LOCALES) {
      const existing = (await pool.query('SELECT id FROM locales WHERE code = $1', [preset.code])).rows[0];
      if (!existing) {
        await pool.query(
          'INSERT INTO locales (code, name, native_name, direction, school_id) VALUES ($1, $2, $3, $4, 1)',
          [preset.code, preset.name, preset.native_name, preset.direction]
        );
        added++;
      }
    }
    if (added > 0) {
      await recalcAllProgress();
    }
    audit(req.session.user?.email, 'preset_locales_seeded', { added });
    req.session.toast = { type: 'success', message: `${added} preset locale(s) added` };
    res.redirect('/admin/locales');
  }));

  // ============================================================
  // BONUS: GET /admin/locales/missing — Missing translations picker
  // ============================================================
  app.get('/admin/locales/missing', requireAuth, ah(async (req, res) => {
    const locales = (await pool.query(
      'SELECT l.id, l.code, l.name, l.translation_progress, (SELECT COUNT(*) FROM translation_keys) AS total_keys FROM locales l WHERE l.is_active = true ORDER BY l.translation_progress ASC, l.name ASC'
    )).rows;

    const localeCards = locales.map(l => `
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px;display:flex;align-items:center;justify-content:space-between;transition:0.2s">
        <div>
          <strong style="font-size:15px;color:#e2e8f0">${esc(l.name)}</strong>
          <span style="font-size:12px;color:#64748b;margin-left:8px">${esc(l.code)}</span>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            ${progressBar(l.translation_progress)}
            ${progressBadge(l.translation_progress)}
          </div>
        </div>
        <a href="/admin/locales/missing/${l.id}" class="btn btn-sm" style="background:${l.translation_progress < 100 ? '#f97316' : '#22c55e'};padding:6px 14px;font-size:12px">
          ${l.translation_progress < 100 ? 'View Missing' : '&#10003; Complete'}
        </a>
      </div>
    `).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#f97316,#ea580c);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1 style="margin:0">&#9888;&#65039; Missing Translations Overview</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Select a locale to see which translation keys are still missing</p>
    </div>
    ${localeNav('/missing')}
    <div style="display:flex;flex-direction:column;gap:10px">${localeCards}</div>`;
    res.send(renderPage('Missing Translations', html, req.session.user, req));
  }));

  // ============================================================
  // BONUS: GET /admin/locales/editor — Editor locale picker
  // ============================================================
  app.get('/admin/locales/editor', requireAuth, ah(async (req, res) => {
    const locales = (await pool.query(
      'SELECT * FROM locales WHERE is_active = true ORDER BY is_default DESC, name ASC'
    )).rows;

    const localeCards = locales.map(l => `
      <div style="background:#0f172a;border:1px solid #1e293b;border-radius:12px;padding:16px;display:flex;align-items:center;justify-content:space-between;transition:0.2s">
        <div>
          <div style="display:flex;align-items:center;gap:8px">
            <strong style="font-size:15px;color:#e2e8f0">${esc(l.name)}</strong>
            <span style="font-size:12px;color:#64748b">${esc(l.code)}</span>
            ${l.is_default ? '<span style="font-size:10px;padding:2px 8px;background:#3b82f6;color:white;border-radius:10px;font-weight:600">DEFAULT</span>' : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;margin-top:6px">
            ${progressBar(l.translation_progress)}
            ${progressBadge(l.translation_progress)}
          </div>
        </div>
        <a href="/admin/locales/editor/${l.id}" class="btn btn-sm" style="background:#3b82f6;padding:6px 14px;font-size:12px">Open Editor</a>
      </div>
    `).join('');

    const html = `
    <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1 style="margin:0">&#9997;&#65039; Translation Editor</h1>
      <p style="opacity:0.9;margin-top:4px;font-size:14px">Select a locale to edit its translations</p>
    </div>
    ${localeNav('/editor')}
    <div style="display:flex;flex-direction:column;gap:10px">${localeCards}</div>`;
    res.send(renderPage('Translation Editor', html, req.session.user, req));
  }));

  // ============================================================
  // CONSOLE HELPER: Public API for getting translations at runtime
  // ============================================================
  app.get('/api/locales/:code/translations', ah(async (req, res) => {
    const code = String(req.params.code || '').trim().toLowerCase();
    const locale = (await pool.query('SELECT id, code, name, direction FROM locales WHERE code = $1 AND is_active = true', [code])).rows[0];
    if (!locale) {
      return res.status(404).json({ success: false, message: 'Locale not found' });
    }
    const rows = (await pool.query(
      `SELECT tk.key, COALESCE(t.value, '') AS value
       FROM translation_keys tk
       LEFT JOIN translations t ON t.key_id = tk.id AND t.locale_id = $1
       ORDER BY tk.key`,
      [locale.id]
    )).rows;
    const translations = {};
    rows.forEach(r => { translations[r.key] = r.value; });
    res.json({
      success: true,
      locale: { code: locale.code, name: locale.name, direction: locale.direction },
      translations
    });
  }));

  // Default locale translations
  app.get('/api/locales/default/translations', ah(async (req, res) => {
    const locale = (await pool.query('SELECT id, code, name, direction FROM locales WHERE is_default = true LIMIT 1')).rows[0];
    if (!locale) {
      return res.status(404).json({ success: false, message: 'No default locale set' });
    }
    const rows = (await pool.query(
      `SELECT tk.key, COALESCE(t.value, '') AS value
       FROM translation_keys tk
       LEFT JOIN translations t ON t.key_id = tk.id AND t.locale_id = $1
       ORDER BY tk.key`,
      [locale.id]
    )).rows;
    const translations = {};
    rows.forEach(r => { translations[r.key] = r.value; });
    res.json({
      success: true,
      locale: { code: locale.code, name: locale.name, direction: locale.direction },
      translations
    });
  }));

  // Public API: list active locales
  app.get('/api/locales', ah(async (req, res) => {
    const locales = (await pool.query(
      'SELECT id, code, name, native_name, direction, is_default, translation_progress FROM locales WHERE is_active = true ORDER BY is_default DESC, name ASC'
    )).rows;
    res.json({ success: true, data: locales });
  }));
};
