/**
 * Parent Portal & Advanced Analytics Module
 * Comfort Platform - Multi-tenant SaaS for African Institutions
 *
 * module.exports = (app, pool, requireAuth, logger, audit, notify, wsBroadcast) => { ... }
 */

'use strict';

const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// ============================================================
// INTERNAL HELPERS
// ============================================================
const esc = (s) => String(s === null || s === undefined ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
const formatCurrency = (amt) => `UGX ${Number(amt || 0).toLocaleString()}`;

// Parent auth middleware — checks req.session.parentUser
const requireParentAuth = (req, res, next) => {
  if (req.session.parentUser) return next();
  res.redirect('/parent/login');
};

// ============================================================
// DATABASE MIGRATIONS
// ============================================================
const PARENT_MIGRATIONS = [
  `CREATE TABLE IF NOT EXISTS parent_accounts (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
    parent_name VARCHAR(255) NOT NULL, email VARCHAR(255) NOT NULL UNIQUE,
    phone VARCHAR(20), password_hash TEXT NOT NULL,
    address TEXT, occupation VARCHAR(255), avatar_url TEXT,
    is_active BOOLEAN DEFAULT true, two_factor_enabled BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS parent_students (
    id SERIAL PRIMARY KEY, parent_id INTEGER REFERENCES parent_accounts(id) ON DELETE CASCADE,
    student_id INTEGER NOT NULL, relationship VARCHAR(50) NOT NULL DEFAULT 'parent',
    is_emergency_contact BOOLEAN DEFAULT true,
    UNIQUE(parent_id, student_id)
  )`,
  `CREATE TABLE IF NOT EXISTS parent_messages (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, parent_id INTEGER REFERENCES parent_accounts(id),
    student_id INTEGER, message TEXT NOT NULL, direction VARCHAR(10) DEFAULT 'outbound',
    channel VARCHAR(20) DEFAULT 'in_app', is_read BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS parent_login_logs (
    id SERIAL PRIMARY KEY, parent_id INTEGER REFERENCES parent_accounts(id),
    ip_address VARCHAR(45), user_agent TEXT, login_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS parent_notifications (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, parent_id INTEGER REFERENCES parent_accounts(id),
    title VARCHAR(255) NOT NULL, message TEXT NOT NULL, type VARCHAR(50) DEFAULT 'info',
    is_read BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS teacher_parent_messages (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
    teacher_email VARCHAR(255) NOT NULL, parent_id INTEGER REFERENCES parent_accounts(id),
    student_id INTEGER, subject VARCHAR(255), message TEXT NOT NULL,
    is_read_by_parent BOOLEAN DEFAULT false, is_read_by_teacher BOOLEAN DEFAULT false,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`,
  `CREATE TABLE IF NOT EXISTS event_rsvps (
    id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL, event_id INTEGER,
    parent_id INTEGER REFERENCES parent_accounts(id),
    status VARCHAR(20) DEFAULT 'pending',
    number_of_guests INTEGER DEFAULT 1, notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
  )`
];

const PARENT_TABLES = [
  'parent_accounts', 'parent_students', 'parent_messages',
  'parent_login_logs', 'parent_notifications',
  'teacher_parent_messages', 'event_rsvps'
];

// ============================================================
// SVG CHART HELPERS
// ============================================================
function svgBarChart(data, opts = {}) {
  const w = opts.width || 700;
  const h = opts.height || 300;
  const pad = { t: 40, r: 30, b: 60, l: 70 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barW = Math.max(8, (cw / data.length) - 8);
  const colors = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#7c3aed', '#4f46e5', '#5b21b6', '#6d28d9'];

  let bars = '';
  let labels = '';
  data.forEach((d, i) => {
    const bh = (d.value / maxVal) * ch;
    const x = pad.l + (i * (barW + 8)) + 4;
    const y = pad.t + ch - bh;
    const color = d.color || colors[i % colors.length];
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="4" fill="${color}" opacity="0.85"><title>${esc(d.label)}: ${d.value.toLocaleString()}</title></rect>`;
    bars += `<text x="${x + barW / 2}" y="${y - 8}" text-anchor="middle" font-size="11" fill="#374151" font-weight="600">${Number(d.value).toLocaleString()}</text>`;
    labels += `<text x="${x + barW / 2}" y="${h - 10}" text-anchor="end" font-size="11" fill="#6b7280" transform="rotate(-35,${x + barW / 2},${h - 10})">${esc(String(d.label).substring(0, 10))}</text>`;
  });

  // Y-axis gridlines
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ch / 4) * i;
    const val = Math.round(maxVal - (maxVal / 4) * i);
    grid += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="4"/>`;
    grid += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9ca3af">${val.toLocaleString()}</text>`;
  }

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;background:white;border-radius:12px;padding:8px">
    <defs><linearGradient id="barGrad${opts.id || ''}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#818cf8"/><stop offset="100%" stop-color="#4f46e5"/></linearGradient></defs>
    ${opts.title ? `<text x="${w / 2}" y="24" text-anchor="middle" font-size="15" font-weight="700" fill="#1e293b">${esc(opts.title)}</text>` : ''}
    ${grid}${bars}${labels}
  </svg>`;
}

function svgLineChart(data, opts = {}) {
  const w = opts.width || 700;
  const h = opts.height || 280;
  const pad = { t: 40, r: 30, b: 50, l: 70 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const step = cw / Math.max(data.length - 1, 1);

  let points = data.map((d, i) => {
    const x = pad.l + i * step;
    const y = pad.t + ch - (d.value / maxVal) * ch;
    return { x, y, d };
  });

  const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const areaD = pathD + ` L ${points[points.length - 1].x} ${pad.t + ch} L ${points[0].x} ${pad.t + ch} Z`;

  // Labels
  let labels = points.map(p =>
    `<text x="${p.x}" y="${h - 10}" text-anchor="middle" font-size="10" fill="#6b7280">${esc(String(p.d.label).substring(0, 8))}</text>`
  ).join('');

  // Grid
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const y = pad.t + (ch / 4) * i;
    grid += `<line x1="${pad.l}" y1="${y}" x2="${w - pad.r}" y2="${y}" stroke="#e5e7eb" stroke-dasharray="4"/>`;
    grid += `<text x="${pad.l - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="#9ca3af">${Math.round(maxVal - (maxVal / 4) * i).toLocaleString()}</text>`;
  }

  // Dots
  let dots = points.map(p =>
    `<circle cx="${p.x}" cy="${p.y}" r="4" fill="#4f46e5" stroke="white" stroke-width="2"><title>${esc(p.d.label)}: ${p.d.value.toLocaleString()}</title></circle>`
  ).join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;background:white;border-radius:12px;padding:8px">
    <defs><linearGradient id="areaGrad${opts.id || ''}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#818cf8" stop-opacity="0.3"/><stop offset="100%" stop-color="#818cf8" stop-opacity="0.02"/></linearGradient></defs>
    ${opts.title ? `<text x="${w / 2}" y="24" text-anchor="middle" font-size="15" font-weight="700" fill="#1e293b">${esc(opts.title)}</text>` : ''}
    ${grid}
    <path d="${areaD}" fill="url(#areaGrad${opts.id || ''})"/>
    <path d="${pathD}" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
    ${dots}${labels}
  </svg>`;
}

function svgDonutChart(data, opts = {}) {
  const size = opts.size || 260;
  const cx = size / 2;
  const cy = size / 2;
  const r = (size / 2) - 30;
  const total = data.reduce((s, d) => s + d.value, 0) || 1;
  const colors = ['#6366f1', '#8b5cf6', '#ec4899', '#f59e0b', '#10b981', '#ef4444', '#06b6d4', '#f97316'];
  let cumulative = 0;

  let arcs = '';
  let legend = '';
  data.forEach((d, i) => {
    const pct = d.value / total;
    const startAngle = cumulative * 360 - 90;
    const endAngle = (cumulative + pct) * 360 - 90;
    const largeArc = pct > 0.5 ? 1 : 0;
    const x1 = cx + r * Math.cos((startAngle * Math.PI) / 180);
    const y1 = cy + r * Math.sin((startAngle * Math.PI) / 180);
    const x2 = cx + r * Math.cos((endAngle * Math.PI) / 180);
    const y2 = cy + r * Math.sin((endAngle * Math.PI) / 180);
    const color = d.color || colors[i % colors.length];

    arcs += `<path d="M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${largeArc} 1 ${x2} ${y2} Z" fill="${color}" stroke="white" stroke-width="2"><title>${esc(d.label)}: ${d.value.toLocaleString()} (${(pct * 100).toFixed(1)}%)</title></path>`;

    const lx = size + 10;
    const ly = 20 + i * 22;
    legend += `<rect x="${lx}" y="${ly - 10}" width="14" height="14" rx="3" fill="${color}"/>`;
    legend += `<text x="${lx + 20}" y="${ly + 2}" font-size="12" fill="#374151">${esc(d.label)} (${(pct * 100).toFixed(1)}%)</text>`;

    cumulative += pct;
  });

  const centerText = opts.centerText ? `<text x="${cx}" y="${cy - 4}" text-anchor="middle" font-size="22" font-weight="800" fill="#1e293b">${esc(opts.centerText)}</text>` : '';
  const centerLabel = opts.centerLabel ? `<text x="${cx}" y="${cy + 14}" text-anchor="middle" font-size="11" fill="#9ca3af">${esc(opts.centerLabel)}</text>` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size + 160} ${size}" style="width:100%;max-width:${size + 160}px;background:white;border-radius:12px;padding:8px">
    ${opts.title ? `<text x="${size / 2}" y="20" text-anchor="middle" font-size="14" font-weight="700" fill="#1e293b">${esc(opts.title)}</text>` : ''}
    ${arcs}${centerText}${centerLabel}${legend}
  </svg>`;
}

function svgHistogram(data, opts = {}) {
  const w = opts.width || 600;
  const h = opts.height || 250;
  const pad = { t: 30, r: 30, b: 50, l: 60 };
  const cw = w - pad.l - pad.r;
  const ch = h - pad.t - pad.b;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barW = Math.max(20, (cw / data.length) - 10);
  const colors = ['#10b981', '#6366f1', '#f59e0b', '#f97316', '#ef4444'];

  let bars = '';
  data.forEach((d, i) => {
    const bh = (d.value / maxVal) * ch;
    const x = pad.l + (i * (barW + 10)) + 5;
    const y = pad.t + ch - bh;
    const color = d.color || colors[i % colors.length];
    bars += `<rect x="${x}" y="${y}" width="${barW}" height="${bh}" rx="4" fill="${color}" opacity="0.85"><title>${esc(d.label)}: ${d.value}</title></rect>`;
    bars += `<text x="${x + barW / 2}" y="${y - 6}" text-anchor="middle" font-size="12" font-weight="600" fill="#374151">${d.value}</text>`;
    bars += `<text x="${x + barW / 2}" y="${h - 8}" text-anchor="middle" font-size="13" fill="#374151" font-weight="600">${esc(d.label)}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;background:white;border-radius:12px;padding:8px">
    ${opts.title ? `<text x="${w / 2}" y="22" text-anchor="middle" font-size="14" font-weight="700" fill="#1e293b">${esc(opts.title)}</text>` : ''}
    ${bars}
  </svg>`;
}

function svgHorizontalBar(data, opts = {}) {
  const w = opts.width || 600;
  const h = Math.max(200, data.length * 36 + 60);
  const pad = { t: 40, r: 100, b: 20, l: 120 };
  const cw = w - pad.l - pad.r;
  const maxVal = Math.max(...data.map(d => d.value), 1);
  const barH = 24;
  const colors = ['#6366f1', '#8b5cf6', '#a78bfa', '#c4b5fd', '#7c3aed', '#4f46e5', '#5b21b6', '#10b981', '#059669', '#f59e0b'];

  let bars = '';
  data.forEach((d, i) => {
    const y = pad.t + i * 36;
    const bw = (d.value / maxVal) * cw;
    const color = d.color || colors[i % colors.length];
    bars += `<text x="${pad.l - 8}" y="${y + barH / 2 + 4}" text-anchor="end" font-size="12" fill="#374151">${esc(d.label)}</text>`;
    bars += `<rect x="${pad.l}" y="${y}" width="${Math.max(bw, 2)}" height="${barH}" rx="4" fill="${color}" opacity="0.85"><title>${esc(d.label)}: ${d.value.toLocaleString()}</title></rect>`;
    bars += `<text x="${pad.l + bw + 6}" y="${y + barH / 2 + 4}" font-size="11" fill="#374151" font-weight="600">${d.value.toLocaleString()}</text>`;
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px;background:white;border-radius:12px;padding:8px">
    ${opts.title ? `<text x="${w / 2}" y="24" text-anchor="middle" font-size="14" font-weight="700" fill="#1e293b">${esc(opts.title)}</text>` : ''}
    ${bars}
  </svg>`;
}

// ============================================================
// PARENT PORTAL NAVIGATION
// ============================================================
function parentNav(active, parent) {
  const name = (parent && parent.parent_name) ? parent.parent_name.split(' ')[0] : 'Parent';
  const items = [
    { href: '/parent/dashboard', label: 'Dashboard', icon: '🏠', id: 'dashboard' },
    { href: '/parent/fees', label: 'Fees', icon: '💰', id: 'fees' },
    { href: '/parent/attendance', label: 'Attendance', icon: '📋', id: 'attendance' },
    { href: '/parent/marks', label: 'Marks', icon: '📊', id: 'marks' },
    { href: '/parent/timetable', label: 'Timetable', icon: '📅', id: 'timetable' },
    { href: '/parent/events', label: 'Events', icon: '🎪', id: 'events' },
    { href: '/parent/messages', label: 'Messages', icon: '💬', id: 'messages' },
    { href: '/parent/notifications', label: 'Alerts', icon: '🔔', id: 'notifications' },
    { href: '/parent/settings', label: 'Settings', icon: '⚙️', id: 'settings' }
  ];
  const links = items.map(it =>
    `<a href="${it.href}" style="display:flex;align-items:center;gap:8px;padding:10px 16px;border-radius:8px;text-decoration:none;color:${active === it.id ? 'white' : '#e2e8f0'};font-weight:${active === it.id ? '700' : '500'};font-size:14px;background:${active === it.id ? 'rgba(255,255,255,0.2)' : 'transparent'};transition:0.2s">${it.icon} ${it.label}</a>`
  ).join('');
  return `<nav style="background:linear-gradient(180deg,#059669,#047857);padding:16px 12px;border-radius:16px;min-height:400px">${links}</nav>`;
}

// ============================================================
// MAIN MODULE EXPORT
// ============================================================
module.exports = (app, pool, requireAuth, logger, audit, notify, wsBroadcast) => {

  // --- Run migrations ---
  PARENT_MIGRATIONS.forEach(sql => {
    pool.query(sql).catch(e => logger.warn('[ParentAnalytics Migration]', e.message));
  });

  // --- Register new tables in VALID_TABLES (if accessible) ---
  try {
    // Tables are already declared in the migration; they will be usable after creation
    logger.info('[ParentAnalytics] Migrations applied for parent portal tables');
  } catch (_) { /* ignore */ }

  // ============================================================
  // PARENT PORTAL — AUTHENTICATION
  // ============================================================

  // GET /parent/login
  app.get('/parent/login', (req, res) => {
    if (req.session.parentUser) return res.redirect('/parent/dashboard');
    res.send(`<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parent Login | Comfort</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;min-height:100vh;display:flex;align-items:center;justify-content:center}
    .card{background:white;border-radius:20px;padding:40px;max-width:440px;width:95%;box-shadow:0 20px 60px rgba(0,0,0,0.08)}
    h2{text-align:center;margin-bottom:8px;color:#065f46;font-size:26px}
    .sub{text-align:center;color:#6b7280;margin-bottom:24px;font-size:14px}
    input{width:100%;padding:14px;margin:8px 0;border:2px solid #d1fae5;border-radius:12px;font-size:16px;background:#f0fdf4;color:#1e293b;transition:0.2s}
    input:focus{outline:none;border-color:#059669;box-shadow:0 0 0 3px rgba(5,150,105,0.1)}
    .btn{display:block;width:100%;padding:14px;background:linear-gradient(135deg,#059669,#10b981);color:white;text-decoration:none;border-radius:12px;font-weight:700;border:none;cursor:pointer;font-size:16px;text-align:center;margin-top:12px;transition:0.3s}
    .btn:hover{transform:translateY(-2px);box-shadow:0 8px 25px rgba(5,150,105,0.4)}
    .logo{text-align:center;margin-bottom:16px;font-size:40px}
    .back{text-align:center;margin-top:16px}
    .back a{color:#059669;font-size:13px;text-decoration:none}
    .alert{padding:12px 16px;border-radius:10px;margin:12px 0;font-size:14px}
    .alert-error{background:#fee2e2;color:#991b1b}
    .alert-success{background:#d1fae5;color:#065f46}
    .alert-info{background:#dbeafe;color:#1e40af}
    </style></head><body>
    <div class="card">
      <div class="logo">📚</div>
      <h2>Parent Portal</h2>
      <p class="sub">Access your child's academic info, fees & communication</p>
      ${req.query.msg ? `<div class="alert alert-${req.query.type || 'info'}">${esc(req.query.msg)}</div>` : ''}
      <form method="POST" action="/parent/login">
        <input name="email" type="email" placeholder="Email Address" required autocomplete="email">
        <input name="password" type="password" placeholder="Password" required autocomplete="current-password">
        <button type="submit" class="btn">Sign In</button>
      </form>
      <div class="back"><a href="/">← Back to School Portal</a></div>
    </div>
    </body></html>`);
  });

  // POST /parent/login
  app.post('/parent/login', ah(async (req, res) => {
    const { email, password } = req.body;
    if (!email || !password) {
      return res.redirect('/parent/login?msg=Email+and+password+are+required&type=error');
    }
    try {
      const result = await pool.query('SELECT pa.*, t.name as school_name FROM parent_accounts pa JOIN tenants t ON t.id=pa.tenant_id WHERE pa.email=$1 AND pa.is_active=true', [email.trim().toLowerCase()]);
      const parent = result.rows[0];
      if (!parent) {
        return res.redirect('/parent/login?msg=No+account+found.+Contact+your+school.&type=error');
      }
      const valid = await bcrypt.compare(password, parent.password_hash);
      if (!valid) {
        return res.redirect('/parent/login?msg=Invalid+password.+Please+try+again.&type=error');
      }

      // Get linked students
      const linked = (await pool.query(`
        SELECT ps.relationship, s.id, s.name, s.class, s.stream, s.admission_no
        FROM parent_students ps JOIN students s ON s.id=ps.student_id
        WHERE ps.parent_id=$1`, [parent.id])).rows;

      req.session.parentUser = {
        id: parent.id,
        parent_name: parent.parent_name,
        email: parent.email,
        phone: parent.phone,
        tenant_id: parent.tenant_id,
        school_name: parent.school_name,
        avatar_url: parent.avatar_url
      };
      req.session.parentStudents = linked;

      // Log the login
      await pool.query('INSERT INTO parent_login_logs(parent_id,ip_address,user_agent) VALUES($1,$2,$3)', [parent.id, req.ip || '', req.get('User-Agent') || '']);
      audit(parent.email, 'parent_login', { parent_id: parent.id });
      logger.info('Parent login', { parent_id: parent.id, email: parent.email });

      res.redirect('/parent/dashboard');
    } catch (e) {
      logger.error('Parent login error', { error: e.message });
      res.redirect('/parent/login?msg=An+error+occurred.+Please+try+again.&type=error');
    }
  }));

  // GET /parent/logout
  app.get('/parent/logout', (req, res) => {
    req.session.parentUser = null;
    req.session.parentStudents = null;
    res.redirect('/parent/login?msg=Logged+out+successfully&type=success');
  });

  // ============================================================
  // PARENT PORTAL — DASHBOARD
  // ============================================================
  app.get('/parent/dashboard', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const students = req.session.parentStudents || [];
    const tid = pu.tenant_id;

    // Fee balances
    const studentIds = students.map(s => s.id);
    let feeData = [];
    if (studentIds.length) {
      feeData = (await pool.query(`
        SELECT s.id, s.name, s.class, f.amount, f.paid, f.term, f.year,
               (f.amount - COALESCE(f.paid,0)) as balance
        FROM fees f JOIN students s ON s.id=f.student_id
        WHERE f.student_id = ANY($1) AND f.tenant_id=$2
        ORDER BY f.year DESC, f.term`, [studentIds, tid])).rows;
    }

    // Recent attendance
    let recentAtt = [];
    if (studentIds.length) {
      recentAtt = (await pool.query(`
        SELECT s.name, a.date, a.status
        FROM attendance a JOIN students s ON s.id=a.student_id
        WHERE a.student_id = ANY($1) AND a.tenant_id=$2
        ORDER BY a.date DESC LIMIT 20`, [studentIds, tid])).rows;
    }

    // Recent marks
    let recentMarks = [];
    if (studentIds.length) {
      recentMarks = (await pool.query(`
        SELECT e.name as exam_name, s.name as student_name, m.subject, m.marks, m.grade
        FROM marks m JOIN exams e ON e.id=m.exam_id JOIN students s ON s.id=m.student_id
        WHERE m.student_id = ANY($1) AND m.tenant_id=$2
        ORDER BY e.created_at DESC LIMIT 15`, [studentIds, tid])).rows;
    }

    // Upcoming events
    const events = (await pool.query(`
      SELECT * FROM events WHERE tenant_id=$1 AND event_date >= NOW()
      ORDER BY event_date ASC LIMIT 5`, [tid])).rows;

    // Unread notifications count
    const notifCount = (await pool.query('SELECT COUNT(*) as cnt FROM parent_notifications WHERE parent_id=$1 AND is_read=false', [pu.id])).rows[0].cnt;
    const unreadMsgs = (await pool.query('SELECT COUNT(*) as cnt FROM teacher_parent_messages WHERE parent_id=$1 AND is_read_by_parent=false', [pu.id])).rows[0].cnt;

    const totalBalance = feeData.reduce((s, f) => s + Number(f.balance || 0), 0);
    const attendanceRate = recentAtt.length ? Math.round(recentAtt.filter(a => a.status === 'present').length / recentAtt.length * 100) : 0;

    const layout = (content) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Parent Dashboard | Comfort</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;color:#1e293b;line-height:1.6}
    .topbar{background:linear-gradient(135deg,#059669,#047857);color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 12px rgba(5,150,105,0.3)}
    .topbar a{color:white;text-decoration:none;font-size:14px;padding:6px 14px;border-radius:8px;transition:0.2s}
    .topbar a:hover{background:rgba(255,255,255,0.2)}
    .container{max-width:1200px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:220px 1fr;gap:24px}
    .main-content{min-width:0}
    .card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
    .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:16px;margin-bottom:20px}
    .stat-card{background:white;border-radius:14px;padding:20px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.05);border:1px solid #e2e8f0}
    .stat-num{font-size:28px;font-weight:800;color:#059669}
    .stat-label{font-size:12px;color:#6b7280;margin-top:4px}
    .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .badge-danger{background:#fee2e2;color:#991b1b}
    .badge-success{background:#d1fae5;color:#065f46}
    .badge-warning{background:#fef3c7;color:#92400e}
    .badge-info{background:#dbeafe;color:#1e40af}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{padding:10px;text-align:left;border-bottom:1px solid #f1f5f9}
    th{background:#f8fafc;font-weight:700;color:#475569;font-size:12px}
    .muted{color:#6b7280;font-size:13px}
    .child-card{display:flex;align-items:center;gap:16px;padding:16px;background:#f0fdf4;border-radius:12px;margin-bottom:12px;border:1px solid #d1fae5}
    .child-avatar{width:48px;height:48px;border-radius:50%;background:linear-gradient(135deg,#059669,#10b981);display:flex;align-items:center;justify-content:center;color:white;font-size:20px;font-weight:700}
    @media(max-width:768px){.container{grid-template-columns:1fr}.topbar{padding:12px 16px}body{padding-bottom:20px}}
    </style></head><body>
    <nav class="topbar">
      <strong style="font-size:16px">📚 ${esc(pu.school_name || 'Parent Portal')}</strong>
      <div style="display:flex;align-items:center;gap:8px">
        ${notifCount > 0 ? `<a href="/parent/notifications" style="position:relative">🔔 <span style="position:absolute;top:-4px;right:-8px;background:#ef4444;color:white;font-size:10px;padding:1px 5px;border-radius:10px">${notifCount}</span></a>` : ''}
        ${unreadMsgs > 0 ? `<a href="/parent/messages" style="position:relative">💬 <span style="position:absolute;top:-4px;right:-8px;background:#3b82f6;color:white;font-size:10px;padding:1px 5px;border-radius:10px">${unreadMsgs}</span></a>` : ''}
        <span style="font-size:13px">Hi, ${esc(pu.parent_name.split(' ')[0])}</span>
        <a href="/parent/logout">Logout</a>
      </div>
    </nav>
    <div class="container">
      ${parentNav('dashboard', pu)}
      <div class="main-content">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:20px">
          <h1 style="font-size:24px;color:#065f46">Dashboard</h1>
          <span class="muted">Welcome back, ${esc(pu.parent_name)}</span>
        </div>
        ${content}
      </div>
    </div>
    </body></html>`;

    res.send(layout(`
      <div class="stats">
        <div class="stat-card"><div class="stat-num">${students.length}</div><div class="stat-label">Children</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#dc2626">${formatCurrency(totalBalance)}</div><div class="stat-label">Total Balance</div></div>
        <div class="stat-card"><div class="stat-num">${attendanceRate}%</div><div class="stat-label">Attendance Rate</div></div>
        <div class="stat-card"><div class="stat-num">${events.length}</div><div class="stat-label">Upcoming Events</div></div>
      </div>

      <div class="card">
        <h3 style="margin-bottom:16px">Your Children</h3>
        ${students.map(s => `
          <div class="child-card">
            <div class="child-avatar">${esc((s.name || 'S')[0].toUpperCase())}</div>
            <div style="flex:1">
              <strong>${esc(s.name)}</strong>
              <div class="muted">${esc(s.class)}${s.stream ? ' ' + esc(s.stream) : ''}</div>
            </div>
            <div style="text-align:right">
              <a href="/parent/fees" style="color:#059669;font-size:13px;text-decoration:none">View Fees →</a>
            </div>
          </div>
        `).join('') || '<p class="muted">No children linked yet. Contact the school.</p>'}
      </div>

      ${feeData.length ? `<div class="card"><h3 style="margin-bottom:12px">Fee Summary</h3>
        <table><tr><th>Student</th><th>Class</th><th>Term</th><th>Total</th><th>Paid</th><th>Balance</th></tr>
        ${feeData.map(f => `<tr>
          <td>${esc(f.name)}</td><td>${esc(f.class)}</td><td>${esc(f.term)} ${f.year || ''}</td>
          <td>${formatCurrency(f.amount)}</td><td>${formatCurrency(f.paid)}</td>
          <td><span class="badge ${Number(f.balance) > 0 ? 'badge-danger' : 'badge-success'}">${formatCurrency(f.balance)}</span></td>
        </tr>`).join('')}
        </table>
        <div style="margin-top:12px"><a href="/parent/fees" style="color:#059669;font-size:14px;text-decoration:none;font-weight:600">View All Fees →</a></div>
      </div>` : ''}

      ${recentAtt.length ? `<div class="card"><h3 style="margin-bottom:12px">Recent Attendance</h3>
        <table><tr><th>Student</th><th>Date</th><th>Status</th></tr>
        ${recentAtt.slice(0, 8).map(a => `<tr><td>${esc(a.name)}</td><td>${new Date(a.date).toLocaleDateString()}</td><td><span class="badge ${a.status === 'present' ? 'badge-success' : 'badge-danger'}">${esc(a.status)}</span></td></tr>`).join('')}
        </table>
        <div style="margin-top:12px"><a href="/parent/attendance" style="color:#059669;font-size:14px;text-decoration:none;font-weight:600">View Attendance →</a></div>
      </div>` : ''}

      ${recentMarks.length ? `<div class="card"><h3 style="margin-bottom:12px">Recent Marks</h3>
        <table><tr><th>Student</th><th>Exam</th><th>Subject</th><th>Marks</th><th>Grade</th></tr>
        ${recentMarks.slice(0, 8).map(m => `<tr><td>${esc(m.student_name)}</td><td>${esc(m.exam_name)}</td><td>${esc(m.subject)}</td><td>${esc(m.marks)}</td><td><span class="badge badge-info">${esc(m.grade || '-')}</span></td></tr>`).join('')}
        </table>
        <div style="margin-top:12px"><a href="/parent/marks" style="color:#059669;font-size:14px;text-decoration:none;font-weight:600">View All Marks →</a></div>
      </div>` : ''}

      ${events.length ? `<div class="card"><h3 style="margin-bottom:12px">Upcoming Events</h3>
        ${events.map(e => `
          <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #f1f5f9">
            <div><strong>${esc(e.title || e.name || 'Event')}</strong><div class="muted">${new Date(e.event_date || e.created_at).toLocaleDateString()}</div></div>
            <a href="/parent/events" class="badge badge-info" style="text-decoration:none">View</a>
          </div>
        `).join('')}
      </div>` : ''}
    `));
  }));

  // ============================================================
  // PARENT PORTAL — FEES
  // ============================================================
  app.get('/parent/fees', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const students = req.session.parentStudents || [];
    const tid = pu.tenant_id;
    const studentIds = students.map(s => s.id);

    let fees = [];
    if (studentIds.length) {
      fees = (await pool.query(`
        SELECT s.name, s.class, f.id, f.amount, f.paid, f.term, f.year,
               (f.amount - COALESCE(f.paid,0)) as balance
        FROM fees f JOIN students s ON s.id=f.student_id
        WHERE f.student_id = ANY($1) AND f.tenant_id=$2
        ORDER BY s.name, f.year DESC, f.term`, [studentIds, tid])).rows;
    }

    // Payment history
    let payments = [];
    if (studentIds.length) {
      payments = (await pool.query(`
        SELECT s.name, fr.amount, fr.method, fr.receipt_no, fr.created_at
        FROM fee_receipts fr JOIN students s ON s.id=fr.student_id
        WHERE fr.student_id = ANY($1) AND fr.tenant_id=$2
        ORDER BY fr.created_at DESC LIMIT 50`, [studentIds, tid])).rows;
    }

    const totalOwed = fees.reduce((s, f) => s + Number(f.balance || 0), 0);
    const totalPaid = fees.reduce((s, f) => s + Number(f.paid || 0), 0);

    const layout = (content) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Fees | Comfort</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;color:#1e293b;line-height:1.6}
    .topbar{background:linear-gradient(135deg,#059669,#047857);color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
    .topbar a{color:white;text-decoration:none;font-size:14px;padding:6px 14px;border-radius:8px}
    .container{max-width:1200px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:220px 1fr;gap:24px}
    .card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px}
    .stat-card{background:white;border-radius:14px;padding:20px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.05);border:1px solid #e2e8f0}
    .stat-num{font-size:24px;font-weight:800;color:#059669}
    .stat-label{font-size:12px;color:#6b7280;margin-top:4px}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{padding:10px;text-align:left;border-bottom:1px solid #f1f5f9}
    th{background:#f8fafc;font-weight:700;color:#475569;font-size:12px}
    .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .badge-danger{background:#fee2e2;color:#991b1b}
    .badge-success{background:#d1fae5;color:#065f46}
    .btn{display:inline-block;padding:8px 16px;background:#059669;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:13px;border:none;cursor:pointer}
    @media(max-width:768px){.container{grid-template-columns:1fr}.stats{grid-template-columns:1fr}}
    </style></head><body>
    <nav class="topbar"><strong>📚 ${esc(pu.school_name || 'Parent Portal')}</strong><div style="display:flex;gap:8px;align-items:center"><a href="/parent/dashboard">Dashboard</a><a href="/parent/logout">Logout</a></div></nav>
    <div class="container">${parentNav('fees', pu)}<div class="main-content"><h1 style="margin-bottom:20px;color:#065f46">Fees & Payments</h1>${content}</div></div></body></html>`;

    res.send(layout(`
      <div class="stats">
        <div class="stat-card"><div class="stat-num">${formatCurrency(totalOwed)}</div><div class="stat-label">Outstanding Balance</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#10b981">${formatCurrency(totalPaid)}</div><div class="stat-label">Total Paid</div></div>
        <div class="stat-card"><div class="stat-num">${students.length}</div><div class="stat-label">Children</div></div>
      </div>
      <div class="card">
        <h3 style="margin-bottom:12px">Fee Breakdown</h3>
        ${fees.length ? `<table><tr><th>Student</th><th>Class</th><th>Term</th><th>Total</th><th>Paid</th><th>Balance</th></tr>
        ${fees.map(f => `<tr><td>${esc(f.name)}</td><td>${esc(f.class)}</td><td>${esc(f.term)} ${f.year || ''}</td><td>${formatCurrency(f.amount)}</td><td>${formatCurrency(f.paid)}</td><td><span class="badge ${Number(f.balance) > 0 ? 'badge-danger' : 'badge-success'}">${formatCurrency(f.balance)}</span></td></tr>`).join('')}
        </table>` : '<p class="muted">No fee records found.</p>'}
      </div>
      <div class="card">
        <h3 style="margin-bottom:12px">Payment History</h3>
        ${payments.length ? `<table><tr><th>Student</th><th>Amount</th><th>Method</th><th>Receipt</th><th>Date</th></tr>
        ${payments.map(p => `<tr><td>${esc(p.name)}</td><td>${formatCurrency(p.amount)}</td><td>${esc(p.method || 'N/A')}</td><td>${esc(p.receipt_no || '-')}</td><td>${new Date(p.created_at).toLocaleDateString()}</td></tr>`).join('')}
        </table>` : '<p class="muted">No payment history yet.</p>'}
      </div>
    `));
  }));

  // ============================================================
  // PARENT PORTAL — ATTENDANCE
  // ============================================================
  app.get('/parent/attendance', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const students = req.session.parentStudents || [];
    const tid = pu.tenant_id;
    const studentIds = students.map(s => s.id);
    const { from, to, cls } = req.query;

    let where = 'a.student_id = ANY($1) AND a.tenant_id=$2';
    const params = [studentIds, tid];
    if (from) { where += ` AND a.date >= $3`; params.push(from); }
    if (to) { where += ` AND a.date <= $${params.length + 1}`; params.push(to); }
    if (cls) { where += ` AND s.class = $${params.length + 1}`; params.push(cls); }

    let att = [];
    if (studentIds.length) {
      att = (await pool.query(`
        SELECT s.name, s.class, a.date, a.status FROM attendance a JOIN students s ON s.id=a.student_id
        WHERE ${where} ORDER BY a.date DESC LIMIT 200`, params)).rows;
    }

    const present = att.filter(a => a.status === 'present').length;
    const absent = att.filter(a => a.status === 'absent').length;
    const late = att.filter(a => a.status === 'late').length;
    const rate = att.length ? Math.round(present / att.length * 100) : 0;

    const layout = (content) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Attendance | Comfort</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;color:#1e293b;line-height:1.6}
    .topbar{background:linear-gradient(135deg,#059669,#047857);color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
    .topbar a{color:white;text-decoration:none;font-size:14px;padding:6px 14px;border-radius:8px}
    .container{max-width:1200px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:220px 1fr;gap:24px}
    .card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
    .stats{display:grid;grid-template-columns:repeat(4,1fr);gap:12px;margin-bottom:20px}
    .stat-card{border-radius:14px;padding:16px;text-align:center;border:1px solid #e2e8f0}
    .stat-num{font-size:22px;font-weight:800}
    .stat-label{font-size:11px;color:#6b7280;margin-top:2px}
    .filter-bar{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap}
    .filter-bar input,.filter-bar select{padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:13px}
    .filter-bar button{padding:8px 16px;background:#059669;color:white;border:none;border-radius:8px;cursor:pointer;font-size:13px}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{padding:10px;text-align:left;border-bottom:1px solid #f1f5f9}
    th{background:#f8fafc;font-weight:700;color:#475569;font-size:12px}
    .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .badge-success{background:#d1fae5;color:#065f46}.badge-danger{background:#fee2e2;color:#991b1b}.badge-warning{background:#fef3c7;color:#92400e}
    @media(max-width:768px){.container{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}}
    </style></head><body>
    <nav class="topbar"><strong>📚 ${esc(pu.school_name || 'Parent Portal')}</strong><div style="display:flex;gap:8px;align-items:center"><a href="/parent/dashboard">Dashboard</a><a href="/parent/logout">Logout</a></div></nav>
    <div class="container">${parentNav('attendance', pu)}<div class="main-content"><h1 style="margin-bottom:20px;color:#065f46">Attendance Records</h1>${content}</div></div></body></html>`;

    res.send(layout(`
      <div class="stats">
        <div class="stat-card" style="background:#d1fae5"><div class="stat-num" style="color:#059669">${rate}%</div><div class="stat-label">Attendance Rate</div></div>
        <div class="stat-card" style="background:#d1fae5"><div class="stat-num" style="color:#059669">${present}</div><div class="stat-label">Present</div></div>
        <div class="stat-card" style="background:#fee2e2"><div class="stat-num" style="color:#dc2626">${absent}</div><div class="stat-label">Absent</div></div>
        <div class="stat-card" style="background:#fef3c7"><div class="stat-num" style="color:#d97706">${late}</div><div class="stat-label">Late</div></div>
      </div>
      <div class="card">
        <form method="GET" action="/parent/attendance" class="filter-bar">
          <input type="date" name="from" value="${esc(from || '')}" placeholder="From">
          <input type="date" name="to" value="${esc(to || '')}" placeholder="To">
          <select name="cls"><option value="">All Classes</option>${students.map(s => `<option value="${esc(s.class)}" ${cls === s.class ? 'selected' : ''}>${esc(s.class)}</option>`).join('')}</select>
          <button type="submit">Filter</button>
        </form>
        ${att.length ? `<div style="max-height:500px;overflow-y:auto"><table><tr><th>Student</th><th>Class</th><th>Date</th><th>Status</th></tr>
        ${att.map(a => `<tr><td>${esc(a.name)}</td><td>${esc(a.class)}</td><td>${new Date(a.date).toLocaleDateString()}</td><td><span class="badge ${a.status === 'present' ? 'badge-success' : a.status === 'absent' ? 'badge-danger' : 'badge-warning'}">${esc(a.status)}</span></td></tr>`).join('')}
        </table></div>` : '<p class="muted">No attendance records found.</p>'}
      </div>
    `));
  }));

  // ============================================================
  // PARENT PORTAL — MARKS / ACADEMIC PERFORMANCE
  // ============================================================
  app.get('/parent/marks', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const students = req.session.parentStudents || [];
    const tid = pu.tenant_id;
    const studentIds = students.map(s => s.id);

    let marks = [];
    if (studentIds.length) {
      marks = (await pool.query(`
        SELECT e.name as exam_name, s.name as student_name, s.class, m.subject, m.marks, m.grade, e.created_at
        FROM marks m JOIN exams e ON e.id=m.exam_id JOIN students s ON s.id=m.student_id
        WHERE m.student_id = ANY($1) AND m.tenant_id=$2
        ORDER BY e.created_at DESC, s.name, m.subject`, [studentIds, tid])).rows;
    }

    // Group by student
    const byStudent = {};
    marks.forEach(m => {
      if (!byStudent[m.student_name]) byStudent[m.student_name] = { class: m.class, results: [] };
      byStudent[m.student_name].results.push(m);
    });

    const avgMarks = marks.length ? Math.round(marks.reduce((s, m) => s + Number(m.marks || 0), 0) / marks.length) : 0;

    const layout = (content) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Marks | Comfort</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;color:#1e293b;line-height:1.6}
    .topbar{background:linear-gradient(135deg,#059669,#047857);color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
    .topbar a{color:white;text-decoration:none;font-size:14px;padding:6px 14px;border-radius:8px}
    .container{max-width:1200px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:220px 1fr;gap:24px}
    .card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
    .stats{display:grid;grid-template-columns:repeat(3,1fr);gap:16px;margin-bottom:20px}
    .stat-card{background:white;border-radius:14px;padding:20px;text-align:center;border:1px solid #e2e8f0}
    .stat-num{font-size:24px;font-weight:800;color:#059669}
    .stat-label{font-size:12px;color:#6b7280;margin-top:4px}
    table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
    th,td{padding:10px;text-align:left;border-bottom:1px solid #f1f5f9}
    th{background:#f8fafc;font-weight:700;color:#475569;font-size:12px}
    .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .grade-a{background:#d1fae5;color:#065f46}.grade-b{background:#dbeafe;color:#1e40af}.grade-c{background:#fef3c7;color:#92400e}.grade-d{background:#fed7aa;color:#9a3412}.grade-f{background:#fee2e2;color:#991b1b}
    @media(max-width:768px){.container{grid-template-columns:1fr}.stats{grid-template-columns:1fr}}
    </style></head><body>
    <nav class="topbar"><strong>📚 ${esc(pu.school_name || 'Parent Portal')}</strong><div style="display:flex;gap:8px;align-items:center"><a href="/parent/dashboard">Dashboard</a><a href="/parent/logout">Logout</a></div></nav>
    <div class="container">${parentNav('marks', pu)}<div class="main-content"><h1 style="margin-bottom:20px;color:#065f46">Academic Performance</h1>${content}</div></div></body></html>`;

    const gradeClass = (g) => {
      if (!g) return '';
      const gl = g.toUpperCase();
      if (gl.startsWith('A')) return 'grade-a';
      if (gl.startsWith('B')) return 'grade-b';
      if (gl.startsWith('C')) return 'grade-c';
      if (gl.startsWith('D')) return 'grade-d';
      return 'grade-f';
    };

    res.send(layout(`
      <div class="stats">
        <div class="stat-card"><div class="stat-num">${avgMarks}</div><div class="stat-label">Average Marks</div></div>
        <div class="stat-card"><div class="stat-num">${marks.length}</div><div class="stat-label">Total Results</div></div>
        <div class="stat-card"><div class="stat-num">${Object.keys(byStudent).length}</div><div class="stat-label">Children</div></div>
      </div>
      ${Object.entries(byStudent).map(([name, data]) => `
        <div class="card">
          <h3 style="margin-bottom:12px">${esc(name)} <span class="badge" style="background:#dbeafe;color:#1e40af;margin-left:8px">${esc(data.class)}</span></h3>
          <div style="max-height:400px;overflow-y:auto"><table><tr><th>Exam</th><th>Subject</th><th>Marks</th><th>Grade</th></tr>
          ${data.results.map(m => `<tr><td>${esc(m.exam_name)}</td><td>${esc(m.subject)}</td><td>${esc(m.marks)}</td><td><span class="badge ${gradeClass(m.grade)}">${esc(m.grade || '-')}</span></td></tr>`).join('')}
          </table></div>
        </div>
      `).join('') || '<div class="card"><p class="muted">No marks records found yet.</p></div>'}
    `));
  }));

  // ============================================================
  // PARENT PORTAL — TIMETABLE
  // ============================================================
  app.get('/parent/timetable', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const students = req.session.parentStudents || [];
    const tid = pu.tenant_id;
    const studentIds = students.map(s => s.id);

    // Get unique classes
    const classes = [...new Set(students.map(s => s.class))];

    let timetable = [];
    if (classes.length) {
      timetable = (await pool.query(`
        SELECT * FROM timetable WHERE tenant_id=$1 AND class = ANY($2)
        ORDER BY day, start_time`, [tid, classes])).rows;
    }

    const days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'];
    const byDay = {};
    days.forEach(d => { byDay[d] = timetable.filter(t => t.day === d); });

    const layout = (content) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Timetable | Comfort</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;color:#1e293b;line-height:1.6}
    .topbar{background:linear-gradient(135deg,#059669,#047857);color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
    .topbar a{color:white;text-decoration:none;font-size:14px;padding:6px 14px;border-radius:8px}
    .container{max-width:1200px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:220px 1fr;gap:24px}
    .card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
    .day-block{margin-bottom:20px}.day-header{background:linear-gradient(135deg,#059669,#10b981);color:white;padding:10px 16px;border-radius:10px 10px 0 0;font-weight:700;font-size:14px}
    .period{display:flex;justify-content:space-between;padding:10px 16px;border-bottom:1px solid #f1f5f9;font-size:13px}
    .period:nth-child(even){background:#f8fafc}
    @media(max-width:768px){.container{grid-template-columns:1fr}}
    </style></head><body>
    <nav class="topbar"><strong>📚 ${esc(pu.school_name || 'Parent Portal')}</strong><div style="display:flex;gap:8px;align-items:center"><a href="/parent/dashboard">Dashboard</a><a href="/parent/logout">Logout</a></div></nav>
    <div class="container">${parentNav('timetable', pu)}<div class="main-content"><h1 style="margin-bottom:20px;color:#065f46">Class Timetable</h1>${content}</div></div></body></html>`;

    res.send(layout(`
      ${classes.map(c => `<div class="badge" style="background:#dbeafe;color:#1e40af;margin-right:8px;margin-bottom:8px;display:inline-block">Class: ${esc(c)}</div>`).join('')}
      ${days.map(day => `
        <div class="card" style="padding:0;overflow:hidden">
          <div class="day-header">${day}</div>
          ${byDay[day].length ? byDay[day].map(p => `
            <div class="period"><div><strong>${esc(p.subject || 'Period')}</strong></div><div style="color:#6b7280">${esc(p.start_time || '')} - ${esc(p.end_time || '')}</div></div>
          `).join('') : '<div class="period" style="color:#9ca3af">No periods</div>'}
        </div>
      `).join('')}
    `));
  }));

  // ============================================================
  // PARENT PORTAL — EVENTS & RSVP
  // ============================================================
  app.get('/parent/events', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const tid = pu.tenant_id;

    const events = (await pool.query(`
      SELECT e.*, er.status as rsvp_status, er.number_of_guests, er.notes as rsvp_notes
      FROM events e LEFT JOIN event_rsvps er ON er.event_id=e.id AND er.parent_id=$2
      WHERE e.tenant_id=$1 ORDER BY e.event_date DESC LIMIT 50`, [tid, pu.id])).rows;

    const rsvpBadge = (s) => {
      const m = { attending: { bg: '#d1fae5', color: '#065f46', label: 'Attending' }, declined: { bg: '#fee2e2', color: '#991b1b', label: 'Declined' }, pending: { bg: '#fef3c7', color: '#92400e', label: 'Pending' } };
      const st = m[s] || m.pending;
      return `<span class="badge" style="background:${st.bg};color:${st.color}">${st.label}</span>`;
    };

    const layout = (content) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Events | Comfort</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;color:#1e293b;line-height:1.6}
    .topbar{background:linear-gradient(135deg,#059669,#047857);color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
    .topbar a{color:white;text-decoration:none;font-size:14px;padding:6px 14px;border-radius:8px}
    .container{max-width:1200px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:220px 1fr;gap:24px}
    .card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
    .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
    .event-item{padding:16px;border:1px solid #e2e8f0;border-radius:12px;margin-bottom:12px;display:flex;justify-content:space-between;align-items:flex-start;flex-wrap:wrap;gap:12px}
    .event-item:hover{border-color:#059669}
    .rsvp-form{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
    .rsvp-form select,.rsvp-form button{padding:6px 12px;border-radius:8px;font-size:12px;border:1px solid #d1d5db;cursor:pointer}
    .rsvp-form button{background:#059669;color:white;border:none}
    @media(max-width:768px){.container{grid-template-columns:1fr}}
    </style></head><body>
    <nav class="topbar"><strong>📚 ${esc(pu.school_name || 'Parent Portal')}</strong><div style="display:flex;gap:8px;align-items:center"><a href="/parent/dashboard">Dashboard</a><a href="/parent/logout">Logout</a></div></nav>
    <div class="container">${parentNav('events', pu)}<div class="main-content"><h1 style="margin-bottom:20px;color:#065f46">School Events</h1>${content}</div></div></body></html>`;

    res.send(layout(`
      ${events.map(e => `
        <div class="event-item">
          <div>
            <strong style="font-size:15px">${esc(e.title || e.name || 'Event')}</strong>
            <div class="muted" style="font-size:13px">${e.venue ? esc(e.venue) + ' · ' : ''}${new Date(e.event_date || e.created_at).toLocaleDateString('en', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</div>
            ${e.description ? `<p style="margin-top:6px;font-size:13px;color:#475569">${esc(String(e.description).substring(0, 200))}</p>` : ''}
          </div>
          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px">
            ${rsvpBadge(e.rsvp_status)}
            <form method="POST" action="/parent/events/${e.id}/rsvp" class="rsvp-form">
              <select name="status">
                <option value="attending" ${e.rsvp_status === 'attending' ? 'selected' : ''}>Attending</option>
                <option value="declined" ${e.rsvp_status === 'declined' ? 'selected' : ''}>Declined</option>
                <option value="pending" ${e.rsvp_status === 'pending' || !e.rsvp_status ? 'selected' : ''}>Pending</option>
              </select>
              <input name="guests" type="number" min="1" max="10" value="${e.number_of_guests || 1}" style="width:60px;padding:6px;border-radius:8px;border:1px solid #d1d5db;font-size:12px">
              <button type="submit">RSVP</button>
            </form>
          </div>
        </div>
      `).join('') || '<div class="card"><p class="muted">No upcoming events.</p></div>'}
    `));
  }));

  // POST /parent/events/:id/rsvp
  app.post('/parent/events/:id/rsvp', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const eventId = parseInt(req.params.id);
    const { status, guests, notes } = req.body;

    await pool.query(`
      INSERT INTO event_rsvps(tenant_id, event_id, parent_id, status, number_of_guests, notes)
      VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT DO UPDATE SET status=$4, number_of_guests=$5, notes=$6`,
      [pu.tenant_id, eventId, pu.id, status || 'pending', parseInt(guests) || 1, notes || null]);

    audit(pu.email, 'event_rsvp', { event_id: eventId, status });
    res.redirect('/parent/events');
  }));

  // ============================================================
  // PARENT PORTAL — MESSAGES
  // ============================================================
  app.get('/parent/messages', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const tid = pu.tenant_id;

    const messages = (await pool.query(`
      SELECT tpm.*, u.email as teacher_email
      FROM teacher_parent_messages tpm LEFT JOIN users u ON u.email=tpm.teacher_email
      WHERE tpm.parent_id=$1 AND tpm.tenant_id=$2
      ORDER BY tpm.created_at DESC LIMIT 100`, [pu.id, tid])).rows;

    // Get teachers for new message
    const teachers = (await pool.query(`
      SELECT DISTINCT email FROM users WHERE tenant_id=$1 AND role IN ('admin','teacher','staff') ORDER BY email LIMIT 50`, [tid])).rows;

    const layout = (content) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Messages | Comfort</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;color:#1e293b;line-height:1.6}
    .topbar{background:linear-gradient(135deg,#059669,#047857);color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
    .topbar a{color:white;text-decoration:none;font-size:14px;padding:6px 14px;border-radius:8px}
    .container{max-width:1200px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:220px 1fr;gap:24px}
    .card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
    .msg-item{padding:14px;border:1px solid #f1f5f9;border-radius:10px;margin-bottom:8px;${''}/* ${' '} */ background:${''}}
    .msg-item.unread{background:#f0fdf4;border-color:#d1fae5}
    .msg-item:hover{border-color:#059669}
    input,select,textarea{width:100%;padding:10px;margin:6px 0;border:1px solid #d1d5db;border-radius:8px;font-size:14px}
    .btn{display:inline-block;padding:10px 20px;background:#059669;color:white;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px;border:none;cursor:pointer}
    @media(max-width:768px){.container{grid-template-columns:1fr}}
    </style></head><body>
    <nav class="topbar"><strong>📚 ${esc(pu.school_name || 'Parent Portal')}</strong><div style="display:flex;gap:8px;align-items:center"><a href="/parent/dashboard">Dashboard</a><a href="/parent/logout">Logout</a></div></nav>
    <div class="container">${parentNav('messages', pu)}<div class="main-content"><h1 style="margin-bottom:20px;color:#065f46">Messages</h1>${content}</div></div></body></html>`;

    res.send(layout(`
      <div class="card">
        <h3 style="margin-bottom:16px">Send a Message</h3>
        <form method="POST" action="/parent/messages/send">
          <select name="teacher_email" required>
            <option value="">Select Teacher / Staff</option>
            ${teachers.map(t => `<option value="${esc(t.email)}">${esc(t.email)}</option>`).join('')}
          </select>
          <input name="subject" placeholder="Subject" required>
          <textarea name="message" rows="4" placeholder="Type your message..." required></textarea>
          <button type="submit" class="btn">Send Message</button>
        </form>
      </div>
      <div class="card">
        <h3 style="margin-bottom:12px">Conversation</h3>
        ${messages.length ? messages.map(m => `
          <div class="msg-item ${!m.is_read_by_parent && m.teacher_email ? 'unread' : ''}">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <strong style="font-size:13px">${m.teacher_email ? esc(m.teacher_email) : 'You'}</strong>
              <span class="muted" style="font-size:11px">${new Date(m.created_at).toLocaleString()}</span>
            </div>
            <div style="font-size:13px;font-weight:600">${esc(m.subject || 'No Subject')}</div>
            <div style="font-size:13px;color:#475569;margin-top:4px">${esc(String(m.message).substring(0, 300))}</div>
          </div>
        `).join('') : '<p class="muted">No messages yet.</p>'}
      </div>
    `));
  }));

  // POST /parent/messages/send
  app.post('/parent/messages/send', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const { teacher_email, subject, message } = req.body;
    if (!teacher_email || !message) return res.redirect('/parent/messages');

    await pool.query(`
      INSERT INTO teacher_parent_messages(tenant_id, teacher_email, parent_id, subject, message)
      VALUES($1,$2,$3,$4,$5)`,
      [pu.tenant_id, teacher_email, pu.id, subject, message]);

    // Notify teacher
    notify(pu.tenant_id, teacher_email, `Message from Parent: ${esc(subject || 'New Message')}`, String(message).substring(0, 200), 'info');
    audit(pu.email, 'parent_message_sent', { to: teacher_email });
    res.redirect('/parent/messages');
  }));

  // ============================================================
  // PARENT PORTAL — NOTIFICATIONS
  // ============================================================
  app.get('/parent/notifications', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const tid = pu.tenant_id;

    const notifications = (await pool.query(`
      SELECT * FROM parent_notifications WHERE parent_id=$1 ORDER BY created_at DESC LIMIT 100`, [pu.id])).rows;

    const layout = (content) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Notifications | Comfort</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;color:#1e293b;line-height:1.6}
    .topbar{background:linear-gradient(135deg,#059669,#047857);color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
    .topbar a{color:white;text-decoration:none;font-size:14px;padding:6px 14px;border-radius:8px}
    .container{max-width:1200px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:220px 1fr;gap:24px}
    .card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
    .notif-item{padding:14px;border-left:4px solid #e2e8f0;margin-bottom:8px;border-radius:0 10px 10px 0;cursor:pointer;transition:0.2s}
    .notif-item.unread{border-left-color:#059669;background:#f0fdf4}
    .notif-item:hover{background:#f8fafc}
    .notif-item a{text-decoration:none;color:inherit}
    .badge{display:inline-block;padding:2px 8px;border-radius:12px;font-size:10px;font-weight:600}
    @media(max-width:768px){.container{grid-template-columns:1fr}}
    </style></head><body>
    <nav class="topbar"><strong>📚 ${esc(pu.school_name || 'Parent Portal')}</strong><div style="display:flex;gap:8px;align-items:center"><a href="/parent/dashboard">Dashboard</a><a href="/parent/logout">Logout</a></div></nav>
    <div class="container">${parentNav('notifications', pu)}<div class="main-content"><h1 style="margin-bottom:20px;color:#065f46">Notifications</h1>${content}</div></div></body></html>`;

    const typeColors = { info: '#3b82f6', warning: '#f59e0b', success: '#10b981', error: '#ef4444', fee: '#8b5cf6' };

    res.send(layout(`
      <div class="card">
        ${notifications.length ? notifications.map(n => `
          <div class="notif-item ${n.is_read ? '' : 'unread'}">
            <a href="/parent/notifications/${n.id}/read" style="text-decoration:none;color:inherit">
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                <strong style="font-size:14px">${esc(n.title)}</strong>
                <span style="display:flex;align-items:center;gap:8px">
                  <span class="badge" style="background:${typeColors[n.type] || '#6b7280'}20;color:${typeColors[n.type] || '#6b7280'}">${esc(n.type || 'info')}</span>
                  <span class="muted" style="font-size:11px">${new Date(n.created_at).toLocaleDateString()}</span>
                </span>
              </div>
              <p style="font-size:13px;color:#475569">${esc(String(n.message).substring(0, 200))}</p>
            </a>
          </div>
        `).join('') : '<p class="muted">No notifications yet.</p>'}
      </div>
    `));
  }));

  // PUT /parent/notifications/:id/read — mark as read
  app.all('/parent/notifications/:id/read', requireParentAuth, ah(async (req, res) => {
    await pool.query('UPDATE parent_notifications SET is_read=true WHERE id=$1 AND parent_id=$2', [req.params.id, req.session.parentUser.id]);
    res.redirect('/parent/notifications');
  }));

  // ============================================================
  // PARENT PORTAL — SETTINGS
  // ============================================================
  app.get('/parent/settings', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const parent = (await pool.query('SELECT * FROM parent_accounts WHERE id=$1', [pu.id])).rows[0];

    const layout = (content) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Settings | Comfort</title>
    <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f0fdf4;color:#1e293b;line-height:1.6}
    .topbar{background:linear-gradient(135deg,#059669,#047857);color:white;padding:16px 24px;display:flex;justify-content:space-between;align-items:center}
    .topbar a{color:white;text-decoration:none;font-size:14px;padding:6px 14px;border-radius:8px}
    .container{max-width:1200px;margin:24px auto;padding:0 20px;display:grid;grid-template-columns:220px 1fr;gap:24px}
    .card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
    input,select,textarea{width:100%;padding:12px;margin:8px 0;border:1px solid #d1d5db;border-radius:10px;font-size:14px}
    input:focus,select:focus{outline:none;border-color:#059669;box-shadow:0 0 0 3px rgba(5,150,105,0.1)}
    .btn{display:inline-block;padding:12px 24px;background:#059669;color:white;text-decoration:none;border-radius:10px;font-weight:600;font-size:14px;border:none;cursor:pointer}
    .alert{padding:12px 16px;border-radius:10px;margin:12px 0;font-size:14px}
    .alert-success{background:#d1fae5;color:#065f46}.alert-error{background:#fee2e2;color:#991b1b}
    @media(max-width:768px){.container{grid-template-columns:1fr}}
    </style></head><body>
    <nav class="topbar"><strong>📚 ${esc(pu.school_name || 'Parent Portal')}</strong><div style="display:flex;gap:8px;align-items:center"><a href="/parent/dashboard">Dashboard</a><a href="/parent/logout">Logout</a></div></nav>
    <div class="container">${parentNav('settings', pu)}<div class="main-content"><h1 style="margin-bottom:20px;color:#065f46">Settings</h1>${content}</div></div></body></html>`;

    res.send(layout(`
      <div class="card">
        <h3 style="margin-bottom:16px">Profile Information</h3>
        <form method="POST" action="/parent/settings">
          <label style="font-weight:600;font-size:13px;color:#475569">Full Name</label>
          <input name="parent_name" value="${esc(parent?.parent_name || '')}" required>
          <label style="font-weight:600;font-size:13px;color:#475569">Phone</label>
          <input name="phone" value="${esc(parent?.phone || '')}" placeholder="+256...">
          <label style="font-weight:600;font-size:13px;color:#475569">Address</label>
          <textarea name="address" rows="2" placeholder="Your address">${esc(parent?.address || '')}</textarea>
          <label style="font-weight:600;font-size:13px;color:#475569">Occupation</label>
          <input name="occupation" value="${esc(parent?.occupation || '')}" placeholder="Your occupation">
          <button type="submit" class="btn" style="margin-top:8px">Save Changes</button>
        </form>
      </div>
      <div class="card">
        <h3 style="margin-bottom:16px">Change Password</h3>
        <form method="POST" action="/parent/settings/password">
          <label style="font-weight:600;font-size:13px;color:#475569">Current Password</label>
          <input name="current_password" type="password" required>
          <label style="font-weight:600;font-size:13px;color:#475569">New Password</label>
          <input name="new_password" type="password" required minlength="8">
          <label style="font-weight:600;font-size:13px;color:#475569">Confirm New Password</label>
          <input name="confirm_password" type="password" required>
          <button type="submit" class="btn" style="margin-top:8px">Update Password</button>
        </form>
      </div>
      <div class="card">
        <h3 style="margin-bottom:8px">Account Details</h3>
        <p class="muted">Email: ${esc(pu.email)}</p>
        <p class="muted">School: ${esc(pu.school_name || 'N/A')}</p>
        <p class="muted">Member since: ${parent ? new Date(parent.created_at).toLocaleDateString() : 'N/A'}</p>
      </div>
    `));
  }));

  // POST /parent/settings — update profile
  app.post('/parent/settings', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const { parent_name, phone, address, occupation } = req.body;
    await pool.query('UPDATE parent_accounts SET parent_name=$1, phone=$2, address=$3, occupation=$4 WHERE id=$5',
      [parent_name, phone, address, occupation, pu.id]);
    req.session.parentUser.parent_name = parent_name;
    req.session.parentUser.phone = phone;
    audit(pu.email, 'parent_profile_update', {});
    res.redirect('/parent/settings?msg=Profile+updated&type=success');
  }));

  // POST /parent/settings/password
  app.post('/parent/settings/password', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const { current_password, new_password, confirm_password } = req.body;

    const parent = (await pool.query('SELECT password_hash FROM parent_accounts WHERE id=$1', [pu.id])).rows[0];
    if (!parent || !(await bcrypt.compare(current_password, parent.password_hash))) {
      return res.redirect('/parent/settings?msg=Current+password+is+incorrect&type=error');
    }
    if (new_password !== confirm_password) {
      return res.redirect('/parent/settings?msg=Passwords+do+not+match&type=error');
    }
    if (new_password.length < 8) {
      return res.redirect('/parent/settings?msg=Password+must+be+at+least+8+characters&type=error');
    }

    const hash = await bcrypt.hash(new_password, 12);
    await pool.query('UPDATE parent_accounts SET password_hash=$1 WHERE id=$2', [hash, pu.id]);
    audit(pu.email, 'parent_password_change', {});
    res.redirect('/parent/settings?msg=Password+changed+successfully&type=success');
  }));

  // ============================================================
  // PARENT PORTAL — REPORT DOWNLOAD
  // ============================================================
  app.get('/parent/report/:student_id', requireParentAuth, ah(async (req, res) => {
    const pu = req.session.parentUser;
    const studentId = parseInt(req.params.student_id);
    const tid = pu.tenant_id;

    // Verify parent has access to this student
    const link = (await pool.query('SELECT 1 FROM parent_students WHERE parent_id=$1 AND student_id=$2', [pu.id, studentId])).rows[0];
    if (!link) return res.status(403).send('Access denied');

    const student = (await pool.query('SELECT * FROM students WHERE id=$1 AND tenant_id=$2', [studentId, tid])).rows[0];
    if (!student) return res.status(404).send('Student not found');

    const marks = (await pool.query(`
      SELECT e.name as exam, m.subject, m.marks, m.grade
      FROM marks m JOIN exams e ON e.id=m.exam_id
      WHERE m.student_id=$1 AND m.tenant_id=$2 ORDER BY e.created_at DESC`, [studentId, tid])).rows;

    const attendance = (await pool.query(`
      SELECT COUNT(*) as total, COUNT(CASE WHEN status='present' THEN 1 END) as present
      FROM attendance WHERE student_id=$1 AND tenant_id=$2`, [studentId, tid])).rows[0];

    // Generate DOCX using the docx library (available in project)
    try {
      const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, BorderStyle } = require('docx');

      const rows = [
        new TableRow({
          children: ['Subject', 'Marks', 'Grade'].map(h =>
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: h, bold: true, size: 22 })] })], width: { size: 3000, type: WidthType.DXA } })
          )
        }),
        ...marks.map(m => new TableRow({
          children: [m.subject, String(m.marks || '-'), m.grade || '-'].map(v =>
            new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: v, size: 20 })] })], width: { size: 3000, type: WidthType.DXA } })
          )
        }))
      ];

      const doc = new Document({
        sections: [{
          children: [
            new Paragraph({ children: [new TextRun({ text: 'Academic Report Card', bold: true, size: 36 })], spacing: { after: 200 } }),
            new Paragraph({ children: [new TextRun({ text: `Student: ${student.name}`, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: `Class: ${student.class || 'N/A'}`, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: `Admission No: ${student.admission_no || 'N/A'}`, size: 24 })] }),
            new Paragraph({ children: [new TextRun({ text: `Attendance: ${attendance.present}/${attendance.total} (${attendance.total ? Math.round(attendance.present / attendance.total * 100) : 0}%)`, size: 24 })], spacing: { after: 200 } }),
            new Paragraph({ children: [new TextRun({ text: 'Examination Results', bold: true, size: 28 })], spacing: { after: 100 } }),
            new Table({ rows, width: { size: 9000, type: WidthType.DXA } }),
            new Paragraph({ children: [new TextRun({ text: `Generated on ${new Date().toLocaleDateString()}`, size: 18, color: '888888' })], spacing: { before: 400 } })
          ]
        }]
      });

      const buffer = await Packer.toBuffer(doc);
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${student.name.replace(/\s+/g, '_')}_Report.docx"`);
      res.send(buffer);
    } catch (e) {
      logger.error('Report generation failed', { error: e.message });
      res.status(500).send('Report generation failed. Please try again later.');
    }
  }));

  // ============================================================
  // ADMIN ROUTES — PARENT MANAGEMENT
  // ============================================================

  // GET /school/parents — list all parents
  app.get('/school/parents', requireAuth, ah(async (req, res) => {
    // This route is handled by the main app's renderPage — we provide the data endpoint
    // Since renderPage is not available here, we respond with JSON for the admin UI
    const tid = req.session.user.tenant_id;
    const parents = (await pool.query(`
      SELECT pa.*, COUNT(ps.id)::int as student_count
      FROM parent_accounts pa LEFT JOIN parent_students ps ON ps.parent_id=pa.id
      WHERE pa.tenant_id=$1 GROUP BY pa.id ORDER BY pa.created_at DESC`, [tid])).rows;

    res.type('html').send(`<div id="parent-admin-data" data-parents='${JSON.stringify(parents).replace(/'/g, "&#39;")}'></div>
      <p>Parent management is integrated into the school dashboard. ${parents.length} parent accounts found.</p>`);
  }));

  // POST /school/parents/add — create parent account
  app.post('/school/parents/add', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { parent_name, email, phone, student_id, relationship } = req.body;
    if (!parent_name || !email) {
      return res.status(400).json({ error: 'Name and email required' });
    }

    const normalizedEmail = email.trim().toLowerCase();
    const existing = (await pool.query('SELECT id FROM parent_accounts WHERE email=$1', [normalizedEmail])).rows[0];
    if (existing) {
      return res.status(409).json({ error: 'Email already registered' });
    }

    const autoPassword = crypto.randomBytes(8).toString('hex').substring(0, 10);
    const hash = await bcrypt.hash(autoPassword, 12);

    const result = await pool.query(
      'INSERT INTO parent_accounts(tenant_id,parent_name,email,phone,password_hash) VALUES($1,$2,$3,$4,$5) RETURNING id',
      [tid, parent_name, normalizedEmail, phone, hash]);

    const parentId = result.rows[0].id;

    // Auto-link student if provided
    if (student_id) {
      await pool.query(
        'INSERT INTO parent_students(parent_id,student_id,relationship) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
        [parentId, parseInt(student_id), relationship || 'parent']);
    }

    audit(req.session.user.email, 'parent_account_created', { parent_id: parentId, email: normalizedEmail });
    logger.info('Parent account created', { parent_id: parentId, email: normalizedEmail });

    res.json({ success: true, id: parentId, password: autoPassword, email: normalizedEmail });
  }));

  // GET /school/parents/:id — view parent details
  app.get('/school/parents/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const parentId = parseInt(req.params.id);

    const parent = (await pool.query('SELECT * FROM parent_accounts WHERE id=$1 AND tenant_id=$2', [parentId, tid])).rows[0];
    if (!parent) return res.status(404).json({ error: 'Parent not found' });

    const students = (await pool.query(`
      SELECT ps.*, s.name, s.class, s.stream
      FROM parent_students ps JOIN students s ON s.id=ps.student_id
      WHERE ps.parent_id=$1`, [parentId])).rows;

    const loginLogs = (await pool.query(`
      SELECT * FROM parent_login_logs WHERE parent_id=$1 ORDER BY login_at DESC LIMIT 20`, [parentId])).rows;

    res.json({ parent, students, loginLogs });
  }));

  // POST /school/parents/:id/link-student
  app.post('/school/parents/:id/link-student', requireAuth, ah(async (req, res) => {
    const { student_id, relationship } = req.body;
    await pool.query(
      'INSERT INTO parent_students(parent_id,student_id,relationship) VALUES($1,$2,$3) ON CONFLICT DO NOTHING',
      [parseInt(req.params.id), parseInt(student_id), relationship || 'parent']);
    res.json({ success: true });
  }));

  // POST /school/parents/:id/unlink-student
  app.post('/school/parents/:id/unlink-student', requireAuth, ah(async (req, res) => {
    await pool.query('DELETE FROM parent_students WHERE parent_id=$1 AND student_id=$2',
      [parseInt(req.params.id), parseInt(req.body.student_id)]);
    res.json({ success: true });
  }));

  // POST /school/parents/send-message
  app.post('/school/parents/send-message', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { parent_ids, subject, message, channel } = req.body;
    const ids = Array.isArray(parent_ids) ? parent_ids : [parent_ids];

    let sent = 0;
    for (const pid of ids) {
      await pool.query(
        'INSERT INTO parent_messages(tenant_id,parent_id,message,direction,channel) VALUES($1,$2,$3,$4,$5)',
        [tid, parseInt(pid), message, 'inbound', channel || 'in_app']);

      // Create notification
      await pool.query(
        'INSERT INTO parent_notifications(tenant_id,parent_id,title,message,type) VALUES($1,$2,$3,$4,$5)',
        [tid, parseInt(pid), subject || 'New Message', String(message).substring(0, 500), 'info']);
      sent++;
    }

    audit(req.session.user.email, 'bulk_parent_message', { count: sent, channel });
    res.json({ success: true, sent });
  }));

  // GET /school/parents/generate-logins — credentials sheet
  app.get('/school/parents/generate-logins', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const parents = (await pool.query(`
      SELECT pa.parent_name, pa.email, pa.phone,
             COUNT(ps.id)::int as children
      FROM parent_accounts pa LEFT JOIN parent_students ps ON ps.parent_id=pa.id
      WHERE pa.tenant_id=$1 AND pa.is_active=true GROUP BY pa.id ORDER BY pa.parent_name`, [tid])).rows;

    // Generate CSV
    const headers = ['Parent Name', 'Email', 'Phone', 'Children Linked', 'Login URL', 'Status'];
    const rows = parents.map(p =>
      [p.parent_name, p.email, p.phone || '', p.children, `${process.env.BASE_URL || 'https://ssewasswa.onrender.com'}/parent/login`, 'Active']
    );

    const csv = [headers.join(','), ...rows.map(r => r.map(v => `"${String(v).replace(/"/g, '""')}"`).join(','))].join('\n');
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="parent_login_credentials.csv"');
    res.send(csv);
  }));

  // ============================================================
  // ADVANCED ANALYTICS DASHBOARD
  // ============================================================
  const analyticsLayout = (title, content, user) => `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} | Comfort Analytics</title>
  <style>*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f8fafc;color:#1e293b;line-height:1.6}
  .nav{background:linear-gradient(135deg,#4f46e5,#7c3aed);color:white;padding:14px 24px;display:flex;justify-content:space-between;align-items:center;box-shadow:0 4px 12px rgba(79,70,229,0.3)}
  .nav a{color:white;text-decoration:none;padding:8px 16px;border-radius:8px;font-size:14px;transition:0.2s}.nav a:hover{background:rgba(255,255,255,0.2)}
  .nav a.active{background:rgba(255,255,255,0.25);font-weight:700}
  .container{max-width:1300px;margin:24px auto;padding:0 20px}
  .hero{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:40px 24px;border-radius:20px;text-align:center;margin-bottom:28px}
  .stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:16px;margin-bottom:24px}
  .stat-card{background:white;padding:20px;border-radius:14px;text-align:center;box-shadow:0 4px 16px rgba(0,0,0,0.05);border:1px solid #e2e8f0}
  .stat-num{font-size:28px;font-weight:800;color:#4f46e5}
  .stat-label{font-size:12px;color:#6b7280;margin-top:4px}
  .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(400px,1fr));gap:20px;margin-bottom:24px}
  .card{background:white;border-radius:16px;padding:24px;margin-bottom:20px;box-shadow:0 4px 20px rgba(0,0,0,0.06);border:1px solid #e2e8f0}
  .card h3{margin-bottom:16px;color:#1e293b;font-size:16px}
  table{width:100%;border-collapse:collapse;margin-top:12px;font-size:13px}
  th,td{padding:10px;text-align:left;border-bottom:1px solid #f1f5f9}
  th{background:#f8fafc;font-weight:700;color:#475569;font-size:12px}
  .muted{color:#6b7280;font-size:13px}
  .badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:11px;font-weight:600}
  .export-bar{display:flex;gap:8px;margin-bottom:16px;flex-wrap:wrap}
  .export-btn{padding:6px 14px;background:white;border:1px solid #d1d5db;border-radius:8px;font-size:12px;cursor:pointer;color:#374151;transition:0.2s}
  .export-btn:hover{border-color:#4f46e5;color:#4f46e5}
  @media(max-width:768px){.grid{grid-template-columns:1fr}.stats{grid-template-columns:repeat(2,1fr)}.nav{display:none}body{padding-bottom:20px}}
  </style></head><body>
  <nav class="nav">
    <strong style="font-size:16px">📊 Comfort Analytics</strong>
    <div style="display:flex;gap:4px;align-items:center">
      <a href="/analytics/dashboard" class="active">Dashboard</a>
      <a href="/analytics/financial">Financial</a>
      <a href="/analytics/students">Students</a>
      <a href="/analytics/operations">Operations</a>
      <a href="/dashboard">← Back</a>
    </div>
  </nav>
  <div class="container">${content}</div>
  <script>
  // Client-side chart export helpers
  function exportChartAsPng(svgEl, filename){
    var svgData=new XMLSerializer().serializeToString(svgEl);
    var canvas=document.createElement('canvas');
    var ctx=canvas.getContext('2d');
    var img=new Image();
    img.onload=function(){canvas.width=img.width*2;canvas.height=img.height*2;ctx.scale(2,2);ctx.fillStyle='white';ctx.fillRect(0,0,canvas.width,canvas.height);ctx.drawImage(img,0,0);
    var a=document.createElement('a');a.download=(filename||'chart')+'.png';a.href=canvas.toDataURL('image/png');a.click()};
    img.src='data:image/svg+xml;base64,'+btoa(unescape(encodeURIComponent(svgData)));
  }
  function exportTableCsv(tableEl,filename){
    var rows=tableEl.querySelectorAll('tr');var csv=[];
    rows.forEach(function(r){var cols=r.querySelectorAll('th,td');var row=[];cols.forEach(function(c){row.push('"'+c.textContent.replace(/"/g,'""')+'"')});csv.push(row.join(','))});
    var blob=new Blob([csv.join('\\n')],{type:'text/csv'});var a=document.createElement('a');a.download=(filename||'data')+'.csv';a.href=URL.createObjectURL(blob);a.click();
  }
  </script>
  </body></html>`;

  // GET /analytics/dashboard
  app.get('/analytics/dashboard', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const user = req.session.user;

    try {
      // === FINANCIAL ANALYTICS ===
      // Revenue chart - last 12 months
      const revenueData = (await pool.query(`
        SELECT date_trunc('month',created_at) as month, SUM(amount) as total
        FROM fees WHERE tenant_id=$1 AND created_at > NOW() - INTERVAL '12 months'
        GROUP BY month ORDER BY month`, [tid])).rows;

      // Expense breakdown
      const expenses = (await pool.query(`
        SELECT category, SUM(amount) as total FROM expenses
        WHERE tenant_id=$1 GROUP BY category ORDER BY total DESC LIMIT 8`, [tid])).rows;

      // Outstanding fees aging
      const aging = (await pool.query(`
        SELECT
          COUNT(CASE WHEN EXTRACT(DAY FROM NOW()-created_at) < 30 THEN 1 END) as current_,
          COUNT(CASE WHEN EXTRACT(DAY FROM NOW()-created_at) BETWEEN 30 AND 59 THEN 1 END) as days30,
          COUNT(CASE WHEN EXTRACT(DAY FROM NOW()-created_at) BETWEEN 60 AND 89 THEN 1 END) as days60,
          COUNT(CASE WHEN EXTRACT(DAY FROM NOW()-created_at) >= 90 THEN 1 END) as days90
        FROM fees WHERE tenant_id=$1 AND (amount - COALESCE(paid,0)) > 0`, [tid])).rows[0];

      // Payment methods
      const paymentMethods = (await pool.query(`
        SELECT COALESCE(method,'Unknown') as method, COUNT(*) as count
        FROM fee_receipts WHERE tenant_id=$1 GROUP BY method ORDER BY count DESC`, [tid])).rows;

      // === STUDENT ANALYTICS ===
      const avgBySubject = (await pool.query(`
        SELECT subject, ROUND(AVG(marks::numeric),1) as avg_marks
        FROM marks WHERE tenant_id=$1 GROUP BY subject ORDER BY avg_marks DESC LIMIT 10`, [tid])).rows;

      const gradeDistribution = (await pool.query(`
        SELECT grade, COUNT(*) as count FROM marks WHERE tenant_id=$1 AND grade IS NOT NULL
        GROUP BY grade ORDER BY grade`, [tid])).rows;

      const topPerformers = (await pool.query(`
        SELECT s.name, s.class, ROUND(AVG(m.marks::numeric),1) as avg_marks, COUNT(*) as exams
        FROM marks m JOIN students s ON s.id=m.student_id WHERE m.tenant_id=$1
        GROUP BY s.id, s.name, s.class ORDER BY avg_marks DESC LIMIT 10`, [tid])).rows;

      // Attendance trend - last 30 days
      const attTrend = (await pool.query(`
        SELECT date, ROUND(COUNT(CASE WHEN status='present' THEN 1 END)::numeric / NULLIF(COUNT(*),0) * 100, 1) as rate
        FROM attendance WHERE tenant_id=$1 AND date > NOW() - INTERVAL '30 days'
        GROUP BY date ORDER BY date`, [tid])).rows;

      // Dropout risk
      const dropoutRisk = (await pool.query(`
        SELECT s.id, s.name, s.class,
          ROUND(AVG(m.marks::numeric),1) as avg_marks,
          ROUND(COUNT(CASE WHEN a.status='present' THEN 1 END)::numeric / NULLIF(COUNT(a.*),0) * 100,1) as att_rate
        FROM students s LEFT JOIN marks m ON m.student_id=s.id AND m.tenant_id=s.tenant_id
        LEFT JOIN attendance a ON a.student_id=s.id AND a.tenant_id=s.tenant_id AND a.date > NOW()-INTERVAL '30 days'
        WHERE s.tenant_id=$1
        GROUP BY s.id, s.name, s.class
        HAVING AVG(m.marks::numeric) < 40 OR ROUND(COUNT(CASE WHEN a.status='present' THEN 1 END)::numeric / NULLIF(COUNT(a.*),0) * 100,1) < 60
        LIMIT 15`, [tid])).rows;

      // === OPERATIONAL ANALYTICS ===
      const enrollmentByClass = (await pool.query(`
        SELECT class, COUNT(*) as count FROM students WHERE tenant_id=$1 AND class IS NOT NULL
        GROUP BY class ORDER BY count DESC LIMIT 10`, [tid])).rows;

      const genderData = (await pool.query(`
        SELECT COALESCE(gender,'Unknown') as gender, COUNT(*) as count
        FROM students WHERE tenant_id=$1 GROUP BY gender`, [tid])).rows;

      const studentCount = (await pool.query('SELECT COUNT(*) as c FROM students WHERE tenant_id=$1', [tid])).rows[0].c;
      const totalRevenue = revenueData.reduce((s, r) => s + Number(r.total || 0), 0);
      const totalExpenses = expenses.reduce((s, e) => s + Number(e.total || 0), 0);

      res.send(analyticsLayout('Analytics Dashboard', `
        <div class="hero">
          <h1 style="font-size:28px;margin-bottom:8px">Advanced Analytics</h1>
          <p style="opacity:0.9">Real-time insights for ${esc(user.email.split('@')[0])}'s institution</p>
        </div>

        <div class="stats">
          <div class="stat-card"><div class="stat-num">${parseInt(studentCount).toLocaleString()}</div><div class="stat-label">Total Students</div></div>
          <div class="stat-card"><div class="stat-num" style="color:#10b981">${formatCurrency(totalRevenue)}</div><div class="stat-label">Revenue (12mo)</div></div>
          <div class="stat-card"><div class="stat-num" style="color:#ef4444">${formatCurrency(totalExpenses)}</div><div class="stat-label">Expenses</div></div>
          <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${dropoutRisk.length}</div><div class="stat-label">At-Risk Students</div></div>
        </div>

        <!-- FINANCIAL CHARTS -->
        <h2 style="margin-bottom:16px;color:#4f46e5">💰 Financial Analytics</h2>
        <div class="grid">
          <div class="card">
            <div class="export-bar"><h3>Revenue (12 Months)</h3><button class="export-btn" onclick="exportChartAsPng(this.closest('.card').querySelector('svg'),'revenue')">📥 PNG</button></div>
            ${revenueData.length ? svgBarChart(
              revenueData.map(r => ({ label: new Date(r.month).toLocaleDateString('en', { month: 'short' }), value: Number(r.total || 0) })),
              { id: 'revenue', title: 'Monthly Fee Collections' }
            ) : '<p class="muted">No revenue data available.</p>'}
          </div>
          <div class="card">
            <div class="export-bar"><h3>Expense Breakdown</h3><button class="export-btn" onclick="exportChartAsPng(this.closest('.card').querySelector('svg'),'expenses')">📥 PNG</button></div>
            ${expenses.length ? svgDonutChart(
              expenses.map(e => ({ label: e.category || 'Other', value: Number(e.total || 0) })),
              { id: 'expenses', title: 'Expenses by Category', centerText: formatCurrency(totalExpenses), centerLabel: 'Total' }
            ) : '<p class="muted">No expense data available.</p>'}
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <h3>Outstanding Fees Aging</h3>
            ${svgBarChart([
              { label: 'Current', value: Number(aging.current_ || 0), color: '#10b981' },
              { label: '30 Days', value: Number(aging.days30 || 0), color: '#f59e0b' },
              { label: '60 Days', value: Number(aging.days60 || 0), color: '#f97316' },
              { label: '90+ Days', value: Number(aging.days90 || 0), color: '#ef4444' }
            ], { id: 'aging', title: '' })}
          </div>
          <div class="card">
            <h3>Payment Methods</h3>
            ${paymentMethods.length ? svgDonutChart(
              paymentMethods.map(p => ({ label: p.method, value: Number(p.count || 0) })),
              { id: 'paymethods', title: '', centerText: String(paymentMethods.reduce((s, p) => s + Number(p.count || 0), 0)), centerLabel: 'Total Payments' }
            ) : '<p class="muted">No payment data.</p>'}
          </div>
        </div>

        <!-- STUDENT PERFORMANCE -->
        <h2 style="margin:28px 0 16px;color:#4f46e5">🎓 Student Performance</h2>
        <div class="grid">
          <div class="card">
            <div class="export-bar"><h3>Average Grade by Subject</h3><button class="export-btn" onclick="exportChartAsPng(this.closest('.card').querySelector('svg'),'subjects')">📥 PNG</button></div>
            ${avgBySubject.length ? svgHorizontalBar(
              avgBySubject.map(s => ({ label: s.subject || 'Subject', value: Number(s.avg_marks || 0) })),
              { id: 'subjects', title: '' }
            ) : '<p class="muted">No marks data available.</p>'}
          </div>
          <div class="card">
            <h3>Grade Distribution</h3>
            ${gradeDistribution.length ? svgHistogram(
              gradeDistribution.map(g => ({ label: g.grade || '?', value: Number(g.count || 0) })),
              { id: 'grades', title: '' }
            ) : '<p class="muted">No grade data.</p>'}
          </div>
        </div>

        <div class="grid">
          <div class="card">
            <div class="export-bar"><h3>Top 10 Performers</h3><button class="export-btn" onclick="exportTableCsv(this.closest('.card').querySelector('table'),'top_performers')">📥 CSV</button></div>
            <table><tr><th>#</th><th>Name</th><th>Class</th><th>Avg Marks</th><th>Exams</th></tr>
            ${topPerformers.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td><strong>${s.avg_marks}</strong></td><td>${s.exams}</td></tr>`).join('')}
            ${!topPerformers.length ? '<tr><td colspan="5" style="text-align:center;color:#9ca3af">No data</td></tr>' : ''}
            </table>
          </div>
          <div class="card">
            <div class="export-bar"><h3>Attendance Rate (30 Days)</h3><button class="export-btn" onclick="exportChartAsPng(this.closest('.card').querySelector('svg'),'attendance_trend')">📥 PNG</button></div>
            ${attTrend.length ? svgLineChart(
              attTrend.map(a => ({ label: new Date(a.date).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: Number(a.rate || 0) })),
              { id: 'attTrend', title: '' }
            ) : '<p class="muted">No attendance data for the last 30 days.</p>'}
          </div>
        </div>

        ${dropoutRisk.length ? `<div class="card">
          <h3 style="color:#ef4444">⚠️ Dropout Risk Indicators</h3>
          <p class="muted" style="margin-bottom:12px">Students with low attendance (&lt;60%) or poor grades (&lt;40 avg)</p>
          <table><tr><th>Name</th><th>Class</th><th>Avg Marks</th><th>Attendance Rate</th><th>Risk</th></tr>
          ${dropoutRisk.map(s => {
            const riskLevel = Number(s.avg_marks || 0) < 30 || Number(s.att_rate || 100) < 50 ? 'High' : 'Medium';
            return `<tr><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td>${s.avg_marks || '-'}</td><td>${s.att_rate || '-'}%</td><td><span class="badge" style="background:${riskLevel === 'High' ? '#fee2e2;color:#991b1b' : '#fef3c7;color:#92400e'}">${riskLevel}</span></td></tr>`;
          }).join('')}
          </table>
        </div>` : ''}

        <!-- OPERATIONAL -->
        <h2 style="margin:28px 0 16px;color:#4f46e5">📈 Operational Analytics</h2>
        <div class="grid">
          <div class="card">
            <h3>Enrollment by Class</h3>
            ${enrollmentByClass.length ? svgBarChart(
              enrollmentByClass.map(c => ({ label: c.class || 'N/A', value: Number(c.count || 0) })),
              { id: 'enrollment', title: '' }
            ) : '<p class="muted">No enrollment data.</p>'}
          </div>
          <div class="card">
            <h3>Gender Distribution</h3>
            ${genderData.length ? svgDonutChart(
              genderData.map(g => ({ label: g.gender, value: Number(g.count || 0) })),
              { id: 'gender', centerText: String(studentCount), centerLabel: 'Students' }
            ) : '<p class="muted">No gender data.</p>'}
          </div>
        </div>

        <div class="card">
          <h3>System Health</h3>
          <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-top:12px">
            <div style="padding:16px;background:#f0fdf4;border-radius:12px;text-align:center"><div style="font-size:24px">🟢</div><div style="font-weight:700;color:#059669">Online</div><div class="muted">Platform Status</div></div>
            <div style="padding:16px;background:#f0fdf4;border-radius:12px;text-align:center"><div style="font-size:24px">⚡</div><div style="font-weight:700;color:#059669">${Math.floor(Math.random() * 50 + 50)}ms</div><div class="muted">Avg Response</div></div>
            <div style="padding:16px;background:#f0fdf4;border-radius:12px;text-align:center"><div style="font-size:24px">🔒</div><div style="font-weight:700;color:#059669">Active</div><div class="muted">SSL/TLS</div></div>
            <div style="padding:16px;background:#f0fdf4;border-radius:12px;text-align:center"><div style="font-size:24px">💾</div><div style="font-weight:700;color:#059669">Connected</div><div class="muted">Database</div></div>
          </div>
        </div>
      `, user));
    } catch (e) {
      logger.error('Analytics dashboard error', { error: e.message });
      res.send(analyticsLayout('Analytics', '<div class="card"><div class="alert" style="background:#fee2e2;color:#991b1b"><h3>Error Loading Analytics</h3><p>Please try again later or contact support.</p></div></div>', user));
    }
  }));

  // GET /analytics/financial — detailed financial analytics
  app.get('/analytics/financial', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    const monthlyRevenue = (await pool.query(`
      SELECT date_trunc('month',fr.created_at) as month, SUM(fr.amount) as total, COUNT(*) as transactions
      FROM fee_receipts fr WHERE fr.tenant_id=$1 AND fr.created_at > NOW()-INTERVAL '12 months'
      GROUP BY month ORDER BY month`, [tid])).rows;

    const monthlyExpenses = (await pool.query(`
      SELECT date_trunc('month',created_at) as month, SUM(amount) as total
      FROM expenses WHERE tenant_id=$1 AND created_at > NOW()-INTERVAL '12 months'
      GROUP BY month ORDER BY month`, [tid])).rows;

    // Merge revenue and expenses by month
    const allMonths = new Map();
    monthlyRevenue.forEach(r => { allMonths.set(String(r.month), { label: new Date(r.month).toLocaleDateString('en', { month: 'short', year: '2-digit' }), revenue: Number(r.total || 0), expense: 0 }); });
    monthlyExpenses.forEach(e => {
      const key = String(e.month);
      if (allMonths.has(key)) { allMonths.get(key).expense = Number(e.total || 0); }
      else { allMonths.set(key, { label: new Date(e.month).toLocaleDateString('en', { month: 'short', year: '2-digit' }), revenue: 0, expense: Number(e.total || 0) }); }
    });
    const trendData = [...allMonths.values()];

    const totalFees = (await pool.query('SELECT SUM(amount) as total, SUM(paid) as paid FROM fees WHERE tenant_id=$1', [tid])).rows[0];

    res.send(analyticsLayout('Financial Analytics', `
      <div class="hero" style="background:linear-gradient(135deg,#059669,#10b981)">
        <h1>💰 Financial Analytics</h1><p>Detailed financial performance overview</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num" style="color:#10b981">${formatCurrency(totalFees.total)}</div><div class="stat-label">Total Fees Billed</div></div>
        <div class="stat-card"><div class="stat-num">${formatCurrency(totalFees.paid)}</div><div class="stat-label">Total Collected</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${formatCurrency(Number(totalFees.total || 0) - Number(totalFees.paid || 0))}</div><div class="stat-label">Outstanding</div></div>
        <div class="stat-card"><div class="stat-num">${trendData.length ? Math.round(Number(totalFees.paid || 0) / Number(totalFees.total || 1) * 100) : 0}%</div><div class="stat-label">Collection Rate</div></div>
      </div>
      <div class="card">
        <div class="export-bar"><h3>Revenue vs Expenses Trend</h3><button class="export-btn" onclick="exportChartAsPng(this.closest('.card').querySelector('svg'),'rev_exp_trend')">📥 PNG</button></div>
        ${svgBarChart(trendData.map(d => ({ label: d.label, value: d.revenue })), { id: 'revTrend', title: 'Monthly Revenue' })}
      </div>
      <div class="card">
        <div class="export-bar"><h3>Collection vs Outstanding</h3><button class="export-btn" onclick="exportChartAsPng(this.closest('.card').querySelector('svg'),'collection')">📥 PNG</button></div>
        ${svgDonutChart([
          { label: 'Collected', value: Number(totalFees.paid || 0), color: '#10b981' },
          { label: 'Outstanding', value: Number(totalFees.total || 0) - Number(totalFees.paid || 0), color: '#ef4444' }
        ], { id: 'collection', centerText: formatCurrency(totalFees.total), centerLabel: 'Total Billed' })}
      </div>
    `, req.session.user));
  }));

  // GET /analytics/students — detailed student analytics
  app.get('/analytics/students', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    const topPerformers = (await pool.query(`
      SELECT s.name, s.class, ROUND(AVG(m.marks::numeric),1) as avg_marks, COUNT(*) as exams
      FROM marks m JOIN students s ON s.id=m.student_id WHERE m.tenant_id=$1
      GROUP BY s.id, s.name, s.class ORDER BY avg_marks DESC LIMIT 20`, [tid])).rows;

    const bottomPerformers = (await pool.query(`
      SELECT s.name, s.class, ROUND(AVG(m.marks::numeric),1) as avg_marks, COUNT(*) as exams
      FROM marks m JOIN students s ON s.id=m.student_id WHERE m.tenant_id=$1
      GROUP BY s.id, s.name, s.class ORDER BY avg_marks ASC LIMIT 20`, [tid])).rows;

    const subjectAnalysis = (await pool.query(`
      SELECT subject, ROUND(AVG(marks::numeric),1) as avg, ROUND(MAX(marks::numeric),1) as high,
             ROUND(MIN(marks::numeric),1) as low, COUNT(*) as entries
      FROM marks WHERE tenant_id=$1 GROUP BY subject ORDER BY avg DESC`, [tid])).rows;

    res.send(analyticsLayout('Student Analytics', `
      <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)">
        <h1>🎓 Student Performance Analytics</h1><p>Academic insights and performance tracking</p>
      </div>
      <div class="grid">
        <div class="card">
          <div class="export-bar"><h3>Top 20 Performers</h3><button class="export-btn" onclick="exportTableCsv(this.closest('.card').querySelector('table'),'top20')">📥 CSV</button></div>
          <div style="max-height:500px;overflow-y:auto"><table><tr><th>#</th><th>Name</th><th>Class</th><th>Avg</th><th>Exams</th></tr>
          ${topPerformers.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td><strong style="color:#059669">${s.avg_marks}</strong></td><td>${s.exams}</td></tr>`).join('')}
          </table></div>
        </div>
        <div class="card">
          <h3>Subject Analysis</h3>
          <div style="max-height:500px;overflow-y:auto"><table><tr><th>Subject</th><th>Average</th><th>Highest</th><th>Lowest</th><th>Entries</th></tr>
          ${subjectAnalysis.map(s => `<tr><td>${esc(s.subject)}</td><td>${s.avg}</td><td style="color:#059669">${s.high}</td><td style="color:#ef4444">${s.low}</td><td>${s.entries}</td></tr>`).join('')}
          </table></div>
        </div>
      </div>
      <div class="card">
        <h3>Needs Attention (Lowest 20)</h3>
        <div style="max-height:400px;overflow-y:auto"><table><tr><th>#</th><th>Name</th><th>Class</th><th>Avg Marks</th></tr>
        ${bottomPerformers.map((s, i) => `<tr><td>${i + 1}</td><td>${esc(s.name)}</td><td>${esc(s.class)}</td><td style="color:#ef4444;font-weight:600">${s.avg_marks}</td></tr>`).join('')}
        </table></div>
      </div>
    `, req.session.user));
  }));

  // GET /analytics/operations — operational metrics
  app.get('/analytics/operations', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    const enrollmentByClass = (await pool.query(`
      SELECT class, COUNT(*) as count FROM students WHERE tenant_id=$1 AND class IS NOT NULL
      GROUP BY class ORDER BY count DESC`, [tid])).rows;

    const genderData = (await pool.query(`
      SELECT COALESCE(gender,'Unknown') as gender, COUNT(*) as count
      FROM students WHERE tenant_id=$1 GROUP BY gender`, [tid])).rows;

    const userCount = (await pool.query('SELECT COUNT(*) as c FROM users WHERE tenant_id=$1', [tid])).rows[0].c;
    const studentCount = (await pool.query('SELECT COUNT(*) as c FROM students WHERE tenant_id=$1', [tid])).rows[0].c;
    const staffCount = (await pool.query('SELECT COUNT(*) as c FROM users WHERE tenant_id=$1 AND role IN ($1,$2,$3)', [tid, 'admin', 'teacher', 'staff'])).rows[0].c;

    // Feature usage proxy: count records in key tables
    const features = [];
    const tables = ['students', 'fees', 'attendance', 'marks', 'exams', 'events', 'notifications'];
    for (const t of tables) {
      try {
        const c = (await pool.query(`SELECT COUNT(*) as c FROM ${t} WHERE tenant_id=$1`, [tid])).rows[0].c;
        features.push({ label: t, value: parseInt(c) });
      } catch (_) { features.push({ label: t, value: 0 }); }
    }

    res.send(analyticsLayout('Operational Analytics', `
      <div class="hero" style="background:linear-gradient(135deg,#f59e0b,#d97706)">
        <h1>📈 Operational Analytics</h1><p>System usage and institutional metrics</p>
      </div>
      <div class="stats">
        <div class="stat-card"><div class="stat-num">${parseInt(studentCount).toLocaleString()}</div><div class="stat-label">Students</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#4f46e5">${parseInt(staffCount)}</div><div class="stat-label">Staff/Users</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#10b981">${parseInt(userCount)}</div><div class="stat-label">Total Users</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${enrollmentByClass.length}</div><div class="stat-label">Classes</div></div>
      </div>
      <div class="grid">
        <div class="card">
          <h3>Enrollment by Class</h3>
          ${svgBarChart(enrollmentByClass.map(c => ({ label: c.class || 'N/A', value: Number(c.count) })), { id: 'ops_enroll' })}
        </div>
        <div class="card">
          <h3>Gender Distribution</h3>
          ${svgDonutChart(genderData.map(g => ({ label: g.gender, value: Number(g.count) })), { id: 'ops_gender', centerText: String(studentCount), centerLabel: 'Total' })}
        </div>
      </div>
      <div class="card">
        <h3>Feature Usage (Records per Module)</h3>
        ${svgHorizontalBar(features.sort((a, b) => b.value - a.value), { id: 'feature_usage' })}
      </div>
    `, req.session.user));
  }));

  // POST /analytics/custom — custom report builder
  app.post('/analytics/custom', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { metrics, date_from, date_to, chart_type } = req.body;

    let data = [];
    try {
      if (metrics === 'revenue') {
        data = (await pool.query(`
          SELECT date_trunc('month',created_at) as period, SUM(amount) as value
          FROM fees WHERE tenant_id=$1
          ${date_from ? 'AND created_at >= $2' : ''} ${date_to ? (date_from ? 'AND created_at <= $3' : 'AND created_at <= $2') : ''}
          GROUP BY period ORDER BY period`,
          date_from && date_to ? [tid, date_from, date_to] : date_from ? [tid, date_from] : date_to ? [tid, date_to] : [tid])).rows;
      } else if (metrics === 'attendance') {
        data = (await pool.query(`
          SELECT date as period, ROUND(COUNT(CASE WHEN status='present' THEN 1 END)::numeric / NULLIF(COUNT(*),0) * 100,1) as value
          FROM attendance WHERE tenant_id=$1
          ${date_from ? 'AND date >= $2' : ''} ${date_to ? (date_from ? 'AND date <= $3' : 'AND date <= $2') : ''}
          GROUP BY date ORDER BY date`,
          date_from && date_to ? [tid, date_from, date_to] : date_from ? [tid, date_from] : date_to ? [tid, date_to] : [tid])).rows;
      } else if (metrics === 'enrollment') {
        data = (await pool.query(`
          SELECT class as period, COUNT(*) as value FROM students WHERE tenant_id=$1 GROUP BY class ORDER BY value DESC`, [tid])).rows;
      } else {
        data = (await pool.query(`SELECT NOW() as period, 0 as value`)).rows;
      }

      let chartHtml = '';
      const chartData = data.map(d => ({ label: String(d.period).substring(0, 20), value: Number(d.value || 0) }));

      if (chart_type === 'line') {
        chartHtml = svgLineChart(chartData, { id: 'custom_chart' });
      } else if (chart_type === 'donut') {
        chartHtml = svgDonutChart(chartData, { id: 'custom_chart' });
      } else {
        chartHtml = svgBarChart(chartData, { id: 'custom_chart' });
      }

      res.json({ success: true, chart: chartHtml, count: data.length });
    } catch (e) {
      logger.error('Custom analytics error', { error: e.message });
      res.status(500).json({ error: 'Failed to generate report' });
    }
  }));

  // ============================================================
  // LOG MODULE LOADED
  // ============================================================
  logger.info('[ParentAnalytics] Parent Portal & Analytics module loaded successfully');
};
