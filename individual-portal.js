/**
 * Comfort Platform — Individual Portal Extension (35 Features)
 * Module: individual-portal.js
 * Mounts on: (app, pool, renderPage, esc)
 * All routes under /individual/* and /portal/individual with requireAuth
 * Theme: Pink/Magenta (#ec4899)
 */

const { migrateQuery } = require('./db');
module.exports = function(app, pool, renderPage, esc) {

// ============================================================
// AUTH MIDDLEWARE
// ============================================================
const ipAuth = (req, res, next) => {
  if (!req.session.user) return res.redirect('/login');
  next();
};
const ah = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(e => { console.error('[IP] Error:', e.message); res.status(500).send('Error: ' + esc(e.message)); });

// ============================================================
// SUBSCRIPTION-BASED FEATURE GATING
// ============================================================
const PLAN_HIERARCHY = ['free', 'basic', 'pro', 'enterprise'];

const INDIVIDUAL_FEATURE_MAP = {
  // GROUP 1: Personal Finance & Wealth Management
  'individual.investments':      { minPlan: 'basic',  group: 'Finance',  name: 'Investment Portfolio',  icon: '📈' },
  'individual.savings':          { minPlan: 'basic',  group: 'Finance',  name: 'Savings Goals',         icon: '🏦' },
  'individual.loans':            { minPlan: 'basic',  group: 'Finance',  name: 'Loan Tracker',          icon: '💳' },
  'individual.expenses':         { minPlan: 'free',   group: 'Finance',  name: 'Expense Tracker',       icon: '📉' },
  'individual.networth':         { minPlan: 'pro',    group: 'Finance',  name: 'Net Worth Calculator',  icon: '💎' },
  'individual.recurring':        { minPlan: 'basic',  group: 'Finance',  name: 'Recurring Transactions',icon: '🔄' },
  'individual.finance-report':   { minPlan: 'pro',    group: 'Finance',  name: 'Financial Reports',     icon: '📊' },
  'individual.currency':         { minPlan: 'free',   group: 'Finance',  name: 'Currency Converter',    icon: '💱' },
  // GROUP 2: Personal Productivity & Time Management
  'individual.habits':           { minPlan: 'free',   group: 'Productivity', name: 'Habit Tracker',     icon: '🔄' },
  'individual.tasks':            { minPlan: 'free',   group: 'Productivity', name: 'Task Manager',      icon: '✅' },
  'individual.timelog':          { minPlan: 'basic',  group: 'Productivity', name: 'Time Logger',       icon: '⏱️' },
  'individual.pomodoro':         { minPlan: 'basic',  group: 'Productivity', name: 'Pomodoro Timer',    icon: '🍅' },
  'individual.calendar':         { minPlan: 'free',   group: 'Productivity', name: 'Calendar & Events', icon: '📅' },
  'individual.journal':          { minPlan: 'free',   group: 'Productivity', name: 'Daily Journal',     icon: '📔' },
  'individual.focus':            { minPlan: 'pro',    group: 'Productivity', name: 'Focus Mode',        icon: '🎯' },
  // GROUP 3: Health & Wellness
  'individual.health':           { minPlan: 'basic',  group: 'Health',   name: 'Health Metrics',        icon: '❤️' },
  'individual.medications':      { minPlan: 'pro',    group: 'Health',   name: 'Medication Tracker',    icon: '💊' },
  'individual.workouts':         { minPlan: 'basic',  group: 'Health',   name: 'Workout Logger',        icon: '🏋️' },
  'individual.water':            { minPlan: 'free',   group: 'Health',   name: 'Water Intake',          icon: '💧' },
  'individual.sleep':            { minPlan: 'basic',  group: 'Health',   name: 'Sleep Tracker',         icon: '😴' },
  'individual.wellness':         { minPlan: 'pro',    group: 'Health',   name: 'Mental Wellness',       icon: '🧘' },
  // GROUP 4: Personal Knowledge & Learning
  'individual.books':            { minPlan: 'free',   group: 'Knowledge', name: 'Book Library',         icon: '📚' },
  'individual.skills':           { minPlan: 'basic',  group: 'Knowledge', name: 'Skill Tracker',        icon: '🎯' },
  'individual.courses':          { minPlan: 'pro',    group: 'Knowledge', name: 'Course Tracker',        icon: '🎓' },
  'individual.bookmarks':        { minPlan: 'basic',  group: 'Knowledge', name: 'Bookmark Manager',     icon: '🔖' },
  'individual.flashcards':       { minPlan: 'pro',    group: 'Knowledge', name: 'Flashcards',           icon: '🃏' },
  'individual.contacts':         { minPlan: 'free',   group: 'Knowledge', name: 'Contact Book',         icon: '👤' },
  'individual.wiki':             { minPlan: 'pro',    group: 'Knowledge', name: 'Personal Wiki',        icon: '📝' },
  // GROUP 5: Lifestyle & Social
  'individual.travel':           { minPlan: 'pro',    group: 'Lifestyle', name: 'Travel Planner',       icon: '✈️' },
  'individual.recipes':          { minPlan: 'pro',    group: 'Lifestyle', name: 'Recipe Book',          icon: '🍳' },
  'individual.wishlist':         { minPlan: 'basic',  group: 'Lifestyle', name: 'Wishlist',             icon: '🎁' },
  'individual.subscriptions':    { minPlan: 'basic',  group: 'Lifestyle', name: 'Subscription Manager',  icon: '📺' },
  'individual.gifts':            { minPlan: 'pro',    group: 'Lifestyle', name: 'Gift Tracker',         icon: '🎀' },
  'individual.bucketlist':       { minPlan: 'free',   group: 'Lifestyle', name: 'Bucket List',          icon: '🏆' },
  'individual.qrcode':           { minPlan: 'free',   group: 'Lifestyle', name: 'QR Code Generator',    icon: '📱' },
};

// Cache tenant plans in memory for 5 minutes
const planCache = new Map();
const PLAN_CACHE_TTL = 5 * 60 * 1000;

const getTenantPlan = async (tenantId) => {
  const cached = planCache.get(tenantId);
  if (cached && Date.now() - cached.ts < PLAN_CACHE_TTL) return cached.plan;
  try {
    const r = await pool.query('SELECT plan FROM subscriptions WHERE tenant_id=$1 AND status=\'active\' ORDER BY created_at DESC LIMIT 1', [tenantId]);
    const plan = r.rows[0]?.plan || 'free';
    // Normalize 'professional' -> 'pro' for consistency
    const normalized = plan === 'professional' ? 'pro' : plan;
    planCache.set(tenantId, { plan: normalized, ts: Date.now() });
    return normalized;
  } catch(e) { return 'free'; }
};

const planLevel = (plan) => PLAN_HIERARCHY.indexOf(plan === 'professional' ? 'pro' : plan);
const hasAccess = (userPlan, requiredPlan) => planLevel(userPlan) >= planLevel(requiredPlan);

// Feature gate middleware — checks if user's plan allows access to a feature
const requireFeaturePlan = (featureKey) => {
  const feature = INDIVIDUAL_FEATURE_MAP[featureKey];
  if (!feature) return (req, res, next) => next(); // Unknown feature = allow
  return async (req, res, next) => {
    if (!req.session.user) return res.redirect('/login');
    // Super admins bypass all gates
    if (req.session.user.role === 'super_admin') return next();
    const plan = await getTenantPlan(req.session.user.tenant_id);
    if (hasAccess(plan, feature.minPlan)) return next();
    // Blocked — show upgrade page
    const nextPlan = PLAN_HIERARCHY[planLevel(feature.minPlan)];
    const planPrices = { free: 0, basic: 50000, pro: 150000, enterprise: 500000 };
    const planNames = { free: 'Free', basic: 'Basic', pro: 'Professional', enterprise: 'Enterprise' };
    res.status(403).send(renderPage('Upgrade Required', `
      <div style="max-width:500px;margin:60px auto;text-align:center">
        <div style="font-size:64px;margin-bottom:16px">🔒</div>
        <h1 style="font-size:24px;color:#1e293b;margin-bottom:8px">${feature.icon} ${esc(feature.name)}</h1>
        <p style="color:#64748b;font-size:16px;margin-bottom:24px">This feature requires the <strong style="color:#ec4899">${planNames[nextPlan] || nextPlan}</strong> plan or higher.</p>
        <div style="background:#fff1f2;border:1px solid #fecdd3;border-radius:14px;padding:20px;margin-bottom:24px">
          <p style="color:#9f1239;font-size:14px;margin-bottom:4px">Your current plan</p>
          <p style="font-size:20px;font-weight:800;color:#be185d">${planNames[plan] || plan}</p>
          ${planPrices[plan] ? `<p style="color:#64748b;font-size:13px">UGX ${planPrices[plan].toLocaleString()}/month</p>` : ''}
        </div>
        <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:14px;padding:20px;margin-bottom:24px">
          <p style="color:#166534;font-size:14px;margin-bottom:4px">Upgrade to</p>
          <p style="font-size:20px;font-weight:800;color:#059669">${planNames[nextPlan] || nextPlan}</p>
          ${planPrices[nextPlan] ? `<p style="color:#166534;font-size:13px">UGX ${planPrices[nextPlan].toLocaleString()}/month</p>` : ''}
        </div>
        <a href="/billing" class="ip-btn ip-btn-primary" style="font-size:16px;padding:14px 32px">Upgrade Now</a>
        <a href="/portal/individual" class="ip-btn ip-btn-secondary" style="margin-top:8px">Back to Dashboard</a>
      </div>
    `, req.session.user));
  };
};

// Helper: get feature list with access status for a given plan
const getFeatureAccessList = (plan) => {
  return Object.entries(INDIVIDUAL_FEATURE_MAP).map(([key, f]) => ({
    key, ...f, locked: !hasAccess(plan, f.minPlan)
  }));
};

// ============================================================
// MIGRATIONS — All 38 tables
// ============================================================
(async () => {
  try {
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_investments (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, type TEXT, buy_price NUMERIC(15,2), current_value NUMERIC(15,2), quantity NUMERIC(15,4), purchase_date DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_savings_goals (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, target_amount NUMERIC(15,2), current_amount NUMERIC(15,2) DEFAULT 0, deadline DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_savings_deposits (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, goal_id INTEGER REFERENCES ind_savings_goals(id) ON DELETE CASCADE, amount NUMERIC(15,2), note TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_loans (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, lender TEXT, principal NUMERIC(15,2), interest_rate NUMERIC(5,2), outstanding NUMERIC(15,2), emi_amount NUMERIC(15,2), start_date DATE, end_date DATE, status TEXT DEFAULT 'active', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_loan_payments (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, loan_id INTEGER REFERENCES ind_loans(id) ON DELETE CASCADE, amount NUMERIC(15,2), payment_date DATE DEFAULT CURRENT_DATE, note TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_expenses (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, category TEXT, amount NUMERIC(15,2), description TEXT, expense_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_networth_snapshots (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, total_assets NUMERIC(15,2), total_liabilities NUMERIC(15,2), net_worth NUMERIC(15,2), notes TEXT, snapshot_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_recurring_txns (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, amount NUMERIC(15,2), type TEXT DEFAULT 'expense', category TEXT, frequency TEXT DEFAULT 'monthly', next_due DATE, is_active BOOLEAN DEFAULT true, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_habits (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, frequency TEXT DEFAULT 'daily', color TEXT DEFAULT '#ec4899', target_count INTEGER DEFAULT 1, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_habit_checkins (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, habit_id INTEGER REFERENCES ind_habits(id) ON DELETE CASCADE, checkin_date DATE DEFAULT CURRENT_DATE, note TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(habit_id, checkin_date))`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_tasks (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, title TEXT NOT NULL, description TEXT, status TEXT DEFAULT 'todo', priority TEXT DEFAULT 'medium', due_date DATE, category TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_time_logs (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, project TEXT, activity TEXT, start_time TIMESTAMPTZ, end_time TIMESTAMPTZ, duration_minutes INTEGER, note TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_pomodoro_sessions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, task TEXT, duration_minutes INTEGER DEFAULT 25, type TEXT DEFAULT 'focus', started_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_calendar_events (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, title TEXT NOT NULL, description TEXT, event_date DATE, event_time TIME, category TEXT DEFAULT 'personal', location TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_journal_entries (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, title TEXT, content TEXT, mood TEXT, tags TEXT, entry_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_focus_sessions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, goal TEXT, started_at TIMESTAMPTZ DEFAULT NOW(), ended_at TIMESTAMPTZ, duration_minutes INTEGER, completed BOOLEAN DEFAULT false, note TEXT)`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_health_metrics (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, metric_type TEXT, value NUMERIC(10,2), unit TEXT, recorded_date DATE DEFAULT CURRENT_DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_medications (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, dosage TEXT, frequency TEXT, start_date DATE, end_date DATE, is_active BOOLEAN DEFAULT true, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_medication_log (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, medication_id INTEGER REFERENCES ind_medications(id) ON DELETE CASCADE, taken_at TIMESTAMPTZ DEFAULT NOW(), status TEXT DEFAULT 'taken')`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_workouts (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, type TEXT, duration_minutes INTEGER, calories INTEGER, sets INTEGER, reps INTEGER, notes TEXT, workout_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_water_intake (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, glasses INTEGER DEFAULT 0, intake_date DATE DEFAULT CURRENT_DATE, goal INTEGER DEFAULT 8, created_at TIMESTAMPTZ DEFAULT NOW(), UNIQUE(tenant_id, user_email, intake_date))`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_sleep_log (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, bedtime TIME, wake_time TIME, quality INTEGER DEFAULT 5, notes TEXT, sleep_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_wellness_checkins (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, mood TEXT, stress_level INTEGER DEFAULT 5, gratitude TEXT, energy_level INTEGER DEFAULT 5, checkin_date DATE DEFAULT CURRENT_DATE, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_books (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, title TEXT NOT NULL, author TEXT, genre TEXT, status TEXT DEFAULT 'want', rating INTEGER, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_skills (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, category TEXT, level TEXT DEFAULT 'beginner', progress INTEGER DEFAULT 0, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_courses (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, title TEXT NOT NULL, provider TEXT, category TEXT, progress INTEGER DEFAULT 0, status TEXT DEFAULT 'in_progress', certificate TEXT, deadline DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_bookmarks (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, title TEXT NOT NULL, url TEXT, category TEXT, tags TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_flashcard_decks (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, description TEXT, category TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_flashcards (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, deck_id INTEGER REFERENCES ind_flashcard_decks(id) ON DELETE CASCADE, front TEXT NOT NULL, back TEXT NOT NULL, last_studied TIMESTAMPTZ, confidence INTEGER DEFAULT 0, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_contacts (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, phone TEXT, email TEXT, company TEXT, category TEXT, address TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_wiki_pages (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, title TEXT NOT NULL, content TEXT, category TEXT, parent_id INTEGER REFERENCES ind_wiki_pages(id), created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_trips (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, destination TEXT, start_date DATE, end_date DATE, budget NUMERIC(15,2), status TEXT DEFAULT 'planning', notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_trip_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, trip_id INTEGER REFERENCES ind_trips(id) ON DELETE CASCADE, item_type TEXT, name TEXT, date DATE, time TIME, cost NUMERIC(15,2), notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_recipes (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, title TEXT NOT NULL, ingredients TEXT, steps TEXT, cook_time INTEGER, servings INTEGER, category TEXT, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_wishlist_items (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, estimated_cost NUMERIC(15,2), priority TEXT DEFAULT 'medium', url TEXT, purchased BOOLEAN DEFAULT false, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_subscriptions (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, cost NUMERIC(15,2), billing_cycle TEXT DEFAULT 'monthly', next_billing DATE, category TEXT, is_active BOOLEAN DEFAULT true, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_gifts (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, recipient TEXT, occasion TEXT, direction TEXT DEFAULT 'given', cost NUMERIC(15,2), date_given DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    await migrateQuery(pool, 'IndividualPortal', `CREATE TABLE IF NOT EXISTS ind_bucket_list (id SERIAL PRIMARY KEY, tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE, user_email TEXT NOT NULL, name TEXT NOT NULL, category TEXT DEFAULT 'personal', completed BOOLEAN DEFAULT false, completed_at DATE, notes TEXT, created_at TIMESTAMPTZ DEFAULT NOW())`);
    console.log('[IndividualPortal] All 38 tables migrated successfully');
  } catch(e) { console.error('[IndividualPortal] Migration error:', e.message); }
})();

// ============================================================
// SHARED CSS & NAVIGATION
// ============================================================
const ipCSS = `<style>
.ip-nav{display:flex;gap:8px;margin-bottom:20px;flex-wrap:wrap}
.ip-nav a{padding:8px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;color:#475569;background:#f1f5f9;transition:.15s}
.ip-nav a:hover{background:#e2e8f0}
.ip-nav a.active{background:#ec4899;color:#fff}
.ip-btn{display:inline-flex;align-items:center;gap:6px;padding:9px 18px;border:none;border-radius:10px;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:.15s}
.ip-btn-primary{background:#ec4899;color:#fff}
.ip-btn-success{background:#059669;color:#fff}
.ip-btn-danger{background:#fee2e2;color:#dc2626}
.ip-btn-secondary{background:#f1f5f9;color:#475569}
.ip-btn:hover{opacity:.85}
.ip-card{background:#fff;border-radius:14px;border:1px solid #f1f5f9;padding:20px;margin-bottom:16px}
.ip-table{width:100%;border-collapse:collapse;font-size:13px}
.ip-table th{padding:11px 14px;text-align:left;border-bottom:2px solid #e2e8f0;color:#64748b;font-weight:700;font-size:11px;text-transform:uppercase}
.ip-table td{padding:10px 14px;border-bottom:1px solid #f1f5f9;color:#1e293b}
.ip-form input,.ip-form select,.ip-form textarea{width:100%;padding:10px 14px;border:1px solid #e2e8f0;border-radius:10px;font-size:14px;margin-bottom:12px;box-sizing:border-box}
.ip-form label{display:block;font-size:13px;font-weight:600;color:#475569;margin-bottom:4px}
.ip-stat{text-align:center;padding:16px;background:#f8fafc;border-radius:12px}
.ip-stat .num{font-size:28px;font-weight:800;color:#ec4899}
.ip-stat .lbl{font-size:11px;color:#64748b;text-transform:uppercase;font-weight:600;margin-top:2px}
.ip-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:16px}
.ip-badge{display:inline-block;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600}
.ip-badge-pink{background:#fce7f3;color:#be185d}
.ip-badge-green{background:#dcfce7;color:#166534}
.ip-badge-blue{background:#dbeafe;color:#1e40af}
.ip-badge-yellow{background:#fef3c7;color:#92400e}
.ip-badge-gray{background:#f1f5f9;color:#475569}
.ip-progress{height:8px;background:#f1f5f9;border-radius:4px;overflow:hidden;margin-top:6px}
.ip-progress-bar{height:100%;background:linear-gradient(90deg,#ec4899,#f472b6);border-radius:4px;transition:width .3s}
.ip-empty{text-align:center;padding:40px;color:#94a3b8}
.ip-empty span{font-size:48px;display:block;margin-bottom:12px}
@media(max-width:768px){.ip-nav{gap:4px}.ip-nav a{padding:6px 12px;font-size:11px}.ip-grid{grid-template-columns:1fr}}
</style>`;

const ipNav = (active) => `<div class="ip-nav">
<a href="/portal/individual" class="${active==='dash'?'active':''}">Dashboard</a>
<a href="/individual/expenses" class="${active==='expenses'?'active':''}">Expenses</a>
<a href="/individual/habits" class="${active==='habits'?'active':''}">Habits</a>
<a href="/individual/tasks" class="${active==='tasks'?'active':''}">Tasks</a>
<a href="/individual/calendar" class="${active==='calendar'?'active':''}">Calendar</a>
<a href="/individual/journal" class="${active==='journal'?'active':''}">Journal</a>
<a href="/individual/health" class="${active==='health'?'active':''}">Health</a>
<a href="/individual/books" class="${active==='books'?'active':''}">Books</a>
<a href="/individual/contacts" class="${active==='contacts'?'active':''}">Contacts</a>
<a href="/individual/wishlist" class="${active==='wishlist'?'active':''}">Wishlist</a>
<a href="/individual/bucketlist" class="${active==='bucketlist'?'active':''}">Bucket List</a>
</div>`;

const tid = (req) => req.session.user.tenant_id;
const uem = (req) => req.session.user.email;


// ============================================================
// FEATURE 0: ENHANCED INDIVIDUAL DASHBOARD
// ============================================================
app.get('/portal/individual', ipAuth, ah(async (req, res) => {
  const t = tid(req), u = uem(req);
  const plan = await getTenantPlan(t);
  const planNames = { free: 'Free', basic: 'Basic', pro: 'Professional', enterprise: 'Enterprise' };
  const planPrices = { free: 0, basic: 50000, pro: 150000, enterprise: 500000 };
  const planColors = { free: '#94a3b8', basic: '#3b82f6', pro: '#ec4899', enterprise: '#f59e0b' };
  const features = getFeatureAccessList(plan);
  const unlocked = features.filter(f => !f.locked).length;
  const total = features.length;

  // Only query stats for unlocked features
  const statQueries = [];
  if (hasAccess(plan, 'basic')) statQueries.push(pool.query('SELECT COUNT(*) as c, COALESCE(SUM(current_value),0) as v FROM ind_investments WHERE tenant_id=$1 AND user_email=$2', [t, u]));
  else statQueries.push(Promise.resolve({rows:[{c:0,v:0}]}));
  if (hasAccess(plan, 'basic')) statQueries.push(pool.query('SELECT COUNT(*) as c, COALESCE(SUM(current_amount),0) as v FROM ind_savings_goals WHERE tenant_id=$1 AND user_email=$2', [t, u]));
  else statQueries.push(Promise.resolve({rows:[{c:0,v:0}]}));
  statQueries.push(pool.query('SELECT COUNT(*) as c, COALESCE(SUM(amount),0) as v FROM ind_expenses WHERE tenant_id=$1 AND user_email=$2', [t, u]));
  statQueries.push(pool.query('SELECT COUNT(*) as c FROM ind_habits WHERE tenant_id=$1 AND user_email=$2', [t, u]));
  const [inv, sav, exp, hab] = await Promise.all(statQueries);

  // Build feature sections with lock indicators
  const sec = (title, icon, groupFeatures) => {
    const items = groupFeatures.map(f => {
      if (f.locked) {
        const minPlan = f.minPlan;
        return `<a href="/billing" class="ip-btn ip-btn-secondary" style="font-size:12px;opacity:.6;border:1px dashed #cbd5e1;cursor:pointer" title="Requires ${planNames[minPlan]} plan">${f.icon} ${f.name} 🔒</a>`;
      }
      return `<a href="/individual/${f.key.replace('individual.','')}" class="ip-btn ip-btn-secondary" style="font-size:12px">${f.icon} ${f.name}</a>`;
    }).join('');
    return `<div class="ip-card"><h3 style="margin-bottom:12px">${icon} ${title}</h3><div style="display:flex;flex-wrap:wrap;gap:8px">${items}</div></div>`;
  };

  const financeFeatures = features.filter(f => f.group === 'Finance');
  const productivityFeatures = features.filter(f => f.group === 'Productivity');
  const healthFeatures = features.filter(f => f.group === 'Health');
  const knowledgeFeatures = features.filter(f => f.group === 'Knowledge');
  const lifestyleFeatures = features.filter(f => f.group === 'Lifestyle');

  res.send(renderPage('Individual Portal', `${ipCSS}${ipNav('dash')}
    <div style="text-align:center;margin-bottom:24px">
      <h1 style="font-size:24px;color:#ec4899">My Personal Hub</h1>
      <p style="color:#64748b">Your life, organized in one place</p>
      <div style="display:inline-flex;align-items:center;gap:8px;margin-top:8px;padding:6px 16px;background:${planColors[plan]||'#94a3b8'}20;border-radius:20px;border:1px solid ${planColors[plan]||'#94a3b8'}40">
        <span style="font-size:12px;font-weight:700;color:${planColors[plan]||'#94a3b8'}">${planNames[plan]||'Free'} Plan</span>
        <span style="font-size:11px;color:#64748b">${unlocked}/${total} features</span>
        ${plan !== 'enterprise' ? `<a href="/billing" style="font-size:11px;color:#ec4899;font-weight:600;text-decoration:none">Upgrade →</a>` : ''}
      </div>
    </div>
    <div class="ip-progress" style="max-width:400px;margin:0 auto 24px"><div class="ip-progress-bar" style="width:${Math.round(unlocked/total*100)}%"></div></div>
    ${hasAccess(plan, 'basic') ? `<div class="ip-grid" style="grid-template-columns:repeat(4,1fr);margin-bottom:24px">
      <div class="ip-stat"><div class="num">${inv.rows[0].v}</div><div class="lbl">Investments</div></div>
      <div class="ip-stat"><div class="num">${sav.rows[0].v}</div><div class="lbl">Savings</div></div>
      <div class="ip-stat"><div class="num">${exp.rows[0].v}</div><div class="lbl">Expenses</div></div>
      <div class="ip-stat"><div class="num">${hab.rows[0].c}</div><div class="lbl">Active Habits</div></div>
    </div>` : ''}
    ${sec('Finance','💰', financeFeatures)}
    ${sec('Productivity','⚡', productivityFeatures)}
    ${sec('Health','❤️', healthFeatures)}
    ${sec('Knowledge','📚', knowledgeFeatures)}
    ${sec('Lifestyle','🌟', lifestyleFeatures)}
  `, req.session.user));
}));

// ============================================================
// FEATURE 1: INVESTMENT PORTFOLIO
// ============================================================
app.get('/individual/investments', ipAuth, requireFeaturePlan('individual.investments'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_investments WHERE tenant_id=$1 AND user_email=$2 ORDER BY created_at DESC', [tid(req), uem(req)])).rows;
  const total = rows.reduce((s,r) => s + Number(r.current_value||0), 0);
  const cost = rows.reduce((s,r) => s + Number(r.buy_price||0) * Number(r.quantity||1), 0);
  const returns = cost > 0 ? ((total - cost) / cost * 100).toFixed(1) : 0;
  res.send(renderPage('Investments', `${ipCSS}${ipNav('invest')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Investment Portfolio</h2><a href="/individual/investments/new" class="ip-btn ip-btn-primary">+ Add Investment</a></div>
    <div class="ip-grid" style="grid-template-columns:repeat(3,1fr);margin-bottom:20px">
      <div class="ip-stat"><div class="num">${total.toLocaleString()}</div><div class="lbl">Total Value</div></div>
      <div class="ip-stat"><div class="num">${cost.toLocaleString()}</div><div class="lbl">Total Cost</div></div>
      <div class="ip-stat"><div class="num" style="color:${returns>=0?'#059669':'#dc2626'}">${returns}%</div><div class="lbl">Returns</div></div>
    </div>
    ${rows.length ? `<table class="ip-table"><tr><th>Name</th><th>Type</th><th>Buy Price</th><th>Current</th><th>Returns</th><th>Actions</th></tr>${rows.map(r=>{const ret=r.buy_price>0?((r.current_value-r.buy_price)/r.buy_price*100).toFixed(1):0;return `<tr><td><strong>${esc(r.name)}</strong></td><td><span class="ip-badge ip-badge-pink">${esc(r.type||'N/A')}</span></td><td>${Number(r.buy_price||0).toLocaleString()}</td><td>${Number(r.current_value||0).toLocaleString()}</td><td style="color:${ret>=0?'#059669':'#dc2626'};font-weight:600">${ret}%</td><td><a href="/individual/investments/${r.id}" class="ip-btn ip-btn-secondary" style="font-size:11px">View</a> <a href="/individual/investments/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Delete</a></td></tr>`}).join('')}</table>` : '<div class="ip-empty"><span>📈</span>No investments yet. Add your first investment!</div>'}
  `, req.session.user));
}));

app.get('/individual/investments/new', ipAuth, requireFeaturePlan('individual.investments'), (req, res) => {
  res.send(renderPage('Add Investment', `${ipCSS}${ipNav('invest')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Investment</h2>
    <form method="POST" action="/individual/investments" class="ip-form">
      <label>Name</label><input name="name" placeholder="e.g. MTN Uganda Shares" required>
      <label>Type</label><select name="type"><option value="stock">Stock</option><option value="bond">Bond</option><option value="mutual_fund">Mutual Fund</option><option value="crypto">Crypto</option><option value="real_estate">Real Estate</option><option value="other">Other</option></select>
      <label>Buy Price</label><input name="buy_price" type="number" step="0.01" placeholder="Purchase price per unit">
      <label>Current Value</label><input name="current_value" type="number" step="0.01" placeholder="Current market value">
      <label>Quantity</label><input name="quantity" type="number" step="0.0001" placeholder="Number of units">
      <label>Purchase Date</label><input name="purchase_date" type="date">
      <label>Notes</label><textarea name="notes" rows="3" placeholder="Optional notes"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save Investment</button>
      <a href="/individual/investments" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/investments', ipAuth, requireFeaturePlan('individual.investments'), ah(async (req, res) => {
  const {name, type, buy_price, current_value, quantity, purchase_date, notes} = req.body;
  await pool.query('INSERT INTO ind_investments(tenant_id,user_email,name,type,buy_price,current_value,quantity,purchase_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [tid(req),uem(req),name,type,buy_price||0,current_value||0,quantity||1,purchase_date||null,notes||'']);
  res.redirect('/individual/investments');
}));

app.get('/individual/investments/:id', ipAuth, requireFeaturePlan('individual.investments'), ah(async (req, res) => {
  const inv = (await pool.query('SELECT * FROM ind_investments WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)])).rows[0];
  if (!inv) return res.redirect('/individual/investments');
  const ret = inv.buy_price > 0 ? ((Number(inv.current_value) - Number(inv.buy_price)) / Number(inv.buy_price) * 100).toFixed(1) : 0;
  const gainLoss = Number(inv.current_value) - Number(inv.buy_price);
  res.send(renderPage('Investment Details', `${ipCSS}${ipNav('invest')}
    <div class="ip-card" style="max-width:600px;margin:0 auto"><h2>${esc(inv.name)}</h2>
    <div class="ip-grid" style="grid-template-columns:repeat(2,1fr);margin:16px 0">
      <div class="ip-stat"><div class="num" style="font-size:20px">${esc(inv.type||'N/A')}</div><div class="lbl">Type</div></div>
      <div class="ip-stat"><div class="num" style="font-size:20px">${Number(inv.quantity||1)}</div><div class="lbl">Quantity</div></div>
      <div class="ip-stat"><div class="num" style="font-size:20px">${Number(inv.buy_price||0).toLocaleString()}</div><div class="lbl">Buy Price</div></div>
      <div class="ip-stat"><div class="num" style="font-size:20px">${Number(inv.current_value||0).toLocaleString()}</div><div class="lbl">Current Value</div></div>
    </div>
    <div style="text-align:center;padding:16px;background:${gainLoss>=0?'#f0fdf4':'#fef2f2'};border-radius:12px;margin:12px 0">
      <p style="font-size:24px;font-weight:800;color:${gainLoss>=0?'#059669':'#dc2626'}">${gainLoss>=0?'+':''}${gainLoss.toLocaleString()} (${ret}%)</p>
      <p style="color:#64748b;font-size:13px">${gainLoss>=0?'Profit':'Loss'}</p>
    </div>
    ${inv.purchase_date?`<p style="color:#64748b;font-size:13px">Purchased: ${inv.purchase_date}</p>`:''}
    ${inv.notes?`<p style="color:#64748b;font-size:14px;margin-top:8px">${esc(inv.notes)}</p>`:''}
    <div style="margin-top:16px;display:flex;gap:8px"><a href="/individual/investments" class="ip-btn ip-btn-secondary">Back</a><a href="/individual/investments/${inv.id}/delete" class="ip-btn ip-btn-danger" onclick="return confirm('Delete this investment?')">Delete</a></div>
    </div>
  `, req.session.user));
}));

app.post('/individual/investments/:id/update', ipAuth, requireFeaturePlan('individual.investments'), ah(async (req, res) => {
  const {name, type, buy_price, current_value, quantity, purchase_date, notes} = req.body;
  await pool.query('UPDATE ind_investments SET name=$1,type=$2,buy_price=$3,current_value=$4,quantity=$5,purchase_date=$6,notes=$7 WHERE id=$8 AND tenant_id=$9 AND user_email=$10', [name,type,buy_price||0,current_value||0,quantity||1,purchase_date||null,notes||'',req.params.id,tid(req),uem(req)]);
  res.redirect('/individual/investments');
}));

app.get('/individual/investments/:id/delete', ipAuth, requireFeaturePlan('individual.investments'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_investments WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/investments');
}));

// ============================================================
// FEATURE 2: SAVINGS GOALS
// ============================================================
app.get('/individual/savings', ipAuth, requireFeaturePlan('individual.savings'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT *, CASE WHEN target_amount>0 THEN ROUND(current_amount/target_amount*100,1) ELSE 0 END as pct FROM ind_savings_goals WHERE tenant_id=$1 AND user_email=$2 ORDER BY created_at DESC', [tid(req), uem(req)])).rows;
  res.send(renderPage('Savings Goals', `${ipCSS}${ipNav('savings')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Savings Goals</h2><a href="/individual/savings/new" class="ip-btn ip-btn-primary">+ New Goal</a></div>
    ${rows.length ? `<div class="ip-grid">${rows.map(r=>`<div class="ip-card"><h3>${esc(r.name)}</h3><p style="color:#64748b;font-size:13px">${Number(r.current_amount||0).toLocaleString()} / ${Number(r.target_amount||0).toLocaleString()}</p><div class="ip-progress"><div class="ip-progress-bar" style="width:${Math.min(r.pct,100)}%"></div></div><p style="font-size:12px;color:#ec4899;font-weight:600;margin-top:4px">${r.pct}% complete</p>${r.deadline?`<p style="font-size:11px;color:#94a3b8">Deadline: ${r.deadline}</p>`:''}<div style="margin-top:10px;display:flex;gap:6px"><a href="/individual/savings/${r.id}/deposit" class="ip-btn ip-btn-success" style="font-size:11px">Deposit</a><a href="/individual/savings/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Delete</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>🏦</span>No savings goals yet</div>'}
  `, req.session.user));
}));

app.get('/individual/savings/new', ipAuth, requireFeaturePlan('individual.savings'), (req, res) => {
  res.send(renderPage('New Savings Goal', `${ipCSS}${ipNav('savings')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>New Savings Goal</h2>
    <form method="POST" action="/individual/savings/save" class="ip-form">
      <label>Goal Name</label><input name="name" placeholder="e.g. Emergency Fund" required>
      <label>Target Amount</label><input name="target_amount" type="number" step="0.01" placeholder="Target amount" required>
      <label>Current Amount</label><input name="current_amount" type="number" step="0.01" placeholder="Already saved" value="0">
      <label>Deadline</label><input name="deadline" type="date">
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Create Goal</button>
      <a href="/individual/savings" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/savings/save', ipAuth, requireFeaturePlan('individual.savings'), ah(async (req, res) => {
  const {name, target_amount, current_amount, deadline, notes} = req.body;
  await pool.query('INSERT INTO ind_savings_goals(tenant_id,user_email,name,target_amount,current_amount,deadline,notes) VALUES($1,$2,$3,$4,$5,$6,$7)', [tid(req),uem(req),name,target_amount,current_amount||0,deadline||null,notes||'']);
  res.redirect('/individual/savings');
}));

app.get('/individual/savings/:id/deposit', ipAuth, requireFeaturePlan('individual.savings'), (req, res) => {
  res.send(renderPage('Add Deposit', `${ipCSS}${ipNav('savings')}
    <div class="ip-card" style="max-width:400px;margin:0 auto"><h2>Add Deposit</h2>
    <form method="POST" action="/individual/savings/${req.params.id}/deposit" class="ip-form">
      <label>Amount</label><input name="amount" type="number" step="0.01" placeholder="Deposit amount" required>
      <label>Note</label><input name="note" placeholder="Optional note">
      <button type="submit" class="ip-btn ip-btn-success">Deposit</button>
      <a href="/individual/savings" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/savings/:id/deposit', ipAuth, requireFeaturePlan('individual.savings'), ah(async (req, res) => {
  const {amount, note} = req.body;
  await pool.query('UPDATE ind_savings_goals SET current_amount=current_amount+$1 WHERE id=$2 AND tenant_id=$3 AND user_email=$4', [amount, req.params.id, tid(req), uem(req)]);
  await pool.query('INSERT INTO ind_savings_deposits(tenant_id,goal_id,amount,note) VALUES($1,$2,$3,$4)', [tid(req), req.params.id, amount, note||'']);
  res.redirect('/individual/savings');
}));

app.get('/individual/savings/:id/delete', ipAuth, requireFeaturePlan('individual.savings'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_savings_goals WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/savings');
}));

// ============================================================
// FEATURE 3: LOAN TRACKER
// ============================================================
app.get('/individual/loans', ipAuth, requireFeaturePlan('individual.loans'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_loans WHERE tenant_id=$1 AND user_email=$2 ORDER BY created_at DESC', [tid(req), uem(req)])).rows;
  const totalOut = rows.reduce((s,r) => s + Number(r.outstanding||0), 0);
  res.send(renderPage('Loans', `${ipCSS}${ipNav('loans')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Loan Tracker</h2><a href="/individual/loans/new" class="ip-btn ip-btn-primary">+ Add Loan</a></div>
    <div class="ip-stat" style="max-width:300px;margin-bottom:20px"><div class="num">${totalOut.toLocaleString()}</div><div class="lbl">Total Outstanding</div></div>
    ${rows.length ? `<table class="ip-table"><tr><th>Name</th><th>Lender</th><th>Principal</th><th>Outstanding</th><th>EMI</th><th>Status</th><th>Actions</th></tr>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.lender||'-')}</td><td>${Number(r.principal||0).toLocaleString()}</td><td style="font-weight:600">${Number(r.outstanding||0).toLocaleString()}</td><td>${Number(r.emi_amount||0).toLocaleString()}</td><td><span class="ip-badge ${r.status==='active'?'ip-badge-pink':'ip-badge-green'}">${esc(r.status)}</span></td><td><a href="/individual/loans/${r.id}/payment" class="ip-btn ip-btn-success" style="font-size:11px">Pay</a> <a href="/individual/loans/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>💳</span>No loans tracked</div>'}
  `, req.session.user));
}));

app.get('/individual/loans/new', ipAuth, requireFeaturePlan('individual.loans'), (req, res) => {
  res.send(renderPage('Add Loan', `${ipCSS}${ipNav('loans')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Loan</h2>
    <form method="POST" action="/individual/loans/save" class="ip-form">
      <label>Loan Name</label><input name="name" placeholder="e.g. SACCO Loan" required>
      <label>Lender</label><input name="lender" placeholder="Bank or person">
      <label>Principal</label><input name="principal" type="number" step="0.01" required>
      <label>Interest Rate (%)</label><input name="interest_rate" type="number" step="0.01">
      <label>Outstanding Balance</label><input name="outstanding" type="number" step="0.01" required>
      <label>EMI Amount</label><input name="emi_amount" type="number" step="0.01">
      <label>Start Date</label><input name="start_date" type="date">
      <label>End Date</label><input name="end_date" type="date">
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save Loan</button>
      <a href="/individual/loans" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/loans/save', ipAuth, requireFeaturePlan('individual.loans'), ah(async (req, res) => {
  const {name,lender,principal,interest_rate,outstanding,emi_amount,start_date,end_date,notes} = req.body;
  await pool.query('INSERT INTO ind_loans(tenant_id,user_email,name,lender,principal,interest_rate,outstanding,emi_amount,start_date,end_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [tid(req),uem(req),name,lender||'',principal,interest_rate||0,outstanding,emi_amount||0,start_date||null,end_date||null,notes||'']);
  res.redirect('/individual/loans');
}));

app.get('/individual/loans/:id/payment', ipAuth, requireFeaturePlan('individual.loans'), (req, res) => {
  res.send(renderPage('Loan Payment', `${ipCSS}${ipNav('loans')}
    <div class="ip-card" style="max-width:400px;margin:0 auto"><h2>Record Payment</h2>
    <form method="POST" action="/individual/loans/${req.params.id}/payment" class="ip-form">
      <label>Amount</label><input name="amount" type="number" step="0.01" required>
      <label>Note</label><input name="note" placeholder="Optional">
      <button type="submit" class="ip-btn ip-btn-success">Record Payment</button>
      <a href="/individual/loans" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/loans/:id/payment', ipAuth, requireFeaturePlan('individual.loans'), ah(async (req, res) => {
  const {amount, note} = req.body;
  await pool.query('UPDATE ind_loans SET outstanding=GREATEST(0,outstanding-$1) WHERE id=$2 AND tenant_id=$3 AND user_email=$4', [amount, req.params.id, tid(req), uem(req)]);
  await pool.query('UPDATE ind_loans SET status=CASE WHEN outstanding<=0 THEN \'paid\' ELSE status END WHERE id=$1', [req.params.id]);
  await pool.query('INSERT INTO ind_loan_payments(tenant_id,loan_id,amount,note) VALUES($1,$2,$3,$4)', [tid(req), req.params.id, amount, note||'']);
  res.redirect('/individual/loans');
}));

app.get('/individual/loans/:id/delete', ipAuth, requireFeaturePlan('individual.loans'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_loans WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/loans');
}));

// ============================================================
// FEATURE 4: EXPENSE ANALYTICS
// ============================================================
app.get('/individual/expenses', ipAuth, requireFeaturePlan('individual.expenses'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_expenses WHERE tenant_id=$1 AND user_email=$2 ORDER BY expense_date DESC LIMIT 50', [tid(req), uem(req)])).rows;
  const total = rows.reduce((s,r) => s + Number(r.amount||0), 0);
  res.send(renderPage('Expenses', `${ipCSS}${ipNav('expenses')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Expense Tracker</h2><a href="/individual/expenses/new" class="ip-btn ip-btn-primary">+ Add Expense</a></div>
    <div class="ip-stat" style="max-width:300px;margin-bottom:20px"><div class="num">${total.toLocaleString()}</div><div class="lbl">Total (Recent 50)</div></div>
    ${rows.length ? `<table class="ip-table"><tr><th>Date</th><th>Category</th><th>Amount</th><th>Description</th><th>Actions</th></tr>${rows.map(r=>`<tr><td>${r.expense_date||r.created_at?.split('T')[0]}</td><td><span class="ip-badge ip-badge-pink">${esc(r.category||'General')}</span></td><td style="font-weight:600">${Number(r.amount).toLocaleString()}</td><td>${esc(r.description||'')}</td><td><a href="/individual/expenses/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>📉</span>No expenses logged</div>'}
  `, req.session.user));
}));

app.get('/individual/expenses/new', ipAuth, (req, res) => {
  res.send(renderPage('Add Expense', `${ipCSS}${ipNav('expenses')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Expense</h2>
    <form method="POST" action="/individual/expenses/save" class="ip-form">
      <label>Category</label><select name="category"><option>Food</option><option>Transport</option><option>Rent</option><option>Utilities</option><option>Entertainment</option><option>Shopping</option><option>Health</option><option>Education</option><option>Other</option></select>
      <label>Amount</label><input name="amount" type="number" step="0.01" required>
      <label>Description</label><input name="description" placeholder="What was it for?">
      <label>Date</label><input name="expense_date" type="date" value="${new Date().toISOString().split('T')[0]}">
      <button type="submit" class="ip-btn ip-btn-primary">Save Expense</button>
      <a href="/individual/expenses" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/expenses/save', ipAuth, requireFeaturePlan('individual.expenses'), ah(async (req, res) => {
  const {category, amount, description, expense_date} = req.body;
  await pool.query('INSERT INTO ind_expenses(tenant_id,user_email,category,amount,description,expense_date) VALUES($1,$2,$3,$4,$5,$6)', [tid(req),uem(req),category||'Other',amount,description||'',expense_date||null]);
  res.redirect('/individual/expenses');
}));

app.get('/individual/expenses/:id/delete', ipAuth, requireFeaturePlan('individual.expenses'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_expenses WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/expenses');
}));

app.get('/individual/expenses/chart-data', ipAuth, requireFeaturePlan('individual.expenses'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT category, SUM(amount) as total FROM ind_expenses WHERE tenant_id=$1 AND user_email=$2 GROUP BY category ORDER BY total DESC', [tid(req), uem(req)])).rows;
  res.json({labels: rows.map(r=>r.category), data: rows.map(r=>Number(r.total))});
}));

// ============================================================
// FEATURE 5: NET WORTH CALCULATOR
// ============================================================
app.get('/individual/networth', ipAuth, requireFeaturePlan('individual.networth'), ah(async (req, res) => {
  const snap = (await pool.query('SELECT * FROM ind_networth_snapshots WHERE tenant_id=$1 AND user_email=$2 ORDER BY snapshot_date DESC LIMIT 10', [tid(req), uem(req)])).rows;
  res.send(renderPage('Net Worth', `${ipCSS}${ipNav('networth')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Net Worth Calculator</h2></div>
    <div class="ip-card" style="max-width:500px;margin:0 auto 20px"><h3>Save Snapshot</h3>
    <form method="POST" action="/individual/networth/save" class="ip-form">
      <label>Total Assets</label><input name="total_assets" type="number" step="0.01" required>
      <label>Total Liabilities</label><input name="total_liabilities" type="number" step="0.01" required>
      <label>Notes</label><input name="notes" placeholder="Optional">
      <button type="submit" class="ip-btn ip-btn-primary">Save Snapshot</button>
    </form></div>
    ${snap.length ? `<table class="ip-table"><tr><th>Date</th><th>Assets</th><th>Liabilities</th><th>Net Worth</th><th>Actions</th></tr>${snap.map(r=>`<tr><td>${r.snapshot_date}</td><td style="color:#059669">${Number(r.total_assets).toLocaleString()}</td><td style="color:#dc2626">${Number(r.total_liabilities).toLocaleString()}</td><td style="font-weight:800;color:${Number(r.net_worth)>=0?'#059669':'#dc2626'}">${Number(r.net_worth).toLocaleString()}</td><td><a href="/individual/networth/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : ''}
  `, req.session.user));
}));

app.post('/individual/networth/save', ipAuth, requireFeaturePlan('individual.networth'), ah(async (req, res) => {
  const {total_assets, total_liabilities, notes} = req.body;
  const nw = Number(total_assets) - Number(total_liabilities);
  await pool.query('INSERT INTO ind_networth_snapshots(tenant_id,user_email,total_assets,total_liabilities,net_worth,notes) VALUES($1,$2,$3,$4,$5,$6)', [tid(req),uem(req),total_assets,total_liabilities,nw,notes||'']);
  res.redirect('/individual/networth');
}));

app.get('/individual/networth/:id/delete', ipAuth, requireFeaturePlan('individual.networth'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_networth_snapshots WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/networth');
}));

// ============================================================
// FEATURE 6: RECURRING TRANSACTIONS
// ============================================================
app.get('/individual/recurring', ipAuth, requireFeaturePlan('individual.recurring'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_recurring_txns WHERE tenant_id=$1 AND user_email=$2 ORDER BY next_due NULLS LAST', [tid(req), uem(req)])).rows;
  const monthly = rows.filter(r=>r.is_active).reduce((s,r)=>s+Number(r.amount||0),0);
  res.send(renderPage('Recurring', `${ipCSS}${ipNav('recurring')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Recurring Transactions</h2><a href="/individual/recurring/new" class="ip-btn ip-btn-primary">+ Add</a></div>
    <div class="ip-stat" style="max-width:300px;margin-bottom:20px"><div class="num">${monthly.toLocaleString()}</div><div class="lbl">Monthly Total</div></div>
    ${rows.length ? `<table class="ip-table"><tr><th>Name</th><th>Amount</th><th>Type</th><th>Frequency</th><th>Next Due</th><th>Status</th><th>Actions</th></tr>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${Number(r.amount).toLocaleString()}</td><td>${esc(r.type)}</td><td>${esc(r.frequency)}</td><td>${r.next_due||'-'}</td><td><span class="ip-badge ${r.is_active?'ip-badge-green':'ip-badge-gray'}">${r.is_active?'Active':'Paused'}</span></td><td><a href="/individual/recurring/${r.id}/toggle" class="ip-btn ip-btn-secondary" style="font-size:11px">${r.is_active?'Pause':'Resume'}</a> <a href="/individual/recurring/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>🔄</span>No recurring transactions</div>'}
  `, req.session.user));
}));

app.get('/individual/recurring/new', ipAuth, requireFeaturePlan('individual.recurring'), (req, res) => {
  res.send(renderPage('Add Recurring', `${ipCSS}${ipNav('recurring')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Recurring Transaction</h2>
    <form method="POST" action="/individual/recurring/save" class="ip-form">
      <label>Name</label><input name="name" placeholder="e.g. Rent, Netflix" required>
      <label>Amount</label><input name="amount" type="number" step="0.01" required>
      <label>Type</label><select name="type"><option value="expense">Expense</option><option value="income">Income</option></select>
      <label>Category</label><input name="category" placeholder="e.g. Housing, Entertainment">
      <label>Frequency</label><select name="frequency"><option value="weekly">Weekly</option><option value="monthly" selected>Monthly</option><option value="yearly">Yearly</option></select>
      <label>Next Due Date</label><input name="next_due" type="date">
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/recurring" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/recurring/save', ipAuth, requireFeaturePlan('individual.recurring'), ah(async (req, res) => {
  const {name,amount,type,category,frequency,next_due} = req.body;
  await pool.query('INSERT INTO ind_recurring_txns(tenant_id,user_email,name,amount,type,category,frequency,next_due) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [tid(req),uem(req),name,amount,type,category||'',frequency,next_due||null]);
  res.redirect('/individual/recurring');
}));

app.get('/individual/recurring/:id/toggle', ipAuth, requireFeaturePlan('individual.recurring'), ah(async (req, res) => {
  await pool.query('UPDATE ind_recurring_txns SET is_active=NOT is_active WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/recurring');
}));

app.get('/individual/recurring/:id/delete', ipAuth, requireFeaturePlan('individual.recurring'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_recurring_txns WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/recurring');
}));

// ============================================================
// FEATURE 7: FINANCIAL REPORTS
// ============================================================
app.get('/individual/finance-report', ipAuth, requireFeaturePlan('individual.finance-report'), ah(async (req, res) => {
  const period = req.query.period || 'month';
  const exp = (await pool.query('SELECT COALESCE(SUM(amount),0) as t FROM ind_expenses WHERE tenant_id=$1 AND user_email=$2', [tid(req), uem(req)])).rows[0].t;
  const inv = (await pool.query('SELECT COALESCE(SUM(current_value),0) as t FROM ind_investments WHERE tenant_id=$1 AND user_email=$2', [tid(req), uem(req)])).rows[0].t;
  const rec = (await pool.query('SELECT COALESCE(SUM(amount),0) as t FROM ind_recurring_txns WHERE tenant_id=$1 AND user_email=$2 AND is_active=true AND type=\'expense\'', [tid(req), uem(req)])).rows[0].t;
  const loan = (await pool.query('SELECT COALESCE(SUM(outstanding),0) as t FROM ind_loans WHERE tenant_id=$1 AND user_email=$2 AND status=\'active\'', [tid(req), uem(req)])).rows[0].t;
  const sav = (await pool.query('SELECT COALESCE(SUM(current_amount),0) as t FROM ind_savings_goals WHERE tenant_id=$1 AND user_email=$2', [tid(req), uem(req)])).rows[0].t;
  res.send(renderPage('Financial Report', `${ipCSS}${ipNav('report')}
    <h2>Financial Summary</h2>
    <div class="ip-grid" style="margin-top:16px">
      <div class="ip-card"><h4 style="color:#dc2626">Total Expenses</h4><p style="font-size:24px;font-weight:800">${Number(exp).toLocaleString()}</p></div>
      <div class="ip-card"><h4 style="color:#059669">Investments</h4><p style="font-size:24px;font-weight:800">${Number(inv).toLocaleString()}</p></div>
      <div class="ip-card"><h4 style="color:#f59e0b">Monthly Recurring</h4><p style="font-size:24px;font-weight:800">${Number(rec).toLocaleString()}</p></div>
      <div class="ip-card"><h4 style="color:#dc2626">Outstanding Loans</h4><p style="font-size:24px;font-weight:800">${Number(loan).toLocaleString()}</p></div>
      <div class="ip-card"><h4 style="color:#059669">Savings</h4><p style="font-size:24px;font-weight:800">${Number(sav).toLocaleString()}</p></div>
    </div>
  `, req.session.user));
}));

// ============================================================
// FEATURE 8: CURRENCY CONVERTER
// ============================================================
const FX_RATES = {USD:0.00027,EUR:0.00025,GBP:0.00021,KES:0.035,TZS:0.70,RWF:0.34};
app.get('/individual/currency', ipAuth, (req, res) => {
  res.send(renderPage('Currency Converter', `${ipCSS}${ipNav('currency')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Currency Converter</h2><p style="color:#64748b;font-size:13px;margin-bottom:16px">Convert from Ugandan Shillings (UGX)</p>
    <form method="POST" action="/individual/currency/convert" class="ip-form">
      <label>Amount in UGX</label><input name="amount" type="number" step="1" placeholder="Enter UGX amount" required>
      <label>Convert To</label><select name="currency"><option value="USD">USD - US Dollar</option><option value="EUR">EUR - Euro</option><option value="GBP">GBP - British Pound</option><option value="KES">KES - Kenyan Shilling</option><option value="TZS">TZS - Tanzanian Shilling</option><option value="RWF">RWF - Rwandan Franc</option></select>
      <button type="submit" class="ip-btn ip-btn-primary">Convert</button>
    </form></div>
  `, req.session.user));
});

app.post('/individual/currency/convert', ipAuth, (req, res) => {
  const {amount, currency} = req.body;
  const rate = FX_RATES[currency] || 1;
  const result = (Number(amount) * rate).toFixed(2);
  res.send(renderPage('Currency Converter', `${ipCSS}${ipNav('currency')}
    <div class="ip-card" style="max-width:500px;margin:0 auto;text-align:center"><h2>Conversion Result</h2>
    <div style="font-size:36px;font-weight:800;color:#ec4899;margin:20px 0">${Number(amount).toLocaleString()} UGX</div>
    <div style="font-size:20px;color:#64748b">=</div>
    <div style="font-size:36px;font-weight:800;color:#059669;margin:20px 0">${Number(result).toLocaleString()} ${esc(currency)}</div>
    <p style="color:#94a3b8;font-size:12px">Rate: 1 UGX = ${rate} ${esc(currency)} (approximate)</p>
    <a href="/individual/currency" class="ip-btn ip-btn-primary" style="margin-top:16px">Convert Again</a>
    </div>
  `, req.session.user));
});

// ============================================================
// FEATURE 9: HABIT TRACKER
// ============================================================
app.get('/individual/habits', ipAuth, requireFeaturePlan('individual.habits'), ah(async (req, res) => {
  const habits = (await pool.query('SELECT h.*, (SELECT COUNT(*) FROM ind_habit_checkins WHERE habit_id=h.id AND checkin_date=CURRENT_DATE) as today_done FROM ind_habits h WHERE h.tenant_id=$1 AND h.user_email=$2 ORDER BY h.created_at DESC', [tid(req), uem(req)])).rows;
  res.send(renderPage('Habits', `${ipCSS}${ipNav('habits')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Habit Tracker</h2><a href="/individual/habits/new" class="ip-btn ip-btn-primary">+ New Habit</a></div>
    ${habits.length ? `<div class="ip-grid">${habits.map(h=>`<div class="ip-card" style="border-left:4px solid ${esc(h.color||'#ec4899')}"><h3>${esc(h.name)}</h3><p style="font-size:12px;color:#64748b">${esc(h.frequency)} &middot; Target: ${h.target_count}/day</p><div style="margin-top:10px;display:flex;gap:6px">${h.today_done>0?'<span class="ip-badge ip-badge-green">Done Today</span>':`<a href="/individual/habits/${h.id}/checkin" class="ip-btn ip-btn-success" style="font-size:11px">Check In</a>`}<a href="/individual/habits/${h.id}/streak" class="ip-btn ip-btn-secondary" style="font-size:11px">Streak</a><a href="/individual/habits/${h.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>🔄</span>No habits yet. Start building good habits!</div>'}
  `, req.session.user));
}));

app.get('/individual/habits/new', ipAuth, (req, res) => {
  res.send(renderPage('New Habit', `${ipCSS}${ipNav('habits')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Create Habit</h2>
    <form method="POST" action="/individual/habits/save" class="ip-form">
      <label>Habit Name</label><input name="name" placeholder="e.g. Read 30 minutes" required>
      <label>Frequency</label><select name="frequency"><option value="daily">Daily</option><option value="weekly">Weekly</option></select>
      <label>Color</label><input name="color" type="color" value="#ec4899">
      <label>Target Count per Day</label><input name="target_count" type="number" value="1" min="1">
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Create Habit</button>
      <a href="/individual/habits" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/habits/save', ipAuth, requireFeaturePlan('individual.habits'), ah(async (req, res) => {
  const {name,frequency,color,target_count,notes} = req.body;
  await pool.query('INSERT INTO ind_habits(tenant_id,user_email,name,frequency,color,target_count,notes) VALUES($1,$2,$3,$4,$5,$6,$7)', [tid(req),uem(req),name,frequency,color||'#ec4899',target_count||1,notes||'']);
  res.redirect('/individual/habits');
}));

app.get('/individual/habits/:id/checkin', ipAuth, requireFeaturePlan('individual.habits'), ah(async (req, res) => {
  await pool.query('INSERT INTO ind_habit_checkins(tenant_id,habit_id,checkin_date) VALUES($1,$2,CURRENT_DATE) ON CONFLICT (habit_id,checkin_date) DO NOTHING', [tid(req), req.params.id]);
  res.redirect('/individual/habits');
}));

app.get('/individual/habits/:id/streak', ipAuth, requireFeaturePlan('individual.habits'), ah(async (req, res) => {
  const habit = (await pool.query('SELECT * FROM ind_habits WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)])).rows[0];
  if (!habit) return res.redirect('/individual/habits');
  const checkins = (await pool.query('SELECT checkin_date FROM ind_habit_checkins WHERE habit_id=$1 AND tenant_id=$2 ORDER BY checkin_date DESC', [req.params.id, tid(req)])).rows;
  let streak = 0, prev = null;
  for (const c of checkins) {
    const d = new Date(c.checkin_date);
    if (!prev) { streak = 1; prev = d; continue; }
    const diff = (prev - d) / 86400000;
    if (diff <= 1.5) { streak++; prev = d; } else break;
  }
  const total = checkins.length;
  const last30 = (await pool.query('SELECT COUNT(*) as c FROM ind_habit_checkins WHERE habit_id=$1 AND tenant_id=$2 AND checkin_date >= CURRENT_DATE - INTERVAL \'30 days\'', [req.params.id, tid(req)])).rows[0].c;
  const pct = last30 > 0 ? Math.round(last30 / 30 * 100) : 0;
  res.send(renderPage('Habit Streak', `${ipCSS}${ipNav('habits')}
    <div style="text-align:center;max-width:500px;margin:0 auto">
      <h2>${esc(habit.name)}</h2>
      <div style="font-size:72px;font-weight:800;color:#ec4899;margin:20px 0">${streak}</div>
      <p style="color:#64748b;font-size:16px;font-weight:600">Day Streak</p>
      <div class="ip-grid" style="grid-template-columns:repeat(3,1fr);margin-top:24px">
        <div class="ip-stat"><div class="num">${total}</div><div class="lbl">Total Check-ins</div></div>
        <div class="ip-stat"><div class="num">${last30}</div><div class="lbl">Last 30 Days</div></div>
        <div class="ip-stat"><div class="num">${pct}%</div><div class="lbl">Completion Rate</div></div>
      </div>
      <a href="/individual/habits" class="ip-btn ip-btn-secondary" style="margin-top:20px">Back to Habits</a>
    </div>
  `, req.session.user));
}));

app.get('/individual/habits/:id/delete', ipAuth, requireFeaturePlan('individual.habits'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_habits WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/habits');
}));

// ============================================================
// FEATURE 10: TASK MANAGER (KANBAN)
// ============================================================
app.get('/individual/tasks', ipAuth, requireFeaturePlan('individual.tasks'), ah(async (req, res) => {
  const tasks = (await pool.query('SELECT * FROM ind_tasks WHERE tenant_id=$1 AND user_email=$2 ORDER BY CASE priority WHEN \'high\' THEN 1 WHEN \'medium\' THEN 2 ELSE 3 END, due_date NULLS LAST', [tid(req), uem(req)])).rows;
  const todo = tasks.filter(t=>t.status==='todo');
  const prog = tasks.filter(t=>t.status==='in_progress');
  const done = tasks.filter(t=>t.status==='done');
  const col = (title, items, status) => `<div style="flex:1;min-width:250px"><h3 style="margin-bottom:12px;padding-bottom:8px;border-bottom:2px solid #e2e8f0">${title} (${items.length})</h3>${items.map(t=>`<div class="ip-card"><strong>${esc(t.title)}</strong>${t.due_date?`<p style="font-size:11px;color:#94a3b8;margin-top:4px">Due: ${t.due_date}</p>`:''}${t.category?`<span class="ip-badge ip-badge-pink" style="margin-top:4px">${esc(t.category)}</span>`:''}<div style="margin-top:8px;display:flex;gap:4px;flex-wrap:wrap">${status!=='done'?`<a href="/individual/tasks/${t.id}/move?to=done" class="ip-btn ip-btn-success" style="font-size:10px">Done</a>`:''}${status==='todo'?`<a href="/individual/tasks/${t.id}/move?to=in_progress" class="ip-btn ip-btn-primary" style="font-size:10px">Start</a>`:''}<a href="/individual/tasks/${t.id}/delete" class="ip-btn ip-btn-danger" style="font-size:10px" onclick="return confirm('Delete?')">Del</a></div></div>`).join('')}</div>`;
  res.send(renderPage('Tasks', `${ipCSS}${ipNav('tasks')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Task Manager</h2><a href="/individual/tasks/new" class="ip-btn ip-btn-primary">+ New Task</a></div>
    <div style="display:flex;gap:16px;flex-wrap:wrap">${col('To Do', todo, 'todo')}${col('In Progress', prog, 'in_progress')}${col('Done', done, 'done')}</div>
  `, req.session.user));
}));

app.get('/individual/tasks/new', ipAuth, (req, res) => {
  res.send(renderPage('New Task', `${ipCSS}${ipNav('tasks')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>New Task</h2>
    <form method="POST" action="/individual/tasks/save" class="ip-form">
      <label>Title</label><input name="title" required>
      <label>Description</label><textarea name="description" rows="3"></textarea>
      <label>Priority</label><select name="priority"><option value="high">High</option><option value="medium" selected>Medium</option><option value="low">Low</option></select>
      <label>Category</label><input name="category" placeholder="e.g. Work, Personal, Study">
      <label>Due Date</label><input name="due_date" type="date">
      <button type="submit" class="ip-btn ip-btn-primary">Create Task</button>
      <a href="/individual/tasks" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/tasks/save', ipAuth, requireFeaturePlan('individual.tasks'), ah(async (req, res) => {
  const {title,description,priority,category,due_date} = req.body;
  await pool.query('INSERT INTO ind_tasks(tenant_id,user_email,title,description,priority,category,due_date) VALUES($1,$2,$3,$4,$5,$6,$7)', [tid(req),uem(req),title,description||'',priority||'medium',category||'',due_date||null]);
  res.redirect('/individual/tasks');
}));

app.get('/individual/tasks/:id/move', ipAuth, requireFeaturePlan('individual.tasks'), ah(async (req, res) => {
  await pool.query('UPDATE ind_tasks SET status=$1 WHERE id=$2 AND tenant_id=$3 AND user_email=$4', [req.query.to||'todo', req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/tasks');
}));

app.get('/individual/tasks/:id/delete', ipAuth, requireFeaturePlan('individual.tasks'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_tasks WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/tasks');
}));


// ============================================================
// FEATURE 11: TIME LOGGER
// ============================================================
app.get('/individual/timelog', ipAuth, requireFeaturePlan('individual.timelog'), ah(async (req, res) => {
  const logs = (await pool.query('SELECT * FROM ind_time_logs WHERE tenant_id=$1 AND user_email=$2 ORDER BY created_at DESC LIMIT 30', [tid(req), uem(req)])).rows;
  const totalMin = logs.reduce((s,r)=>s+Number(r.duration_minutes||0),0);
  res.send(renderPage('Time Log', `${ipCSS}${ipNav('timelog')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Time Logger</h2><div style="display:flex;gap:8px"><a href="/individual/timelog/summary" class="ip-btn ip-btn-secondary">Summary</a><a href="/individual/timelog/start" class="ip-btn ip-btn-primary">+ Start Timer</a></div></div>
    <div class="ip-stat" style="max-width:300px;margin-bottom:20px"><div class="num">${(totalMin/60).toFixed(1)}h</div><div class="lbl">Total Hours</div></div>
    ${logs.length ? `<table class="ip-table"><tr><th>Date</th><th>Project</th><th>Activity</th><th>Duration</th><th>Actions</th></tr>${logs.map(r=>`<tr><td>${r.start_time?.split('T')[0]||'-'}</td><td>${esc(r.project||'-')}</td><td>${esc(r.activity||'-')}</td><td style="font-weight:600">${r.duration_minutes||'?'} min</td><td><a href="/individual/timelog/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>⏱️</span>No time logs yet</div>'}
  `, req.session.user));
}));

app.get('/individual/timelog/start', ipAuth, requireFeaturePlan('individual.timelog'), (req, res) => {
  res.send(renderPage('Start Timer', `${ipCSS}${ipNav('timelog')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Start Timer</h2>
    <form method="POST" action="/individual/timelog/stop" class="ip-form">
      <label>Project</label><input name="project" placeholder="e.g. Website Redesign">
      <label>Activity</label><input name="activity" placeholder="e.g. Coding">
      <label>Duration (minutes)</label><input name="duration" type="number" placeholder="Enter minutes or use timer" required>
      <label>Note</label><input name="note" placeholder="Optional note">
      <button type="submit" class="ip-btn ip-btn-success">Save Time Entry</button>
      <a href="/individual/timelog" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/timelog/stop', ipAuth, requireFeaturePlan('individual.timelog'), ah(async (req, res) => {
  const {project, activity, duration, note} = req.body;
  await pool.query('INSERT INTO ind_time_logs(tenant_id,user_email,project,activity,start_time,duration_minutes,note) VALUES($1,$2,$3,$4,NOW(),$5,$6)', [tid(req),uem(req),project||'',activity||'',duration||0,note||'']);
  res.redirect('/individual/timelog');
}));

app.get('/individual/timelog/:id/delete', ipAuth, requireFeaturePlan('individual.timelog'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_time_logs WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/timelog');
}));

app.get('/individual/timelog/summary', ipAuth, requireFeaturePlan('individual.timelog'), ah(async (req, res) => {
  const summary = (await pool.query('SELECT project, COUNT(*) as entries, SUM(duration_minutes) as total_min, MIN(start_time) as first_entry, MAX(start_time) as last_entry FROM ind_time_logs WHERE tenant_id=$1 AND user_email=$2 GROUP BY project ORDER BY total_min DESC NULLS LAST', [tid(req), uem(req)])).rows;
  const totalHours = summary.reduce((s,r)=>s+Number(r.total_min||0),0);
  res.send(renderPage('Time Summary', `${ipCSS}${ipNav('timelog')}
    <h2>Time Log Summary</h2>
    <div class="ip-stat" style="max-width:300px;margin:20px auto"><div class="num">${(totalHours/60).toFixed(1)}h</div><div class="lbl">Total Hours Logged</div></div>
    ${summary.length ? `<table class="ip-table"><tr><th>Project</th><th>Entries</th><th>Total Time</th></tr>${summary.map(r=>`<tr><td><strong>${esc(r.project||'Unassigned')}</strong></td><td>${r.entries}</td><td style="font-weight:600">${(Number(r.total_min)/60).toFixed(1)}h (${r.total_min} min)</td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>📊</span>No time data to summarize</div>'}
    <a href="/individual/timelog" class="ip-btn ip-btn-secondary" style="margin-top:16px">Back to Time Log</a>
  `, req.session.user));
}));

// ============================================================
// FEATURE 12: POMODORO TIMER
// ============================================================
app.get('/individual/pomodoro', ipAuth, requireFeaturePlan('individual.pomodoro'), ah(async (req, res) => {
  const today = (await pool.query('SELECT COUNT(*) as c, COALESCE(SUM(duration_minutes),0) as t FROM ind_pomodoro_sessions WHERE tenant_id=$1 AND user_email=$2 AND started_at::date=CURRENT_DATE', [tid(req), uem(req)])).rows[0];
  res.send(renderPage('Pomodoro', `${ipCSS}${ipNav('pomodoro')}
    <div style="text-align:center;max-width:400px;margin:0 auto">
      <h2>Pomodoro Timer</h2>
      <div style="width:200px;height:200px;border-radius:50%;background:linear-gradient(135deg,#ec4899,#f472b6);display:flex;align-items:center;justify-content:center;margin:30px auto;font-size:48px;font-weight:800;color:white" id="timer">25:00</div>
      <div style="display:flex;gap:10px;justify-content:center;margin-bottom:20px">
        <button onclick="startTimer()" class="ip-btn ip-btn-primary">Start Focus</button>
        <button onclick="takeBreak()" class="ip-btn ip-btn-secondary">Break (5 min)</button>
      </div>
      <form method="POST" action="/individual/pomodoro/session" style="margin-top:20px">
        <input name="task" placeholder="What are you working on?" style="padding:10px;border-radius:10px;border:1px solid #e2e8f0;width:100%;margin-bottom:10px">
        <input name="duration_minutes" type="hidden" value="25">
        <button type="submit" class="ip-btn ip-btn-success">Log Session</button>
      </form>
      <div style="margin-top:20px"><span class="ip-badge ip-badge-pink">${today.c} sessions today</span> <span class="ip-badge ip-badge-green">${today.t} min focused</span></div>
    </div>
    <script>var t=25*60,intr=null;function startTimer(){if(intr)return;intr=setInterval(function(){t--;if(t<=0){clearInterval(intr);intr=null;alert('Focus session complete!');t=25*60}var m=Math.floor(t/60),s=t%60;document.getElementById('timer').textContent=(m<10?'0':'')+m+':'+(s<10?'0':'')+s)},1000)}function takeBreak(){t=5*60;clearInterval(intr);intr=null;startTimer()}</script>
  `, req.session.user));
}));

app.post('/individual/pomodoro/session', ipAuth, requireFeaturePlan('individual.pomodoro'), ah(async (req, res) => {
  const {task, duration_minutes} = req.body;
  await pool.query('INSERT INTO ind_pomodoro_sessions(tenant_id,user_email,task,duration_minutes,type) VALUES($1,$2,$3,$4,$5)', [tid(req),uem(req),task||'',duration_minutes||25,'focus']);
  res.redirect('/individual/pomodoro');
}));

// ============================================================
// FEATURE 13: CALENDAR & EVENTS
// ============================================================
app.get('/individual/calendar', ipAuth, requireFeaturePlan('individual.calendar'), ah(async (req, res) => {
  const events = (await pool.query('SELECT * FROM ind_calendar_events WHERE tenant_id=$1 AND user_email=$2 ORDER BY event_date, event_time NULLS LAST', [tid(req), uem(req)])).rows;
  res.send(renderPage('Calendar', `${ipCSS}${ipNav('calendar')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Calendar & Events</h2><a href="/individual/calendar/new" class="ip-btn ip-btn-primary">+ New Event</a></div>
    ${events.length ? `<div class="ip-grid">${events.map(e=>`<div class="ip-card"><h3>${esc(e.title)}</h3><p style="color:#64748b;font-size:13px">${e.event_date||'No date'}${e.event_time?' at '+e.event_time:''}</p>${e.location?`<p style="font-size:12px;color:#94a3b8">📍 ${esc(e.location)}</p>`:''}<span class="ip-badge ip-badge-pink">${esc(e.category||'personal')}</span><div style="margin-top:8px;display:flex;gap:4px"><a href="/individual/calendar/${e.id}/edit" class="ip-btn ip-btn-secondary" style="font-size:11px">Edit</a><a href="/individual/calendar/${e.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Delete</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>📅</span>No events scheduled</div>'}
  `, req.session.user));
}));

app.get('/individual/calendar/new', ipAuth, (req, res) => {
  res.send(renderPage('New Event', `${ipCSS}${ipNav('calendar')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>New Event</h2>
    <form method="POST" action="/individual/calendar/save" class="ip-form">
      <label>Title</label><input name="title" required>
      <label>Date</label><input name="event_date" type="date" required>
      <label>Time</label><input name="event_time" type="time">
      <label>Category</label><select name="category"><option value="personal">Personal</option><option value="work">Work</option><option value="health">Health</option><option value="social">Social</option><option value="other">Other</option></select>
      <label>Location</label><input name="location" placeholder="Where?">
      <label>Description</label><textarea name="description" rows="3"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save Event</button>
      <a href="/individual/calendar" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/calendar/save', ipAuth, requireFeaturePlan('individual.calendar'), ah(async (req, res) => {
  const {title,event_date,event_time,category,location,description} = req.body;
  await pool.query('INSERT INTO ind_calendar_events(tenant_id,user_email,title,description,event_date,event_time,category,location) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [tid(req),uem(req),title,description||'',event_date,event_time||null,category||'personal',location||'']);
  res.redirect('/individual/calendar');
}));

app.get('/individual/calendar/:id/edit', ipAuth, requireFeaturePlan('individual.calendar'), ah(async (req, res) => {
  const e = (await pool.query('SELECT * FROM ind_calendar_events WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)])).rows[0];
  if (!e) return res.redirect('/individual/calendar');
  res.send(renderPage('Edit Event', `${ipCSS}${ipNav('calendar')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Edit Event</h2>
    <form method="POST" action="/individual/calendar/${e.id}/update" class="ip-form">
      <label>Title</label><input name="title" value="${esc(e.title)}" required>
      <label>Date</label><input name="event_date" type="date" value="${e.event_date||''}" required>
      <label>Time</label><input name="event_time" type="time" value="${e.event_time||''}">
      <label>Category</label><select name="category"><option value="personal" ${e.category==='personal'?'selected':''}>Personal</option><option value="work" ${e.category==='work'?'selected':''}>Work</option><option value="health" ${e.category==='health'?'selected':''}>Health</option><option value="social" ${e.category==='social'?'selected':''}>Social</option><option value="other" ${e.category==='other'?'selected':''}>Other</option></select>
      <label>Location</label><input name="location" value="${esc(e.location||'')}">
      <label>Description</label><textarea name="description" rows="3">${esc(e.description||'')}</textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Update Event</button>
      <a href="/individual/calendar" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
}));

app.post('/individual/calendar/:id/update', ipAuth, requireFeaturePlan('individual.calendar'), ah(async (req, res) => {
  const {title,event_date,event_time,category,location,description} = req.body;
  await pool.query('UPDATE ind_calendar_events SET title=$1,description=$2,event_date=$3,event_time=$4,category=$5,location=$6 WHERE id=$7 AND tenant_id=$8 AND user_email=$9', [title,description||'',event_date,event_time||null,category||'personal',location||'',req.params.id,tid(req),uem(req)]);
  res.redirect('/individual/calendar');
}));

app.get('/individual/calendar/:id/delete', ipAuth, requireFeaturePlan('individual.calendar'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_calendar_events WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/calendar');
}));

// ============================================================
// FEATURE 14: DAILY JOURNAL
// ============================================================
app.get('/individual/journal', ipAuth, requireFeaturePlan('individual.journal'), ah(async (req, res) => {
  const entries = (await pool.query('SELECT * FROM ind_journal_entries WHERE tenant_id=$1 AND user_email=$2 ORDER BY entry_date DESC, created_at DESC LIMIT 30', [tid(req), uem(req)])).rows;
  const moods = {great:'😊',good:'🙂',okay:'😐',bad:'😞',terrible:'😢'};
  res.send(renderPage('Journal', `${ipCSS}${ipNav('journal')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Daily Journal</h2><a href="/individual/journal/new" class="ip-btn ip-btn-primary">+ New Entry</a></div>
    ${entries.length ? entries.map(e=>`<div class="ip-card"><div style="display:flex;justify-content:space-between;align-items:center"><h3>${esc(e.title||'Untitled')}</h3><span style="font-size:24px">${moods[e.mood]||''}</span></div><p style="color:#64748b;font-size:12px;margin-bottom:8px">${e.entry_date}${e.tags?' &middot; '+esc(e.tags):''}</p><p style="font-size:14px;line-height:1.6">${esc((e.content||'').substring(0,200))}${(e.content||'').length>200?'...':''}</p><div style="margin-top:8px;display:flex;gap:6px"><a href="/individual/journal/${e.id}" class="ip-btn ip-btn-secondary" style="font-size:11px">Read</a><a href="/individual/journal/${e.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Delete</a></div></div>`).join('') : '<div class="ip-empty"><span>📔</span>No journal entries yet</div>'}
  `, req.session.user));
}));

app.get('/individual/journal/new', ipAuth, (req, res) => {
  res.send(renderPage('New Journal Entry', `${ipCSS}${ipNav('journal')}
    <div class="ip-card" style="max-width:600px;margin:0 auto"><h2>New Journal Entry</h2>
    <form method="POST" action="/individual/journal/save" class="ip-form">
      <label>Title</label><input name="title" placeholder="Today's highlight">
      <label>Mood</label><select name="mood"><option value="great">😊 Great</option><option value="good">🙂 Good</option><option value="okay" selected>😐 Okay</option><option value="bad">😞 Bad</option><option value="terrible">😢 Terrible</option></select>
      <label>Tags</label><input name="tags" placeholder="e.g. work, family, fitness">
      <label>Content</label><textarea name="content" rows="8" placeholder="Write your thoughts..." required></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save Entry</button>
      <a href="/individual/journal" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/journal/save', ipAuth, requireFeaturePlan('individual.journal'), ah(async (req, res) => {
  const {title,mood,tags,content} = req.body;
  await pool.query('INSERT INTO ind_journal_entries(tenant_id,user_email,title,content,mood,tags) VALUES($1,$2,$3,$4,$5,$6)', [tid(req),uem(req),title||'',content,mood||'okay',tags||'']);
  res.redirect('/individual/journal');
}));

app.get('/individual/journal/:id', ipAuth, requireFeaturePlan('individual.journal'), ah(async (req, res) => {
  const e = (await pool.query('SELECT * FROM ind_journal_entries WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)])).rows[0];
  if (!e) return res.redirect('/individual/journal');
  const moods = {great:'😊',good:'🙂',okay:'😐',bad:'😞',terrible:'😢'};
  res.send(renderPage('Journal Entry', `${ipCSS}${ipNav('journal')}
    <div class="ip-card" style="max-width:600px;margin:0 auto"><h2>${esc(e.title||'Untitled')} <span style="font-size:28px">${moods[e.mood]||''}</span></h2>
    <p style="color:#64748b;font-size:12px;margin-bottom:16px">${e.entry_date}${e.tags?' &middot; '+esc(e.tags):''}</p>
    <div style="font-size:15px;line-height:1.8;white-space:pre-wrap">${esc(e.content||'')}</div>
    <div style="margin-top:20px"><a href="/individual/journal" class="ip-btn ip-btn-secondary">Back to Journal</a> <a href="/individual/journal/${e.id}/delete" class="ip-btn ip-btn-danger" onclick="return confirm('Delete?')">Delete</a></div></div>
  `, req.session.user));
}));

app.get('/individual/journal/:id/delete', ipAuth, requireFeaturePlan('individual.journal'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_journal_entries WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/journal');
}));

// ============================================================
// FEATURE 15: FOCUS MODE
// ============================================================
app.get('/individual/focus', ipAuth, requireFeaturePlan('individual.focus'), ah(async (req, res) => {
  const sessions = (await pool.query('SELECT * FROM ind_focus_sessions WHERE tenant_id=$1 AND user_email=$2 ORDER BY started_at DESC LIMIT 20', [tid(req), uem(req)])).rows;
  const active = sessions.find(s=>!s.ended_at);
  const totalMin = sessions.filter(s=>s.completed).reduce((s,r)=>s+Number(r.duration_minutes||0),0);
  res.send(renderPage('Focus Mode', `${ipCSS}${ipNav('focus')}
    <div style="text-align:center;margin-bottom:24px"><h2>Focus Mode</h2>
    ${active ? `<div style="padding:20px;background:#f0fdf4;border-radius:16px;border:2px solid #059669"><p style="color:#059669;font-weight:700;font-size:18px">Currently Focusing: ${esc(active.goal||'')}</p><a href="/individual/focus/end" class="ip-btn ip-btn-primary" style="margin-top:10px">End Session</a></div>` : `<form method="POST" action="/individual/focus/start" style="max-width:400px;margin:0 auto"><input name="goal" placeholder="What are you focusing on?" style="padding:12px;border-radius:10px;border:1px solid #e2e8f0;width:100%;font-size:16px;margin-bottom:10px" required><button type="submit" class="ip-btn ip-btn-primary" style="font-size:16px;padding:12px 30px">Start Focus</button></form>`}</div>
    <div class="ip-stat" style="max-width:300px;margin:0 auto 20px"><div class="num">${(totalMin/60).toFixed(1)}h</div><div class="lbl">Total Focus Time</div></div>
    ${sessions.filter(s=>s.ended_at).length ? `<table class="ip-table"><tr><th>Goal</th><th>Duration</th><th>Completed</th></tr>${sessions.filter(s=>s.ended_at).map(s=>`<tr><td>${esc(s.goal||'-')}</td><td>${s.duration_minutes||'?'} min</td><td>${s.completed?'<span class="ip-badge ip-badge-green">Yes</span>':'<span class="ip-badge ip-badge-gray">No</span>'}</td></tr>`).join('')}</table>` : ''}
  `, req.session.user));
}));

app.post('/individual/focus/start', ipAuth, requireFeaturePlan('individual.focus'), ah(async (req, res) => {
  await pool.query('INSERT INTO ind_focus_sessions(tenant_id,user_email,goal,started_at) VALUES($1,$2,$3,NOW())', [tid(req),uem(req),req.body.goal]);
  res.redirect('/individual/focus');
}));

app.get('/individual/focus/end', ipAuth, requireFeaturePlan('individual.focus'), ah(async (req, res) => {
  const active = (await pool.query('SELECT id, started_at FROM ind_focus_sessions WHERE tenant_id=$1 AND user_email=$2 AND ended_at IS NULL ORDER BY started_at DESC LIMIT 1', [tid(req), uem(req)])).rows[0];
  if (active) {
    const mins = Math.round((Date.now() - new Date(active.started_at).getTime()) / 60000);
    await pool.query('UPDATE ind_focus_sessions SET ended_at=NOW(), duration_minutes=$1, completed=true WHERE id=$2', [mins, active.id]);
  }
  res.redirect('/individual/focus');
}));

// ============================================================
// FEATURES 16-21: HEALTH & WELLNESS
// ============================================================
// FEATURE 16: Health Metrics
app.get('/individual/health', ipAuth, requireFeaturePlan('individual.health'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_health_metrics WHERE tenant_id=$1 AND user_email=$2 ORDER BY recorded_date DESC LIMIT 30', [tid(req), uem(req)])).rows;
  res.send(renderPage('Health Metrics', `${ipCSS}${ipNav('health')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Health Metrics</h2><a href="/individual/health/new" class="ip-btn ip-btn-primary">+ Record</a></div>
    ${rows.length ? `<table class="ip-table"><tr><th>Date</th><th>Type</th><th>Value</th><th>Unit</th><th>Notes</th><th>Actions</th></tr>${rows.map(r=>`<tr><td>${r.recorded_date}</td><td><span class="ip-badge ip-badge-pink">${esc(r.metric_type)}</span></td><td style="font-weight:600">${r.value}</td><td>${esc(r.unit||'')}</td><td>${esc(r.notes||'')}</td><td><a href="/individual/health/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>❤️</span>No health metrics recorded</div>'}
  `, req.session.user));
}));

app.get('/individual/health/new', ipAuth, requireFeaturePlan('individual.health'), (req, res) => {
  res.send(renderPage('Record Health', `${ipCSS}${ipNav('health')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Record Health Metric</h2>
    <form method="POST" action="/individual/health/save" class="ip-form">
      <label>Metric Type</label><select name="metric_type"><option value="weight">Weight</option><option value="blood_pressure">Blood Pressure</option><option value="blood_sugar">Blood Sugar</option><option value="heart_rate">Heart Rate</option><option value="temperature">Temperature</option><option value="other">Other</option></select>
      <label>Value</label><input name="value" type="number" step="0.01" required>
      <label>Unit</label><input name="unit" placeholder="e.g. kg, mmHg, bpm">
      <label>Date</label><input name="recorded_date" type="date" value="${new Date().toISOString().split('T')[0]}">
      <label>Notes</label><input name="notes" placeholder="Optional">
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/health" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/health/save', ipAuth, requireFeaturePlan('individual.health'), ah(async (req, res) => {
  const {metric_type,value,unit,recorded_date,notes} = req.body;
  await pool.query('INSERT INTO ind_health_metrics(tenant_id,user_email,metric_type,value,unit,recorded_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7)', [tid(req),uem(req),metric_type,value,unit||'',recorded_date||null,notes||'']);
  res.redirect('/individual/health');
}));

app.get('/individual/health/:id/delete', ipAuth, requireFeaturePlan('individual.health'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_health_metrics WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/health');
}));

app.get('/individual/health/chart-data', ipAuth, requireFeaturePlan('individual.health'), ah(async (req, res) => {
  const {type='weight'} = req.query;
  const rows = (await pool.query('SELECT recorded_date as date, value FROM ind_health_metrics WHERE tenant_id=$1 AND user_email=$2 AND metric_type=$3 ORDER BY recorded_date', [tid(req), uem(req), type])).rows;
  res.json({labels:rows.map(r=>r.date), data:rows.map(r=>Number(r.value))});
}));

// FEATURE 17: Medication Tracker
app.get('/individual/medications', ipAuth, requireFeaturePlan('individual.medications'), ah(async (req, res) => {
  const meds = (await pool.query('SELECT * FROM ind_medications WHERE tenant_id=$1 AND user_email=$2 ORDER BY is_active DESC, created_at DESC', [tid(req), uem(req)])).rows;
  res.send(renderPage('Medications', `${ipCSS}${ipNav('health')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Medication Tracker</h2><a href="/individual/medications/new" class="ip-btn ip-btn-primary">+ Add</a></div>
    ${meds.length ? `<div class="ip-grid">${meds.map(m=>`<div class="ip-card"><h3>${esc(m.name)}</h3><p style="color:#64748b;font-size:13px">${esc(m.dosage||'')} &middot; ${esc(m.frequency||'')}</p><span class="ip-badge ${m.is_active?'ip-badge-green':'ip-badge-gray'}">${m.is_active?'Active':'Inactive'}</span><div style="margin-top:8px;display:flex;gap:6px"><a href="/individual/medications/${m.id}/taken" class="ip-btn ip-btn-success" style="font-size:11px">Taken</a><a href="/individual/medications/${m.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>💊</span>No medications tracked</div>'}
  `, req.session.user));
}));

app.get('/individual/medications/new', ipAuth, requireFeaturePlan('individual.medications'), (req, res) => {
  res.send(renderPage('Add Medication', `${ipCSS}${ipNav('health')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Medication</h2>
    <form method="POST" action="/individual/medications/save" class="ip-form">
      <label>Name</label><input name="name" placeholder="e.g. Paracetamol" required>
      <label>Dosage</label><input name="dosage" placeholder="e.g. 500mg">
      <label>Frequency</label><input name="frequency" placeholder="e.g. Twice daily">
      <label>Start Date</label><input name="start_date" type="date">
      <label>End Date</label><input name="end_date" type="date">
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/medications" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/medications/save', ipAuth, requireFeaturePlan('individual.medications'), ah(async (req, res) => {
  const {name,dosage,frequency,start_date,end_date,notes} = req.body;
  await pool.query('INSERT INTO ind_medications(tenant_id,user_email,name,dosage,frequency,start_date,end_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [tid(req),uem(req),name,dosage||'',frequency||'',start_date||null,end_date||null,notes||'']);
  res.redirect('/individual/medications');
}));

app.get('/individual/medications/:id/taken', ipAuth, requireFeaturePlan('individual.medications'), ah(async (req, res) => {
  await pool.query('INSERT INTO ind_medication_log(tenant_id,medication_id) VALUES($1,$2)', [tid(req), req.params.id]);
  res.redirect('/individual/medications');
}));

app.get('/individual/medications/:id/delete', ipAuth, requireFeaturePlan('individual.medications'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_medications WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/medications');
}));

// FEATURE 18: Workout Logger
app.get('/individual/workouts', ipAuth, requireFeaturePlan('individual.workouts'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_workouts WHERE tenant_id=$1 AND user_email=$2 ORDER BY workout_date DESC LIMIT 30', [tid(req), uem(req)])).rows;
  res.send(renderPage('Workouts', `${ipCSS}${ipNav('health')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Workout Logger</h2><a href="/individual/workouts/new" class="ip-btn ip-btn-primary">+ Log Workout</a></div>
    ${rows.length ? `<table class="ip-table"><tr><th>Date</th><th>Type</th><th>Duration</th><th>Calories</th><th>Actions</th></tr>${rows.map(r=>`<tr><td>${r.workout_date}</td><td><span class="ip-badge ip-badge-pink">${esc(r.type||'General')}</span></td><td>${r.duration_minutes||0} min</td><td>${r.calories||0}</td><td><a href="/individual/workouts/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>🏋️</span>No workouts logged</div>'}
  `, req.session.user));
}));

app.get('/individual/workouts/new', ipAuth, requireFeaturePlan('individual.workouts'), (req, res) => {
  res.send(renderPage('Log Workout', `${ipCSS}${ipNav('health')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Log Workout</h2>
    <form method="POST" action="/individual/workouts/save" class="ip-form">
      <label>Type</label><select name="type"><option>Running</option><option>Walking</option><option>Cycling</option><option>Swimming</option><option>Gym</option><option>Yoga</option><option>HIIT</option><option>Other</option></select>
      <label>Duration (minutes)</label><input name="duration_minutes" type="number">
      <label>Calories Burned</label><input name="calories" type="number">
      <label>Sets</label><input name="sets" type="number">
      <label>Reps per Set</label><input name="reps" type="number">
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/workouts" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/workouts/save', ipAuth, requireFeaturePlan('individual.workouts'), ah(async (req, res) => {
  const {type,duration_minutes,calories,sets,reps,notes} = req.body;
  await pool.query('INSERT INTO ind_workouts(tenant_id,user_email,type,duration_minutes,calories,sets,reps,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [tid(req),uem(req),type||'Other',duration_minutes||0,calories||0,sets||0,reps||0,notes||'']);
  res.redirect('/individual/workouts');
}));

app.get('/individual/workouts/:id/delete', ipAuth, requireFeaturePlan('individual.workouts'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_workouts WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/workouts');
}));

// FEATURE 19: Water Intake Tracker
app.get('/individual/water', ipAuth, requireFeaturePlan('individual.water'), ah(async (req, res) => {
  const today = (await pool.query('SELECT * FROM ind_water_intake WHERE tenant_id=$1 AND user_email=$2 AND intake_date=CURRENT_DATE', [tid(req), uem(req)])).rows[0] || {glasses:0, goal:8};
  const pct = Math.min(100, Math.round(Number(today.glasses)/Number(today.goal)*100));
  res.send(renderPage('Water Intake', `${ipCSS}${ipNav('health')}
    <div style="text-align:center;max-width:400px;margin:0 auto">
      <h2>Water Intake</h2>
      <div style="width:200px;height:200px;border-radius:50%;background:#f0f9ff;border:8px solid #bae6fd;display:flex;flex-direction:column;align-items:center;justify-content:center;margin:30px auto">
        <span style="font-size:48px;font-weight:800;color:#0284c7">${today.glasses}</span>
        <span style="color:#64748b;font-size:14px">of ${today.goal} glasses</span>
      </div>
      <div class="ip-progress" style="max-width:300px;margin:0 auto 20px"><div class="ip-progress-bar" style="width:${pct}%;background:linear-gradient(90deg,#0284c7,#38bdf8)"></div></div>
      <div style="display:flex;gap:10px;justify-content:center">
        <a href="/individual/water/add" class="ip-btn ip-btn-primary">+ Add Glass</a>
        <a href="/individual/water/reset" class="ip-btn ip-btn-secondary">Reset</a>
      </div>
    </div>
  `, req.session.user));
}));

app.get('/individual/water/add', ipAuth, requireFeaturePlan('individual.water'), ah(async (req, res) => {
  await pool.query('INSERT INTO ind_water_intake(tenant_id,user_email,glasses,goal,intake_date) VALUES($1,$2,1,8,CURRENT_DATE) ON CONFLICT (tenant_id,user_email,intake_date) DO UPDATE SET glasses=ind_water_intake.glasses+1', [tid(req), uem(req)]);
  res.redirect('/individual/water');
}));

app.get('/individual/water/reset', ipAuth, requireFeaturePlan('individual.water'), ah(async (req, res) => {
  await pool.query('UPDATE ind_water_intake SET glasses=0 WHERE tenant_id=$1 AND user_email=$2 AND intake_date=CURRENT_DATE', [tid(req), uem(req)]);
  res.redirect('/individual/water');
}));

// FEATURE 20: Sleep Tracker
app.get('/individual/sleep', ipAuth, requireFeaturePlan('individual.sleep'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_sleep_log WHERE tenant_id=$1 AND user_email=$2 ORDER BY sleep_date DESC LIMIT 14', [tid(req), uem(req)])).rows;
  res.send(renderPage('Sleep Tracker', `${ipCSS}${ipNav('health')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Sleep Tracker</h2><a href="/individual/sleep/new" class="ip-btn ip-btn-primary">+ Log Sleep</a></div>
    ${rows.length ? `<table class="ip-table"><tr><th>Date</th><th>Bedtime</th><th>Wake</th><th>Quality</th><th>Actions</th></tr>${rows.map(r=>`<tr><td>${r.sleep_date}</td><td>${r.bedtime||'-'}</td><td>${r.wake_time||'-'}</td><td>${'★'.repeat(r.quality||5)}${'☆'.repeat(10-(r.quality||5))}</td><td><a href="/individual/sleep/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>😴</span>No sleep data logged</div>'}
  `, req.session.user));
}));

app.get('/individual/sleep/new', ipAuth, requireFeaturePlan('individual.sleep'), (req, res) => {
  res.send(renderPage('Log Sleep', `${ipCSS}${ipNav('health')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Log Sleep</h2>
    <form method="POST" action="/individual/sleep/save" class="ip-form">
      <label>Bedtime</label><input name="bedtime" type="time">
      <label>Wake Time</label><input name="wake_time" type="time">
      <label>Quality (1-10)</label><input name="quality" type="number" min="1" max="10" value="7">
      <label>Date</label><input name="sleep_date" type="date" value="${new Date().toISOString().split('T')[0]}">
      <label>Notes</label><input name="notes" placeholder="Any notes?">
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/sleep" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/sleep/save', ipAuth, requireFeaturePlan('individual.sleep'), ah(async (req, res) => {
  const {bedtime,wake_time,quality,sleep_date,notes} = req.body;
  await pool.query('INSERT INTO ind_sleep_log(tenant_id,user_email,bedtime,wake_time,quality,sleep_date,notes) VALUES($1,$2,$3,$4,$5,$6,$7)', [tid(req),uem(req),bedtime||null,wake_time||null,quality||5,sleep_date||null,notes||'']);
  res.redirect('/individual/sleep');
}));

app.get('/individual/sleep/:id/delete', ipAuth, requireFeaturePlan('individual.sleep'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_sleep_log WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/sleep');
}));

// FEATURE 21: Mental Wellness Check
app.get('/individual/wellness', ipAuth, requireFeaturePlan('individual.wellness'), ah(async (req, res) => {
  const recent = (await pool.query('SELECT * FROM ind_wellness_checkins WHERE tenant_id=$1 AND user_email=$2 ORDER BY checkin_date DESC LIMIT 14', [tid(req), uem(req)])).rows;
  const moods = {great:'😊',good:'🙂',okay:'😐',low:'😞',bad:'😢'};
  res.send(renderPage('Wellness', `${ipCSS}${ipNav('health')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Mental Wellness</h2><a href="/individual/wellness/history" class="ip-btn ip-btn-secondary">History</a></div>
    <div class="ip-card" style="max-width:500px;margin:20px auto"><h3>How are you feeling?</h3>
    <form method="POST" action="/individual/wellness/checkin" class="ip-form">
      <label>Mood</label><select name="mood"><option value="great">😊 Great</option><option value="good">🙂 Good</option><option value="okay">😐 Okay</option><option value="low">😞 Low</option><option value="bad">😢 Bad</option></select>
      <label>Stress Level (1-10)</label><input name="stress_level" type="number" min="1" max="10" value="5">
      <label>Energy Level (1-10)</label><input name="energy_level" type="number" min="1" max="10" value="5">
      <label>Gratitude</label><textarea name="gratitude" rows="2" placeholder="What are you grateful for today?"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Check In</button>
    </form></div>
    ${recent.length ? `<h3>Recent Check-ins</h3>${recent.map(r=>`<div class="ip-card" style="padding:12px"><span style="font-size:24px">${moods[r.mood]||'😐'}</span> <strong>${esc(r.mood)}</strong> &middot; Stress: ${r.stress_level}/10 &middot; Energy: ${r.energy_level}/10 &middot; <span style="color:#94a3b8;font-size:12px">${r.checkin_date}</span>${r.gratitude?`<p style="font-size:13px;color:#64748b;margin-top:4px">🙏 ${esc(r.gratitude)}</p>`:''}</div>`).join('')}` : ''}
  `, req.session.user));
}));

app.post('/individual/wellness/checkin', ipAuth, requireFeaturePlan('individual.wellness'), ah(async (req, res) => {
  const {mood,stress_level,energy_level,gratitude} = req.body;
  await pool.query('INSERT INTO ind_wellness_checkins(tenant_id,user_email,mood,stress_level,energy_level,gratitude) VALUES($1,$2,$3,$4,$5,$6)', [tid(req),uem(req),mood||'okay',stress_level||5,energy_level||5,gratitude||'']);
  res.redirect('/individual/wellness');
}));

app.get('/individual/wellness/history', ipAuth, requireFeaturePlan('individual.wellness'), ah(async (req, res) => {
  const checkins = (await pool.query('SELECT * FROM ind_wellness_checkins WHERE tenant_id=$1 AND user_email=$2 ORDER BY checkin_date DESC LIMIT 90', [tid(req), uem(req)])).rows;
  const moods = {great:'😊',good:'🙂',okay:'😐',low:'😞',bad:'😢'};
  const moodCounts = {};
  checkins.forEach(c => { moodCounts[c.mood] = (moodCounts[c.mood]||0) + 1; });
  const avgStress = checkins.length ? (checkins.reduce((s,c)=>s+Number(c.stress_level||0),0)/checkins.length).toFixed(1) : '-';
  const avgEnergy = checkins.length ? (checkins.reduce((s,c)=>s+Number(c.energy_level||0),0)/checkins.length).toFixed(1) : '-';
  res.send(renderPage('Wellness History', `${ipCSS}${ipNav('health')}
    <h2>Wellness History</h2>
    <div class="ip-grid" style="grid-template-columns:repeat(3,1fr);margin:16px 0">
      <div class="ip-stat"><div class="num">${checkins.length}</div><div class="lbl">Total Check-ins</div></div>
      <div class="ip-stat"><div class="num">${avgStress}</div><div class="lbl">Avg Stress</div></div>
      <div class="ip-stat"><div class="num">${avgEnergy}</div><div class="lbl">Avg Energy</div></div>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px">${Object.entries(moodCounts).map(([m,c])=>`<span class="ip-badge ip-badge-pink">${moods[m]||'😐'} ${m}: ${c}x</span>`).join('')}</div>
    ${checkins.length ? `<table class="ip-table"><tr><th>Date</th><th>Mood</th><th>Stress</th><th>Energy</th><th>Gratitude</th></tr>${checkins.map(r=>`<tr><td>${r.checkin_date}</td><td>${moods[r.mood]||'😐'} ${esc(r.mood)}</td><td>${r.stress_level}/10</td><td>${r.energy_level}/10</td><td>${esc((r.gratitude||'').substring(0,50))}</td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>📊</span>No wellness data yet</div>'}
    <a href="/individual/wellness" class="ip-btn ip-btn-secondary" style="margin-top:16px">Back to Check-in</a>
  `, req.session.user));
}));


// ============================================================
// FEATURES 22-28: KNOWLEDGE & LEARNING
// ============================================================
// FEATURE 22: Book Library
app.get('/individual/books', ipAuth, requireFeaturePlan('individual.books'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_books WHERE tenant_id=$1 AND user_email=$2 ORDER BY created_at DESC', [tid(req), uem(req)])).rows;
  const statusIcon = {want:'📋',reading:'📖',done:'✅'};
  res.send(renderPage('Books', `${ipCSS}${ipNav('books')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Book Library</h2><a href="/individual/books/new" class="ip-btn ip-btn-primary">+ Add Book</a></div>
    ${rows.length ? `<div class="ip-grid">${rows.map(r=>`<div class="ip-card"><h3>${esc(r.title)}</h3><p style="color:#64748b;font-size:13px">by ${esc(r.author||'Unknown')}</p>${r.genre?`<span class="ip-badge ip-badge-pink">${esc(r.genre)}</span>`:''}<div style="margin-top:8px;display:flex;gap:6px;align-items:center"><span style="font-size:20px">${statusIcon[r.status]||'📋'}</span><a href="/individual/books/${r.id}/status?status=${r.status==='want'?'reading':r.status==='reading'?'done':'want'}" class="ip-btn ip-btn-secondary" style="font-size:11px">${r.status==='want'?'Start':r.status==='reading'?'Finish':'Re-read'}</a><a href="/individual/books/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>📚</span>No books yet. Add your first book!</div>'}
  `, req.session.user));
}));

app.get('/individual/books/new', ipAuth, (req, res) => {
  res.send(renderPage('Add Book', `${ipCSS}${ipNav('books')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Book</h2>
    <form method="POST" action="/individual/books/save" class="ip-form">
      <label>Title</label><input name="title" required>
      <label>Author</label><input name="author">
      <label>Genre</label><input name="genre" placeholder="e.g. Fiction, Business">
      <label>Status</label><select name="status"><option value="want">Want to Read</option><option value="reading">Currently Reading</option><option value="done">Finished</option></select>
      <label>Rating (1-5)</label><input name="rating" type="number" min="1" max="5">
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/books" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/books/save', ipAuth, requireFeaturePlan('individual.books'), ah(async (req, res) => {
  const {title,author,genre,status,rating,notes} = req.body;
  await pool.query('INSERT INTO ind_books(tenant_id,user_email,title,author,genre,status,rating,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [tid(req),uem(req),title,author||'',genre||'',status||'want',rating||null,notes||'']);
  res.redirect('/individual/books');
}));

app.get('/individual/books/:id/status', ipAuth, requireFeaturePlan('individual.books'), ah(async (req, res) => {
  await pool.query('UPDATE ind_books SET status=$1 WHERE id=$2 AND tenant_id=$3 AND user_email=$4', [req.query.status||'want', req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/books');
}));

app.get('/individual/books/:id/delete', ipAuth, requireFeaturePlan('individual.books'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_books WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/books');
}));

// FEATURE 23: Skill Tracker
app.get('/individual/skills', ipAuth, requireFeaturePlan('individual.skills'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_skills WHERE tenant_id=$1 AND user_email=$2 ORDER BY progress DESC', [tid(req), uem(req)])).rows;
  const lvlColor = {beginner:'ip-badge-gray',intermediate:'ip-badge-blue',advanced:'ip-badge-yellow',expert:'ip-badge-green'};
  res.send(renderPage('Skills', `${ipCSS}${ipNav('books')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Skill Tracker</h2><a href="/individual/skills/new" class="ip-btn ip-btn-primary">+ Add Skill</a></div>
    ${rows.length ? `<div class="ip-grid">${rows.map(r=>`<div class="ip-card"><h3>${esc(r.name)}</h3><span class="ip-badge ${lvlColor[r.level]||'ip-badge-gray'}">${esc(r.level||'beginner')}</span><div class="ip-progress" style="margin-top:10px"><div class="ip-progress-bar" style="width:${r.progress}%"></div></div><p style="font-size:12px;color:#ec4899;font-weight:600;margin-top:4px">${r.progress}%</p><div style="margin-top:8px;display:flex;gap:4px"><a href="/individual/skills/${r.id}/progress?add=10" class="ip-btn ip-btn-success" style="font-size:11px">+10%</a><a href="/individual/skills/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>🎯</span>No skills tracked</div>'}
  `, req.session.user));
}));

app.get('/individual/skills/new', ipAuth, requireFeaturePlan('individual.skills'), (req, res) => {
  res.send(renderPage('Add Skill', `${ipCSS}${ipNav('books')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Skill</h2>
    <form method="POST" action="/individual/skills/save" class="ip-form">
      <label>Skill Name</label><input name="name" required>
      <label>Category</label><input name="category" placeholder="e.g. Programming, Design">
      <label>Level</label><select name="level"><option value="beginner">Beginner</option><option value="intermediate">Intermediate</option><option value="advanced">Advanced</option><option value="expert">Expert</option></select>
      <label>Progress (%)</label><input name="progress" type="number" min="0" max="100" value="0">
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/skills" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/skills/save', ipAuth, requireFeaturePlan('individual.skills'), ah(async (req, res) => {
  const {name,category,level,progress} = req.body;
  await pool.query('INSERT INTO ind_skills(tenant_id,user_email,name,category,level,progress) VALUES($1,$2,$3,$4,$5,$6)', [tid(req),uem(req),name,category||'',level||'beginner',Math.min(100,progress||0)]);
  res.redirect('/individual/skills');
}));

app.get('/individual/skills/:id/progress', ipAuth, requireFeaturePlan('individual.skills'), ah(async (req, res) => {
  const add = Number(req.query.add || 10);
  await pool.query('UPDATE ind_skills SET progress=LEAST(100,progress+$1) WHERE id=$2 AND tenant_id=$3 AND user_email=$4', [add, req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/skills');
}));

app.get('/individual/skills/:id/delete', ipAuth, requireFeaturePlan('individual.skills'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_skills WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/skills');
}));

// FEATURE 24: Course Tracker
app.get('/individual/courses', ipAuth, requireFeaturePlan('individual.courses'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_courses WHERE tenant_id=$1 AND user_email=$2 ORDER BY progress DESC', [tid(req), uem(req)])).rows;
  res.send(renderPage('Courses', `${ipCSS}${ipNav('books')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Course Tracker</h2><a href="/individual/courses/new" class="ip-btn ip-btn-primary">+ Add Course</a></div>
    ${rows.length ? `<div class="ip-grid">${rows.map(r=>`<div class="ip-card"><h3>${esc(r.title)}</h3><p style="color:#64748b;font-size:13px">${esc(r.provider||'')} &middot; <span class="ip-badge ${r.status==='completed'?'ip-badge-green':'ip-badge-blue'}">${esc(r.status)}</span></p><div class="ip-progress"><div class="ip-progress-bar" style="width:${r.progress}%"></div></div><p style="font-size:12px;font-weight:600;color:#ec4899;margin-top:4px">${r.progress}%</p><div style="margin-top:6px;display:flex;gap:4px"><a href="/individual/courses/${r.id}/progress?add=10" class="ip-btn ip-btn-success" style="font-size:11px">+10%</a><a href="/individual/courses/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>🎓</span>No courses tracked</div>'}
  `, req.session.user));
}));

app.get('/individual/courses/new', ipAuth, requireFeaturePlan('individual.courses'), (req, res) => {
  res.send(renderPage('Add Course', `${ipCSS}${ipNav('books')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Course</h2>
    <form method="POST" action="/individual/courses/save" class="ip-form">
      <label>Title</label><input name="title" required>
      <label>Provider</label><input name="provider" placeholder="e.g. Coursera, Udemy">
      <label>Category</label><input name="category">
      <label>Progress (%)</label><input name="progress" type="number" min="0" max="100" value="0">
      <label>Deadline</label><input name="deadline" type="date">
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/courses" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/courses/save', ipAuth, requireFeaturePlan('individual.courses'), ah(async (req, res) => {
  const {title,provider,category,progress,deadline} = req.body;
  const status = Number(progress) >= 100 ? 'completed' : 'in_progress';
  await pool.query('INSERT INTO ind_courses(tenant_id,user_email,title,provider,category,progress,status,deadline) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [tid(req),uem(req),title,provider||'',category||'',Math.min(100,progress||0),status,deadline||null]);
  res.redirect('/individual/courses');
}));

app.get('/individual/courses/:id/progress', ipAuth, requireFeaturePlan('individual.courses'), ah(async (req, res) => {
  const add = Number(req.query.add || 10);
  await pool.query('UPDATE ind_courses SET progress=LEAST(100,progress+$1), status=CASE WHEN progress+$1>=100 THEN \'completed\' ELSE status END WHERE id=$2 AND tenant_id=$3 AND user_email=$4', [add, req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/courses');
}));

app.get('/individual/courses/:id/delete', ipAuth, requireFeaturePlan('individual.courses'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_courses WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/courses');
}));

// FEATURE 25: Bookmark Manager
app.get('/individual/bookmarks', ipAuth, requireFeaturePlan('individual.bookmarks'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_bookmarks WHERE tenant_id=$1 AND user_email=$2 ORDER BY created_at DESC', [tid(req), uem(req)])).rows;
  res.send(renderPage('Bookmarks', `${ipCSS}${ipNav('books')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Bookmark Manager</h2><a href="/individual/bookmarks/new" class="ip-btn ip-btn-primary">+ Add</a></div>
    ${rows.length ? `<div class="ip-grid">${rows.map(r=>`<div class="ip-card"><h3>${esc(r.title)}</h3>${r.url?`<a href="${esc(r.url)}" target="_blank" style="color:#4f46e5;font-size:13px;word-break:break-all">${esc(r.url)}</a>`:''}${r.category?`<span class="ip-badge ip-badge-pink" style="margin-top:6px">${esc(r.category)}</span>`:''}<div style="margin-top:8px"><a href="/individual/bookmarks/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Delete</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>🔖</span>No bookmarks saved</div>'}
  `, req.session.user));
}));

app.get('/individual/bookmarks/new', ipAuth, requireFeaturePlan('individual.bookmarks'), (req, res) => {
  res.send(renderPage('Add Bookmark', `${ipCSS}${ipNav('books')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Bookmark</h2>
    <form method="POST" action="/individual/bookmarks/save" class="ip-form">
      <label>Title</label><input name="title" required>
      <label>URL</label><input name="url" type="url" placeholder="https://...">
      <label>Category</label><input name="category" placeholder="e.g. Dev, Design, News">
      <label>Tags</label><input name="tags" placeholder="comma separated">
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/bookmarks" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/bookmarks/save', ipAuth, requireFeaturePlan('individual.bookmarks'), ah(async (req, res) => {
  const {title,url,category,tags,notes} = req.body;
  await pool.query('INSERT INTO ind_bookmarks(tenant_id,user_email,title,url,category,tags,notes) VALUES($1,$2,$3,$4,$5,$6,$7)', [tid(req),uem(req),title,url||'',category||'',tags||'',notes||'']);
  res.redirect('/individual/bookmarks');
}));

app.get('/individual/bookmarks/:id/delete', ipAuth, requireFeaturePlan('individual.bookmarks'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_bookmarks WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/bookmarks');
}));

// FEATURE 26: Flashcards
app.get('/individual/flashcards', ipAuth, requireFeaturePlan('individual.flashcards'), ah(async (req, res) => {
  const decks = (await pool.query('SELECT d.*, (SELECT COUNT(*) FROM ind_flashcards WHERE deck_id=d.id) as card_count FROM ind_flashcard_decks d WHERE d.tenant_id=$1 AND d.user_email=$2 ORDER BY d.created_at DESC', [tid(req), uem(req)])).rows;
  res.send(renderPage('Flashcards', `${ipCSS}${ipNav('books')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Flashcard Decks</h2><a href="/individual/flashcards/new" class="ip-btn ip-btn-primary">+ New Deck</a></div>
    ${decks.length ? `<div class="ip-grid">${decks.map(d=>`<div class="ip-card"><h3>${esc(d.name)}</h3><p style="color:#64748b;font-size:13px">${d.card_count} cards${d.category?' &middot; '+esc(d.category):''}</p><div style="margin-top:8px;display:flex;gap:6px"><a href="/individual/flashcards/deck/${d.id}" class="ip-btn ip-btn-primary" style="font-size:11px">Study</a><a href="/individual/flashcards/${d.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete deck?')">Del</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>🃏</span>No flashcard decks</div>'}
  `, req.session.user));
}));

app.get('/individual/flashcards/new', ipAuth, requireFeaturePlan('individual.flashcards'), (req, res) => {
  res.send(renderPage('New Deck', `${ipCSS}${ipNav('books')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Create Flashcard Deck</h2>
    <form method="POST" action="/individual/flashcards/save" class="ip-form">
      <label>Deck Name</label><input name="name" required>
      <label>Description</label><textarea name="description" rows="2"></textarea>
      <label>Category</label><input name="category">
      <h3 style="margin-top:16px">Cards</h3>
      <div id="cards"><div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:10px"><label>Front</label><input name="front_1" placeholder="Question"><label>Back</label><input name="back_1" placeholder="Answer"></div></div>
      <button type="button" onclick="addCard()" class="ip-btn ip-btn-secondary" style="margin-bottom:12px">+ Add Card</button>
      <button type="submit" class="ip-btn ip-btn-primary">Create Deck</button>
      <a href="/individual/flashcards" class="ip-btn ip-btn-secondary">Cancel</a>
    </form>
    <script>var cn=1;function addCard(){cn++;document.getElementById('cards').insertAdjacentHTML('beforeend','<div style="border:1px solid #e2e8f0;border-radius:10px;padding:12px;margin-bottom:10px"><label>Front</label><input name=\"front_'+cn+'\" placeholder=\"Question\"><label>Back</label><input name=\"back_'+cn+'\" placeholder=\"Answer\"></div>')}</script></div>
  `, req.session.user));
});

app.post('/individual/flashcards/save', ipAuth, requireFeaturePlan('individual.flashcards'), ah(async (req, res) => {
  const {name, description, category} = req.body;
  const deck = await pool.query('INSERT INTO ind_flashcard_decks(tenant_id,user_email,name,description,category) VALUES($1,$2,$3,$4,$5) RETURNING id', [tid(req),uem(req),name,description||'',category||'']);
  const deckId = deck.rows[0].id;
  // Add cards
  let i = 1;
  while (req.body['front_'+i] !== undefined) {
    const front = req.body['front_'+i];
    const back = req.body['back_'+i];
    if (front && back) {
      await pool.query('INSERT INTO ind_flashcards(tenant_id,deck_id,front,back) VALUES($1,$2,$3,$4)', [tid(req), deckId, front, back]);
    }
    i++;
  }
  res.redirect('/individual/flashcards');
}));

app.get('/individual/flashcards/deck/:id', ipAuth, requireFeaturePlan('individual.flashcards'), ah(async (req, res) => {
  const deck = (await pool.query('SELECT * FROM ind_flashcard_decks WHERE id=$1 AND tenant_id=$2', [req.params.id, tid(req)])).rows[0];
  const cards = (await pool.query('SELECT * FROM ind_flashcards WHERE deck_id=$1 AND tenant_id=$2', [req.params.id, tid(req)])).rows;
  if (!deck) return res.redirect('/individual/flashcards');
  res.send(renderPage('Study Flashcards', `${ipCSS}${ipNav('books')}
    <h2>${esc(deck.name)}</h2><p style="color:#64748b;margin-bottom:16px">${cards.length} cards</p>
    <div style="max-width:500px;margin:0 auto;text-align:center">
      <div id="card" style="height:250px;display:flex;align-items:center;justify-content:center;background:white;border-radius:16px;border:2px solid #ec4899;font-size:18px;padding:30px;cursor:pointer;transition:.3s" onclick="this.classList.toggle('flipped')">
        <div id="cardContent">${esc(cards[0]?.front||'No cards')}</div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;justify-content:center">
        <button onclick="prevCard()" class="ip-btn ip-btn-secondary">Previous</button>
        <button onclick="nextCard()" class="ip-btn ip-btn-primary">Next</button>
      </div>
      <p style="color:#94a3b8;font-size:12px;margin-top:10px">Click card to flip</p>
    </div>
    <script>var cards=${JSON.stringify(cards.map(c=>({f:c.front,b:c.back})))},idx=0,showing='front';function show(){var c=cards[idx];document.getElementById('cardContent').textContent=showing==='front'?c.f:c.b}function nextCard(){idx=(idx+1)%cards.length;showing='front';show()}function prevCard(){idx=(idx-1+cards.length)%cards.length;showing='front';show()}document.getElementById('card').onclick=function(){showing=showing==='front'?'back':'front';show()}</script>
  `, req.session.user));
}));

app.get('/individual/flashcards/:id/delete', ipAuth, requireFeaturePlan('individual.flashcards'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_flashcard_decks WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/flashcards');
}));

app.post('/individual/flashcards/:id/study', ipAuth, requireFeaturePlan('individual.flashcards'), ah(async (req, res) => {
  const {confidence} = req.body;
  await pool.query('UPDATE ind_flashcards SET last_studied=NOW(), confidence=$1 WHERE id=$2 AND tenant_id=$3', [confidence||0, req.params.id, tid(req)]);
  res.redirect('back');
}));

// FEATURE 27: Contact Book
app.get('/individual/contacts', ipAuth, requireFeaturePlan('individual.contacts'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_contacts WHERE tenant_id=$1 AND user_email=$2 ORDER BY name', [tid(req), uem(req)])).rows;
  res.send(renderPage('Contacts', `${ipCSS}${ipNav('contacts')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Contact Book</h2><a href="/individual/contacts/new" class="ip-btn ip-btn-primary">+ Add Contact</a></div>
    ${rows.length ? `<table class="ip-table"><tr><th>Name</th><th>Phone</th><th>Email</th><th>Company</th><th>Actions</th></tr>${rows.map(r=>`<tr><td><strong>${esc(r.name)}</strong></td><td>${esc(r.phone||'-')}</td><td>${esc(r.email||'-')}</td><td>${esc(r.company||'-')}</td><td><a href="/individual/contacts/${r.id}/edit" class="ip-btn ip-btn-secondary" style="font-size:11px">Edit</a> <a href="/individual/contacts/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>👤</span>No contacts yet</div>'}
  `, req.session.user));
}));

app.get('/individual/contacts/new', ipAuth, (req, res) => {
  res.send(renderPage('Add Contact', `${ipCSS}${ipNav('contacts')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Contact</h2>
    <form method="POST" action="/individual/contacts/save" class="ip-form">
      <label>Full Name</label><input name="name" required>
      <label>Phone</label><input name="phone" placeholder="+256...">
      <label>Email</label><input name="email" type="email">
      <label>Company</label><input name="company">
      <label>Category</label><input name="category" placeholder="e.g. Friend, Work, Family">
      <label>Address</label><input name="address">
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/contacts" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/contacts/save', ipAuth, requireFeaturePlan('individual.contacts'), ah(async (req, res) => {
  const {name,phone,email,company,category,address,notes} = req.body;
  await pool.query('INSERT INTO ind_contacts(tenant_id,user_email,name,phone,email,company,category,address,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [tid(req),uem(req),name,phone||'',email||'',company||'',category||'',address||'',notes||'']);
  res.redirect('/individual/contacts');
}));

app.get('/individual/contacts/:id/edit', ipAuth, requireFeaturePlan('individual.contacts'), ah(async (req, res) => {
  const c = (await pool.query('SELECT * FROM ind_contacts WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)])).rows[0];
  if (!c) return res.redirect('/individual/contacts');
  res.send(renderPage('Edit Contact', `${ipCSS}${ipNav('contacts')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Edit Contact</h2>
    <form method="POST" action="/individual/contacts/${c.id}/update" class="ip-form">
      <label>Full Name</label><input name="name" value="${esc(c.name)}" required>
      <label>Phone</label><input name="phone" value="${esc(c.phone||'')}">
      <label>Email</label><input name="email" type="email" value="${esc(c.email||'')}">
      <label>Company</label><input name="company" value="${esc(c.company||'')}">
      <label>Category</label><input name="category" value="${esc(c.category||'')}">
      <label>Address</label><input name="address" value="${esc(c.address||'')}">
      <label>Notes</label><textarea name="notes" rows="2">${esc(c.notes||'')}</textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Update</button>
      <a href="/individual/contacts" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
}));

app.post('/individual/contacts/:id/update', ipAuth, requireFeaturePlan('individual.contacts'), ah(async (req, res) => {
  const {name,phone,email,company,category,address,notes} = req.body;
  await pool.query('UPDATE ind_contacts SET name=$1,phone=$2,email=$3,company=$4,category=$5,address=$6,notes=$7 WHERE id=$8 AND tenant_id=$9 AND user_email=$10', [name,phone||'',email||'',company||'',category||'',address||'',notes||'',req.params.id,tid(req),uem(req)]);
  res.redirect('/individual/contacts');
}));

app.get('/individual/contacts/:id/delete', ipAuth, requireFeaturePlan('individual.contacts'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_contacts WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/contacts');
}));

// FEATURE 28: Personal Wiki
app.get('/individual/wiki', ipAuth, requireFeaturePlan('individual.wiki'), ah(async (req, res) => {
  const pages = (await pool.query('SELECT * FROM ind_wiki_pages WHERE tenant_id=$1 AND user_email=$2 ORDER BY category, title', [tid(req), uem(req)])).rows;
  res.send(renderPage('Wiki', `${ipCSS}${ipNav('books')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Personal Wiki</h2><a href="/individual/wiki/new" class="ip-btn ip-btn-primary">+ New Page</a></div>
    ${pages.length ? `<div class="ip-grid">${pages.map(p=>`<div class="ip-card"><h3><a href="/individual/wiki/${p.id}" style="color:#ec4899;text-decoration:none">${esc(p.title)}</a></h3>${p.category?`<span class="ip-badge ip-badge-pink">${esc(p.category)}</span>`:''}<p style="font-size:13px;color:#64748b;margin-top:8px">${esc((p.content||'').substring(0,100))}...</p><div style="margin-top:6px;display:flex;gap:4px"><a href="/individual/wiki/${p.id}/edit" class="ip-btn ip-btn-secondary" style="font-size:11px">Edit</a><a href="/individual/wiki/${p.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>📝</span>No wiki pages</div>'}
  `, req.session.user));
}));

app.get('/individual/wiki/new', ipAuth, requireFeaturePlan('individual.wiki'), (req, res) => {
  res.send(renderPage('New Wiki Page', `${ipCSS}${ipNav('books')}
    <div class="ip-card" style="max-width:600px;margin:0 auto"><h2>New Wiki Page</h2>
    <form method="POST" action="/individual/wiki/save" class="ip-form">
      <label>Title</label><input name="title" required>
      <label>Category</label><input name="category" placeholder="e.g. Notes, Reference">
      <label>Content</label><textarea name="content" rows="12" placeholder="Write your wiki content here..."></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/wiki" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/wiki/save', ipAuth, requireFeaturePlan('individual.wiki'), ah(async (req, res) => {
  const {title,category,content} = req.body;
  await pool.query('INSERT INTO ind_wiki_pages(tenant_id,user_email,title,content,category) VALUES($1,$2,$3,$4,$5)', [tid(req),uem(req),title,content||'',category||'']);
  res.redirect('/individual/wiki');
}));

app.get('/individual/wiki/:id', ipAuth, requireFeaturePlan('individual.wiki'), ah(async (req, res) => {
  const p = (await pool.query('SELECT * FROM ind_wiki_pages WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)])).rows[0];
  if (!p) return res.redirect('/individual/wiki');
  res.send(renderPage(p.title, `${ipCSS}${ipNav('books')}
    <div class="ip-card" style="max-width:700px;margin:0 auto"><h2>${esc(p.title)}</h2>${p.category?`<span class="ip-badge ip-badge-pink">${esc(p.category)}</span>`:''}<div style="margin-top:16px;font-size:15px;line-height:1.8;white-space:pre-wrap">${esc(p.content||'')}</div>
    <div style="margin-top:20px"><a href="/individual/wiki/${p.id}/edit" class="ip-btn ip-btn-primary">Edit</a> <a href="/individual/wiki" class="ip-btn ip-btn-secondary">Back</a></div></div>
  `, req.session.user));
}));

app.get('/individual/wiki/:id/edit', ipAuth, requireFeaturePlan('individual.wiki'), ah(async (req, res) => {
  const p = (await pool.query('SELECT * FROM ind_wiki_pages WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)])).rows[0];
  if (!p) return res.redirect('/individual/wiki');
  res.send(renderPage('Edit Wiki', `${ipCSS}${ipNav('books')}
    <div class="ip-card" style="max-width:600px;margin:0 auto"><h2>Edit: ${esc(p.title)}</h2>
    <form method="POST" action="/individual/wiki/${p.id}/update" class="ip-form">
      <label>Title</label><input name="title" value="${esc(p.title)}" required>
      <label>Category</label><input name="category" value="${esc(p.category||'')}">
      <label>Content</label><textarea name="content" rows="12">${esc(p.content||'')}</textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Update</button>
      <a href="/individual/wiki/${p.id}" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
}));

app.post('/individual/wiki/:id/update', ipAuth, requireFeaturePlan('individual.wiki'), ah(async (req, res) => {
  const {title,category,content} = req.body;
  await pool.query('UPDATE ind_wiki_pages SET title=$1,category=$2,content=$3,updated_at=NOW() WHERE id=$4 AND tenant_id=$5 AND user_email=$6', [title,category||'',content||'',req.params.id,tid(req),uem(req)]);
  res.redirect('/individual/wiki/'+req.params.id);
}));

app.get('/individual/wiki/:id/delete', ipAuth, requireFeaturePlan('individual.wiki'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_wiki_pages WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/wiki');
}));


// ============================================================
// FEATURES 29-35: LIFESTYLE & SOCIAL
// ============================================================
// FEATURE 29: Travel Planner
app.get('/individual/travel', ipAuth, requireFeaturePlan('individual.travel'), ah(async (req, res) => {
  const trips = (await pool.query('SELECT * FROM ind_trips WHERE tenant_id=$1 AND user_email=$2 ORDER BY start_date DESC', [tid(req), uem(req)])).rows;
  res.send(renderPage('Travel', `${ipCSS}${ipNav('travel')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Travel Planner</h2><a href="/individual/travel/new" class="ip-btn ip-btn-primary">+ New Trip</a></div>
    ${trips.length ? `<div class="ip-grid">${trips.map(t=>`<div class="ip-card"><h3>${esc(t.name)}</h3><p style="color:#64748b;font-size:13px">📍 ${esc(t.destination||'TBD')} &middot; ${t.start_date||'?'} → ${t.end_date||'?'}</p>${t.budget?`<p style="font-size:13px">Budget: ${Number(t.budget).toLocaleString()}</p>`:''}<span class="ip-badge ${t.status==='completed'?'ip-badge-green':t.status==='planning'?'ip-badge-blue':'ip-badge-pink'}">${esc(t.status)}</span><div style="margin-top:8px;display:flex;gap:6px"><a href="/individual/travel/${t.id}" class="ip-btn ip-btn-primary" style="font-size:11px">View</a><a href="/individual/travel/${t.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>✈️</span>No trips planned yet</div>'}
  `, req.session.user));
}));

app.get('/individual/travel/new', ipAuth, requireFeaturePlan('individual.travel'), (req, res) => {
  res.send(renderPage('New Trip', `${ipCSS}${ipNav('travel')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Plan New Trip</h2>
    <form method="POST" action="/individual/travel/save" class="ip-form">
      <label>Trip Name</label><input name="name" placeholder="e.g. Weekend Getaway" required>
      <label>Destination</label><input name="destination">
      <label>Start Date</label><input name="start_date" type="date">
      <label>End Date</label><input name="end_date" type="date">
      <label>Budget</label><input name="budget" type="number" step="0.01">
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Create Trip</button>
      <a href="/individual/travel" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/travel/save', ipAuth, requireFeaturePlan('individual.travel'), ah(async (req, res) => {
  const {name,destination,start_date,end_date,budget,notes} = req.body;
  await pool.query('INSERT INTO ind_trips(tenant_id,user_email,name,destination,start_date,end_date,budget,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [tid(req),uem(req),name,destination||'',start_date||null,end_date||null,budget||0,notes||'']);
  res.redirect('/individual/travel');
}));

app.get('/individual/travel/:id', ipAuth, requireFeaturePlan('individual.travel'), ah(async (req, res) => {
  const trip = (await pool.query('SELECT * FROM ind_trips WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)])).rows[0];
  if (!trip) return res.redirect('/individual/travel');
  const items = (await pool.query('SELECT * FROM ind_trip_items WHERE trip_id=$1 AND tenant_id=$2 ORDER BY date, time', [req.params.id, tid(req)])).rows;
  res.send(renderPage(trip.name, `${ipCSS}${ipNav('travel')}
    <h2>${esc(trip.name)}</h2><p style="color:#64748b">📍 ${esc(trip.destination)} &middot; ${trip.start_date||'?'} → ${trip.end_date||'?'}</p>
    <div style="margin:16px 0"><h3>Add Item</h3>
    <form method="POST" action="/individual/travel/${trip.id}/add-item" class="ip-form" style="display:flex;gap:8px;flex-wrap:wrap;align-items:end">
      <div><label>Type</label><select name="item_type"><option>Activity</option><option>Flight</option><option>Hotel</option><option>Transport</option><option>Food</option><option>Packing</option></select></div>
      <div><label>Name</label><input name="name" required></div>
      <div><label>Date</label><input name="date" type="date"></div>
      <div><label>Cost</label><input name="cost" type="number" step="0.01"></div>
      <button type="submit" class="ip-btn ip-btn-primary">Add</button>
    </form></div>
    ${items.length ? `<table class="ip-table"><tr><th>Type</th><th>Name</th><th>Date</th><th>Cost</th></tr>${items.map(i=>`<tr><td><span class="ip-badge ip-badge-pink">${esc(i.item_type)}</span></td><td>${esc(i.name)}</td><td>${i.date||'-'}</td><td>${Number(i.cost||0).toLocaleString()}</td></tr>`).join('')}</table>` : '<p style="color:#94a3b8">No items yet</p>'}
    <a href="/individual/travel" class="ip-btn ip-btn-secondary" style="margin-top:12px">Back to Trips</a>
  `, req.session.user));
}));

app.post('/individual/travel/:id/add-item', ipAuth, requireFeaturePlan('individual.travel'), ah(async (req, res) => {
  const {item_type,name,date,time,cost,notes} = req.body;
  await pool.query('INSERT INTO ind_trip_items(tenant_id,trip_id,item_type,name,date,time,cost,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [tid(req),req.params.id,item_type||'Activity',name,date||null,time||null,cost||0,notes||'']);
  res.redirect('/individual/travel/'+req.params.id);
}));

app.get('/individual/travel/:id/delete', ipAuth, requireFeaturePlan('individual.travel'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_trips WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/travel');
}));

// FEATURE 30: Recipe Book
app.get('/individual/recipes', ipAuth, requireFeaturePlan('individual.recipes'), ah(async (req, res) => {
  const rows = (await pool.query('SELECT * FROM ind_recipes WHERE tenant_id=$1 AND user_email=$2 ORDER BY title', [tid(req), uem(req)])).rows;
  res.send(renderPage('Recipes', `${ipCSS}${ipNav('travel')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Recipe Book</h2><a href="/individual/recipes/new" class="ip-btn ip-btn-primary">+ Add Recipe</a></div>
    ${rows.length ? `<div class="ip-grid">${rows.map(r=>`<div class="ip-card"><h3><a href="/individual/recipes/${r.id}" style="color:#ec4899;text-decoration:none">${esc(r.title)}</a></h3>${r.category?`<span class="ip-badge ip-badge-pink">${esc(r.category)}</span>`:''}<p style="font-size:13px;color:#64748b;margin-top:6px">${r.cook_time?r.cook_time+' min':''}${r.servings?' &middot; Serves '+r.servings:''}</p><a href="/individual/recipes/${r.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px;margin-top:6px" onclick="return confirm('Delete?')">Delete</a></div>`).join('')}</div>` : '<div class="ip-empty"><span>🍳</span>No recipes saved</div>'}
  `, req.session.user));
}));

app.get('/individual/recipes/new', ipAuth, requireFeaturePlan('individual.recipes'), (req, res) => {
  res.send(renderPage('Add Recipe', `${ipCSS}${ipNav('travel')}
    <div class="ip-card" style="max-width:600px;margin:0 auto"><h2>Add Recipe</h2>
    <form method="POST" action="/individual/recipes/save" class="ip-form">
      <label>Title</label><input name="title" required>
      <label>Category</label><input name="category" placeholder="e.g. Breakfast, Ugandan, Dessert">
      <label>Cook Time (minutes)</label><input name="cook_time" type="number">
      <label>Servings</label><input name="servings" type="number">
      <label>Ingredients</label><textarea name="ingredients" rows="5" placeholder="One ingredient per line"></textarea>
      <label>Steps</label><textarea name="steps" rows="8" placeholder="Step by step instructions"></textarea>
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save Recipe</button>
      <a href="/individual/recipes" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/recipes/save', ipAuth, requireFeaturePlan('individual.recipes'), ah(async (req, res) => {
  const {title,category,cook_time,servings,ingredients,steps,notes} = req.body;
  await pool.query('INSERT INTO ind_recipes(tenant_id,user_email,title,ingredients,steps,cook_time,servings,category,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [tid(req),uem(req),title,ingredients||'',steps||'',cook_time||0,servings||0,category||'',notes||'']);
  res.redirect('/individual/recipes');
}));

app.get('/individual/recipes/:id', ipAuth, requireFeaturePlan('individual.recipes'), ah(async (req, res) => {
  const r = (await pool.query('SELECT * FROM ind_recipes WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)])).rows[0];
  if (!r) return res.redirect('/individual/recipes');
  res.send(renderPage(r.title, `${ipCSS}${ipNav('travel')}
    <div class="ip-card" style="max-width:700px;margin:0 auto"><h2>${esc(r.title)}</h2>
    ${r.category?`<span class="ip-badge ip-badge-pink">${esc(r.category)}</span>`:''}<p style="color:#64748b;font-size:14px;margin:8px 0">${r.cook_time?'⏱️ '+r.cook_time+' min':''}${r.servings?' &middot; 🍽️ Serves '+r.servings:''}</p>
    <h3 style="margin-top:16px">Ingredients</h3><div style="white-space:pre-wrap;font-size:14px;line-height:1.8">${esc(r.ingredients||'None listed')}</div>
    <h3 style="margin-top:16px">Steps</h3><div style="white-space:pre-wrap;font-size:14px;line-height:1.8">${esc(r.steps||'No steps')}</div>
    <a href="/individual/recipes" class="ip-btn ip-btn-secondary" style="margin-top:16px">Back</a> <a href="/individual/recipes/${r.id}/delete" class="ip-btn ip-btn-danger" onclick="return confirm('Delete?')">Delete</a></div>
  `, req.session.user));
}));

app.get('/individual/recipes/:id/delete', ipAuth, requireFeaturePlan('individual.recipes'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_recipes WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/recipes');
}));

// FEATURE 31: Wishlist
app.get('/individual/wishlist', ipAuth, requireFeaturePlan('individual.wishlist'), ah(async (req, res) => {
  const items = (await pool.query('SELECT * FROM ind_wishlist_items WHERE tenant_id=$1 AND user_email=$2 ORDER BY purchased, priority DESC', [tid(req), uem(req)])).rows;
  const total = items.filter(i=>!i.purchased).reduce((s,i)=>s+Number(i.estimated_cost||0),0);
  res.send(renderPage('Wishlist', `${ipCSS}${ipNav('wishlist')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Wishlist</h2><a href="/individual/wishlist/new" class="ip-btn ip-btn-primary">+ Add Item</a></div>
    <div class="ip-stat" style="max-width:300px;margin-bottom:20px"><div class="num">${total.toLocaleString()}</div><div class="lbl">Total Wish Value</div></div>
    ${items.length ? `<table class="ip-table"><tr><th>Item</th><th>Cost</th><th>Priority</th><th>Status</th><th>Actions</th></tr>${items.map(i=>`<tr style="${i.purchased?'opacity:.5':''}"><td><strong>${esc(i.name)}</strong></td><td>${Number(i.estimated_cost||0).toLocaleString()}</td><td><span class="ip-badge ${i.priority==='high'?'ip-badge-pink':i.priority==='medium'?'ip-badge-yellow':'ip-badge-gray'}">${esc(i.priority)}</span></td><td>${i.purchased?'<span class="ip-badge ip-badge-green">Purchased</span>':'Pending'}</td><td>${!i.purchased?`<a href="/individual/wishlist/${i.id}/purchase" class="ip-btn ip-btn-success" style="font-size:11px">Bought</a>`:''} <a href="/individual/wishlist/${i.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>🎁</span>Your wishlist is empty</div>'}
  `, req.session.user));
}));

app.get('/individual/wishlist/new', ipAuth, requireFeaturePlan('individual.wishlist'), (req, res) => {
  res.send(renderPage('Add to Wishlist', `${ipCSS}${ipNav('wishlist')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add to Wishlist</h2>
    <form method="POST" action="/individual/wishlist/save" class="ip-form">
      <label>Item Name</label><input name="name" required>
      <label>Estimated Cost</label><input name="estimated_cost" type="number" step="0.01">
      <label>Priority</label><select name="priority"><option value="low">Low</option><option value="medium" selected>Medium</option><option value="high">High</option></select>
      <label>URL</label><input name="url" type="url" placeholder="Link to product">
      <label>Notes</label><input name="notes">
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/wishlist" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/wishlist/save', ipAuth, requireFeaturePlan('individual.wishlist'), ah(async (req, res) => {
  const {name,estimated_cost,priority,url,notes} = req.body;
  await pool.query('INSERT INTO ind_wishlist_items(tenant_id,user_email,name,estimated_cost,priority,url,notes) VALUES($1,$2,$3,$4,$5,$6,$7)', [tid(req),uem(req),name,estimated_cost||0,priority||'medium',url||'',notes||'']);
  res.redirect('/individual/wishlist');
}));

app.get('/individual/wishlist/:id/purchase', ipAuth, requireFeaturePlan('individual.wishlist'), ah(async (req, res) => {
  await pool.query('UPDATE ind_wishlist_items SET purchased=true WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/wishlist');
}));

app.get('/individual/wishlist/:id/delete', ipAuth, requireFeaturePlan('individual.wishlist'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_wishlist_items WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/wishlist');
}));

// FEATURE 32: Subscription Manager
app.get('/individual/subscriptions', ipAuth, requireFeaturePlan('individual.subscriptions'), ah(async (req, res) => {
  const subs = (await pool.query('SELECT * FROM ind_subscriptions WHERE tenant_id=$1 AND user_email=$2 ORDER BY is_active DESC, next_billing', [tid(req), uem(req)])).rows;
  const monthly = subs.filter(s=>s.is_active).reduce((s,r)=>s+Number(r.cost||0),0);
  res.send(renderPage('Subscriptions', `${ipCSS}${ipNav('wishlist')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Subscription Manager</h2><a href="/individual/subscriptions/new" class="ip-btn ip-btn-primary">+ Add</a></div>
    <div class="ip-stat" style="max-width:300px;margin-bottom:20px"><div class="num">${monthly.toLocaleString()}</div><div class="lbl">Monthly Total</div></div>
    ${subs.length ? `<table class="ip-table"><tr><th>Name</th><th>Cost</th><th>Cycle</th><th>Next Billing</th><th>Status</th><th>Actions</th></tr>${subs.map(s=>`<tr><td><strong>${esc(s.name)}</strong></td><td>${Number(s.cost||0).toLocaleString()}</td><td>${esc(s.billing_cycle)}</td><td>${s.next_billing||'-'}</td><td><span class="ip-badge ${s.is_active?'ip-badge-green':'ip-badge-gray'}">${s.is_active?'Active':'Cancelled'}</span></td><td><a href="/individual/subscriptions/${s.id}/toggle" class="ip-btn ip-btn-secondary" style="font-size:11px">${s.is_active?'Cancel':'Reactivate'}</a> <a href="/individual/subscriptions/${s.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>📺</span>No subscriptions tracked</div>'}
  `, req.session.user));
}));

app.get('/individual/subscriptions/new', ipAuth, requireFeaturePlan('individual.subscriptions'), (req, res) => {
  res.send(renderPage('Add Subscription', `${ipCSS}${ipNav('wishlist')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Subscription</h2>
    <form method="POST" action="/individual/subscriptions/save" class="ip-form">
      <label>Name</label><input name="name" placeholder="e.g. Netflix, Spotify" required>
      <label>Cost</label><input name="cost" type="number" step="0.01" required>
      <label>Billing Cycle</label><select name="billing_cycle"><option value="monthly" selected>Monthly</option><option value="yearly">Yearly</option><option value="weekly">Weekly</option></select>
      <label>Next Billing Date</label><input name="next_billing" type="date">
      <label>Category</label><input name="category" placeholder="e.g. Entertainment, Work">
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/subscriptions" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/subscriptions/save', ipAuth, requireFeaturePlan('individual.subscriptions'), ah(async (req, res) => {
  const {name,cost,billing_cycle,next_billing,category} = req.body;
  await pool.query('INSERT INTO ind_subscriptions(tenant_id,user_email,name,cost,billing_cycle,next_billing,category) VALUES($1,$2,$3,$4,$5,$6,$7)', [tid(req),uem(req),name,cost,billing_cycle||'monthly',next_billing||null,category||'']);
  res.redirect('/individual/subscriptions');
}));

app.get('/individual/subscriptions/:id/toggle', ipAuth, requireFeaturePlan('individual.subscriptions'), ah(async (req, res) => {
  await pool.query('UPDATE ind_subscriptions SET is_active=NOT is_active WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/subscriptions');
}));

app.get('/individual/subscriptions/:id/delete', ipAuth, requireFeaturePlan('individual.subscriptions'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_subscriptions WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/subscriptions');
}));

// FEATURE 33: Gift Tracker
app.get('/individual/gifts', ipAuth, requireFeaturePlan('individual.gifts'), ah(async (req, res) => {
  const gifts = (await pool.query('SELECT * FROM ind_gifts WHERE tenant_id=$1 AND user_email=$2 ORDER BY date_given DESC', [tid(req), uem(req)])).rows;
  const totalSpent = gifts.filter(g=>g.direction==='given').reduce((s,g)=>s+Number(g.cost||0),0);
  res.send(renderPage('Gifts', `${ipCSS}${ipNav('wishlist')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Gift Tracker</h2><a href="/individual/gifts/new" class="ip-btn ip-btn-primary">+ Add Gift</a></div>
    <div class="ip-stat" style="max-width:300px;margin-bottom:20px"><div class="num">${totalSpent.toLocaleString()}</div><div class="lbl">Total Given</div></div>
    ${gifts.length ? `<table class="ip-table"><tr><th>Gift</th><th>Recipient</th><th>Occasion</th><th>Direction</th><th>Cost</th><th>Actions</th></tr>${gifts.map(g=>`<tr><td><strong>${esc(g.name)}</strong></td><td>${esc(g.recipient||'-')}</td><td>${esc(g.occasion||'-')}</td><td><span class="ip-badge ${g.direction==='given'?'ip-badge-pink':'ip-badge-green'}">${g.direction==='given'?'Given':'Received'}</span></td><td>${Number(g.cost||0).toLocaleString()}</td><td><a href="/individual/gifts/${g.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></td></tr>`).join('')}</table>` : '<div class="ip-empty"><span>🎁</span>No gifts tracked</div>'}
  `, req.session.user));
}));

app.get('/individual/gifts/new', ipAuth, requireFeaturePlan('individual.gifts'), (req, res) => {
  res.send(renderPage('Add Gift', `${ipCSS}${ipNav('wishlist')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Gift</h2>
    <form method="POST" action="/individual/gifts/save" class="ip-form">
      <label>Gift Name</label><input name="name" required>
      <label>Recipient</label><input name="recipient">
      <label>Occasion</label><input name="occasion" placeholder="e.g. Birthday, Wedding">
      <label>Direction</label><select name="direction"><option value="given">Given</option><option value="received">Received</option></select>
      <label>Cost</label><input name="cost" type="number" step="0.01">
      <label>Date</label><input name="date_given" type="date">
      <label>Notes</label><input name="notes">
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/gifts" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/gifts/save', ipAuth, requireFeaturePlan('individual.gifts'), ah(async (req, res) => {
  const {name,recipient,occasion,direction,cost,date_given,notes} = req.body;
  await pool.query('INSERT INTO ind_gifts(tenant_id,user_email,name,recipient,occasion,direction,cost,date_given,notes) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)', [tid(req),uem(req),name,recipient||'',occasion||'',direction||'given',cost||0,date_given||null,notes||'']);
  res.redirect('/individual/gifts');
}));

app.get('/individual/gifts/:id/delete', ipAuth, requireFeaturePlan('individual.gifts'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_gifts WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/gifts');
}));

// FEATURE 34: Bucket List
app.get('/individual/bucketlist', ipAuth, requireFeaturePlan('individual.bucketlist'), ah(async (req, res) => {
  const items = (await pool.query('SELECT * FROM ind_bucket_list WHERE tenant_id=$1 AND user_email=$2 ORDER BY completed, created_at DESC', [tid(req), uem(req)])).rows;
  const done = items.filter(i=>i.completed).length;
  res.send(renderPage('Bucket List', `${ipCSS}${ipNav('bucketlist')}
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px"><h2>Bucket List</h2><a href="/individual/bucketlist/new" class="ip-btn ip-btn-primary">+ Add Goal</a></div>
    <div class="ip-stat" style="max-width:300px;margin-bottom:20px"><div class="num">${done}/${items.length}</div><div class="lbl">Completed</div></div>
    ${items.length ? `<div class="ip-grid">${items.map(i=>`<div class="ip-card" style="${i.completed?'opacity:.6':''}"><h3 style="${i.completed?'text-decoration:line-through':''}">${esc(i.name)}</h3><span class="ip-badge ip-badge-pink">${esc(i.category)}</span>${i.completed&&i.completed_at?`<p style="font-size:11px;color:#059669;margin-top:4px">Completed: ${i.completed_at}</p>`:''}<div style="margin-top:8px">${!i.completed?`<a href="/individual/bucketlist/${i.id}/complete" class="ip-btn ip-btn-success" style="font-size:11px">Complete</a>`:''} <a href="/individual/bucketlist/${i.id}/delete" class="ip-btn ip-btn-danger" style="font-size:11px" onclick="return confirm('Delete?')">Del</a></div></div>`).join('')}</div>` : '<div class="ip-empty"><span>🏆</span>Your bucket list is empty. Dream big!</div>'}
  `, req.session.user));
}));

app.get('/individual/bucketlist/new', ipAuth, (req, res) => {
  res.send(renderPage('Add Bucket List Item', `${ipCSS}${ipNav('bucketlist')}
    <div class="ip-card" style="max-width:500px;margin:0 auto"><h2>Add Life Goal</h2>
    <form method="POST" action="/individual/bucketlist/save" class="ip-form">
      <label>Goal</label><input name="name" placeholder="e.g. Visit Japan, Learn piano" required>
      <label>Category</label><select name="category"><option value="travel">Travel</option><option value="career">Career</option><option value="personal">Personal</option><option value="adventure">Adventure</option><option value="education">Education</option><option value="creative">Creative</option></select>
      <label>Notes</label><textarea name="notes" rows="2"></textarea>
      <button type="submit" class="ip-btn ip-btn-primary">Save</button>
      <a href="/individual/bucketlist" class="ip-btn ip-btn-secondary">Cancel</a>
    </form></div>
  `, req.session.user));
});

app.post('/individual/bucketlist/save', ipAuth, requireFeaturePlan('individual.bucketlist'), ah(async (req, res) => {
  const {name,category,notes} = req.body;
  await pool.query('INSERT INTO ind_bucket_list(tenant_id,user_email,name,category,notes) VALUES($1,$2,$3,$4,$5)', [tid(req),uem(req),name,category||'personal',notes||'']);
  res.redirect('/individual/bucketlist');
}));

app.get('/individual/bucketlist/:id/complete', ipAuth, requireFeaturePlan('individual.bucketlist'), ah(async (req, res) => {
  await pool.query('UPDATE ind_bucket_list SET completed=true, completed_at=CURRENT_DATE WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/bucketlist');
}));

app.get('/individual/bucketlist/:id/delete', ipAuth, requireFeaturePlan('individual.bucketlist'), ah(async (req, res) => {
  await pool.query('DELETE FROM ind_bucket_list WHERE id=$1 AND tenant_id=$2 AND user_email=$3', [req.params.id, tid(req), uem(req)]);
  res.redirect('/individual/bucketlist');
}));

// FEATURE 35: QR Code Generator
app.get('/individual/qrcode', ipAuth, (req, res) => {
  res.send(renderPage('QR Code Generator', `${ipCSS}${ipNav('qrcode')}
    <div style="max-width:500px;margin:0 auto">
      <h2 style="text-align:center">QR Code Generator</h2>
      <form method="POST" action="/individual/qrcode/generate" class="ip-form">
        <label>Type</label><select name="type" id="qrType" onchange="toggleFields()">
          <option value="url">URL / Website</option>
          <option value="text">Plain Text</option>
          <option value="vcard">vCard (Contact)</option>
          <option value="wifi">WiFi</option>
        </select>
        <div id="urlField"><label>URL</label><input name="url" placeholder="https://example.com"></div>
        <div id="textField" style="display:none"><label>Text</label><textarea name="text" rows="4" placeholder="Enter any text"></textarea></div>
        <div id="vcardFields" style="display:none">
          <label>Name</label><input name="vc_name" placeholder="Full Name">
          <label>Phone</label><input name="vc_phone" placeholder="+256...">
          <label>Email</label><input name="vc_email" placeholder="email@example.com">
        </div>
        <div id="wifiFields" style="display:none">
          <label>Network Name (SSID)</label><input name="wf_ssid">
          <label>Password</label><input name="wf_pass">
          <label>Security</label><select name="wf_sec"><option value="WPA">WPA/WPA2</option><option value="WEP">WEP</option><option value="">None</option></select>
        </div>
        <button type="submit" class="ip-btn ip-btn-primary" style="width:100%">Generate QR Code</button>
      </form>
      <script>function toggleFields(){var t=document.getElementById('qrType').value;document.getElementById('urlField').style.display=t==='url'?'block':'none';document.getElementById('textField').style.display=t==='text'?'block':'none';document.getElementById('vcardFields').style.display=t==='vcard'?'block':'none';document.getElementById('wifiFields').style.display=t==='wifi'?'block':'none'}</script>
    </div>
  `, req.session.user));
});

app.post('/individual/qrcode/generate', ipAuth, requireFeaturePlan('individual.qrcode'), ah(async (req, res) => {
  const {type, url, text, vc_name, vc_phone, vc_email, wf_ssid, wf_pass, wf_sec} = req.body;
  let qrData = '';
  if (type === 'url') qrData = url || '';
  else if (type === 'text') qrData = text || '';
  else if (type === 'vcard') qrData = `BEGIN:VCARD\nVERSION:3.0\nFN:${vc_name||''}\nTEL:${vc_phone||''}\nEMAIL:${vc_email||''}\nEND:VCARD`;
  else if (type === 'wifi') qrData = `WIFI:T:${wf_sec||'WPA'};S:${wf_ssid||''};P:${wf_pass||''};;`;
  if (!qrData) return res.redirect('/individual/qrcode');
  // Generate a simple SVG-based QR representation using a free API
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrData)}`;
  res.send(renderPage('QR Code', `${ipCSS}${ipNav('qrcode')}
    <div style="text-align:center;max-width:500px;margin:0 auto">
      <h2>Your QR Code</h2>
      <div style="background:white;padding:20px;border-radius:16px;display:inline-block;margin:20px 0;border:1px solid #e2e8f0">
        <img src="${esc(qrUrl)}" alt="QR Code" style="width:300px;height:300px">
      </div>
      <p style="color:#64748b;font-size:13px;margin:12px 0">Type: ${esc(type)}</p>
      <p style="color:#94a3b8;font-size:12px;word-break:break-all;max-width:400px;margin:0 auto">${esc(qrData.substring(0,200))}</p>
      <div style="margin-top:16px"><a href="${esc(qrUrl)}" download="qrcode.png" class="ip-btn ip-btn-success">Download</a> <a href="/individual/qrcode" class="ip-btn ip-btn-primary">Generate Another</a></div>
    </div>
  `, req.session.user));
}));

console.log('[IndividualPortal] 35 features loaded successfully');

}; // end module.exports
