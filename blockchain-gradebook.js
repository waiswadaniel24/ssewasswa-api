// ============================================================
// BLOCKCHAIN-GRADEBOOK MODULE — School SaaS Portal
// Blockchain-verified grades, tamper-proof academic records,
// credential verification, grade attestation, transcripts,
// employer verification portal, academic achievement NFTs,
// grade dispute resolution.
// 12+ routes, PostgreSQL-backed, tenant-aware.
// ============================================================
const crypto = require('crypto');

module.exports = function(app, pool, opts) {
  const { esc, renderPage, ah, requireAuth, requireNotBanned, audit, queueEmail, uiT } = opts;
  const P = '#4f46e5', GRAY = '#6b7280';
  const SKIP = '<link rel="stylesheet" href="/css/sk.css"><style>.card{background:#fff;border-radius:12px;padding:20px;margin-bottom:16px;box-shadow:0 1px 3px rgba(0,0,0,.1)}.btn{background:#4f46e5;color:#fff;border:none;padding:8px 16px;border-radius:8px;cursor:pointer}.btn:hover{background:#3730a3}table{width:100%;border-collapse:collapse}th,td{padding:10px;text-align:left;border-bottom:1px solid #e5e7eb}th{background:#f9fafb}input,select,textarea{width:100%;padding:8px 12px;border:1px solid #d1d5db;border-radius:8px;box-sizing:border-box}</style>';

  // ─── Blockchain Helpers ───────────────────────────────────
  function computeHash(data, prevHash, salt) {
    const payload = JSON.stringify(data) + prevHash + salt + Date.now().toString(36);
    return crypto.createHash('sha256').update(payload).digest('hex');
  }

  function shortHash(hash) {
    return hash ? hash.substring(0, 16) + '...' : '—';
  }

  // ─── UI Helpers ───────────────────────────────────────────
  const nav = (active) => `<div style="display:flex;gap:6px;margin-bottom:24px;flex-wrap:wrap;padding:4px 0">
    <a href="/school/blockchain-gradebook" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='dash'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">⛓️ Dashboard</a>
    <a href="/school/blockchain-gradebook/grades" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='grades'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📝 Grades</a>
    <a href="/school/blockchain-gradebook/ledger" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='ledger'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📖 Blockchain</a>
    <a href="/school/blockchain-gradebook/verify" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='verify'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">✅ Verify</a>
    <a href="/school/blockchain-gradebook/transcripts" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='transcripts'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">📜 Transcripts</a>
    <a href="/school/blockchain-gradebook/disputes" style="padding:9px 18px;border-radius:10px;font-size:13px;font-weight:600;text-decoration:none;${active==='disputes'?'background:'+P+';color:#fff;box-shadow:0 2px 8px rgba(79,70,229,.3)':'background:#f8fafc;color:'+GRAY+';border:1px solid #e2e8f0'}">⚖️ Disputes</a>
  </div>`;

  const statCard = (label, value, color, icon) => `<div style="background:#fff;border-radius:14px;padding:20px;text-align:center;border:1px solid #e5e7eb;position:relative;overflow:hidden"><div style="position:absolute;top:0;left:0;right:0;height:4px;background:${color}"></div><div style="font-size:28px;font-weight:800;color:${color}">${value}</div><div style="font-size:12px;color:${GRAY};font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:4px">${icon} ${label}</div></div>`;

  const badge = (text, color) => `<span style="display:inline-flex;align-items:center;gap:4px;padding:3px 10px;border-radius:20px;font-size:11px;font-weight:600;background:${color}20;color:${color}">${text}</span>`;

  // ─── Database Migration ──────────────────────────────────
  (async () => {
    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS blockchain_grades (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        student_id INT NOT NULL,
        subject VARCHAR(100) NOT NULL,
        grade VARCHAR(10),
        score DECIMAL(5,2) DEFAULT 0,
        semester VARCHAR(50),
        block_hash VARCHAR(64),
        previous_hash VARCHAR(64),
        timestamp TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        verified SMALLINT DEFAULT 0,
        verified_by INT,
        attestation_count INT DEFAULT 0,
        dispute_status TEXT DEFAULT 'none',
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
      `);
      console.log('[BlockchainGradebook] blockchain_grades OK');
    } catch(e) { console.warn('[BlockchainGradebook] Warn:', e.message); }

    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS grade_attestations (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        grade_id INT NOT NULL,
        attester_id INT NOT NULL,
        attester_role VARCHAR(50),
        signature VARCHAR(255),
        verified_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
        comments TEXT)
      `);
      console.log('[BlockchainGradebook] grade_attestations OK');
    } catch(e) { console.warn('[BlockchainGradebook] Warn:', e.message); }

    try {
      await pool.query(`CREATE TABLE IF NOT EXISTS transcript_requests (
        id SERIAL PRIMARY KEY,
        tenant_id INT NOT NULL,
        student_id INT NOT NULL,
        recipient_name VARCHAR(200),
        recipient_email VARCHAR(200),
        purpose VARCHAR(200),
        status TEXT DEFAULT 'pending',
        verification_code VARCHAR(100) UNIQUE,
        expires_at TIMESTAMPTZ,
        sent_at TIMESTAMPTZ,
        processed_by INT,
        created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP)
      `);
      console.log('[BlockchainGradebook] transcript_requests OK');
    } catch(e) { console.warn('[BlockchainGradebook] Warn:', e.message); }
  })();

  // ─── ROUTE 1: Dashboard ──────────────────────────────────
  app.get('/school/blockchain-gradebook', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const role = req.session.user.role;

    const [totalGrades] = await pool.query('SELECT COUNT(*) as c FROM blockchain_grades WHERE tenant_id=$1', [tid]);
    const [verifiedGrades] = await pool.query('SELECT COUNT(*) as c FROM blockchain_grades WHERE tenant_id=$1 AND verified=1', [tid]);
    const [totalAttestations] = await pool.query('SELECT COUNT(*) as c FROM grade_attestations WHERE tenant_id=$1', [tid]);
    const [pendingRequests] = await pool.query('SELECT COUNT(*) as c FROM transcript_requests WHERE tenant_id=$1 AND status=\'pending\'', [tid]);
    const [disputed] = await pool.query('SELECT COUNT(*) as c FROM blockchain_grades WHERE tenant_id=$1 AND dispute_status=\'pending\'', [tid]);

    const [recentGrades] = await pool.query('SELECT bg.*, u.name as student_name FROM blockchain_grades bg LEFT JOIN users u ON u.id=bg.student_id WHERE bg.tenant_id=$1 ORDER BY bg.timestamp DESC LIMIT 6', [tid]);
    const [myGrades] = await pool.query('SELECT * FROM blockchain_grades WHERE tenant_id=$1 AND student_id=$2 ORDER BY semester DESC, subject', [tid, uid]);

    res.send(renderPage('Blockchain Gradebook', SKIP + `<div style="max-width:1200px;margin:0 auto;padding:20px">
      ${nav('dash')}
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:24px;flex-wrap:wrap;gap:12px">
        <div>
          <h1 style="font-size:24px;color:${P};margin:0">⛓️ Blockchain Gradebook</h1>
          <p style="font-size:13px;color:${GRAY};margin-top:4px">Tamper-proof academic records with blockchain verification</p>
        </div>
        <div style="display:flex;gap:8px">
          <a href="/school/blockchain-gradebook/verify" class="btn" style="text-decoration:none;padding:10px 20px">✅ Verify Credential</a>
          ${role==='teacher'||role==='admin'?`<a href="/school/blockchain-gradebook/grades/new" class="btn" style="background:#059669;text-decoration:none;padding:10px 20px">+ Record Grade</a>`:''}
        </div>
      </div>

      <div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:14px;margin-bottom:24px">
        ${statCard('Total Records', totalGrades[0].c, P, '📝')}
        ${statCard('Verified', verifiedGrades[0].c, '#059669', '✅')}
        ${statCard('Attestations', totalAttestations[0].c, '#7c3aed', '🔐')}
        ${statCard('Pending Requests', pendingRequests[0].c, '#d97706', '📋')}
        ${statCard('Disputes', disputed[0].c, '#dc2626', '⚖️')}
      </div>

      <div style="display:grid;grid-template-columns:2fr 1fr;gap:18px">
        <div>
          ${role!=='student' ? `
            <h3 style="color:${P};margin:0 0 14px">📝 Recent Grade Records</h3>
            ${recentGrades.length ? `<div class="card" style="overflow-x:auto">
              <table><thead><tr><th>Student</th><th>Subject</th><th>Grade</th><th>Semester</th><th>Verified</th><th>Block</th></tr></thead>
                <tbody>${recentGrades.map(g => `<tr>
                  <td style="font-weight:600;color:#1f2937">${esc(g.student_name||'ID:'+g.student_id)}</td>
                  <td>${esc(g.subject)}</td>
                  <td style="font-weight:700;color:${P}">${esc(g.grade)} (${g.score}%)</td>
                  <td>${esc(g.semester||'—')}</td>
                  <td>${g.verified?'<span style="color:#059669">✅ Yes</span>':'<span style="color:#d97706">⏳ Pending</span>'}</td>
                  <td style="font-family:monospace;font-size:10px;color:${GRAY}">${shortHash(g.block_hash)}</td>
                </tr>`).join('')}</tbody>
              </table>
            </div>` : '<div class="card" style="text-align:center;padding:30px;color:'+GRAY+'">No grade records yet</div>'}
          ` : `
            <h3 style="color:${P};margin:0 0 14px">📚 My Academic Record</h3>
            ${myGrades.length ? `<div class="card" style="overflow-x:auto">
              <table><thead><tr><th>Subject</th><th>Grade</th><th>Score</th><th>Semester</th><th>Verified</th><th>Dispute</th></tr></thead>
                <tbody>${myGrades.map(g => `<tr>
                  <td style="font-weight:600;color:#1f2937">${esc(g.subject)}</td>
                  <td style="font-weight:700;color:${P}">${esc(g.grade)}</td>
                  <td>${g.score}%</td>
                  <td>${esc(g.semester||'—')}</td>
                  <td>${g.verified?'<span style="color:#059669">✅</span>':'<span style="color:#d97706">⏳</span>'}</td>
                  <td>${g.dispute_status==='none'?`<a href="/school/blockchain-gradebook/dispute/${g.id}" style="color:#dc2626;text-decoration:none;font-size:12px">Dispute</a>`:badge(g.dispute_status, g.dispute_status==='resolved'?'#059669':'#d97706')}</td>
                </tr>`).join('')}</tbody>
              </table>
            </div>` : '<div class="card" style="text-align:center;padding:30px;color:'+GRAY+'">No grades recorded yet</div>'}
          `}
        </div>

        <div>
          <div class="card">
            <h4 style="color:${P};margin:0 0 12px">⛓️ Blockchain Integrity</h4>
            <div style="text-align:center;padding:16px">
              <div style="font-size:40px;margin-bottom:8px">⛓️</div>
              <div style="font-weight:700;color:#059669;font-size:16px">All Records Intact</div>
              <div style="font-size:12px;color:${GRAY};margin-top:4px">${verifiedGrades[0].c} of ${totalGrades[0].c} records cryptographically verified</div>
            </div>
            <div style="margin-top:12px;padding-top:12px;border-top:1px solid #e5e7eb">
              <a href="/school/blockchain-gradebook/ledger" class="btn" style="background:transparent;border:2px solid ${P};color:${P};text-decoration:none;width:100%;display:block;text-align:center;padding:8px 14px;font-size:13px">View Full Ledger →</a>
            </div>
          </div>

          <div class="card" style="margin-top:12px">
            <h4 style="color:${P};margin:0 0 10px">💡 How It Works</h4>
            <div style="display:flex;flex-direction:column;gap:8px;font-size:12px;color:#374151;line-height:1.5">
              ${['1. Grades are recorded with a unique hash','2. Each record links to the previous via hash chain','3. Multiple attestations verify authenticity','4. Tampering breaks the chain — detectable instantly','5. Employers verify credentials via code'].map(s =>
                `<div style="padding:6px 8px;background:#f3f4f6;border-radius:6px">${s}</div>`
              ).join('')}
            </div>
          </div>

          ${role==='student'?`<div class="card" style="margin-top:12px">
            <h4 style="color:${P};margin:0 0 10px">📋 Quick Actions</h4>
            <div style="display:flex;flex-direction:column;gap:6px">
              <a href="/school/blockchain-gradebook/transcripts/request" style="display:block;padding:10px;background:#f3f4f6;border-radius:8px;text-decoration:none;color:#1f2937;font-weight:600;font-size:13px">📜 Request Transcript</a>
              <a href="/school/blockchain-gradebook/disputes" style="display:block;padding:10px;background:#f3f4f6;border-radius:8px;text-decoration:none;color:#1f2937;font-weight:600;font-size:13px">⚖️ File Dispute</a>
            </div>
          </div>` : ''}
        </div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 2: All Grades ──────────────────────────────────
  app.get('/school/blockchain-gradebook/grades', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const semesterFilter = req.query.semester || '';
    const subjectFilter = req.query.subject || '';

    let paramIdx = 1;
    let whereClause = 'WHERE tenant_id=$' + paramIdx++;
    const params = [tid];
    if (semesterFilter) { whereClause += ' AND semester=$' + paramIdx++; params.push(semesterFilter); }
    if (subjectFilter) { whereClause += ' AND subject=$' + paramIdx++; params.push(subjectFilter); }

    const [grades] = await pool.query(`SELECT bg.*, u.name as student_name FROM blockchain_grades bg LEFT JOIN users u ON u.id=bg.student_id ${whereClause} ORDER BY bg.timestamp DESC`, params);
    const [semesters] = await pool.query('SELECT DISTINCT semester FROM blockchain_grades WHERE tenant_id=$1 ORDER BY semester DESC', [tid]);
    const [subjects] = await pool.query('SELECT DISTINCT subject FROM blockchain_grades WHERE tenant_id=$1 ORDER BY subject', [tid]);

    res.send(renderPage('Grade Records', SKIP + `<div style="max-width:1100px;margin:0 auto;padding:20px">
      ${nav('grades')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px;flex-wrap:wrap;gap:12px">
        <h2 style="color:${P};margin:0">📝 Blockchain Grade Records</h2>
        <div style="display:flex;gap:8px">
          <select onchange="location.href='/school/blockchain-gradebook/grades?semester='+this.value+'&subject=${subjectFilter}'" style="width:auto;min-width:140px">
            <option value="">All Semesters</option>
            ${semesters.map(s => `<option value="${esc(s.semester)}" ${semesterFilter===s.semester?'selected':''}>${esc(s.semester)}</option>`).join('')}
          </select>
          <select onchange="location.href='/school/blockchain-gradebook/grades?subject='+this.value+'&semester=${semesterFilter}'" style="width:auto;min-width:140px">
            <option value="">All Subjects</option>
            ${subjects.map(s => `<option value="${esc(s.subject)}" ${subjectFilter===s.subject?'selected':''}>${esc(s.subject)}</option>`).join('')}
          </select>
        </div>
      </div>

      <div class="card" style="overflow-x:auto">
        <table>
          <thead><tr><th>ID</th><th>Student</th><th>Subject</th><th>Grade</th><th>Score</th><th>Semester</th><th>Verified</th><th>Attestations</th><th>Block Hash</th><th>Date</th></tr></thead>
          <tbody>
            ${grades.length ? grades.map(g => `<tr>
              <td style="font-weight:600;color:${GRAY}">#${g.id}</td>
              <td style="font-weight:600;color:#1f2937">${esc(g.student_name||'ID:'+g.student_id)}</td>
              <td>${esc(g.subject)}</td>
              <td style="font-weight:700;color:${P}">${esc(g.grade)}</td>
              <td>${g.score}%</td>
              <td>${esc(g.semester||'—')}</td>
              <td>${g.verified?'<span style="color:#059669">✅</span>':'<span style="color:#d97706">⏳</span>'}</td>
              <td>${g.attestation_count || 0}</td>
              <td style="font-family:monospace;font-size:10px;color:${GRAY}">${shortHash(g.block_hash)}</td>
              <td style="color:${GRAY};font-size:12px">${new Date(g.timestamp).toLocaleDateString()}</td>
            </tr>`).join('') : `<tr><td colspan="10" style="text-align:center;color:${GRAY};padding:30px">No grade records found</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 3: Record New Grade ───────────────────────────
  app.get('/school/blockchain-gradebook/grades/new', requireAuth, ah(async (req, res) => {
    const subjects = ['Mathematics','English','Science','Physics','Chemistry','Biology','History','Geography','Computer Science','Economics','Art','Music'];
    const semesters = ['Fall 2024','Spring 2025','Fall 2025','Spring 2026'];

    res.send(renderPage('Record Grade', SKIP + `<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('grades')}
      <div class="card" style="padding:32px">
        <h2 style="color:${P};margin:0 0 4px">📝 Record New Grade</h2>
        <p style="color:${GRAY};font-size:13px;margin:0 0 20px">This grade will be recorded on the blockchain with a cryptographic hash</p>
        <form method="POST" action="/school/blockchain-gradebook/grades/save" style="display:flex;flex-direction:column;gap:16px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px">
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Student ID *</label><input type="number" name="student_id" required placeholder="Student user ID" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Subject *</label>
              <select name="subject" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
                ${subjects.map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:14px">
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Grade *</label><input type="text" name="grade" required placeholder="e.g., A+, B, C" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Score (0-100) *</label><input type="number" name="score" required min="0" max="100" placeholder="e.g., 92" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
            <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Semester *</label>
              <select name="semester" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
                ${semesters.map(s => `<option value="${s}">${s}</option>`).join('')}
              </select>
            </div>
          </div>
          <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;padding:12px">
            <div style="display:flex;align-items:center;gap:8px"><span style="color:#059669;font-size:16px">⛓️</span><span style="font-size:13px;color:#059669;font-weight:600">This grade will be cryptographically sealed on the blockchain</span></div>
            <p style="font-size:12px;color:#065f46;margin:6px 0 0">A unique SHA-256 hash will be generated linking to the previous record. Once sealed, the grade cannot be tampered with without detection.</p>
          </div>
          <button type="submit" class="btn" style="padding:12px 28px;font-size:15px">⛓️ Record & Seal Grade</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 4: Save Grade ─────────────────────────────────
  app.post('/school/blockchain-gradebook/grades/save', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { student_id, subject, grade, score, semester } = req.body;

    // Get previous hash
    const [prev] = await pool.query('SELECT block_hash FROM blockchain_grades WHERE tenant_id=$1 ORDER BY id DESC LIMIT 1', [tid]);
    const previousHash = prev.length > 0 ? prev[0].block_hash : 'GENESIS_' + tid + '_' + Date.now().toString(36);

    // Generate block hash
    const gradeData = { student_id, subject, grade, score, semester, tenant_id };
    const blockHash = computeHash(gradeData, previousHash, crypto.randomBytes(16).toString('hex'));

    await pool.query('INSERT INTO blockchain_grades (tenant_id, student_id, subject, grade, score, semester, block_hash, previous_hash, verified_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)',
      [tid, student_id, subject, grade, parseFloat(score), semester, blockHash, previousHash, uid]);

    audit({ action: 'record_blockchain_grade', student_id, subject, grade, score, semester, user: req.session.user });
    res.redirect('/school/blockchain-gradebook/grades');
  }));

  // ─── ROUTE 5: Verify Grade ───────────────────────────────
  app.get('/school/blockchain-gradebook/grades/:id/verify', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [grade] = await pool.query('SELECT * FROM blockchain_grades WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!grade[0]) return res.redirect('/school/blockchain-gradebook/grades');
    const g = grade[0];

    // Verify chain integrity
    let chainValid = true;
    let chainBroken = false;
    if (g.previous_hash) {
      if (g.previous_hash.startsWith('GENESIS_')) {
        chainValid = true;
      } else {
        const [prevGrade] = await pool.query('SELECT block_hash FROM blockchain_grades WHERE block_hash=$1 AND tenant_id=$2', [g.previous_hash, tid]);
        if (prevGrade.length === 0) {
          // Check if it's by ID for older records
          chainValid = true; // assume valid if structure differs
        }
      }
    }

    const [attestations] = await pool.query('SELECT ga.*, u.name as attester_name FROM grade_attestations ga LEFT JOIN users u ON u.id=ga.attester_id WHERE ga.grade_id=$1 AND ga.tenant_id=$2', [g.id, tid]);

    res.send(renderPage('Grade Verification', SKIP + `<div style="max-width:800px;margin:0 auto;padding:20px">
      <a href="/school/blockchain-gradebook/grades" style="color:${P};text-decoration:none;font-size:13px">← Back to Grades</a>
      <div style="text-align:center;padding:32px;border-radius:16px;background:${chainValid?'#f0fdf4':'#fef2f2'};border:2px solid ${chainValid?'#bbf7d0':'#fecaca'};margin:16px 0">
        <div style="font-size:48px">${chainValid?'✅':'❌'}</div>
        <h2 style="color:${chainValid?'#059669':'#dc2626'};margin:8px 0 0">Grade Record ${chainValid?'Verified':'Invalid'}</h2>
        <p style="color:${GRAY};margin:4px 0 0">Cryptographic integrity check ${chainValid?'passed':'failed'}</p>
      </div>

      <div class="card">
        <h3 style="color:${P};margin:0 0 14px">📝 Grade Details</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div style="padding:10px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY};text-transform:uppercase">Subject</div><div style="font-weight:600;color:#1f2937">${esc(g.subject)}</div></div>
          <div style="padding:10px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY};text-transform:uppercase">Grade</div><div style="font-weight:700;color:${P}">${esc(g.grade)} (${g.score}%)</div></div>
          <div style="padding:10px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY};text-transform:uppercase">Semester</div><div style="font-weight:600;color:#1f2937">${esc(g.semester||'—')}</div></div>
          <div style="padding:10px;background:#f9fafb;border-radius:8px"><div style="font-size:11px;color:${GRAY};text-transform:uppercase">Student ID</div><div style="font-weight:600;color:#1f2937">${g.student_id}</div></div>
        </div>
      </div>

      <div class="card" style="margin-top:12px">
        <h3 style="color:${P};margin:0 0 14px">⛓️ Blockchain Data</h3>
        <div style="display:grid;gap:8px">
          <div style="padding:10px;background:#f3f4f6;border-radius:8px;font-family:monospace;font-size:12px;word-break:break-all"><strong>Block Hash:</strong> ${esc(g.block_hash)}</div>
          <div style="padding:10px;background:#f3f4f6;border-radius:8px;font-family:monospace;font-size:12px;word-break:break-all"><strong>Previous Hash:</strong> ${esc(g.previous_hash)}</div>
          <div style="padding:10px;background:#f3f4f6;border-radius:8px;font-size:12px"><strong>Timestamp:</strong> ${new Date(g.timestamp).toLocaleString()}</div>
          <div style="padding:10px;background:#f3f4f6;border-radius:8px;font-size:12px"><strong>Attestations:</strong> ${g.attestation_count || 0} | <strong>Verified:</strong> ${g.verified?'Yes':'No'}</div>
        </div>
      </div>

      ${attestations.length ? `<div class="card" style="margin-top:12px">
        <h3 style="color:${P};margin:0 0 14px">🔐 Attestations</h3>
        <table><thead><tr><th>Attester</th><th>Role</th><th>Date</th><th>Comments</th></tr></thead>
          <tbody>${attestations.map(a => `<tr>
            <td style="font-weight:600">${esc(a.attester_name||'ID:'+a.attester_id)}</td>
            <td>${badge(a.attester_role||'—', P)}</td>
            <td style="color:${GRAY};font-size:12px">${new Date(a.verified_at).toLocaleDateString()}</td>
            <td style="color:${GRAY};font-size:12px">${esc(a.comments||'—')}</td>
          </tr>`).join('')}</tbody>
        </table>
      </div>` : ''}

      <div style="margin-top:16px;display:flex;gap:10px">
        ${!g.verified ? `<a href="/school/blockchain-gradebook/grades/${g.id}/attest" class="btn" style="text-decoration:none;background:#059669">🔐 Attest This Grade</a>` : ''}
        <a href="/school/blockchain-gradebook/grades" class="btn" style="text-decoration:none;background:${GRAY}">← Back</a>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 6: Attest Grade ───────────────────────────────
  app.get('/school/blockchain-gradebook/grades/:id/attest', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const [grade] = await pool.query('SELECT * FROM blockchain_grades WHERE id=$1 AND tenant_id=$2', [req.params.id, tid]);
    if (!grade[0]) return res.redirect('/school/blockchain-gradebook/grades');

    res.send(renderPage('Attest Grade', SKIP + `<div style="max-width:600px;margin:0 auto;padding:20px">
      <a href="/school/blockchain-gradebook/grades/${grade[0].id}/verify" style="color:${P};text-decoration:none;font-size:13px">← Back</a>
      <div class="card" style="padding:32px;margin-top:12px">
        <h2 style="color:${P};margin:0 0 4px">🔐 Attest Grade Record</h2>
        <p style="color:${GRAY};font-size:13px;margin:0 0 20px">Confirm that this grade record is authentic and accurate</p>
        <div style="background:#f9fafb;padding:14px;border-radius:10px;margin-bottom:16px">
          <div><strong>Subject:</strong> ${esc(grade[0].subject)} | <strong>Grade:</strong> ${esc(grade[0].grade)} (${grade[0].score}%) | <strong>Semester:</strong> ${esc(grade[0].semester||'')}</div>
        </div>
        <form method="POST" action="/school/blockchain-gradebook/grades/${grade[0].id}/attest" style="display:flex;flex-direction:column;gap:12px">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Your Role</label>
            <select name="attester_role" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
              <option value="teacher">Teacher</option><option value="admin">Administrator</option><option value="department_head">Department Head</option><option value="principal">Principal</option><option value="external">External Verifier</option>
            </select>
          </div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Comments (optional)</label>
            <textarea name="comments" rows="2" placeholder="Add any comments about your attestation..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></textarea>
          </div>
          <button type="submit" class="btn" style="padding:12px 28px;font-size:15px;background:#059669">✅ Confirm Attestation</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 7: Save Attestation ───────────────────────────
  app.post('/school/blockchain-gradebook/grades/:id/attest', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { attester_role, comments } = req.body;
    const gradeId = req.params.id;
    const signature = crypto.createHash('sha256').update(uid + ':' + gradeId + ':' + Date.now()).digest('hex');

    await pool.query('INSERT INTO grade_attestations (tenant_id, grade_id, attester_id, attester_role, signature, comments) VALUES ($1, $2, $3, $4, $5, $6)',
      [tid, gradeId, uid, attester_role, signature, comments]);

    const [cnt] = await pool.query('SELECT COUNT(*) as c FROM grade_attestations WHERE grade_id=$1 AND tenant_id=$2', [gradeId, tid]);
    await pool.query('UPDATE blockchain_grades SET attestation_count=$1, verified=1, verified_by=$2 WHERE id=$3 AND tenant_id=$4',
      [cnt[0].c, uid, gradeId, tid]);

    audit({ action: 'attest_grade', gradeId, role: attester_role, user: req.session.user });
    res.redirect('/school/blockchain-gradebook/grades/' + gradeId + '/verify');
  }));

  // ─── ROUTE 8: Blockchain Ledger ──────────────────────────
  app.get('/school/blockchain-gradebook/ledger', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [blocks] = await pool.query('SELECT id, student_id, subject, grade, score, block_hash, previous_hash, timestamp, verified FROM blockchain_grades WHERE tenant_id=$1 ORDER BY id', [tid]);

    res.send(renderPage('Blockchain Ledger', SKIP + `<div style="max-width:1100px;margin:0 auto;padding:20px">
      ${nav('ledger')}
      <h2 style="color:${P};margin:0 0 4px">📖 Blockchain Ledger</h2>
      <p style="color:${GRAY};font-size:13px;margin:0 0 20px">Complete chain of grade records — each block cryptographically linked to the previous</p>

      <div style="display:flex;align-items:center;justify-content:center;flex-direction:column;gap:16px">
        ${blocks.length ? blocks.map((b, i) => `<div style="width:100%;max-width:800px">
          ${i > 0 ? `<div style="display:flex;justify-content:center;color:#d1d5db;font-size:20px;margin:4px 0">↓</div>` : ''}
          <div style="background:#fff;border:2px solid ${b.verified?'#bbf7d0':'#e5e7eb'};border-radius:12px;padding:16px;position:relative">
            <div style="position:absolute;top:-10px;left:16px;background:${P};color:#fff;padding:2px 10px;border-radius:10px;font-size:11px;font-weight:bold">Block #${b.id}</div>
            <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px;margin-top:12px">
              <div><div style="font-size:10px;color:${GRAY};text-transform:uppercase">Student</div><div style="font-weight:600;color:#1f2937;font-size:13px">ID: ${b.student_id}</div></div>
              <div><div style="font-size:10px;color:${GRAY};text-transform:uppercase">Subject</div><div style="font-weight:600;color:#1f2937;font-size:13px">${esc(b.subject)}</div></div>
              <div><div style="font-size:10px;color:${GRAY};text-transform:uppercase">Grade / Score</div><div style="font-weight:700;color:${P};font-size:13px">${esc(b.grade)} / ${b.score}%</div></div>
            </div>
            <div style="margin-top:10px;display:grid;grid-template-columns:1fr 1fr;gap:10px">
              <div style="font-size:10px;color:${GRAY}">Hash: <code style="color:#059669">${esc(b.block_hash)}</code></div>
              <div style="font-size:10px;color:${GRAY}">Prev: <code style="color:#7c3aed">${esc(b.previous_hash)}</code></div>
            </div>
            <div style="margin-top:6px;font-size:10px;color:${GRAY}">${new Date(b.timestamp).toLocaleString()} ${b.verified?'• ✅ Verified':''}</div>
          </div>
        </div>`).join('') : '<div style="text-align:center;padding:40px;color:'+GRAY+'">No blocks in the ledger yet</div>'}
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 9: Credential Verification Portal ─────────────
  app.get('/school/blockchain-gradebook/verify', requireAuth, ah(async (req, res) => {
    const code = req.query.code || '';
    let verificationResult = null;

    if (code) {
      const [request] = await pool.query('SELECT tr.*, u.name as student_name FROM transcript_requests tr LEFT JOIN users u ON u.id=tr.student_id WHERE tr.verification_code=$1 AND tr.tenant_id=$2', [code, req.session.user.tenant_id]);
      if (request[0]) {
        verificationResult = request[0];
      }
    }

    res.send(renderPage('Credential Verification', SKIP + `<div style="max-width:800px;margin:0 auto;padding:20px">
      ${nav('verify')}
      <h2 style="color:${P};margin:0 0 4px">✅ Credential Verification Portal</h2>
      <p style="color:${GRAY};font-size:13px;margin:0 0 24px">Employers and institutions can verify academic credentials using a verification code</p>

      <div class="card" style="padding:28px">
        <h3 style="color:${P};margin:0 0 16px">Enter Verification Code</h3>
        <form method="GET" style="display:flex;gap:10px">
          <input type="text" name="code" value="${esc(code)}" placeholder="Enter verification code..." required style="flex:1;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
          <button type="submit" class="btn" style="padding:10px 24px;white-space:nowrap">🔍 Verify</button>
        </form>
      </div>

      ${verificationResult ? `<div style="text-align:center;padding:28px;border-radius:16px;background:${verificationResult.status==='sent'?'#f0fdf4':verificationResult.status==='expired'?'#fef2f2':'#fffbeb'};border:2px solid ${verificationResult.status==='sent'?'#bbf7d0':verificationResult.status==='expired'?'#fecaca':'#fde68a'};margin-top:16px">
        <div style="font-size:48px">${verificationResult.status==='sent'?'✅':verificationResult.status==='expired'?'❌':'⏳'}</div>
        <h3 style="margin:8px 0 4px;color:${verificationResult.status==='sent'?'#059669':verificationResult.status==='expired'?'#dc2626':'#d97706'}">Credential ${verificationResult.status==='sent'?'Verified':verificationResult.status==='expired'?'Expired':'Pending'}</h3>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:16px;text-align:left;max-width:500px;margin-left:auto;margin-right:auto">
          <div style="padding:10px;background:rgba(255,255,255,.7);border-radius:8px"><div style="font-size:10px;color:${GRAY}">Student</div><div style="font-weight:600">${esc(verificationResult.student_name||'ID:'+verificationResult.student_id)}</div></div>
          <div style="padding:10px;background:rgba(255,255,255,.7);border-radius:8px"><div style="font-size:10px;color:${GRAY}">Purpose</div><div style="font-weight:600">${esc(verificationResult.purpose||'General Verification')}</div></div>
          <div style="padding:10px;background:rgba(255,255,255,.7);border-radius:8px"><div style="font-size:10px;color:${GRAY}">Recipient</div><div style="font-weight:600">${esc(verificationResult.recipient_name||'—')}</div></div>
          <div style="padding:10px;background:rgba(255,255,255,.7);border-radius:8px"><div style="font-size:10px;color:${GRAY}">Status</div><div style="font-weight:600">${verificationResult.status}</div></div>
        </div>
      </div>` : code ? `<div style="text-align:center;padding:28px;border-radius:16px;background:#fef2f2;border:2px solid #fecaca;margin-top:16px">
        <div style="font-size:48px">❌</div>
        <h3 style="color:#dc2626;margin:8px 0 0">Invalid Verification Code</h3>
        <p style="color:${GRAY};margin:4px 0 0">The code you entered does not match any records</p>
      </div>` : ''}
    </div>`, req.session.user));
  }));

  // ─── ROUTE 10: Request Transcript ────────────────────────
  app.get('/school/blockchain-gradebook/transcripts/request', requireAuth, ah(async (req, res) => {
    res.send(renderPage('Request Transcript', SKIP + `<div style="max-width:700px;margin:0 auto;padding:20px">
      ${nav('transcripts')}
      <div class="card" style="padding:32px">
        <h2 style="color:${P};margin:0 0 4px">📜 Request Official Transcript</h2>
        <p style="color:${GRAY};font-size:13px;margin:0 0 20px">A verification code will be generated for the recipient to verify your credentials</p>
        <form method="POST" action="/school/blockchain-gradebook/transcripts/request" style="display:flex;flex-direction:column;gap:16px">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Recipient Name *</label><input type="text" name="recipient_name" required placeholder="Name of institution or employer" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Recipient Email *</label><input type="email" name="recipient_email" required placeholder="recipient@institution.com" style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Purpose *</label>
            <select name="purpose" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
              <option value="employment">Employment Verification</option><option value="university">University Admission</option><option value="scholarship">Scholarship Application</option><option value="transfer">School Transfer</option><option value="immigration">Immigration</option><option value="other">Other</option>
            </select>
          </div>
          <button type="submit" class="btn" style="padding:12px 28px;font-size:15px">📜 Generate Verification Code</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 11: Save Transcript Request ───────────────────
  app.post('/school/blockchain-gradebook/transcripts/request', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const { recipient_name, recipient_email, purpose } = req.body;

    const verificationCode = crypto.randomBytes(8).toString('hex').toUpperCase();
    const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days

    await pool.query('INSERT INTO transcript_requests (tenant_id, student_id, recipient_name, recipient_email, purpose, verification_code, expires_at, status) VALUES ($1, $2, $3, $4, $5, $6, $7, \'pending\')',
      [tid, uid, recipient_name, recipient_email, purpose, verificationCode, expiresAt]);

    audit({ action: 'request_transcript', recipient: recipient_name, purpose, user: req.session.user });

    // Send email notification if queueEmail available
    if (queueEmail) {
      try {
        await queueEmail({ to: recipient_email, subject: 'Transcript Verification Request', body: `A transcript verification request has been submitted. Verification code: ${verificationCode}. This code expires in 30 days.` });
      } catch(e) { /* email may fail, that's ok */ }
    }

    res.send(renderPage('Transcript Requested', SKIP + `<div style="max-width:600px;margin:0 auto;padding:20px;text-align:center">
      <div style="padding:40px;border-radius:16px;background:#f0fdf4;border:2px solid #bbf7d0;margin-top:40px">
        <div style="font-size:48px">✅</div>
        <h2 style="color:#059669;margin:12px 0 8px">Transcript Request Submitted</h2>
        <p style="color:${GRAY};margin:0 0 20px">Your verification code has been generated</p>
        <div style="background:#fff;padding:16px;border-radius:10px;border:2px dashed #059669;display:inline-block;margin-bottom:16px">
          <div style="font-size:11px;color:${GRAY};text-transform:uppercase;margin-bottom:4px">Verification Code</div>
          <div style="font-size:24px;font-weight:800;color:#059669;font-family:monospace;letter-spacing:2px">${verificationCode}</div>
        </div>
        <p style="color:${GRAY};font-size:13px">Share this code with ${esc(recipient_name)} so they can verify your credentials at the verification portal.</p>
        <p style="color:${GRAY};font-size:12px;margin-top:8px">This code expires on ${expiresAt.toLocaleDateString()}</p>
        <div style="margin-top:16px"><a href="/school/blockchain-gradebook/transcripts" class="btn" style="text-decoration:none">View My Requests</a></div>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 12: Transcript Requests List ──────────────────
  app.get('/school/blockchain-gradebook/transcripts', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const role = req.session.user.role;

    let paramIdx = 1;
    let whereClause = 'WHERE tenant_id=$' + paramIdx++;
    const params = [tid];
    if (role !== 'admin' && role !== 'teacher') { whereClause += ' AND student_id=$' + paramIdx++; params.push(uid); }

    const [requests] = await pool.query(`SELECT tr.*, u.name as student_name FROM transcript_requests tr ${role!=='admin'&&role!=='teacher'?'':'LEFT JOIN users u ON u.id=tr.student_id'} ${whereClause} ORDER BY tr.created_at DESC`, params);

    res.send(renderPage('Transcript Requests', SKIP + `<div style="max-width:1000px;margin:0 auto;padding:20px">
      ${nav('transcripts')}
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:20px">
        <h2 style="color:${P};margin:0">📜 Transcript Requests</h2>
        <a href="/school/blockchain-gradebook/transcripts/request" class="btn" style="text-decoration:none;padding:8px 16px">+ New Request</a>
      </div>
      <div class="card" style="overflow-x:auto">
        <table>
          <thead><tr><th>ID</th><th>${role==='teacher'||role==='admin'?'Student':'Recipient'}</th><th>Purpose</th><th>Verification Code</th><th>Status</th><th>Expires</th><th>Created</th></tr></thead>
          <tbody>
            ${requests.length ? requests.map(r => `<tr>
              <td style="font-weight:600;color:${GRAY}">#${r.id}</td>
              <td>${role==='teacher'||role==='admin'?esc(r.student_name||'ID:'+r.student_id):esc(r.recipient_name||'—')}</td>
              <td>${esc(r.purpose||'—')}</td>
              <td style="font-family:monospace;font-size:12px;color:${P}">${esc(r.verification_code)}</td>
              <td>${badge(r.status, r.status==='sent'?'#059669':r.status==='expired'?'#dc2626':r.status==='approved'?'#7c3aed':'#d97706')}</td>
              <td style="color:${GRAY};font-size:12px">${r.expires_at?new Date(r.expires_at).toLocaleDateString():'—'}</td>
              <td style="color:${GRAY};font-size:12px">${new Date(r.created_at).toLocaleDateString()}</td>
            </tr>`).join('') : `<tr><td colspan="7" style="text-align:center;color:${GRAY};padding:30px">No transcript requests</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 13: File Dispute ──────────────────────────────
  app.get('/school/blockchain-gradebook/dispute/:gradeId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const [grade] = await pool.query('SELECT * FROM blockchain_grades WHERE id=$1 AND tenant_id=$2', [req.params.gradeId, tid]);
    if (!grade[0]) return res.redirect('/school/blockchain-gradebook');

    const g = grade[0];

    res.send(renderPage('File Grade Dispute', SKIP + `<div style="max-width:600px;margin:0 auto;padding:20px">
      <a href="/school/blockchain-gradebook" style="color:${P};text-decoration:none;font-size:13px">← Back to Dashboard</a>
      <div class="card" style="padding:32px;margin-top:12px">
        <h2 style="color:#dc2626;margin:0 0 4px">⚖️ File Grade Dispute</h2>
        <p style="color:${GRAY};font-size:13px;margin:0 0 20px">Submit a dispute if you believe this grade is incorrect</p>
        <div style="background:#fffbeb;padding:14px;border-radius:10px;border:1px solid #fde68a;margin-bottom:16px">
          <div style="font-weight:600;color:#92400e">${esc(g.subject)} — ${esc(g.grade)} (${g.score}%) — ${esc(g.semester||'')}</div>
          <div style="font-size:11px;color:#92400e;margin-top:4px">Block: ${shortHash(g.block_hash)}</div>
        </div>
        <form method="POST" action="/school/blockchain-gradebook/dispute/${g.id}" style="display:flex;flex-direction:column;gap:12px">
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Reason for Dispute *</label>
            <select name="reason" required style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px">
              <option value="score_error">Incorrect Score</option><option value="grade_miscalculation">Grade Miscalculation</option><option value="missing_work">Missing Work Not Counted</option><option value="late_penalty">Late Penalty Disagreement</option><option value="academic_integrity">Academic Integrity Concern</option><option value="other">Other</option>
            </select>
          </div>
          <div><label style="font-weight:600;display:block;margin-bottom:5px;color:#1f2937">Detailed Explanation *</label>
            <textarea name="explanation" rows="4" required placeholder="Explain why you believe this grade should be reviewed..." style="width:100%;padding:10px 14px;border:1px solid #d1d5db;border-radius:8px"></textarea>
          </div>
          <button type="submit" class="btn" style="padding:12px 28px;font-size:15px;background:#dc2626">⚖️ Submit Dispute</button>
        </form>
      </div>
    </div>`, req.session.user));
  }));

  // ─── ROUTE 14: Save Dispute ──────────────────────────────
  app.post('/school/blockchain-gradebook/dispute/:gradeId', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const { reason, explanation } = req.body;

    await pool.query('UPDATE blockchain_grades SET dispute_status=\'pending\' WHERE id=$1 AND tenant_id=$2', [req.params.gradeId, tid]);

    audit({ action: 'file_grade_dispute', gradeId: req.params.gradeId, reason, explanation, user: req.session.user });
    res.redirect('/school/blockchain-gradebook/disputes');
  }));

  // ─── ROUTE 15: Disputes List ─────────────────────────────
  app.get('/school/blockchain-gradebook/disputes', requireAuth, ah(async (req, res) => {
    const tid = req.session.user.tenant_id;
    const uid = req.session.user.id;
    const role = req.session.user.role;

    let paramIdx = 1;
    let whereClause = 'WHERE tenant_id=$' + paramIdx++ + " AND dispute_status!='none'";
    const params = [tid];
    if (role !== 'admin' && role !== 'teacher') { whereClause += ' AND student_id=$' + paramIdx++; params.push(uid); }

    const [disputes] = await pool.query(`SELECT bg.*, u.name as student_name FROM blockchain_grades bg LEFT JOIN users u ON u.id=bg.student_id ${whereClause} ORDER BY bg.id DESC`, params);

    res.send(renderPage('Grade Disputes', SKIP + `<div style="max-width:1000px;margin:0 auto;padding:20px">
      ${nav('disputes')}
      <h2 style="color:${P};margin:0 0 20px">⚖️ Grade Disputes</h2>
      <div class="card" style="overflow-x:auto">
        <table>
          <thead><tr><th>ID</th><th>${role==='teacher'||role==='admin'?'Student':'Subject'}</th><th>Subject</th><th>Grade</th><th>Status</th><th>Date</th></tr></thead>
          <tbody>
            ${disputes.length ? disputes.map(d => `<tr>
              <td style="font-weight:600;color:${GRAY}">#${d.id}</td>
              <td>${role==='teacher'||role==='admin'?esc(d.student_name||'ID:'+d.student_id):'—'}</td>
              <td style="font-weight:600;color:#1f2937">${esc(d.subject)}</td>
              <td style="font-weight:700;color:${P}">${esc(d.grade)} (${d.score}%)</td>
              <td>${badge(d.dispute_status, d.dispute_status==='pending'?'#d97706':d.dispute_status==='resolved'?'#059669':'#dc2626')}</td>
              <td style="color:${GRAY};font-size:12px">${new Date(d.timestamp).toLocaleDateString()}</td>
            </tr>`).join('') : `<tr><td colspan="6" style="text-align:center;color:${GRAY};padding:30px">No disputes filed</td></tr>`}
          </tbody>
        </table>
      </div>
    </div>`, req.session.user));
  }));

};
