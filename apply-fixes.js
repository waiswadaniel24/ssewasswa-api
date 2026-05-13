/**
 * Comfort Platform - Apply All Fixes
 * ====================================
 * Run: node apply-fixes.js
 * 
 * This script patches server.js, launch-routes.js, worker.js, sw.js,
 * manifest.json, and test/server.test.js with all sandbox fixes.
 */

const fs = require('fs');
const path = require('path');

let fixesApplied = 0;
let filesModified = 0;

function patchFile(filePath, patches) {
  let content = fs.readFileSync(filePath, 'utf8');
  const original = content;
  
  for (const patch of patches) {
    if (content.includes(patch.old)) {
      content = content.replace(patch.old, patch.new);
      fixesApplied++;
      console.log(`  [OK] ${patch.name}`);
    } else if (patch.optional) {
      console.log(`  [--] ${patch.name} (already applied or not needed)`);
    } else {
      console.log(`  [!!] ${patch.name} (pattern not found)`);
    }
  }
  
  if (content !== original) {
    fs.writeFileSync(filePath, content, 'utf8');
    filesModified++;
  }
  
  return content;
}

// ============================================================
// 1. PATCH server.js
// ============================================================
console.log('\n[1/6] Patching server.js...');

const serverPatches = [
  // Fix 1: Add plan_key to CREATE TABLE subscription_plans
  {
    name: 'plan_key in CREATE TABLE',
    old: `  \`CREATE TABLE IF NOT EXISTS subscription_plans (
    id SERIAL PRIMARY KEY,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT,`,
    new: `  \`CREATE TABLE IF NOT EXISTS subscription_plans (
    id SERIAL PRIMARY KEY,
    plan_key TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL UNIQUE,
    display_name TEXT,`
  },
  // Fix 2: Add ALTER TABLE fallback for plan_key (before sort_order ALTER)
  {
    name: 'ALTER TABLE plan_key fallback',
    old: `  // v15 FIX: Add sort_order columns to tables that were created without them
  \`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0\`,`,
    new: `  // v15 FIX: Add sort_order columns to tables that were created without them
  // Ensure plan_key column exists (may be missing if table was created by older migration)
  \`DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='subscription_plans' AND column_name='plan_key') THEN ALTER TABLE subscription_plans ADD COLUMN plan_key TEXT UNIQUE; UPDATE subscription_plans SET plan_key = LOWER(name) WHERE plan_key IS NULL; ALTER TABLE subscription_plans ALTER COLUMN plan_key SET NOT NULL; END IF; END $$\`,
  \`ALTER TABLE subscription_plans ADD COLUMN IF NOT EXISTS sort_order INTEGER DEFAULT 0\`,`
  },
  // Fix 3: Include plan_key in seed INSERT
  {
    name: 'plan_key in seed INSERT',
    old: `      for (const [name, display, desc, price, cycle, features, maxUsers, maxStudents, active, sort] of planSeeds) {
        try {
          await pool.query('INSERT INTO subscription_plans(name,display_name,description,price,currency,billing_cycle,features,max_users,max_students,is_active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT(name) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,price=EXCLUDED.price,features=EXCLUDED.features,max_users=EXCLUDED.max_users,max_students=EXCLUDED.max_students,is_active=EXCLUDED.is_active,sort_order=EXCLUDED.sort_order', [name, display, desc, price, 'UGX', cycle, features, maxUsers, maxStudents, active, sort]);
        } catch (planErr) {
          // UNIQUE constraint on name may not exist yet on older DBs - try plain INSERT
          if (planErr.message.includes('ON CONFLICT')) {
            try { await pool.query('INSERT INTO subscription_plans(name,display_name,description,price,currency,billing_cycle,features,max_users,max_students,is_active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [name, display, desc, price, 'UGX', cycle, features, maxUsers, maxStudents, active, sort]); } catch(e2) { /* duplicate OK */ }
          } else throw planErr;
        }
      }`,
    new: `      for (const [name, display, desc, price, cycle, features, maxUsers, maxStudents, active, sort] of planSeeds) {
        const planKey = name.toLowerCase();
        try {
          await pool.query('INSERT INTO subscription_plans(plan_key,name,display_name,description,price,currency,billing_cycle,features,max_users,max_students,is_active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT(name) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,price=EXCLUDED.price,features=EXCLUDED.features,max_users=EXCLUDED.max_users,max_students=EXCLUDED.max_students,is_active=EXCLUDED.is_active,sort_order=EXCLUDED.sort_order,plan_key=EXCLUDED.plan_key', [planKey, name, display, desc, price, 'UGX', cycle, features, maxUsers, maxStudents, active, sort]);
        } catch (planErr) {
          // UNIQUE constraint on name may not exist yet on older DBs - try plain INSERT
          if (planErr.message.includes('ON CONFLICT')) {
            try { await pool.query('INSERT INTO subscription_plans(plan_key,name,display_name,description,price,currency,billing_cycle,features,max_users,max_students,is_active,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [planKey, name, display, desc, price, 'UGX', cycle, features, maxUsers, maxStudents, active, sort]); } catch(e2) { /* duplicate OK */ }
          } else throw planErr;
        }
      }`
  },
  // Fix 4: /dev/plans/save include plan_key
  {
    name: 'plan_key in /dev/plans/save',
    old: `app.post('/dev/plans/save', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { name, display_name, description, price, billing_cycle, features, max_users, max_students } = req.body;
  await pool.query('INSERT INTO subscription_plans(name,display_name,description,price,billing_cycle,features,max_users,max_students) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(name) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,price=EXCLUDED.price,features=EXCLUDED.features,max_users=EXCLUDED.max_users,max_students=EXCLUDED.max_students',
    [name, display_name || name, description || '', parseInt(price) || 0, billing_cycle || 'monthly', features || '', parseInt(max_users) || 5, parseInt(max_students) || 100]);`,
    new: `app.post('/dev/plans/save', requireAuth, requireSuperAdmin, ah(async (req, res) => {
  const { name, display_name, description, price, billing_cycle, features, max_users, max_students } = req.body;
  const planKey = (name || '').toLowerCase().replace(/\\s+/g, '_');
  await pool.query('INSERT INTO subscription_plans(plan_key,name,display_name,description,price,billing_cycle,features,max_users,max_students) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT(name) DO UPDATE SET display_name=EXCLUDED.display_name,description=EXCLUDED.description,price=EXCLUDED.price,features=EXCLUDED.features,max_users=EXCLUDED.max_users,max_students=EXCLUDED.max_students,plan_key=EXCLUDED.plan_key',
    [planKey, name, display_name || name, description || '', parseInt(price) || 0, billing_cycle || 'monthly', features || '', parseInt(max_users) || 5, parseInt(max_students) || 100]);`
  },
  // Fix 5: SSEWASSWA -> Comfort in platform_settings default
  {
    name: 'site_name default -> Comfort',
    old: `let platformSettings = { site_name: 'Comfort',`,
    new: `let platformSettings = { site_name: 'Comfort',`,
  },
  // Fix 5b: SSEWASSWA -> Comfort in keywords meta tag  
  {
    name: 'Keywords meta -> Comfort',
    old: `content="SSEWASSWA, school management`,
    new: `content="Comfort, school management`,
  },
  // Fix 5c: SSEWASSWA -> Comfort in site_name INSERT
  {
    name: 'site_name INSERT -> Comfort',
    old: `VALUES ('site_name', 'SSEWASSWA')`,
    new: `VALUES ('site_name', 'Comfort')`,
  },
  // Fix 5d: SSEWASSWA -> Comfort in notification
  {
    name: 'Notification -> Comfort',
    old: `new Notification('SSEWASSWA'`,
    new: `new Notification('Comfort'`,
  },
  // Fix 5e: SSEWASSWA -> Comfort in welcome
  {
    name: 'Welcome page -> Comfort',
    old: `Welcome to SSEWASSWA!`,
    new: `Welcome to Comfort!`,
  },
  // Fix 5f: SSEWASSWA -> Comfort in footer
  {
    name: 'Footer -> Comfort',
    old: `SSEWASSWA Platform &bull; Built with`,
    new: `Comfort Platform &bull; Built with`,
  },
  // Fix 5g: SSEWASSWA -> Comfort in email subject
  {
    name: 'Welcome email subject -> Comfort',
    old: `Welcome to SSEWASSWA!'`,
    new: `Welcome to Comfort!'`,
  },
  // Fix 5h: SSEWASSWA -> Comfort in password reset
  {
    name: 'Password reset email -> Comfort',
    old: `SSEWASSWA - Password Reset`,
    new: `Comfort - Password Reset`,
  },
  // Fix 5i: SSEWASSWA -> Comfort in footer copyright
  {
    name: 'Email footer -> Comfort',
    old: `SSEWASSWA Platform</p>`,
    new: `Comfort Platform</p>`,
  },
  // Fix 5j: SSEWASSWA -> Comfort in backup
  {
    name: 'Backup label -> Comfort',
    old: `SSEWASSWA DATA BACKUP`,
    new: `Comfort DATA BACKUP`,
  },
  // Fix 5k: SSEWASSWA -> Comfort in dev hub
  {
    name: 'Dev hub title -> Comfort',
    old: `SSEWASSWA Developer Hub`,
    new: `Comfort Developer Hub`,
  },
  // Fix 5l: SSEWASSWA -> Comfort in blog page
  {
    name: 'Blog title -> Comfort',
    old: `SSEWASSWA Blog - News & Updates`,
    new: `Comfort Blog - News & Updates`,
  },
  // Fix 5m: SSEWASSWA -> Comfort in blog subtitle
  {
    name: 'Blog subtitle -> Comfort',
    old: `from SSEWASSWA`,
    new: `from Comfort`,
  },
  // Fix 5n: SSEWASSWA -> Comfort in blog description
  {
    name: 'Blog meta desc -> Comfort',
    old: `SSEWASSWA blog - news`,
    new: `Comfort blog - news`,
  },
  // Fix 5o: SSEWASSWA -> Comfort in payment payer message
  {
    name: 'Payment payer msg -> Comfort',
    old: `payerMessage: payerMessage || 'SSEWASSWA Payment',`,
    new: `payerMessage: payerMessage || 'Comfort Payment',`,
  },
  // Fix 5p: SSEWASSWA -> Comfort in payment payee note
  {
    name: 'Payment payee note -> Comfort',
    old: `payeeNote: payeeNote || 'Payment via SSEWASSWA'`,
    new: `payeeNote: payeeNote || 'Payment via Comfort'`,
  },
];

patchFile(path.join(__dirname, 'server.js'), serverPatches);

// ============================================================
// 2. PATCH launch-routes.js (if it exists)
// ============================================================
console.log('\n[2/6] Patching launch-routes.js...');
const lrPath = path.join(__dirname, 'launch-routes.js');
if (fs.existsSync(lrPath)) {
  const lrPatches = [
    // Fix: SSEWASSWA -> Comfort (bulk replace)
    {
      name: 'Bulk SSEWASSWA -> Comfort',
      old: 'SSEWASSWA',
      new: 'Comfort',
    },
    // Fix sitemap: query tenants directly instead of public_pages.slug
    {
      name: 'Sitemap query -> tenants.subdomain',
      old: `      let tenantPages = [];
      try {
        tenantPages = (await pool.query(\`
          SELECT p.slug, p.created_at, t.name as org_name, t.type as org_type
          FROM public_pages p
          JOIN tenants t ON p.tenant_id = t.id
          WHERE p.is_published = true
        \`)).rows;
      } catch (e) { /* no pages yet */ }`,
      new: `      let tenantPages = [];
      try {
        tenantPages = (await pool.query(\`
          SELECT t.subdomain, t.name, t.type, t.created_at
          FROM tenants t
          WHERE EXISTS (
            SELECT 1 FROM public_pages p WHERE p.tenant_id = t.id AND p.is_published = true
          )
          ORDER BY t.created_at DESC
        \`)).rows;
      } catch (e) { /* no pages yet */ }`,
      optional: true,
    },
    // Fix sitemap: use tp.subdomain instead of tp.slug
    {
      name: 'Sitemap URL -> /p/${tp.subdomain}',
      old: `<loc>${BASE_URL}/p/${tp.slug}</loc>`,
      new: `<loc>${BASE_URL}/p/${tp.subdomain}</loc>`,
      optional: true,
    },
    // Fix: Remove duplicate meta tags from getStructuredData
    {
      name: 'Remove duplicate meta tags from structured data',
      old: `    </script>
    <link rel="canonical" href="\${BASE_URL}/" />
    <meta property="og:url" content="\${BASE_URL}/" />
    <meta property="og:image" content="\${BASE_URL}/icon.png" />
    <meta name="twitter:image" content="\${BASE_URL}/icon.png" />
    <meta name="twitter:card" content="summary_large_image" />
  \`;`,
      new: `    </script>
  \`;`,
      optional: true,
    },
    // Fix: Disallow /worker/ in robots.txt
    {
      name: 'Disallow /worker/ in robots.txt',
      old: `Disallow: /dev/
Disallow: /admin/
Disallow: /api/`,
      new: `Disallow: /dev/
Disallow: /admin/
Disallow: /worker/
Disallow: /api/`,
      optional: true,
    },
    // Fix: Service worker cache name
    {
      name: 'SW cache -> comfort-v1.0',
      old: `const CACHE = 'ssewasswa-v10.0';`,
      new: `const CACHE = 'comfort-v1.0';`,
      optional: true,
    },
    // Fix: Manifest name
    {
      name: 'Manifest name -> Comfort',
      old: `name: 'Comfort Platform',
      short_name: 'Comfort',`,
      new: `name: 'Comfort Platform',
      short_name: 'Comfort',`,
      optional: true,
    },
  ];
  patchFile(lrPath, lrPatches);
} else {
  console.log('  [--] launch-routes.js not found, skipping');
}

// ============================================================
// 3. PATCH worker.js
// ============================================================
console.log('\n[3/6] Patching worker.js...');
const wPath = path.join(__dirname, 'worker.js');
if (fs.existsSync(wPath)) {
  patchFile(wPath, [
    {
      name: 'Worker console -> Comfort',
      old: `console.log('SSEWASSWA Workers`,
      new: `console.log('Comfort Workers`,
      optional: true,
    },
  ]);
} else {
  console.log('  [--] worker.js not found, skipping');
}

// ============================================================
// 4. PATCH public/sw.js
// ============================================================
console.log('\n[4/6] Patching public/sw.js...');
const swPath = path.join(__dirname, 'public', 'sw.js');
if (fs.existsSync(swPath)) {
  patchFile(swPath, [
    {
      name: 'SW cache -> comfort-v1.0',
      old: `const CACHE = 'ssewasswa-v9.0';`,
      new: `const CACHE = 'comfort-v1.0';`,
      optional: true,
    },
  ]);
} else {
  console.log('  [--] public/sw.js not found, skipping');
}

// ============================================================
// 5. PATCH public/manifest.json
// ============================================================
console.log('\n[5/6] Patching public/manifest.json...');
const mfPath = path.join(__dirname, 'public', 'manifest.json');
if (fs.existsSync(mfPath)) {
  let mf = fs.readFileSync(mfPath, 'utf8');
  mf = mf.replace(/SSEWASSWA/g, 'Comfort');
  if (mf !== fs.readFileSync(mfPath, 'utf8')) {
    fs.writeFileSync(mfPath, mf, 'utf8');
    fixesApplied++;
    filesModified++;
    console.log('  [OK] SSEWASSWA -> Comfort in manifest.json');
  } else {
    console.log('  [--] Already up to date');
  }
} else {
  console.log('  [--] public/manifest.json not found, skipping');
}

// ============================================================
// 6. PATCH test/server.test.js
// ============================================================
console.log('\n[6/6] Patching test/server.test.js...');
const testPath = path.join(__dirname, 'test', 'server.test.js');
if (fs.existsSync(testPath)) {
  let testContent = fs.readFileSync(testPath, 'utf8');
  testContent = testContent.replace(/SSEWASSWA/g, 'Comfort');
  if (testContent !== fs.readFileSync(testPath, 'utf8')) {
    fs.writeFileSync(testPath, testContent, 'utf8');
    fixesApplied++;
    filesModified++;
    console.log('  [OK] SSEWASSWA -> Comfort in test file');
  } else {
    console.log('  [--] Already up to date');
  }
} else {
  console.log('  [--] test/server.test.js not found, skipping');
}

// ============================================================
// CLEANUP: Remove test_check.txt if it exists
// ============================================================
const testCheckPath = path.join(__dirname, 'test_check.txt');
if (fs.existsSync(testCheckPath)) {
  fs.unlinkSync(testCheckPath);
  console.log('\n[CLEANUP] Removed test_check.txt');
}

// ============================================================
// SUMMARY
// ============================================================
console.log('\n' + '='.repeat(50));
console.log(`DONE! ${fixesApplied} patches applied, ${filesModified} files modified.`);
console.log('='.repeat(50));
console.log('\nNext steps:');
console.log('  git add -A');
console.log('  git commit -m "fix: plan_key crash, Comfort rebrand, sitemap fix"');
console.log('  git push origin main');
console.log('');
