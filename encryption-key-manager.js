/**
 * Encryption Key Manager — Secure key lifecycle management
 * Generate, rotate, audit, and manage encryption keys across the platform.
 *
 * Usage:
 *   const encryptionKeyManager = require('./encryption-key-manager');
 *   encryptionKeyManager(app, pool, opts);
 *
 * opts: { esc, renderPage, ah, requireAuth, audit }
 */

'use strict';

const crypto = require('crypto');

module.exports = function (app, pool, opts) {
  const esc =
    opts.esc ||
    (s =>
      String(s || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;'));

  const renderPage = opts.renderPage || ((title, content, user) => content);
  const ah = opts.ah || ((fn) => fn);
  const audit = opts.audit || (() => {});

  const tenantId = (req) => req.session?.user?.tenant_id || req.session?.user?.school_id || 0;
  const currentUserId = (req) => req.session?.user?.id || 0;
  const currentEmail = (req) => req.session?.user?.email || 'system';
  const clientIp = (req) => req.ip || req.connection?.remoteAddress || '';

  // ---------------------------------------------------------------------------
  // Inline CSS — Dark Theme
  // ---------------------------------------------------------------------------
  const CSS = `
<link rel="stylesheet" href="/css/sk.css">
<style>
  :root {
    --bg-primary: #0f172a;
    --bg-card: #1e293b;
    --bg-card-hover: #263548;
    --bg-input: #1e293b;
    --border: #334155;
    --border-light: #475569;
    --text-primary: #f1f5f9;
    --text-secondary: #94a3b8;
    --text-muted: #64748b;
    --accent: #3b82f6;
    --accent-hover: #2563eb;
    --accent-light: rgba(59,130,246,0.15);
    --success: #22c55e;
    --success-bg: rgba(34,197,94,0.12);
    --danger: #ef4444;
    --danger-bg: rgba(239,68,68,0.12);
    --warning: #f59e0b;
    --warning-bg: rgba(245,158,11,0.12);
    --info: #06b6d4;
    --info-bg: rgba(6,182,212,0.12);
    --purple: #a855f7;
    --purple-bg: rgba(168,85,247,0.12);
  }
  *, *::before, *::after { box-sizing: border-box; }
  body { background: var(--bg-primary); color: var(--text-primary); }
  .ekm-container { max-width: 1200px; margin: 0 auto; padding: 24px 16px; }
  .ekm-page-title { font-size: 1.75rem; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
  .ekm-subtitle { color: var(--text-secondary); margin-bottom: 24px; font-size: .92rem; }
  .ekm-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; margin-bottom: 24px; }
  .ekm-card { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; padding: 20px; transition: border-color .2s, background .2s; }
  .ekm-card:hover { border-color: var(--accent); background: var(--bg-card-hover); }
  .ekm-card-label { font-size: .78rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; margin-bottom: 4px; }
  .ekm-card-value { font-size: 1.8rem; font-weight: 700; color: var(--text-primary); }
  .ekm-card-icon { font-size: 1.5rem; margin-bottom: 8px; }
  .ekm-table-wrap { background: var(--bg-card); border: 1px solid var(--border); border-radius: 12px; overflow: hidden; }
  .ekm-table { width: 100%; border-collapse: collapse; }
  .ekm-table th { background: rgba(59,130,246,0.08); padding: 10px 14px; text-align: left; font-size: .76rem; color: var(--text-muted); text-transform: uppercase; letter-spacing: .05em; border-bottom: 1px solid var(--border); white-space: nowrap; }
  .ekm-table td { padding: 10px 14px; border-bottom: 1px solid rgba(51,65,85,0.5); font-size: .86rem; color: var(--text-primary); vertical-align: middle; }
  .ekm-table tr:last-child td { border-bottom: none; }
  .ekm-table tr:hover { background: rgba(59,130,246,0.05); }
  .ekm-table-scroll { overflow-x: auto; max-height: 520px; overflow-y: auto; }
  .ekm-badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: .73rem; font-weight: 600; white-space: nowrap; }
  .ekm-badge-green { background: var(--success-bg); color: var(--success); border: 1px solid rgba(34,197,94,0.25); }
  .ekm-badge-red { background: var(--danger-bg); color: var(--danger); border: 1px solid rgba(239,68,68,0.25); }
  .ekm-badge-yellow { background: var(--warning-bg); color: var(--warning); border: 1px solid rgba(245,158,11,0.25); }
  .ekm-badge-blue { background: var(--accent-light); color: var(--accent); border: 1px solid rgba(59,130,246,0.25); }
  .ekm-badge-gray { background: rgba(100,116,139,0.15); color: var(--text-secondary); border: 1px solid rgba(100,116,139,0.25); }
  .ekm-badge-purple { background: var(--purple-bg); color: var(--purple); border: 1px solid rgba(168,85,247,0.25); }
  .ekm-btn { display: inline-flex; align-items: center; gap: 6px; padding: 8px 16px; border-radius: 8px; font-size: .84rem; font-weight: 600; border: 1px solid transparent; cursor: pointer; transition: all .15s; text-decoration: none; color: inherit; background: transparent; }
  .ekm-btn-primary { background: var(--accent); color: #fff; border-color: var(--accent); }
  .ekm-btn-primary:hover { background: var(--accent-hover); }
  .ekm-btn-danger { background: var(--danger); color: #fff; border-color: var(--danger); }
  .ekm-btn-danger:hover { background: #dc2626; }
  .ekm-btn-outline { border: 1px solid var(--border); color: var(--text-secondary); }
  .ekm-btn-outline:hover { border-color: var(--accent); color: var(--text-primary); background: var(--accent-light); }
  .ekm-btn-success { background: var(--success); color: #fff; border-color: var(--success); }
  .ekm-btn-success:hover { background: #16a34a; }
  .ekm-btn-warning { background: var(--warning); color: #fff; border-color: var(--warning); }
  .ekm-btn-sm { padding: 4px 10px; font-size: .76rem; border-radius: 6px; }
  .ekm-flex { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; margin-bottom: 20px; }
  .ekm-flex-between { display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 8px; }
  .ekm-input { padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: .86rem; outline: none; transition: border-color .15s, box-shadow .15s; background: var(--bg-input); color: var(--text-primary); }
  .ekm-input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px rgba(59,130,246,0.15); }
  .ekm-input::placeholder { color: var(--text-muted); }
  .ekm-select { padding: 8px 12px; border: 1px solid var(--border); border-radius: 8px; font-size: .86rem; background: var(--bg-input); color: var(--text-primary); cursor: pointer; outline: none; }
  .ekm-select option { background: var(--bg-card); }
  .ekm-section-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 16px; flex-wrap: wrap; gap: 8px; }
  .ekm-section-title { font-size: 1.1rem; font-weight: 700; color: var(--text-primary); margin-bottom: 12px; }
  .ekm-empty { text-align: center; padding: 40px; color: var(--text-muted); font-size: .92rem; }
  .ekm-alert { padding: 12px 16px; border-radius: 10px; font-size: .86rem; margin-bottom: 16px; display: flex; align-items: center; gap: 8px; }
  .ekm-alert-warning { background: var(--warning-bg); color: var(--warning); border: 1px solid rgba(245,158,11,0.3); }
  .ekm-alert-info { background: var(--accent-light); color: var(--accent); border: 1px solid rgba(59,130,246,0.3); }
  .ekm-alert-danger { background: var(--danger-bg); color: var(--danger); border: 1px solid rgba(239,68,68,0.3); }
  .ekm-alert-success { background: var(--success-bg); color: var(--success); border: 1px solid rgba(34,197,94,0.3); }
  .ekm-form-group { margin-bottom: 18px; }
  .ekm-form-label { display: block; font-size: .84rem; font-weight: 600; color: var(--text-primary); margin-bottom: 5px; }
  .ekm-form-hint { font-size: .76rem; color: var(--text-muted); margin-top: 3px; }
  .ekm-divider { height: 1px; background: var(--border); margin: 20px 0; }
  .ekm-chip { display: inline-flex; align-items: center; gap: 4px; background: rgba(100,116,139,0.12); border: 1px solid var(--border); padding: 3px 10px; border-radius: 999px; font-size: .74rem; color: var(--text-secondary); margin: 2px; }
  .ekm-hero { background: linear-gradient(135deg, #1d4ed8, #3b82f6); padding: 28px; border-radius: 16px; margin-bottom: 20px; color: white; }
  .ekm-hero h1 { font-size: 1.6rem; margin-bottom: 4px; }
  .ekm-hero p { opacity: 0.9; font-size: .92rem; }
  .ekm-hero-actions { margin-top: 14px; display: flex; gap: 8px; flex-wrap: wrap; }
  .ekm-bar-chart { display: flex; align-items: flex-end; gap: 6px; height: 180px; padding: 0 4px; }
  .ekm-bar-col { display: flex; flex-direction: column; align-items: center; flex: 1; min-width: 0; }
  .ekm-bar { width: 100%; max-width: 48px; background: var(--accent); border-radius: 6px 6px 0 0; min-height: 4px; transition: height .3s; }
  .ekm-bar-label { font-size: .68rem; color: var(--text-muted); margin-top: 6px; text-align: center; word-break: break-all; max-width: 60px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .ekm-bar-val { font-size: .72rem; font-weight: 700; color: var(--text-primary); margin-bottom: 4px; }
  .ekm-key-preview { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: .78rem; background: rgba(0,0,0,0.3); padding: 6px 10px; border-radius: 6px; color: var(--text-muted); max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; display: inline-block; }
  .ekm-modal-overlay { display: none; position: fixed; inset: 0; background: rgba(0,0,0,0.6); z-index: 1000; justify-content: center; align-items: center; }
  .ekm-modal-overlay.active { display: flex; }
  .ekm-modal { background: var(--bg-card); border: 1px solid var(--border); border-radius: 16px; padding: 28px; max-width: 500px; width: 90%; max-height: 90vh; overflow-y: auto; }
  .ekm-tabs { display: flex; gap: 0; border-bottom: 2px solid var(--border); margin-bottom: 20px; }
  .ekm-tab { padding: 10px 20px; font-size: .86rem; font-weight: 600; color: var(--text-muted); cursor: pointer; border-bottom: 2px solid transparent; margin-bottom: -2px; transition: all .15s; text-decoration: none; }
  .ekm-tab:hover { color: var(--accent); }
  .ekm-tab-active { color: var(--accent); border-bottom-color: var(--accent); }
  .ekm-progress-bar { height: 6px; background: rgba(59,130,246,0.15); border-radius: 999px; overflow: hidden; margin-top: 6px; }
  .ekm-progress-fill { height: 100%; border-radius: 999px; transition: width .3s; }
  code { font-family: 'SF Mono', Monaco, 'Cascadia Code', monospace; font-size: .82rem; background: rgba(0,0,0,0.3); padding: 2px 6px; border-radius: 4px; }
  @media (max-width: 768px) {
    .ekm-grid { grid-template-columns: 1fr 1fr; }
    .ekm-table th, .ekm-table td { padding: 8px 10px; font-size: .78rem; }
    .ekm-page-title { font-size: 1.4rem; }
    .ekm-hero h1 { font-size: 1.3rem; }
  }
  @media (max-width: 480px) {
    .ekm-grid { grid-template-columns: 1fr; }
    .ekm-flex-between { flex-direction: column; align-items: flex-start; }
  }
</style>`;

  // ---------------------------------------------------------------------------
  // Helper functions
  // ---------------------------------------------------------------------------
  function generateKey(length) {
    const bytes = Math.ceil((length || 256) / 8);
    return crypto.randomBytes(bytes).toString('hex');
  }

  function formatTs(dt) {
    if (!dt) return '—';
    return new Date(dt).toLocaleString();
  }

  function daysUntil(dt) {
    if (!dt) return null;
    const diff = Math.ceil((new Date(dt).getTime() - Date.now()) / 86400000);
    return diff;
  }

  function activeBadge(active) {
    return active
      ? '<span class="ekm-badge ekm-badge-green">● Active</span>'
      : '<span class="ekm-badge ekm-badge-red">● Inactive</span>';
  }

  function rotationBadge(key) {
    if (!key.rotation_enabled) return '<span class="ekm-badge ekm-badge-gray">Disabled</span>';
    const days = daysUntil(key.next_rotation_at);
    if (days === null) return '<span class="ekm-badge ekm-badge-blue">Scheduled</span>';
    if (days <= 0) return '<span class="ekm-badge ekm-badge-red">Overdue</span>';
    if (days <= 7) return '<span class="ekm-badge ekm-badge-yellow">' + days + 'd left</span>';
    return '<span class="ekm-badge ekm-badge-green">' + days + 'd left</span>';
  }

  function algorithmBadge(algo) {
    const a = (algo || '').toUpperCase();
    if (a.includes('AES-256')) return '<span class="ekm-badge ekm-badge-blue">' + esc(algo) + '</span>';
    if (a.includes('RSA')) return '<span class="ekm-badge ekm-badge-purple">' + esc(algo) + '</span>';
    return '<span class="ekm-badge ekm-badge-gray">' + esc(algo) + '</span>';
  }

  function keyPreview(val) {
    if (!val) return '<span class="ekm-key-preview">—</span>';
    const masked = val.substring(0, 8) + '••••••••••••' + val.substring(val.length - 4);
    return '<span class="ekm-key-preview" title="' + esc(val.substring(0, 16) + '...') + '">' + esc(masked) + '</span>';
  }

  function navBar(current) {
    const tabs = [
      ['dashboard', 'Dashboard', '/admin/encryption-keys'],
      ['data', 'Keys', '/admin/encryption-keys/data'],
      ['audit', 'Audit', '/admin/encryption-keys/audit'],
      ['export', 'Export', '/admin/encryption-keys/export'],
      ['settings', 'Settings', '/admin/encryption-keys/settings'],
    ];
    return '<div class="ekm-tabs">' +
      tabs.map(function (t) {
        return '<a href="' + t[2] + '" class="ekm-tab ' + (current === t[0] ? 'ekm-tab-active' : '') + '">' + t[1] + '</a>';
      }).join('') +
      '</div>';
  }

  function paginationHtml(page, totalPages, basePath) {
    const cp = parseInt(page, 10);
    const start = Math.max(1, cp - 3);
    const end = Math.min(totalPages, cp + 3);
    let links = '';
    if (start > 1) links += '<a href="' + basePath + '?page=1" class="ekm-btn ekm-btn-outline ekm-btn-sm">1</a>';
    if (start > 2) links += '<span class="ekm-badge ekm-badge-gray">…</span>';
    for (let i = start; i <= end; i++) {
      links += '<a href="' + basePath + '?page=' + i + '" class="ekm-btn ' + (i === cp ? 'ekm-btn-primary' : 'ekm-btn-outline') + ' ekm-btn-sm">' + i + '</a>';
    }
    if (end < totalPages - 1) links += '<span class="ekm-badge ekm-badge-gray">…</span>';
    if (end < totalPages) links += '<a href="' + basePath + '?page=' + totalPages + '" class="ekm-btn ekm-btn-outline ekm-btn-sm">' + totalPages + '</a>';
    return links;
  }

  async function logUsage(keyId, action, entityType, entityId, userId, ip, schoolId) {
    try {
      await pool.query(
        'INSERT INTO key_usage_log (key_id, action, entity_type, entity_id, user_id, ip_address, school_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [keyId, action, entityType || null, entityId || null, userId || null, ip || null, schoolId || 1]
      );
    } catch (e) {
      // silently log usage failures
    }
  }

  async function rotateKey(keyId, userId, ip, schoolId) {
    const keyRow = (await pool.query('SELECT * FROM encryption_keys WHERE id = $1', [keyId])).rows[0];
    if (!keyRow) return null;

    const newKeyValue = generateKey(keyRow.key_length || 256);
    const now = new Date();
    const nextRotation = new Date(now.getTime() + (keyRow.rotation_days || 90) * 86400000);

    const result = await pool.query(
      'UPDATE encryption_keys SET key_value = $1, last_rotated_at = $2, next_rotation_at = $3, rotation_count = rotation_count + 1 WHERE id = $4 RETURNING *',
      [newKeyValue, now, nextRotation, keyId]
    );

    await logUsage(keyId, 'rotate', 'encryption_key', keyId, userId, ip, schoolId);
    return result.rows[0];
  }

  // ---------------------------------------------------------------------------
  // Table creation (async IIFE)
  // ---------------------------------------------------------------------------
  (async () => {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS encryption_keys (
        id SERIAL PRIMARY KEY,
        key_name TEXT NOT NULL,
        key_type TEXT DEFAULT 'aes-256',
        key_value TEXT NOT NULL,
        purpose TEXT,
        algorithm TEXT DEFAULT 'AES-256-CBC',
        key_length INT DEFAULT 256,
        is_active BOOLEAN DEFAULT true,
        rotation_enabled BOOLEAN DEFAULT true,
        rotation_days INT DEFAULT 90,
        last_rotated_at TIMESTAMPTZ,
        next_rotation_at TIMESTAMPTZ,
        rotation_count INT DEFAULT 0,
        created_by INT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        expires_at TIMESTAMPTZ,
        school_id INT DEFAULT 1
      )`);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS key_usage_log (
        id SERIAL PRIMARY KEY,
        key_id INT REFERENCES encryption_keys(id),
        action TEXT,
        entity_type TEXT,
        entity_id INT,
        user_id INT,
        ip_address TEXT,
        created_at TIMESTAMPTZ DEFAULT NOW(),
        school_id INT DEFAULT 1
      )`);
    await pool.query('CREATE INDEX IF NOT EXISTS idx_ek_school ON encryption_keys(school_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_ek_active ON encryption_keys(school_id, is_active)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_ek_next_rotation ON encryption_keys(next_rotation_at) WHERE is_active = true AND rotation_enabled = true');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_kul_key ON key_usage_log(key_id)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_kul_school ON key_usage_log(school_id, created_at DESC)');
    await pool.query('CREATE INDEX IF NOT EXISTS idx_kul_action ON key_usage_log(action)');
  })().catch(function (err) { console.error('[encryption-key-manager] Table creation error:', err); });

  // ===========================================================================
  // ROUTES
  // ===========================================================================

  // ---------- 1. GET / — Dashboard ----------
  app.get('/admin/encryption-keys', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const [totalKeys, activeKeys, rotatedThisMonth, overdueKeys, recentUsage, upcomingRotations] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM encryption_keys WHERE school_id = $1', [sid]),
      pool.query('SELECT COUNT(*)::int AS n FROM encryption_keys WHERE school_id = $1 AND is_active = true', [sid]),
      pool.query("SELECT COUNT(*)::int AS n FROM encryption_keys WHERE school_id = $1 AND last_rotated_at > NOW() - INTERVAL '30 days'", [sid]),
      pool.query("SELECT COUNT(*)::int AS n FROM encryption_keys WHERE school_id = $1 AND is_active = true AND rotation_enabled = true AND next_rotation_at < NOW()", [sid]),
      pool.query('SELECT ekl.*, ek.key_name FROM key_usage_log ekl LEFT JOIN encryption_keys ek ON ekl.key_id = ek.id WHERE ekl.school_id = $1 ORDER BY ekl.created_at DESC LIMIT 8', [sid]),
      pool.query('SELECT id, key_name, next_rotation_at, rotation_days FROM encryption_keys WHERE school_id = $1 AND is_active = true AND rotation_enabled = true AND next_rotation_at IS NOT NULL ORDER BY next_rotation_at ASC LIMIT 6', [sid]),
    ]);

    const stats = {
      total: totalKeys.rows[0].n,
      active: activeKeys.rows[0].n,
      rotated: rotatedThisMonth.rows[0].n,
      overdue: overdueKeys.rows[0].n,
    };
    const recentLog = recentUsage.rows;
    const upcoming = upcomingRotations.rows;

    const recentHtml = recentLog.length > 0
      ? recentLog.map(function (r) {
          return '<tr><td>' + esc(r.key_name || 'Deleted Key #' + r.key_id) + '</td>' +
            '<td><span class="ekm-badge ekm-badge-' + (r.action === 'rotate' ? 'blue' : r.action === 'deactivate' ? 'red' : 'green') + '">' + esc(r.action) + '</span></td>' +
            '<td>' + esc(r.entity_type || '—') + '</td>' +
            '<td><code>' + esc(r.ip_address || '—') + '</code></td>' +
            '<td>' + formatTs(r.created_at) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="5" class="ekm-empty">No recent key activity</td></tr>';

    const upcomingHtml = upcoming.length > 0
      ? upcoming.map(function (u) {
          const days = daysUntil(u.next_rotation_at);
          const badge = days <= 0 ? 'ekm-badge-red' : days <= 7 ? 'ekm-badge-yellow' : 'ekm-badge-blue';
          return '<div class="ekm-card" style="padding:14px">' +
            '<div style="font-weight:600;margin-bottom:6px">' + esc(u.key_name) + '</div>' +
            '<span class="ekm-badge ' + badge + '">' + (days <= 0 ? 'Overdue' : days + ' days') + '</span>' +
            '<div style="font-size:.74rem;color:var(--text-muted);margin-top:4px">' + formatTs(u.next_rotation_at) + '</div></div>';
        }).join('')
      : '<div class="ekm-empty" style="grid-column:1/-1">No upcoming rotations</div>';

    const body = CSS + '<div class="ekm-container">' +
      '<div class="ekm-hero">' +
        '<h1>🔐 Encryption Key Manager</h1>' +
        '<p>Secure key lifecycle management — generate, rotate, and audit encryption keys</p>' +
        '<div class="ekm-hero-actions">' +
          '<a href="/admin/encryption-keys/data" class="ekm-btn" style="background:rgba(255,255,255,0.15);color:white;border-color:rgba(255,255,255,0.3)">📋 View All Keys</a>' +
          '<a href="/admin/encryption-keys/settings" class="ekm-btn" style="background:rgba(255,255,255,0.15);color:white;border-color:rgba(255,255,255,0.3)">⚙️ Settings</a>' +
        '</div>' +
      '</div>' +
      navBar('dashboard') +
      '<div class="ekm-grid">' +
        '<div class="ekm-card"><div class="ekm-card-icon">🔑</div><div class="ekm-card-label">Total Keys</div><div class="ekm-card-value">' + stats.total + '</div></div>' +
        '<div class="ekm-card"><div class="ekm-card-icon">✅</div><div class="ekm-card-label">Active Keys</div><div class="ekm-card-value" style="color:var(--success)">' + stats.active + '</div></div>' +
        '<div class="ekm-card"><div class="ekm-card-icon">🔄</div><div class="ekm-card-label">Rotated (30d)</div><div class="ekm-card-value" style="color:var(--accent)">' + stats.rotated + '</div></div>' +
        '<div class="ekm-card"><div class="ekm-card-icon">⚠️</div><div class="ekm-card-label">Overdue</div><div class="ekm-card-value" style="color:' + (stats.overdue > 0 ? 'var(--danger)' : 'var(--success)') + '">' + stats.overdue + '</div></div>' +
      '</div>' +
      (stats.overdue > 0 ? '<div class="ekm-alert ekm-alert-danger">⚠️ ' + stats.overdue + ' key(s) are overdue for rotation. <a href="/admin/encryption-keys/data" style="font-weight:700;color:var(--danger)">Review now →</a></div>' : '') +
      '<div class="ekm-grid" style="grid-template-columns: 1fr 1fr; gap: 20px">' +
        '<div>' +
          '<div class="ekm-section-title">Upcoming Rotations</div>' +
          '<div class="ekm-grid" style="grid-template-columns: repeat(auto-fill, minmax(180px, 1fr))">' + upcomingHtml + '</div>' +
        '</div>' +
        '<div>' +
          '<div class="ekm-section-title">Recent Activity</div>' +
          '<div class="ekm-table-wrap"><table class="ekm-table"><thead><tr><th>Key</th><th>Action</th><th>Entity</th><th>IP</th><th>Time</th></tr></thead><tbody>' + recentHtml + '</tbody></table></div>' +
        '</div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Encryption Key Manager', body, req.session?.user));
  }));

  // ---------- 2. GET /data — JSON keys list (also HTML view) ----------
  app.get('/admin/encryption-keys/data', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const format = req.query.format;
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;
    const search = (req.query.search || '').trim();

    let where = 'WHERE school_id = $1';
    const params = [sid];
    let pi = 2;
    if (search) {
      where += ' AND (key_name ILIKE $' + pi + ' OR purpose ILIKE $' + pi + ' OR algorithm ILIKE $' + pi + ')';
      params.push('%' + search + '%');
      pi++;
    }

    const [countR, keysR] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM encryption_keys ' + where, params),
      pool.query('SELECT * FROM encryption_keys ' + where + ' ORDER BY created_at DESC LIMIT ' + limit + ' OFFSET ' + offset, params),
    ]);

    const total = countR.rows[0].n;
    const totalPages = Math.ceil(total / limit) || 1;
    const keys = keysR.rows;

    // JSON format
    if (format === 'json') {
      return res.json({
        success: true,
        data: keys.map(function (k) {
          return {
            id: k.id, key_name: k.key_name, key_type: k.key_type, purpose: k.purpose,
            algorithm: k.algorithm, key_length: k.key_length, is_active: k.is_active,
            rotation_enabled: k.rotation_enabled, rotation_days: k.rotation_days,
            last_rotated_at: k.last_rotated_at, next_rotation_at: k.next_rotation_at,
            rotation_count: k.rotation_count, created_at: k.created_at, expires_at: k.expires_at,
          };
        }),
        pagination: { page: page, per_page: limit, total: total, total_pages: totalPages },
      });
    }

    const rowsHtml = keys.length > 0
      ? keys.map(function (k) {
          return '<tr>' +
            '<td style="font-weight:600">' + esc(k.key_name) + '</td>' +
            '<td>' + algorithmBadge(k.algorithm) + '</td>' +
            '<td>' + (k.purpose ? '<span class="ekm-chip">' + esc(k.purpose) + '</span>' : '—') + '</td>' +
            '<td>' + k.key_length + ' bit</td>' +
            '<td>' + activeBadge(k.is_active) + '</td>' +
            '<td>' + rotationBadge(k) + '</td>' +
            '<td>' + (k.rotation_count || 0) + '</td>' +
            '<td>' + formatTs(k.created_at) + '</td>' +
            '<td style="white-space:nowrap">' +
              '<a href="/admin/encryption-keys/' + k.id + '/usage" class="ekm-btn ekm-btn-outline ekm-btn-sm" title="Usage Log">📊</a> ' +
              (k.is_active ? '<form method="POST" action="/admin/encryption-keys/' + k.id + '/rotate" style="display:inline" onsubmit="return confirm(\'Rotate ' + esc(k.key_name) + '?\')"><button class="ekm-btn ekm-btn-warning ekm-btn-sm" title="Rotate">🔄</button></form> ' +
              '<form method="POST" action="/admin/encryption-keys/' + k.id + '/deactivate" style="display:inline" onsubmit="return confirm(\'Deactivate ' + esc(k.key_name) + '?\')"><button class="ekm-btn ekm-btn-danger ekm-btn-sm" title="Deactivate">🔒</button></form> ' : '') +
              '<form method="POST" action="/admin/encryption-keys/' + k.id + '/delete" style="display:inline" onsubmit="return confirm(\'Permanently delete ' + esc(k.key_name) + '? This cannot be undone.\')"><button class="ekm-btn ekm-btn-danger ekm-btn-sm" title="Delete">🗑️</button></form>' +
            '</td></tr>';
        }).join('')
      : '<tr><td colspan="9" class="ekm-empty">No encryption keys found</td></tr>';

    const body = CSS + '<div class="ekm-container">' +
      navBar('data') +
      '<div class="ekm-flex-between">' +
        '<div><h1 class="ekm-page-title">📋 Key Inventory</h1><p class="ekm-subtitle">' + total + ' key' + (total !== 1 ? 's' : '') + ' managed</p></div>' +
        '<div class="ekm-flex" style="margin-bottom:0">' +
          '<a href="/admin/encryption-keys/data?format=json" class="ekm-btn ekm-btn-outline">📥 JSON</a> ' +
          '<a href="/admin/encryption-keys/export" class="ekm-btn ekm-btn-outline">📤 Export</a> ' +
          '<form method="POST" action="/admin/encryption-keys/bulk-rotate" onsubmit="return confirm(\'Rotate all eligible keys?\')"><button class="ekm-btn ekm-btn-warning">🔄 Bulk Rotate</button></form>' +
        '</div>' +
      '</div>' +
      '<form method="GET" class="ekm-flex" style="margin-bottom:16px">' +
        '<input type="text" name="search" class="ekm-input" value="' + esc(search) + '" placeholder="Search keys..." style="flex:1;max-width:320px">' +
        '<button type="submit" class="ekm-btn ekm-btn-primary ekm-btn-sm">Search</button>' +
        (search ? '<a href="/admin/encryption-keys/data" class="ekm-btn ekm-btn-outline ekm-btn-sm">Clear</a>' : '') +
      '</form>' +
      '<div class="ekm-table-wrap"><div class="ekm-table-scroll"><table class="ekm-table">' +
        '<thead><tr><th>Name</th><th>Algorithm</th><th>Purpose</th><th>Length</th><th>Status</th><th>Rotation</th><th>Rotated</th><th>Created</th><th>Actions</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table></div></div>' +
      (totalPages > 1 ? '<div class="ekm-flex" style="margin-top:16px">' + paginationHtml(page, totalPages, '/admin/encryption-keys/data') + '</div>' : '') +
    '</div>';
    res.send(renderPage('Encryption Keys', body, req.session?.user));
  }));

  // ---------- 3. POST /create — Generate new key ----------
  app.post('/admin/encryption-keys/create', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const uid = currentUserId(req);
    const ip = clientIp(req);
    const { key_name, key_type, purpose, algorithm, key_length, rotation_enabled, rotation_days, expires_at } = req.body;

    if (!key_name || !key_name.trim()) {
      req.session.ekm_flash = { type: 'danger', msg: 'Key name is required.' };
      return res.redirect('/admin/encryption-keys/data');
    }

    const keyValue = generateKey(parseInt(key_length) || 256);
    const now = new Date();
    const rotEnabled = rotation_enabled !== 'false' && rotation_enabled !== false;
    const rotDays = parseInt(rotation_days) || 90;
    const nextRotation = rotEnabled ? new Date(now.getTime() + rotDays * 86400000) : null;
    const expAt = expires_at ? new Date(expires_at) : null;

    const result = await pool.query(
      'INSERT INTO encryption_keys (key_name, key_type, key_value, purpose, algorithm, key_length, is_active, rotation_enabled, rotation_days, next_rotation_at, created_by, expires_at, school_id) VALUES ($1,$2,$3,$4,$5,$6,true,$7,$8,$9,$10,$11,$12) RETURNING *',
      [key_name.trim(), key_type || 'aes-256', keyValue, purpose || null, algorithm || 'AES-256-CBC', parseInt(key_length) || 256, rotEnabled, rotDays, nextRotation, uid, expAt, sid]
    );

    const newKey = result.rows[0];
    await logUsage(newKey.id, 'create', 'encryption_key', newKey.id, uid, ip, sid);
    audit(req, 'key_create', 'Created encryption key: ' + key_name.trim());

    req.session.ekm_flash = { type: 'success', msg: 'Key "' + key_name.trim() + '" created successfully. Rotation in ' + rotDays + ' days.' };
    res.redirect('/admin/encryption-keys/data');
  }));

  // ---------- 4. PUT /:id — Update key metadata ----------
  app.put('/admin/encryption-keys/:id', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const uid = currentUserId(req);
    const keyId = parseInt(req.params.id, 10);
    const { key_name, purpose, rotation_enabled, rotation_days, expires_at } = req.body;

    const keyRow = (await pool.query('SELECT * FROM encryption_keys WHERE id = $1 AND school_id = $2', [keyId, sid])).rows[0];
    if (!keyRow) {
      return res.status(404).json({ success: false, error: 'Key not found.' });
    }

    const rotEnabled = rotation_enabled !== 'false' && rotation_enabled !== false;
    const rotDays = parseInt(rotation_days) || keyRow.rotation_days || 90;
    const nextRotation = rotEnabled ? new Date(Date.now() + rotDays * 86400000) : null;
    const expAt = expires_at || null;

    await pool.query(
      'UPDATE encryption_keys SET key_name = $1, purpose = $2, rotation_enabled = $3, rotation_days = $4, next_rotation_at = $5, expires_at = $6 WHERE id = $7 AND school_id = $8',
      [key_name || keyRow.key_name, purpose !== undefined ? purpose : keyRow.purpose, rotEnabled, rotDays, nextRotation, expAt, keyId, sid]
    );

    await logUsage(keyId, 'update', 'encryption_key', keyId, uid, clientIp(req), sid);
    audit(req, 'key_update', 'Updated encryption key: ' + (key_name || keyRow.key_name));

    res.json({ success: true, message: 'Key updated.' });
  }));

  // ---------- 5. DELETE /:id — Delete key ----------
  app.post('/admin/encryption-keys/:id/delete', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const keyId = parseInt(req.params.id, 10);
    const keyRow = (await pool.query('SELECT * FROM encryption_keys WHERE id = $1 AND school_id = $2', [keyId, sid])).rows[0];
    if (!keyRow) {
      req.session.ekm_flash = { type: 'danger', msg: 'Key not found.' };
      return res.redirect('/admin/encryption-keys/data');
    }

    await pool.query('DELETE FROM key_usage_log WHERE key_id = $1', [keyId]);
    await pool.query('DELETE FROM encryption_keys WHERE id = $1 AND school_id = $2', [keyId, sid]);
    await logUsage(keyId, 'delete', 'encryption_key', keyId, currentUserId(req), clientIp(req), sid);
    audit(req, 'key_delete', 'Deleted encryption key: ' + keyRow.key_name);

    req.session.ekm_flash = { type: 'success', msg: 'Key "' + keyRow.key_name + '" deleted permanently.' };
    res.redirect('/admin/encryption-keys/data');
  }));

  // ---------- 6. POST /:id/rotate — Manual key rotation ----------
  app.post('/admin/encryption-keys/:id/rotate', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const keyId = parseInt(req.params.id, 10);
    const keyRow = (await pool.query('SELECT * FROM encryption_keys WHERE id = $1 AND school_id = $2', [keyId, sid])).rows[0];
    if (!keyRow) {
      req.session.ekm_flash = { type: 'danger', msg: 'Key not found.' };
      return res.redirect('/admin/encryption-keys/data');
    }
    if (!keyRow.is_active) {
      req.session.ekm_flash = { type: 'warning', msg: 'Cannot rotate an inactive key.' };
      return res.redirect('/admin/encryption-keys/data');
    }

    const newKey = await rotateKey(keyId, currentUserId(req), clientIp(req), sid);
    audit(req, 'key_rotate', 'Rotated encryption key: ' + keyRow.key_name);

    req.session.ekm_flash = { type: 'success', msg: 'Key "' + keyRow.key_name + '" rotated successfully. Next rotation in ' + (keyRow.rotation_days || 90) + ' days.' };
    res.redirect('/admin/encryption-keys/data');
  }));

  // ---------- 7. POST /:id/deactivate — Deactivate key ----------
  app.post('/admin/encryption-keys/:id/deactivate', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const keyId = parseInt(req.params.id, 10);
    const keyRow = (await pool.query('SELECT * FROM encryption_keys WHERE id = $1 AND school_id = $2', [keyId, sid])).rows[0];
    if (!keyRow) {
      req.session.ekm_flash = { type: 'danger', msg: 'Key not found.' };
      return res.redirect('/admin/encryption-keys/data');
    }

    await pool.query('UPDATE encryption_keys SET is_active = false WHERE id = $1 AND school_id = $2', [keyId, sid]);
    await logUsage(keyId, 'deactivate', 'encryption_key', keyId, currentUserId(req), clientIp(req), sid);
    audit(req, 'key_deactivate', 'Deactivated encryption key: ' + keyRow.key_name);

    req.session.ekm_flash = { type: 'warning', msg: 'Key "' + keyRow.key_name + '" has been deactivated.' };
    res.redirect('/admin/encryption-keys/data');
  }));

  // ---------- 8. GET /:id/usage — Key usage log ----------
  app.get('/admin/encryption-keys/:id/usage', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const keyId = parseInt(req.params.id, 10);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 25;
    const offset = (page - 1) * limit;

    const [keyRow, countR, logR] = await Promise.all([
      pool.query('SELECT * FROM encryption_keys WHERE id = $1 AND school_id = $2', [keyId, sid]),
      pool.query('SELECT COUNT(*)::int AS n FROM key_usage_log WHERE key_id = $1', [keyId]),
      pool.query('SELECT * FROM key_usage_log WHERE key_id = $1 ORDER BY created_at DESC LIMIT ' + limit + ' OFFSET ' + offset, [keyId]),
    ]);

    const key = keyRow.rows[0];
    if (!key) {
      return res.send(renderPage('Key Not Found', '<div class="ekm-container"><div class="ekm-alert ekm-alert-danger">Key not found.</div><a href="/admin/encryption-keys/data" class="ekm-btn ekm-btn-outline">← Back</a></div>', req.session?.user));
    }

    const total = countR.rows[0].n;
    const totalPages = Math.ceil(total / limit) || 1;
    const logs = logR.rows;

    const actionColors = { create: 'green', rotate: 'blue', deactivate: 'red', delete: 'red', update: 'yellow', encrypt: 'blue', decrypt: 'blue' };

    const logRows = logs.length > 0
      ? logs.map(function (l) {
          const color = actionColors[l.action] || 'gray';
          return '<tr>' +
            '<td><span class="ekm-badge ekm-badge-' + color + '">' + esc(l.action) + '</span></td>' +
            '<td>' + (l.entity_type ? esc(l.entity_type) + (l.entity_id ? ' #' + l.entity_id : '') : '—') + '</td>' +
            '<td>' + (l.user_id || '—') + '</td>' +
            '<td><code>' + esc(l.ip_address || '—') + '</code></td>' +
            '<td>' + formatTs(l.created_at) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="5" class="ekm-empty">No usage history for this key</td></tr>';

    const body = CSS + '<div class="ekm-container">' +
      '<a href="/admin/encryption-keys/data" class="ekm-btn ekm-btn-outline" style="margin-bottom:16px">← Back to Keys</a>' +
      '<div class="ekm-flex-between">' +
        '<div><h1 class="ekm-page-title">📊 Usage Log</h1><p class="ekm-subtitle">' + esc(key.key_name) + ' — ' + total + ' operation' + (total !== 1 ? 's' : '') + ' recorded</p></div>' +
        '<div>' + activeBadge(key.is_active) + ' ' + algorithmBadge(key.algorithm) + '</div>' +
      '</div>' +
      '<div class="ekm-grid" style="grid-template-columns:repeat(auto-fill,minmax(180px,1fr));margin-bottom:20px">' +
        '<div class="ekm-card"><div class="ekm-card-label">Key ID</div><div class="ekm-card-value" style="font-size:1.2rem">' + key.id + '</div></div>' +
        '<div class="ekm-card"><div class="ekm-card-label">Rotations</div><div class="ekm-card-value" style="font-size:1.2rem;color:var(--accent)">' + (key.rotation_count || 0) + '</div></div>' +
        '<div class="ekm-card"><div class="ekm-card-label">Last Rotated</div><div style="font-size:.86rem;color:var(--text-secondary)">' + formatTs(key.last_rotated_at) + '</div></div>' +
        '<div class="ekm-card"><div class="ekm-card-label">Next Rotation</div><div>' + rotationBadge(key) + '</div><div style="font-size:.74rem;color:var(--text-muted);margin-top:4px">' + formatTs(key.next_rotation_at) + '</div></div>' +
      '</div>' +
      '<div class="ekm-table-wrap"><div class="ekm-table-scroll"><table class="ekm-table">' +
        '<thead><tr><th>Action</th><th>Entity</th><th>User ID</th><th>IP Address</th><th>Timestamp</th></tr></thead>' +
        '<tbody>' + logRows + '</tbody>' +
      '</table></div></div>' +
      (totalPages > 1 ? '<div class="ekm-flex" style="margin-top:16px">' + paginationHtml(page, totalPages, '/admin/encryption-keys/' + keyId + '/usage') + '</div>' : '') +
    '</div>';
    res.send(renderPage('Key Usage', body, req.session?.user));
  }));

  // ---------- 9. GET /audit — All key operations audit ----------
  app.get('/admin/encryption-keys/audit', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const page = Math.max(1, parseInt(req.query.page) || 1);
    const limit = 30;
    const offset = (page - 1) * limit;
    const { action, date_from, date_to } = req.query;

    let where = 'WHERE ekl.school_id = $1';
    const params = [sid];
    let pi = 2;
    if (action) { where += ' AND ekl.action = $' + pi++; params.push(action); }
    if (date_from) { where += ' AND ekl.created_at >= $' + pi++; params.push(date_from); }
    if (date_to) { where += ' AND ekl.created_at <= $' + pi++; params.push(date_to + ' 23:59:59'); }

    const [countR, logR, actionCounts] = await Promise.all([
      pool.query('SELECT COUNT(*)::int AS n FROM key_usage_log ekl ' + where, params),
      pool.query('SELECT ekl.*, ek.key_name FROM key_usage_log ekl LEFT JOIN encryption_keys ek ON ekl.key_id = ek.id ' + where + ' ORDER BY ekl.created_at DESC LIMIT ' + limit + ' OFFSET ' + offset, params),
      pool.query("SELECT action, COUNT(*)::int AS cnt FROM key_usage_log WHERE school_id = $1 AND created_at > NOW() - INTERVAL '30 days' GROUP BY action ORDER BY cnt DESC", [sid]),
    ]);

    const total = countR.rows[0].n;
    const totalPages = Math.ceil(total / limit) || 1;
    const logs = logR.rows;
    const actions = actionCounts.rows;

    const actionColors = { create: 'green', rotate: 'blue', deactivate: 'red', delete: 'red', update: 'yellow', encrypt: 'blue', decrypt: 'blue' };

    const logRows = logs.length > 0
      ? logs.map(function (l) {
          const color = actionColors[l.action] || 'gray';
          return '<tr>' +
            '<td>' + formatTs(l.created_at) + '</td>' +
            '<td style="font-weight:600">' + esc(l.key_name || 'Deleted Key #' + l.key_id) + '</td>' +
            '<td><span class="ekm-badge ekm-badge-' + color + '">' + esc(l.action) + '</span></td>' +
            '<td>' + (l.entity_type ? esc(l.entity_type) + (l.entity_id ? ' #' + l.entity_id : '') : '—') + '</td>' +
            '<td>' + (l.user_id || '—') + '</td>' +
            '<td><code>' + esc(l.ip_address || '—') + '</code></td></tr>';
        }).join('')
      : '<tr><td colspan="6" class="ekm-empty">No audit entries found</td></tr>';

    const maxActionCnt = Math.max.apply(null, actions.map(function (a) { return a.cnt; }).concat([1]));

    const body = CSS + '<div class="ekm-container">' +
      navBar('audit') +
      '<div class="ekm-flex-between">' +
        '<div><h1 class="ekm-page-title">📜 Audit Trail</h1><p class="ekm-subtitle">' + total + ' operations logged</p></div>' +
      '</div>' +
      '<div class="ekm-grid" style="margin-bottom:20px">' +
        actions.map(function (a) {
          var color = actionColors[a.action] || 'gray';
          return '<div class="ekm-card" style="padding:14px">' +
            '<div style="font-weight:600;margin-bottom:6px"><span class="ekm-badge ekm-badge-' + color + '">' + esc(a.action) + '</span></div>' +
            '<div class="ekm-card-value" style="font-size:1.4rem">' + a.cnt + '</div>' +
            '<div class="ekm-progress-bar"><div class="ekm-progress-fill" style="width:' + Math.round(a.cnt / maxActionCnt * 100) + '%;background:var(--' + (color === 'green' ? 'success' : color === 'blue' ? 'accent' : color === 'red' ? 'danger' : color === 'yellow' ? 'warning' : 'text-secondary') + ')"></div></div>' +
          '</div>';
        }).join('') +
      '</div>' +
      '<form method="GET" class="ekm-flex" style="margin-bottom:16px">' +
        '<select name="action" class="ekm-select"><option value="">All Actions</option>' +
          '<option value="create"' + (action === 'create' ? ' selected' : '') + '>Create</option>' +
          '<option value="rotate"' + (action === 'rotate' ? ' selected' : '') + '>Rotate</option>' +
          '<option value="deactivate"' + (action === 'deactivate' ? ' selected' : '') + '>Deactivate</option>' +
          '<option value="delete"' + (action === 'delete' ? ' selected' : '') + '>Delete</option>' +
          '<option value="update"' + (action === 'update' ? ' selected' : '') + '>Update</option>' +
        '</select>' +
        '<input type="date" name="date_from" class="ekm-input" value="' + esc(date_from || '') + '">' +
        '<input type="date" name="date_to" class="ekm-input" value="' + esc(date_to || '') + '">' +
        '<button type="submit" class="ekm-btn ekm-btn-primary ekm-btn-sm">Filter</button>' +
        ((action || date_from || date_to) ? '<a href="/admin/encryption-keys/audit" class="ekm-btn ekm-btn-outline ekm-btn-sm">Reset</a>' : '') +
      '</form>' +
      '<div class="ekm-table-wrap"><div class="ekm-table-scroll"><table class="ekm-table">' +
        '<thead><tr><th>Timestamp</th><th>Key</th><th>Action</th><th>Entity</th><th>User</th><th>IP</th></tr></thead>' +
        '<tbody>' + logRows + '</tbody>' +
      '</table></div></div>' +
      (totalPages > 1 ? '<div class="ekm-flex" style="margin-top:16px">' + paginationHtml(page, totalPages, '/admin/encryption-keys/audit') + '</div>' : '') +
    '</div>';
    res.send(renderPage('Key Audit Log', body, req.session?.user));
  }));

  // ---------- 10. POST /bulk-rotate — Rotate multiple keys ----------
  app.post('/admin/encryption-keys/bulk-rotate', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const uid = currentUserId(req);
    const ip = clientIp(req);

    const eligibleKeys = (await pool.query(
      "SELECT id, key_name FROM encryption_keys WHERE school_id = $1 AND is_active = true AND rotation_enabled = true AND (next_rotation_at IS NULL OR next_rotation_at <= NOW() + INTERVAL '7 days')",
      [sid]
    )).rows;

    let rotated = 0;
    for (var i = 0; i < eligibleKeys.length; i++) {
      try {
        await rotateKey(eligibleKeys[i].id, uid, ip, sid);
        rotated++;
      } catch (e) {
        // continue rotating other keys
      }
    }

    audit(req, 'key_bulk_rotate', 'Bulk rotated ' + rotated + ' key(s)');
    req.session.ekm_flash = { type: 'success', msg: rotated + ' key(s) rotated successfully.' + (eligibleKeys.length - rotated > 0 ? ' ' + (eligibleKeys.length - rotated) + ' failed.' : '') };
    res.redirect('/admin/encryption-keys/data');
  }));

  // ---------- 11. GET /export — Export key metadata (not values) ----------
  app.get('/admin/encryption-keys/export', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const format = req.query.format || 'html';

    const { rows } = await pool.query(
      'SELECT id, key_name, key_type, purpose, algorithm, key_length, is_active, rotation_enabled, rotation_days, last_rotated_at, next_rotation_at, rotation_count, created_by, created_at, expires_at, school_id FROM encryption_keys WHERE school_id = $1 ORDER BY key_name',
      [sid]
    );

    // CSV export
    if (format === 'csv') {
      const headers = ['ID', 'Key Name', 'Key Type', 'Purpose', 'Algorithm', 'Key Length', 'Active', 'Rotation Enabled', 'Rotation Days', 'Last Rotated', 'Next Rotation', 'Rotation Count', 'Created By', 'Created At', 'Expires At'];
      const csvRows = [headers.join(',')];
      rows.forEach(function (r) {
        csvRows.push([
          r.id, '"' + (r.key_name || '').replace(/"/g, '""') + '"', r.key_type, '"' + (r.purpose || '').replace(/"/g, '""') + '"',
          r.algorithm, r.key_length, r.is_active, r.rotation_enabled, r.rotation_days,
          r.last_rotated_at ? new Date(r.last_rotated_at).toISOString() : '',
          r.next_rotation_at ? new Date(r.next_rotation_at).toISOString() : '',
          r.rotation_count, r.created_by || '', r.created_at ? new Date(r.created_at).toISOString() : '',
          r.expires_at ? new Date(r.expires_at).toISOString() : ''
        ].join(','));
      });

      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="encryption-keys-export-' + new Date().toISOString().slice(0, 10) + '.csv"');
      res.setHeader('Cache-Control', 'no-cache');
      return res.send(csvRows.join('\n'));
    }

    // JSON export
    if (format === 'json') {
      return res.json({ success: true, exported_at: new Date().toISOString(), count: rows.length, keys: rows });
    }

    // HTML view
    const rowsHtml = rows.length > 0
      ? rows.map(function (r) {
          return '<tr>' +
            '<td>' + r.id + '</td>' +
            '<td style="font-weight:600">' + esc(r.key_name) + '</td>' +
            '<td>' + algorithmBadge(r.algorithm) + '</td>' +
            '<td>' + (r.purpose ? '<span class="ekm-chip">' + esc(r.purpose) + '</span>' : '—') + '</td>' +
            '<td>' + r.key_length + ' bit</td>' +
            '<td>' + activeBadge(r.is_active) + '</td>' +
            '<td>' + (r.rotation_count || 0) + '</td>' +
            '<td>' + formatTs(r.created_at) + '</td>' +
            '<td>' + formatTs(r.last_rotated_at) + '</td></tr>';
        }).join('')
      : '<tr><td colspan="9" class="ekm-empty">No keys to export</td></tr>';

    const body = CSS + '<div class="ekm-container">' +
      navBar('export') +
      '<div class="ekm-flex-between">' +
        '<div><h1 class="ekm-page-title">📤 Export Key Metadata</h1><p class="ekm-subtitle">Export key inventory — actual key values are NOT included</p></div>' +
        '<div class="ekm-flex" style="margin-bottom:0">' +
          '<a href="/admin/encryption-keys/export?format=csv" class="ekm-btn ekm-btn-primary">📥 CSV</a> ' +
          '<a href="/admin/encryption-keys/export?format=json" class="ekm-btn ekm-btn-outline">📥 JSON</a>' +
        '</div>' +
      '</div>' +
      '<div class="ekm-alert ekm-alert-info">ℹ️ For security, exported data does NOT include actual encryption key values. Only metadata is exported.</div>' +
      '<div class="ekm-grid" style="grid-template-columns:repeat(auto-fill,minmax(160px,1fr));margin-bottom:20px">' +
        '<div class="ekm-card" style="padding:14px;text-align:center"><div class="ekm-card-label">Keys Exported</div><div class="ekm-card-value" style="font-size:1.4rem">' + rows.length + '</div></div>' +
        '<div class="ekm-card" style="padding:14px;text-align:center"><div class="ekm-card-label">Active</div><div class="ekm-card-value" style="font-size:1.4rem;color:var(--success)">' + rows.filter(function (r) { return r.is_active; }).length + '</div></div>' +
        '<div class="ekm-card" style="padding:14px;text-align:center"><div class="ekm-card-label">Inactive</div><div class="ekm-card-value" style="font-size:1.4rem;color:var(--danger)">' + rows.filter(function (r) { return !r.is_active; }).length + '</div></div>' +
      '</div>' +
      '<div class="ekm-table-wrap"><div class="ekm-table-scroll"><table class="ekm-table">' +
        '<thead><tr><th>ID</th><th>Name</th><th>Algorithm</th><th>Purpose</th><th>Length</th><th>Status</th><th>Rotated</th><th>Created</th><th>Last Rotated</th></tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table></div></div>' +
    '</div>';
    res.send(renderPage('Encryption Overview', body, req.session?.user));
  }));

  // ---------- 12. GET /settings — Encryption settings ----------
  app.get('/admin/encryption-keys/settings', requireAuth, ah(async (req, res) => {
    const sid = tenantId(req);
    const [keyStats, algoStats, usageStats] = await Promise.all([
      pool.query("SELECT algorithm, COUNT(*)::int AS cnt, AVG(key_length)::int AS avg_length FROM encryption_keys WHERE school_id = $1 GROUP BY algorithm ORDER BY cnt DESC", [sid]),
      pool.query("SELECT COUNT(*)::int AS total, COUNT(CASE WHEN is_active THEN 1 END)::int AS active, COUNT(CASE WHEN rotation_enabled THEN 1 END)::int AS rotation_on, AVG(rotation_days)::int AS avg_rotation FROM encryption_keys WHERE school_id = $1", [sid]),
      pool.query("SELECT action, COUNT(*)::int AS cnt FROM key_usage_log WHERE school_id = $1 AND created_at > NOW() - INTERVAL '7 days' GROUP BY action ORDER BY cnt DESC", [sid]),
    ]);

    const algorithms = keyStats.rows;
    const stats = usageStats.rows[0] || {};
    const usageActions = usageStats.rows;
    const totalKeys = (await pool.query('SELECT COUNT(*)::int AS n FROM encryption_keys WHERE school_id = $1', [sid])).rows[0].n;

    const algoMax = Math.max.apply(null, algorithms.map(function (a) { return a.cnt; }).concat([1]));
    const usageMax = Math.max.apply(null, usageActions.map(function (u) { return u.cnt; }).concat([1]));

    const body = CSS + '<div class="ekm-container">' +
      navBar('settings') +
      '<h1 class="ekm-page-title">⚙️ Encryption Settings</h1>' +
      '<p class="ekm-subtitle">Key policy configuration and security overview</p>' +

      '<div class="ekm-grid" style="grid-template-columns: 1fr 1fr; gap: 20px">' +
        '<div class="ekm-card">' +
          '<div class="ekm-section-title">🔑 Key Creation</div>' +
          '<p class="ekm-form-hint" style="margin-bottom:16px">Generate a new encryption key for your application.</p>' +
          '<form method="POST" action="/admin/encryption-keys/create" style="display:grid;gap:12px">' +
            '<div class="ekm-form-group">' +
              '<label class="ekm-form-label">Key Name</label>' +
              '<input name="key_name" class="ekm-input" required placeholder="e.g. production-data-key" style="width:100%">' +
            '</div>' +
            '<div class="ekm-form-group">' +
              '<label class="ekm-form-label">Algorithm</label>' +
              '<select name="algorithm" class="ekm-select" style="width:100%">' +
                '<option value="AES-256-CBC">AES-256-CBC</option>' +
                '<option value="AES-256-GCM">AES-256-GCM</option>' +
                '<option value="AES-128-CBC">AES-128-CBC</option>' +
                '<option value="RSA-2048">RSA-2048</option>' +
                '<option value="RSA-4096">RSA-4096</option>' +
                '<option value="ChaCha20-Poly1305">ChaCha20-Poly1305</option>' +
              '</select>' +
            '</div>' +
            '<div class="ekm-form-group">' +
              '<label class="ekm-form-label">Purpose</label>' +
              '<select name="purpose" class="ekm-select" style="width:100%">' +
                '<option value="">General Purpose</option>' +
                '<option value="data-encryption">Data Encryption</option>' +
                '<option value="token-signing">Token Signing</option>' +
                '<option value="password-hashing">Password Hashing</option>' +
                '<option value="api-auth">API Authentication</option>' +
                '<option value="file-encryption">File Encryption</option>' +
                '<option value="db-encryption">Database Encryption</option>' +
              '</select>' +
            '</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
              '<div class="ekm-form-group">' +
                '<label class="ekm-form-label">Key Length (bits)</label>' +
                '<select name="key_length" class="ekm-select" style="width:100%">' +
                  '<option value="128">128</option>' +
                  '<option value="256" selected>256</option>' +
                  '<option value="512">512</option>' +
                '</select>' +
              '</div>' +
              '<div class="ekm-form-group">' +
                '<label class="ekm-form-label">Rotation (days)</label>' +
                '<input name="rotation_days" type="number" class="ekm-input" value="90" min="1" max="365" style="width:100%">' +
              '</div>' +
            '</div>' +
            '<div class="ekm-form-group">' +
              '<label class="ekm-form-label">Expires At (optional)</label>' +
              '<input name="expires_at" type="date" class="ekm-input" style="width:100%">' +
              '<div class="ekm-form-hint">Leave blank for no expiration</div>' +
            '</div>' +
            '<div style="display:flex;gap:8px;margin-top:4px">' +
              '<button type="submit" class="ekm-btn ekm-btn-primary">🔑 Generate Key</button>' +
            '</div>' +
          '</form>' +
        '</div>' +

        '<div>' +
          '<div class="ekm-card" style="margin-bottom:16px">' +
            '<div class="ekm-section-title">📊 Distribution by Algorithm</div>' +
            '<div class="ekm-bar-chart" style="margin-bottom:12px">' +
              algorithms.map(function (a) {
                var h = Math.max(4, Math.round(a.cnt / algoMax * 160));
                return '<div class="ekm-bar-col">' +
                  '<div class="ekm-bar-val">' + a.cnt + '</div>' +
                  '<div class="ekm-bar" style="height:' + h + 'px"></div>' +
                  '<div class="ekm-bar-label">' + esc(a.algorithm) + '</div></div>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="ekm-card" style="margin-bottom:16px">' +
            '<div class="ekm-section-title">📈 Operations (7 days)</div>' +
            '<div class="ekm-bar-chart">' +
              usageActions.map(function (u) {
                var h = Math.max(4, Math.round(u.cnt / usageMax * 160));
                return '<div class="ekm-bar-col">' +
                  '<div class="ekm-bar-val">' + u.cnt + '</div>' +
                  '<div class="ekm-bar" style="height:' + h + 'px;background:var(--success)"></div>' +
                  '<div class="ekm-bar-label">' + esc(u.action) + '</div></div>';
              }).join('') +
            '</div>' +
          '</div>' +

          '<div class="ekm-card">' +
            '<div class="ekm-section-title">📋 Quick Stats</div>' +
            '<div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">' +
              '<div style="padding:12px;background:rgba(0,0,0,0.2);border-radius:8px;text-align:center">' +
                '<div class="ekm-card-label">Total Keys</div>' +
                '<div style="font-size:1.4rem;font-weight:700">' + totalKeys + '</div></div>' +
              '<div style="padding:12px;background:rgba(0,0,0,0.2);border-radius:8px;text-align:center">' +
                '<div class="ekm-card-label">Rotation Enabled</div>' +
                '<div style="font-size:1.4rem;font-weight:700;color:var(--accent)">' + (algorithms.reduce(function (s, a) { return s + a.cnt; }, 0) || 0) + '</div></div>' +
            '</div>' +
          '</div>' +
        '</div>' +
      '</div>' +
    '</div>';
    res.send(renderPage('Encryption Settings', body, req.session?.user));
  }));
};
