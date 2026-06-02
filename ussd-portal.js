'use strict';
/**
 * USSD Portal Module — Multi-Tenant SaaS Platform (Uganda)
 * Allows parents/students to access platform features via basic feature phones using *XXX# codes.
 * 10 routes: USSD webhook, admin dashboard, menu config (GET/POST), sessions, analytics,
 *            tester (GET/POST), logs, help/integration guide.
 */
const { migrateQuery } = require('./db');
module.exports = function ussdPortal(app, db, pool, renderPage, esc) {

  const requireAuth = (req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  // ═══════════════════════════════════════════════════════
  //  CONSTANTS
  // ═══════════════════════════════════════════════════════
  const SESSION_TTL = 2 * 60 * 1000; // 2 minutes
  const PS = 20; // page size
  const LANG_EN = 'en', LANG_LG = 'lg';

  // ═══════════════════════════════════════════════════════
  //  MIGRATIONS (async IIFE at module load)
  // ═══════════════════════════════════════════════════════
  (async () => {
    if (!pool) return;
    try {
      await migrateQuery(pool, 'UssdPortal', `CREATE TABLE IF NOT EXISTS ussd_sessions (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        phone_number VARCHAR(20) NOT NULL,
        session_id VARCHAR(100) UNIQUE NOT NULL,
        current_step VARCHAR(50) DEFAULT 'home',
        student_admission_no VARCHAR(100),
        student_id INTEGER,
        menu_history TEXT[] DEFAULT '{}',
        created_at TIMESTAMPTZ DEFAULT NOW(),
        last_activity TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ
      );`);
      await migrateQuery(pool, 'UssdPortal', `CREATE TABLE IF NOT EXISTS ussd_menu_config (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        menu_key VARCHAR(50) NOT NULL,
        label VARCHAR(100) NOT NULL,
        display_order INTEGER DEFAULT 0,
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      );`);
      // ALTER TABLE IF NOT EXISTS for every column
      const colDefs = {
        ussd_sessions: [
          'tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE',
          'phone_number VARCHAR(20) NOT NULL',
          'session_id VARCHAR(100) UNIQUE NOT NULL',
          'current_step VARCHAR(50) DEFAULT \'home\'',
          'student_admission_no VARCHAR(100)',
          'student_id INTEGER',
          'menu_history TEXT[] DEFAULT \'{\'',
          'created_at TIMESTAMPTZ DEFAULT NOW()',
          'last_activity TIMESTAMPTZ DEFAULT NOW()',
          'expires_at TIMESTAMPTZ',
        ],
        ussd_menu_config: [
          'tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE',
          'menu_key VARCHAR(50) NOT NULL',
          'label VARCHAR(100) NOT NULL',
          'display_order INTEGER DEFAULT 0',
          'is_active BOOLEAN DEFAULT true',
          'created_at TIMESTAMPTZ DEFAULT NOW()',
        ],
      };
      for (const [tbl, cols] of Object.entries(colDefs))
        for (const col of cols) await migrateQuery(pool, 'UssdPortal', `ALTER TABLE ${tbl} ADD COLUMN IF NOT EXISTS ${col};`).catch(() => {});

      // Indexes
      for (const sql of [
        'CREATE INDEX IF NOT EXISTS idx_ussd_sess_tid ON ussd_sessions(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_ussd_sess_sid ON ussd_sessions(session_id);',
        'CREATE INDEX IF NOT EXISTS idx_ussd_sess_phone ON ussd_sessions(phone_number);',
        'CREATE INDEX IF NOT EXISTS idx_ussd_sess_step ON ussd_sessions(tenant_id,current_step);',
        'CREATE INDEX IF NOT EXISTS idx_ussd_sess_exp ON ussd_sessions(expires_at);',
        'CREATE INDEX IF NOT EXISTS idx_ussd_menu_tid ON ussd_menu_config(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_ussd_menu_key ON ussd_menu_config(tenant_id,menu_key);',
      ]) await migrateQuery(pool, 'UssdPortal', sql).catch(() => {});

      // Seed default menu config for tenant_id=0 (global defaults)
      // Wrapped in try/catch because tenant_id=0 may not exist in tenants table
      try {
        await migrateQuery(pool, 'UssdPortal', `INSERT INTO ussd_menu_config (tenant_id,menu_key,label,display_order) VALUES
          (0,'check_fees','Check Fees',1),
          (0,'check_attendance','Check Attendance',2),
          (0,'check_results','Check Results',3),
          (0,'contact_school','Contact School',4)
          ON CONFLICT DO NOTHING;`);
      } catch (seedErr) {
        console.warn('[USSD] Seed skipped (tenant_id=0 may not exist):', seedErr.message);
      }

      console.log('[USSD] Migrations applied');
    } catch (e) { /* migration OK */ }
  })();

  // ═══════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════

  /** Navigation bar */
  function nav(a) {
    return '<nav style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap">' +
      [['dashboard','Dashboard','/ussd/admin'],['configure','Configure','/ussd/admin/configure'],
       ['sessions','Sessions','/ussd/admin/sessions'],['analytics','Analytics','/ussd/admin/analytics'],
       ['tester','Tester','/ussd/admin/tester'],['logs','Logs','/ussd/admin/logs'],
       ['help','Help','/ussd/admin/help']]
      .map(([k,l,h])=>`<a href="${h}" class="btn btn-sm${a===k?' btn-blue':''}">${l}</a>`).join('') + '</nav>';
  }

  /** Format UGX currency with commas */
  function fmtUGX(n) {
    return 'UGX ' + Number(n || 0).toLocaleString();
  }

  /** Relative time */
  function ago(d) {
    if (!d) return '—';
    const s = Math.floor((Date.now() - new Date(d)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(d).toLocaleDateString();
  }

  /** Format number with locale separators */
  const F = n => (n || 0).toLocaleString();

  /** Pagination */
  function pag(path, qs, pg, tot) {
    const p = Math.ceil(tot / PS);
    if (p <= 1) return '';
    return '<div style="display:flex;justify-content:center;gap:4px;margin-top:14px">' +
      Array.from({ length: p }, (_, i) => {
        const x = i + 1;
        return `<a href="${path}?${qs}&page=${x}" class="btn btn-sm${x === parseInt(pg) ? ' btn-blue' : ''}">${x}</a>`;
      }).join('') + '</div>';
  }

  /** Flash message */
  function flash(req) {
    const f = req.session.flash; delete req.session.flash;
    return f ? `<div class="alert" style="background:#f0fdf4;border:1px solid #bbf7d0;color:#16a34a;padding:10px 14px;border-radius:8px;margin-bottom:14px">${esc(f.msg)}</div>` : '';
  }

  /** Simple HTML bar chart */
  function barChart(data, color) {
    if (!data.length) return '<p class="muted" style="text-align:center;padding:16px">No data</p>';
    const mx = Math.max(...data.map(d => d.value), 1);
    return data.map(d => {
      const pct = Math.round((d.value / mx) * 100);
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px"><span style="min-width:110px;font-size:13px;text-align:right" class="muted">${esc(d.label)}</span><div style="flex:1;height:22px;background:#f3f4f6;border-radius:4px;overflow:hidden"><div style="height:100%;width:${pct}%;background:${color || '#1a73e8'};border-radius:4px"></div></div><span style="min-width:50px;font-size:13px;font-weight:600">${F(d.value)}</span></div>`;
    }).join('');
  }

  /** Truncate text to maxLen characters for USSD */
  function ussdTruncate(text, maxLen) {
    maxLen = maxLen || 160;
    if (!text || text.length <= maxLen) return text || '';
    return text.substring(0, maxLen - 3) + '...';
  }

  /** Get menu config for a tenant (merges tenant-specific with global defaults) */
  async function getMenuConfig(tid) {
    const rows = (await pool.query(
      `SELECT DISTINCT ON (menu_key) menu_key, label, display_order, is_active
       FROM ussd_menu_config
       WHERE tenant_id IN ($1, 0) AND is_active = true
       ORDER BY menu_key, tenant_id DESC, display_order ASC`,
      [tid]
    )).rows;
    return rows.sort((a, b) => a.display_order - b.display_order);
  }

  /** Look up tenant by phone number (uses the guardian_phone on students or parent user phone) */
  async function getTenantByPhone(phone) {
    const cleaned = phone.replace(/[^+\d]/g, '');
    // Try guardian_phone on students
    const sr = (await pool.query(
      `SELECT DISTINCT tenant_id FROM students WHERE guardian_phone LIKE $1 LIMIT 1`,
      [`%${cleaned.replace(/^\+/, '').replace(/^256/, '')}%`]
    )).rows;
    if (sr.length) return sr[0].tenant_id;
    // Try users table
    const ur = (await pool.query(
      `SELECT tenant_id FROM users WHERE phone LIKE $1 LIMIT 1`,
      [`%${cleaned.replace(/^\+/, '').replace(/^256/, '')}%`]
    )).rows;
    if (ur.length) return ur[0].tenant_id;
    return null;
  }

  /** Look up student by admission number within a tenant */
  async function getStudentByAdmission(tid, admissionNo) {
    const r = (await pool.query(
      `SELECT id, admission_no, name, class, stream, guardian_phone FROM students
       WHERE tenant_id = $1 AND admission_no ILIKE $2 LIMIT 1`,
      [tid, admissionNo.trim()]
    )).rows[0];
    return r || null;
  }

  /** Look up student by phone number (guardian_phone) within a tenant */
  async function getStudentByPhone(tid, phone) {
    const cleaned = phone.replace(/[^+\d]/g, '').replace(/^\+/, '').replace(/^256/, '');
    const r = (await pool.query(
      `SELECT id, admission_no, name, class, stream, guardian_phone FROM students
       WHERE tenant_id = $1 AND guardian_phone LIKE $2 LIMIT 1`,
      [tid, `%${cleaned}%`]
    )).rows[0];
    return r || null;
  }

  /** Get tenant info for contact school display */
  async function getTenantInfo(tid) {
    const r = (await pool.query(
      `SELECT name, email, phone, address FROM tenants WHERE id = $1`, [tid]
    )).rows[0];
    return r || {};
  }

  /** Get tenant currency setting */
  async function getTenantCurrency(tid) {
    const r = (await pool.query(
      `SELECT currency FROM tenants WHERE id = $1`, [tid]
    )).rows[0];
    return r?.currency || 'UGX';
  }

  // ═══════════════════════════════════════════════════════
  //  USSD SESSION STATE MACHINE
  // ═══════════════════════════════════════════════════════
  const TEXTS = {
    en: {
      welcome: 'Welcome to School Portal\nSelect language:\n1. English\n2. Luganda',
      enter_id: 'Enter admission number\nor phone number:',
      invalid_id: 'Not found. Try again\nor enter admission number:',
      main_menu: (items) => items.join('\n') + '\n0. Exit',
      fees_prompt: (name) => `${name}\nFee Details:`,
      fees_detail: (total, paid, bal, due) => `Total: ${total}\nPaid: ${paid}\nBalance: ${bal}\nDue: ${due}\n\n0.Main Menu`,
      attendance_prompt: (name) => `${name}\nAttendance:`,
      attendance_detail: (today, week) => `Today: ${today}\nThis week: ${week}\n\n0.Main Menu`,
      results_prompt: (name) => `${name}\nLatest Results:`,
      results_detail: (results) => results + '\n\n0.Main Menu',
      contact_info: (name, phone, email, addr) => `${name}\nTel: ${phone}\nEmail: ${email}\nAddr: ${addr}\n\n0.Main Menu`,
      error: 'An error occurred.\nPlease try again later.',
      timeout: 'Session expired.\nDial again to restart.',
      goodbye: 'Thank you for using\nour service. Goodbye!',
      no_results: 'No results found.\n\n0.Main Menu',
    },
    lg: {
      welcome: 'Karibu Ebirowoozo\nLonda olulimi:\n1. Olungereza\n2. Oluganda',
      enter_id: 'Wulira namba y\'okuyita\noba namba ya telefoni:',
      invalid_id: 'Tetulabiseeko. Gezaako\nokuwulira namba y\'okuyita:',
      main_menu: (items) => items.join('\n') + '\n0. Ooka',
      fees_prompt: (name) => `${name}\nEbirowoozo bya Sente:`,
      fees_detail: (total, paid, bal, due) => `Ebyo: ${total}\nZikyiwedde: ${paid}\nEzidde: ${bal}\nEnkomeredde: ${due}\n\n0.Ekikulu`,
      attendance_prompt: (name) => `${name}\nOkubeera Awaka:`,
      attendance_detail: (today, week) => `Leo: ${today}\nWiiki eyo: ${week}\n\n0.Ekikulu`,
      results_prompt: (name) => `${name}\nObulamu obw'enkomeredde:`,
      results_detail: (results) => results + '\n\n0.Ekikulu',
      contact_info: (name, phone, email, addr) => `${name}\nTel: ${phone}\nEmail: ${email}\nAddr: ${addr}\n\n0.Ekikulu`,
      error: 'Kiremyewo ekintu.\nGezaako dda.',
      timeout: 'Omukolo gunalizebwo.\nDda okubikkula dda.',
      goodbye: 'Webale n\'okukozesa\nobulamu obwaffe!',
      no_results: 'Tetulabiseeko.\n\n0.Ekikulu',
    },
  };

  /** Build menu items list for main menu based on tenant config */
  function buildMainMenuItems(menus, lang) {
    const items = [];
    const labels = {
      en: { check_fees: 'Check Fees', check_attendance: 'Check Attendance', check_results: 'Check Results', contact_school: 'Contact School' },
      lg: { check_fees: 'Sente/Enkumi', check_attendance: 'Okubeera Awaka', check_results: 'Obulamu', contact_school: 'Yogera Essomero' },
    };
    const mapping = { check_fees: '1', check_attendance: '2', check_results: '3', contact_school: '4' };
    let num = 1;
    for (const menu of menus) {
      const label = labels[lang]?.[menu.menu_key] || labels.en[menu.menu_key] || menu.label;
      items.push(`${num}. ${label}`);
      menu._ussd_num = String(num);
      num++;
    }
    return items;
  }

  /** Resolve menu key from user numeric input */
  function resolveMenuKey(menus, input) {
    const idx = parseInt(input) - 1;
    if (idx >= 0 && idx < menus.length) return menus[idx].menu_key;
    return null;
  }

  /**
   * Core USSD state machine handler.
   * Returns { type: 'CON'|'END', text: string }
   */
  async function handleUSSD(sessionId, phoneNumber, userInput, eventType, serviceCode) {
    const input = (userInput || '').trim();
    const cleanedPhone = phoneNumber.replace(/[^+\d]/g, '');

    // On initiation (first request)
    if (eventType === 'initiation' || !input) {
      // Create or get session
      let session = (await pool.query(
        `SELECT * FROM ussd_sessions WHERE session_id = $1`, [sessionId]
      )).rows[0];

      if (session && session.expires_at && new Date(session.expires_at) < new Date()) {
        // Expired — delete and start fresh
        await pool.query(`DELETE FROM ussd_sessions WHERE session_id = $1`, [sessionId]);
        session = null;
      }

      if (!session) {
        const tid = await getTenantByPhone(phoneNumber);
        await pool.query(
          `INSERT INTO ussd_sessions (session_id, phone_number, tenant_id, current_step, last_activity, expires_at, menu_history)
           VALUES ($1, $2, $3, 'home', NOW(), NOW() + INTERVAL '2 minutes', ARRAY['home'])`,
          [sessionId, cleanedPhone, tid]
        );
      } else {
        await pool.query(
          `UPDATE ussd_sessions SET last_activity = NOW(), expires_at = NOW() + INTERVAL '2 minutes', menu_history = array_append(menu_history, 'home') WHERE session_id = $1`,
          [sessionId]
        );
      }
      return { type: 'CON', text: TEXTS.en.welcome };
    }

    // Get existing session
    let session = (await pool.query(
      `SELECT * FROM ussd_sessions WHERE session_id = $1`, [sessionId]
    )).rows[0];

    if (!session) {
      return { type: 'END', text: TEXTS.en.timeout };
    }

    // Check expiry
    if (session.expires_at && new Date(session.expires_at) < new Date()) {
      await pool.query(`DELETE FROM ussd_sessions WHERE session_id = $1`, [sessionId]);
      return { type: 'END', text: TEXTS.en.timeout };
    }

    // Update last activity
    await pool.query(
      `UPDATE ussd_sessions SET last_activity = NOW(), expires_at = NOW() + INTERVAL '2 minutes' WHERE session_id = $1`,
      [sessionId]
    );

    const step = session.current_step;
    const lang = session.menu_history?.includes('lang:lg') ? LANG_LG : LANG_EN;
    const t = TEXTS[lang] || TEXTS.en;
    const tid = session.tenant_id;
    const currency = tid ? await getTenantCurrency(tid) : 'UGX';
    const fmtCur = (n) => currency + ' ' + Number(n || 0).toLocaleString();

    try {
      // ── STATE: HOME (language selection) ──
      if (step === 'home') {
        if (input === '1') {
          await pool.query(`UPDATE ussd_sessions SET current_step = 'auth', menu_history = array_append(menu_history, 'lang:en') WHERE session_id = $1`, [sessionId]);
          return { type: 'CON', text: t.enter_id };
        } else if (input === '2') {
          await pool.query(`UPDATE ussd_sessions SET current_step = 'auth', menu_history = array_append(menu_history, 'lang:lg') WHERE session_id = $1`, [sessionId]);
          return { type: 'CON', text: t.enter_id };
        } else {
          return { type: 'CON', text: t.welcome };
        }
      }

      // ── STATE: AUTH (identify student) ──
      if (step === 'auth') {
        // Try to find student by admission number first
        let student = null;
        if (tid) {
          student = await getStudentByAdmission(tid, input);
          if (!student) student = await getStudentByPhone(tid, cleanedPhone);
        }

        if (!student && !tid) {
          // Try all tenants (fallback)
          const allTenants = (await pool.query(`SELECT id FROM tenants LIMIT 100`)).rows;
          for (const tn of allTenants) {
            student = await getStudentByAdmission(tn.id, input);
            if (!student) student = await getStudentByPhone(tn.id, cleanedPhone);
            if (student) {
              await pool.query(`UPDATE ussd_sessions SET tenant_id = $2 WHERE session_id = $1`, [sessionId, tn.id]);
              break;
            }
          }
        }

        if (!student) {
          return { type: 'CON', text: t.invalid_id };
        }

        // Student found — store in session
        await pool.query(
          `UPDATE ussd_sessions SET current_step = 'main_menu', student_id = $2, student_admission_no = $3, tenant_id = COALESCE(tenant_id, $4), menu_history = array_append(menu_history, 'auth:' || $3) WHERE session_id = $1`,
          [sessionId, student.id, student.admission_no, tid]
        );

        // Build main menu
        const menus = tid ? await getMenuConfig(tid) : await getMenuConfig(0);
        const menuItems = buildMainMenuItems(menus, lang);
        return { type: 'CON', text: `Welcome ${student.name}\n${t.main_menu(menuItems)}` };
      }

      // ── STATE: MAIN MENU ──
      if (step === 'main_menu') {
        if (input === '0') {
          await pool.query(`DELETE FROM ussd_sessions WHERE session_id = $1`, [sessionId]);
          return { type: 'END', text: t.goodbye };
        }

        const effectiveTid = session.tenant_id;
        const menus = effectiveTid ? await getMenuConfig(effectiveTid) : await getMenuConfig(0);
        const menuItems = buildMainMenuItems(menus, lang);
        const menuKey = resolveMenuKey(menus, input);

        if (!menuKey) {
          return { type: 'CON', text: `Invalid choice.\n${t.main_menu(menuItems)}` };
        }

        await pool.query(
          `UPDATE ussd_sessions SET current_step = $2, menu_history = array_append(menu_history, $3) WHERE session_id = $1`,
          [sessionId, menuKey, menuKey]
        );

        // Dispatch to sub-handlers
        if (menuKey === 'check_fees') return await handleCheckFees(session, lang, currency, t);
        if (menuKey === 'check_attendance') return await handleCheckAttendance(session, lang, t);
        if (menuKey === 'check_results') return await handleCheckResults(session, lang, t);
        if (menuKey === 'contact_school') return await handleContactSchool(session, lang, t);

        return { type: 'CON', text: t.main_menu(menuItems) };
      }

      // ── STATE: Sub-menus (back to main) ──
      if (['check_fees', 'check_attendance', 'check_results', 'contact_school'].includes(step)) {
        if (input === '0') {
          await pool.query(`UPDATE ussd_sessions SET current_step = 'main_menu', menu_history = array_append(menu_history, 'main_menu') WHERE session_id = $1`, [sessionId]);
          const menus = session.tenant_id ? await getMenuConfig(session.tenant_id) : await getMenuConfig(0);
          const menuItems = buildMainMenuItems(menus, lang);
          const student = session.student_admission_no || 'User';
          return { type: 'CON', text: `Welcome ${student}\n${t.main_menu(menuItems)}` };
        }
        // Re-display the current step
        if (step === 'check_fees') return await handleCheckFees(session, lang, currency, t);
        if (step === 'check_attendance') return await handleCheckAttendance(session, lang, t);
        if (step === 'check_results') return await handleCheckResults(session, lang, t);
        if (step === 'contact_school') return await handleContactSchool(session, lang, t);
      }

      // Fallback
      return { type: 'CON', text: t.error + '\n\n0.Main Menu' };
    } catch (err) {
      console.error('[USSD] State machine error:', err.message);
      return { type: 'END', text: t.error };
    }
  }

  // ── Sub-handlers ──

  async function handleCheckFees(session, lang, currency, t) {
    const fmtCur = (n) => currency + ' ' + Number(n || 0).toLocaleString();
    if (!session.student_id) return { type: 'END', text: t.error };
    const fees = (await pool.query(
      `SELECT SUM(amount)::numeric AS total, SUM(paid)::numeric AS paid, MAX(term) AS term, MAX(year) AS year
       FROM fees WHERE student_id = $1`, [session.student_id]
    )).rows[0];
    const total = Number(fees?.total || 0);
    const paid = Number(fees?.paid || 0);
    const balance = total - paid;
    const dueDate = fees?.term ? `${fees.term} ${fees.year || ''}`.trim() : 'N/A';
    const text = t.fees_detail(fmtCur(total), fmtCur(paid), fmtCur(balance), dueDate);
    return { type: 'CON', text: ussdTruncate(text, 160) };
  }

  async function handleCheckAttendance(session, lang, t) {
    if (!session.student_id) return { type: 'END', text: t.error };
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + 1); // Monday

    const [todayRes, weekRes] = await Promise.all([
      pool.query(
        `SELECT status FROM attendance WHERE student_id = $1 AND date = $2 LIMIT 1`,
        [session.student_id, today.toISOString().split('T')[0]]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE status = 'present')::int AS present
         FROM attendance WHERE student_id = $1 AND date >= $2`,
        [session.student_id, weekStart.toISOString().split('T')[0]]
      ),
    ]);

    const todayStatus = todayRes.rows[0]?.status || 'N/A';
    const weekPresent = weekRes.rows[0]?.present || 0;
    const weekTotal = weekRes.rows[0]?.total || 0;

    const text = t.attendance_detail(`${todayStatus}`, `${weekPresent}/${weekTotal}`);
    return { type: 'CON', text: ussdTruncate(text, 160) };
  }

  async function handleCheckResults(session, lang, t) {
    if (!session.student_id) return { type: 'END', text: t.error };
    const results = (await pool.query(
      `SELECT m.subject, m.score, m.grade, e.name AS exam, e.term
       FROM marks m JOIN exams e ON m.exam_id = e.id
       WHERE m.student_id = $1
       ORDER BY e.created_at DESC, m.subject
       LIMIT 5`,
      [session.student_id]
    )).rows;

    if (!results.length) {
      return { type: 'CON', text: t.no_results };
    }

    const examName = results[0].exam || 'Exam';
    let lines = `${examName}\n`;
    for (const r of results) {
      lines += `${r.subject}: ${r.score}/${r.grade}\n`;
    }
    const text = t.results_detail(ussdTruncate(lines.trim(), 140));
    return { type: 'CON', text: text };
  }

  async function handleContactSchool(session, lang, t) {
    const tid = session.tenant_id;
    if (!tid) return { type: 'END', text: t.error };
    const info = await getTenantInfo(tid);
    const text = t.contact_info(
      info.name || 'School',
      info.phone || 'N/A',
      info.email || 'N/A',
      info.address || 'N/A'
    );
    return { type: 'CON', text: ussdTruncate(text, 160) };
  }

  // ═══════════════════════════════════════════════════════
  //  CSS STYLES
  // ═══════════════════════════════════════════════════════
  const CSS = `<style>
    .ussd-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(155px,1fr));gap:12px;margin-bottom:18px}
    .stat-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px;text-align:center;transition:box-shadow .15s}
    .stat-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .stat-num{font-size:26px;font-weight:700;color:#1f2937}
    .stat-label{font-size:12px;color:#6b7280;margin-top:2px}
    .fbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    .fbar select,.fbar input{padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;background:#fff}
    .inp{padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none}
    .inp:focus{border-color:#1a73e8}
    .qa{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:10px;margin-bottom:18px}
    .qa-a{border:1px solid #e5e7eb;border-radius:10px;padding:14px;background:#fff;text-align:center;text-decoration:none;color:inherit}
    .qa-a:hover{border-color:#1a73e8;box-shadow:0 2px 8px rgba(26,115,232,.1)}

    /* USSD Phone Tester */
    .phone-frame{width:300px;height:560px;background:#1a1a1a;border-radius:32px;padding:12px;margin:0 auto;box-shadow:0 12px 40px rgba(0,0,0,.35),inset 0 0 0 2px #333;position:relative;user-select:none}
    .phone-notch{width:100px;height:18px;background:#1a1a1a;border-radius:0 0 12px 12px;margin:0 auto 6px;position:relative;z-index:2}
    .phone-screen{background:#000;border-radius:20px;height:calc(100% - 28px);overflow:hidden;display:flex;flex-direction:column}
    .phone-header{background:#000;color:#33ff33;font-size:11px;padding:6px 10px;font-family:monospace;border-bottom:1px solid #1a3a1a;display:flex;justify-content:space-between}
    .phone-body{flex:1;overflow-y:auto;padding:10px;color:#33ff33;font-family:monospace;font-size:13px;line-height:1.5;white-space:pre-wrap;word-wrap:break-word}
    .phone-body::-webkit-scrollbar{width:4px}
    .phone-body::-webkit-scrollbar-thumb{background:#1a3a1a;border-radius:2px}
    .phone-input-row{display:flex;border-top:1px solid #1a3a1a;background:#0a0a0a}
    .phone-input{flex:1;background:transparent;border:none;color:#33ff33;font-family:monospace;font-size:14px;padding:10px;outline:none}
    .phone-input::placeholder{color:#1a5a1a}
    .phone-send{background:#1a3a1a;color:#33ff33;border:none;padding:10px 14px;cursor:pointer;font-size:16px}
    .phone-send:hover{background:#2a5a2a}
    .phone-end-btn{background:#333;color:#aaa;border:none;padding:6px 14px;border-radius:4px;cursor:pointer;font-size:11px;margin-top:8px;text-align:center}
    .phone-end-btn:hover{background:#555;color:#fff}
    .phone-status{font-size:10px;color:#1a5a1a;margin-top:4px;text-align:center}
    .tester-container{display:flex;gap:24px;align-items:flex-start;flex-wrap:wrap;justify-content:center}
    .tester-sidebar{min-width:280px;max-width:340px}
    .log-entry{padding:6px 8px;border-bottom:1px solid #f3f4f6;font-size:12px;display:flex;gap:8px;align-items:flex-start}
    .log-entry:nth-child(even){background:#f9fafb}
    .log-step{background:#1a73e8;color:#fff;padding:2px 6px;border-radius:4px;font-size:11px;white-space:nowrap}
    .log-text{color:#4b5563;word-break:break-all}

    /* Code block for help page */
    .code-block{background:#1e293b;color:#e2e8f0;padding:14px 16px;border-radius:8px;font-family:'Courier New',monospace;font-size:13px;overflow-x:auto;white-space:pre-wrap;line-height:1.5;margin:8px 0}
    .code-block .comment{color:#64748b}
    .code-block .keyword{color:#c084fc}
    .code-block .string{color:#34d399}
  </style>`;

  // ═══════════════════════════════════════════════════════
  //  1. POST /api/v1/ussd — Africa's Talking USSD Callback
  //     Skips CSRF and auth — external webhook
  // ═══════════════════════════════════════════════════════
  app.post('/api/v1/ussd', ah(async (req, res) => {
    const { eventType, sessionId, serviceCode, phoneNumber, text } = req.body;

    // Basic validation
    if (!sessionId || !phoneNumber) {
      return res.type('text/plain').send('END Invalid request.');
    }

    const result = await handleUSSD(
      sessionId,
      phoneNumber,
      text || '',
      eventType || 'response',
      serviceCode || ''
    );

    if (result.type === 'CON') {
      res.type('text/plain').send('CON ' + result.text);
    } else {
      res.type('text/plain').send('END ' + result.text);
    }
  }));

  // ═══════════════════════════════════════════════════════
  //  2. GET /ussd/admin — Admin Dashboard
  // ═══════════════════════════════════════════════════════
  app.get('/ussd/admin', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const s = (await pool.query(
      `SELECT COUNT(*)::int AS total_sessions,
              COUNT(*) FILTER (WHERE expires_at > NOW())::int AS active_sessions,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours')::int AS sessions_24h,
              COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '7 days')::int AS sessions_7d,
              COUNT(DISTINCT phone_number)::int AS unique_phones
       FROM ussd_sessions WHERE tenant_id = $1`,
      [tid]
    )).rows[0];

    // Popular menu steps
    const popular = (await pool.query(
      `SELECT current_step, COUNT(*)::int AS cnt
       FROM ussd_sessions WHERE tenant_id = $1 AND current_step != 'home' AND current_step != 'auth' AND current_step != 'main_menu'
       GROUP BY current_step ORDER BY cnt DESC LIMIT 5`,
      [tid]
    )).rows;

    // Recent sessions
    const recent = (await pool.query(
      `SELECT id, phone_number, session_id, current_step, student_admission_no, created_at, last_activity, expires_at
       FROM ussd_sessions WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 8`,
      [tid]
    )).rows;

    const stepLabels = { check_fees: 'Check Fees', check_attendance: 'Check Attendance', check_results: 'Check Results', contact_school: 'Contact School' };

    const recentRows = recent.length === 0
      ? '<tr><td colspan="5" class="muted" style="text-align:center;padding:28px">No USSD sessions yet</td></tr>'
      : recent.map(r => {
          const isActive = r.expires_at && new Date(r.expires_at) > new Date();
          return `<tr><td style="font-family:monospace;font-size:13px">${esc(r.phone_number)}</td>
            <td>${esc(r.student_admission_no || '—')}</td>
            <td><span class="badge ${isActive ? 'btn btn-sm btn-green' : 'btn btn-sm'}" style="font-size:11px">${isActive ? 'Active' : 'Expired'}</span></td>
            <td class="muted">${stepLabels[r.current_step] || esc(r.current_step)}</td>
            <td class="muted">${ago(r.created_at)}</td></tr>`;
        }).join('');

    const popularBars = popular.length
      ? barChart(popular.map(p => ({ label: stepLabels[p.current_step] || p.current_step, value: p.cnt })), '#1a73e8')
      : '<p class="muted" style="text-align:center;padding:16px">No usage data yet</p>';

    res.send(renderPage('USSD Dashboard', `${CSS}${nav('dashboard')}
      <h2>USSD Portal Dashboard</h2>
      <p class="muted" style="margin-bottom:18px">Monitor USSD session activity and usage analytics</p>
      <div class="ussd-stats">
        <div class="stat-card"><div class="stat-num" style="color:#1a73e8">${F(s.total_sessions)}</div><div class="stat-label">Total Sessions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${F(s.active_sessions)}</div><div class="stat-label">Active Now</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${F(s.sessions_24h)}</div><div class="stat-label">Last 24 Hours</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">${F(s.sessions_7d)}</div><div class="stat-label">Last 7 Days</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#ef4444">${F(s.unique_phones)}</div><div class="stat-label">Unique Phones</div></div>
      </div>
      <div class="qa">
        <a href="/ussd/admin/tester" class="qa-a"><div style="font-size:24px;margin-bottom:4px">&#128241;</div><div style="font-size:13px;font-weight:600">USSD Tester</div></a>
        <a href="/ussd/admin/configure" class="qa-a"><div style="font-size:24px;margin-bottom:4px">&#9881;</div><div style="font-size:13px;font-weight:600">Configure Menu</div></a>
        <a href="/ussd/admin/analytics" class="qa-a"><div style="font-size:24px;margin-bottom:4px">&#128200;</div><div style="font-size:13px;font-weight:600">Analytics</div></a>
        <a href="/ussd/admin/help" class="qa-a"><div style="font-size:24px;margin-bottom:4px">&#128218;</div><div style="font-size:13px;font-weight:600">Integration Guide</div></a>
        <a href="/ussd/admin/sessions" class="qa-a"><div style="font-size:24px;margin-bottom:4px">&#128203;</div><div style="font-size:13px;font-weight:600">All Sessions</div></a>
        <a href="/ussd/admin/logs" class="qa-a"><div style="font-size:24px;margin-bottom:4px">&#128196;</div><div style="font-size:13px;font-weight:600">Session Logs</div></a>
      </div>
      <div class="grid" style="grid-template-columns:2fr 1fr;gap:14px">
        <div class="card"><h3 style="margin:0 0 10px">Recent Sessions</h3>
          <table class="table"><thead><tr><th>Phone</th><th>Admission</th><th>Status</th><th>Step</th><th>Time</th></tr></thead>
          <tbody>${recentRows}</tbody></table></div>
        <div class="card"><h3 style="margin:0 0 10px">Popular Features</h3>${popularBars}</div>
      </div>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  3. GET /ussd/admin/configure — Menu Configuration Form
  // ═══════════════════════════════════════════════════════
  app.get('/ussd/admin/configure', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const menus = (await pool.query(
      `SELECT * FROM ussd_menu_config WHERE tenant_id IN ($1, 0) AND is_active = true
       ORDER BY menu_key, tenant_id DESC, display_order ASC`,
      [tid]
    )).rows;

    // Deduplicate by menu_key, prefer tenant-specific
    const seen = new Set();
    const unique = [];
    for (const m of menus) {
      if (!seen.has(m.menu_key)) { seen.add(m.menu_key); unique.push(m); }
    }

    const formRows = unique.map(m => `
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:10px;padding:10px;background:#f8fafc;border-radius:8px">
        <div style="flex:1">
          <label style="font-weight:600;font-size:13px;display:block;margin-bottom:3px">${esc(m.menu_key.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()))}</label>
          <input type="text" name="label_${m.menu_key}" value="${esc(m.label)}" class="inp" style="width:100%" placeholder="Menu label">
        </div>
        <div style="width:80px">
          <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:3px">Order</label>
          <input type="number" name="order_${m.menu_key}" value="${m.display_order}" class="inp" style="width:100%" min="0" max="20">
        </div>
        <div style="width:70px">
          <label style="font-size:11px;color:#6b7280;display:block;margin-bottom:3px">Active</label>
          <select name="active_${m.menu_key}" class="inp" style="width:100%">
            <option value="true" ${m.is_active !== false ? 'selected' : ''}>Yes</option>
            <option value="false" ${m.is_active === false ? 'selected' : ''}>No</option>
          </select>
        </div>
      </div>
    `).join('');

    res.send(renderPage('USSD Menu Config', `${CSS}${nav('configure')}
      <h2>USSD Menu Configuration</h2>
      <p class="muted" style="margin-bottom:18px">Customize the USSD menu items available to users</p>
      <div class="card">
        <form method="POST" action="/ussd/admin/configure" style="display:grid;gap:10px">
          ${formRows}
          <div style="margin-top:8px;display:flex;gap:10px">
            <button type="submit" class="btn btn-blue">Save Configuration</button>
            <a href="/ussd/admin" class="btn">Cancel</a>
          </div>
        </form>
      </div>
      <div class="card" style="margin-top:14px">
        <h3 style="margin:0 0 8px">Preview</h3>
        <div style="background:#000;color:#33ff33;font-family:monospace;padding:14px;border-radius:8px;font-size:13px;white-space:pre-wrap">Welcome to School Portal
Select language:
1. English
2. Luganda</div>
        <p class="muted" style="margin-top:8px;font-size:12px">After language selection, the configured menu items appear in the order specified above.</p>
      </div>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  4. POST /ussd/admin/configure — Save Menu Configuration
  // ═══════════════════════════════════════════════════════
  app.post('/ussd/admin/configure', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const menuKeys = ['check_fees', 'check_attendance', 'check_results', 'contact_school'];

    for (const key of menuKeys) {
      const label = req.body[`label_${key}`] || key;
      const order = parseInt(req.body[`order_${key}`]) || 0;
      const active = req.body[`active_${key}`] !== 'false';

      // Upsert: update existing tenant-specific or create new
      const existing = (await pool.query(
        `SELECT id FROM ussd_menu_config WHERE tenant_id = $1 AND menu_key = $2`,
        [tid, key]
      )).rows[0];

      if (existing) {
        await pool.query(
          `UPDATE ussd_menu_config SET label = $3, display_order = $4, is_active = $5 WHERE id = $1 AND tenant_id = $2`,
          [existing.id, tid, label, order, active]
        );
      } else {
        await pool.query(
          `INSERT INTO ussd_menu_config (tenant_id, menu_key, label, display_order, is_active) VALUES ($1, $2, $3, $4, $5)`,
          [tid, key, label, order, active]
        );
      }
    }

    req.session.flash = { msg: 'USSD menu configuration saved successfully.' };
    res.redirect('/ussd/admin/configure');
  }));

  // ═══════════════════════════════════════════════════════
  //  5. GET /ussd/admin/sessions — All USSD Sessions
  // ═══════════════════════════════════════════════════════
  app.get('/ussd/admin/sessions', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { q, step, page = 1 } = req.query;
    const off = (parseInt(page) - 1) * PS;

    let w = ['tenant_id=$1'], p = [tid], i = 2;
    if (step && step !== 'all') { w.push(`current_step=$${i++}`); p.push(step); }
    if (q) { w.push(`(phone_number ILIKE $${i++} OR student_admission_no ILIKE $${i++})`); p.push(`%${q}%`, `%${q}%`); }
    const wc = w.join(' AND ');

    const [cR, sessR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS t FROM ussd_sessions WHERE ${wc}`, p),
      pool.query(`SELECT * FROM ussd_sessions WHERE ${wc} ORDER BY created_at DESC LIMIT $${i} OFFSET $${i + 1}`, [...p, PS, off])
    ]);

    const tot = cR.rows[0]?.t || 0;
    const sessions = sessR.rows;
    const qs = `q=${q || ''}&step=${step || ''}`;
    const stepLabels = { home: 'Home', auth: 'Auth', main_menu: 'Main Menu', check_fees: 'Check Fees', check_attendance: 'Check Attendance', check_results: 'Check Results', contact_school: 'Contact School' };

    const rows = sessions.length === 0
      ? '<tr><td colspan="7" class="muted" style="text-align:center;padding:28px">No sessions found</td></tr>'
      : sessions.map(s => {
          const isActive = s.expires_at && new Date(s.expires_at) > new Date();
          const hist = (s.menu_history || []).filter(h => h).slice(-4).join(' > ') || '—';
          return `<tr>
            <td style="font-family:monospace;font-size:13px">${esc(s.phone_number)}</td>
            <td class="muted">${esc(s.session_id.substring(0, 12))}...</td>
            <td>${esc(s.student_admission_no || '—')}</td>
            <td><span class="badge ${isActive ? 'btn btn-sm btn-green' : 'btn btn-sm'}" style="font-size:11px">${isActive ? 'Active' : 'Expired'}</span></td>
            <td class="muted">${stepLabels[s.current_step] || esc(s.current_step)}</td>
            <td class="muted" style="font-size:11px;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(hist)}">${esc(hist)}</td>
            <td class="muted">${ago(s.created_at)}</td></tr>`;
        }).join('');

    res.send(renderPage('USSD Sessions', `${CSS}${nav('sessions')}
      <h2>USSD Sessions</h2>
      <p class="muted" style="margin-bottom:14px">View and search all USSD session history</p>
      <div class="card">
        <div class="fbar" style="margin-bottom:14px">
          <input type="text" value="${esc(q || '')}" placeholder="Search phone or admission..." id="fQ">
          <select id="fS">
            <option value="all">All Steps</option>
            <option value="home"${step === 'home' ? ' selected' : ''}>Home</option>
            <option value="auth"${step === 'auth' ? ' selected' : ''}>Auth</option>
            <option value="main_menu"${step === 'main_menu' ? ' selected' : ''}>Main Menu</option>
            <option value="check_fees"${step === 'check_fees' ? ' selected' : ''}>Check Fees</option>
            <option value="check_attendance"${step === 'check_attendance' ? ' selected' : ''}>Check Attendance</option>
            <option value="check_results"${step === 'check_results' ? ' selected' : ''}>Check Results</option>
            <option value="contact_school"${step === 'contact_school' ? ' selected' : ''}>Contact School</option>
          </select>
          <button class="btn btn-sm btn-blue" onclick="applyF()">Filter</button>
          <a href="/ussd/admin/sessions" class="btn btn-sm">Clear</a>
        </div>
        <table class="table"><thead><tr><th>Phone</th><th>Session</th><th>Admission</th><th>Status</th><th>Step</th><th>History</th><th>Time</th></tr></thead>
        <tbody>${rows}</tbody></table>
        ${pag('/ussd/admin/sessions', qs, page, tot)}
      </div>
      <script>function applyF(){var p=new URLSearchParams(),q=document.getElementById('fQ').value,s=document.getElementById('fS').value;if(q)p.set('q',q);if(s!=='all')p.set('step',s);location.href='/ussd/admin/sessions?'+p.toString()}</script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  6. GET /ussd/admin/analytics — Usage Analytics
  // ═══════════════════════════════════════════════════════
  app.get('/ussd/admin/analytics', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Sessions per day (last 14 days)
    const daily = (await pool.query(
      `SELECT created_at::date AS day, COUNT(*)::int AS sessions
       FROM ussd_sessions WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '14 days'
       GROUP BY created_at::date ORDER BY day`,
      [tid]
    )).rows;

    // Popular features
    const features = (await pool.query(
      `SELECT current_step, COUNT(*)::int AS cnt
       FROM ussd_sessions WHERE tenant_id = $1 AND current_step NOT IN ('home','auth','main_menu')
       GROUP BY current_step ORDER BY cnt DESC`,
      [tid]
    )).rows;

    // Peak hours
    const hours = (await pool.query(
      `SELECT EXTRACT(HOUR FROM created_at)::int AS hour, COUNT(*)::int AS cnt
       FROM ussd_sessions WHERE tenant_id = $1
       GROUP BY EXTRACT(HOUR FROM created_at) ORDER BY hour`,
      [tid]
    )).rows;

    // Unique phones per day (last 7 days)
    const uniquePhones = (await pool.query(
      `SELECT created_at::date AS day, COUNT(DISTINCT phone_number)::int AS phones
       FROM ussd_sessions WHERE tenant_id = $1 AND created_at >= NOW() - INTERVAL '7 days'
       GROUP BY created_at::date ORDER BY day`,
      [tid]
    )).rows;

    // Completion rate (sessions that reached a sub-menu vs total)
    const completion = (await pool.query(
      `SELECT
         COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE current_step NOT IN ('home','auth','main_menu'))::int AS completed,
         COUNT(*) FILTER (WHERE student_id IS NOT NULL)::int AS authenticated
       FROM ussd_sessions WHERE tenant_id = $1`,
      [tid]
    )).rows[0];

    const compRate = completion.total > 0 ? ((completion.completed / completion.total) * 100).toFixed(1) : '0.0';
    const authRate = completion.total > 0 ? ((completion.authenticated / completion.total) * 100).toFixed(1) : '0.0';

    const stepLabels = { check_fees: 'Check Fees', check_attendance: 'Check Attendance', check_results: 'Check Results', contact_school: 'Contact School' };

    res.send(renderPage('USSD Analytics', `${CSS}${nav('analytics')}
      <h2>USSD Usage Analytics</h2>
      <p class="muted" style="margin-bottom:18px">Insights into USSD usage patterns and engagement</p>
      <div class="ussd-stats">
        <div class="stat-card"><div class="stat-num" style="color:#1a73e8">${F(completion.total)}</div><div class="stat-label">Total Sessions</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#16a34a">${compRate}%</div><div class="stat-label">Completion Rate</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#f59e0b">${authRate}%</div><div class="stat-label">Auth Success Rate</div></div>
        <div class="stat-card"><div class="stat-num" style="color:#8b5cf6">${F(uniquePhones.length ? uniquePhones.reduce((a, b) => a + b.phones, 0) : 0)}</div><div class="stat-label">Unique Users (7d)</div></div>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px">
        <div class="card"><h3 style="margin:0 0 10px">Sessions Per Day (14d)</h3>
          ${barChart(daily.map(d => ({ label: new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: d.sessions })), '#1a73e8')}</div>
        <div class="card"><h3 style="margin:0 0 10px">Popular Features</h3>
          ${features.length ? barChart(features.map(f => ({ label: stepLabels[f.current_step] || f.current_step, value: f.cnt })), '#16a34a') : '<p class="muted" style="text-align:center;padding:16px">No data</p>'}</div>
      </div>
      <div class="grid" style="grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
        <div class="card"><h3 style="margin:0 0 10px">Peak Hours</h3>
          ${hours.length ? barChart(hours.map(h => ({ label: `${h.hour}:00`, value: h.cnt })), '#f59e0b') : '<p class="muted" style="text-align:center;padding:16px">No data</p>'}</div>
        <div class="card"><h3 style="margin:0 0 10px">Unique Phones Per Day (7d)</h3>
          ${uniquePhones.length ? barChart(uniquePhones.map(d => ({ label: new Date(d.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: d.phones })), '#8b5cf6') : '<p class="muted" style="text-align:center;padding:16px">No data</p>'}</div>
      </div>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  7. GET /ussd/admin/tester — Interactive USSD Tester
  // ═══════════════════════════════════════════════════════
  app.get('/ussd/admin/tester', requireAuth, ah(async (req, res) => {
    res.send(renderPage('USSD Tester', `${CSS}${nav('tester')}
      <h2>USSD Session Tester</h2>
      <p class="muted" style="margin-bottom:18px">Simulate a USSD session from a feature phone. Great for testing and demos!</p>
      <div class="tester-container">
        <div>
          <div class="phone-frame">
            <div class="phone-notch"></div>
            <div class="phone-screen">
              <div class="phone-header">
                <span>USSD</span>
                <span id="phoneStatus">&#9679; Ready</span>
              </div>
              <div class="phone-body" id="phoneScreen">Dial *XXX# to start...</div>
              <div class="phone-input-row">
                <input type="text" class="phone-input" id="phoneInput" placeholder="Type response..." maxlength="160" disabled>
                <button class="phone-send" id="phoneSend" onclick="sendInput()" disabled>&#9654;</button>
              </div>
            </div>
          </div>
          <div style="text-align:center">
            <button class="phone-end-btn" onclick="startSession()">&#128241; Start New Session</button>
            <div class="phone-status" id="phoneStep">Step: idle</div>
          </div>
        </div>
        <div class="tester-sidebar">
          <div class="card" style="margin-bottom:14px">
            <h3 style="margin:0 0 10px">Test Settings</h3>
            <div style="display:grid;gap:10px">
              <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Phone Number</label>
                <input type="text" class="inp" id="testPhone" style="width:100%" value="+256700000000" placeholder="+256..."></div>
              <div><label style="font-size:12px;font-weight:600;display:block;margin-bottom:3px">Service Code</label>
                <input type="text" class="inp" id="testCode" style="width:100%"" value="*123#" placeholder="*XXX#"></div>
              <button class="btn btn-blue" style="width:100%" onclick="startSession()">Start Session</button>
            </div>
          </div>
          <div class="card">
            <h3 style="margin:0 0 10px">Session Log</h3>
            <div id="sessionLog" style="max-height:240px;overflow-y:auto;border:1px solid #e5e7eb;border-radius:6px">
              <div class="muted" style="text-align:center;padding:16px;font-size:12px">Start a session to see the log</div>
            </div>
            <button class="btn btn-sm" style="margin-top:8px;width:100%" onclick="clearLog()">Clear Log</button>
          </div>
        </div>
      </div>
      <script>
      var testSessionId = null;
      var isCon = false;
      var logEntries = [];

      function startSession() {
        var phone = document.getElementById('testPhone').value.trim();
        if (!phone) { alert('Enter a phone number'); return; }
        testSessionId = 'test_' + Date.now() + '_' + Math.random().toString(36).substr(2,6);
        isCon = false;
        document.getElementById('phoneScreen').textContent = 'Connecting...';
        document.getElementById('phoneInput').value = '';
        document.getElementById('phoneInput').disabled = true;
        document.getElementById('phoneSend').disabled = true;
        document.getElementById('phoneStatus').innerHTML = '<span style="color:#f59e0b">&#9679;</span> Connecting';
        document.getElementById('phoneStep').textContent = 'Step: init';
        addLog('INIT', 'Dialing *XXX# from ' + phone);
        fetch('/ussd/admin/tester', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: testSessionId, phoneNumber: phone, text: '', eventType: 'initiation', serviceCode: document.getElementById('testCode').value })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d.error) { document.getElementById('phoneScreen').textContent = d.error; return; }
          if (d.type === 'CON') {
            isCon = true;
            document.getElementById('phoneInput').disabled = false;
            document.getElementById('phoneSend').disabled = false;
            document.getElementById('phoneStatus').innerHTML = '<span style="color:#16a34a">&#9679;</span> Active';
          } else {
            isCon = false;
            document.getElementById('phoneInput').disabled = true;
            document.getElementById('phoneSend').disabled = true;
            document.getElementById('phoneStatus').innerHTML = '<span style="color:#ef4444">&#9679;</span> Ended';
          }
          document.getElementById('phoneScreen').textContent = d.text || '';
          addLog('RESPONSE', d.text || '');
        }).catch(function(e) {
          document.getElementById('phoneScreen').textContent = 'Error: ' + e.message;
          addLog('ERROR', e.message);
        });
      }

      function sendInput() {
        var input = document.getElementById('phoneInput').value.trim();
        if (!input || !testSessionId) return;
        var phone = document.getElementById('testPhone').value.trim();
        addLog('INPUT', input);
        document.getElementById('phoneInput').value = '';
        document.getElementById('phoneInput').disabled = true;
        document.getElementById('phoneSend').disabled = true;
        fetch('/ussd/admin/tester', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: testSessionId, phoneNumber: phone, text: input, eventType: 'response', serviceCode: document.getElementById('testCode').value })
        }).then(function(r) { return r.json(); }).then(function(d) {
          if (d.error) { document.getElementById('phoneScreen').textContent = d.error; return; }
          if (d.type === 'CON') {
            isCon = true;
            document.getElementById('phoneInput').disabled = false;
            document.getElementById('phoneSend').disabled = false;
            document.getElementById('phoneStatus').innerHTML = '<span style="color:#16a34a">&#9679;</span> Active';
          } else {
            isCon = false;
            document.getElementById('phoneInput').disabled = true;
            document.getElementById('phoneSend').disabled = true;
            document.getElementById('phoneStatus').innerHTML = '<span style="color:#ef4444">&#9679;</span> Ended';
          }
          document.getElementById('phoneStep').textContent = 'Step: ' + (d.step || 'unknown');
          document.getElementById('phoneScreen').textContent = d.text || '';
          addLog('RESPONSE', d.text || '');
        }).catch(function(e) {
          document.getElementById('phoneScreen').textContent = 'Error: ' + e.message;
          addLog('ERROR', e.message);
        });
      }

      document.getElementById('phoneInput').addEventListener('keydown', function(e) {
        if (e.key === 'Enter') sendInput();
      });

      function addLog(type, text) {
        logEntries.push({ type: type, text: text, time: new Date().toLocaleTimeString() });
        renderLog();
      }

      function renderLog() {
        var html = logEntries.map(function(e) {
          var cls = e.type === 'INPUT' ? '#f59e0b' : e.type === 'ERROR' ? '#ef4444' : '#1a73e8';
          return '<div class="log-entry"><span class="log-step" style="background:' + cls + '">' + esc2(e.type) + '</span><div><span class="muted" style="font-size:10px">' + e.time + '</span><div class="log-text">' + esc2(e.text.substring(0, 120)) + '</div></div></div>';
        }).join('');
        var logEl = document.getElementById('sessionLog');
        logEl.innerHTML = html || '<div class="muted" style="text-align:center;padding:16px;font-size:12px">No entries</div>';
        logEl.scrollTop = logEl.scrollHeight;
      }

      function esc2(s) { var d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
      function clearLog() { logEntries = []; renderLog(); }
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  8. POST /ussd/admin/tester — Handle Tester Input (requires auth + admin)
  // ═══════════════════════════════════════════════════════
  app.post('/ussd/admin/tester', requireAuth, (req, res, next) => {
    const u = req.session.user;
    if (u.role !== 'admin' && u.role !== 'super_admin') return res.status(403).json({ error: 'Admin access required' });
    next();
  }, ah(async (req, res) => {
    try {
      const { sessionId, phoneNumber, text, eventType, serviceCode } = req.body;
      if (!sessionId || !phoneNumber) {
        return res.json({ error: 'Missing sessionId or phoneNumber' });
      }
      const result = await handleUSSD(sessionId, phoneNumber, text || '', eventType || 'response', serviceCode || '');
      // Get updated session step for display
      const sess = (await pool.query(
        `SELECT current_step FROM ussd_sessions WHERE session_id = $1`, [sessionId]
      )).rows[0];
      res.json({
        type: result.type,
        text: result.text,
        step: sess?.current_step || 'unknown'
      });
    } catch (e) {
      console.error('[USSD Tester Error]:', e.message);
      res.json({ error: e.message });
    }
  }));

  // ═══════════════════════════════════════════════════════
  //  9. GET /ussd/admin/logs — USSD Session Logs
  // ═══════════════════════════════════════════════════════
  app.get('/ussd/admin/logs', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { page = 1 } = req.query;
    const off = (parseInt(page) - 1) * PS;

    const [cR, sessR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS t FROM ussd_sessions WHERE tenant_id = $1`, [tid]),
      pool.query(
        `SELECT id, phone_number, session_id, current_step, student_admission_no, student_id,
                menu_history, created_at, last_activity, expires_at
         FROM ussd_sessions WHERE tenant_id = $1
         ORDER BY last_activity DESC LIMIT $2 OFFSET $3`,
        [tid, PS, off]
      )
    ]);

    const tot = cR.rows[0]?.t || 0;
    const sessions = sessR.rows;
    const stepLabels = { home: 'Home', auth: 'Auth', main_menu: 'Main Menu', check_fees: 'Check Fees', check_attendance: 'Check Attendance', check_results: 'Check Results', contact_school: 'Contact School' };

    const rows = sessions.length === 0
      ? '<tr><td colspan="6" class="muted" style="text-align:center;padding:28px">No session logs</td></tr>'
      : sessions.map(s => {
          const isActive = s.expires_at && new Date(s.expires_at) > new Date();
          const hist = (s.menu_history || []).filter(h => h).join(' > ') || '—';
          const dur = s.created_at && s.last_activity
            ? Math.round((new Date(s.last_activity) - new Date(s.created_at)) / 1000) + 's'
            : '—';
          return `<tr>
            <td style="font-family:monospace;font-size:12px">${esc(s.session_id.substring(0, 16))}</td>
            <td>${esc(s.phone_number)}</td>
            <td><span style="color:${isActive ? '#16a34a' : '#9ca3af'}">&#9679;</span> ${stepLabels[s.current_step] || esc(s.current_step)}</td>
            <td class="muted">${esc(s.student_admission_no || '—')}</td>
            <td class="muted" style="font-size:12px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${esc(hist)}">${esc(hist)}</td>
            <td style="display:flex;gap:12px;font-size:12px;white-space:nowrap">
              <span class="muted">Started: ${ago(s.created_at)}</span>
              <span class="muted">Dur: ${dur}</span>
            </td></tr>`;
        }).join('');

    res.send(renderPage('USSD Logs', `${CSS}${nav('logs')}
      <h2>USSD Session Logs</h2>
      <p class="muted" style="margin-bottom:14px">Detailed session history with navigation flow</p>
      <div class="card">
        <div style="margin-bottom:10px;display:flex;justify-content:space-between;align-items:center">
          <span class="muted" style="font-size:13px">${F(tot)} total sessions</span>
          <button class="btn btn-sm btn-red" onclick="if(confirm('Clear all USSD logs for this tenant?'))fetch('/ussd/admin/logs/clear',{method:'POST'}).then(function(){location.reload()})">Clear All Logs</button>
        </div>
        <table class="table"><thead><tr><th>Session ID</th><th>Phone</th><th>Step</th><th>Student</th><th>History</th><th>Timestamps</th></tr></thead>
        <tbody>${rows}</tbody></table>
        ${pag('/ussd/admin/logs', '', page, tot)}
      </div>`, req.session.user, req));
  }));

  // Clear logs endpoint
  app.post('/ussd/admin/logs/clear', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM ussd_sessions WHERE tenant_id = $1`, [tid]);
    req.session.flash = { msg: 'All USSD logs cleared.' };
    res.redirect('/ussd/admin/logs');
  }));

  // ═══════════════════════════════════════════════════════
  //  10. GET /ussd/admin/help — Integration Guide
  // ═══════════════════════════════════════════════════════
  app.get('/ussd/admin/help', requireAuth, ah(async (req, res) => {
    const baseUrl = process.env.BASE_URL || 'https://your-domain.com';

    const helpContent = `
      <div class="card" style="margin-bottom:14px">
        <h3 style="margin:0 0 8px;color:#1a73e8">&#128736; Setup with Africa's Talking</h3>
        <ol style="padding-left:20px;line-height:2;font-size:14px">
          <li>Sign up at <a href="https://africastalking.com" target="_blank" style="color:#1a73e8">africastalking.com</a></li>
          <li>Go to <strong>USSD</strong> in your dashboard and create a channel</li>
          <li>Set the callback URL to:</li>
        </ol>
        <div class="code-block">${baseUrl}/api/v1/ussd</div>
        <p style="font-size:13px;color:#6b7280;margin-top:6px">&#9888; No authentication required — the endpoint validates via session management. Ensure your Africa's Talking account is configured with this URL as the USSD callback.</p>
      </div>

      <div class="card" style="margin-bottom:14px">
        <h3 style="margin:0 0 8px;color:#1a73e8">&#128232; API Request Format</h3>
        <p class="muted" style="margin-bottom:8px;font-size:13px">Africa's Talking sends a POST request with these parameters:</p>
        <div class="code-block">POST /api/v1/ussd
Content-Type: application/x-www-form-urlencoded

{
  <span class="string">"eventType"</span>: <span class="string">"initiation"</span> | <span class="string">"response"</span>,
  <span class="string">"sessionId"</span>: <span class="string">"ATUid_abc123..."</span>,
  <span class="string">"serviceCode"</span>: <span class="string">"*123#"</span>,
  <span class="string">"phoneNumber"</span>: <span class="string">"+256700000000"</span>,
  <span class="string">"text"</span>: <span class="string">""</span> (user input)
}</div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <h3 style="margin:0 0 8px;color:#1a73e8">&#128228; API Response Format</h3>
        <p class="muted" style="margin-bottom:8px;font-size:13px">The endpoint returns plain text responses:</p>
        <div class="code-block"><span class="comment"># Continue the session (show menu)</span>
<span class="keyword">CON</span> Welcome to School Portal
1. English
2. Luganda

<span class="comment"># End the session</span>
<span class="keyword">END</span> Thank you for using our service.</div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <h3 style="margin:0 0 8px;color:#1a73e8">&#128279; How Student Lookup Works</h3>
        <ol style="padding-left:20px;line-height:2;font-size:14px">
          <li>User dials the USSD code and selects a language</li>
          <li>User enters their <strong>admission number</strong> or the phone number is matched to a student's <strong>guardian_phone</strong></li>
          <li>The system looks up the student across your tenant's data</li>
          <li>Once identified, the main menu appears with available features</li>
        </ol>
        <div class="tip" style="background:#eff6ff;border:1px solid #bfdbfe;border-radius:8px;padding:10px 14px;font-size:13px;color:#1e40af;margin-top:10px">
          <strong>Tip:</strong> Make sure students have their <code>admission_no</code> and <code>guardian_phone</code> filled in the Students table for USSD lookup to work.
        </div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <h3 style="margin:0 0 8px;color:#1a73e8">&#128242; USSD Flow Diagram</h3>
        <div style="background:#f8fafc;border:1px solid #e5e7eb;border-radius:8px;padding:16px;font-family:monospace;font-size:13px;line-height:1.8;white-space:pre">DIAL *XXX# &#8594; Language Selection
    &#8594; Enter Admission/Phone
        &#8594; &#10003; Student Found &#8594; Main Menu
            1. Check Fees &#8594; Fee Details
            2. Check Attendance &#8594; Today + Weekly
            3. Check Results &#8594; Latest Exam
            4. Contact School &#8594; Phone/Email/Addr
            0. Exit &#8594; Goodbye
        &#8594; &#10007; Not Found &#8594; Retry</div>
      </div>

      <div class="card" style="margin-bottom:14px">
        <h3 style="margin:0 0 8px;color:#1a73e8">&#9888; Important Notes</h3>
        <ul style="padding-left:20px;line-height:2;font-size:14px">
          <li><strong>Session timeout:</strong> 2 minutes of inactivity. User must restart.</li>
          <li><strong>Character limit:</strong> Each screen is limited to 160 characters (USSD standard).</li>
          <li><strong>No CSRF:</strong> The <code>/api/v1/ussd</code> endpoint skips CSRF checks since it's an external webhook.</li>
          <li><strong>Multi-tenant:</strong> Phone numbers are matched to tenants automatically via guardian_phone or user phone.</li>
          <li><strong>Currency:</strong> Uses the tenant's configured currency (default: UGX).</li>
          <li><strong>Bilingual:</strong> Supports English and Luganda menu labels.</li>
        </ul>
      </div>

      <div class="card">
        <h3 style="margin:0 0 8px;color:#1a73e8">&#128736; Testing with cURL</h3>
        <div class="code-block">curl -X POST ${baseUrl}/api/v1/ussd \\
  -H "Content-Type: application/json" \\
  -d '{
    <span class="string">"eventType"</span>: <span class="string">"initiation"</span>,
    <span class="string">"sessionId"</span>: <span class="string">"test_session_001"</span>,
    <span class="string">"serviceCode"</span>: <span class="string">"*123#"</span>,
    <span class="string">"phoneNumber"</span>: <span class="string">"+256700000000"</span>,
    <span class="string">"text"</span>: <span class="string">""</span>
  }'

<span class="comment"># Then continue the session:</span>
curl -X POST ${baseUrl}/api/v1/ussd \\
  -H "Content-Type: application/json" \\
  -d '{
    <span class="string">"eventType"</span>: <span class="string">"response"</span>,
    <span class="string">"sessionId"</span>: <span class="string">"test_session_001"</span>,
    <span class="string">"serviceCode"</span>: <span class="string">"*123#"</span>,
    <span class="string">"phoneNumber"</span>: <span class="string">"+256700000000"</span>,
    <span class="string">"text"</span>: <span class="string">"1"</span>
  }'</div>
      </div>
    `;

    res.send(renderPage('USSD Integration Guide', `${CSS}${nav('help')}
      <h2>USSD Integration Guide</h2>
      <p class="muted" style="margin-bottom:18px">Complete documentation for setting up and integrating the USSD portal with Africa's Talking</p>
      ${helpContent}`, req.session.user, req));
  }));
};
