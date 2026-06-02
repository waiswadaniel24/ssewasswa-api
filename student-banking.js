/**
 * Student Banking System
 * SaaS School Portal Module
 * Routes: /school/student-banking/*
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:14px}.btn:hover{background:#3730a3}.btn-sm{padding:5px 12px;font-size:12px}.btn-danger{background:#ef4444}.btn-danger:hover{background:#dc2626}.btn-success{background:#10b981}.btn-success:hover{background:#059669}.btn-outline{background:transparent;border:2px solid #4f46e5;color:#4f46e5}.btn-outline:hover{background:#4f46e5;color:#fff}table{width:100%;border-collapse:collapse}th,td{padding:10px 12px;text-align:left;border-bottom:1px solid #e5e7eb;font-size:14px}th{background:#f9fafb;font-weight:600;color:#374151}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;font-size:14px}input:focus,select:focus,textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}.grid{display:grid;gap:16px}.grid-2{grid-template-columns:repeat(2,1fr)}.grid-3{grid-template-columns:repeat(3,1fr)}.grid-4{grid-template-columns:repeat(4,1fr)}.stat-card{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.stat-label{font-size:13px;color:#6b7280;margin-bottom:4px}.stat-value{font-size:28px;font-weight:700;color:#111827}.badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600}.badge-green{background:#d1fae5;color:#065f46}.badge-red{background:#fee2e2;color:#991b1b}.badge-blue{background:#dbeafe;color:#1e40af}.badge-yellow{background:#fef3c7;color:#92400e}.badge-gray{background:#f3f4f6;color:#4b5563}.progress-bar{background:#e5e7eb;border-radius:8px;height:10px;overflow:hidden}.progress-fill{height:100%;border-radius:8px;transition:width .3s}.alert{padding:12px 16px;border-radius:8px;margin-bottom:16px;font-size:14px}.alert-success{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}.alert-error{background:#fee2e2;color:#991b1b;border:1px solid #fca5a5}.alert-info{background:#dbeafe;color:#1e40af;border:1px solid #93c5fd}.tab-bar{display:flex;gap:0;border-bottom:2px solid #e5e7eb;margin-bottom:20px}.tab{padding:10px 20px;cursor:pointer;color:#6b7280;border-bottom:2px solid transparent;margin-bottom:-2px}.tab.active{color:#4f46e5;border-bottom-color:#4f46e5;font-weight:600}.form-group{margin-bottom:16px}.form-label{display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:6px}.empty-state{text-align:center;padding:48px 20px;color:#6b7280}.empty-state svg{width:64px;height:64px;margin-bottom:12px;opacity:.4}.amount-positive{color:#10b981}.amount-negative{color:#ef4444}.chart-container{background:#fff;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(0,0,0,.1);margin-bottom:16px}</style>';

  // ── Table creation ──────────────────────────────────────────────
  (async () => {
    try {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS bank_accounts (
          id BIGSERIAL PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          student_id VARCHAR(64) NOT NULL,
          account_number VARCHAR(32) NOT NULL,
          balance DECIMAL(15,2) NOT NULL DEFAULT 0.00,
          account_type TEXT NOT NULL DEFAULT 'checking',
          status TEXT NOT NULL DEFAULT 'active',
          daily_limit DECIMAL(15,2) DEFAULT 500.00,
          monthly_limit DECIMAL(15,2) DEFAULT 5000.00,
          parent_pin VARCHAR(64),
          interest_rate DECIMAL(5,4) DEFAULT 0.0200,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await migrateQuery(pool, 'StudentBanking', `
        CREATE TABLE IF NOT EXISTS bank_transactions (
          id BIGSERIAL PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          account_id BIGINT NOT NULL,
          type TEXT NOT NULL,
          amount DECIMAL(15,2) NOT NULL,
          description VARCHAR(512),
          category VARCHAR(64),
          merchant VARCHAR(128),
          reference VARCHAR(64),
          balance_after DECIMAL(15,2) NOT NULL,
          created_by VARCHAR(64),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await migrateQuery(pool, 'StudentBanking', `
        CREATE TABLE IF NOT EXISTS savings_goals (
          id BIGSERIAL PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          account_id BIGINT NOT NULL,
          name VARCHAR(128) NOT NULL,
          description TEXT,
          target_amount DECIMAL(15,2) NOT NULL,
          current_amount DECIMAL(15,2) NOT NULL DEFAULT 0.00,
          deadline DATE,
          status TEXT NOT NULL DEFAULT 'active',
          auto_contribute DECIMAL(15,2) DEFAULT 0.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await migrateQuery(pool, 'StudentBanking', `
        CREATE TABLE IF NOT EXISTS bank_budgets (
          id BIGSERIAL PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          account_id BIGINT NOT NULL,
          category VARCHAR(64) NOT NULL,
          monthly_limit DECIMAL(15,2) NOT NULL DEFAULT 0.00,
          period_month CHAR(7) NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          CONSTRAINT uk_budget UNIQUE (tenant_id, account_id, category, period_month)
        )
      `);
      await migrateQuery(pool, 'StudentBanking', `
        CREATE TABLE IF NOT EXISTS financial_lessons (
          id BIGSERIAL PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          title VARCHAR(256) NOT NULL,
          slug VARCHAR(256) NOT NULL,
          description TEXT,
          content TEXT,
          category VARCHAR(64) DEFAULT 'general',
          difficulty TEXT DEFAULT 'beginner',
          sort_order INT DEFAULT 0,
          is_published SMALLINT DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      await migrateQuery(pool, 'StudentBanking', `
        CREATE TABLE IF NOT EXISTS lesson_progress (
          id BIGSERIAL PRIMARY KEY,
          tenant_id VARCHAR(64) NOT NULL,
          student_id VARCHAR(64) NOT NULL,
          lesson_id BIGINT NOT NULL,
          status TEXT DEFAULT 'not_started',
          quiz_score INT DEFAULT NULL,
          completed_at TIMESTAMP NULL,
          CONSTRAINT uk_progress UNIQUE (tenant_id, student_id, lesson_id)
        )
      `);
      console.log('[StudentBanking] Tables ready');
    } catch(e) { /* migration OK */ }
  })();

  // ── Helpers ─────────────────────────────────────────────────────
  const CATEGORIES = ['food','transport','books','entertainment','clothing','health','savings','other'];
  const CAT_COLORS = { food:'#f59e0b', transport:'#3b82f6', books:'#8b5cf6', entertainment:'#ec4899', clothing:'#14b8a6', health:'#ef4444', savings:'#10b981', other:'#6b7280' };
  const CAT_LABELS = { food:'Food & Drinks', transport:'Transport', books:'Books & Supplies', entertainment:'Entertainment', clothing:'Clothing', health:'Health', savings:'Savings', other:'Other' };

  function generateAccountNumber() {
    const pfx = 'SB';
    const ts = Date.now().toString(36).toUpperCase();
    const rnd = Math.random().toString(36).substring(2, 6).toUpperCase();
    return pfx + ts + rnd;
  }

  function formatCurrency(n) {
    return (Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function svgDonut(data, size = 200) {
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}"><circle cx="${size/2}" cy="${size/2}" r="${size/2-10}" fill="none" stroke="#e5e7eb" stroke-width="20"/><text x="50%" y="50%" text-anchor="middle" dy=".35em" fill="${GRAY}" font-size="13">No data</text></svg>`;
    const cx = size / 2, cy = size / 2, r = size / 2 - 10;
    const circ = 2 * Math.PI * r;
    let acc = 0;
    let paths = '';
    let legend = '<div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:12px">';
    data.forEach(d => {
      const pct = d.value / total;
      const len = pct * circ;
      const offset = circ - acc;
      paths += `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${d.color}" stroke-width="20" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${offset}" transform="rotate(-90 ${cx} ${cy})" style="transition:stroke-dasharray .5s"/>`;
      acc += len;
      legend += `<span style="display:flex;align-items:center;gap:4px;font-size:12px;color:${GRAY}"><span style="width:10px;height:10px;border-radius:50%;background:${d.color};display:inline-block"></span>${d.label}: ${formatCurrency(d.value)}</span>`;
    });
    legend += '</div>';
    const centerText = `<text x="50%" y="44%" text-anchor="middle" fill="#111" font-size="16" font-weight="700">${formatCurrency(total)}</text><text x="50%" y="58%" text-anchor="middle" fill="${GRAY}" font-size="11">Total</text>`;
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">${paths}${centerText}</svg>${legend}`;
  }

  function svgBar(data, w = 500, h = 200) {
    if (!data.length) return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><text x="50%" y="50%" text-anchor="middle" fill="${GRAY}" font-size="14">No data</text></svg>`;
    const max = Math.max(...data.map(d => d.value), 1);
    const barW = Math.min(40, (w - 80) / data.length - 8);
    const chartH = h - 50;
    let bars = '', labels = '';
    data.forEach((d, i) => {
      const x = 50 + i * ((w - 80) / data.length) + 4;
      const bh = (d.value / max) * (chartH - 20);
      const y = chartH - bh;
      const color = d.color || P;
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="4" fill="${color}" opacity="0.85"><title>${d.label}: ${formatCurrency(d.value)}</title></rect>`;
      bars += `<text x="${x + barW/2}" y="${y - 5}" text-anchor="middle" fill="#374151" font-size="10">${formatCurrency(d.value)}</text>`;
      labels += `<text x="${x + barW/2}" y="${h - 8}" text-anchor="middle" fill="${GRAY}" font-size="10" transform="rotate(-25 ${x + barW/2} ${h - 8})">${d.label}</text>`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><line x1="50" y1="10" x2="50" y2="${chartH}" stroke="#e5e7eb" stroke-width="1"/>${bars}${labels}</svg>`;
  }

  function svgLine(data, w = 500, h = 200) {
    if (data.length < 2) return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><text x="50%" y="50%" text-anchor="middle" fill="${GRAY}" font-size="14">Insufficient data</text></svg>`;
    const max = Math.max(...data.map(d => d.value), 1);
    const min = Math.min(...data.map(d => d.value), 0);
    const range = max - min || 1;
    const chartH = h - 40, chartW = w - 80;
    const points = data.map((d, i) => {
      const x = 50 + (i / (data.length - 1)) * chartW;
      const y = 10 + chartH - ((d.value - min) / range) * (chartH - 20);
      return `${x},${y}`;
    }).join(' ');
    let dots = data.map((d, i) => {
      const x = 50 + (i / (data.length - 1)) * chartW;
      const y = 10 + chartH - ((d.value - min) / range) * (chartH - 20);
      return `<circle cx="${x}" cy="${y}" r="4" fill="${P}" stroke="#fff" stroke-width="2"><title>${d.label}: ${formatCurrency(d.value)}</title></circle><text x="${x}" y="${h - 8}" text-anchor="middle" fill="${GRAY}" font-size="9">${d.label}</text>`;
    }).join('');
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><defs><linearGradient id="lg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${P}" stop-opacity="0.3"/><stop offset="100%" stop-color="${P}" stop-opacity="0.02"/></linearGradient></defs><line x1="50" y1="10" x2="50" y2="${chartH}" stroke="#e5e7eb" stroke-width="1"/><polygon points="50,${chartH} ${points} ${50 + chartW},${chartH}" fill="url(#lg)"/><polyline points="${points}" fill="none" stroke="${P}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>${dots}</svg>`;
  }

  function svgProgress(current, target, label, w = 280, h = 36) {
    const pct = target > 0 ? Math.min(100, (current / target) * 100) : 0;
    const barW = w - 120;
    return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:10px"><span style="font-size:13px;color:#374151;min-width:100px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(label)}</span><div style="flex:1;background:#e5e7eb;border-radius:8px;height:10px;overflow:hidden"><div style="width:${pct.toFixed(1)}%;height:100%;background:${P};border-radius:8px;transition:width .3s"></div></div><span style="font-size:12px;color:${GRAY};min-width:50px;text-align:right">${formatCurrency(current)}</span></div>`;
  }

  // ── Route: Dashboard ────────────────────────────────────────────
  app.get('/school/student-banking', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: accounts } = await pool.query(
        `SELECT ba.*, s.name AS student_name FROM bank_accounts ba LEFT JOIN students s ON s.id = ba.student_id AND s.tenant_id = ba.tenant_id WHERE ba.tenant_id = $1 AND ba.student_id = $2 AND ba.status != 'closed' ORDER BY ba.created_at DESC`, [tid, uid]
      );
      const accIds = accounts.map(a => a.id);
      let totalBalance = accounts.reduce((s, a) => s + Number(a.balance), 0);
      const { rows: recentTx } = accIds.length ? await pool.query(
        `SELECT bt.*, ba.account_number FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.account_id WHERE bt.tenant_id = $1 AND bt.account_id = ANY($2::bigint[]) ORDER BY bt.created_at DESC LIMIT 10`, [tid, accIds]
      ) : { rows: [] };
      const { rows: goals } = accIds.length ? await pool.query(
        `SELECT * FROM savings_goals WHERE tenant_id = $1 AND account_id = ANY($2::bigint[]) AND status = 'active' ORDER BY deadline ASC`, [tid, accIds]
      ) : { rows: [] };
      const { rows: catSpend } = accIds.length ? await pool.query(
        `SELECT category, SUM(amount) AS total FROM bank_transactions WHERE tenant_id = $1 AND account_id = ANY($2::bigint[]) AND type IN ('withdrawal','fee') AND created_at >= NOW() - INTERVAL '30 days' GROUP BY category ORDER BY total DESC`, [tid, accIds]
      ) : { rows: [] };
      const { rows: monthlyTrend } = accIds.length ? await pool.query(
        `SELECT TO_CHAR(created_at, 'Mon') AS label, SUM(CASE WHEN type IN ('withdrawal','fee','transfer_out') THEN amount ELSE 0 END) AS spent, SUM(CASE WHEN type IN ('deposit','interest','transfer_in') THEN amount ELSE 0 END) AS earned FROM bank_transactions WHERE tenant_id = $1 AND account_id = ANY($2::bigint[]) AND created_at >= NOW() - INTERVAL '6 months' GROUP BY TO_CHAR(created_at, 'YYYY-MM') ORDER BY MIN(created_at)`, [tid, accIds]
      ) : { rows: [] };

      const donutData = catSpend.map(c => ({ label: CAT_LABELS[c.category] || c.category, value: Number(c.total), color: CAT_COLORS[c.category] || '#6b7280' }));
      const trendData = monthlyTrend.map(m => ({ label: m.label, value: Number(m.spent) }));

      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; Student Banking</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">🏦 Student Banking</h2>`;
      html += `<div class="grid grid-4" style="margin-bottom:20px">`;
      html += `<div class="stat-card"><div class="stat-label">Total Balance</div><div class="stat-value" style="color:${P}">${formatCurrency(totalBalance)}</div></div>`;
      html += `<div class="stat-card"><div class="stat-label">Active Accounts</div><div class="stat-value">${accounts.length}</div></div>`;
      html += `<div class="stat-card"><div class="stat-label">Active Goals</div><div class="stat-value" style="color:#10b981">${goals.length}</div></div>`;
      html += `<div class="stat-card"><div class="stat-label">This Month Spent</div><div class="stat-value" style="color:#ef4444">${formatCurrency(trendData.length ? trendData[trendData.length - 1].value : 0)}</div></div>`;
      html += `</div>`;
      html += `<div class="grid grid-2" style="margin-bottom:20px"><div class="chart-container"><h3 style="margin:0 0 12px;font-size:16px;color:#111827">Spending by Category</h3>${svgDonut(donutData)}</div>`;
      html += `<div class="chart-container"><h3 style="margin:0 0 12px;font-size:16px;color:#111827">Monthly Spending Trend</h3>${svgLine(trendData)}</div></div>`;
      if (goals.length) {
        html += `<div class="card"><h3 style="margin:0 0 12px;font-size:16px;color:#111827">Savings Goals</h3>`;
        goals.forEach(g => { html += svgProgress(g.current_amount, g.target_amount, g.name); });
        html += `</div>`;
      }
      html += `<div class="card"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><h3 style="margin:0;font-size:16px;color:#111827">Recent Transactions</h3><a href="/school/student-banking/transactions" style="color:${P};font-size:13px">View All →</a></div>`;
      if (recentTx.length) {
        html += `<table><thead><tr><th>Date</th><th>Description</th><th>Type</th><th>Amount</th><th>Balance</th></tr></thead><tbody>`;
        recentTx.forEach(tx => {
          const isNeg = ['withdrawal','fee','transfer_out'].includes(tx.type);
          html += `<tr><td>${tx.created_at?.toISOString?.().slice(0,10) || '-'}</td><td>${esc(tx.description || tx.category || '-')}</td><td><span class="badge ${isNeg ? 'badge-red' : 'badge-green'}">${tx.type}</span></td><td class="${isNeg ? 'amount-negative' : 'amount-positive'}">${isNeg ? '-' : '+'}${formatCurrency(tx.amount)}</td><td>${formatCurrency(tx.balance_after)}</td></tr>`;
        });
        html += `</tbody></table>`;
      } else { html += `<div class="empty-state"><p>No transactions yet</p></div>`; }
      html += `</div>`;
      html += `<div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:16px"><a href="/school/student-banking/accounts" class="btn">Manage Accounts</a><a href="/school/student-banking/deposit" class="btn btn-success">Quick Deposit</a><a href="/school/student-banking/savings-goals" class="btn btn-outline">Savings Goals</a><a href="/school/student-banking/financial-literacy" class="btn btn-outline">Learn Finance</a><a href="/school/student-banking/reports" class="btn btn-outline">Reports</a></div>`;
      renderPage(req, res, 'Student Banking', html);
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Accounts List ────────────────────────────────────────
  app.get('/school/student-banking/accounts', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: accounts } = await pool.query(
        `SELECT ba.*, (SELECT COUNT(*) FROM bank_transactions bt WHERE bt.account_id = ba.id AND bt.tenant_id = ba.tenant_id) AS tx_count FROM bank_accounts ba WHERE ba.tenant_id = $1 AND ba.student_id = $2 ORDER BY ba.created_at DESC`, [tid, uid]
      );
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Accounts</div>`;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><h2 style="margin:0;font-size:22px;font-weight:700;color:#111827">My Accounts</h2><a href="/school/student-banking/accounts/create" class="btn">+ New Account</a></div>`;
      if (accounts.length) {
        html += `<div class="grid grid-3">`;
        accounts.forEach(a => {
          const statusBadge = a.status === 'active' ? 'badge-green' : a.status === 'frozen' ? 'badge-yellow' : 'badge-gray';
          html += `<div class="card" style="border-left:4px solid ${P}"><div style="display:flex;justify-content:space-between;margin-bottom:12px"><span style="font-size:12px;color:${GRAY}">${esc(a.account_number)}</span><span class="badge ${statusBadge}">${a.status}</span></div><div style="font-size:24px;font-weight:700;color:#111827;margin-bottom:4px">${formatCurrency(a.balance)}</div><div style="font-size:13px;color:${GRAY};margin-bottom:12px;text-transform:capitalize">${a.account_type} Account</div><div style="font-size:12px;color:${GRAY}">Daily Limit: ${formatCurrency(a.daily_limit)} &middot; Monthly: ${formatCurrency(a.monthly_limit)}</div><div style="font-size:12px;color:${GRAY}">${a.tx_count} transactions &middot; Interest: ${(a.interest_rate * 100).toFixed(2)}%</div><div style="display:flex;gap:6px;margin-top:12px"><a href="/school/student-banking/deposit?aid=${a.id}" class="btn btn-sm btn-success">Deposit</a><a href="/school/student-banking/withdraw?aid=${a.id}" class="btn btn-sm btn-danger">Withdraw</a></div></div>`;
        });
        html += `</div>`;
      } else { html += `<div class="empty-state"><p>No accounts yet. Create your first account to get started.</p><a href="/school/student-banking/accounts/create" class="btn" style="margin-top:12px">Create Account</a></div>`; }
      html += `<div style="margin-top:16px"><a href="/school/student-banking" class="btn btn-outline">← Back to Dashboard</a></div>`;
      renderPage(req, res, 'Bank Accounts', html);
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Create Account ───────────────────────────────────────
  app.get('/school/student-banking/accounts/create', requireAuth, requireNotBanned, async (req, res) => {
    let html = SKIP;
    html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; <a href="/school/student-banking/accounts" style="color:${P}">Accounts</a> &rsaquo; New</div>`;
    html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Create New Account</h2>`;
    html += `<div class="card"><form method="POST" action="/school/student-banking/accounts/create">`;
    html += `<div class="form-group"><label class="form-label">Account Type</label><select name="account_type"><option value="checking">Checking</option><option value="savings">Savings</option><option value="allowances">Allowances</option></select></div>`;
    html += `<div class="form-group"><label class="form-label">Initial Deposit (optional)</label><input type="number" name="initial_deposit" step="0.01" min="0" placeholder="0.00" value="0"></div>`;
    html += `<div class="form-group"><label class="form-label">Daily Spending Limit</label><input type="number" name="daily_limit" step="0.01" min="0" value="500.00"></div>`;
    html += `<div class="form-group"><label class="form-label">Monthly Spending Limit</label><input type="number" name="monthly_limit" step="0.01" min="0" value="5000.00"></div>`;
    html += `<div class="form-group"><label class="form-label">Parent PIN (4 digits, optional)</label><input type="password" name="parent_pin" maxlength="4" pattern="[0-9]{4}" placeholder="For parent-controlled limits"></div>`;
    html += `<button type="submit" class="btn">Create Account</button> <a href="/school/student-banking/accounts" class="btn btn-outline">Cancel</a>`;
    html += `</form></div>`;
    renderPage(req, res, 'Create Account', html);
  });

  app.post('/school/student-banking/accounts/create', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { account_type = 'checking', initial_deposit = 0, daily_limit = 500, monthly_limit = 5000, parent_pin } = req.body;
      const deposit = Math.max(0, Number(initial_deposit) || 0);
      const acctNum = generateAccountNumber();
      const { rows: [newAcct] } = await pool.query(
        `INSERT INTO bank_accounts (tenant_id, student_id, account_number, balance, account_type, daily_limit, monthly_limit, parent_pin) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
        [tid, uid, acctNum, deposit, account_type, daily_limit, monthly_limit, parent_pin || null]
      );
      const accountId = newAcct.id;
      if (deposit > 0) {
        await pool.query(
          `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, category, reference, balance_after, created_by) VALUES ($1, $2, 'deposit', $3, 'Initial deposit', 'savings', $4, $5, $6)`,
          [tid, accountId, deposit, 'INIT' + Date.now().toString(36).toUpperCase(), deposit, uid]
        );
      }
      await audit(req, 'bank_account_created', { account_id: accountId, account_number: acctNum, type: account_type });
      req.session.flash = { type: 'success', msg: 'Account created successfully!' };
      res.redirect('/school/student-banking/accounts');
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Deposit ──────────────────────────────────────────────
  app.get('/school/student-banking/deposit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: accounts } = await pool.query(`SELECT id, account_number, account_type, balance FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active' ORDER BY created_at DESC`, [tid, uid]);
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Deposit</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Make a Deposit</h2>`;
      if (!accounts.length) { html += `<div class="alert alert-info">No active accounts. <a href="/school/student-banking/accounts/create" style="color:${P}">Create one first</a>.</div>`; }
      else {
        html += `<div class="card"><form method="POST" action="/school/student-banking/deposit">`;
        html += `<div class="form-group"><label class="form-label">From Account</label><select name="account_id" required>`;
        const preselect = req.query.aid;
        accounts.forEach(a => { html += `<option value="${a.id}" ${String(a.id) === preselect ? 'selected' : ''}>${esc(a.account_number)} (${a.account_type}) — ${formatCurrency(a.balance)}</option>`; });
        html += `</select></div>`;
        html += `<div class="form-group"><label class="form-label">Amount</label><input type="number" name="amount" step="0.01" min="0.01" required placeholder="Enter deposit amount"></div>`;
        html += `<div class="form-group"><label class="form-label">Description</label><input name="description" placeholder="e.g. Allowance, Gift money, Refund"></div>`;
        html += `<div class="form-group"><label class="form-label">Category</label><select name="category">`;
        CATEGORIES.forEach(c => { html += `<option value="${c}">${CAT_LABELS[c]}</option>`; });
        html += `</select></div>`;
        html += `<button type="submit" class="btn btn-success">Deposit</button> <a href="/school/student-banking" class="btn btn-outline">Cancel</a>`;
        html += `</form></div>`;
      }
      renderPage(req, res, 'Deposit', html);
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/student-banking/deposit', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { account_id, amount, description, category } = req.body;
      const amt = Number(amount);
      if (!amt || amt <= 0) { req.session.flash = { type: 'error', msg: 'Invalid amount' }; return res.redirect('/school/student-banking/deposit'); }
      const { rows: acct } = await pool.query(`SELECT id, balance, status FROM bank_accounts WHERE id = $1 AND tenant_id = $2 AND student_id = $3 AND status = 'active'`, [account_id, tid, uid]);
      if (!acct.length) { req.session.flash = { type: 'error', msg: 'Account not found or inactive' }; return res.redirect('/school/student-banking/deposit'); }
      const newBal = Number(acct[0].balance) + amt;
      const ref = 'DEP' + Date.now().toString(36).toUpperCase();
      await pool.query(`UPDATE bank_accounts SET balance = $1 WHERE id = $2`, [newBal, account_id]);
      await pool.query(
        `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, category, reference, balance_after, created_by) VALUES ($1, $2, 'deposit', $3, $4, $5, $6, $7, $8)`,
        [tid, account_id, amt, description || 'Deposit', category || 'other', ref, newBal, uid]
      );
      await audit(req, 'bank_deposit', { account_id, amount: amt, reference: ref });
      req.session.flash = { type: 'success', msg: `Deposited ${formatCurrency(amt)} successfully!` };
      res.redirect('/school/student-banking/transactions');
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Withdraw ─────────────────────────────────────────────
  app.get('/school/student-banking/withdraw', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: accounts } = await pool.query(`SELECT id, account_number, account_type, balance, daily_limit FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active' ORDER BY created_at DESC`, [tid, uid]);
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Withdraw</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Make a Withdrawal</h2>`;
      if (!accounts.length) { html += `<div class="alert alert-info">No active accounts.</div>`; }
      else {
        html += `<div class="card"><form method="POST" action="/school/student-banking/withdraw">`;
        html += `<div class="form-group"><label class="form-label">From Account</label><select name="account_id" required>`;
        const preselect = req.query.aid;
        accounts.forEach(a => { html += `<option value="${a.id}" ${String(a.id) === preselect ? 'selected' : ''}>${esc(a.account_number)} (${a.account_type}) — ${formatCurrency(a.balance)}</option>`; });
        html += `</select></div>`;
        html += `<div class="form-group"><label class="form-label">Amount</label><input type="number" name="amount" step="0.01" min="0.01" required placeholder="Enter withdrawal amount"></div>`;
        html += `<div class="form-group"><label class="form-label">Description</label><input name="description" placeholder="e.g. Lunch, Bus fare, Supplies"></div>`;
        html += `<div class="form-group"><label class="form-label">Category</label><select name="category">`;
        CATEGORIES.forEach(c => { html += `<option value="${c}">${CAT_LABELS[c]}</option>`; });
        html += `</select></div>`;
        html += `<div class="form-group"><label class="form-label">Merchant (optional)</label><input name="merchant" placeholder="e.g. School Canteen, Book Store"></div>`;
        html += `<button type="submit" class="btn btn-danger">Withdraw</button> <a href="/school/student-banking" class="btn btn-outline">Cancel</a>`;
        html += `</form></div>`;
      }
      renderPage(req, res, 'Withdraw', html);
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/student-banking/withdraw', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { account_id, amount, description, category, merchant } = req.body;
      const amt = Number(amount);
      if (!amt || amt <= 0) { req.session.flash = { type: 'error', msg: 'Invalid amount' }; return res.redirect('/school/student-banking/withdraw'); }
      const { rows: acct } = await pool.query(`SELECT id, balance, daily_limit, monthly_limit FROM bank_accounts WHERE id = $1 AND tenant_id = $2 AND student_id = $3 AND status = 'active'`, [account_id, tid, uid]);
      if (!acct.length) { req.session.flash = { type: 'error', msg: 'Account not found or inactive' }; return res.redirect('/school/student-banking/withdraw'); }
      if (Number(acct[0].balance) < amt) { req.session.flash = { type: 'error', msg: 'Insufficient funds' }; return res.redirect('/school/student-banking/withdraw'); }
      const { rows: dayTotal } = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM bank_transactions WHERE tenant_id = $1 AND account_id = $2 AND type IN ('withdrawal','fee','transfer_out') AND created_at >= CURRENT_DATE`, [tid, account_id]
      );
      if (Number(dayTotal[0].total) + amt > Number(acct[0].daily_limit)) {
        req.session.flash = { type: 'error', msg: `Daily limit of ${formatCurrency(acct[0].daily_limit)} exceeded` };
        return res.redirect('/school/student-banking/withdraw');
      }
      const newBal = Number(acct[0].balance) - amt;
      const ref = 'WDR' + Date.now().toString(36).toUpperCase();
      await pool.query(`UPDATE bank_accounts SET balance = $1 WHERE id = $2`, [newBal, account_id]);
      await pool.query(
        `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, category, merchant, reference, balance_after, created_by) VALUES ($1, $2, 'withdrawal', $3, $4, $5, $6, $7, $8, $9)`,
        [tid, account_id, amt, description || 'Withdrawal', category || 'other', merchant || null, ref, newBal, uid]
      );
      await audit(req, 'bank_withdrawal', { account_id, amount: amt, reference: ref });
      req.session.flash = { type: 'success', msg: `Withdrew ${formatCurrency(amt)} successfully!` };
      res.redirect('/school/student-banking/transactions');
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Transfer ─────────────────────────────────────────────
  app.get('/school/student-banking/transfer', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: accounts } = await pool.query(`SELECT id, account_number, account_type, balance FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active' ORDER BY created_at DESC`, [tid, uid]);
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Transfer</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Transfer Funds</h2>`;
      if (accounts.length < 1) { html += `<div class="alert alert-info">You need at least one active account to transfer.</div>`; }
      else {
        html += `<div class="card"><form method="POST" action="/school/student-banking/transfer">`;
        html += `<div class="form-group"><label class="form-label">From Account</label><select name="from_account_id" required>`;
        accounts.forEach(a => { html += `<option value="${a.id}">${esc(a.account_number)} (${a.account_type}) — ${formatCurrency(a.balance)}</option>`; });
        html += `</select></div>`;
        html += `<div class="form-group"><label class="form-label">To Account (your own or enter another student's account number)</label>`;
        html += `<select name="to_account_id" id="to_acct"><option value="">-- Select or enter account number below --</option>`;
        accounts.forEach(a => { html += `<option value="${a.id}">${esc(a.account_number)} (${a.account_type}) — ${formatCurrency(a.balance)}</option>`; });
        html += `</select></div>`;
        html += `<div class="form-group"><label class="form-label">Or enter recipient account number</label><input name="to_account_number" id="to_acct_num" placeholder="SB..."></div>`;
        html += `<div class="form-group"><label class="form-label">Amount</label><input type="number" name="amount" step="0.01" min="0.01" required placeholder="Enter transfer amount"></div>`;
        html += `<div class="form-group"><label class="form-label">Description</label><input name="description" placeholder="e.g. Transfer to savings"></div>`;
        html += `<button type="submit" class="btn">Transfer</button> <a href="/school/student-banking" class="btn btn-outline">Cancel</a>`;
        html += `</form></div>`;
      }
      renderPage(req, res, 'Transfer', html);
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/student-banking/transfer', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      let { from_account_id, to_account_id, to_account_number, amount, description } = req.body;
      const amt = Number(amount);
      if (!amt || amt <= 0) { req.session.flash = { type: 'error', msg: 'Invalid amount' }; return res.redirect('/school/student-banking/transfer'); }
      if (!to_account_id && to_account_number) {
        const { rows: lookup } = await pool.query(`SELECT id FROM bank_accounts WHERE account_number = $1 AND tenant_id = $2 AND status = 'active'`, [to_account_number, tid]);
        if (lookup.length) to_account_id = lookup[0].id;
      }
      if (!to_account_id || Number(from_account_id) === Number(to_account_id)) {
        req.session.flash = { type: 'error', msg: 'Please select a valid destination account' };
        return res.redirect('/school/student-banking/transfer');
      }
      const { rows: fromAcct } = await pool.query(`SELECT id, balance FROM bank_accounts WHERE id = $1 AND tenant_id = $2 AND student_id = $3 AND status = 'active'`, [from_account_id, tid, uid]);
      if (!fromAcct.length || Number(fromAcct[0].balance) < amt) {
        req.session.flash = { type: 'error', msg: 'Insufficient funds or invalid source account' };
        return res.redirect('/school/student-banking/transfer');
      }
      const { rows: toAcct } = await pool.query(`SELECT id, balance FROM bank_accounts WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [to_account_id, tid]);
      if (!toAcct.length) { req.session.flash = { type: 'error', msg: 'Destination account not found' }; return res.redirect('/school/student-banking/transfer'); }
      const ref = 'TRF' + Date.now().toString(36).toUpperCase();
      const newFromBal = Number(fromAcct[0].balance) - amt;
      const newToBal = Number(toAcct[0].balance) + amt;
      try {
        await pool.query('BEGIN');
        await pool.query(`UPDATE bank_accounts SET balance = $1 WHERE id = $2`, [newFromBal, from_account_id]);
        await pool.query(`UPDATE bank_accounts SET balance = $1 WHERE id = $2`, [newToBal, to_account_id]);
        await pool.query(
          `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, reference, balance_after, created_by) VALUES ($1, $2, 'transfer_out', $3, $4, $5, $6, $7)`,
          [tid, from_account_id, amt, description || 'Transfer out', ref, newFromBal, uid]
        );
        await pool.query(
          `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, reference, balance_after, created_by) VALUES ($1, $2, 'transfer_in', $3, $4, $5, $6, $7)`,
          [tid, to_account_id, amt, description || 'Transfer in', ref, newToBal, uid]
        );
        await pool.query('COMMIT');
      } catch(e) { await pool.query('ROLLBACK'); throw e; }
      await audit(req, 'bank_transfer', { from: from_account_id, to: to_account_id, amount: amt, reference: ref });
      req.session.flash = { type: 'success', msg: `Transferred ${formatCurrency(amt)} successfully!` };
      res.redirect('/school/student-banking/transactions');
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Transaction History ──────────────────────────────────
  app.get('/school/student-banking/transactions', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const page = Math.max(1, Number(req.query.page) || 1);
      const limit = 25;
      const offset = (page - 1) * limit;
      const { type, category, account_id, from_date, to_date, search } = req.query;
      let where = `bt.tenant_id = $1`;
      const params = [tid];
      let paramIdx = 1;
      if (account_id) { paramIdx++; where += ` AND bt.account_id = $${paramIdx}`; params.push(account_id); }
      else {
        const { rows: accts } = await pool.query(`SELECT id FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2`, [tid, uid]);
        const ids = accts.map(a => a.id);
        if (!ids.length) { renderPage(req, res, 'Transactions', SKIP + '<div class="empty-state"><h2>No accounts</h2></div>'); return; }
        paramIdx++;
        where += ` AND bt.account_id = ANY($${paramIdx}::bigint[])`;
        params.push(ids);
      }
      if (type) { paramIdx++; where += ` AND bt.type = $${paramIdx}`; params.push(type); }
      if (category) { paramIdx++; where += ` AND bt.category = $${paramIdx}`; params.push(category); }
      if (from_date) { paramIdx++; where += ` AND bt.created_at >= $${paramIdx}`; params.push(from_date); }
      if (to_date) { paramIdx++; where += ` AND bt.created_at <= $${paramIdx}`; params.push(to_date + ' 23:59:59'); }
      if (search) { paramIdx++; const s = `%${search}%`; where += ` AND (bt.description LIKE $${paramIdx} OR bt.reference LIKE $${paramIdx} OR bt.merchant LIKE $${paramIdx})`; params.push(s); }
      const { rows: [{ total }] } = await pool.query(`SELECT COUNT(*) AS total FROM bank_transactions bt WHERE ${where}`, params);
      paramIdx++;
      const limitParamIdx = paramIdx;
      paramIdx++;
      const offsetParamIdx = paramIdx;
      const { rows: transactions } = await pool.query(`SELECT bt.*, ba.account_number FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.account_id WHERE ${where} ORDER BY bt.created_at DESC LIMIT $${limitParamIdx} OFFSET $${offsetParamIdx}`, [...params, limit, offset]);
      const totalPages = Math.ceil(total / limit);

      const { rows: accounts } = await pool.query(`SELECT id, account_number, account_type FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active'`, [tid, uid]);

      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Transactions</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Transaction History</h2>`;
      html += `<div class="card"><form method="GET" action="/school/student-banking/transactions" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">`;
      html += `<div class="form-group" style="margin:0"><label class="form-label">Account</label><select name="account_id"><option value="">All</option>`;
      accounts.forEach(a => { html += `<option value="${a.id}" ${account_id === String(a.id) ? 'selected' : ''}>${esc(a.account_number)}</option>`; });
      html += `</select></div>`;
      html += `<div class="form-group" style="margin:0"><label class="form-label">Type</label><select name="type"><option value="">All</option><option value="deposit" ${type === 'deposit' ? 'selected' : ''}>Deposit</option><option value="withdrawal" ${type === 'withdrawal' ? 'selected' : ''}>Withdrawal</option><option value="transfer_in" ${type === 'transfer_in' ? 'selected' : ''}>Transfer In</option><option value="transfer_out" ${type === 'transfer_out' ? 'selected' : ''}>Transfer Out</option><option value="interest" ${type === 'interest' ? 'selected' : ''}>Interest</option><option value="fee" ${type === 'fee' ? 'selected' : ''}>Fee</option></select></div>`;
      html += `<div class="form-group" style="margin:0"><label class="form-label">Category</label><select name="category"><option value="">All</option>`;
      CATEGORIES.forEach(c => { html += `<option value="${c}" ${category === c ? 'selected' : ''}>${CAT_LABELS[c]}</option>`; });
      html += `</select></div>`;
      html += `<div class="form-group" style="margin:0"><label class="form-label">From</label><input type="date" name="from_date" value="${esc(from_date || '')}"></div>`;
      html += `<div class="form-group" style="margin:0"><label class="form-label">To</label><input type="date" name="to_date" value="${esc(to_date || '')}"></div>`;
      html += `<div class="form-group" style="margin:0"><label class="form-label">Search</label><input name="search" value="${esc(search || '')}" placeholder="Description, ref..."></div>`;
      html += `<div class="form-group" style="margin:0"><button type="submit" class="btn btn-sm">Filter</button></div>`;
      html += `</form></div>`;
      html += `<div style="margin:8px 0 16px;font-size:13px;color:${GRAY}">${total} transaction(s) found</div>`;
      if (transactions.length) {
        html += `<div class="card" style="overflow-x:auto"><table><thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Type</th><th>Category</th><th>Amount</th><th>Balance</th><th>Ref</th></tr></thead><tbody>`;
        transactions.forEach(tx => {
          const isNeg = ['withdrawal','fee','transfer_out'].includes(tx.type);
          html += `<tr><td>${tx.created_at?.toISOString?.().slice(0,19).replace('T',' ') || '-'}</td><td style="font-size:12px">${esc(tx.account_number)}</td><td>${esc(tx.description || '-')}</td><td><span class="badge ${isNeg ? 'badge-red' : 'badge-green'}">${tx.type}</span></td><td>${esc(tx.category || '-')}</td><td class="${isNeg ? 'amount-negative' : 'amount-positive'}" style="font-weight:600">${isNeg ? '-' : '+'}${formatCurrency(tx.amount)}</td><td>${formatCurrency(tx.balance_after)}</td><td style="font-size:11px;color:${GRAY}">${esc(tx.reference || '-')}</td></tr>`;
        });
        html += `</tbody></table></div>`;
        if (totalPages > 1) {
          html += `<div style="display:flex;gap:6px;justify-content:center;margin-top:16px">`;
          for (let p = 1; p <= totalPages; p++) {
            html += `<a href="/school/student-banking/transactions?page=${p}&type=${esc(type||'')}&category=${esc(category||'')}&account_id=${esc(account_id||'')}&from_date=${esc(from_date||'')}&to_date=${esc(to_date||'')}&search=${esc(search||'')}" class="btn btn-sm ${p === page ? '' : 'btn-outline'}">${p}</a>`;
          }
          html += `</div>`;
        }
      } else { html += `<div class="empty-state"><p>No transactions match your filters.</p></div>`; }
      html += `<div style="margin-top:16px"><a href="/school/student-banking" class="btn btn-outline">← Dashboard</a></div>`;
      renderPage(req, res, 'Transactions', html);
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Savings Goals ────────────────────────────────────────
  app.get('/school/student-banking/savings-goals', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: accounts } = await pool.query(`SELECT id, account_number, account_type FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active'`, [tid, uid]);
      const accIds = accounts.map(a => a.id);
      const { rows: goals } = accIds.length ? await pool.query(
        `SELECT sg.*, ba.account_number FROM savings_goals sg JOIN bank_accounts ba ON ba.id = sg.account_id WHERE sg.tenant_id = $1 AND sg.account_id = ANY($2::bigint[]) ORDER BY sg.created_at DESC`, [tid, accIds]
      ) : { rows: [] };
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Savings Goals</div>`;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><h2 style="margin:0;font-size:22px;font-weight:700;color:#111827">Savings Goals</h2><a href="/school/student-banking/savings-goals/create" class="btn">+ New Goal</a></div>`;
      if (goals.length) {
        html += `<div class="grid grid-2">`;
        goals.forEach(g => {
          const pct = g.target_amount > 0 ? Math.min(100, (g.current_amount / g.target_amount) * 100) : 0;
          const daysLeft = g.deadline ? Math.max(0, Math.ceil((new Date(g.deadline) - new Date()) / 86400000)) : null;
          const statusBadge = g.status === 'active' ? 'badge-green' : g.status === 'completed' ? 'badge-blue' : 'badge-gray';
          html += `<div class="card" style="border-top:3px solid ${P}"><div style="display:flex;justify-content:space-between;margin-bottom:8px"><h3 style="margin:0;font-size:16px;color:#111827">${esc(g.name)}</h3><span class="badge ${statusBadge}">${g.status}</span></div>`;
          if (g.description) html += `<p style="font-size:13px;color:${GRAY};margin:0 0 12px">${esc(g.description)}</p>`;
          html += `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px"><span>${formatCurrency(g.current_amount)} of ${formatCurrency(g.target_amount)}</span><span style="font-weight:600;color:${P}">${pct.toFixed(1)}%</span></div>`;
          html += `<div class="progress-bar"><div class="progress-fill" style="width:${pct.toFixed(1)}%;background:${P}"></div></div></div>`;
          if (daysLeft !== null) html += `<div style="font-size:12px;color:${GRAY};margin-bottom:8px">${daysLeft > 0 ? daysLeft + ' days remaining' : 'Deadline passed'}</div>`;
          html += `<div style="font-size:12px;color:${GRAY};margin-bottom:12px">Auto-contribute: ${formatCurrency(g.auto_contribute)}/month &middot; ${esc(g.account_number)}</div>`;
          if (g.status === 'active') {
            html += `<form method="POST" action="/school/student-banking/savings-goals/contribute" style="display:flex;gap:6px;margin-bottom:6px"><input type="hidden" name="goal_id" value="${g.id}"><input type="number" name="amount" step="0.01" min="0.01" placeholder="Amount" style="flex:1"><button type="submit" class="btn btn-sm btn-success">Add</button></form>`;
            html += `<div style="display:flex;gap:6px"><a href="/school/student-banking/savings-goals/edit/${g.id}" class="btn btn-sm btn-outline">Edit</a>`;
            html += `<form method="POST" action="/school/student-banking/savings-goals/abandon" style="flex:1"><input type="hidden" name="goal_id" value="${g.id}"><button type="submit" class="btn btn-sm btn-danger" style="width:100%">Abandon</button></form></div>`;
          }
          html += `</div>`;
        });
        html += `</div>`;
      } else { html += `<div class="empty-state"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M12 2v20M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg><p>No savings goals yet. Start saving for something important!</p><a href="/school/student-banking/savings-goals/create" class="btn" style="margin-top:12px">Create First Goal</a></div>`; }
      html += `<div style="margin-top:16px"><a href="/school/student-banking" class="btn btn-outline">← Dashboard</a></div>`;
      renderPage(req, res, 'Savings Goals', html);
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Create Savings Goal ──────────────────────────────────
  app.get('/school/student-banking/savings-goals/create', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: accounts } = await pool.query(`SELECT id, account_number, balance FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active'`, [tid, uid]);
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; <a href="/school/student-banking/savings-goals" style="color:${P}">Goals</a> &rsaquo; New</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Create Savings Goal</h2>`;
      if (!accounts.length) { html += `<div class="alert alert-info">You need an active account first.</div>`; }
      else {
        html += `<div class="card"><form method="POST" action="/school/student-banking/savings-goals/create">`;
        html += `<div class="form-group"><label class="form-label">Linked Account</label><select name="account_id" required>`;
        accounts.forEach(a => { html += `<option value="${a.id}">${esc(a.account_number)} — ${formatCurrency(a.balance)}</option>`; });
        html += `</select></div>`;
        html += `<div class="form-group"><label class="form-label">Goal Name</label><input name="name" required placeholder="e.g. New Laptop, Field Trip, College Fund"></div>`;
        html += `<div class="form-group"><label class="form-label">Description (optional)</label><textarea name="description" rows="2" placeholder="What are you saving for?"></textarea></div>`;
        html += `<div class="grid grid-2">`;
        html += `<div class="form-group"><label class="form-label">Target Amount</label><input type="number" name="target_amount" step="0.01" min="1" required placeholder="0.00"></div>`;
        html += `<div class="form-group"><label class="form-label">Initial Contribution</label><input type="number" name="initial_amount" step="0.01" min="0" value="0"></div>`;
        html += `</div>`;
        html += `<div class="grid grid-2">`;
        html += `<div class="form-group"><label class="form-label">Deadline (optional)</label><input type="date" name="deadline"></div>`;
        html += `<div class="form-group"><label class="form-label">Monthly Auto-Contribute</label><input type="number" name="auto_contribute" step="0.01" min="0" value="0" placeholder="0.00"></div>`;
        html += `</div>`;
        html += `<button type="submit" class="btn">Create Goal</button> <a href="/school/student-banking/savings-goals" class="btn btn-outline">Cancel</a>`;
        html += `</form></div>`;
      }
      renderPage(req, res, 'Create Goal', html);
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/student-banking/savings-goals/create', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { account_id, name, description, target_amount, initial_amount = 0, deadline, auto_contribute = 0 } = req.body;
      const target = Number(target_amount);
      const initial = Math.max(0, Number(initial_amount) || 0);
      if (!name || !target || target <= 0) { req.session.flash = { type: 'error', msg: 'Please fill in goal name and target amount' }; return res.redirect('/school/student-banking/savings-goals/create'); }
      const { rows: acct } = await pool.query(`SELECT id, balance FROM bank_accounts WHERE id = $1 AND tenant_id = $2 AND student_id = $3 AND status = 'active'`, [account_id, tid, uid]);
      if (!acct.length) { req.session.flash = { type: 'error', msg: 'Invalid account' }; return res.redirect('/school/student-banking/savings-goals/create'); }
      if (initial > Number(acct[0].balance)) { req.session.flash = { type: 'error', msg: 'Insufficient balance for initial contribution' }; return res.redirect('/school/student-banking/savings-goals/create'); }
      let goalId;
      try {
        await pool.query('BEGIN');
        const { rows: [newGoal] } = await pool.query(
          `INSERT INTO savings_goals (tenant_id, account_id, name, description, target_amount, current_amount, deadline, auto_contribute) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id`,
          [tid, account_id, name, description || null, target, initial, deadline || null, auto_contribute || 0]
        );
        goalId = newGoal.id;
        if (initial > 0) {
          const newBal = Number(acct[0].balance) - initial;
          await pool.query(`UPDATE bank_accounts SET balance = $1 WHERE id = $2`, [newBal, account_id]);
          await pool.query(
            `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, category, reference, balance_after, created_by) VALUES ($1, $2, 'withdrawal', $3, $4, 'savings', $5, $6, $7)`,
            [tid, account_id, initial, `Savings goal: ${name}`, 'SG' + goalId, newBal, uid]
          );
        }
        await pool.query('COMMIT');
      } catch(e) { await pool.query('ROLLBACK'); throw e; }
      await audit(req, 'savings_goal_created', { goal_id: goalId, name, target });
      req.session.flash = { type: 'success', msg: 'Savings goal created!' };
      res.redirect('/school/student-banking/savings-goals');
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Contribute to Goal ───────────────────────────────────
  app.post('/school/student-banking/savings-goals/contribute', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { goal_id, amount } = req.body;
      const amt = Number(amount);
      if (!amt || amt <= 0) { req.session.flash = { type: 'error', msg: 'Invalid amount' }; return res.redirect('/school/student-banking/savings-goals'); }
      const { rows: goal } = await pool.query(`SELECT * FROM savings_goals WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [goal_id, tid]);
      if (!goal.length) { req.session.flash = { type: 'error', msg: 'Goal not found' }; return res.redirect('/school/student-banking/savings-goals'); }
      const g = goal[0];
      const remaining = Number(g.target_amount) - Number(g.current_amount);
      const actualAmt = Math.min(amt, remaining);
      const { rows: acct } = await pool.query(`SELECT id, balance FROM bank_accounts WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [g.account_id, tid]);
      if (!acct.length || Number(acct[0].balance) < actualAmt) { req.session.flash = { type: 'error', msg: 'Insufficient account balance' }; return res.redirect('/school/student-banking/savings-goals'); }
      try {
        await pool.query('BEGIN');
        const newBal = Number(acct[0].balance) - actualAmt;
        const newGoalAmt = Number(g.current_amount) + actualAmt;
        const isComplete = newGoalAmt >= Number(g.target_amount);
        await pool.query(`UPDATE bank_accounts SET balance = $1 WHERE id = $2`, [newBal, g.account_id]);
        await pool.query(`UPDATE savings_goals SET current_amount = $1, status = $2 WHERE id = $3`, [newGoalAmt, isComplete ? 'completed' : 'active', goal_id]);
        await pool.query(
          `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, category, reference, balance_after, created_by) VALUES ($1, $2, 'withdrawal', $3, $4, 'savings', $5, $6, $7)`,
          [tid, g.account_id, actualAmt, `Savings goal: ${g.name}`, 'SG' + goal_id, newBal, uid]
        );
        await pool.query('COMMIT');
        await audit(req, 'savings_goal_contribute', { goal_id, amount: actualAmt, completed: isComplete });
        req.session.flash = { type: 'success', msg: `Added ${formatCurrency(actualAmt)} to "${g.name}"${isComplete ? ' — Goal reached! 🎉' : ''}` };
      } catch(e) { await pool.query('ROLLBACK'); throw e; }
      res.redirect('/school/student-banking/savings-goals');
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Edit Savings Goal ────────────────────────────────────
  app.get('/school/student-banking/savings-goals/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: goal } = await pool.query(`SELECT sg.* FROM savings_goals sg JOIN bank_accounts ba ON ba.id = sg.account_id WHERE sg.id = $1 AND sg.tenant_id = $2 AND ba.student_id = $3 AND sg.status = 'active'`, [req.params.id, tid, uid]);
      if (!goal.length) { req.session.flash = { type: 'error', msg: 'Goal not found' }; return res.redirect('/school/student-banking/savings-goals'); }
      const g = goal[0];
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; <a href="/school/student-banking/savings-goals" style="color:${P}">Goals</a> &rsaquo; Edit</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Edit: ${esc(g.name)}</h2>`;
      html += `<div class="card"><form method="POST" action="/school/student-banking/savings-goals/edit/${g.id}">`;
      html += `<div class="form-group"><label class="form-label">Goal Name</label><input name="name" value="${esc(g.name)}" required></div>`;
      html += `<div class="form-group"><label class="form-label">Description</label><textarea name="description" rows="2">${esc(g.description || '')}</textarea></div>`;
      html += `<div class="grid grid-2">`;
      html += `<div class="form-group"><label class="form-label">Target Amount</label><input type="number" name="target_amount" step="0.01" min="${g.current_amount}" value="${g.target_amount}" required></div>`;
      html += `<div class="form-group"><label class="form-label">Deadline</label><input type="date" name="deadline" value="${g.deadline ? g.deadline.toISOString().slice(0,10) : ''}"></div>`;
      html += `</div>`;
      html += `<div class="form-group"><label class="form-label">Monthly Auto-Contribute</label><input type="number" name="auto_contribute" step="0.01" min="0" value="${g.auto_contribute}"></div>`;
      html += `<button type="submit" class="btn">Save Changes</button> <a href="/school/student-banking/savings-goals" class="btn btn-outline">Cancel</a>`;
      html += `</form></div>`;
      renderPage(req, res, 'Edit Goal', html);
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/student-banking/savings-goals/edit/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { name, description, target_amount, deadline, auto_contribute } = req.body;
      const { rows: goal } = await pool.query(`SELECT sg.* FROM savings_goals sg JOIN bank_accounts ba ON ba.id = sg.account_id WHERE sg.id = $1 AND sg.tenant_id = $2 AND ba.student_id = $3`, [req.params.id, tid, uid]);
      if (!goal.length) { req.session.flash = { type: 'error', msg: 'Goal not found' }; return res.redirect('/school/student-banking/savings-goals'); }
      await pool.query(`UPDATE savings_goals SET name = $1, description = $2, target_amount = $3, deadline = $4, auto_contribute = $5 WHERE id = $6 AND tenant_id = $7`, [name, description || null, target_amount, deadline || null, auto_contribute || 0, req.params.id, tid]);
      await audit(req, 'savings_goal_updated', { goal_id: req.params.id });
      req.session.flash = { type: 'success', msg: 'Goal updated!' };
      res.redirect('/school/student-banking/savings-goals');
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Abandon Savings Goal ─────────────────────────────────
  app.post('/school/student-banking/savings-goals/abandon', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { goal_id } = req.body;
      const { rows: goal } = await pool.query(`SELECT sg.* FROM savings_goals sg JOIN bank_accounts ba ON ba.id = sg.account_id WHERE sg.id = $1 AND sg.tenant_id = $2 AND ba.student_id = $3 AND sg.status = 'active'`, [goal_id, tid, uid]);
      if (!goal.length) { req.session.flash = { type: 'error', msg: 'Goal not found' }; return res.redirect('/school/student-banking/savings-goals'); }
      const g = goal[0];
      const refund = Number(g.current_amount);
      if (refund > 0) {
        try {
          await pool.query('BEGIN');
          const { rows: acct } = await pool.query(`SELECT id, balance FROM bank_accounts WHERE id = $1 AND tenant_id = $2 FOR UPDATE`, [g.account_id, tid]);
          const newBal = Number(acct[0].balance) + refund;
          await pool.query(`UPDATE bank_accounts SET balance = $1 WHERE id = $2`, [newBal, g.account_id]);
          await pool.query(`UPDATE savings_goals SET status = 'abandoned', current_amount = 0 WHERE id = $1`, [goal_id]);
          await pool.query(
            `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, category, reference, balance_after, created_by) VALUES ($1, $2, 'deposit', $3, $4, 'savings', $5, $6, $7)`,
            [tid, g.account_id, refund, `Refund from abandoned goal: ${g.name}`, 'SG-REFUND' + goal_id, newBal, uid]
          );
          await pool.query('COMMIT');
        } catch(e) { await pool.query('ROLLBACK'); throw e; }
      } else {
        await pool.query(`UPDATE savings_goals SET status = 'abandoned' WHERE id = $1 AND tenant_id = $2`, [goal_id, tid]);
      }
      await audit(req, 'savings_goal_abandoned', { goal_id });
      req.session.flash = { type: 'success', msg: 'Goal abandoned. Funds refunded.' };
      res.redirect('/school/student-banking/savings-goals');
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Monthly Statements ───────────────────────────────────
  app.get('/school/student-banking/statements', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const selMonth = req.query.month || new Date().toISOString().slice(0, 7);
      const { rows: accounts } = await pool.query(`SELECT id, account_number, account_type, balance FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active'`, [tid, uid]);
      const accIds = accounts.map(a => a.id);
      const startDate = selMonth + '-01';
      const endDate = selMonth + '-31';
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Statements</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Monthly Statements</h2>`;
      html += `<div class="card" style="margin-bottom:16px"><form method="GET" style="display:flex;gap:10px;align-items:end"><div class="form-group" style="margin:0;flex:1"><label class="form-label">Select Month</label><input type="month" name="month" value="${esc(selMonth)}" style="max-width:220px"></div><button type="submit" class="btn btn-sm">View</button></form></div>`;
      if (accIds.length) {
        const { rows: stmtTx } = await pool.query(
          `SELECT bt.*, ba.account_number FROM bank_transactions bt JOIN bank_accounts ba ON ba.id = bt.account_id WHERE bt.tenant_id = $1 AND bt.account_id = ANY($2::bigint[]) AND bt.created_at >= $3 AND bt.created_at <= $4 ORDER BY bt.created_at ASC`, [tid, accIds, startDate, endDate + ' 23:59:59']
        );
        const { rows: summary } = await pool.query(
          `SELECT type, SUM(amount) AS total, COUNT(*) AS count FROM bank_transactions WHERE tenant_id = $1 AND account_id = ANY($2::bigint[]) AND created_at >= $3 AND created_at <= $4 GROUP BY type`, [tid, accIds, startDate, endDate + ' 23:59:59']
        );
        const deposits = summary.filter(s => s.type === 'deposit' || s.type === 'transfer_in' || s.type === 'interest').reduce((a, s) => a + Number(s.total), 0);
        const withdrawals = summary.filter(s => s.type === 'withdrawal' || s.type === 'fee' || s.type === 'transfer_out').reduce((a, s) => a + Number(s.total), 0);
        html += `<div class="grid grid-3" style="margin-bottom:16px">`;
        html += `<div class="stat-card"><div class="stat-label">Total In</div><div class="stat-value" style="color:#10b981">${formatCurrency(deposits)}</div></div>`;
        html += `<div class="stat-card"><div class="stat-label">Total Out</div><div class="stat-value" style="color:#ef4444">${formatCurrency(withdrawals)}</div></div>`;
        html += `<div class="stat-card"><div class="stat-label">Net Change</div><div class="stat-value" style="color:${deposits - withdrawals >= 0 ? '#10b981' : '#ef4444'}">${deposits >= withdrawals ? '+' : ''}${formatCurrency(deposits - withdrawals)}</div></div>`;
        html += `</div>`;
        const { rows: catSpend } = await pool.query(
          `SELECT category, SUM(amount) AS total FROM bank_transactions WHERE tenant_id = $1 AND account_id = ANY($2::bigint[]) AND type IN ('withdrawal','fee','transfer_out') AND created_at >= $3 AND created_at <= $4 GROUP BY category ORDER BY total DESC`, [tid, accIds, startDate, endDate + ' 23:59:59']
        );
        if (catSpend.length) {
          html += `<div class="chart-container"><h3 style="margin:0 0 12px;font-size:16px;color:#111827">Spending Breakdown — ${esc(selMonth)}</h3>`;
          html += svgDonut(catSpend.map(c => ({ label: CAT_LABELS[c.category] || c.category, value: Number(c.total), color: CAT_COLORS[c.category] || '#6b7280' })));
          html += `</div>`;
        }
        if (stmtTx.length) {
          html += `<div class="card"><h3 style="margin:0 0 12px;font-size:16px;color:#111827">All Transactions (${stmtTx.length})</h3>`;
          html += `<table><thead><tr><th>Date</th><th>Account</th><th>Description</th><th>Type</th><th>Amount</th><th>Balance</th></tr></thead><tbody>`;
          stmtTx.forEach(tx => {
            const isNeg = ['withdrawal','fee','transfer_out'].includes(tx.type);
            html += `<tr><td>${tx.created_at?.toISOString?.().slice(0,10) || '-'}</td><td>${esc(tx.account_number)}</td><td>${esc(tx.description || '-')}</td><td><span class="badge ${isNeg ? 'badge-red' : 'badge-green'}">${tx.type}</span></td><td class="${isNeg ? 'amount-negative' : 'amount-positive'}">${isNeg ? '-' : '+'}${formatCurrency(tx.amount)}</td><td>${formatCurrency(tx.balance_after)}</td></tr>`;
          });
          html += `</tbody></table></div>`;
        } else { html += `<div class="empty-state"><p>No transactions in ${esc(selMonth)}.</p></div>`; }
      }
      html += `<div style="margin-top:16px"><a href="/school/student-banking" class="btn btn-outline">← Dashboard</a></div>`;
      renderPage(req, res, 'Statements', html);
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Financial Literacy ───────────────────────────────────
  app.get('/school/student-banking/financial-literacy', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: lessons } = await pool.query(`SELECT fl.*, lp.status, lp.quiz_score, lp.completed_at FROM financial_lessons fl LEFT JOIN lesson_progress lp ON lp.lesson_id = fl.id AND lp.student_id = $1 AND lp.tenant_id = $2 WHERE fl.tenant_id = $3 AND fl.is_published = 1 ORDER BY fl.sort_order, fl.created_at`, [uid, tid, tid]);
      const totalLessons = lessons.length;
      const completed = lessons.filter(l => l.status === 'completed').length;
      const avgScore = lessons.filter(l => l.quiz_score !== null).reduce((a, l) => a + l.quiz_score, 0) / Math.max(1, lessons.filter(l => l.quiz_score !== null).length);
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Financial Literacy</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Financial Literacy</h2>`;
      html += `<div class="grid grid-3" style="margin-bottom:20px">`;
      html += `<div class="stat-card"><div class="stat-label">Lessons Available</div><div class="stat-value">${totalLessons}</div></div>`;
      html += `<div class="stat-card"><div class="stat-label">Completed</div><div class="stat-value" style="color:#10b981">${completed}</div></div>`;
      html += `<div class="stat-card"><div class="stat-label">Avg Quiz Score</div><div class="stat-value" style="color:${P}">${avgScore > 0 ? avgScore.toFixed(0) + '%' : '—'}</div></div>`;
      html += `</div>`;
      if (totalLessons > 0) {
        html += `<div class="progress-bar" style="margin-bottom:20px;height:14px"><div class="progress-fill" style="width:${(completed / totalLessons * 100).toFixed(1)}%;background:#10b981"></div></div>`;
        html += `<div style="font-size:13px;color:${GRAY};margin-bottom:20px">${completed}/${totalLessons} lessons completed (${(completed/totalLessons*100).toFixed(0)}%)</div>`;
      }
      if (lessons.length) {
        html += `<div class="grid grid-2">`;
        lessons.forEach(l => {
          const statusBadge = l.status === 'completed' ? 'badge-green' : l.status === 'in_progress' ? 'badge-yellow' : 'badge-gray';
          const diffBadge = l.difficulty === 'beginner' ? 'badge-green' : l.difficulty === 'intermediate' ? 'badge-yellow' : 'badge-red';
          html += `<div class="card"><div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px"><h3 style="margin:0;font-size:15px;color:#111827;flex:1">${esc(l.title)}</h3><span class="badge ${statusBadge}" style="margin-left:8px">${l.status === 'completed' ? 'Done' : l.status === 'in_progress' ? 'In Progress' : 'New'}</span></div>`;
          if (l.description) html += `<p style="font-size:13px;color:${GRAY};margin:0 0 8px">${esc(l.description).substring(0, 120)}${l.description.length > 120 ? '...' : ''}</p>`;
          html += `<div style="display:flex;gap:6px;align-items:center;margin-bottom:8px"><span class="badge ${diffBadge}" style="text-transform:capitalize">${l.difficulty}</span><span class="badge badge-blue">${l.category || 'General'}</span></div>`;
          if (l.quiz_score !== null) html += `<div style="font-size:13px;color:${GRAY};margin-bottom:8px">Quiz Score: <strong>${l.quiz_score}%</strong></div>`;
          html += `<a href="/school/student-banking/financial-literacy/${l.id}" class="btn btn-sm">Start Lesson</a></div>`;
        });
        html += `</div>`;
      } else { html += `<div class="empty-state"><p>No lessons available yet. Check back soon!</p></div>`; }
      html += `<div style="margin-top:16px"><a href="/school/student-banking" class="btn btn-outline">← Dashboard</a></div>`;
      renderPage(req, res, 'Financial Literacy', html);
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Lesson Detail / Mark Complete ────────────────────────
  app.get('/school/student-banking/financial-literacy/:id', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: lessons } = await pool.query(`SELECT * FROM financial_lessons WHERE id = $1 AND tenant_id = $2 AND is_published = 1`, [req.params.id, tid]);
      if (!lessons.length) { req.session.flash = { type: 'error', msg: 'Lesson not found' }; return res.redirect('/school/student-banking/financial-literacy'); }
      const l = lessons[0];
      const { rows: progress } = await pool.query(`SELECT * FROM lesson_progress WHERE lesson_id = $1 AND student_id = $2 AND tenant_id = $3`, [l.id, uid, tid]);
      if (!progress.length) {
        await pool.query(`INSERT INTO lesson_progress (tenant_id, student_id, lesson_id, status) VALUES ($1, $2, $3, 'in_progress')`, [tid, uid, l.id]);
        await audit(req, 'lesson_started', { lesson_id: l.id, title: l.title });
      }
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; <a href="/school/student-banking/financial-literacy" style="color:${P}">Literacy</a> &rsaquo; ${esc(l.title)}</div>`;
      html += `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px"><h2 style="margin:0;font-size:22px;font-weight:700;color:#111827">${esc(l.title)}</h2><span class="badge badge-blue" style="text-transform:capitalize">${l.difficulty}</span></div>`;
      if (l.content) {
        html += `<div class="card" style="line-height:1.7;font-size:15px;color:#374151">${l.content}</div>`;
      } else {
        html += `<div class="card"><h3 style="margin:0 0 16px;color:#111827">Lesson Content</h3>`;
        html += `<div style="background:#f0f9ff;border-radius:8px;padding:16px;margin-bottom:16px"><h4 style="margin:0 0 8px;color:#1e40af">Key Concepts</h4><ul style="margin:0;padding-left:20px;color:#374151"><li>Understanding the value of money and saving habits</li><li>How banks work: deposits, withdrawals, and interest</li><li>Creating a personal budget that works for you</li><li>The power of compound interest over time</li><li>Distinguishing between needs and wants</li></ul></div>`;
        html += `<div style="background:#f0fdf4;border-radius:8px;padding:16px;margin-bottom:16px"><h4 style="margin:0 0 8px;color:#065f46">Practical Tips</h4><ul style="margin:0;padding-left:20px;color:#374151"><li>Save at least 10% of any money you receive</li><li>Track your spending using categories</li><li>Set savings goals for things you really want</li><li>Review your spending weekly to stay on track</li><li>Avoid impulse purchases — wait 24 hours before buying</li></ul></div>`;
        html += `<div style="background:#fef3c7;border-radius:8px;padding:16px"><h4 style="margin:0 0 8px;color:#92400e">Quick Quiz</h4><p style="color:#374151;margin-bottom:12px">If you save $10 per week at 5% annual interest, approximately how much will you have after 1 year?</p><p style="color:#374151"><strong>Answer:</strong> About $540 — $520 in savings + $20 in interest!</p></div>`;
        html += `</div>`;
      }
      html += `<div class="card"><form method="POST" action="/school/student-banking/financial-literacy/${l.id}/complete">`;
      html += `<div class="form-group"><label class="form-label">Quiz Score (0-100, optional)</label><input type="number" name="quiz_score" min="0" max="100" placeholder="Enter your quiz score"></div>`;
      html += `<button type="submit" class="btn btn-success">Mark as Completed</button> <a href="/school/student-banking/financial-literacy" class="btn btn-outline">Back to Lessons</a>`;
      html += `</form></div>`;
      renderPage(req, res, l.title, html);
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/student-banking/financial-literacy/:id/complete', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const quizScore = Math.min(100, Math.max(0, Number(req.body.quiz_score) || null));
      await pool.query(
        `INSERT INTO lesson_progress (tenant_id, student_id, lesson_id, status, quiz_score, completed_at) VALUES ($1, $2, $3, 'completed', $4, NOW()) ON CONFLICT (tenant_id, student_id, lesson_id) DO UPDATE SET status = 'completed', quiz_score = COALESCE(EXCLUDED.quiz_score, lesson_progress.quiz_score), completed_at = NOW()`,
        [tid, uid, req.params.id, quizScore]
      );
      await audit(req, 'lesson_completed', { lesson_id: req.params.id, quiz_score });
      req.session.flash = { type: 'success', msg: 'Lesson completed! Great job! 🎓' };
      res.redirect('/school/student-banking/financial-literacy');
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Reports ──────────────────────────────────────────────
  app.get('/school/student-banking/reports', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: accounts } = await pool.query(`SELECT id, account_number, account_type, balance FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active'`, [tid, uid]);
      const accIds = accounts.map(a => a.id);
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Reports</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Financial Reports</h2>`;
      if (!accIds.length) { html += `<div class="empty-state"><p>No active accounts. Create an account first.</p></div>`; }
      else {
        // 6-month income vs expense
        const { rows: monthly } = await pool.query(
          `SELECT TO_CHAR(created_at, 'YYYY-MM') AS month, TO_CHAR(created_at, 'Mon YYYY') AS label, SUM(CASE WHEN type IN ('deposit','interest','transfer_in') THEN amount ELSE 0 END) AS income, SUM(CASE WHEN type IN ('withdrawal','fee','transfer_out') THEN amount ELSE 0 END) AS expense FROM bank_transactions WHERE tenant_id = $1 AND account_id = ANY($2::bigint[]) AND created_at >= NOW() - INTERVAL '6 months' GROUP BY TO_CHAR(created_at, 'YYYY-MM') ORDER BY month`, [tid, accIds]
        );
        // Top spending categories
        const { rows: topCats } = await pool.query(
          `SELECT category, SUM(amount) AS total, COUNT(*) AS tx_count FROM bank_transactions WHERE tenant_id = $1 AND account_id = ANY($2::bigint[]) AND type IN ('withdrawal','fee','transfer_out') AND created_at >= NOW() - INTERVAL '90 days' GROUP BY category ORDER BY total DESC LIMIT 8`, [tid, accIds]
        );
        // Daily spending (last 30 days)
        const { rows: dailySpend } = await pool.query(
          `SELECT created_at::date AS day, SUM(amount) AS total FROM bank_transactions WHERE tenant_id = $1 AND account_id = ANY($2::bigint[]) AND type IN ('withdrawal','fee','transfer_out') AND created_at >= NOW() - INTERVAL '30 days' GROUP BY created_at::date ORDER BY day`, [tid, accIds]
        );
        // Interest earned
        const { rows: [{ totalinterest: totalInterest }] } = await pool.query(
          `SELECT COALESCE(SUM(amount), 0) AS totalinterest FROM bank_transactions WHERE tenant_id = $1 AND account_id = ANY($2::bigint[]) AND type = 'interest'`, [tid, accIds]
        );
        // Average transaction size
        const { rows: [{ avgtx: avgTx }] } = await pool.query(
          `SELECT COALESCE(AVG(amount), 0) AS avgtx FROM bank_transactions WHERE tenant_id = $1 AND account_id = ANY($2::bigint[]) AND created_at >= NOW() - INTERVAL '90 days'`, [tid, accIds]
        );

        html += `<div class="grid grid-4" style="margin-bottom:20px">`;
        html += `<div class="stat-card"><div class="stat-label">Total Interest Earned</div><div class="stat-value" style="color:#10b981">${formatCurrency(totalInterest)}</div></div>`;
        html += `<div class="stat-card"><div class="stat-label">Avg Transaction (90d)</div><div class="stat-value">${formatCurrency(avgTx)}</div></div>`;
        const totalBal = accounts.reduce((s, a) => s + Number(a.balance), 0);
        html += `<div class="stat-card"><div class="stat-label">Total Holdings</div><div class="stat-value" style="color:${P}">${formatCurrency(totalBal)}</div></div>`;
        const txCount90 = dailySpend.reduce((s, d) => s + Number(d.total), 0);
        html += `<div class="stat-card"><div class="stat-label">Spent (30 days)</div><div class="stat-value" style="color:#ef4444">${formatCurrency(txCount90)}</div></div>`;
        html += `</div>`;

        html += `<div class="grid grid-2" style="margin-bottom:20px">`;
        // Income vs Expense bar chart
        html += `<div class="chart-container"><h3 style="margin:0 0 12px;font-size:16px;color:#111827">Income vs Expenses (6 months)</h3>`;
        const barData = monthly.flatMap(m => [
          { label: m.label + ' In', value: Number(m.income), color: '#10b981' },
          { label: m.label + ' Out', value: Number(m.expense), color: '#ef4444' }
        ]);
        html += svgBar(barData, 500, 220);
        html += `</div>`;

        // Category breakdown
        html += `<div class="chart-container"><h3 style="margin:0 0 12px;font-size:16px;color:#111827">Top Spending Categories (90 days)</h3>`;
        html += svgDonut(topCats.map(c => ({ label: CAT_LABELS[c.category] || c.category, value: Number(c.total), color: CAT_COLORS[c.category] || '#6b7280' })));
        html += `</div></div>`;

        // Daily spending trend
        html += `<div class="chart-container"><h3 style="margin:0 0 12px;font-size:16px;color:#111827">Daily Spending (30 days)</h3>`;
        html += svgLine(dailySpend.map(d => ({ label: d.day?.toISOString?.().slice(5) || '', value: Number(d.total) })), 700, 200);
        html += `</div>`;

        // Category table
        if (topCats.length) {
          html += `<div class="card"><h3 style="margin:0 0 12px;font-size:16px;color:#111827">Category Details</h3><table><thead><tr><th>Category</th><th>Total Spent</th><th>Transactions</th><th>Avg per Transaction</th></tr></thead><tbody>`;
          topCats.forEach(c => {
            const avg = c.tx_count > 0 ? Number(c.total) / c.tx_count : 0;
            html += `<tr><td><span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${CAT_COLORS[c.category] || '#6b7280'};margin-right:8px"></span>${CAT_LABELS[c.category] || c.category}</td><td style="font-weight:600">${formatCurrency(c.total)}</td><td>${c.tx_count}</td><td>${formatCurrency(avg)}</td></tr>`;
          });
          html += `</tbody></table></div>`;
        }
      }
      html += `<div style="margin-top:16px"><a href="/school/student-banking" class="btn btn-outline">← Dashboard</a></div>`;
      renderPage(req, res, 'Financial Reports', html);
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Settings ─────────────────────────────────────────────
  app.get('/school/student-banking/settings', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: accounts } = await pool.query(`SELECT * FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 ORDER BY created_at DESC`, [tid, uid]);
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Settings</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Account Settings</h2>`;
      if (accounts.length) {
        html += `<div class="card"><h3 style="margin:0 0 16px;font-size:16px;color:#111827">Manage Accounts</h3>`;
        accounts.forEach(a => {
          html += `<div style="border:1px solid #e5e7eb;border-radius:8px;padding:16px;margin-bottom:12px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px"><div><strong>${esc(a.account_number)}</strong> <span class="badge ${a.status === 'active' ? 'badge-green' : a.status === 'frozen' ? 'badge-yellow' : 'badge-gray'}">${a.status}</span><div style="font-size:13px;color:${GRAY};text-transform:capitalize">${a.account_type} &middot; Balance: ${formatCurrency(a.balance)}</div></div></div>`;
          html += `<form method="POST" action="/school/student-banking/settings/update" style="display:flex;gap:10px;flex-wrap:wrap;align-items:end">`;
          html += `<input type="hidden" name="account_id" value="${a.id}">`;
          html += `<div class="form-group" style="margin:0;min-width:120px"><label class="form-label" style="font-size:12px">Daily Limit</label><input type="number" name="daily_limit" step="0.01" min="0" value="${a.daily_limit}" style="font-size:13px"></div>`;
          html += `<div class="form-group" style="margin:0;min-width:120px"><label class="form-label" style="font-size:12px">Monthly Limit</label><input type="number" name="monthly_limit" step="0.01" min="0" value="${a.monthly_limit}" style="font-size:13px"></div>`;
          html += `<div class="form-group" style="margin:0;min-width:100px"><label class="form-label" style="font-size:12px">Interest %</label><input type="number" name="interest_rate" step="0.0001" min="0" max="1" value="${a.interest_rate}" style="font-size:13px"></div>`;
          html += `<div class="form-group" style="margin:0;min-width:100px"><label class="form-label" style="font-size:12px">Status</label><select name="status" style="font-size:13px"><option value="active" ${a.status === 'active' ? 'selected' : ''}>Active</option><option value="frozen" ${a.status === 'frozen' ? 'selected' : ''}>Frozen</option><option value="closed" ${a.status === 'closed' ? 'selected' : ''}>Closed</option></select></div>`;
          html += `<button type="submit" class="btn btn-sm">Save</button></form></div>`;
        });
        html += `</div>`;
        // Calculate interest
        html += `<div class="card"><h3 style="margin:0 0 12px;font-size:16px;color:#111827">Calculate Interest</h3><p style="font-size:13px;color:${GRAY};margin-bottom:12px">Apply monthly interest to all active savings accounts based on their current balance.</p><form method="POST" action="/school/student-banking/settings/calc-interest"><button type="submit" class="btn btn-success">Calculate & Apply Interest</button></form></div>`;
        // Budget management
        html += `<div class="card"><h3 style="margin:0 0 12px;font-size:16px;color:#111827">Monthly Budget Settings</h3><p style="font-size:13px;color:${GRAY};margin-bottom:12px">Set spending limits per category for the current month.</p><form method="POST" action="/school/student-banking/settings/budget"><input type="hidden" name="period" value="${new Date().toISOString().slice(0,7)}">`;
        CATEGORIES.forEach(c => {
          html += `<div style="display:flex;align-items:center;gap:10px;margin-bottom:8px"><span style="min-width:140px;font-size:13px">${CAT_LABELS[c]}</span><input type="number" name="budget_${c}" step="0.01" min="0" placeholder="0.00" style="max-width:160px;font-size:13px"></div>`;
        });
        html += `<button type="submit" class="btn btn-sm">Save Budgets</button></form></div>`;
      } else { html += `<div class="empty-state"><p>No accounts yet.</p></div>`; }
      html += `<div style="margin-top:16px"><a href="/school/student-banking" class="btn btn-outline">← Dashboard</a></div>`;
      renderPage(req, res, 'Banking Settings', html);
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/student-banking/settings/update', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { account_id, daily_limit, monthly_limit, interest_rate, status } = req.body;
      const { rows: acct } = await pool.query(`SELECT id FROM bank_accounts WHERE id = $1 AND tenant_id = $2 AND student_id = $3`, [account_id, tid, uid]);
      if (!acct.length) { req.session.flash = { type: 'error', msg: 'Account not found' }; return res.redirect('/school/student-banking/settings'); }
      await pool.query(
        `UPDATE bank_accounts SET daily_limit = $1, monthly_limit = $2, interest_rate = $3, status = $4 WHERE id = $5 AND tenant_id = $6`,
        [daily_limit, monthly_limit, interest_rate, status, account_id, tid]
      );
      await audit(req, 'bank_settings_updated', { account_id, daily_limit, monthly_limit, interest_rate, status });
      req.session.flash = { type: 'success', msg: 'Account settings updated!' };
      res.redirect('/school/student-banking/settings');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/student-banking/settings/calc-interest', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: accounts } = await pool.query(`SELECT id, balance, interest_rate FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active' AND interest_rate > 0`, [tid, uid]);
      let totalInterest = 0;
      try {
        await pool.query('BEGIN');
        for (const a of accounts) {
          const monthlyRate = Number(a.interest_rate) / 12;
          const interest = Number(a.balance) * monthlyRate;
          if (interest > 0.005) {
            const roundedInterest = Math.round(interest * 100) / 100;
            const newBal = Number(a.balance) + roundedInterest;
            await pool.query(`UPDATE bank_accounts SET balance = $1 WHERE id = $2`, [newBal, a.id]);
            await pool.query(
              `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, category, reference, balance_after, created_by) VALUES ($1, $2, 'interest', $3, $4, 'savings', $5, $6, $7)`,
              [tid, a.id, roundedInterest, `Monthly interest (${(Number(a.interest_rate) * 100).toFixed(2)}% APR)`, 'INT' + Date.now().toString(36).toUpperCase() + a.id, newBal, uid]
            );
            totalInterest += roundedInterest;
          }
        }
        await pool.query('COMMIT');
      } catch(e) { await pool.query('ROLLBACK'); throw e; }
      await audit(req, 'interest_calculated', { total_interest: totalInterest, accounts: accounts.length });
      req.session.flash = { type: 'success', msg: `Interest applied: ${formatCurrency(totalInterest)} across ${accounts.length} account(s).` };
      res.redirect('/school/student-banking/settings');
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/student-banking/settings/budget', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const period = req.body.period || new Date().toISOString().slice(0, 7);
      const { rows: accounts } = await pool.query(`SELECT id FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active'`, [tid, uid]);
      if (!accounts.length) { req.session.flash = { type: 'error', msg: 'No active accounts' }; return res.redirect('/school/student-banking/settings'); }
      for (const cat of CATEGORIES) {
        const limit = Number(req.body[`budget_${cat}`]) || 0;
        for (const a of accounts) {
          await pool.query(
            `INSERT INTO bank_budgets (tenant_id, account_id, category, monthly_limit, period_month) VALUES ($1, $2, $3, $4, $5) ON CONFLICT (tenant_id, account_id, category, period_month) DO UPDATE SET monthly_limit = EXCLUDED.monthly_limit`,
            [tid, a.id, cat, limit, period]
          );
        }
      }
      await audit(req, 'budget_updated', { period });
      req.session.flash = { type: 'success', msg: `Budgets saved for ${period}` };
      res.redirect('/school/student-banking/settings');
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Budget Dashboard ─────────────────────────────────────
  app.get('/school/student-banking/budget', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const period = req.query.period || new Date().toISOString().slice(0, 7);
      const { rows: accounts } = await pool.query(`SELECT id, account_number FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active'`, [tid, uid]);
      const accIds = accounts.map(a => a.id);
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Budget</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Budget Tracker — ${esc(period)}</h2>`;
      if (accIds.length) {
        const { rows: budgets } = await pool.query(
          `SELECT bb.category, bb.monthly_limit FROM bank_budgets bb WHERE bb.tenant_id = $1 AND bb.account_id = ANY($2::bigint[]) AND bb.period_month = $3`, [tid, accIds, period]
        );
        const { rows: spending } = await pool.query(
          `SELECT category, SUM(amount) AS total FROM bank_transactions WHERE tenant_id = $1 AND account_id = ANY($2::bigint[]) AND type IN ('withdrawal','fee','transfer_out') AND created_at >= $3 AND created_at <= $4 GROUP BY category`,
          [tid, accIds, period + '-01', period + '-31 23:59:59']
        );
        const budgetMap = {};
        budgets.forEach(b => { budgetMap[b.category] = Number(b.monthly_limit); });
        const spendMap = {};
        spending.forEach(s => { spendMap[s.category] = Number(s.total); });
        html += `<div class="card">`;
        CATEGORIES.forEach(cat => {
          const limit = budgetMap[cat] || 0;
          const spent = spendMap[cat] || 0;
          if (limit > 0 || spent > 0) {
            const overBudget = spent > limit && limit > 0;
            const pct = limit > 0 ? Math.min(100, (spent / limit) * 100) : 0;
            const barColor = overBudget ? '#ef4444' : pct > 75 ? '#f59e0b' : '#10b981';
            html += `<div style="margin-bottom:16px"><div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px"><span style="font-size:14px;color:#374151">${CAT_LABELS[cat]}</span><span style="font-size:13px;color:${overBudget ? '#ef4444' : GRAY}">${formatCurrency(spent)} / ${formatCurrency(limit)} ${overBudget ? '⚠️ OVER BUDGET' : ''}</span></div><div class="progress-bar"><div class="progress-fill" style="width:${pct.toFixed(1)}%;background:${barColor}"></div></div></div>`;
          }
        });
        html += `</div>`;
      }
      html += `<div style="margin-top:16px"><a href="/school/student-banking" class="btn btn-outline">← Dashboard</a></div>`;
      renderPage(req, res, 'Budget Tracker', html);
    } catch(e) { ah(e, req, res); }
  });

  // ── Route: Quick Pay (POS simulation) ──────────────────────────
  app.get('/school/student-banking/quick-pay', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { rows: accounts } = await pool.query(`SELECT id, account_number, account_type, balance FROM bank_accounts WHERE tenant_id = $1 AND student_id = $2 AND status = 'active' ORDER BY created_at DESC`, [tid, uid]);
      let html = SKIP;
      html += `<div class="breadcrumb" style="margin-bottom:16px"><a href="/school" style="color:${P}">School</a> &rsaquo; <a href="/school/student-banking" style="color:${P}">Banking</a> &rsaquo; Quick Pay</div>`;
      html += `<h2 style="margin:0 0 20px;font-size:22px;font-weight:700;color:#111827">Quick Pay</h2>`;
      if (!accounts.length) { html += `<div class="alert alert-info">No active accounts.</div>`; }
      else {
        html += `<div class="card"><form method="POST" action="/school/student-banking/quick-pay">`;
        html += `<div class="form-group"><label class="form-label">Account</label><select name="account_id" required>`;
        accounts.forEach(a => { html += `<option value="${a.id}">${esc(a.account_number)} (${a.account_type}) — ${formatCurrency(a.balance)}</option>`; });
        html += `</select></div>`;
        html += `<div class="form-group"><label class="form-label">Amount</label><input type="number" name="amount" step="0.01" min="0.01" required placeholder="Enter amount"></div>`;
        html += `<div class="form-group"><label class="form-label">Merchant</label><input name="merchant" required placeholder="e.g. School Canteen"></div>`;
        html += `<div class="form-group"><label class="form-label">Category</label><select name="category">`;
        CATEGORIES.forEach(c => { html += `<option value="${c}">${CAT_LABELS[c]}</option>`; });
        html += `</select></div>`;
        html += `<button type="submit" class="btn">Pay Now</button> <a href="/school/student-banking" class="btn btn-outline">Cancel</a>`;
        html += `</form></div>`;
      }
      renderPage(req, res, 'Quick Pay', html);
    } catch(e) { ah(e, req, res); }
  });

  app.post('/school/student-banking/quick-pay', requireAuth, requireNotBanned, async (req, res) => {
    try {
      const tid = req.tenant_id, uid = req.user.id;
      const { account_id, amount, merchant, category } = req.body;
      const amt = Number(amount);
      if (!amt || amt <= 0) { req.session.flash = { type: 'error', msg: 'Invalid amount' }; return res.redirect('/school/student-banking/quick-pay'); }
      const { rows: acct } = await pool.query(`SELECT id, balance, daily_limit FROM bank_accounts WHERE id = $1 AND tenant_id = $2 AND student_id = $3 AND status = 'active'`, [account_id, tid, uid]);
      if (!acct.length) { req.session.flash = { type: 'error', msg: 'Account not found or inactive' }; return res.redirect('/school/student-banking/quick-pay'); }
      if (Number(acct[0].balance) < amt) { req.session.flash = { type: 'error', msg: 'Insufficient funds' }; return res.redirect('/school/student-banking/quick-pay'); }
      const { rows: dayTotal } = await pool.query(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM bank_transactions WHERE tenant_id = $1 AND account_id = $2 AND type IN ('withdrawal','fee','transfer_out') AND created_at >= CURRENT_DATE`, [tid, account_id]
      );
      if (Number(dayTotal[0].total) + amt > Number(acct[0].daily_limit)) {
        req.session.flash = { type: 'error', msg: `Daily limit of ${formatCurrency(acct[0].daily_limit)} exceeded` };
        return res.redirect('/school/student-banking/quick-pay');
      }
      const newBal = Number(acct[0].balance) - amt;
      const ref = 'QP' + Date.now().toString(36).toUpperCase();
      await pool.query(`UPDATE bank_accounts SET balance = $1 WHERE id = $2`, [newBal, account_id]);
      await pool.query(
        `INSERT INTO bank_transactions (tenant_id, account_id, type, amount, description, category, merchant, reference, balance_after, created_by) VALUES ($1, $2, 'withdrawal', $3, $4, $5, $6, $7, $8, $9)`,
        [tid, account_id, amt, `Quick pay: ${merchant || 'Purchase'}`, category || 'other', merchant || null, ref, newBal, uid]
      );
      await audit(req, 'bank_quick_pay', { account_id, amount: amt, merchant, reference: ref });
      req.session.flash = { type: 'success', msg: `Paid ${formatCurrency(amt)} to ${merchant || 'merchant'} successfully!` };
      res.redirect('/school/student-banking/transactions');
    } catch(e) { ah(e, req, res); }
  });
};
