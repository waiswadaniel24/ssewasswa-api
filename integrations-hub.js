/**
 * Comfort Zone — Integrations Hub Module
 * File: integrations-hub.js
 *
 * Comprehensive integrations hub providing:
 *   1. MCP (Model Context Protocol) Server Endpoint
 *   2. UptimeRobot Monitoring Endpoints
 *   3. Push Notification Connectors (web-push)
 *   4. Webhook & Integration Management (Telegram, Slack)
 *   5. Unified Notification Router
 *
 * Signature: module.exports = function(app, pool, requireAuth, requireNotBanned, ah, esc, renderPage, audit, sendEmail, queueEmail, logger)
 *
 * Tables created:
 *   mcp_audit_log, uptime_monitor_log, telegram_config, telegram_messages,
 *   slack_config, slack_messages, notification_router_log, push_subscriptions (if missing)
 */

'use strict';

const https = require('https');
const http = require('http');
const os = require('os');

module.exports = function integrationsHub(app, pool, opts) {
  // Destructure from opts (new-style module pattern)
  const requireAuth = opts.requireAuth || ((req, res, next) => { if (!req.session?.user) return res.redirect('/login'); next(); });
  const requireNotBanned = opts.requireNotBanned || ((req, res, next) => next());
  const ah = opts.ah || ((fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next));
  const esc = opts.esc || (s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'));
  const renderPage = opts.renderPage || ((title, content, user) => content);
  const audit = opts.audit || (async () => {});
  const sendEmail = opts.sendEmail || (async () => {});
  const queueEmail = opts.queueEmail || (async () => {});
  const logger = opts.logger || console;
  const notify = opts.notify || (async () => {});
  const sendSMS = opts.sendSMS || (async () => {});

  // ═══════════════════════════════════════════════════════════════
  //  DESIGN SYSTEM & CONSTANTS
  // ═══════════════════════════════════════════════════════════════
  const DS = {
    primary: '#6366f1',
    primaryLight: '#818cf8',
    accent: '#06b6d4',
    success: '#10b981',
    warning: '#f59e0b',
    danger: '#ef4444',
    radius: '14px',
    bg: '#f8fafc',
    card: '#ffffff',
    cardBorder: '#e2e8f0',
    text: '#1e293b',
    textMuted: '#64748b',
    textLight: '#94a3b8',
    sidebar: '#0f172a',
    sidebarText: '#e2e8f0',
  };

  const UPTIME_PING_KEY = 'u3473539-8caf8cddc1c2d01464224136';
  const UPTIME_HEALTH_KEY = 'm803211038-f4ba4f20e80f471de09b1986';

  const schoolId = (req) => req.session?.user?.school_id || req.session?.user?.tenant_id || 1;
  const userEmail = (req) => req.session?.user?.email || 'unknown';

  // ═══════════════════════════════════════════════════════════════
  //  HELPERS
  // ═══════════════════════════════════════════════════════════════
  function fmtNum(n) { return (n == null ? 0 : Number(n)).toLocaleString(); }
  function fmtBytes(b) {
    if (b >= 1073741824) return (b / 1073741824).toFixed(1) + ' GB';
    if (b >= 1048576) return (b / 1048576).toFixed(0) + ' MB';
    if (b >= 1024) return (b / 1024).toFixed(0) + ' KB';
    return b + ' B';
  }
  function fmtUptime(s) {
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d > 0 ? `${d}d ${h}h ${m}m` : h > 0 ? `${h}h ${m}m` : `${m}m`;
  }
  function ago(d) {
    if (!d) return '\u2014';
    const s = Math.floor((Date.now() - new Date(d)) / 1000);
    if (s < 60) return 'just now';
    if (s < 3600) return Math.floor(s / 60) + 'm ago';
    if (s < 86400) return Math.floor(s / 3600) + 'h ago';
    if (s < 604800) return Math.floor(s / 86400) + 'd ago';
    return new Date(d).toLocaleDateString();
  }

  function badge(text, color) {
    return `<span style="display:inline-block;padding:3px 10px;border-radius:20px;font-size:12px;font-weight:600;background:${color || DS.primary};color:#fff">${esc(String(text))}</span>`;
  }

  function statusBadge(s) {
    const map = {
      up: [DS.success, 'Up'], down: [DS.danger, 'Down'], degraded: [DS.warning, 'Degraded'],
      sent: [DS.success, 'Sent'], delivered: [DS.success, 'Delivered'], failed: [DS.danger, 'Failed'],
      pending: [DS.warning, 'Pending'], enabled: [DS.success, 'Enabled'], disabled: [DS.textLight, 'Disabled'],
      active: [DS.success, 'Active'], inbound: [DS.accent, 'Inbound'], outbound: [DS.primary, 'Outbound'],
    };
    const [c, l] = map[s] || [DS.textLight, s];
    return badge(l, c);
  }

  function statCard(label, value, icon, color) {
    color = color || DS.primary;
    return `<div style="background:${DS.card};border:1px solid ${DS.cardBorder};border-radius:${DS.radius};padding:20px;text-align:center;transition:border-color .15s">
      <div style="font-size:28px;margin-bottom:4px">${icon || ''}</div>
      <div style="font-size:24px;font-weight:700;color:${color}">${esc(String(value))}</div>
      <div style="font-size:12px;color:${DS.textMuted};margin-top:4px">${esc(label)}</div>
    </div>`;
  }

  // Shared inline CSS for integration pages
  const baseCSS = `
    <style>
      :root{--primary:${DS.primary};--primary-light:${DS.primaryLight};--accent:${DS.accent};--success:${DS.success};--warning:${DS.warning};--danger:${DS.danger};--radius:${DS.radius}}
      *{box-sizing:border-box}
      .ih-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px;margin-bottom:20px}
      .ih-grid2{display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-bottom:20px}
      @media(max-width:768px){.ih-grid2{grid-template-columns:1fr}}
      .ih-card{background:${DS.card};border:1px solid ${DS.cardBorder};border-radius:${DS.radius};padding:22px;margin-bottom:16px;transition:border-color .15s}
      .ih-card:hover{border-color:${DS.primaryLight}}
      .ih-card h2{margin:0 0 14px;font-size:1.05rem;font-weight:700;color:${DS.text};display:flex;align-items:center;gap:8px}
      .ih-card h3{margin:0 0 10px;font-size:.9rem;font-weight:600;color:${DS.text}}
      .ih-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border-radius:10px;font-size:14px;font-weight:600;text-decoration:none;border:none;cursor:pointer;transition:all .15s}
      .ih-btn:hover{transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.1)}
      .ih-btn-primary{background:var(--primary);color:#fff}.ih-btn-primary:hover{background:${DS.primaryLight}}
      .ih-btn-accent{background:${DS.accent};color:#fff}.ih-btn-accent:hover{background:#0891b2}
      .ih-btn-success{background:${DS.success};color:#fff}.ih-btn-success:hover{background:#059669}
      .ih-btn-danger{background:${DS.danger};color:#fff}.ih-btn-danger:hover{background:#dc2626}
      .ih-btn-warning{background:${DS.warning};color:#fff}.ih-btn-warning:hover{background:#d97706}
      .ih-btn-ghost{background:transparent;border:1px solid ${DS.cardBorder};color:${DS.textMuted}}
      .ih-btn-ghost:hover{border-color:var(--primary);color:var(--primary)}
      .ih-btn-sm{padding:5px 12px;font-size:13px;border-radius:8px}
      .ih-input{width:100%;padding:10px 14px;border:1px solid ${DS.cardBorder};border-radius:10px;font-size:14px;background:${DS.bg};color:${DS.text};outline:none}
      .ih-input:focus{border-color:var(--primary);box-shadow:0 0 0 3px ${DS.primary}22}
      .ih-textarea{width:100%;padding:10px 14px;border:1px solid ${DS.cardBorder};border-radius:10px;font-size:14px;min-height:80px;resize:vertical;background:${DS.bg};color:${DS.text};outline:none;font-family:inherit}
      .ih-textarea:focus{border-color:var(--primary);box-shadow:0 0 0 3px ${DS.primary}22}
      .ih-select{width:100%;padding:10px 14px;border:1px solid ${DS.cardBorder};border-radius:10px;font-size:14px;background:${DS.bg};color:${DS.text};outline:none}
      .ih-select:focus{border-color:var(--primary)}
      .ih-table{width:100%;border-collapse:collapse;font-size:14px}
      .ih-table th{text-align:left;padding:12px;background:${DS.bg};border-bottom:2px solid ${DS.cardBorder};font-weight:600;color:${DS.textMuted};font-size:12px;text-transform:uppercase;letter-spacing:.5px}
      .ih-table td{padding:12px;border-bottom:1px solid ${DS.cardBorder};color:${DS.text}}
      .ih-table tr:hover td{background:rgba(99,102,241,.03)}
      .ih-label{display:block;font-weight:600;margin-bottom:4px;font-size:13px;color:${DS.textMuted}}
      .ih-alert{padding:12px 16px;border-radius:10px;margin-bottom:16px;font-size:14px;border:1px solid}
      .ih-alert-info{background:#eff6ff;border-color:#bfdbfe;color:#1d4ed8}
      .ih-alert-success{background:#ecfdf5;border-color:#a7f3d0;color:#065f46}
      .ih-alert-warning{background:#fffbeb;border-color:#fde68a;color:#92400e}
      .ih-alert-danger{background:#fef2f2;border-color:#fecaca;color:#991b1b}
      .ih-scroll{max-height:400px;overflow-y:auto}
      .ih-scroll::-webkit-scrollbar{width:6px}.ih-scroll::-webkit-scrollbar-track{background:transparent}
      .ih-scroll::-webkit-scrollbar-thumb{background:${DS.cardBorder};border-radius:3px}
      .ih-code{background:#1e293b;color:#e2e8f0;padding:14px;border-radius:10px;font-size:13px;overflow-x:auto;font-family:'Fira Code','Courier New',monospace;white-space:pre-wrap;word-wrap:break-word}
      .ih-toggle{position:relative;width:44px;height:24px;cursor:pointer;display:inline-block}
      .ih-toggle input{opacity:0;width:0;height:0;position:absolute}
      .ih-toggle span{position:absolute;inset:0;background:${DS.cardBorder};border-radius:12px;transition:.2s}
      .ih-toggle span:before{content:'';position:absolute;width:18px;height:18px;left:3px;bottom:3px;background:#fff;border-radius:50%;transition:.2s}
      .ih-toggle input:checked+span{background:var(--primary)}
      .ih-toggle input:checked+span:before{transform:translateX(20px)}
      .ih-integration-card{background:${DS.card};border:1px solid ${DS.cardBorder};border-radius:${DS.radius};padding:24px;text-align:center;transition:all .2s;cursor:pointer}
      .ih-integration-card:hover{border-color:var(--primary);transform:translateY(-2px);box-shadow:0 8px 24px rgba(99,102,241,.1)}
      .ih-integration-card .icon{font-size:40px;margin-bottom:12px}
      .ih-integration-card .name{font-size:16px;font-weight:700;color:${DS.text};margin-bottom:4px}
      .ih-integration-card .desc{font-size:13px;color:${DS.textMuted}}
    </style>
  `;

  // ═══════════════════════════════════════════════════════════════
  //  DATABASE MIGRATIONS
  // ═══════════════════════════════════════════════════════════════
  (async () => {
    const client = await pool.connect().catch(() => null);
    if (!client) { console.warn('[IntegrationsHub] Cannot acquire DB client for migrations'); return; }
    try {
      await client.query(`CREATE TABLE IF NOT EXISTS mcp_audit_log (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER,
        tool_name TEXT,
        arguments JSONB,
        result JSONB,
        api_key_prefix TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS uptime_monitor_log (
        id SERIAL PRIMARY KEY,
        check_time TIMESTAMPTZ DEFAULT NOW(),
        db_latency_ms INTEGER,
        memory_mb FLOAT,
        status TEXT DEFAULT 'up'
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS telegram_config (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER UNIQUE,
        bot_token TEXT,
        default_chat_id TEXT,
        is_enabled BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS telegram_messages (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER,
        chat_id TEXT,
        message_text TEXT,
        direction TEXT DEFAULT 'outbound',
        status TEXT DEFAULT 'pending',
        sent_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS slack_config (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER UNIQUE,
        webhook_url TEXT,
        bot_token TEXT,
        default_channel TEXT,
        is_enabled BOOLEAN DEFAULT false,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS slack_messages (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER,
        channel TEXT,
        message_text TEXT,
        direction TEXT DEFAULT 'outbound',
        status TEXT DEFAULT 'pending',
        sent_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      await client.query(`CREATE TABLE IF NOT EXISTS notification_router_log (
        id SERIAL PRIMARY KEY,
        tenant_id INTEGER,
        channel TEXT,
        recipient TEXT,
        subject TEXT,
        status TEXT DEFAULT 'sent',
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`);
      // push_subscriptions table (if it doesn't already exist)
      await client.query(`CREATE TABLE IF NOT EXISTS push_subscriptions (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        tenant_id INTEGER,
        endpoint TEXT NOT NULL,
        keys_p256dh TEXT,
        keys_auth TEXT,
        platform TEXT DEFAULT 'web',
        is_active BOOLEAN DEFAULT true,
        created_at TIMESTAMPTZ DEFAULT NOW()
      )`).catch(() => {});

      // Indexes
      await client.query(`CREATE INDEX IF NOT EXISTS idx_mcp_audit_tenant ON mcp_audit_log(tenant_id)`).catch(() => {});
      await client.query(`CREATE INDEX IF NOT EXISTS idx_mcp_audit_time ON mcp_audit_log(created_at DESC)`).catch(() => {});
      await client.query(`CREATE INDEX IF NOT EXISTS idx_uptime_time ON uptime_monitor_log(check_time DESC)`).catch(() => {});
      await client.query(`CREATE INDEX IF NOT EXISTS idx_telegram_msg_tenant ON telegram_messages(tenant_id)`).catch(() => {});
      await client.query(`CREATE INDEX IF NOT EXISTS idx_slack_msg_tenant ON slack_messages(tenant_id)`).catch(() => {});
      await client.query(`CREATE INDEX IF NOT EXISTS idx_notif_router_time ON notification_router_log(created_at DESC)`).catch(() => {});
      await client.query(`CREATE INDEX IF NOT EXISTS idx_push_sub_endpoint ON push_subscriptions(endpoint)`).catch(() => {});
      await client.query(`CREATE INDEX IF NOT EXISTS idx_push_sub_tenant ON push_subscriptions(tenant_id)`).catch(() => {});

      console.log('[IntegrationsHub] Migrations complete');
    } catch (e) {
      console.error('[IntegrationsHub] Migration error:', e.message);
    } finally {
      client.release();
    }
  })();

  // ═══════════════════════════════════════════════════════════════
  //  1. MCP (Model Context Protocol) SERVER ENDPOINT
  // ═══════════════════════════════════════════════════════════════

  // Dangerous SQL keywords that should never appear in user queries
  const DANGEROUS_SQL = /\b(DROP|TRUNCATE|ALTER|GRANT|REVOKE|CREATE|DELETE\s+FROM|UPDATE\s+\w+\s+SET)\b/i;

  // Available MCP tools definition
  const MCP_TOOLS = [
    {
      name: 'query_tenant_data',
      description: 'Query any table for a specific tenant. Accepts table, columns, where_clause, limit, offset.',
      parameters: { table: 'string (required)', columns: 'string (default: *)', where_clause: 'string (optional)', limit: 'number (default: 50)', offset: 'number (default: 0)' }
    },
    {
      name: 'send_notification',
      description: 'Send a notification to users within a tenant. Accepts message, target_roles (array).',
      parameters: { message: 'string (required)', target_roles: 'array of strings (optional)' }
    },
    {
      name: 'get_analytics',
      description: 'Get KPI metrics for a tenant: total students, payments collected, attendance rate, active users.',
      parameters: { period: 'string (optional, e.g. "7d", "30d", "90d")' }
    },
    {
      name: 'manage_students',
      description: 'CRUD operations on students. Accepts action (create/read/update/delete), data object.',
      parameters: { action: 'string (required: create/read/update/delete)', id: 'number (for update/delete)', name: 'string', class: 'string', stream: 'string', guardian_name: 'string', guardian_phone: 'string' }
    },
    {
      name: 'manage_finances',
      description: 'Query payments, invoices, and fees. Accepts type (payments/invoices/fees), filters.',
      parameters: { type: 'string (required: payments/invoices/fees)', status: 'string (optional)', from_date: 'string (optional)', to_date: 'string (optional)', limit: 'number' }
    }
  ];

  // Helper to validate API key
  async function validateApiKey(apiKey) {
    if (!apiKey) return null;
    const r = await pool.query('SELECT id, tenant_id, name, scopes FROM api_keys WHERE key_hash = crypt($1, key_hash) LIMIT 1', [apiKey]).catch(() => ({ rows: [] }));
    return r.rows[0] || null;
  }

  // Helper to resolve tenant_id from API key
  function resolveTenantId(apiKeyData, req) {
    if (apiKeyData) return apiKeyData.tenant_id;
    return req.session?.user?.tenant_id || req.session?.user?.school_id || null;
  }

  // MCP tool implementations
  async function executeMcpTool(toolName, args, apiKeyData, req) {
    const tenantId = resolveTenantId(apiKeyData, req);
    if (!tenantId) return { error: 'No tenant context available' };

    switch (toolName) {
      case 'query_tenant_data': {
        const { table, columns, where_clause, limit, offset } = args;
        if (!table) return { error: 'table parameter is required' };
        const validTables = ['students','users','fees','payments','attendance','invoices','subscriptions','notifications','audit_logs','events','announcements','marks','exams','classes','subjects'];
        const safeTable = table.toLowerCase().replace(/[^a-z0-9_]/g, '');
        if (!validTables.includes(safeTable)) return { error: `Invalid table: ${safeTable}. Allowed: ${validTables.join(', ')}` };
        const cols = (columns || '*').replace(/[^a-z0-9_,\s*]/gi, '');
        let sql = `SELECT ${cols} FROM ${safeTable} WHERE tenant_id = $1`;
        const params = [tenantId];
        let paramIdx = 2;
        if (where_clause) {
          if (DANGEROUS_SQL.test(where_clause)) return { error: 'Dangerous SQL detected in where_clause' };
          sql += ` AND ${where_clause.replace(/;?\s*$/, '')}`;
        }
        const lim = Math.min(parseInt(limit) || 50, 500);
        const off = parseInt(offset) || 0;
        sql += ` ORDER BY id DESC NULLS LAST LIMIT ${lim} OFFSET ${off}`;
        try {
          const r = await pool.query(sql, params);
          return { data: r.rows, count: r.rows.length };
        } catch (e) {
          return { error: e.message };
        }
      }

      case 'send_notification': {
        const { message, target_roles } = args;
        if (!message) return { error: 'message parameter is required' };
        let roles = target_roles || ['admin', 'teacher', 'parent'];
        if (!Array.isArray(roles)) roles = [roles];
        const validRoles = ['admin','teacher','parent','student','staff','super_admin'];
        roles = roles.filter(r => validRoles.includes(r));
        if (!roles.length) return { error: 'No valid target_roles specified' };
        const r = await pool.query(
          `INSERT INTO notifications (tenant_id, title, message, target_roles, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [tenantId, 'MCP Notification', message, roles, apiKeyData ? 'mcp_api' : req.session?.user?.email || 'system']
        );
        return { notification_id: r.rows[0]?.id, message: 'Notification created successfully', target_roles: roles };
      }

      case 'get_analytics': {
        const period = args.period || '30d';
        const days = parseInt(period) || 30;
        const [students, payments, users, attendance] = await Promise.all([
          pool.query('SELECT COUNT(*)::int AS total FROM students WHERE tenant_id=$1', [tenantId]).catch(() => ({ rows: [{ total: 0 }] })),
          pool.query(`SELECT COALESCE(SUM(amount),0)::numeric AS total_collected FROM payments WHERE tenant_id=$1 AND status='completed' AND created_at > NOW() - INTERVAL '${Math.min(days, 365)} days'`, [tenantId]).catch(() => ({ rows: [{ total_collected: 0 }] })),
          pool.query("SELECT COUNT(*)::int AS active FROM users WHERE tenant_id=$1 AND last_login > NOW() - INTERVAL '30 days'", [tenantId]).catch(() => ({ rows: [{ active: 0 }] })),
          pool.query(`SELECT CASE WHEN COUNT(*) > 0 THEN ROUND(AVG(present::float / NULLIF(total::float, 0)) * 100, 1) ELSE 0 END AS rate FROM (SELECT COUNT(*) FILTER (WHERE status='present') AS present, COUNT(*) AS total FROM attendance WHERE tenant_id=$1 AND date > NOW() - INTERVAL '${Math.min(days, 365)} days' GROUP BY student_id) sub`, [tenantId]).catch(() => ({ rows: [{ rate: 0 }] })),
        ]);
        return {
          period: `${days} days`,
          total_students: students.rows[0]?.total || 0,
          payments_collected: Number(payments.rows[0]?.total_collected || 0).toFixed(2),
          active_users_30d: users.rows[0]?.active || 0,
          average_attendance_rate: attendance.rows[0]?.rate || '0',
        };
      }

      case 'manage_students': {
        const { action, id, name, class: cls, stream, guardian_name, guardian_phone } = args;
        if (!action) return { error: 'action parameter is required' };
        switch (action) {
          case 'read': {
            const sid = parseInt(id);
            if (sid) {
              const r = await pool.query('SELECT id, name, class, stream, guardian_name, guardian_phone, email, status FROM students WHERE id=$1 AND tenant_id=$2', [sid, tenantId]);
              return r.rows[0] || { error: 'Student not found' };
            }
            const r = await pool.query('SELECT id, name, class, stream, guardian_name, guardian_phone, email, status FROM students WHERE tenant_id=$1 ORDER BY name LIMIT 50', [tenantId]);
            return { data: r.rows, count: r.rows.length };
          }
          case 'create': {
            if (!name) return { error: 'name is required for student creation' };
            const r = await pool.query(`INSERT INTO students (tenant_id, name, class, stream, guardian_name, guardian_phone, status) VALUES ($1,$2,$3,$4,$5,$6,'active') RETURNING id`, [tenantId, name, cls || null, stream || null, guardian_name || null, guardian_phone || null]);
            return { student_id: r.rows[0]?.id, message: 'Student created successfully' };
          }
          case 'update': {
            if (!id) return { error: 'id is required for student update' };
            const r = await pool.query(`UPDATE students SET name=COALESCE($1,name), class=COALESCE($2,class), stream=COALESCE($3,stream), guardian_name=COALESCE($4,guardian_name), guardian_phone=COALESCE($5,guardian_phone) WHERE id=$6 AND tenant_id=$7 RETURNING id`, [name || null, cls || null, stream || null, guardian_name || null, guardian_phone || null, id, tenantId]);
            return r.rowCount > 0 ? { message: 'Student updated successfully' } : { error: 'Student not found' };
          }
          case 'delete': {
            if (!id) return { error: 'id is required for student deletion' };
            const r = await pool.query('DELETE FROM students WHERE id=$1 AND tenant_id=$2', [id, tenantId]);
            return r.rowCount > 0 ? { message: 'Student deleted' } : { error: 'Student not found' };
          }
          default:
            return { error: `Invalid action: ${action}. Use create/read/update/delete.` };
        }
      }

      case 'manage_finances': {
        const { type, status: fStatus, from_date, to_date, limit: fLimit } = args;
        if (!type) return { error: 'type parameter is required (payments/invoices/fees)' };
        const validTypes = ['payments', 'invoices', 'fees'];
        if (!validTypes.includes(type)) return { error: `Invalid type: ${type}. Use payments/invoices/fees.` };
        let sql = `SELECT * FROM ${type} WHERE tenant_id = $1`;
        const params = [tenantId];
        let pi = 2;
        if (fStatus) { sql += ` AND status = $${pi++}`; params.push(fStatus); }
        if (from_date) { sql += ` AND created_at >= $${pi++}`; params.push(from_date); }
        if (to_date) { sql += ` AND created_at <= $${pi++}`; params.push(to_date); }
        sql += ` ORDER BY created_at DESC LIMIT ${Math.min(parseInt(fLimit) || 50, 500)}`;
        const r = await pool.query(sql, params);
        return { data: r.rows, count: r.rows.length };
      }

      default:
        return { error: `Unknown tool: ${toolName}` };
    }
  }

  // Format MCP response
  function mcpResponse(result) {
    return {
      content: [{
        type: 'text',
        text: JSON.stringify(result, null, 2)
      }]
    };
  }

  // ──── POST /api/mcp/tools/call — Call an MCP tool ────
  app.post('/api/mcp/tools/call', ah(async (req, res) => {
    try {
      const { tool_name, arguments: args, api_key } = req.body;
      if (!tool_name) return res.status(400).json({ error: 'tool_name is required' });

      // Validate API key if provided (also works with session auth)
      let apiKeyData = null;
      if (api_key) {
        apiKeyData = await validateApiKey(api_key);
        if (!apiKeyData) return res.status(401).json({ error: 'Invalid API key' });
      }

      // Execute tool
      const result = await executeMcpTool(tool_name, args || {}, apiKeyData, req);

      // Audit log
      const prefix = api_key ? api_key.substring(0, 8) + '...' : 'session';
      try {
        await pool.query(
          'INSERT INTO mcp_audit_log (tenant_id, tool_name, arguments, result, api_key_prefix) VALUES ($1,$2,$3,$4,$5)',
          [resolveTenantId(apiKeyData, req), tool_name, JSON.stringify(args || {}), JSON.stringify(result), prefix]
        );
      } catch (e) { /* non-critical */ }

      if (logger) logger.info('MCP tool called', { tool: tool_name, prefix });
      res.json(mcpResponse(result));
    } catch (e) {
      console.error('[MCP] Tool call error:', e.message);
      res.status(500).json(mcpResponse({ error: e.message }));
    }
  }));

  // ──── GET /api/mcp/tools/list — List available MCP tools ────
  app.get('/api/mcp/tools/list', ah(async (req, res) => {
    res.json({
      protocol: 'mcp',
      version: '1.0',
      tools: MCP_TOOLS.map(t => ({
        name: t.name,
        description: t.description,
        parameters: t.parameters,
      }))
    });
  }));

  // ──── GET /dev/mcp — MCP Developer Dashboard ────
  app.get('/dev/mcp', requireAuth, ah(async (req, res) => {
    if (req.session.user.role !== 'super_admin') return res.status(403).send('Super admin only');
    const auditLog = (await pool.query('SELECT id, tool_name, api_key_prefix, created_at FROM mcp_audit_log ORDER BY created_at DESC LIMIT 20')).rows;

    const toolsHtml = MCP_TOOLS.map(t => `
      <div class="ih-card" style="margin-bottom:12px">
        <div style="display:flex;justify-content:space-between;align-items:start">
          <h3 style="margin:0;color:${DS.primary}">${esc(t.name)}</h3>
          <button class="ih-btn ih-btn-ghost ih-btn-sm" onclick="copyToolDef('${esc(t.name)}')">Copy</button>
        </div>
        <p style="font-size:13px;color:${DS.textMuted};margin:6px 0">${esc(t.description)}</p>
        <div class="ih-code" style="font-size:12px">${esc(JSON.stringify(t.parameters, null, 2))}</div>
      </div>
    `).join('');

    const auditRows = auditLog.length === 0
      ? '<tr><td colspan="4" style="text-align:center;padding:24px;color:' + DS.textMuted + '">No MCP calls recorded yet</td></tr>'
      : auditLog.map(a => `<tr>
        <td><code style="color:${DS.primary}">${esc(a.tool_name)}</code></td>
        <td><code style="font-size:12px;color:${DS.textMuted}">${esc(a.api_key_prefix)}</code></td>
        <td style="font-size:12px;color:${DS.textMuted}">${ago(a.created_at)}</td>
        <td>#${a.id}</td>
      </tr>`).join('');

    const html = `${baseCSS}
      <div style="max-width:1100px;margin:0 auto;padding:20px">
        <h1 style="color:${DS.text};margin:0 0 4px">🔌 MCP Server</h1>
        <p style="color:${DS.textMuted};margin:0 0 20px">Model Context Protocol — AI tool-calling interface for external integrations</p>

        <div class="ih-grid">
          ${statCard('Available Tools', MCP_TOOLS.length, '🔧', DS.primary)}
          ${statCard('API Calls', auditLog.length, '📊', DS.accent)}
          ${statCard('Protocol', 'MCP v1.0', '📡', DS.success)}
        </div>

        <div class="ih-grid2">
          <div>
            <div class="ih-card">
              <h2>🧪 Test MCP Tool</h2>
              <div style="margin-bottom:12px">
                <label class="ih-label">Tool</label>
                <select id="mcpTool" class="ih-select" onchange="updateParams()">
                  ${MCP_TOOLS.map(t => `<option value="${esc(t.name)}">${esc(t.name)}</option>`).join('')}
                </select>
              </div>
              <div style="margin-bottom:12px">
                <label class="ih-label">API Key (optional)</label>
                <input type="text" id="mcpApiKey" class="ih-input" placeholder="Leave blank for session auth">
              </div>
              <div style="margin-bottom:12px">
                <label class="ih-label">Arguments (JSON)</label>
                <textarea id="mcpArgs" class="ih-textarea" rows="6">${esc(JSON.stringify({ action: 'read' }, null, 2))}</textarea>
              </div>
              <div style="display:flex;gap:10px">
                <button class="ih-btn ih-btn-primary" onclick="callTool()">▶ Execute</button>
                <button class="ih-btn ih-btn-ghost" onclick="clearResult()">Clear</button>
              </div>
              <div id="mcpResult" style="margin-top:16px"></div>
            </div>
          </div>
          <div>
            <div class="ih-card">
              <h2>📋 Available Tools</h2>
              <div class="ih-scroll" style="max-height:500px">${toolsHtml}</div>
            </div>
          </div>
        </div>

        <div class="ih-card">
          <h2>📜 API Call Log</h2>
          <div style="overflow-x:auto">
            <table class="ih-table">
              <thead><tr><th>Tool</th><th>Auth</th><th>Time</th><th>ID</th></tr></thead>
              <tbody>${auditRows}</tbody>
            </table>
          </div>
        </div>
      </div>
      <script>
      function updateParams(){
        const t=document.getElementById('mcpTool').value;
        const defaults={query_tenant_data:{table:'students',columns:'*',limit:50},send_notification:{message:'Hello from MCP',target_roles:['admin']},get_analytics:{period:'30d'},manage_students:{action:'read'},manage_finances:{type:'payments',limit:20}};
        document.getElementById('mcpArgs').value=JSON.stringify(defaults[t]||{},null,2);
      }
      async function callTool(){
        const r=document.getElementById('mcpResult');
        r.innerHTML='<div style="padding:12px;color:'+'${DS.textMuted}'+'">Executing...</div>';
        try{
          const resp=await fetch('/api/mcp/tools/call',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({tool_name:document.getElementById('mcpTool').value,arguments:JSON.parse(document.getElementById('mcpArgs').value),api_key:document.getElementById('mcpApiKey').value||null})
          });
          const data=await resp.json();
          r.innerHTML='<div class="ih-code" style="margin-top:0;max-height:300px;overflow-y:auto">'+JSON.stringify(data,null,2).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')+'</div>';
        }catch(e){r.innerHTML='<div style="padding:12px;color:#ef4444">Error: '+e.message+'</div>'}
      }
      function clearResult(){document.getElementById('mcpResult').innerHTML=''}
      function copyToolDef(name){navigator.clipboard.writeText(name).catch(()=>{})}
      </script>
    `;
    res.send(renderPage('MCP Server — Dev', html, req.session?.user));
  }));


  // ═══════════════════════════════════════════════════════════════
  //  2. UPTIME ROBOT MONITORING ENDPOINTS
  // ═══════════════════════════════════════════════════════════════

  // ──── GET /monitor/ping — Ultra-lightweight ping (no DB) ────
  app.get('/monitor/ping', (req, res) => {
    res.set('Content-Type', 'application/json');
    res.set('Cache-Control', 'no-cache, no-store');
    res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      pid: process.pid
    });
  });

  // ──── GET /monitor/health — Full health check (DB + system) ────
  app.get('/monitor/health', ah(async (req, res) => {
    // Check for monitor-specific API key (optional, but recommended)
    const authKey = req.headers['x-monitor-key'] || req.query.key;
    if (authKey && authKey !== UPTIME_HEALTH_KEY) {
      return res.status(403).json({ error: 'Invalid monitor key' });
    }

    const startTime = Date.now();
    let dbStatus = 'up';
    let dbLatency = 0;
    try {
      await pool.query('SELECT 1');
      dbLatency = Date.now() - startTime;
    } catch (e) {
      dbStatus = 'down';
      dbLatency = -1;
    }

    const mem = process.memoryUsage();
    const memMB = Math.round(mem.heapUsed / 1048576);
    const overallStatus = dbStatus === 'up' ? 'up' : 'down';

    // Log this check
    try {
      await pool.query(
        'INSERT INTO uptime_monitor_log (db_latency_ms, memory_mb, status) VALUES ($1, $2, $3)',
        [dbLatency, memMB, overallStatus]
      );
    } catch (e) { /* non-critical */ }

    res.set('Content-Type', 'application/json');
    res.set('Cache-Control', 'no-cache, no-store');
    res.json({
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime_seconds: Math.floor(process.uptime()),
      node_version: process.version,
      pid: process.pid,
      database: {
        status: dbStatus,
        latency_ms: dbLatency,
        pool_total: pool.totalCount || 0,
        pool_idle: pool.idleCount || 0,
        pool_waiting: pool.waitingCount || 0,
      },
      memory: {
        heap_used_mb: memMB,
        heap_total_mb: Math.round(mem.heapTotal / 1048576),
        rss_mb: Math.round(mem.rss / 1048576),
      },
      system: {
        platform: process.platform,
        arch: process.arch,
        cpu_count: os.cpus().length,
        load_avg: os.loadavg().map(l => l.toFixed(2)),
      }
    });
  }));

  // ──── GET /dev/uptime — Uptime Monitoring Dashboard ────
  app.get('/dev/uptime', requireAuth, ah(async (req, res) => {
    if (req.session.user.role !== 'super_admin') return res.status(403).send('Super admin only');

    const logs = (await pool.query('SELECT * FROM uptime_monitor_log ORDER BY check_time DESC LIMIT 200')).rows;
    const recentLogs = logs.slice(0, 50);

    // Stats
    const totalChecks = logs.length;
    const upChecks = logs.filter(l => l.status === 'up').length;
    const upPct = totalChecks > 0 ? ((upChecks / totalChecks) * 100).toFixed(1) : '100.0';
    const avgLatency = logs.length > 0 ? Math.round(logs.reduce((s, l) => s + (l.db_latency_ms || 0), 0) / logs.length) : 0;
    const lastCheck = logs[0];
    const avgMem = logs.length > 0 ? Math.round(logs.reduce((s, l) => s + (l.memory_mb || 0), 0) / logs.length) : 0;

    // Chart data (last 50 checks, reversed for time order)
    const chartData = recentLogs.slice().reverse();
    const latencyData = chartData.map(l => ({ label: new Date(l.check_time).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }), value: l.db_latency_ms || 0 }));
    const memData = chartData.map(l => ({ label: new Date(l.check_time).toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' }), value: l.memory_mb || 0 }));

    // SVG line chart helper
    function svgLine(data, w, h, color) {
      if (!data || data.length < 2) return '<p style="text-align:center;padding:20px;color:' + DS.textMuted + '">Not enough data</p>';
      const padL = 50, padR = 20, padT = 20, padB = 40;
      const cw = w - padL - padR, ch = h - padT - padB;
      const mx = Math.max(...data.map(d => d.value), 1);
      const stepX = cw / (data.length - 1);
      let points = data.map((d, i) => `${padL + i * stepX},${padT + ch - (d.value / mx) * ch}`).join(' ');
      let areaPoints = `${padL},${padT + ch} ${points} ${padL + (data.length - 1) * stepX},${padT + ch}`;
      let grid = '';
      for (let i = 0; i <= 4; i++) {
        const y = padT + (ch / 4) * i;
        const val = Math.round(mx - (mx / 4) * i);
        grid += `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" stroke="${DS.cardBorder}" stroke-width="1" stroke-dasharray="3,3"/>`;
        grid += `<text x="${padL - 8}" y="${y + 4}" fill="${DS.textMuted}" font-size="10" text-anchor="end">${val}</text>`;
      }
      return `<svg width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" style="display:block;max-width:100%">
        <defs><linearGradient id="lg_${color.replace('#','')}" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stop-color="${color}" stop-opacity="0.3"/><stop offset="100%" stop-color="${color}" stop-opacity="0.02"/></linearGradient></defs>
        ${grid}
        <polygon points="${areaPoints}" fill="url(#lg_${color.replace('#','')})"/>
        <polyline points="${points}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      </svg>`;
    }

    const logRows = recentLogs.length === 0
      ? '<tr><td colspan="5" style="text-align:center;padding:24px;color:' + DS.textMuted + '">No health checks recorded yet. Wait for UptimeRobot to start pinging.</td></tr>'
      : recentLogs.map(l => `<tr>
        <td>${statusBadge(l.status)}</td>
        <td style="font-weight:600">${l.db_latency_ms || 0}ms</td>
        <td>${Math.round(l.memory_mb || 0)} MB</td>
        <td style="font-size:12px;color:${DS.textMuted}">${new Date(l.check_time).toLocaleString()}</td>
        <td>#${l.id}</td>
      </tr>`).join('');

    const html = `${baseCSS}
      <div style="max-width:1100px;margin:0 auto;padding:20px">
        <h1 style="color:${DS.text};margin:0 0 4px">📡 Uptime Monitoring</h1>
        <p style="color:${DS.textMuted};margin:0 0 20px">Server health checks and UptimeRobot integration</p>

        <div class="ih-grid">
          ${statCard('Uptime', upPct + '%', '💚', parseFloat(upPct) >= 99 ? DS.success : parseFloat(upPct) >= 95 ? DS.warning : DS.danger)}
          ${statCard('Total Checks', fmtNum(totalChecks), '📊', DS.primary)}
          ${statCard('Avg Latency', avgLatency + 'ms', '⚡', DS.accent)}
          ${statCard('Avg Memory', avgMem + ' MB', '🧠', DS.warning)}
          ${statCard('Last Check', lastCheck ? ago(lastCheck.check_time) : 'N/A', '🕐', DS.textMuted)}
          ${statCard('System Uptime', fmtUptime(process.uptime()), '⏱️', DS.success)}
        </div>

        <div class="ih-grid2" style="margin-bottom:20px">
          <div class="ih-card">
            <h2>⚡ DB Latency (Last 50 Checks)</h2>
            ${svgLine(latencyData, 500, 160, DS.primary)}
          </div>
          <div class="ih-card">
            <h2>🧠 Memory Usage (Last 50 Checks)</h2>
            ${svgLine(memData, 500, 160, DS.warning)}
          </div>
        </div>

        <div class="ih-card" style="margin-bottom:16px">
          <h2>📋 Monitor Endpoints</h2>
          <div class="ih-grid" style="grid-template-columns:1fr 1fr">
            <div style="background:${DS.bg};border-radius:10px;padding:16px">
              <h3 style="color:${DS.success}">Ping Monitor</h3>
              <p style="font-size:13px;color:${DS.textMuted};margin:4px 0 8px">Ultra-lightweight, no DB. Key: <code>${esc(UPTIME_PING_KEY)}</code></p>
              <div class="ih-code" style="font-size:12px">${esc(process.env.BASE_URL || 'https://ssewasswa.onrender.com')}/monitor/ping</div>
            </div>
            <div style="background:${DS.bg};border-radius:10px;padding:16px">
              <h3 style="color:${DS.primary}">Health Monitor</h3>
              <p style="font-size:13px;color:${DS.textMuted};margin:4px 0 8px">Full check (DB + memory + uptime). Key: <code>${esc(UPTIME_HEALTH_KEY)}</code></p>
              <div class="ih-code" style="font-size:12px">${esc(process.env.BASE_URL || 'https://ssewasswa.onrender.com')}/monitor/health</div>
            </div>
          </div>
        </div>

        <div class="ih-card">
          <h2>📜 Health Check Log</h2>
          <div class="ih-scroll">
            <table class="ih-table">
              <thead><tr><th>Status</th><th>DB Latency</th><th>Memory</th><th>Time</th><th>ID</th></tr></thead>
              <tbody>${logRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    res.send(renderPage('Uptime Monitoring — Dev', html, req.session?.user));
  }));


  // ═══════════════════════════════════════════════════════════════
  //  3. PUSH NOTIFICATION CONNECTORS (web-push)
  // ═══════════════════════════════════════════════════════════════

  // Try to load web-push library
  let webpush = null;
  try {
    webpush = require('web-push');
  } catch (e) {
    console.warn('[IntegrationsHub] web-push library not available. Push notifications disabled:', e.message);
  }

  // ──── POST /api/push/subscribe — Browser push subscription ────
  app.post('/api/push/subscribe', requireAuth, ah(async (req, res) => {
    try {
      const { endpoint, keys } = req.body;
      if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
        return res.status(400).json({ error: 'Missing required push subscription fields: endpoint, keys.p256dh, keys.auth' });
      }
      const userId = req.session?.user?.id;
      const tenantId = schoolId(req);

      // Upsert subscription
      await pool.query(`
        INSERT INTO push_subscriptions (user_id, tenant_id, endpoint, keys_p256dh, keys_auth, platform, is_active)
        VALUES ($1, $2, $3, $4, $5, 'web', true)
        ON CONFLICT ON CONSTRAINT push_subscriptions_endpoint_key
        DO UPDATE SET user_id=$1, tenant_id=$2, keys_p256dh=$4, keys_auth=$5, is_active=true
      `, [userId, tenantId, endpoint, keys.p256dh, keys.auth]).catch(async () => {
        // If constraint doesn't exist, try simple insert
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [endpoint]);
        await pool.query('INSERT INTO push_subscriptions (user_id, tenant_id, endpoint, keys_p256dh, keys_auth, platform, is_active) VALUES ($1,$2,$3,$4,$5,$6,true)', [userId, tenantId, endpoint, keys.p256dh, keys.auth, 'web']);
      });

      await audit(userEmail(req), 'push_subscribed', { endpoint: endpoint.substring(0, 60) }, tenantId, req);
      res.json({ success: true, message: 'Push subscription registered' });
    } catch (e) {
      console.error('[Push] Subscribe error:', e.message);
      res.status(500).json({ error: e.message });
    }
  }));

  // ──── POST /api/push/send — Send push notification ────
  app.post('/api/push/send', requireAuth, ah(async (req, res) => {
    try {
      if (!webpush) return res.status(503).json({ error: 'web-push library not available' });
      const { user_ids, target, title, body, icon, url: clickUrl, tenant_id } = req.body;
      const tenantId = tenant_id || schoolId(req);

      let subscriptions;
      if (user_ids && Array.isArray(user_ids.length)) {
        subscriptions = (await pool.query('SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE user_id = ANY($1) AND tenant_id = $2 AND is_active = true', [user_ids, tenantId])).rows;
      } else {
        // Get all subscriptions for the tenant, optionally filtered by target role
        let userFilter = '';
        const params = [tenantId];
        if (target && target !== 'all') {
          userFilter = ' AND u.role = $2';
          params.push(target);
        }
        subscriptions = (await pool.query(
          `SELECT ps.endpoint, ps.keys_p256dh, ps.keys_auth FROM push_subscriptions ps
           JOIN users u ON u.id = ps.user_id
           WHERE ps.tenant_id = $1 AND ps.is_active = true ${userFilter}`,
          params
        )).rows;
      }

      if (subscriptions.length === 0) {
        return res.json({ sent: 0, message: 'No active push subscriptions found' });
      }

      let sentCount = 0;
      let failedCount = 0;
      const payload = JSON.stringify({ title: title || 'Comfort Zone', body: body || '', icon: icon || '/icon-192.png', url: clickUrl || '/' });

      for (const sub of subscriptions) {
        try {
          await webpush.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
            payload,
            { vapidDetails: { subject: 'mailto:admin@comfort.ug', publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY } }
          );
          sentCount++;
        } catch (e) {
          failedCount++;
          // Remove dead subscriptions
          if (e.statusCode === 404 || e.statusCode === 410) {
            await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]).catch(() => {});
          }
        }
      }

      await audit(userEmail(req), 'push_notification_sent', { sent: sentCount, failed: failedCount, tenant_id: tenantId }, tenantId, req);
      res.json({ sent: sentCount, failed: failedCount, total: subscriptions.length });
    } catch (e) {
      console.error('[Push] Send error:', e.message);
      res.status(500).json({ error: e.message });
    }
  }));

  // ──── GET /settings/push — Push Notification Settings ────
  app.get('/settings/push', requireAuth, ah(async (req, res) => {
    const tenantId = schoolId(req);
    const subCount = (await pool.query('SELECT COUNT(*)::int AS cnt FROM push_subscriptions WHERE tenant_id=$1 AND is_active=true', [tenantId])).rows[0]?.cnt || 0;
    const recentSubs = (await pool.query('SELECT id, user_id, platform, endpoint, created_at FROM push_subscriptions WHERE tenant_id=$1 ORDER BY created_at DESC LIMIT 20', [tenantId])).rows;

    const subsRows = recentSubs.length === 0
      ? '<tr><td colspan="5" style="text-align:center;padding:24px;color:' + DS.textMuted + '">No push subscriptions yet</td></tr>'
      : recentSubs.map(s => `<tr>
        <td>#${s.id}</td>
        <td>${s.user_id || '—'}</td>
        <td>${statusBadge(s.platform || 'web')}</td>
        <td><code style="font-size:11px;color:${DS.textMuted}">${esc(s.endpoint ? s.endpoint.substring(0, 50) + '...' : 'N/A')}</code></td>
        <td style="font-size:12px;color:${DS.textMuted}">${ago(s.created_at)}</td>
      </tr>`).join('');

    const html = `${baseCSS}
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <h1 style="color:${DS.text};margin:0 0 4px">🔔 Push Notifications</h1>
        <p style="color:${DS.textMuted};margin:0 0 20px">Browser push notification settings and management</p>

        <div class="ih-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr))">
          ${statCard('Active Subscriptions', subCount, '📱', DS.primary)}
          ${statCard('VAPID Keys', process.env.VAPID_PUBLIC_KEY ? 'Configured' : 'Auto-generated', '🔑', process.env.VAPID_PUBLIC_KEY ? DS.success : DS.warning)}
          ${statCard('web-push Library', webpush ? 'Available' : 'Not Installed', '📦', webpush ? DS.success : DS.danger)}
        </div>

        <div class="ih-card" style="margin-top:20px">
          <h2>📋 Active Subscriptions</h2>
          <div style="overflow-x:auto">
            <table class="ih-table">
              <thead><tr><th>ID</th><th>User</th><th>Platform</th><th>Endpoint</th><th>Registered</th></tr></thead>
              <tbody>${subsRows}</tbody>
            </table>
          </div>
        </div>

        <div class="ih-card" style="margin-top:16px">
          <h2>🧪 Send Test Notification</h2>
          <form method="POST" action="/api/push/send" id="pushTestForm" onsubmit="return sendPushTest(event)">
            <div class="ih-grid2" style="gap:12px;margin-bottom:12px">
              <div><label class="ih-label">Title</label><input name="title" class="ih-input" value="Test Notification"></div>
              <div><label class="ih-label">Target</label>
                <select name="target" class="ih-select">
                  <option value="all">All Users</option>
                  <option value="admin">Admins</option>
                  <option value="teacher">Teachers</option>
                  <option value="parent">Parents</option>
                  <option value="student">Students</option>
                </select>
              </div>
            </div>
            <div style="margin-bottom:12px"><label class="ih-label">Body</label><textarea name="body" class="ih-textarea" rows="3">This is a test push notification from Comfort Zone.</textarea></div>
            <div id="pushResult"></div>
            <button type="submit" class="ih-btn ih-btn-primary">Send Test Push</button>
          </form>
        </div>

        <div class="ih-card" style="margin-top:16px">
          <h2>📖 Integration Guide</h2>
          <div class="ih-alert ih-alert-info">
            <strong>Setup:</strong> Use the Service Worker (<code>sw.js</code>) on your site to register push subscriptions. The VAPID keys are auto-configured. Send notifications via the API or this dashboard.
          </div>
          <div class="ih-code" style="margin-top:12px">
// Client-side push registration
navigator.serviceWorker.ready.then(reg => {
  reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: '${esc(process.env.VAPID_PUBLIC_KEY || '')}'
  }).then(sub => {
    fetch('/api/push/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(sub.toJSON())
    });
  });
});</div>
        </div>
      </div>
      <script>
      async function sendPushTest(e){
        e.preventDefault();
        const f=document.getElementById('pushTestForm');
        const r=document.getElementById('pushResult');
        r.innerHTML='<div style="padding:8px;color:${DS.textMuted}">Sending...</div>';
        try{
          const fd=new FormData(f);
          const resp=await fetch('/api/push/send',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({title:fd.get('title'),body:fd.get('body'),target:fd.get('target')})
          });
          const data=await resp.json();
          r.innerHTML='<div class="ih-alert ih-alert-success">Sent: '+data.sent+', Failed: '+data.failed+'</div>';
        }catch(e){r.innerHTML='<div class="ih-alert ih-alert-danger">Error: '+e.message+'</div>'}
        return false;
      }
      </script>
    `;
    res.send(renderPage('Push Notifications — Settings', html, req.session?.user));
  }));


  // ═══════════════════════════════════════════════════════════════
  //  4. WEBHOOK & INTEGRATION MANAGEMENT
  // ═══════════════════════════════════════════════════════════════

  // ──── GET /settings/integrations — Main Integrations Dashboard ────
  app.get('/settings/integrations', requireAuth, ah(async (req, res) => {
    const tenantId = schoolId(req);

    // Fetch integration statuses
    const [tgConfig, slackConfig] = await Promise.all([
      pool.query('SELECT * FROM telegram_config WHERE tenant_id=$1', [tenantId]).catch(() => ({ rows: [] })),
      pool.query('SELECT * FROM slack_config WHERE tenant_id=$1', [tenantId]).catch(() => ({ rows: [] })),
    ]);

    const tgEnabled = tgConfig.rows[0]?.is_enabled || false;
    const slEnabled = slackConfig.rows[0]?.is_enabled || false;
    const pushAvailable = !!webpush;
    const pushCount = (await pool.query('SELECT COUNT(*)::int AS cnt FROM push_subscriptions WHERE tenant_id=$1 AND is_active=true', [tenantId])).rows[0]?.cnt || 0;

    const integrations = [
      { icon: '💬', name: 'WhatsApp', desc: 'Send receipts and notifications via WhatsApp', status: 'existing', link: '/settings/whatsapp', color: DS.success },
      { icon: '📨', name: 'Telegram', desc: 'Bot-based messaging via Telegram API', status: tgEnabled ? 'active' : 'available', link: '/settings/integrations/telegram', color: tgEnabled ? DS.success : DS.textMuted },
      { icon: '📱', name: 'Slack', desc: 'Send notifications to Slack channels', status: slEnabled ? 'active' : 'available', link: '/settings/integrations/slack', color: slEnabled ? DS.success : DS.textMuted },
      { icon: '🔗', name: 'Webhooks', desc: 'Outgoing webhook management', status: 'existing', link: '/settings/webhooks', color: DS.accent },
      { icon: '🤖', name: 'MCP Server', desc: 'Model Context Protocol for AI integrations', status: 'active', link: '/dev/mcp', color: DS.primary },
      { icon: '🔔', name: 'Push', desc: `Browser push notifications (${pushCount} subs)`, status: pushAvailable ? 'active' : 'unavailable', link: '/settings/push', color: pushAvailable ? DS.warning : DS.textLight },
    ];

    const cardsHtml = integrations.map(i => `
      <a href="${i.link}" style="text-decoration:none">
        <div class="ih-integration-card">
          <div class="icon">${i.icon}</div>
          <div class="name">${esc(i.name)}</div>
          <div class="desc">${esc(i.desc)}</div>
          <div style="margin-top:10px">${statusBadge(i.status)}</div>
        </div>
      </a>
    `).join('');

    const html = `${baseCSS}
      <div style="max-width:1000px;margin:0 auto;padding:20px">
        <h1 style="color:${DS.text};margin:0 0 4px">🔌 Integrations Hub</h1>
        <p style="color:${DS.textMuted};margin:0 0 24px">Manage all your third-party integrations in one place</p>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(250px,1fr));gap:16px">
          ${cardsHtml}
        </div>

        <div class="ih-card" style="margin-top:24px">
          <h2>📋 Unified Notification API</h2>
          <p style="font-size:13px;color:${DS.textMuted};margin-bottom:12px">Send notifications through any channel via a single endpoint.</p>
          <div class="ih-code">POST /api/notify
{
  "channel": "push|email|telegram|slack|whatsapp|sms",
  "recipient": "user_id or phone or email",
  "subject": "Notification Title",
  "message": "Notification body"
}</div>
        </div>
      </div>
    `;
    res.send(renderPage('Integrations Hub', html, req.session?.user));
  }));


  // ──── POST /api/telegram/webhook — Telegram Bot Webhook Receiver ────
  app.post('/api/telegram/webhook', ah(async (req, res) => {
    try {
      const update = req.body;
      if (!update || !update.message) {
        return res.status(200).json({ ok: true }); // Acknowledge non-message updates
      }

      const msg = update.message;
      const chatId = String(msg.chat.id);
      const text = msg.text || '';
      const fromUsername = msg.from?.username || msg.from?.first_name || 'unknown';

      // Find which tenant this chat belongs to (by chat_id)
      const configs = (await pool.query('SELECT tenant_id, bot_token FROM telegram_config WHERE default_chat_id = $1 AND is_enabled = true', [chatId])).rows;
      if (configs.length === 0) {
        return res.status(200).json({ ok: true, message: 'No tenant configured for this chat' });
      }

      for (const cfg of configs) {
        // Log incoming message
        await pool.query(
          'INSERT INTO telegram_messages (tenant_id, chat_id, message_text, direction, status) VALUES ($1, $2, $3, $4, $5)',
          [cfg.tenant_id, chatId, text, 'inbound', 'received']
        ).catch(() => {});

        // Auto-reply for specific commands
        let reply = null;
        if (text === '/start') {
          reply = '👋 Welcome to Comfort Zone Bot! I can help you with notifications and updates. Type /help for available commands.';
        } else if (text === '/help') {
          reply = '📚 Available commands:\n/start - Welcome message\n/status - System status\n/help - This help message\n/stats - Quick statistics';
        } else if (text === '/status') {
          reply = `✅ Comfort Zone System Status:\n🕐 Uptime: ${fmtUptime(process.uptime())}\n🧠 Memory: ${Math.round(process.memoryUsage().heapUsed / 1048576)} MB\n📊 DB: Connected\n🔗 API: Operational`;
        } else if (text === '/stats') {
          const [students, users] = await Promise.all([
            pool.query('SELECT COUNT(*)::int AS cnt FROM students WHERE tenant_id=$1', [cfg.tenant_id]).catch(() => ({ rows: [{ cnt: 0 }] })),
            pool.query('SELECT COUNT(*)::int AS cnt FROM users WHERE tenant_id=$1', [cfg.tenant_id]).catch(() => ({ rows: [{ cnt: 0 }] })),
          ]);
          reply = `📊 Quick Stats:\n👥 Users: ${students.rows[0]?.cnt || 0}\n👨‍🎓 Students: ${users.rows[0]?.cnt || 0}`;
        }

        if (reply) {
          try {
            const https = require('https');
            const url = `https://api.telegram.org/bot${cfg.bot_token}/sendMessage`;
            const body = JSON.stringify({ chat_id: chatId, text: reply, parse_mode: 'HTML' });
            await new Promise((resolve, reject) => {
              const u = new URL(url);
              const options = { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
              const r = https.request(options, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => resolve(d)); });
              r.on('error', reject);
              r.write(body);
              r.end();
            });
            // Log reply
            await pool.query(
              'INSERT INTO telegram_messages (tenant_id, chat_id, message_text, direction, status) VALUES ($1, $2, $3, $4, $5)',
              [cfg.tenant_id, chatId, reply, 'outbound', 'sent']
            ).catch(() => {});
          } catch (e) {
            console.error('[Telegram] Send reply error:', e.message);
          }
        }
      }

      res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[Telegram] Webhook error:', e.message);
      res.status(200).json({ ok: true }); // Always acknowledge Telegram webhooks
    }
  }));

  // ──── POST /api/slack/events — Slack Events API Receiver ────
  app.post('/api/slack/events', ah(async (req, res) => {
    try {
      // Slack URL verification
      if (req.body.type === 'url_verification') {
        return res.json({ challenge: req.body.challenge });
      }

      const event = req.body.event;
      if (!event || event.type !== 'message') {
        return res.status(200).json({ ok: true });
      }

      const channelId = event.channel;
      const text = event.text || '';
      const userName = event.user || 'unknown';

      // Find tenant config for this channel
      const configs = (await pool.query('SELECT tenant_id, webhook_url FROM slack_config WHERE default_channel = $1 AND is_enabled = true', [channelId])).rows;
      if (configs.length === 0) {
        return res.status(200).json({ ok: true });
      }

      for (const cfg of configs) {
        // Log incoming message
        await pool.query(
          'INSERT INTO slack_messages (tenant_id, channel, message_text, direction, status) VALUES ($1, $2, $3, $4, $5)',
          [cfg.tenant_id, channelId, `From ${userName}: ${text}`, 'inbound', 'received']
        ).catch(() => {});
      }

      res.status(200).json({ ok: true });
    } catch (e) {
      console.error('[Slack] Events error:', e.message);
      res.status(200).json({ ok: true });
    }
  }));


  // ──── GET /settings/integrations/telegram — Telegram Setup Page ────
  app.get('/settings/integrations/telegram', requireAuth, ah(async (req, res) => {
    const tenantId = schoolId(req);
    let config = (await pool.query('SELECT * FROM telegram_config WHERE tenant_id=$1', [tenantId])).rows[0];
    const messages = (await pool.query('SELECT * FROM telegram_messages WHERE tenant_id=$1 ORDER BY sent_at DESC LIMIT 30', [tenantId])).rows;

    // Handle POST (save config)
    if (req.method === 'POST') {
      // This is handled by the POST route below, but we also support inline save from form
    }

    const maskedToken = config?.bot_token ? config.bot_token.substring(0, 6) + '•••••••' : 'Not set';

    const msgRows = messages.length === 0
      ? '<tr><td colspan="5" style="text-align:center;padding:24px;color:' + DS.textMuted + '">No messages yet. Send a message to your bot to test.</td></tr>'
      : messages.map(m => `<tr>
        <td>${statusBadge(m.direction)}</td>
        <td style="font-size:12px;color:${DS.textMuted}">${esc(m.chat_id)}</td>
        <td>${esc(m.message_text ? m.message_text.substring(0, 80) : '')}${m.message_text && m.message_text.length > 80 ? '...' : ''}</td>
        <td>${statusBadge(m.status)}</td>
        <td style="font-size:12px;color:${DS.textMuted}">${ago(m.sent_at)}</td>
      </tr>`).join('');

    const webhookUrl = (process.env.BASE_URL || 'https://ssewasswa.onrender.com') + '/api/telegram/webhook';

    const html = `${baseCSS}
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <h1 style="color:${DS.text};margin:0 0 4px">📨 Telegram Integration</h1>
        <p style="color:${DS.textMuted};margin:0 0 20px">Configure your Telegram bot for automated notifications</p>

        <div class="ih-card">
          <h2>⚙️ Bot Configuration</h2>
          <form method="POST" action="/settings/integrations/telegram/save">
            <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
            <div class="ih-grid2" style="gap:12px;margin-bottom:12px">
              <div>
                <label class="ih-label">Bot Token</label>
                <input type="password" name="bot_token" class="ih-input" value="${esc(config?.bot_token || '')}" placeholder="123456:ABC-DEF1234ghIkl-zyx57W2v1u123ew11">
              </div>
              <div>
                <label class="ih-label">Default Chat ID</label>
                <input type="text" name="default_chat_id" class="ih-input" value="${esc(config?.default_chat_id || '')}" placeholder="-1001234567890">
              </div>
            </div>
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              <label class="ih-label" style="margin:0">Enabled</label>
              <label class="ih-toggle">
                <input type="checkbox" name="is_enabled" ${config?.is_enabled ? 'checked' : ''} value="true">
                <span></span>
              </label>
            </div>
            <div style="display:flex;gap:10px">
              <button type="submit" class="ih-btn ih-btn-primary">Save Configuration</button>
              <a href="/settings/integrations" class="ih-btn ih-btn-ghost">Back</a>
            </div>
          </form>
        </div>

        <div class="ih-card" style="margin-top:16px">
          <h2>📋 Setup Guide</h2>
          <div class="ih-alert ih-alert-info" style="margin-bottom:12px">
            <strong>Step 1:</strong> Create a bot via @BotFather on Telegram. Copy the token.<br>
            <strong>Step 2:</strong> Send a message to your bot, then get the chat_id from the bot API.<br>
            <strong>Step 3:</strong> Set the webhook URL below to receive messages.
          </div>
          <div style="margin-bottom:12px">
            <label class="ih-label">Webhook URL</label>
            <div class="ih-code" style="font-size:12px;user-select:all">${esc(webhookUrl)}</div>
          </div>
          <p style="font-size:13px;color:${DS.textMuted}">
            <strong>Current Token:</strong> <code>${esc(maskedToken)}</code> &nbsp;
            <strong>Status:</strong> ${config?.is_enabled ? statusBadge('enabled') : statusBadge('disabled')}
          </p>
        </div>

        <div class="ih-card" style="margin-top:16px">
          <h2>💬 Message Log</h2>
          <div class="ih-scroll">
            <table class="ih-table">
              <thead><tr><th>Direction</th><th>Chat ID</th><th>Message</th><th>Status</th><th>Time</th></tr></thead>
              <tbody>${msgRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    res.send(renderPage('Telegram Integration', html, req.session?.user));
  }));

  // ──── POST /settings/integrations/telegram/save — Save Telegram Config ────
  app.post('/settings/integrations/telegram/save', requireAuth, ah(async (req, res) => {
    try {
      const tenantId = schoolId(req);
      const { bot_token, default_chat_id, is_enabled } = req.body;
      const enabled = is_enabled === 'true' || is_enabled === 'on' || is_enabled === true;

      await pool.query(`
        INSERT INTO telegram_config (tenant_id, bot_token, default_chat_id, is_enabled)
        VALUES ($1, $2, $3, $4)
        ON CONFLICT (tenant_id) DO UPDATE SET
          bot_token = COALESCE(NULLIF($2, ''), bot_token),
          default_chat_id = COALESCE(NULLIF($3, ''), default_chat_id),
          is_enabled = $4
      `, [tenantId, bot_token || null, default_chat_id || null, enabled]);

      await audit(userEmail(req), 'telegram_config_saved', { enabled, has_token: !!bot_token }, tenantId, req);
      req.session.flash = { msg: 'Telegram configuration saved successfully', type: 'success' };
      res.redirect('/settings/integrations/telegram');
    } catch (e) {
      console.error('[Telegram] Save error:', e.message);
      req.session.flash = { msg: 'Error saving configuration: ' + e.message, type: 'error' };
      res.redirect('/settings/integrations/telegram');
    }
  }));


  // ──── GET /settings/integrations/slack — Slack Setup Page ────
  app.get('/settings/integrations/slack', requireAuth, ah(async (req, res) => {
    const tenantId = schoolId(req);
    const config = (await pool.query('SELECT * FROM slack_config WHERE tenant_id=$1', [tenantId])).rows[0];
    const messages = (await pool.query('SELECT * FROM slack_messages WHERE tenant_id=$1 ORDER BY sent_at DESC LIMIT 30', [tenantId])).rows;

    const maskedWebhook = config?.webhook_url ? config.webhook_url.substring(0, 40) + '••••' : 'Not set';

    const msgRows = messages.length === 0
      ? '<tr><td colspan="5" style="text-align:center;padding:24px;color:' + DS.textMuted + '">No messages yet</td></tr>'
      : messages.map(m => `<tr>
        <td>${statusBadge(m.direction)}</td>
        <td style="font-size:12px;color:${DS.textMuted}">${esc(m.channel)}</td>
        <td>${esc(m.message_text ? m.message_text.substring(0, 80) : '')}</td>
        <td>${statusBadge(m.status)}</td>
        <td style="font-size:12px;color:${DS.textMuted}">${ago(m.sent_at)}</td>
      </tr>`).join('');

    const eventsUrl = (process.env.BASE_URL || 'https://ssewasswa.onrender.com') + '/api/slack/events';

    const html = `${baseCSS}
      <div style="max-width:900px;margin:0 auto;padding:20px">
        <h1 style="color:${DS.text};margin:0 0 4px">📱 Slack Integration</h1>
        <p style="color:${DS.textMuted};margin:0 0 20px">Send notifications to Slack channels and receive events</p>

        <div class="ih-card">
          <h2>⚙️ Slack Configuration</h2>
          <form method="POST" action="/settings/integrations/slack/save">
            <input type="hidden" name="_csrf" value="${esc(req.csrfToken || '')}">
            <div class="ih-grid2" style="gap:12px;margin-bottom:12px">
              <div>
                <label class="ih-label">Webhook URL</label>
                <input type="url" name="webhook_url" class="ih-input" value="${esc(config?.webhook_url || '')}" placeholder="https://hooks.slack.com/services/T.../B.../xxx">
              </div>
              <div>
                <label class="ih-label">Default Channel</label>
                <input type="text" name="default_channel" class="ih-input" value="${esc(config?.default_channel || '')}" placeholder="#general">
              </div>
            </div>
            <div style="margin-bottom:12px">
              <label class="ih-label">Bot Token (optional, for Events API)</label>
              <input type="password" name="bot_token" class="ih-input" value="${esc(config?.bot_token || '')}" placeholder="xoxb-...">
            </div>
            <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px">
              <label class="ih-label" style="margin:0">Enabled</label>
              <label class="ih-toggle">
                <input type="checkbox" name="is_enabled" ${config?.is_enabled ? 'checked' : ''} value="true">
                <span></span>
              </label>
            </div>
            <div style="display:flex;gap:10px">
              <button type="submit" class="ih-btn ih-btn-primary">Save Configuration</button>
              <button type="button" class="ih-btn ih-btn-accent" onclick="testSlack()">Send Test</button>
              <a href="/settings/integrations" class="ih-btn ih-btn-ghost">Back</a>
            </div>
            <div id="slackTestResult" style="margin-top:12px"></div>
          </form>
        </div>

        <div class="ih-card" style="margin-top:16px">
          <h2>📋 Setup Guide</h2>
          <div class="ih-alert ih-alert-info" style="margin-bottom:12px">
            <strong>Webhook:</strong> Create an Incoming Webhook in your Slack app settings. Paste the URL above.<br>
            <strong>Events API:</strong> Point your Slack app's Event Subscription URL to the endpoint below.
          </div>
          <div style="margin-bottom:12px">
            <label class="ih-label">Events API URL</label>
            <div class="ih-code" style="font-size:12px;user-select:all">${esc(eventsUrl)}</div>
          </div>
          <p style="font-size:13px;color:${DS.textMuted}">
            <strong>Webhook:</strong> <code>${esc(maskedWebhook)}</code> &nbsp;
            <strong>Status:</strong> ${config?.is_enabled ? statusBadge('enabled') : statusBadge('disabled')}
          </p>
        </div>

        <div class="ih-card" style="margin-top:16px">
          <h2>💬 Message Log</h2>
          <div class="ih-scroll">
            <table class="ih-table">
              <thead><tr><th>Direction</th><th>Channel</th><th>Message</th><th>Status</th><th>Time</th></tr></thead>
              <tbody>${msgRows}</tbody>
            </table>
          </div>
        </div>
      </div>
      <script>
      async function testSlack(){
        const r=document.getElementById('slackTestResult');
        r.innerHTML='<div style="padding:8px;color:${DS.textMuted}">Sending test message to Slack...</div>';
        try{
          const resp=await fetch('/api/notify',{
            method:'POST',headers:{'Content-Type':'application/json'},
            body:JSON.stringify({channel:'slack',subject:'Test Notification',message:'Hello from Comfort Zone! This is a test message from the Integrations Hub.'})
          });
          const data=await resp.json();
          r.innerHTML=data.success?'<div class="ih-alert ih-alert-success">Test message sent successfully!</div>':'<div class="ih-alert ih-alert-danger">Failed: '+esc(data.error||JSON.stringify(data))+'</div>';
        }catch(e){r.innerHTML='<div class="ih-alert ih-alert-danger">Error: '+e.message+'</div>'}
      }
      </script>
    `;
    res.send(renderPage('Slack Integration', html, req.session?.user));
  }));

  // ──── POST /settings/integrations/slack/save — Save Slack Config ────
  app.post('/settings/integrations/slack/save', requireAuth, ah(async (req, res) => {
    try {
      const tenantId = schoolId(req);
      const { webhook_url, bot_token, default_channel, is_enabled } = req.body;
      const enabled = is_enabled === 'true' || is_enabled === 'on' || is_enabled === true;

      await pool.query(`
        INSERT INTO slack_config (tenant_id, webhook_url, bot_token, default_channel, is_enabled)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (tenant_id) DO UPDATE SET
          webhook_url = COALESCE(NULLIF($2, ''), webhook_url),
          bot_token = COALESCE(NULLIF($3, ''), bot_token),
          default_channel = COALESCE(NULLIF($4, ''), default_channel),
          is_enabled = $5
      `, [tenantId, webhook_url || null, bot_token || null, default_channel || null, enabled]);

      await audit(userEmail(req), 'slack_config_saved', { enabled, has_webhook: !!webhook_url }, tenantId, req);
      req.session.flash = { msg: 'Slack configuration saved successfully', type: 'success' };
      res.redirect('/settings/integrations/slack');
    } catch (e) {
      console.error('[Slack] Save error:', e.message);
      req.session.flash = { msg: 'Error saving configuration: ' + e.message, type: 'error' };
      res.redirect('/settings/integrations/slack');
    }
  }));


  // ═══════════════════════════════════════════════════════════════
  //  5. UNIFIED NOTIFICATION ROUTER
  // ═══════════════════════════════════════════════════════════════

  // ──── POST /api/notify — Send via any channel ────
  app.post('/api/notify', ah(async (req, res) => {
    try {
      const { tenant_id, channel, recipient, subject, message } = req.body;
      if (!channel || !message) {
        return res.status(400).json({ error: 'channel and message are required' });
      }

      const tid = tenant_id || (req.session?.user ? schoolId(req) : null);
      if (!tid) {
        return res.status(400).json({ error: 'tenant_id is required (or authenticate first)' });
      }

      let result = { channel, status: 'sent' };
      const logEntry = { tenant_id: tid, channel, recipient: recipient || 'all', subject: subject || '' };

      try {
        switch (channel) {
          case 'email': {
            const emailRecipient = recipient || req.session?.user?.email;
            if (!emailRecipient) {
              result.status = 'failed';
              result.error = 'No email recipient specified';
            } else if (sendEmail) {
              await sendEmail(emailRecipient, subject || 'Notification', message, tid);
              result.email = emailRecipient;
            } else if (queueEmail) {
              await queueEmail(emailRecipient, subject || 'Notification', message);
              result.email = emailRecipient;
              result.status = 'queued';
            } else {
              result.status = 'failed';
              result.error = 'Email service not configured';
            }
            break;
          }

          case 'push': {
            if (!webpush) {
              result.status = 'failed';
              result.error = 'web-push library not available';
              break;
            }
            const subs = (await pool.query('SELECT endpoint, keys_p256dh, keys_auth FROM push_subscriptions WHERE tenant_id=$1 AND is_active=true', [tid])).rows;
            if (subs.length === 0) {
              result.status = 'failed';
              result.error = 'No active push subscriptions';
            } else {
              let sent = 0;
              const payload = JSON.stringify({ title: subject || 'Comfort Zone', body: message });
              for (const sub of subs) {
                try {
                  await webpush.sendNotification(
                    { endpoint: sub.endpoint, keys: { p256dh: sub.keys_p256dh, auth: sub.keys_auth } },
                    payload,
                    { vapidDetails: { subject: 'mailto:admin@comfort.ug', publicKey: process.env.VAPID_PUBLIC_KEY, privateKey: process.env.VAPID_PRIVATE_KEY } }
                  );
                  sent++;
                } catch (e) {
                  if (e.statusCode === 404 || e.statusCode === 410) {
                    await pool.query('DELETE FROM push_subscriptions WHERE endpoint = $1', [sub.endpoint]).catch(() => {});
                  }
                }
              }
              result.sent = sent;
              result.total = subs.length;
            }
            break;
          }

          case 'telegram': {
            const tgConfig = (await pool.query('SELECT * FROM telegram_config WHERE tenant_id=$1 AND is_enabled=true', [tid])).rows[0];
            if (!tgConfig || !tgConfig.bot_token || !tgConfig.default_chat_id) {
              result.status = 'failed';
              result.error = 'Telegram not configured for this tenant';
            } else {
              const chatId = recipient || tgConfig.default_chat_id;
              const text = `📋 ${subject || 'Notification'}\n\n${message}`;
              try {
                await new Promise((resolve, reject) => {
                  const url = `https://api.telegram.org/bot${tgConfig.bot_token}/sendMessage`;
                  const body = JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' });
                  const u = new URL(url);
                  const options = { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } };
                  const r = https.request(options, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => { try { resolve(JSON.parse(d)); } catch { resolve(d); } }); });
                  r.on('error', reject);
                  r.write(body);
                  r.end();
                });
                result.chat_id = chatId;
                // Log outbound message
                await pool.query('INSERT INTO telegram_messages (tenant_id, chat_id, message_text, direction, status) VALUES ($1,$2,$3,$4,$5)', [tid, chatId, text, 'outbound', 'sent']).catch(() => {});
              } catch (e) {
                result.status = 'failed';
                result.error = e.message;
              }
            }
            break;
          }

          case 'slack': {
            const slConfig = (await pool.query('SELECT * FROM slack_config WHERE tenant_id=$1 AND is_enabled=true', [tid])).rows[0];
            if (!slConfig || !slConfig.webhook_url) {
              result.status = 'failed';
              result.error = 'Slack not configured for this tenant';
            } else {
              const channel = recipient || slConfig.default_channel || '#general';
              const slackPayload = JSON.stringify({ text: `*${subject || 'Notification'}*\n${message}`, channel });
              try {
                await new Promise((resolve, reject) => {
                  const u = new URL(slConfig.webhook_url);
                  const options = { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(slackPayload) } };
                  const r = https.request(options, resp => { let d = ''; resp.on('data', c => d += c); resp.on('end', () => resolve(d)); });
                  r.on('error', reject);
                  r.write(slackPayload);
                  r.end();
                });
                result.channel = channel;
                await pool.query('INSERT INTO slack_messages (tenant_id, channel, message_text, direction, status) VALUES ($1,$2,$3,$4,$5)', [tid, channel, message, 'outbound', 'sent']).catch(() => {});
              } catch (e) {
                result.status = 'failed';
                result.error = e.message;
              }
            }
            break;
          }

          case 'whatsapp': {
            // WhatsApp is handled by the existing whatsapp-receipts module
            result.status = 'delegated';
            result.info = 'WhatsApp notifications are handled by the WhatsApp module. Use /settings/whatsapp to configure.';
            break;
          }

          case 'sms': {
            result.status = 'delegated';
            result.info = 'SMS notifications are handled by the SMS module. Use /settings/sms to configure.';
            break;
          }

          default:
            result.status = 'failed';
            result.error = `Unknown channel: ${channel}. Supported: email, push, telegram, slack, whatsapp, sms`;
        }
      } catch (e) {
        result.status = 'failed';
        result.error = e.message;
      }

      // Log the notification
      logEntry.status = result.status;
      try {
        await pool.query(
          'INSERT INTO notification_router_log (tenant_id, channel, recipient, subject, status) VALUES ($1,$2,$3,$4,$5)',
          [tid, channel, recipient || 'all', subject || '', result.status]
        );
      } catch (e) { /* non-critical */ }

      if (logger) logger.info('Notification sent', { channel, status: result.status, tenant_id: tid });
      if (req.session?.user) {
        await audit(userEmail(req), 'notification_sent', { channel, status: result.status, recipient }, tid, req);
      }

      res.json({ success: result.status === 'sent' || result.status === 'queued' || result.status === 'delegated', ...result });
    } catch (e) {
      console.error('[Notify] Error:', e.message);
      res.status(500).json({ success: false, error: e.message });
    }
  }));


  // ═══════════════════════════════════════════════════════════════
  //  NOTIFICATION ROUTER LOG PAGE (bonus: /dev/notifications)
  // ═══════════════════════════════════════════════════════════════

  // ──── GET /dev/notifications — Notification Router Log (super admin) ────
  app.get('/dev/notifications', requireAuth, ah(async (req, res) => {
    if (req.session.user.role !== 'super_admin') return res.status(403).send('Super admin only');

    const logs = (await pool.query(
      'SELECT nrl.*, t.name AS tenant_name FROM notification_router_log nrl LEFT JOIN tenants t ON t.id = nrl.tenant_id ORDER BY nrl.created_at DESC LIMIT 100'
    )).rows;

    // Channel stats
    const stats = (await pool.query(
      "SELECT channel, status, COUNT(*)::int AS cnt FROM notification_router_log GROUP BY channel, status ORDER BY channel, status"
    )).rows;

    const channelStats = {};
    for (const s of stats) {
      if (!channelStats[s.channel]) channelStats[s.channel] = { sent: 0, failed: 0, queued: 0, delegated: 0 };
      channelStats[s.channel][s.status] = (channelStats[s.channel][s.status] || 0) + s.cnt;
    }

    const statsHtml = Object.entries(channelStats).map(([ch, counts]) => {
      const total = counts.sent + counts.failed + counts.queued + counts.delegated;
      const rate = total > 0 ? ((counts.sent / total) * 100).toFixed(0) : 0;
      return `<div style="background:${DS.bg};border-radius:10px;padding:14px">
        <div style="font-weight:700;color:${DS.text};margin-bottom:6px">${esc(ch)}</div>
        <div style="display:flex;gap:12px;font-size:13px">
          <span style="color:${DS.success}">✓ ${counts.sent}</span>
          <span style="color:${DS.danger}">✗ ${counts.failed}</span>
          <span style="color:${DS.warning}">⏳ ${counts.queued}</span>
          <span style="color:${DS.textMuted}">→ ${counts.delegated}</span>
        </div>
        <div style="margin-top:6px;font-size:12px;color:${DS.textMuted}">Success rate: ${rate}% (${total} total)</div>
      </div>`;
    }).join('');

    const logRows = logs.length === 0
      ? '<tr><td colspan="6" style="text-align:center;padding:24px;color:' + DS.textMuted + '">No notifications sent yet</td></tr>'
      : logs.map(l => `<tr>
        <td>${statusBadge(l.channel)}</td>
        <td>${statusBadge(l.status)}</td>
        <td style="font-size:12px">${esc(l.tenant_name || `#${l.tenant_id}`)}</td>
        <td style="font-size:12px;color:${DS.textMuted}">${esc(l.recipient || '—')}</td>
        <td>${esc(l.subject || '—')}</td>
        <td style="font-size:12px;color:${DS.textMuted}">${ago(l.created_at)}</td>
      </tr>`).join('');

    const html = `${baseCSS}
      <div style="max-width:1100px;margin:0 auto;padding:20px">
        <h1 style="color:${DS.text};margin:0 0 4px">📢 Notification Router Log</h1>
        <p style="color:${DS.textMuted};margin:0 0 20px">Unified notification delivery across all channels</p>

        <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(200px,1fr));gap:14px;margin-bottom:20px">
          ${statsHtml || '<div class="ih-card"><p style="color:' + DS.textMuted + '">No stats available yet</p></div>'}
        </div>

        <div class="ih-card">
          <h2>📜 Notification Log</h2>
          <div class="ih-scroll">
            <table class="ih-table">
              <thead><tr><th>Channel</th><th>Status</th><th>Tenant</th><th>Recipient</th><th>Subject</th><th>Time</th></tr></thead>
              <tbody>${logRows}</tbody>
            </table>
          </div>
        </div>
      </div>
    `;
    res.send(renderPage('Notification Router Log — Dev', html, req.session?.user));
  }));


  console.log('[IntegrationsHub] Module loaded — MCP, UptimeRobot, Push, Telegram, Slack, Notification Router');
};
