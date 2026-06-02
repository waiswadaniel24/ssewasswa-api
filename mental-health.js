/**
 * Mental Health & Wellness Tracker Module
 * Features: Mood Check-in, Wellness Resources, Counsellor Booking, Anonymous Reporting,
 *           Crisis Alert, Sleep Tracker, Gratitude Journal, Counsellor Dashboard, Breathing Exercise
 */

const { migrateQuery } = require('./db');
module.exports = function (app, pool, opts) {
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((t, c, u) => c);
  const ah = opts.ah || (fn => async (req, res, next) => { try { await fn(req, res, next); } catch (e) { res.status(500).send('Error: ' + e.message); } });
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const requireCounsellor = opts.requireCounsellor || ((req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    const r = (req.session.user.role || '').toLowerCase();
    if (r !== 'counsellor' && r !== 'admin' && r !== 'superadmin') return res.status(403).send('Access denied');
    next();
  });
  const requireAdmin = opts.requireAdmin || ((req, res, next) => {
    if (!req.session?.user) return res.redirect('/login');
    const r = (req.session.user.role || '').toLowerCase();
    if (r !== 'admin' && r !== 'superadmin') return res.status(403).send('Access denied');
    next();
  });
  const audit = opts.audit || (() => {});
  const queueEmail = opts.queueEmail || (() => {});
  const tid = () => req => req.session?.user?.tenant_id || 0;

  // ─── COLORS ──────────────────────────────────────────────────────
  const COLORS = {
    primary: '#4f46e5',
    primaryLight: '#6366f1',
    green: '#059669',
    greenLight: '#10b981',
    red: '#dc2626',
    redLight: '#ef4444',
    orange: '#f59e0b',
    orangeLight: '#fbbf24',
    bg: '#f0f4ff',
    card: '#ffffff',
    text: '#1e293b',
    textMuted: '#64748b',
    border: '#e2e8f0',
    mood1: '#dc2626',
    mood2: '#f59e0b',
    mood3: '#eab308',
    mood4: '#22c55e',
    mood5: '#059669',
    sleepGood: '#059669',
    sleepWarn: '#f59e0b',
    sleepBad: '#dc2626',
    calming: '#6366f1'
  };

  const MOOD_EMOJI = ['', '😫', '😔', '😐', '😊', '😄'];
  const MOOD_LABEL = ['', 'Terrible', 'Bad', 'Okay', 'Good', 'Great'];
  const RESOURCE_CATS = ['stress', 'anxiety', 'depression', 'sleep', 'nutrition', 'exercise', 'mindfulness', 'study tips'];
  const REPORT_TYPES = ['self-harm', 'bullying', 'substance abuse', 'home issues', 'other'];

  // ─── SVG HELPERS ─────────────────────────────────────────────────
  function svgLineChart(data, opts = {}) {
    const w = opts.width || 700;
    const h = opts.height || 250;
    const pad = { top: 30, right: 20, bottom: 40, left: 40 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;
    const minV = opts.minV ?? 1;
    const maxV = opts.maxV ?? 5;
    const labelY = opts.labelY || (v => v);
    const color = opts.color || COLORS.primary;
    if (!data.length) return `<svg width="${w}" height="${h}" role="img" aria-label="No data"><text x="${w / 2}" y="${h / 2}" fill="${COLORS.textMuted}" text-anchor="middle">No data available</text></svg>`;
    const points = data.map((d, i) => ({
      x: pad.left + (i / Math.max(data.length - 1, 1)) * cw,
      y: pad.top + ch - ((d.v - minV) / (maxV - minV)) * ch
    }));
    let gridLines = '';
    for (let i = minV; i <= maxV; i++) {
      const y = pad.top + ch - ((i - minV) / (maxV - minV)) * ch;
      gridLines += `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="${COLORS.border}" stroke-width="1" stroke-dasharray="4,4"/>`;
      gridLines += `<text x="${pad.left - 8}" y="${y + 4}" fill="${COLORS.textMuted}" text-anchor="end" font-size="11">${labelY(i)}</text>`;
    }
    const poly = points.map(p => `${p.x},${p.y}`).join(' ');
    const areaPoly = `${pad.left},${pad.top + ch} ${poly} ${points[points.length - 1].x},${pad.top + ch}`;
    let dots = points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="${color}" stroke="#fff" stroke-width="2"><title>${p.v}</title></circle>`).join('');
    let labels = data.map((d, i) => `<text x="${points[i].x}" y="${h - 8}" fill="${COLORS.textMuted}" text-anchor="middle" font-size="10" transform="rotate(-30,${points[i].x},${h - 8})">${esc(d.l)}</text>`).join('');
    return `<svg width="${w}" height="${h}" role="img" aria-label="${opts.title || 'Chart'}">
      <rect width="${w}" height="${h}" fill="${COLORS.card}" rx="8"/>
      ${gridLines}
      <polygon points="${areaPoly}" fill="${color}" opacity="0.1"/>
      <polyline points="${poly}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${dots}${labels}
      ${opts.title ? `<text x="${w / 2}" y="18" fill="${COLORS.text}" text-anchor="middle" font-size="13" font-weight="bold">${esc(opts.title)}</text>` : ''}
    </svg>`;
  }

  function svgBarChart(data, opts = {}) {
    const w = opts.width || 600;
    const h = opts.height || 250;
    const pad = { top: 30, right: 20, bottom: 40, left: 45 };
    const cw = w - pad.left - pad.right;
    const ch = h - pad.top - pad.bottom;
    const maxV = opts.maxV || Math.max(...data.map(d => d.v), 1);
    const minV = opts.minV || 0;
    const colorFn = opts.colorFn || (() => COLORS.primary);
    if (!data.length) return `<svg width="${w}" height="${h}" role="img" aria-label="No data"><text x="${w / 2}" y="${h / 2}" fill="${COLORS.textMuted}" text-anchor="middle">No data available</text></svg>`;
    const barW = Math.min(40, (cw / data.length) * 0.7);
    const gap = cw / data.length;
    let bars = '';
    let labels = '';
    let gridLines = '';
    for (let i = 0; i <= 4; i++) {
      const v = minV + ((maxV - minV) / 4) * i;
      const y = pad.top + ch - ((v - minV) / (maxV - minV)) * ch;
      gridLines += `<line x1="${pad.left}" y1="${y}" x2="${w - pad.right}" y2="${y}" stroke="${COLORS.border}" stroke-width="1" stroke-dasharray="4,4"/>`;
      gridLines += `<text x="${pad.left - 8}" y="${y + 4}" fill="${COLORS.textMuted}" text-anchor="end" font-size="11">${Math.round(v)}</text>`;
    }
    data.forEach((d, i) => {
      const x = pad.left + i * gap + gap / 2 - barW / 2;
      const barH = ((d.v - minV) / (maxV - minV)) * ch;
      const y = pad.top + ch - barH;
      const c = colorFn(d.v);
      bars += `<rect x="${x}" y="${y}" width="${barW}" height="${Math.max(barH, 0)}" fill="${c}" rx="4"><title>${esc(d.l)}: ${d.v}</title></rect>`;
      bars += `<text x="${x + barW / 2}" y="${y - 6}" fill="${COLORS.text}" text-anchor="middle" font-size="11" font-weight="bold">${d.v}</text>`;
      labels += `<text x="${pad.left + i * gap + gap / 2}" y="${h - 8}" fill="${COLORS.textMuted}" text-anchor="middle" font-size="10">${esc(d.l)}</text>`;
    });
    return `<svg width="${w}" height="${h}" role="img" aria-label="${opts.title || 'Chart'}">
      <rect width="${w}" height="${h}" fill="${COLORS.card}" rx="8"/>
      ${gridLines}${bars}${labels}
      ${opts.title ? `<text x="${w / 2}" y="18" fill="${COLORS.text}" text-anchor="middle" font-size="13" font-weight="bold">${esc(opts.title)}</text>` : ''}
    </svg>`;
  }

  function svgMoodCalendar(entries) {
    const today = new Date();
    const weeks = 6;
    const cellSize = 36;
    const pad = 60;
    const w = 7 * cellSize + pad + 40;
    const h = weeks * cellSize + pad + 20;
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let svg = `<svg width="${w}" height="${h}" role="img" aria-label="Mood Calendar">
      <rect width="${w}" height="${h}" fill="${COLORS.card}" rx="8"/>`;
    dayNames.forEach((dn, i) => {
      svg += `<text x="${pad + i * cellSize + cellSize / 2}" y="20" fill="${COLORS.textMuted}" text-anchor="middle" font-size="10">${dn}</text>`;
    });
    const entryMap = {};
    entries.forEach(e => { entryMap[e.date] = e.mood; });
    const startOfWeek = (d => d.getDay());
    let cur = new Date(today);
    cur.setDate(cur.getDate() - today.getDay() - (weeks - 1) * 7);
    for (let week = 0; week < weeks; week++) {
      for (let day = 0; day < 7; day++) {
        const x = pad + day * cellSize;
        const y = pad + week * cellSize;
        const dateStr = cur.toISOString().slice(0, 10);
        const isToday = dateStr === today.toISOString().slice(0, 10);
        const mood = entryMap[dateStr];
        let fill = '#f8fafc';
        if (mood) fill = COLORS[`mood${mood}`] || '#f8fafc';
        svg += `<rect x="${x + 2}" y="${y + 2}" width="${cellSize - 4}" height="${cellSize - 4}" fill="${fill}" rx="6" stroke="${isToday ? COLORS.primary : COLORS.border}" stroke-width="${isToday ? 2 : 1}"/>`;
        svg += `<text x="${x + cellSize / 2}" y="${y + cellSize / 2 - 2}" fill="${mood ? '#fff' : COLORS.textMuted}" text-anchor="middle" font-size="14">${mood ? MOOD_EMOJI[mood] : cur.getDate()}</text>`;
        svg += `<text x="${x + cellSize / 2}" y="${y + cellSize - 4}" fill="${COLORS.textMuted}" text-anchor="middle" font-size="8">${cur.getDate()}</text>`;
        cur.setDate(cur.getDate() + 1);
      }
    }
    svg += `</svg>`;
    return svg;
  }

  function breathingSvg() {
    return `
    <div id="breathing-container" style="text-align:center;padding:40px;">
      <svg id="breath-svg" width="300" height="300" viewBox="0 0 300 300" role="img" aria-label="Breathing exercise animation" style="margin:0 auto;display:block;">
        <defs>
          <radialGradient id="breathGrad">
            <stop offset="0%" stop-color="${COLORS.calming}" stop-opacity="0.6"/>
            <stop offset="100%" stop-color="${COLORS.primary}" stop-opacity="0.15"/>
          </radialGradient>
        </defs>
        <circle id="breath-circle" cx="150" cy="150" r="60" fill="url(#breathGrad)" stroke="${COLORS.calming}" stroke-width="3"/>
        <text id="breath-text" x="150" y="145" fill="${COLORS.text}" text-anchor="middle" font-size="22" font-weight="bold">Start</text>
        <text id="breath-timer" x="150" y="170" fill="${COLORS.textMuted}" text-anchor="middle" font-size="14"></text>
      </svg>
      <p style="color:${COLORS.textMuted};margin-top:20px;">4-7-8 Breathing Pattern</p>
      <p style="color:${COLORS.textMuted};font-size:14px;">Inhale 4s → Hold 7s → Exhale 8s</p>
      <button onclick="toggleBreathing()" id="breath-btn" style="margin-top:20px;padding:12px 32px;background:${COLORS.primary};color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;">Begin Exercise</button>
      <button onclick="stopBreathing()" id="breath-stop" style="display:none;margin-top:10px;padding:10px 24px;background:${COLORS.red};color:#fff;border:none;border-radius:8px;font-size:14px;cursor:pointer;">Stop</button>
      <p id="breath-count" style="margin-top:12px;color:${COLORS.textMuted};font-size:13px;">Cycles completed: <span id="cycle-num">0</span></p>
    </div>
    <script>
      let breathRunning=false, breathTimeout=null, cycles=0, phaseTimer=null;
      function toggleBreathing(){
        if(breathRunning){stopBreathing();return;}
        breathRunning=true;
        cycles=0;
        document.getElementById('breath-btn').style.display='none';
        document.getElementById('breath-stop').style.display='inline-block';
        runCycle();
      }
      function stopBreathing(){
        breathRunning=false;
        clearTimeout(breathTimeout);clearTimeout(phaseTimer);
        const c=document.getElementById('breath-circle');
        c.setAttribute('r','60');c.style.transition='none';
        document.getElementById('breath-text').textContent='Start';
        document.getElementById('breath-timer').textContent='';
        document.getElementById('breath-btn').style.display='inline-block';
        document.getElementById('breath-stop').style.display='none';
      }
      function animateCircle(r,dur,txt){
        return new Promise(resolve=>{
          const c=document.getElementById('breath-circle');
          c.style.transition='r '+dur+'s ease-in-out';
          c.setAttribute('r',r);
          document.getElementById('breath-text').textContent=txt;
          let sec=dur;
          document.getElementById('breath-timer').textContent=sec+'s';
          const iv=setInterval(()=>{
            sec--;
            if(sec>0)document.getElementById('breath-timer').textContent=sec+'s';
            else{clearInterval(iv);document.getElementById('breath-timer').textContent='';}
          },1000);
          phaseTimer=setTimeout(()=>{clearInterval(iv);resolve();},dur*1000);
        });
      }
      async function runCycle(){
        while(breathRunning){
          await animateCircle(130,4,'Breathe In');
          if(!breathRunning)break;
          await animateCircle(130,7,'Hold');
          if(!breathRunning)break;
          await animateCircle(60,8,'Breathe Out');
          if(!breathRunning)break;
          cycles++;
          document.getElementById('cycle-num').textContent=cycles;
          await new Promise(r=>{breathTimeout=setTimeout(r,1500);});
        }
      }
    </script>`;
  }

  // ─── SHARED LAYOUT ───────────────────────────────────────────────
  function pageShell(title, content, nav) {
    const navItems = [
      { href: '/mental-health', label: '📊 Dashboard', active: nav === 'dash' },
      { href: '/mental-health/mood-checkin', label: '😊 Mood Check-in', active: nav === 'mood' },
      { href: '/mental-health/mood-calendar', label: '📅 Mood Calendar', active: nav === 'cal' },
      { href: '/mental-health/sleep-tracker', label: '😴 Sleep Tracker', active: nav === 'sleep' },
      { href: '/mental-health/gratitude-journal', label: '🙏 Gratitude', active: nav === 'grat' },
      { href: '/mental-health/wellness-resources', label: '📚 Resources', active: nav === 'res' },
      { href: '/mental-health/counsellor-booking', label: '📅 Book Session', active: nav === 'book' },
      { href: '/mental-health/anonymous-report', label: '🔒 Report', active: nav === 'anon' },
      { href: '/mental-health/breathing-exercise', label: '🫁 Breathing', active: nav === 'breath' }
    ];
    let navHtml = navItems.map(n =>
      `<a href="${n.href}" style="display:inline-block;padding:8px 14px;margin:3px;border-radius:8px;text-decoration:none;font-size:14px;font-weight:500;${n.active ? 'background:' + COLORS.primary + ';color:#fff;' : 'color:' + COLORS.text + ';background:#f1f5f9;'}">${n.label}</a>`
    ).join('');
    return `<div style="max-width:1100px;margin:0 auto;padding:20px;font-family:system-ui,-apple-system,sans-serif;color:${COLORS.text};">
      <h1 style="color:${COLORS.primary};margin-bottom:6px;font-size:28px;">${esc(title)}</h1>
      <p style="color:${COLORS.textMuted};margin-bottom:16px;font-size:14px;">Your mental health matters. Track, reflect, and grow.</p>
      <nav style="margin-bottom:24px;padding:12px;background:${COLORS.card};border-radius:12px;border:1px solid ${COLORS.border};display:flex;flex-wrap:wrap;" aria-label="Mental Health Navigation">${navHtml}</nav>
      <div style="background:${COLORS.card};border-radius:12px;border:1px solid ${COLORS.border};padding:24px;">${content}</div>
    </div>`;
  }

  // ─── CRISIS DETECTION ────────────────────────────────────────────
  async function checkCrisis(userId, tenantId) {
    const { rows } = await pool.query(
      `SELECT mood FROM mood_checkins WHERE user_id = $1 AND tenant_id = $2 AND checkin_date >= CURRENT_DATE - INTERVAL '3 days' ORDER BY checkin_date DESC LIMIT 3`,
      [userId, tenantId]
    );
    if (rows.length >= 3 && rows.every(r => r.mood === 1)) {
      await pool.query(
        `INSERT INTO crisis_alerts (user_id, tenant_id, reason, created_at) VALUES ($1, $2, $3, NOW())
         ON CONFLICT DO NOTHING`,
        [userId, tenantId, 'Mood rated terrible 3+ consecutive days']
      );
      const { rows: counsellors } = await pool.query(
        `SELECT email FROM users WHERE tenant_id = $1 AND (role = 'counsellor' OR role = 'admin') LIMIT 5`,
        [tenantId]
      );
      counsellors.forEach(c => {
        queueEmail({
          to: c.email,
          subject: '🚨 CRISIS ALERT — Student Needs Immediate Attention',
          body: `A student (ID: ${userId}) has reported a "terrible" mood for 3 or more consecutive days. Please check the counsellor dashboard and reach out immediately.`
        });
      });
      audit({ action: 'crisis_alert_triggered', userId, tenantId, detail: '3 consecutive terrible moods' });
    }
  }

  // ─── TABLES ──────────────────────────────────────────────────────
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS mood_checkins (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER NOT NULL,
        mood INTEGER NOT NULL CHECK (mood BETWEEN 1 AND 5),
        note TEXT,
        checkin_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, user_id, checkin_date)
      );
      CREATE INDEX IF NOT EXISTS idx_mood_tenant_user ON mood_checkins(tenant_id, user_id);
      CREATE INDEX IF NOT EXISTS idx_mood_date ON mood_checkins(checkin_date);
    `);
    await migrateQuery(pool, 'MentalHealth', `
      CREATE TABLE IF NOT EXISTS wellness_resources (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        title VARCHAR(300) NOT NULL,
        description TEXT,
        category VARCHAR(100) NOT NULL,
        content_type VARCHAR(50) DEFAULT 'article',
        url VARCHAR(500),
        body TEXT,
        is_active BOOLEAN DEFAULT true,
        created_by INTEGER,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_wr_tenant_cat ON wellness_resources(tenant_id, category);
    `);
    await migrateQuery(pool, 'MentalHealth', `
      CREATE TABLE IF NOT EXISTS counsellor_bookings (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        student_id INTEGER NOT NULL,
        counsellor_id INTEGER NOT NULL,
        booking_date DATE NOT NULL,
        time_slot VARCHAR(50) NOT NULL,
        status VARCHAR(30) DEFAULT 'pending',
        notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS idx_cb_tenant_counsellor ON counsellor_bookings(tenant_id, counsellor_id);
      CREATE INDEX IF NOT EXISTS idx_cb_student ON counsellor_bookings(student_id);
    `);
    await migrateQuery(pool, 'MentalHealth', `
      CREATE TABLE IF NOT EXISTS anonymous_reports (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        report_type VARCHAR(100) NOT NULL,
        description TEXT NOT NULL,
        is_crisis BOOLEAN DEFAULT false,
        is_resolved BOOLEAN DEFAULT false,
        counsellor_notes TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );
      CREATE INDEX IF NOT EXISTS idx_ar_tenant ON anonymous_reports(tenant_id);
    `);
    await migrateQuery(pool, 'MentalHealth', `
      CREATE TABLE IF NOT EXISTS sleep_logs (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER NOT NULL,
        sleep_hours NUMERIC(3,1) NOT NULL CHECK (sleep_hours BETWEEN 0 AND 12),
        quality INTEGER CHECK (quality BETWEEN 1 AND 5),
        note TEXT,
        log_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, user_id, log_date)
      );
      CREATE INDEX IF NOT EXISTS idx_sleep_tenant_user ON sleep_logs(tenant_id, user_id);
    `);
    await migrateQuery(pool, 'MentalHealth', `
      CREATE TABLE IF NOT EXISTS gratitude_entries (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER NOT NULL,
        entry1 TEXT NOT NULL,
        entry2 TEXT NOT NULL,
        entry3 TEXT NOT NULL,
        entry_date DATE NOT NULL DEFAULT CURRENT_DATE,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, user_id, entry_date)
      );
      CREATE INDEX IF NOT EXISTS idx_grat_tenant_user ON gratitude_entries(tenant_id, user_id);
    `);
    await migrateQuery(pool, 'MentalHealth', `
      CREATE TABLE IF NOT EXISTS crisis_alerts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL DEFAULT 0,
        user_id INTEGER NOT NULL,
        reason TEXT,
        is_resolved BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        resolved_at TIMESTAMPTZ
      );
    `);
  })();

  // ═══════════════════════════════════════════════════════════════════
  // ROUTE 1: MAIN DASHBOARD
  // ═══════════════════════════════════════════════════════════════════
  app.get('/mental-health', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    const today = new Date().toISOString().slice(0, 10);
    const { rows: todayMood } = await pool.query(
      `SELECT mood, note FROM mood_checkins WHERE user_id=$1 AND tenant_id=$2 AND checkin_date=$3`, [uid, t, today]
    );
    const { rows: moodHistory } = await pool.query(
      `SELECT mood, checkin_date FROM mood_checkins WHERE user_id=$1 AND tenant_id=$2 AND checkin_date >= CURRENT_DATE - INTERVAL '30 days' ORDER BY checkin_date`, [uid, t]
    );
    const { rows: sleepToday } = await pool.query(
      `SELECT sleep_hours FROM sleep_logs WHERE user_id=$1 AND tenant_id=$2 AND log_date=$3`, [uid, t, today]
    );
    const { rows: sleepWeek } = await pool.query(
      `SELECT sleep_hours, log_date FROM sleep_logs WHERE user_id=$1 AND tenant_id=$2 AND log_date >= CURRENT_DATE - INTERVAL '6 days' ORDER BY log_date`, [uid, t]
    );
    const avgSleep = sleepWeek.length ? (sleepWeek.reduce((s, r) => s + parseFloat(r.sleep_hours), 0) / sleepWeek.length).toFixed(1) : null;
    const { rows: gratToday } = await pool.query(
      `SELECT id FROM gratitude_entries WHERE user_id=$1 AND tenant_id=$2 AND entry_date=$3`, [uid, t, today]
    );
    const moodChartData = moodHistory.map(r => ({
      v: r.mood, l: r.checkin_date.slice(5)
    }));
    const moodChart = svgLineChart(moodChartData, {
      title: 'Mood Trend (30 Days)', color: COLORS.primary,
      labelY: v => MOOD_EMOJI[v] + ' ' + MOOD_LABEL[v]
    });
    const streak = (() => {
      let s = 0;
      const d = new Date();
      for (let i = 0; i < 365; i++) {
        const ds = d.toISOString().slice(0, 10);
        const found = moodHistory.find(m => m.checkin_date.slice(0, 10) === ds);
        if (found) { s++; } else if (i === 0) { /* today might not be checked */ } else { break; }
        d.setDate(d.getDate() - 1);
      }
      return s;
    })();

    let html = `
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:16px;margin-bottom:24px;">
        <div style="background:linear-gradient(135deg,${COLORS.primary},${COLORS.primaryLight});padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Today's Mood</div>
          <div style="font-size:36px;margin:8px 0;">${todayMood.length ? MOOD_EMOJI[todayMood[0].mood] : '—'}</div>
          <div style="font-size:13px;">${todayMood.length ? MOOD_LABEL[todayMood[0].mood] : 'Not checked in'}</div>
        </div>
        <div style="background:linear-gradient(135deg,${COLORS.green},${COLORS.greenLight});padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Mood Streak</div>
          <div style="font-size:36px;margin:8px 0;">${streak}🔥</div>
          <div style="font-size:13px;">consecutive days</div>
        </div>
        <div style="background:linear-gradient(135deg,#7c3aed,#8b5cf6);padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Avg Sleep (7d)</div>
          <div style="font-size:36px;margin:8px 0;">${avgSleep || '—'}h</div>
          <div style="font-size:13px;">${avgSleep && avgSleep < 6 ? '⚠️ Below recommended' : 'On track'}</div>
        </div>
        <div style="background:linear-gradient(135deg,${COLORS.orange},#fb923c);padding:20px;border-radius:12px;color:#fff;">
          <div style="font-size:13px;opacity:0.9;">Today's Gratitude</div>
          <div style="font-size:36px;margin:8px 0;">${gratToday.length ? '✅' : '—'}</div>
          <div style="font-size:13px;">${gratToday.length ? 'Completed' : 'Not yet'}</div>
        </div>
      </div>
      ${moodChart}
      <div style="margin-top:24px;display:flex;gap:12px;flex-wrap:wrap;">
        <a href="/mental-health/mood-checkin" style="padding:12px 20px;background:${COLORS.primary};color:#fff;border-radius:8px;text-decoration:none;font-weight:500;">😊 Check In Now</a>
        <a href="/mental-health/gratitude-journal" style="padding:12px 20px;background:${COLORS.green};color:#fff;border-radius:8px;text-decoration:none;font-weight:500;">🙏 Write Gratitude</a>
        <a href="/mental-health/sleep-tracker" style="padding:12px 20px;background:#7c3aed;color:#fff;border-radius:8px;text-decoration:none;font-weight:500;">😴 Log Sleep</a>
        <a href="/mental-health/breathing-exercise" style="padding:12px 20px;background:${COLORS.calming};color:#fff;border-radius:8px;text-decoration:none;font-weight:500;">🫁 Breathe</a>
      </div>
    `;
    res.send(renderPage('Mental Health Dashboard', pageShell('Mental Health & Wellness', html, 'dash'), req));
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ROUTE 2: MOOD CHECK-IN
  // ═══════════════════════════════════════════════════════════════════
  app.get('/mental-health/mood-checkin', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    const today = new Date().toISOString().slice(0, 10);
    const { rows: existing } = await pool.query(
      `SELECT id, mood, note FROM mood_checkins WHERE user_id=$1 AND tenant_id=$2 AND checkin_date=$3`, [uid, t, today]
    );
    let html = '';
    if (existing.length) {
      const e = existing[0];
      html = `<div style="text-align:center;padding:20px;">
        <p style="font-size:48px;margin:12px 0;">${MOOD_EMOJI[e.mood]}</p>
        <p style="font-size:20px;color:${COLORS[`mood${e.mood}`]};font-weight:600;">You're feeling ${MOOD_LABEL[e.mood].toLowerCase()} today</p>
        ${e.note ? `<p style="color:${COLORS.textMuted};margin-top:8px;">${esc(e.note)}</p>` : ''}
        <form method="POST" action="/mental-health/mood-checkin" style="margin-top:16px;">
          <button type="submit" name="delete" value="1" style="padding:10px 20px;background:${COLORS.red};color:#fff;border:none;border-radius:8px;cursor:pointer;">Delete Today's Entry</button>
        </form>
      </div>`;
    } else {
      const emojis = [1, 2, 3, 4, 5].map(m =>
        `<label style="cursor:pointer;text-align:center;padding:16px;border-radius:12px;border:2px solid ${COLORS.border};transition:all 0.2s;display:inline-block;width:100px;">
          <input type="radio" name="mood" value="${m}" required style="display:none;" onchange="document.querySelectorAll('.mood-opt').forEach(e=>e.style.borderColor='${COLORS.border}');this.closest('.mood-opt').style.borderColor='${COLORS[`mood${m}`]}';"/>
          <div class="mood-opt" style="font-size:40px;">${MOOD_EMOJI[m]}</div>
          <div style="font-size:12px;color:${COLORS[`mood${m}`]};font-weight:500;">${MOOD_LABEL[m]}</div>
        </label>`
      ).join('');
      html = `<form method="POST" action="/mental-health/mood-checkin" style="text-align:center;" aria-label="Mood check-in form">
        <p style="font-size:18px;font-weight:600;margin-bottom:16px;">How are you feeling today?</p>
        <div style="display:flex;gap:12px;justify-content:center;flex-wrap:wrap;margin-bottom:20px;">${emojis}</div>
        <div style="max-width:400px;margin:0 auto;">
          <label for="mood-note" style="display:block;font-size:14px;color:${COLORS.textMuted};margin-bottom:6px;">Add a note (optional):</label>
          <textarea id="mood-note" name="note" rows="3" maxlength="500" placeholder="What's on your mind..." style="width:100%;padding:12px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box;" aria-describedby="note-hint"></textarea>
          <p id="note-hint" style="font-size:12px;color:${COLORS.textMuted};margin-top:4px;">Your notes are private and only visible to you.</p>
        </div>
        <button type="submit" style="margin-top:16px;padding:12px 32px;background:${COLORS.primary};color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;font-weight:500;">Save Check-in</button>
      </form>`;
    }
    res.send(renderPage('Mood Check-in', pageShell('Daily Mood Check-in', html, 'mood'), req));
  }));

  app.post('/mental-health/mood-checkin', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    if (req.body.delete) {
      await pool.query(`DELETE FROM mood_checkins WHERE user_id=$1 AND tenant_id=$2 AND checkin_date=CURRENT_DATE`, [uid, t]);
      audit({ action: 'mood_checkin_deleted', userId: uid, tenantId: t });
      return res.redirect('/mental-health/mood-checkin');
    }
    const mood = parseInt(req.body.mood);
    const note = (req.body.note || '').trim().slice(0, 500);
    if (!mood || mood < 1 || mood > 5) return res.redirect('/mental-health/mood-checkin');
    await pool.query(
      `INSERT INTO mood_checkins (tenant_id, user_id, mood, note, checkin_date) VALUES ($1,$2,$3,$4,CURRENT_DATE) ON CONFLICT (tenant_id, user_id, checkin_date) DO UPDATE SET mood=$3, note=$4, created_at=NOW()`,
      [t, uid, mood, note || null]
    );
    audit({ action: 'mood_checkin', userId: uid, tenantId: t, detail: `mood=${mood}` });
    await checkCrisis(uid, t);
    res.redirect('/mental-health/mood-checkin');
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ROUTE 3: MOOD CALENDAR
  // ═══════════════════════════════════════════════════════════════════
  app.get('/mental-health/mood-calendar', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    const { rows: entries } = await pool.query(
      `SELECT mood, checkin_date as date FROM mood_checkins WHERE user_id=$1 AND tenant_id=$2 AND checkin_date >= CURRENT_DATE - INTERVAL '42 days' ORDER BY checkin_date`, [uid, t]
    );
    const calSvg = svgMoodCalendar(entries);
    const { rows: stats } = await pool.query(
      `SELECT mood, COUNT(*) as cnt FROM mood_checkins WHERE user_id=$1 AND tenant_id=$2 AND checkin_date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY mood ORDER BY mood`, [uid, t]
    );
    let legend = stats.map(s =>
      `<span style="display:inline-flex;align-items:center;gap:4px;margin:4px 8px;"><span style="width:14px;height:14px;border-radius:4px;background:${COLORS[`mood${s.mood}`]};display:inline-block;"></span> ${MOOD_EMOJI[s.mood]} ${s.cnt} days</span>`
    ).join('');
    let html = `
      <div style="overflow-x:auto;">${calSvg}</div>
      <div style="margin-top:16px;">${legend}</div>
    `;
    res.send(renderPage('Mood Calendar', pageShell('Mood Calendar', html, 'cal'), req));
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ROUTE 4: SLEEP TRACKER
  // ═══════════════════════════════════════════════════════════════════
  app.get('/mental-health/sleep-tracker', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    const today = new Date().toISOString().slice(0, 10);
    const { rows: todayLog } = await pool.query(
      `SELECT id, sleep_hours, quality, note FROM sleep_logs WHERE user_id=$1 AND tenant_id=$2 AND log_date=$3`, [uid, t, today]
    );
    const { rows: weekLogs } = await pool.query(
      `SELECT sleep_hours, log_date FROM sleep_logs WHERE user_id=$1 AND tenant_id=$2 AND log_date >= CURRENT_DATE - INTERVAL '13 days' ORDER BY log_date`, [uid, t]
    );
    const avgWeek = weekLogs.length ? (weekLogs.reduce((s, r) => s + parseFloat(r.sleep_hours), 0) / weekLogs.length).toFixed(1) : null;
    const barData = weekLogs.map(r => ({
      v: parseFloat(r.sleep_hours),
      l: r.log_date.slice(5)
    }));
    const chart = svgBarChart(barData, {
      title: 'Sleep Hours (Last 14 Days)', maxV: 12,
      colorFn: v => v >= 7 ? COLORS.sleepGood : v >= 6 ? COLORS.sleepWarn : COLORS.sleepBad
    });
    let formHtml = '';
    if (todayLog.length) {
      const e = todayLog[0];
      formHtml = `<div style="text-align:center;padding:16px;">
        <p style="font-size:18px;">Today: <strong style="color:${parseFloat(e.sleep_hours) >= 7 ? COLORS.sleepGood : COLORS.sleepBad};">${e.sleep_hours}h</strong></p>
        <p style="color:${COLORS.textMuted};">Quality: ${e.quality ? '⭐'.repeat(e.quality) : 'N/A'}</p>
        ${e.note ? `<p style="color:${COLORS.textMuted};margin-top:4px;">${esc(e.note)}</p>` : ''}
      </div>`;
    } else {
      formHtml = `<form method="POST" action="/mental-health/sleep-tracker" style="max-width:400px;margin:0 auto;" aria-label="Sleep log form">
        <label for="sleep-hours" style="display:block;font-size:14px;font-weight:500;margin-bottom:6px;">Hours of Sleep (0-12):</label>
        <input type="number" id="sleep-hours" name="sleep_hours" min="0" max="12" step="0.5" required style="width:100%;padding:12px;border:1px solid ${COLORS.border};border-radius:8px;font-size:16px;margin-bottom:12px;box-sizing:border-box;" aria-describedby="sleep-hint"/>
        <p id="sleep-hint" style="font-size:12px;color:${COLORS.textMuted};margin-bottom:12px;">Recommended: 7-9 hours for teens</p>
        <label for="sleep-quality" style="display:block;font-size:14px;font-weight:500;margin-bottom:6px;">Sleep Quality (1-5):</label>
        <select id="sleep-quality" name="quality" style="width:100%;padding:12px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;margin-bottom:12px;box-sizing:border-box;">
          <option value="">Select...</option>
          <option value="1">😫 Very Poor</option>
          <option value="2">😔 Poor</option>
          <option value="3">😐 Fair</option>
          <option value="4">😊 Good</option>
          <option value="5">😄 Excellent</option>
        </select>
        <label for="sleep-note" style="display:block;font-size:14px;font-weight:500;margin-bottom:6px;">Note (optional):</label>
        <textarea id="sleep-note" name="note" rows="2" maxlength="300" placeholder="Any sleep observations..." style="width:100%;padding:12px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box;margin-bottom:12px;"></textarea>
        <button type="submit" style="width:100%;padding:12px;background:#7c3aed;color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;font-weight:500;">Log Sleep</button>
      </form>`;
    }
    let warningBanner = '';
    if (avgWeek && parseFloat(avgWeek) < 6) {
      warningBanner = `<div style="background:#fef2f2;border:1px solid ${COLORS.redLight};border-radius:8px;padding:12px 16px;margin-bottom:16px;color:${COLORS.red};font-weight:500;">
        ⚠️ Your average sleep this week is ${avgWeek}h — below the recommended minimum. Consider adjusting your bedtime routine.
      </div>`;
    }
    let html = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Log Today's Sleep</h3>
          ${formHtml}
        </div>
        <div>
          <h3 style="font-size:16px;margin-bottom:12px;">Weekly Average</h3>
          <div style="text-align:center;padding:20px;background:#f8fafc;border-radius:12px;">
            <div style="font-size:48px;font-weight:700;color:${avgWeek && parseFloat(avgWeek) >= 7 ? COLORS.sleepGood : avgWeek && parseFloat(avgWeek) >= 6 ? COLORS.sleepWarn : COLORS.sleepBad};">${avgWeek || '—'}</div>
            <div style="color:${COLORS.textMuted};">hours / night (14-day avg)</div>
          </div>
          ${warningBanner}
        </div>
      </div>
      ${chart}
    `;
    res.send(renderPage('Sleep Tracker', pageShell('Sleep Tracker', html, 'sleep'), req));
  }));

  app.post('/mental-health/sleep-tracker', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    const hours = parseFloat(req.body.sleep_hours);
    const quality = req.body.quality ? parseInt(req.body.quality) : null;
    const note = (req.body.note || '').trim().slice(0, 300);
    if (isNaN(hours) || hours < 0 || hours > 12) return res.redirect('/mental-health/sleep-tracker');
    await pool.query(
      `INSERT INTO sleep_logs (tenant_id, user_id, sleep_hours, quality, note, log_date) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE) ON CONFLICT (tenant_id, user_id, log_date) DO UPDATE SET sleep_hours=$3, quality=$4, note=$5, created_at=NOW()`,
      [t, uid, hours, quality, note || null]
    );
    audit({ action: 'sleep_logged', userId: uid, tenantId: t, detail: `${hours}h` });
    res.redirect('/mental-health/sleep-tracker');
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ROUTE 5: GRATITUDE JOURNAL
  // ═══════════════════════════════════════════════════════════════════
  app.get('/mental-health/gratitude-journal', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    const today = new Date().toISOString().slice(0, 10);
    const { rows: todayEntry } = await pool.query(
      `SELECT id, entry1, entry2, entry3 FROM gratitude_entries WHERE user_id=$1 AND tenant_id=$2 AND entry_date=$3`, [uid, t, today]
    );
    const { rows: pastEntries } = await pool.query(
      `SELECT entry1, entry2, entry3, entry_date FROM gratitude_entries WHERE user_id=$1 AND tenant_id=$2 ORDER BY entry_date DESC LIMIT 14`, [uid, t]
    );
    let formHtml = '';
    if (todayEntry.length) {
      formHtml = `<div style="background:#f0fdf4;border:1px solid ${COLORS.green};border-radius:8px;padding:16px;margin-bottom:16px;">
        <p style="color:${COLORS.green};font-weight:500;">✅ Today's gratitude is complete! Come back tomorrow.</p>
      </div>`;
    } else {
      formHtml = `<form method="POST" action="/mental-health/gratitude-journal" style="margin-bottom:24px;" aria-label="Gratitude journal form">
        <h3 style="font-size:16px;margin-bottom:12px;">What are you grateful for today?</h3>
        <p style="color:${COLORS.textMuted};font-size:14px;margin-bottom:16px;">Writing about gratitude can boost your mood and overall well-being.</p>
        <div style="margin-bottom:12px;">
          <label for="grat1" style="display:block;font-size:14px;font-weight:500;margin-bottom:4px;">1️⃣ First thing:</label>
          <input type="text" id="grat1" name="entry1" required maxlength="300" placeholder="e.g., A good conversation with a friend" style="width:100%;padding:12px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;"/>
        </div>
        <div style="margin-bottom:12px;">
          <label for="grat2" style="display:block;font-size:14px;font-weight:500;margin-bottom:4px;">2️⃣ Second thing:</label>
          <input type="text" id="grat2" name="entry2" required maxlength="300" placeholder="e.g., The sunny weather today" style="width:100%;padding:12px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;"/>
        </div>
        <div style="margin-bottom:16px;">
          <label for="grat3" style="display:block;font-size:14px;font-weight:500;margin-bottom:4px;">3️⃣ Third thing:</label>
          <input type="text" id="grat3" name="entry3" required maxlength="300" placeholder="e.g., A delicious lunch" style="width:100%;padding:12px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;"/>
        </div>
        <button type="submit" style="padding:12px 32px;background:${COLORS.green};color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;font-weight:500;">Save Entry</button>
      </form>`;
    }
    let historyHtml = '';
    if (pastEntries.length) {
      historyHtml = `<h3 style="font-size:16px;margin-bottom:12px;">Past Entries</h3><div style="display:flex;flex-direction:column;gap:12px;">`;
      pastEntries.forEach(e => {
        historyHtml += `<div style="background:#f8fafc;border-radius:8px;padding:14px;border-left:4px solid ${COLORS.green};">
          <div style="font-size:12px;color:${COLORS.textMuted};margin-bottom:6px;">${esc(e.entry_date)}</div>
          <div style="font-size:14px;">🙏 ${esc(e.entry1)}</div>
          <div style="font-size:14px;">🙏 ${esc(e.entry2)}</div>
          <div style="font-size:14px;">🙏 ${esc(e.entry3)}</div>
        </div>`;
      });
      historyHtml += '</div>';
    }
    res.send(renderPage('Gratitude Journal', pageShell('Gratitude Journal', formHtml + historyHtml, 'grat'), req));
  }));

  app.post('/mental-health/gratitude-journal', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    const e1 = (req.body.entry1 || '').trim().slice(0, 300);
    const e2 = (req.body.entry2 || '').trim().slice(0, 300);
    const e3 = (req.body.entry3 || '').trim().slice(0, 300);
    if (!e1 || !e2 || !e3) return res.redirect('/mental-health/gratitude-journal');
    await pool.query(
      `INSERT INTO gratitude_entries (tenant_id, user_id, entry1, entry2, entry3, entry_date) VALUES ($1,$2,$3,$4,$5,CURRENT_DATE) ON CONFLICT (tenant_id, user_id, entry_date) DO UPDATE SET entry1=$3, entry2=$4, entry3=$5`,
      [t, uid, e1, e2, e3]
    );
    audit({ action: 'gratitude_entry', userId: uid, tenantId: t });
    res.redirect('/mental-health/gratitude-journal');
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ROUTE 6: WELLNESS RESOURCES (Public browse + Admin CRUD)
  // ═══════════════════════════════════════════════════════════════════
  app.get('/mental-health/wellness-resources', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const catFilter = req.query.category || '';
    const isAdmin = ['admin', 'superadmin'].includes((req.session.user.role || '').toLowerCase());
    let q = `SELECT * FROM wellness_resources WHERE tenant_id=$1 AND is_active=true`;
    const params = [t];
    if (catFilter) { q += ` AND category=$2`; params.push(catFilter); }
    q += ` ORDER BY created_at DESC LIMIT 50`;
    const { rows: resources } = await pool.query(q, params);
    const catBtns = RESOURCE_CATS.map(c =>
      `<a href="/mental-health/wellness-resources?category=${encodeURIComponent(c)}" style="display:inline-block;padding:6px 14px;margin:3px;border-radius:20px;text-decoration:none;font-size:13px;${catFilter === c ? 'background:' + COLORS.primary + ';color:#fff;' : 'background:#f1f5f9;color:' + COLORS.text + ';'}">${esc(c.charAt(0).toUpperCase() + c.slice(1))}</a>`
    ).join('');
    let listHtml = '';
    if (resources.length) {
      listHtml = resources.map(r => {
        const typeIcon = r.content_type === 'video' ? '🎬' : r.content_type === 'exercise' ? '💪' : '📖';
        return `<div style="border:1px solid ${COLORS.border};border-radius:10px;padding:16px;margin-bottom:12px;">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <span style="font-size:11px;background:#f1f5f9;padding:2px 8px;border-radius:10px;color:${COLORS.textMuted};">${typeIcon} ${esc(r.content_type)}</span>
              <span style="font-size:11px;background:#ede9fe;padding:2px 8px;border-radius:10px;color:${COLORS.primaryLight};margin-left:4px;">${esc(r.category)}</span>
            </div>
          </div>
          <h3 style="font-size:16px;margin:8px 0 4px;">${esc(r.title)}</h3>
          <p style="color:${COLORS.textMuted};font-size:13px;margin-bottom:8px;">${esc((r.description || '').slice(0, 200))}</p>
          ${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener" style="color:${COLORS.primary};font-size:13px;">View Resource →</a>` : ''}
          ${r.body ? `<p style="color:${COLORS.text};font-size:13px;margin-top:8px;line-height:1.5;">${esc(r.body.slice(0, 500))}${r.body.length > 500 ? '...' : ''}</p>` : ''}
        </div>`;
      }).join('');
    } else {
      listHtml = `<p style="color:${COLORS.textMuted};text-align:center;padding:40px;">No resources found in this category.</p>`;
    }
    let adminSection = '';
    if (isAdmin) {
      adminSection = `<div style="margin-top:24px;border-top:1px solid ${COLORS.border};padding-top:20px;">
        <h3 style="font-size:16px;margin-bottom:12px;">🔧 Admin: Add Resource</h3>
        <form method="POST" action="/mental-health/wellness-resources" style="max-width:500px;" aria-label="Add wellness resource">
          <div style="margin-bottom:10px;">
            <label for="wr-title" style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">Title *</label>
            <input type="text" id="wr-title" name="title" required maxlength="300" style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;"/>
          </div>
          <div style="margin-bottom:10px;">
            <label for="wr-desc" style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">Description</label>
            <textarea id="wr-desc" name="description" rows="2" maxlength="500" style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;"></textarea>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px;">
            <div>
              <label for="wr-cat" style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">Category *</label>
              <select id="wr-cat" name="category" required style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;">
                ${RESOURCE_CATS.map(c => `<option value="${c}">${c.charAt(0).toUpperCase() + c.slice(1)}</option>`).join('')}
              </select>
            </div>
            <div>
              <label for="wr-type" style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">Type</label>
              <select id="wr-type" name="content_type" style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;">
                <option value="article">Article</option>
                <option value="video">Video</option>
                <option value="exercise">Exercise</option>
              </select>
            </div>
          </div>
          <div style="margin-bottom:10px;">
            <label for="wr-url" style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">URL</label>
            <input type="url" id="wr-url" name="url" placeholder="https://..." style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;"/>
          </div>
          <div style="margin-bottom:12px;">
            <label for="wr-body" style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">Body Content</label>
            <textarea id="wr-body" name="body" rows="4" style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;"></textarea>
          </div>
          <button type="submit" style="padding:10px 24px;background:${COLORS.primary};color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:500;">Add Resource</button>
        </form>
      </div>`;
    }
    let html = `<div style="margin-bottom:20px;"><h3 style="font-size:16px;margin-bottom:10px;">Categories</h3>${catBtns}
      ${catFilter ? `<a href="/mental-health/wellness-resources" style="display:inline-block;padding:6px 14px;margin:3px;border-radius:20px;text-decoration:none;font-size:13px;background:${COLORS.red};color:#fff;">Clear Filter</a>` : ''}
    </div>${listHtml}${adminSection}`;
    res.send(renderPage('Wellness Resources', pageShell('Wellness Resources', html, 'res'), req));
  }));

  app.post('/mental-health/wellness-resources', requireAuth, requireAdmin, ah(async (req, res) => {
    const t = tid(req);
    const title = (req.body.title || '').trim().slice(0, 300);
    const description = (req.body.description || '').trim().slice(0, 500);
    const category = (req.body.category || '').trim();
    const content_type = (req.body.content_type || 'article').trim().slice(0, 50);
    const url = (req.body.url || '').trim().slice(0, 500);
    const body = (req.body.body || '').trim();
    if (!title || !RESOURCE_CATS.includes(category)) return res.redirect('/mental-health/wellness-resources');
    await pool.query(
      `INSERT INTO wellness_resources (tenant_id, title, description, category, content_type, url, body, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
      [t, title, description || null, category, content_type, url || null, body || null, req.session.user.id]
    );
    audit({ action: 'wellness_resource_created', userId: req.session.user.id, tenantId: t, detail: title });
    res.redirect('/mental-health/wellness-resources');
  }));

  app.post('/mental-health/wellness-resources/:id/delete', requireAuth, requireAdmin, ah(async (req, res) => {
    const t = tid(req);
    await pool.query(`DELETE FROM wellness_resources WHERE id=$1 AND tenant_id=$2`, [parseInt(req.params.id), t]);
    audit({ action: 'wellness_resource_deleted', userId: req.session.user.id, tenantId: t, detail: req.params.id });
    res.redirect('/mental-health/wellness-resources');
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ROUTE 7: COUNSELLOR BOOKING
  // ═══════════════════════════════════════════════════════════════════
  const TIME_SLOTS = ['08:00', '08:30', '09:00', '09:30', '10:00', '10:30', '11:00', '11:30', '13:00', '13:30', '14:00', '14:30', '15:00', '15:30'];

  app.get('/mental-health/counsellor-booking', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    const { rows: counsellors } = await pool.query(
      `SELECT id, name FROM users WHERE tenant_id=$1 AND (role='counsellor' OR role='admin') ORDER BY name`, [t]
    );
    const { rows: myBookings } = await pool.query(
      `SELECT cb.*, u.name as counsellor_name FROM counsellor_bookings cb JOIN users u ON u.id=cb.counsellor_id WHERE cb.student_id=$1 AND cb.tenant_id=$2 AND cb.booking_date >= CURRENT_DATE ORDER BY cb.booking_date, cb.time_slot`, [uid, t]
    );
    let counsellorSelect = counsellors.length
      ? counsellors.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('')
      : '<option value="">No counsellors available</option>';
    let statusColors = { pending: COLORS.orange, confirmed: COLORS.green, cancelled: COLORS.red, completed: COLORS.primary };
    let bookingsHtml = '';
    if (myBookings.length) {
      bookingsHtml = `<h3 style="font-size:16px;margin-bottom:12px;">My Upcoming Sessions</h3><div style="display:flex;flex-direction:column;gap:8px;">`;
      myBookings.forEach(b => {
        const sc = statusColors[b.status] || COLORS.textMuted;
        bookingsHtml += `<div style="display:flex;justify-content:space-between;align-items:center;padding:12px;border:1px solid ${COLORS.border};border-radius:8px;">
          <div>
            <strong>${esc(b.counsellor_name)}</strong> — ${esc(b.booking_date)} at ${esc(b.time_slot)}
            ${b.notes ? `<br/><span style="color:${COLORS.textMuted};font-size:13px;">${esc(b.notes)}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:8px;">
            <span style="background:${sc};color:#fff;padding:4px 10px;border-radius:12px;font-size:12px;">${esc(b.status)}</span>
            ${b.status === 'pending' ? `<form method="POST" action="/mental-health/counsellor-booking/${b.id}/cancel" style="display:inline;"><button type="submit" style="padding:4px 12px;background:${COLORS.red};color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Cancel</button></form>` : ''}
          </div>
        </div>`;
      });
      bookingsHtml += '</div>';
    }
    let html = `<div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;">
      <div>
        <h3 style="font-size:16px;margin-bottom:12px;">Book a Session</h3>
        <form method="POST" action="/mental-health/counsellor-booking" aria-label="Book counsellor session">
          <div style="margin-bottom:10px;">
            <label for="cb-counsellor" style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">Counsellor *</label>
            <select id="cb-counsellor" name="counsellor_id" required ${counsellors.length ? '' : 'disabled'} style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;">${counsellorSelect}</select>
          </div>
          <div style="margin-bottom:10px;">
            <label for="cb-date" style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">Date *</label>
            <input type="date" id="cb-date" name="booking_date" required min="${new Date().toISOString().slice(0, 10)}" style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;"/>
          </div>
          <div style="margin-bottom:10px;">
            <label for="cb-slot" style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">Time Slot *</label>
            <select id="cb-slot" name="time_slot" required style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;">
              ${TIME_SLOTS.map(s => `<option value="${s}">${s}</option>`).join('')}
            </select>
          </div>
          <div style="margin-bottom:12px;">
            <label for="cb-notes" style="display:block;font-size:13px;font-weight:500;margin-bottom:4px;">Notes (optional)</label>
            <textarea id="cb-notes" name="notes" rows="3" maxlength="500" placeholder="Briefly describe what you'd like to discuss..." style="width:100%;padding:10px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;"></textarea>
          </div>
          <button type="submit" style="padding:12px 24px;background:${COLORS.primary};color:#fff;border:none;border-radius:8px;cursor:pointer;font-weight:500;">Book Session</button>
        </form>
      </div>
      <div>${bookingsHtml || '<p style="color:' + COLORS.textMuted + ';text-align:center;padding:40px;">No upcoming sessions.</p>'}</div>
    </div>`;
    res.send(renderPage('Counsellor Booking', pageShell('Book a Counsellor Session', html, 'book'), req));
  }));

  app.post('/mental-health/counsellor-booking', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    const counsellorId = parseInt(req.body.counsellor_id);
    const bookingDate = req.body.booking_date;
    const timeSlot = req.body.time_slot;
    const notes = (req.body.notes || '').trim().slice(0, 500);
    if (!counsellorId || !bookingDate || !timeSlot) return res.redirect('/mental-health/counsellor-booking');
    const { rows: conflict } = await pool.query(
      `SELECT id FROM counsellor_bookings WHERE tenant_id=$1 AND counsellor_id=$2 AND booking_date=$3 AND time_slot=$4 AND status != 'cancelled'`,
      [t, counsellorId, bookingDate, timeSlot]
    );
    if (conflict.length) return res.send(renderPage('Booking Conflict', pageShell('Slot Unavailable', '<p style="color:' + COLORS.red + ';">This time slot is already booked. Please choose another.</p><a href="/mental-health/counsellor-booking" style="color:' + COLORS.primary + ';">← Back</a>', 'book'), req));
    await pool.query(
      `INSERT INTO counsellor_bookings (tenant_id, student_id, counsellor_id, booking_date, time_slot, notes) VALUES ($1,$2,$3,$4,$5,$6)`,
      [t, uid, counsellorId, bookingDate, timeSlot, notes || null]
    );
    const { rows: counsellor } = await pool.query(`SELECT email, name FROM users WHERE id=$1`, [counsellorId]);
    if (counsellor.length) {
      queueEmail({
        to: counsellor[0].email,
        subject: 'New Counselling Session Booked',
        body: `A student has booked a session with you on ${bookingDate} at ${timeSlot}.${notes ? ' Notes: ' + notes : ''}`
      });
    }
    queueEmail({
      to: req.session.user.email,
      subject: 'Counselling Session Confirmed',
      body: `Your counselling session has been booked for ${bookingDate} at ${timeSlot} with ${counsellor.length ? counsellor[0].name : 'a counsellor'}.`
    });
    audit({ action: 'counsellor_booking', userId: uid, tenantId: t, detail: `${bookingDate} ${timeSlot}` });
    res.redirect('/mental-health/counsellor-booking');
  }));

  app.post('/mental-health/counsellor-booking/:id/cancel', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    await pool.query(
      `UPDATE counsellor_bookings SET status='cancelled', updated_at=NOW() WHERE id=$1 AND tenant_id=$2 AND student_id=$3`,
      [parseInt(req.params.id), t, uid]
    );
    res.redirect('/mental-health/counsellor-booking');
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ROUTE 8: ANONYMOUS REPORTING
  // ═══════════════════════════════════════════════════════════════════
  app.get('/mental-health/anonymous-report', requireAuth, ah(async (req, res) => {
    const html = `<div style="max-width:550px;margin:0 auto;">
      <div style="background:#fefce8;border:1px solid #fde047;border-radius:8px;padding:14px;margin-bottom:20px;">
        <p style="color:#854d0e;font-size:14px;">🔒 <strong>Your identity is completely anonymous.</strong> No name, email, or account information is stored with your report. Reports go directly to the school counsellor.</p>
      </div>
      <form method="POST" action="/mental-health/anonymous-report" aria-label="Anonymous concern report">
        <div style="margin-bottom:14px;">
          <label for="ar-type" style="display:block;font-size:14px;font-weight:500;margin-bottom:6px;">What type of concern? *</label>
          <select id="ar-type" name="report_type" required style="width:100%;padding:12px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;box-sizing:border-box;">
            <option value="">Select a category...</option>
            ${REPORT_TYPES.map(t => `<option value="${t}">${t.charAt(0).toUpperCase() + t.slice(1)}</option>`).join('')}
          </select>
        </div>
        <div style="margin-bottom:14px;">
          <label for="ar-desc" style="display:block;font-size:14px;font-weight:500;margin-bottom:6px;">Please describe the situation *</label>
          <textarea id="ar-desc" name="description" required rows="5" maxlength="2000" placeholder="Share what's happening so we can help..." style="width:100%;padding:12px;border:1px solid ${COLORS.border};border-radius:8px;font-size:14px;resize:vertical;box-sizing:border-box;"></textarea>
          <p style="font-size:12px;color:${COLORS.textMuted};margin-top:4px;">Be as specific as possible so the counsellor can respond appropriately.</p>
        </div>
        <div style="margin-bottom:16px;">
          <label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer;">
            <input type="checkbox" name="is_crisis" value="1" style="width:18px;height:18px;"/>
            <span>🚨 This is an urgent crisis requiring immediate attention</span>
          </label>
        </div>
        <button type="submit" style="width:100%;padding:14px;background:${COLORS.primary};color:#fff;border:none;border-radius:8px;font-size:16px;cursor:pointer;font-weight:500;">Submit Report Anonymously</button>
      </form>
      <div style="margin-top:20px;text-align:center;">
        <p style="color:${COLORS.textMuted};font-size:13px;">If you are in immediate danger, please contact emergency services.</p>
        <p style="font-size:13px;margin-top:4px;">Need to talk now? <a href="/mental-health/counsellor-booking" style="color:${COLORS.primary};font-weight:500;">Book a session</a></p>
      </div>
    </div>`;
    res.send(renderPage('Anonymous Report', pageShell('Anonymous Reporting', html, 'anon'), req));
  }));

  app.post('/mental-health/anonymous-report', requireAuth, ah(async (req, res) => {
    const t = tid(req);
    const reportType = (req.body.report_type || '').trim();
    const description = (req.body.description || '').trim().slice(0, 2000);
    const isCrisis = req.body.is_crisis === '1';
    if (!reportType || !REPORT_TYPES.includes(reportType) || !description) {
      return res.redirect('/mental-health/anonymous-report');
    }
    await pool.query(
      `INSERT INTO anonymous_reports (tenant_id, report_type, description, is_crisis) VALUES ($1,$2,$3,$4)`,
      [t, reportType, description, isCrisis]
    );
    if (isCrisis) {
      const { rows: counsellors } = await pool.query(
        `SELECT email FROM users WHERE tenant_id=$1 AND (role='counsellor' OR role='admin') LIMIT 5`, [t]
      );
      counsellors.forEach(c => {
        queueEmail({
          to: c.email,
          subject: '🚨 URGENT: Anonymous Crisis Report',
          body: `An anonymous crisis report has been submitted.\n\nType: ${reportType}\n\nDescription: ${description}\n\nPlease check the counsellor dashboard immediately.`
        });
      });
      audit({ action: 'anonymous_crisis_report', tenantId: t, detail: reportType });
    } else {
      const { rows: counsellors } = await pool.query(
        `SELECT email FROM users WHERE tenant_id=$1 AND (role='counsellor' OR role='admin') LIMIT 5`, [t]
      );
      counsellors.forEach(c => {
        queueEmail({
          to: c.email,
          subject: 'New Anonymous Report Submitted',
          body: `An anonymous report has been submitted.\n\nType: ${reportType}\n\nPlease check the counsellor dashboard.`
        });
      });
      audit({ action: 'anonymous_report', tenantId: t, detail: reportType });
    }
    const thankHtml = `<div style="text-align:center;padding:40px;">
      <div style="font-size:48px;margin-bottom:16px;">💚</div>
      <h2 style="color:${COLORS.green};margin-bottom:8px;">Report Submitted</h2>
      <p style="color:${COLORS.textMuted};max-width:400px;margin:0 auto;">Thank you for reaching out. Your report has been sent anonymously to the school counsellor who will look into this. You are not alone.</p>
      ${isCrisis ? '<p style="color:' + COLORS.red + ';font-weight:500;margin-top:12px;">This has been flagged as urgent and the counsellor has been notified immediately.</p>' : ''}
      <a href="/mental-health" style="display:inline-block;margin-top:20px;padding:10px 24px;background:' + COLORS.primary + ';color:#fff;border-radius:8px;text-decoration:none;">Back to Dashboard</a>
    </div>`;
    res.send(renderPage('Report Submitted', pageShell('Report Submitted', thankHtml, 'anon'), req));
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ROUTE 9: COUNSELLOR DASHBOARD
  // ═══════════════════════════════════════════════════════════════════
  app.get('/mental-health/counsellor-dashboard', requireCounsellor, ah(async (req, res) => {
    const t = tid(req);
    const cid = req.session.user.id;
    const { rows: crisisAlerts } = await pool.query(
      `SELECT ca.*, u.name as student_name, u.email FROM crisis_alerts ca JOIN users u ON u.id=ca.user_id WHERE ca.tenant_id=$1 AND ca.is_resolved=false ORDER BY ca.created_at DESC`, [t]
    );
    const { rows: anonReports } = await pool.query(
      `SELECT * FROM anonymous_reports WHERE tenant_id=$1 AND is_resolved=false ORDER BY created_at DESC LIMIT 20`, [t]
    );
    const { rows: upcomingBookings } = await pool.query(
      `SELECT cb.*, u.name as student_name, u.email FROM counsellor_bookings cb JOIN users u ON u.id=cb.student_id WHERE cb.tenant_id=$1 AND cb.counsellor_id=$2 AND cb.booking_date >= CURRENT_DATE AND cb.status != 'cancelled' ORDER BY cb.booking_date, cb.time_slot`, [t, cid]
    );
    const { rows: moodDistribution } = await pool.query(
      `SELECT mood, COUNT(*) as cnt FROM mood_checkins WHERE tenant_id=$1 AND checkin_date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY mood ORDER BY mood`, [t]
    );
    const { rows: recentMoods } = await pool.query(
      `SELECT AVG(mood) as avg_mood, checkin_date FROM mood_checkins WHERE tenant_id=$1 AND checkin_date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY checkin_date ORDER BY checkin_date`, [t]
    );
    const { rows: lowMoodStudents } = await pool.query(
      `SELECT DISTINCT u.id, u.name, mc.mood, mc.checkin_date FROM users u JOIN mood_checkins mc ON mc.user_id=u.id WHERE mc.tenant_id=$1 AND mc.mood <= 2 AND mc.checkin_date >= CURRENT_DATE - INTERVAL '7 days' ORDER BY mc.checkin_date DESC LIMIT 20`, [t]
    );
    // Charts
    const avgMoodChart = svgLineChart(recentMoods.map(r => ({ v: parseFloat(r.avg_mood.toFixed(1)), l: r.checkin_date.slice(5) })), {
      title: 'School Average Mood (30 Days)', minV: 1, maxV: 5, color: COLORS.calming
    });
    const moodDistChart = svgBarChart(moodDistribution.map(r => ({ v: parseInt(r.cnt), l: MOOD_EMOJI[r.mood] + ' ' + MOOD_LABEL[r.mood] })), {
      title: 'Mood Distribution (30 Days)', colorFn: v => COLORS.textMuted
    });
    // Crisis banner
    let crisisBanner = '';
    if (crisisAlerts.length || anonReports.filter(r => r.is_crisis).length) {
      crisisBanner = `<div style="background:#fef2f2;border:2px solid ${COLORS.red};border-radius:12px;padding:16px 20px;margin-bottom:24px;">
        <h3 style="color:${COLORS.red};margin:0 0 8px;">🚨 CRISIS ALERTS (${crisisAlerts.length + anonReports.filter(r => r.is_crisis).length} active)</h3>
        <p style="color:${COLORS.red};font-size:14px;margin:0;">Immediate attention required. Students or reports have been flagged.</p>
      </div>`;
    }
    // Crisis alerts list
    let crisisHtml = '';
    if (crisisAlerts.length) {
      crisisHtml = `<h3 style="font-size:16px;color:${COLORS.red};margin-bottom:10px;">⚠️ Flagged Students</h3>`;
      crisisAlerts.forEach(ca => {
        crisisHtml += `<div style="border:1px solid ${COLORS.redLight};border-left:4px solid ${COLORS.red};border-radius:8px;padding:12px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <strong>${esc(ca.student_name)}</strong> <span style="color:${COLORS.textMuted};font-size:13px;">(${esc(ca.student_name)} - ID: ${ca.user_id})</span>
              <p style="color:${COLORS.text};font-size:13px;margin:4px 0;">${esc(ca.reason)}</p>
              <p style="color:${COLORS.textMuted};font-size:12px;">Flagged: ${ca.created_at}</p>
            </div>
            <form method="POST" action="/mental-health/counsellor-dashboard/crisis/${ca.id}/resolve">
              <button type="submit" style="padding:6px 14px;background:${COLORS.green};color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Resolve</button>
            </form>
          </div>
        </div>`;
      });
    }
    // Anonymous reports list
    let anonHtml = '';
    if (anonReports.length) {
      anonHtml = `<h3 style="font-size:16px;margin-bottom:10px;margin-top:20px;">🔒 Anonymous Reports</h3>`;
      anonReports.forEach(ar => {
        const typeColor = ar.is_crisis ? COLORS.red : COLORS.textMuted;
        anonHtml += `<div style="border:1px solid ${COLORS.border};border-left:4px solid ${ar.is_crisis ? COLORS.red : COLORS.primary};border-radius:8px;padding:12px;margin-bottom:8px;">
          <div style="display:flex;justify-content:space-between;align-items:start;">
            <div>
              <span style="font-size:12px;background:${ar.is_crisis ? '#fef2f2' : '#f1f5f9'};padding:2px 8px;border-radius:10px;color:${typeColor};">${ar.is_crisis ? '🚨 CRISIS' : 'Report'}</span>
              <span style="font-size:12px;color:${COLORS.textMuted};margin-left:4px;">${esc(ar.report_type)}</span>
              <p style="color:${COLORS.text};font-size:14px;margin:6px 0;">${esc(ar.description)}</p>
              <p style="color:${COLORS.textMuted};font-size:12px;">Submitted: ${ar.created_at}</p>
            </div>
            <form method="POST" action="/mental-health/counsellor-dashboard/report/${ar.id}/resolve">
              <button type="submit" style="padding:6px 14px;background:${COLORS.green};color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Resolve</button>
            </form>
          </div>
        </div>`;
      });
    }
    // Upcoming bookings
    let bookingsHtml = '';
    if (upcomingBookings.length) {
      bookingsHtml = `<h3 style="font-size:16px;margin-bottom:10px;margin-top:20px;">📅 Upcoming Sessions</h3>`;
      upcomingBookings.forEach(b => {
        const sc = b.status === 'confirmed' ? COLORS.green : COLORS.orange;
        bookingsHtml += `<div style="border:1px solid ${COLORS.border};border-radius:8px;padding:12px;margin-bottom:8px;display:flex;justify-content:space-between;align-items:center;">
          <div>
            <strong>${esc(b.student_name)}</strong> — ${esc(b.booking_date)} at ${esc(b.time_slot)}
            ${b.notes ? `<br/><span style="color:${COLORS.textMuted};font-size:13px;">${esc(b.notes)}</span>` : ''}
          </div>
          <div style="display:flex;align-items:center;gap:6px;">
            <span style="background:${sc};color:#fff;padding:4px 10px;border-radius:12px;font-size:12px;">${esc(b.status)}</span>
            ${b.status === 'pending' ? `<form method="POST" action="/mental-health/counsellor-dashboard/booking/${b.id}/confirm" style="display:inline;"><button type="submit" style="padding:4px 12px;background:${COLORS.green};color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:12px;">Confirm</button></form>` : ''}
          </div>
        </div>`;
      });
    }
    // Low mood students
    let lowMoodHtml = '';
    if (lowMoodStudents.length) {
      lowMoodHtml = `<h3 style="font-size:16px;margin-bottom:10px;margin-top:20px;">😊 Students with Low Mood (7 days)</h3><div style="display:flex;flex-wrap:wrap;gap:8px;">`;
      lowMoodStudents.forEach(s => {
        lowMoodHtml += `<div style="background:#fef2f2;border-radius:8px;padding:10px 14px;font-size:13px;">${MOOD_EMOJI[s.mood]} <strong>${esc(s.name)}</strong> <span style="color:${COLORS.textMuted};">(${s.checkin_date})</span></div>`;
      });
      lowMoodHtml += '</div>';
    }
    let html = `
      ${crisisBanner}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:24px;">
        <div style="overflow-x:auto;">${avgMoodChart}</div>
        <div style="overflow-x:auto;">${moodDistChart}</div>
      </div>
      ${crisisHtml}
      ${lowMoodHtml}
      ${anonHtml}
      ${bookingsHtml}
      ${!crisisHtml && !anonHtml && !bookingsHtml && !lowMoodHtml ? '<p style="text-align:center;color:' + COLORS.textMuted + ';padding:40px;">All clear! No pending alerts or reports.</p>' : ''}
    `;
    res.send(renderPage('Counsellor Dashboard', pageShell('Counsellor Dashboard', html, 'dash'), req));
  }));

  app.post('/mental-health/counsellor-dashboard/crisis/:id/resolve', requireCounsellor, ah(async (req, res) => {
    const t = tid(req);
    await pool.query(`UPDATE crisis_alerts SET is_resolved=true, resolved_at=NOW() WHERE id=$1 AND tenant_id=$2`, [parseInt(req.params.id), t]);
    audit({ action: 'crisis_resolved', userId: req.session.user.id, tenantId: t, detail: req.params.id });
    res.redirect('/mental-health/counsellor-dashboard');
  }));

  app.post('/mental-health/counsellor-dashboard/report/:id/resolve', requireCounsellor, ah(async (req, res) => {
    const t = tid(req);
    await pool.query(`UPDATE anonymous_reports SET is_resolved=true, resolved_at=NOW(), counsellor_notes=$3 WHERE id=$1 AND tenant_id=$2`,
      [parseInt(req.params.id), t, (req.body.notes || '').trim().slice(0, 500) || null]);
    audit({ action: 'anon_report_resolved', userId: req.session.user.id, tenantId: t, detail: req.params.id });
    res.redirect('/mental-health/counsellor-dashboard');
  }));

  app.post('/mental-health/counsellor-dashboard/booking/:id/confirm', requireCounsellor, ah(async (req, res) => {
    const t = tid(req);
    await pool.query(`UPDATE counsellor_bookings SET status='confirmed', updated_at=NOW() WHERE id=$1 AND tenant_id=$2`, [parseInt(req.params.id), t]);
    res.redirect('/mental-health/counsellor-dashboard');
  }));

  // ═══════════════════════════════════════════════════════════════════
  // ROUTE 10: BREATHING EXERCISE
  // ═══════════════════════════════════════════════════════════════════
  app.get('/mental-health/breathing-exercise', requireAuth, ah(async (req, res) => {
    const html = `
      <div style="max-width:500px;margin:0 auto;text-align:center;">
        <div style="background:linear-gradient(135deg,#ede9fe,#e0e7ff);border-radius:16px;padding:24px;margin-bottom:20px;">
          <h2 style="color:${COLORS.calming};margin:0 0 8px;">🫁 4-7-8 Breathing Exercise</h2>
          <p style="color:${COLORS.textMuted};font-size:14px;margin:0;">A simple yet powerful technique to reduce anxiety and promote calm. Used by Navy SEALs and recommended by therapists worldwide.</p>
        </div>
        <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-bottom:20px;">
          <h3 style="font-size:15px;margin-bottom:10px;">How it works:</h3>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:12px;text-align:center;">
            <div style="padding:12px;background:#dbeafe;border-radius:10px;">
              <div style="font-size:24px;">🫁</div>
              <div style="font-weight:600;color:${COLORS.primary};">Inhale</div>
              <div style="font-size:20px;color:${COLORS.primary};">4 sec</div>
            </div>
            <div style="padding:12px;background:#fef3c7;border-radius:10px;">
              <div style="font-size:24px;">⏸️</div>
              <div style="font-weight:600;color:${COLORS.orange};">Hold</div>
              <div style="font-size:20px;color:${COLORS.orange};">7 sec</div>
            </div>
            <div style="padding:12px;background:#d1fae5;border-radius:10px;">
              <div style="font-size:24px;">💨</div>
              <div style="font-weight:600;color:${COLORS.green};">Exhale</div>
              <div style="font-size:20px;color:${COLORS.green};">8 sec</div>
            </div>
          </div>
        </div>
        ${breathingSvg()}
      </div>
    `;
    res.send(renderPage('Breathing Exercise', pageShell('Breathing Exercise', html, 'breath'), req));
  }));

  // ═══════════════════════════════════════════════════════════════════
  // API ENDPOINTS — Mood history JSON for dashboards
  // ═══════════════════════════════════════════════════════════════════
  app.get('/api/mental-health/mood-history', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    const days = Math.min(parseInt(req.query.days) || 30, 365);
    const { rows } = await pool.query(
      `SELECT mood, note, checkin_date FROM mood_checkins WHERE user_id=$1 AND tenant_id=$2 AND checkin_date >= CURRENT_DATE - INTERVAL '1 day' * $3 ORDER BY checkin_date`,
      [uid, t, days]
    );
    res.json(rows);
  }));

  app.get('/api/mental-health/sleep-history', requireAuth, ah(async (req, res) => {
    const uid = req.session.user.id;
    const t = tid(req);
    const { rows } = await pool.query(
      `SELECT sleep_hours, quality, log_date FROM sleep_logs WHERE user_id=$1 AND tenant_id=$2 AND log_date >= CURRENT_DATE - INTERVAL '30 days' ORDER BY log_date`,
      [uid, t]
    );
    res.json(rows);
  }));

  app.get('/api/mental-health/stats', requireCounsellor, ah(async (req, res) => {
    const t = tid(req);
    const { rows: totalStudents } = await pool.query(
      `SELECT COUNT(DISTINCT user_id) as cnt FROM mood_checkins WHERE tenant_id=$1 AND checkin_date >= CURRENT_DATE - INTERVAL '7 days'`, [t]
    );
    const { rows: avgMood } = await pool.query(
      `SELECT ROUND(AVG(mood)::numeric, 2) as avg FROM mood_checkins WHERE tenant_id=$1 AND checkin_date >= CURRENT_DATE - INTERVAL '7 days'`, [t]
    );
    const { rows: activeCrisis } = await pool.query(
      `SELECT COUNT(*) as cnt FROM crisis_alerts WHERE tenant_id=$1 AND is_resolved=false`, [t]
    );
    const { rows: pendingReports } = await pool.query(
      `SELECT COUNT(*) as cnt FROM anonymous_reports WHERE tenant_id=$1 AND is_resolved=false`, [t]
    );
    const { rows: upcomingSessions } = await pool.query(
      `SELECT COUNT(*) as cnt FROM counsellor_bookings WHERE tenant_id=$1 AND booking_date >= CURRENT_DATE AND status != 'cancelled'`, [t]
    );
    res.json({
      activeStudentsThisWeek: parseInt(totalStudents[0]?.cnt || 0),
      avgMoodThisWeek: parseFloat(avgMood[0]?.avg || 0),
      activeCrisisAlerts: parseInt(activeCrisis[0]?.cnt || 0),
      pendingReports: parseInt(pendingReports[0]?.cnt || 0),
      upcomingSessions: parseInt(upcomingSessions[0]?.cnt || 0)
    });
  }));

  // ═══════════════════════════════════════════════════════════════════
  // DAILY MOOD REMINDER (called by scheduler)
  // ═══════════════════════════════════════════════════════════════════
  app._mhSendReminders = async function (tenantId) {
    const today = new Date().toISOString().slice(0, 10);
    const { rows: students } = await pool.query(
      `SELECT DISTINCT mc.user_id FROM (
        SELECT user_id FROM mood_checkins WHERE tenant_id=$1 AND checkin_date=$2
      ) mc RIGHT JOIN (
        SELECT id FROM users WHERE tenant_id=$1 AND role='student' AND status='active'
      ) u ON u.id=mc.user_id WHERE mc.user_id IS NULL LIMIT 200`,
      [tenantId, today]
    );
    const { rows: studentDetails } = await pool.query(
      `SELECT id, email, name FROM users WHERE tenant_id=$1 AND role='student' AND status='active' AND id = ANY($2)`,
      [tenantId, students.map(s => s.user_id)]
    );
    studentDetails.forEach(s => {
      queueEmail({
        to: s.email,
        subject: '😊 Daily Check-in Reminder',
        body: `Hi ${s.name},\n\nDon't forget to log your mood today! Taking a moment to check in with yourself is a great habit.\n\nVisit: /mental-health/mood-checkin\n\nTake care of yourself! 💚`
      });
    });
    audit({ action: 'mood_reminders_sent', tenantId, detail: `${studentDetails.length} reminders` });
    return studentDetails.length;
  };
};
