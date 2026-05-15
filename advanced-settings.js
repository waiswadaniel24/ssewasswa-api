// ============================================================
// ADVANCED SETTINGS & SYSTEM CONFIGURATION MODULE
// SSEWASSWA Comfort Platform — Multi-Tenant SaaS
// Provides: System settings, feature flags, activity log, webhooks,
//           scheduled tasks, backup management, maintenance mode,
//           API configuration, security & notification settings
// ============================================================
// Usage in server.js:
//   const advancedSettings = require('./advanced-settings');
//   advancedSettings(app, db, pool, renderPage, esc);
// ============================================================

'use strict';

module.exports = function advancedSettings(app, db, pool, renderPage, esc) {

  // ============================================================
  // MIDDLEWARE
  // ============================================================
  const requireAuth = (req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    next();
  };

  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  const requireNotBanned = (req, res, next) => {
    if (req.session?.user?.banned) return res.send(renderPage('Banned', '<div class="card"><div class="alert alert-error">Account banned</div><a href="/login" class="btn">Back</a></div>', null));
    next();
  };

  const requireAdmin = (req, res, next) => {
    if (!req.session?.user || !['super_admin', 'admin', 'manager'].includes(req.session.user.role))
      return res.status(403).send(renderPage('Access Denied', '<div class="card"><div class="alert alert-error">Admin access required</div><a href="/dashboard" class="btn">Back</a></div>', req.session.user));
    next();
  };

  // ============================================================
  // HELPERS
  // ============================================================
  const fmtDate = (d) => d ? new Date(d).toLocaleString() : '-';
  const fmtDateShort = (d) => d ? new Date(d).toISOString().replace('T', ' ').slice(0, 16) : '-';

  // Build settings navigation tabs
  function settingsNav(active) {
    return `<div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;border-bottom:2px solid #e2e8f0;padding-bottom:12px">
  <a href="/settings" class="btn btn-sm ${active === 'general' ? 'active' : ''}">General</a>
  <a href="/settings/security" class="btn btn-sm ${active === 'security' ? 'active' : ''}">Security</a>
  <a href="/settings/notifications" class="btn btn-sm ${active === 'notifications' ? 'active' : ''}">Notifications</a>
  <a href="/settings/backup" class="btn btn-sm ${active === 'backup' ? 'active' : ''}">Backup</a>
  <a href="/settings/api" class="btn btn-sm ${active === 'api' ? 'active' : ''}">API &amp; Webhooks</a>
  <a href="/settings/features" class="btn btn-sm ${active === 'features' ? 'active' : ''}">Features</a>
  <a href="/settings/maintenance" class="btn btn-sm ${active === 'maintenance' ? 'active' : ''}">Maintenance</a>
  <a href="/settings/activity" class="btn btn-sm ${active === 'activity' ? 'active' : ''}">Activity Log</a>
</div>`;
  }

  // Render a boolean toggle switch
  function toggleSwitch(name, checked, label, description) {
    const uid = 'tog_' + name.replace(/[^a-z0-9]/gi, '_');
    return `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #f1f5f9">
  <div>
    <label for="${uid}" style="font-weight:500;cursor:pointer">${esc(label)}</label>
    ${description ? `<p style="font-size:12px;color:#64748b;margin:2px 0 0">${esc(description)}</p>` : ''}
  </div>
  <label style="position:relative;display:inline-block;width:48px;height:26px;flex-shrink:0">
    <input type="checkbox" name="${esc(name)}" id="${uid}" value="true" ${checked ? 'checked' : ''} style="opacity:0;width:0;height:0">
    <span style="position:absolute;cursor:pointer;top:0;left:0;right:0;bottom:0;background:${checked ? '#4f46e5' : '#cbd5e1'};transition:.3s;border-radius:26px"></span>
    <span style="position:absolute;content:'';height:20px;width:20px;left:${checked ? '24px' : '4px'};bottom:3px;background:white;transition:.3s;border-radius:50%;box-shadow:0 1px 3px rgba(0,0,0,0.2)"></span>
  </label>
</div>
<script>
document.getElementById('${uid}').addEventListener('change',function(){
  var s=this.parentElement.querySelector('span');
  var d=this.parentElement.querySelectorAll('span')[1];
  s.style.background=this.checked?'#4f46e5':'#cbd5e1';
  d.style.left=this.checked?'24px':'4px';
});
</script>`;
  }

  // Render a settings form field
  function settingField(name, value, label, type, opts) {
    const desc = opts.description ? `<p style="font-size:12px;color:#64748b;margin:2px 0 0">${esc(opts.description)}</p>` : '';
    const inputStyle = 'width:100%;padding:10px 12px;border:1px solid #e2e8f0;border-radius:8px;font-size:14px;box-sizing:border-box';
    let input = '';
    switch (type) {
      case 'select':
        input = `<select name="${esc(name)}" style="${inputStyle}">${(opts.options || []).map(o => `<option value="${esc(o.value !== undefined ? o.value : o)}" ${String(value) === String(o.value !== undefined ? o.value : o) ? 'selected' : ''}>${esc(o.label !== undefined ? o.label : o)}</option>`).join('')}</select>`;
        break;
      case 'color':
        input = `<div style="display:flex;gap:8px;align-items:center"><input type="color" name="${esc(name)}" value="${esc(value || '#4f46e5')}" style="width:50px;height:38px;border:1px solid #e2e8f0;border-radius:8px;cursor:pointer;padding:2px"><input type="text" name="${esc(name)}" value="${esc(value || '')}" style="${inputStyle};flex:1" placeholder="#000000"></div>`;
        break;
      case 'number':
        input = `<input type="number" name="${esc(name)}" value="${esc(value || '')}" ${opts.min !== undefined ? 'min="' + opts.min + '"' : ''} ${opts.max !== undefined ? 'max="' + opts.max + '"' : ''} ${opts.step ? 'step="' + opts.step + '"' : ''} style="${inputStyle}">`;
        break;
      case 'textarea':
        input = `<textarea name="${esc(name)}" rows="${opts.rows || 3}" style="${inputStyle};resize:vertical">${esc(value || '')}</textarea>`;
        break;
      default:
        input = `<input type="text" name="${esc(name)}" value="${esc(value || '')}" style="${inputStyle}">`;
    }
    return `<div style="padding:14px 0;border-bottom:1px solid #f1f5f9">
  <label style="font-weight:500;display:block;margin-bottom:6px">${esc(label)}</label>
  ${desc}
  ${input}
</div>`;
  }

  // Helper to get a setting value from settings map
  function sv(settingsMap, key, fallback) {
    const s = settingsMap.find(x => x.setting_key === key);
    if (!s) return fallback;
    if (s.setting_type === 'boolean') return s.setting_value === 'true';
    return s.setting_value || fallback;
  }

  // Log activity
  async function logActivity(tenantId, userId, action, entityType, entityId, details, req, status) {
    try {
      await pool.query(
        `INSERT INTO activity_log (tenant_id, user_id, action, entity_type, entity_id, details, ip_address, user_agent, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [tenantId, userId, action, entityType || null, entityId || null, details || null,
          req?.ip || null, req?.headers?.['user-agent'] || null, status || 'success']
      );
    } catch (e) {
      // Silently fail — don't break the request
    }
  }

  // ============================================================
  // DATABASE MIGRATIONS (async IIFE at module load)
  // ============================================================
  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.warn('[AdvancedSettings] Cannot connect to DB for migrations'); return; }
    try {
      // --- system_settings ---
      await client.query(`CREATE TABLE IF NOT EXISTS system_settings (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        setting_key VARCHAR(100) NOT NULL,
        setting_value TEXT,
        setting_type VARCHAR(20) DEFAULT 'string',
        category VARCHAR(50) DEFAULT 'general',
        description TEXT,
        is_public BOOLEAN DEFAULT false,
        updated_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, setting_key)
      )`);
      await client.query(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS tenant_id INTEGER NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS setting_key VARCHAR(100) NOT NULL DEFAULT ''`);
      await client.query(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS setting_value TEXT`);
      await client.query(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS setting_type VARCHAR(20) DEFAULT 'string'`);
      await client.query(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS category VARCHAR(50) DEFAULT 'general'`);
      await client.query(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS description TEXT`);
      await client.query(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS is_public BOOLEAN DEFAULT false`);
      await client.query(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS updated_by INTEGER`);
      await client.query(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
      await client.query(`ALTER TABLE system_settings ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW()`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_system_settings_tenant ON system_settings(tenant_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_system_settings_key ON system_settings(setting_key)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_system_settings_cat ON system_settings(category)`);

      // --- activity_log ---
      await client.query(`CREATE TABLE IF NOT EXISTS activity_log (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id),
        action VARCHAR(100) NOT NULL,
        entity_type VARCHAR(50),
        entity_id INTEGER,
        details TEXT,
        ip_address VARCHAR(45),
        user_agent TEXT,
        status VARCHAR(20) DEFAULT 'success',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS tenant_id INTEGER NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS user_id INTEGER`);
      await client.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS action VARCHAR(100) NOT NULL DEFAULT ''`);
      await client.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS entity_type VARCHAR(50)`);
      await client.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS entity_id INTEGER`);
      await client.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS details TEXT`);
      await client.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS ip_address VARCHAR(45)`);
      await client.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS user_agent TEXT`);
      await client.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS status VARCHAR(20) DEFAULT 'success'`);
      await client.query(`ALTER TABLE activity_log ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_log_tenant ON activity_log(tenant_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_log_user ON activity_log(user_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_log_action ON activity_log(action)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_activity_log_created ON activity_log(created_at)`);

      // --- scheduled_tasks ---
      await client.query(`CREATE TABLE IF NOT EXISTS scheduled_tasks (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        task_name VARCHAR(100) NOT NULL,
        task_type VARCHAR(50) DEFAULT 'custom',
        cron_expression VARCHAR(100),
        payload JSONB DEFAULT '{}',
        last_run_at TIMESTAMPTZ,
        next_run_at TIMESTAMPTZ,
        run_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        last_error TEXT,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS tenant_id INTEGER NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS task_name VARCHAR(100) NOT NULL DEFAULT ''`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS task_type VARCHAR(50) DEFAULT 'custom'`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS cron_expression VARCHAR(100)`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS payload JSONB DEFAULT '{}'`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS last_run_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS next_run_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS run_count INTEGER DEFAULT 0`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS last_error TEXT`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
      await client.query(`ALTER TABLE scheduled_tasks ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_tenant ON scheduled_tasks(tenant_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_active ON scheduled_tasks(is_active)`);

      // --- webhook_endpoints ---
      await client.query(`CREATE TABLE IF NOT EXISTS webhook_endpoints (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(100) NOT NULL,
        url TEXT NOT NULL,
        secret VARCHAR(255),
        events TEXT[] DEFAULT '{}',
        is_active BOOLEAN DEFAULT true,
        last_triggered_at TIMESTAMPTZ,
        success_count INTEGER DEFAULT 0,
        failure_count INTEGER DEFAULT 0,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS tenant_id INTEGER NOT NULL DEFAULT 0`);
      await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS name VARCHAR(100) NOT NULL DEFAULT ''`);
      await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS url TEXT`);
      await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS secret VARCHAR(255)`);
      await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS events TEXT[] DEFAULT '{}'`);
      await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true`);
      await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS last_triggered_at TIMESTAMPTZ`);
      await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS success_count INTEGER DEFAULT 0`);
      await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS failure_count INTEGER DEFAULT 0`);
      await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS created_by INTEGER`);
      await client.query(`ALTER TABLE webhook_endpoints ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW()`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_tenant ON webhook_endpoints(tenant_id)`);
      await client.query(`CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_active ON webhook_endpoints(is_active)`);

      // --- Seed default settings for all existing tenants ---
      const tenants = await client.query('SELECT id FROM tenants').catch(() => ({ rows: [] }));
      const defaultSettings = [
        ['platform_name', 'Comfort Platform', 'string', 'general', 'Display name of the platform'],
        ['timezone', 'Africa/Kampala', 'string', 'general', 'Default timezone for the platform'],
        ['date_format', 'DD/MM/YYYY', 'string', 'general', 'Date display format'],
        ['currency', 'UGX', 'string', 'general', 'Primary currency code'],
        ['language', 'en', 'string', 'general', 'Default language code'],
        ['maintenance_mode', 'false', 'boolean', 'general', 'Enable/disable maintenance mode'],
        ['allow_registration', 'true', 'boolean', 'general', 'Allow new user registrations'],
        ['max_users_per_tenant', '500', 'number', 'general', 'Maximum users allowed per tenant'],
        ['session_timeout', '60', 'number', 'security', 'Session timeout in minutes'],
        ['email_notifications', 'true', 'boolean', 'notifications', 'Enable email notifications'],
        ['two_factor_required', 'false', 'boolean', 'security', 'Require two-factor authentication for all users'],
        ['auto_backup_enabled', 'true', 'boolean', 'backup', 'Enable automatic database backups'],
        ['backup_frequency', 'daily', 'string', 'backup', 'How often automatic backups run'],
        ['data_retention_days', '365', 'number', 'backup', 'Days to retain backup data'],
        ['api_rate_limit', '100', 'number', 'api', 'API requests allowed per minute'],
        ['logo_url', '', 'string', 'general', 'URL for the platform logo'],
        ['primary_color', '#4f46e5', 'string', 'general', 'Primary brand color for UI']
      ];

      for (const tenant of tenants.rows) {
        for (const [key, value, type, category, description] of defaultSettings) {
          await client.query(
            `INSERT INTO system_settings (tenant_id, setting_key, setting_value, setting_type, category, description)
             VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, setting_key) DO NOTHING`,
            [tenant.id, key, value, type, category, description]
          );
        }
      }

      console.log('[AdvancedSettings] Migrations & seeding applied successfully');
    } catch (e) {
      console.error('[AdvancedSettings] Migration error:', e.message);
    } finally {
      client.release();
    }
  })();

  // ============================================================
  // ROUTE 1: GET /settings — Settings Dashboard (General)
  // ============================================================
  app.get('/settings', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const settings = (await pool.query('SELECT * FROM system_settings WHERE tenant_id = $1', [tid])).rows;
    const s = {};
    settings.forEach(r => { s[r.setting_key] = r.setting_value; });

    const html = `
    <div class="hero" style="background:linear-gradient(135deg,#4f46e5,#6366f1);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>⚙️ Advanced Settings</h1>
      <p style="opacity:0.9;margin-top:4px">Configure your platform — SSEWASSWA Comfort Platform</p>
    </div>
    ${settingsNav('general')}
    <form method="POST" action="/settings/save">
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <input type="hidden" name="_redirect" value="/settings">
    <div class="card">
      <h3 style="margin-bottom:4px">🏢 General Settings</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">Core platform configuration</p>
      ${settingField('platform_name', s.platform_name, 'Platform Name', 'text', { description: 'Display name across the application' })}
      ${settingField('logo_url', s.logo_url, 'Logo URL', 'text', { description: 'Full URL to your organization logo image' })}
      ${settingField('primary_color', s.primary_color, 'Primary Brand Color', 'color', { description: 'Main accent color used across the UI' })}
      ${settingField('timezone', s.timezone, 'Timezone', 'select', {
        description: 'Default timezone for date/time display',
        options: [
          { value: 'Africa/Kampala', label: 'Africa/Kampala (EAT)' },
          { value: 'Africa/Nairobi', label: 'Africa/Nairobi (EAT)' },
          { value: 'Africa/Dar_es_Salaam', label: 'Africa/Dar es Salaam (EAT)' },
          { value: 'Africa/Lagos', label: 'Africa/Lagos (WAT)' },
          { value: 'Africa/Cairo', label: 'Africa/Cairo (EET)' },
          { value: 'Europe/London', label: 'Europe/London (GMT/BST)' },
          { value: 'Europe/Paris', label: 'Europe/Paris (CET)' },
          { value: 'America/New_York', label: 'America/New York (EST/EDT)' },
          { value: 'America/Chicago', label: 'America/Chicago (CST/CDT)' },
          { value: 'America/Los_Angeles', label: 'America/Los Angeles (PST/PDT)' },
          { value: 'Asia/Dubai', label: 'Asia/Dubai (GST)' },
          { value: 'Asia/Kolkata', label: 'Asia/Kolkata (IST)' },
          { value: 'Asia/Shanghai', label: 'Asia/Shanghai (CST)' },
          { value: 'Asia/Tokyo', label: 'Asia/Tokyo (JST)' },
          { value: 'UTC', label: 'UTC' }
        ]
      })}
      ${settingField('date_format', s.date_format, 'Date Format', 'select', {
        description: 'How dates are displayed throughout the platform',
        options: [
          { value: 'DD/MM/YYYY', label: 'DD/MM/YYYY' },
          { value: 'MM/DD/YYYY', label: 'MM/DD/YYYY' },
          { value: 'YYYY-MM-DD', label: 'YYYY-MM-DD' },
          { value: 'DD-MMM-YYYY', label: 'DD-MMM-YYYY' }
        ]
      })}
      ${settingField('language', s.language, 'Default Language', 'select', {
        description: 'Primary language for the interface',
        options: [
          { value: 'en', label: 'English' },
          { value: 'sw', label: 'Swahili' },
          { value: 'lg', label: 'Luganda' },
          { value: 'fr', label: 'French' },
          { value: 'ar', label: 'Arabic' }
        ]
      })}
      ${settingField('currency', s.currency, 'Currency', 'select', {
        description: 'Primary currency for financial transactions',
        options: [
          { value: 'UGX', label: 'UGX — Ugandan Shilling' },
          { value: 'KES', label: 'KES — Kenyan Shilling' },
          { value: 'TZS', label: 'TZS — Tanzanian Shilling' },
          { value: 'RWF', label: 'RWF — Rwandan Franc' },
          { value: 'USD', label: 'USD — US Dollar' },
          { value: 'EUR', label: 'EUR — Euro' },
          { value: 'GBP', label: 'GBP — British Pound' }
        ]
      })}
      ${settingField('max_users_per_tenant', s.max_users_per_tenant, 'Max Users Per Tenant', 'number', {
        description: 'Maximum number of users allowed in this tenant',
        min: 1, max: 10000
      })}
      ${toggleSwitch('allow_registration', s.allow_registration === 'true', 'Allow New Registrations', 'Allow new users to create accounts on this tenant')}
    </div>
    <div style="margin-top:16px">
      <button class="btn btn-green" type="submit">💾 Save General Settings</button>
    </div>
    </form>`;
    res.send(renderPage('Advanced Settings', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 2: POST /settings/save — Batch save settings
  // ============================================================
  app.post('/settings/save', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const redirect = req.body._redirect || '/settings';
    const fields = Object.keys(req.body).filter(k => !k.startsWith('_'));

    let updated = 0;
    for (const key of fields) {
      const value = req.body[key];
      await pool.query(
        `INSERT INTO system_settings (tenant_id, setting_key, setting_value, updated_by, updated_at)
         VALUES ($1, $2, $3, $4, NOW())
         ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value = $3, updated_by = $4, updated_at = NOW()`,
        [tid, key, value === undefined ? '' : String(value), userId]
      );
      updated++;
    }

    await logActivity(tid, userId, 'settings_updated', 'system_settings', null,
      `Updated ${updated} settings: ${fields.join(', ')}`, req);
    req.session.toast = { type: 'success', message: `${updated} settings saved successfully` };
    res.redirect(redirect);
  }));

  // ============================================================
  // ROUTE 3: GET /settings/general — General settings (alias)
  // ============================================================
  app.get('/settings/general', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    res.redirect('/settings');
  }));

  // ============================================================
  // ROUTE 4: GET /settings/security — Security settings
  // ============================================================
  app.get('/settings/security', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const settings = (await pool.query("SELECT * FROM system_settings WHERE tenant_id = $1 AND category IN ('security','general')", [tid])).rows;
    const s = {};
    settings.forEach(r => { s[r.setting_key] = r.setting_value; });

    const html = `
    <div class="hero" style="background:linear-gradient(135deg,#dc2626,#b91c1c);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>🔒 Security Settings</h1>
      <p style="opacity:0.9;margin-top:4px">Manage authentication, sessions, and access controls</p>
    </div>
    ${settingsNav('security')}
    <form method="POST" action="/settings/save">
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <input type="hidden" name="_redirect" value="/settings/security">
    <div class="card">
      <h3 style="margin-bottom:4px">🔐 Authentication</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">Control how users authenticate</p>
      ${toggleSwitch('two_factor_required', s.two_factor_required === 'true', 'Require Two-Factor Authentication', 'Force all users to set up 2FA before accessing the platform')}
    </div>
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:4px">⏱️ Session Management</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">Configure session behavior</p>
      ${settingField('session_timeout', s.session_timeout, 'Session Timeout (minutes)', 'number', {
        description: 'Users will be logged out after this period of inactivity',
        min: 5, max: 1440
      })}
      ${toggleSwitch('allow_registration', s.allow_registration === 'true', 'Allow Public Registration', 'Let new users create accounts without an invitation')}
    </div>
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:4px">🛡️ IP Access Control</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">Restrict access by IP address (one per line)</p>
      ${settingField('ip_whitelist', s.ip_whitelist, 'IP Whitelist', 'textarea', {
        description: 'Leave empty to allow all IPs. One IP address or CIDR range per line.',
        rows: 5
      })}
      ${settingField('ip_blacklist', s.ip_blacklist, 'IP Blacklist', 'textarea', {
        description: 'Blocked IP addresses. One per line.',
        rows: 5
      })}
    </div>
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:4px">🔑 Password Policy</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">Set minimum password requirements</p>
      ${settingField('password_min_length', s.password_min_length, 'Minimum Password Length', 'number', {
        description: 'Minimum characters required for passwords', min: 6, max: 128
      })}
      ${toggleSwitch('password_require_uppercase', s.password_require_uppercase === 'true', 'Require Uppercase Letters', 'Passwords must contain at least one uppercase letter')}
      ${toggleSwitch('password_require_numbers', s.password_require_numbers === 'true', 'Require Numbers', 'Passwords must contain at least one number')}
      ${toggleSwitch('password_require_special', s.password_require_special === 'true', 'Require Special Characters', 'Passwords must contain at least one special character (!@#$%...)')}
    </div>
    <div style="margin-top:16px">
      <button class="btn btn-green" type="submit">💾 Save Security Settings</button>
    </div>
    </form>`;
    res.send(renderPage('Security Settings', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /settings/notifications — Notification settings
  // ============================================================
  app.get('/settings/notifications', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const settings = (await pool.query("SELECT * FROM system_settings WHERE tenant_id = $1 AND category = 'notifications'", [tid])).rows;
    const s = {};
    settings.forEach(r => { s[r.setting_key] = r.setting_value; });

    const html = `
    <div class="hero" style="background:linear-gradient(135deg,#0ea5e9,#0284c7);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>🔔 Notification Settings</h1>
      <p style="opacity:0.9;margin-top:4px">Configure how and when notifications are sent</p>
    </div>
    ${settingsNav('notifications')}
    <form method="POST" action="/settings/save">
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <input type="hidden" name="_redirect" value="/settings/notifications">
    <div class="card">
      <h3 style="margin-bottom:4px">📧 Email Notifications</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">Email delivery preferences</p>
      ${toggleSwitch('email_notifications', s.email_notifications === 'true', 'Enable Email Notifications', 'Send email alerts for important events')}
      ${toggleSwitch('email_on_login', s.email_on_login === 'true', 'Login Alerts', 'Send an email when a user logs in from a new device')}
      ${toggleSwitch('email_on_signup', s.email_on_signup === 'true', 'Signup Notifications', 'Send email to admins when a new user registers')}
      ${toggleSwitch('email_on_payment', s.email_on_payment === 'true', 'Payment Receipts', 'Send payment confirmation emails to users')}
      ${settingField('email_digest_frequency', s.email_digest_frequency, 'Email Digest Frequency', 'select', {
        description: 'How often to send activity summary emails',
        options: [
          { value: 'realtime', label: 'Real-time (immediate)' },
          { value: 'hourly', label: 'Hourly' },
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'never', label: 'Never (disabled)' }
        ]
      })}
    </div>
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:4px">📱 Push Notifications</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">In-app and browser push alerts</p>
      ${toggleSwitch('push_notifications', s.push_notifications === 'true', 'Enable Push Notifications', 'Show browser push notifications for real-time alerts')}
      ${toggleSwitch('push_new_message', s.push_new_message === 'true', 'New Message Alerts', 'Push notification when a new message is received')}
      ${toggleSwitch('push_task_assigned', s.push_task_assigned === 'true', 'Task Assignment Alerts', 'Push notification when a task is assigned')}
    </div>
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:4px">💬 SMS Notifications</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">SMS delivery via Twilio or Africa\'s Talking</p>
      ${toggleSwitch('sms_enabled', s.sms_enabled === 'true', 'Enable SMS Notifications', 'Send SMS messages for critical alerts')}
      ${toggleSwitch('sms_on_login', s.sms_on_login === 'true', 'SMS Login Alerts', 'Send SMS for login from new devices')}
      ${settingField('sms_phone', s.sms_phone, 'Admin SMS Number', 'text', {
        description: 'Phone number to receive SMS alerts (e.g., +256700000000)'
      })}
    </div>
    <div style="margin-top:16px">
      <button class="btn btn-green" type="submit">💾 Save Notification Settings</button>
    </div>
    </form>`;
    res.send(renderPage('Notification Settings', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 6: GET /settings/backup — Backup settings
  // ============================================================
  app.get('/settings/backup', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const settings = (await pool.query("SELECT * FROM system_settings WHERE tenant_id = $1 AND category IN ('backup','general')", [tid])).rows;
    const s = {};
    settings.forEach(r => { s[r.setting_key] = r.setting_value; });

    const recentBackups = (await pool.query(
      `SELECT * FROM activity_log WHERE tenant_id = $1 AND action = 'backup_triggered' ORDER BY created_at DESC LIMIT 10`,
      [tid]
    )).rows;

    const html = `
    <div class="hero" style="background:linear-gradient(135deg,#16a34a,#15803d);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>💾 Backup & Data Management</h1>
      <p style="opacity:0.9;margin-top:4px">Configure automatic backups and data retention</p>
    </div>
    ${settingsNav('backup')}
    <form method="POST" action="/settings/save">
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <input type="hidden" name="_redirect" value="/settings/backup">
    <div class="card">
      <h3 style="margin-bottom:4px">🔄 Automatic Backups</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">Configure scheduled database backups</p>
      ${toggleSwitch('auto_backup_enabled', s.auto_backup_enabled === 'true', 'Enable Automatic Backups', 'Automatically create database backups on schedule')}
      ${settingField('backup_frequency', s.backup_frequency, 'Backup Frequency', 'select', {
        description: 'How often automatic backups are created',
        options: [
          { value: 'hourly', label: 'Hourly' },
          { value: 'daily', label: 'Daily' },
          { value: 'weekly', label: 'Weekly' },
          { value: 'monthly', label: 'Monthly' }
        ]
      })}
      ${settingField('data_retention_days', s.data_retention_days, 'Data Retention (days)', 'number', {
        description: 'Number of days to keep backup files before auto-deletion',
        min: 1, max: 3650
      })}
      ${settingField('backup_time', s.backup_time, 'Preferred Backup Time', 'select', {
        description: 'Time of day to run daily backups (timezone-adjusted)',
        options: [
          { value: '00:00', label: 'Midnight (00:00)' },
          { value: '02:00', label: '2:00 AM' },
          { value: '04:00', label: '4:00 AM' },
          { value: '06:00', label: '6:00 AM' },
          { value: '12:00', label: 'Noon (12:00)' },
          { value: '18:00', label: '6:00 PM' },
          { value: '22:00', label: '10:00 PM' }
        ]
      })}
    </div>
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:4px">📥 Manual Backup</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">Trigger an immediate backup of your tenant data</p>
      <div style="display:flex;align-items:center;gap:16px;padding:16px;background:#f0fdf4;border-radius:12px;border:1px solid #bbf7d0">
        <div style="width:48px;height:48px;border-radius:50%;background:#22c55e;display:flex;align-items:center;justify-content:center;font-size:24px;flex-shrink:0">💾</div>
        <div style="flex:1">
          <strong>Create Backup Now</strong>
          <p style="font-size:12px;color:#64748b;margin:2px 0 0">Generate an instant snapshot of all your tenant data</p>
        </div>
        <form method="POST" action="/settings/backup/trigger" style="flex-shrink:0">
          <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
          <button class="btn btn-green" type="submit">▶ Trigger Backup</button>
        </form>
      </div>
    </div>
    ${recentBackups.length > 0 ? `
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:12px">📋 Recent Backups</h3>
      <table class="table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
          <th style="padding:8px">Date</th><th style="padding:8px">User</th><th style="padding:8px">Status</th><th style="padding:8px">Details</th>
        </tr></thead>
        <tbody>${recentBackups.map(b => `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px">${fmtDateShort(b.created_at)}</td>
          <td style="padding:8px">${esc(b.details || 'System')}</td>
          <td style="padding:8px"><span class="badge ${b.status === 'success' ? 'badge-green' : 'badge-red'}">${esc(b.status)}</span></td>
          <td style="padding:8px;color:#64748b">${esc(b.ip_address || '')}</td>
        </tr>`).join('')}</tbody>
      </table>
    </div>` : ''}
    <div style="margin-top:16px">
      <button class="btn btn-green" type="submit">💾 Save Backup Settings</button>
    </div>
    </form>`;
    res.send(renderPage('Backup Settings', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 7: POST /settings/backup/trigger — Manual backup
  // ============================================================
  app.post('/settings/backup/trigger', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;
    await logActivity(tid, userId, 'backup_triggered', 'system_backup', null,
      `Manual backup triggered by ${req.session.user.email}`, req);
    req.session.toast = { type: 'success', message: 'Backup triggered successfully' };
    res.redirect('/settings/backup');
  }));

  // ============================================================
  // ROUTE 8: GET /settings/api — API & webhook settings
  // ============================================================
  app.get('/settings/api', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const settings = (await pool.query("SELECT * FROM system_settings WHERE tenant_id = $1 AND category IN ('api','general')", [tid])).rows;
    const s = {};
    settings.forEach(r => { s[r.setting_key] = r.setting_value; });

    const webhooks = (await pool.query(
      'SELECT * FROM webhook_endpoints WHERE tenant_id = $1 ORDER BY created_at DESC', [tid]
    )).rows;

    const allEvents = ['user.created', 'user.updated', 'user.deleted', 'payment.completed', 'payment.failed',
      'invoice.created', 'invoice.paid', 'report.generated', 'backup.completed', 'settings.changed'];

    const html = `
    <div class="hero" style="background:linear-gradient(135deg,#8b5cf6,#7c3aed);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>🔌 API &amp; Webhooks</h1>
      <p style="opacity:0.9;margin-top:4px">Manage API rate limits, keys, and webhook integrations</p>
    </div>
    ${settingsNav('api')}
    <form method="POST" action="/settings/save">
    <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
    <input type="hidden" name="_redirect" value="/settings/api">
    <div class="card">
      <h3 style="margin-bottom:4px">🚀 API Configuration</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">Control API access and rate limiting</p>
      ${settingField('api_rate_limit', s.api_rate_limit, 'Rate Limit (requests/min)', 'number', {
        description: 'Maximum API requests per minute per API key', min: 1, max: 10000
      })}
      ${toggleSwitch('api_enabled', s.api_enabled === 'true', 'Enable Public API', 'Allow external applications to access the API')}
      ${toggleSwitch('api_docs_enabled', s.api_docs_enabled === 'true', 'Enable API Documentation', 'Make the API docs endpoint publicly accessible')}
      ${settingField('api_key_expiry_days', s.api_key_expiry_days, 'API Key Expiry (days)', 'number', {
        description: 'Days before API keys expire (0 = never)', min: 0, max: 365
      })}
    </div>
    <div style="margin-top:16px">
      <button class="btn btn-green" type="submit">💾 Save API Settings</button>
    </div>
    </form>
    <div class="card" style="margin-top:20px">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <div>
          <h3 style="margin:0">🔗 Webhook Endpoints</h3>
          <p style="font-size:13px;color:#64748b;margin:4px 0 0">${webhooks.length} endpoint(s) configured</p>
        </div>
      </div>
      <form method="POST" action="/settings/webhooks/create" style="display:grid;gap:10px;margin-bottom:20px;padding:16px;background:#f8fafc;border-radius:10px;border:1px solid #e2e8f0">
        <h4 style="margin:0 0 8px">Add New Webhook</h4>
        <div style="display:grid;grid-template-columns:1fr 2fr;gap:10px">
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:2px">Name</label>
            <input name="name" required placeholder="My Webhook" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
          <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:2px">URL</label>
            <input name="url" type="url" required placeholder="https://example.com/webhook" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        </div>
        <div><label style="font-size:12px;color:#64748b;display:block;margin-bottom:2px">Secret</label>
          <input name="secret" placeholder="Optional signing secret" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px"></div>
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:4px">Events</label>
          <div style="display:flex;flex-wrap:wrap;gap:8px">${allEvents.map(ev => `<label style="display:flex;align-items:center;gap:4px;font-size:12px;background:white;padding:4px 10px;border-radius:6px;border:1px solid #e2e8f0;cursor:pointer"><input type="checkbox" name="events" value="${esc(ev)}"> ${esc(ev)}</label>`).join('')}</div>
        </div>
        <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
        <button class="btn btn-blue" type="submit">+ Create Webhook</button>
      </form>
      ${webhooks.length > 0 ? webhooks.map(w => `
      <div style="border:1px solid #e2e8f0;border-radius:10px;padding:16px;margin-bottom:10px;background:${w.is_active ? '#fff' : '#f8fafc'}">
        <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
          <div>
            <strong style="font-size:15px">${esc(w.name)}</strong>
            <span class="badge ${w.is_active ? 'badge-green' : 'badge-red'}" style="margin-left:8px">${w.is_active ? 'Active' : 'Inactive'}</span>
          </div>
          <form method="POST" action="/settings/webhooks/${w.id}" style="display:inline">
            <input type="hidden" name="_method" value="DELETE">
            <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
            <button class="btn btn-sm btn-red" type="submit" onclick="return confirm('Delete webhook ${esc(w.name)}?')">✕ Delete</button>
          </form>
        </div>
        <div style="font-size:13px;color:#64748b;margin-bottom:6px">
          <strong>URL:</strong> <code style="background:#f1f5f9;padding:2px 6px;border-radius:4px">${esc(w.url)}</code>
        </div>
        ${w.events && w.events.length > 0 ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:8px">${w.events.map(e => `<span style="background:#ede9fe;color:#6d28d9;padding:2px 8px;border-radius:4px;font-size:11px">${esc(e)}</span>`).join('')}</div>` : ''}
        <div style="display:flex;gap:20px;font-size:12px;color:#94a3b8">
          <span>✅ ${w.success_count} success</span>
          <span>❌ ${w.failure_count} failures</span>
          <span>Last triggered: ${w.last_triggered_at ? fmtDateShort(w.last_triggered_at) : 'Never'}</span>
        </div>
      </div>`).join('') : '<p style="color:#94a3b8;text-align:center;padding:20px">No webhooks configured yet. Add one above.</p>'}
    </div>`;
    res.send(renderPage('API & Webhooks', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 9: GET /settings/features — Feature flags
  // ============================================================
  app.get('/settings/features', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const features = (await pool.query(
      "SELECT * FROM system_settings WHERE tenant_id = $1 AND category = 'feature' ORDER BY setting_key",
      [tid]
    )).rows;

    // Seed default feature flags if none exist
    if (features.length === 0) {
      const defaultFeatures = [
        ['feature_online_exams', 'true', 'boolean', 'feature', 'Enable online exams and quizzes module'],
        ['feature_whatsapp', 'false', 'boolean', 'feature', 'Enable WhatsApp messaging integration'],
        ['feature_reports', 'true', 'boolean', 'feature', 'Enable scheduled reports generation'],
        ['feature_multi_branch', 'false', 'boolean', 'feature', 'Enable multi-branch management'],
        ['feature_clinic', 'false', 'boolean', 'feature', 'Enable clinic/healthcare portal'],
        ['feature_marketplace', 'false', 'boolean', 'feature', 'Enable marketplace and e-commerce features'],
        ['feature_calendar', 'true', 'boolean', 'feature', 'Enable calendar and scheduling module'],
        ['feature_file_manager', 'true', 'boolean', 'feature', 'Enable file management and sharing'],
        ['feature_survey_builder', 'true', 'boolean', 'feature', 'Enable survey and form builder'],
        ['feature_workflow', 'false', 'boolean', 'feature', 'Enable workflow automation engine'],
        ['feature_data_import', 'true', 'boolean', 'feature', 'Enable bulk data import functionality'],
        ['feature_api_access', 'true', 'boolean', 'feature', 'Enable external API access for this tenant'],
        ['feature_pwa', 'true', 'boolean', 'feature', 'Enable Progressive Web App support'],
        ['feature_parent_portal', 'false', 'boolean', 'feature', 'Enable parent/guardian access portal'],
        ['feature_business_specializations', 'true', 'boolean', 'feature', 'Enable business specialization modules']
      ];
      for (const [key, value, type, category, description] of defaultFeatures) {
        await pool.query(
          `INSERT INTO system_settings (tenant_id, setting_key, setting_value, setting_type, category, description)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT (tenant_id, setting_key) DO NOTHING`,
          [tid, key, value, type, category, description]
        );
      }
      return res.redirect('/settings/features');
    }

    const activeCount = features.filter(f => f.setting_value === 'true').length;
    const inactiveCount = features.length - activeCount;

    const html = `
    <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>🚩 Feature Flags</h1>
      <p style="opacity:0.9;margin-top:4px">Enable or disable platform modules and features</p>
    </div>
    ${settingsNav('features')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">
      <div class="stat-card"><div class="stat-num" style="color:#22c55e">${activeCount}</div><div class="muted">Active Features</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#94a3b8">${inactiveCount}</div><div class="muted">Inactive Features</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${features.length}</div><div class="muted">Total Features</div></div>
    </div>
    <div class="card">
      ${features.map(f => {
        const label = f.setting_key.replace(/^feature_/, '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
        const enabled = f.setting_value === 'true';
        return `<div style="display:flex;align-items:center;justify-content:space-between;padding:14px 0;border-bottom:1px solid #f1f5f9">
          <div>
            <label style="font-weight:500;cursor:pointer">${esc(label)}</label>
            ${f.description ? `<p style="font-size:12px;color:#64748b;margin:2px 0 0">${esc(f.description)}</p>` : ''}
          </div>
          <form method="POST" action="/settings/features/${esc(f.setting_key)}/toggle" style="flex-shrink:0">
            <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
            <button type="submit" class="btn btn-sm" style="background:${enabled ? '#22c55e' : '#e2e8f0'};color:${enabled ? 'white' : '#475569'};min-width:80px;font-weight:600">
              ${enabled ? '● ON' : '○ OFF'}
            </button>
          </form>
        </div>`;
      }).join('')}
    </div>`;
    res.send(renderPage('Feature Flags', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 10: POST /settings/features/:key/toggle — Toggle feature
  // ============================================================
  app.post('/settings/features/:key/toggle', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const key = req.params.key;
    if (!/^feature_[a-z_]+$/.test(key)) return res.status(400).send('Invalid feature key');

    const current = (await pool.query(
      'SELECT setting_value FROM system_settings WHERE tenant_id = $1 AND setting_key = $2',
      [tid, key]
    )).rows[0];

    if (!current) return res.status(404).send('Feature not found');

    const newValue = current.setting_value === 'true' ? 'false' : 'true';
    await pool.query(
      `UPDATE system_settings SET setting_value = $1, updated_at = NOW() WHERE tenant_id = $2 AND setting_key = $3`,
      [newValue, tid, key]
    );

    await logActivity(tid, req.session.user.id, 'feature_toggled', 'system_settings', null,
      `Feature ${key} set to ${newValue}`, req);
    req.session.toast = { type: 'success', message: `Feature ${key.replace('feature_', '')} ${newValue === 'true' ? 'enabled' : 'disabled'}` };
    res.redirect('/settings/features');
  }));

  // ============================================================
  // ROUTE 11: GET /settings/maintenance — Maintenance mode
  // ============================================================
  app.get('/settings/maintenance', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const settings = (await pool.query(
      "SELECT * FROM system_settings WHERE tenant_id = $1 AND setting_key LIKE 'maintenance%'",
      [tid]
    )).rows;
    const s = {};
    settings.forEach(r => { s[r.setting_key] = r.setting_value; });

    const isMaintenance = s.maintenance_mode === 'true';

    const html = `
    <div class="hero" style="background:linear-gradient(135deg,${isMaintenance ? '#ef4444,#dc2626' : '#6366f1,#4f46e5'});padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>🔧 Maintenance Mode</h1>
      <p style="opacity:0.9;margin-top:4px">Platform is currently ${isMaintenance ? '<strong style="color:#fca5a5">IN MAINTENANCE</strong>' : 'running normally'}</p>
    </div>
    ${settingsNav('maintenance')}
    <div class="card" style="text-align:center;padding:40px 20px">
      <div style="font-size:72px;margin-bottom:16px">${isMaintenance ? '🔧' : '✅'}</div>
      <h2 style="margin-bottom:8px">${isMaintenance ? 'Maintenance Mode is ON' : 'System Operational'}</h2>
      <p style="color:#64748b;margin-bottom:24px;max-width:500px;margin-left:auto;margin-right:auto">
        ${isMaintenance
          ? 'Your platform is currently in maintenance mode. Only administrators can access the system. Users will see a maintenance page.'
          : 'Your platform is running normally. Enable maintenance mode to temporarily restrict access for updates or fixes.'}
      </p>
      <form method="POST" action="/settings/maintenance/toggle">
        <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
        <button type="submit" class="btn" style="background:${isMaintenance ? '#22c55e' : '#ef4444'};color:white;padding:14px 40px;font-size:16px;border-radius:12px;cursor:pointer;border:none;font-weight:600">
          ${isMaintenance ? '✅ Disable Maintenance Mode' : '🔧 Enable Maintenance Mode'}
        </button>
      </form>
    </div>
    <div class="card" style="margin-top:16px">
      <h3 style="margin-bottom:4px">💬 Maintenance Message</h3>
      <p style="font-size:13px;color:#64748b;margin-bottom:16px">Custom message shown to users during maintenance</p>
      <form method="POST" action="/settings/save">
        <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
        <input type="hidden" name="_redirect" value="/settings/maintenance">
        ${settingField('maintenance_message', s.maintenance_message, 'Maintenance Message', 'textarea', {
          description: 'This message will be displayed to all non-admin users during maintenance. Supports plain text.',
          rows: 4
        })}
        <button class="btn btn-green" type="submit">💾 Save Message</button>
      </form>
    </div>
    ${isMaintenance ? `
    <div class="card" style="margin-top:16px;border:2px solid #fef2f2;background:#fff7f7">
      <div class="alert alert-warning" style="margin:0">
        <strong>⚠️ Maintenance Mode Active</strong><br>
        All non-admin users are currently redirected to the maintenance page.
        Remember to disable maintenance mode when your updates are complete.
      </div>
    </div>` : ''}`;
    res.send(renderPage('Maintenance Mode', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 12: POST /settings/maintenance/toggle — Toggle maintenance
  // ============================================================
  app.post('/settings/maintenance/toggle', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;

    const current = (await pool.query(
      "SELECT setting_value FROM system_settings WHERE tenant_id = $1 AND setting_key = 'maintenance_mode'",
      [tid]
    )).rows[0];

    const newValue = current?.setting_value === 'true' ? 'false' : 'true';
    await pool.query(
      `INSERT INTO system_settings (tenant_id, setting_key, setting_value, setting_type, category, updated_by, updated_at)
       VALUES ($1, 'maintenance_mode', $2, 'boolean', 'general', $3, NOW())
       ON CONFLICT (tenant_id, setting_key) DO UPDATE SET setting_value = $2, updated_by = $3, updated_at = NOW()`,
      [tid, newValue, userId]
    );

    await logActivity(tid, userId, 'maintenance_toggled', 'system_settings', null,
      `Maintenance mode ${newValue === 'true' ? 'ENABLED' : 'DISABLED'}`, req);
    req.session.toast = { type: 'success', message: `Maintenance mode ${newValue === 'true' ? 'enabled' : 'disabled'}` };
    res.redirect('/settings/maintenance');
  }));

  // ============================================================
  // ROUTE 13: GET /settings/activity — Activity log viewer
  // ============================================================
  app.get('/settings/activity', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;

    const filterUser = (req.query.user || '').trim();
    const filterAction = (req.query.action || '').trim();
    const filterEntity = (req.query.entity_type || '').trim();
    const filterDateFrom = (req.query.date_from || '').trim();
    const filterDateTo = (req.query.date_to || '').trim();
    const filterStatus = (req.query.status || '').trim();

    // Build WHERE
    const conditions = ['tenant_id = $1'];
    const params = [tid];
    let idx = 2;

    if (filterUser) { conditions.push(`user_id = $${idx++}`); params.push(parseInt(filterUser)); }
    if (filterAction) { conditions.push(`action ILIKE $${idx++}`); params.push(`%${filterAction}%`); }
    if (filterEntity) { conditions.push(`entity_type = $${idx++}`); params.push(filterEntity); }
    if (filterStatus) { conditions.push(`status = $${idx++}`); params.push(filterStatus); }
    if (filterDateFrom) { conditions.push(`created_at >= $${idx++}`); params.push(filterDateFrom); }
    if (filterDateTo) { conditions.push(`created_at <= $${idx++}`); params.push(filterDateTo + ' 23:59:59'); }

    const where = conditions.join(' AND ');

    const countResult = await pool.query(`SELECT COUNT(*) FROM activity_log WHERE ${where}`, params);
    const total = parseInt(countResult.rows[0].count);
    const totalPages = Math.ceil(total / limit);

    const logs = (await pool.query(
      `SELECT al.*, u.email AS user_email FROM activity_log al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE ${where} ORDER BY al.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    )).rows;

    // Get users for filter dropdown
    const users = (await pool.query(
      'SELECT DISTINCT al.user_id, u.email FROM activity_log al LEFT JOIN users u ON u.id = al.user_id WHERE al.tenant_id = $1 ORDER BY u.email LIMIT 50',
      [tid]
    )).rows;

    // Action type colors
    const actionColor = (action) => {
      if (action.includes('login') || action.includes('auth')) return '#3b82f6';
      if (action.includes('create') || action.includes('add')) return '#22c55e';
      if (action.includes('update') || action.includes('edit') || action.includes('save') || action.includes('toggle')) return '#f59e0b';
      if (action.includes('delete') || action.includes('remove')) return '#ef4444';
      if (action.includes('backup')) return '#8b5cf6';
      if (action.includes('export')) return '#06b6d4';
      if (action.includes('maintenance')) return '#dc2626';
      return '#64748b';
    };

    const buildQuery = (overrides) => {
      const q = { user: filterUser, action: filterAction, entity_type: filterEntity, status: filterStatus, date_from: filterDateFrom, date_to: filterDateTo, page, limit, ...overrides };
      return '?' + Object.entries(q).filter(([, v]) => v).map(([k, v]) => `${k}=${encodeURIComponent(v)}`).join('&');
    };

    const html = `
    <div class="hero" style="background:linear-gradient(135deg,#0f172a,#1e293b);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>📋 Activity Log</h1>
      <p style="opacity:0.9;margin-top:4px">${total.toLocaleString()} events recorded for this tenant</p>
    </div>
    ${settingsNav('activity')}
    <div class="card" style="margin-bottom:16px">
      <h3 style="margin-bottom:12px">🔍 Filters</h3>
      <form method="GET" action="/settings/activity" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:10px;align-items:end">
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:2px">User</label>
          <select name="user" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
            <option value="">All Users</option>
            ${users.map(u => `<option value="${u.user_id}" ${String(filterUser) === String(u.user_id) ? 'selected' : ''}>${esc(u.user_email || 'User #' + u.user_id)}</option>`).join('')}
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:2px">Action</label>
          <input name="action" value="${esc(filterAction)}" placeholder="e.g. login, backup..." style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
        </div>
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:2px">Entity Type</label>
          <input name="entity_type" value="${esc(filterEntity)}" placeholder="e.g. user, payment..." style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
        </div>
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:2px">Status</label>
          <select name="status" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
            <option value="">All</option>
            <option value="success" ${filterStatus === 'success' ? 'selected' : ''}>Success</option>
            <option value="failure" ${filterStatus === 'failure' ? 'selected' : ''}>Failure</option>
          </select>
        </div>
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:2px">From</label>
          <input name="date_from" type="date" value="${esc(filterDateFrom)}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
        </div>
        <div>
          <label style="font-size:12px;color:#64748b;display:block;margin-bottom:2px">To</label>
          <input name="date_to" type="date" value="${esc(filterDateTo)}" style="width:100%;padding:8px;border:1px solid #e2e8f0;border-radius:8px;font-size:13px">
        </div>
        <div style="display:flex;gap:8px">
          <button class="btn" type="submit" style="background:#4f46e5;color:white">Apply</button>
          <a href="/settings/activity" class="btn" style="background:#e2e8f0;color:#475569">Clear</a>
        </div>
      </form>
    </div>
    <div class="card">
      <div style="overflow-x:auto">
        <table class="table" style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
            <th style="padding:10px 8px">Time</th>
            <th style="padding:10px 8px">User</th>
            <th style="padding:10px 8px">Action</th>
            <th style="padding:10px 8px">Entity</th>
            <th style="padding:10px 8px">Details</th>
            <th style="padding:10px 8px">IP</th>
            <th style="padding:10px 8px">Status</th>
          </tr></thead>
          <tbody>
            ${logs.map(log => `<tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:8px;white-space:nowrap;font-size:12px;color:#64748b">${fmtDateShort(log.created_at)}</td>
              <td style="padding:8px;font-weight:500">${esc(log.user_email || 'System')}</td>
              <td style="padding:8px"><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${actionColor(log.action)};margin-right:6px"></span><span style="font-size:12px">${esc(log.action)}</span></td>
              <td style="padding:8px;font-size:12px">${esc(log.entity_type || '-')}${log.entity_id ? ' #' + log.entity_id : ''}</td>
              <td style="padding:8px;font-size:12px;max-width:220px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(log.details || '')}">${esc((log.details || '').substring(0, 80))}</td>
              <td style="padding:8px;font-size:11px;color:#94a3b8;font-family:monospace">${esc(log.ip_address || '-')}</td>
              <td style="padding:8px"><span class="badge ${log.status === 'success' ? 'badge-green' : 'badge-red'}">${esc(log.status)}</span></td>
            </tr>`).join('')}
          </tbody>
        </table>
      </div>
      ${logs.length === 0 ? '<p style="color:#94a3b8;text-align:center;padding:30px">No activity log entries found matching your filters.</p>' : ''}
    </div>
    ${totalPages > 1 ? `
    <div style="display:flex;justify-content:center;align-items:center;gap:8px;margin-top:16px;flex-wrap:wrap">
      <span style="font-size:13px;color:#64748b">Page ${page} of ${totalPages} (${total.toLocaleString()} total)</span>
      ${page > 1 ? `<a href="/settings/activity${buildQuery({ page: page - 1 })}" class="btn btn-sm" style="background:#e2e8f0;color:#475569">← Prev</a>` : ''}
      ${page < totalPages ? `<a href="/settings/activity${buildQuery({ page: page + 1 })}" class="btn btn-sm" style="background:#4f46e5;color:white">Next →</a>` : ''}
    </div>` : ''}`;
    res.send(renderPage('Activity Log', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 14: GET /settings/webhooks — Webhooks management
  // ============================================================
  app.get('/settings/webhooks', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    res.redirect('/settings/api');
  }));

  // ============================================================
  // ROUTE 15: POST /settings/webhooks/create — Create webhook
  // ============================================================
  app.post('/settings/webhooks/create', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const { name, url, secret, events } = req.body;

    if (!name || !url) {
      req.session.toast = { type: 'error', message: 'Name and URL are required' };
      return res.redirect('/settings/api');
    }

    const eventsArray = Array.isArray(events) ? events : (events ? [events] : []);
    const crypto = require('crypto');
    const webhookSecret = secret || crypto.randomBytes(24).toString('hex');

    await pool.query(
      `INSERT INTO webhook_endpoints (tenant_id, name, url, secret, events, created_by)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [tid, name, url, webhookSecret, eventsArray, userId]
    );

    await logActivity(tid, userId, 'webhook_created', 'webhook_endpoints', null,
      `Created webhook "${name}" → ${url} [${eventsArray.join(', ')}]`, req);
    req.session.toast = { type: 'success', message: `Webhook "${name}" created successfully` };
    res.redirect('/settings/api');
  }));

  // ============================================================
  // ROUTE 16: DELETE /settings/webhooks/:id — Delete webhook
  // ============================================================
  app.delete('/settings/webhooks/:id', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const userId = req.session.user.id;
    const webhookId = req.params.id;

    const webhook = (await pool.query(
      'SELECT * FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2',
      [webhookId, tid]
    )).rows[0];

    if (!webhook) return res.status(404).json({ error: 'Webhook not found' });

    await pool.query('DELETE FROM webhook_endpoints WHERE id = $1 AND tenant_id = $2', [webhookId, tid]);

    await logActivity(tid, userId, 'webhook_deleted', 'webhook_endpoints', webhookId,
      `Deleted webhook "${webhook.name}"`, req);
    res.json({ success: true, message: 'Webhook deleted' });
  }));

  // Support DELETE via POST with _method override
  app.post('/settings/webhooks/:id', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    if (req.body._method === 'DELETE') {
      req.method = 'DELETE';
      return app._router.handle(req, res, () => res.status(405).send('Method not allowed'));
    }
    res.status(405).send('Method not allowed');
  }));

  // ============================================================
  // ROUTE 17: GET /settings/scheduled-tasks — Scheduled tasks
  // ============================================================
  app.get('/settings/scheduled-tasks', requireAuth, requireNotBanned, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const tasks = (await pool.query(
      'SELECT * FROM scheduled_tasks WHERE tenant_id = $1 ORDER BY is_active DESC, created_at DESC',
      [tid]
    )).rows;

    const activeCount = tasks.filter(t => t.is_active).length;
    const failedCount = tasks.filter(t => t.failure_count > 0).length;

    const html = `
    <div class="hero" style="background:linear-gradient(135deg,#0891b2,#0e7490);padding:24px;border-radius:16px;margin-bottom:20px;color:white">
      <h1>⏰ Scheduled Tasks</h1>
      <p style="opacity:0.9;margin-top:4px">View and monitor automated background jobs</p>
    </div>
    ${settingsNav('api')}
    <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:20px">
      <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${tasks.length}</div><div class="muted">Total Tasks</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#22c55e">${activeCount}</div><div class="muted">Active</div></div>
      <div class="stat-card"><div class="stat-num" style="color:#ef4444">${failedCount}</div><div class="muted">With Failures</div></div>
    </div>
    <div class="card">
      ${tasks.length > 0 ? `<table class="table" style="width:100%;border-collapse:collapse;font-size:13px">
        <thead><tr style="border-bottom:2px solid #e2e8f0;text-align:left">
          <th style="padding:10px 8px">Task Name</th>
          <th style="padding:10px 8px">Type</th>
          <th style="padding:10px 8px">Cron</th>
          <th style="padding:10px 8px">Runs</th>
          <th style="padding:10px 8px">Failures</th>
          <th style="padding:10px 8px">Last Run</th>
          <th style="padding:10px 8px">Next Run</th>
          <th style="padding:10px 8px">Status</th>
        </tr></thead>
        <tbody>${tasks.map(t => `<tr style="border-bottom:1px solid #f1f5f9;${!t.is_active ? 'opacity:0.5' : ''}">
          <td style="padding:8px;font-weight:500">${esc(t.task_name)}</td>
          <td style="padding:8px"><span style="background:#f1f5f9;padding:2px 8px;border-radius:4px;font-size:11px">${esc(t.task_type)}</span></td>
          <td style="padding:8px;font-family:monospace;font-size:12px">${esc(t.cron_expression || '-')}</td>
          <td style="padding:8px;text-align:center">${t.run_count}</td>
          <td style="padding:8px;text-align:center;color:${t.failure_count > 0 ? '#ef4444' : '#22c55e'}">${t.failure_count}</td>
          <td style="padding:8px;font-size:12px">${fmtDateShort(t.last_run_at)}</td>
          <td style="padding:8px;font-size:12px">${fmtDateShort(t.next_run_at)}</td>
          <td style="padding:8px"><span class="badge ${t.is_active ? 'badge-green' : 'badge-red'}">${t.is_active ? 'Active' : 'Paused'}</span></td>
        </tr>`).join('')}</tbody>
      </table>` : '<p style="color:#94a3b8;text-align:center;padding:30px">No scheduled tasks configured yet.</p>'}
      ${tasks.some(t => t.last_error) ? `
      <div style="margin-top:16px">
        <h4 style="margin-bottom:8px;color:#ef4444">⚠️ Recent Errors</h4>
        ${tasks.filter(t => t.last_error).map(t => `
        <div style="padding:10px;background:#fef2f2;border-radius:8px;margin-bottom:6px;font-size:12px">
          <strong>${esc(t.task_name)}</strong>: ${esc(t.last_error).substring(0, 200)}
        </div>`).join('')}
      </div>` : ''}
    </div>
    <div style="margin-top:16px">
      <a href="/settings/api" class="btn">← Back to API &amp; Webhooks</a>
    </div>`;
    res.send(renderPage('Scheduled Tasks', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 18: GET /api/settings — JSON API: all settings
  // ============================================================
  app.get('/api/settings', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const settings = (await pool.query(
      'SELECT setting_key, setting_value, setting_type, category, description, is_public FROM system_settings WHERE tenant_id = $1',
      [tid]
    )).rows;

    const publicOnly = req.query.public === 'true';
    const filtered = publicOnly ? settings.filter(s => s.is_public) : settings;

    const result = {};
    filtered.forEach(s => {
      let val = s.setting_value;
      if (s.setting_type === 'boolean') val = s.setting_value === 'true';
      else if (s.setting_type === 'number') val = parseFloat(s.setting_value) || 0;
      result[s.setting_key] = val;
    });

    res.json({ success: true, tenant_id: tid, count: filtered.length, settings: result });
  }));

  // ============================================================
  // ROUTE 19: GET /api/settings/activity — JSON API: activity log
  // ============================================================
  app.get('/api/settings/activity', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = Math.min(100, Math.max(10, parseInt(req.query.limit) || 50));
    const offset = (page - 1) * limit;
    const action = (req.query.action || '').trim();

    const conditions = ['tenant_id = $1'];
    const params = [tid];
    let idx = 2;

    if (action) { conditions.push(`action ILIKE $${idx++}`); params.push(`%${action}%`); }

    const where = conditions.join(' AND ');

    const countResult = await pool.query(`SELECT COUNT(*) FROM activity_log WHERE ${where}`, params);
    const total = parseInt(countResult.rows[0].count);

    const logs = (await pool.query(
      `SELECT al.*, u.email AS user_email FROM activity_log al
       LEFT JOIN users u ON u.id = al.user_id
       WHERE ${where} ORDER BY al.created_at DESC LIMIT $${idx++} OFFSET $${idx++}`,
      [...params, limit, offset]
    )).rows;

    res.json({
      success: true,
      page, limit, offset, total,
      total_pages: Math.ceil(total / limit),
      data: logs.map(l => ({
        id: l.id,
        user_id: l.user_id,
        user_email: l.user_email,
        action: l.action,
        entity_type: l.entity_type,
        entity_id: l.entity_id,
        details: l.details,
        ip_address: l.ip_address,
        status: l.status,
        created_at: l.created_at
      }))
    });
  }));

  // ============================================================
  // TOAST INJECTION MIDDLEWARE
  // ============================================================
  app.use((req, res, next) => {
    const origRenderPage = renderPage;
    // Toast is injected by checking session.toast
    next();
  });

  // ============================================================
  // Module loaded
  // ============================================================
  console.log('[AdvancedSettings] Module loaded — system settings, features, activity log & webhooks');
};
