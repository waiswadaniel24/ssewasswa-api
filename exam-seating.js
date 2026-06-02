// ============================================================
// EXAM SEATING MODULE — Smart Exam Seating Arrangement Optimizer
// Create seating plans, auto-assign with conflict/gender/class
// separation, manual swap, print-ready layouts, SVG room grids,
// room templates, history archive, conflict detection.
// ============================================================
'use strict';

const { migrateQuery } = require('./db');
module.exports = function examSeating(app, pool, opts) {
  const esc = opts.esc || (s => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s))
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || ((fn) => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  // -- Internal helpers ---------------------------------------------------
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
  const fmtDT = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—';
  const today = () => new Date().toISOString().split('T')[0];
  const P = '#4f46e5'; // primary indigo
  const P2 = '#6366f1';
  const PL = '#e0e7ff';
  const PG = '#059669';
  const PR = '#dc2626';
  const PY = '#f59e0b';

  // -- Shared CSS ---------------------------------------------------------
  const CSS = `<style>
    .es-nav{display:flex;gap:6px;flex-wrap:wrap;margin-bottom:20px}
    .es-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#4b5563;background:#f3f4f6;transition:.15s}
    .es-nav a:hover{background:#e0e7ff;color:${P}}
    .es-nav a.active{background:${P};color:#fff}
    .es-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s;color:#fff}
    .es-btn:hover{opacity:.9;transform:translateY(-1px)}
    .es-btn-p{background:${P}}.es-btn-g{background:${PG}}.es-btn-r{background:${PR}}.es-btn-y{background:${PY}}
    .es-btn-o{background:transparent;color:#6b7280;border:1px solid #d1d5db}
    .es-card{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.04)}
    .es-tbl{width:100%;border-collapse:collapse;font-size:13px}
    .es-tbl th{padding:11px 14px;text-align:left;border-bottom:2px solid ${PL};color:${P};font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#f8fafc}
    .es-tbl td{padding:10px 14px;border-bottom:1px solid #f3f4f6;color:#1e293b}
    .es-tbl tr:hover{background:#f8fafc}
    .es-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:14px;margin-bottom:20px}
    .es-stat{background:#fff;border:1px solid #e5e7eb;border-radius:14px;padding:18px;box-shadow:0 1px 3px rgba(0,0,0,.04);text-align:center}
    .es-stat-n{font-size:28px;font-weight:800;color:${P};line-height:1.1}
    .es-stat-l{font-size:11px;font-weight:600;color:#6b7280;text-transform:uppercase;letter-spacing:.3px;margin-top:4px}
    .es-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .es-fg{margin-bottom:16px}
    .es-fg label{display:block;font-size:13px;font-weight:600;color:#374151;margin-bottom:5px}
    .es-fg input,.es-fg select,.es-fg textarea{width:100%;padding:10px 14px;border:2px solid #e5e7eb;border-radius:10px;font-size:14px;box-sizing:border-box;transition:.15s;font-family:inherit}
    .es-fg input:focus,.es-fg select:focus,.es-fg textarea:focus{outline:none;border-color:${P};box-shadow:0 0 0 3px ${PL}}
    .es-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px}
    .es-grid3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
    .es-alert{padding:12px 16px;border-radius:10px;font-size:13px;font-weight:500;margin-bottom:16px}
    .es-alert-ok{background:#d1fae5;color:#065f46;border:1px solid #a7f3d0}
    .es-alert-err{background:#fee2e2;color:#991b1b;border:1px solid #fecaca}
    .es-alert-warn{background:#fffbeb;color:#92400e;border:1px solid #fde68a}
    .es-empty{text-align:center;padding:40px;color:#9ca3af;font-size:14px}
    .es-seat{display:flex;align-items:center;justify-content:center;border:2px solid #d1d5db;border-radius:8px;font-size:11px;font-weight:600;color:#1e293b;cursor:pointer;transition:.15s;min-height:52px;padding:4px;text-align:center;word-break:break-word;background:#fff}
    .es-seat:hover{border-color:${P};background:#eef2ff}
    .es-seat.occupied{background:#eef2ff;border-color:#a5b4fc}
    .es-seat.accommodation{background:#fef3c7;border-color:#fcd34d}
    .es-seat.selected{border-color:${PR};background:#fee2e2;box-shadow:0 0 0 3px rgba(220,38,38,.2)}
    .es-seat.empty-seat{background:#f9fafb;border-style:dashed;border-color:#d1d5db;color:#9ca3af;cursor:default}
    .es-seat-header{font-size:10px;font-weight:700;color:#6b7280;text-align:center;padding:4px}
    .es-room-grid{display:inline-grid;gap:6px;padding:20px;background:#f8fafc;border-radius:14px;border:2px solid #e5e7eb}
    .es-aisle{width:16px}
    .es-template-card{background:#fff;border:2px solid #e5e7eb;border-radius:12px;padding:18px;cursor:pointer;transition:.15s;text-align:center}
    .es-template-card:hover{border-color:${P};box-shadow:0 4px 12px rgba(79,70,229,.12)}
    .es-template-card.selected-template{border-color:${P};background:#eef2ff}
    .es-conflict{background:#fee2e2;border:1px solid #fca5a5;border-radius:10px;padding:12px 16px;margin-bottom:10px}
    @media(max-width:768px){.es-grid2,.es-grid3{grid-template-columns:1fr}.es-nav{gap:4px}.es-nav a{padding:6px 10px;font-size:12px}}
    @media print{
      body{background:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
      .es-nav,.no-print{display:none!important}
      .es-card{box-shadow:none;border:1px solid #ccc;page-break-inside:avoid;margin-bottom:12px}
      .es-room-grid{border:1px solid #333;padding:12px}
      .es-seat{border:1px solid #999;font-size:9px;min-height:40px}
      .print-header{border-bottom:3px solid ${P};padding-bottom:10px;margin-bottom:16px}
    }
  </style>`;

  // -- Badge helpers -------------------------------------------------------
  function badge(text, color) {
    return `<span class="es-badge" style="background:${color}18;color:${color}">${esc(text)}</span>`;
  }
  function statusBadge(s) {
    const m = {
      draft: [PY, 'Draft'], published: [PG, 'Published'], archived: ['#6b7280', 'Archived'],
      active: [PG, 'Active'], conflict: [PR, 'Conflict'], prebuilt: [P, 'Prebuilt'], custom: ['#8b5cf6', 'Custom']
    };
    const v = m[s] || ['#6b7280', s || 'Unknown'];
    return badge(v[1], v[0]);
  }

  // -- Navigation ----------------------------------------------------------
  const nav = (active) => `<div class="es-nav" role="navigation" aria-label="Exam Seating navigation">
    <a href="/exam-seating" class="${active === 'dash' ? 'active' : ''}">🏠 Dashboard</a>
    <a href="/exam-seating/plans" class="${active === 'plans' ? 'active' : ''}">📋 Plans</a>
    <a href="/exam-seating/create" class="${active === 'create' ? 'active' : ''}">✨ Create Plan</a>
    <a href="/exam-seating/templates" class="${active === 'templates' ? 'active' : ''}">📐 Templates</a>
    <a href="/exam-seating/conflicts" class="${active === 'conflicts' ? 'active' : ''}">⚠️ Conflicts</a>
    <a href="/exam-seating/history" class="${active === 'history' ? 'active' : ''}">📜 History</a>
  </div>`;

  // -- SVG Room Layout Generator -------------------------------------------
  function svgRoomGrid(rows, cols, seats, opts) {
    const cellW = opts.cellW || 72;
    const cellH = opts.cellH || 48;
    const gap = opts.gap || 4;
    const aisleAfter = opts.aisleAfter || Math.floor(cols / 2);
    const w = (cols * (cellW + gap)) + (opts.showAisle ? 20 : 0) + 40;
    const h = (rows * (cellH + gap)) + 60;
    let svg = `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Room seating layout ${rows}x${cols}">`;
    svg += `<defs><style>.seat-label{font-size:8px;font-family:system-ui,sans-serif;fill:#1e293b;text-anchor:middle;dominant-baseline:central;font-weight:600}</style></defs>`;
    // Header
    svg += `<text x="${w / 2}" y="18" text-anchor="middle" font-size="12" font-weight="800" fill="${P}" font-family="system-ui">${esc(opts.title || 'FRONT / PROCTOR TABLE')}</text>`;
    svg += `<line x1="10" y1="26" x2="${w - 10}" y2="26" stroke="${P}" stroke-width="2" stroke-dasharray="4,3"/>`;
    // Column headers
    const aisleX = (aisleAfter * (cellW + gap)) + 20;
    for (let c = 0; c < cols; c++) {
      let x = 20 + c * (cellW + gap);
      if (c >= aisleAfter) x += 20;
      svg += `<text x="${x + cellW / 2}" y="38" text-anchor="middle" font-size="9" fill="#6b7280" font-weight="700" font-family="system-ui">${String.fromCharCode(65 + c)}</text>`;
    }
    // Seats
    for (let r = 0; r < rows; r++) {
      const rowLabel = `R${r + 1}`;
      let y = 46 + r * (cellH + gap);
      for (let c = 0; c < cols; c++) {
        let x = 20 + c * (cellW + gap);
        if (c >= aisleAfter) x += 20;
        const seatKey = `${r}-${c}`;
        const seatData = seats && seats[seatKey] ? seats[seatKey] : null;
        const fill = seatData ? (seatData.accommodation ? '#fef3c7' : '#eef2ff') : '#f9fafb';
        const stroke = seatData ? (seatData.accommodation ? '#fcd34d' : '#a5b4fc') : '#d1d5db';
        svg += `<rect x="${x}" y="${y}" width="${cellW}" height="${cellH}" rx="5" fill="${fill}" stroke="${stroke}" stroke-width="1.5"/>`;
        if (seatData) {
          svg += `<text x="${x + cellW / 2}" y="${y + cellH / 2 - 4}" class="seat-label">${esc(seatData.name.substring(0, 10))}</text>`;
          if (seatData.cls) {
            svg += `<text x="${x + cellW / 2}" y="${y + cellH / 2 + 8}" font-size="6" fill="#6b7280" text-anchor="middle" font-family="system-ui">${esc(seatData.cls.substring(0, 6))}</text>`;
          }
        } else {
          svg += `<text x="${x + cellW / 2}" y="${y + cellH / 2}" class="seat-label" fill="#9ca3af">${rowLabel}${String.fromCharCode(65 + c)}</text>`;
        }
      }
    }
    // Aisle indicator
    if (opts.showAisle !== false) {
      svg += `<line x1="${aisleX + cellW / 2}" y1="44" x2="${aisleX + cellW / 2}" y2="${h - 10}" stroke="#d1d5db" stroke-width="1" stroke-dasharray="3,4"/>`;
    }
    svg += '</svg>';
    return svg;
  }

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    try {
      await migrateQuery(pool,'ExamSeating',`CREATE TABLE IF NOT EXISTS exam_seating_plans (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        exam_id INTEGER,
        exam_name VARCHAR(255) NOT NULL DEFAULT '',
        class_ids TEXT[] DEFAULT '{}',
        room_name VARCHAR(255) NOT NULL DEFAULT '',
        room_rows INTEGER NOT NULL DEFAULT 5,
        room_cols INTEGER NOT NULL DEFAULT 6,
        template_id INTEGER,
        separate_gender BOOLEAN DEFAULT false,
        mixed_exam BOOLEAN DEFAULT false,
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        total_seats INTEGER NOT NULL DEFAULT 0,
        assigned_seats INTEGER NOT NULL DEFAULT 0,
        notes TEXT,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const planCols = [
        ['exam_id', 'INTEGER'], ['exam_name', 'VARCHAR(255) NOT NULL DEFAULT \'\''],
        ['class_ids', 'TEXT[] DEFAULT \'{}\''], ['room_name', 'VARCHAR(255) NOT NULL DEFAULT \'\''],
        ['room_rows', 'INTEGER NOT NULL DEFAULT 5'], ['room_cols', 'INTEGER NOT NULL DEFAULT 6'],
        ['template_id', 'INTEGER'], ['separate_gender', 'BOOLEAN DEFAULT false'],
        ['mixed_exam', 'BOOLEAN DEFAULT false'], ['status', 'VARCHAR(20) NOT NULL DEFAULT \'draft\''],
        ['total_seats', 'INTEGER NOT NULL DEFAULT 0'], ['assigned_seats', 'INTEGER NOT NULL DEFAULT 0'],
        ['notes', 'TEXT'], ['created_by', 'INTEGER'], ['created_at', 'TIMESTAMPTZ DEFAULT NOW()'],
        ['updated_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, typ] of planCols) { try { await migrateQuery(pool,'ExamSeating',`ALTER TABLE exam_seating_plans ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch (e) {} }

      await migrateQuery(pool,'ExamSeating',`CREATE TABLE IF NOT EXISTS exam_seats (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        plan_id INTEGER NOT NULL REFERENCES exam_seating_plans(id) ON DELETE CASCADE,
        row_index INTEGER NOT NULL DEFAULT 0,
        col_index INTEGER NOT NULL DEFAULT 0,
        seat_label VARCHAR(20) NOT NULL DEFAULT '',
        student_id INTEGER,
        student_name VARCHAR(255) NOT NULL DEFAULT '',
        student_class VARCHAR(100),
        gender VARCHAR(20),
        needs_accommodation BOOLEAN DEFAULT false,
        is_empty BOOLEAN DEFAULT false,
        assigned_at TIMESTAMPTZ,
        manual_override BOOLEAN DEFAULT false
      )`);
      const seatCols = [
        ['plan_id', 'INTEGER NOT NULL'], ['row_index', 'INTEGER NOT NULL DEFAULT 0'],
        ['col_index', 'INTEGER NOT NULL DEFAULT 0'], ['seat_label', 'VARCHAR(20) NOT NULL DEFAULT \'\''],
        ['student_id', 'INTEGER'], ['student_name', 'VARCHAR(255) NOT NULL DEFAULT \'\''],
        ['student_class', 'VARCHAR(100)'], ['gender', 'VARCHAR(20)'],
        ['needs_accommodation', 'BOOLEAN DEFAULT false'], ['is_empty', 'BOOLEAN DEFAULT false'],
        ['assigned_at', 'TIMESTAMPTZ'], ['manual_override', 'BOOLEAN DEFAULT false']
      ];
      for (const [col, typ] of seatCols) { try { await migrateQuery(pool,'ExamSeating',`ALTER TABLE exam_seats ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch (e) {} }

      await migrateQuery(pool,'ExamSeating',`CREATE TABLE IF NOT EXISTS room_layout_templates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL DEFAULT '',
        description TEXT,
        rows INTEGER NOT NULL DEFAULT 5,
        cols INTEGER NOT NULL DEFAULT 6,
        type VARCHAR(20) NOT NULL DEFAULT 'custom',
        aisle_after INTEGER DEFAULT NULL,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      const tmplCols = [
        ['name', 'VARCHAR(255) NOT NULL DEFAULT \'\''], ['description', 'TEXT'],
        ['rows', 'INTEGER NOT NULL DEFAULT 5'], ['cols', 'INTEGER NOT NULL DEFAULT 6'],
        ['type', 'VARCHAR(20) NOT NULL DEFAULT \'custom\''], ['aisle_after', 'INTEGER'],
        ['created_by', 'INTEGER'], ['created_at', 'TIMESTAMPTZ DEFAULT NOW()']
      ];
      for (const [col, typ] of tmplCols) { try { await migrateQuery(pool,'ExamSeating',`ALTER TABLE room_layout_templates ADD COLUMN IF NOT EXISTS ${col} ${typ}`); } catch (e) {} }

      // Seed prebuilt templates
      const existingPrebuilt = (await migrateQuery(pool,'ExamSeating',`SELECT COUNT(*)::int AS c FROM room_layout_templates WHERE tenant_id=0 AND type='prebuilt'`)).rows[0].c;
      if (existingPrebuilt === 0) {
        const prebuilt = [
          ['Small Classroom', '5 rows x 6 columns — 30 seats', 5, 6, 3],
          ['Medium Classroom', '6 rows x 8 columns — 48 seats', 6, 8, 4],
          ['Large Classroom', '8 rows x 10 columns — 80 seats', 8, 10, 5],
          ['Exam Hall', '15 rows x 20 columns — 300 seats', 15, 20, 10]
        ];
        for (const [name, desc, rows, cols, aisle] of prebuilt) {
          await migrateQuery(pool,'ExamSeating',`INSERT INTO room_layout_templates (tenant_id, name, description, rows, cols, type, aisle_after) VALUES (0, $1, $2, $3, $4, 'prebuilt', $5)`,
            [name, desc, rows, cols, aisle]);
        }
      }

      // Indexes
      const idxs = [
        'CREATE INDEX IF NOT EXISTS idx_esp_tenant ON exam_seating_plans(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_esp_status ON exam_seating_plans(tenant_id, status)',
        'CREATE INDEX IF NOT EXISTS idx_esp_exam ON exam_seating_plans(tenant_id, exam_id)',
        'CREATE INDEX IF NOT EXISTS idx_es_plan ON exam_seats(tenant_id, plan_id)',
        'CREATE INDEX IF NOT EXISTS idx_es_student ON exam_seats(tenant_id, student_id)',
        'CREATE INDEX IF NOT EXISTS idx_rlt_tenant ON room_layout_templates(tenant_id)',
        'CREATE INDEX IF NOT EXISTS idx_rlt_type ON room_layout_templates(tenant_id, type)'
      ];
      for (const sql of idxs) { try { await migrateQuery(pool,'ExamSeating',sql); } catch (e) {} }
      console.log('[ExamSeating] Migrations complete');
    } catch (e) { console.error('[ExamSeating] Migration error:', e.message); }
    
  })();

  // ============================================================
  // AUTO-ASSIGN ALGORITHM
  // ============================================================
  function autoAssignSeats(students, rows, cols, opts) {
    const { separateGender, mixedExam, accommodationFirst } = opts;
    const totalSeats = rows * cols;
    const shuffled = [...students].sort(() => Math.random() - 0.5);
    const grid = Array.from({ length: rows }, () => Array(cols).fill(null));

    // Separate students by accommodation needs
    const accStudents = shuffled.filter(s => s.needs_accommodation);
    const regStudents = shuffled.filter(s => !s.needs_accommodation);

    // Separate by gender if required
    let maleQueue = [], femaleQueue = [];
    if (separateGender) {
      maleQueue = regStudents.filter(s => (s.gender || '').toLowerCase() === 'male');
      femaleQueue = regStudents.filter(s => (s.gender || '').toLowerCase() === 'female');
    }

    // Fill front rows first with accommodation students
    let studentQueue = [];
    let allAcc = [...accStudents];
    if (separateGender) {
      studentQueue = [...allAcc, ...maleQueue, ...femaleQueue];
    } else {
      studentQueue = [...allAcc, ...regStudents];
    }

    // Assign seats
    let si = 0;
    const occupied = Array.from({ length: rows }, () => Array(cols).fill(false));
    for (let r = 0; r < rows && si < studentQueue.length; r++) {
      const colOrder = [];
      for (let c = 0; c < cols; c++) colOrder.push(c);
      // Zigzag pattern: even rows left-to-right, odd rows right-to-left
      if (r % 2 === 1) colOrder.reverse();

      for (const c of colOrder) {
        if (si >= studentQueue.length) break;
        const student = studentQueue[si];
        grid[r][c] = student;
        occupied[r][c] = true;
        si++;
      }
    }

    // Post-process: check adjacent same-class conflicts (if mixed exam)
    if (mixedExam) {
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          if (!grid[r][c]) continue;
          const cls = grid[r][c].cls || grid[r][c].student_class || '';
          const neighbors = [];
          if (r > 0 && grid[r - 1][c]) neighbors.push(grid[r - 1][c]);
          if (r < rows - 1 && grid[r + 1][c]) neighbors.push(grid[r + 1][c]);
          if (c > 0 && grid[r][c - 1]) neighbors.push(grid[r][c - 1]);
          if (c < cols - 1 && grid[r][c + 1]) neighbors.push(grid[r][c + 1]);
          const sameClass = neighbors.find(n => (n.cls || n.student_class || '') === cls);
          if (sameClass) {
            // Try to swap with a different-class student in a non-adjacent position
            for (let r2 = 0; r2 < rows; r2++) {
              for (let c2 = 0; c2 < cols; c2++) {
                if (!grid[r2][c2] || (r2 === r && c2 === c)) continue;
                const otherCls = grid[r2][c2].cls || grid[r2][c2].student_class || '';
                if (otherCls !== cls && !isAdjacent(r, c, r2, c2)) {
                  // Check swap doesn't create new conflicts
                  const tmp = grid[r][c];
                  grid[r][c] = grid[r2][c2];
                  grid[r2][c2] = tmp;
                  if (!hasConflictAt(grid, r, c, cls) && !hasConflictAt(grid, r2, c2, otherCls)) {
                    break;
                  }
                  // Revert
                  grid[r2][c2] = grid[r][c];
                  grid[r][c] = tmp;
                }
              }
            }
          }
        }
      }
    }

    return grid;
  }

  function isAdjacent(r1, c1, r2, c2) {
    return Math.abs(r1 - r2) + Math.abs(c1 - c2) === 1;
  }

  function hasConflictAt(grid, r, c, cls) {
    const neighbors = [];
    if (r > 0 && grid[r - 1][c]) neighbors.push(grid[r - 1][c]);
    if (r < grid.length - 1 && grid[r + 1][c]) neighbors.push(grid[r + 1][c]);
    if (c > 0 && grid[r][c - 1]) neighbors.push(grid[r][c - 1]);
    if (c < grid[0].length - 1 && grid[r][c + 1]) neighbors.push(grid[r][c + 1]);
    return neighbors.some(n => (n.cls || n.student_class || '') === cls);
  }

  // ============================================================
  // ROUTE 1: GET /exam-seating — Dashboard
  // ============================================================
  app.get('/exam-seating', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [plans, templates, published, conflicts] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS c FROM exam_seating_plans WHERE tenant_id=$1', [tid]),
      pool.query('SELECT COUNT(*)::int AS c FROM room_layout_templates WHERE tenant_id=$1 OR tenant_id=0', [tid]),
      pool.query("SELECT COUNT(*)::int AS c FROM exam_seating_plans WHERE tenant_id=$1 AND status='published'", [tid]),
      pool.query("SELECT COUNT(DISTINCT es.student_id)::int AS c FROM exam_seats es JOIN exam_seating_plans esp ON esp.id=es.plan_id WHERE es.tenant_id=$1 AND es.student_id IS NOT NULL GROUP BY es.student_id HAVING COUNT(*) > 1", [tid])
    ]);
    const planCount = plans.rows[0].c;
    const tmplCount = templates.rows[0].c;
    const pubCount = published.rows[0].c;
    const conflictStudents = conflicts.rows.length;

    const recentPlans = (await pool.query(
      `SELECT esp.*, u.name as creator_name FROM exam_seating_plans esp
       LEFT JOIN users u ON u.id = esp.created_by
       WHERE esp.tenant_id=$1 ORDER BY esp.created_at DESC LIMIT 6`, [tid]
    )).rows;

    const recentHtml = recentPlans.map(p => `<tr>
      <td><a href="/exam-seating/plans/${p.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(p.exam_name)}</a></td>
      <td>${esc(p.room_name)}</td>
      <td>${p.room_rows} x ${p.room_cols}</td>
      <td>${p.assigned_seats || 0} / ${p.total_seats || 0}</td>
      <td>${statusBadge(p.status)}</td>
      <td style="font-size:12px;color:#6b7280">${fmtDate(p.created_at)}</td>
    </tr>`).join('');

    const html = CSS + nav('dash') + `<div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:#111827;margin:0">🪑 Exam Seating Arrangements</h1>
          <p style="font-size:13px;color:#6b7280;margin-top:2px">Smart seating plans with conflict detection and auto-assignment</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/exam-seating/create" class="es-btn es-btn-p">✨ Create Plan</a>
          <a href="/exam-seating/templates" class="es-btn es-btn-o">📐 Templates</a>
        </div>
      </div>
      <div class="es-stats">
        <div class="es-stat"><div class="es-stat-n">${planCount}</div><div class="es-stat-l">Total Plans</div></div>
        <div class="es-stat"><div class="es-stat-n">${pubCount}</div><div class="es-stat-l">Published</div></div>
        <div class="es-stat"><div class="es-stat-n">${tmplCount}</div><div class="es-stat-l">Templates</div></div>
        <div class="es-stat"><div class="es-stat-n" style="color:${conflictStudents > 0 ? PR : PG}">${conflictStudents}</div><div class="es-stat-l">Conflict Alerts</div></div>
      </div>
      ${conflictStudents > 0 ? `<div class="es-alert es-alert-warn">⚠️ ${conflictStudents} student(s) have scheduling conflicts detected. <a href="/exam-seating/conflicts" style="color:${P};font-weight:700">Review conflicts →</a></div>` : ''}
      <div class="es-grid2">
        <div class="es-card">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="color:#111827;margin:0">📋 Recent Plans</h3>
            <a href="/exam-seating/plans" class="es-btn es-btn-o" style="padding:4px 12px;font-size:11px">View All →</a>
          </div>
          <div style="overflow-x:auto"><table class="es-tbl">
            <thead><tr><th>Exam</th><th>Room</th><th>Size</th><th>Assigned</th><th>Status</th><th>Created</th></tr></thead>
            <tbody>${recentHtml || '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:30px">No seating plans yet</td></tr>'}</tbody>
          </table></div>
        </div>
        <div class="es-card">
          <h3 style="color:#111827;margin:0 0 14px">⚡ Quick Actions</h3>
          <div style="display:flex;flex-direction:column;gap:8px">
            <a href="/exam-seating/create" class="es-btn es-btn-p" style="justify-content:center">✨ Create New Plan</a>
            <a href="/exam-seating/templates" class="es-btn es-btn-o" style="justify-content:center">📐 Manage Templates</a>
            <a href="/exam-seating/conflicts" class="es-btn es-btn-o" style="justify-content:center">⚠️ Check Conflicts</a>
            <a href="/exam-seating/history" class="es-btn es-btn-o" style="justify-content:center">📜 View History</a>
          </div>
          <div style="margin-top:16px;padding:14px;background:#f0f9ff;border-radius:10px;border:1px solid #bae6fd">
            <div style="font-size:12px;font-weight:700;color:#0369a1;margin-bottom:4px">💡 Tip</div>
            <div style="font-size:11px;color:#0c4a6e;line-height:1.5">Use the auto-assign feature to intelligently place students. The algorithm ensures no two students from the same class sit adjacent in mixed exams, separates by gender if needed, and places students needing accommodation in front rows.</div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Exam Seating Dashboard', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 2: GET /exam-seating/create — Create Seating Plan
  // ============================================================
  app.get('/exam-seating/create', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const students = (await pool.query(
      `SELECT id, name, class, gender, needs_accommodation FROM students WHERE tenant_id=$1 ORDER BY class, name`, [tid]
    )).rows;
    const classes = [...new Set(students.map(s => s.class).filter(Boolean))].sort();

    const templates = (await pool.query(
      `SELECT * FROM room_layout_templates WHERE tenant_id=$1 OR tenant_id=0 ORDER BY type, name`, [tid]
    )).rows;

    const templateCards = templates.map(t => `<div class="es-template-card" onclick="selectTemplate(${t.id},${t.rows},${t.cols})" id="tmpl-${t.id}">
      <div style="font-size:28px;margin-bottom:8px">${t.type === 'prebuilt' ? '📐' : '✏️'}</div>
      <div style="font-size:14px;font-weight:700;color:#1e293b;margin-bottom:4px">${esc(t.name)}</div>
      <div style="font-size:12px;color:#6b7280">${t.rows} × ${t.cols} (${t.rows * t.cols} seats)</div>
      <div style="font-size:11px;color:#9ca3af;margin-top:4px">${esc(t.description || '')}</div>
    </div>`).join('');

    const classCheckboxes = classes.map(c => {
      const count = students.filter(s => s.class === c).length;
      return `<label style="display:flex;align-items:center;gap:6px;font-size:13px;padding:4px 0;cursor:pointer">
        <input type="checkbox" name="classes" value="${esc(c)}" checked style="accent-color:${P};width:16px;height:16px">
        ${esc(c)} <span style="color:#9ca3af;font-size:11px">(${count})</span>
      </label>`;
    }).join('');

    const html = CSS + nav('create') + `<div style="max-width:900px;margin:0 auto">
      <div class="es-card">
        <h2 style="color:#111827;margin:0 0 4px">✨ Create Seating Plan</h2>
        <p style="font-size:13px;color:#6b7280;margin-bottom:24px">Set up a new exam seating arrangement with smart auto-assignment</p>
        <form method="POST" action="/exam-seating/create" id="planForm" style="display:flex;flex-direction:column;gap:18px">
          <div class="es-grid2">
            <div class="es-fg"><label for="examName">Exam Name *</label>
              <input type="text" name="examName" id="examName" required placeholder="e.g., Mid-Term Mathematics"></div>
            <div class="es-fg"><label for="roomName">Room Name *</label>
              <input type="text" name="roomName" id="roomName" required placeholder="e.g., Hall A"></div>
          </div>
          <div class="es-grid3">
            <div class="es-fg"><label for="rows">Rows *</label>
              <input type="number" name="rows" id="rows" min="1" max="30" value="5" required onchange="updatePreview()"></div>
            <div class="es-fg"><label for="cols">Columns *</label>
              <input type="number" name="cols" id="cols" min="1" max="30" value="6" required onchange="updatePreview()"></div>
            <div class="es-fg"><label>Capacity Preview</label>
              <div id="capacityPreview" style="padding:10px 14px;background:#f0f9ff;border-radius:10px;font-size:15px;font-weight:800;color:${P}">30 seats</div>
            </div>
          </div>
          <div class="es-fg"><label>Room Layout Template (optional)</label>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px;margin-top:8px" id="templateGrid">
              <div class="es-template-card selected-template" onclick="clearTemplate()" id="tmpl-custom">
                <div style="font-size:28px;margin-bottom:8px">✏️</div>
                <div style="font-size:14px;font-weight:700;color:#1e293b">Custom Size</div>
                <div style="font-size:12px;color:#6b7280">Use rows/cols above</div>
              </div>
              ${templateCards}
            </div>
          </div>
          <div class="es-fg"><label>Classes to Include *</label>
            <div style="max-height:200px;overflow-y:auto;padding:8px;border:2px solid #e5e7eb;border-radius:10px">
              ${classCheckboxes || '<p style="color:#9ca3af;padding:10px;text-align:center">No students found. Add students first.</p>'}
            </div>
          </div>
          <div class="es-grid2">
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:10px;border:2px solid #e5e7eb;border-radius:10px">
              <input type="checkbox" name="separateGender" value="1" style="accent-color:${P};width:18px;height:18px">
              <div><strong>Separate by Gender</strong><br><span style="color:#9ca3af;font-size:11px">Alternate male/female rows</span></div>
            </label>
            <label style="display:flex;align-items:center;gap:8px;font-size:13px;cursor:pointer;padding:10px;border:2px solid #e5e7eb;border-radius:10px">
              <input type="checkbox" name="mixedExam" value="1" style="accent-color:${P};width:18px;height:18px">
              <div><strong>Mixed Exam</strong><br><span style="color:#9ca3af;font-size:11px">Avoid same-class adjacent seats</span></div>
            </label>
          </div>
          <div class="es-fg"><label for="notes">Notes</label>
            <textarea name="notes" id="notes" rows="2" placeholder="Any additional instructions..."></textarea></div>
          <div style="display:flex;gap:10px">
            <button type="submit" class="es-btn es-btn-p" style="padding:14px 28px;font-size:15px">🪑 Create & Auto-Assign</button>
            <a href="/exam-seating" class="es-btn es-btn-o">Cancel</a>
          </div>
        </form>
      </div>
      <div class="es-card" id="previewCard">
        <h3 style="color:#111827;margin:0 0 12px">👁️ Live Preview</h3>
        <div id="previewArea" style="overflow-x:auto">${svgRoomGrid(5, 6, null, { title: 'PREVIEW — ' })}</div>
      </div>
    </div>
    <script>
      let selectedTmplId = 'custom';
      function selectTemplate(id, rows, cols) {
        selectedTmplId = id;
        document.querySelectorAll('.es-template-card').forEach(el => el.classList.remove('selected-template'));
        const el = document.getElementById('tmpl-' + id);
        if (el) el.classList.add('selected-template');
        document.getElementById('rows').value = rows;
        document.getElementById('cols').value = cols;
        updatePreview();
      }
      function clearTemplate() {
        selectedTmplId = 'custom';
        document.querySelectorAll('.es-template-card').forEach(el => el.classList.remove('selected-template'));
        document.getElementById('tmpl-custom').classList.add('selected-template');
        updatePreview();
      }
      function updatePreview() {
        const r = parseInt(document.getElementById('rows').value) || 5;
        const c = parseInt(document.getElementById('cols').value) || 6;
        document.getElementById('capacityPreview').textContent = (r * c) + ' seats';
        const area = document.getElementById('previewArea');
        const cellW = Math.max(36, Math.min(72, 800 / (c + 1)));
        const cellH = Math.max(28, Math.min(48, 500 / (r + 2)));
        area.innerHTML = '<img src="data:image/svg+xml,' + encodeURIComponent(\`${svgRoomGrid(r, c, null, { title: 'PREVIEW', cellW, cellH })}\`) + '" style="max-width:100%;height:auto" alt="Room preview">';
      }
      updatePreview();
    </script>`;
    res.send(renderPage('Create Seating Plan', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 3: POST /exam-seating/create — Save Plan & Auto-Assign
  // ============================================================
  app.post('/exam-seating/create', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { examName, roomName, rows, cols, templateId, separateGender, mixedExam, notes } = req.body;
    const classes = Array.isArray(req.body.classes) ? req.body.classes : (req.body.classes ? [req.body.classes] : []);

    if (!examName || !examName.trim()) { req.session.flash = { type: 'error', msg: 'Exam name is required' }; return res.redirect('/exam-seating/create'); }
    if (!roomName || !roomName.trim()) { req.session.flash = { type: 'error', msg: 'Room name is required' }; return res.redirect('/exam-seating/create'); }

    const numRows = parseInt(rows) || 5;
    const numCols = parseInt(cols) || 6;
    const totalSeats = numRows * numCols;

    // Fetch students
    const studentRes = await pool.query(
      `SELECT id, name, class, gender, needs_accommodation FROM students WHERE tenant_id=$1 AND class = ANY($2) ORDER BY class, name`,
      [tid, classes.length ? classes : ['__none__']]
    );
    let allStudents = studentRes.rows;
    if (!classes.length) {
      allStudents = (await pool.query(
        `SELECT id, name, class, gender, needs_accommodation FROM students WHERE tenant_id=$1 ORDER BY class, name`, [tid]
      )).rows;
    }

    // Create seating plan
    const plan = (await pool.query(
      `INSERT INTO exam_seating_plans (tenant_id, exam_name, class_ids, room_name, room_rows, room_cols, template_id, separate_gender, mixed_exam, total_seats, notes, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [tid, examName.trim(), classes, roomName.trim(), numRows, numCols, templateId || null, !!separateGender, !!mixedExam, totalSeats, notes || null, req.session.user.id]
    )).rows[0];

    // Auto-assign seats
    const studentData = allStudents.slice(0, totalSeats).map(s => ({
      id: s.id, name: s.name, cls: s.class, gender: s.gender || '',
      needs_accommodation: s.needs_accommodation || false
    }));
    const grid = autoAssignSeats(studentData, numRows, numCols, {
      separateGender: !!separateGender,
      mixedExam: !!mixedExam,
      accommodationFirst: true
    });

    // Insert seats
    for (let r = 0; r < numRows; r++) {
      for (let c = 0; c < numCols; c++) {
        const student = grid[r][c];
        const label = `R${r + 1}${String.fromCharCode(65 + c)}`;
        await pool.query(
          `INSERT INTO exam_seats (tenant_id, plan_id, row_index, col_index, seat_label, student_id, student_name, student_class, gender, needs_accommodation, is_empty, assigned_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
          [tid, plan.id, r, c, label,
            student ? student.id : null,
            student ? student.name : '',
            student ? (student.cls || '') : '',
            student ? (student.gender || '') : '',
            student ? student.needs_accommodation : false,
            !student
          ]
        );
      }
    }

    // Update assigned count
    await pool.query(`UPDATE exam_seating_plans SET assigned_seats=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
      [studentData.length, plan.id, tid]);

    audit('seating_plan_created', { planId: plan.id, examName: plan.exam_name, rows: numRows, cols: numCols, assigned: studentData.length });
    res.redirect(`/exam-seating/plans/${plan.id}`);
  }));

  // ============================================================
  // ROUTE 4: GET /exam-seating/plans — All Plans
  // ============================================================
  app.get('/exam-seating/plans', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const status = req.query.status || '';
    let where = 'WHERE esp.tenant_id=$1';
    const params = [tid];
    if (status) { where += ` AND esp.status=$2`; params.push(status); }

    const plans = (await pool.query(
      `SELECT esp.*, u.name as creator_name FROM exam_seating_plans esp
       LEFT JOIN users u ON u.id = esp.created_by
       ${where} ORDER BY esp.created_at DESC`, params
    )).rows;

    const rows = plans.map(p => `<tr>
      <td><a href="/exam-seating/plans/${p.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(p.exam_name)}</a></td>
      <td>${esc(p.room_name)}</td>
      <td>${p.room_rows} × ${p.room_cols}</td>
      <td>${p.assigned_seats || 0} / ${p.total_seats || 0}</td>
      <td>${statusBadge(p.status)}</td>
      <td style="font-size:12px;color:#6b7280">${fmtDate(p.created_at)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <a href="/exam-seating/plans/${p.id}" class="es-btn es-btn-o" style="padding:4px 10px;font-size:11px">View</a>
          <a href="/exam-seating/plans/${p.id}/print" class="es-btn es-btn-o" style="padding:4px 10px;font-size:11px">Print</a>
          <form method="POST" action="/exam-seating/plans/${p.id}/archive" style="display:inline" onsubmit="return confirm('Archive this plan?')">
            <button class="es-btn es-btn-o" style="padding:4px 10px;font-size:11px" ${p.status === 'archived' ? 'disabled' : ''}>Archive</button>
          </form>
        </div>
      </td>
    </tr>`).join('');

    const html = CSS + nav('plans') + `<div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <h2 style="color:#111827">📋 All Seating Plans</h2>
        <div style="display:flex;gap:8px;align-items:center">
          <select onchange="location.href='/exam-seating/plans?status='+this.value" style="padding:8px 12px;border:2px solid #e5e7eb;border-radius:10px;font-size:13px">
            <option value="">All Status</option>
            <option value="draft" ${status === 'draft' ? 'selected' : ''}>Draft</option>
            <option value="published" ${status === 'published' ? 'selected' : ''}>Published</option>
            <option value="archived" ${status === 'archived' ? 'selected' : ''}>Archived</option>
          </select>
          <a href="/exam-seating/create" class="es-btn es-btn-p">✨ New Plan</a>
        </div>
      </div>
      <div class="es-card"><div style="overflow-x:auto"><table class="es-tbl">
        <thead><tr><th>Exam</th><th>Room</th><th>Size</th><th>Assigned</th><th>Status</th><th>Created</th><th>Actions</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="7" style="text-align:center;color:#9ca3af;padding:30px">No seating plans found</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('All Seating Plans', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 5: GET /exam-seating/plans/:id — View & Edit Plan (Manual Override)
  // ============================================================
  app.get('/exam-seating/plans/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plan = (await pool.query(`SELECT * FROM exam_seating_plans WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid])).rows[0];
    if (!plan) return res.status(404).send('Plan not found');

    const seats = (await pool.query(
      `SELECT * FROM exam_seats WHERE plan_id=$1 AND tenant_id=$2 ORDER BY row_index, col_index`, [plan.id, tid]
    )).rows;

    // Build seat map
    const seatMap = {};
    seats.forEach(s => { seatMap[`${s.row_index}-${s.col_index}`] = s; });

    // Build interactive grid HTML
    const aisleAfter = Math.floor(plan.room_cols / 2);
    let gridHtml = `<div class="es-room-grid" style="grid-template-columns:repeat(${plan.room_cols}, 1fr)" id="seatGrid">`;
    // Column headers
    for (let c = 0; c < plan.room_cols; c++) {
      gridHtml += `<div class="es-seat-header">${String.fromCharCode(65 + c)}</div>`;
    }
    for (let r = 0; r < plan.room_rows; r++) {
      for (let c = 0; c < plan.room_cols; c++) {
        const key = `${r}-${c}`;
        const seat = seatMap[key];
        const label = `R${r + 1}${String.fromCharCode(65 + c)}`;
        let classes = 'es-seat';
        let content = label;
        let title = 'Empty seat — click to assign';
        if (seat && !seat.is_empty && seat.student_name) {
          classes += ' occupied';
          if (seat.needs_accommodation) classes += ' accommodation';
          content = `<div style="font-size:10px;font-weight:700">${esc(seat.student_name.substring(0, 14))}</div>
            <div style="font-size:8px;color:#6b7280">${esc(seat.student_class || '')}</div>
            <div style="font-size:7px;color:#9ca3af">${label}</div>`;
          title = `${seat.student_name} (${seat.student_class || ''})`;
        } else {
          classes += ' empty-seat';
        }
        gridHtml += `<div class="${classes}" data-row="${r}" data-col="${c}" onclick="handleSeatClick(this)" title="${esc(title)}">${content}</div>`;
      }
    }
    gridHtml += '</div>';

    // Unassigned students
    const assignedIds = seats.filter(s => s.student_id).map(s => s.student_id);
    const unassignedQuery = assignedIds.length
      ? `SELECT id, name, class FROM students WHERE tenant_id=$1 AND id NOT IN (${assignedIds.map((_, i) => `$${i + 2}`).join(',')}) ORDER BY class, name LIMIT 50`
      : `SELECT id, name, class FROM students WHERE tenant_id=$1 ORDER BY class, name LIMIT 50`;
    const unassignedParams = assignedIds.length ? [tid, ...assignedIds] : [tid];
    const unassigned = (await pool.query(unassignedQuery, unassignedParams)).rows;

    const unassignedHtml = unassigned.map(s => `<div style="display:flex;align-items:center;gap:6px;padding:6px 8px;background:#f9fafb;border-radius:8px;font-size:12px;margin-bottom:4px">
      <span style="font-weight:600;color:#1e293b">${esc(s.name)}</span>
      <span style="color:#9ca3af;font-size:11px">${esc(s.class || '')}</span>
    </div>`).join('');

    const occupancyRate = plan.total_seats > 0 ? Math.round((plan.assigned_seats / plan.total_seats) * 100) : 0;
    const html = CSS + nav('plans') + `<div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div>
          <a href="/exam-seating/plans" style="color:#6b7280;font-size:13px;text-decoration:none">← All Plans</a>
          <h2 style="color:#111827;margin:4px 0 0">${esc(plan.exam_name)}</h2>
          <p style="font-size:13px;color:#6b7280">${esc(plan.room_name)} · ${plan.room_rows} × ${plan.room_cols} · ${plan.assigned_seats}/${plan.total_seats} assigned (${occupancyRate}%)</p>
        </div>
        <div style="display:flex;gap:8px">
          <span id="swapStatus" style="padding:8px 14px;border-radius:10px;font-size:12px;font-weight:600;background:#f3f4f6;color:#6b7280;display:none"></span>
          ${plan.status === 'draft' ? `<form method="POST" action="/exam-seating/plans/${plan.id}/publish"><button class="es-btn es-btn-g">✅ Publish</button></form>` : ''}
          <a href="/exam-seating/plans/${plan.id}/print" class="es-btn es-btn-o">🖨️ Print</a>
          <a href="/exam-seating/plans/${plan.id}/reassign" class="es-btn es-btn-y">🔄 Re-assign</a>
        </div>
      </div>
      ${plan.notes ? `<div class="es-alert" style="background:#f0f9ff;color:#0369a1;border:1px solid #bae6fd">📝 ${esc(plan.notes)}</div>` : ''}

      <div class="es-stats" style="margin-bottom:16px">
        <div class="es-stat"><div class="es-stat-n">${plan.total_seats}</div><div class="es-stat-l">Total Seats</div></div>
        <div class="es-stat"><div class="es-stat-n" style="color:${PG}">${plan.assigned_seats || 0}</div><div class="es-stat-l">Assigned</div></div>
        <div class="es-stat"><div class="es-stat-n" style="color:#9ca3af">${plan.total_seats - (plan.assigned_seats || 0)}</div><div class="es-stat-l">Empty</div></div>
        <div class="es-stat"><div class="es-stat-n" style="color:${P}">${occupancyRate}%</div><div class="es-stat-l">Occupancy</div></div>
      </div>

      <div class="es-alert" style="background:#eef2ff;color:${P};border:1px solid ${PL};font-size:12px">
        <strong>💡 Manual Override:</strong> Click an occupied seat to select it (highlighted in red), then click another seat to swap them. Click the same seat again to deselect.
      </div>

      <div class="es-grid2">
        <div class="es-card">
          <h3 style="color:#111827;margin:0 0 12px">🪑 Room Layout</h3>
          <div style="overflow-x:auto">${gridHtml}</div>
        </div>
        <div class="es-card">
          <h3 style="color:#111827;margin:0 0 12px">👥 Unassigned Students</h3>
          <div style="max-height:500px;overflow-y:auto">
            ${unassignedHtml || '<div class="es-empty">All students are assigned</div>'}
          </div>
        </div>
      </div>

      <div class="es-card">
        <h3 style="color:#111827;margin:0 0 12px">📊 SVG Room Preview</h3>
        <div style="overflow-x:auto">${svgRoomGrid(plan.room_rows, plan.room_cols,
          Object.fromEntries(seats.filter(s => !s.is_empty && s.student_name).map(s => [
            `${s.row_index}-${s.col_index}`,
            { name: s.student_name, cls: s.student_class, accommodation: s.needs_accommodation }
          ])),
          { title: esc(plan.room_name.toUpperCase()) + ' — ' + esc(plan.exam_name), cellW: 64, cellH: 42 }
        )}</div>
      </div>
    </div>
    <script>
      let selectedSeat = null;
      function handleSeatClick(el) {
        const row = el.dataset.row;
        const col = el.dataset.col;
        const planId = ${plan.id};
        const statusEl = document.getElementById('swapStatus');

        if (selectedSeat && selectedSeat.row == row && selectedSeat.col == col) {
          // Deselect
          el.classList.remove('selected');
          selectedSeat = null;
          statusEl.style.display = 'none';
          return;
        }

        if (!selectedSeat) {
          // Select first seat
          selectedSeat = { row, col };
          el.classList.add('selected');
          statusEl.style.display = 'inline-block';
          statusEl.style.background = '#fee2e2';
          statusEl.style.color = '#dc2626';
          statusEl.textContent = 'Selected: R' + (parseInt(row)+1) + String.fromCharCode(65+parseInt(col)) + ' — Click another seat to swap';
        } else {
          // Swap seats
          statusEl.style.background = '#fef3c7';
          statusEl.style.color = '#b45309';
          statusEl.textContent = 'Swapping...';

          fetch('/exam-seating/plans/' + planId + '/swap', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: { row: parseInt(selectedSeat.row), col: parseInt(selectedSeat.col) }, to: { row: parseInt(row), col: parseInt(col) } })
          })
          .then(r => r.json())
          .then(data => {
            if (data.ok) {
              location.reload();
            } else {
              statusEl.style.background = '#fee2e2';
              statusEl.style.color = '#dc2626';
              statusEl.textContent = 'Error: ' + (data.error || 'Swap failed');
              selectedSeat = null;
              document.querySelectorAll('.es-seat.selected').forEach(s => s.classList.remove('selected'));
            }
          })
          .catch(() => {
            statusEl.textContent = 'Network error';
            selectedSeat = null;
          });
        }
      }
    </script>`;
    res.send(renderPage('Plan: ' + plan.exam_name, html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 6: POST /exam-seating/plans/:id/swap — Swap Two Seats (Manual Override)
  // ============================================================
  app.post('/exam-seating/plans/:id/swap', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const planId = req.params.id;
    const { from, to } = req.body;
    if (!from || !to) return res.json({ ok: false, error: 'Invalid seat positions' });

    const plan = (await pool.query(`SELECT id FROM exam_seating_plans WHERE id=$1 AND tenant_id=$2`, [planId, tid])).rows[0];
    if (!plan) return res.json({ ok: false, error: 'Plan not found' });

    // Fetch both seats
    const [seatA, seatB] = await Promise.all([
      pool.query(`SELECT * FROM exam_seats WHERE plan_id=$1 AND tenant_id=$2 AND row_index=$3 AND col_index=$4`, [planId, tid, from.row, from.col]),
      pool.query(`SELECT * FROM exam_seats WHERE plan_id=$1 AND tenant_id=$2 AND row_index=$3 AND col_index=$4`, [planId, tid, to.row, to.col])
    ]);

    if (!seatA.rows[0] || !seatB.rows[0]) return res.json({ ok: false, error: 'Seat not found' });
    const a = seatA.rows[0], b = seatB.rows[0];

    // Swap student data
    await pool.query(
      `UPDATE exam_seats SET student_id=$1, student_name=$2, student_class=$3, gender=$4, needs_accommodation=$5, is_empty=$6, manual_override=true, assigned_at=NOW() WHERE id=$7`,
      [b.student_id, b.student_name, b.student_class, b.gender, b.needs_accommodation, b.is_empty, a.id]
    );
    await pool.query(
      `UPDATE exam_seats SET student_id=$1, student_name=$2, student_class=$3, gender=$4, needs_accommodation=$5, is_empty=$6, manual_override=true, assigned_at=NOW() WHERE id=$7`,
      [a.student_id, a.student_name, a.student_class, a.gender, a.needs_accommodation, a.is_empty, b.id]
    );

    audit('seats_swapped', { planId, from: { row: from.row, col: from.col, student: a.student_name }, to: { row: to.row, col: to.col, student: b.student_name } });
    res.json({ ok: true });
  }));

  // ============================================================
  // ROUTE 7: GET /exam-seating/plans/:id/print — Print-Ready View
  // ============================================================
  app.get('/exam-seating/plans/:id/print', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plan = (await pool.query(`SELECT * FROM exam_seating_plans WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid])).rows[0];
    if (!plan) return res.status(404).send('Plan not found');

    const seats = (await pool.query(
      `SELECT * FROM exam_seats WHERE plan_id=$1 AND tenant_id=$2 ORDER BY row_index, col_index`, [plan.id, tid]
    )).rows;

    const seatMap = {};
    seats.forEach(s => { seatMap[`${s.row_index}-${s.col_index}`] = s; });

    // Build print grid
    let gridHtml = '<table style="border-collapse:collapse;margin:0 auto" role="table" aria-label="Seating layout">';
    // Column headers
    gridHtml += '<tr><td style="width:40px"></td>';
    for (let c = 0; c < plan.room_cols; c++) {
      gridHtml += `<td style="text-align:center;font-size:11px;font-weight:700;color:${P};padding:4px;border:1px solid #ccc">${String.fromCharCode(65 + c)}</td>`;
    }
    gridHtml += '</tr>';

    for (let r = 0; r < plan.room_rows; r++) {
      gridHtml += `<tr><td style="font-size:11px;font-weight:700;color:#6b7280;text-align:center;padding:4px;border:1px solid #ccc">R${r + 1}</td>`;
      for (let c = 0; c < plan.room_cols; c++) {
        const key = `${r}-${c}`;
        const seat = seatMap[key];
        const label = `R${r + 1}${String.fromCharCode(65 + c)}`;
        const bg = seat && !seat.is_empty && seat.student_name ? (seat.needs_accommodation ? '#fffbeb' : '#eef2ff') : '#f9fafb';
        const border = seat && !seat.is_empty && seat.student_name ? '#a5b4fc' : '#d1d5db';
        gridHtml += `<td style="width:100px;min-height:44px;padding:4px;background:${bg};border:1px solid ${border};text-align:center;font-size:10px;vertical-align:middle">
          ${seat && !seat.is_empty && seat.student_name
            ? `<div style="font-weight:700;color:#1e293b">${esc(seat.student_name)}</div><div style="color:#6b7280;font-size:8px">${esc(seat.student_class || '')}</div>`
            : `<div style="color:#9ca3af">${label}</div>`}
        </td>`;
      }
      gridHtml += '</tr>';
    }
    gridHtml += '</table>';

    // Legend
    const legendHtml = `<div style="display:flex;gap:16px;margin-top:12px;font-size:10px;justify-content:center">
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#eef2ff;border:1px solid #a5b4fc;border-radius:2px"></div> Assigned</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#fffbeb;border:1px solid #fcd34d;border-radius:2px"></div> Accommodation</div>
      <div style="display:flex;align-items:center;gap:4px"><div style="width:12px;height:12px;background:#f9fafb;border:1px solid #d1d5db;border-radius:2px"></div> Empty</div>
    </div>`;

    const html = CSS + `<div style="max-width:1100px;margin:0 auto;padding:20px">
      <div class="no-print" style="margin-bottom:16px;display:flex;gap:8px;align-items:center">
        <a href="/exam-seating/plans/${plan.id}" class="es-btn es-btn-o">← Back to Plan</a>
        <button class="es-btn es-btn-p" onclick="window.print()">🖨️ Print Plan</button>
      </div>
      <div class="print-header" style="padding:16px 0">
        <div style="display:flex;justify-content:space-between;align-items:start;flex-wrap:wrap;gap:12px">
          <div>
            <h1 style="font-size:22px;color:#111827;margin:0">${esc(plan.exam_name)}</h1>
            <p style="font-size:14px;color:#6b7280;margin-top:4px">Room: <strong>${esc(plan.room_name)}</strong> · Layout: ${plan.room_rows} × ${plan.room_cols} (${plan.total_seats} seats)</p>
            <p style="font-size:13px;color:#6b7280">Students Assigned: <strong>${plan.assigned_seats}</strong> · Date: <strong>${fmtDate(plan.created_at)}</strong></p>
            ${plan.separate_gender ? '<p style="font-size:12px;color:#4f46e5">Gender separation enabled</p>' : ''}
            ${plan.mixed_exam ? '<p style="font-size:12px;color:#4f46e5">Mixed exam — same-class adjacency avoided</p>' : ''}
          </div>
          <div style="text-align:right">
            <div style="font-size:11px;color:#9ca3af">Generated: ${fmtDT(plan.created_at)}</div>
            <div style="font-size:11px;color:#9ca3af">Plan ID: #${plan.id}</div>
          </div>
        </div>
      </div>
      <div style="overflow-x:auto;margin:16px 0">${gridHtml}</div>
      ${legendHtml}
      ${plan.notes ? `<div style="margin-top:16px;padding:10px;background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;font-size:12px;color:#6b7280"><strong>Notes:</strong> ${esc(plan.notes)}</div>` : ''}
      <div style="margin-top:20px;padding-top:12px;border-top:1px solid #e5e7eb;display:flex;justify-content:space-between;font-size:10px;color:#9ca3af">
        <span>Exam Seating Plan — Confidential</span>
        <span>Total Pages: 1</span>
      </div>
    </div>`;
    res.send(renderPage('Print: ' + plan.exam_name, html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 8: POST /exam-seating/plans/:id/publish — Publish Plan
  // ============================================================
  app.post('/exam-seating/plans/:id/publish', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`UPDATE exam_seating_plans SET status='published', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    audit('seating_plan_published', { planId: req.params.id });
    res.redirect(`/exam-seating/plans/${req.params.id}`);
  }));

  // ============================================================
  // ROUTE 9: POST /exam-seating/plans/:id/archive — Archive Plan
  // ============================================================
  app.post('/exam-seating/plans/:id/archive', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`UPDATE exam_seating_plans SET status='archived', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND status != 'archived'`, [req.params.id, tid]);
    audit('seating_plan_archived', { planId: req.params.id });
    res.redirect('/exam-seating/plans');
  }));

  // ============================================================
  // ROUTE 10: GET /exam-seating/plans/:id/reassign — Re-run Auto-Assign
  // ============================================================
  app.get('/exam-seating/plans/:id/reassign', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const plan = (await pool.query(`SELECT * FROM exam_seating_plans WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid])).rows[0];
    if (!plan) return res.status(404).send('Plan not found');

    // Clear existing seats
    await pool.query(`DELETE FROM exam_seats WHERE plan_id=$1 AND tenant_id=$2`, [plan.id, tid]);

    // Re-fetch students
    const classes = plan.class_ids || [];
    const studentRes = classes.length
      ? await pool.query(`SELECT id, name, class, gender, needs_accommodation FROM students WHERE tenant_id=$1 AND class = ANY($2) ORDER BY class, name`, [tid, classes])
      : await pool.query(`SELECT id, name, class, gender, needs_accommodation FROM students WHERE tenant_id=$1 ORDER BY class, name`, [tid]);
    const allStudents = studentRes.rows;
    const totalSeats = plan.room_rows * plan.room_cols;

    // Auto-assign
    const studentData = allStudents.slice(0, totalSeats).map(s => ({
      id: s.id, name: s.name, cls: s.class, gender: s.gender || '',
      needs_accommodation: s.needs_accommodation || false
    }));
    const grid = autoAssignSeats(studentData, plan.room_rows, plan.room_cols, {
      separateGender: plan.separate_gender, mixedExam: plan.mixed_exam, accommodationFirst: true
    });

    for (let r = 0; r < plan.room_rows; r++) {
      for (let c = 0; c < plan.room_cols; c++) {
        const student = grid[r][c];
        await pool.query(
          `INSERT INTO exam_seats (tenant_id, plan_id, row_index, col_index, seat_label, student_id, student_name, student_class, gender, needs_accommodation, is_empty, assigned_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NOW())`,
          [tid, plan.id, r, c, `R${r + 1}${String.fromCharCode(65 + c)}`,
            student ? student.id : null, student ? student.name : '',
            student ? (student.cls || '') : '', student ? (student.gender || '') : '',
            student ? student.needs_accommodation : false, !student]
        );
      }
    }

    await pool.query(`UPDATE exam_seating_plans SET assigned_seats=$1, updated_at=NOW() WHERE id=$2 AND tenant_id=$3`,
      [studentData.length, plan.id, tid]);

    audit('seating_reassigned', { planId: plan.id });
    req.session.flash = { type: 'success', msg: 'Seats re-assigned successfully' };
    res.redirect(`/exam-seating/plans/${plan.id}`);
  }));

  // ============================================================
  // ROUTE 11: GET /exam-seating/templates — Room Layout Templates
  // ============================================================
  app.get('/exam-seating/templates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const templates = (await pool.query(
      `SELECT rlt.*, u.name as creator_name FROM room_layout_templates rlt
       LEFT JOIN users u ON u.id = rlt.created_by
       WHERE rlt.tenant_id=$1 OR rlt.tenant_id=0
       ORDER BY rlt.type, rlt.name`, [tid]
    )).rows;

    const prebuilt = templates.filter(t => t.type === 'prebuilt');
    const custom = templates.filter(t => t.type === 'custom' && t.tenant_id === tid);

    const renderTemplateGrid = (tmpls, title) => {
      if (!tmpls.length) return '';
      let html = `<div class="es-card"><h3 style="color:#111827;margin:0 0 14px">${title}</h3>
        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:14px">`;
      tmpls.forEach(t => {
        html += `<div style="background:#fff;border:2px solid #e5e7eb;border-radius:12px;padding:16px;transition:.15s">
          <div style="display:flex;justify-content:space-between;align-items:start;margin-bottom:8px">
            <div>
              <div style="font-size:15px;font-weight:700;color:#1e293b">${esc(t.name)}</div>
              <div style="font-size:11px;color:#6b7280;margin-top:2px">${esc(t.description || '')}</div>
            </div>
            ${statusBadge(t.type)}
          </div>
          <div style="font-size:24px;font-weight:800;color:${P}">${t.rows} × ${t.cols}</div>
          <div style="font-size:12px;color:#6b7280;margin:4px 0">${t.rows * t.cols} seats</div>
          <div style="overflow-x:auto;margin-top:8px">${svgRoomGrid(
            Math.min(t.rows, 4), Math.min(t.cols, 8), null,
            { title: '', cellW: 24, cellH: 18, showAisle: false }
          )}</div>
          ${t.tenant_id === tid && t.type === 'custom' ? `<form method="POST" action="/exam-seating/templates/${t.id}/delete" style="margin-top:8px" onsubmit="return confirm('Delete this template?')">
            <button class="es-btn es-btn-r" style="padding:4px 10px;font-size:11px">Delete</button>
          </form>` : ''}
        </div>`;
      });
      html += '</div></div>';
      return html;
    };

    const html = CSS + nav('templates') + `<div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="color:#111827">📐 Room Layout Templates</h2>
          <p style="font-size:13px;color:#6b7280">Pre-built and custom room layouts</p>
        </div>
        <button class="es-btn es-btn-p" onclick="document.getElementById('addTemplateForm').style.display='block'">+ Add Custom Template</button>
      </div>

      <div id="addTemplateForm" style="display:none" class="es-card">
        <h3 style="color:#111827;margin:0 0 16px">➕ Add Custom Template</h3>
        <form method="POST" action="/exam-seating/templates" style="display:flex;flex-direction:column;gap:14px">
          <div class="es-grid3">
            <div class="es-fg"><label>Name *</label><input name="name" required placeholder="e.g., Science Lab"></div>
            <div class="es-fg"><label>Rows *</label><input name="rows" type="number" min="1" max="30" value="5" required></div>
            <div class="es-fg"><label>Columns *</label><input name="cols" type="number" min="1" max="30" value="6" required></div>
          </div>
          <div class="es-fg"><label>Description</label><textarea name="description" rows="2" placeholder="Describe this layout..."></textarea></div>
          <div style="display:flex;gap:8px">
            <button type="submit" class="es-btn es-btn-p">Save Template</button>
            <button type="button" class="es-btn es-btn-o" onclick="document.getElementById('addTemplateForm').style.display='none'">Cancel</button>
          </div>
        </form>
      </div>

      ${renderTemplateGrid(prebuilt, '🏗️ Pre-built Templates')}
      ${renderTemplateGrid(custom, '✏️ Custom Templates')}
      ${!templates.length ? '<div class="es-card"><div class="es-empty">No templates found</div></div>' : ''}
    </div>`;
    res.send(renderPage('Room Templates', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 12: POST /exam-seating/templates — Save Custom Template
  // ============================================================
  app.post('/exam-seating/templates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { name, rows, cols, description } = req.body;
    if (!name || !name.trim()) return res.redirect('/exam-seating/templates');
    await pool.query(
      `INSERT INTO room_layout_templates (tenant_id, name, description, rows, cols, type, created_by)
       VALUES ($1,$2,$3,$4,$5,'custom',$6)`,
      [tid, name.trim(), description || null, parseInt(rows) || 5, parseInt(cols) || 6, req.session.user.id]
    );
    audit('template_created', { name: name.trim() });
    res.redirect('/exam-seating/templates');
  }));

  // ============================================================
  // ROUTE 13: POST /exam-seating/templates/:id/delete — Delete Template
  // ============================================================
  app.post('/exam-seating/templates/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM room_layout_templates WHERE id=$1 AND tenant_id=$2 AND type='custom'`, [req.params.id, tid]);
    audit('template_deleted', { id: req.params.id });
    res.redirect('/exam-seating/templates');
  }));

  // ============================================================
  // ROUTE 14: GET /exam-seating/conflicts — Conflict Detection
  // ============================================================
  app.get('/exam-seating/conflicts', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Find students assigned to multiple plans (potential time conflicts)
    const conflictStudents = (await pool.query(
      `SELECT es.student_id, es.student_name,
              ARRAY_AGG(DISTINCT esp.exam_name) AS exam_names,
              ARRAY_AGG(DISTINCT esp.id) AS plan_ids,
              ARRAY_AGG(DISTINCT esp.room_name) AS room_names,
              COUNT(DISTINCT esp.id)::int AS plan_count
       FROM exam_seats es
       JOIN exam_seating_plans esp ON esp.id = es.plan_id
       WHERE es.tenant_id=$1 AND es.student_id IS NOT NULL AND esp.status != 'archived'
       GROUP BY es.student_id, es.student_name
       HAVING COUNT(DISTINCT esp.id) > 1
       ORDER BY plan_count DESC, es.student_name`, [tid]
    )).rows;

    // Plans with overlap (same time slot assumption: same date)
    const overlappingPlans = (await pool.query(
      `SELECT a.id AS id_a, a.exam_name AS name_a, a.room_name AS room_a,
              b.id AS id_b, b.exam_name AS name_b, b.room_name AS room_b,
              a.created_at AS date_a, b.created_at AS date_b
       FROM exam_seating_plans a
       JOIN exam_seating_plans b ON a.id < b.id
       WHERE a.tenant_id=$1 AND b.tenant_id=$1 AND a.status != 'archived' AND b.status != 'archived'
       ORDER BY a.created_at DESC`, [tid]
    )).rows;

    const studentConflictsHtml = conflictStudents.map(c => {
      const examLinks = c.exam_names.map((name, i) =>
        `<a href="/exam-seating/plans/${c.plan_ids[i]}" style="color:${P};text-decoration:none;font-weight:600">${esc(name)}</a>`
      ).join(', ');
      return `<div class="es-conflict">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span style="font-weight:700;color:#991b1b;font-size:14px">${esc(c.student_name)}</span>
            <span style="color:#6b7280;font-size:12px"> — assigned to ${c.plan_count} plans</span>
          </div>
          <span class="es-badge" style="background:#fee2e2;color:#dc2626">⚠️ ${c.plan_count} plans</span>
        </div>
        <div style="margin-top:6px;font-size:13px;color:#374151">Exams: ${examLinks}</div>
        <div style="margin-top:4px;font-size:12px;color:#6b7280">Rooms: ${c.room_names.map(r => esc(r)).join(', ')}</div>
      </div>`;
    }).join('');

    const html = CSS + nav('conflicts') + `<div style="max-width:1000px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div>
          <h2 style="color:#111827">⚠️ Conflict Detection</h2>
          <p style="font-size:13px;color:#6b7280">Detect students with overlapping exam schedules across seating plans</p>
        </div>
        <button class="es-btn es-btn-p" onclick="location.reload()">🔄 Refresh Scan</button>
      </div>

      <div class="es-stats" style="margin-bottom:20px">
        <div class="es-stat"><div class="es-stat-n" style="color:${conflictStudents.length > 0 ? PR : PG}">${conflictStudents.length}</div><div class="es-stat-l">Students with Conflicts</div></div>
        <div class="es-stat"><div class="es-stat-n">${overlappingPlans.length}</div><div class="es-stat-l">Plan Overlaps</div></div>
      </div>

      ${conflictStudents.length === 0
        ? `<div class="es-card"><div class="es-alert es-alert-ok">✅ No scheduling conflicts detected. All students are assigned to a single plan or no active plans exist.</div></div>`
        : `<div class="es-alert es-alert-err">⚠️ ${conflictStudents.length} student(s) found with multiple exam assignments. Review and resolve conflicts below.</div>`
      }

      <div class="es-card">
        <h3 style="color:#111827;margin:0 0 14px">👥 Student Conflicts</h3>
        ${studentConflictsHtml || '<div class="es-empty">No conflicts found</div>'}
      </div>

      ${overlappingPlans.length > 0 ? `<div class="es-card">
        <h3 style="color:#111827;margin:0 0 14px">📋 Active Plan Pairs (Potential Time Overlaps)</h3>
        <div style="overflow-x:auto"><table class="es-tbl">
          <thead><tr><th>Plan A</th><th>Room</th><th>Plan B</th><th>Room</th></tr></thead>
          <tbody>${overlappingPlans.map(p => `<tr>
            <td><a href="/exam-seating/plans/${p.id_a}" style="color:${P};text-decoration:none;font-weight:600">${esc(p.name_a)}</a></td>
            <td>${esc(p.room_a)}</td>
            <td><a href="/exam-seating/plans/${p.id_b}" style="color:${P};text-decoration:none;font-weight:600">${esc(p.name_b)}</a></td>
            <td>${esc(p.room_b)}</td>
          </tr>`).join('')}</tbody>
        </table></div>
      </div>` : ''}
    </div>`;
    res.send(renderPage('Conflict Detection', html, req.session.user, req));
  }));

  // ============================================================
  // ROUTE 15: GET /exam-seating/history — Seating History
  // ============================================================
  app.get('/exam-seating/history', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    const allPlans = (await pool.query(
      `SELECT esp.*, u.name as creator_name,
              (SELECT COUNT(*)::int FROM exam_seats es WHERE es.plan_id = esp.id AND es.student_id IS NOT NULL) AS assigned
       FROM exam_seating_plans esp
       LEFT JOIN users u ON u.id = esp.created_by
       WHERE esp.tenant_id=$1
       ORDER BY esp.created_at DESC LIMIT 200`, [tid]
    )).rows;

    const stats = {
      total: allPlans.length,
      published: allPlans.filter(p => p.status === 'published').length,
      archived: allPlans.filter(p => p.status === 'archived').length,
      totalStudents: allPlans.reduce((s, p) => s + (p.assigned || 0), 0)
    };

    // Monthly breakdown (last 12 months)
    const monthlyBreakdown = {};
    allPlans.forEach(p => {
      const month = p.created_at ? new Date(p.created_at).toLocaleDateString('en-GB', { month: 'short', year: '2-digit' }) : 'Unknown';
      if (!monthlyBreakdown[month]) monthlyBreakdown[month] = { plans: 0, seats: 0 };
      monthlyBreakdown[month].plans++;
      monthlyBreakdown[month].seats += (p.assigned || 0);
    });
    const months = Object.keys(monthlyBreakdown).slice(0, 12);
    const barData = months.map(m => ({ label: m, value: monthlyBreakdown[m].plans, color: P }));

    const rows = allPlans.map(p => `<tr>
      <td><a href="/exam-seating/plans/${p.id}" style="color:${P};text-decoration:none;font-weight:600">${esc(p.exam_name)}</a></td>
      <td>${esc(p.room_name)}</td>
      <td>${p.room_rows} × ${p.room_cols}</td>
      <td>${p.assigned || 0}</td>
      <td>${statusBadge(p.status)}</td>
      <td>${esc(p.creator_name || '—')}</td>
      <td style="font-size:12px;color:#6b7280">${fmtDate(p.created_at)}</td>
      <td>
        <a href="/exam-seating/plans/${p.id}/print" class="es-btn es-btn-o" style="padding:4px 10px;font-size:11px">Print</a>
      </td>
    </tr>`).join('');

    const html = CSS + nav('history') + `<div style="max-width:1200px;margin:0 auto">
      <div style="margin-bottom:20px">
        <h2 style="color:#111827">📜 Seating Plan History</h2>
        <p style="font-size:13px;color:#6b7280">Complete archive of all seating arrangements</p>
      </div>

      <div class="es-stats" style="margin-bottom:20px">
        <div class="es-stat"><div class="es-stat-n">${stats.total}</div><div class="es-stat-l">Total Plans</div></div>
        <div class="es-stat"><div class="es-stat-n" style="color:${PG}">${stats.published}</div><div class="es-stat-l">Published</div></div>
        <div class="es-stat"><div class="es-stat-n" style="color:#6b7280">${stats.archived}</div><div class="es-stat-l">Archived</div></div>
        <div class="es-stat"><div class="es-stat-n" style="color:${P}">${stats.totalStudents}</div><div class="es-stat-l">Total Assignments</div></div>
      </div>

      ${months.length > 0 ? `<div class="es-card">
        <h3 style="color:#111827;margin:0 0 12px">📊 Plans by Month</h3>
        ${svgBar(barData, 600, 120)}
      </div>` : ''}

      <div class="es-card"><div style="overflow-x:auto"><table class="es-tbl">
        <thead><tr><th>Exam</th><th>Room</th><th>Size</th><th>Assigned</th><th>Status</th><th>Created By</th><th>Date</th><th>Action</th></tr></thead>
        <tbody>${rows || '<tr><td colspan="8" style="text-align:center;color:#9ca3af;padding:30px">No seating plans in history</td></tr>'}</tbody>
      </table></div></div>
    </div>`;
    res.send(renderPage('Seating History', html, req.session.user, req));
  }));

  // ============================================================
  // SVG CHART HELPERS
  // ============================================================
  function svgBar(data, w, h) {
    const maxVal = Math.max(...data.map(d => d.value), 1);
    const barW = Math.max(12, (w / data.length) - 12);
    const gap = (w - barW * data.length) / (data.length + 1);
    let bars = '';
    data.forEach((d, i) => {
      const bh = (d.value / maxVal) * (h - 40);
      const x = gap + i * (barW + gap);
      const y = h - 20 - bh;
      bars += `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barW}" height="${bh.toFixed(1)}" rx="4" fill="${d.color || P}" opacity="0.85"><title>${esc(d.label)}: ${d.value}</title></rect>`;
      bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${h - 4}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(d.label.length > 8 ? d.label.slice(0, 8) : d.label)}</text>`;
      bars += `<text x="${(x + barW / 2).toFixed(1)}" y="${(y - 4).toFixed(1)}" text-anchor="middle" font-size="10" font-weight="700" fill="${P}">${d.value}</text>`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Bar chart">${bars}</svg>`;
  }

  function svgDonut(data, w, h) {
    const total = data.reduce((s, d) => s + d.value, 0) || 1;
    const cx = w / 2, cy = h / 2, r = Math.min(w, h) / 2 - 10;
    let cum = 0;
    let arcs = '';
    let legend = '';
    data.forEach(d => {
      const p = d.value / total;
      const x1 = cx + r * Math.cos(2 * Math.PI * cum - Math.PI / 2);
      const y1 = cy + r * Math.sin(2 * Math.PI * cum - Math.PI / 2);
      cum += p;
      const x2 = cx + r * Math.cos(2 * Math.PI * cum - Math.PI / 2);
      const y2 = cy + r * Math.sin(2 * Math.PI * cum - Math.PI / 2);
      const large = p > 0.5 ? 1 : 0;
      arcs += `<path d="M${cx},${cy} L${x1.toFixed(2)},${y1.toFixed(2)} A${r},${r} 0 ${large},1 ${x2.toFixed(2)},${y2.toFixed(2)} Z" fill="${d.color}" stroke="#fff" stroke-width="2"/>`;
      legend += `<div style="display:flex;align-items:center;gap:6px;font-size:12px"><div style="width:10px;height:10px;border-radius:3px;background:${d.color}"></div>${esc(d.label)} (${d.value})</div>`;
    });
    return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img" aria-label="Donut chart">${arcs}<circle cx="${cx}" cy="${cy}" r="${r * 0.55}" fill="#fff"/></svg><div style="display:flex;flex-direction:column;gap:4px;margin-top:8px">${legend}</div>`;
  }

  console.log('[ExamSeating] Module loaded — /exam-seating');
};
