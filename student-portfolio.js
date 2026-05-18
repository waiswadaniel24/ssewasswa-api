// ============================================================
// STUDENT PORTFOLIO & SHOWCASE MODULE
// Digital student portfolio system for university applications
// Multi-Tenant SaaS Platform
// ============================================================
// IMPORTANT: Add these tables to VALID_TABLES in server.js:
//   student_portfolios, portfolio_projects, portfolio_activities,
//   portfolio_skills, portfolio_achievements, portfolio_endorsements
//
// Usage in server.js:
//   const studentPortfolio = require('./student-portfolio');
//   studentPortfolio(app, pool, { esc, renderPage, requireAuth, ah, audit });
// ============================================================

'use strict';

module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});

  // ── Internal helpers ────────────────────────────────────────
  const uuid = () => require('crypto').randomBytes(16).toString('hex');
  const parseNum = (v, fb=0) => { const n = parseFloat(v); return isNaN(n) ? fb : n; };
  const parseJson = (v, fb={}) => { try { return typeof v === 'string' ? JSON.parse(v) : (v || fb); } catch(e) { return fb; } };
  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-US',{year:'numeric',month:'short',day:'numeric'}) : '';
  const today = () => new Date().toISOString().slice(0,10);
  const COLORS = {
    primary: '#4f46e5', primaryLight: '#818cf8', primaryBg: '#eef2ff',
    success: '#059669', successBg: '#ecfdf5', warning: '#f59e0b', warningBg: '#fffbeb',
    danger: '#dc2626', dangerBg: '#fef2f2', gray: '#64748b', grayLight: '#94a3b8',
    grayBg: '#f1f5f9', dark: '#1e293b', white: '#ffffff', border: '#e2e8f0'
  };

  // ── Shared CSS ──────────────────────────────────────────────
  const PORTFOLIO_CSS = `<style>
  .pf-nav{display:flex;gap:6px;margin-bottom:24px;flex-wrap:wrap}
  .pf-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:${COLORS.gray};background:${COLORS.grayBg};transition:.15s}
  .pf-nav a:hover{background:#e2e8f0}
  .pf-nav a.active{background:${COLORS.primary};color:#fff}
  .pf-section{background:#fff;border:1px solid ${COLORS.border};border-radius:14px;padding:24px;margin-bottom:20px}
  .pf-section h3{font-size:17px;color:${COLORS.dark};margin:0 0 16px;font-weight:700}
  .pf-grid{display:grid;gap:16px}
  .pf-grid-2{grid-template-columns:1fr 1fr}
  .pf-grid-3{grid-template-columns:1fr 1fr 1fr}
  .pf-grid-4{grid-template-columns:repeat(4,1fr)}
  .pf-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
  .pf-btn:hover{opacity:.9;transform:translateY(-1px)}
  .pf-btn-primary{background:${COLORS.primary};color:#fff}
  .pf-btn-success{background:${COLORS.success};color:#fff}
  .pf-btn-danger{background:${COLORS.dangerBg};color:${COLORS.danger}}
  .pf-btn-secondary{background:${COLORS.grayBg};color:${COLORS.gray}}
  .pf-btn-outline{background:transparent;color:${COLORS.primary};border:2px solid ${COLORS.primary}}
  .pf-form label{display:block;font-size:13px;font-weight:600;color:${COLORS.gray};margin-bottom:4px}
  .pf-form input,.pf-form select,.pf-form textarea{width:100%;padding:10px 14px;border:2px solid ${COLORS.border};border-radius:10px;font-size:14px;box-sizing:border-box;background:#fff}
  .pf-form input:focus,.pf-form select:focus,.pf-form textarea:focus{outline:none;border-color:${COLORS.primaryLight}}
  .pf-stat{background:#fff;border:1px solid ${COLORS.border};border-radius:12px;padding:18px;text-align:center}
  .pf-stat-num{font-size:28px;font-weight:800;color:${COLORS.dark};line-height:1.2}
  .pf-stat-label{font-size:11px;color:${COLORS.grayLight};font-weight:600;margin-top:2px}
  .pf-table{width:100%;border-collapse:collapse;font-size:13px}
  .pf-table th{padding:10px 14px;text-align:left;border-bottom:2px solid ${COLORS.border};color:${COLORS.gray};font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:${COLORS.grayBg}}
  .pf-table td{padding:9px 14px;border-bottom:1px solid #f1f5f9;color:${COLORS.dark}}
  .pf-table tr:hover{background:#f8fafc}
  .pf-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
  .pf-timeline{position:relative;padding-left:28px}
  .pf-timeline::before{content:'';position:absolute;left:10px;top:0;bottom:0;width:2px;background:${COLORS.border}}
  .pf-timeline-item{position:relative;margin-bottom:18px;padding:14px 18px;background:#fff;border:1px solid ${COLORS.border};border-radius:12px}
  .pf-timeline-item::before{content:'';position:absolute;left:-22px;top:18px;width:12px;height:12px;border-radius:50%;background:${COLORS.primary};border:2px solid #fff;box-shadow:0 0 0 2px ${COLORS.primaryLight}}
  .pf-timeline-date{font-size:11px;color:${COLORS.grayLight};font-weight:600;margin-bottom:4px}
  .pf-timeline-title{font-size:14px;color:${COLORS.dark};font-weight:700;margin-bottom:2px}
  .pf-timeline-desc{font-size:12px;color:${COLORS.gray};line-height:1.5}
  .pf-card{background:#fff;border:1px solid ${COLORS.border};border-radius:14px;overflow:hidden;transition:.2s;cursor:pointer}
  .pf-card:hover{box-shadow:0 4px 16px rgba(0,0,0,.08);border-color:${COLORS.primaryLight};transform:translateY(-2px)}
  .pf-card-thumb{width:100%;height:160px;background:${COLORS.grayBg};display:flex;align-items:center;justify-content:center;font-size:40px;overflow:hidden;position:relative}
  .pf-card-thumb img{width:100%;height:100%;object-fit:cover}
  .pf-card-body{padding:14px}
  .pf-card-title{font-size:14px;font-weight:700;color:${COLORS.dark};margin-bottom:4px}
  .pf-card-desc{font-size:12px;color:${COLORS.gray};line-height:1.4;margin-bottom:8px}
  .pf-card-meta{display:flex;gap:6px;flex-wrap:wrap}
  .pf-tag{display:inline-block;padding:2px 8px;border-radius:6px;font-size:10px;font-weight:600;background:${COLORS.primaryBg};color:${COLORS.primary}}
  .pf-progress-bar{width:100%;height:8px;background:${COLORS.grayBg};border-radius:4px;overflow:hidden}
  .pf-progress-fill{height:100%;border-radius:4px;transition:width .3s}
  .pf-avatar{width:64px;height:64px;border-radius:50%;background:${COLORS.grayBg};display:flex;align-items:center;justify-content:center;font-size:28px;overflow:hidden;border:3px solid ${COLORS.primaryLight}}
  .pf-avatar img{width:100%;height:100%;object-fit:cover}
  .pf-avatar-lg{width:100px;height:100px;font-size:44px}
  .pf-endorsement{display:flex;align-items:center;gap:12px;padding:12px;background:${COLORS.primaryBg};border-radius:12px;margin-bottom:8px}
  .pf-endorsement-avatar{width:36px;height:36px;border-radius:50%;background:${COLORS.primary};color:#fff;display:flex;align-items:center;justify-content:center;font-size:14px;font-weight:700}
  .pf-achievement-icon{width:56px;height:56px;border-radius:14px;display:flex;align-items:center;justify-content:center;font-size:28px}
  .pf-shield{display:inline-flex;align-items:center;gap:6px;padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700}
  @media(max-width:768px){
    .pf-grid-2,.pf-grid-3,.pf-grid-4{grid-template-columns:1fr}
    .pf-nav{gap:4px}.pf-nav a{padding:6px 10px;font-size:11px}
  }
  @media print{
    .pf-nav,.pf-btn,.no-print{display:none!important}
    body{background:#fff!important;-webkit-print-color-adjust:exact;print-color-adjust:exact}
    .pf-section{break-inside:avoid;box-shadow:none}
  }
  </style>`;

  // ── Navigation builder ──────────────────────────────────────
  const pfNav = (active, studentId) => `<div class="pf-nav">
    <a href="/portfolio/${studentId}" class="${active==='overview'?'active':''}">📋 Overview</a>
    <a href="/portfolio/${studentId}/academic" class="${active==='academic'?'active':''}">📚 Academic</a>
    <a href="/portfolio/${studentId}/projects" class="${active==='projects'?'active':''}">📁 Projects</a>
    <a href="/portfolio/${studentId}/activities" class="${active==='activities'?'active':''}">🎯 Activities</a>
    <a href="/portfolio/${studentId}/skills" class="${active==='skills'?'active':''}">⚡ Skills</a>
    <a href="/portfolio/${studentId}/achievements" class="${active==='achievements'?'active':''}">🏆 Achievements</a>
    <a href="/portfolio/${studentId}/share" class="${active==='share'?'active':''}">🔗 Share</a>
    <a href="/portfolio/${studentId}/university" class="${active==='university'?'active':''}">🎓 University</a>
  </div>`;

  // ── SVG Line Chart (GPA Trend) ──────────────────────────────
  const svgLineChart = (data, w=500, h=180) => {
    if (!data || data.length < 2) return '<div style="color:'+COLORS.grayLight+';font-size:13px;padding:20px;text-align:center">Add at least 2 semesters to see the GPA trend</div>';
    const pad = {t:20,r:20,b:35,l:40};
    const cw = w - pad.l - pad.r, ch = h - pad.t - pad.b;
    const vals = data.map(d => d.value);
    const minV = Math.floor(Math.min(...vals) * 10) / 10;
    const maxV = Math.ceil(Math.max(...vals) * 10) / 10 + 0.1;
    const range = Math.max(maxV - minV, 0.5);
    const pts = data.map((d,i) => {
      const x = pad.l + (data.length === 1 ? cw/2 : (i/(data.length-1))*cw);
      const y = pad.t + ch - ((d.value - minV)/range)*ch;
      return {x,y,...d};
    });
    const line = pts.map((p,i) => (i===0?'M':'L')+p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ');
    const area = line + ` L${pts[pts.length-1].x.toFixed(1)},${pad.t+ch} L${pad.l},${pad.t+ch} Z`;
    const gridLines = 4;
    let gridSvg = '';
    for (let i=0;i<=gridLines;i++){
      const y = pad.t + (i/gridLines)*ch;
      const v = maxV - (i/gridLines)*range;
      gridSvg += `<line x1="${pad.l}" y1="${y}" x2="${w-pad.r}" y2="${y}" stroke="#e2e8f0" stroke-dasharray="4"/>`;
      gridSvg += `<text x="${pad.l-6}" y="${y+4}" text-anchor="end" fill="#94a3b8" font-size="10">${v.toFixed(1)}</text>`;
    }
    return `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px" role="img" aria-label="GPA trend line chart">
      <defs><linearGradient id="gpaGrad" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="#4f46e5" stop-opacity="0.25"/><stop offset="100%" stop-color="#4f46e5" stop-opacity="0.02"/></linearGradient></defs>
      ${gridSvg}
      <path d="${area}" fill="url(#gpaGrad)"/>
      <polyline points="${pts.map(p=>p.x.toFixed(1)+','+p.y.toFixed(1)).join(' ')}" fill="none" stroke="#4f46e5" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${pts.map(p=>`<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="5" fill="#fff" stroke="#4f46e5" stroke-width="2.5"><title>${esc(p.label)}: ${p.value.toFixed(2)}</title></circle>`).join('')}
      ${pts.map(p=>`<text x="${p.x.toFixed(1)}" y="${pad.t+ch+16}" text-anchor="middle" fill="#64748b" font-size="10" font-weight="600">${esc(p.label)}</text>`).join('')}
    </svg>`;
  };

  // ── SVG Radar Chart (Skills) ────────────────────────────────
  const svgRadarChart = (skills, w=320, h=320) => {
    if (!skills || skills.length < 3) return '<div style="color:'+COLORS.grayLight+';font-size:13px;padding:20px;text-align:center">Add at least 3 skills to see the radar chart</div>';
    const cx = w/2, cy = h/2, r = Math.min(w,h)/2 - 40;
    const n = skills.length;
    const angleStep = (2*Math.PI)/n;
    const levels = 5;
    let svg = `<svg viewBox="0 0 ${w} ${h}" style="width:100%;max-width:${w}px" role="img" aria-label="Skills radar chart">`;
    // Grid rings
    for (let l=1;l<=levels;l++){
      const lr = (l/levels)*r;
      const pts = [];
      for (let i=0;i<n;i++){
        const a = angleStep*i - Math.PI/2;
        pts.push(`${(cx+lr*Math.cos(a)).toFixed(1)},${(cy+lr*Math.sin(a)).toFixed(1)}`);
      }
      svg += `<polygon points="${pts.join(' ')}" fill="none" stroke="#e2e8f0" stroke-width="1"/>`;
    }
    // Axis lines + labels
    for (let i=0;i<n;i++){
      const a = angleStep*i - Math.PI/2;
      const ex = cx+r*Math.cos(a), ey = cy+r*Math.sin(a);
      svg += `<line x1="${cx}" y1="${cy}" x2="${ex.toFixed(1)}" y2="${ey.toFixed(1)}" stroke="#e2e8f0" stroke-width="1"/>`;
      const lx = cx+(r+22)*Math.cos(a), ly = cy+(r+22)*Math.sin(a);
      svg += `<text x="${lx.toFixed(1)}" y="${ly.toFixed(1)}" text-anchor="middle" dominant-baseline="middle" fill="#475569" font-size="11" font-weight="600">${esc(skills[i].label)}</text>`;
    }
    // Data polygon
    const dataPts = skills.map((s,i) => {
      const a = angleStep*i - Math.PI/2;
      const v = (parseNum(s.value,0)/100)*r;
      return `${(cx+v*Math.cos(a)).toFixed(1)},${(cy+v*Math.sin(a)).toFixed(1)}`;
    });
    svg += `<polygon points="${dataPts.join(' ')}" fill="rgba(79,70,229,0.15)" stroke="#4f46e5" stroke-width="2.5"/>`;
    skills.forEach((s,i) => {
      const a = angleStep*i - Math.PI/2;
      const v = (parseNum(s.value,0)/100)*r;
      const px = cx+v*Math.cos(a), py = cy+v*Math.sin(a);
      svg += `<circle cx="${px.toFixed(1)}" cy="${py.toFixed(1)}" r="4" fill="#4f46e5" stroke="#fff" stroke-width="2"><title>${esc(s.label)}: ${s.value}%</title></circle>`;
    });
    svg += '</svg>';
    return svg;
  };

  // ── SVG Progress Ring ───────────────────────────────────────
  const svgProgressRing = (pct, size=80, strokeW=8) => {
    const r = (size - strokeW) / 2;
    const circ = 2 * Math.PI * r;
    const offset = circ - (Math.min(100,Math.max(0,pct))/100) * circ;
    const color = pct >= 80 ? COLORS.success : pct >= 50 ? COLORS.warning : COLORS.danger;
    return `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${pct}% complete">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="#e2e8f0" stroke-width="${strokeW}"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="${strokeW}"
        stroke-dasharray="${circ}" stroke-dashoffset="${offset}" stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"/>
      <text x="${size/2}" y="${size/2}" text-anchor="middle" dominant-baseline="middle" fill="${COLORS.dark}" font-size="16" font-weight="800">${Math.round(pct)}%</text>
    </svg>`;
  };

  // ── Simple QR Code (SVG placeholder) ────────────────────────
  const svgQRCode = (url, size=120) => {
    const cells = [];
    const hash = url.split('').reduce((a,c)=>((a<<5)-a)+c.charCodeAt(0),0);
    for (let y=0;y<21;y++) for (let x=0;x<21;x++){
      const isCorner = (x<7&&y<7)||(x>13&&y<7)||(x<7&&y>13);
      const isInner = isCorner && x>1&&x<5&&y>1&&y<5;
      const isData = !isCorner && ((hash*(x*21+y+1))%3 !== 0);
      if (isCorner && !isInner || isData) cells.push(`<rect x="${x*5}" y="${y*5}" width="5" height="5" fill="#1e293b"/>`);
    }
    const actualSize = 21*5+10;
    return `<svg viewBox="0 0 ${actualSize} ${actualSize}" width="${size}" height="${size}" role="img" aria-label="QR code for sharing">
      <rect width="${actualSize}" height="${actualSize}" fill="#fff" rx="4"/>${cells.join('')}
    </svg>`;
  };

  // ============================================================
  // DATABASE MIGRATIONS
  // ============================================================
  (async () => {
    const c = await pool.connect().catch(() => null);
    if (!c) { console.error('[StudentPortfolio] Cannot connect to DB'); return; }
    try {
      await c.query(`CREATE TABLE IF NOT EXISTS student_portfolios (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        student_id INTEGER NOT NULL, user_id INTEGER,
        display_name VARCHAR(255), photo_url TEXT, class_name VARCHAR(100),
        bio TEXT, interests TEXT[], goals TEXT[],
        gpa_data JSONB DEFAULT '[]', academic_awards JSONB DEFAULT '[]',
        subject_performance JSONB DEFAULT '{}',
        is_public BOOLEAN DEFAULT false, share_token VARCHAR(64) UNIQUE,
        completeness_score INTEGER DEFAULT 0, last_updated TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS portfolio_projects (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        portfolio_id INTEGER REFERENCES student_portfolios(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL, description TEXT,
        category VARCHAR(50) DEFAULT 'essay', file_url TEXT, thumbnail_url TEXT,
        tags TEXT[] DEFAULT '{}', date_completed DATE,
        featured BOOLEAN DEFAULT false, sort_order INTEGER DEFAULT 0,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS portfolio_activities (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        portfolio_id INTEGER REFERENCES student_portfolios(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        activity_name VARCHAR(255) NOT NULL, activity_type VARCHAR(50) DEFAULT 'club',
        description TEXT, organization VARCHAR(255), role VARCHAR(100),
        start_date DATE, end_date DATE, hours_per_week INTEGER,
        achievements TEXT, created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS portfolio_skills (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        portfolio_id INTEGER REFERENCES student_portfolios(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        skill_name VARCHAR(100) NOT NULL, self_rating INTEGER DEFAULT 50 CHECK (self_rating BETWEEN 0 AND 100),
        category VARCHAR(50) DEFAULT 'soft', evidence TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(portfolio_id, skill_name)
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS portfolio_achievements (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        portfolio_id INTEGER REFERENCES student_portfolios(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL,
        title VARCHAR(255) NOT NULL, description TEXT,
        type VARCHAR(50) DEFAULT 'certificate', icon VARCHAR(20) DEFAULT '🏅',
        date_achieved DATE, issuer VARCHAR(255), credential_url TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await c.query(`CREATE TABLE IF NOT EXISTS portfolio_endorsements (
        id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL,
        portfolio_id INTEGER REFERENCES student_portfolios(id) ON DELETE CASCADE,
        student_id INTEGER NOT NULL, teacher_id INTEGER NOT NULL,
        skill_id INTEGER REFERENCES portfolio_skills(id) ON DELETE CASCADE,
        skill_name VARCHAR(100) NOT NULL,
        endorsement_text TEXT, rating INTEGER DEFAULT 5 CHECK (rating BETWEEN 1 AND 5),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(teacher_id, skill_id)
      )`);
      // Indexes
      const idxs = [
        'idx_sp_tenant ON student_portfolios(tenant_id)',
        'idx_sp_student ON student_portfolios(student_id)',
        'idx_sp_token ON student_portfolios(share_token)',
        'idx_pp_tenant ON portfolio_projects(tenant_id)',
        'idx_pp_student ON portfolio_projects(student_id)',
        'idx_pp_portfolio ON portfolio_projects(portfolio_id)',
        'idx_pa_tenant ON portfolio_activities(tenant_id)',
        'idx_pa_student ON portfolio_activities(student_id)',
        'idx_psk_tenant ON portfolio_skills(tenant_id)',
        'idx_psk_student ON portfolio_skills(student_id)',
        'idx_psk_portfolio ON portfolio_skills(portfolio_id)',
        'idx_pach_tenant ON portfolio_achievements(tenant_id)',
        'idx_pach_student ON portfolio_achievements(student_id)',
        'idx_pe_tenant ON portfolio_endorsements(tenant_id)',
        'idx_pe_student ON portfolio_endorsements(student_id)',
        'idx_pe_teacher ON portfolio_endorsements(teacher_id)'
      ];
      for (const i of idxs) await c.query(`CREATE INDEX IF NOT EXISTS ${i}`);
      console.log('[StudentPortfolio] Migrations applied');
    } catch (e) { console.error('[StudentPortfolio] Migration error:', e.message); }
    finally { c.release(); }
  })();

  // ============================================================
  // HELPER: Get or create portfolio for student
  // ============================================================
  const getOrCreatePortfolio = async (studentId, tenantId) => {
    let pf = await pool.query(`SELECT * FROM student_portfolios WHERE student_id=$1 AND tenant_id=$2`, [studentId, tenantId]);
    if (!pf.rows[0]) {
      const token = uuid().slice(0,32);
      pf = await pool.query(`INSERT INTO student_portfolios (tenant_id,student_id,share_token) VALUES ($1,$2,$3) RETURNING *`, [tenantId, studentId, token]);
    }
    return pf.rows[0];
  };

  // ── Completeness calculator ─────────────────────────────────
  const calcCompleteness = async (portfolioId, tenantId) => {
    const pf = (await pool.query(`SELECT * FROM student_portfolios WHERE id=$1 AND tenant_id=$2`, [portfolioId, tenantId])).rows[0];
    if (!pf) return 0;
    let score = 0, max = 100;
    if (pf.display_name) score += 10;
    if (pf.photo_url) score += 5;
    if (pf.bio && pf.bio.length > 20) score += 10;
    if (pf.interests && pf.interests.length > 0) score += 5;
    if (pf.goals && pf.goals.length > 0) score += 5;
    if (pf.gpa_data && parseJson(pf.gpa_data,[]).length > 0) score += 15;
    if (pf.subject_performance && Object.keys(parseJson(pf.subject_performance,{})).length > 0) score += 10;
    const projCount = (await pool.query(`SELECT COUNT(*)::int as n FROM portfolio_projects WHERE portfolio_id=$1 AND tenant_id=$2`, [portfolioId, tenantId])).rows[0].n;
    if (projCount > 0) score += Math.min(10, projCount * 2);
    const actCount = (await pool.query(`SELECT COUNT(*)::int as n FROM portfolio_activities WHERE portfolio_id=$1 AND tenant_id=$2`, [portfolioId, tenantId])).rows[0].n;
    if (actCount > 0) score += Math.min(10, actCount * 2);
    const skillCount = (await pool.query(`SELECT COUNT(*)::int as n FROM portfolio_skills WHERE portfolio_id=$1 AND tenant_id=$2`, [portfolioId, tenantId])).rows[0].n;
    if (skillCount >= 3) score += 10;
    const achCount = (await pool.query(`SELECT COUNT(*)::int as n FROM portfolio_achievements WHERE portfolio_id=$1 AND tenant_id=$2`, [portfolioId, tenantId])).rows[0].n;
    if (achCount > 0) score += 10;
    await pool.query(`UPDATE student_portfolios SET completeness_score=$1, last_updated=NOW() WHERE id=$2 AND tenant_id=$3`, [score, portfolioId, tenantId]);
    return score;
  };

  // ============================================================
  // FEATURE 1: PORTFOLIO OVERVIEW (Profile Page)
  // ============================================================
  app.get('/portfolio/:studentId', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    const completeness = await calcCompleteness(pf.id, tid);
    const stats = await Promise.all([
      pool.query(`SELECT COUNT(*)::int as n FROM portfolio_projects WHERE portfolio_id=$1`, [pf.id]),
      pool.query(`SELECT COUNT(*)::int as n FROM portfolio_activities WHERE portfolio_id=$1`, [pf.id]),
      pool.query(`SELECT COUNT(*)::int as n FROM portfolio_skills WHERE portfolio_id=$1`, [pf.id]),
      pool.query(`SELECT COUNT(*)::int as n FROM portfolio_achievements WHERE portfolio_id=$1`, [pf.id]),
      pool.query(`SELECT COUNT(*)::int as n FROM portfolio_endorsements WHERE portfolio_id=$1`, [pf.id]),
    ]);
    const endorsements = (await pool.query(`SELECT pe.*, u.name as teacher_name FROM portfolio_endorsements pe LEFT JOIN users u ON u.id=pe.teacher_id WHERE pe.portfolio_id=$1 ORDER BY pe.created_at DESC LIMIT 5`, [pf.id])).rows;
    const endorseHtml = endorsements.map(e => `<div class="pf-endorsement">
      <div class="pf-endorsement-avatar">${esc((e.teacher_name||'T').charAt(0).toUpperCase())}</div>
      <div><div style="font-size:13px;font-weight:700;color:${COLORS.dark}">${esc(e.teacher_name||'Teacher')}</div>
      <div style="font-size:12px;color:${COLORS.gray}">endorsed <strong>${esc(e.skill_name)}</strong> · ${'★'.repeat(e.rating)}${'☆'.repeat(5-e.rating)}</div></div>
    </div>`).join('');

    const photoHtml = pf.photo_url ? `<img src="${esc(pf.photo_url)}" alt="${esc(pf.display_name||'Student')}">` : '<span>👤</span>';
    const interestsHtml = (pf.interests||[]).map(i=>`<span class="pf-tag">${esc(i)}</span>`).join(' ');
    const goalsHtml = (pf.goals||[]).map(g=>`<li style="font-size:13px;color:${COLORS.dark};margin-bottom:4px">${esc(g)}</li>`).join('');

    const html = PORTFOLIO_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${pfNav('overview', sid)}
      <div style="display:grid;grid-template-columns:320px 1fr;gap:20px">
        <!-- Left: Profile Card -->
        <div>
          <div class="pf-section" style="text-align:center">
            <div class="pf-avatar pf-avatar-lg" style="margin:0 auto 12px">${photoHtml}</div>
            <h2 style="font-size:20px;color:${COLORS.dark};margin:0">${esc(pf.display_name||'Unnamed Student')}</h2>
            <div style="font-size:13px;color:${COLORS.gray};margin-top:2px">${esc(pf.class_name||'No class set')}</div>
            <div style="margin-top:16px;text-align:left">
              <div style="font-size:12px;font-weight:700;color:${COLORS.gray};margin-bottom:6px">COMPLETENESS</div>
              <div style="display:flex;align-items:center;gap:12px">${svgProgressRing(completeness)}
                <div style="font-size:12px;color:${COLORS.gray}">${completeness>=80?'Looking great!':completeness>=50?'Keep going!':'Just getting started'}</div>
              </div>
            </div>
          </div>
          ${pf.bio ? `<div class="pf-section"><h3>About Me</h3><p style="font-size:13px;color:${COLORS.gray};line-height:1.6">${esc(pf.bio)}</p></div>` : ''}
          ${interestsHtml ? `<div class="pf-section"><h3>Interests</h3><div style="display:flex;gap:6px;flex-wrap:wrap">${interestsHtml}</div></div>` : ''}
          ${goalsHtml ? `<div class="pf-section"><h3>Goals</h3><ul style="margin:0;padding-left:18px">${goalsHtml}</ul></div>` : ''}
          <div class="pf-section no-print">
            <a href="/portfolio/${sid}/edit" class="pf-btn pf-btn-primary" style="width:100%;justify-content:center">✏️ Edit Profile</a>
          </div>
        </div>
        <!-- Right: Stats + Recent -->
        <div>
          <div style="display:grid;grid-template-columns:repeat(5,1fr);gap:12px;margin-bottom:20px">
            <div class="pf-stat"><div class="pf-stat-num" style="color:${COLORS.primary}">${stats[0].rows[0].n}</div><div class="pf-stat-label">Projects</div></div>
            <div class="pf-stat"><div class="pf-stat-num" style="color:${COLORS.success}">${stats[1].rows[0].n}</div><div class="pf-stat-label">Activities</div></div>
            <div class="pf-stat"><div class="pf-stat-num" style="color:${COLORS.warning}">${stats[2].rows[0].n}</div><div class="pf-stat-label">Skills</div></div>
            <div class="pf-stat"><div class="pf-stat-num" style="color:#8b5cf6">${stats[3].rows[0].n}</div><div class="pf-stat-label">Achievements</div></div>
            <div class="pf-stat"><div class="pf-stat-num" style="color:#ec4899">${stats[4].rows[0].n}</div><div class="pf-stat-label">Endorsements</div></div>
          </div>
          <div class="pf-section">
            <h3>Recent Teacher Endorsements</h3>
            ${endorseHtml || '<div style="color:'+COLORS.grayLight+';font-size:13px;text-align:center;padding:16px">No endorsements yet</div>'}
          </div>
          <div class="pf-section">
            <h3>Quick Start Guide</h3>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <a href="/portfolio/${sid}/academic" class="pf-btn pf-btn-secondary" style="justify-content:center">📚 Add Academic Data</a>
              <a href="/portfolio/${sid}/projects/new" class="pf-btn pf-btn-secondary" style="justify-content:center">📁 Add a Project</a>
              <a href="/portfolio/${sid}/skills" class="pf-btn pf-btn-secondary" style="justify-content:center">⚡ Rate Your Skills</a>
              <a href="/portfolio/${sid}/achievements" class="pf-btn pf-btn-secondary" style="justify-content:center">🏆 Add Achievement</a>
            </div>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Portfolio — '+(pf.display_name||'Student'), html, user, req));
  }));

  // ============================================================
  // FEATURE 1b: EDIT PROFILE
  // ============================================================
  app.get('/portfolio/:studentId/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, user.tenant_id);
    const html = PORTFOLIO_CSS + `<div style="max-width:700px;margin:0 auto">
      <a href="/portfolio/${sid}" style="color:${COLORS.gray};text-decoration:none;font-size:14px">← Back to Portfolio</a>
      <div class="pf-section" style="margin-top:12px">
        <h3>✏️ Edit Profile</h3>
        <form method="POST" action="/portfolio/${sid}/edit" class="pf-form" style="display:flex;flex-direction:column;gap:14px">
          <div><label>Display Name</label><input type="text" name="display_name" value="${esc(pf.display_name||'')}" placeholder="Your full name"></div>
          <div><label>Photo URL</label><input type="text" name="photo_url" value="${esc(pf.photo_url||'')}" placeholder="https://..."></div>
          <div><label>Class</label><input type="text" name="class_name" value="${esc(pf.class_name||'')}" placeholder="e.g., Grade 12A"></div>
          <div><label>Bio</label><textarea name="bio" rows="4" placeholder="Tell universities about yourself...">${esc(pf.bio||'')}</textarea></div>
          <div><label>Interests (comma-separated)</label><input type="text" name="interests" value="${esc((pf.interests||[]).join(', '))}" placeholder="e.g., Physics, Robotics, Debate"></div>
          <div><label>Goals (one per line)</label><textarea name="goals" rows="3" placeholder="Pursue Computer Science&#10;Attend a top-50 university">${esc((pf.goals||[]).join('\n'))}</textarea></div>
          <button type="submit" class="pf-btn pf-btn-primary" style="justify-content:center;padding:12px">💾 Save Profile</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Edit Profile', html, user, req));
  }));

  app.post('/portfolio/:studentId/edit', requireAuth, ah(async (req, res) => {
    const user = req.session.user, sid = parseInt(req.params.studentId), tid = user.tenant_id;
    const pf = await getOrCreatePortfolio(sid, tid);
    const interests = (req.body.interests||'').split(',').map(s=>s.trim()).filter(Boolean);
    const goals = (req.body.goals||'').split('\n').map(s=>s.trim()).filter(Boolean);
    await pool.query(`UPDATE student_portfolios SET display_name=$1,photo_url=$2,class_name=$3,bio=$4,interests=$5,goals=$6,last_updated=NOW() WHERE id=$7 AND tenant_id=$8`,
      [req.body.display_name||null, req.body.photo_url||null, req.body.class_name||null, req.body.bio||null, interests, goals, pf.id, tid]);
    audit('portfolio:edit', {studentId:sid});
    res.redirect('/portfolio/'+sid);
  }));

  // ============================================================
  // FEATURE 2: ACADEMIC SHOWCASE
  // ============================================================
  app.get('/portfolio/:studentId/academic', requireAuth, ah(async (req, res) => {
    const user = req.session.user, sid = parseInt(req.params.studentId), tid = user.tenant_id;
    const pf = await getOrCreatePortfolio(sid, tid);
    const gpaData = parseJson(pf.gpa_data, []);
    const subjects = parseJson(pf.subject_performance, {});
    const awards = parseJson(pf.academic_awards, []);
    const subjectEntries = Object.entries(subjects);

    const subjectHtml = subjectEntries.map(([name, val]) => {
      const pct = parseNum(val, 0);
      const color = pct >= 80 ? COLORS.success : pct >= 60 ? COLORS.warning : COLORS.danger;
      return `<div style="margin-bottom:10px">
        <div style="display:flex;justify-content:space-between;margin-bottom:3px"><span style="font-size:13px;font-weight:600;color:${COLORS.dark}">${esc(name)}</span><span style="font-size:13px;font-weight:700;color:${color}">${pct}%</span></div>
        <div class="pf-progress-bar"><div class="pf-progress-fill" style="width:${pct}%;background:${color}"></div></div>
      </div>`;
    }).join('');

    const awardsHtml = awards.map(a => `<div style="display:flex;align-items:center;gap:10px;padding:10px;background:${COLORS.warningBg};border-radius:10px;margin-bottom:6px">
      <span style="font-size:24px">🏅</span>
      <div><div style="font-size:13px;font-weight:700;color:${COLORS.dark}">${esc(a.title||'Award')}</div>
      <div style="font-size:12px;color:${COLORS.gray}">${esc(a.year||'')} ${esc(a.issuer?'· '+a.issuer:'')}</div></div>
    </div>`).join('');

    const html = PORTFOLIO_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${pfNav('academic', sid)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="pf-section">
          <h3>📈 GPA Trend</h3>
          <div id="gpaChart">${svgLineChart(gpaData.map(d=>({label:d.semester,value:parseNum(d.gpa,0)})))}</div>
          <div class="no-print" style="margin-top:16px">
            <form method="POST" action="/portfolio/${sid}/academic/gpa" class="pf-form" style="display:flex;gap:8px;align-items:flex-end">
              <div style="flex:1"><label>Semester</label><input type="text" name="semester" placeholder="e.g., Term 1 2024" required></div>
              <div style="flex:1"><label>GPA (0-4.0)</label><input type="number" name="gpa" step="0.01" min="0" max="4" placeholder="3.5" required></div>
              <button type="submit" class="pf-btn pf-btn-primary">+ Add</button>
            </form>
          </div>
        </div>
        <div class="pf-section">
          <h3>📖 Subject Performance</h3>
          ${subjectHtml || '<div style="color:'+COLORS.grayLight+';font-size:13px;text-align:center;padding:20px">No subjects added yet</div>'}
          <div class="no-print" style="margin-top:16px">
            <form method="POST" action="/portfolio/${sid}/academic/subjects" class="pf-form" style="display:flex;gap:8px;align-items:flex-end">
              <div style="flex:1"><label>Subject</label><input type="text" name="subject" placeholder="e.g., Mathematics" required></div>
              <div style="width:80px"><label>Score %</label><input type="number" name="score" min="0" max="100" placeholder="85" required></div>
              <button type="submit" class="pf-btn pf-btn-primary">+ Add</button>
            </form>
          </div>
        </div>
      </div>
      <div class="pf-section">
        <h3>🏅 Academic Awards</h3>
        ${awardsHtml || '<div style="color:'+COLORS.grayLight+';font-size:13px;text-align:center;padding:20px">No awards added yet</div>'}
        <div class="no-print" style="margin-top:16px">
          <form method="POST" action="/portfolio/${sid}/academic/awards" class="pf-form" style="display:flex;gap:8px;align-items:flex-end">
            <div style="flex:1"><label>Award Title</label><input type="text" name="title" placeholder="e.g., Best in Physics" required></div>
            <div style="width:100px"><label>Year</label><input type="text" name="year" placeholder="2024"></div>
            <div style="flex:1"><label>Issuer</label><input type="text" name="issuer" placeholder="School / Organization"></div>
            <button type="submit" class="pf-btn pf-btn-primary">+ Add</button>
          </form>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Academic Showcase', html, user, req));
  }));

  app.post('/portfolio/:studentId/academic/gpa', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    const data = parseJson(pf.gpa_data, []);
    data.push({semester: req.body.semester, gpa: parseNum(req.body.gpa, 0)});
    await pool.query(`UPDATE student_portfolios SET gpa_data=$1,last_updated=NOW() WHERE id=$2 AND tenant_id=$3`, [JSON.stringify(data), pf.id, tid]);
    res.redirect('/portfolio/'+sid+'/academic');
  }));

  app.post('/portfolio/:studentId/academic/subjects', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    const subj = parseJson(pf.subject_performance, {});
    subj[req.body.subject] = parseNum(req.body.score, 0);
    await pool.query(`UPDATE student_portfolios SET subject_performance=$1,last_updated=NOW() WHERE id=$2 AND tenant_id=$3`, [JSON.stringify(subj), pf.id, tid]);
    res.redirect('/portfolio/'+sid+'/academic');
  }));

  app.post('/portfolio/:studentId/academic/awards', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    const awards = parseJson(pf.academic_awards, []);
    awards.push({title: req.body.title, year: req.body.year||'', issuer: req.body.issuer||''});
    await pool.query(`UPDATE student_portfolios SET academic_awards=$1,last_updated=NOW() WHERE id=$2 AND tenant_id=$3`, [JSON.stringify(awards), pf.id, tid]);
    res.redirect('/portfolio/'+sid+'/academic');
  }));

  // ============================================================
  // FEATURE 3: PROJECT GALLERY
  // ============================================================
  const PROJECT_ICONS = {essay:'📝', artwork:'🎨', presentation:'📊', code:'💻', video:'🎬', research:'🔬', music:'🎵', sport:'⚽', other:'📎'};

  app.get('/portfolio/:studentId/projects', requireAuth, ah(async (req, res) => {
    const user = req.session.user, sid = parseInt(req.params.studentId), tid = user.tenant_id;
    const pf = await getOrCreatePortfolio(sid, tid);
    const projects = (await pool.query(`SELECT * FROM portfolio_projects WHERE portfolio_id=$1 AND tenant_id=$2 ORDER BY featured DESC, date_completed DESC NULLS LAST, created_at DESC`, [pf.id, tid])).rows;
    const cardsHtml = projects.map(p => {
      const icon = PROJECT_ICONS[p.category] || PROJECT_ICONS.other;
      const thumb = p.thumbnail_url ? `<img src="${esc(p.thumbnail_url)}" alt="${esc(p.title)}">` : `<span>${icon}</span>`;
      const tags = (p.tags||[]).map(t=>`<span class="pf-tag">${esc(t)}</span>`).join('');
      return `<div class="pf-card">
        <div class="pf-card-thumb">${thumb}</div>
        <div class="pf-card-body">
          <div class="pf-card-title">${p.featured?'⭐ ':''}${esc(p.title)}</div>
          <div class="pf-card-desc">${esc(p.description||'').slice(0,100)}${(p.description||'').length>100?'...':''}</div>
          <div class="pf-card-meta">${tags}<span class="pf-tag" style="background:${COLORS.grayBg};color:${COLORS.gray}">${fmtDate(p.date_completed)}</span></div>
          <div class="no-print" style="margin-top:10px;display:flex;gap:6px">
            <form method="POST" action="/portfolio/${sid}/projects/${p.id}/delete" style="margin:0"><button type="submit" class="pf-btn pf-btn-danger" style="padding:4px 10px;font-size:11px" onclick="return confirm('Delete this project?')">🗑️</button></form>
            <form method="POST" action="/portfolio/${sid}/projects/${p.id}/toggle" style="margin:0"><button type="submit" class="pf-btn pf-btn-secondary" style="padding:4px 10px;font-size:11px">${p.featured?'☆ Unfeature':'⭐ Feature'}</button></form>
          </div>
        </div>
      </div>`;
    }).join('');

    const html = PORTFOLIO_CSS + `<div style="max-width:1100px;margin:0 auto">
      ${pfNav('projects', sid)}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;color:${COLORS.dark}">📁 Project Gallery (${projects.length})</h3>
        <a href="/portfolio/${sid}/projects/new" class="pf-btn pf-btn-primary">+ New Project</a>
      </div>
      ${projects.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px">${cardsHtml}</div>` : `<div class="pf-section" style="text-align:center"><p style="color:${COLORS.grayLight};font-size:14px">No projects yet. Add your first project to showcase your work!</p></div>`}
    </div>`;
    res.send(renderPage('Project Gallery', html, user, req));
  }));

  app.get('/portfolio/:studentId/projects/new', requireAuth, ah(async (req, res) => {
    const sid = parseInt(req.params.studentId);
    const html = PORTFOLIO_CSS + `<div style="max-width:700px;margin:0 auto">
      <a href="/portfolio/${sid}/projects" style="color:${COLORS.gray};text-decoration:none">← Back to Projects</a>
      <div class="pf-section" style="margin-top:12px">
        <h3>📁 Add New Project</h3>
        <form method="POST" action="/portfolio/${sid}/projects" class="pf-form" style="display:flex;flex-direction:column;gap:14px">
          <div><label>Project Title *</label><input type="text" name="title" required placeholder="e.g., Biology Research Paper"></div>
          <div><label>Description</label><textarea name="description" rows="3" placeholder="Brief description of your project..."></textarea></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div><label>Category</label><select name="category">${Object.entries(PROJECT_ICONS).map(([k,v])=>`<option value="${k}">${v} ${k.charAt(0).toUpperCase()+k.slice(1)}</option>`).join('')}</select></div>
            <div><label>Date Completed</label><input type="date" name="date_completed"></div>
          </div>
          <div><label>File / Link URL</label><input type="text" name="file_url" placeholder="https://drive.google.com/... or uploaded file URL"></div>
          <div><label>Thumbnail URL</label><input type="text" name="thumbnail_url" placeholder="https://... (image preview)"></div>
          <div><label>Tags (comma-separated)</label><input type="text" name="tags" placeholder="e.g., research, biology, award-winning"></div>
          <button type="submit" class="pf-btn pf-btn-primary" style="justify-content:center;padding:12px">💾 Save Project</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('New Project', html, req.session.user, req));
  }));

  app.post('/portfolio/:studentId/projects', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    const tags = (req.body.tags||'').split(',').map(s=>s.trim()).filter(Boolean);
    await pool.query(`INSERT INTO portfolio_projects (tenant_id,portfolio_id,student_id,title,description,category,file_url,thumbnail_url,tags,date_completed) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [tid, pf.id, sid, req.body.title, req.body.description||null, req.body.category||'other', req.body.file_url||null, req.body.thumbnail_url||null, tags, req.body.date_completed||null]);
    audit('portfolio:project:add', {studentId:sid, title:req.body.title});
    res.redirect('/portfolio/'+sid+'/projects');
  }));

  app.post('/portfolio/:studentId/projects/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM portfolio_projects WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.redirect('/portfolio/'+parseInt(req.params.studentId)+'/projects');
  }));

  app.post('/portfolio/:studentId/projects/:id/toggle', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`UPDATE portfolio_projects SET featured = NOT featured WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.redirect('/portfolio/'+parseInt(req.params.studentId)+'/projects');
  }));

  // ============================================================
  // FEATURE 4: EXTRACURRICULAR ACTIVITIES (Timeline View)
  // ============================================================
  const ACTIVITY_ICONS = {club:'🏛️', sport:'⚽', volunteer:'🤝', leadership:'👑', music:'🎵', arts:'🎨', internship:'💼', other:'📌'};

  app.get('/portfolio/:studentId/activities', requireAuth, ah(async (req, res) => {
    const user = req.session.user, sid = parseInt(req.params.studentId), tid = user.tenant_id;
    const pf = await getOrCreatePortfolio(sid, tid);
    const activities = (await pool.query(`SELECT * FROM portfolio_activities WHERE portfolio_id=$1 AND tenant_id=$2 ORDER BY start_date DESC NULLS LAST, created_at DESC`, [pf.id, tid])).rows;

    const timelineHtml = activities.map(a => {
      const icon = ACTIVITY_ICONS[a.activity_type] || ACTIVITY_ICONS.other;
      return `<div class="pf-timeline-item">
        <div class="pf-timeline-date">${fmtDate(a.start_date)}${a.end_date ? ' — '+fmtDate(a.end_date) : ' — Present'}${a.hours_per_week ? ' · '+a.hours_per_week+'h/week' : ''}</div>
        <div class="pf-timeline-title">${icon} ${esc(a.activity_name)}</div>
        <div style="font-size:12px;color:${COLORS.primary};font-weight:600;margin-bottom:2px">${esc(a.role||'')} ${a.organization ? 'at '+esc(a.organization) : ''}</div>
        <div class="pf-timeline-desc">${esc(a.description||'')}</div>
        ${a.achievements ? `<div style="margin-top:6px;padding:6px 10px;background:${COLORS.successBg};border-radius:6px;font-size:11px;color:${COLORS.success};font-weight:600">${esc(a.achievements)}</div>` : ''}
        <div class="no-print" style="margin-top:8px"><form method="POST" action="/portfolio/${sid}/activities/${a.id}/delete" style="margin:0"><button type="submit" class="pf-btn pf-btn-danger" style="padding:3px 8px;font-size:10px" onclick="return confirm('Remove this activity?')">Remove</button></form></div>
      </div>`;
    }).join('');

    const html = PORTFOLIO_CSS + `<div style="max-width:900px;margin:0 auto">
      ${pfNav('activities', sid)}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
        <h3 style="margin:0;color:${COLORS.dark}">🎯 Extracurricular Activities (${activities.length})</h3>
      </div>
      ${activities.length ? `<div class="pf-timeline">${timelineHtml}</div>` : '<div class="pf-section" style="text-align:center"><p style="color:'+COLORS.grayLight+';font-size:14px">No activities yet. Add clubs, sports, volunteer work, and leadership roles!</p></div>'}
      <div class="pf-section no-print" style="margin-top:20px">
        <h3>+ Add Activity</h3>
        <form method="POST" action="/portfolio/${sid}/activities" class="pf-form" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="grid-column:1/-1"><label>Activity Name *</label><input type="text" name="activity_name" required placeholder="e.g., Robotics Club"></div>
          <div><label>Type</label><select name="activity_type">${Object.entries(ACTIVITY_ICONS).map(([k,v])=>`<option value="${k}">${v} ${k.charAt(0).toUpperCase()+k.slice(1)}</option>`).join('')}</select></div>
          <div><label>Role</label><input type="text" name="role" placeholder="e.g., President, Member"></div>
          <div><label>Organization</label><input type="text" name="organization" placeholder="e.g., School, Red Cross"></div>
          <div><label>Hours/Week</label><input type="number" name="hours_per_week" min="0" placeholder="5"></div>
          <div><label>Start Date</label><input type="date" name="start_date"></div>
          <div><label>End Date</label><input type="date" name="end_date"></div>
          <div style="grid-column:1/-1"><label>Description</label><textarea name="description" rows="2" placeholder="Describe your involvement..."></textarea></div>
          <div style="grid-column:1/-1"><label>Key Achievements</label><input type="text" name="achievements" placeholder="e.g., Won regional championship"></div>
          <div style="grid-column:1/-1"><button type="submit" class="pf-btn pf-btn-primary" style="justify-content:center;padding:12px">💾 Add Activity</button></div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Extracurricular Activities', html, user, req));
  }));

  app.post('/portfolio/:studentId/activities', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    await pool.query(`INSERT INTO portfolio_activities (tenant_id,portfolio_id,student_id,activity_name,activity_type,organization,role,start_date,end_date,hours_per_week,description,achievements) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
      [tid, pf.id, sid, req.body.activity_name, req.body.activity_type||'other', req.body.organization||null, req.body.role||null, req.body.start_date||null, req.body.end_date||null, parseInt(req.body.hours_per_week)||null, req.body.description||null, req.body.achievements||null]);
    audit('portfolio:activity:add', {studentId:sid});
    res.redirect('/portfolio/'+sid+'/activities');
  }));

  app.post('/portfolio/:studentId/activities/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM portfolio_activities WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.redirect('/portfolio/'+parseInt(req.params.studentId)+'/activities');
  }));

  // ============================================================
  // FEATURE 5: SKILLS INVENTORY (Radar Chart)
  // ============================================================
  const DEFAULT_SKILLS = ['Leadership','Teamwork','Communication','Problem-Solving','Creativity','Technical','Time Management','Critical Thinking','Adaptability','Public Speaking'];

  app.get('/portfolio/:studentId/skills', requireAuth, ah(async (req, res) => {
    const user = req.session.user, sid = parseInt(req.params.studentId), tid = user.tenant_id;
    const pf = await getOrCreatePortfolio(sid, tid);
    const skills = (await pool.query(`SELECT * FROM portfolio_skills WHERE portfolio_id=$1 AND tenant_id=$2 ORDER BY self_rating DESC`, [pf.id, tid])).rows;
    const endorsements = (await pool.query(`SELECT pe.skill_name, pe.rating, u.name as teacher_name FROM portfolio_endorsements pe LEFT JOIN users u ON u.id=pe.teacher_id WHERE pe.portfolio_id=$1 ORDER BY pe.created_at DESC`, [pf.id])).rows;

    // Build endorsement map
    const endorseMap = {};
    endorsements.forEach(e => {
      if (!endorseMap[e.skill_name]) endorseMap[e.skill_name] = [];
      endorseMap[e.skill_name].push(e);
    });

    // Radar data: use existing skills or defaults
    const radarData = skills.length >= 3 ? skills.map(s=>({label:s.skill_name,value:s.self_rating})) :
      DEFAULT_SKILLS.slice(0,6).map(name=>({label:name,value:50}));

    const skillRowsHtml = skills.map(s => {
      const endorses = endorseMap[s.skill_name] || [];
      const color = s.self_rating >= 80 ? COLORS.success : s.self_rating >= 50 ? COLORS.primary : COLORS.warning;
      const endorseHtml = endorses.map(e => `<div style="display:flex;align-items:center;gap:4px;font-size:11px;color:${COLORS.gray}"><span style="color:${COLORS.primary};font-weight:600">${esc(e.teacher_name||'Teacher')}</span> ${'★'.repeat(e.rating)}</div>`).join('');
      return `<div style="display:flex;align-items:center;gap:14px;padding:12px;border-bottom:1px solid #f1f5f9">
        <div style="width:140px;font-size:13px;font-weight:700;color:${COLORS.dark}">${esc(s.skill_name)}</div>
        <div style="flex:1"><div class="pf-progress-bar"><div class="pf-progress-fill" style="width:${s.self_rating}%;background:${color}"></div></div></div>
        <div style="width:40px;text-align:right;font-size:14px;font-weight:800;color:${color}">${s.self_rating}%</div>
        <div style="width:180px">${endorseHtml}</div>
        <div class="no-print"><form method="POST" action="/portfolio/${sid}/skills/${s.id}/delete" style="margin:0"><button type="submit" class="pf-btn pf-btn-danger" style="padding:3px 8px;font-size:10px">✕</button></form></div>
      </div>`;
    }).join('');

    const html = PORTFOLIO_CSS + `<div style="max-width:1000px;margin:0 auto">
      ${pfNav('skills', sid)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="pf-section">
          <h3>🕸️ Skills Radar</h3>
          <div style="display:flex;justify-content:center">${svgRadarChart(radarData)}</div>
        </div>
        <div class="pf-section">
          <h3>⚡ Skill Ratings (${skills.length})</h3>
          ${skillRowsHtml || '<div style="color:'+COLORS.grayLight+';font-size:13px;text-align:center;padding:20px">No skills rated yet</div>'}
        </div>
      </div>
      <div class="pf-section no-print" style="margin-top:4px">
        <h3>+ Rate a Skill</h3>
        <form method="POST" action="/portfolio/${sid}/skills" class="pf-form" style="display:flex;gap:8px;align-items:flex-end">
          <div style="flex:1"><label>Skill Name</label><input type="text" name="skill_name" placeholder="e.g., Python Programming" required></div>
          <div style="width:100px"><label>Rating (0-100)</label><input type="range" name="self_rating" min="0" max="100" value="70" id="skillRange" oninput="document.getElementById('skillVal').textContent=this.value+'%'" style="padding:0;height:36px;accent-color:${COLORS.primary}"></div>
          <div style="width:40px;text-align:center;font-size:13px;font-weight:700;color:${COLORS.primary}" id="skillVal">70%</div>
          <div style="flex:1"><label>Category</label><select name="category"><option value="soft">Soft Skill</option><option value="technical">Technical</option><option value="language">Language</option><option value="creative">Creative</option></select></div>
          <div style="flex:1"><label>Evidence</label><input type="text" name="evidence" placeholder="e.g., Led team of 10"></div>
          <button type="submit" class="pf-btn pf-btn-primary">+ Add</button>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Skills Inventory', html, user, req));
  }));

  app.post('/portfolio/:studentId/skills', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    await pool.query(`INSERT INTO portfolio_skills (tenant_id,portfolio_id,student_id,skill_name,self_rating,category,evidence) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (portfolio_id,skill_name) DO UPDATE SET self_rating=$5,category=$6,evidence=$7,updated_at=NOW()`,
      [tid, pf.id, sid, req.body.skill_name.trim(), Math.min(100,Math.max(0,parseInt(req.body.self_rating)||50)), req.body.category||'soft', req.body.evidence||null]);
    audit('portfolio:skill:rate', {studentId:sid, skill:req.body.skill_name});
    res.redirect('/portfolio/'+sid+'/skills');
  }));

  app.post('/portfolio/:studentId/skills/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM portfolio_skills WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.redirect('/portfolio/'+parseInt(req.params.studentId)+'/skills');
  }));

  // ============================================================
  // FEATURE 6: ACHIEVEMENTS WALL
  // ============================================================
  const ACHIEVEMENT_ICONS = {certificate:'📜', badge:'🏅', award:'🏆', competition:'🥇', scholarship:'🎓', publication:'📖', patent:'💡', community:'🤝', other:'⭐'};
  const ACHIEVEMENT_COLORS = {certificate:'#3b82f6', badge:'#f59e0b', award:'#8b5cf6', competition:'#ef4444', scholarship:'#059669', publication:'#06b6d4', patent:'#ec4899', community:'#10b981', other:'#64748b'};

  app.get('/portfolio/:studentId/achievements', requireAuth, ah(async (req, res) => {
    const user = req.session.user, sid = parseInt(req.params.studentId), tid = user.tenant_id;
    const pf = await getOrCreatePortfolio(sid, tid);
    const achievements = (await pool.query(`SELECT * FROM portfolio_achievements WHERE portfolio_id=$1 AND tenant_id=$2 ORDER BY date_achieved DESC NULLS LAST, created_at DESC`, [pf.id, tid])).rows;

    const gridHtml = achievements.map(a => {
      const icon = ACHIEVEMENT_ICONS[a.type] || ACHIEVEMENT_ICONS.other;
      const color = ACHIEVEMENT_COLORS[a.type] || ACHIEVEMENT_COLORS.other;
      return `<div class="pf-card" style="padding:16px">
        <div style="display:flex;align-items:flex-start;gap:14px">
          <div class="pf-achievement-icon" style="background:${color}15;color:${color}">${icon}</div>
          <div style="flex:1">
            <div style="font-size:14px;font-weight:700;color:${COLORS.dark}">${esc(a.title)}</div>
            <div style="font-size:12px;color:${COLORS.gray};margin-top:2px">${esc(a.issuer||'')}${a.date_achieved ? ' · '+fmtDate(a.date_achieved) : ''}</div>
            ${a.description ? `<div style="font-size:12px;color:${COLORS.grayLight};margin-top:4px;line-height:1.4">${esc(a.description)}</div>` : ''}
            ${a.credential_url ? `<a href="${esc(a.credential_url)}" target="_blank" rel="noopener" style="font-size:11px;color:${COLORS.primary};font-weight:600;margin-top:4px;display:inline-block">View Credential →</a>` : ''}
          </div>
          <div class="no-print"><form method="POST" action="/portfolio/${sid}/achievements/${a.id}/delete" style="margin:0"><button type="submit" class="pf-btn pf-btn-danger" style="padding:3px 8px;font-size:10px" onclick="return confirm('Remove?')">✕</button></form></div>
        </div>
      </div>`;
    }).join('');

    const html = PORTFOLIO_CSS + `<div style="max-width:900px;margin:0 auto">
      ${pfNav('achievements', sid)}
      <h3 style="margin:0 0 16px;color:${COLORS.dark}">🏆 Achievements Wall (${achievements.length})</h3>
      ${achievements.length ? `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(340px,1fr));gap:12px">${gridHtml}</div>` : '<div class="pf-section" style="text-align:center"><p style="color:'+COLORS.grayLight+';font-size:14px">No achievements yet. Showcase your badges, certificates, and awards!</p></div>'}
      <div class="pf-section no-print" style="margin-top:20px">
        <h3>+ Add Achievement</h3>
        <form method="POST" action="/portfolio/${sid}/achievements" class="pf-form" style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div><label>Title *</label><input type="text" name="title" required placeholder="e.g., National Science Olympiad Gold"></div>
          <div><label>Type</label><select name="type">${Object.entries(ACHIEVEMENT_ICONS).map(([k,v])=>`<option value="${k}">${v} ${k.charAt(0).toUpperCase()+k.slice(1)}</option>`).join('')}</select></div>
          <div><label>Issuer</label><input type="text" name="issuer" placeholder="e.g., Ministry of Education"></div>
          <div><label>Date Achieved</label><input type="date" name="date_achieved"></div>
          <div style="grid-column:1/-1"><label>Description</label><textarea name="description" rows="2" placeholder="Brief description..."></textarea></div>
          <div style="grid-column:1/-1"><label>Credential URL</label><input type="text" name="credential_url" placeholder="https://... (link to certificate/badge)"></div>
          <div style="grid-column:1/-1"><button type="submit" class="pf-btn pf-btn-primary" style="justify-content:center;padding:12px">🏆 Add Achievement</button></div>
        </form>
      </div>
    </div>`;
    res.send(renderPage('Achievements Wall', html, user, req));
  }));

  app.post('/portfolio/:studentId/achievements', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    await pool.query(`INSERT INTO portfolio_achievements (tenant_id,portfolio_id,student_id,title,description,type,issuer,date_achieved,credential_url) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [tid, pf.id, sid, req.body.title, req.body.description||null, req.body.type||'other', req.body.issuer||null, req.body.date_achieved||null, req.body.credential_url||null]);
    audit('portfolio:achievement:add', {studentId:sid, title:req.body.title});
    res.redirect('/portfolio/'+sid+'/achievements');
  }));

  app.post('/portfolio/:studentId/achievements/:id/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM portfolio_achievements WHERE id=$1 AND tenant_id=$2`, [req.params.id, tid]);
    res.redirect('/portfolio/'+parseInt(req.params.studentId)+'/achievements');
  }));

  // ============================================================
  // FEATURE 7: TEACHER ENDORSEMENT (LinkedIn-style)
  // ============================================================
  app.get('/portfolio/:studentId/endorse', requireAuth, ah(async (req, res) => {
    const user = req.session.user, sid = parseInt(req.params.studentId), tid = user.tenant_id;
    const pf = await getOrCreatePortfolio(sid, tid);
    const skills = (await pool.query(`SELECT id, skill_name, self_rating FROM portfolio_skills WHERE portfolio_id=$1 AND tenant_id=$2 ORDER BY skill_name`, [pf.id, tid])).rows;
    const existing = (await pool.query(`SELECT skill_id FROM portfolio_endorsements WHERE portfolio_id=$1 AND teacher_id=$2`, [pf.id, user.id])).rows;
    const endorsed = new Set(existing.map(e=>e.skill_id));

    const skillListHtml = skills.map(s => {
      const done = endorsed.has(s.id);
      return `<div style="display:flex;align-items:center;justify-content:space-between;padding:10px;border-bottom:1px solid #f1f5f9">
        <div><div style="font-size:14px;font-weight:600;color:${COLORS.dark}">${esc(s.skill_name)}</div><div style="font-size:12px;color:${COLORS.grayLight}">Student self-rating: ${s.self_rating}%</div></div>
        ${done ? '<span class="pf-shield" style="background:'+COLORS.successBg+';color:'+COLORS.success+'">✓ Endorsed</span>' :
        `<form method="POST" action="/portfolio/${sid}/endorse" style="display:flex;gap:6px;align-items:center;margin:0">
          <input type="hidden" name="skill_id" value="${s.id}"><input type="hidden" name="skill_name" value="${esc(s.skill_name)}">
          <select name="rating" style="padding:6px 8px;border:1px solid ${COLORS.border};border-radius:8px;font-size:12px">${[5,4,3,2,1].map(r=>`<option value="${r}"${r===5?' selected':''}>${'★'.repeat(r)}</option>`).join('')}</select>
          <button type="submit" class="pf-btn pf-btn-primary" style="padding:6px 12px;font-size:12px">Endorse</button>
        </form>`}
      </div>`;
    }).join('');

    const allEndorsements = (await pool.query(`SELECT pe.*, u.name as teacher_name FROM portfolio_endorsements pe LEFT JOIN users u ON u.id=pe.teacher_id WHERE pe.portfolio_id=$1 ORDER BY pe.created_at DESC`, [pf.id])).rows;
    const endListHtml = allEndorsements.map(e => `<div class="pf-endorsement">
      <div class="pf-endorsement-avatar">${esc((e.teacher_name||'T').charAt(0))}</div>
      <div><div style="font-size:13px;font-weight:700;color:${COLORS.dark}">${esc(e.teacher_name||'Teacher')}</div>
      <div style="font-size:12px;color:${COLORS.gray}">endorsed <strong>${esc(e.skill_name)}</strong> · ${'★'.repeat(e.rating)}${'☆'.repeat(5-e.rating)} · ${fmtDate(e.created_at)}</div>
      ${e.endorsement_text ? `<div style="font-size:12px;color:${COLORS.grayLight};margin-top:4px;font-style:italic">"${esc(e.endorsement_text)}"</div>` : ''}</div>
    </div>`).join('');

    const html = PORTFOLIO_CSS + `<div style="max-width:800px;margin:0 auto">
      <a href="/portfolio/${sid}" style="color:${COLORS.gray};text-decoration:none">← Back to Portfolio</a>
      <div class="pf-section" style="margin-top:12px">
        <h3>✍️ Endorse ${esc(pf.display_name||'Student')}’s Skills</h3>
        <p style="font-size:13px;color:${COLORS.gray};margin-bottom:16px">As a teacher, you can endorse this student's skills to help strengthen their university applications.</p>
        ${skillListHtml || '<div style="color:'+COLORS.grayLight+';font-size:13px;text-align:center;padding:20px">This student has not rated any skills yet.</div>'}
      </div>
      <div class="pf-section">
        <h3>All Endorsements (${allEndorsements.length})</h3>
        ${endListHtml || '<div style="color:'+COLORS.grayLight+';font-size:13px;text-align:center;padding:20px">No endorsements yet</div>'}
      </div>
    </div>`;
    res.send(renderPage('Endorse Student', html, user, req));
  }));

  app.post('/portfolio/:studentId/endorse', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    await pool.query(`INSERT INTO portfolio_endorsements (tenant_id,portfolio_id,student_id,teacher_id,skill_id,skill_name,endorsement_text,rating) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (teacher_id,skill_id) DO UPDATE SET rating=$8,endorsement_text=$7`,
      [tid, pf.id, sid, user.id, parseInt(req.body.skill_id), req.body.skill_name, req.body.endorsement_text||null, Math.min(5,Math.max(1,parseInt(req.body.rating)||5))]);
    audit('portfolio:endorse', {teacherId:user.id, studentId:sid, skill:req.body.skill_name});
    res.redirect('/portfolio/'+sid+'/endorse');
  }));

  // ============================================================
  // FEATURE 8: PORTFOLIO SHARING (Public Link + QR + PDF)
  // ============================================================
  app.get('/portfolio/:studentId/share', requireAuth, ah(async (req, res) => {
    const user = req.session.user, sid = parseInt(req.params.studentId), tid = user.tenant_id;
    const pf = await getOrCreatePortfolio(sid, tid);
    const completeness = await calcCompleteness(pf.id, tid);
    const baseUrl = (req.protocol || 'https') + '://' + req.get('host');
    const publicUrl = `${baseUrl}/p/${pf.share_token}`;
    const endorseUrl = `${baseUrl}/portfolio/${sid}/endorse`;

    const html = PORTFOLIO_CSS + `<div style="max-width:800px;margin:0 auto">
      ${pfNav('share', sid)}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px">
        <div class="pf-section">
          <h3>🔗 Share Your Portfolio</h3>
          <p style="font-size:13px;color:${COLORS.gray};margin-bottom:16px">Share your portfolio link with universities, teachers, and mentors.</p>
          <div style="margin-bottom:16px">
            <label style="display:block;font-size:12px;font-weight:600;color:${COLORS.gray};margin-bottom:4px">PUBLIC PORTFOLIO LINK</label>
            <div style="display:flex;gap:6px">
              <input type="text" value="${esc(publicUrl)}" readonly id="shareUrl" style="flex:1;padding:10px 14px;border:2px solid ${COLORS.border};border-radius:10px;font-size:13px;background:${COLORS.grayBg}">
              <button onclick="navigator.clipboard.writeText(document.getElementById('shareUrl').value);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)" class="pf-btn pf-btn-primary">Copy</button>
            </div>
          </div>
          <div style="margin-bottom:16px">
            <label style="display:block;font-size:12px;font-weight:600;color:${COLORS.gray};margin-bottom:4px">ENDORSEMENT LINK (for teachers)</label>
            <div style="display:flex;gap:6px">
              <input type="text" value="${esc(endorseUrl)}" readonly id="endorseUrl" style="flex:1;padding:10px 14px;border:2px solid ${COLORS.border};border-radius:10px;font-size:13px;background:${COLORS.grayBg}">
              <button onclick="navigator.clipboard.writeText(document.getElementById('endorseUrl').value);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy',2000)" class="pf-btn pf-btn-secondary">Copy</button>
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-bottom:16px">
            <form method="POST" action="/portfolio/${sid}/share/toggle" style="margin:0">
              <button type="submit" class="pf-btn ${pf.is_public ? 'pf-btn-danger' : 'pf-btn-success'}">${pf.is_public ? '🔒 Make Private' : '🔓 Make Public'}</button>
            </form>
          </div>
          <div style="display:flex;align-items:center;gap:6px;padding:10px;background:${pf.is_public ? COLORS.successBg : COLORS.dangerBg};border-radius:10px;font-size:13px;font-weight:600;color:${pf.is_public ? COLORS.success : COLORS.danger}">
            ${pf.is_public ? '✅ Portfolio is publicly accessible' : '🔒 Portfolio is private — only you can view it'}
          </div>
        </div>
        <div class="pf-section" style="text-align:center">
          <h3>📱 QR Code</h3>
          <p style="font-size:13px;color:${COLORS.gray};margin-bottom:16px">Universities can scan this QR code to view your portfolio.</p>
          <div style="display:flex;justify-content:center;margin-bottom:16px;padding:20px;background:#fff;border:2px solid ${COLORS.border};border-radius:16px;display:inline-flex">
            ${svgQRCode(publicUrl, 180)}
          </div>
          <div style="margin-top:16px">
            <a href="/portfolio/${sid}/share/pdf" target="_blank" class="pf-btn pf-btn-outline" style="justify-content:center;width:100%">📄 Download PDF-Ready View</a>
          </div>
        </div>
      </div>
      <div class="pf-section">
        <h3>📊 Portfolio Completeness: ${completeness}%</h3>
        <div class="pf-progress-bar" style="height:12px;margin-bottom:12px"><div class="pf-progress-fill" style="width:${completeness}%;background:${completeness>=80?COLORS.success:completeness>=50?COLORS.warning:COLORS.danger}"></div></div>
        <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px">
          ${[
            {label:'Profile Info', check:!!pf.display_name, icon:'👤'},
            {label:'Photo', check:!!pf.photo_url, icon:'📷'},
            {label:'Bio', check:!!pf.bio, icon:'✏️'},
            {label:'GPA Data', check:(parseJson(pf.gpa_data,[])).length>0, icon:'📈'},
            {label:'Projects', check:true, icon:'📁'},
            {label:'Activities', check:true, icon:'🎯'},
            {label:'Skills', check:true, icon:'⚡'},
            {label:'Achievements', check:true, icon:'🏆'},
          ].map(item => `<div style="display:flex;align-items:center;gap:8px;padding:8px;border-radius:8px;background:${item.check?COLORS.successBg:COLORS.grayBg}">
            <span>${item.icon}</span><span style="font-size:12px;font-weight:600;color:${item.check?COLORS.success:COLORS.grayLight}">${esc(item.label)}</span>
            ${item.check ? '<span style="color:'+COLORS.success+';font-weight:700">✓</span>' : '<span style="color:'+COLORS.grayLight+'">○</span>'}
          </div>`).join('')}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Share Portfolio', html, user, req));
  }));

  app.post('/portfolio/:studentId/share/toggle', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    await pool.query(`UPDATE student_portfolios SET is_public = NOT is_public, last_updated=NOW() WHERE id=$1 AND tenant_id=$2`, [pf.id, tid]);
    res.redirect('/portfolio/'+sid+'/share');
  }));

  // ── PDF-Ready View ──────────────────────────────────────────
  app.get('/portfolio/:studentId/share/pdf', requireAuth, ah(async (req, res) => {
    const user = req.session.user, sid = parseInt(req.params.studentId), tid = user.tenant_id;
    const pf = await getOrCreatePortfolio(sid, tid);
    const completeness = await calcCompleteness(pf.id, tid);
    const projects = (await pool.query(`SELECT * FROM portfolio_projects WHERE portfolio_id=$1 ORDER BY featured DESC LIMIT 6`, [pf.id])).rows;
    const activities = (await pool.query(`SELECT * FROM portfolio_activities WHERE portfolio_id=$1 ORDER BY start_date DESC LIMIT 5`, [pf.id])).rows;
    const skills = (await pool.query(`SELECT * FROM portfolio_skills WHERE portfolio_id=$1 ORDER BY self_rating DESC LIMIT 8`, [pf.id])).rows;
    const achievements = (await pool.query(`SELECT * FROM portfolio_achievements WHERE portfolio_id=$1 ORDER BY date_achieved DESC LIMIT 6`, [pf.id])).rows;
    const endorsements = (await pool.query(`SELECT pe.*, u.name as teacher_name FROM portfolio_endorsements pe LEFT JOIN users u ON u.id=pe.teacher_id WHERE pe.portfolio_id=$1 LIMIT 5`, [pf.id])).rows;
    const subjects = parseJson(pf.subject_performance, {});
    const gpaData = parseJson(pf.gpa_data, []);

    const photoHtml = pf.photo_url ? `<img src="${esc(pf.photo_url)}" alt="${esc(pf.display_name||'Student')}" style="width:80px;height:80px;border-radius:50%;object-fit:cover;border:3px solid ${COLORS.primaryLight}">` : '';
    const html = `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><title>Portfolio — ${esc(pf.display_name||'Student')}</title>
    <style>body{font-family:'Segoe UI',system-ui,-apple-system,sans-serif;max-width:800px;margin:0 auto;padding:40px 24px;color:#1e293b;font-size:14px;line-height:1.6}
    h1{font-size:28px;margin:0;color:#1e293b}h2{font-size:18px;margin:24px 0 12px;color:#4f46e5;border-bottom:2px solid #e2e8f0;padding-bottom:6px}h3{font-size:15px;margin:16px 0 8px;color:#1e293b}
    .header{display:flex;align-items:center;gap:20px;margin-bottom:30px;padding-bottom:20px;border-bottom:3px solid #4f46e5}
    .bio{color:#64748b;font-size:13px;margin-top:8px}.section{margin-bottom:24px}.tag{display:inline-block;padding:2px 8px;border-radius:6px;font-size:11px;font-weight:600;background:#eef2ff;color:#4f46e5;margin:2px}
    .progress-bar{width:100%;height:6px;background:#f1f5f9;border-radius:3px;margin:4px 0}.progress-fill{height:100%;border-radius:3px}
    .grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.item{padding:10px;background:#f8fafc;border-radius:8px;margin-bottom:6px}
    @media print{body{padding:20px}h2{page-break-before:auto}}</style></head><body>
    <div class="header">
      ${photoHtml}
      <div><h1>${esc(pf.display_name||'Student Portfolio')}</h1>
      <div style="color:#64748b">${esc(pf.class_name||'')} ${pf.share_token ? '· #'+pf.share_token.slice(0,8) : ''}</div>
      <div class="bio">${esc(pf.bio||'')}</div></div>
    </div>
    ${pf.interests&&pf.interests.length ? '<div class="section"><h3>Interests</h3>'+(pf.interests||[]).map(i=>`<span class="tag">${esc(i)}</span>`).join(' ')+'</div>' : ''}
    ${pf.goals&&pf.goals.length ? '<div class="section"><h3>Goals</h3><ul>'+(pf.goals||[]).map(g=>`<li>${esc(g)}</li>`).join('')+'</ul></div>' : ''}
    ${gpaData.length ? '<div class="section"><h2>Academic Performance</h2>'+svgLineChart(gpaData.map(d=>({label:d.semester,value:parseNum(d.gpa,0)})))+'</div>' : ''}
    ${Object.keys(subjects).length ? '<div class="section"><h3>Subject Performance</h3>'+Object.entries(subjects).map(([n,v])=>{const p=parseNum(v,0);const c=p>=80?'#059669':p>=60?'#f59e0b':'#dc2626';return `<div style="margin-bottom:8px"><div style="display:flex;justify-content:space-between;font-size:13px"><strong>${esc(n)}</strong><span style="color:${c}">${p}%</span></div><div class="progress-bar"><div class="progress-fill" style="width:${p}%;background:${c}"></div></div></div>`;}).join('')+'</div>' : ''}
    ${projects.length ? '<div class="section"><h2>Projects ('+projects.length+')</h2><div class="grid">'+projects.map(p=>`<div class="item"><strong>${esc(p.title)}</strong>${p.featured?' ⭐':''}<div style="font-size:12px;color:#64748b">${esc(p.description||'').slice(0,80)}</div></div>`).join('')+'</div></div>' : ''}
    ${activities.length ? '<div class="section"><h2>Activities ('+activities.length+')</h2>'+activities.map(a=>`<div class="item"><strong>${esc(a.activity_name)}</strong> <span style="color:#64748b;font-size:12px">${esc(a.role||'')} ${a.organization?'at '+esc(a.organization):''} · ${fmtDate(a.start_date)}</span><div style="font-size:12px;color:#94a3b8">${esc(a.description||'')}</div></div>`).join('')+'</div>' : ''}
    ${skills.length ? '<div class="section"><h2>Skills</h2><div style="display:flex;justify-content:center;margin-bottom:12px">'+svgRadarChart(skills.map(s=>({label:s.skill_name,value:s.self_rating})))+'</div>'+skills.map(s=>`<div style="margin-bottom:6px"><div style="display:flex;justify-content:space-between;font-size:13px"><strong>${esc(s.skill_name)}</strong><span>${s.self_rating}%</span></div><div class="progress-bar"><div class="progress-fill" style="width:${s.self_rating}%;background:#4f46e5"></div></div></div>`).join('')+'</div>' : ''}
    ${achievements.length ? '<div class="section"><h2>Achievements ('+achievements.length+')</h2><div class="grid">'+achievements.map(a=>`<div class="item"><strong>${ACHIEVEMENT_ICONS[a.type]||'🏆'} ${esc(a.title)}</strong><div style="font-size:12px;color:#64748b">${esc(a.issuer||'')} ${a.date_achieved?'· '+fmtDate(a.date_achieved):''}</div></div>`).join('')+'</div></div>' : ''}
    ${endorsements.length ? '<div class="section"><h2>Teacher Endorsements</h2>'+endorsements.map(e=>`<div class="item"><strong>${esc(e.teacher_name||'Teacher')}</strong> endorsed <strong>${esc(e.skill_name)}</strong> · ${'★'.repeat(e.rating)}</div>`).join('')+'</div>' : ''}
    <div style="margin-top:40px;padding-top:16px;border-top:2px solid #e2e8f0;text-align:center;font-size:11px;color:#94a3b8">
      Generated on ${new Date().toLocaleDateString('en-US',{year:'numeric',month:'long',day:'numeric'})} · Portfolio Completeness: ${completeness}%
    </div>
    </body></html>`;
    res.type('html').send(html);
  }));

  // ── Public Portfolio View ───────────────────────────────────
  app.get('/p/:token', ah(async (req, res) => {
    const pf = (await pool.query(`SELECT * FROM student_portfolios WHERE share_token=$1`, [req.params.token])).rows[0];
    if (!pf) return res.status(404).send('<h1>Portfolio not found</h1><p>This link may be invalid or the portfolio has been set to private.</p>');
    if (!pf.is_public) return res.status(403).send('<h1>Portfolio is Private</h1><p>This portfolio is not publicly accessible.</p>');
    // Redirect to the PDF-ready view for public
    res.redirect('/portfolio/'+pf.student_id+'/share/pdf');
  }));

  // ============================================================
  // FEATURE 9: UNIVERSITY APPLICATION READINESS
  // ============================================================
  app.get('/portfolio/:studentId/university', requireAuth, ah(async (req, res) => {
    const user = req.session.user, sid = parseInt(req.params.studentId), tid = user.tenant_id;
    const pf = await getOrCreatePortfolio(sid, tid);
    const completeness = await calcCompleteness(pf.id, tid);

    const projectCount = (await pool.query(`SELECT COUNT(*)::int as n FROM portfolio_projects WHERE portfolio_id=$1`, [pf.id])).rows[0].n;
    const activityCount = (await pool.query(`SELECT COUNT(*)::int as n FROM portfolio_activities WHERE portfolio_id=$1`, [pf.id])).rows[0].n;
    const skillCount = (await pool.query(`SELECT COUNT(*)::int as n FROM portfolio_skills WHERE portfolio_id=$1`, [pf.id])).rows[0].n;
    const achCount = (await pool.query(`SELECT COUNT(*)::int as n FROM portfolio_achievements WHERE portfolio_id=$1`, [pf.id])).rows[0].n;
    const endorseCount = (await pool.query(`SELECT COUNT(*)::int as n FROM portfolio_endorsements WHERE portfolio_id=$1`, [pf.id])).rows[0].n;
    const gpaCount = (parseJson(pf.gpa_data,[])).length;
    const subjectCount = Object.keys(parseJson(pf.subject_performance,{})).length;
    const awardCount = (parseJson(pf.academic_awards,[])).length;

    const checks = [
      { label: 'Profile photo uploaded', met: !!pf.photo_url, weight: 5, action: '/portfolio/'+sid+'/edit' },
      { label: 'Bio written (50+ chars)', met: (pf.bio||'').length >= 50, weight: 10, action: '/portfolio/'+sid+'/edit' },
      { label: 'Interests listed', met: (pf.interests||[]).length > 0, weight: 5, action: '/portfolio/'+sid+'/edit' },
      { label: 'Goals defined', met: (pf.goals||[]).length > 0, weight: 5, action: '/portfolio/'+sid+'/edit' },
      { label: 'GPA trend data (2+ semesters)', met: gpaCount >= 2, weight: 15, action: '/portfolio/'+sid+'/academic' },
      { label: 'Subject performance recorded', met: subjectCount >= 3, weight: 10, action: '/portfolio/'+sid+'/academic' },
      { label: 'Academic awards added', met: awardCount >= 1, weight: 5, action: '/portfolio/'+sid+'/academic' },
      { label: 'At least 3 projects showcased', met: projectCount >= 3, weight: 10, action: '/portfolio/'+sid+'/projects/new' },
      { label: 'At least 2 extracurricular activities', met: activityCount >= 2, weight: 10, action: '/portfolio/'+sid+'/activities' },
      { label: 'At least 5 skills rated', met: skillCount >= 5, weight: 10, action: '/portfolio/'+sid+'/skills' },
      { label: 'At least 1 achievement', met: achCount >= 1, weight: 5, action: '/portfolio/'+sid+'/achievements' },
      { label: 'At least 2 teacher endorsements', met: endorseCount >= 2, weight: 10, action: '/portfolio/'+sid+'/endorse' },
    ];

    const metCount = checks.filter(c=>c.met).length;
    const totalWeight = checks.reduce((s,c)=>s+c.weight,0);
    const earnedWeight = checks.reduce((s,c)=>s+(c.met?c.weight:0),0);
    const readinessScore = totalWeight ? Math.round((earnedWeight/totalWeight)*100) : 0;

    const statusColor = readinessScore >= 80 ? COLORS.success : readinessScore >= 50 ? COLORS.warning : COLORS.danger;
    const statusLabel = readinessScore >= 80 ? 'Application Ready!' : readinessScore >= 50 ? 'Almost There' : 'Needs Work';
    const statusBg = readinessScore >= 80 ? COLORS.successBg : readinessScore >= 50 ? COLORS.warningBg : COLORS.dangerBg;

    const checksHtml = checks.map(c => `<div style="display:flex;align-items:center;gap:12px;padding:12px;border-radius:10px;background:${c.met?COLORS.successBg:'#fff'};border:1px solid ${c.met?'#bbf7d0':COLORS.border};margin-bottom:6px">
      <div style="width:28px;height:28px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:14px;background:${c.met?COLORS.success:'#f1f5f9'};color:${c.met?'#fff':COLORS.grayLight};flex-shrink:0">${c.met?'✓':'○'}</div>
      <div style="flex:1"><div style="font-size:13px;font-weight:600;color:${c.met?COLORS.dark:COLORS.gray}">${esc(c.label)}</div></div>
      ${!c.met ? `<a href="${c.action}" class="pf-btn pf-btn-secondary" style="padding:4px 10px;font-size:11px">→ Fix</a>` : ''}
    </div>`).join('');

    const html = PORTFOLIO_CSS + `<div style="max-width:900px;margin:0 auto">
      ${pfNav('university', sid)}
      <div style="display:grid;grid-template-columns:280px 1fr;gap:20px">
        <div>
          <div class="pf-section" style="text-align:center">
            <div style="font-size:14px;font-weight:700;color:${COLORS.gray};margin-bottom:12px">APPLICATION READINESS</div>
            <div style="display:flex;justify-content:center;margin-bottom:12px">${svgProgressRing(readinessScore, 140, 12)}</div>
            <div class="pf-shield" style="background:${statusBg};color:${statusColor};font-size:15px;padding:10px 20px;display:inline-flex">${statusLabel}</div>
            <div style="margin-top:16px;font-size:13px;color:${COLORS.gray}"><strong>${metCount}</strong> of ${checks.length} requirements met</div>
          </div>
          <div class="pf-section">
            <h3>📊 Quick Stats</h3>
            <div style="display:flex;flex-direction:column;gap:8px">
              ${[
                {label:'Projects',val:projectCount,target:3,color:COLORS.primary},
                {label:'Activities',val:activityCount,target:2,color:COLORS.success},
                {label:'Skills',val:skillCount,target:5,color:COLORS.warning},
                {label:'Achievements',val:achCount,target:1,color:'#8b5cf6'},
                {label:'Endorsements',val:endorseCount,target:2,color:'#ec4899'},
                {label:'GPA Entries',val:gpaCount,target:2,color:'#06b6d4'},
              ].map(s=>`<div>
                <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:2px"><span style="color:${COLORS.gray};font-weight:600">${esc(s.label)}</span><span style="color:${s.val>=s.target?s.color:COLORS.grayLight};font-weight:700">${s.val}/${s.target}</span></div>
                <div class="pf-progress-bar" style="height:6px"><div class="pf-progress-fill" style="width:${Math.min(100,(s.val/s.target)*100)}%;background:${s.color}"></div></div>
              </div>`).join('')}
            </div>
          </div>
          <a href="/portfolio/${sid}/share" class="pf-btn pf-btn-outline" style="width:100%;justify-content:center;margin-bottom:12px">🔗 Share Portfolio</a>
          <a href="/portfolio/${sid}/share/pdf" target="_blank" class="pf-btn pf-btn-secondary" style="width:100%;justify-content:center">📄 Download PDF View</a>
        </div>
        <div class="pf-section">
          <h3>🎓 University Readiness Checklist</h3>
          <p style="font-size:13px;color:${COLORS.gray};margin-bottom:16px">Complete these items to strengthen your university application portfolio.</p>
          ${checksHtml}
          <div style="margin-top:20px;padding:16px;background:${COLORS.primaryBg};border-radius:12px;border:1px solid #c7d2fe">
            <div style="font-size:13px;font-weight:700;color:${COLORS.primary};margin-bottom:6px">💡 Pro Tips for University Applications</div>
            <ul style="margin:0;padding-left:18px;font-size:12px;color:#4338ca;line-height:1.8">
              <li>Get at least 3 teacher endorsements for diverse skills</li>
              <li>Showcase projects that demonstrate leadership and initiative</li>
              <li>Keep your bio updated and tailored to your target field</li>
              <li>Make your portfolio public before sharing with universities</li>
              <li>Use the PDF view to include in your application package</li>
            </ul>
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('University Readiness', html, user, req));
  }));

  // ============================================================
  // API: GET PORTFOLIO DATA (for AJAX/frontend consumption)
  // ============================================================
  app.get('/api/portfolio/:studentId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    const completeness = await calcCompleteness(pf.id, tid);
    const [projects, activities, skills, achievements, endorsements] = await Promise.all([
      pool.query(`SELECT * FROM portfolio_projects WHERE portfolio_id=$1 ORDER BY featured DESC, created_at DESC`, [pf.id]),
      pool.query(`SELECT * FROM portfolio_activities WHERE portfolio_id=$1 ORDER BY start_date DESC`, [pf.id]),
      pool.query(`SELECT * FROM portfolio_skills WHERE portfolio_id=$1 ORDER BY self_rating DESC`, [pf.id]),
      pool.query(`SELECT * FROM portfolio_achievements WHERE portfolio_id=$1 ORDER BY date_achieved DESC`, [pf.id]),
      pool.query(`SELECT pe.*, u.name as teacher_name FROM portfolio_endorsements pe LEFT JOIN users u ON u.id=pe.teacher_id WHERE pe.portfolio_id=$1`, [pf.id]),
    ]);
    res.json({
      success: true,
      portfolio: { ...pf, completeness_score: completeness },
      projects: projects.rows,
      activities: activities.rows,
      skills: skills.rows,
      achievements: achievements.rows,
      endorsements: endorsements.rows
    });
  }));

  // ============================================================
  // ADMIN: LIST ALL PORTFOLIOS (teacher/admin view)
  // ============================================================
  app.get('/admin/portfolios', requireAuth, ah(async (req, res) => {
    const user = req.session.user, tid = user.tenant_id;
    const search = req.query.search || '';
    let where = 'sp.tenant_id = $1', params = [tid], pi = 2;
    if (search) { where += ` AND (sp.display_name ILIKE $${pi} OR sp.class_name ILIKE $${pi})`; params.push(`%${search}%`); pi++; }
    const portfolios = (await pool.query(
      `SELECT sp.*, s.name as student_name, s.admission_number
       FROM student_portfolios sp LEFT JOIN students s ON s.id=sp.student_id
       WHERE ${where} ORDER BY sp.completeness_score DESC, sp.last_updated DESC`, params
    )).rows;

    const rowsHtml = portfolios.map(p => `<tr>
      <td><a href="/portfolio/${p.student_id}" style="color:${COLORS.primary};text-decoration:none;font-weight:600">${esc(p.display_name || p.student_name || 'Student #'+p.student_id)}</a></td>
      <td>${esc(p.class_name||'—')}</td>
      <td>${esc(p.admission_number||'—')}</td>
      <td><div style="display:flex;align-items:center;gap:8px"><div class="pf-progress-bar" style="width:80px;height:6px"><div class="pf-progress-fill" style="width:${p.completeness_score}%;background:${p.completeness_score>=80?COLORS.success:p.completeness_score>=50?COLORS.warning:COLORS.danger}"></div></div><span style="font-size:12px;font-weight:700">${p.completeness_score}%</span></div></td>
      <td>${p.is_public ? '<span style="color:'+COLORS.success+';font-weight:600">Public</span>' : '<span style="color:'+COLORS.grayLight+'">Private</span>'}</td>
      <td style="font-size:12px;color:${COLORS.grayLight}">${fmtDate(p.last_updated)}</td>
      <td><a href="/portfolio/${p.student_id}/endorse" class="pf-btn pf-btn-secondary" style="padding:4px 10px;font-size:11px">✍️ Endorse</a></td>
    </tr>`).join('');

    const html = PORTFOLIO_CSS + `<div style="max-width:1200px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <div><h1 style="font-size:24px;color:${COLORS.dark};margin:0">🎓 Student Portfolios</h1>
        <p style="font-size:13px;color:${COLORS.grayLight};margin-top:2px">Monitor and manage student portfolio progress</p></div>
        <form method="GET" style="display:flex;gap:6px"><input type="text" name="search" value="${esc(search)}" placeholder="Search students..." style="padding:8px 14px;border:2px solid ${COLORS.border};border-radius:10px;font-size:13px"><button type="submit" class="pf-btn pf-btn-primary">Search</button></form>
      </div>
      <div class="pf-section" style="padding:0;overflow:hidden">
        <table class="pf-table">
          <thead><tr><th>Student</th><th>Class</th><th>Adm No</th><th>Completeness</th><th>Visibility</th><th>Updated</th><th>Actions</th></tr></thead>
          <tbody>${rowsHtml || '<tr><td colspan="7" style="text-align:center;color:'+COLORS.grayLight+';padding:30px">No portfolios found</td></tr>'}</tbody>
        </table>
      </div>
    </div>`;
    res.send(renderPage('Admin — Portfolios', html, user, req));
  }));

  // ============================================================
  // API: DELETE GPA / SUBJECT / AWARD entries
  // ============================================================
  app.post('/portfolio/:studentId/academic/gpa/clear', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    await pool.query(`UPDATE student_portfolios SET gpa_data='[]', last_updated=NOW() WHERE id=$1 AND tenant_id=$2`, [pf.id, tid]);
    res.redirect('/portfolio/'+sid+'/academic');
  }));

  app.post('/portfolio/:studentId/academic/subjects/clear', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    await pool.query(`UPDATE student_portfolios SET subject_performance='{}', last_updated=NOW() WHERE id=$1 AND tenant_id=$2`, [pf.id, tid]);
    res.redirect('/portfolio/'+sid+'/academic');
  }));

  app.post('/portfolio/:studentId/academic/awards/clear', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id, sid = parseInt(req.params.studentId);
    const pf = await getOrCreatePortfolio(sid, tid);
    await pool.query(`UPDATE student_portfolios SET academic_awards='[]', last_updated=NOW() WHERE id=$1 AND tenant_id=$2`, [pf.id, tid]);
    res.redirect('/portfolio/'+sid+'/academic');
  }));

  console.log('[StudentPortfolio] Module loaded — 30+ routes registered');
};
