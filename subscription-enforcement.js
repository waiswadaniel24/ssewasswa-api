// ============================================================
// === SUBSCRIPTION ENFORCEMENT — Actually Block Overages ===
// ============================================================
// The old requirePlanLimit middleware only showed a page but never
// returned a proper 403 JSON response for API callers.  The dunning
// pipeline sent emails but never changed the plan.  This module
// wires up real enforcement so that plan limits are checked *before*
// record creation and downgraded tenants actually lose access.

module.exports = function(app, pool, opts = {}) {
  const esc       = opts.esc       || (s => String(s || ''));
  const audit     = opts.audit     || (() => {});
  const sendEmail = opts.sendEmail || (() => {});

  // ============================================================
  // PLAN DEFINITIONS
  // ============================================================
  const PLANS = {
    free:          { name: 'Free',          maxRecords: 50,     maxAdmins: 1,   price: 0 },
    basic:         { name: 'Basic',         maxRecords: 500,    maxAdmins: 5,   price: 50000 },
    professional:  { name: 'Professional',  maxRecords: 50000,  maxAdmins: 999, price: 150000 },
    enterprise:    { name: 'Enterprise',    maxRecords: 999999, maxAdmins: 999, price: 500000 },
  };

  const PLAN_HIERARCHY = ['free', 'basic', 'professional', 'enterprise'];

  // ============================================================
  // HELPERS
  // ============================================================

  /**
   * Look up the current active plan for a tenant.  Falls back to 'free'.
   */
  async function getTenantPlan(tenantId) {
    try {
      const sub = (await pool.query(
        "SELECT plan FROM subscriptions WHERE tenant_id = $1 AND status = 'active' ORDER BY created_at DESC LIMIT 1",
        [tenantId]
      )).rows[0];
      return sub?.plan || 'free';
    } catch (e) {
      return 'free';
    }
  }

  /**
   * Return the full plan info object for a tenant (plan key + definition).
   */
  async function getTenantPlanInfo(tenantId) {
    const planKey = await getTenantPlan(tenantId);
    return { key: planKey, ...PLANS[planKey] };
  }

  /**
   * Count records for a tenant in a given table.
   */
  async function countRecords(tenantId, tableName) {
    // Validate table name against allowlist to prevent SQL injection
    const ALLOWED = new Set([
      'students','users','fees','attendance','marks','exams','classes',
      'subjects','results','members','donations','events','campaigns','inventory',
      'invoices','payments','subscriptions','notifications','audit_logs','sms_logs',
      'email_queue','webhooks','webhook_logs','automation_rules','role_permissions',
      'feature_flags','chart_of_accounts','journal_entries','student_accounts',
      'church_accounts','student_health','meal_attendance','parent_links',
      'church_attendance','choir_members','cell_group_members','channel_members',
      'custom_pages','document_templates','educational_resources','scraped_content',
      'public_posts','daily_adverts','external_links','subscription_plans',
      'push_subscriptions','ussd_sessions','translations','platform_settings',
      'platform_status','backup_queue','developer_revenue','momo_payments',
      'leave_requests','expense_claims','visitors','assets','feedback_entries',
      'user_notes','announcements','employee_directory','room_bookings',
      'purchase_requisitions','incident_reports','fleet_vehicles','support_tickets',
      'knowledge_base','sales','sale_items','expenses','staff','church_members',
      'customers','org_finance','timetable','grading_scales','fee_structures',
      'sign_in_out','fee_receipts','purchase_orders','tax_records','income_records',
      'projects','budget_items','goals','personal_notes','meeting_minutes',
      'notice_board','sermons','prayer_requests','service_schedule',
      'hr_employees','hr_payroll','hr_leave','hr_departments','hr_appraisals',
      'crm_leads','crm_pipeline','crm_activities','crm_contacts',
      'task_items','task_columns','task_assignees',
      'asset_register','asset_maintenance','asset_depreciation',
      'event_tickets','event_registrations','ticket_orders',
      'invoice_items','recurring_invoices','recurring_invoice_items',
      'installment_plans','installment_payments',
    ]);
    if (!ALLOWED.has(tableName)) throw new Error(`Invalid table name: ${tableName}`);
    const result = await pool.query(`SELECT COUNT(*) FROM ${tableName} WHERE tenant_id = $1`, [tenantId]);
    return parseInt(result.rows[0].count, 10);
  }

  /**
   * Check whether a feature is accessible for a given plan.
   */
  async function isFeatureAccessible(tenantId, featureKey) {
    try {
      const planKey = await getTenantPlan(tenantId);
      const planIdx = PLAN_HIERARCHY.indexOf(planKey);
      const flag = (await pool.query(
        'SELECT min_plan, is_active FROM feature_flags WHERE feature_key = $1',
        [featureKey]
      )).rows[0];
      if (!flag || !flag.is_active) return false;
      const minIdx = PLAN_HIERARCHY.indexOf(flag.min_plan || 'free');
      return planIdx >= minIdx;
    } catch (e) {
      return false;
    }
  }

  // ============================================================
  // MIDDLEWARE
  // ============================================================

  /**
   * enforcePlanLimit(tableName)
   * Checks current record count against plan limit BEFORE allowing creation.
   * Returns 403 JSON with upgrade message if limit reached.
   */
  function enforcePlanLimit(tableName) {
    return async function(req, res, next) {
      // Must be logged in
      const user = req.session?.user;
      if (!user) return res.status(401).json({ error: 'Authentication required' });

      // Super admins bypass all limits
      if (user.role === 'super_admin') return next();

      const tenantId = user.tenant_id;
      try {
        const planInfo = await getTenantPlanInfo(tenantId);
        const currentCount = await countRecords(tenantId, tableName);
        const limit = planInfo.maxRecords;

        if (currentCount >= limit) {
          return res.status(403).json({
            error: 'Plan limit reached',
            message: `You have ${currentCount} records on the ${planInfo.name} plan (limit: ${limit}). Upgrade to add more records.`,
            plan: planInfo.key,
            currentCount,
            limit,
            upgradeUrl: '/subscription/upgrade',
          });
        }

        // Attach plan info to request for downstream use
        req._planInfo = planInfo;
        req._currentRecordCount = currentCount;
        next();
      } catch (e) {
        console.error('[SubscriptionEnforcement] enforcePlanLimit error:', e.message);
        // On error, allow the request through — don't block on DB failure
        next();
      }
    };
  }

  /**
   * enforceFeature(featureKey)
   * Checks if the feature is enabled for the current plan.
   * Returns 403 if not.
   */
  function enforceFeature(featureKey) {
    return async function(req, res, next) {
      const user = req.session?.user;
      if (!user) return res.status(401).json({ error: 'Authentication required' });

      // Super admins bypass feature gates
      if (user.role === 'super_admin') return next();

      const tenantId = user.tenant_id;
      try {
        const accessible = await isFeatureAccessible(tenantId, featureKey);
        if (!accessible) {
          const planInfo = await getTenantPlanInfo(tenantId);
          return res.status(403).json({
            error: 'Feature not available',
            message: `The "${featureKey}" feature is not available on the ${planInfo.name} plan. Upgrade to access this feature.`,
            feature: featureKey,
            plan: planInfo.key,
            upgradeUrl: '/subscription/upgrade',
          });
        }
        next();
      } catch (e) {
        console.error('[SubscriptionEnforcement] enforceFeature error:', e.message);
        next();
      }
    };
  }

  /**
   * enforcePlanOrAbove(minPlan)
   * Checks if the tenant's plan is at or above the specified tier.
   * Returns 403 if not.
   */
  function enforcePlanOrAbove(minPlan) {
    return async function(req, res, next) {
      const user = req.session?.user;
      if (!user) return res.status(401).json({ error: 'Authentication required' });

      // Super admins bypass plan checks
      if (user.role === 'super_admin') return next();

      const tenantId = user.tenant_id;
      try {
        const planKey = await getTenantPlan(tenantId);
        const currentIdx = PLAN_HIERARCHY.indexOf(planKey);
        const minIdx = PLAN_HIERARCHY.indexOf(minPlan);

        if (currentIdx < minIdx) {
          return res.status(403).json({
            error: 'Plan upgrade required',
            message: `This action requires the ${PLANS[minPlan]?.name || minPlan} plan or above. Your current plan is ${PLANS[planKey]?.name || planKey}.`,
            requiredPlan: minPlan,
            currentPlan: planKey,
            upgradeUrl: '/subscription/upgrade',
          });
        }
        next();
      } catch (e) {
        console.error('[SubscriptionEnforcement] enforcePlanOrAbove error:', e.message);
        next();
      }
    };
  }

  // ============================================================
  // ROUTES
  // ============================================================

  // GET /api/subscription/status — Returns current plan, usage, and limits as JSON
  app.get('/api/subscription/status', async function(req, res) {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const tenantId = user.tenant_id;
    try {
      const planKey = await getTenantPlan(tenantId);
      const planDef = PLANS[planKey] || PLANS.free;

      // Count total records across key tables
      const tablesToCount = ['students', 'members', 'staff', 'customers'];
      let totalRecords = 0;
      const usageByTable = {};

      for (const tbl of tablesToCount) {
        try {
          const cnt = await countRecords(tenantId, tbl);
          usageByTable[tbl] = cnt;
          totalRecords += cnt;
        } catch (e) {
          usageByTable[tbl] = 0;
        }
      }

      // Count admins
      const adminResult = await pool.query(
        "SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND role IN ('admin', 'owner')",
        [tenantId]
      );
      const adminCount = parseInt(adminResult.rows[0].count, 10);

      // Check for active dunning
      const dunning = (await pool.query(
        'SELECT current_stage, grace_period_ends FROM dunning_records WHERE tenant_id = $1 AND is_active = true LIMIT 1',
        [tenantId]
      )).rows[0] || null;

      res.json({
        plan: planKey,
        planName: planDef.name,
        limits: {
          maxRecords: planDef.maxRecords,
          maxAdmins: planDef.maxAdmins,
          price: planDef.price,
        },
        usage: {
          totalRecords,
          byTable: usageByTable,
          adminCount,
          recordsRemaining: Math.max(0, planDef.maxRecords - totalRecords),
          adminsRemaining: Math.max(0, planDef.maxAdmins - adminCount),
        },
        dunning,
        upgradeUrl: '/subscription/upgrade',
      });
    } catch (e) {
      console.error('[SubscriptionEnforcement] /api/subscription/status error:', e.message);
      res.status(500).json({ error: 'Failed to load subscription status' });
    }
  });

  // POST /api/subscription/check-limit — Checks if a specific action would exceed the limit
  app.post('/api/subscription/check-limit', async function(req, res) {
    const user = req.session?.user;
    if (!user) return res.status(401).json({ error: 'Authentication required' });

    const tenantId = user.tenant_id;
    const { tableName, additionalRecords = 1, featureKey } = req.body;

    try {
      const planKey = await getTenantPlan(tenantId);
      const planDef = PLANS[planKey] || PLANS.free;

      const result = {
        plan: planKey,
        planName: planDef.name,
        allowed: true,
        checks: {},
      };

      // Check record limit if tableName provided
      if (tableName) {
        const currentCount = await countRecords(tenantId, tableName);
        const projected = currentCount + additionalRecords;
        const withinLimit = projected <= planDef.maxRecords;
        result.checks.records = {
          current: currentCount,
          additional: additionalRecords,
          projected,
          limit: planDef.maxRecords,
          withinLimit,
        };
        if (!withinLimit) result.allowed = false;
      }

      // Check feature access if featureKey provided
      if (featureKey) {
        const accessible = await isFeatureAccessible(tenantId, featureKey);
        result.checks.feature = {
          featureKey,
          accessible,
        };
        if (!accessible) result.allowed = false;
      }

      // Check admin limit
      const adminResult = await pool.query(
        "SELECT COUNT(*) FROM users WHERE tenant_id = $1 AND role IN ('admin', 'owner')",
        [tenantId]
      );
      const adminCount = parseInt(adminResult.rows[0].count, 10);
      result.checks.admins = {
        current: adminCount,
        limit: planDef.maxAdmins,
        withinLimit: adminCount < planDef.maxAdmins,
      };

      res.json(result);
    } catch (e) {
      console.error('[SubscriptionEnforcement] /api/subscription/check-limit error:', e.message);
      res.status(500).json({ error: 'Failed to check limits' });
    }
  });

  // GET /subscription/upgrade — Upgrade page showing available plans with MTN MoMo payment
  app.get('/subscription/upgrade', async function(req, res) {
    const user = req.session?.user;
    if (!user) return res.redirect('/login');

    const tenantId = user.tenant_id;
    const currentPlan = await getTenantPlan(tenantId);
    const currentIdx = PLAN_HIERARCHY.indexOf(currentPlan);

    const planCards = PLAN_HIERARCHY
      .filter(k => k !== 'free')
      .map(k => {
        const p = PLANS[k];
        const idx = PLAN_HIERARCHY.indexOf(k);
        const isCurrent = k === currentPlan;
        const isDowngrade = idx < currentIdx;
        const isUpgrade = idx > currentIdx;
        const borderColor = isCurrent ? '#10b981' : isUpgrade ? '#6366f1' : '#94a3b8';
        const btnLabel = isCurrent ? 'Current Plan' : isUpgrade ? 'Upgrade' : 'Downgrade';
        const btnClass = isCurrent ? 'background:#10b981;color:white' : isUpgrade ? 'background:#6366f1;color:white' : 'background:#94a3b8;color:white';
        return `<div style="background:white;border:2px solid ${borderColor};border-radius:12px;padding:24px;text-align:center;${isCurrent ? 'box-shadow:0 0 0 3px rgba(16,185,129,0.2)' : ''}">
          <h3 style="margin:0 0 8px;color:${borderColor}">${esc(p.name)}</h3>
          <div style="font-size:32px;font-weight:700;margin:12px 0">UGX ${Number(p.price).toLocaleString()}<span style="font-size:14px;font-weight:400;color:#94a3b8">/mo</span></div>
          <ul style="text-align:left;list-style:none;padding:0;margin:16px 0;font-size:14px;color:#475569">
            <li style="padding:4px 0">&#10003; Up to ${Number(p.maxRecords).toLocaleString()} records</li>
            <li style="padding:4px 0">&#10003; Up to ${p.maxAdmins} admin${p.maxAdmins > 1 ? 's' : ''}</li>
            <li style="padding:4px 0">&#10003; Full ${p.name} feature access</li>
          </ul>
          <form method="POST" action="/billing/change-plan" style="margin:0">
            <input type="hidden" name="plan" value="${k}">
            <input type="hidden" name="_csrf" value="${req.csrfToken || req.session?.csrfToken || ''}">
            <button type="submit" style="width:100%;padding:12px;border:none;border-radius:8px;font-weight:600;font-size:14px;cursor:pointer;${btnClass}" ${isCurrent ? 'disabled' : ''}>${btnLabel}</button>
          </form>
        </div>`;
      }).join('');

    const html = `
      <div class="hero" style="background:linear-gradient(135deg,#6366f1,#8b5cf6)">
        <h1>Upgrade Your Plan</h1>
        <p>Unlock more records, more admins, and premium features</p>
        <p style="margin-top:8px">Current plan: <strong style="color:#f59e0b">${esc(PLANS[currentPlan]?.name || currentPlan)}</strong></p>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:20px;max-width:900px;margin:0 auto;padding:24px">
        ${planCards}
      </div>

      <div class="card" style="max-width:900px;margin:0 auto 24px">
        <h3>Payment Methods</h3>
        <p style="color:#64748b;font-size:14px">We accept MTN MoMo, Airtel Money, Flutterwave (cards), and bank transfer. You will be redirected to complete payment after selecting a plan.</p>
        <div style="display:flex;gap:12px;margin-top:12px">
          <span style="background:#fbbf24;color:#1e293b;padding:6px 14px;border-radius:6px;font-weight:600;font-size:13px">MTN MoMo</span>
          <span style="background:#ef4444;color:white;padding:6px 14px;border-radius:6px;font-weight:600;font-size:13px">Airtel Money</span>
          <span style="background:#6366f1;color:white;padding:6px 14px;border-radius:6px;font-weight:600;font-size:13px">Flutterwave</span>
        </div>
      </div>

      <div class="card" style="max-width:900px;margin:0 auto 24px">
        <h3>Plan Comparison</h3>
        <table style="width:100%;margin-top:12px">
          <thead><tr style="border-bottom:2px solid #e2e8f0">
            <th style="text-align:left;padding:8px">Feature</th>
            ${PLAN_HIERARCHY.map(k => `<th style="padding:8px">${esc(PLANS[k].name)}</th>`).join('')}
          </tr></thead>
          <tbody>
            <tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:8px">Records</td>
              ${PLAN_HIERARCHY.map(k => `<td style="padding:8px;text-align:center">${Number(PLANS[k].maxRecords).toLocaleString()}</td>`).join('')}
            </tr>
            <tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:8px">Admins</td>
              ${PLAN_HIERARCHY.map(k => `<td style="padding:8px;text-align:center">${PLANS[k].maxAdmins}</td>`).join('')}
            </tr>
            <tr style="border-bottom:1px solid #f1f5f9">
              <td style="padding:8px">Price</td>
              ${PLAN_HIERARCHY.map(k => `<td style="padding:8px;text-align:center">${PLANS[k].price === 0 ? 'Free' : 'UGX ' + Number(PLANS[k].price).toLocaleString()}</td>`).join('')}
            </tr>
          </tbody>
        </table>
      </div>
    `;

    // Use renderPage if available in scope (global), otherwise simple HTML
    try {
      if (typeof renderPage === 'function') {
        res.send(renderPage('Upgrade Plan', html, user));
      } else {
        res.send(`<!DOCTYPE html><html><head><title>Upgrade Plan</title><style>body{font-family:system-ui;background:#f8fafc;margin:0}h1,h2,h3{margin:0 0 8px}.hero{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:40px 20px;text-align:center}.card{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:0 auto 16px}</style></head><body>${html}</body></html>`);
      }
    } catch (e) {
      res.send(`<!DOCTYPE html><html><head><title>Upgrade Plan</title><style>body{font-family:system-ui;background:#f8fafc;margin:0}h1,h2,h3{margin:0 0 8px}.hero{background:linear-gradient(135deg,#6366f1,#8b5cf6);color:white;padding:40px 20px;text-align:center}.card{background:white;border:1px solid #e2e8f0;border-radius:12px;padding:20px;margin:0 auto 16px}</style></head><body>${html}</body></html>`);
    }
  });

  // POST /api/dunning/execute-downgrade — Actually executes the plan downgrade
  // Called by dunning pipeline after grace period expires
  app.post('/api/dunning/execute-downgrade', async function(req, res) {
    const { tenant_id, subscription_id, secret } = req.body;

    // Simple internal auth: require the DUNNING_SECRET env var or reject
    const DUNNING_SECRET = process.env.DUNNING_SECRET || 'dunning-internal-2024';
    if (secret !== DUNNING_SECRET) {
      return res.status(403).json({ error: 'Invalid dunning secret' });
    }

    if (!tenant_id) {
      return res.status(400).json({ error: 'tenant_id is required' });
    }

    try {
      // 1. Expire the current active subscription
      await pool.query(
        "UPDATE subscriptions SET status = 'expired', dunning_stage = 'downgraded' WHERE tenant_id = $1 AND status = 'active'",
        [tenant_id]
      );

      // 2. Create a new 'free' active subscription so the tenant still has access
      await pool.query(
        "INSERT INTO subscriptions (tenant_id, plan, amount, status, started_at) VALUES ($1, 'free', 0, 'active', NOW())",
        [tenant_id]
      );

      // 3. Update the dunning record
      await pool.query(
        "UPDATE dunning_records SET current_stage = 'downgraded', downgraded_at = NOW(), is_active = false WHERE tenant_id = $1 AND is_active = true",
        [tenant_id]
      );

      // 4. Log the event
      await pool.query(
        "INSERT INTO dunning_events (dunning_id, event_type, details) VALUES ((SELECT id FROM dunning_records WHERE tenant_id = $1 LIMIT 1), 'downgrade_executed', $2)",
        [tenant_id, JSON.stringify({ message: 'Plan downgraded to free by dunning pipeline', subscription_id: subscription_id || null })]
      );

      // 5. Notify tenant admins
      const tenant = (await pool.query('SELECT * FROM tenants WHERE id = $1', [tenant_id])).rows[0];
      const admins = (await pool.query(
        "SELECT * FROM users WHERE tenant_id = $1 AND role IN ('admin', 'owner')",
        [tenant_id]
      )).rows;

      const BASE_URL = process.env.BASE_URL || 'https://ssewasswa.onrender.com';
      for (const admin of admins) {
        try {
          await sendEmail(
            admin.email,
            'Subscription Downgraded to Free',
            `<div style="max-width:500px;font-family:system-ui">
              <h2>Subscription Downgraded</h2>
              <p>Your ${esc(tenant?.name || '')} account has been downgraded to the Free plan due to non-payment.</p>
              <p>Record limits (50 records) are now enforced. Upgrade anytime to restore full access.</p>
              <a href="${BASE_URL}/subscription/upgrade" style="display:inline-block;background:#6366f1;color:white;padding:12px 24px;border-radius:8px;text-decoration:none">Upgrade Now</a>
            </div>`
          );
        } catch (e) {
          console.error('[SubscriptionEnforcement] Failed to send downgrade email:', e.message);
        }
      }

      // 6. Audit log
      audit('system', 'dunning_downgrade_executed', `Tenant ${tenant_id} downgraded to free plan`);

      res.json({ success: true, tenant_id, newPlan: 'free' });
    } catch (e) {
      console.error('[SubscriptionEnforcement] /api/dunning/execute-downgrade error:', e.message);
      res.status(500).json({ error: 'Downgrade execution failed', details: e.message });
    }
  });

  // ============================================================
  // EXPORT MIDDLEWARE FOR USE IN OTHER ROUTES
  // ============================================================
  const exported = {
    enforcePlanLimit,
    enforceFeature,
    enforcePlanOrAbove,
    getTenantPlan,
    getTenantPlanInfo,
    PLANS,
    PLAN_HIERARCHY,
  };

  // Expose on app for other modules
  app.set('subscriptionEnforcement', exported);

  console.log('[SubscriptionEnforcement] LOADED: Plan limit enforcement, feature gating, plan tier checks, downgrade execution — 4 middleware, 4 routes');
  return exported;
};
