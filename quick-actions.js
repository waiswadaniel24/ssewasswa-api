/**
 * School SaaS Portal — Quick Actions Panel
 * One-click shortcuts for common admin tasks.
 * Prefix: /school/quick-actions
 */
module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const tenantId = (req) => req.session?.user?.tenant_id || 0;
  const renderPage = opts.renderPage || ((req, title, body) => body);
  const ah = opts.ah || ((h) => h);
  const requireAuth = opts.requireAuth || ((req, res, next) => next());
  const audit = opts.audit || (() => {});

  /* ── Table creation ────────────────────────────────────── */
  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quick_action_history (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        action_type VARCHAR(50) NOT NULL,
        action_details JSONB,
        performed_by VARCHAR(255),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS quick_action_pins (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL DEFAULT 0,
        user_email VARCHAR(255) NOT NULL,
        action_type VARCHAR(50) NOT NULL,
        sort_order INT DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, user_email, action_type)
      )`);
    /* Indexes for fast lookups */
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_qah_tenant_time ON quick_action_history(tenant_id, created_at DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_qap_tenant_user ON quick_action_pins(tenant_id, user_email)`);
  }
  ensureTables().catch(console.error);

  /* ── Quick Actions Catalog (22 actions) ────────────────── */
  const ACTIONS = [
    { key: 'add-student',         icon: 'fa-user-plus',           label: 'Add Student',        desc: 'Register a new student quickly',        category: 'student' },
    { key: 'record-attendance',   icon: 'fa-clipboard-check',     label: 'Record Attendance',  desc: 'Mark class attendance for today',       category: 'academic' },
    { key: 'send-message',        icon: 'fa-envelope',            label: 'Send Message',       desc: 'Send a message to parents or staff',   category: 'communication' },
    { key: 'create-fee',          icon: 'fa-money-bill-wave',     label: 'Create Fee',         desc: 'Create a new fee record for a student', category: 'finance' },
    { key: 'generate-report',     icon: 'fa-chart-bar',           label: 'Generate Report',    desc: 'Generate academic or admin reports',   category: 'academic' },
    { key: 'add-staff',           icon: 'fa-chalkboard-teacher',  label: 'Add Staff',          desc: 'Add new teacher or staff member',       category: 'hr' },
    { key: 'schedule-event',      icon: 'fa-calendar-plus',       label: 'Schedule Event',     desc: 'Create a new school event',            category: 'events' },
    { key: 'post-announcement',   icon: 'fa-bullhorn',            label: 'Post Announcement',  desc: 'Broadcast an announcement school-wide',category: 'communication' },
    { key: 'create-assignment',   icon: 'fa-tasks',               label: 'Create Assignment',  desc: 'Create homework or class assignment',   category: 'academic' },
    { key: 'issue-certificate',   icon: 'fa-award',               label: 'Issue Certificate',  desc: 'Issue a certificate to a student',     category: 'academic' },
    { key: 'book-transport',      icon: 'fa-bus',                 label: 'Book Transport',     desc: 'Assign or book school transport',      category: 'logistics' },
    { key: 'library-checkout',    icon: 'fa-book',                label: 'Library Checkout',   desc: 'Process a library book checkout',      category: 'academic' },
    { key: 'health-checkin',      icon: 'fa-heartbeat',           label: 'Health Check-in',    desc: 'Record student health visit',          category: 'wellness' },
    { key: 'discipline-record',   icon: 'fa-gavel',               label: 'Discipline Record',  desc: 'Log a discipline incident',            category: 'student' },
    { key: 'parent-meeting',      icon: 'fa-handshake',           label: 'Parent Meeting',     desc: 'Schedule a parent-teacher meeting',    category: 'communication' },
    { key: 'send-sms',            icon: 'fa-comment-dots',        label: 'Send SMS',           desc: 'Send an SMS to contacts',              category: 'communication' },
    { key: 'upload-document',     icon: 'fa-cloud-upload-alt',    label: 'Upload Document',    desc: 'Upload a document to the portal',      category: 'admin' },
    { key: 'create-exam',         icon: 'fa-file-alt',            label: 'Create Exam',        desc: 'Create a new exam or test',            category: 'academic' },
    { key: 'grade-entry',         icon: 'fa-pen',                 label: 'Grade Entry',        desc: 'Enter grades for a class or exam',     category: 'academic' },
    { key: 'print-id-card',       icon: 'fa-id-card',             label: 'Print ID Card',      desc: 'Generate and print student ID cards',  category: 'admin' },
    { key: 'payroll',             icon: 'fa-wallet',              label: 'Process Payroll',    desc: 'Process monthly staff payroll',        category: 'finance' },
    { key: 'visitor-log',         icon: 'fa-door-open',           label: 'Visitor Log',        desc: 'Log a campus visitor entry',           category: 'admin' },
  ];

  const ACTION_MAP = Object.fromEntries(ACTIONS.map(a => [a.key, a]));
  const CATEGORIES = [...new Set(ACTIONS.map(a => a.category))];

  /* ── Inline styles ─────────────────────────────────────── */
  const CSS = `
<link rel="stylesheet" href="/css/sk.css">
<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.5.0/css/all.min.css">
<style>
  .qa-wrap{max-width:1120px;margin:0 auto;padding:24px;font-family:'Segoe UI',system-ui,sans-serif}
  .qa-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px}
  .qa-header h2{font-size:1.6rem;font-weight:700;color:#1e293b;margin:0}
  .qa-header a{color:#4f46e5;text-decoration:none;font-size:.9rem;display:inline-flex;align-items:center;gap:4px}
  .qa-header a:hover{color:#4338ca}
  /* Stats strip */
  .qa-stats{display:grid;grid-template-columns:repeat(4,1fr);gap:14px;margin-bottom:28px}
  @media(max-width:700px){.qa-stats{grid-template-columns:repeat(2,1fr)}}
  .qa-stat{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:18px;display:flex;align-items:center;gap:14px}
  .qa-stat-icon{width:44px;height:44px;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:1.1rem;flex-shrink:0}
  .qa-stat-icon.indigo{background:#eef2ff;color:#4f46e5}
  .qa-stat-icon.green{background:#dcfce7;color:#16a34a}
  .qa-stat-icon.amber{background:#fef3c7;color:#d97706}
  .qa-stat-icon.red{background:#fee2e2;color:#dc2626}
  .qa-stat-num{font-size:1.5rem;font-weight:700;color:#1e293b;line-height:1.1}
  .qa-stat-label{font-size:.78rem;color:#64748b;margin-top:2px}
  /* Search bar */
  .qa-search{display:flex;gap:12px;margin-bottom:20px;align-items:center;flex-wrap:wrap}
  .qa-search-input{flex:1;min-width:200px;padding:10px 14px 10px 40px;border:1px solid #d1d5db;border-radius:8px;font-size:.9rem;background:#fff url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='%2394a3b8' viewBox='0 0 20 20'%3E%3Cpath d='M8 4a4 4 0 100 8 4 4 0 000-8zM2 8a6 6 0 1110.89 3.476l4.817 4.817a1 1 0 01-1.414 1.414l-4.816-4.816A6 6 0 012 8z'/%3E%3C/svg%3E") no-repeat 12px center/18px;transition:border-color .2s}
  .qa-search-input:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
  .qa-cat-btn{padding:8px 16px;border:1px solid #e2e8f0;border-radius:20px;font-size:.82rem;font-weight:500;color:#475569;background:#fff;cursor:pointer;transition:all .2s;white-space:nowrap}
  .qa-cat-btn.active,.qa-cat-btn:hover{background:#4f46e5;color:#fff;border-color:#4f46e5}
  /* Action grid */
  .qa-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:16px;margin-bottom:32px}
  @media(max-width:900px){.qa-grid{grid-template-columns:repeat(3,1fr)}}
  @media(max-width:600px){.qa-grid{grid-template-columns:repeat(2,1fr)}}
  .qa-card{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px 16px;text-align:center;cursor:pointer;transition:all .2s;position:relative}
  .qa-card:hover{box-shadow:0 4px 20px rgba(79,70,229,.12);transform:translateY(-2px);border-color:#4f46e5}
  .qa-card .qa-icon{width:48px;height:48px;border-radius:12px;background:linear-gradient(135deg,#4f46e5,#7c3aed);display:flex;align-items:center;justify-content:center;margin:0 auto 10px;color:#fff;font-size:1.2rem}
  .qa-card .qa-label{font-weight:600;font-size:.92rem;color:#1e293b;margin-bottom:4px}
  .qa-card .qa-desc{font-size:.78rem;color:#64748b;line-height:1.3}
  .qa-card.hidden{display:none}
  .qa-pin{position:absolute;top:8px;right:8px;background:none;border:none;cursor:pointer;font-size:1rem;color:#cbd5e1;transition:color .2s}
  .qa-pin.pinned{color:#f59e0b}
  .qa-pin:hover{color:#f59e0b}
  /* Section */
  .qa-section{background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin-bottom:24px}
  .qa-section h3{font-size:1.1rem;font-weight:600;color:#1e293b;margin:0 0 14px}
  .qa-table{width:100%;border-collapse:collapse;font-size:.88rem}
  .qa-table th{text-align:left;padding:10px 12px;background:#f8fafc;color:#475569;font-weight:600;border-bottom:2px solid #e2e8f0}
  .qa-table td{padding:10px 12px;border-bottom:1px solid #f1f5f9;color:#334155}
  .qa-table tr:hover td{background:#f8fafc}
  /* Form */
  .qa-form{max-width:580px}
  .qa-form label{display:block;font-weight:600;font-size:.88rem;color:#374151;margin-bottom:4px;margin-top:16px}
  .qa-form label:first-child{margin-top:0}
  .qa-form input,.qa-form select,.qa-form textarea{width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px;font-size:.9rem;box-sizing:border-box;transition:border-color .2s;font-family:inherit}
  .qa-form input:focus,.qa-form select:focus,.qa-form textarea:focus{outline:none;border-color:#4f46e5;box-shadow:0 0 0 3px rgba(79,70,229,.1)}
  .qa-form .qa-row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
  @media(max-width:500px){.qa-form .qa-row{grid-template-columns:1fr}}
  /* Buttons */
  .qa-btn{display:inline-flex;align-items:center;gap:6px;padding:10px 22px;background:#4f46e5;color:#fff;border:none;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;transition:background .2s;margin-top:20px;text-decoration:none}
  .qa-btn:hover{background:#4338ca}
  .qa-btn-outline{background:transparent;border:1px solid #d1d5db;color:#374151}
  .qa-btn-outline:hover{background:#f9fafb;border-color:#4f46e5;color:#4f46e5}
  .qa-btn-danger{background:#dc2626}.qa-btn-danger:hover{background:#b91c1c}
  .qa-btn-sm{padding:6px 14px;font-size:.82rem;margin-top:0}
  /* Badges */
  .qa-badge{display:inline-block;padding:2px 10px;border-radius:20px;font-size:.74rem;font-weight:600}
  .qa-badge-green{background:#dcfce7;color:#166534}
  .qa-badge-blue{background:#dbeafe;color:#1e40af}
  .qa-badge-amber{background:#fef3c7;color:#92400e}
  .qa-badge-red{background:#fee2e2;color:#991b1b}
  .qa-badge-purple{background:#f3e8ff;color:#7c3aed}
  .qa-empty{text-align:center;color:#94a3b8;padding:32px;font-size:.9rem}
  /* Chips */
  .qa-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:10px}
  .qa-chip{padding:6px 14px;background:#f1f5f9;border:1px solid #e2e8f0;border-radius:20px;font-size:.82rem;color:#475569;cursor:pointer;transition:all .2s;user-select:none}
  .qa-chip.selected{background:#4f46e5;color:#fff;border-color:#4f46e5}
  /* Attendance rows */
  .qa-attn-grid{display:grid;gap:8px;margin-top:12px}
  .qa-attn-row{display:flex;align-items:center;gap:12px;padding:10px 14px;background:#f8fafc;border-radius:8px;border:1px solid #e2e8f0}
  .qa-attn-row .name{flex:1;font-weight:500;font-size:.88rem;color:#1e293b}
  .qa-attn-btn{padding:6px 16px;border:1px solid #d1d5db;border-radius:6px;font-size:.8rem;font-weight:600;cursor:pointer;background:#fff;transition:all .15s}
  .qa-attn-btn.present{background:#dcfce7;color:#166534;border-color:#86efac}
  .qa-attn-btn.absent{background:#fee2e2;color:#991b1b;border-color:#fca5a5}
  .qa-attn-btn.late{background:#fef3c7;color:#92400e;border-color:#fcd34d}
  .qa-attn-btn.dimmed{opacity:.35}
  /* Toast */
  .qa-toast{position:fixed;top:20px;right:20px;padding:14px 22px;border-radius:10px;color:#fff;font-weight:600;font-size:.9rem;z-index:9999;animation:qaSlideIn .3s ease;box-shadow:0 4px 14px rgba(0,0,0,.15)}
  @keyframes qaSlideIn{from{opacity:0;transform:translateY(-12px)}to{opacity:1;transform:translateY(0)}}
  .qa-count{font-size:.8rem;color:#94a3b8;margin-left:4px}
  .qa-subtitle{font-size:.95rem;color:#64748b;margin-bottom:12px;font-weight:500}
  .qa-hint{font-size:.82rem;color:#94a3b8;margin-top:6px;font-style:italic}
</style>`;

  const base = '/school/quick-actions';

  /* ── Helper: record history ────────────────────────────── */
  async function recordHistory(tenant, actionType, details, performedBy) {
    await pool.query(
      `INSERT INTO quick_action_history (tenant_id, action_type, action_details, performed_by) VALUES ($1,$2,$3,$4)`,
      [tenant, actionType, JSON.stringify(details), performedBy]);
  }

  /* ── Helper: action card HTML ──────────────────────────── */
  const INTERACTIVE = new Set([
    'add-student', 'record-attendance', 'send-message', 'create-fee'
  ]);

  function actionCard(action, isPinned) {
    const href = INTERACTIVE.has(action.key) ? `${base}/${action.key}` : `${base}/api`;
    return `<div class="qa-card" data-key="${action.key}" data-cat="${action.category}" onclick="location.href='${href}'">
      <button class="qa-pin ${isPinned ? 'pinned' : ''}" onclick="event.stopPropagation();togglePin('${action.key}',this)" title="Pin to favorites">
        <i class="fa${isPinned ? 's' : 'r'} fa-star"></i></button>
      <div class="qa-icon"><i class="fas ${action.icon}"></i></div>
      <div class="qa-label">${esc(action.label)}</div>
      <div class="qa-desc">${esc(action.desc)}</div>
    </div>`;
  }

  /* ── Shared JS snippet ─────────────────────────────────── */
  const SHARED_JS = `
<script>
function togglePin(key,btn){
  fetch('${base}/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action_type:key})})
  .then(r=>r.json()).then(d=>{
    if(d.pinned){btn.classList.add('pinned');btn.innerHTML='<i class="fas fa-star"></i>';}
    else{btn.classList.remove('pinned');btn.innerHTML='<i class="far fa-star"></i>';}
    qaToast(d.pinned?'Action pinned!':'Action unpinned','#4f46e5');
  }).catch(e=>console.error(e));
}
function qaToast(msg,bg){var t=document.createElement('div');t.className='qa-toast';t.style.background=bg||'#4f46e5';t.textContent=msg;document.body.appendChild(t);setTimeout(function(){t.remove()},2800)}
if(typeof qaToastOnce==='undefined'){qaToastOnce=true;
  ${JSON.stringify(JSON.stringify(req.session?.qaToast || null)) && ''/* placeholder — actual toast injected per-route */}
}
</script>`;

  /* ── 1. GET / — Dashboard ─────────────────────────────── */
  app.get(`${base}`, requireAuth, async (req, res) => {
    const tid = tenantId(req);
    const email = req.session?.user?.email || '';
    /* Stats */
    const todayStr = new Date().toISOString().slice(0, 10);
    const { rows: todayRows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM quick_action_history WHERE tenant_id=$1 AND created_at::date=$2`, [tid, todayStr]);
    const { rows: totalRows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM quick_action_history WHERE tenant_id=$1`, [tid]);
    const { rows: topRows } = await pool.query(
      `SELECT action_type, COUNT(*)::int AS cnt FROM quick_action_history WHERE tenant_id=$1 GROUP BY action_type ORDER BY cnt DESC LIMIT 1`, [tid]);
    const topAction = topRows[0] ? (ACTION_MAP[topRows[0].action_type] || { label: topRows[0].action_type }) : null;

    const { rows: history } = await pool.query(
      `SELECT action_type, action_details, performed_by, created_at
       FROM quick_action_history WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 10`, [tid]);
    const { rows: pins } = await pool.query(
      `SELECT action_type FROM quick_action_pins WHERE tenant_id=$1 AND user_email=$2 ORDER BY sort_order`, [tid, email]);
    const pinnedKeys = new Set(pins.map(p => p.action_type));
    const pinnedCards = [...pins].map(p => ACTION_MAP[p.action_type]).filter(Boolean);
    const unpinnedCards = ACTIONS.filter(a => !pinnedKeys.has(a.key));

    const historyHTML = history.length
      ? `<table class="qa-table"><thead><tr><th>Action</th><th>Details</th><th>By</th><th>When</th></tr></thead><tbody>
         ${history.map(h => {
           const act = ACTION_MAP[h.action_type] || { label: h.action_type, icon: 'fa-bolt' };
           const d = typeof h.action_details === 'string' ? JSON.parse(h.action_details) : (h.action_details || {});
           return `<tr><td><i class="fas ${act.icon}" style="color:#4f46e5;margin-right:6px"></i>${esc(act.label)}</td>
             <td>${esc(d.summary || '-')}</td><td>${esc(h.performed_by)}</td>
             <td>${new Date(h.created_at).toLocaleString()}</td></tr>`;
         }).join('')}</tbody></table>`
      : '<div class="qa-empty"><i class="fas fa-inbox" style="font-size:2rem;margin-bottom:8px;display:block"></i>No actions recorded yet. Start by using a quick action above.</div>';

    /* Toast from session */
    const toastData = req.session.qaToast || null;
    delete req.session.qaToast;
    const toastJS = toastData
      ? `window.addEventListener('DOMContentLoaded',function(){qaToast(${JSON.stringify(toastData.msg)},${JSON.stringify(toastData.bg)})});`
      : '';

    const body = `${CSS}<div class="qa-wrap">
      <div class="qa-header">
        <h2><i class="fas fa-bolt" style="color:#4f46e5;margin-right:8px"></i>Quick Actions</h2>
        <a href="${base}/history"><i class="fas fa-history"></i> View All History</a>
      </div>
      <!-- Stats -->
      <div class="qa-stats">
        <div class="qa-stat">
          <div class="qa-stat-icon indigo"><i class="fas fa-bolt"></i></div>
          <div><div class="qa-stat-num">${todayRows[0].cnt}</div><div class="qa-stat-label">Actions Today</div></div>
        </div>
        <div class="qa-stat">
          <div class="qa-stat-icon green"><i class="fas fa-chart-line"></i></div>
          <div><div class="qa-stat-num">${totalRows[0].cnt}</div><div class="qa-stat-label">Total Actions</div></div>
        </div>
        <div class="qa-stat">
          <div class="qa-stat-icon amber"><i class="fas fa-star"></i></div>
          <div><div class="qa-stat-num">${pinnedKeys.size}</div><div class="qa-stat-label">Pinned Actions</div></div>
        </div>
        <div class="qa-stat">
          <div class="qa-stat-icon red"><i class="fas fa-trophy"></i></div>
          <div><div class="qa-stat-num" style="font-size:1rem">${topAction ? esc(topAction.label) : 'N/A'}</div><div class="qa-stat-label">Most Used Action</div></div>
        </div>
      </div>
      ${pinnedCards.length ? `<div class="qa-subtitle"><i class="fas fa-star" style="color:#f59e0b;margin-right:4px"></i>Pinned Actions</div>
        <div class="qa-grid" style="margin-bottom:28px">${pinnedCards.map(a => actionCard(a, true)).join('')}</div>` : ''}
      <!-- Search & filter -->
      <div class="qa-search">
        <input type="text" class="qa-search-input" id="qaSearch" placeholder="Search actions..." oninput="filterActions()">
        <button class="qa-cat-btn active" data-cat="all" onclick="filterCat(this)">All</button>
        ${CATEGORIES.map(c => `<button class="qa-cat-btn" data-cat="${c}" onclick="filterCat(this)">${c.charAt(0).toUpperCase() + c.slice(1)}</button>`).join('')}
      </div>
      <div class="qa-grid" id="actionGrid">${unpinnedCards.map(a => actionCard(a, false)).join('')}</div>
      <div class="qa-section">
        <h3><i class="fas fa-clock" style="color:#4f46e5;margin-right:6px"></i>Recent Activity</h3>
        ${historyHTML}
      </div>
    </div>
    <script>
    ${toastJS}
    function filterCat(btn){
      document.querySelectorAll('.qa-cat-btn').forEach(b=>b.classList.remove('active'));
      btn.classList.add('active');
      filterActions();
    }
    function filterActions(){
      var q=document.getElementById('qaSearch').value.toLowerCase();
      var cat=document.querySelector('.qa-cat-btn.active').dataset.cat;
      document.querySelectorAll('#actionGrid .qa-card').forEach(function(c){
        var matchKey=c.dataset.key.toLowerCase().indexOf(q)>=0;
        var matchLabel=c.querySelector('.qa-label').textContent.toLowerCase().indexOf(q)>=0;
        var matchCat=cat==='all'||c.dataset.cat===cat;
        c.classList.toggle('hidden',!(matchKey||matchLabel)&&matchCat);
      });
    }
    async function togglePin(key,btn){
      try{var r=await fetch('${base}/pin',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action_type:key})});
      var d=await r.json();if(d.pinned){btn.classList.add('pinned');btn.innerHTML='<i class="fas fa-star"></i>';}else{btn.classList.remove('pinned');btn.innerHTML='<i class="far fa-star"></i>';}qaToast(d.pinned?'Action pinned!':'Action unpinned','#4f46e5');}catch(e){console.error(e)}
    }
    function qaToast(msg,bg){var t=document.createElement('div');t.className='qa-toast';t.style.background=bg||'#4f46e5';t.textContent=msg;document.body.appendChild(t);setTimeout(function(){t.remove()},2800)}
    </script>`;
    res.send(renderPage(req, 'Quick Actions', body));
  });

  /* ── 2. GET /add-student — Form ───────────────────────── */
  app.get(`${base}/add-student`, requireAuth, async (req, res) => {
    const body = `${CSS}<div class="qa-wrap">
      <div class="qa-header">
        <h2><i class="fas fa-user-plus" style="color:#4f46e5;margin-right:8px"></i>Quick Add Student</h2>
        <a href="${base}"><i class="fas fa-arrow-left"></i> Back to Actions</a>
      </div>
      <div class="qa-section">
        <p class="qa-hint">Fill in the required fields to quickly register a new student.</p>
        <form class="qa-form" method="POST">
          <label>Full Name *</label>
          <input type="text" name="name" required placeholder="Enter student's full name">
          <div class="qa-row">
            <div><label>Class / Grade *</label>
              <select name="class_name" required>
                <option value="">Select class...</option>
                ${['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'].map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
              </select></div>
            <div><label>Roll Number</label>
              <input type="text" name="roll_number" placeholder="e.g. 2024-001"></div>
          </div>
          <div class="qa-row">
            <div><label>Date of Birth</label>
              <input type="date" name="dob"></div>
            <div><label>Gender</label>
              <select name="gender"><option value="">Select...</option><option>Male</option><option>Female</option><option>Other</option></select></div>
          </div>
          <label>Parent / Guardian Name</label>
          <input type="text" name="parent_name" placeholder="Optional">
          <label>Parent / Guardian Contact *</label>
          <input type="text" name="parent_contact" required placeholder="Phone or email">
          <label>Address</label>
          <textarea name="address" rows="2" placeholder="Optional home address"></textarea>
          <button type="submit" class="qa-btn"><i class="fas fa-plus"></i> Add Student</button>
          <a href="${base}" class="qa-btn qa-btn-outline"><i class="fas fa-times"></i> Cancel</a>
        </form>
      </div>
    </div>`;
    res.send(renderPage(req, 'Quick Add Student', body));
  });

  /* ── 3. POST /add-student ─────────────────────────────── */
  app.post(`${base}/add-student`, requireAuth, async (req, res) => {
    const tid = tenantId(req);
    const { name, class_name, parent_contact, parent_name, dob, gender, roll_number, address } = req.body;
    await recordHistory(tid, 'add-student',
      { name, class_name, parent_contact, parent_name, dob, gender, roll_number, address,
        summary: `Added student: ${name} to ${class_name}` + (roll_number ? ` (${roll_number})` : '') },
      req.session?.user?.email || 'admin');
    audit(req, 'quick_action_add_student', { name, class_name, roll_number });
    req.session.qaToast = { msg: `Student "${name}" added successfully!`, bg: '#16a34a' };
    res.redirect(base);
  });

  /* ── 4. GET /record-attendance ────────────────────────── */
  app.get(`${base}/record-attendance`, requireAuth, async (req, res) => {
    const classes = ['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'];
    const today = new Date().toISOString().slice(0, 10);
    const body = `${CSS}<div class="qa-wrap">
      <div class="qa-header">
        <h2><i class="fas fa-clipboard-check" style="color:#4f46e5;margin-right:8px"></i>Record Attendance</h2>
        <a href="${base}"><i class="fas fa-arrow-left"></i> Back to Actions</a>
      </div>
      <div class="qa-section">
        <p class="qa-hint">Select a class and mark each student as Present, Absent, or Late.</p>
        <form class="qa-form" method="POST" id="attnForm">
          <div class="qa-row">
            <div><label>Class *</label>
              <select name="class_name" required onchange="loadStudents(this.value)">
                <option value="">Select class...</option>
                ${classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}
              </select></div>
            <div><label>Date *</label>
              <input type="date" name="date" value="${today}" required></div>
          </div>
          <div id="studentList"></div>
          <button type="button" class="qa-btn qa-btn-outline qa-btn-sm" id="markAllBtn" style="display:none" onclick="markAll()">Mark All Present</button>
          <button type="submit" class="qa-btn" id="submitBtn" disabled><i class="fas fa-check"></i> Save Attendance</button>
        </form>
      </div>
    </div>
    <script>
    var demoStudents={
      'Grade 1':['Alice Johnson','Bob Smith','Carol Davis','David Wilson','Emma Brown','Fred Torres'],
      'Grade 2':['Frank Miller','Grace Lee','Henry Clark','Iris Taylor','Jack Anderson','Karen Lopez'],
      'Grade 3':['Leo Harris','Maria Martin','Nathan Robinson','Olivia Thomas','Paula Lewis','Quinn Adams'],
      'Grade 4':['Rachel Evans','Sam Carter','Tina Foster','Uma Garcia','Victor Hill','Wendy Allen'],
      'Grade 5':['Xavier Young','Yara King','Zach Brown','Amy Chen','Brian Lee','Cathy Park'],
      'Grade 6':['Daniel Kim','Elena Ruiz','Felix Moore','Gina Patel','Hugo Silva','Irene Walsh'],
      'Grade 7':['James Ng','Kelly Zhao','Liam O\'Brien','Mia Sato','Noel Fischer','Priya Das'],
      'Grade 8':['Ryan Scott','Sara Ahmed','Tom Grant','Uma Shah','Vera Volkov','Will Haynes']
    };
    function loadStudents(cls){
      var box=document.getElementById('studentList');
      var btn=document.getElementById('submitBtn');
      var markAll=document.getElementById('markAllBtn');
      var list=demoStudents[cls]||[];
      if(!list.length){box.innerHTML='<p style="color:#94a3b8;margin-top:12px">Select a class to see students.</p>';btn.disabled=true;markAll.style.display='none';return;}
      btn.disabled=false;markAll.style.display='inline-flex';
      box.innerHTML='<label>Students ('+list.length+')</label><div class="qa-attn-grid">'+list.map(function(s,i){
        return '<div class="qa-attn-row"><span class="name">'+s+'</span>'
          +'<button type="button" class="qa-attn-btn present" onclick="mark(this,\\'present\\',\\'+i+\\')">Present</button>'
          +'<button type="button" class="qa-attn-btn late" onclick="mark(this,\\'late\\',\\'+i+\\')">Late</button>'
          +'<button type="button" class="qa-attn-btn absent" onclick="mark(this,\\'absent\\',\\'+i+\\')">Absent</button>'
          +'<input type="hidden" name="att_'+i+'" value="present"></div>';
      }).join('')+'</div>';
    }
    function mark(btn,status,idx){
      var row=btn.closest('.qa-attn-row');
      row.querySelectorAll('.qa-attn-btn').forEach(function(b){b.classList.add('dimmed')});
      btn.classList.remove('dimmed');
      row.querySelector('input[type=hidden]').value=status;
    }
    function markAll(){
      document.querySelectorAll('#studentList .qa-attn-row').forEach(function(row){
        row.querySelectorAll('.qa-attn-btn').forEach(function(b){b.classList.add('dimmed')});
        row.querySelector('.qa-attn-btn.present').classList.remove('dimmed');
        row.querySelector('input[type=hidden]').value='present';
      });
      qaToast('All marked as present','#16a34a');
    }
    function qaToast(msg,bg){var t=document.createElement('div');t.className='qa-toast';t.style.background=bg||'#4f46e5';t.textContent=msg;document.body.appendChild(t);setTimeout(function(){t.remove()},2800)}
    </script>`;
    res.send(renderPage(req, 'Record Attendance', body));
  });

  /* ── 5. POST /record-attendance ───────────────────────── */
  app.post(`${base}/record-attendance`, requireAuth, async (req, res) => {
    const tid = tenantId(req);
    const { class_name, date } = req.body;
    const records = [];
    for (const [key, val] of Object.entries(req.body)) {
      if (key.startsWith('att_')) records.push(val);
    }
    const present = records.filter(r => r === 'present').length;
    const late = records.filter(r => r === 'late').length;
    const absent = records.length - present - late;
    await recordHistory(tid, 'record-attendance',
      { class_name, date, total: records.length, present, late, absent,
        summary: `${class_name} on ${date}: ${present}P / ${late}L / ${absent}A` },
      req.session?.user?.email || 'admin');
    audit(req, 'quick_action_attendance', { class_name, date, present, late, absent });
    req.session.qaToast = { msg: `Attendance saved: ${present} present, ${late} late, ${absent} absent`, bg: '#16a34a' };
    res.redirect(base);
  });

  /* ── 6. GET /send-message ─────────────────────────────── */
  app.get(`${base}/send-message`, requireAuth, async (req, res) => {
    const body = `${CSS}<div class="qa-wrap">
      <div class="qa-header">
        <h2><i class="fas fa-envelope" style="color:#4f46e5;margin-right:8px"></i>Send Message</h2>
        <a href="${base}"><i class="fas fa-arrow-left"></i> Back to Actions</a>
      </div>
      <div class="qa-section">
        <p class="qa-hint">Select one or more recipient groups, compose your message, and queue it for delivery.</p>
        <form class="qa-form" method="POST">
          <label>Recipients</label>
          <div class="qa-chips" id="recipChips">
            <span class="qa-chip" onclick="toggleChip(this)" data-val="all-parents"><i class="fas fa-users" style="margin-right:4px"></i>All Parents</span>
            <span class="qa-chip" onclick="toggleChip(this)" data-val="all-staff"><i class="fas fa-user-tie" style="margin-right:4px"></i>All Staff</span>
            <span class="qa-chip" onclick="toggleChip(this)" data-val="grade-1">Grade 1</span>
            <span class="qa-chip" onclick="toggleChip(this)" data-val="grade-2">Grade 2</span>
            <span class="qa-chip" onclick="toggleChip(this)" data-val="grade-3">Grade 3</span>
            <span class="qa-chip" onclick="toggleChip(this)" data-val="grade-5">Grade 5</span>
            <span class="qa-chip" onclick="toggleChip(this)" data-val="grade-8">Grade 8</span>
            <span class="qa-chip" onclick="toggleChip(this)" data-val="grade-10">Grade 10</span>
            <span class="qa-chip" onclick="toggleChip(this)" data-val="grade-12">Grade 12</span>
          </div>
          <input type="hidden" name="recipients" id="recipInput" value="">
          <div class="qa-row">
            <div><label>Message Type</label>
              <select name="msg_type"><option value="general">General Notice</option><option value="urgent">Urgent Alert</option><option value="fee">Fee Reminder</option><option value="event">Event Invitation</option></select></div>
            <div><label>Priority</label>
              <select name="priority"><option value="normal">Normal</option><option value="high">High</option><option value="low">Low</option></select></div>
          </div>
          <label>Subject *</label>
          <input type="text" name="subject" required placeholder="Message subject">
          <label>Message Body *</label>
          <textarea name="body" rows="5" required placeholder="Type your message here..."></textarea>
          <label>Schedule (optional)</label>
          <input type="datetime-local" name="scheduled_at">
          <p class="qa-hint">Leave blank to send immediately.</p>
          <button type="submit" class="qa-btn"><i class="fas fa-paper-plane"></i> Queue Message</button>
          <a href="${base}" class="qa-btn qa-btn-outline"><i class="fas fa-times"></i> Cancel</a>
        </form>
      </div>
    </div>
    <script>
    function toggleChip(el){
      el.classList.toggle('selected');
      var s=[];document.querySelectorAll('.qa-chip.selected').forEach(function(c){s.push(c.dataset.val)});
      document.getElementById('recipInput').value=s.join(',');
    }
    </script>`;
    res.send(renderPage(req, 'Send Message', body));
  });

  /* ── 7. POST /send-message ────────────────────────────── */
  app.post(`${base}/send-message`, requireAuth, async (req, res) => {
    const tid = tenantId(req);
    const { recipients, msg_type, subject, body, priority, scheduled_at } = req.body;
    await recordHistory(tid, 'send-message',
      { recipients, msg_type, subject, priority, scheduled_at,
        summary: `Message to "${recipients}": ${subject}` },
      req.session?.user?.email || 'admin');
    audit(req, 'quick_action_send_message', { recipients, msg_type, subject });
    req.session.qaToast = { msg: `Message queued to "${recipients}"`, bg: '#16a34a' };
    res.redirect(base);
  });

  /* ── 8. GET /create-fee ───────────────────────────────── */
  app.get(`${base}/create-fee`, requireAuth, async (req, res) => {
    const body = `${CSS}<div class="qa-wrap">
      <div class="qa-header">
        <h2><i class="fas fa-money-bill-wave" style="color:#4f46e5;margin-right:8px"></i>Create Fee Record</h2>
        <a href="${base}"><i class="fas fa-arrow-left"></i> Back to Actions</a>
      </div>
      <div class="qa-section">
        <p class="qa-hint">Create a new fee record. The entry will be saved to the action history for tracking.</p>
        <form class="qa-form" method="POST">
          <label>Student Name *</label>
          <input type="text" name="student_name" required placeholder="Enter student name">
          <label>Class</label>
          <select name="class_name">
            <option value="">Select class (optional)</option>
            ${['Grade 1','Grade 2','Grade 3','Grade 4','Grade 5','Grade 6','Grade 7','Grade 8','Grade 9','Grade 10','Grade 11','Grade 12'].map(c => `<option>${esc(c)}</option>`).join('')}
          </select>
          <div class="qa-row">
            <div><label>Fee Type *</label>
              <select name="fee_type" required>
                <option value="">Select type...</option>
                <option value="tuition">Tuition Fee</option><option value="transport">Transport Fee</option>
                <option value="library">Library Fee</option><option value="lab">Lab Fee</option>
                <option value="sports">Sports Fee</option><option value="exam">Exam Fee</option>
                <option value="uniform">Uniform Fee</option><option value="other">Other</option>
              </select></div>
            <div><label>Payment Method</label>
              <select name="payment_method">
                <option value="cash">Cash</option><option value="bank">Bank Transfer</option>
                <option value="online">Online Payment</option><option value="cheque">Cheque</option>
              </select></div>
          </div>
          <div class="qa-row">
            <div><label>Amount *</label>
              <input type="number" name="amount" required min="0" step="0.01" placeholder="0.00"></div>
            <div><label>Due Date</label>
              <input type="date" name="due_date"></div>
          </div>
          <label>Notes</label>
          <textarea name="notes" rows="3" placeholder="Optional notes about this fee..."></textarea>
          <button type="submit" class="qa-btn"><i class="fas fa-save"></i> Create Fee Record</button>
          <a href="${base}" class="qa-btn qa-btn-outline"><i class="fas fa-times"></i> Cancel</a>
        </form>
      </div>
    </div>`;
    res.send(renderPage(req, 'Create Fee Record', body));
  });

  /* ── 9. POST /create-fee ──────────────────────────────── */
  app.post(`${base}/create-fee`, requireAuth, async (req, res) => {
    const tid = tenantId(req);
    const { student_name, class_name, fee_type, amount, due_date, payment_method, notes } = req.body;
    await recordHistory(tid, 'create-fee',
      { student_name, class_name, fee_type, amount, due_date, payment_method, notes,
        summary: `${fee_type} fee of $${amount} for ${student_name}` + (class_name ? ` (${class_name})` : '') },
      req.session?.user?.email || 'admin');
    audit(req, 'quick_action_create_fee', { student_name, class_name, fee_type, amount });
    req.session.qaToast = { msg: `Fee record created: $${amount} for ${student_name}`, bg: '#16a34a' };
    res.redirect(base);
  });

  /* ── 10. POST /pin — Toggle pin ───────────────────────── */
  app.post(`${base}/pin`, requireAuth, async (req, res) => {
    const tid = tenantId(req);
    const email = req.session?.user?.email || '';
    const { action_type } = req.body;
    if (!action_type) return res.json({ error: 'Missing action_type' });
    const { rows: existing } = await pool.query(
      `SELECT id FROM quick_action_pins WHERE tenant_id=$1 AND user_email=$2 AND action_type=$3`,
      [tid, email, action_type]);
    if (existing.length) {
      await pool.query(`DELETE FROM quick_action_pins WHERE id=$1`, [existing[0].id]);
      audit(req, 'quick_action_unpin', { action_type });
      res.json({ pinned: false });
    } else {
      const { rows: maxOrd } = await pool.query(
        `SELECT COALESCE(MAX(sort_order),0)+1 AS nxt FROM quick_action_pins WHERE tenant_id=$1 AND user_email=$2`, [tid, email]);
      await pool.query(
        `INSERT INTO quick_action_pins (tenant_id, user_email, action_type, sort_order) VALUES ($1,$2,$3,$4)`,
        [tid, email, action_type, maxOrd[0].nxt]);
      audit(req, 'quick_action_pin', { action_type });
      res.json({ pinned: true });
    }
  });

  /* ── 11. GET /history ─────────────────────────────────── */
  app.get(`${base}/history`, requireAuth, async (req, res) => {
    const tid = tenantId(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const filterType = req.query.type || '';

    let whereClause = 'WHERE tenant_id=$1';
    const params = [tid];
    if (filterType) { whereClause += ' AND action_type=$2'; params.push(filterType); }

    const { rows } = await pool.query(
      `SELECT action_type, action_details, performed_by, created_at
       FROM quick_action_history ${whereClause} ORDER BY created_at DESC LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]);
    const { rows: countRes } = await pool.query(
      `SELECT COUNT(*) AS total FROM quick_action_history ${whereClause}`, params);
    const total = parseInt(countRes[0].total);
    const totalPages = Math.max(1, Math.ceil(total / limit));

    const typeBadge = (t) => {
      const map = {
        'add-student': 'qa-badge-green', 'add-staff': 'qa-badge-green',
        'record-attendance': 'qa-badge-blue', 'send-message': 'qa-badge-amber',
        'send-sms': 'qa-badge-amber', 'create-fee': 'qa-badge-red',
        'payroll': 'qa-badge-red', 'generate-report': 'qa-badge-purple',
      };
      const cls = map[t] || 'qa-badge-blue';
      return `<span class="qa-badge ${cls}">${t.replace(/-/g, ' ')}</span>`;
    };

    const filterBtns = ACTIONS.slice(0, 8).map(a =>
      `<button class="qa-cat-btn ${filterType === a.key ? 'active' : ''}" onclick="location.href='${base}/history?type=${a.key}&page=1'" style="font-size:.78rem;padding:4px 12px">${esc(a.label)}</button>`
    ).join('') + (filterType ? ` <a href="${base}/history" class="qa-btn qa-btn-outline qa-btn-sm"><i class="fas fa-times"></i> Clear</a>` : '');

    const rowsHTML = rows.length
      ? rows.map(h => {
          const act = ACTION_MAP[h.action_type] || { label: h.action_type, icon: 'fa-bolt' };
          const d = typeof h.action_details === 'string' ? JSON.parse(h.action_details) : (h.action_details || {});
          return `<tr><td>${typeBadge(h.action_type)}</td>
            <td><i class="fas ${act.icon}" style="color:#4f46e5;margin-right:6px"></i>${esc(act.label)}</td>
            <td>${esc(d.summary || '-')}</td><td>${esc(h.performed_by)}</td>
            <td>${new Date(h.created_at).toLocaleString()}</td></tr>`;
        }).join('')
      : `<tr><td colspan="5" class="qa-empty">No actions recorded yet.</td></tr>`;

    const pagination = totalPages > 1
      ? `<div style="display:flex;gap:6px;justify-content:center;margin-top:16px;align-items:center">
         ${page > 1 ? `<a href="${base}/history?type=${filterType}&page=${page - 1}" class="qa-btn qa-btn-outline qa-btn-sm"><i class="fas fa-chevron-left"></i></a>` : ''}
         <span style="font-size:.85rem;color:#64748b">Page ${page} of ${totalPages}</span>
         ${page < totalPages ? `<a href="${base}/history?type=${filterType}&page=${page + 1}" class="qa-btn qa-btn-outline qa-btn-sm"><i class="fas fa-chevron-right"></i></a>` : ''}
         </div>` : '';

    const body = `${CSS}<div class="qa-wrap">
      <div class="qa-header">
        <h2><i class="fas fa-history" style="color:#4f46e5;margin-right:8px"></i>Action History</h2>
        <a href="${base}"><i class="fas fa-arrow-left"></i> Back to Actions</a>
      </div>
      <div class="qa-section">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;flex-wrap:wrap;gap:10px">
          <h3 style="margin:0">All Quick Actions <span class="qa-count">${total} total</span></h3>
        </div>
        <div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:16px">${filterBtns}</div>
        <div style="overflow-x:auto">
        <table class="qa-table"><thead><tr><th>Type</th><th>Action</th><th>Details</th><th>By</th><th>Date</th></tr></thead>
        <tbody>${rowsHTML}</tbody></table></div>
        ${pagination}
      </div>
    </div>`;
    res.send(renderPage(req, 'Action History', body));
  });

  /* ── 12. GET /api — JSON catalog ──────────────────────── */
  app.get(`${base}/api`, requireAuth, async (req, res) => {
    const tid = tenantId(req);
    const email = req.session?.user?.email || '';
    const { rows: pins } = await pool.query(
      `SELECT action_type FROM quick_action_pins WHERE tenant_id=$1 AND user_email=$2 ORDER BY sort_order`, [tid, email]);
    const pinnedKeys = new Set(pins.map(p => p.action_type));
    const { rows: todayRows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM quick_action_history WHERE tenant_id=$1 AND created_at::date=NOW()::date`, [tid]);
    const { rows: totalRows } = await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM quick_action_history WHERE tenant_id=$1`, [tid]);
    res.json({
      actions: ACTIONS.map(a => ({ ...a, pinned: pinnedKeys.has(a.key), href: INTERACTIVE.has(a.key) ? `${base}/${a.key}` : null })),
      pinned: pins.map(p => p.action_type),
      stats: { today: todayRows[0].cnt, total: totalRows[0].cnt, pinnedCount: pinnedKeys.size },
      prefix: base,
      categories: CATEGORIES
    });
  });
};
