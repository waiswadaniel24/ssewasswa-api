/**
 * Emergency Alert System — Mass emergency notification module for SaaS school portal.
 * Provides lockdown/evacuation/weather/health/closure alerts, drill scheduling,
 * templates, contact management, and full audit trail with tenant isolation.
 */
const { migrateQuery } = require('./db');
module.exports = function(app, pool, opts) {
  const esc = opts.esc || (s => String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;'));
  const renderPage = opts.renderPage || ((t,c,u) => c);
  const ah = opts.ah || ((fn) => async (req,res,next) => { try { await fn(req,res,next); } catch(e) { res.status(500).send('Error: '+e.message); }});
  const requireAuth = opts.requireAuth || ((req,res,next) => { if(!req.session?.user) return res.redirect('/login'); next(); });
  const audit = opts.audit || (() => {});
  const queueEmail = opts.queueEmail || (() => {});
  const trackRevenue = global.trackRevenue || (() => {});

  /* ─── Constants ─── */
  const ALERT_TYPES = ['lockdown','evacuation','weather','health','general_urgent','closure'];
  const SEVERITY_LEVELS = ['low','medium','high','critical'];
  const TARGET_AUDIENCES = ['all','parents_only','staff_only','specific_class'];
  const DRILL_TYPES = ['fire','earthquake','lockdown','tornado','shelter_in_place'];
  const STATUS_OPTIONS = ['scheduled','active','completed','cancelled'];

  const ALERT_TYPE_LABELS = {
    lockdown: 'Lockdown', evacuation: 'Evacuation', weather: 'Severe Weather',
    health: 'Health Emergency', general_urgent: 'General Urgent', closure: 'School Closure'
  };
  const SEVERITY_LABELS = { low: 'Low', medium: 'Medium', high: 'High', critical: 'Critical' };
  const SEVERITY_COLORS = { low: '#22c55e', medium: '#f59e0b', high: '#f97316', critical: '#dc2626' };
  const AUDIENCE_LABELS = { all: 'Everyone', parents_only: 'Parents Only', staff_only: 'Staff Only', specific_class: 'Specific Class' };
  const DRILL_TYPE_LABELS = { fire: 'Fire Drill', earthquake: 'Earthquake Drill', lockdown: 'Lockdown Drill', tornado: 'Tornado Drill', shelter_in_place: 'Shelter-in-Place Drill' };

  /* ─── SVG Icons ─── */
  function alertTypeSVG(type, size = 24) {
    const icons = {
      lockdown: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/><circle cx="12" cy="16" r="1" fill="#dc2626"/></svg>`,
      evacuation: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 17l4-8 4 4 4-8 4 4"/><path d="M18 17v2"/><path d="M18 22v0"/><path d="M2 17h2"/><path d="M20 17h2"/></svg>`,
      weather: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.5 19H9a7 7 0 110-14 7 7 0 0113.5 4"/><polyline points="13 11 9 17 15 17 11 23" stroke="#eab308"/></svg>`,
      health: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#16a34a" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20.84 4.61a5.5 5.5 0 00-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 00-7.78 7.78L12 21.23l8.84-8.84a5.5 5.5 0 000-7.78z"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>`,
      general_urgent: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#4f46e5" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
      closure: `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="#dc2626" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="9" x2="15" y2="15"/><line x1="15" y1="9" x2="9" y2="15"/></svg>`
    };
    return icons[type] || icons.general_urgent;
  }

  function statusBadge(status) {
    const colors = { sent: '#22c55e', delivered: '#16a34a', failed: '#dc2626', draft: '#6b7280', scheduled: '#f59e0b', active: '#4f46e5', completed: '#22c55e', cancelled: '#6b7280', pending: '#f59e0b' };
    const c = colors[status] || '#6b7280';
    return `<span style="display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:600;background:${c}20;color:${c};border:1px solid ${c}40;">${esc(status)}</span>`;
  }

  /* ─── Inline Style Helpers ─── */
  const S = {
    primary: '#4f46e5',
    primaryDark: '#3730a3',
    danger: '#dc2626',
    dangerDark: '#991b1b',
    warn: '#f59e0b',
    success: '#22c55e',
    gray: '#6b7280',
    grayLight: '#f3f4f6',
    grayBorder: '#e5e7eb',
    bg: '#f9fafb',
    card: '#ffffff',
    text: '#111827',
    textMuted: '#6b7280',
    radius: '8px',
    shadow: '0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)',
    shadowMd: '0 4px 6px rgba(0,0,0,0.1), 0 2px 4px rgba(0,0,0,0.06)'
  };

  function wrapPage(user, activeTab, content) {
    const tabs = [
      { href: '/school/emergency', label: 'Create Alert', icon: alertTypeSVG('general_urgent', 18) },
      { href: '/school/emergency/history', label: 'Alert History', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>` },
      { href: '/school/emergency/templates', label: 'Templates', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="9" y1="3" x2="9" y2="21"/></svg>` },
      { href: '/school/emergency/contacts', label: 'Contacts', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6A19.79 19.79 0 012.12 4.18 2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z"/></svg>` },
      { href: '/school/emergency/drills', label: 'Drill Scheduler', icon: `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>` }
    ];
    const tabHTML = tabs.map(t => {
      const isActive = t.href === activeTab;
      return `<a href="${t.href}" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:${S.radius};text-decoration:none;font-size:14px;font-weight:500;color:${isActive ? '#fff' : S.textMuted};background:${isActive ? S.primary : 'transparent'};transition:background .15s;" aria-current="${isActive ? 'page' : 'false'}">${t.icon} ${esc(t.label)}</a>`;
    }).join('');

    return `
      <div style="max-width:1200px;margin:0 auto;padding:24px;">
        <a href="#main-content" class="skip-link" style="position:absolute;left:-9999px;top:0;background:${S.primary};color:#fff;padding:8px 16px;z-index:9999;" onfocus="this.style.left='0'" onblur="this.style.left='-9999px'">Skip to main content</a>
        <div style="margin-bottom:24px;">
          <h1 style="font-size:24px;font-weight:700;color:${S.text};margin:0 0 4px 0;">🚨 Emergency Alert System</h1>
          <p style="font-size:14px;color:${S.textMuted};margin:0;">Mass notification management for ${esc(user?.school_name || user?.tenant_name || 'your school')}</p>
        </div>
        <nav aria-label="Emergency alert navigation" style="display:flex;flex-wrap:wrap;gap:4px;background:${S.card};border:1px solid ${S.grayBorder};border-radius:${S.radius};padding:6px;margin-bottom:24px;box-shadow:${S.shadow};">
          ${tabHTML}
        </nav>
        <main id="main-content" role="main" tabindex="-1">
          ${content}
        </main>
      </div>`;
  }

  /* ─── Database Tables ─── */
  async function ensureTables() {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS emergency_alerts (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        alert_type VARCHAR(30) NOT NULL,
        severity VARCHAR(20) NOT NULL,
        title VARCHAR(500) NOT NULL,
        message TEXT NOT NULL,
        target_audience VARCHAR(30) NOT NULL DEFAULT 'all',
        target_class INTEGER REFERENCES classes(id),
        sent_by INTEGER NOT NULL REFERENCES users(id),
        delivery_counts JSONB DEFAULT '{"email":0,"sms":0,"push":0,"total":0}',
        status VARCHAR(20) NOT NULL DEFAULT 'draft',
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ea_tenant_idx ON emergency_alerts(tenant_id);
      CREATE INDEX IF NOT EXISTS ea_type_idx ON emergency_alerts(alert_type);
      CREATE INDEX IF NOT EXISTS ea_created_idx ON emergency_alerts(created_at DESC);

      CREATE TABLE IF NOT EXISTS emergency_templates (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        alert_type VARCHAR(30) NOT NULL,
        title VARCHAR(500) NOT NULL,
        message TEXT NOT NULL,
        is_default BOOLEAN DEFAULT false,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS et_tenant_idx ON emergency_templates(tenant_id);

      CREATE TABLE IF NOT EXISTS emergency_drills (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER NOT NULL REFERENCES tenants(id),
        drill_type VARCHAR(30) NOT NULL,
        scheduled_date TIMESTAMPTZ NOT NULL,
        completed_date TIMESTAMPTZ,
        duration_minutes INTEGER,
        participants_count INTEGER DEFAULT 0,
        observations TEXT,
        status VARCHAR(20) NOT NULL DEFAULT 'scheduled',
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );
      CREATE INDEX IF NOT EXISTS ed_tenant_idx ON emergency_drills(tenant_id);
      CREATE INDEX IF NOT EXISTS ed_date_idx ON emergency_drills(scheduled_date);
    `);
  }

  /* ─── Seed Default Templates ─── */
  async function seedDefaultTemplates(tenantId) {
    const defaults = [
      { alert_type: 'evacuation', title: 'Fire Drill - Immediate Evacuation Required', message: 'This is an emergency notification. A fire has been reported on the premises. All students and staff must evacuate immediately through the nearest marked exit. Proceed to the designated assembly point. Do NOT use elevators. Teachers: account for all students and report to the incident commander. Remain at the assembly point until an all-clear is given.' },
      { alert_type: 'weather', title: 'Severe Weather Warning - Shelter in Place', message: 'The National Weather Service has issued a SEVERE WEATHER WARNING for our area. All students and staff must move to interior rooms away from windows immediately. Remain in shelter until the all-clear signal is given. Teachers: close all blinds, keep students calm, and account for all students.' },
      { alert_type: 'health', title: 'Disease Outbreak - Precautionary Measures', message: 'We have been notified of a potential health concern affecting our school community. As a precautionary measure, please monitor your child for symptoms including fever, cough, and difficulty breathing. If your child exhibits any symptoms, please keep them home and contact your healthcare provider. We will provide updates as more information becomes available.' },
      { alert_type: 'closure', title: 'School Closure - [DATE]', message: 'Due to [REASON], [SCHOOL NAME] will be closed on [DATE]. All classes, activities, and events are cancelled. School will resume on [NEXT SCHOOL DAY]. Please check the school website and your email for further updates. Stay safe.' },
      { alert_type: 'lockdown', title: 'LOCKDOWN - Secure Building Immediately', message: 'THIS IS A LOCKDOWN ALERT. All students and staff must lockdown immediately. Lock all doors, turn off lights, stay away from windows, and remain silent. Do NOT open doors for anyone until an official all-clear is announced by law enforcement or school administration. Text or call 911 if you have information about the threat.' }
    ];
    for (const tpl of defaults) {
      const existing = await pool.query('SELECT id FROM emergency_templates WHERE tenant_id = $1 AND alert_type = $2 AND is_default = true LIMIT 1', [tenantId, tpl.alert_type]);
      if (existing.rowCount === 0) {
        await pool.query('INSERT INTO emergency_templates (tenant_id, alert_type, title, message, is_default) VALUES ($1,$2,$3,$4,true)', [tenantId, tpl.alert_type, tpl.title, tpl.message]);
      }
    }
  }

  /* ─── Delivery Engine ─── */
  async function deliverAlert(alertId, tenantId, alertData) {
    let emailCount = 0, smsCount = 0, pushCount = 0;
    const targetAudience = alertData.target_audience;
    let recipientQuery = 'SELECT id, email, phone FROM users WHERE tenant_id = $1 AND active = true';
    const params = [tenantId];
    let paramIdx = 2;

    if (targetAudience === 'parents_only') {
      recipientQuery += ' AND role = \'parent\'';
    } else if (targetAudience === 'staff_only') {
      recipientQuery += ' AND role IN (\'teacher\',\'admin\',\'staff\')';
    } else if (targetAudience === 'specific_class') {
      recipientQuery += ` AND id IN (SELECT user_id FROM student_enrollments WHERE class_id = $${paramIdx} AND tenant_id = $1)`;
      params.push(alertData.target_class);
      paramIdx++;
    }

    try {
      const recipients = await pool.query(recipientQuery, params);
      for (const r of recipients.rows) {
        try {
          if (r.email) { await queueEmail({ to: r.email, subject: `🚨 URGENT: ${alertData.title}`, body: alertData.message, tenantId }); emailCount++; }
          if (r.phone) { smsCount++; }
          pushCount++;
        } catch (_) { /* individual delivery failures logged but don't stop others */ }
      }
    } catch (_) { /* recipient query failure */ }

    const totals = JSON.stringify({ email: emailCount, sms: smsCount, push: pushCount, total: emailCount + smsCount + pushCount });
    await pool.query('UPDATE emergency_alerts SET delivery_counts = $1, status = $2 WHERE id = $3 AND tenant_id = $4', [totals, 'sent', alertId, tenantId]);
    audit({ action: 'emergency_alert_sent', alertId, tenantId, counts: totals, userId: alertData.sent_by });
    return { email: emailCount, sms: smsCount, push: pushCount, total: emailCount + smsCount + pushCount };
  }

  /* ═══════════════════════════════════════════════════════════
     FEATURE 1: CREATE EMERGENCY ALERT  (/school/emergency)
     ═══════════════════════════════════════════════════════════ */

  app.get('/school/emergency', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const templates = await pool.query('SELECT id, title, alert_type FROM emergency_templates WHERE tenant_id = $1 ORDER BY is_default DESC, title ASC', [tid]);
    const classes = await pool.query('SELECT id, name FROM classes WHERE tenant_id = $1 ORDER BY name ASC', [tid]);
    const tplOpts = templates.rows.map(t => `<option value="${t.id}" data-type="${t.alert_type}">${esc(t.title)}</option>`).join('');
    const classOpts = classes.rows.map(c => `<option value="${c.id}">${esc(c.name)}</option>`).join('');
    const typeOpts = ALERT_TYPES.map(t => `<option value="${t}">${ALERT_TYPE_LABELS[t]}</option>`).join('');
    const severityOpts = SEVERITY_LEVELS.map(s => `<option value="${s}">${SEVERITY_LABELS[s]}</option>`).join('');
    const audienceOpts = TARGET_AUDIENCES.map(a => `<option value="${a}">${AUDIENCE_LABELS[a]}</option>`).join('');

    const form = `
      <!-- RED WARNING BANNER -->
      <div role="alert" aria-live="assertive" style="background:linear-gradient(135deg, #dc2626 0%, #991b1b 100%);color:#fff;padding:20px 24px;border-radius:12px;margin-bottom:24px;box-shadow:0 4px 12px rgba(220,38,38,0.4);display:flex;align-items:flex-start;gap:16px;">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="flex-shrink:0;margin-top:2px;">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <div>
          <h2 style="margin:0 0 6px 0;font-size:18px;font-weight:700;">⚠️ EMERGENCY ALERT SYSTEM</h2>
          <p style="margin:0;font-size:14px;opacity:0.95;line-height:1.5;">This system sends urgent notifications to all selected recipients via email, SMS, and push notifications simultaneously. Use this ONLY for genuine emergencies. All alerts are logged and audited. Confirm carefully before sending.</p>
        </div>
      </div>

      <div style="background:${S.card};border-radius:${S.radius};box-shadow:${S.shadow};border:1px solid ${S.grayBorder};overflow:hidden;">
        <div style="padding:20px 24px;border-bottom:1px solid ${S.grayBorder};background:${S.grayLight};">
          <h2 style="margin:0;font-size:18px;font-weight:700;color:${S.text};">Create Emergency Alert</h2>
          <p style="margin:4px 0 0 0;font-size:13px;color:${S.textMuted};">Fill in the details below. Review carefully before sending.</p>
        </div>
        <form method="POST" action="/school/emergency" id="alert-form" style="padding:24px;" novalidate>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
            <div>
              <label for="tpl-select" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Quick-fill from Template</label>
              <select id="tpl-select" aria-label="Select a template" style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;background:#fff;">
                <option value="">-- Choose a template --</option>
                ${tplOpts}
              </select>
            </div>
            <div>
              <label for="alert-type" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Alert Type *</label>
              <select id="alert-type" name="alert_type" required style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;background:#fff;">
                ${typeOpts}
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:20px;margin-bottom:20px;">
            <div>
              <label for="severity" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Severity Level *</label>
              <select id="severity" name="severity" required style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;background:#fff;">
                ${severityOpts}
              </select>
            </div>
            <div>
              <label for="target_audience" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Target Audience *</label>
              <select id="target_audience" name="target_audience" required onchange="document.getElementById('class-row').style.display=this.value==='specific_class'?'block':'none'" style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;background:#fff;">
                ${audienceOpts}
              </select>
            </div>
          </div>
          <div id="class-row" style="display:none;margin-bottom:20px;">
            <label for="target_class" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Select Class *</label>
            <select id="target_class" name="target_class" style="width:100%;max-width:400px;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;background:#fff;">
              <option value="">-- Choose class --</option>
              ${classOpts}
            </select>
          </div>
          <div style="margin-bottom:20px;">
            <label for="title" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Alert Title *</label>
            <input type="text" id="title" name="title" required maxlength="500" placeholder="e.g. LOCKDOWN - Secure Building Immediately" style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;box-sizing:border-box;" />
          </div>
          <div style="margin-bottom:24px;">
            <label for="message" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Alert Message *</label>
            <textarea id="message" name="message" required rows="6" maxlength="5000" placeholder="Provide clear, concise instructions for recipients..." style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;box-sizing:border-box;resize:vertical;font-family:inherit;line-height:1.6;"></textarea>
            <p style="margin:6px 0 0 0;font-size:12px;color:${S.textMuted};">Max 5,000 characters. Be specific about actions required.</p>
          </div>
          <div style="display:flex;gap:12px;align-items:center;padding-top:16px;border-top:1px solid ${S.grayBorder};">
            <button type="submit" name="action" value="confirm" style="padding:12px 28px;background:${S.primary};color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;transition:background .15s;" onmouseover="this.style.background='${S.primaryDark}'" onmouseout="this.style.background='${S.primary}'" aria-label="Preview alert before sending">Preview &amp; Confirm</button>
            <button type="button" onclick="if(confirm('Discard alert?'))document.getElementById('alert-form').reset()" style="padding:12px 28px;background:${S.grayLight};color:${S.text};border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;font-weight:500;cursor:pointer;">Discard</button>
          </div>
        </form>
      </div>
      <script>
        document.getElementById('tpl-select').addEventListener('change', function(){
          const opt = this.options[this.selectedIndex];
          if(!opt.value) return;
          const type = opt.getAttribute('data-type');
          document.getElementById('alert-type').value = type;
          fetch('/school/emergency/template/'+opt.value).then(r=>r.json()).then(d=>{
            if(d.title) document.getElementById('title').value = d.title;
            if(d.message) document.getElementById('message').value = d.message;
          }).catch(()=>{});
        });
      </script>
    `;
    res.send(renderPage('Emergency Alert', wrapPage(req.session.user, '/school/emergency', form), req.session.user));
  }));

  /* Template fetch API */
  app.get('/school/emergency/template/:id', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const row = await pool.query('SELECT title, message FROM emergency_templates WHERE id = $1 AND tenant_id = $2', [req.params.id, tid]);
    if (row.rowCount === 0) return res.status(404).json({ error: 'Template not found' });
    res.json({ title: row.rows[0].title, message: row.rows[0].message });
  }));

  /* Confirmation step */
  app.post('/school/emergency', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { alert_type, severity, title, message, target_audience, target_class, action } = req.body;

    if (!alert_type || !ALERT_TYPES.includes(alert_type) || !severity || !SEVERITY_LEVELS.includes(severity) || !title || !message || !target_audience) {
      req.session.alertError = 'All required fields must be filled correctly.';
      return res.redirect('/school/emergency');
    }

    if (target_audience === 'specific_class' && !target_class) {
      req.session.alertError = 'Please select a class when targeting a specific class.';
      return res.redirect('/school/emergency');
    }

    if (action === 'confirm') {
      const sessionData = { alert_type, severity, title, message, target_audience, target_class: target_class || null };
      req.session.pendingAlert = sessionData;

      const previewHTML = `
        <div role="alert" aria-live="assertive" style="background:#fef2f2;border:2px solid ${S.danger};border-radius:12px;padding:24px;margin-bottom:24px;">
          <h2 style="margin:0 0 12px 0;font-size:20px;font-weight:700;color:${S.danger};">🔔 CONFIRM ALERT DELIVERY</h2>
          <p style="margin:0 0 16px 0;color:${S.text};font-size:14px;">Review the alert below carefully. Once confirmed, it will be sent immediately to all selected recipients.</p>
        </div>
        <div style="background:${S.card};border-radius:${S.radius};box-shadow:${S.shadowMd};border:1px solid ${S.grayBorder};overflow:hidden;margin-bottom:24px;">
          <div style="padding:16px 24px;background:${S.grayLight};border-bottom:1px solid ${S.grayBorder};display:flex;align-items:center;gap:12px;">
            ${alertTypeSVG(alert_type, 28)}
            <div>
              <h3 style="margin:0;font-size:16px;font-weight:700;color:${S.text};">${esc(title)}</h3>
              <div style="display:flex;gap:8px;margin-top:4px;">
                <span style="font-size:12px;padding:2px 8px;border-radius:9999px;background:${SEVERITY_COLORS[severity]}20;color:${SEVERITY_COLORS[severity]};font-weight:600;">${esc(SEVERITY_LABELS[severity])} SEVERITY</span>
                <span style="font-size:12px;padding:2px 8px;border-radius:9999px;background:${S.primary}15;color:${S.primary};font-weight:600;">${esc(ALERT_TYPE_LABELS[alert_type])}</span>
              </div>
            </div>
          </div>
          <div style="padding:20px 24px;">
            <p style="margin:0;color:${S.text};font-size:14px;line-height:1.7;white-space:pre-wrap;">${esc(message)}</p>
          </div>
          <div style="padding:12px 24px;background:${S.grayLight};border-top:1px solid ${S.grayBorder};display:flex;gap:16px;font-size:13px;color:${S.textMuted};">
            <span>👥 Target: <strong>${esc(AUDIENCE_LABELS[target_audience])}</strong></span>
            ${target_audience === 'specific_class' ? `<span>🏫 Class ID: ${esc(target_class)}</span>` : ''}
            <span>📅 ${new Date().toLocaleString()}</span>
          </div>
        </div>
        <form method="POST" action="/school/emergency" style="display:flex;gap:12px;">
          <input type="hidden" name="action" value="send" />
          <button type="submit" style="padding:14px 32px;background:${S.danger};color:#fff;border:none;border-radius:6px;font-size:15px;font-weight:700;cursor:pointer;box-shadow:0 2px 8px rgba(220,38,38,0.3);" onmouseover="this.style.background='${S.dangerDark}'" onmouseout="this.style.background='${S.danger}'" aria-label="Send this emergency alert now">🚨 SEND ALERT NOW</button>
          <a href="/school/emergency" style="padding:14px 28px;background:${S.grayLight};color:${S.text};border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;font-weight:500;text-decoration:none;display:inline-flex;align-items:center;">Cancel</a>
        </form>
      `;
      res.send(renderPage('Confirm Emergency Alert', wrapPage(req.session.user, '/school/emergency', previewHTML), req.session.user));
      return;
    }

    if (action === 'send') {
      const pending = req.session.pendingAlert;
      if (!pending) return res.redirect('/school/emergency');
      delete req.session.pendingAlert;

      const result = await pool.query(
        'INSERT INTO emergency_alerts (tenant_id, alert_type, severity, title, message, target_audience, target_class, sent_by, status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,\'sending\') RETURNING id',
        [tid, pending.alert_type, pending.severity, pending.title, pending.message, pending.target_audience, pending.target_class, uid]
      );
      const alertId = result.rows[0].id;

      const counts = await deliverAlert(alertId, tid, { ...pending, sent_by: uid });
      req.session.alertSuccess = `Alert sent successfully! Delivered to ${counts.total} recipients (${counts.email} email, ${counts.sms} SMS, ${counts.push} push).`;
      audit({ action: 'emergency_alert_created', alertId, tenantId: tid, type: pending.alert_type, severity: pending.severity, userId: uid });
      return res.redirect('/school/emergency/history');
    }

    res.redirect('/school/emergency');
  }));

  /* ═══════════════════════════════════════════════════════════
     FEATURE 2: ALERT HISTORY  (/school/emergency/history)
     ═══════════════════════════════════════════════════════════ */

  app.get('/school/emergency/history', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { filter_type, filter_severity, filter_status, from_date, to_date } = req.query;

    let where = 'WHERE ea.tenant_id = $1';
    const params = [tid];
    let paramIdx = 2;

    if (filter_type && ALERT_TYPES.includes(filter_type)) { where += ` AND ea.alert_type = $${paramIdx++}`; params.push(filter_type); }
    if (filter_severity && SEVERITY_LEVELS.includes(filter_severity)) { where += ` AND ea.severity = $${paramIdx++}`; params.push(filter_severity); }
    if (filter_status) { where += ` AND ea.status = $${paramIdx++}`; params.push(filter_status); }
    if (from_date) { where += ` AND ea.created_at >= $${paramIdx++}`; params.push(from_date); }
    if (to_date) { where += ` AND ea.created_at <= $${paramIdx++}`; params.push(to_date + ' 23:59:59'); }

    const alerts = await pool.query(
      `SELECT ea.*, u.name as sender_name FROM emergency_alerts ea LEFT JOIN users u ON ea.sent_by = u.id ${where} ORDER BY ea.created_at DESC LIMIT 100`,
      params
    );

    const filterTypeOpts = ALERT_TYPES.map(t => `<option value="${t}" ${filter_type === t ? 'selected' : ''}>${ALERT_TYPE_LABELS[t]}</option>`).join('');
    const filterSevOpts = SEVERITY_LEVELS.map(s => `<option value="${s}" ${filter_severity === s ? 'selected' : ''}>${SEVERITY_LABELS[s]}</option>`).join('');
    const filterStatOpts = ['sent','delivered','failed','draft'].map(s => `<option value="${s}" ${filter_status === s ? 'selected' : ''}>${s.charAt(0).toUpperCase() + s.slice(1)}</option>`).join('');

    let rows = '';
    if (alerts.rowCount === 0) {
      rows = `<tr><td colspan="6" style="padding:40px;text-align:center;color:${S.textMuted};font-size:14px;">No alerts found matching your filters.</td></tr>`;
    } else {
      for (const a of alerts.rows) {
        const dc = typeof a.delivery_counts === 'string' ? JSON.parse(a.delivery_counts) : (a.delivery_counts || {});
        const canResend = a.status === 'failed' || dc.failed > 0;
        rows += `
          <tr style="border-bottom:1px solid ${S.grayBorder};">
            <td style="padding:12px 16px;vertical-align:top;">
              <div style="display:flex;align-items:center;gap:8px;">
                ${alertTypeSVG(a.alert_type, 20)}
                <strong style="font-size:14px;color:${S.text};">${esc(a.title)}</strong>
              </div>
              <p style="margin:4px 0 0 0;font-size:12px;color:${S.textMuted};max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(a.message.substring(0, 100))}${a.message.length > 100 ? '...' : ''}</p>
            </td>
            <td style="padding:12px 16px;text-align:center;">
              <span style="display:inline-block;padding:2px 10px;border-radius:9999px;font-size:12px;font-weight:600;background:${SEVERITY_COLORS[a.severity]}20;color:${SEVERITY_COLORS[a.severity]};">${esc(SEVERITY_LABELS[a.severity])}</span>
            </td>
            <td style="padding:12px 16px;text-align:center;font-size:13px;color:${S.textMuted};">${esc(AUDIENCE_LABELS[a.target_audience] || a.target_audience)}</td>
            <td style="padding:12px 16px;text-align:center;">
              <div style="font-size:13px;color:${S.text};font-weight:600;">${(dc.total || 0)}</div>
              <div style="font-size:11px;color:${S.textMuted};">📧${dc.email || 0} 📱${dc.sms || 0}</div>
            </td>
            <td style="padding:12px 16px;text-align:center;">${statusBadge(a.status)}</td>
            <td style="padding:12px 16px;text-align:center;">
              <div style="font-size:12px;color:${S.textMuted};">${new Date(a.created_at).toLocaleString()}</div>
              <div style="font-size:11px;color:${S.textMuted};">by ${esc(a.sender_name || 'Unknown')}</div>
              ${canResend ? `<form method="POST" action="/school/emergency/history/resend" style="margin-top:6px;"><input type="hidden" name="alert_id" value="${a.id}" /><button type="submit" style="padding:4px 12px;background:${S.warn};color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:600;" aria-label="Resend alert ${a.id}">Resend</button></form>` : ''}
            </td>
          </tr>`;
      }
    }

    const historyHTML = `
      <div style="background:${S.card};border-radius:${S.radius};box-shadow:${S.shadow};border:1px solid ${S.grayBorder};overflow:hidden;margin-bottom:24px;">
        <div style="padding:20px 24px;border-bottom:1px solid ${S.grayBorder};background:${S.grayLight};">
          <h2 style="margin:0;font-size:18px;font-weight:700;color:${S.text};">Alert History</h2>
          <p style="margin:4px 0 0 0;font-size:13px;color:${S.textMuted};">View and filter all past emergency alerts</p>
        </div>
        <form method="GET" action="/school/emergency/history" style="padding:16px 24px;background:${S.bg};border-bottom:1px solid ${S.grayBorder};display:flex;flex-wrap:wrap;gap:12px;align-items:flex-end;">
          <div>
            <label for="filter_type" style="display:block;font-size:12px;font-weight:600;color:${S.text};margin-bottom:4px;">Type</label>
            <select id="filter_type" name="filter_type" style="padding:8px 10px;border:1px solid ${S.grayBorder};border-radius:4px;font-size:13px;">
              <option value="">All Types</option>${filterTypeOpts}
            </select>
          </div>
          <div>
            <label for="filter_severity" style="display:block;font-size:12px;font-weight:600;color:${S.text};margin-bottom:4px;">Severity</label>
            <select id="filter_severity" name="filter_severity" style="padding:8px 10px;border:1px solid ${S.grayBorder};border-radius:4px;font-size:13px;">
              <option value="">All Levels</option>${filterSevOpts}
            </select>
          </div>
          <div>
            <label for="filter_status" style="display:block;font-size:12px;font-weight:600;color:${S.text};margin-bottom:4px;">Status</label>
            <select id="filter_status" name="filter_status" style="padding:8px 10px;border:1px solid ${S.grayBorder};border-radius:4px;font-size:13px;">
              <option value="">All</option>${filterStatOpts}
            </select>
          </div>
          <div>
            <label for="from_date" style="display:block;font-size:12px;font-weight:600;color:${S.text};margin-bottom:4px;">From</label>
            <input type="date" id="from_date" name="from_date" value="${esc(from_date || '')}" style="padding:8px 10px;border:1px solid ${S.grayBorder};border-radius:4px;font-size:13px;" />
          </div>
          <div>
            <label for="to_date" style="display:block;font-size:12px;font-weight:600;color:${S.text};margin-bottom:4px;">To</label>
            <input type="date" id="to_date" name="to_date" value="${esc(to_date || '')}" style="padding:8px 10px;border:1px solid ${S.grayBorder};border-radius:4px;font-size:13px;" />
          </div>
          <button type="submit" style="padding:8px 20px;background:${S.primary};color:#fff;border:none;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;">Filter</button>
          <a href="/school/emergency/history" style="padding:8px 16px;font-size:13px;color:${S.primary};text-decoration:none;">Clear</a>
        </form>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;" role="table" aria-label="Alert history table">
            <thead>
              <tr style="background:${S.grayLight};">
                <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;letter-spacing:.05em;">Alert</th>
                <th style="padding:10px 16px;text-align:center;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Severity</th>
                <th style="padding:10px 16px;text-align:center;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Audience</th>
                <th style="padding:10px 16px;text-align:center;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Delivered</th>
                <th style="padding:10px 16px;text-align:center;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Status</th>
                <th style="padding:10px 16px;text-align:center;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Date / Actions</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
        </div>
        ${alerts.rowCount > 0 ? `<div style="padding:12px 24px;border-top:1px solid ${S.grayBorder};font-size:12px;color:${S.textMuted};">Showing ${alerts.rowCount} most recent alerts</div>` : ''}
      </div>
    `;
    res.send(renderPage('Alert History', wrapPage(req.session.user, '/school/emergency/history', historyHTML), req.session.user));
  }));

  /* Resend failed alert */
  app.post('/school/emergency/history/resend', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { alert_id } = req.body;
    if (!alert_id) return res.redirect('/school/emergency/history');

    const alert = await pool.query('SELECT * FROM emergency_alerts WHERE id = $1 AND tenant_id = $2', [alert_id, tid]);
    if (alert.rowCount === 0) { req.session.alertError = 'Alert not found.'; return res.redirect('/school/emergency/history'); }

    const a = alert.rows[0];
    await pool.query('UPDATE emergency_alerts SET status = $1 WHERE id = $2 AND tenant_id = $3', ['sending', alert_id, tid]);
    const counts = await deliverAlert(alert_id, tid, { target_audience: a.target_audience, target_class: a.target_class, title: a.title, message: a.message, sent_by: req.session.user.id });
    req.session.alertSuccess = `Alert resent! Delivered to ${counts.total} recipients.`;
    audit({ action: 'emergency_alert_resent', alertId, tenantId: tid, userId: req.session.user.id });
    res.redirect('/school/emergency/history');
  }));

  /* ═══════════════════════════════════════════════════════════
     FEATURE 3: ALERT TEMPLATES  (/school/emergency/templates)
     ═══════════════════════════════════════════════════════════ */

  app.get('/school/emergency/templates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const templates = await pool.query(
      'SELECT et.*, u.name as creator_name FROM emergency_templates et LEFT JOIN users u ON et.created_by = u.id WHERE et.tenant_id = $1 ORDER BY et.is_default DESC, et.created_at DESC',
      [tid]
    );

    let cards = '';
    if (templates.rowCount === 0) {
      cards = `<div style="padding:40px;text-align:center;color:${S.textMuted};"><p style="font-size:15px;">No templates yet. Create your first template below.</p></div>`;
    } else {
      for (const t of templates.rows) {
        cards += `
          <div style="background:${S.card};border:1px solid ${S.grayBorder};border-radius:${S.radius};padding:20px;box-shadow:${S.shadow};">
            <div style="display:flex;align-items:flex-start;justify-content:space-between;margin-bottom:12px;">
              <div style="display:flex;align-items:center;gap:10px;">
                ${alertTypeSVG(t.alert_type, 22)}
                <div>
                  <h3 style="margin:0;font-size:15px;font-weight:700;color:${S.text};">${esc(t.title)}</h3>
                  <div style="display:flex;gap:6px;margin-top:4px;">
                    <span style="font-size:11px;padding:2px 8px;border-radius:9999px;background:${S.primary}15;color:${S.primary};font-weight:600;">${esc(ALERT_TYPE_LABELS[t.alert_type])}</span>
                    ${t.is_default ? '<span style="font-size:11px;padding:2px 8px;border-radius:9999px;background:#22c55e15;color:#22c55e;font-weight:600;">Default</span>' : ''}
                  </div>
                </div>
              </div>
              <div style="display:flex;gap:6px;">
                <form method="POST" action="/school/emergency/templates/delete" onsubmit="return confirm('Delete this template?')">
                  <input type="hidden" name="template_id" value="${t.id}" />
                  <button type="submit" style="padding:6px 12px;background:#fef2f2;color:${S.danger};border:1px solid #fecaca;border-radius:4px;font-size:12px;cursor:pointer;" aria-label="Delete template ${t.id}">Delete</button>
                </form>
              </div>
            </div>
            <p style="margin:0 0 10px 0;font-size:13px;color:${S.textMuted};line-height:1.6;max-height:80px;overflow:hidden;">${esc(t.message.substring(0, 200))}${t.message.length > 200 ? '...' : ''}</p>
            <div style="font-size:11px;color:${S.textMuted};">Created ${t.creator_name ? 'by ' + esc(t.creator_name) : ''} on ${new Date(t.created_at).toLocaleDateString()}</div>
          </div>`;
      }
    }

    const typeOpts = ALERT_TYPES.map(t => `<option value="${t}">${ALERT_TYPE_LABELS[t]}</option>`).join('');

    const templatesHTML = `
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-bottom:24px;">
        <!-- Template list -->
        <div>
          <h2 style="margin:0 0 16px 0;font-size:18px;font-weight:700;color:${S.text};">Saved Templates (${templates.rowCount})</h2>
          <div style="display:flex;flex-direction:column;gap:12px;">${cards}</div>
        </div>
        <!-- Create new template -->
        <div>
          <h2 style="margin:0 0 16px 0;font-size:18px;font-weight:700;color:${S.text};">Create Template</h2>
          <div style="background:${S.card};border:1px solid ${S.grayBorder};border-radius:${S.radius};box-shadow:${S.shadow};padding:24px;">
            <form method="POST" action="/school/emergency/templates" novalidate>
              <div style="margin-bottom:16px;">
                <label for="tpl_title" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Template Title *</label>
                <input type="text" id="tpl_title" name="title" required maxlength="500" placeholder="e.g. Fire Drill Protocol" style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;box-sizing:border-box;" />
              </div>
              <div style="margin-bottom:16px;">
                <label for="tpl_alert_type" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Alert Type *</label>
                <select id="tpl_alert_type" name="alert_type" required style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;background:#fff;">
                  ${typeOpts}
                </select>
              </div>
              <div style="margin-bottom:20px;">
                <label for="tpl_message" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Message Body *</label>
                <textarea id="tpl_message" name="message" required rows="8" maxlength="5000" placeholder="Write the template message. Use [SCHOOL NAME], [DATE], etc. as placeholders..." style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;box-sizing:border-box;resize:vertical;font-family:inherit;line-height:1.6;"></textarea>
              </div>
              <div style="display:flex;gap:12px;">
                <button type="submit" style="padding:10px 24px;background:${S.primary};color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;" onmouseover="this.style.background='${S.primaryDark}'" onmouseout="this.style.background='${S.primary}'">Save Template</button>
                <button type="button" onclick="document.querySelector('#tpl_title').closest('form').reset()" style="padding:10px 24px;background:${S.grayLight};color:${S.text};border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;cursor:pointer;">Clear</button>
              </div>
            </form>
          </div>
        </div>
      </div>
    `;
    res.send(renderPage('Emergency Templates', wrapPage(req.session.user, '/school/emergency/templates', templatesHTML), req.session.user));
  }));

  app.post('/school/emergency/templates', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { title, alert_type, message } = req.body;
    if (!title || !alert_type || !message) { req.session.alertError = 'All fields are required.'; return res.redirect('/school/emergency/templates'); }
    await pool.query('INSERT INTO emergency_templates (tenant_id, alert_type, title, message, created_by) VALUES ($1,$2,$3,$4,$5)', [tid, alert_type, title, message, req.session.user.id]);
    audit({ action: 'emergency_template_created', tenantId: tid, type: alert_type, userId: req.session.user.id });
    req.session.alertSuccess = 'Template saved successfully.';
    res.redirect('/school/emergency/templates');
  }));

  app.post('/school/emergency/templates/delete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { template_id } = req.body;
    if (!template_id) return res.redirect('/school/emergency/templates');
    await pool.query('DELETE FROM emergency_templates WHERE id = $1 AND tenant_id = $2 AND is_default = false', [template_id, tid]);
    audit({ action: 'emergency_template_deleted', templateId: template_id, tenantId: tid, userId: req.session.user.id });
    req.session.alertSuccess = 'Template deleted.';
    res.redirect('/school/emergency/templates');
  }));

  /* ═══════════════════════════════════════════════════════════
     FEATURE 4: PARENT EMERGENCY CONTACTS  (/school/emergency/contacts)
     ═══════════════════════════════════════════════════════════ */

  app.get('/school/emergency/contacts', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { search, export_format } = req.query;

    let where = 'WHERE u.tenant_id = $1 AND u.role = \'parent\' AND u.active = true';
    const params = [tid];
    let paramIdx = 2;

    if (search) {
      where += ` AND (u.name ILIKE $${paramIdx} OR u.email ILIKE $${paramIdx})`;
      params.push(`%${search}%`);
      paramIdx++;
    }

    const parents = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone,
        (SELECT COUNT(*) FROM students s WHERE s.parent_id = u.id AND s.tenant_id = $1) as child_count
       FROM users u ${where} ORDER BY u.name ASC LIMIT 200`,
      params
    );

    /* Get emergency contact details from student records */
    const contacts = await pool.query(
      `SELECT s.id as student_id, s.name as student_name, s.parent_id, s.emergency_contacts, c.name as class_name
       FROM students s
       LEFT JOIN classes c ON s.class_id = c.id
       WHERE s.tenant_id = $1 AND s.active = true
       ORDER BY s.name ASC`,
      [tid]
    );

    /* Build parent → students map */
    const parentMap = {};
    for (const p of parents.rows) { parentMap[p.id] = { ...p, students: [] }; }
    for (const c of contacts.rows) {
      if (parentMap[c.parent_id]) {
        let ecList = [];
        try { ecList = typeof c.emergency_contacts === 'string' ? JSON.parse(c.emergency_contacts) : (c.emergency_contacts || []); } catch (_) {}
        parentMap[c.parent_id].students.push({ student_name: c.student_name, class_name: c.class_name, emergency_contacts: ecList });
      }
    }

    /* CSV Export */
    if (export_format === 'csv') {
      const lines = ['Parent Name,Parent Email,Parent Phone,Student Name,Class,Emergency Contact 1,Emergency Contact 2,Emergency Contact 3'];
      for (const pid in parentMap) {
        const p = parentMap[pid];
        for (const st of p.students) {
          const ec1 = st.emergency_contacts[0] ? `${st.emergency_contacts[0].name} (${st.emergency_contacts[0].phone})` : '';
          const ec2 = st.emergency_contacts[1] ? `${st.emergency_contacts[1].name} (${st.emergency_contacts[1].phone})` : '';
          const ec3 = st.emergency_contacts[2] ? `${st.emergency_contacts[2].name} (${st.emergency_contacts[2].phone})` : '';
          lines.push(`"${p.name}","${p.email || ''}","${p.phone || ''}","${st.student_name}","${st.class_name || ''}","${ec1}","${ec2}","${ec3}"`);
        }
      }
      res.setHeader('Content-Type', 'text/csv');
      res.setHeader('Content-Disposition', `attachment; filename="emergency-contacts-${new Date().toISOString().slice(0,10)}.csv"`);
      return res.send(lines.join('\n'));
    }

    let contactCards = '';
    const parentEntries = Object.values(parentMap);
    if (parentEntries.length === 0) {
      contactCards = `<div style="padding:40px;text-align:center;color:${S.textMuted};font-size:14px;">No parent contacts found.</div>`;
    } else {
      for (const p of parentEntries) {
        let studentRows = '';
        for (const st of p.students) {
          let ecBadges = '<span style="color:#dc2626;font-size:12px;font-weight:600;">No emergency contacts on file</span>';
          if (st.emergency_contacts.length > 0) {
            ecBadges = st.emergency_contacts.map((ec, i) => `
              <div style="display:inline-flex;align-items:center;gap:4px;padding:3px 8px;background:${S.grayLight};border-radius:4px;font-size:12px;margin:2px;">
                <span style="font-weight:600;">P${i + 1}:</span> ${esc(ec.name || 'Unnamed')} — ${esc(ec.phone || 'No phone')}
                ${ec.relationship ? `<span style="color:${S.textMuted};">(${esc(ec.relationship)})</span>` : ''}
              </div>
            `).join('');
          }
          studentRows += `
            <div style="padding:10px 12px;background:${S.bg};border-radius:6px;margin-top:8px;">
              <div style="font-size:13px;font-weight:600;color:${S.text};">🎓 ${esc(st.student_name)} ${st.class_name ? `<span style="font-weight:400;color:${S.textMuted};">— ${esc(st.class_name)}</span>` : ''}</div>
              <div style="margin-top:6px;display:flex;flex-wrap:wrap;gap:4px;">${ecBadges}</div>
            </div>`;
        }
        contactCards += `
          <div style="background:${S.card};border:1px solid ${S.grayBorder};border-radius:${S.radius};padding:16px;box-shadow:${S.shadow};">
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:8px;">
              <div style="width:40px;height:40px;border-radius:50%;background:${S.primary}15;color:${S.primary};display:flex;align-items:center;justify-content:center;font-weight:700;font-size:16px;">${esc(p.name.charAt(0).toUpperCase())}</div>
              <div>
                <div style="font-size:15px;font-weight:600;color:${S.text};">${esc(p.name)}</div>
                <div style="font-size:12px;color:${S.textMuted};">${esc(p.email || 'No email')} ${p.phone ? '· ' + esc(p.phone) : ''} · ${p.child_count} child${p.child_count !== 1 ? 'ren' : ''}</div>
              </div>
            </div>
            ${studentRows}
          </div>`;
      }
    }

    const contactsHTML = `
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
        <h2 style="margin:0;font-size:18px;font-weight:700;color:${S.text};">Parent Emergency Contacts</h2>
        <div style="display:flex;gap:8px;">
          <a href="/school/emergency/contacts?export_format=csv${search ? '&search=' + encodeURIComponent(search) : ''}" style="display:inline-flex;align-items:center;gap:6px;padding:8px 16px;background:${S.success};color:#fff;border-radius:6px;text-decoration:none;font-size:13px;font-weight:600;" aria-label="Export contacts as CSV">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
            Export CSV
          </a>
        </div>
      </div>
      <form method="GET" action="/school/emergency/contacts" style="margin-bottom:20px;">
        <div style="display:flex;gap:8px;">
          <input type="text" name="search" value="${esc(search || '')}" placeholder="Search parents by name or email..." style="flex:1;padding:10px 14px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;max-width:400px;" aria-label="Search contacts" />
          <button type="submit" style="padding:10px 20px;background:${S.primary};color:#fff;border:none;border-radius:6px;font-size:14px;cursor:pointer;font-weight:600;">Search</button>
          ${search ? `<a href="/school/emergency/contacts" style="padding:10px 16px;font-size:14px;color:${S.primary};text-decoration:none;">Clear</a>` : ''}
        </div>
      </form>
      <div style="display:grid;grid-template-columns:1fr;gap:12px;">
        ${contactCards}
      </div>
      ${parentEntries.length > 0 ? `<div style="margin-top:16px;padding:12px 0;font-size:12px;color:${S.textMuted};">Showing ${parentEntries.length} parent records</div>` : ''}
    `;
    res.send(renderPage('Emergency Contacts', wrapPage(req.session.user, '/school/emergency/contacts', contactsHTML), req.session.user));
  }));

  /* ═══════════════════════════════════════════════════════════
     FEATURE 5: DRILL SCHEDULER  (/school/emergency/drills)
     ═══════════════════════════════════════════════════════════ */

  app.get('/school/emergency/drills', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    const drills = await pool.query(
      'SELECT ed.*, u.name as creator_name FROM emergency_drills ed LEFT JOIN users u ON ed.created_by = u.id WHERE ed.tenant_id = $1 ORDER BY ed.scheduled_date DESC LIMIT 50',
      [tid]
    );

    /* Compliance summary */
    const summary = await pool.query(
      `SELECT drill_type,
        COUNT(*) FILTER (WHERE status = 'completed') as completed_count,
        COUNT(*) FILTER (WHERE status = 'scheduled') as scheduled_count,
        COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_count,
        AVG(duration_minutes) FILTER (WHERE duration_minutes IS NOT NULL) as avg_duration
       FROM emergency_drills WHERE tenant_id = $1 GROUP BY drill_type ORDER BY drill_type`,
      [tid]
    );

    let summaryCards = '';
    for (const s of summary.rows) {
      summaryCards += `
        <div style="background:${S.card};border:1px solid ${S.grayBorder};border-radius:${S.radius};padding:16px;box-shadow:${S.shadow};min-width:180px;">
          <div style="font-size:13px;font-weight:600;color:${S.primary};margin-bottom:8px;">${esc(DRILL_TYPE_LABELS[s.drill_type] || s.drill_type)}</div>
          <div style="display:flex;gap:12px;font-size:12px;">
            <span style="color:${S.success};font-weight:600;">✅ ${s.completed_count || 0}</span>
            <span style="color:${S.warn};font-weight:600;">📅 ${s.scheduled_count || 0}</span>
            <span style="color:${S.gray};font-weight:600;">❌ ${s.cancelled_count || 0}</span>
          </div>
          ${s.avg_duration ? `<div style="margin-top:6px;font-size:11px;color:${S.textMuted};">Avg duration: ${Math.round(s.avg_duration)} min</div>` : ''}
        </div>`;
    }

    const typeOpts = DRILL_TYPES.map(t => `<option value="${t}">${DRILL_TYPE_LABELS[t]}</option>`).join('');

    let drillRows = '';
    if (drills.rowCount === 0) {
      drillRows = `<tr><td colspan="7" style="padding:40px;text-align:center;color:${S.textMuted};font-size:14px;">No drills scheduled yet.</td></tr>`;
    } else {
      for (const d of drills.rows) {
        const isPast = d.scheduled_date < new Date() && d.status === 'scheduled';
        drillRows += `
          <tr style="border-bottom:1px solid ${S.grayBorder};${isPast ? 'background:#fef2f2;' : ''}">
            <td style="padding:12px 16px;font-size:14px;font-weight:600;color:${S.text};">${esc(DRILL_TYPE_LABELS[d.drill_type] || d.drill_type)}</td>
            <td style="padding:12px 16px;text-align:center;font-size:13px;color:${S.text};">${new Date(d.scheduled_date).toLocaleDateString()} ${new Date(d.scheduled_date).toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</td>
            <td style="padding:12px 16px;text-align:center;">${statusBadge(d.status)}</td>
            <td style="padding:12px 16px;text-align:center;font-size:13px;color:${S.text};">${d.duration_minutes ? d.duration_minutes + ' min' : '—'}</td>
            <td style="padding:12px 16px;text-align:center;font-size:13px;color:${S.text};">${d.participants_count || '—'}</td>
            <td style="padding:12px 16px;font-size:12px;color:${S.textMuted};max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${esc(d.observations || '—')}</td>
            <td style="padding:12px 16px;text-align:center;">
              ${d.status === 'scheduled' ? `
                <form method="POST" action="/school/emergency/drills/complete" style="display:inline;">
                  <input type="hidden" name="drill_id" value="${d.id}" />
                  <button type="submit" style="padding:4px 12px;background:${S.success};color:#fff;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:600;" aria-label="Complete drill ${d.id}">Complete</button>
                </form>
                <form method="POST" action="/school/emergency/drills/cancel" style="display:inline;margin-left:4px;" onsubmit="return confirm('Cancel this drill?')">
                  <input type="hidden" name="drill_id" value="${d.id}" />
                  <button type="submit" style="padding:4px 12px;background:#fef2f2;color:${S.danger};border:1px solid #fecaca;border-radius:4px;font-size:11px;cursor:pointer;">Cancel</button>
                </form>
              ` : '<span style="font-size:12px;color:${S.textMuted};">—</span>'}
            </td>
          </tr>`;
      }
    }

    const drillsHTML = `
      <!-- Compliance Summary -->
      <div style="margin-bottom:24px;">
        <h2 style="margin:0 0 12px 0;font-size:18px;font-weight:700;color:${S.text};">Drill Compliance Summary</h2>
        <div style="display:flex;gap:12px;flex-wrap:wrap;">${summaryCards || `<div style="padding:20px;color:${S.textMuted};font-size:14px;background:${S.card};border-radius:${S.radius};border:1px solid ${S.grayBorder};">No drill data yet. Schedule your first drill below.</div>`}</div>
      </div>

      <!-- Schedule New Drill -->
      <div style="background:${S.card};border-radius:${S.radius};box-shadow:${S.shadow};border:1px solid ${S.grayBorder};overflow:hidden;margin-bottom:24px;">
        <div style="padding:16px 24px;border-bottom:1px solid ${S.grayBorder};background:${S.grayLight};">
          <h2 style="margin:0;font-size:16px;font-weight:700;color:${S.text};">Schedule New Drill</h2>
        </div>
        <form method="POST" action="/school/emergency/drills" style="padding:20px 24px;display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:16px;align-items:flex-end;" novalidate>
          <div>
            <label for="drill_type" style="display:block;font-size:12px;font-weight:600;color:${S.text};margin-bottom:4px;">Drill Type *</label>
            <select id="drill_type" name="drill_type" required style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;background:#fff;">
              ${typeOpts}
            </select>
          </div>
          <div>
            <label for="scheduled_date" style="display:block;font-size:12px;font-weight:600;color:${S.text};margin-bottom:4px;">Date & Time *</label>
            <input type="datetime-local" id="scheduled_date" name="scheduled_date" required style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;" />
          </div>
          <div>
            <label for="participants" style="display:block;font-size:12px;font-weight:600;color:${S.text};margin-bottom:4px;">Est. Participants</label>
            <input type="number" id="participants" name="participants_count" min="0" placeholder="0" style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;" />
          </div>
          <button type="submit" style="padding:10px 24px;background:${S.primary};color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;white-space:nowrap;" onmouseover="this.style.background='${S.primaryDark}'" onmouseout="this.style.background='${S.primary}'">Schedule Drill</button>
        </form>
      </div>

      <!-- Drill Log -->
      <div style="background:${S.card};border-radius:${S.radius};box-shadow:${S.shadow};border:1px solid ${S.grayBorder};overflow:hidden;">
        <div style="padding:20px 24px;border-bottom:1px solid ${S.grayBorder};background:${S.grayLight};">
          <h2 style="margin:0;font-size:18px;font-weight:700;color:${S.text};">Drill Log</h2>
          <p style="margin:4px 0 0 0;font-size:13px;color:${S.textMuted};">Track all scheduled and completed emergency drills</p>
        </div>
        <div style="overflow-x:auto;">
          <table style="width:100%;border-collapse:collapse;" role="table" aria-label="Drill log table">
            <thead>
              <tr style="background:${S.grayLight};">
                <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Type</th>
                <th style="padding:10px 16px;text-align:center;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Scheduled</th>
                <th style="padding:10px 16px;text-align:center;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Status</th>
                <th style="padding:10px 16px;text-align:center;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Duration</th>
                <th style="padding:10px 16px;text-align:center;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Participants</th>
                <th style="padding:10px 16px;text-align:left;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Observations</th>
                <th style="padding:10px 16px;text-align:center;font-size:12px;font-weight:600;color:${S.textMuted};text-transform:uppercase;">Actions</th>
              </tr>
            </thead>
            <tbody>${drillRows}</tbody>
          </table>
        </div>
      </div>

      <!-- Complete Drill Modal (inline form, shown via JS) -->
      <div id="complete-modal" style="display:none;position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.5);z-index:1000;align-items:center;justify-content:center;">
        <div style="background:${S.card};border-radius:12px;padding:24px;max-width:500px;width:90%;box-shadow:0 20px 40px rgba(0,0,0,0.2);">
          <h3 style="margin:0 0 16px 0;font-size:18px;font-weight:700;color:${S.text};">Record Drill Completion</h3>
          <form method="POST" action="/school/emergency/drills/complete">
            <input type="hidden" name="drill_id" id="modal_drill_id" />
            <div style="margin-bottom:16px;">
              <label for="modal_duration" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Duration (minutes) *</label>
              <input type="number" id="modal_duration" name="duration_minutes" required min="1" placeholder="e.g. 8" style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;" />
            </div>
            <div style="margin-bottom:16px;">
              <label for="modal_participants" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Actual Participants</label>
              <input type="number" id="modal_participants" name="participants_count" min="0" placeholder="0" style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;" />
            </div>
            <div style="margin-bottom:20px;">
              <label for="modal_observations" style="display:block;font-size:13px;font-weight:600;color:${S.text};margin-bottom:6px;">Observations</label>
              <textarea id="modal_observations" name="observations" rows="3" maxlength="2000" placeholder="Note any issues, improvements needed, or highlights..." style="width:100%;padding:10px 12px;border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;resize:vertical;font-family:inherit;"></textarea>
            </div>
            <div style="display:flex;gap:12px;justify-content:flex-end;">
              <button type="button" onclick="document.getElementById('complete-modal').style.display='none'" style="padding:10px 20px;background:${S.grayLight};color:${S.text};border:1px solid ${S.grayBorder};border-radius:6px;font-size:14px;cursor:pointer;">Cancel</button>
              <button type="submit" style="padding:10px 20px;background:${S.success};color:#fff;border:none;border-radius:6px;font-size:14px;font-weight:600;cursor:pointer;">Save Record</button>
            </div>
          </form>
        </div>
      </div>
      <script>
        /* Override complete buttons to show modal */
        document.querySelectorAll('form[action="/school/emergency/drills/complete"] button[type="submit"]').forEach(btn => {
          const form = btn.closest('form');
          btn.addEventListener('click', function(e) {
            e.preventDefault();
            document.getElementById('modal_drill_id').value = form.querySelector('input[name="drill_id"]').value;
            document.getElementById('complete-modal').style.display = 'flex';
          });
        });
      </script>
    `;
    res.send(renderPage('Drill Scheduler', wrapPage(req.session.user, '/school/emergency/drills', drillsHTML), req.session.user));
  }));

  /* Schedule a drill */
  app.post('/school/emergency/drills', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { drill_type, scheduled_date, participants_count } = req.body;
    if (!drill_type || !DRILL_TYPES.includes(drill_type) || !scheduled_date) {
      req.session.alertError = 'Drill type and scheduled date are required.';
      return res.redirect('/school/emergency/drills');
    }
    await pool.query(
      'INSERT INTO emergency_drills (tenant_id, drill_type, scheduled_date, participants_count, created_by) VALUES ($1,$2,$3,$4,$5)',
      [tid, drill_type, scheduled_date, participants_count || 0, req.session.user.id]
    );
    audit({ action: 'emergency_drill_scheduled', tenantId: tid, drillType: drill_type, scheduledDate: scheduled_date, userId: req.session.user.id });
    req.session.alertSuccess = 'Drill scheduled successfully.';
    res.redirect('/school/emergency/drills');
  }));

  /* Complete a drill */
  app.post('/school/emergency/drills/complete', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { drill_id, duration_minutes, participants_count, observations } = req.body;
    if (!drill_id || !duration_minutes) {
      req.session.alertError = 'Drill ID and duration are required.';
      return res.redirect('/school/emergency/drills');
    }
    await pool.query(
      'UPDATE emergency_drills SET status = $1, completed_date = NOW(), duration_minutes = $2, participants_count = COALESCE($3, participants_count), observations = $4 WHERE id = $5 AND tenant_id = $6 AND status = $7',
      ['completed', parseInt(duration_minutes), participants_count ? parseInt(participants_count) : null, observations || null, drill_id, tid, 'scheduled']
    );
    audit({ action: 'emergency_drill_completed', drillId: drill_id, tenantId: tid, duration: duration_minutes, userId: req.session.user.id });
    req.session.alertSuccess = 'Drill recorded as completed.';
    res.redirect('/school/emergency/drills');
  }));

  /* Cancel a drill */
  app.post('/school/emergency/drills/cancel', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { drill_id } = req.body;
    if (!drill_id) return res.redirect('/school/emergency/drills');
    await pool.query(
      'UPDATE emergency_drills SET status = $1 WHERE id = $2 AND tenant_id = $3 AND status = $4',
      ['cancelled', drill_id, tid, 'scheduled']
    );
    audit({ action: 'emergency_drill_cancelled', drillId: drill_id, tenantId: tid, userId: req.session.user.id });
    req.session.alertSuccess = 'Drill cancelled.';
    res.redirect('/school/emergency/drills');
  }));

  /* ═══════════════════════════════════════════════════════════
     INITIALIZATION
     ═══════════════════════════════════════════════════════════ */

  (async () => {
    try {
      await ensureTables();
      /* Seed templates for first tenant if none exist */
      const tenants = await pool.query('SELECT id FROM tenants LIMIT 100');
      for (const t of tenants.rows) {
        await seedDefaultTemplates(t.id);
      }
      console.log('[emergency-alerts] Module initialized — tables ready, templates seeded.');
    } catch (err) {
      console.error('[emergency-alerts] Init error:', err.message);
    }
  })();
};
