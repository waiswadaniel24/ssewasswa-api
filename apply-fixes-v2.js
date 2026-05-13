/**
 * Comfort Platform - Fix Script v2 (Smart Matching)
 * ==================================================
 * Run: node apply-fixes-v2.js
 * Uses regex matching and bulk replacements for reliability.
 */

const fs = require('fs');
const path = require('path');

let fixesApplied = 0;
let filesModified = 0;

function readFile(p) {
  try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
}
function writeFile(p, content) {
  fs.writeFileSync(p, content, 'utf8');
  filesModified++;
}

// ============================================================
// 1. Fix server.js
// ============================================================
console.log('\n[1/6] Fixing server.js...');

let server = readFile(path.join(__dirname, 'server.js'));
if (server) {
  const orig = server;

  // --- PLAN KEY FIX (Critical - prevents crash on startup) ---

  // Step A: Add plan_key column to CREATE TABLE if missing
  if (!server.includes('plan_key') && server.includes('CREATE TABLE IF NOT EXISTS subscription_plans')) {
    server = server.replace(
      /CREATE TABLE IF NOT EXISTS subscription_plans \(\s*id SERIAL PRIMARY KEY,\s*\n/,
      'CREATE TABLE IF NOT EXISTS subscription_plans (\n    id SERIAL PRIMARY KEY,\n    plan_key TEXT UNIQUE NOT NULL,\n'
    );
    if (server !== orig) { fixesApplied++; console.log('  [OK] Added plan_key to CREATE TABLE'); }
    else { console.log('  [!!] Could not add plan_key to CREATE TABLE'); }
  } else if (server.includes('plan_key')) {
    console.log('  [--] plan_key already exists in file');
  } else {
    console.log('  [!!] subscription_plans table not found');
  }

  // Step B: Add ALTER TABLE fallback for plan_key (run before any ALTER on subscription_plans)
  if (!server.includes('information_schema.columns') && server.includes('subscription_plans')) {
    const alterBlock = `  // Ensure plan_key column exists (may be missing if table was created by older migration)
  \`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscription_plans' AND column_name='plan_key') THEN ALTER TABLE subscription_plans ADD COLUMN plan_key TEXT UNIQUE; UPDATE subscription_plans SET plan_key = LOWER(name) WHERE plan_key IS NULL; ALTER TABLE subscription_plans ALTER COLUMN plan_key SET NOT NULL; END IF; END $$\`,`;
    
    // Insert before the first ALTER TABLE subscription_plans
    if (server.includes('ALTER TABLE subscription_plans')) {
      server = server.replace(
        "ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS sort_order",
        alterBlock + "\n  ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS sort_order"
      );
      if (server !== orig) { fixesApplied++; console.log('  [OK] Added ALTER TABLE plan_key fallback'); }
    } else {
      console.log('  [!!] No ALTER TABLE subscription_plans found for injection');
    }
  } else if (server.includes('information_schema.columns')) {
    console.log('  [--] ALTER TABLE fallback already exists');
  }

  // Step C: Fix seed INSERT to include plan_key
  // Look for the pattern where subscription_plans seed happens
  if (server.includes("INSERT INTO subscription_plans(name,") && !server.includes("INSERT INTO subscription_plans(plan_key,")) {
    // The seed doesn't include plan_key - we need to add it
    // First, add planKey variable before the loop
    const planSeedsPattern = /for \(const \[name, display, desc, price, cycle, features, maxUsers, maxStudents, active, sort\] of planSeeds\)/;
    if (planSeedsPattern.test(server)) {
      server = server.replace(
        planSeedsPattern,
        'for (const [name, display, desc, price, cycle, features, maxUsers, maxStudents, active, sort] of planSeeds) {\n        const planKey = name.toLowerCase();'
      );
      // Replace closing } with proper end
      // Fix the INSERT statements
      server = server.replace(
        /INSERT INTO subscription_plans\(name,display_name,description,price,currency,billing_cycle,features,max_users,max_students,is_active,sort_order\) VALUES\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11\) ON CONFLICT\(name\) DO UPDATE SET display_name=EXCLUDED\.display_name,description=EXCLUDED\.description,price=EXCLUDED\.price,features=EXCLUDED\.features,max_users=EXCLUDED\.max_users,max_students=EXCLUDED\.max_students,is_active=EXCLUDED\.is_active,sort_order=EXCLUDED\.sort_order/g,
        "INSERT INTO subscription_plans(plan_key,name,display_name,description,price,currency,billing_cycle,features,max_users,max_students,is_active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(name) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,price=EXCLUDED.price,features=EXCLUDED.features,max_users=EXCLUDED.max_users,max_students=EXCLUDED.max_students,is_active=EXCLUDED.is_active,sort_order=EXCLUDED.sort_order,plan_key=EXCLUDED.plan_key"
      );
      // Fix the array references - add planKey as first parameter
      server = server.replace(
        /\[name, display, desc, price, 'UGX', cycle, features, maxUsers, maxStudents, active, sort\]/g,
        "[planKey, name, display, desc, price, 'UGX', cycle, features, maxUsers, maxStudents, active, sort]"
      );
      // Fix the fallback INSERT too
      server = server.replace(
        /INSERT INTO subscription_plans\(name,display_name,description,price,currency,billing_cycle,features,max_users,max_students,is_active,sort_order\) VALUES\(\$1,\$2,\$3,\$4,\$5,\$6,\$7,\$8,\$9,\$10,\$11\)', \[name, display, desc, price/g,
        "INSERT INTO subscription_plans(plan_key,name,display_name,description,price,currency,billing_cycle,features,max_users,max_students,is_active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [planKey, name, display, desc, price"
      );
      fixesApplied++;
      console.log('  [OK] Added plan_key to seed INSERT');
    } else {
      console.log('  [!!] Plan seed loop pattern not found');
    }
  } else if (server.includes("INSERT INTO subscription_plans(plan_key,")) {
    console.log('  [--] Seed INSERT already includes plan_key');
  }

  // Step D: Fix /dev/plans/save route
  if (server.includes("INSERT INTO subscription_plans(name,display_name,description,price,billing_cycle,features,max_users,max_students) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(name) DO UPDATE SET") && !server.includes('planKey')) {
    server = server.replace(
      /app\.post\('\/dev\/plans\/save', requireAuth, requireSuperAdmin, ah\(async \(req, res\) => \{\s*\n\s*const \{ name, display_name, description, price, billing_cycle, features, max_users, max_students \} = req\.body;\s*\n/,
      `app.post('/dev/plans/save', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { name, display_name, description, price, billing_cycle, features, max_users, max_students } = req.body;
  const planKey = (name || '').toLowerCase().replace(/\\s+/g, '_');
`
    );
    server = server.replace(
      "INSERT INTO subscription_plans(name,display_name,description,price,billing_cycle,features,max_users,max_students) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(name) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,price=EXCLUDED.price,features=EXCLUDED.features,max_users=EXCLUDED.max_users,max_students=EXCLUDED.max_students",
      "INSERT INTO subscription_plans(plan_key,name,display_name,description,price,billing_cycle,features,max_users,max_students) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(name) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,price=EXCLUDED.price,features=EXCLUDED.features,max_users=EXCLUDED.max_users,max_students=EXCLUDED.max_students,plan_key=EXCLUDED.plan_key"
    );
    server = server.replace(
      "[name, display_name || name, description || '', parseInt(price) || 0, billing_cycle || 'monthly', features || '', parseInt(max_users) || 5, parseInt(max_students) || 100]",
      "[planKey, name, display_name || name, description || '', parseInt(price) || 0, billing_cycle || 'monthly', features || '', parseInt(max_users) || 5, parseInt(max_students) || 100]"
    );
    fixesApplied++;
    console.log('  [OK] Added plan_key to /dev/plans/save');
  } else {
    console.log('  [--] /dev/plans/save already fixed or pattern not found');
  }

  // --- BULK SSEWASSWA -> COMFORT REPLACEMENT ---
  const ssewasswaCount = (server.match(/SSEWASSWA/g) || []).length;
  if (ssewasswaCount > 0) {
    server = server.replace(/SSEWASSWA/g, 'Comfort');
    fixesApplied++;
    console.log(`  [OK] Replaced ${ssewasswaCount} SSEWASSWA -> Comfort`);
  } else {
    console.log('  [--] No SSEWASSWA references found');
  }

  if (server !== orig) {
    writeFile(path.join(__dirname, 'server.js'), server);
  }
} else {
  console.log('  [!!] server.js not found!');
}

// ============================================================
// 2. Fix worker.js
// ============================================================
console.log('\n[2/6] Fixing worker.js...');
let worker = readFile(path.join(__dirname, 'worker.js'));
if (worker) {
  const orig = worker;
  worker = worker.replace(/SSEWASSWA/g, 'Comfort');
  if (worker !== orig) {
    writeFile(path.join(__dirname, 'worker.js'), worker);
    fixesApplied++;
    console.log('  [OK] SSEWASSWA -> Comfort');
  } else {
    console.log('  [--] Already up to date');
  }
} else {
  console.log('  [--] worker.js not found, skipping');
}

// ============================================================
// 3. Fix public/sw.js
// ============================================================
console.log('\n[3/6] Fixing public/sw.js...');
let sw = readFile(path.join(__dirname, 'public', 'sw.js'));
if (sw) {
  const orig = sw;
  sw = sw.replace(/ssewasswa-v[\d.]+/g, 'comfort-v1.0');
  if (sw !== orig) {
    writeFile(path.join(__dirname, 'public', 'sw.js'), sw);
    fixesApplied++;
    console.log('  [OK] Cache name -> comfort-v1.0');
  } else {
    console.log('  [--] Already up to date');
  }
} else {
  console.log('  [--] public/sw.js not found, skipping');
}

// ============================================================
// 4. Fix public/manifest.json
// ============================================================
console.log('\n[4/6] Fixing public/manifest.json...');
let mf = readFile(path.join(__dirname, 'public', 'manifest.json'));
if (mf) {
  const orig = mf;
  mf = mf.replace(/SSEWASSWA/g, 'Comfort');
  if (mf !== orig) {
    writeFile(path.join(__dirname, 'public', 'manifest.json'), mf);
    fixesApplied++;
    console.log('  [OK] SSEWASSWA -> Comfort');
  } else {
    console.log('  [--] Already up to date');
  }
} else {
  console.log('  [--] public/manifest.json not found, skipping');
}

// ============================================================
// 5. Check for launch-routes.js
// ============================================================
console.log('\n[5/6] Checking launch-routes.js...');
if (fs.existsSync(path.join(__dirname, 'launch-routes.js'))) {
  console.log('  [OK] launch-routes.js exists (sitemap, robots.txt, blog will work)');
} else {
  console.log('  [!!] launch-routes.js NOT FOUND!');
  console.log('  [!!] This file is needed for sitemap, robots.txt, blog, and public pages.');
  console.log('  [!!] You need to download it separately and place it in the project folder.');
}

// ============================================================
// 6. Clean up old apply-fixes.js
// ============================================================
console.log('\n[6/6] Cleanup...');
const oldScript = path.join(__dirname, 'apply-fixes.js');
if (fs.existsSync(oldScript)) {
  fs.unlinkSync(oldScript);
  console.log('  [OK] Removed apply-fixes.js');
}
const oldScript2 = path.join(__dirname, 'apply-fixes-v2.js');
// Don't delete this one yet

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '='.repeat(55));
console.log(`DONE! ${fixesApplied} fixes applied, ${filesModified} files modified.`);
console.log('='.repeat(55));
console.log('\nNext steps:');
console.log('  git add -A');
console.log('  git commit -m "fix: plan_key crash, Comfort rebrand v2"');
console.log('  git push origin main');
console.log('');
