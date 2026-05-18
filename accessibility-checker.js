module.exports = function(app, pool, opts) {
  const esc = opts.esc;

  // Auto-create tables
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS accessibility_scans (
        id SERIAL PRIMARY KEY, page_url TEXT, page_title TEXT,
        scan_type TEXT DEFAULT 'full', wcag_level TEXT DEFAULT '2.1aa',
        total_issues INT DEFAULT 0, critical_issues INT DEFAULT 0,
        serious_issues INT DEFAULT 0, moderate_issues INT DEFAULT 0,
        minor_issues INT DEFAULT 0, score INT DEFAULT 0,
        scanned_at TIMESTAMPTZ DEFAULT NOW(), school_id INT DEFAULT 1
      )`);
      await pool.query(`CREATE TABLE IF NOT EXISTS accessibility_issues (
        id SERIAL PRIMARY KEY, scan_id INT REFERENCES accessibility_scans(id) ON DELETE CASCADE,
        rule_id TEXT, description TEXT, impact TEXT DEFAULT 'serious',
        element TEXT, help_url TEXT, is_fixed BOOLEAN DEFAULT false,
        fixed_at TIMESTAMPTZ, fixed_by INT, school_id INT DEFAULT 1
      )`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_as_school ON accessibility_scans(school_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_scan ON accessibility_issues(scan_id)`);
      await pool.query(`CREATE INDEX IF NOT EXISTS idx_ai_fixed ON accessibility_issues(is_fixed)`);
      console.log('[A11y] Tables ready');
    } catch(e) { console.warn('[A11y] Migration:', e.message); }
  })();

  // ============================================================
  // WCAG Quick Reference Data
  // ============================================================
  const WCAG_RULES = {
    'WCAG2A': {
      label: 'Level A',
      rules: [
        { id: 'img-alt', desc: 'Images must have alternate text', impact: 'critical', category: 'Images' },
        { id: 'label', desc: 'Form elements must have labels', impact: 'critical', category: 'Forms' },
        { id: 'html-lang', desc: 'Page must have a lang attribute', impact: 'serious', category: 'Page' },
        { id: 'document-title', desc: 'Document must have a title', impact: 'serious', category: 'Page' },
        { id: 'link-name', desc: 'Links must have discernible text', impact: 'critical', category: 'Links' },
        { id: 'button-name', desc: 'Buttons must have discernible text', impact: 'critical', category: 'Buttons' },
        { id: 'heading-order', desc: 'Heading levels must not skip', impact: 'moderate', category: 'Structure' },
        { id: 'color-contrast', desc: 'Elements must have sufficient contrast', impact: 'serious', category: 'Colors' },
        { id: 'list', desc: 'List items must be in a ul/ol', impact: 'moderate', category: 'Structure' },
        { id: 'listitem', desc: 'List items must have a parent li', impact: 'moderate', category: 'Structure' },
      ]
    },
    'WCAG2AA': {
      label: 'Level AA',
      rules: [
        { id: 'aria-roles', desc: 'ARIA roles must be valid', impact: 'critical', category: 'ARIA' },
        { id: 'aria-valid-attr', desc: 'ARIA attributes must be valid', impact: 'serious', category: 'ARIA' },
        { id: 'aria-required-attr', desc: 'Required ARIA attrs must be present', impact: 'serious', category: 'ARIA' },
        { id: 'tabindex', desc: 'Elements should not have tabindex > 0', impact: 'moderate', category: 'Keyboard' },
        { id: 'accesskeys', desc: 'Accesskeys must not duplicate', impact: 'moderate', category: 'Keyboard' },
        { id: 'meta-viewport', desc: 'Zoom must not be disabled', impact: 'critical', category: 'Page' },
        { id: 'frame-title', desc: 'Frames must have a title', impact: 'serious', category: 'Page' },
        { id: 'input-image-alt', desc: 'Image buttons must have alt text', impact: 'critical', category: 'Forms' },
        { id: 'select-name', desc: 'Select elements must have a label', impact: 'critical', category: 'Forms' },
        { id: 'table-fake', desc: 'Tables must not use layout role', impact: 'moderate', category: 'Tables' },
      ]
    }
  };

  const IMPACT_COLORS = {
    critical: '#ef4444',
    serious: '#f97316',
    moderate: '#eab308',
    minor: '#22c55e'
  };

  const IMPACT_LABELS = {
    critical: 'Critical',
    serious: 'Serious',
    moderate: 'Moderate',
    minor: 'Minor'
  };

  // ============================================================
  // Helper: SVG Score Gauge
  // ============================================================
  function renderScoreGauge(score, size = 140) {
    const radius = (size - 16) / 2;
    const circumference = 2 * Math.PI * radius;
    const offset = circumference - (score / 100) * circumference;
    let color = '#ef4444';
    if (score >= 90) color = '#22c55e';
    else if (score >= 70) color = '#eab308';
    else if (score >= 50) color = '#f97316';
    return `<svg width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
      <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="#1e293b" stroke-width="10"/>
      <circle cx="${size/2}" cy="${size/2}" r="${radius}" fill="none" stroke="${color}" stroke-width="10"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
        transform="rotate(-90 ${size/2} ${size/2})" style="transition:stroke-dashoffset .8s ease"/>
      <text x="${size/2}" y="${size/2 - 6}" text-anchor="middle" fill="white" font-size="32" font-weight="700">${score}</text>
      <text x="${size/2}" y="${size/2 + 16}" text-anchor="middle" fill="#94a3b8" font-size="12">/ 100</text>
    </svg>`;
  }

  // ============================================================
  // Helper: Scan Simulator (generates realistic mock issues)
  // ============================================================
  async function simulateScan(pageUrl, pageTitle, wcagLevel) {
    const seed = pageUrl.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const totalIssues = 5 + (seed % 20);
    const critical = Math.floor(totalIssues * (0.1 + (seed % 3) * 0.05));
    const serious = Math.floor(totalIssues * (0.25 + (seed % 3) * 0.05));
    const moderate = Math.floor(totalIssues * 0.3);
    const minor = totalIssues - critical - serious - moderate;
    const score = Math.max(10, Math.min(98, 100 - critical * 6 - serious * 3 - moderate * 1 - minor * 0.5));

    const scanRes = await pool.query(
      `INSERT INTO accessibility_scans (page_url, page_title, scan_type, wcag_level, total_issues, critical_issues, serious_issues, moderate_issues, minor_issues, score)
       VALUES ($1,$2,'full',$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [pageUrl, pageTitle || pageUrl, wcagLevel || '2.1aa', totalIssues, critical, serious, moderate, minor, Math.round(score)]
    );
    const scanId = scanRes.rows[0].id;

    const allRules = [...WCAG_RULES.WCAG2A.rules, ...WCAG_RULES.WCAG2AA.rules];
    const issues = [];
    let issueCount = 0;
    for (const rule of allRules) {
      if (issueCount >= totalIssues) break;
      if ((seed + rule.id.charCodeAt(0)) % 3 === 0) {
        issueCount++;
        const selector = `<${rule.category === 'Images' ? 'img' : rule.category === 'Links' ? 'a' : 'div'}>`;
        issues.push(pool.query(
          `INSERT INTO accessibility_issues (scan_id, rule_id, description, impact, element, help_url, school_id)
           VALUES ($1,$2,$3,$4,$5,$6,1)`,
          [scanId, rule.id, rule.desc, rule.impact, selector,
            `https://dequeuniversity.com/rules/axe/${rule.id}/4.8`]
        ));
      }
    }
    // Ensure we have at least totalIssues entries by duplicating some
    while (issues.length < totalIssues) {
      const rule = allRules[issues.length % allRules.length];
      issues.push(pool.query(
        `INSERT INTO accessibility_issues (scan_id, rule_id, description, impact, element, help_url, school_id)
         VALUES ($1,$2,$3,$4,$5,$6,1)`,
        [scanId, rule.id + '-dup-' + issues.length, rule.desc, rule.impact,
          `<div class="duplicate">`, `https://dequeuniversity.com/rules/axe/${rule.id}/4.8`]
      ));
    }
    await Promise.all(issues);
    return { id: scanId, score: Math.round(score), totalIssues, critical, serious, moderate, minor };
  }

  // ============================================================
  // Route 1: GET / - Dashboard
  // ============================================================
  app.get('/admin/accessibility', async (req, res) => {
    try {
      const scans = await pool.query(
        `SELECT * FROM accessibility_scans ORDER BY scanned_at DESC LIMIT 20`);
      const stats = await pool.query(
        `SELECT COUNT(*) as total_scans,
                COALESCE(AVG(score),0)::int as avg_score,
                SUM(total_issues) as total_issues,
                SUM(critical_issues) as total_critical,
                SUM(serious_issues) as total_serious,
                COUNT(CASE WHEN score >= 90 THEN 1 END) as passing_scans
         FROM accessibility_scans`);
      const s = stats.rows[0];
      const recentIssues = await pool.query(
        `SELECT i.*, s.page_title, s.page_url FROM accessibility_issues i
         JOIN accessibility_scans s ON s.id = i.scan_id
         WHERE i.is_fixed = false ORDER BY i.id DESC LIMIT 10`);

      const body = `
      <div class="space-y-6">
        <!-- Header -->
        <div class="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <div>
            <h1 class="text-2xl font-bold text-white flex items-center gap-3">
              <span class="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center">
                <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
              </span>
              Accessibility Checker
            </h1>
            <p class="text-slate-400 mt-1">WCAG compliance monitoring and issue tracking</p>
          </div>
          <div class="flex gap-3">
            <a href="/admin/accessibility/wcag-reference" class="px-4 py-2 bg-slate-700 text-slate-200 rounded-lg text-sm hover:bg-slate-600 transition">WCAG Reference</a>
            <button onclick="openScanModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500 transition flex items-center gap-2">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
              New Scan
            </button>
          </div>
        </div>

        <!-- Stats Cards -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
            <p class="text-slate-400 text-xs uppercase tracking-wide">Total Scans</p>
            <p class="text-3xl font-bold text-white mt-1">${s.total_scans}</p>
            <p class="text-slate-500 text-sm mt-1">${s.passing_scans} passing (90+)</p>
          </div>
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
            <p class="text-slate-400 text-xs uppercase tracking-wide">Average Score</p>
            <p class="text-3xl font-bold text-white mt-1">${s.avg_score}</p>
            <div class="w-full bg-slate-700 rounded-full h-2 mt-2"><div class="h-2 rounded-full ${s.avg_score >= 70 ? 'bg-green-500' : s.avg_score >= 50 ? 'bg-yellow-500' : 'bg-red-500'}" style="width:${s.avg_score}%"></div></div>
          </div>
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
            <p class="text-slate-400 text-xs uppercase tracking-wide">Open Issues</p>
            <p class="text-3xl font-bold text-red-400 mt-1">${s.total_issues}</p>
            <p class="text-slate-500 text-sm mt-1">${s.total_critical} critical, ${s.total_serious} serious</p>
          </div>
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
            <p class="text-slate-400 text-xs uppercase tracking-wide">Pages Monitored</p>
            <p class="text-3xl font-bold text-blue-400 mt-1">${scans.rows.length}</p>
            <p class="text-slate-500 text-sm mt-1">WCAG 2.1 AA</p>
          </div>
        </div>

        <!-- Score Gauges Row -->
        <div class="grid grid-cols-1 md:grid-cols-3 gap-4">
          ${scans.rows.slice(0, 3).map(scan => `
            <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5 flex items-center gap-5 cursor-pointer hover:border-blue-500/50 transition" onclick="location.href='/admin/accessibility/scan/${scan.id}'">
              <div>${renderScoreGauge(scan.score, 100)}</div>
              <div class="flex-1 min-w-0">
                <p class="text-white font-medium truncate">${esc(scan.page_title || scan.page_url)}</p>
                <p class="text-slate-500 text-sm truncate">${esc(scan.page_url)}</p>
                <div class="flex gap-2 mt-2">
                  <span class="text-xs px-2 py-0.5 rounded-full ${scan.critical_issues > 0 ? 'bg-red-500/20 text-red-400' : 'bg-green-500/20 text-green-400'}">${scan.critical_issues} critical</span>
                  <span class="text-xs px-2 py-0.5 rounded-full bg-slate-700 text-slate-300">${scan.total_issues} total</span>
                </div>
              </div>
            </div>
          `).join('')}
          ${scans.rows.length === 0 ? '<div class="col-span-3 text-center py-16 text-slate-500">No scans yet. Click "New Scan" to get started.</div>' : ''}
        </div>

        <!-- Scan History Table -->
        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
          <div class="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
            <h2 class="text-white font-semibold">Scan History</h2>
            <a href="/admin/accessibility/export" class="text-blue-400 text-sm hover:text-blue-300">Export CSV</a>
          </div>
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-slate-700/50">
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Page</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Score</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Issues</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Critical</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">WCAG</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Scanned</th>
                  <th class="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                ${scans.rows.map(scan => `
                  <tr class="border-b border-slate-700/30 hover:bg-slate-700/20">
                    <td class="px-5 py-3">
                      <p class="text-white text-sm font-medium truncate max-w-xs">${esc(scan.page_title || scan.page_url)}</p>
                      <p class="text-slate-500 text-xs truncate max-w-xs">${esc(scan.page_url)}</p>
                    </td>
                    <td class="px-5 py-3">
                      <div class="flex items-center gap-2">
                        ${renderScoreGauge(scan.score, 50)}
                        <span class="text-sm font-semibold ${scan.score >= 90 ? 'text-green-400' : scan.score >= 70 ? 'text-yellow-400' : 'text-red-400'}">${scan.score}</span>
                      </div>
                    </td>
                    <td class="px-5 py-3 text-slate-300 text-sm">${scan.total_issues}</td>
                    <td class="px-5 py-3">
                      <span class="text-sm font-semibold ${scan.critical_issues > 0 ? 'text-red-400' : 'text-green-400'}">${scan.critical_issues}</span>
                    </td>
                    <td class="px-5 py-3"><span class="px-2 py-1 bg-blue-500/20 text-blue-300 rounded text-xs">${esc(scan.wcag_level)}</span></td>
                    <td class="px-5 py-3 text-slate-400 text-sm">${new Date(scan.scanned_at).toLocaleDateString()}</td>
                    <td class="px-5 py-3">
                      <a href="/admin/accessibility/scan/${scan.id}" class="text-blue-400 hover:text-blue-300 text-sm">View</a>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
        </div>

        <!-- Recent Issues -->
        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
          <div class="px-5 py-4 border-b border-slate-700/50 flex items-center justify-between">
            <h2 class="text-white font-semibold">Recent Open Issues</h2>
            <a href="/admin/accessibility/issues" class="text-blue-400 text-sm hover:text-blue-300">View All</a>
          </div>
          <div class="divide-y divide-slate-700/30">
            ${recentIssues.rows.map(issue => `
              <div class="px-5 py-3 flex items-center justify-between hover:bg-slate-700/20">
                <div class="flex items-center gap-3 min-w-0">
                  <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${IMPACT_COLORS[issue.impact] || '#6b7280'}"></span>
                  <div class="min-w-0">
                    <p class="text-white text-sm truncate">${esc(issue.description)}</p>
                    <p class="text-slate-500 text-xs truncate">${esc(issue.page_url)}</p>
                  </div>
                </div>
                <div class="flex items-center gap-2 flex-shrink-0">
                  <span class="text-xs px-2 py-0.5 rounded" style="background:${IMPACT_COLORS[issue.impact]}22;color:${IMPACT_COLORS[issue.impact]}">${esc(issue.impact)}</span>
                  <span class="text-xs text-slate-500 font-mono">${esc(issue.rule_id)}</span>
                </div>
              </div>
            `).join('')}
            ${recentIssues.rows.length === 0 ? '<div class="px-5 py-8 text-center text-slate-500">No open issues found.</div>' : ''}
          </div>
        </div>
      </div>

      <!-- Scan Modal -->
      <div id="scanModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
          <div class="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h3 class="text-white font-semibold">New Accessibility Scan</h3>
            <button onclick="closeScanModal()" class="text-slate-400 hover:text-white">&times;</button>
          </div>
          <form id="scanForm" class="p-6 space-y-4">
            <div>
              <label class="block text-slate-300 text-sm mb-1">Page URL</label>
              <input name="page_url" required placeholder="https://example.com/page" class="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
            </div>
            <div>
              <label class="block text-slate-300 text-sm mb-1">Page Title (optional)</label>
              <input name="page_title" placeholder="Home Page" class="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
            </div>
            <div>
              <label class="block text-slate-300 text-sm mb-1">WCAG Level</label>
              <select name="wcag_level" class="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
                <option value="2.1aa">WCAG 2.1 AA</option>
                <option value="2.1a">WCAG 2.1 A</option>
                <option value="2.0aa">WCAG 2.0 AA</option>
                <option value="2.2aa">WCAG 2.2 AA</option>
              </select>
            </div>
            <div class="flex gap-3 pt-2">
              <button type="button" onclick="closeScanModal()" class="flex-1 px-4 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600">Cancel</button>
              <button type="submit" id="scanBtn" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500 flex items-center justify-center gap-2">
                <svg class="w-4 h-4 animate-spin hidden" id="scanSpinner" fill="none" viewBox="0 0 24 24"><circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"/><path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"/></svg>
                Start Scan
              </button>
            </div>
          </form>
        </div>
      </div>

      <script>
        function openScanModal() { document.getElementById('scanModal').classList.remove('hidden'); }
        function closeScanModal() { document.getElementById('scanModal').classList.add('hidden'); }
        document.getElementById('scanForm').addEventListener('submit', async function(e) {
          e.preventDefault();
          const btn = document.getElementById('scanBtn');
          const spinner = document.getElementById('scanSpinner');
          btn.disabled = true; spinner.classList.remove('hidden');
          const fd = new FormData(this);
          try {
            const res = await fetch('/admin/accessibility/scan', { method:'POST', body:fd });
            const data = await res.json();
            if (data.id) { location.href = '/admin/accessibility/scan/' + data.id; }
            else { alert('Scan failed: ' + (data.error || 'Unknown error')); }
          } catch(err) { alert('Error: ' + err.message); }
          finally { btn.disabled = false; spinner.classList.add('hidden'); }
        });
      </script>`;

      res.send(opts.renderPage('Accessibility Checker', body, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Route 2: GET /data - JSON scan list
  // ============================================================
  app.get('/admin/accessibility/data', async (req, res) => {
    try {
      const { limit = 50, offset = 0, sort = 'scanned_at', dir = 'DESC' } = req.query;
      const allowedSorts = ['scanned_at', 'score', 'total_issues', 'critical_issues', 'page_title'];
      const sortCol = allowedSorts.includes(sort) ? sort : 'scanned_at';
      const dirUpper = dir.toUpperCase() === 'ASC' ? 'ASC' : 'DESC';

      const scans = await pool.query(
        `SELECT * FROM accessibility_scans ORDER BY ${sortCol} ${dirUpper} LIMIT $1 OFFSET $2`, [limit, offset]);
      const count = await pool.query(`SELECT COUNT(*) FROM accessibility_scans`);

      res.json({ scans: scans.rows, total: parseInt(count.rows[0].count), limit: parseInt(limit), offset: parseInt(offset) });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Route 3: POST /scan - Trigger new scan
  // ============================================================
  app.post('/admin/accessibility/scan', async (req, res) => {
    try {
      const { page_url, page_title, wcag_level } = req.body;
      if (!page_url) return res.status(400).json({ error: 'page_url is required' });

      const result = await simulateScan(page_url, page_title || null, wcag_level || '2.1aa');
      res.json({ id: result.id, score: result.score, totalIssues: result.totalIssues, critical: result.critical });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Route 4: GET /scan/:id - Detailed scan results
  // ============================================================
  app.get('/admin/accessibility/scan/:id', async (req, res) => {
    try {
      const { id } = req.params;
      const scan = await pool.query(`SELECT * FROM accessibility_scans WHERE id = $1`, [id]);
      if (!scan.rows.length) return res.status(404).send('Scan not found');

      const issues = await pool.query(
        `SELECT * FROM accessibility_issues WHERE scan_id = $1 ORDER BY
          CASE impact WHEN 'critical' THEN 1 WHEN 'serious' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END, id`, [id]);
      const s = scan.rows[0];
      const fixedCount = issues.rows.filter(i => i.is_fixed).length;
      const openCount = issues.rows.length - fixedCount;

      const impactGroups = {};
      issues.rows.forEach(i => {
        if (!impactGroups[i.impact]) impactGroups[i.impact] = [];
        impactGroups[i.impact].push(i);
      });

      const body = `
      <div class="space-y-6">
        <div class="flex items-center gap-3">
          <a href="/admin/accessibility" class="text-slate-400 hover:text-white transition">
            <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg>
          </a>
          <h1 class="text-2xl font-bold text-white">Scan Results</h1>
        </div>

        <!-- Scan Summary Card -->
        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6">
          <div class="flex flex-col md:flex-row md:items-start gap-6">
            <div class="flex-shrink-0">${renderScoreGauge(s.score, 160)}</div>
            <div class="flex-1 space-y-4">
              <div>
                <h2 class="text-xl font-bold text-white">${esc(s.page_title || 'Untitled Page')}</h2>
                <a href="${esc(s.page_url)}" target="_blank" class="text-blue-400 text-sm hover:text-blue-300">${esc(s.page_url)}</a>
              </div>
              <div class="grid grid-cols-2 md:grid-cols-5 gap-3">
                <div class="bg-slate-900/50 rounded-lg p-3 text-center">
                  <p class="text-2xl font-bold text-white">${s.total_issues}</p><p class="text-slate-400 text-xs">Total Issues</p>
                </div>
                <div class="bg-red-500/10 rounded-lg p-3 text-center">
                  <p class="text-2xl font-bold text-red-400">${s.critical_issues}</p><p class="text-red-400 text-xs">Critical</p>
                </div>
                <div class="bg-orange-500/10 rounded-lg p-3 text-center">
                  <p class="text-2xl font-bold text-orange-400">${s.serious_issues}</p><p class="text-orange-400 text-xs">Serious</p>
                </div>
                <div class="bg-yellow-500/10 rounded-lg p-3 text-center">
                  <p class="text-2xl font-bold text-yellow-400">${s.moderate_issues}</p><p class="text-yellow-400 text-xs">Moderate</p>
                </div>
                <div class="bg-green-500/10 rounded-lg p-3 text-center">
                  <p class="text-2xl font-bold text-green-400">${s.minor_issues}</p><p class="text-green-400 text-xs">Minor</p>
                </div>
              </div>
              <div class="flex flex-wrap gap-3 text-sm text-slate-400">
                <span>WCAG: <span class="text-blue-400">${esc(s.wcag_level)}</span></span>
                <span>Scanned: ${new Date(s.scanned_at).toLocaleString()}</span>
                <span>Fixed: <span class="text-green-400">${fixedCount}</span></span>
                <span>Open: <span class="text-red-400">${openCount}</span></span>
              </div>
            </div>
          </div>
        </div>

        <!-- Progress Bar -->
        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
          <div class="flex items-center justify-between mb-2">
            <span class="text-slate-300 text-sm font-medium">Fix Progress</span>
            <span class="text-slate-400 text-sm">${issues.rows.length > 0 ? Math.round(fixedCount / issues.rows.length * 100) : 0}%</span>
          </div>
          <div class="w-full bg-slate-700 rounded-full h-3">
            <div class="bg-green-500 h-3 rounded-full transition-all" style="width:${issues.rows.length > 0 ? (fixedCount / issues.rows.length * 100) : 0}%"></div>
          </div>
        </div>

        <!-- Issues by Impact -->
        ${['critical', 'serious', 'moderate', 'minor'].map(impact => {
          const group = impactGroups[impact];
          if (!group || !group.length) return '';
          return `
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
            <div class="px-5 py-3 border-b border-slate-700/50 flex items-center gap-2">
              <span class="w-3 h-3 rounded-full" style="background:${IMPACT_COLORS[impact]}"></span>
              <h3 class="text-white font-semibold">${IMPACT_LABELS[impact]} Issues</h3>
              <span class="text-slate-500 text-sm">(${group.length})</span>
              ${group.length > 1 ? `<button onclick="bulkFixByImpact(${id}, '${impact}')" class="ml-auto px-3 py-1 bg-slate-700 text-slate-300 rounded text-xs hover:bg-slate-600">Fix All ${IMPACT_LABELS[impact]}</button>` : ''}
            </div>
            <div class="divide-y divide-slate-700/30">
              ${group.map(issue => `
                <div class="px-5 py-3 flex items-start gap-4 hover:bg-slate-700/20 ${issue.is_fixed ? 'opacity-50' : ''}">
                  <div class="flex-1 min-w-0">
                    <p class="text-white text-sm ${issue.is_fixed ? 'line-through' : ''}">${esc(issue.description)}</p>
                    <div class="flex flex-wrap gap-2 mt-1">
                      <code class="text-xs bg-slate-900 px-2 py-0.5 rounded text-slate-400">${esc(issue.rule_id)}</code>
                      <code class="text-xs bg-slate-900 px-2 py-0.5 rounded text-slate-500">${esc(issue.element)}</code>
                      <a href="${esc(issue.help_url)}" target="_blank" class="text-xs text-blue-400 hover:text-blue-300">Learn More</a>
                    </div>
                  </div>
                  <div class="flex items-center gap-2 flex-shrink-0">
                    ${issue.is_fixed
                      ? '<span class="text-xs text-green-400">Fixed</span>'
                      : `<button onclick="fixIssue(${issue.id})" class="px-3 py-1 bg-green-600/20 text-green-400 rounded text-xs hover:bg-green-600/30">Mark Fixed</button>`}
                  </div>
                </div>
              `).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>

      <script>
        async function fixIssue(issueId) {
          const res = await fetch('/admin/accessibility/issues/' + issueId + '/fix', { method:'POST' });
          if (res.ok) location.reload(); else alert('Failed to fix issue');
        }
        async function bulkFixByImpact(scanId, impact) {
          const res = await fetch('/admin/accessibility/issues/bulk-fix', {
            method:'POST', headers:{'Content-Type':'application/json'},
            body: JSON.stringify({ scan_id: parseInt(scanId), impact })
          });
          if (res.ok) location.reload(); else alert('Bulk fix failed');
        }
      </script>`;

      res.send(opts.renderPage(`Scan #${id} - Accessibility`, body, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Route 5: GET /issues - All issues across scans
  // ============================================================
  app.get('/admin/accessibility/issues', async (req, res) => {
    try {
      const { impact, scan_id, is_fixed, limit = 50, offset = 0 } = req.query;
      let where = 'WHERE 1=1';
      const params = [];
      let paramIdx = 1;

      if (impact) { where += ` AND i.impact = $${paramIdx++}`; params.push(impact); }
      if (scan_id) { where += ` AND i.scan_id = $${paramIdx++}`; params.push(scan_id); }
      if (is_fixed !== undefined) { where += ` AND i.is_fixed = $${paramIdx++}`; params.push(is_fixed === 'true'); }
      params.push(limit, offset);

      const issues = await pool.query(
        `SELECT i.*, s.page_title, s.page_url FROM accessibility_issues i
         JOIN accessibility_scans s ON s.id = i.scan_id
         ${where} ORDER BY i.id DESC LIMIT $${paramIdx++} OFFSET $${paramIdx++}`, params);

      const body = `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <a href="/admin/accessibility" class="text-slate-400 hover:text-white"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg></a>
            <h1 class="text-2xl font-bold text-white">All Issues</h1>
          </div>
          <div class="flex gap-2">
            <a href="/admin/accessibility/export" class="px-4 py-2 bg-slate-700 text-slate-200 rounded-lg text-sm hover:bg-slate-600">Export CSV</a>
          </div>
        </div>

        <!-- Filters -->
        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-4">
          <div class="flex flex-wrap gap-2">
            ${['critical','serious','moderate','minor'].map(imp => `
              <a href="/admin/accessibility/issues?impact=${imp}" class="px-3 py-1.5 rounded-lg text-sm transition ${impact === imp ? 'text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}" ${impact === imp ? `style="background:${IMPACT_COLORS[imp]}33;color:${IMPACT_COLORS[imp]}"` : ''}>${IMPACT_LABELS[imp]}</a>
            `).join('')}
            <a href="/admin/accessibility/issues?is_fixed=false" class="px-3 py-1.5 rounded-lg text-sm ${is_fixed === 'false' ? 'bg-orange-500/20 text-orange-400' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}">Open Only</a>
            <a href="/admin/accessibility/issues?is_fixed=true" class="px-3 py-1.5 rounded-lg text-sm ${is_fixed === 'true' ? 'bg-green-500/20 text-green-400' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'}">Fixed Only</a>
            <a href="/admin/accessibility/issues" class="px-3 py-1.5 rounded-lg text-sm bg-slate-700 text-slate-300 hover:bg-slate-600">All</a>
          </div>
        </div>

        <!-- Issues Table -->
        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-slate-700/50">
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Status</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Description</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Rule</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Impact</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Page</th>
                  <th class="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                ${issues.rows.map(issue => `
                  <tr class="border-b border-slate-700/30 hover:bg-slate-700/20 ${issue.is_fixed ? 'opacity-50' : ''}">
                    <td class="px-5 py-3">
                      ${issue.is_fixed
                        ? '<span class="inline-flex items-center gap-1 text-green-400 text-xs"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"/></svg>Fixed</span>'
                        : '<span class="inline-flex items-center gap-1 text-red-400 text-xs"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4m0 4h.01"/></svg>Open</span>'}
                    </td>
                    <td class="px-5 py-3 text-white text-sm max-w-xs truncate">${esc(issue.description)}</td>
                    <td class="px-5 py-3"><code class="text-xs bg-slate-900 px-2 py-0.5 rounded text-blue-400">${esc(issue.rule_id)}</code></td>
                    <td class="px-5 py-3">
                      <span class="px-2 py-0.5 rounded text-xs" style="background:${IMPACT_COLORS[issue.impact]}22;color:${IMPACT_COLORS[issue.impact]}">${esc(issue.impact)}</span>
                    </td>
                    <td class="px-5 py-3 text-slate-400 text-xs max-w-[200px] truncate">${esc(issue.page_url)}</td>
                    <td class="px-5 py-3">
                      <div class="flex gap-2">
                        <a href="/admin/accessibility/scan/${issue.scan_id}" class="text-blue-400 hover:text-blue-300 text-xs">View Scan</a>
                        ${!issue.is_fixed ? `<button onclick="fixIssue(${issue.id})" class="text-green-400 hover:text-green-300 text-xs">Fix</button>` : ''}
                      </div>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${issues.rows.length === 0 ? '<div class="px-5 py-12 text-center text-slate-500">No issues found matching filters.</div>' : ''}
        </div>
      </div>
      <script>
        async function fixIssue(id) {
          const res = await fetch('/admin/accessibility/issues/' + id + '/fix', { method:'POST' });
          if (res.ok) location.reload(); else alert('Failed');
        }
      </script>`;

      res.send(opts.renderPage('All Accessibility Issues', body, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Route 6: POST /issues/:id/fix - Mark issue as fixed
  // ============================================================
  app.post('/admin/accessibility/issues/:id/fix', async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        `UPDATE accessibility_issues SET is_fixed = true, fixed_at = NOW(), fixed_by = 1 WHERE id = $1 RETURNING *`, [id]);
      if (!result.rows.length) return res.status(404).json({ error: 'Issue not found' });

      // Recalculate scan totals
      const issue = result.rows[0];
      await pool.query(
        `UPDATE accessibility_scans SET
          total_issues = (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1),
          critical_issues = (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'critical' AND is_fixed = false),
          serious_issues = (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'serious' AND is_fixed = false),
          moderate_issues = (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'moderate' AND is_fixed = false),
          minor_issues = (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'minor' AND is_fixed = false),
          score = LEAST(100, GREATEST(0, 100 -
            (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'critical' AND is_fixed = false) * 6 -
            (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'serious' AND is_fixed = false) * 3 -
            (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'moderate' AND is_fixed = false) * 1))
        WHERE id = $1`, [issue.scan_id]);

      res.json({ success: true, issue: result.rows[0] });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Route 7: POST /issues/bulk-fix - Fix multiple issues
  // ============================================================
  app.post('/admin/accessibility/issues/bulk-fix', async (req, res) => {
    try {
      const { ids, scan_id, impact } = req.body;
      let result;
      if (ids && ids.length) {
        result = await pool.query(
          `UPDATE accessibility_issues SET is_fixed = true, fixed_at = NOW(), fixed_by = 1 WHERE id = ANY($1) RETURNING *`, [ids]);
      } else if (scan_id && impact) {
        result = await pool.query(
          `UPDATE accessibility_issues SET is_fixed = true, fixed_at = NOW(), fixed_by = 1 WHERE scan_id = $1 AND impact = $2 AND is_fixed = false RETURNING *`,
          [scan_id, impact]);
      } else {
        return res.status(400).json({ error: 'Provide ids array or scan_id + impact' });
      }

      // Recalculate affected scans
      const scanIds = [...new Set(result.rows.map(r => r.scan_id))];
      for (const sid of scanIds) {
        await pool.query(
          `UPDATE accessibility_scans SET
            critical_issues = (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'critical' AND is_fixed = false),
            serious_issues = (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'serious' AND is_fixed = false),
            moderate_issues = (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'moderate' AND is_fixed = false),
            minor_issues = (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'minor' AND is_fixed = false),
            score = LEAST(100, GREATEST(0, 100 -
              (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'critical' AND is_fixed = false) * 6 -
              (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'serious' AND is_fixed = false) * 3 -
              (SELECT COUNT(*) FROM accessibility_issues WHERE scan_id = $1 AND impact = 'moderate' AND is_fixed = false) * 1))
          WHERE id = $1`, [sid]);
      }

      res.json({ success: true, fixed_count: result.rows.length });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Route 8: GET /stats - Accessibility statistics
  // ============================================================
  app.get('/admin/accessibility/stats', async (req, res) => {
    try {
      const overview = await pool.query(`
        SELECT
          COUNT(DISTINCT s.id) as total_scans,
          COUNT(DISTINCT s.page_url) as unique_pages,
          COALESCE(AVG(s.score),0)::int as avg_score,
          COALESCE(MIN(s.score),0) as min_score,
          COALESCE(MAX(s.score),0) as max_score,
          COUNT(CASE WHEN s.score >= 90 THEN 1 END) as excellent,
          COUNT(CASE WHEN s.score >= 70 AND s.score < 90 THEN 1 END) as good,
          COUNT(CASE WHEN s.score >= 50 AND s.score < 70 THEN 1 END) as fair,
          COUNT(CASE WHEN s.score < 50 THEN 1 END) as poor
        FROM accessibility_scans s`);

      const impactStats = await pool.query(`
        SELECT impact, COUNT(*) as count, COUNT(CASE WHEN is_fixed THEN 1 END) as fixed
        FROM accessibility_issues GROUP BY impact ORDER BY
          CASE impact WHEN 'critical' THEN 1 WHEN 'serious' THEN 2 WHEN 'moderate' THEN 3 ELSE 4 END`);

      const topRules = await pool.query(`
        SELECT rule_id, COUNT(*) as count, COUNT(CASE WHEN is_fixed THEN 1 END) as fixed
        FROM accessibility_issues GROUP BY rule_id ORDER BY count DESC LIMIT 10`);

      const trendData = await pool.query(`
        SELECT DATE(scanned_at) as date, AVG(score)::int as avg_score, SUM(total_issues) as issues
        FROM accessibility_scans GROUP BY DATE(scanned_at) ORDER BY date DESC LIMIT 30`);

      res.json({
        overview: overview.rows[0],
        impactStats: impactStats.rows,
        topRules: topRules.rows,
        trend: trendData.rows
      });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Route 9: GET /export - Export issues CSV
  // ============================================================
  app.get('/admin/accessibility/export', async (req, res) => {
    try {
      const issues = await pool.query(`
        SELECT i.rule_id, i.description, i.impact, i.element, i.help_url, i.is_fixed,
               COALESCE(i.fixed_at::text, '') as fixed_at, s.page_url, s.page_title, s.wcag_level, s.scanned_at
        FROM accessibility_issues i
        JOIN accessibility_scans s ON s.id = i.scan_id
        ORDER BY i.impact, s.scanned_at DESC`);

      const headers = ['Rule ID', 'Description', 'Impact', 'Element', 'Help URL', 'Fixed', 'Fixed At', 'Page URL', 'Page Title', 'WCAG Level', 'Scanned At'];
      const rows = issues.rows.map(r => [
        r.rule_id, r.description, r.impact, r.element, r.help_url,
        r.is_fixed ? 'Yes' : 'No', r.fixed_at, r.page_url, r.page_title, r.wcag_level, r.scanned_at
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));

      const csv = [headers.join(','), ...rows].join('\n');
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', 'attachment; filename=accessibility-issues.csv');
      res.send(csv);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Route 10: DELETE /cleanup - Clean old scans
  // ============================================================
  app.delete('/admin/accessibility/cleanup', async (req, res) => {
    try {
      const { days = 90 } = req.body;
      const result = await pool.query(`
        DELETE FROM accessibility_scans WHERE scanned_at < NOW() - ($1 || ' days')::interval
        RETURNING id, page_url`, [days]);

      await pool.query(`
        DELETE FROM accessibility_issues WHERE scan_id NOT IN (SELECT id FROM accessibility_scans)`);

      res.json({ success: true, deleted_scans: result.rows.length, days });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Route 11: GET /wcag-reference - WCAG quick reference
  // ============================================================
  app.get('/admin/accessibility/wcag-reference', async (req, res) => {
    const categories = {};
    Object.entries(WCAG_RULES).forEach(([level, data]) => {
      data.rules.forEach(rule => {
        if (!categories[rule.category]) categories[rule.category] = [];
        categories[rule.category].push({ ...rule, level: data.label });
      });
    });

    const body = `
    <div class="space-y-6">
      <div class="flex items-center gap-3">
        <a href="/admin/accessibility" class="text-slate-400 hover:text-white"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg></a>
        <h1 class="text-2xl font-bold text-white">WCAG Quick Reference</h1>
      </div>

      <!-- WCAG Principles -->
      <div class="grid grid-cols-1 md:grid-cols-4 gap-4">
        ${[
          { icon: 'M15 12a3 3 0 11-6 0 3 3 0 016 0z', label: 'Perceivable', desc: 'Content must be presentable in ways all users can perceive' },
          { icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2', label: 'Operable', desc: 'Interface components must be operable by all users' },
          { icon: 'M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 110-4m0 4v2m0-6V4', label: 'Understandable', desc: 'Content and UI must be understandable' },
          { icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z', label: 'Robust', desc: 'Content must be robust enough for assistive technologies' },
        ].map(p => `
          <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
            <div class="w-10 h-10 rounded-lg bg-blue-500/20 flex items-center justify-center mb-3">
              <svg class="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="${p.icon}"/></svg>
            </div>
            <h3 class="text-white font-semibold">${p.label}</h3>
            <p class="text-slate-400 text-sm mt-1">${p.desc}</p>
          </div>
        `).join('')}
      </div>

      <!-- Impact Legend -->
      <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
        <h2 class="text-white font-semibold mb-3">Impact Levels</h2>
        <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
          ${Object.entries(IMPACT_COLORS).map(([key, color]) => `
            <div class="flex items-center gap-2">
              <span class="w-3 h-3 rounded-full" style="background:${color}"></span>
              <span class="text-sm text-slate-300">${IMPACT_LABELS[key]}</span>
            </div>
          `).join('')}
        </div>
      </div>

      <!-- Rules by Category -->
      ${Object.entries(categories).map(([category, rules]) => `
        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
          <div class="px-5 py-3 border-b border-slate-700/50">
            <h3 class="text-white font-semibold">${category}</h3>
          </div>
          <div class="divide-y divide-slate-700/30">
            ${rules.map(rule => `
              <div class="px-5 py-3 flex items-center gap-4 hover:bg-slate-700/20">
                <span class="w-2 h-2 rounded-full flex-shrink-0" style="background:${IMPACT_COLORS[rule.impact]}"></span>
                <div class="flex-1">
                  <p class="text-white text-sm">${esc(rule.desc)}</p>
                  <p class="text-slate-500 text-xs mt-0.5">Rule: ${esc(rule.id)}</p>
                </div>
                <span class="px-2 py-0.5 rounded text-xs" style="background:${IMPACT_COLORS[rule.impact]}22;color:${IMPACT_COLORS[rule.impact]}">${esc(rule.impact)}</span>
                <span class="px-2 py-0.5 rounded text-xs bg-slate-700 text-slate-300">${esc(rule.level)}</span>
              </div>
            `).join('')}
          </div>
        </div>
      `).join('')}

      <!-- External Resources -->
      <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-5">
        <h2 class="text-white font-semibold mb-3">External Resources</h2>
        <div class="grid grid-cols-1 md:grid-cols-3 gap-3">
          <a href="https://www.w3.org/WAI/WCAG21/quickref/" target="_blank" class="px-4 py-3 bg-slate-700/50 rounded-lg text-blue-400 text-sm hover:bg-slate-700 transition">W3C WCAG 2.1 Quick Ref</a>
          <a href="https://dequeuniversity.com/rules/axe/4.8/" target="_blank" class="px-4 py-3 bg-slate-700/50 rounded-lg text-blue-400 text-sm hover:bg-slate-700 transition">Deque Axe Rules</a>
          <a href="https://www.w3.org/WAI/test-evaluate/" target="_blank" class="px-4 py-3 bg-slate-700/50 rounded-lg text-blue-400 text-sm hover:bg-slate-700 transition">W3C Testing Resources</a>
        </div>
      </div>
    </div>`;

    res.send(opts.renderPage('WCAG Reference', body, req.session.user));
  });

  // ============================================================
  // Route 12: GET /settings - Scanner settings
  // ============================================================
  app.get('/admin/accessibility/settings', async (req, res) => {
    const body = `
    <div class="space-y-6">
      <div class="flex items-center gap-3">
        <a href="/admin/accessibility" class="text-slate-400 hover:text-white"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg></a>
        <h1 class="text-2xl font-bold text-white">Scanner Settings</h1>
      </div>

      <div class="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <!-- General Settings -->
        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
          <h2 class="text-white font-semibold text-lg">General</h2>
          <div>
            <label class="block text-slate-300 text-sm mb-1">Default WCAG Level</label>
            <select class="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
              <option value="2.1aa" selected>WCAG 2.1 AA</option>
              <option value="2.1a">WCAG 2.1 A</option>
              <option value="2.2aa">WCAG 2.2 AA</option>
              <option value="2.1aaa">WCAG 2.1 AAA</option>
            </select>
          </div>
          <div>
            <label class="block text-slate-300 text-sm mb-1">Passing Score Threshold</label>
            <input type="number" value="90" min="0" max="100" class="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
          </div>
          <div>
            <label class="block text-slate-300 text-sm mb-1">Auto-scan Interval (hours)</label>
            <input type="number" value="24" min="1" class="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
          </div>
        </div>

        <!-- Notification Settings -->
        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
          <h2 class="text-white font-semibold text-lg">Notifications</h2>
          ${[
            { label: 'Email on critical issues', checked: true },
            { label: 'Email on score drop below threshold', checked: true },
            { label: 'Weekly accessibility report', checked: false },
            { label: 'Slack notifications', checked: false },
          ].map(notif => `
            <label class="flex items-center justify-between">
              <span class="text-slate-300 text-sm">${notif.label}</span>
              <div class="relative">
                <input type="checkbox" ${notif.checked ? 'checked' : ''} class="sr-only peer">
                <div class="w-10 h-5 bg-slate-700 rounded-full peer-checked:bg-blue-600 transition cursor-pointer" onclick="this.previousElementSibling.click()"></div>
                <div class="absolute left-0.5 top-0.5 w-4 h-4 bg-white rounded-full transition peer-checked:translate-x-5 pointer-events-none"></div>
              </div>
            </label>
          `).join('')}
        </div>

        <!-- Scan Scope -->
        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
          <h2 class="text-white font-semibold text-lg">Scan Scope</h2>
          ${['Images & Alt Text', 'Color Contrast', 'Form Labels & Inputs', 'ARIA Attributes', 'Keyboard Navigation', 'Document Structure', 'Link & Button Text', 'Table Accessibility', 'Meta Tags & Title', 'Media Captions'].map(rule => `
            <label class="flex items-center gap-3">
              <input type="checkbox" checked class="w-4 h-4 rounded border-slate-600 bg-slate-900 text-blue-600 focus:ring-blue-500 focus:ring-offset-0">
              <span class="text-slate-300 text-sm">${rule}</span>
            </label>
          `).join('')}
        </div>

        <!-- Data Management -->
        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl p-6 space-y-4">
          <h2 class="text-white font-semibold text-lg">Data Management</h2>
          <div>
            <label class="block text-slate-300 text-sm mb-1">Auto-cleanup after (days)</label>
            <input type="number" value="90" min="7" class="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
          </div>
          <button onclick="cleanupOldScans()" class="px-4 py-2 bg-red-600/20 text-red-400 rounded-lg text-sm hover:bg-red-600/30 transition">Run Cleanup Now</button>
          <div class="pt-2">
            <p class="text-slate-500 text-xs">Cleanup removes scans older than the threshold and their associated issues.</p>
          </div>
        </div>
      </div>

      <div class="flex gap-3">
        <button class="px-6 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500 transition">Save Settings</button>
        <button class="px-6 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm hover:bg-slate-600 transition">Reset Defaults</button>
      </div>
    </div>
    <script>
      async function cleanupOldScans() {
        if (!confirm('Delete scans older than 90 days?')) return;
        const res = await fetch('/admin/accessibility/cleanup', { method:'DELETE', headers:{'Content-Type':'application/json'}, body: JSON.stringify({days:90}) });
        const data = await res.json();
        alert('Deleted ' + data.deleted_scans + ' scans.');
      }
    </script>`;

    res.send(opts.renderPage('Scanner Settings', body, req.session.user));
  });

  // ============================================================
  // Route 13: GET /pages - Pages management
  // ============================================================
  app.get('/admin/accessibility/pages', async (req, res) => {
    try {
      const pages = await pool.query(`
        SELECT DISTINCT ON (page_url) page_url, page_title,
          MAX(scanned_at) as last_scanned,
          AVG(score)::int as avg_score,
          MAX(score) as best_score,
          MIN(score) as worst_score,
          COUNT(*) as scan_count
        FROM accessibility_scans GROUP BY page_url, page_title ORDER BY page_url`);

      const body = `
      <div class="space-y-6">
        <div class="flex items-center justify-between">
          <div class="flex items-center gap-3">
            <a href="/admin/accessibility" class="text-slate-400 hover:text-white"><svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15 19l-7-7 7-7"/></svg></a>
            <h1 class="text-2xl font-bold text-white">Pages</h1>
          </div>
          <button onclick="openAddPageModal()" class="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500 transition">Add Page</button>
        </div>

        <div class="bg-slate-800/50 border border-slate-700/50 rounded-xl overflow-hidden">
          <div class="overflow-x-auto">
            <table class="w-full">
              <thead>
                <tr class="border-b border-slate-700/50">
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Page</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Avg Score</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Best</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Worst</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Scans</th>
                  <th class="text-left px-5 py-3 text-xs text-slate-400 uppercase">Last Scanned</th>
                  <th class="px-5 py-3"></th>
                </tr>
              </thead>
              <tbody>
                ${pages.rows.map(p => `
                  <tr class="border-b border-slate-700/30 hover:bg-slate-700/20">
                    <td class="px-5 py-3">
                      <p class="text-white text-sm font-medium">${esc(p.page_title || p.page_url)}</p>
                      <p class="text-slate-500 text-xs">${esc(p.page_url)}</p>
                    </td>
                    <td class="px-5 py-3">
                      <div class="flex items-center gap-2">
                        ${renderScoreGauge(p.avg_score, 44)}
                        <span class="text-sm font-semibold ${p.avg_score >= 90 ? 'text-green-400' : p.avg_score >= 70 ? 'text-yellow-400' : 'text-red-400'}">${p.avg_score}</span>
                      </div>
                    </td>
                    <td class="px-5 py-3 text-green-400 text-sm">${p.best_score}</td>
                    <td class="px-5 py-3 text-red-400 text-sm">${p.worst_score}</td>
                    <td class="px-5 py-3 text-slate-300 text-sm">${p.scan_count}</td>
                    <td class="px-5 py-3 text-slate-400 text-sm">${p.last_scanned ? new Date(p.last_scanned).toLocaleDateString() : 'Never'}</td>
                    <td class="px-5 py-3">
                      <button onclick="quickScan('${esc(p.page_url)}','${esc(p.page_title || p.page_url)}')" class="text-blue-400 hover:text-blue-300 text-sm">Scan Now</button>
                    </td>
                  </tr>
                `).join('')}
              </tbody>
            </table>
          </div>
          ${pages.rows.length === 0 ? '<div class="px-5 py-12 text-center text-slate-500">No pages tracked yet. Add a page to start monitoring.</div>' : ''}
        </div>
      </div>

      <!-- Add Page Modal -->
      <div id="addPageModal" class="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 hidden flex items-center justify-center p-4">
        <div class="bg-slate-800 border border-slate-700 rounded-2xl w-full max-w-lg shadow-2xl">
          <div class="px-6 py-4 border-b border-slate-700 flex items-center justify-between">
            <h3 class="text-white font-semibold">Add Page to Monitor</h3>
            <button onclick="document.getElementById('addPageModal').classList.add('hidden')" class="text-slate-400 hover:text-white">&times;</button>
          </div>
          <form id="addPageForm" class="p-6 space-y-4">
            <div>
              <label class="block text-slate-300 text-sm mb-1">Page URL</label>
              <input name="page_url" required placeholder="https://example.com/page" class="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
            </div>
            <div>
              <label class="block text-slate-300 text-sm mb-1">Page Title</label>
              <input name="page_title" placeholder="Home Page" class="w-full bg-slate-900 border border-slate-600 rounded-lg px-4 py-2 text-white text-sm focus:outline-none focus:border-blue-500">
            </div>
            <div>
              <label class="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked name="scan_now" class="w-4 h-4 rounded border-slate-600 bg-slate-900 text-blue-600">
                <span class="text-slate-300 text-sm">Run scan immediately after adding</span>
              </label>
            </div>
            <div class="flex gap-3 pt-2">
              <button type="button" onclick="document.getElementById('addPageModal').classList.add('hidden')" class="flex-1 px-4 py-2 bg-slate-700 text-slate-300 rounded-lg text-sm">Cancel</button>
              <button type="submit" class="flex-1 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm hover:bg-blue-500">Add Page</button>
            </div>
          </form>
        </div>
      </div>

      <script>
        function openAddPageModal() { document.getElementById('addPageModal').classList.remove('hidden'); }
        document.getElementById('addPageForm').addEventListener('submit', async function(e) {
          e.preventDefault();
          const fd = new FormData(this);
          const scanNow = fd.get('scan_now');
          fd.delete('scan_now');
          const res = await fetch('/admin/accessibility/pages', { method:'POST', body:fd });
          const data = await res.json();
          if (scanNow && data.page_url) {
            location.href = '/admin/accessibility/scan/' + data.scan_id;
          } else if (res.ok) {
            location.reload();
          } else { alert('Error: ' + (data.error || 'Failed')); }
        });
        async function quickScan(url, title) {
          const fd = new FormData(); fd.append('page_url', url); fd.append('page_title', title);
          const res = await fetch('/admin/accessibility/scan', { method:'POST', body:fd });
          const data = await res.json();
          if (data.id) { location.href = '/admin/accessibility/scan/' + data.id; }
          else alert('Scan failed');
        }
      </script>`;

      res.send(opts.renderPage('Pages Management', body, req.session.user));
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ============================================================
  // Route 14: POST /pages - Add page (and optionally scan)
  // ============================================================
  app.post('/admin/accessibility/pages', async (req, res) => {
    try {
      const { page_url, page_title, scan_now } = req.body;
      if (!page_url) return res.status(400).json({ error: 'page_url is required' });

      let scanId = null;
      if (scan_now !== undefined && scan_now !== false) {
        const result = await simulateScan(page_url, page_title || null, '2.1aa');
        scanId = result.id;
      }

      res.json({ success: true, page_url, scan_id: scanId });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });
};
