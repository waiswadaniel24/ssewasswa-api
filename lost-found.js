/**
 * Lost & Found Management System
 * ===============================
 * Digital lost and found with reporting, search, claiming,
 * notifications, monthly reports, and disposal workflows.
 *
 * Routes:
 *   GET  /lost-found                    — Dashboard / landing
 *   GET  /lost-found/report-lost        — Report lost item form
 *   POST /lost-found/report-lost        — Submit lost item
 *   GET  /lost-found/report-found       — Report found item form
 *   POST /lost-found/report-found       — Submit found item
 *   GET  /lost-found/search             — Public search page
 *   GET  /lost-found/browse             — Browse all items (paginated)
 *   GET  /lost-found/item/:id           — View single item
 *   GET  /lost-found/claim/:id          — Claim a found item
 *   POST /lost-found/claim/:id          — Submit claim with verification
 *   POST /lost-found/claim/:id/approve  — Admin approve claim
 *   POST /lost-found/claim/:id/reject   — Admin reject claim
 *   GET  /lost-found/claims             — Admin claims list
 *   GET  /lost-found/monthly-report     — Monthly SVG report
 *   GET  /lost-found/disposal           — Disposal management (admin)
 *   POST /lost-found/disposal/:id       — Mark item for donation/disposal
 *   POST /lost-found/item/:id/delete    — Soft-delete item
 */

module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || (fn => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const requireAdmin = opts.requireAdmin || ((req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    if (!req.session.user.roles || !req.session.user.roles.includes('admin')) return res.status(403).send('Access denied');
    next();
  });
  const audit = opts.audit || (() => {});
  const queueEmail = opts.queueEmail || (() => Promise.resolve());
  const tenantGuard = opts.tenantGuard || (() => (req, res, next) => next());

  // ── Constants ──────────────────────────────────────────────────────────
  const CATEGORIES = ['electronics', 'clothing', 'books', 'bag', 'keys', 'money', 'other'];
  const STATUSES = ['lost', 'found', 'claimed', 'donated', 'disposed'];
  const CATEGORY_LABELS = {
    electronics: 'Electronics', clothing: 'Clothing', books: 'Books',
    bag: 'Bag', keys: 'Keys', money: 'Money / Wallet', other: 'Other'
  };
  const STATUS_COLORS = {
    lost: '#f59e0b', found: '#059669', claimed: '#4f46e5',
    donated: '#8b5cf6', disposed: '#6b7280'
  };
  const CATEGORY_COLORS = {
    electronics: '#3b82f6', clothing: '#ec4899', books: '#f59e0b',
    bag: '#8b5cf6', keys: '#6b7280', money: '#059669', other: '#6366f1'
  };
  const ITEMS_PER_PAGE = 20;
  const DISPOSAL_DAYS = 90;

  // ── Table creation ─────────────────────────────────────────────────────
  (async () => {
    const schema = `
      CREATE TABLE IF NOT EXISTS lost_found_items (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
        item_type VARCHAR(10) NOT NULL CHECK (item_type IN ('lost','found')),
        item_name VARCHAR(255) NOT NULL,
        category VARCHAR(50) NOT NULL,
        description TEXT,
        last_seen_location VARCHAR(500),
        storage_location VARCHAR(500),
        date_lost DATE,
        date_found DATE,
        date_reported TIMESTAMP DEFAULT NOW(),
        photo_url VARCHAR(1000),
        owner_name VARCHAR(255),
        owner_contact VARCHAR(255),
        finder_name VARCHAR(255),
        finder_contact VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'lost',
        verification_question TEXT,
        verification_answer TEXT,
        matched_item_id INTEGER REFERENCES lost_found_items(id),
        claimed_by VARCHAR(255),
        claimed_at TIMESTAMP,
        claimed_contact VARCHAR(255),
        admin_notes TEXT,
        disposal_action VARCHAR(20),
        disposal_at TIMESTAMP,
        created_by VARCHAR(255),
        updated_at TIMESTAMP DEFAULT NOW(),
        deleted_at TIMESTAMP
      );
      CREATE INDEX IF NOT EXISTS lfi_tenant ON lost_found_items(tenant_id);
      CREATE INDEX IF NOT EXISTS lfi_status ON lost_found_items(status);
      CREATE INDEX IF NOT EXISTS lfi_category ON lost_found_items(category);
      CREATE INDEX IF NOT EXISTS lfi_type ON lost_found_items(item_type);
      CREATE INDEX IF NOT EXISTS lfi_date ON lost_found_items(date_reported);

      CREATE TABLE IF NOT EXISTS lost_found_claims (
        id SERIAL PRIMARY KEY,
        tenant_id VARCHAR(64) NOT NULL DEFAULT 'default',
        item_id INTEGER NOT NULL REFERENCES lost_found_items(id),
        claimant_name VARCHAR(255) NOT NULL,
        claimant_contact VARCHAR(255) NOT NULL,
        verification_response TEXT NOT NULL,
        status VARCHAR(20) NOT NULL DEFAULT 'pending',
        admin_notes TEXT,
        created_at TIMESTAMP DEFAULT NOW(),
        reviewed_at TIMESTAMP,
        reviewed_by VARCHAR(255)
      );
      CREATE INDEX IF NOT EXISTS lfc_tenant ON lost_found_claims(tenant_id);
      CREATE INDEX IF NOT EXISTS lfc_item ON lost_found_claims(item_id);
      CREATE INDEX IF NOT EXISTS lfc_status ON lost_found_claims(status);
    `;
    for (const stmt of schema.split(';').map(s => s.trim()).filter(Boolean)) {
      try { await pool.query(stmt); } catch (e) { /* table may already exist */ }
    }
  })();

  // ── Helpers ────────────────────────────────────────────────────────────
  function getTenantId(req) {
    return req.session?.user?.tenant_id || req.body?.tenant_id || req.query?.tenant_id || 'default';
  }

  function statusBadge(status) {
    const color = STATUS_COLORS[status] || '#6b7280';
    const bg = color + '18';
    return `<span style="display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:600;color:${color};background:${bg};border:1px solid ${color}40;">${esc(status.toUpperCase())}</span>`;
  }

  function categoryBadge(cat) {
    const color = CATEGORY_COLORS[cat] || '#6366f1';
    return `<span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:12px;font-weight:500;color:#fff;background:${color};">${esc(CATEGORY_LABELS[cat] || cat)}</span>`;
  }

  function formatDate(d) {
    if (!d) return '<em style="color:#9ca3af;">N/A</em>';
    const dt = new Date(d);
    return dt.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  }

  function daysSince(d) {
    if (!d) return 0;
    return Math.floor((Date.now() - new Date(d).getTime()) / 86400000);
  }

  // ── SVG Chart: Donut ───────────────────────────────────────────────────
  function svgDonut(data, width, height, title) {
    const cx = width / 2, cy = height / 2 + 15, r = Math.min(width, height) / 2 - 50, inner = r * 0.55;
    const total = data.reduce((s, d) => s + d.value, 0);
    if (total === 0) {
      return `<svg width="${width}" height="${height}" role="img" aria-label="${esc(title)} - no data"><text x="${cx}" y="${cy}" text-anchor="middle" fill="#9ca3af" font-size="14">No data</text></svg>`;
    }
    let paths = '', labels = '';
    let startAngle = -Math.PI / 2;
    data.forEach((d, i) => {
      const pct = d.value / total;
      const angle = pct * 2 * Math.PI;
      const endAngle = startAngle + angle;
      const x1 = cx + r * Math.cos(startAngle), y1 = cy + r * Math.sin(startAngle);
      const x2 = cx + r * Math.cos(endAngle), y2 = cy + r * Math.sin(endAngle);
      const ix1 = cx + inner * Math.cos(endAngle), iy1 = cy + inner * Math.sin(endAngle);
      const ix2 = cx + inner * Math.cos(startAngle), iy2 = cy + inner * Math.sin(startAngle);
      const large = angle > Math.PI ? 1 : 0;
      const col = d.color || STATUS_COLORS[d.key] || '#6b7280';
      paths += `<path d="M${x1},${y1} A${r},${r} 0 ${large} 1 ${x2},${y2} L${ix1},${iy1} A${inner},${inner} 0 ${large} 0 ${ix2},${iy2} Z" fill="${col}" stroke="#fff" stroke-width="2"><title>${esc(d.label)}: ${d.value} (${Math.round(pct * 100)}%)</title></path>`;
      startAngle = endAngle;
    });
    // Legend
    let ly = 14;
    data.forEach(d => {
      const col = d.color || STATUS_COLORS[d.key] || '#6b7280';
      labels += `<rect x="8" y="${ly}" width="12" height="12" rx="3" fill="${col}"/><text x="26" y="${ly + 11}" font-size="12" fill="#374151">${esc(d.label)} (${d.value})</text>`;
      ly += 18;
    });
    return `<svg width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
      <text x="${cx}" y="16" text-anchor="middle" font-size="13" font-weight="600" fill="#1f2937">${esc(title)}</text>
      <text x="${cx}" y="${cy + 4}" text-anchor="middle" font-size="22" font-weight="700" fill="#111827">${total}</text>
      <text x="${cx}" y="${cy + 20}" text-anchor="middle" font-size="11" fill="#6b7280">items total</text>
      ${paths}${labels}
    </svg>`;
  }

  // ── SVG Chart: Bar ─────────────────────────────────────────────────────
  function svgBar(data, width, height, title, xLabel) {
    const margin = { top: 40, right: 20, bottom: 60, left: 50 };
    const cw = width - margin.left - margin.right;
    const ch = height - margin.top - margin.bottom;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barW = Math.min(50, (cw / data.length) * 0.6);
    const gap = cw / data.length;
    let bars = '', xLabels = '', gridLines = '';
    // Y-axis grid
    for (let i = 0; i <= 4; i++) {
      const y = margin.top + ch - (ch * i / 4);
      const val = Math.round(maxVal * i / 4);
      gridLines += `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/><text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6b7280">${val}</text>`;
    }
    data.forEach((d, i) => {
      const x = margin.left + i * gap + (gap - barW) / 2;
      const barH = (d.value / maxVal) * ch;
      const y = margin.top + ch - barH;
      const col = d.color || CATEGORY_COLORS[d.key] || '#4f46e5';
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${barH}" rx="4" fill="${col}" opacity="0.9"><title>${esc(d.label)}: ${d.value}</title></rect>`;
      bars += `<text x="${x + barW / 2}" y="${y - 5}" text-anchor="middle" font-size="11" font-weight="600" fill="#374151">${d.value}</text>`;
      // X label
      const lblX = x + barW / 2;
      const lblY = margin.top + ch + 16;
      xLabels += `<text x="${lblX}" y="${lblY}" text-anchor="middle" font-size="10" fill="#6b7280" transform="rotate(-25,${lblX},${lblY})">${esc(d.label.length > 10 ? d.label.slice(0, 9) + '…' : d.label)}</text>`;
    });
    return `<svg width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
      <text x="${width / 2}" y="22" text-anchor="middle" font-size="14" font-weight="600" fill="#1f2937">${esc(title)}</text>
      ${gridLines}${bars}${xLabels}
      <text x="${width / 2}" y="${height - 6}" text-anchor="middle" font-size="11" fill="#9ca3af">${esc(xLabel || '')}</text>
    </svg>`;
  }

  // ── SVG Chart: Trend Line ──────────────────────────────────────────────
  function svgTrendLine(data, width, height, title) {
    const margin = { top: 40, right: 20, bottom: 40, left: 50 };
    const cw = width - margin.left - margin.right;
    const ch = height - margin.top - margin.bottom;
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const minVal = 0;
    let points = '', areaPath = '', gridLines = '', dots = '';
    for (let i = 0; i <= 4; i++) {
      const y = margin.top + ch - (ch * i / 4);
      const val = Math.round(maxVal * i / 4);
      gridLines += `<line x1="${margin.left}" y1="${y}" x2="${width - margin.right}" y2="${y}" stroke="#e5e7eb" stroke-width="1"/><text x="${margin.left - 8}" y="${y + 4}" text-anchor="end" font-size="11" fill="#6b7280">${val}</text>`;
    }
    data.forEach((d, i) => {
      const x = margin.left + (data.length > 1 ? (i / (data.length - 1)) * cw : cw / 2);
      const y = margin.top + ch - ((d.value - minVal) / (maxVal - minVal)) * ch;
      points += `${i === 0 ? 'M' : 'L'}${x},${y} `;
      areaPath += `${i === 0 ? 'M' : 'L'}${x},${y} `;
      dots += `<circle cx="${x}" cy="${y}" r="4" fill="#4f46e5" stroke="#fff" stroke-width="2"><title>${esc(d.label)}: ${d.value}</title></circle>`;
      // X label
      gridLines += `<text x="${x}" y="${margin.top + ch + 20}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(d.label)}</text>`;
    });
    // Close area
    const lastX = data.length > 1 ? margin.left + cw : margin.left + cw / 2;
    areaPath += `L${lastX},${margin.top + ch} L${margin.left},${margin.top + ch} Z`;
    return `<svg width="${width}" height="${height}" role="img" aria-label="${esc(title)}">
      <text x="${width / 2}" y="22" text-anchor="middle" font-size="14" font-weight="600" fill="#1f2937">${esc(title)}</text>
      ${gridLines}
      <path d="${areaPath}" fill="#4f46e520"/>
      <path d="${points}" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}
    </svg>`;
  }

  // ── Shared layout wrapper ──────────────────────────────────────────────
  function pageWrap(title, content, user) {
    const isAdmin = user && (user.roles || []).includes('admin');
    const nav = `
      <nav style="background:#4f46e5;padding:12px 24px;display:flex;align-items:center;gap:20px;flex-wrap:wrap;" role="navigation" aria-label="Lost & Found navigation">
        <a href="/lost-found" style="color:#fff;text-decoration:none;font-weight:700;font-size:18px;">🔍 Lost & Found</a>
        <a href="/lost-found/search" style="color:#c7d2fe;text-decoration:none;font-size:14px;">Search</a>
        <a href="/lost-found/report-lost" style="color:#c7d2fe;text-decoration:none;font-size:14px;">Report Lost</a>
        <a href="/lost-found/report-found" style="color:#c7d2fe;text-decoration:none;font-size:14px;">Report Found</a>
        ${isAdmin ? '<a href="/lost-found/claims" style="color:#fde68a;text-decoration:none;font-size:14px;">Claims</a><a href="/lost-found/disposal" style="color:#fde68a;text-decoration:none;font-size:14px;">Disposal</a><a href="/lost-found/monthly-report" style="color:#fde68a;text-decoration:none;font-size:14px;">Reports</a>' : ''}
      </nav>`;
    return `${nav}<main style="max-width:1200px;margin:0 auto;padding:24px;" role="main"><h1 style="font-size:24px;font-weight:700;color:#111827;margin-bottom:20px;">${esc(title)}</h1>${content}</main>`;
  }

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 1: Dashboard
  // ══════════════════════════════════════════════════════════════════════
  app.get('/lost-found', ah(async (req, res) => {
    const tid = getTenantId(req);
    const [_r1, _r2, _r3, _r4] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS total_lost FROM lost_found_items WHERE tenant_id=$1 AND item_type=$2 AND status IN ($3,$4) AND deleted_at IS NULL', [tid, 'lost', 'lost', 'found']),
      pool.query('SELECT COUNT(*)::int AS total_found FROM lost_found_items WHERE tenant_id=$1 AND item_type=$2 AND status IN ($3,$4) AND deleted_at IS NULL', [tid, 'found', 'found', 'claimed']),
      pool.query('SELECT COUNT(*)::int AS total_claimed FROM lost_found_items WHERE tenant_id=$1 AND status=$2 AND deleted_at IS NULL', [tid, 'claimed']),
      pool.query('SELECT COUNT(*)::int AS total_unclaimed FROM lost_found_items WHERE tenant_id=$1 AND status IN ($2,$3) AND deleted_at IS NULL', [tid, 'lost', 'found']),
    ]);
    const total_lost = _r1.rows[0].total_lost;
    const total_found = _r2.rows[0].total_found;
    const total_claimed = _r3.rows[0].total_claimed;
    const total_unclaimed = _r4.rows[0].total_unclaimed;
    // Category breakdown
    const catRes = await pool.query(
      'SELECT category, COUNT(*)::int AS cnt FROM lost_found_items WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY category ORDER BY cnt DESC',
      [tid]
    );
    // Status donut data
    const statusRes = await pool.query(
      'SELECT status, COUNT(*)::int AS cnt FROM lost_found_items WHERE tenant_id=$1 AND deleted_at IS NULL GROUP BY status ORDER BY cnt DESC',
      [tid]
    );
    const donutData = statusRes.rows.map(r => ({
      key: r.status, label: r.status.charAt(0).toUpperCase() + r.status.slice(1), value: r.cnt
    }));
    const catData = catRes.rows.map(r => ({
      key: r.category, label: CATEGORY_LABELS[r.category] || r.category, value: r.cnt,
      color: CATEGORY_COLORS[r.category] || '#6366f1'
    }));
    // Recent items
    const recentRes = await pool.query(
      'SELECT * FROM lost_found_items WHERE tenant_id=$1 AND deleted_at IS NULL ORDER BY date_reported DESC LIMIT 10',
      [tid]
    );
    let recentRows = '';
    recentRes.rows.forEach(item => {
      const statusBg = item.item_type === 'lost' ? '#fef3c7' : '#d1fae5';
      const typeCol = item.item_type === 'lost' ? '#f59e0b' : '#059669';
      recentRows += `<tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px 12px;"><a href="/lost-found/item/${item.id}" style="color:#4f46e5;text-decoration:none;font-weight:500;">${esc(item.item_name)}</a></td>
        <td style="padding:10px 12px;">${categoryBadge(item.category)}</td>
        <td style="padding:10px 12px;"><span style="color:${typeCol};font-weight:600;text-transform:uppercase;font-size:12px;">${esc(item.item_type)}</span></td>
        <td style="padding:10px 12px;">${statusBadge(item.status)}</td>
        <td style="padding:10px 12px;font-size:13px;color:#6b7280;">${formatDate(item.date_reported)}</td>
      </tr>`;
    });
    const content = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:32px;">
        <div style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:12px;padding:20px;">
          <div style="font-size:13px;color:#1e40af;font-weight:600;">Total Lost</div>
          <div style="font-size:32px;font-weight:800;color:#f59e0b;">${total_lost}</div>
        </div>
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:20px;">
          <div style="font-size:13px;color:#065f46;font-weight:600;">Total Found</div>
          <div style="font-size:32px;font-weight:800;color:#059669;">${total_found}</div>
        </div>
        <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:20px;">
          <div style="font-size:13px;color:#3730a3;font-weight:600;">Claimed</div>
          <div style="font-size:32px;font-weight:800;color:#4f46e5;">${total_claimed}</div>
        </div>
        <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:20px;">
          <div style="font-size:13px;color:#991b1b;font-weight:600;">Unclaimed</div>
          <div style="font-size:32px;font-weight:800;color:#ef4444;">${total_unclaimed}</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:32px;">
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center;">
          ${svgDonut(donutData, 360, 280, 'Items by Status')}
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;">
          ${svgBar(catData, 360, 280, 'Items by Category', 'Category')}
        </div>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#1f2937;">Recent Items</div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;" role="table" aria-label="Recent items">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Name</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Category</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Type</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Status</th>
              <th style="padding:10px 12px;text-align:left;font-size:12px;color:#6b7280;text-transform:uppercase;">Reported</th>
            </tr></thead>
            <tbody>${recentRows}</tbody>
          </table>
        </div>
      </div>`;
    res.send(renderPage('Lost & Found Dashboard', pageWrap('Lost & Found Dashboard', content, req.session?.user), req.session?.user));
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 2: Report Lost Item — Form
  // ══════════════════════════════════════════════════════════════════════
  app.get('/lost-found/report-lost', ah(async (req, res) => {
    const user = req.session?.user || {};
    const catOptions = CATEGORIES.map(c =>
      `<option value="${c}">${esc(CATEGORY_LABELS[c])}</option>`
    ).join('');
    const content = `
      <div style="max-width:640px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
        <form method="POST" action="/lost-found/report-lost" role="form" aria-label="Report a lost item">
          <div style="margin-bottom:16px;">
            <label for="item_name" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Item Name <span style="color:#ef4444;">*</span></label>
            <input id="item_name" name="item_name" required maxlength="255" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="e.g. Blue Backpack" />
          </div>
          <div style="margin-bottom:16px;">
            <label for="category" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Category <span style="color:#ef4444;">*</span></label>
            <select id="category" name="category" required style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
              <option value="">Select category…</option>${catOptions}
            </select>
          </div>
          <div style="margin-bottom:16px;">
            <label for="description" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Description</label>
            <textarea id="description" name="description" rows="3" maxlength="2000" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="Color, brand, distinguishing features…"></textarea>
          </div>
          <div style="margin-bottom:16px;">
            <label for="last_seen_location" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Last Seen Location <span style="color:#ef4444;">*</span></label>
            <input id="last_seen_location" name="last_seen_location" required maxlength="500" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="e.g. Library 2nd Floor" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div>
              <label for="date_lost" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Date Lost <span style="color:#ef4444;">*</span></label>
              <input id="date_lost" name="date_lost" type="date" required style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" />
            </div>
            <div>
              <label for="photo_url" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Photo URL</label>
              <input id="photo_url" name="photo_url" type="url" maxlength="1000" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="https://…" />
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div>
              <label for="owner_name" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Your Name <span style="color:#ef4444;">*</span></label>
              <input id="owner_name" name="owner_name" required maxlength="255" value="${esc(user.name || '')}" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" />
            </div>
            <div>
              <label for="owner_contact" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Contact <span style="color:#ef4444;">*</span></label>
              <input id="owner_contact" name="owner_contact" required maxlength="255" value="${esc(user.email || '')}" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="Email or phone" />
            </div>
          </div>
          <div style="margin-bottom:16px;">
            <label for="verification_question" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Verification Question</label>
            <input id="verification_question" name="verification_question" maxlength="500" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="Question only the true owner can answer" />
          </div>
          <div style="margin-bottom:16px;">
            <label for="verification_answer" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Verification Answer</label>
            <input id="verification_answer" name="verification_answer" maxlength="500" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="Answer to the verification question" />
          </div>
          <button type="submit" style="background:#f59e0b;color:#fff;padding:12px 32px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;" aria-label="Submit lost item report">Submit Lost Item Report</button>
        </form>
      </div>`;
    res.send(renderPage('Report Lost Item', pageWrap('Report Lost Item', content, user), user));
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 3: Report Lost Item — POST
  // ══════════════════════════════════════════════════════════════════════
  app.post('/lost-found/report-lost', ah(async (req, res) => {
    const tid = getTenantId(req);
    const { item_name, category, description, last_seen_location, date_lost, photo_url,
      owner_name, owner_contact, verification_question, verification_answer } = req.body;
    if (!item_name || !category || !last_seen_location || !date_lost || !owner_name || !owner_contact) {
      return res.status(400).send('Missing required fields.');
    }
    if (!CATEGORIES.includes(category)) return res.status(400).send('Invalid category.');
    if (!STATUSES.includes('lost')) return res.status(500).send('System error.');
    await pool.query(
      `INSERT INTO lost_found_items (tenant_id, item_type, item_name, category, description,
        last_seen_location, date_lost, photo_url, owner_name, owner_contact, status,
        verification_question, verification_answer, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
      [tid, 'lost', item_name, category, description || null, last_seen_location,
        date_lost, photo_url || null, owner_name, owner_contact, 'lost',
        verification_question || null, verification_answer || null, req.session?.user?.id || null]
    );
    audit('lost_found_item_reported', { type: 'lost', item_name, category, tid });
    // Auto-match: check for matching found items
    try { await attemptAutoMatch(tid, item_name, category, last_seen_location, owner_contact, owner_name); } catch (_) {}
    res.redirect('/lost-found?msg=lost+reported');
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 4: Report Found Item — Form
  // ══════════════════════════════════════════════════════════════════════
  app.get('/lost-found/report-found', ah(async (req, res) => {
    const user = req.session?.user || {};
    const catOptions = CATEGORIES.map(c =>
      `<option value="${c}">${esc(CATEGORY_LABELS[c])}</option>`
    ).join('');
    const content = `
      <div style="max-width:640px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
        <form method="POST" action="/lost-found/report-found" role="form" aria-label="Report a found item">
          <div style="margin-bottom:16px;">
            <label for="item_name" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Item Name <span style="color:#ef4444;">*</span></label>
            <input id="item_name" name="item_name" required maxlength="255" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="e.g. Black Wallet" />
          </div>
          <div style="margin-bottom:16px;">
            <label for="category" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Category <span style="color:#ef4444;">*</span></label>
            <select id="category" name="category" required style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
              <option value="">Select category…</option>${catOptions}
            </select>
          </div>
          <div style="margin-bottom:16px;">
            <label for="description" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Description</label>
            <textarea id="description" name="description" rows="3" maxlength="2000" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="Color, brand, distinguishing features…"></textarea>
          </div>
          <div style="margin-bottom:16px;">
            <label for="last_seen_location" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Found Location <span style="color:#ef4444;">*</span></label>
            <input id="last_seen_location" name="last_seen_location" required maxlength="500" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="e.g. Cafeteria Table 5" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div>
              <label for="date_found" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Date Found <span style="color:#ef4444;">*</span></label>
              <input id="date_found" name="date_found" type="date" required style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" />
            </div>
            <div>
              <label for="storage_location" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Storage Location <span style="color:#ef4444;">*</span></label>
              <input id="storage_location" name="storage_location" required maxlength="500" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="e.g. Admin Office Shelf B" />
            </div>
          </div>
          <div style="margin-bottom:16px;">
            <label for="photo_url" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Photo URL</label>
            <input id="photo_url" name="photo_url" type="url" maxlength="1000" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="https://…" />
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:16px;">
            <div>
              <label for="finder_name" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Finder Name <span style="color:#ef4444;">*</span></label>
              <input id="finder_name" name="finder_name" required maxlength="255" value="${esc(user.name || '')}" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" />
            </div>
            <div>
              <label for="finder_contact" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Finder Contact <span style="color:#ef4444;">*</span></label>
              <input id="finder_contact" name="finder_contact" required maxlength="255" value="${esc(user.email || '')}" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="Email or phone" />
            </div>
          </div>
          <button type="submit" style="background:#059669;color:#fff;padding:12px 32px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;" aria-label="Submit found item report">Submit Found Item Report</button>
        </form>
      </div>`;
    res.send(renderPage('Report Found Item', pageWrap('Report Found Item', content, user), user));
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 5: Report Found Item — POST
  // ══════════════════════════════════════════════════════════════════════
  app.post('/lost-found/report-found', ah(async (req, res) => {
    const tid = getTenantId(req);
    const { item_name, category, description, last_seen_location, date_found,
      storage_location, photo_url, finder_name, finder_contact } = req.body;
    if (!item_name || !category || !last_seen_location || !date_found || !storage_location || !finder_name || !finder_contact) {
      return res.status(400).send('Missing required fields.');
    }
    if (!CATEGORIES.includes(category)) return res.status(400).send('Invalid category.');
    await pool.query(
      `INSERT INTO lost_found_items (tenant_id, item_type, item_name, category, description,
        last_seen_location, storage_location, date_found, photo_url, finder_name, finder_contact,
        status, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [tid, 'found', item_name, category, description || null, last_seen_location,
        storage_location, date_found, photo_url || null, finder_name, finder_contact,
        'found', req.session?.user?.id || null]
    );
    audit('lost_found_item_reported', { type: 'found', item_name, category, tid });
    // Auto-match: check for matching lost items
    try { await attemptAutoMatch(tid, item_name, category, last_seen_location, finder_contact, finder_name); } catch (_) {}
    res.redirect('/lost-found?msg=found+reported');
  }));

  // ── Auto-match helper ──────────────────────────────────────────────────
  async function attemptAutoMatch(tid, itemName, category, location, contact, name) {
    const searchName = itemName.toLowerCase().split(' ').filter(w => w.length > 2);
    const searchLoc = location.toLowerCase().split(' ').filter(w => w.length > 2);
    const matchRes = await pool.query(
      `SELECT * FROM lost_found_items WHERE tenant_id=$1 AND category=$2
        AND status IN ('lost','found') AND deleted_at IS NULL
        AND (item_name ILIKE ANY($3) OR last_seen_location ILIKE ANY($4))
       LIMIT 5`,
      [tid, category, searchName.map(w => '%' + w + '%'), searchLoc.map(w => '%' + w + '%')]
    );
    for (const match of matchRes.rows) {
      // Don't notify self-matches
      if (match.item_type === 'lost' && match.owner_contact === contact) continue;
      if (match.item_type === 'found' && match.finder_contact === contact) continue;
      const recipientEmail = match.item_type === 'lost' ? match.owner_contact : match.finder_contact;
      if (recipientEmail && recipientEmail.includes('@')) {
        queueEmail({
          to: recipientEmail,
          subject: `Potential Match Found: "${itemName}"`,
          text: `A ${category} item "${itemName}" was ${match.item_type === 'lost' ? 'found' : 'reported lost'} at "${location}" which may match your ${match.item_type} report. Please visit the Lost & Found portal to review and claim.`
        });
      }
      audit('lost_found_auto_match', { matchId: match.id, itemName, category });
    }
  }

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 6: Search & Browse — Public search
  // ══════════════════════════════════════════════════════════════════════
  app.get('/lost-found/search', ah(async (req, res) => {
    const tid = getTenantId(req);
    const q = (req.query.q || '').trim();
    const cat = req.query.category || '';
    const type = req.query.type || '';
    const dateFrom = req.query.date_from || '';
    const dateTo = req.query.date_to || '';
    const loc = (req.query.location || '').trim();
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const offset = (page - 1) * ITEMS_PER_PAGE;
    let where = ['tenant_id=$1', 'deleted_at IS NULL'];
    const params = [tid];
    let pIdx = 2;
    if (q) { where.push(`(item_name ILIKE $${pIdx} OR description ILIKE $${pIdx})`); params.push('%' + q + '%'); pIdx++; }
    if (cat && CATEGORIES.includes(cat)) { where.push(`category=$${pIdx}`); params.push(cat); pIdx++; }
    if (type === 'lost' || type === 'found') { where.push(`item_type=$${pIdx}`); params.push(type); pIdx++; }
    if (dateFrom) { where.push(`COALESCE(date_lost, date_found) >= $${pIdx}`); params.push(dateFrom); pIdx++; }
    if (dateTo) { where.push(`COALESCE(date_lost, date_found) <= $${pIdx}`); params.push(dateTo); pIdx++; }
    if (loc) { where.push(`last_seen_location ILIKE $${pIdx}`); params.push('%' + loc + '%'); pIdx++; }
    const whereClause = where.join(' AND ');
    const _countRes = await pool.query(`SELECT COUNT(*)::int AS total FROM lost_found_items WHERE ${whereClause}`, params);
    const total = _countRes.rows[0].total;
    const itemsRes = await pool.query(`SELECT * FROM lost_found_items WHERE ${whereClause} ORDER BY date_reported DESC LIMIT $${pIdx} OFFSET $${pIdx + 1}`, [...params, ITEMS_PER_PAGE, offset]);
    const totalPages = Math.ceil(total / ITEMS_PER_PAGE);
    // Build search form
    const catOpts = CATEGORIES.map(c =>
      `<option value="${c}" ${cat === c ? 'selected' : ''}>${esc(CATEGORY_LABELS[c])}</option>`
    ).join('');
    const content = `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:20px;margin-bottom:24px;">
        <form method="GET" action="/lost-found/search" role="search" aria-label="Search lost and found items">
          <div style="margin-bottom:12px;">
            <input name="q" value="${esc(q)}" placeholder="Search by name or description…" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" aria-label="Search query" />
          </div>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:12px;margin-bottom:12px;">
            <div>
              <label for="s_category" style="font-size:12px;font-weight:600;color:#6b7280;">Category</label>
              <select id="s_category" name="category" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
                <option value="">All Categories</option>${catOpts}
              </select>
            </div>
            <div>
              <label for="s_type" style="font-size:12px;font-weight:600;color:#6b7280;">Type</label>
              <select id="s_type" name="type" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;">
                <option value="">All</option>
                <option value="lost" ${type === 'lost' ? 'selected' : ''}>Lost</option>
                <option value="found" ${type === 'found' ? 'selected' : ''}>Found</option>
              </select>
            </div>
            <div>
              <label for="s_loc" style="font-size:12px;font-weight:600;color:#6b7280;">Location</label>
              <input id="s_loc" name="location" value="${esc(loc)}" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="Filter by location" />
            </div>
            <div>
              <label for="s_from" style="font-size:12px;font-weight:600;color:#6b7280;">Date From</label>
              <input id="s_from" name="date_from" type="date" value="${esc(dateFrom)}" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" />
            </div>
            <div>
              <label for="s_to" style="font-size:12px;font-weight:600;color:#6b7280;">Date To</label>
              <input id="s_to" name="date_to" type="date" value="${esc(dateTo)}" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" />
            </div>
          </div>
          <button type="submit" style="background:#4f46e5;color:#fff;padding:10px 24px;border:none;border-radius:8px;font-size:14px;font-weight:600;cursor:pointer;">Search</button>
          <a href="/lost-found/search" style="color:#6b7280;text-decoration:none;font-size:14px;margin-left:12px;">Clear</a>
        </form>
      </div>
      <div style="margin-bottom:12px;font-size:14px;color:#6b7280;">${total} result${total !== 1 ? 's' : ''} found</div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:16px;">${renderItemCards(itemsRes.rows)}</div>
      ${paginationHtml('/lost-found/search', req.query, page, totalPages)}`;
    res.send(renderPage('Search Items', pageWrap('Search Lost & Found', content, req.session?.user), req.session?.user));
  }));

  // ── Browse (alias) ─────────────────────────────────────────────────────
  app.get('/lost-found/browse', ah(async (req, res) => {
    req.query = req.query || {};
    res.redirect(307, '/lost-found/search');
  }));

  // ── Item card renderer ─────────────────────────────────────────────────
  function renderItemCards(items) {
    return items.map(item => {
      const accentColor = item.item_type === 'lost' ? '#f59e0b' : '#059669';
      const bgColor = item.item_type === 'lost' ? '#fffbeb' : '#ecfdf5';
      const photoHtml = item.photo_url
        ? `<img src="${esc(item.photo_url)}" alt="${esc(item.item_name)}" style="width:100%;height:160px;object-fit:cover;border-radius:8px;" loading="lazy" />`
        : `<div style="width:100%;height:160px;background:#f3f4f6;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#9ca3af;font-size:32px;">📦</div>`;
      return `
        <a href="/lost-found/item/${item.id}" style="text-decoration:none;color:inherit;display:block;">
          <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;border-top:3px solid ${accentColor};">
            ${photoHtml}
            <div style="padding:14px;">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px;">
                <h3 style="font-size:15px;font-weight:700;color:#111827;margin:0;">${esc(item.item_name)}</h3>
                ${statusBadge(item.status)}
              </div>
              <div style="font-size:12px;color:#6b7280;margin-bottom:4px;">📍 ${esc(item.last_seen_location || 'Unknown')}</div>
              <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px;">
                ${categoryBadge(item.category)}
                <span style="font-size:11px;color:${accentColor};font-weight:600;text-transform:uppercase;">${esc(item.item_type)}</span>
              </div>
              ${item.description ? `<div style="font-size:13px;color:#4b5563;margin-top:6px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(item.description)}</div>` : ''}
              <div style="font-size:11px;color:#9ca3af;margin-top:8px;">Reported ${formatDate(item.date_reported)}</div>
            </div>
          </div>
        </a>`;
    }).join('');
  }

  // ── Pagination helper ──────────────────────────────────────────────────
  function paginationHtml(baseUrl, query, current, totalPages) {
    if (totalPages <= 1) return '';
    let links = '';
    for (let i = 1; i <= totalPages && i <= 10; i++) {
      const isActive = i === current;
      const params = new URLSearchParams(query);
      params.set('page', i);
      links += `<a href="${baseUrl}?${params.toString()}" style="display:inline-block;padding:6px 12px;margin:0 2px;border-radius:6px;font-size:13px;text-decoration:none;${isActive ? 'background:#4f46e5;color:#fff;font-weight:600;' : 'background:#f3f4f6;color:#374151;'}">${i}</a>`;
    }
    return `<div style="margin-top:24px;text-align:center;" role="navigation" aria-label="Pagination">${links}</div>`;
  }

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 7: View single item
  // ══════════════════════════════════════════════════════════════════════
  app.get('/lost-found/item/:id', ah(async (req, res) => {
    const tid = getTenantId(req);
    const { rows } = await pool.query(
      'SELECT * FROM lost_found_items WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',
      [req.params.id, tid]
    );
    if (!rows.length) return res.status(404).send('Item not found.');
    const item = rows[0];
    const accent = item.item_type === 'lost' ? '#f59e0b' : '#059669';
    const days = daysSince(item.date_reported);
    // Get claims for this item
    const claimsRes = await pool.query(
      'SELECT * FROM lost_found_claims WHERE item_id=$1 AND tenant_id=$2 ORDER BY created_at DESC',
      [item.id, tid]
    );
    let claimsHtml = '';
    if (claimsRes.rows.length > 0) {
      claimsHtml = `<div style="margin-top:20px;"><h3 style="font-size:16px;font-weight:600;color:#1f2937;margin-bottom:8px;">Claims (${claimsRes.rows.length})</h3>`;
      claimsRes.rows.forEach(c => {
        const sc = c.status === 'approved' ? '#059669' : c.status === 'rejected' ? '#ef4444' : '#f59e0b';
        claimsHtml += `<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:8px;padding:12px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:center;">
            <span style="font-weight:600;font-size:14px;color:#111827;">${esc(c.claimant_name)}</span>
            <span style="padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;color:#fff;background:${sc};">${esc(c.status.toUpperCase())}</span>
          </div>
          <div style="font-size:12px;color:#6b7280;margin-top:4px;">Contact: ${esc(c.claimant_contact)}</div>
          <div style="font-size:13px;color:#374151;margin-top:4px;"><strong>Verification response:</strong> ${esc(c.verification_response)}</div>
          ${c.admin_notes ? `<div style="font-size:12px;color:#6b7280;margin-top:4px;font-style:italic;">Admin: ${esc(c.admin_notes)}</div>` : ''}
          <div style="font-size:11px;color:#9ca3af;margin-top:4px;">${formatDate(c.created_at)}</div>
        </div>`;
      });
      claimsHtml += '</div>';
    }
    const content = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div>
          ${item.photo_url ? `<img src="${esc(item.photo_url)}" alt="${esc(item.item_name)}" style="width:100%;max-height:300px;object-fit:cover;border-radius:12px;" />` : `<div style="width:100%;height:200px;background:#f3f4f6;border-radius:12px;display:flex;align-items:center;justify-content:center;font-size:48px;">📦</div>`}
          <div style="margin-top:12px;display:flex;gap:8px;">
            ${categoryBadge(item.category)}
            ${statusBadge(item.status)}
            <span style="display:inline-block;padding:2px 10px;border-radius:6px;font-size:12px;font-weight:600;color:#fff;background:${accent};">${esc(item.item_type.toUpperCase())}</span>
          </div>
        </div>
        <div>
          <h2 style="font-size:22px;font-weight:700;color:#111827;margin-bottom:16px;">${esc(item.item_name)}</h2>
          <div style="display:grid;gap:10px;">
            ${fieldRow('Description', item.description)}
            ${fieldRow('Location', item.last_seen_location)}
            ${fieldRow('Storage Location', item.storage_location)}
            ${fieldRow('Date Lost', item.date_lost)}
            ${fieldRow('Date Found', item.date_found)}
            ${item.item_type === 'lost' ? fieldRow('Owner', item.owner_name) + fieldRow('Owner Contact', item.owner_contact) : fieldRow('Finder', item.finder_name) + fieldRow('Finder Contact', item.finder_contact)}
            ${item.verification_question ? `<div style="background:#eff6ff;padding:10px;border-radius:8px;border:1px solid #bfdbfe;"><span style="font-size:12px;color:#1e40af;font-weight:600;">🔑 Verification Question:</span><br/><span style="font-size:14px;color:#1e3a5f;">${esc(item.verification_question)}</span></div>` : ''}
          </div>
          <div style="margin-top:16px;font-size:13px;color:#9ca3af;">Reported ${formatDate(item.date_reported)} · ${days} days ago</div>
          ${item.status === 'found' ? `<div style="margin-top:16px;"><a href="/lost-found/claim/${item.id}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:14px;">Claim This Item</a></div>` : ''}
        </div>
      </div>
      ${claimsHtml}`;
    res.send(renderPage(item.item_name, pageWrap(item.item_name, content, req.session?.user), req.session?.user));
  }));

  function fieldRow(label, value) {
    return `<div style="padding:8px 0;border-bottom:1px solid #f3f4f6;"><span style="font-size:12px;color:#6b7280;font-weight:600;display:block;">${esc(label)}</span><span style="font-size:14px;color:#1f2937;">${value ? esc(String(value)) : '<em style="color:#9ca3af;">N/A</em>'}</span></div>`;
  }

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 8: Claim Item — Form
  // ══════════════════════════════════════════════════════════════════════
  app.get('/lost-found/claim/:id', ah(async (req, res) => {
    const tid = getTenantId(req);
    const { rows } = await pool.query(
      'SELECT * FROM lost_found_items WHERE id=$1 AND tenant_id=$2 AND status=$3 AND deleted_at IS NULL',
      [req.params.id, tid, 'found']
    );
    if (!rows.length) return res.status(404).send('Item not found or not available for claiming.');
    const item = rows[0];
    const user = req.session?.user || {};
    const content = `
      <div style="max-width:600px;background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:24px;">
        <div style="background:#eef2ff;padding:12px;border-radius:8px;margin-bottom:20px;">
          <strong>Claiming:</strong> ${esc(item.item_name)} (${esc(CATEGORY_LABELS[item.category] || item.category)})<br/>
          <span style="font-size:13px;color:#6b7280;">📍 ${esc(item.last_seen_location)}</span>
        </div>
        ${item.verification_question ? `<div style="background:#fef3c7;padding:12px;border-radius:8px;margin-bottom:20px;border:1px solid #fde68a;"><strong style="color:#92400e;">🔑 Verification Question:</strong><br/><span style="color:#78350f;">${esc(item.verification_question)}</span><br/><span style="font-size:12px;color:#92400e;">Please answer this to prove ownership.</span></div>` : ''}
        <form method="POST" action="/lost-found/claim/${item.id}" role="form" aria-label="Claim this item">
          <div style="margin-bottom:16px;">
            <label for="claimant_name" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Your Name <span style="color:#ef4444;">*</span></label>
            <input id="claimant_name" name="claimant_name" required maxlength="255" value="${esc(user.name || '')}" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" />
          </div>
          <div style="margin-bottom:16px;">
            <label for="claimant_contact" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">Your Contact <span style="color:#ef4444;">*</span></label>
            <input id="claimant_contact" name="claimant_contact" required maxlength="255" value="${esc(user.email || '')}" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="Email or phone" />
          </div>
          <div style="margin-bottom:16px;">
            <label for="verification_response" style="display:block;font-size:14px;font-weight:600;color:#374151;margin-bottom:4px;">
              ${item.verification_question ? 'Answer Verification Question' : 'Describe the item to prove ownership'} <span style="color:#ef4444;">*</span>
            </label>
            <textarea id="verification_response" name="verification_response" required rows="3" maxlength="2000" style="width:100%;padding:10px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;" placeholder="Provide details that prove you are the owner…"></textarea>
          </div>
          <button type="submit" style="background:#4f46e5;color:#fff;padding:12px 32px;border:none;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer;">Submit Claim</button>
        </form>
      </div>`;
    res.send(renderPage('Claim Item', pageWrap('Claim Item', content, user), user));
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 9: Claim Item — POST
  // ══════════════════════════════════════════════════════════════════════
  app.post('/lost-found/claim/:id', ah(async (req, res) => {
    const tid = getTenantId(req);
    const { claimant_name, claimant_contact, verification_response } = req.body;
    if (!claimant_name || !claimant_contact || !verification_response) {
      return res.status(400).send('All fields are required.');
    }
    const { rows: itemRows } = await pool.query(
      'SELECT * FROM lost_found_items WHERE id=$1 AND tenant_id=$2 AND status=$3 AND deleted_at IS NULL',
      [req.params.id, tid, 'found']
    );
    if (!itemRows.length) return res.status(404).send('Item not available.');
    const item = itemRows[0];
    // Check if verification answer matches (if set)
    let autoVerify = false;
    if (item.verification_answer && item.verification_question) {
      if (verification_response.trim().toLowerCase() === item.verification_answer.trim().toLowerCase()) {
        autoVerify = true;
      }
    }
    const status = autoVerify ? 'approved' : 'pending';
    const { rows } = await pool.query(
      `INSERT INTO lost_found_claims (tenant_id, item_id, claimant_name, claimant_contact,
        verification_response, status, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,NOW()) RETURNING id`,
      [tid, req.params.id, claimant_name, claimant_contact, verification_response, status]
    );
    audit('lost_found_claim_submitted', { itemId: req.params.id, claimant_name, autoVerify, status });
    // If auto-verified, update item
    if (autoVerify) {
      await pool.query(
        `UPDATE lost_found_items SET status='claimed', claimed_by=$1, claimed_contact=$2,
          claimed_at=NOW(), updated_at=NOW() WHERE id=$3`,
        [claimant_name, claimant_contact, req.params.id]
      );
      await pool.query(
        `UPDATE lost_found_claims SET reviewed_at=NOW(), reviewed_by='system', status='approved' WHERE id=$1`,
        [rows[0].id]
      );
      // Notify finder
      if (item.finder_contact && item.finder_contact.includes('@')) {
        queueEmail({
          to: item.finder_contact,
          subject: `Item Claimed: "${item.item_name}"`,
          text: `Your found item "${item.item_name}" has been successfully claimed by ${claimant_name} (${claimant_contact}). Please arrange pickup.`
        });
      }
    }
    res.redirect(`/lost-found/item/${req.params.id}?msg=claim+${status}`);
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 10: Admin — Approve/Reject Claim
  // ══════════════════════════════════════════════════════════════════════
  app.post('/lost-found/claim/:id/approve', requireAdmin, ah(async (req, res) => {
    const tid = getTenantId(req);
    const adminNotes = req.body.admin_notes || '';
    const { rows } = await pool.query(
      'SELECT * FROM lost_found_claims WHERE id=$1 AND tenant_id=$2 AND status=$3',
      [req.params.id, tid, 'pending']
    );
    if (!rows.length) return res.status(404).send('Claim not found or already reviewed.');
    const claim = rows[0];
    await pool.query(
      `UPDATE lost_found_claims SET status='approved', admin_notes=$1, reviewed_at=NOW(), reviewed_by=$2 WHERE id=$3`,
      [adminNotes, req.session.user.id, req.params.id]
    );
    await pool.query(
      `UPDATE lost_found_items SET status='claimed', claimed_by=$1, claimed_contact=$2,
        claimed_at=NOW(), updated_at=NOW() WHERE id=$3 AND status='found'`,
      [claim.claimant_name, claim.claimant_contact, claim.item_id]
    );
    audit('lost_found_claim_approved', { claimId: req.params.id, itemId: claim.item_id });
    // Notify parties
    const itemRes = await pool.query('SELECT * FROM lost_found_items WHERE id=$1', [claim.item_id]);
    const item = itemRes.rows[0];
    if (item && item.finder_contact && item.finder_contact.includes('@')) {
      queueEmail({
        to: item.finder_contact,
        subject: `Claim Approved: "${item.item_name}"`,
        text: `The claim by ${claim.claimant_name} has been approved. Please contact them at ${claim.claimant_contact} to arrange handover.`
      });
    }
    if (claim.claimant_contact && claim.claimant_contact.includes('@')) {
      queueEmail({
        to: claim.claimant_contact,
        subject: `Your Claim is Approved: "${item ? item.item_name : 'Item'}"`,
        text: `Your claim has been approved. ${item && item.finder_name ? `Contact ${item.finder_name} at ${item.finder_contact} to collect your item.` : 'Please check the portal for pickup details.'}`
      });
    }
    res.redirect('/lost-found/claims?msg=approved');
  }));

  app.post('/lost-found/claim/:id/reject', requireAdmin, ah(async (req, res) => {
    const tid = getTenantId(req);
    const adminNotes = req.body.admin_notes || '';
    const { rows } = await pool.query(
      'SELECT * FROM lost_found_claims WHERE id=$1 AND tenant_id=$2 AND status=$3',
      [req.params.id, tid, 'pending']
    );
    if (!rows.length) return res.status(404).send('Claim not found or already reviewed.');
    const claim = rows[0];
    await pool.query(
      `UPDATE lost_found_claims SET status='rejected', admin_notes=$1, reviewed_at=NOW(), reviewed_by=$2 WHERE id=$3`,
      [adminNotes, req.session.user.id, req.params.id]
    );
    audit('lost_found_claim_rejected', { claimId: req.params.id, itemId: claim.item_id });
    if (claim.claimant_contact && claim.claimant_contact.includes('@')) {
      queueEmail({
        to: claim.claimant_contact,
        subject: `Claim Update: Your claim was not approved`,
        text: `Unfortunately, your claim could not be verified. ${adminNotes ? 'Reason: ' + adminNotes : 'Please ensure your verification details are accurate.'} You may submit a new claim.`
      });
    }
    res.redirect('/lost-found/claims?msg=rejected');
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 11: Admin — Claims List
  // ══════════════════════════════════════════════════════════════════════
  app.get('/lost-found/claims', requireAdmin, ah(async (req, res) => {
    const tid = getTenantId(req);
    const statusFilter = req.query.status || '';
    let where = ['c.tenant_id=$1', 'i.deleted_at IS NULL'];
    const params = [tid];
    if (statusFilter === 'pending' || statusFilter === 'approved' || statusFilter === 'rejected') {
      where.push(`c.status=$2`);
      params.push(statusFilter);
    }
    const { rows } = await pool.query(
      `SELECT c.*, i.item_name, i.category, i.item_type, i.photo_url, i.last_seen_location
       FROM lost_found_claims c
       JOIN lost_found_items i ON c.item_id = i.id
       WHERE ${where.join(' AND ')}
       ORDER BY c.created_at DESC LIMIT 100`,
      params
    );
    let rowsHtml = '';
    rows.forEach(c => {
      const sc = c.status === 'approved' ? '#059669' : c.status === 'rejected' ? '#ef4444' : '#f59e0b';
      const approveForm = c.status === 'pending' ? `
        <form method="POST" action="/lost-found/claim/${c.id}/approve" style="display:inline;">
          <input name="admin_notes" placeholder="Notes (optional)" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;width:150px;" aria-label="Admin notes for approval" />
          <button type="submit" style="background:#059669;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;margin-left:4px;">Approve</button>
        </form>
        <form method="POST" action="/lost-found/claim/${c.id}/reject" style="display:inline;margin-left:6px;">
          <input name="admin_notes" placeholder="Reason" style="padding:4px 8px;border:1px solid #d1d5db;border-radius:6px;font-size:12px;width:120px;" aria-label="Rejection reason" />
          <button type="submit" style="background:#ef4444;color:#fff;border:none;padding:6px 14px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;margin-left:4px;">Reject</button>
        </form>` : '';
      rowsHtml += `<tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px 12px;"><a href="/lost-found/item/${c.item_id}" style="color:#4f46e5;text-decoration:none;font-weight:500;">${esc(c.item_name)}</a></td>
        <td style="padding:10px 12px;">${categoryBadge(c.category)}</td>
        <td style="padding:10px 12px;">${esc(c.claimant_name)}</td>
        <td style="padding:10px 12px;">${esc(c.claimant_contact)}</td>
        <td style="padding:10px 12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${esc(c.verification_response)}">${esc(c.verification_response)}</td>
        <td style="padding:10px 12px;"><span style="padding:2px 8px;border-radius:9999px;font-size:11px;font-weight:600;color:#fff;background:${sc};">${esc(c.status.toUpperCase())}</span></td>
        <td style="padding:10px 12px;">${formatDate(c.created_at)}</td>
        <td style="padding:10px 12px;white-space:nowrap;">${approveForm}</td>
      </tr>`;
    });
    const content = `
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
          <span style="font-weight:600;color:#1f2937;">Claims Management</span>
          <a href="/lost-found/claims" style="font-size:13px;color:#4f46e5;text-decoration:none;">All</a>
          <a href="/lost-found/claims?status=pending" style="font-size:13px;color:#f59e0b;text-decoration:none;">Pending</a>
          <a href="/lost-found/claims?status=approved" style="font-size:13px;color:#059669;text-decoration:none;">Approved</a>
          <a href="/lost-found/claims?status=rejected" style="font-size:13px;color:#ef4444;text-decoration:none;">Rejected</a>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;" role="table" aria-label="Claims list">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Item</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Category</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Claimant</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Contact</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Verification</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Status</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Date</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Actions</th>
            </tr></thead>
            <tbody>${rowsHtml || '<tr><td colspan="8" style="padding:20px;text-align:center;color:#9ca3af;">No claims found.</td></tr>'}</tbody>
          </table>
        </div>
      </div>`;
    res.send(renderPage('Claims Management', pageWrap('Claims Management', content, req.session?.user), req.session?.user));
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 12: Monthly Report
  // ══════════════════════════════════════════════════════════════════════
  app.get('/lost-found/monthly-report', requireAdmin, ah(async (req, res) => {
    const tid = getTenantId(req);
    const months = req.query.months ? parseInt(req.query.months) : 6;
    const monthClauses = [];
    const monthLabels = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date();
      d.setMonth(d.getMonth() - i);
      monthClauses.push(`TO_CHAR(date_reported, 'YYYY-MM') = '${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}'`);
      monthLabels.push(d.toLocaleDateString('en-US', { month: 'short', year: '2-digit' }));
    }
    const orClause = '(' + monthClauses.join(' OR ') + ')';
    // Category breakdown for bar chart
    const catRes = await pool.query(
      `SELECT category, COUNT(*)::int AS cnt FROM lost_found_items
       WHERE tenant_id=$1 AND deleted_at IS NULL AND ${orClause}
       GROUP BY category ORDER BY cnt DESC`,
      [tid]
    );
    const catData = catRes.rows.map(r => ({
      key: r.category, label: CATEGORY_LABELS[r.category] || r.category,
      value: r.cnt, color: CATEGORY_COLORS[r.category] || '#6366f1'
    }));
    // Trend data by month
    const trendLost = [], trendFound = [], trendClaimed = [];
    for (let i = 0; i < months; i++) {
      const d = new Date();
      d.setMonth(d.getMonth() - (months - 1 - i));
      const mm = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const lRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM lost_found_items WHERE tenant_id=$1 AND deleted_at IS NULL AND item_type='lost' AND TO_CHAR(date_reported, 'YYYY-MM')=$2`,
        [tid, mm]
      );
      const fRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM lost_found_items WHERE tenant_id=$1 AND deleted_at IS NULL AND item_type='found' AND TO_CHAR(date_reported, 'YYYY-MM')=$2`,
        [tid, mm]
      );
      const cRes = await pool.query(
        `SELECT COUNT(*)::int AS cnt FROM lost_found_items WHERE tenant_id=$1 AND deleted_at IS NULL AND status='claimed' AND TO_CHAR(claimed_at, 'YYYY-MM')=$2`,
        [tid, mm]
      );
      trendLost.push({ label: monthLabels[i], value: lRes.rows[0].cnt });
      trendFound.push({ label: monthLabels[i], value: fRes.rows[0].cnt });
      trendClaimed.push({ label: monthLabels[i], value: cRes.rows[0].cnt });
    }
    // Resolution rate
    const [_tiRes, _riRes] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS totalItems FROM lost_found_items WHERE tenant_id=$1 AND deleted_at IS NULL AND ' + orClause, [tid]),
      pool.query(`SELECT COUNT(*)::int AS resolvedItems FROM lost_found_items WHERE tenant_id=$1 AND deleted_at IS NULL AND status IN ('claimed','donated','disposed') AND ${orClause}`, [tid])
    ]);
    const totalItems = _tiRes.rows[0].totalItems;
    const resolvedItems = _riRes.rows[0].resolvedItems;
    const resolutionRate = totalItems > 0 ? Math.round((resolvedItems / totalItems) * 100) : 0;
    const content = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px;">
        <div style="background:#eef2ff;border:1px solid #c7d2fe;border-radius:12px;padding:20px;text-align:center;">
          <div style="font-size:12px;color:#3730a3;font-weight:600;">Total Items (${months}mo)</div>
          <div style="font-size:28px;font-weight:800;color:#4f46e5;">${totalItems}</div>
        </div>
        <div style="background:#ecfdf5;border:1px solid #a7f3d0;border-radius:12px;padding:20px;text-align:center;">
          <div style="font-size:12px;color:#065f46;font-weight:600;">Resolved</div>
          <div style="font-size:28px;font-weight:800;color:#059669;">${resolvedItems}</div>
        </div>
        <div style="background:#fffbeb;border:1px solid #fde68a;border-radius:12px;padding:20px;text-align:center;">
          <div style="font-size:12px;color:#92400e;font-weight:600;">Resolution Rate</div>
          <div style="font-size:28px;font-weight:800;color:${resolutionRate >= 50 ? '#059669' : '#f59e0b'};">${resolutionRate}%</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center;">
          ${svgBar(catData, 480, 320, 'Items by Category', 'Category')}
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center;">
          ${svgTrendLine(trendLost, 480, 320, 'Lost Items Trend')}
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center;">
          ${svgTrendLine(trendFound, 480, 320, 'Found Items Trend')}
        </div>
        <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:16px;text-align:center;">
          ${svgTrendLine(trendClaimed, 480, 320, 'Claims Trend')}
        </div>
      </div>`;
    res.send(renderPage('Monthly Report', pageWrap('Monthly Report', content, req.session?.user), req.session?.user));
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 13: Disposal Management
  // ══════════════════════════════════════════════════════════════════════
  app.get('/lost-found/disposal', requireAdmin, ah(async (req, res) => {
    const tid = getTenantId(req);
    // Items unclaimed for 90+ days
    const eligibleRes = await pool.query(
      `SELECT * FROM lost_found_items
       WHERE tenant_id=$1 AND status IN ('lost','found')
         AND deleted_at IS NULL
         AND date_reported < NOW() - INTERVAL '${DISPOSAL_DAYS} days'
       ORDER BY date_reported ASC`,
      [tid]
    );
    // Already disposed/donated
    const disposedRes = await pool.query(
      `SELECT * FROM lost_found_items
       WHERE tenant_id=$1 AND status IN ('donated','disposed')
         AND deleted_at IS NULL
       ORDER BY disposal_at DESC NULLS LAST LIMIT 50`,
      [tid]
    );
    let eligibleHtml = '';
    eligibleRes.rows.forEach(item => {
      const days = daysSince(item.date_reported);
      const urgency = days > 120 ? '#ef4444' : '#f59e0b';
      eligibleHtml += `<tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px 12px;"><a href="/lost-found/item/${item.id}" style="color:#4f46e5;text-decoration:none;font-weight:500;">${esc(item.item_name)}</a></td>
        <td style="padding:10px 12px;">${categoryBadge(item.category)}</td>
        <td style="padding:10px 12px;">${statusBadge(item.status)}</td>
        <td style="padding:10px 12px;font-size:13px;">${formatDate(item.date_reported)}</td>
        <td style="padding:10px 12px;"><span style="font-weight:700;color:${urgency};">${days} days</span></td>
        <td style="padding:10px 12px;white-space:nowrap;">
          <form method="POST" action="/lost-found/disposal/${item.id}" style="display:inline;">
            <input type="hidden" name="action" value="donate" />
            <button type="submit" style="background:#8b5cf6;color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;" aria-label="Mark ${esc(item.item_name)} for donation">Donate</button>
          </form>
          <form method="POST" action="/lost-found/disposal/${item.id}" style="display:inline;margin-left:4px;">
            <input type="hidden" name="action" value="dispose" />
            <button type="submit" style="background:#6b7280;color:#fff;border:none;padding:5px 12px;border-radius:6px;font-size:12px;font-weight:600;cursor:pointer;" aria-label="Mark ${esc(item.item_name)} for disposal">Dispose</button>
          </form>
        </td>
      </tr>`;
    });
    let disposedHtml = '';
    disposedRes.rows.forEach(item => {
      disposedHtml += `<tr style="border-bottom:1px solid #f3f4f6;">
        <td style="padding:10px 12px;"><a href="/lost-found/item/${item.id}" style="color:#4f46e5;text-decoration:none;">${esc(item.item_name)}</a></td>
        <td style="padding:10px 12px;">${categoryBadge(item.category)}</td>
        <td style="padding:10px 12px;">${statusBadge(item.status)}</td>
        <td style="padding:10px 12px;">${formatDate(item.disposal_at)}</td>
        <td style="padding:10px 12px;font-size:13px;color:#6b7280;">${esc(item.admin_notes || '')}</td>
      </tr>`;
    });
    const content = `
      <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:12px;padding:16px;margin-bottom:24px;">
        <div style="font-size:14px;font-weight:600;color:#991b1b;">⚠️ Items unclaimed for ${DISPOSAL_DAYS}+ days are eligible for donation or disposal. Review each item before taking action.</div>
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;margin-bottom:24px;">
        <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#1f2937;">
          Eligible for Disposal (${eligibleRes.rows.length} items)
        </div>
        ${eligibleRes.rows.length ? `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;" role="table" aria-label="Eligible disposal items">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Item</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Category</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Status</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Reported</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Age</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Actions</th>
            </tr></thead>
            <tbody>${eligibleHtml}</tbody>
          </table>
        </div>` : '<div style="padding:20px;text-align:center;color:#9ca3af;">No items eligible for disposal. 🎉</div>'}
      </div>
      <div style="background:#fff;border:1px solid #e5e7eb;border-radius:12px;overflow:hidden;">
        <div style="padding:16px 20px;border-bottom:1px solid #e5e7eb;font-weight:600;color:#1f2937;">
          Disposal History
        </div>
        ${disposedRes.rows.length ? `
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;" role="table" aria-label="Disposed items history">
            <thead><tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Item</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Category</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Status</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Disposed</th>
              <th style="padding:10px 12px;text-align:left;font-size:11px;color:#6b7280;text-transform:uppercase;">Notes</th>
            </tr></thead>
            <tbody>${disposedHtml}</tbody>
          </table>
        </div>` : '<div style="padding:20px;text-align:center;color:#9ca3af;">No items have been disposed or donated yet.</div>'}
      </div>`;
    res.send(renderPage('Disposal Management', pageWrap('Disposal Management', content, req.session?.user), req.session?.user));
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 14: Disposal Action — POST
  // ══════════════════════════════════════════════════════════════════════
  app.post('/lost-found/disposal/:id', requireAdmin, ah(async (req, res) => {
    const tid = getTenantId(req);
    const action = req.body.action;
    if (action !== 'donate' && action !== 'dispose') return res.status(400).send('Invalid action.');
    const newStatus = action === 'donate' ? 'donated' : 'disposed';
    const adminNotes = req.body.admin_notes || `Marked for ${action} by admin`;
    const { rows } = await pool.query(
      'SELECT * FROM lost_found_items WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL',
      [req.params.id, tid]
    );
    if (!rows.length) return res.status(404).send('Item not found.');
    const item = rows[0];
    await pool.query(
      `UPDATE lost_found_items SET status=$1, disposal_action=$2, disposal_at=NOW(),
        admin_notes=COALESCE(admin_notes || ' | ', '') || $3, updated_at=NOW()
       WHERE id=$4 AND tenant_id=$5`,
      [newStatus, action, adminNotes, req.params.id, tid]
    );
    audit('lost_found_disposal', { itemId: req.params.id, action, newStatus });
    // Notify original owner/finder
    const contactEmail = item.item_type === 'lost' ? item.owner_contact : item.finder_contact;
    if (contactEmail && contactEmail.includes('@')) {
      queueEmail({
        to: contactEmail,
        subject: `Item Update: "${item.item_name}" — ${newStatus}`,
        text: `The item "${item.item_name}" you reported as ${item.item_type} has been ${newStatus} after ${DISPOSAL_DAYS} days unclaimed. ${adminNotes}`
      });
    }
    res.redirect('/lost-found/disposal?msg=' + newStatus);
  }));

  // ══════════════════════════════════════════════════════════════════════
  // ROUTE 15: Soft-delete item
  // ══════════════════════════════════════════════════════════════════════
  app.post('/lost-found/item/:id/delete', requireAdmin, ah(async (req, res) => {
    const tid = getTenantId(req);
    await pool.query(
      `UPDATE lost_found_items SET deleted_at=NOW(), updated_at=NOW()
       WHERE id=$1 AND tenant_id=$2 AND deleted_at IS NULL`,
      [req.params.id, tid]
    );
    audit('lost_found_item_deleted', { itemId: req.params.id });
    res.redirect('/lost-found?msg=deleted');
  }));
};
