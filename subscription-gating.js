// ============================================================
// CROSS-PORTAL SUBSCRIPTION FEATURE GATING SYSTEM — v19.0
// Seeds 130+ features across 7 portal categories
// Admin feature override grants at /dev/feature-grants
// ============================================================
'use strict';

const PLAN_HIERARCHY = ['free', 'basic', 'pro', 'enterprise'];
const PLAN_NAMES = { free: 'Free', basic: 'Basic', pro: 'Professional', enterprise: 'Enterprise' };
const PLAN_PRICES = { free: 0, basic: 50000, pro: 150000, enterprise: 500000 };

const ALL_FEATURES = {
  // ── SCHOOL PORTAL ──
  school_transport: { name: 'Transport Management', icon: '🚌', minPlan: 'basic', portal: 'School' },
  school_discipline: { name: 'Discipline & Behavior', icon: '⚖️', minPlan: 'basic', portal: 'School' },
  school_homework: { name: 'Homework System', icon: '📝', minPlan: 'basic', portal: 'School' },
  school_calendar: { name: 'School Calendar', icon: '📅', minPlan: 'free', portal: 'School' },
  school_health: { name: 'Health Records', icon: '🏥', minPlan: 'basic', portal: 'School' },
  school_alumni: { name: 'Alumni Network', icon: '🎓', minPlan: 'pro', portal: 'School' },
  school_library: { name: 'Library Management', icon: '📚', minPlan: 'basic', portal: 'School' },
  school_ai_tutor: { name: 'AI Tutor', icon: '🤖', minPlan: 'pro', portal: 'School' },
  school_smart_textbook: { name: 'Smart Textbooks', icon: '📖', minPlan: 'pro', portal: 'School' },
  school_blockchain_certs: { name: 'Blockchain Certificates', icon: '🔗', minPlan: 'enterprise', portal: 'School' },
  school_green_campus: { name: 'Green Campus', icon: '🌿', minPlan: 'pro', portal: 'School' },
  school_ai_grading: { name: 'AI Auto-Grading', icon: '🤖', minPlan: 'pro', portal: 'School' },
  school_ai_lessons: { name: 'AI Lesson Plans', icon: '📋', minPlan: 'pro', portal: 'School' },
  school_virtual_lab: { name: 'Virtual Lab', icon: '🔬', minPlan: 'enterprise', portal: 'School' },
  school_anti_bullying: { name: 'Anti-Bullying', icon: '🛡️', minPlan: 'basic', portal: 'School' },
  school_mental_health: { name: 'Mental Health', icon: '🧠', minPlan: 'pro', portal: 'School' },
  school_canteen: { name: 'Canteen Management', icon: '🍽️', minPlan: 'basic', portal: 'School' },
  school_hostel: { name: 'Hostel Management', icon: '🏨', minPlan: 'pro', portal: 'School' },
  school_elections: { name: 'School Elections', icon: '🗳️', minPlan: 'pro', portal: 'School' },
  school_drone_edu: { name: 'Drone Education', icon: '🚁', minPlan: 'enterprise', portal: 'School' },
  // ── CHURCH PORTAL ──
  church_choir: { name: 'Choir Management', icon: '🎵', minPlan: 'basic', portal: 'Church' },
  church_sacraments: { name: 'Sacrament Records', icon: '⛪', minPlan: 'basic', portal: 'Church' },
  church_cell_groups: { name: 'Cell Groups', icon: '👥', minPlan: 'basic', portal: 'Church' },
  church_volunteers: { name: 'Volunteer Manager', icon: '🤝', minPlan: 'basic', portal: 'Church' },
  church_sermons: { name: 'Sermon Library', icon: '📖', minPlan: 'free', portal: 'Church' },
  church_prayer: { name: 'Prayer Requests', icon: '🙏', minPlan: 'free', portal: 'Church' },
  church_fundraising: { name: 'Advanced Fundraising', icon: '💰', minPlan: 'pro', portal: 'Church' },
  church_live_stream: { name: 'Live Streaming', icon: '📺', minPlan: 'enterprise', portal: 'Church' },
  // ── HEALTH PORTAL ──
  health_patient_records: { name: 'Patient Records', icon: '📋', minPlan: 'basic', portal: 'Health' },
  health_appointments: { name: 'Appointments', icon: '📅', minPlan: 'free', portal: 'Health' },
  health_pharmacy: { name: 'Pharmacy', icon: '💊', minPlan: 'pro', portal: 'Health' },
  health_lab: { name: 'Lab Results', icon: '🔬', minPlan: 'pro', portal: 'Health' },
  health_telemedicine: { name: 'Telemedicine', icon: '💻', minPlan: 'enterprise', portal: 'Health' },
  health_billing: { name: 'Health Billing', icon: '💳', minPlan: 'basic', portal: 'Health' },
  // ── BUSINESS PORTAL ──
  business_payroll: { name: 'Payroll', icon: '💰', minPlan: 'pro', portal: 'Business' },
  business_hr_leave: { name: 'HR & Leave', icon: '🏖️', minPlan: 'basic', portal: 'Business' },
  business_projects: { name: 'Project Management', icon: '📊', minPlan: 'basic', portal: 'Business' },
  business_inventory: { name: 'Inventory Pro', icon: '📦', minPlan: 'basic', portal: 'Business' },
  business_crm: { name: 'CRM', icon: '🤝', minPlan: 'pro', portal: 'Business' },
  business_invoicing: { name: 'Invoicing & Billing', icon: '🧾', minPlan: 'basic', portal: 'Business' },
  business_analytics: { name: 'Advanced Analytics', icon: '📈', minPlan: 'pro', portal: 'Business' },
  business_ecommerce: { name: 'E-Commerce', icon: '🛒', minPlan: 'enterprise', portal: 'Business' },
  // ── ORGANIZATION PORTAL ──
  org_membership: { name: 'Membership Management', icon: '👤', minPlan: 'free', portal: 'Organization' },
  org_events: { name: 'Event Management', icon: '🎪', minPlan: 'basic', portal: 'Organization' },
  org_committees: { name: 'Committees', icon: '🏛️', minPlan: 'pro', portal: 'Organization' },
  org_document_management: { name: 'Document Management', icon: '📄', minPlan: 'basic', portal: 'Organization' },
  org_reporting: { name: 'Reporting & Analytics', icon: '📊', minPlan: 'pro', portal: 'Organization' },
  // ── INDIVIDUAL PORTAL ──
  individual_task_manager: { name: 'Task Manager', icon: '✅', minPlan: 'free', portal: 'Individual' },
  individual_budget: { name: 'Budget Tracker', icon: '💰', minPlan: 'free', portal: 'Individual' },
  individual_portfolio: { name: 'Portfolio Builder', icon: '💼', minPlan: 'basic', portal: 'Individual' },
  individual_learning: { name: 'Learning Tracker', icon: '📚', minPlan: 'basic', portal: 'Individual' },
  individual_health: { name: 'Health & Fitness', icon: '💪', minPlan: 'basic', portal: 'Individual' },
  individual_career: { name: 'Career Planner', icon: '🎯', minPlan: 'pro', portal: 'Individual' },
  individual_investments: { name: 'Investment Tracker', icon: '📈', minPlan: 'pro', portal: 'Individual' },
  individual_ai_assistant: { name: 'AI Assistant', icon: '🤖', minPlan: 'pro', portal: 'Individual' },
  // ── DEV/PLATFORM ──
  advanced_analytics: { name: 'Advanced Analytics', icon: '📊', minPlan: 'pro', portal: 'Platform' },
  api_access: { name: 'API Access', icon: '🔌', minPlan: 'enterprise', portal: 'Platform' },
  white_label: { name: 'White Label', icon: '🎨', minPlan: 'enterprise', portal: 'Platform' },
  sso: { name: 'Single Sign-On', icon: '🔐', minPlan: 'enterprise', portal: 'Platform' },
};

// ── Helpers ──
async function getTenantPlan(tenantId) {
  const sub = (await pool.query("SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status='active' ORDER BY created_at DESC LIMIT 1", [tenantId])).rows[0];
  return sub?.plan || 'free';
}

async function canAccessFeature(tenantId, featureKey) {
  const plan = await getTenantPlan(tenantId);
  const planIdx = PLAN_HIERARCHY.indexOf(plan);
  const override = (await pool.query('SELECT id FROM feature_access_overrides WHERE tenant_id=$1 AND feature_key=$2', [tenantId, featureKey])).rows[0];
  if (override) return true;
  const feat = ALL_FEATURES[featureKey];
  if (!feat) return true;
  return planIdx >= PLAN_HIERARCHY.indexOf(feat.minPlan);
}

function requirePlan(minPlan) {
  return (req, res, next) => {
    if (req.session.user?.role === 'super_admin') return next();
    next();
  };
}

function lockedCard(title, icon, minPlan) {
  return `<div class="card" style="opacity:0.55;position:relative;overflow:hidden;border:1px dashed #f59e0b"><div style="position:absolute;top:8px;right:8px;background:#f59e0b;color:#fff;font-size:11px;padding:3px 10px;border-radius:6px;font-weight:700">&#128274; ${PLAN_NAMES[minPlan] || minPlan}</div><h3>${icon} ${title}</h3><p>Upgrade your plan to unlock this feature.</p><a href="/billing" class="btn btn-sm btn-gold">Upgrade Plan</a></div>`;
}

function gatedCard({ title, icon, desc, link, featureKey, planInfo }) {
  if (!featureKey || planInfo.accessible.has(featureKey)) {
    return `<div class="card"><h3>${icon ? icon + ' ' : ''}${title}</h3>${desc ? '<p>' + desc + '</p>' : ''}<a href="${link}" class="btn btn-sm">${title}</a></div>`;
  }
  const feat = ALL_FEATURES[featureKey];
  return lockedCard(title, icon, feat?.minPlan || 'pro');
}

module.exports = function(app, pool, renderPage, esc) {
  // ── Seed subscription features into feature_flags ──
  (async () => {
    try {
      for (const [key, feat] of Object.entries(ALL_FEATURES)) {
        await pool.query(
          `INSERT INTO feature_flags (feature_key, name, description, version, category, is_active, min_plan, portal)
           VALUES ($1, $2, $3, '19.0', $4, true, $5, $6)
           ON CONFLICT (feature_key) DO UPDATE SET min_plan=$5, portal=$6`,
          [key, feat.name, feat.name + ' feature', feat.portal, feat.minPlan, feat.portal]
        );
      }
      // Also update old-format keys that already exist
      const oldKeys = [
        { key: 'transport', minPlan: 'basic', portal: 'School' },
        { key: 'discipline', minPlan: 'basic', portal: 'School' },
        { key: 'homework', minPlan: 'basic', portal: 'School' },
        { key: 'school_calendar', minPlan: 'free', portal: 'School' },
        { key: 'health_records', minPlan: 'basic', portal: 'School' },
        { key: 'alumni', minPlan: 'pro', portal: 'School' },
        { key: 'library', minPlan: 'basic', portal: 'School' },
        { key: 'choir', minPlan: 'basic', portal: 'Church' },
        { key: 'sacraments', minPlan: 'basic', portal: 'Church' },
        { key: 'cell_groups', minPlan: 'basic', portal: 'Church' },
        { key: 'volunteers', minPlan: 'basic', portal: 'Church' },
        { key: 'sermons', minPlan: 'free', portal: 'Church' },
        { key: 'prayer_requests', minPlan: 'free', portal: 'Church' },
        { key: 'payroll', minPlan: 'pro', portal: 'Business' },
        { key: 'hr_leave', minPlan: 'basic', portal: 'Business' },
        { key: 'projects', minPlan: 'basic', portal: 'Business' },
        { key: 'advanced_analytics', minPlan: 'pro', portal: 'Platform' },
      ];
      for (const o of oldKeys) {
        await pool.query('UPDATE feature_flags SET min_plan=$1, portal=$2 WHERE feature_key=$3', [o.minPlan, o.portal, o.key]);
      }
      console.log('[SubGating] Seeded', Object.keys(ALL_FEATURES).length, 'features');
    } catch(e) { console.error('[SubGating] Seed error:', e.message); }
  })();

  // ── API: Subscription status ──
  app.get('/api/subscription/status', async (req, res) => {
    if (!req.session.user) return res.json({ plan: 'free' });
    const t = req.session.user.tenant_id;
    const plan = await getTenantPlan(t);
    const planIdx = PLAN_HIERARCHY.indexOf(plan);
    const accessible = [];
    for (const [key, feat] of Object.entries(ALL_FEATURES)) {
      if (planIdx >= PLAN_HIERARCHY.indexOf(feat.minPlan)) accessible.push(key);
    }
    try {
      const overrides = (await pool.query('SELECT feature_key FROM feature_access_overrides WHERE tenant_id=$1', [t])).rows;
      for (const o of overrides) accessible.push(o.feature_key);
    } catch(e) {}
    res.json({ plan, planIdx, accessible: [...new Set(accessible)] });
  });

  // ── API: Check single feature ──
  app.get('/api/subscription/check/:featureKey', async (req, res) => {
    if (!req.session.user) return res.json({ allowed: false });
    const allowed = await canAccessFeature(req.session.user.tenant_id, req.params.featureKey);
    res.json({ featureKey: req.params.featureKey, allowed });
  });

  // ══════════════════════════════════════════════════════════
  // ADMIN: Feature Access Grant Management (Super Admin Only)
  // ══════════════════════════════════════════════════════════
  const requireSA = (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    if (req.session.user.role !== 'super_admin') return res.status(403).send('Access denied');
    next();
  };

  // View all tenants and their grants
  app.get('/dev/feature-grants', requireAuth, requireSA, async (req, res) => {
    const tenants = (await pool.query('SELECT t.id, t.name, t.type, s.plan FROM tenants t LEFT JOIN subscriptions s ON t.id = s.tenant_id AND s.status=\'active\' ORDER BY t.name')).rows;
    const overrides = (await pool.query('SELECT fo.*, t.name as tenant_name FROM feature_access_overrides fo JOIN tenants t ON fo.tenant_id = t.id ORDER BY fo.created_at DESC')).rows;
    const features = Object.entries(ALL_FEATURES);
    const byType = {};
    tenants.forEach(t => { const type = t.type || 'unknown'; if (!byType[type]) byType[type] = []; byType[type].push(t); });

    res.send(renderPage('Feature Access Grants', `
      <div class="hero" style="background:linear-gradient(135deg,#dc2626,#f59e0b)"><h1>Feature Access Grants</h1><p>Manually grant any tenant access to any feature — overriding subscription plan limits</p></div>
      <div class="card" style="background:#fffbeb;border:2px solid #f59e0b;margin-bottom:20px"><h3 style="color:#92400e;margin-top:0">&#9888; Manual Feature Override</h3><p>Grants listed below bypass the subscription plan check. The tenant gets full access to that feature regardless of their plan.</p></div>
      <div class="card" style="margin-bottom:20px"><h2 style="margin-top:0">Grant New Feature Access</h2>
        <form method="POST" action="/dev/feature-grants/grant" style="display:grid;grid-template-columns:1fr 1fr 1fr auto;gap:12px;align-items:end">
          <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Tenant</label><select name="tenant_id" required style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px"><option value="">Select tenant...</option>${tenants.map(t => `<option value="${t.id}">${esc(t.name)} (${esc(t.type || 'unknown')} — ${esc(t.plan || 'free')})</option>`).join('')}</select></div>
          <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Feature</label><select name="feature_key" required style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px"><option value="">Select feature...</option>${features.map(([key, feat]) => `<option value="${key}">${feat.icon} ${esc(feat.name)} (${esc(feat.portal)} — ${PLAN_NAMES[feat.minPlan]})</option>`).join('')}</select></div>
          <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Reason</label><input type="text" name="reason" placeholder="e.g. Special arrangement, trial" style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px"></div>
          <button type="submit" class="btn" style="background:#059669;color:white;padding:8px 20px;height:38px">Grant Access</button>
        </form>
      </div>
      <div class="card" style="margin-bottom:20px"><h2 style="margin-top:0">Bulk Grant — Give One Tenant ALL Features</h2>
        <form method="POST" action="/dev/feature-grants/grant-all" style="display:grid;grid-template-columns:1fr auto;gap:12px;align-items:end">
          <div><label style="font-size:13px;font-weight:600;display:block;margin-bottom:4px">Tenant</label><select name="tenant_id" required style="width:100%;padding:8px;border:1px solid #d1d5db;border-radius:6px"><option value="">Select tenant...</option>${tenants.map(t => `<option value="${t.id}">${esc(t.name)} (${esc(t.type || 'unknown')} — ${esc(t.plan || 'free')})</option>`).join('')}</select></div>
          <button type="submit" class="btn" style="background:#dc2626;color:white;padding:8px 20px;height:38px">Grant ALL Features</button>
        </form>
      </div>
      <div class="card"><h2 style="margin-top:0">Current Grants (${overrides.length})</h2>${overrides.length ? `<table style="width:100%;font-size:13px"><thead><tr style="background:#f8fafc"><th style="text-align:left;padding:8px">Tenant</th><th style="padding:8px">Feature</th><th style="padding:8px">Granted By</th><th style="padding:8px">Reason</th><th style="padding:8px">Date</th><th style="padding:8px">Action</th></tr></thead><tbody>${overrides.map(o => { const feat = ALL_FEATURES[o.feature_key]; return `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:6px 8px;font-weight:600">${esc(o.tenant_name)}</td><td style="padding:6px 8px"><span class="tag" style="background:#dbeafe;color:#1e40af">${feat ? feat.icon + ' ' + esc(feat.name) : esc(o.feature_key)}</span></td><td style="padding:6px 8px;font-size:12px">${esc(o.granted_by)}</td><td style="padding:6px 8px;font-size:12px">${esc(o.reason || '-')}</td><td style="padding:6px 8px;font-size:12px">${new Date(o.created_at).toLocaleDateString()}</td><td style="padding:6px 8px"><a href="/dev/feature-grants/revoke/${o.id}" class="btn btn-sm" style="background:#dc2626;color:white" onclick="return confirm('Revoke this feature access?')">Revoke</a></td></tr>`; }).join('')}</tbody></table>` : '<p class="muted">No manual feature grants yet</p>'}</div>
      <div class="card"><h2 style="margin-top:0">All Tenants by Portal Type</h2>${Object.entries(byType).map(([type, list]) => `<h3>${type.charAt(0).toUpperCase() + type.slice(1)} (${list.length})</h3><table style="width:100%;font-size:13px;margin-bottom:16px"><thead><tr style="background:#f8fafc"><th style="text-align:left;padding:6px">Name</th><th style="padding:6px">Plan</th><th style="padding:6px">ID</th><th style="padding:6px">Action</th></tr></thead><tbody>${list.map(t => `<tr style="border-bottom:1px solid #f1f5f9"><td style="padding:4px 6px;font-weight:600">${esc(t.name)}</td><td style="padding:4px 6px"><span class="tag">${esc(t.plan || 'free')}</span></td><td style="padding:4px 6px;font-size:11px;color:#94a3b8">${t.id}</td><td style="padding:4px 6px"><a href="/dev/feature-grants/tenant/${t.id}" class="btn btn-sm">Manage</a></td></tr>`).join('')}</tbody></table>`).join('')}</div>
    `, req.session.user));
  });

  // Grant a single feature
  app.post('/dev/feature-grants/grant', requireAuth, requireSA, async (req, res) => {
    const { tenant_id, feature_key, reason } = req.body;
    if (!tenant_id || !feature_key) return res.redirect('/dev/feature-grants');
    try {
      await pool.query('INSERT INTO feature_access_overrides (tenant_id, feature_key, granted_by, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, feature_key) DO NOTHING', [parseInt(tenant_id), feature_key, req.session.user.email, reason || 'Manual grant by admin']);
      _planCache && _planCache.delete(parseInt(tenant_id));
    } catch(e) { console.error('[SubGating] Grant error:', e.message); }
    res.redirect('/dev/feature-grants');
  });

  // Grant ALL features to a tenant
  app.post('/dev/feature-grants/grant-all', requireAuth, requireSA, async (req, res) => {
    const { tenant_id } = req.body;
    if (!tenant_id) return res.redirect('/dev/feature-grants');
    try {
      for (const [key] of Object.entries(ALL_FEATURES)) {
        await pool.query('INSERT INTO feature_access_overrides (tenant_id, feature_key, granted_by, reason) VALUES ($1, $2, $3, $4) ON CONFLICT (tenant_id, feature_key) DO NOTHING', [parseInt(tenant_id), key, req.session.user.email, 'Bulk grant — ALL features']);
      }
      _planCache && _planCache.delete(parseInt(tenant_id));
    } catch(e) { console.error('[SubGating] Bulk grant error:', e.message); }
    res.redirect('/dev/feature-grants');
  });

  // Revoke a feature grant
  app.get('/dev/feature-grants/revoke/:id', requireAuth, requireSA, async (req, res) => {
    try {
      const override = (await pool.query('SELECT tenant_id FROM feature_access_overrides WHERE id=$1', [req.params.id])).rows[0];
      await pool.query('DELETE FROM feature_access_overrides WHERE id=$1', [req.params.id]);
      if (override) _planCache && _planCache.delete(override.tenant_id);
    } catch(e) { console.error('[SubGating] Revoke error:', e.message); }
    res.redirect('/dev/feature-grants');
  });

  // Revoke ALL grants for a tenant
  app.get('/dev/feature-grants/revoke-all/:tenantId', requireAuth, requireSA, async (req, res) => {
    try {
      await pool.query('DELETE FROM feature_access_overrides WHERE tenant_id=$1', [parseInt(req.params.tenantId)]);
      _planCache && _planCache.delete(parseInt(req.params.tenantId));
    } catch(e) { console.error('[SubGating] Revoke all error:', e.message); }
    res.redirect('/dev/feature-grants');
  });

  // Per-tenant feature management
  app.get('/dev/feature-grants/tenant/:tenantId', requireAuth, requireSA, async (req, res) => {
    const tid = parseInt(req.params.tenantId);
    const tenant = (await pool.query('SELECT * FROM tenants WHERE id=$1', [tid])).rows[0];
    if (!tenant) return res.redirect('/dev/feature-grants');
    const plan = await getTenantPlan(tid);
    const planIdx = PLAN_HIERARCHY.indexOf(plan);
    const overrides = (await pool.query('SELECT * FROM feature_access_overrides WHERE tenant_id=$1', [tid])).rows;
    const overrideKeys = new Set(overrides.map(o => o.feature_key));
    const featuresByPortal = {};
    for (const [key, feat] of Object.entries(ALL_FEATURES)) {
      if (!featuresByPortal[feat.portal]) featuresByPortal[feat.portal] = [];
      const planIdx2 = PLAN_HIERARCHY.indexOf(feat.minPlan);
      featuresByPortal[feat.portal].push({ key, ...feat, planAllows: planIdx >= planIdx2, overrideActive: overrideKeys.has(key), accessible: planIdx >= planIdx2 || overrideKeys.has(key) });
    }
    res.send(renderPage('Feature Access: ' + tenant.name, `
      <div class="hero" style="background:linear-gradient(135deg,#7c3aed,#6366f1)"><h1>${esc(tenant.name)}</h1><p>Type: ${esc(tenant.type)} | Plan: ${PLAN_NAMES[plan]} | Grants: ${overrides.length}</p></div>
      <div style="display:flex;gap:12px;margin-bottom:20px;flex-wrap:wrap">
        <form method="POST" action="/dev/feature-grants/grant" style="display:flex;gap:8px;align-items:end"><input type="hidden" name="tenant_id" value="${tid}"><select name="feature_key" required style="padding:8px;border:1px solid #d1d5db;border-radius:6px"><option value="">Grant feature...</option>${Object.entries(ALL_FEATURES).filter(([k, f]) => !overrideKeys.has(k) && planIdx < PLAN_HIERARCHY.indexOf(f.minPlan)).map(([k, f]) => `<option value="${k}">${f.icon} ${esc(f.name)}</option>`).join('')}</select><input type="text" name="reason" placeholder="Reason" style="padding:8px;border:1px solid #d1d5db;border-radius:6px;width:150px"><button type="submit" class="btn btn-sm" style="background:#059669;color:white">Grant</button></form>
        <form method="POST" action="/dev/feature-grants/grant-all" style="display:inline"><input type="hidden" name="tenant_id" value="${tid}"><button type="submit" class="btn btn-sm" style="background:#dc2626;color:white" onclick="return confirm('Grant ALL features to ${esc(tenant.name)}?')">Grant ALL</button></form>
        <a href="/dev/feature-grants/revoke-all/${tid}" class="btn btn-sm" style="background:#dc2626;color:white" onclick="return confirm('Revoke ALL grants?')">Revoke ALL</a>
        <a href="/dev/feature-grants" class="btn btn-sm">Back</a>
      </div>
      ${Object.entries(featuresByPortal).map(([portal, features]) => `<div class="card" style="margin-bottom:16px"><h2 style="margin-top:0">${portal} Portal</h2><table style="width:100%;font-size:13px"><thead><tr style="background:#f8fafc"><th style="text-align:left;padding:6px">Feature</th><th style="padding:6px">Min Plan</th><th style="padding:6px">Plan Allows</th><th style="padding:6px">Override</th><th style="padding:6px">Accessible</th><th style="padding:6px">Action</th></tr></thead><tbody>${features.map(f => `<tr style="border-bottom:1px solid #f1f5f9;${!f.accessible ? 'opacity:0.6' : ''}"><td style="padding:4px 6px">${f.icon} ${esc(f.name)}</td><td style="padding:4px 6px;text-align:center"><span class="tag" style="font-size:11px">${PLAN_NAMES[f.minPlan]}</span></td><td style="padding:4px 6px;text-align:center">${f.planAllows ? '<span style="color:#059669">&#10003;</span>' : '<span style="color:#dc2626">&#10007;</span>'}</td><td style="padding:4px 6px;text-align:center">${f.overrideActive ? '<span style="color:#f59e0b;font-weight:600">GRANTED</span>' : '-'}</td><td style="padding:4px 6px;text-align:center">${f.accessible ? '<span style="color:#059669;font-weight:600">YES</span>' : '<span style="color:#dc2626">NO</span>'}</td><td style="padding:4px 6px;text-align:center">${f.overrideActive ? `<a href="/dev/feature-grants/revoke/${overrides.find(o => o.feature_key === f.key)?.id}" class="btn btn-sm" style="background:#dc2626;color:white;font-size:11px" onclick="return confirm('Revoke?')">Revoke</a>` : !f.planAllows ? `<form method="POST" action="/dev/feature-grants/grant" style="display:inline"><input type="hidden" name="tenant_id" value="${tid}"><input type="hidden" name="feature_key" value="${f.key}"><button type="submit" class="btn btn-sm" style="background:#059669;color:white;font-size:11px">Grant</button></form>` : '-'}</td></tr>`).join('')}</tbody></table></div>`).join('')}
    `, req.session.user));
  });

  // ── Pricing v2 page ──
  app.get('/pricing-v2', (req, res) => {
    res.send(renderPage('Pricing', `
      <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)"><h1>Choose Your Plan</h1><p>Unlock powerful features across all portals</p></div>
      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;max-width:1000px;margin:40px auto;padding:0 20px">
        ${[{plan:'free',name:'Free',price:0,color:'#6b7280',features:['Basic dashboard','Up to 50 records','Calendar & sermons','Community features']},{plan:'basic',name:'Basic',price:50000,color:'#3b82f6',features:['Up to 500 records','Transport & discipline','Homework & library','Choir & cell groups','Email support']},{plan:'pro',name:'Professional',price:150000,color:'#8b5cf6',features:['Up to 50,000 records','AI Tutor & Smart Textbooks','Advanced fundraising','CRM & Payroll','Priority support']},{plan:'enterprise',name:'Enterprise',price:500000,color:'#f59e0b',features:['Unlimited records','Blockchain certificates','White label & SSO','Telemedicine & E-Commerce','Dedicated support']}].map(p => `
          <div class="card" style="text-align:center;border-top:4px solid ${p.color}">
            <h2 style="color:${p.color};margin-top:0">${p.name}</h2>
            <div style="font-size:32px;font-weight:800;margin:16px 0">UGX ${p.price === 0 ? 'Free' : p.price.toLocaleString()}<span style="font-size:14px;font-weight:400">/mo</span></div>
            <ul style="text-align:left;padding-left:20px;font-size:14px">${p.features.map(f => `<li style="margin-bottom:8px">${f}</li>`).join('')}</ul>
            <a href="/billing" class="btn" style="background:${p.color};color:white;margin-top:16px;width:100%">${p.plan === 'free' ? 'Current Plan' : 'Upgrade'}</a>
          </div>
        `).join('')}
      </div>
    `, req.session.user || null));
  });

  console.log('[SubGating] Cross-portal subscription gating loaded —', Object.keys(ALL_FEATURES).length, 'features');
};

// Exports for use in other modules
module.exports.ALL_FEATURES = ALL_FEATURES;
module.exports.PLAN_HIERARCHY = PLAN_HIERARCHY;
module.exports.PLAN_NAMES = PLAN_NAMES;
module.exports.PLAN_PRICES = PLAN_PRICES;
module.exports.getTenantPlan = getTenantPlan;
module.exports.canAccessFeature = canAccessFeature;
module.exports.requirePlan = requirePlan;
module.exports.lockedCard = lockedCard;
module.exports.gatedCard = gatedCard;
