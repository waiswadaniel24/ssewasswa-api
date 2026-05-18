/**
 * School Elections & Voting System
 * Complete module for managing student elections, candidates, voting, results, and quick polls.
 */

module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const requireAdmin = opts.requireAdmin || ((req,res,next) => { if(!req.session?.user?.role || !['admin','superadmin'].includes(req.session.user.role)) return res.status(403).send('Access denied'); next(); });
  const audit = opts.audit || (() => {});

  // ─── Table creation ────────────────────────────────────────────────────────
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS elections (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        title VARCHAR(255) NOT NULL,
        description TEXT,
        positions JSONB DEFAULT '[]'::jsonb,
        start_date TIMESTAMPTZ,
        end_date TIMESTAMPTZ,
        voting_method VARCHAR(50) DEFAULT 'one_per_position',
        status VARCHAR(50) DEFAULT 'draft',
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS election_candidates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        election_id INTEGER NOT NULL REFERENCES elections(id),
        student_id INTEGER NOT NULL,
        position VARCHAR(255) NOT NULL,
        manifesto TEXT,
        photo_url VARCHAR(500),
        status VARCHAR(50) DEFAULT 'pending',
        vote_count INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS election_votes (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        election_id INTEGER NOT NULL REFERENCES elections(id),
        voter_id INTEGER NOT NULL,
        candidate_id INTEGER NOT NULL REFERENCES election_candidates(id),
        position VARCHAR(255) NOT NULL,
        ranked_choice INTEGER,
        voted_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(voter_id, election_id, position)
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS school_polls (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        question VARCHAR(500) NOT NULL,
        options JSONB DEFAULT '[]'::jsonb,
        target_audience VARCHAR(100),
        start_date TIMESTAMPTZ,
        end_date TIMESTAMPTZ,
        is_anonymous BOOLEAN DEFAULT true,
        status VARCHAR(50) DEFAULT 'active',
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS poll_votes (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        poll_id INTEGER NOT NULL REFERENCES school_polls(id),
        voter_id INTEGER,
        selected_option VARCHAR(255) NOT NULL,
        voted_at TIMESTAMPTZ DEFAULT NOW()
      );
    `);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_elections_tenant ON elections(tenant_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_candidates_tenant ON election_candidates(tenant_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_election_votes_tenant ON election_votes(tenant_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_school_polls_tenant ON school_polls(tenant_id);`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_poll_votes_tenant ON poll_votes(tenant_id);`);
  })();

  // ─── SVG Chart helpers ─────────────────────────────────────────────────────

  function svgBarChart(data, title, width = 600, height = 400) {
    const padding = { top: 50, right: 30, bottom: 80, left: 60 };
    const chartW = width - padding.left - padding.right;
    const chartH = height - padding.top - padding.bottom;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barW = Math.min(60, (chartW / data.length) * 0.6);
    const gap = (chartW - barW * data.length) / (data.length + 1);
    const colors = ['#4f46e5','#7c3aed','#2563eb','#0891b2','#059669','#d97706','#dc2626','#ec4899','#8b5cf6','#0ea5e9'];

    let bars = '';
    let labels = '';
    let gridLines = '';
    const steps = 5;

    for (let i = 0; i <= steps; i++) {
      const y = padding.top + chartH - (chartH * i / steps);
      const val = Math.round(maxVal * i / steps);
      gridLines += `<line x1="${padding.left}" y1="${y}" x2="${width - padding.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/>`;
      gridLines += `<text x="${padding.left - 10}" y="${y + 4}" text-anchor="end" font-size="12" fill="#6b7280">${val}</text>`;
    }

    data.forEach((d, i) => {
      const x = padding.left + gap + i * (barW + gap);
      const barH = (d.value / maxVal) * chartH;
      const y = padding.top + chartH - barH;
      const color = colors[i % colors.length];
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" fill="${color}" rx="4">
        <animate attributeName="height" from="0" to="${barH}" dur="0.8s" fill="freeze"/>
        <animate attributeName="y" from="${padding.top + chartH}" to="${y}" dur="0.8s" fill="freeze"/>
      </rect>`;
      bars += `<text x="${x + barW / 2}" y="${y - 8}" text-anchor="middle" font-size="13" font-weight="bold" fill="#1f2937">${d.value}</text>`;
      const labelX = x + barW / 2;
      const labelY = padding.top + chartH + 18;
      const truncLabel = d.label.length > 14 ? d.label.slice(0, 12) + '..' : d.label;
      labels += `<text x="${labelX}" y="${labelY}" text-anchor="end" font-size="11" fill="#374151" transform="rotate(-35,${labelX},${labelY})">${esc(truncLabel)}</text>`;
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Bar chart: ${esc(title)}">
      <style>text { font-family: system-ui, -apple-system, sans-serif; }</style>
      <rect width="${width}" height="${height}" fill="#ffffff" rx="8"/>
      <text x="${width / 2}" y="30" text-anchor="middle" font-size="18" font-weight="bold" fill="#111827">${esc(title)}</text>
      <line x1="${padding.left}" y1="${padding.top}" x2="${width - padding.right}" y2="${padding.top}" stroke="#d1d5db" stroke-width="1"/>
      ${gridLines}
      ${bars}
      ${labels}
    </svg>`;
  }

  function svgPieChart(data, width = 400, height = 400) {
    const cx = width / 2;
    const cy = height / 2 + 10;
    const r = Math.min(cx, cy) - 50;
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const colors = ['#4f46e5','#7c3aed','#2563eb','#0891b2','#059669','#d97706','#dc2626','#ec4899','#8b5cf6','#0ea5e9'];
    let slices = '';
    let legend = '';
    let startAngle = -Math.PI / 2;

    data.forEach((d, i) => {
      const angle = (d.value / total) * 2 * Math.PI;
      const endAngle = startAngle + angle;
      const largeArc = angle > Math.PI ? 1 : 0;
      const x1 = cx + r * Math.cos(startAngle);
      const y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle);
      const y2 = cy + r * Math.sin(endAngle);
      const midAngle = startAngle + angle / 2;
      const labelR = r * 0.65;
      const lx = cx + labelR * Math.cos(midAngle);
      const ly = cy + labelR * Math.sin(midAngle);
      const pct = Math.round((d.value / total) * 100);

      if (angle > 0.01) {
        slices += `<path d="M${cx},${cy} L${x1},${y1} A${r},${r} 0 ${largeArc},1 ${x2},${y2} Z" fill="${colors[i % colors.length]}" stroke="#fff" stroke-width="2">
          <animate attributeName="opacity" from="0" to="1" dur="0.5s" begin="${i * 0.1}s" fill="freeze"/>
        </path>`;
        if (pct >= 5) {
          slices += `<text x="${lx}" y="${ly}" text-anchor="middle" font-size="13" font-weight="bold" fill="#fff">${pct}%</text>`;
        }
      }

      const legY = height - 40 + Math.floor(i / 3) * 20;
      const legX = 20 + (i % 3) * 140;
      legend += `<rect x="${legX}" y="${legY - 10}" width="12" height="12" rx="2" fill="${colors[i % colors.length]}"/>`;
      legend += `<text x="${legX + 16}" y="${legY}" font-size="11" fill="#374151">${esc(d.label)} (${d.value})</text>`;
      startAngle = endAngle;
    });

    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" role="img" aria-label="Pie chart">
      <style>text { font-family: system-ui, -apple-system, sans-serif; }</style>
      <rect width="${width}" height="${height}" fill="#ffffff" rx="8"/>
      ${slices}
      ${legend}
    </svg>`;
  }

  function statusBadge(status) {
    const colors = {
      draft: '#6b7280', open: '#059669', closed: '#dc2626', results_published: '#4f46e5',
      pending: '#d97706', approved: '#059669', rejected: '#dc2626', active: '#059669', expired: '#6b7280'
    };
    const bg = colors[status] || '#6b7280';
    return `<span style="display:inline-block;padding:3px 12px;border-radius:9999px;font-size:12px;font-weight:600;color:#fff;background:${bg};">${esc(status.replace(/_/g,' ').toUpperCase())}</span>`;
  }

  function pageNav(active) {
    const links = [
      { href: '/school/elections', label: 'Elections', id: 'elections' },
      { href: '/school/polls', label: 'Quick Polls', id: 'polls' }
    ];
    return links.map(l =>
      `<a href="${l.href}" style="display:inline-block;padding:8px 20px;border-radius:6px;text-decoration:none;font-weight:600;color:${active === l.id ? '#fff' : '#4f46e5'};background:${active === l.id ? '#4f46e5' : '#eef2ff'};">${l.label}</a>`
    ).join(' ');
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 1: ELECTION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════════════════

  // List all elections
  app.get('/school/elections', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const result = await pool.query(
      `SELECT e.*, u.name AS creator_name FROM elections e LEFT JOIN users u ON u.id = e.created_by WHERE e.tenant_id = $1 ORDER BY e.created_at DESC`,
      [tid]
    );
    const elections = result.rows;
    let html = `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <h1 style="font-size:28px;font-weight:800;color:#111827;margin:0;">Student Elections</h1>
        ${pageNav('elections')}
      </div>
      <a href="/school/elections/new" style="display:inline-block;padding:10px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin-bottom:20px;">+ Create Election</a>`;

    if (elections.length === 0) {
      html += `<div style="text-align:center;padding:60px 20px;color:#6b7280;">
        <p style="font-size:48px;margin-bottom:12px;">🗳️</p>
        <p style="font-size:18px;">No elections created yet. Click above to create your first election.</p>
      </div>`;
    } else {
      html += `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(320px,1fr));gap:16px;">`;
      for (const e of elections) {
        const positions = Array.isArray(e.positions) ? e.positions : JSON.parse(e.positions || '[]');
        const posList = positions.map(p => `<span style="display:inline-block;padding:2px 8px;background:#eef2ff;color:#4f46e5;border-radius:4px;font-size:12px;margin:2px;">${esc(p)}</span>`).join('');
        html += `<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fff;">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
            <h3 style="font-size:18px;font-weight:700;color:#111827;margin:0;">${esc(e.title)}</h3>
            ${statusBadge(e.status)}
          </div>
          <p style="color:#6b7280;font-size:14px;margin:8px 0;">${esc(e.description || '').slice(0, 120)}${(e.description||'').length > 120 ? '...' : ''}</p>
          <div style="margin:8px 0;">${posList}</div>
          <div style="display:flex;justify-content:space-between;align-items:center;margin-top:12px;padding-top:12px;border-top:1px solid #f3f4f6;font-size:13px;color:#6b7280;">
            <span>Method: ${esc((e.voting_method || 'one_per_position').replace(/_/g, ' '))}</span>
            <span>${e.start_date ? new Date(e.start_date).toLocaleDateString() : 'TBD'} — ${e.end_date ? new Date(e.end_date).toLocaleDateString() : 'TBD'}</span>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px;">
            <a href="/school/elections/${e.id}" style="padding:6px 14px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;">View</a>
            <a href="/school/elections/${e.id}/candidates" style="padding:6px 14px;background:#eef2ff;color:#4f46e5;text-decoration:none;border-radius:6px;font-size:13px;">Candidates</a>
            ${e.status === 'closed' || e.status === 'results_published' ? `<a href="/school/elections/${e.id}/results" style="padding:6px 14px;background:#059669;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;">Results</a>` : ''}
          </div>
        </div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
    res.send(renderPage('Elections', html, req.session.user));
  }));

  // Create election form
  app.get('/school/elections/new', requireAuth, requireAdmin, ah(async (req, res) => {
    const html = `<div style="max-width:700px;margin:0 auto;padding:20px;">
      <h1 style="font-size:28px;font-weight:800;color:#111827;margin-bottom:24px;">Create Election</h1>
      <form method="POST" action="/school/elections" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
        <div style="margin-bottom:16px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Title *</label>
          <input type="text" name="title" required placeholder="e.g. Head Prefect 2025" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;box-sizing:border-box;" aria-label="Election title"/>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Description</label>
          <textarea name="description" rows="3" placeholder="Describe the election purpose..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;box-sizing:border-box;" aria-label="Election description"></textarea>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Positions * (one per line)</label>
          <textarea name="positions" rows="4" required placeholder="Head Boy&#10;Head Girl&#10;Sports Captain&#10;Academic Captain" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;box-sizing:border-box;" aria-label="Positions"></textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Start Date *</label>
            <input type="datetime-local" name="start_date" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;box-sizing:border-box;" aria-label="Start date"/>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">End Date *</label>
            <input type="datetime-local" name="end_date" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;box-sizing:border-box;" aria-label="End date"/>
          </div>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Voting Method</label>
          <select name="voting_method" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;box-sizing:border-box;" aria-label="Voting method">
            <option value="one_per_position">One Vote Per Position</option>
            <option value="ranked">Ranked Choice Voting</option>
          </select>
        </div>
        <div style="display:flex;gap:12px;">
          <button type="submit" style="padding:10px 28px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">Create Election</button>
          <a href="/school/elections" style="padding:10px 28px;background:#f3f4f6;color:#374151;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage('Create Election', html, req.session.user));
  }));

  // Save new election
  app.post('/school/elections', requireAuth, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { title, description, positions, start_date, end_date, voting_method } = req.body;
    const positionsArr = (positions || '').split('\n').map(p => p.trim()).filter(Boolean);
    if (positionsArr.length === 0) return res.status(400).send('At least one position is required');
    const result = await pool.query(
      `INSERT INTO elections (tenant_id, title, description, positions, start_date, end_date, voting_method, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
      [tid, title, description, JSON.stringify(positionsArr), start_date, end_date, voting_method || 'one_per_position', uid]
    );
    audit('election_created', { election_id: result.rows[0].id, title }, req);
    res.redirect(`/school/elections/${result.rows[0].id}`);
  }));

  // View single election details
  app.get('/school/elections/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const result = await pool.query(
      `SELECT e.*, u.name AS creator_name FROM elections e LEFT JOIN users u ON u.id = e.created_by WHERE e.id = $1 AND e.tenant_id = $2`,
      [id, tid]
    );
    if (!result.rows[0]) return res.status(404).send('Election not found');
    const e = result.rows[0];
    const positions = Array.isArray(e.positions) ? e.positions : JSON.parse(e.positions || '[]');

    const candResult = await pool.query(
      `SELECT ec.*, u.name AS student_name FROM election_candidates ec LEFT JOIN users u ON u.id = ec.student_id WHERE ec.election_id = $1 AND ec.tenant_id = $2 ORDER BY ec.position, ec.status`,
      [id, tid]
    );
    const candidates = candResult.rows;

    const voteCountResult = await pool.query(
      `SELECT COUNT(DISTINCT voter_id) AS total_voters FROM election_votes WHERE election_id = $1 AND tenant_id = $2`,
      [id, tid]
    );
    const totalVoters = parseInt(voteCountResult.rows[0]?.total_voters || 0);

    let html = `<div style="max-width:900px;margin:0 auto;padding:20px;">
      <div style="margin-bottom:24px;">
        <a href="/school/elections" style="color:#4f46e5;text-decoration:none;font-size:14px;">&larr; Back to Elections</a>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:20px;">
        <div>
          <h1 style="font-size:28px;font-weight:800;color:#111827;margin:0 0 8px 0;">${esc(e.title)}</h1>
          <p style="color:#6b7280;font-size:15px;margin:0;">${esc(e.description || 'No description')}</p>
        </div>
        ${statusBadge(e.status)}
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:12px;margin-bottom:24px;">
        <div style="background:#eef2ff;border-radius:10px;padding:16px;">
          <div style="font-size:13px;color:#6b7280;">Voting Method</div>
          <div style="font-size:16px;font-weight:700;color:#1f2937;">${esc((e.voting_method||'one_per_position').replace(/_/g,' '))}</div>
        </div>
        <div style="background:#eef2ff;border-radius:10px;padding:16px;">
          <div style="font-size:13px;color:#6b7280;">Start</div>
          <div style="font-size:16px;font-weight:700;color:#1f2937;">${e.start_date ? new Date(e.start_date).toLocaleString() : 'TBD'}</div>
        </div>
        <div style="background:#eef2ff;border-radius:10px;padding:16px;">
          <div style="font-size:13px;color:#6b7280;">End</div>
          <div style="font-size:16px;font-weight:700;color:#1f2937;">${e.end_date ? new Date(e.end_date).toLocaleString() : 'TBD'}</div>
        </div>
        <div style="background:#eef2ff;border-radius:10px;padding:16px;">
          <div style="font-size:13px;color:#6b7280;">Total Voters</div>
          <div style="font-size:16px;font-weight:700;color:#1f2937;">${totalVoters}</div>
        </div>
      </div>

      <h2 style="font-size:20px;font-weight:700;color:#111827;margin-bottom:12px;">Positions</h2>
      <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:24px;">
        ${positions.map(p => `<span style="display:inline-block;padding:6px 16px;background:#4f46e5;color:#fff;border-radius:20px;font-size:14px;font-weight:600;">${esc(p)}</span>`).join('')}
      </div>`;

    // Admin actions
    if (req.session.user.role && ['admin','superadmin'].includes(req.session.user.role)) {
      html += `<div style="margin-bottom:24px;padding:16px;background:#fffbeb;border:1px solid #fde68a;border-radius:10px;">
        <h3 style="font-size:15px;font-weight:700;color:#92400e;margin:0 0 12px 0;">Admin Actions</h3>
        <form method="POST" action="/school/elections/${id}/status" style="display:inline;">
          <input type="hidden" name="status" value="${e.status === 'draft' ? 'open' : e.status === 'open' ? 'closed' : e.status === 'closed' ? 'results_published' : 'draft'}"/>
          <button type="submit" style="padding:8px 20px;background:#4f46e5;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;">
            Change to: ${esc((e.status === 'draft' ? 'open' : e.status === 'open' ? 'closed' : e.status === 'closed' ? 'results_published' : 'draft').toUpperCase())}
          </button>
        </form>
        <a href="/school/elections/${id}/vote" style="display:inline-block;padding:8px 20px;background:#059669;color:#fff;text-decoration:none;border-radius:6px;font-weight:600;margin-left:8px;">Open Voting Booth</a>
      </div>`;
    }

    // Candidates list by position
    html += `<h2 style="font-size:20px;font-weight:700;color:#111827;margin-bottom:12px;">Candidates (${candidates.length})</h2>`;
    if (candidates.length === 0) {
      html += `<p style="color:#6b7280;">No candidates registered yet.</p>`;
    } else {
      const byPosition = {};
      candidates.forEach(c => { (byPosition[c.position] = byPosition[c.position] || []).push(c); });
      for (const [pos, cands] of Object.entries(byPosition)) {
        html += `<div style="margin-bottom:20px;">
          <h3 style="font-size:16px;font-weight:600;color:#374151;margin-bottom:8px;">${esc(pos)}</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:12px;">`;
        for (const c of cands) {
          html += `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:16px;background:#fff;">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
              <div style="width:48px;height:48px;border-radius:50%;background:#eef2ff;display:flex;align-items:center;justify-content:center;font-size:20px;font-weight:bold;color:#4f46e5;overflow:hidden;">
                ${c.photo_url ? `<img src="${esc(c.photo_url)}" alt="${esc(c.student_name)}" style="width:100%;height:100%;object-fit:cover;"/>` : esc((c.student_name || '?')[0])}
              </div>
              <div>
                <div style="font-weight:600;color:#111827;">${esc(c.student_name || 'Unknown')}</div>
                <div>${statusBadge(c.status)}</div>
              </div>
            </div>
            <p style="font-size:13px;color:#6b7280;margin:8px 0;line-height:1.5;">${esc((c.manifesto || 'No manifesto provided.').slice(0, 150))}${(c.manifesto||'').length > 150 ? '...' : ''}</p>
            <div style="font-size:12px;color:#9ca3af;">Votes: ${c.vote_count}</div>
          </div>`;
        }
        html += `</div></div>`;
      }
    }

    html += `</div>`;
    res.send(renderPage('Election: ' + e.title, html, req.session.user));
  }));

  // Update election status
  app.post('/school/elections/:id/status', requireAuth, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { status } = req.body;
    const validStatuses = ['draft','open','closed','results_published'];
    if (!validStatuses.includes(status)) return res.status(400).send('Invalid status');
    await pool.query(`UPDATE elections SET status = $1 WHERE id = $2 AND tenant_id = $3`, [status, id, tid]);
    audit('election_status_changed', { election_id: id, status }, req);
    res.redirect(`/school/elections/${id}`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 2: CANDIDATE REGISTRATION
  // ═══════════════════════════════════════════════════════════════════════════

  // View & manage candidates for an election
  app.get('/school/elections/:id/candidates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const elResult = await pool.query(`SELECT * FROM elections WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!elResult.rows[0]) return res.status(404).send('Election not found');
    const election = elResult.rows[0];
    const positions = Array.isArray(election.positions) ? election.positions : JSON.parse(election.positions || '[]');

    const candResult = await pool.query(
      `SELECT ec.*, u.name AS student_name, u.email FROM election_candidates ec LEFT JOIN users u ON u.id = ec.student_id WHERE ec.election_id = $1 AND ec.tenant_id = $2 ORDER BY ec.position, ec.created_at`,
      [id, tid]
    );
    const candidates = candResult.rows;

    // Check if current user is already a candidate
    const alreadyCandidate = candidates.some(c => c.student_id === req.session.user.id);

    let html = `<div style="max-width:900px;margin:0 auto;padding:20px;">
      <div style="margin-bottom:24px;">
        <a href="/school/elections/${id}" style="color:#4f46e5;text-decoration:none;font-size:14px;">&larr; Back to Election</a>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <h1 style="font-size:24px;font-weight:800;color:#111827;margin:0;">Candidates — ${esc(election.title)}</h1>
        ${!alreadyCandidate ? `<a href="/school/elections/${id}/candidates/register" style="padding:10px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Register as Candidate</a>` : '<span style="color:#059669;font-weight:600;">You are a candidate</span>'}
      </div>`;

    // Admin: add candidates from student list
    if (req.session.user.role && ['admin','superadmin'].includes(req.session.user.role)) {
      html += `<details style="margin-bottom:20px;border:1px solid #e5e7eb;border-radius:10px;padding:16px;background:#fafafa;">
        <summary style="cursor:pointer;font-weight:600;color:#374151;">Admin: Add Candidate from Student List</summary>
        <form method="POST" action="/school/elections/${id}/candidates" style="margin-top:12px;">
          <div style="margin-bottom:12px;">
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Student Name or ID</label>
            <input type="text" name="student_name" placeholder="Student name..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;" aria-label="Student name"/>
          </div>
          <div style="margin-bottom:12px;">
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Position</label>
            <select name="position" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;" aria-label="Position">
              ${positions.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
            </select>
          </div>
          <button type="submit" style="padding:8px 20px;background:#4f46e5;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer;">Add Candidate</button>
        </form>
      </details>`;
    }

    // Show candidates by position
    const byPosition = {};
    candidates.forEach(c => { (byPosition[c.position] = byPosition[c.position] || []).push(c); });

    if (Object.keys(byPosition).length === 0) {
      html += `<div style="text-align:center;padding:40px;color:#6b7280;">
        <p>No candidates registered yet. Be the first to register!</p>
      </div>`;
    } else {
      for (const [pos, cands] of Object.entries(byPosition)) {
        html += `<h2 style="font-size:18px;font-weight:700;color:#111827;margin:20px 0 12px;border-bottom:2px solid #e5e7eb;padding-bottom:6px;">${esc(pos)}</h2>`;
        for (const c of cands) {
          html += `<div style="border:1px solid #e5e7eb;border-radius:10px;padding:20px;background:#fff;margin-bottom:12px;">
            <div style="display:flex;gap:20px;align-items:start;">
              <div style="width:80px;height:80px;border-radius:12px;background:#eef2ff;display:flex;align-items:center;justify-content:center;font-size:32px;font-weight:bold;color:#4f46e5;flex-shrink:0;overflow:hidden;">
                ${c.photo_url ? `<img src="${esc(c.photo_url)}" alt="${esc(c.student_name)}" style="width:100%;height:100%;object-fit:cover;"/>` : esc((c.student_name || '?')[0])}
              </div>
              <div style="flex:1;">
                <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
                  <h3 style="font-size:17px;font-weight:700;color:#111827;margin:0;">${esc(c.student_name || 'Unknown Student')}</h3>
                  <div style="display:flex;gap:8px;align-items:center;">
                    ${statusBadge(c.status)}
                    ${req.session.user.role && ['admin','superadmin'].includes(req.session.user.role) ? `
                      <form method="POST" action="/school/elections/${id}/candidates/${c.id}/approve" style="display:inline;">
                        <input type="hidden" name="status" value="approved"/>
                        <button type="submit" style="padding:4px 12px;background:#059669;color:#fff;border:none;border-radius:4px;font-size:12px;cursor:pointer;">Approve</button>
                      </form>
                      <form method="POST" action="/school/elections/${id}/candidates/${c.id}/approve" style="display:inline;">
                        <input type="hidden" name="status" value="rejected"/>
                        <button type="submit" style="padding:4px 12px;background:#dc2626;color:#fff;border:none;border-radius:4px;font-size:12px;cursor:pointer;">Reject</button>
                      </form>
                    ` : ''}
                  </div>
                </div>
                <p style="color:#4b5563;font-size:14px;line-height:1.6;margin:8px 0;white-space:pre-wrap;">${esc(c.manifesto || 'No manifesto provided.')}</p>
                <div style="font-size:12px;color:#9ca3af;">Registered: ${c.created_at ? new Date(c.created_at).toLocaleString() : 'N/A'} &bull; Votes: ${c.vote_count}</div>
              </div>
            </div>
          </div>`;
        }
      }
    }

    html += `</div>`;
    res.send(renderPage('Candidates', html, req.session.user));
  }));

  // Admin: add candidate from student list
  app.post('/school/elections/:id/candidates', requireAuth, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const { student_name, position } = req.body;
    const studentResult = await pool.query(
      `SELECT id FROM users WHERE (name ILIKE $1 OR CAST(id AS TEXT) = $2) AND tenant_id = $3 LIMIT 1`,
      [`%${student_name}%`, student_name, tid]
    );
    if (!studentResult.rows[0]) return res.status(400).send('Student not found');
    await pool.query(
      `INSERT INTO election_candidates (tenant_id, election_id, student_id, position, status) VALUES ($1,$2,$3,$4,'approved')`,
      [tid, id, studentResult.rows[0].id, position]
    );
    audit('candidate_added', { election_id: id, student_id: studentResult.rows[0].id, position }, req);
    res.redirect(`/school/elections/${id}/candidates`);
  }));

  // Register as candidate (self-registration)
  app.get('/school/elections/:id/candidates/register', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const elResult = await pool.query(`SELECT * FROM elections WHERE id = $1 AND tenant_id = $2 AND status IN ('draft','open')`, [id, tid]);
    if (!elResult.rows[0]) return res.status(404).send('Election not found or not accepting registrations');
    const election = elResult.rows[0];
    const positions = Array.isArray(election.positions) ? election.positions : JSON.parse(election.positions || '[]');

    const html = `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <a href="/school/elections/${id}/candidates" style="color:#4f46e5;text-decoration:none;font-size:14px;">&larr; Back to Candidates</a>
      <h1 style="font-size:24px;font-weight:800;color:#111827;margin:16px 0;">Register as Candidate</h1>
      <p style="color:#6b7280;margin-bottom:20px;">Election: ${esc(election.title)}</p>
      <form method="POST" action="/school/elections/${id}/candidates/register" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
        <div style="margin-bottom:16px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Position *</label>
          <select name="position" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;" aria-label="Select position">
            <option value="">Select a position...</option>
            ${positions.map(p => `<option value="${esc(p)}">${esc(p)}</option>`).join('')}
          </select>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Photo URL</label>
          <input type="url" name="photo_url" placeholder="https://example.com/photo.jpg" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;" aria-label="Photo URL"/>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Manifesto *</label>
          <textarea name="manifesto" rows="6" required placeholder="Write your campaign manifesto. Tell voters why they should vote for you..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;font-size:15px;" aria-label="Your manifesto"></textarea>
        </div>
        <button type="submit" style="padding:10px 28px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">Submit Registration</button>
      </form>
    </div>`;
    res.send(renderPage('Register as Candidate', html, req.session.user));
  }));

  // Save self-registration
  app.post('/school/elections/:id/candidates/register', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { position, photo_url, manifesto } = req.body;
    if (!position || !manifesto) return res.status(400).send('Position and manifesto are required');
    await pool.query(
      `INSERT INTO election_candidates (tenant_id, election_id, student_id, position, manifesto, photo_url, status) VALUES ($1,$2,$3,$4,$5,$6,'pending')`,
      [tid, id, uid, position, manifesto, photo_url || null]
    );
    audit('candidate_registered', { election_id: id, student_id: uid, position }, req);
    res.redirect(`/school/elections/${id}/candidates`);
  }));

  // Approve/reject candidate
  app.post('/school/elections/:id/candidates/:cid/approve', requireAuth, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id, cid } = req.params;
    const { status } = req.body;
    if (!['approved','rejected'].includes(status)) return res.status(400).send('Invalid status');
    await pool.query(`UPDATE election_candidates SET status = $1 WHERE id = $2 AND tenant_id = $3 AND election_id = $4`, [status, cid, tid, id]);
    audit('candidate_status_changed', { candidate_id: cid, status }, req);
    res.redirect(`/school/elections/${id}/candidates`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 3: VOTING BOOTH
  // ═══════════════════════════════════════════════════════════════════════════

  // Voting booth page
  app.get('/school/elections/:id/vote', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;

    const elResult = await pool.query(`SELECT * FROM elections WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!elResult.rows[0]) return res.status(404).send('Election not found');
    const election = elResult.rows[0];

    if (election.status !== 'open') {
      return res.send(`<div style="max-width:600px;margin:80px auto;text-align:center;padding:20px;">
        <p style="font-size:48px;margin-bottom:16px;">🗳️</p>
        <h2 style="color:#111827;">Voting is ${esc(election.status)}</h2>
        <p style="color:#6b7280;">This election is currently ${election.status.replace(/_/g,' ')}. Please check back later.</p>
        <a href="/school/elections" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;">Back to Elections</a>
      </div>`);
    }

    const positions = Array.isArray(election.positions) ? election.positions : JSON.parse(election.positions || '[]');
    const isRanked = election.voting_method === 'ranked';

    // Check what the user has already voted for
    const existingVotes = await pool.query(
      `SELECT position FROM election_votes WHERE election_id = $1 AND voter_id = $2 AND tenant_id = $3`,
      [id, uid, tid]
    );
    const votedPositions = new Set(existingVotes.rows.map(v => v.position));
    const remainingPositions = positions.filter(p => !votedPositions.has(p));

    if (remainingPositions.length === 0) {
      return res.send(`<div style="max-width:600px;margin:80px auto;text-align:center;padding:20px;">
        <p style="font-size:48px;margin-bottom:16px;">✅</p>
        <h2 style="color:#111827;">You have already voted!</h2>
        <p style="color:#6b7280;">Thank you for participating. You have cast your vote for all positions.</p>
        <a href="/school/elections" style="display:inline-block;margin-top:16px;padding:10px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;">Back to Elections</a>
      </div>`);
    }

    // Get approved candidates for remaining positions
    const candResult = await pool.query(
      `SELECT ec.*, u.name AS student_name FROM election_candidates ec LEFT JOIN users u ON u.id = ec.student_id WHERE ec.election_id = $1 AND ec.tenant_id = $2 AND ec.status = 'approved' AND ec.position = ANY($3) ORDER BY ec.position, u.name`,
      [id, tid, remainingPositions]
    );
    const candidates = candResult.rows;

    const candidatesByPosition = {};
    candidates.forEach(c => { (candidatesByPosition[c.position] = candidatesByPosition[c.position] || []).push(c); });

    let html = `<div style="max-width:800px;margin:0 auto;padding:20px;">
      <div style="text-align:center;margin-bottom:24px;">
        <p style="font-size:48px;margin:0 0 8px 0;">🗳️</p>
        <h1 style="font-size:28px;font-weight:800;color:#111827;margin:0 0 4px 0;">Voting Booth</h1>
        <p style="color:#6b7280;font-size:15px;">${esc(election.title)}</p>
        ${isRanked ? '<p style="color:#4f46e5;font-size:13px;font-weight:600;">Ranked Choice Voting — Rank candidates 1, 2, 3...</p>' : ''}
        ${votedPositions.size > 0 ? `<p style="color:#059669;font-size:13px;font-weight:600;">Already voted for: ${[...votedPositions].map(p => esc(p)).join(', ')}</p>` : ''}
      </div>
      <form method="POST" action="/school/elections/${id}/vote">`;

    let positionIndex = 0;
    for (const pos of remainingPositions) {
      const cands = candidatesByPosition[pos] || [];
      html += `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:20px;">
        <h2 style="font-size:18px;font-weight:700;color:#111827;margin:0 0 16px 0;">${esc(pos)}</h2>`;

      if (cands.length === 0) {
        html += `<p style="color:#6b7280;">No approved candidates for this position.</p>`;
      } else {
        html += `<div style="display:grid;gap:12px;">`;
        for (const c of cands) {
          const inputType = isRanked ? 'number' : 'radio';
          const inputName = isRanked ? `rank_${c.id}` : `vote_${pos}`;
          const inputValue = isRanked ? '' : c.id;
          html += `<label style="display:flex;align-items:start;gap:14px;padding:14px;border:2px solid #e5e7eb;border-radius:10px;cursor:pointer;transition:border-color 0.2s;" onmouseover="this.style.borderColor='#4f46e5'" onmouseout="this.style.borderColor='#e5e7eb'">
            <input type="${inputType}" name="${inputName}" value="${inputValue}" ${isRanked ? 'min="1" max="' + cands.length + '" placeholder="Rank" style="width:60px;padding:6px;border:1px solid #d1d5db;border-radius:6px;text-align:center;"' : 'style="margin-top:4px;width:18px;height:18px;accent-color:#4f46e5;"'}/>`;
          html += `<div style="flex:1;">
              <div style="display:flex;align-items:center;gap:10px;">
                <div style="width:40px;height:40px;border-radius:50%;background:#eef2ff;display:flex;align-items:center;justify-content:center;font-weight:bold;color:#4f46e5;overflow:hidden;flex-shrink:0;">
                  ${c.photo_url ? `<img src="${esc(c.photo_url)}" alt="${esc(c.student_name)}" style="width:100%;height:100%;object-fit:cover;"/>` : esc((c.student_name || '?')[0])}
                </div>
                <span style="font-weight:600;color:#111827;">${esc(c.student_name)}</span>
              </div>
              <p style="font-size:13px;color:#6b7280;margin:6px 0 0 50px;line-height:1.4;">${esc((c.manifesto || '').slice(0, 200))}</p>
            </div>
          </label>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
      positionIndex++;
    }

    html += `<div style="text-align:center;margin-top:24px;">
        <button type="submit" style="padding:14px 40px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;">Cast Vote</button>
        <p style="font-size:12px;color:#9ca3af;margin-top:8px;">Your vote is anonymous and cannot be changed after submission.</p>
      </div>
      </form>
    </div>`;
    res.send(renderPage('Voting Booth', html, req.session.user));
  }));

  // Process vote submission
  app.post('/school/elections/:id/vote', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;

    const elResult = await pool.query(`SELECT * FROM elections WHERE id = $1 AND tenant_id = $2 AND status = 'open'`, [id, tid]);
    if (!elResult.rows[0]) return res.status(400).send('Election is not open for voting');
    const election = elResult.rows[0];
    const isRanked = election.voting_method === 'ranked';

    const positions = Array.isArray(election.positions) ? election.positions : JSON.parse(election.positions || '[]');

    // Check already voted positions
    const existingVotes = await pool.query(
      `SELECT position FROM election_votes WHERE election_id = $1 AND voter_id = $2 AND tenant_id = $3`,
      [id, uid, tid]
    );
    const votedPositions = new Set(existingVotes.rows.map(v => v.position));

    if (isRanked) {
      // Ranked choice: expect rank_<candidate_id> fields
      const rankEntries = Object.entries(req.body)
        .filter(([k, v]) => k.startsWith('rank_') && v && parseInt(v) > 0)
        .map(([k, v]) => ({ candidateId: parseInt(k.replace('rank_', '')), rank: parseInt(v) }))
        .sort((a, b) => a.rank - b.rank);

      // Group by position
      const candIds = rankEntries.map(e => e.candidateId);
      const candInfo = await pool.query(
        `SELECT id, position FROM election_candidates WHERE id = ANY($1) AND election_id = $2 AND tenant_id = $3 AND status = 'approved'`,
        [candIds, id, tid]
      );
      const candMap = {};
      candInfo.rows.forEach(c => { candMap[c.id] = c; });

      const byPos = {};
      for (const entry of rankEntries) {
        const info = candMap[entry.candidateId];
        if (!info) continue;
        if (votedPositions.has(info.position)) continue;
        (byPos[info.position] = byPos[info.position] || []).push({ ...entry, position: info.position });
      }

      for (const [pos, ranks] of Object.entries(byPos)) {
        // Save the top choice (ranked choice can be processed later for IRV)
        for (const r of ranks) {
          try {
            await pool.query(
              `INSERT INTO election_votes (tenant_id, election_id, voter_id, candidate_id, position, ranked_choice) VALUES ($1,$2,$3,$4,$5,$6)`,
              [tid, id, uid, r.candidateId, pos, r.rank]
            );
          } catch (err) {
            if (!err.message.includes('unique') && !err.message.includes('duplicate')) throw err;
          }
        }
      }
    } else {
      // One per position: expect vote_<position> fields
      for (const pos of positions) {
        if (votedPositions.has(pos)) continue;
        const field = `vote_${pos}`;
        const candidateId = parseInt(req.body[field]);
        if (!candidateId) continue;

        // Verify candidate is valid
        const validCand = await pool.query(
          `SELECT id FROM election_candidates WHERE id = $1 AND election_id = $2 AND tenant_id = $3 AND position = $4 AND status = 'approved'`,
          [candidateId, id, tid, pos]
        );
        if (!validCand.rows[0]) continue;

        try {
          await pool.query(
            `INSERT INTO election_votes (tenant_id, election_id, voter_id, candidate_id, position) VALUES ($1,$2,$3,$4,$5)`,
            [tid, id, uid, candidateId, pos]
          );
        } catch (err) {
          if (!err.message.includes('unique') && !err.message.includes('duplicate')) throw err;
        }
      }
    }

    audit('vote_cast', { election_id: id, voter_id: uid, method: election.voting_method }, req);
    res.send(`<div style="max-width:600px;margin:80px auto;text-align:center;padding:20px;">
      <div style="font-size:64px;margin-bottom:16px;animation:fadeIn 0.5s;">🗳️</div>
      <h2 style="font-size:24px;font-weight:800;color:#111827;margin:0 0 8px 0;">Vote Submitted!</h2>
      <p style="color:#6b7280;font-size:16px;">Thank you for participating in the election. Your vote has been recorded anonymously.</p>
      <a href="/school/elections" style="display:inline-block;margin-top:20px;padding:10px 28px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">Back to Elections</a>
      <style>@keyframes fadeIn { from { opacity:0; transform:scale(0.8); } to { opacity:1; transform:scale(1); } }</style>
    </div>`);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 4: RESULTS DASHBOARD
  // ═══════════════════════════════════════════════════════════════════════════

  app.get('/school/elections/:id/results', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;

    const elResult = await pool.query(`SELECT * FROM elections WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!elResult.rows[0]) return res.status(404).send('Election not found');
    const election = elResult.rows[0];

    if (election.status !== 'closed' && election.status !== 'results_published') {
      return res.send(`<div style="max-width:600px;margin:80px auto;text-align:center;padding:20px;">
        <p style="font-size:48px;margin-bottom:16px;">🔒</p>
        <h2 style="color:#111827;">Results Not Available</h2>
        <p style="color:#6b7280;">Results will be published after the election closes.</p>
      </div>`);
    }

    const positions = Array.isArray(election.positions) ? election.positions : JSON.parse(election.positions || '[]');

    // Update vote counts
    await pool.query(
      `UPDATE election_candidates ec SET vote_count = COALESCE(vcnt.cnt, 0)
       FROM (SELECT candidate_id, COUNT(*) AS cnt FROM election_votes WHERE election_id = $1 AND tenant_id = $2 GROUP BY candidate_id) vcnt
       WHERE ec.id = vcnt.candidate_id AND ec.election_id = $1 AND ec.tenant_id = $2`,
      [id, tid]
    );

    const candResult = await pool.query(
      `SELECT ec.*, u.name AS student_name FROM election_candidates ec LEFT JOIN users u ON u.id = ec.student_id WHERE ec.election_id = $1 AND ec.tenant_id = $2 AND ec.status = 'approved' ORDER BY ec.position`,
      [id, tid]
    );
    const candidates = candResult.rows;

    const statsResult = await pool.query(
      `SELECT COUNT(DISTINCT voter_id) AS total_voters FROM election_votes WHERE election_id = $1 AND tenant_id = $2`,
      [id, tid]
    );
    const totalVoters = parseInt(statsResult.rows[0]?.total_voters || 0);

    // Get total eligible voters (all students)
    const eligibleResult = await pool.query(
      `SELECT COUNT(*) AS total FROM users WHERE tenant_id = $1 AND role = 'student' AND active = true`,
      [tid]
    );
    const totalEligible = parseInt(eligibleResult.rows[0]?.total || 0);
    const turnout = totalEligible > 0 ? ((totalVoters / totalEligible) * 100).toFixed(1) : 0;

    const candidatesByPosition = {};
    candidates.forEach(c => { (candidatesByPosition[c.position] = candidatesByPosition[c.position] || []).push(c); });

    let html = `<div style="max-width:1000px;margin:0 auto;padding:20px;">
      <div style="margin-bottom:24px;">
        <a href="/school/elections/${id}" style="color:#4f46e5;text-decoration:none;font-size:14px;">&larr; Back to Election</a>
      </div>
      <div style="text-align:center;margin-bottom:32px;">
        <p style="font-size:48px;margin:0 0 8px 0;">🏆</p>
        <h1 style="font-size:28px;font-weight:800;color:#111827;margin:0 0 4px 0;">Election Results</h1>
        <p style="color:#6b7280;font-size:16px;">${esc(election.title)}</p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:32px;">
        <div style="background:#eef2ff;border-radius:12px;padding:20px;text-align:center;">
          <div style="font-size:36px;font-weight:800;color:#4f46e5;">${totalVoters}</div>
          <div style="font-size:14px;color:#6b7280;">Total Voters</div>
        </div>
        <div style="background:#eef2ff;border-radius:12px;padding:20px;text-align:center;">
          <div style="font-size:36px;font-weight:800;color:#4f46e5;">${totalEligible}</div>
          <div style="font-size:14px;color:#6b7280;">Eligible Voters</div>
        </div>
        <div style="background:#ecfdf5;border-radius:12px;padding:20px;text-align:center;">
          <div style="font-size:36px;font-weight:800;color:#059669;">${turnout}%</div>
          <div style="font-size:14px;color:#6b7280;">Turnout</div>
        </div>
        <div style="background:#fef3c7;border-radius:12px;padding:20px;text-align:center;">
          <div style="font-size:36px;font-weight:800;color:#d97706;">${candidates.length}</div>
          <div style="font-size:14px;color:#6b7280;">Candidates</div>
        </div>
      </div>`;

    // Results per position
    for (const pos of positions) {
      const cands = (candidatesByPosition[pos] || []).sort((a, b) => b.vote_count - a.vote_count);
      const winner = cands[0];
      const totalVotes = cands.reduce((s, c) => s + c.vote_count, 0);

      html += `<div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;margin-bottom:24px;">
        <h2 style="font-size:20px;font-weight:700;color:#111827;margin:0 0 16px 0;border-bottom:2px solid #4f46e5;padding-bottom:8px;">${esc(pos)}</h2>`;

      if (winner && winner.vote_count > 0) {
        html += `<div style="background:linear-gradient(135deg,#eef2ff,#e0e7ff);border-radius:10px;padding:20px;margin-bottom:20px;text-align:center;">
          <div style="font-size:13px;color:#4f46e5;font-weight:600;margin-bottom:4px;">WINNER</div>
          <div style="display:flex;align-items:center;justify-content:center;gap:12px;">
            <div style="width:56px;height:56px;border-radius:50%;background:#4f46e5;display:flex;align-items:center;justify-content:center;font-size:24px;font-weight:bold;color:#fff;overflow:hidden;">
              ${winner.photo_url ? `<img src="${esc(winner.photo_url)}" alt="${esc(winner.student_name)}" style="width:100%;height:100%;object-fit:cover;"/>` : esc((winner.student_name||'?')[0])}
            </div>
            <div>
              <div style="font-size:22px;font-weight:800;color:#111827;animation:fadeInUp 0.6s;">${esc(winner.student_name)}</div>
              <div style="font-size:14px;color:#6b7280;">${winner.vote_count} vote${winner.vote_count !== 1 ? 's' : ''} (${totalVotes > 0 ? Math.round((winner.vote_count / totalVotes) * 100) : 0}%)</div>
            </div>
          </div>
          <style>@keyframes fadeInUp { from { opacity:0; transform:translateY(20px); } to { opacity:1; transform:translateY(0); } }</style>
        </div>`;
      }

      // Bar chart
      if (cands.length > 0) {
        const chartData = cands.map(c => ({ label: c.student_name || 'Unknown', value: c.vote_count }));
        html += `<div style="overflow-x:auto;margin-bottom:16px;">${svgBarChart(chartData, esc(pos) + ' — Vote Count')}</div>`;
      }

      // Vote table
      html += `<table style="width:100%;border-collapse:collapse;font-size:14px;">
        <thead>
          <tr style="background:#f9fafb;">
            <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#374151;">Rank</th>
            <th style="text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#374151;">Candidate</th>
            <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#374151;">Votes</th>
            <th style="text-align:right;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#374151;">Percentage</th>
          </tr>
        </thead>
        <tbody>`;
      cands.forEach((c, i) => {
        const pct = totalVotes > 0 ? ((c.vote_count / totalVotes) * 100).toFixed(1) : 0;
        const bgStyle = i === 0 ? 'background:#ecfdf5;' : '';
        html += `<tr style="${bgStyle}">
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#374151;font-weight:${i === 0 ? '700' : '400'};">#${i + 1}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#111827;font-weight:${i === 0 ? '700' : '400'};">${esc(c.student_name)}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#111827;font-weight:${i === 0 ? '700' : '400'};">${c.vote_count}</td>
          <td style="padding:10px 12px;border-bottom:1px solid #f3f4f6;text-align:right;color:#111827;">${pct}%</td>
        </tr>`;
      });
      html += `</tbody></table></div>`;
    }

    // Export buttons
    html += `<div style="margin-top:24px;padding:16px;background:#f9fafb;border-radius:10px;display:flex;gap:12px;flex-wrap:wrap;">
      <span style="font-weight:600;color:#374151;line-height:36px;">Export:</span>
      <a href="/school/elections/${id}/results/export?format=csv" style="padding:8px 16px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">CSV</a>
      <a href="/school/elections/${id}/results/export?format=json" style="padding:8px 16px;background:#059669;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;font-weight:600;">JSON</a>
    </div>`;

    html += `</div>`;
    res.send(renderPage('Election Results', html, req.session.user));
  }));

  // Export results
  app.get('/school/elections/:id/results/export', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;
    const format = req.query.format || 'csv';

    const elResult = await pool.query(`SELECT * FROM elections WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!elResult.rows[0]) return res.status(404).send('Election not found');
    const election = elResult.rows[0];

    await pool.query(
      `UPDATE election_candidates ec SET vote_count = COALESCE(vcnt.cnt, 0)
       FROM (SELECT candidate_id, COUNT(*) AS cnt FROM election_votes WHERE election_id = $1 AND tenant_id = $2 GROUP BY candidate_id) vcnt
       WHERE ec.id = vcnt.candidate_id AND ec.election_id = $1 AND ec.tenant_id = $2`,
      [id, tid]
    );

    const candResult = await pool.query(
      `SELECT ec.*, u.name AS student_name FROM election_candidates ec LEFT JOIN users u ON u.id = ec.student_id WHERE ec.election_id = $1 AND ec.tenant_id = $2 AND ec.status = 'approved' ORDER BY ec.position, ec.vote_count DESC`,
      [id, tid]
    );

    const statsResult = await pool.query(
      `SELECT COUNT(DISTINCT voter_id) AS total_voters FROM election_votes WHERE election_id = $1 AND tenant_id = $2`,
      [id, tid]
    );
    const totalVoters = parseInt(statsResult.rows[0]?.total_voters || 0);

    const exportData = {
      election: election.title,
      status: election.status,
      voting_method: election.voting_method,
      total_voters: totalVoters,
      exported_at: new Date().toISOString(),
      results: candResult.rows.map(c => ({
        position: c.position,
        candidate: c.student_name,
        manifesto: c.manifesto,
        votes: c.vote_count
      }))
    };

    if (format === 'json') {
      res.setHeader('Content-Type', 'application/json');
      res.setHeader('Content-Disposition', `attachment; filename="election-${id}-results.json"`);
      return res.send(JSON.stringify(exportData, null, 2));
    }

    // CSV
    let csv = 'Position,Candidate,Votes\n';
    for (const c of exportData.results) {
      csv += `"${(c.position||'').replace(/"/g,'""')}","${(c.candidate||'').replace(/"/g,'""')}",${c.votes}\n`;
    }
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="election-${id}-results.csv"`);
    res.send(csv);
  }));

  // ═══════════════════════════════════════════════════════════════════════════
  // SECTION 5: QUICK POLLS
  // ═══════════════════════════════════════════════════════════════════════════

  // List polls
  app.get('/school/polls', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const result = await pool.query(
      `SELECT sp.*, u.name AS creator_name,
        (SELECT COUNT(*) FROM poll_votes WHERE poll_id = sp.id AND tenant_id = $2) AS total_votes
       FROM school_polls sp LEFT JOIN users u ON u.id = sp.created_by
       WHERE sp.tenant_id = $1 ORDER BY sp.created_at DESC`,
      [tid, tid]
    );
    const polls = result.rows;

    let html = `<div style="max-width:900px;margin:0 auto;padding:20px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:24px;">
        <h1 style="font-size:28px;font-weight:800;color:#111827;margin:0;">Quick Polls</h1>
        ${pageNav('polls')}
      </div>
      <a href="/school/polls/new" style="display:inline-block;padding:10px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;margin-bottom:20px;">+ Create Poll</a>`;

    if (polls.length === 0) {
      html += `<div style="text-align:center;padding:60px 20px;color:#6b7280;">
        <p style="font-size:48px;margin-bottom:12px;">📊</p>
        <p style="font-size:18px;">No polls created yet. Create your first quick poll!</p>
      </div>`;
    } else {
      html += `<div style="display:grid;gap:16px;">`;
      for (const p of polls) {
        const options = Array.isArray(p.options) ? p.options : JSON.parse(p.options || '[]');
        const isActive = p.status === 'active' && (!p.end_date || new Date(p.end_date) > new Date());
        html += `<div style="border:1px solid #e5e7eb;border-radius:12px;padding:20px;background:#fff;">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px;">
            <h3 style="font-size:17px;font-weight:700;color:#111827;margin:0;">${esc(p.question)}</h3>
            <div style="display:flex;gap:8px;align-items:center;">
              ${statusBadge(isActive ? 'active' : 'expired')}
              ${p.is_anonymous ? '<span style="font-size:11px;color:#6b7280;background:#f3f4f6;padding:2px 8px;border-radius:4px;">Anonymous</span>' : ''}
            </div>
          </div>
          <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:8px;">
            ${options.map(o => `<span style="padding:3px 10px;background:#eef2ff;color:#4f46e5;border-radius:4px;font-size:12px;">${esc(o)}</span>`).join('')}
          </div>
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:13px;color:#6b7280;">
            <span>${parseInt(p.total_votes || 0)} votes</span>
            <span>${p.target_audience ? esc(p.target_audience) : 'Everyone'} &bull; ${p.created_at ? new Date(p.created_at).toLocaleDateString() : ''}</span>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px;">
            <a href="/school/polls/${p.id}" style="padding:6px 14px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:6px;font-size:13px;">${isActive ? 'Vote' : 'View'}</a>
            <a href="/school/polls/${p.id}/results" style="padding:6px 14px;background:#eef2ff;color:#4f46e5;text-decoration:none;border-radius:6px;font-size:13px;">Results</a>
          </div>
        </div>`;
      }
      html += `</div>`;
    }

    html += `</div>`;
    res.send(renderPage('Quick Polls', html, req.session.user));
  }));

  // Create poll form
  app.get('/school/polls/new', requireAuth, ah(async (req, res) => {
    const html = `<div style="max-width:650px;margin:0 auto;padding:20px;">
      <h1 style="font-size:28px;font-weight:800;color:#111827;margin-bottom:24px;">Create Quick Poll</h1>
      <form method="POST" action="/school/polls" style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
        <div style="margin-bottom:16px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Question *</label>
          <input type="text" name="question" required placeholder="What should we have for the school fundraiser?" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;box-sizing:border-box;" aria-label="Poll question"/>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Options * (one per line, minimum 2)</label>
          <textarea name="options" rows="4" required placeholder="Bake Sale&#10;Car Wash&#10;Talent Show&#10;Fun Run" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:15px;box-sizing:border-box;" aria-label="Poll options"></textarea>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Target Audience</label>
            <select name="target_audience" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;" aria-label="Target audience">
              <option value="all">Everyone</option>
              <option value="students">Students Only</option>
              <option value="teachers">Teachers Only</option>
              <option value="parents">Parents Only</option>
            </select>
          </div>
          <div>
            <label style="display:block;font-weight:600;color:#374151;margin-bottom:4px;">Duration</label>
            <select name="duration" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box;" aria-label="Duration">
              <option value="1">1 Hour</option>
              <option value="6">6 Hours</option>
              <option value="24">1 Day</option>
              <option value="72">3 Days</option>
              <option value="168">1 Week</option>
              <option value="0">No Expiry</option>
            </select>
          </div>
        </div>
        <div style="margin-bottom:20px;">
          <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
            <input type="checkbox" name="is_anonymous" value="true" checked style="width:18px;height:18px;accent-color:#4f46e5;" aria-label="Anonymous voting"/>
            <span style="font-weight:600;color:#374151;">Anonymous voting (do not track who voted)</span>
          </label>
        </div>
        <div style="display:flex;gap:12px;">
          <button type="submit" style="padding:10px 28px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-weight:600;font-size:15px;cursor:pointer;">Create Poll</button>
          <a href="/school/polls" style="padding:10px 28px;background:#f3f4f6;color:#374151;text-decoration:none;border-radius:8px;font-weight:600;font-size:15px;">Cancel</a>
        </div>
      </form>
    </div>`;
    res.send(renderPage('Create Poll', html, req.session.user));
  }));

  // Save new poll
  app.post('/school/polls', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { question, options, target_audience, duration, is_anonymous } = req.body;
    const optionsArr = (options || '').split('\n').map(o => o.trim()).filter(Boolean);
    if (optionsArr.length < 2) return res.status(400).send('At least 2 options are required');

    const durationHours = parseInt(duration) || 0;
    const endDate = durationHours > 0 ? new Date(Date.now() + durationHours * 3600000).toISOString() : null;

    await pool.query(
      `INSERT INTO school_polls (tenant_id, question, options, target_audience, start_date, end_date, is_anonymous, status, created_by) VALUES ($1,$2,$3,$4,NOW(),$5,$6,'active',$7)`,
      [tid, question, JSON.stringify(optionsArr), target_audience || 'all', endDate, is_anonymous === 'true', uid]
    );
    audit('poll_created', { question, options_count: optionsArr.length }, req);
    res.redirect('/school/polls');
  }));

  // Vote on poll
  app.get('/school/polls/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;

    const pollResult = await pool.query(`SELECT * FROM school_polls WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!pollResult.rows[0]) return res.status(404).send('Poll not found');
    const poll = pollResult.rows[0];

    const options = Array.isArray(poll.options) ? poll.options : JSON.parse(poll.options || '[]');
    const isActive = poll.status === 'active' && (!poll.end_date || new Date(poll.end_date) > new Date());

    // Check if already voted
    let hasVoted = false;
    if (!poll.is_anonymous) {
      const voteCheck = await pool.query(`SELECT id FROM poll_votes WHERE poll_id = $1 AND voter_id = $2 AND tenant_id = $3`, [id, uid, tid]);
      hasVoted = voteCheck.rows.length > 0;
    }

    if (!isActive) {
      return res.redirect(`/school/polls/${id}/results`);
    }

    let html = `<div style="max-width:600px;margin:0 auto;padding:20px;">
      <a href="/school/polls" style="color:#4f46e5;text-decoration:none;font-size:14px;">&larr; Back to Polls</a>
      <div style="margin-top:16px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center;">
        <h1 style="font-size:22px;font-weight:800;color:#111827;margin:0 0 8px 0;">${esc(poll.question)}</h1>
        <p style="color:#6b7280;font-size:13px;margin-bottom:20px;">${poll.target_audience ? esc(poll.target_audience) : 'Everyone'} &bull; ${poll.is_anonymous ? 'Anonymous' : 'Identified'}</p>`;

    if (hasVoted) {
      html += `<p style="color:#059669;font-weight:600;font-size:16px;">You have already voted on this poll.</p>
        <a href="/school/polls/${id}/results" style="display:inline-block;margin-top:12px;padding:10px 24px;background:#4f46e5;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;">View Results</a>`;
    } else {
      html += `<form method="POST" action="/school/polls/${id}/vote" style="text-align:left;">
          <div style="display:grid;gap:10px;margin-bottom:20px;">`;
      for (const opt of options) {
        html += `<label style="display:flex;align-items:center;gap:12px;padding:14px 16px;border:2px solid #e5e7eb;border-radius:10px;cursor:pointer;transition:all 0.2s;" onmouseover="this.style.borderColor='#4f46e5';this.style.background='#eef2ff'" onmouseout="this.style.borderColor='#e5e7eb';this.style.background='#fff'">
            <input type="radio" name="selected_option" value="${esc(opt)}" required style="width:18px;height:18px;accent-color:#4f46e5;" aria-label="${esc(opt)}"/>
            <span style="font-weight:600;color:#111827;font-size:15px;">${esc(opt)}</span>
          </label>`;
      }
      html += `</div>
          <button type="submit" style="width:100%;padding:14px;background:#4f46e5;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;cursor:pointer;">Submit Vote</button>
        </form>`;
    }

    html += `</div></div>`;
    res.send(renderPage('Poll', html, req.session.user));
  }));

  // Process poll vote
  app.post('/school/polls/:id/vote', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const uid = req.session.user.id;
    const { id } = req.params;
    const { selected_option } = req.body;
    if (!selected_option) return res.status(400).send('Please select an option');

    const pollResult = await pool.query(`SELECT * FROM school_polls WHERE id = $1 AND tenant_id = $2 AND status = 'active'`, [id, tid]);
    if (!pollResult.rows[0]) return res.status(400).send('Poll is not active');
    const poll = pollResult.rows[0];

    if (!poll.is_anonymous) {
      const existing = await pool.query(`SELECT id FROM poll_votes WHERE poll_id = $1 AND voter_id = $2 AND tenant_id = $3`, [id, uid, tid]);
      if (existing.rows.length > 0) return res.status(400).send('You have already voted on this poll');
    }

    await pool.query(
      `INSERT INTO poll_votes (tenant_id, poll_id, voter_id, selected_option) VALUES ($1,$2,$3,$4)`,
      [tid, id, poll.is_anonymous ? null : uid, selected_option]
    );
    audit('poll_vote', { poll_id: id, option: selected_option }, req);
    res.redirect(`/school/polls/${id}/results`);
  }));

  // Poll results with pie chart
  app.get('/school/polls/:id/results', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;

    const pollResult = await pool.query(`SELECT * FROM school_polls WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!pollResult.rows[0]) return res.status(404).send('Poll not found');
    const poll = pollResult.rows[0];

    const options = Array.isArray(poll.options) ? poll.options : JSON.parse(poll.options || '[]');

    const voteResult = await pool.query(
      `SELECT selected_option, COUNT(*) AS count FROM poll_votes WHERE poll_id = $1 AND tenant_id = $2 GROUP BY selected_option`,
      [id, tid]
    );
    const voteCounts = {};
    voteResult.rows.forEach(r => { voteCounts[r.selected_option] = parseInt(r.count); });

    const totalVotes = voteResult.rows.reduce((s, r) => s + parseInt(r.count), 0);
    const chartData = options.map(o => ({ label: o, value: voteCounts[o] || 0 })).sort((a, b) => b.value - a.value);

    const isActive = poll.status === 'active' && (!poll.end_date || new Date(poll.end_date) > new Date());

    let html = `<div style="max-width:700px;margin:0 auto;padding:20px;">
      <a href="/school/polls" style="color:#4f46e5;text-decoration:none;font-size:14px;">&larr; Back to Polls</a>
      <div style="margin-top:16px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;text-align:center;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
          <h1 style="font-size:22px;font-weight:800;color:#111827;margin:0;">${esc(poll.question)}</h1>
          ${statusBadge(isActive ? 'active' : 'expired')}
        </div>
        <p style="color:#6b7280;font-size:14px;margin-bottom:20px;">${totalVotes} total vote${totalVotes !== 1 ? 's' : ''}</p>
        <div style="max-width:400px;margin:0 auto 24px auto;">${svgPieChart(chartData, '')}</div>`;

    if (chartData.length > 0) {
      html += `<div style="text-align:left;">
        <table style="width:100%;border-collapse:collapse;font-size:14px;">
          <thead><tr style="background:#f9fafb;">
            <th style="text-align:left;padding:10px;border-bottom:2px solid #e5e7eb;font-weight:600;">Option</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e5e7eb;font-weight:600;">Votes</th>
            <th style="text-align:center;padding:10px;border-bottom:2px solid #e5e7eb;font-weight:600;">% </th>
          </tr></thead><tbody>`;
      chartData.forEach((d, i) => {
        const pct = totalVotes > 0 ? ((d.value / totalVotes) * 100).toFixed(1) : '0.0';
        const barColor = i === 0 && d.value > 0 ? '#4f46e5' : '#e5e7eb';
        const barWidth = totalVotes > 0 ? Math.max(2, (d.value / totalVotes) * 100) : 2;
        html += `<tr>
          <td style="padding:10px;border-bottom:1px solid #f3f4f6;color:#111827;font-weight:${i === 0 ? '700' : '400'};">${esc(d.label)}</td>
          <td style="padding:10px;border-bottom:1px solid #f3f4f6;text-align:center;color:#111827;">${d.value}</td>
          <td style="padding:10px;border-bottom:1px solid #f3f4f6;text-align:center;">
            <div style="display:flex;align-items:center;gap:8px;justify-content:center;">
              <div style="width:100px;height:8px;background:#f3f4f6;border-radius:4px;overflow:hidden;">
                <div style="width:${barWidth}%;height:100%;background:${barColor};border-radius:4px;transition:width 0.5s;"></div>
              </div>
              <span style="font-size:13px;color:#6b7280;">${pct}%</span>
            </div>
          </td>
        </tr>`;
      });
      html += `</tbody></table></div>`;
    }

    html += `</div></div>`;
    res.send(renderPage('Poll Results', html, req.session.user));
  }));

  // Close expired polls (called periodically or on access)
  app.get('/school/polls/cleanup', requireAuth, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    await pool.query(
      `UPDATE school_polls SET status = 'expired' WHERE tenant_id = $1 AND status = 'active' AND end_date IS NOT NULL AND end_date < NOW()`,
      [tid]
    );
    res.redirect('/school/polls');
  }));

  // ─── API endpoints for AJAX/real-time updates ─────────────────────────────

  // Get election vote counts (for live results polling)
  app.get('/api/elections/:id/vote-counts', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;

    const elResult = await pool.query(`SELECT status FROM elections WHERE id = $1 AND tenant_id = $2`, [id, tid]);
    if (!elResult.rows[0] || (elResult.rows[0].status !== 'closed' && elResult.rows[0].status !== 'results_published')) {
      return res.json({ error: 'Results not available' });
    }

    const result = await pool.query(
      `SELECT ec.position, ec.student_name, ec.vote_count, u.name
       FROM election_candidates ec
       LEFT JOIN users u ON u.id = ec.student_id
       WHERE ec.election_id = $1 AND ec.tenant_id = $2 AND ec.status = 'approved'
       ORDER BY ec.position, ec.vote_count DESC`,
      [id, tid]
    );

    const positions = {};
    result.rows.forEach(r => {
      if (!positions[r.position]) positions[r.position] = [];
      positions[r.position].push({ name: r.name || r.student_name, votes: r.vote_count });
    });

    const stats = await pool.query(
      `SELECT COUNT(DISTINCT voter_id) AS total_voters FROM election_votes WHERE election_id = $1 AND tenant_id = $2`,
      [id, tid]
    );

    res.json({
      positions,
      total_voters: parseInt(stats.rows[0]?.total_voters || 0),
      timestamp: new Date().toISOString()
    });
  }));

  // Get poll vote counts (for real-time updates)
  app.get('/api/polls/:id/vote-counts', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const { id } = req.params;

    const voteResult = await pool.query(
      `SELECT selected_option, COUNT(*) AS count FROM poll_votes WHERE poll_id = $1 AND tenant_id = $2 GROUP BY selected_option`,
      [id, tid]
    );
    const counts = {};
    let total = 0;
    voteResult.rows.forEach(r => {
      counts[r.selected_option] = parseInt(r.count);
      total += parseInt(r.count);
    });

    res.json({ counts, total, timestamp: new Date().toISOString() });
  }));

  // Get student list for admin candidate search
  app.get('/api/students/search', requireAuth, requireAdmin, ah(async (req, res) => {
    const tid = req.session.user.tenant_id || 0;
    const q = req.query.q || '';
    const result = await pool.query(
      `SELECT id, name, email FROM users WHERE tenant_id = $1 AND role = 'student' AND active = true AND name ILIKE $2 LIMIT 20`,
      [tid, `%${q}%`]
    );
    res.json(result.rows.map(r => ({ id: r.id, name: r.name, email: r.email })));
  }));
};
