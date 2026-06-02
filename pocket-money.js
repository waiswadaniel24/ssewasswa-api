/**
 * Pocket Money Wallet — Digital wallet for boarding students
 * Features: Wallet dashboard, top-up, spend, transfer, transaction history,
 *           admin controls, savings, SVG reports
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const trackRevenue = global.trackRevenue || (() => {});
  const tenantId = () => opts.tenantId || ((req) => req.session?.tenantId || 1);

  // ── Configuration defaults ──
  const DEFAULTS = {
    dailySpendLimit: 5000,
    dailyTransferLimit: 3000,
    maxSavingsInterestRate: 0.005,   // 0.5% per month
    minSavingsAmount: 100,
    minSavingsLockDays: 7,
    currency: 'UGX'
  };

  // ── SVG chart helpers ──
  function svgGauge(value, max, label, size) {
    size = size || 200;
    const r = size / 2 - 15;
    const cx = size / 2, cy = size / 2;
    const pct = Math.min(Math.max(value / max, 0), 1);
    const circumference = 2 * Math.PI * r * 0.75;
    const offset = circumference * (1 - pct);
    const color = value > 1000 ? '#16a34a' : value > 500 ? '#d97706' : '#dc2626';
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="${esc(label)}: ${esc(String(value))}">
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e7eb" stroke-width="14" stroke-dasharray="${circumference} ${circumference * 0.25}" stroke-linecap="round" transform="rotate(135 ${cx} ${cy})"/>
      <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${color}" stroke-width="14" stroke-dasharray="${circumference} ${circumference * 0.25}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(135 ${cx} ${cy})">
        <animate attributeName="stroke-dashoffset" from="${circumference}" to="${offset}" dur="1s" fill="freeze"/>
      </circle>
      <text x="${cx}" y="${cy - 8}" text-anchor="middle" font-size="22" font-weight="700" fill="${color}">${esc(String(value))}</text>
      <text x="${cx}" y="${cy + 16}" text-anchor="middle" font-size="12" fill="#6b7280">${esc(label)}</text>
    </svg>`;
  }

  function svgDonut(data, size) {
    size = size || 260;
    const colors = ['#4f46e5','#16a34a','#d97706','#dc2626','#8b5cf6','#0891b2','#e11d48','#65a30d'];
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const r = size / 2 - 40, inner = r - 30, cx = size / 2, cy = size / 2;
    const circumference = 2 * Math.PI * r;
    let paths = '', legends = '', offset = 0;
    data.forEach((d, i) => {
      const pct = d.value / total;
      const len = circumference * pct;
      const c = colors[i % colors.length];
      paths += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${c}" stroke-width="${r - inner}" stroke-dasharray="${len} ${circumference - len}" stroke-dashoffset="${-offset}"/>`;
      offset += len;
      legends += `<div style="display:inline-flex;align-items:center;margin:4px 10px;font-size:13px"><span style="width:12px;height:12px;border-radius:2px;background:${c};display:inline-block;margin-right:5px"></span>${esc(d.label)} (${Math.round(pct * 100)}%)</div>`;
    });
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="Spending by category">${paths}</svg><div style="text-align:center;margin-top:8px">${legends}</div>`;
  }

  function svgLine(data, w, h) {
    w = w || 500; h = h || 200;
    const pad = { t: 20, r: 20, b: 40, l: 55 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    if (!data.length) return `<svg width="${w}" height="${h}" role="img" aria-label="No data"></svg>`;
    const maxVal = Math.max(...data.map(d => d.value)) || 1;
    const step = cw / Math.max(data.length - 1, 1);
    let polyline = '', labels = '';
    data.forEach((d, i) => {
      const x = pad.l + i * step;
      const y = pad.t + ch - (d.value / maxVal) * ch;
      polyline += `${x},${y} `;
      labels += `<text x="${x}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(d.label)}</text>`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Daily spending trend">
      <line x1="${pad.l}" y1="${pad.t}" x2="${pad.l}" y2="${pad.t + ch}" stroke="#e5e7eb"/>
      <line x1="${pad.l}" y1="${pad.t + ch}" x2="${pad.l + cw}" y2="${pad.t + ch}" stroke="#e5e7eb"/>
      ${[0, 0.25, 0.5, 0.75, 1].map(p => `<text x="${pad.l - 8}" y="${pad.t + ch - ch * p + 4}" text-anchor="end" font-size="10" fill="#9ca3af">${Math.round(maxVal * p)}</text>`).join('')}
      <polyline fill="none" stroke="#4f46e5" stroke-width="2.5" points="${polyline}"/>
      ${data.map((d, i) => { const x = pad.l + i * step, y = pad.t + ch - (d.value / maxVal) * ch; return `<circle cx="${x}" cy="${y}" r="4" fill="#4f46e5" stroke="#fff" stroke-width="2"/><title>${esc(d.label)}: ${d.value}</title>`; }).join('')}
      ${labels}
    </svg>`;
  }

  function svgBar(data, w, h) {
    w = w || 500; h = h || 220;
    const pad = { t: 20, r: 20, b: 50, l: 55 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    if (!data.length) return `<svg width="${w}" height="${h}" role="img" aria-label="No data"></svg>`;
    const maxVal = Math.max(...data.map(d => d.value)) || 1;
    const barW = Math.min(40, cw / data.length * 0.6);
    const gap = cw / data.length;
    const colors = ['#4f46e5','#7c3aed','#2563eb','#0891b2','#059669','#d97706'];
    let bars = '', labels = '';
    data.forEach((d, i) => {
      const x = pad.l + gap * i + (gap - barW) / 2;
      const barH = (d.value / maxVal) * ch;
      const y = pad.t + ch - barH;
      const c = colors[i % colors.length];
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${c}"><animate attributeName="height" from="0" to="${barH}" dur="0.6s" fill="freeze"/><animate attributeName="y" from="${pad.t + ch}" to="${y}" dur="0.6s" fill="freeze"/></rect>`;
      bars += `<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="11" font-weight="600" fill="#374151">${d.value}</text>`;
      labels += `<text x="${x + barW / 2}" y="${h - 8}" text-anchor="middle" font-size="10" fill="#6b7280" transform="rotate(-20 ${x + barW / 2} ${h - 8})">${esc(d.label)}</text>`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Top spenders">
      <line x1="${pad.l}" y1="${pad.t + ch}" x2="${pad.l + cw}" y2="${pad.t + ch}" stroke="#e5e7eb"/>
      ${bars}${labels}
    </svg>`;
  }

  function svgHistogram(buckets, w, h) {
    w = w || 500; h = h || 200;
    const pad = { t: 20, r: 20, b: 40, l: 55 };
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const maxVal = Math.max(...buckets.map(b => b.count)) || 1;
    const barW = cw / buckets.length - 4;
    let rects = '', labels = '';
    buckets.forEach((b, i) => {
      const x = pad.l + i * (barW + 4);
      const barH = (b.count / maxVal) * ch;
      const y = pad.t + ch - barH;
      rects += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="3" fill="#4f46e5" opacity="0.8"><title>${esc(b.label)}: ${b.count} students</title></rect>`;
      labels += `<text x="${x + barW / 2}" y="${h - 6}" text-anchor="middle" font-size="9" fill="#6b7280">${esc(b.label)}</text>`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Wallet distribution">
      <line x1="${pad.l}" y1="${pad.t + ch}" x2="${pad.l + cw}" y2="${pad.t + ch}" stroke="#e5e7eb"/>
      ${rects}${labels}
    </svg>`;
  }

  // ── Table creation ──
  setTimeout(() => {
  (async () => {
    await migrateQuery(pool, 'PocketMoney', `
      CREATE TABLE IF NOT EXISTS wallet_accounts (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        student_id INT NOT NULL,
        balance NUMERIC(12,2) NOT NULL DEFAULT 0,
        savings_balance NUMERIC(12,2) NOT NULL DEFAULT 0,
        daily_spend_limit NUMERIC(10,2) NOT NULL DEFAULT ${DEFAULTS.dailySpendLimit},
        daily_transfer_limit NUMERIC(10,2) NOT NULL DEFAULT ${DEFAULTS.dailyTransferLimit},
        daily_spend_total NUMERIC(10,2) NOT NULL DEFAULT 0,
        daily_transfer_total NUMERIC(10,2) NOT NULL DEFAULT 0,
        daily_reset_date DATE,
        pin_hash VARCHAR(255),
        frozen BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE(tenant_id, student_id)
      );
    `);
    await migrateQuery(pool, 'PocketMoney', `
      CREATE TABLE IF NOT EXISTS wallet_transactions (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        account_id INT NOT NULL REFERENCES wallet_accounts(id),
        student_id INT NOT NULL,
        type VARCHAR(20) NOT NULL CHECK (type IN ('topup','spend','transfer_in','transfer_out','savings_in','savings_out','interest','refund')),
        amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
        vendor VARCHAR(100),
        description TEXT NOT NULL DEFAULT '',
        reference VARCHAR(255),
        counterparty_id INT,
        balance_after NUMERIC(12,2) NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    await migrateQuery(pool, 'PocketMoney', `
      CREATE TABLE IF NOT EXISTS wallet_savings (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 1,
        account_id INT NOT NULL REFERENCES wallet_accounts(id),
        student_id INT NOT NULL,
        amount NUMERIC(12,2) NOT NULL CHECK (amount >= 0),
        interest_rate NUMERIC(6,4) NOT NULL DEFAULT ${DEFAULTS.maxSavingsInterestRate},
        lock_until DATE NOT NULL,
        withdrawn BOOLEAN NOT NULL DEFAULT FALSE,
        withdrawn_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);
    // Ensure student_id column exists (in case table was created without it)
    try { await migrateQuery(pool, 'PocketMoney', `ALTER TABLE wallet_transactions ADD COLUMN IF NOT EXISTS student_id INT`); } catch(e) {}
    try { await migrateQuery(pool, 'PocketMoney', `CREATE INDEX IF NOT EXISTS idx_wt_tenant ON wallet_transactions(tenant_id, student_id);`); } catch(e) {}
    try { await migrateQuery(pool, 'PocketMoney', `CREATE INDEX IF NOT EXISTS idx_wt_type ON wallet_transactions(tenant_id, type);`); } catch(e) {}
    try { await migrateQuery(pool, 'PocketMoney', `CREATE INDEX IF NOT EXISTS idx_wt_date ON wallet_transactions(tenant_id, created_at);`); } catch(e) {}
    try { await migrateQuery(pool, 'PocketMoney', `CREATE INDEX IF NOT EXISTS idx_ws_account ON wallet_savings(tenant_id, account_id);`); } catch(e) {}
  })().catch(e => console.error('pocket-money table init error:', e));
  }, Math.random() * 10000);

  // ── Helper: get or create wallet ──
  async function getOrCreateWallet(tid, studentId) {
    let row = await pool.query(
      `SELECT * FROM wallet_accounts WHERE tenant_id = $1 AND student_id = $2`, [tid, studentId]
    );
    if (row.rows.length) return row.rows[0];
    row = await pool.query(
      `INSERT INTO wallet_accounts (tenant_id, student_id) VALUES ($1, $2) RETURNING *`, [tid, studentId]
    );
    audit('wallet_created', { tenantId: tid, studentId });
    return row.rows[0];
  }

  async function resetDailyIfNeeded(wallet) {
    const today = new Date().toISOString().slice(0, 10);
    if (wallet.daily_reset_date !== today) {
      await pool.query(
        `UPDATE wallet_accounts SET daily_spend_total = 0, daily_transfer_total = 0, daily_reset_date = $1 WHERE id = $2`,
        [today, wallet.id]
      );
    }
  }

  // ═══════════════════════════════════════════════════
  // 1. STUDENT WALLET DASHBOARD
  // ═══════════════════════════════════════════════════
  app.get('/wallet', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const studentId = req.session.user.id;
    const wallet = await getOrCreateWallet(tid, studentId);
    await resetDailyIfNeeded(wallet);
    const bal = Number(wallet.balance);
    const color = bal > 1000 ? '#16a34a' : bal > 500 ? '#d97706' : '#dc2626';

    const txResult = await pool.query(
      `SELECT * FROM wallet_transactions WHERE tenant_id = $1 AND student_id = $2 ORDER BY created_at DESC LIMIT 10`,
      [tid, studentId]
    );
    const transactions = txResult.rows;

    let txRows = '';
    transactions.forEach(t => {
      const sign = (t.type === 'spend' || t.type === 'transfer_out' || t.type === 'savings_in') ? '-' : '+';
      const amtColor = (t.type === 'spend' || t.type === 'transfer_out' || t.type === 'savings_in') ? '#dc2626' : '#16a34a';
      txRows += `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 12px;font-size:13px;color:#6b7280">${esc(t.created_at?.toISOString?.().slice(0,16)?.replace('T',' ') || '')}</td>
        <td style="padding:10px 12px;font-size:13px"><span style="background:#eef2ff;color:#4f46e5;padding:2px 8px;border-radius:10px;font-size:11px">${esc(t.type)}</span></td>
        <td style="padding:10px 12px;font-size:13px">${esc(t.description)}</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:${amtColor}">${sign}${Number(t.amount).toLocaleString()}</td>
      </tr>`;
    });

    const gaugeMax = Math.max(bal, 2000);
    const gauge = svgGauge(bal, gaugeMax, 'Balance', 200);

    const html = renderPage('My Wallet', `
      <div style="max-width:900px;margin:0 auto;padding:24px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:28px">
          <h1 style="font-size:26px;font-weight:700;color:#111827;margin:0">💰 My Wallet</h1>
          ${wallet.frozen ? '<span style="background:#fef2f2;color:#dc2626;padding:4px 12px;border-radius:6px;font-size:13px;font-weight:600">❄ FROZEN</span>' : ''}
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:28px">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center">
            ${gauge}
            <div style="margin-top:12px">
              <div style="font-size:28px;font-weight:800;color:${color}">${bal.toLocaleString()}</div>
              <div style="font-size:13px;color:#9ca3af;margin-top:2px">Current Balance</div>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;align-content:start">
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">
              <div style="font-size:13px;color:#9ca3af;margin-bottom:4px">Savings</div>
              <div style="font-size:22px;font-weight:700;color:#4f46e5">${Number(wallet.savings_balance).toLocaleString()}</div>
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">
              <div style="font-size:13px;color:#9ca3af;margin-bottom:4px">Daily Spend</div>
              <div style="font-size:22px;font-weight:700;color:#374151">${Number(wallet.daily_spend_total).toLocaleString()} / ${Number(wallet.daily_spend_limit).toLocaleString()}</div>
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">
              <div style="font-size:13px;color:#9ca3af;margin-bottom:4px">Spend Limit</div>
              <div style="font-size:22px;font-weight:700;color:#374151">${Number(wallet.daily_spend_limit).toLocaleString()}</div>
            </div>
            <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">
              <div style="font-size:13px;color:#9ca3af;margin-bottom:4px">Transfer Limit</div>
              <div style="font-size:22px;font-weight:700;color:#374151">${Number(wallet.daily_transfer_limit).toLocaleString()}</div>
            </div>
          </div>
        </div>

        <div style="display:flex;gap:10px;margin-bottom:28px;flex-wrap:wrap">
          <a href="/wallet/topup" style="display:inline-flex;align-items:center;gap:6px;background:#4f46e5;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">➕ Top Up</a>
          <a href="/wallet/spend" style="display:inline-flex;align-items:center;gap:6px;background:#16a34a;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">🛒 Spend</a>
          <a href="/wallet/transfer" style="display:inline-flex;align-items:center;gap:6px;background:#0891b2;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">↔ Transfer</a>
          <a href="/wallet/savings" style="display:inline-flex;align-items:center;gap:6px;background:#7c3aed;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">🏦 Savings</a>
          <a href="/wallet/history" style="display:inline-flex;align-items:center;gap:6px;background:#fff;color:#374151;border:1px solid #d1d5db;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">📋 History</a>
          <a href="/wallet/pin" style="display:inline-flex;align-items:center;gap:6px;background:#fff;color:#374151;border:1px solid #d1d5db;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">🔑 Set PIN</a>
        </div>

        <h2 style="font-size:18px;font-weight:600;color:#111827;margin-bottom:12px">Recent Transactions</h2>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden">
          <table style="width:100%;border-collapse:collapse" role="table" aria-label="Recent transactions">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Date</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Type</th>
              <th style="padding:12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Description</th>
              <th style="padding:12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600">Amount</th>
            </tr></thead>
            <tbody>${txRows || '<tr><td colspan="4" style="padding:24px;text-align:center;color:#9ca3af">No transactions yet</td></tr>'}</tbody>
          </table>
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  // ═══════════════════════════════════════════════════
  // 2. TOP-UP
  // ═══════════════════════════════════════════════════
  app.get('/wallet/topup', requireAuth, ah(async (req, res) => {
    const html = renderPage('Top Up Wallet', `
      <div style="max-width:480px;margin:0 auto;padding:24px">
        <h1 style="font-size:24px;font-weight:700;color:#111827;margin-bottom:20px">➕ Top Up Wallet</h1>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">
          <form method="POST" action="/wallet/topup" role="form" aria-label="Top up form">
            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Amount *</label>
            <input type="number" name="amount" min="100" step="100" required placeholder="e.g. 5000"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:16px;box-sizing:border-box" aria-required="true"/>

            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Payment Method</label>
            <select name="method" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:16px;box-sizing:border-box">
              <option value="mobile_money">Mobile Money (MTN/Airtel)</option>
              <option value="bank">Bank Transfer</option>
              <option value="flutterwave">Flutterwave</option>
              <option value="paystack">Paystack</option>
              <option value="cash">Cash (Admin)</option>
            </select>

            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Reference (Optional)</label>
            <input type="text" name="reference" placeholder="Transaction ID / Receipt #"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:16px;box-sizing:border-box"/>

            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Note (Optional)</label>
            <textarea name="note" rows="2" placeholder="e.g. Monthly pocket money"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:20px;box-sizing:border-box;resize:vertical"></textarea>

            <button type="submit" style="width:100%;background:#4f46e5;color:#fff;border:none;padding:12px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">💰 Process Top Up</button>
          </form>
          <div style="margin-top:16px;padding:12px;background:#eef2ff;border-radius:8px;font-size:13px;color:#4f46e5">
            🔒 Payments are processed securely. Mobile money / Flutterwave / Paystack integration placeholder active.
          </div>
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  app.post('/wallet/topup', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const studentId = req.session.user.id;
    const amount = Math.max(Number(req.body.amount) || 0, 0);
    const method = String(req.body.method || 'cash').slice(0, 50);
    const reference = String(req.body.reference || '').slice(0, 255);
    const note = String(req.body.note || 'Top up via ' + method).slice(0, 500);

    if (amount < 100) return res.status(400).send('Minimum top-up is 100');
    if (amount > 1000000) return res.status(400).send('Maximum top-up is 1,000,000');

    const wallet = await getOrCreateWallet(tid, studentId);

    // ── Flutterwave / Paystack placeholder ──
    if (method === 'flutterwave' || method === 'paystack') {
      // In production: redirect to payment gateway, verify webhook callback
      // Placeholder: treat as confirmed for demo
      reference || console.log(`[PLACEHOLDER] ${method} payment initiated for student ${studentId}: ${amount}`);
    }

    const result = await pool.query(
      `UPDATE wallet_accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [amount, wallet.id]
    );
    const newBalance = Number(result.rows[0].balance);

    await pool.query(
      `INSERT INTO wallet_transactions (tenant_id, account_id, student_id, type, amount, description, reference, balance_after)
       VALUES ($1, $2, $3, 'topup', $4, $5, $6, $7)`,
      [tid, wallet.id, studentId, amount, note, reference, newBalance]
    );

    trackRevenue({ tenantId: tid, source: 'wallet_topup', amount, method });
    audit('wallet_topup', { tenantId: tid, studentId, amount, method, reference });
    res.redirect('/wallet');
  }));

  // ═══════════════════════════════════════════════════
  // 3. SPEND
  // ═══════════════════════════════════════════════════
  const VENDORS = [
    { id: 'canteen', label: '🍽 Canteen', desc: 'Food & drinks' },
    { id: 'school_shop', label: '🏫 School Shop', desc: 'Stationery & supplies' },
    { id: 'print_shop', label: '🖨 Print Shop', desc: 'Printing & photocopying' },
    { id: 'event_tickets', label: '🎫 Event Tickets', desc: 'School events & trips' },
    { id: 'other', label: '📦 Other', desc: 'Miscellaneous expenses' }
  ];

  app.get('/wallet/spend', requireAuth, ah(async (req, res) => {
    const vendorOptions = VENDORS.map(v =>
      `<option value="${esc(v.id)}">${esc(v.label)} — ${esc(v.desc)}</option>`
    ).join('');

    const html = renderPage('Spend Money', `
      <div style="max-width:480px;margin:0 auto;padding:24px">
        <h1 style="font-size:24px;font-weight:700;color:#111827;margin-bottom:20px">🛒 Spend Money</h1>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">
          <form method="POST" action="/wallet/spend" role="form" aria-label="Spend form">
            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Vendor *</label>
            <select name="vendor" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:16px;box-sizing:border-box" aria-required="true">
              ${vendorOptions}
            </select>

            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Amount *</label>
            <input type="number" name="amount" min="50" step="50" required placeholder="e.g. 1500"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:16px;box-sizing:border-box" aria-required="true"/>

            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Description *</label>
            <input type="text" name="description" required placeholder="e.g. Lunch at canteen" maxlength="200"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:20px;box-sizing:border-box" aria-required="true"/>

            <button type="submit" style="width:100%;background:#16a34a;color:#fff;border:none;padding:12px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">✅ Confirm Payment</button>
          </form>
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  app.post('/wallet/spend', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const studentId = req.session.user.id;
    const amount = Math.max(Number(req.body.amount) || 0, 0);
    const vendor = String(req.body.vendor || 'other').slice(0, 100);
    const description = String(req.body.description || '').slice(0, 200);
    const vendorInfo = VENDORS.find(v => v.id === vendor) || VENDORS[4];

    if (amount < 50) return res.status(400).send('Minimum spend is 50');

    const wallet = await getOrCreateWallet(tid, studentId);
    await resetDailyIfNeeded(wallet);

    if (wallet.frozen) return res.status(403).send('Wallet is frozen. Contact admin.');
    if (Number(wallet.balance) < amount) return res.status(400).send('Insufficient balance');
    if (Number(wallet.daily_spend_total) + amount > Number(wallet.daily_spend_limit)) {
      return res.status(400).send(`Daily spend limit exceeded. Used: ${Number(wallet.daily_spend_total).toLocaleString()} of ${Number(wallet.daily_spend_limit).toLocaleString()}`);
    }

    const ref = 'SPD-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();

    await pool.query(
      `UPDATE wallet_accounts SET balance = balance - $1, daily_spend_total = daily_spend_total + $1, updated_at = NOW() WHERE id = $2`,
      [amount, wallet.id]
    );
    const updated = await pool.query(`SELECT balance FROM wallet_accounts WHERE id = $1`, [wallet.id]);
    const newBalance = Number(updated.rows[0].balance);

    await pool.query(
      `INSERT INTO wallet_transactions (tenant_id, account_id, student_id, type, amount, vendor, description, reference, balance_after)
       VALUES ($1, $2, $3, 'spend', $4, $5, $6, $7, $8)`,
      [tid, wallet.id, studentId, amount, vendorInfo.label, description, ref, newBalance]
    );

    audit('wallet_spend', { tenantId: tid, studentId, amount, vendor, reference: ref });
    res.redirect('/wallet');
  }));

  // ═══════════════════════════════════════════════════
  // 4. TRANSFER (Student-to-Student)
  // ═══════════════════════════════════════════════════
  app.get('/wallet/transfer', requireAuth, ah(async (req, res) => {
    const html = renderPage('Transfer Money', `
      <div style="max-width:480px;margin:0 auto;padding:24px">
        <h1 style="font-size:24px;font-weight:700;color:#111827;margin-bottom:20px">↔ Transfer Money</h1>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">
          <form method="POST" action="/wallet/transfer" role="form" aria-label="Transfer form">
            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Recipient Student ID *</label>
            <input type="number" name="toStudentId" required placeholder="Enter student ID"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:16px;box-sizing:border-box" aria-required="true"/>

            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Amount *</label>
            <input type="number" name="amount" min="100" step="100" required placeholder="e.g. 2000"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:16px;box-sizing:border-box" aria-required="true"/>

            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Note (Optional)</label>
            <input type="text" name="note" placeholder="e.g. For group project" maxlength="200"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:16px;box-sizing:border-box"/>

            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Your PIN *</label>
            <input type="password" name="pin" required minlength="4" maxlength="6" placeholder="Enter 4-6 digit PIN"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:20px;box-sizing:border-box" aria-required="true" autocomplete="off"/>

            <button type="submit" style="width:100%;background:#0891b2;color:#fff;border:none;padding:12px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">↔ Send Money</button>
          </form>
          <div style="margin-top:12px;padding:12px;background="#fffbeb;border-radius:8px;font-size:13px;color:#92400e">
            ⚠ Daily transfer limit applies. PIN is required for security.
          </div>
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  app.post('/wallet/transfer', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const studentId = req.session.user.id;
    const toStudentId = Number(req.body.toStudentId);
    const amount = Math.max(Number(req.body.amount) || 0, 0);
    const note = String(req.body.note || 'Transfer').slice(0, 200);
    const pin = String(req.body.pin || '');

    if (toStudentId === studentId) return res.status(400).send('Cannot transfer to yourself');
    if (amount < 100) return res.status(400).send('Minimum transfer is 100');
    if (!/^\d{4,6}$/.test(pin)) return res.status(400).send('PIN must be 4-6 digits');

    const wallet = await getOrCreateWallet(tid, studentId);
    await resetDailyIfNeeded(wallet);

    if (wallet.frozen) return res.status(403).send('Wallet is frozen. Contact admin.');
    if (!wallet.pin_hash) return res.status(403).send('Please set a PIN first at /wallet/pin');
    // Simple PIN check (in production use bcrypt)
    const crypto = require('crypto');
    const inputHash = crypto.createHash('sha256').update(pin).digest('hex');
    if (inputHash !== wallet.pin_hash) return res.status(403).send('Incorrect PIN');

    if (Number(wallet.balance) < amount) return res.status(400).send('Insufficient balance');
    if (Number(wallet.daily_transfer_total) + amount > Number(wallet.daily_transfer_limit)) {
      return res.status(400).send(`Daily transfer limit exceeded. Used: ${Number(wallet.daily_transfer_total).toLocaleString()} of ${Number(wallet.daily_transfer_limit).toLocaleString()}`);
    }

    const toWallet = await getOrCreateWallet(tid, toStudentId);
    if (toWallet.frozen) return res.status(400).send('Recipient wallet is frozen');

    const ref = 'TRF-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8).toUpperCase();

    // Debit sender
    await pool.query(
      `UPDATE wallet_accounts SET balance = balance - $1, daily_transfer_total = daily_transfer_total + $1, updated_at = NOW() WHERE id = $2`,
      [amount, wallet.id]
    );
    const senderBal = await pool.query(`SELECT balance FROM wallet_accounts WHERE id = $1`, [wallet.id]);
    await pool.query(
      `INSERT INTO wallet_transactions (tenant_id, account_id, student_id, type, amount, description, reference, counterparty_id, balance_after)
       VALUES ($1,$2,$3,'transfer_out',$4,$5,$6,$7,$8)`,
      [tid, wallet.id, studentId, amount, `Transfer to student #${toStudentId}: ${note}`, ref, toStudentId, Number(senderBal.rows[0].balance)]
    );

    // Credit recipient
    await pool.query(
      `UPDATE wallet_accounts SET balance = balance + $1, updated_at = NOW() WHERE id = $2`,
      [amount, toWallet.id]
    );
    const recipBal = await pool.query(`SELECT balance FROM wallet_accounts WHERE id = $1`, [toWallet.id]);
    await pool.query(
      `INSERT INTO wallet_transactions (tenant_id, account_id, student_id, type, amount, description, reference, counterparty_id, balance_after)
       VALUES ($1,$2,$3,'transfer_in',$4,$5,$6,$7,$8)`,
      [tid, toWallet.id, toStudentId, amount, `Transfer from student #${studentId}: ${note}`, ref, studentId, Number(recipBal.rows[0].balance)]
    );

    audit('wallet_transfer', { tenantId: tid, from: studentId, to: toStudentId, amount, reference: ref });
    res.redirect('/wallet');
  }));

  // ═══════════════════════════════════════════════════
  // SET PIN
  // ═══════════════════════════════════════════════════
  app.get('/wallet/pin', requireAuth, ah(async (req, res) => {
    const html = renderPage('Set Transfer PIN', `
      <div style="max-width:400px;margin:0 auto;padding:24px">
        <h1 style="font-size:24px;font-weight:700;color:#111827;margin-bottom:20px">🔑 Set Transfer PIN</h1>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px">
          <form method="POST" action="/wallet/pin" role="form" aria-label="Set PIN form">
            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">New PIN (4-6 digits) *</label>
            <input type="password" name="pin" required minlength="4" maxlength="6" placeholder="Enter new PIN"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:16px;box-sizing:border-box" autocomplete="off"/>
            <label style="display:block;margin-bottom:4px;font-size:14px;font-weight:600;color:#374151">Confirm PIN *</label>
            <input type="password" name="pin2" required minlength="4" maxlength="6" placeholder="Confirm new PIN"
              style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;margin-bottom:20px;box-sizing:border-box" autocomplete="off"/>
            <button type="submit" style="width:100%;background:#4f46e5;color:#fff;border:none;padding:12px;border-radius:8px;font-size:16px;font-weight:600;cursor:pointer">Save PIN</button>
          </form>
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  app.post('/wallet/pin', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const studentId = req.session.user.id;
    const pin = String(req.body.pin || '');
    const pin2 = String(req.body.pin2 || '');
    if (!/^\d{4,6}$/.test(pin)) return res.status(400).send('PIN must be 4-6 digits');
    if (pin !== pin2) return res.status(400).send('PINs do not match');
    const crypto = require('crypto');
    const hash = crypto.createHash('sha256').update(pin).digest('hex');
    const wallet = await getOrCreateWallet(tid, studentId);
    await pool.query(`UPDATE wallet_accounts SET pin_hash = $1, updated_at = NOW() WHERE id = $2`, [hash, wallet.id]);
    audit('wallet_pin_set', { tenantId: tid, studentId });
    res.redirect('/wallet');
  }));

  // ═══════════════════════════════════════════════════
  // 5. TRANSACTION HISTORY
  // ═══════════════════════════════════════════════════
  app.get('/wallet/history', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const studentId = req.session.user.id;
    const page = Math.max(Number(req.query.page) || 1, 1);
    const limit = 20;
    const offset = (page - 1) * limit;
    const typeFilter = String(req.query.type || '').trim();
    const search = String(req.query.search || '').trim();
    const fromDate = String(req.query.from || '').trim();
    const toDate = String(req.query.to || '').trim();

    let where = `WHERE tenant_id = $1 AND student_id = $2`;
    const params = [tid, studentId];
    let paramIdx = 3;

    if (typeFilter && ['topup','spend','transfer_in','transfer_out','savings_in','savings_out','interest','refund'].includes(typeFilter)) {
      where += ` AND type = $${paramIdx++}`;
      params.push(typeFilter);
    }
    if (search) {
      where += ` AND (description ILIKE $${paramIdx} OR vendor ILIKE $${paramIdx} OR reference ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }
    if (fromDate) {
      where += ` AND created_at >= $${paramIdx++}`;
      params.push(fromDate + ' 00:00:00');
    }
    if (toDate) {
      where += ` AND created_at <= $${paramIdx++}`;
      params.push(toDate + ' 23:59:59');
    }

    const countResult = await pool.query(`SELECT COUNT(*) as total FROM wallet_transactions ${where}`, params);
    const totalPages = Math.ceil(Number(countResult.rows[0].total) / limit);

    const dataResult = await pool.query(
      `SELECT * FROM wallet_transactions ${where} ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );
    const transactions = dataResult.rows;

    // CSV export check
    if (req.query.format === 'csv') {
      let csv = 'Date,Type,Vendor,Description,Amount,Balance After,Reference\n';
      transactions.forEach(t => {
        csv += `"${t.created_at?.toISOString?.().slice(0,19)?.replace('T',' ') || ''}","${t.type}","${t.vendor || ''}","${(t.description || '').replace(/"/g,'""')}","${t.amount}","${t.balance_after}","${t.reference || ''}"\n`;
      });
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=wallet-history.csv');
      return res.send(csv);
    }

    const typeOptions = ['','topup','spend','transfer_in','transfer_out','savings_in','savings_out','interest','refund']
      .map(t => `<option value="${t}" ${t === typeFilter ? 'selected' : ''}>${t || 'All Types'}</option>`).join('');

    let txRows = '';
    transactions.forEach(t => {
      const sign = (t.type === 'spend' || t.type === 'transfer_out' || t.type === 'savings_in') ? '-' : '+';
      const amtColor = (t.type === 'spend' || t.type === 'transfer_out' || t.type === 'savings_in') ? '#dc2626' : '#16a34a';
      txRows += `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:8px 10px;font-size:13px;color:#6b7280;white-space:nowrap">${esc(t.created_at?.toISOString?.().slice(0,16)?.replace('T',' ') || '')}</td>
        <td style="padding:8px 10px"><span style="background:#eef2ff;color:#4f46e5;padding:2px 8px;border-radius:10px;font-size:11px">${esc(t.type)}</span></td>
        <td style="padding:8px 10px;font-size:13px">${esc(t.vendor || '')}</td>
        <td style="padding:8px 10px;font-size:13px">${esc(t.description || '')}</td>
        <td style="padding:8px 10px;font-size:13px;font-weight:600;color:${amtColor};text-align:right">${sign}${Number(t.amount).toLocaleString()}</td>
        <td style="padding:8px 10px;font-size:13px;text-align:right">${Number(t.balance_after).toLocaleString()}</td>
      </tr>`;
    });

    let pagination = '';
    if (totalPages > 1) {
      const pages = [];
      for (let i = 1; i <= totalPages; i++) {
        if (i === 1 || i === totalPages || Math.abs(i - page) <= 2) {
          pages.push(i === page
            ? `<span style="background:#4f46e5;color:#fff;padding:4px 10px;border-radius:6px;font-size:13px">${i}</span>`
            : `<a href="?page=${i}&type=${esc(typeFilter)}&search=${esc(search)}&from=${esc(fromDate)}&to=${esc(toDate)}" style="padding:4px 10px;font-size:13px;color:#4f46e5;text-decoration:none">${i}</a>`
          );
        } else if (pages[pages.length - 1] !== '...') {
          pages.push('<span style="padding:4px 6px;color:#9ca3af">...</span>');
        }
      }
      pagination = `<div style="display:flex;gap:4px;justify-content:center;margin-top:16px">${pages.join('')}</div>`;
    }

    const html = renderPage('Transaction History', `
      <div style="max-width:960px;margin:0 auto;padding:24px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
          <h1 style="font-size:24px;font-weight:700;color:#111827;margin:0">📋 Transaction History</h1>
          <a href="?format=csv&type=${esc(typeFilter)}&search=${esc(search)}&from=${esc(fromDate)}&to=${esc(toDate)}" style="display:inline-flex;align-items:center;gap:6px;background:#16a34a;color:#fff;padding:8px 16px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:600">📥 Export CSV</a>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;margin-bottom:20px">
          <form method="GET" role="search" aria-label="Filter transactions" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">
            <div>
              <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:3px">Type</label>
              <select name="type" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px">${typeOptions}</select>
            </div>
            <div>
              <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:3px">Search</label>
              <input type="text" name="search" value="${esc(search)}" placeholder="Search..." style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;width:160px"/>
            </div>
            <div>
              <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:3px">From</label>
              <input type="date" name="from" value="${esc(fromDate)}" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px"/>
            </div>
            <div>
              <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:3px">To</label>
              <input type="date" name="to" value="${esc(toDate)}" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px"/>
            </div>
            <button type="submit" style="background:#4f46e5;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">Filter</button>
            <a href="/wallet/history" style="padding:8px 14px;color:#6b7280;text-decoration:none;font-size:13px">Clear</a>
          </form>
        </div>

        <div style="font-size:13px;color:#6b7280;margin-bottom:12px">${countResult.rows[0].total} transactions found</div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;min-width:700px" role="table" aria-label="Transaction history">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Date</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Type</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Vendor</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Description</th>
              <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600">Amount</th>
              <th style="padding:10px 12px;text-align:right;font-size:12px;color:#6b7280;font-weight:600">Balance</th>
            </tr></thead>
            <tbody>${txRows || '<tr><td colspan="6" style="padding:24px;text-align:center;color:#9ca3af">No transactions found</td></tr>'}</tbody>
          </table>
        </div>
        ${pagination}
      </div>
    `, req.session.user);
    res.send(html);
  }));

  // ═══════════════════════════════════════════════════
  // 6. ADMIN CONTROLS
  // ═══════════════════════════════════════════════════
  function requireAdmin(req, res, next) {
    if (!req.session?.user || !['admin', 'superadmin'].includes(req.session.user.role)) {
      return res.status(403).send('Access denied. Admin only.');
    }
    next();
  }

  app.get('/wallet/admin', requireAuth, requireAdmin, ah(async (req, res) => {
    const tid = tenantId(req);
    const result = await pool.query(
      `SELECT wa.*, s.name as student_name FROM wallet_accounts wa
       LEFT JOIN students s ON s.id = wa.student_id AND s.tenant_id = wa.tenant_id
       WHERE wa.tenant_id = $1 ORDER BY wa.created_at DESC LIMIT 100`,
      [tid]
    );
    const wallets = result.rows;

    let rows = '';
    wallets.forEach(w => {
      const bal = Number(w.balance);
      const statusColor = w.frozen ? '#dc2626' : bal > 1000 ? '#16a34a' : bal > 500 ? '#d97706' : '#dc2626';
      const statusText = w.frozen ? '❄ Frozen' : '✓ Active';
      rows += `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 12px;font-size:13px">${esc(w.student_name || 'Student #' + w.student_id)}</td>
        <td style="padding:10px 12px;font-size:13px">${w.student_id}</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:600;color:${statusColor}">${bal.toLocaleString()}</td>
        <td style="padding:10px 12px;font-size:13px;color:#4f46e5;font-weight:600">${Number(w.savings_balance).toLocaleString()}</td>
        <td style="padding:10px 12px;font-size:13px">${Number(w.daily_spend_limit).toLocaleString()}</td>
        <td style="padding:10px 12px;font-size:13px">${Number(w.daily_transfer_limit).toLocaleString()}</td>
        <td style="padding:10px 12px;font-size:12px;color:${statusColor}">${statusText}</td>
        <td style="padding:10px 12px;font-size:12px">
          <form method="POST" action="/wallet/admin/toggle-freeze" style="display:inline">
            <input type="hidden" name="accountId" value="${w.id}"/>
            <button style="background:${w.frozen ? '#16a34a' : '#dc2626'};color:#fff;border:none;padding:4px 10px;border-radius:4px;font-size:12px;cursor:pointer">${w.frozen ? 'Unfreeze' : 'Freeze'}</button>
          </form>
        </td>
      </tr>`;
    });

    const html = renderPage('Wallet Admin', `
      <div style="max-width:1100px;margin:0 auto;padding:24px">
        <h1 style="font-size:26px;font-weight:700;color:#111827;margin-bottom:20px">⚙ Wallet Admin Controls</h1>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:24px">
          <h2 style="font-size:16px;font-weight:600;margin-bottom:12px;color:#374151">Update Student Limits</h2>
          <form method="POST" action="/wallet/admin/limits" role="form" aria-label="Update limits">
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
              <div>
                <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:3px">Student ID</label>
                <input type="number" name="studentId" required style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;width:120px"/>
              </div>
              <div>
                <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:3px">Daily Spend Limit</label>
                <input type="number" name="spendLimit" value="${DEFAULTS.dailySpendLimit}" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;width:130px"/>
              </div>
              <div>
                <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:3px">Daily Transfer Limit</label>
                <input type="number" name="transferLimit" value="${DEFAULTS.dailyTransferLimit}" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;width:130px"/>
              </div>
              <button type="submit" style="background:#4f46e5;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">Update</button>
            </div>
          </form>
        </div>

        <h2 style="font-size:18px;font-weight:600;color:#111827;margin-bottom:12px">All Student Wallets (${wallets.length})</h2>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;min-width:800px" role="table" aria-label="All student wallets">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Student</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">ID</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Balance</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Savings</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Spend Limit</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Transfer Limit</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Status</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Action</th>
            </tr></thead>
            <tbody>${rows || '<tr><td colspan="8" style="padding:24px;text-align:center;color:#9ca3af">No wallets found</td></tr>'}</tbody>
          </table>
        </div>

        <div style="margin-top:24px;display:flex;gap:10px;flex-wrap:wrap">
          <a href="/wallet/admin/reports" style="display:inline-flex;align-items:center;gap:6px;background:#7c3aed;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">📊 View Reports</a>
          <a href="/wallet/admin/apply-interest" style="display:inline-flex;align-items:center;gap:6px;background:#0891b2;color:#fff;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px">📈 Apply Savings Interest</a>
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  app.post('/wallet/admin/limits', requireAuth, requireAdmin, ah(async (req, res) => {
    const tid = tenantId(req);
    const studentId = Number(req.body.studentId);
    const spendLimit = Math.max(Number(req.body.spendLimit) || DEFAULTS.dailySpendLimit, 0);
    const transferLimit = Math.max(Number(req.body.transferLimit) || DEFAULTS.dailyTransferLimit, 0);
    await pool.query(
      `UPDATE wallet_accounts SET daily_spend_limit = $1, daily_transfer_limit = $2, updated_at = NOW() WHERE tenant_id = $3 AND student_id = $4`,
      [spendLimit, transferLimit, tid, studentId]
    );
    audit('wallet_limits_updated', { tenantId: tid, studentId, spendLimit, transferLimit });
    res.redirect('/wallet/admin');
  }));

  app.post('/wallet/admin/toggle-freeze', requireAuth, requireAdmin, ah(async (req, res) => {
    const accountId = Number(req.body.accountId);
    await pool.query(
      `UPDATE wallet_accounts SET frozen = NOT frozen, updated_at = NOW() WHERE id = $1`, [accountId]
    );
    audit('wallet_freeze_toggled', { tenantId: tenantId(req), accountId });
    res.redirect('/wallet/admin');
  }));

  // ═══════════════════════════════════════════════════
  // 7. SAVINGS FEATURE
  // ═══════════════════════════════════════════════════
  app.get('/wallet/savings', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const studentId = req.session.user.id;
    const wallet = await getOrCreateWallet(tid, studentId);

    const savingsResult = await pool.query(
      `SELECT * FROM wallet_savings WHERE tenant_id = $1 AND student_id = $2 AND withdrawn = FALSE ORDER BY lock_until ASC`,
      [tid, studentId]
    );

    let savingsRows = '';
    savingsResult.rows.forEach(s => {
      const isLocked = new Date(s.lock_until) > new Date();
      savingsRows += `<tr style="border-bottom:1px solid #f3f4f6">
        <td style="padding:10px 12px;font-size:13px">${s.created_at?.toISOString?.().slice(0,10) || ''}</td>
        <td style="padding:10px 12px;font-size:13px;font-weight:600">${Number(s.amount).toLocaleString()}</td>
        <td style="padding:10px 12px;font-size:13px">${(Number(s.interest_rate) * 100).toFixed(1)}%</td>
        <td style="padding:10px 12px;font-size:13px">${s.lock_until?.toISOString?.().slice(0,10) || ''}</td>
        <td style="padding:10px 12px;font-size:13px">
          ${isLocked
            ? '<span style="color:#d97706">🔒 Locked</span>'
            : `<form method="POST" action="/wallet/savings/withdraw" style="display:inline"><input type="hidden" name="savingsId" value="${s.id}"/><button style="background:#16a34a;color:#fff;border:none;padding:4px 12px;border-radius:4px;font-size:12px;cursor:pointer">Withdraw</button></form>`}
        </td>
      </tr>`;
    });

    const earnedInterest = Number(wallet.savings_balance) - savingsResult.rows.reduce((sum, s) => sum + Number(s.amount), 0);

    const html = renderPage('My Savings', `
      <div style="max-width:800px;margin:0 auto;padding:24px">
        <div style="display:flex;align-items:center;gap:16px;margin-bottom:24px">
          <h1 style="font-size:24px;font-weight:700;color:#111827;margin:0">🏦 My Savings</h1>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px;margin-bottom:24px">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:13px;color:#9ca3af;margin-bottom:4px">Total Savings</div>
            <div style="font-size:24px;font-weight:700;color:#4f46e5">${Number(wallet.savings_balance).toLocaleString()}</div>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:13px;color:#9ca3af;margin-bottom:4px">Active Locks</div>
            <div style="font-size:24px;font-weight:700;color:#374151">${savingsResult.rows.length}</div>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;text-align:center">
            <div style="font-size:13px;color:#9ca3af;margin-bottom:4px">Earned Interest</div>
            <div style="font-size:24px;font-weight:700;color:#16a34a">${Math.max(0, earnedInterest).toLocaleString()}</div>
          </div>
        </div>

        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:24px">
          <h2 style="font-size:16px;font-weight:600;margin-bottom:12px;color:#374151">Start New Savings</h2>
          <form method="POST" action="/wallet/savings" role="form" aria-label="New savings form">
            <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:end">
              <div>
                <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:3px">Amount * (min ${DEFAULTS.minSavingsAmount})</label>
                <input type="number" name="amount" min="${DEFAULTS.minSavingsAmount}" step="100" required
                  style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px;width:130px"/>
              </div>
              <div>
                <label style="display:block;font-size:12px;color:#6b7280;margin-bottom:3px">Lock Period (days)</label>
                <select name="lockDays" style="padding:8px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:14px">
                  <option value="7">7 Days (0.5%)</option>
                  <option value="14">14 Days (0.8%)</option>
                  <option value="30" selected>30 Days (1.2%)</option>
                  <option value="90">90 Days (2.0%)</option>
                  <option value="180">180 Days (3.5%)</option>
                </select>
              </div>
              <button type="submit" style="background:#4f46e5;color:#fff;border:none;padding:8px 18px;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer">🔒 Lock Savings</button>
            </div>
            <p style="font-size:12px;color:#6b7280;margin-top:10px">💡 Longer lock periods earn higher virtual interest rates. Funds are locked until the end date. This teaches discipline and compound growth!</p>
          </form>
        </div>

        <h2 style="font-size:18px;font-weight:600;color:#111827;margin-bottom:12px">Savings History</h2>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow-x:auto">
          <table style="width:100%;border-collapse:collapse;min-width:600px" role="table" aria-label="Savings history">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb">
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Start Date</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Amount</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Rate</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Unlock Date</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;font-weight:600">Action</th>
            </tr></thead>
            <tbody>${savingsRows || '<tr><td colspan="5" style="padding:24px;text-align:center;color:#9ca3af">No active savings. Start saving today!</td></tr>'}</tbody>
          </table>
        </div>

        <div style="margin-top:20px;padding:16px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:12px">
          <h3 style="font-size:14px;font-weight:600;color:#166534;margin:0 0 8px 0">📚 Financial Literacy Tip</h3>
          <p style="font-size:13px;color:#15803d;margin:0;line-height:1.6">Saving early teaches the power of compound interest. Even small amounts saved regularly grow significantly over time. The longer you lock your savings, the higher the interest rate you earn!</p>
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));

  app.post('/wallet/savings', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const studentId = req.session.user.id;
    const amount = Math.max(Number(req.body.amount) || 0, 0);
    const lockDays = Math.max(Number(req.body.lockDays) || 30, DEFAULTS.minSavingsLockDays);

    if (amount < DEFAULTS.minSavingsAmount) return res.status(400).send(`Minimum savings amount is ${DEFAULTS.minSavingsAmount}`);

    const wallet = await getOrCreateWallet(tid, studentId);
    if (Number(wallet.balance) < amount) return res.status(400).send('Insufficient balance');

    const rateMap = { 7: 0.005, 14: 0.008, 30: 0.012, 90: 0.02, 180: 0.035 };
    const interestRate = rateMap[lockDays] || DEFAULTS.maxSavingsInterestRate;
    const lockUntil = new Date();
    lockUntil.setDate(lockUntil.getDate() + lockDays);

    await pool.query(
      `UPDATE wallet_accounts SET balance = balance - $1, savings_balance = savings_balance + $1, updated_at = NOW() WHERE id = $2`,
      [amount, wallet.id]
    );
    const newBal = await pool.query(`SELECT balance FROM wallet_accounts WHERE id = $1`, [wallet.id]);

    await pool.query(
      `INSERT INTO wallet_savings (tenant_id, account_id, student_id, amount, interest_rate, lock_until) VALUES ($1,$2,$3,$4,$5,$6)`,
      [tid, wallet.id, studentId, amount, interestRate, lockUntil]
    );

    await pool.query(
      `INSERT INTO wallet_transactions (tenant_id, account_id, student_id, type, amount, description, balance_after) VALUES ($1,$2,$3,'savings_in',$4,'Moved to savings (lock: ${lockDays}d)',$5)`,
      [tid, wallet.id, studentId, amount, Number(newBal.rows[0].balance)]
    );

    audit('wallet_savings_created', { tenantId: tid, studentId, amount, lockDays, interestRate });
    res.redirect('/wallet/savings');
  }));

  app.post('/wallet/savings/withdraw', requireAuth, ah(async (req, res) => {
    const tid = tenantId(req);
    const studentId = req.session.user.id;
    const savingsId = Number(req.body.savingsId);

    const savResult = await pool.query(
      `SELECT * FROM wallet_savings WHERE id = $1 AND tenant_id = $2 AND student_id = $3 AND withdrawn = FALSE`,
      [savingsId, tid, studentId]
    );
    if (!savResult.rows.length) return res.status(404).send('Savings record not found');

    const sav = savResult.rows[0];
    if (new Date(sav.lock_until) > new Date()) return res.status(400).send('Savings still locked until ' + sav.lock_until.toISOString().slice(0, 10));

    const interest = Number(sav.amount) * Number(sav.interest_rate);
    const total = Number(sav.amount) + interest;

    await pool.query(
      `UPDATE wallet_savings SET withdrawn = TRUE, withdrawn_at = NOW() WHERE id = $1`, [savingsId]
    );

    await pool.query(
      `UPDATE wallet_accounts SET balance = balance + $1, savings_balance = savings_balance - $2, updated_at = NOW() WHERE id = $3`,
      [total, Number(sav.amount), sav.account_id]
    );
    const newBal = await pool.query(`SELECT balance FROM wallet_accounts WHERE id = $1`, [sav.account_id]);

    await pool.query(
      `INSERT INTO wallet_transactions (tenant_id, account_id, student_id, type, amount, description, balance_after) VALUES ($1,$2,$3,'savings_out',$4,'Savings withdrawn (incl. interest: ${interest.toFixed(0)})',$5)`,
      [tid, sav.account_id, studentId, total, Number(newBal.rows[0].balance)]
    );

    if (interest > 0) {
      await pool.query(
        `INSERT INTO wallet_transactions (tenant_id, account_id, student_id, type, amount, description, balance_after) VALUES ($1,$2,$3,'interest',$4,'Savings interest earned',$5)`,
        [tid, sav.account_id, studentId, interest, Number(newBal.rows[0].balance)]
      );
    }

    audit('wallet_savings_withdrawn', { tenantId: tid, studentId, savingsId, amount: total, interest });
    res.redirect('/wallet/savings');
  }));

  // Apply interest (admin action)
  app.get('/wallet/admin/apply-interest', requireAuth, requireAdmin, ah(async (req, res) => {
    const tid = tenantId(req);
    const result = await pool.query(
      `SELECT * FROM wallet_savings WHERE tenant_id = $1 AND withdrawn = FALSE AND lock_until <= NOW()`,
      [tid]
    );
    let updated = 0;
    for (const sav of result.rows) {
      const interest = Number(sav.amount) * Number(sav.interest_rate);
      await pool.query(
        `UPDATE wallet_savings SET amount = amount + $1 WHERE id = $2`, [interest, sav.id]
      );
      await pool.query(
        `UPDATE wallet_accounts SET savings_balance = savings_balance + $1 WHERE id = $2`, [interest, sav.account_id]
      );
      await pool.query(
        `INSERT INTO wallet_transactions (tenant_id, account_id, student_id, type, amount, description, balance_after)
         VALUES ($1,$2,$3,'interest',$4,'Savings interest credited',$5)`,
        [tid, sav.account_id, sav.student_id, interest, 0]
      );
      updated++;
    }
    audit('wallet_interest_applied', { tenantId: tid, updated });
    res.send(`<div style="max-width:400px;margin:100px auto;padding:24px;text-align:center;background:#fff;border:1px solid #e5e7eb;border-radius:12px">
      <h2 style="color:#16a34a">✅ Interest Applied</h2>
      <p style="color:#374151">${updated} savings records updated with interest.</p>
      <a href="/wallet/admin" style="color:#4f46e5;text-decoration:none;font-weight:600">← Back to Admin</a>
    </div>`);
  }));

  // ═══════════════════════════════════════════════════
  // 8. REPORTS (SVG Charts)
  // ═══════════════════════════════════════════════════
  app.get('/wallet/admin/reports', requireAuth, requireAdmin, ah(async (req, res) => {
    const tid = tenantId(req);
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), 365);

    // ── Spending by category donut ──
    const catResult = await pool.query(
      `SELECT vendor, SUM(amount) as total FROM wallet_transactions WHERE tenant_id = $1 AND type = 'spend' AND created_at >= NOW() - INTERVAL '1 day' * $2 GROUP BY vendor ORDER BY total DESC`,
      [tid, days]
    );
    const donutData = catResult.rows.map(r => ({ label: r.vendor || 'Other', value: Number(r.total) }));
    const donut = svgDonut(donutData, 280);

    // ── Daily spending trend ──
    const trendResult = await pool.query(
      `SELECT created_at::date as day, SUM(amount) as total FROM wallet_transactions
       WHERE tenant_id = $1 AND type IN ('spend','transfer_out') AND created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY created_at::date ORDER BY day`,
      [tid, days]
    );
    const trendData = trendResult.rows.map(r => ({
      label: (r.day || '').toString().slice(5, 10),
      value: Number(r.total)
    }));
    const lineChart = svgLine(trendData, 520, 220);

    // ── Top spenders bar chart ──
    const topResult = await pool.query(
      `SELECT wt.student_id, COALESCE(s.name, 'Student #' || wt.student_id) as name, SUM(wt.amount) as total
       FROM wallet_transactions wt
       LEFT JOIN students s ON s.id = wt.student_id AND s.tenant_id = wt.tenant_id
       WHERE wt.tenant_id = $1 AND wt.type = 'spend' AND wt.created_at >= NOW() - INTERVAL '1 day' * $2
       GROUP BY wt.student_id, s.name ORDER BY total DESC LIMIT 10`,
      [tid, days]
    );
    const barData = topResult.rows.map(r => ({ label: (r.name || '').slice(0, 15), value: Number(r.total) }));
    const barChart = svgBar(barData, 520, 240);

    // ── Wallet distribution histogram ──
    const distResult = await pool.query(
      `SELECT balance FROM wallet_accounts WHERE tenant_id = $1`, [tid]
    );
    const balances = distResult.rows.map(r => Number(r.balance));
    const buckets = [
      { label: '0', min: 0, max: 1, count: 0 },
      { label: '1-500', min: 1, max: 500, count: 0 },
      { label: '501-1K', min: 501, max: 1000, count: 0 },
      { label: '1K-5K', min: 1001, max: 5000, count: 0 },
      { label: '5K-10K', min: 5001, max: 10000, count: 0 },
      { label: '10K-50K', min: 10001, max: 50000, count: 0 },
      { label: '50K+', min: 50001, max: Infinity, count: 0 }
    ];
    balances.forEach(b => {
      const bucket = buckets.find(bk => b >= bk.min && b <= bk.max);
      if (bucket) bucket.count++;
    });
    const histogram = svgHistogram(buckets, 520, 200);

    // ── Summary stats ──
    const totalTopups = await pool.query(
      `SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE tenant_id = $1 AND type = 'topup' AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [tid, days]
    );
    const totalSpends = await pool.query(
      `SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE tenant_id = $1 AND type = 'spend' AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [tid, days]
    );
    const totalTransfers = await pool.query(
      `SELECT COALESCE(SUM(amount),0) as total FROM wallet_transactions WHERE tenant_id = $1 AND type = 'transfer_out' AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [tid, days]
    );
    const totalSavings = await pool.query(
      `SELECT COALESCE(SUM(savings_balance),0) as total FROM wallet_accounts WHERE tenant_id = $1`, [tid]
    );
    const txCount = await pool.query(
      `SELECT COUNT(*) as cnt FROM wallet_transactions WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '1 day' * $2`,
      [tid, days]
    );

    const html = renderPage('Wallet Reports', `
      <div style="max-width:1120px;margin:0 auto;padding:24px">
        <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
          <h1 style="font-size:26px;font-weight:700;color:#111827;margin:0">📊 Wallet Reports</h1>
          <div style="display:flex;gap:8px;align-items:center">
            <label style="font-size:13px;color:#6b7280">Period:</label>
            <a href="?days=7" style="padding:6px 12px;border-radius:6px;font-size:13px;text-decoration:none;color:#4f46e5;background:${days===7?'#eef2ff':'#fff'};border:1px solid ${days===7?'#4f46e5':'#d1d5db'}">7d</a>
            <a href="?days=30" style="padding:6px 12px;border-radius:6px;font-size:13px;text-decoration:none;color:#4f46e5;background:${days===30?'#eef2ff':'#fff'};border:1px solid ${days===30?'#4f46e5':'#d1d5db'}">30d</a>
            <a href="?days=90" style="padding:6px 12px;border-radius:6px;font-size:13px;text-decoration:none;color:#4f46e5;background:${days===90?'#eef2ff':'#fff'};border:1px solid ${days===90?'#4f46e5':'#d1d5db'}">90d</a>
            <a href="?days=365" style="padding:6px 12px;border-radius:6px;font-size:13px;text-decoration:none;color:#4f46e5;background:${days===365?'#eef2ff':'#fff'};border:1px solid ${days===365?'#4f46e5':'#d1d5db'}">1y</a>
          </div>
        </div>

        <!-- Summary Cards -->
        <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:14px;margin-bottom:28px">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;text-align:center">
            <div style="font-size:12px;color:#9ca3af;margin-bottom:4px">Total Top-Ups</div>
            <div style="font-size:22px;font-weight:700;color:#16a34a">${Number(totalTopups.rows[0].total).toLocaleString()}</div>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;text-align:center">
            <div style="font-size:12px;color:#9ca3af;margin-bottom:4px">Total Spent</div>
            <div style="font-size:22px;font-weight:700;color:#dc2626">${Number(totalSpends.rows[0].total).toLocaleString()}</div>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;text-align:center">
            <div style="font-size:12px;color:#9ca3af;margin-bottom:4px">Total Transfers</div>
            <div style="font-size:22px;font-weight:700;color:#0891b2">${Number(totalTransfers.rows[0].total).toLocaleString()}</div>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;text-align:center">
            <div style="font-size:12px;color:#9ca3af;margin-bottom:4px">Total Savings</div>
            <div style="font-size:22px;font-weight:700;color:#4f46e5">${Number(totalSavings.rows[0].total).toLocaleString()}</div>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px;text-align:center">
            <div style="font-size:12px;color:#9ca3af;margin-bottom:4px">Transactions</div>
            <div style="font-size:22px;font-weight:700;color:#7c3aed">${Number(txCount.rows[0].cnt).toLocaleString()}</div>
          </div>
        </div>

        <!-- Charts Grid -->
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
            <h3 style="font-size:15px;font-weight:600;color:#374151;margin:0 0 12px 0">Spending by Category</h3>
            <div style="text-align:center">${donut}</div>
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
            <h3 style="font-size:15px;font-weight:600;color:#374151;margin:0 0 12px 0">Daily Spending Trend</h3>
            ${lineChart}
          </div>
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
            <h3 style="font-size:15px;font-weight:600;color:#374151;margin:0 0 12px 0">Top Spenders</h3>
            ${barChart}
          </div>
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px">
            <h3 style="font-size:15px;font-weight:600;color:#374151;margin:0 0 12px 0">Wallet Balance Distribution</h3>
            ${histogram}
          </div>
        </div>

        <div style="margin-top:20px">
          <a href="/wallet/admin" style="color:#4f46e5;text-decoration:none;font-weight:600;font-size:14px">← Back to Admin</a>
        </div>
      </div>
    `, req.session.user);
    res.send(html);
  }));
};
