// ============================================================
// LIVE CHAT WIDGET CONFIGURATION MODULE
// Manage widget settings, canned responses, departments,
// analytics, and embed code for the live chat system.
// ============================================================
// Usage in server.js:
//   const liveChatConfig = require('./live-chat-config');
//   liveChatConfig(app, pool, { esc, renderPage, requireAuth, ah, logger });
// ============================================================

'use strict';

// ============================================================
// INTERNAL HELPERS
// ============================================================
const formatDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '-';
const formatDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-';
const relativeTime = (dateStr) => {
  if (!dateStr) return '';
  const now = new Date(), d = new Date(dateStr);
  const diffSec = Math.floor((now - d) / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);
  if (diffSec < 60) return 'just now';
  if (diffMin < 60) return diffMin + 'm ago';
  if (diffHr < 24) return diffHr + 'h ago';
  if (diffDay < 7) return diffDay + 'd ago';
  return formatDate(dateStr);
};

function statusBadge(active) {
  return active
    ? '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#052e16;color:#4ade80">● Active</span>'
    : '<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:700;background:#450a0a;color:#f87171">● Inactive</span>';
}

function categoryBadge(category) {
  const map = {
    general:    { bg: '#1e3a5f', c: '#60a5fa', icon: '💬' },
    greeting:   { bg: '#1e3a5f', c: '#60a5fa', icon: '👋' },
    support:    { bg: '#1a2e1a', c: '#4ade80', icon: '🔧' },
    sales:      { bg: '#2e2a1a', c: '#fbbf24', icon: '💰' },
    faq:        { bg: '#2e1a2e', c: '#c084fc', icon: '❓' },
    technical:  { bg: '#1a2e2e', c: '#22d3ee', icon: '⚙️' },
    billing:    { bg: '#2e2a1a', c: '#fb923c', icon: '💳' },
    onboarding: { bg: '#1a2e2e', c: '#2dd4bf', icon: '🚀' }
  };
  const s = map[category] || map.general;
  return `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${s.bg};color:${s.c}">${s.icon} ${category}</span>`;
}

// ============================================================
// SHARED CSS — Dark theme, blue accents
// ============================================================
const LC_CSS = `<style>
*{box-sizing:border-box}
.lc-container{max-width:1200px;margin:0 auto;padding:20px}
.lc-header{display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:16px}
.lc-header h1{font-size:26px;font-weight:800;color:#f1f5f9;margin:0}
.lc-header p{font-size:13px;color:#64748b;margin:4px 0 0}
.lc-nav{display:flex;gap:6px;margin-bottom:24px;flex-wrap:wrap}
.lc-nav a{padding:8px 16px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#94a3b8;background:#1e293b;transition:.15s;border:1px solid #334155}
.lc-nav a:hover{background:#334155;color:#e2e8f0}
.lc-nav a.active{background:#3b82f6;color:#fff;border-color:#3b82f6}
.lc-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(180px,1fr));gap:14px;margin-bottom:24px}
.lc-stat{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:20px;text-align:center;transition:.15s}
.lc-stat:hover{border-color:#3b82f6;box-shadow:0 0 20px rgba(59,130,246,.1)}
.lc-stat-val{font-size:32px;font-weight:800;color:#f1f5f9}
.lc-stat-lbl{font-size:11px;color:#64748b;margin-top:6px;text-transform:uppercase;letter-spacing:.5px}
.lc-stat-icon{font-size:24px;margin-bottom:6px}
.lc-card{background:#1e293b;border:1px solid #334155;border-radius:14px;padding:24px;margin-bottom:16px}
.lc-card h2{font-size:18px;font-weight:700;color:#f1f5f9;margin:0 0 16px}
.lc-card h3{font-size:15px;font-weight:700;color:#e2e8f0;margin:0 0 12px}
.lc-grid{display:grid;grid-template-columns:1fr 1fr;gap:16px}
.lc-grid-3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:16px}
.lc-form label{display:block;font-size:12px;font-weight:600;color:#94a3b8;margin-bottom:6px;text-transform:uppercase;letter-spacing:.3px}
.lc-form input,.lc-form select,.lc-form textarea{width:100%;padding:10px 14px;border:1px solid #334155;border-radius:10px;font-size:14px;background:#0f172a;color:#f1f5f9;transition:.15s}
.lc-form input:focus,.lc-form select:focus,.lc-form textarea:focus{outline:none;border-color:#3b82f6;box-shadow:0 0 0 3px rgba(59,130,246,.15)}
.lc-form input::placeholder,.lc-form textarea::placeholder{color:#475569}
.lc-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.lc-btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.3)}
.lc-btn-primary{background:#3b82f6;color:#fff}
.lc-btn-primary:hover{background:#2563eb}
.lc-btn-success{background:#059669;color:#fff}
.lc-btn-success:hover{background:#047857}
.lc-btn-danger{background:#dc2626;color:#fff}
.lc-btn-danger:hover{background:#b91c1c}
.lc-btn-ghost{background:#334155;color:#94a3b8}
.lc-btn-ghost:hover{background:#475569;color:#e2e8f0}
.lc-btn-sm{padding:6px 12px;font-size:12px;border-radius:8px}
.lc-table{width:100%;border-collapse:collapse;font-size:13px}
.lc-table th{padding:10px 14px;text-align:left;border-bottom:1px solid #334155;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase;letter-spacing:.5px;background:#0f172a}
.lc-table td{padding:10px 14px;border-bottom:1px solid #1e293b;color:#cbd5e1}
.lc-table tr:hover{background:#1e293b}
.lc-table tr:hover td{color:#f1f5f9}
.lc-filter{display:flex;gap:10px;margin-bottom:16px;flex-wrap:wrap;align-items:end}
.lc-filter label{display:block;font-size:11px;font-weight:600;color:#64748b;margin-bottom:4px;text-transform:uppercase;letter-spacing:.3px}
.lc-filter input,.lc-filter select{padding:8px 14px;border:1px solid #334155;border-radius:10px;font-size:13px;background:#0f172a;color:#f1f5f9}
.lc-filter input:focus,.lc-filter select:focus{outline:none;border-color:#3b82f6}
.lc-toggle{position:relative;display:inline-block;width:44px;height:24px}
.lc-toggle input{opacity:0;width:0;height:0}
.lc-toggle .slider{position:absolute;cursor:pointer;inset:0;background:#334155;transition:.3s;border-radius:24px}
.lc-toggle .slider:before{content:'';position:absolute;height:18px;width:18px;left:3px;bottom:3px;background:#94a3b8;transition:.3s;border-radius:50%}
.lc-toggle input:checked+.slider{background:#3b82f6}
.lc-toggle input:checked+.slider:before{transform:translateX(20px);background:#fff}
.lc-color-row{display:flex;align-items:center;gap:12px}
.lc-color-row input[type="color"]{width:48px;height:40px;border:2px solid #334155;border-radius:8px;background:none;cursor:pointer;padding:2px}
.lc-code-block{background:#0f172a;border:1px solid #334155;border-radius:12px;padding:16px;font-family:'Fira Code',monospace;font-size:13px;color:#60a5fa;line-height:1.6;overflow-x:auto;white-space:pre-wrap;word-break:break-all}
.lc-empty{text-align:center;padding:48px 20px;color:#64748b}
.lc-empty-icon{font-size:48px;margin-bottom:12px;opacity:.5}
.lc-badge{display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.lc-divider{height:1px;background:#334155;margin:20px 0}
.lc-alert{padding:12px 16px;border-radius:10px;font-size:13px;margin-bottom:16px}
.lc-alert-info{background:#1e3a5f;border:1px solid #1d4ed8;color:#60a5fa}
.lc-alert-success{background:#052e16;border:1px solid #16a34a;color:#4ade80}
.lc-alert-warning{background:#422006;border:1px solid #d97706;color:#fbbf24}
.lc-preview-box{background:#0f172a;border:2px solid #334155;border-radius:16px;overflow:hidden;max-width:400px;margin:0 auto}
.lc-preview-header{background:#1e293b;padding:12px 16px;display:flex;align-items:center;gap:10px;border-bottom:1px solid #334155}
.lc-preview-dot{width:10px;height:10px;border-radius:50%}
.lc-preview-body{padding:20px;min-height:200px;display:flex;flex-direction:column;align-items:center;justify-content:center}
.lc-preview-bubble{padding:12px 18px;border-radius:18px;border-bottom-right-radius:4px;font-size:14px;line-height:1.5;max-width:280px}
.lc-preview-input{width:100%;padding:10px 14px;border:1px solid #334155;border-radius:24px;font-size:13px;background:#0f172a;color:#f1f5f9;margin-top:12px}
.lc-widget-preview{position:fixed;bottom:24px;right:24px;width:60px;height:60px;border-radius:50%;display:flex;align-items:center;justify-content:center;font-size:28px;cursor:pointer;z-index:1000;box-shadow:0 4px 20px rgba(0,0,0,.4);transition:.3s}
.lc-widget-preview:hover{transform:scale(1.1)}
.lc-usage-bar{height:6px;background:#334155;border-radius:3px;overflow:hidden;margin-top:4px}
.lc-usage-bar-fill{height:100%;border-radius:3px;transition:width .3s}
.lc-shortcut{font-family:'Fira Code',monospace;background:#0f172a;border:1px solid #334155;padding:2px 8px;border-radius:6px;font-size:11px;color:#fbbf24}
@media(max-width:768px){.lc-grid{grid-template-columns:1fr}.lc-grid-3{grid-template-columns:1fr}.lc-stats{grid-template-columns:1fr 1fr}.lc-filter{flex-direction:column}}
</style>`;

// ============================================================
// MODULE ENTRY POINT
// ============================================================
module.exports = function(app, pool, opts) {
  const esc = opts.esc;
  const renderPage = opts.renderPage;
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session || !req.session.user) return res.redirect('/login'); next(); });
  const ah = opts.ah || ((fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const logger = opts.logger || { info: console.log, warn: console.warn, error: console.error };

  if (!esc) throw new Error('opts.esc is required');
  if (!renderPage) throw new Error('opts.renderPage is required');

  // ============================================================
  // 1. DATABASE MIGRATIONS
  // ============================================================
  const migrations = [
    `CREATE TABLE IF NOT EXISTS chat_widget_config (
      id SERIAL PRIMARY KEY,
      widget_name TEXT DEFAULT 'Live Chat',
      primary_color TEXT DEFAULT '#3b82f6',
      position TEXT DEFAULT 'bottom-right',
      welcome_message TEXT,
      offline_message TEXT,
      max_queue INT DEFAULT 50,
      auto_reply_enabled BOOLEAN DEFAULT false,
      bot_name TEXT DEFAULT 'Assistant',
      bot_greeting TEXT,
      pre_chat_form BOOLEAN DEFAULT false,
      pre_chat_fields JSONB DEFAULT '[]',
      rating_enabled BOOLEAN DEFAULT true,
      transcript_enabled BOOLEAN DEFAULT true,
      sound_enabled BOOLEAN DEFAULT true,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      school_id INT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS chat_canned_responses (
      id SERIAL PRIMARY KEY,
      title TEXT NOT NULL,
      message TEXT NOT NULL,
      category TEXT DEFAULT 'general',
      shortcut TEXT,
      usage_count INT DEFAULT 0,
      is_active BOOLEAN DEFAULT true,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      school_id INT DEFAULT 1
    )`,
    `CREATE TABLE IF NOT EXISTS chat_departments (
      id SERIAL PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      agents JSONB DEFAULT '[]',
      max_concurrent INT DEFAULT 5,
      is_active BOOLEAN DEFAULT true,
      school_id INT DEFAULT 1
    )`,
    // Indexes)
    `CREATE INDEX IF NOT EXISTS idx_cwc_school ON chat_widget_config(school_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ccr_school ON chat_canned_responses(school_id)`,
    `CREATE INDEX IF NOT EXISTS idx_ccr_category ON chat_canned_responses(category)`,
    `CREATE INDEX IF NOT EXISTS idx_ccr_active ON chat_canned_responses(is_active)`,
    `CREATE INDEX IF NOT EXISTS idx_cdep_school ON chat_departments(school_id)`,
    `CREATE INDEX IF NOT EXISTS idx_cdep_active ON chat_departments(is_active)`
  ];

  // Seed data
  const seedData = [
    `INSERT INTO chat_canned_responses (title, message, category, shortcut) VALUES
      ('Welcome Greeting', 'Hello! Thank you for reaching out. How can I help you today?', 'greeting', '/welcome') ON CONFLICT DO NOTHING`,
    `INSERT INTO chat_canned_responses (title, message, category, shortcut) VALUES
      ('Hold Response', 'Please hold on for a moment while I look into this for you.', 'general', '/hold') ON CONFLICT DO NOTHING`,
    `INSERT INTO chat_canned_responses (title, message, category, shortcut) VALUES
      ('Transfer Department', 'Let me connect you with the right department for this query.', 'general', '/transfer') ON CONFLICT DO NOTHING`,
    `INSERT INTO chat_canned_responses (title, message, category, shortcut) VALUES
      ('Closing - Resolved', 'Glad I could help! Is there anything else I can assist you with?', 'general', '/resolved') ON CONFLICT DO NOTHING`,
    `INSERT INTO chat_canned_responses (title, message, category, shortcut) VALUES
      ('Technical Escalation', 'I understand the issue. Let me escalate this to our technical team for a closer look.', 'technical', '/escalate') ON CONFLICT DO NOTHING`,
    `INSERT INTO chat_canned_responses (title, message, category, shortcut) VALUES
      ('Billing Info', 'For billing inquiries, I can help you check your account balance, recent transactions, or update payment methods.', 'billing', '/billing') ON CONFLICT DO NOTHING`,
    `INSERT INTO chat_canned_responses (title, message, category, shortcut) VALUES
      ('Offline Notice', 'We are currently offline. Please leave a message and we will get back to you during business hours.', 'general', '/offline') ON CONFLICT DO NOTHING`
  ];

  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { logger.warn('[LiveChatConfig] Cannot connect to DB for migrations'); return; }
    try {
      for (const sql of migrations) { try { await client.query(sql); } catch(e) { /* skip */ } }
      for (const sql of seedData) { try { await client.query(sql); } catch(e) { /* skip */ } }
      logger.info({ msg: '[LiveChatConfig] Migrations and seed data applied', count: migrations.length });
    } catch (e) {
      logger.error({ msg: '[LiveChatConfig] Migration error', error: e.message });
    } finally { client.release(); }
  })();

  // ============================================================
  // HELPER: Navigation
  // ============================================================
  const nav = (active) => `<div class="lc-nav">
    <a href="/admin/chat-config" class="${active==='dashboard'?'active':''}">📊 Dashboard</a>
    <a href="/admin/chat-config/responses" class="${active==='responses'?'active':''}">📋 Responses</a>
    <a href="/admin/chat-config/departments" class="${active==='departments'?'active':''}">🏢 Departments</a>
    <a href="/admin/chat-config/analytics" class="${active==='analytics'?'active':''}">📈 Analytics</a>
    <a href="/admin/chat-config/embed-code" class="${active==='embed'?'active':''}">🧩 Embed Code</a>
    <a href="/admin/chat-config/widget/preview" class="${active==='preview'?'active':''}">👁 Preview</a>
  </div>`;

  // ============================================================
  // HELPER: Get or create widget config
  // ============================================================
  async function getWidgetConfig(schoolId) {
    let config = (await pool.query('SELECT * FROM chat_widget_config WHERE school_id = $1 ORDER BY id DESC LIMIT 1', [schoolId])).rows[0];
    if (!config) {
      config = (await pool.query(
        `INSERT INTO chat_widget_config (widget_name, primary_color, position, welcome_message, offline_message,
          auto_reply_enabled, bot_name, bot_greeting, pre_chat_form, pre_chat_fields, rating_enabled,
          transcript_enabled, sound_enabled, is_active, school_id)
         VALUES ('Live Chat', '#3b82f6', 'bottom-right', 'Hi there! How can we help you today?',
          'We are currently offline. Please leave a message.', false, 'Assistant',
          'Hello! I am your virtual assistant. How can I assist you?',
          false, '[]'::jsonb, true, true, true, true, $1) RETURNING *`,
        [schoolId]
      )).rows[0];
    }
    return config;
  }

  // ============================================================
  // ROUTE 1: GET /admin/chat-config — Configuration Dashboard
  // ============================================================
  app.get('/admin/chat-config', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const config = await getWidgetConfig(schoolId);
    const responsesCount = (await pool.query('SELECT COUNT(*)::int as cnt FROM chat_canned_responses WHERE school_id = $1 AND is_active = true', [schoolId])).rows[0].cnt;
    const departmentsCount = (await pool.query('SELECT COUNT(*)::int as cnt FROM chat_departments WHERE school_id = $1 AND is_active = true', [schoolId])).rows[0].cnt;
    const totalUsage = (await pool.query('SELECT COALESCE(SUM(usage_count), 0)::int as total FROM chat_canned_responses WHERE school_id = $1', [schoolId])).rows[0].total;
    const topResponses = (await pool.query(
      'SELECT title, category, usage_count FROM chat_canned_responses WHERE school_id = $1 ORDER BY usage_count DESC LIMIT 5',
      [schoolId]
    )).rows;
    const departments = (await pool.query(
      'SELECT name, agents, max_concurrent, is_active FROM chat_departments WHERE school_id = $1 ORDER BY name',
      [schoolId]
    )).rows;

    const html = LC_CSS + `<div class="lc-container">
      ${nav('dashboard')}
      <div class="lc-header">
        <div>
          <h1>💬 Live Chat Configuration</h1>
          <p>Manage your chat widget, canned responses, and departments</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/admin/chat-config/embed-code" class="lc-btn lc-btn-primary">🧩 Get Embed Code</a>
          <a href="/admin/chat-config/widget/preview" class="lc-btn lc-btn-ghost">👁 Preview Widget</a>
        </div>
      </div>

      <div class="lc-stats">
        <div class="lc-stat">
          <div class="lc-stat-icon">💬</div>
          <div class="lc-stat-val" style="color:${esc(config.primary_color)}">${config.is_active ? 'Live' : 'Off'}</div>
          <div class="lc-stat-lbl">Widget Status</div>
        </div>
        <div class="lc-stat">
          <div class="lc-stat-icon">📋</div>
          <div class="lc-stat-val">${responsesCount}</div>
          <div class="lc-stat-lbl">Active Responses</div>
        </div>
        <div class="lc-stat">
          <div class="lc-stat-icon">🏢</div>
          <div class="lc-stat-val">${departmentsCount}</div>
          <div class="lc-stat-lbl">Departments</div>
        </div>
        <div class="lc-stat">
          <div class="lc-stat-icon">📊</div>
          <div class="lc-stat-val">${totalUsage}</div>
          <div class="lc-stat-lbl">Total Response Uses</div>
        </div>
        <div class="lc-stat">
          <div class="lc-stat-icon">🎨</div>
          <div class="lc-stat-val" style="font-size:16px;color:${esc(config.primary_color)}">${esc(config.primary_color)}</div>
          <div class="lc-stat-lbl">Primary Color</div>
        </div>
      </div>

      <div class="lc-grid">
        <div class="lc-card">
          <h2>⚙️ Widget Settings</h2>
          <div style="display:flex;flex-direction:column;gap:12px">
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #334155">
              <div><div style="font-size:14px;color:#f1f5f9;font-weight:600">Widget Name</div><div style="font-size:12px;color:#64748b">Display name for the chat</div></div>
              <span style="color:#60a5fa;font-weight:600">${esc(config.widget_name)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #334155">
              <div><div style="font-size:14px;color:#f1f5f9;font-weight:600">Position</div><div style="font-size:12px;color:#64748b">Widget placement on page</div></div>
              <span style="color:#60a5fa;font-weight:600">${esc(config.position)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #334155">
              <div><div style="font-size:14px;color:#f1f5f9;font-weight:600">Max Queue</div><div style="font-size:12px;color:#64748b">Maximum visitors in queue</div></div>
              <span style="color:#60a5fa;font-weight:600">${config.max_queue}</span>
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #334155">
              <div><div style="font-size:14px;color:#f1f5f9;font-weight:600">Auto Reply</div><div style="font-size:12px;color:#64748b">Bot auto-response enabled</div></div>
              ${statusBadge(config.auto_reply_enabled)}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #334155">
              <div><div style="font-size:14px;color:#f1f5f9;font-weight:600">Pre-chat Form</div><div style="font-size:12px;color:#64748b">Collect info before chat</div></div>
              ${statusBadge(config.pre_chat_form)}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid #334155">
              <div><div style="font-size:14px;color:#f1f5f9;font-weight:600">Rating Enabled</div><div style="font-size:12px;color:#64748b">Post-chat satisfaction rating</div></div>
              ${statusBadge(config.rating_enabled)}
            </div>
            <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0">
              <div><div style="font-size:14px;color:#f1f5f9;font-weight:600">Sound Enabled</div><div style="font-size:12px;color:#64748b">Notification sounds</div></div>
              ${statusBadge(config.sound_enabled)}
            </div>
          </div>
          <div style="margin-top:16px">
            <a href="/admin/chat-config" onclick="document.getElementById('edit-widget-form').style.display=document.getElementById('edit-widget-form').style.display==='none'?'block':'none';return false" class="lc-btn lc-btn-primary lc-btn-sm">✏️ Edit Settings</a>
          </div>
          <form id="edit-widget-form" method="POST" action="/admin/chat-config/widget" class="lc-form" style="display:none;margin-top:16px">
            <div><label>Widget Name</label><input type="text" name="widget_name" value="${esc(config.widget_name)}"></div>
            <div><label>Primary Color</label><div class="lc-color-row"><input type="color" name="primary_color" value="${esc(config.primary_color)}"><input type="text" name="primary_color_text" value="${esc(config.primary_color)}" style="flex:1"></div></div>
            <div><label>Position</label><select name="position">
              <option value="bottom-right" ${config.position==='bottom-right'?'selected':''}>Bottom Right</option>
              <option value="bottom-left" ${config.position==='bottom-left'?'selected':''}>Bottom Left</option>
              <option value="top-right" ${config.position==='top-right'?'selected':''}>Top Right</option>
              <option value="top-left" ${config.position==='top-left'?'selected':''}>Top Left</option>
            </select></div>
            <div><label>Welcome Message</label><textarea name="welcome_message" rows="2">${esc(config.welcome_message || '')}</textarea></div>
            <div><label>Offline Message</label><textarea name="offline_message" rows="2">${esc(config.offline_message || '')}</textarea></div>
            <div><label>Max Queue Size</label><input type="number" name="max_queue" value="${config.max_queue}" min="1" max="500"></div>
            <div style="display:flex;gap:24px;flex-wrap:wrap">
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#cbd5e1;font-size:13px">
                <label class="lc-toggle"><input type="checkbox" name="auto_reply_enabled" ${config.auto_reply_enabled?'checked':''}><span class="slider"></span></label> Auto Reply
              </label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#cbd5e1;font-size:13px">
                <label class="lc-toggle"><input type="checkbox" name="pre_chat_form" ${config.pre_chat_form?'checked':''}><span class="slider"></span></label> Pre-chat Form
              </label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#cbd5e1;font-size:13px">
                <label class="lc-toggle"><input type="checkbox" name="rating_enabled" ${config.rating_enabled?'checked':''}><span class="slider"></span></label> Rating
              </label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#cbd5e1;font-size:13px">
                <label class="lc-toggle"><input type="checkbox" name="transcript_enabled" ${config.transcript_enabled?'checked':''}><span class="slider"></span></label> Transcript
              </label>
              <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#cbd5e1;font-size:13px">
                <label class="lc-toggle"><input type="checkbox" name="sound_enabled" ${config.sound_enabled?'checked':''}><span class="slider"></span></label> Sound
              </label>
            </div>
            <div class="lc-divider"></div>
            <h3 style="color:#60a5fa">🤖 Bot Settings</h3>
            <div><label>Bot Name</label><input type="text" name="bot_name" value="${esc(config.bot_name || '')}"></div>
            <div><label>Bot Greeting</label><textarea name="bot_greeting" rows="2">${esc(config.bot_greeting || '')}</textarea></div>
            <div style="display:flex;gap:10px">
              <button type="submit" class="lc-btn lc-btn-primary">💾 Save Settings</button>
              <button type="reset" class="lc-btn lc-btn-ghost" onclick="document.getElementById('edit-widget-form').style.display='none'">Cancel</button>
            </div>
          </form>
        </div>

        <div>
          <div class="lc-card">
            <h2>🏆 Top Responses</h2>
            ${topResponses.length === 0
              ? '<div class="lc-empty"><div class="lc-empty-icon">📋</div><p>No usage data yet</p></div>'
              : `<div style="display:flex;flex-direction:column;gap:8px">
                ${topResponses.map((r, i) => {
                  const maxUsage = topResponses[0].usage_count || 1;
                  const pct = Math.round((r.usage_count / maxUsage) * 100);
                  const colors = ['#3b82f6','#60a5fa','#93c5fd','#bfdbfe','#dbeafe'];
                  return `<div style="padding:8px 12px;background:#0f172a;border-radius:8px;border:1px solid #1e293b">
                    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">
                      <span style="font-size:13px;color:#e2e8f0;font-weight:600">${i+1}. ${esc(r.title)}</span>
                      <span style="font-size:12px;color:#64748b">${r.usage_count} uses</span>
                    </div>
                    <div class="lc-usage-bar"><div class="lc-usage-bar-fill" style="width:${pct}%;background:${colors[i]}"></div></div>
                  </div>`;
                }).join('')}
              </div>`
            }
          </div>

          <div class="lc-card">
            <h2>🏢 Departments</h2>
            ${departments.length === 0
              ? '<div class="lc-empty"><div class="lc-empty-icon">🏢</div><p>No departments yet</p><a href="/admin/chat-config/departments" class="lc-btn lc-btn-primary lc-btn-sm" style="margin-top:12px">Add Department</a></div>'
              : `<div style="display:flex;flex-direction:column;gap:8px">
                ${departments.slice(0, 5).map(d => {
                  const agents = Array.isArray(d.agents) ? d.agents : [];
                  return `<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 12px;background:#0f172a;border-radius:8px;border:1px solid #1e293b">
                    <div>
                      <div style="font-size:13px;color:#e2e8f9;font-weight:600">${esc(d.name)}</div>
                      <div style="font-size:11px;color:#64748b">${agents.length} agent${agents.length !== 1 ? 's' : ''} · Max ${d.max_concurrent} concurrent</div>
                    </div>
                    ${statusBadge(d.is_active)}
                  </div>`;
                }).join('')}
              </div>`
            }
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Live Chat Configuration', html, user));
  }));

  // ============================================================
  // ROUTE 2: PUT /admin/chat-config/widget — Update widget settings
  // ============================================================
  app.put('/admin/chat-config/widget', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const config = await getWidgetConfig(schoolId);
    const {
      widget_name, primary_color, primary_color_text, position,
      welcome_message, offline_message, max_queue,
      auto_reply_enabled, bot_name, bot_greeting,
      pre_chat_form, pre_chat_fields, rating_enabled,
      transcript_enabled, sound_enabled, is_active
    } = req.body;

    const color = primary_color_text || primary_color || config.primary_color;
    const maxQ = parseInt(max_queue) || 50;

    await pool.query(
      `UPDATE chat_widget_config SET
        widget_name = $1, primary_color = $2, position = $3,
        welcome_message = $4, offline_message = $5, max_queue = $6,
        auto_reply_enabled = $7, bot_name = $8, bot_greeting = $9,
        pre_chat_form = $10, pre_chat_fields = COALESCE($11, pre_chat_fields),
        rating_enabled = $12, transcript_enabled = $13, sound_enabled = $14,
        is_active = COALESCE($15, is_active)
       WHERE id = $16 AND school_id = $17`,
      [
        widget_name || config.widget_name,
        color,
        position || config.position,
        welcome_message !== undefined ? welcome_message : config.welcome_message,
        offline_message !== undefined ? offline_message : config.offline_message,
        maxQ,
        auto_reply_enabled === 'on' || auto_reply_enabled === true,
        bot_name || config.bot_name,
        bot_greeting !== undefined ? bot_greeting : config.bot_greeting,
        pre_chat_form === 'on' || pre_chat_form === true,
        pre_chat_fields || null,
        rating_enabled !== 'off' && rating_enabled !== false,
        transcript_enabled !== 'off' && transcript_enabled !== false,
        sound_enabled !== 'off' && sound_enabled !== false,
        is_active !== undefined ? (is_active === 'on' || is_active === true) : config.is_active,
        config.id,
        schoolId
      ]
    );

    logger.info({ msg: '[LiveChatConfig] Widget settings updated', by: user.email, schoolId });
    res.json({ success: true, message: 'Widget settings updated successfully' });
  }));

  // Also accept POST for form submissions
  app.post('/admin/chat-config/widget', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const config = await getWidgetConfig(schoolId);
    const {
      widget_name, primary_color, primary_color_text, position,
      welcome_message, offline_message, max_queue,
      auto_reply_enabled, bot_name, bot_greeting,
      pre_chat_form, rating_enabled, transcript_enabled, sound_enabled
    } = req.body;

    const color = primary_color_text || primary_color || config.primary_color;
    const maxQ = Math.min(500, Math.max(1, parseInt(max_queue) || 50));

    await pool.query(
      `UPDATE chat_widget_config SET
        widget_name = $1, primary_color = $2, position = $3,
        welcome_message = $4, offline_message = $5, max_queue = $6,
        auto_reply_enabled = $7, bot_name = $8, bot_greeting = $9,
        pre_chat_form = $10, rating_enabled = $11, transcript_enabled = $12,
        sound_enabled = $13
       WHERE id = $14 AND school_id = $15`,
      [
        widget_name || config.widget_name, color, position || config.position,
        welcome_message !== undefined ? welcome_message : config.welcome_message,
        offline_message !== undefined ? offline_message : config.offline_message,
        maxQ,
        auto_reply_enabled === 'on' || auto_reply_enabled === true,
        bot_name || config.bot_name,
        bot_greeting !== undefined ? bot_greeting : config.bot_greeting,
        pre_chat_form === 'on' || pre_chat_form === true,
        rating_enabled !== 'off' && rating_enabled !== false,
        transcript_enabled !== 'off' && transcript_enabled !== false,
        sound_enabled !== 'off' && sound_enabled !== false,
        config.id, schoolId
      ]
    );

    logger.info({ msg: '[LiveChatConfig] Widget settings updated via POST', by: user.email });
    res.redirect('/admin/chat-config');
  }));

  // ============================================================
  // ROUTE 3: GET /admin/chat-config/widget/preview — Widget Preview
  // ============================================================
  app.get('/admin/chat-config/widget/preview', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const config = await getWidgetConfig(schoolId);

    const html = LC_CSS + `<div class="lc-container">
      ${nav('preview')}
      <div class="lc-header">
        <div>
          <h1>👁 Widget Preview</h1>
          <p>See how your chat widget will appear to visitors</p>
        </div>
        <a href="/admin/chat-config" class="lc-btn lc-btn-ghost">← Back to Dashboard</a>
      </div>

      <div class="lc-grid">
        <div class="lc-card">
          <h2>🎨 Current Settings</h2>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Widget Name</span>
              <span style="color:#f1f5f9;font-size:13px;font-weight:600">${esc(config.widget_name)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Color</span>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="width:20px;height:20px;border-radius:50%;background:${esc(config.primary_color)};display:inline-block"></span>
                <span style="color:#f1f5f9;font-size:13px;font-family:monospace">${esc(config.primary_color)}</span>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Position</span>
              <span style="color:#f1f5f9;font-size:13px;font-weight:600">${esc(config.position)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Status</span>
              ${statusBadge(config.is_active)}
            </div>
          </div>
        </div>

        <div class="lc-card">
          <h2>💬 Widget Preview</h2>
          <div class="lc-preview-box">
            <div class="lc-preview-header">
              <span class="lc-preview-dot" style="background:#ef4444"></span>
              <span class="lc-preview-dot" style="background:#f59e0b"></span>
              <span class="lc-preview-dot" style="background:#22c55e"></span>
              <span style="color:#94a3b8;font-size:12px;margin-left:8px">Website Preview</span>
            </div>
            <div class="lc-preview-body" style="min-height:240px">
              <div style="width:100%;max-width:320px">
                <div style="background:${esc(config.primary_color)};color:#fff;padding:14px 16px;border-radius:16px 16px 4px 16px;font-size:14px;max-width:240px;margin-bottom:12px;line-height:1.5">
                  ${esc(config.welcome_message || 'Hi there! How can we help you today?')}
                </div>
                ${config.pre_chat_form ? `<div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:16px;margin-bottom:12px">
                  <div style="font-size:12px;color:#64748b;margin-bottom:8px">Before we start, please tell us:</div>
                  <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:13px;color:#475569">Your name...</div>
                  <div style="background:#0f172a;border:1px solid #334155;border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:13px;color:#475569">Your email...</div>
                  <div style="background:${esc(config.primary_color)};color:#fff;text-align:center;padding:8px;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer">Start Chat</div>
                </div>` : ''}
                <div style="background:#0f172a;border:1px solid #334155;border-radius:24px;padding:10px 16px;display:flex;align-items:center;gap:8px">
                  <span style="font-size:13px;color:#475569;flex:1">Type your message...</span>
                  <span style="color:${esc(config.primary_color)};font-size:18px;cursor:pointer">➤</span>
                </div>
              </div>
            </div>
          </div>
          <div style="text-align:center;margin-top:16px">
            <div style="display:inline-flex;align-items:center;gap:8px;padding:8px 16px;background:#0f172a;border-radius:10px;border:1px solid #334155">
              <div style="width:36px;height:36px;border-radius:50%;background:${esc(config.primary_color)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:18px">💬</div>
              <span style="color:#94a3b8;font-size:12px">Chat widget button</span>
            </div>
          </div>
        </div>
      </div>

      <div class="lc-card" style="margin-top:16px">
        <h2>🤖 Bot Preview</h2>
        ${config.auto_reply_enabled ? `
          <div class="lc-preview-box" style="max-width:500px">
            <div class="lc-preview-header" style="background:${esc(config.primary_color)}">
              <div style="width:32px;height:32px;border-radius:50%;background:rgba(255,255,255,.2);display:flex;align-items:center;justify-content:center;color:#fff;font-size:14px">🤖</div>
              <div><div style="color:#fff;font-weight:700;font-size:14px">${esc(config.bot_name || 'Assistant')}</div><div style="color:rgba(255,255,255,.7);font-size:11px">Online</div></div>
            </div>
            <div class="lc-preview-body" style="padding:16px">
              <div style="background:#1e293b;border:1px solid #334155;padding:10px 14px;border-radius:12px 12px 12px 4px;font-size:13px;color:#cbd5e1;max-width:280px;margin-bottom:10px;line-height:1.5">
                ${esc(config.bot_greeting || 'Hello! I am your virtual assistant.')}
              </div>
              <div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">
                ${['Common Question', 'Track Order', 'Talk to Agent'].map(q => `
                  <div style="background:#0f172a;border:1px solid #334155;padding:6px 14px;border-radius:20px;font-size:12px;color:#60a5fa;cursor:pointer">${q}</div>
                `).join('')}
              </div>
            </div>
          </div>
        ` : `<div class="lc-alert lc-alert-info">Auto-reply bot is currently disabled. Enable it in widget settings.</div>`}
      </div>
    </div>`;
    res.send(renderPage('Widget Preview', html, user));
  }));

  // ============================================================
  // ROUTE 4: GET /admin/chat-config/responses — List Canned Responses
  // ============================================================
  app.get('/admin/chat-config/responses', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const { category, search } = req.query;

    let where = ['school_id = $1'], params = [schoolId], pi = 2;
    if (category && category !== 'all') { where.push(`category = $${pi++}`); params.push(category); }
    if (search) { where.push(`(title ILIKE $${pi} OR message ILIKE $${pi})`); params.push('%' + search + '%'); pi++; }

    const responses = (await pool.query(
      `SELECT * FROM chat_canned_responses WHERE ${where.join(' AND ')} ORDER BY category, title ASC`,
      params
    )).rows;
    const categories = (await pool.query(
      `SELECT DISTINCT category, COUNT(*)::int as cnt FROM chat_canned_responses WHERE school_id = $1 GROUP BY category ORDER BY cnt DESC`,
      [schoolId]
    )).rows;

    const rows = responses.map(r => `<tr>
      <td><a href="#" onclick="document.getElementById('edit-resp-${r.id}').style.display='block';return false" style="color:#60a5fa;text-decoration:none;font-weight:600">${esc(r.title)}</a></td>
      <td style="max-width:300px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc((r.message || '').substring(0, 80))}${(r.message || '').length > 80 ? '...' : ''}</td>
      <td>${categoryBadge(r.category)}</td>
      <td>${r.shortcut ? `<span class="lc-shortcut">${esc(r.shortcut)}</span>` : '<span style="color:#475569">—</span>'}</td>
      <td><span style="color:#f1f5f9;font-weight:600">${r.usage_count}</span></td>
      <td>${statusBadge(r.is_active)}</td>
      <td>
        <div style="display:flex;gap:4px">
          <a href="#" onclick="document.getElementById('edit-resp-${r.id}').style.display='block';return false" class="lc-btn lc-btn-ghost lc-btn-sm">✏️</a>
          <form method="POST" action="/admin/chat-config/responses/${r.id}/delete" style="display:inline" onsubmit="return confirm('Delete this response?')">
            <button type="submit" class="lc-btn lc-btn-danger lc-btn-sm">🗑</button>
          </form>
        </div>
      </td>
    </tr>
    <tr id="edit-resp-${r.id}" style="display:none">
      <td colspan="7" style="background:#0f172a;padding:20px">
        <form method="POST" action="/admin/chat-config/responses/${r.id}" class="lc-form">
          <input type="hidden" name="_method" value="PUT">
          <div class="lc-grid">
            <div><label>Title</label><input type="text" name="title" value="${esc(r.title)}" required></div>
            <div><label>Category</label><select name="category">
              ${['general','greeting','support','sales','faq','technical','billing','onboarding'].map(c => `<option value="${c}" ${r.category===c?'selected':''}>${c}</option>`).join('')}
            </select></div>
          </div>
          <div><label>Message</label><textarea name="message" rows="3" required>${esc(r.message)}</textarea></div>
          <div class="lc-grid">
            <div><label>Shortcut</label><input type="text" name="shortcut" value="${esc(r.shortcut || '')}" placeholder="e.g., /welcome"></div>
            <div><label>Status</label><select name="is_active"><option value="true" ${r.is_active?'selected':''}>Active</option><option value="false" ${!r.is_active?'selected':''}>Inactive</option></select></div>
          </div>
          <div style="display:flex;gap:8px;margin-top:12px">
            <button type="submit" class="lc-btn lc-btn-primary lc-btn-sm">💾 Save</button>
            <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" onclick="document.getElementById('edit-resp-${r.id}').style.display='none'">Cancel</button>
          </div>
        </form>
      </td>
    </tr>`).join('');

    const html = LC_CSS + `<div class="lc-container">
      ${nav('responses')}
      <div class="lc-header">
        <div>
          <h1>📋 Canned Responses</h1>
          <p>Pre-written replies for quick agent responses</p>
        </div>
        <a href="#" onclick="document.getElementById('add-resp-form').style.display=document.getElementById('add-resp-form').style.display==='none'?'block':'none';return false" class="lc-btn lc-btn-primary">➕ New Response</a>
      </div>

      <div id="add-resp-form" style="display:none" class="lc-card">
        <h2>➕ Add Canned Response</h2>
        <form method="POST" action="/admin/chat-config/responses" class="lc-form">
          <div class="lc-grid">
            <div><label>Title *</label><input type="text" name="title" required placeholder="e.g., Welcome Greeting"></div>
            <div><label>Category</label><select name="category">
              <option value="general">General</option><option value="greeting">Greeting</option>
              <option value="support">Support</option><option value="sales">Sales</option>
              <option value="faq">FAQ</option><option value="technical">Technical</option>
              <option value="billing">Billing</option><option value="onboarding">Onboarding</option>
            </select></div>
          </div>
          <div><label>Message *</label><textarea name="message" rows="3" required placeholder="Type the response message..."></textarea></div>
          <div class="lc-grid">
            <div><label>Shortcut</label><input type="text" name="shortcut" placeholder="e.g., /welcome"></div>
            <div style="display:flex;align-items:end"><button type="submit" class="lc-btn lc-btn-primary">✅ Add Response</button></div>
          </div>
        </form>
      </div>

      <div class="lc-filter">
        <div><label>Category</label><select onchange="location.href='/admin/chat-config/responses?category='+this.value">
          <option value="all">All Categories</option>
          ${categories.map(c => `<option value="${esc(c.category)}" ${category===c.category?'selected':''}>${c.category} (${c.cnt})</option>`).join('')}
        </select></div>
        <div><label>Search</label><form method="GET" style="display:flex;gap:6px">
          <input type="hidden" name="category" value="${esc(category || '')}">
          <input type="text" name="search" value="${esc(search || '')}" placeholder="Search responses..." style="width:240px">
          <button type="submit" class="lc-btn lc-btn-ghost lc-btn-sm">🔍</button>
        </form></div>
      </div>

      <div class="lc-card" style="padding:0;overflow:hidden">
        ${responses.length === 0
          ? '<div class="lc-empty"><div class="lc-empty-icon">📋</div><p>No canned responses found</p></div>'
          : `<div style="overflow-x:auto"><table class="lc-table">
              <thead><tr><th>Title</th><th>Message</th><th>Category</th><th>Shortcut</th><th>Uses</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`
        }
      </div>
    </div>`;
    res.send(renderPage('Canned Responses', html, user));
  }));

  // ============================================================
  // ROUTE 5: POST /admin/chat-config/responses — Add Canned Response
  // ============================================================
  app.post('/admin/chat-config/responses', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const { title, message, category, shortcut } = req.body;

    if (!title || !title.trim() || !message || !message.trim()) {
      return res.redirect('/admin/chat-config/responses');
    }

    await pool.query(
      `INSERT INTO chat_canned_responses (title, message, category, shortcut, school_id)
       VALUES ($1, $2, $3, $4, $5)`,
      [title.trim(), message.trim(), category || 'general', shortcut ? shortcut.trim() : null, schoolId]
    );

    logger.info({ msg: '[LiveChatConfig] Canned response created', title: title.trim(), by: user.email });
    res.redirect('/admin/chat-config/responses');
  }));

  // ============================================================
  // ROUTE 6: PUT /admin/chat-config/responses/:id — Update Response
  // ============================================================
  app.put('/admin/chat-config/responses/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const respId = parseInt(req.params.id);
    const { title, message, category, shortcut, is_active } = req.body;

    const existing = (await pool.query('SELECT id FROM chat_canned_responses WHERE id = $1 AND school_id = $2', [respId, schoolId])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Response not found' });

    await pool.query(
      `UPDATE chat_canned_responses SET
        title = COALESCE($1, title),
        message = COALESCE($2, message),
        category = COALESCE($3, category),
        shortcut = $4,
        is_active = COALESCE($5, is_active)
       WHERE id = $6 AND school_id = $7`,
      [
        title ? title.trim() : null,
        message ? message.trim() : null,
        category || null,
        shortcut ? shortcut.trim() : null,
        is_active !== undefined ? (is_active === 'true' || is_active === true) : null,
        respId, schoolId
      ]
    );

    logger.info({ msg: '[LiveChatConfig] Canned response updated', id: respId, by: user.email });
    res.json({ success: true, message: 'Response updated' });
  }));

  // Also accept POST for form-based updates
  app.post('/admin/chat-config/responses/:id', requireAuth, ah(async (req, res) => {
    if (req.body._method === 'PUT') {
      req.body = { ...req.body, _method: undefined };
      return app._router.handle({ ...req, method: 'PUT', body: req.body }, res, () => {});
    }
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const respId = parseInt(req.params.id);
    const { title, message, category, shortcut, is_active } = req.body;

    const existing = (await pool.query('SELECT id FROM chat_canned_responses WHERE id = $1 AND school_id = $2', [respId, schoolId])).rows[0];
    if (!existing) return res.redirect('/admin/chat-config/responses');

    await pool.query(
      `UPDATE chat_canned_responses SET
        title = $1, message = $2, category = $3, shortcut = $4, is_active = $5
       WHERE id = $6 AND school_id = $7`,
      [
        title ? title.trim() : null,
        message ? message.trim() : null,
        category || 'general',
        shortcut ? shortcut.trim() : null,
        is_active === 'true',
        respId, schoolId
      ]
    );

    logger.info({ msg: '[LiveChatConfig] Canned response updated via POST', id: respId });
    res.redirect('/admin/chat-config/responses');
  }));

  // ============================================================
  // ROUTE 7: DELETE /admin/chat-config/responses/:id — Delete Response
  // ============================================================
  app.delete('/admin/chat-config/responses/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const respId = parseInt(req.params.id);

    await pool.query('DELETE FROM chat_canned_responses WHERE id = $1 AND school_id = $2', [respId, schoolId]);
    logger.info({ msg: '[LiveChatConfig] Canned response deleted', id: respId, by: user.email });
    res.json({ success: true, message: 'Response deleted' });
  }));

  app.post('/admin/chat-config/responses/:id/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const respId = parseInt(req.params.id);
    await pool.query('DELETE FROM chat_canned_responses WHERE id = $1 AND school_id = $2', [respId, schoolId]);
    logger.info({ msg: '[LiveChatConfig] Canned response deleted via POST', id: respId });
    res.redirect('/admin/chat-config/responses');
  }));

  // ============================================================
  // ROUTE 8: GET /admin/chat-config/departments — List Departments
  // ============================================================
  app.get('/admin/chat-config/departments', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const departments = (await pool.query(
      'SELECT * FROM chat_departments WHERE school_id = $1 ORDER BY name ASC', [schoolId]
    )).rows;

    const rows = departments.map(d => {
      const agents = Array.isArray(d.agents) ? d.agents : [];
      return `<tr>
        <td><a href="#" onclick="document.getElementById('edit-dep-${d.id}').style.display='block';return false" style="color:#60a5fa;text-decoration:none;font-weight:600">${esc(d.name)}</a></td>
        <td style="max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(d.description || '—')}</td>
        <td><span style="color:#60a5fa;font-weight:600">${agents.length}</span> <span style="color:#64748b">/ ${d.max_concurrent}</span></td>
        <td>${agents.slice(0, 3).map(a => `<span style="display:inline-block;background:#1e3a5f;color:#60a5fa;padding:2px 8px;border-radius:12px;font-size:11px;margin:2px">${esc(typeof a === 'string' ? a : (a.name || a.email || 'Agent'))}</span>`).join('')}${agents.length > 3 ? `<span style="color:#64748b;font-size:11px">+${agents.length - 3} more</span>` : ''}</td>
        <td>${statusBadge(d.is_active)}</td>
        <td>
          <div style="display:flex;gap:4px">
            <a href="#" onclick="document.getElementById('edit-dep-${d.id}').style.display='block';return false" class="lc-btn lc-btn-ghost lc-btn-sm">✏️</a>
            <form method="POST" action="/admin/chat-config/departments/${d.id}/delete" style="display:inline" onsubmit="return confirm('Delete this department?')">
              <button type="submit" class="lc-btn lc-btn-danger lc-btn-sm">🗑</button>
            </form>
          </div>
        </td>
      </tr>
      <tr id="edit-dep-${d.id}" style="display:none">
        <td colspan="6" style="background:#0f172a;padding:20px">
          <form method="POST" action="/admin/chat-config/departments/${d.id}" class="lc-form">
            <input type="hidden" name="_method" value="PUT">
            <div class="lc-grid">
              <div><label>Department Name *</label><input type="text" name="name" value="${esc(d.name)}" required></div>
              <div><label>Max Concurrent Chats</label><input type="number" name="max_concurrent" value="${d.max_concurrent}" min="1" max="50"></div>
            </div>
            <div><label>Description</label><textarea name="description" rows="2">${esc(d.description || '')}</textarea></div>
            <div><label>Agents (one per line)</label><textarea name="agents_text" rows="3">${esc(agents.join('\n'))}</textarea></div>
            <div><label>Status</label><select name="is_active"><option value="true" ${d.is_active?'selected':''}>Active</option><option value="false" ${!d.is_active?'selected':''}>Inactive</option></select></div>
            <div style="display:flex;gap:8px;margin-top:12px">
              <button type="submit" class="lc-btn lc-btn-primary lc-btn-sm">💾 Save</button>
              <button type="button" class="lc-btn lc-btn-ghost lc-btn-sm" onclick="document.getElementById('edit-dep-${d.id}').style.display='none'">Cancel</button>
            </div>
          </form>
        </td>
      </tr>`;
    }).join('');

    const html = LC_CSS + `<div class="lc-container">
      ${nav('departments')}
      <div class="lc-header">
        <div>
          <h1>🏢 Chat Departments</h1>
          <p>Organize agents by department for efficient routing</p>
        </div>
        <a href="#" onclick="document.getElementById('add-dep-form').style.display=document.getElementById('add-dep-form').style.display==='none'?'block':'none';return false" class="lc-btn lc-btn-primary">➕ New Department</a>
      </div>

      <div id="add-dep-form" style="display:none" class="lc-card">
        <h2>➕ Add Department</h2>
        <form method="POST" action="/admin/chat-config/departments" class="lc-form">
          <div class="lc-grid">
            <div><label>Department Name *</label><input type="text" name="name" required placeholder="e.g., Customer Support"></div>
            <div><label>Max Concurrent Chats</label><input type="number" name="max_concurrent" value="5" min="1" max="50"></div>
          </div>
          <div><label>Description</label><textarea name="description" rows="2" placeholder="Brief description of this department..."></textarea></div>
          <div><label>Agents (one email per line)</label><textarea name="agents_text" rows="3" placeholder="agent1@school.com&#10;agent2@school.com"></textarea></div>
          <div style="display:flex;align-items:end"><button type="submit" class="lc-btn lc-btn-primary">✅ Add Department</button></div>
        </form>
      </div>

      <div class="lc-card" style="padding:0;overflow:hidden">
        ${departments.length === 0
          ? '<div class="lc-empty"><div class="lc-empty-icon">🏢</div><p>No departments configured yet</p><a href="#" onclick="document.getElementById(\'add-dep-form\').style.display=\'block\';return false" class="lc-btn lc-btn-primary lc-btn-sm" style="margin-top:12px">Add First Department</a></div>'
          : `<div style="overflow-x:auto"><table class="lc-table">
              <thead><tr><th>Name</th><th>Description</th><th>Agents</th><th>Agent List</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>${rows}</tbody>
            </table></div>`
        }
      </div>
    </div>`;
    res.send(renderPage('Chat Departments', html, user));
  }));

  // ============================================================
  // ROUTE 9: POST /admin/chat-config/departments — Add Department
  // ============================================================
  app.post('/admin/chat-config/departments', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const { name, description, max_concurrent, agents_text } = req.body;

    if (!name || !name.trim()) return res.redirect('/admin/chat-config/departments');

    const maxC = Math.min(50, Math.max(1, parseInt(max_concurrent) || 5));
    const agentsList = (agents_text || '').split('\n').map(a => a.trim()).filter(a => a.length > 0);

    await pool.query(
      `INSERT INTO chat_departments (name, description, agents, max_concurrent, school_id)
       VALUES ($1, $2, $3::jsonb, $4, $5)`,
      [name.trim(), (description || '').trim(), JSON.stringify(agentsList), maxC, schoolId]
    );

    logger.info({ msg: '[LiveChatConfig] Department created', name: name.trim(), by: user.email });
    res.redirect('/admin/chat-config/departments');
  }));

  // ============================================================
  // ROUTE 10: PUT /admin/chat-config/departments/:id — Update Department
  // ============================================================
  app.put('/admin/chat-config/departments/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const depId = parseInt(req.params.id);
    const { name, description, max_concurrent, agents_text, is_active } = req.body;

    const existing = (await pool.query('SELECT id FROM chat_departments WHERE id = $1 AND school_id = $2', [depId, schoolId])).rows[0];
    if (!existing) return res.status(404).json({ error: 'Department not found' });

    const maxC = Math.min(50, Math.max(1, parseInt(max_concurrent) || 5));
    const agentsList = agents_text ? agents_text.split('\n').map(a => a.trim()).filter(a => a.length > 0) : undefined;

    await pool.query(
      `UPDATE chat_departments SET
        name = COALESCE($1, name),
        description = COALESCE($2, description),
        agents = COALESCE($3::jsonb, agents),
        max_concurrent = $4,
        is_active = COALESCE($5, is_active)
       WHERE id = $6 AND school_id = $7`,
      [
        name ? name.trim() : null,
        description !== undefined ? description.trim() : null,
        agentsList ? JSON.stringify(agentsList) : null,
        maxC,
        is_active !== undefined ? (is_active === 'true' || is_active === true) : null,
        depId, schoolId
      ]
    );

    logger.info({ msg: '[LiveChatConfig] Department updated', id: depId, by: user.email });
    res.json({ success: true, message: 'Department updated' });
  }));

  app.post('/admin/chat-config/departments/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const depId = parseInt(req.params.id);
    const { name, description, max_concurrent, agents_text, is_active } = req.body;

    const existing = (await pool.query('SELECT id FROM chat_departments WHERE id = $1 AND school_id = $2', [depId, schoolId])).rows[0];
    if (!existing) return res.redirect('/admin/chat-config/departments');

    const maxC = Math.min(50, Math.max(1, parseInt(max_concurrent) || 5));
    const agentsList = (agents_text || '').split('\n').map(a => a.trim()).filter(a => a.length > 0);

    await pool.query(
      `UPDATE chat_departments SET name = $1, description = $2, agents = $3::jsonb, max_concurrent = $4, is_active = $5
       WHERE id = $6 AND school_id = $7`,
      [name.trim(), (description || '').trim(), JSON.stringify(agentsList), maxC, is_active === 'true', depId, schoolId]
    );

    logger.info({ msg: '[LiveChatConfig] Department updated via POST', id: depId });
    res.redirect('/admin/chat-config/departments');
  }));

  // ============================================================
  // ROUTE 11: DELETE /admin/chat-config/departments/:id — Delete Department
  // ============================================================
  app.delete('/admin/chat-config/departments/:id', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const depId = parseInt(req.params.id);
    await pool.query('DELETE FROM chat_departments WHERE id = $1 AND school_id = $2', [depId, schoolId]);
    logger.info({ msg: '[LiveChatConfig] Department deleted', id: depId, by: user.email });
    res.json({ success: true, message: 'Department deleted' });
  }));

  app.post('/admin/chat-config/departments/:id/delete', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const depId = parseInt(req.params.id);
    await pool.query('DELETE FROM chat_departments WHERE id = $1 AND school_id = $2', [depId, schoolId]);
    logger.info({ msg: '[LiveChatConfig] Department deleted via POST', id: depId });
    res.redirect('/admin/chat-config/departments');
  }));

  // ============================================================
  // ROUTE 12: GET /admin/chat-config/analytics — Chat Analytics
  // ============================================================
  app.get('/admin/chat-config/analytics', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const config = await getWidgetConfig(schoolId);

    const totalResponses = (await pool.query('SELECT COUNT(*)::int as cnt FROM chat_canned_responses WHERE school_id = $1', [schoolId])).rows[0].cnt;
    const activeResponses = (await pool.query('SELECT COUNT(*)::int as cnt FROM chat_canned_responses WHERE school_id = $1 AND is_active = true', [schoolId])).rows[0].cnt;
    const totalUsage = (await pool.query('SELECT COALESCE(SUM(usage_count), 0)::int as total FROM chat_canned_responses WHERE school_id = $1', [schoolId])).rows[0].total;
    const avgUsage = totalResponses > 0 ? (totalUsage / totalResponses).toFixed(1) : '0';
    const totalDepts = (await pool.query('SELECT COUNT(*)::int as cnt FROM chat_departments WHERE school_id = $1', [schoolId])).rows[0].cnt;
    const totalAgents = (await pool.query('SELECT COALESCE(SUM(jsonb_array_length(agents)), 0)::int as total FROM chat_departments WHERE school_id = $1', [schoolId])).rows[0].total;
    const maxCapacity = (await pool.query('SELECT COALESCE(SUM(max_concurrent), 0)::int as total FROM chat_departments WHERE school_id = $1 AND is_active = true', [schoolId])).rows[0].total;

    const categoryBreakdown = (await pool.query(
      `SELECT category, COUNT(*)::int as cnt, SUM(usage_count)::int as uses FROM chat_canned_responses
       WHERE school_id = $1 GROUP BY category ORDER BY uses DESC`,
      [schoolId]
    )).rows;

    const topResponses = (await pool.query(
      `SELECT title, category, usage_count, is_active FROM chat_canned_responses
       WHERE school_id = $1 ORDER BY usage_count DESC LIMIT 10`,
      [schoolId]
    )).rows;

    const departmentStats = (await pool.query(
      `SELECT name, agents, max_concurrent, is_active,
        jsonb_array_length(agents) as agent_count
       FROM chat_departments WHERE school_id = $1 ORDER BY name`,
      [schoolId]
    )).rows;

    const maxCatUsage = categoryBreakdown.length > 0 ? (categoryBreakdown[0].uses || 1) : 1;
    const maxRespUsage = topResponses.length > 0 ? (topResponses[0].usage_count || 1) : 1;

    const html = LC_CSS + `<div class="lc-container">
      ${nav('analytics')}
      <div class="lc-header">
        <div>
          <h1>📈 Chat Analytics</h1>
          <p>Insights into your live chat configuration and usage</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/admin/chat-config/responses" class="lc-btn lc-btn-ghost">📋 Manage Responses</a>
          <a href="/admin/chat-config/departments" class="lc-btn lc-btn-ghost">🏢 Manage Departments</a>
        </div>
      </div>

      <div class="lc-stats">
        <div class="lc-stat">
          <div class="lc-stat-icon">📋</div>
          <div class="lc-stat-val">${totalResponses}</div>
          <div class="lc-stat-lbl">Total Responses</div>
          <div style="margin-top:6px"><span style="color:#4ade80;font-size:12px">● ${activeResponses} active</span></div>
        </div>
        <div class="lc-stat">
          <div class="lc-stat-icon">📊</div>
          <div class="lc-stat-val">${totalUsage}</div>
          <div class="lc-stat-lbl">Total Usage</div>
          <div style="margin-top:6px"><span style="color:#94a3b8;font-size:12px">Avg ${avgUsage}/response</span></div>
        </div>
        <div class="lc-stat">
          <div class="lc-stat-icon">🏢</div>
          <div class="lc-stat-val">${totalDepts}</div>
          <div class="lc-stat-lbl">Departments</div>
          <div style="margin-top:6px"><span style="color:#60a5fa;font-size:12px">${totalAgents} total agents</span></div>
        </div>
        <div class="lc-stat">
          <div class="lc-stat-icon">👥</div>
          <div class="lc-stat-val">${maxCapacity}</div>
          <div class="lc-stat-lbl">Max Concurrent</div>
          <div style="margin-top:6px"><span style="color:#94a3b8;font-size:12px">Active capacity</span></div>
        </div>
        <div class="lc-stat">
          <div class="lc-stat-icon">💬</div>
          <div class="lc-stat-val" style="color:${config.is_active ? '#4ade80' : '#f87171'}">${config.is_active ? 'Live' : 'Off'}</div>
          <div class="lc-stat-lbl">Widget Status</div>
          <div style="margin-top:6px"><span style="color:#94a3b8;font-size:12px">Queue: ${config.max_queue}</span></div>
        </div>
      </div>

      <div class="lc-grid">
        <div class="lc-card">
          <h2>📂 Usage by Category</h2>
          ${categoryBreakdown.length === 0
            ? '<div class="lc-empty"><div class="lc-empty-icon">📊</div><p>No usage data yet</p></div>'
            : `<div style="display:flex;flex-direction:column;gap:10px">
              ${categoryBreakdown.map(c => {
                const pct = Math.round((c.uses / maxCatUsage) * 100);
                const catColors = { general: '#3b82f6', greeting: '#8b5cf6', support: '#22c55e', sales: '#f59e0b', faq: '#c084fc', technical: '#06b6d4', billing: '#f97316', onboarding: '#14b8a6' };
                const color = catColors[c.category] || '#3b82f6';
                return `<div style="padding:10px 12px;background:#0f172a;border-radius:8px;border:1px solid #1e293b">
                  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                    <div style="display:flex;align-items:center;gap:8px">
                      ${categoryBadge(c.category)}
                      <span style="font-size:13px;color:#e2e8f0;font-weight:600">${c.cnt} responses</span>
                    </div>
                    <span style="font-size:13px;color:#f1f5f9;font-weight:700">${c.uses} uses</span>
                  </div>
                  <div class="lc-usage-bar"><div class="lc-usage-bar-fill" style="width:${pct}%;background:${color}"></div></div>
                </div>`;
              }).join('')}
            </div>`
          }
        </div>

        <div class="lc-card">
          <h2>🏆 Top 10 Responses</h2>
          ${topResponses.length === 0
            ? '<div class="lc-empty"><div class="lc-empty-icon">🏆</div><p>No usage data yet</p></div>'
            : `<div style="display:flex;flex-direction:column;gap:6px">
              ${topResponses.map((r, i) => {
                const pct = Math.round((r.usage_count / maxRespUsage) * 100);
                const medals = ['🥇', '🥈', '🥉'];
                const medal = i < 3 ? medals[i] : `<span style="color:#64748b;font-size:12px;font-weight:700">${i + 1}</span>`;
                return `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;background:#0f172a;border-radius:8px;border:1px solid #1e293b">
                  <div style="width:28px;text-align:center;font-size:16px">${medal}</div>
                  <div style="flex:1;min-width:0">
                    <div style="font-size:13px;color:#e2e8f0;font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(r.title)}</div>
                    <div style="display:flex;align-items:center;gap:6px;margin-top:3px">
                      ${categoryBadge(r.category)}
                      ${!r.is_active ? '<span style="font-size:10px;color:#f87171">inactive</span>' : ''}
                    </div>
                  </div>
                  <div style="text-align:right;flex-shrink:0">
                    <div style="font-size:14px;color:#f1f5f9;font-weight:700">${r.usage_count}</div>
                    <div class="lc-usage-bar" style="width:60px"><div class="lc-usage-bar-fill" style="width:${pct}%;background:#3b82f6"></div></div>
                  </div>
                </div>`;
              }).join('')}
            </div>`
          }
        </div>
      </div>

      <div class="lc-card" style="margin-top:16px">
        <h2>🏢 Department Capacity Overview</h2>
        ${departmentStats.length === 0
          ? '<div class="lc-empty"><div class="lc-empty-icon">🏢</div><p>No departments configured</p></div>'
          : `<div style="overflow-x:auto"><table class="lc-table">
              <thead><tr><th>Department</th><th>Agents</th><th>Max Concurrent</th><th>Utilization</th><th>Status</th></tr></thead>
              <tbody>
                ${departmentStats.map(d => {
                  const ac = parseInt(d.agent_count) || 0;
                  const pct = d.max_concurrent > 0 ? Math.round((ac / d.max_concurrent) * 100) : 0;
                  const barColor = pct > 80 ? '#f87171' : pct > 50 ? '#fbbf24' : '#4ade80';
                  return `<tr>
                    <td style="font-weight:600;color:#f1f5f9">${esc(d.name)}</td>
                    <td><span style="color:#60a5fa;font-weight:600">${ac}</span> <span style="color:#64748b">assigned</span></td>
                    <td>${d.max_concurrent}</td>
                    <td>
                      <div style="display:flex;align-items:center;gap:8px">
                        <div class="lc-usage-bar" style="width:100px"><div class="lc-usage-bar-fill" style="width:${pct}%;background:${barColor}"></div></div>
                        <span style="font-size:12px;color:#94a3b8">${pct}%</span>
                      </div>
                    </td>
                    <td>${statusBadge(d.is_active)}</td>
                  </tr>`;
                }).join('')}
              </tbody>
            </table></div>`
        }
      </div>

      <div class="lc-card" style="margin-top:16px">
        <h2>💡 Configuration Recommendations</h2>
        <div style="display:flex;flex-direction:column;gap:8px">
          ${totalResponses < 5 ? '<div class="lc-alert lc-alert-warning">⚠️ You have fewer than 5 canned responses. Consider adding more to improve agent efficiency.</div>' : ''}
          ${totalDepts === 0 ? '<div class="lc-alert lc-alert-warning">⚠️ No departments configured. Create departments to organize your agents and route chats effectively.</div>' : ''}
          ${!config.auto_reply_enabled ? '<div class="lc-alert lc-alert-info">ℹ️ Auto-reply bot is disabled. Enable it to provide instant responses when agents are unavailable.</div>' : ''}
          ${!config.pre_chat_form ? '<div class="lc-alert lc-alert-info">ℹ️ Pre-chat form is disabled. Enable it to collect visitor information before starting a conversation.</div>' : ''}
          ${config.rating_enabled ? '<div class="lc-alert lc-alert-success">✅ Post-chat ratings are enabled, helping you measure customer satisfaction.</div>' : '<div class="lc-alert lc-alert-warning">⚠️ Chat ratings are disabled. Enable them to collect feedback from visitors.</div>'}
          ${totalUsage > 0 && totalResponses > 0 && parseFloat(avgUsage) > 20 ? '<div class="lc-alert lc-alert-success">✅ Great response utilization! Your agents are making good use of canned responses.</div>' : ''}
          ${activeResponses < totalResponses ? `<div class="lc-alert lc-alert-info">ℹ️ ${totalResponses - activeResponses} inactive response(s). Consider removing or reactivating them.</div>` : ''}
        </div>
      </div>
    </div>`;
    res.send(renderPage('Chat Analytics', html, user));
  }));

  // ============================================================
  // ROUTE 13: GET /admin/chat-config/embed-code — Get Embed Code
  // ============================================================
  app.get('/admin/chat-config/embed-code', requireAuth, ah(async (req, res) => {
    const user = req.session.user;
    const schoolId = user.school_id || user.tenant_id || 1;
    const config = await getWidgetConfig(schoolId);

    const widgetUrl = `${req.protocol}://${req.get('host')}/chat-widget.js`;
    const positionStyles = {
      'bottom-right': 'bottom:24px;right:24px',
      'bottom-left': 'bottom:24px;left:24px',
      'top-right': 'top:24px;right:24px',
      'top-left': 'top:24px;left:24px'
    };
    const posStyle = positionStyles[config.position] || positionStyles['bottom-right'];

    const embedSnippet = `<!-- Live Chat Widget — ${esc(config.widget_name)} -->
<div id="live-chat-root"></div>
<script>
  (function(w, d, s, o) {
    var js, fjs = d.getElementsByTagName(s)[0];
    if (d.getElementById('live-chat-sdk')) return;
    js = d.createElement(s); js.id = 'live-chat-sdk';
    js.src = '${widgetUrl}';
    js.setAttribute('data-school-id', '${schoolId}');
    js.setAttribute('data-color', '${esc(config.primary_color)}');
    js.setAttribute('data-position', '${esc(config.position)}');
    js.setAttribute('data-welcome', '${esc((config.welcome_message || '').replace(/'/g, "\\'"))}');
    js.setAttribute('data-offline', '${esc((config.offline_message || '').replace(/'/g, "\\'"))}');
    js.setAttribute('data-bot-name', '${esc(config.bot_name || 'Assistant')}');
    js.setAttribute('data-bot-greeting', '${esc((config.bot_greeting || '').replace(/'/g, "\\'"))}');
    js.setAttribute('data-auto-reply', '${config.auto_reply_enabled}');
    js.setAttribute('data-pre-chat', '${config.pre_chat_form}');
    js.setAttribute('data-rating', '${config.rating_enabled}');
    js.setAttribute('data-sound', '${config.sound_enabled}');
    fjs.parentNode.insertBefore(js, fjs);
  })(window, document, 'script');
</script>`;

    const reactSnippet = `// React Component — Live Chat Widget
import { useEffect } from 'react';

function LiveChatWidget() {
  useEffect(() => {
    const existingScript = document.getElementById('live-chat-sdk');
    if (existingScript) return;

    const script = document.createElement('script');
    script.id = 'live-chat-sdk';
    script.src = '${widgetUrl}';
    script.setAttribute('data-school-id', '${schoolId}');
    script.setAttribute('data-color', '${esc(config.primary_color)}');
    script.setAttribute('data-position', '${esc(config.position)}');
    script.setAttribute('data-welcome', '${esc((config.welcome_message || '').replace(/'/g, "\\'"))}');
    script.async = true;
    document.body.appendChild(script);

    return () => {
      const el = document.getElementById('live-chat-sdk');
      if (el) el.remove();
      const root = document.getElementById('live-chat-root');
      if (root) root.innerHTML = '';
    };
  }, []);

  return <div id="live-chat-root" />;
}

export default LiveChatWidget;`;

    const html = LC_CSS + `<div class="lc-container">
      ${nav('embed')}
      <div class="lc-header">
        <div>
          <h1>🧩 Embed Code</h1>
          <p>Copy the code snippet to add the live chat widget to your website</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/admin/chat-config/widget/preview" class="lc-btn lc-btn-ghost">👁 Preview Widget</a>
          <a href="/admin/chat-config" class="lc-btn lc-btn-ghost">← Dashboard</a>
        </div>
      </div>

      <div class="lc-alert lc-alert-info">
        ℹ️ Place this code snippet before the closing <code style="background:#0f172a;padding:2px 6px;border-radius:4px">&lt;/body&gt;</code> tag on every page where you want the chat widget to appear.
      </div>

      <div class="lc-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="margin:0">📜 HTML / JavaScript Snippet</h2>
          <button class="lc-btn lc-btn-primary lc-btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('embed-code').innerText);this.textContent='✅ Copied!';setTimeout(()=>this.textContent='📋 Copy Code',2000)">📋 Copy Code</button>
        </div>
        <div class="lc-code-block" id="embed-code">${esc(embedSnippet)}</div>
      </div>

      <div class="lc-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
          <h2 style="margin:0">⚛️ React Component</h2>
          <button class="lc-btn lc-btn-primary lc-btn-sm" onclick="navigator.clipboard.writeText(document.getElementById('react-code').innerText);this.textContent='✅ Copied!';setTimeout(()=>this.textContent='📋 Copy Code',2000)">📋 Copy Code</button>
        </div>
        <div class="lc-code-block" id="react-code">${esc(reactSnippet)}</div>
      </div>

      <div class="lc-grid" style="margin-top:16px">
        <div class="lc-card">
          <h2>⚙️ Configuration Summary</h2>
          <div style="display:flex;flex-direction:column;gap:10px">
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Widget Name</span>
              <span style="color:#f1f5f9;font-size:13px;font-weight:600">${esc(config.widget_name)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Primary Color</span>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="width:16px;height:16px;border-radius:50%;background:${esc(config.primary_color)};display:inline-block"></span>
                <span style="color:#f1f5f9;font-size:13px;font-family:monospace">${esc(config.primary_color)}</span>
              </div>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Position</span>
              <span style="color:#f1f5f9;font-size:13px;font-weight:600">${esc(config.position)}</span>
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Auto Reply</span>
              ${statusBadge(config.auto_reply_enabled)}
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Pre-chat Form</span>
              ${statusBadge(config.pre_chat_form)}
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Rating</span>
              ${statusBadge(config.rating_enabled)}
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Sound</span>
              ${statusBadge(config.sound_enabled)}
            </div>
            <div style="display:flex;justify-content:space-between;padding:8px 12px;background:#0f172a;border-radius:8px">
              <span style="color:#94a3b8;font-size:13px">Max Queue</span>
              <span style="color:#f1f5f9;font-size:13px;font-weight:600">${config.max_queue}</span>
            </div>
          </div>
        </div>

        <div class="lc-card">
          <h2>📍 Widget Position Preview</h2>
          <div style="position:relative;height:300px;background:#0f172a;border:1px solid #334155;border-radius:12px;overflow:hidden">
            <div style="position:absolute;top:12px;left:12px;right:12px;bottom:12px;border:1px dashed #334155;border-radius:8px;display:flex;align-items:center;justify-content:center;color:#475569;font-size:13px">Your website content</div>
            <div style="position:absolute;${posStyle};width:48px;height:48px;border-radius:50%;background:${esc(config.primary_color)};display:flex;align-items:center;justify-content:center;color:#fff;font-size:20px;box-shadow:0 4px 16px rgba(0,0,0,.4);cursor:pointer;z-index:10;transition:.3s">💬</div>
          </div>
          <div style="margin-top:12px;text-align:center">
            <span style="font-size:12px;color:#64748b">Widget button position: <strong style="color:#e2e8f0">${esc(config.position)}</strong></span>
          </div>
        </div>
      </div>

      <div class="lc-card" style="margin-top:16px">
        <h2>📝 Integration Notes</h2>
        <div style="display:flex;flex-direction:column;gap:10px;font-size:13px;color:#94a3b8;line-height:1.6">
          <div style="padding:10px 14px;background:#0f172a;border-radius:8px;border-left:3px solid #3b82f6">
            <strong style="color:#e2e8f0">1. Single Domain</strong> — The widget will only be active on the domain where it is embedded. Cross-origin usage requires additional configuration.
          </div>
          <div style="padding:10px 14px;background:#0f172a;border-radius:8px;border-left:3px solid #22c55e">
            <strong style="color:#e2e8f0">2. Performance</strong> — The script loads asynchronously and will not block your page rendering. It initializes after the DOM is ready.
          </div>
          <div style="padding:10px 14px;background:#0f172a;border-radius:8px;border-left:3px solid #f59e0b">
            <strong style="color:#e2e8f0">3. Customization</strong> — All attributes (data-color, data-position, etc.) can be overridden directly in the embed snippet for per-page customization.
          </div>
          <div style="padding:10px 14px;background:#0f172a;border-radius:8px;border-left:3px solid #c084fc">
            <strong style="color:#e2e8f0">4. Updates</strong> — Changes to widget settings in this admin panel take effect immediately. No need to update the embed code.
          </div>
          <div style="padding:10px 14px;background:#0f172a;border-radius:8px;border-left:3px solid #06b6d4">
            <strong style="color:#e2e8f0">5. Browser Support</strong> — The widget supports all modern browsers (Chrome, Firefox, Safari, Edge). IE11 is not supported.
          </div>
        </div>
      </div>
    </div>`;
    res.send(renderPage('Embed Code', html, user));
  }));
};
