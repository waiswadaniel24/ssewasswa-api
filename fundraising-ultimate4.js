/**
 * Fundraising Ultimate 4 — 15 Financial & Compliance Features
 * Features:
 *  1. Fund Allocation Manager
 *  2. Budget vs Actual
 *  3. Financial Reconciliation
 *  4. Grant Management
 *  5. Endowment Management
 *  6. Multi-Currency Wallet
 *  7. Receipt Batch Processing
 *  8. Donation Split Manager
 *  9. Fund Category Management
 * 10. Donation Anonymity
 * 11. Payment Method Router
 * 12. Financial Dashboard Pro
 * 13. Compliance Document Vault
 * 14. Audit Trail Pro
 * 15. Fund Balance Calculator
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {

  // =============================================
  // DATABASE MIGRATIONS
  // =============================================
  const migrations = [
    // 1. Fund Allocation Manager
    `CREATE TABLE IF NOT EXISTS fund_allocations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      description TEXT,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS fund_allocation_entries (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      allocation_id INTEGER REFERENCES fund_allocations(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
      notes TEXT
    )`,

    // 2. Budget vs Actual
    `CREATE TABLE IF NOT EXISTS fundraising_budgets (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      fiscal_year INTEGER NOT NULL,
      total_budget NUMERIC(15,2) NOT NULL DEFAULT 0,
      total_actual NUMERIC(15,2) NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS budget_line_items (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      budget_id INTEGER REFERENCES fundraising_budgets(id) ON DELETE CASCADE,
      category TEXT NOT NULL,
      budgeted NUMERIC(15,2) NOT NULL DEFAULT 0,
      actual NUMERIC(15,2) NOT NULL DEFAULT 0,
      variance NUMERIC(15,2) GENERATED ALWAYS AS (budgeted - actual) STORED
    )`,

    // 3. Financial Reconciliation
    `CREATE TABLE IF NOT EXISTS reconciliation_batches (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      total_expected NUMERIC(15,2) NOT NULL DEFAULT 0,
      total_actual NUMERIC(15,2) NOT NULL DEFAULT 0,
      discrepancy NUMERIC(15,2) NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'open' CHECK (status IN ('open','in_progress','reconciled','discrepancy')),
      reconciled_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS reconciliation_items (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      batch_id INTEGER REFERENCES reconciliation_batches(id) ON DELETE CASCADE,
      record_type TEXT NOT NULL,
      record_id INTEGER,
      expected NUMERIC(15,2) NOT NULL DEFAULT 0,
      actual NUMERIC(15,2) NOT NULL DEFAULT 0,
      is_matched BOOLEAN DEFAULT false,
      notes TEXT
    )`,

    // 4. Grant Management
    `CREATE TABLE IF NOT EXISTS grants_ult4 (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      funder TEXT NOT NULL,
      amount_requested NUMERIC(15,2) NOT NULL DEFAULT 0,
      amount_awarded NUMERIC(15,2) NOT NULL DEFAULT 0,
      start_date DATE,
      end_date DATE,
      status TEXT DEFAULT 'draft' CHECK (status IN ('draft','submitted','awarded','active','closed','rejected')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS grant_reports_ult4 (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      grant_id INTEGER REFERENCES grants_ult4(id) ON DELETE CASCADE,
      report_type TEXT NOT NULL,
      due_date DATE NOT NULL,
      submitted_date DATE,
      status TEXT DEFAULT 'pending' CHECK (status IN ('pending','submitted','overdue','approved')),
      notes TEXT
    )`,

    // 5. Endowment Management
    `CREATE TABLE IF NOT EXISTS endowments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      principal_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      current_value NUMERIC(15,2) NOT NULL DEFAULT 0,
      spending_rate NUMERIC(5,2) NOT NULL DEFAULT 5.00,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS endowment_transactions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      endowment_id INTEGER REFERENCES endowments(id) ON DELETE CASCADE,
      transaction_type TEXT NOT NULL CHECK (transaction_type IN ('contribution','withdrawal','investment_return','spending','adjustment')),
      amount NUMERIC(15,2) NOT NULL,
      date DATE NOT NULL DEFAULT CURRENT_DATE,
      description TEXT
    )`,

    // 6. Multi-Currency Wallet
    `CREATE TABLE IF NOT EXISTS currency_wallets (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      currency TEXT NOT NULL,
      balance NUMERIC(15,2) NOT NULL DEFAULT 0,
      is_primary BOOLEAN DEFAULT false,
      UNIQUE(tenant_id, currency)
    )`,
    `CREATE TABLE IF NOT EXISTS currency_transactions (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      wallet_id INTEGER REFERENCES currency_wallets(id) ON DELETE CASCADE,
      type TEXT NOT NULL CHECK (type IN ('deposit','withdrawal','transfer_in','transfer_out','exchange')),
      amount NUMERIC(15,2) NOT NULL,
      exchange_rate NUMERIC(10,4) DEFAULT 1.0000,
      reference TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 7. Receipt Batch Processing
    `CREATE TABLE IF NOT EXISTS receipt_batches (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      batch_name TEXT NOT NULL,
      total_receipts INTEGER NOT NULL DEFAULT 0,
      total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      status TEXT DEFAULT 'draft' CHECK (status IN ('draft','generated','sent','completed')),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS receipt_batch_items (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      batch_id INTEGER REFERENCES receipt_batches(id) ON DELETE CASCADE,
      donation_id INTEGER,
      receipt_number TEXT NOT NULL,
      amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      sent BOOLEAN DEFAULT false
    )`,

    // 8. Donation Split Manager
    `CREATE TABLE IF NOT EXISTS donation_splits (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donation_id INTEGER NOT NULL,
      total_amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      split_count INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS donation_split_items (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      split_id INTEGER REFERENCES donation_splits(id) ON DELETE CASCADE,
      fund_category TEXT NOT NULL,
      amount NUMERIC(15,2) NOT NULL DEFAULT 0,
      percentage NUMERIC(5,2) NOT NULL DEFAULT 0
    )`,

    // 9. Fund Category Management
    `CREATE TABLE IF NOT EXISTS fund_categories (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT,
      is_restricted BOOLEAN DEFAULT false
    )`,
    `CREATE TABLE IF NOT EXISTS fund_category_assignments (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      category_id INTEGER REFERENCES fund_categories(id) ON DELETE CASCADE,
      donation_id INTEGER NOT NULL,
      amount NUMERIC(15,2) NOT NULL DEFAULT 0
    )`,

    // 10. Donation Anonymity
    `CREATE TABLE IF NOT EXISTS donation_anonymity_settings (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
      default_anonymous BOOLEAN DEFAULT false,
      allow_anonymous BOOLEAN DEFAULT true,
      show_amount BOOLEAN DEFAULT true,
      show_name BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS anonymous_donations (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      donation_id INTEGER NOT NULL,
      donor_email TEXT,
      display_name TEXT,
      is_anonymous BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 11. Payment Method Router
    `CREATE TABLE IF NOT EXISTS payment_routing_rules (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      conditions_json JSONB DEFAULT '{}',
      gateway TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      is_active BOOLEAN DEFAULT true
    )`,
    `CREATE TABLE IF NOT EXISTS payment_routing_log (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      rule_id INTEGER REFERENCES payment_routing_rules(id) ON DELETE SET NULL,
      donation_id INTEGER,
      gateway TEXT NOT NULL,
      routed_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 12. Financial Dashboard Pro
    `CREATE TABLE IF NOT EXISTS financial_dashboard_config (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE UNIQUE,
      widgets_json JSONB DEFAULT '[]',
      refresh_interval INTEGER DEFAULT 60
    )`,
    `CREATE TABLE IF NOT EXISTS financial_snapshots (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      total_revenue NUMERIC(15,2) NOT NULL DEFAULT 0,
      total_expenses NUMERIC(15,2) NOT NULL DEFAULT 0,
      net NUMERIC(15,2) NOT NULL DEFAULT 0,
      by_method_json JSONB DEFAULT '{}',
      by_category_json JSONB DEFAULT '{}',
      snapshot_date DATE NOT NULL DEFAULT CURRENT_DATE
    )`,

    // 13. Compliance Document Vault
    `CREATE TABLE IF NOT EXISTS compliance_docs (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      category TEXT NOT NULL,
      file_url TEXT,
      expiry_date DATE,
      status TEXT DEFAULT 'active' CHECK (status IN ('active','expiring_soon','expired','archived')),
      uploaded_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS compliance_reminders (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      doc_id INTEGER REFERENCES compliance_docs(id) ON DELETE CASCADE,
      reminder_date DATE NOT NULL,
      sent BOOLEAN DEFAULT false,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 14. Audit Trail Pro
    `CREATE TABLE IF NOT EXISTS enhanced_audit_trail (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      user_email TEXT NOT NULL,
      action TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id INTEGER,
      old_value TEXT,
      new_value TEXT,
      ip_address TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS audit_reports_ult4 (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      report_type TEXT NOT NULL,
      date_range_start DATE NOT NULL,
      date_range_end DATE NOT NULL,
      findings_json JSONB DEFAULT '{}',
      generated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // 15. Fund Balance Calculator
    `CREATE TABLE IF NOT EXISTS fund_balances (
      id SERIAL PRIMARY KEY,
      tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
      fund_name TEXT NOT NULL,
      category TEXT,
      beginning_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
      additions NUMERIC(15,2) NOT NULL DEFAULT 0,
      deductions NUMERIC(15,2) NOT NULL DEFAULT 0,
      ending_balance NUMERIC(15,2) NOT NULL DEFAULT 0,
      period_start DATE NOT NULL,
      period_end DATE NOT NULL,
      calculated_at TIMESTAMPTZ DEFAULT NOW()
    )`,

    // Indexes
    `CREATE INDEX IF NOT EXISTS idx_fund_allocations_tenant ON fund_allocations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fund_allocation_entries_alloc ON fund_allocation_entries(allocation_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fundraising_budgets_tenant ON fundraising_budgets(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_budget_line_items_budget ON budget_line_items(budget_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reconciliation_batches_tenant ON reconciliation_batches(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_reconciliation_items_batch ON reconciliation_items(batch_id)`,
    `CREATE INDEX IF NOT EXISTS idx_grants_ult4_tenant ON grants_ult4(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_grant_reports_ult4_grant ON grant_reports_ult4(grant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_endowments_tenant ON endowments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_endowment_transactions_endowment ON endowment_transactions(endowment_id)`,
    `CREATE INDEX IF NOT EXISTS idx_currency_wallets_tenant ON currency_wallets(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_currency_transactions_wallet ON currency_transactions(wallet_id)`,
    `CREATE INDEX IF NOT EXISTS idx_receipt_batches_tenant ON receipt_batches(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_receipt_batch_items_batch ON receipt_batch_items(batch_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_splits_tenant ON donation_splits(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_donation_split_items_split ON donation_split_items(split_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fund_categories_tenant ON fund_categories(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fund_category_assignments_cat ON fund_category_assignments(category_id)`,
    `CREATE INDEX IF NOT EXISTS idx_anonymity_settings_tenant ON donation_anonymity_settings(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_anonymous_donations_tenant ON anonymous_donations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payment_routing_rules_tenant ON payment_routing_rules(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_payment_routing_log_tenant ON payment_routing_log(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_financial_dashboard_config_tenant ON financial_dashboard_config(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_financial_snapshots_tenant ON financial_snapshots(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_compliance_docs_tenant ON compliance_docs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_compliance_reminders_doc ON compliance_reminders(doc_id)`,
    `CREATE INDEX IF NOT EXISTS idx_enhanced_audit_trail_tenant ON enhanced_audit_trail(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_enhanced_audit_trail_entity ON enhanced_audit_trail(entity_type, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_reports_ult4_tenant ON audit_reports_ult4(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fund_balances_tenant ON fund_balances(tenant_id)`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) { /* already exists OK */ }
    }
    console.log('[FundraisingUlt4] Migrations complete');

    // =============================================
    // SEED DATA — per tenant
    // =============================================

    // Seed currency wallets: UGX (primary), USD, KES
    await pool.query(`INSERT INTO currency_wallets (tenant_id, currency, balance, is_primary)
      SELECT t.id, 'UGX', 0, true
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM currency_wallets WHERE tenant_id=t.id AND currency='UGX')`);
    await pool.query(`INSERT INTO currency_wallets (tenant_id, currency, balance, is_primary)
      SELECT t.id, 'USD', 0, false
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM currency_wallets WHERE tenant_id=t.id AND currency='USD')`);
    await pool.query(`INSERT INTO currency_wallets (tenant_id, currency, balance, is_primary)
      SELECT t.id, 'KES', 0, false
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM currency_wallets WHERE tenant_id=t.id AND currency='KES')`);

    // Seed fund categories: General, Restricted, Endowment, Capital
    await pool.query(`INSERT INTO fund_categories (tenant_id, name, description, is_restricted)
      SELECT t.id, 'General Fund', 'Unrestricted general operating fund', false
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM fund_categories WHERE tenant_id=t.id AND name='General Fund')`);
    await pool.query(`INSERT INTO fund_categories (tenant_id, name, description, is_restricted)
      SELECT t.id, 'Restricted Fund', 'Donor-restricted fund for specific purposes', true
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM fund_categories WHERE tenant_id=t.id AND name='Restricted Fund')`);
    await pool.query(`INSERT INTO fund_categories (tenant_id, name, description, is_restricted)
      SELECT t.id, 'Endowment Fund', 'Long-term endowment investments', true
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM fund_categories WHERE tenant_id=t.id AND name='Endowment Fund')`);
    await pool.query(`INSERT INTO fund_categories (tenant_id, name, description, is_restricted)
      SELECT t.id, 'Capital Fund', 'Capital projects and improvements', false
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM fund_categories WHERE tenant_id=t.id AND name='Capital Fund')`);

    // Seed payment routing rules: 2 rules
    await pool.query(`INSERT INTO payment_routing_rules (tenant_id, name, conditions_json, gateway, priority, is_active)
      SELECT t.id, 'Mobile Money Default', '{"min_amount":500,"max_amount":5000000,"currency":"UGX"}', 'mobile_money', 1, true
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM payment_routing_rules WHERE tenant_id=t.id AND name='Mobile Money Default')`);
    await pool.query(`INSERT INTO payment_routing_rules (tenant_id, name, conditions_json, gateway, priority, is_active)
      SELECT t.id, 'Card Gateway Large', '{"min_amount":5000001,"currency":"UGX"}', 'card_gateway', 2, true
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM payment_routing_rules WHERE tenant_id=t.id AND name='Card Gateway Large')`);

    // Seed anonymity settings
    await pool.query(`INSERT INTO donation_anonymity_settings (tenant_id, default_anonymous, allow_anonymous, show_amount, show_name)
      SELECT t.id, false, true, true, true
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donation_anonymity_settings WHERE tenant_id=t.id)`);

    // Seed financial dashboard config
    await pool.query(`INSERT INTO financial_dashboard_config (tenant_id, widgets_json, refresh_interval)
      SELECT t.id, '["revenue_summary","expense_breakdown","fund_balances","recent_transactions"]', 60
      FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM financial_dashboard_config WHERE tenant_id=t.id)`);

    console.log('[FundraisingUlt4] Seed data complete');
  })();

  // =============================================
  // HELPER: Record enhanced audit entry
  // =============================================
  async function enhancedAudit(tenantId, userEmail, action, entityType, entityId, oldValue, newValue, ipAddress) {
    try {
      await pool.query(
        'INSERT INTO enhanced_audit_trail (tenant_id, user_email, action, entity_type, entity_id, old_value, new_value, ip_address) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [tenantId, userEmail, action, entityType, entityId, oldValue || null, newValue || null, ipAddress || null]
      );
    } catch(e) { console.warn('[EnhancedAudit]', e.message); }
  }

  // ================================================================
  // FEATURE 1: FUND ALLOCATION MANAGER
  // ================================================================

  // GET /api/fund-allocations — List all fund allocations
  app.get('/api/fund-allocations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT fa.*, (SELECT COUNT(*) FROM fund_allocation_entries WHERE allocation_id=fa.id) as entry_count FROM fund_allocations fa WHERE fa.tenant_id=$1 ORDER BY fa.created_at DESC',
      [t]
    );
    res.json(result.rows);
  }));

  // POST /api/fund-allocations — Create a fund allocation
  app.post('/api/fund-allocations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, total_amount, description, is_active } = req.body;
    if (!name || total_amount === undefined) return res.status(400).json({ error: 'name and total_amount are required' });
    const result = await pool.query(
      'INSERT INTO fund_allocations (tenant_id, name, total_amount, description, is_active) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, esc(name), parseFloat(total_amount), description ? esc(description) : null, is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'fund_allocation_created', 'Created fund allocation: ' + esc(name));
    await enhancedAudit(t, req.session.user.email, 'create', 'fund_allocation', result.rows[0].id, null, JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // PUT /api/fund-allocations/:id — Update a fund allocation
  app.put('/api/fund-allocations/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, total_amount, description, is_active } = req.body;
    const old = (await pool.query('SELECT * FROM fund_allocations WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Fund allocation not found' });
    const result = await pool.query(
      'UPDATE fund_allocations SET name=COALESCE($1,name), total_amount=COALESCE($2,total_amount), description=COALESCE($3,description), is_active=COALESCE($4,is_active) WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [name ? esc(name) : null, total_amount !== undefined ? parseFloat(total_amount) : null, description !== undefined ? esc(description) : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    await audit(req.session.user.email, 'fund_allocation_updated', 'Updated fund allocation #' + req.params.id);
    await enhancedAudit(t, req.session.user.email, 'update', 'fund_allocation', parseInt(req.params.id), JSON.stringify(old), JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // DELETE /api/fund-allocations/:id — Delete a fund allocation
  app.delete('/api/fund-allocations/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const old = (await pool.query('SELECT * FROM fund_allocations WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Fund allocation not found' });
    await pool.query('DELETE FROM fund_allocations WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    await audit(req.session.user.email, 'fund_allocation_deleted', 'Deleted fund allocation #' + req.params.id);
    await enhancedAudit(t, req.session.user.email, 'delete', 'fund_allocation', parseInt(req.params.id), JSON.stringify(old), null, req.ip);
    res.json({ success: true });
  }));

  // GET /api/fund-allocations/:id/entries — List entries for an allocation
  app.get('/api/fund-allocations/:id/entries', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const alloc = (await pool.query('SELECT * FROM fund_allocations WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!alloc) return res.status(404).json({ error: 'Fund allocation not found' });
    const result = await pool.query(
      'SELECT * FROM fund_allocation_entries WHERE allocation_id=$1 AND tenant_id=$2 ORDER BY id',
      [req.params.id, t]
    );
    res.json({ allocation: alloc, entries: result.rows });
  }));

  // POST /api/fund-allocations/:id/entries — Add entries to an allocation
  app.post('/api/fund-allocations/:id/entries', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const alloc = (await pool.query('SELECT * FROM fund_allocations WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!alloc) return res.status(404).json({ error: 'Fund allocation not found' });
    const { entries } = req.body;
    if (!entries || !Array.isArray(entries) || entries.length === 0) return res.status(400).json({ error: 'entries array is required' });
    const inserted = [];
    for (const e of entries) {
      if (!e.category || e.amount === undefined) continue;
      const r = await pool.query(
        'INSERT INTO fund_allocation_entries (tenant_id, allocation_id, category, amount, percentage, notes) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
        [t, parseInt(req.params.id), esc(e.category), parseFloat(e.amount), e.percentage !== undefined ? parseFloat(e.percentage) : 0, e.notes ? esc(e.notes) : null]
      );
      inserted.push(r.rows[0]);
    }
    await audit(req.session.user.email, 'fund_allocation_entries_added', 'Added entries to allocation #' + req.params.id);
    res.json(inserted);
  }));

  // ================================================================
  // FEATURE 2: BUDGET VS ACTUAL
  // ================================================================

  // GET /api/fundraising-budgets — List all budgets
  app.get('/api/fundraising-budgets', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT * FROM fundraising_budgets WHERE tenant_id=$1 ORDER BY fiscal_year DESC, created_at DESC',
      [t]
    );
    res.json(result.rows);
  }));

  // POST /api/fundraising-budgets — Create a budget
  app.post('/api/fundraising-budgets', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, fiscal_year, total_budget, total_actual } = req.body;
    if (!name || !fiscal_year) return res.status(400).json({ error: 'name and fiscal_year are required' });
    const result = await pool.query(
      'INSERT INTO fundraising_budgets (tenant_id, name, fiscal_year, total_budget, total_actual) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, esc(name), parseInt(fiscal_year), parseFloat(total_budget) || 0, parseFloat(total_actual) || 0]
    );
    await audit(req.session.user.email, 'budget_created', 'Created budget: ' + esc(name));
    await enhancedAudit(t, req.session.user.email, 'create', 'fundraising_budget', result.rows[0].id, null, JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // PUT /api/fundraising-budgets/:id — Update a budget
  app.put('/api/fundraising-budgets/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, fiscal_year, total_budget, total_actual } = req.body;
    const old = (await pool.query('SELECT * FROM fundraising_budgets WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Budget not found' });
    const result = await pool.query(
      'UPDATE fundraising_budgets SET name=COALESCE($1,name), fiscal_year=COALESCE($2,fiscal_year), total_budget=COALESCE($3,total_budget), total_actual=COALESCE($4,total_actual) WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [name ? esc(name) : null, fiscal_year ? parseInt(fiscal_year) : null, total_budget !== undefined ? parseFloat(total_budget) : null, total_actual !== undefined ? parseFloat(total_actual) : null, req.params.id, t]
    );
    await audit(req.session.user.email, 'budget_updated', 'Updated budget #' + req.params.id);
    await enhancedAudit(t, req.session.user.email, 'update', 'fundraising_budget', parseInt(req.params.id), JSON.stringify(old), JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // GET /api/fundraising-budgets/:id/line-items — List line items for a budget
  app.get('/api/fundraising-budgets/:id/line-items', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const budget = (await pool.query('SELECT * FROM fundraising_budgets WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    const result = await pool.query(
      'SELECT * FROM budget_line_items WHERE budget_id=$1 AND tenant_id=$2 ORDER BY id',
      [req.params.id, t]
    );
    res.json({ budget, line_items: result.rows });
  }));

  // POST /api/fundraising-budgets/:id/line-items — Add line items to a budget
  app.post('/api/fundraising-budgets/:id/line-items', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const budget = (await pool.query('SELECT * FROM fundraising_budgets WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) return res.status(400).json({ error: 'items array is required' });
    const inserted = [];
    for (const item of items) {
      if (!item.category || item.budgeted === undefined) continue;
      const r = await pool.query(
        'INSERT INTO budget_line_items (tenant_id, budget_id, category, budgeted, actual) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [t, parseInt(req.params.id), esc(item.category), parseFloat(item.budgeted), parseFloat(item.actual) || 0]
      );
      inserted.push(r.rows[0]);
    }
    await audit(req.session.user.email, 'budget_line_items_added', 'Added line items to budget #' + req.params.id);
    res.json(inserted);
  }));

  // PUT /api/fundraising-budgets/:id/line-items — Update line items for a budget
  app.put('/api/fundraising-budgets/:id/line-items', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { items } = req.body;
    if (!items || !Array.isArray(items)) return res.status(400).json({ error: 'items array is required' });
    const updated = [];
    for (const item of items) {
      if (!item.id) continue;
      const r = await pool.query(
        'UPDATE budget_line_items SET category=COALESCE($1,category), budgeted=COALESCE($2,budgeted), actual=COALESCE($3,actual) WHERE id=$4 AND tenant_id=$5 AND budget_id=$6 RETURNING *',
        [item.category ? esc(item.category) : null, item.budgeted !== undefined ? parseFloat(item.budgeted) : null, item.actual !== undefined ? parseFloat(item.actual) : null, item.id, t, req.params.id]
      );
      if (r.rows[0]) updated.push(r.rows[0]);
    }
    await audit(req.session.user.email, 'budget_line_items_updated', 'Updated line items for budget #' + req.params.id);
    res.json(updated);
  }));

  // GET /api/fundraising-budgets/:id/variance — Get variance analysis for a budget
  app.get('/api/fundraising-budgets/:id/variance', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const budget = (await pool.query('SELECT * FROM fundraising_budgets WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!budget) return res.status(404).json({ error: 'Budget not found' });
    const items = await pool.query(
      'SELECT *, (budgeted - actual) as variance, CASE WHEN budgeted > 0 THEN ROUND(((budgeted - actual) / budgeted) * 100, 2) ELSE 0 END as variance_pct FROM budget_line_items WHERE budget_id=$1 AND tenant_id=$2 ORDER BY id',
      [req.params.id, t]
    );
    const totalBudgeted = items.rows.reduce((s, i) => s + parseFloat(i.budgeted), 0);
    const totalActual = items.rows.reduce((s, i) => s + parseFloat(i.actual), 0);
    const totalVariance = totalBudgeted - totalActual;
    res.json({
      budget,
      line_items: items.rows,
      summary: { total_budgeted: totalBudgeted, total_actual: totalActual, total_variance: totalVariance, variance_pct: totalBudgeted > 0 ? Math.round((totalVariance / totalBudgeted) * 10000) / 100 : 0 }
    });
  }));

  // ================================================================
  // FEATURE 3: FINANCIAL RECONCILIATION
  // ================================================================

  // GET /api/reconciliation — List reconciliation batches
  app.get('/api/reconciliation', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const status = req.query.status;
    let query = 'SELECT * FROM reconciliation_batches WHERE tenant_id=$1';
    const params = [t];
    if (status) { query += ' AND status=$2'; params.push(status); }
    query += ' ORDER BY created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  }));

  // POST /api/reconciliation — Create a reconciliation batch
  app.post('/api/reconciliation', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { period_start, period_end, total_expected, total_actual, items } = req.body;
    if (!period_start || !period_end) return res.status(400).json({ error: 'period_start and period_end are required' });
    const exp = parseFloat(total_expected) || 0;
    const act = parseFloat(total_actual) || 0;
    const disc = exp - act;
    const result = await pool.query(
      'INSERT INTO reconciliation_batches (tenant_id, period_start, period_end, total_expected, total_actual, discrepancy, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, period_start, period_end, exp, act, disc, disc === 0 ? 'reconciled' : 'open']
    );
    const batch = result.rows[0];
    // Insert items if provided
    if (items && Array.isArray(items)) {
      for (const item of items) {
        await pool.query(
          'INSERT INTO reconciliation_items (tenant_id, batch_id, record_type, record_id, expected, actual, is_matched, notes) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
          [t, batch.id, esc(item.record_type), item.record_id || null, parseFloat(item.expected) || 0, parseFloat(item.actual) || 0, item.expected === item.actual, item.notes ? esc(item.notes) : null]
        );
      }
    }
    await audit(req.session.user.email, 'reconciliation_created', 'Created reconciliation batch #' + batch.id);
    await enhancedAudit(t, req.session.user.email, 'create', 'reconciliation_batch', batch.id, null, JSON.stringify(batch), req.ip);
    res.json(batch);
  }));

  // POST /api/reconciliation/:id/reconcile — Reconcile a batch
  app.post('/api/reconciliation/:id/reconcile', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const old = (await pool.query('SELECT * FROM reconciliation_batches WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Reconciliation batch not found' });
    if (old.status === 'reconciled') return res.status(400).json({ error: 'Batch already reconciled' });

    // Recalculate from items
    const items = await pool.query('SELECT * FROM reconciliation_items WHERE batch_id=$1 AND tenant_id=$2', [req.params.id, t]);
    let totalExpected = 0, totalActual = 0;
    for (const item of items.rows) {
      totalExpected += parseFloat(item.expected);
      totalActual += parseFloat(item.actual);
      // Mark matched items
      const matched = parseFloat(item.expected) === parseFloat(item.actual);
      await pool.query('UPDATE reconciliation_items SET is_matched=$1 WHERE id=$2', [matched, item.id]);
    }

    const discrepancy = totalExpected - totalActual;
    const status = discrepancy === 0 ? 'reconciled' : 'discrepancy';
    const result = await pool.query(
      'UPDATE reconciliation_batches SET total_expected=$1, total_actual=$2, discrepancy=$3, status=$4, reconciled_at=NOW() WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [totalExpected, totalActual, discrepancy, status, req.params.id, t]
    );
    await audit(req.session.user.email, 'reconciliation_completed', 'Reconciled batch #' + req.params.id + ' status=' + status);
    await enhancedAudit(t, req.session.user.email, 'reconcile', 'reconciliation_batch', parseInt(req.params.id), JSON.stringify(old), JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // GET /api/reconciliation/:id/items — Get items for a reconciliation batch
  app.get('/api/reconciliation/:id/items', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const batch = (await pool.query('SELECT * FROM reconciliation_batches WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!batch) return res.status(404).json({ error: 'Reconciliation batch not found' });
    const items = await pool.query('SELECT * FROM reconciliation_items WHERE batch_id=$1 AND tenant_id=$2 ORDER BY id', [req.params.id, t]);
    res.json({ batch, items: items.rows });
  }));

  // ================================================================
  // FEATURE 4: GRANT MANAGEMENT
  // ================================================================

  // GET /api/grants-ult4 — List all grants
  app.get('/api/grants-ult4', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const status = req.query.status;
    let query = 'SELECT g.*, (SELECT COUNT(*) FROM grant_reports_ult4 WHERE grant_id=g.id) as report_count FROM grants_ult4 g WHERE g.tenant_id=$1';
    const params = [t];
    if (status) { query += ' AND g.status=$2'; params.push(status); }
    query += ' ORDER BY g.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  }));

  // POST /api/grants-ult4 — Create a grant
  app.post('/api/grants-ult4', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, funder, amount_requested, amount_awarded, start_date, end_date, status } = req.body;
    if (!name || !funder) return res.status(400).json({ error: 'name and funder are required' });
    const result = await pool.query(
      'INSERT INTO grants_ult4 (tenant_id, name, funder, amount_requested, amount_awarded, start_date, end_date, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
      [t, esc(name), esc(funder), parseFloat(amount_requested) || 0, parseFloat(amount_awarded) || 0, start_date || null, end_date || null, status || 'draft']
    );
    await audit(req.session.user.email, 'grant_created', 'Created grant: ' + esc(name));
    await enhancedAudit(t, req.session.user.email, 'create', 'grant', result.rows[0].id, null, JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // PUT /api/grants-ult4/:id — Update a grant
  app.put('/api/grants-ult4/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, funder, amount_requested, amount_awarded, start_date, end_date, status } = req.body;
    const old = (await pool.query('SELECT * FROM grants_ult4 WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Grant not found' });
    const result = await pool.query(
      'UPDATE grants_ult4 SET name=COALESCE($1,name), funder=COALESCE($2,funder), amount_requested=COALESCE($3,amount_requested), amount_awarded=COALESCE($4,amount_awarded), start_date=COALESCE($5,start_date), end_date=COALESCE($6,end_date), status=COALESCE($7,status) WHERE id=$8 AND tenant_id=$9 RETURNING *',
      [name ? esc(name) : null, funder ? esc(funder) : null, amount_requested !== undefined ? parseFloat(amount_requested) : null, amount_awarded !== undefined ? parseFloat(amount_awarded) : null, start_date || null, end_date || null, status || null, req.params.id, t]
    );
    await audit(req.session.user.email, 'grant_updated', 'Updated grant #' + req.params.id);
    await enhancedAudit(t, req.session.user.email, 'update', 'grant', parseInt(req.params.id), JSON.stringify(old), JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // GET /api/grants-ult4/:id/reports — List reports for a grant
  app.get('/api/grants-ult4/:id/reports', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const grant = (await pool.query('SELECT * FROM grants_ult4 WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!grant) return res.status(404).json({ error: 'Grant not found' });
    const reports = await pool.query('SELECT * FROM grant_reports_ult4 WHERE grant_id=$1 AND tenant_id=$2 ORDER BY due_date', [req.params.id, t]);
    res.json({ grant, reports: reports.rows });
  }));

  // POST /api/grants-ult4/:id/reports — Add a report to a grant
  app.post('/api/grants-ult4/:id/reports', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const grant = (await pool.query('SELECT * FROM grants_ult4 WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!grant) return res.status(404).json({ error: 'Grant not found' });
    const { report_type, due_date, submitted_date, status, notes } = req.body;
    if (!report_type || !due_date) return res.status(400).json({ error: 'report_type and due_date are required' });
    const result = await pool.query(
      'INSERT INTO grant_reports_ult4 (tenant_id, grant_id, report_type, due_date, submitted_date, status, notes) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, parseInt(req.params.id), esc(report_type), due_date, submitted_date || null, status || 'pending', notes ? esc(notes) : null]
    );
    await audit(req.session.user.email, 'grant_report_added', 'Added report to grant #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 5: ENDOWMENT MANAGEMENT
  // ================================================================

  // GET /api/endowments — List all endowments
  app.get('/api/endowments', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT e.*, (SELECT COALESCE(SUM(amount),0) FROM endowment_transactions WHERE endowment_id=e.id AND transaction_type=\'contribution\') as total_contributions, (SELECT COALESCE(SUM(amount),0) FROM endowment_transactions WHERE endowment_id=e.id AND transaction_type=\'withdrawal\') as total_withdrawals FROM endowments e WHERE e.tenant_id=$1 ORDER BY e.created_at DESC',
      [t]
    );
    res.json(result.rows);
  }));

  // POST /api/endowments — Create an endowment
  app.post('/api/endowments', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, principal_amount, current_value, spending_rate } = req.body;
    if (!name || principal_amount === undefined) return res.status(400).json({ error: 'name and principal_amount are required' });
    const result = await pool.query(
      'INSERT INTO endowments (tenant_id, name, principal_amount, current_value, spending_rate) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, esc(name), parseFloat(principal_amount), parseFloat(current_value) || parseFloat(principal_amount), parseFloat(spending_rate) || 5.00]
    );
    await audit(req.session.user.email, 'endowment_created', 'Created endowment: ' + esc(name));
    await enhancedAudit(t, req.session.user.email, 'create', 'endowment', result.rows[0].id, null, JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // PUT /api/endowments/:id — Update an endowment
  app.put('/api/endowments/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, principal_amount, current_value, spending_rate } = req.body;
    const old = (await pool.query('SELECT * FROM endowments WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Endowment not found' });
    const result = await pool.query(
      'UPDATE endowments SET name=COALESCE($1,name), principal_amount=COALESCE($2,principal_amount), current_value=COALESCE($3,current_value), spending_rate=COALESCE($4,spending_rate) WHERE id=$5 AND tenant_id=$6 RETURNING *',
      [name ? esc(name) : null, principal_amount !== undefined ? parseFloat(principal_amount) : null, current_value !== undefined ? parseFloat(current_value) : null, spending_rate !== undefined ? parseFloat(spending_rate) : null, req.params.id, t]
    );
    await audit(req.session.user.email, 'endowment_updated', 'Updated endowment #' + req.params.id);
    await enhancedAudit(t, req.session.user.email, 'update', 'endowment', parseInt(req.params.id), JSON.stringify(old), JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // GET /api/endowments/:id/transactions — List transactions for an endowment
  app.get('/api/endowments/:id/transactions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const endowment = (await pool.query('SELECT * FROM endowments WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!endowment) return res.status(404).json({ error: 'Endowment not found' });
    const txns = await pool.query('SELECT * FROM endowment_transactions WHERE endowment_id=$1 AND tenant_id=$2 ORDER BY date DESC, id DESC', [req.params.id, t]);
    res.json({ endowment, transactions: txns.rows });
  }));

  // POST /api/endowments/:id/transactions — Add a transaction to an endowment
  app.post('/api/endowments/:id/transactions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const endowment = (await pool.query('SELECT * FROM endowments WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!endowment) return res.status(404).json({ error: 'Endowment not found' });
    const { transaction_type, amount, date, description } = req.body;
    if (!transaction_type || amount === undefined) return res.status(400).json({ error: 'transaction_type and amount are required' });
    const amt = parseFloat(amount);
    const result = await pool.query(
      'INSERT INTO endowment_transactions (tenant_id, endowment_id, transaction_type, amount, date, description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, parseInt(req.params.id), transaction_type, amt, date || 'CURRENT_DATE', description ? esc(description) : null]
    );
    // Update endowment current_value
    let newCurrentValue = parseFloat(endowment.current_value);
    if (transaction_type === 'contribution' || transaction_type === 'investment_return') {
      newCurrentValue += amt;
    } else if (transaction_type === 'withdrawal' || transaction_type === 'spending') {
      newCurrentValue -= amt;
    } else if (transaction_type === 'adjustment') {
      newCurrentValue = amt; // adjustment sets the value directly
    }
    await pool.query('UPDATE endowments SET current_value=$1 WHERE id=$2', [newCurrentValue, req.params.id]);
    await audit(req.session.user.email, 'endowment_transaction_added', 'Added ' + transaction_type + ' to endowment #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 6: MULTI-CURRENCY WALLET
  // ================================================================

  // GET /api/currency-wallets — List all wallets
  app.get('/api/currency-wallets', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT w.*, (SELECT COUNT(*) FROM currency_transactions WHERE wallet_id=w.id) as transaction_count FROM currency_wallets w WHERE w.tenant_id=$1 ORDER BY w.is_primary DESC, w.currency ASC',
      [t]
    );
    res.json(result.rows);
  }));

  // POST /api/currency-wallets — Create a wallet
  app.post('/api/currency-wallets', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { currency, balance, is_primary } = req.body;
    if (!currency) return res.status(400).json({ error: 'currency is required' });
    const existing = (await pool.query('SELECT * FROM currency_wallets WHERE tenant_id=$1 AND currency=$2', [t, esc(currency)])).rows[0];
    if (existing) return res.status(409).json({ error: 'Wallet for ' + currency + ' already exists' });
    const result = await pool.query(
      'INSERT INTO currency_wallets (tenant_id, currency, balance, is_primary) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, esc(currency).toUpperCase(), parseFloat(balance) || 0, is_primary || false]
    );
    await audit(req.session.user.email, 'currency_wallet_created', 'Created ' + currency + ' wallet');
    res.json(result.rows[0]);
  }));

  // GET /api/currency-wallets/:id/transactions — List transactions for a wallet
  app.get('/api/currency-wallets/:id/transactions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const wallet = (await pool.query('SELECT * FROM currency_wallets WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    const txns = await pool.query('SELECT * FROM currency_transactions WHERE wallet_id=$1 AND tenant_id=$2 ORDER BY created_at DESC', [req.params.id, t]);
    res.json({ wallet, transactions: txns.rows });
  }));

  // POST /api/currency-wallets/:id/transactions — Add a transaction to a wallet
  app.post('/api/currency-wallets/:id/transactions', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const wallet = (await pool.query('SELECT * FROM currency_wallets WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!wallet) return res.status(404).json({ error: 'Wallet not found' });
    const { type, amount, exchange_rate, reference } = req.body;
    if (!type || amount === undefined) return res.status(400).json({ error: 'type and amount are required' });
    const amt = parseFloat(amount);
    // Update wallet balance
    let newBalance = parseFloat(wallet.balance);
    if (type === 'deposit' || type === 'transfer_in' || type === 'exchange') {
      newBalance += amt;
    } else if (type === 'withdrawal' || type === 'transfer_out') {
      if (newBalance < amt) return res.status(400).json({ error: 'Insufficient balance' });
      newBalance -= amt;
    }
    const result = await pool.query(
      'INSERT INTO currency_transactions (tenant_id, wallet_id, type, amount, exchange_rate, reference) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, parseInt(req.params.id), type, amt, parseFloat(exchange_rate) || 1.0, reference ? esc(reference) : null]
    );
    await pool.query('UPDATE currency_wallets SET balance=$1 WHERE id=$2', [newBalance, req.params.id]);
    await audit(req.session.user.email, 'currency_transaction', type + ' ' + amt + ' ' + wallet.currency);
    res.json(result.rows[0]);
  }));

  // POST /api/currency-wallets/transfer — Transfer between wallets
  app.post('/api/currency-wallets/transfer', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { from_wallet_id, to_wallet_id, amount, exchange_rate, reference } = req.body;
    if (!from_wallet_id || !to_wallet_id || !amount) return res.status(400).json({ error: 'from_wallet_id, to_wallet_id, and amount are required' });
    if (from_wallet_id === to_wallet_id) return res.status(400).json({ error: 'Cannot transfer to the same wallet' });
    const amt = parseFloat(amount);
    const rate = parseFloat(exchange_rate) || 1.0;

    const fromWallet = (await pool.query('SELECT * FROM currency_wallets WHERE id=$1 AND tenant_id=$2', [from_wallet_id, t])).rows[0];
    const toWallet = (await pool.query('SELECT * FROM currency_wallets WHERE id=$1 AND tenant_id=$2', [to_wallet_id, t])).rows[0];
    if (!fromWallet) return res.status(404).json({ error: 'Source wallet not found' });
    if (!toWallet) return res.status(404).json({ error: 'Destination wallet not found' });
    if (parseFloat(fromWallet.balance) < amt) return res.status(400).json({ error: 'Insufficient balance in source wallet' });

    const convertedAmount = amt * rate;

    // Debit source
    await pool.query('UPDATE currency_wallets SET balance=balance-$1 WHERE id=$2', [amt, from_wallet_id]);
    await pool.query(
      'INSERT INTO currency_transactions (tenant_id, wallet_id, type, amount, exchange_rate, reference) VALUES ($1,$2,$3,$4,$5,$6)',
      [t, from_wallet_id, 'transfer_out', amt, rate, reference ? esc(reference) : 'Transfer to ' + toWallet.currency]
    );

    // Credit destination
    await pool.query('UPDATE currency_wallets SET balance=balance+$1 WHERE id=$2', [convertedAmount, to_wallet_id]);
    await pool.query(
      'INSERT INTO currency_transactions (tenant_id, wallet_id, type, amount, exchange_rate, reference) VALUES ($1,$2,$3,$4,$5,$6)',
      [t, to_wallet_id, 'transfer_in', convertedAmount, rate, reference ? esc(reference) : 'Transfer from ' + fromWallet.currency]
    );

    await audit(req.session.user.email, 'currency_transfer', 'Transferred ' + amt + ' ' + fromWallet.currency + ' to ' + convertedAmount + ' ' + toWallet.currency);
    res.json({ success: true, from: fromWallet.currency, to: toWallet.currency, amount: amt, converted: convertedAmount, rate });
  }));

  // ================================================================
  // FEATURE 7: RECEIPT BATCH PROCESSING
  // ================================================================

  // GET /api/receipt-batches — List receipt batches
  app.get('/api/receipt-batches', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT rb.*, (SELECT COUNT(*) FROM receipt_batch_items WHERE batch_id=rb.id) as item_count FROM receipt_batches rb WHERE rb.tenant_id=$1 ORDER BY rb.created_at DESC',
      [t]
    );
    res.json(result.rows);
  }));

  // POST /api/receipt-batches — Create a receipt batch
  app.post('/api/receipt-batches', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { batch_name, donations } = req.body;
    if (!batch_name) return res.status(400).json({ error: 'batch_name is required' });
    const result = await pool.query(
      'INSERT INTO receipt_batches (tenant_id, batch_name, total_receipts, total_amount, status) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, esc(batch_name), 0, 0, 'draft']
    );
    const batch = result.rows[0];

    // Add donation items if provided
    if (donations && Array.isArray(donations)) {
      for (const d of donations) {
        const receiptNum = 'RCT-' + batch.id + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        await pool.query(
          'INSERT INTO receipt_batch_items (tenant_id, batch_id, donation_id, receipt_number, amount, sent) VALUES ($1,$2,$3,$4,$5,$6)',
          [t, batch.id, d.donation_id || null, receiptNum, parseFloat(d.amount) || 0, false]
        );
      }
      // Update batch totals
      const totals = await pool.query(
        'SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM receipt_batch_items WHERE batch_id=$1 AND tenant_id=$2',
        [batch.id, t]
      );
      await pool.query(
        'UPDATE receipt_batches SET total_receipts=$1, total_amount=$2 WHERE id=$3',
        [parseInt(totals.rows[0].cnt), parseFloat(totals.rows[0].total), batch.id]
      );
    }

    await audit(req.session.user.email, 'receipt_batch_created', 'Created receipt batch: ' + esc(batch_name));
    res.json(batch);
  }));

  // POST /api/receipt-batches/:id/generate — Generate receipts for a batch
  app.post('/api/receipt-batches/:id/generate', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const batch = (await pool.query('SELECT * FROM receipt_batches WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!batch) return res.status(404).json({ error: 'Receipt batch not found' });
    if (batch.status !== 'draft') return res.status(400).json({ error: 'Only draft batches can be generated' });

    // Generate receipt numbers for items that don't have one
    const items = await pool.query('SELECT * FROM receipt_batch_items WHERE batch_id=$1 AND tenant_id=$2', [req.params.id, t]);
    for (const item of items.rows) {
      if (!item.receipt_number || item.receipt_number === '') {
        const newNum = 'RCT-' + batch.id + '-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        await pool.query('UPDATE receipt_batch_items SET receipt_number=$1 WHERE id=$2', [newNum, item.id]);
      }
    }

    await pool.query("UPDATE receipt_batches SET status='generated' WHERE id=$1 AND tenant_id=$2", [req.params.id, t]);
    await audit(req.session.user.email, 'receipt_batch_generated', 'Generated receipts for batch #' + req.params.id);
    res.json({ success: true, message: 'Receipts generated for batch #' + req.params.id });
  }));

  // POST /api/receipt-batches/:id/send — Send receipts for a batch
  app.post('/api/receipt-batches/:id/send', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const batch = (await pool.query('SELECT * FROM receipt_batches WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!batch) return res.status(404).json({ error: 'Receipt batch not found' });
    if (batch.status !== 'generated') return res.status(400).json({ error: 'Only generated batches can be sent' });

    // Mark all items as sent
    await pool.query('UPDATE receipt_batch_items SET sent=true WHERE batch_id=$1 AND tenant_id=$2', [req.params.id, t]);
    await pool.query("UPDATE receipt_batches SET status='sent' WHERE id=$1 AND tenant_id=$2", [req.params.id, t]);

    await audit(req.session.user.email, 'receipt_batch_sent', 'Sent receipts for batch #' + req.params.id);
    res.json({ success: true, message: 'Receipts sent for batch #' + req.params.id });
  }));

  // ================================================================
  // FEATURE 8: DONATION SPLIT MANAGER
  // ================================================================

  // GET /api/donation-splits — List donation splits
  app.get('/api/donation-splits', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const donation_id = req.query.donation_id;
    let query = 'SELECT ds.*, (SELECT COUNT(*) FROM donation_split_items WHERE split_id=ds.id) as item_count FROM donation_splits ds WHERE ds.tenant_id=$1';
    const params = [t];
    if (donation_id) { query += ' AND ds.donation_id=$2'; params.push(donation_id); }
    query += ' ORDER BY ds.created_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  }));

  // POST /api/donation-splits — Create a donation split
  app.post('/api/donation-splits', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donation_id, total_amount, items } = req.body;
    if (!donation_id || total_amount === undefined) return res.status(400).json({ error: 'donation_id and total_amount are required' });

    const result = await pool.query(
      'INSERT INTO donation_splits (tenant_id, donation_id, total_amount, split_count) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, parseInt(donation_id), parseFloat(total_amount), 0]
    );
    const split = result.rows[0];

    if (items && Array.isArray(items)) {
      for (const item of items) {
        if (!item.fund_category || item.amount === undefined) continue;
        await pool.query(
          'INSERT INTO donation_split_items (tenant_id, split_id, fund_category, amount, percentage) VALUES ($1,$2,$3,$4,$5)',
          [t, split.id, esc(item.fund_category), parseFloat(item.amount), item.percentage !== undefined ? parseFloat(item.percentage) : 0]
        );
      }
      const count = (await pool.query('SELECT COUNT(*) as cnt FROM donation_split_items WHERE split_id=$1', [split.id])).rows[0].cnt;
      await pool.query('UPDATE donation_splits SET split_count=$1 WHERE id=$2', [parseInt(count), split.id]);
    }

    await audit(req.session.user.email, 'donation_split_created', 'Created split for donation #' + donation_id);
    res.json(split);
  }));

  // GET /api/donation-splits/:id/items — Get items for a donation split
  app.get('/api/donation-splits/:id/items', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const split = (await pool.query('SELECT * FROM donation_splits WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!split) return res.status(404).json({ error: 'Donation split not found' });
    const items = await pool.query('SELECT * FROM donation_split_items WHERE split_id=$1 AND tenant_id=$2 ORDER BY id', [req.params.id, t]);
    res.json({ split, items: items.rows });
  }));

  // ================================================================
  // FEATURE 9: FUND CATEGORY MANAGEMENT
  // ================================================================

  // GET /api/fund-categories — List all fund categories
  app.get('/api/fund-categories', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT fc.*, (SELECT COALESCE(SUM(amount),0) FROM fund_category_assignments WHERE category_id=fc.id) as total_assigned FROM fund_categories fc WHERE fc.tenant_id=$1 ORDER BY fc.id',
      [t]
    );
    res.json(result.rows);
  }));

  // POST /api/fund-categories — Create a fund category
  app.post('/api/fund-categories', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, is_restricted } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });
    const result = await pool.query(
      'INSERT INTO fund_categories (tenant_id, name, description, is_restricted) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, esc(name), description ? esc(description) : null, is_restricted || false]
    );
    await audit(req.session.user.email, 'fund_category_created', 'Created fund category: ' + esc(name));
    await enhancedAudit(t, req.session.user.email, 'create', 'fund_category', result.rows[0].id, null, JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // PUT /api/fund-categories/:id — Update a fund category
  app.put('/api/fund-categories/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, description, is_restricted } = req.body;
    const old = (await pool.query('SELECT * FROM fund_categories WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Fund category not found' });
    const result = await pool.query(
      'UPDATE fund_categories SET name=COALESCE($1,name), description=COALESCE($2,description), is_restricted=COALESCE($3,is_restricted) WHERE id=$4 AND tenant_id=$5 RETURNING *',
      [name ? esc(name) : null, description !== undefined ? esc(description) : null, is_restricted !== undefined ? is_restricted : null, req.params.id, t]
    );
    await audit(req.session.user.email, 'fund_category_updated', 'Updated fund category #' + req.params.id);
    await enhancedAudit(t, req.session.user.email, 'update', 'fund_category', parseInt(req.params.id), JSON.stringify(old), JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // DELETE /api/fund-categories/:id — Delete a fund category
  app.delete('/api/fund-categories/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const old = (await pool.query('SELECT * FROM fund_categories WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Fund category not found' });
    await pool.query('DELETE FROM fund_categories WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    await audit(req.session.user.email, 'fund_category_deleted', 'Deleted fund category #' + req.params.id);
    await enhancedAudit(t, req.session.user.email, 'delete', 'fund_category', parseInt(req.params.id), JSON.stringify(old), null, req.ip);
    res.json({ success: true });
  }));

  // POST /api/fund-categories/:id/assign — Assign a donation to a fund category
  app.post('/api/fund-categories/:id/assign', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const category = (await pool.query('SELECT * FROM fund_categories WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!category) return res.status(404).json({ error: 'Fund category not found' });
    const { donation_id, amount } = req.body;
    if (!donation_id || amount === undefined) return res.status(400).json({ error: 'donation_id and amount are required' });
    const result = await pool.query(
      'INSERT INTO fund_category_assignments (tenant_id, category_id, donation_id, amount) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, parseInt(req.params.id), parseInt(donation_id), parseFloat(amount)]
    );
    await audit(req.session.user.email, 'fund_category_assigned', 'Assigned donation #' + donation_id + ' to category ' + category.name);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 10: DONATION ANONYMITY
  // ================================================================

  // GET /api/anonymity-settings — Get anonymity settings for tenant
  app.get('/api/anonymity-settings', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    let settings = (await pool.query('SELECT * FROM donation_anonymity_settings WHERE tenant_id=$1', [t])).rows[0];
    if (!settings) {
      // Create default settings
      const r = await pool.query(
        'INSERT INTO donation_anonymity_settings (tenant_id, default_anonymous, allow_anonymous, show_amount, show_name) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [t, false, true, true, true]
      );
      settings = r.rows[0];
    }
    res.json(settings);
  }));

  // PUT /api/anonymity-settings — Update anonymity settings
  app.put('/api/anonymity-settings', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { default_anonymous, allow_anonymous, show_amount, show_name } = req.body;
    const old = (await pool.query('SELECT * FROM donation_anonymity_settings WHERE tenant_id=$1', [t])).rows[0];
    let result;
    if (old) {
      result = await pool.query(
        'UPDATE donation_anonymity_settings SET default_anonymous=COALESCE($1,default_anonymous), allow_anonymous=COALESCE($2,allow_anonymous), show_amount=COALESCE($3,show_amount), show_name=COALESCE($4,show_name) WHERE tenant_id=$5 RETURNING *',
        [default_anonymous !== undefined ? default_anonymous : null, allow_anonymous !== undefined ? allow_anonymous : null, show_amount !== undefined ? show_amount : null, show_name !== undefined ? show_name : null, t]
      );
    } else {
      result = await pool.query(
        'INSERT INTO donation_anonymity_settings (tenant_id, default_anonymous, allow_anonymous, show_amount, show_name) VALUES ($1,$2,$3,$4,$5) RETURNING *',
        [t, default_anonymous || false, allow_anonymous !== undefined ? allow_anonymous : true, show_amount !== undefined ? show_amount : true, show_name !== undefined ? show_name : true]
      );
    }
    await audit(req.session.user.email, 'anonymity_settings_updated', 'Updated donation anonymity settings');
    await enhancedAudit(t, req.session.user.email, 'update', 'anonymity_settings', null, JSON.stringify(old), JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // GET /api/anonymous-donations — List anonymous donations
  app.get('/api/anonymous-donations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT * FROM anonymous_donations WHERE tenant_id=$1 ORDER BY created_at DESC',
      [t]
    );
    res.json(result.rows);
  }));

  // POST /api/anonymous-donations — Create an anonymous donation record
  app.post('/api/anonymous-donations', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { donation_id, donor_email, display_name, is_anonymous } = req.body;
    if (!donation_id) return res.status(400).json({ error: 'donation_id is required' });

    // Check anonymity settings
    const settings = (await pool.query('SELECT * FROM donation_anonymity_settings WHERE tenant_id=$1', [t])).rows[0];
    const allowAnon = settings ? settings.allow_anonymous : true;
    const defaultAnon = settings ? settings.default_anonymous : false;

    const result = await pool.query(
      'INSERT INTO anonymous_donations (tenant_id, donation_id, donor_email, display_name, is_anonymous) VALUES ($1,$2,$3,$4,$5) RETURNING *',
      [t, parseInt(donation_id), donor_email ? esc(donor_email) : null, display_name ? esc(display_name) : 'Anonymous Donor', is_anonymous !== undefined ? is_anonymous : defaultAnon]
    );
    await audit(req.session.user.email, 'anonymous_donation_recorded', 'Recorded anonymous donation for donation #' + donation_id);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 11: PAYMENT METHOD ROUTER
  // ================================================================

  // GET /api/payment-routing-rules — List all routing rules
  app.get('/api/payment-routing-rules', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const result = await pool.query(
      'SELECT * FROM payment_routing_rules WHERE tenant_id=$1 ORDER BY priority ASC, id ASC',
      [t]
    );
    res.json(result.rows);
  }));

  // POST /api/payment-routing-rules — Create a routing rule
  app.post('/api/payment-routing-rules', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, conditions_json, gateway, priority, is_active } = req.body;
    if (!name || !gateway) return res.status(400).json({ error: 'name and gateway are required' });
    const result = await pool.query(
      'INSERT INTO payment_routing_rules (tenant_id, name, conditions_json, gateway, priority, is_active) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(name), typeof conditions_json === 'object' ? JSON.stringify(conditions_json) : (conditions_json || '{}'), esc(gateway), parseInt(priority) || 0, is_active !== undefined ? is_active : true]
    );
    await audit(req.session.user.email, 'payment_routing_rule_created', 'Created routing rule: ' + esc(name));
    await enhancedAudit(t, req.session.user.email, 'create', 'payment_routing_rule', result.rows[0].id, null, JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // PUT /api/payment-routing-rules/:id — Update a routing rule
  app.put('/api/payment-routing-rules/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, conditions_json, gateway, priority, is_active } = req.body;
    const old = (await pool.query('SELECT * FROM payment_routing_rules WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Routing rule not found' });
    const result = await pool.query(
      'UPDATE payment_routing_rules SET name=COALESCE($1,name), conditions_json=COALESCE($2,conditions_json), gateway=COALESCE($3,gateway), priority=COALESCE($4,priority), is_active=COALESCE($5,is_active) WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [name ? esc(name) : null, conditions_json ? (typeof conditions_json === 'object' ? JSON.stringify(conditions_json) : conditions_json) : null, gateway ? esc(gateway) : null, priority !== undefined ? parseInt(priority) : null, is_active !== undefined ? is_active : null, req.params.id, t]
    );
    await audit(req.session.user.email, 'payment_routing_rule_updated', 'Updated routing rule #' + req.params.id);
    await enhancedAudit(t, req.session.user.email, 'update', 'payment_routing_rule', parseInt(req.params.id), JSON.stringify(old), JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // DELETE /api/payment-routing-rules/:id — Delete a routing rule
  app.delete('/api/payment-routing-rules/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const old = (await pool.query('SELECT * FROM payment_routing_rules WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Routing rule not found' });
    await pool.query('DELETE FROM payment_routing_rules WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    await audit(req.session.user.email, 'payment_routing_rule_deleted', 'Deleted routing rule #' + req.params.id);
    await enhancedAudit(t, req.session.user.email, 'delete', 'payment_routing_rule', parseInt(req.params.id), JSON.stringify(old), null, req.ip);
    res.json({ success: true });
  }));

  // GET /api/payment-routing-log — List routing log entries
  app.get('/api/payment-routing-log', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const limit = Math.min(parseInt(req.query.limit) || 50, 200);
    const result = await pool.query(
      'SELECT prl.*, prr.name as rule_name FROM payment_routing_log prl LEFT JOIN payment_routing_rules prr ON prl.rule_id=prr.id WHERE prl.tenant_id=$1 ORDER BY prl.routed_at DESC LIMIT $2',
      [t, limit]
    );
    res.json(result.rows);
  }));

  // ================================================================
  // FEATURE 12: FINANCIAL DASHBOARD PRO
  // ================================================================

  // GET /api/financial-dashboard — Get dashboard config + latest snapshot
  app.get('/api/financial-dashboard', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    let config = (await pool.query('SELECT * FROM financial_dashboard_config WHERE tenant_id=$1', [t])).rows[0];
    if (!config) {
      const r = await pool.query(
        'INSERT INTO financial_dashboard_config (tenant_id, widgets_json, refresh_interval) VALUES ($1,$2,$3) RETURNING *',
        [t, '["revenue_summary","expense_breakdown","fund_balances","recent_transactions"]', 60]
      );
      config = r.rows[0];
    }
    const latestSnapshot = (await pool.query(
      'SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY snapshot_date DESC LIMIT 1',
      [t]
    )).rows[0] || null;
    res.json({ config, latest_snapshot: latestSnapshot });
  }));

  // PUT /api/financial-dashboard — Update dashboard config
  app.put('/api/financial-dashboard', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { widgets_json, refresh_interval } = req.body;
    const old = (await pool.query('SELECT * FROM financial_dashboard_config WHERE tenant_id=$1', [t])).rows[0];
    let result;
    if (old) {
      result = await pool.query(
        'UPDATE financial_dashboard_config SET widgets_json=COALESCE($1,widgets_json), refresh_interval=COALESCE($2,refresh_interval) WHERE tenant_id=$3 RETURNING *',
        [widgets_json ? (typeof widgets_json === 'object' ? JSON.stringify(widgets_json) : widgets_json) : null, refresh_interval !== undefined ? parseInt(refresh_interval) : null, t]
      );
    } else {
      result = await pool.query(
        'INSERT INTO financial_dashboard_config (tenant_id, widgets_json, refresh_interval) VALUES ($1,$2,$3) RETURNING *',
        [t, widgets_json ? (typeof widgets_json === 'object' ? JSON.stringify(widgets_json) : widgets_json) : '[]', refresh_interval || 60]
      );
    }
    await audit(req.session.user.email, 'financial_dashboard_config_updated', 'Updated financial dashboard configuration');
    res.json(result.rows[0]);
  }));

  // POST /api/financial-dashboard/snapshot — Create a financial snapshot
  app.post('/api/financial-dashboard/snapshot', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { total_revenue, total_expenses, net, by_method_json, by_category_json, snapshot_date } = req.body;
    const rev = parseFloat(total_revenue) || 0;
    const exp = parseFloat(total_expenses) || 0;
    const netVal = net !== undefined ? parseFloat(net) : (rev - exp);
    const result = await pool.query(
      'INSERT INTO financial_snapshots (tenant_id, total_revenue, total_expenses, net, by_method_json, by_category_json, snapshot_date) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
      [t, rev, exp, netVal, by_method_json ? (typeof by_method_json === 'object' ? JSON.stringify(by_method_json) : by_method_json) : '{}', by_category_json ? (typeof by_category_json === 'object' ? JSON.stringify(by_category_json) : by_category_json) : '{}', snapshot_date || 'CURRENT_DATE']
    );
    await audit(req.session.user.email, 'financial_snapshot_created', 'Created financial snapshot');
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 13: COMPLIANCE DOCUMENT VAULT
  // ================================================================

  // GET /api/compliance-docs — List all compliance documents
  app.get('/api/compliance-docs', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const category = req.query.category;
    const status = req.query.status;
    let query = 'SELECT cd.*, (SELECT COUNT(*) FROM compliance_reminders WHERE doc_id=cd.id) as reminder_count FROM compliance_docs cd WHERE cd.tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (category) { query += ' AND cd.category=$' + idx; params.push(category); idx++; }
    if (status) { query += ' AND cd.status=$' + idx; params.push(status); idx++; }
    query += ' ORDER BY cd.uploaded_at DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  }));

  // POST /api/compliance-docs — Upload a compliance document
  app.post('/api/compliance-docs', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, category, file_url, expiry_date, status } = req.body;
    if (!name || !category) return res.status(400).json({ error: 'name and category are required' });
    const result = await pool.query(
      'INSERT INTO compliance_docs (tenant_id, name, category, file_url, expiry_date, status) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *',
      [t, esc(name), esc(category), file_url ? esc(file_url) : null, expiry_date || null, status || 'active']
    );
    await audit(req.session.user.email, 'compliance_doc_uploaded', 'Uploaded compliance doc: ' + esc(name));
    await enhancedAudit(t, req.session.user.email, 'create', 'compliance_doc', result.rows[0].id, null, JSON.stringify(result.rows[0]), req.ip);

    // Check if doc is expiring soon (within 30 days)
    if (expiry_date) {
      const expDate = new Date(expiry_date);
      const now = new Date();
      const thirtyDaysFromNow = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
      if (expDate <= thirtyDaysFromNow) {
        await pool.query("UPDATE compliance_docs SET status='expiring_soon' WHERE id=$1", [result.rows[0].id]);
      }
      if (expDate <= now) {
        await pool.query("UPDATE compliance_docs SET status='expired' WHERE id=$1", [result.rows[0].id]);
      }
    }

    res.json(result.rows[0]);
  }));

  // PUT /api/compliance-docs/:id — Update a compliance document
  app.put('/api/compliance-docs/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { name, category, file_url, expiry_date, status } = req.body;
    const old = (await pool.query('SELECT * FROM compliance_docs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Compliance document not found' });
    const result = await pool.query(
      'UPDATE compliance_docs SET name=COALESCE($1,name), category=COALESCE($2,category), file_url=COALESCE($3,file_url), expiry_date=COALESCE($4,expiry_date), status=COALESCE($5,status) WHERE id=$6 AND tenant_id=$7 RETURNING *',
      [name ? esc(name) : null, category ? esc(category) : null, file_url ? esc(file_url) : null, expiry_date || null, status || null, req.params.id, t]
    );
    await audit(req.session.user.email, 'compliance_doc_updated', 'Updated compliance doc #' + req.params.id);
    await enhancedAudit(t, req.session.user.email, 'update', 'compliance_doc', parseInt(req.params.id), JSON.stringify(old), JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // DELETE /api/compliance-docs/:id — Delete a compliance document
  app.delete('/api/compliance-docs/:id', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const old = (await pool.query('SELECT * FROM compliance_docs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!old) return res.status(404).json({ error: 'Compliance document not found' });
    await pool.query('DELETE FROM compliance_docs WHERE id=$1 AND tenant_id=$2', [req.params.id, t]);
    await audit(req.session.user.email, 'compliance_doc_deleted', 'Deleted compliance doc #' + req.params.id);
    await enhancedAudit(t, req.session.user.email, 'delete', 'compliance_doc', parseInt(req.params.id), JSON.stringify(old), null, req.ip);
    res.json({ success: true });
  }));

  // GET /api/compliance-docs/:id/reminders — List reminders for a compliance document
  app.get('/api/compliance-docs/:id/reminders', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const doc = (await pool.query('SELECT * FROM compliance_docs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!doc) return res.status(404).json({ error: 'Compliance document not found' });
    const reminders = await pool.query('SELECT * FROM compliance_reminders WHERE doc_id=$1 AND tenant_id=$2 ORDER BY reminder_date', [req.params.id, t]);
    res.json({ doc, reminders: reminders.rows });
  }));

  // POST /api/compliance-docs/:id/reminders — Add a reminder for a compliance document
  app.post('/api/compliance-docs/:id/reminders', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const doc = (await pool.query('SELECT * FROM compliance_docs WHERE id=$1 AND tenant_id=$2', [req.params.id, t])).rows[0];
    if (!doc) return res.status(404).json({ error: 'Compliance document not found' });
    const { reminder_date } = req.body;
    if (!reminder_date) return res.status(400).json({ error: 'reminder_date is required' });
    const result = await pool.query(
      'INSERT INTO compliance_reminders (tenant_id, doc_id, reminder_date, sent) VALUES ($1,$2,$3,$4) RETURNING *',
      [t, parseInt(req.params.id), reminder_date, false]
    );
    await audit(req.session.user.email, 'compliance_reminder_created', 'Created reminder for doc #' + req.params.id);
    res.json(result.rows[0]);
  }));

  // ================================================================
  // FEATURE 14: AUDIT TRAIL PRO
  // ================================================================

  // GET /api/audit-trail-pro — List enhanced audit trail entries
  app.get('/api/audit-trail-pro', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const entity_type = req.query.entity_type;
    const user_email = req.query.user_email;
    const action = req.query.action;
    const date_from = req.query.date_from;
    const date_to = req.query.date_to;
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);

    let query = 'SELECT * FROM enhanced_audit_trail WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;

    if (entity_type) { query += ' AND entity_type=$' + idx; params.push(entity_type); idx++; }
    if (user_email) { query += ' AND user_email=$' + idx; params.push(user_email); idx++; }
    if (action) { query += ' AND action=$' + idx; params.push(action); idx++; }
    if (date_from) { query += ' AND created_at >= $' + idx; params.push(date_from); idx++; }
    if (date_to) { query += ' AND created_at <= $' + idx; params.push(date_to); idx++; }

    query += ' ORDER BY created_at DESC LIMIT $' + idx;
    params.push(limit);

    const result = await pool.query(query, params);
    res.json(result.rows);
  }));

  // POST /api/audit-trail-pro/report — Generate an audit report
  app.post('/api/audit-trail-pro/report', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { report_type, date_range_start, date_range_end } = req.body;
    if (!report_type || !date_range_start || !date_range_end) return res.status(400).json({ error: 'report_type, date_range_start, and date_range_end are required' });

    // Gather audit data for the report
    const entries = await pool.query(
      'SELECT * FROM enhanced_audit_trail WHERE tenant_id=$1 AND created_at >= $2 AND created_at <= $3 ORDER BY created_at',
      [t, date_range_start, date_range_end]
    );

    // Build findings summary
    const actionCounts = {};
    const entityCounts = {};
    const userCounts = {};
    for (const entry of entries.rows) {
      actionCounts[entry.action] = (actionCounts[entry.action] || 0) + 1;
      entityCounts[entry.entity_type] = (entityCounts[entry.entity_type] || 0) + 1;
      userCounts[entry.user_email] = (userCounts[entry.user_email] || 0) + 1;
    }

    const findings = {
      total_entries: entries.rows.length,
      action_breakdown: actionCounts,
      entity_breakdown: entityCounts,
      user_breakdown: userCounts,
      date_range: { start: date_range_start, end: date_range_end },
      generated_by: req.session.user.email
    };

    const result = await pool.query(
      'INSERT INTO audit_reports_ult4 (tenant_id, report_type, date_range_start, date_range_end, findings_json, generated_at) VALUES ($1,$2,$3,$4,$5,NOW()) RETURNING *',
      [t, esc(report_type), date_range_start, date_range_end, JSON.stringify(findings)]
    );

    await audit(req.session.user.email, 'audit_report_generated', 'Generated ' + report_type + ' audit report');
    res.json({ report: result.rows[0], findings });
  }));

  // ================================================================
  // FEATURE 15: FUND BALANCE CALCULATOR
  // ================================================================

  // GET /api/fund-balances — List fund balances
  app.get('/api/fund-balances', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const period_start = req.query.period_start;
    const period_end = req.query.period_end;
    let query = 'SELECT * FROM fund_balances WHERE tenant_id=$1';
    const params = [t];
    let idx = 2;
    if (period_start) { query += ' AND period_start >= $' + idx; params.push(period_start); idx++; }
    if (period_end) { query += ' AND period_end <= $' + idx; params.push(period_end); idx++; }
    query += ' ORDER BY fund_name ASC, period_start DESC';
    const result = await pool.query(query, params);
    res.json(result.rows);
  }));

  // POST /api/fund-balances — Create a fund balance record
  app.post('/api/fund-balances', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { fund_name, category, beginning_balance, additions, deductions, period_start, period_end } = req.body;
    if (!fund_name || !period_start || !period_end) return res.status(400).json({ error: 'fund_name, period_start, and period_end are required' });
    const begBal = parseFloat(beginning_balance) || 0;
    const adds = parseFloat(additions) || 0;
    const deds = parseFloat(deductions) || 0;
    const endBal = begBal + adds - deds;
    const result = await pool.query(
      'INSERT INTO fund_balances (tenant_id, fund_name, category, beginning_balance, additions, deductions, ending_balance, period_start, period_end, calculated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *',
      [t, esc(fund_name), category ? esc(category) : null, begBal, adds, deds, endBal, period_start, period_end]
    );
    await audit(req.session.user.email, 'fund_balance_created', 'Created fund balance for: ' + esc(fund_name));
    await enhancedAudit(t, req.session.user.email, 'create', 'fund_balance', result.rows[0].id, null, JSON.stringify(result.rows[0]), req.ip);
    res.json(result.rows[0]);
  }));

  // POST /api/fund-balances/recalculate — Recalculate all fund balances
  app.post('/api/fund-balances/recalculate', requireAuth, ah(async (req, res) => {
    const t = req.session.user.tenant_id;
    const { period_start, period_end } = req.body;
    if (!period_start || !period_end) return res.status(400).json({ error: 'period_start and period_end are required' });

    // Gather data from fund categories, endowment transactions, and currency wallets
    const categories = await pool.query('SELECT * FROM fund_categories WHERE tenant_id=$1', [t]);
    const endowments = await pool.query('SELECT * FROM endowments WHERE tenant_id=$1', [t]);
    const wallets = await pool.query('SELECT * FROM currency_wallets WHERE tenant_id=$1', [t]);

    const recalculated = [];

    // Calculate from fund categories and their assignments
    for (const cat of categories.rows) {
      const assignments = await pool.query(
        'SELECT COALESCE(SUM(amount),0) as total FROM fund_category_assignments WHERE category_id=$1 AND tenant_id=$2',
        [cat.id, t]
      );
      const total = parseFloat(assignments.rows[0].total) || 0;
      // Check if there's already a balance for this period
      const existing = (await pool.query(
        'SELECT * FROM fund_balances WHERE tenant_id=$1 AND fund_name=$2 AND period_start=$3 AND period_end=$4',
        [t, cat.name, period_start, period_end]
      )).rows[0];

      if (existing) {
        const endBal = parseFloat(existing.beginning_balance) + total - parseFloat(existing.deductions);
        const r = await pool.query(
          'UPDATE fund_balances SET additions=$1, ending_balance=$2, calculated_at=NOW() WHERE id=$3 RETURNING *',
          [total, endBal, existing.id]
        );
        recalculated.push(r.rows[0]);
      } else {
        const r = await pool.query(
          'INSERT INTO fund_balances (tenant_id, fund_name, category, beginning_balance, additions, deductions, ending_balance, period_start, period_end, calculated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *',
          [t, cat.name, cat.description || cat.name, 0, total, 0, total, period_start, period_end]
        );
        recalculated.push(r.rows[0]);
      }
    }

    // Add endowment balances
    for (const endo of endowments.rows) {
      const txns = await pool.query(
        "SELECT transaction_type, COALESCE(SUM(amount),0) as total FROM endowment_transactions WHERE endowment_id=$1 AND tenant_id=$2 AND date >= $3 AND date <= $4 GROUP BY transaction_type",
        [endo.id, t, period_start, period_end]
      );
      let contributions = 0, withdrawals = 0, investmentReturns = 0, spending = 0;
      for (const txn of txns.rows) {
        const total = parseFloat(txn.total) || 0;
        if (txn.transaction_type === 'contribution') contributions = total;
        else if (txn.transaction_type === 'withdrawal') withdrawals = total;
        else if (txn.transaction_type === 'investment_return') investmentReturns = total;
        else if (txn.transaction_type === 'spending') spending = total;
      }
      const additions = contributions + investmentReturns;
      const deductions = withdrawals + spending;
      const begBal = parseFloat(endo.principal_amount);
      const endBal = begBal + additions - deductions;

      const existing = (await pool.query(
        'SELECT * FROM fund_balances WHERE tenant_id=$1 AND fund_name=$2 AND period_start=$3 AND period_end=$4',
        [t, 'Endowment: ' + endo.name, period_start, period_end]
      )).rows[0];

      if (existing) {
        const r = await pool.query(
          'UPDATE fund_balances SET beginning_balance=$1, additions=$2, deductions=$3, ending_balance=$4, calculated_at=NOW() WHERE id=$5 RETURNING *',
          [begBal, additions, deductions, endBal, existing.id]
        );
        recalculated.push(r.rows[0]);
      } else {
        const r = await pool.query(
          'INSERT INTO fund_balances (tenant_id, fund_name, category, beginning_balance, additions, deductions, ending_balance, period_start, period_end, calculated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *',
          [t, 'Endowment: ' + endo.name, 'endowment', begBal, additions, deductions, endBal, period_start, period_end]
        );
        recalculated.push(r.rows[0]);
      }
    }

    // Add wallet balances
    for (const wallet of wallets.rows) {
      const existing = (await pool.query(
        'SELECT * FROM fund_balances WHERE tenant_id=$1 AND fund_name=$2 AND period_start=$3 AND period_end=$4',
        [t, 'Wallet: ' + wallet.currency, period_start, period_end]
      )).rows[0];

      const currentBal = parseFloat(wallet.balance);
      if (existing) {
        const r = await pool.query(
          'UPDATE fund_balances SET ending_balance=$1, calculated_at=NOW() WHERE id=$2 RETURNING *',
          [currentBal, existing.id]
        );
        recalculated.push(r.rows[0]);
      } else {
        const r = await pool.query(
          'INSERT INTO fund_balances (tenant_id, fund_name, category, beginning_balance, additions, deductions, ending_balance, period_start, period_end, calculated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW()) RETURNING *',
          [t, 'Wallet: ' + wallet.currency, 'wallet', 0, currentBal, 0, currentBal, period_start, period_end]
        );
        recalculated.push(r.rows[0]);
      }
    }

    await audit(req.session.user.email, 'fund_balances_recalculated', 'Recalculated fund balances for period ' + period_start + ' to ' + period_end);
    res.json({ success: true, recalculated_count: recalculated.length, balances: recalculated });
  }));

};
