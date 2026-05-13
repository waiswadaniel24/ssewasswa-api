/**
 * Diagnostic Script - Checks your server.js for the patterns we need to fix
 * Run: node diagnostic.js
 */
const fs = require('fs');
const server = fs.readFileSync('server.js', 'utf8');

console.log('File size:', server.length, 'characters');
console.log('');

// Check 1: subscription_plans CREATE TABLE
const createIdx = server.indexOf('subscription_plans');
if (createIdx >= 0) {
  console.log('=== FOUND subscription_plans at char', createIdx, '===');
  console.log(server.substring(createIdx, createIdx + 500));
  console.log('...\n');
} else {
  console.log('subscription_plans NOT FOUND in server.js!\n');
}

// Check 2: plan_key
const planKeyCount = (server.match(/plan_key/g) || []).length;
console.log('plan_key occurrences:', planKeyCount);

// Check 3: SSEWASSWA remaining
const ssewasswaCount = (server.match(/SSEWASSWA/g) || []).length;
console.log('SSEWASSWA remaining:', ssewasswaCount);
if (ssewasswaCount > 0) {
  const idx = server.indexOf('SSEWASSWA');
  console.log('First SSEWASSWA at char', idx, ':');
  console.log(server.substring(Math.max(0, idx - 50), idx + 80));
}

// Check 4: plan seed loop
const seedIdx = server.indexOf('planSeeds');
if (seedIdx >= 0) {
  console.log('\n=== planSeeds found at char', seedIdx, '===');
  console.log(server.substring(seedIdx, seedIdx + 600));
  console.log('...\n');
}

// Check 5: /dev/plans/save
const devPlansIdx = server.indexOf("/dev/plans/save");
if (devPlansIdx >= 0) {
  console.log('=== /dev/plans/save found at char', devPlansIdx, '===');
  console.log(server.substring(devPlansIdx, devPlansIdx + 500));
}

// Check 6: launch-routes.js
console.log('\n=== File check ===');
console.log('launch-routes.js exists:', fs.existsSync('launch-routes.js'));
console.log('worker.js exists:', fs.existsSync('worker.js'));
console.log('render.yaml exists:', fs.existsSync('render.yaml'));
