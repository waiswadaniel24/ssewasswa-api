/**
 * Fundraising Ultimate4 Module — Financial, Compliance & Legal Suite
 * Features: Fund Allocation, Budget Tracking, Reconciliation, Grant Management,
 * Endowment, Multi-Currency Wallet, Receipt Batches, Donation Splits,
 * Fund Categories, Anonymity Manager, Payment Router, Financial Dashboard Pro,
 * Compliance Vault, Audit Trail Pro, Fund Balance Calculator
 */
module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, notify, sendEmail, sendSMS) {
  const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';

  const migrations = [
    // Feature 1: Fund Allocation Manager
    `CREATE TABLE IF NOT EXISTS fund_allocations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, fund_name TEXT NOT NULL, fund_type TEXT DEFAULT 'unrestricted' CHECK (fund_type IN ('restricted','unrestricted','temporarily_restricted','endowment')), total_allocated INTEGER DEFAULT 0, total_spent INTEGER DEFAULT 0, total_remaining INTEGER DEFAULT 0, restrictions_json TEXT DEFAULT '{}', manager_email TEXT, status TEXT DEFAULT 'active' CHECK (status IN ('active','closed','archived')), created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS fund_allocation_entries (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, allocation_id INTEGER NOT NULL REFERENCES fund_allocations(id) ON DELETE CASCADE, campaign_id INTEGER, amount INTEGER NOT NULL, entry_type TEXT DEFAULT 'allocation' CHECK (entry_type IN ('allocation','spend','transfer','return')), description TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_fund_alloc_tenant ON fund_allocations(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fund_alloc_entries_alloc ON fund_allocation_entries(allocation_id)`,

    // Feature 2: Budget vs Actual Tracking
    `CREATE TABLE IF NOT EXISTS fundraising_budgets (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, period_start DATE NOT NULL, period_end DATE NOT NULL, total_budget INTEGER DEFAULT 0, total_actual INTEGER DEFAULT 0, status TEXT DEFAULT 'active' CHECK (status IN ('draft','active','closed')), created_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS budget_line_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, budget_id INTEGER NOT NULL REFERENCES fundraising_budgets(id) ON DELETE CASCADE, category TEXT NOT NULL, budgeted_amount INTEGER DEFAULT 0, actual_amount INTEGER DEFAULT 0, variance INTEGER DEFAULT 0, notes TEXT, updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_budgets_tenant ON fundraising_budgets(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_budget_lines_budget ON budget_line_items(budget_id)`,

    // Feature 3: Financial Reconciliation Engine
    `CREATE TABLE IF NOT EXISTS reconciliation_batches (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, batch_name TEXT NOT NULL, period_start DATE, period_end DATE, total_expected INTEGER DEFAULT 0, total_reconciled INTEGER DEFAULT 0, total_unreconciled INTEGER DEFAULT 0, status TEXT DEFAULT 'open' CHECK (status IN ('open','in_progress','completed')), reconciled_by TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS reconciliation_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, batch_id INTEGER NOT NULL REFERENCES reconciliation_batches(id) ON DELETE CASCADE, donation_id INTEGER, expected_amount INTEGER, actual_amount INTEGER, bank_reference TEXT, status TEXT DEFAULT 'unmatched' CHECK (status IN ('matched','unmatched','partial','disputed')), matched_at TIMESTAMPTZ, notes TEXT)`,
    `CREATE INDEX IF NOT EXISTS idx_recon_batches_tenant ON reconciliation_batches(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_recon_items_batch ON reconciliation_items(batch_id)`,

    // Feature 4: Grant Management System
    `CREATE TABLE IF NOT EXISTS grants (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, grant_name TEXT NOT NULL, funder_name TEXT NOT NULL, funder_contact TEXT, amount_requested INTEGER DEFAULT 0, amount_awarded INTEGER DEFAULT 0, application_date DATE, decision_date DATE, start_date DATE, end_date DATE, status TEXT DEFAULT 'drafting' CHECK (status IN ('drafting','submitted','under_review','awarded','rejected','active','completed','cancelled')), restrictions_json TEXT DEFAULT '[]', reporting_requirements_json TEXT DEFAULT '[]', assigned_to TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS grant_reports (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, grant_id INTEGER NOT NULL REFERENCES grants(id) ON DELETE CASCADE, report_type TEXT DEFAULT 'progress' CHECK (report_type IN ('progress','financial','final','interim')), period_start DATE, period_end DATE, amount_spent INTEGER DEFAULT 0, narrative_text TEXT, submitted_at TIMESTAMPTZ, status TEXT DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','revision_requested')))`,
    `CREATE INDEX IF NOT EXISTS idx_grants_tenant ON grants(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_grant_reports_grant ON grant_reports(grant_id)`,

    // Feature 5: Endowment Management
    `CREATE TABLE IF NOT EXISTS endowments (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, principal_amount INTEGER DEFAULT 0, current_value INTEGER DEFAULT 0, annual_return_rate NUMERIC DEFAULT 0, spending_rate NUMERIC DEFAULT 0.05, purpose TEXT, restrictions TEXT, manager_email TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS endowment_transactions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, endowment_id INTEGER NOT NULL REFERENCES endowments(id) ON DELETE CASCADE, transaction_type TEXT NOT NULL CHECK (transaction_type IN ('contribution','return','spending','rebalance','fee')), amount INTEGER NOT NULL, description TEXT, transaction_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_endowments_tenant ON endowments(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_endowment_tx_endow ON endowment_transactions(endowment_id)`,

    // Feature 6: Multi-Currency Wallet
    `CREATE TABLE IF NOT EXISTS currency_wallets (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, currency_code TEXT NOT NULL DEFAULT 'UGX', balance INTEGER DEFAULT 0, held_amount INTEGER DEFAULT 0, available_amount INTEGER DEFAULT 0, exchange_rate_to_base NUMERIC DEFAULT 1.0, last_updated TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, currency_code))`,
    `CREATE TABLE IF NOT EXISTS currency_transactions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, wallet_id INTEGER REFERENCES currency_wallets(id), transaction_type TEXT NOT NULL CHECK (transaction_type IN ('deposit','withdrawal','conversion','fee')), amount INTEGER NOT NULL, from_currency TEXT, to_currency TEXT, exchange_rate NUMERIC, fee INTEGER DEFAULT 0, reference TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_currency_wallets_tenant ON currency_wallets(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_currency_tx_tenant ON currency_transactions(tenant_id)`,

    // Feature 7: Receipt Batch Processing
    `CREATE TABLE IF NOT EXISTS receipt_batches (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, batch_name TEXT NOT NULL, period_start DATE, period_end DATE, receipt_count INTEGER DEFAULT 0, total_amount INTEGER DEFAULT 0, status TEXT DEFAULT 'pending' CHECK (status IN ('pending','generated','sent','completed')), generated_by TEXT, generated_at TIMESTAMPTZ)`,
    `CREATE TABLE IF NOT EXISTS receipt_batch_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, batch_id INTEGER NOT NULL REFERENCES receipt_batches(id) ON DELETE CASCADE, donation_id INTEGER, donor_email TEXT, donor_name TEXT, amount INTEGER, receipt_number TEXT, sent BOOLEAN DEFAULT false, sent_at TIMESTAMPTZ)`,
    `CREATE INDEX IF NOT EXISTS idx_receipt_batches_tenant ON receipt_batches(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_receipt_items_batch ON receipt_batch_items(batch_id)`,

    // Feature 8: Donation Split Manager
    `CREATE TABLE IF NOT EXISTS donation_splits (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donation_id INTEGER, split_config_json TEXT DEFAULT '{}', total_amount INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS donation_split_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, split_id INTEGER NOT NULL REFERENCES donation_splits(id) ON DELETE CASCADE, campaign_id INTEGER, fund_id INTEGER, amount INTEGER NOT NULL, percentage NUMERIC DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_donation_splits_tenant ON donation_splits(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_split_items_split ON donation_split_items(split_id)`,

    // Feature 9: Fund Category Management
    `CREATE TABLE IF NOT EXISTS fund_categories (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT, category_type TEXT DEFAULT 'operating' CHECK (category_type IN ('operating','program','admin','capital','emergency')), parent_id INTEGER REFERENCES fund_categories(id), is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS fund_category_assignments (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, category_id INTEGER NOT NULL REFERENCES fund_categories(id) ON DELETE CASCADE, campaign_id INTEGER NOT NULL, assigned_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_fund_cats_tenant ON fund_categories(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fund_cat_assign_cat ON fund_category_assignments(category_id)`,

    // Feature 10: Donation Anonymity Manager
    `CREATE TABLE IF NOT EXISTS donation_anonymity_settings (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, allow_anonymous BOOLEAN DEFAULT true, allow_pseudonym BOOLEAN DEFAULT true, default_setting TEXT DEFAULT 'named' CHECK (default_setting IN ('named','anonymous','pseudonym')), display_format TEXT DEFAULT 'first_initial', updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS anonymous_donations (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donation_id INTEGER, display_name TEXT, is_anonymous BOOLEAN DEFAULT false, reveal_to_org BOOLEAN DEFAULT false, message TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_anon_settings_tenant ON donation_anonymity_settings(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_anon_donations_tenant ON anonymous_donations(tenant_id)`,

    // Feature 11: Payment Method Router
    `CREATE TABLE IF NOT EXISTS payment_routing_rules (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, name TEXT NOT NULL, priority INTEGER DEFAULT 0, conditions_json TEXT DEFAULT '{}', target_method TEXT NOT NULL, target_provider TEXT, is_active BOOLEAN DEFAULT true, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS payment_routing_log (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, donation_id INTEGER, routed_to TEXT, rule_id INTEGER, original_method TEXT, routing_reason TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_pay_routes_tenant ON payment_routing_rules(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pay_route_log_tenant ON payment_routing_log(tenant_id)`,

    // Feature 12: Financial Dashboard Pro
    `CREATE TABLE IF NOT EXISTS financial_dashboard_config (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE UNIQUE, widgets_json TEXT DEFAULT '[]', layout_json TEXT DEFAULT '{}', refresh_interval INTEGER DEFAULT 300, updated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS financial_snapshots (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, total_revenue INTEGER DEFAULT 0, total_expenses INTEGER DEFAULT 0, net_position INTEGER DEFAULT 0, donation_count INTEGER DEFAULT 0, avg_donation INTEGER DEFAULT 0, period_start DATE, period_end DATE, calculated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_fin_dash_tenant ON financial_dashboard_config(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_fin_snapshots_tenant ON financial_snapshots(tenant_id)`,

    // Feature 13: Compliance Document Vault
    `CREATE TABLE IF NOT EXISTS compliance_docs (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, document_type TEXT NOT NULL CHECK (document_type IN ('certificate','license','registration','audit','policy','report','agreement','other')), title TEXT NOT NULL, file_url TEXT, expiry_date DATE, issuing_authority TEXT, status TEXT DEFAULT 'active' CHECK (status IN ('active','expired','pending_renewal','archived')), reviewed_by TEXT, reviewed_at TIMESTAMPTZ, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS compliance_reminders (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, document_id INTEGER NOT NULL REFERENCES compliance_docs(id) ON DELETE CASCADE, reminder_date DATE NOT NULL, sent BOOLEAN DEFAULT false, sent_at TIMESTAMPTZ)`,
    `CREATE INDEX IF NOT EXISTS idx_compliance_docs_tenant ON compliance_docs(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_compliance_reminders_doc ON compliance_reminders(document_id)`,

    // Feature 14: Audit Trail Pro
    `CREATE TABLE IF NOT EXISTS enhanced_audit_trail (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT, action TEXT NOT NULL, entity_type TEXT, entity_id INTEGER, old_values_json TEXT, new_values_json TEXT, ip_address TEXT, user_agent TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE TABLE IF NOT EXISTS audit_reports (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, report_name TEXT NOT NULL, filters_json TEXT DEFAULT '{}', generated_by TEXT, generated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_enhanced_audit_tenant ON enhanced_audit_trail(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_enhanced_audit_entity ON enhanced_audit_trail(entity_type, entity_id)`,
    `CREATE INDEX IF NOT EXISTS idx_audit_reports_tenant ON audit_reports(tenant_id)`,

    // Feature 15: Fund Balance Calculator
    `CREATE TABLE IF NOT EXISTS fund_balances (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, fund_name TEXT NOT NULL, fund_type TEXT DEFAULT 'unrestricted', opening_balance INTEGER DEFAULT 0, total_inflows INTEGER DEFAULT 0, total_outflows INTEGER DEFAULT 0, closing_balance INTEGER DEFAULT 0, period_start DATE, period_end DATE, calculated_at TIMESTAMPTZ DEFAULT NOW())`,
    `CREATE INDEX IF NOT EXISTS idx_fund_balances_tenant ON fund_balances(tenant_id)`,

    // Seed default fund categories
    `INSERT INTO fund_categories (tenant_id, name, description, category_type) SELECT t.id, 'General Operations', 'Day-to-day operational expenses', 'operating' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM fund_categories WHERE tenant_id=t.id AND name='General Operations')`,
    `INSERT INTO fund_categories (tenant_id, name, description, category_type) SELECT t.id, 'Program Funds', 'Funds for specific programs and projects', 'program' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM fund_categories WHERE tenant_id=t.id AND name='Program Funds')`,
    `INSERT INTO fund_categories (tenant_id, name, description, category_type) SELECT t.id, 'Emergency Reserve', 'Funds reserved for emergencies', 'emergency' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM fund_categories WHERE tenant_id=t.id AND name='Emergency Reserve')`,
    `INSERT INTO fund_categories (tenant_id, name, description, category_type) SELECT t.id, 'Capital Projects', 'Funds for capital improvements and assets', 'capital' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM fund_categories WHERE tenant_id=t.id AND name='Capital Projects')`,

    // Seed default anonymity settings
    `INSERT INTO donation_anonymity_settings (tenant_id, allow_anonymous, allow_pseudonym, default_setting) SELECT t.id, true, true, 'named' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM donation_anonymity_settings WHERE tenant_id=t.id)`,

    // Seed default currency wallets
    `INSERT INTO currency_wallets (tenant_id, currency_code, balance, exchange_rate_to_base) SELECT t.id, 'UGX', 0, 1.0 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM currency_wallets WHERE tenant_id=t.id AND currency_code='UGX')`,
    `INSERT INTO currency_wallets (tenant_id, currency_code, balance, exchange_rate_to_base) SELECT t.id, 'USD', 0, 3800 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM currency_wallets WHERE tenant_id=t.id AND currency_code='USD')`,
    `INSERT INTO currency_wallets (tenant_id, currency_code, balance, exchange_rate_to_base) SELECT t.id, 'KES', 0, 28 FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM currency_wallets WHERE tenant_id=t.id AND currency_code='KES')`,

    // Seed default payment routing rules
    `INSERT INTO payment_routing_rules (tenant_id, name, priority, conditions_json, target_method, target_provider) SELECT t.id, 'Default Mobile Money', 1, '{"amount_max":5000000}', 'mobile_money', 'auto' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM payment_routing_rules WHERE tenant_id=t.id AND name='Default Mobile Money')`,
    `INSERT INTO payment_routing_rules (tenant_id, name, priority, conditions_json, target_method, target_provider) SELECT t.id, 'Large Amount Bank Transfer', 2, '{"amount_min":5000000}', 'bank_transfer', 'default' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM payment_routing_rules WHERE tenant_id=t.id AND name='Large Amount Bank Transfer')`,

    // Seed default financial dashboard config
    `INSERT INTO financial_dashboard_config (tenant_id, widgets_json, layout_json) SELECT t.id, '["revenue","expenses","net_position","donation_count","avg_donation"]', '{"columns":2}' FROM tenants t WHERE NOT EXISTS (SELECT 1 FROM financial_dashboard_config WHERE tenant_id=t.id)`,
  ];

  (async () => {
    for (const q of migrations) {
      try { await pool.query(q); } catch(e) {}
    }
    console.log('[FundraisingUltimate4] Migrations complete — 15 features');
  })();

  // =============================================
  // FEATURE 1: FUND ALLOCATION MANAGER
  // =============================================
  app.get('/api/fund-allocations', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM fund_allocations WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/fund-allocations', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { fund_name, fund_type, total_allocated, restrictions_json, manager_email } = req.body;
    if (!fund_name) return res.status(400).json({ error: 'fund_name required' });
    const r = await pool.query(`INSERT INTO fund_allocations (tenant_id, fund_name, fund_type, total_allocated, total_remaining, restrictions_json, manager_email) VALUES ($1,$2,$3,$4,$4,$5,$6) RETURNING *`, [tid, esc(fund_name), fund_type||'unrestricted', total_allocated||0, JSON.stringify(restrictions_json||{}), manager_email||null]);
    await audit(req, 'create', 'fund_allocations', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/fund-allocations/:id', requireAuth, ah(async (req, res) => {
    const { fund_name, fund_type, total_allocated, status } = req.body;
    const r = await pool.query(`UPDATE fund_allocations SET fund_name=COALESCE($1,fund_name), fund_type=COALESCE($2,fund_type), total_allocated=COALESCE($3,total_allocated), total_remaining=total_allocated-total_spent, status=COALESCE($4,status) WHERE tenant_id=$5 AND id=$6 RETURNING *`, [fund_name?esc(fund_name):null, fund_type, total_allocated, status, req.session.user.tenant_id, req.params.id]);
    await audit(req, 'update', 'fund_allocations', req.params.id);
    res.json(r.rows[0]);
  }));

  app.delete('/api/fund-allocations/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM fund_allocations WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    await audit(req, 'delete', 'fund_allocations', req.params.id);
    res.json({ ok: true });
  }));

  app.post('/api/fund-allocations/:id/allocate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { campaign_id, amount, entry_type, description } = req.body;
    if (!amount) return res.status(400).json({ error: 'amount required' });
    const fund = await pool.query(`SELECT * FROM fund_allocations WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!fund.rows.length) return res.status(404).json({ error: 'Fund not found' });
    const r = await pool.query(`INSERT INTO fund_allocation_entries (tenant_id, allocation_id, campaign_id, amount, entry_type, description) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, req.params.id, campaign_id||null, amount, entry_type||'allocation', esc(description||'')]);
    if (entry_type === 'spend') {
      await pool.query(`UPDATE fund_allocations SET total_spent=total_spent+$1, total_remaining=total_allocated-total_spent-$1 WHERE id=$2`, [amount, req.params.id]);
    }
    await audit(req, 'allocate', 'fund_allocation_entries', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/fund-allocations/:id/balance', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT *, (total_allocated - total_spent) as calculated_remaining FROM fund_allocations WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0] || {});
  }));

  app.get('/api/fund-allocations/summary', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT fund_type, COUNT(*) as count, SUM(total_allocated) as total_allocated, SUM(total_spent) as total_spent, SUM(total_remaining) as total_remaining FROM fund_allocations WHERE tenant_id=$1 GROUP BY fund_type`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 2: BUDGET VS ACTUAL TRACKING
  // =============================================
  app.get('/api/fundraising-budgets', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT b.*, COUNT(bl.id) as line_item_count FROM fundraising_budgets b LEFT JOIN budget_line_items bl ON b.id=bl.budget_id WHERE b.tenant_id=$1 GROUP BY b.id ORDER BY b.created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/fundraising-budgets', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, period_start, period_end, total_budget } = req.body;
    if (!name || !period_start) return res.status(400).json({ error: 'name and period_start required' });
    const r = await pool.query(`INSERT INTO fundraising_budgets (tenant_id, name, period_start, period_end, total_budget, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, esc(name), period_start, period_end||null, total_budget||0, req.session.user.email]);
    await audit(req, 'create', 'fundraising_budgets', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/fundraising-budgets/:id/line-items', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { category, budgeted_amount, notes } = req.body;
    if (!category) return res.status(400).json({ error: 'category required' });
    const r = await pool.query(`INSERT INTO budget_line_items (tenant_id, budget_id, category, budgeted_amount, notes) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [tid, req.params.id, esc(category), budgeted_amount||0, esc(notes||'')]);
    await audit(req, 'create', 'budget_line_items', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/fundraising-budgets/:id/variance', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT *, (budgeted_amount - actual_amount) as variance FROM budget_line_items WHERE tenant_id=$1 AND budget_id=$2 ORDER BY category`, [req.session.user.tenant_id, req.params.id]);
    const totals = await pool.query(`SELECT SUM(budgeted_amount) as total_budget, SUM(actual_amount) as total_actual FROM budget_line_items WHERE tenant_id=$1 AND budget_id=$2`, [req.session.user.tenant_id, req.params.id]);
    res.json({ line_items: r.rows, totals: totals.rows[0] });
  }));

  app.post('/api/fundraising-budgets/:id/actuals', requireAuth, ah(async (req, res) => {
    const { line_item_id, actual_amount } = req.body;
    const r = await pool.query(`UPDATE budget_line_items SET actual_amount=$1, variance=budgeted_amount-$1, updated_at=NOW() WHERE tenant_id=$2 AND budget_id=$3 AND id=$4 RETURNING *`, [actual_amount||0, req.session.user.tenant_id, req.params.id, line_item_id]);
    await pool.query(`UPDATE fundraising_budgets SET total_actual=(SELECT SUM(actual_amount) FROM budget_line_items WHERE budget_id=$1) WHERE id=$1`, [req.params.id]);
    res.json(r.rows[0]);
  }));

  // =============================================
  // FEATURE 3: FINANCIAL RECONCILIATION
  // =============================================
  app.get('/api/reconciliation', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM reconciliation_batches WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/reconciliation', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { batch_name, period_start, period_end, total_expected } = req.body;
    if (!batch_name) return res.status(400).json({ error: 'batch_name required' });
    const r = await pool.query(`INSERT INTO reconciliation_batches (tenant_id, batch_name, period_start, period_end, total_expected, total_unreconciled, reconciled_by) VALUES ($1,$2,$3,$4,$5,$5,$6) RETURNING *`, [tid, esc(batch_name), period_start||null, period_end||null, total_expected||0, req.session.user.email]);
    await audit(req, 'create', 'reconciliation_batches', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/reconciliation/:id/match', requireAuth, ah(async (req, res) => {
    const { donation_id, actual_amount, bank_reference, notes } = req.body;
    const r = await pool.query(`INSERT INTO reconciliation_items (tenant_id, batch_id, donation_id, expected_amount, actual_amount, bank_reference, status, matched_at, notes) VALUES ($1,$2,$3,$4,$5,$6,'matched',NOW(),$7) RETURNING *`, [req.session.user.tenant_id, req.params.id, donation_id||null, req.body.expected_amount||0, actual_amount||0, esc(bank_reference||''), esc(notes||'')]);
    await pool.query(`UPDATE reconciliation_batches SET total_reconciled=total_reconciled+COALESCE($1,0), total_unreconciled=total_expected-total_reconciled-COALESCE($1,0) WHERE id=$2`, [actual_amount||0, req.params.id]);
    res.json(r.rows[0]);
  }));

  app.post('/api/reconciliation/:id/auto-match', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const batch = await pool.query(`SELECT * FROM reconciliation_batches WHERE tenant_id=$1 AND id=$2`, [tid, req.params.id]);
    if (!batch.rows.length) return res.status(404).json({ error: 'Batch not found' });
    const unmatched = await pool.query(`SELECT d.id, d.amount, d.donor_email FROM donations d LEFT JOIN reconciliation_items ri ON d.id=ri.donation_id AND ri.batch_id=$1 WHERE d.tenant_id=$2 AND d.created_at BETWEEN $3 AND $4 AND ri.id IS NULL`, [req.params.id, tid, batch.rows[0].period_start||'2000-01-01', batch.rows[0].period_end||'2099-12-31']);
    let matched = 0;
    for (const d of unmatched.rows) {
      await pool.query(`INSERT INTO reconciliation_items (tenant_id, batch_id, donation_id, expected_amount, actual_amount, status, matched_at) VALUES ($1,$2,$3,$4,$4,'matched',NOW())`, [tid, req.params.id, d.id, d.amount]);
      matched++;
    }
    await pool.query(`UPDATE reconciliation_batches SET total_reconciled=(SELECT COALESCE(SUM(actual_amount),0) FROM reconciliation_items WHERE batch_id=$1 AND status='matched'), total_unreconciled=total_expected-(SELECT COALESCE(SUM(actual_amount),0) FROM reconciliation_items WHERE batch_id=$1 AND status='matched') WHERE id=$1`, [req.params.id]);
    res.json({ matched, total_unmatched: unmatched.rows.length });
  }));

  app.get('/api/reconciliation/:id/report', requireAuth, ah(async (req, res) => {
    const batch = await pool.query(`SELECT * FROM reconciliation_batches WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    const items = await pool.query(`SELECT * FROM reconciliation_items WHERE tenant_id=$1 AND batch_id=$2`, [req.session.user.tenant_id, req.params.id]);
    res.json({ batch: batch.rows[0], items: items.rows });
  }));

  // =============================================
  // FEATURE 4: GRANT MANAGEMENT
  // =============================================
  app.get('/api/grants', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM grants WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/grants', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { grant_name, funder_name, funder_contact, amount_requested, application_date, start_date, end_date, restrictions_json, reporting_requirements_json, assigned_to } = req.body;
    if (!grant_name || !funder_name) return res.status(400).json({ error: 'grant_name and funder_name required' });
    const r = await pool.query(`INSERT INTO grants (tenant_id, grant_name, funder_name, funder_contact, amount_requested, application_date, start_date, end_date, restrictions_json, reporting_requirements_json, assigned_to) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`, [tid, esc(grant_name), esc(funder_name), esc(funder_contact||''), amount_requested||0, application_date||null, start_date||null, end_date||null, JSON.stringify(restrictions_json||[]), JSON.stringify(reporting_requirements_json||[]), assigned_to||null]);
    await audit(req, 'create', 'grants', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/grants/:id', requireAuth, ah(async (req, res) => {
    const { status, amount_awarded, decision_date } = req.body;
    const r = await pool.query(`UPDATE grants SET status=COALESCE($1,status), amount_awarded=COALESCE($2,amount_awarded), decision_date=COALESCE($3,decision_date) WHERE tenant_id=$4 AND id=$5 RETURNING *`, [status, amount_awarded, decision_date, req.session.user.tenant_id, req.params.id]);
    await audit(req, 'update', 'grants', req.params.id);
    res.json(r.rows[0]);
  }));

  app.post('/api/grants/:id/submit-report', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { report_type, period_start, period_end, amount_spent, narrative_text } = req.body;
    const r = await pool.query(`INSERT INTO grant_reports (tenant_id, grant_id, report_type, period_start, period_end, amount_spent, narrative_text, submitted_at, status) VALUES ($1,$2,$3,$4,$5,$6,$7,NOW(),'submitted') RETURNING *`, [tid, req.params.id, report_type||'progress', period_start||null, period_end||null, amount_spent||0, esc(narrative_text||'')]);
    await audit(req, 'create', 'grant_reports', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/grants/:id/reports', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM grant_reports WHERE tenant_id=$1 AND grant_id=$2 ORDER BY submitted_at DESC`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  app.get('/api/grants/upcoming-deadlines', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM grants WHERE tenant_id=$1 AND status IN ('active','awarded') AND end_date <= CURRENT_DATE + INTERVAL '90 days' ORDER BY end_date`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 5: ENDOWMENT MANAGEMENT
  // =============================================
  app.get('/api/endowments', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM endowments WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/endowments', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, principal_amount, annual_return_rate, spending_rate, purpose, restrictions, manager_email } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO endowments (tenant_id, name, principal_amount, current_value, annual_return_rate, spending_rate, purpose, restrictions, manager_email) VALUES ($1,$2,$3,$3,$4,$5,$6,$7,$8) RETURNING *`, [tid, esc(name), principal_amount||0, annual_return_rate||0, spending_rate||0.05, esc(purpose||''), esc(restrictions||''), manager_email||null]);
    await audit(req, 'create', 'endowments', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/endowments/:id/transaction', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { transaction_type, amount, description, transaction_date } = req.body;
    if (!transaction_type || !amount) return res.status(400).json({ error: 'transaction_type and amount required' });
    const r = await pool.query(`INSERT INTO endowment_transactions (tenant_id, endowment_id, transaction_type, amount, description, transaction_date) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [tid, req.params.id, transaction_type, amount, esc(description||''), transaction_date||'CURRENT_DATE']);
    if (transaction_type === 'contribution' || transaction_type === 'return') {
      await pool.query(`UPDATE endowments SET current_value=current_value+$1 WHERE id=$2`, [amount, req.params.id]);
    } else if (transaction_type === 'spending' || transaction_type === 'fee') {
      await pool.query(`UPDATE endowments SET current_value=GREATEST(0, current_value-$1) WHERE id=$2`, [amount, req.params.id]);
    }
    await audit(req, 'create', 'endowment_transactions', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/endowments/:id/performance', requireAuth, ah(async (req, res) => {
    const endow = await pool.query(`SELECT * FROM endowments WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    const txs = await pool.query(`SELECT transaction_type, SUM(amount) as total FROM endowment_transactions WHERE tenant_id=$1 AND endowment_id=$2 GROUP BY transaction_type`, [req.session.user.tenant_id, req.params.id]);
    const e = endow.rows[0] || {};
    const returns = (txs.rows.find(t=>t.transaction_type==='return')?.total || 0);
    const roi = e.principal_amount > 0 ? (returns / e.principal_amount * 100).toFixed(2) : 0;
    res.json({ ...e, transactions: txs.rows, total_returns: returns, roi_percentage: roi });
  }));

  // =============================================
  // FEATURE 6: MULTI-CURRENCY WALLET
  // =============================================
  app.get('/api/currency-wallets', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM currency_wallets WHERE tenant_id=$1 ORDER BY currency_code`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/currency-wallets/convert', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { from_currency, to_currency, amount } = req.body;
    if (!from_currency || !to_currency || !amount) return res.status(400).json({ error: 'from_currency, to_currency, and amount required' });
    const fromW = await pool.query(`SELECT * FROM currency_wallets WHERE tenant_id=$1 AND currency_code=$2`, [tid, from_currency]);
    const toW = await pool.query(`SELECT * FROM currency_wallets WHERE tenant_id=$1 AND currency_code=$2`, [tid, to_currency]);
    if (!fromW.rows.length || !toW.rows.length) return res.status(404).json({ error: 'Wallet not found' });
    if (fromW.rows[0].available_amount < amount) return res.status(400).json({ error: 'Insufficient balance' });
    const converted = Math.round(amount * fromW.rows[0].exchange_rate_to_base / toW.rows[0].exchange_rate_to_base);
    const fee = Math.round(converted * 0.01);
    await pool.query(`UPDATE currency_wallets SET balance=balance-$1, available_amount=available_amount-$1, last_updated=NOW() WHERE tenant_id=$2 AND currency_code=$3`, [amount, tid, from_currency]);
    await pool.query(`UPDATE currency_wallets SET balance=balance+$1, available_amount=available_amount+$1, last_updated=NOW() WHERE tenant_id=$2 AND currency_code=$3`, [converted - fee, tid, to_currency]);
    await pool.query(`INSERT INTO currency_transactions (tenant_id, wallet_id, transaction_type, amount, from_currency, to_currency, exchange_rate, fee) VALUES ($1,$2,'conversion',$3,$4,$5,$6,$7)`, [tid, toW.rows[0].id, converted, from_currency, to_currency, fromW.rows[0].exchange_rate_to_base / toW.rows[0].exchange_rate_to_base, fee]);
    res.json({ converted, fee, net_received: converted - fee });
  }));

  app.get('/api/currency-wallets/:code/transactions', requireAuth, ah(async (req, res) => {
    const w = await pool.query(`SELECT id FROM currency_wallets WHERE tenant_id=$1 AND currency_code=$2`, [req.session.user.tenant_id, req.params.code]);
    if (!w.rows.length) return res.json([]);
    const r = await pool.query(`SELECT * FROM currency_transactions WHERE tenant_id=$1 AND wallet_id=$2 ORDER BY created_at DESC LIMIT 50`, [req.session.user.tenant_id, w.rows[0].id]);
    res.json(r.rows);
  }));

  app.post('/api/currency-wallets/exchange-rates', requireAuth, ah(async (req, res) => {
    const { rates } = req.body; // { USD: 3800, KES: 28, ... }
    if (!rates) return res.status(400).json({ error: 'rates object required' });
    for (const [code, rate] of Object.entries(rates)) {
      await pool.query(`UPDATE currency_wallets SET exchange_rate_to_base=$1, last_updated=NOW() WHERE tenant_id=$2 AND currency_code=$3`, [rate, req.session.user.tenant_id, code]);
    }
    res.json({ ok: true, updated: Object.keys(rates).length });
  }));

  // =============================================
  // FEATURE 7: RECEIPT BATCH PROCESSING
  // =============================================
  app.post('/api/receipt-batches/generate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { batch_name, period_start, period_end } = req.body;
    const donations = await pool.query(`SELECT d.id, d.donor_email, d.donor_name, d.amount FROM donations d LEFT JOIN receipt_batch_items rbi ON d.id=rbi.donation_id WHERE d.tenant_id=$1 AND d.created_at BETWEEN $2 AND $3 AND rbi.id IS NULL`, [tid, period_start||'2000-01-01', period_end||'2099-12-31']);
    if (!donations.rows.length) return res.json({ message: 'No unreceipted donations found', count: 0 });
    const batch = await pool.query(`INSERT INTO receipt_batches (tenant_id, batch_name, period_start, period_end, receipt_count, total_amount, status, generated_by, generated_at) VALUES ($1,$2,$3,$4,$5,$6,'generated',$7,NOW()) RETURNING *`, [tid, esc(batch_name||'Batch '+new Date().toISOString().split('T')[0]), period_start||null, period_end||null, donations.rows.length, donations.rows.reduce((s,d)=>s+parseInt(d.amount||0),0), req.session.user.email]);
    for (const d of donations.rows) {
      const receiptNum = `RCP-${tid}-${d.id}-${Date.now()}`;
      await pool.query(`INSERT INTO receipt_batch_items (tenant_id, batch_id, donation_id, donor_email, donor_name, amount, receipt_number) VALUES ($1,$2,$3,$4,$5,$6,$7)`, [tid, batch.rows[0].id, d.id, d.donor_email, d.donor_name, d.amount, receiptNum]);
    }
    await audit(req, 'create', 'receipt_batches', batch.rows[0].id);
    res.json(batch.rows[0]);
  }));

  app.get('/api/receipt-batches', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM receipt_batches WHERE tenant_id=$1 ORDER BY generated_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/receipt-batches/:id/send', requireAuth, ah(async (req, res) => {
    const items = await pool.query(`SELECT * FROM receipt_batch_items WHERE tenant_id=$1 AND batch_id=$2 AND sent=false`, [req.session.user.tenant_id, req.params.id]);
    let sent = 0;
    for (const item of items.rows) {
      try { await sendEmail(item.donor_email, 'Donation Receipt', `Receipt #${item.receipt_number}: UGX ${item.amount}`); } catch(e){}
      await pool.query(`UPDATE receipt_batch_items SET sent=true, sent_at=NOW() WHERE id=$1`, [item.id]);
      sent++;
    }
    await pool.query(`UPDATE receipt_batches SET status='sent' WHERE id=$1 AND (SELECT COUNT(*) FROM receipt_batch_items WHERE batch_id=$1 AND sent=true) = (SELECT COUNT(*) FROM receipt_batch_items WHERE batch_id=$1)`, [req.params.id]);
    res.json({ sent, total: items.rows.length });
  }));

  app.get('/api/receipt-batches/:id/items', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM receipt_batch_items WHERE tenant_id=$1 AND batch_id=$2 ORDER BY donor_name`, [req.session.user.tenant_id, req.params.id]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 8: DONATION SPLIT MANAGER
  // =============================================
  app.post('/api/donation-splits', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { donation_id, split_config, items } = req.body;
    if (!items || !items.length) return res.status(400).json({ error: 'items array required' });
    const total = items.reduce((s,i)=>s+parseInt(i.amount||0),0);
    const r = await pool.query(`INSERT INTO donation_splits (tenant_id, donation_id, split_config_json, total_amount) VALUES ($1,$2,$3,$4) RETURNING *`, [tid, donation_id||null, JSON.stringify(split_config||{}), total]);
    for (const item of items) {
      await pool.query(`INSERT INTO donation_split_items (tenant_id, split_id, campaign_id, fund_id, amount, percentage) VALUES ($1,$2,$3,$4,$5,$6)`, [tid, r.rows[0].id, item.campaign_id||null, item.fund_id||null, item.amount, total>0?Math.round(item.amount/total*10000)/100:0]);
    }
    await audit(req, 'create', 'donation_splits', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.get('/api/donation-splits/:donationId', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT ds.*, json_agg(json_build_object('campaign_id',dsi.campaign_id,'fund_id',dsi.fund_id,'amount',dsi.amount,'percentage',dsi.percentage)) as items FROM donation_splits ds LEFT JOIN donation_split_items dsi ON ds.id=dsi.split_id WHERE ds.tenant_id=$1 AND ds.donation_id=$2 GROUP BY ds.id`, [req.session.user.tenant_id, req.params.donationId]);
    res.json(r.rows);
  }));

  app.get('/api/donation-splits/campaign/:campaignId', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT dsi.*, ds.donation_id, ds.total_amount FROM donation_split_items dsi JOIN donation_splits ds ON dsi.split_id=ds.id WHERE dsi.tenant_id=$1 AND dsi.campaign_id=$2`, [req.session.user.tenant_id, req.params.campaignId]);
    res.json(r.rows);
  }));

  // =============================================
  // FEATURE 9: FUND CATEGORIES
  // =============================================
  app.get('/api/fund-categories', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT fc.*, (SELECT COUNT(*) FROM fund_category_assignments WHERE category_id=fc.id) as campaign_count FROM fund_categories fc WHERE fc.tenant_id=$1 ORDER BY fc.category_type, fc.name`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/fund-categories', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, description, category_type, parent_id } = req.body;
    if (!name) return res.status(400).json({ error: 'name required' });
    const r = await pool.query(`INSERT INTO fund_categories (tenant_id, name, description, category_type, parent_id) VALUES ($1,$2,$3,$4,$5) RETURNING *`, [tid, esc(name), esc(description||''), category_type||'operating', parent_id||null]);
    await audit(req, 'create', 'fund_categories', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.put('/api/fund-categories/:id', requireAuth, ah(async (req, res) => {
    const { name, description, category_type, is_active } = req.body;
    const r = await pool.query(`UPDATE fund_categories SET name=COALESCE($1,name), description=COALESCE($2,description), category_type=COALESCE($3,category_type), is_active=COALESCE($4,is_active) WHERE tenant_id=$5 AND id=$6 RETURNING *`, [name?esc(name):null, description?esc(description):null, category_type, is_active, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));

  app.delete('/api/fund-categories/:id', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM fund_categories WHERE tenant_id=$1 AND id=$2`, [req.session.user.tenant_id, req.params.id]);
    res.json({ ok: true });
  }));

  app.post('/api/fund-categories/:id/assign/:campaignId', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`INSERT INTO fund_category_assignments (tenant_id, category_id, campaign_id) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *`, [req.session.user.tenant_id, req.params.id, req.params.campaignId]);
    res.json(r.rows[0] || { ok: true });
  }));

  app.delete('/api/fund-categories/:id/unassign/:campaignId', requireAuth, ah(async (req, res) => {
    await pool.query(`DELETE FROM fund_category_assignments WHERE tenant_id=$1 AND category_id=$2 AND campaign_id=$3`, [req.session.user.tenant_id, req.params.id, req.params.campaignId]);
    res.json({ ok: true });
  }));

  app.get('/api/fund-categories/tree', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM fund_categories WHERE tenant_id=$1 AND is_active=true ORDER BY category_type, name`, [req.session.user.tenant_id]);
    const tree = r.rows.filter(c=>!c.parent_id).map(p => ({ ...p, children: r.rows.filter(c => c.parent_id === p.id) }));
    res.json(tree);
  }));

  // =============================================
  // FEATURES 10-15: Simplified CRUD routes
  // =============================================

  // Feature 10: Donation Anonymity
  app.get('/api/donation-anonymity/settings', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM donation_anonymity_settings WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json(r.rows[0] || { allow_anonymous: true, allow_pseudonym: true, default_setting: 'named', display_format: 'first_initial' });
  }));

  app.put('/api/donation-anonymity/settings', requireAuth, ah(async (req, res) => {
    const { allow_anonymous, allow_pseudonym, default_setting, display_format } = req.body;
    const r = await pool.query(`INSERT INTO donation_anonymity_settings (tenant_id, allow_anonymous, allow_pseudonym, default_setting, display_format) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (tenant_id) DO UPDATE SET allow_anonymous=$2, allow_pseudonym=$3, default_setting=$4, display_format=$5, updated_at=NOW() RETURNING *`, [req.session.user.tenant_id, allow_anonymous??true, allow_pseudonym??true, default_setting||'named', display_format||'first_initial']);
    res.json(r.rows[0]);
  }));

  app.post('/api/donation-anonymity/set', requireAuth, ah(async (req, res) => {
    const { donation_id, display_name, is_anonymous, reveal_to_org, message } = req.body;
    const r = await pool.query(`INSERT INTO anonymous_donations (tenant_id, donation_id, display_name, is_anonymous, reveal_to_org, message) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, donation_id, esc(display_name||''), is_anonymous||false, reveal_to_org||false, esc(message||'')]);
    res.json(r.rows[0]);
  }));

  app.get('/api/donation-anonymity/stats', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT COUNT(*) as total, COUNT(CASE WHEN is_anonymous THEN 1 END) as anonymous, COUNT(CASE WHEN NOT is_anonymous THEN 1 END) as named FROM anonymous_donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json(r.rows[0]);
  }));

  // Feature 11: Payment Method Router
  app.get('/api/payment-routing', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM payment_routing_rules WHERE tenant_id=$1 ORDER BY priority`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/payment-routing', requireAuth, ah(async (req, res) => {
    const { name, priority, conditions_json, target_method, target_provider } = req.body;
    if (!name || !target_method) return res.status(400).json({ error: 'name and target_method required' });
    const r = await pool.query(`INSERT INTO payment_routing_rules (tenant_id, name, priority, conditions_json, target_method, target_provider) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, esc(name), priority||0, JSON.stringify(conditions_json||{}), esc(target_method), esc(target_provider||'')]);
    res.json(r.rows[0]);
  }));

  app.post('/api/payment-routing/route', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { amount, method, donation_id } = req.body;
    const rules = await pool.query(`SELECT * FROM payment_routing_rules WHERE tenant_id=$1 AND is_active=true ORDER BY priority`, [tid]);
    let routedTo = method || 'mobile_money';
    let ruleId = null;
    let reason = 'No matching rule, using default';
    for (const rule of rules.rows) {
      const conds = JSON.parse(rule.conditions_json || '{}');
      let matches = true;
      if (conds.amount_min && amount < conds.amount_min) matches = false;
      if (conds.amount_max && amount > conds.amount_max) matches = false;
      if (matches) { routedTo = rule.target_method; ruleId = rule.id; reason = `Matched rule: ${rule.name}`; break; }
    }
    await pool.query(`INSERT INTO payment_routing_log (tenant_id, donation_id, routed_to, rule_id, original_method, routing_reason) VALUES ($1,$2,$3,$4,$5,$6)`, [tid, donation_id||null, routedTo, ruleId, method||'', reason]);
    res.json({ routed_to: routedTo, rule_id: ruleId, reason });
  }));

  app.get('/api/payment-routing/log', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM payment_routing_log WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 100`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.get('/api/payment-routing/stats', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT routed_to, COUNT(*) as count FROM payment_routing_log WHERE tenant_id=$1 GROUP BY routed_to`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Feature 12: Financial Dashboard Pro
  app.get('/api/financial-dashboard', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const revenue = await pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM donations WHERE tenant_id=$1`, [tid]);
    const expenses = await pool.query(`SELECT COALESCE(SUM(amount),0) as total FROM fund_allocation_entries WHERE tenant_id=$1 AND entry_type='spend'`, [tid]);
    const donors = await pool.query(`SELECT COUNT(DISTINCT donor_email) as cnt FROM donations WHERE tenant_id=$1`, [tid]);
    const avg = await pool.query(`SELECT COALESCE(AVG(amount),0) as avg FROM donations WHERE tenant_id=$1`, [tid]);
    res.json({ total_revenue: parseInt(revenue.rows[0]?.total||0), total_expenses: parseInt(expenses.rows[0]?.total||0), net_position: parseInt(revenue.rows[0]?.total||0) - parseInt(expenses.rows[0]?.total||0), donor_count: parseInt(donors.rows[0]?.cnt||0), avg_donation: Math.round(parseFloat(avg.rows[0]?.avg||0)) });
  }));

  app.get('/api/financial-dashboard/config', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM financial_dashboard_config WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    res.json(r.rows[0] || { widgets_json: '[]', layout_json: '{}', refresh_interval: 300 });
  }));

  app.put('/api/financial-dashboard/config', requireAuth, ah(async (req, res) => {
    const { widgets_json, layout_json, refresh_interval } = req.body;
    const r = await pool.query(`INSERT INTO financial_dashboard_config (tenant_id, widgets_json, layout_json, refresh_interval) VALUES ($1,$2,$3,$4) ON CONFLICT (tenant_id) DO UPDATE SET widgets_json=$2, layout_json=$3, refresh_interval=$4, updated_at=NOW() RETURNING *`, [req.session.user.tenant_id, JSON.stringify(widgets_json||[]), JSON.stringify(layout_json||{}), refresh_interval||300]);
    res.json(r.rows[0]);
  }));

  app.get('/api/financial-dashboard/snapshots', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM financial_snapshots WHERE tenant_id=$1 ORDER BY calculated_at DESC LIMIT 30`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/financial-dashboard/snapshot', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { period_start, period_end } = req.body;
    const rev = await pool.query(`SELECT COALESCE(SUM(amount),0) as t FROM donations WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3`, [tid, period_start||'2000-01-01', period_end||'2099-12-31']);
    const exp = await pool.query(`SELECT COALESCE(SUM(amount),0) as t FROM fund_allocation_entries WHERE tenant_id=$1 AND entry_type='spend' AND created_at BETWEEN $2 AND $3`, [tid, period_start||'2000-01-01', period_end||'2099-12-31']);
    const cnt = await pool.query(`SELECT COUNT(*) as c FROM donations WHERE tenant_id=$1 AND created_at BETWEEN $2 AND $3`, [tid, period_start||'2000-01-01', period_end||'2099-12-31']);
    const r = await pool.query(`INSERT INTO financial_snapshots (tenant_id, total_revenue, total_expenses, net_position, donation_count, avg_donation, period_start, period_end) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [tid, parseInt(rev.rows[0]?.t||0), parseInt(exp.rows[0]?.t||0), parseInt(rev.rows[0]?.t||0)-parseInt(exp.rows[0]?.t||0), parseInt(cnt.rows[0]?.c||0), cnt.rows[0]?.c>0?Math.round(parseInt(rev.rows[0]?.t||0)/parseInt(cnt.rows[0]?.c||1)):0, period_start, period_end]);
    res.json(r.rows[0]);
  }));

  // Feature 13: Compliance Document Vault
  app.get('/api/compliance-docs', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM compliance_docs WHERE tenant_id=$1 ORDER BY created_at DESC`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/compliance-docs', requireAuth, ah(async (req, res) => {
    const { document_type, title, file_url, expiry_date, issuing_authority } = req.body;
    if (!title || !document_type) return res.status(400).json({ error: 'title and document_type required' });
    const r = await pool.query(`INSERT INTO compliance_docs (tenant_id, document_type, title, file_url, expiry_date, issuing_authority) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`, [req.session.user.tenant_id, document_type, esc(title), esc(file_url||''), expiry_date||null, esc(issuing_authority||'')]);
    await audit(req, 'create', 'compliance_docs', r.rows[0].id);
    res.json(r.rows[0]);
  }));

  app.post('/api/compliance-docs/:id/review', requireAuth, ah(async (req, res) => {
    const { status } = req.body;
    const r = await pool.query(`UPDATE compliance_docs SET reviewed_by=$1, reviewed_at=NOW(), status=COALESCE($2,status) WHERE tenant_id=$3 AND id=$4 RETURNING *`, [req.session.user.email, status, req.session.user.tenant_id, req.params.id]);
    res.json(r.rows[0]);
  }));

  app.get('/api/compliance-docs/expiring', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM compliance_docs WHERE tenant_id=$1 AND expiry_date <= CURRENT_DATE + INTERVAL '30 days' AND status='active' ORDER BY expiry_date`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // Feature 14: Audit Trail Pro
  app.get('/api/audit-trail', requireAuth, ah(async (req, res) => {
    const { entity_type, user_email, limit } = req.query;
    let q = `SELECT * FROM enhanced_audit_trail WHERE tenant_id=$1`;
    const params = [req.session.user.tenant_id];
    let idx = 2;
    if (entity_type) { q += ` AND entity_type=$${idx}`; params.push(entity_type); idx++; }
    if (user_email) { q += ` AND user_email=$${idx}`; params.push(user_email); idx++; }
    q += ` ORDER BY created_at DESC LIMIT $${idx}`;
    params.push(parseInt(limit)||100);
    const r = await pool.query(q, params);
    res.json(r.rows);
  }));

  app.get('/api/audit-trail/entity/:type/:id', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM enhanced_audit_trail WHERE tenant_id=$1 AND entity_type=$2 AND entity_id=$3 ORDER BY created_at DESC`, [req.session.user.tenant_id, req.params.type, req.params.id]);
    res.json(r.rows);
  }));

  app.post('/api/audit-trail/report', requireAuth, ah(async (req, res) => {
    const { report_name, filters } = req.body;
    const r = await pool.query(`INSERT INTO audit_reports (tenant_id, report_name, filters_json, generated_by, generated_at) VALUES ($1,$2,$3,$4,NOW()) RETURNING *`, [req.session.user.tenant_id, esc(report_name||'Audit Report'), JSON.stringify(filters||{}), req.session.user.email]);
    res.json(r.rows[0]);
  }));

  // Feature 15: Fund Balance Calculator
  app.get('/api/fund-balances', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT * FROM fund_balances WHERE tenant_id=$1 ORDER BY fund_name`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  app.post('/api/fund-balances/calculate', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { period_start, period_end } = req.body;
    const allocations = await pool.query(`SELECT fa.fund_name, fa.fund_type, COALESCE(SUM(CASE WHEN fae.entry_type IN ('allocation','return') THEN fae.amount ELSE 0 END),0) as inflows, COALESCE(SUM(CASE WHEN fae.entry_type IN ('spend','fee') THEN fae.amount ELSE 0 END),0) as outflows FROM fund_allocations fa LEFT JOIN fund_allocation_entries fae ON fa.id=fae.allocation_id AND fae.tenant_id=$1 WHERE fa.tenant_id=$1 GROUP BY fa.id, fa.fund_name, fa.fund_type`, [tid]);
    for (const a of allocations.rows) {
      const opening = parseInt(a.inflows) - parseInt(a.outflows);
      await pool.query(`INSERT INTO fund_balances (tenant_id, fund_name, fund_type, opening_balance, total_inflows, total_outflows, closing_balance, period_start, period_end) VALUES ($1,$2,$3,0,$4,$5,$6,$7,$8)`, [tid, a.fund_name, a.fund_type, a.inflows, a.outflows, parseInt(a.inflows)-parseInt(a.outflows), period_start||null, period_end||null]);
    }
    res.json({ calculated: allocations.rows.length, funds: allocations.rows });
  }));

  app.get('/api/fund-balances/summary', requireAuth, ah(async (req, res) => {
    const r = await pool.query(`SELECT fund_type, SUM(opening_balance) as opening, SUM(total_inflows) as inflows, SUM(total_outflows) as outflows, SUM(closing_balance) as closing FROM fund_balances WHERE tenant_id=$1 GROUP BY fund_type`, [req.session.user.tenant_id]);
    res.json(r.rows);
  }));

  // =============================================
  // DASHBOARD PAGES
  // =============================================
  const navLinks = `
    <nav class="bg-white shadow mb-6 p-4 rounded-lg flex flex-wrap gap-2">
      <a href="/fund-allocations" class="px-3 py-1 bg-blue-100 text-blue-800 rounded hover:bg-blue-200">Funds</a>
      <a href="/budget-tracking" class="px-3 py-1 bg-green-100 text-green-800 rounded hover:bg-green-200">Budgets</a>
      <a href="/reconciliation" class="px-3 py-1 bg-yellow-100 text-yellow-800 rounded hover:bg-yellow-200">Reconciliation</a>
      <a href="/grant-management" class="px-3 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200">Grants</a>
      <a href="/endowment-management" class="px-3 py-1 bg-indigo-100 text-indigo-800 rounded hover:bg-indigo-200">Endowments</a>
      <a href="/currency-wallets" class="px-3 py-1 bg-pink-100 text-pink-800 rounded hover:bg-pink-200">Currency</a>
      <a href="/receipt-batches" class="px-3 py-1 bg-red-100 text-red-800 rounded hover:bg-red-200">Receipts</a>
      <a href="/fund-categories" class="px-3 py-1 bg-teal-100 text-teal-800 rounded hover:bg-teal-200">Categories</a>
      <a href="/donation-anonymity" class="px-3 py-1 bg-gray-100 text-gray-800 rounded hover:bg-gray-200">Anonymity</a>
      <a href="/payment-routing" class="px-3 py-1 bg-orange-100 text-orange-800 rounded hover:bg-orange-200">Payment Router</a>
      <a href="/financial-dashboard-pro" class="px-3 py-1 bg-cyan-100 text-cyan-800 rounded hover:bg-cyan-200">Dashboard Pro</a>
      <a href="/compliance-docs" class="px-3 py-1 bg-emerald-100 text-emerald-800 rounded hover:bg-emerald-200">Compliance</a>
      <a href="/audit-trail-pro" class="px-3 py-1 bg-amber-100 text-amber-800 rounded hover:bg-amber-200">Audit Trail</a>
      <a href="/fund-balances" class="px-3 py-1 bg-violet-100 text-violet-800 rounded hover:bg-violet-200">Balances</a>
    </nav>`;

  // Financial Dashboard Pro
  app.get('/financial-dashboard-pro', requireAuth, ah(async (req, res) => {
    const stats = await pool.query(`SELECT COALESCE(SUM(amount),0) as revenue FROM donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const exp = await pool.query(`SELECT COALESCE(SUM(amount),0) as expenses FROM fund_allocation_entries WHERE tenant_id=$1 AND entry_type='spend'`, [req.session.user.tenant_id]);
    const donors = await pool.query(`SELECT COUNT(DISTINCT donor_email) as cnt FROM donations WHERE tenant_id=$1`, [req.session.user.tenant_id]);
    const rev = parseInt(stats.rows[0]?.revenue || 0);
    const expAmt = parseInt(exp.rows[0]?.expenses || 0);
    renderPage(req, res, 'Financial Dashboard Pro', `${navLinks}
      <div class="max-w-6xl mx-auto">
        <h2 class="text-2xl font-bold mb-4">Financial Dashboard Pro</h2>
        <div class="grid grid-cols-4 gap-4 mb-6">
          <div class="bg-green-50 p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-green-600">UGX ${rev.toLocaleString()}</div><div class="text-sm text-gray-600">Total Revenue</div></div>
          <div class="bg-red-50 p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-red-600">UGX ${expAmt.toLocaleString()}</div><div class="text-sm text-gray-600">Total Expenses</div></div>
          <div class="bg-blue-50 p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold ${rev-expAmt>=0?'text-blue-600':'text-red-600'}">UGX ${(rev-expAmt).toLocaleString()}</div><div class="text-sm text-gray-600">Net Position</div></div>
          <div class="bg-purple-50 p-4 rounded-lg shadow text-center"><div class="text-2xl font-bold text-purple-600">${donors.rows[0]?.cnt||0}</div><div class="text-sm text-gray-600">Unique Donors</div></div>
        </div>
      </div>`);
  }));

  // Simplified table dashboards for remaining features
  const simpleDash = (title, path, tableName, cols) => {
    app.get(path, requireAuth, ah(async (req, res) => {
      const r = await pool.query(`SELECT * FROM ${tableName} WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20`, [req.session.user.tenant_id]);
      renderPage(req, res, title, `${navLinks}
        <div class="max-w-6xl mx-auto">
          <h2 class="text-2xl font-bold mb-4">${title}</h2>
          <div class="bg-white rounded-lg shadow overflow-x-auto">
            <table class="w-full text-sm">
              <thead class="bg-gray-50"><tr>${cols.map(c=>`<th class="p-3 text-left">${c}</th>`).join('')}</tr></thead>
              <tbody>${r.rows.map(row=>`<tr class="border-t">${cols.map(c=>`<td class="p-3">${row[c]!==null&&row[c]!==undefined?row[c]:'-'}</td>`).join('')}</tr>`).join('')}</tbody>
            </table>
          </div>
        </div>`);
    }));
  };

  simpleDash('Fund Allocations', '/fund-allocations', 'fund_allocations', ['id','fund_name','fund_type','total_allocated','total_spent','total_remaining','status']);
  simpleDash('Budget Tracking', '/budget-tracking', 'fundraising_budgets', ['id','name','period_start','total_budget','total_actual','status']);
  simpleDash('Reconciliation', '/reconciliation', 'reconciliation_batches', ['id','batch_name','total_expected','total_reconciled','total_unreconciled','status']);
  simpleDash('Grant Management', '/grant-management', 'grants', ['id','grant_name','funder_name','amount_requested','amount_awarded','status']);
  simpleDash('Endowment Management', '/endowment-management', 'endowments', ['id','name','principal_amount','current_value','annual_return_rate']);
  simpleDash('Multi-Currency Wallets', '/currency-wallets', 'currency_wallets', ['id','currency_code','balance','available_amount','exchange_rate_to_base']);
  simpleDash('Receipt Batches', '/receipt-batches', 'receipt_batches', ['id','batch_name','receipt_count','total_amount','status']);
  simpleDash('Fund Categories', '/fund-categories', 'fund_categories', ['id','name','category_type','is_active']);
  simpleDash('Donation Anonymity', '/donation-anonymity', 'anonymous_donations', ['id','donation_id','display_name','is_anonymous','message']);
  simpleDash('Payment Routing', '/payment-routing', 'payment_routing_rules', ['id','name','priority','target_method','target_provider','is_active']);
  simpleDash('Compliance Docs', '/compliance-docs', 'compliance_docs', ['id','document_type','title','expiry_date','status']);
  simpleDash('Audit Trail Pro', '/audit-trail-pro', 'enhanced_audit_trail', ['id','user_email','action','entity_type','entity_id','created_at']);
  simpleDash('Fund Balances', '/fund-balances', 'fund_balances', ['id','fund_name','fund_type','opening_balance','total_inflows','total_outflows','closing_balance']);

  console.log('[FundraisingUltimate4] Loaded — 15 features, 75+ routes');
};
