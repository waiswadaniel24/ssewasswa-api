// ============================================================
// PAYMENT GATEWAY MODULE — SSEWASSWA Comfort Platform
// Multi-method payment collection (MTN MoMo, Airtel, Flutterwave,
// bank, cash), transaction tracking, reconciliation, invoices,
// receipts, and fee calculation for African institutions.
// ============================================================
// Usage in server.js:
//   const paymentGateway = require('./payment-gateway');
//   paymentGateway(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt);
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const formatCurrency = (amt, cur) => (cur || 'UGX') + ' ' + Number(amt || 0).toLocaleString();
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const formatDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';

function generateReference() {
  const ts = Date.now().toString(36).toUpperCase();
  const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
  return 'PAY-' + ts + '-' + rnd;
}

function calculateFee(provider, amount) {
  const a = parseFloat(amount) || 0;
  switch (provider) {
    case 'mtn': return Math.max(500, Math.round(a * 0.01));
    case 'airtel': return Math.max(300, Math.round(a * 0.01));
    case 'flutterwave': return Math.round(a * 0.015);
    case 'stripe': return Math.round(a * 0.015);
    default: return 0;
  }
}

function statusBadge(status) {
  const map = {
    completed: { bg: '#dcfce7', color: '#16a34a', label: 'Completed' },
    pending: { bg: '#fef9c3', color: '#a16207', label: 'Pending' },
    failed: { bg: '#fee2e2', color: '#dc2626', label: 'Failed' },
    expired: { bg: '#f1f5f9', color: '#64748b', label: 'Expired' }
  };
  const s = map[status] || map.pending;
  return `<span style="display:inline-block;padding:3px 12px;border-radius:20px;font-size:11px;font-weight:700;background:${s.bg};color:${s.color}">${s.label}</span>`;
}

function providerIcon(p) {
  const map = { mtn: '📱', airtel: '📱', flutterwave: '💳', stripe: '💳', bank: '🏦', cash: '💵' };
  return map[p] || '💰';
}

function providerLabel(p) {
  const map = { mtn: 'MTN MoMo', airtel: 'Airtel Money', flutterwave: 'Flutterwave (Card)', stripe: 'Stripe (Card)', bank: 'Bank Transfer', cash: 'Cash' };
  return map[p] || p;
}

// Shared styles
const PG_CSS = `<style>
.pg-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px}
.pg-stat{background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:18px;text-align:center;transition:.15s}
.pg-stat:hover{box-shadow:0 2px 12px rgba(0,0,0,.05)}
.pg-stat-val{font-size:26px;font-weight:800;color:#1e293b}
.pg-stat-lbl{font-size:11px;color:#94a3b8;margin-top:4px;text-transform:uppercase;letter-spacing:.3px}
.pg-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 20px;border:none;border-radius:10px;font-size:14px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.pg-btn:hover{opacity:.9;transform:translateY(-1px)}
.pg-btn-primary{background:#4f46e5;color:#fff}
.pg-btn-success{background:#059669;color:#fff}
.pg-btn-danger{background:#fee2e2;color:#dc2626}
.pg-btn-secondary{background:#f1f5f9;color:#475569}
.pg-method-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-bottom:20px}
.pg-method{background:#fff;border:2px solid #e2e8f0;border-radius:14px;padding:20px;text-align:center;cursor:pointer;transition:.2s}
.pg-method:hover{border-color:#6366f1;box-shadow:0 4px 16px rgba(99,102,241,.1)}
.pg-method.selected{border-color:#4f46e5;background:#eef2ff}
.pg-method-icon{font-size:32px;margin-bottom:8px}
.pg-method-name{font-size:14px;font-weight:700;color:#1e293b}
.pg-method-fee{font-size:11px;color:#94a3b8;margin-top:4px}
.pg-table{width:100%;border-collapse:collapse;font-size:13px}
.pg-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
.pg-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.pg-table tr:hover{background:#f8fafc}
.pg-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.pg-filter label{display:block;font-size:12px;font-weight:600;color:#64748b;margin-bottom:4px}
.pg-filter input,.pg-filter select{padding:9px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px;background:#fff}
.pg-filter input:focus,.pg-filter select:focus{outline:none;border-color:#6366f1}
.pg-timer{font-size:48px;font-weight:800;color:#4f46e5;font-variant-numeric:tabular-nums}
.pg-timer-label{font-size:13px;color:#94a3b8;margin-top:4px}
.pg-invoice{max-width:800px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:0;padding:40px;color:#1e293b}
.pg-invoice table{width:100%;border-collapse:collapse;margin:16px 0}
.pg-invoice th,.pg-invoice td{padding:10px 14px;text-align:left;border-bottom:1px solid #e2e8f0;font-size:13px}
.pg-invoice th{background:#f8fafc;font-weight:700;color:#475569;font-size:12px}
.pg-invoice-total{font-size:20px;font-weight:800;text-align:right;padding:16px 14px;border-top:2px solid #1e293b}
.pg-nav{display:flex;gap:6px;margin-bottom:20px;flex-wrap:wrap}
.pg-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.pg-nav a:hover{background:#e2e8f0}
.pg-nav a.active{background:#4f46e5;color:#fff}
.pg-discrepancy{background:#fff7ed;border-left:4px solid #f59e0b;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px}
.pg-matched{background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;border-radius:0 8px 8px 0;margin-bottom:8px;font-size:13px}
@media print{.pg-no-print{display:none!important}.pg-invoice{border:none;padding:20px}}
@media(max-width:768px){.pg-stats{grid-template-columns:1fr 1fr}.pg-filter{flex-direction:column}.pg-method-cards{grid-template-columns:1fr 1fr}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function paymentGateway(app, pool, requireAuth, logger, audit, notify, ah, esc, renderPage, bcrypt) {

  if (!esc) esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m]));
  if (!ah) ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // ============================================================
  // 1. DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS payment_methods (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      method_type VARCHAR(20) NOT NULL DEFAULT 'mobile_money', provider VARCHAR(50) NOT NULL,
      phone_number VARCHAR(20), account_name VARCHAR(255), account_number VARCHAR(100),
      is_default BOOLEAN DEFAULT false, is_active BOOLEAN DEFAULT true,
      config JSONB DEFAULT '{}', created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS payment_requests (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      reference VARCHAR(50) UNIQUE NOT NULL, amount NUMERIC(12,2) NOT NULL,
      currency VARCHAR(10) DEFAULT 'UGX', payer_name VARCHAR(255), payer_phone VARCHAR(20),
      payer_email VARCHAR(255), description TEXT, status VARCHAR(20) DEFAULT 'pending',
      method_id INTEGER REFERENCES payment_methods(id) ON DELETE SET NULL,
      provider_response JSONB DEFAULT '{}', paid_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ DEFAULT (NOW() + INTERVAL '30 minutes'),
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE TABLE IF NOT EXISTS payment_transactions (
      id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      payment_request_id INTEGER NOT NULL REFERENCES payment_requests(id) ON DELETE CASCADE,
      transaction_ref VARCHAR(100), amount NUMERIC(12,2) NOT NULL,
      fee NUMERIC(10,2) DEFAULT 0, net_amount NUMERIC(10,2) DEFAULT 0,
      status VARCHAR(20) DEFAULT 'completed', provider VARCHAR(50),
      provider_ref VARCHAR(200), metadata JSONB DEFAULT '{}',
      created_at TIMESTAMPTZ DEFAULT NOW()
    )`,
    `CREATE INDEX IF NOT EXISTS idx_pmethods_tenant ON payment_methods(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_pmethods_active ON payment_methods(tenant_id, is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_prequests_tenant ON payment_requests(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_prequests_ref ON payment_requests(reference)`,
    `CREATE INDEX IF NOT EXISTS idx_prequests_status ON payment_requests(tenant_id, status)`,
    `CREATE INDEX IF NOT EXISTS idx_ptransactions_tenant ON payment_transactions(tenant_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ptransactions_req ON payment_transactions(payment_request_id)`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { logger.warn('[PaymentGateway] Cannot connect to DB'); return; }
    try { for (const sql of migrations) await client.query(sql); logger.info({ msg: '[PaymentGateway] Migrations applied', count: migrations.length }); }
    catch (e) { logger.error({ msg: '[PaymentGateway] Migration error', error: e.message }); }
    finally { client.release(); }
  })();

  // ============================================================
  // ROUTE 1: GET /payments — Payment Dashboard
  // ============================================================
  app.get('/payments', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const today = (await pool.query(
      `SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM payment_requests WHERE tenant_id=$1 AND status='completed' AND paid_at >= date_trunc('day', NOW())`, [tid]
    )).rows[0];
    const month = (await pool.query(
      `SELECT COALESCE(SUM(amount),0) as total, COUNT(*) as cnt FROM payment_requests WHERE tenant_id=$1 AND status='completed' AND paid_at >= date_trunc('month', NOW())`, [tid]
    )).rows[0];
    const pending = (await pool.query(
      `SELECT COUNT(*) as cnt, COALESCE(SUM(amount),0) as total FROM payment_requests WHERE tenant_id=$1 AND status='pending' AND expires_at > NOW()`, [tid]
    )).rows[0];
    const rateRow = (await pool.query(
      `SELECT ROUND(COUNT(*) FILTER (WHERE status='completed')::numeric / NULLIF(COUNT(*),0) * 100, 1) as rate FROM payment_requests WHERE tenant_id=$1 AND created_at >= date_trunc('month', NOW())`, [tid]
    )).rows[0];
    const recent = (await pool.query(
      `SELECT pr.*, pm.provider as method_provider FROM payment_requests pr LEFT JOIN payment_methods pm ON pm.id=pr.method_id WHERE pr.tenant_id=$1 ORDER BY pr.created_at DESC LIMIT 15`, [tid]
    )).rows;

    const tableRows = recent.map(r => `<tr>
      <td style="font-weight:600;font-family:monospace;font-size:12px"><a href="/payments/collect/${esc(r.reference)}" style="color:#4f46e5;text-decoration:none">${esc(r.reference)}</a></td>
      <td>${formatCurrency(r.amount, r.currency)}</td>
      <td>${esc(r.payer_name || '—')}</td>
      <td>${providerIcon(r.method_provider || 'cash')} ${esc(providerLabel(r.method_provider || 'cash'))}</td>
      <td>${statusBadge(r.status)}</td>
      <td style="color:#94a3b8;font-size:12px">${formatDateTime(r.created_at)}</td>
    </tr>`).join('');

    const navHtml = `<div class="pg-nav">
      <a href="/payments" class="active">📊 Dashboard</a>
      <a href="/payments/collect">💳 Collect</a>
      <a href="/payments/transactions">📋 Transactions</a>
      <a href="/payments/methods">⚙ Methods</a>
      <a href="/payments/reconcile">🔍 Reconcile</a>
    </div>`;

    const html = PG_CSS + `
    <div style="max-width:1200px;margin:0 auto">
      ${navHtml}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">💰 Payment Gateway</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Collect, track, and reconcile payments</p></div>
        <a href="/payments/collect" class="pg-btn pg-btn-primary">💳 Collect Payment</a>
      </div>
      <div class="pg-stats">
        <div class="pg-stat"><div class="pg-stat-val" style="color:#059669">${formatCurrency(today.total, 'UGX')}</div><div class="pg-stat-lbl">Today's Collections</div></div>
        <div class="pg-stat"><div class="pg-stat-val" style="color:#4f46e5">${formatCurrency(month.total, 'UGX')}</div><div class="pg-stat-lbl">This Month</div></div>
        <div class="pg-stat"><div class="pg-stat-val" style="color:#f59e0b">${pending.cnt}</div><div class="pg-stat-lbl">Pending (${formatCurrency(pending.total, 'UGX')})</div></div>
        <div class="pg-stat"><div class="pg-stat-val" style="color:${parseFloat(rateRow.rate||0)>=70?'#059669':'#f59e0b'}">${rateRow.rate || 0}%</div><div class="pg-stat-lbl">Success Rate</div></div>
      </div>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
          <h3 style="margin:0;font-size:16px;color:#1e293b">Recent Payments</h3>
          <a href="/payments/transactions" style="font-size:13px;color:#4f46e5;text-decoration:none">View All →</a>
        </div>
        <div style="overflow-x:auto"><table class="pg-table">
          <thead><tr><th>Reference</th><th>Amount</th><th>Payer</th><th>Method</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>${tableRows || '<tr><td colspan="6" style="text-align:center;color:#94a3b8;padding:30px">No payments yet. Start by collecting a payment.</td></tr>'}</tbody>
        </table></div>
      </div>
    </div>`;
    res.send(renderPage('Payment Dashboard', html, user));
  }));

  // ============================================================
  // ROUTE 2: GET /payments/collect — Payment Collection Form
  // ============================================================
  app.get('/payments/collect', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const methods = (await pool.query(
      `SELECT * FROM payment_methods WHERE tenant_id=$1 AND is_active=true ORDER BY is_default DESC, provider`, [tid]
    )).rows;

    const methodCards = [
      { provider: 'mtn', type: 'mobile_money', icon: '📱', name: 'MTN MoMo', fee: '1% (min UGX 500)' },
      { provider: 'airtel', type: 'mobile_money', icon: '📱', name: 'Airtel Money', fee: '1% (min UGX 300)' },
      { provider: 'flutterwave', type: 'card', icon: '💳', name: 'Flutterwave', fee: '1.5%' },
      { provider: 'bank', type: 'bank', icon: '🏦', name: 'Bank Transfer', fee: 'Free' },
      { provider: 'cash', type: 'cash', icon: '💵', name: 'Cash', fee: 'Free' }
    ];

    const savedMethods = methods.length > 0 ? `<div style="margin-bottom:16px"><h3 style="font-size:14px;font-weight:600;color:#475569;margin-bottom:8px">Your Saved Methods</h3>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${methods.map(m => `<span style="background:#eef2ff;color:#4f46e5;padding:6px 14px;border-radius:8px;font-size:13px;font-weight:600">${providerIcon(m.provider)} ${esc(providerLabel(m.provider))}</span>`).join('')}</div>
    </div>` : '';

    const navHtml = `<div class="pg-nav">
      <a href="/payments">📊 Dashboard</a><a href="/payments/collect" class="active">💳 Collect</a>
      <a href="/payments/transactions">📋 Transactions</a><a href="/payments/methods">⚙ Methods</a><a href="/payments/reconcile">🔍 Reconcile</a>
    </div>`;

    const html = PG_CSS + `
    <div style="max-width:800px;margin:0 auto">
      ${navHtml}
      <a href="/payments" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="card" style="padding:24px">
        <h2 style="margin-bottom:4px;color:#1e293b">💳 Collect Payment</h2>
        <p style="font-size:13px;color:#94a3b8;margin-bottom:20px">Select a payment method and enter payer details</p>
        ${savedMethods}
        <form method="POST" action="/payments/collect/initiate" style="display:flex;flex-direction:column;gap:18px">
          <div>
            <label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:8px">Payment Method *</label>
            <div class="pg-method-cards">
              ${methodCards.map(m => `<label class="pg-method" onclick="document.querySelectorAll('.pg-method').forEach(e=>e.classList.remove('selected'));this.classList.add('selected');document.getElementById('provider-input').value='${m.provider}'">
                <input type="radio" name="provider" value="${m.provider}" required style="display:none" ${m.provider==='mtn'?'checked':''}>
                <div class="pg-method-icon">${m.icon}</div>
                <div class="pg-method-name">${esc(m.name)}</div>
                <div class="pg-method-fee">${esc(m.fee)}</div>
              </label>`).join('')}
            </div>
            <input type="hidden" id="provider-input" name="provider" value="mtn">
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Amount (UGX) *</label>
              <input type="number" name="amount" required min="100" step="100" placeholder="50000" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:15px;font-weight:600"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Description</label>
              <input type="text" name="description" placeholder="e.g., School fees - Term 1" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Payer Name *</label>
              <input type="text" name="payer_name" required placeholder="John Mukasa" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Payer Phone</label>
              <input type="tel" name="payer_phone" placeholder="0771234567" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
            <div><label style="font-size:13px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Payer Email</label>
              <input type="email" name="payer_email" placeholder="payer@email.com" style="width:100%;padding:10px 14px;border:2px solid #e2e8f0;border-radius:10px;font-size:14px"></div>
          </div>
          <div style="display:flex;align-items:center;gap:16px;padding:14px;background:#f8fafc;border-radius:10px;font-size:13px;color:#475569">
            <span>💰 Fee:</span><span id="fee-display" style="font-weight:700;color:#1e293b">UGX 500 (1%)</span>
            <span style="margin-left:auto">Net:</span><span id="net-display" style="font-weight:700;color:#059669">UGX 49,500</span>
          </div>
          <button type="submit" class="pg-btn pg-btn-primary" style="padding:14px 28px;font-size:16px;justify-content:center">🚀 Initiate Payment</button>
        </form>
      </div>
    </div>
    <script>
      document.querySelectorAll('input[name=amount]').forEach(i=>i.addEventListener('input',updateFee));
      document.querySelectorAll('input[name=provider]').forEach(i=>i.addEventListener('change',updateFee));
      function updateFee(){const a=parseFloat(document.querySelector('input[name=amount]').value)||0;const p=document.getElementById('provider-input').value;
        let fee=0;if(p==='mtn')fee=Math.max(500,Math.round(a*0.01));else if(p==='airtel')fee=Math.max(300,Math.round(a*0.01));else if(p==='flutterwave'||p==='stripe')fee=Math.round(a*0.015);
        const pct=(p==='mtn'||p==='airtel')?'1%':(p==='flutterwave'||p==='stripe')?'1.5%':'0%';
        document.getElementById('fee-display').textContent='UGX '+fee.toLocaleString()+' ('+pct+')';
        document.getElementById('net-display').textContent='UGX '+(a-fee).toLocaleString()}
    </script>`;
    res.send(renderPage('Collect Payment', html, user));
  }));

  // ============================================================
  // ROUTE 3: POST /payments/collect/initiate — Initiate Payment
  // ============================================================
  app.post('/payments/collect/initiate', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { amount, provider, payer_name, payer_phone, payer_email, description } = req.body;
    if (!amount || parseFloat(amount) < 100) {
      return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><p style="color:#dc2626;font-size:16px">Invalid amount. Minimum is UGX 100.</p><a href="/payments/collect" class="pg-btn pg-btn-primary" style="margin-top:16px">← Try Again</a></div>', user));
    }
    const amt = parseFloat(amount);
    const fee = calculateFee(provider, amt);
    const ref = generateReference();
    const method = (await pool.query('SELECT id FROM payment_methods WHERE tenant_id=$1 AND provider=$2 AND is_active=true LIMIT 1', [tid, provider])).rows[0];

    const result = await pool.query(
      `INSERT INTO payment_requests (tenant_id, reference, amount, currency, payer_name, payer_phone, payer_email, description, method_id, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW() + INTERVAL '30 minutes') RETURNING id, reference`,
      [tid, ref, amt, 'UGX', (payer_name || '').trim(), (payer_phone || '').trim(), (payer_email || '').trim(), (description || '').trim(), method ? method.id : null]
    );
    audit(user.email, 'payment_initiated', `Payment ${ref} for UGX ${amt.toLocaleString()} via ${provider}`);
    logger.info({ msg: '[PaymentGateway] Payment initiated', ref, amount: amt, provider, by: user.email });
    res.redirect('/payments/collect/' + result.rows[0].reference);
  }));

  // ============================================================
  // ROUTE 4: GET /payments/collect/:ref — Payment Status Page
  // ============================================================
  app.get('/payments/collect/:ref', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, ref = req.params.ref;
    const pr = (await pool.query(
      `SELECT pr.*, pm.provider, pm.phone_number as merchant_phone FROM payment_requests pr LEFT JOIN payment_methods pm ON pm.id=pr.method_id WHERE pr.reference=$1 AND pr.tenant_id=$2`, [ref, tid]
    )).rows[0];
    if (!pr) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Payment not found</h2><a href="/payments" class="pg-btn pg-btn-primary" style="margin-top:12px">← Dashboard</a></div>', user));

    const fee = calculateFee(pr.provider, pr.amount);
    const provider = pr.provider || 'cash';
    const isPending = pr.status === 'pending';
    const isCompleted = pr.status === 'completed';
    const instructions = {
      mtn: `<div style="text-align:center;padding:20px;background:#fef9c3;border-radius:12px"><div style="font-size:36px;margin-bottom:8px">📱</div><p style="font-weight:700;color:#1e293b;font-size:16px">Dial *165# on MTN</p><p style="color:#64748b;font-size:13px;margin-top:4px">Select "Pay Bill" → Enter Business Number → Amount: ${formatCurrency(pr.amount)}</p></div>`,
      airtel: `<div style="text-align:center;padding:20px;background:#fef9c3;border-radius:12px"><div style="font-size:36px;margin-bottom:8px">📱</div><p style="font-weight:700;color:#1e293b;font-size:16px">Dial *185# on Airtel</p><p style="color:#64748b;font-size:13px;margin-top:4px">Select "Pay Bill" → Enter Business Number → Amount: ${formatCurrency(pr.amount)}</p></div>`,
      flutterwave: `<div style="text-align:center;padding:20px;background:#ede9fe;border-radius:12px"><div style="font-size:36px;margin-bottom:8px">💳</div><p style="font-weight:700;color:#1e293b;font-size:16px">Card Payment via Flutterwave</p><p style="color:#64748b;font-size:13px;margin-top:4px">Enter card details on the secure payment popup</p></div>`,
      bank: `<div style="text-align:center;padding:20px;background:#eef2ff;border-radius:12px"><div style="font-size:36px;margin-bottom:8px">🏦</div><p style="font-weight:700;color:#1e293b;font-size:16px">Bank Transfer</p><p style="color:#64748b;font-size:13px;margin-top:4px">Transfer ${formatCurrency(pr.amount)} to the institution bank account</p></div>`,
      cash: `<div style="text-align:center;padding:20px;background:#f0fdf4;border-radius:12px"><div style="font-size:36px;margin-bottom:8px">💵</div><p style="font-weight:700;color:#1e293b;font-size:16px">Cash Payment</p><p style="color:#64748b;font-size:13px;margin-top:4px">Collect cash from ${esc(pr.payer_name || 'payer')} and confirm below</p></div>`
    };

    const html = PG_CSS + `
    <div style="max-width:600px;margin:0 auto">
      <a href="/payments" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Dashboard</a>
      <div class="card" style="padding:24px;text-align:center">
        <div style="font-size:48px;margin-bottom:8px">${isCompleted ? '✅' : isPending ? '⏳' : '❌'}</div>
        <h2 style="color:#1e293b;margin:0">${isCompleted ? 'Payment Completed!' : isPending ? 'Awaiting Payment' : 'Payment ' + pr.status.charAt(0).toUpperCase() + pr.status.slice(1)}</h2>
        <div style="font-family:monospace;font-size:14px;color:#64748b;margin-top:8px;background:#f8fafc;display:inline-block;padding:6px 16px;border-radius:8px">${esc(pr.reference)}</div>
        <div style="margin-top:20px;padding:20px;background:#f8fafc;border-radius:12px;text-align:left;font-size:14px">
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="color:#64748b">Amount</span><span style="font-weight:700">${formatCurrency(pr.amount, pr.currency)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="color:#64748b">Fee (${providerLabel(provider)})</span><span style="font-weight:600">${formatCurrency(fee)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="color:#64748b">Net Amount</span><span style="font-weight:700;color:#059669">${formatCurrency(pr.amount - fee)}</span></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="color:#64748b">Payer</span><span>${esc(pr.payer_name || '—')}</span></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0;border-bottom:1px solid #e2e8f0"><span style="color:#64748b">Method</span><span>${providerIcon(provider)} ${esc(providerLabel(provider))}</span></div>
          <div style="display:flex;justify-content:space-between;padding:8px 0"><span style="color:#64748b">Status</span><span>${statusBadge(pr.status)}</span></div>
        </div>
        ${pr.description ? `<p style="font-size:13px;color:#64748b;margin-top:12px">📝 ${esc(pr.description)}</p>` : ''}
        ${isPending ? `
          <div style="margin-top:20px">${instructions[provider] || instructions.cash}</div>
          <div style="margin-top:16px">
            <div class="pg-timer" id="countdown">--:--</div>
            <div class="pg-timer-label">Time remaining</div>
          </div>
          <form method="POST" action="/payments/verify/${esc(pr.reference)}" style="margin-top:20px" onsubmit="return confirm('Confirm this payment as received?')">
            <button type="submit" class="pg-btn pg-btn-success" style="padding:14px 32px;font-size:15px">✅ Mark as Paid (Demo)</button>
          </form>
          <p style="font-size:11px;color:#94a3b8;margin-top:8px">In production, payment is verified automatically via provider API</p>
        ` : ''}
        ${isCompleted ? `
          <div style="margin-top:20px;display:flex;gap:10px;justify-content:center">
            <a href="/payments/receipt/${esc(pr.reference)}" class="pg-btn pg-btn-secondary">🧾 View Receipt</a>
            <a href="/payments/invoice/${esc(pr.reference)}" class="pg-btn pg-btn-secondary">📄 View Invoice</a>
            <a href="/payments" class="pg-btn pg-btn-primary">💰 New Payment</a>
          </div>` : ''}
      </div>
    </div>
    ${isPending ? `<script>
      function startCountdown(){const exp=new Date('${new Date(pr.expires_at).toISOString()}');const iv=setInterval(()=>{const now=new Date();const diff=Math.max(0,exp-now);if(diff<=0){clearInterval(iv);document.getElementById('countdown').textContent='EXPIRED';document.getElementById('countdown').style.color='#dc2626';return}
      const m=Math.floor(diff/60000);const s=Math.floor((diff%60000)/1000);document.getElementById('countdown').textContent=String(m).padStart(2,'0')+':'+String(s).padStart(2,'0')},1000)}
      startCountdown();setTimeout(()=>location.reload(),60000);
    </script>` : ''}
    ${isPending ? '<meta http-equiv="refresh" content="30">' : ''}`;
    res.send(renderPage('Payment — ' + ref, html, user));
  }));

  // ============================================================
  // ROUTE 5: POST /payments/verify/:ref — Verify / Confirm Payment
  // ============================================================
  app.post('/payments/verify/:ref', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, ref = req.params.ref;
    const pr = (await pool.query(
      `SELECT pr.*, pm.provider FROM payment_requests pr LEFT JOIN payment_methods pm ON pm.id=pr.method_id WHERE pr.reference=$1 AND pr.tenant_id=$2 AND pr.status='pending'`, [ref, tid]
    )).rows[0];
    if (!pr) return res.send(renderPage('Error', '<div class="card" style="text-align:center;padding:40px"><p style="color:#dc2626">Payment not found or already processed.</p><a href="/payments" class="pg-btn pg-btn-primary" style="margin-top:12px">← Dashboard</a></div>', user));

    const provider = pr.provider || 'cash';
    const fee = calculateFee(provider, pr.amount);
    const net = pr.amount - fee;
    const txRef = 'TXN-' + Date.now().toString(36).toUpperCase();

    await pool.query(`UPDATE payment_requests SET status='completed', paid_at=NOW(), provider_response=$1 WHERE id=$2`,
      [{ verified_by: user.email, simulated: true, verified_at: new Date().toISOString() }, pr.id]);
    await pool.query(
      `INSERT INTO payment_transactions (tenant_id, payment_request_id, transaction_ref, amount, fee, net_amount, status, provider, provider_ref, metadata) VALUES ($1,$2,$3,$4,$5,$6,'completed',$7,$8,$9)`,
      [tid, pr.id, txRef, pr.amount, fee, net, provider, 'DEMO-' + txRef, { payer_name: pr.payer_name, payer_phone: pr.payer_phone }]
    );

    audit(user.email, 'payment_completed', `Payment ${ref} completed: ${formatCurrency(pr.amount)} via ${provider}`);
    logger.info({ msg: '[PaymentGateway] Payment verified', ref, amount: pr.amount, provider, by: user.email });
    // Track revenue for platform earnings
    try { await global.trackRevenue('payment_gateway', pr.amount / 3700, `Payment ${ref}: ${pr.payer_name || 'Payer'} via ${provider}`, ref); } catch(e) {}
    try { await notify(pr.payer_email || user.email, 'Payment Received', `Your payment of ${formatCurrency(pr.amount)} (Ref: ${ref}) has been received. Thank you!`); } catch (e) { /* non-critical */ }
    res.redirect('/payments/collect/' + ref);
  }));

  // ============================================================
  // ROUTE 6: GET /payments/methods — Manage Payment Methods
  // ============================================================
  app.get('/payments/methods', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const methods = (await pool.query(`SELECT * FROM payment_methods WHERE tenant_id=$1 ORDER BY is_default DESC, provider`, [tid])).rows;

    const navHtml = `<div class="pg-nav">
      <a href="/payments">📊 Dashboard</a><a href="/payments/collect">💳 Collect</a>
      <a href="/payments/transactions">📋 Transactions</a><a href="/payments/methods" class="active">⚙ Methods</a><a href="/payments/reconcile">🔍 Reconcile</a>
    </div>`;

    const methodRows = methods.map(m => `<tr>
      <td>${providerIcon(m.provider)} ${esc(providerLabel(m.provider))}</td>
      <td style="text-transform:capitalize">${esc(m.method_type.replace('_', ' '))}</td>
      <td>${esc(m.account_name || '—')}</td>
      <td style="font-family:monospace">${esc(m.phone_number || m.account_number || '—')}</td>
      <td>${m.is_default ? '<span style="background:#dcfce7;color:#16a34a;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600">Default</span>' : '<span style="color:#94a3b8;font-size:12px">—</span>'}</td>
      <td>${m.is_active ? statusBadge('completed').replace('Completed', 'Active') : statusBadge('failed').replace('Failed', 'Inactive')}</td>
      <td style="font-size:12px;color:#94a3b8">${formatDate(m.created_at)}</td>
      <td>
        <form method="POST" action="/payments/methods/save" style="display:inline"><input type="hidden" name="id" value="${m.id}"><input type="hidden" name="action" value="toggle"><button class="pg-btn ${m.is_active?'pg-btn-danger':'pg-btn-success'}" style="padding:4px 10px;font-size:11px">${m.is_active?'Disable':'Enable'}</button></form>
        ${!m.is_default ? `<form method="POST" action="/payments/methods/save" style="display:inline"><input type="hidden" name="id" value="${m.id}"><input type="hidden" name="action" value="set_default"><button class="pg-btn pg-btn-secondary" style="padding:4px 10px;font-size:11px">Set Default</button></form>` : ''}
      </td>
    </tr>`).join('');

    const html = PG_CSS + `
    <div style="max-width:1100px;margin:0 auto">
      ${navHtml}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">⚙ Payment Methods</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Configure MTN MoMo, Airtel, Flutterwave, bank, and cash methods</p></div>
        <button class="pg-btn pg-btn-primary" onclick="document.getElementById('add-method-form').style.display='block'">➕ Add Method</button>
      </div>
      <div class="card">
        <div style="overflow-x:auto"><table class="pg-table">
          <thead><tr><th>Provider</th><th>Type</th><th>Account Name</th><th>Number</th><th>Default</th><th>Status</th><th>Added</th><th>Actions</th></tr></thead>
          <tbody>${methodRows || '<tr><td colspan="8" style="text-align:center;color:#94a3b8;padding:30px">No payment methods configured yet</td></tr>'}</tbody>
        </table></div>
      </div>
      <div id="add-method-form" class="card" style="padding:24px;margin-top:20px;display:none">
        <h3 style="margin-bottom:16px;color:#1e293b">➕ Add Payment Method</h3>
        <form method="POST" action="/payments/methods/save" style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
          <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Provider *</label>
            <select name="provider" required style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px">
              <option value="mtn">MTN Mobile Money</option><option value="airtel">Airtel Money</option>
              <option value="flutterwave">Flutterwave</option><option value="stripe">Stripe</option>
              <option value="bank">Bank Transfer</option><option value="cash">Cash</option>
            </select></div>
          <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Account Name *</label>
            <input type="text" name="account_name" required placeholder="Institution Name" style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div><label style="font-size:12px;font-weight:600;color:#475569;display:block;margin-bottom:4px">Phone / Account Number</label>
            <input type="text" name="account_number" placeholder="0771234567" style="width:100%;padding:10px;border:2px solid #e2e8f0;border-radius:10px;font-size:13px"></div>
          <div style="display:flex;align-items:center;gap:8px"><input type="checkbox" name="is_default" id="is_default" style="accent-color:#4f46e5"><label for="is_default" style="font-size:13px;color:#475569">Set as default</label></div>
          <div><button type="submit" class="pg-btn pg-btn-primary">💾 Save Method</button></div>
          <div><button type="button" class="pg-btn pg-btn-secondary" onclick="document.getElementById('add-method-form').style.display='none'">Cancel</button></div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Payment Methods', html, user));
  }));

  // ============================================================
  // ROUTE 7: POST /payments/methods/save — Save Payment Method
  // ============================================================
  app.post('/payments/methods/save', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { id, action, provider, account_name, account_number, is_default } = req.body;

    if (action === 'toggle') {
      await pool.query('UPDATE payment_methods SET is_active = NOT is_active WHERE id=$1 AND tenant_id=$2', [id, tid]);
      audit(user.email, 'payment_method_toggled', `Toggled method #${id}`);
    } else if (action === 'set_default') {
      await pool.query('UPDATE payment_methods SET is_default=false WHERE tenant_id=$1', [tid]);
      await pool.query('UPDATE payment_methods SET is_default=true WHERE id=$1 AND tenant_id=$2', [id, tid]);
      audit(user.email, 'payment_method_default', `Set method #${id} as default`);
    } else if (provider) {
      const typeMap = { mtn: 'mobile_money', airtel: 'mobile_money', flutterwave: 'card', stripe: 'card', bank: 'bank', cash: 'cash' };
      if (is_default === 'on') await pool.query('UPDATE payment_methods SET is_default=false WHERE tenant_id=$1', [tid]);
      await pool.query(
        `INSERT INTO payment_methods (tenant_id, method_type, provider, account_name, account_number, is_default, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)`,
        [tid, typeMap[provider] || provider, provider, (account_name || '').trim(), (account_number || '').trim(), is_default === 'on']
      );
      audit(user.email, 'payment_method_added', `Added ${provider} method: ${account_name}`);
    }
    res.redirect('/payments/methods');
  }));

  // ============================================================
  // ROUTE 8: GET /payments/transactions — Transaction History
  // ============================================================
  app.get('/payments/transactions', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const { date_from, date_to, status, provider, min_amt, max_amt } = req.query;
    let where = ['pt.tenant_id=$1'], params = [tid], pi = 2;
    if (date_from) { where.push(`pt.created_at >= $${pi++}`); params.push(date_from); }
    if (date_to) { where.push(`pt.created_at <= $${pi++}`); params.push(date_to + ' 23:59:59'); }
    if (status) { where.push(`pt.status = $${pi++}`); params.push(status); }
    if (provider) { where.push(`pt.provider = $${pi++}`); params.push(provider); }
    if (min_amt) { where.push(`pt.amount >= $${pi++}`); params.push(parseFloat(min_amt)); }
    if (max_amt) { where.push(`pt.amount <= $${pi++}`); params.push(parseFloat(max_amt)); }

    const transactions = (await pool.query(
      `SELECT pt.*, pr.reference as payment_ref, pr.payer_name, pr.description FROM payment_transactions pt LEFT JOIN payment_requests pr ON pr.id=pt.payment_request_id WHERE ${where.join(' AND ')} ORDER BY pt.created_at DESC LIMIT 200`, params
    )).rows;

    const rows = transactions.map(t => `<tr>
      <td style="font-family:monospace;font-size:12px">${esc(t.transaction_ref || '—')}</td>
      <td><a href="/payments/collect/${esc(t.payment_ref)}" style="color:#4f46e5;text-decoration:none;font-family:monospace;font-size:12px">${esc(t.payment_ref || '—')}</a></td>
      <td style="font-weight:600">${formatCurrency(t.amount)}</td>
      <td style="color:#64748b">${formatCurrency(t.fee)}</td>
      <td style="color:#059669;font-weight:600">${formatCurrency(t.net_amount)}</td>
      <td>${esc(t.payer_name || '—')}</td>
      <td>${providerIcon(t.provider)} ${esc(providerLabel(t.provider || 'cash'))}</td>
      <td>${statusBadge(t.status)}</td>
      <td style="color:#94a3b8;font-size:12px">${formatDateTime(t.created_at)}</td>
    </tr>`).join('');

    const navHtml = `<div class="pg-nav">
      <a href="/payments">📊 Dashboard</a><a href="/payments/collect">💳 Collect</a>
      <a href="/payments/transactions" class="active">📋 Transactions</a><a href="/payments/methods">⚙ Methods</a><a href="/payments/reconcile">🔍 Reconcile</a>
    </div>`;

    const html = PG_CSS + `
    <div style="max-width:1300px;margin:0 auto">
      ${navHtml}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">📋 Transactions</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">${transactions.length} transactions found</p></div>
        <a href="/payments/transactions/export?${new URLSearchParams(req.query).toString()}" class="pg-btn pg-btn-secondary">📥 Export CSV</a>
      </div>
      <div class="card" style="padding:16px;margin-bottom:16px">
        <form method="GET" action="/payments/transactions" class="pg-filter">
          <div><label>From</label><input type="date" name="date_from" value="${esc(date_from || '')}"></div>
          <div><label>To</label><input type="date" name="date_to" value="${esc(date_to || '')}"></div>
          <div><label>Status</label><select name="status"><option value="">All</option><option value="completed" ${status==='completed'?'selected':''}>Completed</option><option value="pending" ${status==='pending'?'selected':''}>Pending</option><option value="failed" ${status==='failed'?'selected':''}>Failed</option></select></div>
          <div><label>Provider</label><select name="provider"><option value="">All</option><option value="mtn" ${provider==='mtn'?'selected':''}>MTN</option><option value="airtel" ${provider==='airtel'?'selected':''}>Airtel</option><option value="flutterwave" ${provider==='flutterwave'?'selected':''}>Flutterwave</option><option value="bank" ${provider==='bank'?'selected':''}>Bank</option><option value="cash" ${provider==='cash'?'selected':''}>Cash</option></select></div>
          <div><label>Min Amt</label><input type="number" name="min_amt" value="${esc(min_amt || '')}" placeholder="0"></div>
          <div><label>Max Amt</label><input type="number" name="max_amt" value="${esc(max_amt || '')}" placeholder="9999999"></div>
          <div><button type="submit" class="pg-btn pg-btn-primary" style="margin-top:auto">🔍 Filter</button></div>
          <div><a href="/payments/transactions" class="pg-btn pg-btn-secondary" style="margin-top:auto">Clear</a></div>
        </form>
      </div>
      <div class="card"><div style="overflow-x:auto"><table class="pg-table">
        <thead><tr><th>Transaction Ref</th><th>Payment Ref</th><th>Amount</th><th>Fee</th><th>Net</th><th>Payer</th><th>Provider</th><th>Status</th><th>Date</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="9" style="text-align:center;color:#94a3b8;padding:30px">No transactions found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Transactions', html, user));
  }));

  // ============================================================
  // ROUTE 9: GET /payments/transactions/export — CSV Export
  // ============================================================
  app.get('/payments/transactions/export', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    let where = ['pt.tenant_id=$1'], params = [tid], pi = 2;
    if (req.query.date_from) { where.push(`pt.created_at >= $${pi++}`); params.push(req.query.date_from); }
    if (req.query.date_to) { where.push(`pt.created_at <= $${pi++}`); params.push(req.query.date_to + ' 23:59:59'); }
    if (req.query.status) { where.push(`pt.status = $${pi++}`); params.push(req.query.status); }
    if (req.query.provider) { where.push(`pt.provider = $${pi++}`); params.push(req.query.provider); }

    const rows = (await pool.query(
      `SELECT pt.transaction_ref, pt.amount, pt.fee, pt.net_amount, pt.status, pt.provider, pt.provider_ref, pt.created_at, pr.reference as payment_ref, pr.payer_name, pr.payer_phone, pr.description FROM payment_transactions pt LEFT JOIN payment_requests pr ON pr.id=pt.payment_request_id WHERE ${where.join(' AND ')} ORDER BY pt.created_at DESC`, params
    )).rows;

    const headers = ['Transaction Ref', 'Payment Ref', 'Amount', 'Fee', 'Net Amount', 'Payer Name', 'Phone', 'Provider', 'Status', 'Description', 'Date'];
    const csvLines = [headers.map(h => '"' + h.replace(/"/g, '""') + '"').join(',')];
    rows.forEach(r => {
      csvLines.push(headers.map(h => {
        const map = { 'Transaction Ref': r.transaction_ref, 'Payment Ref': r.payment_ref, 'Amount': r.amount, 'Fee': r.fee, 'Net Amount': r.net_amount, 'Payer Name': r.payer_name, 'Phone': r.payer_phone, 'Provider': r.provider, 'Status': r.status, 'Description': r.description, 'Date': r.created_at };
        const v = map[h] !== null && map[h] !== undefined ? String(map[h]) : '';
        return '"' + v.replace(/"/g, '""') + '"';
      }).join(','));
    });

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename=transactions_' + new Date().toISOString().slice(0, 10) + '.csv');
    res.send(csvLines.join('\r\n'));
    audit(user.email, 'transactions_exported', `Exported ${rows.length} transactions to CSV`);
  }));

  // ============================================================
  // ROUTE 10: GET /payments/reconcile — Reconciliation Page
  // ============================================================
  app.get('/payments/reconcile', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const navHtml = `<div class="pg-nav">
      <a href="/payments">📊 Dashboard</a><a href="/payments/collect">💳 Collect</a>
      <a href="/payments/transactions">📋 Transactions</a><a href="/payments/methods">⚙ Methods</a><a href="/payments/reconcile" class="active">🔍 Reconcile</a>
    </div>`;

    const summary = (await pool.query(
      `SELECT COUNT(*) as total_requests, COALESCE(SUM(CASE WHEN status='completed' THEN amount ELSE 0 END),0) as completed_amount, COUNT(*) FILTER (WHERE status='completed') as completed_count, COUNT(*) FILTER (WHERE status='pending') as pending_count, COUNT(*) FILTER (WHERE status='failed') as failed_count FROM payment_requests WHERE tenant_id=$1 AND created_at >= date_trunc('month', NOW())`, [tid]
    )).rows[0];
    const txSummary = (await pool.query(
      `SELECT COUNT(*) as tx_count, COALESCE(SUM(amount),0) as tx_total, COALESCE(SUM(fee),0) as fees_total, COALESCE(SUM(net_amount),0) as net_total FROM payment_transactions WHERE tenant_id=$1 AND created_at >= date_trunc('month', NOW())`, [tid]
    )).rows[0];

    const html = PG_CSS + `
    <div style="max-width:1100px;margin:0 auto">
      ${navHtml}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:#1e293b">🔍 Reconciliation</h1><p style="font-size:13px;color:#94a3b8;margin-top:2px">Compare payment requests vs recorded transactions</p></div>
        <form method="POST" action="/payments/reconcile/check"><button class="pg-btn pg-btn-primary">🔍 Run Reconciliation</button></form>
      </div>
      <div class="pg-stats">
        <div class="pg-stat"><div class="pg-stat-val" style="color:#4f46e5">${summary.total_requests}</div><div class="pg-stat-lbl">Total Requests</div></div>
        <div class="pg-stat"><div class="pg-stat-val" style="color:#059669">${summary.completed_count}</div><div class="pg-stat-lbl">Completed</div></div>
        <div class="pg-stat"><div class="pg-stat-val" style="color:#f59e0b">${summary.pending_count}</div><div class="pg-stat-lbl">Pending</div></div>
        <div class="pg-stat"><div class="pg-stat-val" style="color:#dc2626">${summary.failed_count}</div><div class="pg-stat-lbl">Failed</div></div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px">
        <div class="card" style="padding:20px">
          <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px">Requests (Completed)</h3>
          <div style="font-size:13px;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Total Amount</span><span style="font-weight:700">${formatCurrency(summary.completed_amount)}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Count</span><span style="font-weight:600">${summary.completed_count}</span></div>
          </div>
        </div>
        <div class="card" style="padding:20px">
          <h3 style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:12px">Transactions Recorded</h3>
          <div style="font-size:13px;display:flex;flex-direction:column;gap:8px">
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Total Amount</span><span style="font-weight:700">${formatCurrency(txSummary.tx_total)}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Total Fees</span><span style="font-weight:600;color:#f59e0b">${formatCurrency(txSummary.fees_total)}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Net Total</span><span style="font-weight:700;color:#059669">${formatCurrency(txSummary.net_total)}</span></div>
            <div style="display:flex;justify-content:space-between"><span style="color:#64748b">Count</span><span style="font-weight:600">${txSummary.tx_count}</span></div>
          </div>
        </div>
      </div>
      <div id="recon-results"></div>
    </div>`;
    res.send(renderPage('Reconciliation', html, user));
  }));

  // ============================================================
  // ROUTE 11: POST /payments/reconcile/check — Run Reconciliation
  // ============================================================
  app.post('/payments/reconcile/check', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const completed = (await pool.query(
      `SELECT pr.id, pr.reference, pr.amount, pr.payer_name, pr.paid_at FROM payment_requests pr WHERE pr.tenant_id=$1 AND pr.status='completed' AND pr.created_at >= date_trunc('month', NOW())`, [tid]
    )).rows;
    const withTx = new Set((await pool.query(
      `SELECT DISTINCT payment_request_id FROM payment_transactions WHERE tenant_id=$1 AND created_at >= date_trunc('month', NOW())`, [tid]
    )).rows.map(r => r.payment_request_id));

    const discrepancies = [], matched = [];
    completed.forEach(pr => {
      if (withTx.has(pr.id)) matched.push(pr);
      else discrepancies.push(pr);
    });

    const navHtml = `<div class="pg-nav">
      <a href="/payments">📊 Dashboard</a><a href="/payments/collect">💳 Collect</a>
      <a href="/payments/transactions">📋 Transactions</a><a href="/payments/methods">⚙ Methods</a><a href="/payments/reconcile" class="active">🔍 Reconcile</a>
    </div>`;

    const html = PG_CSS + `
    <div style="max-width:1100px;margin:0 auto">
      ${navHtml}
      <a href="/payments/reconcile" style="color:#64748b;font-size:14px;text-decoration:none;display:inline-block;margin-bottom:16px">← Back to Reconciliation</a>
      <div class="card" style="padding:20px;margin-bottom:16px">
        <h3 style="margin-bottom:12px">Reconciliation Results</h3>
        <div style="display:flex;gap:16px;font-size:14px">
          <span style="color:#059669;font-weight:600">✅ Matched: ${matched.length}</span>
          <span style="color:#f59e0b;font-weight:600">⚠ Discrepancies: ${discrepancies.length}</span>
          <span style="color:#475569">Total checked: ${completed.length}</span>
        </div>
      </div>
      ${discrepancies.length > 0 ? `<h3 style="color:#f59e0b;font-size:16px;margin-bottom:12px">⚠ Discrepancies — Completed requests without transactions</h3>
        <div class="card" style="padding:16px">
          ${discrepancies.map(d => `<div class="pg-discrepancy">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><span style="font-family:monospace;font-weight:600">${esc(d.reference)}</span><span style="color:#64748b;margin-left:8px">${esc(d.payer_name || '—')}</span></div>
              <div><span style="font-weight:700;color:#f59e0b">${formatCurrency(d.amount)}</span><span style="color:#94a3b8;margin-left:12px;font-size:12px">${formatDateTime(d.paid_at)}</span></div>
            </div>
          </div>`).join('')}
        </div>` : '<div class="card" style="padding:30px;text-align:center"><div style="font-size:48px">✅</div><h3 style="color:#059669;margin:12px 0 4px">All Clear!</h3><p style="color:#64748b">No discrepancies found. All completed payments have matching transactions.</p></div>'}
      ${matched.length > 0 ? `<h3 style="color:#059669;font-size:16px;margin:20px 0 12px">✅ Matched (${matched.length})</h3>
        <div class="card" style="padding:16px">
          ${matched.slice(0, 20).map(m => `<div class="pg-matched">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div><span style="font-family:monospace;font-weight:600">${esc(m.reference)}</span><span style="color:#64748b;margin-left:8px">${esc(m.payer_name || '—')}</span></div>
              <span style="font-weight:600;color:#059669">${formatCurrency(m.amount)}</span>
            </div>
          </div>`).join('')}
          ${matched.length > 20 ? `<p style="text-align:center;color:#94a3b8;font-size:13px;margin-top:8px">...and ${matched.length - 20} more</p>` : ''}
        </div>` : ''}
    </div>`;
    audit(user.email, 'reconciliation_run', `Checked ${completed.length} payments, ${discrepancies.length} discrepancies`);
    res.send(renderPage('Reconciliation Results', html, user));
  }));

  // ============================================================
  // ROUTE 12: GET /payments/invoice/:ref — Invoice
  // ============================================================
  app.get('/payments/invoice/:ref', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, ref = req.params.ref;
    const pr = (await pool.query(
      `SELECT pr.*, pm.provider, pm.account_name as institution_name, pm.account_number FROM payment_requests pr LEFT JOIN payment_methods pm ON pm.id=pr.method_id WHERE pr.reference=$1 AND pr.tenant_id=$2`, [ref, tid]
    )).rows[0];
    if (!pr) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Invoice not found</h2><a href="/payments" class="pg-btn pg-btn-primary" style="margin-top:12px">← Dashboard</a></div>', user));

    const provider = pr.provider || 'cash';
    const fee = calculateFee(provider, pr.amount);
    const invNum = 'INV-' + ref.replace('PAY-', '');
    const now = new Date();

    const html = PG_CSS + `
    <div class="pg-no-print" style="max-width:800px;margin:0 auto 16px;display:flex;gap:8px">
      <a href="/payments/collect/${esc(ref)}" class="pg-btn pg-btn-secondary">← Payment</a>
      <button class="pg-btn pg-btn-primary" onclick="window.print()">🖨 Print Invoice</button>
      <a href="/payments/receipt/${esc(ref)}" class="pg-btn pg-btn-secondary">🧾 Receipt</a>
    </div>
    <div class="pg-invoice">
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:30px">
        <div>
          <h1 style="font-size:28px;color:#1e293b;margin:0">INVOICE</h1>
          <div style="font-size:13px;color:#64748b;margin-top:4px">${esc(invNum)}</div>
        </div>
        <div style="text-align:right;font-size:13px;color:#475569">
          <div style="font-weight:700;font-size:15px;color:#1e293b">${esc(pr.institution_name || 'SSEWASSWA Comfort Platform')}</div>
          <div style="margin-top:4px">Date: ${formatDate(now)}</div>
          <div>Payment Ref: ${esc(pr.reference)}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;padding:16px;background:#f8fafc;border-radius:8px">
        <div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Bill To</div>
          <div style="font-weight:700;color:#1e293b">${esc(pr.payer_name || '—')}</div>
          <div style="color:#64748b">${esc(pr.payer_phone || '')}</div>
          <div style="color:#64748b">${esc(pr.payer_email || '')}</div></div>
        <div><div style="font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:4px">Payment Details</div>
          <div style="color:#475569">${providerIcon(provider)} ${esc(providerLabel(provider))}</div>
          <div style="color:#64748b">Status: ${pr.status.charAt(0).toUpperCase() + pr.status.slice(1)}</div>
          ${pr.paid_at ? `<div style="color:#64748b">Paid: ${formatDateTime(pr.paid_at)}</div>` : ''}</div>
      </div>
      <table>
        <thead><tr><th>Description</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          <tr><td>${esc(pr.description || 'Payment for services')}</td><td style="text-align:right;font-weight:600">${formatCurrency(pr.amount, pr.currency)}</td></tr>
          <tr><td style="color:#64748b">Transaction Fee (${providerLabel(provider)})</td><td style="text-align:right;color:#64748b">${formatCurrency(fee)}</td></tr>
        </tbody>
      </table>
      <div class="pg-invoice-total">Total: ${formatCurrency(pr.amount, pr.currency)}</div>
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid #e2e8f0;font-size:12px;color:#94a3b8;text-align:center">
        Thank you for your payment. For inquiries, contact the institution finance office.
      </div>
    </div>`;
    res.send(renderPage('Invoice — ' + ref, html, user));
  }));

  // ============================================================
  // ROUTE 13: GET /payments/receipt/:ref — Receipt
  // ============================================================
  app.get('/payments/receipt/:ref', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, ref = req.params.ref;
    const pr = (await pool.query(
      `SELECT pr.*, pm.provider, pm.account_name as institution_name, pt.transaction_ref, pt.fee, pt.net_amount, pt.provider_ref FROM payment_requests pr LEFT JOIN payment_methods pm ON pm.id=pr.method_id LEFT JOIN payment_transactions pt ON pt.payment_request_id=pr.id WHERE pr.reference=$1 AND pr.tenant_id=$2`, [ref, tid]
    )).rows[0];
    if (!pr) return res.send(renderPage('Not Found', '<div class="card" style="text-align:center;padding:40px"><h2 style="color:#dc2626">Receipt not found</h2><a href="/payments" class="pg-btn pg-btn-primary" style="margin-top:12px">← Dashboard</a></div>', user));

    const provider = pr.provider || 'cash';
    const fee = parseFloat(pr.fee) || 0;
    const rcptNum = 'RCP-' + ref.replace('PAY-', '');

    const html = PG_CSS + `
    <div class="pg-no-print" style="max-width:800px;margin:0 auto 16px;display:flex;gap:8px">
      <a href="/payments/collect/${esc(ref)}" class="pg-btn pg-btn-secondary">← Payment</a>
      <button class="pg-btn pg-btn-primary" onclick="window.print()">🖨 Print Receipt</button>
      <a href="/payments/invoice/${esc(ref)}" class="pg-btn pg-btn-secondary">📄 Invoice</a>
    </div>
    <div class="pg-invoice">
      <div style="text-align:center;margin-bottom:30px">
        <div style="font-size:14px;color:#059669;font-weight:700;text-transform:uppercase;letter-spacing:2px">Payment Receipt</div>
        <div style="font-size:36px;margin:8px 0">✅</div>
        <h1 style="font-size:22px;color:#1e293b;margin:0">${esc(rcptNum)}</h1>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
        <div style="padding:14px;background:#f8fafc;border-radius:8px">
          <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:6px">Payment Information</div>
          <div style="font-size:13px;display:flex;flex-direction:column;gap:4px">
            <div><span style="color:#64748b">Reference:</span> <strong style="font-family:monospace">${esc(pr.reference)}</strong></div>
            <div><span style="color:#64748b">Transaction:</span> <strong style="font-family:monospace">${esc(pr.transaction_ref || '—')}</strong></div>
            <div><span style="color:#64748b">Provider Ref:</span> <span style="font-family:monospace">${esc(pr.provider_ref || '—')}</span></div>
            <div><span style="color:#64748b">Method:</span> ${providerIcon(provider)} ${esc(providerLabel(provider))}</div>
          </div>
        </div>
        <div style="padding:14px;background:#f8fafc;border-radius:8px">
          <div style="font-size:11px;color:#94a3b8;text-transform:uppercase;margin-bottom:6px">Payer Details</div>
          <div style="font-size:13px;display:flex;flex-direction:column;gap:4px">
            <div><span style="color:#64748b">Name:</span> <strong>${esc(pr.payer_name || '—')}</strong></div>
            <div><span style="color:#64748b">Phone:</span> ${esc(pr.payer_phone || '—')}</div>
            <div><span style="color:#64748b">Email:</span> ${esc(pr.payer_email || '—')}</div>
            <div><span style="color:#64748b">Paid At:</span> ${formatDateTime(pr.paid_at)}</div>
          </div>
        </div>
      </div>
      <table>
        <thead><tr><th>Item</th><th style="text-align:right">Amount</th></tr></thead>
        <tbody>
          <tr><td>${esc(pr.description || 'Payment')}</td><td style="text-align:right;font-weight:700">${formatCurrency(pr.amount, pr.currency)}</td></tr>
          <tr><td style="color:#64748b">Transaction Fee</td><td style="text-align:right;color:#64748b">${formatCurrency(fee)}</td></tr>
        </tbody>
      </table>
      <div style="display:flex;justify-content:space-between;align-items:center;padding:16px 0;border-top:2px solid #1e293b;margin-top:8px">
        <span style="font-size:16px;font-weight:700">Total Paid:</span>
        <span style="font-size:24px;font-weight:800;color:#059669">${formatCurrency(pr.amount, pr.currency)}</span>
      </div>
      <div style="margin-top:24px;text-align:center;font-size:12px;color:#94a3b8;padding-top:16px;border-top:1px solid #e2e8f0">
        <p>This receipt serves as proof of payment.</p>
        <p>Generated on ${formatDateTime(new Date())} by SSEWASSWA Comfort Platform</p>
      </div>
    </div>`;
    res.send(renderPage('Receipt — ' + ref, html, user));
  }));

};
