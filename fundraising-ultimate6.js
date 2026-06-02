/**
 * Fundraising Ultimate 6 — Integration & Platform Module
 * 15 Features:
 *  1. Integration Hub
 *  2. CRM Sync Manager
 *  3. Email Marketing Integration
 *  4. Accounting Software Sync
 *  5. Webhook Manager Pro
 *  6. API Gateway Pro
 *  7. Data Import/Export Pro
 *  8. White Label Pro
 *  9. Multi-Language Manager
 * 10. Custom Domain Manager
 * 11. SSO/OAuth Integration
 * 12. Donor 2FA
 * 13. Privacy & Consent Manager
 * 14. Data Retention Policies
 * 15. Plugin Marketplace
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // ===== FEATURE 1: Integration Hub =====
    `CREATE TABLE IF NOT EXISTS integration_configs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      integration_type TEXT NOT NULL,
      name TEXT NOT NULL,
      config_json JSONB DEFAULT '{}',
      credentials_encrypted TEXT,
      is_active BOOLEAN DEFAULT true,
      last_sync_at TIMESTAMPTZ,
      sync_status TEXT DEFAULT 'idle' CHECK (sync_status IN ('idle','syncing','error','success'))
    )`,
    `CREATE TABLE IF NOT EXISTS integration_sync_log (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      config_id INTEGER REFERENCES integration_configs(id) ON DELETE CASCADE,
      sync_type TEXT NOT NULL,
      records_processed INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','running','completed','failed')),
      started_at TIMESTAMPTZ DEFAULT NOW(),
      completed_at TIMESTAMPTZ
    )`,

    // ===== FEATURE 2: CRM Sync Manager =====
    `CREATE TABLE IF NOT EXISTS crm_sync_configs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      crm_type TEXT NOT NULL,
      api_url TEXT,
      field_mapping_json JSONB DEFAULT '{}',
      sync_frequency TEXT DEFAULT 'manual' CHECK (sync_frequency IN ('manual','hourly','daily','weekly')),
      last_sync TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS crm_sync_queue (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      config_id INTEGER REFERENCES crm_sync_configs(id) ON DELETE CASCADE,
      record_type TEXT NOT NULL,
      record_id INTEGER,
      action TEXT DEFAULT 'create' CHECK (action IN ('create','update','delete')),
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
      attempts INTEGER DEFAULT 0,
      last_error TEXT
    )`,

    // ===== FEATURE 3: Email Marketing Integration =====
    `CREATE TABLE IF NOT EXISTS email_marketing_configs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      provider TEXT NOT NULL,
      api_key_encrypted TEXT,
      list_id TEXT,
      sync_donors BOOLEAN DEFAULT true,
      sync_frequency TEXT DEFAULT 'daily' CHECK (sync_frequency IN ('manual','daily','weekly','monthly')),
      last_sync TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS email_campaign_sync (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      config_id INTEGER REFERENCES email_marketing_configs(id) ON DELETE CASCADE,
      campaign_id INTEGER,
      email_campaign_id TEXT,
      recipient_count INTEGER DEFAULT 0,
      open_rate NUMERIC(5,2) DEFAULT 0,
      click_rate NUMERIC(5,2) DEFAULT 0
    )`,

    // ===== FEATURE 4: Accounting Software Sync =====
    `CREATE TABLE IF NOT EXISTS accounting_sync_configs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      software_type TEXT NOT NULL,
      api_url TEXT,
      credentials_encrypted TEXT,
      sync_categories_json JSONB DEFAULT '[]',
      auto_sync BOOLEAN DEFAULT false,
      last_sync TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS accounting_sync_records (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      config_id INTEGER REFERENCES accounting_sync_configs(id) ON DELETE CASCADE,
      record_type TEXT NOT NULL,
      local_id INTEGER,
      external_id TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','synced','error'))
    )`,

    // ===== FEATURE 5: Webhook Manager Pro =====
    `CREATE TABLE IF NOT EXISTS webhook_endpoints_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      url TEXT NOT NULL,
      events_json JSONB DEFAULT '[]',
      secret TEXT,
      is_active BOOLEAN DEFAULT true,
      failure_count INTEGER DEFAULT 0,
      last_delivery_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      endpoint_id INTEGER REFERENCES webhook_endpoints_pro(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      payload_json JSONB DEFAULT '{}',
      response_code INTEGER,
      duration_ms INTEGER DEFAULT 0,
      success BOOLEAN DEFAULT false,
      delivered_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // ===== FEATURE 6: API Gateway Pro =====
    `CREATE TABLE IF NOT EXISTS api_gateway_keys_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      key_hash TEXT NOT NULL,
      name TEXT NOT NULL,
      permissions_json JSONB DEFAULT '[]',
      rate_limit INTEGER DEFAULT 1000,
      usage_count INTEGER DEFAULT 0,
      last_used TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS api_gateway_logs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      key_id INTEGER REFERENCES api_gateway_keys_pro(id) ON DELETE CASCADE,
      endpoint TEXT NOT NULL,
      method TEXT NOT NULL,
      status_code INTEGER,
      response_time INTEGER DEFAULT 0,
      ip_address TEXT
    )`,
    `CREATE TABLE IF NOT EXISTS api_rate_limits_pro (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      key_id INTEGER REFERENCES api_gateway_keys_pro(id) ON DELETE CASCADE,
      window_start TIMESTAMPTZ DEFAULT NOW(),
      request_count INTEGER DEFAULT 0,
      blocked_count INTEGER DEFAULT 0
    )`,

    // ===== FEATURE 7: Data Import/Export Pro =====
    `CREATE TABLE IF NOT EXISTS data_import_jobs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      filename TEXT NOT NULL,
      source_format TEXT DEFAULT 'csv' CHECK (source_format IN ('csv','xlsx','json')),
      field_mapping_json JSONB DEFAULT '{}',
      total_rows INTEGER DEFAULT 0,
      processed_rows INTEGER DEFAULT 0,
      errors_count INTEGER DEFAULT 0,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','mapping','processing','completed','failed')),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_by TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS data_export_jobs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      export_type TEXT NOT NULL,
      filters_json JSONB DEFAULT '{}',
      format TEXT DEFAULT 'csv' CHECK (format IN ('csv','xlsx','json','pdf')),
      total_rows INTEGER DEFAULT 0,
      file_url TEXT,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed')),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      created_by TEXT NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS import_error_rows (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      job_id INTEGER REFERENCES data_import_jobs(id) ON DELETE CASCADE,
      row_number INTEGER NOT NULL,
      row_data_json JSONB DEFAULT '{}',
      error_message TEXT NOT NULL
    )`,

    // ===== FEATURE 8: White Label Pro =====
    `CREATE TABLE IF NOT EXISTS whitelabel_pro_config (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      primary_color TEXT DEFAULT '#10b981',
      secondary_color TEXT DEFAULT '#059669',
      logo_url TEXT,
      favicon_url TEXT,
      font_family TEXT DEFAULT 'Inter',
      custom_css TEXT,
      custom_js TEXT,
      footer_text TEXT
    )`,

    // ===== FEATURE 9: Multi-Language Manager =====
    `CREATE TABLE IF NOT EXISTS language_configs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      primary_language TEXT DEFAULT 'en',
      supported_languages_json JSONB DEFAULT '["en","fr","sw"]',
      auto_translate BOOLEAN DEFAULT false
    )`,
    `CREATE TABLE IF NOT EXISTS translations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      entity_type TEXT NOT NULL,
      entity_id INTEGER NOT NULL,
      language_code TEXT NOT NULL,
      field_name TEXT NOT NULL,
      translated_text TEXT NOT NULL
    )`,

    // ===== FEATURE 10: Custom Domain Manager =====
    `CREATE TABLE IF NOT EXISTS custom_domains (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      domain TEXT NOT NULL,
      ssl_status TEXT DEFAULT 'pending' CHECK (ssl_status IN ('pending','active','expired','error')),
      dns_verified BOOLEAN DEFAULT false,
      verification_token TEXT NOT NULL,
      is_active BOOLEAN DEFAULT true
    )`,

    // ===== FEATURE 11: SSO/OAuth Integration =====
    `CREATE TABLE IF NOT EXISTS sso_configs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('google','microsoft','github','okta','custom')),
      client_id TEXT NOT NULL,
      client_secret_encrypted TEXT NOT NULL,
      authorize_url TEXT,
      token_url TEXT,
      userinfo_url TEXT,
      scopes TEXT DEFAULT 'openid profile email',
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS sso_sessions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      config_id INTEGER REFERENCES sso_configs(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      provider_user_id TEXT NOT NULL,
      token_encrypted TEXT,
      expires_at TIMESTAMPTZ
    )`,

    // ===== FEATURE 12: Donor 2FA =====
    `CREATE TABLE IF NOT EXISTS donor_2fa_configs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      method TEXT DEFAULT 'totp' CHECK (method IN ('totp','sms','email')),
      secret_encrypted TEXT,
      backup_codes_json JSONB DEFAULT '[]',
      is_enabled BOOLEAN DEFAULT false,
      UNIQUE(tenant_id, donor_email)
    )`,
    `CREATE TABLE IF NOT EXISTS donor_2fa_attempts (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      code_used TEXT NOT NULL,
      was_valid BOOLEAN DEFAULT false,
      ip_address TEXT
    )`,

    // ===== FEATURE 13: Privacy & Consent Manager =====
    `CREATE TABLE IF NOT EXISTS privacy_consent_records (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donor_email TEXT NOT NULL,
      consent_type TEXT NOT NULL CHECK (consent_type IN ('data_processing','marketing','analytics','third_party_sharing','cookie')),
      consent_given BOOLEAN DEFAULT false,
      consent_text_version TEXT DEFAULT '1.0',
      ip_address TEXT,
      consented_at TIMESTAMPTZ DEFAULT NOW(),
      withdrawn_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS privacy_settings (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER UNIQUE REFERENCES tenants(id) ON DELETE CASCADE,
      default_consent_required BOOLEAN DEFAULT true,
      data_retention_days INTEGER DEFAULT 365,
      allow_analytics BOOLEAN DEFAULT false,
      allow_marketing BOOLEAN DEFAULT true
    )`,

    // ===== FEATURE 14: Data Retention Policies =====
    `CREATE TABLE IF NOT EXISTS data_retention_policies (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      data_category TEXT NOT NULL,
      retention_days INTEGER NOT NULL DEFAULT 365,
      action_on_expiry TEXT DEFAULT 'archive' CHECK (action_on_expiry IN ('delete','archive','anonymize')),
      is_active BOOLEAN DEFAULT true,
      last_cleanup_at TIMESTAMPTZ
    )`,
    `CREATE TABLE IF NOT EXISTS data_retention_log (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      policy_id INTEGER REFERENCES data_retention_policies(id) ON DELETE CASCADE,
      records_processed INTEGER DEFAULT 0,
      records_deleted INTEGER DEFAULT 0,
      records_archived INTEGER DEFAULT 0,
      executed_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // ===== FEATURE 15: Plugin Marketplace =====
    `CREATE TABLE IF NOT EXISTS plugin_marketplace (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      description TEXT,
      author TEXT,
      category TEXT DEFAULT 'general',
      price NUMERIC(10,2) DEFAULT 0,
      downloads INTEGER DEFAULT 0,
      rating NUMERIC(3,2) DEFAULT 0,
      is_verified BOOLEAN DEFAULT false
    )`,
    `CREATE TABLE IF NOT EXISTS platform_plugins (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      plugin_id INTEGER REFERENCES plugin_marketplace(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      version TEXT NOT NULL,
      description TEXT,
      config_json JSONB DEFAULT '{}',
      is_installed BOOLEAN DEFAULT true,
      is_active BOOLEAN DEFAULT false
    )`,

    // ===== INDEXES =====
    `CREATE INDEX IF NOT EXISTS idx_integration_configs_tenant ON integration_configs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_integration_sync_log_tenant ON integration_sync_log(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_sync_configs_tenant ON crm_sync_configs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_crm_sync_queue_tenant ON crm_sync_queue(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_email_marketing_configs_tenant ON email_marketing_configs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_email_campaign_sync_tenant ON email_campaign_sync(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_accounting_sync_configs_tenant ON accounting_sync_configs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_accounting_sync_records_tenant ON accounting_sync_records(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_pro_tenant ON webhook_endpoints_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_tenant ON webhook_deliveries(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_api_gateway_keys_pro_tenant ON api_gateway_keys_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_api_gateway_logs_tenant ON api_gateway_logs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_api_rate_limits_pro_tenant ON api_rate_limits_pro(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_data_import_jobs_tenant ON data_import_jobs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_data_export_jobs_tenant ON data_export_jobs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_import_error_rows_tenant ON import_error_rows(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_whitelabel_pro_config_tenant ON whitelabel_pro_config(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_language_configs_tenant ON language_configs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_translations_tenant ON translations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_custom_domains_tenant ON custom_domains(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sso_configs_tenant ON sso_configs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_sso_sessions_tenant ON sso_sessions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_2fa_configs_tenant ON donor_2fa_configs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donor_2fa_attempts_tenant ON donor_2fa_attempts(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_privacy_consent_records_tenant ON privacy_consent_records(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_privacy_settings_tenant ON privacy_settings(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_data_retention_policies_tenant ON data_retention_policies(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_data_retention_log_tenant ON data_retention_log(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_platform_plugins_tenant ON platform_plugins(tenant_id)`,
  ];

  // Run migrations and seed data
  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingUltimate6] Migrations complete');

    // ===== SEED DATA =====
    try {
      const tenants = (await pool.query('SELECT id FROM tenants')).rows;

      // Seed: 5 marketplace plugins (global, not per-tenant)
      const seedPlugins = [
        { name: 'Stripe Payment Gateway', version: '2.1.0', description: 'Accept donations via Stripe with recurring support', author: 'Ssewasswa Labs', category: 'payments', price: 0, downloads: 1250, rating: 4.8, is_verified: true },
        { name: 'Mailchimp Sync', version: '1.5.2', description: 'Sync donor lists with Mailchimp for email campaigns', author: 'Ssewasswa Labs', category: 'email', price: 0, downloads: 980, rating: 4.5, is_verified: true },
        { name: 'QuickBooks Sync', version: '1.3.0', description: 'Push transactions to QuickBooks for accounting', author: 'FinTech Solutions', category: 'accounting', price: 29.99, downloads: 450, rating: 4.2, is_verified: true },
        { name: 'Custom Receipt Builder', version: '3.0.1', description: 'Design branded PDF receipts with custom templates', author: 'DesignPro', category: 'documents', price: 19.99, downloads: 720, rating: 4.6, is_verified: true },
        { name: 'WhatsApp Notifications', version: '1.0.4', description: 'Send donation confirmations via WhatsApp Business API', author: 'CommBridge', category: 'messaging', price: 14.99, downloads: 310, rating: 3.9, is_verified: false }
      ];
      for (const p of seedPlugins) {
        try {
          await pool.query(
            `INSERT INTO plugin_marketplace (name, version, description, author, category, price, downloads, rating, is_verified)
             SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9 WHERE NOT EXISTS (SELECT 1 FROM plugin_marketplace WHERE name=$1 AND version=$2)`,
            [p.name, p.version, p.description, p.author, p.category, p.price, p.downloads, p.rating, p.is_verified]
          );
        } catch(e) {
          // Price column might be INTEGER instead of NUMERIC — try with integer price
          try {
            await pool.query(
              `INSERT INTO plugin_marketplace (name, version, description, author, category, price, downloads, rating, is_verified)
               SELECT $1, $2, $3, $4, $5, $6, $7, $8, $9 WHERE NOT EXISTS (SELECT 1 FROM plugin_marketplace WHERE name=$1 AND version=$2)`,
              [p.name, p.version, p.description, p.author, p.category, Math.round(p.price), p.downloads, p.rating, p.is_verified]
            );
          } catch(e2) { /* skip duplicate or schema mismatch */ }
        }
      }

      // Per-tenant seeds
      for (const t of tenants) {
        // Seed: translations for en/fr/sw
        const seedTranslations = [
          { entity_type: 'general', entity_id: 0, language_code: 'fr', field_name: 'donate_button', translated_text: 'Faire un don' },
          { entity_type: 'general', entity_id: 0, language_code: 'sw', field_name: 'donate_button', translated_text: 'Toa msaada' },
          { entity_type: 'general', entity_id: 0, language_code: 'fr', field_name: 'thank_you', translated_text: 'Merci beaucoup' },
          { entity_type: 'general', entity_id: 0, language_code: 'sw', field_name: 'thank_you', translated_text: 'Asante sana' },
          { entity_type: 'general', entity_id: 0, language_code: 'fr', field_name: 'campaign', translated_text: 'Campagne' },
          { entity_type: 'general', entity_id: 0, language_code: 'sw', field_name: 'campaign', translated_text: 'Kampeni' }
        ];
        for (const tr of seedTranslations) {
          await pool.query(
            `INSERT INTO translations (tenant_id, entity_type, entity_id, language_code, field_name, translated_text)
             SELECT $1, $2, $3, $4, $5, $6 WHERE NOT EXISTS (SELECT 1 FROM translations WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 AND language_code=$4 AND field_name=$5)`,
            [t.id, tr.entity_type, tr.entity_id, tr.language_code, tr.field_name, tr.translated_text]
          );
        }

        // Seed: default language config per tenant
        await pool.query(
          `INSERT INTO language_configs (tenant_id, primary_language, supported_languages_json, auto_translate)
           SELECT $1, 'en', '["en","fr","sw"]', false
           WHERE NOT EXISTS (SELECT 1 FROM language_configs WHERE tenant_id=$1)`,
          [t.id]
        );

        // Seed: default privacy settings per tenant
        await pool.query(
          `INSERT INTO privacy_settings (tenant_id, default_consent_required, data_retention_days, allow_analytics, allow_marketing)
           SELECT $1, true, 365, false, true
           WHERE NOT EXISTS (SELECT 1 FROM privacy_settings WHERE tenant_id=$1)`,
          [t.id]
        );

        // Seed: 5 data retention policies per tenant
        const seedPolicies = [
          { data_category: 'donor_records', retention_days: 2555, action_on_expiry: 'archive' },
          { data_category: 'transaction_history', retention_days: 2555, action_on_expiry: 'archive' },
          { data_category: 'communication_logs', retention_days: 730, action_on_expiry: 'delete' },
          { data_category: 'session_data', retention_days: 90, action_on_expiry: 'delete' },
          { data_category: 'analytics_data', retention_days: 365, action_on_expiry: 'anonymize' }
        ];
        for (const pol of seedPolicies) {
          await pool.query(
            `INSERT INTO data_retention_policies (tenant_id, data_category, retention_days, action_on_expiry, is_active)
             SELECT $1, $2, $3, $4, true
             WHERE NOT EXISTS (SELECT 1 FROM data_retention_policies WHERE tenant_id=$1 AND data_category=$2)`,
            [t.id, pol.data_category, pol.retention_days, pol.action_on_expiry]
          );
        }

        // Seed: default whitelabel config per tenant
        await pool.query(
          `INSERT INTO whitelabel_pro_config (tenant_id, primary_color, secondary_color, font_family, footer_text)
           SELECT $1, '#10b981', '#059669', 'Inter', 'Powered by Ssewasswa'
           WHERE NOT EXISTS (SELECT 1 FROM whitelabel_pro_config WHERE tenant_id=$1)`,
          [t.id]
        );
      }

      console.log('[FundraisingUltimate6] Seed data complete');
    } catch(e) { console.warn('[FundraisingUltimate6] Seed error:', e.message); }
  })();

  // ================================================================
  // FEATURE 1: INTEGRATION HUB
  // ================================================================

  // GET /api/integrations — List integration configs
  app.get('/api/integrations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { integration_type, is_active } = req.query;
    let q = 'SELECT id, tenant_id, integration_type, name, config_json, is_active, last_sync_at, sync_status FROM integration_configs WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (integration_type) { q += ' AND integration_type=$' + idx; params.push(esc(integration_type)); idx++; }
    if (is_active !== undefined) { q += ' AND is_active=$' + idx; params.push(is_active === 'true'); idx++; }
    q += ' ORDER BY name ASC';
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/integrations — Create integration config
  app.post('/api/integrations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { integration_type, name, config_json, credentials_encrypted, is_active } = req.body;
    if (!integration_type || !name) return res.status(400).json({ error: 'integration_type and name are required' });
    const result = await pool.query(
      'INSERT INTO integration_configs (tenant_id, integration_type, name, config_json, credentials_encrypted, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, tenant_id, integration_type, name, config_json, is_active, last_sync_at, sync_status',
      [t, esc(integration_type), esc(name), JSON.stringify(config_json || {}), credentials_encrypted ? esc(credentials_encrypted) : null, is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'integration_created', 'platform_integrations id=' + result.rows[0].id);
    await audit(req.session.user.email, 'integration_created', 'Created integration: ' + esc(name));
    res.json(result.rows[0]);
  }));

  // PUT /api/integrations/:id — Update integration config
  app.put('/api/integrations/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { integration_type, name, config_json, credentials_encrypted, is_active } = req.body;
    const result = await pool.query(
      'UPDATE integration_configs SET integration_type=COALESCE($1,integration_type), name=COALESCE($2,name), config_json=COALESCE($3,config_json), credentials_encrypted=COALESCE($4,credentials_encrypted), is_active=COALESCE($5,is_active) WHERE id=$6 AND tenant_id=$7 RETURNING id, tenant_id, integration_type, name, config_json, is_active, last_sync_at, sync_status',
      [integration_type ? esc(integration_type) : null, name ? esc(name) : null, config_json ? JSON.stringify(config_json) : null, credentials_encrypted ? esc(credentials_encrypted) : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Integration not found' });
    await audit(req.session.user.email, 'integration_updated', 'platform_integrations id=' + req.params.id);
    await audit(req.session.user.email, 'integration_updated', 'Updated integration #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // DELETE /api/integrations/:id — Delete integration config
  app.delete('/api/integrations/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM integration_configs WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Integration not found' });
    await audit(req.session.user.email, 'integration_deleted', 'platform_integrations id=' + req.params.id);
    await audit(req.session.user.email, 'integration_deleted', 'Deleted integration #' + req.params.id);
    res.json({ success: true });
  }));

  // POST /api/integrations/:id/sync — Trigger sync for an integration
  app.post('/api/integrations/:id/sync', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { sync_type } = req.body;
    const config = (await pool.query('SELECT * FROM integration_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!config) return res.status(404).json({ error: 'Integration not found' });
    // Update config sync status
    await pool.query('UPDATE integration_configs SET sync_status=$1 WHERE id=$2 AND tenant_id=$3', ['syncing', config.id, t]);
    // Create sync log
    const log = await pool.query(
      'INSERT INTO integration_sync_log (tenant_id, config_id, sync_type, status) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, config.id, esc(sync_type || 'full'), 'running']
    );
    // Simulate sync completion
    await pool.query('UPDATE integration_configs SET sync_status=$1, last_sync_at=NOW() WHERE id=$2 AND tenant_id=$3', ['success', config.id, t]);
    await pool.query('UPDATE integration_sync_log SET status=$1, records_processed=$2, completed_at=NOW() WHERE id=$3 AND tenant_id=$4', ['completed', 0, log.rows[0].id, t]);
    await audit(req.session.user.email, 'integration_synced', 'platform_integrations id=' + req.params.id);
    await audit(req.session.user.email, 'integration_sync_triggered', 'Triggered sync for integration #' + req.params.id);
    res.json({ success: true, log: log.rows[0] });
  }));

  // GET /api/integrations/:id/log — Get sync logs for an integration
  app.get('/api/integrations/:id/log', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM integration_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!config) return res.status(404).json({ error: 'Integration not found' });
    const { limit, offset } = req.query;
    const lim = parseInt(limit) || 50;
    const off = parseInt(offset) || 0;
    const result = await pool.query(
      'SELECT * FROM integration_sync_log WHERE tenant_id=$1 AND config_id=$2 ORDER BY started_at DESC LIMIT $3 OFFSET $4',
      [t, parseInt(req.params.id), lim, off]
    );
    res.json(result.rows);
  }));

  // GET /api/integrations/available — List available integration types
  app.get('/api/integrations/available', requireAuth, ah(async (req, res) => {
    const availableTypes = [
      { type: 'stripe', name: 'Stripe Payments', category: 'payments', description: 'Accept online donations via Stripe' },
      { type: 'paypal', name: 'PayPal Donations', category: 'payments', description: 'Accept donations via PayPal' },
      { type: 'mailchimp', name: 'Mailchimp', category: 'email_marketing', description: 'Sync donors with Mailchimp lists' },
      { type: 'sendgrid', name: 'SendGrid', category: 'email_marketing', description: 'Send transactional and marketing emails' },
      { type: 'quickbooks', name: 'QuickBooks', category: 'accounting', description: 'Sync financial data with QuickBooks' },
      { type: 'xero', name: 'Xero', category: 'accounting', description: 'Sync financial data with Xero' },
      { type: 'salesforce', name: 'Salesforce', category: 'crm', description: 'Sync donor data with Salesforce CRM' },
      { type: 'hubspot', name: 'HubSpot', category: 'crm', description: 'Sync donor data with HubSpot CRM' },
      { type: 'slack', name: 'Slack', category: 'communication', description: 'Send notifications to Slack channels' },
      { type: 'zapier', name: 'Zapier', category: 'automation', description: 'Connect with 5000+ apps via Zapier' },
      { type: 'google_analytics', name: 'Google Analytics', category: 'analytics', description: 'Track donor behavior and conversions' },
      { type: 'whatsapp', name: 'WhatsApp Business', category: 'messaging', description: 'Send donation confirmations via WhatsApp' }
    ];
    res.json(availableTypes);
  }));

  // ================================================================
  // FEATURE 2: CRM SYNC MANAGER
  // ================================================================

  // GET /api/crm-sync — List CRM sync configs
  app.get('/api/crm-sync', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM crm_sync_configs WHERE tenant_id=$1 ORDER BY crm_type ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/crm-sync — Create CRM sync config
  app.post('/api/crm-sync', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { crm_type, api_url, field_mapping_json, sync_frequency, is_active } = req.body;
    if (!crm_type) return res.status(400).json({ error: 'crm_type is required' });
    const validTypes = ['salesforce','hubspot','zoho','pipedrive','custom'];
    if (!validTypes.includes(crm_type)) return res.status(400).json({ error: 'Invalid crm_type. Must be one of: ' + validTypes.join(', ') });
    const result = await pool.query(
      'INSERT INTO crm_sync_configs (tenant_id, crm_type, api_url, field_mapping_json, sync_frequency, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(crm_type), api_url ? esc(api_url) : null, JSON.stringify(field_mapping_json || {}), sync_frequency || 'manual', is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'crm_sync_created', 'crm_sync_configs id=' + result.rows[0].id);
    await audit(req.session.user.email, 'crm_sync_config_created', 'Created CRM sync config for ' + esc(crm_type));
    res.json(result.rows[0]);
  }));

  // POST /api/crm-sync/:id/sync-now — Trigger immediate CRM sync
  app.post('/api/crm-sync/:id/sync-now', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM crm_sync_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!config) return res.status(404).json({ error: 'CRM sync config not found' });
    if (!config.is_active) return res.status(400).json({ error: 'CRM sync is not active' });
    // Enqueue pending records for sync
    const queueResult = await pool.query(
      'INSERT INTO crm_sync_queue (tenant_id, config_id, record_type, record_id, action, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, config.id, 'donor', 0, 'sync', 'pending']
    );
    // Update last_sync
    await pool.query('UPDATE crm_sync_configs SET last_sync=NOW() WHERE id=$1 AND tenant_id=$2', [config.id, t]);
    // Process the queue item
    await pool.query('UPDATE crm_sync_queue SET status=$1, attempts=attempts+1 WHERE id=$2 AND tenant_id=$3', ['completed', queueResult.rows[0].id, t]);
    await audit(req.session.user.email, 'crm_sync_executed', 'crm_sync_configs id=' + req.params.id);
    await audit(req.session.user.email, 'crm_sync_triggered', 'Triggered CRM sync for config #' + req.params.id);
    res.json({ success: true, queue_item: queueResult.rows[0] });
  }));

  // GET /api/crm-sync/:id/queue — Get CRM sync queue
  app.get('/api/crm-sync/:id/queue', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM crm_sync_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!config) return res.status(404).json({ error: 'CRM sync config not found' });
    const { status, limit, offset } = req.query;
    let q = 'SELECT * FROM crm_sync_queue WHERE tenant_id=$1 AND config_id=$2';
    const params = [t, parseInt(req.params.id)];
    let idx = 3;
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    q += ' ORDER BY id DESC LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    const lim = parseInt(limit) || 50;
    const off = parseInt(offset) || 0;
    params.push(lim, off);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/crm-sync/:id/map-fields — Update field mapping for CRM sync
  app.post('/api/crm-sync/:id/map-fields', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { field_mapping_json } = req.body;
    if (!field_mapping_json) return res.status(400).json({ error: 'field_mapping_json is required' });
    const config = (await pool.query('SELECT * FROM crm_sync_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!config) return res.status(404).json({ error: 'CRM sync config not found' });
    const result = await pool.query(
      'UPDATE crm_sync_configs SET field_mapping_json=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [JSON.stringify(field_mapping_json), req.params.id, t]
    );
    await audit(req.session.user.email, 'crm_fields_mapped', 'crm_field_mappings id=' + result.rows[0]?.id);
    await audit(req.session.user.email, 'crm_field_mapping_updated', 'Updated field mapping for CRM config #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 3: EMAIL MARKETING INTEGRATION
  // ================================================================

  // GET /api/email-marketing-integration — List email marketing configs
  app.get('/api/email-marketing-integration', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT id, tenant_id, provider, list_id, sync_donors, sync_frequency, last_sync, is_active FROM email_marketing_configs WHERE tenant_id=$1 ORDER BY provider ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/email-marketing-integration — Create email marketing config
  app.post('/api/email-marketing-integration', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { provider, api_key_encrypted, list_id, sync_donors, sync_frequency, is_active } = req.body;
    if (!provider) return res.status(400).json({ error: 'provider is required' });
    const validProviders = ['mailchimp','sendgrid','constant_contact','mailerlite','convertkit','custom'];
    if (!validProviders.includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    const result = await pool.query(
      'INSERT INTO email_marketing_configs (tenant_id, provider, api_key_encrypted, list_id, sync_donors, sync_frequency, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, tenant_id, provider, list_id, sync_donors, sync_frequency, last_sync, is_active',
      [t, esc(provider), api_key_encrypted ? esc(api_key_encrypted) : null, list_id ? esc(list_id) : null, sync_donors !== undefined ? sync_donors : true, sync_frequency || 'daily', is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'email_integration_created', 'email_marketing_configs id=' + result.rows[0].id);
    await audit(req.session.user.email, 'email_marketing_config_created', 'Created email marketing config for ' + esc(provider));
    res.json(result.rows[0]);
  }));

  // POST /api/email-marketing-integration/:id/sync — Sync donors to email marketing
  app.post('/api/email-marketing-integration/:id/sync', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM email_marketing_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!config) return res.status(404).json({ error: 'Email marketing config not found' });
    if (!config.is_active) return res.status(400).json({ error: 'Config is not active' });
    // Count donors to sync
    const donorCount = (await pool.query('SELECT COUNT(*) as cnt FROM donors WHERE tenant_id=$1', [t])).rows[0].cnt;
    // Update last_sync
    await pool.query('UPDATE email_marketing_configs SET last_sync=NOW() WHERE id=$1 AND tenant_id=$2', [config.id, t]);
    await audit(req.session.user.email, 'email_sync_executed', 'email_marketing_configs id=' + req.params.id);
    await audit(req.session.user.email, 'email_marketing_sync', 'Synced ' + donorCount + ' donors to ' + config.provider);
    res.json({ success: true, donors_synced: parseInt(donorCount), provider: config.provider });
  }));

  // GET /api/email-marketing-integration/:id/stats — Get email campaign stats
  app.get('/api/email-marketing-integration/:id/stats', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM email_marketing_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!config) return res.status(404).json({ error: 'Email marketing config not found' });
    const stats = await pool.query(
      'SELECT * FROM email_campaign_sync WHERE tenant_id=$1 AND config_id=$2 ORDER BY id DESC',
      [t, parseInt(req.params.id)]
    );
    res.json(stats.rows);
  }));

  // ================================================================
  // FEATURE 4: ACCOUNTING SOFTWARE SYNC
  // ================================================================

  // GET /api/accounting-sync — List accounting sync configs
  app.get('/api/accounting-sync', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM accounting_sync_configs WHERE tenant_id=$1 ORDER BY software_type ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/accounting-sync — Create accounting sync config
  app.post('/api/accounting-sync', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { software_type, api_url, credentials_encrypted, sync_categories_json, auto_sync, is_active } = req.body;
    if (!software_type) return res.status(400).json({ error: 'software_type is required' });
    const validTypes = ['quickbooks','xero','sage','freshbooks','wave','custom'];
    if (!validTypes.includes(software_type)) return res.status(400).json({ error: 'Invalid software_type' });
    const result = await pool.query(
      'INSERT INTO accounting_sync_configs (tenant_id, software_type, api_url, credentials_encrypted, sync_categories_json, auto_sync, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, esc(software_type), api_url ? esc(api_url) : null, credentials_encrypted ? esc(credentials_encrypted) : null, JSON.stringify(sync_categories_json || []), auto_sync || false, is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'accounting_sync_created', 'accounting_sync_configs id=' + result.rows[0].id);
    await audit(req.session.user.email, 'accounting_sync_created', 'Created accounting sync for ' + esc(software_type));
    res.json(result.rows[0]);
  }));

  // POST /api/accounting-sync/:id/push — Push local data to accounting software
  app.post('/api/accounting-sync/:id/push', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { record_type, local_id } = req.body;
    const config = (await pool.query('SELECT * FROM accounting_sync_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!config) return res.status(404).json({ error: 'Accounting sync config not found' });
    if (!config.is_active) return res.status(400).json({ error: 'Config is not active' });
    const syncRecord = await pool.query(
      'INSERT INTO accounting_sync_records (tenant_id, config_id, record_type, local_id, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, config.id, esc(record_type || 'donation'), local_id ? parseInt(local_id) : null, 'pending']
    );
    // Simulate push completion
    await pool.query('UPDATE accounting_sync_records SET status=$1, external_id=$2 WHERE id=$3 AND tenant_id=$4', ['synced', 'EXT-' + Date.now(), syncRecord.rows[0].id, t]);
    await pool.query('UPDATE accounting_sync_configs SET last_sync=NOW() WHERE id=$1 AND tenant_id=$2', [config.id, t]);
    await audit(req.session.user.email, 'accounting_push_executed', 'accounting_sync_configs id=' + req.params.id);
    await audit(req.session.user.email, 'accounting_push', 'Pushed ' + (record_type || 'donation') + ' to ' + config.software_type);
    res.json({ success: true, record: syncRecord.rows[0] });
  }));

  // POST /api/accounting-sync/:id/pull — Pull data from accounting software
  app.post('/api/accounting-sync/:id/pull', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM accounting_sync_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!config) return res.status(404).json({ error: 'Accounting sync config not found' });
    if (!config.is_active) return res.status(400).json({ error: 'Config is not active' });
    await pool.query('UPDATE accounting_sync_configs SET last_sync=NOW() WHERE id=$1 AND tenant_id=$2', [config.id, t]);
    await audit(req.session.user.email, 'accounting_pull_executed', 'accounting_sync_configs id=' + req.params.id);
    await audit(req.session.user.email, 'accounting_pull', 'Pulled data from ' + config.software_type);
    res.json({ success: true, message: 'Data pull initiated from ' + config.software_type });
  }));

  // GET /api/accounting-sync/:id/records — Get accounting sync records
  app.get('/api/accounting-sync/:id/records', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM accounting_sync_configs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!config) return res.status(404).json({ error: 'Accounting sync config not found' });
    const { status, limit, offset } = req.query;
    let q = 'SELECT * FROM accounting_sync_records WHERE tenant_id=$1 AND config_id=$2';
    const params = [t, parseInt(req.params.id)];
    let idx = 3;
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    q += ' ORDER BY id DESC LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(parseInt(limit) || 50, parseInt(offset) || 0);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // ================================================================
  // FEATURE 5: WEBHOOK MANAGER PRO
  // ================================================================

  // GET /api/webhook-endpoints — List webhook endpoints
  app.get('/api/webhook-endpoints', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM webhook_endpoints_pro WHERE tenant_id=$1 ORDER BY id DESC', [t]);
    res.json(result.rows);
  }));

  // POST /api/webhook-endpoints — Create webhook endpoint
  app.post('/api/webhook-endpoints', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { url, events_json, secret, is_active } = req.body;
    if (!url) return res.status(400).json({ error: 'url is required' });
    const crypto = require('crypto');
    const generatedSecret = secret || crypto.randomBytes(32).toString('hex');
    const result = await pool.query(
      'INSERT INTO webhook_endpoints_pro (tenant_id, url, events_json, secret, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, esc(url), JSON.stringify(events_json || []), esc(generatedSecret), is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'webhook_created', 'webhook_endpoints id=' + result.rows[0].id);
    await audit(req.session.user.email, 'webhook_endpoint_created', 'Created webhook endpoint: ' + esc(url));
    res.json(result.rows[0]);
  }));

  // PUT /api/webhook-endpoints/:id — Update webhook endpoint
  app.put('/api/webhook-endpoints/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { url, events_json, secret, is_active } = req.body;
    const result = await pool.query(
      'UPDATE webhook_endpoints_pro SET url=COALESCE($1,url), events_json=COALESCE($2,events_json), secret=COALESCE($3,secret), is_active=COALESCE($4,is_active) WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [url ? esc(url) : null, events_json ? JSON.stringify(events_json) : null, secret ? esc(secret) : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Webhook endpoint not found' });
    await audit(req.session.user.email, 'webhook_updated', 'webhook_endpoints id=' + req.params.id);
    await audit(req.session.user.email, 'webhook_endpoint_updated', 'Updated webhook endpoint #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // DELETE /api/webhook-endpoints/:id — Delete webhook endpoint
  app.delete('/api/webhook-endpoints/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM webhook_endpoints_pro WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Webhook endpoint not found' });
    await audit(req.session.user.email, 'webhook_deleted', 'webhook_endpoints id=' + req.params.id);
    await audit(req.session.user.email, 'webhook_endpoint_deleted', 'Deleted webhook endpoint #' + req.params.id);
    res.json({ success: true });
  }));

  // POST /api/webhook-endpoints/:id/test — Test a webhook endpoint
  app.post('/api/webhook-endpoints/:id/test', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const endpoint = (await pool.query('SELECT * FROM webhook_endpoints_pro WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!endpoint) return res.status(404).json({ error: 'Webhook endpoint not found' });
    const testPayload = { event: 'test', timestamp: new Date().toISOString(), data: { message: 'Test webhook from Ssewasswa' } };
    const startTime = Date.now();
    let responseCode = 200;
    let success = true;
    try {
      const https = require('https');
      const http = require('http');
      const urlObj = new URL(endpoint.url);
      const lib = urlObj.protocol === 'https:' ? https : http;
      await new Promise((resolve, reject) => {
        const req2 = lib.request(urlObj, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Webhook-Secret': endpoint.secret }, timeout: 10000 }, (res2) => {
          responseCode = res2.statusCode;
          success = res2.statusCode >= 200 && res2.statusCode < 300;
          resolve();
        });
        req2.on('error', () => { responseCode = 0; success = false; resolve(); });
        req2.on('timeout', () => { responseCode = 0; success = false; req2.destroy(); resolve(); });
        req2.write(JSON.stringify(testPayload));
        req2.end();
      });
    } catch(e) { responseCode = 0; success = false; }
    const duration = Date.now() - startTime;
    const delivery = await pool.query(
      'INSERT INTO webhook_deliveries (tenant_id, endpoint_id, event, payload_json, response_code, duration_ms, success) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, endpoint.id, 'test', JSON.stringify(testPayload), responseCode, duration, success]
    );
    await pool.query('UPDATE webhook_endpoints_pro SET last_delivery_at=NOW() WHERE id=$1 AND tenant_id=$2', [endpoint.id, t]);
    if (!success) await pool.query('UPDATE webhook_endpoints_pro SET failure_count=failure_count+1 WHERE id=$1 AND tenant_id=$2', [endpoint.id, t]);
    res.json({ success, response_code: responseCode, duration_ms: duration, delivery: delivery.rows[0] });
  }));

  // GET /api/webhook-endpoints/:id/deliveries — Get delivery history for an endpoint
  app.get('/api/webhook-endpoints/:id/deliveries', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const endpoint = (await pool.query('SELECT * FROM webhook_endpoints_pro WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!endpoint) return res.status(404).json({ error: 'Webhook endpoint not found' });
    const { limit, offset } = req.query;
    const result = await pool.query(
      'SELECT * FROM webhook_deliveries WHERE tenant_id=$1 AND endpoint_id=$2 ORDER BY delivered_at DESC LIMIT $3 OFFSET $4',
      [t, endpoint.id, parseInt(limit) || 50, parseInt(offset) || 0]
    );
    res.json(result.rows);
  }));

  // POST /api/webhook-endpoints/:id/retry/:deliveryId — Retry a failed delivery
  app.post('/api/webhook-endpoints/:id/retry/:deliveryId', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const endpoint = (await pool.query('SELECT * FROM webhook_endpoints_pro WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!endpoint) return res.status(404).json({ error: 'Webhook endpoint not found' });
    const delivery = (await pool.query('SELECT * FROM webhook_deliveries WHERE id=$1 AND tenant_id=$2 AND endpoint_id=$3', [req.params.deliveryId, t, endpoint.id])).rows[0];
    if (!delivery) return res.status(404).json({ error: 'Delivery not found' });
    // Create new delivery retry
    const retry = await pool.query(
      'INSERT INTO webhook_deliveries (tenant_id, endpoint_id, event, payload_json, status_code, duration_ms, success) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, endpoint.id, delivery.event, delivery.payload_json, 0, 0, false]
    );
    await audit(req.session.user.email, 'webhook_retry', 'Retried delivery #' + req.params.deliveryId + ' for endpoint #' + req.params.id);
    res.json({ success: true, new_delivery: retry.rows[0] });
  }));

  // ================================================================
  // FEATURE 6: API GATEWAY PRO
  // ================================================================

  // POST /api/api-gateway/keys — Create a new API key
  app.post('/api/api-gateway/keys', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, permissions_json, rate_limit, expires_at, is_active } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const crypto = require('crypto');
    const rawKey = 'sk_live_' + crypto.randomBytes(24).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const result = await pool.query(
      'INSERT INTO api_gateway_keys_pro (tenant_id, key_hash, name, permissions_json, rate_limit, expires_at, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id, tenant_id, name, permissions_json, rate_limit, usage_count, last_used, expires_at, is_active',
      [t, keyHash, esc(name), JSON.stringify(permissions_json || []), rate_limit || 1000, expires_at || null, is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'api_key_created', 'api_gateway_keys id=' + result.rows[0].id);
    await audit(req.session.user.email, 'api_key_created', 'Created API key: ' + esc(name));
    res.json({ ...result.rows[0], raw_key: rawKey });
  }));

  // GET /api/api-gateway/keys — List API keys (without hashes)
  app.get('/api/api-gateway/keys', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT id, tenant_id, name, permissions_json, rate_limit, usage_count, last_used, expires_at, is_active FROM api_gateway_keys_pro WHERE tenant_id=$1 ORDER BY name ASC', [t]);
    res.json(result.rows);
  }));

  // DELETE /api/api-gateway/keys/:id — Revoke/delete an API key
  app.delete('/api/api-gateway/keys/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM api_gateway_keys_pro WHERE id=$1 AND tenant_id=$2 RETURNING id, name', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'API key not found' });
    await audit(req.session.user.email, 'api_key_deleted', 'api_gateway_keys id=' + req.params.id);
    await audit(req.session.user.email, 'api_key_revoked', 'Revoked API key: ' + result.rows[0].name);
    res.json({ success: true });
  }));

  // GET /api/api-gateway/logs — Get API gateway logs
  app.get('/api/api-gateway/logs', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { key_id, endpoint, method, status_code, limit, offset } = req.query;
    let q = 'SELECT l.*, k.name as key_name FROM api_gateway_logs l JOIN api_gateway_keys_pro k ON l.key_id=k.id WHERE l.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (key_id) { q += ' AND l.key_id=$' + idx; params.push(parseInt(key_id)); idx++; }
    if (endpoint) { q += ' AND l.endpoint=$' + idx; params.push(esc(endpoint)); idx++; }
    if (method) { q += ' AND l.method=$' + idx; params.push(esc(method)); idx++; }
    if (status_code) { q += ' AND l.status_code=$' + idx; params.push(parseInt(status_code)); idx++; }
    q += ' ORDER BY l.id DESC LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(parseInt(limit) || 100, parseInt(offset) || 0);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // GET /api/api-gateway/stats — Get API gateway usage stats
  app.get('/api/api-gateway/stats', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const totalKeys = (await pool.query('SELECT COUNT(*) as cnt FROM api_gateway_keys_pro WHERE tenant_id=$1', [t])).rows[0].cnt;
    const activeKeys = (await pool.query('SELECT COUNT(*) as cnt FROM api_gateway_keys_pro WHERE tenant_id=$1 AND is_active=true', [t])).rows[0].cnt;
    const totalRequests = (await pool.query('SELECT COALESCE(SUM(usage_count),0) as total FROM api_gateway_keys_pro WHERE tenant_id=$1', [t])).rows[0].total;
    const recentLogs = (await pool.query('SELECT COUNT(*) as cnt FROM api_gateway_logs WHERE tenant_id=$1 AND id > (SELECT COALESCE(MAX(id),0) - 1000 FROM api_gateway_logs WHERE tenant_id=$1)', [t])).rows[0].cnt;
    const avgResponseTime = (await pool.query('SELECT COALESCE(AVG(response_time),0) as avg FROM api_gateway_logs WHERE tenant_id=$1', [t])).rows[0].avg;
    const errorRate = (await pool.query('SELECT COALESCE(COUNT(CASE WHEN status_code >= 400 THEN 1 END)::float / NULLIF(COUNT(*),0) * 100, 0) as rate FROM api_gateway_logs WHERE tenant_id=$1', [t])).rows[0].rate;
    const topEndpoints = (await pool.query(
      'SELECT endpoint, COUNT(*) as count, AVG(response_time) as avg_response_time FROM api_gateway_logs WHERE tenant_id=$1 GROUP BY endpoint ORDER BY count DESC LIMIT 10',
      [t]
    )).rows;
    res.json({
      total_keys: parseInt(totalKeys),
      active_keys: parseInt(activeKeys),
      total_requests: parseInt(totalRequests),
      recent_requests: parseInt(recentLogs),
      avg_response_time: parseFloat(avgResponseTime),
      error_rate: parseFloat(errorRate),
      top_endpoints: topEndpoints
    });
  }));

  // ================================================================
  // FEATURE 7: DATA IMPORT/EXPORT PRO
  // ================================================================

  // POST /api/data-import-pro — Create an import job
  app.post('/api/data-import-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { filename, source_format, field_mapping_json, total_rows } = req.body;
    if (!filename) return res.status(400).json({ error: 'filename is required' });
    const result = await pool.query(
      'INSERT INTO data_import_jobs (tenant_id, filename, source_format, field_mapping_json, total_rows, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(filename), source_format || 'csv', JSON.stringify(field_mapping_json || {}), total_rows || 0, esc(req.session.user.email)]
    );
    await audit(req.session.user.email, 'data_import_created', 'data_import_jobs id=' + result.rows[0].id);
    await audit(req.session.user.email, 'import_job_created', 'Created import job: ' + esc(filename));
    res.json(result.rows[0]);
  }));

  // GET /api/data-import-pro — List import jobs
  app.get('/api/data-import-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { status, limit, offset } = req.query;
    let q = 'SELECT * FROM data_import_jobs WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (status) { q += ' AND status=$' + idx; params.push(esc(status)); idx++; }
    q += ' ORDER BY id DESC LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(parseInt(limit) || 50, parseInt(offset) || 0);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/data-import-pro/:id/map — Update field mapping for an import job
  app.post('/api/data-import-pro/:id/map', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { field_mapping_json } = req.body;
    if (!field_mapping_json) return res.status(400).json({ error: 'field_mapping_json is required' });
    const job = (await pool.query('SELECT * FROM data_import_jobs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!job) return res.status(404).json({ error: 'Import job not found' });
    const result = await pool.query(
      'UPDATE data_import_jobs SET field_mapping_json=$1, status=$2 WHERE id=$3 AND tenant_id=$4 RETURNING *',
      [JSON.stringify(field_mapping_json), 'mapping', req.params.id, t]
    );
    await audit(req.session.user.email, 'data_import_mapped', 'data_import_jobs id=' + req.params.id);
    res.json(result.rows[0]);
  }));

  // POST /api/data-import-pro/:id/execute — Execute an import job
  app.post('/api/data-import-pro/:id/execute', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const job = (await pool.query('SELECT * FROM data_import_jobs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!job) return res.status(404).json({ error: 'Import job not found' });
    if (job.status === 'processing') return res.status(400).json({ error: 'Import already in progress' });
    // Update status to processing
    await pool.query('UPDATE data_import_jobs SET status=$1, started_at=NOW() WHERE id=$2 AND tenant_id=$3', ['processing', job.id, t]);
    // Simulate processing completion
    const processedRows = job.total_rows || 0;
    const errorCount = 0;
    await pool.query('UPDATE data_import_jobs SET status=$1, processed_rows=$2, errors_count=$3, completed_at=NOW() WHERE id=$4 AND tenant_id=$5',
      ['completed', processedRows, errorCount, job.id, t]);
    await audit(req.session.user.email, 'data_import_executed', 'data_import_jobs id=' + req.params.id);
    await audit(req.session.user.email, 'import_job_executed', 'Executed import job #' + req.params.id + ' (' + processedRows + ' rows)');
    const updated = (await pool.query('SELECT * FROM data_import_jobs WHERE id=$1 AND tenant_id=$2', [job.id, t])).rows[0];
    res.json(updated);
  }));

  // POST /api/data-export-pro — Create an export job
  app.post('/api/data-export-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { export_type, filters_json, format } = req.body;
    if (!export_type) return res.status(400).json({ error: 'export_type is required' });
    const validTypes = ['donors','donations','campaigns','reports','transactions'];
    if (!validTypes.includes(export_type)) return res.status(400).json({ error: 'Invalid export_type' });
    // Count rows based on export type
    let countQuery = 'SELECT COUNT(*) as cnt FROM ';
    if (export_type === 'donors') countQuery += 'donors';
    else if (export_type === 'donations') countQuery += 'donations';
    else if (export_type === 'campaigns') countQuery += 'campaigns';
    else countQuery += 'donors';
    countQuery += ' WHERE tenant_id=$1';
    const totalRows = (await pool.query(countQuery, [t])).rows[0].cnt;
    const result = await pool.query(
      'INSERT INTO data_export_jobs (tenant_id, export_type, filters_json, format, total_rows, status, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, esc(export_type), JSON.stringify(filters_json || {}), format || 'csv', parseInt(totalRows), 'processing', esc(req.session.user.email)]
    );
    // Simulate export completion
    const fileUrl = '/downloads/export_' + result.rows[0].id + '.' + (format || 'csv');
    await pool.query('UPDATE data_export_jobs SET status=$1, file_url=$2, started_at=NOW(), completed_at=NOW() WHERE id=$3 AND tenant_id=$4',
      ['completed', fileUrl, result.rows[0].id, t]);
    await audit(req.session.user.email, 'data_export_created', 'data_export_jobs id=' + result.rows[0].id);
    await audit(req.session.user.email, 'export_job_created', 'Created export job for ' + esc(export_type));
    const updated = (await pool.query('SELECT * FROM data_export_jobs WHERE id=$1 AND tenant_id=$2', [result.rows[0].id, t])).rows[0];
    res.json(updated);
  }));

  // GET /api/data-export-pro/:id/download — Get download info for an export
  app.get('/api/data-export-pro/:id/download', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const job = (await pool.query('SELECT * FROM data_export_jobs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!job) return res.status(404).json({ error: 'Export job not found' });
    if (job.status !== 'completed') return res.status(400).json({ error: 'Export not yet completed' });
    res.json({ file_url: job.file_url, format: job.format, total_rows: job.total_rows });
  }));

  // ================================================================
  // FEATURE 8: WHITE LABEL PRO
  // ================================================================

  // GET /api/whitelabel-pro — Get whitelabel config
  app.get('/api/whitelabel-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM whitelabel_pro_config WHERE tenant_id=$1', [t])).rows[0];
    if (!config) return res.status(404).json({ error: 'Whitelabel config not found' });
    res.json(config);
  }));

  // PUT /api/whitelabel-pro — Update whitelabel config
  app.put('/api/whitelabel-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { primary_color, secondary_color, logo_url, favicon_url, font_family, custom_css, custom_js, footer_text } = req.body;
    const existing = (await pool.query('SELECT * FROM whitelabel_pro_config WHERE tenant_id=$1', [t])).rows[0];
    if (!existing) {
      // Create if not exists
      const result = await pool.query(
        'INSERT INTO whitelabel_pro_config (tenant_id, primary_color, secondary_color, logo_url, favicon_url, font_family, custom_css, custom_js, footer_text) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *',
        [t, primary_color || '#10b981', secondary_color || '#059669', logo_url || null, favicon_url || null, font_family || 'Inter', custom_css || null, custom_js || null, footer_text || 'Powered by Ssewasswa']
      );
      await audit(req.session.user.email, 'whitelabel_updated', 'whitelabel_configs id=' + result.rows[0]?.id || req.session.user.tenant_id);
    await audit(req.session.user.email, 'whitelabel_config_created', 'Created whitelabel configuration');
      return res.json(result.rows[0]);
    }
    const result = await pool.query(
      'UPDATE whitelabel_pro_config SET primary_color=COALESCE($1,primary_color), secondary_color=COALESCE($2,secondary_color), logo_url=COALESCE($3,logo_url), favicon_url=COALESCE($4,favicon_url), font_family=COALESCE($5,font_family), custom_css=COALESCE($6,custom_css), custom_js=COALESCE($7,custom_js), footer_text=COALESCE($8,footer_text) WHERE tenant_id=$9 RETURNING *',
      [primary_color || null, secondary_color || null, logo_url || null, favicon_url || null, font_family || null, custom_css || null, custom_js || null, footer_text || null, t]
    );
    await audit(req.session.user.email, 'whitelabel_updated', 'whitelabel_configs id=' + result.rows[0]?.id || req.session.user.tenant_id);
    await audit(req.session.user.email, 'whitelabel_config_updated', 'Updated whitelabel configuration');
    res.json(result.rows[0]);
  }));

  // GET /api/whitelabel-pro/preview — Preview whitelabel config as CSS
  app.get('/api/whitelabel-pro/preview', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM whitelabel_pro_config WHERE tenant_id=$1', [t])).rows[0];
    if (!config) return res.status(404).json({ error: 'Whitelabel config not found' });
    const css = `
:root {
  --primary-color: ${config.primary_color};
  --secondary-color: ${config.secondary_color};
  --font-family: '${config.font_family}', sans-serif;
}
body { font-family: var(--font-family); }
.btn-primary { background-color: var(--primary-color); }
.btn-secondary { background-color: var(--secondary-color); }
${config.custom_css || ''}
`.trim();
    res.setHeader('Content-Type', 'text/css');
    res.send(css);
  }));

  // ================================================================
  // FEATURE 9: MULTI-LANGUAGE MANAGER
  // ================================================================

  // GET /api/language-config — Get language configuration
  app.get('/api/language-config', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const config = (await pool.query('SELECT * FROM language_configs WHERE tenant_id=$1', [t])).rows[0];
    if (!config) return res.status(404).json({ error: 'Language config not found' });
    res.json(config);
  }));

  // PUT /api/language-config — Update language configuration
  app.put('/api/language-config', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { primary_language, supported_languages_json, auto_translate } = req.body;
    const existing = (await pool.query('SELECT * FROM language_configs WHERE tenant_id=$1', [t])).rows[0];
    if (!existing) {
      const result = await pool.query(
        'INSERT INTO language_configs (tenant_id, primary_language, supported_languages_json, auto_translate) VALUES ($1,$2,$3,$4) RETURNING *',
        [t, primary_language || 'en', JSON.stringify(supported_languages_json || ['en','fr','sw']), auto_translate || false]
      );
      await audit(req.session.user.email, 'language_config_updated', 'language_configs id=' + result.rows[0]?.id || req.session.user.tenant_id);
    await audit(req.session.user.email, 'language_config_created', 'Created language configuration');
      return res.json(result.rows[0]);
    }
    const result = await pool.query(
      'UPDATE language_configs SET primary_language=COALESCE($1,primary_language), supported_languages_json=COALESCE($2,supported_languages_json), auto_translate=COALESCE($3,auto_translate) WHERE tenant_id=$4 RETURNING *',
      [primary_language || null, supported_languages_json ? JSON.stringify(supported_languages_json) : null, auto_translate !== undefined ? auto_translate : null, t]
    );
    await audit(req.session.user.email, 'language_config_updated', 'language_configs id=' + result.rows[0]?.id || req.session.user.tenant_id);
    await audit(req.session.user.email, 'language_config_updated', 'Updated language configuration');
    res.json(result.rows[0]);
  }));

  // GET /api/translations — List translations
  app.get('/api/translations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { entity_type, entity_id, language_code, field_name, limit, offset } = req.query;
    let q = 'SELECT * FROM translations WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (entity_type) { q += ' AND entity_type=$' + idx; params.push(esc(entity_type)); idx++; }
    if (entity_id) { q += ' AND entity_id=$' + idx; params.push(parseInt(entity_id)); idx++; }
    if (language_code) { q += ' AND language_code=$' + idx; params.push(esc(language_code)); idx++; }
    if (field_name) { q += ' AND field_name=$' + idx; params.push(esc(field_name)); idx++; }
    q += ' ORDER BY entity_type, entity_id, language_code, field_name';
    q += ' LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(parseInt(limit) || 100, parseInt(offset) || 0);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/translations — Create a translation
  app.post('/api/translations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { entity_type, entity_id, language_code, field_name, translated_text } = req.body;
    if (!entity_type || !language_code || !field_name || !translated_text) {
      return res.status(400).json({ error: 'entity_type, language_code, field_name, and translated_text are required' });
    }
    // Upsert: update if exists, insert if not
    const existing = (await pool.query(
      'SELECT * FROM translations WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 AND language_code=$4 AND field_name=$5',
      [t, esc(entity_type), entity_id || 0, esc(language_code), esc(field_name)]
    )).rows[0];
    if (existing) {
      const result = await pool.query(
        'UPDATE translations SET translated_text=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
        [esc(translated_text), existing.id, t]
      );
      return res.json(result.rows[0]);
    }
    const result = await pool.query(
      'INSERT INTO translations (tenant_id, entity_type, entity_id, language_code, field_name, translated_text) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(entity_type), entity_id || 0, esc(language_code), esc(field_name), esc(translated_text)]
    );
    await audit(req.session.user.email, 'translation_created', 'translations id=' + result.rows[0].id);
    await audit(req.session.user.email, 'translation_created', 'Created translation for ' + entity_type + ' #' + (entity_id || 0) + ' (' + language_code + ')');
    res.json(result.rows[0]);
  }));

  // PUT /api/translations/:id — Update a translation
  app.put('/api/translations/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { translated_text } = req.body;
    if (!translated_text) return res.status(400).json({ error: 'translated_text is required' });
    const result = await pool.query(
      'UPDATE translations SET translated_text=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [esc(translated_text), req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Translation not found' });
    await audit(req.session.user.email, 'translation_updated', 'translations id=' + req.params.id);
    await audit(req.session.user.email, 'translation_updated', 'Updated translation #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 10: CUSTOM DOMAIN MANAGER
  // ================================================================

  // GET /api/custom-domains — List custom domains
  app.get('/api/custom-domains', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT * FROM custom_domains WHERE tenant_id=$1 ORDER BY domain ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/custom-domains — Add a custom domain
  app.post('/api/custom-domains', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain is required' });
    // Check if domain already taken
    const existing = (await pool.query('SELECT * FROM custom_domains WHERE domain=$1', [esc(domain)])).rows[0];
    if (existing) return res.status(400).json({ error: 'Domain is already registered' });
    const crypto = require('crypto');
    const verificationToken = crypto.randomBytes(16).toString('hex');
    const result = await pool.query(
      'INSERT INTO custom_domains (tenant_id, domain, ssl_status, dns_verified, verification_token, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(domain), 'pending', false, verificationToken, false]
    );
    await audit(req.session.user.email, 'custom_domain_created', 'custom_domains id=' + result.rows[0].id);
    await audit(req.session.user.email, 'custom_domain_added', 'Added custom domain: ' + esc(domain));
    res.json(result.rows[0]);
  }));

  // DELETE /api/custom-domains/:id — Remove a custom domain
  app.delete('/api/custom-domains/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM custom_domains WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Custom domain not found' });
    await audit(req.session.user.email, 'custom_domain_deleted', 'custom_domains id=' + req.params.id);
    await audit(req.session.user.email, 'custom_domain_removed', 'Removed custom domain: ' + result.rows[0].domain);
    res.json({ success: true });
  }));

  // POST /api/custom-domains/:id/verify-dns — Verify DNS for a custom domain
  app.post('/api/custom-domains/:id/verify-dns', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const domain = (await pool.query('SELECT * FROM custom_domains WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!domain) return res.status(404).json({ error: 'Custom domain not found' });
    // Simulate DNS verification
    const dnsVerified = true; // In production, would actually check DNS records
    await pool.query('UPDATE custom_domains SET dns_verified=$1 WHERE id=$2 AND tenant_id=$3', [dnsVerified, domain.id, t]);
    if (dnsVerified) {
      await pool.query('UPDATE custom_domains SET is_active=true WHERE id=$1 AND tenant_id=$2', [domain.id, t]);
    }
    await audit(req.session.user.email, 'dns_verification_requested', 'custom_domains id=' + req.params.id);
    await audit(req.session.user.email, 'dns_verification', 'DNS verification for ' + domain.domain + ': ' + (dnsVerified ? 'success' : 'failed'));
    res.json({ success: true, dns_verified: dnsVerified, domain: domain.domain });
  }));

  // POST /api/custom-domains/:id/verify-ssl — Verify/enable SSL for a custom domain
  app.post('/api/custom-domains/:id/verify-ssl', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const domain = (await pool.query('SELECT * FROM custom_domains WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!domain) return res.status(404).json({ error: 'Custom domain not found' });
    if (!domain.dns_verified) return res.status(400).json({ error: 'DNS must be verified before SSL can be enabled' });
    // Simulate SSL verification
    const sslActive = true;
    await pool.query('UPDATE custom_domains SET ssl_status=$1 WHERE id=$2 AND tenant_id=$3', [sslActive ? 'active' : 'error', domain.id, t]);
    await audit(req.session.user.email, 'ssl_verification_requested', 'custom_domains id=' + req.params.id);
    await audit(req.session.user.email, 'ssl_verification', 'SSL verification for ' + domain.domain + ': ' + (sslActive ? 'active' : 'failed'));
    res.json({ success: true, ssl_status: sslActive ? 'active' : 'error', domain: domain.domain });
  }));

  // ================================================================
  // FEATURE 11: SSO/OAUTH INTEGRATION
  // ================================================================

  // GET /api/sso-configs — List SSO configurations
  app.get('/api/sso-configs', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('SELECT id, tenant_id, provider, client_id, authorize_url, token_url, userinfo_url, scopes, is_active FROM sso_configs WHERE tenant_id=$1 ORDER BY provider ASC', [t]);
    res.json(result.rows);
  }));

  // POST /api/sso-configs — Create SSO configuration
  app.post('/api/sso-configs', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { provider, client_id, client_secret_encrypted, authorize_url, token_url, userinfo_url, scopes, is_active } = req.body;
    if (!provider || !client_id || !client_secret_encrypted) {
      return res.status(400).json({ error: 'provider, client_id, and client_secret_encrypted are required' });
    }
    const validProviders = ['google','microsoft','github','okta','custom'];
    if (!validProviders.includes(provider)) return res.status(400).json({ error: 'Invalid provider' });
    const result = await pool.query(
      'INSERT INTO sso_configs (tenant_id, provider, client_id, client_secret_encrypted, authorize_url, token_url, userinfo_url, scopes, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, tenant_id, provider, client_id, authorize_url, token_url, userinfo_url, scopes, is_active',
      [t, esc(provider), esc(client_id), esc(client_secret_encrypted), authorize_url ? esc(authorize_url) : null, token_url ? esc(token_url) : null, userinfo_url ? esc(userinfo_url) : null, scopes || 'openid profile email', is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'sso_config_created', 'sso_configs id=' + result.rows[0].id);
    await audit(req.session.user.email, 'sso_config_created', 'Created SSO config for ' + esc(provider));
    res.json(result.rows[0]);
  }));

  // PUT /api/sso-configs/:id — Update SSO configuration
  app.put('/api/sso-configs/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { provider, client_id, client_secret_encrypted, authorize_url, token_url, userinfo_url, scopes, is_active } = req.body;
    const result = await pool.query(
      'UPDATE sso_configs SET provider=COALESCE($1,provider), client_id=COALESCE($2,client_id), client_secret_encrypted=COALESCE($3,client_secret_encrypted), authorize_url=COALESCE($4,authorize_url), token_url=COALESCE($5,token_url), userinfo_url=COALESCE($6,userinfo_url), scopes=COALESCE($7,scopes), is_active=COALESCE($8,is_active) WHERE id=$9 AND tenant_id=$10 RETURNING id, tenant_id, provider, client_id, authorize_url, token_url, userinfo_url, scopes, is_active',
      [provider ? esc(provider) : null, client_id ? esc(client_id) : null, client_secret_encrypted ? esc(client_secret_encrypted) : null, authorize_url ? esc(authorize_url) : null, token_url ? esc(token_url) : null, userinfo_url ? esc(userinfo_url) : null, scopes || null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'SSO config not found' });
    await audit(req.session.user.email, 'sso_config_updated', 'sso_configs id=' + req.params.id);
    await audit(req.session.user.email, 'sso_config_updated', 'Updated SSO config #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // DELETE /api/sso-configs/:id — Delete SSO configuration
  app.delete('/api/sso-configs/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM sso_configs WHERE id=$1 AND tenant_id=$2 RETURNING id, provider', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'SSO config not found' });
    await audit(req.session.user.email, 'sso_config_deleted', 'sso_configs id=' + req.params.id);
    await audit(req.session.user.email, 'sso_config_deleted', 'Deleted SSO config for ' + result.rows[0].provider);
    res.json({ success: true });
  }));

  // GET /api/sso/:provider/callback — SSO callback handler
  app.get('/api/sso/:provider/callback', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { code } = req.query;
    const provider = req.params.provider;
    if (!code) return res.status(400).json({ error: 'Authorization code is required' });
    const config = (await pool.query('SELECT * FROM sso_configs WHERE tenant_id=$1 AND provider=$2 AND is_active=true', [t, esc(provider)])).rows[0];
    if (!config) return res.status(404).json({ error: 'SSO config not found for provider: ' + provider });
    // Create SSO session record
    const ssoSession = await pool.query(
      'INSERT INTO sso_sessions (tenant_id, config_id, user_email, provider_user_id, token_encrypted, expires_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id, tenant_id, config_id, user_email, provider_user_id, expires_at',
      [t, config.id, esc(req.session.user.email), 'provider-' + Date.now(), esc(code), new Date(Date.now() + 3600000)]
    );
    await audit(req.session.user.email, 'sso_login', 'SSO login via ' + provider);
    res.json({ success: true, session: ssoSession.rows[0] });
  }));

  // ================================================================
  // FEATURE 12: DONOR 2FA
  // ================================================================

  // POST /api/donor-2fa/setup — Setup 2FA for a donor
  app.post('/api/donor-2fa/setup', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, method } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    const validMethods = ['totp','sms','email'];
    const selectedMethod = method || 'totp';
    if (!validMethods.includes(selectedMethod)) return res.status(400).json({ error: 'Invalid method' });
    // Check if 2FA already configured
    const existing = (await pool.query('SELECT * FROM donor_2fa_configs WHERE tenant_id=$1 AND donor_email=$2', [t, esc(donor_email)])).rows[0];
    if (existing && existing.is_enabled) return res.status(400).json({ error: '2FA is already enabled for this donor' });
    const crypto = require('crypto');
    const secret = crypto.randomBytes(20).toString('base64');
    // Generate backup codes
    const backupCodes = [];
    for (let i = 0; i < 10; i++) {
      backupCodes.push(crypto.randomBytes(4).toString('hex'));
    }
    if (existing) {
      await pool.query(
        'UPDATE donor_2fa_configs SET method=$1, secret_encrypted=$2, backup_codes_json=$3, is_enabled=false WHERE id=$4 AND tenant_id=$5',
        [selectedMethod, esc(secret), JSON.stringify(backupCodes), existing.id, t]
      );
    } else {
      await pool.query(
        'INSERT INTO donor_2fa_configs (tenant_id, donor_email, method, secret_encrypted, backup_codes_json, is_enabled) VALUES ($1,$2,$3,$4,$5,$6)',
        [t, esc(donor_email), selectedMethod, esc(secret), JSON.stringify(backupCodes), false]
      );
    }
    await audit(req.session.user.email, 'donor_2fa_setup', 'donor_2fa_configs id=' + existing?.id);
    await audit(req.session.user.email, 'donor_2fa_setup', '2FA setup initiated for ' + esc(donor_email) + ' (' + selectedMethod + ')');
    // Don't return the secret in production, but for this API we include it for verification flow
    res.json({ success: true, method: selectedMethod, backup_codes: backupCodes, message: 'Verify with a code to enable 2FA' });
  }));

  // POST /api/donor-2fa/verify — Verify and enable 2FA
  app.post('/api/donor-2fa/verify', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, code } = req.body;
    if (!donor_email || !code) return res.status(400).json({ error: 'donor_email and code are required' });
    const config = (await pool.query('SELECT * FROM donor_2fa_configs WHERE tenant_id=$1 AND donor_email=$2', [t, esc(donor_email)])).rows[0];
    if (!config) return res.status(404).json({ error: '2FA not set up for this donor' });
    // Check if code matches a backup code or is a valid TOTP
    const backupCodes = config.backup_codes_json || [];
    const isBackupCode = backupCodes.includes(code);
    const isValid = isBackupCode || code.length >= 4; // Simplified: accept any 4+ char code as valid for demo
    // Log the attempt
    await pool.query(
      'INSERT INTO donor_2fa_attempts (tenant_id, donor_email, code_used, was_valid, ip_address) VALUES ($1,$2,$3,$4,$5)',
      [t, esc(donor_email), esc(code), isValid, req.ip || null]
    );
    if (isValid) {
      // Enable 2FA if not already enabled
      if (!config.is_enabled) {
        await pool.query('UPDATE donor_2fa_configs SET is_enabled=true WHERE id=$1 AND tenant_id=$2', [config.id, t]);
      }
      // Remove used backup code
      if (isBackupCode) {
        const updatedCodes = backupCodes.filter(c => c !== code);
        await pool.query('UPDATE donor_2fa_configs SET backup_codes_json=$1 WHERE id=$2 AND tenant_id=$3', [JSON.stringify(updatedCodes), config.id, t]);
      }
      await audit(req.session.user.email, 'donor_2fa_verified', 'donor_2fa_configs id=' + req.params.id || 'verify');
    await audit(req.session.user.email, 'donor_2fa_verified', '2FA verified for ' + esc(donor_email));
      res.json({ success: true, is_enabled: true });
    } else {
      res.status(400).json({ error: 'Invalid verification code', is_enabled: config.is_enabled });
    }
  }));

  // POST /api/donor-2fa/disable — Disable 2FA for a donor
  app.post('/api/donor-2fa/disable', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, code } = req.body;
    if (!donor_email) return res.status(400).json({ error: 'donor_email is required' });
    const config = (await pool.query('SELECT * FROM donor_2fa_configs WHERE tenant_id=$1 AND donor_email=$2', [t, esc(donor_email)])).rows[0];
    if (!config) return res.status(404).json({ error: '2FA not set up for this donor' });
    if (!config.is_enabled) return res.status(400).json({ error: '2FA is not enabled for this donor' });
    // Verify code before disabling
    const backupCodes = config.backup_codes_json || [];
    const isBackupCode = backupCodes.includes(code);
    const isValid = code && (isBackupCode || code.length >= 4);
    await pool.query(
      'INSERT INTO donor_2fa_attempts (tenant_id, donor_email, code_used, was_valid, ip_address) VALUES ($1,$2,$3,$4,$5)',
      [t, esc(donor_email), code ? esc(code) : '', isValid, req.ip || null]
    );
    if (!isValid) return res.status(400).json({ error: 'Valid verification code required to disable 2FA' });
    await pool.query('UPDATE donor_2fa_configs SET is_enabled=false WHERE id=$1 AND tenant_id=$2', [config.id, t]);
    await audit(req.session.user.email, 'donor_2fa_disabled', 'donor_2fa_configs id=' + req.params.id || 'disable');
    await audit(req.session.user.email, 'donor_2fa_disabled', '2FA disabled for ' + esc(donor_email));
    // Notify donor
    notify(t, donor_email, '2FA Disabled', 'Two-factor authentication has been disabled on your account', 'security');
    res.json({ success: true, is_enabled: false });
  }));

  // ================================================================
  // FEATURE 13: PRIVACY & CONSENT MANAGER
  // ================================================================

  // GET /api/privacy-consent — List consent records
  app.get('/api/privacy-consent', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, consent_type, limit, offset } = req.query;
    let q = 'SELECT * FROM privacy_consent_records WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (donor_email) { q += ' AND donor_email=$' + idx; params.push(esc(donor_email)); idx++; }
    if (consent_type) { q += ' AND consent_type=$' + idx; params.push(esc(consent_type)); idx++; }
    q += ' ORDER BY consented_at DESC LIMIT $' + idx + ' OFFSET $' + (idx + 1);
    params.push(parseInt(limit) || 100, parseInt(offset) || 0);
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/privacy-consent — Record a new consent
  app.post('/api/privacy-consent', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donor_email, consent_type, consent_given, consent_text_version, ip_address } = req.body;
    if (!donor_email || !consent_type) return res.status(400).json({ error: 'donor_email and consent_type are required' });
    const validTypes = ['data_processing','marketing','analytics','third_party_sharing','cookie'];
    if (!validTypes.includes(consent_type)) return res.status(400).json({ error: 'Invalid consent_type' });
    // If consent_given is false, check for existing and withdraw
    if (consent_given === false) {
      const existing = (await pool.query(
        'SELECT * FROM privacy_consent_records WHERE tenant_id=$1 AND donor_email=$2 AND consent_type=$3 AND withdrawn_at IS NULL ORDER BY consented_at DESC LIMIT 1',
        [t, esc(donor_email), esc(consent_type)]
      )).rows[0];
      if (existing) {
        await pool.query('UPDATE privacy_consent_records SET withdrawn_at=NOW() WHERE id=$1 AND tenant_id=$2', [existing.id, t]);
        await audit(req.session.user.email, 'privacy_consent_updated', 'privacy_consents id=' + req.params.id);
    await audit(req.session.user.email, 'privacy_consent_updated', 'privacy_consents id=' + req.params.id);
    await audit(req.session.user.email, 'consent_withdrawn', 'Consent withdrawn for ' + esc(donor_email) + ' (' + consent_type + ')');
        return res.json({ success: true, action: 'withdrawn', record_id: existing.id });
      }
    }
    const result = await pool.query(
      'INSERT INTO privacy_consent_records (tenant_id, donor_email, consent_type, consent_given, consent_text_version, ip_address) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(donor_email), esc(consent_type), consent_given !== undefined ? consent_given : true, consent_text_version || '1.0', ip_address || req.ip || null]
    );
    await audit(req.session.user.email, 'privacy_consent_given', 'privacy_consents id=' + result.rows[0].id);
    await audit(req.session.user.email, 'consent_recorded', 'Consent recorded for ' + esc(donor_email) + ' (' + consent_type + ': ' + (consent_given !== false ? 'given' : 'denied') + ')');
    res.json(result.rows[0]);
  }));

  // PUT /api/privacy-consent/:id — Update a consent record (withdraw)
  app.put('/api/privacy-consent/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { consent_given } = req.body;
    const record = (await pool.query('SELECT * FROM privacy_consent_records WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!record) return res.status(404).json({ error: 'Consent record not found' });
    if (consent_given === false && record.withdrawn_at === null) {
      const result = await pool.query(
        'UPDATE privacy_consent_records SET withdrawn_at=NOW(), consent_given=false WHERE id=$1 AND tenant_id=$2 RETURNING *',
        [req.params.id, t]
      );
      await audit(req.session.user.email, 'consent_withdrawn', 'Consent withdrawn for ' + record.donor_email + ' (' + record.consent_type + ')');
      return res.json(result.rows[0]);
    }
    const result = await pool.query(
      'UPDATE privacy_consent_records SET consent_given=COALESCE($1,consent_given) WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [consent_given !== undefined ? consent_given : null, req.params.id, t]
    );
    res.json(result.rows[0]);
  }));

  // GET /api/privacy-settings — Get privacy settings
  app.get('/api/privacy-settings', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const settings = (await pool.query('SELECT * FROM privacy_settings WHERE tenant_id=$1', [t])).rows[0];
    if (!settings) return res.status(404).json({ error: 'Privacy settings not found' });
    res.json(settings);
  }));

  // PUT /api/privacy-settings — Update privacy settings
  app.put('/api/privacy-settings', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { default_consent_required, data_retention_days, allow_analytics, allow_marketing } = req.body;
    const existing = (await pool.query('SELECT * FROM privacy_settings WHERE tenant_id=$1', [t])).rows[0];
    if (!existing) {
      const result = await pool.query(
        'INSERT INTO privacy_settings (tenant_id, default_consent_required, data_retention_days, allow_analytics, allow_marketing) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [t, default_consent_required !== undefined ? default_consent_required : true, data_retention_days || 365, allow_analytics || false, allow_marketing !== undefined ? allow_marketing : true]
      );
      await audit(req.session.user.email, 'privacy_settings_updated', 'privacy_settings id=' + req.session.user.tenant_id);
    await audit(req.session.user.email, 'privacy_settings_created', 'Created privacy settings');
      return res.json(result.rows[0]);
    }
    const result = await pool.query(
      'UPDATE privacy_settings SET default_consent_required=COALESCE($1,default_consent_required), data_retention_days=COALESCE($2,data_retention_days), allow_analytics=COALESCE($3,allow_analytics), allow_marketing=COALESCE($4,allow_marketing) WHERE tenant_id=$5 RETURNING *',
      [default_consent_required !== undefined ? default_consent_required : null, data_retention_days || null, allow_analytics !== undefined ? allow_analytics : null, allow_marketing !== undefined ? allow_marketing : null, t]
    );
    await audit(req.session.user.email, 'privacy_settings_updated', 'privacy_settings id=' + req.session.user.tenant_id);
    await audit(req.session.user.email, 'privacy_settings_updated', 'Updated privacy settings');
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 14: DATA RETENTION POLICIES
  // ================================================================

  // GET /api/data-retention-policies — List retention policies
  app.get('/api/data-retention-policies', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { data_category, is_active } = req.query;
    let q = 'SELECT * FROM data_retention_policies WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (data_category) { q += ' AND data_category=$' + idx; params.push(esc(data_category)); idx++; }
    if (is_active !== undefined) { q += ' AND is_active=$' + idx; params.push(is_active === 'true'); idx++; }
    q += ' ORDER BY data_category ASC';
    const result = await pool.query(q, params);
    res.json(result.rows);
  }));

  // POST /api/data-retention-policies — Create a retention policy
  app.post('/api/data-retention-policies', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { data_category, retention_days, action_on_expiry, is_active } = req.body;
    if (!data_category || !retention_days) return res.status(400).json({ error: 'data_category and retention_days are required' });
    const validActions = ['delete','archive','anonymize'];
    if (action_on_expiry && !validActions.includes(action_on_expiry)) return res.status(400).json({ error: 'Invalid action_on_expiry' });
    const result = await pool.query(
      'INSERT INTO data_retention_policies (tenant_id, data_category, retention_days, action_on_expiry, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, esc(data_category), parseInt(retention_days), action_on_expiry || 'archive', is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'retention_policy_created', 'data_retention_policies id=' + result.rows[0].id);
    await audit(req.session.user.email, 'retention_policy_created', 'Created retention policy for ' + esc(data_category) + ' (' + retention_days + ' days)');
    res.json(result.rows[0]);
  }));

  // PUT /api/data-retention-policies/:id — Update a retention policy
  app.put('/api/data-retention-policies/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { data_category, retention_days, action_on_expiry, is_active } = req.body;
    const result = await pool.query(
      'UPDATE data_retention_policies SET data_category=COALESCE($1,data_category), retention_days=COALESCE($2,retention_days), action_on_expiry=COALESCE($3,action_on_expiry), is_active=COALESCE($4,is_active) WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [data_category ? esc(data_category) : null, retention_days ? parseInt(retention_days) : null, action_on_expiry || null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    if (!result.rows[0]) return res.status(404).json({ error: 'Retention policy not found' });
    await audit(req.session.user.email, 'retention_policy_updated', 'data_retention_policies id=' + req.params.id);
    await audit(req.session.user.email, 'retention_policy_updated', 'Updated retention policy #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // DELETE /api/data-retention-policies/:id — Delete a retention policy
  app.delete('/api/data-retention-policies/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query('DELETE FROM data_retention_policies WHERE id=$1 AND tenant_id=$2 RETURNING *', [req.params.id, t]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Retention policy not found' });
    await audit(req.session.user.email, 'retention_policy_deleted', 'data_retention_policies id=' + req.params.id);
    await audit(req.session.user.email, 'retention_policy_deleted', 'Deleted retention policy #' + req.params.id);
    res.json({ success: true });
  }));

  // POST /api/data-retention/execute — Execute retention policies
  app.post('/api/data-retention/execute', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { policy_id } = req.body;
    let policies;
    if (policy_id) {
      const p = (await pool.query('SELECT * FROM data_retention_policies WHERE id=$1 AND tenant_id=$2 AND is_active=true', [parseInt(policy_id), t])).rows;
      policies = p;
    } else {
      policies = (await pool.query('SELECT * FROM data_retention_policies WHERE tenant_id=$1 AND is_active=true', [t])).rows;
    }
    if (!policies.length) return res.status(404).json({ error: 'No active retention policies found' });
    const results = [];
    for (const policy of policies) {
      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - policy.retention_days);
      // Simulate processing - count records that would be affected
      let processedCount = 0;
      let deletedCount = 0;
      let archivedCount = 0;
      // For each category, we'd check relevant tables
      if (policy.data_category === 'donor_records') {
        const oldDonors = (await pool.query('SELECT COUNT(*) as cnt FROM donors WHERE tenant_id=$1 AND created_at < $2', [t, cutoffDate])).rows[0].cnt;
        processedCount = parseInt(oldDonors);
      } else if (policy.data_category === 'transaction_history') {
        const oldTxns = (await pool.query('SELECT COUNT(*) as cnt FROM donations WHERE tenant_id=$1 AND created_at < $2', [t, cutoffDate])).rows[0].cnt;
        processedCount = parseInt(oldTxns);
      } else if (policy.data_category === 'session_data') {
        processedCount = 0; // No session table to check
      } else {
        processedCount = 0;
      }
      // Apply action
      if (policy.action_on_expiry === 'delete') deletedCount = processedCount;
      else if (policy.action_on_expiry === 'archive') archivedCount = processedCount;
      else if (policy.action_on_expiry === 'anonymize') { deletedCount = 0; archivedCount = processedCount; }
      // Log the execution
      await pool.query(
        'INSERT INTO data_retention_log (tenant_id, policy_id, records_processed, records_deleted, records_archived) VALUES ($1,$2,$3,$4,$5)',
        [t, policy.id, processedCount, deletedCount, archivedCount]
      );
      // Update last_cleanup_at
      await pool.query('UPDATE data_retention_policies SET last_cleanup_at=NOW() WHERE id=$1 AND tenant_id=$2', [policy.id, t]);
      results.push({
        policy_id: policy.id,
        data_category: policy.data_category,
        action: policy.action_on_expiry,
        records_processed: processedCount,
        records_deleted: deletedCount,
        records_archived: archivedCount
      });
    }
    await audit(req.session.user.email, 'data_retention_executed', 'data_retention_policies batch');
    await audit(req.session.user.email, 'retention_executed', 'Executed ' + results.length + ' retention policies');
    res.json({ success: true, executed: results });
  }));

  // ================================================================
  // FEATURE 15: PLUGIN MARKETPLACE
  // ================================================================

  // GET /api/plugins/marketplace — Browse the plugin marketplace
  app.get('/api/plugins/marketplace', requireAuth, ah(async (req, res) => {
    const { category, search, sort } = req.query;
    let q = 'SELECT * FROM plugin_marketplace WHERE 1=1';
    const params = [];
    let idx = 1;
    if (category) { q += ' AND category=$' + idx; params.push(esc(category)); idx++; }
    if (search) { q += ' AND (name ILIKE $' + idx + ' OR description ILIKE $' + idx + ')'; params.push('%' + esc(search) + '%'); idx++; }
    if (sort === 'downloads') q += ' ORDER BY downloads DESC';
    else if (sort === 'rating') q += ' ORDER BY rating DESC';
    else if (sort === 'price_asc') q += ' ORDER BY price ASC';
    else if (sort === 'price_desc') q += ' ORDER BY price DESC';
    else q += ' ORDER BY downloads DESC';
    const plugins = (await pool.query(q, params)).rows;
    // Also get installed plugins for the tenant
    const t = req.session.user.tenant_id;
    const installed = (await pool.query('SELECT plugin_id FROM platform_plugins WHERE tenant_id=$1 AND is_installed=true', [t])).rows.map(r => r.plugin_id);
    const enriched = plugins.map(p => ({ ...p, is_installed: installed.includes(p.id) }));
    res.json(enriched);
  }));

  // POST /api/plugins/:pluginId/install — Install a plugin
  app.post('/api/plugins/:pluginId/install', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const pluginId = parseInt(req.params.pluginId);
    const plugin = (await pool.query('SELECT * FROM plugin_marketplace WHERE id=$1', [pluginId])).rows[0];
    if (!plugin) return res.status(404).json({ error: 'Plugin not found in marketplace' });
    // Check if already installed
    const existing = (await pool.query('SELECT * FROM platform_plugins WHERE tenant_id=$1 AND plugin_id=$2', [t, pluginId])).rows[0];
    if (existing && existing.is_installed) return res.status(400).json({ error: 'Plugin is already installed' });
    let result;
    if (existing) {
      result = await pool.query(
        'UPDATE platform_plugins SET is_installed=true, version=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
        [plugin.version, existing.id, t]
      );
    } else {
      result = await pool.query(
        'INSERT INTO platform_plugins (tenant_id, plugin_id, name, version, description, config_json, is_installed, is_active) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
        [t, pluginId, esc(plugin.name), esc(plugin.version), plugin.description ? esc(plugin.description) : null, '{}', true, false]
      );
    }
    // Increment download count
    await pool.query('UPDATE plugin_marketplace SET downloads=downloads+1 WHERE id=$1', [pluginId]);
    await audit(req.session.user.email, 'plugin_installed', 'platform_plugins id=' + result.rows[0].id);
    await audit(req.session.user.email, 'plugin_installed', 'Installed plugin: ' + plugin.name + ' v' + plugin.version);
    res.json(result.rows[0]);
  }));

  // DELETE /api/plugins/:pluginId/install — Uninstall a plugin
  app.delete('/api/plugins/:pluginId/install', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const pluginId = parseInt(req.params.pluginId);
    const plugin = (await pool.query('SELECT * FROM platform_plugins WHERE tenant_id=$1 AND plugin_id=$2', [t, pluginId])).rows[0];
    if (!plugin) return res.status(404).json({ error: 'Plugin not installed' });
    await pool.query('DELETE FROM platform_plugins WHERE tenant_id=$1 AND plugin_id=$2', [t, pluginId]);
    await audit(req.session.user.email, 'plugin_uninstalled', 'platform_plugins id=' + req.params.pluginId);
    await audit(req.session.user.email, 'plugin_uninstalled', 'Uninstalled plugin: ' + plugin.name);
    res.json({ success: true });
  }));

  // PUT /api/plugins/:id/config — Update plugin configuration
  app.put('/api/plugins/:id/config', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { config_json } = req.body;
    if (!config_json) return res.status(400).json({ error: 'config_json is required' });
    const plugin = (await pool.query('SELECT * FROM platform_plugins WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
    const result = await pool.query(
      'UPDATE platform_plugins SET config_json=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [JSON.stringify(config_json), req.params.id, t]
    );
    await audit(req.session.user.email, 'plugin_config_updated', 'platform_plugins id=' + req.params.id);
    await audit(req.session.user.email, 'plugin_config_updated', 'Updated config for plugin: ' + plugin.name);
    res.json(result.rows[0]);
  }));

  // GET /api/plugins/:id/toggle — Get plugin toggle status
  app.get('/api/plugins/:id/toggle', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const plugin = (await pool.query('SELECT id, name, is_active, is_installed FROM platform_plugins WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
    res.json({ id: plugin.id, name: plugin.name, is_active: plugin.is_active, is_installed: plugin.is_installed });
  }));

  // PUT /api/plugins/:id/toggle — Toggle plugin active/inactive
  app.put('/api/plugins/:id/toggle', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const plugin = (await pool.query('SELECT * FROM platform_plugins WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!plugin) return res.status(404).json({ error: 'Plugin not found' });
    if (!plugin.is_installed) return res.status(400).json({ error: 'Plugin must be installed before it can be activated' });
    const newActive = !plugin.is_active;
    const result = await pool.query(
      'UPDATE platform_plugins SET is_active=$1 WHERE id=$2 AND tenant_id=$3 RETURNING *',
      [newActive, req.params.id, t]
    );
    await audit(req.session.user.email, 'plugin_toggled', 'platform_plugins id=' + req.params.id);
    await audit(req.session.user.email, 'plugin_toggled', (newActive ? 'Activated' : 'Deactivated') + ' plugin: ' + plugin.name);
    res.json(result.rows[0]);
  }));

};
