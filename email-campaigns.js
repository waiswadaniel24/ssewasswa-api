/**
 * Email Campaign Builder — Multi-Tenant SaaS Platform
 * 12 routes: dashboard, new campaign, save campaign, all campaigns,
 * campaign detail, send campaign, duplicate, delete, subscribers,
 * add subscriber, import subscribers, templates.
 *
 * Features: WYSIWYG HTML editor, variable substitution, recipient selection,
 * scheduling, open/click tracking, unsubscribe handling, CSV import,
 * pre-built templates, inline bar chart analytics.
 * Color theme: #ea580c (orange)
 */
'use strict';
const { migrateQuery } = require('./db');
module.exports = function emailCampaigns(app, db, pool, renderPage, esc) {
  const requireAuth = (req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); };
  const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

  // -- subscription gate --------------------------------------------------
  const _PLAN_LEVELS = { free: 0, basic: 1, pro: 2 };
  const _SUB_PAGE = '<div style="max-width:600px;margin:60px auto;text-align:center"><h2>Subscription Required</h2><p>This feature requires a paid subscription.</p><a href="/billing" style="padding:12px 24px;background:#f59e0b;color:white;text-decoration:none;border-radius:8px;font-weight:700">Subscribe Now</a></div>';
  const requireSubscription = (minPlan) => async (req, res, next) => {
    if (req.session?.user?.role === 'super_admin') return next();
    try {
      const sub = await pool.query("SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status='active'", [req.session.user.tenant_id]);
      const plan = sub.rows[0]?.plan || 'free';
      if ((_PLAN_LEVELS[plan] || 0) < (_PLAN_LEVELS[minPlan] || 0)) return res.send(_SUB_PAGE);
    } catch (e) { /* allow through on DB error */ }
    next();
  };
  if (!esc) esc = (s) => String(s == null ? '' : (typeof s === 'object' ? JSON.stringify(s) : s)).replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));

  const PS = 20; // page size for lists
  const THEME = '#ea580c';
  const TRACKING_PIXEL = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==';

  // ═══════════════════════════════════════════════════════
  //  MIGRATIONS
  // ═══════════════════════════════════════════════════════
  (async () => {
    if (!pool) return;
    try {
      await migrateQuery(pool, 'EmailCampaigns', `CREATE TABLE IF NOT EXISTS email_campaigns_list (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        name VARCHAR(255) NOT NULL,
        subject VARCHAR(500) NOT NULL,
        preheader TEXT,
        body_html TEXT NOT NULL,
        body_text TEXT,
        sender_name VARCHAR(255),
        sender_email VARCHAR(255),
        status VARCHAR(20) DEFAULT 'draft',
        recipient_type VARCHAR(50),
        recipient_filter JSONB,
        recipient_count INTEGER DEFAULT 0,
        sent_count INTEGER DEFAULT 0,
        open_count INTEGER DEFAULT 0,
        click_count INTEGER DEFAULT 0,
        bounce_count INTEGER DEFAULT 0,
        unsubscribe_count INTEGER DEFAULT 0,
        scheduled_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        created_by INTEGER REFERENCES users(id),
        created_at TIMESTAMPTZ DEFAULT NOW()
      );`);

      await migrateQuery(pool, 'EmailCampaigns', `CREATE TABLE IF NOT EXISTS email_subscribers (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        email VARCHAR(255) NOT NULL,
        name VARCHAR(255),
        tags TEXT[] DEFAULT '{}',
        status VARCHAR(20) DEFAULT 'subscribed',
        source VARCHAR(100),
        subscribed_at TIMESTAMPTZ DEFAULT NOW(),
        UNIQUE(tenant_id, email)
      );`);

      await migrateQuery(pool, 'EmailCampaigns', `CREATE TABLE IF NOT EXISTS email_tracking (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE,
        campaign_id INTEGER REFERENCES email_campaigns_list(id) ON DELETE CASCADE,
        tracking_type VARCHAR(20),
        recipient_email VARCHAR(255),
        tracked_at TIMESTAMPTZ DEFAULT NOW(),
        metadata JSONB
      );`);

      // ALTER TABLE IF NOT EXISTS — safe for re-deploys
      const campCols = [
        'tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE',
        'name VARCHAR(255) NOT NULL',
        'subject VARCHAR(500) NOT NULL',
        'preheader TEXT',
        'body_html TEXT NOT NULL',
        'body_text TEXT',
        'sender_name VARCHAR(255)',
        'sender_email VARCHAR(255)',
        "status VARCHAR(20) DEFAULT 'draft'",
        'recipient_type VARCHAR(50)',
        'recipient_filter JSONB',
        'recipient_count INTEGER DEFAULT 0',
        'sent_count INTEGER DEFAULT 0',
        'open_count INTEGER DEFAULT 0',
        'click_count INTEGER DEFAULT 0',
        'bounce_count INTEGER DEFAULT 0',
        'unsubscribe_count INTEGER DEFAULT 0',
        'scheduled_at TIMESTAMPTZ',
        'sent_at TIMESTAMPTZ',
        'created_by INTEGER REFERENCES users(id)',
        'created_at TIMESTAMPTZ DEFAULT NOW()',
      ];
      for (const col of campCols) await migrateQuery(pool, 'EmailCampaigns', `ALTER TABLE email_campaigns_list ADD COLUMN IF NOT EXISTS ${col};`).catch(() => {});

      const subCols = [
        'tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE',
        'email VARCHAR(255) NOT NULL',
        'name VARCHAR(255)',
        "tags TEXT[] DEFAULT '{}'",
        "status VARCHAR(20) DEFAULT 'subscribed'",
        'source VARCHAR(100)',
        'subscribed_at TIMESTAMPTZ DEFAULT NOW()',
      ];
      for (const col of subCols) await migrateQuery(pool, 'EmailCampaigns', `ALTER TABLE email_subscribers ADD COLUMN IF NOT EXISTS ${col};`).catch(() => {});

      const trkCols = [
        'tenant_id INTEGER REFERENCES tenants(id) ON DELETE CASCADE',
        'campaign_id INTEGER REFERENCES email_campaigns_list(id) ON DELETE CASCADE',
        'tracking_type VARCHAR(20)',
        'recipient_email VARCHAR(255)',
        'tracked_at TIMESTAMPTZ DEFAULT NOW()',
        'metadata JSONB',
      ];
      for (const col of trkCols) await migrateQuery(pool, 'EmailCampaigns', `ALTER TABLE email_tracking ADD COLUMN IF NOT EXISTS ${col};`).catch(() => {});

      // Indexes
      const indexes = [
        'CREATE INDEX IF NOT EXISTS idx_ec_list_tid ON email_campaigns_list(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_ec_list_status ON email_campaigns_list(tenant_id,status);',
        'CREATE INDEX IF NOT EXISTS idx_ec_list_created ON email_campaigns_list(tenant_id,created_at DESC);',
        'CREATE INDEX IF NOT EXISTS idx_ec_sub_tid ON email_subscribers(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_ec_sub_email ON email_subscribers(tenant_id,email);',
        'CREATE INDEX IF NOT EXISTS idx_ec_sub_status ON email_subscribers(tenant_id,status);',
        'CREATE INDEX IF NOT EXISTS idx_ec_trk_tid ON email_tracking(tenant_id);',
        'CREATE INDEX IF NOT EXISTS idx_ec_trk_cid ON email_tracking(campaign_id);',
        'CREATE INDEX IF NOT EXISTS idx_ec_trk_type ON email_tracking(tenant_id,tracking_type);',
      ];
      for (const sql of indexes) await migrateQuery(pool, 'EmailCampaigns', sql).catch(() => {});

      console.log('[EmailCampaigns] Migrations applied');
    } catch (e) { console.error('[EmailCampaigns] Migration error:', e.message); }
  })();

  // ═══════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════

  /** Format number with locale */
  const F = n => (n || 0).toLocaleString();

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

  /** Percentage */
  function pct(num, den) {
    if (!den || den <= 0) return '0.0';
    return ((num / den) * 100).toFixed(1);
  }

  /** Flash message from session */
  function flash(req) {
    const f = req.session.flash_ec;
    delete req.session.flash_ec;
    if (!f) return '';
    const color = f.type === 'error' ? '#fef2f2;border:1px solid #fecaca;color:#dc2626' :
                  f.type === 'warn' ? '#fffbeb;border:1px solid #fde68a;color:#92400e' :
                  '#f0fdf4;border:1px solid #bbf7d0;color:#16a34a';
    return `<div style="background:${color};padding:10px 14px;border-radius:8px;margin-bottom:14px">${esc(f.msg)}</div>`;
  }

  /** Status badge */
  function badge(s) {
    const m = {
      draft: `background:#fef3c7;color:#92400e`,
      scheduled: `background:#dbeafe;color:#1e40af`,
      sending: `background:#fef3c7;color:#92400e`,
      sent: `background:#dcfce7;color:#16a34a`,
      paused: `background:#f3e8ff;color:#7c3aed`,
      failed: `background:#fef2f2;color:#dc2626`,
    };
    const c = m[s] || `background:#f3f4f6;color:#6b7280`;
    return `<span style="display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600;background:${c}">${esc(s || '')}</span>`;
  }

  /** Navigation bar */
  function nav(a) {
    const links = [
      ['dashboard', 'Dashboard', '/email-campaigns'],
      ['new', 'New Campaign', '/email-campaigns/new'],
      ['all', 'Campaigns', '/email-campaigns/all'],
      ['subscribers', 'Subscribers', '/email-campaigns/subscribers'],
      ['templates', 'Templates', '/email-campaigns/templates'],
    ];
    return '<div style="display:flex;gap:8px;margin-bottom:18px;flex-wrap:wrap">' +
      links.map(([k, l, h]) =>
        `<a href="${h}" style="padding:7px 14px;border-radius:8px;font-size:13px;font-weight:600;text-decoration:none;border:1px solid ${a === k ? THEME : '#e5e7eb'};color:${a === k ? '#fff' : '#374151'};background:${a === k ? THEME : '#fff'}">${l}</a>`
      ).join('') + '</div>';
  }

  /** Pagination */
  function pag(path, qs, pg, tot) {
    const p = Math.ceil(tot / PS);
    if (p <= 1) return '';
    return '<div style="display:flex;justify-content:center;gap:4px;margin-top:14px">' +
      Array.from({ length: p }, (_, i) => {
        const x = i + 1;
        return `<a href="${path}?${qs}&page=${x}" style="padding:5px 10px;border-radius:6px;font-size:13px;text-decoration:none;border:1px solid ${x === parseInt(pg) ? THEME : '#e5e7eb'};color:${x === parseInt(pg) ? '#fff' : '#374151'};background:${x === parseInt(pg) ? THEME : '#fff'}">${x}</a>`;
      }).join('') + '</div>';
  }

  /** CSS bar chart */
  function barChart(data, color) {
    if (!data || !data.length) return '<p style="text-align:center;padding:16px;color:#9ca3af">No data available</p>';
    const mx = Math.max(...data.map(d => d.value), 1);
    return data.map(d => {
      const w = Math.max(2, Math.round((d.value / mx) * 100));
      return `<div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <span style="min-width:110px;font-size:13px;text-align:right;color:#6b7280">${esc(d.label)}</span>
        <div style="flex:1;height:22px;background:#f3f4f6;border-radius:4px;overflow:hidden">
          <div style="height:100%;width:${w}%;background:${color || THEME};border-radius:4px;transition:width .3s"></div>
        </div>
        <span style="min-width:50px;font-size:13px;font-weight:600">${F(d.value)}</span>
      </div>`;
    }).join('');
  }

  /** Variable substitution: replaces {{key}} with values */
  function substituteVars(html, vars) {
    if (!html) return html;
    if (!vars) vars = {};
    return html.replace(/\{\{(\w+)\}\}/g, (match, key) => esc(vars[key] || match));
  }

  /** Fetch recipients based on type and filter */
  async function getRecipients(tid, type, filter) {
    let rows = [];
    switch (type) {
      case 'all_parents': {
        const r = await pool.query(`SELECT email, first_name, last_name FROM users WHERE tenant_id=$1 AND role='parent' AND email IS NOT NULL AND email != ''`, [tid]);
        rows = r.rows;
        break;
      }
      case 'all_students': {
        const r = await pool.query(`SELECT email, first_name, last_name FROM users WHERE tenant_id=$1 AND role='student' AND email IS NOT NULL AND email != ''`, [tid]);
        rows = r.rows;
        break;
      }
      case 'all_staff': {
        const r = await pool.query(`SELECT email, first_name, last_name FROM users WHERE tenant_id=$1 AND role IN ('admin','staff','teacher') AND email IS NOT NULL AND email != ''`, [tid]);
        rows = r.rows;
        break;
      }
      case 'specific_class': {
        const cls = (filter && filter.class) || '';
        if (!cls) break;
        const r = await pool.query(`SELECT u.email, u.first_name, u.last_name FROM users u JOIN students s ON s.tenant_id=u.tenant_id AND s.name=CONCAT(u.first_name,' ',u.last_name) WHERE u.tenant_id=$1 AND s.class=$2 AND u.email IS NOT NULL AND u.email != ''`, [tid, cls]);
        if (r.rows.length === 0) {
          // Fallback: try matching by role student
          const r2 = await pool.query(`SELECT email, first_name, last_name FROM users WHERE tenant_id=$1 AND role='student' AND email IS NOT NULL AND email != ''`, [tid]);
          rows = r2.rows;
        } else {
          rows = r.rows;
        }
        break;
      }
      case 'custom_list': {
        const emails = (filter && filter.emails) || [];
        rows = emails.map(e => {
          const parts = e.split(/[,;]/);
          const email = (parts[0] || '').trim();
          const name = (parts[1] || parts[0] || '').trim();
          return { email, first_name: name.split(' ')[0] || '', last_name: name.split(' ').slice(1).join(' ') || '' };
        }).filter(r => r.email && r.email.includes('@'));
        break;
      }
      case 'subscribers': {
        const r = await pool.query(`SELECT email, name FROM email_subscribers WHERE tenant_id=$1 AND status='subscribed'`, [tid]);
        rows = r.rows.map(r => ({ email: r.email, first_name: (r.name || '').split(' ')[0] || '', last_name: (r.name || '').split(' ').slice(1).join(' ') || '' }));
        break;
      }
      default: {
        // All contacts with email
        const r = await pool.query(`SELECT email, first_name, last_name FROM users WHERE tenant_id=$1 AND email IS NOT NULL AND email != ''`, [tid]);
        rows = r.rows;
      }
    }
    // Deduplicate by email
    const seen = new Set();
    return rows.filter(r => {
      if (seen.has(r.email)) return false;
      seen.add(r.email);
      return true;
    });
  }

  /** Queue individual emails into email_queue table */
  async function queueCampaignEmails(tid, campaignId, campaign, recipients) {
    const BATCH = 200;
    for (let i = 0; i < recipients.length; i += BATCH) {
      const batch = recipients.slice(i, i + BATCH);
      const vals = batch.map((_, idx) => {
        const b = idx * 3;
        return `($1,$${b + 2},$${b + 3},$${b + 4},true)`;
      }).join(',');
      const params = [tid];
      for (const r of batch) {
        const name = [r.first_name, r.last_name].filter(Boolean).join(' ') || r.email;
        const vars = { name, school_name: '', student_name: '', class: '', balance: '' };
        const personalizedHtml = substituteVars(campaign.body_html, vars);
        // Inject tracking pixel
        const trackingHtml = personalizedHtml +
          `<img src="${process.env.BASE_URL || ''}/email-campaigns/track/open/${campaignId}?e=${encodeURIComponent(r.email)}" width="1" height="1" style="display:none" alt="">`;
        // Wrap links with click tracking
        const clickWrappedHtml = trackingHtml.replace(
          /<a\s+([^>]*?)href="([^"]+)"([^>]*)>/gi,
          (match, before, href, after) => {
            if (href.startsWith('#') || href.startsWith('mailto:') || href.includes('/email-campaigns/track/')) return match;
            const trackUrl = `${process.env.BASE_URL || ''}/email-campaigns/track/click/${campaignId}?e=${encodeURIComponent(r.email)}&u=${encodeURIComponent(href)}`;
            return `<a ${before}href="${trackUrl}"${after}>`;
          }
        );
        const senderName = campaign.sender_name || '';
        const senderEmail = campaign.sender_email || '';
        const fromLine = senderName ? `${senderName} <${senderEmail || ''}>` : senderEmail;
        params.push(r.email, campaign.subject, clickWrappedHtml);
      }
      await pool.query(`INSERT INTO email_queue (tenant_id, to_email, subject, body, html) VALUES ${vals}`, params);
    }
  }

  /** Validate email format */
  function isValidEmail(email) {
    return typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  }

  // ═══════════════════════════════════════════════════════
  //  CSS STYLES
  // ═══════════════════════════════════════════════════════
  const CSS = `<style>
    .ec-stats{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:12px;margin-bottom:18px}
    .ec-stat{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:14px;text-align:center;transition:box-shadow .15s}
    .ec-stat:hover{box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .ec-num{font-size:26px;font-weight:700;color:#1f2937}
    .ec-lbl{font-size:12px;color:#6b7280;margin-top:2px}
    .ec-card{background:#fff;border:1px solid #e5e7eb;border-radius:12px;padding:18px}
    .ec-inp{padding:9px 12px;border:1px solid #d1d5db;border-radius:8px;font-size:14px;box-sizing:border-box;outline:none;width:100%}
    .ec-inp:focus{border-color:${THEME};box-shadow:0 0 0 3px ${THEME}1a}
    .ec-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 16px;border-radius:8px;font-size:14px;font-weight:600;text-decoration:none;border:none;cursor:pointer;transition:all .15s}
    .ec-btn-primary{background:${THEME};color:#fff}
    .ec-btn-primary:hover{background:#c2410c}
    .ec-btn-secondary{background:#fff;color:#374151;border:1px solid #d1d5db}
    .ec-btn-secondary:hover{background:#f9fafb}
    .ec-btn-danger{background:#fff;color:#dc2626;border:1px solid #fecaca}
    .ec-btn-danger:hover{background:#fef2f2}
    .ec-btn-sm{padding:5px 12px;font-size:13px;border-radius:6px}
    .ec-editor{border:1px solid #d1d5db;border-radius:8px;overflow:hidden}
    .ec-editor-toolbar{display:flex;gap:4px;padding:8px;background:#f9fafb;border-bottom:1px solid #e5e7eb;flex-wrap:wrap}
    .ec-editor-toolbar button{padding:5px 10px;border:1px solid #d1d5db;border-radius:4px;background:#fff;font-size:13px;cursor:pointer}
    .ec-editor-toolbar button:hover{background:#f3f4f6}
    .ec-editor-toolbar button.active{background:${THEME};color:#fff;border-color:${THEME}}
    .ec-editor textarea{padding:12px;font-size:14px;border:none;outline:none;width:100%;min-height:350px;resize:vertical;font-family:'Courier New',monospace;box-sizing:border-box}
    .ec-editor iframe{width:100%;min-height:350px;border:none}
    .ec-qa{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:10px;margin-bottom:18px}
    .ec-qa-a{border:1px solid #e5e7eb;border-radius:10px;padding:16px;text-align:center;text-decoration:none;color:inherit;transition:all .15s;background:#fff}
    .ec-qa-a:hover{border-color:${THEME};box-shadow:0 2px 8px ${THEME}15}
    .ec-fbar{display:flex;gap:8px;flex-wrap:wrap;align-items:center;margin-bottom:14px}
    .ec-fbar select,.ec-fbar input{padding:7px 12px;border:1px solid #d1d5db;border-radius:6px;font-size:13px;background:#fff}
    .ec-fbar select:focus,.ec-fbar input:focus{border-color:${THEME}}
    .ec-table{width:100%;border-collapse:collapse;font-size:14px}
    .ec-table th{text-align:left;padding:10px 12px;border-bottom:2px solid #e5e7eb;font-weight:600;color:#374151;font-size:13px}
    .ec-table td{padding:10px 12px;border-bottom:1px solid #f3f4f6;color:#4b5563}
    .ec-table tr:hover td{background:#f9fafb}
    .ec-tip{background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px 14px;font-size:13px;color:#9a3412;margin-top:10px}
    .ec-badge{display:inline-block;padding:2px 10px;border-radius:12px;font-size:12px;font-weight:600}
    .ec-tag{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;background:#fff7ed;color:${THEME};margin:2px}
    .ec-sched{background:#fff7ed;border:1px solid #fed7aa;border-radius:10px;padding:14px;margin-top:12px}
    .ec-tmpl-card{border:1px solid #e5e7eb;border-radius:12px;padding:16px;background:#fff;transition:box-shadow .15s}
    .ec-tmpl-card:hover{box-shadow:0 2px 8px rgba(0,0,0,.06)}
    .ec-var{display:inline-block;background:#fff7ed;color:${THEME};padding:2px 8px;border-radius:4px;font-size:12px;font-weight:600;margin:2px}
    .ec-progress{height:6px;background:#e5e7eb;border-radius:3px;overflow:hidden;min-width:60px;flex:1}
    .ec-progress-fill{height:100%;border-radius:3px;transition:width .3s}
    .ec-modal-overlay{position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;z-index:1000}
    .ec-modal{background:#fff;border-radius:12px;padding:24px;max-width:500px;width:90%;max-height:80vh;overflow-y:auto}
    .ec-chip{display:inline-flex;align-items:center;gap:4px;padding:4px 10px;border-radius:6px;font-size:12px;background:#f3f4f6;color:#374151;margin:2px}
  </style>`;

  // ═══════════════════════════════════════════════════════
  //  PRE-BUILT TEMPLATES
  // ═══════════════════════════════════════════════════════
  const TEMPLATES = [
    {
      key: 'fee_reminder', name: 'Fee Reminder', icon: '💰', category: 'billing',
      description: 'Send a fee payment reminder to parents',
      subject: 'Fee Payment Reminder — {{student_name}} ({{class}})',
      body: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1f2937">
<div style="background:${THEME};padding:20px;border-radius:8px 8px 0 0;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px">Fee Payment Reminder</h1></div>
<div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
<p>Dear <strong>{{name}}</strong>,</p>
<p>This is a friendly reminder that the school fees for <strong>{{student_name}}</strong> (Class <strong>{{class}}</strong>) are outstanding.</p>
<div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
<div style="font-size:13px;color:#9a3412;margin-bottom:4px">Outstanding Balance</div>
<div style="font-size:28px;font-weight:700;color:${THEME}">{{balance}}</div>
</div>
<p>Please arrange payment at your earliest convenience to avoid any late fees. You can pay via the school portal, mobile money, or at the school office.</p>
<p>If you have already made this payment, please disregard this notice.</p>
<p>Thank you for your continued support.</p>
<p style="margin-top:20px;color:#6b7280;font-size:13px">Regards,<br>{{school_name}} Administration</p>
</div></body></html>`
    },
    {
      key: 'event_invite', name: 'Event Invitation', icon: '🎉', category: 'events',
      description: 'Invite parents and students to school events',
      subject: 'You\'re Invited! {{event_name}}',
      body: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1f2937">
<div style="background:linear-gradient(135deg,${THEME},#f59e0b);padding:24px;border-radius:8px 8px 0 0;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px">🎉 You're Invited!</h1><p style="color:#fff;margin-top:8px;font-size:16px">{{event_name}}</p></div>
<div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
<p>Dear <strong>{{name}}</strong>,</p>
<p>We are delighted to invite you to our upcoming event. We would be thrilled to have you join us for what promises to be a wonderful occasion.</p>
<div style="background:#f9fafb;border-radius:8px;padding:16px;margin:16px 0">
<div style="margin-bottom:8px"><strong>📅 Date:</strong> {{event_date}}</div>
<div style="margin-bottom:8px"><strong>🕐 Time:</strong> {{event_time}}</div>
<div style="margin-bottom:8px"><strong>📍 Venue:</strong> {{venue}}</div>
<div><strong>👔 Dress Code:</strong> {{dress_code}}</div>
</div>
<p>We look forward to seeing you there!</p>
<p style="margin-top:20px;color:#6b7280;font-size:13px">Warm regards,<br>{{school_name}}</p>
</div></body></html>`
    },
    {
      key: 'newsletter', name: 'Monthly Newsletter', icon: '📰', category: 'general',
      description: 'Send a monthly newsletter to the school community',
      subject: '{{school_name}} Newsletter — {{month}}',
      body: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1f2937">
<div style="background:${THEME};padding:20px;border-radius:8px 8px 0 0;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px">{{school_name}} Newsletter</h1><p style="color:#fdba74;margin-top:4px;font-size:14px">{{month}}</p></div>
<div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
<p>Dear <strong>{{name}}</strong>,</p>
<p>Welcome to this month's newsletter! Here's what's been happening at {{school_name}}.</p>
<h2 style="color:${THEME};border-bottom:2px solid #fed7aa;padding-bottom:6px">📋 Highlights</h2>
<ul style="line-height:1.8">{{highlights}}</ul>
<h2 style="color:${THEME};border-bottom:2px solid #fed7aa;padding-bottom:6px">📅 Upcoming Events</h2>
<ul style="line-height:1.8">{{upcoming_events}}</ul>
<h2 style="color:${THEME};border-bottom:2px solid #fed7aa;padding-bottom:6px">🏆 Achievements</h2>
<p>{{achievements}}</p>
<p style="margin-top:20px;color:#6b7280;font-size:13px">Thank you for being part of our school community.<br>{{school_name}} Administration</p>
</div></body></html>`
    },
    {
      key: 'welcome', name: 'Welcome Email', icon: '👋', category: 'general',
      description: 'Welcome new subscribers or parents',
      subject: 'Welcome to {{school_name}}!',
      body: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1f2937">
<div style="background:linear-gradient(135deg,${THEME},#fb923c);padding:24px;border-radius:8px 8px 0 0;text-align:center"><h1 style="color:#fff;margin:0;font-size:24px">👋 Welcome!</h1><p style="color:#fff;margin-top:6px;font-size:16px">We're glad you're here</p></div>
<div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
<p>Dear <strong>{{name}}</strong>,</p>
<p>Welcome to <strong>{{school_name}}</strong>! We are excited to have you as part of our community.</p>
<div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin:16px 0">
<h3 style="margin:0 0 8px;color:#16a34a">✅ Here's what you can do:</h3>
<ul style="margin:0;padding-left:20px;line-height:1.8">
<li>View your dashboard for important updates</li>
<li>Access reports and academic information</li>
<li>Communicate with teachers and staff</li>
<li>Make payments and track fee balances</li>
</ul>
</div>
<p>If you have any questions, please don't hesitate to reach out. We're here to help!</p>
<p style="margin-top:20px;color:#6b7280;font-size:13px">Best regards,<br>{{school_name}} Team</p>
</div></body></html>`
    },
    {
      key: 'report_card', name: 'Report Card Notification', icon: '📊', category: 'academic',
      description: 'Notify parents when report cards are available',
      subject: 'Report Card Available — {{student_name}} ({{class}})',
      body: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1f2937">
<div style="background:${THEME};padding:20px;border-radius:8px 8px 0 0;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px">📊 Report Card Available</h1></div>
<div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
<p>Dear <strong>{{name}}</strong>,</p>
<p>The report card for <strong>{{student_name}}</strong> (Class <strong>{{class}}</strong>) for the <strong>{{term}}</strong> term is now available.</p>
<div style="background:#f9fafb;border-radius:8px;padding:16px;margin:16px 0;text-align:center">
<div style="font-size:14px;color:#6b7280;margin-bottom:8px">Overall Performance</div>
<div style="font-size:36px;font-weight:700;color:${THEME}">{{grade}}</div>
<div style="font-size:13px;color:#6b7280;margin-top:4px">{{comment}}</div>
</div>
<p>Please log in to the school portal to view the full report card with detailed marks and teacher comments.</p>
<p style="margin-top:20px;color:#6b7280;font-size:13px">Regards,<br>{{school_name}} Academics</p>
</div></body></html>`
    },
    {
      key: 'attendance_alert', name: 'Attendance Alert', icon: '⚠️', category: 'attendance',
      description: 'Alert parents about student absence',
      subject: 'Attendance Alert — {{student_name}} was absent',
      body: `<!DOCTYPE html><html><head><meta charset="utf-8"></head><body style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px;color:#1f2937">
<div style="background:#dc2626;padding:20px;border-radius:8px 8px 0 0;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px">⚠️ Attendance Alert</h1></div>
<div style="background:#fff;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 8px 8px">
<p>Dear <strong>{{name}}</strong>,</p>
<p>This is to inform you that <strong>{{student_name}}</strong> (Class <strong>{{class}}</strong>) was marked <strong style="color:#dc2626">absent</strong> on <strong>{{date}}</strong>.</p>
<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin:16px 0">
<p style="margin:0;color:#991b1b;font-size:14px">If this was unexpected, please contact the class teacher or school office immediately to clarify.</p>
</div>
<p>Regular attendance is critical for academic success. We appreciate your cooperation in ensuring your child attends school consistently.</p>
<p style="margin-top:20px;color:#6b7280;font-size:13px">Regards,<br>{{school_name}} Administration</p>
</div></body></html>`
    },
  ];

  // ═══════════════════════════════════════════════════════
  //  TRACKING ROUTES (public, no auth)
  // ═══════════════════════════════════════════════════════

  /** Tracking pixel — records open event */
  app.get('/email-campaigns/track/open/:campaignId', ah(async (req, res) => {
    const cid = parseInt(req.params.campaignId);
    const email = req.query.e || '';
    if (cid && email) {
      await pool.query(
        `INSERT INTO email_tracking (tenant_id, campaign_id, tracking_type, recipient_email, metadata)
         SELECT tenant_id, $1, 'open', $2, $3 FROM email_campaigns_list WHERE id=$1 LIMIT 1`,
        [cid, email, JSON.stringify({ user_agent: req.headers['user-agent'] || '', ip: req.ip || '' })]
      ).catch(() => {});
      await pool.query(`UPDATE email_campaigns_list SET open_count=open_count+1 WHERE id=$1`, [cid]).catch(() => {});
    }
    res.setHeader('Content-Type', 'image/png');
    res.setHeader('Cache-Control', 'no-store, no-cache');
    res.send(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI7wAAAABJRU5ErkJggg==', 'base64'));
  }));

  /** Click tracking — redirects to original URL */
  app.get('/email-campaigns/track/click/:campaignId', ah(async (req, res) => {
    const cid = parseInt(req.params.campaignId);
    const email = req.query.e || '';
    const targetUrl = req.query.u || '/';
    if (cid && email) {
      await pool.query(
        `INSERT INTO email_tracking (tenant_id, campaign_id, tracking_type, recipient_email, metadata)
         SELECT tenant_id, $1, 'click', $2, $3 FROM email_campaigns_list WHERE id=$1 LIMIT 1`,
        [cid, email, JSON.stringify({ link: targetUrl, user_agent: req.headers['user-agent'] || '', ip: req.ip || '' })]
      ).catch(() => {});
      await pool.query(`UPDATE email_campaigns_list SET click_count=click_count+1 WHERE id=$1`, [cid]).catch(() => {});
    }
    res.redirect(targetUrl);
  }));

  /** Unsubscribe handler */
  app.get('/email-campaigns/unsubscribe/:campaignId', ah(async (req, res) => {
    const cid = parseInt(req.params.campaignId);
    const email = req.query.e || '';
    if (cid && email) {
      const camp = (await pool.query(`SELECT tenant_id FROM email_campaigns_list WHERE id=$1`, [cid])).rows[0];
      if (camp) {
        await pool.query(`UPDATE email_subscribers SET status='unsubscribed' WHERE tenant_id=$1 AND email=$2`, [camp.tenant_id, email]).catch(() => {});
        await pool.query(
          `INSERT INTO email_tracking (tenant_id, campaign_id, tracking_type, recipient_email, metadata) VALUES ($1,$2,'unsubscribe',$3,'{}')`,
          [camp.tenant_id, cid, email]
        ).catch(() => {});
        await pool.query(`UPDATE email_campaigns_list SET unsubscribe_count=unsubscribe_count+1 WHERE id=$1`, [cid]).catch(() => {});
      }
    }
    res.send(`<!DOCTYPE html><html><head><title>Unsubscribed</title></head><body style="font-family:Arial,sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;background:#f9fafb;margin:0">
<div style="background:#fff;border-radius:12px;padding:40px;text-align:center;max-width:400px;box-shadow:0 2px 8px rgba(0,0,0,.08)">
<div style="font-size:48px;margin-bottom:16px">✉️</div>
<h2 style="margin:0 0 8px;color:#1f2937">Unsubscribed Successfully</h2>
<p style="color:#6b7280;line-height:1.5">You have been unsubscribed from future email communications. If this was a mistake, please contact the school administration.</p>
</div></body></html>`);
  }));

  // ═══════════════════════════════════════════════════════
  //  1. GET /email-campaigns — Dashboard
  // ═══════════════════════════════════════════════════════
  app.get('/email-campaigns', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    const stats = (await pool.query(`
      SELECT
        COUNT(*)::int AS total_campaigns,
        COUNT(*) FILTER (WHERE status='sent')::int AS sent_total,
        COUNT(*) FILTER (WHERE status='sent' AND sent_at >= date_trunc('month', NOW()))::int AS sent_this_month,
        COUNT(*) FILTER (WHERE status='draft')::int AS drafts,
        COUNT(*) FILTER (WHERE status='scheduled')::int AS scheduled,
        COALESCE(SUM(sent_count),0)::int AS total_sent,
        COALESCE(SUM(open_count),0)::int AS total_opens,
        COALESCE(SUM(click_count),0)::int AS total_clicks,
        COALESCE(SUM(bounce_count),0)::int AS total_bounces,
        COALESCE(SUM(unsubscribe_count),0)::int AS total_unsubscribes
      FROM email_campaigns_list WHERE tenant_id=$1`, [tid])).rows[0];

    const subCount = (await pool.query(
      `SELECT COUNT(*)::int AS cnt FROM email_subscribers WHERE tenant_id=$1 AND status='subscribed'`, [tid]
    )).rows[0].cnt;

    const openRate = stats.total_sent > 0 ? ((stats.total_opens / stats.total_sent) * 100).toFixed(1) : '0.0';
    const clickRate = stats.total_sent > 0 ? ((stats.total_clicks / stats.total_sent) * 100).toFixed(1) : '0.0';

    const recent = (await pool.query(`
      SELECT id, name, subject, status, recipient_count, sent_count, open_count, click_count, created_at
      FROM email_campaigns_list WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 8`, [tid])).rows;

    const chartData = (await pool.query(`
      SELECT DATE(sent_at) AS day, COUNT(*)::int AS campaigns, SUM(sent_count)::int AS sent
      FROM email_campaigns_list
      WHERE tenant_id=$1 AND status='sent' AND sent_at >= NOW() - INTERVAL '30 days'
      GROUP BY DATE(sent_at) ORDER BY day DESC LIMIT 10`, [tid])).rows.reverse();

    const recentHtml = recent.length === 0
      ? '<tr><td colspan="6" style="text-align:center;padding:28px;color:#9ca3af">No campaigns yet. <a href="/email-campaigns/new" style="color:' + THEME + '">Create your first campaign</a></td></tr>'
      : recent.map(c => {
        const p = c.recipient_count > 0 ? Math.round((c.sent_count / c.recipient_count) * 100) : 0;
        return `<tr>
          <td><strong style="color:#374151">${esc(c.name)}</strong></td>
          <td style="font-size:13px;color:#6b7280">${esc((c.subject || '').substring(0, 40))}${(c.subject || '').length > 40 ? '…' : ''}</td>
          <td>${badge(c.status)}</td>
          <td>
            <div style="display:flex;align-items:center;gap:8px">
              <div class="ec-progress"><div class="ec-progress-fill" style="width:${p}%;background:${p >= 100 ? '#16a34a' : THEME}"></div></div>
              <span style="font-size:12px;color:#6b7280">${p}%</span>
            </div>
          </td>
          <td style="font-size:12px;color:#6b7280">${ago(c.created_at)}</td>
          <td><a href="/email-campaigns/${c.id}" class="ec-btn ec-btn-sm ec-btn-secondary">View</a></td>
        </tr>`;
      }).join('');

    const chartHtml = barChart(chartData.map(r => ({ label: new Date(r.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: r.sent })), THEME);

    res.send(renderPage('Email Campaigns', `${CSS}${nav('dashboard')}
      <h2>Email Campaigns</h2>
      <p style="color:#6b7280;margin-bottom:18px">Create, send, and track email campaigns for your school community</p>

      <div class="ec-stats">
        <div class="ec-stat"><div class="ec-num" style="color:${THEME}">${F(stats.total_campaigns)}</div><div class="ec-lbl">Total Campaigns</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#16a34a">${F(stats.sent_this_month)}</div><div class="ec-lbl">Sent This Month</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#3b82f6">${openRate}%</div><div class="ec-lbl">Avg Open Rate</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#8b5cf6">${clickRate}%</div><div class="ec-lbl">Avg Click Rate</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#f59e0b">${F(subCount)}</div><div class="ec-lbl">Subscribers</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#ef4444">${F(stats.total_unsubscribes)}</div><div class="ec-lbl">Unsubscribes</div></div>
      </div>

      <div class="ec-qa">
        <a href="/email-campaigns/new" class="ec-qa-a"><div style="font-size:24px;margin-bottom:4px">✏️</div><div style="font-size:13px;font-weight:600">New Campaign</div></a>
        <a href="/email-campaigns/all" class="ec-qa-a"><div style="font-size:24px;margin-bottom:4px">📋</div><div style="font-size:13px;font-weight:600">All Campaigns</div></a>
        <a href="/email-campaigns/subscribers" class="ec-qa-a"><div style="font-size:24px;margin-bottom:4px">👥</div><div style="font-size:13px;font-weight:600">Subscribers</div></a>
        <a href="/email-campaigns/templates" class="ec-qa-a"><div style="font-size:24px;margin-bottom:4px">📄</div><div style="font-size:13px;font-weight:600">Templates</div></a>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
        <div class="ec-card">
          <h3 style="margin:0 0 12px;font-size:16px">📊 Recent Sending Activity</h3>
          ${chartHtml}
        </div>
        <div class="ec-card">
          <h3 style="margin:0 0 12px;font-size:16px">📈 Engagement Overview</h3>
          ${barChart([
            { label: 'Total Sent', value: stats.total_sent },
            { label: 'Opens', value: stats.total_opens },
            { label: 'Clicks', value: stats.total_clicks },
            { label: 'Bounces', value: stats.total_bounces },
            { label: 'Unsubscribes', value: stats.total_unsubscribes },
          ], THEME)}
        </div>
      </div>

      <div class="ec-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
          <h3 style="margin:0;font-size:16px">Recent Campaigns</h3>
          <a href="/email-campaigns/all" class="ec-btn ec-btn-sm ec-btn-secondary">View All</a>
        </div>
        <table class="ec-table">
          <thead><tr><th>Name</th><th>Subject</th><th>Status</th><th>Delivery</th><th>Created</th><th></th></tr></thead>
          <tbody>${recentHtml}</tbody>
        </table>
      </div>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  2. GET /email-campaigns/new — Create campaign form
  // ═══════════════════════════════════════════════════════
  app.get('/email-campaigns/new', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    // Get classes for specific_class filter
    const classes = (await pool.query(`SELECT DISTINCT class FROM students WHERE tenant_id=$1 AND class IS NOT NULL ORDER BY class`, [tid])).rows.map(r => r.class);
    // Get subscriber tags
    const tags = (await pool.query(`SELECT DISTINCT unnest(tags) AS tag FROM email_subscribers WHERE tenant_id=$1 AND array_length(tags,1)>0`, [tid])).rows.map(r => r.tag);

    const classOpts = classes.map(c => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
    const tagChips = tags.map(t => `<span class="ec-chip">${esc(t)}</span>`).join(' ');

    // Template selector for pre-built templates
    const tmplOpts = TEMPLATES.map(t => `<option value="${t.key}">${esc(t.name)}</option>`).join('');

    res.send(renderPage('New Email Campaign', `${CSS}${nav('new')}
      <h2>Create Email Campaign</h2>
      <p style="color:#6b7280;margin-bottom:18px">Compose and send a beautiful email campaign</p>

      <div class="ec-card">
        <form id="ecForm" method="POST" action="/email-campaigns/new" style="display:grid;gap:14px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px">Campaign Name *</label>
              <input type="text" name="name" required placeholder="e.g., January Fee Reminder" class="ec-inp">
            </div>
            <div>
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px">Template</label>
              <select name="template" id="tmplSelect" class="ec-inp" onchange="loadTemplate(this.value)">
                <option value="">— Choose a template —</option>
                ${tmplOpts}
              </select>
            </div>
          </div>

          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px">Subject Line *</label>
            <input type="text" name="subject" id="subjectInput" required placeholder="Use {{name}}, {{school_name}} for personalization" class="ec-inp">
            <div style="font-size:12px;color:#9ca3af;margin-top:3px">Available variables:
              <span class="ec-var">{{name}}</span>
              <span class="ec-var">{{school_name}}</span>
              <span class="ec-var">{{student_name}}</span>
              <span class="ec-var">{{class}}</span>
              <span class="ec-var">{{balance}}</span>
            </div>
          </div>

          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px">Preview Text (preheader)</label>
            <input type="text" name="preheader" placeholder="Short text shown in inbox after subject" class="ec-inp" maxlength="150">
          </div>

          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div>
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px">Sender Name</label>
              <input type="text" name="sender_name" placeholder="e.g., School Administration" class="ec-inp">
            </div>
            <div>
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px">Sender Email</label>
              <input type="email" name="sender_email" placeholder="e.g., admin@school.com" class="ec-inp">
            </div>
          </div>

          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px">Recipients *</label>
            <select name="recipient_type" id="recipientType" class="ec-inp" onchange="toggleRecipientFilter()" style="margin-bottom:8px">
              <option value="">— Select recipients —</option>
              <option value="all_parents">All Parents</option>
              <option value="all_students">All Students</option>
              <option value="all_staff">All Staff</option>
              <option value="specific_class">Specific Class</option>
              <option value="custom_list">Custom Email List</option>
              <option value="subscribers">Subscribers Only</option>
            </select>

            <div id="classFilter" style="display:none">
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;color:#6b7280">Select Class</label>
              <select name="filter_class" class="ec-inp">
                <option value="">— Choose class —</option>
                ${classOpts}
              </select>
            </div>

            <div id="customFilter" style="display:none">
              <label style="display:block;font-weight:600;margin-bottom:4px;font-size:13px;color:#6b7280">Email Addresses (one per line, or comma-separated)</label>
              <textarea name="custom_emails" rows="4" class="ec-inp" placeholder="parent1@email.com\nparent2@email.com"></textarea>
            </div>

            <div id="subscriberInfo" style="display:none">
              <div style="background:#fff7ed;border:1px solid #fed7aa;border-radius:8px;padding:10px;font-size:13px;color:#9a3412">
                Will send to all <strong>subscribed</strong> subscribers. <a href="/email-campaigns/subscribers" style="color:${THEME}">Manage subscribers</a>
                ${tagChips ? '<div style="margin-top:6px">Available tags: ' + tagChips + '</div>' : ''}
              </div>
            </div>
          </div>

          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px">Email Body (HTML) *</label>
            <div class="ec-editor">
              <div class="ec-editor-toolbar">
                <button type="button" onclick="toggleEditorMode()" id="modeBtn" title="Toggle HTML/Visual mode">HTML</button>
                <button type="button" onclick="insertTag('b')" title="Bold"><b>B</b></button>
                <button type="button" onclick="insertTag('i')" title="Italic"><i>I</i></button>
                <button type="button" onclick="insertTag('u')" title="Underline"><u>U</u></button>
                <span style="width:1px;height:24px;background:#e5e7eb;display:inline-block;vertical-align:middle"></span>
                <button type="button" onclick="insertTag('h2')" title="Heading">H2</button>
                <button type="button" onclick="insertTag('p')" title="Paragraph">¶</button>
                <button type="button" onclick="insertTag('ul')" title="Bullet list">• List</button>
                <button type="button" onclick="insertLink()" title="Link">🔗 Link</button>
                <button type="button" onclick="insertImage()" title="Image">🖼 Image</button>
                <span style="width:1px;height:24px;background:#e5e7eb;display:inline-block;vertical-align:middle"></span>
                <button type="button" onclick="insertVar('{{name}}')" class="ec-var" style="border:none;cursor:pointer;font-size:12px">{{name}}</button>
                <button type="button" onclick="insertVar('{{school_name}}')" class="ec-var" style="border:none;cursor:pointer;font-size:12px">{{school_name}}</button>
              </div>
              <textarea name="body_html" id="bodyHtml" required placeholder="<h1>Your email content</h1>&#10;<p>Write your message here...</p>"></textarea>
            </div>
          </div>

          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px">Plain Text Fallback</label>
            <textarea name="body_text" id="bodyText" rows="3" class="ec-inp" placeholder="Plain text version for email clients that don't support HTML" style="font-family:monospace"></textarea>
          </div>

          <div>
            <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px">Preview</label>
            <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;min-height:60px;max-height:200px;overflow-y:auto;background:#f9fafb" id="previewBox">
              <span style="color:#9ca3af">Preview will appear here…</span>
            </div>
          </div>

          <div class="ec-sched" id="schedBox" style="display:none">
            <label style="display:block;font-weight:600;margin-bottom:4px;font-size:14px">Schedule Date & Time *</label>
            <input type="datetime-local" name="scheduled_at" id="schedAt" class="ec-inp">
            <p style="font-size:11px;color:#9ca3af;margin-top:4px">Campaign will be sent at the specified time</p>
          </div>

          <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
            <button type="submit" class="ec-btn ec-btn-primary" id="submitBtn" onclick="setFormAction('save-draft')">Save as Draft</button>
            <button type="submit" class="ec-btn ec-btn-primary" id="sendNowBtn" onclick="setFormAction('send-now')">Send Now</button>
            <button type="button" class="ec-btn ec-btn-secondary" onclick="toggleSchedule()">Schedule for Later</button>
          </div>

          <div class="ec-tip">
            <strong>💡 Tips:</strong>
            <ul style="margin:6px 0 0;padding-left:18px;line-height:1.8">
              <li>Use <code>{{name}}</code>, <code>{{school_name}}</code>, <code>{{student_name}}</code> for personalization</li>
              <li>Use inline CSS styles — many email clients strip <code>&lt;style&gt;</code> blocks</li>
              <li>Keep emails under 100KB for best deliverability</li>
              <li>Always include a plain text fallback for accessibility</li>
            </ul>
          </div>
        </form>
      </div>

      <script>
      var editorMode = 'html'; // html or visual
      var formAction = 'save-draft';

      function setFormAction(action) {
        formAction = action;
        var form = document.getElementById('ecForm');
        if (action === 'send-now') {
          form.action = '/email-campaigns/' + action;
        } else {
          form.action = '/email-campaigns/new';
        }
      }

      function toggleEditorMode() {
        var ta = document.getElementById('bodyHtml');
        var btn = document.getElementById('modeBtn');
        var preview = document.getElementById('previewBox');
        if (editorMode === 'html') {
          editorMode = 'visual';
          btn.textContent = 'Visual';
          btn.classList.add('active');
          preview.innerHTML = ta.value || '<span style="color:#9ca3af">Preview…</span>';
        } else {
          editorMode = 'html';
          btn.textContent = 'HTML';
          btn.classList.remove('active');
        }
      }

      function updatePreview() {
        if (editorMode === 'visual') {
          document.getElementById('previewBox').innerHTML = document.getElementById('bodyHtml').value || '<span style="color:#9ca3af">Preview…</span>';
        }
      }

      document.getElementById('bodyHtml').addEventListener('input', updatePreview);

      function insertTag(tag) {
        var ta = document.getElementById('bodyHtml');
        var start = ta.selectionStart, end = ta.selectionEnd;
        var sel = ta.value.substring(start, end);
        var replacement;
        if (tag === 'ul') {
          replacement = '<ul>\\n  <li>' + (sel || 'Item') + '</li>\\n</ul>';
        } else if (tag === 'h2' || tag === 'p') {
          replacement = '<' + tag + '>' + (sel || 'Text') + '</' + tag + '>';
        } else {
          replacement = '<' + tag + '>' + (sel || 'text') + '</' + tag + '>';
        }
        ta.value = ta.value.substring(0, start) + replacement + ta.value.substring(end);
        ta.focus();
        ta.selectionStart = start + replacement.length;
        updatePreview();
      }

      function insertLink() {
        var url = prompt('Enter URL:', 'https://');
        if (!url) return;
        var ta = document.getElementById('bodyHtml');
        var start = ta.selectionStart, end = ta.selectionEnd;
        var sel = ta.value.substring(start, end) || 'Link text';
        var link = '<a href="' + url + '" style="color:${THEME}">' + sel + '</a>';
        ta.value = ta.value.substring(0, start) + link + ta.value.substring(end);
        ta.focus();
        updatePreview();
      }

      function insertImage() {
        var url = prompt('Enter image URL:', 'https://');
        if (!url) return;
        var ta = document.getElementById('bodyHtml');
        var pos = ta.selectionStart;
        var img = '<img src="' + url + '" alt="Image" style="max-width:100%;height:auto;border-radius:8px">';
        ta.value = ta.value.substring(0, pos) + img + ta.value.substring(pos);
        ta.focus();
        updatePreview();
      }

      function insertVar(v) {
        var ta = document.getElementById('bodyHtml');
        var pos = ta.selectionStart;
        ta.value = ta.value.substring(0, pos) + v + ta.value.substring(pos);
        ta.focus();
        updatePreview();
      }

      function toggleRecipientFilter() {
        var type = document.getElementById('recipientType').value;
        document.getElementById('classFilter').style.display = type === 'specific_class' ? 'block' : 'none';
        document.getElementById('customFilter').style.display = type === 'custom_list' ? 'block' : 'none';
        document.getElementById('subscriberInfo').style.display = type === 'subscribers' ? 'block' : 'none';
      }

      function toggleSchedule() {
        var box = document.getElementById('schedBox');
        var btn = document.getElementById('sendNowBtn');
        if (box.style.display === 'none') {
          box.style.display = 'block';
          btn.textContent = 'Save Scheduled';
          formAction = 'schedule';
        } else {
          box.style.display = 'none';
          btn.textContent = 'Send Now';
          formAction = 'send-now';
        }
      }

      // Template loader
      var templates = ${JSON.stringify(TEMPLATES.map(t => ({ key: t.key, subject: t.subject, body: t.body })))};

      function loadTemplate(key) {
        if (!key) return;
        var tmpl = templates.find(function(t) { return t.key === key; });
        if (tmpl) {
          document.getElementById('subjectInput').value = tmpl.subject;
          document.getElementById('bodyHtml').value = tmpl.body;
          updatePreview();
        }
      }
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  3. POST /email-campaigns/new — Save campaign (draft or send)
  // ═══════════════════════════════════════════════════════
  app.post('/email-campaigns/new', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { name, subject, preheader, body_html, body_text, sender_name, sender_email,
            recipient_type, filter_class, custom_emails, scheduled_at } = req.body;

    if (!name || !subject || !body_html || !recipient_type) {
      req.session.flash_ec = { msg: 'Please fill in all required fields (name, subject, body, recipients).', type: 'error' };
      return res.redirect('/email-campaigns/new');
    }

    // Build recipient filter
    let recipientFilter = {};
    if (recipient_type === 'specific_class') {
      recipientFilter = { class: filter_class || '' };
    } else if (recipient_type === 'custom_list') {
      const emails = (custom_emails || '').split(/[\n,;]+/).map(e => e.trim()).filter(e => e);
      recipientFilter = { emails };
    }

    // Determine recipient count
    const recipients = await getRecipients(tid, recipient_type, recipientFilter);
    const recipientCount = recipients.length;

    if (recipientCount === 0) {
      req.session.flash_ec = { msg: 'No recipients found for the selected type. Please choose a different recipient group.', type: 'error' };
      return res.redirect('/email-campaigns/new');
    }

    // Check if it's a scheduled send
    if (scheduled_at) {
      const result = await pool.query(`
        INSERT INTO email_campaigns_list (tenant_id, name, subject, preheader, body_html, body_text, sender_name, sender_email,
          status, recipient_type, recipient_filter, recipient_count, scheduled_at, created_by)
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'scheduled',$9,$10,$11,$12,$13) RETURNING id`,
        [tid, name, subject, preheader || null, body_html, body_text || null,
         sender_name || null, sender_email || null,
         recipient_type, JSON.stringify(recipientFilter), recipientCount,
         new Date(scheduled_at), uid]);
      req.session.flash_ec = { msg: `Campaign "${name}" scheduled for ${new Date(scheduled_at).toLocaleString()}. It will be sent to ${F(recipientCount)} recipients.`, type: 'success' };
      return res.redirect(`/email-campaigns/${result.rows[0].id}`);
    }

    // Save as draft
    const result = await pool.query(`
      INSERT INTO email_campaigns_list (tenant_id, name, subject, preheader, body_html, body_text, sender_name, sender_email,
        status, recipient_type, recipient_filter, recipient_count, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,$11,$12) RETURNING id`,
      [tid, name, subject, preheader || null, body_html, body_text || null,
       sender_name || null, sender_email || null,
       recipient_type, JSON.stringify(recipientFilter), recipientCount, uid]);

    req.session.flash_ec = { msg: `Campaign "${name}" saved as draft with ${F(recipientCount)} recipients.`, type: 'success' };
    res.redirect(`/email-campaigns/${result.rows[0].id}`);
  }));

  // POST /email-campaigns/send-now — Send campaign immediately from form
  app.post('/email-campaigns/send-now', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { name, subject, preheader, body_html, body_text, sender_name, sender_email,
            recipient_type, filter_class, custom_emails } = req.body;

    if (!name || !subject || !body_html || !recipient_type) {
      req.session.flash_ec = { msg: 'Please fill in all required fields.', type: 'error' };
      return res.redirect('/email-campaigns/new');
    }

    let recipientFilter = {};
    if (recipient_type === 'specific_class') {
      recipientFilter = { class: filter_class || '' };
    } else if (recipient_type === 'custom_list') {
      const emails = (custom_emails || '').split(/[\n,;]+/).map(e => e.trim()).filter(e => e);
      recipientFilter = { emails };
    }

    const recipients = await getRecipients(tid, recipient_type, recipientFilter);
    if (recipients.length === 0) {
      req.session.flash_ec = { msg: 'No recipients found.', type: 'error' };
      return res.redirect('/email-campaigns/new');
    }

    const campaign = {
      body_html, sender_name: sender_name || null, sender_email: sender_email || null, subject
    };

    // Create campaign record
    const result = await pool.query(`
      INSERT INTO email_campaigns_list (tenant_id, name, subject, preheader, body_html, body_text, sender_name, sender_email,
        status, recipient_type, recipient_filter, recipient_count, sent_count, sent_at, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'sent',$9,$10,$11,$11,NOW(),$12) RETURNING id`,
      [tid, name, subject, preheader || null, body_html, body_text || null,
       sender_name || null, sender_email || null,
       recipient_type, JSON.stringify(recipientFilter), recipients.length, uid]);

    const campaignId = result.rows[0].id;

    // Queue emails
    await queueCampaignEmails(tid, campaignId, campaign, recipients);

    req.session.flash_ec = { msg: `Campaign "${name}" is being sent to ${F(recipients.length)} recipients!`, type: 'success' };
    res.redirect(`/email-campaigns/${campaignId}`);
  }));

  // ═══════════════════════════════════════════════════════
  //  4. GET /email-campaigns/all — List all campaigns
  // ═══════════════════════════════════════════════════════
  app.get('/email-campaigns/all', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { status, q, date_from, date_to, page = 1 } = req.query;
    const off = (parseInt(page) - 1) * PS;

    let where = ['tenant_id=$1'];
    let params = [tid];
    let idx = 2;

    if (status && status !== 'all') {
      where.push(`status=$${idx++}`);
      params.push(status);
    }
    if (q) {
      where.push(`(name ILIKE $${idx} OR subject ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }
    if (date_from) {
      where.push(`created_at >= $${idx++}`);
      params.push(new Date(date_from));
    }
    if (date_to) {
      where.push(`created_at <= $${idx++}`);
      params.push(new Date(date_to + 'T23:59:59'));
    }

    const wc = where.join(' AND ');
    const [countR, campR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS t FROM email_campaigns_list WHERE ${wc}`, params),
      pool.query(`SELECT * FROM email_campaigns_list WHERE ${wc} ORDER BY created_at DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, PS, off]),
    ]);

    const total = countR.rows[0]?.t || 0;
    const camps = campR.rows;
    const qs = `status=${status || ''}&q=${q || ''}&date_from=${date_from || ''}&date_to=${date_to || ''}`;

    const rowsHtml = camps.length === 0
      ? '<tr><td colspan="7" style="text-align:center;padding:28px;color:#9ca3af">No campaigns found</td></tr>'
      : camps.map(c => {
        const delPct = c.recipient_count > 0 ? Math.round((c.sent_count / c.recipient_count) * 100) : 0;
        const openPct = c.sent_count > 0 ? ((c.open_count / c.sent_count) * 100).toFixed(1) : '0.0';
        return `<tr>
          <td><strong style="color:#374151">${esc(c.name)}</strong></td>
          <td style="font-size:13px">${esc((c.subject || '').substring(0, 35))}${(c.subject || '').length > 35 ? '…' : ''}</td>
          <td>${badge(c.status)}</td>
          <td style="font-size:13px">
            <div style="display:flex;align-items:center;gap:6px">
              <div class="ec-progress" style="max-width:60px"><div class="ec-progress-fill" style="width:${delPct}%;background:${delPct >= 100 ? '#16a34a' : THEME}"></div></div>
              <span>${delPct}%</span>
            </div>
          </td>
          <td style="font-size:12px;color:#6b7280">${c.status === 'sent' ? openPct + '% opens' : '—'}</td>
          <td style="font-size:12px;color:#6b7280">${ago(c.created_at)}</td>
          <td>
            <a href="/email-campaigns/${c.id}" class="ec-btn ec-btn-sm ec-btn-secondary">View</a>
            ${c.status === 'draft' ? `<button onclick="sendCamp(${c.id})" class="ec-btn ec-btn-sm ec-btn-primary">Send</button>` : ''}
            <button onclick="dupCamp(${c.id})" class="ec-btn ec-btn-sm ec-btn-secondary">Copy</button>
            ${['draft', 'sent', 'failed', 'paused'].includes(c.status) ? `<button onclick="delCamp(${c.id})" class="ec-btn ec-btn-sm ec-btn-danger">Delete</button>` : ''}
          </td>
        </tr>`;
      }).join('');

    res.send(renderPage('All Email Campaigns', `${CSS}${nav('all')}${flash(req)}
      <h2>All Campaigns</h2>
      <p style="color:#6b7280;margin-bottom:14px">View and manage all your email campaigns</p>

      <div class="ec-card">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          <div class="ec-fbar" style="margin:0">
            <input type="text" value="${esc(q || '')}" placeholder="Search campaigns…" id="fQ">
            <select id="fS">
              <option value="all">All Status</option>
              <option value="draft"${status === 'draft' ? ' selected' : ''}>Draft</option>
              <option value="scheduled"${status === 'scheduled' ? ' selected' : ''}>Scheduled</option>
              <option value="sending"${status === 'sending' ? ' selected' : ''}>Sending</option>
              <option value="sent"${status === 'sent' ? ' selected' : ''}>Sent</option>
              <option value="paused"${status === 'paused' ? ' selected' : ''}>Paused</option>
              <option value="failed"${status === 'failed' ? ' selected' : ''}>Failed</option>
            </select>
            <input type="date" value="${esc(date_from || '')}" id="fFrom" title="From date">
            <input type="date" value="${esc(date_to || '')}" id="fTo" title="To date">
            <button class="ec-btn ec-btn-sm ec-btn-primary" onclick="applyFilters()">Filter</button>
            <a href="/email-campaigns/all" class="ec-btn ec-btn-sm ec-btn-secondary">Clear</a>
          </div>
          <a href="/email-campaigns/new" class="ec-btn ec-btn-sm ec-btn-primary">+ New Campaign</a>
        </div>

        <table class="ec-table">
          <thead><tr><th>Name</th><th>Subject</th><th>Status</th><th>Delivery</th><th>Opens</th><th>Created</th><th>Actions</th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${pag('/email-campaigns/all', qs, page, total)}
        <div style="margin-top:10px;font-size:12px;color:#9ca3af">Showing ${camps.length} of ${F(total)} campaigns</div>
      </div>

      <script>
      function applyFilters() {
        var p = new URLSearchParams();
        var q = document.getElementById('fQ').value;
        var s = document.getElementById('fS').value;
        var from = document.getElementById('fFrom').value;
        var to = document.getElementById('fTo').value;
        if (q) p.set('q', q);
        if (s !== 'all') p.set('status', s);
        if (from) p.set('date_from', from);
        if (to) p.set('date_to', to);
        location.href = '/email-campaigns/all?' + p.toString();
      }
      function sendCamp(id) { if (confirm('Send this campaign now?')) fetch('/email-campaigns/' + id + '/send', {method:'POST'}).then(function(r){return r.json()}).then(function(d){alert(d.msg||'Sent!');location.reload()}).catch(function(){location.reload()}); }
      function dupCamp(id) { if (confirm('Duplicate this campaign?')) fetch('/email-campaigns/' + id + '/duplicate', {method:'POST'}).then(function(r){return r.json()}).then(function(d){location.href='/email-campaigns/'+d.id}).catch(function(){location.reload()}); }
      function delCamp(id) { if (confirm('Delete this campaign permanently?')) fetch('/email-campaigns/' + id + '/delete', {method:'POST'}).then(function(){location.reload()}).catch(function(){location.reload()}); }
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  5. GET /email-campaigns/:id — Campaign detail + analytics
  // ═══════════════════════════════════════════════════════
  app.get('/email-campaigns/:id', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const cid = parseInt(req.params.id);

    const camp = (await pool.query(
      `SELECT * FROM email_campaigns_list WHERE id=$1 AND tenant_id=$2`, [cid, tid]
    )).rows[0];

    if (!camp) {
      return res.send(renderPage('Not Found', `${CSS}
        <div class="ec-card" style="text-align:center;padding:40px">
          <h3 style="color:#dc2626;margin-bottom:12px">Campaign not found</h3>
          <a href="/email-campaigns/all" class="ec-btn ec-btn-sm ec-btn-secondary">Back to Campaigns</a>
        </div>`, req.session.user, req));
    }

    // Tracking data
    const tracking = (await pool.query(
      `SELECT tracking_type, COUNT(*)::int AS cnt FROM email_tracking WHERE campaign_id=$1 GROUP BY tracking_type ORDER BY cnt DESC`, [cid]
    )).rows;

    // Daily tracking for chart
    const dailyTracking = (await pool.query(
      `SELECT DATE(tracked_at) AS day, tracking_type, COUNT(*)::int AS cnt
       FROM email_tracking WHERE campaign_id=$1
       GROUP BY DATE(tracked_at), tracking_type
       ORDER BY day DESC LIMIT 14`, [cid]
    )).rows.reverse();

    // Recent tracking events
    const recentEvents = (await pool.query(
      `SELECT * FROM email_tracking WHERE campaign_id=$1 ORDER BY tracked_at DESC LIMIT 20`, [cid]
    )).rows;

    const openRate = camp.sent_count > 0 ? ((camp.open_count / camp.sent_count) * 100).toFixed(1) : '0.0';
    const clickRate = camp.sent_count > 0 ? ((camp.click_count / camp.sent_count) * 100).toFixed(1) : '0.0';
    const bounceRate = camp.sent_count > 0 ? ((camp.bounce_count / camp.sent_count) * 100).toFixed(1) : '0.0';
    const unsubRate = camp.sent_count > 0 ? ((camp.unsubscribe_count / camp.sent_count) * 100).toFixed(1) : '0.0';
    const deliveryPct = camp.recipient_count > 0 ? Math.round((camp.sent_count / camp.recipient_count) * 100) : 0;

    const trackingMap = {};
    tracking.forEach(t => { trackingMap[t.tracking_type] = t.cnt; });

    // Build daily chart data
    const dayMap = {};
    dailyTracking.forEach(d => {
      if (!dayMap[d.day]) dayMap[d.day] = { opens: 0, clicks: 0 };
      if (d.tracking_type === 'open') dayMap[d.day].opens = d.cnt;
      if (d.tracking_type === 'click') dayMap[d.day].clicks = d.cnt;
    });

    const chartHtml = Object.keys(dayMap).length > 0
      ? `<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-top:8px">
          <div><div style="font-size:12px;font-weight:600;color:#3b82f6;margin-bottom:4px">Opens</div>
            ${barChart(Object.entries(dayMap).map(([day, v]) => ({ label: new Date(day).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: v.opens })), '#3b82f6')}
          </div>
          <div><div style="font-size:12px;font-weight:600;color:#8b5cf6;margin-bottom:4px">Clicks</div>
            ${barChart(Object.entries(dayMap).map(([day, v]) => ({ label: new Date(day).toLocaleDateString('en', { month: 'short', day: 'numeric' }), value: v.clicks })), '#8b5cf6')}
          </div>
        </div>`
      : '<p style="text-align:center;padding:16px;color:#9ca3af">No tracking data yet</p>';

    const eventsHtml = recentEvents.length === 0
      ? '<p style="text-align:center;padding:16px;color:#9ca3af">No events recorded yet</p>'
      : recentEvents.map(e => {
        const typeIcon = { open: '👁️', click: '🔗', bounce: ' ↩️', unsubscribe: '✉️' };
        return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid #f3f4f6">
          <span style="font-size:16px">${typeIcon[e.tracking_type] || '📌'}</span>
          <div style="flex:1;min-width:0">
            <div style="font-size:13px"><strong>${esc(e.tracking_type)}</strong> — ${esc(e.recipient_email || 'unknown')}</div>
            ${e.metadata && e.metadata.link ? `<div style="font-size:11px;color:#6b7280;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">→ ${esc(e.metadata.link)}</div>` : ''}
          </div>
          <span style="font-size:11px;color:#9ca3af;flex-shrink:0">${ago(e.tracked_at)}</span>
        </div>`;
      }).join('');

    const canSend = ['draft', 'paused'].includes(camp.status);
    const canDelete = ['draft', 'sent', 'failed', 'paused'].includes(camp.status);

    // Funnel visualization
    const funnelHtml = `
      <div style="max-width:400px;margin:12px auto">
        <div style="text-align:center;margin-bottom:8px;font-size:13px;font-weight:600;color:#374151">Delivery Funnel</div>
        ${[
          { label: 'Recipients', value: camp.recipient_count, color: '#6b7280' },
          { label: 'Delivered', value: camp.sent_count, color: THEME },
          { label: 'Opened', value: camp.open_count, color: '#3b82f6' },
          { label: 'Clicked', value: camp.click_count, color: '#8b5cf6' },
          { label: 'Bounced', value: camp.bounce_count, color: '#ef4444' },
          { label: 'Unsubscribed', value: camp.unsubscribe_count, color: '#f59e0b' },
        ].map(item => {
          const w = camp.recipient_count > 0 ? Math.max(10, Math.round((item.value / camp.recipient_count) * 100)) : 10;
          return `<div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
            <span style="min-width:90px;font-size:12px;text-align:right;color:#6b7280">${item.label}</span>
            <div style="flex:1;height:20px;background:#f3f4f6;border-radius:4px;overflow:hidden">
              <div style="height:100%;width:${w}%;background:${item.color};border-radius:4px"></div>
            </div>
            <span style="min-width:40px;font-size:12px;font-weight:600">${F(item.value)}</span>
          </div>`;
        }).join('')}
      </div>`;

    res.send(renderPage('Campaign: ' + camp.name, `${CSS}${nav('all')}${flash(req)}
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:4px;flex-wrap:wrap">
        <a href="/email-campaigns/all" class="ec-btn ec-btn-sm ec-btn-secondary">&larr; Back</a>
        <h2 style="margin:0">${esc(camp.name)}</h2>
        ${badge(camp.status)}
      </div>
      <p style="color:#6b7280;margin-bottom:14px">Campaign details and performance analytics</p>

      <div class="ec-stats">
        <div class="ec-stat"><div class="ec-num" style="color:${THEME}">${F(camp.recipient_count)}</div><div class="ec-lbl">Recipients</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#16a34a">${F(camp.sent_count)}</div><div class="ec-lbl">Delivered</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#3b82f6">${openRate}%</div><div class="ec-lbl">Open Rate</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#8b5cf6">${clickRate}%</div><div class="ec-lbl">Click Rate</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#ef4444">${bounceRate}%</div><div class="ec-lbl">Bounce Rate</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#f59e0b">${unsubRate}%</div><div class="ec-lbl">Unsub Rate</div></div>
      </div>

      <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:14px">
        <div class="ec-card">
          <h3 style="margin:0 0 10px;font-size:15px">📊 Daily Tracking</h3>
          ${chartHtml}
        </div>
        <div class="ec-card">
          <h3 style="margin:0 0 10px;font-size:15px">Conversion Funnel</h3>
          ${funnelHtml}
        </div>
      </div>

      <div class="ec-card" style="margin-bottom:14px">
        <h3 style="margin:0 0 10px;font-size:15px">Email Content</h3>
        <div style="border:1px solid #e5e7eb;border-radius:8px;padding:12px;max-height:400px;overflow-y:auto;background:#f9fafb">
          <iframe srcdoc="${esc(camp.body_html)}" style="width:100%;min-height:250px;border:none;border-radius:4px" sandbox="allow-same-origin"></iframe>
        </div>
        <div style="margin-top:10px;display:flex;gap:14px;flex-wrap:wrap;font-size:13px;color:#6b7280">
          <span>To: <strong>${esc(camp.recipient_type || '')}</strong></span>
          ${camp.sender_email ? `<span>From: <strong>${esc(camp.sender_name || '')} &lt;${esc(camp.sender_email)}&gt;</strong></span>` : ''}
          <span>Created: ${ago(camp.created_at)}</span>
          ${camp.scheduled_at ? `<span>Scheduled: ${new Date(camp.scheduled_at).toLocaleString()}</span>` : ''}
          ${camp.sent_at ? `<span>Sent: ${new Date(camp.sent_at).toLocaleString()}</span>` : ''}
        </div>
        <div style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap">
          ${canSend ? `<button onclick="sendCamp(${camp.id})" class="ec-btn ec-btn-sm ec-btn-primary">Send Now</button>` : ''}
          <button onclick="dupCamp(${camp.id})" class="ec-btn ec-btn-sm ec-btn-secondary">Duplicate</button>
          ${canDelete ? `<button onclick="delCamp(${camp.id})" class="ec-btn ec-btn-sm ec-btn-danger">Delete</button>` : ''}
        </div>
      </div>

      <div class="ec-card">
        <h3 style="margin:0 0 10px;font-size:15px">Recent Activity (Last 20 events)</h3>
        ${eventsHtml}
      </div>

      <script>
      function sendCamp(id) { if (confirm('Send this campaign now?')) fetch('/email-campaigns/' + id + '/send', {method:'POST'}).then(function(r){return r.json()}).then(function(d){alert(d.msg||'Done!');location.reload()}).catch(function(){location.reload()}); }
      function dupCamp(id) { if (confirm('Duplicate this campaign?')) fetch('/email-campaigns/' + id + '/duplicate', {method:'POST'}).then(function(r){return r.json()}).then(function(d){location.href='/email-campaigns/'+d.id}).catch(function(){location.reload()}); }
      function delCamp(id) { if (confirm('Delete this campaign permanently?')) fetch('/email-campaigns/' + id + '/delete', {method:'POST'}).then(function(){location.href='/email-campaigns/all'}).catch(function(){location.reload()}); }
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  6. POST /email-campaigns/:id/send — Send campaign
  // ═══════════════════════════════════════════════════════
  app.post('/email-campaigns/:id/send', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const cid = parseInt(req.params.id);

    const camp = (await pool.query(
      `SELECT * FROM email_campaigns_list WHERE id=$1 AND tenant_id=$2`, [cid, tid]
    )).rows[0];

    if (!camp) {
      return res.status(404).json({ ok: false, msg: 'Campaign not found' });
    }

    if (!['draft', 'paused'].includes(camp.status)) {
      return res.status(400).json({ ok: false, msg: `Cannot send campaign with status "${camp.status}"` });
    }

    const filter = typeof camp.recipient_filter === 'string' ? JSON.parse(camp.recipient_filter) : (camp.recipient_filter || {});
    const recipients = await getRecipients(tid, camp.recipient_type, filter);

    if (recipients.length === 0) {
      return res.json({ ok: false, msg: 'No recipients found for this campaign.' });
    }

    // Update campaign status
    await pool.query(`
      UPDATE email_campaigns_list SET status='sent', recipient_count=$2, sent_count=$2, sent_at=NOW()
      WHERE id=$1 AND tenant_id=$3`, [cid, recipients.length, tid]);

    // Queue emails
    await queueCampaignEmails(tid, cid, camp, recipients);

    res.json({ ok: true, msg: `Campaign "${camp.name}" is being sent to ${F(recipients.length)} recipients.` });
  }));

  // ═══════════════════════════════════════════════════════
  //  7. POST /email-campaigns/:id/duplicate — Duplicate
  // ═══════════════════════════════════════════════════════
  app.post('/email-campaigns/:id/duplicate', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const cid = parseInt(req.params.id);

    const camp = (await pool.query(
      `SELECT * FROM email_campaigns_list WHERE id=$1 AND tenant_id=$2`, [cid, tid]
    )).rows[0];

    if (!camp) {
      return res.status(404).json({ ok: false, msg: 'Campaign not found' });
    }

    const result = await pool.query(`
      INSERT INTO email_campaigns_list (tenant_id, name, subject, preheader, body_html, body_text, sender_name, sender_email,
        status, recipient_type, recipient_filter, recipient_count, created_by)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'draft',$9,$10,0,$11) RETURNING id`,
      [tid, camp.name + ' (Copy)', camp.subject, camp.preheader, camp.body_html, camp.body_text,
       camp.sender_name, camp.sender_email, camp.recipient_type, camp.recipient_filter, uid]);

    res.json({ ok: true, id: result.rows[0].id });
  }));

  // ═══════════════════════════════════════════════════════
  //  8. POST /email-campaigns/:id/delete — Delete campaign
  // ═══════════════════════════════════════════════════════
  app.post('/email-campaigns/:id/delete', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const cid = parseInt(req.params.id);

    const camp = (await pool.query(
      `SELECT id FROM email_campaigns_list WHERE id=$1 AND tenant_id=$2`, [cid, tid]
    )).rows[0];

    if (!camp) {
      return res.status(404).json({ ok: false, msg: 'Campaign not found' });
    }

    // Delete tracking records first, then campaign
    await pool.query(`DELETE FROM email_tracking WHERE campaign_id=$1`, [cid]);
    await pool.query(`DELETE FROM email_campaigns_list WHERE id=$1 AND tenant_id=$2`, [cid, tid]);

    res.json({ ok: true });
  }));

  // ═══════════════════════════════════════════════════════
  //  9. GET /email-campaigns/subscribers — Subscriber management
  // ═══════════════════════════════════════════════════════
  app.get('/email-campaigns/subscribers', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { status, q, tag, page = 1 } = req.query;
    const off = (parseInt(page) - 1) * PS;

    let where = ['tenant_id=$1'];
    let params = [tid];
    let idx = 2;

    if (status && status !== 'all') {
      where.push(`status=$${idx++}`);
      params.push(status);
    }
    if (q) {
      where.push(`(email ILIKE $${idx} OR name ILIKE $${idx})`);
      params.push(`%${q}%`);
      idx++;
    }
    if (tag) {
      where.push(`$${idx} = ANY(tags)`);
      params.push(tag);
      idx++;
    }

    const wc = where.join(' AND ');
    const [countR, subR] = await Promise.all([
      pool.query(`SELECT COUNT(*)::int AS t FROM email_subscribers WHERE ${wc}`, params),
      pool.query(`SELECT * FROM email_subscribers WHERE ${wc} ORDER BY subscribed_at DESC LIMIT $${idx} OFFSET $${idx + 1}`, [...params, PS, off]),
    ]);

    const allTags = (await pool.query(
      `SELECT DISTINCT unnest(tags) AS tag FROM email_subscribers WHERE tenant_id=$1 AND array_length(tags,1)>0 ORDER BY tag`, [tid]
    )).rows.map(r => r.tag);

    const total = countR.rows[0]?.t || 0;
    const subs = subR.rows;
    const qs = `status=${status || ''}&q=${q || ''}&tag=${tag || ''}`;

    const stats = (await pool.query(`
      SELECT
        COUNT(*) FILTER (WHERE status='subscribed')::int AS active,
        COUNT(*) FILTER (WHERE status='unsubscribed')::int AS unsub,
        COUNT(*) FILTER (WHERE status='bounced')::int AS bounced
      FROM email_subscribers WHERE tenant_id=$1`, [tid])).rows[0];

    const rowsHtml = subs.length === 0
      ? '<tr><td colspan="5" style="text-align:center;padding:28px;color:#9ca3af">No subscribers found</td></tr>'
      : subs.map(s => {
        const statusBadge = s.status === 'subscribed'
          ? '<span class="ec-badge" style="background:#dcfce7;color:#16a34a">Active</span>'
          : s.status === 'unsubscribed'
            ? '<span class="ec-badge" style="background:#fef2f2;color:#dc2626">Unsubscribed</span>'
            : '<span class="ec-badge" style="background:#fef3c7;color:#92400e">Bounced</span>';
        const tagsHtml = (s.tags || []).map(t => `<span class="ec-tag">${esc(t)}</span>`).join('');
        return `<tr>
          <td>${esc(s.name || '—')}</td>
          <td style="font-family:monospace;font-size:13px">${esc(s.email)}</td>
          <td>${statusBadge}</td>
          <td>${tagsHtml || '<span style="color:#9ca3af">—</span>'}</td>
          <td style="font-size:12px;color:#6b7280">${ago(s.subscribed_at)}</td>
          <td>
            ${s.status === 'subscribed' ? `<button onclick="unsub(${s.id})" class="ec-btn ec-btn-sm ec-btn-danger" title="Unsubscribe">✉️</button>` : ''}
            <button onclick="delSub(${s.id})" class="ec-btn ec-btn-sm ec-btn-danger" title="Delete">🗑</button>
          </td>
        </tr>`;
      }).join('');

    const tagFilterHtml = allTags.length > 0
      ? `<select id="fTag"><option value="">All Tags</option>${allTags.map(t => `<option value="${esc(t)}"${tag === t ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`
      : '';

    res.send(renderPage('Email Subscribers', `${CSS}${nav('subscribers')}${flash(req)}
      <h2>Email Subscribers</h2>
      <p style="color:#6b7280;margin-bottom:14px">Manage your email subscriber list</p>

      <div class="ec-stats">
        <div class="ec-stat"><div class="ec-num" style="color:${THEME}">${F(stats.active)}</div><div class="ec-lbl">Active</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#ef4444">${F(stats.unsub)}</div><div class="ec-lbl">Unsubscribed</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#f59e0b">${F(stats.bounced)}</div><div class="ec-lbl">Bounced</div></div>
        <div class="ec-stat"><div class="ec-num" style="color:#6b7280">${F(total)}</div><div class="ec-lbl">Total</div></div>
      </div>

      <div class="ec-card" style="margin-bottom:14px">
        <h3 style="margin:0 0 14px;font-size:15px">Add Subscriber</h3>
        <form method="POST" action="/email-campaigns/subscribers/add" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end">
          <div style="flex:1;min-width:180px">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:2px">Email *</label>
            <input type="email" name="email" required class="ec-inp" placeholder="email@example.com">
          </div>
          <div style="flex:1;min-width:150px">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:2px">Name</label>
            <input type="text" name="name" class="ec-inp" placeholder="John Doe">
          </div>
          <div style="flex:1;min-width:150px">
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:2px">Tags (comma-separated)</label>
            <input type="text" name="tags" class="ec-inp" placeholder="parent, P1">
          </div>
          <button type="submit" class="ec-btn ec-btn-primary">Add</button>
        </form>
      </div>

      <div class="ec-card" style="margin-bottom:14px">
        <h3 style="margin:0 0 14px;font-size:15px">Bulk Import (CSV)</h3>
        <form method="POST" action="/email-campaigns/subscribers/import" style="display:grid;gap:10px;max-width:600px">
          <div>
            <label style="display:block;font-size:12px;font-weight:600;margin-bottom:2px">Paste CSV data or comma-separated emails</label>
            <textarea name="csv_data" rows="5" class="ec-inp" placeholder="email,name,tags&#10;parent1@school.com,John Parent,parent&#10;parent2@school.com,Jane Parent,parent,P2"></textarea>
          </div>
          <div style="display:flex;gap:10px;align-items:center">
            <div>
              <label style="display:block;font-size:12px;font-weight:600;margin-bottom:2px">Source</label>
              <select name="source" class="ec-inp" style="width:160px">
                <option value="import">Import</option>
                <option value="signup_form">Signup Form</option>
                <option value="manual">Manual</option>
              </select>
            </div>
            <button type="submit" class="ec-btn ec-btn-primary" style="margin-top:16px">Import</button>
          </div>
          <div class="ec-tip">CSV format: <code>email,name,tags</code> (one row per subscriber). The first row can be a header — it will be auto-detected.</div>
        </form>
      </div>

      <div class="ec-card">
        <div style="display:flex;justify-content:space-between;flex-wrap:wrap;gap:10px;margin-bottom:14px">
          <div class="ec-fbar" style="margin:0">
            <input type="text" value="${esc(q || '')}" placeholder="Search subscribers…" id="fQ">
            <select id="fS">
              <option value="all">All Status</option>
              <option value="subscribed"${status === 'subscribed' ? ' selected' : ''}>Active</option>
              <option value="unsubscribed"${status === 'unsubscribed' ? ' selected' : ''}>Unsubscribed</option>
              <option value="bounced"${status === 'bounced' ? ' selected' : ''}>Bounced</option>
            </select>
            ${tagFilterHtml}
            <button class="ec-btn ec-btn-sm ec-btn-primary" onclick="applyFilters()">Filter</button>
            <a href="/email-campaigns/subscribers" class="ec-btn ec-btn-sm ec-btn-secondary">Clear</a>
          </div>
          <button class="ec-btn ec-btn-sm ec-btn-secondary" onclick="exportSubs()">📥 Export CSV</button>
        </div>

        <table class="ec-table">
          <thead><tr><th>Name</th><th>Email</th><th>Status</th><th>Tags</th><th>Added</th><th></th></tr></thead>
          <tbody>${rowsHtml}</tbody>
        </table>
        ${pag('/email-campaigns/subscribers', qs, page, total)}
        <div style="margin-top:10px;font-size:12px;color:#9ca3af">Showing ${subs.length} of ${F(total)} subscribers</div>
      </div>

      <script>
      function applyFilters() {
        var p = new URLSearchParams();
        var q = document.getElementById('fQ').value;
        var s = document.getElementById('fS').value;
        var tagEl = document.getElementById('fTag');
        if (q) p.set('q', q);
        if (s !== 'all') p.set('status', s);
        if (tagEl && tagEl.value) p.set('tag', tagEl.value);
        location.href = '/email-campaigns/subscribers?' + p.toString();
      }
      function unsub(id) { if (confirm('Unsubscribe this email?')) fetch('/email-campaigns/subscribers/'+id+'/unsubscribe',{method:'POST'}).then(function(){location.reload()}); }
      function delSub(id) { if (confirm('Delete this subscriber?')) fetch('/email-campaigns/subscribers/'+id+'/delete',{method:'POST'}).then(function(){location.reload()}); }
      function exportSubs() {
        var p = new URLSearchParams(location.search);
        location.href = '/email-campaigns/subscribers/export?' + p.toString();
      }
      </script>`, req.session.user, req));
  }));

  // Subscriber delete (inline)
  app.post('/email-campaigns/subscribers/:id/delete', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`DELETE FROM email_subscribers WHERE id=$1 AND tenant_id=$2`, [parseInt(req.params.id), tid]);
    res.redirect('/email-campaigns/subscribers');
  }));

  // Subscriber unsubscribe (inline)
  app.post('/email-campaigns/subscribers/:id/unsubscribe', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    await pool.query(`UPDATE email_subscribers SET status='unsubscribed' WHERE id=$1 AND tenant_id=$2`, [parseInt(req.params.id), tid]);
    res.redirect('/email-campaigns/subscribers');
  }));

  // Subscriber export (CSV)
  app.get('/email-campaigns/subscribers/export', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { status, q, tag } = req.query;

    let where = ['tenant_id=$1'];
    let params = [tid];
    let idx = 2;

    if (status && status !== 'all') { where.push(`status=$${idx++}`); params.push(status); }
    if (q) { where.push(`(email ILIKE $${idx} OR name ILIKE $${idx})`); params.push(`%${q}%`); idx++; }
    if (tag) { where.push(`$${idx} = ANY(tags)`); params.push(tag); idx++; }

    const { rows } = await pool.query(
      `SELECT email, name, tags, status, source, subscribed_at FROM email_subscribers WHERE ${where.join(' AND ')} ORDER BY email`,
      params
    );

    const header = 'Email,Name,Tags,Status,Source,Subscribed At';
    const csv = [header, ...rows.map(r =>
      `"${(r.email || '').replace(/"/g, '""')}","${(r.name || '').replace(/"/g, '""')}","${(r.tags || []).join('; ')}","${r.status}","${r.source || ''}","${r.subscribed_at || ''}"`
    )].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="subscribers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send(csv);
  }));

  // ═══════════════════════════════════════════════════════
  //  10. POST /email-campaigns/subscribers/add — Add subscriber
  // ═══════════════════════════════════════════════════════
  app.post('/email-campaigns/subscribers/add', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { email, name, tags } = req.body;

    if (!email || !isValidEmail(email)) {
      req.session.flash_ec = { msg: 'Please provide a valid email address.', type: 'error' };
      return res.redirect('/email-campaigns/subscribers');
    }

    const parsedTags = typeof tags === 'string' ? tags.split(',').map(t => t.trim()).filter(Boolean) : [];

    try {
      await pool.query(`
        INSERT INTO email_subscribers (tenant_id, email, name, tags, status, source)
        VALUES ($1, $2, $3, $4, 'subscribed', 'manual')
        ON CONFLICT (tenant_id, email) DO UPDATE SET
          name = COALESCE(EXCLUDED.name, email_subscribers.name),
          tags = CASE WHEN email_subscribers.status = 'unsubscribed' THEN EXCLUDED.tags ELSE email_subscribers.tags END,
          status = CASE WHEN email_subscribers.status != 'bounced' THEN 'subscribed' ELSE email_subscribers.status END,
          source = 'manual'`,
        [tid, email.trim().toLowerCase(), name || null, parsedTags]);

      req.session.flash_ec = { msg: `Subscriber ${email} added successfully.`, type: 'success' };
    } catch (e) {
      req.session.flash_ec = { msg: 'Error adding subscriber: ' + e.message, type: 'error' };
    }

    res.redirect('/email-campaigns/subscribers');
  }));

  // ═══════════════════════════════════════════════════════
  //  11. POST /email-campaigns/subscribers/import — Bulk import
  // ═══════════════════════════════════════════════════════
  app.post('/email-campaigns/subscribers/import', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { csv_data, source } = req.body;

    if (!csv_data || !csv_data.trim()) {
      req.session.flash_ec = { msg: 'Please provide CSV data to import.', type: 'error' };
      return res.redirect('/email-campaigns/subscribers');
    }

    const lines = csv_data.trim().split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length === 0) {
      req.session.flash_ec = { msg: 'No data found to import.', type: 'error' };
      return res.redirect('/email-campaigns/subscribers');
    }

    // Auto-detect header row
    let startIdx = 0;
    const firstLine = lines[0].toLowerCase();
    if (firstLine.includes('email') || firstLine.includes('name') || firstLine.includes('tag')) {
      startIdx = 1;
    }

    let imported = 0, skipped = 0, errors = 0;

    for (let i = startIdx; i < lines.length; i++) {
      const line = lines[i];
      const parts = line.split(',').map(p => p.trim().replace(/^["']|["']$/g, ''));

      const email = (parts[0] || '').toLowerCase();
      const name = parts[1] || null;
      const tagsStr = parts.slice(2).join(',').trim();
      const tags = tagsStr ? tagsStr.split(/[;,]/).map(t => t.trim()).filter(Boolean) : [];

      if (!isValidEmail(email)) {
        skipped++;
        continue;
      }

      try {
        await pool.query(`
          INSERT INTO email_subscribers (tenant_id, email, name, tags, status, source)
          VALUES ($1, $2, $3, $4, 'subscribed', $5)
          ON CONFLICT (tenant_id, email) DO UPDATE SET
            name = COALESCE(EXCLUDED.name, email_subscribers.name),
            tags = EXCLUDED.tags,
            status = CASE WHEN email_subscribers.status != 'bounced' THEN 'subscribed' ELSE email_subscribers.status END`,
          [tid, email, name, tags, source || 'import']);
        imported++;
      } catch (e) {
        errors++;
      }
    }

    req.session.flash_ec = {
      msg: `Import complete: ${imported} imported, ${skipped} skipped (invalid email), ${errors} errors.`,
      type: imported > 0 ? 'success' : 'error'
    };
    res.redirect('/email-campaigns/subscribers');
  }));

  // ═══════════════════════════════════════════════════════
  //  12. GET /email-campaigns/templates — Pre-built templates
  // ═══════════════════════════════════════════════════════
  app.get('/email-campaigns/templates', requireAuth, requireSubscription('pro'), ah(async (req, res) => {
    const tid = req.session.user.tenant_id;

    const catColors = {
      billing: '#f59e0b',
      events: '#3b82f6',
      general: '#6b7280',
      academic: '#8b5cf6',
      attendance: '#ef4444',
    };

    const tmplHtml = TEMPLATES.map(t => {
      const color = catColors[t.category] || '#6b7280';
      const vars = (t.subject.match(/\{\{(\w+)\}\}/g) || []).concat(
        (t.body.match(/\{\{(\w+)\}\}/g) || [])
      );
      const uniqueVars = [...new Set(vars)];

      return `<div class="ec-tmpl-card">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px">
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:24px">${t.icon}</span>
            <div>
              <strong style="font-size:15px;color:#1f2937">${esc(t.name)}</strong>
              <span style="display:inline-block;padding:1px 8px;border-radius:10px;font-size:11px;font-weight:600;background:${color}15;color:${color};margin-left:6px">${esc(t.category)}</span>
            </div>
          </div>
        </div>
        <p style="font-size:13px;color:#6b7280;line-height:1.4;margin:0 0 8px">${esc(t.description)}</p>
        <div style="font-size:13px;color:#374151;margin-bottom:6px"><strong>Subject:</strong> ${esc(t.subject)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:3px;margin-bottom:10px">
          ${uniqueVars.map(v => `<span class="ec-var">${esc(v)}</span>`).join('')}
        </div>
        <div style="border:1px solid #e5e7eb;border-radius:6px;padding:10px;max-height:120px;overflow:hidden;position:relative;background:#f9fafb;margin-bottom:10px">
          <div style="font-size:11px;color:#9ca3af;pointer-events:none;filter:blur(1px)">${esc(t.body.substring(0, 500))}…</div>
          <div style="position:absolute;bottom:0;left:0;right:0;height:40px;background:linear-gradient(transparent,#f9fafb)"></div>
        </div>
        <div style="display:flex;gap:6px">
          <button onclick="useTemplate('${t.key}')" class="ec-btn ec-btn-sm ec-btn-primary">Use Template</button>
          <button onclick="previewTemplate('${t.key}')" class="ec-btn ec-btn-sm ec-btn-secondary">Preview</button>
        </div>
      </div>`;
    }).join('');

    const varsList = ['{{name}}', '{{school_name}}', '{{student_name}}', '{{class}}', '{{balance}}', '{{term}}', '{{grade}}', '{{comment}}',
      '{{event_name}}', '{{event_date}}', '{{event_time}}', '{{venue}}', '{{dress_code}}',
      '{{month}}', '{{highlights}}', '{{upcoming_events}}', '{{achievements}}', '{{date}}'];

    res.send(renderPage('Email Templates', `${CSS}${nav('templates')}${flash(req)}
      <h2>Email Templates</h2>
      <p style="color:#6b7280;margin-bottom:18px">Pre-built templates for common school communications. Click "Use Template" to start composing.</p>

      <div class="ec-card" style="margin-bottom:18px">
        <h3 style="margin:0 0 10px;font-size:15px">📋 Available Variables</h3>
        <p style="font-size:13px;color:#6b7280;margin-bottom:8px">Use these variables in your email subject and body for personalization:</p>
        <div style="display:flex;flex-wrap:wrap;gap:4px">
          ${varsList.map(v => `<span class="ec-var">${esc(v)}</span>`).join('')}
        </div>
        <div class="ec-tip" style="margin-top:10px">
          <strong>How variables work:</strong> When sending a campaign, <code>{{name}}</code> is replaced with the recipient's name.
          Some variables like <code>{{student_name}}</code> and <code>{{balance}}</code> require the recipient to be a parent with linked student data.
          School-level variables like <code>{{school_name}}</code> use your organization's name.
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(360px,1fr));gap:14px">
        ${tmplHtml}
      </div>

      <!-- Template Preview Modal -->
      <div id="previewModal" style="display:none" class="ec-modal-overlay" onclick="if(event.target===this)this.style.display='none'">
        <div class="ec-modal" style="max-width:650px;max-height:85vh">
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px">
            <h3 style="margin:0" id="previewTitle">Template Preview</h3>
            <button onclick="document.getElementById('previewModal').style.display='none'" style="background:none;border:none;font-size:20px;cursor:pointer;color:#6b7280">&times;</button>
          </div>
          <iframe id="previewFrame" style="width:100%;min-height:400px;border:1px solid #e5e7eb;border-radius:8px" sandbox="allow-same-origin"></iframe>
          <div style="margin-top:12px;text-align:right">
            <button id="previewUseBtn" class="ec-btn ec-btn-primary" onclick="">Use This Template</button>
          </div>
        </div>
      </div>

      <script>
      var templates = ${JSON.stringify(TEMPLATES)};

      function useTemplate(key) {
        var tmpl = templates.find(function(t) { return t.key === key; });
        if (!tmpl) return;
        // Store in sessionStorage and redirect to new campaign
        try {
          sessionStorage.setItem('ec_template', JSON.stringify({ key: tmpl.key, subject: tmpl.subject, body: tmpl.body }));
        } catch(e) {}
        location.href = '/email-campaigns/new?template=' + key;
      }

      function previewTemplate(key) {
        var tmpl = templates.find(function(t) { return t.key === key; });
        if (!tmpl) return;
        document.getElementById('previewTitle').textContent = tmpl.name;
        document.getElementById('previewFrame').srcdoc = tmpl.body;
        document.getElementById('previewUseBtn').onclick = function() { useTemplate(key); };
        document.getElementById('previewModal').style.display = 'flex';
      }

      // Auto-load template from sessionStorage if redirected from template page
      (function() {
        try {
          var stored = sessionStorage.getItem('ec_template');
          if (stored) {
            sessionStorage.removeItem('ec_template');
            var tmpl = JSON.parse(stored);
            var selEl = document.getElementById('tmplSelect');
            if (selEl) {
              selEl.value = tmpl.key;
              if (typeof loadTemplate === 'function') loadTemplate(tmpl.key);
            }
          }
        } catch(e) {}
      })();
      </script>`, req.session.user, req));
  }));

  // ═══════════════════════════════════════════════════════
  //  SCHEDULED CAMPAIGN CRON (checks every 5 minutes)
  // ═══════════════════════════════════════════════════════
  setInterval(async () => {
    try {
      // Find campaigns that are scheduled and due
      const due = (await pool.query(`
        SELECT * FROM email_campaigns_list
        WHERE status='scheduled' AND scheduled_at <= NOW()
        LIMIT 10`)).rows;

      for (const camp of due) {
        const filter = typeof camp.recipient_filter === 'string' ? JSON.parse(camp.recipient_filter) : (camp.recipient_filter || {});
        const recipients = await getRecipients(camp.tenant_id, camp.recipient_type, filter);

        if (recipients.length > 0) {
          // Update status
          await pool.query(`
            UPDATE email_campaigns_list SET status='sent', recipient_count=$2, sent_count=$2, sent_at=NOW()
            WHERE id=$1`, [camp.id, recipients.length]);

          // Queue emails
          await queueCampaignEmails(camp.tenant_id, camp.id, camp, recipients);

          console.log(`[EmailCampaigns] Scheduled campaign "${camp.name}" sent to ${recipients.length} recipients`);
        } else {
          await pool.query(`
            UPDATE email_campaigns_list SET status='failed' WHERE id=$1`, [camp.id]);
          console.warn(`[EmailCampaigns] Scheduled campaign "${camp.name}" failed: no recipients`);
        }
      }
    } catch (e) {
      console.error('[EmailCampaigns] Scheduler error:', e.message);
    }
  }, 5 * 60 * 1000); // Check every 5 minutes

};
