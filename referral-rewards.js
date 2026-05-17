/**
 * Referral Rewards Module
 * Parent referral rewards program — dashboard, tracking, claims, leaderboard, payouts
 */
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const trackRevenue = global.trackRevenue || (() => {});
  const requireAdmin = opts.requireAdmin || ((req,res,next) => { if(!req.session?.user?.role?.match(/admin|super/)) return res.status(403).send('Forbidden'); next(); });
  const tenantId = opts.tenantId || (() => 'default');
  const PRIMARY = '#4f46e5';
  const PRIMARY_LIGHT = '#e0e7ff';
  const PRIMARY_DARK = '#3730a3';
  const SUCCESS = '#059669';
  const WARNING = '#d97706';
  const DANGER = '#dc2626';
  const GRAY_50 = '#f9fafb';
  const GRAY_100 = '#f3f4f6';
  const GRAY_200 = '#e5e7eb';
  const GRAY_600 = '#4b5563';
  const GRAY_800 = '#1f2937';

  // ─── TABLE CREATION ──────────────────────────────────────────────
  (async () => {
    const tid = typeof tenantId === 'function' ? 'default' : tenantId;
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_codes (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        user_id INTEGER NOT NULL,
        code TEXT NOT NULL UNIQUE,
        use_count INTEGER NOT NULL DEFAULT 0,
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(tenant_id, user_id)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_tracking (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        referrer_id INTEGER NOT NULL,
        referee_id INTEGER NOT NULL,
        referral_code TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','completed','expired','fraudulent')),
        first_fee_paid BOOLEAN NOT NULL DEFAULT false,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        completed_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '90 days'),
        UNIQUE(tenant_id, referee_id)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_rewards_config (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        milestone INTEGER NOT NULL,
        reward_type TEXT NOT NULL CHECK (reward_type IN ('fee_discount','cashback','free_term','merchandise')),
        reward_value TEXT NOT NULL DEFAULT '0',
        reward_label TEXT NOT NULL DEFAULT '',
        active BOOLEAN NOT NULL DEFAULT true,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        UNIQUE(tenant_id, milestone)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_reward_claims (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        user_id INTEGER NOT NULL,
        tracking_id INTEGER REFERENCES referral_tracking(id),
        reward_config_id INTEGER REFERENCES referral_rewards_config(id),
        milestone INTEGER NOT NULL DEFAULT 1,
        status TEXT NOT NULL DEFAULT 'earned' CHECK (status IN ('earned','pending','approved','claimed','expired','rejected')),
        reward_type TEXT NOT NULL,
        reward_value TEXT NOT NULL DEFAULT '0',
        reward_label TEXT NOT NULL DEFAULT '',
        claimed_at TIMESTAMP WITH TIME ZONE,
        approved_by INTEGER,
        approved_at TIMESTAMP WITH TIME ZONE,
        expires_at TIMESTAMP WITH TIME ZONE DEFAULT (NOW() + INTERVAL '60 days'),
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
        notes TEXT
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS referral_payouts (
        id SERIAL PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT '${tid}',
        user_id INTEGER NOT NULL,
        claim_id INTEGER REFERENCES referral_reward_claims(id),
        amount NUMERIC(10,2) NOT NULL DEFAULT 0,
        payout_method TEXT NOT NULL DEFAULT 'bank_transfer' CHECK (payout_method IN ('bank_transfer','mobile_money','fee_credit','check')),
        status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','cancelled')),
        reference TEXT,
        processed_by INTEGER,
        processed_at TIMESTAMP WITH TIME ZONE,
        notes TEXT,
        created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
      );
    `);
    // Seed default reward configs
    const existing = await pool.query(`SELECT id FROM referral_rewards_config WHERE tenant_id = $1 LIMIT 1`, [tid]);
    if (existing.rows.length === 0) {
      await pool.query(`
        INSERT INTO referral_rewards_config (tenant_id, milestone, reward_type, reward_value, reward_label) VALUES
        ($1, 1, 'fee_discount', '10', '10% Fee Discount'),
        ($1, 5, 'cashback', '5000', 'Cashback 5,000'),
        ($1, 10, 'free_term', '1', '1 Free Term'),
        ($1, 20, 'merchandise', 'school_pack', 'Premium School Pack'),
        ($1, 50, 'cashback', '25000', 'Cashback 25,000')
      `, [tid]);
    }
  })();

  // ─── HELPER: Generate unique referral code ───────────────────────
  async function generateReferralCode(userId) {
    const prefix = 'REF';
    const base = String(userId).padStart(4, '0');
    let code;
    let attempts = 0;
    while (attempts < 10) {
      const suffix = Math.random().toString(36).substring(2, 6).toUpperCase();
      code = `${prefix}${base}${suffix}`;
      const exists = await pool.query(`SELECT id FROM referral_codes WHERE code = $1`, [code]);
      if (exists.rows.length === 0) return code;
      attempts++;
    }
    throw new Error('Failed to generate unique referral code');
  }

  // ─── HELPER: SVG chart helpers ────────────────────────────────────
  function svgLineChart(data, w, h, color) {
    if (!data || data.length === 0) return `<p style="color:${GRAY_600};text-align:center;padding:20px;">No data available</p>`;
    const pad = { t: 20, r: 20, b: 40, l: 50 };
    const cw = w - pad.l - pad.r;
    const ch = h - pad.t - pad.b;
    const maxVal = Math.max(...data.map(d => d.v), 1);
    const minDate = new Date(Math.min(...data.map(d => new Date(d.d).getTime())));
    const maxDate = new Date(Math.max(...data.map(d => new Date(d.d).getTime())));
    const dateRange = maxDate - minDate || 1;
    const points = data.map(d => {
      const x = pad.l + ((new Date(d.d) - minDate) / dateRange) * cw;
      const y = pad.t + ch - (d.v / maxVal) * ch;
      return `${x},${y}`;
    }).join(' ');
    const labels = data.length <= 7 ? data : data.filter((_, i) => i % Math.ceil(data.length / 7) === 0);
    const yTicks = 5;
    let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Referral trend chart">`;
    svg += `<defs><linearGradient id="grad_line" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.3"/><stop offset="100%" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>`;
    // Grid lines
    for (let i = 0; i <= yTicks; i++) {
      const y = pad.t + (ch / yTicks) * i;
      const val = Math.round(maxVal - (maxVal / yTicks) * i);
      svg += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="${GRAY_200}" stroke-width="0.5"/>`;
      svg += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" fill="${GRAY_600}" font-size="11">${val}</text>`;
    }
    // Area fill
    const areaPoints = points + ` ${pad.l + cw},${pad.t + ch} ${pad.l},${pad.t + ch}`;
    svg += `<polygon points="${areaPoints}" fill="url(#grad_line)"/>`;
    // Line
    svg += `<polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>`;
    // Dots
    data.forEach(d => {
      const x = pad.l + ((new Date(d.d) - minDate) / dateRange) * cw;
      const y = pad.t + ch - (d.v / maxVal) * ch;
      svg += `<circle cx="${x}" cy="${y}" r="3.5" fill="${color}" stroke="white" stroke-width="2"/>`;
    });
    // X-axis labels
    labels.forEach(d => {
      const x = pad.l + ((new Date(d.d) - minDate) / dateRange) * cw;
      const label = new Date(d.d).toLocaleDateString('en', { month: 'short', day: 'numeric' });
      svg += `<text x="${x}" y="${h - 8}" text-anchor="middle" fill="${GRAY_600}" font-size="10">${esc(label)}</text>`;
    });
    svg += `</svg>`;
    return svg;
  }

  function svgBarChart(data, w, h, color) {
    if (!data || data.length === 0) return `<p style="color:${GRAY_600};text-align:center;padding:20px;">No data yet</p>`;
    const pad = { t: 20, r: 20, b: 60, l: 60 };
    const cw = w - pad.l - pad.r;
    const ch = h - pad.t - pad.b;
    const maxVal = Math.max(...data.map(d => d.v), 1);
    const barW = Math.min(40, (cw / data.length) * 0.65);
    const gap = (cw - barW * data.length) / (data.length + 1);
    let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Leaderboard bar chart">`;
    // Grid
    for (let i = 0; i <= 4; i++) {
      const y = pad.t + (ch / 4) * i;
      const val = Math.round(maxVal - (maxVal / 4) * i);
      svg += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="${GRAY_200}" stroke-width="0.5"/>`;
      svg += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" fill="${GRAY_600}" font-size="11">${val}</text>`;
    }
    data.forEach((d, i) => {
      const x = pad.l + gap + i * (barW + gap);
      const barH = (d.v / maxVal) * ch;
      const y = pad.t + ch - barH;
      const barColor = i === 0 ? '#f59e0b' : i === 1 ? '#94a3b8' : i === 2 ? '#b45309' : color;
      svg += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${barColor}"/>`;
      svg += `<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" fill="${GRAY_800}" font-size="11" font-weight="600">${d.v}</text>`;
      svg += `<text x="${x + barW / 2}" y="${h - 8}" text-anchor="middle" fill="${GRAY_600}" font-size="10" transform="rotate(-30 ${x + barW / 2},${h - 8})">${esc(d.l)}</text>`;
    });
    svg += `</svg>`;
    return svg;
  }

  function svgQRCode(text, size) {
    // Simple SVG QR-like pattern from hash (decorative, not scannable — for production use a library)
    const hash = require('crypto').createHash('md5').update(text).digest('hex');
    const grid = 21;
    const cellSize = Math.floor(size / grid);
    const actualSize = cellSize * grid;
    let svg = `<svg width="${actualSize}" height="${actualSize}" viewBox="0 0 ${actualSize} ${actualSize}" role="img" aria-label="QR code for referral link" style="border-radius:8px;background:white;padding:8px;">`;
    svg += `<rect width="${actualSize}" height="${actualSize}" fill="white" rx="4"/>`;
    // Position detection patterns (corners)
    function drawFinder(ox, oy) {
      svg += `<rect x="${ox}" y="${oy}" width="${cellSize*7}" height="${cellSize*7}" fill="${PRIMARY}" rx="2"/>`;
      svg += `<rect x="${ox+cellSize}" y="${oy+cellSize}" width="${cellSize*5}" height="${cellSize*5}" fill="white"/>`;
      svg += `<rect x="${ox+cellSize*2}" y="${oy+cellSize*2}" width="${cellSize*3}" height="${cellSize*3}" fill="${PRIMARY}" rx="1"/>`;
    }
    drawFinder(0, 0);
    drawFinder((grid - 7) * cellSize, 0);
    drawFinder(0, (grid - 7) * cellSize);
    // Data modules
    for (let i = 0; i < hash.length; i++) {
      const bit = parseInt(hash[i], 16);
      for (let b = 0; b < 4; b++) {
        const idx = i * 4 + b;
        const row = Math.floor(idx / grid);
        const col = idx % grid;
        if (row >= grid || col >= grid) continue;
        if ((row < 8 && col < 8) || (row < 8 && col >= grid - 8) || (row >= grid - 8 && col < 8)) continue;
        if ((bit >> (3 - b)) & 1) {
          svg += `<rect x="${col * cellSize}" y="${row * cellSize}" width="${cellSize}" height="${cellSize}" fill="${PRIMARY_DARK}"/>`;
        }
      }
    }
    svg += `</svg>`;
    return svg;
  }

  // ─── HELPER: Get or create referral code ─────────────────────────
  async function getOrCreateReferralCode(userId, tid) {
    const existing = await pool.query(`SELECT * FROM referral_codes WHERE tenant_id = $1 AND user_id = $2`, [tid, userId]);
    if (existing.rows.length > 0) return existing.rows[0];
    const code = await generateReferralCode(userId);
    const result = await pool.query(
      `INSERT INTO referral_codes (tenant_id, user_id, code) VALUES ($1, $2, $3) RETURNING *`,
      [tid, userId, code]
    );
    audit('referral_code_created', { userId, code, tenantId: tid });
    return result.rows[0];
  }

  // ─── HELPER: Calculate user's completed referral count ───────────
  async function getCompletedReferralCount(userId, tid) {
    const r = await pool.query(
      `SELECT COUNT(*) as cnt FROM referral_tracking WHERE tenant_id = $1 AND referrer_id = $2 AND status = 'completed'`,
      [tid, userId]
    );
    return parseInt(r.rows[0].cnt, 10);
  }

  // ─── HELPER: Check and award milestone rewards ───────────────────
  async function checkMilestoneRewards(userId, tid, referralCount) {
    const configs = await pool.query(
      `SELECT * FROM referral_rewards_config WHERE tenant_id = $1 AND active = true AND milestone <= $2 ORDER BY milestone ASC`,
      [tid, referralCount]
    );
    for (const cfg of configs.rows) {
      const already = await pool.query(
        `SELECT id FROM referral_reward_claims WHERE tenant_id = $1 AND user_id = $2 AND reward_config_id = $3`,
        [tid, userId, cfg.id]
      );
      if (already.rows.length === 0) {
        await pool.query(
          `INSERT INTO referral_reward_claims (tenant_id, user_id, milestone, reward_type, reward_value, reward_label, reward_config_id, status) VALUES ($1,$2,$3,$4,$5,$6,$7,'earned')`,
          [tid, userId, cfg.milestone, cfg.reward_type, cfg.reward_value, cfg.reward_label, cfg.id]
        );
        audit('milestone_reward_earned', { userId, milestone: cfg.milestone, reward: cfg.reward_label, tenantId: tid });
      }
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE 1: REFERRAL DASHBOARD
  // ═══════════════════════════════════════════════════════════════════
  app.get('/referral-rewards', requireAuth, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const uid = req.session.user.id;
    const codeRow = await getOrCreateReferralCode(uid, tid);
    const referrals = await pool.query(
      `SELECT rt.*, u.name as referee_name, u.email as referee_email
       FROM referral_tracking rt
       LEFT JOIN users u ON u.id = rt.referee_id
       WHERE rt.tenant_id = $1 AND rt.referrer_id = $2
       ORDER BY rt.created_at DESC LIMIT 50`,
      [tid, uid]
    );
    const counts = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'completed') as completed,
         COUNT(*) FILTER (WHERE status = 'pending') as pending,
         COUNT(*) FILTER (WHERE status = 'expired') as expired,
         COUNT(*) FILTER (WHERE status = 'fraudulent') as fraudulent
       FROM referral_tracking WHERE tenant_id = $1 AND referrer_id = $2`,
      [tid, uid]
    );
    const rewards = await pool.query(
      `SELECT * FROM referral_reward_claims WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 20`,
      [tid, uid]
    );
    const earnedTotal = rewards.rows.filter(r => r.status === 'claimed' || r.status === 'approved').length;
    // Referrals over time (last 12 months)
    const timeline = await pool.query(
      `SELECT DATE_TRUNC('month', created_at)::date as d, COUNT(*) as v
       FROM referral_tracking
       WHERE tenant_id = $1 AND referrer_id = $2 AND created_at >= NOW() - INTERVAL '12 months'
       GROUP BY d ORDER BY d`,
      [tid, uid]
    );
    const chartHtml = svgLineChart(timeline.rows, 600, 220, PRIMARY);
    const c = counts.rows[0];
    const baseUrl = (req.headers['x-forwarded-proto'] || req.protocol) + '://' + req.get('host');
    const referralLink = `${baseUrl}/register?ref=${esc(codeRow.code)}`;
    const qrSvg = svgQRCode(referralLink, 140);

    const html = `
    <div style="max-width:1100px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;" role="main">
      <h1 style="font-size:1.75rem;font-weight:700;color:${GRAY_800};margin-bottom:4px;">Referral Rewards</h1>
      <p style="color:${GRAY_600};margin-bottom:24px;">Share your link and earn rewards for every successful referral.</p>

      <!-- Stats Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px;">
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;letter-spacing:0.05em;">Total Referrals</div>
          <div style="font-size:2rem;font-weight:700;color:${PRIMARY};margin-top:4px;">${parseInt(c.completed||0) + parseInt(c.pending||0)}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;letter-spacing:0.05em;">Completed</div>
          <div style="font-size:2rem;font-weight:700;color:${SUCCESS};margin-top:4px;">${c.completed || 0}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;letter-spacing:0.05em;">Pending</div>
          <div style="font-size:2rem;font-weight:700;color:${WARNING};margin-top:4px;">${c.pending || 0}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;letter-spacing:0.05em;">Rewards Earned</div>
          <div style="font-size:2rem;font-weight:700;color:${PRIMARY};margin-top:4px;">${earnedTotal}</div>
        </div>
      </div>

      <!-- Referral Link Card -->
      <div style="background:linear-gradient(135deg,${PRIMARY},${PRIMARY_DARK});border-radius:16px;padding:28px;color:white;margin-bottom:28px;display:flex;flex-wrap:wrap;gap:24px;align-items:center;">
        <div style="flex:1;min-width:260px;">
          <h2 style="font-size:1.15rem;font-weight:600;margin:0 0 8px;">Your Referral Code</h2>
          <div style="font-size:1.5rem;font-weight:800;letter-spacing:0.08em;font-family:monospace;background:rgba(255,255,255,0.15);padding:10px 18px;border-radius:8px;display:inline-block;">${esc(codeRow.code)}</div>
          <div style="margin-top:12px;display:flex;gap:8px;flex-wrap:wrap;align-items:center;">
            <input id="refLinkInput" type="text" value="${esc(referralLink)}" readonly aria-label="Referral link"
              style="flex:1;min-width:200px;padding:10px 14px;border-radius:8px;border:1px solid rgba(255,255,255,0.3);background:rgba(255,255,255,0.15);color:white;font-size:0.9rem;outline:none;" />
            <button onclick="navigator.clipboard.writeText(document.getElementById('refLinkInput').value);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',1500)"
              style="padding:10px 20px;background:white;color:${PRIMARY};border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.9rem;" aria-label="Copy referral link">Copy</button>
          </div>
        </div>
        <div style="text-align:center;">
          <div style="background:white;border-radius:12px;padding:10px;display:inline-block;">${qrSvg}</div>
          <div style="font-size:0.75rem;margin-top:6px;opacity:0.85;">Scan to share</div>
        </div>
      </div>

      <!-- Referral Trend Chart -->
      <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};margin-bottom:28px;">
        <h2 style="font-size:1.1rem;font-weight:600;color:${GRAY_800};margin:0 0 16px;">Referrals Over Time</h2>
        ${chartHtml}
      </div>

      <!-- Referral History -->
      <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};margin-bottom:28px;">
        <h2 style="font-size:1.1rem;font-weight:600;color:${GRAY_800};margin:0 0 16px;">Referral History</h2>
        ${referrals.rows.length === 0 ? '<p style="color:'+GRAY_600+';text-align:center;padding:20px;">No referrals yet. Share your link to get started!</p>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;" role="table" aria-label="Referral history">
            <thead>
              <tr style="border-bottom:2px solid ${GRAY_200};">
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Referee</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Date</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Status</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Fee Paid</th>
              </tr>
            </thead>
            <tbody>
              ${referrals.rows.map(r => {
                const statusColors = { pending: WARNING, completed: SUCCESS, expired: GRAY_600, fraudulent: DANGER };
                const statusBg = { pending: '#fef3c7', completed: '#d1fae5', expired: GRAY_100, fraudulent: '#fee2e2' };
                return `<tr style="border-bottom:1px solid ${GRAY_200};">
                  <td style="padding:10px 12px;">${esc(r.referee_name || 'Unknown')}</td>
                  <td style="padding:10px 12px;color:${GRAY_600};">${new Date(r.created_at).toLocaleDateString()}</td>
                  <td style="padding:10px 12px;">
                    <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;color:${statusColors[r.status]||GRAY_600};background:${statusBg[r.status]||GRAY_100};">
                      ${esc(r.status)}
                    </span>
                  </td>
                  <td style="padding:10px 12px;">${r.first_fee_paid ? '✅ Yes' : '⏳ No'}</td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>

      <!-- Reward History -->
      <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};margin-bottom:28px;">
        <h2 style="font-size:1.1rem;font-weight:600;color:${GRAY_800};margin:0 0 16px;">Reward History</h2>
        ${rewards.rows.length === 0 ? '<p style="color:'+GRAY_600+';text-align:center;padding:20px;">Complete referrals to earn rewards!</p>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;" role="table" aria-label="Reward history">
            <thead>
              <tr style="border-bottom:2px solid ${GRAY_200};">
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Milestone</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Reward</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Type</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Status</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Action</th>
              </tr>
            </thead>
            <tbody>
              ${rewards.rows.map(r => {
                const statusColors = { earned: PRIMARY, pending: WARNING, approved: SUCCESS, claimed: SUCCESS, expired: GRAY_600, rejected: DANGER };
                const statusBg = { earned: PRIMARY_LIGHT, pending: '#fef3c7', approved: '#d1fae5', claimed: '#d1fae5', expired: GRAY_100, rejected: '#fee2e2' };
                const canClaim = r.status === 'earned' || r.status === 'approved';
                return `<tr style="border-bottom:1px solid ${GRAY_200};">
                  <td style="padding:10px 12px;font-weight:600;">#${esc(String(r.milestone))}</td>
                  <td style="padding:10px 12px;">${esc(r.reward_label)}</td>
                  <td style="padding:10px 12px;color:${GRAY_600};text-transform:capitalize;">${esc(r.reward_type.replace('_',' '))}</td>
                  <td style="padding:10px 12px;">
                    <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;color:${statusColors[r.status]||GRAY_600};background:${statusBg[r.status]||GRAY_100};">
                      ${esc(r.status)}
                    </span>
                  </td>
                  <td style="padding:10px 12px;">
                    ${canClaim ? `<form method="POST" action="/referral-rewards/claim" style="display:inline;">
                      <input type="hidden" name="claimId" value="${r.id}"/>
                      <button type="submit" style="padding:6px 16px;background:${PRIMARY};color:white;border:none;border-radius:6px;font-size:0.85rem;font-weight:600;cursor:pointer;">Claim</button>
                    </form>` : '<span style="color:'+GRAY_600+';font-size:0.85rem;">—</span>'}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>

      <div style="text-align:center;margin-bottom:24px;">
        <a href="/referral-rewards/leaderboard" style="color:${PRIMARY};font-weight:600;text-decoration:none;font-size:0.95rem;">View Leaderboard →</a>
      </div>
    </div>`;
    res.send(renderPage('Referral Rewards', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE 2: GENERATE / REFRESH REFERRAL LINK
  // ═══════════════════════════════════════════════════════════════════
  app.post('/referral-rewards/generate', requireAuth, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const uid = req.session.user.id;
    // Deactivate old code
    await pool.query(`UPDATE referral_codes SET active = false WHERE tenant_id = $1 AND user_id = $2`, [tid, uid]);
    // Generate new
    const newCode = await generateReferralCode(uid);
    await pool.query(
      `INSERT INTO referral_codes (tenant_id, user_id, code, active) VALUES ($1, $2, $3, true) RETURNING *`,
      [tid, uid, newCode]
    );
    audit('referral_code_regenerated', { userId: uid, newCode, tenantId: tid });
    req.flash = req.flash || (() => {});
    req.flash('success', 'New referral code generated: ' + newCode);
    res.redirect('/referral-rewards');
  }));

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE 3: TRACK REFERRALS (called when referee signs up)
  // ═══════════════════════════════════════════════════════════════════
  app.get('/referral-rewards/track/:code', ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const code = req.params.code;
    const codeRow = await pool.query(`SELECT * FROM referral_codes WHERE code = $1 AND tenant_id = $2 AND active = true`, [code, tid]);
    if (codeRow.rows.length === 0) {
      return res.status(404).send(renderPage('Invalid Referral', '<p style="color:'+DANGER+';text-align:center;padding:40px;">Invalid or expired referral code.</p>', req.session?.user));
    }
    res.redirect('/register?ref=' + encodeURIComponent(code));
  }));

  // Internal: record referral when new user signs up with code
  async function recordReferral(refereeId, refCode, tid) {
    if (!refCode) return;
    const codeRow = await pool.query(`SELECT * FROM referral_codes WHERE code = $1 AND tenant_id = $2 AND active = true`, [refCode, tid]);
    if (codeRow.rows.length === 0) return;
    const referrer = codeRow.rows[0];
    if (referrer.user_id === refereeId) return; // Can't refer yourself
    const existing = await pool.query(`SELECT id FROM referral_tracking WHERE tenant_id = $1 AND referee_id = $2`, [tid, refereeId]);
    if (existing.rows.length > 0) return; // Already tracked
    await pool.query(
      `INSERT INTO referral_tracking (tenant_id, referrer_id, referee_id, referral_code) VALUES ($1, $2, $3, $4)`,
      [tid, referrer.user_id, refereeId, refCode]
    );
    await pool.query(`UPDATE referral_codes SET use_count = use_count + 1 WHERE id = $1`, [referrer.id]);
    // Also give referee a reward
    await pool.query(
      `INSERT INTO referral_reward_claims (tenant_id, user_id, milestone, reward_type, reward_value, reward_label, status) VALUES ($1,$2,0,'fee_discount','5','Welcome: 5% Fee Discount','earned') ON CONFLICT DO NOTHING`,
      [tid, refereeId]
    );
    audit('referral_recorded', { referrerId: referrer.user_id, refereeId, code: refCode, tenantId: tid });
  }

  // Internal: mark referral completed when first fee is paid
  async function completeReferral(refereeId, tid) {
    const tracking = await pool.query(
      `SELECT * FROM referral_tracking WHERE tenant_id = $1 AND referee_id = $2 AND status = 'pending'`,
      [tid, refereeId]
    );
    for (const t of tracking.rows) {
      await pool.query(
        `UPDATE referral_tracking SET status = 'completed', first_fee_paid = true, completed_at = NOW() WHERE id = $1`,
        [t.id]
      );
      const refCount = await getCompletedReferralCount(t.referrer_id, tid);
      await checkMilestoneRewards(t.referrer_id, tid, refCount);
      audit('referral_completed', { trackingId: t.id, referrerId: t.referrer_id, refereeId, tenantId: tid });
      trackRevenue('referral_bonus', { referrerId: t.referrer_id, tenantId: tid });
    }
  }

  // Admin: manually complete a referral
  app.post('/referral-rewards/complete/:id', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const trackingId = req.params.id;
    const tracking = await pool.query(`SELECT * FROM referral_tracking WHERE id = $1 AND tenant_id = $2`, [trackingId, tid]);
    if (tracking.rows.length === 0) return res.status(404).send('Not found');
    const t = tracking.rows[0];
    await pool.query(
      `UPDATE referral_tracking SET status = 'completed', first_fee_paid = true, completed_at = NOW() WHERE id = $1`,
      [trackingId]
    );
    const refCount = await getCompletedReferralCount(t.referrer_id, tid);
    await checkMilestoneRewards(t.referrer_id, tid, refCount);
    audit('referral_manually_completed', { trackingId, adminId: req.session.user.id, tenantId: tid });
    res.redirect('/referral-rewards/admin/tracking');
  }));

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE 4: REWARD CONFIGURATION (Admin)
  // ═══════════════════════════════════════════════════════════════════
  app.get('/referral-rewards/admin/config', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const configs = await pool.query(
      `SELECT * FROM referral_rewards_config WHERE tenant_id = $1 ORDER BY milestone ASC`,
      [tid]
    );
    const html = `
    <div style="max-width:900px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;" role="main">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="font-size:1.75rem;font-weight:700;color:${GRAY_800};margin:0;">Reward Configuration</h1>
          <p style="color:${GRAY_600};margin:4px 0 0;">Set milestone rewards for referrals</p>
        </div>
        <a href="/referral-rewards/admin" style="color:${PRIMARY};text-decoration:none;font-weight:600;">← Back to Admin</a>
      </div>

      <!-- Add New Config -->
      <div style="background:white;border-radius:12px;padding:24px;border:1px solid ${GRAY_200};margin-bottom:24px;">
        <h2 style="font-size:1.1rem;font-weight:600;color:${GRAY_800};margin:0 0 16px;">Add / Edit Reward</h2>
        <form method="POST" action="/referral-rewards/admin/config" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;">
          <div>
            <label style="display:block;font-size:0.85rem;font-weight:600;color:${GRAY_600};margin-bottom:4px;" for="cfgMilestone">Milestone #</label>
            <input id="cfgMilestone" name="milestone" type="number" min="1" required placeholder="e.g. 15"
              style="width:100%;padding:10px 12px;border:1px solid ${GRAY_200};border-radius:8px;font-size:0.95rem;outline:none;box-sizing:border-box;" />
          </div>
          <div>
            <label style="display:block;font-size:0.85rem;font-weight:600;color:${GRAY_600};margin-bottom:4px;" for="cfgType">Reward Type</label>
            <select id="cfgType" name="reward_type" required
              style="width:100%;padding:10px 12px;border:1px solid ${GRAY_200};border-radius:8px;font-size:0.95rem;outline:none;box-sizing:border-box;background:white;">
              <option value="fee_discount">Fee Discount (%)</option>
              <option value="cashback">Cashback Amount</option>
              <option value="free_term">Free Term(s)</option>
              <option value="merchandise">Merchandise</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.85rem;font-weight:600;color:${GRAY_600};margin-bottom:4px;" for="cfgValue">Reward Value</label>
            <input id="cfgValue" name="reward_value" type="text" required placeholder="e.g. 10 or 5000"
              style="width:100%;padding:10px 12px;border:1px solid ${GRAY_200};border-radius:8px;font-size:0.95rem;outline:none;box-sizing:border-box;" />
          </div>
          <div>
            <label style="display:block;font-size:0.85rem;font-weight:600;color:${GRAY_600};margin-bottom:4px;" for="cfgLabel">Label</label>
            <input id="cfgLabel" name="reward_label" type="text" required placeholder="e.g. 10% Fee Discount"
              style="width:100%;padding:10px 12px;border:1px solid ${GRAY_200};border-radius:8px;font-size:0.95rem;outline:none;box-sizing:border-box;" />
          </div>
          <div style="align-self:end;">
            <button type="submit" style="padding:10px 24px;background:${PRIMARY};color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.95rem;">Save Config</button>
          </div>
        </form>
      </div>

      <!-- Current Configs -->
      <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
        <h2 style="font-size:1.1rem;font-weight:600;color:${GRAY_800};margin:0 0 16px;">Current Milestone Rewards</h2>
        ${configs.rows.length === 0 ? '<p style="color:'+GRAY_600+';text-align:center;padding:20px;">No reward configs yet.</p>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;" role="table" aria-label="Reward configuration">
            <thead>
              <tr style="border-bottom:2px solid ${GRAY_200};">
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Milestone</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Type</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Value</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Label</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Active</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${configs.rows.map(r => `<tr style="border-bottom:1px solid ${GRAY_200};">
                <td style="padding:10px 12px;font-weight:600;">#${esc(String(r.milestone))} Referral</td>
                <td style="padding:10px 12px;text-transform:capitalize;">${esc(r.reward_type.replace('_',' '))}</td>
                <td style="padding:10px 12px;font-weight:600;">${esc(r.reward_value)}</td>
                <td style="padding:10px 12px;">${esc(r.reward_label)}</td>
                <td style="padding:10px 12px;">
                  <span style="display:inline-block;width:12px;height:12px;border-radius:50%;background:${r.active ? SUCCESS : GRAY_200};" aria-label="${r.active ? 'Active' : 'Inactive'}"></span>
                </td>
                <td style="padding:10px 12px;">
                  <form method="POST" action="/referral-rewards/admin/config/toggle" style="display:inline;">
                    <input type="hidden" name="id" value="${r.id}"/>
                    <button type="submit" style="padding:5px 12px;border:1px solid ${GRAY_200};border-radius:6px;background:white;cursor:pointer;font-size:0.8rem;color:${GRAY_600};">${r.active ? 'Disable' : 'Enable'}</button>
                  </form>
                  <form method="POST" action="/referral-rewards/admin/config/delete" style="display:inline;margin-left:4px;" onsubmit="return confirm('Delete this reward config?')">
                    <input type="hidden" name="id" value="${r.id}"/>
                    <button type="submit" style="padding:5px 12px;border:1px solid ${DANGER};border-radius:6px;background:white;cursor:pointer;font-size:0.8rem;color:${DANGER};">Delete</button>
                  </form>
                </td>
              </tr>`).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    </div>`;
    res.send(renderPage('Reward Configuration', html, req.session.user));
  }));

  app.post('/referral-rewards/admin/config', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const { milestone, reward_type, reward_value, reward_label } = req.body;
    if (!milestone || !reward_type || !reward_value || !reward_label) {
      return res.status(400).send('All fields required');
    }
    await pool.query(
      `INSERT INTO referral_rewards_config (tenant_id, milestone, reward_type, reward_value, reward_label) VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (tenant_id, milestone) DO UPDATE SET reward_type=$3, reward_value=$4, reward_label=$5, updated_at=NOW()`,
      [tid, milestone, reward_type, reward_value, reward_label]
    );
    audit('reward_config_saved', { milestone, reward_type, reward_value, tenantId: tid, adminId: req.session.user.id });
    res.redirect('/referral-rewards/admin/config');
  }));

  app.post('/referral-rewards/admin/config/toggle', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    await pool.query(
      `UPDATE referral_rewards_config SET active = NOT active, updated_at = NOW() WHERE id = $1 AND tenant_id = $2`,
      [req.body.id, tid]
    );
    res.redirect('/referral-rewards/admin/config');
  }));

  app.post('/referral-rewards/admin/config/delete', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    await pool.query(`DELETE FROM referral_rewards_config WHERE id = $1 AND tenant_id = $2`, [req.body.id, tid]);
    audit('reward_config_deleted', { configId: req.body.id, tenantId: tid, adminId: req.session.user.id });
    res.redirect('/referral-rewards/admin/config');
  }));

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE 5: REWARD CLAIMS (User claims, Admin approves)
  // ═══════════════════════════════════════════════════════════════════
  app.post('/referral-rewards/claim', requireAuth, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const uid = req.session.user.id;
    const claimId = req.body.claimId;
    const claim = await pool.query(
      `SELECT * FROM referral_reward_claims WHERE id = $1 AND tenant_id = $2 AND user_id = $3`,
      [claimId, tid, uid]
    );
    if (claim.rows.length === 0) return res.status(404).send('Claim not found');
    const c = claim.rows[0];
    if (c.status !== 'earned' && c.status !== 'approved') {
      return res.status(400).send('This reward is not available for claiming');
    }
    const needsApproval = c.milestone >= 5;
    const newStatus = needsApproval ? 'pending' : 'claimed';
    await pool.query(
      `UPDATE referral_reward_claims SET status = $1, claimed_at = CASE WHEN $1 = 'claimed' THEN NOW() ELSE NULL END WHERE id = $2`,
      [newStatus, claimId]
    );
    audit('reward_claim_submitted', { claimId, userId: uid, status: newStatus, tenantId: tid });
    if (newStatus === 'claimed' && c.reward_type === 'fee_discount') {
      // Apply fee discount immediately
      trackRevenue('reward_claimed', { userId: uid, type: c.reward_type, value: c.reward_value, tenantId: tid });
    }
    res.redirect('/referral-rewards');
  }));

  // Admin: view and manage claims
  app.get('/referral-rewards/admin/claims', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const statusFilter = req.query.status || 'pending';
    const claims = await pool.query(
      `SELECT rc.*, u.name as user_name, u.email as user_email
       FROM referral_reward_claims rc
       LEFT JOIN users u ON u.id = rc.user_id
       WHERE rc.tenant_id = $1 AND rc.status = $2
       ORDER BY rc.created_at DESC LIMIT 100`,
      [tid, statusFilter]
    );
    const allCounts = await pool.query(
      `SELECT status, COUNT(*) as cnt FROM referral_reward_claims WHERE tenant_id = $1 GROUP BY status`,
      [tid]
    );
    const countMap = {};
    allCounts.rows.forEach(r => { countMap[r.status] = r.cnt; });

    const html = `
    <div style="max-width:1100px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;" role="main">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="font-size:1.75rem;font-weight:700;color:${GRAY_800};margin:0;">Reward Claims</h1>
          <p style="color:${GRAY_600};margin:4px 0 0;">Review and approve reward claims</p>
        </div>
        <a href="/referral-rewards/admin" style="color:${PRIMARY};text-decoration:none;font-weight:600;">← Admin Panel</a>
      </div>

      <!-- Status Tabs -->
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;" role="tablist" aria-label="Claim status filter">
        ${['pending','earned','approved','claimed','expired','rejected'].map(s => `
          <a href="/referral-rewards/admin/claims?status=${s}" role="tab"
            style="padding:8px 18px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.9rem;
            background:${statusFilter === s ? PRIMARY : 'white'};
            color:${statusFilter === s ? 'white' : GRAY_600};
            border:1px solid ${statusFilter === s ? PRIMARY : GRAY_200};">
            ${esc(s.charAt(0).toUpperCase() + s.slice(1))} (${countMap[s] || 0})
          </a>
        `).join('')}
      </div>

      <!-- Claims Table -->
      <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
        ${claims.rows.length === 0 ? '<p style="color:'+GRAY_600+';text-align:center;padding:40px;">No claims with this status.</p>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;" role="table" aria-label="Reward claims">
            <thead>
              <tr style="border-bottom:2px solid ${GRAY_200};">
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">User</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Milestone</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Reward</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Type</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Submitted</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Expires</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${claims.rows.map(r => {
                const canApprove = r.status === 'pending';
                const canReject = r.status === 'pending' || r.status === 'earned';
                return `<tr style="border-bottom:1px solid ${GRAY_200};">
                  <td style="padding:10px 12px;">
                    <div style="font-weight:600;">${esc(r.user_name||'User #'+r.user_id)}</div>
                    <div style="font-size:0.8rem;color:${GRAY_600};">${esc(r.user_email||'')}</div>
                  </td>
                  <td style="padding:10px 12px;font-weight:600;">#${esc(String(r.milestone))}</td>
                  <td style="padding:10px 12px;">${esc(r.reward_label)}</td>
                  <td style="padding:10px 12px;text-transform:capitalize;">${esc(r.reward_type.replace('_',' '))}</td>
                  <td style="padding:10px 12px;color:${GRAY_600};">${new Date(r.created_at).toLocaleDateString()}</td>
                  <td style="padding:10px 12px;color:${GRAY_600};">${r.expires_at ? new Date(r.expires_at).toLocaleDateString() : '—'}</td>
                  <td style="padding:10px 12px;">
                    ${canApprove ? `
                      <form method="POST" action="/referral-rewards/admin/claims/approve" style="display:inline;">
                        <input type="hidden" name="claimId" value="${r.id}"/>
                        <button type="submit" style="padding:5px 12px;background:${SUCCESS};color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">Approve</button>
                      </form>
                    ` : ''}
                    ${canReject ? `
                      <form method="POST" action="/referral-rewards/admin/claims/reject" style="display:inline;margin-left:4px;">
                        <input type="hidden" name="claimId" value="${r.id}"/>
                        <button type="submit" style="padding:5px 12px;background:${DANGER};color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">Reject</button>
                      </form>
                    ` : ''}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    </div>`;
    res.send(renderPage('Reward Claims Admin', html, req.session.user));
  }));

  app.post('/referral-rewards/admin/claims/approve', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const claimId = req.body.claimId;
    await pool.query(
      `UPDATE referral_reward_claims SET status = 'approved', approved_by = $1, approved_at = NOW() WHERE id = $2 AND tenant_id = $3`,
      [req.session.user.id, claimId, tid]
    );
    audit('reward_claim_approved', { claimId, adminId: req.session.user.id, tenantId: tid });
    res.redirect('/referral-rewards/admin/claims');
  }));

  app.post('/referral-rewards/admin/claims/reject', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const claimId = req.body.claimId;
    await pool.query(
      `UPDATE referral_reward_claims SET status = 'rejected', notes = 'Rejected by admin' WHERE id = $1 AND tenant_id = $2`,
      [claimId, tid]
    );
    audit('reward_claim_rejected', { claimId, adminId: req.session.user.id, tenantId: tid });
    res.redirect('/referral-rewards/admin/claims');
  }));

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE 6: LEADERBOARD
  // ═══════════════════════════════════════════════════════════════════
  app.get('/referral-rewards/leaderboard', requireAuth, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const period = req.query.period || 'month';

    // Monthly leaderboard
    const monthlyLeaders = await pool.query(
      `SELECT rc.user_id, u.name, COUNT(*) as total
       FROM referral_tracking rt
       JOIN referral_codes rc ON rc.code = rt.referral_code AND rc.tenant_id = rt.tenant_id
       LEFT JOIN users u ON u.id = rc.user_id
       WHERE rt.tenant_id = $1 AND rt.status = 'completed'
         AND rt.completed_at >= DATE_TRUNC('month', NOW())
       GROUP BY rc.user_id, u.name
       ORDER BY total DESC LIMIT 15`,
      [tid]
    );

    // All-time leaderboard
    const allTimeLeaders = await pool.query(
      `SELECT rc.user_id, u.name, COUNT(*) as total
       FROM referral_tracking rt
       JOIN referral_codes rc ON rc.code = rt.referral_code AND rc.tenant_id = rt.tenant_id
       LEFT JOIN users u ON u.id = rc.user_id
       WHERE rt.tenant_id = $1 AND rt.status = 'completed'
       GROUP BY rc.user_id, u.name
       ORDER BY total DESC LIMIT 15`,
      [tid]
    );

    const leaderboard = period === 'alltime' ? allTimeLeaders.rows : monthlyLeaders.rows;
    const chartData = leaderboard.slice(0, 10).map((r, i) => ({
      l: r.name ? r.name.split(' ')[0].substring(0, 10) : 'User' + r.user_id,
      v: parseInt(r.total, 10)
    }));
    const chartHtml = svgBarChart(chartData, 650, 260, PRIMARY);

    // User rank
    const uid = req.session.user.id;
    const userRank = await pool.query(
      `SELECT rank FROM (
         SELECT rc.user_id, RANK() OVER (ORDER BY COUNT(*) DESC) as rank
         FROM referral_tracking rt
         JOIN referral_codes rc ON rc.code = rt.referral_code AND rc.tenant_id = rt.tenant_id
         WHERE rt.tenant_id = $1 AND rt.status = 'completed'
         ${period === 'month' ? "AND rt.completed_at >= DATE_TRUNC('month', NOW())" : ''}
         GROUP BY rc.user_id
       ) sub WHERE user_id = $2`,
      [tid, uid]
    );

    const html = `
    <div style="max-width:900px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;" role="main">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="font-size:1.75rem;font-weight:700;color:${GRAY_800};margin:0;">Referral Leaderboard</h1>
          <p style="color:${GRAY_600};margin:4px 0 0;">Top parent referrers</p>
        </div>
        <a href="/referral-rewards" style="color:${PRIMARY};text-decoration:none;font-weight:600;">← My Dashboard</a>
      </div>

      <!-- Period Tabs -->
      <div style="display:flex;gap:8px;margin-bottom:24px;" role="tablist" aria-label="Leaderboard period">
        <a href="/referral-rewards/leaderboard?period=month" role="tab"
          style="padding:8px 20px;border-radius:8px;text-decoration:none;font-weight:600;
          background:${period === 'month' ? PRIMARY : 'white'};
          color:${period === 'month' ? 'white' : GRAY_600};
          border:1px solid ${period === 'month' ? PRIMARY : GRAY_200};">
          This Month
        </a>
        <a href="/referral-rewards/leaderboard?period=alltime" role="tab"
          style="padding:8px 20px;border-radius:8px;text-decoration:none;font-weight:600;
          background:${period === 'alltime' ? PRIMARY : 'white'};
          color:${period === 'alltime' ? 'white' : GRAY_600};
          border:1px solid ${period === 'alltime' ? PRIMARY : GRAY_200};">
          All Time
        </a>
      </div>

      <!-- Your Rank -->
      <div style="background:linear-gradient(135deg,${PRIMARY_LIGHT},${PRIMARY_LIGHT});border-radius:12px;padding:20px;margin-bottom:24px;border:2px solid ${PRIMARY};text-align:center;">
        <div style="font-size:0.85rem;color:${PRIMARY_DARK};text-transform:uppercase;letter-spacing:0.05em;">Your Rank</div>
        <div style="font-size:2.5rem;font-weight:800;color:${PRIMARY};margin-top:4px;">
          ${userRank.rows.length > 0 ? '#' + userRank.rows[0].rank : 'N/A'}
        </div>
      </div>

      <!-- Chart -->
      <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};margin-bottom:24px;">
        <h2 style="font-size:1.1rem;font-weight:600;color:${GRAY_800};margin:0 0 16px;">Top Referrers</h2>
        ${chartHtml}
      </div>

      <!-- Leaderboard Table -->
      <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
        <table style="width:100%;border-collapse:collapse;font-size:0.9rem;" role="table" aria-label="Leaderboard">
          <thead>
            <tr style="border-bottom:2px solid ${GRAY_200};">
              <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Rank</th>
              <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Parent</th>
              <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Referrals</th>
              <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Badge</th>
            </tr>
          </thead>
          <tbody>
            ${leaderboard.map((r, i) => {
              const medals = ['🥇', '🥈', '🥉'];
              const badge = i < 3 ? medals[i] : '';
              const isUser = r.user_id === uid;
              return `<tr style="border-bottom:1px solid ${GRAY_200};${isUser ? 'background:'+PRIMARY_LIGHT+';font-weight:600;' : ''}">
                <td style="padding:10px 12px;font-weight:600;">${i + 1}</td>
                <td style="padding:10px 12px;">${esc(r.name || 'Parent #'+r.user_id)}${isUser ? ' (You)' : ''}</td>
                <td style="padding:10px 12px;font-weight:700;color:${PRIMARY};">${r.total}</td>
                <td style="padding:10px 12px;font-size:1.3rem;">${badge}</td>
              </tr>`;
            }).join('')}
          </tbody>
        </table>
      </div>
    </div>`;
    res.send(renderPage('Referral Leaderboard', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════
  // FEATURE 7: PAYOUT HISTORY (Admin)
  // ═══════════════════════════════════════════════════════════════════
  app.get('/referral-rewards/admin/payouts', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const statusFilter = req.query.status || 'all';

    let payoutsQuery, payoutsParams;
    if (statusFilter === 'all') {
      payoutsQuery = `SELECT p.*, u.name as user_name, u.email as user_email, a.name as admin_name
        FROM referral_payouts p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN users a ON a.id = p.processed_by
        WHERE p.tenant_id = $1 ORDER BY p.created_at DESC LIMIT 100`;
      payoutsParams = [tid];
    } else {
      payoutsQuery = `SELECT p.*, u.name as user_name, u.email as user_email, a.name as admin_name
        FROM referral_payouts p
        LEFT JOIN users u ON u.id = p.user_id
        LEFT JOIN users a ON a.id = p.processed_by
        WHERE p.tenant_id = $1 AND p.status = $2 ORDER BY p.created_at DESC LIMIT 100`;
      payoutsParams = [tid, statusFilter];
    }
    const payouts = await pool.query(payoutsQuery, payoutsParams);

    // Summary stats
    const summary = await pool.query(
      `SELECT
         COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
         COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
         COALESCE(SUM(amount) FILTER (WHERE status = 'completed'), 0) as total_paid,
         COALESCE(SUM(amount) FILTER (WHERE status = 'pending'), 0) as pending_amount
       FROM referral_payouts WHERE tenant_id = $1`,
      [tid]
    );
    const s = summary.rows[0];

    const html = `
    <div style="max-width:1100px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;" role="main">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="font-size:1.75rem;font-weight:700;color:${GRAY_800};margin:0;">Payout Management</h1>
          <p style="color:${GRAY_600};margin:4px 0 0;">Process and track referral reward payouts</p>
        </div>
        <a href="/referral-rewards/admin" style="color:${PRIMARY};text-decoration:none;font-weight:600;">← Admin Panel</a>
      </div>

      <!-- Summary Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;letter-spacing:0.05em;">Pending Payouts</div>
          <div style="font-size:1.75rem;font-weight:700;color:${WARNING};margin-top:4px;">${parseInt(s.pending_count)}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;letter-spacing:0.05em;">Pending Amount</div>
          <div style="font-size:1.75rem;font-weight:700;color:${WARNING};margin-top:4px;">${parseFloat(s.pending_amount).toLocaleString()}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;letter-spacing:0.05em;">Completed</div>
          <div style="font-size:1.75rem;font-weight:700;color:${SUCCESS};margin-top:4px;">${parseInt(s.completed_count)}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;letter-spacing:0.05em;">Total Paid Out</div>
          <div style="font-size:1.75rem;font-weight:700;color:${PRIMARY};margin-top:4px;">${parseFloat(s.total_paid).toLocaleString()}</div>
        </div>
      </div>

      <!-- Create Payout -->
      <div style="background:white;border-radius:12px;padding:24px;border:1px solid ${GRAY_200};margin-bottom:24px;">
        <h2 style="font-size:1.1rem;font-weight:600;color:${GRAY_800};margin:0 0 16px;">Create Payout</h2>
        <form method="POST" action="/referral-rewards/admin/payouts" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;">
          <div>
            <label style="display:block;font-size:0.85rem;font-weight:600;color:${GRAY_600};margin-bottom:4px;" for="payUser">User ID</label>
            <input id="payUser" name="user_id" type="number" required
              style="width:100%;padding:10px 12px;border:1px solid ${GRAY_200};border-radius:8px;font-size:0.95rem;outline:none;box-sizing:border-box;" />
          </div>
          <div>
            <label style="display:block;font-size:0.85rem;font-weight:600;color:${GRAY_600};margin-bottom:4px;" for="payAmount">Amount</label>
            <input id="payAmount" name="amount" type="number" step="0.01" min="0" required
              style="width:100%;padding:10px 12px;border:1px solid ${GRAY_200};border-radius:8px;font-size:0.95rem;outline:none;box-sizing:border-box;" />
          </div>
          <div>
            <label style="display:block;font-size:0.85rem;font-weight:600;color:${GRAY_600};margin-bottom:4px;" for="payMethod">Method</label>
            <select id="payMethod" name="payout_method" required
              style="width:100%;padding:10px 12px;border:1px solid ${GRAY_200};border-radius:8px;font-size:0.95rem;outline:none;box-sizing:border-box;background:white;">
              <option value="bank_transfer">Bank Transfer</option>
              <option value="mobile_money">Mobile Money</option>
              <option value="fee_credit">Fee Credit</option>
              <option value="check">Check</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-size:0.85rem;font-weight:600;color:${GRAY_600};margin-bottom:4px;" for="payRef">Reference</label>
            <input id="payRef" name="reference" type="text"
              style="width:100%;padding:10px 12px;border:1px solid ${GRAY_200};border-radius:8px;font-size:0.95rem;outline:none;box-sizing:border-box;" />
          </div>
          <div>
            <label style="display:block;font-size:0.85rem;font-weight:600;color:${GRAY_600};margin-bottom:4px;" for="payClaim">Claim ID (optional)</label>
            <input id="payClaim" name="claim_id" type="number"
              style="width:100%;padding:10px 12px;border:1px solid ${GRAY_200};border-radius:8px;font-size:0.95rem;outline:none;box-sizing:border-box;" />
          </div>
          <div style="align-self:end;">
            <button type="submit" style="padding:10px 24px;background:${PRIMARY};color:white;border:none;border-radius:8px;font-weight:600;cursor:pointer;font-size:0.95rem;">Create Payout</button>
          </div>
        </form>
      </div>

      <!-- Filter Tabs -->
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;" role="tablist" aria-label="Payout status filter">
        ${['all','pending','processing','completed','failed','cancelled'].map(st => `
          <a href="/referral-rewards/admin/payouts?status=${st}" role="tab"
            style="padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.9rem;
            background:${statusFilter === st ? PRIMARY : 'white'};
            color:${statusFilter === st ? 'white' : GRAY_600};
            border:1px solid ${statusFilter === st ? PRIMARY : GRAY_200};">
            ${esc(st.charAt(0).toUpperCase() + st.slice(1))}
          </a>
        `).join('')}
      </div>

      <!-- Payouts Table -->
      <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
        ${payouts.rows.length === 0 ? '<p style="color:'+GRAY_600+';text-align:center;padding:40px;">No payouts found.</p>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;" role="table" aria-label="Payout history">
            <thead>
              <tr style="border-bottom:2px solid ${GRAY_200};">
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">ID</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">User</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Amount</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Method</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Status</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Reference</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Processed By</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Date</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${payouts.rows.map(p => {
                const statusColors = { pending: WARNING, processing: PRIMARY, completed: SUCCESS, failed: DANGER, cancelled: GRAY_600 };
                const statusBg = { pending: '#fef3c7', processing: PRIMARY_LIGHT, completed: '#d1fae5', failed: '#fee2e2', cancelled: GRAY_100 };
                const canProcess = p.status === 'pending';
                return `<tr style="border-bottom:1px solid ${GRAY_200};">
                  <td style="padding:10px 12px;font-weight:600;">#${p.id}</td>
                  <td style="padding:10px 12px;">
                    <div style="font-weight:600;">${esc(p.user_name || 'User #'+p.user_id)}</div>
                    <div style="font-size:0.8rem;color:${GRAY_600};">${esc(p.user_email||'')}</div>
                  </td>
                  <td style="padding:10px 12px;font-weight:700;color:${PRIMARY};">${parseFloat(p.amount).toLocaleString()}</td>
                  <td style="padding:10px 12px;text-transform:capitalize;">${esc(p.payout_method.replace('_',' '))}</td>
                  <td style="padding:10px 12px;">
                    <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;color:${statusColors[p.status]||GRAY_600};background:${statusBg[p.status]||GRAY_100};">
                      ${esc(p.status)}
                    </span>
                  </td>
                  <td style="padding:10px 12px;font-family:monospace;font-size:0.85rem;">${esc(p.reference||'—')}</td>
                  <td style="padding:10px 12px;color:${GRAY_600};">${esc(p.admin_name||'—')}</td>
                  <td style="padding:10px 12px;color:${GRAY_600};">${new Date(p.created_at).toLocaleDateString()}</td>
                  <td style="padding:10px 12px;">
                    ${canProcess ? `
                      <form method="POST" action="/referral-rewards/admin/payouts/process" style="display:inline;">
                        <input type="hidden" name="payoutId" value="${p.id}"/>
                        <input type="hidden" name="action" value="complete"/>
                        <button type="submit" style="padding:5px 10px;background:${SUCCESS};color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;">✓</button>
                      </form>
                      <form method="POST" action="/referral-rewards/admin/payouts/process" style="display:inline;margin-left:2px;">
                        <input type="hidden" name="payoutId" value="${p.id}"/>
                        <input type="hidden" name="action" value="fail"/>
                        <button type="submit" style="padding:5px 10px;background:${DANGER};color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;">✗</button>
                      </form>
                    ` : '<span style="color:'+GRAY_600+';font-size:0.85rem;">—</span>'}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    </div>`;
    res.send(renderPage('Payout Management', html, req.session.user));
  }));

  app.post('/referral-rewards/admin/payouts', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const { user_id, amount, payout_method, reference, claim_id } = req.body;
    if (!user_id || !amount || !payout_method) {
      return res.status(400).send('User ID, amount, and method are required');
    }
    const parsedAmount = parseFloat(amount);
    if (isNaN(parsedAmount) || parsedAmount <= 0) {
      return res.status(400).send('Invalid amount');
    }
    await pool.query(
      `INSERT INTO referral_payouts (tenant_id, user_id, claim_id, amount, payout_method, reference, status) VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
      [tid, user_id, claim_id || null, parsedAmount, payout_method, reference || null]
    );
    if (claim_id) {
      await pool.query(
        `UPDATE referral_reward_claims SET status = 'pending' WHERE id = $1 AND tenant_id = $2`,
        [claim_id, tid]
      );
    }
    audit('payout_created', { userId: user_id, amount: parsedAmount, method: payout_method, tenantId: tid, adminId: req.session.user.id });
    res.redirect('/referral-rewards/admin/payouts');
  }));

  app.post('/referral-rewards/admin/payouts/process', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const payoutId = req.body.payoutId;
    const action = req.body.action;
    if (action === 'complete') {
      await pool.query(
        `UPDATE referral_payouts SET status = 'completed', processed_by = $1, processed_at = NOW() WHERE id = $2 AND tenant_id = $3`,
        [req.session.user.id, payoutId, tid]
      );
      // Update linked claim
      const payout = await pool.query(`SELECT claim_id FROM referral_payouts WHERE id = $1`, [payoutId]);
      if (payout.rows[0]?.claim_id) {
        await pool.query(
          `UPDATE referral_reward_claims SET status = 'claimed', claimed_at = NOW() WHERE id = $1`,
          [payout.rows[0].claim_id]
        );
      }
      audit('payout_completed', { payoutId, adminId: req.session.user.id, tenantId: tid });
      trackRevenue('payout', { payoutId, tenantId: tid });
    } else if (action === 'fail') {
      await pool.query(
        `UPDATE referral_payouts SET status = 'failed', processed_by = $1, processed_at = NOW() WHERE id = $2 AND tenant_id = $3`,
        [req.session.user.id, payoutId, tid]
      );
      audit('payout_failed', { payoutId, adminId: req.session.user.id, tenantId: tid });
    }
    res.redirect('/referral-rewards/admin/payouts');
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ADMIN TRACKING VIEW
  // ═══════════════════════════════════════════════════════════════════
  app.get('/referral-rewards/admin/tracking', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const statusFilter = req.query.status || 'all';
    let query, params;
    if (statusFilter === 'all') {
      query = `SELECT rt.*, ur.name as referrer_name, ue.name as referee_name, ue.email as referee_email
        FROM referral_tracking rt
        LEFT JOIN users ur ON ur.id = rt.referrer_id
        LEFT JOIN users ue ON ue.id = rt.referee_id
        WHERE rt.tenant_id = $1 ORDER BY rt.created_at DESC LIMIT 100`;
      params = [tid];
    } else {
      query = `SELECT rt.*, ur.name as referrer_name, ue.name as referee_name, ue.email as referee_email
        FROM referral_tracking rt
        LEFT JOIN users ur ON ur.id = rt.referrer_id
        LEFT JOIN users ue ON ue.id = rt.referee_id
        WHERE rt.tenant_id = $1 AND rt.status = $2 ORDER BY rt.created_at DESC LIMIT 100`;
      params = [tid, statusFilter];
    }
    const tracking = await pool.query(query, params);

    const stats = await pool.query(
      `SELECT
         COUNT(*) as total,
         COUNT(*) FILTER (WHERE status = 'pending') as pending,
         COUNT(*) FILTER (WHERE status = 'completed') as completed,
         COUNT(*) FILTER (WHERE status = 'expired') as expired
       FROM referral_tracking WHERE tenant_id = $1`,
      [tid]
    );
    const st = stats.rows[0];

    const html = `
    <div style="max-width:1100px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;" role="main">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;flex-wrap:wrap;gap:12px;">
        <div>
          <h1 style="font-size:1.75rem;font-weight:700;color:${GRAY_800};margin:0;">Referral Tracking</h1>
          <p style="color:${GRAY_600};margin:4px 0 0;">All referral registrations and conversions</p>
        </div>
        <a href="/referral-rewards/admin" style="color:${PRIMARY};text-decoration:none;font-weight:600;">← Admin Panel</a>
      </div>

      <!-- Quick Stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:16px;margin-bottom:24px;">
        <div style="background:white;border-radius:12px;padding:16px;border:1px solid ${GRAY_200};text-align:center;">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;">Total</div>
          <div style="font-size:1.5rem;font-weight:700;color:${GRAY_800};">${parseInt(st.total)}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:16px;border:1px solid ${GRAY_200};text-align:center;">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;">Pending</div>
          <div style="font-size:1.5rem;font-weight:700;color:${WARNING};">${parseInt(st.pending)}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:16px;border:1px solid ${GRAY_200};text-align:center;">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;">Completed</div>
          <div style="font-size:1.5rem;font-weight:700;color:${SUCCESS};">${parseInt(st.completed)}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:16px;border:1px solid ${GRAY_200};text-align:center;">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;">Expired</div>
          <div style="font-size:1.5rem;font-weight:700;color:${GRAY_600};">${parseInt(st.expired)}</div>
        </div>
      </div>

      <!-- Filter -->
      <div style="display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap;" role="tablist" aria-label="Tracking status filter">
        ${['all','pending','completed','expired','fraudulent'].map(s => `
          <a href="/referral-rewards/admin/tracking?status=${s}" role="tab"
            style="padding:8px 16px;border-radius:8px;text-decoration:none;font-weight:600;font-size:0.9rem;
            background:${statusFilter === s ? PRIMARY : 'white'};
            color:${statusFilter === s ? 'white' : GRAY_600};
            border:1px solid ${statusFilter === s ? PRIMARY : GRAY_200};">
            ${esc(s.charAt(0).toUpperCase() + s.slice(1))}
          </a>
        `).join('')}
      </div>

      <!-- Tracking Table -->
      <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
        ${tracking.rows.length === 0 ? '<p style="color:'+GRAY_600+';text-align:center;padding:40px;">No referrals found.</p>' : `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;font-size:0.9rem;" role="table" aria-label="Referral tracking">
            <thead>
              <tr style="border-bottom:2px solid ${GRAY_200};">
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">ID</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Referrer</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Referee</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Code</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Status</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Fee Paid</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Registered</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Expires</th>
                <th style="text-align:left;padding:10px 12px;color:${GRAY_600};font-weight:600;">Actions</th>
              </tr>
            </thead>
            <tbody>
              ${tracking.rows.map(r => {
                const statusColors = { pending: WARNING, completed: SUCCESS, expired: GRAY_600, fraudulent: DANGER };
                const statusBg = { pending: '#fef3c7', completed: '#d1fae5', expired: GRAY_100, fraudulent: '#fee2e2' };
                return `<tr style="border-bottom:1px solid ${GRAY_200};">
                  <td style="padding:10px 12px;font-weight:600;">#${r.id}</td>
                  <td style="padding:10px 12px;">${esc(r.referrer_name || 'User #'+r.referrer_id)}</td>
                  <td style="padding:10px 12px;">
                    <div style="font-weight:600;">${esc(r.referee_name || 'User #'+r.referee_id)}</div>
                    <div style="font-size:0.8rem;color:${GRAY_600};">${esc(r.referee_email||'')}</div>
                  </td>
                  <td style="padding:10px 12px;font-family:monospace;">${esc(r.referral_code)}</td>
                  <td style="padding:10px 12px;">
                    <span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:0.8rem;font-weight:600;color:${statusColors[r.status]||GRAY_600};background:${statusBg[r.status]||GRAY_100};">
                      ${esc(r.status)}
                    </span>
                  </td>
                  <td style="padding:10px 12px;">${r.first_fee_paid ? '✅' : '⏳'}</td>
                  <td style="padding:10px 12px;color:${GRAY_600};">${new Date(r.created_at).toLocaleDateString()}</td>
                  <td style="padding:10px 12px;color:${GRAY_600};">${r.expires_at ? new Date(r.expires_at).toLocaleDateString() : '—'}</td>
                  <td style="padding:10px 12px;">
                    ${r.status === 'pending' ? `
                      <form method="POST" action="/referral-rewards/complete/${r.id}" style="display:inline;">
                        <button type="submit" style="padding:5px 12px;background:${SUCCESS};color:white;border:none;border-radius:6px;cursor:pointer;font-size:0.8rem;font-weight:600;">Complete</button>
                      </form>
                    ` : ''}
                  </td>
                </tr>`;
              }).join('')}
            </tbody>
          </table>
        </div>`}
      </div>
    </div>`;
    res.send(renderPage('Referral Tracking Admin', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ADMIN DASHBOARD HUB
  // ═══════════════════════════════════════════════════════════════════
  app.get('/referral-rewards/admin', requireAdmin, ah(async (req, res) => {
    const tid = typeof tenantId === 'function' ? tenantId(req) : tenantId;
    const totalReferrals = await pool.query(
      `SELECT COUNT(*) as cnt FROM referral_tracking WHERE tenant_id = $1`, [tid]
    );
    const completedReferrals = await pool.query(
      `SELECT COUNT(*) as cnt FROM referral_tracking WHERE tenant_id = $1 AND status = 'completed'`, [tid]
    );
    const pendingClaims = await pool.query(
      `SELECT COUNT(*) as cnt FROM referral_reward_claims WHERE tenant_id = $1 AND status = 'pending'`, [tid]
    );
    const pendingPayouts = await pool.query(
      `SELECT COUNT(*) as cnt FROM referral_payouts WHERE tenant_id = $1 AND status = 'pending'`, [tid]
    );
    const totalPaid = await pool.query(
      `SELECT COALESCE(SUM(amount), 0) as total FROM referral_payouts WHERE tenant_id = $1 AND status = 'completed'`, [tid]
    );
    const conversionRate = totalReferrals.rows[0].cnt > 0
      ? ((completedReferrals.rows[0].cnt / totalReferrals.rows[0].cnt) * 100).toFixed(1)
      : '0.0';

    // Monthly trend
    const monthlyTrend = await pool.query(
      `SELECT DATE_TRUNC('month', created_at)::date as d, COUNT(*) as v
       FROM referral_tracking WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '12 months'
       GROUP BY d ORDER BY d`,
      [tid]
    );
    const trendChart = svgLineChart(monthlyTrend.rows, 500, 200, PRIMARY);

    const html = `
    <div style="max-width:1100px;margin:0 auto;font-family:system-ui,-apple-system,sans-serif;" role="main">
      <h1 style="font-size:1.75rem;font-weight:700;color:${GRAY_800};margin-bottom:4px;">Referral Rewards Admin</h1>
      <p style="color:${GRAY_600};margin-bottom:24px;">Program overview and management</p>

      <!-- Stats -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:28px;">
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;">Total Referrals</div>
          <div style="font-size:2rem;font-weight:700;color:${PRIMARY};">${parseInt(totalReferrals.rows[0].cnt)}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;">Conversion Rate</div>
          <div style="font-size:2rem;font-weight:700;color:${SUCCESS};">${conversionRate}%</div>
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;">Pending Claims</div>
          <div style="font-size:2rem;font-weight:700;color:${WARNING};">${parseInt(pendingClaims.rows[0].cnt)}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;">Pending Payouts</div>
          <div style="font-size:2rem;font-weight:700;color:${WARNING};">${parseInt(pendingPayouts.rows[0].cnt)}</div>
        </div>
        <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};">
          <div style="font-size:0.8rem;color:${GRAY_600};text-transform:uppercase;">Total Paid Out</div>
          <div style="font-size:2rem;font-weight:700;color:${PRIMARY};">${parseFloat(totalPaid.rows[0].total).toLocaleString()}</div>
        </div>
      </div>

      <!-- Trend -->
      <div style="background:white;border-radius:12px;padding:20px;border:1px solid ${GRAY_200};margin-bottom:28px;">
        <h2 style="font-size:1.1rem;font-weight:600;color:${GRAY_800};margin:0 0 16px;">Monthly Referral Trend</h2>
        ${trendChart}
      </div>

      <!-- Admin Nav Cards -->
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:16px;">
        <a href="/referral-rewards/admin/tracking" style="text-decoration:none;">
          <div style="background:white;border-radius:12px;padding:24px;border:2px solid ${GRAY_200};transition:border-color 0.2s;" onmouseover="this.style.borderColor='${PRIMARY}'" onmouseout="this.style.borderColor='${GRAY_200}'">
            <div style="font-size:1.5rem;margin-bottom:8px;">📊</div>
            <h3 style="font-size:1rem;font-weight:600;color:${GRAY_800};margin:0 0 4px;">Referral Tracking</h3>
            <p style="font-size:0.85rem;color:${GRAY_600};margin:0;">View and manage all referrals</p>
          </div>
        </a>
        <a href="/referral-rewards/admin/config" style="text-decoration:none;">
          <div style="background:white;border-radius:12px;padding:24px;border:2px solid ${GRAY_200};transition:border-color 0.2s;" onmouseover="this.style.borderColor='${PRIMARY}'" onmouseout="this.style.borderColor='${GRAY_200}'">
            <div style="font-size:1.5rem;margin-bottom:8px;">⚙️</div>
            <h3 style="font-size:1rem;font-weight:600;color:${GRAY_800};margin:0 0 4px;">Reward Configuration</h3>
            <p style="font-size:0.85rem;color:${GRAY_600};margin:0;">Set milestone rewards and types</p>
          </div>
        </a>
        <a href="/referral-rewards/admin/claims" style="text-decoration:none;">
          <div style="background:white;border-radius:12px;padding:24px;border:2px solid ${GRAY_200};transition:border-color 0.2s;" onmouseover="this.style.borderColor='${PRIMARY}'" onmouseout="this.style.borderColor='${GRAY_200}'">
            <div style="font-size:1.5rem;margin-bottom:8px;">🎁</div>
            <h3 style="font-size:1rem;font-weight:600;color:${GRAY_800};margin:0 0 4px;">Reward Claims</h3>
            <p style="font-size:0.85rem;color:${GRAY_600};margin:0;">Review and approve claims</p>
          </div>
        </a>
        <a href="/referral-rewards/admin/payouts" style="text-decoration:none;">
          <div style="background:white;border-radius:12px;padding:24px;border:2px solid ${GRAY_200};transition:border-color 0.2s;" onmouseover="this.style.borderColor='${PRIMARY}'" onmouseout="this.style.borderColor='${GRAY_200}'">
            <div style="font-size:1.5rem;margin-bottom:8px;">💰</div>
            <h3 style="font-size:1rem;font-weight:600;color:${GRAY_800};margin:0 0 4px;">Payout Management</h3>
            <p style="font-size:0.85rem;color:${GRAY_600};margin:0;">Process payouts to parents</p>
          </div>
        </a>
      </div>
    </div>`;
    res.send(renderPage('Referral Rewards Admin', html, req.session.user));
  }));

  // ═══════════════════════════════════════════════════════════════════
  // PUBLIC API: Expose internal functions for external integration
  // ═══════════════════════════════════════════════════════════════════
  app.recordReferral = recordReferral;
  app.completeReferral = completeReferral;
  app.getOrCreateReferralCode = getOrCreateReferralCode;

  return {
    recordReferral,
    completeReferral,
    getOrCreateReferralCode,
    checkMilestoneRewards
  };
};
